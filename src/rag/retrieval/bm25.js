// Minimal BM25 index in-memory (MVP). Not persistent across restarts.
class BM25Index {
  constructor(){
    this.docs = []; // {id,len}
    this.termFreq = {}; // term -> {id:count}
    this.idf = {};
  }
  add(id, text){
    const tokens = (text||'').toLowerCase().split(/[^a-z0-9àèéìòùç]+/).filter(Boolean);
    const counts = {};
    for(const t of tokens) counts[t] = (counts[t]||0)+1;
    this.docs.push({ id, len: tokens.length });
    for(const [t,c] of Object.entries(counts)){
      if(!this.termFreq[t]) this.termFreq[t] = {};
      this.termFreq[t][id] = c;
    }
  }
  finalize(){
    const N = this.docs.length || 1;
    for(const t of Object.keys(this.termFreq)){
      const df = Object.keys(this.termFreq[t]).length;
      this.idf[t] = Math.log(1 + (N - df + 0.5)/(df + 0.5));
    }
  }
  search(query, topK=30){
    const qTokens = (query||'').toLowerCase().split(/[^a-z0-9àèéìòùç]+/).filter(Boolean);
    const scores = {};
    const avgLen = this.docs.reduce((a,d)=>a+d.len,0)/(this.docs.length||1);
    const k1=1.2, b=0.75;
    for(const qt of qTokens){
      const postings = this.termFreq[qt];
      if(!postings) continue;
      const idf = this.idf[qt] || 0;
      for(const [docId,freq] of Object.entries(postings)){
        const doc = this.docs.find(d=>d.id===docId);
        const score = idf * (freq*(k1+1))/(freq + k1*(1 - b + b*doc.len/avgLen));
        scores[docId] = (scores[docId]||0) + score;
      }
    }
    return Object.entries(scores).sort((a,b)=>b[1]-a[1]).slice(0, topK).map(([id,score])=>({id,score}));
  }
}
module.exports = { BM25Index };
