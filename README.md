# Agency Knowledge Hub 🚀

> **AI-powered knowledge assistant that unifies access to ClickUp and Google Drive through Claude AI intelligence**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![Claude AI](https://img.shields.io/badge/Powered%20by-Claude%20AI-blue.svg)](https://www.anthropic.com/)
[![Version](https://img.shields.io/github/v/tag/simbus82/Agency-Knowledge-App?label=version&color=blue)](https://github.com/simbus82/Agency-Knowledge-App/tags)

> 📘 Documentazione completa: [Docs Index](./docs/README.md) · 🧾 Mini cheat‑sheet locale: [Guida Rapida](./README-LOCAL.md) · 🔐 [Security Policy](./SECURITY.md) · 🤝 [Code of Conduct](./CODE_OF_CONDUCT.md)

> Struttura codice: il codice applicativo è ora consolidato sotto `src/` (cartelle `engines/`, ecc.). Rimossi i vecchi engine legacy e duplicati per una base pulita.

## 📋 Overview

**Agency Knowledge Hub** is an intelligent assistant that provides unified access to your project management and document repositories. Built for **56K Agency** and released for everyone, it combines the power of **Claude AI** with seamless integrations to **ClickUp** and **Google Drive**, enabling natural language queries across all your business data.

> Current Application Version: **0.9.0**

### ✨ Key Features

- 🤖 **Claude AI Integration** – Anthropic latest models (Sonnet / Opus) with dynamic model selection per-user
- 🧠 **Multi‑Turn Memory** – Conversation context summarization + last turns retained for coherent follow‑ups
- ✅ **ClickUp Integration** – Hierarchy (spaces / folders / lists), smart on‑demand task enrichment, comments, time metrics
- 📁 **Google Drive Deep Access** – Shared drives, metadata + full‑text content extraction (Docs, Sheets, Slides, PDF, DOCX, XLSX, PPTX) with size & rate guards
- 💾 **Conversation History** – Stored in SQLite (easy to swap with a different RDBMS)
- 🗃️ **Smart Caching Layer** – TTL + stale‑while‑revalidate for ClickUp & Drive heavy calls
- 🔐 **Secure Auth & Tokens** – Google OAuth (domain restricted) + encrypted refresh token storage & controlled refresh w/ error logging
- 🛡️ **Admin Settings Panel** – Runtime non‑sensitive tuning (limits, cache TTL, parsing toggles) directly from the UI
- 📊 **Cross-Platform Insights** – AI synthesizes signals across tasks & documents (no brittle hardcoded rules)
- 🧩 **Extensible Engine** – AI‑first orchestration delegates analysis & data selection to the model
- 🛠️ **Easy Setup** – Wizard + unified start scripts (`start:all`, `dev:all`)
- 🖥️ **Update Scripts** – Windows PowerShell & (optionally) shell helper to pull latest safely

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

That's it! 🎉 The setup wizard will guide you through the configuration.

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
```

## ⚙️ Configuration

### Required API Keys

#### 1. Claude AI (Anthropic)
1. Visit [console.anthropic.com](https://console.anthropic.com)
2. Create a new project
3. Generate API key: `sk-ant-api03-...`

#### 2. Google Workspace OAuth
1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create new project
3. Enable APIs: Drive, Docs, OAuth2
4. Create OAuth 2.0 credentials
5. Add authorized redirect: `http://localhost:8080/callback/google`

#### 3. ClickUp OAuth (Optional)
1. Visit [ClickUp Developer Portal](https://clickup.com/api)
2. Create OAuth application
3. Note Client ID and Secret

### Environment Variables (Core)

```env
# Claude AI
CLAUDE_API_KEY=sk-ant-api03-...

# Google OAuth
GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-...
ALLOWED_DOMAIN=yourdomain.com

# ClickUp OAuth (Optional)
CLICKUP_CLIENT_ID=your-client-id
CLICKUP_CLIENT_SECRET=your-client-secret

# Server
PORT=3000
FRONTEND_URL=http://localhost:8080

# (Optional) Admin / security
ADMIN_EMAIL=admin@yourdomain.com
TOKEN_ENC_KEY=BASE64_32BYTE_KEY   # e.g. openssl rand -base64 32

# (Optional) Alerting
ALERT_THRESHOLD_REFRESH_ERRORS=5

# (Optional) Performance & limits (can also be changed via Admin panel)
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
│  (Vue/HTML) │    │ (Node.js)   │    │ (Anthropic) │
└─────────────┘    └─────────────┘    └─────────────┘
                           │
                    ┌──────┴──────┐
                    │             │
            ┌───────▼──┐   ┌──────▼──────┐
            │ ClickUp  │   │ Google      │
            │   API    │   │ Drive API   │
            └──────────┘   └─────────────┘
```

### Tech Stack

**Frontend:**
- Vanilla JavaScript ES6+
- Modern CSS3 with flexbox/grid
- (Pluggable) optional service worker (future)

**Backend:**
- Node.js + Express.js
- Session-based authentication (httpOnly cookies)
- SQLite (swappable) for config, conversations, caching
- API proxy layer (secrets never leak to browser)
- TTL caching + content extraction workers (inline now, separable later)

**Integrations:**
- Claude Sonnet / Opus
- ClickUp API v2 (hierarchy + on‑demand enrichment)
- Google Drive API v3 (allDrives + export/content parsing)
- OAuth2 flows (Google / ClickUp)

## 📝 Usage Examples

### Task Management Queries

```
"Quali task sono in scadenza questa settimana?"
"Mostrami il workload di Marco"
"Status del progetto Website Redesign"
"Task non assegnate con priorità alta"
```

### Document Queries

```
"Trova il contratto del cliente ABC"
"Documenti modificati oggi"
"Presentazioni del Q3"
"Budget analysis più recente"
```

### Cross-Platform Analytics

```
"Confronta ore trackate vs budget progetto X"
"ROI dei progetti completati questo mese"
"Documenti collegati alle task in ritardo"
"Report settimanale per il cliente Y"
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

### Aggiornare l'app da GitHub su Windows (script PowerShell)

Per aggiornare la copia locale su Windows preservando i dati sensibili in `.env` e il database, è stato aggiunto lo script PowerShell `update-from-github.ps1` nella radice del progetto.

Passaggi rapidi:

1. Apri PowerShell ed entra nella cartella del progetto:

```powershell
cd "C:\path\to\Agency-Knowledge-App"
```

2. Esegui lo script (verifica che Git e Node siano nel PATH):

```powershell
.\update-from-github.ps1
```

Cosa fa lo script:
- crea backup `.env.backup`, `data-backup/` e `logs-backup/` nella root;
- esegue `git stash` per salvare modifiche locali non committate;
- fa `git fetch` + `git pull --rebase origin main` (modifica `$branch` nello script se usi un ramo diverso);
- ripristina `.env` dal backup se presente e reinstalla le dipendenze (`npm ci` / `npm install`);
- opzionalmente esegue build/test se definiti.

Note importanti:
- Controlla il contenuto di `.env.backup` prima di rimuoverlo; lo script non cancella automaticamente il backup finale.
- Se preferisci usare WSL o Git Bash, puoi eseguire lo script shell `update-from-github.sh` (se presente) in quelle shell.
- Se `.env` è tracciato nel repository, il backup è essenziale: considera di rimuoverlo dal versionamento (`git rm --cached .env`) e aggiungerlo a `.gitignore`.

Se vuoi, possiamo aggiungere un esempio nel file `.env.example` o istruzioni per integrare lo script in una pipeline CI/CD.

### Project Structure (Updated)

```
Agency-Knowledge-App/
├── server.js              # Main backend server (AI-first orchestration endpoint)
├── setup.js               # Configuration wizard
├── index.html             # Frontend application
├── package.json           # Dependencies
├── .env.example          # Environment template
├── /logs                 # Application logs (rotated daily JSON lines)
├── /data                 # SQLite database (configuration, conversations, caches)
├── /public               # Static files
└── /docs                # Documentation
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
