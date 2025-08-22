// intentParser.js - AI-driven action & slot extraction for knowledge-first pipeline.
const { claudeRequest, CLAUDE_MODEL_UTILITY } = require('../ai/claudeClient');

async function parseIntent(query){
  const q = (query||'').trim();
  if(!q) return { action: 'UNKNOWN', time_range: null, entities: {}, raw: '' };

  if(!process.env.CLAUDE_API_KEY){
    throw new Error('CLAUDE_API_KEY is required for AI-based intent parsing.');
  }

  const prompt = `Analizza la query dell'utente e estrai l'intento e le entità.
L'utente è un manager in un'agenzia di marketing.
Query: "${q}"

Rispondi con un oggetto JSON con la seguente struttura:
{
  "action": "ACTION_TYPE",
  "time_range": "TIME_RANGE | null",
  "entities": {
    "projects": ["nome_progetto_1", ...],
    "clients": ["nome_cliente_1", ...],
    "topics": ["argomento_1", ...]
  }
}

I valori possibili per ACTION_TYPE sono: STATUS, LIST, SUMMARIZE, COMPARE, REPORT, RISKS, SEARCH_DOC, SYNTHESIZE, UNKNOWN.
- STATUS: per aggiornamenti sui progressi.
- LIST: per elenchi di elementi (es. task, documenti).
- SUMMARIZE: per riassunti di argomenti o documenti.
- COMPARE: per confronti tra progetti, campagne, ecc.
- REPORT: per performance, KPI, metriche.
- RISKS: per identificare problemi, blocchi, criticità.
- SEARCH_DOC: per trovare un documento specifico.
- SYNTHESIZE: per creare nuovi contenuti (email, presentazioni).
- UNKNOWN: se l'intento non è chiaro.

I valori possibili per TIME_RANGE sono: 'today', 'yesterday', 'week', 'month', 'quarter', 'year', o un intervallo di date specifico (YYYY-MM-DD to YYYY-MM-DD), o null se non specificato.

Estrai nomi di progetti, nomi di clienti e argomenti generali.

Esempio: "qual è lo stato del progetto-x per il cliente-y questa settimana?"
{
  "action": "STATUS",
  "time_range": "week",
  "entities": {
    "projects": ["progetto-x"],
    "clients": ["cliente-y"],
    "topics": []
  }
}

Ora, analizza la query: "${q}"
Fornisci solo il JSON come risposta.`;

  try {
    const rawResult = await claudeRequest(CLAUDE_MODEL_UTILITY, prompt, 800, 0);
    const jsonStart = rawResult.indexOf('{');
    const jsonEnd = rawResult.lastIndexOf('}');
    if (jsonStart === -1 || jsonEnd === -1) {
        throw new Error('AI intent parser returned invalid JSON.');
    }
    const jsonResult = JSON.parse(rawResult.substring(jsonStart, jsonEnd + 1));
    return { ...jsonResult, raw: q };
  } catch(e) {
    console.error("Error parsing intent with AI:", e);
    // Fallback or rethrow
    throw new Error('Failed to parse intent using AI.');
  }
}

module.exports = { parseIntent };
