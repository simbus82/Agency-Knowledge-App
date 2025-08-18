#!/bin/bash
# update-from-github.sh - Script per aggiornare il progetto da GitHub

echo "🔄 Aggiornamento 56k Knowledge Hub da GitHub..."
VERSION=$(node -p "require('./package.json').version" 2>/dev/null || echo "unknown")
echo "📦 Versione corrente (package.json): $VERSION"

# Colori per output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Funzione per log colorati
log_info() { echo -e "${GREEN}✅ $1${NC}"; }
log_warn() { echo -e "${YELLOW}⚠️  $1${NC}"; }
log_error() { echo -e "${RED}❌ $1${NC}"; }

# Step 1: Backup
log_info "Backup configurazione..."
if [ -f .env ]; then
    cp .env .env.backup
    log_info "File .env salvato"
else
    log_warn "File .env non trovato"
fi

if [ -d data ]; then
    cp -r data/ data-backup/
    log_info "Cartella data salvata"
fi

if [ -d logs ]; then
    cp -r logs/ logs-backup/
    log_info "Cartella logs salvata"
fi

# Step 2: Git operations
log_info "Salvataggio modifiche locali..."
git add . 2>/dev/null
git stash 2>/dev/null

log_info "Scaricamento aggiornamenti..."
if git pull origin main; then
    log_info "Repository aggiornato con successo"
else
    log_error "Errore nell'aggiornamento repository"
    exit 1
fi

# Step 3: Restore configuration
log_info "Ripristino configurazione..."
if [ -f .env.backup ]; then
    cp .env.backup .env
    log_info "Configurazione ripristinata"
fi

if [ -d data-backup ]; then
    cp -r data-backup/ data/
    log_info "Dati ripristinati"
fi

if [ -d logs-backup ]; then
    cp -r logs-backup/ logs/
    log_info "Log ripristinati"
fi

# Step 4: Dependencies
log_info "Aggiornamento dipendenze..."
if npm install; then
    log_info "Dipendenze aggiornate"
else
    log_warn "Problemi con le dipendenze, provo reinstallazione pulita..."
    rm -rf node_modules package-lock.json
    npm install
fi

# Step 5: Test
log_info "Verifica quality/test..."
if grep -q '"quality"' package.json 2>/dev/null; then
    if npm run quality; then
        log_info "Quality check completato"
    else
        log_warn "Quality check fallito (lint o test)"
    fi
elif npm test > /dev/null 2>&1; then
    if npm test; then
        log_info "Test superati"
    else
        log_warn "Test falliti"
    fi
fi

log_info "Security audit (non bloccante)..."
if npm audit --production; then
    log_info "Audit completato"
else
    log_warn "Audit ha rilevato vulnerabilità"
fi

if [ -f .env ]; then
    if ! grep -q '^TOKEN_ENC_KEY=' .env; then
        log_warn "TOKEN_ENC_KEY mancante in .env (crittografia token non attiva)"
    fi
fi

# Step 6: Cleanup
log_info "Pulizia file temporanei..."
rm -f .env.backup
rm -rf data-backup logs-backup

# Summary
echo ""
log_info "🎉 Aggiornamento completato!"
echo ""
echo "📋 Prossimi passi:"
echo "   1. Avvia il backend: npm start"
echo "   2. Avvia il frontend: npm run frontend"
echo "   3. Vai su: http://localhost:8080"
echo ""

# Show latest changes
echo "📝 Ultimi aggiornamenti:"
git log --oneline -5