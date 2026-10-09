/**
 * ==============================================================================
 * FLIPKART RETURNS TRACKER - GOOGLE APPS SCRIPT BACKEND
 * ==============================================================================
 * 
 * This Apps Script turns your Google Sheet into a powerful real-time cloud backend
 * for the Flipkart Returns Tracker web and mobile scanner app.
 *
 * --- QUICK SETUP INSTRUCTIONS (Takes ~2 minutes) ---
 * 1. Open your Google Sheet (or create a new blank Google Sheet at https://sheets.new).
 * 2. Click "Extensions" -> "Apps Script" in the top menu.
 * 3. Delete any code in the editor, and paste this entire file contents.
 * 4. Click the "Save" icon (Floppy disk).
 * 5. Run the "setupTrackerSheets" function once from the dropdown, then click "Review permissions" -> "Allow".
 * 6. Click the blue "Deploy" button (top right) -> "New deployment".
 * 7. Click the gear icon next to "Select type" -> Choose "Web app".
 * 8. Set:
 *    - Description: "Flipkart Returns Backend"
 *    - Execute as: "Me"
 *    - Who has access: "Anyone" (allows your mobile phone & GitHub Pages to sync)
 * 9. Click "Deploy", then copy the "Web app URL" (starts with https://script.google.com/macros/s/...).
 * 10. Paste this URL or your Spreadsheet ID into the app's Google Sheets settings!
 * ==============================================================================
 */

const SHEET_RETURNS = 'Flipkart_Returns';
const SHEET_SCANS = 'Scanned_Returns';

const HEADERS_RETURNS = [
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
];

const HEADERS_SCANS = [
  'Scan ID',
  'Tracking ID',
  'Scanned At',
  'Match Status',
  'Order ID',
  'Product Name',
  'Scan Source',
  'Notes'
];

/**
 * Creates custom Google Sheets menu on open
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('📦 Flipkart Returns Tracker')
    .addItem('⚙️ Setup / Reset Tracker Sheets', 'setupTrackerSheets')
    .addItem('🔄 Reconcile Returns Status', 'reconcileReturns')
    .addItem('📋 Highlight Missing Returns', 'highlightMissingReturns')
    .addToUi();
}

/**
 * Automatically creates and styles the required sheets and headers
 */
function setupTrackerSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // 1. Setup Returns Sheet
  let sReturns = ss.getSheetByName(SHEET_RETURNS);
  if (!sReturns) {
    sReturns = ss.insertSheet(SHEET_RETURNS, 0);
  }
  setupSheetHeaders(sReturns, HEADERS_RETURNS, '#1e293b', '#f8fafc');

  // 2. Setup Scans Sheet
  let sScans = ss.getSheetByName(SHEET_SCANS);
  if (!sScans) {
    sScans = ss.insertSheet(SHEET_SCANS, 1);
  }
  setupSheetHeaders(sScans, HEADERS_SCANS, '#0f766e', '#f0fdfa');

  SpreadsheetApp.flush();
  return { success: true, message: 'Sheets initialized successfully.' };
}

function setupSheetHeaders(sheet, headers, bgHex, textHex) {
  sheet.setFrozenRows(1);
  const currentHeaderRange = sheet.getRange(1, 1, 1, headers.length);
  currentHeaderRange.setValues([headers]);
  currentHeaderRange.setFontWeight('bold');
  currentHeaderRange.setBackground(bgHex);
  currentHeaderRange.setFontColor(textHex);
  currentHeaderRange.setHorizontalAlignment('center');

  // Auto-resize columns
  for (let c = 1; c <= headers.length; c++) {
    sheet.autoResizeColumn(c);
    const width = Math.max(120, sheet.getColumnWidth(c));
    sheet.setColumnWidth(c, width);
  }
}

/**
 * HTTP GET endpoint for read operations
 */
