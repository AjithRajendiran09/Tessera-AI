import { createClient } from '@supabase/supabase-js';

// ── Supabase Client (for Auth) ──
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ── Backend API Base ──
const API_URL = import.meta.env.VITE_API_URL || (window.location.hostname === 'localhost' ? 'http://localhost:3000/api' : '/api');

// ── Auth Token Helper ──
async function getAuthToken() {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token || null;
}

async function fetchAPI(endpoint, options = {}) {
  const token = await getAuthToken();
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    headers
  });
  if (!res.ok) {
    let rawText = '';
    try {
      rawText = await res.text();
      const errorData = JSON.parse(rawText);
      const msg = errorData.error?.message || errorData.error || `HTTP ${res.status}: ${JSON.stringify(errorData)}`;
      throw new Error(msg);
    } catch (e) {
      if (e.message.includes('HTTP') || (e.message && !e.message.startsWith('Unexpected'))) throw e;
      throw new Error(`HTTP ${res.status}: ${rawText.substring(0, 100)}`);
    }
  }
  // For 204 No Content
  if (res.status === 204) return null;
  const json = await res.json();
  if (json && json.success !== undefined && json.data !== undefined) {
    return json.data;
  }
  return json;
}

// ── AUTH ──
export async function signUp(email, password, fullName) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName }
    }
  });
  if (error) throw error;
  return data;
}

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password
  });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function getSession() {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error) throw error;
  return session;
}

export function onAuthStateChange(callback) {
  return supabase.auth.onAuthStateChange(callback);
}

// ── PROFILE ──
export async function getProfile() {
  return fetchAPI('/profile');
}

export async function updateProfile(updates) {
  return fetchAPI('/profile', {
    method: 'PUT',
    body: JSON.stringify(updates)
  });
}

// ── ADMIN ──
export async function getAdminUsers() {
  return fetchAPI('/admin/users');
}

export async function updateUserRole(userId, role) {
  return fetchAPI(`/admin/users/${userId}/role`, {
    method: 'PUT',
    body: JSON.stringify({ role })
  });
}

export async function deleteUser(userId) {
  return fetchAPI(`/admin/users/${userId}`, {
    method: 'DELETE'
  });
}

// ── WORKSPACES ──
export async function getWorkspaces() {
  return fetchAPI('/workspaces');
}

export async function createWorkspace(workspace) {
  return fetchAPI('/workspaces', {
    method: 'POST',
    body: JSON.stringify(workspace)
  });
}

export async function updateWorkspace(id, updates) {
  return fetchAPI(`/workspaces/${id}`, {
    method: 'PUT',
    body: JSON.stringify(updates)
  });
}

export async function deleteWorkspace(id) {
  return fetchAPI(`/workspaces/${id}`, {
    method: 'DELETE'
  });
}

// ── DOMAINS ──
export async function getDomains(workspaceId) {
  return fetchAPI(workspaceId ? `/domains?workspace_id=${workspaceId}` : '/domains');
}

export async function createDomain(domain) {
  return fetchAPI('/domains', {
    method: 'POST',
    body: JSON.stringify(domain)
  });
}

export async function deleteDomain(id) {
  return fetchAPI(`/domains/${id}`, {
    method: 'DELETE'
  });
}

export async function generateLitReview(domainId) {
  return fetchAPI(`/domains/${domainId}/generate-lit-review`);
}

