# M|R Walls Shop Drawing QC - Project Guide

## What This App Does

This is an internal QC (quality control) tool for **M|R Walls**, a company that fabricates custom Corian Solid Surface wall panels. Before shop drawings go to Carlo (the lead reviewer), team members upload the PDF here and Claude AI checks it against a standardized checklist — catching spelling errors, missing callouts, placeholder text, backlit requirements, etc.

**Live URL:** https://mr-walls-shop-drawing-qc.vercel.app
**GitHub:** https://github.com/mariosromano/mr-walls-shop-drawing-qc

## Tech Stack

- **Framework:** Next.js 14 (App Router) with TypeScript
- **Styling:** Tailwind CSS (dark theme, black background, orange/pink accent gradients)
- **AI:** Anthropic Claude Sonnet API (`@anthropic-ai/sdk`) for PDF analysis
- **Storage:** Vercel Blob for PDF uploads (client-side upload bypasses serverless body limits)
- **PDF Compression:** `pdf-lib` for client-side PDF metadata stripping/compression
- **Icons:** `lucide-react`
- **Hosting:** Vercel (auto-deploys from `main` branch)

## Architecture

```
app/
  page.tsx              # THE main file - entire frontend UI (734 lines, single component)
  layout.tsx            # Root layout with metadata
  globals.css           # Tailwind base styles (8 lines)
  api/
    upload/route.ts     # Vercel Blob upload handler (client-side upload token generation)
    analyze/route.ts    # Core AI logic - sends PDF to Claude with QC checklist prompt
```

This is intentionally a simple, flat architecture. The entire frontend is ONE component in `page.tsx` with a 4-step state machine: `upload` → `questions` → `analyzing` → `results`.

## How the App Works (Data Flow)

1. **Upload:** User drops a PDF. If >25MB, it's compressed client-side via `pdf-lib`. Max 32MB (Anthropic's PDF limit).
2. **Questions:** User toggles project attributes (backlit, cutouts, corners, logos) to enable relevant checks.
3. **Analysis:** PDF uploads to Vercel Blob (client-side, bypasses 4.5MB serverless limit), then `/api/analyze` fetches it, base64-encodes it, and sends it to Claude Sonnet with a detailed checklist prompt.
4. **Results:** Claude returns structured JSON. UI renders pass/warning/fail cards. If no critical issues, user can "Submit for Review" to a named reviewer (currently UI-only, no backend notification).

## Environment Variables

Required in `.env.local` (local dev) and Vercel dashboard (production):

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Claude API key from console.anthropic.com |
| `BLOB_READ_WRITE_TOKEN` | Auto-provisioned by Vercel Blob integration |

**Never commit API keys.** The `.gitignore` already excludes `.env*` files.

## Key Design Decisions

- **Single-file frontend:** All UI is in `page.tsx`. This was intentional — keep it simple. If it grows past ~1000 lines, consider splitting into components.
- **Client-side Blob upload:** PDFs go directly from browser → Vercel Blob, avoiding the 4.5MB serverless body limit. The `/api/upload` route only generates upload tokens.
- **Deterministic AI prompt:** The system prompt in `analyze/route.ts` explicitly tells Claude to be deterministic, use exact check IDs, and return only JSON. `temperature: 0` is set.
- **No database:** Everything is stateless. No user accounts, no saved results. Each analysis is one-shot.
- **"Submit for Review" is UI-only:** Clicking it just shows a confirmation. There's no email/Slack notification yet — that's a planned feature.

## QC Checklist (What Claude Checks)

Defined in `app/api/analyze/route.ts` as `CHECKLIST_PROMPT`. The checks are:

1. **Filename format** — must match `MRQ-####_ProjectName_DrawingType_v#.pdf`
2. **Spelling errors** — common M|R typos like "Existig", "supllying", "Bakclight"
3. **TBD/placeholder text** — any "TBD" in production fields
4. **Required elements** — logo, project name, drawing type, version, scale, date
5. **Material/finish callouts** — "Corian Solid Surface", color, seam notes
6. **Backlit requirements** — LED gap notes, access panels, wiring diagrams, wattage, component lists
7. **Situational** — cutout borders, corner joint adjustments
8. **Layout quality** — overcrowding, text consistency, scale consistency

## Coding Conventions

- **TypeScript** with strict mode
- **Tailwind CSS** for all styling — no CSS modules, no styled-components
- **Color palette:** Black backgrounds (`bg-black`, `bg-gray-900/50`), orange-to-pink gradients for CTAs, emerald for pass, orange for warning, pink for fail
- **No external UI library** — all components are inline in `page.tsx`
- **Lucide icons** only — don't add other icon libraries
- **API routes** use Next.js App Router convention (`app/api/*/route.ts`)

## Running Locally

```bash
npm install
# Create .env.local with ANTHROPIC_API_KEY=sk-ant-...
npm run dev
# Opens at http://localhost:3000
```

## Deploying

Push to `main` branch. Vercel auto-deploys. Make sure environment variables are set in Vercel dashboard.

## Common Tasks for Future Development

- **Add a new QC check:** Edit the `CHECKLIST_PROMPT` string in `app/api/analyze/route.ts` and add corresponding check IDs to the JSON format section.
- **Change the UI layout:** Edit `app/page.tsx` — look for the `// === STEP NAME ===` comment sections.
- **Add email/Slack notifications:** The "Submit for Review" button in the results step currently just sets `submittedTo` state. Wire it to an API route that sends a notification.
- **Add a reviewer dashboard:** Would need a database (Vercel Postgres or similar) to store analysis results.
- **Change the Claude model:** Edit the `model` field in `app/api/analyze/route.ts` (currently `claude-sonnet-4-20250514`).

## File Size Limits

| Limit | Value | Why |
|-------|-------|-----|
| Target compression | 25MB | Triggers client-side compression |
| Max upload | 32MB | Anthropic's PDF document limit |
| Serverless body | 10MB | Set in `next.config.js` (but bypassed via Blob) |
| Vercel function timeout | 60s | Set in `vercel.json` for analyze route |
| `maxDuration` export | 120s | In analyze route.ts (takes precedence on paid plans) |
