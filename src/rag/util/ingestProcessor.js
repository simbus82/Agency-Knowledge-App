const crypto = require('crypto');

function sha1(str){
  return crypto.createHash('sha1').update(str).digest('hex');
}

function splitParagraphs(text){
  const parts = [];
  const rawParas = text.split(/\n{2,}/); // blank line delimiter
  rawParas.forEach((p, idx)=>{
    const trimmed = p.trim();
    if(!trimmed) return;
    // Further split if very long
    if(trimmed.length > 1400){
      let start=0; let segIdx=0;
      while(start < trimmed.length){
        parts.push({ text: trimmed.slice(start, start+1000), loc: `par ${idx+1}.${++segIdx}`, type:'doc_par' });
        start += 1000;
      }
    } else {
      parts.push({ text: trimmed, loc: `par ${idx+1}`, type:'doc_par' });
    }
  });
  return parts;
}

function splitSheetLike(text){
  const parts = [];
  const lines = text.split(/\n/);
  lines.forEach((line, i)=>{
    const trimmed = line.trim();
    if(!trimmed) return;
    if(/^Sheet:/i.test(trimmed)) return; // skip sheet header line
    parts.push({ text: trimmed, loc: `row ${i+1}`, type:'sheet_row' });
  });
  return parts;
}

function detectSheet(text){
  // crude heuristic: presence of multiple 'Sheet:' markers AND tab characters
  const sheetMarkers = (text.match(/\nSheet:/g)||[]).length;
  const tabs = text.includes('\t');
  return sheetMarkers >= 1 && tabs;
}

function buildChunksWithOffsets(originalText, parts, fileMeta){
  const out = [];
  let cursor = 0;
  for(const part of parts){
    const search = part.text.slice(0,40).replace(/[.*+?^${}()|[\]\\]/g,'');
    let idx = -1;
    if(search){
      const probe = search.split(/\s+/).filter(Boolean)[0];
      if(probe){
        const rel = originalText.indexOf(probe, cursor);
        if(rel !== -1) idx = rel;
      }
    }
    if(idx === -1) idx = cursor;
    const start = idx;
    const end = start + part.text.length;
    cursor = end;
    const baseId = `${fileMeta.fileId}:${start}:${end}`;
    out.push({
      id: sha1(baseId),
      text: part.text,
      source: 'drive',
      type: part.type,
      path: fileMeta.path,
      loc: part.loc,
      src_start: start,
      src_end: end
    });
  }
  return out;
}

async function persistChunks(db, chunks){
  if(!chunks.length) return 0;
  await new Promise(resolve=>{
    const stmt = db.prepare(`INSERT OR REPLACE INTO rag_chunks (id,text,source,type,path,loc,src_start,src_end,updated_at) VALUES (?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`);
    chunks.forEach(c=> stmt.run(c.id,c.text,c.source,c.type,c.path,c.loc,c.src_start,c.src_end));
    stmt.finalize(()=>resolve());
  });
  return chunks.length;
}

async function ingestDriveContent(db, fileId, fileName, contentText){
  if(!contentText) return { inserted:0, chunks:[] };
  const isSheet = detectSheet(contentText);
  const parts = isSheet ? splitSheetLike(contentText) : splitParagraphs(contentText);
  const chunks = buildChunksWithOffsets(contentText, parts, { fileId, path:fileName });
  await persistChunks(db, chunks);
  return { inserted: chunks.length, chunks };
}

module.exports = { ingestDriveContent };
