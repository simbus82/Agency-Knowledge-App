const { Retriever } = require('../retrieval/retriever');
const sqlite3 = require('sqlite3').verbose();
const { annotateBasic } = require('../annotators/basic');
const { annotateEntities } = require('../annotators/entities');
const { annotateDates } = require('../annotators/dates');
const { annotateClaims } = require('../annotators/claims');
// Tool registry (connector facade) - estendibile
let toolRegistry = null;
function getToolRegistry(){
  if(toolRegistry) return toolRegistry;
  toolRegistry = {};
  // Always attempt core connectors
  try { toolRegistry.googleDrive = require('../../connectors/googleDriveConnector'); } catch(e){ console.warn('googleDrive connector non disponibile'); }
  try { toolRegistry.clickup = require('../../connectors/clickupConnector'); } catch(e){ console.warn('clickup connector non disponibile'); }
  // Gmail only if env configured
  if(process.env.GOOGLE_CREDENTIALS_JSON && process.env.GOOGLE_IMPERSONATED_USER_EMAIL){
    try { toolRegistry.gmail = require('../../connectors/gmailConnector'); } catch(e){ console.warn('gmail connector non disponibile'); }
  }
  return toolRegistry;
}

const retriever = new Retriever();
const { claudeRequest, CLAUDE_MODEL_REASONER } = require('../ai/claudeClient');
const db = new sqlite3.Database('./data/knowledge_hub.db');
// Simple in-memory cache for reasoning (query+goal hash)
const reasonCache = new Map();
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
      const retrieved = await retriever.hybridSearch(task.criteria.raw, task.k || 12, task.dynamic_expansion);
      store[task.id] = retrieved;
      try { db.run('INSERT INTO rag_artifacts (run_id, stage, payload) VALUES (?,?,?)', [graph.run_id||null, `retrieve:${task.id}`, JSON.stringify(retrieved.slice(0,20))]); } catch(e){}
    } else if(task.type==='tool_call'){
      // Esegue chiamata ad uno strumento esterno dichiarato nel piano
      if(!task.tool) throw new Error(`tool_missing:${task.id}`);
      const registry = getToolRegistry();
      const [toolName, fnName] = task.tool.split('.');
  if(!registry[toolName]){ store[task.id] = { error:true, message:`tool_not_found:${toolName}` }; continue; }
  const fn = registry[toolName][fnName];
  if(typeof fn !== 'function'){ store[task.id] = { error:true, message:`tool_function_not_found:${task.tool}` }; continue; }
      // Risoluzione parametri con template semplice {tX.path.to.value}
      let params = task.params || {};
      params = JSON.parse(JSON.stringify(params)); // clone
      function resolveTemplate(str){
        const m = /^\{(t[0-9]+)\.(.+)\}$/.exec(str.trim());
        if(!m) return str;
        const refId = m[1];
        const path = m[2].split('.');
        const base = store[refId];
        if(!base) return null;
        try {
          let cur = base;
            for(const seg of path){
              if(/^[0-9]+$/.test(seg)) cur = cur[Number(seg)]; else cur = cur[seg];
              if(cur == null) return null;
            }
          return cur;
        } catch(e){ return null; }
      }
      for(const [k,v] of Object.entries(params)){
        if(typeof v === 'string') params[k] = resolveTemplate(v);
      }
      try {
        const result = await fn(params);
        store[task.id] = result;
        try { db.run('INSERT INTO rag_artifacts (run_id, stage, payload) VALUES (?,?,?)', [graph.run_id||null, `tool:${task.id}`, JSON.stringify(Array.isArray(result)? result.slice(0,10): result)]); } catch(e){}
      } catch(e){
        store[task.id] = { error: true, message: e.message };
        console.error('Errore tool_call', task.tool, e.message);
      }
    } else if(task.type==='annotate'){
  if(!Array.isArray(task.inputs) || !task.inputs.length) throw new Error(`task_inputs_missing:${task.id}`);
  let current = task.inputs.flatMap(id => store[id]||[]);
      if(task.annotators.includes('basic')) current = annotateBasic(current);
  if(task.annotators.includes('entities')) current = await annotateEntities(current);
      if(task.annotators.includes('dates')) current = annotateDates(current);
  if(task.annotators.includes('claims')) current = await annotateClaims(current);
      // Harvest lexicon terms (entities canonical) into rag_lexicon
      harvestLexicon(current);
      store[task.id] = current;
  try { db.run('INSERT INTO rag_artifacts (run_id, stage, payload) VALUES (?,?,?)', [graph.run_id||null, `annotate:${task.id}`, JSON.stringify(current.slice(0,30))]); } catch(e){}
    } else if(task.type==='correlate'){
  if(!Array.isArray(task.inputs) || !task.inputs.length) throw new Error(`task_inputs_missing:${task.id}`);
  // naive correlation: group by product entities
  const inputs = task.inputs.flatMap(id=>store[id]||[]);
      const map = new Map();
      for(const c of inputs){
        (c.entities||[]).filter(e=>e.type==='product').forEach(e=>{
          const key = e.value.toLowerCase();
            if(!map.has(key)) map.set(key, []);
            map.get(key).push(c);
        });
      }
      store[task.id] = Array.from(map.entries()).map(([product, chunks])=>({ product, chunks }));
    } else if(task.type==='reason'){
  if(!Array.isArray(task.inputs) || !task.inputs.length) throw new Error(`task_inputs_missing:${task.id}`);
  const inputs = task.inputs.flatMap(id => store[id]||[]);
      const reasoned = await reason(inputs, task.goal);
      store[task.id] = reasoned;
      try { db.run('INSERT INTO rag_artifacts (run_id, stage, payload) VALUES (?,?,?)', [graph.run_id||null, `reason:${task.id}`, JSON.stringify(reasoned)]); } catch(e){}
    } else if(task.type==='validate'){
	if(!Array.isArray(task.inputs) || !task.inputs.length) throw new Error(`task_inputs_missing:${task.id}`);
	const inputs = task.inputs.flatMap(id => store[id]||[]);
  // Attempt to find last annotate set for entity-level conflicts
  const annotated = Object.values(store).find(v=>Array.isArray(v) && v.some(c=>c.entities||c.labels));
  store[task.id] = validate(inputs, annotated || []);
    } else if(task.type==='compose'){
  if(!Array.isArray(task.inputs) || !task.inputs.length) throw new Error(`task_inputs_missing:${task.id}`);
  const inputs = task.inputs.flatMap(id => store[id]||[]);
      store[task.id] = compose(inputs, task.format);
    }
  }
  return store[graph.tasks.at(-1).id];
}

