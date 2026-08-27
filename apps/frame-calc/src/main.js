// apps/frame-calc — boot + wiring. Mirrors apps/shaper/src/main.js's view-toggle shape, simplified to
// two views (Calculator / Sketch) instead of Shaper's 5-mode nav.

import { mountSketch } from '#ui/sketch-canvas.js';
import { createDesignInfoPanel } from '#ui/design-info-panel.js';
import { createToolRibbon } from '#ui/tool-ribbon.js';
import SettingsManager from '#core/settings-manager.js';
import { createCalculatorView } from './calculator-view.js';
import { buildFrameSketch } from './sketch-builder.js';

// This app is inches-only (the calculator has no mm mode) — default DOC_UNIT to 'in' so the Sketch
// view's dimension labels match the Calculator view's own display, same opt-in pattern Shaper uses
// (persist:false: an in-memory default only, never written to the shared 'sketch-studio-settings'
// localStorage, so it can't leak into a same-origin SketchStudio/Shaper session).
try {
  const persisted = JSON.parse(localStorage.getItem('sketch-studio-settings') || '{}');
  if (persisted.DOC_UNIT === undefined) SettingsManager.set('DOC_UNIT', 'in', { persist: false });
} catch (_) { /* localStorage blocked */ }

let latestGeom = null; // the calculator's most recent output; the Sketch-view builder (a later step) reads this on toggle
const calcView = createCalculatorView({
  formEl: document.getElementById('calc-form'),
  previewEl: document.getElementById('calc-preview'),
  onChange: (geom) => { latestGeom = geom; },
});

const VIEWS = {
  calc: document.getElementById('calc-view'),
  sketch: document.getElementById('sketch-view'),
};
const viewBtns = [...document.querySelectorAll('.view-toggle button')];
const exportBtn = document.getElementById('btn-export');

// The shared sketcher, mounted ONCE (mirrors apps/shaper/src/main.js's ensureSketch/designController
// pattern). isActive is tied to whether Sketch is the CURRENT view, not mere DOM visibility, so the
// input layer's document-level listeners no-op while the Calculator view is active.
let currentView = 'calc';
let sketchController = null; // { state, engine, start, stop } — mountSketch()'s return
let ribbon = null;
let infoPanel = null;

function ensureSketch() {
  if (sketchController) return;
  sketchController = mountSketch(document.getElementById('sketch-canvas'), {
    seedDemo: false, // this canvas exists to show ONE built frame, not a demo line
    isActive: () => currentView === 'sketch',
  });
  ribbon = createToolRibbon({ state: sketchController.state });
  ribbon.render(document.getElementById('sketch-ribbon'));
  infoPanel = createDesignInfoPanel({ state: sketchController.state, engine: sketchController.engine });
  infoPanel.render(document.getElementById('sketch-panel'));

  // Build the frame from the calculator's CURRENT geometry once, on first entry — the Sketch view is
  // then its own independent editable document from here on (re-entering it later, e.g. after tweaking
  // a slider and glancing back, does NOT silently discard dimension edits the user already made).
  buildFrameSketch(sketchController, calcView.geom());
  sketchController.engine.solve(500);
  if (infoPanel) infoPanel.refresh();
}

function showView(view) {
  if (!VIEWS[view]) view = 'calc';
  currentView = view;
  VIEWS.calc.hidden = view !== 'calc';
  VIEWS.sketch.hidden = view !== 'sketch';
  viewBtns.forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  if (view === 'sketch') {
    ensureSketch();
    sketchController.start(); // idempotent -- guards against a second RAF
  } else if (sketchController) {
    sketchController.stop(); // pause the RAF while Calculator is active
  }
  exportBtn.disabled = view !== 'sketch';
}
viewBtns.forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));
showView('calc');
