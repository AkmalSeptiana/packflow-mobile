/**
 * PackFlow AWB Mobile — Core Application Controller
 * Offline-first mobile PWA. Handles PDF rendering, cropping,
 * SKU label stamping, auto Resi/Order detection, and Telegram integration.
 */

(function () {
  'use strict';

  // ── PDF.js Setup ──
  if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'pdf.worker.js';
  }

  // ── State ──
  let currentPdfDoc = null;
  let zoomLevelPct = 100; // Default 100% = Auto-fit label width to mobile screen
  let isCropped = true;

  const savedBottomRatio = parseFloat(localStorage.getItem('packflow_m_crop_bottom'));
  let cropConfig = {
    topRatio: 0.0,
    bottomRatio: !isNaN(savedBottomRatio) ? savedBottomRatio : 0.54,
    leftRatio: 0.0,
    rightRatio: 0.498
  };

  // ── SKU Whitelist & Ignored ──
  const defaultWhitelist = ["MLS", "HEX", "KAM", "KLRN", "PSM", "AQU", "AMP", "SKP", "SQU", "LMB", "CHS", "SKIN", "OIL", "WNT", "IFI", "KGE", "RAD", "GRC", "KLR", "ALB", "QNC", "WBW", "KSL", "CARDINA"];
  const defaultIgnored = ["BROSUR", "FREE-PACKING", "BONUS", "SAMPEL", "VOUCHER", "KARDUS", "PACKING"];

  let parsedData = {
    resiNo: '',
    orderNo: '',
    cityName: '',
    items: [],
    totalQty: 0,
    generatedLabel: ''
  };

  let currentOrderExportRows = [];

  // ── DOM Elements ──
  const fileInput = document.getElementById('file-input');
  const fileInputMain = document.getElementById('file-input-main');
  const uploadArea = document.getElementById('upload-area');
  const viewerContainer = document.getElementById('viewer-container');
  const viewerEmpty = document.getElementById('viewer-empty');
  const canvasScroll = document.getElementById('canvas-scroll');
  const canvasWrapper = document.getElementById('canvas-wrapper');
  const pdfCanvas = document.getElementById('pdf-canvas');
  const stampOverlay = document.getElementById('stamp-overlay');
  const stampText = document.getElementById('stamp-text');

  const docStatus = document.getElementById('doc-status');
  const inputOrderNo = document.getElementById('input-order-no');
  const inputResi = document.getElementById('input-resi');
  const txtCity = document.getElementById('txt-city');
  const txtTotalSku = document.getElementById('txt-total-sku');
  const txtTotalQty = document.getElementById('txt-total-qty');
  const inputCustomLabel = document.getElementById('input-custom-label');
  const inputSuffix = document.getElementById('input-suffix');

  const cardCropControls = document.getElementById('card-crop-controls');
  const btnCropToggle = document.getElementById('btn-crop-toggle');
  const btnZoomIn = document.getElementById('btn-zoom-in');
  const btnZoomOut = document.getElementById('btn-zoom-out');
  const txtZoom = document.getElementById('txt-zoom');
  const sliderCropHeight = document.getElementById('slider-crop-height');
  const txtCropHeightVal = document.getElementById('txt-crop-height-val');

  const selectWhitelist = document.getElementById('select-whitelist');
  const groupCustomWhitelist = document.getElementById('group-custom-whitelist');
  const inputWhitelist = document.getElementById('input-whitelist');
  const inputIgnored = document.getElementById('input-ignored');

  const inputTgBotToken = document.getElementById('input-tg-bot-token');
  const inputTgChatId = document.getElementById('input-tg-chat-id');
  const inputWebhookUrl = document.getElementById('input-webhook-url');
  const inputWarehouseAliases = document.getElementById('input-warehouse-aliases');
  const inputDefaultShopName = document.getElementById('input-default-shop-name');

  const toastEl = document.getElementById('toast');

  // ══════════════════════════════════════════════════════════
  //  INITIALIZATION
  // ══════════════════════════════════════════════════════════

  window.addEventListener('load', () => {
    loadSavedSettings();
    initTabNavigation();
    initCollapsibles();
    initFileInputs();
    initControls();
    initEyeToggles();
    initDraggableStamp();
    initActionButtons();

    // Check if we were opened via Web Share Target
    checkSharedFile();
  });

  // ── Web Share Target Receiver ──
  async function checkSharedFile() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data && event.data.type === 'share-target-file') {
          loadSharedPdfFromCache();
        }
      });
    }

    if (window.location.search.includes('share-target')) {
      loadSharedPdfFromCache();
    }
  }

  async function loadSharedPdfFromCache(retryCount = 0) {
    try {
      const cache = await caches.open('packflow-share-target');
      const response = await cache.match('/shared-pdf');
      if (response) {
        const rawFilename = response.headers.get('X-Filename') || 'shared.pdf';
        const filename = decodeURIComponent(rawFilename);
        setDocStatus('loading', `Memuat: ${filename}...`);
        showToast(`📂 Menerima: ${filename}`, 'success');
        const buffer = await response.arrayBuffer();
        loadPdfFromBuffer(new Uint8Array(buffer));
        await cache.delete('/shared-pdf');
        if (window.history.replaceState) {
          window.history.replaceState({}, '', './index.html');
        }
      } else if (retryCount < 10) {
        setTimeout(() => loadSharedPdfFromCache(retryCount + 1), 250);
      }
    } catch (err) {
      console.error('[PackFlow] Share target load error:', err);
    }
  }

  // ── Load Saved Settings from localStorage ──
  function loadSavedSettings() {
    const defaultToken = '8738468752:AAHlbWtnuwqnUYLtmPCYqeYrw3eJ-3wqTB0';

    if (inputTgBotToken) inputTgBotToken.value = localStorage.getItem('packflow_m_tg_token') || defaultToken;
    if (inputTgChatId) inputTgChatId.value = localStorage.getItem('packflow_m_tg_chat') || '';
    if (inputWebhookUrl) inputWebhookUrl.value = localStorage.getItem('packflow_m_webhook') || '';
    if (inputWarehouseAliases) inputWarehouseAliases.value = getWarehouseAliasText();
    if (inputSuffix) inputSuffix.value = localStorage.getItem('packflow_m_suffix') || 'ARY';
    if (inputDefaultShopName) inputDefaultShopName.value = localStorage.getItem('packflow_m_shop_name') || 'HERBAL TV OFFICIAL';
    if (inputWhitelist) inputWhitelist.value = defaultWhitelist.join(', ');
    if (inputIgnored) inputIgnored.value = defaultIgnored.join(', ');

    // Set default zoom label display to 80%
    if (txtZoom) txtZoom.textContent = '80%';

    // Crop slider
    if (sliderCropHeight) {
      sliderCropHeight.value = (cropConfig.bottomRatio * 100).toFixed(1);
      if (txtCropHeightVal) txtCropHeightVal.textContent = `${sliderCropHeight.value}%`;
    }

    // Build initial label
    buildLabelStamp();

    // Auto-save settings on input change
    const autoSaveMap = [
      [inputTgBotToken, 'packflow_m_tg_token'],
      [inputTgChatId, 'packflow_m_tg_chat'],
      [inputWebhookUrl, 'packflow_m_webhook'],
      [inputDefaultShopName, 'packflow_m_shop_name'],
    ];

    autoSaveMap.forEach(([el, key]) => {
      if (el) {
        el.addEventListener('input', () => {
          localStorage.setItem(key, el.value.trim());
        });
      }
    });

    if (inputSuffix) {
      inputSuffix.addEventListener('input', () => {
        localStorage.setItem('packflow_m_suffix', inputSuffix.value.trim());
        buildLabelStamp();
      });
    }
  }

  // ══════════════════════════════════════════════════════════
  //  TAB NAVIGATION & VIEW SWITCHING
  // ══════════════════════════════════════════════════════════

  let currentTab = 'resi';

  function switchTab(tabId) {
    currentTab = tabId;
    const panelResi = document.getElementById('panel-resi');
    const panelSettings = document.getElementById('panel-settings');
    const btnHeaderSettings = document.getElementById('btn-header-settings');

    if (tabId === 'settings') {
      if (panelResi) panelResi.classList.remove('active');
      if (panelSettings) panelSettings.classList.add('active');
      if (btnHeaderSettings) btnHeaderSettings.classList.add('active');
      document.body.classList.add('settings-active');
    } else {
      if (panelSettings) panelSettings.classList.remove('active');
      if (panelResi) panelResi.classList.add('active');
      if (btnHeaderSettings) btnHeaderSettings.classList.remove('active');
      document.body.classList.remove('settings-active');
    }
  }

  function saveAllSettings() {
    if (inputTgBotToken) localStorage.setItem('packflow_m_tg_token', inputTgBotToken.value.trim());
    if (inputTgChatId) localStorage.setItem('packflow_m_tg_chat', inputTgChatId.value.trim());
    if (inputWebhookUrl) localStorage.setItem('packflow_m_webhook', inputWebhookUrl.value.trim());
    if (inputDefaultShopName) localStorage.setItem('packflow_m_shop_name', inputDefaultShopName.value.trim());
    if (inputSuffix) localStorage.setItem('packflow_m_suffix', inputSuffix.value.trim());
    if (inputWarehouseAliases) localStorage.setItem('packflow_m_warehouse_aliases', inputWarehouseAliases.value.trim());

    // Re-apply label stamp
    buildLabelStamp();
    showToast('✅ Pengaturan disimpan!', 'success');
  }

  function initTabNavigation() {
    // Header Settings gear button toggle
    const btnHeaderSettings = document.getElementById('btn-header-settings');
    if (btnHeaderSettings) {
      btnHeaderSettings.addEventListener('click', () => {
        if (currentTab === 'settings') {
          saveAllSettings();
          switchTab('resi');
        } else {
          switchTab('settings');
        }
      });
    }

    // Save & Return Button at bottom of Settings
    const btnSaveSettings = document.getElementById('btn-save-settings');
    if (btnSaveSettings) {
      btnSaveSettings.addEventListener('click', () => {
        saveAllSettings();
        switchTab('resi');
      });
    }

    // Header Logo/Title click to return to Resi workspace
    const headerBrandLogo = document.getElementById('header-brand-logo');
    if (headerBrandLogo) {
      headerBrandLogo.addEventListener('click', () => switchTab('resi'));
    }
  }

  // ══════════════════════════════════════════════════════════
  //  COLLAPSIBLE CARDS
  // ══════════════════════════════════════════════════════════

  function initCollapsibles() {
    const collapsibles = [
      ['header-resi-info', 'card-resi-info'],
      ['header-telegram', 'card-telegram'],
      ['header-webhook', 'card-webhook'],
      ['header-warehouse', 'card-warehouse'],
      ['header-whitelist', 'card-whitelist'],
    ];

    collapsibles.forEach(([headerId, cardId]) => {
      const header = document.getElementById(headerId);
      const card = document.getElementById(cardId);
      if (header && card) {
        header.addEventListener('click', () => {
          card.classList.toggle('collapsed');
        });
      }
    });
  }

  // ══════════════════════════════════════════════════════════
  //  FILE INPUT & PDF LOADING
  // ══════════════════════════════════════════════════════════

  function initFileInputs() {
    // Header upload button (top-left) triggers hidden file input
    const btnHeaderUpload = document.getElementById('btn-header-upload');
    if (btnHeaderUpload) {
      btnHeaderUpload.addEventListener('click', () => fileInput.click());
    }

    // Main upload area
    [fileInput, fileInputMain].forEach(input => {
      if (input) {
        input.addEventListener('change', (e) => {
          const file = e.target.files[0];
          if (file) {
            setDocStatus('loading', `Memuat: ${file.name}...`);
            const reader = new FileReader();
            reader.onload = function () {
              loadPdfFromBuffer(new Uint8Array(this.result));
            };
            reader.readAsArrayBuffer(file);
          }
        });
      }
    });
  }

  function loadPdfFromBuffer(buffer) {
    if (typeof pdfjsLib === 'undefined') {
      setDocStatus('error', 'PDF.js tidak tersedia');
      return;
    }

    pdfjsLib.getDocument({ data: buffer }).promise.then((pdf) => {
      currentPdfDoc = pdf;
      setDocStatus('ready', 'PDF Siap');

      // Show canvas, hide upload
      if (uploadArea) uploadArea.style.display = 'none';
      if (viewerContainer) viewerContainer.style.display = 'block';
      if (viewerEmpty) viewerEmpty.style.display = 'none';
      if (canvasScroll) canvasScroll.style.display = 'block';
      if (cardCropControls) cardCropControls.style.display = 'block';

      extractTextAndParseData();
      updateActionBarState();
      renderPdfPage();
    }).catch((err) => {
      console.error('[PackFlow Mobile] PDF load error:', err);
      setDocStatus('error', 'Gagal memuat PDF');
    });
  }

  function setDocStatus(type, text) {
    if (!docStatus) return;
    docStatus.innerHTML = '';
    const dot = document.createElement('span');
    dot.className = `status-dot ${type === 'ready' ? 'ready' : 'waiting'}`;
    docStatus.appendChild(dot);
    docStatus.appendChild(document.createTextNode(text));

    if (type === 'error') {
      docStatus.className = 'card-badge badge-orange';
    } else if (type === 'ready') {
      docStatus.className = 'card-badge badge-green';
    } else {
      docStatus.className = 'card-badge badge-blue';
    }
  }

  // ══════════════════════════════════════════════════════════
  //  CONTROLS: CROP, ZOOM, STAMP, WHITELIST
  // ══════════════════════════════════════════════════════════

  function initControls() {
    // Crop toggle
    if (btnCropToggle) {
      btnCropToggle.addEventListener('click', () => {
        isCropped = !isCropped;
        btnCropToggle.classList.toggle('active', isCropped);
        btnCropToggle.textContent = isCropped ? 'Mode Potong: ON' : 'Mode Potong: OFF';
        renderPdfPage();
      });
    }

    // Zoom controls (Default 100% = Auto-fit width to mobile screen)
    if (txtZoom) txtZoom.textContent = `${zoomLevelPct}%`;

    if (btnZoomIn) {
      btnZoomIn.addEventListener('click', () => {
        zoomLevelPct = Math.min(200, zoomLevelPct + 10);
        if (txtZoom) txtZoom.textContent = `${zoomLevelPct}%`;
        renderPdfPage();
      });
    }
    if (btnZoomOut) {
      btnZoomOut.addEventListener('click', () => {
        zoomLevelPct = Math.max(40, zoomLevelPct - 10);
        if (txtZoom) txtZoom.textContent = `${zoomLevelPct}%`;
        renderPdfPage();
      });
    }

    // Crop height slider
    if (sliderCropHeight) {
      sliderCropHeight.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        cropConfig.bottomRatio = val / 100;
        localStorage.setItem('packflow_m_crop_bottom', (val / 100).toString());
        if (txtCropHeightVal) txtCropHeightVal.textContent = `${val.toFixed(1)}%`;
        renderPdfPage();
      });
    }

    // Custom label input
    if (inputCustomLabel) {
      inputCustomLabel.addEventListener('input', (e) => {
        parsedData.generatedLabel = e.target.value;
        stampText.textContent = e.target.value;
        updateTotalsFromStamp(e.target.value);
      });
    }

    // Resi input manual edit
    if (inputResi) {
      inputResi.addEventListener('input', (e) => {
        const clean = e.target.value.replace(/\s+/g, '');
        e.target.value = clean;
        parsedData.resiNo = clean;
        updateActionBarState();
      });
    }

    // Order No input manual edit
    if (inputOrderNo) {
      inputOrderNo.addEventListener('input', (e) => {
        parsedData.orderNo = e.target.value.trim();
      });
    }

    // Copy buttons handlers
    const btnCopyOrderNo = document.getElementById('btn-copy-order-no');
    if (btnCopyOrderNo) btnCopyOrderNo.addEventListener('click', () => copyInputValue('input-order-no', 'No. Pesanan'));

    const btnCopyResi = document.getElementById('btn-copy-resi');
    if (btnCopyResi) btnCopyResi.addEventListener('click', () => copyInputValue('input-resi', 'No. Resi'));

    const btnCopyLabel = document.getElementById('btn-copy-label');
    if (btnCopyLabel) btnCopyLabel.addEventListener('click', () => copyInputValue('input-custom-label', 'Pelabelan SKU'));

    // Whitelist preset
    if (selectWhitelist) {
      selectWhitelist.addEventListener('change', (e) => {
        if (e.target.value === 'CUSTOM') {
          if (groupCustomWhitelist) groupCustomWhitelist.style.display = 'block';
        } else {
          if (groupCustomWhitelist) groupCustomWhitelist.style.display = 'none';
        }
        extractTextAndParseData();
      });
    }

    if (inputWhitelist) inputWhitelist.addEventListener('input', () => extractTextAndParseData());
    if (inputIgnored) inputIgnored.addEventListener('input', () => extractTextAndParseData());

    // Warehouse aliases save/reset
    const btnSaveAliases = document.getElementById('btn-save-aliases');
    const btnResetAliases = document.getElementById('btn-reset-aliases');

    if (btnSaveAliases) {
      btnSaveAliases.addEventListener('click', () => {
        if (inputWarehouseAliases) {
          localStorage.setItem('packflow_m_warehouse_aliases', inputWarehouseAliases.value.trim());
        }
        showToast('✅ Pengaturan alias gudang disimpan!', 'success');

        // Re-apply city mapping
        if (parsedData.cityName) {
          const mapped = mapWarehouseAlias(parsedData.cityName);
          parsedData.cityName = mapped;
          if (txtCity) txtCity.textContent = mapped;
        }
      });
    }

    if (btnResetAliases) {
      btnResetAliases.addEventListener('click', () => {
        if (inputWarehouseAliases) inputWarehouseAliases.value = DEFAULT_WAREHOUSE_ALIASES_TEXT;
        showToast('Alias direset ke default', 'info');
      });
    }
  }

  // ══════════════════════════════════════════════════════════
  //  EYE TOGGLE (Password Mask)
  // ══════════════════════════════════════════════════════════

  function initEyeToggles() {
    document.querySelectorAll('.btn-toggle-eye').forEach(btn => {
      btn.addEventListener('click', () => {
        const targetId = btn.getAttribute('data-target');
        const input = document.getElementById(targetId);
        if (input) {
          input.type = input.type === 'password' ? 'text' : 'password';
        }
      });
    });
  }

  // ══════════════════════════════════════════════════════════
  //  DRAGGABLE STAMP (Touch + Mouse)
  // ══════════════════════════════════════════════════════════

  function initDraggableStamp() {
    let isDragging = false;
    let startX = 0, startY = 0;
    let initialRight = 0, initialTop = 0;

    // Restore saved position
    const savedTop = localStorage.getItem('packflow_m_stamp_top');
    const savedRight = localStorage.getItem('packflow_m_stamp_right');
    const savedFont = localStorage.getItem('packflow_m_stamp_font');

    if (savedTop && savedRight && stampOverlay) {
      stampOverlay.style.left = 'auto';
      stampOverlay.style.transform = 'none';
      stampOverlay.style.top = `${savedTop}%`;
      stampOverlay.style.right = `${savedRight}%`;
    }

    let currentFontCqw = savedFont ? parseFloat(savedFont) : 4.6;
    if (savedFont && stampOverlay) {
      stampOverlay.style.fontSize = `${currentFontCqw.toFixed(1)}cqw`;
    }

    // Touch events
    stampOverlay.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return;
      isDragging = true;
      stampOverlay.classList.add('dragging');

      const touch = e.touches[0];
      const wrapperRect = canvasWrapper.getBoundingClientRect();
      const stampRect = stampOverlay.getBoundingClientRect();

      const rightOffset = wrapperRect.right - stampRect.right;
      const topOffset = stampRect.top - wrapperRect.top;

      stampOverlay.style.left = 'auto';
      stampOverlay.style.transform = 'none';
      stampOverlay.style.right = `${(rightOffset / wrapperRect.width) * 100}%`;
      stampOverlay.style.top = `${(topOffset / wrapperRect.height) * 100}%`;

      startX = touch.clientX;
      startY = touch.clientY;
      initialRight = rightOffset;
      initialTop = topOffset;

      e.preventDefault();
    }, { passive: false });

    document.addEventListener('touchmove', (e) => {
      if (!isDragging) return;
      const touch = e.touches[0];
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;

      const wrapperRect = canvasWrapper.getBoundingClientRect();
      const stampRect = stampOverlay.getBoundingClientRect();

      let newRight = Math.max(0, Math.min(initialRight - dx, wrapperRect.width - stampRect.width));
      let newTop = Math.max(0, Math.min(initialTop + dy, wrapperRect.height - stampRect.height));

      stampOverlay.style.right = `${(newRight / wrapperRect.width) * 100}%`;
      stampOverlay.style.top = `${(newTop / wrapperRect.height) * 100}%`;
    }, { passive: true });

    document.addEventListener('touchend', () => {
      if (isDragging) {
        isDragging = false;
        stampOverlay.classList.remove('dragging');
        saveStampPosition();
      }
    });

    // Mouse fallback (for testing on desktop)
    stampOverlay.addEventListener('mousedown', (e) => {
      isDragging = true;
      stampOverlay.classList.add('dragging');

      const wrapperRect = canvasWrapper.getBoundingClientRect();
      const stampRect = stampOverlay.getBoundingClientRect();

      const rightOffset = wrapperRect.right - stampRect.right;
      const topOffset = stampRect.top - wrapperRect.top;

      stampOverlay.style.left = 'auto';
      stampOverlay.style.transform = 'none';
      stampOverlay.style.right = `${(rightOffset / wrapperRect.width) * 100}%`;
      stampOverlay.style.top = `${(topOffset / wrapperRect.height) * 100}%`;

      startX = e.clientX;
      startY = e.clientY;
      initialRight = rightOffset;
      initialTop = topOffset;

      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      const wrapperRect = canvasWrapper.getBoundingClientRect();
      const stampRect = stampOverlay.getBoundingClientRect();

      let newRight = Math.max(0, Math.min(initialRight - dx, wrapperRect.width - stampRect.width));
      let newTop = Math.max(0, Math.min(initialTop + dy, wrapperRect.height - stampRect.height));

      stampOverlay.style.right = `${(newRight / wrapperRect.width) * 100}%`;
      stampOverlay.style.top = `${(newTop / wrapperRect.height) * 100}%`;
    });

    document.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        stampOverlay.classList.remove('dragging');
        saveStampPosition();
      }
    });
  }

  function saveStampPosition() {
    const wrapperRect = canvasWrapper.getBoundingClientRect();
    const stampRect = stampOverlay.getBoundingClientRect();
    if (wrapperRect.width > 0 && wrapperRect.height > 0) {
      const rightPct = ((wrapperRect.right - stampRect.right) / wrapperRect.width * 100).toFixed(2);
      const topPct = ((stampRect.top - wrapperRect.top) / wrapperRect.height * 100).toFixed(2);
      localStorage.setItem('packflow_m_stamp_top', topPct);
      localStorage.setItem('packflow_m_stamp_right', rightPct);
    }
  }

  // ══════════════════════════════════════════════════════════
  //  COMPACT PDF GENERATOR (< 80KB, A5 Paper)
  // ══════════════════════════════════════════════════════════

  async function generateCompactPdf() {
    if (!pdfCanvas) { showToast('⚠️ Tidak ada resi untuk di-print', 'error'); return; }

    showToast('⏳ Membuat PDF resi...', 'info');

    // Create a composite canvas: resi + stamp overlay
    const compositeCanvas = document.createElement('canvas');
    compositeCanvas.width = pdfCanvas.width;
    compositeCanvas.height = pdfCanvas.height;
    const ctx = compositeCanvas.getContext('2d');

    // Draw the resi canvas
    ctx.drawImage(pdfCanvas, 0, 0);

    // Draw the stamp text on top
    if (stampOverlay && stampText && stampText.textContent) {
      const wrapperRect = canvasWrapper.getBoundingClientRect();
      const stampRect = stampOverlay.getBoundingClientRect();
      const canvasRect = pdfCanvas.getBoundingClientRect();

      // Calculate stamp position relative to canvas
      const scaleX = pdfCanvas.width / canvasRect.width;
      const scaleY = pdfCanvas.height / canvasRect.height;
      const stampX = (stampRect.left - canvasRect.left) * scaleX;
      const stampY = (stampRect.top - canvasRect.top) * scaleY;

      // Get stamp computed style
      const stampStyle = window.getComputedStyle(stampText);
      const fontSizePx = parseFloat(stampStyle.fontSize) * scaleX;

      ctx.save();
      ctx.font = `900 ${fontSizePx}px ${stampStyle.fontFamily}`;
      ctx.textBaseline = 'top';

      // White outline
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = fontSizePx * 0.12;
      ctx.lineJoin = 'round';
      ctx.strokeText(stampText.textContent, stampX, stampY);

      // Red text
      ctx.fillStyle = '#dc2626';
      ctx.fillText(stampText.textContent, stampX, stampY);
      ctx.restore();
    }

    // Convert to compressed JPEG blob
    const jpegQuality = 0.55; // Start with moderate quality
    let blob = await new Promise(resolve => compositeCanvas.toBlob(resolve, 'image/jpeg', jpegQuality));

    // If still too large, reduce quality further
    if (blob.size > 80000) {
      blob = await new Promise(resolve => compositeCanvas.toBlob(resolve, 'image/jpeg', 0.40));
    }
    if (blob.size > 80000) {
      blob = await new Promise(resolve => compositeCanvas.toBlob(resolve, 'image/jpeg', 0.30));
    }

    // A5 dimensions in points (1 pt = 1/72 inch)
    const A5_W = 419.53; // 148mm
    const A5_H = 595.28; // 210mm

    // Build a minimal PDF manually (no library needed)
    const imgData = await blobToBase64(blob);
    const imgWidth = compositeCanvas.width;
    const imgHeight = compositeCanvas.height;

    // Fit image to A5 width with padding
    const padding = 14; // 14pt padding on sides
    const availW = A5_W - padding * 2;
    const scale = availW / imgWidth;
    const scaledW = imgWidth * scale;
    const scaledH = imgHeight * scale;

    // Center vertically
    const offsetY = Math.max(padding, (A5_H - scaledH) / 2);

    const pdfBytes = buildMinimalPdf(imgData, imgWidth, imgHeight, A5_W, A5_H, padding, offsetY, scaledW, scaledH);

    // Create filename
    const resi = (inputResi && inputResi.value.trim()) || 'resi';
    const label = (inputCustomLabel && inputCustomLabel.value.trim()) || '';
    const fileName = label ? `${resi}_${label}.pdf` : `${resi}.pdf`;

    // Download or share
    const fileBlob = new Blob([pdfBytes], { type: 'application/pdf' });
    const fileSizeKB = (fileBlob.size / 1024).toFixed(1);

    if (navigator.share && navigator.canShare) {
      const file = new File([fileBlob], fileName, { type: 'application/pdf' });
      if (navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: 'Resi PackFlow' });
          showToast(`📤 PDF dibagikan (${fileSizeKB} KB)`, 'success');
          return;
        } catch (e) {
          if (e.name === 'AbortError') return; // User cancelled
        }
      }
    }

    // Fallback: download
    const url = URL.createObjectURL(fileBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`📥 PDF disimpan (${fileSizeKB} KB)`, 'success');
  }

  function blobToBase64(blob) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result.split(',')[1]);
      reader.readAsDataURL(blob);
    });
  }

  function buildMinimalPdf(imgBase64, imgW, imgH, pageW, pageH, padX, padY, dispW, dispH) {
    // Build a raw PDF with embedded JPEG — extremely compact
    const imgBytes = atob(imgBase64);
    const imgLength = imgBytes.length;

    const objects = [];
    let objCount = 0;

    function addObj(content) {
      objCount++;
      objects.push({ id: objCount, content });
      return objCount;
    }

    // 1: Catalog
    const catalogId = addObj('<< /Type /Catalog /Pages 2 0 R >>');
    // 2: Pages
    const pagesId = addObj(`<< /Type /Pages /Kids [3 0 R] /Count 1 >>`);
    // 3: Page
    const pageId = addObj(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW.toFixed(2)} ${pageH.toFixed(2)}] /Contents 4 0 R /Resources << /XObject << /Img 5 0 R >> >> >>`);
    // 4: Content stream
    const cmds = `q ${dispW.toFixed(2)} 0 0 ${dispH.toFixed(2)} ${padX.toFixed(2)} ${(pageH - padY - dispH).toFixed(2)} cm /Img Do Q`;
    const contentId = addObj(`<< /Length ${cmds.length} >>\nstream\n${cmds}\nendstream`);
    // 5: Image XObject
    const imgObjHeader = `<< /Type /XObject /Subtype /Image /Width ${imgW} /Height ${imgH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${imgLength} >>`;
    const imgObjId = addObj(null); // placeholder

    // Build PDF bytes
    let pdf = '%PDF-1.4\n';
    const offsets = [];

    for (let i = 0; i < objects.length; i++) {
      offsets.push(pdf.length);
      const obj = objects[i];
      if (obj.id === imgObjId) {
        pdf += `${obj.id} 0 obj\n${imgObjHeader}\nstream\n`;
        // We'll handle binary separately
      } else {
        pdf += `${obj.id} 0 obj\n${obj.content}\nendobj\n`;
      }
    }

    // Convert string part to bytes, then append image binary, then xref
    const encoder = new TextEncoder();
    const preImgBytes = encoder.encode(pdf);
    const postStream = encoder.encode('\nendstream\nendobj\n');

    // Build xref after we know all offsets
    const xrefOffset = preImgBytes.length + imgLength + postStream.length;
    let xref = `xref\n0 ${objCount + 1}\n`;
    xref += '0000000000 65535 f \n';

    // Recalculate actual byte offsets
    const parts = [];
    let currentOffset = 0;
    const actualOffsets = [];
    const pdfHeader = '%PDF-1.4\n';
    currentOffset = pdfHeader.length;

    for (let i = 0; i < objects.length; i++) {
      actualOffsets.push(currentOffset);
      const obj = objects[i];
      if (obj.id === imgObjId) {
        const header = `${obj.id} 0 obj\n${imgObjHeader}\nstream\n`;
        currentOffset += header.length + imgLength + '\nendstream\nendobj\n'.length;
      } else {
        const entry = `${obj.id} 0 obj\n${obj.content}\nendobj\n`;
        currentOffset += entry.length;
      }
    }

    const xrefStart = currentOffset;
    xref = `xref\n0 ${objCount + 1}\n`;
    xref += '0000000000 65535 f \n';
    for (let i = 0; i < actualOffsets.length; i++) {
      xref += String(actualOffsets[i]).padStart(10, '0') + ' 00000 n \n';
    }
    xref += `trailer\n<< /Size ${objCount + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

    // Assemble final PDF as Uint8Array
    let finalPdf = pdfHeader;
    for (let i = 0; i < objects.length; i++) {
      const obj = objects[i];
      if (obj.id === imgObjId) {
        finalPdf += `${obj.id} 0 obj\n${imgObjHeader}\nstream\n`;
      } else {
        finalPdf += `${obj.id} 0 obj\n${obj.content}\nendobj\n`;
      }
    }

    const beforeImg = encoder.encode(finalPdf);
    const afterImg = encoder.encode('\nendstream\nendobj\n' + xref);

    // Combine: beforeImg + rawJpegBytes + afterImg
    const imgRaw = new Uint8Array(imgLength);
    for (let i = 0; i < imgLength; i++) {
      imgRaw[i] = imgBytes.charCodeAt(i);
    }

    const result = new Uint8Array(beforeImg.length + imgRaw.length + afterImg.length);
    result.set(beforeImg, 0);
    result.set(imgRaw, beforeImg.length);
    result.set(afterImg, beforeImg.length + imgRaw.length);

    return result;
  }

  // ══════════════════════════════════════════════════════════
  //  ACTION BUTTONS (Print & Telegram)
  // ══════════════════════════════════════════════════════════

  const actionBar = document.getElementById('action-bar');

  function updateActionBarState() {
    if (!actionBar) return;
    const hasPdf = !!currentPdfDoc;
    const hasResi = !!(inputResi && inputResi.value.trim() !== '');
    if (hasPdf || hasResi) {
      actionBar.classList.remove('disabled');
    } else {
      actionBar.classList.add('disabled');
    }
  }

  function initActionButtons() {
    updateActionBarState();

    const btnPrint = document.getElementById('btn-print');
    if (btnPrint) {
      btnPrint.addEventListener('click', async () => {
        if (actionBar && actionBar.classList.contains('disabled')) {
          showToast('⚠️ Silakan buka file PDF resi terlebih dahulu', 'error');
          return;
        }
        await generateCompactPdf();
      });
    }

    const btnTelegram = document.getElementById('btn-telegram');
    if (btnTelegram) {
      btnTelegram.addEventListener('click', () => {
        if (actionBar && actionBar.classList.contains('disabled')) {
          showToast('⚠️ Silakan buka file PDF resi terlebih dahulu', 'error');
          return;
        }
        sendToTelegram();
      });
    }
  }

  // ══════════════════════════════════════════════════════════
  //  AUTO-DETECT TRACKING NUMBER (RESI) FROM PDF
  // ══════════════════════════════════════════════════════════

  function detectResiNumber(fullText) {
    if (!fullText) return '';

    // 1. Keyword match (e.g. "No. Resi : SPXID0123456789" or "AWB: JX1234567890")
    const explicitMatch = fullText.match(/(?:No\.?\s*Resi|Waybill|Tracking\s*No|AWB|No\.?\s*AWB)[:\s]*([A-Z0-9]{8,30})/i);
    if (explicitMatch && explicitMatch[1]) {
      const found = explicitMatch[1].trim();
      if (!/^(PESANAN|ORDER|PENERIMA|PENGIRIM|SHOPEE|TOKOPEDIA)$/i.test(found)) {
        return found;
      }
    }

    // 2. Shopee Express (SPXID / ID)
    const spxMatch = fullText.match(/\b(SPXID\d{10,14}|ID\d{12,16})\b/i);
    if (spxMatch) return spxMatch[1].toUpperCase();

    // 3. Pos Indonesia / SHPE format (e.g. SHPE26O0806CB5470D070765)
    const shpeMatch = fullText.match(/\b(SHPE[A-Z0-9]{15,25})\b/i);
    if (shpeMatch) return shpeMatch[1].toUpperCase();

    // 4. J&T Express (JP / JX / TJNT / 88...)
    const jntMatch = fullText.match(/\b(JP\d{10,12}|JX\d{10,12}|TJNT\d{10,12}|88\d{10,12})\b/i);
    if (jntMatch) return jntMatch[1].toUpperCase();

    // 5. SiCepat (00... / 004... / 002... 12 digits)
    const sicepatMatch = fullText.match(/\b(00\d{10,11})\b/);
    if (sicepatMatch) return sicepatMatch[1];

    // 6. Ninja Xpress (NLID...)
    const ninjaMatch = fullText.match(/\b(NLID\d{10,14}|NLID[A-Z0-9]{10,14})\b/i);
    if (ninjaMatch) return ninjaMatch[1].toUpperCase();

    // 7. JNE (JT... / CM... / 01... / 10...)
    const jneMatch = fullText.match(/\b(JT\d{10}|CM\d{10}|01\d{14}|10\d{13})\b/i);
    if (jneMatch) return jneMatch[1].toUpperCase();

    // 8. Tokopedia AWB (TKP...)
    const tkpMatch = fullText.match(/\b(TKP\d{10,14}|TKP[A-Z0-9]{10,14})\b/i);
    if (tkpMatch) return tkpMatch[1].toUpperCase();

    // 9. Generic Alphanumeric Resi (10-24 characters)
    const genericMatch = fullText.match(/\b([A-Z]{2,4}\d{8,18}[A-Z0-9]*)\b/);
    if (genericMatch) return genericMatch[1];

    return '';
  }

  // ══════════════════════════════════════════════════════════
  //  PDF TEXT EXTRACTION & SKU PARSING
  // ══════════════════════════════════════════════════════════

  function extractTextAndParseData() {
    if (!currentPdfDoc) return;

    parsedData = {
      resiNo: '',
      orderNo: '',
      cityName: '',
      items: [],
      totalQty: 0,
      generatedLabel: ''
    };

    let activeWhitelist = defaultWhitelist;
    const presetVal = selectWhitelist ? selectWhitelist.value : 'DEFAULT';
    if (presetVal === 'TOP_SKU') {
      activeWhitelist = ["AMP", "AQU", "SQU", "WNT", "KAM", "IFI"];
    } else if (presetVal === 'CUSTOM' && inputWhitelist) {
      const arr = inputWhitelist.value.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
      if (arr.length > 0) activeWhitelist = arr;
    }

    const ignoredArr = (inputIgnored ? inputIgnored.value : '')
      .split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
    const activeIgnored = ignoredArr.length > 0 ? ignoredArr : defaultIgnored;

    currentPdfDoc.getPage(1).then(page => {
      page.getTextContent().then(textContent => {
        const textItems = textContent.items.map(item => item.str);
        const fullText = textItems.join(' ');

        // 1. Auto Resi Detection
        const detectedResi = detectResiNumber(fullText);
        if (detectedResi) {
          parsedData.resiNo = detectedResi;
          if (inputResi) inputResi.value = detectedResi;
        }

        // 2. Order Number Auto Detection
        let orderFound = '';
        const orderMatch = fullText.match(/(?:No\.?\s*Pesanan|Order\s*ID|No\.?\s*Order|ID\s*Pesanan)[:\s#]*([A-Z0-9]{10,25})/i);
        if (orderMatch && orderMatch[1]) {
          orderFound = orderMatch[1].trim();
        }

        // Fallback for Shopee order numbers (e.g. 260828HMJJYAXJ, 260901USA40NCB)
        if (!orderFound) {
          const shopeeOrderMatch = fullText.match(/\b(2[4-9]\d{4}[A-Z0-9]{7,14})\b/);
          if (shopeeOrderMatch) {
            orderFound = shopeeOrderMatch[1].trim();
          }
        }

        if (orderFound) {
          parsedData.orderNo = orderFound;
          if (inputOrderNo) inputOrderNo.value = orderFound;
        }

        // 3. City Extraction
        let cityFound = '';
        const rightItems = textContent.items.filter(item => item.transform && item.transform[4] > 220);
        const rightText = rightItems.map(item => item.str).join(' ');

        const cityRegexes = [
          /(?:KOTA|KAB\.?|KABUPATEN)\s+[A-Z\s.-]+?(?=\s*\d{5,}|\s*\(|\s*62|\s*08|\s*$|\s*PENGIRIM|\s*PENERIMA|\s*ECO|\s*REG|\s*COD|\s*SPX|\s*WAJIB)/i,
          /\b((?:KOTA|KAB\.|KABUPATEN)\s+[A-Z]+(?:\s+[A-Z]+)?)/i
        ];

        for (const rg of cityRegexes) {
          const m = rightText.match(rg);
          if (m) {
            const cleaned = cleanCityName(m[0] || m[1]);
            if (cleaned && cleaned !== '-') { cityFound = cleaned; break; }
          }
        }

        if (!cityFound) {
          for (const rg of cityRegexes) {
            const m = fullText.match(rg);
            if (m) {
              const cleaned = cleanCityName(m[0] || m[1]);
              if (cleaned && cleaned !== '-') { cityFound = cleaned; break; }
            }
          }
        }

        parsedData.cityName = mapWarehouseAlias(cityFound || 'KOTA');

        // Date for title
        const today = new Date();
        const dd = String(today.getDate()).padStart(2, '0');
        const mm = String(today.getMonth() + 1).padStart(2, '0');
        const yy = String(today.getFullYear()).slice(-2);
        document.title = `${parsedData.cityName}_${dd}${mm}${yy}`;

        // 4. SKU Extraction
        let tableHeaderIdx = -1;
        textContent.items.forEach((item, idx) => {
          const u = item.str.trim().toUpperCase();
          if (u === 'SKU' || u === 'VARIASI' || u === 'QTY' || u === 'NAMA PRODUK' || u.includes('SKU') || u.includes('VARIASI')) {
            if (tableHeaderIdx === -1) tableHeaderIdx = idx;
          }
        });

        const productItems = tableHeaderIdx !== -1 ? textContent.items.slice(tableHeaderIdx) : textContent.items;

        productItems.forEach((itemObj, i) => {
          const line = itemObj.str;
          const upperLine = line.trim().toUpperCase();
          if (!upperLine) return;

          if (activeIgnored.some(ig => upperLine.includes(ig))) return;

          activeWhitelist.forEach(wl => {
            if (upperLine.includes(wl)) {
              let qty = 1;
              const qtyMatch = upperLine.match(/(\d+)\s*X|QTY\s*:\s*(\d+)|^(\d+)\s*[-_]/);
              if (qtyMatch) {
                qty = parseInt(qtyMatch[1] || qtyMatch[2] || qtyMatch[3]) || 1;
              } else {
                for (let k = 1; k <= 3; k++) {
                  const next = productItems[i + k];
                  if (next && /^\d+$/.test(next.str.trim())) {
                    const parsed = parseInt(next.str.trim(), 10);
                    if (parsed > 0 && parsed < 100) { qty = parsed; break; }
                  }
                }
              }

              const existing = parsedData.items.find(item => item.sku === wl);
              if (existing) {
                existing.qty += qty;
              } else {
                parsedData.items.push({ sku: wl, name: line.trim(), qty: qty });
              }
              parsedData.totalQty += qty;
            }
          });
        });

        if (parsedData.items.length === 0 && currentPdfDoc) {
          parsedData.items = [{ sku: 'AMP', name: 'Sampel Produk AMP', qty: 1 }];
          parsedData.totalQty = 1;
        }

        updateSidebarUI();
      });
    });
  }

  // ══════════════════════════════════════════════════════════
  //  UI UPDATE
  // ══════════════════════════════════════════════════════════

  function updateSidebarUI() {
    if (txtCity) txtCity.textContent = parsedData.cityName || '-';
    buildLabelStamp();
  }

  // ══════════════════════════════════════════════════════════
  //  LABEL STAMP GENERATION
  // ══════════════════════════════════════════════════════════

  function buildLabelStamp() {
    const suffix = (inputSuffix ? inputSuffix.value.trim() : '') || 'ARY';

    if (parsedData.items.length > 0) {
      const parts = parsedData.items.map(i => `${i.qty}-${i.sku}`);
      parsedData.generatedLabel = `${parts.join('+')}-${suffix}`;
    } else {
      parsedData.generatedLabel = '';
    }

    if (inputCustomLabel) inputCustomLabel.value = parsedData.generatedLabel;
    if (stampText) stampText.textContent = parsedData.generatedLabel;
    updateTotalsFromStamp(parsedData.generatedLabel);
  }

  function updateTotalsFromStamp(text) {
    if (!text) {
      if (txtTotalSku) txtTotalSku.textContent = '-';
      if (txtTotalQty) txtTotalQty.textContent = '-';
      return;
    }
    const suffix = (inputSuffix ? inputSuffix.value.trim() : 'ARY').toUpperCase();
    let clean = text.trim();
    if (suffix && clean.toUpperCase().endsWith('-' + suffix)) {
      clean = clean.slice(0, -(suffix.length + 1)).trim();
    }

    let totalQty = 0;
    const skus = new Set();
    const matches = Array.from(clean.matchAll(/(\d+)\s*[-_,+]?\s*([A-Z0-9]+)/gi));
    for (const m of matches) {
      const q = parseInt(m[1], 10);
      const s = m[2].toUpperCase();
      if (!isNaN(q) && q > 0) { skus.add(s); totalQty += q; }
    }

    let totalSku = skus.size;
    if (totalSku === 0 && parsedData.items.length > 0) {
      totalSku = parsedData.items.length;
      totalQty = parsedData.totalQty;
    }

    if (txtTotalSku) txtTotalSku.textContent = (totalSku > 0) ? totalSku : '-';
    if (txtTotalQty) txtTotalQty.textContent = (totalQty > 0) ? `${totalQty} Pcs` : '-';
  }

  // ══════════════════════════════════════════════════════════
  //  PDF RENDER ENGINE (Auto-Fit Mobile Screen Width)
  // ══════════════════════════════════════════════════════════

  function renderPdfPage() {
    if (!currentPdfDoc) return;

    currentPdfDoc.getPage(1).then(page => {
      // Available width in container
      let availableWidth = 340;
      if (canvasScroll && canvasScroll.clientWidth > 40) {
        availableWidth = canvasScroll.clientWidth - 12;
      }

      // Unscaled page dimensions in points (72dpi)
      const unscaledViewport = page.getViewport({ scale: 1.0 });

      let labelPtW = unscaledViewport.width;
      let labelPtH = unscaledViewport.height;

      if (isCropped) {
        labelPtW = (cropConfig.rightRatio - cropConfig.leftRatio) * unscaledViewport.width;
        labelPtH = (cropConfig.bottomRatio - cropConfig.topRatio) * unscaledViewport.height;
      }

      // Base scale so the label width fits available container width 100%
      const fitScale = availableWidth / labelPtW;
      const userZoomFactor = (typeof zoomLevelPct !== 'undefined' ? zoomLevelPct : 100) / 100;

      const finalCssW = availableWidth * userZoomFactor;
      const finalCssH = (labelPtH * fitScale) * userZoomFactor;

      // HD Ultra Sharp rendering scale (High DPI DPR)
      const dpr = Math.max(window.devicePixelRatio || 1, 2.5);
      const renderScale = fitScale * userZoomFactor * dpr;

      const viewport = page.getViewport({ scale: renderScale });
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = viewport.width;
      tempCanvas.height = viewport.height;

      const tempCtx = tempCanvas.getContext('2d');
      tempCtx.imageSmoothingEnabled = true;
      tempCtx.imageSmoothingQuality = 'high';

      page.render({ canvasContext: tempCtx, viewport }).promise.then(() => {
        let cropX = 0, cropY = 0;
        let finalW = viewport.width;
        let finalH = viewport.height;

        if (isCropped) {
          cropX = cropConfig.leftRatio * viewport.width;
          cropY = cropConfig.topRatio * viewport.height;
          finalW = (cropConfig.rightRatio - cropConfig.leftRatio) * viewport.width;
          finalH = (cropConfig.bottomRatio - cropConfig.topRatio) * viewport.height;
        }

        // Internal high resolution canvas dimensions
        pdfCanvas.width = finalW;
        pdfCanvas.height = finalH;

        const ctx = pdfCanvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.clearRect(0, 0, finalW, finalH);
        ctx.drawImage(tempCanvas, cropX, cropY, finalW, finalH, 0, 0, finalW, finalH);

        if (canvasWrapper) {
          canvasWrapper.style.width = `${Math.round(finalCssW)}px`;
          canvasWrapper.style.height = `${Math.round(finalCssH)}px`;
          pdfCanvas.style.width = '100%';
          pdfCanvas.style.height = '100%';
        }
      }).catch(err => console.error('Render error:', err));
    });
  }

  window.addEventListener('resize', () => {
    if (currentPdfDoc) renderPdfPage();
  });

  // ══════════════════════════════════════════════════════════
  //  COMPOSITE CANVAS (Canvas + Stamp Overlay)
  // ══════════════════════════════════════════════════════════

  function getCompositeCanvas() {
    if (!pdfCanvas || pdfCanvas.width === 0) return null;
    const combined = document.createElement('canvas');
    combined.width = pdfCanvas.width;
    combined.height = pdfCanvas.height;

    const ctx = combined.getContext('2d');
    ctx.drawImage(pdfCanvas, 0, 0);

    if (stampOverlay && stampOverlay.style.display !== 'none') {
      const text = stampText.textContent.trim();
      if (text) {
        const wrapperRect = canvasWrapper.getBoundingClientRect();
        const textRect = stampText.getBoundingClientRect();

        const scaleX = pdfCanvas.width / wrapperRect.width;
        const scaleY = pdfCanvas.height / wrapperRect.height;

        const rightMargin = (wrapperRect.right - textRect.right) * scaleX;
        const topMid = (textRect.top - wrapperRect.top + textRect.height / 2) * scaleY;

        const fontSize = parseFloat(window.getComputedStyle(stampText).fontSize) * scaleY;

        ctx.save();
        ctx.font = `900 ${fontSize}px "Plus Jakarta Sans", "Arial Black", Arial, sans-serif`;
        ctx.fillStyle = '#dc2626';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, pdfCanvas.width - rightMargin, topMid);
        ctx.restore();
      }
    }
    return combined;
  }

  // ══════════════════════════════════════════════════════════
  //  TELEGRAM CAPTION & SEND
  // ══════════════════════════════════════════════════════════

  function getTelegramCaption() {
    const resi = ((inputResi ? inputResi.value : '') || parsedData.resiNo || 'RESI').replace(/[#\s]+/g, '');
    let label = (inputCustomLabel ? inputCustomLabel.value.trim() : '') || parsedData.generatedLabel || '';

    const suffix = (inputSuffix ? inputSuffix.value.trim() : 'ARY').toUpperCase();
    if (suffix && label.toUpperCase().endsWith('-' + suffix)) {
      label = label.slice(0, -(suffix.length + 1)).trim();
    }
    label = label.replace(/[-+]/g, ',');
    return `${resi},${label}`;
  }

  function canvasToPdfBlob(canvas) {
    const imgDataUrl = canvas.toDataURL('image/jpeg', 0.95);
    const base64Data = imgDataUrl.split(',')[1];
    const imgBytes = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));

    const wPt = (canvas.width / 96) * 72;
    const hPt = (canvas.height / 96) * 72;

    const enc = new TextEncoder();
    const h = enc.encode(`%PDF-1.4\n`);
    const o1 = enc.encode(`1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`);
    const o2 = enc.encode(`2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n`);
    const o3 = enc.encode(`3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${wPt.toFixed(2)} ${hPt.toFixed(2)}] /Resources << /XObject << /Im1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n`);
    const o4h = enc.encode(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${imgBytes.length} >>\nstream\n`);
    const o4f = enc.encode(`\nendstream\nendobj\n`);
    const sc = `q ${wPt.toFixed(2)} 0 0 ${hPt.toFixed(2)} 0 0 cm /Im1 Do Q`;
    const o5 = enc.encode(`5 0 obj\n<< /Length ${sc.length} >>\nstream\n${sc}\nendstream\nendobj\n`);

    const offsets = [0];
    let pos = h.length;
    offsets.push(pos); pos += o1.length;
    offsets.push(pos); pos += o2.length;
    offsets.push(pos); pos += o3.length;
    offsets.push(pos); pos += o4h.length + imgBytes.length + o4f.length;
    offsets.push(pos);

    let xr = `xref\n0 6\n0000000000 65535 f \n`;
    for (let i = 1; i <= 5; i++) xr += String(offsets[i]).padStart(10, '0') + ` 00000 n \n`;
    xr += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${pos + o5.length}\n%%EOF`;

    const xrEnc = enc.encode(xr);
    const total = new Uint8Array(pos + o5.length + xrEnc.length);
    let p = 0;
    [h, o1, o2, o3, o4h].forEach(a => { total.set(a, p); p += a.length; });
    total.set(imgBytes, p); p += imgBytes.length;
    [o4f, o5, xrEnc].forEach(a => { total.set(a, p); p += a.length; });

    return new Blob([total], { type: 'application/pdf' });
  }

  async function sendToTelegram() {
    const defaultToken = '8738468752:AAHlbWtnuwqnUYLtmPCYqeYrw3eJ-3wqTB0';
    const botToken = (inputTgBotToken ? inputTgBotToken.value.trim() : '') || localStorage.getItem('packflow_m_tg_token') || defaultToken;
    const chatId = (inputTgChatId ? inputTgChatId.value.trim() : '') || localStorage.getItem('packflow_m_tg_chat');

    if (!chatId) {
      showToast('⚠️ Masukkan Telegram Chat ID di Setelan!', 'error');
      const settingsTab = document.querySelector('[data-tab="settings"]');
      if (settingsTab) settingsTab.click();
      return;
    }

    const composite = getCompositeCanvas();
    if (!composite) {
      showToast('⚠️ Buka file PDF terlebih dahulu!', 'error');
      return;
    }

    const btn = document.getElementById('btn-telegram');
    if (btn) btn.disabled = true;
    showToast('🚀 Mengirim ke Telegram...', 'info');

    try {
      const pdfBlob = canvasToPdfBlob(composite);
      const fileName = `${document.title || 'Resi'}.pdf`;

      const formData = new FormData();
      formData.append('chat_id', chatId);
      formData.append('document', pdfBlob, fileName);
      formData.append('caption', getTelegramCaption());

      const res = await fetch(`https://api.telegram.org/bot${botToken}/sendDocument`, {
        method: 'POST', body: formData
      });
      const result = await res.json();

      if (result.ok) {
        showToast('✅ Berhasil kirim ke Telegram!', 'success');
        sendToGoogleSheets(true);
      } else {
        showToast(`❌ Gagal: ${result.description || 'Error'}`, 'error');
      }
    } catch (err) {
      showToast(`❌ Error: ${err.message}`, 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  // ══════════════════════════════════════════════════════════
  //  GOOGLE SHEETS WEBHOOK
  // ══════════════════════════════════════════════════════════

  async function sendToGoogleSheets(silent = false) {
    const webhookUrl = (inputWebhookUrl ? inputWebhookUrl.value.trim() : '') || localStorage.getItem('packflow_m_webhook') || '';
    if (!webhookUrl) return false;

    const resiNo = (inputResi ? inputResi.value.trim() : '') || parsedData.resiNo || '-';
    const orderNo = (inputOrderNo ? inputOrderNo.value.trim() : '') || parsedData.orderNo || '-';
    const stampLabel = (inputCustomLabel ? inputCustomLabel.value.trim() : '') || parsedData.generatedLabel || '-';

    const rowData = [{
      orderNo, stampLabel, resiNo, warehouse: parsedData.cityName || '-',
      shopName: (inputDefaultShopName ? inputDefaultShopName.value.trim() : '') || 'HERBAL TV OFFICIAL'
    }];

    try {
      await fetch(webhookUrl, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(rowData)
      });
      if (!silent) showToast('✅ Data terkirim ke Google Sheets!', 'success');
      return true;
    } catch (err) {
      if (!silent) showToast(`❌ Gagal kirim: ${err.message}`, 'error');
      return false;
    }
  }

  // ══════════════════════════════════════════════════════════
  //  UTILITIES
  // ══════════════════════════════════════════════════════════

  const DEFAULT_WAREHOUSE_ALIASES_TEXT = `JAKARTA BARAT=JAKBAR
JAKARTA SELATAN=JAKSEL
JAKARTA TIMUR=JAKTIM
JAKARTA UTARA=JAKUT
JAKARTA PUSAT=JAKPUS
KOTA BEKASI=KTBEKASI
BEKASI=BEKASI
KABUPATEN BEKASI=BEKASI
KAB. BEKASI=BEKASI
TASIKMALAYA=TASIK
TASIK=TASIK
YOGYAKARTA=JOGJA
JOGJA=JOGJA
SLEMAN=JOGJA
BANTUL=JOGJA
SURAKARTA=SOLO
SOLO=SOLO
BANDUNG=BANDUNG
BANJARMASIN=BANJARMASIN
BANYUMAS=BANYUMAS
BOGOR=BOGOR
JEMBER=JEMBER
KUDUS=KUDUS
LAMPUNG=LAMPUNG
MADIUN=MADIUN
MAKASSAR=MAKASSAR
MALANG=MALANG
MATARAM=MATARAM
MEDAN=MEDAN
PADANG=PADANG
PALEMBANG=PALEMBANG
PALU=PALU
PEKANBARU=PEKANBARU
SAMARINDA=SAMARINDA
SEMARANG=SEMARANG
SERANG=SERANG
SURABAYA=SURABAYA
TANGERANG=TANGERANG`;

  function getWarehouseAliasText() {
    return localStorage.getItem('packflow_m_warehouse_aliases') || DEFAULT_WAREHOUSE_ALIASES_TEXT;
  }

  function cleanCityName(raw) {
    if (!raw || raw === '-' || raw === 'KOTA') return '-';
    let str = raw.toString().toUpperCase().trim();

    const cutPunct = str.split(/[,|\-\/\\():;]/)[0].trim();
    if (cutPunct && cutPunct.length > 3) str = cutPunct;

    const noiseRegex = /\b(OFFICIAL|SHOP|STORE|HERBAL|TV|ONLINE|TOKOPEDIA|SHOPEE|LAZADA|TIKTOK|SELLER|GUDANG|PENGIRIM|PENERIMA|NO|TELP|ALAMAT|DESTINASI|SHIP|HUB|COD|NON-COD|ECO|REG|SPX|GROSIR|RESELLER|MART|DISTRIBUTOR|SUPPLIER)\b.*/gi;
    str = str.replace(noiseRegex, '').trim();

    const prefixMatch = str.match(/\b(KOTA|KAB\.|KABUPATEN|KAB)\s+([A-Z.\s]+)/i);
    if (prefixMatch) {
      const prefix = prefixMatch[1].toUpperCase();
      const words = prefixMatch[2].trim().split(/\s+/);
      const valid = [];
      for (const w of words) {
        const c = w.replace(/[^A-Z.]/g, '');
        if (!c) continue;
        if (['JAWA', 'SUMATERA', 'SULAWESI', 'KALIMANTAN', 'BALI', 'DI', 'DKI', 'NUSA', 'PAPUA', 'ID', 'IDN', 'INDONESIA'].includes(c)) break;
        valid.push(c);
        if (valid.length >= 3) break;
      }
      if (valid.length > 0) return `${prefix} ${valid.join(' ')}`;
    }

    str = str.replace(/[^A-Z.\s]/gi, '').replace(/\s+/g, ' ').trim();
    const parts = str.split(' ');
    if (parts.length > 0 && parts[0].length >= 3) return parts.slice(0, 2).join(' ');
    return '-';
  }

  function mapWarehouseAlias(raw) {
    if (!raw || raw === '-' || raw === 'KOTA') return '-';
    let str = cleanCityName(raw).toUpperCase();

    const aliasText = getWarehouseAliasText();
    const lines = aliasText.split('\n');

    for (const line of lines) {
      const parts = line.split('=');
      if (parts.length >= 2 && str === parts[1].trim().toUpperCase()) return parts[1].trim().toUpperCase();
    }

    for (const line of lines) {
      const parts = line.split('=');
      if (parts.length >= 2 && str === parts[0].trim().toUpperCase()) return parts[1].trim().toUpperCase();
    }

    for (const line of lines) {
      const parts = line.split('=');
      if (parts.length >= 2 && str.includes(parts[0].trim().toUpperCase())) return parts[1].trim().toUpperCase();
    }

    return str.replace(/^(KOTA|KAB\.|KABUPATEN)\s+/i, '').trim() || '-';
  }

  // ── PWA Install Prompt Handler ──
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
  });

  // ── Copy Helper ──
  function copyInputValue(inputId, labelName) {
    const input = document.getElementById(inputId);
    if (!input || !input.value.trim()) {
      showToast(`⚠️ Tidak ada ${labelName} untuk disalin`, 'error');
      return;
    }
    const val = input.value.trim();
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(val).then(() => {
        showToast(`📋 ${labelName} berhasil disalin!`, 'success');
      }).catch(() => {
        fallbackCopyText(input, labelName);
      });
    } else {
      fallbackCopyText(input, labelName);
    }
  }

  function fallbackCopyText(input, labelName) {
    input.select();
    try {
      document.execCommand('copy');
      showToast(`📋 ${labelName} berhasil disalin!`, 'success');
    } catch (err) {
      showToast(`❌ Gagal menyalin ${labelName}`, 'error');
    }
  }

  // ── Toast ──
  let toastTimer = null;
  function showToast(msg, type = 'info') {
    if (toastTimer) clearTimeout(toastTimer);
    toastEl.textContent = msg;
    toastEl.className = `toast ${type} show`;
    toastTimer = setTimeout(() => {
      toastEl.classList.remove('show');
    }, 2500);
  }

})();
