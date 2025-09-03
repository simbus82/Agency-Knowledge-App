#!/usr/bin/env node
// Simple smoke tests for backend endpoints (no auth required)
const axios = require('axios');

(async () => {
  const base = process.env.BASE_URL || 'http://localhost:3000';
  const out = { base };
  let ok = true;
  try {
    const v = await axios.get(`${base}/version`);
    out.version = v.data;
    console.log('[OK] /version', v.data);
  } catch (e) { ok=false; console.error('[FAIL] /version', e.message); }

  try {
    const h = await axios.get(`${base}/health`);
    out.health = h.data;
    console.log('[OK] /health', h.data.status);
  } catch (e) { ok=false; console.error('[FAIL] /health', e.message); }

  try {
    const p = await axios.get(`${base}/api/claude/ping`);
    out.ping = p.data;
    console.log('[OK] /api/claude/ping', p.data);
  } catch (e) {
    console.warn('[WARN] /api/claude/ping', e.response?.data || e.message);
  }

  try {
    const s = await axios.get(`${base}/api/status/services`);
    console.log('[OK] /api/status/services', s.data.services);
  } catch (e) {
    console.warn('[WARN] /api/status/services', e.response?.data || e.message);
  }

  process.exit(ok? 0: 1);
})();

