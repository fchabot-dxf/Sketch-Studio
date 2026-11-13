// tests/dimension-pick-sequence.test.js -- TASK 555: the Dimension tool picks like Fusion's Sketch Dimension.
// Click an entity: its dimension is a PREVIEW that follows the cursor; click a SECOND entity: the preview changes kind (line + line = angle
// or distance, line + point = point-to-line, line + axis = line-to-axis distance or angle to the axis); a click on EMPTY space places the
// label of the current preview; Esc cancels. Every sequence below goes through the real tool handlers (handleDimensionPointerDown / Move,
// resetDimensionState = what Esc calls) and ConstraintManager; nothing is a hand-written constraint.
import assert from 'node:assert';
import * as L from './harness/audit/lib.js';
import { TOOL_MODES } from '#core/constants.js';
import { REFERENCE_SHAPES, pickableShapes } from '#core/reference-lines.js';
import { handleDimensionPointerDown, handleDimensionPointerMove, resetDimensionState, isDimensionPlacing } from '#ui/input-handlers/dimension-tool.js';

const svg = { viewBox: { baseVal: { x: 0, y: 0, width: 800, height: 800 } }, getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 800 }), setPointerCapture() {}, releasePointerCapture() {} };
const evt = (x, y) => ({ clientX: x, clientY: y, pointerType: 'mouse', pointerId: 1, target: { closest: () => null } });
const J = (S, id) => S.state.joints.get(id);
const quiet = (fn) => { const e = console.error, w = console.warn; console.error = () => {}; console.warn = () => {}; try { return fn(); } finally { console.error = e; console.warn = w; } };
// a click never swallows an error: a throw fails the test
const click = (S, x, y, hitJoint, hitShape) => quiet(() => handleDimensionPointerDown(evt(x, y), svg, S.state, hitJoint, hitShape, null));
const move = (S, x, y) => quiet(() => handleDimensionPointerMove(evt(x, y), svg, S.state, { x, y }));
const onJoint = (S, id) => ({ id, j: J(S, id) });
const onShape = (S, sid) => ({ shape: L.shape(S, sid) });
const onAxis = (n) => ({ shape: REFERENCE_SHAPES[n] });   // 0 = X axis, 1 = Y axis
const dims = (S) => S.state.constraints.filter((c) => c.type === 'distance' || c.type === 'angle');
const fresh = () => { const S = L.newSketch(); S.state.currentTool = TOOL_MODES.DIMENSION; resetDimensionState(S.state); return S; };
const EMPTY = [700, 700];

// ---- A. one line, then empty space: its LENGTH (preview follows the cursor, the click on empty space places it)
{ const S = fresh(); const a = L.point(S, 100, 100), b = L.point(S, 200, 100), ln = L.line(S, a, b);
  click(S, 150, 100, null, onShape(S, ln));
  assert.strictEqual(dims(S).length, 1, 'after ONE pick the length preview exists');
  assert(isDimensionPlacing(S.state), 'the preview is placing (follows the cursor)');
  assert(dims(S)[0].__asksSecondPick === true, 'a line preview asks for a second pick');
  move(S, 150, 60);
  assert(dims(S)[0].offset !== undefined && dims(S).length === 1, 'moving the cursor moves the preview only');
  click(S, ...EMPTY, null, null);
  assert(!isDimensionPlacing(S.state), 'a click on empty space places the label');
  assert.strictEqual(dims(S).length, 1, 'one dimension');
  assert(Math.abs(dims(S)[0].value - 100) < 1e-9 && dims(S)[0].joints.join() === [a, b].join(), 'its length, 100: ' + L.describe(dims(S)[0])); }

// ---- B. line + line: non-parallel = ANGLE, parallel = DISTANCE; either way a click on empty space places it
{ const S = fresh(); const a = L.point(S, 100, 100), b = L.point(S, 200, 100), c = L.point(S, 100, 100), d = L.point(S, 150, 180);
  const l1 = L.line(S, a, b), l2 = L.line(S, c, d);
  click(S, 150, 100, null, onShape(S, l1)); click(S, 125, 140, null, onShape(S, l2));
  assert.strictEqual(dims(S).length, 1, 'line + line: the length preview was REPLACED (one dimension)');
  assert.strictEqual(dims(S)[0].type, 'angle', 'line + line that cross: an angle');
  assert(isDimensionPlacing(S.state), 'the angle is still a preview');
  click(S, ...EMPTY, null, null);
  assert(!isDimensionPlacing(S.state) && dims(S).length === 1, 'placed by a click on empty space'); }
{ const S = fresh(); const a = L.point(S, 100, 100), b = L.point(S, 200, 100), c = L.point(S, 100, 160), d = L.point(S, 200, 160);
  const l1 = L.line(S, a, b), l2 = L.line(S, c, d);
  click(S, 150, 100, null, onShape(S, l1)); click(S, 150, 160, null, onShape(S, l2));
  assert(dims(S).length === 1 && dims(S)[0].type === 'distance' && dims(S)[0].shapes && Math.abs(dims(S)[0].value - 60) < 1e-9, 'parallel lines: a distance of 60: ' + dims(S).map(L.describe));
  click(S, ...EMPTY, null, null); assert(!isDimensionPlacing(S.state)); }

