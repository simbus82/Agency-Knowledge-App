# Agency Knowledge Hub 🚀

> **AI-powered knowledge & ops assistant with AI-first RAG orchestration across ClickUp, Google Drive & optional Gmail (modular connectors)**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![Claude AI](https://img.shields.io/badge/Powered%20by-Claude%20AI-blue.svg)](https://www.anthropic.com/)
[![Version](https://img.shields.io/github/v/tag/simbus82/Agency-Knowledge-App?label=version&color=blue)](https://github.com/simbus82/Agency-Knowledge-App/tags)

> 📘 Documentazione completa: [Docs Index](./docs/README.md) · 🧾 Mini cheat‑sheet locale: [Guida Rapida](./README-LOCAL.md) · 🔐 [Security Policy](./SECURITY.md) · 🤝 [Code of Conduct](./CODE_OF_CONDUCT.md)

> Struttura codice: il codice applicativo è consolidato sotto `src/` (`engines/`). Tutti i vecchi engine legacy e duplicati sono stati rimossi: esiste un solo motore AI unificato (`src/engines/ai-first-engine.js`).

## 📋 Overview

**Agency Knowledge Hub** is an intelligent assistant that provides unified access to your operational knowledge (tasks, docs, emails). Built for **56K Agency** and released for everyone, it combines the power of **Claude AI** with modular connectors (ClickUp, Google Drive, Gmail) and an AI‑first RAG pipeline that dynamically plans tool calls and retrieval steps based on each query.

> Current Application Version: **0.9.0** *(badge sopra è sempre autorevole)*

### ✨ Key Features

- 🤖 **Claude AI Integration** – Anthropic latest models (Sonnet / Opus) with dynamic per-user selection
- 🧠 **AI‑First RAG Orchestration** – LLM planner builds adaptive task graphs (retrieve · tool_call · annotate · correlate · reason · compose)
- 🔌 **Modular Connectors** – Plug & play under `src/connectors/` (ClickUp, Drive, Gmail optional) with dynamic activation by env
- ✅ **ClickUp Deep Integration** – Hierarchy, selective task enrichment, metrics
- 📁 **Google Drive Full‑Text** – Docs / Slides / Sheets / PDF / Office export & size guards
- 📨 **Gmail (Read‑Only Optional)** – Service Account domain delegation; excluded automatically if not configured
- 🧩 **LLM Replaces Heuristics** – Intent parsing, query expansion, entity & date extraction are model‑driven (less brittle regex)
- 🗂️ **Structured Annotations** – Entities / dates / claims annotators feeding synthesis step
- 💾 **Conversation Memory** – Summarized history + recent turns window
- 🗃️ **Smart Caching Layer** – TTL + stale‑while‑revalidate for heavy external calls
- 🔐 **Secure Auth & Tokens** – OAuth + encrypted refresh tokens + domain allowlist
- 🛡️ **Admin Settings Panel** – Runtime tuning of non‑sensitive limits & toggles
- 📊 **Cross-Source Reasoning** – Correlates tasks, docs, (emails if enabled) in answers
- 🛠️ **Easy Setup** – Interactive wizard & unified scripts
- 🖥️ **Update Scripts** – PowerShell & Bash safe update workflows

### 🎯 Benefits

- **Save 70% of time** retrieving information across platforms
- **Unified view** of all your business data in one interface
- **Intelligent insights** impossible with separate tools
- **Scalable architecture** ready for team growth

## 🚀 Quick Start

### Prerequisites

- **Node.js 18+** 
- **NPM 8+**
- **Google Workspace account** (@yourdomain.com)
- **Claude API key** from [Anthropic](https://console.anthropic.com)
- **ClickUp account** (optional but recommended)

### 1-Minute Setup

```bash
# Clone the repository
git clone https://github.com/simbus82/Agency-Knowledge-App.git
cd Agency-Knowledge-App

# Run the setup wizard
npm run setup

# Start backend + frontend together (recommended during dev)
npm run dev:all

# Or production-style start (two processes)
npm run start:all

# Open your browser
open http://localhost:8080
```

That's it! 🎉 The setup wizard will guide you through the configuration, generando anche chiavi di sicurezza (`SESSION_SECRET`, `TOKEN_ENC_KEY`) e il modello Claude di default (`SELECTED_CLAUDE_MODEL`).

## 📦 Installation

### Option 1: Automated Setup (Recommended)

```bash
# Download and setup
git clone https://github.com/simbus82/Agency-Knowledge-App.git
cd Agency-Knowledge-App
npm run setup
```

The setup wizard will:
- ✅ Check system requirements
- ⚙️ Collect API credentials
- 🔧 Generate secure configuration
- 📦 Install dependencies
- 🧪 Test API connections

### Option 2: Manual Installation

```bash
# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Edit configuration
nano .env

# Start servers (separate)
npm start          # Backend (port 3000)
npm run frontend   # Frontend (port 8080)

# Or combined
npm run start:all

## ⚙️ Configuration

### Required API Keys / Credentials

#### 1. Claude AI (Anthropic)
1. Vai su [console.anthropic.com](https://console.anthropic.com)
2. Crea progetto / genera API key: `sk-ant-api...`
3. Imposta `CLAUDE_API_KEY` nel `.env`

#### 2. Google Workspace OAuth (Drive / Docs)
1. Google Cloud Console → crea progetto
2. Abilita: Drive API, Docs API, OAuth2
3. Crea credenziali OAuth Client (User type Internal se Workspace)
4. Redirect: `http://localhost:8080/callback/google`
5. Imposta `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `ALLOWED_DOMAIN`

#### 2b. (Optional) Gmail Service Account (Read‑Only)
Usa SOLO se vuoi interrogare email. Se assente, il tool non appare.
1. Crea *Service Account* e genera chiave JSON → salva JSON (intero) in `GOOGLE_CREDENTIALS_JSON`
2. Admin Console Workspace → Security → API Controls → Domain-wide Delegation → Add new
3. Client ID = service account; Scope: `https://www.googleapis.com/auth/gmail.readonly`
4. Imposta `GOOGLE_IMPERSONATED_USER_EMAIL` (utente dominio da impersonare)
5. Riavvia app; il planner includerà il tool Gmail

#### 3. ClickUp (OAuth +/o Personal Token)
Opzione A (OAuth UI): `CLICKUP_CLIENT_ID`, `CLICKUP_CLIENT_SECRET`
Opzione B (Server Personal Token): Genera token e imposta `CLICKUP_API_KEY` (usato nei tool automatici)

### Environment Variables (Core & Connectors)

```env
# Claude AI
CLAUDE_API_KEY=sk-ant-api...
SELECTED_CLAUDE_MODEL=claude-sonnet-4-20250514

# Google OAuth (Drive / Docs)
GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-...
ALLOWED_DOMAIN=yourdomain.com

# (Optional) Gmail Read-Only (Service Account JSON COMPRESSO su una riga)
GOOGLE_CREDENTIALS_JSON='{"type":"service_account",...}'
GOOGLE_IMPERSONATED_USER_EMAIL=user@yourdomain.com

# ClickUp OAuth (UI) &/or Personal Token (Server Tools)
CLICKUP_CLIENT_ID=your-client-id
CLICKUP_CLIENT_SECRET=your-client-secret
CLICKUP_API_KEY=pk_xxx

# Server
PORT=3000
FRONTEND_URL=http://localhost:8080

# Security / encryption
SESSION_SECRET=GENERATED_SESSION_SECRET
TOKEN_ENC_KEY=BASE64_32BYTE_KEY

# Alerting
ALERT_THRESHOLD_REFRESH_ERRORS=5

# Performance & limits
DRIVE_MAX_BYTES=10485760
DRIVE_CACHE_TTL=600
CLICKUP_CACHE_TTL=3600
MAX_DRIVE_FILES_TO_FETCH=3
MAX_CLICKUP_TASKS_ENRICH=3
DRIVE_EXPORT_MAX_CHARS=20000
ENABLE_PDF_PARSE=true
```

## 🏗️ Architecture

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│   Frontend  │───▶│   Backend   │───▶│  Claude AI  │
│  (HTML/JS)  │    │ (Node.js)   │    │ (LLM Ops)   │
└─────────────┘    └─────────────┘    └─────────────┘
           │
         ┌─────┴─────┐
         │  RAG /    │
         │ Orchestr. │
         └─────┬─────┘
      ┌────────────────┼─────────────────┐
      │                │                 │ (optional)
     ┌────▼────┐      ┌─────▼────┐      ┌─────▼────┐
     │ ClickUp │      │  Drive   │      │  Gmail   │
     │  API    │      │  API     │      │  API     │
     └─────────┘      └──────────┘      └──────────┘
```

### Tech Stack

**Frontend:**
- Vanilla JavaScript ES6+
- Modern CSS3 with flexbox/grid
- (Pluggable) optional service worker (future)

**Backend:**
- Node.js + Express.js
- Single unified AI-first engine (`src/engines/ai-first-engine.js`)
- Session-based authentication (httpOnly cookies)
- SQLite (swappable) for config, conversations, caching
- API proxy layer (secrets never leak to browser)
- TTL caching + content extraction workers (inline now, separable later)

**Integrations:**
- Claude Sonnet / Opus
- ClickUp API v2 (hierarchy + on‑demand enrichment)
- Google Drive API v3 (allDrives + export/content parsing)
- (Optional) Gmail API (read‑only via Service Account delegation)
- OAuth2 flows (Google / ClickUp)

### RAG & Tool Orchestration

1. **Intent Parsing (LLM)** – estrae action, entità, range temporali
2. **Planning** – costruzione grafo tasks (JSON) includendo `tool_call` condizionali alle variabili env disponibili
3. **Execution** – risoluzione template parametrici (`{t1.files[0].id}`) + chiamata tool connector
4. **Annotation** – estrazione entità / date / claims su chunk rilevanti
5. **Correlation** – unisce risultati multi‑fonte (attuale baseline, estendibile)
6. **Synthesis** – risposta finale contestuale con reasoning

Error resilience: errori dei singoli tool vengono catturati e non fermano il grafo; il reasoning li può menzionare o ignorare.

## 📝 Usage Examples

### Task Management Queries

```
"Quali task sono in scadenza questa settimana?"
"Mostrami il workload di Marco"
"Status del progetto Website Redesign"
"Task non assegnate con priorità alta"
```

### Document & Email Queries

```
"Trova il contratto del cliente ABC"
"Documenti modificati oggi"
"Presentazioni del Q3"
"Budget analysis più recente"
"Email con 'contratto' dell'ultima settimana"
"Ultimi aggiornamenti via mail sul progetto Phoenix"
```

### Cross-Platform Analytics & Multi-Source

```
"Confronta ore trackate vs budget progetto X"
"ROI dei progetti completati questo mese"
"Documenti collegati alle task in ritardo"
"Report settimanale per il cliente Y"
"Confronta stato task e contenuti recenti delle email del cliente Z"
```

## 🔧 Development

### Available Scripts

```bash
npm run dev        # Backend dev (nodemon)
npm run dev:all    # Backend + frontend concurrently (recommended)
npm start          # Backend only
npm run start:all  # Backend + frontend (production style)
npm run frontend   # Frontend only
npm run setup      # First-time config wizard
npm test           # Connectivity tests
npm run test:ai    # AI engine test
```

### Conversation Memory

Il motore ora conserva: (a) riassunto dei turni più vecchi, (b) ultimi 12 messaggi completi. Questo bilancia coerenza e consumo token. Miglioramenti possibili: persistenza del riassunto cumulativo & compressione semantica.

### 🔄 Update & Maintenance

Sono inclusi due script di aggiornamento sicuro:

| Script | Ambiente | Funzioni | Extra |
|--------|----------|----------|-------|
| `update-from-github.ps1` | Windows PowerShell | Backup `.env/data/logs`, stash, pull rebase, reinstall, quality/test, audit | Avviso se manca `TOKEN_ENC_KEY` |
| `update-from-github.sh`  | Bash / WSL / Linux | Backup, stash, pull, reinstall, quality/test, audit | Avviso se manca `TOKEN_ENC_KEY` |

Esecuzione (Windows):
```powershell
cd C:\path\to\Agency-Knowledge-App
./update-from-github.ps1
```

Esecuzione (Linux/WSL/macOS):
```bash
./update-from-github.sh
```

Entrambi eseguono:
1. Backup di `.env`, `data/`, `logs/`
2. Stash modifiche locali
3. Pull rebase da `main`
4. Reinstall dipendenze (`npm ci` se lock presente / fallback `npm install`)
5. Quality (lint + test) se disponibile, altrimenti solo test
6. `npm audit --production` (non bloccante)
7. Avviso se manca `TOKEN_ENC_KEY`

Buone pratiche:
- Non tenere `.env` sotto versionamento
- Rigenera `TOKEN_ENC_KEY` solo se accetti di invalidare i token cifrati
- Esegui `npm run quality` localmente prima di creare una PR

### Project Structure (Updated)

```
Agency-Knowledge-App/
├── server.js                      # Main backend server & API
├── setup.js                       # Interactive setup wizard
├── package.json                   # Scripts & dependencies
├── .env.example                   # Env template
├── /src
│   ├── /engines/ai-first-engine.js# Unified AI-first engine
│   ├── /rag/
│   │   ├── planner/               # LLM planner (task graph)
│   │   ├── executor/              # Graph execution + tool_call
│   │   ├── retrieval/             # BM25 + expansion (LLM)
│   │   ├── annotators/            # entities, dates, claims
│   │   ├── synthesis/             # Final answer composer
│   │   └── util/                  # intent parser, embeddings, etc.
│   └── /connectors/               # Modular external data sources
│       ├── googleDriveConnector.js
│       ├── clickupConnector.js
│       └── gmailConnector.js      # Optional (only if env set)
├── /tools                         # CLI utilities & tests
├── /public                        # Static frontend
├── /data                          # SQLite DB
├── /logs                          # Rotating logs
├── /docs                          # Documentation
└── /scripts                       # Release / helper scripts
```

I vecchi file engine legacy e duplicati sono stati rimossi (nessun codice morto).

### 🧪 Testing & Diagnostics

| Comando | Descrizione |
|---------|-------------|
| `npm test` | Test rapido connessioni API e configurazione (include tool opzionali se presenti) |
| `npm run test:ai` | Valuta capacità di analisi del motore AI senza hardcode |
| `node tools/debug-startup.js` | Diagnostica avvio: env, dipendenze, backend, frontend, OAuth |
| `npm run quality` | Lint + test (usato anche in CI) |
| `npm run lint` / `npm run format` | Qualità e formattazione codice |

Esempio esecuzione mirata:
```bash
npm run test:ai
node tools/test-connections.js --google
node tools/test-connections.js --claude
```

### Database Schema (Core Extract)

```sql
-- Users table
CREATE TABLE users (
    email TEXT PRIMARY KEY,
    name TEXT,
    avatar TEXT,
    google_id TEXT,
    clickup_token TEXT,
    selected_claude_model TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Conversations table
CREATE TABLE conversations (
    id TEXT PRIMARY KEY,
    user_email TEXT,
    title TEXT,
    messages TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

## 🚀 Deployment

### Docker Deployment

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
```

```bash
# Build and run
docker build -t Agency-hub .
docker run -p 3000:3000 --env-file .env Agency-hub
```

### Cloud Deployment

#### Vercel
```bash
npm i -g vercel
vercel --prod
```

#### Railway
```bash
npm i -g @railway/cli
railway deploy
```

#### Heroku
```bash
git push heroku main
```

## 🔒 Security

### Implemented

- ✅ **Backend-only secrets** – API keys & tokens never exposed client-side
- ✅ **Google OAuth + domain allowlist** – Limita accesso a workspace autorizzato
- ✅ **Encrypted refresh tokens** – AES-256-GCM (attiva se `TOKEN_ENC_KEY` configurato)
- ✅ **Sessione sicura** – Cookie httpOnly + durata 24h
- ✅ **CORS restrittivo** – Origin configurabile
- ✅ **Access token auto-refresh** – Con logging errori in tabella audit
- ✅ **Dimension limits** – Guardia su dimensione file Drive & truncation contenuti
- ✅ **On-demand enrichment** – Riduce superficie dati non necessari

### Planned / Suggested

- ⏳ Rate limiting middleware
- ⏳ Sanitizzazione/escape centralizzata output rich text
- ⏳ Policy CSP più granulari
- ⏳ Audit log modifiche admin settings
- ⏳ Optional JWT alternative to sessions (B2B scenarios)

### Security Headers (Suggested Baseline)

```nginx
Content-Security-Policy: default-src 'self'
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
```

## 🐛 Troubleshooting

### Common Issues

#### "Claude API error: 401"
- **Cause**: API key invalida / non configurata
- **Solution**: Verifica chiave o aggiorna via pannello configurazione

#### "Cannot access Google Drive"
- **Cause**: Token scaduto o scope mancanti
- **Solution**: Riesegui login Google; controlla consent screen & Drive scopes

#### "ClickUp data not loading"
- **Cause**: Token assente / Team ID non recuperabile
- **Solution**: Rifai OAuth ClickUp; controlla se l'utente appartiene a un Team

#### "Database connection failed"
- **Cause**: Permessi filesystem (SQLite) o path errato
- **Solution**: Verifica cartella `/data`, permessi scrittura, path working directory

#### "Gmail tool non appare"
- **Cause**: Variabili mancanti (`GOOGLE_CREDENTIALS_JSON` o `GOOGLE_IMPERSONATED_USER_EMAIL`)
- **Solution**: Impostale entrambe; riavvia. Verifica delega dominio e scope.

#### "Errore tool_call ma risposta comunque generata"
- **Cause**: Fallimento connettore (rete / auth) durante il grafo
- **Solution**: Controlla log; il motore continua con le fonti disponibili.

### Debug / Logs

```bash
# Enable debug logging
echo "LOG_LEVEL=debug" >> .env

# Check logs
tail -f ./logs/$(date +%Y-%m-%d).log

# Browser console
# Open DevTools (F12) and check console for errors
```

## 📊 Monitoring

### Health Check

```bash
curl http://localhost:3000/health
```

Response:
```json
{
  "status": "healthy",
  "services": {
    "claude": "connected",
    "google": "connected", 
    "clickup": "connected",
    "database": "connected"
  },
  "timestamp": "2024-01-15T10:30:00Z"
}
```

### Metrics to Monitor

- API response times
- Token usage (Claude)
- Error rates per service
- Active users
- Database query performance

## 🤝 Contributing

We welcome contributions! Please follow these steps:

1. **Fork** the repository
2. **Create** a feature branch (`git checkout -b feature/AmazingFeature`)
3. **Commit** your changes (`git commit -m 'Add AmazingFeature'`)
4. **Push** to the branch (`git push origin feature/AmazingFeature`)
5. **Open** a Pull Request

### Development Guidelines

- Follow existing code style
- Add tests for new features
- Update documentation
- Ensure security best practices

## 📜 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

```
MIT License

Copyright (c) 2024 Agency Agency

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction...
```

## 🆘 Support

### Getting Help

- 📖 **Documentation**: [Full Documentation](./docs/documentation.md)
- 🐛 **Issues**: [GitHub Issues](https://github.com/simbus82/Agency-Knowledge-App/issues)
- 💬 **Discussions**: [GitHub Discussions](https://github.com/simbus82/Agency-Knowledge-App/discussions)
- 📧 **Email**: support@Agency.agency

### Resources

- **Claude AI Docs**: [docs.anthropic.com](https://docs.anthropic.com)
- **ClickUp API**: [clickup.com/api](https://clickup.com/api)
- **Google Drive API**: [developers.google.com/drive](https://developers.google.com/drive)

## 🗺️ Roadmap

### Near Term (1.1)
- 🔄 Slack integration
- 📝 Notion support
- 📊 Analytics dashboard (aggregated KPIs)
- 🎤 Voice I/O
- 🌐 Multi-language UI refinement

### Mid Term (1.2)
- 🔗 Webhooks & outbound triggers
- 🎨 Custom AI prompt profiles (per team / per role)
- 📈 Advanced reporting pack
- 🔌 Plugin / extension system
- 🛰️ Vector store for long-term semantic memory

## 🏆 Acknowledgments

- **Anthropic** for Claude AI
- **ClickUp** for their excellent API
- **Google** for Workspace APIs
- **Agency Agency Team** for testing and feedback
- **Open Source Community** for the libraries used

---

## 🔢 Versioning & Release Workflow

Semantic Versioning (SemVer): `MAJOR.MINOR.PATCH`.

Current base version: `0.9.0` (pre‑1.0: minor bumps may occasionally introduce adjustments otherwise deferred to major).

### Bump Version

Ordine consigliato (prima prepara CHANGELOG, poi bump semantico):

```bash
npm run release:prep     # Sposta note Unreleased nella nuova sezione versione
git add CHANGELOG.md && git commit -m "chore: prepare release"

npm run release:patch    # oppure release:minor / release:major
git push origin main --follow-tags
```

### Runtime Exposure

- `/version` endpoint returns `{ version }`
- `server.js` reads from `package.json` (single source of truth)
- README shows current version (update after release)

### Recommended Flow
1. Verifica test / health (`/health`)
2. `npm run release:prep` (aggiorna CHANGELOG)
3. Commit CHANGELOG
4. `npm run release:patch|minor|major`
5. Push con tag `git push origin main --follow-tags`
6. GitHub Action crea (se manca) tag remoto + draft release
7. Rifinisci note su GitHub se necessario

### Future Automation Ideas
- GitHub Action: build & deploy on tag `v*`
- Conventional Commits → auto CHANGELOG
- Pre-releases (`0.10.0-beta.1`) for experimental features

---

<div align="center">

**Built with ❤️**

[![GitHub stars](https://img.shields.io/github/stars/simbus82/Agency-Knowledge-App?style=social)](https://github.com/simbus82/Agency-Knowledge-App/stargazers)
[⭐ Star this repo](https://github.com/simbus82/Agency-Knowledge-App/stargazers) | [🐛 Report Bug](https://github.com/simbus82/Agency-Knowledge-App/issues) | [✨ Request Feature](https://github.com/simbus82/Agency-Knowledge-App/issues)

</div>
