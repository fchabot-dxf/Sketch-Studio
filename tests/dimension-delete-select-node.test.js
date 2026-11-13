// tests/dimension-delete-select-node.test.js - TASK 576 (node port of tests/dimension-delete-live.test.js, TASK 485: owner: "deleting a dimension will
// delete geometry sometimes"), Shaper's Design tab through tests/helpers/node-app.js: deleting a DIMENSION removes only its constraint, never geometry.
// Per dimension kind: A. the label clicked, then the Delete key; D. Undo gives it back in ONE step; B. a line selected FIRST, then the label clicked:
// the line must not stay selected, so Delete removes only the dimension; E. a mixed selection (line + dimension, Shift) removes both (intended).
// The label click names the label element (kit hit-test override 5). The fourth route of the browser test, C. "a line selected first, then the
// constraint's ROW in the Design info panel clicked, then Delete", stays in tests/dimension-delete-live.test.js: the info panel is a page hook the
// kit does not mount. (tests/dimension-delete.test.js covers the delete path itself, with no UI.)
import assert from 'node:assert';
import { open } from './helpers/node-app.js';
import { labelEl, labelPoint } from './helpers/node-dom-read.js';

const app = await open({ host: 'shaper' });
let failed = null;
try {
  const st = app.state;
  const counts = () => ({ shapes: st.shapes.length, joints: st.joints.size, constraints: st.constraints.length, pos: [...st.joints.entries()].map(([k, j]) => k + ':' + Math.round(j.x * 100) / 100 + ',' + Math.round(j.y * 100) / 100).sort().join(' '), selShapes: st.selectedShapes.size, selJoints: st.selectedJoints.size, selCons: st.selectedConstraints.size });
  // seed: an L (two lines, 40 + 30), a circle with a radius dim, an arc with a radius dim, a distance dim, an angle dim, a DRIVEN distance dim
  const seed = () => {
    for (const k of [...st.joints.keys()]) if (k !== 'j_origin') st.joints.delete(k);
    st.shapes.length = 0; st.constraints.length = 0; st.selectedShapes.clear(); st.selectedJoints.clear(); st.selectedConstraints.clear();
    const J = (id, x, y) => st.joints.set(id, { x, y });
    J('a', -45, -20); J('b', -5, -20); J('c', -5, 10);
    st.shapes.push({ id: 'L1', type: 'line', joints: ['a', 'b'] }, { id: 'L2', type: 'line', joints: ['b', 'c'] });
    J('cc', 15, 25); J('cr', 23, 25);
    st.shapes.push({ id: 'C1', type: 'circle', joints: ['cc', 'cr'], radius: 8 });
    J('ac', -30, 30); J('as', -20, 30); J('ae', -30, 20);
    st.shapes.push({ id: 'A1', type: 'arc', subType: 'CENTER', joints: ['ac', 'as', 'ae'] });
    st.constraints.push({ type: 'distance', joints: ['a', 'b'], value: 40, glyphPos: { x: -25, y: -30 } });
    st.constraints.push({ type: 'angle', shapes: ['L1', 'L2'], value: 90, glyphPos: { x: -12, y: -10 } });
    st.constraints.push({ type: 'distance', shape: 'C1', value: 8, isRadius: true, glyphPos: { x: 15, y: 10 } });
    st.constraints.push({ type: 'distance', shape: 'A1', value: 10, isRadius: true, glyphPos: { x: -25, y: 25 } });
    st.constraints.push({ type: 'distance', joints: ['b', 'c'], value: 30, isDriven: true, glyphPos: { x: 8, y: -5 } });
    J('p1', -45, -40); J('p2', -20, -40); // two STANDALONE points (no shape) held only by their distance dimension
    st.constraints.push({ type: 'distance', joints: ['p1', 'p2'], value: 25, glyphPos: { x: -32, y: -43 } });
    app.frames(2);
    return st.constraints.length;
  };
  const labelClick = (idx, shift = false) => { const p = labelPoint(app, idx); assert(labelEl(app, idx), 'dim label ' + idx + ' is on screen'); app.click(p.x, p.y, { shift, target: () => labelEl(app, idx) }); };
  const KINDS = ['distance (two points)', 'angle (two lines)', 'radius (circle)', 'radius (arc)', 'driven / reference distance', 'distance (two standalone points)'];
  const GEO = { L2: [-5, -5] }; // a point ON line L2 (world mm)
  const clickWorld = (x, y, shift = false) => { const p = app.toScreen(x, y); app.click(p.x, p.y, { shift }); };
  seed(); app.frames(2);
  const base = counts();
  console.log('seeded', JSON.stringify({ shapes: base.shapes, joints: base.joints, constraints: base.constraints }));
  // after a delete the geometry (count AND positions) is exactly as seeded and the constraint count dropped by exactly one
  const onlyTheDimension = (c, msg) => {
    assert.strictEqual(c.shapes, base.shapes, msg + ': no shape removed'); assert.strictEqual(c.joints, base.joints, msg + ': no joint removed');
    assert.strictEqual(c.pos, base.pos, msg + ': no joint moved'); assert.strictEqual(c.constraints, base.constraints - 1, msg + ': exactly one constraint removed');
  };
  for (let i = 0; i < KINDS.length; i++) {
    const K = KINDS[i];
    // A: the dimension label alone: click + the Delete key
    seed();
    labelClick(i); assert.strictEqual(counts().selCons, 1, K + ': the label click selects the dimension');
    app.key('Delete');
    onlyTheDimension(counts(), K + ' / label + Delete');
    // D: Undo restores the dimension in ONE step (the geometry is untouched)
    app.undo();
    const undone = counts();
    assert.strictEqual(undone.constraints, base.constraints, K + ': one Ctrl+Z gives the dimension back'); assert.strictEqual(undone.shapes, base.shapes); assert.strictEqual(undone.pos, base.pos);
    // B: a line selected FIRST, then the dimension label clicked: the line must NOT stay selected, so Delete removes only the dimension
    seed();
    clickWorld(...GEO.L2); assert.strictEqual(counts().selShapes, 1, K + ': the line is selected');
    labelClick(i);
    const mid = counts(); assert.strictEqual(mid.selShapes, 0, K + ': clicking a dimension drops the earlier geometry selection'); assert.strictEqual(mid.selCons, 1);
    app.key('Delete');
    onlyTheDimension(counts(), K + ' / line then label + Delete');
    console.log('ok:', K);
  }
  // E: a MIXED selection (line + dimension, Shift-click) removes both: that part is intended
  seed();
  clickWorld(...GEO.L2); labelClick(0, true);
  const mixed = counts(); assert.strictEqual(mixed.selShapes, 1); assert.strictEqual(mixed.selCons, 1, 'Shift extends the selection');
  app.key('Delete');
  const after = counts();
  assert.strictEqual(after.shapes, base.shapes - 1, 'the selected line is removed with it'); assert.ok(after.constraints <= base.constraints - 1);
  console.log('dimension-delete-select-node: ok');
} catch (e) { failed = e; } finally { await app.close(); }
if (failed) { console.error(failed.stack || failed.message || failed); process.exitCode = 1; }
