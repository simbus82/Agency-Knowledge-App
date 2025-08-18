# update-from-github.ps1 - Aggiorna il progetto da GitHub in modo sicuro su Windows

<#
Esegue:
- backup di .env, data e logs
- stash delle modifiche locali
- pull dal branch principale
- restore dei file di configurazione
- installazione delle dipendenze (npm ci / npm install)
- build/test opzionali

Eseguire in PowerShell con Git e Node.js disponibili nel PATH.
Esempio: Open PowerShell, posizionarsi nella cartella del progetto e lanciare:
    .\update-from-github.ps1
#>

Write-Host "🔄 Aggiornamento 56k Knowledge Hub da GitHub..." -ForegroundColor Green
try {
    $version = (Get-Content package.json -Raw | ConvertFrom-Json).version
} catch { $version = 'unknown' }
Write-Host "📦 Versione corrente (package.json): $version" -ForegroundColor Yellow

function Write-Info([string]$m){ Write-Host "✅ $m" -ForegroundColor Green }
function Write-Warn([string]$m){ Write-Host "⚠️  $m" -ForegroundColor Yellow }
function Write-ErrorCustom([string]$m){ Write-Host "❌ $m" -ForegroundColor Red }

# Step 1: Backup
Write-Info "Backup configurazione..."
if (Test-Path -Path ".env") {
    Copy-Item -Path ".env" -Destination ".env.backup" -Force
    Write-Info ".env salvato come .env.backup"
} else {
    Write-Warn ".env non trovato"
}

if (Test-Path -Path "data") {
    Remove-Item -LiteralPath "data-backup" -Recurse -Force -ErrorAction SilentlyContinue
    Copy-Item -Path "data" -Destination "data-backup" -Recurse -Force
    Write-Info "Cartella data salvata"
}

if (Test-Path -Path "logs") {
    Remove-Item -LiteralPath "logs-backup" -Recurse -Force -ErrorAction SilentlyContinue
    Copy-Item -Path "logs" -Destination "logs-backup" -Recurse -Force
    Write-Info "Cartella logs salvata"
}

# Step 2: Git operations
Write-Info "Salvataggio modifiche locali (stash)..."
# Aggiungi e stasha modifiche locali (non fallisce se non ci sono modifiche)
git add -A 2>$null
try {
    git stash push -u -m "pre-update-$(Get-Date -Format yyyyMMddHHmm)" 2>$null | Out-Null
    Write-Info "Modifiche locali stashed"
} catch {
    Write-Warn "Nessun cambio da stashare o errore nello stash"
}

Write-Info "Scaricamento aggiornamenti..."
# prova a fare pull dal branch principale (main), adatta se usi master
$branch = "main"
try {
    $current = git rev-parse --abbrev-ref HEAD 2>$null
} catch {
    Write-ErrorCustom "Non sono nella directory di un repository Git o Git non è nel PATH."
    exit 1
}

if ($null -ne $current) {
    if (git fetch origin $branch) {
        if (git pull --rebase origin $branch) {
            Write-Info "Repository aggiornato (rebase)"
        } else {
            Write-ErrorCustom "git pull --rebase fallito. Prova a risolvere i conflitti manualmente."
            exit 1
        }
    } else {
    Write-ErrorCustom "git fetch fallito"
        exit 1
    }
}

# Step 3: Restore configuration
Write-Info "Ripristino configurazione..."
if (Test-Path -Path ".env.backup") {
    Copy-Item -Path ".env.backup" -Destination ".env" -Force
    Write-Info ".env ripristinato da .env.backup"
} else {
    Write-Warn "Nessun .env.backup trovato; controlla il backup manuale se necessario."
}

if (Test-Path -Path "data-backup") {
    Remove-Item -Path "data" -Recurse -Force -ErrorAction SilentlyContinue
    Copy-Item -Path "data-backup" -Destination "data" -Recurse -Force
    Write-Info "Dati ripristinati"
}

if (Test-Path -Path "logs-backup") {
    Remove-Item -Path "logs" -Recurse -Force -ErrorAction SilentlyContinue
    Copy-Item -Path "logs-backup" -Destination "logs" -Recurse -Force
    Write-Info "Logs ripristinati"
}

# Step 4: Dependencies
Write-Info "Aggiornamento dipendenze..."
if (Test-Path -Path "package-lock.json") {
    # preferisci install pulito in ambienti controllati
    if (npm ci) {
    Write-Info "Dipendenze installate con npm ci"
    } else {
    Write-Warn "npm ci fallito, provo npm install..."
        npm install
    }
} else {
    if (npm install) {
    Write-Info "Dipendenze installate"
    } else {
    Write-Warn "Problemi con le dipendenze, rimuovo node_modules e riprovo..."
        Remove-Item -Path "node_modules" -Recurse -Force -ErrorAction SilentlyContinue
        Remove-Item -Path "package-lock.json" -Force -ErrorAction SilentlyContinue
        npm install
    }
}

# Step 5: Quality / test / audit
if (Get-Command npm -ErrorAction SilentlyContinue) {
    $pkgRaw = ''
    try { $pkgRaw = Get-Content package.json -Raw } catch {}
    if ($pkgRaw -match '"quality"') {
        Write-Info "Esecuzione quality (lint + test)..."
        try { npm run quality } catch { Write-Warn "Quality fallita (continua)" }
    } elseif ($pkgRaw -match '"test"') {
        Write-Info "Esecuzione test..."
        try { npm test } catch { Write-Warn "Test falliti" }
    }
        Write-Info "Security audit (non bloccante)..."
        try { npm audit --production } catch { Write-Warn "Audit con vulnerabilità o fallito" }
    if (Test-Path .env) {
        try { $envRaw = Get-Content .env -Raw } catch { $envRaw = '' }
        if ($envRaw -notmatch 'TOKEN_ENC_KEY=') {
            Write-Warn "TOKEN_ENC_KEY mancante in .env (crittografia token refresh non attiva)"
        }
    }
}

# Step 6: Final info and git log
Write-Host ""
Write-Info "🎉 Aggiornamento completato!"
Write-Host ""
Write-Host "📋 Prossimi passi:"
Write-Host "   1. Avvia il backend: npm start"
Write-Host "   2. Avvia il frontend (se separato): npm run frontend o secondo la documentazione"
Write-Host "   3. Vai su: http://localhost:8080 (o porta configurata)"
Write-Host ""
Write-Host "📝 Ultimi commit:"
try { git --no-pager log --oneline -5 } catch { }
