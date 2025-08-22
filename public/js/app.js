// ========================================
// 56k Knowledge Hub - Main Application
// ========================================

// Main Application Controller
const App = {
    
    // Initialize the application
    async init() {
        console.log('Initializing 56k Knowledge Hub...');
        
        try {
            // Check configuration status first
            await this.checkConfiguration();
            
            // Check authentication
            await this.checkAuthentication();
            
        } catch (error) {
            console.error('Application initialization failed:', error);
            UIManager.showToast('Errore durante l\'inizializzazione', 'error');
        }
    },

    // Check if backend is properly configured
    async checkConfiguration() {
        try {
            const response = await fetch(`${CONFIG.API_BASE}/api/config/status`);
            const configStatus = await response.json();
            
            if (!configStatus.configured) {
                console.log('Configuration required:', configStatus.missingRequired);
                window.location.href = `${CONFIG.API_BASE}/setup`;
                return;
            }
        } catch (error) {
            console.error('Failed to check configuration:', error);
            UIManager.showToast('Errore: Backend non raggiungibile. Assicurati che il server sia avviato.', 'error');
            throw error;
        }
    },

    // Check user authentication
    async checkAuthentication() {
        try {
            const response = await fetch(`${CONFIG.API_BASE}/api/user`, {
                credentials: 'include'
            });
            
            if (response.ok) {
                const data = await response.json();
                if (data.authenticated) {
                    StateManager.setUser(data.user);
                    await this.onUserAuthenticated();
                } else {
                    this.redirectToAuth();
                }
            } else {
                this.redirectToAuth();
            }
        } catch (error) {
            console.error('Authentication check failed:', error);
            UIManager.showToast('Errore di autenticazione', 'error');
            throw error;
        }
    },

    // Redirect to Google OAuth
    redirectToAuth() {
        window.location.href = `${CONFIG.API_BASE}/auth/google`;
    },

    // Handle successful user authentication
    async onUserAuthenticated() {
        console.log('User authenticated:', StateManager.getState().user);
        
        // Load application data
        await Promise.all([
            this.loadClaudeModels(),
            this.loadConversations(),
            this.loadDynamicQueries()
        ]);

        // Aggiorna immediatamente lo stato dei servizi (inclusi ClickUp / Drive) lato utente
        try {
            const resp = await fetch(`${CONFIG.API_BASE}/api/status/services`, { credentials: 'include' });
            if (resp.ok) {
                const data = await resp.json();
                if (data.services) {
                    Object.entries(data.services).forEach(([svc, ok]) => {
                        StateManager.setConnectionStatus(svc, !!ok);
                    });
                }
            }
        } catch(e){ console.warn('Impossibile recuperare stato servizi iniziale', e); }

    // Load app version (non-blocking)
    this.loadAppVersion();
        
        // Enable input
        this.enableUserInput();
        
        // Hide loading screen
        UIManager.hideLoadingScreen();
        
        // Handle OAuth callbacks
        this.handleOAuthCallbacks();
    },
    // Fetch backend version and show in footer
    async loadAppVersion(){
        try {
            const resp = await fetch(`${CONFIG.API_BASE}/version`);
            if(!resp.ok) return;
            const data = await resp.json();
            const el = document.getElementById('versionBadge');
            if(el) el.textContent = 'v' + data.version;
        } catch(e){
            // silent fail
        }
    },

    // Enable user input controls
    enableUserInput() {
        const userInput = document.getElementById('userInput');
        const sendBtn = document.getElementById('sendBtn');
        
        if (userInput) userInput.disabled = false;
        if (sendBtn) sendBtn.disabled = false;
    },

    // Load available Claude models
    async loadClaudeModels() {
        try {
            const response = await fetch(`${CONFIG.API_BASE}/api/claude/models`);
            if (response.ok) {
                const models = await response.json();
                StateManager.setState({ models });
                
                // Set default model
                const defaultModel = models.find(m => m.recommended)?.id || models[0]?.id;
                StateManager.setState({ selectedModel: defaultModel });
            }
        } catch (error) {
            console.error('Failed to load models:', error);
        }
    },

    // Load user conversations
    async loadConversations() {
        try {
            const response = await fetch(`${CONFIG.API_BASE}/api/conversations`, {
                credentials: 'include'
            });
            
            if (response.ok) {
                const conversations = await response.json();
                StateManager.setState({ conversations });
            }
        } catch (error) {
            console.error('Failed to load conversations:', error);
        }
    },

    // Load dynamic query suggestions
    async loadDynamicQueries() {
        const state = StateManager.getState();
        const queries = [];
        
        // Add ClickUp queries if connected
        if (state.hasClickUp) {
            queries.push({
                text: '🚨 Task in ritardo',
                query: 'Quali task sono in ritardo o urgenti?'
            });
            queries.push({
                text: '📊 Workload team',
                query: 'Come è distribuito il carico di lavoro del team?'
            });
        }
        
        // Add Drive queries
        queries.push({
            text: '📄 Documenti recenti',
            query: 'Mostrami i documenti modificati oggi'
        });
        
        queries.push({
            text: '💰 Budget Q3',
            query: 'Analisi budget del trimestre corrente'
        });
        
        queries.push({
            text: '📈 Report settimanale',
            query: 'Genera un report delle attività di questa settimana'
        });
        
        // Update UI
        this.updateSuggestedQueries(queries);
    },

    // Update suggested queries in UI
    updateSuggestedQueries(queries) {
        const container = document.getElementById('suggestedQueries');
        if (container) {
            container.innerHTML = queries.map(q => `
                <div class="query-chip" onclick="askQuestion('${q.query.replace(/'/g, "\\'")}')">
                    ${q.text}
                </div>
            `).join('');
        }
    },

    // Handle OAuth callback messages
    handleOAuthCallbacks() {
        const urlParams = new URLSearchParams(window.location.search);
        
        if (urlParams.get('login') === 'success') {
            UIManager.showToast('Accesso effettuato con successo!', 'success');
            window.history.replaceState({}, document.title, '/');
        } else if (urlParams.get('login') === 'error') {
            UIManager.showToast('Errore durante l\'accesso', 'error');
        } else if (urlParams.get('clickup') === 'connected') {
            UIManager.showToast('ClickUp connesso con successo!', 'success');
            window.history.replaceState({}, document.title, '/');
            // Reload to update hasClickUp status
            location.reload();
        }
    }
};

