/**
 * Tessera AI — Transparent Research Gap Evidence Scoring Engine
 * Computes an explainable, auditable heuristic score (0-100) with mathematical breakdown.
 * Clearly labeled as "Tessera Evidence-Based Heuristic Score".
 */

/**
 * Formula Weights & Factors
 */
const SCORING_CRITERIA = {
  REPEATED_LIMITATION: { maxPoints: 20, description: 'Limitation confirmed across multiple independent papers' },
  MULTI_PAPER_SUPPORT: { maxPoints: 20, description: 'Sustained corroboration from multiple research groups' },
  EVIDENCE_RECENCY: { maxPoints: 15, description: 'Recent active evidence (publications within last 24-36 months)' },
  EXPLICIT_FUTURE_WORK: { maxPoints: 15, description: 'Authors explicitly state this as an open/unsolved problem' },
  EVALUATION_DEFICIENCY: { maxPoints: 10, description: 'Documented lack of real-world or rigorous benchmark evaluation' },
  CROSS_PAPER_AGREEMENT: { maxPoints: 10, description: 'Cross-paper consensus without conflicting counter-claims' },
  CONTRADICTION_DISCREPANCY: { maxPoints: 10, description: 'Discrepancy or conflicting empirical findings between studies' }
};

/**
 * Calculates the Tessera Evidence-Based Heuristic Score for a research gap.
 * @param {object} params
 * @param {Array<object>} params.supportingPapers List of papers supporting the gap
 * @param {Array<object>} params.contradictingPapers List of papers contradicting or addressing the gap
 * @param {Array<object>} params.evidenceSnippets Verbatim citations or limitations
 * @param {object} params.factors Optional manual factor overrides
 * @returns {{
 *   totalScore: number,
 *   confidenceTier: 'HIGH' | 'MEDIUM' | 'LOW' | 'REQUIRES_HUMAN_REVIEW',
 *   breakdown: Array<{ factor: string, points: number, maxPoints: number, reason: string }>,
 *   formula: string,
 *   disclaimer: string,
 *   summaryExplanation: string
 * }}
 */
