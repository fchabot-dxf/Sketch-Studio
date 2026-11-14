// SVG Editor — boot + wiring.

import { store, setDoc } from './store.js';
import { parseSvg, serializeSvg, download } from './svgio.js';
import * as canvas from './canvas.js';
import * as tree from './tree.js';
import * as inspector from './inspector.js';
// Shared #core-backed sketcher (S1). Eager import so the page load exercises #ui/ + #core/ resolution;
// the mount itself runs only when the Design tab is first opened.
import { mountSketch } from '#ui/sketch-canvas.js';
import { sketchesSignature } from '#core/sketch-model.js';
import { createToolRibbon } from '#ui/tool-ribbon.js';
import { createDocumentBuffer } from '#ui/document-buffer.js'; // PERSIST-2: autosave + cross-app carry
import { DESIGN_CANVAS_ID, DESIGN_CANVAS_OPTIONS, RIBBON_OPTIONS, mountShaperBrowser, shaperBufferOptions, applyShaperUnitDefault } from './design-canvas.js'; // TASK 569: the Design canvas setup, declared once (the node test kit reads it too)
import { createDiagnosticLog } from '#ui/diagnostic-log.js'; // DIAG-OVERLAY: mobile-usable log + Copy Report
import { createShaperSession } from './shaper-session.js'; // TASK 605: a document tab's stage state, declared once (the node test kit builds it too)
import { createPrepareStage } from './prepare-stage.js'; // TASK 583: Prepare's wiring (view, cut card, cut-plan undo, keys, restore), declared once (the node test kit calls it too)
import { MODE_KEY, findViews, createModeRouter } from './modes.js'; // TASK 583: the mode router, declared once (the node test kit calls it too)
import { mountReviewView } from './review-view.js';   // TASK 459: the 3D Review (three loads only when the tab first opens)
import { getStock, resolveStock } from './stock.js'; // TASK 459: the declared stock (persisted by shaper-doc.js, TASK 460)
import { createStockCard } from './stock-card.js'; // TASK 583: the Review card's stock thickness field, declared once (the node test kit calls it too)
import { mountVcarveView } from './vcarve-view.js';   // VCARVE-3b: the live Vcarve workspace
import { createStylePanel } from '#ui/style-panel.js'; // U3b: shared settings modal (with the doc-unit toggle)
import { bindTemplateTokens } from '#ui/style-templates.js';
import { cutPlanEntries, CUT_PLAN, planReliefItems } from './cut-plan.js'; // SP1j-4: the shared cut-plan store
import { CUT_TYPES, exportEncoding } from './shaper.js';                   // SP1j-4: injected as the exporter's encoding
import { exportShaperSVG } from '#core/shaper-export.js';  // SP1j: pure cut-plan → Shaper SVG serializer
import { SIDEBAR_ICONS } from '#ui/app-sidebar.js';
import { getGoogleAccount } from '#ui/cloud/google-account.js'; // TASK 488: probe the server session once at start (signing in syncs nothing)
getGoogleAccount().init();
import { mountProjectSidebar } from '#ui/sidebar-projects.js'; // TASK 479: project actions + views (store-backed), same entries in every editor // TASK 473: the shared app sidebar (replaces the app-switcher dropdown)
import { applyAppIdentity } from '#ui/app-registry.js'; // TASK 473: tab title + favicon from the registry
applyAppIdentity('shaper');
import { makeGroup, ungroup, groupOf } from '#core/group-model.js'; // SKETCH-4d: user Group/Ungroup organisation action
import { findLoops } from '#core/loop-finder.js';        // enumerate loops for export boundary polygons
import { loopPolygon } from '#core/loop-geometry.js';     // HOST computes loop polys (DOM) → serializer stays pure
import { createShaperImporter } from './cut-import.js'; // TASK 583 / 610: Shaper's SVG / DXF import (options, the menu entry, the drop), declared once
import { docUnit } from '#core/settings-manager.js';
import { createGroupStatus } from './group-status.js'; // TASK 610: the one-line status toast over the Design view

canvas.init(document.getElementById('canvas'));
tree.init(document.getElementById('tree'));
inspector.init(document.getElementById('inspector'));

let designController = null; // sketcher mounted once, at boot (ensureSketch); RAF started while Design is active, paused otherwise (declared before the sidebar: the tab strip reads the buffer as it mounts)
let docBuffer = null; // TASK 474: the autosave buffer / project actions of this app (created with the sketch in ensureSketch); the sidebar and the tab strip read it lazily

