// server.js - Backend sicuro per 56k Knowledge Hub
const express = require('express');
const cors = require('cors');
const session = require('express-session');
const axios = require('axios');
const { OAuth2Client } = require('google-auth-library');
const crypto = require('crypto');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const ExcelJS = require('exceljs');
const unzipper = require('unzipper');
const xml2js = require('xml2js');
require('dotenv').config();

// Import AI-First Engine (new structured path)
const AIFirstEngine = require('./src/engines/ai-first-engine');
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

// Lightweight version endpoint (health tooling / debugging)
app.get('/version', (req, res) => {
  res.json({ version: APP_VERSION, timestamp: new Date().toISOString() });
});

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

// Max bytes to download/parse from Drive (default 10 MB)
const DRIVE_MAX_BYTES = parseInt(process.env.DRIVE_MAX_BYTES, 10) || (10 * 1024 * 1024);

// Encryption helpers for tokens
const ENC_ALGO = 'aes-256-gcm';
const ENC_KEY = process.env.TOKEN_ENC_KEY || null; // must be 32 bytes base64
function encryptToken(plain) {
  if (!ENC_KEY) return plain;
  const key = Buffer.from(ENC_KEY, 'base64');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ENC_ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

function decryptToken(enc) {
  if (!ENC_KEY) return enc;
  try {
    const key = Buffer.from(ENC_KEY, 'base64');
    const data = Buffer.from(enc, 'base64');
    const iv = data.slice(0, 12);
    const tag = data.slice(12, 28);
    const encrypted = data.slice(28);
    const decipher = crypto.createDecipheriv(ENC_ALGO, key, iv);
    decipher.setAuthTag(tag);
    const out = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return out.toString('utf8');
  } catch (e) {
    return null;
  }
}

/**
 * Helper: getCachedOrFetch using sqlite as cache store
 * key: string cache key
 * ttlSeconds: time-to-live in seconds
 * fetchFn: async function that returns data to cache
 */
function getCachedOrFetch(key, ttlSeconds, fetchFn) {
  return new Promise((resolve, reject) => {
    db.get('SELECT value, updated_at FROM clickup_cache WHERE key = ?', [key], async (err, row) => {
      if (err) return reject(err);

      const now = Date.now();
      if (row && row.updated_at) {
        const updated = new Date(row.updated_at).getTime();
        if ((now - updated) < (ttlSeconds * 1000)) {
          try {
            return resolve(JSON.parse(row.value));
          } catch (e) {
            // fall through to fetch
          }
        }
      }

      try {
        const fresh = await fetchFn();
        const value = JSON.stringify(fresh);
        const updated_at = new Date().toISOString();
        db.run('INSERT OR REPLACE INTO clickup_cache (key, value, updated_at) VALUES (?,?,?)', [key, value, updated_at], (e) => {
          if (e) logger.error('Failed to write cache', e);
        });
        return resolve(fresh);
      } catch (fetchErr) {
        // On fetch error, return stale cache if present
        if (row && row.value) {
          try { return resolve(JSON.parse(row.value)); } catch (e) { /* ignore */ }
        }
        return reject(fetchErr);
      }
    });
  });
}

// Helper to get current user's Google access token
async function getUserGoogleToken(req) {
  if (!req.session.user) throw new Error('Not authenticated');
  return new Promise((resolve, reject) => {
    db.get('SELECT google_access_token FROM users WHERE email = ?', [req.session.user.email], (err, row) => {
      if (err) return reject(err);
      // Prefer session token if present
      resolve(req.session.user.googleAccessToken || row?.google_access_token || null);
    });
  });
}

// Fetch (and cache) exported text content for Google-native files
async function fetchDriveFileContentWithCache(fileId, accessToken) {
  const cacheKey = `user:drive:file:${fileId}`;
  return getCachedOrFetch(cacheKey, 600, async () => {
    // First, get metadata (size, mimeType, name) to enforce size limits
    let meta = {};
    try {
      const metaResp = await axios.get(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: { fields: 'mimeType, name, size' }
      });
      meta = metaResp.data || {};
    } catch (me) {
      meta = {};
    }

    const size = parseInt(meta.size || '0', 10) || 0;
    if (size > DRIVE_MAX_BYTES) {
      return { contentText: null, info: { error: 'file_too_large', size } };
    }

    // Try to export as plain text for Google-native files
    try {
      const resp = await axios.get(`https://www.googleapis.com/drive/v3/files/${fileId}/export`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: { mimeType: 'text/plain' },
        responseType: 'text'
      });
      return { contentText: resp.data };
    } catch (e) {
      // Fallback: download file binary and try to parse based on mimeType
      const resp2 = await axios.get(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: { alt: 'media' },
        responseType: 'arraybuffer'
      });
      const buffer = Buffer.from(resp2.data);

      const mime = meta.mimeType || '';

      // PDF
      if (mime === 'application/pdf' || buffer.slice(0,4).toString('hex') === '25504446') {
        try {
          const data = await pdfParse(buffer);
          return { contentText: data.text };
        } catch (pe) {
          return { contentText: null, info: { parsed: false } };
        }
      }

      // DOCX (Office Open XML) - parse using mammoth or unzip + xml
      if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || meta.name?.endsWith('.docx')) {
        try {
          const result = await mammoth.extractRawText({ buffer });
          return { contentText: result.value };
        } catch (me) {
          // try unzip + xml parsing fallback
          try {
            const entries = await unzipper.Open.buffer(buffer);
            const doc = entries.files.find(f => f.path === 'word/document.xml');
            if (doc) {
              const content = await doc.buffer();
              const xml = content.toString('utf8');
              const parsed = await xml2js.parseStringPromise(xml);
              // Extract text nodes
              let text = '';
              const extractText = (node) => {
                if (typeof node === 'string') text += node + ' ';
                if (Array.isArray(node)) node.forEach(extractText);
                if (typeof node === 'object') Object.values(node).forEach(extractText);
              };
              extractText(parsed);
              return { contentText: text };
            }
          } catch (ue) {
            return { contentText: null, info: { parsed: false } };
          }
        }
      }

      // XLSX - try to read cells as CSV-ish
      if (mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || meta.name?.endsWith('.xlsx')) {
        try {
          const workbook = new ExcelJS.Workbook();
          await workbook.xlsx.load(buffer);
          let csv = '';
          workbook.eachSheet((sheet) => {
            csv += `Sheet: ${sheet.name}\n`;
            sheet.eachRow((row) => {
              csv += row.values.slice(1).join('\t') + '\n';
            });
            csv += '\n';
          });
          return { contentText: csv };
        } catch (xe) {
          return { contentText: null, info: { parsed: false } };
        }
      }

      // PPTX - extract text from slides (basic)
      if (mime === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' || meta.name?.endsWith('.pptx')) {
        try {
          const entries = await unzipper.Open.buffer(buffer);
          const texts = [];
          for (const f of entries.files) {
            if (f.path.startsWith('ppt/slides/slide') && f.path.endsWith('.xml')) {
              const b = await f.buffer();
              const xml = b.toString('utf8');
              const parsed = await xml2js.parseStringPromise(xml);
              const extractText = (node) => {
                let out = '';
                if (typeof node === 'string') out += node + ' ';
                if (Array.isArray(node)) node.forEach(n => out += extractText(n));
                if (typeof node === 'object') Object.values(node).forEach(n => out += extractText(n));
                return out;
              };
              texts.push(extractText(parsed));
            }
          }
          return { contentText: texts.join('\n---\n') };
        } catch (pe) {
          return { contentText: null, info: { parsed: false } };
        }
      }

      // Unknown binary - return size info
      return { contentText: null, info: { size: buffer.length } };
    }
  });
}

