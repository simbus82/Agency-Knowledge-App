// Gmail Connector - sola lettura
// Richiede:
//  - GOOGLE_CREDENTIALS_JSON: JSON completo Service Account (Domain-wide delegation abilitata)
//  - GOOGLE_IMPERSONATED_USER_EMAIL: utente (mail) da impersonare
// NOTE: Il service account deve avere conferita la delega a livello di dominio per lo scope
//       https://www.googleapis.com/auth/gmail.readonly

const { google } = require('googleapis');

let gmailClient;

function getGmailClient(){
  if(gmailClient) return gmailClient;
  if(!process.env.GOOGLE_CREDENTIALS_JSON){
    console.error('GOOGLE_CREDENTIALS_JSON non impostata');
    return null;
  }
  if(!process.env.GOOGLE_IMPERSONATED_USER_EMAIL){
    console.error('GOOGLE_IMPERSONATED_USER_EMAIL non impostata');
    return null;
  }
  try {
    const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
    const auth = new google.auth.JWT({
      email: credentials.client_email,
      key: credentials.private_key,
      scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
      subject: process.env.GOOGLE_IMPERSONATED_USER_EMAIL
    });
    gmailClient = google.gmail({ version: 'v1', auth });
    return gmailClient;
  } catch(e){
    console.error('Errore creazione client Gmail:', e.message);
    return null;
  }
}

/**
 * Cerca email (solo ID) in Gmail.
 * @param {string} query es: "from:cliente@example.com subject:report"
 * @param {number} maxResults default 10
 * @returns {Promise<Array<{id:string,threadId:string}>>}
 */
async function searchEmails(query, maxResults=10){
  const client = getGmailClient();
  if(!client) return [];
  try {
    const resp = await client.users.messages.list({ userId:'me', q: query, maxResults });
    return resp.data.messages || [];
  } catch(e){
    console.error('Errore searchEmails:', e.message);
    return [];
  }
}

/**
 * Recupera corpo testuale e header di una email.
 * @param {string} messageId
 * @returns {Promise<{id:string,threadId:string,snippet:string,body:string,headers:Array}|null>}
 */
async function getEmailContent(messageId){
  const client = getGmailClient();
  if(!client) return null;
  try {
    const resp = await client.users.messages.get({ userId:'me', id: messageId, format:'full' });
    const { payload, snippet } = resp.data;

    function findText(part){
      if(!part) return null;
      if(part.mimeType === 'text/plain' && part.body && part.body.data) return part.body.data;
      if(part.parts){
        for(const p of part.parts){
          const found = findText(p);
          if(found) return found;
        }
      }
      return null;
    }

    const rawData = findText(payload);
    let body='';
    if(rawData){
      try { body = Buffer.from(rawData, 'base64').toString('utf-8'); } catch(_){}
    }

    return {
      id: resp.data.id,
      threadId: resp.data.threadId,
      snippet,
      body,
      headers: payload.headers || []
    };
  } catch(e){
    console.error('Errore getEmailContent:', e.message);
    return null;
  }
}

module.exports = { searchEmails, getEmailContent };
