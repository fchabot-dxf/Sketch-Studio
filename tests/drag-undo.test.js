// tests/drag-undo.test.js -- TASK 545: every drag that changes geometry is ONE undo step (taken at its first move, labelled by the drag
// kind from DRAG_UNDO_LABELS / DRAG_SHAPE_UNDO_LABELS); Undo restores EXACTLY the pre-drag geometry, Redo re-applies it; a snap constraint
// added on release is part of the SAME step; a click or a drag that ends where it started leaves no step; a dimension label drag then a
// joint drag are two steps with the right labels (the journal shows them); the history cap still holds.
// Through the app's real pointer path (handleSelectionPointerDown / Move / Up).
import assert from 'node:assert';
import * as L from './harness/audit/lib.js';
import { ConstraintManager } from '#core/constraint-manager.js';
import { buildJournal } from '#core/journal.js';
import { DRAG_UNDO_LABELS, DRAG_SHAPE_UNDO_LABELS, DRAG_TYPES } from '#core/constants.js';
import { handleSelectionPointerDown, handleSelectionPointerMove, handleSelectionPointerUp } from '#ui/input-handlers/selection-tools.js';

const SVG = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 1000 }), viewBox: { baseVal: { x: 0, y: 0, width: 1000, height: 1000 } }, setPointerCapture: () => {}, releasePointerCapture: () => {} };
const muted = (f) => { const l = console.log, e = console.error, w = console.warn; console.log = () => {}; console.error = () => {}; console.warn = () => {}; try { return f(); } finally { console.log = l; console.error = e; console.warn = w; } };
const ev = (p) => ({ clientX: p.x, clientY: p.y, pointerId: 1, target: { closest: () => null, dataset: {} } });
const geo = (st) => JSON.stringify({ joints: [...st.joints].map(([id, j]) => [id, j.x, j.y]), shapes: st.shapes.map((s) => ({ id: s.id, r: s.radius, j: s.joints })), nc: st.constraints.length });
const labels = (st) => st.history.map((s) => s.label);

// hit: { joint: id } | { shape: id, pt }; steps: number of pointer moves
function drag(S, hit, from, to, { steps = 10, activeSnap = null, press = true } = {}) {
  const st = S.state;
  st.currentTool = 'select'; st.selectedJoints = new Set(); st.selectedShapes = new Set(); st.selectedConstraints = new Set();
  muted(() => {
    const hj = hit.joint ? { id: hit.joint, j: st.joints.get(hit.joint) } : null;
    const hs = hit.shape ? { shape: L.shape(S, hit.shape), pt: { ...from } } : null;
    assert.ok(handleSelectionPointerDown(ev(from), SVG, st, hj, hs, null), 'the drag starts');
    for (let i = 1; i <= steps; i++) { handleSelectionPointerMove(ev({ x: from.x + (to.x - from.x) * i / steps, y: from.y + (to.y - from.y) * i / steps }), SVG, st); S.engine.solve(500); }
    if (activeSnap) st.activeSnap = activeSnap;
    handleSelectionPointerUp(ev(to), SVG, st); S.engine.solve(500);
  });
}
function oneStep(name, S, run, label) {
  const st = S.state, h0 = st.history.length, g0 = geo(st);
  run();
  const g1 = geo(st);
  assert.notStrictEqual(g1, g0, name + ': the drag changed the geometry');
  assert.strictEqual(st.history.length, h0 + 1, `${name}: ONE undo step (history ${h0} -> ${st.history.length}: ${JSON.stringify(labels(st))})`);
  assert.strictEqual(labels(st)[h0], label, `${name}: the step is labelled "${label}"`);
  st.undo();
  assert.strictEqual(geo(st), g0, name + ': Ctrl+Z restores exactly the pre-drag geometry');
  assert.strictEqual(st.history.length, h0, name + ': history back');
  st.redo();
  assert.strictEqual(geo(st), g1, name + ': Ctrl+Y re-applies the drag');
  console.log(`${name}: 1 step "${label}", undo -> pre-drag geometry, redo -> dragged`);
}

assert.deepStrictEqual(DRAG_UNDO_LABELS, { [DRAG_TYPES.JOINT]: 'drag point', [DRAG_TYPES.CLUSTER]: 'drag points', [DRAG_TYPES.LINE]: 'drag shape' }, 'the labels are declared data');
assert.deepStrictEqual(DRAG_SHAPE_UNDO_LABELS, { line: 'drag line', circle: 'drag circle', arc: 'drag arc' });

// ---- joint, line body, circle rim, cluster
{
  const S = L.newSketch();
  const a = L.point(S, 100, 100), b = L.point(S, 200, 100), l1 = L.line(S, a, b);
  const c = L.point(S, 100, 300), d = L.point(S, 200, 300), l2 = L.line(S, c, d);
  const C = L.circle(S, 500, 500, 40);
  oneStep('joint drag', S, () => drag(S, { joint: b }, { x: 200, y: 100 }, { x: 260, y: 160 }), 'drag point');
  oneStep('line body drag', S, () => drag(S, { shape: l2, }, { x: 150, y: 300 }, { x: 180, y: 360 }), 'drag line');
  oneStep('circle rim drag', S, () => drag(S, { shape: C.id }, { x: 540, y: 500 }, { x: 580, y: 500 }), 'drag circle');
}
{
  const S = L.newSketch();
  const segs = L.polyline(S, [[100, 100], [200, 100], [200, 200]], false); // corner joints joined by a coincident constraint: a cluster
  oneStep('cluster drag', S, () => drag(S, { joint: segs[0].b }, { x: 200, y: 100 }, { x: 240, y: 70 }), 'drag points');
}