// TASK 473: the shared app sidebar (hamburger, document actions, GO TO) in the header brand slot. This host declares ITS actions:
// Download = the Shaper SVG export (the same payload the export button builds), New = a fresh document.
const _swHost = document.getElementById('app-sidebar-host');
const onPhone = () => window.matchMedia('(max-width: 640px)').matches; // the app's one phone breakpoint (the header's .sk-phone-header rules)
if (_swHost) {
  _swHost.appendChild(mountProjectSidebar({
    appId: 'shaper', getBuffer: () => docBuffer, // the buffer is created with the sketch, at boot (ensureSketch() before the first showMode, below); null until then
    documentTabs: true, // TASK 605: the document tab strip under the header, in every mode
    importFile: (text, name) => shaperImporter.importFile(text, name), // TASK 566: "Import SVG / DXF…" in the file menu
    hostActions: [
      { id: 'download', label: 'Download', icon: SIDEBAR_ICONS.download, tooltip: 'Download the Shaper SVG (the Prepare cut plan)', onClick: () => {
        const payload = generateShaperSvgPayload();
        if (!payload) { groupStatus('No cuts assigned — assign cut types in Prepare first.'); return; }
        download('shaper-export.svg', payload.svg);
      } },
      // TASK 581: at phone width (<= 640 px) the header's Explore actions (Open SVG / Fit / Export) are hidden (.sk-phone-collapse) and live here
      // while Explore shows (the same buttons' own handlers run: nothing is rebuilt). A wider screen keeps them in the header.
      { divider: true, visible: () => onPhone() && modes.current() === 'explore' },
      { id: 'phone-open', label: 'Open SVG', visible: () => onPhone() && modes.current() === 'explore', onClick: () => document.getElementById('open').click() },
      { id: 'phone-fit', label: 'Fit', visible: () => onPhone() && modes.current() === 'explore', onClick: () => document.getElementById('fit').click() },
      { id: 'phone-export', label: 'Export', visible: () => onPhone() && modes.current() === 'explore', onClick: () => document.getElementById('export').click() },
    ],
  }).el);
}

// DIAG-OVERLAY: created at boot (not gated to Design mode) so it's reachable even if a bug hits
// Explore/Vcarve/Prepare — designController may not exist yet, so its state is read lazily.
const _diagLog = createDiagnosticLog({ appId: 'shaper', state: () => designController && designController.state });
if (_swHost) _swHost.parentElement.appendChild(_diagLog.toggleEl);

const fileInput = document.getElementById('file');
document.getElementById('open').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  if (fileInput.files[0]) loadFile(fileInput.files[0]);
  fileInput.value = '';
});

document.getElementById('export').addEventListener('click', () => {
  if (!store.doc) return;
  download('edited.svg', serializeSvg(store.doc));
});

// SP1j-4: the Sim/Export tab → serialize the Prepare cut plan + the design into a machine-ready Shaper Origin SVG and
// download it. Encoding INJECTED (the app's CUT_TYPES) so #core/shaper-export stays app-agnostic; docUnit from settings.

// VCARVE-4: vcarve records (a region picked in the Vcarve tab) are exportable even with no Prepare cut assigned.
function activeVcarves() {
  ensureSketch();
  const vs = designController && designController.state && designController.state.vcarves;
  return Array.isArray(vs) ? vs.filter((v) => v && v.region) : [];
}

function generateShaperSvgPayload() {
  const entries = cutPlanEntries();
  const vcarves = activeVcarves();
  if (!entries.length && !vcarves.length) return null;
  ensureSketch();
  try { designController.engine.solve(500); } catch (_) { /* best-effort solve before export */ }
  const st = designController.state;
  const sById = new Map((st.shapes || []).map((s) => [s.id, s]));
  const loopPolys = {};
  for (const l of findLoops(st)) loopPolys[l.id] = loopPolygon(l, st, sById);
  const svg = exportShaperSVG({ state: st, entries, encoding: exportEncoding(), docUnit: docUnit(), options: { groupByCut: true }, loopPolys });
  return { svg, entries, vcarves, state: st };
}

