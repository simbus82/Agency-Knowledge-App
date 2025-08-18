# AI Engine & Memory

## Obiettivo
Delegare a Claude la selezione dinamica dei dati rilevanti riducendo logica rigida.

## Fasi
1. Analisi Intento (prompt analysis)
2. Selezione dati (decide cosa fetchare: ClickUp, Drive, entrambi)
3. Enrichment on-demand (solo task/documenti necessari)
4. Sintesi finale con contesto memorizzato

## Prompt Inputs
- userQuery
- conversationSummary (riassunto storico)
- recentMessages (ultimi 12)
- systemDirectives (policy formato)

## Memory
- Quando lunghezza supera soglia → generazione nuovo summary
- Summary sostituisce messaggi più vecchi
- Riduce token cost / mantiene coerenza

## Miglioramenti Futuri
- Vector store semantico per richiamo lungo termine
- Adaptive window size in base al modello
- Fine-tuned role profiles (es. PM vs Exec)

