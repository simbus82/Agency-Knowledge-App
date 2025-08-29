// ClickUp Connector - implementazione reale (read-only tools)
const axios = require('axios');
const crypto = require('crypto');

const API_BASE_URL = 'https://api.clickup.com/api/v2';
const DEFAULT_TOKEN = process.env.CLICKUP_API_KEY;
const DEFAULT_CACHE_TTL = Number(process.env.CLICKUP_CONNECTOR_CACHE_TTL_MS || 300000); // 5 minuti

// Small sleep util
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Lightweight in-memory cache for low-churn listing endpoints
const _cache = new Map();
function cacheGet(key){
  const entry = _cache.get(key);
  if(!entry) return null;
  if(entry.exp <= Date.now()){ _cache.delete(key); return null; }
  return entry.value;
}
function cacheSet(key, value, ttl=DEFAULT_CACHE_TTL){
  _cache.set(key, { exp: Date.now()+ttl, value });
}

// Create an axios client with retry for rate limits and transient errors
function createClient(token) {
  const client = axios.create({
    baseURL: API_BASE_URL,
    headers: {
      Authorization: token || DEFAULT_TOKEN,
      'Content-Type': 'application/json',
    },
    timeout: 15000,
  });

  client.interceptors.response.use(
    (res) => res,
    async (error) => {
      const cfg = error.config || {};
      const status = error.response?.status;
      cfg.__retryCount = cfg.__retryCount || 0;
      const maxRetries = 3;
      const isRetryable =
        status === 429 ||
        (status >= 500 && status < 600) ||
        error.code === 'ETIMEDOUT' ||
        error.code === 'ECONNRESET' ||
        error.code === 'ENOTFOUND';
      if (isRetryable && cfg.__retryCount < maxRetries) {
        cfg.__retryCount++;
        let delay = 500 * cfg.__retryCount;
        if (status === 429) {
          const retryAfter = Number(error.response?.headers?.['retry-after']);
          const reset = Number(error.response?.headers?.['x-ratelimit-reset']);
          if (!Number.isNaN(retryAfter)) delay = Math.max(delay, retryAfter * 1000);
          if (!Number.isNaN(reset)) {
            const until = Math.max(0, reset * 1000 - Date.now());
            delay = Math.max(delay, until);
          }
        }
        await sleep(Math.min(delay, 5000));
        return client(cfg);
      }
      throw error;
    }
  );

  return client;
}

/**
 * Ottiene i task da una specifica lista di ClickUp.
 * @param {{listId:string, includeClosed?:boolean, pageSize?:number, limit?:number, token?:string}} params
 * @returns {Promise<Array>} Array di task grezzi come da API ClickUp
 */
async function getTasks({ listId, includeClosed = true, pageSize = 100, limit = 200, token } = {}) {
  if (!DEFAULT_TOKEN && !token) {
    console.error("Variabile d'ambiente CLICKUP_API_KEY non impostata e nessun token fornito.");
    return [];
  }
  if (!listId) {
    console.error("listId è richiesto per getTasks in ClickUp.");
    return [];
  }
  try {
    const client = createClient(token);
    const tasks = [];
    let page = 0;
    while (tasks.length < limit) {
      const params = { page, include_closed: !!includeClosed, subtasks: true };
      const resp = await client.get(`/list/${listId}/task`, { params });
      const batch = resp.data?.tasks || [];
      tasks.push(...batch);
      if (!batch.length || (pageSize && batch.length < pageSize)) break;
      page += 1;
    }
    return tasks.slice(0, limit);
  } catch (error) {
    console.error(`Errore durante il recupero dei task dalla lista ${listId}:`, error.response ? error.response.data : error.message);
    return [];
  }
}

/**
 * Ottiene i dettagli di un singolo task da ClickUp.
 * @param {{taskId:string, token?:string}} params
 * @returns {Promise<object|null>} L'oggetto task completo
 */
async function getTask({ taskId, token } = {}) {
  if (!DEFAULT_TOKEN && !token) {
    console.error("Variabile d'ambiente CLICKUP_API_KEY non impostata e nessun token fornito.");
    return null;
  }
  if (!taskId) {
    console.error("taskId è richiesto per getTask in ClickUp.");
    return null;
  }
  try {
    const client = createClient(token);
    const response = await client.get(`/task/${taskId}`);
    return response.data;
  } catch (error) {
    console.error(`Errore durante il recupero del task ${taskId}:`, error.response ? error.response.data : error.message);
    return null;
  }
}

/**
 * Ricerca task a livello di team con paginazione e piccoli filtri.
 * Ritorna direttamente chunks annotabili per il motore RAG.
 * @param {{teamId?:string, query?:string, assignee?:string, statuses?:string[], overdueOnly?:boolean, includeClosed?:boolean, includeSubtasks?:boolean, limit?:number, token?:string}} params
 */
