# RAG & Reasoning Pipeline (Current State)

Questo documento descrive lo stato attuale della pipeline RAG AI‑first dopo la sostituzione della maggior parte delle euristiche con componenti LLM.

## Obiettivi
1. Endpoint unificato `/api/rag/chat` che orchestri pianificazione → recupero → annotazione → correlazione → reasoning → composizione.
2. Task Graph dinamico generato dal planner LLM (nessun grafo statico hardcoded).
3. Facilmente estendibile con nuovi task type (es. `validate`, `summarize_segment`, `compare_entities`).
4. Eliminare sinonimi / regex fragili affidandosi a estrazioni strutturate LLM.

## Componenti Principali
| Componente | File | Stato |
|------------|------|-------|
| Planner LLM | `src/rag/planner/planner.js` | Dinamico: costruisce task graph, gating tool via env |
| Executor | `src/rag/executor/executeGraph.js` | Esegue tasks, template parametrici, error resilience |
| Retriever | `src/rag/retrieval/retriever.js` | BM25 + expansion LLM (embeddings reali TBD) |
| BM25 Index | `src/rag/retrieval/bm25.js` | In-memory semplice |
| Expansion | `src/rag/retrieval/expansion.js` | LLM-driven (nessun seed statico) |
| Annotators | `src/rag/annotators/*.js` | entities/date/claims via LLM; basic deprecata |
| Synthesis | `src/rag/synthesis/synthesizer.js` | Combina evidenze + reasoning |
| Intent Parser | `src/rag/util/intentParser.js` | LLM JSON extraction |
| Connectors | `src/connectors/*.js` | ClickUp, Google Drive, Gmail opzionale |
| Task Graph Execution | parte di executor | Gestione risultati & dipendenze |

## Flusso Attuale (Sintesi)
1. POST `/api/rag/chat` → query & contesto memoria
2. Planner LLM → JSON Task Graph (solo task necessari)
3. Executor: risolve dipendenze & param template, esegue retrieve / tool_call
4. Annotators applicati ai chunk top-K rilevanti
5. Correlate (baseline) raggruppa per entità chiave / timeframe
6. Reason & Compose generano risposta spiegabile

## Limiti Attuali
- Nessun embedding vettoriale reale (solo BM25 + expansion) → qualitativamente buono ma migliorabile
- Correlazione baseline limitata (aggregazioni semplici)
- Mancanza di validator grounding formale (claim → evidence substring)
- Ranking privo di reranker cross-encoder
- Mancanza feedback loop utente

## Evoluzione Pianificata
| Step | Azione | Beneficio |
|------|--------|----------|
| 1 | Embedding reale + hybrid scoring | Miglior recall semantico |
| 2 | Reranker cross-encoder | Precisione top-K |
| 3 | Correlation avanzata (timeline / diff / KPI) | Insight multi-sorgente ricchi |
| 4 | Validator grounding + fact conflict detection | Riduzione allucinazioni |
| 5 | Feedback loop (thumbs / corrections) | Miglior ranking & planning |
| 6 | Active memory summarization semantica | Contesto lungo termine |
| 7 | Fine-grained tool cost heuristics | Ottimizzazione costi & latenza |

## Schema Tabella `rag_chunks`
```
id TEXT PRIMARY KEY
text TEXT
source TEXT   -- drive | clickup | manual | ...
type TEXT     -- sheet_row | doc_par | task | comment | other
path TEXT     -- percorso file o id task
loc TEXT      -- posizione (riga, paragrafo, pagina)
embedding TEXT (JSON) -- placeholder, non usato nel retriever MVP
updated_at DATETIME
```

## Componenti già migrati da Heuristic a LLM
| Modulo | Precedente | Stato Attuale |
|--------|-----------|---------------|
| Intent Parser | regex intent detection | LLM JSON extraction |
| Query Expansion | seed term set | LLM generative + filter |
| Entity Extraction | pattern matching | LLM annotator |
| Date Extraction | regex ranges | LLM normalizer |
| Basic Annotator | heuristic labels | Deprecata (rimosso) |
| Planner | static skeleton | LLM adaptive graph |

## Integrazione UI (futura)
- Badge "Analisi multi-fonte" se graph > n tasks
- Sezione fonti con snippet + evidenza evidenziata
- Feedback (👍/👎) → tabella `rag_feedback`
- Visualization grafo per debug (endpoint `/api/rag/plan` suggerito)

## Note di Sicurezza
- Non persistere testi sensibili senza cifratura se policy interna lo richiede.
- Limitare dimensione chunk (p.es. max 1200 caratteri) per evitare estrazioni massive.

## Prossimi Commit Suggeriti
1. Embedding vettoriali reali + caching (campo `embedding` BLOB)
2. Reranker cross-encoder
3. Endpoint `/api/rag/plan` per debug planner
4. Logging task dettagliato (`rag_task_log`)
5. Grounding validator + conflict detection
6. Feedback storage (`rag_feedback`)
7. Correlation avanzata (timeline / diff / KPI)

---
Pipeline attuale operativa; focus successivo: embeddings reali, reranking e grounding per aumentare precisione e trasparenza.
