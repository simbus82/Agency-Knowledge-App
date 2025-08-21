// Simple planner MVP: produce a task graph for generalized queries.
// Later this can be replaced by an LLM-based planner.
const { claudeRequest, CLAUDE_MODEL_PLANNER } = require('../ai/claudeClient');
const planCache = new Map();

async function aiPlan(query){
  const key = query.trim().toLowerCase();
  if(planCache.has(key)) return planCache.get(key);
  const prompt = `Sei un pianificatore. Data la query utente genera SOLO JSON valido (nessun testo extra) con schema:
{"intents":["..."],"tasks":[
  {"id":"t1","type":"retrieve","criteria":{"raw":"..."},"k":40,"dynamic_expansion":true},
  {"id":"t2","type":"annotate","annotators":["basic","entities"],"inputs":["t1"]},
  {"id":"t3","type":"reason","goal":"summary","inputs":["t2"]},
  {"id":"t4","type":"validate","inputs":["t3"]},
  {"id":"t5","type":"compose","format":"text","inputs":["t4"]}
]}
Regole IMPORTANTI:
1. Tipi consentiti: retrieve, annotate, correlate, reason, validate, compose.
2. Ogni task NON di tipo retrieve DEVE avere "inputs":[...] con id di task precedenti (nessun riferimento futuro).
3. annotate: scegli sottoinsieme tra ["basic","entities","dates","claims"].
4. Inserisci sempre UNO (1) task validate e UNO (1) task compose finali (gli ultimi due step della pipeline).
5. Se servono correlazioni multi-entity o comparazioni temporali aggiungi un task correlate (con inputs dal precedente annotate).
6. Se la query implica evoluzione temporale aggiungi intent "timeline" e usa goal "timeline" nel task reason.
7. Mantieni una catena lineare semplice salvo necessità di correlate; niente branching complesso.
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
