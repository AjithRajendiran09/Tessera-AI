-- ============================================================
-- Tessera AI — Research-Grade Database Schema Migration
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================

-- 1. PROMPT VERSIONS TABLE
CREATE TABLE IF NOT EXISTS prompt_versions (
  id TEXT PRIMARY KEY,                       -- e.g. 'paper_analysis_v2', 'gap_detection_v2'
  version INTEGER NOT NULL DEFAULT 1,
  name TEXT NOT NULL,
  description TEXT,
  system_instruction TEXT,
  template TEXT NOT NULL,
  model TEXT DEFAULT 'gemini-2.5-flash',
  parameters JSONB DEFAULT '{"temperature": 0.2, "topP": 0.8}',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. AI ANALYSIS RUNS (Reproducibility & Model Traceability)
CREATE TABLE IF NOT EXISTS ai_analysis_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id UUID REFERENCES workspaces(id) ON DELETE SET NULL,
  paper_id UUID REFERENCES papers(id) ON DELETE CASCADE,
  prompt_version_id TEXT REFERENCES prompt_versions(id) ON DELETE SET NULL,
  model_used TEXT NOT NULL,
  input_type TEXT NOT NULL,                  -- 'pdf_upload', 'gap_detection', 'cross_paper', 'lit_review', 'novelty'
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  latency_ms INTEGER DEFAULT 0,
  confidence_score NUMERIC(5,2) DEFAULT 0.85,
  verification_status TEXT DEFAULT 'ai_generated' CHECK (verification_status IN ('ai_generated', 'ai_suggested', 'human_verified', 'rejected')),
  status TEXT DEFAULT 'completed' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  error_message TEXT,
  raw_response JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. EVIDENCE ITEMS (Traceability: Claim → Page → Section → Quote)
CREATE TABLE IF NOT EXISTS evidence_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  paper_id UUID REFERENCES papers(id) ON DELETE CASCADE,
  run_id UUID REFERENCES ai_analysis_runs(id) ON DELETE SET NULL,
  claim_type TEXT NOT NULL CHECK (claim_type IN ('contribution', 'limitation', 'methodology', 'dataset', 'finding', 'gap', 'result', 'general')),
  claim TEXT NOT NULL,
  page_number INTEGER,
  section TEXT,
  exact_quote TEXT,
  confidence_score NUMERIC(5,2) DEFAULT 0.85,
  confidence_tier TEXT DEFAULT 'HIGH' CHECK (confidence_tier IN ('HIGH', 'MEDIUM', 'LOW', 'REQUIRES_HUMAN_REVIEW')),
  verification_status TEXT DEFAULT 'ai_generated' CHECK (verification_status IN ('ai_generated', 'ai_suggested', 'human_verified', 'rejected')),
  verified_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  verified_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 4. RESEARCH GAP EVIDENCE & HEURISTIC BREAKDOWN
CREATE TABLE IF NOT EXISTS research_gap_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gap_id UUID REFERENCES research_gaps(id) ON DELETE CASCADE,
  paper_id UUID REFERENCES papers(id) ON DELETE CASCADE,
  evidence_item_id UUID REFERENCES evidence_items(id) ON DELETE SET NULL,
  gap_category TEXT CHECK (gap_category IN (
    'Methodological Gap', 'Dataset Gap', 'Evaluation Gap', 'Theoretical Gap',
    'Technology Gap', 'Domain Gap', 'Temporal Gap', 'Geographic Gap',
    'Population Gap', 'Comparative Gap', 'Reproducibility Gap', 'Security/Privacy Gap', 'Other'
  )),
  stance TEXT DEFAULT 'supports' CHECK (stance IN ('supports', 'contradicts', 'addresses')),
  evidence_score INTEGER DEFAULT 50,
  heuristic_breakdown JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 5. HUMAN-IN-THE-LOOP VERIFICATION RECORDS
CREATE TABLE IF NOT EXISTS verification_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('paper', 'evidence_item', 'research_gap', 'contribution', 'limitation', 'finding')),
  entity_id UUID NOT NULL,
  original_ai_value JSONB,
  researcher_correction JSONB,
  final_verified_value JSONB,
  action TEXT NOT NULL CHECK (action IN ('verified', 'edited', 'rejected')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 6. AUDIT LOGS (Security, Injection Attempts & AI Operations)
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,                  -- 'prompt_injection_flagged', 'ai_analysis', 'verification_action', 'file_upload'
  severity TEXT DEFAULT 'info' CHECK (severity IN ('info', 'warn', 'error', 'security')),
  details JSONB DEFAULT '{}',
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 7. NORMALIZED ONTOLOGY TABLES (For Cross-Paper Matrix & Knowledge Graph 2.0)
CREATE TABLE IF NOT EXISTS paper_methods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  paper_id UUID REFERENCES papers(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT,                             -- e.g. 'Deep Learning', 'Reinforcement Learning', 'Symbolic', 'Empirical'
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS paper_datasets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  paper_id UUID REFERENCES papers(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  size TEXT,
  modality TEXT,                             -- e.g. 'Text', 'Tabular', 'Image', 'Multi-modal', 'Code'
  is_synthetic BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS paper_findings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  paper_id UUID REFERENCES papers(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  statement TEXT NOT NULL,
  metric_name TEXT,
  metric_value TEXT,
  baseline_comparison TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 8. RESEARCH QUESTIONS TABLE
CREATE TABLE IF NOT EXISTS research_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  gap_id UUID REFERENCES research_gaps(id) ON DELETE SET NULL,
  question TEXT NOT NULL,
  motivation TEXT,
  existing_approaches TEXT,
  missing_component TEXT,
  suggested_methodology TEXT,
  expected_contribution TEXT,
  evaluation_strategy TEXT,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'investigating', 'completed')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 9. AI EVALUATION & GROUND TRUTH BENCHMARKING
CREATE TABLE IF NOT EXISTS ai_evaluations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  paper_id UUID REFERENCES papers(id) ON DELETE CASCADE,
  ground_truth JSONB NOT NULL,
  ai_prediction JSONB NOT NULL,
  metrics JSONB DEFAULT '{}',                -- { precision, recall, f1, agreement_rate }
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- Migrations: Upgrade Existing Tables
-- ============================================================
ALTER TABLE papers ADD COLUMN IF NOT EXISTS verification_status TEXT DEFAULT 'ai_generated' CHECK (verification_status IN ('ai_generated', 'ai_suggested', 'human_verified', 'rejected'));
ALTER TABLE papers ADD COLUMN IF NOT EXISTS confidence_score NUMERIC(5,2) DEFAULT 0.85;
ALTER TABLE papers ADD COLUMN IF NOT EXISTS confidence_tier TEXT DEFAULT 'HIGH' CHECK (confidence_tier IN ('HIGH', 'MEDIUM', 'LOW', 'REQUIRES_HUMAN_REVIEW'));
ALTER TABLE papers ADD COLUMN IF NOT EXISTS analysis_run_id UUID REFERENCES ai_analysis_runs(id) ON DELETE SET NULL;

ALTER TABLE research_gaps ADD COLUMN IF NOT EXISTS gap_category TEXT DEFAULT 'Methodological Gap';
ALTER TABLE research_gaps ADD COLUMN IF NOT EXISTS severity TEXT DEFAULT 'high' CHECK (severity IN ('critical', 'high', 'medium', 'low'));
ALTER TABLE research_gaps ADD COLUMN IF NOT EXISTS evidence_score INTEGER DEFAULT 50;
ALTER TABLE research_gaps ADD COLUMN IF NOT EXISTS heuristic_breakdown JSONB DEFAULT '{}';
ALTER TABLE research_gaps ADD COLUMN IF NOT EXISTS verification_status TEXT DEFAULT 'ai_generated' CHECK (verification_status IN ('ai_generated', 'ai_suggested', 'human_verified', 'rejected'));
ALTER TABLE research_gaps ADD COLUMN IF NOT EXISTS suggested_direction TEXT;
ALTER TABLE research_gaps ADD COLUMN IF NOT EXISTS supporting_paper_count INTEGER DEFAULT 0;
ALTER TABLE research_gaps ADD COLUMN IF NOT EXISTS contradicting_paper_count INTEGER DEFAULT 0;

-- ============================================================
-- Row Level Security (RLS) Policies
-- ============================================================
ALTER TABLE prompt_versions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read prompt_versions" ON prompt_versions;
CREATE POLICY "Public read prompt_versions" ON prompt_versions FOR SELECT USING (true);
DROP POLICY IF EXISTS "Admin write prompt_versions" ON prompt_versions;
CREATE POLICY "Admin write prompt_versions" ON prompt_versions FOR ALL USING (public.is_admin());

ALTER TABLE ai_analysis_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own ai_analysis_runs" ON ai_analysis_runs;
CREATE POLICY "Users manage own ai_analysis_runs" ON ai_analysis_runs FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

ALTER TABLE evidence_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own evidence_items" ON evidence_items;
CREATE POLICY "Users manage own evidence_items" ON evidence_items FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

ALTER TABLE research_gap_evidence ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own research_gap_evidence" ON research_gap_evidence;
CREATE POLICY "Users manage own research_gap_evidence" ON research_gap_evidence FOR ALL USING (
  EXISTS (SELECT 1 FROM research_gaps WHERE research_gaps.id = research_gap_evidence.gap_id AND research_gaps.user_id = auth.uid())
) WITH CHECK (
  EXISTS (SELECT 1 FROM research_gaps WHERE research_gaps.id = research_gap_evidence.gap_id AND research_gaps.user_id = auth.uid())
);

ALTER TABLE verification_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own verification_records" ON verification_records;
CREATE POLICY "Users manage own verification_records" ON verification_records FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users view own audit_logs" ON audit_logs;
CREATE POLICY "Users view own audit_logs" ON audit_logs FOR SELECT USING (auth.uid() = user_id OR public.is_admin());
DROP POLICY IF EXISTS "System insert audit_logs" ON audit_logs;
CREATE POLICY "System insert audit_logs" ON audit_logs FOR INSERT WITH CHECK (true);

ALTER TABLE paper_methods ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own paper_methods" ON paper_methods;
CREATE POLICY "Users manage own paper_methods" ON paper_methods FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

ALTER TABLE paper_datasets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own paper_datasets" ON paper_datasets;
CREATE POLICY "Users manage own paper_datasets" ON paper_datasets FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

ALTER TABLE paper_findings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own paper_findings" ON paper_findings;
CREATE POLICY "Users manage own paper_findings" ON paper_findings FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

ALTER TABLE research_questions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own research_questions" ON research_questions;
CREATE POLICY "Users manage own research_questions" ON research_questions FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

ALTER TABLE ai_evaluations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own ai_evaluations" ON ai_evaluations;
CREATE POLICY "Users manage own ai_evaluations" ON ai_evaluations FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Indexes for high-speed evidence lookup and analytics
CREATE INDEX IF NOT EXISTS idx_evidence_paper ON evidence_items(paper_id);
CREATE INDEX IF NOT EXISTS idx_evidence_claim_type ON evidence_items(claim_type);
CREATE INDEX IF NOT EXISTS idx_gap_evidence_gap ON research_gap_evidence(gap_id);
CREATE INDEX IF NOT EXISTS idx_ai_runs_paper ON ai_analysis_runs(paper_id);
CREATE INDEX IF NOT EXISTS idx_methods_paper ON paper_methods(paper_id);
CREATE INDEX IF NOT EXISTS idx_datasets_paper ON paper_datasets(paper_id);
CREATE INDEX IF NOT EXISTS idx_findings_paper ON paper_findings(paper_id);
