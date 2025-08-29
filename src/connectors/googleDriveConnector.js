// Google Drive Connector - implementazione reale (My Drive + Shared Drives)
const { google } = require('googleapis');
const stream = require('stream');
const crypto = require('crypto');
const axios = require('axios');

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
 * @param {{ query:string, accessToken?:string, driveId?:string, pageSize?:number }} params
 * @returns {Promise<Array>} - Un array di oggetti file.
 */
async function searchFiles({ query, accessToken, driveId, pageSize = 50 } = {}) {
    try {
        if (accessToken) {
            const resp = await axios.get('https://www.googleapis.com/drive/v3/files', {
                headers: { Authorization: `Bearer ${accessToken}` },
                params: {
                    q: query,
                    fields: 'files(id,name,mimeType,webViewLink,driveId,parents)',
                    pageSize,
                    includeItemsFromAllDrives: true,
                    supportsAllDrives: true,
                    corpora: driveId ? 'drive' : 'allDrives',
                    driveId
                }
            });
            return resp.data?.files || [];
        }
        const client = getDriveClient();
        if (!client) return [];
        const response = await client.files.list({
            q: query,
            fields: 'files(id, name, mimeType, webViewLink, driveId, parents)',
            pageSize,
            includeItemsFromAllDrives: true,
            supportsAllDrives: true,
            corpora: driveId ? 'drive' : 'allDrives',
            driveId
        });
        return response.data.files || [];
    } catch (error) {
        console.error("Errore durante la ricerca di file su Google Drive:", error.response?.data?.error?.message || error.message);
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

// --- Enhanced OAuth-compatible implementations (appended to override above) ---

/**
 * Cerca file in una o più cartelle (override): supporta accessToken OAuth.
 * @param {{ folderIds: string[], query?: string, driveId?: string, accessToken?:string }} params
 */
async function searchInFolders({ folderIds = [], query = '', driveId = undefined, accessToken } = {}){
    if (!Array.isArray(folderIds) || folderIds.length === 0) return [];
    const parentsQ = '(' + folderIds.map(id => `'${id}' in parents`).join(' or ') + ')';
    const safe = (s='') => (s || '').toString().replace(/'/g, "\\'");
    const nameQ = query ? ` and (name contains '${safe(query)}' or fullText contains '${safe(query)}')` : '';
    const q = `${parentsQ}${nameQ} and trashed = false`;
    try {
        if (accessToken) {
            const resp = await axios.get('https://www.googleapis.com/drive/v3/files', {
                headers: { Authorization: `Bearer ${accessToken}` },
                params: {
                    q,
                    fields: 'files(id,name,mimeType,webViewLink,driveId,parents)',
                    pageSize: 100,
                    includeItemsFromAllDrives: true,
                    supportsAllDrives: true,
                    corpora: driveId ? 'drive' : 'allDrives',
                    driveId
                }
            });
            return resp.data?.files || [];
        }
        // fallback to service client
        const client = getDriveClient();
        if (!client) return [];
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
        console.error('Errore durante la ricerca in cartelle Drive:', error.response?.data?.error?.message || error.message);
        return [];
    }
}

/**
 * Scarica contenuto file (override) – supporta accessToken OAuth.
 * @param {{ fileId:string, mimeType?:string, accessToken?:string }} params
 */
async function getFileContent({ fileId, mimeType, accessToken }) {
    try {
        if (accessToken) {
            if (mimeType && /google-apps/.test(mimeType)) {
                const resp = await axios.get(`https://www.googleapis.com/drive/v3/files/${fileId}/export`, {
                    headers: { Authorization: `Bearer ${accessToken}` },
                    params: { mimeType: 'text/plain' },
                    responseType: 'text'
                });
                return typeof resp.data === 'string' ? resp.data : JSON.stringify(resp.data);
            }
            const resp = await axios.get(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
                headers: { Authorization: `Bearer ${accessToken}` },
                params: { alt: 'media' },
                responseType: 'arraybuffer'
            });
            return Buffer.from(resp.data).toString('utf8');
        }
        // fallback to service client
        const client = getDriveClient();
        if (!client) return null;
        let response;
        if (mimeType && mimeType.includes('google-apps')) {
            response = await client.files.export({ fileId, mimeType: 'text/plain' }, { responseType: 'stream' });
        } else {
            response = await client.files.get({ fileId, alt: 'media' }, { responseType: 'stream' });
        }
        const reader = new stream.PassThrough();
        response.data.pipe(reader);
        let content = '';
        for await (const chunk of reader) { content += chunk.toString(); }
        return content;
    } catch (error) {
        console.error(`Errore durante il recupero del contenuto del file ${fileId}:`, error.response?.data?.error?.message || error.message);
        return null;
    }
}

/**
 * Chunking (override) – accetta accessToken e lo propaga a getFileContent
 */
async function getFileChunks({ fileId, mimeType, fileName, accessToken }){
    const content = await getFileContent({ fileId, mimeType, accessToken });
    if(!content) return [];
    return textToChunks(content, { fileId, fileName });
}

module.exports = {
    searchFiles,
    searchInFolders,
    getFileContent,
    getFileChunks,
};
