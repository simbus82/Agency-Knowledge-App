// Planner V2: produce un task graph che può includere chiamate a strumenti esterni.
const { claudeRequest, CLAUDE_MODEL_PLANNER } = require('../ai/claudeClient');
const planCache = new Map();

// Costruzione dinamica strumenti disponibili (esclude gmail se non configurato)
function buildAvailableToolsDescriptor(){
    const parts = [];
    parts.push(`- googleDrive:\n    - searchFiles(query: string): Cerca file in Google Drive. Utile per trovare documenti, offerte, report.\n    - getFileContent(fileId: string): Estrae il testo da un file specifico. Da usare dopo searchFiles.`);
    parts.push(`- clickup:\n    - getTasks(criteria: {listId: string}): Ottiene i task da una specifica lista di ClickUp.\n    - getTask(taskId: string): Ottiene i dettagli di un singolo task.`);
    const gmailReady = process.env.GOOGLE_CREDENTIALS_JSON && process.env.GOOGLE_IMPERSONATED_USER_EMAIL;
    if(gmailReady){
        parts.push(`- gmail:\n    - searchEmails(query: string, maxResults?: number): Cerca email pertinenti (solo lettura).\n    - getEmailContent(messageId: string): Recupera corpo e metadati di una email.`);
    }
    parts.push(`- internal_search:\n    - retrieve(criteria: {raw: string}, k: number, dynamic_expansion: boolean): Cerca nella base di conoscenza interna (documenti ingeriti).`);
    if(!gmailReady){
        parts.push(`\n(Nota: gmail non configurato -> non usarlo nel piano.)`);
    }
    return parts.join('\n');
}

async function aiPlan(query) {
    const key = query.trim().toLowerCase();
    if (planCache.has(key)) return planCache.get(key);

    const prompt = `Sei un pianificatore per un assistente AI in un'agenzia di marketing.
Il tuo compito è trasformare una query utente in un piano eseguibile come un grafo di task in formato JSON.

La query dell'utente è: "${query}"

Puoi usare una base di conoscenza interna o degli strumenti esterni per ottenere informazioni aggiornate.
Ecco gli strumenti disponibili:
${buildAvailableToolsDescriptor()}

Regole per la pianificazione:
1.  Tipi di task consentiti: 'retrieve' (per internal_search), 'tool_call', 'annotate', 'correlate', 'reason', 'validate', 'compose'.
2.  'tool_call': si usa per chiamare strumenti esterni. Il campo 'tool' deve contenere 'nomeStrumento.nomeFunzione' (es. 'googleDrive.searchFiles') e 'params' deve essere un oggetto con i parametri della funzione.
3.  'retrieve': si usa per la ricerca interna.
4.  Dipendenze: Ogni task (tranne il primo) DEVE avere un campo "inputs": [...] con gli id dei task precedenti.
5.  Flusso: Inizia con 'retrieve' o 'tool_call' per raccogliere i dati. Prosegui con 'annotate' per arricchirli, 'reason' o 'correlate' per analizzarli, e termina sempre con 'validate' e 'compose'.
6.  Se la domanda richiede un confronto tra dati da fonti diverse (es. file su Drive, task ClickUp, email Gmail), crea un piano che chiama gli strumenti necessari e poi usa un task 'correlate' per confrontare/aggregare i risultati.

Esempio di piano complesso:
Query: "Verifica se i task nell'offerta per il Progetto-X (file 'offerta_progetto_x.pdf') sono stati creati su ClickUp nella lista 123."
{
  "intents": ["comparison", "validation"],
  "tasks": [
    { "id": "t1", "type": "tool_call", "tool": "googleDrive.searchFiles", "params": { "query": "offerta_progetto_x.pdf" } },
    { "id": "t2", "type": "tool_call", "tool": "googleDrive.getFileContent", "params": { "fileId": "{t1.files[0].id}" } },
    { "id": "t3", "type": "tool_call", "tool": "clickup.getTasks", "params": { "listId": "123" } },
    { "id": "t4", "type": "correlate", "goal": "match_offer_tasks_to_clickup", "inputs": ["t2", "t3"] },
    { "id": "t5", "type": "reason", "goal": "summarize_comparison", "inputs": ["t4"] },
    { "id": "t6", "type": "validate", "inputs": ["t5"] },
    { "id": "t7", "type": "compose", "format": "text", "inputs": ["t6"] }
  ]
}

Ora, crea il piano JSON per la query: "${query}". Fornisci solo il JSON valido, senza testo aggiuntivo.`;

    if (!process.env.CLAUDE_API_KEY) throw new Error('CLAUDE_API_KEY missing for planner');

    try {
        const raw = await claudeRequest(CLAUDE_MODEL_PLANNER, prompt, 2000, 0.1);
        const jsonStart = raw.indexOf('{');
        const jsonEnd = raw.lastIndexOf('}');
        if (jsonStart >= 0 && jsonEnd > jsonStart) {
            const parsed = JSON.parse(raw.slice(jsonStart, jsonEnd + 1));
            if (!Array.isArray(parsed.tasks)) throw new Error('Planner response is missing "tasks" array');
            planCache.set(key, parsed);
            return parsed;
        }
        throw new Error('Planner produced no valid JSON');
    } catch (error) {
        console.error("Error during AI planning:", error);
        throw new Error(`Planner failed to generate a valid plan. Details: ${error.message}`);
    }
}

module.exports.plan = aiPlan;
