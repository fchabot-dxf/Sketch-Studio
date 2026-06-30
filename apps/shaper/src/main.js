// SVG Editor — boot + wiring.

import { store, setDoc } from './store.js';
import { parseSvg, serializeSvg, download } from './svgio.js';
import * as canvas from './canvas.js';
import * as tree from './tree.js';
import * as inspector from './inspector.js';
// Shared #core-backed sketcher (S1). Eager import so the page load exercises #ui/ + #core/ resolution;
// the mount itself runs only when the Design tab is first opened.
import { mountSketch } from '#ui/sketch-canvas.js';
import { createDesignInfoPanel } from '#ui/design-info-panel.js';
import { createToolRibbon } from '#ui/tool-ribbon.js';
import { mountPrepareView } from './prepare-view.js'; // SP1a/c/d/e: Prepare render + loop/edge select + cut preview
import { createCutPanel } from './cut-panel.js';       // SP1f: the cut-settings card (cut-type control)
import { createStylePanel } from '#ui/style-panel.js'; // U3b: shared settings modal (with the doc-unit toggle)
import SettingsManager from '#core/settings-manager.js';
import { cutPlanEntries } from './cut-plan.js';            // SP1j-4: the shared cut-plan store
import { CUT_TYPES } from './shaper.js';                   // SP1j-4: injected as the exporter's encoding
import { exportShaperSVG } from '#core/shaper-export.js';  // SP1j: pure cut-plan → Shaper SVG serializer
import { createAppSwitcher } from '#ui/app-switcher.js';   // SWITCH-1: shared two-way app-switcher
import { makeGroup, ungroup, groupOf } from '#core/group-model.js'; // SKETCH-4d: the Group/Ungroup action
import { findLoops } from '#core/loop-finder.js';        // SKETCH-4e: enumerate loops for island polys
import { loopPolygon } from '#core/loop-geometry.js';     // SKETCH-4e: HOST computes loop polys (DOM) → serializer stays pure

canvas.init(document.getElementById('canvas'));
tree.init(document.getElementById('tree'));
inspector.init(document.getElementById('inspector'));

// SWITCH-1: mount the shared two-way app-switcher into the header brand slot.
const _swHost = document.getElementById('app-switcher-host');
if (_swHost) _swHost.appendChild(createAppSwitcher({ current: 'shaper' }).el);

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
const getDocUnit = () => SettingsManager.get('DOC_UNIT') || 'mm';
document.getElementById('btn-generate-svg').addEventListener('click', () => {
  const status = document.getElementById('simexport-status');
  const entries = cutPlanEntries();
  if (!entries.length) { if (status) status.textContent = 'No cuts assigned — assign cut types in Prepare first.'; return; }
  ensureSketch();
  try { designController.engine.solve(500); } catch (_) { /* best-effort solve before export */ }
  const st = designController.state;
  // SKETCH-4e: the HOST (has the DOM) computes each loop's boundary polygon for the island containment test; the
  // serializer stays PURE (never calls the DOM-dependent sampleArc — the S-4a purity rule).
  const sById = new Map((st.shapes || []).map((s) => [s.id, s]));
  const loopPolys = {};
  for (const l of findLoops(st)) loopPolys[l.id] = loopPolygon(l, st, sById);
  // SP1j-3a: groupByCut ON (cleaner files). SKETCH-4e: islands ON (a grouped pocket with a contained loop → evenodd
  // compound; non-grouped/non-nested plans are unaffected). The datum triangle stays OFF pending a "Drop Datum" toggle.
  const svg = exportShaperSVG({ state: st, entries, encoding: CUT_TYPES, docUnit: getDocUnit(), options: { groupByCut: true, islands: true }, loopPolys });
  download('shaper-export.svg', svg);
  if (status) status.textContent = `Exported ${entries.length} cut${entries.length === 1 ? '' : 's'} → shaper-export.svg`;
});

