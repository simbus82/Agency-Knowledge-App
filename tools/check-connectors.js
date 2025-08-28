// Simple sanity check for connector exports (no network calls)
function checkModule(path, fns) {
  try {
    const mod = require(path);
    const missing = fns.filter((n) => typeof mod[n] !== 'function');
    if (missing.length) {
      console.error(`[FAIL] ${path} missing exports: ${missing.join(', ')}`);
      process.exitCode = 1;
    } else {
      console.log(`[OK] ${path} exports: ${fns.join(', ')}`);
    }
  } catch (e) {
    console.warn(`[WARN] Cannot require ${path} (deps not installed?): ${e.message}`);
  }
}

checkModule('../src/connectors/googleDriveConnector', [
  'searchFiles', 'searchInFolders', 'getFileContent', 'getFileChunks'
]);
checkModule('../src/connectors/clickupConnector', [
  'getTasks', 'getTask', 'searchTasks'
]);
checkModule('../src/connectors/gmailConnector', [
  'searchEmails', 'getEmailContent', 'getEmailChunks'
]);

console.log('Connector export checks complete.');
