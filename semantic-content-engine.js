// semantic-content-engine.js - Smart Content Discovery & Analysis (DEPRECATED)
if (!process.env.ALLOW_LEGACY_ENGINES) {
  throw new Error('semantic-content-engine.js deprecated. Use unified AI First engine in src/engines. Set ALLOW_LEGACY_ENGINES=1 to force load.');
}
const axios = require('axios');

class SemanticContentEngine {
  
  constructor() {
    // Client-Brand mapping for 56k Agency
    this.clientBrandMap = {
      "rimos": {
        brands: ["hypermix"],
        keywords: ["antiparassitario", "prodotto", "vademecum", "scheda"],
        folders: ["rimos", "hypermix"]
      },
      // Add more clients as needed
    };
    
    // Document type patterns
    this.documentTypes = {
      vademecum: ["vademecum", "scheda prodotto", "product sheet"],
      contract: ["contratto", "contract", "agreement"],
      brief: ["brief", "briefing", "requisiti"],
      report: ["report", "analisi", "analytics"],
      presentation: ["presentazione", "slide", "pitch"]
    };
  }

  // Enhanced semantic search for specific queries
  async performSemanticSearch(query, accessToken, intent) {
    try {
      const searchTerms = this.extractSearchTerms(query);
      const searchStrategies = this.buildSearchStrategies(searchTerms);
      
      let allResults = [];
      
      // Execute multiple search strategies
      for (const strategy of searchStrategies) {
        const results = await this.executeSearch(strategy, accessToken);
        allResults = allResults.concat(results);
      }
      
      // Remove duplicates and rank by relevance
      const uniqueResults = this.deduplicateAndRank(allResults, searchTerms);
      
      // If we found relevant documents, try to extract content
      if (uniqueResults.length > 0) {
        return await this.analyzeFoundDocuments(uniqueResults, query, accessToken);
      }
      
      return this.buildNotFoundResponse(searchTerms);
      
    } catch (error) {
      console.error('Semantic search error:', error);
      return null;
    }
  }
  
  extractSearchTerms(query) {
    const normalizedQuery = query.toLowerCase();
    
    // Extract potential brand names, client names, and keywords
    const terms = {
      brands: [],
      clients: [],
      keywords: [],
      documentTypes: [],
      question: normalizedQuery
    };
    
    // Look for known brands and clients
    Object.entries(this.clientBrandMap).forEach(([client, config]) => {
      if (normalizedQuery.includes(client)) {
        terms.clients.push(client);
      }
      
      config.brands.forEach(brand => {
        if (normalizedQuery.includes(brand)) {
          terms.brands.push(brand);
          terms.clients.push(client); // Associate brand with client
        }
      });
      
      config.keywords.forEach(keyword => {
        if (normalizedQuery.includes(keyword)) {
          terms.keywords.push(keyword);
        }
      });
    });
    
    // Extract document types
    Object.entries(this.documentTypes).forEach(([type, patterns]) => {
      patterns.forEach(pattern => {
        if (normalizedQuery.includes(pattern)) {
          terms.documentTypes.push(type);
        }
      });
    });
    
    // Extract generic keywords
    const genericKeywords = normalizedQuery.match(/\\b\\w{4,}\\b/g) || [];
    terms.keywords.push(...genericKeywords);
    
    return terms;
  }
  
