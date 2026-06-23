import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
// pdf-parse imported via require to avoid Next.js App Router static analysis issues
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require('pdf-parse/lib/pdf-parse.js');

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const SYSTEM_PROMPT = `You are a deterministic quality control checker for M|R Walls shop drawings. Your job is to evaluate each check independently using exact, binary criteria. Given identical inputs, you must always produce identical outputs. Do not add subjective commentary or vary your language between runs. Use the exact check labels provided. Only report what you can verify from the document.`;

const CHECKLIST_PROMPT = `Analyze this shop drawing PDF against the following checklist. Each check is PASS or FAIL — no interpretation needed.

## CHECKLIST

### 1. PDF FILENAME FORMAT
- The filename provided must match this pattern: [MM-DD-YYYY] Project Name - Shop Drawing V#.pdf
- Example: [04-02-2026] Rosero Garage - Shop Drawing V2.pdf
- The date MUST be in brackets using dashes in MM-DD-YYYY format (e.g. [04-02-2026]). Using dots like [05.12.2026] or malformed dates like [05.12026] are FAIL.
- Must contain "Shop Drawing" followed by " - " (space-dash-space) then version like V1, V2, etc. Example: "Shop Drawing - V1". Any other separator (dash without spaces, period, space only) is FAIL.
- FAIL if: the date format uses dots instead of dashes, the date is missing digits, the brackets are missing, the version separator is not " - " (space-dash-space), or "Shop Drawing" or the version number are absent.
- IMPORTANT: This check evaluates ONLY the filename string — do NOT compare the filename date to any date shown inside the drawing body. They are independent.
- IMPORTANT: The current year is 2026. Dates in 2025 or 2026 are valid and must NOT be flagged as future dates or errors. Do not flag any date as a "future year" unless it is 2027 or later.
- IMPORTANT: The FILENAME PRE-CHECK result injected above this checklist is FINAL. If the pre-check says PASS, you MUST mark this check as passed — do not re-evaluate or override it for any reason.

### 2. SPELLING ERRORS
- Check ALL text on every page for misspellings
- Known common typos to watch for (flag ONLY the misspelled version, never the correct one): "Existig"→"Existing", "supllying"→"supplying", "exisitng"→"existing", "Bakclight"→"Backlight", "removility"→"removability", "seperate"→"separate"
- IMPORTANT: The word "separate" (correctly spelled) is NOT a spelling error. Only flag "seperate" (missing the first 'a').
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
- Project location: PASS if any location or "License" is present ANYWHERE in the drawing — city, state, province, country, or region found in any field or section (including the M|R Sales Rep section or any other header field) counts as PASS. Do NOT fail because the location appears in the "wrong" field. "License" is also an acceptable value. FAIL only if no location information whatsoever can be found anywhere in the document.
- Installer information: An "x" or "X" in the installer field is intentional — it marks where the installer will sign after receiving the drawing. PASS if installer field contains x/X or any name. Only FAIL if the field is completely absent.

### 5. MATERIAL/FINISH CALLOUTS
- Material must specify "Corian Solid Surface" or "Solid Surface": PASS/FAIL
- Color must be specified: PASS/FAIL
- Panel seam note present if multiple panels shown: PASS/FAIL/N/A
- Scales consistent across similar details on same page: PASS/FAIL

### 6. BACKLIT REQUIREMENTS (apply ONLY if the user indicated this is a backlit project — do NOT auto-detect):
- 3" LED gap note present — any note indicating a required 3" gap for LED light diffusion (exact wording varies, e.g. "REQUIRED 3\" gap for light diffusion" or "needs 3\" gap for LED diffusion"): PASS/FAIL
- LED access method shown — either a 3" gap OR a removable/access panel for LED maintenance: PASS/FAIL
- Removable panel or LED access note present — any note indicating panels are removable or provide access for LED maintenance (e.g. "removable panel on left and right side for LED access", "removable for LED access", "access panel", "glued with silicone for removability"): PASS/FAIL
- Install diagrams note present — any note indicating that install/framing diagrams will be provided after shop drawing approval (exact wording varies, e.g. "install diagrams will be provided following shop drawing approval"): PASS/FAIL
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

// Known typos: lowercase key → correct display form
const KNOWN_TYPOS: Record<string, string> = {
  existig: 'Existing',
  supllying: 'supplying',
  exisitng: 'existing',
  bakclight: 'Backlight',
  removility: 'removability',
  seperate: 'separate',
};

interface SpellingError {
  misspelled: string;
  correct: string;
  page: number;
}

// Deterministic spelling checker — runs before Claude to avoid hallucination.
// Extracts raw text from each page and searches for known typos.
// Returns extractionFailed=true if pdf-parse can't read the file; caller falls back to Claude.
async function checkSpellingDeterministic(
  pdfBuffer: ArrayBuffer
): Promise<{ pass: boolean; errors: SpellingError[]; extractionFailed: boolean }> {
  try {
    const buffer = Buffer.from(pdfBuffer);
    const pageTexts: string[] = [];

    await pdfParse(buffer, {
      // Called once per page; accumulate text in order
      pagerender: (pageData: { getTextContent: () => Promise<{ items: { str: string }[] }> }) =>
        pageData.getTextContent().then((tc) => {
          pageTexts.push(tc.items.map((i) => i.str).join(' '));
          return '';
        }),
    });

    const errors: SpellingError[] = [];
    pageTexts.forEach((text, idx) => {
      // Split on whitespace and strip non-alpha characters for comparison
      text.split(/\s+/).forEach((raw) => {
        const clean = raw.replace(/[^a-zA-Z]/g, '').toLowerCase();
        if (KNOWN_TYPOS[clean]) {
          errors.push({ misspelled: raw, correct: KNOWN_TYPOS[clean], page: idx + 1 });
        }
      });
    });

    return { pass: errors.length === 0, errors, extractionFailed: false };
  } catch (err) {
    console.warn('[spelling-precheck] PDF text extraction failed, falling back to Claude:', err);
    return { pass: true, errors: [], extractionFailed: true };
  }
}

// Deterministic filename validator — runs before Claude to avoid hallucination
function validateFilename(filename: string): { pass: boolean; reason: string | null } {
  // Must start with [MM-DD-YYYY] using dashes
  const datePattern = /^\[(\d{2})-(\d{2})-(\d{4})\]/;
  if (!datePattern.test(filename)) {
    const dotDate = /^\[\d{2}\.\d{2}\.\d{4}\]/.test(filename);
    if (dotDate) {
      return { pass: false, reason: 'Date uses dots instead of dashes (e.g. [05.12.2026]). Must be [MM-DD-YYYY].' };
    }
    return { pass: false, reason: 'Date bracket format missing or incorrect. Must start with [MM-DD-YYYY].' };
  }

  // Must contain "Shop Drawing"
  if (!/Shop Drawing/i.test(filename)) {
    return { pass: false, reason: '"Shop Drawing" text is missing from filename.' };
  }

  // Must have a version number with " - " separator (space-dash-space only)
  if (!/ - V\d+/i.test(filename)) {
    return { pass: false, reason: 'Version separator is incorrect. Must use " - " (space-dash-space) before version number, e.g. "Shop Drawing - V1".' };
  }

  return { pass: true, reason: null };
}

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

    // Run deterministic filename check before sending to Claude
    const filenameValidation = validateFilename(filename || '');
    const filenamePreCheck = filenameValidation.pass
      ? 'FILENAME PRE-CHECK RESULT (FINAL — DO NOT OVERRIDE): PASS — The deterministic validator has confirmed the filename date format and version separator are correct. You MUST mark the filename check as passed. Do not re-analyze the filename, do not compare it to dates inside the drawing, and do not flag it as a future year or any other issue. This result is authoritative and final.'
      : `FILENAME PRE-CHECK RESULT (FINAL — DO NOT OVERRIDE): FAIL — ${filenameValidation.reason} You MUST mark the filename check as a critical failure with exactly this reason and no other. Do not modify or expand this finding.`;

    // Run deterministic spelling check before sending to Claude
    const spellingCheck = await checkSpellingDeterministic(pdfBuffer);
    let spellingPreCheck: string;
    if (spellingCheck.extractionFailed) {
      spellingPreCheck = 'SPELLING PRE-CHECK: EXTRACTION FAILED — Claude must perform the spelling check manually using the checklist rules.';
    } else if (spellingCheck.pass) {
      spellingPreCheck = 'SPELLING PRE-CHECK: PASS — text was extracted from the PDF and no known typos were found. Mark the spelling check as passed. Do NOT flag any spelling errors.';
    } else {
      const errorList = spellingCheck.errors
        .map((e) => `Found '${e.misspelled}' instead of '${e.correct}' on page ${e.page}`)
        .join('; ');
      spellingPreCheck = `SPELLING PRE-CHECK: FAIL — deterministic text extraction found the following errors: ${errorList}. Mark the spelling check as a critical failure listing exactly these errors.`;
    }

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
        text: `FILENAME: ${filename || 'unknown'}\n\n${filenamePreCheck}\n\n${spellingPreCheck}\n\n${CHECKLIST_PROMPT}${contextNote ? '\n\nPROJECT CONTEXT:' + contextNote : ''}\n\nOutput ONLY the JSON object. No other text.`,
      },
    ];

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
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
