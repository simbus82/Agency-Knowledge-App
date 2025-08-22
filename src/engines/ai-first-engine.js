// src/engines/ai-first-engine.js - Consolidated AI-First engine (single source of truth)
const axios = require('axios');

class AIFirstEngine {
	constructor() {
		this.claudeApiKey = process.env.CLAUDE_API_KEY;
		this.modelId = process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514';
	}

	mapLegacyModel(id){
		const map = { 'claude-3-sonnet-20241022':'claude-sonnet-4-20250514', 'sonnet-20241022':'claude-sonnet-4-20250514' };
		return map[id] || id;
	}

	async processQuery(messages, context) {
		try {
			if(context && context.selectedModel){ this.modelId = this.mapLegacyModel(context.selectedModel); }
			const { latestUserMessage, conversationSummary } = await this.buildConversationMemory(messages);
			console.log('🤖 AI analyzing query:', latestUserMessage);
			const analysis = await this.analyzeQueryWithAI(latestUserMessage, context, conversationSummary);
			console.log('📊 Fetching data based on AI analysis...');
			const relevantData = await this.fetchDataBasedOnAIAnalysis(analysis, context, latestUserMessage);
			console.log('✨ Generating AI response...');
			const response = await this.generateResponseWithAI(latestUserMessage, relevantData, analysis, context, conversationSummary);
			return response;
		} catch (error) {
			console.error('AI-First Engine error:', error);
			throw error;
		}
	}

