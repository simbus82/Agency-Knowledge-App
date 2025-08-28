// Unified Claude client wrapper for internal RAG AI modules.
const axios = require('axios');
let HttpProxyAgent, HttpsProxyAgent;
try { ({ HttpProxyAgent } = require('http-proxy-agent')); } catch(_) {}
try { ({ HttpsProxyAgent } = require('https-proxy-agent')); } catch(_) {}

const FALLBACK_MAIN = process.env.SELECTED_CLAUDE_MODEL || 'claude-sonnet-4-20250514';
const CLAUDE_MODEL_PLANNER = process.env.CLAUDE_RAG_PLANNER_MODEL || FALLBACK_MAIN;
const CLAUDE_MODEL_ANNOTATORS = process.env.CLAUDE_RAG_ANNOTATOR_MODEL || CLAUDE_MODEL_PLANNER;
const CLAUDE_MODEL_REASONER = process.env.CLAUDE_RAG_REASONER_MODEL || CLAUDE_MODEL_PLANNER;
const CLAUDE_MODEL_UTILITY = process.env.CLAUDE_RAG_UTILITY_MODEL || FALLBACK_MAIN;

// Configure axios client with optional proxy support from env (HTTP(S)_PROXY)
const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || null;
const agentConfig = (()=>{
  if(!proxyUrl) return {};
  try {
    const httpAgent = HttpProxyAgent ? new HttpProxyAgent(proxyUrl) : undefined;
    const httpsAgent = HttpsProxyAgent ? new HttpsProxyAgent(proxyUrl) : undefined;
    return { httpAgent, httpsAgent, proxy: false };
  } catch(_) { return {}; }
})();

const axiosClient = axios.create({
  baseURL: 'https://api.anthropic.com',
  headers: {
    'anthropic-version': '2023-06-01',
    'content-type': 'application/json'
  },
  timeout: 30000,
  ...agentConfig
});

async function claudeRequest(model, prompt, maxTokens = 1200, temperature = 0){
  if(!process.env.CLAUDE_API_KEY){
    throw new Error('CLAUDE_API_KEY missing');
  }
  const body = {
    model,
    max_tokens: maxTokens,
    temperature,
    messages: [ { role: 'user', content: prompt } ]
  };
  const resp = await axiosClient.post('/v1/messages', body, { headers: { 'x-api-key': process.env.CLAUDE_API_KEY } });
  const content = resp.data?.content?.[0]?.text || '';
  return content;
}

module.exports = {
  claudeRequest,
  CLAUDE_MODEL_PLANNER,
  CLAUDE_MODEL_ANNOTATORS,
  CLAUDE_MODEL_REASONER
};

// Lightweight connectivity ping used by health checks
async function claudePing(timeoutMs = 5000){
  if(!process.env.CLAUDE_API_KEY) throw new Error('CLAUDE_API_KEY missing');
  const model = process.env.CLAUDE_RAG_UTILITY_MODEL || process.env.CLAUDE_RAG_PLANNER_MODEL || 'claude-sonnet-4-20250514';
  const body = { model, max_tokens: 1, temperature: 0, messages: [{ role:'user', content:'ping' }] };
  const resp = await axiosClient.post('/v1/messages', body, { headers: { 'x-api-key': process.env.CLAUDE_API_KEY }, timeout: timeoutMs });
  return { ok: true, model: resp.data?.model || model };
}

module.exports.claudePing = claudePing;