// ── PAPERS ──
export async function uploadPdf(file, workspaceId) {
  const token = await getAuthToken();
  const formData = new FormData();
  formData.append('pdf', file);
  if (workspaceId) formData.append('workspace_id', workspaceId);
  
  // Render free tier can take 30-60s to wake up, then Gemini takes 10-30s
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);
  
  try {
    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`${API_URL}/parse-pdf`, {
      method: 'POST',
      body: formData,
      headers,
      signal: controller.signal
    });
    clearTimeout(timeout);
    
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP error! status: ${res.status}`);
    }
    return await res.json();
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      throw new Error('Request timed out. The server may be waking up — please try again in 30 seconds.');
    }
    if (err.message === 'Failed to fetch') {
      throw new Error('Cannot reach the server. It may be starting up (takes ~30s on free tier). Please wait and try again.');
    }
    throw err;
  }
}

export async function getPapers(workspaceId) {
  return fetchAPI(workspaceId ? `/papers?workspace_id=${workspaceId}` : '/papers');
}

export async function getPaperById(id) {
  return fetchAPI(`/papers/${id}`);
}

export async function createPaper(paper) {
  return fetchAPI('/papers', {
    method: 'POST',
    body: JSON.stringify(paper)
  });
}

export async function updatePaper(id, updates) {
  return fetchAPI(`/papers/${id}`, {
    method: 'PUT',
    body: JSON.stringify(updates)
  });
}

export async function autofillPaper(id) {
  return fetchAPI(`/papers/${id}/autofill`, {
    method: 'POST'
  });
}

export async function getSemanticScholarData(id) {
  return fetchAPI(`/papers/${id}/semantic-scholar`);
}

export async function previewAutofill(payload) {
  return fetchAPI('/papers/autofill-preview', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export async function deletePaper(id) {
  return fetchAPI(`/papers/${id}`, {
    method: 'DELETE'
  });
}

// ── RESEARCH GAPS ──
export async function getGaps(workspaceId) {
  return fetchAPI(workspaceId ? `/gaps?workspace_id=${workspaceId}` : '/gaps');
}

export async function createGap(gap) {
  return fetchAPI('/gaps', {
    method: 'POST',
    body: JSON.stringify(gap)
  });
}

export async function updateGap(id, updates) {
  return fetchAPI(`/gaps/${id}`, {
    method: 'PUT',
    body: JSON.stringify(updates)
  });
}

export async function deleteGap(id) {
  return fetchAPI(`/gaps/${id}`, {
    method: 'DELETE'
  });
}

// ── PAPER-GAP LINKS ──
export async function linkPaperToGap(paperId, gapId) {
  return fetchAPI('/paper-gaps', {
    method: 'POST',
    body: JSON.stringify({ paper_id: paperId, gap_id: gapId })
  });
}

export async function getGapsForPaper(paperId) {
  return fetchAPI(`/papers/${paperId}/gaps`);
}

// ── DASHBOARD STATS ──
export async function getDashboardStats(workspaceId) {
  return fetchAPI(workspaceId ? `/dashboard/stats?workspace_id=${workspaceId}` : '/dashboard/stats');
}

// ── GENERATE PITCH ──
export async function generatePitch(payload) {
  return fetchAPI('/generate-pitch', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

// ── DISCOVER PAPERS (Scopus Search) ──
export async function discoverPapers(query, options = {}) {
  const params = new URLSearchParams({ query });
  if (options.page) params.set('page', options.page);
  if (options.per_page) params.set('per_page', options.per_page);
  if (options.year_from) params.set('year_from', options.year_from);
  if (options.year_to) params.set('year_to', options.year_to);
  if (options.sort) params.set('sort', options.sort);
  if (options.scopus_only !== undefined) params.set('scopus_only', options.scopus_only);
  if (options.workspace_id) params.set('workspace_id', options.workspace_id);
  return fetchAPI(`/discover?${params.toString()}`);
}

export async function importDiscoveredPaper(paper, workspaceId) {
  return fetchAPI('/discover/import', {
    method: 'POST',
    body: JSON.stringify({ paper, workspace_id: workspaceId })
  });
}

// ── PAPER DRAFT GENERATOR ──
export async function parseExcelForDraft(file, workspaceId, paperType) {
  const token = await getAuthToken();
  const formData = new FormData();
  formData.append('excel', file);
  if (workspaceId) formData.append('workspace_id', workspaceId);
  if (paperType) formData.append('paper_type', paperType);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);

  try {
    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`${API_URL}/paper-draft/parse-excel`, {
      method: 'POST',
      body: formData,
      headers,
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP error! status: ${res.status}`);
    }
    return await res.json();
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      throw new Error('Request timed out. Please try again.');
    }
    throw err;
  }
}

