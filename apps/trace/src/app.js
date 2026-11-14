/**
 * app.js — Image Trace app entry point (SketchStudio monorepo)
 *
 * Tabs: Trace → Edit → Export
 * Trace tab: upload, param controls, scale, preview
 * Edit tab:  shared #core sketch canvas (mounted at boot, bound to the project store), tool ribbon, trim/break
 * Export tab: SVG (Shaper Origin) + DXF (Fusion 360)
 */

import { SIDEBAR_ICONS }                  from '#ui/app-sidebar.js';
import { mountProjectSidebar }            from '#ui/sidebar-projects.js'; // TASK 567: the SAME File menu (project actions, store-backed) every editor mounts
import { getGoogleAccount }               from '#ui/cloud/google-account.js'; // TASK 488: the shared account row
getGoogleAccount().init();
import { applyAppIdentity }                from '#ui/app-registry.js'; // TASK 473: tab title + favicon from the registry
applyAppIdentity('trace');
import { createHistoryRouter } from '#ui/history-control.js'; // TASK 618
import { mountAppFooter } from '#ui/app-footer.js'; // TASK 618: Undo / Redo, Recenter in the footer
import { sketchHistory } from '#ui/input-manager.js';
import { createDiagnosticLog }            from '#ui/diagnostic-log.js'; // DIAG-OVERLAY: mobile-usable log + Copy Report
import { initUpload, decodeImageBlob }     from './upload.js';
import { initControls, DEFAULT_PARAMS }    from './controls.js';
import { initScale }                      from './scale.js';
import { initPreview }                    from './preview.js';
import { trace }                          from './tracer.js';
import { downloadSVG, downloadDXF, copySVG } from './export.js';
import { createTraceSession }          from './trace-session.js'; // TASK 605: a document tab's photo, mask, trace and scale, declared once
import { mountEdit, getEditBuffer, getEditState, startEdit, stopEdit, importToEdit } from './edit-view.js';
import { mountImportDrop }                from '#ui/sketch-import.js'; // TASK 566: the ONE SVG / DXF importer's drop on the Edit tab

// ── App sidebar (TASK 473, 567) ───────────────────────────────────────────────
// The File menu is the shared one every editor mounts (sidebar-projects.js): New design, Save as, Duplicate, Open recent, Projects, Save to Google
// Drive, Open from file, Import SVG / DXF…. This host declares only ITS actions, which sit after those (below a divider) like the other apps'
// own Download: Download SVG / DXF = the traced result (enabled once there is a trace).
const swHost = document.getElementById('app-sidebar-host');
if (swHost) {
  swHost.appendChild(mountProjectSidebar({
    appId: 'trace', getBuffer: () => getEditBuffer(), documentTabs: true, // TASK 605: the document tab strip under the header, in every tab
     importFile: (text, name) => importDrawing(text, name),
    hostActions: [
      { id: 'download-svg', label: 'Download SVG', icon: SIDEBAR_ICONS.download, enabled: () => !!state.svgString, tooltip: 'Trace an image first', onClick: () => downloadSVG(state.svgString, state.imageName, state.scale, state.imageH, state.unit) },
      { id: 'download-dxf', label: 'Download DXF', icon: SIDEBAR_ICONS.download, enabled: () => !!state.svgString, tooltip: 'Trace an image first', onClick: () => downloadDXF(state.svgString, state.imageName, state.scale, state.imageH, state.unit) },
    ],
  }).el);
}

// TASK 566: import an SVG / DXF into the Edit tab's sketch (the File menu's entry, and a drop on the Edit tab) and show the Edit tab.
function importDrawing(text, name) {
  const res = importToEdit(text, name);
  toast(res.message, res.ok ? 'success' : 'error');
  if (res.ok) switchTab('edit');
}

// DIAG-OVERLAY: log/error/viewport/touch capture, and the document section (the Edit canvas's sketch state, through the same getter shape the other hosts use).
const _diagLog = createDiagnosticLog({ appId: 'trace', state: () => getEditState() });
if (swHost) swHost.parentElement.appendChild(_diagLog.toggleEl);

// TASK 618: Undo / Redo belong to the Edit tab's sketch (the Trace and Export tabs have no history)
const history = createHistoryRouter({ current: () => (getEditState() && !tabPanes.edit.hidden ? sketchHistory(getEditState()) : null) });
mountAppFooter({ router: history, view: () => (getEditState() && !tabPanes.edit.hidden ? { svg: document.getElementById('design-canvas'), state: getEditState() } : null) });

// ── Event bus ─────────────────────────────────────────────────────────────────
const listeners = {};
const eventBus = {
  on:   (ev, fn) => { (listeners[ev] ??= []).push(fn); },
  emit: (ev, data) => { (listeners[ev] ?? []).forEach(fn => fn(data)); },
};

