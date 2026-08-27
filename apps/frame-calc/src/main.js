// apps/frame-calc — boot + wiring. Mirrors apps/shaper/src/main.js's view-toggle shape, simplified to
// two views (Calculator / Sketch) instead of Shaper's 5-mode nav.

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

function showView(view) {
  if (!VIEWS[view]) view = 'calc';
  VIEWS.calc.hidden = view !== 'calc';
  VIEWS.sketch.hidden = view !== 'sketch';
  viewBtns.forEach((b) => b.classList.toggle('active', b.dataset.view === view));
}
viewBtns.forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));
showView('calc');