// ---- C. angle: the sector under the label at the drop decides 10 vs 170 (task 543 / 553)
for (const [label, want] of [['inside the 10 degree sector', 10], ['inside the 170 degree sector', 170]]) {
  const S = fresh(); const P = { x: 200, y: 200 };
  const r1 = 0, r2 = 10 * Math.PI / 180;
  const a = L.point(S, P.x + 40, P.y), b = L.point(S, P.x + 240, P.y), c = L.point(S, P.x + 40 * Math.cos(r2), P.y + 40 * Math.sin(r2)), d = L.point(S, P.x + 240 * Math.cos(r2), P.y + 240 * Math.sin(r2));
  const l1 = L.line(S, a, b), l2 = L.line(S, c, d);
  click(S, 300, 200, null, onShape(S, l1)); click(S, 300, 200 + 100 * Math.sin(r2), null, onShape(S, l2));
  // the label is moved to a point in the wanted sector and dropped there
  const dir = (label.includes('10 degree') ? 5 : 95) * Math.PI / 180, wx = P.x + 150 * Math.cos(dir), wy = P.y + 150 * Math.sin(dir);
  move(S, wx, wy); move(S, wx + 1, wy); click(S, wx + 1, wy, null, null);
  const k = dims(S)[0];
  assert(k && k.type === 'angle' && !isDimensionPlacing(S.state), 'placed');
  assert(Math.abs(k.value - want) < 0.5, `angle dropped ${label}: value ${k.value}, want ${want}`); }

// ---- D. line + point = point-to-line distance (a point clicked while the line's length previews)
{ const S = fresh(); const a = L.point(S, 100, 100), b = L.point(S, 200, 100), p = L.point(S, 140, 60), ln = L.line(S, a, b);
  click(S, 150, 100, null, onShape(S, ln));
  click(S, 140, 60, onJoint(S, p), null);
  assert.strictEqual(dims(S).length, 1, 'line + point: one dimension (the length preview is replaced)');
  assert.deepStrictEqual(dims(S)[0].joints, [p, a, b], 'stored as [point, line end A, line end B]');
  assert(Math.abs(dims(S)[0].value - 40) < 1e-9, 'the perpendicular distance 40: ' + L.describe(dims(S)[0]));
  click(S, ...EMPTY, null, null); assert(!isDimensionPlacing(S.state), 'placed by a click on empty space');
  S.state.undo(); assert.strictEqual(S.state.constraints.length, 0, 'ONE undo removes it (the discarded length preview left no step)'); }
{ // a click on the line's OWN end while its length previews is a label drop, not a pick
  const S = fresh(); const a = L.point(S, 100, 100), b = L.point(S, 200, 100), ln = L.line(S, a, b);
  click(S, 150, 100, null, onShape(S, ln)); click(S, 100, 100, onJoint(S, a), null);
  assert(!isDimensionPlacing(S.state) && dims(S).length === 1 && dims(S)[0].joints.join() === [a, b].join(), 'own end = drop of the length'); }

// ---- E. point first (existing sequences stay): point + line, point + point, point + axis; empty space cancels
{ const S = fresh(); const a = L.point(S, 100, 100), b = L.point(S, 200, 100), p = L.point(S, 140, 60), ln = L.line(S, a, b);
  click(S, 140, 60, onJoint(S, p), null); click(S, 150, 100, null, onShape(S, ln));
  assert(dims(S).length === 1 && dims(S)[0].joints.join() === [p, a, b].join(), 'point + line: ' + dims(S).map(L.describe)); }
{ const S = fresh(); const p = L.point(S, 140, 60), q = L.point(S, 240, 60);
  click(S, 140, 60, onJoint(S, p), null); click(S, 240, 60, onJoint(S, q), null);
  assert(dims(S).length === 1 && dims(S)[0].joints.join() === [p, q].join() && Math.abs(dims(S)[0].value - 100) < 1e-9, 'point + point: ' + dims(S).map(L.describe)); }
{ const S = fresh(); const p = L.point(S, 140, 60);
  click(S, 140, 60, onJoint(S, p), null); click(S, 140, 0, null, onAxis(0));
  assert(dims(S).length === 1 && dims(S)[0].joints.join() === [p, 'j_origin', 'j_ref_x'].join() && Math.abs(dims(S)[0].value - 60) < 1e-9, 'point + X axis: ' + dims(S).map(L.describe)); }
{ const S = fresh(); const p = L.point(S, 140, 60);
  click(S, 140, 60, onJoint(S, p), null); click(S, ...EMPTY, null, null);
  assert.strictEqual(dims(S).length, 0, 'a point alone + empty space: nothing is made (cancelled)');
  const q = L.point(S, 300, 300), ln = L.line(S, q, L.point(S, 400, 300));
  click(S, 300, 300, onJoint(S, q), null);   // the pending pick is not the old one
  assert.strictEqual(dims(S).length, 0); }

