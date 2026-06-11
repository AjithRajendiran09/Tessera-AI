require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const multer = require('multer');
const pdfParse = require('pdf-parse/lib/pdf-parse.js');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const app = express();
app.use(cors({
  origin: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));
app.use(express.json());

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Initialize Supabase clients
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
let supabase;       // anon client (for RLS-aware queries)
let supabaseAdmin;  // service role client (for admin-level queries, bypasses RLS)

if (supabaseUrl && supabaseKey) {
  supabase = createClient(supabaseUrl, supabaseKey);
}
if (supabaseUrl && supabaseServiceKey) {
  supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
}

// Helper to check Supabase configuration
const checkSupabase = (req, res, next) => {
  if (!supabase) {
    return res.status(500).json({ error: 'Supabase credentials not configured on backend.' });
  }
  next();
};

// ── AUTH MIDDLEWARE ──
// Extracts the Bearer token, verifies it with Supabase, and attaches user info to req
async function authenticateUser(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header.' });
  }
  const token = authHeader.split(' ')[1];
  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) {
      return res.status(401).json({ error: 'Invalid or expired token.' });
    }
    req.user = user;
    req.token = token;

    // Create a user-scoped supabase client that respects RLS
    req.supabaseUser = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: `Bearer ${token}` } }
    });

    next();
  } catch (err) {
    console.error('Auth error:', err);
    return res.status(401).json({ error: 'Authentication failed.' });
  }
}

// Admin-only middleware (must come after authenticateUser)
async function requireAdmin(req, res, next) {
  try {
    const client = supabaseAdmin || req.supabaseUser;
    const { data: profile, error } = await client
      .from('profiles')
      .select('role')
      .eq('id', req.user.id)
      .single();
    if (error || !profile || profile.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required.' });
    }
    next();
  } catch (err) {
    return res.status(403).json({ error: 'Admin check failed.' });
  }
}

