const test = require('node:test');
const assert = require('node:assert/strict');
const {
  getPrompt,
  listPrompts,
  PROMPTS
} = require('../prompts/registry.js');

test('Prompt Registry: Versioned Academic Prompt Management', async (t) => {
  await t.test('all expected core prompt templates are registered and versioned', () => {
    const requiredKeys = [
      'paper_analysis_v2',
      'gap_detection_v2',
      'cross_paper_synthesis_v1',
      'research_question_v1',
      'novelty_analysis_v1',
      'literature_review_v2'
    ];

    requiredKeys.forEach(key => {
      const template = getPrompt(key);
      assert.ok(template, `Template ${key} should exist in registry`);
      assert.ok(template.version, `Template ${key} must have version`);
      assert.ok(template.name, `Template ${key} must have human-readable name`);
      assert.ok(template.systemInstruction, `Template ${key} must have systemInstruction`);
      assert.ok(typeof template.buildUserPrompt === 'function', `Template ${key} must provide buildUserPrompt function`);
    });
  });

  await t.test('buildUserPrompt correctly replaces dynamic variables', () => {
    const template = getPrompt('cross_paper_synthesis_v1');
    const userPrompt = template.buildUserPrompt({
      focus: 'Distributed Ledger Scalability',
      papers: [
        { id: '1', title: 'Paper A', year: 2024, contribution: 'Contrib A', limitation: 'Limit A' },
        { id: '2', title: 'Paper B', year: 2023, contribution: 'Contrib B', limitation: 'Limit B' }
      ]
    });

    assert.ok(userPrompt.includes('Distributed Ledger Scalability'));
    assert.ok(userPrompt.includes('Paper A'));
    assert.ok(userPrompt.includes('Paper B'));
    assert.ok(template.systemInstruction.length > 50);
    assert.equal(template.version, 1);
    assert.equal(template.id, 'cross_paper_synthesis_v1');
  });

  await t.test('returns null if prompt ID is unknown', () => {
    const missing = getPrompt('non_existent_prompt_v99');
    assert.equal(missing, null);
  });

  await t.test('listPrompts returns metadata for all prompts', () => {
    const list = listPrompts();
    assert.ok(Array.isArray(list));
    assert.ok(list.length >= 6);
    list.forEach(p => {
      assert.ok(p.id);
      assert.ok(p.version);
      assert.ok(p.description);
    });
  });
});