function doGet(e) {
  try {
    const params = e.parameter || {};
    const action = params.action || 'getData';

    if (action === 'ping') {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      return jsonResponse({
        status: 'ok',
        title: ss.getName(),
        spreadsheetId: ss.getId(),
        sheets: ss.getSheets().map(s => s.getName())
      });
    }

    if (action === 'getData') {
      setupTrackerSheets();
      const returns = getReturnsData();
      const scans = getScansData();
      return jsonResponse({
        success: true,
        returns,
        scans,
        timestamp: new Date().toISOString()
      });
    }

    return jsonResponse({ error: true, message: 'Unknown action: ' + action });
  } catch (err) {
    return jsonResponse({ error: true, message: err.toString() });
  }
}

/**
 * HTTP POST endpoint for write operations (scanning, uploading manifests)
 */
function doPost(e) {
  try {
    setupTrackerSheets();
    let body = {};
    if (e.postData && e.postData.contents) {
      body = JSON.parse(e.postData.contents);
    }
    const action = body.action || (e.parameter && e.parameter.action);

    if (action === 'recordScan') {
      return jsonResponse(handleRecordScan(body));
    }

    if (action === 'uploadReturns') {
      return jsonResponse(handleUploadReturns(body));
    }

    if (action === 'deleteScan') {
      return jsonResponse(handleDeleteScan(body));
    }

    if (action === 'sync') {
      // Full sync: import any new client items & return complete sheet data
      if (body.newReturns && body.newReturns.length > 0) {
        handleUploadReturns({ records: body.newReturns });
      }
      if (body.newScans && body.newScans.length > 0) {
        for (const s of body.newScans) {
          handleRecordScan(s);
        }
      }
      return jsonResponse({
        success: true,
        returns: getReturnsData(),
        scans: getScansData()
      });
    }

    return jsonResponse({ error: true, message: 'Invalid or missing action in POST payload.' });
  } catch (err) {
    return jsonResponse({ error: true, message: err.toString() });
  }
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Fetches all manifest returns from Flipkart_Returns tab
 */
function getReturnsData() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_RETURNS);
  if (!sheet) return [];

  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];

  const data = sheet.getRange(2, 1, lastRow - 1, HEADERS_RETURNS.length).getValues();
  return data.map(r => ({
    tracking_id: String(r[0] || '').trim(),
    order_id: String(r[1] || '').trim(),
    order_item_id: String(r[2] || '').trim(),
    sku: String(r[3] || '').trim(),
    product_name: String(r[4] || '').trim(),
    return_reason: String(r[5] || '').trim(),
    return_type: String(r[6] || '').trim(),
    return_date: String(r[7] || '').trim(),
    customer_name: String(r[8] || '').trim(),
    status: String(r[9] || 'Pending').trim(),
    created_at: String(r[10] || '').trim()
  })).filter(r => Boolean(r.tracking_id));
}

/**
 * Fetches all scan entries from Scanned_Returns tab
 */
function getScansData() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_SCANS);
  if (!sheet) return [];

  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];

  const data = sheet.getRange(2, 1, lastRow - 1, HEADERS_SCANS.length).getValues();
  return data.map(r => ({
    id: r[0],
    tracking_id: String(r[1] || '').trim(),
    scanned_at: String(r[2] || '').trim(),
    matched_in_db1: String(r[3] || '').toUpperCase() === 'MATCHED' ? 1 : 0,
    order_id: String(r[4] || '').trim(),
    product_name: String(r[5] || '').trim(),
    scan_source: String(r[6] || 'camera').trim(),
    notes: String(r[7] || '').trim()
  })).filter(r => Boolean(r.tracking_id));
}

/**
 * Handles recording a new physical barcode / QR scan
 */
