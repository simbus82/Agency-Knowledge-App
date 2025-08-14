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

function Log-Info([string]$m){ Write-Host "✅ $m" -ForegroundColor Green }
function Log-Warn([string]$m){ Write-Host "⚠️  $m" -ForegroundColor Yellow }
function Log-Error([string]$m){ Write-Host "❌ $m" -ForegroundColor Red }

# Step 1: Backup
Log-Info "Backup configurazione..."
if (Test-Path -Path ".env") {
    Copy-Item -Path ".env" -Destination ".env.backup" -Force
    Log-Info ".env salvato come .env.backup"
} else {
    Log-Warn ".env non trovato"
}

if (Test-Path -Path "data") {
    Remove-Item -LiteralPath "data-backup" -Recurse -Force -ErrorAction SilentlyContinue
    Copy-Item -Path "data" -Destination "data-backup" -Recurse -Force
    Log-Info "Cartella data salvata"
}

if (Test-Path -Path "logs") {
    Remove-Item -LiteralPath "logs-backup" -Recurse -Force -ErrorAction SilentlyContinue
    Copy-Item -Path "logs" -Destination "logs-backup" -Recurse -Force
    Log-Info "Cartella logs salvata"
}

# Step 2: Git operations
Log-Info "Salvataggio modifiche locali (stash)..."
# Aggiungi e stasha modifiche locali (non fallisce se non ci sono modifiche)
git add -A 2>$null
try {
    git stash push -u -m "pre-update-$(Get-Date -Format yyyyMMddHHmm)" 2>$null | Out-Null
    Log-Info "Modifiche locali stashed"
} catch {
    Log-Warn "Nessun cambio da stashare o errore nello stash"
}

Log-Info "Scaricamento aggiornamenti..."
# prova a fare pull dal branch principale (main), adatta se usi master
$branch = "main"
try {
    $current = git rev-parse --abbrev-ref HEAD 2>$null
} catch {
    Log-Error "Non sono nella directory di un repository Git o Git non è nel PATH."
    exit 1
}

if ($current -ne $null) {
    if (git fetch origin $branch) {
        if (git pull --rebase origin $branch) {
            Log-Info "Repository aggiornato (rebase)"
        } else {
            Log-Error "git pull --rebase fallito. Prova a risolvere i conflitti manualmente."
            exit 1
        }
    } else {
        Log-Error "git fetch fallito"
        exit 1
    }
}

# Step 3: Restore configuration
Log-Info "Ripristino configurazione..."
if (Test-Path -Path ".env.backup") {
    Copy-Item -Path ".env.backup" -Destination ".env" -Force
    Log-Info ".env ripristinato da .env.backup"
} else {
    Log-Warn "Nessun .env.backup trovato; controlla il backup manuale se necessario."
}

if (Test-Path -Path "data-backup") {
    Remove-Item -Path "data" -Recurse -Force -ErrorAction SilentlyContinue
    Copy-Item -Path "data-backup" -Destination "data" -Recurse -Force
    Log-Info "Dati ripristinati"
}

if (Test-Path -Path "logs-backup") {
    Remove-Item -Path "logs" -Recurse -Force -ErrorAction SilentlyContinue
    Copy-Item -Path "logs-backup" -Destination "logs" -Recurse -Force
    Log-Info "Logs ripristinati"
}

# Step 4: Dependencies
Log-Info "Aggiornamento dipendenze..."
if (Test-Path -Path "package-lock.json") {
    # preferisci install pulito in ambienti controllati
    if (npm ci) {
        Log-Info "Dipendenze installate con npm ci"
    } else {
        Log-Warn "npm ci fallito, provo npm install..."
        npm install
    }
} else {
    if (npm install) {
        Log-Info "Dipendenze installate"
    } else {
        Log-Warn "Problemi con le dipendenze, rimuovo node_modules e riprovo..."
        Remove-Item -Path "node_modules" -Recurse -Force -ErrorAction SilentlyContinue
        Remove-Item -Path "package-lock.json" -Force -ErrorAction SilentlyContinue
        npm install
    }
}

# Step 5: Optional build/test
if (Get-Command npm -ErrorAction SilentlyContinue) {
    if (Get-Content package.json -ErrorAction SilentlyContinue | Select-String -Pattern '"test"' -Quiet) {
        Log-Info "Esecuzione test..."
        try {
            npm test *> $null
            Log-Info "Test eseguiti (vedi output per dettagli)"
        } catch {
            Log-Warn "Alcuni test sono falliti o non sono configurati"
        }
    }
    if (Get-Content package.json -ErrorAction SilentlyContinue | Select-String -Pattern '"build"' -Quiet) {
        Log-Info "Eseguo build (npm run build)..."
        try {
            npm run build
            Log-Info "Build completata"
        } catch {
            Log-Warn "Build fallita o non necessaria"
        }
    }
}

# Step 6: Final info and git log
Write-Host ""
Log-Info "🎉 Aggiornamento completato!"
Write-Host ""
Write-Host "📋 Prossimi passi:"
Write-Host "   1. Avvia il backend: npm start"
Write-Host "   2. Avvia il frontend (se separato): npm run frontend o secondo la documentazione"
Write-Host "   3. Vai su: http://localhost:8080 (o porta configurata)"
Write-Host ""
Write-Host "📝 Ultimi commit:"
try { git --no-pager log --oneline -5 } catch { }
