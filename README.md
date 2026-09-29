<p align="center">
  <img src="frontend/public/logo.svg" alt="Tessera AI Logo" width="80" />
</p>

<h1 align="center">Tessera AI</h1>

<p align="center">
  <strong>AI-Powered Research Intelligence Platform for PhD Scholars</strong>
</p>

<p align="center">
  Organize, analyze, and discover insights across your entire paper collection — powered by Google Gemini AI, Scopus integration, and intelligent knowledge graph visualization.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Frontend-Vite%20+%20Vanilla%20JS-646CFF?style=for-the-badge&logo=vite&logoColor=white" />
  <img src="https://img.shields.io/badge/Backend-Express.js-000000?style=for-the-badge&logo=express&logoColor=white" />
  <img src="https://img.shields.io/badge/Database-Supabase%20(PostgreSQL)-3FCF8E?style=for-the-badge&logo=supabase&logoColor=white" />
  <img src="https://img.shields.io/badge/AI-Google%20Gemini-4285F4?style=for-the-badge&logo=google&logoColor=white" />
</p>

---

## 📋 Table of Contents

- [Overview](#-overview)
- [Features](#-features)
- [Architecture](#-architecture)
- [Tech Stack](#-tech-stack)
- [Project Structure](#-project-structure)
- [Prerequisites](#-prerequisites)
- [Getting Started](#-getting-started)
  - [1. Clone the Repository](#1-clone-the-repository)
  - [2. Supabase Setup](#2-supabase-setup)
  - [3. Backend Setup](#3-backend-setup)
  - [4. Frontend Setup](#4-frontend-setup)
- [Environment Variables](#-environment-variables)
- [Database Schema](#-database-schema)
- [API Reference](#-api-reference)
- [Deployment](#-deployment)
- [Contributing](#-contributing)
- [Author](#-author)
- [License](#-license)

---

## 🧠 Overview

**Tessera AI** is a full-stack, multi-tenant research intelligence platform designed for PhD scholars and academic researchers. It transforms the traditionally fragmented process of literature review into an organized, AI-augmented workflow.

Upload a PDF and let Gemini AI extract structured metadata — title, authors, venue, contribution, limitations, relevance scoring, and research gaps — all automatically categorized into your custom research domains. Discover new papers via live Scopus/OpenAlex API integration, visualize your knowledge landscape with an interactive graph, and generate complete academic paper drafts from Excel data.

---

## ✨ Research-Grade Features

### 📄 Verifiable Evidence Pipeline & Claim Attribution
- **Page-Aware PDF Parsing** — Injects page boundaries (`=== PAGE [X] ===`) during text extraction to guarantee verifiable attribution
- **Verbatim Quote Provenance** — Extracts methodology, dataset, empirical findings, and limitations anchored to specific page numbers and verbatim quotes
- **Evidence Inspector & Drawer** — Scholars can review claims side-by-side with exact verbatim paper quotes and confidence metrics
- **Human-in-the-Loop (HITL) Verification** — Review, confirm, modify, or reject AI extractions with persistent audit trail (`verification_records`)

### 🔬 Research Gap Engine 2.0 & Transparent Heuristics
- **12-Category Gap Synthesis Engine** — Synthesizes gaps across 12 rigorous academic categories (Methodological, Empirical, Theoretical, Evaluation, Scalability, Generalizability, Benchmark, Data Scarcity, Security/Privacy, Ethical/Regulatory, Interdisciplinary, Temporal)
- **Tessera Evidence-Based Heuristic Score (0-100)** — Auditable mathematical scoring with transparent breakdown:
  - Repeated Limitations (+20)
  - Multi-Paper Corroboration (+20)
  - Evidence Recency (+15)
  - Explicit Future Work Statements (+15)
  - Evaluation / Benchmark Deficiency (+10)
  - Consensus vs. Empirical Divergence (+20)
- **Explainable Factor Modals** — Click any gap score to inspect the deterministic mathematical breakdown and justification

### 🧩 Cross-Paper Synthesis & Meta-Analysis
- **Comparative Synthesis Matrix** — Side-by-side matrix contrasting methodologies, datasets, key results, core limitations, and gaps across multiple papers
- **Conflicting Findings Detector** — Automatically identifies empirical contradictions and nuances between studies
- **Underexplored Datasets & Methodological Consensus** — Identifies benchmark oversights and consensus paradigms across your corpus

### 💡 Evidence-Based PhD Research Question Generator
- Formulates publication-grade PhD research questions grounded directly in verified research gaps
- Provides research motivation, missing components, baseline approaches, and suggested experimental/evaluation methodologies

### 🎯 Novelty Evaluation Assistant
- Literature-grounded novelty assessment comparing proposed hypotheses against ingested corpus
- Identifies closest baseline papers, missing literature links, differentiation vectors, and potential peer-review pushbacks

### 📈 Temporal Research Trends & Momentum Visualizer
- Analyzes publication velocity, emerging methodologies, declining techniques, and evolving dataset adoption over time
- Visualizes growth momentum with interactive Chart.js trend visualizations

### 🕸️ Academic Knowledge Graph 2.0
- **Multi-Entity Ontology** — Interactive semantic network connecting Domains, Papers, Methodologies, Datasets, Empirical Findings, and Gaps
- **Directional Typed Edges** — Semantic links (`uses_method`, `evaluated_on`, `reports_finding`, `reveals_gap`, `belongs_to`)
- **Evidence Drawer & Filtering** — Filter by entity types and click any node or edge to inspect provenance, quotes, and connected papers

### 🛡️ Security & Prompt Injection Defense Firewall
- **Document Boundary Isolation** — Untrusted PDF text encapsulated in strict `<UNTRUSTED_ACADEMIC_DOCUMENT_CONTENT>` XML boundaries
- **Regex & Heuristic Scanner** — Detects adversarial instruction overrides, role changes, and delimiter breakouts before invoking LLMs
- **Sliding-Window Rate Limiting** — In-memory rate limiter protecting against DoS and token exhaustion
- **Structured Audit Logging** — Centralized logging for security events, parsing runs, and user verifications

### 📝 Paper Draft Generator & Scopus Engine
- **Excel → Paper** — Upload an Excel spreadsheet with research data and generate a complete academic paper with Chart.js charts
- **Live Scopus & OpenAlex Discovery** — Multi-source discovery with authoritative Q1–Q4 Scopus quartile validation
- **Multi-Format Export** — High-resolution PDF and Word (.docx) downloads with APA, MLA, IEEE, and Chicago styles

---

## 🏗 Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           TESSERA AI CLIENT (Vite / Vanilla JS)                 │
│                                                                                 │
│  ┌───────────────────────┐  ┌────────────────────────┐  ┌────────────────────┐ │
│  │ Knowledge Graph 2.0   │  │ Cross-Paper Synthesis  │  │ Evidence Inspector │ │
│  │ (Vis-Network)         │  │ Matrix & Trends        │  │ & HITL Badges      │ │
│  └───────────────────────┘  └────────────────────────┘  └────────────────────┘ │
└────────────────────────────────────────┬────────────────────────────────────────┘
                                         │ Bearer JWT Auth & Standardized Envelopes
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           EXPRESS REST BACKEND (Node.js)                         │
│                                                                                 │
│  ┌────────────────────────┐  ┌────────────────────────┐  ┌───────────────────┐  │
│  │ Prompt Injection Guard │  │ Page-Aware PDF Parser  │  │ Gap Evidence      │  │
│  │ & Sliding Rate Limiter │  │ & Quote Matcher        │  │ Heuristic Scorer  │  │
│  └────────────────────────┘  └────────────────────────┘  └───────────────────┘  │
│  ┌────────────────────────┐  ┌────────────────────────┐  ┌───────────────────┐  │
│  │ Prompt Version Registry│  │ Cross-Paper Synthesis  │  │ Audit & HITL Log  │  │
│  │ (Declarative Schemas)  │  │ Engine                 │  │ Controller        │  │
│  └────────────────────────┘  └────────────────────────┘  └───────────────────┘  │
└──────────────┬─────────────────────────┬────────────────────────────┬───────────┘
               │                         │                            │
               ▼                         ▼                            ▼
   ┌───────────────────────┐ ┌───────────────────────┐  ┌───────────────────────┐
   │ Google Gemini API     │ │ Academic APIs         │  │ Supabase PostgreSQL   │
   │ (Flash 2.5 Structured)│ │ Scopus, OpenAlex,     │  │ Normalized Evidence,  │
   │ Model Fallbacks       │ │ CrossRef Resolvers    │  │ Gaps, HITL & RLS      │
   └───────────────────────┘ └───────────────────────┘  └───────────────────────┘
```

---

## 🛠 Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Frontend** | Vite + Vanilla JavaScript | SPA with modular architecture |
| **Styling** | Vanilla CSS (99KB) | Glassmorphism, dark theme, animations |
| **UI Fonts** | Inter, Outfit, JetBrains Mono | Modern typography via Google Fonts |
| **Charts** | Chart.js + vis-network | Data visualization & knowledge graph |
| **PDF Export** | jsPDF + jspdf-autotable | Client-side PDF generation |
| **DOCX Export** | docx + file-saver | Client-side Word document generation |
| **Excel Parsing** | SheetJS (xlsx) | Excel file reading for paper draft |
| **Backend** | Express.js 5 (Node.js) | REST API server |
| **AI Engine** | Google Gemini (2.5 Flash) | Paper analysis, gap detection, drafting |
| **Database** | Supabase (PostgreSQL) | Data storage with RLS policies |
| **Auth** | Supabase Auth | JWT-based authentication |
| **Paper Discovery** | Scopus API + OpenAlex | Academic paper search & import |
| **DOI Resolution** | CrossRef API | ISSN lookup and publisher metadata |
| **PDF Parsing** | pdf-parse | Server-side text extraction from PDFs |
| **File Upload** | Multer | Multipart form handling (20MB limit) |

---

## 📁 Project Structure

```
Tessera-AI/
├── backend/
│   ├── server.js              # Express.js API server (2440 lines)
│   ├── package.json           # Backend dependencies
│   ├── .env                   # Backend environment variables (gitignored)
│   └── .env.example           # Template for backend env vars
│
├── frontend/
│   ├── index.html             # Single-page app HTML (941 lines)
│   ├── vercel.json            # Vercel deployment config (API proxy)
│   ├── package.json           # Frontend dependencies
│   ├── .env                   # Frontend environment variables (gitignored)
│   ├── .env.example           # Template for frontend env vars
│   ├── public/
│   │   ├── logo.svg           # Tessera AI logo
│   │   ├── favicon.svg        # Browser favicon
│   │   └── icons.svg          # SVG icon sprite
│   └── src/
│       ├── main.js            # Core application logic (5089 lines)
│       ├── api.js             # API client module (354 lines)
│       └── styles.css         # Full CSS design system (99KB)
│
├── supabase_schema.sql        # Complete database schema + RLS policies
├── .gitignore
└── README.md
```

---

## 📦 Prerequisites

- **Node.js** ≥ 18.x
- **npm** ≥ 9.x
- A [Supabase](https://supabase.com) project (free tier works)
- A [Google AI Studio](https://aistudio.google.com) API key (for Gemini)
- *(Optional)* A [Scopus/Elsevier API key](https://dev.elsevier.com) for paper discovery
- *(Optional)* An email for [OpenAlex polite pool](https://docs.openalex.org) (higher rate limits)

---

## 🚀 Getting Started

### 1. Clone the Repository

```bash
git clone https://github.com/AjithRajendiran09/Tessera-AI.git
cd Tessera-AI
```

### 2. Supabase Setup

1. Create a new project at [supabase.com](https://supabase.com)
2. Go to **SQL Editor → New Query** and paste the contents of [`supabase_schema.sql`](supabase_schema.sql)
3. Click **Run** — this creates all tables, RLS policies, triggers, and migration scripts
4. Go to **Settings → API** and copy:
   - **Project URL** (e.g., `https://your-project-id.supabase.co`)
   - **anon / public key**
   - **service_role key** (keep this secret — server-side only)

> **Note:** The schema is idempotent — safe to run multiple times. It includes `IF NOT EXISTS` guards and `ADD COLUMN IF NOT EXISTS` migrations.

### 3. Backend Setup

```bash
cd backend

# Install dependencies
npm install

# Create environment file
cp .env.example .env
```

Edit `backend/.env` with your credentials:

```env
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
GEMINI_API_KEY=your-gemini-api-key
PORT=3000

# Optional
SCOPUS_API_KEY=your-scopus-key
OPENALEX_EMAIL=your-email@university.edu
```

Start the server:

```bash
npm start
# Server runs on http://localhost:3000
```

### 4. Frontend Setup

```bash
cd frontend

# Install dependencies
npm install

# Create environment file
cp .env.example .env
```

Edit `frontend/.env`:

```env
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

Start the dev server:

```bash
npm run dev
# App runs on http://localhost:5173
```

> The frontend auto-detects `localhost` and proxies API requests to `http://localhost:3000/api`. In production, the `vercel.json` rewrites handle the proxy.

---

## 🔑 Environment Variables

### Backend (`backend/.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `SUPABASE_URL` | ✅ | Your Supabase project URL |
| `SUPABASE_ANON_KEY` | ✅ | Supabase anonymous/public API key |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | Supabase service role key (bypasses RLS) |
| `GEMINI_API_KEY` | ✅ | Google Gemini AI API key |
| `PORT` | ❌ | Server port (default: `3000`) |
| `SCOPUS_API_KEY` | ❌ | Elsevier Scopus API key for paper discovery |
| `OPENALEX_EMAIL` | ❌ | Email for OpenAlex polite pool (higher rate limits) |

### Frontend (`frontend/.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_SUPABASE_URL` | ✅ | Your Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | ✅ | Supabase anonymous/public API key |

---

## 🗄 Database Schema

The Supabase PostgreSQL schema consists of 6 tables with full Row Level Security:

```
profiles          ← Linked to Supabase Auth (auto-created on signup)
  ├── id (UUID, PK → auth.users)
  ├── email, full_name, research_topic
  └── role (admin | user)

workspaces        ← Per-user research projects
  ├── id (UUID, PK)
  ├── user_id (FK → auth.users)
  ├── name, description, research_topic
  ├── icon, color, is_default
  └── custom_schema (JSONB) — AI extraction field definitions

domains           ← Research categorization
  ├── id (UUID, PK)
  ├── user_id, workspace_id
  └── name, color, icon, description

papers            ← Core paper repository
  ├── id (UUID, PK)
  ├── user_id, workspace_id, domain_id
  ├── title, authors, year, venue, doi, url
  ├── category, contribution, limitations[]
  ├── relevance, relevance_score (0–100)
  ├── publisher, scopus_indexed, quartile
  ├── research_domain, is_read, notes
  └── extended_metadata (JSONB) — deep AI analysis

research_gaps     ← Identified open questions
  ├── id (UUID, PK)
  ├── user_id, workspace_id, domain_id
  ├── title, description
  ├── severity (critical | high | medium | low)
  └── status (open | investigating | addressed | closed)

paper_gaps        ← Many-to-many linking table
  ├── paper_id (FK → papers)
  └── gap_id (FK → research_gaps)
```

### Key Database Features
- **Row Level Security (RLS)** on all tables — users can only access their own data
- **Admin override** via `is_admin()` security definer function
- **Auto-profile creation** via `handle_new_user()` trigger on `auth.users`
- **Auto-updated timestamps** via `update_updated_at()` trigger on `papers` and `workspaces`
- **Cascading deletes** — deleting a user removes all their data

---

## 📡 API Reference

All endpoints are prefixed with `/api` and require Bearer token authentication (except `/api/health`).

### Health
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/health` | Server health check |

### Authentication & Profile
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/profile` | Get current user's profile |
| `PUT` | `/api/profile` | Update profile (full_name, research_topic) |

### Workspaces
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/workspaces` | List user's workspaces (auto-creates default) |
| `POST` | `/api/workspaces` | Create a new workspace |
| `PUT` | `/api/workspaces/:id` | Update a workspace |
| `DELETE` | `/api/workspaces/:id` | Delete workspace + all contained data |

### Domains
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/domains` | List domains (optional `?workspace_id=`) |
| `POST` | `/api/domains` | Create a domain |
| `DELETE` | `/api/domains/:id` | Delete a domain |
| `GET` | `/api/domains/:id/generate-lit-review` | AI-generated literature review for a domain |

### Papers
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/papers` | List papers (optional `?workspace_id=`) |
| `GET` | `/api/papers/:id` | Get a single paper with domain info |
| `POST` | `/api/papers` | Create a paper manually |
| `PUT` | `/api/papers/:id` | Update a paper |
| `DELETE` | `/api/papers/:id` | Delete a paper |
| `POST` | `/api/papers/:id/autofill` | AI auto-fill all assessment fields |
| `POST` | `/api/papers/autofill-preview` | Preview AI auto-fill before saving |

### Research Gaps
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/gaps` | List research gaps (optional `?workspace_id=`) |
| `POST` | `/api/gaps` | Create a research gap |
| `PUT` | `/api/gaps/:id` | Update a research gap |
| `DELETE` | `/api/gaps/:id` | Delete a research gap |

### Paper-Gap Links
| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/paper-gaps` | Link a paper to a gap |
| `GET` | `/api/papers/:id/gaps` | Get all gaps linked to a paper |

### AI Features
| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/parse-pdf` | Upload PDF → AI-extracted structured metadata |
| `POST` | `/api/generate-pitch` | Generate elevator pitch from selected gaps |
| `POST` | `/api/paper-draft/parse-excel` | Parse Excel file for paper draft |
| `POST` | `/api/paper-draft/generate` | Generate complete AI paper draft |

### Discovery
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/discover` | Search Scopus/OpenAlex for papers |
| `POST` | `/api/discover/import` | Import a discovered paper with AI auto-fill |

### Admin (requires admin role)
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/admin/users` | List all users with counts |
| `PUT` | `/api/admin/users/:id/role` | Change user role (admin/user) |
| `DELETE` | `/api/admin/users/:id` | Delete a user account |

---

## 🌐 Deployment

### Frontend — Vercel

The frontend is configured for [Vercel](https://vercel.com) deployment:

1. Connect your GitHub repository to Vercel
2. Set the **Root Directory** to `frontend`
3. Add environment variables:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
4. Deploy — the `vercel.json` automatically rewrites `/api/*` requests to the backend

### Backend — Render

The backend is deployed on [Render](https://render.com):

1. Create a new **Web Service** linked to your repository
2. Set the **Root Directory** to `backend`
3. Set **Build Command**: `npm install`
4. Set **Start Command**: `npm start`
5. Add all backend environment variables
6. Update `frontend/vercel.json` with your Render URL:

```json
{
  "rewrites": [
    {
      "source": "/api/:path*",
      "destination": "https://your-app.onrender.com/api/:path*"
    }
  ]
}
```

> **Note:** Render's free tier has cold starts (~30s). The frontend handles this with a 120-second timeout and user-friendly retry messages.

---

## 🤝 Contributing

Contributions are welcome! To get started:

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Make your changes and commit: `git commit -m "Add your feature"`
4. Push to your branch: `git push origin feature/your-feature`
5. Open a Pull Request

### Development Tips
- The backend uses Gemini model fallback: `gemini-2.5-flash` → `gemini-2.5-flash-lite` → `gemini-flash-latest` → etc.
- Custom extraction schemas are stored as JSONB in the `workspaces` table and passed to the AI prompt
- The frontend uses a global `state` object with reactive re-rendering on data changes

---

## 👤 Author

**Ajith Rajendiran**

---

## 📄 License

This project is licensed under the [ISC License](https://opensource.org/licenses/ISC).
