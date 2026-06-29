// SVG Editor — boot + wiring.

import { store, setDoc } from './store.js';
import { parseSvg, serializeSvg, download } from './svgio.js';
import * as canvas from './canvas.js';
import * as tree from './tree.js';
import * as inspector from './inspector.js';
// Shared #core-backed sketcher (S1). Eager import so the page load exercises #ui/ + #core/ resolution;
// the mount itself runs only when the Design tab is first opened.
import { mountSketch } from '#ui/sketch-canvas.js';
import { createTabbedDockPanel } from '#ui/tabbed-dock-panel.js';
import { createDesignInfoPanel } from '#ui/design-info-panel.js';
import { createDesignToolPalette } from '#ui/design-tool-palette.js';

canvas.init(document.getElementById('canvas'));
tree.init(document.getElementById('tree'));
inspector.init(document.getElementById('inspector'));

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
const designView = VIEWS.design;
const modeBtns = [...document.querySelectorAll('.mode-btn')];
const exploreActions = document.getElementById('explore-actions');
const MODE_KEY = 'shaper-mode';
let currentMode = 'explore';

let designController = null; // sketcher mounted once; RAF started while Design is active, paused otherwise
let dock = null, infoPanel = null, palette = null, lastSig = '';

// Refresh the dock's tool palette + info panel when the sketch changes (active tool / constraint count / values /
// selection). Called each render frame via mountSketch's onRender hook; the signature check keeps it cheap.
function dockTick() {
  if (!designController) return;
  const s = designController.state;
  let vsum = 0; for (const c of s.constraints) if (typeof c.value === 'number') vsum += c.value;
  const sig = s.constraints.length + ':' + vsum.toFixed(1) + ':' + (s.selectedConstraints ? s.selectedConstraints.size : 0) + ':' + s.currentTool;
  if (sig !== lastSig) { lastSig = sig; if (palette) palette.refresh(); if (infoPanel) infoPanel.refresh(); }
}

// Build the floating dock ONCE: Design tab = the live constraint-list/DOF info panel (off Shaper's live
// state/engine); Prepare/Export/Settings = v1 stubs (per UI_SHELL.md). Re-parented INTO #design-view so it
// floats over the Design canvas + hides with the tab. Dark theming is automatic — the dock/info use
// --sk-*/--sk-dock-*, which Shaper's :root sets dark. The on-canvas glyphs/dim-edit are untouched (additive).
function buildDock() {
  const { state, engine } = designController;
  palette = createDesignToolPalette({ state });
  infoPanel = createDesignInfoPanel({ state, engine });
  dock = createTabbedDockPanel({
    persistKey: 'shaper-design-dock',
    // S6a keeps the floating dock for this slice; its tab strip still renders into the in-view .design-bar. (S6b
    // retires the floating dock for a fixed side panel; the header mode-nav is now the app's primary nav.)
    tabStripTarget: designView.querySelector('.design-bar'),
    tabs: [
      // Design tab: the tool palette ABOVE the live constraint-list/DOF info panel.
      { label: 'Design', icon: '✎', render: (body) => { palette.render(body); infoPanel.render(body); } },
      { label: 'Prepare', icon: '▦', render: (body) => { body.textContent = 'Prepare — cut type + toolpath (coming soon).'; } },
      { label: 'Export', icon: '⤓', render: (body) => { body.textContent = 'Export / Simulate (coming soon).'; } },
      { label: 'Settings', icon: '⚙', render: (body) => { body.textContent = 'Settings (coming soon).'; } },
    ],
  });
  designView.appendChild(dock.el);
}

// Mount the shared sketcher ONCE. isActive is tied to the ACTIVE MODE (R-COEXIST), not just design-view
// visibility, so the input layer's document listeners no-op unless Design is the current mode.
function ensureSketch() {
  if (designController) return;
  designController = mountSketch(document.getElementById('design-canvas'), {
    isActive: () => currentMode === 'design',
    onRender: dockTick, // S5c: refresh the dock's panels on change, in sync with the render loop
  });
  buildDock();
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
  try { localStorage.setItem(MODE_KEY, mode); } catch (_) { /* storage blocked */ }
}

modeBtns.forEach((b) => b.addEventListener('click', () => showMode(b.dataset.mode)));

// Restore the last active mode (default Explore).
let initMode = 'explore';
try { initMode = localStorage.getItem(MODE_KEY) || 'explore'; } catch (_) { /* storage blocked */ }
showMode(initMode);
