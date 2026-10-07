/**
 * Tessera AI — Groq Cloud API Service
 * 
 * High-speed, 100% Free AI access (no credit card required at console.groq.com).
 * Runs Meta Llama 3.3 70B and DeepSeek R1 for humanization with alternative token distributions.
 */

const https = require('https');

/**
 * Calls Groq Cloud API with OpenAI-compatible chat completions
 * @param {string} prompt 
 * @param {string} systemPrompt 
 * @param {string} apiKey 
 * @param {object} options 
 * @returns {Promise<string>}
 */
async function callGroqChat(prompt, systemPrompt = '', apiKey = null, options = {}) {
  const token = apiKey || process.env.GROQ_API_KEY;

  if (!token) {
    throw new Error('GROQ_API_KEY is not configured. Please get a free API key from console.groq.com (no credit card required).');
  }

  const model = options.model || 'llama-3.3-70b-versatile';
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
      hostname: 'api.groq.com',
      port: 443,
      path: '/openai/v1/chat/completions',
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
            const content = parsed.choices?.[0]?.message?.content || '';
            resolve(content.trim());
            return;
          }

          console.warn(`[Groq] API returned status ${res.statusCode}:`, data);
          reject(new Error(`Groq API error (${res.statusCode}): ${data}`));
        } catch (err) {
          reject(new Error(`Failed to parse Groq response: ${err.message}`));
        }
      });
    });

    req.on('error', (err) => {
      console.warn('[Groq] Network error:', err.message);
      reject(err);
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Groq request timed out after 30s'));
    });

    req.write(payload);
    req.end();
  });
}

module.exports = {
  callGroqChat
};
