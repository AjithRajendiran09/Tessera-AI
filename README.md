# ◇ Tessera AI — Research Intelligence Platform

> A multi-tenant, AI-powered SaaS platform for PhD scholars, researchers, and academics. Upload a PDF and let Google Gemini extract everything — title, authors, domain, gaps, and relevance to *your* specific research topic. Then generate literature reviews, elevator pitches, and visualize your entire research landscape.

*"Tessera" comes from the Latin word for a small tile used to create mosaics. Each paper you add becomes a piece of a larger intellectual mosaic — revealing patterns, gaps, and connections across your field of study.*

---

## 📋 Table of Contents

- [Overview](#overview)
- [What's New in v2.0](#whats-new-in-v20)
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
- [Deployment](#deployment)
- [Troubleshooting](#troubleshooting)
- [Author](#author)
- [License](#license)

---

## Overview

Tessera AI transforms the traditionally manual process of literature review into an intelligent, data-driven workflow. It helps you:

- **Register & Login** with secure email-based authentication (Supabase Auth)
- **Personalize** your experience with a research topic that guides AI relevance scoring
- **Organize** papers across custom research domains with per-user data isolation
- **Analyze** your collection with visual dashboards and interactive charts
- **Extract** metadata automatically from PDFs using Google Gemini AI
- **Discover** research gaps identified by AI from each uploaded paper
- **Generate** AI-powered literature reviews and thesis pitch abstracts
- **Visualize** your research landscape with an interactive Knowledge Graph
- **Export** domain-specific paper collections to Excel or Word documents
- **Manage Users** via an admin panel with role-based access control

---

## What's New in v2.0

| Feature | Description |
|:--------|:------------|
| 🔐 **User Authentication** | Register/login with email & password via Supabase Auth |
| 🎯 **Research Topic Onboarding** | New users set their research focus to guide AI scoring |
| 🧠 **Context-Aware AI** | Gemini scores paper relevance based on your specific research topic |
| 👥 **Admin User Management** | Admin panel to view, manage roles, and delete users |
| 🔒 **Multi-Tenant Data Isolation** | Row Level Security (RLS) ensures users only see their own data |
| 👤 **User Profile in Sidebar** | Displays name, role, and logout button |
| 🎯 **Research Topic Badge** | Dashboard shows your research focus, editable anytime |

---

## Architecture

```
┌───────────────────────┐       ┌────────────────────────────┐       ┌──────────────────┐
│                       │       │                            │       │                  │
│   Frontend (Vite)     │◄─────►│   Backend (Express)        │◄─────►│    Supabase      │
│   localhost:5173      │ REST  │   localhost:3000            │       │   (PostgreSQL)   │
│                       │  API  │                            │       │                  │
│  • Auth (Login/Reg)   │       │  • Auth Middleware (JWT)    │       │  • profiles      │
│  • Onboarding         │       │  • /api/profile            │       │  • domains       │
│  • Dashboard + Topic  │       │  • /api/admin/users        │       │  • papers        │
│  • Paper Management   │       │  • /api/papers             │       │  • research_gaps │
│  • Domain Explorer    │       │  • /api/domains            │       │  • paper_gaps    │
│  • Research Gaps      │       │  • /api/gaps               │       │                  │
│  • Knowledge Graph    │       │  • /api/parse-pdf          │       │  Row Level       │
│  • Admin Panel        │       │  • /api/dashboard/stats    │       │  Security (RLS)  │
│  • About Page         │       │  • /api/generate-*         │       │                  │
│                       │       │                            │       │                  │
└───────────────────────┘       └──────────┬─────────────────┘       └──────────────────┘
                                           │
                          Supabase Auth     │  AI Parsing / Generation
                          (JWT Tokens)      ▼
                                   ┌──────────────────┐
                                   │  Google Gemini    │
                                   │  (2.5/2.0 Flash)  │
                                   │                  │
                                   │  PDF → Metadata  │
                                   │  + Research Topic │
                                   │    Context       │
                                   │  Lit Reviews     │
                                   │  Elevator Pitch  │
                                   └──────────────────┘
```

### Auth Flow

```
User Opens App
     │
     ├─ No Session ──► Auth Screen (Login / Register)
     │                      │
     │                      ├─ Register ──► Supabase Auth ──► Auto-create Profile ──► Onboarding
     │                      │
     │                      └─ Login ──► Supabase Auth ──► Check Profile
     │                                                         │
     │                                          ┌──────────────┤
     │                                          │              │
     │                                   No Topic?      Has Topic?
     │                                          │              │
     │                                    Onboarding       App Shell
     │                                     Screen         (Dashboard)
     │
     └─ Has Session ──► Auto-login ──► App Shell
```

---

## Project Structure

```
Tessera-AI/
│
├── backend/                       # Node.js + Express API server
│   ├── server.js                  # Routes, auth middleware, Gemini AI, admin APIs
│   ├── .env                       # Environment variables (secrets — git-ignored)
│   ├── .env.example               # Template for environment variables
│   ├── package.json               # Backend dependencies
│   └── package-lock.json
│
├── frontend/                      # Vite SPA (vanilla JS)
│   ├── index.html                 # SPA shell: auth screens, onboarding, admin, app
│   ├── vercel.json                # Vercel proxy rewrites for deployment
│   ├── .env                       # Frontend env vars (git-ignored)
│   ├── .env.example               # Template for frontend env vars
│   ├── public/
│   │   └── logo.svg               # Custom AR monogram logo (SVG)
│   ├── src/
│   │   ├── api.js                 # Supabase Auth client + REST API with JWT injection
│   │   ├── main.js                # App logic: auth, onboarding, routing, CRUD, admin
│   │   └── styles.css             # Complete dark glassmorphic UI theme
│   └── package.json               # Frontend dependencies
│
├── supabase_schema.sql            # Database schema + RLS policies + triggers
├── .gitignore
└── README.md                      # This file
```

---

## Tech Stack

| Layer        | Technology                    | Purpose                                        |
|:-------------|:------------------------------|:-----------------------------------------------|
| **Frontend** | Vite + Vanilla JS + CSS       | SPA with zero framework overhead               |
| **Backend**  | Node.js + Express             | REST API server with auth + AI orchestration   |
| **Auth**     | Supabase Auth (JWT)           | Email/password authentication + session mgmt   |
| **Database** | Supabase (PostgreSQL)         | Cloud DB with Row Level Security (per-user)    |
| **AI**       | Google Gemini (2.5/2.0 Flash) | Context-aware PDF parsing, lit reviews, pitch  |
| **Graph**    | vis-network                   | Interactive Knowledge Graph visualization      |
| **Upload**   | Multer                        | In-memory PDF file upload handling             |
| **PDF**      | pdf-parse                     | Extract raw text from PDF documents            |
| **Excel**    | SheetJS (xlsx)                | Domain-filtered Excel export                   |
| **Fonts**    | Inter + JetBrains Mono + Outfit | Modern typography via Google Fonts           |

---

## Features

### 🔐 User Authentication
- **Register** with email, password, and full name
- **Login** with email and password
- **Session persistence** — auto-login on browser refresh
- **Logout** from sidebar
- **Per-user data isolation** — each user sees only their own papers, domains, and gaps

### 🎯 Research Topic Onboarding
- After first login, users are prompted to enter their specific research topic
- This topic is stored in the `profiles` table and displayed as a badge on the dashboard
- Editable anytime from the dashboard by clicking the ✏️ edit button
- **Used by Gemini AI** to score paper relevance — papers unrelated to your topic get low scores

### 👥 Admin User Management
- Users with `role = 'admin'` see a **"👥 User Management"** tab in the sidebar
- Admin dashboard shows all registered users with their:
  - Full name, email, research topic
  - Paper count, domain count, gap count
  - Registration date
- Admins can **change user roles** (user ↔ admin) and **delete users**
- Admins cannot delete themselves (safety guard)

### 📊 Interactive Dashboard
- **Stats cards**: Total papers, domains, open gaps, read/unread counts
- **Research topic badge**: Shows your focus area with one-click edit
- **Domain bar chart**: Click any bar → navigates to Papers filtered by that domain
- **Publication timeline**: Click any year bar → shows papers from that year
- **Domain overview grid**: Click any card → jumps to Papers filtered by domain
- **Recent papers list**: Click any entry → opens paper detail modal

### 📄 Paper Management
- **Full CRUD**: Add, edit, delete papers
- **AI Auto-fill**: Upload a PDF → Gemini extracts all fields including DOI, URL, and domain
- **Context-aware scoring**: Relevance scored against your specific research topic
- **Search**: Filter by title, author, contribution, or year
- **Domain filter**: Show papers from a specific research domain
- **Sorting**: By year (↑↓), relevance score, or alphabetical
- **Read/Unread tracking**: Mark papers as read to track progress
- **Paper links**: Direct links to arXiv, DOI, or publisher pages
- **Excel Export**: Download all papers or domain-filtered papers as `.xlsx`

### 🗂️ Smart Domain Management
- **Create custom domains**: Name, emoji icon, hex color, description
- **AI auto-creation**: If a paper doesn't fit any existing domain, the AI suggests and creates a new one
- **Per-domain Excel export**: Each domain card has an "📥 Export" button
- **AI Literature Review**: Each domain card has a "✨ Lit Review" button that generates a full academic review
- **Word export**: Download generated literature reviews as `.doc` Word documents
- **Visual stats**: Paper count and average relevance per domain
- **Delete domains**: Remove domains that are no longer needed

### 🔬 Research Gap Detection & Elevator Pitch
- **AI-powered**: When you upload a PDF, Gemini identifies 1–3 open research gaps
- **Auto-created**: Gaps are automatically saved with severity, description, and domain linkage
- **Severity levels**: Critical, High, Medium, Low
- **Status tracking**: Open, Investigating, Addressed, Closed
- **Source attribution**: Each gap description notes which paper it was identified from
- **Elevator Pitch Generator**: Select 2–3 gaps → AI drafts a professional abstract/introduction
- **Optional idea input**: Describe your proposed solution, or let the AI invent one
- **Word export**: Download your generated pitch as a Word document

### 🕸️ Knowledge Graph
- **Interactive visualization**: Papers, Domains, and Gaps rendered as an interconnected network
- **Color-coded nodes**: Domains (boxes), Papers (dots), Gaps (ellipses) with domain colors
- **Physics engine**: `forceAtlas2Based` layout with smart repulsion for clear cluster visibility
- **Full-screen rendering**: Dedicated page with locked scrolling for touch support
- **Zoom & pan**: Pinch-to-zoom and drag to explore on mobile and desktop

### ✨ AI-Powered PDF Parser (Context-Aware)

Upload any academic paper PDF and Gemini extracts:

| Field             | Description                                         |
|:------------------|:----------------------------------------------------|
| `title`           | Full paper title                                    |
| `authors`         | Comma-separated author names                        |
| `year`            | Publication year                                    |
| `venue`           | Conference or journal name                          |
| `doi`             | DOI identifier (auto-detected from text)            |
| `url`             | Paper URL (arXiv, publisher, or constructed from DOI) |
| `domain`          | Best-matching or newly created domain               |
| `contribution`    | 2-3 sentence summary of key contribution            |
| `limitations`     | Array of identified limitations                     |
| `research_gaps`   | 1-3 open research questions with severity           |
| `relevance`       | How the paper relates to YOUR research topic        |
| `relevance_score` | 0-100 score relative to YOUR research topic         |
| `category`        | Paper classification category                       |

**Context-Aware Scoring Rules:**
- Papers **unrelated** to your research topic → score **0–20**
- Papers with **some overlap** → score **20–50**
- Papers **directly relevant** → score **60–80**
- Papers that are **core contributions** → score **80–100**

**3-model fallback chain**: `gemini-2.5-flash` → `gemini-2.0-flash` → `gemini-2.0-flash-lite`
Auto-retries on rate limits (429) and server overload (503) with 5-second delays.

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
git clone https://github.com/AjithRajendiran09/Tessera-AI.git
cd Tessera-AI
```

### Step 2: Set up Supabase database

1. Go to [supabase.com](https://supabase.com) → create a new project
2. Open **SQL Editor** → **New Query**
3. Copy the entire contents of `supabase_schema.sql` and paste it in
4. Click **Run** — this creates all 5 tables, RLS policies, triggers, and functions

> **Important:** Enable email auth in Supabase Dashboard → **Authentication** → **Providers** → **Email**:
> - **Enable Email provider** → ✅ ON
> - **Confirm email** → ❌ OFF (for development; enable for production)

### Step 3: Configure the backend

```bash
cd backend
npm install
```

Create `backend/.env`:

```env
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
GEMINI_API_KEY=your-api-key-from-aistudio.google.com
PORT=3000
```

### Step 4: Set up the frontend

```bash
cd ../frontend
npm install
```

Create `frontend/.env`:

```env
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

**Where to find these values:**

| Variable                    | Location                                                    |
|:----------------------------|:------------------------------------------------------------|
| `SUPABASE_URL`              | Supabase Dashboard → Settings → API → Project URL           |
| `SUPABASE_ANON_KEY`         | Supabase Dashboard → Settings → API → `anon` `public` key  |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Dashboard → Settings → API → `service_role` key    |
| `GEMINI_API_KEY`            | [aistudio.google.com](https://aistudio.google.com) → Get API Key → Create |

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

### Step 6: Register & Promote to Admin

1. Navigate to **http://localhost:5173** in your browser
2. Click **"Create one"** → Register with email, password, and full name
3. Complete the **Onboarding** by entering your research topic
4. To become admin, run in Supabase SQL Editor:

```sql
UPDATE profiles SET role = 'admin' WHERE email = 'your@email.com';
```

5. Refresh the page — you'll see the **"👥 User Management"** tab in the sidebar

---

## Database Schema

### Tables

#### `profiles` (NEW — linked to Supabase Auth)
| Column          | Type        | Description                                    |
|:----------------|:------------|:-----------------------------------------------|
| `id`            | UUID (PK)   | References `auth.users(id)` — auto-linked      |
| `email`         | TEXT        | User's email address                            |
| `full_name`     | TEXT        | Display name                                    |
| `research_topic`| TEXT        | User's specific research focus (guides AI)      |
| `role`          | TEXT        | `admin` or `user` (default: `user`)             |
| `created_at`    | TIMESTAMPTZ | Auto-set on creation                            |

#### `domains`
| Column       | Type        | Description                              |
|:-------------|:------------|:-----------------------------------------|
| `id`         | UUID (PK)   | Auto-generated unique ID                 |
| `user_id`    | UUID (FK)   | Owner — references `auth.users(id)`      |
| `name`       | TEXT         | Domain name (unique per user)            |
| `color`      | TEXT         | Hex color for UI (e.g., `#7c5cff`)       |
| `icon`       | TEXT         | Emoji icon (e.g., 🛡️)                   |
| `description`| TEXT         | What this domain covers                  |
| `created_at` | TIMESTAMPTZ  | Auto-set on creation                    |

#### `papers`
| Column           | Type        | Description                      |
|:-----------------|:------------|:---------------------------------|
| `id`             | UUID (PK)   | Auto-generated unique ID         |
| `user_id`        | UUID (FK)   | Owner — references `auth.users(id)` |
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
| `relevance`      | TEXT         | Relevance to user's research topic |
| `relevance_score`| INTEGER      | 0–100 relevance score           |
| `notes`          | TEXT         | Personal research notes          |
| `is_read`        | BOOLEAN      | Read tracking                   |
| `created_at`     | TIMESTAMPTZ  | Auto-set                        |
| `updated_at`     | TIMESTAMPTZ  | Auto-updated on modification    |

#### `research_gaps`
| Column       | Type        | Description                                    |
|:-------------|:------------|:-----------------------------------------------|
| `id`         | UUID (PK)   | Auto-generated unique ID                       |
| `user_id`    | UUID (FK)   | Owner — references `auth.users(id)`            |
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

### Row Level Security (RLS)

All tables have RLS enabled with per-user policies:

| Table          | Policy                                              |
|:---------------|:----------------------------------------------------|
| `profiles`     | Users can view/update/insert own profile only       |
| `profiles`     | Admins can view all profiles (via `is_admin()` fn)  |
| `domains`      | Users manage own domains only                       |
| `papers`       | Users manage own papers only                        |
| `research_gaps`| Users manage own gaps only                          |
| `paper_gaps`   | Users manage links for own papers only              |

### Triggers & Functions

| Trigger/Function       | Purpose                                            |
|:-----------------------|:---------------------------------------------------|
| `handle_new_user()`    | Auto-creates a `profiles` row on user registration |
| `update_updated_at()`  | Auto-updates `papers.updated_at` on modification   |
| `is_admin()`           | SECURITY DEFINER function for admin check (avoids RLS recursion) |

---

## API Reference

Base URL: `http://localhost:3000/api`

> **Note:** All endpoints except `/health` require a `Authorization: Bearer <token>` header.

### Authentication & Profile

| Method | Endpoint        | Auth    | Description                    |
|:-------|:----------------|:--------|:-------------------------------|
| GET    | `/health`       | ❌      | Health check                   |
| GET    | `/profile`      | ✅ User | Get current user's profile     |
| PUT    | `/profile`      | ✅ User | Update name or research topic  |

### Admin (requires `role = 'admin'`)

| Method | Endpoint                  | Auth     | Description                      |
|:-------|:--------------------------|:---------|:---------------------------------|
| GET    | `/admin/users`            | ✅ Admin | List all users with stats        |
| PUT    | `/admin/users/:id/role`   | ✅ Admin | Change a user's role             |
| DELETE | `/admin/users/:id`        | ✅ Admin | Delete a user and all their data |

### Domains

| Method | Endpoint                            | Auth    | Description                                 |
|:-------|:------------------------------------|:--------|:--------------------------------------------|
| GET    | `/domains`                          | ✅ User | List user's domains                         |
| POST   | `/domains`                          | ✅ User | Create a new domain                         |
| DELETE | `/domains/:id`                      | ✅ User | Delete a domain                             |
| GET    | `/domains/:id/generate-lit-review`  | ✅ User | AI-generated literature review for a domain |

### Papers

| Method | Endpoint          | Auth    | Description                        |
|:-------|:------------------|:--------|:-----------------------------------|
| GET    | `/papers`         | ✅ User | List user's papers (with domain)   |
| GET    | `/papers/:id`     | ✅ User | Get single paper                   |
| POST   | `/papers`         | ✅ User | Create a new paper                 |
| PUT    | `/papers/:id`     | ✅ User | Update a paper                     |
| DELETE | `/papers/:id`     | ✅ User | Delete a paper                     |

### Research Gaps

| Method | Endpoint      | Auth    | Description                      |
|:-------|:--------------|:--------|:---------------------------------|
| GET    | `/gaps`       | ✅ User | List user's gaps (with domain)   |
| POST   | `/gaps`       | ✅ User | Create a new gap                 |
| PUT    | `/gaps/:id`   | ✅ User | Update a gap                     |
| DELETE | `/gaps/:id`   | ✅ User | Delete a gap                     |

### Paper-Gap Links

| Method | Endpoint              | Auth    | Description              |
|:-------|:----------------------|:--------|:-------------------------|
| POST   | `/paper-gaps`         | ✅ User | Link a paper to a gap    |
| GET    | `/papers/:id/gaps`    | ✅ User | Get all gaps for a paper |

### AI Features

| Method | Endpoint                            | Auth    | Description                                          |
|:-------|:------------------------------------|:--------|:-----------------------------------------------------|
| POST   | `/parse-pdf`                        | ✅ User | Upload PDF → AI metadata + context-aware scoring     |
| GET    | `/domains/:id/generate-lit-review`  | ✅ User | Generate AI literature review for a domain           |
| POST   | `/generate-pitch`                   | ✅ User | Generate elevator pitch from selected gaps           |

### Dashboard

| Method | Endpoint             | Auth    | Description                          |
|:-------|:---------------------|:--------|:-------------------------------------|
| GET    | `/dashboard/stats`   | ✅ User | Aggregated stats for user's dashboard |

---

## Environment Variables

### Backend (`backend/.env`)

| Variable                    | Required | Description                                    |
|:----------------------------|:---------|:-----------------------------------------------|
| `SUPABASE_URL`              | ✅       | Supabase project URL                          |
| `SUPABASE_ANON_KEY`         | ✅       | Supabase anonymous/public API key             |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅       | Supabase service role key (bypasses RLS for admin) |
| `GEMINI_API_KEY`            | ✅       | Google AI Studio API key                      |
| `PORT`                      | ❌       | Server port (default: `3000`)                 |

### Frontend (`frontend/.env`)

| Variable              | Required | Description                        |
|:----------------------|:---------|:-----------------------------------|
| `VITE_SUPABASE_URL`   | ✅       | Supabase project URL              |
| `VITE_SUPABASE_ANON_KEY` | ✅    | Supabase anonymous/public API key |

> **Security Note:** The `VITE_` prefix makes these available in browser code. Only use the `anon` key (not the service role key) in the frontend.

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

### Registering & Logging In
1. Navigate to **http://localhost:5173**
2. Click **"Create one"** to register, or sign in with existing credentials
3. On first login, enter your **research topic** (e.g., "Runtime AI Governance for Autonomous Agents")
4. You'll be taken to the dashboard

### Adding a Paper via AI (Recommended)
1. Click **Papers** → **＋ Add Paper**
2. Click **✨ Auto-fill with AI (Upload PDF)**
3. Select a PDF file from your computer
4. Wait for Gemini to process (10–30 seconds)
5. All fields auto-fill — relevance is scored against **your research topic**
6. Research gaps are **automatically created** in the Gaps module
7. If no existing domain fits, a **new domain is auto-created**
8. Review, adjust if needed, click **💾 Save**

### Adding a Paper Manually
1. Click **Papers** → **＋ Add Paper**
2. Fill in the form fields manually
3. Click **💾 Save**

### Generating a Literature Review
1. Click **Domains** → find the domain you want
2. Click **✨ Lit Review** on the domain card
3. Wait ~15 seconds for AI to synthesize all papers in that domain
4. View the formatted review in the modal
5. Click **📄 Download Word** to export as a `.doc` file

### Generating an Elevator Pitch
1. Click **Research Gaps**
2. Check the boxes on 2–3 gaps you want to address in your paper
3. Click **✍️ Generate Pitch**
4. Optionally describe your proposed solution (or leave blank for AI to suggest one)
5. View the generated abstract/introduction
6. Click **📄 Download Word** to export

### Editing Your Research Topic
1. On the **Dashboard**, find the 🎯 research topic badge (top-right)
2. Click the ✏️ edit button
3. Update your topic and click **💾 Save**
4. Future PDF uploads will be scored against the new topic

### Managing Users (Admin Only)
1. Click **👥 User Management** in the sidebar
2. View all registered users and their stats
3. Use the **role dropdown** to promote/demote users
4. Click **🗑** to delete a user and all their data

### Navigating via Dashboard
- Click any **domain bar** in "Papers by Domain" → jumps to Papers filtered by that domain
- Click any **year bar** in "Publication Timeline" → shows papers from that year
- Click any **domain card** → jumps to Papers filtered by that domain
- Click any **recent paper** → opens the paper detail modal

### Exporting Papers to Excel
- **All papers**: Go to Papers page → click **📥 Export**
- **By domain**: Go to Domains page → click **📥 Export** on any domain card

---

## Deployment

### Frontend (Vercel)

1. Push your code to GitHub
2. Import the `frontend/` directory in [Vercel](https://vercel.com)
3. Add environment variables in Vercel Settings → Environment Variables:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
4. Deploy — the `vercel.json` file automatically proxies `/api/*` requests to your Render backend

### Backend (Render)

1. Create a new Web Service on [Render](https://render.com)
2. Set the root directory to `backend/`
3. Build command: `npm install`
4. Start command: `node server.js`
5. Add environment variables:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `GEMINI_API_KEY`

### Supabase Auth Settings (Production)

For production deployment, configure these in Supabase Dashboard → Authentication:
- **Site URL**: Set to your Vercel frontend URL (e.g., `https://tessera-ai.vercel.app`)
- **Redirect URLs**: Add your production URL
- **Confirm email**: Enable for production to verify user emails

---

## Troubleshooting

| Issue | Solution |
|:------|:---------|
| `supabaseUrl is required` | Create `frontend/.env` with `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. **Restart** the Vite dev server after creating it. |
| `Email logins are disabled` | Enable Email provider in Supabase Dashboard → Authentication → Providers → Email |
| `Email not confirmed` | Disable "Confirm email" toggle in Supabase Email provider settings (for dev) |
| `infinite recursion detected in policy for relation "profiles"` | Run the `is_admin()` function fix from `supabase_schema.sql` |
| `Missing or invalid Authorization header` | You're not logged in. Check that the frontend `.env` has correct Supabase credentials |
| `Supabase credentials not configured` | Ensure `backend/.env` exists with valid `SUPABASE_URL` and `SUPABASE_ANON_KEY` |
| `Could not find table 'public.papers'` | Run `supabase_schema.sql` in your Supabase SQL Editor |
| `429 Too Many Requests` on PDF upload | Free tier quota exhausted. Wait 1 min or enable billing on Google AI Studio |
| `503 Service Unavailable` | Gemini servers overloaded. App auto-retries with fallback models |
| Port 3000 already in use | Run `lsof -ti :3000 \| xargs kill -9` then restart |
| Frontend can't reach backend | Ensure backend runs on port 3000. Check `api.js` has correct `API_URL` |
| Admin tab not showing | Run `UPDATE profiles SET role = 'admin' WHERE email = 'your@email.com';` in Supabase SQL Editor, then refresh |
| Knowledge Graph blank on mobile | Ensure you're on the Graph tab; scrolling is locked to prevent canvas misalignment |

---

## Author

**Ajith Rajendiran**
Assistant Professor · Christ Academy Institute for Advanced Studies
PhD Scholar · Alliance University

---

## License

ISC

---

© 2026 Ajith Rajendiran. All rights reserved.
Tessera AI v2.0.0 · Research Intelligence Platform
