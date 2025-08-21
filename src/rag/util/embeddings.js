// Embedding provider using OpenAI text-embedding-3-small (economical, 1536 dims)
// Falls back to pseudo embedding if API key missing.
const crypto = require('crypto');
let OpenAIClient = null;
try { OpenAIClient = require('openai').OpenAI; } catch(e) {}

const MODEL = process.env.EMBEDDING_MODEL || 'text-embedding-3-small';

function pseudoEmbed(text){
  const dim = 128; const arr = new Float32Array(dim);
  const tokens = (text||'').toLowerCase().split(/\s+/).slice(0,512);
  for(const tok of tokens){
    let h=0; for(let i=0;i<tok.length;i++){ h = (h*31 + tok.charCodeAt(i))>>>0; }
    arr[h % dim] += 1;
  }
  let norm = Math.sqrt(arr.reduce((a,v)=>a+v*v,0))||1;
  for(let i=0;i<dim;i++) arr[i] /= norm;
  return Array.from(arr);
}

async function embedBatch(texts){
  if(!process.env.OPENAI_API_KEY || !OpenAIClient){
    return texts.map(t=>pseudoEmbed(t));
  }
  const client = new OpenAIClient({ apiKey: process.env.OPENAI_API_KEY });
  const res = await client.embeddings.create({ model: MODEL, input: texts });
  return res.data.map(d=>d.embedding);
}

async function embedAndStoreLexiconTerms(db){
  return new Promise((resolve)=>{
    db.all('SELECT term FROM rag_lexicon WHERE embedding IS NULL LIMIT 50', async (err, rows)=>{
      if(err || !rows || !rows.length) return resolve(0);
      const terms = rows.map(r=>r.term);
      const embs = await embedBatch(terms);
      const stmt = db.prepare('UPDATE rag_lexicon SET embedding = ? WHERE term = ?');
      for(let i=0;i<terms.length;i++){
        try { stmt.run(JSON.stringify(embs[i]), terms[i]); } catch(e){}
      }
      stmt.finalize(()=>resolve(terms.length));
    });
  });
}

module.exports = { embedBatch, embedAndStoreLexiconTerms };
