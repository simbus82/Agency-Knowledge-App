// LLM-based reranker: given query and candidate chunks, returns rescored list.
// Uses Claude via claudeRequest; falls back to original ordering.
const { claudeRequest, CLAUDE_MODEL_REASONER } = require('../ai/claudeClient');

async function llmRerank(query, candidates, withExplain=false){
  if(!process.env.CLAUDE_API_KEY) return null;
  if(!candidates.length) return [];
  const subset = candidates.slice(0, Math.min(candidates.length, 30));
  const payload = subset.map((c,i)=>({ i, id:c.id, text:(c.text||'').slice(0,350) }));
  const prompt = withExplain
    ? `Reranking con spiegazioni.
Query: "${query}"
Per ogni passaggio assegna rel (0-5) e motivazione breve (<15 parole).
Rispondi SOLO JSON array: [{"i":index,"rel":0-5,"why":"..."}]`
    : `Reranking.
Query: "${query}"
Valuta pertinenza (0-5 interi) di ciascun passaggio rispetto alla query.
Rispondi SOLO JSON array: [{"i":index,"rel":0-5}].`;
  try {
    const raw = await claudeRequest(CLAUDE_MODEL_REASONER, prompt + '\n' + JSON.stringify(payload).slice(0,16000), 1400, 0);
    const s = raw.indexOf('['); const e = raw.lastIndexOf(']');
    if(s>=0 && e>s){
  const arr = JSON.parse(raw.slice(s,e+1));
  const map = new Map(arr.map(r=>[r.i, r]));
  return subset.map((c,i)=>({ ...c, rel: (map.get(i)?.rel??0), why: map.get(i)?.why }));
    }
  } catch(e){ /* ignore */ }
  return null;
}

module.exports = { llmRerank };
