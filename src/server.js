// src/server.js
// High-performance HTTP & HTTPS server for Flipkart Returns Tracker using pure Node.js
const http = require('node:http');
const https = require('node:https');
const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const url = require('node:url');

const db = require('./db');

const PORT = process.env.PORT || 3000;
const HTTPS_PORT = process.env.HTTPS_PORT || 3443;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const PFX_PATH = path.join(__dirname, '..', 'cert.pfx');
const PFX_PASSWORD = 'flipkart';

// Ensure SSL cert.pfx exists for HTTPS mobile camera access
function ensureSslCert() {
  if (fs.existsSync(PFX_PATH)) return true;
  try {
    const cmd = `powershell -Command "$cert = New-SelfSignedCertificate -DnsName 'localhost', '192.168.29.194' -CertStoreLocation 'cert:\\CurrentUser\\My' -NotAfter (Get-Date).AddYears(5); $pwd = ConvertTo-SecureString -String '${PFX_PASSWORD}' -Force -AsPlainText; Export-PfxCertificate -Cert $cert -FilePath '${PFX_PATH}' -Password $pwd"`;
    execSync(cmd, { stdio: 'ignore' });
    return fs.existsSync(PFX_PATH);
  } catch (e) {
    console.warn('Could not auto-generate SSL certificate:', e.message);
    return false;
  }
}

// Helper to get local IPv4 addresses
function getLocalIps() {
  const interfaces = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        ips.push(iface.address);
      }
    }
  }
  return ips;
}

// Helper to parse JSON request body
function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      // Protect against overly large payloads (> 25MB)
      if (body.length > 25 * 1024 * 1024) {
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

// Helper to send JSON responses
function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  });
  res.end(JSON.stringify(data));
}

// Helper to send error responses
function sendError(res, statusCode, message) {
  sendJson(res, statusCode, { error: true, message });
}

// Helper to convert array of objects to CSV
function objectsToCsv(rows) {
  if (!rows || rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  const csvRows = [headers.map(h => `"${h.replace(/"/g, '""')}"`).join(',')];
  
  for (const row of rows) {
    const values = headers.map(header => {
      const val = row[header] === null || row[header] === undefined ? '' : String(row[header]);
      return `"${val.replace(/"/g, '""')}"`;
    });
    csvRows.push(values.join(','));
  }
  return csvRows.join('\r\n');
}

// MIME types for static files
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.csv': 'text/csv; charset=utf-8'
};