// SKETCH-4d: the GROUP / UNGROUP action (Shaper Design only). Ctrl+G groups the selected shapes (≥2) under a NEW
// userGroupId; Ctrl+Shift+G ungroups the selection's group(s). Operates on the Design selection (state.selectedShapes);
// the group belongs to the active sketch (makeGroup). A transient status toast is the cue — the renderer's factory
// groupId/fill is UNTOUCHED (we only set userGroupId). Unblocks islands (S-4e export). Shaper-only.
let _grpStatusEl = null, _grpStatusTimer = null;
function groupStatus(msg) {
  if (!_grpStatusEl) {
    _grpStatusEl = document.createElement('div'); _grpStatusEl.id = 'group-status';
    _grpStatusEl.style.cssText = 'position:absolute; bottom:18px; left:50%; transform:translateX(-50%); background:#1b2030; color:#cbd5e1; border:1px solid #2a2d31; border-radius:8px; padding:8px 14px; font:13px system-ui,sans-serif; z-index:50; box-shadow:0 6px 20px rgba(0,0,0,0.4); pointer-events:none; opacity:0; transition:opacity 0.15s;';
    (VIEWS.design || document.body).appendChild(_grpStatusEl);
  }
  _grpStatusEl.textContent = msg; _grpStatusEl.style.opacity = '1';
  clearTimeout(_grpStatusTimer); _grpStatusTimer = setTimeout(() => { if (_grpStatusEl) _grpStatusEl.style.opacity = '0'; }, 1800);
}
function doGroup() {
  if (!designController) return;
  const st = designController.state;
  const sel = (st.selectedShapes instanceof Set) ? [...st.selectedShapes] : [];
  if (sel.length < 2) { groupStatus('Select 2+ shapes to group'); return; }
  try { st.saveState && st.saveState(); } catch (_) {}
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
  try { st.saveState && st.saveState(); } catch (_) {}
  for (const gid of gids) ungroup(st, gid);
  groupStatus(`Ungrouped ${gids.size} group${gids.size === 1 ? '' : 's'}`);
}
document.addEventListener('keydown', (e) => {
  if (currentMode !== 'design') return;
  if ((e.ctrlKey || e.metaKey) && (e.key === 'g' || e.key === 'G')) {
    e.preventDefault();
    if (e.shiftKey) doUngroup(); else doGroup();
  }
});

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

// ── S6a: 4-mode app shell — a view router over Explore / Design / Prepare / Simulate-Export. ──
// Replaces the old editor↔Design toggle. The SVG editor (Explore) is inited ONCE above and never re-inited; the
// router only shows/hides containers. The shared sketcher (Design) mounts once on first entry; its RAF runs only
// while Design is the active mode, and the input layer's isActive gate is tied to the ACTIVE MODE (not mere
// visibility) so Explore/Prepare/Sim keystrokes never reach the sketcher (R-COEXIST).
const VIEWS = {
  explore:   document.querySelector('main.layout'),   // the existing SVG editor (normal flow)
  design:    document.getElementById('design-view'),  // the shared sketcher (absolute overlay)
  prepare:   document.getElementById('view-prepare'),
  simexport: document.getElementById('view-simexport'),
};
const modeBtns = [...document.querySelectorAll('.mode-btn')];
const exploreActions = document.getElementById('explore-actions');
const MODE_KEY = 'shaper-mode';
let currentMode = 'explore';

let designController = null; // sketcher mounted once; RAF started while Design is active, paused otherwise
let prepareView = null;      // SP1c–f: Prepare-local view (edges + loop/edge select + cut preview); re-mounted per Prepare enter
// SP1f: the cut-settings card reflects the Prepare selection + writes the picked cut type back onto it.
const refreshCutPanel = () => {
  const t = prepareView && prepareView.selectedTarget && prepareView.selectedTarget();
  cutPanel.update(t ? { kind: t.kind, record: prepareView.recordFor(t) } : null);
};
const cutPanel = createCutPanel(document.getElementById('prepare-panel'), {
  onPickType: (id) => { if (prepareView) prepareView.applyCutTypeToSelected(id); refreshCutPanel(); },
  onSetField: (field, value) => { if (prepareView) prepareView.setFieldOnSelected(field, value); refreshCutPanel(); },
});

// U3b: Shaper defaults to INCH — but ONLY when the user hasn't persisted a doc-unit choice. persist:false keeps it
// in-memory (the default never writes to the shared 'sketch-studio-settings' localStorage, so it can't leak to a
// same-origin SketchStudio); only an explicit toggle in the Settings modal persists.
try {
  const persisted = JSON.parse(localStorage.getItem('sketch-studio-settings') || '{}');
  if (persisted.DOC_UNIT === undefined) SettingsManager.set('DOC_UNIT', 'in', { persist: false });
} catch (_) { /* localStorage blocked */ }

// U3b: the shared style-panel as a header-opened MODAL, with the host-opt-in doc-unit toggle. SketchStudio does NOT
// pass showDocUnit → its panel stays the 16 controls / byte-identical.
const stylePanel = createStylePanel({ showDocUnit: true });
stylePanel.render(document.body);
const settingsBtn = document.getElementById('btn-settings');
if (settingsBtn) settingsBtn.addEventListener('click', () => stylePanel.toggle());

