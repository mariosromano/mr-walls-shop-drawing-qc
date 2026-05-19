import { NextRequest, NextResponse } from 'next/server';

const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const BASE_ID = 'app6MNeWlLW997eVg';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const projectName = searchParams.get('name');

  if (!projectName) {
    return NextResponse.json({ error: 'Project name required' }, { status: 400 });
  }

  // Use exact match instead of SEARCH to avoid partial matches (e.g. "Fake Project 2" matching "Fake Project")
  const formula = encodeURIComponent(`{Project Name} = "${projectName.trim()}"`);
  const res = await fetch(
    `https://api.airtable.com/v0/${BASE_ID}/Projects?filterByFormula=${formula}&fields[]=Project%20Name&fields[]=Render%20Folder%20URL&fields[]=Slack%20Channel%20ID`,
    { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } }
  );
  const data = await res.json();
  const record = data.records?.[0];

  if (!record) {
    return NextResponse.json({ found: false });
  }

  const renderUrls: string[] = record.fields['Render Folder URL'] || [];
  const renderUrl = renderUrls[0] || null;

  return NextResponse.json({
    found: true,
    projectName: record.fields['Project Name'],
    recordId: record.id,
    renderUrl,
    hasRenderUrl: !!renderUrl,
  });
}