async function searchTasks({ teamId, query = '', assignee, statuses = [], overdueOnly = false, includeClosed = true, includeSubtasks = true, limit = 200, token } = {}) {
  if (!DEFAULT_TOKEN && !token) {
    console.error("Variabile d'ambiente CLICKUP_API_KEY non impostata e nessun token fornito.");
    return [];
  }
  try {
    const client = createClient(token);
    let tasks = [];
    let effTeamId = teamId || process.env.CLICKUP_TEAM_ID;
    if (!effTeamId) {
      try {
        const teamsResp = await client.get(`/team`);
        effTeamId = teamsResp.data?.teams?.[0]?.id;
      } catch (_) { /* ignore */ }
    }
    if (effTeamId) {
      let page = 0;
      while (tasks.length < limit) {
        const params = { page, include_closed: !!includeClosed };
        if (assignee) params['assignees[]'] = [assignee];
        if (Array.isArray(statuses) && statuses.length) params['statuses[]'] = statuses;
        if (includeSubtasks) params.include_subtasks = true;
        const resp = await client.get(`/team/${effTeamId}/task`, { params });
        const batch = (resp.data && resp.data.tasks) ? resp.data.tasks : [];
        tasks.push(...batch);
        if (!batch.length) break;
        page += 1;
      }
    }
    // Filtro testuale lato client (manca un endpoint query full-text universale)
    const q = (query || '').toLowerCase();
    if (q) {
      tasks = tasks.filter(t => {
        const name = (t.name || '').toLowerCase();
        const desc = (t.description || '').toLowerCase();
        return name.includes(q) || desc.includes(q);
      });
    }
    // Filtro scadenze
    if (overdueOnly) {
      const now = Date.now();
      tasks = tasks.filter(t => {
        const due = t.due_date ? Number(t.due_date) : null;
        const closed = (t.status?.type || '').toLowerCase() === 'done' || (t.status?.status || '').toLowerCase() === 'closed';
        return due != null && due < now && !closed;
      });
    }
    // Mappa in chunks annotabili
    return tasks.slice(0, limit).map((t, i) => ({
      id: crypto.createHash('sha1').update(`clickup:${t.id}:${i}`).digest('hex'),
      text: `${t.name || ''}\n${(t.description || '').slice(0, 1800)}`.trim(),
      source: 'clickup',
      type: 'task',
      path: `clickup://task/${t.id}`,
      loc: t.status?.status || 'unknown'
    }));
  } catch (error) {
    console.error('Errore durante la ricerca task ClickUp:', error.response ? error.response.data : error.message);
    return [];
  }
}

// Helpers di navigazione (team/spazi/folder/liste) utili al planner
async function listTeams({ token } = {}) {
  if (!DEFAULT_TOKEN && !token) {
    console.error("CLICKUP_API_KEY mancante e nessun token fornito.");
    return [];
  }
  try {
    const cacheKey = `teams:${!!token}`; // token-bound cache scope
    const cached = cacheGet(cacheKey);
    if (cached) return cached;
    const client = createClient(token);
    const resp = await client.get('/team');
    const out = resp.data?.teams || [];
    cacheSet(cacheKey, out);
    return out;
  } catch (e) {
    console.error('Errore listTeams ClickUp:', e.response ? e.response.data : e.message);
    return [];
  }
}

async function listSpaces({ teamId, token, noCache=false } = {}) {
  const client = createClient(token);
  const effTeamId = teamId || process.env.CLICKUP_TEAM_ID;
  if (!effTeamId) return [];
  try {
    const cacheKey = `spaces:${effTeamId}:${!!token}`;
    if(!noCache){ const cached = cacheGet(cacheKey); if(cached) return cached; }
    const resp = await client.get(`/team/${effTeamId}/space`);
    const out = resp.data?.spaces || resp.data || [];
    if(!noCache) cacheSet(cacheKey, out);
    return out;
  } catch (e) {
    console.error('Errore listSpaces ClickUp:', e.response ? e.response.data : e.message);
    return [];
  }
}

async function listFolders({ spaceId, token, noCache=false } = {}) {
  if (!spaceId) return [];
  try {
    const cacheKey = `folders:${spaceId}:${!!token}`;
    if(!noCache){ const cached = cacheGet(cacheKey); if(cached) return cached; }
    const client = createClient(token);
    const resp = await client.get(`/space/${spaceId}/folder`);
    const out = resp.data?.folders || resp.data || [];
    if(!noCache) cacheSet(cacheKey, out);
    return out;
  } catch (e) {
    console.error('Errore listFolders ClickUp:', e.response ? e.response.data : e.message);
    return [];
  }
}

async function listLists({ folderId, token, noCache=false } = {}) {
  if (!folderId) return [];
  try {
    const cacheKey = `lists:${folderId}:${!!token}`;
    if(!noCache){ const cached = cacheGet(cacheKey); if(cached) return cached; }
    const client = createClient(token);
    const resp = await client.get(`/folder/${folderId}/list`);
    const out = resp.data?.lists || resp.data || [];
    if(!noCache) cacheSet(cacheKey, out);
    return out;
  } catch (e) {
    console.error('Errore listLists ClickUp:', e.response ? e.response.data : e.message);
    return [];
  }
}

/**
 * Recupera i commenti di un task e li restituisce come chunks annotabili (read-only)
 * @param {{taskId:string, limit?:number, token?:string}} params
 */
async function getTaskComments({ taskId, limit = 50, token } = {}){
  if (!DEFAULT_TOKEN && !token) {
    console.error("Variabile d'ambiente CLICKUP_API_KEY non impostata e nessun token fornito.");
    return [];
  }
  if(!taskId){ console.error('taskId è richiesto per getTaskComments'); return [];} 
  try {
    const client = createClient(token);
    const resp = await client.get(`/task/${taskId}/comment`);
    const comments = resp.data?.comments || resp.data || [];
    const out = comments.slice(0, limit).map((c,i)=>({
      id: crypto.createHash('sha1').update(`clickup:${taskId}:comment:${c.id||i}`).digest('hex'),
      text: (c.comment_text || c.comment || c.text || '').toString().slice(0,1800),
      source: 'clickup',
      type: 'comment',
      path: `clickup://task/${taskId}#comment/${c.id||i}`,
      loc: c.user?.username || c.user?.email || 'unknown'
    }));
    return out;
  } catch(e){
    console.error('Errore getTaskComments ClickUp:', e.response ? e.response.data : e.message);
    return [];
  }
}

module.exports = {
  getTasks,
  getTask,
  searchTasks,
  listTeams,
  listSpaces,
  listFolders,
  listLists,
  getTaskComments,
};
