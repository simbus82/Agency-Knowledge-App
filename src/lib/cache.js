function getCachedOrFetch(db, table, key, ttlSeconds, fetchFn) {
  const tbl = table || 'clickup_cache';
  return new Promise((resolve, reject) => {
    db.get(`SELECT value, updated_at FROM ${tbl} WHERE key = ?`, [key], async (err, row) => {
      if (err) return reject(err);
      const now = Date.now();
      if (row && row.updated_at) {
        const updated = new Date(row.updated_at).getTime();
        if ((now - updated) < (ttlSeconds * 1000)) {
          try { return resolve(JSON.parse(row.value)); } catch (_) { /* fallthrough */ }
        }
      }
      try {
        const fresh = await fetchFn();
        const value = JSON.stringify(fresh);
        const updated_at = new Date().toISOString();
        db.run(`INSERT OR REPLACE INTO ${tbl} (key, value, updated_at) VALUES (?,?,?)`, [key, value, updated_at], ()=>{});
        return resolve(fresh);
      } catch (fetchErr) {
        if (row && row.value) {
          try { return resolve(JSON.parse(row.value)); } catch (_) {}
        }
        return reject(fetchErr);
      }
    });
  });
}

module.exports = { getCachedOrFetch };

