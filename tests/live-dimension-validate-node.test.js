// tests/live-dimension-validate-node.test.js - TASK 589 item C (owner report 2026-11-13, report-drag-frozen.json: after a crash nothing could be
// dragged). The value box's Enter also runs the live input's commit (packages/ui/input-handlers/live-dimension-input.js processCommit), which in
// "create" mode tests the distance from the line being drawn (state.active.start) to the joint the pointer is locked on with a TEMPORARY
// constraint. The owner pressed Enter with the Dimension tool's own first pick in state.active (no `start`) and the pointer locked on a joint:
// the test constraint went in as [null, joint] (the owner's saved drawing holds exactly that), the measure threw, and the temporary constraint
// stayed in the drawing, where it stopped every solve. Here, SketchStudio through tests/helpers/node-app.js: that state, the real Enter.
//  1. no error, no temporary constraint left, no constraint with a missing joint; 2. a drag then moves geometry
//  3. the commit while drawing a LINE (state.active.start set) still runs its test and leaves nothing behind
import assert from 'node:assert';
import { open } from './helpers/node-app.js';

const app = await open({ host: 'sketchstudio' });
const errors = [];
app.window.addEventListener('error', (e) => errors.push(e.error ? String(e.error.stack || e.error) : String(e.message)));
let failed = null;
try {
  const st = app.state;
  const o = app.toScreen(0, 0); const P = (dx, dy) => ({ x: o.x + dx, y: o.y + dy });
  const A = P(150, 100), B = P(450, 100), C = P(450, 300);
  const leftovers = () => st.constraints.filter((c) => c.__temp || (c.joints || []).some((j) => j == null || !st.joints.has(j)));
  const boxOpen = () => !app.document.getElementById('dimInput').classList.contains('hidden');

  // a line typed by length (the live input's own create commit: state.active.start is the line's start), then a second segment
  app.tool('line'); app.move(A.x, A.y); app.click(A.x, A.y); app.move(A.x + 100, A.y); app.key('3'); app.enter();
  const segs = () => st.shapes.filter((s) => s.type === 'line');
  assert.strictEqual(segs().length, 1, 'a line drawn by its typed length');
  app.esc(); app.tool('line'); app.click(B.x, B.y); app.click(C.x, C.y); app.esc(); app.tool('select');
  assert.deepStrictEqual(leftovers(), [], '3: the line commit left no temporary constraint');
  console.log('3. a typed line commit: ok');

  // a dimension placed: its value box is open
  app.tool('dim');
  const m = P(300, 200); const L = st.shapes.find((s) => s.type === 'line' && s.joints.every((j) => Math.abs(app.toScreen(st.joints.get(j).x, 0).x - B.x) < 2));
  assert(L, 'the vertical line');
  app.click(m.x + 150, m.y); // on the vertical line (B -> C)
  const E = P(520, 200); app.move(E.x, E.y); app.click(E.x, E.y);
  await app.waitFor(boxOpen, 'the value box');
  // the owner's state at the Enter: the Dimension tool's first pick in state.active (no `start`) and the pointer locked on a joint
  const [jA, jB] = L.joints;
  st.active = { mode: 'dim', joints: [jA], startPt: { ...st.joints.get(jA) } };
  st.activeSnap = { type: 'joint', targetId: jB, id: jB, isLocked: true, pt: { ...st.joints.get(jB) } };
  const n = st.constraints.length;
  let thrown = null;
  try { app.document.getElementById('dimInput').focus(); app.type('250'); app.enter(); } catch (e) { thrown = e; }
  assert.strictEqual(thrown, null, '1: Enter does not throw: ' + (thrown && thrown.stack));
  assert.deepStrictEqual(errors, [], '1: no uncaught error');
  assert.deepStrictEqual(leftovers().map((c) => JSON.stringify(c.joints)), [], '1: no temporary constraint and no constraint with a missing joint left');
  assert.strictEqual(st.constraints.length, n, '1: the commit added no constraint of its own');
  console.log('1. Enter with the Dimension pick in state.active: ok');

  // 2. a drag moves geometry
  app.esc(); app.tool('select'); app.esc();
  const j = st.joints.get(jB); const before = { x: j.x, y: j.y }; const s = app.toScreen(j.x, j.y);
  app.drag(s, { x: s.x + 60, y: s.y + 40 }, 8);
  const after = st.joints.get(jB);
  assert(Math.hypot(after.x - before.x, after.y - before.y) > 1e-3, '2: the dragged point moved: ' + JSON.stringify([before, after]));
  console.log('2. a drag moves geometry: ok');
} catch (e) { failed = e; } finally { await app.close(); }
if (failed) { console.error(failed.stack || failed.message || failed); process.exitCode = 1; }
