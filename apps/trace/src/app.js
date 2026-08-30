/**
 * app.js — Image Trace app entry point (SketchStudio monorepo)
 *
 * Tabs: Trace → Edit → Export
 * Trace tab: upload, param controls, scale, preview
 * Edit tab:  shared #core sketch canvas (lazy-mounted), tool ribbon, trim/break
 * Export tab: SVG (Shaper Origin) + DXF (Fusion 360)
 */

import { createAppSwitcher }              from '#ui/app-switcher.js';
import { createDiagnosticLog }            from '#ui/diagnostic-log.js'; // DIAG-OVERLAY: mobile-usable log + Copy Report
import { initUpload }                     from './upload.js';
import { initControls }                   from './controls.js';
import { initScale }                      from './scale.js';
import { initPreview }                    from './preview.js';
import { trace }                          from './tracer.js';
import { downloadSVG, downloadDXF, copySVG } from './export.js';
import { ensureEditMount, importSvgToEdit }  from './edit-view.js';

// ── App switcher ──────────────────────────────────────────────────────────────
const swHost = document.getElementById('app-switcher-host');
if (swHost) swHost.appendChild(createAppSwitcher({ current: 'trace' }).el);

// DIAG-OVERLAY: log/error/viewport/touch capture works the same as every other app. The document
// (serializeDocument) section is deliberately omitted here rather than reaching into the Edit tab's
// #core state through a getter this turn — that getter exists only in another in-progress,
// uncommitted change to edit-view.js/app.js (not authored by this turn), and depending on it would
// entangle this commit with unreviewed work. Everything else in the report still works; wiring the
// document section in is a small, clean follow-up once that other change lands.
const _diagLog = createDiagnosticLog({ appId: 'trace' });
if (swHost) swHost.parentElement.appendChild(_diagLog.toggleEl);

// ── Event bus ─────────────────────────────────────────────────────────────────
const listeners = {};
const eventBus = {
  on:   (ev, fn) => { (listeners[ev] ??= []).push(fn); },
  emit: (ev, data) => { (listeners[ev] ?? []).forEach(fn => fn(data)); },
};

// ── App state ─────────────────────────────────────────────────────────────────
const state = {
  imageCanvas: null,
  imageW: 0,
  imageH: 0,
  imageName: 'trace',
  svgString: null,
  params: { threshold: 128, blur: 0, colorMode: 'bw' },
  scale: null,   // mm/px — null = unset
  unit: 'mm',
};

// ── Tab routing ───────────────────────────────────────────────────────────────
const tabPanes = {
  trace:  document.getElementById('tab-trace'),
  edit:   document.getElementById('tab-edit'),
  export: document.getElementById('tab-export'),
};

const tabBtns = document.querySelectorAll('.tr-tab[data-tab]');

function switchTab(id) {
  tabBtns.forEach(b => b.classList.toggle('active', b.dataset.tab === id));
  Object.entries(tabPanes).forEach(([k, el]) => {
    if (el) el.hidden = k !== id;
  });
  if (id === 'edit') {
    ensureEditMount();
    updateExportButtons();
  }
  if (id === 'export') {
    updateExportButtons();
    updateScaleNote();
  }
}

tabBtns.forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));

// ── Modules init ──────────────────────────────────────────────────────────────
const preview = initPreview(eventBus);
const { setImageSize } = initScale(eventBus);
initUpload(eventBus);
const { getParams } = initControls(eventBus);

preview.onMaskChanged(() => scheduleTrace());

// ── Event handlers ────────────────────────────────────────────────────────────
eventBus.on('imageLoaded', ({ canvas, width, height, name }) => {
  state.imageCanvas = canvas;
  state.imageW      = width;
  state.imageH      = height;
  state.imageName   = name;
  preview.setImage(canvas);
  preview.updateThresholdOverlay(state.params);
  setImageSize(width, height);
  
  const originalEmpty = document.getElementById('original-empty');
  if (originalEmpty) originalEmpty.style.display = 'none';

  scheduleTrace();
});

eventBus.on('paramsChanged', params => {
  state.params = { ...state.params, ...params };
  preview.updateThresholdOverlay(state.params);
  scheduleTrace();
});

eventBus.on('scaleChanged', ({ scale, unit }) => {
  state.scale = scale;
  state.unit  = unit ?? 'mm';
});

