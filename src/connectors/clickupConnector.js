// src/connectors/clickupConnector.js
// Questo modulo gestirà le interazioni con l'API di ClickUp.

/**
 * Ottiene i task da ClickUp per un progetto o una lista specifica.
 * @param {object} criteria - I criteri per la ricerca (es. { listId: '12345' }).
 * @returns {Promise<Array>} - Una promessa che risolve in un array di oggetti task.
 */
async function getTasks(criteria) {
    console.warn("clickupConnector.getTasks non è ancora implementato.", criteria);
    // TODO: Implementare la chiamata all'API di ClickUp.
    // Richiederà un API Token di ClickUp.
    // Esempio di logica:
    // 1. Costruire l'URL dell'endpoint (es. /api/v2/list/{list_id}/task).
    // 2. Effettuare la chiamata HTTP con il token di autorizzazione.
    // 3. Restituire i task formattati.
    if (!process.env.CLICKUP_API_KEY) {
        console.error("Variabile d'ambiente CLICKUP_API_KEY non impostata. Impossibile connettersi a ClickUp.");
        return [];
    }
    return []; // Ritorna un array vuoto per ora.
}

/**
 * Ottiene informazioni su un singolo task da ClickUp.
 * @param {string} taskId - L'ID del task.
 * @returns {Promise<object|null>} - Una promessa che risolve con l'oggetto task o null.
 */
async function getTask(taskId) {
    console.warn(`clickupConnector.getTask(${taskId}) non è ancora implementato.`);
    // TODO: Implementare la chiamata all'API di ClickUp per un singolo task.
    if (!process.env.CLICKUP_API_KEY) {
        console.error("Variabile d'ambiente CLICKUP_API_KEY non impostata.");
        return null;
    }
    return null; // Ritorna null per ora.
}


module.exports = {
    getTasks,
    getTask,
};
