// Google Drive Connector - implementazione reale
const { google } = require('googleapis');
const stream = require('stream');

let driveClient;
function getDriveClient() {
    if (driveClient) return driveClient;
    if (!process.env.GOOGLE_CREDENTIALS_JSON) {
        console.error("Variabile d'ambiente GOOGLE_CREDENTIALS_JSON non impostata. Impossibile connettersi a Google Drive.");
        return null;
    }
    try {
        const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
        const auth = new google.auth.GoogleAuth({
            credentials,
            scopes: ['https://www.googleapis.com/auth/drive.readonly'],
        });
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
            fields: 'files(id, name, mimeType, webViewLink)',
            pageSize: 10,
        });
        return response.data.files || [];
    } catch (error) {
        console.error("Errore durante la ricerca di file su Google Drive:", error.message);
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

module.exports = {
    searchFiles,
    getFileContent,
};
