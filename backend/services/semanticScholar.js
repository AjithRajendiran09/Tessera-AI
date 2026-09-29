/**
 * Tessera AI — Academic Ground Truth & Semantic Scholar Integration Service
 * 
 * Fetches verified academic metadata (authentic abstract, AI TL;DR summary,
 * citation count, influential citations, fields of study, and open-access PDF links)
 * to ground Gemini LLM synthesis in peer-reviewed factual ground truth.
 * 
 * Includes graceful fallback to OpenAlex for unthrottled abstract reconstruction
 * if Semantic Scholar's public rate limit (429) is temporarily hit.
 */

const s2Cache = new Map();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour in-memory cache

/**
 * Clean and normalize a DOI string.
 * Strips 'https://doi.org/', 'doi:', and whitespace.
 * @param {string} rawDoi
 * @returns {string|null}
 */
function normalizeDoi(rawDoi) {
  if (!rawDoi || typeof rawDoi !== 'string') return null;
  return rawDoi
    .trim()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')
    .replace(/^doi:\s*/i, '')
    .trim();
}

/**
 * Reconstructs a full abstract from OpenAlex's abstract_inverted_index.
 * @param {Object} invertedIndex
 * @returns {string|null}
 */
function reconstructAbstractFromInvertedIndex(invertedIndex) {
  if (!invertedIndex || typeof invertedIndex !== 'object') return null;
  const words = [];
  for (const [word, positions] of Object.entries(invertedIndex)) {
    if (Array.isArray(positions)) {
      for (const pos of positions) {
        words[pos] = word;
      }
    }
  }
  const fullText = words.filter(w => w !== undefined).join(' ').trim();
  return fullText.length > 20 ? fullText : null;
}

/**
 * Fetch paper metadata from OpenAlex as a reliable fallback for abstract and citation count.
 * @param {string} cleanDoi
 * @returns {Promise<Object|null>}
 */
