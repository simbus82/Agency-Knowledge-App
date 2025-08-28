// Planner V2: produce un task graph che può includere chiamate a strumenti esterni.
const { claudeRequest, CLAUDE_MODEL_PLANNER } = require('../ai/claudeClient');
const planCache = new Map();

// Costruzione dinamica strumenti disponibili (esclude gmail se non configurato)
function buildAvailableToolsDescriptor(){
    const parts = [];
    parts.push(`- googleDrive:\n    - searchFiles(query: string): Cerca file in My Drive e Drive Condivisi.\n    - searchInFolders(params: { folderIds: string[], query?: string, driveId?: string }): Cerca in una o più cartelle (anche Shared Drives).\n    - getFileChunks(params: { fileId: string, mimeType?: string, fileName?: string }): Estrae chunk testuali annotabili da un file.`);
    parts.push(`- clickup:\n    - getTasks(criteria: {listId: string}): Ottiene i task da una specifica lista.\n    - getTask(params: {taskId: string}): Ottiene i dettagli di un singolo task.\n    - searchTasks(params: {teamId?: string, query?: string, assignee?: string, statuses?: string[], overdueOnly?: boolean}): Ricerca task a livello team e restituisce chunk annotabili. Se overdueOnly=true, filtra i task con scadenza passata e non chiusi.`);
    const gmailReady = process.env.GOOGLE_CREDENTIALS_JSON && process.env.GOOGLE_IMPERSONATED_USER_EMAIL;
    if(gmailReady){
        parts.push(`- gmail:\n    - searchEmails(query: string, maxResults?: number): Cerca email pertinenti (solo lettura).\n    - getEmailChunks(params: { messageId: string }): Restituisce chunk annotabili del corpo email.`);
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

Esempi di piani:

1) Drive + ClickUp (con chunks)
Query: "Verifica se i task nell'offerta per il Progetto-X (file 'offerta_progetto_x.pdf') sono stati creati su ClickUp nella lista 123."
{
  "intents": ["comparison", "validation"],
  "tasks": [
    { "id": "t1", "type": "tool_call", "tool": "googleDrive.searchFiles", "params": { "query": "name contains 'offerta_progetto_x.pdf'" } },
    { "id": "t2", "type": "tool_call", "tool": "googleDrive.getFileChunks", "params": { "fileId": "{t1.files[0].id}", "fileName": "{t1.files[0].name}" } },
    { "id": "t3", "type": "tool_call", "tool": "clickup.getTasks", "params": { "listId": "123" } },
    { "id": "t4", "type": "annotate", "annotators": ["entities", "claims"], "inputs": ["t2", "t3"] },
    { "id": "t5", "type": "correlate", "goal": "match_offer_tasks_to_clickup", "inputs": ["t4"] },
    { "id": "t6", "type": "reason", "goal": "summarize_comparison", "inputs": ["t5"] },
    { "id": "t7", "type": "validate", "inputs": ["t6"] },
    { "id": "t8", "type": "compose", "format": "text", "inputs": ["t7"] }
  ]
}

2) Drive Shared Drives: cerca in cartelle e analizza
Query: "Analizza i materiali del progetto 'Alfa' nella cartella (id: FOLDER_ID) del Drive Condiviso e dammi le lacune."
{
  "intents": ["analysis"],
  "tasks": [
    { "id": "t1", "type": "tool_call", "tool": "googleDrive.searchInFolders", "params": { "folderIds": ["FOLDER_ID"], "query": "Alfa" } },
    { "id": "t2", "type": "tool_call", "tool": "googleDrive.getFileChunks", "params": { "fileId": "{t1.files[0].id}", "fileName": "{t1.files[0].name}" } },
    { "id": "t3", "type": "annotate", "annotators": ["entities", "dates", "claims"], "inputs": ["t2"] },
    { "id": "t4", "type": "reason", "goal": "gaps_and_next_steps", "inputs": ["t3"] },
    { "id": "t5", "type": "validate", "inputs": ["t4"] },
    { "id": "t6", "type": "compose", "format": "text", "inputs": ["t5"] }
  ]
}

3) Raccomandazioni multi-fonte (ClickUp + Drive + Gmail opzionale)
Query: "Suggerisci miglioramenti al processo di onboarding considerando task ClickUp e documenti Drive, oltre a eventuali email recenti sull'argomento."
{
  "intents": ["recommendation"],
  "tasks": [
    { "id": "t1", "type": "retrieve", "criteria": { "raw": "onboarding processo best practice" }, "k": 12, "dynamic_expansion": true },
    { "id": "t2", "type": "tool_call", "tool": "clickup.searchTasks", "params": { "teamId": "TEAM_ID_OPTIONAL", "query": "onboarding" } },
    { "id": "t3", "type": "tool_call", "tool": "googleDrive.searchFiles", "params": { "query": "name contains 'onboarding'" } },
    { "id": "t4", "type": "tool_call", "tool": "googleDrive.getFileChunks", "params": { "fileId": "{t3.files[0].id}", "fileName": "{t3.files[0].name}" } },
    { "id": "t5", "type": "tool_call", "tool": "gmail.searchEmails", "params": { "query": "subject:onboarding newer_than:30d", "maxResults": 5 } },
    { "id": "t6", "type": "tool_call", "tool": "gmail.getEmailChunks", "params": { "messageId": "{t5[0].id}" } },
    { "id": "t7", "type": "annotate", "annotators": ["entities", "dates", "claims"], "inputs": ["t1", "t2", "t4", "t6"] },
    { "id": "t8", "type": "correlate", "goal": "cross_source_consistency", "inputs": ["t7"] },
    { "id": "t9", "type": "reason", "goal": "recommendations", "inputs": ["t8"] },
    { "id": "t10", "type": "validate", "inputs": ["t9"] },
    { "id": "t11", "type": "compose", "format": "text", "inputs": ["t10"] }
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
