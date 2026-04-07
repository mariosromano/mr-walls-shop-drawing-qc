import { NextRequest, NextResponse } from 'next/server';

const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const BASE_ID = 'app6MNeWlLW997eVg';
const SD_REVIEWS_TABLE = 'tblaPRT3OsuOfgtKE';

const STAFF_RECORD_TO_SLACK: Record<string, string> = {
  'rec0dIRxb3M3rxwhj': 'U049MHELAGH', // Samantha
  'recOQ66YfWQYEnOsL': 'U0359HGMURK', // Mario
  'recbA7sW0YP0TWC4V': 'U01UC9LDUNN', // Carlo
  'recOPay1tJ74fOtR2': 'U03NADB46KH', // Lucia
  'recXYUpTvyp06MZta': 'U03A6ET1U3U', // Toni
  'recxr2enNUGe1GLg3': 'U022LHAS5HB', // Kamila
  'rec2I819qhRyvObdl': 'U02B4GJQEA1', // Sawyer
  'recYwVvHGYKxcqw1R': 'U08BXDJLA6M', // Mindy
  'recqQrGFFV1Cehe2g': 'U08QJUG0L23', // Emma
  'reczrVcIbdWDPtdvY': 'U08QJUG0L23', // Belen (same Slack as Emma for now — TODO verify)
};

