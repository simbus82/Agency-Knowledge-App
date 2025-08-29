// setup.js - Script di installazione automatica per 56k Knowledge Hub
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { execSync } = require('child_process');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  red: '\x1b[31m'
};

function question(query) {
  return new Promise(resolve => rl.question(query, resolve));
}

function log(message, color = 'reset') {
  console.log(colors[color] + message + colors.reset);
}

async function setup() {
  console.clear();
  log(`
╔════════════════════════════════════════════╗
║     56k Knowledge Hub - Setup Wizard       ║
║     Version (package.json)                 ║
╚════════════════════════════════════════════╝
`, 'bright');

  log('\n📋 Questo wizard ti guiderà nella configurazione iniziale.\n', 'blue');

  // Resolve current app version from package.json (if exists)
  let appVersion = 'dev';
  try {
    if (fs.existsSync('package.json')) {
      appVersion = JSON.parse(fs.readFileSync('package.json','utf8')).version || 'dev';
    }
  } catch {}
  log(`Versione applicazione: ${appVersion}`,'yellow');

  // Check Node.js version
  const nodeVersion = process.version;
  const majorVersion = parseInt(nodeVersion.split('.')[0].substring(1));
  
  if (majorVersion < 18) {
    log(`❌ Node.js versione ${nodeVersion} rilevata. Richiesta versione 18+`, 'red');
    process.exit(1);
  }
  
  log(`✅ Node.js ${nodeVersion} rilevato`, 'green');

  // Create necessary directories
  log('\n📁 Creazione directory...', 'yellow');
  
  const dirs = ['./logs', './data', './public'];
  dirs.forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      log(`   ✓ Creata directory ${dir}`, 'green');
    }
  });

  // Check if .env exists
  if (fs.existsSync('.env')) {
    const overwrite = await question('\n⚠️  File .env esistente trovato. Sovrascrivere? (y/n): ');
    if (overwrite.toLowerCase() !== 'y') {
      log('Setup annullato. File .env esistente mantenuto.', 'yellow');
      process.exit(0);
    }
  }

  log('\n🔧 Configurazione API e Servizi\n', 'blue');

  // Collect configuration
  const config = {};

  // Claude API
  log('1️⃣  CLAUDE AI', 'bright');
  config.CLAUDE_API_KEY = await question('   Claude API Key (sk-ant-...): ');
  
  // Google OAuth
  log('\n2️⃣  GOOGLE OAUTH', 'bright');
  config.GOOGLE_CLIENT_ID = await question('   Google Client ID (xxx.apps.googleusercontent.com): ');
  config.GOOGLE_CLIENT_SECRET = await question('   Google Client Secret (GOCSPX-...): ');
  config.ALLOWED_DOMAIN = await question('   Dominio email autorizzato (default: 56k.agency): ') || '56k.agency';

  // ClickUp OAuth (optional)
  log('\n3️⃣  CLICKUP OAUTH (Opzionale - premi Enter per saltare)', 'bright');
  config.CLICKUP_CLIENT_ID = await question('   ClickUp Client ID: ') || '';
  config.CLICKUP_CLIENT_SECRET = await question('   ClickUp Client Secret: ') || '';
  config.CLICKUP_TEAM_ID = await question('   ClickUp Team ID (consigliato per default team): ') || '';

  // Server configuration
  log('\n4️⃣  CONFIGURAZIONE SERVER', 'bright');
  config.PORT = await question('   Porta backend (default: 3000): ') || '3000';
  config.FRONTEND_URL = await question('   URL frontend (default: http://localhost:8080): ') || 'http://localhost:8080';
  
  // Generate session secret
  const crypto = require('crypto');
  config.SESSION_SECRET = crypto.randomBytes(32).toString('hex');
  // Encryption key (32 bytes base64) for refresh tokens
  config.TOKEN_ENC_KEY = crypto.randomBytes(32).toString('base64');
  // Optional performance / limits
  config.DRIVE_MAX_BYTES = '10485760'; // 10 MB default
  config.DEFAULT_CLAUDE_MODEL = 'claude-sonnet-4-20250514';

  // Create .env file
  log('\n📝 Creazione file .env...', 'yellow');
  
  const envContent = `# 56k Knowledge Hub Configuration
# Generated: ${new Date().toISOString()}

# Claude AI Configuration
CLAUDE_API_KEY=${config.CLAUDE_API_KEY}

# Google OAuth Configuration  
GOOGLE_CLIENT_ID=${config.GOOGLE_CLIENT_ID}
GOOGLE_CLIENT_SECRET=${config.GOOGLE_CLIENT_SECRET}
ALLOWED_DOMAIN=${config.ALLOWED_DOMAIN}

# ClickUp OAuth Configuration (Optional)
CLICKUP_CLIENT_ID=${config.CLICKUP_CLIENT_ID}
CLICKUP_CLIENT_SECRET=${config.CLICKUP_CLIENT_SECRET}
CLICKUP_TEAM_ID=${config.CLICKUP_TEAM_ID}

# Server Configuration
PORT=${config.PORT}
FRONTEND_URL=${config.FRONTEND_URL}
SESSION_SECRET=${config.SESSION_SECRET}
TOKEN_ENC_KEY=${config.TOKEN_ENC_KEY}
DRIVE_MAX_BYTES=${config.DRIVE_MAX_BYTES}
CLICKUP_TEAM_ID=${config.CLICKUP_TEAM_ID}
SELECTED_CLAUDE_MODEL=${config.DEFAULT_CLAUDE_MODEL}

# Environment
NODE_ENV=development

# Database
DB_PATH=./data/knowledge_hub.db

# Logging
LOG_LEVEL=info
LOG_PATH=./logs
`;

  fs.writeFileSync('.env', envContent);
  log('   ✓ File .env creato', 'green');

  // Frontend static asset check (already resides in public/)
  log('\n📦 Verifica asset frontend in ./public ...', 'yellow');
  if (!fs.existsSync('./public/index.html')) {
    log('   ⚠️  ./public/index.html non trovato. Aggiungi i file statici nel folder public/', 'yellow');
  } else {
    log('   ✓ Asset frontend presenti', 'green');
  }

  // Create package.json if not exists
  if (!fs.existsSync('package.json')) {
    log('\n📦 Creazione package.json...', 'yellow');
    const packageJson = {
      name: "56k-knowledge-hub",
      version: appVersion === 'dev' ? '0.1.0' : appVersion,
      description: "AI-powered knowledge assistant for 56k Agency",
      main: "server.js",
      scripts: {
        start: "node server.js",
        dev: "nodemon server.js",
        frontend: "npx http-server ./public -p 8080 -c-1",
        setup: "node setup.js",
        test: "node tools/test-connections.js",
        "test:ai": "node tools/test-ai-engine.js",
        lint: "eslint . --ext .js",
        "lint:fix": "eslint . --ext .js --fix",
        format: "prettier . --write",
        quality: "npm run lint && npm test"
      },
      author: "56k Agency",
      license: "MIT"
    };
    fs.writeFileSync('package.json', JSON.stringify(packageJson, null, 2));
    log('   ✓ package.json creato', 'green');
  }

  // Install dependencies
  log('\n📥 Installazione dipendenze NPM...', 'yellow');
  log('   Uso npm install per rispettare package.json esistente...\n', 'yellow');
  try {
    execSync('npm install', { stdio: 'inherit' });
    log('\n   ✓ Dipendenze installate', 'green');
  } catch (error) {
    log('\n❌ Errore durante npm install', 'red');
    log('   Provo reinstallazione pulita...', 'yellow');
    try {
      fs.rmSync('node_modules', { recursive: true, force: true });
      if (fs.existsSync('package-lock.json')) fs.rmSync('package-lock.json');
      execSync('npm install', { stdio: 'inherit' });
      log('   ✓ Reinstallazione completata', 'green');
    } catch (e) {
      log('   ❌ Fallita anche la reinstallazione. Esegui manualmente.', 'red');
    }
  }

  // Test connections
  log('\n🔌 Test connessioni API...', 'yellow');
  
  // Test Claude
  if (config.CLAUDE_API_KEY) {
    try {
      const axios = require('axios');
      const response = await axios.post('https://api.anthropic.com/v1/messages', {
        model: config.DEFAULT_CLAUDE_MODEL,
        max_tokens: 10,
        messages: [{ role: 'user', content: 'Hi' }]
      }, {
        headers: {
          'x-api-key': config.CLAUDE_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        }
      });
      log('   ✓ Claude API connesso', 'green');
    } catch (error) {
      log('   ⚠️ Claude API test fallito - verifica la API key', 'yellow');
    }
  }

  // Final instructions
  log('\n' + '═'.repeat(48), 'bright');
  log('\n✅ SETUP COMPLETATO!', 'green');
  log('\nPer avviare l\'applicazione:', 'blue');
  log('\n1. Avvia il backend:', 'yellow');
  log('   npm start', 'bright');
  log('\n2. In un nuovo terminale, avvia il frontend:', 'yellow');
  log('   npm run frontend', 'bright');
  log('\n3. Apri il browser:', 'yellow');
  log(`   ${config.FRONTEND_URL}`, 'bright');
  
  // Optional quality run
  try {
    if (fs.existsSync('node_modules/.bin/eslint')) {
      log('\n🔎 Quality check (lint + test)...', 'blue');
      execSync('npm run quality', { stdio: 'inherit' });
    }
  } catch (e) {
    log('   ⚠️ Quality check non completato (ignoro).', 'yellow');
  }

  log('\n📚 Comandi utili:', 'blue');
  log('   npm run dev        - Backend con auto-reload', 'yellow');
  log('   npm run frontend   - Avvia frontend statico', 'yellow');
  log('   npm test           - Test connessioni API', 'yellow');
  log('   npm run test:ai    - Test analisi AI engine', 'yellow');
  log('   npm run lint       - Lint codice', 'yellow');
  log('   npm run format     - Format codice', 'yellow');
  log('   npm run quality    - Lint + test', 'yellow');
  log('   npm run setup      - Ri-esegui setup', 'yellow');
  
  log('\n⚠️  IMPORTANTE:', 'red');
  log('   Non committare il file .env su Git!', 'yellow');
  log('   Aggiungi .env al tuo .gitignore', 'yellow');
  log('   Conserva al sicuro TOKEN_ENC_KEY (rigenerare invalida i token cifrati)', 'yellow');
  
  log('\n' + '═'.repeat(48) + '\n', 'bright');

  rl.close();
}

// Run setup
setup().catch(error => {
  log(`\n❌ Errore durante il setup: ${error.message}`, 'red');
  process.exit(1);
});