  buildSearchStrategies(terms) {
    const strategies = [];
    
    // Strategy 1: Brand + Document Type
    if (terms.brands.length > 0 && terms.documentTypes.length > 0) {
      terms.brands.forEach(brand => {
        terms.documentTypes.forEach(docType => {
          strategies.push({
            type: 'brand_document',
            query: `name contains '${brand}' and (${this.documentTypes[docType].map(t => `name contains '${t}'`).join(' or ')})`,
            priority: 10,
            description: `${brand} ${docType}`
          });
        });
      });
    }
    
    // Strategy 2: Client folder search
    if (terms.clients.length > 0) {
      terms.clients.forEach(client => {
        const clientConfig = this.clientBrandMap[client];
        if (clientConfig && clientConfig.folders) {
          clientConfig.folders.forEach(folder => {
            strategies.push({
              type: 'client_folder',
              query: `name contains '${folder}'`,
              priority: 8,
              description: `${client} folder`
            });
          });
        }
      });
    }
    
    // Strategy 3: Brand-specific search
    if (terms.brands.length > 0) {
      terms.brands.forEach(brand => {
        strategies.push({
          type: 'brand_specific',
          query: `name contains '${brand}'`,
          priority: 7,
          description: `${brand} documents`
        });
      });
    }
    
    // Strategy 4: Keyword combination
    if (terms.keywords.length > 1) {
      const keywordQuery = terms.keywords.slice(0, 3).map(k => `name contains '${k}'`).join(' and ');
      strategies.push({
        type: 'keyword_combination',
        query: keywordQuery,
        priority: 6,
        description: `multiple keywords`
      });
    }
    
    // Strategy 5: Recent documents with keywords
    if (terms.keywords.length > 0) {
      const recentDate = new Date();
      recentDate.setMonth(recentDate.getMonth() - 3); // Last 3 months
      
      terms.keywords.slice(0, 2).forEach(keyword => {
        strategies.push({
          type: 'recent_keyword',
          query: `name contains '${keyword}' and modifiedTime >= '${recentDate.toISOString().split('T')[0]}'`,
          priority: 5,
          description: `recent ${keyword}`
        });
      });
    }
    
    return strategies.sort((a, b) => b.priority - a.priority);
  }
  
  async executeSearch(strategy, accessToken) {
    try {
      const response = await axios.get('https://www.googleapis.com/drive/v3/files', {
        headers: { 'Authorization': `Bearer ${accessToken}` },
        params: {
          q: strategy.query,
          orderBy: 'relevance',
          pageSize: 10,
          fields: 'files(id,name,mimeType,modifiedTime,owners,size,parents,webViewLink,description)'
        }
      });
      
      return (response.data.files || []).map(file => ({
        ...file,
        searchStrategy: strategy.type,
        searchDescription: strategy.description,
        relevanceScore: strategy.priority
      }));
      
    } catch (error) {
      console.error(`Search strategy ${strategy.type} failed:`, error);
      return [];
    }
  }
  
  deduplicateAndRank(results, terms) {
    // Remove duplicates by file ID
    const unique = results.filter((file, index, self) => 
      index === self.findIndex(f => f.id === file.id)
    );
    
    // Calculate relevance scores
    return unique.map(file => {
      let score = file.relevanceScore || 0;
      
      // Boost score based on name matching
      const fileName = file.name.toLowerCase();
      
      terms.brands.forEach(brand => {
        if (fileName.includes(brand)) score += 5;
      });
      
      terms.keywords.forEach(keyword => {
        if (fileName.includes(keyword)) score += 2;
      });
      
      // Boost for specific document types
      Object.entries(this.documentTypes).forEach(([type, patterns]) => {
        patterns.forEach(pattern => {
          if (fileName.includes(pattern)) score += 3;
        });
      });
      
      return { ...file, finalRelevanceScore: score };
    }).sort((a, b) => b.finalRelevanceScore - a.finalRelevanceScore);
  }
  
  async analyzeFoundDocuments(documents, originalQuery, accessToken) {
    let analysis = `**🔍 SEMANTIC SEARCH RESULTS**\\n\\n`;
    analysis += `Ho trovato ${documents.length} documenti rilevanti per la tua domanda: "${originalQuery}"\\n\\n`;
    
    // Analyze top results
    const topDocs = documents.slice(0, 5);
    
    for (let i = 0; i < topDocs.length; i++) {
      const doc = topDocs[i];
      analysis += `**${i + 1}. ${doc.name}**\\n`;
      analysis += `   📁 Strategia: ${doc.searchDescription}\\n`;
      analysis += `   📅 Modificato: ${new Date(doc.modifiedTime).toLocaleDateString('it-IT')}\\n`;
      analysis += `   👤 Proprietario: ${doc.owners?.[0]?.displayName || 'Sconosciuto'}\\n`;
      
      // Try to extract content if it's a Google Doc
      if (doc.mimeType === 'application/vnd.google-apps.document') {
        try {
          const content = await this.extractGoogleDocContent(doc.id, accessToken);
          if (content) {
            const relevantSnippet = this.findRelevantSnippet(content, originalQuery);
            if (relevantSnippet) {
              analysis += `   📝 Contenuto rilevante: "${relevantSnippet}"\\n`;
            }
          }
        } catch (error) {
          analysis += `   📝 Contenuto: Documento trovato (lettura contenuto in sviluppo)\\n`;
        }
      } else {
        analysis += `   📝 Tipo: ${this.getDocumentTypeDescription(doc.mimeType)}\\n`;
      }
      
      analysis += `   🔗 [Apri documento](${doc.webViewLink})\\n\\n`;
    }
    
    // Provide intelligent conclusion
    analysis += this.generateIntelligentConclusion(documents, originalQuery);
    
    return analysis;
  }
  
