// AI-driven entity annotator.
const { claudeRequest, CLAUDE_MODEL_ANNOTATORS } = require('../ai/claudeClient');
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./data/knowledge_hub.db');

async function llmClassify(chunks){
  if(!process.env.CLAUDE_API_KEY) throw new Error('CLAUDE_API_KEY missing for entity annotator');

  const instructions = `Dato un array di blocchi di testo, estrai le entità rilevanti per un'agenzia di marketing.
Le categorie di entità possibili sono: "project", "client", "organization", "person", "task", "kpi", "technology", "event", "other".
Per ogni entità, fornisci il valore esatto trovato nel testo e una forma "canonical" (normalizzata, in minuscolo).
Non inventare entità non presenti nel testo.

Rispondi con un array JSON, dove ogni oggetto corrisponde a un blocco di input e contiene l'indice originale e le entità trovate.
Formato: [{"index": i, "entities": [{"value": "...", "type": "...", "canonical": "..."}]}]
Se un blocco non contiene entità, l'array "entities" deve essere vuoto.
Fornisci solo il JSON come risposta.`;

  const payload = chunks.map((c,i)=>({ i, text: c.text.slice(0,1200) })); // Increased context for better entity recognition
  const prompt = instructions + '\nInput:\n' + JSON.stringify(payload);

  try {
    const raw = await claudeRequest(CLAUDE_MODEL_ANNOTATORS, prompt, 2000, 0);
    const start = raw.indexOf('['); const end = raw.lastIndexOf(']');
    if(start>=0 && end>start){
      return JSON.parse(raw.slice(start,end+1));
    }
    console.warn("LLM entity classification returned no valid JSON.");
  } catch(e){
    console.error("Error during LLM entity classification:", e);
  }
  return null;
}

module.exports.annotateEntities = async function annotateEntities(chunks){
  if(!chunks || !chunks.length) return chunks;

  // Load cached annotations
  const ids = chunks.map(c=>c.id).filter(Boolean);
  let cachedMap = new Map();
  if(ids.length){
    const placeholders = ids.map(()=>'?').join(',');
    try {
      const rows = await new Promise((resolve, reject) => {
        db.all(`SELECT chunk_id, data FROM rag_chunk_annotations WHERE annotator='entities_v2' AND chunk_id IN (${placeholders})`, ids, (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      });
      rows.forEach(r => { try { cachedMap.set(r.chunk_id, JSON.parse(r.data)); } catch(e){} });
    } catch(e){
      console.error("Failed to load cached entity annotations:", e);
    }
  }

  const needLLM = [];
  const mappingIndex = [];
  chunks.forEach((c,i)=>{
    if(!cachedMap.has(c.id)) {
        needLLM.push(c);
        mappingIndex.push(i);
    }
  });

  if(needLLM.length){
    const llmResults = await llmClassify(needLLM);
    if(llmResults){
      // Store new annotations to DB
      const stmt = db.prepare('INSERT OR REPLACE INTO rag_chunk_annotations (chunk_id, annotator, data, updated_at) VALUES (?,?,?,CURRENT_TIMESTAMP)');
      llmResults.forEach(obj => {
        const globalIndex = mappingIndex[obj.index];
        if(globalIndex == null) return;
        const chunk = chunks[globalIndex];
        const entities = (obj.entities||[]).map(e=>({
            type: e.type,
            value: e.value,
            canonical: e.canonical || e.value.toLowerCase().replace(/[^a-z0-9-]/g, '_')
        }));
        cachedMap.set(chunk.id, entities);
        try { stmt.run(chunk.id, 'entities_v2', JSON.stringify(entities)); } catch(e){ console.error("DB write for entity failed:", e); }
      });
      try { stmt.finalize(); } catch(e){ console.error("DB finalize for entities failed:", e); }
    }
  }

  // Attach entities to chunks
  return chunks.map(c => ({ ...c, entities: cachedMap.get(c.id) || [] }));
};
