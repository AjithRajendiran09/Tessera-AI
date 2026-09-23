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

// WORKSPACES (Strictly User-Scoped)
app.get('/api/workspaces', checkSupabase, authenticateUser, async (req, res) => {
  let { data, error } = await req.supabaseUser
    .from('workspaces')
    .select('*')
    .eq('user_id', req.user.id)
    .order('created_at');

  if (error) return res.status(400).json({ error: error.message });

  // If this user has no workspaces yet, automatically create their private Default Workspace
  if (!data || data.length === 0) {
    const defaultTopic = req.user.user_metadata?.research_topic || '';
    const { data: newWs, error: cErr } = await req.supabaseUser
      .from('workspaces')
      .insert({
        name: 'Default Workspace',
        description: 'My primary research space',
        research_topic: defaultTopic,
        icon: '📁',
        is_default: true,
        user_id: req.user.id
      })
      .select()
      .single();

    if (!cErr && newWs) {
      data = [newWs];
    }
  }

  res.json(data || []);
});

app.post('/api/workspaces', checkSupabase, authenticateUser, async (req, res) => {
  const { data, error } = await req.supabaseUser
    .from('workspaces')
    .insert({ ...req.body, user_id: req.user.id })
    .select()
    .single();
  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json(data);
});

app.put('/api/workspaces/:id', checkSupabase, authenticateUser, async (req, res) => {
  const { data, error } = await req.supabaseUser
    .from('workspaces')
    .update(req.body)
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .select()
    .single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

app.delete('/api/workspaces/:id', checkSupabase, authenticateUser, async (req, res) => {
  // Cascading cleanup of papers, domains, and research gaps in this workspace for this user
  await req.supabaseUser.from('papers').delete().eq('workspace_id', req.params.id).eq('user_id', req.user.id);
  await req.supabaseUser.from('domains').delete().eq('workspace_id', req.params.id).eq('user_id', req.user.id);
  await req.supabaseUser.from('research_gaps').delete().eq('workspace_id', req.params.id).eq('user_id', req.user.id);

  const { error } = await req.supabaseUser
    .from('workspaces')
    .delete()
    .eq('id', req.params.id)
    .eq('user_id', req.user.id);
  if (error) return res.status(400).json({ error: error.message });
  res.status(204).send();
});

// DOMAINS (Strictly User-Scoped)
app.get('/api/domains', checkSupabase, authenticateUser, async (req, res) => {
  let query = req.supabaseUser.from('domains').select('*').eq('user_id', req.user.id).order('name');
  if (req.query.workspace_id) query = query.eq('workspace_id', req.query.workspace_id);
  const { data, error } = await query;
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
  const { error } = await req.supabaseUser
    .from('domains')
    .delete()
    .eq('id', req.params.id)
    .eq('user_id', req.user.id);
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

// PAPERS (Strictly User-Scoped)
app.get('/api/papers', checkSupabase, authenticateUser, async (req, res) => {
  let query = req.supabaseUser
    .from('papers')
    .select('*, domains(name, color, icon)')
    .eq('user_id', req.user.id)
    .order('year', { ascending: false });
  if (req.query.workspace_id) query = query.eq('workspace_id', req.query.workspace_id);
  const { data, error } = await query;
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

app.get('/api/papers/:id', checkSupabase, authenticateUser, async (req, res) => {
  const { data, error } = await req.supabaseUser
    .from('papers')
    .select('*, domains(name, color, icon)')
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
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
    .eq('user_id', req.user.id)
    .select()
    .single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

app.delete('/api/papers/:id', checkSupabase, authenticateUser, async (req, res) => {
  const { error } = await req.supabaseUser
    .from('papers')
    .delete()
    .eq('id', req.params.id)
    .eq('user_id', req.user.id);
  if (error) return res.status(400).json({ error: error.message });
  res.status(204).send();
});

// RESEARCH GAPS (Strictly User-Scoped)
app.get('/api/gaps', checkSupabase, authenticateUser, async (req, res) => {
  let query = req.supabaseUser
    .from('research_gaps')
    .select('*, domains(name, color, icon)')
    .eq('user_id', req.user.id)
    .order('created_at');
  if (req.query.workspace_id) query = query.eq('workspace_id', req.query.workspace_id);
  const { data, error } = await query;
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
    .eq('user_id', req.user.id)
    .select()
    .single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

app.delete('/api/gaps/:id', checkSupabase, authenticateUser, async (req, res) => {
  const { error } = await req.supabaseUser
    .from('research_gaps')
    .delete()
    .eq('id', req.params.id)
    .eq('user_id', req.user.id);
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
const MODELS_TO_TRY = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-flash-latest', 'gemini-flash-lite-latest', 'gemini-3.1-flash-lite'];

async function callGeminiWithRetry(genAI, prompt) {
  for (const modelName of MODELS_TO_TRY) {
    try {
      console.log(`Trying model: ${modelName}...`);
      const model = genAI.getGenerativeModel({ 
        model: modelName,
        generationConfig: { temperature: 0.0 }
      });
      const result = await model.generateContent(prompt);
      console.log(`Success with: ${modelName}`);
      return result;
    } catch (err) {
      const status = err.status || err.httpStatusCode || 0;
      console.log(`${modelName} failed (${status}): ${err.message?.substring(0, 100)}`);
      // Wait briefly on 429 / 503 before trying next model
      if (status === 429 || status === 503) {
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  }
  throw new Error('All Gemini models are currently busy or unavailable. Please try again in a moment.');
}

// ── AI PAPER METADATA SYNTHESIS HELPER ──
async function analyzePaperMetadataWithGemini({ title, authors, venue, year, doi, abstract, quartile, scopus_indexed, researchTopic, domainNames = [], customSchema = [] }) {
  if (!process.env.GEMINI_API_KEY) return null;
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

  let customFieldsSchemaStr = "{}";
  let customFieldsInstructions = "";
  if (customSchema && customSchema.length > 0) {
    const dynamicFieldsJSON = {};
    customSchema.forEach(field => {
      dynamicFieldsJSON[field.id] = field.type === 'boolean' ? false : "extracted text";
      customFieldsInstructions += `\n    - For custom_fields.${field.id} ("${field.name}"): ${field.description || "Extract this based on paper context."}`;
    });
    customFieldsSchemaStr = JSON.stringify(dynamicFieldsJSON, null, 2);
  }

  const prompt = `
  You are an expert academic research assistant specializing in systematic literature reviews and computer science/engineering literature.
  Analyze this academic paper based on its bibliographic metadata and abstract:
  Title: ${title || 'Unknown'}
  Authors: ${authors || 'Unknown'}
  Venue: ${venue || 'Unknown'}
  Year: ${year || 'Unknown'}
  DOI: ${doi || 'N/A'}
  Quartile: ${quartile || 'N/A'}
  Scopus Indexed: ${scopus_indexed ? 'Yes' : 'No'}
  Abstract / Summary: ${abstract || 'No abstract text available. Infer technical details, framework architecture, and methodology directly from the title, venue, and domain.'}

  User's Workspace Research Topic: "${researchTopic || 'General Computer Science, Systems & AI'}"
  Available Domains: [${domainNames.join(', ')}]

  Return ONLY a valid JSON object matching this schema exactly (no markdown backticks, no code fences, no extra text):
  {
    "category": "One of: Foundation, Safety & Guardrails, Drift Detection, Provenance, Multi-Agent, Formal Verification",
    "research_domain": "Concise 2-4 word domain name (e.g. Quantum Edge Computing, Privacy Compliance)",
    "suggested_domain": "Best matching domain from the available domains list, or a new 2-3 word domain name",
    "contribution": "A comprehensive 2-3 sentence summary of the key technical contribution and proposed system or architecture.",
    "limitations": [
      "Concrete technical limitation 1 (e.g. lack of large-scale physical hardware evaluation, scalability constraints)",
      "Concrete technical limitation 2 (e.g. noise sensitivity, network latency, or security assumptions)"
    ],
    "custom_fields": ${customFieldsSchemaStr},
    "personal": {
      "research_gap": "Specific open challenge, theoretical gap, or empirical gap this work leaves open for future research (1-2 sentences).",
      "missing_component": "A critical technical component, verification mechanism, or benchmark missing from this work (1 sentence).",
      "relevance_to_my_research": "Clear explanation of how this paper relates to '${researchTopic || 'the target research field'}' (1-2 sentences).",
      "relevance_score": 85,
      "personal_notes": "Critical analytical takeaway, method summary, or review note on this paper's core premise."
    },
    "research_gaps": [
      {
        "title": "Short gap title (5-10 words)",
        "description": "1-2 sentence description of the open research question or unresolved challenge",
        "severity": "high"
      }
    ]
  }

  FIELD EXTRACTION RULES:
  1. For contribution: Must be an informative 2-3 sentence technical synthesis, NOT just repeating the title.
  2. For limitations: Provide 2-3 realistic technical limitations based on the paper's subject area.
  3. For personal assessment: Must address research_gap, missing_component, relevance_to_my_research, relevance_score (0-100), and personal_notes.
  ${customFieldsInstructions ? `4. Custom fields: ${customFieldsInstructions}` : ''}
  `;

  try {
    const result = await callGeminiWithRetry(genAI, prompt);
    let text = result.response.text();
    const jsonStart = text.indexOf('{');
    const jsonEnd = text.lastIndexOf('}');
    if (jsonStart !== -1 && jsonEnd !== -1) {
      text = text.slice(jsonStart, jsonEnd + 1);
    }
    return JSON.parse(text);
  } catch (err) {
    console.error('[AI Analysis] Gemini synthesis error:', err.message);
    return null;
  }
}

// ── POST /api/papers/:id/autofill — Auto-fill all assessment and metadata fields with AI ──
app.post('/api/papers/:id/autofill', checkSupabase, authenticateUser, async (req, res) => {
  try {
    const { id } = req.params;
    const { data: paper, error: pErr } = await req.supabaseUser
      .from('papers')
      .select('*')
      .eq('id', id)
      .single();

    if (pErr || !paper) {
      return res.status(404).json({ error: 'Paper not found.' });
    }

    const workspaceId = paper.workspace_id;
    let researchTopic = '';
    let customSchema = [];
    if (workspaceId) {
      const { data: ws } = await req.supabaseUser
        .from('workspaces')
        .select('research_topic, custom_schema')
        .eq('id', workspaceId)
        .single();
      if (ws) {
        researchTopic = ws.research_topic || '';
        customSchema = ws.custom_schema || [];
      }
    }

    let domQuery = req.supabaseUser.from('domains').select('id, name');
    if (workspaceId) domQuery = domQuery.eq('workspace_id', workspaceId);
    const { data: domains } = await domQuery;
    const domainNames = (domains || []).map(d => d.name);

    const em = paper.extended_metadata || {};
    const abstract = em.abstract || paper.notes || null;

    const aiSynthesis = await analyzePaperMetadataWithGemini({
      title: paper.title,
      authors: paper.authors,
      venue: paper.venue,
      year: paper.year,
      doi: paper.doi,
      abstract,
      quartile: paper.quartile,
      scopus_indexed: paper.scopus_indexed,
      researchTopic,
      domainNames,
      customSchema
    });

    if (!aiSynthesis) {
      return res.status(500).json({ error: 'AI analysis failed to generate details.' });
    }

    const updatedExtended = {
      ...em,
      custom_fields: { ...(em.custom_fields || {}), ...(aiSynthesis.custom_fields || {}) },
      personal: {
        ...(em.personal || {}),
        ...(aiSynthesis.personal || {})
      }
    };

    const updates = {
      contribution: aiSynthesis.contribution || paper.contribution,
      limitations: aiSynthesis.limitations || paper.limitations || [],
      category: aiSynthesis.category || paper.category || 'Foundation',
      research_domain: aiSynthesis.research_domain || paper.research_domain,
      relevance: aiSynthesis.personal?.relevance_to_my_research || paper.relevance,
      relevance_score: aiSynthesis.personal?.relevance_score || paper.relevance_score,
      notes: aiSynthesis.personal?.personal_notes || paper.notes,
      extended_metadata: updatedExtended,
      updated_at: new Date().toISOString()
    };

    // If suggested domain matches an existing domain and paper has no domain
    if (!paper.domain_id && aiSynthesis.suggested_domain && domains) {
      const matchedDom = domains.find(d => d.name.toLowerCase() === aiSynthesis.suggested_domain.toLowerCase());
      if (matchedDom) updates.domain_id = matchedDom.id;
    }

    const { data: updatedPaper, error: uErr } = await req.supabaseUser
      .from('papers')
      .update(updates)
      .eq('id', id)
      .select('*, domains(name, color, icon)')
      .single();

    if (uErr) {
      return res.status(400).json({ error: uErr.message });
    }

    // Auto-create research gaps if generated
    if (aiSynthesis.research_gaps && Array.isArray(aiSynthesis.research_gaps) && aiSynthesis.research_gaps.length > 0) {
      for (const gap of aiSynthesis.research_gaps) {
        await req.supabaseUser
          .from('research_gaps')
          .insert({
            title: gap.title,
            description: `${gap.description} (Generated for: ${paper.title.substring(0, 60)})`,
            domain_id: updatedPaper.domain_id || null,
            severity: gap.severity || 'medium',
            status: 'open',
            user_id: req.user.id,
            workspace_id: workspaceId || null
          });
      }
    }

    res.json(updatedPaper);
  } catch (err) {
    console.error('[Autofill API] Error:', err);
    res.status(500).json({ error: err.message || 'Failed to auto-fill paper details.' });
  }
});

// ── POST /api/papers/autofill-preview — Preview AI auto-filled details before saving ──
app.post('/api/papers/autofill-preview', checkSupabase, authenticateUser, async (req, res) => {
  try {
    const { title, authors, venue, year, doi, abstract, workspace_id } = req.body;
    if (!title) return res.status(400).json({ error: 'Title is required for auto-fill.' });

    let researchTopic = '';
    let customSchema = [];
    if (workspace_id) {
      const { data: ws } = await req.supabaseUser
        .from('workspaces')
        .select('research_topic, custom_schema')
        .eq('id', workspace_id)
        .single();
      if (ws) {
        researchTopic = ws.research_topic || '';
        customSchema = ws.custom_schema || [];
      }
    }

    let domQuery = req.supabaseUser.from('domains').select('id, name');
    if (workspace_id) domQuery = domQuery.eq('workspace_id', workspace_id);
    const { data: domains } = await domQuery;
    const domainNames = (domains || []).map(d => d.name);

    const aiSynthesis = await analyzePaperMetadataWithGemini({
      title, authors, venue, year, doi, abstract,
      researchTopic, domainNames, customSchema
    });

    if (!aiSynthesis) {
      return res.status(500).json({ error: 'Failed to generate AI auto-fill preview.' });
    }

    res.json(aiSynthesis);
  } catch (err) {
    console.error('[Autofill Preview] Error:', err);
    res.status(500).json({ error: err.message || 'Failed to generate preview.' });
  }
});

app.post('/api/parse-pdf', upload.single('pdf'), checkSupabase, authenticateUser, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No PDF file uploaded.' });
    if (!process.env.GEMINI_API_KEY) return res.status(500).json({ error: 'GEMINI_API_KEY not configured on backend.' });

    const workspaceId = req.body.workspace_id;

    // Extract text from PDF
    const pdfData = await pdfParse(req.file.buffer);
    const rawText = pdfData.text.substring(0, 30000);

    // Fetch user's profile and workspace to get their research topic
    const { data: profile } = await req.supabaseUser
      .from('profiles')
      .select('research_topic')
      .eq('id', req.user.id)
      .single();
      
    let researchTopic = profile?.research_topic || '';
    
    let customSchema = [];
    if (workspaceId) {
      const { data: workspace } = await req.supabaseUser
        .from('workspaces')
        .select('research_topic, custom_schema')
        .eq('id', workspaceId)
        .single();
      if (workspace) {
        if (workspace.research_topic) researchTopic = workspace.research_topic;
        if (workspace.custom_schema && Array.isArray(workspace.custom_schema)) {
          customSchema = workspace.custom_schema;
        }
      }
    }

    // Fetch existing domains from Supabase for matching (scoped to workspace if provided)
    let domainList = [];
    let domQuery = req.supabaseUser.from('domains').select('id, name');
    if (workspaceId) domQuery = domQuery.eq('workspace_id', workspaceId);
    const { data: domData } = await domQuery;
    if (domData) domainList = domData;
    const domainNames = domainList.map(d => d.name);

    let dynamicFieldsJSON = {};
    let customFieldsInstructions = "";
    if (customSchema.length > 0) {
      customSchema.forEach(field => {
        let example = field.type === 'boolean' ? false : "extracted text";
        dynamicFieldsJSON[field.id] = example;
        customFieldsInstructions += `\n    - For custom_fields.${field.id} ("${field.name}"): ${field.description || "Extract this based on the paper."}`;
      });
    }
    const customFieldsSchemaStr = JSON.stringify(dynamicFieldsJSON, null, 6);

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

    const prompt = `
    You are an expert academic research assistant specializing in systematic literature reviews. Extract ALL of the following structured information from the provided academic paper text.
    Return ONLY a valid JSON object matching this schema exactly. No markdown, no comments, no extra text.

    {
      "title": "Full title of the paper",
      "authors": "Comma separated list of authors",
      "year": 2024,
      "venue": "Conference or Journal name",
      "publisher": "Publisher name (e.g. IEEE, ACM, Springer, Elsevier). Return null if not found.",
      "scopus_indexed": false,
      "quartile": "Journal quartile if identifiable (Q1, Q2, Q3, Q4). Return null if not found or not applicable.",
      "doi": "DOI identifier if found (e.g. 10.1145/xxxxx). Look for 'doi:', 'DOI:', 'https://doi.org/', or '10.xxxx/'. Return null if not found.",
      "url": "URL to the paper if found. If DOI found but no URL, construct as 'https://doi.org/<doi>'. Return null if nothing found.",
      "research_domain": "The broad research domain/area this paper belongs to (e.g. 'Privacy Compliance', 'Formal Verification', 'Multi-Agent Systems'). 2-5 words.",
      "domain": "Best matching domain from this list: [${domainNames.join(', ')}]. If none fit well, suggest a NEW concise domain name. Use 2-4 words max.",
      "category": "One of: Foundation, Safety & Guardrails, Drift Detection, Provenance, Multi-Agent, Formal Verification",
      "contribution": "A concise 2-3 sentence summary of the key technical contribution.",
      "limitations": ["limitation 1", "limitation 2"],

      "custom_fields": \${customFieldsSchemaStr},

      "personal": {
        "research_gap": "What research gap this paper reveals or leaves open. 1-2 sentences.",
        "missing_component": "What key component or capability is missing from this work. 1 sentence. Return null if not applicable.",
        "relevance_to_my_research": "How this paper relates to the user's research topic: '${researchTopic}'. If NOT relevant, say: 'This paper is NOT directly relevant to ${researchTopic}.'",
        "relevance_score": 50,
        "personal_notes": ""
      },

      "research_gaps": [
        {
          "title": "Short gap title (5-10 words)",
          "description": "1-2 sentence description of the open research question or unresolved challenge",
          "severity": "One of: critical, high, medium, low"
        }
      ]
    }

    FIELD EXTRACTION RULES:
    1. For boolean tag fields: Set to true ONLY if the paper explicitly discusses, uses, or is directly relevant to that concept. Default to false.
    2. For "multi_llm": Set to true only if the paper uses or proposes using multiple different LLMs together.
    3. For "scopus_indexed": Set to true only if there is explicit evidence the journal/venue is Scopus-indexed.
    4. For "machine_verifiable" in output: Set to true only if the output can be automatically verified by a machine/tool.
    5. For all text fields: Be concise but informative. Return null if the information is genuinely not present in the paper.
    6. CUSTOM FIELDS INSTRUCTIONS: ${customFieldsInstructions || "None."}

    RESEARCH GAPS: Identify 1-3 genuine open research questions, unresolved challenges, or future work directions. If none found, return an empty array [].

    CRITICAL — USER'S RESEARCH TOPIC: "${researchTopic}"
    
    ABSOLUTE SCORING RULES for personal.relevance_score:
    1. If the paper's topic is NOT directly related to "${researchTopic}", score 0-20.
    2. If SOME overlap but not a direct match, score 20-50.
    3. Score above 60 ONLY if DIRECTLY relevant to "${researchTopic}".
    4. Score above 80 ONLY if a core contribution to "${researchTopic}".
    5. If research topic is empty, default to scoring based on domains list: [${domainNames.join(', ')}]. If empty, default to 50.

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

    // ── Flatten top-level fields for backward compatibility ──
    // Map personal.relevance_score and relevance_to_my_research to top-level
    if (parsedData.personal) {
      if (parsedData.personal.relevance_score !== undefined) {
        parsedData.relevance_score = parsedData.personal.relevance_score;
      }
      if (parsedData.personal.relevance_to_my_research) {
        parsedData.relevance = parsedData.personal.relevance_to_my_research;
      }
      if (parsedData.personal.personal_notes) {
        parsedData.notes = parsedData.personal.personal_notes;
      }
    }

    // ── Build extended_metadata JSONB ──
    parsedData.extended_metadata = {
      custom_fields: parsedData.custom_fields || {},
      personal: parsedData.personal || {}
    };

    // ── Authoritative Scopus Verification for Uploaded Paper ──
    let resolvedIssn = null;
    if (parsedData.doi) {
      try {
        const cleanDoi = parsedData.doi.replace(/^https?:\/\/doi\.org\//i, '').trim();
        const crRes = await fetch(`https://api.crossref.org/works/${encodeURIComponent(cleanDoi)}`, {
          headers: { 'User-Agent': 'TesseraAI/1.0 (mailto:research@tessera.ai)' }
        });
        if (crRes.ok) {
          const crData = await crRes.json();
          const issns = crData.message?.ISSN || [];
          if (issns.length > 0) resolvedIssn = issns[0];
          if (!parsedData.venue && crData.message?.['container-title']?.[0]) {
            parsedData.venue = crData.message['container-title'][0];
          }
          if (!parsedData.publisher && crData.message?.publisher) {
            parsedData.publisher = crData.message.publisher;
          }
        }
      } catch (doiErr) {
        console.warn('[PDF Upload] DOI ISSN lookup warning:', doiErr.message);
      }
    }

    try {
      const verifiedScopus = await getScopusJournalMetadata(resolvedIssn, parsedData.venue);
      if (verifiedScopus && verifiedScopus.is_scopus) {
        parsedData.scopus_indexed = true;
        parsedData.quartile = verifiedScopus.quartile || parsedData.quartile || 'Q1';
        parsedData.extended_metadata.scopus_status = verifiedScopus;
      } else if (verifiedScopus && verifiedScopus.confidence === 'verified' && !verifiedScopus.is_scopus) {
        parsedData.scopus_indexed = false;
        parsedData.quartile = null;
        parsedData.extended_metadata.scopus_status = verifiedScopus;
      }
    } catch (scopusCheckErr) {
      console.warn('[PDF Upload] Scopus verification warning:', scopusCheckErr.message);
    }


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
            user_id: req.user.id,
            workspace_id: workspaceId || null
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

    // Auto-create research gaps in Supabase (scoped)
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
            user_id: req.user.id,
            workspace_id: workspaceId || null
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

// ── DISCOVER PAPERS (Scopus-indexed paper search & verification) ──

// In-memory cache for Scopus-indexing status per journal / ISSN (persists for server lifetime)
const scopusJournalCache = new Map();

/**
 * Reconstruct abstract from OpenAlex inverted index format.
 * OpenAlex stores abstracts as { word: [position1, position2, ...], ... }
 */
function reconstructAbstract(invertedIndex) {
  if (!invertedIndex) return null;
  const words = [];
  for (const [word, positions] of Object.entries(invertedIndex)) {
    for (const pos of positions) {
      words[pos] = word;
    }
  }
  return words.join(' ');
}

/**
 * Official Elsevier Serial Title Verification Engine.
 * Authoritatively verifies if an ISSN or venue is indexed in Scopus via Elsevier's Serial Title API.
 * Extracts real CiteScore, SJR, SNIP, and computes true Quartiles (Q1–Q4).
 */
async function getScopusJournalMetadata(issn, venueName) {
  const apiKey = process.env.SCOPUS_API_KEY;
  const cleanIssn = (issn || '').replace(/[^0-9X]/gi, '').toUpperCase();
  const cleanVenue = (venueName || '').trim();

  if (!cleanIssn && !cleanVenue) {
    return { is_scopus: false, confidence: 'unknown', quartile: null };
  }

  const cacheKey = cleanIssn ? `issn:${cleanIssn}` : `venue:${cleanVenue.toLowerCase()}`;
  if (scopusJournalCache.has(cacheKey)) {
    return scopusJournalCache.get(cacheKey);
  }

  // If no Scopus API key configured, use deterministic fallback
  if (!apiKey) {
    return checkScopusIndexingFast(venueName, '', false, []);
  }

  try {
    let url = '';
    if (cleanIssn) {
      url = `https://api.elsevier.com/content/serial/title?issn=${encodeURIComponent(cleanIssn)}`;
    } else {
      url = `https://api.elsevier.com/content/serial/title?title=${encodeURIComponent(cleanVenue)}`;
    }

    const headers = {
      'X-ELS-APIKey': apiKey,
      'Accept': 'application/json'
    };
    if (process.env.SCOPUS_INST_TOKEN) {
      headers['X-ELS-Insttoken'] = process.env.SCOPUS_INST_TOKEN;
    }

    const res = await fetch(url, { headers });
    if (!res.ok) {
      if (res.status === 404) {
        const notFound = { is_scopus: false, confidence: 'verified', quartile: null };
        scopusJournalCache.set(cacheKey, notFound);
        return notFound;
      }
      throw new Error(`Serial Title API error: ${res.status}`);
    }

    const data = await res.json();
    const entries = data['serial-metadata-response']?.entry || [];
    if (entries.length === 0) {
      const notIndexed = { is_scopus: false, confidence: 'verified', quartile: null };
      scopusJournalCache.set(cacheKey, notIndexed);
      return notIndexed;
    }

    const entry = entries[0];
    const currentYear = new Date().getFullYear();
    const coverageEnd = parseInt(entry.coverageEndYear) || currentYear;
    // An active Scopus journal has coverage up to recent/current year
    const isActive = coverageEnd >= currentYear - 1;

    // Authoritative CiteScore & SJR metrics
    const citeScore = parseFloat(entry.citeScoreYearInfoList?.citeScoreCurrentMetric) || null;
    const sjr = parseFloat(entry.SJRList?.SJR?.[0]?.['$']) || null;
    const snip = parseFloat(entry.SNIPList?.SNIP?.[0]?.['$']) || null;

    // Authoritative Quartile estimation based on Elsevier/SJR metrics
    let quartile = null;
    if (sjr !== null) {
      if (sjr >= 1.0) quartile = 'Q1';
      else if (sjr >= 0.5) quartile = 'Q2';
      else if (sjr >= 0.25) quartile = 'Q3';
      else quartile = 'Q4';
    } else if (citeScore !== null) {
      if (citeScore >= 7.0) quartile = 'Q1';
      else if (citeScore >= 3.5) quartile = 'Q2';
      else if (citeScore >= 1.5) quartile = 'Q3';
      else quartile = 'Q4';
    } else {
      quartile = 'Q2';
    }

    const result = {
      is_scopus: isActive,
      confidence: 'verified',
      quartile: isActive ? quartile : null,
      citescore: citeScore,
      sjr: sjr,
      snip: snip,
      source_id: entry['source-id'] || null,
      official_title: entry['dc:title'] || venueName,
      coverage_end: entry.coverageEndYear || null,
      scopus_source_url: entry.link?.find(l => l['@ref'] === 'scopus-source')?.['@href'] || null
    };

    scopusJournalCache.set(cacheKey, result);
    if (cleanIssn && cleanVenue) {
      scopusJournalCache.set(`venue:${cleanVenue.toLowerCase()}`, result);
    }
    return result;
  } catch (err) {
    console.error(`[Scopus Serial Check] Error checking "${cleanIssn || cleanVenue}":`, err.message?.substring(0, 100));
    return { is_scopus: false, confidence: 'error', quartile: null };
  }
}

/**
 * Fast check for Scopus indexing based on explicit metadata tags.
 */
function checkScopusIndexingFast(venueName, publisher, isCore, indexedIn = []) {
  if (indexedIn && indexedIn.includes('scopus')) {
    return { is_scopus: true, confidence: 'high', quartile: 'Q1' };
  }
  const venue = (venueName || '').toLowerCase();

  // Explicit major Scopus flagship venues
  if (venue.startsWith('ieee transactions') || venue.startsWith('acm computing') ||
      venue.includes('nature') || venue.includes('science') || venue.includes('the lancet') ||
      venue.includes('cell press')) {
    return { is_scopus: true, confidence: 'high', quartile: 'Q1' };
  }

  return { is_scopus: false, confidence: 'unverified', quartile: null };
}

/**
 * Fallback check if journal verification is requested.
 */
async function checkScopusIndexing(venueName, issn) {
  return await getScopusJournalMetadata(issn, venueName);
}

/**
 * Search Scopus API directly (guaranteed 100% Scopus-indexed peer-reviewed papers).
 */
async function searchScopus(query, options = {}) {
  const { page = 1, perPage = 10, yearFrom, yearTo, sort = 'relevance' } = options;
  const apiKey = process.env.SCOPUS_API_KEY;
  if (!apiKey) throw new Error('SCOPUS_API_KEY not configured');
  
  // Elsevier Scopus API count max is 25
  const count = Math.min(perPage, 25);
  const start = (page - 1) * count;

  // Sanitize query for Elsevier Scopus search syntax
  const sanitizedQuery = (query || '')
    .replace(/[{}[\]()^~*?:\\\/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  
  // Strict Scopus query: peer-reviewed journals & conference proceedings only, research articles & conference papers
  let scopusQuery = `TITLE-ABS-KEY(${sanitizedQuery}) AND SRCTYPE(j OR p) AND DOCTYPE(ar OR cp)`;
  if (yearFrom) scopusQuery += ` AND PUBYEAR > ${yearFrom - 1}`;
  if (yearTo) scopusQuery += ` AND PUBYEAR < ${yearTo + 1}`;
  
  const sortMap = {
    'relevance': 'relevancy',
    'date': '-date',
    'cited_by_count': '-citedby-count'
  };
  
  const url = `https://api.elsevier.com/content/search/scopus?query=${encodeURIComponent(scopusQuery)}&start=${start}&count=${count}&sort=${sortMap[sort] || 'relevancy'}`;
  
  console.log(`[Discover] Scopus query: ${url}`);
  
  const headers = {
    'X-ELS-APIKey': apiKey,
    'Accept': 'application/json'
  };
  if (process.env.SCOPUS_INST_TOKEN) {
    headers['X-ELS-Insttoken'] = process.env.SCOPUS_INST_TOKEN;
  }

  const response = await fetch(url, { headers });
  
  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`Scopus API error: ${response.status} — ${errorText.substring(0, 200)}`);
  }
  return await response.json();
}

/**
 * Normalize a Scopus API result entry into Tessera format.
 */
function normalizeScopusResult(entry) {
  const doi = entry['prism:doi'] || null;
  const scopusUrl = entry.link?.find(l => l['@ref'] === 'scopus')?.['@href'] || null;
  const fullTextUrl = entry.link?.find(l => l['@ref'] === 'full-text')?.['@href'] || null;
  const url = doi ? `https://doi.org/${doi}` : (scopusUrl || fullTextUrl || null);

  const rawCreator = entry['dc:creator'] || null;
  const affiliation = entry.affiliation?.[0]?.affilname || null;
  const authors = rawCreator ? `${rawCreator}${affiliation ? ` (${affiliation})` : ''}` : 'Unknown Author';

  return {
    title: entry['dc:title'] || 'Untitled',
    authors: authors,
    year: entry['prism:coverDate'] ? parseInt(entry['prism:coverDate'].split('-')[0]) : null,
    venue: entry['prism:publicationName'] || null,
    doi: doi,
    url: url,
    scopus_url: scopusUrl,
    abstract: entry['dc:description'] || null,
    cited_by_count: parseInt(entry['citedby-count']) || 0,
    is_open_access: entry.openaccessFlag === true || entry.openaccess === '1',
    indexed_in: ['scopus'],
    scopus_status: {
      is_scopus: true,
      confidence: 'verified',
      quartile: 'Q1',
      source_id: entry['source-id'] || null,
      aggregation_type: entry['prism:aggregationType'] || 'Journal',
      subtype: entry.subtypeDescription || 'Article'
    },
    source: 'scopus',
    openalex_id: null,
    scopus_id: entry['dc:identifier'] || null,
    issn: entry['prism:issn'] || null,
    eissn: entry['prism:eIssn'] || null
  };
}

/**
 * Search OpenAlex API for papers matching a keyword query (used as fallback).
 */
async function searchOpenAlex(query, options = {}) {
  const { page = 1, perPage = 10, yearFrom, yearTo, sort = 'relevance', scopusOnly = true } = options;
  
  const email = process.env.OPENALEX_EMAIL || '';
  // Tighten to peer-reviewed articles with a valid DOI
  let url = `https://api.openalex.org/works?search=${encodeURIComponent(query)}&filter=type:article,has_doi:true`;
  
  if (scopusOnly) {
    url += `,primary_location.source.is_core:true`;
  }
  
  if (yearFrom) url += `,from_publication_date:${yearFrom}-01-01`;
  if (yearTo) url += `,to_publication_date:${yearTo}-12-31`;
  
  const sortMap = {
    'relevance': 'relevance_score:desc',
    'date': 'publication_date:desc',
    'cited_by_count': 'cited_by_count:desc'
  };
  if (sort && sort !== 'relevance') {
    url += `&sort=${sortMap[sort] || 'relevance_score:desc'}`;
  }
  
  // Over-fetch candidate pool when scopusOnly is active so that after strict filtering we fulfill perPage
  const fetchCount = scopusOnly ? Math.min(perPage * 3, 50) : perPage;
  url += `&page=${page}&per_page=${fetchCount}`;
  if (email) url += `&mailto=${encodeURIComponent(email)}`;
  
  console.log(`[Discover] OpenAlex query: ${url}`);
  
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`OpenAlex API error: ${response.status} ${response.statusText}`);
  }
  return await response.json();
}

/**
 * Normalize an OpenAlex API result entry into Tessera format.
 */
function normalizeOpenAlexResult(work) {
  const authors = (work.authorships || [])
    .map(a => a.author?.display_name)
    .filter(Boolean)
    .join(', ');
  
  const venue = work.primary_location?.source?.display_name || null;
  const issn = work.primary_location?.source?.issn_l || work.primary_location?.source?.issn?.[0] || null;
  const publisher = work.primary_location?.source?.host_organization_name || null;
  const isCore = work.primary_location?.source?.is_core === true;
  const doi = work.doi ? work.doi.replace('https://doi.org/', '') : null;
  const abstract = reconstructAbstract(work.abstract_inverted_index);
  
  return {
    title: work.display_name || work.title || 'Untitled',
    authors: authors || 'Unknown',
    year: work.publication_year || null,
    venue: venue,
    doi: doi,
    url: work.doi || work.primary_location?.landing_page_url || null,
    abstract: abstract,
    cited_by_count: work.cited_by_count || 0,
    is_open_access: work.open_access?.is_oa || false,
    oa_status: work.open_access?.oa_status || null,
    indexed_in: work.indexed_in || [],
    scopus_status: null, // Will be verified authoritatively
    source: 'openalex',
    openalex_id: work.id || null,
    scopus_id: null,
    issn: issn,
    publisher: publisher,
    is_core: isCore,
    topics: (work.topics || []).map(t => t.display_name),
    fwci: work.fwci || null
  };
}

// ── GET /api/discover — Search for papers by keyword ──
app.get('/api/discover', checkSupabase, authenticateUser, async (req, res) => {
  try {
    const { query, page = 1, per_page = 10, year_from, year_to, sort = 'relevance', scopus_only = 'true', workspace_id } = req.query;
    
    if (!query || query.trim().length === 0) {
      return res.status(400).json({ error: 'Search query is required.' });
    }
    
    const isScopusOnly = scopus_only !== 'false' && scopus_only !== false;
    const options = {
      page: parseInt(page),
      perPage: Math.min(Math.max(parseInt(per_page) || 10, 1), 200),
      yearFrom: year_from ? parseInt(year_from) : undefined,
      yearTo: year_to ? parseInt(year_to) : undefined,
      sort,
      scopusOnly: isScopusOnly
    };
    
    let results = [];
    let total = 0;
    let apiSource = 'openalex';
    
    // Try Scopus first if API key is configured
    if (process.env.SCOPUS_API_KEY) {
      try {
        const scopusData = await searchScopus(query, options);
        const entries = scopusData['search-results']?.entry || [];
        total = parseInt(scopusData['search-results']?.['opensearch:totalResults']) || 0;
        results = entries
          .filter(e => e['dc:title']) // Skip error entries
          .map(normalizeScopusResult);
        apiSource = 'scopus';
        console.log(`[Discover] Scopus returned ${results.length} results (total: ${total})`);

        // Enrich results with official CiteScore / SJR / Quartiles in parallel (using serial metadata)
        const uniqueIssns = Array.from(new Set(results.map(r => r.issn || r.venue).filter(Boolean))).slice(0, 10);
        const serialMetas = await Promise.allSettled(
          uniqueIssns.map(key => getScopusJournalMetadata(key.includes('-') || /^\d{7,8}[0-9X]?$/i.test(key) ? key : null, key))
        );
        const metaMap = new Map();
        uniqueIssns.forEach((key, idx) => {
          if (serialMetas[idx].status === 'fulfilled' && serialMetas[idx].value) {
            metaMap.set(key.toLowerCase().trim(), serialMetas[idx].value);
          }
        });
        results.forEach(r => {
          const meta = metaMap.get((r.issn || '').toLowerCase().trim()) || metaMap.get((r.venue || '').toLowerCase().trim());
          if (meta) {
            if (meta.citescore) r.scopus_status.citescore = meta.citescore;
            if (meta.sjr) r.scopus_status.sjr = meta.sjr;
            if (meta.quartile) r.scopus_status.quartile = meta.quartile;
          }
        });
      } catch (scopusErr) {
        console.log(`[Discover] Scopus search failed, falling back to OpenAlex: ${scopusErr.message?.substring(0, 100)}`);
        // Fall through to OpenAlex
      }
    }
    
    // Use OpenAlex if Scopus not available or failed
    if (results.length === 0 && apiSource !== 'scopus') {
      const oaData = await searchOpenAlex(query, options);
      total = oaData.meta?.count || 0;
      results = (oaData.results || []).map(normalizeOpenAlexResult);
      apiSource = 'openalex';
      console.log(`[Discover] OpenAlex returned ${results.length} results (total: ${total}, scopusOnly: ${isScopusOnly})`);
      
      // Authoritatively verify venues & ISSNs using official Elsevier Serial Title API
      const uniqueVenues = new Map();
      results.forEach(r => {
        const key = r.issn || (r.venue ? r.venue.toLowerCase().trim() : null);
        if (key && !uniqueVenues.has(key)) {
          uniqueVenues.set(key, { venue: r.venue, issn: r.issn });
        }
      });

      if (uniqueVenues.size > 0) {
        const venueItems = Array.from(uniqueVenues.values()).slice(0, 25);
        const checks = await Promise.allSettled(
          venueItems.map(v => getScopusJournalMetadata(v.issn, v.venue))
        );

        const venueStatusMap = new Map();
        venueItems.forEach((v, i) => {
          if (checks[i].status === 'fulfilled' && checks[i].value) {
            if (v.issn) venueStatusMap.set(v.issn.replace(/[^0-9X]/gi, '').toUpperCase(), checks[i].value);
            if (v.venue) venueStatusMap.set(v.venue.toLowerCase().trim(), checks[i].value);
          }
        });

        results.forEach(r => {
          const cleanIssn = (r.issn || '').replace(/[^0-9X]/gi, '').toUpperCase();
          const cleanVenue = (r.venue || '').toLowerCase().trim();
          const status = venueStatusMap.get(cleanIssn) || venueStatusMap.get(cleanVenue);
          if (status) {
            r.scopus_status = status;
          } else {
            r.scopus_status = { is_scopus: false, confidence: 'unverified', quartile: null };
          }
        });
      }

      // CRITICAL STRICT FILTERING: When scopusOnly is checked, drop non-Scopus papers!
      if (isScopusOnly) {
        results = results.filter(r => r.scopus_status && r.scopus_status.is_scopus === true);
        results = results.slice(0, options.perPage);
      }
    }
    
    // Check which papers are already in the user's library (by DOI match)
    const dois = results.filter(r => r.doi).map(r => r.doi);
    if (dois.length > 0) {
      const { data: existingPapers } = await req.supabaseUser
        .from('papers')
        .select('doi')
        .in('doi', dois);
      
      const existingDois = new Set((existingPapers || []).map(p => p.doi));
      results.forEach(r => {
        r.already_imported = r.doi ? existingDois.has(r.doi) : false;
      });
    }
    
    res.json({
      results,
      total,
      page: options.page,
      per_page: options.perPage,
      total_pages: Math.ceil(total / options.perPage),
      source: apiSource,
      query: query.trim()
    });
    
  } catch (error) {
    console.error('[Discover] Error:', error);
    res.status(500).json({ error: error.message || 'Failed to search for papers.' });
  }
});

// ── POST /api/discover/import — Import a discovered paper ──
app.post('/api/discover/import', checkSupabase, authenticateUser, async (req, res) => {
  try {
    const { paper, workspace_id } = req.body;
    
    if (!paper || !paper.title) {
      return res.status(400).json({ error: 'Paper data with at least a title is required.' });
    }
    
    // Check for duplicate by DOI
    if (paper.doi) {
      let dupeQuery = req.supabaseUser.from('papers').select('id').eq('doi', paper.doi);
      if (workspace_id) dupeQuery = dupeQuery.eq('workspace_id', workspace_id);
      const { data: existing } = await dupeQuery;
      if (existing && existing.length > 0) {
        return res.status(409).json({ error: 'This paper is already in your library.', paper_id: existing[0].id });
      }
    }
    
    // Try to match or assign to an existing domain
    let domainId = null;
    let domQuery = req.supabaseUser.from('domains').select('id, name');
    if (workspace_id) domQuery = domQuery.eq('workspace_id', workspace_id);
    const { data: domains } = await domQuery;
    
    if (domains && domains.length > 0) {
      const searchText = `${paper.venue || ''} ${(paper.topics || []).join(' ')} ${paper.title || ''}`.toLowerCase();
      const match = domains.find(d => searchText.includes(d.name.toLowerCase()));
      if (match) {
        domainId = match.id;
      } else {
        domainId = domains[0].id; // Assign to user's first domain in workspace
      }
    }

    const isScopus = Boolean(paper.scopus_status?.is_scopus || paper.source === 'scopus');
    const quartile = paper.scopus_status?.quartile || (isScopus ? 'Q1' : null);
    const researchDomain = (paper.topics && paper.topics.length > 0) 
      ? paper.topics[0] 
      : (paper.venue || 'Research Domain');
    
    // Fetch workspace topic & custom schema for intelligent AI synthesis
    let researchTopic = '';
    let customSchema = [];
    if (workspace_id) {
      const { data: ws } = await req.supabaseUser
        .from('workspaces')
        .select('research_topic, custom_schema')
        .eq('id', workspace_id)
        .single();
      if (ws) {
        researchTopic = ws.research_topic || '';
        customSchema = ws.custom_schema || [];
      }
    }
    const domainNames = (domains || []).map(d => d.name);

    // Auto-synthesize full paper details (contribution, limitations, personal assessment, research gaps)
    let aiSynthesis = null;
    try {
      aiSynthesis = await analyzePaperMetadataWithGemini({
        title: paper.title,
        authors: paper.authors,
        venue: paper.venue,
        year: paper.year,
        doi: paper.doi,
        abstract: paper.abstract,
        quartile,
        scopus_indexed: isScopus,
        researchTopic,
        domainNames,
        customSchema
      });
    } catch (aiErr) {
      console.warn('[Discover Import] AI synthesis warning:', aiErr.message);
    }

    // Build comprehensive paper record matching database schema with AI auto-filled details
    const paperRecord = {
      title: paper.title,
      authors: paper.authors || 'Unknown Authors',
      year: parseInt(paper.year) || new Date().getFullYear(),
      venue: paper.venue || 'Academic Journal',
      doi: paper.doi || null,
      url: paper.url || (paper.doi ? `https://doi.org/${paper.doi}` : null),
      domain_id: domainId,
      category: aiSynthesis?.category || 'Foundation',
      contribution: aiSynthesis?.contribution || (paper.abstract ? paper.abstract.substring(0, 500) : (paper.title || null)),
      limitations: aiSynthesis?.limitations || [],
      relevance: aiSynthesis?.personal?.relevance_to_my_research || null,
      relevance_score: aiSynthesis?.personal?.relevance_score || (paper.cited_by_count > 50 ? 90 : 80),
      is_read: false,
      publisher: paper.publisher || null,
      scopus_indexed: isScopus,
      quartile: quartile,
      research_domain: aiSynthesis?.research_domain || researchDomain,
      notes: aiSynthesis?.personal?.personal_notes || paper.abstract || null,
      extended_metadata: {
        abstract: paper.abstract || null,
        citations: paper.cited_by_count || 0,
        is_open_access: paper.is_open_access || false,
        openalex_id: paper.openalex_id || null,
        scopus_status: paper.scopus_status || null,
        topics: paper.topics || [],
        source: paper.source || 'discover',
        custom_fields: aiSynthesis?.custom_fields || {},
        personal: aiSynthesis?.personal || {}
      },
      user_id: req.user.id,
      workspace_id: workspace_id || null
    };
    
    let { data: newPaper, error: pErr } = await req.supabaseUser
      .from('papers')
      .insert(paperRecord)
      .select('*, domains(name, color, icon)')
      .single();
    
    if (pErr) {
      console.error('[Discover Import] Insert error with full schema, trying fallback:', pErr.message);
      // Fallback in case table doesn't have extended columns
      if (pErr.message?.includes('column') || pErr.code === '42703') {
        delete paperRecord.publisher;
        delete paperRecord.scopus_indexed;
        delete paperRecord.quartile;
        delete paperRecord.research_domain;
        delete paperRecord.extended_metadata;
        const fallbackRes = await req.supabaseUser
          .from('papers')
          .insert(paperRecord)
          .select('*, domains(name, color, icon)')
          .single();
        if (fallbackRes.error) return res.status(400).json({ error: fallbackRes.error.message });
        newPaper = fallbackRes.data;
      } else {
        return res.status(400).json({ error: pErr.message });
      }
    }

    // Auto-create research gaps in database
    if (aiSynthesis?.research_gaps && Array.isArray(aiSynthesis.research_gaps) && aiSynthesis.research_gaps.length > 0) {
      for (const gap of aiSynthesis.research_gaps) {
        await req.supabaseUser
          .from('research_gaps')
          .insert({
            title: gap.title,
            description: `${gap.description} (Identified from: ${paper.title.substring(0, 60)})`,
            domain_id: newPaper.domain_id || null,
            severity: gap.severity || 'medium',
            status: 'open',
            user_id: req.user.id,
            workspace_id: workspace_id || null
          });
      }
    }
    
    console.log(`[Discover Import] Paper imported with AI synthesis: "${newPaper.title}" (${newPaper.id})`);
    res.status(201).json(newPaper);
    
  } catch (error) {
    console.error('[Discover Import] Error:', error);
    res.status(500).json({ error: error.message || 'Failed to import paper.' });
  }
});

// DASHBOARD STATS (scoped)

app.get('/api/dashboard/stats', checkSupabase, authenticateUser, async (req, res) => {
  try {
    let pQuery = req.supabaseUser
      .from('papers')
      .select('*, domains(name, color, icon)')
      .eq('user_id', req.user.id)
      .order('year', { ascending: false });
    let dQuery = req.supabaseUser
      .from('domains')
      .select('*')
      .eq('user_id', req.user.id)
      .order('name');
    let gQuery = req.supabaseUser
      .from('research_gaps')
      .select('*, domains(name, color, icon)')
      .eq('user_id', req.user.id)
      .order('created_at');
    
    if (req.query.workspace_id) {
      pQuery = pQuery.eq('workspace_id', req.query.workspace_id);
      dQuery = dQuery.eq('workspace_id', req.query.workspace_id);
      gQuery = gQuery.eq('workspace_id', req.query.workspace_id);
    }

    const [
      { data: papers, error: pErr },
      { data: domains, error: dErr },
      { data: gaps, error: gErr }
    ] = await Promise.all([ pQuery, dQuery, gQuery ]);

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

// ── PAPER DRAFT GENERATOR ──
const XLSX_LIB = require('xlsx');

// Helper: Format a single reference in the given citation style
function formatReference(ref, style, index) {
  const authors = (ref.author || ref.authors || 'Unknown Author').trim();
  const title = (ref.title || 'Untitled').trim();
  const journal = (ref.journal || ref.conference || ref.venue || '').trim();
  const year = ref.year || 'n.d.';
  const volume = ref.volume || '';
  const issue = ref.issue || '';
  const pages = ref.pages || '';
  const doi = ref.doi || '';
  const url = ref.url || '';

  // Convert "John Doe, Jane Smith" → "J. Doe and J. Smith" for IEEE
  function toIEEEAuthors(authStr) {
    const names = authStr.split(/,\s*(?:and\s+)?|;\s*|\s+and\s+/i).filter(Boolean);
    const formatted = names.map(name => {
      const parts = name.trim().split(/\s+/);
      if (parts.length <= 1) return parts[0];
      const surname = parts[parts.length - 1];
      const initials = parts.slice(0, -1).map(p => p.charAt(0).toUpperCase() + '.').join(' ');
      return `${initials} ${surname}`;
    });
    if (formatted.length === 0) return authStr;
    if (formatted.length === 1) return formatted[0];
    if (formatted.length === 2) return `${formatted[0]} and ${formatted[1]}`;
    return formatted.slice(0, -1).join(', ') + ', and ' + formatted[formatted.length - 1];
  }

  switch (style.toUpperCase()) {
    case 'APA': {
      let apa = `${authors} (${year}). ${title}.`;
      if (journal) apa += ` *${journal}*`;
      if (volume) apa += `, *${volume}*`;
      if (issue) apa += `(${issue})`;
      if (pages) apa += `, ${pages}`;
      apa += '.';
      if (doi) apa += ` https://doi.org/${doi.replace(/^https?:\/\/doi\.org\//i, '')}`;
      return apa;
    }

    case 'MLA': {
      let mla = `${authors}. "${title}."`;
      if (journal) mla += ` *${journal}*`;
      if (volume) mla += `, vol. ${volume}`;
      if (issue) mla += `, no. ${issue}`;
      mla += `, ${year}`;
      if (pages) mla += `, pp. ${pages}`;
      mla += '.';
      if (doi) mla += ` doi:${doi.replace(/^https?:\/\/doi\.org\//i, '')}`;
      return mla;
    }

    case 'IEEE': {
      const ieeeAuth = toIEEEAuthors(authors);
      let ieee = `[${index + 1}] ${ieeeAuth}, "${title},"`;
      if (journal) {
        // Check if it looks like a conference
        const isConf = /conference|proc\.|proceedings|symposium|workshop|congress/i.test(journal);
        if (isConf) {
          ieee += ` in *${journal}*`;
        } else {
          ieee += ` *${journal}*`;
        }
      }
      if (volume) ieee += `, vol. ${volume}`;
      if (issue) ieee += `, no. ${issue}`;
      if (pages) ieee += `, pp. ${pages}`;
      ieee += `, ${year}.`;
      if (doi) ieee += ` doi: ${doi.replace(/^https?:\/\/doi\.org\//i, '')}.`;
      else if (url) ieee += ` [Online]. Available: ${url}`;
      return ieee;
    }

    case 'CHICAGO': {
      let chi = `${authors}. "${title}."`;
      if (journal) chi += ` *${journal}*`;
      if (volume) chi += ` ${volume}`;
      if (issue) chi += `, no. ${issue}`;
      chi += ` (${year})`;
      if (pages) chi += `: ${pages}`;
      chi += '.';
      if (doi) chi += ` https://doi.org/${doi.replace(/^https?:\/\/doi\.org\//i, '')}`;
      return chi;
    }

    default:
      return `${authors} (${year}). ${title}. ${journal}. ${volume}(${issue}), ${pages}.`;
  }
}

// POST /api/paper-draft/parse-excel — Parse uploaded Excel file into structured JSON
app.post('/api/paper-draft/parse-excel', upload.single('excel'), checkSupabase, authenticateUser, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No Excel file uploaded.' });

    const workbook = XLSX_LIB.read(req.file.buffer, { type: 'buffer' });
    const sheetNames = workbook.SheetNames;

    // Parse each sheet into JSON
    const result = { metadata: {}, data: [], references: [], charts: [], rawSheets: {} };

    for (const name of sheetNames) {
      const sheet = workbook.Sheets[name];
      const json = XLSX_LIB.utils.sheet_to_json(sheet, { defval: '' });
      const lower = name.toLowerCase().trim();
      result.rawSheets[name] = json;

      if (lower === 'metadata' || lower === 'meta' || lower === 'info') {
        // Metadata sheet: expect key-value pairs or single row with columns
        if (json.length > 0) {
          const row = json[0];
          result.metadata = {
            title: row['Paper Title'] || row['Title'] || row['title'] || '',
            abstract: row['Abstract'] || row['abstract'] || '',
            keywords: row['Keywords'] || row['keywords'] || '',
            researchArea: row['Research Area'] || row['Research Topic'] || row['research_area'] || '',
            methodology: row['Methodology'] || row['methodology'] || '',
            objective: row['Objective'] || row['objective'] || '',
          };
          // Also check for vertical key-value format
          if (!result.metadata.title && json.length > 1) {
            const kvMap = {};
            json.forEach(r => {
              const key = (r[Object.keys(r)[0]] || '').toString().toLowerCase().trim();
              const val = r[Object.keys(r)[1]] || '';
              kvMap[key] = val;
            });
            result.metadata = {
              title: kvMap['paper title'] || kvMap['title'] || '',
              abstract: kvMap['abstract'] || '',
              keywords: kvMap['keywords'] || '',
              researchArea: kvMap['research area'] || kvMap['research topic'] || '',
              methodology: kvMap['methodology'] || '',
              objective: kvMap['objective'] || '',
            };
          }
        }
      } else if (lower === 'references' || lower === 'refs' || lower === 'bibliography') {
        result.references = json.map(r => ({
          author: r['Author'] || r['Authors'] || r['author'] || r['authors'] || '',
          title: r['Title'] || r['title'] || r['Paper Title'] || '',
          journal: r['Journal'] || r['Conference'] || r['Venue'] || r['journal'] || r['venue'] || '',
          year: r['Year'] || r['year'] || '',
          volume: r['Volume'] || r['volume'] || r['Vol'] || '',
          issue: r['Issue'] || r['issue'] || r['No'] || '',
          pages: r['Pages'] || r['pages'] || '',
          doi: r['DOI'] || r['doi'] || '',
          url: r['URL'] || r['url'] || r['Link'] || '',
        })).filter(r => r.author || r.title);
      } else if (lower === 'charts' || lower === 'chart config' || lower === 'chart') {
        result.charts = json.map(r => ({
          chartTitle: r['Chart Title'] || r['Title'] || r['chart_title'] || '',
          type: (r['Type'] || r['Chart Type'] || r['type'] || 'bar').toLowerCase(),
          xColumn: r['X Column'] || r['X'] || r['x_column'] || '',
          yColumns: (r['Y Column'] || r['Y Columns'] || r['Y'] || r['y_column'] || '').toString().split(',').map(s => s.trim()).filter(Boolean),
          description: r['Description'] || r['description'] || '',
        })).filter(r => r.chartTitle || r.xColumn);
      } else {
        // Treat any other sheet as data
        if (json.length > 0) {
          result.data.push({ sheetName: name, rows: json, columns: Object.keys(json[0]) });
        }
      }
    }

    // 1. Auto-detect references if no dedicated references sheet was provided
    if (result.references.length === 0 && result.data.length > 0) {
      for (const sheet of result.data) {
        const cols = sheet.columns.map(c => c.toLowerCase().trim());
        const hasTitle = cols.some(c => c === 'title' || c === 'paper title' || c === 'article title' || c === 'document title');
        const hasAuthor = cols.some(c => c.includes('author'));

        if (hasTitle && hasAuthor) {
          result.references = sheet.rows.map(r => {
            const getVal = (patterns) => {
              for (const key of Object.keys(r)) {
                const kl = key.toLowerCase().trim();
                if (patterns.includes(kl)) return (r[key] ?? '').toString().trim();
              }
              return '';
            };
            return {
              author: getVal(['author', 'authors', 'creator', 'first author']),
              title: getVal(['title', 'paper title', 'article title', 'name']),
              journal: getVal(['journal', 'venue', 'conference', 'source', 'publisher', 'publication']),
              year: getVal(['year', 'pub_year', 'publication year', 'date']),
              volume: getVal(['volume', 'vol']),
              issue: getVal(['issue', 'no']),
              pages: getVal(['pages', 'page', 'pp']),
              doi: getVal(['doi']),
              url: getVal(['url', 'link', 'scopus url']),
            };
          }).filter(r => r.author || r.title);

          if (result.references.length > 0) break;
        }
      }
    }

    // 2. Auto-detect metadata defaults if missing
    if (!result.metadata.title) {
      if (result.references.length > 0) {
        result.metadata.title = `Systematic Literature Review and Bibliometric Analysis of ${result.references.length} Key Studies`;
        result.metadata.researchArea = result.metadata.researchArea || 'Computer Science and Information Systems';
        result.metadata.methodology = result.metadata.methodology || 'Systematic Literature Review & Bibliometric Synthesis';
        result.metadata.objective = result.metadata.objective || `Synthesize findings, thematic distributions, and empirical outcomes across ${result.references.length} analyzed publications.`;
      } else if (result.data.length > 0) {
        const readableSheet = result.data[0].sheetName.replace(/_/g, ' ');
        result.metadata.title = `Empirical Analysis and Investigation of ${readableSheet}`;
        result.metadata.researchArea = result.metadata.researchArea || 'Applied Data Analytics';
        result.metadata.methodology = result.metadata.methodology || 'Empirical Quantitative Analysis';
      }
    }

    // 3. Auto-detect chart configuration if none provided
    if (result.charts.length === 0 && result.data.length > 0) {
      for (const sheet of result.data) {
        const cols = sheet.columns;
        const yearCol = cols.find(c => c.toLowerCase().trim() === 'year' || c.toLowerCase().trim() === 'pub_year');
        if (yearCol) {
          result.charts.push({
            chartTitle: 'Publications Distribution by Year',
            type: 'bar',
            xColumn: yearCol,
            yColumns: ['Count'],
            description: 'Chronological publication trend of analyzed literature.'
          });
          break;
        }
        const numericCols = cols.filter(c => {
          return sheet.rows.slice(0, 5).some(r => !isNaN(parseFloat(r[c])) && isFinite(r[c]));
        });
        if (numericCols.length > 0 && cols.length > 1) {
          const catCol = cols.find(c => !numericCols.includes(c)) || cols[0];
          result.charts.push({
            chartTitle: `${numericCols[0]} by ${catCol}`,
            type: 'bar',
            xColumn: catCol,
            yColumns: [numericCols[0]],
            description: `Comparative distribution of ${numericCols[0]} across ${catCol}.`
          });
          break;
        }
      }
    }

    res.json(result);
  } catch (error) {
    console.error('[Paper Draft] Excel parse error:', error);
    res.status(500).json({ error: error.message || 'Failed to parse Excel file.' });
  }
});

// POST /api/paper-draft/generate — Generate a complete paper draft with AI
app.post('/api/paper-draft/generate', checkSupabase, authenticateUser, async (req, res) => {
  try {
    if (!process.env.GEMINI_API_KEY) return res.status(500).json({ error: 'GEMINI_API_KEY not configured.' });

    const {
      metadata, data, references, charts, citationStyle, authors, pageNumberFormat,
      paperType, venueType, targetPages, fontFamily, fontSize, lineSpacing, columns,
      workspace_id
    } = req.body;

    const meta = metadata || {};
    let resolvedTitle = (meta.title || '').trim();
    if (!resolvedTitle) {
      if (references && references.length > 0) {
        resolvedTitle = `Systematic Literature Review and Bibliometric Analysis of ${references.length} Key Studies`;
      } else if (data && data.length > 0) {
        resolvedTitle = `Empirical Investigation and Data Analysis of ${data[0].sheetName.replace(/_/g, ' ')}`;
      } else {
        resolvedTitle = 'Academic Research Paper Draft';
      }
    }

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const style = (citationStyle || 'APA').toUpperCase();
    const resolvedPaperType = (paperType || 'implementation').toLowerCase();
    const resolvedVenue = (venueType || 'conference').toLowerCase();
    const resolvedPages = targetPages || '6-8';
    const isIEEE = style === 'IEEE';

    // Paragraph budget based on page target
    let paragraphsPerSection = '4-5';
    if (resolvedPages === '4-6') paragraphsPerSection = '3-4';
    else if (resolvedPages === '8-12') paragraphsPerSection = '5-6';
    else if (resolvedPages === '12-16') paragraphsPerSection = '6-8';

    // Determine section structure based on paperType
    let sectionTemplates = [];
    switch (resolvedPaperType) {
      case 'review':
        sectionTemplates = [
          { heading: isIEEE ? 'I. Introduction' : '1. Introduction', desc: 'Background, problem significance, review scope, and central research questions.' },
          { heading: isIEEE ? 'II. Review Protocol and Methodology' : '2. Review Methodology', desc: 'Search criteria (PRISMA guidelines), database queries, inclusion/exclusion standards, quality appraisal.' },
          { heading: isIEEE ? 'III. Thematic Synthesis and Classification' : '3. Thematic Synthesis and Classification', desc: 'Taxonomy of analyzed literature, categorization of paradigms, chronological progression.' },
          { heading: isIEEE ? 'IV. Cross-Study Evaluation and Findings' : '4. Cross-Study Evaluation and Findings', desc: 'Critical comparative assessment, empirical evidence synthesis, datasets and benchmark trends.' },
          { heading: isIEEE ? 'V. Open Research Gaps and Challenges' : '5. Open Research Gaps and Challenges', desc: 'Unresolved technical hurdles, empirical contradictions, methodological limitations.' },
          { heading: isIEEE ? 'VI. Future Research Agenda' : '6. Future Research Agenda', desc: 'High-impact prospective pathways, emerging paradigms, architectural recommendations.' },
          { heading: isIEEE ? 'VII. Conclusion' : '7. Conclusion', desc: 'Synthesis of key takeaways, overarching contributions, and closing remarks.' }
        ];
        break;
      case 'survey':
        sectionTemplates = [
          { heading: isIEEE ? 'I. Introduction and Scope' : '1. Introduction and Scope', desc: 'Motivation, definition of domain, boundaries of survey, primary contributions.' },
          { heading: isIEEE ? 'II. Background and Conceptual Foundations' : '2. Background and Foundations', desc: 'Core principles, fundamental architectures, terminology, and problem space.' },
          { heading: isIEEE ? 'III. Taxonomy and Classification of Paradigms' : '3. Taxonomy of Approaches', desc: 'Comprehensive hierarchical taxonomy grouping existing methodologies.' },
          { heading: isIEEE ? 'IV. Comparative Analysis of State-of-the-Art' : '4. Comparative Analysis', desc: 'Feature matrix comparison, trade-offs, strengths and limitations across paradigms.' },
          { heading: isIEEE ? 'V. Open Issues and Industry Adoption Barriers' : '5. Open Issues and Challenges', desc: 'Theoretical bottlenecks, deployment barriers, scalability challenges.' },
          { heading: isIEEE ? 'VI. Future Directions' : '6. Future Directions', desc: 'Roadmap for future investigations and emerging trends.' },
          { heading: isIEEE ? 'VII. Conclusion' : '7. Conclusion', desc: 'Summary of survey findings and perspective.' }
        ];
        break;
      case 'comparative':
        sectionTemplates = [
          { heading: isIEEE ? 'I. Introduction' : '1. Introduction', desc: 'Motivation for comparative evaluation, research questions, summary of findings.' },
          { heading: isIEEE ? 'II. Baseline Methods and Theoretical Background' : '2. Baseline Methods and Background', desc: 'Detailed description of compared algorithms/models, underlying assumptions.' },
          { heading: isIEEE ? 'III. Experimental Setup and Benchmark Protocols' : '3. Benchmark Protocols and Datasets', desc: 'Datasets, preprocessing, hardware environment, evaluation metrics.' },
          { heading: isIEEE ? 'IV. Empirical Results and Performance Benchmarks' : '4. Empirical Results and Benchmarks', desc: 'Comparative quantitative results referencing Table I and Fig. 1.' },
          { heading: isIEEE ? 'V. Statistical Significance and Critical Discussion' : '5. Discussion and Significance', desc: 'Statistical testing, trade-offs, computational overhead, sensitivity analysis.' },
          { heading: isIEEE ? 'VI. Threats to Validity' : '6. Threats to Validity', desc: 'Internal, external, construct, and conclusion validity considerations.' },
          { heading: isIEEE ? 'VII. Conclusion' : '7. Conclusion', desc: 'Summary of empirical outcomes and recommendations for practitioners.' }
        ];
        break;
      case 'methodology':
        sectionTemplates = [
          { heading: isIEEE ? 'I. Introduction' : '1. Introduction', desc: 'Problem definition, limitations of existing methodologies, proposed contribution.' },
          { heading: isIEEE ? 'II. Theoretical Formulation' : '2. Theoretical Formulation', desc: 'Mathematical modeling, formal problem statement, conceptual foundation.' },
          { heading: isIEEE ? 'III. Proposed Framework and Algorithmic Design' : '3. Proposed Framework', desc: 'Step-by-step algorithmic pipeline, architecture, mathematical formulations.' },
          { heading: isIEEE ? 'IV. Analytical Validation and Complexity Analysis' : '4. Analytical Validation', desc: 'Computational complexity (Big-O), convergence guarantees, theoretical soundness.' },
          { heading: isIEEE ? 'V. Empirical Proof of Concept' : '5. Empirical Proof of Concept', desc: 'Prototype validation, preliminary benchmark results referencing figures and tables.' },
          { heading: isIEEE ? 'VI. Discussion' : '6. Discussion', desc: 'Applicability boundaries, comparison with existing paradigms, assumptions.' },
          { heading: isIEEE ? 'VII. Conclusion' : '7. Conclusion', desc: 'Contributions, framework implications, and next steps.' }
        ];
        break;
      case 'casestudy':
        sectionTemplates = [
          { heading: isIEEE ? 'I. Introduction and Domain Context' : '1. Introduction and Domain Context', desc: 'Real-world problem context, operational setting, research objectives.' },
          { heading: isIEEE ? 'II. Case Environment and Background' : '2. Case Environment and Background', desc: 'Domain architecture, operational constraints, organizational or system landscape.' },
          { heading: isIEEE ? 'III. System Implementation and Deployment' : '3. System Implementation', desc: 'Deployment pipeline, integration, data collection, workflow execution.' },
          { heading: isIEEE ? 'IV. Empirical Observations and Outcomes' : '4. Observations and Outcomes', desc: 'Operational metrics, efficiency gains, quantitative outcomes with tables and figures.' },
          { heading: isIEEE ? 'V. Practical Lessons Learned and Guidelines' : '5. Lessons Learned', desc: 'Actionable guidelines, unexpected edge cases, engineering recommendations.' },
          { heading: isIEEE ? 'VI. Limitations and Challenges' : '6. Limitations', desc: 'Generalizability boundaries, domain-specific dependencies.' },
          { heading: isIEEE ? 'VII. Conclusion' : '7. Conclusion', desc: 'Key takeaways and broader industry/academic impact.' }
        ];
        break;
      default: // 'implementation'
        sectionTemplates = [
          { heading: isIEEE ? 'I. Introduction' : '1. Introduction', desc: 'Research problem, technical gap, core contributions, paper organization.' },
          { heading: isIEEE ? 'II. Related Work' : '2. Related Work', desc: 'State-of-the-art review positioning this work against existing approaches with citations.' },
          { heading: isIEEE ? 'III. System Architecture and Methodology' : '3. System Architecture and Methodology', desc: 'Modular architecture, pipeline components, algorithmic formulations.' },
          { heading: isIEEE ? 'IV. Implementation Details' : '4. Implementation Details', desc: 'Technical stack, configurations, execution parameters, operational mechanisms.' },
          { heading: isIEEE ? 'V. Experimental Evaluation and Results' : '5. Experimental Evaluation and Results', desc: 'Benchmark datasets, baseline comparison, metrics, detailed analysis referencing Fig. 1 and Table I.' },
          { heading: isIEEE ? 'VI. Discussion and Threats to Validity' : '6. Discussion and Threats to Validity', desc: 'Ablation insights, computational overhead, internal/external validity.' },
          { heading: isIEEE ? 'VII. Conclusion and Future Work' : '7. Conclusion and Future Work', desc: 'Summary of contributions, empirical validation summary, future extensions.' }
        ];
        break;
    }

    // Build data context for AI
    let dataContext = '';
    if (data && data.length > 0) {
      data.forEach(sheet => {
        dataContext += `\n\nDataset: "${sheet.sheetName}" (${sheet.rows.length} rows)\nColumns: ${sheet.columns.join(', ')}\n`;
        const sample = sheet.rows.slice(0, 25);
        dataContext += 'Sample data rows:\n';
        sample.forEach(row => {
          dataContext += JSON.stringify(row) + '\n';
        });
        if (sheet.rows.length > 25) dataContext += `... and ${sheet.rows.length - 25} more rows\n`;
      });
    }

    let refsContext = '';
    if (references && references.length > 0) {
      refsContext = '\n\nAvailable references to cite:\n';
      references.forEach((ref, i) => {
        refsContext += `[${i + 1}] ${ref.author} (${ref.year}). "${ref.title}." ${ref.journal}\n`;
      });
    }

    let chartsContext = '';
    if (charts && charts.length > 0) {
      chartsContext = '\n\nVisualizations to be referenced in the paper:\n';
      charts.forEach(c => {
        chartsContext += `- ${c.chartTitle} (${c.type} chart): X-axis = ${c.xColumn}, Y-axis = ${c.yColumns.join(', ')}${c.description ? '. ' + c.description : ''}\n`;
      });
    }

    const authorsStr = (authors || []).map(a => `${a.name}${a.affiliation ? ' (' + a.affiliation + ')' : ''}`).join(', ') || 'Research Author';

    let citationInstructions = '';
    switch (style) {
      case 'APA':
        citationInstructions = 'Use APA 7th edition in-text citations like (Author, Year). Use "et al." for 3+ authors. Do not use footnotes for citations.';
        break;
      case 'MLA':
        citationInstructions = 'Use MLA 9th edition in-text citations like (Author Page). Use "et al." for 3+ authors. Do not use footnotes for citations.';
        break;
      case 'IEEE':
        citationInstructions = 'Use IEEE-style numbered citations like [1], [2], [3]. Number references in order of first appearance in the text. NEVER use author-date citations.';
        break;
      case 'CHICAGO':
        citationInstructions = 'Use Chicago author-date in-text citations like (Author Year). Use "et al." for 4+ authors.';
        break;
    }

    const sectionsJsonSchema = sectionTemplates.map(s => `    {
      "heading": "${s.heading}",
      "content": "Deep, rigorous academic text (${paragraphsPerSection} full paragraphs). Focus on ${s.desc} Cite specific references and datasets."
    }`).join(',\n');

    const prompt = `You are a distinguished senior academic researcher, principal investigator, and peer reviewer for IEEE Transactions and ACM Journals. Write an authentic, publication-grade academic paper draft.

PAPER TYPE: ${resolvedPaperType.toUpperCase()} PAPER
TARGET VENUE: ${resolvedVenue.toUpperCase()} (${resolvedVenue === 'conference' ? 'Dense, contribution-focused, rigorous' : 'Comprehensive, exhaustive literature and theoretical depth'})
TARGET PAGE BUDGET: ${resolvedPages} Pages (Require ${paragraphsPerSection} substantial, rich paragraphs per body section)
PAPER TITLE: ${meta.title?.trim() ? `"${meta.title.trim()}"` : `Generate a publication-worthy academic paper title (Provisional topic: "${resolvedTitle}")`}
AUTHORS: ${authorsStr}
RESEARCH AREA: ${meta.researchArea || 'Computer Science and Information Systems'}
OBJECTIVE: ${meta.objective || 'Provide rigorous analysis and evidence-based synthesis of the presented findings and literature'}
METHODOLOGY: ${meta.methodology || 'Systematic Analysis and Empirical Evaluation'}
ABSTRACT GUIDANCE: ${meta.abstract || 'Synthesize findings and contributions concisely'}
KEYWORDS: ${meta.keywords || 'Generate relevant academic keywords'}
CITATION STYLE: ${style}
${citationInstructions}
${dataContext}
${refsContext}
${chartsContext}

══════════════════════════════════════════════════════════════
CRITICAL SCHOLARLY WRITING & ANTI-PLAGIARISM GUIDELINES:
══════════════════════════════════════════════════════════════
1. ABSOLUTE BAN ON AI CLICHES & DETECTABLE BUZZWORDS:
   DO NOT use any of the following words or phrases:
   - "delve", "tapestry", "beacon", "testament", "pivotal", "paramount", "crucial", "vital", "multifaceted", "plethora", "myriad", "cornerstone", "revolutionize", "ever-evolving", "landscape", "underscores", "serves as a testament", "in conclusion", "furthermore", "moreover", "it is noteworthy that", "it is worth mentioning", "in summary", "harnessing", "unraveling".
   Write with natural, human academic prose. Use precise analytical verbs: "demonstrates", "exhibits", "indicates", "corroborates", "delineates", "diverges", "attenuates", "corresponds to".

2. HIGH SYNTACTIC BURSTINESS & PERPLEXITY:
   Vary sentence structure and length dynamically. Alternate concise empirical observations (8-14 words) with complex, compound analytical comparisons (25-40 words) evaluating methodological trade-offs. Avoid beginning consecutive sentences with similar conjunctions or introductory clauses.

3. CONCRETE DATA GROUNDING:
   Every section discussing results or datasets MUST explicitly quote real numbers, categories, distributions, and percentages from the provided spreadsheet data rows. Do not use generic statements like "the model performed well". State exact values: "Method C achieved 95.1% accuracy compared to Method B at 88.3%."

4. RIGOROUS CRITICAL STANCE:
   Write with authentic scholarly skepticism. Discuss boundary conditions, computational trade-offs, potential latency penalties, data distribution skew, and threats to validity. Avoid promotional or marketing language.

5. SECTIONS REQUIRED:
   Write each of the following ${sectionTemplates.length} sections with ${paragraphsPerSection} full, detailed paragraphs (NOT bullet points):
${sectionTemplates.map((s, idx) => `   ${idx + 1}. ${s.heading}: ${s.desc}`).join('\n')}

6. FIGURE & TABLE REFERENCES:
   - Refer to figures as "${isIEEE ? 'Fig. 1' : 'Figure 1'}".
   - Refer to tables as "${isIEEE ? 'Table I' : 'Table 1'}".

Return ONLY a valid JSON object matching this exact schema (no markdown fences, no explanatory text):
{
  "title": "${meta.title?.trim() || 'Descriptive Academic Title'}",
  "abstract": "${isIEEE ? 'Dense 150-250 word IEEE-style abstract (no citations in abstract).' : 'Dense 200-250 word abstract stating problem, method, results, and significance.'}",
  "keywords": ["keyword1", "keyword2", "keyword3", "keyword4", "keyword5"],
  "sections": [
${sectionsJsonSchema}
  ],
  "acknowledgments": "Brief formal acknowledgment of funding, institutional facilities, and contributors."
}`;

    const result = await callGeminiWithRetry(genAI, prompt);
    let text = result.response.text();

    // Extract JSON
    const jsonStart = text.indexOf('{');
    const jsonEnd = text.lastIndexOf('}');
    if (jsonStart !== -1 && jsonEnd !== -1) {
      text = text.slice(jsonStart, jsonEnd + 1);
    }

    let draft;
    try {
      draft = JSON.parse(text);
    } catch (parseErr) {
      console.warn('[Paper Draft] JSON parse retry with cleanup:', parseErr.message);
      const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
      const s = cleaned.indexOf('{');
      const e = cleaned.lastIndexOf('}');
      if (s !== -1 && e !== -1) {
        draft = JSON.parse(cleaned.slice(s, e + 1));
      } else {
        throw new Error('Failed to parse AI-generated draft into valid structure: ' + parseErr.message);
      }
    }

    if (draft && !draft.title) {
      draft.title = resolvedTitle;
    }

    // Format references in the chosen citation style
    const formattedReferences = (references || []).map((ref, i) => ({
      ...ref,
      formatted: formatReference(ref, style, i)
    }));

    // Build chart data objects from the datasets
    const chartData = [];
    if (charts && charts.length > 0 && data && data.length > 0) {
      charts.forEach((chartConfig, idx) => {
        // Find the data sheet that contains the referenced columns
        let sourceSheet = data[0]; // default to first data sheet
        for (const sheet of data) {
          if (sheet.columns.includes(chartConfig.xColumn)) {
            sourceSheet = sheet;
            break;
          }
        }

        let labels = [];
        let datasets = [];

        const isCount = chartConfig.yColumns.length === 1 && chartConfig.yColumns[0].toLowerCase() === 'count';

        if (isCount) {
          // Frequency aggregation for categorical/chronological values
          const counts = {};
          sourceSheet.rows.forEach(r => {
            const val = (r[chartConfig.xColumn] ?? '').toString().trim();
            if (val) counts[val] = (counts[val] || 0) + 1;
          });
          labels = Object.keys(counts).sort((a, b) => {
            const na = Number(a), nb = Number(b);
            if (!isNaN(na) && !isNaN(nb)) return na - nb;
            return a.localeCompare(b);
          });
          datasets = [{
            label: 'Count',
            data: labels.map(l => counts[l]),
            backgroundColor: 'rgba(124,92,255,0.7)',
            borderColor: 'rgba(124,92,255,1)',
            borderWidth: 2,
          }];
        } else {
          labels = sourceSheet.rows.map(r => r[chartConfig.xColumn] || '').filter(Boolean);
          datasets = chartConfig.yColumns.map((yCol, dIdx) => {
            const colors = ['rgba(124,92,255,0.7)', 'rgba(6,214,160,0.7)', 'rgba(255,107,107,0.7)', 'rgba(255,209,102,0.7)', 'rgba(17,138,178,0.7)'];
            const borderColors = ['rgba(124,92,255,1)', 'rgba(6,214,160,1)', 'rgba(255,107,107,1)', 'rgba(255,209,102,1)', 'rgba(17,138,178,1)'];
            return {
              label: yCol,
              data: sourceSheet.rows.map(r => parseFloat(r[yCol]) || 0),
              backgroundColor: colors[dIdx % colors.length],
              borderColor: borderColors[dIdx % borderColors.length],
              borderWidth: 2,
            };
          });
        }

        chartData.push({
          figureNumber: idx + 1,
          title: chartConfig.chartTitle || `Figure ${idx + 1}`,
          description: chartConfig.description || '',
          type: chartConfig.type || 'bar',
          data: { labels, datasets },
          options: {
            responsive: true,
            plugins: {
              title: { display: true, text: chartConfig.chartTitle || `Figure ${idx + 1}` },
              legend: { display: chartConfig.yColumns.length > 1 },
            },
            scales: chartConfig.type !== 'pie' ? {
              y: { beginAtZero: true, title: { display: true, text: chartConfig.yColumns.join(' / ') } },
              x: { title: { display: true, text: chartConfig.xColumn } }
            } : undefined
          }
        });
      });
    }

    // Build data tables for the PDF
    const dataTables = (data || []).map((sheet, idx) => ({
      tableNumber: idx + 1,
      title: `Table ${idx + 1}: ${sheet.sheetName}`,
      columns: sheet.columns,
      rows: sheet.rows.slice(0, 100), // Limit to 100 rows for PDF
      totalRows: sheet.rows.length
    }));

    res.json({
      draft,
      formattedReferences,
      chartData,
      dataTables,
      citationStyle: style,
      pageNumberFormat: pageNumberFormat || 'arabic',
      authors: authors || [],
      paperType: resolvedPaperType,
      venueType: resolvedVenue,
      targetPages: resolvedPages,
      fontFamily: fontFamily || 'Times New Roman',
      fontSize: fontSize || '10',
      lineSpacing: lineSpacing || '1.0',
      columns: columns || 'auto'
    });

  } catch (error) {
    console.error('[Paper Draft] Generation error:', error);
    res.status(500).json({ error: error.message || 'Failed to generate paper draft.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Backend API running on http://localhost:${PORT}`);
});
