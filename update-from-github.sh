#!/usr/bin/env bash
# update-from-github.sh - Aggiornamento sicuro da GitHub (Linux/macOS)
# Opzioni:
#   -b|--branch <branch>    Branch da aggiornare (default: main)
#   -n|--dry-run            Simula senza modificare
#   -t|--skip-tests         Salta test / quality
#   -a|--skip-audit         Salta npm audit
#   -h|--help               Mostra aiuto

set -euo pipefail

BRANCH="main"
DRY_RUN=false
SKIP_TESTS=false
SKIP_AUDIT=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        -b|--branch) BRANCH="$2"; shift 2;;
        -n|--dry-run) DRY_RUN=true; shift;;
        -t|--skip-tests) SKIP_TESTS=true; shift;;
        -a|--skip-audit) SKIP_AUDIT=true; shift;;
        -h|--help)
            echo "Uso: $0 [-b branch] [-n|--dry-run] [-t|--skip-tests] [-a|--skip-audit]"; exit 0;;
        *) echo "Argomento sconosciuto: $1"; exit 1;;
    esac
done

echo "🔄 Aggiornamento 56k Knowledge Hub da GitHub (branch: $BRANCH)..."
[[ "$DRY_RUN" == true ]] && echo "(DRY RUN - nessuna modifica persistente)"
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

# Step 0: Checks
if ! command -v git >/dev/null 2>&1; then log_warn "Git non trovato"; fi
if ! command -v node >/dev/null 2>&1; then log_warn "Node non trovato"; fi
if ! command -v npm >/dev/null 2>&1; then log_warn "NPM non trovato"; fi

# Step 1: Backup (skippato in dry run)
log_info "Backup configurazione..."
if [[ "$DRY_RUN" == false ]]; then
    if [ -f .env ]; then cp .env .env.backup; log_info "File .env salvato"; else log_warn ".env non trovato"; fi
    if [ -d data ]; then rm -rf data-backup 2>/dev/null || true; cp -r data data-backup; log_info "Cartella data salvata"; fi
    if [ -d logs ]; then rm -rf logs-backup 2>/dev/null || true; cp -r logs logs-backup; log_info "Cartella logs salvata"; fi
else
    log_warn "Dry run: backup saltato"
fi

# Step 2: Git operations
log_info "Salvataggio modifiche locali..."
if [[ "$DRY_RUN" == false ]]; then
    git add -A 2>/dev/null || true
    STASH_LABEL="pre-update-$(date +%Y%m%d%H%M%S)"
    if git stash push -u -m "$STASH_LABEL" >/dev/null 2>&1; then
        log_info "Modifiche locali stashed ($STASH_LABEL)"
    else
        log_warn "Nessuna modifica da stashare"
    fi
else
    log_warn "Dry run: stash saltato"
fi

log_info "Scaricamento aggiornamenti (branch: $BRANCH)..."
if [[ "$DRY_RUN" == false ]]; then
    if git fetch origin "$BRANCH" && git pull --rebase origin "$BRANCH"; then
        log_info "Repository aggiornato (rebase)"
    else
        log_error "Aggiornamento fallito (fetch/pull)"; exit 1
    fi
else
    log_warn "Dry run: fetch/pull saltati"
fi

# Step 3: Restore configuration
log_info "Ripristino configurazione..."
if [[ "$DRY_RUN" == false ]]; then
    if [ -f .env.backup ]; then cp .env.backup .env; log_info ".env ripristinato"; else log_warn ".env.backup mancante"; fi
    if [ -d data-backup ]; then rm -rf data 2>/dev/null || true; cp -r data-backup data; log_info "Dati ripristinati"; fi
    if [ -d logs-backup ]; then rm -rf logs 2>/dev/null || true; cp -r logs-backup logs; log_info "Logs ripristinati"; fi
else
    log_warn "Dry run: ripristino saltato"
fi

# Step 4: Dependencies
log_info "Aggiornamento dipendenze..."
if [[ "$DRY_RUN" == false ]]; then
    if [ -f package-lock.json ]; then
        if npm ci; then log_info "Dipendenze installate (ci)"; else log_warn "npm ci fallito, fallback install"; npm install; fi
    else
        if npm install; then log_info "Dipendenze installate"; else log_warn "Tentativo reinstall pulita"; rm -rf node_modules package-lock.json; npm install; fi
    fi
else
    log_warn "Dry run: install dipendenze saltato"
fi

# Step 5: Test / Quality / Audit
if [[ "$DRY_RUN" == false ]]; then
    if [[ "$SKIP_TESTS" == false ]]; then
        log_info "Verifica quality/test..."
        if grep -q '"quality"' package.json 2>/dev/null; then
            if npm run quality; then log_info "Quality check ok"; else log_warn "Quality check fallito"; fi
        elif grep -q '"test"' package.json 2>/dev/null; then
            if npm test; then log_info "Test ok"; else log_warn "Test falliti"; fi
        fi
    else
        log_warn "Skip tests attivo"
    fi
    if [[ "$SKIP_AUDIT" == false ]]; then
        log_info "Security audit (non bloccante)..."
        if npm audit --production; then log_info "Audit ok"; else log_warn "Audit vulnerabilità"; fi
    else
        log_warn "Skip audit attivo"
    fi
    if [ -f .env ] && ! grep -q '^TOKEN_ENC_KEY=' .env; then log_warn "TOKEN_ENC_KEY mancante in .env"; fi
else
    log_warn "Dry run: test/audit saltati"
fi

# Step 6: Cleanup (non distruttivo in dry run)
log_info "Pulizia file temporanei..."
if [[ "$DRY_RUN" == false ]]; then
    rm -f .env.backup 2>/dev/null || true
    rm -rf data-backup logs-backup 2>/dev/null || true
else
    log_warn "Dry run: cleanup saltato (backups conservati)"
fi

# Summary
echo ""
log_info "🎉 Aggiornamento completato!"
[[ "$DRY_RUN" == true ]] && log_warn "Dry run: nessuna modifica persistente" || true
[[ -n "${STASH_LABEL:-}" ]] && echo "   Stash: $STASH_LABEL (git stash list)"
echo ""
echo "📋 Prossimi passi:"
echo "   1. Avvia il backend: npm start"
echo "   2. Avvia il frontend: npm run frontend"
echo "   3. Vai su: http://localhost:8080"
echo ""

# Show latest changes
echo "📝 Ultimi aggiornamenti:"
git log --oneline -5