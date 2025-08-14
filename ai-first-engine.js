// ai-first-engine.js - AI-First approach: let Claude handle ALL the intelligence
const axios = require('axios');

class AIFirstEngine {
  constructor() {
    this.claudeApiKey = process.env.CLAUDE_API_KEY;
    this.modelId = process.env.CLAUDE_MODEL || 'claude-3-sonnet-20241022';
  }

  /**
   * Main entry point - delegate ALL intelligence to Claude
   * No hardcoding, no patterns, just pure AI intelligence
   */
  async processQuery(userQuery, context) {
    try {
      // Step 1: Ask Claude to analyze the query and determine what's needed
      console.log('🤖 AI analyzing query:', userQuery);
      const analysis = await this.analyzeQueryWithAI(userQuery, context);
      
      // Step 2: Fetch data based on Claude's analysis
      console.log('📊 Fetching data based on AI analysis...');
      const relevantData = await this.fetchDataBasedOnAIAnalysis(analysis, context);
      
      // Step 3: Let Claude generate the final response with the data
      console.log('✨ Generating AI response...');
      const response = await this.generateResponseWithAI(userQuery, relevantData, analysis, context);
      
      return response;
    } catch (error) {
      console.error('AI-First Engine error:', error);
      throw error;
    }
  }

  /**
   * Let Claude analyze the query and tell us what to fetch
   * NO HARDCODED PATTERNS - Claude understands everything
   */
  async analyzeQueryWithAI(userQuery, context) {
    const prompt = `You are analyzing a user query to determine what data sources and information are needed.
This is for 56k Agency, a digital marketing agency.

User Query: "${userQuery}"

Available Data Sources:
- ClickUp: tasks, projects, team workload, deadlines, time tracking, project status
- Google Drive: documents, contracts, briefs, reports, presentations, client files
- Both: for cross-platform analysis

Analyze this query and respond with ONLY a valid JSON object in this exact format:
{
  "intent": "brief description of what the user wants",
  "requiresData": true or false,
  "dataSources": ["clickup", "drive", "both", or "none"],
  "searchParameters": {
    "clickup": {
      "needed": true or false,
      "filters": {
        "status": "open/closed/all",
        "dateRange": "today/tomorrow/week/month/all",
        "priority": "urgent/high/normal/all",
        "assignee": "specific person or all"
      },
      "lookingFor": "what to search in tasks"
    },
    "drive": {
      "needed": true or false,
      "searchTerms": ["terms to search"],
      "documentTypes": ["contracts", "briefs", "reports", "any"],
      "dateFilter": "recent/today/week/month/all"
    }
  },
  "entities": {
    "projects": ["any project names mentioned"],
    "clients": ["any client names mentioned"],
    "people": ["any person names mentioned"],
    "brands": ["any brand/product names mentioned"],
    "dates": ["any dates or time periods mentioned"],
    "keywords": ["important keywords from the query"]
  },
  "context": {
    "urgency": "high/medium/low",
    "isQuestion": true or false,
    "needsAnalysis": true or false,
    "isReportRequest": true or false
  },
  "language": "it" or "en"
}

IMPORTANT: Respond ONLY with the JSON object, no other text.`;

    try {
      const response = await axios.post('https://api.anthropic.com/v1/messages', {
        model: this.modelId,
        max_tokens: 1500,
        temperature: 0.2, // Low temperature for consistent JSON
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      }, {
        headers: {
          'x-api-key': this.claudeApiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        }
      });

      const aiResponse = response.data.content[0].text;
      
      // Clean the response (remove any markdown formatting if present)
      const cleanJson = aiResponse.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      
      try {
        const analysis = JSON.parse(cleanJson);
        console.log('📋 AI Analysis:', JSON.stringify(analysis, null, 2));
        return analysis;
      } catch (parseError) {
        console.error('Failed to parse AI analysis:', parseError);
        console.log('Raw response:', aiResponse);
        // Fallback to basic analysis
        return this.getFallbackAnalysis(userQuery);
      }
      
    } catch (error) {
      console.error('AI Analysis error:', error.response?.data || error.message);
      return this.getFallbackAnalysis(userQuery);
    }
  }

  /**
   * Fallback analysis if AI fails
   */
  getFallbackAnalysis(query) {
    return {
      intent: "general query",
      requiresData: true,
      dataSources: ["both"],
      searchParameters: {
        clickup: { needed: true, filters: { status: "all" } },
        drive: { needed: true, searchTerms: query.split(' ').filter(w => w.length > 3) }
      },
      entities: { keywords: query.split(' ') },
      context: { urgency: "medium", isQuestion: true, needsAnalysis: true },
      language: "it"
    };
  }

