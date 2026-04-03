import { NextRequest, NextResponse } from 'next/server';

const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const BASE_ID = 'app6MNeWlLW997eVg';

// Airtable staff record ID → Slack user ID map
const STAFF_SLACK_IDS: Record<string, string> = {
  // Populated from known staff
  samantha: 'U049MHELAGH',
  mario: 'U0359HGMURK',
  carlo: 'U01UC9LDUNN',
  lucia: 'U03NADB46KH',
  toni: 'U03A6ET1U3U',
  kamila: 'U022LHAS5HB',
  sawyer: 'U02B4GJQEA1',
};

async function getManagerSlackId(managerRecordIds: string[]): Promise<string | null> {
  for (const rid of managerRecordIds) {
    try {
      const res = await fetch(
        `https://api.airtable.com/v0/${BASE_ID}/Staff/${rid}?fields[]=First%20Name&fields[]=Last%20Name`,
        { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } }
      );
      const data = await res.json();
      const firstName = (data.fields?.['First Name'] || '').toLowerCase().trim();
      if (STAFF_SLACK_IDS[firstName]) {
        return STAFF_SLACK_IDS[firstName];
      }
    } catch {}
  }
  return null;
}

export async function POST(req: NextRequest) {
  const { projectName, filename, results } = await req.json();

  if (!projectName) {
    return NextResponse.json({ error: 'Project name is required' }, { status: 400 });
  }

  // 1. Look up project in Airtable by name
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

  // 2. Look up manager Slack ID
  const managerRecordIds: string[] = record.fields['Manager'] || [];
  const managerSlackId = await getManagerSlackId(managerRecordIds);
  const managerMention = managerSlackId ? `<@${managerSlackId}>` : 'Manager';

  // 3. Build Slack message
  const passed = results.passed?.length || 0;
  const warnings = results.warnings?.length || 0;
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
    ``,
    `Hey ${managerMention} — this one's ready for your review!`,
  ]
    .filter((l) => l !== null)
    .join('\n');

  // 4. Post to Slack channel
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