// Request handler
const requestHandler = async (req, res) => {
  // CORS Preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });
    return res.end();
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;
  const query = Object.fromEntries(parsedUrl.searchParams);

  try {
    // API ROUTES
    if (pathname.startsWith('/api/')) {
      // 1. Scan Tracking ID
      if (pathname === '/api/scan' && req.method === 'POST') {
        const body = await parseJsonBody(req);
        if (!body.tracking_id) {
          return sendError(res, 400, 'Tracking ID is required');
        }
        const result = db.processScan(body.tracking_id, body.source || 'camera', body.notes || '');
        return sendJson(res, 200, result);
      }

      // 2. Upload Flipkart Returns (Batch JSON from Excel/CSV parser)
      if (pathname === '/api/upload-returns' && req.method === 'POST') {
        const body = await parseJsonBody(req);
        const records = Array.isArray(body) ? body : body.records;
        if (!Array.isArray(records) || records.length === 0) {
          return sendError(res, 400, 'Expected non-empty array of return records');
        }
        const stats = db.batchInsertReturns(records);
        return sendJson(res, 200, {
          success: true,
          message: `Processed ${stats.totalRows} rows: ${stats.inserted} newly added, ${stats.ignored} existing/empty records ignored silently.`,
          stats
        });
      }

      // 3. Dashboard Statistics
      if (pathname === '/api/dashboard' && req.method === 'GET') {
        const stats = db.getDashboardStats();
        return sendJson(res, 200, stats);
      }

      // 4. Missing / Pending Returns
      if (pathname === '/api/missing' && req.method === 'GET') {
        const page = Math.max(1, parseInt(query.page || '1', 10));
        const limit = Math.min(200, Math.max(1, parseInt(query.limit || '50', 10)));
        const offset = (page - 1) * limit;
        const result = db.getMissingReturns({
          search: query.search || '',
          sortBy: query.sortBy || 'created_at',
          sortOrder: query.sortOrder || 'DESC',
          limit,
          offset
        });
        return sendJson(res, 200, {
          ...result,
          page,
          totalPages: Math.ceil(result.total / limit)
        });
      }

      // 5. Scanned Records
      if (pathname === '/api/scans' && req.method === 'GET') {
        const page = Math.max(1, parseInt(query.page || '1', 10));
        const limit = Math.min(200, Math.max(1, parseInt(query.limit || '50', 10)));
        const offset = (page - 1) * limit;
        const result = db.getScannedReturns({
          search: query.search || '',
          matchedOnly: query.matchedOnly !== undefined ? query.matchedOnly : null,
          limit,
          offset
        });
        return sendJson(res, 200, {
          ...result,
          page,
          totalPages: Math.ceil(result.total / limit)
        });
      }

      // 6. Full Uploaded Returns List
      if (pathname === '/api/returns' && req.method === 'GET') {
        const page = Math.max(1, parseInt(query.page || '1', 10));
        const limit = Math.min(200, Math.max(1, parseInt(query.limit || '50', 10)));
        const offset = (page - 1) * limit;
        const result = db.getAllReturns({
          search: query.search || '',
          limit,
          offset
        });
        return sendJson(res, 200, {
          ...result,
          page,
          totalPages: Math.ceil(result.total / limit)
        });
      }

      // 7. Export Missing Returns CSV
      if (pathname === '/api/export-missing-csv' && req.method === 'GET') {
        const rows = db.exportMissingReturns();
        const csvContent = objectsToCsv(rows);
        const filename = `flipkart_missing_returns_${new Date().toISOString().slice(0, 10)}.csv`;
        res.writeHead(200, {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${filename}"`
        });
        return res.end(csvContent);
      }

      // 8. Delete a single scan (undo scan)
      if (pathname.startsWith('/api/scans/') && req.method === 'DELETE') {
        const scanId = parseInt(pathname.split('/').pop(), 10);
        if (isNaN(scanId)) return sendError(res, 400, 'Invalid scan ID');
        const deleted = db.deleteScan(scanId);
        return sendJson(res, 200, { success: deleted });
      }

      // 9. Network IP & Pairing Info
      // 9. Network IP & Pairing Info
      if (pathname === '/api/network-info' && req.method === 'GET') {
        const ips = getLocalIps();
        const hasHttps = fs.existsSync(PFX_PATH);
        return sendJson(res, 200, {
          port: PORT,
          httpsPort: HTTPS_PORT,
          hasHttps,
          ips,
          mobileUrls: ips.map(ip => `http://${ip}:${PORT}`),
          mobileHttpsUrls: ips.map(ip => `https://${ip}:${HTTPS_PORT}`)
        });
      }

      // 10. Sample Flipkart Data for immediate 1-click test
      if (pathname === '/api/sample-flipkart-data' && req.method === 'GET') {
        const sampleData = [
          {
            tracking_id: 'FMPP009812451',
            order_id: 'OD309182390123',
            order_item_id: 'OI9823101',
            sku: 'TSHIRT-SLM-BLK-L',
            product_name: 'Men Slim Fit Black T-Shirt (Large)',
            return_reason: 'Quality issue / Stitching loose',
            return_type: 'Customer Return',
            return_date: '2026-09-20',
            customer_name: 'Rahul Sharma'
          },
          {
            tracking_id: 'FMPP009812452',
            order_id: 'OD309182390124',
            order_item_id: 'OI9823102',
            sku: 'CASUAL-SHOE-BRN-9',
            product_name: 'Brown Leather Casual Shoes (Size 9)',
            return_reason: 'Size too small',
            return_type: 'Customer Return',
            return_date: '2026-09-21',
            customer_name: 'Amit Patel'
          },
          {
            tracking_id: 'FMPP009812453',
            order_id: 'OD309182390125',
            order_item_id: 'OI9823103',
            sku: 'BT-SPEAKER-BLU',
            product_name: 'Waterproof Portable Bluetooth Speaker',
            return_reason: 'Product not working / No power',
            return_type: 'Courier Return (RTO)',
            return_date: '2026-09-21',
            customer_name: 'Sneha Verma'
          },
          {
            tracking_id: 'FMPP009812454',
            order_id: 'OD309182390126',
            order_item_id: 'OI9823104',
            sku: 'WRISTWATCH-SLVR-01',
            product_name: 'Stainless Steel Chronograph Watch',
            return_reason: 'Wrong item delivered',
            return_type: 'Customer Return',
            return_date: '2026-09-22',
            customer_name: 'Vikas Kumar'
          },
          {
            tracking_id: 'FMPP009812455',
            order_id: 'OD309182390127',
            order_item_id: 'OI9823105',
            sku: 'SUNGLASS-POLAR-BLK',
            product_name: 'Polarized Aviator Sunglasses',
            return_reason: 'Customer not available at delivery',
            return_type: 'Courier Return (RTO)',
            return_date: '2026-09-22',
            customer_name: 'Pooja Reddy'
          },
          {
            tracking_id: 'FMPP009812456',
            order_id: 'OD309182390128',
            order_item_id: 'OI9823106',
            sku: 'BACKPACK-TRVL-GREY',
            product_name: 'Water Resistant Laptop Backpack 30L',
            return_reason: 'Changed mind',
            return_type: 'Customer Return',
            return_date: '2026-09-23',
            customer_name: 'Karan Singh'
          }
        ];
        return sendJson(res, 200, sampleData);
      }

      // 11. Clear Data (optional)
      if (pathname === '/api/clear' && req.method === 'POST') {
        const body = await parseJsonBody(req);
        db.clearDatabase(body.target || 'scans');
        return sendJson(res, 200, { success: true, message: `Cleared ${body.target || 'scans'}` });
      }

      return sendError(res, 404, 'API endpoint not found');
    }

    // STATIC FILE SERVING
    let relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '');
    let safePath = path.normalize(path.join(PUBLIC_DIR, relativePath));

    if (!safePath.startsWith(PUBLIC_DIR)) {
      res.writeHead(403);
      return res.end('Access Denied');
    }

    if (fs.existsSync(safePath) && fs.statSync(safePath).isFile()) {
      const ext = path.extname(safePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': contentType });
      return fs.createReadStream(safePath).pipe(res);
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('File not found');
    }
  } catch (err) {
    console.error('Server Error:', err);
    return sendError(res, 500, err.message || 'Internal Server Error');
  }
};

