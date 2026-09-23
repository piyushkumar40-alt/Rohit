// test/test_db.js
const { 
  batchInsertReturns, 
  processScan, 
  getMissingReturns, 
  getDashboardStats, 
  clearDatabase 
} = require('../src/db');

console.log('--- Starting Flipkart Returns DB Verification ---');

// Clear DB for test
clearDatabase('all');

// 1. Test Excel Upload Batch Insert & Deduplication
console.log('\n[1] Testing Batch Insert & Duplicate Ignore:');
const sampleReturns = [
  { tracking_id: 'FMPC0001', order_id: 'OD10001', sku: 'SHIRT-BLU-M', product_name: 'Blue Cotton Shirt', return_reason: 'Size not fit' },
  { tracking_id: 'FMPC0002', order_id: 'OD10002', sku: 'JEANS-BLK-32', product_name: 'Black Slim Jeans', return_reason: 'Defective item' },
  { tracking_id: 'FMPC0003', order_id: 'OD10003', sku: 'WATCH-GLD-01', product_name: 'Gold Analog Watch', return_reason: 'Customer cancelled' },
];

const res1 = batchInsertReturns(sampleReturns);
console.log('First Upload Result:', res1);
if (res1.inserted !== 3 || res1.ignored !== 0) throw new Error('Expected 3 inserted, 0 ignored');

// Re-upload same records + 1 new record
const mixedReturns = [
  { tracking_id: 'FMPC0001', order_id: 'OD10001' }, // duplicate -> should be ignored silently
  { tracking_id: 'FMPC0002', order_id: 'OD10002' }, // duplicate -> should be ignored silently
  { tracking_id: 'FMPC0004', order_id: 'OD10004', sku: 'SHOES-WHT-8', product_name: 'White Running Shoes' } // new!
];

const res2 = batchInsertReturns(mixedReturns);
console.log('Duplicate Upload Result:', res2);
if (res2.inserted !== 1 || res2.ignored !== 2) throw new Error('Expected 1 inserted, 2 ignored');

// 2. Test Scan Scenario 3: First-time scan + Found in DB1
console.log('\n[2] Testing Scenario 3: First-time scan + Found in DB1:');
const scan1 = processScan('FMPC0001');
console.log('Result:', scan1);
if (scan1.scenario !== 3 || !scan1.found_in_db1 || scan1.already_scanned) throw new Error('Failed Scenario 3');

// 3. Test Scan Scenario 1: Repeat scan + Found in DB1
console.log('\n[3] Testing Scenario 1: Repeat scan + Found in DB1:');
const scan2 = processScan('FMPC0001');
console.log('Result:', scan2);
if (scan2.scenario !== 1 || !scan2.found_in_db1 || !scan2.already_scanned) throw new Error('Failed Scenario 1');

// 4. Test Scan Scenario 4: First-time scan + NOT in DB1
console.log('\n[4] Testing Scenario 4: First-time scan + NOT in DB1:');
const scan3 = processScan('FMPC9999'); // Unknown tracking ID
console.log('Result:', scan3);
if (scan3.scenario !== 4 || scan3.found_in_db1 || scan3.already_scanned) throw new Error('Failed Scenario 4');

// 5. Test Scan Scenario 2: Repeat scan + NOT in DB1
console.log('\n[5] Testing Scenario 2: Repeat scan + NOT in DB1:');
const scan4 = processScan('FMPC9999');
console.log('Result:', scan4);
if (scan4.scenario !== 2 || scan4.found_in_db1 || !scan4.already_scanned) throw new Error('Failed Scenario 2');

// 6. Test Missing Returns Calculation (Expected in DB1: FMPC0001, FMPC0002, FMPC0003, FMPC0004)
// Scanned in DB2: FMPC0001, FMPC9999
// Missing from DB1: FMPC0002, FMPC0003, FMPC0004 (Total 3 missing)
console.log('\n[6] Testing Missing Returns calculation:');
const missing = getMissingReturns();
console.log('Missing items count:', missing.total);
console.log('Missing items:', missing.rows.map(r => r.tracking_id));
if (missing.total !== 3) throw new Error(`Expected 3 missing items, got ${missing.total}`);

const stats = getDashboardStats();
console.log('\nDashboard Stats:', stats);
if (stats.totalUploaded !== 4 || stats.totalScanned !== 2 || stats.matchedScans !== 1 || stats.missingCount !== 3) {
  throw new Error('Stats calculation mismatch');
}

console.log('\n>>> ALL 4 SCAN SCENARIOS & RECONCILIATION TESTS PASSED PERFECTLY! <<<');