const btnGenerateSvg = document.getElementById('btn-generate-svg');
if (btnGenerateSvg) {
  btnGenerateSvg.addEventListener('click', () => {
    const status = document.getElementById('simexport-status');
    const payload = generateShaperSvgPayload();
    if (!payload) { if (status) status.textContent = 'No cuts assigned — assign cut types in Prepare first.'; return; }
    download('shaper-export.svg', payload.svg);
    const n = payload.entries.length + payload.vcarves.length;
    if (status) status.innerHTML = `Exported ${n} cut${n === 1 ? '' : 's'} → <strong>shaper-export.svg</strong>. Drop it into <a href="https://hub.shapertools.com/my-files" target="_blank" rel="noopener noreferrer" style="color:var(--sk-selection,#4c9aff); text-decoration:underline;">ShaperHub (My Files)</a> to sync with Origin.`;
  });
}

// Direct ShaperHub cloud sync (Wi-Fi sync to Origin)
const syncModal = document.getElementById('shaper-sync-modal');
const syncForm = document.getElementById('sync-modal-form');
const syncEmail = document.getElementById('sync-email');
const syncPassword = document.getElementById('sync-password');
const syncFilename = document.getElementById('sync-filename');
const syncRemember = document.getElementById('sync-remember');
const syncStatus = document.getElementById('sync-modal-status');
const syncCloseBtn = document.getElementById('sync-modal-close');
const syncCancelBtn = document.getElementById('sync-btn-cancel');
const syncSubmitBtn = document.getElementById('sync-btn-submit');
const CRED_STORAGE_KEY = 'shaper_hub_creds';

function closeSyncModal() {
  if (syncModal && syncModal.open) syncModal.close();
}

if (syncCloseBtn) syncCloseBtn.addEventListener('click', closeSyncModal);
if (syncCancelBtn) syncCancelBtn.addEventListener('click', closeSyncModal);

const btnSyncShaper = document.getElementById('btn-sync-shaper');
if (btnSyncShaper) {
  btnSyncShaper.addEventListener('click', () => {
    const status = document.getElementById('simexport-status');
    const entries = cutPlanEntries();
    if (!entries.length && !activeVcarves().length) {
      if (status) status.textContent = 'No cuts assigned — assign cut types in Prepare first.';
      return;
    }
    try {
      const saved = JSON.parse(localStorage.getItem(CRED_STORAGE_KEY) || '{}');
      if (saved.email && syncEmail) syncEmail.value = saved.email;
      if (saved.password && syncPassword) syncPassword.value = saved.password;
    } catch (_) {}

    if (syncFilename && !syncFilename.value) {
      syncFilename.value = 'shaper-export.svg';
    }
    if (syncStatus) {
      syncStatus.className = 'sync-status';
      syncStatus.textContent = '';
    }
    if (syncSubmitBtn) syncSubmitBtn.disabled = false;
    if (syncModal && typeof syncModal.showModal === 'function') {
      syncModal.showModal();
    }
  });
}

if (syncForm) {
  syncForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = generateShaperSvgPayload();
    if (!payload) {
      if (syncStatus) {
        syncStatus.className = 'sync-status is-error';
        syncStatus.textContent = 'No cuts assigned in Prepare.';
      }
      return;
    }
    const email = syncEmail ? syncEmail.value.trim() : '';
    const password = syncPassword ? syncPassword.value : '';
    let filename = (syncFilename ? syncFilename.value.trim() : '') || 'shaper-export.svg';
    if (!filename.toLowerCase().endsWith('.svg')) filename += '.svg';

    if (!email || !password) {
      if (syncStatus) {
        syncStatus.className = 'sync-status is-error';
        syncStatus.textContent = 'Please enter both email and password.';
      }
      return;
    }

    if (syncStatus) {
      syncStatus.className = 'sync-status is-loading';
      syncStatus.textContent = 'Authenticating with Shaper and uploading...';
    }
    if (syncSubmitBtn) syncSubmitBtn.disabled = true;

    try {
      const res = await fetch('/api/shaper-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, filename, svg: payload.svg })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `Upload failed with status ${res.status}`);
      }

      if (syncRemember && syncRemember.checked) {
        try { localStorage.setItem(CRED_STORAGE_KEY, JSON.stringify({ email, password })); } catch (_) {}
      } else {
        try { localStorage.removeItem(CRED_STORAGE_KEY); } catch (_) {}
      }

      if (syncStatus) {
        syncStatus.className = 'sync-status is-success';
        syncStatus.textContent = `✓ Uploaded "${data.filename || filename}" to ShaperHub!`;
      }
      const expStatus = document.getElementById('simexport-status');
      if (expStatus) {
        expStatus.innerHTML = `✓ Synced <strong>${data.filename || filename}</strong> directly to ShaperHub! It will now appear on your Origin over Wi-Fi.`;
      }
      setTimeout(() => {
        closeSyncModal();
      }, 1200);
    } catch (err) {
      if (syncStatus) {
        syncStatus.className = 'sync-status is-error';
        syncStatus.textContent = `Error: ${err.message}`;
      }
      if (syncSubmitBtn) syncSubmitBtn.disabled = false;
    }
  });
}

