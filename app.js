/* =========================================================
   Garment Costing PWA — Factory-style FOB Costing Wizard
   ---------------------------------------------------------
   Goals:
   - Multi-step wizard (one value at a time)
   - Spreadsheet-accurate garment FOB logic (dozen -> piece)
   - Offline-ready + IndexedDB persistence + audit timestamps
   - Safe validation (no negatives, percent caps)
   - Export: PDF (print), PNG/JPG (share card)
   ========================================================= */

(() => {
  'use strict';

  // ===========
  // Versions (audit)
  // ===========
  const APP_VERSION = '2.0.0';
  const CALC_VERSION = 'factorySheet_v1';

  // ===========
  // Constants
  // ===========
  const DRAFT_ID = 'current';
  const DEFAULT_CURRENCY = '$';
  
  // Fixed ROC (factory standard)
  const FIXED_ROC_PCT = 2.5;
const WEIGHT_GM_PER_LB = 453.6;
  const PIECES_PER_DOZEN = 12;
  const GM_PER_LB_PER_PIECE_IN_DOZEN = WEIGHT_GM_PER_LB / PIECES_PER_DOZEN; // 37.8
  const GAUGE_OPTIONS = [3, 5, 7, 12];

  // ===========
  // DOM helpers
  // ===========
  const $ = (sel, root = document) => root.querySelector(sel);

  function show(el) { el?.classList.remove('hidden'); }
  function hide(el) { el?.classList.add('hidden'); }

  function escapeHtml(str) {
    return String(str ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function formatDate(iso) {
    try {
      const d = new Date(iso);
      return d.toLocaleString(undefined, {
        year: 'numeric', month: 'short', day: '2-digit',
        hour: '2-digit', minute: '2-digit'
      });
    } catch {
      return String(iso ?? '');
    }
  }

  function round2(n) {
    const x = Number(n);
    if (!Number.isFinite(x)) return 0;
    return Math.round((x + Number.EPSILON) * 100) / 100;
  }

  function toNum(v) {
    if (v === '' || v === null || v === undefined) return 0;
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  function toNumOrNull(v) {
    if (v === '' || v === null || v === undefined) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function formatMoney(n, currency) {
    const c = currency || DEFAULT_CURRENCY;
    const v = round2(n);
    return `${c}${v.toFixed(2)}`;
  }

  function formatPlain(n, decimals = 2) {
    const v = Number(n);
    if (!Number.isFinite(v)) return '—';
    return v.toFixed(decimals);
  }

  function uuid() {
    // Business-safe: use crypto if available
    if (crypto?.randomUUID) return crypto.randomUUID();
    return 'id-' + Math.random().toString(16).slice(2) + '-' + Date.now().toString(16);
  }

  // ===========
  // Views
  // ===========
  const viewList = $('#viewList');
  const viewWizard = $('#viewWizard');
  const viewDetail = $('#viewDetail');

  const btnNew = $('#btnNew');
  const btnNewEmpty = $('#btnNewEmpty');

  function showView(view) {
    [viewList, viewWizard, viewDetail].forEach(v => v?.classList.remove('view--active'));
    view?.classList.add('view--active');
    // Scroll to top for mobile wizard experience
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  // ===========
  // List view DOM
  // ===========
  const draftBanner = $('#draftBanner');
  const searchInput = $('#searchInput');
  const btnExport = $('#btnExport');
  const btnImport = $('#btnImport');
  const importFile = $('#importFile');
  const emptyState = $('#emptyState');
  const productList = $('#productList');

  // ===========
  // Wizard DOM
  // ===========
  const wizardError = $('#wizardError');
  const wizardStepLabel = $('#wizardStepLabel');
  const wizardStepCount = $('#wizardStepCount');
  const wizardProgressFill = $('#wizardProgressFill');
  const wizardTitleLine = $('#wizardTitleLine');
  const wizardBody = $('#wizardBody');

  const btnWizardCancel = $('#btnWizardCancel');
  const btnPrev = $('#btnPrev');
  const btnNext = $('#btnNext');

  // ===========
  // Detail DOM
  // ===========
  const detailMeta = $('#detailMeta');
  const detailCard = $('#detailCard');

  const btnBackFromDetail = $('#btnBackFromDetail');
  const btnDuplicate = $('#btnDuplicate');
  const btnDeleteProduct = $('#btnDeleteProduct');
  const btnDownloadPdf = $('#btnDownloadPdf');
  const btnDownloadPng = $('#btnDownloadPng');
  const btnDownloadJpg = $('#btnDownloadJpg');

  const printRoot = $('#printRoot');

  // ===========
  // App state
  // ===========
  let productsCache = [];
  let currentDetail = null;

  // Draft/wizard state (survives refresh via IndexedDB draft record)
  let wizardState = null;
  let wizardStepIndex = 0;

  // ===========
  // Calculation (Factory sheet logic)
  // ===========
  function computeAll(s) {
    // Weight gm is the weight per piece
    const weightGm = toNum(s.weightGm);
    const wastagePct = toNum(s.wastagePct);
    const yarnPricePerLb = toNum(s.yarnPricePerLb);

    const lbsPerDoz = weightGm > 0 ? (weightGm / GM_PER_LB_PER_PIECE_IN_DOZEN) : null;
    const lbsWithWastage = (lbsPerDoz !== null) ? (lbsPerDoz * (1 + wastagePct / 100)) : null;

    const yarnCostDoz = (lbsWithWastage !== null) ? (yarnPricePerLb * lbsWithWastage) : null;

    const accessoriesCostDoz = toNum(s.accessoriesCostDoz);
    const fabricDoz = toNum(s.fabricDoz);
    const fabricCostDoz = toNum(s.fabricCostDoz);
    const fabricAttachCostDoz = toNum(s.fabricAttachCostDoz);
    const cmDoz = toNum(s.cmDoz);

    const totalDoz = (yarnCostDoz ?? 0) + accessoriesCostDoz + fabricDoz + fabricCostDoz + fabricAttachCostDoz + cmDoz;
    const fobPerPc = round2(totalDoz / PIECES_PER_DOZEN);

    const rocPct = FIXED_ROC_PCT; // locked per factory standard
    const finalPerPc = round2(fobPerPc * (1 + rocPct / 100));

    return {
      lbsPerDoz,
      lbsWithWastage,
      yarnCostDoz,
      totalDoz,
      fobPerPc,
      finalPerPc,
      rocPct,
    };
  }

  // ===========
  // Validation
  // ===========
  function showWizardError(msg) {
    if (!wizardError) return;
    wizardError.textContent = msg;
    show(wizardError);
  }

  function clearWizardError() {
    if (!wizardError) return;
    hide(wizardError);
    wizardError.textContent = '';
  }

  function isPercentValid(x) {
    const n = Number(x);
    return Number.isFinite(n) && n >= 0 && n <= 100;
  }

  function isNonNegativeNumber(x) {
    const n = Number(x);
    return Number.isFinite(n) && n >= 0;
  }

  function validateStep(step, s) {
    // Returns { ok: boolean, message?: string }
    if (step.kind === 'style') {
      if (!String(s.styleName || '').trim()) return { ok: false, message: 'Style Name is required.' };
      if (!String(s.yarnDesc || '').trim()) return { ok: false, message: 'Yarn Description is required.' };
      if (!s.photo?.blob) return { ok: false, message: 'Product Photo is required.' };
      if (!GAUGE_OPTIONS.includes(Number(s.gauge))) return { ok: false, message: 'Please select a Gauge.' };
      if (!(toNum(s.weightGm) > 0)) return { ok: false, message: 'Garment Weight (grams) must be greater than 0.' };
      return { ok: true };
    }

    if (step.kind === 'number' || step.kind === 'moneyDoz' || step.kind === 'int') {
      const v = (s[step.key] ?? '');
      if (step.required) {
        if (v === '' || v === null || v === undefined) return { ok: false, message: `${step.title} is required.` };
      }
      if (v === '' || v === null || v === undefined) return { ok: true }; // optional blank => ok
      if (!isNonNegativeNumber(v)) return { ok: false, message: `${step.title} must be a non-negative number.` };
      if (step.kind === 'int' && !Number.isInteger(Number(v))) return { ok: false, message: `${step.title} must be a whole number.` };
      return { ok: true };
    }

    if (step.kind === 'percent') {
      const v = (s[step.key] ?? '');
      if (step.required && (v === '' || v === null || v === undefined)) return { ok: false, message: `${step.title} is required.` };
      if (v === '' || v === null || v === undefined) return { ok: true };
      if (!isPercentValid(v)) return { ok: false, message: `${step.title} must be between 0 and 100.` };
      return { ok: true };
    }

    // computed/preview always ok
    return { ok: true };
  }

  // ===========
  // Image compression
  // ===========
  async function compressImage(fileOrBlob, maxSize = 1024, quality = 0.82) {
    const blob = (fileOrBlob instanceof Blob) ? fileOrBlob : new Blob([fileOrBlob]);
    const dataUrl = await blobToDataUrl(blob);

    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = dataUrl;
    });

    const { width, height } = img;

    const scale = Math.min(1, maxSize / Math.max(width, height));
    const targetW = Math.max(1, Math.round(width * scale));
    const targetH = Math.max(1, Math.round(height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;

    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.drawImage(img, 0, 0, targetW, targetH);

    const outBlob = await new Promise((resolve) => {
      canvas.toBlob((b) => resolve(b), 'image/jpeg', quality);
    });

    return { blob: outBlob, width: targetW, height: targetH, type: 'image/jpeg' };
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result || ''));
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  }

  // ===========
  // Draft persistence (IndexedDB)
  // ===========
  async function loadDraft() {
    try {
      const d = await window.GCDB.getDraft(DRAFT_ID);
      return d?.data || null;
    } catch {
      return null;
    }
  }

  async function saveDraft(state) {
    try {
      await window.GCDB.putDraft({ id: DRAFT_ID, updatedAt: new Date().toISOString(), data: state });
    } catch (e) {
      console.warn('Draft save failed', e);
    }
  }

  async function clearDraft() {
    try {
      await window.GCDB.clearDraft(DRAFT_ID);
    } catch (e) {
      console.warn('Draft clear failed', e);
    }
  }

  // ===========
  // Wizard definitions
  // ===========
  const STEPS = [
    {
      id: 'styleInfo',
      kind: 'style',
      title: 'STEP 1: Basic Style Information',
      hint: 'All fields are required. This is the base style data for all calculations.',
    },

    { id: 'yarnPricePerLb', kind: 'number', key: 'yarnPricePerLb', required: true, title: 'Yarn price / LBS', hint: 'Enter yarn price per pound (LBS).' },
    { id: 'weightGm', kind: 'number', key: 'weightGm', required: true, title: 'Garments Weight (grams)', hint: 'Weight per piece in grams (gm).' },

    { id: 'lbsPerDoz', kind: 'computed', title: 'Garments Weight (LBS / Doz)', hint: 'Auto-calculated: LBS/Doz = Weight(gm) ÷ 37.8' },
    { id: 'wastagePct', kind: 'percent', key: 'wastagePct', required: true, title: 'Wastage %', hint: 'Enter wastage percentage (0–100).' },

    { id: 'lbsWithWastage', kind: 'computed', title: 'Garments Weight LBS (Including Wastage @ %)', hint: 'Auto-calculated: LBS incl wastage = LBS/Doz × (1 + Wastage%)' },
    { id: 'yarnCostDoz', kind: 'computed', title: 'Yarn Cost', hint: 'Auto-calculated: Yarn Cost = Yarn Price/LBS × LBS (incl wastage).' },

    { id: 'accessoriesCostDoz', kind: 'moneyDoz', key: 'accessoriesCostDoz', required: false, title: 'Accessories Cost', hint: 'Enter cost per DOZEN. Blank is treated as 0.' },
    { id: 'fabricDoz', kind: 'moneyDoz', key: 'fabricDoz', required: false, title: 'Fabric', hint: 'Enter cost per DOZEN (if any). Blank is treated as 0.' },
    { id: 'fabricCostDoz', kind: 'moneyDoz', key: 'fabricCostDoz', required: false, title: 'Fabric Cost', hint: 'Enter cost per DOZEN. Blank is treated as 0.' },
    { id: 'fabricAttachCostDoz', kind: 'moneyDoz', key: 'fabricAttachCostDoz', required: false, title: 'Fabric Attachment CM', hint: 'Enter cost per DOZEN. Blank is treated as 0.' },

    { id: 'timingMin', kind: 'int', key: 'timingMin', required: false, title: 'Timing', hint: 'Minutes (informational). Does not affect calculation unless you change CM.' },
    { id: 'cmDoz', kind: 'moneyDoz', key: 'cmDoz', required: true, title: 'CM', hint: 'Enter CM cost per DOZEN (Cut & Make).' },

    { id: 'fobPerPc', kind: 'computed', title: 'Costing price / FOB', hint: 'Auto-calculated: (Total cost per dozen) ÷ 12' },
    { id: 'rocPct', kind: 'computed', title: 'Final (ROC 2.50%)', hint: 'Auto-calculated: FOB × (1 + 2.50%)' },


    { id: 'preview', kind: 'preview', title: 'Preview & Calculate Final FOB', hint: 'Review every value. You can tap any row to jump back and edit.' },
  ];

  function defaultWizardState() {
    return {
      // style info
      styleName: '',
      yarnDesc: '',
      composition: '', // optional (shown on output)
      gauge: null,
      weightGm: '',
      photo: null, // { blob, width, height, type }

      currency: DEFAULT_CURRENCY,

      // costing inputs
      yarnPricePerLb: '',
      wastagePct: 8,            // common default, user can change
      accessoriesCostDoz: 0,
      fabricDoz: 0,
      fabricCostDoz: 0,
      fabricAttachCostDoz: 0,
      timingMin: 0,
      cmDoz: 0,
      rocPct: FIXED_ROC_PCT,
    
    };
  }

  // ===========
  // Wizard rendering
  // ===========
  function stepCountDisplay() {
    // Display count excluding the "preview" as the last step still counts
    return `${wizardStepIndex + 1} / ${STEPS.length}`;
  }

  function updateProgressUI() {
    wizardStepLabel.textContent = 'Factory Costing Wizard';
    wizardStepCount.textContent = `Step ${stepCountDisplay()}`;
    const pct = Math.round(((wizardStepIndex + 1) / STEPS.length) * 100);
    wizardProgressFill.style.width = `${pct}%`;
  }

  async function renderWizardStep() {
    clearWizardError();
    updateProgressUI();

    const step = STEPS[wizardStepIndex];
    wizardTitleLine.textContent = step.title;

    // Button labels / visibility
    btnPrev.disabled = (wizardStepIndex === 0);
    btnPrev.style.visibility = (wizardStepIndex === 0) ? 'hidden' : 'visible';

    btnNext.textContent = (step.kind === 'preview') ? 'Calculate Final FOB' : 'Next';

    // Render body
    wizardBody.innerHTML = '';
    const s = wizardState;

    if (step.kind === 'style') {
      wizardBody.appendChild(renderStepStyleInfo(s));
      return;
    }

    if (step.kind === 'preview') {
      wizardBody.appendChild(renderStepPreview(s));
      return;
    }

    if (step.kind === 'computed') {
      wizardBody.appendChild(renderStepComputed(step, s));
      return;
    }

    // number/money/percent/int
    wizardBody.appendChild(renderStepInput(step, s));
  }

  function renderStepStyleInfo(s) {
    const wrap = document.createElement('div');
    wrap.className = 'stepGrid';

    // Left column: text inputs + gauge + weight
    const left = document.createElement('div');
    left.className = 'card card--soft';

    left.innerHTML = `
      <div class="field">
        <label class="label">Style Name / Style Number <span class="req">*</span></label>
        <input id="wStyleName" class="input" type="text" placeholder="e.g., 1683N L - Pullover" value="${escapeHtml(s.styleName)}" />
        <div class="help">Use a stable naming convention for audit and duplication.</div>
      </div>

      <div class="field">
        <label class="label">Yarn Description <span class="req">*</span></label>
        <textarea id="wYarnDesc" class="input input--textarea" rows="3" placeholder="e.g., 70% viscose / 30% polyamide, 2/30Nm">${escapeHtml(s.yarnDesc)}</textarea>
      </div>

      <div class="field">
        <label class="label">Fabric composition (optional)</label>
        <input id="wComposition" class="input" type="text" placeholder="e.g., 100% Cotton" value="${escapeHtml(s.composition)}" />
        <div class="help">Shown on the final product page.</div>
      </div>

      <div class="field">
        <label class="label">Gauge <span class="req">*</span></label>
        <div id="wGaugePicker" class="gaugePicker"></div>
        <div class="help">Select one: 3, 5, 7, 12</div>
      </div>

      <div class="field">
        <label class="label">Garment Weight (grams) <span class="req">*</span></label>
        <input id="wWeight" class="input" type="number" min="0" step="0.01" placeholder="e.g., 285" value="${escapeHtml(s.weightGm)}" />
      </div>

      <div class="field">
        <label class="label">Currency symbol (optional)</label>
        <input id="wCurrency" class="input" type="text" maxlength="3" placeholder="$" value="${escapeHtml(s.currency || DEFAULT_CURRENCY)}" />
        <div class="help">Used for display and exports only.</div>
      </div>
    `;

    // Right column: photo box
    const right = document.createElement('div');
    right.className = 'photoBox';

    right.innerHTML = `
      <div class="label">Garment Photo <span class="req">*</span></div>

      <div class="photoBox__preview" id="photoPreview">
        <div class="muted">Add a photo</div>
      </div>

      <div class="photoBox__actions">
        <button id="btnTakePhoto" class="btn btn--ghost" type="button">Take photo</button>
        <button id="btnUploadPhoto" class="btn btn--ghost" type="button">Upload</button>
      </div>

      <input id="fileCamera" type="file" accept="image/*" capture="environment" class="hidden" />
      <input id="fileUpload" type="file" accept="image/*" class="hidden" />

      <div class="help" style="margin-top:10px;">
        Images are auto-compressed (max 1024px) and stored locally in IndexedDB.
      </div>
    `;

    wrap.appendChild(left);
    wrap.appendChild(right);

    // Attach behaviors
    const styleNameEl = $('#wStyleName', wrap);
    const yarnDescEl = $('#wYarnDesc', wrap);
    const compositionEl = $('#wComposition', wrap);
    const weightEl = $('#wWeight', wrap);
    const currencyEl = $('#wCurrency', wrap);

    styleNameEl.addEventListener('input', async () => {
      wizardState.styleName = styleNameEl.value;
      await saveDraft(wizardState);
    });
    yarnDescEl.addEventListener('input', async () => {
      wizardState.yarnDesc = yarnDescEl.value;
      await saveDraft(wizardState);
    });
    compositionEl.addEventListener('input', async () => {
      wizardState.composition = compositionEl.value;
      await saveDraft(wizardState);
    });
    weightEl.addEventListener('input', async () => {
      wizardState.weightGm = weightEl.value;
      await saveDraft(wizardState);
    });
    currencyEl.addEventListener('input', async () => {
      wizardState.currency = (currencyEl.value || DEFAULT_CURRENCY).trim();
      await saveDraft(wizardState);
    });

    // Gauge picker
    const gaugePicker = $('#wGaugePicker', wrap);
    GAUGE_OPTIONS.forEach((g) => {
      const b = document.createElement('div');
      b.className = 'gaugeOption' + (Number(wizardState.gauge) === g ? ' gaugeOption--active' : '');
      b.textContent = String(g);
      b.addEventListener('click', async () => {
        wizardState.gauge = g;
        // rerender picker states quickly
        [...gaugePicker.children].forEach(ch => ch.classList.remove('gaugeOption--active'));
        b.classList.add('gaugeOption--active');
        await saveDraft(wizardState);
      });
      gaugePicker.appendChild(b);
    });

    // Photo selection
    const photoPreview = $('#photoPreview', wrap);
    const fileCamera = $('#fileCamera', wrap);
    const fileUpload = $('#fileUpload', wrap);
    const btnTake = $('#btnTakePhoto', wrap);
    const btnUp = $('#btnUploadPhoto', wrap);

    btnTake.addEventListener('click', () => fileCamera.click());
    btnUp.addEventListener('click', () => fileUpload.click());

    async function handleFile(file) {
      if (!file) return;
      const compressed = await compressImage(file);
      wizardState.photo = compressed;
      await saveDraft(wizardState);
      renderPhotoPreview(photoPreview, compressed.blob);
    }

    fileCamera.addEventListener('change', async () => {
      await handleFile(fileCamera.files?.[0]);
      fileCamera.value = '';
    });
    fileUpload.addEventListener('change', async () => {
      await handleFile(fileUpload.files?.[0]);
      fileUpload.value = '';
    });

    // Initial preview
    if (wizardState.photo?.blob) {
      renderPhotoPreview(photoPreview, wizardState.photo.blob);
    }

    return wrap;
  }

  async function renderPhotoPreview(container, blob) {
    const url = URL.createObjectURL(blob);
    container.innerHTML = `<img src="${url}" alt="Product photo preview" />`;
    // Revoke later to reduce memory
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  function renderStepInput(step, s) {
    const wrap = document.createElement('div');
    wrap.className = 'valueRow';

    const currency = (s.currency || DEFAULT_CURRENCY);

    const isMoneyDoz = (step.kind === 'moneyDoz');
    const isPercent = (step.kind === 'percent');
    const isInt = (step.kind === 'int');

    const value = s[step.key] ?? '';

    const labelSuffix = isMoneyDoz ? ` <span class="tag">per DOZEN</span>` : '';
    const unit = isPercent ? '%' : '';

    wrap.innerHTML = `
      <div class="field">
        <label class="label">${escapeHtml(step.title)}${labelSuffix}</label>
        <input id="wInput" class="input" type="number" inputmode="decimal" min="0" step="${isInt ? '1' : '0.01'}" placeholder="Enter value" value="${escapeHtml(value)}" />
        <div class="help">${escapeHtml(step.hint || '')}</div>
      </div>

      <div class="stepHint">
        ${isMoneyDoz ? `Display currency: <strong>${escapeHtml(currency)}</strong> (display only)` : ''}
        ${isPercent ? 'Allowed range: 0–100' : ''}
      </div>
    `;

    const input = $('#wInput', wrap);
    input.addEventListener('input', async () => {
      // store raw numeric (or empty for optional)
      const raw = input.value;
      if (raw === '') {
        wizardState[step.key] = step.required ? '' : '';
      } else {
        wizardState[step.key] = isInt ? String(Math.max(0, Math.trunc(Number(raw)))) : String(Math.max(0, Number(raw)));
      }

      // For "weightGm" step, keep consistent with style section
      if (step.key === 'weightGm') {
        // style weight uses same field
      }

      await saveDraft(wizardState);
    });

    return wrap;
  }

  function renderStepComputed(step, s) {
    const wrap = document.createElement('div');
    wrap.className = 'valueRow';

    const derived = computeAll(s);
    const currency = (s.currency || DEFAULT_CURRENCY);

    let valText = '—';
    let helper = step.hint || '';

    if (step.id === 'lbsPerDoz') {
      valText = (derived.lbsPerDoz === null) ? '—' : formatPlain(derived.lbsPerDoz, 2);
      helper = helper + '  (Unit: LBS/Doz)';
    }
    if (step.id === 'lbsWithWastage') {
      valText = (derived.lbsWithWastage === null) ? '—' : formatPlain(derived.lbsWithWastage, 2);
      helper = helper + '  (Unit: LBS/Doz incl.)';
    }
    if (step.id === 'yarnCostDoz') {
      valText = (derived.yarnCostDoz === null) ? '—' : formatMoney(derived.yarnCostDoz, currency);
      helper = helper + '  (Unit: per DOZEN)';
    }
    if (step.id === 'fobPerPc') {
      valText = formatMoney(derived.fobPerPc, currency);
      helper = helper + '  (Unit: per PIECE)';
    }

    
      if (step.id === 'rocPct') {
      valText = formatMoney(derived.finalPerPc, currency);
      helper = helper + '  (Unit: per PIECE)';
    }
wrap.innerHTML = `
      <div class="field">
        <label class="label">${escapeHtml(step.title)}</label>
        <input class="input" type="text" value="${escapeHtml(valText)}" disabled />
        <div class="help">${escapeHtml(helper)}</div>
        <div class="readonlyBadge"><span class="dot"></span>Auto-calculated (read-only)</div>
      </div>
    `;

    return wrap;
  }

  function renderStepPreview(s) {
    const wrap = document.createElement('div');

    const derived = computeAll(s);
    const currency = (s.currency || DEFAULT_CURRENCY);

    const rows = [
      { title: 'Style Name / Style Number', value: s.styleName, kind: 'input', jump: 0 },
      { title: 'Yarn Description', value: s.yarnDesc, kind: 'input', jump: 0 },
      { title: 'Fabric composition', value: s.composition || '—', kind: 'input', jump: 0 },
      { title: 'Gauge', value: s.gauge ? `${s.gauge}` : '—', kind: 'input', jump: 0 },
      { title: 'Garments Weight (grams)', value: `${formatPlain(toNum(s.weightGm), 2)} gm`, kind: 'input', jump: 2 },

      { title: 'Yarn price / LBS', value: `${formatPlain(toNum(s.yarnPricePerLb), 4)}`, kind: 'input', jump: 1 },
      { title: 'Garments Weight (LBS / Doz)', value: derived.lbsPerDoz === null ? '—' : formatPlain(derived.lbsPerDoz, 2), kind: 'auto', jump: 3 },
      { title: 'Wastage %', value: `${formatPlain(toNum(s.wastagePct), 2)}%`, kind: 'input', jump: 4 },
      { title: 'Garments Weight LBS (Including Wastage @ %)', value: derived.lbsWithWastage === null ? '—' : formatPlain(derived.lbsWithWastage, 2), kind: 'auto', jump: 5 },

      { title: 'Yarn Cost', value: derived.yarnCostDoz === null ? '—' : `${formatMoney(derived.yarnCostDoz, currency)} (per dozen)`, kind: 'auto', jump: 6 },

      { title: 'Accessories Cost', value: `${formatMoney(toNum(s.accessoriesCostDoz), currency)} (per dozen)`, kind: 'input', jump: 7 },
      { title: 'Fabric', value: `${formatMoney(toNum(s.fabricDoz), currency)} (per dozen)`, kind: 'input', jump: 8 },
      { title: 'Fabric Cost', value: `${formatMoney(toNum(s.fabricCostDoz), currency)} (per dozen)`, kind: 'input', jump: 9 },
      { title: 'Fabric Attachment CM', value: `${formatMoney(toNum(s.fabricAttachCostDoz), currency)} (per dozen)`, kind: 'input', jump: 10 },
      { title: 'Timing', value: `${Math.trunc(toNum(s.timingMin))} min`, kind: 'input', jump: 11 },
      { title: 'CM', value: `${formatMoney(toNum(s.cmDoz), currency)} (per dozen)`, kind: 'input', jump: 12 },

      { title: 'Costing price / FOB', value: `${formatMoney(derived.fobPerPc, currency)} / pc`, kind: 'auto', jump: 13 },
      { title: 'Final (ROC 2.50%)', value: `${formatMoney(derived.finalPerPc, currency)} / pc`, kind: 'auto', jump: 14 },
    ];

    const tr = rows.map((r) => `
      <tr data-jump="${r.jump}">
        <td>${escapeHtml(r.title)} ${r.kind === 'auto' ? '<span class="tag">auto</span>' : '<span class="tag">input</span>'}</td>
        <td>${escapeHtml(r.value)}</td>
      </tr>
    `).join('');

    wrap.innerHTML = `
      <div class="muted" style="margin-bottom:10px;">${escapeHtml(STEPS.find(x => x.id === 'preview')?.hint || '')}</div>

      <table class="table previewTable" role="table" aria-label="Costing preview">
        <thead><tr><th>Particular</th><th>Value</th></tr></thead>
        <tbody>${tr}</tbody>
      </table>

      <div class="previewCTA">
        <button id="btnJumpList" class="btn btn--ghost" type="button">Back to list</button>
        <div style="flex:1;"></div>
        <div class="muted" style="align-self:center;">Final will be saved to your device for audit.</div>
      </div>
    `;

    // Row click => jump to that step
    wrap.querySelectorAll('tbody tr[data-jump]').forEach((row) => {
      row.addEventListener('click', async () => {
        const jump = Number(row.getAttribute('data-jump') || '0');
        wizardStepIndex = Math.max(0, Math.min(STEPS.length - 1, jump));
        await renderWizardStep();
      });
    });

    $('#btnJumpList', wrap).addEventListener('click', () => {
      showView(viewList);
    });

    return wrap;
  }

  // ===========
  // Wizard navigation
  // ===========
  async function wizardNext() {
    const step = STEPS[wizardStepIndex];
    const v = validateStep(step, wizardState);
    if (!v.ok) {
      showWizardError(v.message || 'Please correct the input.');
      return;
    }
    clearWizardError();

    // Preview step "Next" => calculate & save
    if (step.kind === 'preview') {
      await calculateAndSave();
      return;
    }

    wizardStepIndex = Math.min(STEPS.length - 1, wizardStepIndex + 1);
    await saveDraft(wizardState);
    await renderWizardStep();
  }

  async function wizardPrev() {
    clearWizardError();
    wizardStepIndex = Math.max(0, wizardStepIndex - 1);
    await saveDraft(wizardState);
    await renderWizardStep();
  }

  async function openWizard({ resume = true, baseData = null } = {}) {
    // baseData is used for duplication
    const draft = resume ? await loadDraft() : null;

    wizardState = baseData ? structuredClone(baseData) : (draft ? structuredClone(draft) : defaultWizardState());
    // Ensure version fields / defaults
    wizardState.currency = (wizardState.currency || DEFAULT_CURRENCY).trim();
    if (wizardState.wastagePct === '' || wizardState.wastagePct === null || wizardState.wastagePct === undefined) wizardState.wastagePct = 8;
    if (wizardState.rocPct === '' || wizardState.rocPct === null || wizardState.rocPct === undefined) wizardState.rocPct = 0;

    wizardStepIndex = 0;
    showView(viewWizard);
    await renderWizardStep();
  }

  // ===========
  // Save product from wizard
  // ===========
  async function calculateAndSave() {
    // Validate required steps (style + yarn price + weight + wastage + CM)
    const requiredChecks = [
      STEPS[0], // style
      STEPS.find(s => s.id === 'yarnPricePerLb'),
      STEPS.find(s => s.id === 'weightGm'),
      STEPS.find(s => s.id === 'wastagePct'),
      STEPS.find(s => s.id === 'cmDoz'),
      STEPS.find(s => s.id === 'rocPct'), // optional but validate range if filled
    ].filter(Boolean);

    for (const st of requiredChecks) {
      const v = validateStep(st, wizardState);
      if (!v.ok) { showWizardError(v.message || 'Please correct the input.'); return; }
    }

    const computed = computeAll(wizardState);

    // Build final immutable record (read-only by design)
    const now = new Date().toISOString();
    const product = {
      id: uuid(),
      createdAt: now,
      updatedAt: now,
      appVersion: APP_VERSION,
      calcVersion: CALC_VERSION,

      // style
      styleName: String(wizardState.styleName || '').trim(),
      yarnDesc: String(wizardState.yarnDesc || '').trim(),
      composition: String(wizardState.composition || '').trim(),
      gauge: Number(wizardState.gauge),
      weightGm: toNum(wizardState.weightGm),

      currency: (wizardState.currency || DEFAULT_CURRENCY).trim(),

      // photo
      photo: {
        blob: wizardState.photo?.blob || null,
        type: wizardState.photo?.type || 'image/jpeg',
        width: wizardState.photo?.width || null,
        height: wizardState.photo?.height || null,
      },

      // inputs (factory sheet)
      inputs: {
        yarnPricePerLb: toNum(wizardState.yarnPricePerLb),
        wastagePct: toNum(wizardState.wastagePct),
        accessoriesCostDoz: toNum(wizardState.accessoriesCostDoz),
        fabricDoz: toNum(wizardState.fabricDoz),
        fabricCostDoz: toNum(wizardState.fabricCostDoz),
        fabricAttachCostDoz: toNum(wizardState.fabricAttachCostDoz),
        timingMin: Math.trunc(toNum(wizardState.timingMin)),
        cmDoz: toNum(wizardState.cmDoz),
        rocPct: toNum(wizardState.rocPct),
      },

      // computed snapshot (audit)
      computed: {
        lbsPerDoz: computed.lbsPerDoz,
        lbsWithWastage: computed.lbsWithWastage,
        yarnCostDoz: computed.yarnCostDoz,
        totalDoz: computed.totalDoz,
        fobPerPc: computed.fobPerPc,
        finalPerPc: computed.finalPerPc,
      },
    };

    try {
      await window.GCDB.putProduct(product);
      await clearDraft();
      wizardState = null;
      wizardStepIndex = 0;
      await loadAndRenderList();
      openDetail(product);
    } catch (e) {
      console.error(e);
      showWizardError('Could not save this costing. Please try again.');
    }
  }

  // ===========
  // List view rendering
  // ===========
  function renderDraftBanner(hasDraft) {
    if (!draftBanner) return;
    if (!hasDraft) { hide(draftBanner); draftBanner.innerHTML = ''; return; }

    draftBanner.classList.remove('hidden');
    draftBanner.innerHTML = `
      <div style="display:flex; align-items:center; justify-content:space-between; gap:12px;">
        <div><strong>Draft in progress:</strong> You have an unfinished costing. Resume or discard it.</div>
        <div style="display:flex; gap:10px;">
          <button id="btnResumeDraft" class="btn btn--ghost" type="button">Resume</button>
          <button id="btnDiscardDraft" class="btn btn--danger" type="button">Discard</button>
        </div>
      </div>
    `;

    $('#btnResumeDraft', draftBanner).onclick = () => openWizard({ resume: true });
    $('#btnDiscardDraft', draftBanner).onclick = async () => {
      const ok = confirm('Discard the current draft? This cannot be undone.');
      if (!ok) return;
      await clearDraft();
      renderDraftBanner(false);
    };
  }

  function renderList(items) {
    productList.innerHTML = '';

    if (!items.length) {
      show(emptyState);
      return;
    }
    hide(emptyState);

    items.forEach((p) => {
      const currency = p.currency || DEFAULT_CURRENCY;
      const fob = p.computed?.finalPerPc ?? p.computed?.fobPerPc ?? 0;

      const card = document.createElement('article');
      card.className = 'card';

      const imgUrl = p.photo?.blob ? URL.createObjectURL(p.photo.blob) : null;

      const composition = p.composition ? escapeHtml(p.composition) : '—';
      const gaugeWeight = `${escapeHtml(String(p.gauge))}gg / ${escapeHtml(String(Math.round(p.weightGm)))} gm`;

      card.innerHTML = `
        ${imgUrl ? `<img class="thumb" src="${imgUrl}" alt="Product photo" />` : `<div class="thumbPlaceholder">No photo</div>`}

        <div class="card__body">
          <div class="card__row">
            <div class="card__title">${escapeHtml(p.styleName)}</div>
            <button class="iconBtn iconBtn--danger" type="button" title="Delete">🗑</button>
          </div>

          <div class="card__value">${escapeHtml(formatMoney(fob, currency))} <span class="per">/ pc</span></div>
          <div class="card__meta">
            ${composition} &nbsp;&nbsp; ${gaugeWeight} &nbsp;&nbsp; ${escapeHtml(formatDate(p.createdAt))}
          </div>
        </div>
      `;

      // Open detail (but not when clicking delete)
      card.addEventListener('click', async (e) => {
        const isDelete = (e.target instanceof HTMLElement) && e.target.closest('.iconBtn--danger');
        if (isDelete) return;
        openDetail(p);
      });

      // Delete
      const delBtn = $('.iconBtn--danger', card);
      delBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const ok = confirm(`Delete costing "${p.styleName}"? This cannot be undone.`);
        if (!ok) return;
        await window.GCDB.deleteProduct(p.id);
        await loadAndRenderList();
      });

      productList.appendChild(card);

      if (imgUrl) setTimeout(() => URL.revokeObjectURL(imgUrl), 60_000);
    });
  }

  async function loadAndRenderList() {
    try {
      productsCache = await window.GCDB.getAllProducts();
      const q = String(searchInput.value || '').trim().toLowerCase();
      const filtered = q ? productsCache.filter(p => String(p.styleName || '').toLowerCase().includes(q)) : productsCache;
      renderList(filtered);

      const d = await loadDraft();
      renderDraftBanner(!!d);
    } catch (e) {
      console.error(e);
      // Show empty state to avoid dead UI
      renderList([]);
      renderDraftBanner(false);
    }
  }

  // ===========
  // Backup / Restore (JSON)
  // ===========
  async function exportBackup() {
    const items = await window.GCDB.getAllProducts();
    // Convert blob -> base64 for portability
    const exported = [];
    for (const p of items) {
      let photoBase64 = null;
      let photoType = null;

      if (p.photo?.blob) {
        photoBase64 = await blobToDataUrl(p.photo.blob);
        photoType = p.photo.type || 'image/jpeg';
      }

      exported.push({
        ...p,
        photo: photoBase64 ? { base64: photoBase64, type: photoType, width: p.photo.width, height: p.photo.height } : null,
      });
    }

    const payload = {
      schema: 'garment-costing-backup-v2',
      exportedAt: new Date().toISOString(),
      appVersion: APP_VERSION,
      calcVersion: CALC_VERSION,
      items: exported,
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    downloadBlob(blob, `garment-costing-backup-${Date.now()}.json`);
  }

  async function importBackup(file) {
    const text = await file.text();
    const data = JSON.parse(text);

    if (!data || !Array.isArray(data.items)) {
      alert('Invalid backup file.');
      return;
    }

    const products = [];
    for (const raw of data.items) {
      const p = structuredClone(raw);

      // restore photo blob
      if (p.photo?.base64) {
        const blob = dataUrlToBlob(p.photo.base64);
        p.photo = { blob, type: p.photo.type || 'image/jpeg', width: p.photo.width || null, height: p.photo.height || null };
      }

      products.push(p);
    }

    await window.GCDB.bulkPut(products);
    await loadAndRenderList();
  }

  function dataUrlToBlob(dataUrl) {
    const [meta, b64] = String(dataUrl).split(',');
    const mime = meta.match(/data:(.*?);base64/)?.[1] || 'application/octet-stream';
    const bin = atob(b64);
    const len = bin.length;
    const buf = new Uint8Array(len);
    for (let i = 0; i < len; i++) buf[i] = bin.charCodeAt(i);
    return new Blob([buf], { type: mime });
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  // ===========
  // Detail view (read-only)
  // ===========
  function openDetail(product) {
    currentDetail = product;

    const currency = product.currency || DEFAULT_CURRENCY;
    const created = formatDate(product.createdAt);

    detailMeta.textContent = `Created: ${created} • Calc ${product.calcVersion} • App v${product.appVersion}`;

    const imgUrl = product.photo?.blob ? URL.createObjectURL(product.photo.blob) : null;

    const comp = product.composition ? escapeHtml(product.composition) : '—';
    const gauge = escapeHtml(String(product.gauge));
    const weight = escapeHtml(String(Math.round(product.weightGm)));

    const finalFob = product.computed?.finalPerPc ?? 0;

    const inputs = product.inputs || {};
    const computed = product.computed || {};

    // Build breakdown (factory naming)
    const rows = [
      ['Yarn price / LBS', formatPlain(toNum(inputs.yarnPricePerLb), 4)],
      ['Garments Weight (grams)', `${formatPlain(toNum(product.weightGm), 2)} gm`],
      ['Garments Weight (LBS / Doz)', computed.lbsPerDoz == null ? '—' : formatPlain(computed.lbsPerDoz, 2)],
      ['Wastage %', `${formatPlain(toNum(inputs.wastagePct), 2)}%`],
      ['Garments Weight LBS (Including Wastage @ %)', computed.lbsWithWastage == null ? '—' : formatPlain(computed.lbsWithWastage, 2)],
      ['Yarn Cost (per dozen)', computed.yarnCostDoz == null ? '—' : formatMoney(computed.yarnCostDoz, currency)],
      ['Accessories Cost (per dozen)', formatMoney(toNum(inputs.accessoriesCostDoz), currency)],
      ['Fabric (per dozen)', formatMoney(toNum(inputs.fabricDoz), currency)],
      ['Fabric Cost (per dozen)', formatMoney(toNum(inputs.fabricCostDoz), currency)],
      ['Fabric Attachment CM (per dozen)', formatMoney(toNum(inputs.fabricAttachCostDoz), currency)],
      ['Timing (min)', `${Math.trunc(toNum(inputs.timingMin))}`],
      ['CM (per dozen)', formatMoney(toNum(inputs.cmDoz), currency)],
      ['Costing price / FOB (per pc)', formatMoney(toNum(computed.fobPerPc), currency)],
      ['ROC %', `${formatPlain(toNum(inputs.rocPct), 2)}%`],
      ['Final FOB cost per piece', formatMoney(finalFob, currency)],
    ];

    const breakdownHtml = rows.map(([k, v]) => `
      <tr>
        <td>${escapeHtml(k)}</td>
        <td style="text-align:right;">${escapeHtml(v)}</td>
      </tr>
    `).join('');

    detailCard.innerHTML = `
      <div class="detail-card">
        <div class="detail-card__media">
          ${imgUrl ? `<img src="${imgUrl}" alt="Product photo" />` : `<div class="thumbPlaceholder" style="height:240px;border-radius:0;">No photo</div>`}
        </div>

        <div class="detail-card__body">
          <div class="detail-title">${escapeHtml(product.styleName)}</div>

          <div class="kv">
            <span class="pill">Composition <strong>${comp}</strong></span>
            <span class="pill">Yarn <strong>${escapeHtml(product.yarnDesc)}</strong></span>
            <span class="pill">Gauge <strong>${gauge}gg</strong></span>
            <span class="pill">Weight <strong>${weight} gm</strong></span>
          </div>

          <div class="finalHero" role="group" aria-label="Final FOB">
            <div class="finalHero__label">Final FOB cost per piece</div>
            <div class="finalHero__value">
              ${escapeHtml(formatMoney(finalFob, currency))}
              <span class="per">/ pc</span>
            </div>
          </div>

          <div class="note">
            Read-only record. Use <strong>“Duplicate &amp; Recalculate”</strong> to create a new audited version.
          </div>
        </div>
      </div>

      <div class="detail-card">
        <div class="detail-card__body breakdown">
          <div class="detail-title" style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
            <span>Cost breakdown</span>
            <span class="badge badge--ok">Audited</span>
          </div>

          <table class="table" role="table" aria-label="Cost breakdown">
            <thead>
              <tr><th>Component</th><th>Cost</th></tr>
            </thead>
            <tbody>
              ${[
                ['Yarn Cost (per dozen)', computed.yarnCostDoz == null ? '—' : formatMoney(computed.yarnCostDoz, currency)],
                ['Accessories Cost (per dozen)', formatMoney(toNum(inputs.accessoriesCostDoz), currency)],
                ['Fabric (per dozen)', formatMoney(toNum(inputs.fabricDoz), currency)],
                ['Fabric Cost (per dozen)', formatMoney(toNum(inputs.fabricCostDoz), currency)],
                ['Fabric Attachment CM (per dozen)', formatMoney(toNum(inputs.fabricAttachCostDoz), currency)],
                ['CM (per dozen)', formatMoney(toNum(inputs.cmDoz), currency)],
                ['Costing price / FOB (per pc)', formatMoney(toNum(computed.fobPerPc), currency), 'total'],
                ['Final (ROC 2.50%)', formatMoney(finalFob, currency), 'total'],
              
              ].map(([k, v, kind]) => `
                <tr class="${kind === 'total' ? 'total-row' : ''}">
                  <td>${escapeHtml(String(k))}</td>
                  <td>${escapeHtml(String(v))}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>

          <details class="details">
            <summary class="details__summary">Technical / weight details</summary>
            <div class="details__body">
              <table class="table" role="table" aria-label="Technical details">
                <thead><tr><th>Particular</th><th>Value</th></tr></thead>
                <tbody>
                  ${[
                    ['Garments Weight (grams)', `${formatPlain(toNum(product.weightGm), 2)} gm`],
                    ['Garments Weight (LBS / Doz)', computed.lbsPerDoz == null ? '—' : formatPlain(computed.lbsPerDoz, 2)],
                    ['Wastage %', `${formatPlain(toNum(inputs.wastagePct), 2)}%`],
                    ['Garments Weight LBS (Including Wastage @ %)', computed.lbsWithWastage == null ? '—' : formatPlain(computed.lbsWithWastage, 2)],
                    ['Yarn price / LBS', formatPlain(toNum(inputs.yarnPricePerLb), 4)],
                    ['Timing (min)', `${Math.trunc(toNum(inputs.timingMin))}`],
                  ].map(([k, v]) => `
                    <tr>
                      <td>${escapeHtml(String(k))}</td>
                      <td>${escapeHtml(String(v))}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </details>
        </div>
      </div>
    `;

    if (imgUrl) setTimeout(() => URL.revokeObjectURL(imgUrl), 60_000);

    showView(viewDetail);

    // Wire actions
    btnDuplicate.onclick = () => duplicateProduct(product);
    btnDeleteProduct.onclick = () => deleteCurrentProduct(product);
    btnDownloadPdf.onclick = () => downloadProductAsPdf(product);
    btnDownloadPng.onclick = () => downloadShareImage(product, 'png');
    btnDownloadJpg.onclick = () => downloadShareImage(product, 'jpg');
  }

  async function deleteCurrentProduct(product) {
    const ok = confirm(`Delete costing "${product.styleName}"? This cannot be undone.`);
    if (!ok) return;
    await window.GCDB.deleteProduct(product.id);
    currentDetail = null;
    await loadAndRenderList();
    showView(viewList);
  }

  async function duplicateProduct(product) {
    // Use saved record as base, but keep wizard a new draft
    const baseData = defaultWizardState();

    baseData.styleName = product.styleName;
    baseData.yarnDesc = product.yarnDesc;
    baseData.composition = product.composition || '';
    baseData.gauge = product.gauge;
    baseData.weightGm = String(product.weightGm);
    baseData.currency = product.currency || DEFAULT_CURRENCY;
    baseData.photo = product.photo ? { blob: product.photo.blob, width: product.photo.width, height: product.photo.height, type: product.photo.type } : null;

    baseData.yarnPricePerLb = String(product.inputs?.yarnPricePerLb ?? '');
    baseData.wastagePct = product.inputs?.wastagePct ?? 0;
    baseData.accessoriesCostDoz = product.inputs?.accessoriesCostDoz ?? 0;
    baseData.fabricDoz = product.inputs?.fabricDoz ?? 0;
    baseData.fabricCostDoz = product.inputs?.fabricCostDoz ?? 0;
    baseData.fabricAttachCostDoz = product.inputs?.fabricAttachCostDoz ?? 0;
    baseData.timingMin = product.inputs?.timingMin ?? 0;
    baseData.cmDoz = product.inputs?.cmDoz ?? 0;
    baseData.rocPct = product.inputs?.rocPct ?? 0;

    await saveDraft(baseData);
    await openWizard({ resume: true });
  }

  // ===========
  // PDF export (no popup) — prints #printRoot
  // ===========
  function buildPrintableFragment(product, imgDataUrl) {
    const currency = product.currency || DEFAULT_CURRENCY;
    const safe = (s) => escapeHtml(s ?? '');

    const rows = [
      ['Yarn price / LBS', formatPlain(toNum(product.inputs?.yarnPricePerLb), 4)],
      ['Garments Weight (grams)', `${formatPlain(toNum(product.weightGm), 2)} gm`],
      ['Garments Weight (LBS / Doz)', product.computed?.lbsPerDoz == null ? '—' : formatPlain(product.computed.lbsPerDoz, 2)],
      ['Wastage %', `${formatPlain(toNum(product.inputs?.wastagePct), 2)}%`],
      ['Garments Weight LBS (Including Wastage @ %)', product.computed?.lbsWithWastage == null ? '—' : formatPlain(product.computed.lbsWithWastage, 2)],
      ['Yarn Cost (per dozen)', product.computed?.yarnCostDoz == null ? '—' : formatMoney(product.computed.yarnCostDoz, currency)],
      ['Accessories Cost (per dozen)', formatMoney(toNum(product.inputs?.accessoriesCostDoz), currency)],
      ['Fabric (per dozen)', formatMoney(toNum(product.inputs?.fabricDoz), currency)],
      ['Fabric Cost (per dozen)', formatMoney(toNum(product.inputs?.fabricCostDoz), currency)],
      ['Fabric Attachment CM (per dozen)', formatMoney(toNum(product.inputs?.fabricAttachCostDoz), currency)],
      ['Timing (min)', `${Math.trunc(toNum(product.inputs?.timingMin))}`],
      ['CM (per dozen)', formatMoney(toNum(product.inputs?.cmDoz), currency)],
      ['Costing price / FOB (per pc)', formatMoney(toNum(product.computed?.fobPerPc), currency)],
      [`ROC (${formatPlain(toNum(product.inputs?.rocPct),2)}%)`, formatMoney((toNum(product.computed?.fobPerPc) * toNum(product.inputs?.rocPct))/100, currency)],
      ['Final FOB cost per piece', formatMoney(toNum(product.computed?.finalPerPc), currency)],
    ];

    const created = formatDate(product.createdAt);
    const generated = formatDate(new Date().toISOString());
    const gaugeWeight = `${safe(product.gauge)}gg / ${Math.round(toNum(product.weightGm))} gm`;

    const tableRows = rows.map(([label, val]) => `
      <tr>
        <td>${safe(label)}</td>
        <td style="text-align:right;">${safe(val)}</td>
      </tr>
    `).join('');

    return `
      <div class="print-page">
        <div class="print-header">
          <div class="print-brand">
            <div class="print-logo">GC</div>
            <div>
              <h1 class="print-title">${safe(product.styleName)}</h1>
              <div class="print-meta">
                <div>Created: ${safe(created)}</div>
                <div>Calc version: ${safe(product.calcVersion || '')} • App: ${safe(product.appVersion || '')}</div>
              </div>
            </div>
          </div>
          <div class="print-fob">
            <div class="label">Final FOB cost per piece</div>
            <div class="value">${formatMoney(toNum(product.computed?.finalPerPc), currency)} / pc</div>
          </div>
        </div>

        <div class="print-grid">
          <div class="print-card">
            <div class="print-media"><img src="${imgDataUrl}" alt="Product photo"></div>
            <div class="print-body">
              <div class="print-kv">
                <span class="print-pill">Composition: <strong>${safe(product.composition || '—')}</strong></span>
                <span class="print-pill">Yarn: <strong>${safe(product.yarnDesc || '—')}</strong></span>
                <span class="print-pill">Gauge/Weight: <strong>${safe(gaugeWeight)}</strong></span>
              </div>
            </div>
          </div>

          <div class="print-card">
            <div class="print-body">
              <div style="font-weight:800; margin-bottom:10px;">Cost breakdown</div>
              <table class="print-table">
                <thead><tr><th>Particular</th><th style="text-align:right;">Value</th></tr></thead>
                <tbody>${tableRows}</tbody>
              </table>
            </div>
          </div>
        </div>

        <div class="print-footer">
          <div><strong>Disclaimer:</strong> Final costing should be reviewed before buyer submission.</div>
          <div class="print-audit">
            <div>Record ID: ${safe(product.id)}</div>
            <div>Generated: ${safe(generated)}</div>
          </div>
        </div>
      </div>
    `;
  }

  async function downloadProductAsPdf(product) {
    try {
      // Use in-document print (no window.open) to avoid popup blockers.
      // Photo is embedded as a data URL so it loads fast on mobile.
      const imgDataUrl = product.photo?.blob ? await blobToDataUrl(product.photo.blob) : '';
      printRoot.innerHTML = buildPrintableFragment(product, imgDataUrl);

      // Trigger print immediately while we are still inside the click gesture.
      // (Some mobile browsers block delayed print() calls.)
      window.print();

      // Cleanup after printing
      window.addEventListener('afterprint', () => { printRoot.innerHTML = ''; }, { once: true });
    } catch (e) {
      console.error(e);
      alert('Could not generate the PDF. Please try again.');
    }
  }
    

  // ===========
  // Share image export (PNG/JPG) — deterministic canvas renderer
  // ===========
  async function downloadShareImage(product, format) {
    try {
      const blob = await renderShareCard(product, format);
      const ext = (format === 'jpg') ? 'jpg' : 'png';
      const filename = `${sanitizeFilename(product.styleName)}-FOB.${ext}`;
      downloadBlob(blob, filename);
    } catch (e) {
      console.error(e);
      alert('Could not generate the image. Please try again.');
    }
  }

  function sanitizeFilename(name) {
    return String(name || 'costing')
      .replace(/[^\w\-]+/g, '_')
      .slice(0, 60);
  }

  async function renderShareCard(product, format) {
    const currency = product.currency || DEFAULT_CURRENCY;
    const fob = toNum(product.computed?.finalPerPc);

    // 1080px share card (good for WhatsApp/email)
    const W = 1080;
    const H = 1350;

    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');

    // Background (dark gradient)
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#0b1220');
    grad.addColorStop(1, '#0a1a26');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // Card
    const pad = 54;
    const cardX = pad, cardY = pad, cardW = W - pad * 2, cardH = H - pad * 2;

    roundRect(ctx, cardX, cardY, cardW, cardH, 42);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fill();

    // Inner header
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.font = '700 44px system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial';
    ctx.fillText('Garment Costing', cardX + 40, cardY + 78);

    ctx.fillStyle = 'rgba(255,255,255,0.70)';
    ctx.font = '500 24px system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial';
    ctx.fillText(`Calc: ${product.calcVersion} • ${formatDate(product.createdAt)}`, cardX + 40, cardY + 116);

    // Photo area
    const photoX = cardX + 40;
    const photoY = cardY + 150;
    const photoW = cardW - 80;
    const photoH = 560;

    roundRect(ctx, photoX, photoY, photoW, photoH, 32);
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fill();

    if (product.photo?.blob) {
      const imgUrl = await blobToDataUrl(product.photo.blob);
      const img = await loadImage(imgUrl);
      // cover fit
      drawCover(ctx, img, photoX, photoY, photoW, photoH, 32);
    }

    // Style name
    const textX = cardX + 40;
    let y = photoY + photoH + 70;

    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.font = '800 54px system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial';
    y = drawWrappedText(ctx, product.styleName, textX, y, photoW, 60, 2);

    // Chips line
    ctx.fillStyle = 'rgba(255,255,255,0.78)';
    ctx.font = '600 28px system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial';
    const chipLine = `${product.composition ? product.composition : '—'}   •   ${product.gauge}gg / ${Math.round(toNum(product.weightGm))} gm`;
    y += 20;
    ctx.fillText(chipLine, textX, y);

    // FOB highlight
    y += 90;
    roundRect(ctx, textX, y, photoW, 150, 28);
    ctx.fillStyle = 'rgba(125,211,252,0.12)';
    ctx.fill();

    ctx.fillStyle = 'rgba(255,255,255,0.86)';
    ctx.font = '700 28px system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial';
    ctx.fillText('Final FOB cost per piece', textX + 28, y + 58);

    ctx.fillStyle = 'rgba(255,255,255,0.96)';
    ctx.font = '900 64px system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial';
    ctx.fillText(`${formatMoney(fob, currency)} / pc`, textX + 28, y + 118);

    // Disclaimer
    y += 220;
    ctx.fillStyle = 'rgba(255,255,255,0.60)';
    ctx.font = '500 22px system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial';
    ctx.fillText('Disclaimer: Final costing should be reviewed before buyer submission.', textX + 4, y);

    // toBlob
    const mime = (format === 'jpg') ? 'image/jpeg' : 'image/png';
    const quality = (format === 'jpg') ? 0.92 : undefined;

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, mime, quality));
    return blob;
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  async function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  function drawCover(ctx, img, x, y, w, h, r) {
    // Clip rounded rect
    ctx.save();
    roundRect(ctx, x, y, w, h, r);
    ctx.clip();

    const iw = img.width, ih = img.height;
    const scale = Math.max(w / iw, h / ih);
    const sw = iw * scale;
    const sh = ih * scale;
    const sx = x + (w - sw) / 2;
    const sy = y + (h - sh) / 2;
    ctx.drawImage(img, sx, sy, sw, sh);

    ctx.restore();
  }

  function drawWrappedText(ctx, text, x, y, maxWidth, lineHeight, maxLines) {
    const words = String(text || '').split(/\s+/);
    let line = '';
    let lines = 0;

    for (let i = 0; i < words.length; i++) {
      const test = line ? (line + ' ' + words[i]) : words[i];
      const w = ctx.measureText(test).width;
      if (w > maxWidth && line) {
        ctx.fillText(line, x, y);
        y += lineHeight;
        lines += 1;
        line = words[i];
        if (lines >= maxLines - 1) break;
      } else {
        line = test;
      }
    }

    if (line) {
      let out = line;
      // ellipsis if overflow
      while (ctx.measureText(out).width > maxWidth && out.length > 0) {
        out = out.slice(0, -1);
      }
      if (out !== line) out = out.slice(0, -1) + '…';
      ctx.fillText(out, x, y);
      y += lineHeight;
    }

    return y;
  }

  // ===========
  // Events
  // ===========
  btnNew.addEventListener('click', async () => {
    const d = await loadDraft();
    if (d) {
      // Resume by default (safer: avoid accidental loss)
      await openWizard({ resume: true });
    } else {
      await openWizard({ resume: false });
    }
  });

  btnNewEmpty.addEventListener('click', async () => {
    await openWizard({ resume: false });
  });

  btnWizardCancel.addEventListener('click', async () => {
    // Keep draft (safe). User can discard from banner.
    showView(viewList);
  });

  btnPrev.addEventListener('click', wizardPrev);
  btnNext.addEventListener('click', wizardNext);

  btnBackFromDetail.addEventListener('click', () => {
    showView(viewList);
  });

  searchInput.addEventListener('input', loadAndRenderList);

  btnExport.addEventListener('click', exportBackup);
  btnImport.addEventListener('click', () => importFile.click());
  importFile.addEventListener('change', async () => {
    const f = importFile.files?.[0];
    if (!f) return;
    await importBackup(f);
    importFile.value = '';
  });

  // ===========
  // PWA service worker
  // ===========
  async function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    try {
      await navigator.serviceWorker.register('./sw.js');
    } catch (e) {
      console.warn('SW registration failed', e);
    }
  }

  // ===========
  // Boot
  // ===========
  async function boot() {
    showView(viewList);
    await registerSW();
    await loadAndRenderList();

    // If user refreshes while mid-wizard, we keep list view but show draft banner.
    // Clicking Resume returns them to wizard.
  }

  boot();

})();
