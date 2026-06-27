// Interactive canvas: renders the live SVG, pans/zooms, and click-selects
// elements. The SVG we render IS the document we edit (same DOM nodes), so
// attribute edits in the inspector show up here instantly.

import { store, subscribe, select } from './store.js';

let viewport, stage, selBox, placeholder;
let svgEl = null;
let curDoc = null;

let scale = 1, tx = 0, ty = 0;

export function init(container) {
  viewport = container;
  placeholder = container.querySelector('.empty');

  stage = document.createElement('div');
  stage.className = 'stage';

  selBox = document.createElement('div');
  selBox.className = 'sel-box';
  selBox.style.display = 'none';

  viewport.append(stage, selBox);

  viewport.addEventListener('wheel', onWheel, { passive: false });
  viewport.addEventListener('pointerdown', onPointerDown);
  viewport.addEventListener('pointermove', onPointerMove);
  viewport.addEventListener('pointerup', onPointerUp);

  subscribe(render);
}

function applyTransform() {
  stage.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
}

function render(s) {
  if (s.doc !== curDoc) {
    curDoc = s.doc;
    stage.innerHTML = '';
    svgEl = s.doc;
    if (svgEl) {
      stage.append(svgEl);
      placeholder.style.display = 'none';
      fit();
    } else {
      placeholder.style.display = '';
    }
  }
  updateHighlight();
}

// Fit the document into the viewport with a small margin.
function fit() {
  scale = 1; tx = 0; ty = 0; applyTransform();
  const vr = viewport.getBoundingClientRect();
  const sr = svgEl.getBoundingClientRect();
  if (!sr.width || !sr.height) { applyTransform(); return; }
  scale = Math.min(vr.width / sr.width, vr.height / sr.height) * 0.9;
  tx = (vr.width - sr.width * scale) / 2;
  ty = (vr.height - sr.height * scale) / 2;
  applyTransform();
  updateHighlight();
}

function onWheel(e) {
  if (!svgEl) return;
  e.preventDefault();
  const r = viewport.getBoundingClientRect();
  const mx = e.clientX - r.left;
  const my = e.clientY - r.top;
  const factor = Math.exp(-e.deltaY * 0.0015);
  const ns = Math.min(60, Math.max(0.02, scale * factor));
  // keep the point under the cursor fixed while zooming
  tx = mx - (mx - tx) * (ns / scale);
  ty = my - (my - ty) * (ns / scale);
  scale = ns;
  applyTransform();
  updateHighlight();
}

let dragging = false, moved = false, startX = 0, startY = 0, lastX = 0, lastY = 0, downEl = null;

function onPointerDown(e) {
  if (!svgEl) return;
  dragging = true;
  moved = false;
  startX = lastX = e.clientX;
  startY = lastY = e.clientY;
  downEl = svgEl.contains(e.target) && e.target !== svgEl ? e.target : null;
  viewport.setPointerCapture(e.pointerId);
}

function onPointerMove(e) {
  if (!dragging) return;
  const dx = e.clientX - lastX;
  const dy = e.clientY - lastY;
  lastX = e.clientX;
  lastY = e.clientY;
  if (Math.abs(e.clientX - startX) + Math.abs(e.clientY - startY) > 3) moved = true;
  tx += dx;
  ty += dy;
  applyTransform();
  updateHighlight();
}

function onPointerUp(e) {
  if (!dragging) return;
  dragging = false;
  try { viewport.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  if (!moved) {
    // a click, not a drag: select the shape under the cursor (or clear)
    if (downEl) select(downEl);
    else select(null);
  }
}

function updateHighlight() {
  const el = store.selected;
  if (!el || !svgEl || !svgEl.contains(el)) {
    selBox.style.display = 'none';
    return;
  }
  const vr = viewport.getBoundingClientRect();
  const br = el.getBoundingClientRect();
  if (!br.width && !br.height) {
    selBox.style.display = 'none';
    return;
  }
  selBox.style.display = '';
  selBox.style.left = `${br.left - vr.left}px`;
  selBox.style.top = `${br.top - vr.top}px`;
  selBox.style.width = `${br.width}px`;
  selBox.style.height = `${br.height}px`;
}

export function refit() {
  if (svgEl) fit();
}
