// business-intelligence.js - Advanced BI for Digital Agency
const axios = require('axios');
const SemanticContentEngine = require('./semantic-content-engine');

class BusinessIntelligence {
  
  // Enhanced ClickUp data collection for agency context
  static async getProjectIntelligence(query, clickupToken, intent) {
    try {
      const teamsResponse = await axios.get('https://api.clickup.com/api/v2/team', {
        headers: { 'Authorization': clickupToken }
      });
      
      if (!teamsResponse.data.teams?.length) {
        return 'Nessun team ClickUp trovato.';
      }
      
      const teamId = teamsResponse.data.teams[0].id;
      const today = new Date();
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      
      // Collect comprehensive project data
      const [spaces, tasks, timeEntries] = await Promise.all([
        this.getSpaces(teamId, clickupToken),
        this.getTasks(teamId, clickupToken, intent),
        this.getTimeTracking(teamId, clickupToken)
      ]);
      
      return this.formatProjectIntelligence(spaces, tasks, timeEntries, intent);
      
    } catch (error) {
      console.error('Project intelligence error:', error);
      return null;
    }
  }
  
  static async getSpaces(teamId, clickupToken) {
    const response = await axios.get(`https://api.clickup.com/api/v2/team/${teamId}/space`, {
      headers: { 'Authorization': clickupToken }
    });
    return response.data.spaces || [];
  }
  
  static async getTasks(teamId, clickupToken, intent) {
    const params = {
      page: 0,
      order_by: 'due_date',
      reverse: false,
      subtasks: true,
      include_closed: false
    };
    
    // Adjust query based on intent
    if (intent.queryType === 'tomorrow_agenda') {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      params.due_date_gt = tomorrow.getTime();
      params.due_date_lt = tomorrow.getTime() + 24*60*60*1000;
    } else if (intent.queryType === 'project_risk_analysis') {
      params.include_closed = false;
      // Get overdue tasks
      params.due_date_lt = Date.now();
    }
    
    const response = await axios.get(`https://api.clickup.com/api/v2/team/${teamId}/task`, {
      headers: { 'Authorization': clickupToken },
      params
    });
    
    return response.data.tasks || [];
  }
  
  static async getTimeTracking(teamId, clickupToken) {
    try {
      const oneWeekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
      const response = await axios.get(`https://api.clickup.com/api/v2/team/${teamId}/time_entries`, {
        headers: { 'Authorization': clickupToken },
        params: {
          start_date: oneWeekAgo,
          end_date: Date.now()
        }
      });
      return response.data.data || [];
    } catch (error) {
      return [];
    }
  }
  
  static formatProjectIntelligence(spaces, tasks, timeEntries, intent) {
    let intelligence = '';
    
    // Project overview
    const activeProjects = spaces.filter(space => !space.archived);
    intelligence += `**📊 PORTFOLIO OVERVIEW:**\n`;
    intelligence += `- Progetti attivi: ${activeProjects.length}\n`;
    intelligence += `- Task totali: ${tasks.length}\n\n`;
    
    // Project health analysis
    const overdueTasks = tasks.filter(task => 
      task.due_date && parseInt(task.due_date) < Date.now()
    );
    
    const urgentTasks = tasks.filter(task => 
      task.priority && task.priority.priority === 'urgent'
    );
    
    if (overdueTasks.length > 0) {
      intelligence += `🚨 **ALERT - TASK IN RITARDO: ${overdueTasks.length}**\n`;
      overdueTasks.slice(0, 5).forEach(task => {
        const daysLate = Math.floor((Date.now() - parseInt(task.due_date)) / (1000 * 60 * 60 * 24));
        intelligence += `- **${task.name}** (${daysLate} giorni di ritardo)\n`;
        intelligence += `  Cliente: ${this.extractClientFromTask(task)}\n`;
        intelligence += `  Assegnato: ${task.assignees?.map(a => a.username).join(', ') || 'Non assegnato'}\n\n`;
      });
    }
    
    // Team workload analysis
    const teamWorkload = this.analyzeTeamWorkload(tasks);
    if (Object.keys(teamWorkload).length > 0) {
      intelligence += `**👥 WORKLOAD ANALYSIS:**\n`;
      Object.entries(teamWorkload).forEach(([person, load]) => {
        const status = load.overdue > 0 ? '🔴' : load.total > 10 ? '🟡' : '🟢';
        intelligence += `${status} **${person}**: ${load.total} task`;
        if (load.overdue > 0) intelligence += ` (${load.overdue} in ritardo)`;
        intelligence += `\n`;
      });
      intelligence += `\n`;
    }
    
    // Time tracking insights
    if (timeEntries.length > 0) {
      const totalHours = timeEntries.reduce((sum, entry) => sum + (entry.duration / 3600000), 0);
      intelligence += `**⏱️ TIME TRACKING (ultima settimana):**\n`;
      intelligence += `- Ore totali trackate: ${totalHours.toFixed(1)}h\n`;
      intelligence += `- Media giornaliera: ${(totalHours / 7).toFixed(1)}h\n\n`;
    }
    
    // Specific intent handling
    if (intent.queryType === 'tomorrow_agenda') {
      const tomorrowTasks = tasks.filter(task => {
        if (!task.due_date) return false;
        const taskDate = new Date(parseInt(task.due_date));
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        return taskDate.toDateString() === tomorrow.toDateString();
      });
      
      if (tomorrowTasks.length > 0) {
        intelligence += `**📅 AGENDA DOMANI:**\n`;
        tomorrowTasks.forEach(task => {
          intelligence += `- **${task.name}**\n`;
          intelligence += `  Cliente: ${this.extractClientFromTask(task)}\n`;
          intelligence += `  Priorità: ${task.priority?.priority || 'Normale'}\n`;
          intelligence += `  Assegnato: ${task.assignees?.map(a => a.username).join(', ') || 'Non assegnato'}\n\n`;
        });
      }
    }
    
    return intelligence;
  }
  
