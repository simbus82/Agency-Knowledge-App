// Backfill embeddings for rag_chunks without embedding stored.
const sqlite3 = require('sqlite3').verbose();
const { embedBatch } = require('./embeddings');

async function run(){
  const db = new sqlite3.Database('./data/knowledge_hub.db');
  const rows = await new Promise((resolve,reject)=>{
    db.all('SELECT id, text FROM rag_chunks WHERE embedding IS NULL OR embedding = "" LIMIT 500', (e,r)=> e?reject(e):resolve(r));
  });
  if(!rows.length){ console.log('No chunks to embed'); db.close(); return; }
  const texts = rows.map(r=>r.text);
  const vectors = await embedBatch(texts);
  await new Promise((resolve)=>{
    const stmt = db.prepare('UPDATE rag_chunks SET embedding = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
    vectors.forEach((vec,i)=> stmt.run(JSON.stringify(vec), rows[i].id));
    stmt.finalize(()=>resolve());
  });
  console.log('Embedded', rows.length, 'chunks');
  db.close();
}

if(require.main === module){ run(); }
module.exports = { run };
