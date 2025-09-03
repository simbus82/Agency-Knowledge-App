function fetchDriveFileContentWithCacheFactory({ db, axios, logger=console }){
  return async function fetchDriveFileContentWithCache(fileId, accessToken){
    const key = `user:drive:file:${fileId}`;
    // inline cache using clickup_cache table for simplicity
    const cached = await new Promise((resolve)=>{
      db.get('SELECT value, updated_at FROM drive_cache WHERE key=?', [key], (err,row)=>{
        if(err||!row) return resolve(null);
        try { resolve(JSON.parse(row.value)); } catch(_) { resolve(null); }
      });
    });
    if(cached && cached.contentText){ return cached; }
    // Fetch with size limits
    let meta = {};
    try {
      const metaResp = await axios.get(`https://www.googleapis.com/drive/v3/files/${fileId}`, { headers: { Authorization: `Bearer ${accessToken}` }, params: { fields: 'mimeType, name, size' } });
      meta = metaResp.data || {};
    } catch(e){ if(logger?.warning) logger.warning('Drive meta fetch failed', e.message||e); }
    const MAX_BYTES = parseInt(process.env.DRIVE_MAX_BYTES || (10*1024*1024), 10);
    const name = meta.name || fileId;
    let contentText = null; let info={};
    try {
      if ((meta.mimeType||'').includes('google-apps')){
        const exp = await axios.get(`https://www.googleapis.com/drive/v3/files/${fileId}/export`, { headers: { Authorization: `Bearer ${accessToken}` }, params: { mimeType: 'text/plain' }, responseType: 'text' });
        contentText = exp.data || null;
      } else {
        const resp = await axios.get(`https://www.googleapis.com/drive/v3/files/${fileId}`, { headers: { Authorization: `Bearer ${accessToken}` }, params: { alt: 'media' }, responseType: 'arraybuffer' });
        const buf = Buffer.from(resp.data);
        if (buf.length > MAX_BYTES){ info = { truncated: true, size: buf.length }; }
        contentText = buf.toString('utf8');
      }
    } catch(e){ if(logger?.error) logger.error('Drive export error', e.message||e); contentText = null; }
    const out = { contentText, info, name };
    try { db.run('INSERT OR REPLACE INTO drive_cache (key,value,updated_at) VALUES (?,?,CURRENT_TIMESTAMP)', [key, JSON.stringify(out)]); } catch(_){}
    return out;
  };
}

module.exports = { fetchDriveFileContentWithCacheFactory };

