// settings.js - Logica per la pagina di configurazione

const API_BASE = 'http://localhost:3000';

// ========================================
//  Inizializzazione e Caricamento Dati
// ========================================

document.addEventListener('DOMContentLoaded', async () => {
    console.log('Pagina impostazioni caricata.');
    
    // Controlla autenticazione
    const user = await checkUserAuthentication();
    if (!user) {
        window.location.href = '/'; // Redirect alla home se non autenticato
        return;
    }

    // Popola info utente
    document.getElementById('userInfo').textContent = `Utente: ${user.name}`;

    // Carica dati
    await loadConfigurationStatus();
    await loadClaudeModels();

    // Mostra la pagina
    setTimeout(() => {
        document.getElementById('loadingScreen').classList.add('hidden');
        document.getElementById('settingsContainer').classList.add('active');
    }, 300);
});

async function checkUserAuthentication() {
    try {
        const response = await fetch(`${API_BASE}/api/user`, { credentials: 'include' });
        if (response.ok) {
            const data = await response.json();
            return data.authenticated ? data.user : null;
        }
        return null;
    } catch (error) {
        console.error('Errore autenticazione:', error);
        return null;
    }
}

async function loadConfigurationStatus() {
    try {
        const response = await fetch(`${API_BASE}/api/config/overview`);
        if (!response.ok) {
            throw new Error('Errore nel caricamento della configurazione');
        }
        const config = await response.json();

        // Aggiorna stato Claude
        updateStatusBadge('claudeStatus', config.claude, 'Claude AI');
        if (config.claude) {
            document.getElementById('claudeApiKey').placeholder = '••••••••••••••••••••';
        }

        // Aggiorna stato Google
        updateStatusBadge('googleStatus', config.google, 'Google OAuth');
        if (config.google) {
            document.getElementById('googleClientId').placeholder = '••••••••••••••••••••';
            document.getElementById('googleClientSecret').placeholder = '••••••••••••••••••••';
        }

        // Aggiorna stato ClickUp (OAuth)
        updateStatusBadge('clickupStatus', config.clickup, 'ClickUp OAuth', true);
        // Aggiorna stato ClickUp API Key
        const apiKeyBadge = document.getElementById('clickupApiKeyStatus');
        if (apiKeyBadge) updateStatusBadge('clickupApiKeyStatus', !!config.clickupApiKey, 'ClickUp API Key');
        if (config.clickup) {
            document.getElementById('clickupClientId').placeholder = '••••••••••••••••••••';
            document.getElementById('clickupClientSecret').placeholder = '••••••••••••••••••••';
        }
        if (config.clickupApiKey) {
            const el = document.getElementById('clickupApiKey');
            if (el) el.placeholder = '••••••••••••••••••••';
        }

        // Popola dominio
        if (config.allowedDomain) {
            document.getElementById('allowedDomain').value = config.allowedDomain;
        }

    } catch (error) {
        showToast(error.message, 'error');
    }
}

async function loadClaudeModels() {
    try {
        const response = await fetch(`${API_BASE}/api/claude/models`);
        if (response.ok) {
            const models = await response.json();
            const selector = document.getElementById('defaultModel');
            selector.innerHTML = models.map(model => 
                `<option value="${model.id}" ${model.recommended ? 'selected' : ''}>
                    ${model.name} (${model.category})
                </option>`
            ).join('');
        }
    } catch (error) {
        console.error('Errore caricamento modelli Claude:', error);
    }
}

// ========================================
//  Gestione Azioni Utente
// ========================================

function goBack() {
    window.location.href = '/';
}

