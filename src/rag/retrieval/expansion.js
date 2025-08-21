// Query expansion: heuristic + optional AI suggestions filtered by lexicon.
const sqlite3 = require('sqlite3').verbose();
const { claudeRequest, CLAUDE_MODEL_PLANNER } = require('../ai/claudeClient');
const db = new sqlite3.Database('./data/knowledge_hub.db');

const EXPANSION_SEEDS = [
  ['claim','claims','dichiarazione','affermazione'],
  ['timeline','cronologia','storia'],
  ['prodotto','product','prodotti'],
  ['task','attività','ticket'],
  ['divieto','vietato','proibizione','proibito']
];

function heuristic(raw){
  const lower = raw.toLowerCase();
  const expansions = new Set();
  for(const group of EXPANSION_SEEDS){
    if(group.some(t=>lower.includes(t))) group.forEach(t=>expansions.add(t));
  }
  return Array.from(expansions).filter(t=>!lower.includes(t));
}

async function aiSuggest(raw){
  if(!process.env.CLAUDE_API_KEY) return [];
  const prompt = `Suggerisci fino a 6 termini chiave o sinonimi utili per ampliare la ricerca della query seguente, solo parole o brevi frasi senza spiegazioni.
Query: "${raw}".
Rispondi JSON array semplice di stringhe.`;
  try {
    const out = await claudeRequest(CLAUDE_MODEL_PLANNER, prompt, 400, 0);
    const s = out.indexOf('['); const e = out.lastIndexOf(']');
    if(s>=0 && e>s){ return JSON.parse(out.slice(s,e+1)).filter(x=>typeof x==='string'); }
  } catch(e){ }
  return [];
}

function filterByLexicon(candidates){
  return new Promise(resolve=>{
    if(!candidates.length) return resolve([]);
    const placeholders = candidates.map(()=>'?').join(',');
    db.all(`SELECT term FROM rag_lexicon WHERE term IN (${placeholders})`, candidates, (err, rows)=>{
      if(err) return resolve([]);
      const set = new Set(rows.map(r=>r.term));
      resolve(candidates.filter(c=>set.has(c)));
    });
  });
}

async function expandQuery(raw){
  const base = heuristic(raw);
  const ai = await aiSuggest(raw);
  const aiFiltered = await filterByLexicon(ai.map(t=>t.toLowerCase()));
  const merged = Array.from(new Set([...base, ...aiFiltered]));
  return merged.filter(t=>!raw.toLowerCase().includes(t));
}

module.exports = { expandQuery };
