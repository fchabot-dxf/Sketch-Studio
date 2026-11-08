// tests/radius-dim-angle.test.js — TASK 448: a radius dimension's label/leader can sit at ANY angle around the centre.
//  - the angle is stored on drag (placeRadiusLabel, the one writer) and survives undo + serialize/deserialize
//  - the leader end-point lies on the circle at that angle
//  - on an ARC: outside the sweep -> a dashed extension path; inside -> none; a CIRCLE -> never
//  - a dimension WITHOUT the field renders exactly as before (angle 0, today's markup)
import assert from 'node:assert';
import { createEngine } from '#core/constraint-solver.js';
import { createSketchState } from '#ui/sketch-state.js';
import { addConstraintObject } from '#core/constraints.js';
import { serializeDocument, deserializeDocument } from '#core/document.js';
import { placeRadiusLabel } from '#ui/input-handlers/dimension-tool.js';
import { arcSweepInfo, angleInArcSweep } from '#core/geometry.js';
import { draw } from '#ui/svg-renderer.js';

const svgStub = () => ({ viewBox: { baseVal: { x: -50, y: -50, width: 100, height: 100 } }, getBoundingClientRect: () => ({ width: 800, height: 800 }), innerHTML: '' });
const render = (joints, shapes, constraints) => {
  const svg = svgStub();
  draw(joints, shapes, svg, null, null, constraints, new Set(), new Set(), 'select', null, new Set(), null, null, null, null, false, null);
  return svg.innerHTML;
};
const leaderOf = (html) => { // the solid leader <line> from the rim to the label: the first <line ... stroke-opacity="1"/> with x1 = rim
  const m = [...html.matchAll(/<line x1="([-\d.e]+)" y1="([-\d.e]+)" x2="([-\d.e]+)" y2="([-\d.e]+)" style="stroke:var\(--sk-constraint-stroke[^"]*" stroke-width="[^"]*" stroke-opacity="1"\/>/g)];
  assert.ok(m.length >= 1, 'a leader line was drawn');
  return { x: +m[0][1], y: +m[0][2], lx: +m[0][3], ly: +m[0][4] };
};
const hasExtension = (html) => html.includes('class="dim-arc-extension"');

// scene: arc centre (0,0) radius 10 from angle 0 to 90 deg (start (10,0) -> end (0,10)); circle centre (30,0) radius 5
const joints = new Map([['c', { x: 0, y: 0 }], ['s', { x: 10, y: 0 }], ['e', { x: 0, y: 10 }], ['cc', { x: 30, y: 0 }], ['cp', { x: 35, y: 0 }]]);
const arc = { id: 'arc1', type: 'arc', subType: 'CENTER', joints: ['c', 's', 'e'] };
const circle = { id: 'circ1', type: 'circle', joints: ['cc', 'cp'], radius: 5 };
const shapes = [arc, circle];
const dim = (shape, extra = {}) => ({ id: 'k_' + shape, type: 'distance', isRadius: true, shape, value: 10, offset: 25, ...extra });

// arc sweep helper: 0..90 deg sweeps; -45 and 135 are outside
const info = arcSweepInfo(joints.get('c'), joints.get('s'), joints.get('e'), {});
assert.ok(angleInArcSweep(info, Math.PI / 4), '45 deg inside'); assert.ok(!angleInArcSweep(info, -Math.PI / 4), '-45 deg outside'); assert.ok(!angleInArcSweep(info, 3 * Math.PI / 4), '135 deg outside');