// SKETCH-4d: the GROUP / UNGROUP action (Shaper Design only). Ctrl+G groups the selected shapes (≥2) under a NEW
// userGroupId; Ctrl+Shift+G ungroups the selection's group(s). Operates on the Design selection (state.selectedShapes);
// the group belongs to the active sketch (makeGroup) for organisation only (no hole meaning). Shaper-only.
const groupStatus = createGroupStatus(() => VIEWS.design); // TASK 610: group-status.js (the page and the node test kit both create it)
function doGroup() {
  if (!designController) return;
  const st = designController.state;
  const sel = (st.selectedShapes instanceof Set) ? [...st.selectedShapes] : [];
  if (sel.length < 2) { groupStatus('Select 2+ shapes to group'); return; }
  try { st.saveState && st.saveState('group'); } catch (_) {}
  const g = makeGroup(st, sel);
  groupStatus(`Grouped ${sel.length} shapes → ${g ? g.name : 'group'}`);
}
function doUngroup() {
  if (!designController) return;
  const st = designController.state;
  const sel = (st.selectedShapes instanceof Set) ? [...st.selectedShapes] : [];
  const byId = new Map((st.shapes || []).map((s) => [s.id, s]));
  const gids = new Set(); for (const id of sel) { const gid = groupOf(byId.get(id)); if (gid) gids.add(gid); }
  if (!gids.size) { groupStatus('No group on the selection'); return; }
  try { st.saveState && st.saveState('ungroup'); } catch (_) {}
  for (const gid of gids) ungroup(st, gid);
  groupStatus(`Ungrouped ${gids.size} group${gids.size === 1 ? '' : 's'}`);
}
document.addEventListener('keydown', (e) => {
  if (modes.current() !== 'design') return;
  if ((e.ctrlKey || e.metaKey) && (e.key === 'g' || e.key === 'G')) {
    e.preventDefault();
    if (e.shiftKey) doUngroup(); else doGroup();
  }
});

// SKETCH/IMPORT-2 + TASK 478 + TASK 566: SVG / DXF IMPORT -> a NEW sketch, through the ONE shared importer (#ui/sketch-import.js), with Shaper's own options
// declared in cut-import.js (TASK 583: each element's cut record, kept descIds, the cuts kept in CUT_PLAN; the node test kit calls it too).
// The entry is the sidebar's "Import SVG / DXF…" (project-actions.js, passed to mountProjectSidebar above); a drop on the Design view is the second way in.
const shaperImporter = createShaperImporter({ ensureSketch, getController: () => designController, getInfoPanel: () => infoPanel, notify: groupStatus, getDropHost: () => VIEWS.design }); // TASK 610: cut-import.js

document.getElementById('fit').addEventListener('click', () => canvas.refit());

// Drag-and-drop onto the canvas.
const dropZone = document.getElementById('canvas');
['dragenter', 'dragover'].forEach((ev) =>
  dropZone.addEventListener(ev, (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  }),
);
['dragleave', 'drop'].forEach((ev) =>
  dropZone.addEventListener(ev, (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
  }),
);
dropZone.addEventListener('drop', (e) => {
  const file = e.dataTransfer?.files?.[0];
  if (file) loadFile(file);
});

async function loadFile(file) {
  try {
    const text = await file.text();
    setDoc(parseSvg(text));
  } catch (err) {
    alert(`Could not load SVG:\n${err.message}`);
  }
}

// ── S6a: 4-mode app shell — a view router over Explore / Design / Prepare / Simulate-Export. (modes.js: declared once, the node test kit calls it too) ──
const VIEWS = findViews(document);
const modeBtns = [...document.querySelectorAll('.mode-btn')];
const exploreActions = document.getElementById('explore-actions');
let modes = null; // the mode router (created below, once the views it enters exist)

