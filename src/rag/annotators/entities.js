// AI-driven entity annotator (no heuristic fallback). Hard requirement: CLAUDE_API_KEY must be set.

const { claudeRequest, CLAUDE_MODEL_ANNOTATORS } = require('../ai/claudeClient');
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./data/knowledge_hub.db');

function extractCandidates(chunk){
  const text = chunk.text || '';
  const set = new Set();
  const taskPattern = /\bTASK[- ]?[0-9]{2,8}\b/g;
  (text.match(taskPattern)||[]).forEach(t=>set.add(t));
  const caps = text.match(/\b[A-Z][A-Za-zÀ-ÖØ-öø-ÿ0-9]{2,}\b/g) || [];
  caps.slice(0,25).forEach(c=>set.add(c));
  return Array.from(set).slice(0,40);
}

async function llmClassify(chunks){
  if(!process.env.CLAUDE_API_KEY) throw new Error('CLAUDE_API_KEY missing for entity annotator');
  const instructions = `Classifica entità candidate.
Ritorna JSON array per ogni blocco: [{"index":i,"entities":[{"value":"...","type":"product|organization|task|person|other","canonical":"..."}]}]
Non inventare entità non presenti. Usa 'task' se pattern TASK-123. Usa lowercase per canonical semplificato.`;
  const payload = chunks.map((c,i)=>({ i, text: c.text.slice(0,800), cand: extractCandidates(c) }));
  const prompt = instructions + '\n' + JSON.stringify(payload).slice(0,16000);
  try {
    const raw = await claudeRequest(CLAUDE_MODEL_ANNOTATORS, prompt, 1800, 0);
    const start = raw.indexOf('['); const end = raw.lastIndexOf(']');
    if(start>=0 && end>start){
      return JSON.parse(raw.slice(start,end+1));
    }
  } catch(e){ /* swallow */ }
  return null;
}

module.exports.annotateEntities = async function annotateEntities(chunks){
  if(!chunks.length) return chunks;
  // Load cached annotations
  const ids = chunks.map(c=>c.id).filter(Boolean);
  let cachedMap = new Map();
  if(ids.length){
    const placeholders = ids.map(()=>'?').join(',');
    try {
      const rows = await new Promise((resolve)=>{
        db.all(`SELECT chunk_id,data FROM rag_chunk_annotations WHERE annotator='entities_v1' AND chunk_id IN (${placeholders})`, ids, (err, rows)=> resolve(err?[]:rows));
      });
      rows.forEach(r=>{ try { cachedMap.set(r.chunk_id, JSON.parse(r.data)); } catch(e){} });
    } catch(e){}
  }
  const needLLM = [];
  const mappingIndex = [];
  chunks.forEach((c,i)=>{
    if(cachedMap.has(c.id)) return; // already cached
    needLLM.push(c); mappingIndex.push(i);
  });
  let llm=null;
  if(needLLM.length){ llm = await llmClassify(needLLM); }
  if(llm){
    // store to DB
    const stmt = db.prepare('INSERT OR REPLACE INTO rag_chunk_annotations (chunk_id, annotator, data, updated_at) VALUES (?,?,?,CURRENT_TIMESTAMP)');
    llm.forEach(obj=>{
      const globalIndex = mappingIndex[obj.index];
      if(globalIndex==null) return;
      const chunk = chunks[globalIndex];
      const entities = (obj.entities||[]).map(e=>({ type:e.type, value:e.value, canonical:e.canonical||e.value.toLowerCase() }));
      cachedMap.set(chunk.id, entities);
      try { stmt.run(chunk.id, 'entities_v1', JSON.stringify(entities)); } catch(e){}
    });
    try { stmt.finalize(); } catch(e){}
  }
  // Require all chunks annotated; if any missing -> error
  const missing = chunks.filter(c=> !cachedMap.has(c.id));
  if(missing.length) throw new Error('Entity annotation incomplete');
  return chunks.map(c=> ({ ...c, entities: cachedMap.get(c.id) }));
};
