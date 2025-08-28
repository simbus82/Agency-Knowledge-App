# Modular Connectors

I connettori forniscono accesso read / selective fetch alle fonti esterne. Ogni file in `src/connectors/` esporta funzioni pure asincrone invocate dal task type `tool_call` dell'executor.

## Design Principles
- Funzioni idempotenti lato read
- Nessun side effect (no write mutativo)
- Parametri espliciti (object destructuring)
- Return value serializzabile JSON
- Errori catturati e convertiti in log + fallback neutro (evita crash grafo)

## Connectors Attuali
| Nome | File | Principali Funzioni | Env Necessarie |
|------|------|---------------------|----------------|
| Google Drive | `googleDriveConnector.js` | `searchFiles(query)` `searchInFolders({ folderIds, query?, driveId? })` `getFileChunks({ fileId, mimeType?, fileName? })` | `GOOGLE_CLIENT_ID/SECRET` (OAuth runtime) oppure `GOOGLE_CREDENTIALS_JSON` (service) + `GOOGLE_IMPERSONATED_USER_EMAIL` (consigliato) |
| ClickUp | `clickupConnector.js` | `getTasks({listId})` `getTask({taskId})` | `CLICKUP_API_KEY` (o OAuth UI per user driven) |
| Gmail (optional) | `gmailConnector.js` | `searchEmails(query,maxResults)` `getEmailContent(id)` `getEmailChunks({ messageId })` | `GOOGLE_CREDENTIALS_JSON`, `GOOGLE_IMPERSONATED_USER_EMAIL` |

## Tool Registration
Lo *tool registry* vive in `src/rag/executor/executeGraph.js`. Durante l'avvio o la prima esecuzione del grafo costruisce un dizionario:
```
{
  clickup_getTasks: async(params)=>..., 
  drive_searchFiles: async(params)=>..., 
  gmail_searchEmails: async(params)=>... (solo se env ok)
}
```
Il planner riceve un catalogo filtrato e può includere `tool_call` solo per i tool disponibili. I connettori Drive/Gmail/ClickUp possono restituire anche "chunks" testuali (campi: `id`, `text`, `source`, `type`, `path`, `loc`) per alimentare annotatori ed executor.

## Parametric Templates
I nodi `tool_call` possono referenziare output precedenti con placeholder `{t<index>.<path>}` risolti dall'executor (es: `{t1.files[0].id}`).

## Error Handling
- Se un tool lancia un'eccezione viene catturata e memorizzata nel risultato del task (`{ error: {...} }`).
- Il reasoning può scegliere di ignorare i task con error oppure menzionare limiti.

## Aggiungere un Nuovo Connettore
1. Crea `src/connectors/<nome>Connector.js`
2. Esporta funzioni pure (`searchX`, `getX` etc.)
3. Aggiorna il registry in `executeGraph.js`
4. Aggiungi gating env (non caricare se variabili mancanti)
5. Aggiorna prompt del planner se necessario (es: breve descrizione tool)
6. Documenta variabili in `.env.example` e `docs/configuration.md`

## Best Practices
- Minimizza campi di risposta (trim, subset)
- Applica piccoli limiti (pageSize 10) – il planner può orchestrare richieste successive se necessario
- Logga errori con messaggi sintetici, evita dump credenziali
- Considera rate limiting (futuro middleware centralizzato)

## Futuro
- Metrics per tool (tempo, token, errori) → guida ottimizzazione planner
- Auto cost model: planner penalizza tool costosi
- Cache layer per Gmail headers / Drive metadata
