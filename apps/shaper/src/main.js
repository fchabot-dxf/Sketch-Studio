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
import { createMobileDrawer } from '#ui/mobile-drawer.js';
import { createDocumentBuffer } from '#ui/document-buffer.js'; // PERSIST-2: autosave + cross-app carry
import { undoRedoKeyAction } from '#ui/input-manager.js'; // TASK 463: the shared history key mapping
import { captureShaperDoc, applyShaperDoc, captureCutPlan, applyCutPlan } from './shaper-doc.js'; // TASK 460: the cut plan + stock ride in doc.hosts.shaper
import { createDiagnosticLog } from '#ui/diagnostic-log.js'; // DIAG-OVERLAY: mobile-usable log + Copy Report
import { mountPrepareView } from './prepare-view.js'; // SP1a/c/d/e: Prepare render + loop/edge select + cut preview
import { mountReviewView } from './review-view.js';   // TASK 459: the 3D Review (three loads only when the tab first opens)
import { getStock, setStockField, resolveStock } from './stock.js'; // TASK 459: the declared stock (persisted by shaper-doc.js, TASK 460)
import { parse as parseUnit, format as formatUnit } from '#core/units.js';
import { mountVcarveView } from './vcarve-view.js';   // VCARVE-3b: the live Vcarve workspace
import { createCutPanel } from './cut-panel.js';       // SP1f: the cut-settings card (cut-type control)
import { createStylePanel } from '#ui/style-panel.js'; // U3b: shared settings modal (with the doc-unit toggle)
import SettingsManager from '#core/settings-manager.js';
import { cutPlanEntries, CUT_PLAN, keyOf, migrateEdgeRecords, planReliefItems } from './cut-plan.js'; // SP1j-4: the shared cut-plan store
import { CUT_TYPES, extractCutRecord, exportEncoding } from './shaper.js';                   // SP1j-4: injected as the exporter's encoding
import { exportShaperSVG } from '#core/shaper-export.js';  // SP1j: pure cut-plan → Shaper SVG serializer
import { createAppSidebar, SIDEBAR_ICONS } from '#ui/app-sidebar.js'; // TASK 473: the shared app sidebar (replaces the app-switcher dropdown)
import { applyAppIdentity } from '#ui/app-registry.js'; // TASK 473: tab title + favicon from the registry
applyAppIdentity('shaper');
import { makeGroup, ungroup, groupOf } from '#core/group-model.js'; // SKETCH-4d: user Group/Ungroup organisation action
import { findLoops, findOpenChains } from '#core/loop-finder.js';        // enumerate loops for export boundary polygons
import { loopPolygon } from '#core/loop-geometry.js';     // HOST computes loop polys (DOM) → serializer stays pure
import { computeImportScale, importSvgGeometry, multiplyMatrix, parseTransform, IDENTITY_MATRIX } from '#core/svg-import.js'; // IMPORT-2: SVG → #core shapes
import { addSketch, activateSketch } from '#core/sketch-model.js';           // IMPORT-2: land each import in a new sketch

canvas.init(document.getElementById('canvas'));
tree.init(document.getElementById('tree'));
inspector.init(document.getElementById('inspector'));

