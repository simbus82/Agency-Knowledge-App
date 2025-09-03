const express = require('express');

module.exports = function statusRouterFactory({ APP_VERSION, claudePing, testDatabase }){
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

  return router;
}

