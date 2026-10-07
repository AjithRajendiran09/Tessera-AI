/**
 * Tessera AI — AIHumanizerAPI Service
 * 
 * Integrates with AIHumanizerAPI.com (Free tier: 10,000 words/month, NO credit card required).
 * Transforms AI-generated academic text into authentic human prose with low detection probability.
 */

const https = require('https');

/**
 * Humanizes text using AIHumanizerAPI.com
 * @param {string} text - Text to humanize
 * @param {string} apiKey - Optional API key override
 * @param {object} options - Options { model, tone }
 * @returns {Promise<object>} { success, humanizedText, wordsUsed, source }
 */
async function humanizeWithAiHumanizerApi(text, apiKey = null, options = {}) {
  const token = apiKey || process.env.AI_HUMANIZER_API_KEY;

  if (!token) {
    return {
      success: false,
      message: 'AI_HUMANIZER_API_KEY is not configured. Please get a free key from aihumanizerapi.com (10,000 words free, no credit card required).'
    };
  }

  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    return { success: true, humanizedText: text };
  }

  const payload = JSON.stringify({
    text: text,
    model: options.model || 'academic',
    tone: options.tone || 'scholarly'
  });

  return new Promise((resolve) => {
    const reqOptions = {
      hostname: 'api.aihumanizerapi.com',
      port: 443,
      path: '/v1/humanize',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: 30000
    };

    const req = https.request(reqOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            const parsed = JSON.parse(data);
            const humanizedText = parsed.humanized_text || parsed.result || parsed.text || data;
            resolve({
              success: true,
              humanizedText: typeof humanizedText === 'string' ? humanizedText.trim() : JSON.stringify(humanizedText),
              source: 'aihumanizerapi'
            });
            return;
          }

          console.warn(`[AIHumanizerAPI] API returned status ${res.statusCode}:`, data);
          resolve({
            success: false,
            statusCode: res.statusCode,
            message: `AIHumanizerAPI error (${res.statusCode}): ${data}`
          });
        } catch (err) {
          resolve({
            success: false,
            message: `Failed to parse AIHumanizerAPI response: ${err.message}`
          });
        }
      });
    });

    req.on('error', (err) => {
      console.warn('[AIHumanizerAPI] Network error:', err.message);
      resolve({
        success: false,
        message: err.message
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({
        success: false,
        message: 'Request timed out after 30s'
      });
    });

    req.write(payload);
    req.end();
  });
}

module.exports = {
  humanizeWithAiHumanizerApi
};