// ---- F. line + axis (new): parallel = distance to the axis, otherwise the angle to the axis
{ const S = fresh(); const a = L.point(S, 100, 80), b = L.point(S, 200, 80), ln = L.line(S, a, b);
  click(S, 150, 80, null, onShape(S, ln));
  assert(pickableShapes(S.state).some((s) => s.reference), 'while a line previews, the axes are pickable');
  click(S, 150, 0, null, onAxis(0));
  assert(dims(S).length === 1 && dims(S)[0].type === 'distance' && dims(S)[0].shapes.includes('ref_axis_x') && Math.abs(dims(S)[0].value - 80) < 1e-9, 'line + X axis (parallel): distance 80: ' + dims(S).map(L.describe));
  click(S, ...EMPTY, null, null); assert(!isDimensionPlacing(S.state));
  assert(!pickableShapes(S.state).some((s) => s.reference), 'placed: the axes are not pickable any more'); }
{ const S = fresh(); const a = L.point(S, 100, 80), b = L.point(S, 200, 140), ln = L.line(S, a, b);
  click(S, 150, 110, null, onShape(S, ln)); click(S, 150, 0, null, onAxis(0));
  assert(dims(S).length === 1 && dims(S)[0].type === 'angle' && dims(S)[0].shapes.includes('ref_axis_x'), 'line + X axis (crossing): an angle: ' + dims(S).map(L.describe));
  click(S, ...EMPTY, null, null); assert(!isDimensionPlacing(S.state)); }
{ const S = fresh(); const a = L.point(S, 60, 80), b = L.point(S, 60, 200), ln = L.line(S, a, b);   // parallel to the Y axis
  click(S, 60, 140, null, onShape(S, ln)); click(S, 0, 140, null, onAxis(1));
  assert(dims(S).length === 1 && dims(S)[0].type === 'distance' && dims(S)[0].shapes.includes('ref_axis_y') && Math.abs(dims(S)[0].value - 60) < 1e-9, 'line + Y axis: distance 60: ' + dims(S).map(L.describe)); }

// ---- G. circle / arc: radius preview, a click on empty space places it
{ const S = fresh(); const ci = L.circle(S, 300, 300, 50);
  click(S, 350, 300, null, onShape(S, ci.id));
  assert(dims(S).length === 1 && dims(S)[0].isRadius && isDimensionPlacing(S.state), 'circle: a radius preview');
  click(S, ...EMPTY, null, null); assert(!isDimensionPlacing(S.state) && dims(S).length === 1, 'placed by a click on empty space'); }

// ---- H. Esc cancels: a length preview, a first-picked point, a second-pick preview leave nothing behind
{ const S = fresh(); const a = L.point(S, 100, 100), b = L.point(S, 200, 100), ln = L.line(S, a, b);
  click(S, 150, 100, null, onShape(S, ln)); resetDimensionState(S.state);
  assert.strictEqual(S.state.constraints.length, 0, 'Esc after one pick: the preview is gone');
  S.state.currentTool = TOOL_MODES.DIMENSION;
  click(S, 150, 100, null, onShape(S, ln)); click(S, 150, 0, null, onAxis(0)); resetDimensionState(S.state);
  assert.strictEqual(S.state.constraints.length, 0, 'Esc after the second pick: nothing made');
  const p = L.point(S, 140, 60); S.state.currentTool = TOOL_MODES.DIMENSION;
  click(S, 140, 60, onJoint(S, p), null); resetDimensionState(S.state);
  click(S, 150, 100, null, onShape(S, ln));
  assert(dims(S).length === 1 && dims(S)[0].joints.join() === [a, b].join(), 'Esc forgot the first-picked point: the next click on a line starts the length of THAT line'); }

console.log('dimension-pick-sequence: ok');
