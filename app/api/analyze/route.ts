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

// Allow longer execution time for large PDFs
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('pdf') as File;
    const projectType = JSON.parse(formData.get('projectType') as string || '{}');

    if (!file) {
      return NextResponse.json({ error: 'No PDF file provided' }, { status: 400 });
    }

    const fileSizeMB = file.size / (1024 * 1024);
    
    // Warn if file is large (over 5MB base64 encoded becomes ~6.7MB)
    if (fileSizeMB > 5) {
      return NextResponse.json({ 
        error: `PDF is ${fileSizeMB.toFixed(1)}MB which is too large. Please compress to under 5MB using smallpdf.com or ilovepdf.com before uploading.`
      }, { status: 413 });
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

    // Build the message content with proper typing
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

    // Call Claude with the PDF
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

    // Extract the text response
    const textContent = response.content.find((block) => block.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      throw new Error('No text response from Claude');
    }

    // Parse JSON from response - try multiple extraction methods
    let results;
    const responseText = textContent.text.trim();
    
    // Method 1: Try parsing the entire response as JSON (ideal case)
    if (responseText.startsWith('{')) {
      try {
        results = JSON.parse(responseText);
      } catch {
        // Fall through to method 2
      }
    }
    
    // Method 2: Extract JSON from response using regex
    if (!results) {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          results = JSON.parse(jsonMatch[0]);
        } catch (parseError) {
          console.error('JSON parse error:', parseError);
          console.error('Attempted to parse:', jsonMatch[0].substring(0, 500));
          throw new Error('Invalid JSON in Claude response');
        }
      }
    }
    
    // Method 3: If still no results, log and throw helpful error
    if (!results) {
      console.error('Claude response (first 1000 chars):', responseText.substring(0, 1000));
      throw new Error(`Could not parse JSON from Claude response. Response started with: "${responseText.substring(0, 100)}"`);
    }

    return NextResponse.json({
      success: true,
      filename: file.name,
      results,
    });
  } catch (error) {
    console.error('Analysis error:', error);
    
    const errorMessage = error instanceof Error ? error.message : 'Analysis failed';
    
    // Handle Anthropic API errors for large files
    if (errorMessage.toLowerCase().includes('forbidden') || 
        errorMessage.toLowerCase().includes('too large') ||
        errorMessage.toLowerCase().includes('request entity too large')) {
      return NextResponse.json(
        { error: 'PDF too large for AI processing. Please compress to under 5MB using smallpdf.com or ilovepdf.com' },
        { status: 413 }
      );
    }
    
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}
