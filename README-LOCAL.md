# Guida Rapida Locale (Developer Friendly)

Questa è la versione super sintetica per lavorare sul progetto senza perdersi nei dettagli.

## 1. Avvio veloce
```bash
# Installazione (solo la prima volta o se cambia package.json)
npm install

# Avvio simultaneo backend + frontend (sviluppo)
npm run dev:all

# Oppure avvio stile produzione (senza autoreload)
npm run start:all
```
Frontend: http://localhost:8080  
Backend:  http://localhost:3000  
Health:   http://localhost:3000/health  
Versione: http://localhost:3000/version

## 2. Aggiornare il codice da GitHub (ambiente dove gira)
Metodo base manuale:
```bash
git pull
npm install
npm run start:all   # o restart se già in esecuzione
```
Script aggiornamento (automazione completa):
PowerShell (Windows):
```powershell
./update-from-github.ps1 [-Branch main] [-SkipTests] [-SkipAudit] [-DryRun]
```
Esempi:
```powershell
./update-from-github.ps1                       # aggiornamento standard
./update-from-github.ps1 -DryRun               # simulazione senza modifiche
./update-from-github.ps1 -Branch feature/x     # aggiorna da branch specifico
./update-from-github.ps1 -SkipTests -SkipAudit # più veloce, niente test/audit
```
Bash (Linux/macOS):
```bash
./update-from-github.sh [--branch main] [--dry-run] [--skip-tests] [--skip-audit]
```
Esempi:
```bash
./update-from-github.sh --dry-run
./update-from-github.sh --branch release/0.9.1
./update-from-github.sh --skip-tests --skip-audit
```
Funzioni chiave:
- Backup automatico (.env, data/, logs/) + restore
- Stash modifiche locali con label timestamp
- Pull con rebase sul branch selezionato
- Install dipendenze (npm ci se c'è lockfile; fallback a npm install)
- Test / quality condizionali e audit opzionale
- Modalità DryRun (mostra cosa farebbe senza toccare i file)

## 3. Variabili ambiente minime
File `.env` (se manca copia da `.env.example`):
```
CLAUDE_API_KEY=...
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
ALLOWED_DOMAIN=tuodominio.com
FRONTEND_URL=http://localhost:8080
SESSION_SECRET=valore_casuale
```
Per generare un secret rapido:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## 4. Collegare i servizi
- Google: visita http://localhost:3000/auth/google (reindirizzato automaticamente se non loggato).
- ClickUp: dal menu utente → "Connetti ClickUp".

## 5. Salvare conversazioni
Succede in automatico quando scrivi. Tab "Conversazioni" a sinistra.

## 6. Rilasciare una versione (solo se ti serve davvero)
```bash
npm run release:prep          # prepara CHANGELOG
git add CHANGELOG.md && git commit -m "chore: prepare release"

npm run release:patch         # oppure minor / major
git push origin main --follow-tags
```
GitHub Action crea bozza release.

## 7. Struttura rapida
```
server.js          # API + endpoint /version
ai-first-engine.js # Logica AI-first
/public            # Frontend statico
/data              # DB SQLite (NON committare il reale in produzione)
/logs              # Log giornalieri
/scripts           # Script di supporto (es. prepare-release)
```

## 8. Comandi utili
```bash
npm test          # test di connessione rapidi
npm run test:ai   # prova motore AI
```

## 9. Problemi comuni
| Problema | Soluzione veloce |
|----------|------------------|
| Non parte | Controlla porta libera (3000 / 8080) | 
| 401 / login | Cancella cookie + riloggati Google | 
| ClickUp non mostra nulla | Rifai OAuth ClickUp | 
| Nessun documento | Verifica scope Google (ri-autorizza) | 
| Versione non aggiornata | Controlla `/version` e fai `git pull` | 
| Prompt lento | Attendere: sta facendo fetch Drive/ClickUp | 

## 10. Backup veloce
```bash
cp data/knowledge_hub.db backups/knowledge_hub.$(date +%Y%m%d%H%M).db
```

## 11. Pulizia dipendenze (solo se rotte)
```bash
rm -rf node_modules package-lock.json
npm install
```

## 12. Quando chiedere aiuto
Se ti blocchi:
1. Guarda nei log: `logs/<data>.log`
2. Endpoint `/health`
3. Chiedi un riepilogo delle modifiche recenti (CHANGELOG)

---
Keep it simple. Se qualcosa appare complicato, puoi ignorarlo finché non serve.
