// tests/polygon-tool.test.js — TASK 483: the regular POLYGON tool, on the REAL engine and the REAL tool handlers.
// N = 3, 6, 64: N lines, closed, equal sides within 1e-6; it stays regular when a corner is dragged; the DOF left is exactly 4
// (position, size, rotation: measured by perturb-and-solve, not assumed); the whole polygon is ONE undo step; the preview draws
// no NaN/undefined and an invalid one is not a preview; the click-click flow, a zero-radius second click, and the side clamp.
import assert from 'node:assert';
import { createSketch } from './harness/sketch.js';
import { createEngine } from '../packages/core/constraint-solver.js';
import { createSketchState } from '../packages/ui/sketch-state.js';
import { POLYGON_SIDES, TOOL_MODES, CONSTRAINT_TYPES } from '../packages/core/constants.js';
import { clampPolygonSides, makePolygon } from '../packages/core/shapes.js';
import { handlePolygonPointerDown, handlePolygonPointerMove, handlePolygonPointerUp, createPolygon, polygonSides } from '../packages/ui/input-handlers/polygon-tool.js';
import { updatePreview } from '../packages/ui/preview-manager.js';
import { draw } from '../packages/ui/svg-renderer.js';

const ev = (x, y) => ({ clientX: x, clientY: y });
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const edgesOf = (shapes) => shapes.filter((s) => s.type === 'line' && !s.isConstruction);
const radiiOf = (shapes) => shapes.filter((s) => s.type === 'line' && s.isConstruction);
const spread = (vals) => Math.max(...vals) - Math.min(...vals);

// A tool-ready state on the REAL engine + the real sketch state (undo groups included).
function realState(sides) {
  const engine = createEngine(null); engine.init();
  const state = createSketchState(engine, { x: 0, y: 0, w: 200, h: 200 });
  state.currentTool = TOOL_MODES.POLYGON; state.polygonSides = sides;
  return { engine, state };
}
// click-drag with the real handlers: centre at (0,0), corner at (cx, cy)
function drawPolygon(state, cx = 10, cy = 0) {
  handlePolygonPointerDown(ev(100, 100), null, state, null, { x: 0, y: 0 });
  handlePolygonPointerMove(ev(100 + 40, 100), null, state, { x: cx, y: cy });
  return handlePolygonPointerUp(ev(100 + 40, 100), null, state, null, { x: cx, y: cy });
}

// 1. the declaration and the clamp
{
  assert.deepStrictEqual(POLYGON_SIDES, { min: 3, max: 64, default: 6 });
  for (const [input, want] of [[2, 3], [3, 3], [6, 6], [64, 64], [65, 64], [100, 64], [0, 3], [-5, 3], [5.4, 5], [5.6, 6], ['8', 8], ['x', 6], [undefined, 6], [NaN, 6], [null, 3 /* Number(null) = 0 -> min */]]) {
    assert.strictEqual(clampPolygonSides(input), want, 'clampPolygonSides(' + String(input) + ')');
  }
  assert.strictEqual(polygonSides({ polygonSides: 200 }), 64); assert.strictEqual(polygonSides({}), 6);
}

