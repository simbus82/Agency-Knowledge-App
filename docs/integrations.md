# Integrations

## ClickUp
- Gerarchie: spaces, folders, lists
- Task enrichment: commenti, time tracking, fields on-demand
- Cache per ridurre chiamate ripetute

## Google Drive
- Ricerca con `supportsAllDrives=true` + export full‑text
- Docs/Sheets/Slides export → text/plain
- PDF parsing condizionato a `ENABLE_PDF_PARSE`
- Size guard (`DRIVE_MAX_BYTES`) e truncation (`DRIVE_EXPORT_MAX_CHARS`)

## Gmail (Optional Read‑Only)
- Service Account + Domain-wide Delegation
- Scope minimo: `gmail.readonly`
- Funzioni: `searchEmails(query, maxResults)` e `getEmailContent(id)`
- Attivazione: entrambe `GOOGLE_CREDENTIALS_JSON` + `GOOGLE_IMPERSONATED_USER_EMAIL`

## Anthropic Claude
- Modelli: Sonnet, Opus (estendibile)
- Scelta per utente
- Usato per: planner, intent parser, annotators, query expansion, synthesis

## Sicurezza Token & Connectors
- Refresh token Google (OAuth) cifrato se `TOKEN_ENC_KEY`
- Gmail non usa refresh token (JWT impersonation)
- ClickUp personal token solo lato server
- Error audit table per tentativi refresh falliti

## Pattern Connettore
Ogni connettore espone funzioni pure asincrone (`getTasks`, `searchFiles`, `searchEmails`, ecc.). Il registry dei tool in `executor` include solo quelli con variabili richieste presenti.

