// ai-executive-engine.js - Core AI Executive Assistant Engine
class AIExecutiveEngine {
  constructor() {
    this.agencyContext = {
      name: "56k Agency",
      type: "Digital Marketing Agency",
      focus: "Client projects, team management, document intelligence",
      role: "Executive AI Assistant"
    };
    
    this.currentDate = new Date();
    this.timeContext = this.buildTimeContext();
  }

  buildTimeContext() {
    const today = this.currentDate;
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - today.getDay() + 1);
    
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    
    return {
      today: {
        date: today.toISOString().split('T')[0],
        formatted: today.toLocaleDateString('it-IT', { 
          weekday: 'long', 
          year: 'numeric', 
          month: 'long', 
          day: 'numeric' 
        }),
        dayOfWeek: today.toLocaleDateString('it-IT', { weekday: 'long' })
      },
      tomorrow: {
        date: tomorrow.toISOString().split('T')[0],
        formatted: tomorrow.toLocaleDateString('it-IT', { 
          weekday: 'long', 
          year: 'numeric', 
          month: 'long', 
          day: 'numeric' 
        }),
        dayOfWeek: tomorrow.toLocaleDateString('it-IT', { weekday: 'long' })
      },
      thisWeek: {
        start: weekStart.toISOString().split('T')[0],
        end: new Date(weekStart.getTime() + 6*24*60*60*1000).toISOString().split('T')[0]
      },
      thisMonth: {
        start: monthStart.toISOString().split('T')[0],
        name: monthStart.toLocaleDateString('it-IT', { month: 'long', year: 'numeric' })
      }
    };
  }

  analyzeQueryIntent(query) {
    const normalizedQuery = query.toLowerCase();
    
    // Executive/Strategic Intent
    const isExecutiveQuery = /briefing|dashboard|overview|status|report|analisi|performance|kpi|roi/i.test(normalizedQuery);
    
    // Time-based Intent
    const isTimeQuery = /oggi|domani|settimana|mese|ieri|prossim|scadenz|deadline/i.test(normalizedQuery);
    
    // Project Management Intent  
    const isProjectQuery = /progett|client|task|milestone|budget|delivery|blockers?|rischi?/i.test(normalizedQuery);
    
    // Team Management Intent
    const isTeamQuery = /team|colleghi?|persone?|workload|capacity|chi|sovraccaric|performance/i.test(normalizedQuery);
    
    // Document Intent
    const isDocumentQuery = /document|file|contratt|brief|revision|approv|vademecum|scheda|specifiche/i.test(normalizedQuery);
    
    // Specific Content Intent (new!)
    const isSpecificContentQuery = /è un[ao]?|cosa è|che tipo|posso dire|informazioni su|caratteristiche|specifiche/i.test(normalizedQuery);
    
    // Personal Assistant Intent
    const isPersonalQuery = /cosa.*fare|impegni|agenda|programma|priorit|remind/i.test(normalizedQuery);

    return {
      isExecutiveQuery,
      isTimeQuery, 
      isProjectQuery,
      isTeamQuery,
      isDocumentQuery,
      isSpecificContentQuery,
      isPersonalQuery,
      needsClickUpData: isProjectQuery || isTeamQuery || isPersonalQuery || isTimeQuery,
      needsDriveData: isDocumentQuery || isExecutiveQuery || isSpecificContentQuery,
      queryType: this.determineQueryType(normalizedQuery),
      urgencyLevel: this.assessUrgency(normalizedQuery)
    };
  }

  determineQueryType(query) {
    if (/briefing.*oggi|status.*oggi|cosa.*oggi/i.test(query)) return 'daily_briefing';
    if (/cosa.*fare.*domani|impegni.*domani|agenda.*domani/i.test(query)) return 'tomorrow_agenda';
    if (/progett.*rischi?|rischi?.*progett/i.test(query)) return 'project_risk_analysis';
    if (/team.*performance|performance.*team/i.test(query)) return 'team_analytics';
    if (/client.*portfolio|portfolio.*client/i.test(query)) return 'client_analysis';
    if (/budget|roi|financial/i.test(query)) return 'financial_analysis';
    if (/document.*recen|recen.*document/i.test(query)) return 'document_intelligence';
    if (/è un[ao]?|cosa è|posso dire|specifiche.*di|caratteristiche.*di/i.test(query)) return 'content_specific_query';
    
    return 'general_query';
  }

  assessUrgency(query) {
    if (/urgent|critico|emergenz|subito|asap/i.test(query)) return 'high';
    if (/important|priorit|deadline|scadenz/i.test(query)) return 'medium';
    return 'normal';
  }

  buildExecutivePrompt(originalQuery, contextData, intent) {
    const basePrompt = `Tu sei l'AI Executive Assistant di 56k Agency, una agenzia di digital marketing di alto livello.

**CONTESTO TEMPORALE:**
- Oggi: ${this.timeContext.today.formatted}
- Domani: ${this.timeContext.tomorrow.formatted}

**LA TUA IDENTITÀ:**
- Sei un assistente esecutivo di livello C-suite
- Fornisci insights strategici, non solo dati
- Pensi in termini di business impact e ROI
- Sei proattivo nel suggerire azioni
- Comunichi in modo professionale ma accessibile

**CAPACITÀ DISPONIBILI:**
- Accesso completo a ClickUp (progetti, task, team, timeline)
- Accesso completo a Google Drive (documenti, contratti, brief)
- Analisi cross-platform per insights avanzati
- Capacità di reporting e forecasting

**QUERY ORIGINALE:** "${originalQuery}"

**TIPO QUERY:** ${intent.queryType}
**LIVELLO URGENZA:** ${intent.urgencyLevel}`;

    if (contextData) {
      return `${basePrompt}

**DATI DISPONIBILI:**
${contextData}

**ISTRUZIONI:**
1. Analizza i dati forniti con mentalità executive
2. Identifica patterns, rischi, e opportunità
3. Fornisci insights actionable, non solo elenchi
4. Suggerisci prossimi passi concreti
5. Usa formattazione markdown per chiarezza
6. Se rilevi issues critiche, evidenziale
7. Mantieni focus sul business impact

Rispondi come un senior executive assistant che conosce il business dell'agenzia.`;
    }

    return `${basePrompt}

Anche se non ho dati specifici da analizzare per questa query, rispondi come l'Executive Assistant di 56k Agency, mantenendo il tono professionale e offrendo il miglior supporto possibile basato sulla mia conoscenza del business di agenzia.`;
  }
}

module.exports = AIExecutiveEngine;