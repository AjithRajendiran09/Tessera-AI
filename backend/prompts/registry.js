/**
 * Tessera AI — Research-Grade Prompt Versioning Registry
 * Maintains declarative, versioned, reproducible system prompts.
 */

const PROMPTS = {
  paper_analysis_v2: {
    id: 'paper_analysis_v2',
    version: 2,
    name: 'Evidence-Grounded Paper Analysis',
    model: 'gemini-2.5-flash',
    description: 'Extracts research contributions, limitations, ontology, and research gaps with explicit page numbers, section headers, verbatim quotes, and confidence scores.',
    systemInstruction: `You are an elite academic peer reviewer and research intelligence analyst.
Analyze the provided academic research paper with rigorous scientific integrity.
Rules:
1. Every claim, contribution, limitation, and gap MUST cite the exact page number (e.g. from === PAGE [X] === markers in the text) and section title.
2. Provide verbatim quotes (15-40 words) as grounding evidence.
3. Assign a calibrated confidence score (0.00 to 1.00) and confidence tier:
   - HIGH (0.85 - 1.00): Explicitly stated in the text with empirical proof.
   - MEDIUM (0.65 - 0.84): Strongly implied with reasonable context.
   - LOW (0.40 - 0.64): Weakly supported or ambiguous.
   - REQUIRES_HUMAN_REVIEW (< 0.40 or speculative): Needs researcher manual inspection.
4. Classify research gaps into one of the 12 formal categories:
   Methodological Gap, Dataset Gap, Evaluation Gap, Theoretical Gap, Technology Gap, Domain Gap, Temporal Gap, Geographic Gap, Population Gap, Comparative Gap, Reproducibility Gap, Security/Privacy Gap.
5. Return ONLY a valid JSON object matching the requested schema. No markdown wrapping, no extra prose.`,
    buildUserPrompt: ({ text, researchTopic, domainNames = [], customSchemaInstructions = '' }) => `
Extract comprehensive, evidence-grounded research data from the document below.

CRITICAL INSTRUCTIONS:
- Researcher Research Topic: "${researchTopic || 'General Computer Science / AI'}"
- Available Domains: [${domainNames.join(', ')}]
${customSchemaInstructions ? `- Custom Instructions:\n${customSchemaInstructions}` : ''}
- STRICT RELEVANCE SCORING RUBRIC (Zero confirmation bias):
  * 0-15: Completely unrelated domain or field (e.g. biology/medicine when topic is computer science/privacy verification).
  * 16-40: Slightly tangential domain with zero technical overlap.
  * 41-70: Moderately related methodology, datasets, or theoretical foundation.
  * 71-100: Core target research directly investigating the exact research problem.
  * CRITICAL: Do NOT inflate relevance score if the domain is unrelated!

REQUIRED JSON SCHEMA:
{
  "title": "Full formal title",
  "authors": "Comma-separated authors",
  "year": 2024,
  "venue": "Conference or Journal name",
  "publisher": "IEEE | ACM | Springer | Elsevier | Nature | ArXiv | null",
  "scopus_indexed": false,
  "quartile": "Q1 | Q2 | Q3 | Q4 | null",
  "doi": "10.xxxx/xxxxx or null",
  "url": "https://doi.org/... or null",
  "research_domain": "Concise domain name (2-4 words)",
  "domain": "Best matching domain from provided list or new suggestion",
  "category": "Foundation | Safety & Guardrails | Multi-Agent | Formal Verification | Empirical Study",

  "evidence_claims": [
    {
      "claim_type": "contribution | limitation | methodology | dataset | finding | result",
      "claim": "Specific concise statement of claim",
      "page_number": 1,
      "section": "e.g. Section 4.2 Evaluation",
      "exact_quote": "Verbatim 15-40 word snippet from text supporting this claim",
      "confidence_score": 0.92,
      "confidence_tier": "HIGH | MEDIUM | LOW | REQUIRES_HUMAN_REVIEW"
    }
  ],

  "ontology": {
    "methods": [
      { "name": "Method name", "category": "Deep Learning | Formal Logic | Empirical", "description": "1 sentence" }
    ],
    "datasets": [
      { "name": "Dataset name", "size": "e.g. 50k samples", "modality": "Text | Image | Tabular", "is_synthetic": false }
    ],
    "findings": [
      { "statement": "Key quantitative or qualitative finding", "metric_name": "Accuracy | F1 | Latency", "metric_value": "94.2%", "baseline_comparison": "Outperforms BERT by 3.4%" }
    ]
  },

  "research_gaps": [
    {
      "title": "Specific concise research gap title",
      "description": "2-3 sentences explaining the unresolved challenge or blind spot",
      "gap_category": "Methodological Gap | Dataset Gap | Evaluation Gap | Theoretical Gap | Technology Gap | Domain Gap | Temporal Gap | Geographic Gap | Population Gap | Comparative Gap | Reproducibility Gap | Security/Privacy Gap",
      "severity": "critical | high | medium | low",
      "confidence_score": 0.88,
      "evidence_snippets": [
        { "page": 8, "section": "Limitations / Discussion", "quote": "Verbatim quote acknowledging limitation or open issue" }
      ],
      "suggested_direction": "Concrete recommended experimental or theoretical direction to address this gap",
      "heuristic_factors": {
        "is_explicit_limitation": true,
        "is_future_work": true,
        "lack_of_evaluation": false
      }
    }
  ],

  "personal": {
    "relevance_score": 0,
    "relevance_explanation": "Objective assessment of why this paper is or is not relevant to '${researchTopic}'. If unrelated discipline, explicitly state the mismatch.",
    "missing_component": "What key component is missing from this paper to directly solve '${researchTopic}'"
  },

  "custom_fields": {}
}

DOCUMENT CONTENT:
${text}
`
  },

  gap_detection_v2: {
    id: 'gap_detection_v2',
    version: 2,
    name: 'Multi-Paper Research Gap Synthesis Engine',
    model: 'gemini-2.5-flash',
    description: 'Synthesizes open research gaps across multiple papers, classifies into the 12-category ontology, and calculates transparent heuristic evidence scores.',
    systemInstruction: `You are an expert research methodologist.
Identify high-impact, scientifically rigorous research gaps across the provided academic papers.
Do NOT generate trivial or generic gaps (like "needs more data").
Classify every gap into one of the 12 categories:
Methodological Gap, Dataset Gap, Evaluation Gap, Theoretical Gap, Technology Gap, Domain Gap, Temporal Gap, Geographic Gap, Population Gap, Comparative Gap, Reproducibility Gap, Security/Privacy Gap.
Return ONLY valid JSON.`,
    buildUserPrompt: ({ papers = [], researchFocus = '' }) => `
Analyze these ${papers.length} academic papers to identify genuine, systemic open research gaps.
User Research Focus: "${researchFocus}"

PAPERS SUMMARY:
${papers.map((p, idx) => `
[Paper ${idx + 1}] ID: ${p.id}
Title: "${p.title}" (${p.year})
Venue: ${p.venue || 'N/A'}
Contributions: ${p.contribution || 'N/A'}
Limitations: ${Array.isArray(p.limitations) ? p.limitations.join('; ') : (p.limitations || 'None')}
Key Methods: ${(p.extended_metadata?.ontology?.methods || []).map(m => m.name).join(', ') || 'N/A'}
Key Datasets: ${(p.extended_metadata?.ontology?.datasets || []).map(d => d.name).join(', ') || 'N/A'}
`).join('\n')}

REQUIRED JSON SCHEMA:
{
  "gaps": [
    {
      "title": "Clear gap title (6-12 words)",
      "description": "Comprehensive explanation of why this gap exists and why current literature fails to solve it.",
      "gap_category": "Methodological Gap | Dataset Gap | Evaluation Gap | Theoretical Gap | Technology Gap | Domain Gap | Temporal Gap | Geographic Gap | Population Gap | Comparative Gap | Reproducibility Gap | Security/Privacy Gap",
      "severity": "critical | high | medium | low",
      "confidence": 0.89,
      "supporting_paper_ids": ["uuid of paper 1", "uuid of paper 2"],
      "contradicting_paper_ids": [],
      "evidence_synthesis": "Synthesis of citations and limitations from the supporting papers.",
      "suggested_direction": "Actionable, concrete research agenda for a PhD scholar to tackle this gap.",
      "heuristic_scoring": {
        "repeated_limitation_points": 20,
        "multiple_papers_points": 15,
        "recent_evidence_points": 15,
        "explicit_future_work_points": 12,
        "insufficient_evaluation_points": 10,
        "cross_paper_agreement_points": 10,
        "total_evidence_score": 82,
        "score_justification": "+20 repeated limitation across 3 papers; +15 recent 2024 evidence; +12 explicit future work statement"
      }
    }
  ]
}
`
  },

  cross_paper_synthesis_v1: {
    id: 'cross_paper_synthesis_v1',
    version: 1,
    name: 'Cross-Paper Comparative Synthesis Matrix',
    model: 'gemini-2.5-flash',
    description: 'Generates structured comparison matrices, identifies conflicting results, underexplored datasets, and methodological consensus.',
    systemInstruction: `You are a meta-analysis scientist. Compare the provided research papers systematically.
Identify points of agreement, methodological divergences, dataset coverage, and conflicting empirical results.
Return ONLY valid JSON.`,
    buildUserPrompt: ({ papers = [], focus = '' }) => `
Conduct an authoritative cross-paper comparative synthesis of these ${papers.length} papers.
Research Scope: "${focus || 'General Corpus Analysis'}"

PAPERS:
${JSON.stringify(papers.map(p => ({
  id: p.id,
  title: p.title,
  year: p.year,
  venue: p.venue,
  contribution: p.contribution,
  limitations: p.limitations,
  methods: p.extended_metadata?.ontology?.methods || [],
  datasets: p.extended_metadata?.ontology?.datasets || [],
  findings: p.extended_metadata?.ontology?.findings || []
})), null, 2)}

REQUIRED JSON SCHEMA:
{
  "comparison_matrix": [
    {
      "paper_id": "uuid",
      "paper_title": "string",
      "year": 2024,
      "methodology": "Primary method",
      "dataset": "Primary dataset",
      "key_result": "Main result or metric",
      "core_limitation": "Main limitation",
      "primary_gap": "Addressed or uncovered gap"
    }
  ],
  "common_methodologies": ["Method 1", "Method 2"],
  "conflicting_findings": [
    {
      "topic": "Topic of conflict",
      "paper_a": "Paper 1 claims X",
      "paper_b": "Paper 2 claims opposite of X",
      "nuance": "Why their results diverge (e.g. different dataset size, hyperparameter bias)"
    }
  ],
  "common_datasets": ["Dataset 1", "Dataset 2"],
  "underexplored_datasets": ["Dataset/Domain that none or few papers tested"],
  "repeated_limitations": ["Limitation found across 2+ papers"],
  "emerging_trends": ["Technique/paradigm showing growth"],
  "declining_areas": ["Technique being replaced"]
}
`
  },

  research_question_v1: {
    id: 'research_question_v1',
    version: 1,
    name: 'Evidence-Based PhD Research Question Synthesizer',
    model: 'gemini-2.5-flash',
    description: 'Generates scientifically defensible research questions rooted in verified research gaps with motivation, missing component, and evaluation strategy.',
    systemInstruction: `You are a PhD Dissertation Committee Chair and Research Mentor.
Formulate precise, publication-grade research questions based strictly on empirical research gaps.
Distinguish clearly between established literature facts and proposed novel hypotheses.
Return ONLY valid JSON.`,
    buildUserPrompt: ({ gap, papers = [], researchTopic = '' }) => `
Formulate 2-3 PhD-grade Research Questions addressing the following verified research gap:

GAP DETAILS:
- Title: "${gap.title}"
- Category: ${gap.gap_category || gap.category || 'Methodological Gap'}
- Description: ${gap.description}
- Severity: ${gap.severity}
- User Research Scope: "${researchTopic}"

RELATED PAPERS:
${papers.slice(0, 5).map(p => `- "${p.title}" (${p.year}): ${p.contribution}`).join('\n')}

REQUIRED JSON SCHEMA:
{
  "research_questions": [
    {
      "question": "Clear, precise academic research question (How can... / To what extent...)",
      "motivation": "Why answering this question is critical for the field.",
      "supporting_evidence": "Specific evidence from literature establishing that this question is unresolved.",
      "existing_approaches": "Summary of current baseline approaches and their shortcomings.",
      "missing_component": "The exact missing theoretical, algorithmic, or architectural element.",
      "suggested_methodology": "Step-by-step recommended methodological framework.",
      "expected_contribution": "The concrete academic contribution (theoretical proof, new benchmark, novel architecture).",
      "evaluation_strategy": "Concrete evaluation metrics, datasets, and baseline comparison plan."
    }
  ]
}
`
  },

  novelty_analysis_v1: {
    id: 'novelty_analysis_v1',
    version: 1,
    name: 'Research Novelty & Literature Differentiation Assistant',
    model: 'gemini-2.5-flash',
    description: 'Audits a proposed PhD research idea against existing literature corpuses using prudent, scientifically cautious differentiation language.',
    systemInstruction: `You are an expert academic reviewer for top-tier venues (ACM, IEEE, NeurIPS, Nature).
Evaluate the novelty of a proposed research idea against existing literature.
CRITICAL MANDATE: NEVER claim that a research idea is definitively "novel".
Use prudent academic phrasing: "Potential differentiation identified", "Similar work exists in...", "Further literature verification is required".
Highlight potential threats to novelty and overlapping prior art honestly.
Return ONLY valid JSON.`,
    buildUserPrompt: ({ proposedIdea, papers = [], identifiedGaps = [] }) => `
Evaluate the academic differentiation of this proposed research idea against the ingested paper corpus.

PROPOSED RESEARCH IDEA:
"${proposedIdea}"

EXISTING PAPERS IN CORPUS (${papers.length}):
${papers.slice(0, 10).map((p, i) => `[${i + 1}] "${p.title}" (${p.year}): ${p.contribution} | Limitations: ${Array.isArray(p.limitations) ? p.limitations.join(', ') : p.limitations}`).join('\n')}

IDENTIFIED GAPS IN CORPUS:
${identifiedGaps.slice(0, 5).map(g => `- ${g.title} (${g.gap_category || 'Gap'}): ${g.description}`).join('\n')}

REQUIRED JSON SCHEMA:
{
  "academic_verdict": "Potential differentiation identified | High overlap with existing literature | Insufficient literature to evaluate",
  "summary_of_differentiation": "2-3 sentences evaluating the proposal's relationship to existing literature.",
  "existing_approaches": [
    { "technique": "Technique name", "used_in_papers": ["Title or ID"], "description": "What they do" }
  ],
  "similar_approaches": [
    { "approach": "Name of similar approach", "source_paper": "Title", "similarity_aspect": "Where it overlaps" }
  ],
  "overlapping_concepts": ["Concept 1", "Concept 2"],
  "potential_differentiation": [
    { "aspect": "Architectural / Evaluation / Domain", "description": "How the proposal differs from existing work", "evidence_support": "Why literature hasn't done this" }
  ],
  "unexplored_dimensions": ["Dimension not addressed by corpus"],
  "threats_to_novelty": ["Risk that work X or Y already covers this partially", "Potential triviality risk"],
  "recommended_literature_checks": ["Specific keywords or journals to search before writing paper"]
}
`
  },

  literature_review_v2: {
    id: 'literature_review_v2',
    version: 2,
    name: 'Evidence-Grounded Literature Review Synthesizer',
    model: 'gemini-2.5-flash',
    description: 'Generates multi-theme systematic literature reviews with paragraph-level citation bindings in IEEE, APA 7, or MLA format.',
    systemInstruction: `You are an academic scholar writing a peer-reviewed systematic literature review.
Every factual assertion must be directly attributed to the ingested papers with formal citations.
Structure the review into:
1. Introduction & Theoretical Foundation
2. Thematic Syntheses (Themes 1, 2, 3)
3. Methodological Comparison
4. Critical Limitations of Existing Work
5. Open Research Gaps
6. Future Research Roadmap
Support the selected citation format strictly. Return ONLY valid JSON.`,
    buildUserPrompt: ({ papers = [], topic = '', citationStyle = 'IEEE' }) => `
Synthesize a comprehensive, evidence-grounded literature review.
Topic: "${topic}"
Citation Style: ${citationStyle}

CORPUS PAPERS (${papers.length}):
${papers.map((p, idx) => `
[${idx + 1}] ID: ${p.id}
Citation Key: [${idx + 1}]
Title: "${p.title}"
Authors: ${p.authors}
Year: ${p.year}
Venue: ${p.venue}
DOI: ${p.doi || 'N/A'}
Contribution: ${p.contribution}
Limitations: ${Array.isArray(p.limitations) ? p.limitations.join('; ') : p.limitations}
`).join('\n')}

REQUIRED JSON SCHEMA:
{
  "title": "Academic Title for Literature Review",
  "citation_style": "${citationStyle}",
  "sections": [
    {
      "heading": "Introduction & Background",
      "content": "Full academic text with in-text citations like [1] or (Author, 2024)...",
      "cited_paper_ids": ["uuid-1", "uuid-2"]
    },
    {
      "heading": "Theme 1: Methodological Innovations",
      "content": "Paragraph with grounded citations...",
      "cited_paper_ids": ["uuid-2"]
    },
    {
      "heading": "Theme 2: Empirical Evaluation & Benchmarking",
      "content": "Paragraph with grounded citations...",
      "cited_paper_ids": ["uuid-3"]
    },
    {
      "heading": "Methodological Comparison & Synthesis",
      "content": "Comparison text comparing approaches...",
      "cited_paper_ids": []
    },
    {
      "heading": "Critical Limitations in Existing Literature",
      "content": "Analysis of repeated limitations...",
      "cited_paper_ids": []
    },
    {
      "heading": "Systemic Research Gaps",
      "content": "Formal discussion of unresolved gaps...",
      "cited_paper_ids": []
    },
    {
      "heading": "Future Research Directions",
      "content": "Roadmap for future research...",
      "cited_paper_ids": []
    }
  ],
  "bibliography": [
    { "paper_id": "uuid", "formatted_citation": "Full formatted reference string in ${citationStyle}" }
  ]
}
`
  }
};

