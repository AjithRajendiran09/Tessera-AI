const test = require('node:test');
const assert = require('node:assert/strict');
const { findQuotePage } = require('../services/pdfParser.js');

test('PDF Parser Service: Page Attribution & Quote Locator', async (t) => {
  await t.test('finds exact page number for matching quotes', () => {
    const pages = [
      { pageNumber: 1, text: 'Title: Advances in Quantum Machine Learning. Abstract: We present novel circuits...' },
      { pageNumber: 2, text: 'Section 2: Related Work. Previous approaches suffered from exponential gate depth.' },
      { pageNumber: 3, text: 'Section 3: Empirical Evaluation. Our protocol achieves 99.4% fidelity on 16-qubit registers.' }
    ];

    const match1 = findQuotePage(pages, 'exponential gate depth');
    assert.equal(match1, 2);

    const match2 = findQuotePage(pages, '99.4% fidelity on 16-qubit registers');
    assert.equal(match2, 3);
  });

  await t.test('performs matching when capitalization differs', () => {
    const pages = [
      { pageNumber: 1, text: 'First page text.' },
      { pageNumber: 5, text: 'Limitations: The latency increases significantly when cluster size exceeds 500 nodes.' }
    ];

    const quote = 'latency increases significantly';
    const match = findQuotePage(pages, quote);
    assert.equal(match, 5);
  });

  await t.test('returns null gracefully when quote is not in any segment', () => {
    const pages = [
      { pageNumber: 1, text: 'Introduction to Artificial Intelligence.' }
    ];

    const match = findQuotePage(pages, 'Completely unrelated sentence from another universe.');
    assert.equal(match, null);
  });

  await t.test('handles empty or malformed inputs without crashing', () => {
    assert.equal(findQuotePage([], 'some quote'), null);
    assert.equal(findQuotePage(null, 'some quote'), null);
    assert.equal(findQuotePage([{ pageNumber: 1, text: '' }], null), null);
  });
});
