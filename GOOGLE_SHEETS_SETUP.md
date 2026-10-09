# 📊 Google Sheets Backend Setup Guide

This guide explains how to connect your **Google Sheet** as the backend for the **Flipkart Returns Tracker & Scanner**.

---

## 🎯 Architecture Overview

Your Google Sheet stores two synchronized tables:
1. **`Flipkart_Returns`**: Manifest of expected returns (Tracking ID, Order ID, SKU, Product Name, Customer, Return Reason, Status: *Pending* or *Received*).
2. **`Scanned_Returns`**: Physical scanner log (Scan ID, Tracking ID, Scanned Timestamp, Match Status: *MATCHED* or *UNMATCHED*, Scanner Source).

You can connect Google Sheets using either **Method 1 (Google Service Account)** or **Method 2 (Google Apps Script Web App)**.

---

## 🚀 Method 1: Google Service Account (Recommended for Node.js Server)

Uses the official **Google Sheets API v4** with a Google Cloud Service Account.

### Step 1: Create a Service Account in Google Cloud Console
1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project (or select an existing one), e.g., `Flipkart Returns Tracker`.
3. Enable the **Google Sheets API**:
   - Go to **APIs & Services** > **Library**.
   - Search for **Google Sheets API** and click **Enable**.
4. Create a Service Account:
   - Go to **APIs & Services** > **Credentials**.
   - Click **+ Create Credentials** > **Service Account**.
   - Give it a name (e.g., `flipkart-returns-bot`) and click **Done**.
5. Generate the JSON Key:
   - Click on the created service account email.
   - Go to the **Keys** tab > **Add Key** > **Create new key**.
   - Select **JSON** and download the file.

### Step 2: Share Your Google Sheet with the Service Account
1. Open your Google Sheet in your browser (or create a new sheet at [sheets.new](https://sheets.new)).
2. Copy the **Service Account email** (looks like `flipkart-returns-bot@your-project.iam.gserviceaccount.com`).
3. In your Google Sheet, click the green **Share** button (top right).
4. Paste the service account email and give it **Editor** permissions.
5. Copy your **Spreadsheet ID** from the URL:
   `https://docs.google.com/spreadsheets/d/`**`1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms`**`/edit`

### Step 3: Configure the Local App
1. Rename your downloaded key file to `service-account.json`.
2. Move it to the `credentials/` folder in this project:
   `c:\Users\piyus\Documents\Projects\Roh\credentials\service-account.json`
   *(Note: The `credentials/` folder is gitignored to protect your keys).*
3. In the web app UI, click **📊 Google Sheet** in the top navigation, enter your **Spreadsheet ID**, and click **Save & Test Connection**.

---

## ⚡ Method 2: Google Apps Script Web App (2-Minute Zero-GCP Setup)

If you don't want to deal with Google Cloud Console credentials, this turns any Google Sheet into an instant REST API that works directly from your mobile phone, GitHub Pages, or local server.

### Step 1: Add the Apps Script Code
1. Open your Google Sheet (or create one at [sheets.new](https://sheets.new)).
2. In the top menu, click **Extensions** > **Apps Script**.
3. Clear any existing code in the editor.
4. Open [`google_sheets_apps_script.js`](./google_sheets_apps_script.js) from this repository, copy all code, and paste it into the Apps Script editor.
5. Click the **Save** (disk) icon.

### Step 2: Initialize the Sheets
1. In the toolbar function dropdown, select `setupTrackerSheets` and click **Run**.
2. Click **Review permissions** > Choose your Google account > Click **Advanced** > Click **Go to Untitled project (unsafe)** > Click **Allow**.
3. Your Google Sheet will immediately have two beautifully styled sheets created: `Flipkart_Returns` and `Scanned_Returns`.

### Step 3: Deploy as a Web App
1. Click the blue **Deploy** button (top right) > **New deployment**.
2. Click the gear icon ⚙️ next to *Select type* and choose **Web app**.
3. Configure:
   - **Description**: `Flipkart Returns Backend`
   - **Execute as**: `Me`
   - **Who has access**: `Anyone`
4. Click **Deploy**.
5. Copy the **Web app URL** (e.g., `https://script.google.com/macros/s/AKfycb.../exec`).

### Step 4: Connect in the App
1. Open the web app and click **📊 Google Sheet** in the top bar.
2. Select **Google Apps Script Web App** tab.
3. Paste your Web App URL and click **Save & Connect**.
4. Done! All scans and manifest uploads will now sync in real time directly to your Google Sheet!
