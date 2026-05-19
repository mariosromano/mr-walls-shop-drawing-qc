import { NextRequest, NextResponse } from 'next/server';

const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const BASE_ID = 'app6MNeWlLW997eVg';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const projectName = searchParams.get('name');

  if (!projectName) {
    return NextResponse.json({ error: 'Project name required' }, { status: 400 });
  }

  const formula = encodeURIComponent(`SEARCH("${projectName.trim()}", {Project Name})`);
  const res = await fetch(
    `https://api.airtable.com/v0/${BASE_ID}/Projects?filterByFormula=${formula}&fields[]=Project%20Name&fields[]=Render%20Folder%20URL&fields[]=Slack%20Channel%20ID`,
    { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } }
  );
  const data = await res.json();
  const record = data.records?.[0];

  if (!record) {
    return NextResponse.json({ found: false });
  }

  // Render Folder URL is a plain text/URL field in Airtable (returns string, not array)
  const renderFolderRaw = record.fields['Render Folder URL'];
  const renderUrl = Array.isArray(renderFolderRaw)
    ? (renderFolderRaw[0] || null)
    : (renderFolderRaw || null);

  return NextResponse.json({
    found: true,
    projectName: record.fields['Project Name'],
    recordId: record.id,
    renderUrl,
    hasRenderUrl: !!renderUrl,
  });
}
