const { Retriever } = require('../retrieval/retriever');
const { annotateBasic } = require('../annotators/basic');

const retriever = new Retriever();
let retrieverReady = false;
retriever.loadIndex().then(()=>{ retrieverReady = true; console.log('[RAG] Index loaded'); }).catch(e=>console.error('RAG load error', e));

async function ensureReady(){
  if(!retrieverReady){
    await new Promise(r=>setTimeout(r,50));
    return ensureReady();
  }
}

async function executeGraph(graph){
  await ensureReady();
  const store = {};
  for(const task of graph.tasks){
    if(task.type==='retrieve'){
      store[task.id] = await retriever.hybridSearch(task.criteria.raw, task.k || 12);
    } else if(task.type==='annotate'){
      const inputs = task.inputs.flatMap(id => store[id]||[]);
      if(task.annotators.includes('basic')) store[task.id] = annotateBasic(inputs);
      else store[task.id] = inputs;
    } else if(task.type==='reason'){
      const inputs = task.inputs.flatMap(id => store[id]||[]);
      store[task.id] = reason(inputs, task.goal);
    } else if(task.type==='validate'){
      const inputs = task.inputs.flatMap(id => store[id]||[]);
      store[task.id] = validate(inputs);
    } else if(task.type==='compose'){
      const inputs = task.inputs.flatMap(id => store[id]||[]);
      store[task.id] = compose(inputs, task.format);
    }
  }
  return store[graph.tasks.at(-1).id];
}

function reason(chunks, goal){
  const conclusions = [];
  const support = [];
  const prohibitions = chunks.filter(c=>c.labels?.includes('prohibition'));
  if(goal==='policy_lookup' && prohibitions.length){
    conclusions.push('Divieto rilevato: il claim risulta non consentito in almeno una fonte.');
    prohibitions.slice(0,5).forEach(c=>support.push({id:c.id, snippet:c.text.slice(0,200)}));
  }
  if(goal==='timeline'){
    const ordered = chunks.slice(0,8); // placeholder (manca estrazione date)
    conclusions.push('Timeline sintetica (ordine testi recuperati):');
    ordered.forEach((c,i)=> support.push({id:c.id, snippet:`[${i+1}] ${c.text.slice(0,120)}`}));
  }
  if(goal==='comparison'){
    conclusions.push('Confronto preliminare (heuristic):');
    chunks.slice(0,6).forEach(c=>support.push({id:c.id, snippet:c.text.slice(0,140)}));
  }
  if(conclusions.length===0){
    conclusions.push(`Sintesi (${goal}): ${chunks.slice(0,3).map(c=>c.text.slice(0,60)).join(' | ')}`);
    chunks.slice(0,5).forEach(c=>support.push({id:c.id, snippet:c.text.slice(0,120)}));
  }
  return { conclusions, support };
}

function validate(result){
  // Check support consistency
  if(!result || !result.support) return { valid:false, issues:['missing_support'] };
  return { valid:true, issues:[] };
}

function compose(result, format){
  if(Array.isArray(result)){
    return { text: result.map(r=>r.text).join('\n---\n'), sources: [] };
  }
  return {
    text: result.conclusions.join('\n') + '\n\nFonti:\n' + (result.support||[]).map((s,i)=>`[S${i+1}] ${s.snippet}`).join('\n'),
    sources: result.support
  };
}

module.exports = { executeGraph };
