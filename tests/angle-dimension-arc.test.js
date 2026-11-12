// tests/angle-dimension-arc.test.js -- TASK 543: an angle dimension's arc spans exactly the angle its value reads.
// Owner report: two lines 10 degrees apart, ANGLE value 10, but the arc was drawn in the 170 degree sector (the label sat there).
// Two crossing lines make four sectors (s, 180-s, s, 180-s); the arc must be one of the two sectors whose span is the value.
import assert from 'node:assert';
import fs from 'node:fs';

const store = {};
global.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
global.document = { head: { appendChild() {} }, getElementById: () => null, createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }) };

const { draw, angleDimensionSector } = await import('../packages/ui/svg-renderer.js');
const { getLineIntersection } = await import('../packages/core/geometry.js');
const { createEngine } = await import('../packages/core/constraint-solver.js');
const { createSketchState } = await import('../packages/ui/sketch-state.js');
const { serializeDocument, deserializeDocument } = await import('../packages/core/document.js');
const { addConstraintObject } = await import('../packages/core/constraints.js');

const deg = (r) => r * 180 / Math.PI;
const norm360 = (d) => ((d % 360) + 360) % 360;
const angDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

// render one angle dimension; returns the arc read back from the drawn path (span in degrees, CCW start to end)
function arcOf(joints, shapes, c, extent = 60000) {
  const svg = { viewBox: { baseVal: { x: -extent / 2, y: -extent / 2, width: extent, height: extent } }, getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 800 }), innerHTML: '' };
  draw(joints, shapes, svg, null, null, [c], new Set(), new Set(), 'select', null, new Set(), null, null, null, null, null, false, null);
  const m = svg.innerHTML.match(/<path d="M ([-\d.e]+) ([-\d.e]+) A ([-\d.e]+) [-\d.e]+ 0 ([01]) 1 ([-\d.e]+) ([-\d.e]+)"/);
  if (!m) return null;
  const s1 = shapes.find((s) => s.id === c.shapes[0]), s2 = shapes.find((s) => s.id === c.shapes[1]);
  const int = getLineIntersection(joints.get(s1.joints[0]), joints.get(s1.joints[1]), joints.get(s2.joints[0]), joints.get(s2.joints[1]));
  const a = norm360(deg(Math.atan2(+m[2] - int.y, +m[1] - int.x))), b = norm360(deg(Math.atan2(+m[6] - int.y, +m[5] - int.x)));
  return { span: norm360(b - a), startDeg: a, endDeg: b, large: +m[4], html: svg.innerHTML };
}
// two lines through the origin at the given direction angles (degrees); `from` / `len` set how far along each they run
// (from > 0: the lines stop short of the vertex), flipN reverses a line's joint order (its joints point the other way)
function pair(d1, d2, { from = 0, len = 100, flip1 = false, flip2 = false } = {}) {
  const mk = (a, flip) => { const r = a * Math.PI / 180, p = (t) => ({ x: Math.cos(r) * t, y: Math.sin(r) * t }); return flip ? [p(from + len), p(from)] : [p(from), p(from + len)]; };
  const [a, b] = mk(d1, flip1), [c, d] = mk(d2, flip2);
  const joints = new Map([['a', a], ['b', b], ['c', c], ['d', d]]);
  const shapes = [{ id: 'L1', type: 'line', joints: ['a', 'b'] }, { id: 'L2', type: 'line', joints: ['c', 'd'] }];
  return { joints, shapes };
}
// the value the solver row satisfies: signed CCW angle from line 1 to line 2 (the order task 511 stores), 0..360
const signedCcw = (joints) => { const u = { x: joints.get('b').x - joints.get('a').x, y: joints.get('b').y - joints.get('a').y }, v = { x: joints.get('d').x - joints.get('c').x, y: joints.get('d').y - joints.get('c').y }; return norm360(deg(Math.atan2(u.x * v.y - u.y * v.x, u.x * v.x + u.y * v.y))); };
const within = (arc, value, msg) => assert(arc && Math.abs(arc.span - value) < 0.5, `${msg}: arc spans ${arc && arc.span.toFixed(2)} but the value is ${value}`);

// 1. the owner's document
{
  const geo = JSON.parse(fs.readFileSync(new URL('./fixtures/angle-dimension/owner-trapezoid-angle.json', import.meta.url), 'utf8')).geometry;
  const joints = new Map(geo.joints);
  const c = geo.constraints.find((k) => k.type === 'angle');
  const arc = arcOf(joints, geo.shapes, c, 120000);
  assert(arc, 'the owner dimension draws an arc');
  within(arc, 10, 'owner document (the label sat in the 170 sector)');
  // inside the shape between the two lines: both arc ends lie on the two line directions
  const dirs = geo.shapes.filter((s) => c.shapes.includes(s.id)).map((s) => { const a = joints.get(s.joints[0]), b = joints.get(s.joints[1]); return norm360(deg(Math.atan2(b.y - a.y, b.x - a.x))); });
  assert(dirs.some((d) => angDiff(d, arc.startDeg) < 0.01) && dirs.some((d) => angDiff(d, arc.endDeg) < 0.01), `arc ends ${arc.startDeg.toFixed(2)}/${arc.endDeg.toFixed(2)} sit on the line directions ${dirs}`);
  assert(arc.html.includes('10.0°'), 'the label reads 10.0');
}

