const API_URL = import.meta.env.VITE_API_URL || (window.location.hostname === 'localhost' ? 'http://localhost:3000/api' : '/api');

async function fetchAPI(endpoint, options = {}) {
  const res = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    }
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
  const formData = new FormData();
  formData.append('pdf', file);
  
  // Render free tier can take 30-60s to wake up, then Gemini takes 10-30s
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);
  
  try {
    const res = await fetch(`${API_URL}/parse-pdf`, {
      method: 'POST',
      body: formData,
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
