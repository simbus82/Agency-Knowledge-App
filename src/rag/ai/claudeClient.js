// Unified Claude client wrapper for internal RAG AI modules.
const axios = require('axios');

const CLAUDE_MODEL_PLANNER = process.env.CLAUDE_RAG_PLANNER_MODEL || 'claude-sonnet-4-20250514';
const CLAUDE_MODEL_ANNOTATORS = process.env.CLAUDE_RAG_ANNOTATOR_MODEL || CLAUDE_MODEL_PLANNER;
const CLAUDE_MODEL_REASONER = process.env.CLAUDE_RAG_REASONER_MODEL || CLAUDE_MODEL_PLANNER;

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
  const resp = await axios.post('https://api.anthropic.com/v1/messages', body, {
    headers: {
      'x-api-key': process.env.CLAUDE_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    }, timeout: 30000
  });
  const content = resp.data?.content?.[0]?.text || '';
  return content;
}

module.exports = {
  claudeRequest,
  CLAUDE_MODEL_PLANNER,
  CLAUDE_MODEL_ANNOTATORS,
  CLAUDE_MODEL_REASONER
};