  async extractGoogleDocContent(documentId, accessToken) {
    try {
      const response = await axios.get(`https://docs.googleapis.com/v1/documents/${documentId}`, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      });
      
      // Extract text content from Google Docs structure
      let content = '';
      if (response.data.body && response.data.body.content) {
        response.data.body.content.forEach(element => {
          if (element.paragraph && element.paragraph.elements) {
            element.paragraph.elements.forEach(textElement => {
              if (textElement.textRun && textElement.textRun.content) {
                content += textElement.textRun.content;
              }
            });
          }
        });
      }
      
      return content;
    } catch (error) {
      return null;
    }
  }
  
  findRelevantSnippet(content, query) {
    const queryTerms = query.toLowerCase().split(/\\s+/);
    const sentences = content.split(/[.!?]+/);
    
    // Find sentences containing query terms
    for (const sentence of sentences) {
      const lowerSentence = sentence.toLowerCase();
      const matchCount = queryTerms.filter(term => lowerSentence.includes(term)).length;
      
      if (matchCount >= Math.min(2, queryTerms.length)) {
        return sentence.trim().substring(0, 200) + (sentence.length > 200 ? '...' : '');
      }
    }
    
    return null;
  }
  
  generateIntelligentConclusion(documents, query) {
    let conclusion = `**💡 ANALISI INTELLIGENTE:**\\n`;
    
    if (documents.length === 0) {
      conclusion += `Non ho trovato documenti specifici per questa domanda. Suggerisco di:\\n`;
      conclusion += `- Verificare se il documento esiste con un nome diverso\\n`;
      conclusion += `- Controllare se è stato archiviato o spostato\\n`;
      conclusion += `- Contattare il team per maggiori informazioni\\n`;
    } else if (documents.length === 1) {
      conclusion += `Ho trovato un documento altamente rilevante. `;
      conclusion += `Consiglio di esaminare il contenuto per ottenere la risposta specifica.\\n`;
    } else {
      conclusion += `Ho trovato ${documents.length} documenti potenzialmente rilevanti. `;
      conclusion += `Il primo risultato sembra il più pertinente alla tua domanda.\\n`;
      
      // Check if we found vademecum or technical docs
      const technicalDocs = documents.filter(doc => 
        /vademecum|scheda|technical|spec/i.test(doc.name)
      );
      
      if (technicalDocs.length > 0) {
        conclusion += `\\n🎯 **RACCOMANDAZIONE**: Il documento "${technicalDocs[0].name}" `;
        conclusion += `sembra contenere le informazioni tecniche che stai cercando.\\n`;
      }
    }
    
    return conclusion;
  }
  
  getDocumentTypeDescription(mimeType) {
    const typeMap = {
      'application/pdf': 'PDF',
      'application/vnd.google-apps.document': 'Google Doc',
      'application/vnd.google-apps.spreadsheet': 'Google Sheets',
      'application/vnd.google-apps.presentation': 'Google Slides',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word Document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Excel Document'
    };
    
    return typeMap[mimeType] || 'Documento';
  }
  
  buildNotFoundResponse(terms) {
    let response = `**🔍 RICERCA SEMANTICA COMPLETATA**\\n\\n`;
    response += `Non ho trovato documenti specifici per i termini cercati:\\n`;
    
    if (terms.brands.length > 0) {
      response += `- Brand: ${terms.brands.join(', ')}\\n`;
    }
    if (terms.clients.length > 0) {
      response += `- Cliente: ${terms.clients.join(', ')}\\n`;
    }
    if (terms.keywords.length > 0) {
      response += `- Keywords: ${terms.keywords.slice(0, 5).join(', ')}\\n`;
    }
    
    response += `\\n**💡 SUGGERIMENTI:**\\n`;
    response += `- Verifica se il documento è stato rinominato\\n`;
    response += `- Controlla cartelle di altri progetti simili\\n`;
    response += `- Il documento potrebbe essere in una cartella condivisa esterna\\n`;
    response += `- Contatta il team per verificare la posizione del file\\n`;
    
    return response;
  }
}

module.exports = SemanticContentEngine;