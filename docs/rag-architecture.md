# Generalized RAG & Reasoning Pipeline (MVP)

Questo documento descrive l'implementazione iniziale (MVP) della pipeline RAG generalizzata introdotta nel progetto. È progettata per evolvere senza dover hardcodare regole o sinonimi, sostituendo progressivamente gli heuristic placeholder con modelli.

## Obiettivi
1. Un unico endpoint `/api/rag/chat` che pianifica, recupera, annota, ragiona e compone una risposta finale completa (no step-by-step visibile all'utente).
2. Architettura modulare: planner → executor con task graph → retriever ibrido → annotators → reasoning → validation → composer.
3. Facilmente estendibile a nuovi tipi di richieste (report, correlazioni, compliance, timeline, confronti, ecc.).
4. Niente sinonimi hardcoded nel flusso principale (solo placeholder temporanei da rimuovere nel passaggio ai modelli).

## Componenti Aggiunti
| Componente | File | Descrizione |
|------------|------|-------------|
| Planner | `src/rag/planner/planner.js` | Restituisce un Task Graph minimale (da sostituire con planner LLM). |
| Retriever (BM25 + pseudo embedding) | `src/rag/retrieval/retriever.js` | Indicizza i chunk presenti in `rag_chunks` e fa hybrid scoring. |
| BM25 index | `src/rag/retrieval/bm25.js` | Implementazione semplice in-memory. |
| Annotator base | `src/rag/annotators/basic.js` | Etichette naive (prohibition, permission, claim_statement, entity_ref). |
| Executor | `src/rag/executor/executeGraph.js` | Esegue i task del graph in ordine e produce un risultato finale. |
| Mock ingestion | `src/rag/util/ingestMock.js` | Script per popolare rapidamente alcuni chunk di test (solo per sviluppo). |
| Tabella DB | `rag_chunks` (creata in `server.js`) | Archivia i pezzi di conoscenza multi-fonte. |
| Endpoint | `/api/rag/chat` (in `server.js`) | API sperimentale per interrogare la pipeline. |

## Flusso MVP
1. Richiesta POST `/api/rag/chat` con `{ message:"..." }`.
2. Planner produce un graph con nodi: retrieve → annotate → reason → validate → compose.
3. Retriever: BM25 (60 candidati) + pseudoEmbedding (64 dim hash) → fusione score.
4. Annotator base aggiunge etichette superficiali.
5. Reason: heuristica (se trova proibizioni genera conclusione di divieto, altrimenti sintesi). 
6. Validate: placeholder (controllo support presente).
7. Compose: testo finale + prime fonti.

## Limiti Attuali (da rimuovere nelle prossime iterazioni)
- Embedding fittizio (hash): sostituire con modello reale (OpenAI, local, ecc.).
- Planner statico: passare a LLM che genera Task Graph JSON condizionato dalla query.
- Annotator basato su regex: sostituire con classificatore multi-label (LLM zero-shot → fine-tuned piccolo modello / LoRA).
- Nessuna query expansion vera (aggiungere espansione dinamica semantic + LLM filtering).
- Nessuna correlazione multi-sorgente avanzata (aggiungere task `correlate`).
- Nessun grounding rigoroso (serve validator che verifichi substring degli assert rispetto ai chunk).

## Evoluzione Pianificata
| Step | Azione | Beneficio |
|------|--------|----------|
| 1 | Embedding reale + caching | Miglior ranking semantico |
| 2 | Planner LLM few-shot | Task Graph adattivo |
| 3 | Cross-encoder re-ranker | Migliore qualità topK |
| 4 | Annotators modulari (entity, date, claim, sentiment) | Estratti strutturati |
| 5 | Reasoner LLM con schema JSON | Conclusioni tracciabili |
| 6 | Validator grounding + conflitti | Riduzione allucinazioni |
| 7 | Correlazione (join su entity/date) | Report multi-fonte |
| 8 | Active learning loop | Miglioramento continuo |

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

## Hotspots per Re-Implementazione con Modelli
| Modulo | Rimpiazza | Nuovo Input | Output Atteso |
|--------|----------|-------------|---------------|
| pseudoEmbed | hash embedding | testo chunk/query | vettore float normalizzato |
| planner | heuristica | query + meta | task graph JSON validato |
| annotateBasic | regex | chunk text | labels + probabilità |
| reason() | heuristica | evidenze annotate | JSON: conclusions[], support[] |
| validate() | placeholder | reasoning output + evidenze | {valid, issues[]} |

## Integrazione UI (futura)
- Mostrare un badge "(Analisi multi-fonte)" quando il campo `graph` contiene >3 task.
- Espandere sezione "Fonti" con path + loc.
- Consentire feedback (👍/👎) → log tabella `rag_feedback`.

## Note di Sicurezza
- Non persistere testi sensibili senza cifratura se policy interna lo richiede.
- Limitare dimensione chunk (p.es. max 1200 caratteri) per evitare estrazioni massive.

## Prossimi Commit Suggeriti
1. Aggiungere script ingestion reale (Drive + ClickUp) → suddivisione chunk.
2. Integrare embedding API reale + migrazione campo `embedding` da TEXT a BLOB.
3. Endpoint `/api/rag/plan` per ispezionare solo il graph (debug).
4. Logging dettagliato per ogni task (tabella `rag_task_log`).

---
MVP pronto per sperimentazione: sostituire progressivamente gli elementi placeholder man mano che si introducono i modelli veri.
