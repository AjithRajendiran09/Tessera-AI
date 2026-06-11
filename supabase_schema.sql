-- ============================================================
-- Tessera AI — SaaS Multi-Tenant Supabase Schema
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================

-- 0. Profiles table (linked to Supabase Auth)
CREATE TABLE IF NOT EXISTS profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  email TEXT,
  full_name TEXT,
  research_topic TEXT,           -- e.g. "Runtime AI Governance for Autonomous Agents"
  role TEXT DEFAULT 'user' CHECK (role IN ('admin','user')),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 1. Domains table
CREATE TABLE IF NOT EXISTS domains (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT DEFAULT '#7c5cff',
  icon TEXT DEFAULT '📄',
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, name)
);

-- 2. Research Gaps table
CREATE TABLE IF NOT EXISTS research_gaps (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
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
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  authors TEXT NOT NULL,
  year INTEGER NOT NULL,
  venue TEXT NOT NULL,
  doi TEXT,
  url TEXT,
  domain_id UUID REFERENCES domains(id) ON DELETE SET NULL,
  category TEXT NOT NULL DEFAULT 'Foundation',
  contribution TEXT,
  limitations TEXT[],
  relevance TEXT,
  relevance_score INTEGER DEFAULT 75 CHECK (relevance_score >= 0 AND relevance_score <= 100),
  notes TEXT,
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

-- ============================================================
-- Row Level Security — per-user data isolation
-- ============================================================

-- Helper function to check admin status (SECURITY DEFINER bypasses RLS, preventing recursion)
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- PROFILES
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own profile" ON profiles;
CREATE POLICY "Users can view own profile" ON profiles
  FOR SELECT USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
CREATE POLICY "Users can update own profile" ON profiles
  FOR UPDATE USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can insert own profile" ON profiles;
CREATE POLICY "Users can insert own profile" ON profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

-- Admin can view all profiles (uses safe function to avoid recursion)
DROP POLICY IF EXISTS "Admins can view all profiles" ON profiles;
CREATE POLICY "Admins can view all profiles" ON profiles
  FOR SELECT USING (public.is_admin());

-- DOMAINS
ALTER TABLE domains ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own domains" ON domains;
CREATE POLICY "Users manage own domains" ON domains
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- PAPERS
ALTER TABLE papers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own papers" ON papers;
CREATE POLICY "Users manage own papers" ON papers
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- RESEARCH GAPS
ALTER TABLE research_gaps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own gaps" ON research_gaps;
CREATE POLICY "Users manage own gaps" ON research_gaps
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- PAPER GAPS
ALTER TABLE paper_gaps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own paper_gaps" ON paper_gaps;
CREATE POLICY "Users manage own paper_gaps" ON paper_gaps
  FOR ALL USING (
    EXISTS (SELECT 1 FROM papers WHERE papers.id = paper_gaps.paper_id AND papers.user_id = auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM papers WHERE papers.id = paper_gaps.paper_id AND papers.user_id = auth.uid())
  );

-- ============================================================
-- Auto-create profile on signup via trigger
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    'user'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- Auto-update updated_at on papers
-- ============================================================
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
