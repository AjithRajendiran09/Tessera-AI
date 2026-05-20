# ◇ Tessera AI — Research Intelligence Platform

> An AI-powered research paper management and intelligence platform built for PhD scholars, researchers, and academics. Upload a PDF and let Google Gemini extract everything — title, authors, domain, gaps, and more.

*"Tessera" comes from the Latin word for a small tile used to create mosaics. Each paper you add becomes a piece of a larger intellectual mosaic — revealing patterns, gaps, and connections across your field of study.*

---

## 📋 Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Project Structure](#project-structure)
- [Tech Stack](#tech-stack)
- [Features](#features)
- [Prerequisites](#prerequisites)
- [Installation & Setup](#installation--setup)
- [Database Schema](#database-schema)
- [API Reference](#api-reference)
- [AI-Powered PDF Parser](#ai-powered-pdf-parser)
- [Environment Variables](#environment-variables)
- [Usage Guide](#usage-guide)
- [Troubleshooting](#troubleshooting)
- [Author](#author)
- [License](#license)

---

## Overview

Tessera AI transforms the traditionally manual process of literature review into an intelligent, data-driven workflow. It helps you:

- **Organize** papers across custom research domains
- **Analyze** your collection with visual dashboards and interactive charts
- **Extract** metadata automatically from PDFs using Google Gemini AI
- **Discover** research gaps identified by AI from each uploaded paper
- **Export** domain-specific paper collections to Excel for systematic reviews
- **Navigate** seamlessly — click any chart bar to jump to filtered papers

---

## Architecture

```
┌───────────────────────┐       ┌───────────────────────┐       ┌──────────────────┐
│                       │       │                       │       │                  │
│   Frontend (Vite)     │◄─────►│   Backend (Express)   │◄─────►│    Supabase      │
│   localhost:5173      │ REST  │   localhost:3000       │       │   (PostgreSQL)   │
│                       │  API  │                       │       │                  │
│  • Dashboard          │       │  • /api/papers        │       │  • domains       │
│  • Paper Management   │       │  • /api/domains       │       │  • papers        │
│  • Domain Explorer    │       │  • /api/gaps          │       │  • research_gaps │
│  • Research Gaps      │       │  • /api/parse-pdf     │       │  • paper_gaps    │
│  • About Page         │       │  • /api/dashboard     │       │                  │
│                       │       │                       │       │                  │
└───────────────────────┘       └─────────┬─────────────┘       └──────────────────┘
                                          │
                                          │ AI Parsing
                                          ▼
                                 ┌──────────────────┐
                                 │  Google Gemini    │
                                 │  (2.5/2.0 Flash)  │
                                 │                  │
                                 │  PDF → Metadata  │
                                 │  PDF → Gaps      │
                                 │  PDF → Domain    │
                                 └──────────────────┘
```

---

## Project Structure

```
Compliance-by-proxy/
│
├── backend/                       # Node.js + Express API server
│   ├── server.js                  # All routes, Gemini AI integration, retry logic
│   ├── .env                       # Environment variables (secrets — git-ignored)
│   ├── .env.example               # Template for environment variables
│   ├── package.json               # Backend dependencies
│   └── package-lock.json
│
├── frontend/                      # Vite SPA (vanilla JS)
│   ├── index.html                 # Single-page application shell + About page
│   ├── public/
│   │   └── logo.svg               # Custom AR monogram logo (SVG)
│   ├── src/
│   │   ├── api.js                 # HTTP client (calls backend REST API)
│   │   ├── main.js                # App logic: routing, rendering, CRUD, AI auto-fill
│   │   └── styles.css             # Complete dark glassmorphic UI theme
│   └── package.json               # Frontend dependencies
│
├── supabase_schema.sql            # Database schema + seed data (idempotent)
├── .gitignore
└── README.md                      # This file
```

---

## Tech Stack

| Layer        | Technology                    | Purpose                                  |
|:-------------|:------------------------------|:-----------------------------------------|
| **Frontend** | Vite + Vanilla JS + CSS       | SPA with zero framework overhead         |
| **Backend**  | Node.js + Express             | REST API server with AI orchestration    |
| **Database** | Supabase (PostgreSQL)         | Cloud-hosted DB with Row Level Security  |
| **AI**       | Google Gemini (2.5/2.0 Flash) | PDF metadata + research gap extraction   |
| **Upload**   | Multer                        | In-memory PDF file upload handling       |
| **PDF**      | pdf-parse                     | Extract raw text from PDF documents      |
| **Excel**    | SheetJS (xlsx)                | Domain-filtered Excel export             |
| **Fonts**    | Inter + JetBrains Mono        | Modern typography via Google Fonts       |

---

## Features

### 📊 Interactive Dashboard
- **Stats cards**: Total papers, domains, open gaps, read/unread counts
- **Domain bar chart**: Click any bar → navigates to Papers filtered by that domain
- **Publication timeline**: Click any year bar → shows papers from that year
- **Domain overview grid**: Click any card → jumps to Papers filtered by domain
- **Recent papers list**: Click any entry → opens paper detail modal

### 📄 Paper Management
- **Full CRUD**: Add, edit, delete papers
- **AI Auto-fill**: Upload a PDF → Gemini extracts all fields including DOI, URL, and domain
- **Search**: Filter by title, author, contribution, or year
- **Domain filter**: Show papers from a specific research domain
- **Sorting**: By year (↑↓), relevance score, or alphabetical
- **Read/Unread tracking**: Mark papers as read to track progress
- **Paper links**: Direct links to arXiv, DOI, or publisher pages
- **Excel Export**: Download all papers or domain-filtered papers as `.xlsx`

### 🗂️ Smart Domain Management
- **Create custom domains**: Name, emoji icon, hex color, description
- **AI auto-creation**: If a paper doesn't fit any existing domain, the AI suggests and creates a new one automatically
- **Per-domain Excel export**: Each domain card has a "📥 Export to Excel" button
- **Visual stats**: Paper count and average relevance per domain

### 🔬 Research Gap Detection
- **AI-powered**: When you upload a PDF, Gemini identifies 1–3 open research gaps from the paper
- **Auto-created**: Gaps are automatically saved to Supabase with severity, description, and domain linkage
- **Severity levels**: Critical, High, Medium, Low
- **Status tracking**: Open, Investigating, Addressed, Closed
- **Source attribution**: Each gap description notes which paper it was identified from

### ✨ AI-Powered PDF Parser
Upload any academic paper PDF and Gemini extracts:

| Field             | Description                                     |
|:------------------|:------------------------------------------------|
| `title`           | Full paper title                                |
| `authors`         | Comma-separated author names                    |
| `year`            | Publication year                                |
| `venue`           | Conference or journal name                      |
| `doi`             | DOI identifier (auto-detected from text)        |
| `url`             | Paper URL (arXiv, publisher, or constructed from DOI) |
| `domain`          | Best-matching or newly created domain           |
| `contribution`    | 2-3 sentence summary of key contribution        |
| `limitations`     | Array of identified limitations                 |
| `research_gaps`   | 1-3 open research questions with severity       |
| `relevance`       | Relevance to broader research landscape         |
| `relevance_score` | 0-100 estimated relevance score                 |
| `category`        | Paper classification category                   |

**3-model fallback chain**: `gemini-2.5-flash` → `gemini-2.0-flash` → `gemini-2.0-flash-lite`  
Auto-retries on rate limits (429) and server overload (503) with 5-second delays.

### ℹ️ About Page
- Project description and name meaning
- Key capabilities overview
- Technology stack badges
- Developer attribution
- Auto-updating copyright year

---

## Prerequisites

- **Node.js** ≥ 18.x ([download](https://nodejs.org/))
- **npm** ≥ 9.x (included with Node.js)
- **Supabase account** (free tier: [supabase.com](https://supabase.com))
- **Google AI Studio API key** (free: [aistudio.google.com](https://aistudio.google.com))

---

## Installation & Setup

### Step 1: Clone the repository

```bash
git clone <your-repo-url>
cd Compliance-by-proxy
```

### Step 2: Set up Supabase database

1. Go to [supabase.com](https://supabase.com) → create a new project
2. Open **SQL Editor** → **New Query**
3. Copy the entire contents of `supabase_schema.sql` and paste it in
4. Click **Run** — this creates all 4 tables, security policies, triggers, and seeds default domains + research gaps

### Step 3: Configure the backend

```bash
cd backend
npm install
```

Create `backend/.env`:

```env
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_ANON_KEY=your-anon-key-from-supabase-settings-api
GEMINI_API_KEY=your-api-key-from-aistudio.google.com
PORT=3000
```

**Where to find these:**

| Variable           | Location                                               |
|:-------------------|:-------------------------------------------------------|
| `SUPABASE_URL`     | Supabase Dashboard → Settings → API → Project URL      |
| `SUPABASE_ANON_KEY`| Supabase Dashboard → Settings → API → `anon` `public` key |
| `GEMINI_API_KEY`   | [aistudio.google.com](https://aistudio.google.com) → Get API Key → Create |

### Step 4: Set up the frontend

```bash
cd ../frontend
npm install
```

### Step 5: Run both servers

Open **two terminal tabs**:

**Terminal 1 — Backend API:**
```bash
cd backend
node server.js
```
Expected output: `Backend API running on http://localhost:3000`

**Terminal 2 — Frontend Dev Server:**
```bash
cd frontend
npm run dev
```
Expected output: `VITE ready → Local: http://localhost:5173/`

### Step 6: Open the app

Navigate to **http://localhost:5173** in your browser.

---

## Database Schema

### Tables

#### `domains`
| Column       | Type        | Description                              |
|:-------------|:------------|:-----------------------------------------|
| `id`         | UUID (PK)   | Auto-generated unique ID                 |
| `name`       | TEXT UNIQUE  | Domain name (e.g., "Cybersecurity+IoT")  |
| `color`      | TEXT         | Hex color for UI (e.g., `#7c5cff`)       |
| `icon`       | TEXT         | Emoji icon (e.g., 🛡️)                   |
| `description`| TEXT         | What this domain covers                  |
| `created_at` | TIMESTAMPTZ  | Auto-set on creation                    |

#### `papers`
| Column           | Type        | Description                      |
|:-----------------|:------------|:---------------------------------|
| `id`             | UUID (PK)   | Auto-generated unique ID         |
| `title`          | TEXT         | Paper title                      |
| `authors`        | TEXT         | Comma-separated author list      |
| `year`           | INTEGER      | Publication year                 |
| `venue`          | TEXT         | Conference/journal name          |
| `doi`            | TEXT         | Digital Object Identifier        |
| `url`            | TEXT         | Link to paper                    |
| `domain_id`      | UUID (FK)    | References `domains.id`         |
| `category`       | TEXT         | Classification category          |
| `contribution`   | TEXT         | Key technical contribution       |
| `limitations`    | TEXT[]       | Array of limitation strings      |
| `relevance`      | TEXT         | Relevance to research landscape  |
| `relevance_score`| INTEGER      | 0–100 relevance score           |
| `notes`          | TEXT         | Personal research notes          |
| `is_read`        | BOOLEAN      | Read tracking                   |
| `created_at`     | TIMESTAMPTZ  | Auto-set                        |
| `updated_at`     | TIMESTAMPTZ  | Auto-updated on modification    |

#### `research_gaps`
| Column       | Type        | Description                                    |
|:-------------|:------------|:-----------------------------------------------|
| `id`         | UUID (PK)   | Auto-generated unique ID                       |
| `title`      | TEXT         | Gap title                                      |
| `description`| TEXT         | Detailed description + source paper attribution |
| `domain_id`  | UUID (FK)    | References `domains.id`                        |
| `severity`   | TEXT         | `critical`, `high`, `medium`, `low`            |
| `status`     | TEXT         | `open`, `investigating`, `addressed`, `closed` |
| `created_at` | TIMESTAMPTZ  | Auto-set                                       |

#### `paper_gaps` (junction table)
| Column     | Type      | Description            |
|:-----------|:----------|:-----------------------|
| `paper_id` | UUID (FK) | References `papers.id` |
| `gap_id`   | UUID (FK) | References `research_gaps.id` |

---

## API Reference

Base URL: `http://localhost:3000/api`

### Domains

| Method | Endpoint         | Description          |
|:-------|:-----------------|:---------------------|
| GET    | `/domains`       | List all domains     |
| POST   | `/domains`       | Create a new domain  |

### Papers

| Method | Endpoint          | Description                      |
|:-------|:------------------|:---------------------------------|
| GET    | `/papers`         | List all papers (with domain join) |
| GET    | `/papers/:id`     | Get single paper                 |
| POST   | `/papers`         | Create a new paper               |
| PUT    | `/papers/:id`     | Update a paper                   |
| DELETE | `/papers/:id`     | Delete a paper                   |

### Research Gaps

| Method | Endpoint      | Description           |
|:-------|:--------------|:----------------------|
| GET    | `/gaps`       | List all gaps (with domain join) |
| POST   | `/gaps`       | Create a new gap      |
| PUT    | `/gaps/:id`   | Update a gap          |

### Paper-Gap Links

| Method | Endpoint              | Description              |
|:-------|:----------------------|:-------------------------|
| POST   | `/paper-gaps`         | Link a paper to a gap    |
| GET    | `/papers/:id/gaps`    | Get all gaps for a paper |

### Dashboard

| Method | Endpoint             | Description                    |
|:-------|:---------------------|:-------------------------------|
| GET    | `/dashboard/stats`   | Aggregated stats for dashboard |

### AI Parser

| Method | Endpoint        | Body              | Description                        |
|:-------|:----------------|:------------------|:-----------------------------------|
| POST   | `/parse-pdf`    | `multipart/form-data` (field: `pdf`) | Upload PDF → AI metadata + auto-create domain & gaps |

---

## Environment Variables

### Backend (`backend/.env`)

| Variable           | Required | Description                          |
|:-------------------|:---------|:-------------------------------------|
| `SUPABASE_URL`     | ✅       | Supabase project URL                |
| `SUPABASE_ANON_KEY`| ✅       | Supabase anonymous/public API key   |
| `GEMINI_API_KEY`   | ✅       | Google AI Studio API key            |
| `PORT`             | ❌       | Server port (default: `3000`)       |

### Gemini API Free Tier Limits

| Limit                  | Value       |
|:-----------------------|:------------|
| Requests per minute    | 10          |
| Requests per day       | 500         |
| Tokens per minute      | 250,000     |
| Context window         | 1M tokens   |

> **Tip:** If you hit rate limits frequently, enable billing on Google AI Studio. Google provides $300 in free credits on first setup.

---

## Usage Guide

### Adding a Paper via AI (Recommended)
1. Click **Papers** → **＋ Add Paper**
2. Click **✨ Auto-fill with AI (PDF)**
3. Select a PDF file from your computer
4. Wait for Gemini to process (10–30 seconds)
5. All fields auto-fill: title, authors, year, venue, DOI, URL, domain, contribution, limitations, relevance
6. Research gaps are **automatically created** in the Gaps module
7. If no existing domain fits, a **new domain is auto-created**
8. Review, adjust if needed, click **💾 Save**

### Adding a Paper Manually
1. Click **Papers** → **＋ Add Paper**
2. Fill in the form fields manually
3. Click **💾 Save**

### Navigating via Dashboard
- Click any **domain bar** in "Papers by Domain" → jumps to Papers filtered by that domain
- Click any **year bar** in "Publication Timeline" → shows papers from that year
- Click any **domain card** → jumps to Papers filtered by that domain
- Click any **recent paper** → opens the paper detail modal

### Exporting Papers to Excel
- **All papers**: Go to Papers page → click **📥 Export**
- **By domain**: Go to Domains page → click **📥 Export to Excel** on any domain card

### Creating a Domain Manually
1. Click **Domains** → **＋ Add Domain**
2. Enter name, emoji icon, hex color, and description
3. Click **💾 Save**

### Tracking a Research Gap Manually
1. Click **Research Gaps** → **＋ Add Gap**
2. Select domain, severity, and describe the gap
3. Click **💾 Save**

---

## Troubleshooting

| Issue | Solution |
|:------|:---------|
| `Supabase credentials not configured` | Ensure `backend/.env` exists with valid `SUPABASE_URL` and `SUPABASE_ANON_KEY` |
| `Could not find table 'public.papers'` | Run `supabase_schema.sql` in your Supabase SQL Editor |
| `Policy already exists` error in SQL | Safe to ignore — schema uses `DROP IF EXISTS` |
| `429 Too Many Requests` on PDF upload | Free tier quota exhausted. Wait 1 min or enable billing on Google AI Studio |
| `503 Service Unavailable` | Gemini servers overloaded. App auto-retries with fallback models |
| `404 Not Found` for a model | Model deprecated. Update `MODELS_TO_TRY` in `server.js` |
| `pdfParse is not a function` | Run `npm install pdf-parse@1.1.1` in the backend directory |
| Port 3000 already in use | Run `lsof -ti :3000 \| xargs kill -9` then restart |
| Frontend can't reach backend | Ensure backend runs on port 3000. Check `api.js` has correct `API_URL` |

---

## Author

**Ajith Rajendiran**  
PhD Researcher

---

## License

ISC

---

© 2026 Ajith Rajendiran. All rights reserved.  
Tessera AI v1.0.0 · Research Intelligence Platform
