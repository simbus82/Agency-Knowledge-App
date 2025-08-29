// ClickUp Connector - implementazione reale
const axios = require('axios');
const crypto = require('crypto');

const CLICKUP_API_TOKEN = process.env.CLICKUP_API_KEY;
const API_BASE_URL = 'https://api.clickup.com/api/v2';

const clickupClient = axios.create({
    baseURL: API_BASE_URL,
    headers: {
        'Authorization': CLICKUP_API_TOKEN,
        'Content-Type': 'application/json',
    }
});

/**
 * Ottiene i task da una specifica lista di ClickUp.
 * @param {object} criteria - Criteri, es. { listId: '12345' }.
 * @returns {Promise<Array>} - Un array di task.
 */
async function getTasks({ listId }) {
    if (!CLICKUP_API_TOKEN) {
        console.error("Variabile d'ambiente CLICKUP_API_KEY non impostata.");
        return [];
    }
    if (!listId) {
        console.error("listId è richiesto per getTasks in ClickUp.");
        return [];
    }
    try {
        const response = await clickupClient.get(`/list/${listId}/task`);
        return response.data.tasks || [];
    } catch (error) {
        console.error(`Errore durante il recupero dei task dalla lista ${listId}:`, error.response ? error.response.data : error.message);
        return [];
    }
}

/**
 * Ottiene i dettagli di un singolo task da ClickUp.
 * @param {object} params - { taskId: string }
 * @returns {Promise<object|null>} - L'oggetto task.
 */
async function getTask({ taskId }) {
    if (!CLICKUP_API_TOKEN) {
        console.error("Variabile d'ambiente CLICKUP_API_KEY non impostata.");
        return null;
    }
    if (!taskId) {
        console.error("taskId è richiesto per getTask in ClickUp.");
        return null;
    }
    try {
        const response = await clickupClient.get(`/task/${taskId}`);
        return response.data;
    } catch (error) {
        console.error(`Errore durante il recupero del task ${taskId}:`, error.response ? error.response.data : error.message);
        return null;
    }
}

/**
 * Ricerca task a livello di team (fallback: filtra client-side per query semplice)
 * @param {{ teamId?: string, query?: string, assignee?: string, statuses?: string[] }} params
 * @returns {Promise<Array>} - Array di chunks annotabili
 */
async function searchTasks({ teamId, query = '', assignee, statuses = [], overdueOnly = false } = {}){
    if (!CLICKUP_API_TOKEN) {
        console.error("Variabile d'ambiente CLICKUP_API_KEY non impostata.");
        return [];
    }
    try {
        let tasks = [];
        let effTeamId = teamId || process.env.CLICKUP_TEAM_ID;
        if (!effTeamId) {
            try {
                const teamsResp = await clickupClient.get(`/team`);
                effTeamId = teamsResp.data?.teams?.[0]?.id;
            } catch(e){ /* ignore, will remain undefined */ }
        }
        if (effTeamId) {
            const params = { page: 0, include_closed: true };
            if (assignee) params['assignees[]'] = [assignee];
            if (Array.isArray(statuses) && statuses.length) params['statuses[]'] = statuses;
            const resp = await clickupClient.get(`/team/${effTeamId}/task`, { params });
            tasks = (resp.data && resp.data.tasks) ? resp.data.tasks : [];
        } // else: cannot list without team; will rely on text-only fallback -> empty list
        // Filtro testuale lato client se query presente
        const q = (query || '').toLowerCase();
        if (q) {
            tasks = tasks.filter(t => {
                const name = (t.name||'').toLowerCase();
                const desc = (t.description||'').toLowerCase();
                return name.includes(q) || desc.includes(q);
            });
        }
        // Filtro overdue se richiesto
        if (overdueOnly) {
            const now = Date.now();
            tasks = tasks.filter(t => {
                const due = t.due_date ? Number(t.due_date) : null;
                const closed = (t.status?.type || '').toLowerCase() === 'done' || (t.status?.status || '').toLowerCase() === 'closed';
                return due != null && due < now && !closed;
            });
        }
        // Mappa in chunks annotabili
        return tasks.slice(0, 100).map((t, i) => ({
            id: crypto.createHash('sha1').update(`clickup:${t.id}:${i}`).digest('hex'),
            text: `${t.name || ''}\n${(t.description||'').slice(0, 1800)}`.trim(),
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

module.exports = {
    getTasks,
    getTask,
    searchTasks,
};
