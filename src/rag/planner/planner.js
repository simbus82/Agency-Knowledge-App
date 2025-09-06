// Planner V2: produce un task graph che può includere chiamate a strumenti esterni.
const { claudeRequest, CLAUDE_MODEL_PLANNER } = require('../ai/claudeClient');
const planCache = new Map();

// Costruzione dinamica strumenti disponibili (esclude gmail se non configurato)
function buildAvailableToolsDescriptor(){
    const parts = [];
    // Google Drive tools
    parts.push(`- googleDrive:
    - searchFiles(params: { query: string }): Cerca file in My Drive e Drive Condivisi (usa name/fullText contains). Restituisce metadati file.
    - searchInFolders(params: { folderIds: string[], query?: string, driveId?: string }): Cerca in una o più cartelle (anche Shared Drives).
    - getFileChunks(params: { fileId: string, mimeType?: string, fileName?: string }): Estrae chunk testuali annotabili da un file.

  Hints Drive:
  - Se l'utente chiede "documenti recenti/oggi/settimana/mese", usa searchFiles con query generica (es. trashed=false) e poi getFileChunks SOLO per i 1-2 file più rilevanti.
  - Se l'utente cita progetto/cliente/brand, costruisci query con name/fullText contains 'TERM' (max 2-3 termini specifici, evita parole generiche).
  - Dopo searchFiles, aggiungi sempre getFileChunks su 1 file con { fileId: "{tX.files[0].id}", fileName: "{tX.files[0].name}" } per alimentare annotators.`);

    // ClickUp tools
    parts.push(`- clickup:
    - getTasks(params: { listId: string, includeClosed?: boolean, limit?: number }): Task di una lista (con paginazione).
    - getTask(params: { taskId: string }): Dettagli di un task.
    - getTaskComments(params: { taskId: string, limit?: number }): Commenti del task come chunks.
    - searchTasks(params: { teamId?: string, query?: string, assignee?: string, statuses?: string[], overdueOnly?: boolean, includeClosed?: boolean, includeSubtasks?: boolean, limit?: number }): Ricerca task a livello team; restituisce chunks (usa titolo, descrizione, tag, campi custom, lista/spazio/cartella). Se nessun match e query presente, prova deep pass nei commenti.

  Hints ClickUp:
  - Per richieste su task in ritardo/scadenza/urgenti: usa searchTasks con { overdueOnly: true, includeSubtasks: true, includeClosed: false, limit: 100 }.
  - Se l'utente menziona progetti/clienti, metti il nome in query (es. query: 'ClienteX' o 'Progetto Y').
  - Se chiede i "miei" task, puoi impostare assignee a uno userId noto; se non disponibile evita assignee e usa query + filtri.
  - Dopo searchTasks, prosegui con annotate (entities, dates, claims) e reason (goal coerente: status/report/risks/listing) prima di validate/compose.`);

    const gmailReady = process.env.GOOGLE_CREDENTIALS_JSON && process.env.GOOGLE_IMPERSONATED_USER_EMAIL;
    if(gmailReady){
        parts.push(`- gmail:
    - searchEmails(query: string, maxResults?: number): Cerca email pertinenti (solo lettura).
    - getEmailChunks(params: { messageId: string }): Restituisce chunk annotabili del corpo email.`);
    }
    parts.push(`- internal_search:
    - retrieve(criteria: { raw: string }, k: number, dynamic_expansion: boolean): Cerca nella base di conoscenza interna (documenti ingeriti).`);
    if(!gmailReady){ parts.push(`\n(Nota: gmail non configurato -> non usarlo nel piano.)`); }
    return parts.join('\n');
}