// (1) the angle is stored on drag via the ONE writer, and the label lands where it is dropped
{
  const c = dim('arc1');
  placeRadiusLabel(c, joints.get('c'), { x: 0, y: -20 }); // drop straight "up" in y-down coordinates (-90 deg)
  assert.ok(Math.abs(c.labelAngle - (-Math.PI / 2)) < 1e-9, 'labelAngle stored');
  assert.ok(Math.abs(c.offset - 20) < 1e-9, 'offset = distance from the centre (label sits where dropped)');
}
// (2) leader end-point is ON the circle at that angle; label at offset along it
for (const deg of [30, -45, 135, 200]) {
  const a = deg * Math.PI / 180;
  const html = render(joints, shapes, [dim('arc1', { labelAngle: a })]);
  const L = leaderOf(html);
  assert.ok(Math.abs(Math.hypot(L.x, L.y) - 10) < 1e-6, `rim point on the circle (r=10) at ${deg} deg`);
  assert.ok(Math.abs(Math.atan2(L.y, L.x) - Math.atan2(Math.sin(a), Math.cos(a))) < 1e-6, `rim point direction = ${deg} deg`);
  assert.ok(Math.abs(Math.hypot(L.lx, L.ly) - 25) < 1e-6, 'label at offset 25 along the leader');
  // (3) extension only outside the sweep (0..90 deg)
  const inside = deg > 0 && deg < 90;
  assert.strictEqual(hasExtension(html), !inside, `extension ${inside ? 'absent inside' : 'present outside'} the sweep (${deg} deg)`);
}
// the extension runs from the NEAREST arc end to the rim point (start (10,0) for -45 deg; end (0,10) for 135 deg)
{
  const d = (deg) => render(joints, shapes, [dim('arc1', { labelAngle: deg * Math.PI / 180 })]).match(/<path d="M ([-\d.e]+) ([-\d.e]+) A [^"]*" fill="none" class="dim-arc-extension"/);
  const before = d(-45), past = d(135);
  assert.ok(Math.abs(+before[1] - 10) < 1e-9 && Math.abs(+before[2]) < 1e-9, 'before the start: extension begins at the start end');
  assert.ok(Math.abs(+past[1]) < 1e-9 && Math.abs(+past[2] - 10) < 1e-9, 'past the end: extension begins at the end end');
}
// a CIRCLE never has an extension, at any angle
for (const deg of [0, 90, 180, -135]) {
  assert.ok(!hasExtension(render(joints, shapes, [dim('circ1', { labelAngle: deg * Math.PI / 180 })])), `circle: no extension at ${deg}`);
}
// (4) an old dimension WITHOUT the field renders exactly as today: horizontal-right leader (angle 0), no extension
{
  const oldDim = dim('circ1', { offset: 25 });
  assert.strictEqual('labelAngle' in oldDim, false);
  const html = render(joints, shapes, [oldDim]);
  const L = leaderOf(html);
  assert.ok(Math.abs(L.y) < 1e-9 && Math.abs(L.x - 35) < 1e-9 && Math.abs(L.lx - 55) < 1e-9 && Math.abs(L.ly) < 1e-9, 'rim (35,0) -> label (55,0): the old horizontal-right layout');
  assert.strictEqual(html, render(joints, shapes, [dim('circ1', { offset: 25, labelAngle: 0 })]), 'no field renders identically to labelAngle 0');
  assert.ok(!hasExtension(html));
}
// persistence: the field survives undo/redo snapshots and serialize/deserialize (the constraint builder keeps it)
{
  const engine = createEngine(); engine.init();
  const state = createSketchState(engine, { x: 0, y: 0, w: 100, h: 100 });
  state.joints.set('c', { x: 0, y: 0 }); state.joints.set('s', { x: 10, y: 0 }); state.joints.set('e', { x: 0, y: 10 });
  state.shapes.push({ id: 'arc1', type: 'arc', subType: 'CENTER', joints: ['c', 's', 'e'] });
  assert.ok(addConstraintObject(state, { type: 'distance', isRadius: true, shape: 'arc1', value: 10, offset: 25, labelAngle: 1.25 }));
  assert.strictEqual(state.constraints.find((k) => k.isRadius).labelAngle, 1.25, 'builder keeps labelAngle');
  state.saveState(); state.constraints.find((k) => k.isRadius).labelAngle = 2; // an edit after the snapshot
  state.undo();
  assert.strictEqual(state.constraints.find((k) => k.isRadius).labelAngle, 1.25, 'undo restores the earlier angle');
  const doc = JSON.parse(JSON.stringify(serializeDocument(state)));
  const s2 = createSketchState(createEngine(), { x: 0, y: 0, w: 100, h: 100 }); s2.engine && s2.engine.init && s2.engine.init();
  deserializeDocument(doc, s2);
  assert.strictEqual(s2.constraints.find((k) => k.isRadius).labelAngle, 1.25, 'document round-trip keeps labelAngle');
}
console.log('radius-dim-angle: ok');
