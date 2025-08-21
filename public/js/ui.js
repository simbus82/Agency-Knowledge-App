// ========================================
// 56k Knowledge Hub - UI Management
// ========================================

const UIManager = {
    
    // Initialize UI components and event listeners
    init() {
        this.setupEventListeners();
        this.setupKeyboardShortcuts();
        this.setupScrollHandling();
        this.initializeTooltips();
    },

    // Setup global event listeners
    setupEventListeners() {
        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.user-menu')) {
                document.getElementById('userDropdown').classList.remove('active');
            }
        });

        // Handle window resize
        window.addEventListener('resize', this.handleResize.bind(this));

        // Handle connection status
        this.setupConnectionMonitoring();
    },

    // Setup keyboard shortcuts
    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            // Ctrl/Cmd + K - Focus input
            if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
                e.preventDefault();
                document.getElementById('userInput').focus();
            }
            
            // Ctrl/Cmd + L - Clear chat
            if ((e.ctrlKey || e.metaKey) && e.key === 'l') {
                e.preventDefault();
                this.clearChat();
            }
            
            // Escape - Close modals, blur input
            if (e.key === 'Escape') {
                document.getElementById('userDropdown').classList.remove('active');
                document.getElementById('userInput').blur();
            }
        });
    },

    // Setup scroll handling for messages
    setupScrollHandling() {
        const messagesContainer = document.getElementById('messages');
        if (messagesContainer) {
            messagesContainer.addEventListener('scroll', this.handleMessagesScroll.bind(this));
        }
    },

    // Initialize tooltips for interactive elements
    initializeTooltips() {
        const tooltipElements = document.querySelectorAll('[title]');
        tooltipElements.forEach(element => {
            this.addTooltip(element);
        });
    },

    // Add tooltip functionality
    addTooltip(element) {
        let tooltip = null;
        
        element.addEventListener('mouseenter', (e) => {
            const title = e.target.getAttribute('title');
            if (!title) return;
            
            // Remove title to prevent default tooltip
            e.target.removeAttribute('title');
            e.target.setAttribute('data-original-title', title);
            
            // Create tooltip
            tooltip = document.createElement('div');
            tooltip.className = 'custom-tooltip';
            tooltip.textContent = title;
            document.body.appendChild(tooltip);
            
            // Position tooltip
            const rect = e.target.getBoundingClientRect();
            tooltip.style.left = rect.left + (rect.width / 2) - (tooltip.offsetWidth / 2) + 'px';
            tooltip.style.top = rect.top - tooltip.offsetHeight - 8 + 'px';
        });
        
        element.addEventListener('mouseleave', (e) => {
            if (tooltip) {
                tooltip.remove();
                tooltip = null;
            }
            
            // Restore title
            const originalTitle = e.target.getAttribute('data-original-title');
            if (originalTitle) {
                e.target.setAttribute('title', originalTitle);
                e.target.removeAttribute('data-original-title');
            }
        });
    },

    // Handle window resize
    handleResize() {
        // Adjust sidebar on mobile
        if (window.innerWidth <= 768) {
            StateManager.updateState('ui.sidebarVisible', false);
        } else {
            StateManager.updateState('ui.sidebarVisible', true);
        }
        
        // Update sidebar UI
        this.updateSidebarVisibility();

        // Toggle mobile sidebar button visibility
        const toggleBtn = document.getElementById('mobileSidebarToggle');
        if (toggleBtn) {
            if (window.innerWidth <= 768) {
                toggleBtn.style.display = 'inline-flex';
            } else {
                toggleBtn.style.display = 'none';
            }
        }
    },

    // Handle messages scroll
    handleMessagesScroll() {
        // Auto-hide/show scroll indicators, etc.
        // Implementation for scroll-based UI updates
    },

    // Connection monitoring
    setupConnectionMonitoring() {
        // Check server connection periodically using AbortController for timeout
        setInterval(async () => {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), CONFIG.TIMEOUTS.HEALTH_CHECK);

            try {
                const response = await fetch(`${CONFIG.API_BASE}/health`, {
                    signal: controller.signal,
                    credentials: 'include'
                });

                clearTimeout(timeoutId);

                if (response.ok) {
                    const health = await response.json();
                    this.updateConnectionStatus('server', true);

                    // Update individual service statuses and pass error details if present
                    const errors = health.errors || {};
                    Object.entries(health.services || {}).forEach(([service, status]) => {
                        const isConnected = (status === 'connected' || status === true);
                        const details = errors[service] || null;
                        this.updateConnectionStatus(service, isConnected, details);
                    });
                } else {
                    this.updateConnectionStatus('server', false);
                }
            } catch (error) {
                clearTimeout(timeoutId);
                if (error.name === 'AbortError') {
                    console.warn('Health check aborted due to timeout');
                } else {
                    console.error('Health check error', error);
                }
                this.updateConnectionStatus('server', false);
            }
    }, 45000); // Reduced frequency for compact UI
    },

    // Update connection status in UI
    updateConnectionStatus(service, isConnected, details = null) {
        StateManager.setConnectionStatus(service, isConnected);
        // Update individual service badge if present
        const mapping = {
            'claude': 'ai',
            'ai': 'ai',
            'google': 'drive',
            'drive': 'drive',
            'clickup': 'clickup',
            'database': 'db',
            'db': 'db',
            'server': null
        };

        const short = mapping[service] || service;
        if (short) {
            const dot = document.getElementById(`status-${short}`);
            if (dot) {
                dot.classList.remove('connected', 'disconnected', 'partial');
                dot.classList.add(isConnected ? 'connected' : 'disconnected');
                dot.setAttribute('title', `${short.toUpperCase()}: ${isConnected?'OK':'KO'}` + (details? `\n${details}`:''));
            }
            const label = document.getElementById(`label-${short}`);
            if(label){ label.style.display='none'; }
        }

        // Update per-service meta UI (last checked + error details) if elements exist
        try {
            const now = new Date().toISOString();
            const shortId = short || service;
            const idKey = shortId === 'db' ? 'db' : shortId;
            const lastEl = document.getElementById(`meta-${idKey}-last`);
            const errEl = document.getElementById(`meta-${idKey}-error`);

            if (lastEl) lastEl.style.display = 'none';
            if (errEl) errEl.style.display = 'none';

            // Update service meta in state as well
            StateManager.setServiceMeta(service, { lastChecked: now, lastError: details || null });
        } catch (e) {
            // non-critical UI update failure
            console.warn('Could not update service meta UI', e);
        }

        // Update aggregate status
        const statusDot = document.getElementById('connectionStatus');
        const statusText = document.getElementById('connectionText');

        if (statusDot && statusText) {
            const allValues = Object.values(StateManager.getState().connections);
            const anyFalse = allValues.some(v => v === false);
            const anyNull = allValues.some(v => v == null);

            if (!anyFalse && !anyNull && allValues.length > 0) {
                statusDot.className = 'status-dot';
                statusText.textContent = 'Connesso';
            } else if (anyFalse) {
                statusDot.className = 'status-dot disconnected';
                statusText.textContent = 'Problemi connessione';
            } else {
                statusDot.className = 'status-dot warning';
                statusText.textContent = 'Verifica in corso';
            }
        }
    },

    // Update user interface based on state
    updateUserInterface() {
        const state = StateManager.getState();
        
        if (!state.user) return;
        
        // Update user name
        const userName = document.getElementById('userName');
        if (userName) {
            userName.textContent = state.user.name;
        }
        
        // Update avatar
        const userAvatar = document.getElementById('userAvatar');
        const userAvatarImg = document.getElementById('userAvatarImg');
        
        if (state.user.avatar && userAvatarImg) {
            userAvatarImg.src = state.user.avatar;
            userAvatarImg.style.display = 'block';
        } else if (userAvatar) {
            userAvatar.textContent = state.user.name.split(' ').map(n => n[0]).join('').toUpperCase();
        }
        
        // Update ClickUp status
        const clickupStatus = document.getElementById('clickupStatus');
        if (clickupStatus) {
            clickupStatus.textContent = state.hasClickUp ? '✅ ClickUp Connesso' : '🔗 Connetti ClickUp';
        }
    },

    // Toggle user menu
    toggleUserMenu() {
        const dropdown = document.getElementById('userDropdown');
        dropdown.classList.toggle('active');
    },

    // Update sidebar visibility
    updateSidebarVisibility() {
        const sidebar = document.getElementById('sidebar');
        const state = StateManager.getState();
        
        if (sidebar) {
            if (state.ui.sidebarVisible) {
                sidebar.classList.remove('hidden');
            } else {
                sidebar.classList.add('hidden');
            }
        }
    },

    // Toggle sidebar
    toggleSidebar() {
        StateManager.toggleSidebar();
        this.updateSidebarVisibility();
    },

    // Show loading screen
    showLoadingScreen() {
        document.getElementById('loadingScreen').classList.remove('hidden');
        document.getElementById('mainContainer').classList.remove('active');
    },

    // Hide loading screen
    hideLoadingScreen() {
        setTimeout(() => {
            document.getElementById('loadingScreen').classList.add('hidden');
            document.getElementById('mainContainer').classList.add('active');
        }, 500);
    },

    // Add message to UI with proper markdown rendering
    addMessage(type, content, options = {}) {
        const messages = document.getElementById('messages');
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${type}`;
        
        // Remove welcome screen if present
        const welcomeScreen = document.getElementById('welcomeScreen');
        if (welcomeScreen) {
            welcomeScreen.remove();
        }
        
        const state = StateManager.getState();
        let avatarContent = '';
        
        if (type === 'user' && state.user?.avatar) {
            avatarContent = `<img src="${state.user.avatar}" alt="">`;
        } else if (type === 'user') {
            avatarContent = state.user?.name?.substring(0, 2).toUpperCase() || 'U';
        } else {
            avatarContent = 'AI';
        }
        
        messageDiv.innerHTML = `
            <div class="message-avatar">${avatarContent}</div>
            <div class="message-content" id="message-${Date.now()}"></div>
        `;
        
        messages.appendChild(messageDiv);
        
        // Render markdown content
        const contentElement = messageDiv.querySelector('.message-content');
        if (type === 'ai') {
            // Use markdown processor for AI responses
            MarkdownProcessor.renderMarkdown(contentElement, content);
        } else {
            // Plain text for user messages
            contentElement.textContent = content;
        }
        
        // Add to state
        StateManager.addMessage({
            type,
            content,
            timestamp: new Date().toISOString(),
            ...options
        });
        
        // Scroll to bottom
        this.scrollToBottom();
        
        return messageDiv;
    },

    // Create typing indicator
    createTypingIndicator() {
        const messages = document.getElementById('messages');
        const typingDiv = document.createElement('div');
        typingDiv.className = 'message ai';
        typingDiv.id = 'typing-indicator';
        
        typingDiv.innerHTML = `
            <div class="message-avatar">AI</div>
            <div class="message-content">
                <div class="typing-indicator">
                    <div class="typing-dot"></div>
                    <div class="typing-dot"></div>
                    <div class="typing-dot"></div>
                </div>
            </div>
        `;
        
        messages.appendChild(typingDiv);
        this.scrollToBottom();
        
        return typingDiv;
    },

    // Render structured RAG result (conclusions + support with grounding spans)
    renderRagResult(payload){
        const { result, run_id } = payload || {};
        if(!result){
            this.addMessage('ai', 'Nessun risultato RAG.');
            return;
        }
        const wrapper = document.createElement('div');
        wrapper.className = 'rag-result';
        // Conclusions
            const coverageMap = {};
            (result.conclusion_grounding||[]).forEach(cg=>{ coverageMap[cg.conclusion_index]=cg.coverage; });
            const conclusionsHtml = (result.conclusions||[]).map((c,i)=>{
                const conf = (c.confidence!=null? (Math.round(c.confidence*100))+'%':'');
                const cov = coverageMap[i]!=null? ('Cov:'+Math.round(coverageMap[i]*100)+'%') : '';
                return `<div class="rag-conclusion" data-index="${i}"><div class="rag-conclusion-text">${DOMPurify.sanitize(c.text)}</div><div class="rag-conclusion-meta">${conf} ${cov}</div></div>`;
            }).join('');
        // Support snippets with grounding spans placeholder (we later highlight tokens)
        const supportHtml = (result.support||[]).map((s,i)=>{
            const spans = (result.grounding_spans||[]).find(gs=>gs.support_index===i)?.evidence_spans || [];
            let snippet = DOMPurify.sanitize(s.snippet||'');
            // naive highlight: wrap first token occurrences
            spans.slice(0,12).forEach(sp=>{
                const token = sp.token.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
                const re = new RegExp(token,'i');
                snippet = snippet.replace(re, m=>`<mark data-abs-start="${sp.absolute_start||''}" data-abs-end="${sp.absolute_end||''}">${m}</mark>`);
            });
            return `<div class="rag-support" data-chunk="${s.id||''}"><div class="rag-support-title">S${i+1}</div><div class="rag-support-body">${snippet}</div></div>`;
        }).join('');
        wrapper.innerHTML = `
            <div class="rag-section"><h4>Conclusioni</h4>${conclusionsHtml}</div>
            <div class="rag-section"><h4>Evidenze</h4>${supportHtml}</div>
            <div class="rag-tools"><button class="btn btn-secondary" data-run="${run_id}" onclick="downloadAudit('${run_id}')">⬇️ Audit</button></div>
        `;
        const messages = document.getElementById('messages');
        const msgDiv = document.createElement('div');
        msgDiv.className = 'message ai';
        msgDiv.appendChild(wrapper);
        messages.appendChild(msgDiv);
        StateManager.addMessage({ type:'ai', content: '[RAG] '+ (result.conclusions||[]).map(c=>c.text).join('\n'), timestamp: new Date().toISOString(), run_id });
        this.scrollToBottom();
    },

    // Remove typing indicator
    removeTypingIndicator() {
        const indicator = document.getElementById('typing-indicator');
        if (indicator) {
            indicator.remove();
        }
    },

    // Scroll messages to bottom
    scrollToBottom(smooth = true) {
        const messages = document.getElementById('messages');
        if (messages) {
            const scrollOptions = {
                top: messages.scrollHeight,
                behavior: smooth ? 'smooth' : 'auto'
            };
            messages.scrollTo(scrollOptions);
        }
    },

    // Auto-resize textarea
    autoResize(textarea) {
        textarea.style.height = 'auto';
        textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
    },

    // Clear chat
    clearChat() {
        if (confirm('Vuoi davvero cancellare la conversazione corrente?')) {
            document.getElementById('messages').innerHTML = '';
            StateManager.clearMessages();
            location.reload();
        }
    },

    // Show toast notification
    showToast(message, type = 'info', duration = 3000) {
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        
        // Add icon based on type
        const icons = {
            success: '✅',
            error: '❌',
            warning: '⚠️',
            info: 'ℹ️'
        };
        
        toast.innerHTML = `
            <span>${icons[type] || ''}</span>
            <span>${message}</span>
        `;
        
        document.body.appendChild(toast);
        
        // Auto-remove toast
        setTimeout(() => {
            toast.style.animation = 'slideOut 0.3s ease';
            setTimeout(() => toast.remove(), 300);
        }, duration);
    },

    // Update conversations list
    updateConversationsList() {
        const list = document.getElementById('conversationsList');
        const conversations = StateManager.getState().conversations;
        
        if (!list) return;
        
        if (conversations.length === 0) {
            list.innerHTML = `
                <div class="no-conversations">
                    Nessuna conversazione salvata.<br>
                    Inizia a chattare per creare la prima!
                </div>
            `;
            return;
        }
        
        list.innerHTML = conversations.map(conv => `
            <div class="conversation-item ${conv.id === StateManager.getState().currentConversation ? 'active' : ''}" 
                 onclick="loadConversation('${conv.id}')">
                <div class="conversation-title">${conv.title}</div>
                <div class="conversation-date">${new Date(conv.updated_at).toLocaleDateString()}</div>
            </div>
        `).join('');
    },

    // Update model selector
    updateModelSelector() {
        const selector = document.getElementById('modelSelector');
        const models = StateManager.getState().models;
        
        if (!selector || !models.length) return;
        
        selector.innerHTML = models.map(model => 
            `<option value="${model.id}" ${model.recommended ? 'selected' : ''}>
                ${model.name}
            </option>`
        ).join('');
    },

    // Set loading state for send button
    setLoadingState(isLoading) {
        const sendBtn = document.getElementById('sendBtn');
        const userInput = document.getElementById('userInput');
        
        if (sendBtn) {
            sendBtn.disabled = isLoading;
            sendBtn.innerHTML = isLoading 
                ? '<div class="loading-spinner" style="width: 20px; height: 20px;"></div>'
                : '<span>Invia</span><span>→</span>';
        }
        
        if (userInput) {
            userInput.disabled = isLoading;
        }
        
        StateManager.setLoading(isLoading);
    },

    // Handle input key events
    handleKeyDown(event) {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            // Call sendMessage function from app.js
            if (typeof sendMessage === 'function') {
                sendMessage();
            }
        }
    }
};

// Listen to state changes and update UI accordingly
StateManager.addListener((state) => {
    UIManager.updateUserInterface();
    UIManager.updateSidebarVisibility();
    UIManager.updateConversationsList();
    UIManager.updateModelSelector();
});

// Initialize UI when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    UIManager.init();
    // Ensure initial responsive adjustments
    UIManager.handleResize();
});

// Export functions to global scope for HTML onclick handlers
window.toggleUserMenu = () => UIManager.toggleUserMenu();
window.toggleSidebar = () => UIManager.toggleSidebar();
window.clearChat = () => UIManager.clearChat();
window.autoResize = (textarea) => UIManager.autoResize(textarea);
window.handleKeyDown = (event) => UIManager.handleKeyDown(event);

// Expose a function to trigger an immediate service check from the header
window.checkServiceNow = async (service) => {
    if(service==='google'){
        const modal = document.getElementById('oauthModal');
        if (modal) modal.style.display = 'flex';
        window.__pendingOauth = 'google';
        return;
    }
    try {
        const resp = await fetch(`${CONFIG.API_BASE}/api/status/services`, { credentials:'include' });
        if(!resp.ok) throw new Error('status_http_'+resp.status);
        const data = await resp.json();
        const ok = data.services?.[service === 'database' ? 'database' : service];
        StateManager.setConnectionStatus(service, !!ok);
        UIManager.updateConnectionStatus(service, !!ok);
        UIManager.showToast(`${service} ${ok?'OK':'KO'}`, ok?'success':'warning');
    } catch(e){
        StateManager.setConnectionStatus(service,false);
        UIManager.updateConnectionStatus(service,false);
        UIManager.showToast(`${service} errore`, 'error');
    }
};

// Modal handlers for Google OAuth
window.closeOauthModal = () => {
    const modal = document.getElementById('oauthModal');
    if (modal) modal.style.display = 'none';
    window.__pendingOauth = null;
};

window.confirmOauthGoogle = () => {
    const modal = document.getElementById('oauthModal');
    if (modal) modal.style.display = 'none';
    window.__pendingOauth = null;
    UIManager.showToast('Apertura flusso Google OAuth...', 'info');
    window.open('/auth/google', '_blank');
};

