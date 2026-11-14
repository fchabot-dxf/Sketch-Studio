// tests/dimension-enter-once-node.test.js - TASK 593: ONE Enter in a value box commits exactly once. #dimInput had two keydown listeners that both
// committed (numeric-input-manager.js setupListeners and live-dimension-input.js handleInputKey -> processCommit, which also dispatched
// 'live-line-commit'). SketchStudio through tests/helpers/node-app.js, the real keys. Per mode: one Enter = one constraint added or one value
// changed, ONE undo step, no 'live-line-commit' / 'live-rect-commit' unless a line / rect is being drawn (then exactly one), no error.
import assert from 'node:assert';
import { open } from './helpers/node-app.js';
import { findLabel, labelEl } from './helpers/node-dom-read.js';

const app = await open({ host: 'sketchstudio' });
const errors = [];
app.window.addEventListener('error', (e) => errors.push(e.error ? String(e.error.stack || e.error) : String(e.message)));
const events = [];
for (const t of ['live-line-commit', 'live-rect-commit', 'liveDimensionApplied']) app.window.addEventListener(t, () => events.push(t));
let failed = null;
try {
  const st = app.state;
  const o = app.toScreen(0, 0); const P = (dx, dy) => ({ x: o.x + dx, y: o.y + dy });
  const isRef = (c) => (c.shapes || []).some((id) => String(id).startsWith('ref_')) || (c.joints || []).some((j) => j === 'j_origin' || String(j).startsWith('j_ref'));
  const dims = () => st.constraints.filter((c) => c.type === 'distance' && !isRef(c));
  const lines = () => st.shapes.filter((s) => s.type === 'line' && !String(s.id).startsWith('ref_'));
  const box = () => app.document.getElementById('dimInput');
  const boxOpen = () => !box().classList.contains('hidden');
  const A = [P(150, 100), P(450, 100)];
  const count = (t) => events.filter((x) => x === t).length;

  // 1. placing a NEW dimension: type a value, one Enter
  app.tool('line'); app.click(A[0].x, A[0].y); app.click(A[1].x, A[1].y); app.esc(); app.tool('select');
  app.click((A[0].x + A[1].x) / 2, A[0].y); app.key('d');
  const E = P(300, 330); app.move(E.x, E.y); app.click(E.x, E.y);
  await app.waitFor(boxOpen, 'the value box');
  events.length = 0;
  const h0 = st.history.length, n0 = st.constraints.length;
  app.type('200'); app.enter();
  assert.strictEqual(dims().length, 1, '1: one dimension');
  assert.strictEqual(st.constraints.length, n0, '1: the Enter added no constraint of its own (the dimension was placed before)');
  assert(Math.abs(dims()[0].value - 200) < 1e-6, '1: value 200: ' + dims()[0].value);
  assert.strictEqual(count('live-line-commit') + count('live-rect-commit'), 0, '1: no live-line / live-rect commit: ' + events);
  assert.strictEqual(st.history.length, h0, '1: the first value rides the placing snapshot (history ' + h0 + ' -> ' + st.history.length + ')');
  assert.deepStrictEqual(errors, [], '1: no error');
  app.undo();
  assert.strictEqual(dims().length, 0, '1: ONE Ctrl+Z removes the dimension');
  console.log('1. new dimension: ok');

  // 2. editing an existing dimension: double click its label, new value, one Enter = one undo step
  app.redo();
  assert.strictEqual(dims().length, 1, '2: redone');
  app.tool('select'); app.esc();
  const lab = findLabel(app, (t) => /200/.test(t)); assert(lab, '2: the dimension label is on the canvas');
  await app.pause(550); // two clicks on one label within 500 ms are a double click
  app.dblclick(lab.x, lab.y, { target: () => labelEl(app, lab.idx) });
  await app.waitFor(boxOpen, 'the edit box');
  events.length = 0;
  const h1 = st.history.length;
  app.type('150'); app.enter();
  assert(Math.abs(dims()[0].value - 150) < 1e-6, '2: value 150: ' + dims()[0].value);
  assert.strictEqual(st.history.length, h1 + 1, '2: ONE undo step (history ' + h1 + ' -> ' + st.history.length + ')');
  assert.strictEqual(count('live-line-commit') + count('live-rect-commit'), 0, '2: no live-line / live-rect commit: ' + events);
  assert.deepStrictEqual(errors, [], '2: no error');
  app.undo();
  assert(Math.abs(dims()[0].value - 200) < 1e-6, '2: one Ctrl+Z restores 200: ' + dims()[0].value);
  console.log('2. edit existing dimension: ok');

  // 3. typing a length while drawing a line: exactly one live-line-commit, one line, one undo step
  app.esc(); app.tool('select'); app.esc();
  app.tool('line'); const S = P(150, 450); app.move(S.x, S.y); app.click(S.x, S.y); app.move(S.x + 100, S.y);
  events.length = 0;
  const nl = lines().length, h2 = st.history.length;
  app.key('3'); app.enter();
  assert.strictEqual(count('live-line-commit'), 1, '3: exactly one live-line-commit: ' + events);
  assert.strictEqual(lines().length, nl + 1, '3: one line');
  assert.deepStrictEqual(errors, [], '3: no error');
  console.log('3. line typed length: ok (history ' + h2 + ' -> ' + st.history.length + ')');

  // 4. typing a width while drawing a rectangle: exactly one live-rect-commit, no live-line-commit
  app.esc(); app.tool('select'); app.esc();
  app.tool('rect'); const R = P(500, 450); app.move(R.x, R.y); app.click(R.x, R.y); app.move(R.x + 100, R.y + 80);
  events.length = 0;
  app.key('4'); app.enter();
  assert.strictEqual(count('live-rect-commit'), 1, '4: exactly one live-rect-commit: ' + events);
  assert.strictEqual(count('live-line-commit'), 0, '4: no live-line-commit: ' + events);
  assert.deepStrictEqual(errors, [], '4: no error');
  console.log('4. rect typed width: ok');
} catch (e) { failed = e; } finally { await app.close(); }
if (failed) { console.error(failed.stack || failed.message || failed); process.exitCode = 1; }
