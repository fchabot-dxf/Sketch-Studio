// tests/conflict-colour-ux20-node.test.js -- UX-20 (TASK 1010, BUG-133): geometry bound by a constraint the solver cannot satisfy
// (a triangle with sides 50 / 40 / 120) is drawn in the app's error red (--sk-error); a satisfied sketch keeps its status colours.
import assert from 'node:assert';
import { docOf, openDoc } from './fixtures/display-1010/doc-kit.js';

const D = (a, b, value, name) => ({ type: 'distance', joints: [a, b], value, name });
const stroke = (app, id) => app.svg.querySelector(`[data-shape-id="${id}"]`).getAttribute('style');

let app = await openDoc(docOf(
  { a: [0, 0, true], b: [50, 0], c: [50, 40] },
  [{ id: 'L1', type: 'line', joints: ['a', 'b'] }, { id: 'L2', type: 'line', joints: ['b', 'c'] }, { id: 'L3', type: 'line', joints: ['c', 'a'] }],
  [{ type: 'horizontal', joints: ['a', 'b'] }, D('a', 'b', 50, 'd1'), D('b', 'c', 40, 'd2'), D('c', 'a', 120, 'd3')],
));
try {
  app.frames(3);
  const cols = ['L1', 'L2', 'L3'].map((id) => stroke(app, id));
  console.log('contradictory triangle strokes:', JSON.stringify(cols));
  assert.ok(cols.every((s) => /var\(--sk-error, #ef4444\)/.test(s)), `every side of the contradictory triangle is drawn in the error red: ${JSON.stringify(cols)}`);
} finally { await app.close(); }

// a consistent triangle (3-4-5) is NOT red
app = await openDoc(docOf(
  { a: [0, 0, true], b: [30, 0], c: [30, 40] },
  [{ id: 'L1', type: 'line', joints: ['a', 'b'] }, { id: 'L2', type: 'line', joints: ['b', 'c'] }, { id: 'L3', type: 'line', joints: ['c', 'a'] }],
  [{ type: 'horizontal', joints: ['a', 'b'] }, D('a', 'b', 30, 'd1'), D('b', 'c', 40, 'd2'), D('c', 'a', 50, 'd3')],
));
try {
  app.frames(3);
  const cols = ['L1', 'L2', 'L3'].map((id) => stroke(app, id));
  console.log('consistent triangle strokes:', JSON.stringify(cols));
  assert.ok(cols.every((s) => !/sk-error/.test(s)), `a satisfied sketch has no error colour: ${JSON.stringify(cols)}`);
  console.log('PASS conflict-colour-ux20-node');
} finally { await app.close(); }