async function slackPost(path: string, body: object) {
  const res = await fetch(`https://slack.com/api/${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function getOrCreateCanvas(channelId: string): Promise<string | null> {
  const res = await fetch(`https://slack.com/api/conversations.info?channel=${channelId}`, {
    headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` },
  });
  const info = await res.json();
  const tabs: Array<{ type: string; label?: string; data?: { file_id: string } }> =
    info.channel?.properties?.tabs || [];
  const existing = tabs.find(t => t.type === 'canvas' && t.label === 'Revisions and Updates');
  if (existing?.data?.file_id) return existing.data.file_id;

  const created = await slackPost('conversations.canvases.create', {
    channel_id: channelId,
    document_content: { type: 'markdown', markdown: '# Revisions and Updates\n\nShop drawing submissions and revision history.\n' },
  });
  return created.canvas_id || null;
}

async function uploadPdfToSlack(channelId: string, pdfUrl: string, filename: string): Promise<string | null> {
  try {
    const pdfRes = await fetch(pdfUrl);
    if (!pdfRes.ok) return null;
    const buffer = await pdfRes.arrayBuffer();
    const bytes = new Uint8Array(buffer);

    const uploadUrlRes = await (await fetch(
      `https://slack.com/api/files.getUploadURLExternal?filename=${encodeURIComponent(filename)}&length=${bytes.length}`,
      { headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` } }
    )).json();
    if (!uploadUrlRes.ok) return null;

    await fetch(uploadUrlRes.upload_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: bytes,
    });

    // Complete WITH channel_id so the permalink is accessible to all channel members
    const completeRes = await slackPost('files.completeUploadExternal', {
      files: [{ id: uploadUrlRes.file_id, title: filename }],
      channel_id: channelId,
    });
    // Try to silently delete the auto-posted file message so it doesn't clutter the channel
    try {
      const fileMsg = completeRes.files?.[0];
      const shares = fileMsg?.shares?.private || fileMsg?.shares?.public || {};
      const shareList = Object.values(shares as Record<string, Array<{ts: string}>>)[0];
      if (shareList?.[0]?.ts) {
        await slackPost('chat.delete', { channel: channelId, ts: shareList[0].ts });
      }
    } catch {}
    return completeRes.files?.[0]?.permalink || null;
  } catch { return null; }
}

export async function POST(req: NextRequest) {
  const { projectName, filename, results, pdfBlobUrl, designerNotes, renderUrl } = await req.json();
  if (!projectName) return NextResponse.json({ error: 'Project name is required' }, { status: 400 });

  // 1. Look up project
  const formula = encodeURIComponent(`SEARCH("${projectName.trim()}", {Project Name})`);
  const atRes = await fetch(
    `https://api.airtable.com/v0/${BASE_ID}/Projects?filterByFormula=${formula}&fields[]=Project%20Name&fields[]=Slack%20Channel%20ID&fields[]=Manager&fields[]=Render%20Folder%20URL&fields[]=Designer`,
    { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } }
  );
  const atData = await atRes.json();
  const record = atData.records?.[0];
  if (!record) return NextResponse.json({ error: `Project "${projectName}" not found in Airtable` }, { status: 404 });

  const slackChannelId = record.fields['Slack Channel ID'];
  if (!slackChannelId) return NextResponse.json({ error: 'No Slack channel found' }, { status: 404 });

  const fullProjectName = record.fields['Project Name'];

  // If designer provided a new render URL, save it to Airtable
  const existingRenderUrls: string[] = record.fields['Render Folder URL'] || [];
  if (renderUrl && !existingRenderUrls.includes(renderUrl)) {
    await fetch(`https://api.airtable.com/v0/${BASE_ID}/Projects/${record.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { 'Render Folder URL': [renderUrl] } }),
    });
  }
  const airtableRecordId = record.id;

  // Resolve manager + designer Slack IDs
  const managerIds: string[] = record.fields['Manager'] || [];
  const designerIds: string[] = record.fields['Designer'] || [];
  let managerSlackId: string | null = null;
  let designerSlackId: string | null = null;
  for (const rid of managerIds) { if (STAFF_RECORD_TO_SLACK[rid]) { managerSlackId = STAFF_RECORD_TO_SLACK[rid]; break; } }
  for (const rid of designerIds) { if (STAFF_RECORD_TO_SLACK[rid]) { designerSlackId = STAFF_RECORD_TO_SLACK[rid]; break; } }

  const passed = results.passed?.length || 0;
  const warnings = results.warnings?.length || 0;
  const manual = results.manualReview?.length || 0;
  const drawnBy = results.extractedInfo?.drawnBy;
  const version = results.extractedInfo?.version;
  const managerMention = managerSlackId ? `<@${managerSlackId}>` : 'Manager';
  const nowDate = new Date();
  const now = nowDate.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
  const nowTime = nowDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Los_Angeles' });

  // 2. Upload PDF (stored silently)
  let filePermalink: string | null = null;
  if (pdfBlobUrl) filePermalink = await uploadPdfToSlack(slackChannelId, pdfBlobUrl, filename);

  // 3. Update canvas
  const canvasId = await getOrCreateCanvas(slackChannelId);
  if (canvasId) {
    const canvasEntry = [
      `## 📄 ${filename}${version ? ` — ${version}` : ''}`,
      `**Submitted:** ${now} at ${nowTime} PT${drawnBy ? `  |  **By:** ${drawnBy}` : ''}`,
      `**QC:** ✅ ${passed} passed  ⚠️ ${warnings} warnings  👁️ ${manual} manual`,
      `**Status:** ⏳ Pending manager review`,
      designerNotes ? `**Notes:** ${designerNotes}` : '',
      renderUrl ? `**Render Folder:** [Open](${renderUrl})` : '',
      filePermalink ? `[📎 Open PDF](${filePermalink})` : '',
      `\n---\n`,
    ].filter(l => l !== '').join('\n');

    const existingRes = await slackPost('canvases.sections.lookup', {
      canvas_id: canvasId,
      criteria: { contains_text: '\uD83D\uDCC4' },
    });
    const firstId = existingRes.sections?.[0]?.id;
    if (firstId) {
      await slackPost('canvases.edit', { canvas_id: canvasId, changes: [{ operation: 'insert_before', section_id: firstId, document_content: { type: 'markdown', markdown: canvasEntry } }] });
    } else {
      await slackPost('canvases.edit', { canvas_id: canvasId, changes: [{ operation: 'insert_at_end', document_content: { type: 'markdown', markdown: canvasEntry } }] });
    }
  }

  // 4. Post to channel — this message becomes the review thread
  const notesPart = designerNotes ? `\n📝 *Notes:* ${designerNotes}` : '';
  const renderPart = renderUrl ? `\n📁 *Render Folder:* <${renderUrl}|Open>` : '';
  const channelMsg = `${managerMention} Shop drawing ready for review — *${fullProjectName}*\n📄 ${filename}${version ? `  •  ${version}` : ''}\n*QC:* ✅ ${passed} passed  ⚠️ ${warnings} warnings\n\nPDF added to the Revisions and Updates canvas.\n_Reply in this thread to approve or describe revisions._${notesPart}${renderPart}`;
  const msgRes = await slackPost('chat.postMessage', { channel: slackChannelId, text: channelMsg });
  const messageTs = msgRes.ts;

  // 5. Save to SD Reviews table
  await fetch(`https://api.airtable.com/v0/${BASE_ID}/${SD_REVIEWS_TABLE}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: {
      'Project Name': fullProjectName,
      'Channel ID': slackChannelId,
      'Message TS': messageTs,
      'Filename': filename,
      'Project Record ID': airtableRecordId,
      'Designer Slack ID': designerSlackId || '',
      'Manager Slack ID': managerSlackId || '',
      'PDF URL': filePermalink || '',
      'PDF Blob URL': pdfBlobUrl || '',
      'Designer Notes': designerNotes || '',
      'Render URL Used': renderUrl || '',
      'Status': 'Pending',
    }}),
  });

  return NextResponse.json({ ok: true, channel: slackChannelId, project: fullProjectName });
}