function serializeForReasoner(chunks){
  return chunks.slice(0,30).map(c=>({
    id: c.id,
    labels: c.labels||[],
    entities: (c.entities||[]).slice(0,8),
    dates: c.dates||[],
    text: c.text.slice(0,500)
  }));
}

async function aiReason(chunks, goal){
  if(!process.env.CLAUDE_API_KEY) return null;
  const data = serializeForReasoner(chunks);
  const cacheKey = JSON.stringify({ g: goal, h: data.map(d=>d.id).join(',') });
  if(reasonCache.has(cacheKey)) return reasonCache.get(cacheKey);
  const prompt = `Sei un motore di ragionamento.
Goal: ${goal}
Evidence JSON: ${JSON.stringify(data).slice(0,16000)}
Produci SOLO JSON con schema {"conclusions":[{"text":"...","type":"..."}],"support":[{"conclusion_index":0,"evidence_ids":["id1","id2"]}]}
Regole:
- Nessuna affermazione se non supportata.
- Se esiste divieto (label "prohibition") relativo a un claim (label "claim_statement"), conclusione prioritaria type="policy_block".
- Usa type tra: policy_block, comparison, timeline, summary, other.
`; 
  try {
    const raw = await claudeRequest(CLAUDE_MODEL_REASONER, prompt, 2000, 0);
    const s = raw.indexOf('{'); const e = raw.lastIndexOf('}');
    if(s>=0 && e>s){ const parsed = JSON.parse(raw.slice(s,e+1)); reasonCache.set(cacheKey, parsed); return parsed; }
  } catch(e){ /* ignore */ }
  return null;
}

async function reason(chunks, goal){
  const ai = await aiReason(chunks, goal);
  if(ai && Array.isArray(ai.conclusions)){
    // map support to uniform structure
    const support = (ai.support||[]).flatMap(s=> (s.evidence_ids||[]).map(id=>{
      const found = chunks.find(c=>c.id===id);
      if(found) return { id, snippet: found.text.slice(0,200) };
      return null;
    }).filter(Boolean));
    const conclusions = ai.conclusions.map(c=>c.text);
  // chunk text map for advanced grounding
  const chunk_map = Object.fromEntries(chunks.map(c=>[c.id, c.text]));
  const chunk_offsets = Object.fromEntries(chunks.map(c=>[c.id, { src_start: c.src_start, src_end: c.src_end }]));
  return { conclusions, support, chunk_map, chunk_offsets };
  }
  throw new Error('reasoning_failed');
}

