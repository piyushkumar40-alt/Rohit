// test/test_google_sheets.js
// Verification tests for Google Sheets API endpoints and module

const http = require('node:http');
const googleSheets = require('../src/google_sheets');

function request(path, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const postData = body ? JSON.stringify(body) : null;
    const req = http.request({
      hostname: 'localhost',
      port: 3000,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(postData ? { 'Content-Length': Buffer.byteLength(postData) } : {})
      }
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, raw: data });
        }
      });
    });
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function run() {
  console.log('--- Testing Google Sheets Backend Endpoints ---');

  // 1. Test Google Sheets module config
  const initialConfig = googleSheets.getConfig();
  console.log('[1] Initial Config:', {
    spreadsheetId: initialConfig.spreadsheetId,
    autoSync: initialConfig.autoSync,
    hasServiceAccount: Boolean(googleSheets.getServiceAccountCredentials())
  });

  // 2. Test saving and retrieving config
  const saved = googleSheets.saveConfig({ spreadsheetId: 'test-sheet-id-12345' });
  if (saved.spreadsheetId !== 'test-sheet-id-12345') {
    throw new Error('Failed to save spreadsheetId');
  }
  console.log('[2] Config save & read verified.');

  // 3. Test testConnection with unconfigured/mock ID
  const testResult = await googleSheets.testConnection('test-sheet-id-12345');
  console.log('[3] testConnection Result (Graceful offline/unauthenticated response):', {
    connected: testResult.connected,
    message: testResult.message
  });

  // Reset test sheet ID
  googleSheets.saveConfig({ spreadsheetId: initialConfig.spreadsheetId || '' });

  console.log('>>> GOOGLE SHEETS BACKEND TESTS COMPLETED SUCCESSFULLY! <<<');
}

run().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
