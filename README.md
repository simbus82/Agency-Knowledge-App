# Agency Knowledge Hub 🚀

> **AI-powered knowledge assistant that unifies access to ClickUp and Google Drive through Claude AI intelligence**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![Claude AI](https://img.shields.io/badge/Powered%20by-Claude%20AI-blue.svg)](https://www.anthropic.com/)

## 📋 Overview

**Agency Knowledge Hub** is an intelligent assistant that provides unified access to your project management and document repositories. Built for **56K Agency** and released for everyone, it combines the power of **Claude AI** with seamless integrations to **ClickUp** and **Google Drive**, enabling natural language queries across all your business data.

### ✨ Key Features

- 🤖 **Claude AI Integration** - Powered by Anthropic's latest models
- ✅ **ClickUp Integration** - Complete access to tasks, projects, and analytics
- 📁 **Google Drive Access** - Search and analyze documents across your workspace
- 💾 **Conversation History** - Persistent storage with SQLite/MySQL/PostgreSQL support
- 🔐 **Secure Authentication** - Google Workspace OAuth with domain restrictions
- 📊 **Cross-platform Insights** - Intelligent analysis combining data from multiple sources
- 🎨 **Modern UI** - Clean, responsive interface with real-time updates
- 🛠️ **Easy Setup** - Automated configuration wizard

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

# Start the application
npm start

# In a new terminal, start the frontend
npm run frontend

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

# Start servers
npm start          # Backend (port 3000)
npm run frontend   # Frontend (port 8080)
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

### Environment Variables

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
- Service Worker for offline capability

**Backend:**
- Node.js + Express.js
- Session-based authentication
- SQLite/MySQL/PostgreSQL support
- API proxy layer for security

**Integrations:**
- Claude Sonnet/Opus models
- ClickUp API v2
- Google Drive API v3
- OAuth2 flows

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
npm start          # Start production server
npm run dev        # Development with auto-reload
npm run frontend   # Serve frontend (port 8080)
npm run setup      # Run configuration wizard
npm test          # Test API connections
```

### Project Structure

```
Agency-Knowledge-App/
├── server.js              # Main backend server
├── setup.js               # Configuration wizard
├── index.html             # Frontend application
├── package.json           # Dependencies
├── .env.example          # Environment template
├── /logs                 # Application logs
├── /data                 # SQLite database
├── /public               # Static files
└── /docs                # Documentation
```

### Database Schema

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

### Best Practices Implemented

- ✅ **API keys never in frontend** - Always through backend proxy
- ✅ **OAuth2 for Google** - No password storage
- ✅ **HTTPS enforced** in production
- ✅ **Rate limiting** to prevent abuse
- ✅ **Input sanitization** against XSS
- ✅ **CORS properly configured**
- ✅ **Session security** with httpOnly cookies
- ✅ **Domain restrictions** for Google Workspace

### Security Headers

```nginx
Content-Security-Policy: default-src 'self'
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
```

## 🐛 Troubleshooting

### Common Issues

#### "Claude API error: 401"
- **Cause**: Invalid or expired API key
- **Solution**: Check API key in settings or regenerate at console.anthropic.com

#### "Cannot access Google Drive"
- **Cause**: Expired OAuth token or insufficient permissions
- **Solution**: Logout and login again, verify scopes in Google Cloud Console

#### "ClickUp data not loading"
- **Cause**: Invalid token or wrong Team ID
- **Solution**: Test with `curl -H "Authorization: YOUR_TOKEN" https://api.clickup.com/api/v2/team`

#### "Database connection failed"
- **Cause**: Wrong credentials or unreachable server
- **Solution**: Verify connection details and firewall rules

### Debug Mode

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

### Version 1.1 (Next Release)
- 🔄 Slack integration
- 📝 Notion support
- 📊 Advanced analytics dashboard
- 🎤 Voice input/output
- 📱 Mobile app

### Version 1.2 (Future)
- 🔗 Webhooks support
- 🎨 Custom AI prompts
- 📈 Advanced reporting
- 🔌 Plugin system
- 🌐 Multi-language support

## 🏆 Acknowledgments

- **Anthropic** for Claude AI
- **ClickUp** for their excellent API
- **Google** for Workspace APIs
- **Agency Agency Team** for testing and feedback
- **Open Source Community** for the libraries used

---

<div align="center">

**Built with ❤️ by me**

[![GitHub stars](https://img.shields.io/github/stars/simbus82/Agency-Knowledge-App?style=social)](https://github.com/simbus82/Agency-Knowledge-App/stargazers)
[⭐ Star this repo](https://github.com/simbus82/Agency-Knowledge-App/stargazers) | [🐛 Report Bug](https://github.com/simbus82/Agency-Knowledge-App/issues) | [✨ Request Feature](https://github.com/simbus82/Agency-Knowledge-App/issues)

</div>