export async function generatePaperDraft(payload) {
  return fetchAPI('/paper-draft/generate', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

// ============================================================
// RESEARCH-GRADE INTELLIGENCE PLATFORM (V2.0)
// ============================================================

// ── Evidence Items & Claims ──
export async function getPaperEvidence(paperId) {
  return fetchAPI(`/papers/${paperId}/evidence`);
}

// ── Human-in-the-Loop Verification ──
export async function verifyEntity({ entity_type, entity_id, action, original_value, correction, notes }) {
  return fetchAPI('/verify', {
    method: 'POST',
    body: JSON.stringify({ entity_type, entity_id, action, original_value, correction, notes })
  });
}

export async function getVerificationHistory(entityId) {
  return fetchAPI(`/verify/history/${entityId}`);
}

// ── Research Gap Engine 2.0 ──
export async function synthesizeGaps({ paper_ids, workspace_id, research_focus }) {
  return fetchAPI('/gaps/synthesize', {
    method: 'POST',
    body: JSON.stringify({ paper_ids, workspace_id, research_focus })
  });
}

export async function getGapEvidence(gapId) {
  return fetchAPI(`/gaps/${gapId}/evidence`);
}

// ── Cross-Paper Synthesis Matrix ──
export async function crossPaperSynthesis({ paper_ids, workspace_id, focus }) {
  return fetchAPI('/synthesis/cross-paper', {
    method: 'POST',
    body: JSON.stringify({ paper_ids, workspace_id, focus })
  });
}

// ── Evidence-Based Research Questions ──
export async function generateResearchQuestions({ gap_id, workspace_id }) {
  return fetchAPI('/research-questions/generate', {
    method: 'POST',
    body: JSON.stringify({ gap_id, workspace_id })
  });
}

export async function getResearchQuestions(params = {}) {
  const q = new URLSearchParams();
  if (params.workspace_id) q.set('workspace_id', params.workspace_id);
  if (params.gap_id) q.set('gap_id', params.gap_id);
  const qs = q.toString() ? `?${q.toString()}` : '';
  return fetchAPI(`/research-questions${qs}`);
}

// ── Research Novelty Assistant ──
export async function evaluateNovelty({ proposed_idea, workspace_id }) {
  return fetchAPI('/novelty/evaluate', {
    method: 'POST',
    body: JSON.stringify({ proposed_idea, workspace_id })
  });
}

// ── Citation & Metadata Verification ──
export async function verifyCitations({ paper_ids }) {
  return fetchAPI('/citations/verify', {
    method: 'POST',
    body: JSON.stringify({ paper_ids })
  });
}

// ── Research Trends Analysis ──
export async function getResearchTrends(workspace_id) {
  const qs = workspace_id ? `?workspace_id=${workspace_id}` : '';
  return fetchAPI(`/trends${qs}`);
}

// ── AI Model Traceability & Prompt Registry ──
export async function getPrompts() {
  return fetchAPI('/prompts');
}

export async function getAiRuns() {
  return fetchAPI('/ai/runs');
}

export async function evaluateAiBenchmark(payload) {
  return fetchAPI('/ai/evaluate', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export async function getAiEvaluations() {
  return fetchAPI('/ai/evaluations');
}

export async function getAuditLogs() {
  return fetchAPI('/audit/logs');
}

// ── Relevance Calibration ──
export async function recalculatePaperRelevance(paperId, researchTopic = '') {
  return fetchAPI(`/papers/${paperId}/recalculate-relevance`, {
    method: 'POST',
    body: JSON.stringify({ research_topic: researchTopic })
  });
}

export async function rescoreWorkspacePapers(workspaceId, researchTopic = '') {
  return fetchAPI(`/workspaces/${workspaceId}/rescore-papers`, {
    method: 'POST',
    body: JSON.stringify({ research_topic: researchTopic })
  });
}

// ── PDF Resolution ──
export async function resolvePaperPdf(paperId) {
  return fetchAPI(`/papers/${paperId}/resolve-pdf`);
}

// ── Abstract Generator ──
export async function generateAbstract({ posterFile, manualTheme, publicationType, wordCount }) {
  const token = await getAuthToken();
  const formData = new FormData();
  if (posterFile) formData.append('poster', posterFile);
  if (manualTheme) formData.append('manualTheme', manualTheme);
  formData.append('publicationType', publicationType || 'ieee-conference');
  formData.append('wordCount', String(wordCount || 250));

  const res = await fetch(`${API_URL}/abstract-generator`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: formData
  });

  if (!res.ok) {
    let rawText = '';
    try {
      rawText = await res.text();
      const errorData = JSON.parse(rawText);
      throw new Error(errorData.error?.message || errorData.error || `HTTP ${res.status}`);
    } catch (e) {
      if (e.message.includes('HTTP') || (e.message && !e.message.startsWith('Unexpected'))) throw e;
      throw new Error(`HTTP ${res.status}: ${rawText.substring(0, 100)}`);
    }
  }
  const json = await res.json();
  if (json && json.success !== undefined && json.data !== undefined) return json.data;
  return json;
}
