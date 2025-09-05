const express = require('express');

module.exports = function statusRouterFactory({ APP_VERSION, claudePing, testDatabase, db }){
  const router = express.Router();

  // Version
  router.get('/version', (req, res) => {
    res.json({ version: APP_VERSION, timestamp: new Date().toISOString() });
  });

  // Claude connectivity
  router.get('/api/claude/ping', async (req, res) => {
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

  // Health
  router.get('/health', (req, res) => {
    (async () => {
      const dbTest = await testDatabase();
      const services = {
        claude: !!process.env.CLAUDE_API_KEY,
        google: !!process.env.GOOGLE_CLIENT_ID,
        clickup: !!process.env.CLICKUP_CLIENT_ID,
        database: !!dbTest.success
      };
      const planner_ok = services.claude;
      const annotators_ok = services.claude;
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

  // Lightweight consolidated status (no side-effects) for header badges
  router.get('/api/status/services', async (req, res) => {
    const summary = { claude: false, database: false, clickup: false, drive: false };
    // Claude: just check key present
    summary.claude = !!process.env.CLAUDE_API_KEY;
    // Database: prefer a read-only ping if db provided, else fallback to testDatabase
    try {
      if (db && typeof db.get === 'function') {
        await new Promise((resolve, reject) => db.get('SELECT 1 as ok', (e) => (e ? reject(e) : resolve())));
        summary.database = true;
      } else {
        const t = await testDatabase();
        summary.database = !!t.success;
      }
    } catch (_) {}
    // ClickUp: session OAuth token or server API key + team id
    try {
      const hasSession = !!(req.session?.user?.clickupToken);
      const hasServer = !!process.env.CLICKUP_API_KEY && !!process.env.CLICKUP_TEAM_ID;
      summary.clickup = hasSession || hasServer;
    } catch (_) {}
    // Drive: token in session
    try { summary.drive = !!(req.session?.user?.googleAccessToken); } catch (_) {}
    res.json({ success: true, services: summary, timestamp: new Date().toISOString() });
  });

  return router;
}
