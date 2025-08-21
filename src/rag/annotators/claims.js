// Claim annotator (heuristic multi-label) -> later replace with classifier.
const { claudeRequest, CLAUDE_MODEL_ANNOTATORS } = require('../ai/claudeClient');
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./data/knowledge_hub.db');

async function llmClassifyClaims(chunks){
  if(!process.env.CLAUDE_API_KEY) throw new Error('CLAUDE_API_KEY missing for claims annotator');
  const prompt = `Etichetta ciascun testo con labels subset di ["claim_statement","prohibition","permission"]. Rispondi JSON array: [{"i":index,"labels":[...] }]. Non inventare nuove labels.`;
  const payload = chunks.map((c,i)=>({ i, text: (c.text||'').slice(0,500) }));
  try {
    const raw = await claudeRequest(CLAUDE_MODEL_ANNOTATORS, prompt + '\n' + JSON.stringify(payload).slice(0,16000), 1600, 0);
    const s = raw.indexOf('['); const e = raw.lastIndexOf(']');
    if(s>=0 && e>s){ return JSON.parse(raw.slice(s,e+1)); }
  } catch(e){ /* ignore */ }
  return null;
}

module.exports.annotateClaims = async function annotateClaims(chunks){
  if(!chunks.length) return chunks;
  const ids = chunks.map(c=>c.id).filter(Boolean);
  let cached = new Map();
  if(ids.length){
    const placeholders = ids.map(()=>'?').join(',');
    try {
      const rows = await new Promise(resolve=>{
        db.all(`SELECT chunk_id,data FROM rag_chunk_annotations WHERE annotator='claims_v1' AND chunk_id IN (${placeholders})`, ids, (err, rows)=> resolve(err?[]:rows));
      });
      rows.forEach(r=>{ try { cached.set(r.chunk_id, JSON.parse(r.data)); } catch(e){} });
    } catch(e){}
  }
  const need = []; const mapping = [];
  chunks.forEach((c,i)=>{ if(!cached.has(c.id)) { need.push(c); mapping.push(i); } });
  let llm=null; if(need.length) llm = await llmClassifyClaims(need);
  if(llm){
    const stmt = db.prepare('INSERT OR REPLACE INTO rag_chunk_annotations (chunk_id, annotator, data, updated_at) VALUES (?,?,?,CURRENT_TIMESTAMP)');
    llm.forEach(obj=>{
      const globalIndex = mapping[obj.i]; if(globalIndex==null) return;
      const chunk = chunks[globalIndex];
      const labels = Array.from(new Set([...(cached.get(chunk.id)||[]), ...(obj.labels||[])]));
      cached.set(chunk.id, labels);
      try { stmt.run(chunk.id, 'claims_v1', JSON.stringify(labels)); } catch(e){}
    });
    try { stmt.finalize(); } catch(e){}
  }
  // Require all chunks annotated
  const missing = chunks.filter(c=> !cached.has(c.id));
  if(missing.length) throw new Error('Claim annotation incomplete');
  return chunks.map(c=> ({ ...c, labels: cached.get(c.id) }));
};
