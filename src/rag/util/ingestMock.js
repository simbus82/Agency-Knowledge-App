// Simple mock ingestion script to seed rag_chunks with a few rows.
const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');

const samples = [
  { text: 'Hypermix: non si può definire antiparassitario nelle comunicazioni marketing interne.', source:'drive', type:'sheet_row', path:'Linee guida prodotti', loc:'riga 12' },
  { text: 'Task ClickUp: Aggiornare scheda prodotto Hypermix con nuove limitazioni claim.', source:'clickup', type:'task', path:'TASK-123', loc:'title' },
  { text: 'Nota interna: si può menzionare supporto al benessere cutaneo ma non proprietà antiparassitarie.', source:'drive', type:'doc_par', path:'Vademecum Claims', loc:'par 4' }
];

function run(){
  const db = new sqlite3.Database('./data/knowledge_hub.db');
  db.serialize(()=>{
    samples.forEach(s => {
      const id = crypto.createHash('sha1').update(s.text + s.path + s.loc).digest('hex');
      db.run(`INSERT OR REPLACE INTO rag_chunks (id,text,source,type,path,loc,updated_at) VALUES (?,?,?,?,?,?,CURRENT_TIMESTAMP)`, [id,s.text,s.source,s.type,s.path,s.loc]);
    });
  });
  db.close(()=>console.log('Mock ingestion complete'));
}

if(require.main === module){ run(); }

module.exports = { run };
