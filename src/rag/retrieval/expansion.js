// Query expansion: AI-driven suggestions filtered by lexicon.
const sqlite3 = require('sqlite3').verbose();
const { claudeRequest, CLAUDE_MODEL_UTILITY } = require('../ai/claudeClient');
const db = new sqlite3.Database('./data/knowledge_hub.db');

async function aiSuggest(raw){
  if(!process.env.CLAUDE_API_KEY) return [];
  const prompt = `Dato il contesto di un'agenzia di marketing e project management, suggerisci fino a 8 termini chiave, sinonimi o concetti correlati per ampliare la ricerca per la seguente query.
Focalizzati su termini che un professionista del settore userebbe.
Query: "${raw}".
Rispondi con un array JSON semplice di stringhe. Non aggiungere spiegazioni.

Esempio:
Query: "problemi di budget progetto X"
Risposta: ["costi extra", "spese impreviste", "superamento budget", "analisi dei costi", "report finanziario"]`;
  try {
    const out = await claudeRequest(CLAUDE_MODEL_UTILITY, prompt, 400, 0);
    const s = out.indexOf('['); const e = out.lastIndexOf(']');
    if(s>=0 && e>s){
      const parsed = JSON.parse(out.slice(s,e+1));
      return Array.isArray(parsed) ? parsed.filter(x => typeof x === 'string') : [];
    }
  } catch(e) {
    console.error("AI suggestion for query expansion failed:", e);
  }
  return [];
}

function filterByLexicon(candidates){
  return new Promise(resolve=>{
    if(!candidates || !candidates.length) return resolve([]);
    const placeholders = candidates.map(()=>'?').join(',');
    db.all(`SELECT term FROM rag_lexicon WHERE term IN (${placeholders})`, candidates, (err, rows)=>{
      if(err) {
        console.error("Lexicon filtering failed:", err);
        return resolve([]);
      }
      const set = new Set(rows.map(r=>r.term));
      resolve(candidates.filter(c=>set.has(c)));
    });
  });
}

async function expandQuery(raw){
  const lowerRaw = raw.toLowerCase();
  const aiCandidates = await aiSuggest(raw);
  const aiFiltered = await filterByLexicon(aiCandidates.map(t => t.toLowerCase()));
  const merged = Array.from(new Set(aiFiltered));
  // Rimuovi i termini già presenti nella query originale per evitare ridondanza
  return merged.filter(t => !lowerRaw.includes(t));
}

module.exports = { expandQuery };
