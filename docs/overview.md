# Overview

Agency Knowledge Hub unifica accesso a ClickUp, Google Drive e (opzionalmente) Gmail attraverso un motore AI‑first RAG che pianifica dinamicamente tool call, retrieval e annotazioni per rispondere a query naturali su task, documenti, email e insight trasversali.

## Key Value
- Unificazione dati operativi + documentali + email (se abilitato)
- Risposte contestualizzate con memoria multi‑turn e annotazioni strutturate
- Estensibilità modulare: nuovi connettori drop‑in (pattern `src/connectors/*`)
- AI riduce heuristics: parsing intenti, espansione query, date & entity extraction guidate da LLM
- Sicuro: token criptati, domini autorizzati, gating dinamico dei tool in base alle variabili ambiente

## Feature Snapshot
- Claude Sonnet/Opus con selezione per utente
- Planner LLM → Task Graph (retrieve / tool_call / annotate / correlate / reason / compose)
- Executor con template parametrici `{tX.path}` e resilienza errori tool
- Connettori: ClickUp (task + enrichment), Google Drive (full‑text export, My Drive + Shared Drives), Gmail (read‑only opzionale)
- Annotators LLM: entità, date, claims (basic heuristic rimosso)
- Query expansion & intent parsing model‑driven
- Memory: riassunto + ultimi N messaggi
- Caching TTL + stale‑while‑revalidate
- Admin panel runtime tuning
- Script release semantico + versione esposta via `/version`

## Personas
- Operativo: recupera rapidamente task, file, email rilevanti
- Project Manager: overview workload & stati aggregati multi‑sorgente
- Direzione: insight sintetizzati cross‑piattaforma
- Compliance / Analyst (futuro): correlazioni e timeline
- Dev/Admin: manutenzione, scaling, aggiunta nuovi connettori