// ── PROFILE ROUTES ──
app.get('/api/profile', checkSupabase, authenticateUser, async (req, res) => {
  try {
    const { data, error } = await req.supabaseUser
      .from('profiles')
      .select('*')
      .eq('id', req.user.id)
      .single();
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/profile', checkSupabase, authenticateUser, async (req, res) => {
  try {
    const allowedFields = ['full_name', 'research_topic'];
    const updates = {};
    for (const key of allowedFields) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    const { data, error } = await req.supabaseUser
      .from('profiles')
      .update(updates)
      .eq('id', req.user.id)
      .select()
      .single();
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── ADMIN ROUTES ──
app.get('/api/admin/users', checkSupabase, authenticateUser, requireAdmin, async (req, res) => {
  try {
    const client = supabaseAdmin || req.supabaseUser;
    const { data: profiles, error } = await client
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) return res.status(400).json({ error: error.message });

    // Enrich with paper/domain/gap counts
    const enriched = [];
    for (const profile of profiles) {
      const [papersRes, domainsRes, gapsRes] = await Promise.all([
        client.from('papers').select('id', { count: 'exact', head: true }).eq('user_id', profile.id),
        client.from('domains').select('id', { count: 'exact', head: true }).eq('user_id', profile.id),
        client.from('research_gaps').select('id', { count: 'exact', head: true }).eq('user_id', profile.id),
      ]);
      enriched.push({
        ...profile,
        paper_count: papersRes.count || 0,
        domain_count: domainsRes.count || 0,
        gap_count: gapsRes.count || 0,
      });
    }
    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/admin/users/:id/role', checkSupabase, authenticateUser, requireAdmin, async (req, res) => {
  try {
    const { role } = req.body;
    if (!['admin', 'user'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role. Must be "admin" or "user".' });
    }
    const client = supabaseAdmin || req.supabaseUser;
    const { data, error } = await client
      .from('profiles')
      .update({ role })
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/admin/users/:id', checkSupabase, authenticateUser, requireAdmin, async (req, res) => {
  try {
    // Don't allow deleting yourself
    if (req.params.id === req.user.id) {
      return res.status(400).json({ error: 'Cannot delete your own admin account.' });
    }
    const client = supabaseAdmin || req.supabaseUser;
    // Delete the profile (cascade will handle papers/domains/gaps)
    const { error } = await client.from('profiles').delete().eq('id', req.params.id);
    if (error) return res.status(400).json({ error: error.message });
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- USER-SCOPED API ROUTES ---

// DOMAINS
app.get('/api/domains', checkSupabase, authenticateUser, async (req, res) => {
  const { data, error } = await req.supabaseUser.from('domains').select('*').order('name');
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

app.post('/api/domains', checkSupabase, authenticateUser, async (req, res) => {
  const { data, error } = await req.supabaseUser
    .from('domains')
    .insert({ ...req.body, user_id: req.user.id })
    .select()
    .single();
  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json(data);
});

app.delete('/api/domains/:id', checkSupabase, authenticateUser, async (req, res) => {
  const { error } = await req.supabaseUser.from('domains').delete().eq('id', req.params.id);
  if (error) return res.status(400).json({ error: error.message });
  res.status(204).send();
});

app.get('/api/domains/:id/generate-lit-review', checkSupabase, authenticateUser, async (req, res) => {
  try {
    const domainId = req.params.id.trim();
    // Get Domain
    const { data: domain, error: dErr } = await req.supabaseUser.from('domains').select('*').eq('id', domainId).single();
    if (dErr || !domain) {
      console.error('Domain fetch error:', dErr);
      return res.status(404).json({ error: 'Domain not found' });
    }

    // Get Papers
    const { data: papers, error: pErr } = await req.supabaseUser.from('papers').select('*').eq('domain_id', domainId);
    if (pErr) console.error('Papers fetch error:', pErr);
    
    // Get Gaps
    const { data: gaps, error: gErr } = await req.supabaseUser.from('research_gaps').select('*').eq('domain_id', domainId);
    if (gErr) console.error('Gaps fetch error:', gErr);

    if (pErr || !papers || papers.length === 0) {
      console.error('Papers array empty for domain:', domainId, 'Count:', papers?.length, 'Error:', pErr);
      return res.status(400).json({ error: `Not enough papers (${papers?.length || 0}) in this domain to generate a literature review.` });
    }

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

    const papersContext = papers.map(p => `
    Title: ${p.title}
    Authors: ${p.authors} (${p.year})
    Contribution: ${p.contribution}
    Limitations: ${(p.limitations || []).join(', ')}
    `).join('\n');

    const gapsContext = (gaps || []).map(g => `- ${g.title}: ${g.description}`).join('\n');

    const prompt = `
    You are an expert academic researcher writing a literature review section for a thesis or journal paper.
    Write a cohesive, synthesized 3-4 paragraph literature review for the research domain: "${domain.name}".
    
    Use the following papers as your source material. Synthesize their contributions, contrast their approaches, and discuss their limitations. Do not just list them one by one; weave them into a narrative.
    
    Papers:
    ${papersContext}
    
    Also, seamlessly weave in these identified open research gaps as future directions for this field:
    ${gapsContext}
    
    Format the output in clean Markdown (use headings, bold text, and bullet points where appropriate). Do not include any JSON.
    `;

    const result = await callGeminiWithRetry(genAI, prompt);
    res.json({ review: result.response.text() });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// GENERATE PITCH (Elevator Pitch)
app.post('/api/generate-pitch', checkSupabase, authenticateUser, async (req, res) => {
  try {
    const { gapIds, idea } = req.body;
    if (!gapIds || gapIds.length === 0) {
      return res.status(400).json({ error: 'No research gaps provided.' });
    }

    // Fetch the specific gaps
    const { data: gaps, error: gErr } = await req.supabaseUser.from('research_gaps').select('title, description').in('id', gapIds);
    if (gErr || !gaps) throw new Error('Failed to fetch gaps from database');

    const gapsContext = gaps.map(g => `- ${g.title}: ${g.description}`).join('\n');

    const prompt = `
    You are an expert academic researcher writing an "Elevator Pitch" (Abstract / Introduction format) for a brand new PhD paper.
    
    The user wants to write a paper that solves the following Open Research Gaps:
    ${gapsContext}
    
    ${idea ? `The researcher's proposed approach/idea to solve these is:\n"${idea}"` : 'The researcher has not provided a specific approach, so you should invent a plausible, novel, and highly academic approach to solve these gaps.'}
    
    Write a cohesive, synthesized 3-4 paragraph pitch. It should read like the introduction of a high-impact journal paper.
    Format the output in clean Markdown (use headings, bold text, and bullet points where appropriate). Do not include any JSON.
    `;

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const result = await callGeminiWithRetry(genAI, prompt);
    res.json({ pitch: result.response.text() });
  } catch (error) {
    console.error('Pitch generation error:', error);
    res.status(500).json({ error: error.message });
  }
});

// PAPERS
app.get('/api/papers', checkSupabase, authenticateUser, async (req, res) => {
  const { data, error } = await req.supabaseUser
    .from('papers')
    .select('*, domains(name, color, icon)')
    .order('year', { ascending: false });
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

app.get('/api/papers/:id', checkSupabase, authenticateUser, async (req, res) => {
  const { data, error } = await req.supabaseUser
    .from('papers')
    .select('*, domains(name, color, icon)')
    .eq('id', req.params.id)
    .single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

app.post('/api/papers', checkSupabase, authenticateUser, async (req, res) => {
  const { data, error } = await req.supabaseUser
    .from('papers')
    .insert({ ...req.body, user_id: req.user.id })
    .select()
    .single();
  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json(data);
});

app.put('/api/papers/:id', checkSupabase, authenticateUser, async (req, res) => {
  const { data, error } = await req.supabaseUser
    .from('papers')
    .update(req.body)
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

app.delete('/api/papers/:id', checkSupabase, authenticateUser, async (req, res) => {
  const { error } = await req.supabaseUser.from('papers').delete().eq('id', req.params.id);
  if (error) return res.status(400).json({ error: error.message });
  res.status(204).send();
});

// RESEARCH GAPS
app.get('/api/gaps', checkSupabase, authenticateUser, async (req, res) => {
  const { data, error } = await req.supabaseUser
    .from('research_gaps')
    .select('*, domains(name, color, icon)')
    .order('created_at');
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

app.post('/api/gaps', checkSupabase, authenticateUser, async (req, res) => {
  const { data, error } = await req.supabaseUser
    .from('research_gaps')
    .insert({ ...req.body, user_id: req.user.id })
    .select()
    .single();
  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json(data);
});

app.put('/api/gaps/:id', checkSupabase, authenticateUser, async (req, res) => {
  const { data, error } = await req.supabaseUser
    .from('research_gaps')
    .update(req.body)
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

app.delete('/api/gaps/:id', checkSupabase, authenticateUser, async (req, res) => {
  const { error } = await req.supabaseUser.from('research_gaps').delete().eq('id', req.params.id);
  if (error) return res.status(400).json({ error: error.message });
  res.status(204).send();
});

// PAPER-GAP LINKS
app.post('/api/paper-gaps', checkSupabase, authenticateUser, async (req, res) => {
  const { paper_id, gap_id } = req.body;
  const { error } = await req.supabaseUser.from('paper_gaps').insert({ paper_id, gap_id });
  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json({ success: true });
});

app.get('/api/papers/:id/gaps', checkSupabase, authenticateUser, async (req, res) => {
  const { data, error } = await req.supabaseUser
    .from('paper_gaps')
    .select('gap_id, research_gaps(id, title, severity, status)')
    .eq('paper_id', req.params.id);
  if (error) return res.status(400).json({ error: error.message });
  res.json(data.map(d => d.research_gaps));
});

// --- AI PARSER ---
const MODELS_TO_TRY = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.0-flash-lite'];

async function callGeminiWithRetry(genAI, prompt) {
  for (const modelName of MODELS_TO_TRY) {
    try {
      console.log(`Trying model: ${modelName}...`);
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await model.generateContent(prompt);
      console.log(`Success with: ${modelName}`);
      return result;
    } catch (err) {
      const status = err.status || err.httpStatusCode || 0;
      console.log(`${modelName} failed (${status}): ${err.message?.substring(0, 100)}`);
      // Only retry on 429 (rate limit) or 503 (overloaded) — other errors are fatal
      if (status !== 429 && status !== 503) throw err;
      // Wait 5s before trying next model
      await new Promise(r => setTimeout(r, 5000));
    }
  }
  throw new Error('All Gemini models are currently rate-limited. Please wait 1 minute and try again.');
}

app.post('/api/parse-pdf', upload.single('pdf'), checkSupabase, authenticateUser, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No PDF file uploaded.' });
    if (!process.env.GEMINI_API_KEY) return res.status(500).json({ error: 'GEMINI_API_KEY not configured on backend.' });

    // Extract text from PDF
    const pdfData = await pdfParse(req.file.buffer);
    const rawText = pdfData.text.substring(0, 30000);

    // Fetch user's profile to get their research topic
    const { data: profile } = await req.supabaseUser
      .from('profiles')
      .select('research_topic')
      .eq('id', req.user.id)
      .single();
    const researchTopic = profile?.research_topic || '';

    // Fetch existing domains from Supabase for matching (user-scoped)
    let domainList = [];
    const { data: domData } = await req.supabaseUser.from('domains').select('id, name');
    if (domData) domainList = domData;
    const domainNames = domainList.map(d => d.name);

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

    const prompt = `
    You are an expert academic research assistant. Extract the following information from the provided academic paper text.
    Return ONLY a valid JSON object matching this schema exactly. No markdown, no comments.
    {
      "title": "Full title of the paper",
      "authors": "Comma separated list of authors",
      "year": 2024,
      "venue": "Conference or Journal name",
      "doi": "DOI identifier if found in the paper (e.g. 10.1145/xxxxx). Look for patterns like 'doi:', 'DOI:', 'https://doi.org/', or '10.xxxx/'. Return null if not found.",
      "url": "URL to the paper if found (arXiv link, publisher page, etc). Look for patterns like 'https://arxiv.org/abs/', 'https://doi.org/', conference/publisher URLs. If a DOI is found but no direct URL, construct it as 'https://doi.org/<doi>'. Return null if nothing found.",
      "domain": "Best matching domain from this list: [${domainNames.join(', ')}]. If none fit well, suggest a NEW concise domain name (e.g. 'Cybersecurity+IoT', 'Federated Learning', 'NLP Alignment'). Use 2-4 words max.",
      "contribution": "A concise 2-3 sentence summary of the key technical contribution",
      "limitations": ["limitation 1", "limitation 2"],
      "research_gaps": [
        {
          "title": "Short gap title (5-10 words)",
          "description": "1-2 sentence description of the open research question or unresolved challenge identified in or implied by this paper",
          "severity": "One of: critical, high, medium, low"
        }
      ],
      "relevance": "A 1-2 sentence explanation of how this paper relates to the user's specific research topic: '${researchTopic}'. If the paper is NOT relevant to this topic, say: 'This paper is NOT directly relevant to the user\\'s research focus on ${researchTopic}.'",
      "relevance_score": 15,
      "category": "One of: Foundation, Safety & Guardrails, Drift Detection, Provenance, Multi-Agent, Formal Verification"
    }

    IMPORTANT for research_gaps: Identify 1-3 genuine open research questions, unresolved challenges, or future work directions mentioned or implied by the paper. These should be actionable gaps that a PhD researcher could investigate. If the paper doesn't clearly suggest any gaps, return an empty array [].
    
    CRITICAL — USER'S RESEARCH TOPIC: "${researchTopic}"
    The user is a PhD researcher whose specific research focus is: "${researchTopic}".
    
    ABSOLUTE SCORING RULES for relevance_score:
    1. If the paper's topic is NOT directly related to "${researchTopic}", you MUST score it between 0 and 20. Do not deviate.
    2. If the paper has SOME overlap but is not a direct match, score between 20 and 50.
    3. ONLY score above 60 if the paper is DIRECTLY relevant to "${researchTopic}".
    4. Score above 80 ONLY if the paper is a core contribution to "${researchTopic}".
    5. If the research topic is empty, default to scoring based on the domains list: [${domainNames.join(', ')}]. If domains list is also empty, default to 50.

    Paper Text:
    ${rawText}
    `;

    const result = await callGeminiWithRetry(genAI, prompt);
    let text = result.response.text();
    
    // Extract JSON from response
    const jsonStart = text.indexOf('{');
    const jsonEnd = text.lastIndexOf('}');
    if (jsonStart !== -1 && jsonEnd !== -1) {
      text = text.slice(jsonStart, jsonEnd + 1);
    }
    
    const parsedData = JSON.parse(text);

    // Match domain name to domain_id — or create a new domain (user-scoped)
    if (parsedData.domain) {
      const match = domainList.find(d => 
        d.name.toLowerCase() === parsedData.domain.toLowerCase()
      );
      if (match) {
        parsedData.domain_id = match.id;
      } else {
        // Auto-create the new domain for this user
        const domainColors = ['#7c5cff', '#06d6a0', '#ff6b6b', '#ffd166', '#118ab2', '#ef476f', '#073b4c', '#e07aff', '#06bcc1', '#f78c6b'];
        const domainIcons = ['📄', '🔬', '🛡️', '⚙️', '🧠', '📊', '🔗', '🤖', '📐', '🏗️', '📋', '💡'];
        const randomColor = domainColors[Math.floor(Math.random() * domainColors.length)];
        const randomIcon = domainIcons[Math.floor(Math.random() * domainIcons.length)];

        console.log(`Creating new domain for user ${req.user.id}: "${parsedData.domain}"`);
        const { data: newDomain, error: domErr } = await req.supabaseUser
          .from('domains')
          .insert({ 
            name: parsedData.domain, 
            color: randomColor, 
            icon: randomIcon,
            description: `Auto-created from paper: ${parsedData.title?.substring(0, 80) || 'AI-detected domain'}`,
            user_id: req.user.id
          })
          .select()
          .single();

        if (!domErr && newDomain) {
          parsedData.domain_id = newDomain.id;
          parsedData.domain_created = true;
          console.log(`New domain created: "${newDomain.name}" (${newDomain.id})`);
        } else {
          console.error('Failed to create domain:', domErr?.message);
        }
      }
    }

    // Auto-create research gaps in Supabase (user-scoped)
    if (parsedData.research_gaps && Array.isArray(parsedData.research_gaps) && parsedData.research_gaps.length > 0) {
      const createdGaps = [];
      for (const gap of parsedData.research_gaps) {
        const { data: newGap, error: gapErr } = await req.supabaseUser
          .from('research_gaps')
          .insert({
            title: gap.title,
            description: `${gap.description} (Identified from: ${parsedData.title?.substring(0, 60) || 'uploaded paper'})`,
            domain_id: parsedData.domain_id || null,
            severity: gap.severity || 'medium',
            status: 'open',
            user_id: req.user.id
          })
          .select()
          .single();

        if (!gapErr && newGap) {
          createdGaps.push(newGap);
          console.log(`Research gap created: "${newGap.title}"`);
        }
      }
      parsedData.gaps_created = createdGaps.length;
    }

    res.json(parsedData);

  } catch (error) {
    console.error('PDF Parse Error:', error);
    res.status(500).json({ error: error.message || 'Failed to parse PDF and extract data.' });
  }
});

// DASHBOARD STATS (user-scoped)
app.get('/api/dashboard/stats', checkSupabase, authenticateUser, async (req, res) => {
  try {
    const [
      { data: papers, error: pErr },
      { data: domains, error: dErr },
      { data: gaps, error: gErr }
    ] = await Promise.all([
      req.supabaseUser.from('papers').select('*, domains(name, color, icon)').order('year', { ascending: false }),
      req.supabaseUser.from('domains').select('*').order('name'),
      req.supabaseUser.from('research_gaps').select('*, domains(name, color, icon)').order('created_at')
    ]);

    if (pErr) throw pErr;
    if (dErr) throw dErr;
    if (gErr) throw gErr;

    const domainStats = domains.map(d => {
      const dPapers = papers.filter(p => p.domain_id === d.id);
      return {
        ...d,
        paperCount: dPapers.length,
        avgRelevance: Math.round(
          dPapers.reduce((s, p) => s + (p.relevance_score || 0), 0) / (dPapers.length || 1)
        )
      };
    });

    const yearDist = {};
    papers.forEach(p => { yearDist[p.year] = (yearDist[p.year] || 0) + 1; });

    const catDist = {};
    papers.forEach(p => { catDist[p.category] = (catDist[p.category] || 0) + 1; });

    const readCount = papers.filter(p => p.is_read).length;

    res.json({
      totalPapers: papers.length,
      totalDomains: domains.length,
      totalGaps: gaps.length,
      openGaps: gaps.filter(g => g.status === 'open').length,
      readCount,
      unreadCount: papers.length - readCount,
      domainStats,
      yearDistribution: yearDist,
      categoryDistribution: catDist,
      papers,
      domains,
      gaps
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Backend API running on http://localhost:${PORT}`);
});