// Message handling functions
// --- Conversational history compaction helpers ---
const HISTORY_LIMIT_FULL = 16;              // Fino a questa soglia inviamo tutto
const HISTORY_RECENT_TO_KEEP = 10;          // Ultimi N messaggi sempre inviati
const HISTORY_SUMMARY_MAX_CHARS = 800;      // Limite caratteri per riassunto
const HISTORY_MAX_BULLETS = 12;             // Max bullet sintetici

function buildLocalConversationSummary(earlierMessages){
    if(!earlierMessages.length) return '';
    const bullets = [];
    for(let i=0;i<earlierMessages.length && bullets.length < HISTORY_MAX_BULLETS;i++){
        const m = earlierMessages[i];
        const raw = (m.content||'').replace(/\s+/g,' ').trim();
        if(!raw) continue;
        if(m.type === 'user'){
            bullets.push(`• Utente: ${raw.slice(0,140)}${raw.length>140?'…':''}`);
        } else if(m.type === 'ai') {
            // Prendi solo la prima frase/periodo per l'AI
            const firstSentence = raw.split(/(?<=[.!?])\s+/)[0] || raw;
            bullets.push(`• AI: ${firstSentence.slice(0,160)}${firstSentence.length>160?'…':''}`);
        }
    }
    let summary = bullets.join('\n');
    if(summary.length > HISTORY_SUMMARY_MAX_CHARS){
        summary = summary.slice(0, HISTORY_SUMMARY_MAX_CHARS-1) + '…';
    }
    return summary;
}

