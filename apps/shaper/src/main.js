// SVG Editor — boot + wiring.

import { store, setDoc } from './store.js';
import { parseSvg, serializeSvg, download } from './svgio.js';
import * as canvas from './canvas.js';
import * as tree from './tree.js';
import * as inspector from './inspector.js';
// Shared #core-backed sketcher (S1). Eager import so the page load exercises #ui/ + #core/ resolution;
// the mount itself runs only when the Design tab is first opened.
import { mountSketch } from '#ui/sketch-canvas.js';

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

// ── Design tab (S1): toggle the shared #core sketcher; the SVG editor is left completely untouched. ──
const editorView = document.querySelector('main.layout');
const designView = document.getElementById('design-view');
const tabDesign = document.getElementById('tab-design');
const designBack = document.getElementById('design-back');
let designMounted = false;
function showDesign() {
  if (!designMounted) {
    mountSketch(document.getElementById('design-canvas'));
    designMounted = true;
  }
  designView.hidden = false;
  if (editorView) editorView.style.display = 'none';
  tabDesign.classList.add('active');
}
function showEditor() {
  designView.hidden = true;
  if (editorView) editorView.style.display = '';
  tabDesign.classList.remove('active');
}
tabDesign.addEventListener('click', () => (designView.hidden ? showDesign() : showEditor()));
designBack.addEventListener('click', showEditor);