// ── App state ─────────────────────────────────────────────────────────────────
const state = {
  imageCanvas: null,   // the SHOWN tab's photo, decoded
  imageBlob: null,     // its compressed original file: what a tab put aside keeps (TASK 609)
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
if (tabPanes.edit) mountImportDrop(tabPanes.edit, importDrawing); // TASK 566: a drop on the Edit tab imports too

const tabBtns = document.querySelectorAll('.tr-tab[data-tab]');

function switchTab(id) {
  tabBtns.forEach(b => b.classList.toggle('active', b.dataset.tab === id));
  Object.entries(tabPanes).forEach(([k, el]) => {
    if (el) el.hidden = k !== id;
  });
  if (id === 'trace') scaleCtl.redrawLine(); // the reference line is drawn in display pixels: it needs the tab showing
  if (id === 'edit') { startEdit(); updateExportButtons(); } // the shared Design canvas draws only while its tab shows (idempotent start)
  else stopEdit();
  history.refresh();
  if (id === 'export') {
    updateExportButtons();
    updateScaleNote();
  }
}

tabBtns.forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));

// ── Modules init ──────────────────────────────────────────────────────────────
const preview = initPreview(eventBus);
const scaleCtl = initScale(eventBus);
const { setImageSize } = scaleCtl;
initUpload(eventBus);
const { getParams, setParams } = initControls(eventBus);

// TASK 567: the Edit canvas is mounted now and bound to the project store. What Trace keeps of a design in its sidecar (doc.hosts.trace) is the
// trace PARAMETERS and the image name; NOT the photo (see WORK-LOG TURN 567: the traced geometry in the sketch IS the design, the photo is a
// 3-25 MB re-trace source), and not the scale (mm per photo pixel: meaningless without the photo's pixel size).
let traceGen = 0; // bumped when a tab switch replaces the photo: a trace still running for the old photo must not land in the new one
let sidecarName = null; // the image name of the design shown, from its sidecar
let traceTimer = null;
const traceSession = createTraceSession({
  state, preview, scale: scaleCtl,
  codec: {
    decode: decodeImageBlob,
    encode: (canvas) => new Promise((res) => canvas.toBlob(res, 'image/png')), // null when the browser cannot encode: the session then keeps the canvas
  },
  ui: {
    onDecodeError: (err) => toast("This tab's photo could not be shown: " + err.message, 'error'),
    cancelTrace: () => { traceGen++; clearTimeout(traceTimer); preview.showTracing(false); },
    showPhotoUi: (has, traced) => {
      const originalEmpty = document.getElementById('original-empty');
      if (originalEmpty) originalEmpty.style.display = has ? 'none' : '';
      const btn = document.getElementById('btn-send-to-edit');
      if (btn) btn.disabled = !traced;
      updateExportButtons(); updateScaleNote();
    },
    fallbackName: () => sidecarName || 'trace',
    // the Trace tab shows no photo for this design: if the design is a drawing, show it (the same rule as opening a stored design: a design is its sketch)
    onNoPhoto: () => { if (!tabPanes.trace.hidden && getEditState().shapes.length) { switchTab('edit'); toast('This design has no photo: showing its drawing in Edit', 'info'); } },
  },
});
mountEdit({
  isActive: () => !tabPanes.edit.hidden,
  getHostData: () => ({ imageName: state.imageName, params: getParams() }),
  session: traceSession, // TASK 605
  applyHost: (side, reason) => { // a design without a trace sidecar gets the defaults: it must not inherit the previous design's controls
    setParams({ ...DEFAULT_PARAMS, ...(side && side.params) });
    sidecarName = side && side.imageName ? side.imageName : null;
    // the name rides the sidecar: a new / switched-to design shows ITS name before the unsaved baseline is taken (an Untitled's name is part of what "changed" means)
    if (reason === 'new' || reason === 'switch' || !state.imageCanvas) { if (sidecarName || reason === 'new' || reason === 'switch') state.imageName = sidecarName || 'trace'; }
    if (reason !== 'switch' && getEditState().shapes.length) switchTab('edit'); // TASK 605: a tab switch stays in the tab the user is in (the photo session decides below) // a stored design is its sketch: show it (the photo is not kept, so the Trace tab would be empty)
  },
});

preview.onMaskChanged(() => scheduleTrace());

// ── Event handlers ────────────────────────────────────────────────────────────
eventBus.on('imageLoaded', ({ blob, canvas, width, height, name }) => {
  traceSession.cancelPending();
  state.imageCanvas = canvas;
  state.imageBlob   = blob;
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
function scheduleTrace() {
  if (!state.imageCanvas) return;
  clearTimeout(traceTimer);
  traceTimer = setTimeout(runTrace, 300);
}

async function runTrace() {
  const maskedImageData = preview.getMaskedImageData();
  if (!maskedImageData) return;
  
  const gen = traceGen;
  preview.showTracing(true);
  try {
    const svg = await trace(maskedImageData, state.params);
    if (gen !== traceGen) return; // a tab switch replaced the photo while this trace ran
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
  importDrawing(scaledSvg, state.imageName);
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

// Boot on first tab
switchTab('trace');
