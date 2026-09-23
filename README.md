# Flipkart Returns Tracker & Scanner (Web & Mobile)

A full-stack returns tracking application designed for Flipkart sellers.

## Features
- **Excel & CSV Manifest Upload**: Upload `.xlsx` or `.csv` files downloaded from Flipkart seller dashboard. Automatically skips duplicate tracking IDs silently and appends new ones into **Flipkart Return Records**.
- **Live Camera Scanner**: High-speed QR and barcode scanner using camera on PC or mobile phone. Supports flashlight/torch and "Take Photo" fallback.
- **Dual-Database Verification**:
  - *New Scan + In Flipkart Return Records*: Saved to **Returns** with timestamp, displays Flipkart return details (Order ID, SKU, Product, Reason).
  - *New Scan + NOT in Flipkart Return Records*: Saved to **Returns** with timestamp as unlisted package.
  - *Repeat Scan + In Flipkart Return Records*: Displays `"Already recorded in Returns on [Date/Time]"` with return details.
  - *Repeat Scan + NOT in Flipkart Return Records*: Displays `"Already recorded on [Date/Time], but not found in Flipkart Return Records"`.
- **Missing Returns Reconciliation**: Real-time counter and table showing expected returns that haven't arrived yet. Includes CSV export for seller claims.
- **Mobile Pairing**: Scan the on-screen QR code to open the app on your mobile phone over local Wi-Fi.

## Quick Start
1. Double-click `start.bat` or run:
   ```powershell
   agy-node src/server.js
   ```
2. Open in browser:
   - Local: `http://localhost:3000`
   - Mobile: `http://192.168.29.194:3000`
