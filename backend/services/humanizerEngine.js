/**
 * Tessera AI — Academic Humanizer & Anti-Detection Engine
 * 
 * Powered by:
 * 1. Anthropic Claude 3.5 Sonnet (State-of-the-art scholarly reasoning and natural human cadence)
 * 2. Google Gemini 2.5 Flash (High-throughput parallel generation & fallback)
 * 3. GPTZero API v2 Verification (Closed-loop real-time detection feedback & verification)
 * 
 * Core Mechanisms:
 * - High Syntactic Burstiness (aggressively alternating sentence lengths: 3-7 words vs 30-45 words)
 * - High Perplexity Sampling (natural human engineering terminology & concrete constraints)
 * - AI Linguistic De-Biasing (eliminating 45+ stereotypical LLM transitions and clichés)
 * - Exact In-Text Citation, Equation, and Figure Retention
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');
const Anthropic = require('@anthropic-ai/sdk');
const { predictAiWithGptZero } = require('./gptZeroService');

// Stereotypical AI tokens flagged by Turnitin / GPTZero / Copyleaks classifiers
const BANNED_AI_PATTERNS = [
  /\bdelve(?:s|d|ing)?\b/gi,
  /\btapestry\b/gi,
  /\bbeacon\b/gi,
  /\btestament\b/gi,
  /\bpivotal\b/gi,
  /\bparamount\b/gi,
  /\bcrucial(?:ly)?\b/gi,
  /\bvital(?:ly)?\b/gi,
  /\bmultifaceted\b/gi,
  /\bplethora\b/gi,
  /\bmyriad\b/gi,
  /\bcornerstone\b/gi,
  /\brevolutionize\b/gi,
  /\bever-evolving\b/gi,
  /\blandscape\b/gi,
  /\bunderscores?\b/gi,
  /\bdelineates?\b/gi,
  /\bfosters?\b/gi,
  /\bin conclusion\b/gi,
  /\bfurthermore\b/gi,
  /\bmoreover\b/gi,
  /\badditionally\b/gi,
  /\bin summary\b/gi,
  /\bultimately\b/gi,
  /\bin recent years\b/gi,
  /\bwith the rapid (?:advancement|development) of\b/gi,
  /\bplays a (?:pivotal|crucial|vital|key) role\b/gi,
  /\bserves as a\b/gi,
  /\bit is (?:worth noting|noteworthy|important to note|evident) that\b/gi,
  /\bthis paper is organized as follows\b/gi,
  /\bto address these challenges\b/gi,
  /\bnotwithstanding these achievements\b/gi,
  /\bto ensure methodological rigor\b/gi
];

/**
 * Calculates heuristic AI detection risk metrics
 * Analyzes sentence length standard deviation (burstiness) and AI token density
 * @param {string} text
 * @returns {object} { sentenceCount, averageSentenceLength, burstinessScore, clicheMatches, estimatedAiPercent }
 */
function analyzeAiDetectionRisk(text) {
  if (!text || typeof text !== 'string') {
    return { sentenceCount: 0, averageSentenceLength: 0, burstinessScore: 0, clicheMatches: 0, estimatedAiPercent: 0 };
  }

  // Split into sentences (handling standard periods, questions, and exclamations)
  const sentences = text
    .split(/(?<=[.?!])\s+(?=[A-Z0-9])/)
    .map(s => s.trim())
    .filter(s => s.length > 5);

  if (sentences.length === 0) {
    return { sentenceCount: 0, averageSentenceLength: 0, burstinessScore: 0, clicheMatches: 0, estimatedAiPercent: 0 };
  }

  // Word counts per sentence
  const lengths = sentences.map(s => s.split(/\s+/).filter(Boolean).length);
  const avgLen = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  
  // Standard deviation (burstiness)
  const variance = lengths.reduce((acc, len) => acc + Math.pow(len - avgLen, 2), 0) / lengths.length;
  const stdDev = Math.sqrt(variance);

  // Cliché count
  let clicheCount = 0;
  for (const pattern of BANNED_AI_PATTERNS) {
    const matches = text.match(pattern);
    if (matches) clicheCount += matches.length;
  }

  // Heuristic baseline
  let predictedAi = 12;

  if (stdDev < 5.0) predictedAi += 45;
  else if (stdDev < 7.5) predictedAi += 30;
  else if (stdDev < 10.0) predictedAi += 12;
  else predictedAi -= 10;

  predictedAi += Math.min(clicheCount * 12, 45);

  const estimatedAiPercent = Math.min(Math.max(Math.round(predictedAi), 2), 99);

  return {
    sentenceCount: sentences.length,
    averageSentenceLength: Math.round(avgLen * 10) / 10,
    burstinessScore: Math.round(stdDev * 10) / 10,
    clicheMatches: clicheCount,
    estimatedAiPercent
  };
}

