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
const archiver = require('archiver');
require('dotenv').config();

// Hard requirement: application must not run without LLM key
if(!process.env.CLAUDE_API_KEY){
  console.error('\n[FATAL] CLAUDE_API_KEY mancante. Configura la chiave prima di avviare il server.\n');
  process.exit(1);
}

// Import AI-First Engine (new structured path)
const AIFirstEngine = require('./src/engines/ai-first-engine');
// RAG generalized modules (MVP)
const { plan } = require('./src/rag/planner/planner');
const { executeGraph } = require('./src/rag/executor/executeGraph');
const { embedAndStoreLexiconTerms } = require('./src/rag/util/embeddings');
const { claudePing, claudeRequest } = require('./src/rag/ai/claudeClient');
const { ingestDriveContent } = require('./src/rag/util/ingestProcessor');
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

// Lightweight version endpoint (health tooling / debugging)
app.get('/version', (req, res) => {
  res.json({ version: APP_VERSION, timestamp: new Date().toISOString() });
});

// Connectivity: Claude AI ping (deep health)
app.get('/api/claude/ping', async (req, res) => {
  if(!process.env.CLAUDE_API_KEY){
    return res.status(400).json({ ok:false, error:'missing_key' });
  }
  try {
    const out = await claudePing(5000);
    return res.json({ ok:true, model: out.model });
  } catch(e){
    const msg = e?.code || e?.message || 'unknown_error';
    return res.status(503).json({ ok:false, error: msg });
  }
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

// Ingest (or re-ingest) a Drive file into rag_chunks computing real src_start/src_end offsets
app.post('/api/rag/ingest/drive/:fileId', async (req,res)=>{
  if(!req.session.user) return res.status(401).json({ error:'Not authenticated' });
  try {
    const token = await getUserGoogleToken(req);
    if(!token) return res.status(400).json({ error:'Google not connected' });
    const { fileId } = req.params;
    const { keep_old=false, include_preview=true } = req.body || {};
    // Fetch metadata for name
    let fileName = fileId;
    try {
      const metaResp = await axios.get(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
        headers: { Authorization: `Bearer ${token}` },
        params: { fields: 'name,size,mimeType' }
      });
      fileName = metaResp.data?.name || fileName;
    } catch(e){ logger.warning('Drive meta fetch failed', { fileId, error: e.message }); }
    const data = await fetchDriveFileContentWithCache(fileId, token);
    if(!data.contentText) return res.status(400).json({ error:'empty_or_unparsed', info: data.info||{} });
    if(!keep_old){
      db.run(`DELETE FROM rag_chunks WHERE source='drive' AND path=?`, [fileName], (delErr)=>{ if(delErr) logger.error('Failed to delete old chunks', delErr.message); });
    }
    const { inserted, chunks } = await ingestDriveContent(db, fileId, fileName, data.contentText);
    res.json({ file_id: fileId, file_name: fileName, inserted, total_chars: data.contentText.length, preview: include_preview? chunks.slice(0,5): undefined });
  } catch (e){
    logger.error('Drive ingestion failed', e.message||e);
    res.status(500).json({ error:'ingest_failed' });
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
    clickupApiKey: !!process.env.CLICKUP_API_KEY,
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
});

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
app.get('/api/claude/models', (req,res)=> res.json(AVAILABLE_MODELS));
app.get('/api/claude/models/status', (req,res)=>{
  if(!req.session.user) return res.status(401).json({ error:'Not authenticated' });
  const raw = req.session.user.selectedModel;
  const active = sanitizeModelId(raw);
  const exists = AVAILABLE_MODELS.some(m=>m.id===active);
  res.json({ active_model: active, exists, legacy_original: raw!==active? raw: null });
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
    ENABLE_PDF_PARSE: (process.env.ENABLE_PDF_PARSE || 'true') === 'true',
    CLICKUP_TEAM_ID: process.env.CLICKUP_TEAM_ID || ''
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
});
// Lightweight consolidated status (no side-effects) for header badges
app.get('/api/status/services', async (req,res)=>{
  const summary = { claude:false, database:false, clickup:false, drive:false };
  // Claude: just check key present
  summary.claude = !!process.env.CLAUDE_API_KEY;
  // DB: simple pragma query
  try { await new Promise((resolve,reject)=> db.get('SELECT 1 as ok', (e,row)=> e?reject(e):resolve(row))); summary.database=true; } catch{}
  // ClickUp: consider either session OAuth token or server API key + team id
  try {
    const hasSession = !!(req.session?.user?.clickupToken);
    const hasServer = !!process.env.CLICKUP_API_KEY && !!process.env.CLICKUP_TEAM_ID;
    summary.clickup = hasSession || hasServer;
  } catch{}
  // Drive: token in session
  try { summary.drive = !!(req.session?.user?.googleAccessToken); } catch{}
  res.json({ success:true, services: summary, timestamp: new Date().toISOString() });
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
});

// Generalized RAG endpoint (planner + executor) - experimental
app.post('/api/rag/chat', async (req, res) => {
  // Unified knowledge-first endpoint: retrieval + reasoning + conversational synthesis.
  if(!req.session.user) return res.status(401).json({ error:'Not authenticated' });
  const { message, include_chunk_texts=false } = req.body || {};
  if(!message) return res.status(400).json({ error:'message required' });
  const startTs = Date.now();
  const { parseIntent } = require('./src/rag/util/intentParser');
  const { synthesizeConversationalAnswer } = require('./src/rag/synthesis/synthesizer');
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
});

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

// Batch fetch chunk texts (for UI highlighting) ?ids=chunk1,chunk2
app.get('/api/rag/chunks', (req,res)=>{
  if(!req.session.user) return res.status(401).json({ error:'Not authenticated' });
  const idsParam = req.query.ids||'';
  if(!idsParam) return res.status(400).json({ error:'ids required' });
  const ids = idsParam.split(',').map(s=>s.trim()).filter(Boolean).slice(0,500);
  if(!ids.length) return res.status(400).json({ error:'no_valid_ids' });
  const placeholders = ids.map(()=>'?').join(',');
  db.all(`SELECT id,text,path,loc,src_start,src_end,source,type FROM rag_chunks WHERE id IN (${placeholders})`, ids, (err, rows)=>{
    if(err) return res.status(500).json({ error:'db_error' });
    res.json(rows||[]);
  });
});

// ----- RAG Feedback Endpoints -----
// Submit feedback for a run (rating 1-5, optional comment)
app.post('/api/rag/feedback', (req, res) => {
  if(!req.session.user) return res.status(401).json({ error:'Not authenticated' });
  const { run_id, rating, comment } = req.body||{};
  if(!run_id || typeof rating !== 'number') return res.status(400).json({ error:'run_id and numeric rating required' });
  db.run(`INSERT INTO rag_feedback (run_id, user_email, rating, comment) VALUES (?,?,?,?)`,
    [run_id, req.session.user.email, rating, comment||null], (err)=>{
      if(err) return res.status(500).json({ error:'db_error' });
      res.json({ success:true });
    });
});

// Aggregate feedback for a run
app.get('/api/rag/feedback/:runId', (req, res) => {
  if(!req.session.user) return res.status(401).json({ error:'Not authenticated' });
  const runId = req.params.runId;
  db.all(`SELECT rating, comment, created_at FROM rag_feedback WHERE run_id = ? ORDER BY created_at DESC LIMIT 50`, [runId], (err, rows)=>{
    if(err) return res.status(500).json({ error:'db_error' });
    if(!rows || !rows.length) return res.json({ run_id: runId, avg_rating: null, count:0, feedback: [] });
    const sum = rows.reduce((a,r)=>a + (r.rating||0),0);
    res.json({ run_id: runId, avg_rating: sum/rows.length, count: rows.length, feedback: rows });
  });
});

// Trigger embedding of pending lexicon terms (admin only)
app.post('/api/rag/lexicon/embed', async (req,res)=>{
  if(!isAdminRequest(req)) return res.status(403).json({ error:'Admin required' });
  try {
    const count = await embedAndStoreLexiconTerms(db);
    res.json({ success:true, embedded: count });
  } catch(e){
    res.status(500).json({ error:'embed_failed', message: e.message });
  }
});

// List lexicon terms (paged)
app.get('/api/rag/lexicon', (req,res)=>{
  if(!req.session.user) return res.status(401).json({ error:'Not authenticated' });
  const limit = Math.min(parseInt(req.query.limit||'100',10), 500);
  db.all('SELECT term,type,freq,sources,last_seen, (embedding IS NOT NULL) as embedded FROM rag_lexicon ORDER BY freq DESC LIMIT ?', [limit], (err, rows)=>{
    if(err) return res.status(500).json({ error:'db_error' });
    res.json(rows);
  });
});

// ---- Metrics & Quality Dashboard Data ----
app.get('/api/rag/metrics/overview', (req,res)=>{
  if(!isAdminRequest(req)) return res.status(403).json({ error:'Admin required' });
  // Aggregate in parallel style queries
  const out = {};
  db.get('SELECT COUNT(*) c FROM rag_runs', (e1,r1)=>{
    out.total_runs = r1?.c||0;
    db.get('SELECT COUNT(*) c FROM rag_feedback', (e2,r2)=>{
      out.total_feedback = r2?.c||0;
      db.get('SELECT AVG(rating) avg_rating FROM rag_feedback', (e3,r3)=>{
        out.avg_rating = Number(r3?.avg_rating||0).toFixed(2);
        db.get("SELECT AVG(latency_ms) avg_latency FROM rag_runs WHERE latency_ms>0", (e4,r4)=>{
          out.avg_latency_ms = Math.round(r4?.avg_latency||0);
          db.get("SELECT COUNT(*) c FROM rag_runs WHERE valid=0", (e5,r5)=>{
            out.invalid_runs = r5?.c||0;
            db.get("SELECT COUNT(*) c FROM rag_runs WHERE created_at >= datetime('now','-1 day')", (e6,r6)=>{
              out.runs_last_24h = r6?.c||0;
              res.json(out);
            });
          });
        });
      });
    });
  });
});

// Promote human labels (product/entity terms) into lexicon and embed
app.post('/api/rag/lexicon/promote', async (req,res)=>{
  if(!isAdminRequest(req)) return res.status(403).json({ error:'Admin required' });
  const { min_freq = 1 } = req.body||{};
  // Find candidate product entities from human labels OR annotated entities with human source
  const sql = `SELECT l.label_value term, COUNT(*) freq
               FROM rag_labels l
               WHERE l.label_type='entity' AND l.label_value NOT IN (SELECT term FROM rag_lexicon)
               GROUP BY l.label_value HAVING freq >= ? LIMIT 200`;
  db.all(sql, [min_freq], (err, rows)=>{
    if(err) return res.status(500).json({ error:'db_error' });
    if(!rows.length) return res.json({ promoted:0 });
    const stmt = db.prepare('INSERT INTO rag_lexicon (term,type,freq,sources) VALUES (?,?,?,?) ON CONFLICT(term) DO UPDATE SET freq=freq+excluded.freq');
    rows.forEach(r=>{ try { stmt.run(r.term.toLowerCase(), 'product', r.freq, 'human'); } catch(e){} });
    stmt.finalize(async ()=>{
      await embedAndStoreLexiconTerms(db);
      res.json({ promoted: rows.length });
    });
  });
});

// Estimate precision@k (k=5,10) using feedback as relevance proxy (rating>=4) and top retrieved artifacts
app.get('/api/rag/metrics/precision', (req,res)=>{
  if(!isAdminRequest(req)) return res.status(403).json({ error:'Admin required' });
  const kVals = [5,10];
  db.all(`SELECT r.id run_id, f.rating, a.payload retrieve_payload
          FROM rag_runs r
          JOIN rag_feedback f ON f.run_id = r.id
          JOIN rag_artifacts a ON a.run_id = r.id AND a.stage LIKE 'retrieve:%'
          ORDER BY f.created_at DESC LIMIT 100`, [], (err, rows)=>{
    if(err) return res.status(500).json({ error:'db_error' });
    if(!rows.length) return res.json({ precision:{} });
    const precision = { 5:0, 10:0 };
    const counts = { 5:0, 10:0 };
    rows.forEach(r=>{
      try {
        const arr = JSON.parse(r.retrieve_payload)||[];
        kVals.forEach(k=>{
          const slice = arr.slice(0,k);
          if(!slice.length) return;
          // Heuristic: treat doc relevant if top snippet had positive rating AND contains any support label patterns
          const rel = (r.rating>=4)? 1:0;
          precision[k] += rel * (slice.filter(s=> s.base_sim>0.2 || s.llm_rel>=3).length / k);
          counts[k] += 1;
        });
      } catch(e){}
    });
    const out = {};
    kVals.forEach(k=>{ out['p@'+k] = counts[k]? +(precision[k]/counts[k]).toFixed(3): null; });
    res.json({ precision: out, samples: rows.length });
  });
});

// --- Ground Truth CRUD (admin) ---
app.post('/api/rag/groundtruth', (req,res)=>{
  if(!isAdminRequest(req)) return res.status(403).json({ error:'Admin required' });
  const { query, chunk_id, relevant } = req.body||{};
  if(!query || !chunk_id || typeof relevant !== 'boolean') return res.status(400).json({ error:'missing_fields' });
  db.run('INSERT INTO rag_ground_truth (query,chunk_id,relevant) VALUES (?,?,?)', [query.trim(), chunk_id, relevant?1:0], function(err){
    if(err) return res.status(500).json({ error:'db_error' });
    res.json({ id:this.lastID, query, chunk_id, relevant });
  });
});

app.get('/api/rag/groundtruth', (req,res)=>{
  if(!isAdminRequest(req)) return res.status(403).json({ error:'Admin required' });
  const { query: q, limit } = req.query||{};
  const lim = Math.min(parseInt(limit||'200',10), 1000);
  if(q){
    db.all('SELECT * FROM rag_ground_truth WHERE query = ? ORDER BY created_at DESC LIMIT ?', [q, lim], (e, rows)=>{
      if(e) return res.status(500).json({ error:'db_error' });
      res.json(rows);
    });
  } else {
    db.all('SELECT * FROM rag_ground_truth ORDER BY created_at DESC LIMIT ?', [lim], (e, rows)=>{
      if(e) return res.status(500).json({ error:'db_error' });
      res.json(rows);
    });
  }
});

app.delete('/api/rag/groundtruth/:id', (req,res)=>{
  if(!isAdminRequest(req)) return res.status(403).json({ error:'Admin required' });
  db.run('DELETE FROM rag_ground_truth WHERE id=?', [req.params.id], function(err){
    if(err) return res.status(500).json({ error:'db_error' });
    res.json({ deleted: this.changes });
  });
});

// Ground truth based precision/recall evaluation
app.get('/api/rag/metrics/groundtruth', (req,res)=>{
  if(!isAdminRequest(req)) return res.status(403).json({ error:'Admin required' });
  const kParams = (req.query.k || '5,10').split(',').map(x=>parseInt(x.trim(),10)).filter(x=>x>0 && x<=100);
  const wantDetails = req.query.details==='1';
  db.all('SELECT query, chunk_id, relevant FROM rag_ground_truth', [], (e, rows)=>{
    if(e) return res.status(500).json({ error:'db_error' });
    if(!rows.length) return res.json({ queries:0, metrics:{} });
    // Group ground truth by query
    const byQuery = new Map();
    rows.forEach(r=>{
      if(!byQuery.has(r.query)) byQuery.set(r.query, []);
      byQuery.get(r.query).push(r);
    });
    const queries = Array.from(byQuery.keys());
    const metricsAgg = {}; kParams.forEach(k=> metricsAgg[k] = { sumP:0, sumR:0, count:0 });
    const details = [];
    // Helper to process sequentially
    const processNext = (idx)=>{
      if(idx>=queries.length){
        const out = {};
        kParams.forEach(k=>{
          out['p@'+k] = metricsAgg[k].count? +(metricsAgg[k].sumP/metricsAgg[k].count).toFixed(3): null;
          out['r@'+k] = metricsAgg[k].count? +(metricsAgg[k].sumR/metricsAgg[k].count).toFixed(3): null;
        });
        return res.json({ queries: queries.length, metrics: out, details: wantDetails? details: undefined });
      }
      const q = queries[idx];
      // latest run for this query
      db.get('SELECT id FROM rag_runs WHERE query = ? ORDER BY created_at DESC LIMIT 1', [q], (er, runRow)=>{
        if(er || !runRow){ processNext(idx+1); return; }
        db.get("SELECT payload FROM rag_artifacts WHERE run_id = ? AND stage LIKE 'retrieve:%' ORDER BY id ASC LIMIT 1", [runRow.id], (ea, artRow)=>{
          if(ea || !artRow){ processNext(idx+1); return; }
          let retrieved = [];
          try { retrieved = JSON.parse(artRow.payload)||[]; } catch(_){}
          const gt = byQuery.get(q);
          const relevantSet = new Set(gt.filter(g=>g.relevant).map(g=>g.chunk_id));
          const totalRelevant = relevantSet.size || 1; // avoid zero division for recall
          kParams.forEach(k=>{
            const topK = retrieved.slice(0,k).map(r=>r.id);
            const relRetrieved = topK.filter(id=>relevantSet.has(id)).length;
            const precision = relRetrieved / k;
            const recall = relRetrieved / totalRelevant;
            metricsAgg[k].sumP += precision; metricsAgg[k].sumR += recall; metricsAgg[k].count += 1;
            if(wantDetails){
              details.push({ query:q, k, precision:+precision.toFixed(3), recall:+recall.toFixed(3), relRetrieved, kSize:k, totalRelevant });
            }
          });
          processNext(idx+1);
        });
      });
    };
    processNext(0);
  });
});

// ---- Audit export (JSON bundle) ----
app.get('/api/rag/audit/:runId', (req,res)=>{
  if(!isAdminRequest(req)) return res.status(403).json({ error:'Admin required' });
  const runId = req.params.runId;
  const bundle = {};
  db.get('SELECT * FROM rag_runs WHERE id=?', [runId], (e1, runRow)=>{
    if(e1||!runRow) return res.status(404).json({ error:'run_not_found' });
    bundle.run = runRow;
    db.all('SELECT stage,payload,created_at FROM rag_artifacts WHERE run_id=? ORDER BY id', [runId], (e2, artRows)=>{
      bundle.artifacts = artRows||[];
      db.all('SELECT rating,comment,created_at FROM rag_feedback WHERE run_id=?', [runId], (e3, fbRows)=>{
        bundle.feedback = fbRows||[];
        // collect chunk ids from artifacts retrieve & reason for evidence snapshot
        const chunkIds = new Set();
        (bundle.artifacts||[]).forEach(a=>{
          if(a.stage.startsWith('retrieve:')){
            try { JSON.parse(a.payload).forEach(c=> c.id && chunkIds.add(c.id)); } catch(e){}
          }
          if(a.stage.startsWith('reason:')){
            try { const jr = JSON.parse(a.payload); (jr.support||[]).forEach(s=> s.id && chunkIds.add(s.id)); } catch(e){}
          }
        });
        const idArr = Array.from(chunkIds);
        if(!idArr.length) return res.json(bundle);
        const placeholders = idArr.map(()=>'?').join(',');
        db.all(`SELECT id,source,type,path,loc,src_start,src_end,text FROM rag_chunks WHERE id IN (${placeholders})`, idArr, (e4, rows)=>{
          bundle.evidence_chunks = rows||[];
          res.json(bundle);
        });
      });
    });
  });
});

// ZIP stream variant: produces a downloadable archive with structured JSON files
app.get('/api/rag/audit/:runId/zip', (req,res)=>{
  if(!isAdminRequest(req)) return res.status(403).json({ error:'Admin required' });
  const runId = req.params.runId;
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="audit_${runId}.zip"`);
  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', err=>{ logger.error('Audit zip error', err.message); try { res.status(500).end(); } catch(_){} });
  archive.pipe(res);
  // Gather data in nested callbacks then append
  db.get('SELECT * FROM rag_runs WHERE id=?', [runId], (e1, runRow)=>{
    if(e1 || !runRow){ archive.append(JSON.stringify({ error:'run_not_found' }), { name: 'error.json' }); return archive.finalize(); }
    archive.append(JSON.stringify(runRow,null,2), { name: 'run.json' });
    db.all('SELECT stage,payload,created_at FROM rag_artifacts WHERE run_id=? ORDER BY id', [runId], (e2, artRows)=>{
      archive.append(JSON.stringify(artRows||[],null,2), { name: 'artifacts.json' });
      db.all('SELECT rating,comment,created_at FROM rag_feedback WHERE run_id=?', [runId], (e3, fbRows)=>{
        archive.append(JSON.stringify(fbRows||[],null,2), { name:'feedback.json' });
        // derive chunk ids
        const chunkIds = new Set();
        (artRows||[]).forEach(a=>{
          if(a.stage.startsWith('retrieve:')){ try { JSON.parse(a.payload).forEach(c=> c.id && chunkIds.add(c.id)); } catch(_){} }
          if(a.stage.startsWith('reason:')){ try { const jr = JSON.parse(a.payload); (jr.support||[]).forEach(s=> s.id && chunkIds.add(s.id)); } catch(_){} }
        });
        const idArr = Array.from(chunkIds);
        if(!idArr.length){ archive.finalize(); return; }
        const placeholders = idArr.map(()=>'?').join(',');
        db.all(`SELECT id,source,type,path,loc,src_start,src_end,text FROM rag_chunks WHERE id IN (${placeholders})`, idArr, (e4, rows)=>{
          archive.append(JSON.stringify(rows||[],null,2), { name:'evidence_chunks.json' });
          // Quick index.html for humans
          const summaryHtml = `<!DOCTYPE html><html><body><h1>Audit ${runId}</h1><pre>${escapeHtml(JSON.stringify({ run: runRow, counts:{ artifacts: (artRows||[]).length, feedback:(fbRows||[]).length, evidence:(rows||[]).length } }, null,2))}</pre></body></html>`;
          archive.append(summaryHtml, { name:'index.html' });
          archive.finalize();
        });
      });
    });
  });
});

function escapeHtml(str){
  return str.replace(/[&<>"']/g, c=> ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
}

// ---- Adaptive Retrieval Weights ----
app.get('/api/rag/retrieval/weights', (req,res)=>{
  db.get('SELECT w_sim,w_bm25,w_llm,updated_at FROM rag_retrieval_weights WHERE id=1', (err,row)=>{
    if(err) return res.status(500).json({ error:'db_error' });
    res.json(row||{});
  });
});

// Recompute weights from recent feedback (simple heuristic)
app.post('/api/rag/retrieval/weights/recompute', (req,res)=>{
  if(!isAdminRequest(req)) return res.status(403).json({ error:'Admin required' });
  // heuristic: look at last 30 runs with feedback, average top chunk metrics saved in artifacts retrieve, weight scaled by rating
  const limit = 30;
  db.all(`SELECT r.id run_id, f.rating, a.payload retrieve_payload
          FROM rag_runs r
          JOIN rag_feedback f ON f.run_id = r.id
          JOIN rag_artifacts a ON a.run_id = r.id AND a.stage LIKE 'retrieve:%'
          ORDER BY f.created_at DESC LIMIT ?`, [limit], (err, rows)=>{
    if(err) return res.status(500).json({ error:'db_error' });
    if(!rows.length) return res.json({ updated:false, reason:'no_feedback' });
    let sumSim=0, sumBm=0, sumLlm=0, weightTotal=0;
    rows.forEach(r=>{
      try {
        const arr = JSON.parse(r.retrieve_payload)||[];
        if(!arr.length) return;
        const top = arr[0];
        const rating = r.rating||1;
        sumSim += (top.base_sim||0)*rating;
        sumBm  += (top.base_bm25||0)*rating;
        sumLlm += (top.llm_rel!=null? (top.llm_rel/5): 0)*rating;
        weightTotal += rating;
      } catch(e){}
    });
    if(weightTotal===0) return res.json({ updated:false, reason:'no_valid_data' });
    let wSim = sumSim/weightTotal; let wBm = sumBm/weightTotal; let wLlm = sumLlm/weightTotal;
    const norm = wSim + wBm + wLlm || 1;
    wSim/=norm; wBm/=norm; wLlm/=norm;
    db.run('UPDATE rag_retrieval_weights SET w_sim=?, w_bm25=?, w_llm=?, updated_at=CURRENT_TIMESTAMP WHERE id=1', [wSim, wBm, wLlm], (uErr)=>{
      if(uErr) return res.status(500).json({ error:'update_failed' });
      res.json({ updated:true, weights:{ w_sim:wSim, w_bm25:wBm, w_llm:wLlm } });
    });
  });
});

// ---- Active Learning: label management ----
app.post('/api/rag/labels', (req,res)=>{
  if(!req.session.user) return res.status(401).json({ error:'Not authenticated' });
  const { chunk_id, label_type, label_value } = req.body||{};
  if(!chunk_id || !label_type || !label_value) return res.status(400).json({ error:'missing_fields' });
  db.run('INSERT INTO rag_labels (chunk_id,label_type,label_value,source) VALUES (?,?,?,?)', [chunk_id, label_type, label_value, 'human'], (err)=>{
    if(err) return res.status(500).json({ error:'db_error' });
    res.json({ success:true });
  });
});

app.get('/api/rag/labels', (req,res)=>{
  if(!req.session.user) return res.status(401).json({ error:'Not authenticated' });
  const { chunk_id } = req.query;
  if(!chunk_id) return res.status(400).json({ error:'chunk_id required' });
  db.all('SELECT label_type,label_value,source,created_at FROM rag_labels WHERE chunk_id = ? ORDER BY created_at DESC', [chunk_id], (err, rows)=>{
    if(err) return res.status(500).json({ error:'db_error' });
    res.json(rows);
  });
});

// Uncertain chunks suggestion (simple: chunks with claim_statement but no prohibition/permission labels and no human labels)
app.get('/api/rag/active/uncertain', (req,res)=>{
  if(!req.session.user) return res.status(401).json({ error:'Not authenticated' });
  const limit = Math.min(parseInt(req.query.limit||'20',10), 100);
  db.all(`SELECT c.id,c.text FROM rag_chunks c
          LEFT JOIN rag_chunk_annotations a ON a.chunk_id=c.id AND a.annotator='claims_v1'
          LEFT JOIN rag_labels l ON l.chunk_id=c.id
          WHERE (a.data LIKE '%claim_statement%' AND (a.data NOT LIKE '%prohibition%' AND a.data NOT LIKE '%permission%'))
            AND l.id IS NULL
          LIMIT ?`, [limit], (err, rows)=>{
    if(err) return res.status(500).json({ error:'db_error' });
    res.json(rows);
  });
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
    // Planner and annotators readiness (simple key presence since they are LLM-only now)
    const planner_ok = services.claude; // same condition for now
    const annotators_ok = services.claude; // rely on CLAUDE_API_KEY presence

    const errors = {};
    if (!dbTest.success) errors.database = dbTest.error;

    res.json({
      status: Object.values(services).every(Boolean) ? 'healthy' : 'degraded',
      services,
      planner_ok,
      annotators_ok,
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
