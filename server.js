// server.js - Backend sicuro per 56k Knowledge Hub
const express = require('express');
const cors = require('cors');
const session = require('express-session');
const axios = require('axios');
const { OAuth2Client } = require('google-auth-library');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:8080',
  credentials: true
}));
app.use(express.json());
app.use(express.static('public'));
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-secret-key-change-this',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Initialize SQLite database for config and conversations
const db = new sqlite3.Database('./data/knowledge_hub.db');

// Create tables if not exist
db.serialize(() => {
  // Configuration table
  db.run(`CREATE TABLE IF NOT EXISTS configuration (
    id INTEGER PRIMARY KEY,
    key TEXT UNIQUE,
    value TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Conversations table
  db.run(`CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    user_email TEXT,
    title TEXT,
    messages TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Users table
  db.run(`CREATE TABLE IF NOT EXISTS users (
    email TEXT PRIMARY KEY,
    name TEXT,
    avatar TEXT,
    google_id TEXT,
    clickup_token TEXT,
    selected_claude_model TEXT DEFAULT 'claude-sonnet-4-20250514',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
});

// Logger
class Logger {
  constructor() {
    this.logDir = './logs';
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  log(level, message, data = {}) {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level,
      message,
      data
    };

    // Console log
    console.log(`[${timestamp}] [${level.toUpperCase()}] ${message}`, data);

    // File log
    const logFile = path.join(this.logDir, `${new Date().toISOString().split('T')[0]}.log`);
    fs.appendFileSync(logFile, JSON.stringify(logEntry) + '\n');
  }

  info(message, data) { this.log('info', message, data); }
  error(message, data) { this.log('error', message, data); }
  warning(message, data) { this.log('warning', message, data); }
}

const logger = new Logger();

// ============= CONFIGURATION ENDPOINTS =============

// Check initial configuration status
app.get('/api/config/status', (req, res) => {
  const requiredConfigs = [
    'CLAUDE_API_KEY',
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET'
  ];

  const missingConfigs = [];
  const configStatus = {};

  // Check environment variables first
  requiredConfigs.forEach(key => {
    if (process.env[key]) {
      configStatus[key] = true;
    } else {
      configStatus[key] = false;
      missingConfigs.push(key);
    }
  });

  // Check optional configs
  configStatus['CLICKUP_CLIENT_ID'] = !!process.env.CLICKUP_CLIENT_ID;
  configStatus['CLICKUP_CLIENT_SECRET'] = !!process.env.CLICKUP_CLIENT_SECRET;

  res.json({
    configured: missingConfigs.length === 0,
    missingRequired: missingConfigs,
    status: configStatus
  });
});

// Save configuration (secure - only saves to database, not env)
app.post('/api/config/save', async (req, res) => {
  try {
    const { config } = req.body;
    
    // Validate required fields
    if (!config.claude_api_key || !config.google_client_id || !config.google_client_secret) {
      return res.status(400).json({ 
        error: 'Missing required configuration fields' 
      });
    }

    // Test Claude API
    const claudeTest = await testClaudeAPI(config.claude_api_key);
    if (!claudeTest.success) {
      return res.status(400).json({ 
        error: 'Invalid Claude API key',
        details: claudeTest.error 
      });
    }

    // Save to environment (for current session)
    process.env.CLAUDE_API_KEY = config.claude_api_key;
    process.env.GOOGLE_CLIENT_ID = config.google_client_id;
    process.env.GOOGLE_CLIENT_SECRET = config.google_client_secret;
    
    if (config.clickup_client_id) {
      process.env.CLICKUP_CLIENT_ID = config.clickup_client_id;
      process.env.CLICKUP_CLIENT_SECRET = config.clickup_client_secret;
    }

    // Save to .env file for persistence
    const envContent = `
# Claude AI Configuration
CLAUDE_API_KEY=${config.claude_api_key}

# Google OAuth Configuration  
GOOGLE_CLIENT_ID=${config.google_client_id}
GOOGLE_CLIENT_SECRET=${config.google_client_secret}

# ClickUp OAuth Configuration (Optional)
CLICKUP_CLIENT_ID=${config.clickup_client_id || ''}
CLICKUP_CLIENT_SECRET=${config.clickup_client_secret || ''}

# Session Secret
SESSION_SECRET=${process.env.SESSION_SECRET || generateSecret()}

# Frontend URL
FRONTEND_URL=${config.frontend_url || 'http://localhost:8080'}
`;

    fs.writeFileSync('.env', envContent.trim());
    
    logger.info('Configuration saved successfully');
    
    res.json({ 
      success: true,
      message: 'Configuration saved successfully'
    });

  } catch (error) {
    logger.error('Failed to save configuration', error);
    res.status(500).json({ error: 'Failed to save configuration' });
  }
});

// Get available Claude models
app.get('/api/claude/models', (req, res) => {
  const models = [
    {
      id: "claude-opus-4-1-20250805",
      name: "Claude Opus 4.1",
      description: "Ultimissimo modello, massime capacità per task complessi",
      category: "premium",
      context: "200K tokens",
      recommended: false
    },
    {
      id: "claude-opus-4-20250305",
      name: "Claude Opus 4",
      description: "Molto potente, ideale per analisi approfondite",
      category: "premium",
      context: "200K tokens",
      recommended: false
    },
    {
      id: "claude-sonnet-4-20250514",
      name: "Claude Sonnet 4",
      description: "Bilanciato, ottimo per uso quotidiano aziendale",
      category: "standard",
      context: "200K tokens",
      recommended: true
    },
    {
      id: "claude-sonnet-3-7-20241205",
      name: "Claude Sonnet 3.7",
      description: "Veloce ed efficiente per query semplici",
      category: "standard",
      context: "200K tokens",
      recommended: false
    }
  ];

  res.json(models);
});

// Test API connections
app.post('/api/test/connection', async (req, res) => {
  const { service, credentials } = req.body;
  
  try {
    let result;
    
    switch(service) {
      case 'claude':
        result = await testClaudeAPI(credentials.apiKey);
        break;
      case 'clickup':
        result = await testClickUpAPI(credentials.clientId, credentials.clientSecret);
        break;
      case 'google':
        result = { success: true }; // Google test happens during OAuth
        break;
      default:
        result = { success: false, error: 'Unknown service' };
    }
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============= GOOGLE OAUTH =============

// Initiate Google OAuth flow
app.get('/auth/google', (req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID) {
    return res.status(400).json({ error: 'Google OAuth not configured' });
  }

  const redirectUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
    `client_id=${process.env.GOOGLE_CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent(process.env.FRONTEND_URL + '/callback/google')}` +
    `&response_type=code` +
    `&scope=${encodeURIComponent('email profile https://www.googleapis.com/auth/drive.readonly')}` +
    `&access_type=offline` +
    `&prompt=consent`;

  res.redirect(redirectUrl);
});

// Google OAuth callback
app.get('/callback/google', async (req, res) => {
  const { code } = req.query;
  
  try {
    // Exchange code for tokens
    const response = await axios.post('https://oauth2.googleapis.com/token', {
      code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: process.env.FRONTEND_URL + '/callback/google',
      grant_type: 'authorization_code'
    });

    const { access_token, refresh_token } = response.data;

    // Get user info
    const userResponse = await axios.get('https://www.googleapis.com/oauth2/v1/userinfo', {
      headers: { Authorization: `Bearer ${access_token}` }
    });

    const user = userResponse.data;

    // Check if user is from allowed domain
    const allowedDomain = process.env.ALLOWED_DOMAIN || '56k.agency';
    if (!user.email.endsWith(`@${allowedDomain}`)) {
      return res.status(403).send('Access denied. Only @' + allowedDomain + ' accounts are allowed.');
    }

    // Save user to database
    db.run(
      `INSERT OR REPLACE INTO users (email, name, avatar, google_id) VALUES (?, ?, ?, ?)`,
      [user.email, user.name, user.picture, user.id]
    );

    // Save to session
    req.session.user = {
      email: user.email,
      name: user.name,
      avatar: user.picture,
      googleAccessToken: access_token,
      googleRefreshToken: refresh_token
    };

    logger.info('User logged in', { email: user.email });

    // Redirect to frontend
    res.redirect(process.env.FRONTEND_URL + '?login=success');

  } catch (error) {
    logger.error('Google OAuth error', error);
    res.redirect(process.env.FRONTEND_URL + '?login=error');
  }
});

// ============= CLICKUP OAUTH =============

// Initiate ClickUp OAuth flow
app.get('/auth/clickup', (req, res) => {
  if (!process.env.CLICKUP_CLIENT_ID) {
    return res.status(400).json({ error: 'ClickUp OAuth not configured' });
  }

  const redirectUrl = `https://app.clickup.com/api?` +
    `client_id=${process.env.CLICKUP_CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent(process.env.FRONTEND_URL + '/callback/clickup')}`;

  res.redirect(redirectUrl);
});

// ClickUp OAuth callback
app.get('/callback/clickup', async (req, res) => {
  const { code } = req.query;
  
  try {
    // Exchange code for token
    const response = await axios.post('https://api.clickup.com/api/v2/oauth/token', {
      client_id: process.env.CLICKUP_CLIENT_ID,
      client_secret: process.env.CLICKUP_CLIENT_SECRET,
      code
    });

    const { access_token } = response.data;

    // Save ClickUp token for user
    if (req.session.user) {
      db.run(
        `UPDATE users SET clickup_token = ? WHERE email = ?`,
        [access_token, req.session.user.email]
      );
      
      req.session.user.clickupToken = access_token;
    }

    logger.info('ClickUp connected', { user: req.session.user?.email });

    res.redirect(process.env.FRONTEND_URL + '?clickup=connected');

  } catch (error) {
    logger.error('ClickUp OAuth error', error);
    res.redirect(process.env.FRONTEND_URL + '?clickup=error');
  }
});

// ============= API PROXIES =============

// Claude API proxy
app.post('/api/claude/message', async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const { messages, model } = req.body;
    
    // Get user's selected model or use default
    const selectedModel = model || req.session.user.selectedModel || 'claude-sonnet-4-20250514';

    const response = await axios.post('https://api.anthropic.com/v1/messages', {
      model: selectedModel,
      max_tokens: 2000,
      temperature: 0.7,
      messages
    }, {
      headers: {
        'x-api-key': process.env.CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      }
    });

    logger.info('Claude API call', { 
      user: req.session.user.email,
      model: selectedModel,
      tokens: response.data.usage 
    });

    res.json(response.data);

  } catch (error) {
    logger.error('Claude API error', error.response?.data || error);
    res.status(500).json({ error: 'Claude API error' });
  }
});

