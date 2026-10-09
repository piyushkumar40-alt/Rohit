// public/app.js - Flipkart Returns Tracker & Scanner

(function () {
  'use strict';

  // --- Global Application State ---
  const state = {
    soundEnabled: true,
    activeTab: 'tab-scanner',
    cameraStream: null,
    currentFacingMode: 'environment', // Rear camera by default for barcode/QR scanning
    torchActive: false,
    barcodeDetector: null,
    scanLoopActive: false,
    lastScannedCode: null,
    lastScanTime: 0,
    scanCooldownMs: 2500, // Prevent re-triggering same barcode while under lens
    recentScans: [],
    uploadedFileRecords: [],
    missingPage: 1,
    missingSearch: '',
    scansPage: 1,
    scansSearch: '',
    scansFilter: 'all',
  };

  // --- Embedded Sample Flipkart Returns Manifest ---
  const SAMPLE_FLIPKART_DATA = [
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
    },
    {
      tracking_id: 'FMPP009812457',
      order_id: 'OD309182390129',
      order_item_id: 'OI9823107',
      sku: 'YOGA-MAT-6MM-PURP',
      product_name: 'Eco Anti-Skid Yoga Mat 6mm Purple',
      return_reason: 'Color mismatch',
      return_type: 'Customer Return',
      return_date: '2026-09-23',
      customer_name: 'Neha Gupta'
    },
    {
      tracking_id: 'FMPP009812458',
      order_id: 'OD309182390130',
      order_item_id: 'OI9823108',
      sku: 'HEADPHONES-ANC-BLK',
      product_name: 'Active Noise Cancelling Wireless Headphones',
      return_reason: 'Audio cut out in one ear',
      return_type: 'Customer Return',
      return_date: '2026-09-23',
      customer_name: 'Rohan Joshi'
    }
  ];

  // --- Client-Side Local Storage Database (Universal Fallback for GitHub Pages) ---
  const clientStore = {
    isStaticHost: window.location.hostname.endsWith('github.io') || window.location.protocol === 'file:',

    getDb1() {
      try {
        const d = localStorage.getItem('flipkart_returns_db1');
        return d ? JSON.parse(d) : [];
      } catch (e) { return []; }
    },
    saveDb1(items) {
      try { localStorage.setItem('flipkart_returns_db1', JSON.stringify(items)); } catch (e) {}
    },
    getDb2() {
      try {
        const d = localStorage.getItem('flipkart_scans_db2');
        return d ? JSON.parse(d) : [];
      } catch (e) { return []; }
    },
    saveDb2(items) {
      try { localStorage.setItem('flipkart_scans_db2', JSON.stringify(items)); } catch (e) {}
    },
    initDefaults() {
      if (this.isStaticHost) {
        const db1 = this.getDb1();
        if (db1.length === 0) {
          this.saveDb1(SAMPLE_FLIPKART_DATA);
        }
      }
    },
    batchInsert(records) {
      const db1 = this.getDb1();
      const existingIds = new Set(db1.map(r => String(r.tracking_id).trim().toLowerCase()));
      let inserted = 0;
      let ignored = 0;
      records.forEach(r => {
        if (!r.tracking_id || !String(r.tracking_id).trim()) {
          ignored++;
          return;
        }
        const tid = String(r.tracking_id).trim();
        if (existingIds.has(tid.toLowerCase())) {
          ignored++;
        } else {
          existingIds.add(tid.toLowerCase());
          db1.push({
            ...r,
            tracking_id: tid,
            created_at: new Date().toISOString().replace('T', ' ').slice(0, 19)
          });
          inserted++;
        }
      });
      this.saveDb1(db1);
      return { totalRows: records.length, inserted, ignored };
    },
    processScan(rawTrackingId, scanSource = 'camera') {
      const trackingId = String(rawTrackingId || '').trim();
      if (!trackingId) throw new Error('Tracking ID cannot be empty');

      const db1 = this.getDb1();
      const db2 = this.getDb2();

      const existingScan = db2.find(s => s.tracking_id.toLowerCase() === trackingId.toLowerCase());
      const returnRecord = db1.find(r => r.tracking_id.toLowerCase() === trackingId.toLowerCase());
      const foundInDb1 = Boolean(returnRecord);

      if (existingScan) {
        const recordedAt = existingScan.scanned_at;
        if (foundInDb1) {
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

      // New scan
      const recordedAt = new Date().toISOString().replace('T', ' ').slice(0, 19);
      const newScan = {
        id: Date.now(),
        tracking_id: trackingId,
        scanned_at: recordedAt,
        matched_in_db1: foundInDb1 ? 1 : 0,
        scan_source: scanSource,
        notes: ''
      };
      db2.unshift(newScan);
      this.saveDb2(db2);

      if (foundInDb1) {
        return {
          scenario: 3,
          code: 'NEW_SCAN_MATCHED',
          tracking_id: trackingId,
          already_scanned: false,
          found_in_db1: true,
          recorded_at: recordedAt,
          message: `Tracking ID matched! Saved to Returns on ${recordedAt}`,
          flipkart_data: returnRecord,
          scan_id: newScan.id
        };
      } else {
        return {
          scenario: 4,
          code: 'NEW_SCAN_UNMATCHED',
          tracking_id: trackingId,
          already_scanned: false,
          found_in_db1: false,
          recorded_at: recordedAt,
          message: `Tracking ID not found in Flipkart Return Records, but saved in Returns with timestamp ${recordedAt}`,
          flipkart_data: null,
          scan_id: newScan.id
        };
      }
    },
    getMissing({ search = '', limit = 25, page = 1 } = {}) {
      const db1 = this.getDb1();
      const db2 = this.getDb2();
      const scannedIds = new Set(db2.map(s => s.tracking_id.toLowerCase()));

      let rows = db1.filter(r => !scannedIds.has(String(r.tracking_id).trim().toLowerCase()));

      if (search && search.trim()) {
        const s = search.trim().toLowerCase();
        rows = rows.filter(r =>
          (r.tracking_id && r.tracking_id.toLowerCase().includes(s)) ||
          (r.order_id && r.order_id.toLowerCase().includes(s)) ||
          (r.sku && r.sku.toLowerCase().includes(s)) ||
          (r.product_name && r.product_name.toLowerCase().includes(s)) ||
          (r.customer_name && r.customer_name.toLowerCase().includes(s))
        );
      }

      const total = rows.length;
      const offset = (page - 1) * limit;
      const pagedRows = rows.slice(offset, offset + limit).map(r => ({
        ...r,
        days_pending: 0
      }));

      return {
        rows: pagedRows,
        total,
        limit,
        page,
        totalPages: Math.ceil(total / limit) || 1
      };
    },
    getScans({ search = '', matchedOnly = null, limit = 25, page = 1 } = {}) {
      const db1 = this.getDb1();
      const db2 = this.getDb2();
      const db1Map = new Map(db1.map(r => [r.tracking_id.toLowerCase(), r]));

      let rows = db2.map(s => {
        const flip = db1Map.get(s.tracking_id.toLowerCase());
        return {
          id: s.id,
          tracking_id: s.tracking_id,
          scanned_at: s.scanned_at,
          matched_in_db1: s.matched_in_db1,
          scan_source: s.scan_source,
          order_id: flip ? flip.order_id : '',
          sku: flip ? flip.sku : '',
          product_name: flip ? flip.product_name : '',
          return_reason: flip ? flip.return_reason : '',
          customer_name: flip ? flip.customer_name : ''
        };
      });

      if (matchedOnly === '1' || matchedOnly === 1) {
        rows = rows.filter(r => r.matched_in_db1 === 1);
      } else if (matchedOnly === '0' || matchedOnly === 0) {
        rows = rows.filter(r => r.matched_in_db1 === 0);
      }

      if (search && search.trim()) {
        const s = search.trim().toLowerCase();
        rows = rows.filter(r =>
          (r.tracking_id && r.tracking_id.toLowerCase().includes(s)) ||
          (r.order_id && r.order_id.toLowerCase().includes(s)) ||
          (r.product_name && r.product_name.toLowerCase().includes(s))
        );
      }

      const total = rows.length;
      const offset = (page - 1) * limit;
      const pagedRows = rows.slice(offset, offset + limit);

      return {
        rows: pagedRows,
        total,
        limit,
        page,
        totalPages: Math.ceil(total / limit) || 1
      };
    },
    getStats() {
      const db1 = this.getDb1();
      const db2 = this.getDb2();
      const totalUploaded = db1.length;
      const totalScanned = db2.length;
      const matchedScans = db2.filter(s => s.matched_in_db1 === 1).length;
      const unmatchedScans = db2.filter(s => s.matched_in_db1 === 0).length;
      const missingCount = Math.max(0, totalUploaded - matchedScans);
      const returnReceivedRate = totalUploaded > 0 ? Math.round((matchedScans / totalUploaded) * 100) : 0;
      return {
        totalUploaded,
        totalScanned,
        matchedScans,
        unmatchedScans,
        missingCount,
        returnReceivedRate
      };
    },
    deleteScan(id) {
      const db2 = this.getDb2().filter(s => s.id !== id && String(s.id) !== String(id));
      this.saveDb2(db2);
      return true;
    }
  };

  // --- GitHub Cloud Database Engine (Direct Cloud Storage) ---
  const githubSync = {
    DEFAULT_OWNER: 'piyushkumar40-alt',
    DEFAULT_REPO: 'Rohit',
    DEFAULT_BRANCH: 'main',
    DB1_PATH: 'data/flipkart_returns.json',
    DB2_PATH: 'data/scanned_returns.json',

    db1Sha: null,
    db2Sha: null,
    syncTimeout: null,
    isSyncing: false,

    getToken() {
      return (localStorage.getItem('gh_sync_token') || '').trim();
    },
    setToken(token) {
      if (token) localStorage.setItem('gh_sync_token', token.trim());
      else localStorage.removeItem('gh_sync_token');
    },
    getOwner() {
      return (localStorage.getItem('gh_sync_owner') || this.DEFAULT_OWNER).trim();
    },
    setOwner(owner) {
      localStorage.setItem('gh_sync_owner', (owner || this.DEFAULT_OWNER).trim());
    },
    getRepo() {
      return (localStorage.getItem('gh_sync_repo') || this.DEFAULT_REPO).trim();
    },
    setRepo(repo) {
      localStorage.setItem('gh_sync_repo', (repo || this.DEFAULT_REPO).trim());
    },
    getBranch() {
      return (localStorage.getItem('gh_sync_branch') || this.DEFAULT_BRANCH).trim();
    },
    setBranch(branch) {
      localStorage.setItem('gh_sync_branch', (branch || this.DEFAULT_BRANCH).trim());
    },
    isAutoSync() {
      const v = localStorage.getItem('gh_auto_sync');
      return v === null ? true : v === 'true';
    },
    setAutoSync(enabled) {
      localStorage.setItem('gh_auto_sync', String(enabled));
    },

    utf8ToBase64(str) {
      return btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (match, p1) => {
        return String.fromCharCode(parseInt(p1, 16));
      }));
    },

    base64ToUtf8(b64) {
      const cleanB64 = b64.replace(/\s/g, '');
      const binaryStr = atob(cleanB64);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }
      return new TextDecoder().decode(bytes);
    },

    setStatus(type, text) {
      if (dom.githubStatusBadge) {
        dom.githubStatusBadge.className = `badge badge-github ${type}`;
      }
      if (dom.githubStatusText) {
        dom.githubStatusText.textContent = text;
      }
      if (dom.ghModalStatusDot) {
        dom.ghModalStatusDot.style.backgroundColor =
          type === 'synced' ? '#10b981' :
          type === 'syncing' ? '#f59e0b' :
          type === 'error' ? '#ef4444' : '#38bdf8';
        dom.ghModalStatusDot.style.boxShadow =
          type === 'synced' ? '0 0 8px #10b981' :
          type === 'syncing' ? '0 0 8px #f59e0b' :
          type === 'error' ? '0 0 8px #ef4444' : '0 0 8px #38bdf8';
      }
      if (dom.ghModalStatusTitle) {
        dom.ghModalStatusTitle.textContent =
          type === 'synced' ? '🟢 Cloud Connected & Synced' :
          type === 'syncing' ? '🟡 Syncing with GitHub...' :
          type === 'error' ? '🔴 Sync Error: ' + text :
          '⚪ GitHub Storage (Read-Only / Not Connected)';
      }
    },

    async testConnection(token, owner, repo) {
      const headers = {
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'Rohit-Returns-Tracker'
      };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `HTTP ${res.status}`);
      }
      const data = await res.json();
      return {
        repoName: data.full_name,
        isPrivate: data.private,
        permissions: data.permissions || {}
      };
    },

    async fetchFile(path) {
      const token = this.getToken();
      const owner = this.getOwner();
      const repo = this.getRepo();
      const branch = this.getBranch();

      const headers = {
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'Rohit-Returns-Tracker'
      };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${branch}&_t=${Date.now()}`;
      try {
        const res = await fetch(apiUrl, { headers, cache: 'no-store' });
        if (res.status === 404) return null;
        if (!res.ok) {
          throw new Error(`Failed to read ${path} (HTTP ${res.status})`);
        }
        const json = await res.json();
        const contentStr = this.base64ToUtf8(json.content);
        return {
          sha: json.sha,
          data: JSON.parse(contentStr)
        };
      } catch (apiErr) {
        // Fallback to raw.githubusercontent.com if public
        try {
          const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}?_t=${Date.now()}`;
          const rawRes = await fetch(rawUrl, { cache: 'no-store' });
          if (rawRes.ok) {
            const data = await rawRes.json();
            return { sha: null, data };
          }
        } catch (rawErr) {}
        throw apiErr;
      }
    },

    async putFile(path, dataObj, commitMessage, existingSha = null) {
      const token = this.getToken();
      if (!token) throw new Error('Personal Access Token (PAT) is required to commit changes to GitHub.');

      const owner = this.getOwner();
      const repo = this.getRepo();
      const branch = this.getBranch();

      let sha = existingSha;
      if (!sha) {
        const existing = await this.fetchFile(path).catch(() => null);
        if (existing) sha = existing.sha;
      }

      const jsonStr = JSON.stringify(dataObj, null, 2);
      const payload = {
        message: commitMessage || `Update ${path} [${new Date().toISOString()}]`,
        content: this.utf8ToBase64(jsonStr),
        branch: branch
      };
      if (sha) payload.sha = sha;

      const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github+json',
          'Content-Type': 'application/json',
          'User-Agent': 'Rohit-Returns-Tracker'
        },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `Failed to write ${path} (HTTP ${res.status})`);
      }

      const result = await res.json();
      return result.content ? result.content.sha : null;
    },

    async pullAll(silent = false) {
      if (!silent) this.setStatus('syncing', 'Pulling from GitHub...');
      try {
        let pulledReturns = 0;
        let pulledScans = 0;

        // Pull DB1: Returns
        const file1 = await this.fetchFile(this.DB1_PATH);
        if (file1 && Array.isArray(file1.data)) {
          this.db1Sha = file1.sha;
          const localDb1 = clientStore.getDb1();
          const mergedDb1 = this.mergeReturns(file1.data, localDb1);
          clientStore.saveDb1(mergedDb1);
          pulledReturns = mergedDb1.length;
        }

        // Pull DB2: Scans
        const file2 = await this.fetchFile(this.DB2_PATH);
        if (file2 && Array.isArray(file2.data)) {
          this.db2Sha = file2.sha;
          const localDb2 = clientStore.getDb2();
          const mergedDb2 = this.mergeScans(file2.data, localDb2);
          clientStore.saveDb2(mergedDb2);
          pulledScans = mergedDb2.length;
        }

        const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        localStorage.setItem('gh_last_synced', now);
        this.updateModalSyncInfo(now);

        if (this.getToken()) {
          this.setStatus('synced', `Synced: ${now}`);
        } else {
          this.setStatus('default', `Cloud Read: ${now}`);
        }

        updateCounts();
        if (typeof loadMissing === 'function') loadMissing();
        if (typeof loadScans === 'function') loadScans();
        if (typeof loadOverview === 'function') loadOverview();

        return { success: true, returnsCount: pulledReturns, scansCount: pulledScans };
      } catch (err) {
        console.warn('GitHub pull warning:', err);
        if (!silent) this.setStatus('error', 'Pull failed: ' + err.message);
        throw err;
      }
    },

    mergeReturns(remoteList, localList) {
      const map = new Map();
      for (const r of remoteList) {
        if (r && r.tracking_id) map.set(String(r.tracking_id).trim().toLowerCase(), r);
      }
      for (const l of localList) {
        if (l && l.tracking_id) {
          const key = String(l.tracking_id).trim().toLowerCase();
          if (!map.has(key)) map.set(key, l);
        }
      }
      return Array.from(map.values());
    },

    mergeScans(remoteList, localList) {
      const map = new Map();
      for (const s of remoteList) {
        if (s && s.tracking_id) map.set(String(s.tracking_id).trim().toLowerCase(), s);
      }
      for (const l of localList) {
        if (l && l.tracking_id) {
          const key = String(l.tracking_id).trim().toLowerCase();
          if (!map.has(key)) map.set(key, l);
        }
      }
      return Array.from(map.values()).sort((a, b) => (b.scanned_at || '').localeCompare(a.scanned_at || ''));
    },

    async pushReturns() {
      const token = this.getToken();
      if (!token) return;
      this.setStatus('syncing', 'Saving returns to GitHub...');
      const records = clientStore.getDb1();
      const newSha = await this.putFile(
        this.DB1_PATH,
        records,
        `chore(returns): update ${records.length} return manifest records`,
        this.db1Sha
      );
      this.db1Sha = newSha;
      const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      localStorage.setItem('gh_last_synced', now);
      this.setStatus('synced', `Synced: ${now}`);
      this.updateModalSyncInfo(now);
    },

    async pushScans() {
      const token = this.getToken();
      if (!token) return;
      this.setStatus('syncing', 'Saving scans to GitHub...');
      const scans = clientStore.getDb2();
      const newSha = await this.putFile(
        this.DB2_PATH,
        scans,
        `chore(scans): record ${scans.length} scans`,
        this.db2Sha
      );
      this.db2Sha = newSha;
      const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      localStorage.setItem('gh_last_synced', now);
      this.setStatus('synced', `Synced: ${now}`);
      this.updateModalSyncInfo(now);
    },

    scheduleAutoSyncScans() {
      if (!this.isAutoSync() || !this.getToken()) return;
      clearTimeout(this.syncTimeout);
      this.setStatus('syncing', 'Auto-syncing scans...');
      this.syncTimeout = setTimeout(async () => {
        try {
          await this.pushScans();
        } catch (e) {
          console.warn('Auto-sync scans push warning:', e);
          this.setStatus('error', 'Auto-sync error');
        }
      }, 1500);
    },

    async syncNow() {
      this.setStatus('syncing', 'Syncing with GitHub...');
      await this.pullAll(true);
      if (this.getToken()) {
        await this.pushReturns();
        await this.pushScans();
      }
      const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      localStorage.setItem('gh_last_synced', now);
      this.setStatus('synced', `Synced: ${now}`);
      this.updateModalSyncInfo(now);
    },

    updateModalSyncInfo(time) {
      if (dom.ghLastSyncedDisplay) dom.ghLastSyncedDisplay.textContent = time || 'Never';
      if (dom.ghRepoDisplay) dom.ghRepoDisplay.textContent = `${this.getOwner()}/${this.getRepo()}`;
      if (dom.ghBranchDisplay) dom.ghBranchDisplay.textContent = this.getBranch();
    },

    setupUI() {
      if (dom.ghTokenInput) dom.ghTokenInput.value = this.getToken();
      if (dom.ghOwnerInput) dom.ghOwnerInput.value = this.getOwner();
      if (dom.ghRepoInput) dom.ghRepoInput.value = this.getRepo();
      if (dom.ghBranchInput) dom.ghBranchInput.value = this.getBranch();
      if (dom.ghAutoSyncCheckbox) dom.ghAutoSyncCheckbox.checked = this.isAutoSync();

      const lastSynced = localStorage.getItem('gh_last_synced') || 'Never';
      this.updateModalSyncInfo(lastSynced);

      const openModal = () => {
        if (dom.ghTokenInput) dom.ghTokenInput.value = this.getToken();
        if (dom.githubModal) dom.githubModal.classList.remove('hidden');
      };

      if (dom.btnGithubStatus) dom.btnGithubStatus.addEventListener('click', openModal);
      if (dom.btnGithubSync) dom.btnGithubSync.addEventListener('click', openModal);

      if (dom.btnCloseGithubModal) {
        dom.btnCloseGithubModal.addEventListener('click', () => {
          if (dom.githubModal) dom.githubModal.classList.add('hidden');
        });
      }

      if (dom.githubModal) {
        dom.githubModal.addEventListener('click', (e) => {
          if (e.target === dom.githubModal) dom.githubModal.classList.add('hidden');
        });
      }

      if (dom.btnToggleTokenVisibility && dom.ghTokenInput) {
        dom.btnToggleTokenVisibility.addEventListener('click', () => {
          const isPassword = dom.ghTokenInput.type === 'password';
          dom.ghTokenInput.type = isPassword ? 'text' : 'password';
          dom.btnToggleTokenVisibility.textContent = isPassword ? '🙈' : '👁️';
        });
      }

      if (dom.ghConfigForm) {
        dom.ghConfigForm.addEventListener('submit', async (e) => {
          e.preventDefault();
          const token = dom.ghTokenInput ? dom.ghTokenInput.value.trim() : '';
          const owner = dom.ghOwnerInput ? dom.ghOwnerInput.value.trim() : this.DEFAULT_OWNER;
          const repo = dom.ghRepoInput ? dom.ghRepoInput.value.trim() : this.DEFAULT_REPO;
          const branch = dom.ghBranchInput ? dom.ghBranchInput.value.trim() : this.DEFAULT_BRANCH;
          const autoSync = dom.ghAutoSyncCheckbox ? dom.ghAutoSyncCheckbox.checked : true;

          dom.btnSaveGhConfig.disabled = true;
          dom.btnSaveGhConfig.innerHTML = `<span>⏳</span> Testing Connection...`;

          try {
            const check = await this.testConnection(token, owner, repo);
            this.setToken(token);
            this.setOwner(owner);
            this.setRepo(repo);
            this.setBranch(branch);
            this.setAutoSync(autoSync);

            alert(`✅ Connected successfully to ${check.repoName}!\nPermissions: Read & Write active.`);
            await this.syncNow();
            if (dom.githubModal) dom.githubModal.classList.add('hidden');
          } catch (err) {
            alert(`❌ Connection test failed: ${err.message}\nPlease check your token and repo permissions.`);
            this.setStatus('error', err.message);
          } finally {
            dom.btnSaveGhConfig.disabled = false;
            dom.btnSaveGhConfig.innerHTML = `<span>💾</span> Save & Test Connection`;
          }
        });
      }

      if (dom.btnGhSyncNow) {
        dom.btnGhSyncNow.addEventListener('click', async () => {
          dom.btnGhSyncNow.disabled = true;
          dom.btnGhSyncNow.innerHTML = `<span>⏳</span> Syncing...`;
          try {
            await this.syncNow();
            alert('✅ Sync with GitHub completed successfully!');
          } catch (err) {
            alert(`❌ Sync failed: ${err.message}`);
          } finally {
            dom.btnGhSyncNow.disabled = false;
            dom.btnGhSyncNow.innerHTML = `<span>🔄</span> Sync Now (Pull & Push)`;
          }
        });
      }

      if (dom.btnGhForcePull) {
        dom.btnGhForcePull.addEventListener('click', async () => {
          if (!confirm('This will pull the latest data from GitHub and refresh your local view. Continue?')) return;
          try {
            await this.pullAll(false);
            alert('✅ Latest data loaded from GitHub!');
          } catch (err) {
            alert(`❌ Pull failed: ${err.message}`);
          }
        });
      }

      if (dom.btnGhForcePush) {
        dom.btnGhForcePush.addEventListener('click', async () => {
          if (!this.getToken()) {
            return alert('Please enter and save a GitHub Personal Access Token (PAT) first.');
          }
          if (!confirm('This will push your current returns and scans to the GitHub repository. Continue?')) return;
          try {
            await this.pushReturns();
            await this.pushScans();
            alert('✅ Data successfully pushed to GitHub!');
          } catch (err) {
            alert(`❌ Push failed: ${err.message}`);
          }
        });
      }

      if (dom.btnGhDisconnect) {
        dom.btnGhDisconnect.addEventListener('click', () => {
          if (!confirm('Disconnect token from this browser? (Data on GitHub will not be affected).')) return;
          this.setToken('');
          if (dom.ghTokenInput) dom.ghTokenInput.value = '';
          this.setStatus('default', 'Disconnected');
          alert('GitHub token removed from this browser.');
        });
      }
    },

    async init() {
      this.setupUI();
      try {
        await this.pullAll(true);
      } catch (e) {
        console.warn('Initial cloud pull failed (will use local cache):', e);
      }
    }
  };

  // --- Google Sheets Cloud Database Engine ---
  const googleSheetsSync = {
    DEFAULT_MODE: 'service_account',
    isSyncing: false,

    getMode() {
      return localStorage.getItem('gs_mode') || this.DEFAULT_MODE;
    },
    setMode(mode) {
      localStorage.setItem('gs_mode', mode);
    },
    getSheetId() {
      return (localStorage.getItem('gs_sheet_id') || '').trim();
    },
    setSheetId(id) {
      if (id) localStorage.setItem('gs_sheet_id', id.trim());
      else localStorage.removeItem('gs_sheet_id');
    },
    getAppsScriptUrl() {
      return (localStorage.getItem('gs_apps_script_url') || '').trim();
    },
    setAppsScriptUrl(url) {
      if (url) localStorage.setItem('gs_apps_script_url', url.trim());
      else localStorage.removeItem('gs_apps_script_url');
    },
    isAutoSync() {
      const v = localStorage.getItem('gs_auto_sync');
      return v === null ? true : v === 'true';
    },
    setAutoSync(enabled) {
      localStorage.setItem('gs_auto_sync', String(enabled));
    },

    extractSpreadsheetId(str) {
      if (!str) return '';
      const clean = str.trim();
      const match = clean.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
      if (match) return match[1];
      return clean;
    },

    setStatus(type, text) {
      if (dom.sheetsStatusBadge) {
        dom.sheetsStatusBadge.className = `badge badge-sheets ${type}`;
      }
      if (dom.sheetsStatusText) {
        dom.sheetsStatusText.textContent = text;
      }
      if (dom.sheetsModalStatusDot) {
        dom.sheetsModalStatusDot.style.backgroundColor =
          type === 'synced' ? '#10b981' :
          type === 'syncing' ? '#f59e0b' :
          type === 'error' ? '#ef4444' : '#10b981';
        dom.sheetsModalStatusDot.style.boxShadow =
          type === 'synced' ? '0 0 8px #10b981' :
          type === 'syncing' ? '0 0 8px #f59e0b' :
          type === 'error' ? '0 0 8px #ef4444' : '0 0 8px #10b981';
      }
      if (dom.sheetsModalStatusTitle) {
        dom.sheetsModalStatusTitle.textContent =
          type === 'synced' ? '🟢 Google Sheet Connected & Synced' :
          type === 'syncing' ? '🟡 Syncing with Google Sheet...' :
          type === 'error' ? '🔴 Connection Error: ' + text :
          '⚪ Google Sheet Storage (Not Connected)';
      }
    },

    updateModalInfo(title, lastSynced, sheetId) {
      if (dom.sheetsTitleDisplay) {
        dom.sheetsTitleDisplay.textContent = title || (sheetId ? `ID: ${sheetId.slice(0, 12)}...` : 'Connected');
      }
      if (dom.sheetsLastSyncedDisplay) {
        dom.sheetsLastSyncedDisplay.textContent = lastSynced || 'Never';
      }
      const sid = sheetId || this.getSheetId();
      if (dom.sheetsOpenLink && sid) {
        dom.sheetsOpenLink.href = `https://docs.google.com/spreadsheets/d/${sid}/edit`;
        dom.sheetsOpenLink.classList.remove('hidden');
      }
    },

    async testConnection() {
      const mode = this.getMode();
      const sheetId = this.getSheetId();
      const scriptUrl = this.getAppsScriptUrl();

      // If in service account mode or local server available:
      if (mode === 'service_account' || !clientStore.isStaticHost) {
        if (!sheetId) throw new Error('Please enter your Google Spreadsheet ID.');
        const res = await fetch('/api/sheets/test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ spreadsheetId: sheetId })
        });
        const data = await res.json();
        if (!data.connected) {
          throw new Error(data.message || 'Connection test failed.');
        }
        return data;
      } else {
        // Apps Script mode
        if (!scriptUrl) throw new Error('Please enter your Google Apps Script Web App URL.');
        const pingUrl = new URL(scriptUrl);
        pingUrl.searchParams.set('action', 'ping');
        const res = await fetch(pingUrl.toString());
        const data = await res.json();
        if (data.error || data.status !== 'ok') {
          throw new Error(data.message || 'Apps Script returned error.');
        }
        return {
          connected: true,
          title: data.title,
          spreadsheetId: data.spreadsheetId
        };
      }
    },

    async syncNow() {
      if (this.isSyncing) return;
      this.isSyncing = true;
      this.setStatus('syncing', 'Syncing...');

      try {
        const mode = this.getMode();
        const sheetId = this.getSheetId();
        const scriptUrl = this.getAppsScriptUrl();

        if (!clientStore.isStaticHost && mode === 'service_account') {
          const res = await fetch('/api/sheets/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ spreadsheetId: sheetId })
          });
          const data = await res.json();
          if (!data.success) throw new Error(data.message || 'Sync failed');
        } else if (scriptUrl) {
          // Client-side Apps Script sync
          const pingUrl = new URL(scriptUrl);
          pingUrl.searchParams.set('action', 'getData');
          const res = await fetch(pingUrl.toString());
          const remoteData = await res.json();
          if (remoteData.success) {
            const localDb1 = clientStore.getDb1();
            const localDb2 = clientStore.getDb2();
            const mergedDb1 = githubSync.mergeReturns(remoteData.returns || [], localDb1);
            const mergedDb2 = githubSync.mergeScans(remoteData.scans || [], localDb2);
            clientStore.saveDb1(mergedDb1);
            clientStore.saveDb2(mergedDb2);
          }
        }

        const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        localStorage.setItem('gs_last_synced', now);
        this.setStatus('synced', `Sheet: ${now}`);
        this.updateModalInfo(null, now, sheetId);

        updateCounts();
        if (typeof loadMissing === 'function') loadMissing();
        if (typeof loadScans === 'function') loadScans();
        if (typeof loadOverview === 'function') loadOverview();
      } catch (err) {
        console.warn('Google Sheets sync error:', err);
        this.setStatus('error', err.message);
        throw err;
      } finally {
        this.isSyncing = false;
      }
    },

    async scheduleAutoSyncScan(scanData) {
      if (!this.isAutoSync()) return;
      const mode = this.getMode();
      const scriptUrl = this.getAppsScriptUrl();
      if (mode === 'apps_script' && scriptUrl) {
        try {
          await fetch(scriptUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({ action: 'recordScan', ...scanData })
          });
        } catch (e) {
          console.warn('Apps Script scan sync error:', e);
        }
      }
    },

    async scheduleAutoSyncReturns(records) {
      if (!this.isAutoSync()) return;
      const mode = this.getMode();
      const scriptUrl = this.getAppsScriptUrl();
      if (mode === 'apps_script' && scriptUrl) {
        try {
          await fetch(scriptUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({ action: 'uploadReturns', records })
          });
        } catch (e) {
          console.warn('Apps Script returns sync error:', e);
        }
      }
    },

    async checkBackendStatus() {
      if (clientStore.isStaticHost) return;
      try {
        const res = await fetch('/api/sheets/config');
        if (res.ok) {
          const cfg = await res.json();
          if (dom.saStatusText && dom.saStatusIcon) {
            if (cfg.hasServiceAccount) {
              dom.saStatusIcon.textContent = '✅';
              dom.saStatusText.textContent = `Service Account Active (${cfg.clientEmail || 'service-account.json'})`;
              if (dom.saStatusBody) {
                dom.saStatusBody.innerHTML = `<small class="form-hint" style="color:#10b981;">✓ Ready. Share your sheet with: <code>${cfg.clientEmail || 'service account email'}</code> (Editor permission).</small>`;
              }
            } else {
              dom.saStatusIcon.textContent = '⚠️';
              dom.saStatusText.textContent = 'service-account.json not found';
              if (dom.saStatusBody) {
                dom.saStatusBody.innerHTML = `<small class="form-hint">Place your Google Cloud Service Account JSON file in <code>credentials/service-account.json</code>.</small>`;
              }
            }
          }
          if (cfg.spreadsheetId && dom.sheetsIdInput && !dom.sheetsIdInput.value) {
            dom.sheetsIdInput.value = cfg.spreadsheetId;
            this.setSheetId(cfg.spreadsheetId);
          }
        }
      } catch (e) {}
    },

    setupUI() {
      const openModal = () => {
        if (dom.sheetsModal) {
          dom.sheetsModal.classList.remove('hidden');
          if (dom.sheetsIdInput) dom.sheetsIdInput.value = this.getSheetId();
          if (dom.sheetsScriptUrlInput) dom.sheetsScriptUrlInput.value = this.getAppsScriptUrl();
          if (dom.sheetsAutoSyncCheckbox) dom.sheetsAutoSyncCheckbox.checked = this.isAutoSync();
          const last = localStorage.getItem('gs_last_synced') || 'Never';
          this.updateModalInfo(null, last, this.getSheetId());
          this.checkBackendStatus();
        }
      };

      if (dom.btnSheetsStatus) dom.btnSheetsStatus.addEventListener('click', openModal);
      if (dom.btnSheetsSync) dom.btnSheetsSync.addEventListener('click', openModal);
      if (dom.btnCloseSheetsModal) dom.btnCloseSheetsModal.addEventListener('click', () => {
        if (dom.sheetsModal) dom.sheetsModal.classList.add('hidden');
      });

      // Mode Tab Switcher
      if (dom.btnModeServiceAccount && dom.btnModeAppsScript) {
        dom.btnModeServiceAccount.addEventListener('click', () => {
          this.setMode('service_account');
          dom.btnModeServiceAccount.classList.add('active');
          dom.btnModeAppsScript.classList.remove('active');
          if (dom.modeServiceAccountFields) dom.modeServiceAccountFields.classList.remove('hidden');
          if (dom.modeAppsScriptFields) dom.modeAppsScriptFields.classList.add('hidden');
        });

        dom.btnModeAppsScript.addEventListener('click', () => {
          this.setMode('apps_script');
          dom.btnModeAppsScript.classList.add('active');
          dom.btnModeServiceAccount.classList.remove('active');
          if (dom.modeAppsScriptFields) dom.modeAppsScriptFields.classList.remove('hidden');
          if (dom.modeServiceAccountFields) dom.modeServiceAccountFields.classList.add('hidden');
        });

        if (this.getMode() === 'apps_script') {
          dom.btnModeAppsScript.click();
        }
      }

      // Copy Apps Script code
      if (dom.btnCopyAppsScript) {
        dom.btnCopyAppsScript.addEventListener('click', async () => {
          dom.btnCopyAppsScript.disabled = true;
          dom.btnCopyAppsScript.innerHTML = '<span>⏳</span> Copying...';
          try {
            const res = await fetch('google_sheets_apps_script.js');
            if (!res.ok) throw new Error(`HTTP ${res.status}: File not found`);
            const code = await res.text();

            let copied = false;
            if (navigator.clipboard && navigator.clipboard.writeText) {
              try {
                await navigator.clipboard.writeText(code);
                copied = true;
              } catch (e) {}
            }
            if (!copied) {
              const ta = document.createElement('textarea');
              ta.value = code;
              ta.style.position = 'fixed';
              ta.style.left = '-9999px';
              document.body.appendChild(ta);
              ta.focus();
              ta.select();
              document.execCommand('copy');
              document.body.removeChild(ta);
            }
            alert('📋 Google Apps Script code copied to clipboard successfully!\n\nNext steps in Google Sheet:\n1. Open your sheet and click Extensions > Apps Script\n2. Delete existing code and press Ctrl+V (Paste)\n3. Click Deploy > New deployment > Web app (Who has access: Anyone)\n4. Paste the Web App URL here.');
          } catch (e) {
            alert('Could not copy automatically (' + e.message + '). You can find the code in google_sheets_apps_script.js in the project folder.');
          } finally {
            dom.btnCopyAppsScript.disabled = false;
            dom.btnCopyAppsScript.innerHTML = '📋 Copy Script Code';
          }
        });
      }

      // Save & Test Form
      if (dom.sheetsConfigForm) {
        dom.sheetsConfigForm.addEventListener('submit', async (e) => {
          e.preventDefault();
          const rawId = dom.sheetsIdInput ? dom.sheetsIdInput.value : '';
          const sheetId = this.extractSpreadsheetId(rawId);
          const scriptUrl = dom.sheetsScriptUrlInput ? dom.sheetsScriptUrlInput.value.trim() : '';
          const autoSync = dom.sheetsAutoSyncCheckbox ? dom.sheetsAutoSyncCheckbox.checked : true;

          dom.btnSaveSheetsConfig.disabled = true;
          dom.btnSaveSheetsConfig.innerHTML = `<span>⏳</span> Testing Connection...`;

          try {
            this.setSheetId(sheetId);
            this.setAppsScriptUrl(scriptUrl);
            this.setAutoSync(autoSync);

            if (!clientStore.isStaticHost) {
              await fetch('/api/sheets/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  spreadsheetId: sheetId,
                  appsScriptUrl: scriptUrl,
                  autoSync,
                  useAppsScript: this.getMode() === 'apps_script'
                })
              });
            }

            const check = await this.testConnection();
            alert(`✅ Google Sheet Connected Successfully!\n\nSpreadsheet: ${check.title || sheetId}\nStatus: Read & Write active.`);
            await this.syncNow();
            if (dom.sheetsModal) dom.sheetsModal.classList.add('hidden');
          } catch (err) {
            alert(`❌ Connection test failed:\n${err.message}\n\nPlease verify your spreadsheet ID, permissions, or Web App URL.`);
            this.setStatus('error', err.message);
          } finally {
            dom.btnSaveSheetsConfig.disabled = false;
            dom.btnSaveSheetsConfig.innerHTML = `<span>💾</span> Save & Test Connection`;
          }
        });
      }

      // Sync Now Button
      if (dom.btnSheetsSyncNow) {
        dom.btnSheetsSyncNow.addEventListener('click', async () => {
          dom.btnSheetsSyncNow.disabled = true;
          dom.btnSheetsSyncNow.innerHTML = `<span>⏳</span> Syncing...`;
          try {
            await this.syncNow();
            alert('✅ Sync with Google Sheet completed successfully!');
          } catch (err) {
            alert(`❌ Sync failed: ${err.message}`);
          } finally {
            dom.btnSheetsSyncNow.disabled = false;
            dom.btnSheetsSyncNow.innerHTML = `<span>🔄</span> Sync Now (Bi-directional)`;
          }
        });
      }

      // Open in Google Sheets
      if (dom.btnOpenActiveSheet) {
        dom.btnOpenActiveSheet.addEventListener('click', () => {
          const sheetId = this.getSheetId();
          if (!sheetId) return alert('No Google Spreadsheet ID configured yet.');
          window.open(`https://docs.google.com/spreadsheets/d/${sheetId}/edit`, '_blank');
        });
      }

      // Disconnect
      if (dom.btnSheetsDisconnect) {
        dom.btnSheetsDisconnect.addEventListener('click', () => {
          if (!confirm('Disconnect Google Sheets from this browser? (Data in your Google Sheet will remain untouched).')) return;
          this.setSheetId('');
          this.setAppsScriptUrl('');
          if (dom.sheetsIdInput) dom.sheetsIdInput.value = '';
          if (dom.sheetsScriptUrlInput) dom.sheetsScriptUrlInput.value = '';
          this.setStatus('default', 'Google Sheets');
          alert('Google Sheets disconnected.');
        });
      }
    },

    async init() {
      this.setupUI();
      const sheetId = this.getSheetId();
      const scriptUrl = this.getAppsScriptUrl();

      if (sheetId || scriptUrl) {
        try {
          const last = localStorage.getItem('gs_last_synced') || 'Never';
          this.setStatus('synced', `Sheet: ${last}`);
          this.updateModalInfo(null, last, sheetId);
          await this.syncNow();
        } catch (e) {
          console.warn('Initial Google Sheet sync error (offline or unconfigured):', e);
        }
      } else {
        await this.checkBackendStatus();
      }
    }
  };

  // Initialize client store defaults if on static host
  clientStore.initDefaults();

  // --- DOM Elements ---
  const dom = {
    navTabs: document.querySelectorAll('.nav-tab'),
    tabViews: document.querySelectorAll('.tab-view'),
    navMissingCount: document.getElementById('nav-missing-count'),
    navScansCount: document.getElementById('nav-scans-count'),
    btnSoundToggle: document.getElementById('btn-sound-toggle'),
    soundIcon: document.getElementById('sound-icon'),
    btnMobileConnect: document.getElementById('btn-mobile-connect'),
    mobileModal: document.getElementById('mobile-modal'),
    btnCloseModal: document.getElementById('btn-close-modal'),
    mobileQrContainer: document.getElementById('mobile-qr-container'),
    mobileUrlText: document.getElementById('mobile-url-text'),
    btnCopyUrl: document.getElementById('btn-copy-url'),

    // GitHub Storage Elements
    btnGithubStatus: document.getElementById('btn-github-status'),
    githubStatusText: document.getElementById('github-status-text'),
    githubStatusBadge: document.getElementById('btn-github-status'),
    btnGithubSync: document.getElementById('btn-github-sync'),
    githubModal: document.getElementById('github-modal'),
    btnCloseGithubModal: document.getElementById('btn-close-github-modal'),
    ghModalStatusDot: document.getElementById('gh-modal-status-dot'),
    ghModalStatusTitle: document.getElementById('gh-modal-status-title'),
    ghRepoDisplay: document.getElementById('gh-repo-display'),
    ghBranchDisplay: document.getElementById('gh-branch-display'),
    ghLastSyncedDisplay: document.getElementById('gh-last-synced-display'),
    ghConfigForm: document.getElementById('gh-config-form'),
    ghTokenInput: document.getElementById('gh-token-input'),
    btnToggleTokenVisibility: document.getElementById('btn-toggle-token-visibility'),
    ghOwnerInput: document.getElementById('gh-owner-input'),
    ghRepoInput: document.getElementById('gh-repo-input'),
    ghBranchInput: document.getElementById('gh-branch-input'),
    ghAutoSyncCheckbox: document.getElementById('gh-auto-sync-checkbox'),
    btnSaveGhConfig: document.getElementById('btn-save-gh-config'),
    btnGhSyncNow: document.getElementById('btn-gh-sync-now'),
    btnGhForcePull: document.getElementById('btn-gh-force-pull'),
    btnGhForcePush: document.getElementById('btn-gh-force-push'),
    btnGhDisconnect: document.getElementById('btn-gh-disconnect'),

    // Google Sheets Elements
    btnSheetsStatus: document.getElementById('btn-sheets-status'),
    sheetsStatusText: document.getElementById('sheets-status-text'),
    sheetsStatusBadge: document.getElementById('btn-sheets-status'),
    btnSheetsSync: document.getElementById('btn-sheets-sync'),
    sheetsModal: document.getElementById('sheets-modal'),
    btnCloseSheetsModal: document.getElementById('btn-close-sheets-modal'),
    sheetsModalStatusDot: document.getElementById('sheets-modal-status-dot'),
    sheetsModalStatusTitle: document.getElementById('sheets-modal-status-title'),
    sheetsTitleDisplay: document.getElementById('sheets-title-display'),
    sheetsLastSyncedDisplay: document.getElementById('sheets-last-synced-display'),
    sheetsOpenLink: document.getElementById('sheets-open-link'),
    btnModeServiceAccount: document.getElementById('btn-mode-service-account'),
    btnModeAppsScript: document.getElementById('btn-mode-apps-script'),
    modeServiceAccountFields: document.getElementById('mode-service-account-fields'),
    modeAppsScriptFields: document.getElementById('mode-apps-script-fields'),
    sheetsIdInput: document.getElementById('sheets-id-input'),
    saStatusIcon: document.getElementById('sa-status-icon'),
    saStatusText: document.getElementById('sa-status-text'),
    saStatusBody: document.getElementById('sa-status-body'),
    sheetsScriptUrlInput: document.getElementById('sheets-script-url-input'),
    btnCopyAppsScript: document.getElementById('btn-copy-apps-script'),
    sheetsAutoSyncCheckbox: document.getElementById('sheets-auto-sync-checkbox'),
    sheetsConfigForm: document.getElementById('sheets-config-form'),
    btnSaveSheetsConfig: document.getElementById('btn-save-sheets-config'),
    btnSheetsSyncNow: document.getElementById('btn-sheets-sync-now'),
    btnOpenActiveSheet: document.getElementById('btn-open-active-sheet'),
    btnSheetsDisconnect: document.getElementById('btn-sheets-disconnect'),

    // Scanner Elements
    qrReader: document.getElementById('qr-reader'),
    cameraVideo: document.getElementById('camera-video'),
    cameraCanvas: document.getElementById('camera-canvas'),
    cameraPlaceholder: document.getElementById('camera-placeholder'),
    cameraStatusText: document.getElementById('camera-status-text'),
    btnStartCamera: document.getElementById('btn-start-camera'),
    btnToggleCamera: document.getElementById('btn-toggle-camera'),
    toggleCameraIcon: document.getElementById('toggle-camera-icon'),
    btnSwitchCamera: document.getElementById('btn-switch-camera'),
    btnTorch: document.getElementById('btn-torch'),
    filePhotoInput: document.getElementById('file-photo-input'),
    manualTrackingInput: document.getElementById('manual-tracking-input'),
    btnClearInput: document.getElementById('btn-clear-input'),
    btnManualSubmit: document.getElementById('btn-manual-submit'),

    // Scan Result Banner
    scanResultCard: document.getElementById('scan-result-card'),
    resultIcon: document.getElementById('result-icon'),
    resultBadge: document.getElementById('result-badge'),
    resultMessage: document.getElementById('result-message'),
    resultDetails: document.getElementById('result-details'),
    resTrackingId: document.getElementById('res-tracking-id'),
    resOrderId: document.getElementById('res-order-id'),
    resSku: document.getElementById('res-sku'),
    resProduct: document.getElementById('res-product'),
    resReason: document.getElementById('res-reason'),
    resTimestamp: document.getElementById('res-timestamp'),
    recentScansTbody: document.getElementById('recent-scans-tbody'),
    recentScansSummary: document.getElementById('recent-scans-summary'),

    // Missing Returns Elements
    missingHeadlineCount: document.getElementById('missing-headline-count'),
    missingSearchInput: document.getElementById('missing-search-input'),
    btnRefreshMissing: document.getElementById('btn-refresh-missing'),
    btnExportMissingCsv: document.getElementById('btn-export-missing-csv'),
    btnExportMissingExcel: document.getElementById('btn-export-missing-excel'),
    missingTableTbody: document.getElementById('missing-table-tbody'),
    missingPaginationInfo: document.getElementById('missing-pagination-info'),
    btnMissingPrev: document.getElementById('btn-missing-prev'),
    btnMissingNext: document.getElementById('btn-missing-next'),

    // Upload Elements
    fileDropzone: document.getElementById('file-dropzone'),
    excelFileInput: document.getElementById('excel-file-input'),
    btnLoadSample: document.getElementById('btn-load-sample'),
    uploadStatusCard: document.getElementById('upload-status-card'),
    uploadStatusIcon: document.getElementById('upload-status-icon'),
    uploadStatusText: document.getElementById('upload-status-text'),
    uploadPreviewContainer: document.getElementById('upload-preview-container'),
    previewRowCount: document.getElementById('preview-row-count'),
    previewTableThead: document.getElementById('preview-table-thead'),
    previewTableTbody: document.getElementById('preview-table-tbody'),
    btnConfirmImport: document.getElementById('btn-confirm-import'),

    // Scans History Elements
    scansSearchInput: document.getElementById('scans-search-input'),
    filterChips: document.querySelectorAll('.filter-chip'),
    btnRefreshScans: document.getElementById('btn-refresh-scans'),
    scansTableTbody: document.getElementById('scans-table-tbody'),
    scansPaginationInfo: document.getElementById('scans-pagination-info'),
    btnScansPrev: document.getElementById('btn-scans-prev'),
    btnScansNext: document.getElementById('btn-scans-next'),

    // Dashboard Elements
    kpiUploaded: document.getElementById('kpi-uploaded'),
    kpiScanned: document.getElementById('kpi-scanned'),
    kpiMatched: document.getElementById('kpi-matched'),
    kpiMissing: document.getElementById('kpi-missing'),
    kpiUnmatched: document.getElementById('kpi-unmatched'),
    kpiCompletion: document.getElementById('kpi-completion'),
    progressBarFill: document.getElementById('progress-bar-fill'),
    progressText: document.getElementById('progress-text'),
  };

  // ==========================================================================
  // WEB AUDIO FEEDBACK SYNTHESIZER
  // ==========================================================================
  let audioCtx = null;
  function getAudioContext() {
    if (!audioCtx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) audioCtx = new AudioContext();
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    return audioCtx;
  }

  // Success Chime (Scenario 3: Matched & Saved)
  function playSuccessChime() {
    if (!state.soundEnabled) return;
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;

      // Note 1
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(587.33, now); // D5
      gain1.gain.setValueAtTime(0.15, now);
      gain1.gain.exponentialRampToValueAtTime(0.01, now + 0.12);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.12);

      // Note 2
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(880, now + 0.1); // A5
      gain2.gain.setValueAtTime(0.18, now + 0.1);
      gain2.gain.exponentialRampToValueAtTime(0.01, now + 0.35);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(now + 0.1);
      osc2.stop(now + 0.35);
    } catch (e) {
      console.warn('Audio chime error:', e);
    }
  }

  // Warning Buzzer (Scenario 4: Not found in Flipkart DB, but saved)
  function playWarningBeep() {
    if (!state.soundEnabled) return;
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(320, now);
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.25);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.25);
    } catch (e) {
      console.warn('Audio buzzer error:', e);
    }
  }

  // Repeat Notice (Scenarios 1 & 2: Already recorded)
  function playRepeatBeep() {
    if (!state.soundEnabled) return;
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;
      
      // Double ping
      [0, 0.12].forEach(offset => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(440, now + offset);
        gain.gain.setValueAtTime(0.15, now + offset);
        gain.gain.exponentialRampToValueAtTime(0.01, now + offset + 0.08);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + offset);
        osc.stop(now + offset + 0.08);
      });
    } catch (e) {
      console.warn('Audio repeat error:', e);
    }
  }

  // Mobile Haptic Vibration
  function triggerHaptic(type) {
    if ('vibrate' in navigator) {
      if (type === 'success') navigator.vibrate([80]);
      if (type === 'warning') navigator.vibrate([150]);
      if (type === 'repeat') navigator.vibrate([60, 60, 60]);
    }
  }

  // ==========================================================================
  // NAVIGATION & TAB MANAGEMENT
  // ==========================================================================
  function switchTab(targetTabId) {
    state.activeTab = targetTabId;

    dom.navTabs.forEach(tab => {
      const isActive = tab.getAttribute('data-tab') === targetTabId;
      tab.classList.toggle('active', isActive);
    });

    dom.tabViews.forEach(view => {
      const isActive = view.id === targetTabId;
      view.classList.toggle('active', isActive);
    });

    // Refresh view data when switching tabs
    if (targetTabId === 'tab-missing') {
      loadMissingReturns();
    } else if (targetTabId === 'tab-scans') {
      loadScans();
    } else if (targetTabId === 'tab-dashboard') {
      loadDashboardStats();
    }
  }

  dom.navTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      switchTab(tab.getAttribute('data-tab'));
    });
  });

  // Sound Toggle Button
  dom.btnSoundToggle.addEventListener('click', () => {
    state.soundEnabled = !state.soundEnabled;
    dom.soundIcon.textContent = state.soundEnabled ? '🔊' : '🔇';
    dom.btnSoundToggle.title = state.soundEnabled ? 'Sound feedback ON' : 'Sound feedback MUTED';
    if (state.soundEnabled) playSuccessChime();
  });

  // ==========================================================================
  // SCANNER ENGINE (CAMERA & BARCODE / QR DETECTION)
  // ==========================================================================
  // ==========================================================================
  // SCANNER ENGINE (CAMERA & BARCODE / DATA MATRIX / QR DETECTION)
  // ==========================================================================
  let zxMultiReader = null;
  function getZxingMultiReader() {
    if (!zxMultiReader && typeof ZXing !== 'undefined') {
      try {
        const hints = new Map();
        hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [
          ZXing.BarcodeFormat.DATA_MATRIX,
          ZXing.BarcodeFormat.CODE_128,
          ZXing.BarcodeFormat.QR_CODE,
          ZXing.BarcodeFormat.CODE_39,
          ZXing.BarcodeFormat.CODE_93,
          ZXing.BarcodeFormat.EAN_13,
          ZXing.BarcodeFormat.EAN_8,
          ZXing.BarcodeFormat.PDF_417,
          ZXing.BarcodeFormat.ITF,
          ZXing.BarcodeFormat.AZTEC
        ]);
        hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
        zxMultiReader = new ZXing.MultiFormatReader();
        zxMultiReader.setHints(hints);
      } catch (e) {
        console.warn('ZXing multi-reader init warning:', e);
      }
    }
    return zxMultiReader;
  }

  // Multi-pass Canvas Decoder using ZXing
  // Pass 1: GlobalHistogramBinarizer (vital for Flipkart thermal labels & dense Data Matrix)
  // Pass 2: HybridBinarizer (standard for sharp 1D/2D barcodes)
  // Pass 3: Inverted Luminance (for dark-background labels or inverted prints)
  function decodeCanvasWithZxing(canvas) {
    if (!canvas || typeof ZXing === 'undefined') return null;
    const reader = getZxingMultiReader();
    if (!reader) return null;

    try {
      const lumSource = new ZXing.HTMLCanvasElementLuminanceSource(canvas);

      // 1. GlobalHistogramBinarizer (proven to decode Flipkart Data Matrix)
      try {
        const bitmapGlobal = new ZXing.BinaryBitmap(new ZXing.GlobalHistogramBinarizer(lumSource));
        const res = reader.decodeWithState(bitmapGlobal);
        if (res && res.getText()) return res.getText();
      } catch (e) {}
      reader.reset();

      // 2. HybridBinarizer (standard barcodes)
      try {
        const bitmapHybrid = new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(lumSource));
        const res = reader.decodeWithState(bitmapHybrid);
        if (res && res.getText()) return res.getText();
      } catch (e) {}
      reader.reset();

      // 3. Inverted Luminance (white-on-dark barcodes)
      try {
        const invSource = new ZXing.InvertedLuminanceSource(lumSource);
        const bitmapInv = new ZXing.BinaryBitmap(new ZXing.GlobalHistogramBinarizer(invSource));
        const res = reader.decodeWithState(bitmapInv);
        if (res && res.getText()) return res.getText();
      } catch (e) {}
      reader.reset();
    } catch (err) {}

    return null;
  }

  async function initBarcodeDetector() {
    getZxingMultiReader();
    if ('BarcodeDetector' in window) {
      try {
        const supportedFormats = await BarcodeDetector.getSupportedFormats();
        state.barcodeDetector = new BarcodeDetector({
          formats: supportedFormats.length ? supportedFormats : [
            'data_matrix', 'qr_code', 'code_128', 'code_39', 'code_93', 
            'ean_13', 'ean_8', 'pdf417', 'upc_a', 'upc_e', 'itf', 'aztec'
          ]
        });
        return true;
      } catch (e) {
        console.warn('BarcodeDetector initialization warning:', e);
      }
    }
    return false;
  }

  // Helper to extract clean tracking ID from complex QR codes, Data Matrix or logistics URLs
  function extractTrackingId(raw) {
    if (!raw) return '';
    let str = String(raw).trim();

    // 1. If scanned code is a URL (e.g., https://ekartlogistics.com/.../FMPP009812451)
    if (str.startsWith('http://') || str.startsWith('https://')) {
      try {
        const parsed = new URL(str);
        const parts = parsed.pathname.split('/').filter(Boolean);
        if (parts.length > 0) {
          const last = parts[parts.length - 1];
          if (last && last.length >= 6) return last.trim();
        }
      } catch (e) {}
    }

    // 2. If barcode/DataMatrix contains pipe, tab, comma, semicolon, or newline delimiter
    // Example: 5|\MB-7600436865430300|O|NCR/NDC|S|D|03|E|S|F|6A
    if (str.includes('|') || str.includes('\t') || str.includes(',') || str.includes(';') || str.includes('\n')) {
      const parts = str.split(/[|\t,;\n\r]+/).map(p => {
        // Strip non-alphanumeric leading/trailing characters (like \ / # @ " ' spaces)
        return p.replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, '').trim();
      }).filter(Boolean);

      const trackingRegex = /^[A-Z0-9_\-\.\/]{7,35}$/i;
      const candidates = parts.filter(p => trackingRegex.test(p) && /\d/.test(p) && !p.toLowerCase().startsWith('http'));
      if (candidates.length > 0) {
        const best = candidates.find(c => /^(FMP|OD|LST|TRACK|DEL|EKT|EKART|MB|AWB)/i.test(c))
                  || candidates.sort((a, b) => b.length - a.length)[0];
        return best;
      }
    }

    // Strip leading/trailing symbols from simple raw strings
    return str.replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, '').trim() || str;
  }

  function setScannerStatus(msg, type = 'active') {
    const hint = document.getElementById('scanner-hud-text');
    if (!hint) return;
    hint.textContent = msg;
    if (type === 'success') {
      hint.style.color = '#4ade80';
    } else if (type === 'error') {
      hint.style.color = '#f87171';
    } else {
      hint.style.color = '#94a3b8';
    }
  }

  // Offscreen helper canvases for high-res scanning and center-region crop
  let centerCropCanvas = null;
  function getCenterCropCanvas(source, vWidth, vHeight) {
    if (!centerCropCanvas) {
      centerCropCanvas = document.createElement('canvas');
    }
    const size = Math.floor(Math.min(vWidth, vHeight) * 0.65);
    const sx = Math.floor((vWidth - size) / 2);
    const sy = Math.floor((vHeight - size) / 2);
    if (centerCropCanvas.width !== size || centerCropCanvas.height !== size) {
      centerCropCanvas.width = size;
      centerCropCanvas.height = size;
    }
    const cCtx = centerCropCanvas.getContext('2d', { willReadFrequently: true });
    cCtx.drawImage(source, sx, sy, size, size, 0, 0, size, size);
    return centerCropCanvas;
  }

  let lastScanTimestamp = 0;
  const SCAN_INTERVAL_MS = 90; // ~11 scans per second for smooth video and zero lag

  async function startCamera() {
    try {
      dom.cameraStatusText.textContent = 'Requesting camera access...';

      // Check if browser context is insecure (mobile browser on http://IP:3000)
      const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
      const isHttps = window.location.protocol === 'https:';

      if (!isLocalhost && !isHttps) {
        const httpsUrl = `https://${window.location.hostname}:3443`;
        dom.cameraPlaceholder.classList.remove('hidden');
        dom.cameraStatusText.innerHTML = `
          <div style="padding:10px; max-width:320px; margin:0 auto; text-align:center;">
            <div style="font-size:2rem; margin-bottom:4px;">🔒</div>
            <h4 style="color:#38bdf8; font-size:1.05rem; margin-bottom:6px;">Mobile Live Camera Needs HTTPS</h4>
            <p style="font-size:0.82rem; color:#94a3b8; margin-bottom:14px; line-height:1.4;">
              Mobile Chrome/Safari blocks live camera on plain HTTP. Please switch to HTTPS (Port 3443) or use Photo Mode.
            </p>
            <div style="display:flex; flex-direction:column; gap:8px;">
              <a href="${httpsUrl}" class="btn-primary" style="text-decoration:none; justify-content:center;">
                <span>🔒</span> Switch to HTTPS (${window.location.hostname}:3443)
              </a>
              <button type="button" class="btn-secondary" onclick="document.getElementById('file-photo-input').click()">
                <span>📸</span> Snap Photo Instead (No HTTPS Needed)
              </button>
            </div>
            <p style="font-size:0.72rem; color:#64748b; margin-top:10px;">
              *On HTTPS, tap <em>"Advanced" &rarr; "Proceed"</em> to trust the local SSL cert.
            </p>
          </div>
        `;
        return;
      }

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Camera device not detected or camera streaming is not supported by your browser.');
      }

      // Stop any existing stream
      if (state.cameraStream) {
        state.cameraStream.getTracks().forEach(t => t.stop());
        state.cameraStream = null;
      }

      if (dom.qrReader) dom.qrReader.style.display = 'none';
      dom.cameraVideo.style.display = 'block';
      dom.cameraVideo.setAttribute('playsinline', 'true');
      dom.cameraVideo.setAttribute('webkit-playsinline', 'true');
      dom.cameraVideo.setAttribute('muted', 'true');
      dom.cameraVideo.setAttribute('autoplay', 'true');
      dom.cameraVideo.playsInline = true;
      dom.cameraVideo.muted = true;
      dom.cameraVideo.autoplay = true;

      setScannerStatus('Opening camera lens...', 'active');

      let stream = null;
      // High-resolution constraints (1080p ideal) ensures high-density Data Matrix modules are crisp
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: state.currentFacingMode },
            width: { ideal: 1920, min: 1280 },
            height: { ideal: 1080, min: 720 }
          },
          audio: false
        });
      } catch (e1) {
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: state.currentFacingMode },
            audio: false
          });
        } catch (e2) {
          stream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: false
          });
        }
      }

      state.cameraStream = stream;
      dom.cameraVideo.srcObject = stream;

      await new Promise(resolve => {
        if (dom.cameraVideo.videoWidth > 0) {
          resolve();
        } else {
          const onReady = () => {
            dom.cameraVideo.removeEventListener('loadedmetadata', onReady);
            dom.cameraVideo.removeEventListener('canplay', onReady);
            resolve();
          };
          dom.cameraVideo.addEventListener('loadedmetadata', onReady);
          dom.cameraVideo.addEventListener('canplay', onReady);
          setTimeout(resolve, 800);
        }
      });

      try { await dom.cameraVideo.play(); } catch (e) {}

      dom.cameraPlaceholder.classList.add('hidden');
      dom.toggleCameraIcon.textContent = '⏹️';
      dom.btnToggleCamera.innerHTML = `<span>⏹️</span> Stop Camera`;
      setScannerStatus('Point camera at Data Matrix, Barcode or QR', 'active');

      // Check hardware torch & continuous autofocus capabilities
      try {
        const track = stream.getVideoTracks()[0];
        if (track && track.getCapabilities) {
          const caps = track.getCapabilities();
          if (caps.torch) {
            dom.btnTorch.classList.remove('hidden');
          }
          if (caps.focusMode && Array.isArray(caps.focusMode) && caps.focusMode.includes('continuous')) {
            try {
              await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
            } catch (fErr) {}
          }
        }
      } catch (e) {}

      // Apply initial zoom setting
      applyZoom(state.currentZoom);

      state.scanLoopActive = true;
      lastScanTimestamp = 0;
      requestAnimationFrame(scanDirectFrame);

    } catch (err) {
      console.error('Camera Start Error:', err);
      dom.cameraPlaceholder.classList.remove('hidden');
      setScannerStatus('Camera access error', 'error');
      dom.cameraStatusText.innerHTML = `
        <div style="padding:10px; max-width:320px; margin:0 auto; text-align:center;">
          <div style="font-size:2rem; margin-bottom:4px;">📷</div>
          <h4 style="color:#f87171; font-size:1.05rem; margin-bottom:6px;">Camera Access Blocked</h4>
          <p style="font-size:0.82rem; color:#94a3b8; margin-bottom:12px; line-height:1.4;">
            ${err.name === 'NotAllowedError' ? 'Camera permission was denied. Please allow camera access in browser site settings.' : (err.message || 'Unable to start camera stream.')}
          </p>
          <button type="button" class="btn-accent" onclick="document.getElementById('file-photo-input').click()" style="width:100%; justify-content:center;">
            <span>📸</span> Snap Photo / Upload Image
          </button>
        </div>
      `;
    }
  }

  async function scanDirectFrame(timestamp) {
    if (!state.scanLoopActive) return;

    if (dom.cameraVideo && !dom.cameraVideo.paused && dom.cameraVideo.videoWidth > 0 && dom.cameraVideo.videoHeight > 0) {
      // Throttle decode invocations to keep CPU usage low and video smooth
      if (!timestamp || timestamp - lastScanTimestamp >= SCAN_INTERVAL_MS) {
        lastScanTimestamp = timestamp || performance.now();

        const vWidth = dom.cameraVideo.videoWidth;
        const vHeight = dom.cameraVideo.videoHeight;
        const canvas = dom.cameraCanvas;
        if (canvas.width !== vWidth || canvas.height !== vHeight) {
          canvas.width = vWidth;
          canvas.height = vHeight;
        }
        const ctx = canvas.getContext('2d', { willReadFrequently: true });

        // Apply digital zoom crop on processing canvas
        if (state.currentZoom > 1.0) {
          const cropW = vWidth / state.currentZoom;
          const cropH = vHeight / state.currentZoom;
          const cropX = (vWidth - cropW) / 2;
          const cropY = (vHeight - cropH) / 2;
          ctx.drawImage(dom.cameraVideo, cropX, cropY, cropW, cropH, 0, 0, vWidth, vHeight);
        } else {
          ctx.drawImage(dom.cameraVideo, 0, 0, vWidth, vHeight);
        }

        let found = null;

        // 1. Native BarcodeDetector (Chrome/Edge/Android - native C++ MLKit speed)
        if (!found && state.barcodeDetector) {
          try {
            const barcodes = await state.barcodeDetector.detect(canvas);
            if (barcodes && barcodes.length > 0 && barcodes[0].rawValue) {
              found = barcodes[0].rawValue.trim();
            }
          } catch (bErr) {}
        }

        // 2. ZXing MultiFormat Reader with GlobalHistogramBinarizer (vital for Flipkart Data Matrix)
        if (!found && typeof ZXing !== 'undefined') {
          found = decodeCanvasWithZxing(canvas);
        }

        // 3. Center Crop Pass (extracts the sharp central 65% reticle region for small/dense codes)
        if (!found && typeof ZXing !== 'undefined' && vWidth >= 700) {
          const cropCanvas = getCenterCropCanvas(dom.cameraVideo, vWidth, vHeight);
          found = decodeCanvasWithZxing(cropCanvas);
        }

        // 4. jsQR fallback (for QR codes on iOS Safari)
        if (!found && typeof jsQR !== 'undefined') {
          try {
            const sampleW = Math.min(vWidth, 800);
            const sampleH = Math.min(vHeight, 800);
            const imgData = ctx.getImageData(0, 0, sampleW, sampleH);
            const qr = jsQR(imgData.data, imgData.width, imgData.height, { inversionAttempts: 'attemptBoth' });
            if (qr && qr.data && qr.data.trim()) {
              found = qr.data.trim();
            }
          } catch (qErr) {}
        }

        if (found) {
          const cleanId = extractTrackingId(found);
          setScannerStatus(`✅ Scanned: ${cleanId}`, 'success');
          handleDetectedCode(cleanId);
        }
      }
    }

    if (state.scanLoopActive) {
      requestAnimationFrame(scanDirectFrame);
    }
  }

  async function stopCamera() {
    state.scanLoopActive = false;
    state.torchActive = false;
    if (state.cameraStream) {
      state.cameraStream.getTracks().forEach(track => track.stop());
      state.cameraStream = null;
    }
    if (dom.cameraVideo) {
      dom.cameraVideo.srcObject = null;
      dom.cameraVideo.style.display = 'none';
      dom.cameraVideo.style.transform = 'none';
    }
    if (dom.qrReader) {
      dom.qrReader.style.display = 'none';
    }
    dom.cameraPlaceholder.classList.remove('hidden');
    dom.cameraStatusText.textContent = 'Camera stopped';
    dom.toggleCameraIcon.textContent = '▶️';
    dom.btnToggleCamera.innerHTML = `<span>▶️</span> Start Camera`;
    dom.btnTorch.classList.add('hidden');
    dom.btnTorch.innerHTML = `<span>💡</span> Torch`;
    setScannerStatus('Camera stopped', 'idle');
  }

  async function switchCamera() {
    state.currentFacingMode = state.currentFacingMode === 'environment' ? 'user' : 'environment';
    if (state.scanLoopActive) {
      await stopCamera();
      await startCamera();
    }
  }

  async function toggleTorch() {
    state.torchActive = !state.torchActive;
    if (state.cameraStream) {
      const track = state.cameraStream.getVideoTracks()[0];
      if (track) {
        try {
          await track.applyConstraints({ advanced: [{ torch: state.torchActive }] });
          dom.btnTorch.innerHTML = state.torchActive ? '<span>⚡</span> Torch ON' : '<span>💡</span> Torch';
        } catch (e) {
          console.warn('Torch toggle error:', e);
        }
      }
    }
  }

  // Zoom & Refocus Controller
  state.currentZoom = 1.0;

  async function applyZoom(level) {
    state.currentZoom = level;
    // 1. Hardware digital zoom on track if supported
    if (state.cameraStream) {
      const track = state.cameraStream.getVideoTracks()[0];
      if (track) {
        try {
          await track.applyConstraints({ advanced: [{ zoom: level }] });
        } catch (e) {}
      }
    }
    // 2. CSS Magnification zoom on video viewport
    if (dom.cameraVideo) {
      dom.cameraVideo.style.transform = level > 1 ? `scale(${level})` : 'none';
      dom.cameraVideo.style.transformOrigin = 'center center';
      dom.cameraVideo.style.transition = 'transform 0.2s ease-out';
    }
    // Update zoom pill UI
    document.querySelectorAll('.zoom-btn').forEach(btn => {
      btn.classList.toggle('active', parseFloat(btn.dataset.zoom) === level);
    });
    setScannerStatus(`Zoom: ${level}x | Hold 20–25cm away`, 'active');
  }

  async function triggerRefocus(x = null, y = null) {
    setScannerStatus('Refocusing camera...', 'active');
    const ring = document.getElementById('tap-focus-ring');
    if (ring && x !== null && y !== null) {
      ring.style.left = `${x}px`;
      ring.style.top = `${y}px`;
      ring.classList.remove('hidden', 'focused');
      setTimeout(() => ring.classList.add('focused'), 200);
      setTimeout(() => ring.classList.add('hidden'), 700);
    }

    if (state.cameraStream) {
      const track = state.cameraStream.getVideoTracks()[0];
      if (track) {
        try {
          await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
        } catch (e) {}
      }
    }
    setTimeout(() => setScannerStatus('Scanning for Data Matrix, Barcode or QR...', 'active'), 500);
  }

  // Handle Photo / File snapshot scanning (ZXing GlobalHistogram + BarcodeDetector + jsQR)
  dom.filePhotoInput.addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    try {
      setScannerStatus('Analyzing photo for barcodes...', 'active');
      let detectedText = null;

      // Load image into HTML Image object
      const img = new Image();
      await new Promise((res, rej) => {
        img.onload = res;
        img.onerror = rej;
        img.src = URL.createObjectURL(file);
      });

      const pCanvas = document.createElement('canvas');
      const pCtx = pCanvas.getContext('2d', { willReadFrequently: true });
      let w = img.naturalWidth || img.width;
      let h = img.naturalHeight || img.height;
      pCanvas.width = w;
      pCanvas.height = h;
      pCtx.drawImage(img, 0, 0, w, h);

      // 1. Try Native BarcodeDetector (Chrome / Android)
      if (!detectedText && state.barcodeDetector) {
        try {
          const barcodes = await state.barcodeDetector.detect(pCanvas);
          if (barcodes && barcodes.length > 0 && barcodes[0].rawValue) {
            detectedText = barcodes[0].rawValue.trim();
          }
        } catch (bErr) {}
      }

      // 2. Try ZXing with GlobalHistogramBinarizer on full image
      if (!detectedText && typeof ZXing !== 'undefined') {
        detectedText = decodeCanvasWithZxing(pCanvas);
      }

      // 3. If high-resolution photo (> 1200px), try downscaled version (1200px max)
      // This is crucial for iPhone 48MP photos where massive image size can cause detection timeouts
      if (!detectedText && (w > 1200 || h > 1200) && typeof ZXing !== 'undefined') {
        const scaledCanvas = document.createElement('canvas');
        const scale = 1200 / Math.max(w, h);
        scaledCanvas.width = Math.round(w * scale);
        scaledCanvas.height = Math.round(h * scale);
        const sCtx = scaledCanvas.getContext('2d', { willReadFrequently: true });
        sCtx.drawImage(img, 0, 0, scaledCanvas.width, scaledCanvas.height);
        detectedText = decodeCanvasWithZxing(scaledCanvas);
      }

      // 4. Try center crop of the photo (if label is centered)
      if (!detectedText && typeof ZXing !== 'undefined' && (w >= 600 && h >= 600)) {
        const cropC = getCenterCropCanvas(pCanvas, w, h);
        detectedText = decodeCanvasWithZxing(cropC);
      }

      // 5. Try jsQR on canvas (pure QR fallback)
      if (!detectedText && typeof jsQR !== 'undefined') {
        try {
          const imgData = pCtx.getImageData(0, 0, Math.min(w, 1000), Math.min(h, 1000));
          const qr = jsQR(imgData.data, imgData.width, imgData.height, { inversionAttempts: 'attemptBoth' });
          if (qr && qr.data && qr.data.trim()) {
            detectedText = qr.data.trim();
          }
        } catch (qErr) {}
      }

      if (detectedText) {
        const cleanId = extractTrackingId(detectedText);
        setScannerStatus(`✅ Scanned: ${cleanId}`, 'success');
        handleDetectedCode(cleanId);
      } else {
        setScannerStatus('No code detected in photo', 'error');
        alert('No barcode or Data Matrix / QR code detected. Please ensure clear lighting and take a close-up photo of the shipping label.');
      }
    } catch (err) {
      alert('Failed to process image: ' + err.message);
    }
    dom.filePhotoInput.value = '';
  });

  // Rate-limiting / deduplication guard for camera
  function handleDetectedCode(code) {
    if (!code || !String(code).trim()) return;
    const cleanCode = String(code).trim();
    const now = Date.now();

    // Check cooldown for identical code
    if (cleanCode === state.lastScannedCode && (now - state.lastScanTime) < state.scanCooldownMs) {
      return;
    }

    state.lastScannedCode = cleanCode;
    state.lastScanTime = now;

    // Send to backend verification & recording engine
    submitScan(cleanCode, 'camera');
  }

  // Camera Control Listeners
  dom.btnStartCamera.addEventListener('click', () => {
    getAudioContext();
    startCamera();
  });
  dom.btnToggleCamera.addEventListener('click', () => {
    getAudioContext();
    if (state.scanLoopActive || state.cameraStream) {
      stopCamera();
    } else {
      startCamera();
    }
  });
  dom.btnSwitchCamera.addEventListener('click', switchCamera);
  dom.btnTorch.addEventListener('click', toggleTorch);

  const btnRefocus = document.getElementById('btn-refocus');
  if (btnRefocus) {
    btnRefocus.addEventListener('click', () => triggerRefocus());
  }

  // Zoom button listeners
  document.querySelectorAll('.zoom-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const z = parseFloat(btn.dataset.zoom) || 1.0;
      applyZoom(z);
    });
  });

  // Tap-to-focus on camera viewfinder
  const cameraContainer = document.getElementById('camera-container');
  if (cameraContainer) {
    cameraContainer.addEventListener('click', (e) => {
      if (e.target.closest('.zoom-btn') || e.target.closest('.zoom-controls-pill') || e.target.closest('button')) return;
      const rect = cameraContainer.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      triggerRefocus(x, y);
    });
  }

  // Manual Tracking ID input handling
  dom.manualTrackingInput.addEventListener('input', () => {
    dom.btnClearInput.classList.toggle('hidden', !dom.manualTrackingInput.value);
  });

  dom.btnClearInput.addEventListener('click', () => {
    dom.manualTrackingInput.value = '';
    dom.btnClearInput.classList.add('hidden');
    dom.manualTrackingInput.focus();
  });

  dom.manualTrackingInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      dom.btnManualSubmit.click();
    }
  });

  dom.btnManualSubmit.addEventListener('click', () => {
    const val = dom.manualTrackingInput.value.trim();
    if (!val) return;
    getAudioContext();
    submitScan(val, 'manual');
    dom.manualTrackingInput.value = '';
    dom.btnClearInput.classList.add('hidden');
  });

  // ==========================================================================
  // SCAN SUBMISSION & THE 4 VERIFICATION SCENARIOS
  // ==========================================================================
  async function submitScan(trackingId, source = 'camera') {
    try {
      let data = null;
      if (clientStore.isStaticHost) {
        data = clientStore.processScan(trackingId, source);
      } else {
        try {
          const res = await fetch('/api/scan', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tracking_id: trackingId, source })
          });
          data = await res.json();
          if (!res.ok || data.error) {
            throw new Error(data.message || 'Scan processing failed');
          }
        } catch (fetchErr) {
          data = clientStore.processScan(trackingId, source);
        }
      }

      // Render the result based on the 4 scenarios
      renderScanResult(data);

      // Add to recent scans session list
      addRecentScan(data);

      // Refresh missing counter in navigation
      updateCounts();

      // Trigger background auto-sync to GitHub
      if (typeof githubSync !== 'undefined') {
        githubSync.scheduleAutoSyncScans();
      }
      // Trigger background auto-sync to Google Sheets
      if (typeof googleSheetsSync !== 'undefined') {
        googleSheetsSync.scheduleAutoSyncScan(data);
      }
    } catch (err) {
      console.error('Scan processing error:', err);
      alert('Error recording scan: ' + err.message);
    }
  }

  /**
   * Render dynamic result card matching the exact 4 scenarios requested:
   * 
   * Scenario 1: Found in DB2 AND Found in DB1
   *   -> "Already recorded on [date/time]" + Flipkart Details
   * 
   * Scenario 2: Found in DB2 AND NOT found in DB1
   *   -> "Already recorded on [date/time], but not found in 1st database"
   * 
   * Scenario 3: First Scan (NOT in DB2) AND Found in DB1
   *   -> Save to DB2. "Tracking ID matched! Saved to scanned database on [date/time]" + Details
   * 
   * Scenario 4: First Scan (NOT in DB2) AND NOT found in DB1
   *   -> Save to DB2. "Tracking ID not found in 1st database, but saved in 2nd database with timestamp [date/time]"
   */
  function renderScanResult(data) {
    const card = dom.scanResultCard;
    card.className = 'result-card'; // Reset classes
    card.classList.remove('hidden');

    const flip = data.flipkart_data;

    // Reset details
    dom.resultDetails.classList.add('hidden');

    if (data.scenario === 3) {
      // SCENARIO 3: First Scan + Found in DB1 (Green / Verified)
      card.classList.add('status-matched');
      dom.resultIcon.textContent = '✅';
      dom.resultBadge.textContent = 'STATUS: MARKED UPDATED & RECEIVED';
      dom.resultMessage.textContent = data.message;
      playSuccessChime();
      triggerHaptic('success');
      showFlipkartDetails(data.tracking_id, flip, data.recorded_at);

    } else if (data.scenario === 4) {
      // SCENARIO 4: First Scan + NOT found in DB1 (Warning / Yellow)
      card.classList.add('status-unmatched');
      dom.resultIcon.textContent = '⚠️';
      dom.resultBadge.textContent = 'STATUS: UNLISTED PACKAGE (UPDATED)';
      dom.resultMessage.textContent = data.message;
      playWarningBeep();
      triggerHaptic('warning');
      showFlipkartDetails(data.tracking_id, null, data.recorded_at);

    } else if (data.scenario === 1) {
      // SCENARIO 1: Already Scanned + Found in DB1 (Info / Blue)
      card.classList.add('status-repeat-matched');
      dom.resultIcon.textContent = 'ℹ️';
      dom.resultBadge.textContent = 'STATUS: ALREADY UPDATED';
      dom.resultMessage.textContent = data.message;
      playRepeatBeep();
      triggerHaptic('repeat');
      showFlipkartDetails(data.tracking_id, flip, data.recorded_at);

    } else if (data.scenario === 2) {
      // SCENARIO 2: Already Scanned + NOT found in DB1 (Orange)
      card.classList.add('status-repeat-unmatched');
      dom.resultIcon.textContent = '🔁';
      dom.resultBadge.textContent = 'STATUS: ALREADY RECORDED (UNLISTED)';
      dom.resultMessage.textContent = data.message;
      playRepeatBeep();
      triggerHaptic('repeat');
      showFlipkartDetails(data.tracking_id, null, data.recorded_at);
    }
  }

  function showFlipkartDetails(trackingId, flip, timestamp) {
    dom.resultDetails.classList.remove('hidden');
    dom.resTrackingId.textContent = trackingId;
    dom.resTimestamp.textContent = timestamp || '-';

    if (flip) {
      dom.resOrderId.textContent = flip.order_id || 'N/A';
      dom.resSku.textContent = flip.sku || 'N/A';
      dom.resProduct.textContent = flip.product_name || 'Flipkart Product';
      dom.resReason.textContent = flip.return_reason || 'Return requested';
    } else {
      dom.resOrderId.textContent = 'Not in Flipkart manifest';
      dom.resSku.textContent = '-';
      dom.resProduct.textContent = 'Package not listed in Flipkart Return Records';
      dom.resReason.textContent = 'Unknown / Extra Package';
    }
  }

  function addRecentScan(data) {
    state.recentScans.unshift(data);
    if (state.recentScans.length > 20) state.recentScans.pop();

    dom.recentScansSummary.textContent = `${state.recentScans.length} scans this session`;

    let html = '';
    state.recentScans.forEach(item => {
      let badgeClass = 'badge-success';
      let statusLabel = 'Matched';

      if (item.scenario === 4) {
        badgeClass = 'badge-warning';
        statusLabel = 'Not in Flipkart Return Records';
      } else if (item.scenario === 1) {
        badgeClass = 'badge-info';
        statusLabel = 'Repeat (Matched)';
      } else if (item.scenario === 2) {
        badgeClass = 'badge-warning';
        statusLabel = 'Repeat (Not in Flipkart Return Records)';
      }

      const flip = item.flipkart_data;
      const orderId = flip ? flip.order_id : '-';
      const product = flip ? flip.product_name : '<span class="text-orange">Unlisted return</span>';

      html += `
        <tr>
          <td class="tracking-cell">${escapeHtml(item.tracking_id)}</td>
          <td><span class="badge ${badgeClass}">${statusLabel}</span></td>
          <td>${escapeHtml(orderId)}</td>
          <td>${product}</td>
          <td><small>${escapeHtml(item.recorded_at)}</small></td>
        </tr>
      `;
    });

    dom.recentScansTbody.innerHTML = html;
  }

  // ==========================================================================
  // MISSING / PENDING RETURNS (CORE FEATURE)
  // ==========================================================================
  let missingSearchTimeout = null;

  async function loadMissingReturns() {
    dom.missingTableTbody.innerHTML = `
      <tr class="loading-row"><td colspan="8">Loading pending returns...</td></tr>
    `;

    try {
      let data = null;
      if (clientStore.isStaticHost) {
        data = clientStore.getMissing({ search: state.missingSearch, page: state.missingPage, limit: 25 });
      } else {
        try {
          const q = encodeURIComponent(state.missingSearch);
          const res = await fetch(`/api/missing?search=${q}&page=${state.missingPage}&limit=25`);
          data = await res.json();
        } catch (fetchErr) {
          data = clientStore.getMissing({ search: state.missingSearch, page: state.missingPage, limit: 25 });
        }
      }

      dom.missingHeadlineCount.textContent = data.total;
      dom.navMissingCount.textContent = data.total;

      if (!data.rows || data.rows.length === 0) {
        dom.missingTableTbody.innerHTML = `
          <tr class="empty-row">
            <td colspan="8">
              🎉 <strong>No pending returns found!</strong> All uploaded returns have been received or no records match your filter.
            </td>
          </tr>
        `;
        dom.missingPaginationInfo.textContent = 'Showing 0 of 0';
        dom.btnMissingPrev.disabled = true;
        dom.btnMissingNext.disabled = true;
        return;
      }

      let html = '';
      data.rows.forEach(row => {
        const days = Number(row.days_pending || 0);
        const daysBadge = days > 5 
          ? `<span class="days-badge days-delayed">${days} days</span>` 
          : `<span class="days-badge days-fresh">${days} days</span>`;

        html += `
          <tr>
            <td class="tracking-cell">${escapeHtml(row.tracking_id)}</td>
            <td>${escapeHtml(row.order_id || '-')}</td>
            <td><small>${escapeHtml(row.sku || '-')}</small></td>
            <td><strong>${escapeHtml(row.product_name || '-')}</strong></td>
            <td><span class="text-red">${escapeHtml(row.return_reason || '-')}</span></td>
            <td>${escapeHtml(row.return_date || '-')}</td>
            <td>${daysBadge}</td>
            <td>
              <button class="btn-primary-sm btn-quick-scan" data-id="${escapeHtml(row.tracking_id)}">
                ✓ Mark Updated
              </button>
            </td>
          </tr>
        `;
      });

      dom.missingTableTbody.innerHTML = html;

      // Attach quick scan buttons
      document.querySelectorAll('.btn-quick-scan').forEach(btn => {
        btn.addEventListener('click', () => {
          const id = btn.getAttribute('data-id');
          submitScan(id, 'manual');
          setTimeout(loadMissingReturns, 300);
        });
      });

      // Pagination
      const from = (data.page - 1) * data.limit + 1;
      const to = Math.min(data.page * data.limit, data.total);
      dom.missingPaginationInfo.textContent = `Showing ${from} - ${to} of ${data.total} pending returns`;
      dom.btnMissingPrev.disabled = data.page <= 1;
      dom.btnMissingNext.disabled = data.page >= data.totalPages;

    } catch (err) {
      console.error('Missing returns fetch error:', err);
      dom.missingTableTbody.innerHTML = `
        <tr class="empty-row"><td colspan="8" style="color:#f87171">Failed to load missing returns: ${err.message}</td></tr>
      `;
    }
  }

  dom.missingSearchInput.addEventListener('input', () => {
    clearTimeout(missingSearchTimeout);
    missingSearchTimeout = setTimeout(() => {
      state.missingSearch = dom.missingSearchInput.value.trim();
      state.missingPage = 1;
      loadMissingReturns();
    }, 300);
  });

  dom.btnRefreshMissing.addEventListener('click', loadMissingReturns);
  dom.btnMissingPrev.addEventListener('click', () => {
    if (state.missingPage > 1) {
      state.missingPage--;
      loadMissingReturns();
    }
  });
  dom.btnMissingNext.addEventListener('click', () => {
    state.missingPage++;
    loadMissingReturns();
  });

  // Export Missing CSV
  dom.btnExportMissingCsv.addEventListener('click', () => {
    window.location.href = '/api/export-missing-csv';
  });

  // Export Missing Excel (.XLSX)
  if (dom.btnExportMissingExcel) {
    dom.btnExportMissingExcel.addEventListener('click', async () => {
      try {
        const res = await fetch('/api/missing?limit=5000');
        const data = await res.json();
        if (!data.rows || data.rows.length === 0) {
          alert('No pending returns to export.');
          return;
        }

        const exportData = data.rows.map(r => ({
          'Tracking ID': r.tracking_id,
          'Order ID': r.order_id || '',
          'SKU': r.sku || '',
          'Product Name': r.product_name || '',
          'Return Reason': r.return_reason || '',
          'Return Type': r.return_type || '',
          'Return Date': r.return_date || '',
          'Customer Name': r.customer_name || '',
          'Days Pending': r.days_pending || 0,
          'Status': 'PENDING'
        }));

        if (typeof XLSX !== 'undefined') {
          const ws = XLSX.utils.json_to_sheet(exportData);
          const wb = XLSX.utils.book_new();
          XLSX.utils.book_append_sheet(wb, ws, 'Pending Returns');
          XLSX.writeFile(wb, `pending_returns_${new Date().toISOString().slice(0, 10)}.xlsx`);
        } else {
          window.location.href = '/api/export-missing-csv';
        }
      } catch (err) {
        alert('Export failed: ' + err.message);
      }
    });
  }

  // ==========================================================================
  // EXCEL / CSV FILE UPLOAD & PARSER
  // ==========================================================================
  function setupUploadHandlers() {
    const dropzone = dom.fileDropzone;

    ['dragenter', 'dragover'].forEach(eventName => {
      dropzone.addEventListener(eventName, (e) => {
        e.preventDefault();
        dropzone.classList.add('dragover');
      });
    });

    ['dragleave', 'drop'].forEach(eventName => {
      dropzone.addEventListener(eventName, (e) => {
        e.preventDefault();
        dropzone.classList.remove('dragover');
      });
    });

    dropzone.addEventListener('drop', (e) => {
      const files = e.dataTransfer.files;
      if (files.length > 0) handleFileSelected(files[0]);
    });

    dom.excelFileInput.addEventListener('change', (e) => {
      if (e.target.files.length > 0) handleFileSelected(e.target.files[0]);
    });

    // 1-Click Load Sample Flipkart Data
    dom.btnLoadSample.addEventListener('click', async () => {
      if (clientStore.isStaticHost) {
        state.uploadedFileRecords = SAMPLE_FLIPKART_DATA;
        displayFilePreview(SAMPLE_FLIPKART_DATA);
      } else {
        try {
          const res = await fetch('/api/sample-flipkart-data');
          const data = await res.json();
          state.uploadedFileRecords = data;
          displayFilePreview(data);
        } catch (e) {
          state.uploadedFileRecords = SAMPLE_FLIPKART_DATA;
          displayFilePreview(SAMPLE_FLIPKART_DATA);
        }
      }
    });

    dom.btnConfirmImport.addEventListener('click', commitUploadToDatabase);
  }

  // Parse uploaded file (Supports both XLSX and CSV)
  function handleFileSelected(file) {
    const filename = file.name.toLowerCase();
    dom.uploadStatusCard.classList.add('hidden');

    if (filename.endsWith('.csv')) {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const text = e.target.result;
          const records = parseCsvToObjects(text);
          state.uploadedFileRecords = records;
          displayFilePreview(records);
        } catch (err) {
          showUploadStatus(false, 'CSV parsing error: ' + err.message);
        }
      };
      reader.readAsText(file);
    } else if (filename.endsWith('.xlsx') || filename.endsWith('.xls')) {
      if (typeof XLSX === 'undefined') {
        showUploadStatus(false, 'Excel parser library is still loading. Please check internet connection or upload CSV.');
        return;
      }
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target.result);
          const workbook = XLSX.read(data, { type: 'array' });
          const firstSheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[firstSheetName];
          const rawRows = XLSX.utils.sheet_to_json(worksheet, { defval: '' });
          const normalized = normalizeFlipkartColumns(rawRows);
          state.uploadedFileRecords = normalized;
          displayFilePreview(normalized);
        } catch (err) {
          showUploadStatus(false, 'Excel parsing error: ' + err.message);
        }
      };
      reader.readAsArrayBuffer(file);
    } else {
      showUploadStatus(false, 'Unsupported file type. Please upload an .xlsx, .xls, or .csv file.');
    }
  }

  // Robust CSV parser
  function parseCsvToObjects(csvText) {
    const lines = csvText.split(/\r?\n/).filter(line => line.trim().length > 0);
    if (lines.length < 2) throw new Error('File has no data rows');

    const headers = parseCsvLine(lines[0]);
    const records = [];

    for (let i = 1; i < lines.length; i++) {
      const values = parseCsvLine(lines[i]);
      if (values.length === 0 || (values.length === 1 && !values[0])) continue;
      const obj = {};
      headers.forEach((h, idx) => {
        obj[h] = values[idx] || '';
      });
      records.push(obj);
    }

    return normalizeFlipkartColumns(records);
  }

  function parseCsvLine(line) {
    const values = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        values.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    values.push(current.trim());
    return values;
  }

  // Auto-detect and map common Flipkart returns column headers
  function normalizeFlipkartColumns(rows) {
    if (!rows || rows.length === 0) return [];

    return rows.map(row => {
      const normalized = {
        tracking_id: '',
        order_id: '',
        order_item_id: '',
        sku: '',
        product_name: '',
        return_reason: '',
        return_type: '',
        return_date: '',
        customer_name: '',
        raw_data: row
      };

      for (const [key, val] of Object.entries(row)) {
        const k = key.toLowerCase().replace(/[^a-z0-9]/g, '');
        const strVal = String(val).trim();

        // Tracking ID mapping
        if (['trackingid', 'trackingno', 'awb', 'awbno', 'returnid', 'waybill', 'trackingnumber', 'returntrackingid', 'barcode', 'scanid', 'packageno', 'packagenumber', 'docketno', 'consignmentno', 'lrno'].includes(k)) {
          if (!normalized.tracking_id) normalized.tracking_id = strVal;
        }
        // Order ID mapping
        else if (['orderid', 'order', 'odid', 'orderserialnumber'].includes(k)) {
          if (!normalized.order_id) normalized.order_id = strVal;
        }
        // Order Item ID
        else if (['orderitemid', 'itemid', 'suborderid'].includes(k)) {
          if (!normalized.order_item_id) normalized.order_item_id = strVal;
        }
        // SKU / FSN
        else if (['sku', 'fsn', 'sellersku', 'productsku', 'itemsku', 'productcode'].includes(k)) {
          if (!normalized.sku) normalized.sku = strVal;
        }
        // Product Name / Title
        else if (['productname', 'producttitle', 'title', 'itemdescription', 'itemname', 'product'].includes(k)) {
          if (!normalized.product_name) normalized.product_name = strVal;
        }
        // Return Reason
        else if (['returnreason', 'reason', 'returncomments', 'customercomments', 'comments'].includes(k)) {
          if (!normalized.return_reason) normalized.return_reason = strVal;
        }
        // Return Type
        else if (['returntype', 'type', 'rtotype', 'returncategory'].includes(k)) {
          if (!normalized.return_type) normalized.return_type = strVal;
        }
        // Return Date
        else if (['returndate', 'date', 'createddate', 'approveddate', 'requestdate'].includes(k)) {
          if (!normalized.return_date) normalized.return_date = strVal;
        }
        // Customer Name
        else if (['customername', 'buyername', 'customer', 'buyer'].includes(k)) {
          if (!normalized.customer_name) normalized.customer_name = strVal;
        }
      }

      // Fallback: If no column named 'trackingid' but first column looks like a tracking ID
      if (!normalized.tracking_id) {
        const firstVal = Object.values(row)[0];
        if (firstVal) normalized.tracking_id = String(firstVal).trim();
      }

      return normalized;
    }).filter(r => Boolean(r.tracking_id));
  }

  // Display file preview table before committing
  function displayFilePreview(records) {
    if (!records || records.length === 0) {
      showUploadStatus(false, 'No valid records with Tracking IDs found in the file.');
      return;
    }

    dom.uploadPreviewContainer.classList.remove('hidden');
    dom.previewRowCount.textContent = records.length;

    dom.previewTableThead.innerHTML = `
      <tr>
        <th>Tracking ID</th>
        <th>Order ID</th>
        <th>SKU</th>
        <th>Product Name</th>
        <th>Return Reason</th>
        <th>Date</th>
      </tr>
    `;

    // Preview first 5 rows
    const previewRows = records.slice(0, 5);
    let tbodyHtml = '';
    previewRows.forEach(r => {
      tbodyHtml += `
        <tr>
          <td class="tracking-cell">${escapeHtml(r.tracking_id)}</td>
          <td>${escapeHtml(r.order_id || '-')}</td>
          <td>${escapeHtml(r.sku || '-')}</td>
          <td>${escapeHtml(r.product_name || '-')}</td>
          <td>${escapeHtml(r.return_reason || '-')}</td>
          <td>${escapeHtml(r.return_date || '-')}</td>
        </tr>
      `;
    });

    if (records.length > 5) {
      tbodyHtml += `
        <tr class="empty-row"><td colspan="6">+ ${records.length - 5} more rows ready to import...</td></tr>
      `;
    }

    dom.previewTableTbody.innerHTML = tbodyHtml;
  }

  // Commit parsed rows into Database 1 (flipkart_returns)
  async function commitUploadToDatabase() {
    if (!state.uploadedFileRecords || state.uploadedFileRecords.length === 0) return;

    dom.btnConfirmImport.disabled = true;
    dom.btnConfirmImport.innerHTML = `<span>⏳</span> Saving...`;

    try {
      let result;
      if (clientStore.isStaticHost) {
        const stats = clientStore.batchInsert(state.uploadedFileRecords);
        result = { success: true, stats };
      } else {
        try {
          const res = await fetch('/api/upload-returns', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ records: state.uploadedFileRecords })
          });
          result = await res.json();
          if (!res.ok || result.error) throw new Error(result.message || 'Import failed');
        } catch (fetchErr) {
          const stats = clientStore.batchInsert(state.uploadedFileRecords);
          result = { success: true, stats };
        }
      }

      showUploadStatus(true, `
        <strong>Upload Successful!</strong><br>
        Processed ${result.stats.totalRows} records: 
        <span style="color:#34d399">${result.stats.inserted} newly added</span>, 
        <span style="color:#94a3b8">${result.stats.ignored} existing/duplicate records ignored silently</span>.
      `);

      // Push to GitHub if configured
      if (typeof githubSync !== 'undefined' && githubSync.getToken()) {
        try {
          await githubSync.pushReturns();
          showUploadStatus(true, `
            <strong>Upload Successful & Synced to GitHub!</strong><br>
            Processed ${result.stats.totalRows} records: 
            <span style="color:#34d399">${result.stats.inserted} newly added</span>, 
            <span style="color:#94a3b8">${result.stats.ignored} existing/duplicate records ignored</span>.<br>
            <span style="color:#38bdf8">☁️ Committed directly to GitHub repository (data/flipkart_returns.json).</span>
          `);
        } catch (ghErr) {
          console.warn('GitHub push warning after upload:', ghErr);
        }
      }

      // Push to Google Sheets if configured
      if (typeof googleSheetsSync !== 'undefined') {
        try {
          await googleSheetsSync.scheduleAutoSyncReturns(state.uploadedFileRecords);
        } catch (gsErr) {
          console.warn('Google Sheets sync warning after upload:', gsErr);
        }
      }

      dom.uploadPreviewContainer.classList.add('hidden');
      state.uploadedFileRecords = [];
      updateCounts();
    } catch (err) {
      showUploadStatus(false, 'Failed to import into database: ' + err.message);
    } finally {
      dom.btnConfirmImport.disabled = false;
      dom.btnConfirmImport.innerHTML = `<span>💾</span> Confirm & Save into Database`;
    }
  }

  function showUploadStatus(isSuccess, message) {
    const card = dom.uploadStatusCard;
    card.className = `upload-alert ${isSuccess ? 'success' : 'error'}`;
    card.classList.remove('hidden');
    dom.uploadStatusIcon.textContent = isSuccess ? '✅' : '❌';
    dom.uploadStatusText.innerHTML = message;
  }

  // ==========================================================================
  // SCANS HISTORY (DATABASE 2)
  // ==========================================================================
  let scansSearchTimeout = null;

  async function loadScans() {
    dom.scansTableTbody.innerHTML = `
      <tr class="loading-row"><td colspan="7">Loading scan records...</td></tr>
    `;

    try {
      let data = null;
      if (clientStore.isStaticHost) {
        data = clientStore.getScans({ search: state.scansSearch, matchedOnly: state.scansFilter, page: state.scansPage, limit: 25 });
      } else {
        try {
          const q = encodeURIComponent(state.scansSearch);
          let matchedParam = '';
          if (state.scansFilter === '1') matchedParam = '&matchedOnly=1';
          if (state.scansFilter === '0') matchedParam = '&matchedOnly=0';
          const res = await fetch(`/api/scans?search=${q}${matchedParam}&page=${state.scansPage}&limit=25`);
          data = await res.json();
        } catch (fetchErr) {
          data = clientStore.getScans({ search: state.scansSearch, matchedOnly: state.scansFilter, page: state.scansPage, limit: 25 });
        }
      }

      dom.navScansCount.textContent = data.total;

      if (!data.rows || data.rows.length === 0) {
        dom.scansTableTbody.innerHTML = `
          <tr class="empty-row"><td colspan="7">No scans recorded matching your filter.</td></tr>
        `;
        dom.scansPaginationInfo.textContent = 'Showing 0 of 0';
        dom.btnScansPrev.disabled = true;
        dom.btnScansNext.disabled = true;
        return;
      }

      let html = '';
      data.rows.forEach((row, idx) => {
        const isMatched = row.matched_in_db1 === 1;
        const statusBadge = isMatched
          ? '<span class="badge badge-success">Matched in Flipkart Return Records</span>'
          : '<span class="badge badge-warning">Not in Flipkart Return Records</span>';

        const rowNum = (data.page - 1) * data.limit + idx + 1;

        html += `
          <tr>
            <td>${rowNum}</td>
            <td class="tracking-cell">${escapeHtml(row.tracking_id)}</td>
            <td>${statusBadge}</td>
            <td><small>${escapeHtml(row.scanned_at)}</small></td>
            <td>${escapeHtml(row.order_id || '-')}</td>
            <td>${escapeHtml(row.product_name || '-')}</td>
            <td>
              <button class="btn-icon btn-delete-scan" data-id="${row.id}" title="Delete/Undo scan">
                🗑️
              </button>
            </td>
          </tr>
        `;
      });

      dom.scansTableTbody.innerHTML = html;

      // Attach delete scan buttons
      document.querySelectorAll('.btn-delete-scan').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!confirm('Are you sure you want to remove this scan record?')) return;
          const scanId = btn.getAttribute('data-id');
          if (clientStore.isStaticHost) {
            clientStore.deleteScan(scanId);
          } else {
            try {
              await fetch(`/api/scans/${scanId}`, { method: 'DELETE' });
            } catch (e) {
              clientStore.deleteScan(scanId);
            }
          }
          loadScans();
          updateCounts();
        });
      });

      // Pagination
      const from = (data.page - 1) * data.limit + 1;
      const to = Math.min(data.page * data.limit, data.total);
      dom.scansPaginationInfo.textContent = `Showing ${from} - ${to} of ${data.total} scans`;
      dom.btnScansPrev.disabled = data.page <= 1;
      dom.btnScansNext.disabled = data.page >= data.totalPages;

    } catch (err) {
      console.error('Scans fetch error:', err);
      dom.scansTableTbody.innerHTML = `
        <tr class="empty-row"><td colspan="7" style="color:#f87171">Failed to load scans: ${err.message}</td></tr>
      `;
    }
  }

  dom.filterChips.forEach(chip => {
    chip.addEventListener('click', () => {
      dom.filterChips.forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      state.scansFilter = chip.getAttribute('data-filter');
      state.scansPage = 1;
      loadScans();
    });
  });

  dom.scansSearchInput.addEventListener('input', () => {
    clearTimeout(scansSearchTimeout);
    scansSearchTimeout = setTimeout(() => {
      state.scansSearch = dom.scansSearchInput.value.trim();
      state.scansPage = 1;
      loadScans();
    }, 300);
  });

  dom.btnRefreshScans.addEventListener('click', loadScans);
  dom.btnScansPrev.addEventListener('click', () => {
    if (state.scansPage > 1) {
      state.scansPage--;
      loadScans();
    }
  });
  dom.btnScansNext.addEventListener('click', () => {
    state.scansPage++;
    loadScans();
  });

  // ==========================================================================
  // DASHBOARD & KPI STATS
  // ==========================================================================
  async function loadDashboardStats() {
    try {
      let stats = null;
      if (clientStore.isStaticHost) {
        stats = clientStore.getStats();
      } else {
        try {
          const res = await fetch('/api/dashboard');
          stats = await res.json();
        } catch (fetchErr) {
          stats = clientStore.getStats();
        }
      }

      dom.kpiUploaded.textContent = stats.totalUploaded;
      dom.kpiScanned.textContent = stats.totalScanned;
      dom.kpiMatched.textContent = stats.matchedScans;
      dom.kpiMissing.textContent = stats.missingCount;
      dom.kpiUnmatched.textContent = stats.unmatchedScans;
      dom.kpiCompletion.textContent = `${stats.returnReceivedRate}%`;

      dom.progressBarFill.style.width = `${stats.returnReceivedRate}%`;
      dom.progressText.textContent = `${stats.matchedScans} of ${stats.totalUploaded} uploaded returns received (${stats.returnReceivedRate}%)`;

      dom.navMissingCount.textContent = stats.missingCount;
      dom.navScansCount.textContent = stats.totalScanned;
    } catch (err) {
      console.warn('Dashboard stats error:', err);
    }
  }

  async function updateCounts() {
    loadDashboardStats();
    if (state.activeTab === 'tab-missing') loadMissingReturns();
    if (state.activeTab === 'tab-scans') loadScans();
  }

  // ==========================================================================
  // MOBILE CONNECT MODAL & QR CODE GENERATION
  // ==========================================================================
  async function setupMobileConnect() {
    dom.btnMobileConnect.addEventListener('click', async () => {
      dom.mobileModal.classList.remove('hidden');
      try {
        const res = await fetch('/api/network-info');
        const data = await res.json();

        // Default to HTTPS if available (port 3443 for camera), fallback to HTTP (port 3000)
        let httpsUrl = (data.mobileHttpsUrls && data.mobileHttpsUrls.length > 0) ? data.mobileHttpsUrls[0] : '';
        let httpUrl = (data.mobileUrls && data.mobileUrls.length > 0) ? data.mobileUrls[0] : window.location.origin;

        // Choose preferred target URL: if user wants live camera, https is required
        let targetUrl = httpsUrl || httpUrl;

        dom.mobileUrlText.value = targetUrl;

        // Render QR Code SVG using offline QR Generator
        if (window.QRCodeGenerator) {
          const svgHtml = window.QRCodeGenerator.generateSvg(targetUrl, 5, 8);
          dom.mobileQrContainer.innerHTML = svgHtml;
        }
      } catch (e) {
        console.warn('Network info error:', e);
        dom.mobileUrlText.value = window.location.origin;
      }
    });

    dom.btnCloseModal.addEventListener('click', () => {
      dom.mobileModal.classList.add('hidden');
    });

    dom.mobileModal.addEventListener('click', (e) => {
      if (e.target === dom.mobileModal) dom.mobileModal.classList.add('hidden');
    });

    dom.btnCopyUrl.addEventListener('click', () => {
      dom.mobileUrlText.select();
      navigator.clipboard.writeText(dom.mobileUrlText.value);
      dom.btnCopyUrl.textContent = 'Copied!';
      setTimeout(() => { dom.btnCopyUrl.textContent = 'Copy'; }, 1500);
    });
  }

  // Utility escape HTML
  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // ==========================================================================
  // APP INITIALIZATION
  // ==========================================================================
  async function init() {
    setupUploadHandlers();
    setupMobileConnect();
    if (typeof githubSync !== 'undefined') {
      await githubSync.init();
    }
    if (typeof googleSheetsSync !== 'undefined') {
      await googleSheetsSync.init();
    }
    await initBarcodeDetector();
    updateCounts();

    // Auto-focus manual input on desktop
    if (window.innerWidth > 640) {
      dom.manualTrackingInput.focus();
    }
  }

  // Start app when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
