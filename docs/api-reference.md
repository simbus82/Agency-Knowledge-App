# API Reference (Sintesi)

## Version
`GET /version` → `{ version }

## Health
`GET /health` → stato servizi

## Chat (Legacy Simple)
`POST /api/claude/message` (modalità diretta legacy)

## RAG Orchestrated Chat
`POST /api/rag/chat`
Body minimale:
```
{ "message": "Trova le task critiche della prossima settimana e le email recenti del cliente X" }
```
Risposta (estratto):
```
{
  "answer": "...",
  "graph": {...},
  "sources": [...],
  "tasks": [{"id":"t1","type":"retrieve",...}],
  "errors": []
}
```
`graph`/`tasks` possono essere omessi nella risposta finale user-facing (debug only).

## Settings Admin (esempi)
`GET /api/admin/settings`
`POST /api/admin/settings` → aggiorna subset

## Google Drive Proxy
`GET /api/google/files?q=...`

## ClickUp Proxy
`GET /api/clickup/...`

## Sicurezza
- Tutte le route protette da sessione
- Gating connettori su variabili env
- Token non esposti lato client