// 2. the four sectors: the label in each one never changes the span (a label dragged there is only labelPos, which picks no sector)
for (const [d1, d2] of [[0, 60], [0, 120], [30, 40], [10, 170], [0, 1], [0, 179], [0, 90]]) {
  const { joints, shapes } = pair(d1, d2);
  const value = signedCcw(joints);
  const rays = [d1, d2, d1 + 180, d2 + 180].map(norm360).sort((x, y) => x - y);
  for (let k = 0; k < 4; k++) {
    const next = rays[(k + 1) % 4] + (k === 3 ? 360 : 0);
    const mid = (rays[k] + next) / 2 * Math.PI / 180;
    const c = { type: 'angle', shapes: ['L1', 'L2'], value, offset: 200, glyphPos: { x: Math.cos(mid) * 300, y: Math.sin(mid) * 300 } };
    const arc = arcOf(joints, shapes, c, 2000);
    within(arc, value, `lines ${d1}/${d2}, label in sector ${k}`);
    assert.strictEqual(arc.large, 0, `${d1}/${d2}: a sector of at most 180 never uses the large-arc flag`);
    within(arcOf(joints, shapes, { ...c, glyphPos: undefined, labelPos: { x: 999, y: -999 } }, 4000), value, `lines ${d1}/${d2}, dragged label`);
  }
}

// 3. joint orders (joints pointing away from the intersection) x lines that stop short of the vertex x label anywhere
for (const [d1, d2] of [[0, 60], [20, 225], [100, 110]]) {
  for (const flip1 of [false, true]) for (const flip2 of [false, true]) for (const from of [0, 150]) {
    const { joints, shapes } = pair(d1, d2, { from, len: 100, flip1, flip2 });
    let ids = [shapes[0], shapes[1]], value = signedCcw(joints);
    if (value > 180) { ids = [shapes[1], shapes[0]]; value = 360 - value; }   // CCW order as task 511 stores it
    for (const where of [0, 90, 180, 270]) {
      const c = { type: 'angle', shapes: [ids[0].id, ids[1].id], value, offset: 400, glyphPos: { x: Math.cos(where * Math.PI / 180) * 400, y: Math.sin(where * Math.PI / 180) * 400 } };
      within(arcOf(joints, ids, c, 3000), value, `directions ${d1}/${d2} flips ${flip1}/${flip2} from ${from} label ${where}`);
    }
  }
}

// 4. parallel lines (value 0 / 180): no intersection, no arc, no throw
for (const d2 of [0, 180]) {
  const { joints, shapes } = pair(0, d2);
  joints.get('c').y = 10; joints.get('d').y = 10;
  assert.strictEqual(arcOf(joints, shapes, { type: 'angle', shapes: ['L1', 'L2'], value: d2, offset: 50 }), null, `parallel at ${d2}: no arc`);
}

// 5. a reference (driven) dimension keeps measuring the sector its label sits in
{
  const { joints, shapes } = pair(0, 60);
  const wide = arcOf(joints, shapes, { type: 'angle', shapes: ['L1', 'L2'], value: 60, isDriven: true, driven: true, offset: 200, glyphPos: { x: -100, y: 300 } }, 2000);
  within(wide, 120, 'a driven dimension reads the sector under its label');
  assert(wide.html.includes('(120.0°)'), 'and labels that measured span');
}

// 6. the pure chooser
{
  const r = (a) => a * Math.PI / 180;
  const sec = angleDimensionSector(r(0), r(10), r(-8), 10);
  assert(Math.abs(deg(sec.end - sec.start) - 10) < 1e-9, 'owner geometry with value 10: a 10 degree sector');
  const wide = angleDimensionSector(r(0), r(10), r(-8), null);
  assert(Math.abs(deg(wide.end - wide.start) - 170) < 1e-9, 'no value: the sector the label sits in (170)');
}

// 7. save / load and undo keep the arc
{
  const mk = () => { const e = createEngine(); e.init(); return createSketchState(e, { x: 0, y: 0, w: 700, h: 320 }); };
  const { joints, shapes } = pair(0, 10, { from: 100, len: 300 });
  const s = mk();
  for (const [id, p] of joints) s.joints.set(id, { ...p });
  s.shapes.push(...shapes);
  assert(addConstraintObject(s, { type: 'angle', shapes: ['L1', 'L2'], value: 10, offset: 600, glyphPos: { x: 600, y: -300 } }), 'angle constraint added');
  const before = arcOf(s.joints, s.shapes, s.constraints[0], 3000);
  within(before, 10, 'built state');
  const docj = JSON.parse(JSON.stringify(serializeDocument(s)));   // (a new state shares the module store, so serialize first)
  const s2 = mk(); deserializeDocument(docj, s2);
  assert.strictEqual(arcOf(s2.joints, s2.shapes, s2.constraints.find((k) => k.type === 'angle'), 3000).html, before.html, 'save/load: the arc and label are drawn the same');
  // undo on the loaded state: moving the label into another sector is one step, and undo brings back the same arc
  const c2 = () => s2.constraints.find((k) => k.type === 'angle');
  s2.saveState('move dimension label');
  c2().glyphPos = { x: -500, y: 80 };
  within(arcOf(s2.joints, s2.shapes, c2(), 3000), 10, 'label moved into another sector');
  s2.undo();
  assert.strictEqual(arcOf(s2.joints, s2.shapes, c2(), 3000).html, before.html, 'undo: the arc is back');
}
console.log('angle-dimension-arc: owner document, 4 sectors x 7 line pairs, joint orders, short lines, driven, save/load, undo passed.');