// ── Trace (debounced) ─────────────────────────────────────────────────────────
let traceTimer = null;

function scheduleTrace() {
  if (!state.imageCanvas) return;
  clearTimeout(traceTimer);
  traceTimer = setTimeout(runTrace, 300);
}

async function runTrace() {
  const maskedImageData = preview.getMaskedImageData();
  if (!maskedImageData) return;
  
  preview.showTracing(true);
  try {
    const svg = await trace(maskedImageData, state.params);
    state.svgString = svg;
    preview.setSVG(svg);
    // Enable "Send to Editor"
    const btn = document.getElementById('btn-send-to-edit');
    if (btn) btn.disabled = false;
  } catch (err) {
    if (err.message === 'CANCELLED') {
      // Just ignore it, a newer trace is already queued or running
      return;
    }
    console.error('Trace failed:', err);
    toast('Trace failed: ' + err.message, 'error');
    preview.showTracing(false);
  }
}

// ── Send to Editor ────────────────────────────────────────────────────────────
document.getElementById('btn-send-to-edit')?.addEventListener('click', () => {
  if (!state.svgString) return toast('Nothing to send — trace an image first', 'error');
  // Apply scale to SVG before importing (so #core gets real-world coords)
  const { downloadSVG: _, copySVG: __, downloadDXF: ___, ...rest } = {};
  // Get the scaled SVG string (same as what would be downloaded)
  const scaledSvg = buildScaledSvg();
  importSvgToEdit(scaledSvg, state.imageName, msg => toast(msg, 'success'));
  switchTab('edit');
});

function buildScaledSvg() {
  if (!state.svgString || !state.scale) return state.svgString;
  // Re-use the applyScaleToSVG logic from export.js by downloading to a blob isn't ideal;
  // instead build the scaled SVG inline.
  const parser = new DOMParser();
  const doc    = parser.parseFromString(state.svgString, 'image/svg+xml');
  const svg    = doc.querySelector('svg');
  if (!svg) return state.svgString;
  const vb  = svg.getAttribute('viewBox')?.split(/[\s,]+/).map(Number) ?? [0,0,100,100];
  const realW = (vb[2] * state.scale).toFixed(4);
  const realH = (vb[3] * state.scale).toFixed(4);
  svg.setAttribute('width',  `${realW}mm`);
  svg.setAttribute('height', `${realH}mm`);
  svg.setAttribute('xmlns',  'http://www.w3.org/2000/svg');
  return new XMLSerializer().serializeToString(doc);
}

// ── Export buttons ────────────────────────────────────────────────────────────
document.getElementById('btn-dl-svg')?.addEventListener('click', () => {
  if (!state.svgString) return toast('No trace yet', 'error');
  downloadSVG(state.svgString, state.imageName, state.scale, state.imageH, state.unit);
  toast('SVG downloaded — ready for Shaper Origin', 'success');
});

document.getElementById('btn-copy-svg')?.addEventListener('click', async () => {
  if (!state.svgString) return toast('No trace yet', 'error');
  try {
    await copySVG(state.svgString, state.scale, state.imageH, state.unit);
    toast('SVG copied to clipboard', 'success');
  } catch { toast('Clipboard copy failed', 'error'); }
});

document.getElementById('btn-dl-dxf')?.addEventListener('click', () => {
  if (!state.svgString) return toast('No trace yet', 'error');
  downloadDXF(state.svgString, state.imageName, state.scale, state.imageH, state.unit);
  toast('DXF downloaded — ready for Fusion 360', 'success');
});

document.getElementById('btn-retrace')?.addEventListener('click', scheduleTrace);

function updateExportButtons() {
  const has = !!state.svgString;
  ['btn-dl-svg','btn-copy-svg','btn-dl-dxf'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = !has;
  });
}

function updateScaleNote() {
  const note = document.getElementById('export-scale-note');
  if (note) note.hidden = !!state.scale;
}

// ── Toast ─────────────────────────────────────────────────────────────────────
function toast(msg, type = 'info') {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  const icon = type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ';
  el.innerHTML = `<span>${icon}</span> ${msg}`;
  container.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

// ── Status bar helper ─────────────────────────────────────────────────────────
function setStatus(msg) {
  const el = document.getElementById('tr-status');
  if (el) el.textContent = msg;
}

// Boot on first tab
switchTab('trace');
