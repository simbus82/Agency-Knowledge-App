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
║     Version 1.0.0                          ║
╚════════════════════════════════════════════╝
`, 'bright');

  log('\n📋 Questo wizard ti guiderà nella configurazione iniziale.\n', 'blue');

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
  config.CLAUDE_API_KEY = await question('   Claude API Key (sk-ant-api03-...): ');
  
  // Google OAuth
  log('\n2️⃣  GOOGLE OAUTH', 'bright');
  config.GOOGLE_CLIENT_ID = await question('   Google Client ID (xxx.apps.googleusercontent.com): ');
  config.GOOGLE_CLIENT_SECRET = await question('   Google Client Secret (GOCSPX-...): ');
  config.ALLOWED_DOMAIN = await question('   Dominio email autorizzato (default: 56k.agency): ') || '56k.agency';

  // ClickUp OAuth (optional)
  log('\n3️⃣  CLICKUP OAUTH (Opzionale - premi Enter per saltare)', 'bright');
  config.CLICKUP_CLIENT_ID = await question('   ClickUp Client ID: ') || '';
  config.CLICKUP_CLIENT_SECRET = await question('   ClickUp Client Secret: ') || '';

  // Server configuration
  log('\n4️⃣  CONFIGURAZIONE SERVER', 'bright');
  config.PORT = await question('   Porta backend (default: 3000): ') || '3000';
  config.FRONTEND_URL = await question('   URL frontend (default: http://localhost:8080): ') || 'http://localhost:8080';
  
  // Generate session secret
  config.SESSION_SECRET = require('crypto').randomBytes(32).toString('hex');

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

# Server Configuration
PORT=${config.PORT}
FRONTEND_URL=${config.FRONTEND_URL}
SESSION_SECRET=${config.SESSION_SECRET}

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

  // Copy frontend file to public directory
  log('\n📦 Copia file frontend...', 'yellow');
  
  if (fs.existsSync('index.html')) {
    fs.copyFileSync('index.html', './public/index.html');
    log('   ✓ Frontend copiato in ./public/', 'green');
  }

  // Create package.json if not exists
  if (!fs.existsSync('package.json')) {
    log('\n📦 Creazione package.json...', 'yellow');
    const packageJson = {
      "name": "56k-knowledge-hub",
      "version": "1.0.0",
      "description": "AI-powered knowledge assistant for 56k Agency",
      "main": "server.js",
      "scripts": {
        "start": "node server.js",
        "dev": "nodemon server.js",
        "frontend": "npx http-server ./public -p 8080 -c-1",
        "setup": "node setup.js",
        "test": "node test-connections.js"
      },
      "author": "56k Agency",
      "license": "MIT"
    };
    fs.writeFileSync('package.json', JSON.stringify(packageJson, null, 2));
    log('   ✓ package.json creato', 'green');
  }

  // Install dependencies
  log('\n📥 Installazione dipendenze NPM...', 'yellow');
  log('   Questo potrebbe richiedere qualche minuto...\n', 'yellow');
  
  try {
    execSync('npm install express express-session cors dotenv axios google-auth-library sqlite3 body-parser', {
      stdio: 'inherit'
    });
    
    execSync('npm install --save-dev nodemon http-server', {
      stdio: 'inherit'
    });
    
    log('\n   ✓ Dipendenze installate', 'green');
  } catch (error) {
    log('\n❌ Errore durante l\'installazione delle dipendenze', 'red');
    log('   Prova a eseguire manualmente: npm install', 'yellow');
  }

  // Test connections
  log('\n🔌 Test connessioni API...', 'yellow');
  
  // Test Claude
  if (config.CLAUDE_API_KEY) {
    try {
      const axios = require('axios');
      const response = await axios.post('https://api.anthropic.com/v1/messages', {
        model: 'claude-3-5-sonnet-20241022',
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
  
  log('\n📚 Comandi utili:', 'blue');
  log('   npm run dev     - Backend con auto-reload', 'yellow');
  log('   npm test        - Test connessioni API', 'yellow');
  log('   npm run setup   - Ri-esegui questo setup', 'yellow');
  
  log('\n⚠️  IMPORTANTE:', 'red');
  log('   Non committare il file .env su Git!', 'yellow');
  log('   Aggiungi .env al tuo .gitignore', 'yellow');
  
  log('\n' + '═'.repeat(48) + '\n', 'bright');

  rl.close();
}

// Run setup
setup().catch(error => {
  log(`\n❌ Errore durante il setup: ${error.message}`, 'red');
  process.exit(1);
});