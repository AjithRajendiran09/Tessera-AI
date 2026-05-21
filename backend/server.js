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

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
let supabase;

if (supabaseUrl && supabaseKey) {
  supabase = createClient(supabaseUrl, supabaseKey);
}

// Helper to check Supabase configuration
const checkSupabase = (req, res, next) => {
  if (!supabase) {
    return res.status(500).json({ error: 'Supabase credentials not configured on backend.' });
  }
  next();
};

// --- API ROUTES ---

// DOMAINS
app.get('/api/domains', checkSupabase, async (req, res) => {
  const { data, error } = await supabase.from('domains').select('*').order('name');
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

app.post('/api/domains', checkSupabase, async (req, res) => {
  const { data, error } = await supabase.from('domains').insert(req.body).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json(data);
});

app.delete('/api/domains/:id', checkSupabase, async (req, res) => {
  const { error } = await supabase.from('domains').delete().eq('id', req.params.id);
  if (error) return res.status(400).json({ error: error.message });
  res.status(204).send();
});

app.get('/api/domains/:id/generate-lit-review', checkSupabase, async (req, res) => {
  try {
    const domainId = req.params.id.trim();
    // Get Domain
    const { data: domain, error: dErr } = await supabase.from('domains').select('*').eq('id', domainId).single();
    if (dErr || !domain) {
      console.error('Domain fetch error:', dErr);
      return res.status(404).json({ error: 'Domain not found' });
    }

    // Get Papers
    const { data: papers, error: pErr } = await supabase.from('papers').select('*').eq('domain_id', domainId);
    if (pErr) console.error('Papers fetch error:', pErr);
    
    // Get Gaps
    const { data: gaps, error: gErr } = await supabase.from('research_gaps').select('*').eq('domain_id', domainId);
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
app.post('/api/generate-pitch', checkSupabase, async (req, res) => {
  try {
    const { gapIds, idea } = req.body;
    if (!gapIds || gapIds.length === 0) {
      return res.status(400).json({ error: 'No research gaps provided.' });
    }

    // Fetch the specific gaps
    const { data: gaps, error: gErr } = await supabase.from('research_gaps').select('title, description').in('id', gapIds);
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
app.get('/api/papers', checkSupabase, async (req, res) => {
  const { data, error } = await supabase
    .from('papers')
    .select('*, domains(name, color, icon)')
    .order('year', { ascending: false });
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

app.get('/api/papers/:id', checkSupabase, async (req, res) => {
  const { data, error } = await supabase
    .from('papers')
    .select('*, domains(name, color, icon)')
    .eq('id', req.params.id)
    .single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

app.post('/api/papers', checkSupabase, async (req, res) => {
  const { data, error } = await supabase.from('papers').insert(req.body).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json(data);
});

app.put('/api/papers/:id', checkSupabase, async (req, res) => {
  const { data, error } = await supabase.from('papers').update(req.body).eq('id', req.params.id).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

app.delete('/api/papers/:id', checkSupabase, async (req, res) => {
  const { error } = await supabase.from('papers').delete().eq('id', req.params.id);
  if (error) return res.status(400).json({ error: error.message });
  res.status(204).send();
});

// RESEARCH GAPS
app.get('/api/gaps', checkSupabase, async (req, res) => {
  const { data, error } = await supabase
    .from('research_gaps')
    .select('*, domains(name, color, icon)')
    .order('created_at');
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

app.post('/api/gaps', checkSupabase, async (req, res) => {
  const { data, error } = await supabase.from('research_gaps').insert(req.body).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json(data);
});

app.put('/api/gaps/:id', checkSupabase, async (req, res) => {
  const { data, error } = await supabase.from('research_gaps').update(req.body).eq('id', req.params.id).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

app.delete('/api/gaps/:id', checkSupabase, async (req, res) => {
  const { error } = await supabase.from('research_gaps').delete().eq('id', req.params.id);
  if (error) return res.status(400).json({ error: error.message });
  res.status(204).send();
});

// PAPER-GAP LINKS
app.post('/api/paper-gaps', checkSupabase, async (req, res) => {
  const { paper_id, gap_id } = req.body;
  const { error } = await supabase.from('paper_gaps').insert({ paper_id, gap_id });
  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json({ success: true });
});

app.get('/api/papers/:id/gaps', checkSupabase, async (req, res) => {
  const { data, error } = await supabase
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

app.post('/api/parse-pdf', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No PDF file uploaded.' });
    if (!process.env.GEMINI_API_KEY) return res.status(500).json({ error: 'GEMINI_API_KEY not configured on backend.' });

    // Extract text from PDF
    const pdfData = await pdfParse(req.file.buffer);
    const rawText = pdfData.text.substring(0, 30000);

    // Fetch existing domains from Supabase for matching
    let domainList = [];
    if (supabase) {
      const { data } = await supabase.from('domains').select('id, name');
      if (data) domainList = data;
    }
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
      "relevance": "A 1-2 sentence explanation of how this paper relates to the user's existing research domains: [${domainNames.join(', ')}]. If the paper is unrelated to any of these domains, explicitly state that.",
      "relevance_score": 85,
      "category": "One of: Foundation, Safety & Guardrails, Drift Detection, Provenance, Multi-Agent, Formal Verification"
    }

    IMPORTANT for research_gaps: Identify 1-3 genuine open research questions, unresolved challenges, or future work directions mentioned or implied by the paper. These should be actionable gaps that a PhD researcher could investigate. If the paper doesn't clearly suggest any gaps, return an empty array [].
    
    IMPORTANT for relevance_score: This score measures how relevant the paper is to the user's EXISTING research focus, which currently covers these domains: [${domainNames.join(', ')}]. 
    - If the paper directly addresses one of these domains, score 60-90.
    - If the paper is tangentially related (shares some methods or concepts), score 30-55.
    - If the paper is completely unrelated to any of these domains (e.g., a paper about electrical safety training when the user studies AI compliance), score 5-20.
    - Only truly foundational papers that directly advance one of the user's domains should score 80+.
    - Do NOT inflate scores. A paper outside the user's research area should never exceed 25.

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

    // Match domain name to domain_id — or create a new domain
    if (parsedData.domain && supabase) {
      const match = domainList.find(d => 
        d.name.toLowerCase() === parsedData.domain.toLowerCase()
      );
      if (match) {
        parsedData.domain_id = match.id;
      } else {
        // Auto-create the new domain
        const domainColors = ['#7c5cff', '#06d6a0', '#ff6b6b', '#ffd166', '#118ab2', '#ef476f', '#073b4c', '#e07aff', '#06bcc1', '#f78c6b'];
        const domainIcons = ['📄', '🔬', '🛡️', '⚙️', '🧠', '📊', '🔗', '🤖', '📐', '🏗️', '📋', '💡'];
        const randomColor = domainColors[Math.floor(Math.random() * domainColors.length)];
        const randomIcon = domainIcons[Math.floor(Math.random() * domainIcons.length)];

        console.log(`Creating new domain: "${parsedData.domain}"`);
        const { data: newDomain, error: domErr } = await supabase
          .from('domains')
          .insert({ 
            name: parsedData.domain, 
            color: randomColor, 
            icon: randomIcon,
            description: `Auto-created from paper: ${parsedData.title?.substring(0, 80) || 'AI-detected domain'}`
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

    // Auto-create research gaps in Supabase
    if (parsedData.research_gaps && Array.isArray(parsedData.research_gaps) && parsedData.research_gaps.length > 0 && supabase) {
      const createdGaps = [];
      for (const gap of parsedData.research_gaps) {
        const { data: newGap, error: gapErr } = await supabase
          .from('research_gaps')
          .insert({
            title: gap.title,
            description: `${gap.description} (Identified from: ${parsedData.title?.substring(0, 60) || 'uploaded paper'})`,
            domain_id: parsedData.domain_id || null,
            severity: gap.severity || 'medium',
            status: 'open'
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

// DASHBOARD STATS
app.get('/api/dashboard/stats', checkSupabase, async (req, res) => {
  try {
    const [
      { data: papers, error: pErr },
      { data: domains, error: dErr },
      { data: gaps, error: gErr }
    ] = await Promise.all([
      supabase.from('papers').select('*, domains(name, color, icon)').order('year', { ascending: false }),
      supabase.from('domains').select('*').order('name'),
      supabase.from('research_gaps').select('*, domains(name, color, icon)').order('created_at')
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