// 2. N = 3, 6, 64 through the real handlers: N lines, closed ring of shared joints, equal sides and radii within 1e-6
for (const n of [3, 6, 64]) {
  const { engine, state } = realState(n);
  const t0 = Date.now();
  assert.strictEqual(drawPolygon(state, 10, 0), true, 'the tool handled the gesture');
  engine.solve(500);
  const sides = edgesOf(state.shapes), radii = radiiOf(state.shapes);
  assert.strictEqual(sides.length, n, `N=${n}: N plain line shapes`);
  assert.strictEqual(radii.length, n, 'and N construction radii');
  assert(state.shapes.every((s) => s.type === 'line'), 'plain lines only: no parametric shape kind');
  // a closed ring: every corner joint is used by exactly two sides, the sides chain end to start
  const uses = new Map();
  for (const s of sides) for (const j of s.joints) uses.set(j, (uses.get(j) || 0) + 1);
  assert.strictEqual(uses.size, n, 'N distinct corner joints shared between neighbouring sides'); assert([...uses.values()].every((c) => c === 2), 'each corner joins exactly two sides (closed)');
  for (let i = 0; i < n; i++) assert.strictEqual(sides[i].joints[1], sides[(i + 1) % n].joints[0], 'side ' + i + ' ends where side ' + (i + 1) % n + ' starts');
  const len = sides.map((s) => dist(state.joints.get(s.joints[0]), state.joints.get(s.joints[1])));
  assert(spread(len) < 1e-6, `N=${n}: sides equal within 1e-6 (spread ${spread(len)})`);
  const rad = radii.map((s) => dist(state.joints.get(s.joints[0]), state.joints.get(s.joints[1])));
  assert(spread(rad) < 1e-6, 'radii equal within 1e-6');
  assert(Math.abs(len[0] - 2 * rad[0] * Math.sin(Math.PI / n)) < 1e-6, 'and the side length is that of a REGULAR N-gon: 2R sin(pi/N)');
  assert(Math.abs(rad[0] - 10) < 1e-6, 'the corner is where the user put it (radius 10)');
  assert.strictEqual(state.constraints.length, 2 * (n - 1), 'exactly 2(N-1) equal constraints: no redundant one');
  assert(state.constraints.every((c) => c.type === CONSTRAINT_TYPES.EQUAL));
  assert(state.activeCount === undefined && state.active === null, 'the tool is finished');
  console.log(`N=${n}: ${sides.length} sides, spread ${spread(len).toExponential(1)}, ${state.constraints.length} constraints, ${Date.now() - t0} ms`);
}

// 3. the rotation comes from the corner: a corner at 90 degrees puts the first side's corner there
{
  const { engine, state } = realState(4);
  drawPolygon(state, 0, 7);
  engine.solve(500);
  const sides = edgesOf(state.shapes);
  const first = state.joints.get(sides[0].joints[0]);
  assert(Math.abs(first.x) < 1e-9 && Math.abs(first.y - 7) < 1e-9, 'the first corner is exactly the clicked point (sets radius and rotation)');
}

// 4. editing: dragging ONE corner keeps the polygon regular (the constraints hold it)
for (const n of [3, 5, 6, 12]) {
  const s = createSketch();
  const state = s.state; state.saveState = () => {}; state.endUndoGroup = () => {}; state.beginUndoGroup = () => {}; state.beginDrawStep = () => {}; state.closeDrawStep = () => 'none'; state.isUndoGroupOpen = () => false; state.captureUndoSnapshot = () => ({});
  const center = s.point(0, 0, false); state.active = { mode: 'polygon', start: center }; state.polygonSides = n;
  createPolygon(state, { x: 10, y: 0 });
  s.solve();
  const corners = [...new Set(edgesOf(state.shapes).flatMap((sh) => sh.joints))];
  const target = corners[1];
  for (const [dx, dy] of [[2, 1], [-3, 2], [0.5, -4]]) {
    s.drag(target, dx, dy);
    s.solve();
    const len = edgesOf(state.shapes).map((sh) => dist(state.joints.get(sh.joints[0]), state.joints.get(sh.joints[1])));
    const rad = radiiOf(state.shapes).map((sh) => dist(state.joints.get(sh.joints[0]), state.joints.get(sh.joints[1])));
    assert(spread(len) < 1e-4 && spread(rad) < 1e-4, `N=${n}: still regular after dragging a corner by (${dx},${dy}): sides ${spread(len)}, radii ${spread(rad)}`);
    assert(Math.abs(len[0] - 2 * rad[0] * Math.sin(Math.PI / n)) < 1e-4, 'and still a regular N-gon (not a rhombus / star)');
  }
}