  static analyzeTeamWorkload(tasks) {
    const workload = {};
    
    tasks.forEach(task => {
      if (task.assignees) {
        task.assignees.forEach(assignee => {
          if (!workload[assignee.username]) {
            workload[assignee.username] = { total: 0, overdue: 0, urgent: 0 };
          }
          workload[assignee.username].total++;
          
          if (task.due_date && parseInt(task.due_date) < Date.now()) {
            workload[assignee.username].overdue++;
          }
          
          if (task.priority && task.priority.priority === 'urgent') {
            workload[assignee.username].urgent++;
          }
        });
      }
    });
    
    return workload;
  }
  
  static extractClientFromTask(task) {
    // Try to extract client name from task name, list name, or space name
    const taskName = task.name || '';
    const listName = task.list?.name || '';
    const spaceName = task.space?.name || '';
    
    // Common client extraction patterns for agencies
    const clientPatterns = [
      /Client[e]?\s*:?\s*([^-\[\]]+)/i,
      /^([^-\[\]]+)\s*[-\[\]]/,
      /\[([^\]]+)\]/
    ];
    
    for (const pattern of clientPatterns) {
      const match = taskName.match(pattern) || listName.match(pattern) || spaceName.match(pattern);
      if (match && match[1]) {
        return match[1].trim();
      }
    }
    
