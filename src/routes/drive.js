const express = require('express');

module.exports = function driveRouterFactory({ axios, logger, getUserGoogleToken, fetchDriveFileContentWithCache }){
  const router = express.Router();

  // Export Google-native file content (cached + truncated)
  router.get('/api/drive/file/:fileId/content', async (req, res) => {
    try {
      const token = await getUserGoogleToken(req);
      if (!token) return res.status(400).json({ error: 'Google not connected' });
      const { fileId } = req.params;
      const data = await fetchDriveFileContentWithCache(fileId, token);
      if (data.contentText && data.contentText.length > 100000) {
        data.contentText = data.contentText.slice(0, 100000) + '\n...truncated...';
      }
      res.json(data);
    } catch (error) {
      logger.error('Drive file content export error', error.message || error);
      res.status(500).json({ error: 'Failed to export Drive file content' });
    }
  });

  // Generic Drive proxy
  router.get('/api/drive/*', async (req, res) => {
    if (!req.session.user || !req.session.user.googleAccessToken) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    try {
      const endpoint = req.params[0];
      const response = await axios.get(`https://www.googleapis.com/drive/v3/${endpoint}`, {
        headers: { 'Authorization': `Bearer ${req.session.user.googleAccessToken}` },
        params: req.query
      });
      res.json(response.data);
    } catch (error) {
      logger.error('Google Drive API error', error.response?.data || error);
      res.status(500).json({ error: 'Google Drive API error' });
    }
  });

  return router;
}

