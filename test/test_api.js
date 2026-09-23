// test/test_api.js
const http = require('node:http');
const server = require('../src/server');

const BASE_URL = 'http://127.0.0.1:3000';

function request(method, path, data = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {}
    };

    let postData = null;
    if (data) {
      postData = JSON.stringify(data);
      options.headers['Content-Type'] = 'application/json';
      options.headers['Content-Length'] = Buffer.byteLength(postData);
    }

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(body); } catch (e) {}
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body,
          json
        });
      });
    });

    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function runTests() {
  console.log('--- Running Flipkart Returns API Integration Tests ---\n');

  try {
    // 1. Clear database
    console.log('[1] Clearing DB for clean integration test...');
    const clearRes = await request('POST', '/api/clear', { target: 'all' });
    console.log('Clear response:', clearRes.json);

    // 2. Test GET /
    console.log('\n[2] Testing GET / (Static HTML Serving)...');
    const homeRes = await request('GET', '/');
    if (homeRes.statusCode !== 200 || !homeRes.body.includes('Flipkart')) {
      throw new Error('Home page test failed');
    }
    console.log('Status: 200 OK, HTML loaded successfully.');

    // 3. Test POST /api/upload-returns (Batch Insert + Deduplication)
    console.log('\n[3] Testing POST /api/upload-returns...');
    const uploadPayload = [
      { tracking_id: 'TRK_A1', order_id: 'OD_01', sku: 'SKU_1', product_name: 'Wireless Mouse' },
      { tracking_id: 'TRK_B2', order_id: 'OD_02', sku: 'SKU_2', product_name: 'Keyboard RGB' },
      { tracking_id: 'TRK_C3', order_id: 'OD_03', sku: 'SKU_3', product_name: 'USB-C Cable' }
    ];
    const upRes1 = await request('POST', '/api/upload-returns', uploadPayload);
    console.log('First upload:', upRes1.json.stats);
    if (upRes1.json.stats.inserted !== 3 || upRes1.json.stats.ignored !== 0) {
      throw new Error('Expected 3 inserted, 0 ignored on first upload');
    }

    // Re-upload with 1 duplicate and 1 new record
    const mixedPayload = [
      { tracking_id: 'TRK_A1', order_id: 'OD_01' }, // duplicate -> ignore silently
      { tracking_id: 'TRK_D4', order_id: 'OD_04', sku: 'SKU_4', product_name: 'Gaming Headset' } // new
    ];
    const upRes2 = await request('POST', '/api/upload-returns', mixedPayload);
    console.log('Duplicate upload check:', upRes2.json.stats);
    if (upRes2.json.stats.inserted !== 1 || upRes2.json.stats.ignored !== 1) {
      throw new Error('Deduplication failed: expected 1 inserted, 1 ignored');
    }

    // 4. Test Scenario 3: First Scan + In DB1
    console.log('\n[4] Testing Scenario 3: First-time scan + Found in DB1 (TRK_A1)...');
    const scanRes1 = await request('POST', '/api/scan', { tracking_id: 'TRK_A1' });
    console.log('Result:', scanRes1.json.message);
    if (scanRes1.json.scenario !== 3 || !scanRes1.json.found_in_db1 || scanRes1.json.already_scanned) {
      throw new Error('Failed Scenario 3');
    }

    // 5. Test Scenario 1: Repeat Scan + In DB1
    console.log('\n[5] Testing Scenario 1: Repeat scan + Found in DB1 (TRK_A1)...');
    const scanRes2 = await request('POST', '/api/scan', { tracking_id: 'TRK_A1' });
    console.log('Result:', scanRes2.json.message);
    if (scanRes2.json.scenario !== 1 || !scanRes2.json.found_in_db1 || !scanRes2.json.already_scanned) {
      throw new Error('Failed Scenario 1');
    }

    // 6. Test Scenario 4: First Scan + NOT in DB1
    console.log('\n[6] Testing Scenario 4: First-time scan + NOT in DB1 (TRK_UNKNOWN)...');
    const scanRes3 = await request('POST', '/api/scan', { tracking_id: 'TRK_UNKNOWN' });
    console.log('Result:', scanRes3.json.message);
    if (scanRes3.json.scenario !== 4 || scanRes3.json.found_in_db1 || scanRes3.json.already_scanned) {
      throw new Error('Failed Scenario 4');
    }

    // 7. Test Scenario 2: Repeat Scan + NOT in DB1
    console.log('\n[7] Testing Scenario 2: Repeat scan + NOT in DB1 (TRK_UNKNOWN)...');
    const scanRes4 = await request('POST', '/api/scan', { tracking_id: 'TRK_UNKNOWN' });
    console.log('Result:', scanRes4.json.message);
    if (scanRes4.json.scenario !== 2 || scanRes4.json.found_in_db1 || !scanRes4.json.already_scanned) {
      throw new Error('Failed Scenario 2');
    }

    // 8. Test Missing Returns API
    console.log('\n[8] Testing GET /api/missing (Pending returns count)...');
    const missingRes = await request('GET', '/api/missing');
    console.log(`Total Missing: ${missingRes.json.total}`);
    console.log('Missing Tracking IDs:', missingRes.json.rows.map(r => r.tracking_id));
    // Expected in DB1: TRK_A1, TRK_B2, TRK_C3, TRK_D4 (4 total)
    // Scanned in DB2: TRK_A1 (matched), TRK_UNKNOWN (unmatched)
    // Pending in DB1: TRK_B2, TRK_C3, TRK_D4 (3 items)
    if (missingRes.json.total !== 3) {
      throw new Error(`Expected 3 missing items, got ${missingRes.json.total}`);
    }

    // 9. Test Dashboard Stats API
    console.log('\n[9] Testing GET /api/dashboard...');
    const dashRes = await request('GET', '/api/dashboard');
    console.log('Dashboard Stats:', dashRes.json);
    if (dashRes.json.totalUploaded !== 4 || dashRes.json.matchedScans !== 1 || dashRes.json.missingCount !== 3) {
      throw new Error('Dashboard stats verification failed');
    }

    // 10. Test Export Missing CSV
    console.log('\n[10] Testing GET /api/export-missing-csv...');
    const csvRes = await request('GET', '/api/export-missing-csv');
    if (!csvRes.body.includes('"Tracking ID"') || !csvRes.body.includes('TRK_B2')) {
      throw new Error('Export CSV failed to contain expected headers or rows');
    }
    console.log('CSV Export verified. Sample header line:\n' + csvRes.body.split('\r\n')[0]);

    // 11. Test Network Info
    console.log('\n[11] Testing GET /api/network-info...');
    const netRes = await request('GET', '/api/network-info');
    console.log('Network IPs detected:', netRes.json.ips);

    console.log('\n>>> ALL INTEGRATION TESTS PASSED 100% SUCCESSFULLY! <<<');
  } catch (err) {
    console.error('\n❌ INTEGRATION TEST FAILED:', err);
    process.exit(1);
  } finally {
    server.close();
    process.exit(0);
  }
}

runTests();
