-- ============================================================
-- ComplianceLit — Supabase Schema
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================

-- 1. Domains table
CREATE TABLE IF NOT EXISTS domains (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  color TEXT DEFAULT '#7c5cff',
  icon TEXT DEFAULT '📄',
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Research Gaps table
CREATE TABLE IF NOT EXISTS research_gaps (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  domain_id UUID REFERENCES domains(id) ON DELETE SET NULL,
  severity TEXT DEFAULT 'high' CHECK (severity IN ('critical','high','medium','low')),
  status TEXT DEFAULT 'open' CHECK (status IN ('open','investigating','addressed','closed')),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Papers table
CREATE TABLE IF NOT EXISTS papers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  authors TEXT NOT NULL,
  year INTEGER NOT NULL,
  venue TEXT NOT NULL,
  doi TEXT,
  url TEXT,
  domain_id UUID REFERENCES domains(id) ON DELETE SET NULL,
  category TEXT NOT NULL DEFAULT 'Foundation',
  contribution TEXT,
  limitations TEXT[], -- array of strings
  relevance TEXT,
  relevance_score INTEGER DEFAULT 75 CHECK (relevance_score >= 0 AND relevance_score <= 100),
  notes TEXT, -- personal notes
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 4. Paper-Gap linking table (many-to-many)
CREATE TABLE IF NOT EXISTS paper_gaps (
  paper_id UUID REFERENCES papers(id) ON DELETE CASCADE,
  gap_id UUID REFERENCES research_gaps(id) ON DELETE CASCADE,
  PRIMARY KEY (paper_id, gap_id)
);

-- 5. Seed default domains
INSERT INTO domains (name, color, icon, description) VALUES
  ('Runtime AI Governance', '#7c5cff', '🛡️', 'Policy enforcement and runtime safety for AI agents'),
  ('Formal Verification', '#5c8cff', '📐', 'Model checking, temporal logic, and formal methods for agent compliance'),
  ('Provenance & Audit', '#4cda8c', '🔗', 'W3C PROV, audit trails, and traceability for agent workflows'),
  ('Compliance Drift', '#38bdf8', '📊', 'Detection of gradual policy adherence degradation over time'),
  ('Multi-Agent Safety', '#ffb84c', '🤖', 'Safety and governance for distributed multi-agent systems'),
  ('Policy-as-Code', '#c084fc', '📋', 'OPA/Rego, regulatory-to-policy translation, and machine-executable policies'),
  ('Agent Foundations', '#a78bfa', '🏗️', 'Foundational LLM agent architectures: ReAct, tool-use, reasoning'),
  ('Orchestration', '#f472b6', '⚙️', 'Agent orchestration frameworks, MCP, and workflow management')
ON CONFLICT (name) DO NOTHING;

-- 6. Seed default research gaps
INSERT INTO research_gaps (title, description, severity, status, domain_id) VALUES
  ('No Unified Runtime Compliance Architecture', 'No system integrates policy-as-code enforcement, formal verification, provenance, and drift detection into a unified proxy.', 'critical', 'open', (SELECT id FROM domains WHERE name = 'Runtime AI Governance')),
  ('Compliance Drift Detection is Undefined', 'Compliance drift — gradual degradation of policy adherence — has no formal definition, detection methodology, or benchmark.', 'critical', 'open', (SELECT id FROM domains WHERE name = 'Compliance Drift')),
  ('Automated Regulatory-to-Policy Translation', 'All policy-as-code systems require manual authoring. No automatic translation from regulatory text to runtime policies.', 'high', 'open', (SELECT id FROM domains WHERE name = 'Policy-as-Code')),
  ('Multi-Agent Compliance Verification', 'No framework provides runtime compliance verification across agent boundaries with inter-agent policy propagation.', 'high', 'open', (SELECT id FROM domains WHERE name = 'Multi-Agent Safety')),
  ('Provenance-Integrated Policy Enforcement', 'No system uses provenance graphs as input to policy decisions (e.g., deny based on prior session actions).', 'high', 'open', (SELECT id FROM domains WHERE name = 'Provenance & Audit')),
  ('Formal Verification at Scale for Agents', 'Scalable formal verification of compliance properties across distributed, long-running, multi-agent workflows remains unsolved.', 'high', 'open', (SELECT id FROM domains WHERE name = 'Formal Verification')),
  ('Adaptive Compliance Baselines', 'No system learns or adapts compliance baselines from observed agent behavior for detecting normal vs. drifting compliance patterns.', 'medium', 'open', (SELECT id FROM domains WHERE name = 'Compliance Drift'))
ON CONFLICT DO NOTHING;

-- 7. Enable Row Level Security (public read/write for now — add auth later)
ALTER TABLE domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE research_gaps ENABLE ROW LEVEL SECURITY;
ALTER TABLE papers ENABLE ROW LEVEL SECURITY;
ALTER TABLE paper_gaps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all on domains" ON domains;
CREATE POLICY "Allow all on domains" ON domains FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all on research_gaps" ON research_gaps;
CREATE POLICY "Allow all on research_gaps" ON research_gaps FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all on papers" ON papers;
CREATE POLICY "Allow all on papers" ON papers FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all on paper_gaps" ON paper_gaps;
CREATE POLICY "Allow all on paper_gaps" ON paper_gaps FOR ALL USING (true) WITH CHECK (true);

-- 8. Auto-update updated_at on papers
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS papers_updated_at ON papers;
CREATE TRIGGER papers_updated_at
  BEFORE UPDATE ON papers
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();