	async analyzeQueryWithAI(userQuery, context, conversationSummary='') {
		const prompt = `You are analyzing a user query (with prior conversation context) to determine what data sources and information are needed.
This is for 56k Agency, a digital marketing agency.

The user asking the query is:
- Name: ${context.userName}
- Email: ${context.userEmail}

Previous conversation (summary or recent turns):\n${conversationSummary || 'No prior context'}\n\nWhen the user says "me", "my", "io", "miei", they are referring to this user.

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
				"assignee": "specific person, 'currentUser', or 'all'"
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
				temperature: 0.2,
				messages: [ { role: 'user', content: prompt } ]
			}, {
				headers: {
					'x-api-key': this.claudeApiKey,
					'anthropic-version': '2023-06-01',
					'content-type': 'application/json'
				}
			});
			const aiResponse = response.data.content[0].text;
			const cleanJson = aiResponse.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
			try {
				const analysis = JSON.parse(cleanJson);
				console.log('📋 AI Analysis:', JSON.stringify(analysis, null, 2));
				return analysis;
			} catch (parseError) {
				console.error('Failed to parse AI analysis:', parseError);
				console.log('Raw response:', aiResponse);
				return this.getFallbackAnalysis(userQuery);
			}
		} catch (error) {
			console.error('AI Analysis error:', error.response?.data || error.message);
			return this.getFallbackAnalysis(userQuery);
		}
	}

	getFallbackAnalysis(query) {
		return {
			intent: 'general query',
			requiresData: true,
			dataSources: ['both'],
			searchParameters: {
				clickup: { needed: true, filters: { status: 'all' } },
				drive: { needed: true, searchTerms: query.split(' ').filter(w => w.length > 3) }
			},
			entities: { keywords: query.split(' ') },
			context: { urgency: 'medium', isQuestion: true, needsAnalysis: true },
			language: 'it'
		};
	}

	async fetchDataBasedOnAIAnalysis(analysis, context, originalQuery='') {
		const data = { clickup: null, drive: null, metadata: analysis };
		if (!analysis.requiresData) { console.log('ℹ️ AI determined no data fetching needed'); return data; }
		if (analysis.searchParameters?.clickup?.needed && context.clickupToken) {
			console.log('📌 Fetching ClickUp data...');
			data.clickup = await this.fetchClickUpData(analysis, context);
		}
		if (analysis.searchParameters?.drive?.needed && context.googleAccessToken) {
			console.log('📁 Fetching Drive data...');
			data.drive = await this.fetchDriveData(analysis, context, originalQuery);
		}
		return data;
	}

	getDateFilterForDrive(dateFilter) {
		const now = new Date(); let filterDate;
		switch(dateFilter) {
			case 'recent':
			case 'week': filterDate = new Date(now.setDate(now.getDate() - 7)); break;
			case 'today': filterDate = new Date(now.setHours(0,0,0,0)); break;
			case 'month': filterDate = new Date(now.setMonth(now.getMonth() - 1)); break;
			default: return null;
		}
		return `modifiedTime > '${filterDate.toISOString()}'`;
	}

	msToHuman(ms) {
		if (!ms || isNaN(ms)) return '0m';
		const totalMinutes = Math.round(ms / 1000 / 60);
		const hours = Math.floor(totalMinutes / 60);
		const minutes = totalMinutes % 60;
		return `${hours > 0 ? hours + 'h ' : ''}${minutes}m`.trim();
	}

	truncateText(text, maxChars = 1000) {
		if (!text) return '';
		if (text.length <= maxChars) return text;
		return text.slice(0, maxChars - 3) + '...';
	}

	async fetchClickUpData(analysis, context) {
		if (!context.clickupToken || !context.teamId) { console.log('⚠️ ClickUp not configured'); return null; }
		try {
			const params = { page: 0, subtasks: true };
			const filters = analysis.searchParameters.clickup.filters;
			if (filters.assignee && filters.assignee === 'currentUser') {
				try {
					const userResponse = await axios.get('https://api.clickup.com/api/v2/user', { headers: { 'Authorization': context.clickupToken } });
					const clickupUserId = userResponse.data.user.id;
						if (clickupUserId) { params.assignees = [clickupUserId]; console.log(`ℹ️ Filtering tasks for current user: ${context.userName} (ID: ${clickupUserId})`); }
				} catch (error) { console.error('Could not fetch ClickUp user ID', error.message); }
			}
			if (filters.status !== 'all') { params.statuses = filters.status === 'open' ? ['open'] : ['closed']; }
			if (filters.dateRange && filters.dateRange !== 'all') {
				const now = Date.now();
				switch(filters.dateRange) {
					case 'today': params.due_date_gt = new Date().setHours(0,0,0,0); params.due_date_lt = new Date().setHours(23,59,59,999); break;
					case 'tomorrow': const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1); params.due_date_gt = tomorrow.setHours(0,0,0,0); params.due_date_lt = tomorrow.setHours(23,59,59,999); break;
					case 'week': params.due_date_lt = now + (7 * 24 * 60 * 60 * 1000); break;
					case 'month': params.due_date_lt = now + (30 * 24 * 60 * 60 * 1000); break;
				}
			}
			if (filters.priority && filters.priority !== 'all') { params.priority = filters.priority; }
			console.log('ClickUp API params:', params);
			const response = await axios.get(`https://api.clickup.com/api/v2/team/${context.teamId}/task`, { headers: { 'Authorization': context.clickupToken }, params });
			let tasks = response.data.tasks || [];
			console.log(`✅ Found ${tasks.length} ClickUp tasks`);
			if (tasks.length > 0 && tasks.length <= 3) {
				for (let i = 0; i < tasks.length; i++) {
					const t = tasks[i];
					try {
						let details = {};
						try {
							if (context.serverBase) {
								const resp = await axios.get(`${context.serverBase}/api/clickup/task/${t.id}/details`, { withCredentials: true });
								details = resp.data || {};
							} else {
								const detailResp = await axios.get(`https://api.clickup.com/api/v2/task/${t.id}`, { headers: { 'Authorization': context.clickupToken } });
								details = detailResp.data || {};
							}
						} catch (e) {
							console.warn('Falling back to direct ClickUp details fetch', e.message || e);
							try { const detailResp = await axios.get(`https://api.clickup.com/api/v2/task/${t.id}`, { headers: { 'Authorization': context.clickupToken } }); details = detailResp.data || {}; } catch (e2) { details = {}; }
						}
						t.description = details.description || t.description || '';
						t.time_estimate = details.time_estimate || details.estimate || t.time_estimate || 0;
						t.time_spent = details.time_spent || details.time_logged || t.time_spent || 0;
						t.parent = details.parent || t.parent || null;
						t.attachments = details.attachments || t.attachments || [];
						t.url = details.url || t.url || details.short_url || null;
						t.list = details.list || t.list || null;
						try {
							if (context.serverBase) {
								const cResp = await axios.get(`${context.serverBase}/api/clickup/task/${t.id}/comments`, { withCredentials: true });
								t.comments = cResp.data.comments || cResp.data?.comments || [];
								t.comments_count = t.comments.length || cResp.data?.comments?.length || 0;
							} else {
								const commentsResp = await axios.get(`https://api.clickup.com/api/v2/task/${t.id}/comment`, { headers: { 'Authorization': context.clickupToken } });
								t.comments = commentsResp.data.comments || [];
								t.comments_count = t.comments.length;
							}
						} catch (cErr) {
							t.comments = t.comments || [];
							t.comments_count = details?.comment_count || t.comments.length || 0;
							console.warn('Could not fetch full comments for task', t.id, cErr.message || cErr);
						}
					} catch (detailErr) { console.warn('Could not fetch task details for', t.id, detailErr.message || detailErr); }
				}
			} else {
				tasks = tasks.map(t => ({
					...t,
						description: t.description || '',
						time_estimate: t.time_estimate || 0,
						time_spent: t.time_spent || 0,
						attachments: t.attachments || [],
						comments_count: (t.comment_count !== undefined) ? t.comment_count : (t.comments ? t.comments.length : 0),
						url: t.url || t.short_url || null,
						list: t.list || null
				}));
			}
			return tasks;
		} catch (error) { console.error('ClickUp fetch error:', error.response?.data || error.message); return null; }
	}

	// Build prioritized search terms leveraging AI analysis entities (projects/clients/brands) + AI suggested terms + heuristic extraction
	buildDriveSearchTerms(analysis, originalQuery='') {
		// Kept for backward compatibility – now delegated to AI planner
		return [];
	}

	async planDriveSearchWithAI(originalQuery, analysis){
		const planningPrompt = `Sei un assistente che deve pianificare una ricerca su Google Drive per soddisfare la richiesta utente.
Fornisci SOLO JSON valido con questo schema:
{
  "mode": "recency" | "term_search",
  "dateFilter": "today"|"week"|"month"|"all",
  "terms": ["..."] ,
  "explanation": "breve spiegazione (IT)" 
}
Regole:
- Usa mode=recency se l'utente chiede genericamente documenti/file aggiornati/modificati recentemente senza nomi specifici.
- Usa term_search se ci sono nomi progetto, cliente, brand, oppure parole chiave specifiche utili a filtrare.
- terms massimo 6, no parole generiche (documenti, file, oggi, mostra, list, updated, modified, recent, etc.).
- Se mode=recency lascia terms come [].
- dateFilter deriva dalla richiesta (oggi=>today, questa settimana=>week, ultimo mese=>month, altrimenti all).
Richiesta utente: "${originalQuery}".
Analisi AI (estratto): intent=${analysis.intent}; keywords=${(analysis.entities?.keywords||[]).join(', ')}.`;
		try {
			const resp = await axios.post('https://api.anthropic.com/v1/messages', {
				model: this.modelId,
				max_tokens: 400,
				temperature: 0,
				messages: [ { role: 'user', content: planningPrompt } ]
			}, { headers: { 'x-api-key': this.claudeApiKey, 'anthropic-version':'2023-06-01','content-type':'application/json' } });
			const txt = resp.data.content?.[0]?.text || '{}';
			const clean = txt.replace(/```json|```/g,'').trim();
			let plan; try { plan = JSON.parse(clean); } catch { plan = {}; }
			if(!plan.mode){ plan.mode = 'term_search'; }
			if(!['recency','term_search'].includes(plan.mode)) plan.mode='term_search';
			if(!Array.isArray(plan.terms)) plan.terms=[];
			return plan;
		} catch(e){
			return { mode:'term_search', dateFilter: analysis.searchParameters?.drive?.dateFilter || 'all', terms: this.buildDriveSearchTerms(analysis, originalQuery), explanation:'fallback' };
		}
	}

	async fetchDriveData(analysis, context, originalQuery='') {
		if (!context.googleAccessToken) { console.log('⚠️ Google Drive not configured'); return null; }
		try {
			const searchParams = analysis.searchParameters.drive;
			// Ask AI for search plan (replaces pattern heuristics)
			const plan = await this.planDriveSearchWithAI(originalQuery, analysis);
			const effectiveDateFilter = plan.dateFilter || searchParams.dateFilter || 'all';
			console.log('🧠 Drive AI plan:', plan);
			if(plan.mode === 'recency'){
				const qParts = ['trashed = false'];
				if (effectiveDateFilter && effectiveDateFilter !== 'all') {
					const dateFilter = this.getDateFilterForDrive(effectiveDateFilter);
					if (dateFilter) qParts.push(dateFilter);
				}
				const q = qParts.join(' and ');
				let response; try {
					response = await axios.get('https://www.googleapis.com/drive/v3/files', {
						headers: { 'Authorization': `Bearer ${context.googleAccessToken}` },
						params: { q, orderBy:'modifiedTime desc', fields:'files(id,name,mimeType,webViewLink,createdTime,modifiedTime,owners,parents,description,shared,driveId)', corpora:'allDrives', includeItemsFromAllDrives:true, supportsAllDrives:true, pageSize:25 }
					});
				} catch(e){ console.warn('Drive recency plan error', e.response?.data?.error?.message||e.message); return []; }
				const files = response.data.files || [];
				if(files.length && files.length <=3){
					for(const f of files){
						try { const c = await axios.get(`https://www.googleapis.com/drive/v3/files/${f.id}/comments`, { headers:{Authorization:`Bearer ${context.googleAccessToken}`}, params:{ fields:'comments(author,content,createdTime)' } }); f.comments=c.data.comments||[]; f.comments_count=f.comments.length; } catch{}
					}
				}
				console.log(`✅ Drive recency AI plan -> ${files.length} docs`);
				return files;
			}
			// term_search mode
			const terms = (plan.terms||[]).slice(0,8);
			console.log('🔎 Drive AI terms:', terms);
			if(!terms.length){
				// fallback: single broad recency if no terms
				plan.mode='recency';
				return await this.fetchDriveData({ ...analysis, searchParameters:{ drive:{ needed:true, dateFilter: effectiveDateFilter } } }, context, originalQuery);
			}
			const resultsAccum=[];
			for(const term of terms){
				const escaped = term.replace(/'/g,"\\'");
				const qParts=[`(name contains '${escaped}' or fullText contains '${escaped}')`,'trashed = false'];
				if(effectiveDateFilter && effectiveDateFilter!=='all'){
					const df = this.getDateFilterForDrive(effectiveDateFilter); if(df) qParts.push(df);
				}
				const q = qParts.join(' and ');
				console.log('🔍 Drive term q:', q);
				try {
					const resp = await axios.get('https://www.googleapis.com/drive/v3/files', { headers:{Authorization:`Bearer ${context.googleAccessToken}`}, params:{ q, fields:'files(id,name,mimeType,webViewLink,createdTime,modifiedTime,owners,parents,description,shared,driveId)', corpora:'allDrives', includeItemsFromAllDrives:true, supportsAllDrives:true, pageSize:20 } });
					if(resp.data.files?.length) resultsAccum.push(...resp.data.files);
				} catch(e){ console.warn('Drive term search error', term, e.response?.data?.error?.message||e.message); }
				if(resultsAccum.length>40) break;
			}
			const unique = Array.from(new Map(resultsAccum.map(f=>[f.id,f])).values());
			if(unique.length && unique.length<=3){
				for(const f of unique){
					try { const c= await axios.get(`https://www.googleapis.com/drive/v3/files/${f.id}/comments`, { headers:{Authorization:`Bearer ${context.googleAccessToken}`}, params:{ fields:'comments(author,content,createdTime)' } }); f.comments=c.data.comments||[]; f.comments_count=f.comments.length; } catch{}
				}
			}
			console.log(`✅ Found ${unique.length} Drive documents (AI term plan)`);
			return unique;
			for (const term of prioritized) {
				const escaped = term.replace(/'/g,"\\'");
				const qParts = [`(name contains '${escaped}' or fullText contains '${escaped}')`, 'trashed = false'];
				if (searchParams.dateFilter && searchParams.dateFilter !== 'all') {
					const dateFilter = this.getDateFilterForDrive(searchParams.dateFilter);
					if (dateFilter) qParts.push(dateFilter);
				}
				const q = qParts.join(' and ');
				console.log(`🔍 Drive search q: ${q}`);
				let response;
				try {
					response = await axios.get('https://www.googleapis.com/drive/v3/files', {
						headers: { 'Authorization': `Bearer ${context.googleAccessToken}` },
						params: {
							q,
							fields: 'files(id, name, mimeType, webViewLink, createdTime, modifiedTime, owners, parents, description, shared, driveId)',
							corpora: 'allDrives', includeItemsFromAllDrives: true, supportsAllDrives: true, pageSize: 20
						}
					});
				} catch(searchErr){
					console.warn('Drive search error for term', term, searchErr.response?.data?.error?.message || searchErr.message);
					continue;
				}
				if (response.data.files?.length > 0) { allResults.push(...response.data.files); }
				if (allResults.length > 40) break; // cap
			}
			const uniqueResults = Array.from(new Map(allResults.map(f => [f.id, f])).values());
			if (uniqueResults.length > 0 && uniqueResults.length <= 3) {
				for (let i = 0; i < uniqueResults.length; i++) {
					const file = uniqueResults[i];
					try {
						const commentsResp = await axios.get(`https://www.googleapis.com/drive/v3/files/${file.id}/comments`, { headers: { 'Authorization': `Bearer ${context.googleAccessToken}` }, params: { fields: 'comments(author,content,createdTime)' } });
						file.comments = commentsResp.data.comments || [];
						file.comments_count = file.comments.length;
					} catch (cErr) { file.comments = file.comments || []; file.comments_count = file.comments.length || 0; console.warn('Could not fetch Drive comments for file', file.id, cErr.message || cErr); }
					try {
						if (context.serverBase) {
							const contentResp = await axios.get(`${context.serverBase}/api/drive/file/${file.id}/content`, { withCredentials: true });
							file.contentText = contentResp.data.contentText || null;
						} else {
							try { const expResp = await axios.get(`https://www.googleapis.com/drive/v3/files/${file.id}/export`, { headers: { 'Authorization': `Bearer ${context.googleAccessToken}` }, params: { mimeType: 'text/plain' }, responseType: 'text' }); file.contentText = expResp.data || null; } catch (expErr) { file.contentText = null; }
						}
						if (file.contentText && file.contentText.length > 20000) { file.contentText = file.contentText.slice(0, 20000) + '\n...truncated...'; }
					} catch (ctErr) { console.warn('Could not fetch Drive file content for', file.id, ctErr.message || ctErr); file.contentText = file.contentText || null; }
				}
			} else { uniqueResults.forEach(f => { f.comments = f.comments || []; f.comments_count = f.comments.length || 0; }); }
			console.log(`✅ Found ${uniqueResults.length} Drive documents`);
			return uniqueResults;
		} catch (error) { console.error('Drive fetch error:', error.response?.data || error.message); return null; }
	}

	async generateResponseWithAI(originalQuery, data, analysis, context, conversationSummary='') {
		let dataContext = '';
		if (data.clickup && data.clickup.length > 0) { dataContext += '\n\n### ClickUp Tasks Data:\n'; dataContext += this.formatClickUpDataForAI(data.clickup); }
		if (data.drive && data.drive.length > 0) { dataContext += '\n\n### Google Drive Documents:\n'; dataContext += this.formatDriveDataForAI(data.drive); }
		if (!dataContext) { dataContext = '\n\nNo specific data was found for this query.'; }
		const prompt = `You are the AI Executive Assistant for 56k Agency, a digital marketing agency.
Your role is to provide intelligent, actionable insights based on the user's query and available data.
The user you are assisting is ${context.userName}. Address them in a helpful and direct manner.

CONVERSATION CONTEXT (previous messages summarized or recent turns):\n${conversationSummary || 'N/A'}\n
Today's date: ${new Date().toLocaleDateString('it-IT', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}

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
				messages: [ { role: 'user', content: prompt } ]
			}, {
				headers: {
					'x-api-key': this.claudeApiKey,
					'anthropic-version': '2023-06-01',
					'content-type': 'application/json'
				}
			});
			return response.data.content[0].text;
		} catch (error) { console.error('Response generation error:', error.response?.data || error.message); return 'Mi dispiace, si è verificato un errore nel generare la risposta. Riprova tra qualche istante.'; }
	}

	async buildConversationMemory(messages) {
		try {
			if (!Array.isArray(messages) || messages.length === 0) { return { latestUserMessage: '', conversationSummary: '' }; }
			const latestUserMessage = [...messages].reverse().find(m => m.role === 'user')?.content || messages[messages.length -1].content || '';
			if (messages.length <= 12) {
				const convo = messages.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n');
				return { latestUserMessage, conversationSummary: convo };
			}
			const recent = messages.slice(-12);
			const earlier = messages.slice(0, -12).map(m => `${m.role}: ${m.content}`).join('\n');
			let summary = '';
			try {
				const resp = await axios.post('https://api.anthropic.com/v1/messages', {
					model: this.modelId,
					max_tokens: 400,
					temperature: 0.2,
					messages: [ { role: 'user', content: `Riassumi in massimo 10 frasi puntate (bullet concise) i punti chiave, obiettivi, decisioni e contesto seguente per mantenere la memoria di una chat. Mantieni lingua originale dei contenuti (IT/EN). Testo:\n\n${earlier}` } ]
				}, {
					headers: {
						'x-api-key': this.claudeApiKey,
						'anthropic-version': '2023-06-01',
						'content-type': 'application/json'
					}
				});
				summary = resp.data.content?.[0]?.text?.trim() || '';
			} catch (e) { summary = '(summarization failed)'; }
			const recentJoined = recent.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n');
			const conversationSummary = `PREVIOUS SUMMARY:\n${summary}\n\nRECENT TURNS:\n${recentJoined}`;
			return { latestUserMessage, conversationSummary };
		} catch (e) { return { latestUserMessage: messages[messages.length -1]?.content || '', conversationSummary: '' }; }
	}

	formatClickUpDataForAI(tasks) {
		return tasks.slice(0, 25).map(task => {
			const dueDate = task.due_date ? new Date(parseInt(task.due_date)).toLocaleDateString('it-IT') : 'No deadline';
			const assignees = task.assignees?.map(a => a.username).join(', ') || 'Unassigned';
			const priority = task.priority?.priority || 'normal';
			const status = task.status?.status || 'unknown';
			const isOverdue = task.due_date && parseInt(task.due_date) < Date.now();
			const overdueFlag = isOverdue ? ' [OVERDUE]' : '';
			const description = this.truncateText(task.description || '', 800);
			const timeEstimate = this.msToHuman(task.time_estimate);
			const timeSpent = this.msToHuman(task.time_spent);
			const attachmentsCount = task.attachments ? task.attachments.length : 0;
			const commentsInfo = (task.comments && task.comments.length > 0)
				? `Comments loaded: ${task.comments.length}`
				: `Comments: ${task.comments_count || 0} (details not loaded)`;
			const parentInfo = task.parent ? `Parent Task ID: ${task.parent}` : '';
			const url = task.url || task.short_url || 'N/A';
			const listName = task.list?.name || 'N/A';
			return `Task: ${task.name}${overdueFlag}
	Status: ${status}
	Due: ${dueDate}
	Assignees: ${assignees}
	Priority: ${priority}
	Project: ${task.project?.name || listName || task.space?.name || 'N/A'}
	List: ${listName}
	URL: ${url}
	Description: ${description}
	Time Estimated: ${timeEstimate}
	Time Tracked: ${timeSpent}
	Attachments: ${attachmentsCount}
	${parentInfo}
	${commentsInfo}`;
		}).join('\n---\n');
	}

	formatDriveDataForAI(files) {
		return files.slice(0, 20).map(file => {
			const modDate = new Date(file.modifiedTime).toLocaleDateString('it-IT');
			const owner = file.owners?.[0]?.displayName || 'Unknown';
			const size = file.size ? `${(file.size / 1024 / 1024).toFixed(2)} MB` : 'N/A';
			const commentsInfo = (file.comments && file.comments.length > 0)
				? `Comments loaded: ${file.comments.map(c => `${c.author?.displayName || c.author?.email || 'unknown'}: ${this.truncateText(c.content || c.htmlContent || '', 200)}`).join('\n  --\n')}`
				: `Comments: ${file.comments_count || 0} (details not loaded)`;
			return `Document: ${file.name}
	Type: ${this.getFileTypeDescription(file.mimeType)}
	Modified: ${modDate}
	Owner: ${owner}
	Size: ${size}
	Link: ${file.webViewLink}
	${commentsInfo}`;
		}).join('\n---\n');
	}

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