    return spaceName || 'Cliente non identificato';
  }
  
  // Enhanced Drive intelligence for agency context
  static async getDocumentIntelligence(query, accessToken, intent) {
    try {
      // Check if this is a specific content query (like "Hypermix è antiparassitario?")
      const isSpecificQuery = this.isSpecificContentQuery(query);
      
      if (isSpecificQuery) {
        // Use semantic search for specific queries
        const semanticEngine = new SemanticContentEngine();
        const semanticResults = await semanticEngine.performSemanticSearch(query, accessToken, intent);
        
        if (semanticResults) {
          return semanticResults;
        }
      }
      
      // Fall back to general document intelligence
      return await this.getGeneralDocumentIntelligence(query, accessToken, intent);
      
    } catch (error) {
      console.error('Document intelligence error:', error);
      return null;
    }
  }
  
  static isSpecificContentQuery(query) {
    // Detect if user is asking about specific product/brand information
    const specificPatterns = [
      /è un[ao]?\s+\w+\?/, // "è un antiparassitario?"
      /cosa è\s+\w+/, // "cosa è Hypermix"
      /che tipo\s+di/, // "che tipo di prodotto"
      /posso dire che/, // "posso dire che..."
      /\w+\s+(è|sono)\s+\w+/, // "Hypermix è..."
      /informazioni su\s+\w+/, // "informazioni su..."
      /caratteristiche\s+di/, // "caratteristiche di..."
      /specifiche\s+di/ // "specifiche di..."
    ];
    
    return specificPatterns.some(pattern => pattern.test(query.toLowerCase()));
  }
  
  static async getGeneralDocumentIntelligence(query, accessToken, intent) {
    try {
      let searchQuery = '';
      const today = new Date();
      
      // Build intelligent search based on intent
      if (intent.queryType === 'daily_briefing') {
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        searchQuery = `modifiedTime >= '${yesterday.toISOString().split('T')[0]}'`;
      } else if (intent.queryType === 'document_intelligence') {
        const weekAgo = new Date(today);
        weekAgo.setDate(weekAgo.getDate() - 7);
        searchQuery = `modifiedTime >= '${weekAgo.toISOString().split('T')[0]}'`;
      } else {
        // Default: recent files
        const threeDaysAgo = new Date(today);
        threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
        searchQuery = `modifiedTime >= '${threeDaysAgo.toISOString().split('T')[0]}'`;
      }
      
      const response = await axios.get('https://www.googleapis.com/drive/v3/files', {
        headers: { 'Authorization': `Bearer ${accessToken}` },
        params: {
          q: searchQuery,
          orderBy: 'modifiedTime desc',
          pageSize: 20,
          fields: 'files(id,name,mimeType,modifiedTime,owners,size,parents,webViewLink)'
        }
      });
      
      if (!response.data.files?.length) {
        return 'Nessun documento recente trovato.';
      }
      
      return this.formatDocumentIntelligence(response.data.files, intent);
      
    } catch (error) {
      console.error('Document intelligence error:', error);
      return null;
    }
  }
  
  static formatDocumentIntelligence(files, intent) {
    let intelligence = '';
    
    // Categorize documents by type and relevance
    const categories = this.categorizeDocuments(files);
    
    intelligence += `**📄 DOCUMENT INTELLIGENCE:**\n`;
    intelligence += `Documenti analizzati: ${files.length}\n\n`;
    
    // Contracts and important docs
    if (categories.contracts.length > 0) {
      intelligence += `**📋 CONTRATTI E DOCUMENTI LEGALI:**\n`;
      categories.contracts.forEach(doc => {
        const modDate = new Date(doc.modifiedTime).toLocaleDateString('it-IT');
        intelligence += `- **${doc.name}** (modificato ${modDate})\n`;
      });
      intelligence += `\n`;
    }
    
    // Briefs and proposals  
    if (categories.briefs.length > 0) {
      intelligence += `**📝 BRIEF E PROPOSTE:**\n`;
      categories.briefs.forEach(doc => {
        const modDate = new Date(doc.modifiedTime).toLocaleDateString('it-IT');
        intelligence += `- **${doc.name}** (modificato ${modDate})\n`;
      });
      intelligence += `\n`;
    }
    
    // Reports and analytics
    if (categories.reports.length > 0) {
      intelligence += `**📊 REPORT E ANALYTICS:**\n`;
      categories.reports.forEach(doc => {
        const modDate = new Date(doc.modifiedTime).toLocaleDateString('it-IT');
        intelligence += `- **${doc.name}** (modificato ${modDate})\n`;
      });
      intelligence += `\n`;
    }
    
    // Recent activity summary
    const todayDocs = files.filter(file => {
      const fileDate = new Date(file.modifiedTime);
      const today = new Date();
      return fileDate.toDateString() === today.toDateString();
    });
    
    if (todayDocs.length > 0) {
      intelligence += `**🔥 ATTIVITÀ OGGI:**\n`;
      intelligence += `${todayDocs.length} documenti modificati oggi\n\n`;
    }
    
    return intelligence;
  }
  
  static categorizeDocuments(files) {
    const categories = {
      contracts: [],
      briefs: [],
      reports: [],
      presentations: [],
      other: []
    };
    
    files.forEach(file => {
      const name = file.name.toLowerCase();
      
      if (/contract|contratt|agreement|accordo/i.test(name)) {
        categories.contracts.push(file);
      } else if (/brief|proposal|proposta|preventivo/i.test(name)) {
        categories.briefs.push(file);
      } else if (/report|analisi|analytics|dashboard/i.test(name)) {
        categories.reports.push(file);
      } else if (/presentation|presenta|slide|ppt/i.test(name)) {
        categories.presentations.push(file);
      } else {
        categories.other.push(file);
      }
    });
    
    return categories;
  }
}

module.exports = BusinessIntelligence;