// TASK 473: the shared app sidebar (hamburger, document actions, GO TO) in the header brand slot. This host declares ITS actions:
// Download = the Shaper SVG export (the same payload the export button builds), New = a fresh document.
const _swHost = document.getElementById('app-sidebar-host');
if (_swHost) {
  _swHost.appendChild(createAppSidebar({
    current: 'shaper', docName: 'Untitled',
    actions: [
      { id: 'download', label: 'Download', icon: SIDEBAR_ICONS.download, tooltip: 'Download the Shaper SVG (the Prepare cut plan)', onClick: () => {
        const payload = generateShaperSvgPayload();
        if (!payload) { groupStatus('No cuts assigned — assign cut types in Prepare first.'); return; }
        download('shaper-export.svg', payload.svg);
      } },
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
const getDocUnit = () => SettingsManager.get('DOC_UNIT') || 'mm';

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
  const svg = exportShaperSVG({ state: st, entries, encoding: exportEncoding(), docUnit: getDocUnit(), options: { groupByCut: true }, loopPolys });
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

// SKETCH/IMPORT-2: SVG IMPORT → a NEW sketch (Shaper-only). The host (has the DOM) extracts per-element descriptors +
// the root size; the PURE #core/svg-import maps them → STATIC joints/shapes (no auto-constraints). Each import = one
// named sketch (addSketch → activate → push; the wrap stamps sketchId). v1 subset: unsupported elements/features are
// COUNTED + surfaced, never silently dropped.
let importSeq = 0;
const SVG_IMPORT_TAGS = new Set(['line', 'rect', 'circle', 'ellipse', 'polyline', 'polygon', 'path']);
const SKIP_SILENT = new Set(['metadata', 'title', 'desc', 'defs', 'style']); // structural, not dropped geometry
function svgImportDescriptors(svg) {
  const descs = [], skippedEls = [];
  let descSeq = 0;
  // GRIEVANCE-2: recurse the tree threading a composed CTM down it, so nested group art (potrace / Illustrator /
  // Inkscape wrap ALL art in one transformed group) imports placed + un-flipped instead of empty. Each element's
  // CTM = the parent CTM composed with its own transform=; leaf descriptors carry it so #core can bake it in.
  const walk = (parent, ctm) => {
    for (const el of parent.children) {
      const tag = (el.tagName || '').toLowerCase();
      const tf = (el.getAttribute && el.getAttribute('transform')) || '';
      const elCtm = tf ? multiplyMatrix(ctm, parseTransform(tf)) : ctm;
      if (tag === 'g' || tag === 'svg') { walk(el, elCtm); continue; } // groups (and a nested svg) recurse
      if (!SVG_IMPORT_TAGS.has(tag)) { if (tag && !SKIP_SILENT.has(tag)) skippedEls.push('<' + tag + '>'); continue; }
      const a = (n) => el.getAttribute(n);
      const descId = 'desc_' + (descSeq++);
      const cutRecord = extractCutRecord(el, getDocUnit());
      const base = { tag, ctm: elCtm, descId, cutRecord };
      if (tag === 'line') descs.push({ ...base, x1: a('x1'), y1: a('y1'), x2: a('x2'), y2: a('y2') });
      else if (tag === 'rect') descs.push({ ...base, x: a('x'), y: a('y'), width: a('width'), height: a('height'), rx: a('rx'), ry: a('ry') });
      else if (tag === 'circle') descs.push({ ...base, cx: a('cx'), cy: a('cy'), r: a('r') });
      else if (tag === 'ellipse') descs.push({ ...base, cx: a('cx'), cy: a('cy'), rx: a('rx'), ry: a('ry') });
      else if (tag === 'polyline' || tag === 'polygon') descs.push({ ...base, points: a('points') });
      else if (tag === 'path') descs.push({ ...base, d: a('d') });
    }
  };
  walk(svg, IDENTITY_MATRIX);
  return { descs, skippedEls };
}
function importSvgToSketch(svgText, fileName) {
  ensureSketch();
  const st = designController.state;
  let svg; try { svg = parseSvg(svgText); } catch (e) { groupStatus('Import failed: ' + e.message); return; }
  const { descs, skippedEls } = svgImportDescriptors(svg);
  const { scale, label, assumed } = computeImportScale({ width: svg.getAttribute('width'), height: svg.getAttribute('height'), viewBox: svg.getAttribute('viewBox') });
  const { joints, shapes, stats } = importSvgGeometry(descs, { genJ: () => st.genJ(), scale, idPrefix: 'svg' + (importSeq++) });
  const skipN = skippedEls.length + (stats.skipped || []).reduce((n, s) => n + s.count, 0);
  if (!shapes.length) { groupStatus('Nothing imported' + (skipN ? ` · ${skipN} skipped` : '')); return; }
  try { st.saveState && st.saveState(); } catch (_) {}
  const sk = addSketch(st, (fileName || 'Imported').replace(/\.svg$/i, '') || 'Imported');
  activateSketch(st, sk.id);
  for (const j of joints) st.joints.set(j.id, { x: j.x, y: j.y });
  for (const s of shapes) st.shapes.push(s);

  // Connect imported cut metadata to in-memory CUT_PLAN:
  const cutRecordByDesc = new Map();
  for (const d of descs) {
    if (d.descId && d.cutRecord && (d.cutRecord.cutType || (d.cutRecord.cutDepth != null && d.cutRecord.cutDepth !== 'unset'))) {
      cutRecordByDesc.set(d.descId, d.cutRecord);
    }
  }

  let cutsAssigned = 0;
  if (cutRecordByDesc.size > 0) {
    const shapeById = new Map((st.shapes || []).map((s) => [s.id, s]));
    const loops = findLoops(st);
    const assignedShapeIds = new Set();

    for (const loop of loops) {
      const loopDescIds = new Set();
      for (const edgeId of (loop.edges || [])) {
        const shape = shapeById.get(edgeId);
        if (shape && shape.descId) loopDescIds.add(shape.descId);
      }
      if (loopDescIds.size === 1) {
        const descId = [...loopDescIds][0];
        if (cutRecordByDesc.has(descId)) {
          const rec = cutRecordByDesc.get(descId);
          CUT_PLAN.set(keyOf('loop', loop.id), { ...rec });
          for (const edgeId of (loop.edges || [])) assignedShapeIds.add(edgeId);
          cutsAssigned++;
        }
      }
    }

    const chains = findOpenChains(st, loops);
    for (const c of chains) {
      for (const s of (c.shapes || [])) {
        if (s.descId && cutRecordByDesc.has(s.descId)) {
          const rec = cutRecordByDesc.get(s.descId);
          if (rec.cutType === 'online' || rec.cutType === 'guide' || (rec.cutDepth != null && rec.cutDepth !== 'unset')) {
            const chainKey = keyOf('chain', c.id);
            if (!CUT_PLAN.has(chainKey)) {
              CUT_PLAN.set(chainKey, { ...rec, cutType: rec.cutType || 'online' });
              cutsAssigned++;
            }
          }
        }
      }
    }
  }

  if (infoPanel) infoPanel.refresh();
  const cutsMsg = cutsAssigned ? ` · ${cutsAssigned} cut${cutsAssigned === 1 ? '' : 's'} kept` : '';
  groupStatus(`Imported ${shapes.length} shapes → ${sk.name} @ ${label}${assumed ? ' (assumed)' : ''}${cutsMsg}${skipN ? ` · ${skipN} skipped` : ''}`);
}
// The Import ACTION: a button at the TOP of the left side panel (#design-panel-info) + a drag-drop on the Design
// canvas. Wired in buildDesignUI (after the panel renders). The button sits ABOVE the info panel's content (it's a
// sibling, so the panel's refresh() — which only rebuilds its own root — never removes it).
function wireSvgImport() {
  const dropHost = VIEWS.design;
  const panel = document.getElementById('design-panel-info');
  if (!dropHost || !panel || panel.querySelector('#svg-import-btn')) return;
  const input = document.createElement('input');
  input.type = 'file'; input.accept = '.svg,image/svg+xml'; input.style.display = 'none';
  input.addEventListener('change', async () => { const f = input.files && input.files[0]; if (f) { importSvgToSketch(await f.text(), f.name); input.value = ''; } });
  const btn = document.createElement('button');
  btn.id = 'svg-import-btn'; btn.textContent = '⬇ Import SVG'; btn.title = 'Import an SVG into a new sketch';
  btn.style.cssText = 'display:block; width:calc(100% - 16px); box-sizing:border-box; margin:8px 8px 6px; padding:7px 10px; background:#1b2030; color:#cbd5e1; border:1px solid #2a2d31; border-radius:7px; font:13px system-ui,sans-serif; cursor:pointer; text-align:left;';
  btn.addEventListener('click', () => input.click());
  panel.insertBefore(btn, panel.firstChild); // top of the sidebar, above the SKETCHES tree
  panel.appendChild(input);
  dropHost.addEventListener('dragover', (e) => { e.preventDefault(); });
  dropHost.addEventListener('drop', async (e) => { e.preventDefault(); const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (f) importSvgToSketch(await f.text(), f.name); });
}

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
  vcarve:    document.getElementById('view-vcarve'),   // VCARVE-3a: the Vcarve space (skeleton)
  prepare:   document.getElementById('view-prepare'),
  review:    document.getElementById('view-review'),
};
const modeBtns = [...document.querySelectorAll('.mode-btn')];
const exploreActions = document.getElementById('explore-actions');
const MODE_KEY = 'shaper-mode';
let currentMode = 'explore';

let designController = null; // sketcher mounted once; RAF started while Design is active, paused otherwise
let docBuffer = null; // TASK 474: the autosave buffer / project actions of this app (created with the sketch in ensureSketch); a sidebar reads it lazily
let reviewView = null;       // TASK 459: the 3D Review (mounted on first entry, three imported dynamically)
let showStockThickness = () => {}; // TASK 460: re-syncs the Review card's thickness field after a document restore (assigned below)
let prepareView = null;      // SP1c–f: Prepare-local view (edges + loop/edge select + cut preview); re-mounted per Prepare enter
let vcarveView = null;       // VCARVE-3b: the live Vcarve workspace; mounted once, refreshed per Vcarve enter
// SP1f: the cut-settings card reflects the Prepare selection + writes the picked cut type back onto it.
const refreshCutPanel = () => {
  const t = prepareView && prepareView.selectedTarget && prepareView.selectedTarget();
  cutPanel.update(t ? { kind: t.kind, record: prepareView.recordFor(t) } : null);
};
// TASK 463: every cut-plan edit is ONE step of the SHARED sketch history (the ribbon's Undo/Redo, Ctrl+Z / Ctrl+Y): the shared
// state snapshots carry the cut plan through its generic `hostSnapshot` hook (ensureSketch below), so there is no second
// history stack. A pre-edit snapshot is taken, and dropped again if the edit changed nothing (e.g. re-picking the same preset).
function cutEdit(apply) {
  const st = designController && designController.state;
  const before = JSON.stringify(captureCutPlan());
  if (st) st.saveState();
  const n = st ? st.history.length : 0;
  apply();
  if (st && JSON.stringify(captureCutPlan()) === before) st.discardSnapshotAt(n);
  refreshCutPanel();
}
const cutPanel = createCutPanel(document.getElementById('prepare-panel'), {
  onPickType: (id) => cutEdit(() => { if (prepareView) prepareView.applyCutTypeToSelected(id); }),
  onSetField: (field, value) => cutEdit(() => { if (prepareView) prepareView.setFieldOnSelected(field, value); }),
  onSetFields: (o) => cutEdit(() => { if (prepareView) for (const [k, v] of Object.entries(o)) prepareView.setFieldOnSelected(k, v); }),
});

// The geometry signature the mounted Prepare view was built from: an undo that changed only the cut plan just repaints it
// (keeps selection + card); one that changed the sketch (e.g. undoing an SVG import) re-mounts it from the restored state.
let prepareSig = null;
const geomSig = (st) => JSON.stringify([[...st.joints.entries()].map(([k, j]) => [k, j.x, j.y]), st.shapes.map((x) => [x.id, x.type, x.joints, x.radius])]);
function restoreCutPlanFromHistory(entries) {
  applyCutPlan(entries);
  if (currentMode !== 'prepare' || !designController) return;
  if (prepareView && geomSig(designController.state) === prepareSig) { prepareView.refreshLook(); refreshCutPanel(); }
  else mountPrepare();
}

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

let infoPanel = null, ribbon = null, lastSig = '', drawer = null;

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
// COLLAPSIBLE right side panel holding ONLY the live constraint-list/DOF info panel (#design-panel-info) beside the
// untouched canvas. Reuses the shared #ui factories; dark via --sk-* (Shaper's :root). The canvas is not touched —
// collapsing the panel just reflows it wider.
const PANEL_COLLAPSED_KEY = 'shaper-design-panel-collapsed';
function buildDesignUI() {
  const { state, engine } = designController;
  infoPanel = createDesignInfoPanel({ state, engine, showSketchTree: true }); // SKETCH-1b: Shaper opts into the tree
  infoPanel.render(document.getElementById('design-panel-info'));
  ribbon = createToolRibbon({
    state,
    profiles: true,
    notify: groupStatus,
  });
  ribbon.render(document.getElementById('design-ribbon'));

  // Collapsible side panel: chevron toggles a thin strip ↔ full panel (canvas reflows); persisted.
  const panel = document.getElementById('design-panel');
  const toggle = document.getElementById('design-panel-toggle');
  const setCollapsed = (c) => {
    panel.classList.toggle('collapsed', c);
    toggle.textContent = c ? '◀' : '▶';
    toggle.title = c ? 'Expand panel' : 'Collapse panel';
    try { localStorage.setItem(PANEL_COLLAPSED_KEY, c ? '1' : '0'); } catch (_) { /* storage blocked */ }
  };
  let collapsed = false;
  try { collapsed = localStorage.getItem(PANEL_COLLAPSED_KEY) === '1'; } catch (_) {}
  setCollapsed(collapsed);
  toggle.addEventListener('click', () => setCollapsed(!panel.classList.contains('collapsed')));

  // MOBILE-DRAWER: below 768px, #design-panel becomes a slide-over drawer instead of the desktop
  // collapse-to-strip above; hideOnMobile keeps the two toggle affordances from fighting each other.
  drawer = createMobileDrawer({ panelEl: panel, label: 'Panel', hideOnMobile: [toggle], side: 'right' });
  const header = document.querySelector('header.toolbar');
  if (header) header.appendChild(drawer.toggleEl);
  drawer.toggleEl.style.display = 'none'; // shown only while Design is the active mode (showMode below)

  wireSvgImport(); // IMPORT-2: the Import-SVG button + a drop on the Design view
}

// Mount the shared sketcher ONCE. isActive is tied to the ACTIVE MODE (R-COEXIST), not just design-view
// visibility, so the input layer's document listeners no-op unless Design is the current mode.
function ensureSketch() {
  if (designController) return;
  designController = mountSketch(document.getElementById('design-canvas'), {
    isActive: () => currentMode === 'design',
    onRender: panelTick, // S5c/S6b/S7b: refresh the ribbon + info panel on change, in sync with the render loop
    seedDemo: false, // PERSIST-2: the autosave buffer below decides what geometry (if any) to show
    grid: true,      // GRID-1: the shared GRID_MODE-driven canvas grid (Grid / None / Draft points in the settings modal)
    profiles: true,
    notify: groupStatus,
  });
  window.__designController = designController; // for test/evidence inspection
  designController.state.hostSnapshot = { capture: captureCutPlan, restore: restoreCutPlanFromHistory }; // TASK 463: the cut plan rides in the shared undo snapshots
  buildDesignUI();

  // PERSIST-2: restore the shared cross-app document (if any) before the RAF loop's first solve, then
  // keep autosaving. statusEl is optional-safe (older cached HTML without #save-status just no-ops).
  const statusEl = document.getElementById('save-status');
  // TASK 474: the SAME restore runs after the initial restore and after Open / New / Open from file (onRestored), and a design
  // without a Shaper sidecar resets the cut plan and stock to their defaults instead of inheriting the previous design's.
  const applyRestored = ({ hosts }) => {
    try {
      designController.engine.solve(500);
      if (infoPanel) infoPanel.refresh();
      if (vcarveView) vcarveView.refresh();
    } catch (_) {}
    // TASK 460: restore the cut plan AFTER the sketch (loop/chain ids are derived from shape ids, so they are stable), then
    // re-mount Prepare if it is the visible mode so it shows the restored geometry + cuts. No sidecar (an old buffer): defaults.
    applyShaperDoc(hosts && hosts.shaper);
    if (currentMode === 'prepare') mountPrepare();
    else if (prepareView) { prepareView.destroy(); prepareView = null; } // re-mounted from the restored state on next entry
    showStockThickness();
    if (currentMode === 'review') enterReview(designController.state);
  };
  docBuffer = createDocumentBuffer({
    state: designController.state,
    app: 'shaper', onRestored: applyRestored,
    hostName: 'shaper', getHostData: captureShaperDoc, // TASK 460: cut plan + stock persist across reloads (and cross-app saves keep them: TASK 458)
    onStatusChange: (s) => { if (statusEl) statusEl.textContent = s === 'saving' ? 'Saving…' : s === 'saved' ? 'Saved' : ''; },
  });
  docBuffer.restore();
  docBuffer.start();
}

// SP1a/SP1c: (re)mount the Prepare view on the shared Design sketch (no 2nd engine/RAF). TASK 460: also called after a document
// restore so Prepare shows the restored geometry and cut plan.
function mountPrepare() {
    ensureSketch();
    try { designController.engine.solve(500); } catch (_) {}
    if (prepareView) prepareView.destroy();
    const st = designController.state;
    const loops = findLoops(st);
    const chains = findOpenChains(st, loops);
    const { dropped, moved, vcarveUpdated } = migrateEdgeRecords(loops, chains, CUT_PLAN, st.vcarves);
    if (dropped + moved + (vcarveUpdated || 0) > 0) {
      const parts = [];
      if (moved > 0) parts.push(`${moved} edge cut${moved === 1 ? '' : 's'} moved to chain`);
      if (dropped > 0) parts.push(`${dropped} dropped from closed loop${dropped === 1 ? '' : 's'}`);
      if (vcarveUpdated > 0) parts.push(`${vcarveUpdated} vcarve region${vcarveUpdated === 1 ? '' : 's'} updated`);
      groupStatus(`Cut plan updated: ${parts.join(', ')}`);
    }
    prepareView = mountPrepareView(st, document.getElementById('prepare-canvas'), { onSelectionChange: refreshCutPanel, onNotice: prepareNotice });
    prepareSig = geomSig(st);
    window.__prepareView = prepareView;
    refreshCutPanel(); // no selection yet → the card stays hidden
}

// The view router: show the active mode's container, hide the rest. Explore is in normal flow (display); the
// other three are absolute overlays (hidden attr). Drives the Design RAF lifecycle + persists the active mode.
function showMode(mode) {
  if (!VIEWS[mode]) mode = 'explore';
  const enteringMode = (mode !== currentMode);
  currentMode = mode;
  VIEWS.explore.style.display = (mode === 'explore') ? '' : 'none';
  VIEWS.design.hidden    = (mode !== 'design');   // make the canvas visible BEFORE start() so frame 1 sees a laid-out svg
  VIEWS.vcarve.hidden    = (mode !== 'vcarve');   // VCARVE-3a: static skeleton — no mount needed yet (live view = 3b)
  VIEWS.prepare.hidden   = (mode !== 'prepare');
  VIEWS.review.hidden    = (mode !== 'review');
  if (exploreActions) exploreActions.style.display = (mode === 'explore') ? '' : 'none';
  modeBtns.forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
  if (mode === 'design') { ensureSketch(); designController.start(); } // idempotent (guards against a second RAF)
  else if (designController) designController.stop();                   // pause the RAF off Design
  if (drawer) drawer.toggleEl.style.display = (mode === 'design') ? '' : 'none';
  // VCARVE-3b: the Vcarve workspace operates on the shared Design sketch — ensure it's mounted + solved, then mount the
  // live view once (re-populate its region list on each entry, since the sketch may have changed, e.g. after an import).
  if (mode === 'vcarve') {
    ensureSketch();
    try { designController.engine.solve(500); } catch (_) {}
    if (!vcarveView) vcarveView = mountVcarveView(designController.state);
    else vcarveView.refresh();
    window.__vcarveView = vcarveView;
  }
  // SP1a/SP1c: Prepare REUSES the shared Design sketch (no 2nd engine/RAF). Ensure it's mounted + solved, then mount
  // a Prepare-local view: edges (no joints) + topological-loop hover-highlight. Render-on-demand — geometry is
  // static in Prepare, so loops are found once on (re)mount; the highlight redraws only on hover-change (no RAF).
  if (mode === 'prepare' && (enteringMode || !prepareView)) mountPrepare();
  if (mode === 'review') {
    ensureSketch();
    try { designController.engine.solve(500); } catch (_) {}
    enterReview(designController.state);
  }
  try { localStorage.setItem(MODE_KEY, mode); } catch (_) { /* storage blocked */ }
}

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
      reviewView = await mountReviewView({ host: document.getElementById('review-canvas-host'), info, getInputs: () => reviewInputs(designController.state) });
    }
    showStockThickness();
    reviewView.refresh(reviewSig(st));
  } catch (e) { info.textContent = 'Review failed: ' + e.message; throw e; }
}
{
  const thick = document.getElementById('review-stock-thickness');
  const unit = () => SettingsManager.get('DOC_UNIT') || 'mm';
  const note = document.getElementById('review-stock-note');
  const showThick = () => {
    const loop = designController ? resolveStock(designController.state, CUT_PLAN).fromLoop : null; // TASK 472: with a Stock loop the thickness is set on that loop in Prepare
    thick.value = formatUnit(loop ? loop.thickness : getStock().thickness, unit(), { decimals: 3 });
    thick.disabled = !!loop;
    note.textContent = loop ? (loop.thicknessSet ? 'The board is your Stock loop; set its thickness in Prepare.' : 'The board is your Stock loop; no thickness set on it, so the default applies. Set it in Prepare.') : 'No Stock loop: the board is the design bounds + margin.';
  };
  showStockThickness = showThick;
  showThick();
  thick.addEventListener('change', () => {
    const v = parseUnit(thick.value, unit());
    if (v != null && v > 0) setStockField('thickness', v);
    showThick();
    if (reviewView) reviewView.refresh(reviewSig(designController.state));
  });
  document.getElementById('review-reset').addEventListener('click', () => reviewView && reviewView.reset());
  document.getElementById('review-top').addEventListener('click', () => reviewView && reviewView.top());
  document.getElementById('review-fit').addEventListener('click', () => reviewView && reviewView.fit());
}

// TASK 472: a transient one-line notice in Prepare (e.g. the Stock role moved to another loop)
let prepareNoticeTimer = null;
function prepareNotice(msg) {
  const el = document.getElementById('prepare-notice'); if (!el) return;
  el.textContent = msg; el.hidden = false;
  clearTimeout(prepareNoticeTimer); prepareNoticeTimer = setTimeout(() => { el.hidden = true; }, 4500);
}

modeBtns.forEach((b) => b.addEventListener('click', () => showMode(b.dataset.mode)));

// TASK 463: Prepare has no sketcher input layer and the shared Ctrl+Z handler is gated to Design (isActive: currentMode === 'design'),
// so Ctrl+Z / Ctrl+Y on Prepare would do nothing. This listener runs ONLY while Prepare is the mode (the two gates are mutually
// exclusive, so a key never fires twice), uses the SAME key mapping as the shared handler (input-manager undoRedoKeyAction), and
// drives the same state.undo()/redo().
document.addEventListener('keydown', (e) => {
  if (currentMode !== 'prepare' || !designController) return;
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return; // let a text field undo its own text
  const action = undoRedoKeyAction(e);
  if (!action) return;
  designController.state[action]();
  e.preventDefault();
});

// Restore the last active mode (default Explore).
let initMode = 'explore';
try { initMode = localStorage.getItem(MODE_KEY) || 'explore'; } catch (_) { /* storage blocked */ }
if (initMode === 'simexport') initMode = 'review'; // TASK 459: the tab was renamed Simulate/Export -> Review
showMode(initMode);
