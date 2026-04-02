import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const SYSTEM_PROMPT = `You are a deterministic quality control checker for M|R Walls shop drawings. Your job is to evaluate each check independently using exact, binary criteria. Given identical inputs, you must always produce identical outputs. Do not add subjective commentary or vary your language between runs. Use the exact check labels provided. Only report what you can verify from the document.`;

const CHECKLIST_PROMPT = `Analyze this shop drawing PDF against the following checklist. Each check is PASS or FAIL — no interpretation needed.

## CHECKLIST

### 1. PDF FILENAME FORMAT
- The filename provided must match this pattern: [MM-DD-YYYY] Project Name - Shop Drawing V#.pdf
- Example: [04-02-2026] Rosero Garage - Shop Drawing V2.pdf
- The date must be in brackets in MM-DD-YYYY format (e.g. [04-02-2026])
- Must contain "Shop Drawing" followed by a version like V1, V2, -V1, -V2, etc.
- PASS if the filename follows this convention. FAIL only if the date brackets or Shop Drawing version are completely missing.

### 2. SPELLING ERRORS
- Check ALL text on every page for misspellings
- Known common typos: "Existig"→"Existing", "supllying"→"supplying", "exisitng"→"existing", "Bakclight"→"Backlight", "removility"→"removability", "seperate"→"separate"
- FAIL if any spelling error is found. List each error with the incorrect word, correct word, and page number.

### 3. TBD/PLACEHOLDER TEXT
- Search every page for "TBD" in any field (PRODUCTION #, MRQ, or any other) — TBD is allowed in the Design field, ignore it there
- FAIL if any TBD placeholder is found outside the Design field. List each instance with field name and page number.

### 4. MISSING REQUIRED ELEMENTS — check each individually:
- M|R Walls logo: PASS if present on title page, FAIL if missing
- Project name: PASS if clearly stated, FAIL if missing
- Drawing type (Elevation, Plan, Detail): PASS if identified, FAIL if missing
- Version/revision number: PASS if present, FAIL if missing
- Scale: PASS if indicated, FAIL if missing
- Date: PASS if present, FAIL if missing

### 5. MATERIAL/FINISH CALLOUTS
- Material must specify "Corian Solid Surface" or "Solid Surface": PASS/FAIL
- Color must be specified: PASS/FAIL
- Panel seam note present if multiple panels shown: PASS/FAIL/N/A
- Scales consistent across similar details on same page: PASS/FAIL

### 6. BACKLIT REQUIREMENTS (apply ONLY if the user indicated this is a backlit project — do NOT auto-detect):
- "REQUIRED: M|R Wall needs 3" gap for proper LED light diffusion" note present: PASS/FAIL
- LED access method shown — either a 3" gap OR an access panel: PASS/FAIL
- "removable for LED access" OR "access panel for LED maintenance" OR "glued with silicone for removability" note present: PASS/FAIL
- "Full set of install diagrams will be provided once final shop drawings have been approved" note present: PASS/FAIL
- If NOT a backlit project and no backlit features detected: mark all as N/A

### 7. SITUATIONAL
- If cutouts present: border notes and fabrication note: PASS/FAIL/N/A
- If corners present: butt joint dimension adjustments noted: PASS/FAIL/N/A

### 8. LAYOUT QUALITY
- Pages not overcrowded (text/details legible, not overlapping): PASS/FAIL
- Dimension and leader text sizes consistent: PASS/FAIL
- Scales consistent on same page: PASS/FAIL

## RESPONSE FORMAT

Return ONLY valid JSON. No text before or after. No markdown code blocks. Start with { and end with }

{
  "overallStatus": "pass" | "warning" | "fail",
  "summary": "1-2 sentence factual summary",
  "criticalIssues": [
    {"id": "check_id", "label": "Check Name", "status": "fail", "notes": "Exact finding with location", "page": 1}
  ],
  "warnings": [
    {"id": "check_id", "label": "Check Name", "status": "warning", "notes": "What needs review", "page": 2}
  ],
  "passed": [
    {"id": "check_id", "label": "Check Name", "status": "pass", "notes": "Confirmed present/correct"}
  ],
  "pageCount": 4
}

Rules:
- overallStatus is "fail" if ANY critical issue exists, "warning" if only warnings, "pass" if all checks pass
- Use consistent check IDs: spelling, tbd, filename, logo, project_name, drawing_type, version, scale, date, material, color, seam, scale_consistency, led_gap, led_access, led_removable, led_wiring, led_components, led_wattage, led_install_note, cutout_notes, corner_joints, layout_crowding, layout_text, layout_scales
- Do not invent issues that are not evidenced in the document
- For N/A checks (e.g. backlit checks on non-backlit project), omit them entirely from the response`;

