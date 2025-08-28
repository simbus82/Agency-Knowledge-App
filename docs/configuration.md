# Configuration & Environment

## Variabili Minime (Core)
```
CLAUDE_API_KEY=
SELECTED_CLAUDE_MODEL=claude-sonnet-4-20250514
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
ALLOWED_DOMAIN=tuodominio.com
FRONTEND_URL=http://localhost:8080
SESSION_SECRET=...
```

## Variabili Opzionali (Connectors & Performance)
```
# ClickUp OAuth (UI)
CLICKUP_CLIENT_ID=
CLICKUP_CLIENT_SECRET=
# ClickUp Personal Token (server tool_call)
CLICKUP_API_KEY=

# Gmail Read-Only (Service Account Delegation)
GOOGLE_CREDENTIALS_JSON='{"type":"service_account",...}'
GOOGLE_IMPERSONATED_USER_EMAIL=

# Sicurezza / performance
TOKEN_ENC_KEY=BASE64_32BYTE
DRIVE_MAX_BYTES=10485760
DRIVE_CACHE_TTL=600
CLICKUP_CACHE_TTL=3600
MAX_DRIVE_FILES_TO_FETCH=3
MAX_CLICKUP_TASKS_ENRICH=3
DRIVE_EXPORT_MAX_CHARS=20000
ENABLE_PDF_PARSE=true
ALERT_THRESHOLD_REFRESH_ERRORS=5
```

## Admin Panel (Runtime)
- Limiti contenuto Google Drive
- Cache TTL ClickUp / Drive
- Toggle parsers (PDF etc.)
- Modello Claude preferito

## Sicurezza Chiavi
- `.env` non committare
- `TOKEN_ENC_KEY` cifra refresh token Google
- Gating dinamico: se variabili Gmail mancanti, nessun tool relativo appare nel planner
- Backup sicuro di `.env.example`

