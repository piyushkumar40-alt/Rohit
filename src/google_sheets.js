// src/google_sheets.js
// Pure Node.js Google Sheets API v4 client & synchronization engine
// Uses built-in node:crypto & node:https (Zero external dependencies)

const crypto = require('node:crypto');
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');

const CONFIG_FILE = path.join(__dirname, '..', 'data', 'google_sheets_config.json');
const CREDENTIALS_DIR = path.join(__dirname, '..', 'credentials');
const DEFAULT_CREDS_PATH = path.join(CREDENTIALS_DIR, 'service-account.json');

const SHEET_NAMES = {
  RETURNS: 'Flipkart_Returns',
  SCANS: 'Scanned_Returns'
};

const HEADERS = {
  RETURNS: [
    'Tracking ID',
    'Order ID',
    'Order Item ID',
    'SKU',
    'Product Name',
    'Return Reason',
    'Return Type',
    'Return Date',
    'Customer Name',
    'Status',
    'Created At'
  ],
  SCANS: [
    'Scan ID',
    'Tracking ID',
    'Scanned At',
    'Match Status',
    'Order ID',
    'Product Name',
    'Scan Source',
    'Notes'
  ]
};

class GoogleSheetsService {
  constructor() {
    this.cachedToken = null;
    this.tokenExpiry = 0;
    this.ensureDirs();
  }

  ensureDirs() {
    if (!fs.existsSync(CREDENTIALS_DIR)) {
      try { fs.mkdirSync(CREDENTIALS_DIR, { recursive: true }); } catch (e) {}
    }
  }

  // Load configuration (Sheet ID, active credentials path, etc.)
  getConfig() {
    try {
      if (fs.existsSync(CONFIG_FILE)) {
        const data = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
        return {
          spreadsheetId: data.spreadsheetId || process.env.GOOGLE_SHEET_ID || '',
          credentialsPath: data.credentialsPath || DEFAULT_CREDS_PATH,
          appsScriptUrl: data.appsScriptUrl || '',
          autoSync: data.autoSync !== false,
          lastSyncAt: data.lastSyncAt || null,
          useAppsScript: Boolean(data.useAppsScript)
        };
      }
    } catch (e) {
      console.warn('Could not read google_sheets_config.json:', e.message);
    }
    return {
      spreadsheetId: process.env.GOOGLE_SHEET_ID || '',
      credentialsPath: DEFAULT_CREDS_PATH,
      appsScriptUrl: '',
      autoSync: true,
      lastSyncAt: null,
      useAppsScript: false
    };
  }

  // Save configuration
  saveConfig(newConfig) {
    const current = this.getConfig();
    const updated = { ...current, ...newConfig };
    const dir = path.dirname(CONFIG_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(updated, null, 2), 'utf8');
    return updated;
  }

  // Find service account JSON from file or env
  getServiceAccountCredentials() {
    // 1. Check environment variable for raw JSON
    if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
      try {
        return JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
      } catch (e) {
        console.warn('Failed parsing GOOGLE_SERVICE_ACCOUNT_JSON env var');
      }
    }