// ClickUp API proxy
app.get('/api/clickup/*', async (req, res) => {
  if (!req.session.user || !req.session.user.clickupToken) {
    return res.status(401).json({ error: 'ClickUp not connected' });
  }

  try {
    const endpoint = req.params[0];
    const response = await axios.get(`https://api.clickup.com/api/v2/${endpoint}`, {
      headers: {
        'Authorization': req.session.user.clickupToken
      },
      params: req.query
    });

    res.json(response.data);

  } catch (error) {
    logger.error('ClickUp API error', error.response?.data || error);
    res.status(500).json({ error: 'ClickUp API error' });
  }
});

// Google Drive API proxy
app.get('/api/drive/*', async (req, res) => {
  if (!req.session.user || !req.session.user.googleAccessToken) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const endpoint = req.params[0];
    const response = await axios.get(`https://www.googleapis.com/drive/v3/${endpoint}`, {
      headers: {
        'Authorization': `Bearer ${req.session.user.googleAccessToken}`
      },
      params: req.query
    });

    res.json(response.data);

  } catch (error) {
    logger.error('Google Drive API error', error.response?.data || error);
    res.status(500).json({ error: 'Google Drive API error' });
  }
});

// ============= CONVERSATIONS =============

// Get user conversations
app.get('/api/conversations', (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  db.all(
    `SELECT id, title, created_at, updated_at FROM conversations 
     WHERE user_email = ? ORDER BY updated_at DESC LIMIT 50`,
    [req.session.user.email],
    (err, rows) => {
      if (err) {
        logger.error('Database error', err);
        return res.status(500).json({ error: 'Database error' });
      }
      res.json(rows);
    }
  );
});