// HTTP Server (Port 3000)
const httpServer = http.createServer(requestHandler);

httpServer.listen(PORT, '0.0.0.0', () => {
  const ips = getLocalIps();
  console.log(`\n======================================================`);
  console.log(` Flipkart Returns Tracker is running!`);
  console.log(` HTTP (Local):   http://localhost:${PORT}`);
  ips.forEach(ip => {
    console.log(` HTTP (Mobile):  http://${ip}:${PORT}`);
  });

  // HTTPS Server (Port 3443 for Mobile Camera streaming)
  if (ensureSslCert()) {
    try {
      const pfxData = fs.readFileSync(PFX_PATH);
      const httpsServer = https.createServer({
        pfx: pfxData,
        passphrase: PFX_PASSWORD
      }, requestHandler);

      httpsServer.listen(HTTPS_PORT, '0.0.0.0', () => {
        console.log(`------------------------------------------------------`);
        console.log(` HTTPS for Mobile Camera Streaming:`);
        console.log(` HTTPS (Local):  https://localhost:${HTTPS_PORT}`);
        ips.forEach(ip => {
          console.log(` HTTPS (Mobile): https://${ip}:${HTTPS_PORT}`);
        });
        console.log(`======================================================\n`);
      });
    } catch (httpsErr) {
      console.warn('Could not start HTTPS server:', httpsErr.message);
    }
  } else {
    console.log(`======================================================\n`);
  }
});

module.exports = httpServer;
