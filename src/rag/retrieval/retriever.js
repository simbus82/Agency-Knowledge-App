const sqlite3 = require('sqlite3').verbose();
const { BM25Index } = require('./bm25');
const { embedBatch } = require('../util/embeddings');

function cosine(a,b){
  let dot=0, na=0, nb=0; const len = Math.min(a.length, b.length);
  for(let i=0;i<len;i++){ dot+=a[i]*b[i]; na+=a[i]*a[i]; nb+=b[i]*b[i]; }
  return dot/Math.sqrt((na||1)*(nb||1));
}

class Retriever {
  constructor(dbPath='./data/knowledge_hub.db'){
    this.db = new sqlite3.Database(dbPath);
    this.bm25 = new BM25Index();
    this.memoryEmbeddings = {}; // id -> embedding array
  }
  loadIndex(){
    return new Promise((resolve,reject)=>{
      this.db.all('SELECT id, text, embedding FROM rag_chunks', (err, rows)=>{
        if(err) return reject(err);
        rows.forEach(r=>{ 
          this.bm25.add(r.id, r.text); 
          if(r.embedding){ try { this.memoryEmbeddings[r.id] = JSON.parse(r.embedding); } catch(e){ /* ignore */ } }
        });
        this.bm25.finalize();
        resolve({ count: rows.length });
      });
    });
  }
  async hybridSearch(query, k=12){
    const bm = this.bm25.search(query, 60);
    const [qEmb] = await embedBatch([query]);
    const rescored = bm.map(r=>{
      const emb = this.memoryEmbeddings[r.id];
      const sim = emb ? cosine(qEmb, emb) : 0.0;
      return { id: r.id, score: 0.55*sim + 0.45*normalize(r.score, bm) };
    }).sort((a,b)=>b.score-a.score).slice(0,k);
    const ids = rescored.map(r=>r.id);
    return new Promise((resolve,reject)=>{
      if(ids.length===0) return resolve([]);
      const placeholders = ids.map(()=>'?').join(',');
      this.db.all(`SELECT * FROM rag_chunks WHERE id IN (${placeholders})`, ids, (err, rows)=>{
        if(err) return reject(err);
        resolve(rows.map(r=>({ ...r, score: rescored.find(x=>x.id===r.id).score })));
      });
    });
  }
}

function normalize(val, arr){
  const scores = arr.map(a=>a.score); const min=Math.min(...scores), max=Math.max(...scores); if(max===min) return 0.5; return (val-min)/(max-min);
}

module.exports = { Retriever };