let reviewView = null;       // TASK 459: the 3D Review (mounted on first entry, three imported dynamically)
let showStockThickness = () => {}; // TASK 460: re-syncs the Review card's thickness field after a document restore (assigned below)
let vcarveView = null;       // VCARVE-3b: the live Vcarve workspace; mounted once, refreshed per Vcarve enter
// SP1c-f, TASK 463, TASK 472 (prepare-stage.js): the Prepare view, the cut-settings card, every cut-plan edit as ONE step of the shared history, the cut
// plan in the sketch's undo snapshots, the Ctrl+Z / Ctrl+Y keys while Prepare shows, the one-line notice
const prepare = createPrepareStage({
  getController: () => designController, getMode: () => modes.current(),
  panelEl: document.getElementById('prepare-panel'), canvasEl: document.getElementById('prepare-canvas'), noticeEl: document.getElementById('prepare-notice'),
  ensureSketch, notify: groupStatus, onViewChange: (v) => { window.__prepareView = v; }, // the page's dev / test seam
});

applyShaperUnitDefault(); // U3b (design-canvas.js, declared once: the node test kit calls it too)

// U3b: the shared style-panel as a header-opened MODAL; its Units tab holds the one document-unit control.
const stylePanel = createStylePanel({ hostId: 'shaper' });
stylePanel.render(document.body);
bindTemplateTokens(document.getElementById('design-canvas'));
const settingsBtn = document.getElementById('btn-settings');
if (settingsBtn) settingsBtn.addEventListener('click', () => stylePanel.toggle());

let browser = null, infoPanel = null, ribbon = null, lastSig = '';

// Refresh the Design ribbon + info panel when the sketch changes (active tool / constraint count / values /
// selection). Called each render frame via mountSketch's onRender hook; the signature check keeps it cheap. Since
// the sig includes currentTool, a KEYBOARD tool-switch refreshes the ribbon's .active too (not just ribbon clicks).
function panelTick() {
  if (!designController) return;
  const s = designController.state;
  let vsum = 0; for (const c of s.constraints) if (typeof c.value === 'number') vsum += c.value;
  // Include shapes/joints counts so DRAWING geometry (which may add no constraint) still refreshes the DOF readout.
  const nShapes = (s.shapes && s.shapes.length) || 0;
  const nJoints = (s.joints && s.joints.size) || 0;
  const sig = s.constraints.length + ':' + nShapes + ':' + nJoints + ':' + vsum.toFixed(1) + ':' + (s.selectedConstraints ? s.selectedConstraints.size : 0) + ':' + s.currentTool + ':' + sketchesSignature(s);
  if (sig !== lastSig) { lastSig = sig; if (ribbon) ribbon.refresh(); if (infoPanel) infoPanel.refresh(); }
}

// Build the Design UI ONCE (S7b): a full-width SketchStudio-style tool ribbon on TOP (#design-ribbon) and the canvas below it, with the
// SKETCHES browser (shared, #ui/design-browser.js, task 586) floating over the canvas's top-left. Shaper's Design tab has no other panel.
function buildDesignUI() {
  const { state, engine } = designController;
  browser = mountShaperBrowser({ state, engine }); // design-canvas.js
  browser.drawer.toggleEl.style.display = 'none'; // shown only while Design is the active mode (showMode below)
  infoPanel = browser.panel;
  ribbon = createToolRibbon({
    state,
    ...RIBBON_OPTIONS, // design-canvas.js
    notify: groupStatus,
  });
  ribbon.render(document.getElementById('design-ribbon'));

  shaperImporter.mountDrop(); // a drop on the Design view (the menu entry is mounted with the sidebar)
}