function validate(result, annotatedChunks){
  if(!result || !result.support) return { valid:false, issues:['missing_support'] };
  const issues = [];
  if(result.support.some(s=>!s.snippet || s.snippet.length < 5)) issues.push('weak_evidence');
  // Global conflict detection
  const conclusionsLower = (result.conclusions||[]).map(c=>c.toLowerCase());
  const hasAllow = conclusionsLower.some(c=>/consentit|permesso/.test(c));
  const hasDeny = conclusionsLower.some(c=>/non consentit|vietat|proib/.test(c));
  if(hasAllow && hasDeny) issues.push('conflict_detected');
  // Entity-specific conflicts (product entities)
  let conflict_details = [];
  if(Array.isArray(annotatedChunks)){
    const byProduct = new Map();
    annotatedChunks.forEach(c=> (c.entities||[]).filter(e=>e.type==='product').forEach(e=>{
      const key = e.canonical||e.value.toLowerCase();
      if(!byProduct.has(key)) byProduct.set(key, []);
      byProduct.get(key).push(c);
    }));
    byProduct.forEach((list, product)=>{
      const hasProh = list.some(c=>c.labels?.includes('prohibition'));
      const hasPerm = list.some(c=>c.labels?.includes('permission'));
      if(hasProh && hasPerm){
        conflict_details.push({ product, prohibition_examples: list.filter(c=>c.labels?.includes('prohibition')).slice(0,2).map(c=>c.id), permission_examples: list.filter(c=>c.labels?.includes('permission')).slice(0,2).map(c=>c.id) });
      }
    });
    if(conflict_details.length) issues.push('entity_conflict');
  }
  return { valid: issues.length===0, issues, conflict_details };
}

function compose(result, format){
  if(Array.isArray(result)){
    return { text: result.map(r=>r.text).join('\n---\n'), sources: [] };
  }
  // Grounding check: ensure each conclusion terms appear in at least one support snippet
  const grounding = [];
  const supportSnippets = (result.support||[]).map(s=>s.snippet.toLowerCase());
  result.conclusions.forEach((c,i)=>{
    const tokens = c.toLowerCase().split(/\W+/).filter(t=>t.length>5).slice(0,6);
    let hits = 0;
    tokens.forEach(t=>{ if(supportSnippets.some(sn=>sn.includes(t))) hits++; });
    const confidence = tokens.length? (hits / tokens.length): 0.3;
    grounding.push({ index:i, confidence });
  });
  // Enhanced: build timeline ordering if any conclusion type timeline and dates present
  let timeline = null;
  if((result.conclusions||[]).some(c=>/timeline/i.test(c))){
    const dateSnips = (result.support||[]).map(s=>({snippet:s.snippet, norm: extractFirstDateNorm(s.snippet)})).filter(d=>d.norm);
  const ordered = dateSnips.sort((a,b)=> a.norm.localeCompare(b.norm));
  timeline = clusterTimeline(ordered);
  }
  // Strict grounding spans (exact substring positions inside original support snippet)
  const strict = (result.support||[]).map((s,si)=>{
    const lower = s.snippet.toLowerCase();
    const matches = [];
    result.conclusions.forEach((c,ci)=>{
      const tokens = c.toLowerCase().split(/\W+/).filter(t=>t.length>6).slice(0,4);
      tokens.forEach(tok=>{
        let idx = lower.indexOf(tok);
        if(idx>=0) matches.push({ conclusion_index: ci, token: tok, start: idx, end: idx+tok.length });
      });
    });
  // enrich with absolute offsets if available
  if(s.chunk_src_start != null){
    matches.forEach(m=>{ m.absolute_start = s.chunk_src_start + (s.snippet_start||0) + m.start; m.absolute_end = s.chunk_src_start + (s.snippet_start||0) + m.end; });
  }
  return { support_index: si, chunk_id: s.id, evidence_spans: matches };
  });
  // Build citations string mapping Sx: tokens matched
  const citations = strict.map(s=>{
    const uniq = Array.from(new Set(s.evidence_spans.map(es=>es.token))).slice(0,6).join(', ');
    return { support_index: s.support_index, tokens: uniq };
  });
  // Advanced grounding over full chunk text (if chunk_map exists)
  const conclusion_grounding = [];
  if(result.chunk_map){
  result.conclusions.forEach((c,i)=>{
      const tokens = c.toLowerCase().split(/\W+/).filter(t=>t.length>5).slice(0,8);
      const spans = [];
      for(const [cid, text] of Object.entries(result.chunk_map)){
        const lower = (text||'').toLowerCase();
        tokens.forEach(tok=>{
          let searchIdx = 0; let pos;
          while((pos = lower.indexOf(tok, searchIdx))!==-1 && spans.length<40){
    const span = { chunk_id: cid, token: tok, start: pos, end: pos+tok.length };
    // absolute offset mapping if offsets known
    if(result.chunk_offsets && result.chunk_offsets[cid] && result.chunk_offsets[cid].src_start != null){
      span.absolute_start = result.chunk_offsets[cid].src_start + span.start;
      span.absolute_end = result.chunk_offsets[cid].src_start + span.end;
    }
    spans.push(span);
            searchIdx = pos + tok.length;
          }
        });
      }
      // coverage ratio unique tokens found / tokens
      const covered = new Set(spans.map(s=>s.token)).size / (tokens.length||1);
      conclusion_grounding.push({ conclusion_index: i, coverage: covered, spans: spans.slice(0,50) });
    });
  }
  return {
    conclusions: result.conclusions.map((c,i)=>({ text:c, confidence: grounding[i].confidence })),
    support: result.support,
    timeline,
    grounding_spans: strict,
    citations,
    conclusion_grounding,
    text: result.conclusions.join('\n') + '\n\nFonti:\n' + (result.support||[]).map((s,i)=>`[S${i+1}] ${s.snippet}`).join('\n'),
    validator: { grounding }
  };
}