// Endpoint: export Drive file content (Google-native) - returns truncated contentText
app.get('/api/drive/file/:fileId/content', async (req, res) => {
  try {
    const token = await getUserGoogleToken(req);
    if (!token) return res.status(400).json({ error: 'Google not connected' });
    const { fileId } = req.params;
    const data = await fetchDriveFileContentWithCache(fileId, token);
    // Truncate to safe size
    if (data.contentText && data.contentText.length > 100000) {
      data.contentText = data.contentText.slice(0, 100000) + '\n...truncated...';
    }
    res.json(data);
  } catch (error) {
    logger.error('Drive file content export error', error.message || error);
    res.status(500).json({ error: 'Failed to export Drive file content' });
  }
});

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

// Get configuration overview (safe version for settings page)
app.get('/api/config/overview', (req, res) => {
  res.json({
    claude: !!process.env.CLAUDE_API_KEY,
    google: !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET,
    clickup: !!process.env.CLICKUP_CLIENT_ID && !!process.env.CLICKUP_CLIENT_SECRET,
    allowedDomain: process.env.ALLOWED_DOMAIN || '56k.agency'
  });
});

// Save configuration (secure - only saves to database, not env)
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

// Get and update admin-visible settings (safe, non-sensitive)
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
    ENABLE_PDF_PARSE: (process.env.ENABLE_PDF_PARSE || 'true') === 'true'
  };

  const defaults = { ...settings };

  res.json({ settings, defaults });
});

