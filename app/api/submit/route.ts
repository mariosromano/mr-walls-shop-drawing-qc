import { NextRequest, NextResponse } from 'next/server';

const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const BASE_ID = 'app6MNeWlLW997eVg';

const STAFF_RECORD_TO_SLACK: Record<string, string> = {
  'rec0dIRxb3M3rxwhj': 'U049MHELAGH',
  'recOQ66YfWQYEnOsL': 'U0359HGMURK',
  'recbA7sW0YP0TWC4V': 'U01UC9LDUNN',
  'recOPay1tJ74fOtR2': 'U03NADB46KH',
  'recXYUpTvyp06MZta': 'U03A6ET1U3U',
  'recxr2enNUGe1GLg3': 'U022LHAS5HB',
  'rec2I819qhRyvObdl': 'U02B4GJQEA1',
  'recYwVvHGYKxcqw1R': 'U08BXDJLA6M',
};

async function slackPost(path: string, body: object) {
  const res = await fetch(`https://slack.com/api/${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function openDM(userId: string): Promise<string> {
  const data = await slackPost('conversations.open', { users: userId });
  return data.channel.id;
}

async function getOrCreateCanvas(channelId: string): Promise<string | null> {
  // Check if channel has a canvas
  const info = await (await fetch(`https://slack.com/api/conversations.info?channel=${channelId}&include_locale=false`, {
    headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` },
  })).json();

  const existingCanvasId = info.channel?.properties?.canvas?.file_id;
  if (existingCanvasId) return existingCanvasId;

  // Create one
  const created = await slackPost('conversations.canvases.create', {
    channel_id: channelId,
    document_content: {
      type: 'markdown',
      markdown: '# Revisions and Updates\n\nShop drawing submissions and revision history.\n',
    },
  });
  return created.canvas_id || null;
}

async function appendToCanvas(canvasId: string, markdown: string) {
  return slackPost('canvases.sections.lookup', { canvas_id: canvasId, criteria: { contains_text: 'Revisions and Updates' } })
    .then(() => slackPost('canvases.edit', {
      canvas_id: canvasId,
      changes: [{ operation: 'insert_at_end', document_content: { type: 'markdown', markdown } }],
    }));
}

async function uploadPdfToSlack(channelId: string, pdfUrl: string, filename: string): Promise<string | null> {
  try {
    // Download PDF
    const pdfRes = await fetch(pdfUrl);
    if (!pdfRes.ok) return null;
    const buffer = await pdfRes.arrayBuffer();
    const bytes = new Uint8Array(buffer);

    // Get upload URL
    const uploadUrlRes = await (await fetch(
      `https://slack.com/api/files.getUploadURLExternal?filename=${encodeURIComponent(filename)}&length=${bytes.length}`,
      { headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` } }
    )).json();

    if (!uploadUrlRes.ok) return null;

    // Upload file
    await fetch(uploadUrlRes.upload_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: bytes,
    });

    // Complete upload
    const completeRes = await slackPost('files.completeUploadExternal', {
      files: [{ id: uploadUrlRes.file_id, title: filename }],
      channel_id: channelId,
    });

    return completeRes.files?.[0]?.permalink || null;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const { projectName, filename, results, pdfBlobUrl } = await req.json();

  if (!projectName) {
    return NextResponse.json({ error: 'Project name is required' }, { status: 400 });
  }

  // 1. Look up project in Airtable
  const formula = encodeURIComponent(`SEARCH("${projectName.trim()}", {Project Name})`);
  const atRes = await fetch(
    `https://api.airtable.com/v0/${BASE_ID}/Projects?filterByFormula=${formula}&fields[]=Project%20Name&fields[]=Slack%20Channel%20ID&fields[]=Manager`,
    { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } }
  );
  const atData = await atRes.json();
  const record = atData.records?.[0];

  if (!record) return NextResponse.json({ error: `Project "${projectName}" not found in Airtable` }, { status: 404 });

  const slackChannelId = record.fields['Slack Channel ID'];
  if (!slackChannelId) return NextResponse.json({ error: 'No Slack channel found for this project' }, { status: 404 });

  const managerRecordIds: string[] = record.fields['Manager'] || [];
  let managerSlackId: string | null = null;
  for (const rid of managerRecordIds) {
    if (STAFF_RECORD_TO_SLACK[rid]) { managerSlackId = STAFF_RECORD_TO_SLACK[rid]; break; }
  }

  const fullProjectName = record.fields['Project Name'];
  const airtableRecordId = record.id;
  const passed = results.passed?.length || 0;
  const warnings = results.warnings?.length || 0;
  const manual = results.manualReview?.length || 0;
  const drawnBy = results.extractedInfo?.drawnBy;
  const version = results.extractedInfo?.version;
  const managerMention = managerSlackId ? `<@${managerSlackId}>` : 'Manager';
  const now = new Date().toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });

  // 2. Upload PDF to Slack channel & get permalink
  let filePermalink: string | null = null;
  if (pdfBlobUrl) {
    filePermalink = await uploadPdfToSlack(slackChannelId, pdfBlobUrl, filename);
  }

  // 3. Get or create canvas, append submission entry
  const canvasId = await getOrCreateCanvas(slackChannelId);
  if (canvasId) {
    const canvasEntry = [
      `---`,
      `## 📄 ${filename}${version ? ` — ${version}` : ''}`,
      `**Date:** ${now}${drawnBy ? `  |  **By:** ${drawnBy}` : ''}`,
      `**QC:** ✅ ${passed} passed  ⚠️ ${warnings} warnings  👁️ ${manual} manual`,
      `**Status:** Pending manager review`,
      filePermalink ? `**File:** ${filePermalink}` : '',
      ``,
    ].filter(l => l !== null).join('\n');

    await appendToCanvas(canvasId, canvasEntry);
  }

  // 4. Post notification to project channel
  const channelText = [
    `✅ *Shop drawing ready for review — ${fullProjectName}*`,
    `📄 *File:* ${filename}${version ? `  •  ${version}` : ''}`,
    drawnBy ? `👤 *Drawn by:* ${drawnBy}` : null,
    `*QC Results:*  ✅ ${passed} passed  ⚠️ ${warnings} warnings  👁️ ${manual} manual`,
    ``,
    results.summary,
    ``,
    `${managerMention} — PDF added to the Revisions and Updates canvas. Review request sent to your DMs.`,
  ].filter(Boolean).join('\n');

  await slackPost('chat.postMessage', { channel: slackChannelId, text: channelText });

  // 5. DM manager
  if (managerSlackId) {
    const dmText = [
      `📋 *Shop drawing ready for your review*`,
      ``,
      `*Project:* ${fullProjectName}`,
      `📄 *File:* ${filename}${version ? `  •  ${version}` : ''}`,
      drawnBy ? `👤 *Drawn by:* ${drawnBy}` : null,
      ``,
      `*QC Results:*  ✅ ${passed} passed  ⚠️ ${warnings} warnings  👁️ ${manual} manual`,
      ``,
      results.summary,
      ``,
      filePermalink ? `<${filePermalink}|📎 Open PDF in Slack>` : (pdfBlobUrl ? `<${pdfBlobUrl}|📎 Open PDF>` : null),
      ``,
      `━━━━━━━━━━━━━━━━━━━━━━━`,
      `Reply *approve* to confirm the shop drawing is approved.`,
      `Or describe the revisions needed and I'll post them to the project channel.`,
      ``,
      `_record=${airtableRecordId} | channel=${slackChannelId} | file=${filename}_`,
    ].filter(Boolean).join('\n');

    const dmChannel = await openDM(managerSlackId);
    await slackPost('chat.postMessage', { channel: dmChannel, text: dmText });
  }

  return NextResponse.json({ ok: true, channel: slackChannelId, project: fullProjectName });
}
