// synthesizer.js - Conversational answer composer using RAG result (conclusions + support)
const { claudeRequest } = require('../ai/claudeClient');

function buildSupportMap(result){
  const lines = [];
  (result.support||[]).forEach((s,i)=>{ lines.push(`[S${i+1}] ${s.snippet}`); });
  return lines.join('\n');
}

function mapActionToGoal(action){
  switch(action){
    case 'STATUS': return 'status';
    case 'REPORT': return 'report';
    case 'COMPARE': return 'comparison';
    case 'RISKS': return 'risks';
    case 'LIST': return 'listing';
    case 'SEARCH_DOC': return 'doc_search';
    case 'SYNTHESIZE': return 'synthesis';
    default: return 'summary';
  }
}

async function synthesizeConversationalAnswer(query, intent, ragResult, modelId, apiKey){
  const conclusions = (ragResult.conclusions||[]).map(c=> c.text || c);
  const supportMap = buildSupportMap(ragResult);
  const actionGoal = mapActionToGoal(intent.action);
  const prompt = `Sei un assistente aziendale. Rispondi come un collega competente e sintetico.\n`+
`Query utente: "${query}"\n`+
`Action: ${intent.action}\nGoal: ${actionGoal}\nTime range richiesto: ${intent.time_range || 'non specificato'}\n`+
`Entità estratte: progetti=${intent.entities.projects.join(', ')||'n/d'}; clienti=${intent.entities.clients.join(', ')||'n/d'}\n\n`+
`Conclusioni (candidate):\n${conclusions.length? conclusions.map((c,i)=>`[C${i+1}] ${c}`).join('\n'): '(nessuna)'}\n`+
`Evidenze di supporto (non inventare oltre queste):\n${supportMap || '(nessuna)'}\n\n`+
`ISTRUZIONI:\n`+
`1. NON introdurre informazioni non supportate dalle evidenze.\n`+
`2. Se le evidenze sono insufficienti, esplicitalo e proponi quali dati servirebbero.\n`+
`3. Includi una sezione KPI solo se nella query o conclusioni compaiono metriche/numeri.\n`+
`4. Cita sempre le fonti usando (S#) accanto alle frasi rilevanti.\n`+
`5. Output in italiano se la query è in italiano, altrimenti in inglese.\n`+
`6. Struttura output in sezioni: Riepilogo breve, Dettagli, Rischi (se presenti), Prossimi passi, Fonti.\n`+
`7. Evita ridondanze. Tono professionale ma colloquiale.\n\nGenera ora la risposta.`;
  try {
    const text = await claudeRequest(modelId, prompt, 1200, 0.4);
    return text || 'Risposta non generata.';
  } catch(e){
    // Fallback sintetico senza LLM: mostra comunque i risultati RAG
    try {
      const lines = [];
      const items = [];
      if(Array.isArray(ragResult.support) && ragResult.support.length){
        ragResult.support.slice(0,10).forEach((s,i)=>{
          items.push(`- [S${i+1}] ${s.snippet}${s.path? `\n  (${s.path})`:''}`);
        });
      } else if(Array.isArray(ragResult.conclusions) && ragResult.conclusions.length){
        ragResult.conclusions.slice(0,10).forEach((c,i)=> items.push(`- ${c.text||c}`));
      } else if (typeof ragResult.text === 'string' && ragResult.text.trim()){
        items.push(ragResult.text.slice(0,1200));
      }
      const header = '## Riepilogo breve\nRisultati generati senza AI di sintesi (fallback).';
      const body = items.length? `\n\n## Dettagli\n${items.join('\n')}` : '\n\nNessun elemento trovato.';
      const sources = (Array.isArray(ragResult.support) && ragResult.support.length)
        ? ('\n\n## Fonti\n' + ragResult.support.slice(0,10).map((s,i)=>`[S${i+1}] ${s.path||s.id||'fonte'}`).join('\n'))
        : '';
      return `${header}${body}${sources}`;
    } catch(_){
      return 'Errore nella sintesi conversazionale.';
    }
  }
}

module.exports = { synthesizeConversationalAnswer };
