const sqlite3 = require('sqlite3').verbose();
const { BM25Index } = require('./bm25');
const { embedBatch } = require('../util/embeddings');
const { expandQuery } = require('./expansion');
const { llmRerank } = require('./reranker');
const fs = require('fs');

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
  this.lexicon = []; // { term, embedding:Array }
  this.lexiconLoaded = false;
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
  async hybridSearch(query, k=12, dynamicExpansion=false){
    let expansions = expandQuery(query);
    if(dynamicExpansion){
      // Future: integrate AI / embedding-based nearest lexicon terms.
      // Placeholder: if no heuristic expansions, reuse top BM25 tokens (after initial small search)
      if(!expansions.length){
        const prelim = this.bm25.search(query, 10);
        const tokenFreq = new Map();
        prelim.forEach(p=> (p.text||'').toLowerCase().split(/[^\w]+/).forEach(t=>{ if(t.length>5){ tokenFreq.set(t,(tokenFreq.get(t)||0)+1); } }));
        expansions = Array.from(tokenFreq.entries()).sort((a,b)=>b[1]-a[1]).slice(0,3).map(e=>e[0]);
      }
      // Lexicon similarity expansion
      await this.ensureLexicon();
      try {
        const [qEmb] = await embedBatch([query]);
        const scored = this.lexicon.filter(l=>l.embedding).map(l=>({ term:l.term, score: cosine(qEmb, l.embedding) }))
          .sort((a,b)=>b.score-a.score).slice(0,8);
        const extra = scored.filter(s=>s.score>0.78 && !query.toLowerCase().includes(s.term) && !expansions.includes(s.term)).slice(0,3).map(s=>s.term);
        expansions = expansions.concat(extra);
      } catch(e){ /* ignore */ }
    }
    const expandedQuery = expansions.length ? `${query} ${expansions.join(' ')}` : query;
    const bm = this.bm25.search(expandedQuery, 80);
    const [qEmb] = await embedBatch([query]);
    // load adaptive weights once per search
    const weights = await new Promise(resolve=>{
      this.db.get('SELECT w_sim,w_bm25,w_llm FROM rag_retrieval_weights WHERE id=1', (err,row)=>{
        if(err||!row) return resolve({ w_sim:0.5, w_bm25:0.45, w_llm:0.2 });
        resolve(row);
      });
    });
    const rescored = bm.map(r=>{
      const emb = this.memoryEmbeddings[r.id];
      const sim = emb ? cosine(qEmb, emb) : 0.0;
      // simple rerank heuristic: boost if expansion terms appear in text
      let boost = 0;
      if(expansions.length){
        const txt = (r.text||'').toLowerCase();
        boost = expansions.reduce((acc,term)=> acc + (txt.includes(term)?0.05:0), 0);
      }
      return { id: r.id, base_bm25: normalize(r.score, bm), base_sim: sim, boost, score: (weights.w_sim||0.5)*sim + (weights.w_bm25||0.45)*normalize(r.score, bm) + boost };
    }).sort((a,b)=>b.score-a.score).slice(0,k);
    const ids = rescored.map(r=>r.id);
    return new Promise((resolve,reject)=>{
      if(ids.length===0) return resolve([]);
      const placeholders = ids.map(()=>'?').join(',');
        this.db.all(`SELECT * FROM rag_chunks WHERE id IN (${placeholders})`, ids, async (err, rows)=>{
        if(err) return reject(err);
        let enriched = rows.map(r=>({ ...r, ...rescored.find(x=>x.id===r.id), expansionsUsed: expansions }));
        // LLM rerank pass (optional)
          // simple in-memory reranker result cache key
          const rerankKey = 'rr:' + query.slice(0,120) + ':' + enriched.map(e=>e.id).join(',');
          if(!this._rerankCache) this._rerankCache = new Map();
          let llm = this._rerankCache.get(rerankKey);
          if(llm===undefined){
            const explain = dynamicExpansion; // reuse flag as trigger for now
            llm = await llmRerank(query, enriched, explain);
            this._rerankCache.set(rerankKey, llm);
            // cap cache size
            if(this._rerankCache.size>200){
              const firstKey = this._rerankCache.keys().next().value; this._rerankCache.delete(firstKey);
            }
          }
        if(llm){
          // merge relevance (rel 0-5) into final score
          const map = new Map(llm.map(l=>[l.id, l.rel]));
            enriched = enriched.map(c=>{
                const rel = map.get(c.id); if(rel!=null){ c.llm_rel = rel; c.score = (weights.w_sim||0.5)*0.8*c.base_sim + (weights.w_bm25||0.45)*0.7*c.base_bm25 + (weights.w_llm||0.2)*(rel/5) + c.boost; }
              return c;
            }).sort((a,b)=>b.score-a.score);
            // attach explanation if present
            llm.forEach(r=>{
              if(r.why){ const target = enriched.find(e=>e.id===r.id); if(target) target.llm_why = r.why; }
            });
        }
          return resolve(enriched);
      });
    });
  }

  ensureLexicon(){
    if(this.lexiconLoaded) return Promise.resolve();
    return new Promise((resolve)=>{
      this.db.all('SELECT term, embedding FROM rag_lexicon WHERE embedding IS NOT NULL LIMIT 500', (err, rows)=>{
        if(!err && rows){
          this.lexicon = rows.map(r=>{
            let emb=null; try { emb = JSON.parse(r.embedding); } catch(e){}
            return { term:r.term, embedding: emb };
          }).filter(l=>Array.isArray(l.embedding));
        }
        this.lexiconLoaded = true;
        resolve();
      });
    });
  }
}

function normalize(val, arr){
  const scores = arr.map(a=>a.score); const min=Math.min(...scores), max=Math.max(...scores); if(max===min) return 0.5; return (val-min)/(max-min);
}

module.exports = { Retriever };
