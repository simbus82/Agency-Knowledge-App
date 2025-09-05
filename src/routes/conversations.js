const express = require('express');

module.exports = function conversationsRouterFactory({ db, logger }){
  const router = express.Router();

  // Get user conversations
  router.get('/api/conversations', (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Not authenticated' });
    db.all(
      `SELECT id, title, created_at, updated_at FROM conversations 
       WHERE user_email = ? ORDER BY updated_at DESC LIMIT 50`,
      [req.session.user.email],
      (err, rows) => {
        if (err) { logger.error('Database error', err); return res.status(500).json({ error: 'Database error' }); }
        res.json(rows);
      }
    );
  });

  // Save conversation
  router.post('/api/conversations', (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Not authenticated' });
    const { id, title, messages } = req.body || {};
    db.run(
      `INSERT OR REPLACE INTO conversations (id, user_email, title, messages, updated_at) 
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [id, req.session.user.email, title, JSON.stringify(messages||[])],
      (err) => {
        if (err) { logger.error('Database error', err); return res.status(500).json({ error: 'Database error' }); }
        res.json({ success: true });
      }
    );
  });

  // Get conversation details
  router.get('/api/conversations/:id', (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'Not authenticated' });
    db.get(
      `SELECT * FROM conversations WHERE id = ? AND user_email = ?`,
      [req.params.id, req.session.user.email],
      (err, row) => {
        if (err) { logger.error('Database error', err); return res.status(500).json({ error: 'Database error' }); }
        if (row) {
          try { row.messages = JSON.parse(row.messages||'[]'); } catch(_) { row.messages = []; }
        }
        res.json(row);
      }
    );
  });

  return router;
}

