import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const CHECKLIST_PROMPT = `You are an expert quality control reviewer for M|R Walls shop drawings. Analyze this PDF and identify issues BEFORE they get to Carlo for review.

## CRITICAL CHECKS (Must Pass)

### 1. SPELLING ERRORS - Look for these exact typos Carlo catches:
- "Existig" → "Existing"
- "supllying" → "supplying"
- "exisitng" → "existing"
- "Bakclight" → "Backlight"
- "removility" → "removability"
- "seperate" → "separate"
- Any other spelling errors in callouts, notes, or labels

### 2. TBD/PLACEHOLDER TEXT - Flag any:
- "PRODUCTION #: TBD"
- "MRQ: TBD"
- "Design: TBD"
- Any field showing "TBD"

### 3. MISSING REQUIRED ELEMENTS:
- M|R Walls logo present
- Project name clearly stated
- Drawing type identified (Elevation, Plan, Detail)
- Version/revision number
- Scale indicated
- Date

### 4. MATERIAL/FINISH CALLOUTS:
- Material: "Corian Solid Surface" or "Solid Surface"
- Color specified
- Panel seam note if applicable
- Scale consistency across similar details

### 5. BACKLIT REQUIREMENTS (if backlit project):
- "REQUIRED: M|R Wall needs 3" gap for proper LED light diffusion"
- Ceiling gap for LED access
- "removable for LED access" OR "glued with silicone for removability"
- Wiring diagram with LED strip spacing
- Component list: receivers, drivers, amplifiers, LED rolls with counts
- "Total Wattage: XXXW"
- "Full set of install diagrams will be provided once final shop drawings have been approved"

### 6. SITUATIONAL:
- Cutouts: Border notes, fabrication note
- Corners: Butt joint dimension adjustments

### 7. LAYOUT:
- Any page overcrowded?
- Consistent dimension/leader text sizes?
- Consistent scales on same page?

## RESPONSE FORMAT

IMPORTANT: Return ONLY valid JSON. No text before or after. No markdown code blocks. Start directly with { and end with }

{
  "overallStatus": "pass" | "warning" | "fail",
  "summary": "Brief 1-2 sentence summary of findings",
  "criticalIssues": [
    {"id": "unique_id", "label": "Issue Name", "status": "fail", "notes": "What's wrong and where", "page": 1}
  ],
  "warnings": [
    {"id": "unique_id", "label": "Warning Name", "status": "warning", "notes": "What to review", "page": 2}
  ],
  "passed": [
    {"id": "unique_id", "label": "Check Name", "status": "pass", "notes": "Brief confirmation"}
  ],
  "pageCount": 4
}

Be thorough. Focus on issues Carlo would catch. If something fails, explain exactly what's wrong and where.`;

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
    if (projectType?.isBacklit) {
      contextNote += ' This is a BACKLIT wall - check all backlit requirements carefully.';
    }
    if (projectType?.hasCutouts) {
      contextNote += ' This has CUTOUTS - verify cutout border and fabrication notes.';
    }
    if (projectType?.hasCorners) {
      contextNote += ' This has CORNERS - check butt joint dimension adjustments.';
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
        text: `${CHECKLIST_PROMPT}${contextNote ? '\n\nPROJECT CONTEXT:' + contextNote : ''}\n\nREMEMBER: Output ONLY the JSON object. No other text.`,
      },
    ];

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
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
          error: 'PDF too large or complex to process. Please compress the PDF (reduce image quality to 150 DPI) and try again. In Preview: File → Export → Quartz Filter → Reduce File Size.'
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
