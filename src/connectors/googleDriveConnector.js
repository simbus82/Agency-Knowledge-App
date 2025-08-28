// Google Drive Connector - implementazione reale (My Drive + Shared Drives)
const { google } = require('googleapis');
const stream = require('stream');
const crypto = require('crypto');

let driveClient;
function getDriveClient() {
    if (driveClient) return driveClient;
    if (!process.env.GOOGLE_CREDENTIALS_JSON) {
        console.error("Variabile d'ambiente GOOGLE_CREDENTIALS_JSON non impostata. Impossibile connettersi a Google Drive.");
        return null;
    }
    try {
        const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
        let auth;
        if (credentials.type === 'service_account') {
            auth = new google.auth.JWT({
                email: credentials.client_email,
                key: credentials.private_key,
                scopes: ['https://www.googleapis.com/auth/drive.readonly'],
                subject: process.env.GOOGLE_IMPERSONATED_USER_EMAIL || undefined
            });
        } else {
            auth = new google.auth.GoogleAuth({
                credentials,
                scopes: ['https://www.googleapis.com/auth/drive.readonly'],
            });
        }
        driveClient = google.drive({ version: 'v3', auth });
        return driveClient;
    } catch (error) {
        console.error("Errore nel parsing delle credenziali Google JSON:", error);
        return null;
    }
}

/**
 * Cerca file in Google Drive.
 * @param {string} query - La query di ricerca (es. "name contains 'offerta'").
 * @returns {Promise<Array>} - Un array di oggetti file.
 */
async function searchFiles(query) {
    const client = getDriveClient();
    if (!client) return [];
    try {
        const response = await client.files.list({
            q: query,
            fields: 'files(id, name, mimeType, webViewLink, driveId, parents)',
            pageSize: 50,
            includeItemsFromAllDrives: true,
            supportsAllDrives: true,
            corpora: 'allDrives'
        });
        return response.data.files || [];
    } catch (error) {
        console.error("Errore durante la ricerca di file su Google Drive:", error.message);
        return [];
    }
}

/**
 * Cerca file in una o più cartelle (My Drive o Drive Condivisi).
 * @param {{ folderIds: string[], query?: string, driveId?: string }} params
 */
async function searchInFolders({ folderIds = [], query = '', driveId = undefined } = {}){
    const client = getDriveClient();
    if (!client) return [];
    if (!Array.isArray(folderIds) || folderIds.length === 0) return [];
    const parentsQ = '(' + folderIds.map(id => `'${id}' in parents`).join(' or ') + ')';
    const nameQ = query ? ` and (name contains '${query.replace(/'/g, "\'")}' or fullText contains '${query.replace(/'/g, "\'\"")}')` : '';
    const q = `${parentsQ}${nameQ} and trashed = false`;
    try {
        const response = await client.files.list({
            q,
            fields: 'files(id, name, mimeType, webViewLink, driveId, parents)',
            pageSize: 100,
            includeItemsFromAllDrives: true,
            supportsAllDrives: true,
            corpora: driveId ? 'drive' : 'allDrives',
            driveId
        });
        return response.data.files || [];
    } catch (error) {
        console.error('Errore durante la ricerca in cartelle Drive:', error.message);
        return [];
    }
}

/**
 * Estrae il contenuto testuale da un file in Google Drive.
 * @param {string} fileId - L'ID del file.
 * @param {string} mimeType - Il tipo MIME del file (opzionale).
 * @returns {Promise<string|null>} - Il contenuto del file come testo.
 */
async function getFileContent(fileId, mimeType) {
    const client = getDriveClient();
    if (!client) return null;
    try {
        let response;
        if (mimeType && mimeType.includes('google-apps')) {
            response = await client.files.export({
                fileId,
                mimeType: 'text/plain',
            }, { responseType: 'stream' });
        } else {
            response = await client.files.get({ fileId, alt: 'media' }, { responseType: 'stream' });
        }
        const reader = new stream.PassThrough();
        response.data.pipe(reader);
        let content = '';
        for await (const chunk of reader) {
            content += chunk.toString();
        }
        return content;
    } catch (error) {
        console.error(`Errore durante il recupero del contenuto del file ${fileId}:`, error.message);
        return null;
    }
}

// Helpers per creare "chunks" di testo utilizzabili dagli annotators
function textToChunks(text, meta={}){
    if(!text) return [];
    const parts = text.split(/\n{2,}/).map(s=>s.trim()).filter(Boolean);
    return parts.map((p, idx)=>({
        id: crypto.createHash('sha1').update((meta.fileId||'')+':'+idx+':'+p.slice(0,16)).digest('hex'),
        text: p.slice(0, 2000),
        source: 'drive',
        type: 'doc_par',
        path: meta.fileName || meta.fileId || 'drive:file',
        loc: `par ${idx+1}`
    }));
}

/**
 * Estrae il contenuto come array di chunks annotabili
 * @param {{ fileId: string, mimeType?: string, fileName?: string }} params
 */
async function getFileChunks({ fileId, mimeType, fileName }){
    const content = await getFileContent(fileId, mimeType);
    if(!content) return [];
    return textToChunks(content, { fileId, fileName });
}

module.exports = {
    searchFiles,
    searchInFolders,
    getFileContent,
    getFileChunks,
};