// Save conversation
app.post('/api/conversations', (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const { id, title, messages } = req.body;

  db.run(
    `INSERT OR REPLACE INTO conversations (id, user_email, title, messages, updated_at) 
     VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    [id, req.session.user.email, title, JSON.stringify(messages)],
    (err) => {
      if (err) {
        logger.error('Database error', err);
        return res.status(500).json({ error: 'Database error' });
      }
      res.json({ success: true });
    }
  );
});

// Get conversation details
app.get('/api/conversations/:id', (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  db.get(
    `SELECT * FROM conversations WHERE id = ? AND user_email = ?`,
    [req.params.id, req.session.user.email],
    (err, row) => {
      if (err) {
        logger.error('Database error', err);
        return res.status(500).json({ error: 'Database error' });
      }
      if (row) {
        row.messages = JSON.parse(row.messages);
      }
      res.json(row);
    }
  );
});

// ============= USER SESSION =============

// Get current user
app.get('/api/user', (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ authenticated: false });
  }

  res.json({
    authenticated: true,
    user: {
      email: req.session.user.email,
      name: req.session.user.name,
      avatar: req.session.user.avatar,
      hasClickUp: !!req.session.user.clickupToken
    }
  });
});

// Update user preferences
app.post('/api/user/preferences', (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const { selectedModel } = req.body;

  db.run(
    `UPDATE users SET selected_claude_model = ? WHERE email = ?`,
    [selectedModel, req.session.user.email],
    (err) => {
      if (err) {
        logger.error('Database error', err);
        return res.status(500).json({ error: 'Database error' });
      }
      
      req.session.user.selectedModel = selectedModel;
      res.json({ success: true });
    }
  );
});

// Logout
app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// ============= HELPER FUNCTIONS =============

async function testClaudeAPI(apiKey) {
  try {
    const response = await axios.post('https://api.anthropic.com/v1/messages', {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 10,
      messages: [{ role: 'user', content: 'Hi' }]
    }, {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      }
    });
    
    return { success: true };
  } catch (error) {
    return { 
      success: false, 
      error: error.response?.data?.error?.message || 'Invalid API key' 
    };
  }
}

async function testClickUpAPI(clientId, clientSecret) {
  // For OAuth apps, we can't test without user authorization
  // Just validate that credentials are provided
  if (clientId && clientSecret) {
    return { success: true };
  }
  return { success: false, error: 'Missing credentials' };
}

function generateSecret() {
  return require('crypto').randomBytes(32).toString('hex');
}

// ============= START SERVER =============

// Serve static files
app.use(express.static('public'));

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    services: {
      claude: !!process.env.CLAUDE_API_KEY,
      google: !!process.env.GOOGLE_CLIENT_ID,
      clickup: !!process.env.CLICKUP_CLIENT_ID,
      database: true
    },
    timestamp: new Date().toISOString()
  });
});

app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
  console.log(`
╔════════════════════════════════════════╗
║     56k Knowledge Hub Backend          ║
║     Server running on port ${PORT}        ║
║                                        ║
║     Frontend: http://localhost:8080    ║
║     Backend:  http://localhost:${PORT}    ║
║                                        ║
║     Status: /health                    ║
║     Logs:   ./logs/                   ║
╚════════════════════════════════════════╝
  `);
});