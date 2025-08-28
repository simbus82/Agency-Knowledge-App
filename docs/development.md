# Development Guidelines

## Scripts
```
npm run dev:all
npm run test
npm run test:ai
npm run release:prep
```

### Update Scripts (Git Pull Automation)
PowerShell (Windows):
```
./update-from-github.ps1 [-Branch main] [-SkipTests] [-SkipAudit] [-DryRun]
```
Bash (Linux/macOS):
```
./update-from-github.sh [--branch main] [--skip-tests] [--skip-audit] [--dry-run]
```
Notes:
- Dry run prints planned operations (no writes).
- Uses git stash push -u with timestamp label before pulling (safe even if no changes).
- Pull strategy: fetch + rebase (conflict resolves manually then rerun).
- Installs dependencies (npm ci if lockfile present, otherwise npm install).
- Optional skip for test/audit to speed up hotfix rollout.


## Stile
- JS moderno (ES2022) senza transpilation
- Evita ottimizzazioni premature
- Commenti per blocchi logica AI

## Test
- `test-connections.js` per sanità integrazioni (carica solo tool disponibili)
- Aggiungere test mirati su nuovi connettori / planner output
- (Futuro) test snapshot Task Graph per query tipiche

## Commit
- Prefissi: feat:, fix:, chore:, docs:, refactor:
- Tenere CHANGELOG aggiornato con release:prep

## Performance Tips
- Memorizza risultati costosi (cache helper)
- Evita loop fetch sequenziali (usa Promise.all dove sicuro)
- Limita dimensione output tool (pre-trimming)
- Usa gating env per disattivare connettori non necessari in dev

## Connettori
- Aggiungi file in `src/connectors/`
- Registra funzioni nel tool registry (`executeGraph.js`)
- Non forzare caricamento se env mancano (return null / skip)
- Documenta variabili correlate

## Futuro Possibile
- Linter + formatter standard (ESLint + Prettier)
- Test unitari per engine memoria
- Benchmark token usage