function buildCondensedMessagePayload(){
    const msgs = (StateManager.getState().currentMessages || []);
    // Se sotto soglia invia tutto (mappando type -> role)
    if(msgs.length <= HISTORY_LIMIT_FULL){
        return msgs.map(m=> ({ role: m.type === 'ai' ? 'assistant' : 'user', content: m.content }));
    }
    const recent = msgs.slice(-HISTORY_RECENT_TO_KEEP);
    const earlier = msgs.slice(0, msgs.length - HISTORY_RECENT_TO_KEEP);
    const summary = buildLocalConversationSummary(earlier);
    const systemSummary = summary ? [{ role: 'system', content: 'Riassunto conversazione precedente (compact):\n'+summary }] : [];
    return [ ...systemSummary, ...recent.map(m=> ({ role: m.type === 'ai' ? 'assistant' : 'user', content: m.content })) ];
}

async function sendMessage() {
    const input = document.getElementById('userInput');
    const userMessage = input.value.trim();
    
    if (!userMessage || StateManager.getState().isLoading) return;

    // Fail-safe: ensure selected model is valid
    const state = StateManager.getState();
    const availableIds = (state.models||[]).map(m=>m.id);
    if(state.selectedModel && availableIds.length && !availableIds.includes(state.selectedModel)){
        UIManager.showToast('Modello non valido. Seleziona un modello disponibile prima di inviare.', 'error');
        if(input) input.disabled = true;
        const selector = document.getElementById('modelSelector');
        if(selector){ selector.classList.add('warning'); selector.setAttribute('title','Modello non valido'); }
        return;
    }
    
    // Add user message to UI
    UIManager.addMessage('user', userMessage);
    
    // Clear input and show loading
    input.value = '';
    input.style.height = 'auto';
    UIManager.setLoadingState(true);
    
    // Add typing indicator
    const typingIndicator = UIManager.createTypingIndicator();
    
    try {
        // Always classify to extract action/time_range (mode permanently 'rag')
        try {
            const classifyResp = await fetch(`${CONFIG.API_BASE}/api/mode/classify`,{
                method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include',
                body: JSON.stringify({ query: userMessage })
            });
            if(classifyResp.ok){
                const cls = await classifyResp.json();
                if(cls.action){ UIManager.showToast(`Intent: ${cls.action}${cls.time_range? ' · '+cls.time_range:''}`,'info'); }
            }
        } catch{}
        {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), CONFIG.TIMEOUTS.CLAUDE_API);
                const response = await fetch(`${CONFIG.API_BASE}/api/rag/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                signal: controller.signal,
                    body: JSON.stringify({ message: userMessage, include_chunk_texts: true })
            });
            clearTimeout(timeoutId);
            if(!response.ok){
                const errJson = await response.json().catch(()=>({}));
                throw new Error(errJson.message || `HTTP ${response.status}`);
            }
            const data = await response.json();
            UIManager.removeTypingIndicator();
            // Render structured RAG answer
                if(data.answer){
                    UIManager.removeTypingIndicator();
                    let answerText = data.answer;
                    try {
                        const support = data.structured?.result?.support || data.result?.support || [];
                        // Append numbered sources at end if exist
                        if(support.length){
                            const refs = support.slice(0,10).map((s,i)=>`[S${i+1}] ${s.path || s.id || s.source || 'fonte'}`);
                            answerText += `\n\nFonti:\n${refs.join('\n')}`;
                        }
                    } catch{}
                    // Trasforma marcatori [S1] in span cliccabili prima di markdown render
                    answerText = answerText.replace(/\[S(\d+)\]/g, (m,n)=>`<span class="source-ref" data-ref="S${n}">[S${n}]</span>`);
                    const msgEl = UIManager.addMessage('ai', answerText, { rawHtml: true });
                    try {
                        msgEl.querySelectorAll('.source-ref').forEach(el=>{
                            el.style.cursor='pointer';
                            el.addEventListener('click',()=>{
                                const id = 'support-'+el.getAttribute('data-ref');
                                const target = document.getElementById(id);
                                if(target){
                                    target.classList.add('highlight');
                                    target.scrollIntoView({behavior:'smooth', block:'center'});
                                    setTimeout(()=> target.classList.remove('highlight'), 2500);
                                }
                            });
                        });
                    } catch{}
                } else {
                    UIManager.renderRagResult(data);
                }
            await saveConversation();
    }
    } catch (error) {
        console.error('Message send error:', error);
        UIManager.removeTypingIndicator();
        
        let errorMessage = 'Mi dispiace, si è verificato un errore. ';
        
        if (error.name === 'AbortError') {
            errorMessage += 'La richiesta ha impiegato troppo tempo.';
        } else if (error.message.includes('401')) {
            errorMessage += 'Sessione scaduta. Aggiorna la pagina.';
        } else if (error.message.includes('429')) {
            errorMessage += 'Troppe richieste. Riprova tra qualche minuto.';
        } else {
            errorMessage += 'Riprova tra qualche istante.';
        }
        
        UIManager.addMessage('ai', errorMessage);
        UIManager.showToast('Errore durante l\'invio del messaggio', 'error');
    } finally {
        UIManager.setLoadingState(false);
    }
}

// Save current conversation
async function saveConversation() {
    const state = StateManager.getState();
    const messages = state.currentMessages;
    
    if (messages.length === 0) return;
    
    try {
        const conversationId = state.currentConversation || 'conv_' + Date.now();
        const title = messages[0]?.content.substring(0, 50) + '...' || 'Nuova conversazione';
        
        await fetch(`${CONFIG.API_BASE}/api/conversations`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify({
                id: conversationId,
                title,
                messages
            })
        });
        
        // Update state
        if (!state.currentConversation) {
            StateManager.setState({ currentConversation: conversationId });
        }
        
    } catch (error) {
        console.error('Failed to save conversation:', error);
    }
}

// Load specific conversation
async function loadConversation(conversationId) {
    try {
        const response = await fetch(`${CONFIG.API_BASE}/api/conversations/${conversationId}`, {
            credentials: 'include'
        });
        
        if (response.ok) {
            const conversation = await response.json();
            
            // Clear current messages
            document.getElementById('messages').innerHTML = '';
            StateManager.clearMessages();
            
            // Load messages
            conversation.messages.forEach(message => {
                UIManager.addMessage(message.type, message.content);
            });
            
            StateManager.setState({ currentConversation: conversationId });
        }
    } catch (error) {
        console.error('Failed to load conversation:', error);
        UIManager.showToast('Errore nel caricamento della conversazione', 'error');
    }
}

// Start new chat
function startNewChat() {
    if (StateManager.getState().currentMessages.length > 0) {
        if (confirm('Vuoi davvero iniziare una nuova conversazione?')) {
            document.getElementById('messages').innerHTML = '';
            StateManager.clearMessages();
            StateManager.setState({ currentConversation: null });
            location.reload();
        }
    } else {
        location.reload();
    }
}

// Ask a predefined question
function askQuestion(query) {
    const input = document.getElementById('userInput');
    input.value = query;
    sendMessage();
}

// Start feature conversation
function startFeatureConversation(feature) {
    // Remove welcome screen
    const welcomeScreen = document.getElementById('welcomeScreen');
    if (welcomeScreen) welcomeScreen.remove();
    
    const state = StateManager.getState();
    const userName = state.user?.name?.split(' ')[0] || 'User';
    let aiMessage = '';
    
    switch(feature) {
        case 'clickup':
            aiMessage = `Ciao ${userName}! 👋\n\nSono qui per aiutarti con i tuoi task in ClickUp. Posso:\n\n• Mostrarti task in scadenza o in ritardo\n• Analizzare il progress dei progetti\n• Verificare le assegnazioni del team\n• Tracciare il tempo speso sui vari task\n\nCosa vorresti sapere sui tuoi task e progetti?`;
            break;
            
        case 'drive':
            aiMessage = `Ciao ${userName}! 📁\n\nPosso aiutarti a navigare i tuoi documenti in Google Drive. Posso:\n\n• Cercare documenti specifici\n• Mostrarti i file modificati di recente\n• Trovare documenti per progetto o cliente\n• Analizzare il contenuto dei documenti\n\nQuale tipo di documento stai cercando?`;
            break;
            
        case 'analysis':
            aiMessage = `Ciao ${userName}! 🤖\n\nSono pronto per analisi avanzate sui tuoi dati. Posso:\n\n• Correlare informazioni tra ClickUp e Drive\n• Identificare pattern e trend\n• Suggerire ottimizzazioni\n• Creare report personalizzati\n\nSu quale aspetto del tuo lavoro vorresti un'analisi approfondita?`;
            break;
            
        case 'insights':
            aiMessage = `Ciao ${userName}! 📊\n\nPosso generare insights e metriche per te. Posso mostrarti:\n\n• KPI dei progetti\n• Efficienza del team\n• Trend di produttività\n• Analisi budget vs actual\n• Previsioni basate sui dati storici\n\nQuali metriche ti interessano di più?`;
            break;
    }
    
    UIManager.addMessage('ai', aiMessage);
}