  /**
   * Fetch data based on what Claude told us we need
   */
  async fetchDataBasedOnAIAnalysis(analysis, context) {
    const data = {
      clickup: null,
      drive: null,
      metadata: analysis
    };

    // Only fetch if Claude says we need data
    if (!analysis.requiresData) {
      console.log('ℹ️ AI determined no data fetching needed');
      return data;
    }

    // Fetch ClickUp data if needed
    if (analysis.searchParameters?.clickup?.needed && context.clickupToken) {
      console.log('📌 Fetching ClickUp data...');
      data.clickup = await this.fetchClickUpData(analysis, context);
    }

    // Fetch Drive data if needed
    if (analysis.searchParameters?.drive?.needed && context.googleAccessToken) {
      console.log('📁 Fetching Drive data...');
      data.drive = await this.fetchDriveData(analysis, context);
    }

    return data;
  }

  /**
   * Fetch ClickUp data based on AI analysis
   */
  async fetchClickUpData(analysis, context) {
    if (!context.clickupToken || !context.teamId) {
      console.log('⚠️ ClickUp not configured');
      return null;
    }

    try {
      // Build query based on AI analysis
      const params = {
        page: 0,
        subtasks: true
      };

      // Apply filters based on AI analysis
      const filters = analysis.searchParameters.clickup.filters;
      
      if (filters.status !== 'all') {
        params.statuses = filters.status === 'open' ? ['open'] : ['closed'];
      }

      // Date filtering
      if (filters.dateRange && filters.dateRange !== 'all') {
        const now = Date.now();
        switch(filters.dateRange) {
          case 'today':
            params.due_date_gt = new Date().setHours(0,0,0,0);
            params.due_date_lt = new Date().setHours(23,59,59,999);
            break;
          case 'tomorrow':
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            params.due_date_gt = tomorrow.setHours(0,0,0,0);
            params.due_date_lt = tomorrow.setHours(23,59,59,999);
            break;
          case 'week':
            params.due_date_lt = now + (7 * 24 * 60 * 60 * 1000);
            break;
          case 'month':
            params.due_date_lt = now + (30 * 24 * 60 * 60 * 1000);
            break;
        }
      }

      // Priority filtering
      if (filters.priority && filters.priority !== 'all') {
        params.priority = filters.priority;
      }

      console.log('ClickUp API params:', params);

      const response = await axios.get(`https://api.clickup.com/api/v2/team/${context.teamId}/task`, {
        headers: { 'Authorization': context.clickupToken },
        params
      });

      const tasks = response.data.tasks || [];
      console.log(`✅ Found ${tasks.length} ClickUp tasks`);
      
      return tasks;
      
    } catch (error) {
      console.error('ClickUp fetch error:', error.response?.data || error.message);
      return null;
    }
  }

  /**
   * Fetch Drive data based on AI analysis
   */
  async fetchDriveData(analysis, context) {
    if (!context.googleAccessToken) {
      console.log('⚠️ Google Drive not configured');
      return null;
    }

    try {
      const searchParams = analysis.searchParameters.drive;
      const allResults = [];

      // Build search queries from AI analysis
      const searchTerms = searchParams.searchTerms || [];
      
      // Execute searches for each term
      for (const term of searchTerms.slice(0, 3)) { // Limit to 3 searches
        let query = `name contains '${term}'`;
        
        // Add date filter if specified
        if (searchParams.dateFilter && searchParams.dateFilter !== 'all') {
          const dateFilter = this.getDateFilterForDrive(searchParams.dateFilter);
          if (dateFilter) {
            query += ` and ${dateFilter}`;
          }
        }

        console.log(`🔍 Drive search: ${query}`);

        const response = await axios.get('https://www.googleapis.com/drive/v3/files', {
          headers: { 'Authorization': `Bearer ${context.googleAccessToken}` },
          params: {
            q: query,
            orderBy: 'modifiedTime desc',
            pageSize: 10,
            fields: 'files(id,name,mimeType,modifiedTime,webViewLink,size,owners)'
          }
        });
        
        if (response.data.files) {
          allResults.push(...response.data.files);
        }
      }

      // Remove duplicates
      const uniqueResults = Array.from(new Map(allResults.map(f => [f.id, f])).values());
      console.log(`✅ Found ${uniqueResults.length} Drive documents`);
      
      return uniqueResults;
      
    } catch (error) {
      console.error('Drive fetch error:', error.response?.data || error.message);
      return null;
    }
  }

  /**
   * Helper to get date filter for Drive API
   */
  getDateFilterForDrive(dateFilter) {
    const now = new Date();
    let filterDate;

    switch(dateFilter) {
      case 'recent':
      case 'week':
        filterDate = new Date(now.setDate(now.getDate() - 7));
        break;
      case 'today':
        filterDate = new Date(now.setHours(0,0,0,0));
        break;
      case 'month':
        filterDate = new Date(now.setMonth(now.getMonth() - 1));
        break;
      default:
        return null;
    }

    return `modifiedTime > '${filterDate.toISOString()}'`;
  }

