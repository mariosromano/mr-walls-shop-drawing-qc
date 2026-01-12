import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// M|R Walls Shop Drawing QC Checklist - Based on Carlo's actual revision patterns
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

### 3. TITLE BLOCK - Verify:
- "Shop Drawing" as drawing type
- "VERSION 1" or "VERSION 2" (with space)
- "AS NOTED" in scale field
- Project name present
- Project location (City, State)
- M|R Sales Rep with name, phone, email
- Drawn By initials
- Contents field
- Page numbers (SD1, SD2, etc.)

### 4. ELEVATION & DETAILS - Check:
- Border/fade callout (e.g., "3/4" border, grooves fade to full material thickness")
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

## RESPONSE FORMAT - Return ONLY valid JSON:
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
  "manualReview": [
    {"id": "unique_id", "label": "Item Name", "status": "pending", "notes": "What needs human verification"}
  ],
  "projectType": {
    "isBacklit": true,
    "hasCutouts": false,
    "hasCorners": true,
    "hasLogos": false
  },
  "extractedInfo": {
    "projectName": "Detected project name",
    "location": "City, State",
    "version": "VERSION 1",
    "drawnBy": "XX",
    "pageCount": 4
  }
}

Be thorough. Focus on issues Carlo would catch. If something fails, explain exactly what's wrong and where.`;

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('pdf') as File;
    const projectType = JSON.parse(formData.get('projectType') as string || '{}');

    if (!file) {
      return NextResponse.json({ error: 'No PDF file provided' }, { status: 400 });
    }

    // Convert file to base64
    const bytes = await file.arrayBuffer();
    const base64 = Buffer.from(bytes).toString('base64');

    // Build context
    let contextNote = '';
    if (projectType.isBacklit) {
      contextNote += ' This is a BACKLIT wall - check all backlit requirements carefully.';
    }
    if (projectType.hasCutouts) {
      contextNote += ' This has CUTOUTS - verify cutout border and fabrication notes.';
    }
    if (projectType.hasCorners) {
      contextNote += ' This has CORNERS - check butt joint dimension adjustments.';
    }

    // Call Claude with the PDF
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: [
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
              text: `${CHECKLIST_PROMPT}${contextNote ? '\n\nPROJECT CONTEXT:' + contextNote : ''}`,
            },
          ],
        },
      ],
    });

    // Extract the text response
    const textContent = response.content.find((block) => block.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      throw new Error('No text response from Claude');
    }

    // Parse JSON from response
    const jsonMatch = textContent.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('Claude response:', textContent.text);
      throw new Error('Could not parse JSON response from Claude');
    }

    const results = JSON.parse(jsonMatch[0]);

    return NextResponse.json({
      success: true,
      filename: file.name,
      results,
    });
  } catch (error) {
    console.error('Analysis error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Analysis failed' },
      { status: 500 }
    );
  }
}
