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

    // Scanner Elements
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
  async function initBarcodeDetector() {
    if ('BarcodeDetector' in window) {
      try {
        const supportedFormats = await BarcodeDetector.getSupportedFormats();
        state.barcodeDetector = new BarcodeDetector({
          formats: supportedFormats.length ? supportedFormats : ['qr_code', 'code_128', 'code_39', 'ean_13', 'upc_a']
        });
        return true;
      } catch (e) {
        console.warn('BarcodeDetector initialization warning:', e);
      }
    }
    return false;
  }

  async function startCamera() {
    try {
      dom.cameraStatusText.textContent = 'Requesting camera access...';

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Camera streaming not supported or blocked by browser insecure context. Please use "Take Photo" or connect over HTTPS.');
      }

      const constraints = {
        video: {
          facingMode: { ideal: state.currentFacingMode },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      state.cameraStream = stream;
      dom.cameraVideo.srcObject = stream;
      await dom.cameraVideo.play();

      // UI updates
      dom.cameraPlaceholder.classList.add('hidden');
      dom.toggleCameraIcon.textContent = '⏹️';
      dom.btnToggleCamera.innerHTML = `<span>⏹️</span> Stop Camera`;

      // Check flashlight/torch capability
      checkTorchSupport(stream);

      // Start detection loop
      state.scanLoopActive = true;
      requestAnimationFrame(scanVideoFrame);
    } catch (err) {
      console.error('Camera Start Error:', err);
      dom.cameraStatusText.innerHTML = `
        <span style="color:#f87171">Camera access unavailable:</span><br>
        <small>${err.message}</small><br>
        <span style="color:#94a3b8; font-size:0.8rem">Use the <strong>"📸 Take Photo"</strong> button below or enter Tracking ID manually.</span>
      `;
      dom.cameraPlaceholder.classList.remove('hidden');
    }
  }

  function stopCamera() {
    state.scanLoopActive = false;
    if (state.cameraStream) {
      state.cameraStream.getTracks().forEach(track => track.stop());
      state.cameraStream = null;
    }
    dom.cameraVideo.srcObject = null;
    dom.cameraPlaceholder.classList.remove('hidden');
    dom.cameraStatusText.textContent = 'Camera stopped';
    dom.btnToggleCamera.innerHTML = `<span>▶️</span> Start Camera`;
    dom.btnTorch.classList.add('hidden');
  }

  function checkTorchSupport(stream) {
    const videoTrack = stream.getVideoTracks()[0];
    if (videoTrack && typeof videoTrack.getCapabilities === 'function') {
      const capabilities = videoTrack.getCapabilities();
      if (capabilities.torch) {
        dom.btnTorch.classList.remove('hidden');
      } else {
        dom.btnTorch.classList.add('hidden');
      }
    }
  }

  async function toggleTorch() {
    if (!state.cameraStream) return;
    const videoTrack = state.cameraStream.getVideoTracks()[0];
    if (videoTrack) {
      state.torchActive = !state.torchActive;
      try {
        await videoTrack.applyConstraints({
          advanced: [{ torch: state.torchActive }]
        });
        dom.btnTorch.innerHTML = state.torchActive ? '<span>⚡</span> Torch ON' : '<span>💡</span> Torch';
      } catch (e) {
        console.warn('Torch constraint error:', e);
      }
    }
  }

  async function switchCamera() {
    state.currentFacingMode = state.currentFacingMode === 'environment' ? 'user' : 'environment';
    if (state.cameraStream) {
      stopCamera();
      await startCamera();
    }
  }

  // Real-time video frame scanning loop
  async function scanVideoFrame() {
    if (!state.scanLoopActive) return;

    if (dom.cameraVideo.readyState === dom.cameraVideo.HAVE_ENOUGH_DATA) {
      if (state.barcodeDetector) {
        try {
          const barcodes = await state.barcodeDetector.detect(dom.cameraVideo);
          if (barcodes && barcodes.length > 0) {
            const rawValue = barcodes[0].rawValue;
            handleDetectedCode(rawValue);
          }
        } catch (e) {
          // Frame decode exception ignored
        }
      }
    }

    if (state.scanLoopActive) {
      requestAnimationFrame(scanVideoFrame);
    }
  }

  // Handle Photo / File snapshot scanning
  dom.filePhotoInput.addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    try {
      const img = new Image();
      img.onload = async () => {
        if (!state.barcodeDetector) await initBarcodeDetector();
        if (state.barcodeDetector) {
          try {
            const barcodes = await state.barcodeDetector.detect(img);
            if (barcodes && barcodes.length > 0) {
              handleDetectedCode(barcodes[0].rawValue);
              return;
            }
          } catch (err) {
            console.warn('Photo detect failed:', err);
          }
        }
        alert('No barcode or QR code detected in the photo. Please ensure good lighting and try again.');
      };
      img.src = URL.createObjectURL(file);
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
    if (state.cameraStream) {
      stopCamera();
    } else {
      startCamera();
    }
  });
  dom.btnSwitchCamera.addEventListener('click', switchCamera);
  dom.btnTorch.addEventListener('click', toggleTorch);

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
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tracking_id: trackingId, source })
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.message || 'Scan processing failed');
      }

      // Render the result based on the 4 scenarios
      renderScanResult(data);

      // Add to recent scans session list
      addRecentScan(data);

      // Refresh missing counter in navigation
      updateCounts();
    } catch (err) {
      console.error('Scan API error:', err);
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
      dom.resultBadge.textContent = 'VERIFIED & RECORDED';
      dom.resultMessage.textContent = data.message;
      playSuccessChime();
      triggerHaptic('success');
      showFlipkartDetails(data.tracking_id, flip, data.recorded_at);

    } else if (data.scenario === 4) {
      // SCENARIO 4: First Scan + NOT found in DB1 (Warning / Yellow)
      card.classList.add('status-unmatched');
      dom.resultIcon.textContent = '⚠️';
      dom.resultBadge.textContent = 'UNEXPECTED RETURN';
      dom.resultMessage.textContent = data.message;
      playWarningBeep();
      triggerHaptic('warning');
      showFlipkartDetails(data.tracking_id, null, data.recorded_at);

    } else if (data.scenario === 1) {
      // SCENARIO 1: Already Scanned + Found in DB1 (Info / Blue)
      card.classList.add('status-repeat-matched');
      dom.resultIcon.textContent = 'ℹ️';
      dom.resultBadge.textContent = 'ALREADY RECORDED';
      dom.resultMessage.textContent = data.message;
      playRepeatBeep();
      triggerHaptic('repeat');
      showFlipkartDetails(data.tracking_id, flip, data.recorded_at);

    } else if (data.scenario === 2) {
      // SCENARIO 2: Already Scanned + NOT found in DB1 (Orange)
      card.classList.add('status-repeat-unmatched');
      dom.resultIcon.textContent = '🔁';
      dom.resultBadge.textContent = 'ALREADY RECORDED (UNLISTED)';
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
      const q = encodeURIComponent(state.missingSearch);
      const res = await fetch(`/api/missing?search=${q}&page=${state.missingPage}&limit=25`);
      const data = await res.json();

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
                Mark Received
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
      try {
        const res = await fetch('/api/sample-flipkart-data');
        const data = await res.json();
        state.uploadedFileRecords = data;
        displayFilePreview(data);
      } catch (e) {
        alert('Failed to load sample data: ' + e.message);
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
        if (['trackingid', 'trackingno', 'awb', 'awbno', 'returnid', 'waybill', 'trackingnumber', 'returntrackingid'].includes(k)) {
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
      const res = await fetch('/api/upload-returns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ records: state.uploadedFileRecords })
      });

      const result = await res.json();
      if (!res.ok || result.error) throw new Error(result.message || 'Import failed');

      showUploadStatus(true, `
        <strong>Upload Successful!</strong><br>
        Processed ${result.stats.totalRows} records: 
        <span style="color:#34d399">${result.stats.inserted} newly added</span>, 
        <span style="color:#94a3b8">${result.stats.ignored} existing/duplicate records ignored silently</span>.
      `);

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
      const q = encodeURIComponent(state.scansSearch);
      let matchedParam = '';
      if (state.scansFilter === '1') matchedParam = '&matchedOnly=1';
      if (state.scansFilter === '0') matchedParam = '&matchedOnly=0';

      const res = await fetch(`/api/scans?search=${q}${matchedParam}&page=${state.scansPage}&limit=25`);
      const data = await res.json();

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
          await fetch(`/api/scans/${scanId}`, { method: 'DELETE' });
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
      const res = await fetch('/api/dashboard');
      const stats = await res.json();

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

        // Use Wi-Fi IP if available, else localhost
        const targetUrl = data.mobileUrls && data.mobileUrls.length > 0 
          ? data.mobileUrls[0] 
          : window.location.origin;

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