async function testConnection(service) {
    const credentials = {};
    let apiKey;

    switch(service) {
        case 'claude':
            apiKey = document.getElementById('claudeApiKey').value;
            if (!apiKey) {
                showToast('Inserisci una API key per testare', 'warning');
                return;
            }
            credentials.apiKey = apiKey;
            break;
        case 'clickup_token':
            apiKey = document.getElementById('clickupApiKey').value;
            if (!apiKey) {
                showToast('Inserisci la ClickUp API Key per testare', 'warning');
                return;
            }
            credentials.apiKey = apiKey;
            break;
        // Aggiungere logica per altri servizi se necessario
        default:
            showToast(`Test per ${service} non implementato`, 'warning');
            return;
    }

    try {
        const response = await fetch(`${API_BASE}/api/test/connection`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ service, credentials })
        });
        const result = await response.json();

        if (result.success) {
            showToast(`Connessione ${service} riuscita!`, 'success');
        } else {
            showToast(`Test ${service} fallito: ${result.error}`, 'error');
        }
    } catch (error) {
        showToast(`Errore nel test di ${service}`, 'error');
    }
}

async function saveConfiguration() {
    const config = {
        claude_api_key: document.getElementById('claudeApiKey').value,
        google_client_id: document.getElementById('googleClientId').value,
        google_client_secret: document.getElementById('googleClientSecret').value,
        clickup_client_id: document.getElementById('clickupClientId').value,
        clickup_client_secret: document.getElementById('clickupClientSecret').value,
        clickup_api_key: document.getElementById('clickupApiKey').value,
        allowed_domain: document.getElementById('allowedDomain').value
    };

    // Filtra solo i valori inseriti per non sovrascrivere le chiavi esistenti con stringhe vuote
    const updatedConfig = Object.fromEntries(
        Object.entries(config).filter(([_, value]) => value.trim() !== '')
    );

    if (Object.keys(updatedConfig).length === 0) {
        showToast('Nessuna nuova configurazione da salvare', 'warning');
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/api/config/save`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ config: updatedConfig })
        });

        const result = await response.json();

        if (response.ok) {
            showToast('Configurazione salvata con successo!', 'success');
            // Ricarica lo stato per aggiornare i badge
            await loadConfigurationStatus();
        } else {
            throw new Error(result.error || 'Errore nel salvataggio');
        }
    } catch (error) {
        showToast(`Salvataggio fallito: ${error.message}`, 'error');
    }
}

async function savePreferences() {
    const preferences = {
        selectedModel: document.getElementById('defaultModel').value
    };

    try {
        const response = await fetch(`${API_BASE}/api/user/preferences`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(preferences)
        });

        if (response.ok) {
            showToast('Preferenze salvate!', 'success');
        } else {
            const result = await response.json();
            throw new Error(result.error || 'Errore nel salvataggio delle preferenze');
        }
    } catch (error) {
        showToast(`Salvataggio fallito: ${error.message}`, 'error');
    }
}

// ========================================
//  Funzioni di Utilità UI
// ========================================

function updateStatusBadge(elementId, isConfigured, serviceName, isOptional = false) {
    const badge = document.getElementById(elementId);
    if (isConfigured) {
        badge.textContent = 'Configurato';
        badge.className = 'status-badge success';
    } else {
        badge.textContent = isOptional ? 'Opzionale' : 'Non configurato';
        badge.className = isOptional ? 'status-badge warning' : 'status-badge error';
    }
}

function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;

    container.appendChild(toast);

    setTimeout(() => {
        toast.remove();
    }, 3000);
}

// =============================
// Admin Settings UI Logic
// =============================

(function(){
    // Map form element IDs to config keys
    const map = {
        FRONTEND_URL: 'frontend_url',
        DRIVE_MAX_BYTES: 'drive_max_bytes',
        DRIVE_CACHE_TTL: 'drive_cache_ttl',
        CLICKUP_CACHE_TTL: 'clickup_cache_ttl',
        CLICKUP_TEAM_ID: 'clickup_team_id',
        MAX_DRIVE_FILES_TO_FETCH: 'max_drive_files',
        MAX_CLICKUP_TASKS_ENRICH: 'max_clickup_tasks_enrich',
        DRIVE_EXPORT_MAX_CHARS: 'drive_export_max_chars',
        ENABLE_PDF_PARSE: 'enable_pdf_parse'
    };

    function isAdminUserLocal(){
        try { return window.CURRENT_USER && window.CURRENT_USER.isAdmin; } catch(e){ return false; }
    }

    async function fetchAdminSettings(){
        const msg = document.getElementById('admin-settings-msg');
        if(msg) msg.textContent = 'Caricamento...';
        try {
            const res = await fetch('/api/config/settings', { credentials: 'include' });
            if(!res.ok) throw new Error('Impossibile caricare');
            const json = await res.json();
            const settings = json.settings || {};
            const defaults = json.defaults || {};
            Object.keys(map).forEach(key=>{
                const el = document.getElementById(map[key]);
                if(!el) return;
                if(settings.hasOwnProperty(key)) el.value = settings[key];
                else if(defaults.hasOwnProperty(key)) el.value = defaults[key];
            });
            if(msg) msg.textContent = '';
        } catch(err){
            if(msg) msg.textContent = 'Errore caricamento impostazioni';
            console.error(err);
        }
    }

    function collectAdminSettings(){
        const out = {};
        Object.keys(map).forEach(key=>{
            const el = document.getElementById(map[key]);
            if(!el) return;
            let v = el.value;
            if(el.type === 'number') v = Number(v);
            if(key === 'ENABLE_PDF_PARSE') v = (v === 'true' || v === true);
            out[key] = v;
        });
        return out;
    }

    async function saveAdminSettings(ev){
        if(ev) ev.preventDefault();
        const msg = document.getElementById('admin-settings-msg');
        if(msg) msg.textContent = 'Salvataggio...';
        const payload = collectAdminSettings();
        try {
            const res = await fetch('/api/config/settings', {
                method: 'PUT',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ settings: payload })
            });
            const json = await res.json();
            if(res.ok && json.success){
                if(msg) msg.textContent = 'Impostazioni salvate';
            } else {
                if(msg) msg.textContent = 'Salvataggio fallito';
            }
        } catch(err){
            if(msg) msg.textContent = 'Errore salvataggio';
            console.error(err);
        }
    }

    async function restoreDefaults(ev){
        if(ev) ev.preventDefault();
        const msg = document.getElementById('admin-settings-msg');
        if(msg) msg.textContent = 'Ripristino default...';
        try {
            const res = await fetch('/api/config/settings?action=defaults', {
                method: 'PUT', credentials: 'include'
            });
            const json = await res.json();
            if(res.ok && json.defaults){
                Object.keys(map).forEach(key=>{
                    const el = document.getElementById(map[key]);
                    if(!el) return;
                    if(json.defaults.hasOwnProperty(key)) el.value = json.defaults[key];
                });
                if(msg) msg.textContent = 'Default ripristinati';
            } else {
                if(msg) msg.textContent = 'Restore fallito';
            }
        } catch(err){
            if(msg) msg.textContent = 'Errore durante il ripristino';
            console.error(err);
        }
    }

    // Wire on DOM ready
    document.addEventListener('DOMContentLoaded', ()=>{
        const admin = isAdminUserLocal();
        const adminTabBtn = document.getElementById('tab-admin-settings');
        const adminSection = document.getElementById('admin-settings-section');
        if(adminTabBtn) adminTabBtn.style.display = admin ? 'inline-block' : 'none';
        if(adminSection) adminSection.style.display = admin ? 'block' : 'none';
        if(!admin) return;
        const form = document.getElementById('admin-settings-form');
        if(form) form.addEventListener('submit', saveAdminSettings);
        const restoreBtn = document.getElementById('admin-settings-restore');
        if(restoreBtn) restoreBtn.addEventListener('click', restoreDefaults);
        if(adminTabBtn) adminTabBtn.addEventListener('click', ()=>{
            const sections = document.querySelectorAll('.settings-section');
            sections.forEach(s=> s.style.display = 'none');
            adminSection.style.display = 'block';
        });
        fetchAdminSettings();
    });

})();