function handleRecordScan(body) {
  const trackingId = String(body.tracking_id || '').trim();
  if (!trackingId) throw new Error('tracking_id is required');

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sScans = ss.getSheetByName(SHEET_SCANS);
  const sReturns = ss.getSheetByName(SHEET_RETURNS);

  const existingScans = getScansData();
  const existingReturns = getReturnsData();

  const prevScan = existingScans.find(s => s.tracking_id.toLowerCase() === trackingId.toLowerCase());
  const flipMatch = existingReturns.find(r => r.tracking_id.toLowerCase() === trackingId.toLowerCase());
  const isMatch = Boolean(flipMatch);

  if (prevScan) {
    return {
      success: true,
      already_scanned: true,
      found_in_db1: isMatch,
      code: isMatch ? 'ALREADY_RECORDED_MATCHED' : 'ALREADY_RECORDED_UNMATCHED',
      message: isMatch ? `Already recorded on ${prevScan.scanned_at}` : `Already recorded, but not in manifest`,
      flipkart_data: flipMatch || null,
      tracking_id: trackingId,
      scan_id: prevScan.id
    };
  }

  // New Scan Entry
  const scanId = body.id || Date.now();
  const scannedAt = body.scanned_at || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
  const matchStatus = isMatch ? 'MATCHED' : 'UNMATCHED';
  const orderId = flipMatch ? flipMatch.order_id : (body.order_id || '');
  const productName = flipMatch ? flipMatch.product_name : (body.product_name || '');
  const scanSource = body.scan_source || 'camera';
  const notes = body.notes || '';

  sScans.appendRow([
    scanId,
    trackingId,
    scannedAt,
    matchStatus,
    orderId,
    productName,
    scanSource,
    notes
  ]);

  // Update status in Flipkart_Returns if matched
  if (flipMatch) {
    updateReturnRowStatus(sReturns, trackingId, 'Received');
  }

  return {
    success: true,
    already_scanned: false,
    found_in_db1: isMatch,
    code: isMatch ? 'NEW_SCAN_MATCHED' : 'NEW_SCAN_UNMATCHED',
    message: isMatch ? `Tracking ID matched! Saved on ${scannedAt}` : `Saved as Unmatched on ${scannedAt}`,
    flipkart_data: flipMatch || null,
    tracking_id: trackingId,
    scan_id: scanId
  };
}

/**
 * Handles batch uploading returns manifest from Excel / CSV
 */
function handleUploadReturns(body) {
  const records = body.records || body;
  if (!Array.isArray(records) || records.length === 0) {
    return { inserted: 0, skipped: 0, total: 0 };
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sReturns = ss.getSheetByName(SHEET_RETURNS);

  const existingReturns = getReturnsData();
  const existingSet = new Set(existingReturns.map(r => r.tracking_id.toLowerCase()));

  const rowsToAppend = [];
  let inserted = 0;
  let skipped = 0;
  const nowStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');

  for (const r of records) {
    const tid = String(r.tracking_id || '').trim();
    if (!tid || existingSet.has(tid.toLowerCase())) {
      skipped++;
      continue;
    }
    existingSet.add(tid.toLowerCase());
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
      r.created_at || nowStr
    ]);
    inserted++;
  }

  if (rowsToAppend.length > 0) {
    const lastRow = sReturns.getLastRow();
    sReturns.getRange(lastRow + 1, 1, rowsToAppend.length, HEADERS_RETURNS.length).setValues(rowsToAppend);
  }

  return {
    success: true,
    total: records.length,
    inserted,
    skipped
  };
}

function updateReturnRowStatus(sReturns, trackingId, newStatus) {
  const lastRow = sReturns.getLastRow();
  if (lastRow <= 1) return;
  const colA = sReturns.getRange(2, 1, lastRow - 1, 1).getValues();
  for (let i = 0; i < colA.length; i++) {
    if (String(colA[i][0]).trim().toLowerCase() === trackingId.toLowerCase()) {
      sReturns.getRange(i + 2, 10).setValue(newStatus);
      break;
    }
  }
}

/**
 * Reconciles statuses in Flipkart_Returns based on Scanned_Returns
 */
function reconcileReturns() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sReturns = ss.getSheetByName(SHEET_RETURNS);
  const scans = getScansData();
  const scannedSet = new Set(scans.map(s => s.tracking_id.toLowerCase()));

  const lastRow = sReturns.getLastRow();
  if (lastRow <= 1) return;

  const returnIds = sReturns.getRange(2, 1, lastRow - 1, 1).getValues();
  const statusValues = [];

  for (let i = 0; i < returnIds.length; i++) {
    const tid = String(returnIds[i][0]).trim().toLowerCase();
    statusValues.push([scannedSet.has(tid) ? 'Received' : 'Pending']);
  }

  sReturns.getRange(2, 10, statusValues.length, 1).setValues(statusValues);
  SpreadsheetApp.getActiveSpreadsheet().toast('Returns reconciliation completed successfully!', 'Success', 5);
}