function isAdminRequest(req){
  // Primary check: explicit ADMIN_EMAIL env var
  try {
    if(req.session && req.session.user && process.env.ADMIN_EMAIL){
      return req.session.user.email === process.env.ADMIN_EMAIL;
    }
    // Fallback: allow users from allowed domain (not strict admin, but practical)
    if(req.session && req.session.user && process.env.ALLOWED_DOMAIN){
      const domain = req.session.user.email.split('@').pop();
      return domain === process.env.ALLOWED_DOMAIN;
    }
  } catch(e){
    return false;
  }
  return false;
}

// Update admin settings or restore defaults
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
      'DRIVE_EXPORT_MAX_CHARS','ENABLE_PDF_PARSE'
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
      ENABLE_PDF_PARSE: (process.env.ENABLE_PDF_PARSE || 'true') === 'true'
    } });

  } catch (err){
    logger.error('Failed to update settings', err);
    res.status(500).json({ error: 'Failed to update settings' });
  }
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
      case 'database':
        result = await testDatabase();
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

// AI-FIRST APPROACH: Claude API endpoint - Let AI handle ALL the intelligence
app.post('/api/claude/message', async (req, res) => {
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
      selectedModel: model || req.session.user.selectedModel || 'claude-3-sonnet-20241022',
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
      const selectedModel = model || req.session.user.selectedModel || 'claude-3-sonnet-20241022';
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
});

// ClickUp API proxy

// Helper to get current user's ClickUp token from DB/session
async function getUserClickUpToken(req) {
  if (!req.session.user) throw new Error('Not authenticated');
  return new Promise((resolve, reject) => {
    db.get('SELECT clickup_token FROM users WHERE email = ?', [req.session.user.email], (err, row) => {
      if (err) return reject(err);
      resolve(row?.clickup_token || req.session.user.clickupToken || null);
    });
  });
}

// Replace getUserGoogleToken to support refresh token flow
async function getUserGoogleToken(req) {
  if (!req.session.user) throw new Error('Not authenticated');
  // prefer session token if valid
  if (req.session.user.googleAccessToken) return req.session.user.googleAccessToken;

  // otherwise try to obtain a new access token using refresh token from DB
  return new Promise((resolve, reject) => {
    db.get('SELECT google_refresh_token FROM users WHERE email = ?', [req.session.user.email], async (err, row) => {
      if (err) return reject(err);
      const enc = row?.google_refresh_token;
      if (!enc) return resolve(null);
      const refreshToken = decryptToken(enc) || enc;
      if (!refreshToken) return resolve(null);

      try {
        const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, 'http://localhost:3000/callback/google');
        const r = await client.getToken({ refresh_token: refreshToken });
        const tokens = r.tokens;
        // save new access token to session
        req.session.user.googleAccessToken = tokens.access_token;
        // update refresh token if provided
        if (tokens.refresh_token) {
          const newEnc = encryptToken(tokens.refresh_token);
          db.run('UPDATE users SET google_refresh_token = ? WHERE email = ?', [newEnc, req.session.user.email], (e) => {
            if (e) logger.error('Failed to update refresh token', e);
          });
        }
        resolve(tokens.access_token);
      } catch (e) {
        logger.error('Failed to refresh Google token', e.message || e);
        // record error for auditing
        try {
          db.run('INSERT INTO token_refresh_errors (email, error) VALUES (?, ?)', [req.session.user.email, (e.message || JSON.stringify(e))]);
        } catch (ie) { logger.error('Failed to write token refresh error', ie); }
        // if refresh fails, clear stored token
        db.run('UPDATE users SET google_refresh_token = NULL WHERE email = ?', [req.session.user.email]);
        resolve(null);
      }
    });
  });
}

