/**
 * Tessera AI — GPTZero AI Detection Service
 * 
 * Interacts with GPTZero API v2 to measure real-time AI generation probability,
 * sentence-level perplexity, and overall burstiness.
 * Gracefully falls back to heuristic analysis when API key is unavailable.
 */

const https = require('https');

/**
 * Predict AI probability using GPTZero API v2
 * @param {string} text - Text to analyze (minimum 250 characters recommended for high accuracy)
 * @param {string} apiKey - Optional API key override
 * @returns {Promise<object>} Detection results { aiProbability, humanProbability, predictedClass, burstiness, sentences, source: 'gptzero' | 'heuristic' }
 */
async function predictAiWithGptZero(text, apiKey = null) {
  const token = apiKey || process.env.GPTZERO_API_KEY;

  if (!token) {
    return {
      available: false,
      source: 'local_heuristic',
      message: 'GPTZERO_API_KEY not configured. Using local statistical heuristic.'
    };
  }

  if (!text || typeof text !== 'string' || text.trim().length < 50) {
    return {
      available: true,
      source: 'gptzero',
      aiProbability: 0,
      humanProbability: 1,
      predictedClass: 'human',
      sentences: []
    };
  }

  const payload = JSON.stringify({
    document: text,
    multilingual: false
  });

  return new Promise((resolve) => {
    const options = {
      hostname: 'api.gptzero.me',
      port: 443,
      path: '/v2/predict/text',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': token,
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: 15000
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            const parsed = JSON.parse(data);
            const doc = parsed.documents?.[0];

            if (doc) {
              const aiProb = doc.completely_generated_prob ?? doc.class_probabilities?.ai ?? 0;
              const humanProb = doc.class_probabilities?.human ?? (1 - aiProb);

              resolve({
                available: true,
                source: 'gptzero',
                aiProbability: Math.round(aiProb * 100),
                humanProbability: Math.round(humanProb * 100),
                mixedProbability: Math.round((doc.class_probabilities?.mixed ?? 0) * 100),
                predictedClass: doc.predicted_class || (aiProb > 0.5 ? 'ai' : 'human'),
                overallBurstiness: Math.round((doc.overall_burstiness ?? 0) * 10) / 10,
                sentences: (doc.sentences || []).map(s => ({
                  sentence: s.sentence,
                  perplexity: Math.round((s.perplexity ?? 0) * 10) / 10,
                  generatedProb: Math.round((s.generated_prob ?? 0) * 100),
                  highlightAi: !!s.highlight_sentence_for_ai
                }))
              });
              return;
            }
          }

          console.warn(`[GPTZero] API responded with status ${res.statusCode}:`, data);
          resolve({
            available: false,
            source: 'local_heuristic',
            statusCode: res.statusCode,
            message: `GPTZero returned status ${res.statusCode}. Falling back to local heuristic.`
          });
        } catch (parseErr) {
          console.warn('[GPTZero] JSON parse error:', parseErr.message);
          resolve({
            available: false,
            source: 'local_heuristic',
            message: 'Failed to parse GPTZero response.'
          });
        }
      });
    });

    req.on('error', (err) => {
      console.warn('[GPTZero] Network error:', err.message);
      resolve({
        available: false,
        source: 'local_heuristic',
        message: err.message
      });
    });

    req.on('timeout', () => {
      req.destroy();
      console.warn('[GPTZero] Request timed out after 15s.');
      resolve({
        available: false,
        source: 'local_heuristic',
        message: 'Request timed out'
      });
    });

    req.write(payload);
    req.end();
  });
}

module.exports = {
  predictAiWithGptZero
};
