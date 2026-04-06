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
  // Check existing canvases via tabs in conversations.info
  const res = await fetch(`https://slack.com/api/conversations.info?channel=${channelId}`, {
    headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` },
  });
  const info = await res.json();
  const tabs: Array<{type: string; label?: string; data?: {file_id: string}}> =
    info.channel?.properties?.tabs || [];

  // Look for a canvas labeled 'Revisions and Updates'
  const existing = tabs.find(t => t.type === 'canvas' && t.label === 'Revisions and Updates');
  if (existing?.data?.file_id) return existing.data.file_id;

  // Create new canvas
  const created = await slackPost('conversations.canvases.create', {
    channel_id: channelId,
    document_content: {
      type: 'markdown',
      markdown: '# Revisions and Updates\n\nShop drawing submissions and revision history.\n',
    },
  });
  return created.canvas_id || null;
}

async function uploadPdfToCanvas(canvasId: string, pdfUrl: string, filename: string, channelId: string): Promise<string | null> {
  try {
    // Download the PDF
    const pdfRes = await fetch(pdfUrl);
    if (!pdfRes.ok) return null;
    const buffer = await pdfRes.arrayBuffer();
    const bytes = new Uint8Array(buffer);

    // Get Slack upload URL (upload to channel so it's accessible)
    const uploadUrlRes = await (await fetch(
      `https://slack.com/api/files.getUploadURLExternal?filename=${encodeURIComponent(filename)}&length=${bytes.length}`,
      { headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` } }
    )).json();
    if (!uploadUrlRes.ok) return null;

    // Upload bytes
    await fetch(uploadUrlRes.upload_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: bytes,
    });

    // Complete upload — no channel_id so it doesn't post to channel
    const completeRes = await slackPost('files.completeUploadExternal', {
      files: [{ id: uploadUrlRes.file_id, title: filename }],
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
  const nowDate = new Date();
  const now = nowDate.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
  const nowTime = nowDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Los_Angeles' });

  // 2. Get or create canvas (one only)
  const canvasId = await getOrCreateCanvas(slackChannelId);

  // 3. Upload PDF and get permalink, then embed in canvas
  let filePermalink: string | null = null;
  if (pdfBlobUrl && canvasId) {
    filePermalink = await uploadPdfToCanvas(canvasId, pdfBlobUrl, filename, slackChannelId);

    // Append to canvas
    const canvasEntry = [
      `## 📄 ${filename}${version ? ` — ${version}` : ''}`,
      `**Submitted:** ${now} at ${nowTime} PT${drawnBy ? `  |  **By:** ${drawnBy}` : ''}`,
      `**QC:** ✅ ${passed} passed  ⚠️ ${warnings} warnings  👁️ ${manual} manual`,
      `**Status:** ⏳ Pending manager review`,
      filePermalink ? `[📎 Open PDF](${filePermalink})` : '',
      ``,
      `---`,
      ``,
    ].filter(l => l !== '').join('\n');

    // Find the first existing entry to insert before it (newest at top)
    const sectionsRes = await slackPost('canvases.sections.lookup', {
      canvas_id: canvasId,
      criteria: { contains_text: 'Shop Drawing' },
    });
    const firstEntryId = sectionsRes.sections?.[0]?.id;

    if (firstEntryId) {
      // Insert before the first existing entry so newest is at top
      await slackPost('canvases.edit', {
        canvas_id: canvasId,
        changes: [{ operation: 'insert_before', section_id: firstEntryId, document_content: { type: 'markdown', markdown: canvasEntry } }],
      });
    } else {
      // No existing entries — just append
      await slackPost('canvases.edit', {
        canvas_id: canvasId,
        changes: [{ operation: 'insert_at_end', document_content: { type: 'markdown', markdown: canvasEntry } }],
      });
    }
  }

  // 4. Short channel notification
  const channelText = `${managerMention} Shop drawing ready for review\nPDF added to the Revisions and Updates canvas.`;
  await slackPost('chat.postMessage', { channel: slackChannelId, text: channelText });

  // 5. DM manager
  if (managerSlackId) {
    const dmText = [
      `📋 *Shop drawing ready for your review — ${fullProjectName}*`,
      ``,
      `📄 *File:* ${filename}${version ? `  •  ${version}` : ''}`,
      drawnBy ? `👤 *Drawn by:* ${drawnBy}` : null,
      `*QC:*  ✅ ${passed} passed  ⚠️ ${warnings} warnings  👁️ ${manual} manual`,
      ``,
      filePermalink ? `<${filePermalink}|📎 Open PDF>` : null,
      ``,
      `Reply *approve* to confirm, or describe the revisions needed.`,
      ``,
      `_record=${airtableRecordId} | channel=${slackChannelId} | file=${filename}_`,
    ].filter(Boolean).join('\n');

    const dmChannel = await openDM(managerSlackId);
    await slackPost('chat.postMessage', { channel: dmChannel, text: dmText });
  }

  return NextResponse.json({ ok: true, channel: slackChannelId, project: fullProjectName });
}
