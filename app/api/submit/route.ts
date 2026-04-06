import { NextRequest, NextResponse } from 'next/server';

const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const BASE_ID = 'app6MNeWlLW997eVg';

// Airtable Staff record ID → Slack user ID
const STAFF_RECORD_TO_SLACK: Record<string, string> = {
  'rec0dIRxb3M3rxwhj': 'U049MHELAGH', // Samantha Stapleton
  'recOQ66YfWQYEnOsL': 'U0359HGMURK', // Mario Romano
  'recbA7sW0YP0TWC4V': 'U01UC9LDUNN', // Carlo Gomez
  'recOPay1tJ74fOtR2': 'U03NADB46KH', // Lucia Debonis
  'recXYUpTvyp06MZta': 'U03A6ET1U3U', // Toni Vrapi
  'recxr2enNUGe1GLg3': 'U022LHAS5HB', // Kamila Weiss
  'rec2I819qhRyvObdl': 'U02B4GJQEA1', // Sawyer Romano
  'recYwVvHGYKxcqw1R': 'U08BXDJLA6M', // Mindy Kaufman
};

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

  if (!record) {
    return NextResponse.json({ error: `Project "${projectName}" not found in Airtable` }, { status: 404 });
  }

  const slackChannelId = record.fields['Slack Channel ID'];
  if (!slackChannelId) {
    return NextResponse.json({ error: 'No Slack channel found for this project' }, { status: 404 });
  }

  // 2. Resolve manager Slack mention
  const managerRecordIds: string[] = record.fields['Manager'] || [];
  let managerMention = 'Manager';
  for (const rid of managerRecordIds) {
    const slackId = STAFF_RECORD_TO_SLACK[rid];
    if (slackId) {
      managerMention = `<@${slackId}>`;
      break;
    }
  }

  // 3. Build message details
  const passed = results.passed?.length || 0;
  const warnings = results.warnings?.length || 0;
  const manual = results.manualReview?.length || 0;
  const drawnBy = results.extractedInfo?.drawnBy;
  const version = results.extractedInfo?.version;
  const airtableRecordId = record.id;

  // Encode metadata in button value for the approve handler
  const approvePayload = JSON.stringify({
    action: 'sd_approve',
    recordId: airtableRecordId,
    pdfUrl: pdfBlobUrl,
    filename,
    projectName: record.fields['Project Name'],
  });

  const revisionsPayload = JSON.stringify({
    action: 'sd_revisions',
    recordId: airtableRecordId,
    projectName: record.fields['Project Name'],
  });

  // 4. Post with buttons
  const blocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: [
          `✅ *Shop drawing is ready for manager review*`,
          ``,
          `📄 *File:* ${filename}${version ? `  •  ${version}` : ''}`,
          drawnBy ? `👤 *Drawn by:* ${drawnBy}` : null,
          ``,
          `*QC Results:*  ✅ ${passed} passed  ⚠️ ${warnings} warnings  👁️ ${manual} manual`,
          ``,
          results.summary,
          ``,
          `Hey ${managerMention} — this one's ready for your review!`,
          pdfBlobUrl ? `\n<${pdfBlobUrl}|📎 View PDF>` : null,
        ].filter(Boolean).join('\n'),
      },
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: '✅ Approve', emoji: true },
          style: 'primary',
          action_id: 'sd_approve',
          value: approvePayload,
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: '🔄 Request Revisions', emoji: true },
          action_id: 'sd_revisions',
          value: revisionsPayload,
        },
      ],
    },
  ];

  const slackRes = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ channel: slackChannelId, blocks }),
  });

  const slackData = await slackRes.json();
  if (!slackData.ok) {
    return NextResponse.json({ error: `Slack error: ${slackData.error}` }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    channel: slackChannelId,
    project: record.fields['Project Name'],
  });
}
