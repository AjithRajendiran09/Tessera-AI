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
      throw new Error(errorData.error || `HTTP ${res.status}: ${JSON.stringify(errorData)}`);
    } catch (e) {
      if (e.message.includes('HTTP')) throw e;
      throw new Error(`HTTP ${res.status}: ${rawText.substring(0, 100)}`);
    }
  }
  // For 204 No Content
  if (res.status === 204) return null;
  return await res.json();
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

// ── DOMAINS ──
export async function getDomains() {
  return fetchAPI('/domains');
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
export async function uploadPdf(file) {
  const token = await getAuthToken();
  const formData = new FormData();
  formData.append('pdf', file);
  
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

export async function getPapers() {
  return fetchAPI('/papers');
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

export async function deletePaper(id) {
  return fetchAPI(`/papers/${id}`, {
    method: 'DELETE'
  });
}

// ── RESEARCH GAPS ──
export async function getGaps() {
  return fetchAPI('/gaps');
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
export async function getDashboardStats() {
  return fetchAPI('/dashboard/stats');
}

// ── GENERATE PITCH ──
export async function generatePitch(payload) {
  return fetchAPI('/generate-pitch', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}
