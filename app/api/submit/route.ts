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
  'recqQrGFFV1Cehe2g': 'U05RDF4BFLZ', // Emma Ruiz
  'reczrVcIbdWDPtdvY': 'U08QJUG0L23', // Belen Cicchi
  'rec11tfbDYksclMWj': 'U07L17NHS8G', // Victor Villavincencio
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
  
  // Check both tabs and tabz for the labeled canvas
  const tabSources = [
    ...(info.channel?.properties?.tabs || []),
    ...(info.channel?.properties?.tabz || []),
  ];
  const existing = tabSources.find(
    (t: { type: string; label?: string; data?: { file_id: string } }) =>
      t.type === 'canvas' && t.label === 'Revisions and Updates' && t.data?.file_id
  );
  if (existing?.data?.file_id) return existing.data.file_id;

  // Only create if truly none found
  const created = await slackPost('conversations.canvases.create', {
    channel_id: channelId,
    document_content: { type: 'markdown', markdown: '# Revisions and Updates\n\nShop drawing submissions and revision history.\n' },
  });
  return created.canvas_id || null;
}

// Step 1: Upload bytes to Slack's external upload URL, return the file_id without completing.
// This avoids auto-posting a file message to the channel.
async function prepareSlackUpload(pdfUrl: string, filename: string): Promise<{fileId: string} | null> {
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

    return { fileId: uploadUrlRes.file_id };
  } catch { return null; }
}

// Step 2: Complete the upload into a specific thread so the file appears
// as a thread reply (not a standalone channel message).
async function completeUploadInThread(channelId: string, threadTs: string, fileId: string, filename: string): Promise<string | null> {
  try {
    const completeRes = await slackPost('files.completeUploadExternal', {
      files: [{ id: fileId, title: filename }],
      channel_id: channelId,
      thread_ts: threadTs,
    });
    return completeRes.files?.[0]?.permalink || null;
  } catch { return null; }
}

export async function POST(req: NextRequest) {
  const { projectName, filename, results, pdfBlobUrl, designerNotes, renderUrl, overrideIssues, criticalIssues } = await req.json();
  if (!projectName) return NextResponse.json({ error: 'Project name is required' }, { status: 400 });

  // 1. Look up project
  const formula = encodeURIComponent(`TRIM({Project Name}) = "${projectName.trim()}"`);
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

  // 2. Prepare PDF upload (bytes uploaded but NOT yet completed — avoids auto-posting to channel)
  let pendingUpload: {fileId: string} | null = null;
  if (pdfBlobUrl) pendingUpload = await prepareSlackUpload(pdfBlobUrl, filename);

  // 3. Update canvas (file permalink added after message post)
  const canvasId = await getOrCreateCanvas(slackChannelId);
  if (canvasId) {
    const canvasEntry = [
      `## 📄 ${filename}${version ? ` — ${version}` : ''}`,
      `**Submitted:** ${now} at ${nowTime} PT${drawnBy ? `  |  **By:** ${drawnBy}` : ''}`,
      `**QC:** ✅ ${passed} passed  ⚠️ ${warnings} warnings  👁️ ${manual} manual`,
      `**Status:** ⏳ Pending manager review`,
      (overrideIssues && criticalIssues?.length > 0) ? `**⚠️ Submitted with ${criticalIssues.length} critical issue(s) — manager review required**` : '',
      designerNotes ? `**Notes:** ${designerNotes}` : '',
      renderUrl ? `**Render Folder:** [Open](${renderUrl})` : '',
      pdfBlobUrl ? `[📎 Open PDF](${pdfBlobUrl})` : '',
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

  // 4. Post to channel — ONE message with Block Kit review buttons
  const qcLine = `✅ ${passed} passed  ⚠️ ${warnings} warnings`;
  const overrideNote = (overrideIssues && criticalIssues?.length > 0)
    ? `\n⚠️ *Submitted with ${criticalIssues.length} critical issue(s) — manager review required*`
    : '';
  const extraLines = [
    designerNotes ? `📝 *Notes:* ${designerNotes}` : '',
    renderUrl ? `📁 *Render Folder:* <${renderUrl}|Open>` : '',
  ].filter(Boolean).join('\n');

  const reviewBlocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${managerMention} Shop drawing ready for review — *${fullProjectName}*\n📄 ${filename}${version ? `  •  ${version}` : ''}\n*QC:* ${qcLine}${overrideNote}${extraLines ? '\n' + extraLines : ''}`,
      },
    },
    { type: 'divider' },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: 'PDF attached in this thread 👇 — select an action below:' },
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: '✅  Approve', emoji: true },
          style: 'primary',
          action_id: 'sd_approve',
          value: 'approve',
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: '🔄  Request Revision', emoji: true },
          style: 'danger',
          action_id: 'sd_revise',
          value: 'revise',
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: '💬  Comment Only', emoji: true },
          action_id: 'sd_comment',
          value: 'comment',
        },
      ],
    },
    {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: '📋 _Buttons are for review decisions. For general comments, reply in thread._' }],
    },
  ];

  const msgRes = await slackPost('chat.postMessage', {
    channel: slackChannelId,
    text: `${managerMention} Shop drawing ready for review — ${fullProjectName}`,
    blocks: reviewBlocks,
  });
  const messageTs = msgRes.ts;

  // 4b. Now complete the PDF upload INTO the thread (file appears as thread reply, not a new channel message)
  let filePermalink: string | null = null;
  if (pendingUpload && messageTs) {
    filePermalink = await completeUploadInThread(slackChannelId, messageTs, pendingUpload.fileId, filename);
  }

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