function calculateGapEvidenceScore({
  supportingPapers = [],
  contradictingPapers = [],
  evidenceSnippets = [],
  factors = {}
}) {
  const currentYear = new Date().getFullYear();
  const breakdown = [];
  let totalScore = 0;

  // 1. Repeated Limitation Factor (max 20)
  const limitationCount = evidenceSnippets.filter(s =>
    (s.section && /limitation|weakness|threats\s+to\s+validity/i.test(s.section)) ||
    (s.quote && /limit|restrict|bound|fail|shortcoming/i.test(s.quote))
  ).length;

  let repeatedLimitationPoints = 0;
  if (limitationCount >= 3 || factors.hasRepeatedLimitation) {
    repeatedLimitationPoints = 20;
  } else if (limitationCount === 2) {
    repeatedLimitationPoints = 14;
  } else if (limitationCount === 1) {
    repeatedLimitationPoints = 8;
  }
  totalScore += repeatedLimitationPoints;
  breakdown.push({
    factor: 'Repeated Limitation',
    points: repeatedLimitationPoints,
    maxPoints: SCORING_CRITERIA.REPEATED_LIMITATION.maxPoints,
    reason: repeatedLimitationPoints > 0
      ? `Explicitly cited in limitations of ${limitationCount} paper(s)`
      : 'No explicit limitation section quotes identified'
  });

  // 2. Multi-Paper Support (max 20)
  const paperCount = supportingPapers.length;
  let multiPaperPoints = 0;
  if (paperCount >= 4) {
    multiPaperPoints = 20;
  } else if (paperCount === 3) {
    multiPaperPoints = 16;
  } else if (paperCount === 2) {
    multiPaperPoints = 12;
  } else if (paperCount === 1) {
    multiPaperPoints = 6;
  }
  totalScore += multiPaperPoints;
  breakdown.push({
    factor: 'Multi-Paper Corroboration',
    points: multiPaperPoints,
    maxPoints: SCORING_CRITERIA.MULTI_PAPER_SUPPORT.maxPoints,
    reason: `Corroborated across ${paperCount} distinct paper(s)`
  });

  // 3. Evidence Recency (max 15)
  const years = supportingPapers.map(p => Number(p.year)).filter(y => !isNaN(y) && y > 1990);
  const mostRecentYear = years.length > 0 ? Math.max(...years) : 0;
  let recencyPoints = 0;
  if (mostRecentYear >= currentYear - 1) {
    recencyPoints = 15;
  } else if (mostRecentYear >= currentYear - 3) {
    recencyPoints = 11;
  } else if (mostRecentYear >= currentYear - 5) {
    recencyPoints = 7;
  } else if (mostRecentYear > 0) {
    recencyPoints = 3;
  }
  totalScore += recencyPoints;
  breakdown.push({
    factor: 'Evidence Recency',
    points: recencyPoints,
    maxPoints: SCORING_CRITERIA.EVIDENCE_RECENCY.maxPoints,
    reason: mostRecentYear > 0
      ? `Most recent supporting literature is from ${mostRecentYear} (${currentYear - mostRecentYear} yr(s) ago)`
      : 'Publication year unspecified'
  });

  // 4. Explicit Future Work Statements (max 15)
  const futureWorkCount = evidenceSnippets.filter(s =>
    (s.section && /future\s+work|outlook|open\s+challenge/i.test(s.section)) ||
    (s.quote && /future\s+research|remain|open\s+question|unresolved/i.test(s.quote))
  ).length;

  let futureWorkPoints = 0;
  if (futureWorkCount >= 2 || factors.isFutureWork) {
    futureWorkPoints = 15;
  } else if (futureWorkCount === 1) {
    futureWorkPoints = 10;
  }
  totalScore += futureWorkPoints;
  breakdown.push({
    factor: 'Explicit Future Work Statements',
    points: futureWorkPoints,
    maxPoints: SCORING_CRITERIA.EXPLICIT_FUTURE_WORK.maxPoints,
    reason: futureWorkPoints > 0
      ? `Explicitly designated as open challenge or future work in ${futureWorkCount} study`
      : 'No verbatim future-work declaration detected'
  });

  // 5. Evaluation Deficiency / Benchmark Gap (max 10)
  let evalDeficiencyPoints = 0;
  if (factors.lackOfEvaluation || factors.datasetLimitation) {
    evalDeficiencyPoints = 10;
  } else {
    // Check if quotes cite evaluation or dataset flaws
    const hasEvalKeywords = evidenceSnippets.some(s =>
      /evaluat|benchmark|small\s+sample|synthetic|lack\s+of\s+real|untested/i.test(s.quote || '')
    );
    evalDeficiencyPoints = hasEvalKeywords ? 8 : 4;
  }
  totalScore += evalDeficiencyPoints;
  breakdown.push({
    factor: 'Evaluation / Benchmark Deficiency',
    points: evalDeficiencyPoints,
    maxPoints: SCORING_CRITERIA.EVALUATION_DEFICIENCY.maxPoints,
    reason: evalDeficiencyPoints >= 8
      ? 'Literature identifies narrow evaluation or absence of real-world benchmarks'
      : 'Standard baseline evaluations present'
  });

  // 6. Cross-Paper Agreement vs Contradiction (max 10 + 10)
  const contradictingCount = contradictingPapers.length;
  let agreementPoints = 0;
  let contradictionPoints = 0;

  if (contradictingCount === 0 && paperCount >= 2) {
    agreementPoints = 10;
  } else if (contradictingCount === 0) {
    agreementPoints = 6;
  } else {
    // There are conflicting papers, which increases interest in the gap
    contradictionPoints = Math.min(10, contradictingCount * 5);
    agreementPoints = 3;
  }

  totalScore += agreementPoints + contradictionPoints;
  breakdown.push({
    factor: 'Cross-Paper Agreement',
    points: agreementPoints,
    maxPoints: SCORING_CRITERIA.CROSS_PAPER_AGREEMENT.maxPoints,
    reason: contradictingCount === 0
      ? 'Consistent agreement with no identified contradictory findings'
      : `${contradictingCount} paper(s) report diverging findings on this subject`
  });

  if (contradictionPoints > 0) {
    breakdown.push({
      factor: 'Empirical Divergence / Contradiction',
      points: contradictionPoints,
      maxPoints: SCORING_CRITERIA.CONTRADICTION_DISCREPANCY.maxPoints,
      reason: `Empirical contradiction between ${supportingPapers.length} supporting and ${contradictingCount} contradictory studies`
    });
  }

  // Cap score at 100
  totalScore = Math.min(100, Math.max(0, totalScore));

  // Determine Confidence Tier
  let confidenceTier = 'HIGH';
  if (totalScore >= 75) {
    confidenceTier = 'HIGH';
  } else if (totalScore >= 50) {
    confidenceTier = 'MEDIUM';
  } else if (totalScore >= 30) {
    confidenceTier = 'LOW';
  } else {
    confidenceTier = 'REQUIRES_HUMAN_REVIEW';
  }

  const positiveReasons = breakdown
    .filter(b => b.points > 0)
    .map(b => `+${b.points} ${b.factor.toLowerCase()}`)
    .join(', ');

  return {
    totalScore,
    confidenceTier,
    breakdown,
    formula: 'Tessera Heuristic = Limitation (20) + Multi-Paper (20) + Recency (15) + Future Work (15) + Eval Deficiency (10) + Consensus/Conflict (20)',
    disclaimer: 'Tessera Evidence-Based Heuristic Score: Transparent empirical heuristic based on ingested papers. Not an authoritative claim of scientific consensus.',
    summaryExplanation: totalScore >= 40
      ? `Score ${totalScore}/100 driven by: ${positiveReasons}.`
      : 'Insufficient evidence to confidently establish this research gap. Requires human literature verification.'
  };
}

module.exports = {
  SCORING_CRITERIA,
  calculateGapEvidenceScore
};
