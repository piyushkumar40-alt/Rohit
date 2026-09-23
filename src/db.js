// src/db.js
// SQLite database layer using Node.js built-in DatabaseSync (node:sqlite)
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'flipkart_returns.db');
const db = new DatabaseSync(DB_PATH);

// Enable WAL mode and foreign keys for high performance and reliability
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA synchronous = NORMAL;');

// Initialize Tables
// 1. flipkart_returns (Database 1): Expected returns uploaded via Excel/CSV
db.exec(`
  CREATE TABLE IF NOT EXISTS flipkart_returns (
    tracking_id TEXT PRIMARY KEY,
    order_id TEXT,
    order_item_id TEXT,
    sku TEXT,
    product_name TEXT,
    return_reason TEXT,
    return_type TEXT,
    return_date TEXT,
    customer_name TEXT,
    raw_data TEXT,
    created_at TEXT DEFAULT (datetime('now', 'localtime'))
  );
`);

// 2. scanned_returns (Database 2): Actual physical scans recorded with timestamps
db.exec(`
  CREATE TABLE IF NOT EXISTS scanned_returns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tracking_id TEXT UNIQUE NOT NULL,
    scanned_at TEXT DEFAULT (datetime('now', 'localtime')),
    matched_in_db1 INTEGER DEFAULT 0,
    scan_source TEXT DEFAULT 'camera',
    notes TEXT
  );
`);