function extractFirstDateNorm(snippet){
  const iso = snippet.match(/\b\d{4}-\d{2}-\d{2}\b/);
  if(iso) return iso[0];
  const euro = snippet.match(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/);
  if(euro){
    const parts = euro[0].split('/');
    const yyyy = parts[2].length===2? '20'+parts[2]: parts[2];
    return `${yyyy}-${parts[1].padStart(2,'0')}-${parts[0].padStart(2,'0')}`;
  }
  return null;
}

function harvestLexicon(chunks){
  if(!chunks || !chunks.length) return;
  const terms = new Map();
  chunks.forEach(c=> (c.entities||[]).forEach(e=>{
    if(!e.canonical) return; const key = e.canonical;
    if(!terms.has(key)) terms.set(key, { type:e.type, sources:new Set([c.source||'unknown']), freq:0 });
    terms.get(key).freq += 1;
  }));
  if(!terms.size) return;
  const stmtInsert = db.prepare(`INSERT INTO rag_lexicon (term,type,freq,sources,last_seen) VALUES (?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(term) DO UPDATE SET freq=freq+excluded.freq, sources=excluded.sources, last_seen=CURRENT_TIMESTAMP`);
  for(const [term,meta] of terms){
    try { stmtInsert.run(term, meta.type, meta.freq, Array.from(meta.sources).join(',')); } catch(e){ /* ignore */ }
  }
  stmtInsert.finalize();
}

function clusterTimeline(events){
  if(!events.length) return events;
  // Group consecutive dates within 2 days window
  const groups = [];
  let current = { start: events[0].norm, end: events[0].norm, items:[events[0]] };
  function dateToNum(d){ return Number(d.replace(/-/g,'')); }
  for(let i=1;i<events.length;i++){
    const prevNum = dateToNum(current.end);
    const thisNum = dateToNum(events[i].norm);
    if(thisNum - prevNum <= 2){
      current.end = events[i].norm;
      current.items.push(events[i]);
    } else {
      groups.push(current); current = { start: events[i].norm, end: events[i].norm, items:[events[i]] };
    }
  }
  groups.push(current);
  return groups.map(g=>({ range: g.start===g.end? g.start: `${g.start}..${g.end}`, count: g.items.length, snippets: g.items.slice(0,3).map(i=>i.snippet) }));
}

// NOTE: Hard offset mapping (future): to support original-file offsets, store for each chunk its source path and character start/end when ingesting.
// Then replace snippet-only spans with absolute offsets (path, start_char, end_char). Current design keeps snippet spans only.

module.exports = { executeGraph };
