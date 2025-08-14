// ========================================
// 56k Knowledge Hub - State Management
// ========================================

// State Management
let state = {
    user: null,
    currentConversation: null,
    conversations: [],
    models: [],
    selectedModel: null,
    isLoading: false,
    hasClickUp: false,
    currentMessages: [],
    
    // UI State
    ui: {
        sidebarVisible: true,
        darkMode: false,
        compactMode: false
    },
    
    // Connection states
    connections: {
        claude: false,
        clickup: false,
        drive: false,
        server: false
    }
};

// State management functions
const StateManager = {
    // Get current state
    getState() {
        return state;
    },

    // Update state with new data
    setState(newState) {
        state = { ...state, ...newState };
        this.notifyStateChange();
    },

    // Update nested state properties
    updateState(path, value) {
        const keys = path.split('.');
        let current = state;
        
        for (let i = 0; i < keys.length - 1; i++) {
            if (!current[keys[i]]) {
                current[keys[i]] = {};
            }
            current = current[keys[i]];
        }
        
        current[keys[keys.length - 1]] = value;
        this.notifyStateChange();
    },

    // Get nested state value
    getStateValue(path) {
        const keys = path.split('.');
        let current = state;
        
        for (const key of keys) {
            if (current === null || current === undefined) {
                return undefined;
            }
            current = current[key];
        }
        
        return current;
    },

    // State change listeners
    listeners: [],
    
    addListener(callback) {
        this.listeners.push(callback);
    },

    removeListener(callback) {
        this.listeners = this.listeners.filter(l => l !== callback);
    },

    notifyStateChange() {
        this.listeners.forEach(callback => {
            try {
                callback(state);
            } catch (error) {
                console.error('State listener error:', error);
            }
        });
    },

    // Conversation management
    addMessage(message) {
        state.currentMessages.push(message);
        this.notifyStateChange();
    },

    clearMessages() {
        state.currentMessages = [];
        this.notifyStateChange();
    },

    updateMessage(index, updates) {
        if (state.currentMessages[index]) {
            state.currentMessages[index] = { 
                ...state.currentMessages[index], 
                ...updates 
            };
            this.notifyStateChange();
        }
    },

    // User management
    setUser(user) {
        state.user = user;
        state.hasClickUp = user?.hasClickUp || false;
        this.notifyStateChange();
    },

    // Connection status
    setConnectionStatus(service, status) {
        state.connections[service] = status;
        this.notifyStateChange();
    },

    // UI helpers
    toggleSidebar() {
        state.ui.sidebarVisible = !state.ui.sidebarVisible;
        this.notifyStateChange();
    },

    setLoading(isLoading) {
        state.isLoading = isLoading;
        this.notifyStateChange();
    },

    // Local storage persistence
    saveToLocalStorage() {
        try {
            const persistentState = {
                ui: state.ui,
                selectedModel: state.selectedModel,
                conversations: state.conversations
            };
            localStorage.setItem('knowledgeHub_state', JSON.stringify(persistentState));
        } catch (error) {
            console.warn('Failed to save state to localStorage:', error);
        }
    },

    loadFromLocalStorage() {
        try {
            const saved = localStorage.getItem('knowledgeHub_state');
            if (saved) {
                const persistentState = JSON.parse(saved);
                
                // Merge with current state
                state.ui = { ...state.ui, ...persistentState.ui };
                state.selectedModel = persistentState.selectedModel || state.selectedModel;
                
                this.notifyStateChange();
            }
        } catch (error) {
            console.warn('Failed to load state from localStorage:', error);
        }
    },

    // Reset state (for logout, etc.)
    reset() {
        const defaultState = {
            user: null,
            currentConversation: null,
            conversations: [],
            models: [],
            selectedModel: null,
            isLoading: false,
            hasClickUp: false,
            currentMessages: [],
            ui: {
                sidebarVisible: true,
                darkMode: false,
                compactMode: false
            },
            connections: {
                claude: false,
                clickup: false,
                drive: false,
                server: false
            }
        };
        
        state = defaultState;
        this.notifyStateChange();
    }
};

// Auto-save state to localStorage on changes
StateManager.addListener(() => {
    StateManager.saveToLocalStorage();
});

// Load state from localStorage on initialization
document.addEventListener('DOMContentLoaded', () => {
    StateManager.loadFromLocalStorage();
});