    // 2. Check path from config or GOOGLE_APPLICATION_CREDENTIALS
    const config = this.getConfig();
    const possiblePaths = [
      process.env.GOOGLE_APPLICATION_CREDENTIALS,
      config.credentialsPath,
      DEFAULT_CREDS_PATH,
      path.join(__dirname, '..', 'service-account.json')
    ].filter(Boolean);

    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        try {
          const content = fs.readFileSync(p, 'utf8');
          const parsed = JSON.parse(content);
          if (parsed.client_email && parsed.private_key) {
            return parsed;
          }
        } catch (e) {
          console.warn(`Failed reading credentials from ${p}:`, e.message);
        }
      }
    }

    return null;
  }

  // Generate OAuth2 access token using RS256 JWT
  async getAccessToken() {
    const now = Math.floor(Date.now() / 1000);
    // Reuse cached token if valid for > 5 minutes
    if (this.cachedToken && this.tokenExpiry > (now + 300)) {
      return this.cachedToken;
    }

    const creds = this.getServiceAccountCredentials();
    if (!creds) {
      throw new Error('Google Service Account credentials not found. Please provide service-account.json or set GOOGLE_APPLICATION_CREDENTIALS.');
    }

    const header = { alg: 'RS256', typ: 'JWT' };
    const claimSet = {
      iss: creds.client_email,
      scope: 'https://www.googleapis.com/auth/spreadsheets',
      aud: 'https://oauth2.googleapis.com/token',
      exp: now + 3600,
      iat: now
    };

    const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
    const encodedClaimSet = Buffer.from(JSON.stringify(claimSet)).toString('base64url');
    const signatureInput = `${encodedHeader}.${encodedClaimSet}`;

    const signer = crypto.createSign('RSA-SHA256');
    signer.update(signatureInput);
    const signature = signer.sign(creds.private_key, 'base64url');
    const assertionJwt = `${signatureInput}.${signature}`;

    const postData = `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${encodeURIComponent(assertionJwt)}`;

    const tokenRes = await this.httpsRequest({
      hostname: 'oauth2.googleapis.com',
      path: '/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, postData);

    const tokenJson = JSON.parse(tokenRes.body);
    if (!tokenJson.access_token) {
      throw new Error(`Token exchange failed: ${tokenJson.error_description || tokenRes.body}`);
    }

    this.cachedToken = tokenJson.access_token;
    this.tokenExpiry = now + (tokenJson.expires_in || 3600);
    return this.cachedToken;
  }

  // Generic HTTPS request helper
  httpsRequest(options, postBody = null) {
    return new Promise((resolve, reject) => {
      const req = https.request(options, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ statusCode: res.statusCode, body, headers: res.headers });
          } else {
            let errorMsg = body;
            try {
              const parsed = JSON.parse(body);
              if (parsed.error && parsed.error.message) errorMsg = parsed.error.message;
            } catch (e) {}
            const err = new Error(`Google API [${res.statusCode}] on ${options.method || 'GET'} ${options.path}: ${errorMsg}`);
            err.statusCode = res.statusCode;
            err.responseBody = body;
            reject(err);
          }
        });
      });

      req.on('error', reject);
      if (postBody) req.write(postBody);
      req.end();
    });
  }

  // Google Sheets API call with access token
  async sheetsApi(method, apiPath, body = null) {
    const accessToken = await this.getAccessToken();
    const options = {
      hostname: 'sheets.googleapis.com',
      path: `/v4/spreadsheets/${apiPath}`,
      method: method,
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json'
      }
    };

    let postData = null;
    if (body) {
      postData = typeof body === 'string' ? body : JSON.stringify(body);
      options.headers['Content-Type'] = 'application/json';
      options.headers['Content-Length'] = Buffer.byteLength(postData);
    }

    const res = await this.httpsRequest(options, postData);
    return JSON.parse(res.body);
  }

  // Test connection to spreadsheet
  async testConnection(customSpreadsheetId = null) {
    const config = this.getConfig();
    const spreadsheetId = (customSpreadsheetId || config.spreadsheetId || '').trim();

    if (!spreadsheetId) {
      return {
        connected: false,
        configured: false,
        message: 'No Google Spreadsheet ID configured.'
      };
    }

    // If using Google Apps Script Web App
    if (config.useAppsScript && config.appsScriptUrl) {
      return await this.testAppsScriptConnection(config.appsScriptUrl);
    }

    // Using Google Sheets API v4
    const creds = this.getServiceAccountCredentials();
    if (!creds) {
      return {
        connected: false,
        configured: false,
        hasSheetId: true,
        message: 'Spreadsheet ID is set, but service-account.json is missing.'
      };
    }

    try {
      const metadata = await this.sheetsApi('GET', `${spreadsheetId}?fields=properties.title,sheets.properties`);
      const sheetTitles = (metadata.sheets || []).map(s => s.properties.title);
      return {
        connected: true,
        configured: true,
        spreadsheetId,
        title: metadata.properties.title,
        sheetTitles,
        hasReturnsSheet: sheetTitles.includes(SHEET_NAMES.RETURNS),
        hasScansSheet: sheetTitles.includes(SHEET_NAMES.SCANS),
        clientEmail: creds.client_email,
        message: `Successfully connected to "${metadata.properties.title}" via Service Account (${creds.client_email}).`
      };
    } catch (err) {
      let advice = '';
      if (err.statusCode === 403 || err.statusCode === 404) {
        advice = ` Ensure the sheet is shared with Editor permission to your Service Account email: ${creds.client_email}`;
      }
      return {
        connected: false,
        configured: true,
        spreadsheetId,
        clientEmail: creds.client_email,
        message: `Connection error: ${err.message}.${advice}`
      };
    }
  }

  // Test Apps Script Web App connection
  async testAppsScriptConnection(url) {
    try {
      const pingUrl = new URL(url);
      pingUrl.searchParams.set('action', 'ping');
      const res = await new Promise((resolve, reject) => {
        https.get(pingUrl.toString(), (r) => {
          let data = '';
          r.on('data', c => data += c);
          r.on('end', () => resolve({ status: r.statusCode, data }));
        }).on('error', reject);
      });
      const parsed = JSON.parse(res.data);
      return {
        connected: true,
        configured: true,
        mode: 'apps_script',
        title: parsed.title || 'Google Sheet',
        message: `Connected to Google Sheet via Apps Script Web App: "${parsed.title || 'Active Sheet'}"`
      };
    } catch (e) {
      return {
        connected: false,
        configured: true,
        mode: 'apps_script',
        message: `Failed to connect via Apps Script: ${e.message}`
      };
    }
  }

  // Ensure 'Flipkart_Returns' and 'Scanned_Returns' sheets and headers exist
  async ensureSheets(spreadsheetId) {
    const metadata = await this.sheetsApi('GET', `${spreadsheetId}?fields=sheets.properties`);
    const existingTitles = (metadata.sheets || []).map(s => s.properties.title);

    const requests = [];
    if (!existingTitles.includes(SHEET_NAMES.RETURNS)) {
      requests.push({
        addSheet: {
          properties: {
            title: SHEET_NAMES.RETURNS,
            gridProperties: { rowCount: 1000, columnCount: 15, frozenRowCount: 1 }
          }
        }
      });
    }
    if (!existingTitles.includes(SHEET_NAMES.SCANS)) {
      requests.push({
        addSheet: {
          properties: {
            title: SHEET_NAMES.SCANS,
            gridProperties: { rowCount: 1000, columnCount: 10, frozenRowCount: 1 }
          }
        }
      });
    }

    if (requests.length > 0) {
      await this.sheetsApi('POST', `${spreadsheetId}:batchUpdate`, { requests });
    }

    // Write headers if empty
    await this.ensureHeaders(spreadsheetId, SHEET_NAMES.RETURNS, HEADERS.RETURNS);
    await this.ensureHeaders(spreadsheetId, SHEET_NAMES.SCANS, HEADERS.SCANS);
  }

  async ensureHeaders(spreadsheetId, sheetName, expectedHeaders) {
    const range = `${encodeURIComponent(sheetName)}!A1:${String.fromCharCode(64 + expectedHeaders.length)}1`;
    try {
      const existing = await this.sheetsApi('GET', `${spreadsheetId}/values/${range}`);
      if (!existing.values || existing.values.length === 0 || !existing.values[0] || existing.values[0].length === 0) {
        await this.sheetsApi('PUT', `${spreadsheetId}/values/${range}?valueInputOption=USER_ENTERED`, {
          values: [expectedHeaders]
        });
      }
    } catch (e) {
      console.warn(`Could not ensure headers for ${sheetName}:`, e.message);
    }
  }

  // Read all returns from Google Sheet
  async fetchAllReturns(spreadsheetId) {
    const range = `${encodeURIComponent(SHEET_NAMES.RETURNS)}!A2:K`;
    try {
      const res = await this.sheetsApi('GET', `${spreadsheetId}/values/${range}`);
      const rows = res.values || [];
      return rows.map(r => ({
        tracking_id: r[0] || '',
        order_id: r[1] || '',
        order_item_id: r[2] || '',
        sku: r[3] || '',
        product_name: r[4] || '',
        return_reason: r[5] || '',
        return_type: r[6] || '',
        return_date: r[7] || '',
        customer_name: r[8] || '',
        status: r[9] || 'Pending',
        created_at: r[10] || ''
      })).filter(r => Boolean(r.tracking_id));
    } catch (err) {
      if (err.statusCode === 400 || err.message.includes('Unable to parse range')) {
        return [];
      }
      throw err;
    }
  }

  // Read all scans from Google Sheet
  async fetchAllScans(spreadsheetId) {
    const range = `${encodeURIComponent(SHEET_NAMES.SCANS)}!A2:H`;
    try {
      const res = await this.sheetsApi('GET', `${spreadsheetId}/values/${range}`);
      const rows = res.values || [];
      return rows.map(r => ({
        id: r[0] ? (isNaN(r[0]) ? r[0] : parseInt(r[0], 10)) : Date.now(),
        tracking_id: r[1] || '',
        scanned_at: r[2] || '',
        matched_in_db1: (r[3] || '').toUpperCase() === 'MATCHED' ? 1 : 0,
        order_id: r[4] || '',
        product_name: r[5] || '',
        scan_source: r[6] || 'camera',
        notes: r[7] || ''
      })).filter(r => Boolean(r.tracking_id));
    } catch (err) {
      if (err.statusCode === 400 || err.message.includes('Unable to parse range')) {
        return [];
      }
      throw err;
    }
  }

  // Append new returns to Google Sheet (skipping existing tracking IDs)
  async appendReturns(spreadsheetId, records) {
    if (!records || records.length === 0) return { inserted: 0, skipped: 0 };
    await this.ensureSheets(spreadsheetId);

    const existingReturns = await this.fetchAllReturns(spreadsheetId);
    const existingIds = new Set(existingReturns.map(r => String(r.tracking_id).trim().toLowerCase()));

    const rowsToAppend = [];
    let skipped = 0;

    for (const r of records) {
      const tid = String(r.tracking_id || '').trim();
      if (!tid) {
        skipped++;
        continue;
      }
      if (existingIds.has(tid.toLowerCase())) {
        skipped++;
        continue;
      }
      existingIds.add(tid.toLowerCase());
      rowsToAppend.push([
        tid,
        r.order_id || '',
        r.order_item_id || '',
        r.sku || '',
        r.product_name || '',
        r.return_reason || '',
        r.return_type || '',
        r.return_date || '',
        r.customer_name || '',
        'Pending',
        r.created_at || new Date().toISOString().replace('T', ' ').slice(0, 19)
      ]);
    }

    if (rowsToAppend.length > 0) {
      const range = `${encodeURIComponent(SHEET_NAMES.RETURNS)}!A:K`;
      await this.sheetsApi(
        'POST',
        `${spreadsheetId}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
        { values: rowsToAppend }
      );
    }

    return { inserted: rowsToAppend.length, skipped };
  }

  // Record a scan into Google Sheet
  async recordScan(spreadsheetId, scanRecord) {
    await this.ensureSheets(spreadsheetId);

    const matchLabel = scanRecord.found_in_db1 || scanRecord.matched_in_db1 ? 'MATCHED' : 'UNMATCHED';
    const row = [
      scanRecord.id || Date.now(),
      scanRecord.tracking_id,
      scanRecord.scanned_at || new Date().toISOString().replace('T', ' ').slice(0, 19),
      matchLabel,
      scanRecord.order_id || (scanRecord.flipkart_data ? scanRecord.flipkart_data.order_id : ''),
      scanRecord.product_name || (scanRecord.flipkart_data ? scanRecord.flipkart_data.product_name : ''),
      scanRecord.scan_source || 'camera',
      scanRecord.notes || ''
    ];

    const range = `${encodeURIComponent(SHEET_NAMES.SCANS)}!A:H`;
    await this.sheetsApi(
      'POST',
      `${spreadsheetId}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
      { values: [row] }
    );

    return { success: true };
  }

  // Full bi-directional sync between local SQLite and Google Sheet
  async syncWithLocalDb(dbModule, customSpreadsheetId = null) {
    const config = this.getConfig();
    const spreadsheetId = (customSpreadsheetId || config.spreadsheetId || '').trim();

    if (!spreadsheetId) {
      throw new Error('Google Spreadsheet ID is not configured.');
    }

    await this.ensureSheets(spreadsheetId);

    // 1. Fetch remote data from Google Sheet
    const remoteReturns = await this.fetchAllReturns(spreadsheetId);
    const remoteScans = await this.fetchAllScans(spreadsheetId);

    // 2. Fetch local data from SQLite
    const localReturns = dbModule.getAllReturns({ limit: 100000 }).rows;
    const localScans = dbModule.getScannedReturns({ limit: 100000 }).rows;

    const localReturnIds = new Set(localReturns.map(r => String(r.tracking_id).toLowerCase()));
    const remoteReturnIds = new Set(remoteReturns.map(r => String(r.tracking_id).toLowerCase()));

    const localScanIds = new Set(localScans.map(s => String(s.tracking_id).toLowerCase()));
    const remoteScanIds = new Set(remoteScans.map(s => String(s.tracking_id).toLowerCase()));

    // 3. Local -> Remote Push (records in SQLite not in Google Sheet)
    const returnsToPush = localReturns.filter(r => !remoteReturnIds.has(String(r.tracking_id).toLowerCase()));
    if (returnsToPush.length > 0) {
      await this.appendReturns(spreadsheetId, returnsToPush);
    }

    const scansToPush = localScans.filter(s => !remoteScanIds.has(String(s.tracking_id).toLowerCase()));
    for (const scan of scansToPush) {
      await this.recordScan(spreadsheetId, scan);
    }

    // 4. Remote -> Local Pull (records in Google Sheet not in SQLite)
    const returnsToPull = remoteReturns.filter(r => !localReturnIds.has(String(r.tracking_id).toLowerCase()));
    let pulledReturnsCount = 0;
    if (returnsToPull.length > 0) {
      const stats = dbModule.batchInsertReturns(returnsToPull);
      pulledReturnsCount = stats.inserted;
    }

    const scansToPull = remoteScans.filter(s => !localScanIds.has(String(s.tracking_id).toLowerCase()));
    let pulledScansCount = 0;
    for (const scan of scansToPull) {
      try {
        dbModule.processScan(scan.tracking_id, scan.scan_source || 'google_sheet', scan.notes || '');
        pulledScansCount++;
      } catch (e) {}
    }

    const lastSyncAt = new Date().toISOString();
    this.saveConfig({ lastSyncAt });

    return {
      success: true,
      lastSyncAt,
      pushed: {
        returns: returnsToPush.length,
        scans: scansToPush.length
      },
      pulled: {
        returns: pulledReturnsCount,
        scans: pulledScansCount
      },
      totals: {
        localReturns: localReturns.length + pulledReturnsCount,
        localScans: localScans.length + pulledScansCount,
        remoteReturns: remoteReturns.length + returnsToPush.length,
        remoteScans: remoteScans.length + scansToPush.length
      }
    };
  }
}

module.exports = new GoogleSheetsService();
