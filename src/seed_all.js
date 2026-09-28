// src/seed_all.js - Populate all sample Flipkart returns data
const fs = require('node:fs');
const path = require('node:path');
const db = require('./db');

const csvPath = path.join(__dirname, '..', 'data', 'sample_flipkart_returns.csv');
const csv = fs.readFileSync(csvPath, 'utf8');

const lines = csv.split(/\r?\n/).filter(l => l.trim().length > 0);
const records = [];

for (let i = 1; i < lines.length; i++) {
  const line = lines[i];
  const parts = [];
  let cur = '';
  let inQuotes = false;
  for (let j = 0; j < line.length; j++) {
    const c = line[j];
    if (c === '"') {
      inQuotes = !inQuotes;
    } else if (c === ',' && !inQuotes) {
      parts.push(cur.trim());
      cur = '';
    } else {
      cur += c;
    }
  }
  parts.push(cur.trim());

  records.push({
    tracking_id: parts[0] || '',
    order_id: parts[1] || '',
    order_item_id: parts[2] || '',
    sku: parts[3] || '',
    product_name: parts[4] || '',
    return_reason: parts[5] || '',
    return_type: parts[6] || '',
    return_date: parts[7] || '',
    customer_name: parts[8] || ''
  });
}

const res = db.batchInsertReturns(records);
console.log('Seeded CSV records result:', res);
console.log('Current Dashboard Stats:', db.getDashboardStats());