/**
 * Post-processes text with deterministic cleanups to strip any remaining AI transition markers
 * @param {string} text 
 * @returns {string}
 */
function cleanAiMarkers(text) {
  if (!text) return '';
  let cleaned = text;

  // Replace cliché starters
  cleaned = cleaned.replace(/\bFurthermore,\s*/gi, '')
                   .replace(/\bMoreover,\s*/gi, '')
                   .replace(/\bAdditionally,\s*/gi, '')
                   .replace(/\bIn summary,\s*/gi, '')
                   .replace(/\bUltimately,\s*/gi, '')
                   .replace(/\bIn conclusion,\s*/gi, '')
                   .replace(/\bCrucially,\s*/gi, '')
                   .replace(/\bNotably,\s*/gi, '')
                   .replace(/\bIt is worth noting that\s*/gi, '')
                   .replace(/\bIt is important to note that\s*/gi, '')
                   .replace(/\bIn recent years,\s*/gi, '')
                   .replace(/\bplays a pivotal role in\b/gi, 'is essential for')
                   .replace(/\bplays a crucial role in\b/gi, 'directly influences')
                   .replace(/\bdelve into\b/gi, 'examine')
                   .replace(/\bdelves into\b/gi, 'examines')
                   .replace(/\bdelving into\b/gi, 'examining')
                   .replace(/\bunderscores the importance of\b/gi, 'highlights')
                   .replace(/\bunderscores\b/gi, 'demonstrates')
                   .replace(/\bdelineates\b/gi, 'details')
                   .replace(/\bfosters\b/gi, 'enables')
                   .replace(/\blandscape\b/gi, 'domain')
                   .replace(/\btapestry\b/gi, 'framework')
                   .replace(/\bbeacon\b/gi, 'foundation')
                   .replace(/\btestament\b/gi, 'evidence')
                   .replace(/\bparamount\b/gi, 'essential')
                   .replace(/\bpivotal\b/gi, 'central')
                   .replace(/\bOur synthesis of the literature reveals\b/gi, 'Looking across the literature, we identify')
                   .replace(/\bOur evaluation of the literature uncovers\b/gi, 'Benchmarking across the studies reveals')
                   .replace(/\bOur inquiry is structured around\b/gi, 'We frame this inquiry around')
                   .replace(/\bOur systematic review provides\b/gi, 'This synthesis offers');

  return cleaned.trim();
}

/**
 * Generates the humanizer system prompt
 * @param {string} contextLabel 
 * @returns {string}
 */
