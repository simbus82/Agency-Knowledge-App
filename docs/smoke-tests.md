# Smoke Tests

Esegui questi test rapidi per verificare che l’assistente risponda come atteso, senza configurazioni extra.

## 1) Verifica export connettori (senza rete)

```
npm run test:connectors:local
```

Atteso: tutte le righe `[OK]` per Drive/ClickUp/Gmail (Gmail disponibile solo se il file è presente).

## 2) Query esempio in UI (dopo login Google)

Apri l’app e prova queste domande nella chat:

- "Mostrami i documenti aggiornati questa settimana nella cartella <NomeCartella> del Drive Condiviso <NomeDrive>"
- "Quali task del team su ClickUp riguardano ‘budget Q3’ e che stato hanno?"
- "Analizza i materiali del progetto <Progetto> nella cartella <link cartella> e dimmi cosa manca per avviare la campagna"
- "Raccogli insight su ‘onboarding’ da documenti Drive e (se abilitata) email recenti"

Suggerimenti:
- Assicurati che il Service Account abbia accesso alle Shared Drives (membro) oppure usa `GOOGLE_IMPERSONATED_USER_EMAIL` di un utente con accesso.
- Per ClickUp, se non passi `listId`, il planner può usare `clickup.searchTasks` a livello team (se determinato) oppure filtrare i risultati disponibili.

## 3) Ingest mirato (opzionale, via API)

Per indicizzare un file specifico in RAG (aiuta su documenti lunghi):

```
POST /api/rag/ingest/drive/:fileId
```

Risponde con numero di chunks creati. Richiede sessione autenticata e Google collegato.

## 4) Verifica servizi

```
GET /api/status/services
```

Restituisce stato di `claude`, `database`, `clickup`, `drive` per i badge UI.