async function fetchOpenAlexFallback(cleanDoi) {
  if (!cleanDoi) return null;
  try {
    const email = process.env.OPENALEX_EMAIL || 'research@tessera.ai';
    const url = `https://api.openalex.org/works/https://doi.org/${encodeURIComponent(cleanDoi)}?mailto=${encodeURIComponent(email)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const work = await res.json();

    const abstract = reconstructAbstractFromInvertedIndex(work.abstract_inverted_index);
    const concepts = (work.concepts || [])
      .filter(c => c.score > 0.4)
      .map(c => c.display_name);

    return {
      abstract,
      citationCount: typeof work.cited_by_count === 'number' ? work.cited_by_count : null,
      fieldsOfStudy: concepts,
      openAccessPdf: work.open_access?.oa_url || null,
      title: work.title || null
    };
  } catch (err) {
    console.warn('[OpenAlex Fallback] Error fetching fallback metadata:', err.message);
    return null;
  }
}

/**
 * Fetch verified paper metadata from Semantic Scholar API.
 * Uses DOI lookup first, then arXiv ID, then title search fallback.
 * Falls back to OpenAlex for abstract reconstruction if S2 is rate-limited or abstract is missing.
 * 
 * @param {Object} params
 * @param {string} [params.doi] - Paper DOI identifier
 * @param {string} [params.title] - Paper Title
 * @param {string} [params.arxivId] - arXiv ID
 * @returns {Promise<Object|null>} Normalized metadata object or null
 */
async function fetchSemanticScholarMetadata({ doi, title, arxivId } = {}) {
  const cleanDoi = normalizeDoi(doi);
  const cacheKey = cleanDoi 
    ? `doi:${cleanDoi.toLowerCase()}` 
    : (title ? `title:${title.trim().toLowerCase()}` : null);

  if (cacheKey && s2Cache.has(cacheKey)) {
    const cached = s2Cache.get(cacheKey);
    if (Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return cached.data;
    }
    s2Cache.delete(cacheKey);
  }

  const apiKey = process.env.SEMANTIC_SCHOLAR_API_KEY;
  const headers = {
    'User-Agent': 'TesseraAI/1.0 (mailto:research@tessera.ai)',
    'Accept': 'application/json'
  };
  if (apiKey) {
    headers['x-api-key'] = apiKey;
  }

  const fields = 'paperId,title,abstract,tldr,fieldsOfStudy,s2FieldsOfStudy,citationCount,influentialCitationCount,openAccessPdf,publicationTypes,year,authors';

  let paperData = null;
  let s2RateLimited = false;

  // 1. Primary: Lookup by DOI in Semantic Scholar
  if (cleanDoi) {
    try {
      const url = `https://api.semanticscholar.org/graph/v1/paper/DOI:${encodeURIComponent(cleanDoi)}?fields=${fields}`;
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(6000) });
      if (res.ok) {
        paperData = await res.json();
      } else if (res.status === 429) {
        s2RateLimited = true;
        console.warn('[Semantic Scholar] Rate limited (429), engaging OpenAlex fallback');
      } else if (res.status !== 404) {
        console.warn(`[Semantic Scholar] DOI query status: ${res.status}`);
      }
    } catch (err) {
      console.warn('[Semantic Scholar] DOI query error:', err.message);
    }
  }

  // 2. Secondary: Lookup by arXiv ID if DOI wasn't found or contains arxiv
  if (!paperData && !s2RateLimited && (arxivId || (cleanDoi && cleanDoi.includes('arxiv')))) {
    const cleanArxiv = arxivId || cleanDoi.replace(/.*arxiv\./i, '');
    try {
      const url = `https://api.semanticscholar.org/graph/v1/paper/ARXIV:${encodeURIComponent(cleanArxiv)}?fields=${fields}`;
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(6000) });
      if (res.ok) {
        paperData = await res.json();
      } else if (res.status === 429) {
        s2RateLimited = true;
      }
    } catch (err) {
      console.warn('[Semantic Scholar] arXiv query error:', err.message);
    }
  }

  // 3. Tertiary: Fallback search by Title if DOI yielded nothing
  if (!paperData && !s2RateLimited && title && title.trim().length > 6) {
    try {
      const cleanTitle = title.replace(/[^\w\s-]/g, ' ').replace(/\s+/g, ' ').trim();
      const url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(cleanTitle)}&limit=1&fields=${fields}`;
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(6000) });
      if (res.ok) {
        const searchRes = await res.json();
        if (searchRes.data && searchRes.data.length > 0) {
          paperData = searchRes.data[0];
        }
      }
    } catch (err) {
      console.warn('[Semantic Scholar] Title search query error:', err.message);
    }
  }

  // Clean S2 fields if found
  let cleanAbstract = paperData?.abstract ? paperData.abstract.trim().replace(/^\s+|\s+$/g, '') : null;
  let tldrText = paperData?.tldr?.text || null;
  let citationCount = typeof paperData?.citationCount === 'number' ? paperData.citationCount : null;
  let influentialCitationCount = typeof paperData?.influentialCitationCount === 'number' ? paperData.influentialCitationCount : null;
  let fosList = (paperData?.fieldsOfStudy || []).filter(Boolean);
  let openAccessPdf = paperData?.openAccessPdf?.url || null;
  let source = 'semantic_scholar';

  // 4. Resilience Fallback: If S2 failed or didn't have abstract, fetch OpenAlex
  if ((!cleanAbstract || s2RateLimited) && cleanDoi) {
    const fallback = await fetchOpenAlexFallback(cleanDoi);
    if (fallback) {
      if (!cleanAbstract && fallback.abstract) cleanAbstract = fallback.abstract;
      if (citationCount === null && fallback.citationCount !== null) citationCount = fallback.citationCount;
      if (fosList.length === 0 && fallback.fieldsOfStudy?.length) fosList = fallback.fieldsOfStudy;
      if (!openAccessPdf && fallback.openAccessPdf) openAccessPdf = fallback.openAccessPdf;
      source = paperData ? 'semantic_scholar+openalex' : 'openalex_fallback';
    }
  }

  if (!cleanAbstract && !tldrText && citationCount === null && fosList.length === 0) {
    return null;
  }

  const result = {
    found: true,
    paperId: paperData?.paperId || null,
    title: paperData?.title || title,
    abstract: cleanAbstract,
    tldr: tldrText,
    citationCount,
    influentialCitationCount,
    fieldsOfStudy: fosList,
    openAccessPdf,
    publicationTypes: paperData?.publicationTypes || [],
    year: paperData?.year || null,
    source,
    fetched_at: new Date().toISOString()
  };

  if (cacheKey) {
    s2Cache.set(cacheKey, { data: result, timestamp: Date.now() });
  }

  return result;
}

module.exports = {
  fetchSemanticScholarMetadata,
  normalizeDoi,
  reconstructAbstractFromInvertedIndex
};
