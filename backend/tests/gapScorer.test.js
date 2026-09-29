const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateGapEvidenceScore } = require('../services/gapScorer.js');

test('Gap Evidence Scorer: Deterministic Heuristic Scoring', async (t) => {
  await t.test('calculates score with full breakdown for high-evidence gap', () => {
    const supportingPapers = [
      { id: 'p1', title: 'Byzantine Fault Tolerance at Scale', year: 2024 },
      { id: 'p2', title: 'Evaluating State Machine Replication', year: 2023 }
    ];

    const evidenceSnippets = [
      {
        section: 'Limitations',
        quote: 'A severe limitation of our consensus protocol is message overhead exceeding O(N^2).'
      },
      {
        section: 'Future Work',
        quote: 'Future research must address communication bottleneck in large validator sets.'
      }
    ];

    const result = calculateGapEvidenceScore({
      supportingPapers,
      evidenceSnippets
    });

    assert.ok(typeof result.totalScore === 'number');
    assert.ok(result.totalScore >= 0 && result.totalScore <= 100, 'Score must be between 0 and 100');
    assert.ok(result.disclaimer.includes('Tessera Evidence-Based Heuristic Score'));
    assert.ok(Array.isArray(result.breakdown), 'Breakdown must be an array of factors');

    // Check factor point calculations
    const breakdownFactors = result.breakdown.map(f => f.factor);
    assert.ok(breakdownFactors.includes('Repeated Limitation'));
    assert.ok(breakdownFactors.includes('Multi-Paper Corroboration'));
    assert.ok(breakdownFactors.includes('Evidence Recency'));
    assert.ok(breakdownFactors.includes('Explicit Future Work Statements'));

    // Verify sum of points equals total score
    const calculatedSum = result.breakdown.reduce((sum, f) => sum + f.points, 0);
    assert.equal(result.totalScore, Math.min(100, Math.max(0, calculatedSum)));
  });

  await t.test('handles empty evidence gracefully without NaN or negative scores', () => {
    const result = calculateGapEvidenceScore({
      supportingPapers: [],
      contradictingPapers: [],
      evidenceSnippets: []
    });

    assert.ok(typeof result.totalScore === 'number');
    assert.ok(result.totalScore >= 0);
    assert.equal(result.confidenceTier, 'REQUIRES_HUMAN_REVIEW');
  });

  await t.test('awards evaluation deficiency points when benchmark or metric gaps are found', () => {
    const evidenceSnippets = [
      {
        section: 'Discussion',
        quote: 'Current evaluations rely solely on small synthetic datasets with lack of real-world evaluation.'
      }
    ];

    const result = calculateGapEvidenceScore({
      supportingPapers: [{ id: 'p_eval', year: 2024 }],
      evidenceSnippets
    });
    const evalFactor = result.breakdown.find(f => f.factor === 'Evaluation / Benchmark Deficiency');
    assert.ok(evalFactor, 'Should include Evaluation / Benchmark Deficiency factor');
    assert.ok(evalFactor.points >= 8, 'Should award points for evaluation deficiency');
  });

  await t.test('awards consensus divergence points when conflicting evidence exists', () => {
    const result = calculateGapEvidenceScore({
      supportingPapers: [{ id: 'p_agree', year: 2024 }],
      contradictingPapers: [{ id: 'p_conflict', year: 2024 }],
      evidenceSnippets: [{ quote: 'Our empirical results contradict earlier assumptions.' }]
    });

    const divFactor = result.breakdown.find(f => f.factor === 'Empirical Divergence / Contradiction');
    assert.ok(divFactor, 'Should include Divergence factor when contradicting papers exist');
    assert.ok(divFactor.points > 0, 'Should award points for empirical divergence');
  });
});