let infoPanel = null, ribbon = null, lastSig = '';

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
  const sig = s.constraints.length + ':' + nShapes + ':' + nJoints + ':' + vsum.toFixed(1) + ':' + (s.selectedConstraints ? s.selectedConstraints.size : 0) + ':' + s.currentTool;
  if (sig !== lastSig) { lastSig = sig; if (ribbon) ribbon.refresh(); if (infoPanel) infoPanel.refresh(); }
}

// Build the Design UI ONCE (S7b): a full-width SketchStudio-style tool ribbon on TOP (#design-ribbon), and a
// COLLAPSIBLE left side panel holding ONLY the live constraint-list/DOF info panel (#design-panel-info) beside the
// untouched canvas. Reuses the shared #ui factories; dark via --sk-* (Shaper's :root). The canvas is not touched —
// collapsing the panel just reflows it wider.
const PANEL_COLLAPSED_KEY = 'shaper-design-panel-collapsed';
function buildDesignUI() {
  const { state, engine } = designController;
  infoPanel = createDesignInfoPanel({ state, engine, showSketchTree: true }); // SKETCH-1b: Shaper opts into the tree
  infoPanel.render(document.getElementById('design-panel-info'));
  ribbon = createToolRibbon({ state });
  ribbon.render(document.getElementById('design-ribbon'));

  // Collapsible side panel: chevron toggles a thin strip ↔ full panel (canvas reflows); persisted.
  const panel = document.getElementById('design-panel');
  const toggle = document.getElementById('design-panel-toggle');
  const setCollapsed = (c) => {
    panel.classList.toggle('collapsed', c);
    toggle.textContent = c ? '▶' : '◀';
    toggle.title = c ? 'Expand panel' : 'Collapse panel';
    try { localStorage.setItem(PANEL_COLLAPSED_KEY, c ? '1' : '0'); } catch (_) { /* storage blocked */ }
  };
  let collapsed = false;
  try { collapsed = localStorage.getItem(PANEL_COLLAPSED_KEY) === '1'; } catch (_) {}
  setCollapsed(collapsed);
  toggle.addEventListener('click', () => setCollapsed(!panel.classList.contains('collapsed')));
}

// Mount the shared sketcher ONCE. isActive is tied to the ACTIVE MODE (R-COEXIST), not just design-view
// visibility, so the input layer's document listeners no-op unless Design is the current mode.
function ensureSketch() {
  if (designController) return;
  designController = mountSketch(document.getElementById('design-canvas'), {
    isActive: () => currentMode === 'design',
    onRender: panelTick, // S5c/S6b/S7b: refresh the ribbon + info panel on change, in sync with the render loop
  });
  buildDesignUI();
}

// The view router: show the active mode's container, hide the rest. Explore is in normal flow (display); the
// other three are absolute overlays (hidden attr). Drives the Design RAF lifecycle + persists the active mode.
function showMode(mode) {
  if (!VIEWS[mode]) mode = 'explore';
  currentMode = mode;
  VIEWS.explore.style.display = (mode === 'explore') ? '' : 'none';
  VIEWS.design.hidden    = (mode !== 'design');   // make the canvas visible BEFORE start() so frame 1 sees a laid-out svg
  VIEWS.prepare.hidden   = (mode !== 'prepare');
  VIEWS.simexport.hidden = (mode !== 'simexport');
  if (exploreActions) exploreActions.style.display = (mode === 'explore') ? '' : 'none';
  modeBtns.forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
  if (mode === 'design') { ensureSketch(); designController.start(); } // idempotent (guards against a second RAF)
  else if (designController) designController.stop();                   // pause the RAF off Design
  // SP1a/SP1c: Prepare REUSES the shared Design sketch (no 2nd engine/RAF). Ensure it's mounted + solved, then mount
  // a Prepare-local view: edges (no joints) + topological-loop hover-highlight. Render-on-demand — geometry is
  // static in Prepare, so loops are found once on (re)mount; the highlight redraws only on hover-change (no RAF).
  if (mode === 'prepare') {
    ensureSketch();
    try { designController.engine.solve(500); } catch (_) {}
    if (prepareView) prepareView.destroy();
    prepareView = mountPrepareView(designController.state, document.getElementById('prepare-canvas'), { onSelectionChange: refreshCutPanel });
    refreshCutPanel(); // no selection yet → the card stays hidden
  }
  try { localStorage.setItem(MODE_KEY, mode); } catch (_) { /* storage blocked */ }
}

modeBtns.forEach((b) => b.addEventListener('click', () => showMode(b.dataset.mode)));

// Restore the last active mode (default Explore).
let initMode = 'explore';
try { initMode = localStorage.getItem(MODE_KEY) || 'explore'; } catch (_) { /* storage blocked */ }
showMode(initMode);
