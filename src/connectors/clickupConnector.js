// ClickUp Connector - implementazione reale
const axios = require('axios');

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

module.exports = {
    getTasks,
    getTask,
};
