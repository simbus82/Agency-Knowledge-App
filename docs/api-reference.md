# API Reference (Sintesi)

## Version
`GET /version` → `{ version }

## Health
`GET /health` → stato servizi

## Chat
`POST /api/claude/message`
Body:
```
{
  "messages": [{"role":"user","content":"Testo"}],
  "model": "claude-3-5-sonnet-latest"
}
```

## Settings Admin (esempi)
`GET /api/admin/settings`
`POST /api/admin/settings` → aggiorna subset

## Google Drive Proxy
`GET /api/google/files?q=...`

## ClickUp Proxy
`GET /api/clickup/...`

## Sicurezza
- Tutte le route protette da sessione
- Limiti e controlli lato server

