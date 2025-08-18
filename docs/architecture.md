# Architecture

## Diagramma Alto Livello
```
Frontend -> Backend -> Claude
                 |-> ClickUp
                 |-> Google Drive
                 |-> SQLite (config, conversations, cache)
```

## Componenti
- `server.js`: orchestrazione AI-first, proxy API, caching, token refresh
- `ai-first-engine.js`: analisi query, costruzione memoria, prompt dinamici
- `public/`: UI statica + fetch dinamico version
- `data/`: database SQLite

## Memory Strategy
- Ultimi 12 messaggi raw
- Riassunto cumulativo generato su overflow
- Passato come `conversationSummary` nei prompt

## Caching
- TTL + stale-while-revalidate
- Chiavi per combinazione utente + tipo + query
- Evita refetch costosi (Drive export / task enrichment)

## Sicurezza
- Refresh token cifrati AES-256-GCM se chiave presente
- Domain allowlist Google OAuth
- Cookie httpOnly sessione

