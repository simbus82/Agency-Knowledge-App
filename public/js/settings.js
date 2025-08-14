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

        // Aggiorna stato ClickUp
        updateStatusBadge('clickupStatus', config.clickup, 'ClickUp OAuth', true);
        if (config.clickup) {
            document.getElementById('clickupClientId').placeholder = '••••••••••••••••••••';
            document.getElementById('clickupClientSecret').placeholder = '••••••••••••••••••••';
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