// Increased timeout for large PDFs
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { blobUrl, filename, projectType } = body;

    if (!blobUrl) {
      return NextResponse.json({ error: 'No blob URL provided' }, { status: 400 });
    }

    // Fetch PDF from Vercel Blob
    const pdfResponse = await fetch(blobUrl);
    if (!pdfResponse.ok) {
      throw new Error('Failed to fetch PDF from storage');
    }

    const pdfBuffer = await pdfResponse.arrayBuffer();
    const fileSizeMB = pdfBuffer.byteLength / (1024 * 1024);

    console.log(`Processing PDF: ${filename}, Size: ${fileSizeMB.toFixed(2)}MB`);

    const base64 = Buffer.from(pdfBuffer).toString('base64');

    let contextNote = '';
    if (projectType?.isBacklit === true) {
      contextNote += ' BACKLIT: YES — apply all backlit requirement checks.';
    } else {
      contextNote += ' BACKLIT: NO — the designer confirmed this is NOT a backlit wall. SKIP all backlit requirement checks entirely. Do not flag any missing LED notes, gap requirements, or access panel requirements.';
    }
    if (projectType?.hasCutouts) {
      contextNote += ' CUTOUTS: YES — verify cutout border and fabrication notes.';
    } else {
      contextNote += ' CUTOUTS: NO — skip cutout checks.';
    }
    if (projectType?.hasCorners) {
      contextNote += ' CORNERS: YES — check butt joint dimension adjustments.';
    } else {
      contextNote += ' CORNERS: NO — skip corner checks.';
    }

    const messageContent: any[] = [
      {
        type: 'document',
        source: {
          type: 'base64',
          media_type: 'application/pdf',
          data: base64,
        },
      },
      {
        type: 'text',
        text: `FILENAME: ${filename || 'unknown'}\n\n${CHECKLIST_PROMPT}${contextNote ? '\n\nPROJECT CONTEXT:' + contextNote : ''}\n\nOutput ONLY the JSON object. No other text.`,
      },
    ];

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      temperature: 0,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: messageContent,
        },
      ],
    });

    const textContent = response.content.find((block) => block.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      throw new Error('No text response from Claude');
    }

    let results;
    const responseText = textContent.text.trim();

    if (responseText.startsWith('{')) {
      try {
        results = JSON.parse(responseText);
      } catch {
      }
    }

    if (!results) {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          results = JSON.parse(jsonMatch[0]);
        } catch (parseError) {
          console.error('JSON parse error:', parseError);
          throw new Error('Invalid JSON in Claude response');
        }
      }
    }

    if (!results) {
      throw new Error(`Could not parse JSON from Claude response.`);
    }

    return NextResponse.json({
      success: true,
      filename: filename || 'document.pdf',
      results,
    });
  } catch (error) {
    console.error('Analysis error:', error);

    const errorMessage = error instanceof Error ? error.message : 'Analysis failed';

    // Handle credit/billing errors
    if (errorMessage.toLowerCase().includes('credit balance') ||
        errorMessage.toLowerCase().includes('billing')) {
      return NextResponse.json(
        { error: 'Anthropic API credit balance is too low. Please add credits at console.anthropic.com.' },
        { status: 402 }
      );
    }

    // Handle PDF processing errors - likely too large or complex
    if (errorMessage.toLowerCase().includes('could not process pdf') ||
        errorMessage.toLowerCase().includes('invalid_request_error')) {
      return NextResponse.json(
        {
          error: 'PDF too large or complex to process. Please compress in Adobe Acrobat: File → Save As Other → Reduced Size PDF, then try again.'
        },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}
