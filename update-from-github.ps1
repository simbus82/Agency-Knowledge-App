param(
    [switch]$SkipTests,
    [switch]$SkipAudit,
    [switch]$DryRun,
    [string]$Branch = 'main'
)

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
if($DryRun){ Write-Host "(DRY RUN - nessuna modifica persistente verrà applicata)" -ForegroundColor Yellow }
try {
    $version = (Get-Content package.json -Raw | ConvertFrom-Json).version
} catch { $version = 'unknown' }
Write-Host "📦 Versione corrente (package.json): $version" -ForegroundColor Yellow

function Write-Info([string]$m){ Write-Host "✅ $m" -ForegroundColor Green }
function Write-Warn([string]$m){ Write-Host "⚠️  $m" -ForegroundColor Yellow }
function Write-ErrorCustom([string]$m){ Write-Host "❌ $m" -ForegroundColor Red }

# Step 0: Verifica versione Node / Git
try { $nodeVer = (node -v) } catch { $nodeVer = 'node NON trovato' }
try { $gitVer = (git --version) } catch { $gitVer = 'git NON trovato' }
Write-Info "Node: $nodeVer | Git: $gitVer"
if($nodeVer -eq 'node NON trovato' -or $gitVer -eq 'git NON trovato') { Write-Warn "Prerequisiti mancanti (Node/Git)." }

# Step 1: Backup
Write-Info "Backup configurazione..."
if($DryRun){ Write-Warn "DRY RUN: salto copia backup" } else {
    if (Test-Path -Path ".env") {
        Copy-Item -Path ".env" -Destination ".env.backup" -Force
        Write-Info ".env salvato come .env.backup"
    } else { Write-Warn ".env non trovato" }
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
}

# Step 2: Git operations
Write-Info "Salvataggio modifiche locali (stash)..."
if(-not $DryRun){
    git add -A 2>$null
    $stashLabel = "pre-update-$(Get-Date -Format yyyyMMddHHmmss)"
    try {
    git stash push -u -m $stashLabel 2>$null | Out-Null
    if($LASTEXITCODE -eq 0){ Write-Info "Modifiche locali stashed ($stashLabel)" } else { Write-Warn "Nessuna modifica da stashare" }
    } catch { Write-Warn "Nessun cambio da stashare o errore nello stash" }
} else { Write-Warn "DRY RUN: salto stash" }

Write-Info "Scaricamento aggiornamenti... (branch: $Branch)"
try {
    $current = git rev-parse --abbrev-ref HEAD 2>$null
} catch {
    Write-ErrorCustom "Non sono nella directory di un repository Git o Git non è nel PATH."
    exit 1
}

if ($null -ne $current -and -not $DryRun) {
    if (git fetch origin $Branch) {
        if (git pull --rebase origin $Branch) { Write-Info "Repository aggiornato (rebase)" }
        else { Write-ErrorCustom "git pull --rebase fallito. Risolvi i conflitti e ripeti."; exit 1 }
    } else { Write-ErrorCustom "git fetch fallito"; exit 1 }
} elseif($DryRun){ Write-Warn "DRY RUN: salto fetch/pull" }

# Step 3: Restore configuration
Write-Info "Ripristino configurazione..."
if(-not $DryRun){
    if (Test-Path -Path ".env.backup") { Copy-Item -Path ".env.backup" -Destination ".env" -Force; Write-Info ".env ripristinato" } else { Write-Warn "Nessun .env.backup" }
    if (Test-Path -Path "data-backup") { Remove-Item -Path "data" -Recurse -Force -ErrorAction SilentlyContinue; Copy-Item -Path "data-backup" -Destination "data" -Recurse -Force; Write-Info "Dati ripristinati" }
    if (Test-Path -Path "logs-backup") { Remove-Item -Path "logs" -Recurse -Force -ErrorAction SilentlyContinue; Copy-Item -Path "logs-backup" -Destination "logs" -Recurse -Force; Write-Info "Logs ripristinati" }
} else { Write-Warn "DRY RUN: salto ripristino" }

# Step 4: Dependencies
Write-Info "Aggiornamento dipendenze..."
if(-not $DryRun){
    if (Test-Path -Path "package-lock.json") {
        if (npm ci) { Write-Info "Dipendenze installate (ci)" } else { Write-Warn "npm ci fallito, provo npm install..."; npm install }
    } else {
        if (npm install) { Write-Info "Dipendenze installate" } else { Write-Warn "Ripulisco e riprovo"; Remove-Item -Path "node_modules" -Recurse -Force -ErrorAction SilentlyContinue; Remove-Item -Path "package-lock.json" -Force -ErrorAction SilentlyContinue; npm install }
    }
} else { Write-Warn "DRY RUN: salto install dipendenze" }

# Step 5: Quality / test / audit
if (-not $DryRun -and (Get-Command npm -ErrorAction SilentlyContinue)) {
    $pkgRaw = ''; try { $pkgRaw = Get-Content package.json -Raw } catch {}
    if(-not $SkipTests){
        if ($pkgRaw -match '"quality"') { Write-Info "Esecuzione quality..."; try { npm run quality } catch { Write-Warn "Quality fallita (continua)" } }
        elseif ($pkgRaw -match '"test"') { Write-Info "Esecuzione test..."; try { npm test } catch { Write-Warn "Test falliti" } }
    } else { Write-Warn "SkipTests attivo" }
    if(-not $SkipAudit){ Write-Info "Security audit (non bloccante)..."; try { npm audit --production } catch { Write-Warn "Audit fallito" } } else { Write-Warn "SkipAudit attivo" }
    if (Test-Path .env) { try { $envRaw = Get-Content .env -Raw } catch { $envRaw = '' }; if ($envRaw -notmatch 'TOKEN_ENC_KEY=') { Write-Warn "TOKEN_ENC_KEY mancante in .env" } }
} elseif($DryRun){ Write-Warn "DRY RUN: salto tests/audit" }

# Step 6: Final info and git log
Write-Host ""
Write-Info "🎉 Aggiornamento completato!"
if($stashLabel){ Write-Host "   Stash creato: $stashLabel (usa 'git stash list' / 'git stash pop')" }
if($DryRun){ Write-Warn "DRY RUN: nessun file modificato permanentemente" }
Write-Host ""
Write-Host "📋 Prossimi passi:"
Write-Host "   1. Avvia il backend: npm start"
Write-Host "   2. Avvia il frontend (se separato): npm run frontend o secondo la documentazione"
Write-Host "   3. Vai su: http://localhost:8080 (o porta configurata)"
Write-Host ""
Write-Host "📝 Ultimi commit:"
try { git --no-pager log --oneline -5 } catch { }
