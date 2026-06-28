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

// ── Design tab: toggle the shared #ui sketcher (real renderer, P5a); the SVG editor is left untouched. ──
const editorView = document.querySelector('main.layout');
const designView = document.getElementById('design-view');
const tabDesign = document.getElementById('tab-design');
const designBack = document.getElementById('design-back');
let designController = null; // mounted once; controls the RAF render loop (started on show, paused on hide)
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

function showDesign() {
  // Make the canvas visible BEFORE mounting/starting so the first render frame sees a laid-out svg.
  designView.hidden = false;
  if (editorView) editorView.style.display = 'none';
  tabDesign.classList.add('active');
  if (!designController) {
    designController = mountSketch(document.getElementById('design-canvas'), {
      // P5b: gate the shared input layer's document-level listeners to the Design tab.
      isActive: () => !designView.hidden,
      // S5c: refresh the dock's info panel on change, in sync with the render loop.
      onRender: dockTick,
    });
    buildDock();
  }
  designController.start(); // idempotent (guards against a second RAF)
}
function showEditor() {
  if (designController) designController.stop(); // pause the RAF while the Design tab is hidden
  designView.hidden = true; // hides #design-view AND the dock (its child)
  if (editorView) editorView.style.display = '';
  tabDesign.classList.remove('active');
}
tabDesign.addEventListener('click', () => (designView.hidden ? showDesign() : showEditor()));
designBack.addEventListener('click', showEditor);
