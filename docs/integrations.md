# Integrations

## ClickUp
- Gerarchie: spaces, folders, lists
- Task enrichment: commenti, time tracking, fields on-demand
- Cache per ridurre chiamate ripetute

## Google Drive
- Ricerca con `supportsAllDrives=true` e `includeItemsFromAllDrives=true`
- Estrazione contenuti: Docs/Sheets/Slides via export; PDF con parser; Office (docx/xlsx/pptx) via conversione
- Size guard (`DRIVE_MAX_BYTES`)
- Troncamento testo (`DRIVE_EXPORT_MAX_CHARS`)

## Anthropic Claude
- Modelli: Sonnet, Opus
- Scelta per utente (persistita)
- Parametri controllati lato server

## Sicurezza Token
- Refresh token Google cifrato
- Error audit table per tentativi refresh falliti