async function aiPlan(query, opts = {}) {
    const key = query.trim().toLowerCase();
    if (planCache.has(key)) return planCache.get(key);

    const prompt = `Sei un pianificatore per un assistente AI in un'agenzia di marketing.
Il tuo compito è trasformare una query utente in un piano eseguibile come un grafo di task in formato JSON.

La query dell'utente è: "${query}"

Puoi usare la base di conoscenza interna e/o strumenti esterni per ottenere informazioni aggiornate.
Ecco gli strumenti disponibili e le linee guida d'uso:
${buildAvailableToolsDescriptor()}

Decision rules (scegli gli strumenti giusti):
- Se la query parla di task/attività, scadenze, in ritardo, priorità, o assegnazioni → usa ClickUp (searchTasks) e poi annota + reason.
- Se la query parla di documenti/file, Drive, briefing, report, presentazioni, o documenti recenti → usa Google Drive (searchFiles o searchInFolders) + getFileChunks.
- Se la query combina entrambe le fonti (es. "confronta task con documento") → usa entrambi e poi 'correlate'.
- Se la query è molto generica o storica → aggiungi anche 'retrieve' dalla knowledge base interna.

Regole per la pianificazione:
1. Tipi task: 'retrieve', 'tool_call', 'annotate', 'correlate', 'reason', 'validate', 'compose'.
2. 'tool_call': usa 'nomeStrumento.nomeFunzione' (es. 'googleDrive.searchFiles') con 'params' oggetto.
3. Ogni task (tranne il primo) DEVE avere "inputs": [...].
4. Flusso minimo: raccolta dati ('tool_call' o 'retrieve') → 'annotate' (entities, dates, claims) → 'reason' (goal coerente) → 'validate' → 'compose'.
5. Per ClickUp 'in ritardo/scadenza': preferisci searchTasks con { overdueOnly:true, includeSubtasks:true, includeClosed:false, limit:100 }.
6. Per Drive dopo 'searchFiles' seleziona 1 file e chiama 'getFileChunks' usando placeholders {tX.files[0].id}.

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

4) Task in ritardo per progetto specifico (ClickUp)
Query: "Quali task del progetto Thermae sono in ritardo?"
{
  "intents": ["status", "listing"],
  "tasks": [
    { "id": "t1", "type": "tool_call", "tool": "clickup.searchTasks", "params": { "query": "Thermae", "overdueOnly": true, "includeClosed": false, "includeSubtasks": true, "limit": 100 } },
    { "id": "t2", "type": "annotate", "annotators": ["entities", "dates", "claims"], "inputs": ["t1"] },
    { "id": "t3", "type": "reason", "goal": "status", "inputs": ["t2"] },
    { "id": "t4", "type": "validate", "inputs": ["t3"] },
    { "id": "t5", "type": "compose", "format": "text", "inputs": ["t4"] }
  ]
}

5) Documenti recenti (Drive)
Query: "Mostrami i documenti modificati oggi su Drive per Bebilandia"
{
  "intents": ["listing"],
  "tasks": [
    { "id": "t1", "type": "tool_call", "tool": "googleDrive.searchFiles", "params": { "query": "(name contains 'Bebilandia' or fullText contains 'Bebilandia') and trashed = false" } },
    { "id": "t2", "type": "tool_call", "tool": "googleDrive.getFileChunks", "params": { "fileId": "{t1.files[0].id}", "fileName": "{t1.files[0].name}" } },
    { "id": "t3", "type": "annotate", "annotators": ["entities", "dates"], "inputs": ["t2"] },
    { "id": "t4", "type": "reason", "goal": "listing", "inputs": ["t3"] },
    { "id": "t5", "type": "validate", "inputs": ["t4"] },
    { "id": "t6", "type": "compose", "format": "text", "inputs": ["t5"] }
  ]
}

Ora, crea il piano JSON per la query: "${query}". Fornisci solo il JSON valido, senza testo aggiuntivo.`;

    if (!process.env.CLAUDE_API_KEY) throw new Error('CLAUDE_API_KEY missing for planner');

    try {
        const model = opts.model || CLAUDE_MODEL_PLANNER;
        const raw = await claudeRequest(model, prompt, 2000, 0.1);
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
