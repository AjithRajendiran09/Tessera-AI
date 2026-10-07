/**
 * Tessera AI — OpenRouter Free Models Service
 * 
 * Provides access to OpenRouter's completely free tier models (no credit card required at openrouter.ai):
 * - meta-llama/llama-3.3-70b-instruct:free
 * - deepseek/deepseek-r1:free
 * - mistralai/mistral-small-24b-instruct-2501:free
 * - google/gemini-2.0-flash-exp:free
 * - qwen/qwen-2.5-72b-instruct:free
 */

const https = require('https');

/**
 * Calls OpenRouter chat completion endpoint
 * @param {string} prompt 
 * @param {string} systemPrompt 
 * @param {string} apiKey 
 * @param {object} options 
 * @returns {Promise<string>}
 */
async function callOpenRouterChat(prompt, systemPrompt = '', apiKey = null, options = {}) {
  const token = apiKey || process.env.OPENROUTER_API_KEY;

  if (!token) {
    throw new Error('OPENROUTER_API_KEY is not configured. Get a free API key at openrouter.ai/keys (no credit card required).');
  }

  const model = options.model || 'meta-llama/llama-3.3-70b-instruct:free';
  const temperature = options.temperature ?? 0.85;

  const messages = [];
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }
  messages.push({ role: 'user', content: prompt });

  const payload = JSON.stringify({
    model,
    messages,
    temperature,
    max_tokens: 4096
  });

  return new Promise((resolve, reject) => {
    const reqOptions = {
      hostname: 'openrouter.ai',
      port: 443,
      path: '/api/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'HTTP-Referer': 'https://tessera-ai.org',
        'X-Title': 'Tessera AI Research Engine',
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: 35000
    };

    const req = https.request(reqOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            const parsed = JSON.parse(data);
            const content = parsed.choices?.[0]?.message?.content || '';
            resolve(content.trim());
            return;
          }

          console.warn(`[OpenRouter] API returned status ${res.statusCode}:`, data);
          reject(new Error(`OpenRouter API error (${res.statusCode}): ${data}`));
        } catch (err) {
          reject(new Error(`Failed to parse OpenRouter response: ${err.message}`));
        }
      });
    });

    req.on('error', (err) => {
      console.warn('[OpenRouter] Network error:', err.message);
      reject(err);
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('OpenRouter request timed out after 35s'));
    });

    req.write(payload);
    req.end();
  });
}

module.exports = {
  callOpenRouterChat
};