// ---- a click (press, no move) and a drag that returns to its start leave no step
{
  const S = L.newSketch();
  const a = L.point(S, 100, 100), b = L.point(S, 200, 100); L.line(S, a, b);
  const h0 = S.state.history.length;
  drag(S, { joint: b }, { x: 200, y: 100 }, { x: 200, y: 100 }, { steps: 0 });
  assert.strictEqual(S.state.history.length, h0, 'a click without movement adds no step');
  muted(() => {
    handleSelectionPointerDown(ev({ x: 200, y: 100 }), SVG, S.state, { id: b, j: S.state.joints.get(b) }, null, null);
    handleSelectionPointerMove(ev({ x: 260, y: 160 }), SVG, S.state); S.engine.solve(500);
    handleSelectionPointerMove(ev({ x: 200, y: 100 }), SVG, S.state); S.engine.solve(500);
    handleSelectionPointerUp(ev({ x: 200, y: 100 }), SVG, S.state);
  });
  assert.strictEqual(S.state.history.length, h0, 'a drag that ends where it started adds no step (' + JSON.stringify(labels(S.state)) + ')');
  console.log('click / drag-and-return: no step');
}

// ---- a drag ending in a snap constraint: drag point onto another point, ONE step undoes the move AND the constraint
{
  const S = L.newSketch();
  const a = L.point(S, 100, 100), b = L.point(S, 200, 100), l1 = L.line(S, a, b);
  const c = L.point(S, 300, 300), d = L.point(S, 400, 300), l2 = L.line(S, c, d);
  const st = S.state, h0 = st.history.length, g0 = geo(st);
  drag(S, { joint: b }, { x: 200, y: 100 }, { x: 300, y: 300 }, { activeSnap: { type: 'joint', targetId: c, id: c, isLocked: true, pt: { x: 300, y: 300 } } });
  assert.ok(st.constraints.some((k) => k.type === 'coincident'), 'the snap added a coincident constraint');
  assert.strictEqual(st.history.length, h0 + 1, 'drag + snap constraint = ONE step: ' + JSON.stringify(labels(st)));
  assert.strictEqual(labels(st)[h0], 'drag point');
  const g1 = geo(st);
  st.undo();
  assert.strictEqual(geo(st), g0, 'ONE Ctrl+Z undoes the drag and its snap constraint together');
  st.redo();
  assert.strictEqual(geo(st), g1, 'Ctrl+Y re-applies both');
  console.log('snap drag: one step, constraint + move undone together');
}

// ---- a label drag then a joint drag: two steps, each labelled by what it did; the journal agrees
{
  const S = L.newSketch();
  const a = L.point(S, 100, 100), b = L.point(S, 300, 100); L.line(S, a, b);
  const st = S.state;
  muted(() => ConstraintManager.createConstraint(st, 'distance', { joints: [a, b], value: 200, dimMode: 'horizontal' }, { source: 'audit' }));
  st.currentTool = 'select';
  const c = st.constraints.find((k) => k.type === 'distance');
  const h0 = st.history.length;
  const label = { target: { closest: (q) => (q === '.dim-label' ? { dataset: { constraintIdx: String(st.constraints.indexOf(c)) } } : null), dataset: {} } };
  muted(() => {
    handleSelectionPointerDown({ ...ev({ x: 200, y: 60 }), ...label }, SVG, st, null, null, null);
    handleSelectionPointerMove(ev({ x: 260, y: 20 }), SVG, st);
    handleSelectionPointerUp(ev({ x: 260, y: 20 }), SVG, st);
  });
  assert.ok(c.offset !== 30 && Number.isFinite(c.labelSlide), 'the label moved onto the dragged offset and slide');
  drag(S, { joint: b }, { x: 300, y: 100 }, { x: 300, y: 180 });
  assert.deepStrictEqual(labels(st).slice(h0), ['move dimension label', 'drag point'], 'label drag then joint drag: two steps');
  const journal = buildJournal(st.history, st, { redoStack: st.redoStack });
  assert.deepStrictEqual(journal.steps.slice(-2).map((s) => s.label), ['move dimension label', 'drag point'], 'the journal labels match');
  const [s1, s2] = journal.steps.slice(-2);
  assert.ok(!('joints' in s1.patch), 'the label step moves no joint');
  assert.ok(s2.patch.joints, 'the drag step carries the joint move');
  console.log('label then joint drag: 2 steps', JSON.stringify(labels(st).slice(h0)));
}

// ---- the history cap still holds
{
  const S = L.newSketch();
  const a = L.point(S, 100, 100), b = L.point(S, 200, 100); L.line(S, a, b);
  const st = S.state; st.maxHistory = 5;
  for (let i = 0; i < 9; i++) drag(S, { joint: b }, { x: st.joints.get(b).x, y: 100 }, { x: st.joints.get(b).x + 20, y: 140 });
  assert.strictEqual(st.history.length, 5, 'history is capped at maxHistory');
  assert.ok(labels(st).every((l) => l === 'drag point'));
  console.log('cap: ok');
}
console.log('drag-undo.test.js: ok');