// List ClickUp spaces for the current user's team (cached)
app.get('/api/clickup/spaces', async (req, res) => {
  try {
    const token = await getUserClickUpToken(req);
    if (!token) return res.status(400).json({ error: 'ClickUp not connected' });

    // use teamId from session or try to derive
    const teamId = req.query.teamId || process.env.CLICKUP_TEAM_ID;
    if (!teamId) return res.status(400).json({ error: 'No teamId provided' });

    const cacheKey = `user:${req.session.user.email}:clickup:spaces:${teamId}`;
    const data = await getCachedOrFetch(cacheKey, 3600, async () => {
      const resp = await axios.get(`https://api.clickup.com/api/v2/team/${teamId}/space`, {
        headers: { 'Authorization': token }
      });
      return resp.data;
    });

    res.json(data);
  } catch (error) {
    logger.error('ClickUp spaces proxy error', error.message || error);
    res.status(500).json({ error: 'Failed to fetch ClickUp spaces' });
  }
});

// List folders in a space
app.get('/api/clickup/spaces/:spaceId/folders', async (req, res) => {
  try {
    const token = await getUserClickUpToken(req);
    if (!token) return res.status(400).json({ error: 'ClickUp not connected' });
    const { spaceId } = req.params;
    const cacheKey = `user:${req.session.user.email}:clickup:folders:${spaceId}`;
    const data = await getCachedOrFetch(cacheKey, 3600, async () => {
      const resp = await axios.get(`https://api.clickup.com/api/v2/space/${spaceId}/folder`, {
        headers: { 'Authorization': token }
      });
      return resp.data;
    });
    res.json(data);
  } catch (error) {
    logger.error('ClickUp folders proxy error', error.message || error);
    res.status(500).json({ error: 'Failed to fetch ClickUp folders' });
  }
});

// List lists in a folder
app.get('/api/clickup/folders/:folderId/lists', async (req, res) => {
  try {
    const token = await getUserClickUpToken(req);
    if (!token) return res.status(400).json({ error: 'ClickUp not connected' });
    const { folderId } = req.params;
    const cacheKey = `user:${req.session.user.email}:clickup:lists:${folderId}`;
    const data = await getCachedOrFetch(cacheKey, 3600, async () => {
      const resp = await axios.get(`https://api.clickup.com/api/v2/folder/${folderId}/list`, {
        headers: { 'Authorization': token }
      });
      return resp.data;
    });
    res.json(data);
  } catch (error) {
    logger.error('ClickUp lists proxy error', error.message || error);
    res.status(500).json({ error: 'Failed to fetch ClickUp lists' });
  }
});

// Task details (on-demand, cached)
app.get('/api/clickup/task/:taskId/details', async (req, res) => {
  try {
    const token = await getUserClickUpToken(req);
    if (!token) return res.status(400).json({ error: 'ClickUp not connected' });
    const { taskId } = req.params;
    const cacheKey = `user:${req.session.user.email}:clickup:task:${taskId}:details`;
    const data = await getCachedOrFetch(cacheKey, 600, async () => {
      const resp = await axios.get(`https://api.clickup.com/api/v2/task/${taskId}`, {
        headers: { 'Authorization': token }
      });
      return resp.data;
    });
    res.json(data);
  } catch (error) {
    logger.error('ClickUp task details proxy error', error.message || error);
    res.status(500).json({ error: 'Failed to fetch ClickUp task details' });
  }
});

// Task comments (on-demand, cached)
app.get('/api/clickup/task/:taskId/comments', async (req, res) => {
  try {
    const token = await getUserClickUpToken(req);
    if (!token) return res.status(400).json({ error: 'ClickUp not connected' });
    const { taskId } = req.params;
    const cacheKey = `user:${req.session.user.email}:clickup:task:${taskId}:comments`;
    const data = await getCachedOrFetch(cacheKey, 300, async () => {
      const resp = await axios.get(`https://api.clickup.com/api/v2/task/${taskId}/comment`, {
        headers: { 'Authorization': token }
      });
      return resp.data;
    });
    res.json(data);
  } catch (error) {
    logger.error('ClickUp task comments proxy error', error.message || error);
    res.status(500).json({ error: 'Failed to fetch ClickUp task comments' });
  }
});

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

// Serve static files
app.use(express.static('public'));

// Health check
app.get('/health', (req, res) => {
  (async () => {
    const dbTest = await testDatabase();
    const services = {
      claude: !!process.env.CLAUDE_API_KEY,
      google: !!process.env.GOOGLE_CLIENT_ID,
      clickup: !!process.env.CLICKUP_CLIENT_ID,
      database: !!dbTest.success
    };

    const errors = {};
    if (!dbTest.success) errors.database = dbTest.error;

    res.json({
      status: Object.values(services).every(Boolean) ? 'healthy' : 'degraded',
      services,
      errors,
      timestamp: new Date().toISOString()
    });
  })();
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