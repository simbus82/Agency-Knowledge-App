const express = require('express');

module.exports = function ragRouterFactory(deps){
  const {
    db,
    logger,
    axios,
    plan,
    executeGraph,
    parseIntent,
    synthesizeConversationalAnswer,
    embedAndStoreLexiconTerms,
    ingestDriveContent,
    sanitizeModelId,
    claudeRequest,
    getUserGoogleToken,
    isAdminRequest
  } = deps;
  const router = express.Router();

  // RAG chat completo con fast-path (portato da server.js)
  router.post('/api/rag/chat', async (req, res) => {
    if(!req.session.user) return res.status(401).json({ error:'Not authenticated' });
    const { message, include_chunk_texts=false } = req.body || {};
    if(!message) return res.status(400).json({ error:'message required' });
    const startTs = Date.now();

    // Small-talk / greeting
    try {
      const m = (message||'').trim().toLowerCase();
      const isGreeting = /^(ciao|hey|ehi|salve|buongiorno|buonasera|hola|hello|hi)[!.\s]*$/.test(m) || m.length <= 4;
      if (isGreeting) {
        const userName = req.session.user?.name?.split(' ')[0] || 'Utente';
        const clickupConnected = !!(req.session.user?.clickupToken || process.env.CLICKUP_API_KEY);
        const driveConnected = !!(req.session.user?.googleAccessToken || (process.env.GOOGLE_CREDENTIALS_JSON && process.env.GOOGLE_IMPERSONATED_USER_EMAIL));
        const prompt = `Sei l'Assistente Esecutivo AI di 56k Agency. Saluta l'utente (${userName}) in modo caldo e professionale in italiano, spiega brevemente cosa puoi fare con le connessioni disponibili e proponi 3 esempi di domande utili.\nConnessioni: ClickUp=${clickupConnected?'connesso':'non connesso'}, Drive=${driveConnected?'connesso':'non connesso'}.`;
        const text = await claudeRequest(process.env.CLAUDE_RAG_UTILITY_MODEL || process.env.SELECTED_CLAUDE_MODEL || 'claude-sonnet-4-20250514', prompt, 400, 0.2);
        return res.json({ run_id: null, query: message, intent: { action:'CHAT' }, answer: text, latency_ms: Date.now()-startTs, graph: { tasks: [] }, structured: { result: { conclusions: [text], support: [] } } });
      }
    } catch(_){}

    // Fast-path: task in ritardo / urgenti
    try {
      const m = (message||'').toLowerCase();
      const reOverdue = /(in\s+ritardo|ritardi|overdue|scadenz|scadut[oi]e?)/i;
      const reUrgent = /(urgenti?|priorit\u00e0\s*alta|alta\s*priorit\u00e0|urgent|high\s*priority)/i;
      const wantsOverdue = reOverdue.test(m); const wantsUrgent = reUrgent.test(m);
      const clickupToken = req.session.user?.clickupToken || process.env.CLICKUP_API_KEY || null;
      if ((wantsOverdue || wantsUrgent) && clickupToken) {
        let teamId = process.env.CLICKUP_TEAM_ID || null;
        if(!teamId && req.session.user?.clickupToken){ try { const t = await axios.get('https://api.clickup.com/api/v2/team', { headers:{ Authorization: req.session.user.clickupToken } }); teamId = t.data?.teams?.[0]?.id || null; } catch(_e){} }
        const clickup = require('../connectors/clickupConnector');
        let chunks = [];
        try {
          if (wantsOverdue) chunks = await clickup.searchTasks({ teamId, overdueOnly: true, includeClosed: false, includeSubtasks: true, limit: 100, token: clickupToken });
          else chunks = await clickup.searchTasks({ teamId, includeClosed: false, includeSubtasks: true, limit: 100, token: clickupToken });
        } catch(e){ logger.error('Fast-path ClickUp search failed', e.message||e); chunks = []; }
        if (Array.isArray(chunks)) {
          const maxItems = Math.min(chunks.length, 12);
          const lines = chunks.slice(0, maxItems).map((c)=>`- ${c.text.split('\n')[0]}  (Apri: ${c.path.replace('clickup://task/','https://app.clickup.com/t/')})`);
          const head = wantsOverdue ? `Task in ritardo trovati: ${chunks.length}` : `Task urgenti/aperti trovati: ${chunks.length}`;
          const tip = chunks.length>maxItems ? `\n...e altri ${chunks.length-maxItems}` : '';
          const answer = `**${head}**\n\n${lines.join('\n')}${tip}`;
          return res.json({ run_id: null, query: message, intent: { action:'LIST' }, answer, latency_ms: Date.now()-startTs, graph: { tasks: [] }, structured: { result: { conclusions: [head], support: chunks.slice(0,15).map((c)=>({ id:c.id, snippet:c.text.slice(0,200), path:c.path })) } } });
        }
      }
    } catch(_){}

    // Fast-path: Drive documenti recenti
    try {
      const text = (message||'').toLowerCase();
      const mentionsDocs = /(documenti|documento|file|files|doc|docs|drive)/i.test(text);
      const mentionsRecency = /(oggi|today|settimana|questa\s+settimana|week|mese|ultimo\s+mese|month|recenti|recent|ultimi|aggiornati|modificati)/i.test(text);
      if (mentionsDocs && mentionsRecency) {
        const now = new Date(); let since = null;
        if (/(oggi|today)/i.test(text)) { since = new Date(); since.setHours(0,0,0,0); }
        else if (/(settimana|questa\s+settimana|week)/i.test(text)) { since = new Date(now.getTime() - 7*24*60*60*1000); }
        else if (/(mese|ultimo\s+mese|month)/i.test(text)) { since = new Date(now.getTime() - 30*24*60*60*1000); }
        else if (/(recenti|recent|ultimi|aggiornati|modificati)/i.test(text)) { since = new Date(now.getTime() - 7*24*60*60*1000); }
        let accessToken = null; try { accessToken = await getUserGoogleToken(req); } catch(_) { accessToken = req.session.user?.googleAccessToken || null; }
        if (accessToken) {
          const qParts = ["trashed = false"]; if (since) qParts.push(`modifiedTime > '${since.toISOString()}'`);
          const q = qParts.join(' and ');
          let files = [];
          try {
            const resp = await axios.get('https://www.googleapis.com/drive/v3/files', { headers: { Authorization: `Bearer ${accessToken}` }, params: { q, orderBy:'modifiedTime desc', pageSize: 25, fields: 'files(id,name,mimeType,webViewLink,createdTime,modifiedTime,owners)', corpora:'allDrives', includeItemsFromAllDrives:true, supportsAllDrives:true } });
            files = resp.data?.files || [];
          } catch(e){ logger.error('Drive fast-path query failed', e.response?.data?.error?.message || e.message); files = []; }
          const fmt = (f)=> `- ${f.name} (${new Date(f.modifiedTime).toLocaleDateString('it-IT')})  [Apri](${f.webViewLink})`;
          const head = `Documenti ${since? 'modificati di recente':''}: ${files.length}`;
          const top = files.slice(0,12).map(fmt).join('\n'); const tip = files.length>12? `\n...e altri ${files.length-12}`: '';
          const answer = `**${head}**\n\n${top}${tip}`;
          return res.json({ run_id: null, query: message, intent: { action:'LIST' }, answer, latency_ms: Date.now()-startTs, graph: { tasks: [] }, structured: { result: { conclusions: [head], support: files.slice(0,15).map(f=>({ id: f.id, snippet: `${f.name} (${f.modifiedTime})`, path: f.webViewLink })) } } });
        }
      }
    } catch(_){}

    // Fast-path: apri task ClickUp da URL/ID
    try {
      const m = (message||'').trim();
      const urlMatch = m.match(/https?:\/\/app\.clickup\.com\/t\/([A-Za-z0-9-]+)/i);
      const idMatch = !urlMatch && m.match(/\btask\s+([A-Za-z0-9-]{4,})\b/i);
      const taskId = urlMatch?.[1] || idMatch?.[1] || null;
      const clickupToken = req.session.user?.clickupToken || process.env.CLICKUP_API_KEY || null;
      if (taskId && clickupToken) {
        let details = null, comments = [];
        try { const d = await axios.get(`https://api.clickup.com/api/v2/task/${taskId}`,{ headers:{ Authorization: clickupToken } }); details = d.data || null; } catch(e){ logger.warning('Fast-path ClickUp task details failed', e.response?.data?.err || e.message); }
        try { const c = await axios.get(`https://api.clickup.com/api/v2/task/${taskId}/comment`,{ headers:{ Authorization: clickupToken } }); comments = c.data?.comments || []; } catch(e){}
        if (details) {
          const title = details.name || '(senza titolo)'; const status = details.status?.status || 'unknown'; const due = details.due_date ? new Date(Number(details.due_date)).toLocaleDateString('it-IT') : '—'; const assignees = (details.assignees||[]).map(a=>a.username||a.email).filter(Boolean).join(', ') || '—'; const priority = details.priority?.priority || '—'; const url = details.url || details.short_url || `https://app.clickup.com/t/${taskId}`;
          const cmts = comments.slice(0,3).map(c=>`- ${c.user?.username||c.user?.email||'utente'}: ${(c.comment_text||'').toString().slice(0,160)}`).join('\n');
          const answer = `**Dettagli Task**\n- Titolo: ${title}\n- Stato: ${status}\n- Scadenza: ${due}\n- Assegnatari: ${assignees}\n- Priorità: ${priority}\n- Link: ${url}\n\n**Commenti recenti**\n${cmts || '—'}`;
          return res.json({ run_id: null, query: message, intent: { action:'STATUS' }, answer, latency_ms: Date.now()-startTs, graph:{tasks:[]}, structured:{ result:{ conclusions:[`Task ${title}`], support:[{ id: taskId, snippet: title, path: `clickup://task/${taskId}` }] } } });
        }
      }
    } catch(_){}

    // Fast-path: i miei task oggi/settimana
    try {
      const m = (message||'').toLowerCase();
      const isMine = /(i\s+miei\s+task|miei\s+task|my\s+tasks|assegnati\s+a\s+me|assigned\s+to\s+me)/i.test(m);
      const today = /(oggi|today)\b/i.test(m); const week = /(settimana|questa\s+settimana|week)\b/i.test(m);
      const clickupToken = req.session.user?.clickupToken || process.env.CLICKUP_API_KEY || null;
      if (isMine && clickupToken) {
        let teamId = process.env.CLICKUP_TEAM_ID || null; try { if(!teamId && req.session.user?.clickupToken){ const t=await axios.get('https://api.clickup.com/api/v2/team',{ headers:{ Authorization:req.session.user.clickupToken } }); teamId = t.data?.teams?.[0]?.id || null; } } catch{}
        let userId = null; try { const u = await axios.get('https://api.clickup.com/api/v2/user',{ headers:{ Authorization: clickupToken } }); userId = u.data?.user?.id || null; } catch{}
        const clickup = require('../connectors/clickupConnector');
        let chunks = await clickup.searchTasks({ teamId, assignee: userId? String(userId):undefined, includeClosed: false, includeSubtasks: true, limit: 200, token: clickupToken });
        const maxItems = Math.min(Array.isArray(chunks)?chunks.length:0, 12);
        const lines = (chunks||[]).slice(0, maxItems).map(c=>`- ${c.text.split('\n')[0]}  (Apri: ${c.path.replace('clickup://task/','https://app.clickup.com/t/')})`).join('\n');
        const head = `I tuoi task${today? ' di oggi': (week? ' della settimana':'')} trovati: ${chunks?.length||0}`;
        const tip = (chunks?.length||0) > maxItems ? `\n...e altri ${(chunks.length - maxItems)}` : '';
        const answer = `**${head}**\n\n${lines}${tip}`;
        return res.json({ run_id: null, query: message, intent: { action:'LIST' }, answer, latency_ms: Date.now()-startTs, graph:{tasks:[]}, structured:{ result:{ conclusions:[head], support:(chunks||[]).slice(0,15).map(c=>({ id:c.id, snippet:c.text.slice(0,200), path:c.path })) } } });
      }
    } catch(_){}

    // Parse intent
    let intent; try { intent = await parseIntent(message); } catch (e) { const detail = (e && e.cause && (e.cause.response?.data?.error?.message || e.cause.code || e.cause.message)) || ''; return res.status(503).json({ error: 'ai_unavailable', message: 'Servizio AI non raggiungibile (intent). Verifica connessione o chiave API.', detail }); }
    try { intent.entities = intent.entities || {}; if (!Array.isArray(intent.entities.projects)) intent.entities.projects = []; if (!Array.isArray(intent.entities.clients)) intent.entities.clients = []; } catch(_){}

    // Identity: "chi sono io"
    try {
      const idq = /\b(chi\s+sono(\s+io)?|who\s+am\s+i)\b/i;
      if (idq.test(message||'')) {
        const clickupConnected = !!(req.session.user?.clickupToken || process.env.CLICKUP_API_KEY);
        const driveConnected = !!(req.session.user?.googleAccessToken || (process.env.GOOGLE_CREDENTIALS_JSON && process.env.GOOGLE_IMPERSONATED_USER_EMAIL));
        const name = req.session.user?.name || 'Utente'; const email = req.session.user?.email || 'n/d';
        let cuSummary = '';
        try { if (clickupConnected) { const cuToken = req.session.user?.clickupToken || process.env.CLICKUP_API_KEY; const uResp = await axios.get('https://api.clickup.com/api/v2/user', { headers: { Authorization: cuToken } }); const me = uResp.data?.user; const userId = me?.id; let teamId = process.env.CLICKUP_TEAM_ID; if (!teamId) { try { const t = await axios.get('https://api.clickup.com/api/v2/team', { headers:{ Authorization: cuToken } }); teamId = t.data?.teams?.[0]?.id; } catch{} } let openCount=0, overdue=0; let sample=[]; if (teamId && userId) { const params = { page:0, include_closed: true, subtasks:true }; params['assignees[]'] = [userId]; const tResp = await axios.get(`https://api.clickup.com/api/v2/team/${teamId}/task`, { headers: { Authorization: cuToken }, params }); const tasks = tResp.data?.tasks || []; const now = Date.now(); const isClosed = (t)=> ((t.status?.type||'').toLowerCase()==='done') || ((t.status?.status||'').toLowerCase()==='closed'); openCount = tasks.filter(t=>!isClosed(t)).length; overdue = tasks.filter(t=>!isClosed(t) && t.due_date && Number(t.due_date) < now).length; sample = tasks.slice(0,3).map(t=>`- ${t.name}${(t.due_date && Number(t.due_date) < now)?' (in ritardo)':''}`); } cuSummary = `\n\nTask (ClickUp):\n- Assegnati (aperti): ${openCount}${overdue? `\n- In ritardo: ${overdue}`:''}${sample.length? `\nEsempi:\n${sample.join('\n')}`:''}`; } } catch(_){}
        let driveSummary = '';
        try { if (driveConnected && req.session.user?.googleAccessToken) { const dResp = await axios.get('https://www.googleapis.com/drive/v3/files', { headers: { Authorization: `Bearer ${req.session.user.googleAccessToken}` }, params: { orderBy: 'modifiedTime desc', pageSize: 5, fields: 'files(id,name,modifiedTime,webViewLink,owners)' } }); const files = dResp.data?.files || []; if (files.length) { const lines = files.map(f=>`- ${f.name} (${new Date(f.modifiedTime).toLocaleDateString('it-IT')})`); driveSummary = `\n\nDocumenti recenti (Drive):\n${lines.join('\n')}`; } } } catch(_){}
        const header = `Ciao ${name}! Sono il tuo Assistente Esecutivo AI di 56k Agency.`; const who = `\n\nChi sei – Profilo\n- Nome: ${name}\n- Email: ${email}\n- Connessioni: ClickUp=${clickupConnected? 'connesso':'non connesso'}, Drive=${driveConnected? 'connesso':'non connesso'}`; const next = `\n\nCosa posso fare per te\n- Aggiornarti sui task e priorità\n- Cercare documenti e riassumerli\n- Incrociare informazioni tra fonti per insight`;
        const answer = `${header}${who}${cuSummary}${driveSummary}${next}`;
        return res.json({ run_id: null, query: message, intent, answer, latency_ms: Date.now()-startTs, graph: { tasks: [] }, structured: { result: { conclusions: [answer], support: [] } } });
      }
    } catch(_){}

    // Plan
    let graph; try { graph = await plan(message); } catch(e){ logger.error('Planner failed', e.message||e); return res.status(500).json({ error:'planner_failed', message:'Pianificazione AI non disponibile.' }); }
    // Goal/augment/sanitize
    try { graph.intents = Array.isArray(graph.intents)? Array.from(new Set([...graph.intents, intent.action.toLowerCase()])) : [intent.action.toLowerCase()]; const reasonTask = graph.tasks.find(t=>t.type==='reason'); if(reasonTask){ if(intent.action==='STATUS') reasonTask.goal='status'; else if(intent.action==='REPORT') reasonTask.goal='report'; else if(intent.action==='COMPARE') reasonTask.goal='comparison'; else if(intent.action==='RISKS') reasonTask.goal='risks'; else if(intent.action==='LIST') reasonTask.goal='listing'; else reasonTask.goal = reasonTask.goal||'summary'; } } catch(adjErr){ logger.warning('Goal adjust failed', { error: adjErr.message }); }
    try { if(graph && Array.isArray(graph.tasks)){ const seen=[]; let fixed=0; graph.tasks.forEach((t,i)=>{ if(!t.id){ t.id='t'+(i+1); fixed++; } if(t.type!=='retrieve'){ if(!Array.isArray(t.inputs)||!t.inputs.length){ const fallback = seen.slice().reverse().find(id=>id); if(fallback){ t.inputs=[fallback]; fixed++; } } } seen.push(t.id); }); if(fixed) logger.info('Planner graph sanitized', { fixed }); } } catch(saniErr){ logger.error('Graph sanitize failed', saniErr.message); }
    // Inject tokens into tool_call
    try { if (graph && Array.isArray(graph.tasks)) { const userClickupToken = req.session.user?.clickupToken || null; let effectiveTeamId = process.env.CLICKUP_TEAM_ID || null; if (!effectiveTeamId && userClickupToken) { try { const tResp = await axios.get('https://api.clickup.com/api/v2/team', { headers: { 'Authorization': userClickupToken } }); effectiveTeamId = tResp.data?.teams?.[0]?.id || null; } catch(e){ logger.warning('Could not derive ClickUp team id for injection', e.message||e); } }
      // resolve current user id for assignee
      let cuUserId = null; async function ensureCuUserId(){ if (cuUserId || !userClickupToken) return cuUserId; try { const u = await axios.get('https://api.clickup.com/api/v2/user', { headers: { Authorization: userClickupToken } }); cuUserId = u.data?.user?.id || null; } catch(e){ logger.warning('Could not resolve ClickUp current user id', e.message||e); } return cuUserId; }
      for (const t of graph.tasks) { if (!t || t.type !== 'tool_call' || typeof t.tool !== 'string') continue; t.params = t.params || {}; if (t.tool.startsWith('clickup.')) { if (userClickupToken && !t.params.token) t.params.token = userClickupToken; const fn = t.tool.split('.')[1]; if (!t.params.teamId && effectiveTeamId && (fn === 'searchTasks' || fn === 'listSpaces')) { t.params.teamId = effectiveTeamId; } if (t.params && t.params.assignee === 'currentUser') { const id = await ensureCuUserId(); if (id) t.params.assignee = String(id); } } if (t.tool.startsWith('googleDrive.')) { if (req.session.user?.googleAccessToken && !t.params.accessToken) { t.params.accessToken = req.session.user.googleAccessToken; } } } } } catch (injectErr) { logger.warning('ClickUp param inject failed', { error: injectErr.message }); }

    // Execute
    const runId = require('crypto').randomUUID(); graph.run_id = runId; let execResult;
    try { execResult = await executeGraph(graph); } catch(execErr){ logger.error('RAG execution failed', execErr.message||execErr); return res.status(500).json({ error:'rag_failed', message:'Pipeline non riuscita.' }); }

    // Fallback se mancano evidenze ma si chiedono task in ritardo/urgenti
    try { const wantsOverdueGeneral = /(in\s+ritardo|ritardi|overdue|scadenz|scadut[oi]e?|urgenti?|priorit\u00e0\s*alta|alta\s*priorit\u00e0)/i.test(message||''); const missingEvidence = !execResult || ((!execResult.support || !execResult.support.length) && (!execResult.conclusions || !execResult.conclusions.length) && !execResult.text); if (wantsOverdueGeneral && missingEvidence) { const clickup = require('../connectors/clickupConnector'); const userClickupToken = req.session.user?.clickupToken || null; let teamId = process.env.CLICKUP_TEAM_ID || null; if(!teamId && userClickupToken){ try { const tResp = await axios.get('https://api.clickup.com/api/v2/team', { headers:{ Authorization: userClickupToken } }); teamId = tResp.data?.teams?.[0]?.id || null; } catch(_){} } if (teamId || userClickupToken || process.env.CLICKUP_API_KEY) { const chunks = await clickup.searchTasks({ teamId, overdueOnly: true, includeClosed: false, limit: 50, token: userClickupToken }); if (Array.isArray(chunks) && chunks.length) { const support = chunks.slice(0, 15).map((c)=>({ id:c.id, snippet:c.text.slice(0,200), path: c.path })); execResult = { conclusions: [`Trovati ${chunks.length} task rilevanti (in ritardo o aperti prossimi alla scadenza).`], support }; logger.info('Applied direct ClickUp fallback with support', { count: chunks.length }); } } } } catch(fbErr){ logger.warning('Direct ClickUp fallback failed', { error: fbErr.message }); }

    // Log run
    const latency = Date.now() - startTs; try { const conclusionsJson = JSON.stringify(execResult.conclusions || execResult.result?.conclusions || []); const supportCount = (execResult.support||[]).length; db.run(`INSERT INTO rag_runs (id,user_email,query,intents,graph_json,conclusions_json,support_count,valid,latency_ms) VALUES (?,?,?,?,?,?,?,?,?)`, [runId, req.session.user.email, message, (graph.intents||[]).join(','), JSON.stringify(graph), conclusionsJson, supportCount, execResult.validator?.valid?1:(execResult.valid?1:0), latency], ()=>{}); try { db.run('INSERT INTO rag_artifacts (run_id, stage, payload) VALUES (?,?,?)', [runId,'planner',JSON.stringify(graph)]); db.run('INSERT INTO rag_artifacts (run_id, stage, payload) VALUES (?,?,?)', [runId,'compose',JSON.stringify(execResult)]); } catch(e){} } catch(_){}

    // Enrich chunk texts for UI
    if(include_chunk_texts){ try { const chunkIds = new Set(); (execResult.support||[]).forEach(s=> s.id && chunkIds.add(s.id)); (execResult.conclusion_grounding||[]).forEach(cg=> (cg.spans||[]).forEach(sp=> sp.chunk_id && chunkIds.add(sp.chunk_id))); const ids = Array.from(chunkIds).slice(0,300); if(ids.length){ const placeholders = ids.map(()=>'?').join(','); await new Promise(resolve=>{ db.all(`SELECT id,text,path,loc,src_start,src_end,source,type FROM rag_chunks WHERE id IN (${placeholders})`, ids, (e,rows)=>{ if(!e&&rows) execResult.chunk_texts=rows; resolve(); }); }); } else execResult.chunk_texts=[]; } catch(enrichErr){ logger.error('chunk_text enrichment failed', enrichErr.message); } }

    // Synthesize
    let answer = await synthesizeConversationalAnswer(message, intent, execResult, sanitizeModelId(req.session.user.selectedModel), process.env.CLAUDE_API_KEY);
    return res.json({ run_id: runId, query: message, intent, answer, latency_ms: latency, graph, structured: execResult });
  });

  // Ingest Drive file (to rag_chunks)
  router.post('/api/rag/ingest/drive/:fileId', async (req,res)=>{
    if(!req.session.user) return res.status(401).json({ error:'Not authenticated' });
    try {
      const token = await getUserGoogleToken(req);
      if(!token) return res.status(400).json({ error:'Google not connected' });
      const { fileId } = req.params;
      const { keep_old=false, include_preview=true } = req.body || {};
      let fileName = fileId;
      try {
        const metaResp = await axios.get(`https://www.googleapis.com/drive/v3/files/${fileId}`, { headers: { Authorization: `Bearer ${token}` }, params: { fields: 'name,size,mimeType' } });
        fileName = metaResp.data?.name || fileName;
      } catch(e){ logger.warning('Drive meta fetch failed', { fileId, error: e.message }); }
      // Export raw content via Drive API
      let contentText = null;
      try {
        const expResp = await axios.get(`https://www.googleapis.com/drive/v3/files/${fileId}/export`, { headers: { Authorization: `Bearer ${token}` }, params: { mimeType: 'text/plain' }, responseType: 'text' });
        contentText = expResp.data || null;
      } catch(_){}
      if(!contentText) return res.status(400).json({ error:'empty_or_unparsed' });
      if(!keep_old){ db.run(`DELETE FROM rag_chunks WHERE source='drive' AND path=?`, [fileName], ()=>{}); }
      const { inserted, chunks } = await ingestDriveContent(db, fileId, fileName, contentText);
      res.json({ file_id: fileId, file_name: fileName, inserted, total_chars: contentText.length, preview: include_preview? chunks.slice(0,5): undefined });
    } catch (e){ logger.error('Drive ingestion failed', e.message||e); res.status(500).json({ error:'ingest_failed' }); }
  });

  // RAG utility endpoints (chunks, feedback, lexicon, metrics, groundtruth, audit, retrieval weights, labels, active learning)
  router.get('/api/rag/chunks', (req,res)=>{
    if(!req.session.user) return res.status(401).json({ error:'Not authenticated' });
    const idsParam = req.query.ids||'';
    if(!idsParam) return res.status(400).json({ error:'ids required' });
    const ids = idsParam.split(',').map(s=>s.trim()).filter(Boolean).slice(0,500);
    if(!ids.length) return res.status(400).json({ error:'no_valid_ids' });
    const placeholders = ids.map(()=>'?').join(',');
    db.all(`SELECT id,text,path,loc,src_start,src_end,source,type FROM rag_chunks WHERE id IN (${placeholders})`, ids, (err, rows)=>{
      if(err) return res.status(500).json({ error:'db_error' });
      res.json(rows||[]);
    });
  });

  router.post('/api/rag/feedback', (req, res) => {
    if(!req.session.user) return res.status(401).json({ error:'Not authenticated' });
    const { run_id, rating, comment } = req.body||{};
    if(!run_id || typeof rating !== 'number') return res.status(400).json({ error:'run_id and numeric rating required' });
    db.run(`INSERT INTO rag_feedback (run_id, user_email, rating, comment) VALUES (?,?,?,?)`, [run_id, req.session.user.email, rating, comment||null], (err)=>{
      if(err) return res.status(500).json({ error:'db_error' });
      res.json({ success:true });
    });
  });

  router.get('/api/rag/feedback/:runId', (req, res) => {
    if(!req.session.user) return res.status(401).json({ error:'Not authenticated' });
    const runId = req.params.runId;
    db.all(`SELECT rating, comment, created_at FROM rag_feedback WHERE run_id = ? ORDER BY created_at DESC LIMIT 50`, [runId], (err, rows)=>{
      if(err) return res.status(500).json({ error:'db_error' });
      if(!rows || !rows.length) return res.json({ run_id: runId, avg_rating: null, count:0, feedback: [] });
      const sum = rows.reduce((a,r)=>a + (r.rating||0),0);
      res.json({ run_id: runId, avg_rating: sum/rows.length, count: rows.length, feedback: rows });
    });
  });

  router.post('/api/rag/lexicon/embed', async (req,res)=>{
    if(!isAdminRequest(req)) return res.status(403).json({ error:'Admin required' });
    try { const count = await embedAndStoreLexiconTerms(db); res.json({ success:true, embedded: count }); }
    catch(e){ res.status(500).json({ error:'embed_failed', message: e.message }); }
  });

  router.get('/api/rag/lexicon', (req,res)=>{
    if(!req.session.user) return res.status(401).json({ error:'Not authenticated' });
    const limit = Math.min(parseInt(req.query.limit||'100',10), 500);
    db.all('SELECT term,type,freq,sources,last_seen, (embedding IS NOT NULL) as embedded FROM rag_lexicon ORDER BY freq DESC LIMIT ?', [limit], (err, rows)=>{
      if(err) return res.status(500).json({ error:'db_error' });
      res.json(rows);
    });
  });

  router.get('/api/rag/metrics/overview', (req,res)=>{
    if(!isAdminRequest(req)) return res.status(403).json({ error:'Admin required' });
    const out = {};
    db.get('SELECT COUNT(*) c FROM rag_runs', (e1,r1)=>{
      out.total_runs = r1?.c||0;
      db.get('SELECT COUNT(*) c FROM rag_feedback', (e2,r2)=>{
        out.total_feedback = r2?.c||0;
        db.get('SELECT AVG(rating) avg_rating FROM rag_feedback', (e3,r3)=>{
          out.avg_rating = Number(r3?.avg_rating||0).toFixed(2);
          db.get("SELECT AVG(latency_ms) avg_latency FROM rag_runs WHERE latency_ms>0", (e4,r4)=>{
            out.avg_latency_ms = Math.round(r4?.avg_latency||0);
            db.get("SELECT COUNT(*) c FROM rag_runs WHERE valid=0", (e5,r5)=>{
              out.invalid_runs = r5?.c||0;
              db.get("SELECT COUNT(*) c FROM rag_runs WHERE created_at >= datetime('now','-1 day')", (e6,r6)=>{
                out.runs_last_24h = r6?.c||0;
                res.json(out);
              });
            });
          });
        });
      });
    });
  });

  router.post('/api/rag/lexicon/promote', async (req,res)=>{
    if(!isAdminRequest(req)) return res.status(403).json({ error:'Admin required' });
    const { min_freq = 1 } = req.body||{};
    const sql = `SELECT l.label_value term, COUNT(*) freq FROM rag_labels l WHERE l.label_type='entity' AND l.label_value NOT IN (SELECT term FROM rag_lexicon) GROUP BY l.label_value HAVING freq >= ? LIMIT 200`;
    db.all(sql, [min_freq], (err, rows)=>{
      if(err) return res.status(500).json({ error:'db_error' });
      res.json({ candidates: rows||[] });
    });
  });

  router.get('/api/rag/metrics/precision', (req,res)=>{
    if(!isAdminRequest(req)) return res.status(403).json({ error:'Admin required' });
    const kVals = [5,10,20];
    const precision = Object.fromEntries(kVals.map(k=>[k,0]));
    const counts = Object.fromEntries(kVals.map(k=>[k,0]));
    db.all(`SELECT f.rating, a.payload retrieve_payload FROM rag_feedback f JOIN rag_artifacts a ON a.run_id=f.run_id AND a.stage LIKE 'retrieve:%' ORDER BY f.created_at DESC LIMIT 200`, [], (err, rows)=>{
      if(err) return res.status(500).json({ error:'db_error' });
      rows.forEach(r=>{
        try {
          const arr = JSON.parse(r.retrieve_payload)||[];
          kVals.forEach(k=>{
            const slice = arr.slice(0,k);
            if(!slice.length) return;
            const rel = (r.rating>=4)? 1:0;
            precision[k] += rel * (slice.filter(s=> s.base_sim>0.2 || s.llm_rel>=3).length / k);
            counts[k] += 1;
          });
        } catch(e){}
      });
      const out = {}; kVals.forEach(k=>{ out['p@'+k] = counts[k]? +(precision[k]/counts[k]).toFixed(3): null; });
      res.json({ precision: out, samples: rows.length });
    });
  });

  router.post('/api/rag/groundtruth', (req,res)=>{
    if(!isAdminRequest(req)) return res.status(403).json({ error:'Admin required' });
    const { query, chunk_id, relevant } = req.body||{};
    if(!query || !chunk_id || typeof relevant !== 'boolean') return res.status(400).json({ error:'missing_fields' });
    db.run('INSERT INTO rag_ground_truth (query,chunk_id,relevant) VALUES (?,?,?)', [query.trim(), chunk_id, relevant?1:0], function(err){
      if(err) return res.status(500).json({ error:'db_error' });
      res.json({ id:this.lastID, query, chunk_id, relevant });
    });
  });

  router.get('/api/rag/groundtruth', (req,res)=>{
    if(!isAdminRequest(req)) return res.status(403).json({ error:'Admin required' });
    const { query: q, limit } = req.query||{};
    const lim = Math.min(parseInt(limit||'200',10), 1000);
    if(q){ db.all('SELECT * FROM rag_ground_truth WHERE query = ? ORDER BY created_at DESC LIMIT ?', [q, lim], (e, rows)=> res.json(rows||[])); }
    else { db.all('SELECT * FROM rag_ground_truth ORDER BY created_at DESC LIMIT ?', [lim], (e, rows)=> res.json(rows||[])); }
  });

  router.delete('/api/rag/groundtruth/:id', (req,res)=>{
    if(!isAdminRequest(req)) return res.status(403).json({ error:'Admin required' });
    db.run('DELETE FROM rag_ground_truth WHERE id=?', [req.params.id], function(err){ if(err) return res.status(500).json({ error:'db_error' }); res.json({ deleted: this.changes }); });
  });

  router.get('/api/rag/metrics/groundtruth', (req,res)=>{
    if(!isAdminRequest(req)) return res.status(403).json({ error:'Admin required' });
    const kParams = (req.query.k || '5,10').split(',').map(x=>parseInt(x.trim(),10)).filter(x=>x>0 && x<=100);
    const wantDetails = req.query.details==='1';
    db.all('SELECT query, chunk_id, relevant FROM rag_ground_truth', [], (e, rows)=>{
      if(e) return res.status(500).json({ error:'db_error' });
      if(!rows.length) return res.json({ queries:0, metrics:{} });
      const byQuery = new Map(); rows.forEach(r=>{ if(!byQuery.has(r.query)) byQuery.set(r.query, []); byQuery.get(r.query).push(r); });
      const queries = Array.from(byQuery.keys());
      const metricsAgg = {}; kParams.forEach(k=> metricsAgg[k] = { sumP:0, sumR:0, count:0 }); const details = [];
      const processNext = (idx)=>{
        if(idx>=queries.length){
          const out = {}; kParams.forEach(k=>{ out['p@'+k] = metricsAgg[k].count? +(metricsAgg[k].sumP/metricsAgg[k].count).toFixed(3): null; out['r@'+k] = metricsAgg[k].count? +(metricsAgg[k].sumR/metricsAgg[k].count).toFixed(3): null; });
          return res.json({ queries: queries.length, metrics: out, details: wantDetails? details: undefined });
        }
        const q = queries[idx];
        db.get('SELECT id FROM rag_runs WHERE query = ? ORDER BY created_at DESC LIMIT 1', [q], (er, runRow)=>{
          if(er || !runRow){ processNext(idx+1); return; }
          db.get("SELECT payload FROM rag_artifacts WHERE run_id = ? AND stage LIKE 'retrieve:%' ORDER BY id ASC LIMIT 1", [runRow.id], (ea, artRow)=>{
            if(ea || !artRow){ processNext(idx+1); return; }
            let retrieved = []; try { retrieved = JSON.parse(artRow.payload)||[]; } catch(_){}
            const gt = byQuery.get(q); const relevantSet = new Set(gt.filter(g=>g.relevant).map(g=>g.chunk_id)); const totalRelevant = relevantSet.size || 1;
            kParams.forEach(k=>{ const topK = retrieved.slice(0,k).map(r=>r.id); const relRetrieved = topK.filter(id=>relevantSet.has(id)).length; const precision = relRetrieved / k; const recall = relRetrieved / totalRelevant; metricsAgg[k].sumP += precision; metricsAgg[k].sumR += recall; metricsAgg[k].count += 1; if(wantDetails){ details.push({ query:q, k, precision:+precision.toFixed(3), recall:+recall.toFixed(3), relRetrieved, kSize:k, totalRelevant }); } });
            processNext(idx+1);
          });
        });
      };
      processNext(0);
    });
  });

  router.get('/api/rag/audit/:runId', (req,res)=>{
    if(!isAdminRequest(req)) return res.status(403).json({ error:'Admin required' });
    const runId = req.params.runId; const bundle = {};
    db.get('SELECT * FROM rag_runs WHERE id=?', [runId], (e1, runRow)=>{
      if(e1||!runRow) return res.status(404).json({ error:'run_not_found' });
      bundle.run = runRow;
      db.all('SELECT stage,payload,created_at FROM rag_artifacts WHERE run_id=? ORDER BY id', [runId], (e2, artRows)=>{
        bundle.artifacts = artRows||[];
        db.all('SELECT rating,comment,created_at FROM rag_feedback WHERE run_id=?', [runId], (e3, fbRows)=>{
          bundle.feedback = fbRows||[];
          const chunkIds = new Set();
          (bundle.artifacts||[]).forEach(a=>{
            if(a.stage.startsWith('retrieve:')){ try { JSON.parse(a.payload).forEach(c=> c.id && chunkIds.add(c.id)); } catch(e){} }
            if(a.stage.startsWith('reason:')){ try { const jr = JSON.parse(a.payload); (jr.support||[]).forEach(s=> s.id && chunkIds.add(s.id)); } catch(e){} }
          });
          const idArr = Array.from(chunkIds); if(!idArr.length) return res.json(bundle);
          const placeholders = idArr.map(()=>'?').join(',');
          db.all(`SELECT id,source,type,path,loc,src_start,src_end,text FROM rag_chunks WHERE id IN (${placeholders})`, idArr, (e4, rows)=>{
            bundle.evidence_chunks = rows||[]; res.json(bundle);
          });
        });
      });
    });
  });

  const archiver = require('archiver');
  router.get('/api/rag/audit/:runId/zip', (req,res)=>{
    if(!isAdminRequest(req)) return res.status(403).json({ error:'Admin required' });
    const runId = req.params.runId; res.setHeader('Content-Type', 'application/zip'); res.setHeader('Content-Disposition', `attachment; filename="audit_${runId}.zip"`);
    const archive = archiver('zip', { zlib: { level: 9 } }); archive.on('error', err=>{ logger.error('Audit zip error', err.message); try { res.status(500).end(); } catch(_){} }); archive.pipe(res);
    db.get('SELECT * FROM rag_runs WHERE id=?', [runId], (e1, runRow)=>{
      if(e1 || !runRow){ archive.append(JSON.stringify({ error:'run_not_found' }), { name: 'error.json' }); return archive.finalize(); }
      archive.append(JSON.stringify(runRow,null,2), { name: 'run.json' });
      db.all('SELECT stage,payload,created_at FROM rag_artifacts WHERE run_id=? ORDER BY id', [runId], (e2, artRows)=>{
        archive.append(JSON.stringify(artRows||[],null,2), { name: 'artifacts.json' });
        db.all('SELECT rating,comment,created_at FROM rag_feedback WHERE run_id=?', [runId], (e3, fbRows)=>{
          archive.append(JSON.stringify(fbRows||[],null,2), { name:'feedback.json' });
          const chunkIds = new Set(); (artRows||[]).forEach(a=>{
            if(a.stage.startsWith('retrieve:')){ try { JSON.parse(a.payload).forEach(c=> c.id && chunkIds.add(c.id)); } catch(_){} }
            if(a.stage.startsWith('reason:')){ try { const jr = JSON.parse(a.payload); (jr.support||[]).forEach(s=> s.id && chunkIds.add(s.id)); } catch(_){} }
          });
          const idArr = Array.from(chunkIds); if(!idArr.length){ archive.finalize(); return; }
          const placeholders = idArr.map(()=>'?').join(',');
          db.all(`SELECT id,source,type,path,loc,src_start,src_end,text FROM rag_chunks WHERE id IN (${placeholders})`, idArr, (e4, rows)=>{
            archive.append(JSON.stringify(rows||[],null,2), { name:'evidence_chunks.json' });
            const summaryHtml = `<!DOCTYPE html><html><body><h1>Audit ${runId}</h1><pre>${JSON.stringify({ run: runRow, counts:{ artifacts: (artRows||[]).length, feedback:(fbRows||[]).length, evidence:(rows||[]).length } }, null,2)}</pre></body></html>`;
            archive.append(summaryHtml, { name:'index.html' });
            archive.finalize();
          });
        });
      });
    });
  });

  router.get('/api/rag/retrieval/weights', (req,res)=>{
    db.get('SELECT w_sim,w_bm25,w_llm,updated_at FROM rag_retrieval_weights WHERE id=1', (err,row)=>{ if(err) return res.status(500).json({ error:'db_error' }); res.json(row||{}); });
  });

  router.post('/api/rag/retrieval/weights/recompute', (req,res)=>{
    if(!isAdminRequest(req)) return res.status(403).json({ error:'Admin required' });
    const limit = 30;
    db.all(`SELECT r.id run_id, f.rating, a.payload retrieve_payload FROM rag_runs r JOIN rag_feedback f ON f.run_id = r.id JOIN rag_artifacts a ON a.run_id = r.id AND a.stage LIKE 'retrieve:%' ORDER BY f.created_at DESC LIMIT ?`, [limit], (err, rows)=>{
      if(err) return res.status(500).json({ error:'db_error' });
      if(!rows.length) return res.json({ updated:false, reason:'no_feedback' });
      let sumSim=0, sumBm=0, sumLlm=0, weightTotal=0;
      rows.forEach(r=>{ try { const arr = JSON.parse(r.retrieve_payload)||[]; if(!arr.length) return; const top = arr[0]; const rating = r.rating||1; sumSim += (top.base_sim||0)*rating; sumBm  += (top.base_bm25||0)*rating; sumLlm += (top.llm_rel!=null? (top.llm_rel/5): 0)*rating; weightTotal += rating; } catch(e){} });
      if(weightTotal===0) return res.json({ updated:false, reason:'no_valid_data' });
      let wSim = sumSim/weightTotal; let wBm = sumBm/weightTotal; let wLlm = sumLlm/weightTotal; const norm = wSim + wBm + wLlm || 1; wSim/=norm; wBm/=norm; wLlm/=norm;
      db.run('UPDATE rag_retrieval_weights SET w_sim=?, w_bm25=?, w_llm=?, updated_at=CURRENT_TIMESTAMP WHERE id=1', [wSim, wBm, wLlm], (uErr)=>{ if(uErr) return res.status(500).json({ error:'update_failed' }); res.json({ updated:true, weights:{ w_sim:wSim, w_bm25:wBm, w_llm:wLlm } }); });
    });
  });

  router.post('/api/rag/labels', (req,res)=>{
    if(!req.session.user) return res.status(401).json({ error:'Not authenticated' });
    const { chunk_id, label_type, label_value } = req.body||{};
    if(!chunk_id || !label_type || !label_value) return res.status(400).json({ error:'missing_fields' });
    db.run('INSERT INTO rag_labels (chunk_id,label_type,label_value,source) VALUES (?,?,?,?)', [chunk_id, label_type, label_value, 'human'], (err)=>{ if(err) return res.status(500).json({ error:'db_error' }); res.json({ success:true }); });
  });

  router.get('/api/rag/labels', (req,res)=>{
    if(!req.session.user) return res.status(401).json({ error:'Not authenticated' });
    const { chunk_id } = req.query; if(!chunk_id) return res.status(400).json({ error:'chunk_id required' });
    db.all('SELECT label_type,label_value,source,created_at FROM rag_labels WHERE chunk_id = ? ORDER BY created_at DESC', [chunk_id], (err, rows)=>{ if(err) return res.status(500).json({ error:'db_error' }); res.json(rows); });
  });

  router.get('/api/rag/active/uncertain', (req,res)=>{
    if(!req.session.user) return res.status(401).json({ error:'Not authenticated' });
    const limit = Math.min(parseInt(req.query.limit||'20',10), 100);
    db.all(`SELECT c.id,c.text FROM rag_chunks c LEFT JOIN rag_chunk_annotations a ON a.chunk_id=c.id AND a.annotator='claims_v1' LEFT JOIN rag_labels l ON l.chunk_id=c.id WHERE (a.data LIKE '%claim_statement%' AND (a.data NOT LIKE '%prohibition%' AND a.data NOT LIKE '%permission%')) AND l.id IS NULL LIMIT ?`, [limit], (err, rows)=>{ if(err) return res.status(500).json({ error:'db_error' }); res.json(rows); });
  });

  // Simple classifier (mode)
  router.post('/api/mode/classify', async (req,res)=>{
    if(!req.session.user) return res.status(401).json({ error:'Not authenticated' });
    const { query } = req.body||{}; if(!query || typeof query!=='string') return res.status(400).json({ error:'query required' });
    try { const intent = await parseIntent(query); db.run(`INSERT INTO rag_mode_decisions (query,decided_mode,heuristic_score,used_llm,llm_reason) VALUES (?,?,?,?,?)`, [query, 'rag', 1.0, 1, intent.action], ()=>{}); return res.json({ mode:'rag', action:intent.action, time_range:intent.time_range, entities:intent.entities }); }
    catch(e){ const detail = (e && e.cause && (e.cause.response?.data?.error?.message || e.cause.code || e.cause.message)) || ''; return res.status(503).json({ error:'ai_unavailable', message:'Servizio AI non raggiungibile (classify).', detail }); }
  });

  return router;
}
