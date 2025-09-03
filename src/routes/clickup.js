const express = require('express');

module.exports = function clickupRouterFactory({ axios, logger, getUserClickUpToken, getCachedOrFetch }){
  const router = express.Router();

  // List ClickUp spaces for the current user's team (cached)
  router.get('/api/clickup/spaces', async (req, res) => {
    try {
      const token = await getUserClickUpToken(req);
      if (!token) return res.status(400).json({ error: 'ClickUp not connected' });
      const teamId = req.query.teamId || process.env.CLICKUP_TEAM_ID;
      if (!teamId) return res.status(400).json({ error: 'No teamId provided' });
      const cacheKey = `user:${req.session.user.email}:clickup:spaces:${teamId}`;
      const data = await getCachedOrFetch(cacheKey, 3600, async () => {
        const resp = await axios.get(`https://api.clickup.com/api/v2/team/${teamId}/space`, { headers: { 'Authorization': token } });
        return resp.data;
      });
      res.json(data);
    } catch (error) {
      logger.error('ClickUp spaces proxy error', error.message || error);
      res.status(500).json({ error: 'Failed to fetch ClickUp spaces' });
    }
  });

  // List folders in a space
  router.get('/api/clickup/spaces/:spaceId/folders', async (req, res) => {
    try {
      const token = await getUserClickUpToken(req);
      if (!token) return res.status(400).json({ error: 'ClickUp not connected' });
      const { spaceId } = req.params;
      const cacheKey = `user:${req.session.user.email}:clickup:folders:${spaceId}`;
      const data = await getCachedOrFetch(cacheKey, 3600, async () => {
        const resp = await axios.get(`https://api.clickup.com/api/v2/space/${spaceId}/folder`, { headers: { 'Authorization': token } });
        return resp.data;
      });
      res.json(data);
    } catch (error) {
      logger.error('ClickUp folders proxy error', error.message || error);
      res.status(500).json({ error: 'Failed to fetch ClickUp folders' });
    }
  });

  // List lists in a folder
  router.get('/api/clickup/folders/:folderId/lists', async (req, res) => {
    try {
      const token = await getUserClickUpToken(req);
      if (!token) return res.status(400).json({ error: 'ClickUp not connected' });
      const { folderId } = req.params;
      const cacheKey = `user:${req.session.user.email}:clickup:lists:${folderId}`;
      const data = await getCachedOrFetch(cacheKey, 3600, async () => {
        const resp = await axios.get(`https://api.clickup.com/api/v2/folder/${folderId}/list`, { headers: { 'Authorization': token } });
        return resp.data;
      });
      res.json(data);
    } catch (error) {
      logger.error('ClickUp lists proxy error', error.message || error);
      res.status(500).json({ error: 'Failed to fetch ClickUp lists' });
    }
  });

  // Task details (on-demand, cached)
  router.get('/api/clickup/task/:taskId/details', async (req, res) => {
    try {
      const token = await getUserClickUpToken(req);
      if (!token) return res.status(400).json({ error: 'ClickUp not connected' });
      const { taskId } = req.params;
      const cacheKey = `user:${req.session.user.email}:clickup:task:${taskId}:details`;
      const data = await getCachedOrFetch(cacheKey, 600, async () => {
        const resp = await axios.get(`https://api.clickup.com/api/v2/task/${taskId}`, { headers: { 'Authorization': token } });
        return resp.data;
      });
      res.json(data);
    } catch (error) {
      logger.error('ClickUp task details proxy error', error.message || error);
      res.status(500).json({ error: 'Failed to fetch ClickUp task details' });
    }
  });

  // Task comments (on-demand, cached)
  router.get('/api/clickup/task/:taskId/comments', async (req, res) => {
    try {
      const token = await getUserClickUpToken(req);
      if (!token) return res.status(400).json({ error: 'ClickUp not connected' });
      const { taskId } = req.params;
      const cacheKey = `user:${req.session.user.email}:clickup:task:${taskId}:comments`;
      const data = await getCachedOrFetch(cacheKey, 300, async () => {
        const resp = await axios.get(`https://api.clickup.com/api/v2/task/${taskId}/comment`, { headers: { 'Authorization': token } });
        return resp.data;
      });
      res.json(data);
    } catch (error) {
      logger.error('ClickUp task comments proxy error', error.message || error);
      res.status(500).json({ error: 'Failed to fetch ClickUp task comments' });
    }
  });

  // Generic proxy (last)
  router.get('/api/clickup/*', async (req, res) => {
    if (!req.session.user || !req.session.user.clickupToken) {
      return res.status(401).json({ error: 'ClickUp not connected' });
    }
    try {
      const endpoint = req.params[0];
      const response = await axios.get(`https://api.clickup.com/api/v2/${endpoint}`, {
        headers: { 'Authorization': req.session.user.clickupToken },
        params: req.query
      });
      res.json(response.data);
    } catch (error) {
      logger.error('ClickUp API error', error.response?.data || error);
      res.status(500).json({ error: 'ClickUp API error' });
    }
  });

  return router;
}