  /**
   * Generate final response using Claude with all the fetched data
   */
  async generateResponseWithAI(originalQuery, data, analysis, context) {
    // Build context with fetched data
    let dataContext = '';
    
    if (data.clickup && data.clickup.length > 0) {
      dataContext += '\n\n### ClickUp Tasks Data:\n';
      dataContext += this.formatClickUpDataForAI(data.clickup);
    }
    
    if (data.drive && data.drive.length > 0) {
      dataContext += '\n\n### Google Drive Documents:\n';
      dataContext += this.formatDriveDataForAI(data.drive);
    }

    if (!dataContext) {
      dataContext = '\n\nNo specific data was found for this query.';
    }

    const prompt = `You are the AI Executive Assistant for 56k Agency, a digital marketing agency.
Your role is to provide intelligent, actionable insights based on the user's query and available data.

Today's date: ${new Date().toLocaleDateString('it-IT', { 
  weekday: 'long', 
  year: 'numeric', 
  month: 'long', 
  day: 'numeric' 
})}

USER QUERY: "${originalQuery}"

QUERY ANALYSIS:
Intent: ${analysis.intent}
Language: ${analysis.language}
Urgency: ${analysis.context.urgency}
Needs Analysis: ${analysis.context.needsAnalysis}

AVAILABLE DATA:${dataContext}

INSTRUCTIONS:
1. Respond in ${analysis.language === 'it' ? 'Italian' : 'English'}
2. Provide a comprehensive, executive-level response
3. If data is available, analyze it and provide insights, not just lists
4. Identify patterns, risks, and opportunities
5. Suggest actionable next steps when appropriate
6. Use professional but accessible language
7. Format your response with markdown for clarity (use **bold**, lists, etc.)
8. If you detect critical issues (delays, risks), highlight them prominently
9. Focus on business impact and value
10. Be concise but thorough

If the query is about a specific product/brand/client and you found relevant documents, 
provide specific information from those documents.

If no relevant data was found but you can still help with general knowledge or suggestions, do so.

Respond now as the 56k Agency AI Executive Assistant:`;

    try {
      const response = await axios.post('https://api.anthropic.com/v1/messages', {
        model: context.selectedModel || this.modelId,
        max_tokens: 3000,
        temperature: 0.7,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      }, {
        headers: {
          'x-api-key': this.claudeApiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        }
      });

      return response.data.content[0].text;
      
    } catch (error) {
      console.error('Response generation error:', error.response?.data || error.message);
      return 'Mi dispiace, si è verificato un errore nel generare la risposta. Riprova tra qualche istante.';
    }
  }

  /**
   * Format ClickUp data for AI consumption - clean and structured
   */
  formatClickUpDataForAI(tasks) {
    return tasks.slice(0, 25).map(task => {
      const dueDate = task.due_date 
        ? new Date(parseInt(task.due_date)).toLocaleDateString('it-IT') 
        : 'No deadline';
      
      const assignees = task.assignees?.map(a => a.username).join(', ') || 'Unassigned';
      const priority = task.priority?.priority || 'normal';
      const status = task.status?.status || 'unknown';
      
      // Calculate if overdue
      const isOverdue = task.due_date && parseInt(task.due_date) < Date.now();
      const overdueFlag = isOverdue ? ' [OVERDUE]' : '';
      
      return `Task: ${task.name}${overdueFlag}
  Status: ${status}
  Due: ${dueDate}
  Assignees: ${assignees}
  Priority: ${priority}
  Project: ${task.project?.name || task.list?.name || task.space?.name || 'N/A'}
  Tags: ${task.tags?.map(t => t.name).join(', ') || 'None'}`;
    }).join('\n---\n');
  }

  /**
   * Format Drive data for AI consumption - clean and structured
   */
  formatDriveDataForAI(files) {
    return files.slice(0, 20).map(file => {
      const modDate = new Date(file.modifiedTime).toLocaleDateString('it-IT');
      const owner = file.owners?.[0]?.displayName || 'Unknown';
      const size = file.size ? `${(file.size / 1024 / 1024).toFixed(2)} MB` : 'N/A';
      
      return `Document: ${file.name}
  Type: ${this.getFileTypeDescription(file.mimeType)}
  Modified: ${modDate}
  Owner: ${owner}
  Size: ${size}
  Link: ${file.webViewLink}`;
    }).join('\n---\n');
  }

  /**
   * Get human-readable file type description
   */
  getFileTypeDescription(mimeType) {
    const types = {
      'application/vnd.google-apps.document': 'Google Doc',
      'application/vnd.google-apps.spreadsheet': 'Google Sheets',
      'application/vnd.google-apps.presentation': 'Google Slides',
      'application/vnd.google-apps.folder': 'Folder',
      'application/pdf': 'PDF',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Excel',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'PowerPoint',
      'image/jpeg': 'Image (JPEG)',
      'image/png': 'Image (PNG)',
      'video/mp4': 'Video (MP4)'
    };
    return types[mimeType] || mimeType.split('/').pop().toUpperCase();
  }
}

module.exports = AIFirstEngine;
