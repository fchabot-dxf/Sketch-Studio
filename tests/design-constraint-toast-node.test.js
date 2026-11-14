// tests/design-constraint-toast-node.test.js - TASK 629 (G3): mountSketch wires the constraint notifier to the shared toast, so every host
// that mounts the Design tab shows a conflict notice with the notice's own level. A vertical and a horizontal line made collinear is refused with
// an 'error' notice. Shaper and Pen Plotter through the node kit; Trace mounts the same mountSketch on its svg (its page is not a kit host).
import assert from 'node:assert';
import { Window } from 'happy-dom';
import { open } from './helpers/node-app.js';
import { ConstraintManager } from '#core/constraint-manager.js';
import { CONSTRAINT_TYPES } from '#core/constants.js';

const toasts = (doc) => [...doc.querySelectorAll('#notification-container > div')];

function conflict(doc, state, engine) {
  for (const t of toasts(doc)) t.remove();
  const mk = (x1, y1, x2, y2) => {
    const a = engine.genJ(), b = engine.genJ();
    engine.addJoint(a, x1, y1, false); engine.addJoint(b, x2, y2, false);
    const id = 'L_' + a + '_' + b;
    engine.addShape({ id, type: 'line', joints: [a, b] });
    return id;
  };
  const h = mk(10, 10, 40, 10), v = mk(60, 10, 60, 40);
  ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.COLLINEAR, { shapes: [h, v] });
  const t = toasts(doc);
  assert.strictEqual(t.length, 1, 'one toast');
  assert.strictEqual(t[0].getAttribute('data-level'), 'error', 'the notice\'s own level');
  assert(/perpendicular/.test(t[0].textContent), 'the notice text: ' + t[0].textContent);
}

for (const host of ['shaper', 'penplotter']) {
  const app = await open({ host });
  try { conflict(app.document, app.state, app.engine); } finally { await app.close(); }
  console.log('PASS toast shown in ' + host);
}

// Trace: mountSketch on a bare svg, as apps/trace/src/edit-view.js does
const win = new Window({ url: 'http://127.0.0.1/' });
for (const k of ['document', 'window', 'HTMLElement', 'Node', 'navigator', 'localStorage', 'requestAnimationFrame', 'KeyboardEvent', 'MouseEvent', 'Event']) {
  try { Object.defineProperty(globalThis, k, { value: win[k], configurable: true, writable: true }); } catch (_) { /* node's own */ }
}
globalThis.window = win; globalThis.document = win.document;
const { mountSketch } = await import('#ui/sketch-canvas.js');
const svg = win.document.createElementNS('http://www.w3.org/2000/svg', 'svg');
win.document.body.appendChild(svg);
const c = mountSketch(svg, { seedDemo: false });
conflict(win.document, c.state, c.engine);
console.log('PASS toast shown in trace mount');
process.exit(0);