// 5. the DOF left: exactly 4 (position 2 + size 1 + rotation 1), measured by perturb-and-solve
function measureDof(s, jointIds, samples) {
  const base = jointIds.flatMap((id) => { const j = s.state.joints.get(id); return [j.x, j.y]; });
  const eps = 0.05; let seed = 12345; const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
  const basis = [];
  for (let k = 0; k < samples; k++) {
    jointIds.forEach((id, i) => { const j = s.state.joints.get(id); j.x = base[2 * i] + eps * rnd(); j.y = base[2 * i + 1] + eps * rnd(); });
    s.solve(1000);
    let v = jointIds.flatMap((id) => { const j = s.state.joints.get(id); return [j.x, j.y]; }).map((x, i) => x - base[i]);
    for (const b of basis) { const d = v.reduce((a, x, i) => a + x * b[i], 0); v = v.map((x, i) => x - d * b[i]); }
    const norm = Math.hypot(...v);
    if (norm > 0.1 * eps) basis.push(v.map((x) => x / norm));
    jointIds.forEach((id, i) => { const j = s.state.joints.get(id); j.x = base[2 * i]; j.y = base[2 * i + 1]; });
  }
  return basis.length;
}
for (const n of [3, 4, 5, 6, 8]) {
  const s = createSketch();
  const state = s.state; state.saveState = () => {}; state.endUndoGroup = () => {}; state.beginUndoGroup = () => {}; state.beginDrawStep = () => {}; state.closeDrawStep = () => 'none'; state.isUndoGroupOpen = () => false; state.captureUndoSnapshot = () => ({});
  const center = s.point(0, 0, false); state.active = { mode: 'polygon', start: center }; state.polygonSides = n;
  createPolygon(state, { x: 10, y: 0 });
  s.solve();
  const ids = [...state.joints.entries()].filter(([, j]) => !j.fixed).map(([id]) => id);   // the engine's fixed origin joint is not a degree of freedom
  const dof = measureDof(s, ids, 2 * ids.length + 10);
  assert.strictEqual(dof, 4, `N=${n}: a fully defined regular polygon leaves ONLY position, size and rotation: DOF measured ${dof}`);
  console.log(`DOF N=${n}: ${dof} (unknowns ${2 * ids.length}, constraints ${state.constraints.length})`);
}

// 6. Undo removes the WHOLE polygon in ONE step, and Redo brings it back
{
  const { engine, state } = realState(6);
  const before = { joints: state.joints.size, shapes: state.shapes.length, constraints: state.constraints.length };
  drawPolygon(state, 10, 0);
  assert.strictEqual(state.shapes.length, 12); assert(state.constraints.length > 0);
  state.undo();
  assert.deepStrictEqual({ joints: state.joints.size, shapes: state.shapes.length, constraints: state.constraints.length }, before, 'ONE Undo removes every line, joint and constraint of the polygon');
  state.redo();
  assert.strictEqual(state.shapes.length, 12, 'and Redo restores it');
}

// 7. click-click flow, and a second click on the centre makes nothing (no leftover joint)
{
  const { engine, state } = realState(5);
  const joints0 = state.joints.size;   // the engine keeps an origin joint
  handlePolygonPointerDown(ev(100, 100), null, state, null, { x: 0, y: 0 });
  assert.strictEqual(handlePolygonPointerUp(ev(100, 100), null, state, null, { x: 0, y: 0 }), true);
  assert(state.active && state.active.waitingForSecondClick, 'a click waits for the corner');
  handlePolygonPointerDown(ev(100, 100), null, state, null, { x: 0, y: 0 });             // consumed: does not start a new polygon
  assert.strictEqual(handlePolygonPointerUp(ev(100, 100), null, state, null, { x: 0, y: 0 }), true);
  assert.strictEqual(state.shapes.length, 0, 'a corner on the centre is not a polygon');
  assert.strictEqual(state.joints.size, joints0, 'and the centre joint made by the first click is gone'); assert.strictEqual(state.active, null);
  handlePolygonPointerDown(ev(100, 100), null, state, null, { x: 0, y: 0 });
  handlePolygonPointerUp(ev(100, 100), null, state, null, { x: 0, y: 0 });
  handlePolygonPointerDown(ev(150, 100), null, state, null, { x: 6, y: 0 });
  handlePolygonPointerUp(ev(150, 100), null, state, null, { x: 6, y: 0 });
  assert.strictEqual(edgesOf(state.shapes).length, 5, 'click, click = a pentagon');
}

