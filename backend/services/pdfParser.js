/**
 * Tessera AI — Page-Aware PDF Parsing Service
 * Extracts text chunked by page number to guarantee evidence traceability.
 */
const pdfParse = require('pdf-parse');

/**
 * Parses PDF buffer while preserving explicit page boundaries.
 * @param {Buffer} buffer Raw PDF file buffer
 * @returns {Promise<{ totalPages: number, pages: Array<{ pageNumber: number, text: string }>, annotatedText: string, metadata: object }>}
 */
async function parsePdfWithPages(buffer) {
  const pages = [];
  let currentPage = 0;

  function customPageRender(pageData) {
    currentPage++;
    const pageNum = currentPage;

    return pageData.getTextContent({
      normalizeWhitespace: true,
      disableCombineTextItems: false
    }).then(textContent => {
      let lastY = null;
      let pageText = '';

      for (const item of textContent.items) {
        if (!item || !item.str) continue;
        if (lastY === item.transform[5] || lastY === null) {
          pageText += (pageText.endsWith(' ') || pageText.endsWith('\n') ? '' : ' ') + item.str;
        } else {
          pageText += '\n' + item.str;
        }
        lastY = item.transform[5];
      }

      const cleanPageText = pageText.trim();
      pages.push({
        pageNumber: pageNum,
        text: cleanPageText
      });

      return `\n=== PAGE [${pageNum}] ===\n${cleanPageText}\n`;
    });
  }

  try {
    const data = await pdfParse(buffer, {
      pagerender: customPageRender
    });

    // Sort pages in ascending order in case async rendering was interleaved
    pages.sort((a, b) => a.pageNumber - b.pageNumber);

    let assembledText = '';
    for (const p of pages) {
      assembledText += `\n=== PAGE [${p.pageNumber}] ===\n${p.text}\n`;
    }

    return {
      totalPages: data.numpages || pages.length,
      pages,
      annotatedText: assembledText.trim(),
      metadata: data.info || {}
    };
  } catch (err) {
    console.warn('[PDF PARSER] Custom page-render failed, falling back to standard pdfParse:', err.message);
    const standardData = await pdfParse(buffer);
    return {
      totalPages: standardData.numpages || 1,
      pages: [{ pageNumber: 1, text: standardData.text }],
      annotatedText: standardData.text,
      metadata: standardData.info || {}
    };
  }
}

/**
 * Searches for supporting evidence quotes within parsed pages to verify exact page match.
 * @param {Array<{ pageNumber: number, text: string }>} pages
 * @param {string} quote Snippet to locate
 * @returns {number|null} Verified page number or null
 */
function findQuotePage(pages, quote) {
  if (!quote || typeof quote !== 'string' || !Array.isArray(pages)) return null;
  const cleanSnippet = quote.substring(0, 40).toLowerCase().trim();
  if (!cleanSnippet) return null;

  for (const p of pages) {
    if (p.text.toLowerCase().includes(cleanSnippet)) {
      return p.pageNumber;
    }
  }
  return null;
}

module.exports = {
  parsePdfWithPages,
  findQuotePage
};
