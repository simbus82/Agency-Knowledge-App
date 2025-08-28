# AI Engine & Memory

## Obiettivo
Orchestrare una pipeline RAG adattiva (planner → executor) che decide dinamicamente quali connettori interrogare, come arricchire i dati e quali annotazioni applicare prima della sintesi finale.

## Fasi Principali
1. Intent Parsing (LLM) – estrazione action, entità, finestra temporale
2. Planning (LLM) – generazione Task Graph JSON (retrieve / tool_call / annotate / reason / compose)
3. Retrieval – BM25 + query expansion LLM + (futuro) reranking avanzato
4. Tool Calls – connettori esterni (ClickUp / Drive / Gmail opzionale) con param templating
5. Annotation – entità, date, claims estratte via LLM su chunk selezionati
6. Correlation – baseline join / grouping (estendibile)
7. Reason & Compose – reasoning assistito + risposta finale strutturata

## Prompt Inputs Principali
- userQuery
- conversationSummary (riassunto storico)
- recentMessages (ultimi 12)
- tool catalog dinamico (solo connettori attivi)
- system directives (policy & style)

## Memory
- Sliding window ultimi N turni + summary cumulativo
- Summary rigenerato quando token > soglia
- Mantiene coerenza riducendo costo

## Miglioramenti Futuri
- Vector store semantico per richiamo lungo termine
- Cross-encoder / reranker
- Correlation avanzata multi-sorgente (timeline, diff, KPI)
- Fine-tuned role profiles (PM vs Exec vs Analyst)
- Feedback loop (accetta correzioni utente → learning)