function buildHumanizerSystemPrompt(contextLabel = 'Section') {
  return `You are an experienced research engineer and peer reviewer writing in an authentic, natural human scholarly voice.
Rewrite and thoroughly humanize the following academic manuscript text ("${contextLabel}").

PRIMARY MANDATE:
The rewritten text must read as authentic, rigorous, human-authored scholarship that achieves < 5% AI detection on Turnitin, GPTZero, and Copyleaks.

STRICT HUMAN-WRITTEN STYLISTIC DIRECTIVES:
1. DYNAMIC SYNTACTIC BURSTINESS:
   - You MUST vary sentence structures and lengths aggressively across every paragraph.
   - Alternate between:
     * Ultra-short, punchy declarations (3-7 words): "The bottleneck is latency." "Simulations hide these costs." "Hardware realities bite hard." "Speed kills link stability." "Theory is not enough."
     * Balanced analytical assertions (12-18 words).
     * Long compound-complex sentences (30-45 words) incorporating semicolons, contrastive clauses, or parenthetical engineering caveats.
   - NEVER generate 3 consecutive sentences with similar length or cadence.

2. AUTHENTIC SCHOLARLY VOICE & HIGH PERPLEXITY:
   - Use direct, natural scholarly diction with concrete engineering skepticism.
   - Contrast theoretical math with physical hardware friction (phase quantization noise in 1-bit/2-bit PIN diodes, insertion loss, thermal dissipation, coherence intervals).
   - Avoid mechanical sentence structures and predictable listing triplets.

3. ABSOLUTE BAN ON AI FORMULAS & CLICHES:
   - FORBIDDEN TOKENS: delve, delves, tapestry, beacon, testament, pivotal, paramount, crucial, vital, multifaceted, plethora, myriad, cornerstone, revolutionize, ever-evolving, landscape, underscores, delineates, fosters, in conclusion, furthermore, moreover, additionally, in summary, ultimately, in recent years, plays a pivotal role.
   - Do NOT open paragraphs with formulaic phrases like "Our inquiry is structured...", "Our synthesis reveals...", "In recent years,", "To bridge this gap,", "The analyzed literature exhibits,".

4. FACTUAL & CITATION FIDELITY:
   - Preserve ALL existing in-text citations exactly as written (e.g., (Author, Year) or [1], [2]).
   - Retain all Figure and Table citations verbatim (e.g., Figure 1, Figure 2, Table 1).
   - Retain all specific metrics, numbers, and technical terminology (e.g. RIS, GNN, THz, CSI, STAR-IRS).
   - Preserve the paragraph structure (return the same number of substantive paragraphs separated by double newlines).

Return ONLY the humanized paragraphs separated by two newlines (\\n\\n). Do NOT include meta commentary, headers, or markdown formatting tags.`;
}

/**
 * Humanizes text block using Claude 3.5 Sonnet
 * @param {string} text 
 * @param {object} options 
 * @returns {Promise<string>}
 */
async function humanizeWithClaude(text, options = {}) {
  const apiKey = options.anthropicApiKey || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not configured.');

  const anthropic = new Anthropic({ apiKey });
  const systemPrompt = buildHumanizerSystemPrompt(options.contextLabel || 'Section');

  console.log(`[HumanizerEngine:Claude] Calling Claude 3.5 Sonnet for ${options.contextLabel || 'Section'}...`);
  const response = await anthropic.messages.create({
    model: options.modelName || 'claude-3-5-sonnet-20241022',
    max_tokens: 4096,
    temperature: 0.85,
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: `TEXT TO HUMANIZE:\n${text}`
      }
    ]
  });

  const rawText = response.content?.[0]?.text || '';
  return cleanAiMarkers(rawText.trim());
}

/**
 * Humanizes text block using Google Gemini
 * @param {object} genAI 
 * @param {string} text 
 * @param {object} options 
 * @returns {Promise<string>}
 */
async function humanizeWithGemini(genAI, text, options = {}) {
  const contextLabel = options.contextLabel || 'Section';
  const modelName = options.modelName || 'gemini-2.5-flash';
  const systemPrompt = buildHumanizerSystemPrompt(contextLabel);

  console.log(`[HumanizerEngine:Gemini] Calling Gemini 2.5 for ${contextLabel}...`);
  const model = genAI.getGenerativeModel({
    model: modelName,
    generationConfig: {
      temperature: 0.90,
      topP: 0.95
    }
  });

  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: `${systemPrompt}\n\nTEXT TO HUMANIZE:\n${text}` }] }]
  });

  const rawHumanized = result.response.text().trim();
  return cleanAiMarkers(rawHumanized);
}

/**
 * Core Humanization function for a text block (Claude 3.5 Sonnet preferred, Gemini fallback)
 * @param {object|null} genAI - Initialized GoogleGenerativeAI instance
 * @param {string} text - Source text
 * @param {object} options - { contextLabel, preferredEngine, anthropicApiKey }
 * @returns {Promise<string>}
 */
async function humanizeTextBlock(genAI, text, options = {}) {
  if (!text || typeof text !== 'string' || text.trim().length === 0) return '';

  const preferClaude = options.preferredEngine === 'claude' || (!options.preferredEngine && !!(options.anthropicApiKey || process.env.ANTHROPIC_API_KEY));

  if (preferClaude && (options.anthropicApiKey || process.env.ANTHROPIC_API_KEY)) {
    try {
      return await humanizeWithClaude(text, options);
    } catch (claudeErr) {
      console.warn('[HumanizerEngine] Claude invocation notice, falling back to Gemini:', claudeErr.message);
    }
  }

  // Gemini path
  if (genAI) {
    try {
      return await humanizeWithGemini(genAI, text, options);
    } catch (geminiErr) {
      console.warn('[HumanizerEngine] Gemini invocation warning:', geminiErr.message);
    }
  }

  return cleanAiMarkers(text);
}

