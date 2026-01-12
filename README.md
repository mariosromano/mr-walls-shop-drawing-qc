# M|R Walls Shop Drawing QC

Production-ready quality control tool for M|R Walls shop drawings. Uses Claude AI to analyze PDFs and catch issues before they reach Carlo for review.

## Features

- **PDF Upload**: Drag & drop shop drawing PDFs
- **AI Analysis**: Claude Sonnet reads every page, checks spelling, validates callouts
- **Smart Checks**: Backlit, cutout, corner-specific requirements
- **Instant Results**: ~30 seconds per drawing

## What It Catches

Based on Carlo's actual revision patterns:

| Check Type | Examples |
|------------|----------|
| **Spelling** | Existig→Existing, supllying→supplying, Bakclight→Backlight |
| **Placeholders** | PRODUCTION #: TBD, MRQ: TBD |
| **Backlit** | Missing "removable for LED access", component lists, install note |
| **Formatting** | VERSION1→VERSION 1, scale inconsistency, missing callouts |

## Setup

### 1. Clone & Install

```bash
git clone https://github.com/mariosromano/mr-walls-shop-drawing-qc.git
cd mr-walls-shop-drawing-qc
npm install
```

### 2. Add API Key

Create `.env.local`:
```
ANTHROPIC_API_KEY=sk-ant-api03-xxxxx
```

Get your key at [console.anthropic.com](https://console.anthropic.com/settings/keys)

### 3. Run Locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## Deploy to Vercel

### Option A: Connect GitHub (Recommended)

1. Push this repo to GitHub
2. Go to [vercel.com/new](https://vercel.com/new)
3. Import your GitHub repo
4. Add environment variable: `ANTHROPIC_API_KEY`
5. Deploy

Auto-deploys on every push.

### Option B: Vercel CLI

```bash
npm i -g vercel
vercel
```

Then add `ANTHROPIC_API_KEY` in Vercel dashboard → Settings → Environment Variables.

## Cost

~$0.02-0.05 per PDF analyzed (Claude Sonnet pricing).

## Tech Stack

- Next.js 14
- TypeScript
- Tailwind CSS
- Anthropic Claude API
- Vercel (hosting)

---

Built for M|R Walls
