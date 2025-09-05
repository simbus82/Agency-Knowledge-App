const express = require('express');
const fs = require('fs');

module.exports = function configRouterFactory(deps){
  const {
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
  } = deps;

  const router = express.Router();

  // Configuration status
  router.get('/api/config/status', (req, res) => {
    const requiredConfigs = [ 'CLAUDE_API_KEY', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET' ];
    const missingConfigs = [];
    const configStatus = {};
    requiredConfigs.forEach(key => {
      if (process.env[key]) configStatus[key] = true; else { configStatus[key] = false; missingConfigs.push(key); }
    });
    configStatus['CLICKUP_CLIENT_ID'] = !!process.env.CLICKUP_CLIENT_ID;
    configStatus['CLICKUP_CLIENT_SECRET'] = !!process.env.CLICKUP_CLIENT_SECRET;
    res.json({ configured: missingConfigs.length === 0, missingRequired: missingConfigs, status: configStatus });
  });

  // Overview for settings page (safe)
  router.get('/api/config/overview', (req, res) => {
    res.json({
      claude: !!process.env.CLAUDE_API_KEY,
      google: !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET,
      clickup: !!process.env.CLICKUP_CLIENT_ID && !!process.env.CLICKUP_CLIENT_SECRET,
      clickupApiKey: !!process.env.CLICKUP_API_KEY,
      allowedDomain: process.env.ALLOWED_DOMAIN || '56k.agency'
    });
  });

  // Save configuration (.env)
  router.post('/api/config/save', async (req, res) => {
    try {
      const { config } = req.body || {};
      const existingEnv = fs.existsSync('.env') ? fs.readFileSync('.env', 'utf-8') : '';
      const envConfig = require('dotenv').parse(existingEnv);
      const newConfig = { ...envConfig };

      if (config?.claude_api_key) {
        const claudeTest = await testClaudeAPI(config.claude_api_key);
        if (!claudeTest.success) return res.status(400).json({ error: 'Invalid Claude API key', details: claudeTest.error });
        newConfig.CLAUDE_API_KEY = config.claude_api_key;
      }
      if (config?.google_client_id) newConfig.GOOGLE_CLIENT_ID = config.google_client_id;
      if (config?.google_client_secret) newConfig.GOOGLE_CLIENT_SECRET = config.google_client_secret;
      if (config?.clickup_client_id) newConfig.CLICKUP_CLIENT_ID = config.clickup_client_id;
      if (config?.clickup_client_secret) newConfig.CLICKUP_CLIENT_SECRET = config.clickup_client_secret;
      if (config?.clickup_api_key) {
        try {
          const ok = await testClickUpToken(config.clickup_api_key);
          if (!ok.success) return res.status(400).json({ error: 'Invalid ClickUp API key', details: ok.error });
          newConfig.CLICKUP_API_KEY = config.clickup_api_key;
        } catch (e) {
          return res.status(400).json({ error: 'Invalid ClickUp API key', details: e.message });
        }
      }
      if (config?.allowed_domain) newConfig.ALLOWED_DOMAIN = config.allowed_domain;
      if (!newConfig.SESSION_SECRET) newConfig.SESSION_SECRET = generateSecret();
      if (!newConfig.FRONTEND_URL) newConfig.FRONTEND_URL = 'http://localhost:8080';

      Object.assign(process.env, newConfig);
      const envContent = Object.entries(newConfig).map(([k,v]) => `${k}=${v}`).join('\n');
      fs.writeFileSync('.env', envContent);
      logger.info('Configuration updated successfully');
      res.json({ success: true, message: 'Configuration updated successfully' });
    } catch (error) {
      logger.error('Failed to save configuration', error);
      res.status(500).json({ error: 'Failed to save configuration' });
    }
  });

  // Claude models
  router.get('/api/claude/models', (req,res)=> res.json(AVAILABLE_MODELS));
  router.get('/api/claude/models/status', (req,res)=>{
    if(!req.session.user) return res.status(401).json({ error:'Not authenticated' });
    const raw = req.session.user.selectedModel;
    const active = sanitizeModelId(raw);
    const exists = AVAILABLE_MODELS.some(m=>m.id===active);
    res.json({ active_model: active, exists, legacy_original: raw!==active? raw: null });
  });

  // Settings
  router.get('/api/config/settings', (req, res) => {
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

  router.put('/api/config/settings', (req, res) => {
    if(!isAdminRequest(req)) return res.status(403).json({ error: 'Admin required' });
    const { settings, restoreDefaults } = req.body || {};
    try {
      const envPath = '.env';
      const existingEnv = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
      const envConfig = require('dotenv').parse(existingEnv || '');
      const editableKeys = ['FRONTEND_URL','ALLOWED_DOMAIN','DRIVE_MAX_BYTES','DRIVE_CACHE_TTL','CLICKUP_CACHE_TTL','MAX_DRIVE_FILES_TO_FETCH','MAX_CLICKUP_TASKS_ENRICH','DRIVE_EXPORT_MAX_CHARS','ENABLE_PDF_PARSE','CLICKUP_TEAM_ID'];
      const newConfig = { ...envConfig };
      if(restoreDefaults){ editableKeys.forEach(k => delete newConfig[k]); }
      if(settings && typeof settings === 'object'){
        editableKeys.forEach(k => { if(Object.prototype.hasOwnProperty.call(settings,k)) newConfig[k] = String(settings[k]); });
      }
      if(!newConfig.SESSION_SECRET) newConfig.SESSION_SECRET = generateSecret();
      const envContent = Object.entries(newConfig).map(([key,val]) => `${key}=${val}`).join('\n');
      fs.writeFileSync(envPath, envContent);
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

  // Connection tests
  router.post('/api/test/connection', async (req, res) => {
    const { service, credentials } = req.body || {};
    try {
      let result;
      switch(service) {
        case 'claude': result = await testClaudeAPI(credentials.apiKey); break;
        case 'database': result = await testDatabase(); break;
        case 'clickup': result = await testClickUpAPI(credentials.clientId, credentials.clientSecret); break;
        case 'clickup_token': result = await testClickUpToken(credentials.apiKey); break;
        case 'google': result = { success: true }; break; // OAuth handled elsewhere
        default: result = { success: false, error: 'Unknown service' };
      }
      res.json(result);
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  return router;
}

