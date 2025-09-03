const crypto = require('crypto');
const { OAuth2Client } = require('google-auth-library');

const ENC_ALGO = 'aes-256-gcm';
const ENC_KEY = process.env.TOKEN_ENC_KEY || null; // base64 32 bytes

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

async function getUserClickUpToken(db, req) {
  if (!req.session.user) throw new Error('Not authenticated');
  return new Promise((resolve, reject) => {
    db.get('SELECT clickup_token FROM users WHERE email = ?', [req.session.user.email], (err, row) => {
      if (err) return reject(err);
      resolve(row?.clickup_token || req.session.user.clickupToken || null);
    });
  });
}

async function getUserGoogleToken(db, req, logger=console) {
  if (!req.session.user) throw new Error('Not authenticated');
  if (req.session.user.googleAccessToken) return req.session.user.googleAccessToken;
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
        req.session.user.googleAccessToken = tokens.access_token;
        if (tokens.refresh_token) {
          const newEnc = encryptToken(tokens.refresh_token);
          db.run('UPDATE users SET google_refresh_token = ? WHERE email = ?', [newEnc, req.session.user.email], (e) => {
            if (e && logger?.error) logger.error('Failed to update refresh token', e);
          });
        }
        resolve(tokens.access_token);
      } catch (e) {
        if (logger?.error) logger.error('Failed to refresh Google token', e.message || e);
        try { db.run('UPDATE users SET google_refresh_token = NULL WHERE email = ?', [req.session.user.email]); } catch(_){}
        resolve(null);
      }
    });
  });
}

module.exports = { encryptToken, decryptToken, getUserClickUpToken, getUserGoogleToken };