/**
 * Retrieves a prompt configuration by ID
 * @param {string} promptId
 * @returns {object|null}
 */
function getPrompt(promptId) {
  return PROMPTS[promptId] || null;
}

/**
 * Returns list of all active registered prompts
 * @returns {Array<object>}
 */
function listPrompts() {
  return Object.values(PROMPTS).map(({ id, version, name, description, model }) => ({
    id,
    version,
    name,
    description,
    model
  }));
}

/**
 * Seeds prompt registry entries into Supabase prompt_versions table
 * @param {object} supabaseClient
 */
async function syncPromptsToDatabase(supabaseClient) {
  if (!supabaseClient) return;
  try {
    for (const p of Object.values(PROMPTS)) {
      await supabaseClient.from('prompt_versions').upsert({
        id: p.id,
        version: p.version,
        name: p.name,
        description: p.description,
        system_instruction: p.systemInstruction,
        template: p.id,
        model: p.model,
        is_active: true,
        updated_at: new Date().toISOString()
      }, { onConflict: 'id' });
    }
    console.log('[PROMPT REGISTRY] Synchronized prompt versions to database.');
  } catch (err) {
    console.warn('[PROMPT REGISTRY] Database sync warning (non-fatal):', err.message);
  }
}

module.exports = {
  PROMPTS,
  getPrompt,
  listPrompts,
  syncPromptsToDatabase
};