// Prepare reusable statements
const stmts = {
  findReturnByTrackingId: db.prepare('SELECT * FROM flipkart_returns WHERE tracking_id = ? COLLATE NOCASE'),
  findScanByTrackingId: db.prepare('SELECT * FROM scanned_returns WHERE tracking_id = ? COLLATE NOCASE'),
  insertReturnIgnore: db.prepare(`
    INSERT OR IGNORE INTO flipkart_returns (
      tracking_id, order_id, order_item_id, sku, product_name, 
      return_reason, return_type, return_date, customer_name, raw_data
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  insertScan: db.prepare(`
    INSERT INTO scanned_returns (tracking_id, matched_in_db1, scan_source, notes)
    VALUES (?, ?, ?, ?)
  `),
  countReturns: db.prepare('SELECT COUNT(*) as count FROM flipkart_returns'),
  countScans: db.prepare('SELECT COUNT(*) as count FROM scanned_returns'),
  countMatchedScans: db.prepare('SELECT COUNT(*) as count FROM scanned_returns WHERE matched_in_db1 = 1'),
  countUnmatchedScans: db.prepare('SELECT COUNT(*) as count FROM scanned_returns WHERE matched_in_db1 = 0'),
};

/**
 * Batch insert Flipkart return records into Database 1 (flipkart_returns)
 * If tracking ID already exists, ignore silently and append new records.
 * Returns statistics: { totalRows, inserted, ignored }
 */
function batchInsertReturns(records) {
  let inserted = 0;
  let ignored = 0;

  db.exec('BEGIN TRANSACTION;');
  try {
    for (const row of records) {
      if (!row.tracking_id || !String(row.tracking_id).trim()) {
        ignored++;
        continue;
      }

      const trackingId = String(row.tracking_id).trim();
      const orderId = row.order_id ? String(row.order_id).trim() : '';
      const orderItemId = row.order_item_id ? String(row.order_item_id).trim() : '';
      const sku = row.sku ? String(row.sku).trim() : '';
      const productName = row.product_name ? String(row.product_name).trim() : '';
      const returnReason = row.return_reason ? String(row.return_reason).trim() : '';
      const returnType = row.return_type ? String(row.return_type).trim() : '';
      const returnDate = row.return_date ? String(row.return_date).trim() : '';
      const customerName = row.customer_name ? String(row.customer_name).trim() : '';
      const rawData = row.raw_data ? JSON.stringify(row.raw_data) : '{}';

      const result = stmts.insertReturnIgnore.run(
        trackingId, orderId, orderItemId, sku, productName,
        returnReason, returnType, returnDate, customerName, rawData
      );

      if (result.changes > 0) {
        inserted++;
      } else {
        ignored++;
      }
    }
    db.exec('COMMIT;');
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }

  return {
    totalRows: records.length,
    inserted,
    ignored
  };
}

/**
 * Process a scanned tracking ID according to the user's exact 4 scenarios:
 * 
 * Check if tracking ID is in Database 2 (scanned_returns):
 * 
 * Scenario 1 (Repeat Scan + In DB1):
 *   Found in DB2 AND Found in DB1:
 *   -> "Already recorded on [date/time]" (with DB1 Flipkart record details).
 * 
 * Scenario 2 (Repeat Scan + NOT in DB1):
 *   Found in DB2 AND NOT found in DB1:
 *   -> "Already recorded on [date/time], but not found in 1st database".
 * 
 * Scenario 3 (New Scan + In DB1):
 *   NOT in DB2 AND Found in DB1:
 *   -> Save to DB2 with timestamp.
 *   -> "Tracking ID matched! Saved to scanned database on [date/time]" (with DB1 details).
 * 
 * Scenario 4 (New Scan + NOT in DB1):
 *   NOT in DB2 AND NOT found in DB1:
 *   -> Save to DB2 with timestamp.
 *   -> "Tracking ID not found in Flipkart database, but saved in 2nd database with timestamp".
 */
function processScan(rawTrackingId, scanSource = 'camera', notes = '') {
  if (!rawTrackingId || !String(rawTrackingId).trim()) {
    throw new Error('Tracking ID cannot be empty');
  }

  const trackingId = String(rawTrackingId).trim();

  // Check Database 2 (scanned_returns)
  const existingScan = stmts.findScanByTrackingId.get(trackingId);

  // Check Database 1 (flipkart_returns)
  const returnRecord = stmts.findReturnByTrackingId.get(trackingId);
  const foundInDb1 = !!returnRecord;

  if (existingScan) {
    // Has already been recorded in Database 2 previously
    const recordedAt = existingScan.scanned_at;
    
    if (foundInDb1) {
      // Scenario 1: Already in Returns AND Found in Flipkart Return Records
      return {
        scenario: 1,
        code: 'ALREADY_RECORDED_MATCHED',
        tracking_id: trackingId,
        already_scanned: true,
        found_in_db1: true,
        recorded_at: recordedAt,
        message: `Already recorded in Returns on ${recordedAt}`,
        flipkart_data: returnRecord,
        scan_id: existingScan.id
      };
    } else {
      // Scenario 2: Already in Returns AND NOT found in Flipkart Return Records
      return {
        scenario: 2,
        code: 'ALREADY_RECORDED_UNMATCHED',
        tracking_id: trackingId,
        already_scanned: true,
        found_in_db1: false,
        recorded_at: recordedAt,
        message: `Already recorded on ${recordedAt}, but not found in Flipkart Return Records`,
        flipkart_data: null,
        scan_id: existingScan.id
      };
    }
  }

  // Not in Returns yet -> First time scan!
  // Insert into Returns with timestamp
  const matchedInDb1 = foundInDb1 ? 1 : 0;
  const insertResult = stmts.insertScan.run(trackingId, matchedInDb1, scanSource, notes);
  
  // Re-fetch created scan to get accurate sqlite datetime
  const newScan = stmts.findScanByTrackingId.get(trackingId);
  const recordedAt = newScan ? newScan.scanned_at : new Date().toLocaleString();

  if (foundInDb1) {
    // Scenario 3: First time scan AND Found in Flipkart Return Records
    return {
      scenario: 3,
      code: 'NEW_SCAN_MATCHED',
      tracking_id: trackingId,
      already_scanned: false,
      found_in_db1: true,
      recorded_at: recordedAt,
      message: `Tracking ID matched! Saved to Returns on ${recordedAt}`,
      flipkart_data: returnRecord,
      scan_id: Number(insertResult.lastInsertRowid)
    };
  } else {
    // Scenario 4: First time scan AND NOT found in Flipkart Return Records
    return {
      scenario: 4,
      code: 'NEW_SCAN_UNMATCHED',
      tracking_id: trackingId,
      already_scanned: false,
      found_in_db1: false,
      recorded_at: recordedAt,
      message: `Tracking ID not found in Flipkart Return Records, but saved in Returns with timestamp ${recordedAt}`,
      flipkart_data: null,
      scan_id: Number(insertResult.lastInsertRowid)
    };
  }
}

/**
 * Get Missing Returns: Returns in Database 1 that have NOT yet been scanned in Database 2.
 * Supports search, filter, pagination, and sorting.
 */
function getMissingReturns({ search = '', limit = 50, offset = 0, sortBy = 'created_at', sortOrder = 'DESC' } = {}) {
  let whereClause = `
    WHERE f.tracking_id NOT IN (SELECT s.tracking_id FROM scanned_returns s)
  `;
  const params = [];

  if (search && search.trim()) {
    const term = `%${search.trim()}%`;
    whereClause += `
      AND (
        f.tracking_id LIKE ? OR 
        f.order_id LIKE ? OR 
        f.sku LIKE ? OR 
        f.product_name LIKE ? OR 
        f.customer_name LIKE ?
      )
    `;
    params.push(term, term, term, term, term);
  }

  // Count total matching
  const countSql = `SELECT COUNT(*) as total FROM flipkart_returns f ${whereClause}`;
  const totalCount = db.prepare(countSql).get(...params).total;

  // Safe sort column
  const allowedSorts = ['tracking_id', 'order_id', 'sku', 'product_name', 'return_date', 'created_at'];
  const validSort = allowedSorts.includes(sortBy) ? sortBy : 'created_at';
  const validOrder = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

  const dataSql = `
    SELECT f.*, 
      ROUND((julianday('now') - julianday(f.created_at))) as days_pending
    FROM flipkart_returns f
    ${whereClause}
    ORDER BY f.${validSort} ${validOrder}
    LIMIT ? OFFSET ?
  `;

  const rows = db.prepare(dataSql).all(...params, limit, offset);

  return {
    rows,
    total: totalCount,
    limit,
    offset
  };
}

/**
 * Get all Scanned Returns (Database 2) joined with Database 1 details
 */
function getScannedReturns({ search = '', matchedOnly = null, limit = 50, offset = 0 } = {}) {
  let whereClauses = [];
  const params = [];

  if (matchedOnly === true || matchedOnly === '1') {
    whereClauses.push('s.matched_in_db1 = 1');
  } else if (matchedOnly === false || matchedOnly === '0') {
    whereClauses.push('s.matched_in_db1 = 0');
  }

  if (search && search.trim()) {
    const term = `%${search.trim()}%`;
    whereClauses.push(`(
      s.tracking_id LIKE ? OR 
      f.order_id LIKE ? OR 
      f.sku LIKE ? OR 
      f.product_name LIKE ?
    )`);
    params.push(term, term, term, term);
  }

  const whereStr = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

  const countSql = `
    SELECT COUNT(*) as total 
    FROM scanned_returns s 
    LEFT JOIN flipkart_returns f ON s.tracking_id = f.tracking_id COLLATE NOCASE
    ${whereStr}
  `;
  const totalCount = db.prepare(countSql).get(...params).total;

  const dataSql = `
    SELECT 
      s.id,
      s.tracking_id,
      s.scanned_at,
      s.matched_in_db1,
      s.scan_source,
      s.notes,
      f.order_id,
      f.sku,
      f.product_name,
      f.return_reason,
      f.return_type,
      f.return_date,
      f.customer_name
    FROM scanned_returns s
    LEFT JOIN flipkart_returns f ON s.tracking_id = f.tracking_id COLLATE NOCASE
    ${whereStr}
    ORDER BY s.id DESC
    LIMIT ? OFFSET ?
  `;

  const rows = db.prepare(dataSql).all(...params, limit, offset);

  return {
    rows,
    total: totalCount,
    limit,
    offset
  };
}

/**
 * Get all uploaded Flipkart returns (Database 1) with scanned status flag
 */
function getAllReturns({ search = '', limit = 50, offset = 0 } = {}) {
  let whereClause = '';
  const params = [];

  if (search && search.trim()) {
    const term = `%${search.trim()}%`;
    whereClause = `
      WHERE (
        f.tracking_id LIKE ? OR 
        f.order_id LIKE ? OR 
        f.sku LIKE ? OR 
        f.product_name LIKE ?
      )
    `;
    params.push(term, term, term, term);
  }

  const countSql = `SELECT COUNT(*) as total FROM flipkart_returns f ${whereClause}`;
  const totalCount = db.prepare(countSql).get(...params).total;

  const dataSql = `
    SELECT 
      f.*,
      CASE WHEN s.tracking_id IS NOT NULL THEN 1 ELSE 0 END as is_scanned,
      s.scanned_at
    FROM flipkart_returns f
    LEFT JOIN scanned_returns s ON f.tracking_id = s.tracking_id COLLATE NOCASE
    ${whereClause}
    ORDER BY f.created_at DESC
    LIMIT ? OFFSET ?
  `;

  const rows = db.prepare(dataSql).all(...params, limit, offset);

  return {
    rows,
    total: totalCount,
    limit,
    offset
  };
}

/**
 * Get summary dashboard metrics
 */
function getDashboardStats() {
  const totalUploaded = stmts.countReturns.get().count;
  const totalScanned = stmts.countScans.get().count;
  const matchedScans = stmts.countMatchedScans.get().count;
  const unmatchedScans = stmts.countUnmatchedScans.get().count;
  
  // Pending missing returns = uploaded returns not yet in scans
  const missingCount = Math.max(0, totalUploaded - matchedScans);
  
  const returnReceivedRate = totalUploaded > 0 
    ? Math.round((matchedScans / totalUploaded) * 100) 
    : 0;

  return {
    totalUploaded,
    totalScanned,
    matchedScans,
    unmatchedScans,
    missingCount,
    returnReceivedRate
  };
}

/**
 * Export all missing returns as array of objects for Excel/CSV download
 */
function exportMissingReturns() {
  const sql = `
    SELECT 
      f.tracking_id AS "Tracking ID",
      f.order_id AS "Order ID",
      f.sku AS "SKU",
      f.product_name AS "Product Name",
      f.return_reason AS "Return Reason",
      f.return_type AS "Return Type",
      f.return_date AS "Return Date",
      f.customer_name AS "Customer Name",
      f.created_at AS "Uploaded At",
      ROUND((julianday('now') - julianday(f.created_at))) AS "Days Pending"
    FROM flipkart_returns f
    WHERE f.tracking_id NOT IN (SELECT s.tracking_id FROM scanned_returns s)
    ORDER BY f.created_at DESC
  `;
  return db.prepare(sql).all();
}

/**
 * Delete a single scanned record (if scanned accidentally)
 */
function deleteScan(scanId) {
  const stmt = db.prepare('DELETE FROM scanned_returns WHERE id = ?');
  const result = stmt.run(scanId);
  return result.changes > 0;
}

/**
 * Clear data helper (optional / testing)
 */
function clearDatabase(target = 'all') {
  if (target === 'scans' || target === 'all') {
    db.exec('DELETE FROM scanned_returns;');
  }
  if (target === 'returns' || target === 'all') {
    db.exec('DELETE FROM flipkart_returns;');
  }
  return true;
}

module.exports = {
  db,
  batchInsertReturns,
  processScan,
  getMissingReturns,
  getScannedReturns,
  getAllReturns,
  getDashboardStats,
  exportMissingReturns,
  deleteScan,
  clearDatabase
};
