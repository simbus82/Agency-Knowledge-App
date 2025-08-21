// Simple planner MVP: produce a task graph for generalized queries.
// Later this can be replaced by an LLM-based planner.
const { claudeRequest, CLAUDE_MODEL_PLANNER } = require('../ai/claudeClient');
const planCache = new Map();

async function aiPlan(query){
  const key = query.trim().toLowerCase();
  if(planCache.has(key)) return planCache.get(key);
  const prompt = `Sei un pianificatore. Data la query utente genera SOLO JSON valido (nessun testo extra) con schema:
{"intents":[...],"tasks":[{"id":"t1","type":"retrieve","criteria":{"raw":"..."},"k":40,"dynamic_expansion":true}, ...]}
Tipi consentiti: retrieve, annotate, correlate, reason, validate, compose.
Annotate: scegli sottoinsieme tra ["basic","entities","dates","claims"].
Inserisci sempre un task validate e un task compose finali.
Se la query richiede confronto multi-entity o correlazioni temporalmente distinte usa correlate.
Se la query implica tempo cronologia evoluzione includi intent "timeline" e reason goal "timeline".
La query: "${query}"`;
  if(!process.env.CLAUDE_API_KEY) throw new Error('CLAUDE_API_KEY missing for planner');
  const raw = await claudeRequest(CLAUDE_MODEL_PLANNER, prompt, 1400, 0);
  const jsonStart = raw.indexOf('{');
  const jsonEnd = raw.lastIndexOf('}');
  if(jsonStart>=0 && jsonEnd>jsonStart){
    const parsed = JSON.parse(raw.slice(jsonStart, jsonEnd+1));
    if(!Array.isArray(parsed.tasks)) throw new Error('tasks missing');
    planCache.set(key, parsed);
    return parsed;
  }
  throw new Error('Planner produced no JSON');
}
module.exports.plan = aiPlan;
