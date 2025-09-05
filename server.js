// server.js - Backend sicuro per 56k Knowledge Hub
const express = require('express');
const cors = require('cors');
const session = require('express-session');
const axios = require('axios');
const crypto = require('crypto');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
// Removed legacy binary parsers (handled by Drive export)
require('dotenv').config();
// Centralized logger
const logger = require('./src/lib/logger');

// Hard requirement: application must not run without LLM key
if(!process.env.CLAUDE_API_KEY){
  console.error('\n[FATAL] CLAUDE_API_KEY mancante. Configura la chiave prima di avviare il server.\n');
  process.exit(1);
}

// RAG connectivity
const { claudePing } = require('./src/rag/ai/claudeClient');
// Legacy engines removed (AIExecutiveEngine, BusinessIntelligence)

const app = express();
const PORT = process.env.PORT || 3000;
// Central application version (mirrors package.json). Do not edit here manually; use npm version.
const APP_VERSION = require('./package.json').version;

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:8080',
  credentials: true
}));
app.use(express.json());
app.use(express.static('public'));
// Silence missing favicon 404s (browsers request /favicon.ico by default)
app.get('/favicon.ico', (req, res) => res.status(204).end());
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

// Initialize SQLite database early for DI
const db = new sqlite3.Database('./data/knowledge_hub.db');

// Lib helpers (DI closures) - require after db/logger available
const { getCachedOrFetch: _getCachedOrFetch } = require('./src/lib/cache');
const { getUserClickUpToken: _getUserClickUpToken, getUserGoogleToken: _getUserGoogleToken, encryptToken } = require('./src/lib/tokens');
const { isAdminRequest: _isAdminRequest } = require('./src/lib/admin');
const { fetchDriveFileContentWithCacheFactory } = require('./src/lib/drive');
const getUserClickUpToken = (req)=> _getUserClickUpToken(db, req);
const getUserGoogleToken = (req)=> _getUserGoogleToken(db, req, logger);
const getCachedOrFetch = (key, ttl, fn)=> _getCachedOrFetch(db, 'clickup_cache', key, ttl, fn);
const fetchDriveFileContentWithCache = fetchDriveFileContentWithCacheFactory({ db, axios, logger });
const isAdminRequest = _isAdminRequest;

// Routers (mount after DI is ready)
const statusRouter = require('./src/routes/status')({ APP_VERSION, claudePing, testDatabase, db });
app.use(statusRouter);

// (config router mounted after model definitions below)

const ragRouter = require('./src/routes/rag')({
  db,
  logger,
  axios,
  plan: require('./src/rag/planner/planner').plan,
  executeGraph: require('./src/rag/executor/executeGraph').executeGraph,
  parseIntent: require('./src/rag/util/intentParser').parseIntent,
  synthesizeConversationalAnswer: require('./src/rag/synthesis/synthesizer').synthesizeConversationalAnswer,
  embedAndStoreLexiconTerms: require('./src/rag/util/embeddings').embedAndStoreLexiconTerms,
  ingestDriveContent: require('./src/rag/util/ingestProcessor').ingestDriveContent,
  sanitizeModelId,
  claudeRequest: require('./src/rag/ai/claudeClient').claudeRequest,
  getUserGoogleToken,
  isAdminRequest
});
app.use(ragRouter);

const clickupRouter = require('./src/routes/clickup')({ axios, logger, getUserClickUpToken, getCachedOrFetch });
app.use(clickupRouter);

const driveRouter = require('./src/routes/drive')({ axios, logger, getUserGoogleToken, fetchDriveFileContentWithCache });
app.use(driveRouter);