// Mount the shared sketcher ONCE. isActive is tied to the ACTIVE MODE (R-COEXIST), not just design-view
// visibility, so the input layer's document listeners no-op unless Design is the current mode.
function ensureSketch() {
  if (designController) return;
  designController = mountSketch(document.getElementById(DESIGN_CANVAS_ID), {
    isActive: () => modes.current() === 'design',
    onRender: panelTick, // S5c/S6b/S7b: refresh the ribbon + info panel on change, in sync with the render loop
    ...DESIGN_CANVAS_OPTIONS, // design-canvas.js: seedDemo false (the autosave buffer decides), the shared grid, profiles
    notify: groupStatus,
  });
  window.__designController = designController; // for test/evidence inspection
  designController.state.hostSnapshot = prepare.hostSnapshot; // TASK 463: the cut plan rides in the shared undo snapshots
  buildDesignUI();

  // PERSIST-2: restore the shared cross-app document (if any) before the RAF loop's first solve, then
  // keep autosaving. The save state is the document tab's dot (TASK 605); a failed save also shows in the menu's status line.
  // design-canvas.js shaperBufferOptions: the restore (solve, frame, the views below, then the cut plan + stock sidecar), the sidecar, the tab's stage state
  docBuffer = createDocumentBuffer(shaperBufferOptions({
    controller: designController, canvas: document.getElementById(DESIGN_CANVAS_ID),
    session: createShaperSession({ prepare, getVcarveView: () => vcarveView }), // shaper-session.js: Explore SVG, Prepare selection + view, Vcarve view
    refreshViews: () => { if (infoPanel) infoPanel.refresh(); if (vcarveView) vcarveView.refresh(); },
    // re-mount Prepare if it is the visible mode so it shows the restored geometry + cuts
    afterSidecar: () => {
      prepare.afterRestore();
      showStockThickness();
      if (modes.current() === 'review') enterReview(designController.state);
    },
  }));
  docBuffer.restore();
  docBuffer.start();
}


// The view router (modes.js): show the active mode's container, hide the rest, drive the Design RAF lifecycle, persist the active mode.
modes = createModeRouter({
  views: VIEWS, modeBtns, exploreActions, getController: () => designController, ensureSketch,
  afterShow: (mode) => { if (browser) { if (mode !== 'design') browser.drawer.close(); browser.drawer.toggleEl.style.display = (mode === 'design') ? '' : 'none'; } }, // task 586: the Sketches drawer button shows only on Design
  enter: {
    vcarve: () => {
      ensureSketch();
      try { designController.engine.solve(500); } catch (_) {}
      if (!vcarveView) vcarveView = mountVcarveView(designController.state);
      else vcarveView.refresh();
      window.__vcarveView = vcarveView;
    },
    prepare: prepare.enter,
    review: () => {
      ensureSketch();
      try { designController.engine.solve(500); } catch (_) {}
      enterReview(designController.state);
    },
  },
});
const showMode = modes.showMode;

// TASK 459: Review = the finished workpiece in 3D, built only from the Prepare cut plan + the declared stock.
const reviewInputs = (st) => {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const j of st.joints.values()) { minX = Math.min(minX, j.x); maxX = Math.max(maxX, j.x); minY = Math.min(minY, j.y); maxY = Math.max(maxY, j.y); }
  return { stock: resolveStock(st, CUT_PLAN).stock, items: planReliefItems(st), bounds: Number.isFinite(minX) ? { minX, maxX, minY, maxY } : null };
};
const reviewSig = (st) => JSON.stringify([[...CUT_PLAN], getStock(), st.vcarves || [], [...st.joints.values()].map((j) => [j.x, j.y])]);
async function enterReview(st) {
  const info = document.getElementById('review-info');
  try {
    if (!reviewView) {
      info.textContent = 'Loading 3D…';
      reviewView = await mountReviewView({ host: document.getElementById('review-canvas-host'), info, getInputs: () => reviewInputs(designController.state), wood: document.getElementById('review-wood').checked });
    }
    showStockThickness();
    reviewView.refresh(reviewSig(st));
  } catch (e) { info.textContent = 'Review failed: ' + e.message; throw e; }
}
{
  const stockCard = createStockCard({ input: document.getElementById('review-stock-thickness'), noteEl: document.getElementById('review-stock-note'), getController: () => designController,
    onChange: () => { if (reviewView) reviewView.refresh(reviewSig(designController.state)); } }); // TASK 583 (stock-card.js): the thickness field of the Review card
  showStockThickness = stockCard.show;
  document.getElementById('review-reset').addEventListener('click', () => reviewView && reviewView.reset());
  document.getElementById('review-top').addEventListener('click', () => reviewView && reviewView.top());
  document.getElementById('review-fit').addEventListener('click', () => reviewView && reviewView.fit());
  document.getElementById('review-wood').addEventListener('change', (e) => reviewView && reviewView.setWood(e.target.checked)); // per session
}

// Restore the last active mode (default Explore).
let initMode = 'explore';
try { initMode = localStorage.getItem(MODE_KEY) || 'explore'; } catch (_) { /* storage blocked */ }
if (initMode === 'simexport') initMode = 'review'; // TASK 459: the tab was renamed Simulate/Export -> Review
ensureSketch(); // TASK 605: the document buffer (and so the tab strip) exists from the first paint, whichever mode the page opens on
showMode(initMode);
