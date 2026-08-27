// apps/frame-calc — boot + wiring. Mirrors apps/shaper/src/main.js's view-toggle shape, simplified to
// two views (Calculator / Sketch) instead of Shaper's 5-mode nav.

import { mountSketch } from '#ui/sketch-canvas.js';
import { createDesignInfoPanel } from '#ui/design-info-panel.js';
import { createToolRibbon } from '#ui/tool-ribbon.js';
import { createCalculatorView } from './calculator-view.js';

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
