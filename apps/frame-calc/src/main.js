// apps/frame-calc — boot + wiring. Scaffold only (step 1); the calculator/sketch/export logic lands
// in later steps of this same feature. Mirrors apps/shaper/src/main.js's view-toggle shape, simplified
// to two views (Calculator / Sketch) instead of Shaper's 5-mode nav.

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