// Change Claude model
function changeModel() {
    const selector = document.getElementById('modelSelector');
    const selectedModel = selector.value;
    StateManager.setState({ selectedModel });
    // Re-enable if was disabled due to invalid selection
    const input = document.getElementById('userInput');
    if(input) input.disabled = false;
    selector.classList.remove('warning');
    UIManager.showToast('Modello cambiato', 'success');
}

// User menu functions
function connectClickUp() {
    window.location.href = `${CONFIG.API_BASE}/auth/clickup`;
}

function openSettings() {
    // Open the frontend settings page
    window.location.href = '/settings.html';
}

function logout() {
    if (confirm('Vuoi davvero uscire?')) {
        fetch(`${CONFIG.API_BASE}/api/logout`, {
            method: 'POST',
            credentials: 'include'
        }).then(() => {
            StateManager.reset();
            window.location.href = '/';
        });
    }
}

// Export functions to global scope for HTML onclick handlers
window.sendMessage = sendMessage;
window.saveConversation = saveConversation;
window.loadConversation = loadConversation;
window.startNewChat = startNewChat;
window.askQuestion = askQuestion;
window.startFeatureConversation = startFeatureConversation;
window.changeModel = changeModel;

// legacy decideLocalMode removed (unified mode)
window.connectClickUp = connectClickUp;
window.openSettings = openSettings;
window.logout = logout;
async function downloadAudit(runId){
    if(!runId){ UIManager.showToast('Run id mancante','warning'); return; }
    try {
        const resp = await fetch(`${CONFIG.API_BASE}/api/rag/audit/${runId}/zip`, { credentials:'include' });
        if(!resp.ok) throw new Error('Download fallito');
        const blob = await resp.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `audit_${runId}.zip`; a.click();
        setTimeout(()=> URL.revokeObjectURL(url), 5000);
    } catch(e){ UIManager.showToast('Errore download audit','error'); }
}
window.downloadAudit = downloadAudit;

// Initialize application when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    App.init();
});

// Handle page visibility changes
document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
        // Page became visible, check connection status
        UIManager.setupConnectionMonitoring();
    }
});

// Handle online/offline events
window.addEventListener('online', () => {
    UIManager.showToast('Connessione ripristinata', 'success');
});

window.addEventListener('offline', () => {
    UIManager.showToast('Connessione internet persa', 'warning');
});
