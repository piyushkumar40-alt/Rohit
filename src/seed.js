// src/seed.js - Pre-populate with realistic Flipkart sample returns
const { batchInsertReturns } = require('./db');

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

const stats = batchInsertReturns(sampleData);
console.log('Sample Flipkart Returns Seeded:', stats);
