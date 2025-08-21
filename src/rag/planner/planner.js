// Simple planner MVP: produce a task graph for generalized queries.
// Later this can be replaced by an LLM-based planner.
module.exports.plan = function plan(query) {
  const lower = query.toLowerCase();
  const intents = [];
  if(/report|confronta|confrontare|differenza/.test(lower)) intents.push('comparison');
  if(/timeline|cronologia|quando|storia/.test(lower)) intents.push('timeline');
  if(/claim|posso dire|si puo|si può|è un|e' un/.test(lower)) intents.push('policy_lookup');
  if(/riassum|sintesi|summary|panoramica/.test(lower)) intents.push('summary');
  if(intents.length === 0) intents.push('general_lookup');

  const tasks = [];
  tasks.push({ id:'t1', type:'retrieve', source:'all', criteria:{ raw: query }, k: 40 });
  tasks.push({ id:'t2', type:'annotate', inputs:['t1'], annotators:['basic'] });
  if(intents.includes('comparison')){
    tasks.push({ id:'t3', type:'reason', inputs:['t2'], goal:'comparison' });
  } else if(intents.includes('timeline')){
    tasks.push({ id:'t3', type:'reason', inputs:['t2'], goal:'timeline' });
  } else if(intents.includes('policy_lookup')){
    tasks.push({ id:'t3', type:'reason', inputs:['t2'], goal:'policy_lookup' });
  } else {
    tasks.push({ id:'t3', type:'reason', inputs:['t2'], goal:intents.join('+') });
  }
  tasks.push({ id:'t4', type:'validate', inputs:['t3'] });
  tasks.push({ id:'t5', type:'compose', inputs:['t3','t4'], format:'plain' });
  return { query, intents, tasks };
};