// 8. the preview: no NaN / undefined, and an invalid one is not a preview
{
  const mkSvg = () => ({ viewBox: { baseVal: { x: 0, y: 0, width: 800, height: 600 } }, getBoundingClientRect: () => ({ x: 0, y: 0, width: 800, height: 600 }), innerHTML: '' });
  const render = (joints, active) => { const svg = mkSvg(); draw(joints, [], svg, active, null, [], new Set(), new Set(), null, null, new Set(), null, null, null, null, false, null); return svg.innerHTML; };
  const bad = (m) => m.match(/[a-z0-9-]+="[^"]*(NaN|undefined)[^"]*"/gi) || [];
  for (const n of [3, 6, 64]) {
    const joints = new Map([['c', { x: 5, y: 5 }]]);
    const state = { joints, active: { mode: 'polygon', start: 'c' } };
    updatePreview(state, 'polygon', ['c'], { x: 25, y: 5 }, { sides: n });
    assert(state.active.preview && state.active.preview.type === 'polygon' && state.active.preview.sides === n, 'a valid polygon preview is kept');
    const m = render(joints, state.active);
    assert.deepStrictEqual(bad(m), [], `N=${n}: no NaN/undefined in the preview markup`);
    const pts = /<polygon points="([^"]+)"/.exec(m)[1].split(' ');
    assert.strictEqual(pts.length, n, `the preview draws ${n} corners`);
    joints.delete('c');
    assert.deepStrictEqual(bad(render(joints, state.active)), [], 'centre joint gone before the next frame: still no NaN');
  }
  for (const [props, pt] of [[{ sides: 2 }, { x: 1, y: 1 }], [{ sides: 65 }, { x: 1, y: 1 }], [{ sides: 5.5 }, { x: 1, y: 1 }], [{ sides: NaN }, { x: 1, y: 1 }], [{}, { x: 1, y: 1 }], [{ sides: 6 }, { x: NaN, y: 1 }], [{ sides: 6 }, null]]) {
    const state = { joints: new Map(), active: { mode: 'polygon' } };
    updatePreview(state, 'polygon', [], pt, props);
    assert(!state.active.preview && !state.preview, 'rejected: ' + JSON.stringify(props) + ' pt ' + JSON.stringify(pt));
  }
}

// 9. makePolygon itself: clamps N, ids are unique across polygons made in the same millisecond, the first corner is the given joint
{
  const joints = new Map([['c', { x: 0, y: 0 }], ['v', { x: 4, y: 0 }]]);
  let g = 0; const genJ = () => 'g' + (++g);
  const a = makePolygon(joints, 'c', 'v', 2, genJ), b = makePolygon(joints, 'c', 'v', 100, genJ);
  assert.strictEqual(edgesOf(a.shapes).length, 3, 'N is clamped up to 3'); assert.strictEqual(edgesOf(b.shapes).length, 64, 'and down to 64');
  assert.strictEqual(new Set([...a.shapes, ...b.shapes].map((s) => s.id)).size, a.shapes.length + b.shapes.length, 'shape ids are unique across polygons');
  assert(edgesOf(a.shapes)[0].joints[0] === 'v', 'the first corner is the joint the user placed');
  assert.deepStrictEqual(makePolygon(joints, 'nope', 'v', 6, genJ), { shapes: [], constraints: [] }, 'a missing joint builds nothing');
  const construction = makePolygon(joints, 'c', 'v', 4, genJ, true);
  assert(construction.shapes.every((s) => s.isConstruction), 'construction mode makes construction sides');
}
console.log('polygon-tool: ok');