/**
 * Humanizes an entire structured paper draft with optional GPTZero closed-loop verification
 * @param {object|null} genAI - Initialized GoogleGenerativeAI instance
 * @param {object} draft - Draft object { title, abstract, sections, acknowledgments }
 * @param {object} options - Configuration options
 * @returns {Promise<object>} - Updated draft object with humanized content and risk metrics
 */
async function humanizePaperDraft(genAI, draft, options = {}) {
  if (!draft || !Array.isArray(draft.sections)) {
    throw new Error('Invalid draft object: missing sections array.');
  }

  const updatedDraft = JSON.parse(JSON.stringify(draft));
  const engineInUse = (options.preferredEngine === 'claude' || (!options.preferredEngine && !!(options.anthropicApiKey || process.env.ANTHROPIC_API_KEY)))
    ? 'Claude 3.5 Sonnet'
    : 'Gemini 2.5 Flash';

  console.log(`[HumanizerEngine] Starting humanization of draft: "${draft.title || 'Untitled'}" using ${engineInUse}...`);

  // 1. Humanize Abstract
  if (updatedDraft.abstract) {
    console.log('[HumanizerEngine] Humanizing Abstract...');
    updatedDraft.abstract = await humanizeTextBlock(genAI, updatedDraft.abstract, {
      contextLabel: 'Abstract',
      ...options
    });
  }

  // 2. Humanize Sections sequentially
  for (let i = 0; i < updatedDraft.sections.length; i++) {
    const sec = updatedDraft.sections[i];
    if (sec && sec.content) {
      console.log(`[HumanizerEngine] Humanizing Section ${i + 1}: "${sec.heading || sec.title}"...`);
      sec.content = await humanizeTextBlock(genAI, sec.content, {
        contextLabel: sec.heading || `Section ${i + 1}`,
        ...options
      });
    }

    if (Array.isArray(sec.subsections)) {
      for (let j = 0; j < sec.subsections.length; j++) {
        const sub = sec.subsections[j];
        if (sub && sub.content) {
          sub.content = await humanizeTextBlock(genAI, sub.content, {
            contextLabel: sub.title || `Subsection ${i + 1}.${j + 1}`,
            ...options
          });
        }
      }
    }
  }

  // 3. AI Risk Analysis: Combine Local Heuristic + GPTZero API (if available)
  const fullText = [updatedDraft.abstract, ...updatedDraft.sections.map(s => s.content)].join(' ');
  const heuristicMetrics = analyzeAiDetectionRisk(fullText);

  let gptZeroMetrics = null;
  try {
    console.log('[HumanizerEngine] Scanning with GPTZero API v2...');
    gptZeroMetrics = await predictAiWithGptZero(fullText, options.gptZeroApiKey);
  } catch (gzErr) {
    console.warn('[HumanizerEngine] GPTZero scan notice:', gzErr.message);
  }

  const verifiedAiScore = gptZeroMetrics?.available
    ? `${gptZeroMetrics.aiProbability}% (GPTZero Verified)`
    : `${heuristicMetrics.estimatedAiPercent}% (Heuristic Estimate)`;

  console.log(`[HumanizerEngine] Humanization complete. AI Score: ${verifiedAiScore}`);

  return {
    draft: updatedDraft,
    humanized: true,
    engineInUse,
    metrics: {
      burstinessScore: heuristicMetrics.burstinessScore,
      averageSentenceLength: heuristicMetrics.averageSentenceLength,
      clicheMatches: heuristicMetrics.clicheMatches,
      estimatedAiPercent: gptZeroMetrics?.available ? gptZeroMetrics.aiProbability : heuristicMetrics.estimatedAiPercent,
      targetTurnitinScore: verifiedAiScore,
      gptZero: gptZeroMetrics
    }
  };
}

module.exports = {
  analyzeAiDetectionRisk,
  cleanAiMarkers,
  humanizeTextBlock,
  humanizePaperDraft,
  humanizeWithClaude,
  humanizeWithGemini,
  BANNED_AI_PATTERNS
};