// Conversations router
const conversationsRouter = require('./src/routes/conversations')({ db, logger });
app.use(conversationsRouter);

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
  // Migrate legacy model ids (single pass)
  try { db.run(`UPDATE users SET selected_claude_model='claude-sonnet-4-20250514' WHERE selected_claude_model IN ('claude-3-sonnet-20241022','sonnet-20241022')`); } catch(e){}

  // add google_refresh_token column if missing (ignore errors)
  try {
    db.run(`ALTER TABLE users ADD COLUMN google_refresh_token TEXT`, (err) => {
      // ignore if column exists
    });
  } catch (e) {
    // ignore
  }

  // Cache table for ClickUp responses (simple read-only cache)
  db.run(`CREATE TABLE IF NOT EXISTS clickup_cache (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  // Cache table for Drive file exports
  db.run(`CREATE TABLE IF NOT EXISTS drive_cache (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  // Table to record token refresh errors for auditing/alerts
  db.run(`CREATE TABLE IF NOT EXISTS token_refresh_errors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT,
    error TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // RAG chunks table (generalized multi-source knowledge units)
  db.run(`CREATE TABLE IF NOT EXISTS rag_chunks (
    id TEXT PRIMARY KEY,
    text TEXT NOT NULL,
    source TEXT,        -- e.g. drive|clickup|manual
    type TEXT,          -- sheet_row|doc_par|task|comment|other
    path TEXT,          -- file path or task identifier
    loc TEXT,           -- line / row / page reference
    embedding TEXT,     -- JSON array (MVP simple embedding)
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  // Safe column add helper (avoids duplicate column async errors)
  function ensureColumn(table, name, ddl){
    db.all(`PRAGMA table_info(${table})`, (err, cols)=>{
      if(err) return;
      if(!cols.some(c=>c.name===name)){
        db.run(`ALTER TABLE ${table} ADD COLUMN ${ddl}`, (e)=>{ if(e) console.error(`[DB] add column ${table}.${name} failed`, e.message); });
      }
    });
  }
  // Ensure new columns for older DBs
  ensureColumn('rag_chunks','embedding','embedding BLOB');
  ensureColumn('rag_chunks','src_start','src_start INTEGER');
  ensureColumn('rag_chunks','src_end','src_end INTEGER');

  // RAG run logs (execution telemetry)
  db.run(`CREATE TABLE IF NOT EXISTS rag_runs (
    id TEXT PRIMARY KEY,
    user_email TEXT,
    query TEXT,
    intents TEXT,
    graph_json TEXT,
    conclusions_json TEXT,
    support_count INTEGER,
    valid INTEGER,
    latency_ms INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  // User feedback on runs
  db.run(`CREATE TABLE IF NOT EXISTS rag_feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT,
    user_email TEXT,
    rating INTEGER,
    comment TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  // Dynamic lexicon of discovered terms/entities (supports query expansion & analytics)
  db.run(`CREATE TABLE IF NOT EXISTS rag_lexicon (
    term TEXT PRIMARY KEY,
    type TEXT,
    freq INTEGER DEFAULT 1,
    embedding TEXT,           -- JSON array embedding for similarity search
    sources TEXT,             -- comma separated source hints
    last_seen DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  // Persist intermediate artifacts for audit (planner, annotators, reasoner)
  db.run(`CREATE TABLE IF NOT EXISTS rag_artifacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT,
    stage TEXT,              -- planner|annotate|reason|validate|compose
    payload TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  // Cache LLM annotations per chunk (avoid re-cost)
  db.run(`CREATE TABLE IF NOT EXISTS rag_chunk_annotations (
    chunk_id TEXT,
    annotator TEXT,
    data TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (chunk_id, annotator)
  )`);
  // Human validated labels (active learning)
  db.run(`CREATE TABLE IF NOT EXISTS rag_labels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chunk_id TEXT,
    label_type TEXT,
    label_value TEXT,
    source TEXT,       -- human|ai
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  // Adaptive retrieval weights (single row)
  db.run(`CREATE TABLE IF NOT EXISTS rag_retrieval_weights (
    id INTEGER PRIMARY KEY CHECK (id=1),
    w_sim REAL DEFAULT 0.5,
    w_bm25 REAL DEFAULT 0.45,
    w_llm REAL DEFAULT 0.2,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  db.run(`INSERT OR IGNORE INTO rag_retrieval_weights (id) VALUES (1)`);
  // Ground truth relevance labels (query -> chunk relevance) for evaluation
  db.run(`CREATE TABLE IF NOT EXISTS rag_ground_truth (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    query TEXT,
    chunk_id TEXT,
    relevant INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  // Mode decision logging (auto/heuristic vs llm)
  db.run(`CREATE TABLE IF NOT EXISTS rag_mode_decisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    query TEXT,
    decided_mode TEXT,
    heuristic_score REAL,
    used_llm INTEGER,
    llm_reason TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
});

// Legacy helpers removed: encryption, cache (moved to src/lib)

// Legacy token helper removed (moved to src/lib/tokens)

// (Drive content and RAG ingest routes are mounted via routers)

// ============= CONFIGURATION ENDPOINTS =============

// Check initial configuration status
/* moved to src/routes/config.js
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
});*/

// Get configuration overview (safe version for settings page)
/* moved to src/routes/config.js
app.get('/api/config/overview', (req, res) => {
  res.json({
    claude: !!process.env.CLAUDE_API_KEY,
    google: !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET,
    clickup: !!process.env.CLICKUP_CLIENT_ID && !!process.env.CLICKUP_CLIENT_SECRET,
    clickupApiKey: !!process.env.CLICKUP_API_KEY,
    allowedDomain: process.env.ALLOWED_DOMAIN || '56k.agency'
  });
});*/

// Save configuration (secure - only saves to database, not env)
/* moved to src/routes/config.js
app.post('/api/config/save', async (req, res) => {
  try {
    const { config } = req.body;
    
    // Build the new .env content by merging existing and new values
    const existingEnv = fs.existsSync('.env') ? fs.readFileSync('.env', 'utf-8') : '';
    const envConfig = require('dotenv').parse(existingEnv);

    const newConfig = { ...envConfig };

    if (config.claude_api_key) {
        const claudeTest = await testClaudeAPI(config.claude_api_key);
        if (!claudeTest.success) {
            return res.status(400).json({ 
                error: 'Invalid Claude API key',
                details: claudeTest.error 
            });
        }
        newConfig.CLAUDE_API_KEY = config.claude_api_key;
    }

    if (config.google_client_id) newConfig.GOOGLE_CLIENT_ID = config.google_client_id;
    if (config.google_client_secret) newConfig.GOOGLE_CLIENT_SECRET = config.google_client_secret;
    if (config.clickup_client_id) newConfig.CLICKUP_CLIENT_ID = config.clickup_client_id;
    if (config.clickup_client_secret) newConfig.CLICKUP_CLIENT_SECRET = config.clickup_client_secret;
    if (config.clickup_api_key) {
        // Validate the token by calling ClickUp /user
        try {
            const ok = await testClickUpToken(config.clickup_api_key);
            if (!ok.success) {
                return res.status(400).json({ error: 'Invalid ClickUp API key', details: ok.error });
            }
            newConfig.CLICKUP_API_KEY = config.clickup_api_key;
        } catch (e) {
            return res.status(400).json({ error: 'Invalid ClickUp API key', details: e.message });
        }
    }
    if (config.allowed_domain) newConfig.ALLOWED_DOMAIN = config.allowed_domain;
    if (!newConfig.SESSION_SECRET) newConfig.SESSION_SECRET = generateSecret();
    if (!newConfig.FRONTEND_URL) newConfig.FRONTEND_URL = 'http://localhost:8080';

    // Update process.env for the current session
    Object.assign(process.env, newConfig);

    // Save to .env file for persistence
    const envContent = Object.entries(newConfig)
        .map(([key, value]) => `${key}=${value}`)
        .join('\n');

    fs.writeFileSync('.env', envContent);
    
    logger.info('Configuration updated successfully');
    
    res.json({ 
      success: true,
      message: 'Configuration updated successfully'
    });

  } catch (error) {
    logger.error('Failed to save configuration', error);
    res.status(500).json({ error: 'Failed to save configuration' });
  }
});*/

// Get available Claude models
const AVAILABLE_MODELS = [
  { id: 'claude-opus-4-1-20250805', name: 'Claude Opus 4.1', description: 'Ultimissimo modello, massime capacità per task complessi', category: 'premium', context: '200K tokens', recommended: false },
  { id: 'claude-opus-4-20250305', name: 'Claude Opus 4', description: 'Molto potente, ideale per analisi approfondite', category: 'premium', context: '200K tokens', recommended: false },
  { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', description: 'Bilanciato, ottimo per uso quotidiano aziendale', category: 'standard', context: '200K tokens', recommended: true },
  { id: 'claude-sonnet-3-7-20241205', name: 'Claude Sonnet 3.7', description: 'Veloce ed efficiente per query semplici', category: 'standard', context: '200K tokens', recommended: false }
];
function mapLegacyModelId(id){
  if(!id) return id;
  const legacyMap = { 'claude-3-sonnet-20241022':'claude-sonnet-4-20250514', 'sonnet-20241022':'claude-sonnet-4-20250514' };
  return legacyMap[id] || id;
}
function sanitizeModelId(id){
  const mapped = mapLegacyModelId(id);
  if(AVAILABLE_MODELS.some(m=>m.id===mapped)) return mapped;
  return AVAILABLE_MODELS.find(m=>m.recommended)?.id || AVAILABLE_MODELS[0].id;
}
// models endpoints moved to src/routes/config.js

// Mount config router after models are defined
const configRouter = require('./src/routes/config')({
  db,
  logger,
  axios,
  AVAILABLE_MODELS,
  sanitizeModelId,
  testClaudeAPI,
  testClickUpAPI,
  testClickUpToken,
  testDatabase,
  generateSecret,
  isAdminRequest,
});
app.use(configRouter);

// Get and update admin-visible settings (safe, non-sensitive)
/* moved to src/routes/config.js
app.get('/api/config/settings', (req, res) => {
  // Provide current safe settings and defaults
  const settings = {
    FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:8080',
    ALLOWED_DOMAIN: process.env.ALLOWED_DOMAIN || '56k.agency',
    DRIVE_MAX_BYTES: Number(process.env.DRIVE_MAX_BYTES || 10485760),
    DRIVE_CACHE_TTL: Number(process.env.DRIVE_CACHE_TTL || 600),
    CLICKUP_CACHE_TTL: Number(process.env.CLICKUP_CACHE_TTL || 3600),
    MAX_DRIVE_FILES_TO_FETCH: Number(process.env.MAX_DRIVE_FILES_TO_FETCH || 3),
    MAX_CLICKUP_TASKS_ENRICH: Number(process.env.MAX_CLICKUP_TASKS_ENRICH || 3),
    DRIVE_EXPORT_MAX_CHARS: Number(process.env.DRIVE_EXPORT_MAX_CHARS || 20000),
    ENABLE_PDF_PARSE: (process.env.ENABLE_PDF_PARSE || 'true') === 'true',
    CLICKUP_TEAM_ID: process.env.CLICKUP_TEAM_ID || ''
  };

  const defaults = { ...settings };

  res.json({ settings, defaults });
});*/

// Admin check moved to src/lib/admin (see DI)

// Update admin settings or restore defaults
/* moved to src/routes/config.js
app.put('/api/config/settings', (req, res) => {
  if(!isAdminRequest(req)) return res.status(403).json({ error: 'Admin required' });

  const { settings, restoreDefaults } = req.body || {};

  try {
    // If restoreDefaults requested, clear specific env keys to defaults
    const envPath = '.env';
    const existingEnv = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
    const envConfig = require('dotenv').parse(existingEnv || '');

    const editableKeys = [
      'FRONTEND_URL','ALLOWED_DOMAIN','DRIVE_MAX_BYTES','DRIVE_CACHE_TTL',
      'CLICKUP_CACHE_TTL','MAX_DRIVE_FILES_TO_FETCH','MAX_CLICKUP_TASKS_ENRICH',
      'DRIVE_EXPORT_MAX_CHARS','ENABLE_PDF_PARSE','CLICKUP_TEAM_ID'
    ];

    const newConfig = { ...envConfig };

    if(restoreDefaults){
      // remove editable keys to fallback to code defaults
      editableKeys.forEach(k => delete newConfig[k]);
    }

    if(settings && typeof settings === 'object'){
      // validate and apply only editableKeys
      editableKeys.forEach(k => {
        if(settings.hasOwnProperty(k)){
          newConfig[k] = String(settings[k]);
        }
      });
    }

    // Ensure SESSION_SECRET remains
    if(!newConfig.SESSION_SECRET) newConfig.SESSION_SECRET = generateSecret();

    // Persist to .env
    const envContent = Object.entries(newConfig).map(([key,val]) => `${key}=${val}`).join('\n');
    fs.writeFileSync(envPath, envContent);

    // Update process.env in-memory
    Object.assign(process.env, newConfig);

    res.json({ success: true, defaults: {
      FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:8080',
      ALLOWED_DOMAIN: process.env.ALLOWED_DOMAIN || '56k.agency',
      DRIVE_MAX_BYTES: Number(process.env.DRIVE_MAX_BYTES || 10485760),
      DRIVE_CACHE_TTL: Number(process.env.DRIVE_CACHE_TTL || 600),
      CLICKUP_CACHE_TTL: Number(process.env.CLICKUP_CACHE_TTL || 3600),
      MAX_DRIVE_FILES_TO_FETCH: Number(process.env.MAX_DRIVE_FILES_TO_FETCH || 3),
      MAX_CLICKUP_TASKS_ENRICH: Number(process.env.MAX_CLICKUP_TASKS_ENRICH || 3),
      DRIVE_EXPORT_MAX_CHARS: Number(process.env.DRIVE_EXPORT_MAX_CHARS || 20000),
      ENABLE_PDF_PARSE: (process.env.ENABLE_PDF_PARSE || 'true') === 'true',
      CLICKUP_TEAM_ID: process.env.CLICKUP_TEAM_ID || ''
    } });

  } catch (err){
    logger.error('Failed to update settings', err);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});*/

// Test API connections
/* moved to src/routes/config.js
app.post('/api/test/connection', async (req, res) => {
  const { service, credentials } = req.body;
  
  try {
    let result;
    
  switch(service) {
      case 'claude':
        result = await testClaudeAPI(credentials.apiKey);
        break;
      case 'database':
        result = await testDatabase();
        break;
      case 'clickup':
        result = await testClickUpAPI(credentials.clientId, credentials.clientSecret);
        break;
      case 'clickup_token':
        result = await testClickUpToken(credentials.apiKey);
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
});*/
// Lightweight consolidated status (no side-effects) for header badges
// moved to src/routes/status.js

// ============= GOOGLE OAUTH =============

// Initiate Google OAuth flow
app.get('/auth/google', (req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID) {
    return res.status(400).json({ error: 'Google OAuth not configured' });
  }

  const redirectUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
    `client_id=${process.env.GOOGLE_CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent('http://localhost:3000/callback/google')}` +
    `&response_type=code` +
  `&scope=${encodeURIComponent('email profile https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/drive.metadata.readonly https://www.googleapis.com/auth/drive.activity.readonly')}` +
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
      redirect_uri: 'http://localhost:3000/callback/google',
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

    // Persist encrypted refresh token in DB (if present)
    if (refresh_token) {
      const enc = encryptToken(refresh_token);
      db.run('UPDATE users SET google_refresh_token = ? WHERE email = ?', [enc, user.email], (err) => {
        if (err) logger.error('Failed to save refresh token', err);
      });
    }

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
    `&redirect_uri=${encodeURIComponent('http://localhost:3000/callback/clickup')}`;

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

// AI-FIRST APPROACH (legacy removed)
/* app.post('/api/claude/message', async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const { messages, model } = req.body;
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Messages array required' });
    }
    const userMessage = messages[messages.length - 1].content || '';
    
    logger.info('Processing query with AI-First approach', { 
      user: req.session.user.email,
      query: userMessage.substring(0, 100) 
    });

    // Initialize the AI-First Engine
    const aiEngine = new AIFirstEngine();
    
    // Get ClickUp Team ID if available
    let teamId = process.env.CLICKUP_TEAM_ID;
    if (!teamId && req.session.user.clickupToken) {
      // Try to fetch team ID dynamically
      try {
        const teamsResponse = await axios.get('https://api.clickup.com/api/v2/team', {
          headers: { 'Authorization': req.session.user.clickupToken }
        });
        if (teamsResponse.data.teams?.length > 0) {
          teamId = teamsResponse.data.teams[0].id;
        }
      } catch (error) {
        logger.warning('Could not fetch ClickUp team ID', error.message);
      }
    }
    
    // Build context object with all available connections
    const context = {
      clickupToken: req.session.user.clickupToken || null,
      googleAccessToken: req.session.user.googleAccessToken || null,
      teamId: teamId || null,
  selectedModel: sanitizeModelId(model || req.session.user.selectedModel),
      userName: req.session.user.name,
      userEmail: req.session.user.email
    };
    
    // Let the AI-First Engine handle EVERYTHING
    // No hardcoding, no patterns, just pure AI intelligence
  const aiResponse = await aiEngine.processQuery(messages, context);
    
    logger.info('AI-First processing complete', { 
      user: req.session.user.email,
      responseLength: aiResponse.length
    });
    
    // Return response in the expected format
    res.json({
      content: [{
        type: 'text',
        text: aiResponse
      }],
      model: context.selectedModel,
      usage: {}
    });

  } catch (error) {
    logger.error('AI-First processing error', {
      error: error.message,
      stack: error.stack,
      user: req.session.user?.email
    });
    
    // Fallback to basic Claude response if AI-First fails
    try {
      const { messages, model } = req.body;
  const selectedModel = sanitizeModelId(model || req.session.user.selectedModel);
      // Build lightweight conversational context for fallback (last 6 messages)
      let historySnippet = '';
      try {
        const lastMessages = (messages || []).slice(-6);
        historySnippet = lastMessages.map(m => `${m.role.toUpperCase()}: ${m.content}`)
          .join('\n');
      } catch {}
      const fallbackPrompt = `You are a helpful assistant. Use the recent conversation context below to answer the final user message.\n\nConversation (most recent last):\n${historySnippet}\n\nRespond helpfully to the last user message in the same language.`;
      const fallbackResponse = await axios.post('https://api.anthropic.com/v1/messages', {
        model: selectedModel,
        max_tokens: 2000,
        temperature: 0.7,
        messages: [ { role: 'user', content: fallbackPrompt } ]
      }, {
        headers: {
          'x-api-key': process.env.CLAUDE_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        }
      });
      logger.info('Fallback to direct Claude API succeeded');
      res.json(fallbackResponse.data);
    } catch (fallbackError) {
      logger.error('Fallback Claude API also failed', fallbackError);
      res.status(500).json({
        error: 'AI processing error',
        message: 'Mi dispiace, si è verificato un errore. Riprova tra qualche istante.'
      });
    }
  }
}); */

// Generalized RAG endpoint (planner + executor) - experimental
/*
app.post('/api/rag/chat', async (req, res) => {
  // Unified knowledge-first endpoint: retrieval + reasoning + conversational synthesis.
  if(!req.session.user) return res.status(401).json({ error:'Not authenticated' });
  const { message, include_chunk_texts=false } = req.body || {};
  if(!message) return res.status(400).json({ error:'message required' });
  const startTs = Date.now();
  const { parseIntent } = require('./src/rag/util/intentParser');
  const { synthesizeConversationalAnswer } = require('./src/rag/synthesis/synthesizer');
  // Fast-path ClickUp: apertura task da URL/ID
  try {
    const m = (message||'').trim();
    const urlMatch = m.match(/https?:\/\/app\.clickup\.com\/t\/([A-Za-z0-9-]+)/i);
    const idMatch = !urlMatch && m.match(/\btask\s+([A-Za-z0-9-]{4,})\b/i);
    const taskId = urlMatch?.[1] || idMatch?.[1] || null;
    const clickupToken = req.session.user?.clickupToken || process.env.CLICKUP_API_KEY || null;
    if (taskId && clickupToken) {
      let details = null, comments = [];
      try {
        const d = await axios.get(`https://api.clickup.com/api/v2/task/${taskId}`,{ headers:{ Authorization: clickupToken } });
        details = d.data || null;
      } catch(e){ logger.warning('Fast-path ClickUp task details failed', e.response?.data?.err || e.message); }
      try {
        const c = await axios.get(`https://api.clickup.com/api/v2/task/${taskId}/comment`,{ headers:{ Authorization: clickupToken } });
        comments = c.data?.comments || [];
      } catch(e){ }
      if (details) {
        const title = details.name || '(senza titolo)';
        const status = details.status?.status || 'unknown';
        const due = details.due_date ? new Date(Number(details.due_date)).toLocaleDateString('it-IT') : '—';
        const assignees = (details.assignees||[]).map(a=>a.username||a.email).filter(Boolean).join(', ') || '—';
        const priority = details.priority?.priority || '—';
        const url = details.url || details.short_url || `https://app.clickup.com/t/${taskId}`;
        const cmts = comments.slice(0,3).map(c=>`- ${c.user?.username||c.user?.email||'utente'}: ${(c.comment_text||'').toString().slice(0,160)}`).join('\n');
        const answer = `**Dettagli Task**\n- Titolo: ${title}\n- Stato: ${status}\n- Scadenza: ${due}\n- Assegnatari: ${assignees}\n- Priorità: ${priority}\n- Link: ${url}\n\n**Commenti recenti**\n${cmts || '—'}`;
        return res.json({ run_id: null, query: message, intent: { action:'STATUS', time_range:null, entities:{projects:[],clients:[],topics:[]} }, answer, latency_ms: Date.now()-startTs, graph:{tasks:[]}, structured:{ result:{ conclusions:[`Task ${title}`], support:[{ id: taskId, snippet: title, path: `clickup://task/${taskId}` }] } } });
      }
    }
  } catch(_ct){}

  // Fast-path ClickUp: "miei task" per oggi/settimana
  try {
    const m = (message||'').toLowerCase();
    const isMine = /(i\s+miei\s+task|miei\s+task|my\s+tasks|assegnati\s+a\s+me|assigned\s+to\s+me)/i.test(m);
    const today = /(oggi|today)\b/i.test(m);
    const week = /(settimana|questa\s+settimana|week)\b/i.test(m);
    const clickupToken = req.session.user?.clickupToken || process.env.CLICKUP_API_KEY || null;
    if (isMine && clickupToken) {
      // derive teamId and userId
      let teamId = process.env.CLICKUP_TEAM_ID || null;
      try { if(!teamId && req.session.user?.clickupToken){ const t=await axios.get('https://api.clickup.com/api/v2/team',{ headers:{ Authorization:req.session.user.clickupToken } }); teamId = t.data?.teams?.[0]?.id || null; } } catch{}
      let userId = null; try { const u = await axios.get('https://api.clickup.com/api/v2/user',{ headers:{ Authorization: clickupToken } }); userId = u.data?.user?.id || null; } catch{}
      const clickup = require('./src/connectors/clickupConnector');
      let chunks = await clickup.searchTasks({ teamId, assignee: userId? String(userId):undefined, includeClosed: false, includeSubtasks: true, limit: 200, token: clickupToken });
      // date filter client-side
      if (today || week) {
        const now = new Date();
        const start = new Date(now);
        if (today) start.setHours(0,0,0,0); else start.setTime(now.getTime() - 7*24*60*60*1000);
        const end = today ? new Date(new Date().setHours(23,59,59,999)) : new Date(now.getTime() + 7*24*60*60*1000);
        // we need original task due_date; connector chunks don't include due_date. Fallback: filter by textual cues if present; otherwise leave as-is
        // As fallback, we simply cap and present; full due filtering would need a detail fetch per task (costly). We keep it simple for fast-path.
      }
      const maxItems = Math.min(Array.isArray(chunks)?chunks.length:0, 12);
      const lines = (chunks||[]).slice(0, maxItems).map(c=>`- ${c.text.split('\n')[0]}  (Apri: ${c.path.replace('clickup://task/','https://app.clickup.com/t/')})`).join('\n');
      const head = `I tuoi task${today? ' di oggi': (week? ' della settimana':'')} trovati: ${chunks?.length||0}`;
      const tip = (chunks?.length||0) > maxItems ? `\n...e altri ${(chunks.length - maxItems)}` : '';
      const answer = `**${head}**\n\n${lines}${tip}`;
      return res.json({ run_id: null, query: message, intent: { action:'LIST', time_range: today? 'today': (week? 'week': null), entities: { projects:[], clients:[], topics:[] } }, answer, latency_ms: Date.now()-startTs, graph:{tasks:[]}, structured:{ result:{ conclusions:[head], support:(chunks||[]).slice(0,15).map(c=>({ id:c.id, snippet:c.text.slice(0,200), path:c.path })) } } });
    }
  } catch(_my){}
  // Fast-path for richieste frequenti su task in ritardo/urgenti per evitare latenza LLM
  try {
    const m = (message||'').toLowerCase();
    const reOverdue = /(in\s+ritardo|ritardi|overdue|scadenz|scadut[oi]e?)/i;
    const reUrgent = /(urgenti?|priorit\u00e0\s*alta|alta\s*priorit\u00e0|urgent|high\s*priority)/i;
    const wantsOverdue = reOverdue.test(m);
    const wantsUrgent = reUrgent.test(m);
    const clickupToken = req.session.user?.clickupToken || process.env.CLICKUP_API_KEY || null;
    if ((wantsOverdue || wantsUrgent) && clickupToken) {
      // Deriva teamId se possibile
      let teamId = process.env.CLICKUP_TEAM_ID || null;
      if(!teamId && req.session.user?.clickupToken){
        try { const t = await axios.get('https://api.clickup.com/api/v2/team', { headers:{ Authorization: req.session.user.clickupToken } }); teamId = t.data?.teams?.[0]?.id || null; } catch(_e){}
      }
      const clickup = require('./src/connectors/clickupConnector');
      // Overdue: usa flag dedicato; Urgenti: filtra per priority lato client (se presente)
      let chunks = [];
      try {
        if (wantsOverdue) {
          chunks = await clickup.searchTasks({ teamId, overdueOnly: true, includeClosed: false, includeSubtasks: true, limit: 100, token: clickupToken });
        } else {
          // urgente: prendi un set di aperti e filtra testualmente (il connector non espone priority in chunks)
          chunks = await clickup.searchTasks({ teamId, includeClosed: false, includeSubtasks: true, limit: 100, token: clickupToken });
        }
      } catch(e){ logger.error('Fast-path ClickUp search failed', e.message||e); chunks = []; }
      if (Array.isArray(chunks)) {
        // Build risposta rapida senza LLM
        const maxItems = Math.min(chunks.length, 12);
        const lines = chunks.slice(0, maxItems).map((c,i)=>`- ${c.text.split('\n')[0]}  (Apri: ${c.path.replace('clickup://task/','https://app.clickup.com/t/')})`);
        const head = wantsOverdue ? `Task in ritardo trovati: ${chunks.length}` : `Task urgenti/aperti trovati: ${chunks.length}`;
        const tip = chunks.length>maxItems ? `\n...e altri ${chunks.length-maxItems}` : '';
        const answer = `**${head}**\n\n${lines.join('\n')}${tip}`;
        return res.json({ run_id: null, query: message, intent: { action:'LIST', time_range:null, entities:{ projects:[], clients:[], topics:[] } }, answer, latency_ms: Date.now()-startTs, graph: { tasks: [] }, structured: { result: { conclusions: [head], support: chunks.slice(0,15).map((c,i)=>({ id:c.id, snippet:c.text.slice(0,200), path:c.path })) } } });
      }
    }
  } catch(_fp){}

// Fast-path Drive: documenti recenti (oggi/settimana/mese/recenti)
  try {
    const text = (message||'').toLowerCase();
    const mentionsDocs = /(documenti|documento|file|files|doc|docs|drive)/i.test(text);
    const mentionsRecency = /(oggi|today|settimana|questa\s+settimana|week|mese|ultimo\s+mese|month|recenti|recent|ultimi|aggiornati|modificati)/i.test(text);
    if (mentionsDocs && mentionsRecency) {
      // Compute time filter
      const now = new Date();
      let since = null;
      if (/(oggi|today)/i.test(text)) {
        since = new Date(); since.setHours(0,0,0,0);
      } else if (/(settimana|questa\s+settimana|week)/i.test(text)) {
        since = new Date(now.getTime() - 7*24*60*60*1000);
      } else if (/(mese|ultimo\s+mese|month)/i.test(text)) {
        since = new Date(now.getTime() - 30*24*60*60*1000);
      } else if (/(recenti|recent|ultimi|aggiornati|modificati)/i.test(text)) {
        since = new Date(now.getTime() - 7*24*60*60*1000);
      }
      // Get access token (refresh if needed)
      let accessToken = null;
      try { accessToken = await getUserGoogleToken(req); } catch(_) { accessToken = req.session.user?.googleAccessToken || null; }
      if (accessToken) {
        const qParts = ["trashed = false"]; if (since) qParts.push(`modifiedTime > '${since.toISOString()}'`);
        const q = qParts.join(' and ');
        let files = [];
        try {
          const resp = await axios.get('https://www.googleapis.com/drive/v3/files', {
            headers: { Authorization: `Bearer ${accessToken}` },
            params: {
              q,
              orderBy: 'modifiedTime desc',
              pageSize: 25,
              fields: 'files(id,name,mimeType,webViewLink,createdTime,modifiedTime,owners) ',
              corpora: 'allDrives', includeItemsFromAllDrives: true, supportsAllDrives: true
            }
          });
          files = resp.data?.files || [];
        } catch(e){ logger.error('Drive fast-path query failed', e.response?.data?.error?.message || e.message); files = []; }
        const fmt = (f)=> `- ${f.name} (${new Date(f.modifiedTime).toLocaleDateString('it-IT')})  [Apri](${f.webViewLink})`;
        const head = `Documenti ${since? 'modificati di recente':''}: ${files.length}`;
        const top = files.slice(0,12).map(fmt).join('\n');
        const tip = files.length>12? `\n...e altri ${files.length-12}`: '';
        const answer = `**${head}**\n\n${top}${tip}`;
        return res.json({ run_id: null, query: message, intent: { action:'LIST', time_range: null, entities: { projects:[], clients:[], topics:[] } }, answer, latency_ms: Date.now()-startTs, graph: { tasks: [] }, structured: { result: { conclusions: [head], support: files.slice(0,15).map(f=>({ id: f.id, snippet: `${f.name} (${f.modifiedTime})`, path: f.webViewLink })) } } });
      }
    }
  } catch(_dfp){}
  // Small-talk / greeting shortcut: keep it friendly and useful without RAG
  try {
    const m = (message||'').trim().toLowerCase();
    const isGreeting = /^(ciao|hey|ehi|salve|buongiorno|buonasera|hola|hello|hi)[!.\s]*$/.test(m) || m.length <= 4;
    if (isGreeting) {
      const userName = req.session.user?.name?.split(' ')[0] || 'Simone';
      const clickupConnected = !!(req.session.user?.clickupToken || process.env.CLICKUP_API_KEY);
      const driveConnected = !!(req.session.user?.googleAccessToken || (process.env.GOOGLE_CREDENTIALS_JSON && process.env.GOOGLE_IMPERSONATED_USER_EMAIL));
      const prompt = `Sei l'Assistente Esecutivo AI di 56k Agency. Saluta l'utente (${userName}) in modo caldo e professionale in italiano, spiega brevemente cosa puoi fare con le connessioni disponibili e proponi 3 esempi di domande utili.\nConnessioni: ClickUp=${clickupConnected?'connesso':'non connesso'}, Drive=${driveConnected?'connesso':'non connesso'}. Non chiedere autorizzazioni tecniche, proponi direttamente azioni.`;
      const text = await claudeRequest(process.env.CLAUDE_RAG_UTILITY_MODEL || process.env.SELECTED_CLAUDE_MODEL || 'claude-sonnet-4-20250514', prompt, 400, 0.2);
      return res.json({ run_id: null, query: message, intent: { action:'CHAT', entities:{projects:[],clients:[]} }, answer: text, latency_ms: Date.now()-startTs, graph: { tasks: [] }, structured: { result: { conclusions: [text], support: [] } } });
    }
  } catch(_){}
  let intent;
  try {
    intent = await parseIntent(message);
  } catch (e) {
    logger.error('Intent parsing failed', e?.message || e);
    const detail = (e && e.cause && (e.cause.response?.data?.error?.message || e.cause.code || e.cause.message)) || '';
    return res.status(503).json({ error: 'ai_unavailable', message: 'Servizio AI non raggiungibile (intent). Verifica connessione o chiave API.', detail });
  }
  // Sanitize intent entities arrays for downstream usage (synthesizer)
  try {
    intent.entities = intent.entities || {};
    if (!Array.isArray(intent.entities.projects)) intent.entities.projects = [];
    if (!Array.isArray(intent.entities.clients)) intent.entities.clients = [];
  } catch(_){}
  let graph;
  // Identity shortcut: answer directly using session context when user asks "chi sono io"/"who am I"
  try {
    const idq = /\b(chi\s+sono(\s+io)?|who\s+am\s+i)\b/i;
    if (idq.test(message||'')) {
      const clickupConnected = !!(req.session.user?.clickupToken || process.env.CLICKUP_API_KEY);
      const driveConnected = !!(req.session.user?.googleAccessToken || (process.env.GOOGLE_CREDENTIALS_JSON && process.env.GOOGLE_IMPERSONATED_USER_EMAIL));
      const name = req.session.user?.name || 'Utente';
      const email = req.session.user?.email || 'n/d';
      // Enrich with lightweight live data
      let cuSummary = '';
      try {
        if (clickupConnected) {
          const cuToken = req.session.user?.clickupToken || process.env.CLICKUP_API_KEY;
          const uResp = await axios.get('https://api.clickup.com/api/v2/user', { headers: { Authorization: cuToken } });
          const me = uResp.data?.user; const userId = me?.id;
          // derive team id
          let teamId = process.env.CLICKUP_TEAM_ID;
          if (!teamId) {
            try { const t = await axios.get('https://api.clickup.com/api/v2/team', { headers:{ Authorization: cuToken } }); teamId = t.data?.teams?.[0]?.id; } catch{}
          }
          let openCount = 0, overdue = 0; let sample = [];
          if (teamId && userId) {
            const params = { page: 0, include_closed: true, subtasks: true };
            params['assignees[]'] = [userId];
            const tResp = await axios.get(`https://api.clickup.com/api/v2/team/${teamId}/task`, { headers: { Authorization: cuToken }, params });
            const tasks = tResp.data?.tasks || [];
            const now = Date.now();
            const isClosed = (t) => ((t.status?.type||'').toLowerCase()==='done') || ((t.status?.status||'').toLowerCase()==='closed');
            openCount = tasks.filter(t=>!isClosed(t)).length;
            overdue = tasks.filter(t=>!isClosed(t) && t.due_date && Number(t.due_date) < now).length;
            sample = tasks.slice(0,3).map(t=>`- ${t.name}${(t.due_date && Number(t.due_date) < now)?' (in ritardo)':''}`);
          }
          cuSummary = `\n\nTask (ClickUp):\n- Assegnati (aperti): ${openCount}${overdue? `\n- In ritardo: ${overdue}`:''}${sample.length? `\nEsempi:\n${sample.join('\n')}`:''}`;
        }
      } catch(_){}
      let driveSummary = '';
      try {
        if (driveConnected && req.session.user?.googleAccessToken) {
          const dResp = await axios.get('https://www.googleapis.com/drive/v3/files', {
            headers: { Authorization: `Bearer ${req.session.user.googleAccessToken}` },
            params: { orderBy: 'modifiedTime desc', pageSize: 5, fields: 'files(id,name,modifiedTime,webViewLink,owners)' }
          });
          const files = dResp.data?.files || [];
          if (files.length) {
            const lines = files.map(f=>`- ${f.name} (${new Date(f.modifiedTime).toLocaleDateString('it-IT')})`);
            driveSummary = `\n\nDocumenti recenti (Drive):\n${lines.join('\n')}`;
          }
        }
      } catch(_){}
      const header = `Ciao ${name}! Sono il tuo Assistente Esecutivo AI di 56k Agency.`;
      const who = `\n\nChi sei – Profilo\n- Nome: ${name}\n- Email: ${email}\n- Connessioni: ClickUp=${clickupConnected? 'connesso':'non connesso'}, Drive=${driveConnected? 'connesso':'non connesso'}`;
      const next = `\n\nCosa posso fare per te\n- Aggiornarti sui task e priorità\n- Cercare documenti e riassumerli\n- Incrociare informazioni tra fonti per insight`;
      const answer = `${header}${who}${cuSummary}${driveSummary}${next}`;
      return res.json({ run_id: null, query: message, intent, answer, latency_ms: Date.now()-startTs, graph: { tasks: [] }, structured: { result: { conclusions: [answer], support: [] } } });
    }
  } catch(_){}
  try { graph = await plan(message); } catch(e){
    logger.error('Planner failed', e.message||e);
    return res.status(500).json({ error:'planner_failed', message:'Pianificazione AI non disponibile.' });
  }
  // Planner augmentation based on intent/entities (client/project keywords)
  try {
    const hasClickUp = Array.isArray(graph.tasks) && graph.tasks.some(t=> t.type==='tool_call' && typeof t.tool==='string' && t.tool.startsWith('clickup.'));
    if (!hasClickUp && Array.isArray(graph.tasks)) {
      const keywords = [];
      (intent.entities?.clients||[]).forEach(c=> c && keywords.push(c));
      (intent.entities?.projects||[]).forEach(p=> p && keywords.push(p));
      const wantsTasks = /\b(task|tasks|tickets?|attivit[àa]|to-?do|lavori)\b/i.test(message);
      if (keywords.length || wantsTasks) {
        const queryTerm = keywords[0] || (message.slice(0,64));
        const newId = 't_clickup_search';
        const newTask = { id: newId, type:'tool_call', tool:'clickup.searchTasks', params:{ query: queryTerm, includeClosed:true, includeSubtasks:true, limit: 200 } };
        const idxAnnot = graph.tasks.findIndex(t=> t.type==='annotate');
        const idxReason = graph.tasks.findIndex(t=> t.type==='reason');
        const insertAt = idxAnnot >= 0 ? idxAnnot : (idxReason >= 0 ? idxReason : graph.tasks.length);
        graph.tasks.splice(insertAt, 0, newTask);
        const target = graph.tasks.find(t=> t.type==='annotate') || graph.tasks.find(t=> t.type==='reason') || null;
        if (target) {
          target.inputs = Array.isArray(target.inputs) ? Array.from(new Set([...target.inputs, newId])) : [newId];
        }
        logger.info('Auto-injected clickup.searchTasks based on intent/entities', { query: queryTerm });
      }
    }
  } catch(augErr) { logger.warning('Planner augmentation (intent) failed', { error: augErr.message }); }
  // Heuristic auto-augmentation: if query asks for overdue/urgent tasks and planner didn't add ClickUp, inject a ClickUp searchTasks node
  try {
    const text = (message||'').toLowerCase();
    const wantsOverdue = /(in\s+ritardo|ritardi|overdue|scadenz|scadut[oi]e?|urgenti?|priorit\u00e0\s*alta|alta\s*priorit\u00e0)/i.test(text);
    const hasClickUp = Array.isArray(graph.tasks) && graph.tasks.some(t=> t.type==='tool_call' && typeof t.tool==='string' && t.tool.startsWith('clickup.'));
    if (wantsOverdue && !hasClickUp && Array.isArray(graph.tasks)) {
      const newId = 't_clickup_overdue';
      const newTask = { id: newId, type:'tool_call', tool:'clickup.searchTasks', params:{ overdueOnly:true, includeClosed:false, limit:100 } };
      // Insert before first annotate if present, else before reason, else at end
      const idxAnnot = graph.tasks.findIndex(t=> t.type==='annotate');
      const idxReason = graph.tasks.findIndex(t=> t.type==='reason');
      const insertAt = idxAnnot >= 0 ? idxAnnot : (idxReason >= 0 ? idxReason : graph.tasks.length);
      graph.tasks.splice(insertAt, 0, newTask);
      // Ensure downstream stages consider these results: include in the first annotate/reason task inputs if present
      const target = graph.tasks.find(t=> t.type==='annotate') || graph.tasks.find(t=> t.type==='reason') || null;
      if (target) {
        target.inputs = Array.isArray(target.inputs) ? Array.from(new Set([...target.inputs, newId])) : [newId];
      }
      logger.info('Auto-injected clickup.searchTasks for overdue intent');
    }
  } catch(autoErr) { logger.warning('Auto augmentation failed', { error: autoErr.message }); }
  try {
    graph.intents = Array.isArray(graph.intents)? Array.from(new Set([...graph.intents, intent.action.toLowerCase()])) : [intent.action.toLowerCase()];
    const reasonTask = graph.tasks.find(t=>t.type==='reason');
    if(reasonTask){
      if(intent.action==='STATUS') reasonTask.goal='status';
      else if(intent.action==='REPORT') reasonTask.goal='report';
      else if(intent.action==='COMPARE') reasonTask.goal='comparison';
      else if(intent.action==='RISKS') reasonTask.goal='risks';
      else if(intent.action==='LIST') reasonTask.goal='listing';
      else reasonTask.goal = reasonTask.goal||'summary';
    }
  } catch(adjErr){ logger.warning('Goal adjust failed', { error: adjErr.message }); }
  try {
    if(graph && Array.isArray(graph.tasks)){
      const seen=[]; let fixed=0;
      graph.tasks.forEach((t,i)=>{
        if(!t.id){ t.id='t'+(i+1); fixed++; }
        if(t.type!=='retrieve'){
          if(!Array.isArray(t.inputs)||!t.inputs.length){
            const fallback = seen.slice().reverse().find(id=>id);
            if(fallback){ t.inputs=[fallback]; fixed++; }
          }
        }
        seen.push(t.id);
      });
      if(fixed) logger.info('Planner graph sanitized', { fixed });
    }
  } catch(saniErr){ logger.error('Graph sanitize failed', saniErr.message); }
  // Inject ClickUp token/team into tool_call params produced by planner
  try {
    if (graph && Array.isArray(graph.tasks)) {
      const userClickupToken = req.session.user?.clickupToken || null;
      let effectiveTeamId = process.env.CLICKUP_TEAM_ID || null;
      // Derive teamId dynamically if not set and user has OAuth token
      if (!effectiveTeamId && userClickupToken) {
        try {
          const tResp = await axios.get('https://api.clickup.com/api/v2/team', {
            headers: { 'Authorization': userClickupToken }
          });
          effectiveTeamId = tResp.data?.teams?.[0]?.id || null;
        } catch(e){ logger.warning('Could not derive ClickUp team id for injection', e.message||e); }
      }
      // Optionally resolve assignee:'currentUser' once
      let cuUserId = null;
      async function ensureCuUserId(){
        if (cuUserId || !userClickupToken) return cuUserId;
        try {
          const u = await axios.get('https://api.clickup.com/api/v2/user', { headers: { Authorization: userClickupToken } });
          cuUserId = u.data?.user?.id || null;
        } catch(e){ logger.warning('Could not resolve ClickUp current user id', e.message||e); }
        return cuUserId;
      }
      for (const t of graph.tasks) {
        if (!t || t.type !== 'tool_call' || typeof t.tool !== 'string') continue;
        t.params = t.params || {};
        // ClickUp
        if (t.tool.startsWith('clickup.')) {
          if (userClickupToken && !t.params.token) t.params.token = userClickupToken;
          const fn = t.tool.split('.')[1];
          if (!t.params.teamId && effectiveTeamId && (fn === 'searchTasks' || fn === 'listSpaces')) {
            t.params.teamId = effectiveTeamId;
          }
          // Map assignee:'currentUser' to ClickUp user id
          if (t.params && t.params.assignee === 'currentUser') {
            const id = await ensureCuUserId();
            if (id) t.params.assignee = String(id);
          }
        }
        // Google Drive: inject user OAuth token so connector can use it (fallback if no service account)
        if (t.tool.startsWith('googleDrive.')) {
          if (req.session.user?.googleAccessToken && !t.params.accessToken) {
            t.params.accessToken = req.session.user.googleAccessToken;
          }
        }
      }
    }
  } catch (injectErr) { logger.warning('ClickUp param inject failed', { error: injectErr.message }); }
  const runId = require('crypto').randomUUID();
  graph.run_id = runId;
  let execResult;
  try { execResult = await executeGraph(graph); } catch(execErr){
    logger.error('RAG execution failed', execErr.message||execErr);
    if(/reasoning_failed/.test(execErr.message||'')) return res.status(500).json({ error:'reason_failed', message:'Ragionamento AI non riuscito.' });
    if(/Entity annotation incomplete|Claim annotation incomplete/.test(execErr.message||'')) return res.status(500).json({ error:'annotator_failed', message:'Annotazione incompleta.' });
    return res.status(500).json({ error:'rag_failed', message:'Pipeline non riuscita.' });
  }
  // Fallback: se non abbiamo evidenze/conclusioni e l'utente chiede task in ritardo/urgenti, interroga ClickUp direttamente
  try {
    const wantsOverdueGeneral = /(in\s+ritardo|ritardi|overdue|scadenz|scadut[oi]e?|urgenti?|priorit\u00e0\s*alta|alta\s*priorit\u00e0)/i.test(message||'');
    const missingEvidence = !execResult || ((!execResult.support || !execResult.support.length) && (!execResult.conclusions || !execResult.conclusions.length) && !execResult.text);
    if (wantsOverdueGeneral && missingEvidence) {
      const clickup = require('./src/connectors/clickupConnector');
      const userClickupToken = req.session.user?.clickupToken || null;
      let teamId = process.env.CLICKUP_TEAM_ID || null;
      if(!teamId && userClickupToken){
        try { const tResp = await axios.get('https://api.clickup.com/api/v2/team', { headers:{ Authorization: userClickupToken } }); teamId = tResp.data?.teams?.[0]?.id || null; } catch(_){}
      }
      if (teamId || userClickupToken || process.env.CLICKUP_API_KEY) {
        const chunks = await clickup.searchTasks({ teamId, overdueOnly: true, includeClosed: false, limit: 50, token: userClickupToken });
        if (Array.isArray(chunks) && chunks.length) {
          const support = chunks.slice(0, 15).map((c,i)=>({ id:c.id, snippet: c.text.slice(0,200), path: c.path }));
          execResult = { conclusions: [`Trovati ${chunks.length} task rilevanti (in ritardo o aperti prossimi alla scadenza).`], support };
          logger.info('Applied direct ClickUp fallback with support', { count: chunks.length });
        }
      }
    }
  } catch(fbErr){ logger.warning('Direct ClickUp fallback failed', { error: fbErr.message }); }
  const latency = Date.now() - startTs;
  try {
    const conclusionsJson = JSON.stringify(execResult.conclusions || execResult.result?.conclusions || []);
    const supportCount = (execResult.support||[]).length;
    db.run(`INSERT INTO rag_runs (id,user_email,query,intents,graph_json,conclusions_json,support_count,valid,latency_ms) VALUES (?,?,?,?,?,?,?,?,?)`,
      [runId, req.session.user.email, message, (graph.intents||[]).join(','), JSON.stringify(graph), conclusionsJson, supportCount, execResult.validator?.valid?1:(execResult.valid?1:0), latency],
      (err)=>{ if(err) logger.error('rag_runs insert failed', err.message); }
    );
    try {
      db.run('INSERT INTO rag_artifacts (run_id, stage, payload) VALUES (?,?,?)', [runId,'planner',JSON.stringify(graph)]);
      db.run('INSERT INTO rag_artifacts (run_id, stage, payload) VALUES (?,?,?)', [runId,'compose',JSON.stringify(execResult)]);
    } catch(e){ logger.error('artifact insert failed', e.message); }
  } catch(logErr){ logger.error('RAG logging failed', logErr.message||logErr); }
  if(include_chunk_texts){
    try {
      const chunkIds = new Set();
      (execResult.support||[]).forEach(s=> s.id && chunkIds.add(s.id));
      (execResult.conclusion_grounding||[]).forEach(cg=> (cg.spans||[]).forEach(sp=> sp.chunk_id && chunkIds.add(sp.chunk_id)));
      const ids = Array.from(chunkIds).slice(0,300);
      if(ids.length){
        const placeholders = ids.map(()=>'?').join(',');
        await new Promise(resolve=>{ db.all(`SELECT id,text,path,loc,src_start,src_end,source,type FROM rag_chunks WHERE id IN (${placeholders})`, ids, (e,rows)=>{ if(!e&&rows) execResult.chunk_texts=rows; resolve(); }); });
      } else execResult.chunk_texts=[];
    } catch(enrichErr){ logger.error('chunk_text enrichment failed', enrichErr.message); }
  }
  let answer = await synthesizeConversationalAnswer(message, intent, execResult, sanitizeModelId(req.session.user.selectedModel), process.env.CLAUDE_API_KEY);
  return res.json({ run_id: runId, query: message, intent, answer, latency_ms: latency, graph, structured: execResult });
});*/

// Auto mode classifier (hybrid heuristic + optional LLM gating)
app.post('/api/mode/classify', async (req,res)=>{
  if(!req.session.user) return res.status(401).json({ error:'Not authenticated' });
  const { query } = req.body||{};
  if(!query || typeof query!=='string') return res.status(400).json({ error:'query required' });
  const { parseIntent } = require('./src/rag/util/intentParser');
  try {
    const intent = await parseIntent(query);
    db.run(`INSERT INTO rag_mode_decisions (query,decided_mode,heuristic_score,used_llm,llm_reason) VALUES (?,?,?,?,?)`,
      [query, 'rag', 1.0, 1, intent.action], ()=>{});
    return res.json({ mode:'rag', action:intent.action, time_range:intent.time_range, entities:intent.entities });
  } catch(e){
    const detail = (e && e.cause && (e.cause.response?.data?.error?.message || e.cause.code || e.cause.message)) || '';
    return res.status(503).json({ error:'ai_unavailable', message:'Servizio AI non raggiungibile (classify). Verifica connessione o chiave API.', detail });
  }
});

// Batch fetch chunk texts now handled in src/routes/rag.js

// RAG feedback endpoints moved to src/routes/rag.js

// Trigger embedding of pending lexicon terms (admin only)
// Lexicon endpoints handled in src/routes/rag.js

// List lexicon terms (paged)
// Lexicon listing handled in src/routes/rag.js

// ---- Metrics & Quality Dashboard Data ----
// Metrics overview handled by src/routes/rag.js

// Promote human labels (product/entity terms) into lexicon and embed
// Lexicon promote handled by src/routes/rag.js

// Estimate precision@k (k=5,10) using feedback as relevance proxy (rating>=4) and top retrieved artifacts
// Precision metrics handled by src/routes/rag.js

// --- Ground Truth CRUD (admin) ---
// Ground truth CRUD handled by src/routes/rag.js

// Ground truth based precision/recall evaluation
// Ground truth metrics handled by src/routes/rag.js

// Audit export endpoints removed (handled in router or not used)

// ---- Adaptive Retrieval Weights ----
// Retrieval weights endpoints handled by src/routes/rag.js

// Recompute weights from recent feedback (simple heuristic)
// Retrieval recompute handled by src/routes/rag.js

// ---- Active Learning: label management ----
// Labels endpoints handled by src/routes/rag.js

// Uncertain chunks suggestion (simple: chunks with claim_statement but no prohibition/permission labels and no human labels)
// Active learning endpoints handled by src/routes/rag.js

// ClickUp API proxy

// Legacy token helpers handled in src/lib/tokens

 

 

 

 

 

 

 

// ============= CONVERSATIONS =============

// Get user conversations
// conversations endpoints moved to src/routes/conversations.js

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

async function testClickUpToken(apiKey){
  try {
    const resp = await axios.get('https://api.clickup.com/api/v2/user', { headers: { 'Authorization': apiKey } });
    if(resp.status === 200) return { success: true };
    return { success: false, error: 'Unexpected status ' + resp.status };
  } catch (e){
    const msg = e?.response?.data?.err || e?.response?.data?.error || e?.message || 'Unknown error';
    return { success: false, error: msg };
  }
}

async function testDatabase() {
  return new Promise((resolve) => {
    // Simple query to verify database is reachable and writable
    db.get("SELECT name FROM sqlite_master WHERE type='table' LIMIT 1", (err, row) => {
      if (err) return resolve({ success: false, error: err.message });
      // also try a transient write to ensure writable
      try {
        const key = 'health_check_' + Date.now();
        db.run("INSERT INTO configuration (key, value) VALUES (?, ?)", [key, 'ok'], (insertErr) => {
          if (insertErr) {
            return resolve({ success: false, error: insertErr.message });
          }
          // cleanup
          db.run("DELETE FROM configuration WHERE key = ?", [key], (delErr) => {
            if (delErr) return resolve({ success: false, error: delErr.message });
            return resolve({ success: true });
          });
        });
      } catch (e) {
        return resolve({ success: false, error: e.message });
      }
    });
  });
}

function generateSecret() {
  return require('crypto').randomBytes(32).toString('hex');
}

// ============= START SERVER =============

// Health moved to status router

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
