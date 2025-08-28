# Architecture

## Diagramma Alto Livello
```
Frontend (HTML/JS)
    │
    ▼
Backend (Node.js / Express)
    │  (planner LLM → task graph JSON)
    ▼
RAG Orchestrator (executor: retrieve · tool_call · annotate · reason · compose)
    │
    ├─► Claude (LLM: planning, expansion, annotators, synthesis)
    ├─► ClickUp Connector (se env/token presenti)
    ├─► Drive Connector (OAuth / service scope)
    └─► Gmail Connector (opzionale – service account delegation)

SQLite (config, conversations, cache, rag_chunks)
```

## Componenti
- `server.js`: bootstrap server, endpoint chat / rag, health, version, init DB
- `src/engines/ai-first-engine.js`: entrypoint motore AI-first
- `src/rag/planner/`: planner LLM → genera Task Graph adattivo (includendo `tool_call` condizionati)
- `src/rag/executor/`: esecuzione grafo + template parametrici + gestione errori tool
- `src/rag/retrieval/`: BM25 + expansion LLM + rerank base
- `src/rag/annotators/`: entità, date, claims
- `src/rag/synthesis/`: fusione reasoning → risposta finale
- `src/connectors/`: clickup, googleDrive, gmail (gating dinamico via env)
- `public/`: UI statica
- `data/`: database SQLite (conversazioni, chunk, cache)

## Memory Strategy
- Ultimi 12 messaggi raw
- Riassunto cumulativo generato su overflow (LLM summarizer)
- Usato come `conversationSummary` riducendo token footprint

## Caching
- TTL + stale‑while‑revalidate (Drive export, task enrichment)
- Chiavi scoping per utente / tipo / query
- Pianificato: layer embedding cache & re-rank results cache

## Sicurezza
- Refresh token cifrati AES-256-GCM (`TOKEN_ENC_KEY`)
- Domain allowlist Google OAuth
- Cookie sessione httpOnly
- Gating tool: un connettore non configurato non appare nel planner (riduce superfici involontarie)
- Segregazione credenziali (Gmail service account vs OAuth utente)

## Task Types (RAG)
| Tipo | Funzione |
|------|----------|
| retrieve | Recupero chunk top-K (Drive / ClickUp / future) |
| tool_call | Invocazione connettore esterno con parametri dinamici |
| annotate | Estrazione entità / date / claims su subset chunk |
| correlate | Unione / matching multi-sorgente (baseline) |
| reason | Sintesi ragionata supportata da evidenze |
| compose | Output finale formattato |

Il planner può omettere step non necessari per query semplici (es. solo Drive). Errori nei `tool_call` non interrompono il grafo: l'executor registra un oggetto `error` nel nodo relativo.

