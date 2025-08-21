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
        const mode = StateManager.getState().mode || 'chat';
                let effectiveMode = mode;
                if(mode === 'auto'){
                        // local quick heuristic while waiting server classifier
                        const localMode = decideLocalMode(userMessage);
                        try {
                            const classifyResp = await fetch(`${CONFIG.API_BASE}/api/mode/classify`,{
                                method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include',
                                body: JSON.stringify({ query: userMessage })
                            });
                            if(classifyResp.ok){
                                const cls = await classifyResp.json();
                                effectiveMode = cls.mode || localMode;
                            } else {
                                effectiveMode = localMode;
                            }
                        } catch{ effectiveMode = localMode; }
                        UIManager.showToast(`Auto → ${effectiveMode.toUpperCase()}`,'info');
                }
                if(effectiveMode === 'rag'){
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
            UIManager.renderRagResult(data);
            await saveConversation();
    } else {
            // Standard chat
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), CONFIG.TIMEOUTS.CLAUDE_API);
            const response = await fetch(`${CONFIG.API_BASE}/api/claude/message`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                signal: controller.signal,
                body: JSON.stringify({
                    messages: [ { role: 'user', content: userMessage } ],
                    model: StateManager.getState().selectedModel
                })
            });
            clearTimeout(timeoutId);
            if(!response.ok){ throw new Error(`HTTP ${response.status}: ${response.statusText}`); }
            const data = await response.json();
            UIManager.removeTypingIndicator();
            UIManager.addMessage('ai', data.content[0].text);
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
function changeMode(){
    const selector = document.getElementById('modeSelector');
    StateManager.setMode(selector.value);
    UIManager.showToast(`Modalità: ${selector.value.toUpperCase()}`, 'info');
}
window.changeMode = changeMode;

function decideLocalMode(q){
    const kw = /(prodot|document|fonte|cita|norm|limitat|conflitt|evidenz|policy|scheda|etichett|uso|permess|vietat)/i;
    let score = 0;
    if(kw.test(q)) score += 1;
    if(/(mostra|cita|dimostra|fornisci|eviden)/i.test(q)) score += 0.6;
    if(q.length > 140) score += 0.4;
    if(/(riassum|riformul|parafras|tradu|riscrivi)/i.test(q)) score -= 1.2;
    return score >= 1 ? 'rag':'chat';
}
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
