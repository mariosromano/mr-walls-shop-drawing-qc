import { NextRequest, NextResponse } from 'next/server';

const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const BASE_ID = 'app6MNeWlLW997eVg';

export async function POST(req: NextRequest) {
  const { projectName, filename, results } = await req.json();

  if (!projectName) {
    return NextResponse.json({ error: 'Project name is required' }, { status: 400 });
  }

  // 1. Look up project in Airtable by name
  const formula = encodeURIComponent(`SEARCH("${projectName.trim()}", {Project Name})`);
  const atRes = await fetch(
    `https://api.airtable.com/v0/${BASE_ID}/Projects?filterByFormula=${formula}&fields[]=Project%20Name&fields[]=Slack%20Channel%20ID`,
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

  // 2. Build Slack message
  const passed = results.passed?.length || 0;
  const warnings = results.warnings?.length || 0;
  const critical = results.criticalIssues?.length || 0;
  const manual = results.manualReview?.length || 0;

  const drawnBy = results.extractedInfo?.drawnBy;
  const version = results.extractedInfo?.version;

  const lines = [
    `✅ *Shop drawing is ready for manager review*`,
    ``,
    `📄 *File:* ${filename}${version ? `  •  ${version}` : ''}`,
    drawnBy ? `👤 *Drawn by:* ${drawnBy}` : null,
    ``,
    `*QC Results:*  ✅ ${passed} passed  ⚠️ ${warnings} warnings  👁️ ${manual} manual`,
    ``,
    results.summary,
  ]
    .filter((l) => l !== null)
    .join('\n');

  // 3. Post to Slack channel
  const slackRes = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ channel: slackChannelId, text: lines }),
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
