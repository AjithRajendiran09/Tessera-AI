const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

async function fetchAPI(endpoint, options = {}) {
  const res = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    }
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || `HTTP error! status: ${res.status}`);
  }
  // For 204 No Content
  if (res.status === 204) return null;
  return await res.json();
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

// ── PAPERS ──
export async function uploadPdf(file) {
  const formData = new FormData();
  formData.append('pdf', file);
  
  const res = await fetch(`${API_URL}/parse-pdf`, {
    method: 'POST',
    body: formData
  });
  
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || `HTTP error! status: ${res.status}`);
  }
  return await res.json();
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
