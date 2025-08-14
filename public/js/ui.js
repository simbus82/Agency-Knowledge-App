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
    },

    // Handle messages scroll
    handleMessagesScroll() {
        // Auto-hide/show scroll indicators, etc.
        // Implementation for scroll-based UI updates
    },

    // Connection monitoring
    setupConnectionMonitoring() {
        // Check server connection periodically
        setInterval(async () => {
            try {
                const response = await fetch(`${CONFIG.API_BASE}/health`, {
                    timeout: CONFIG.TIMEOUTS.HEALTH_CHECK
                });
                
                if (response.ok) {
                    const health = await response.json();
                    this.updateConnectionStatus('server', true);
                    
                    // Update individual service statuses
                    Object.entries(health.services || {}).forEach(([service, status]) => {
                        this.updateConnectionStatus(service, status === 'connected' || status === true);
                    });
                } else {
                    this.updateConnectionStatus('server', false);
                }
            } catch (error) {
                this.updateConnectionStatus('server', false);
            }
        }, 30000); // Check every 30 seconds
    },

    // Update connection status in UI
    updateConnectionStatus(service, isConnected) {
        StateManager.setConnectionStatus(service, isConnected);
        
        const statusDot = document.getElementById('connectionStatus');
        const statusText = document.getElementById('connectionText');
        
        if (statusDot && statusText) {
            const allConnected = Object.values(StateManager.getState().connections).every(status => status);
            
            if (allConnected) {
                statusDot.className = 'status-dot';
                statusText.textContent = 'Connesso';
            } else {
                statusDot.className = 'status-dot warning';
                statusText.textContent = 'Problemi connessione';
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
});

// Export functions to global scope for HTML onclick handlers
window.toggleUserMenu = () => UIManager.toggleUserMenu();
window.toggleSidebar = () => UIManager.toggleSidebar();
window.clearChat = () => UIManager.clearChat();
window.autoResize = (textarea) => UIManager.autoResize(textarea);
window.handleKeyDown = (event) => UIManager.handleKeyDown(event);
