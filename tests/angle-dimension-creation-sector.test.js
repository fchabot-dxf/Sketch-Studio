// tests/angle-dimension-creation-sector.test.js -- TASK 543 round 2: the sector where the label is dropped when an angle dimension is CREATED
// decides what it measures (Fusion, measured through its API: 10.00 in the 10 degree sector, 170.00 in the 170 degree one; a later label drag
// changes nothing). The stored constraint is the CCW pair (task 511) plus the measured SECTOR (task 553, #core/angle-sector.js:
// { ray1, ray2, turn }: the sector runs from a ray of line 1 to a ray of line 2, counter-clockwise or clockwise). The solver row, the
// verifier and the arc all read it.
import assert from 'node:assert';

const store = {};
global.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
global.document = { head: { appendChild() {} }, getElementById: () => null, createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }) };

const L = await import('./harness/audit/lib.js');
const { ConstraintManager } = await import('../packages/core/constraint-manager.js');
const { measureResidual } = await import('../packages/core/constraint-verifier.js');
const { commitDimensionEdit, toggleDriving } = await import('../packages/ui/dimension-seams.js');
const { updateConstraintOffset } = await import('../packages/ui/input-handlers/dimension-tool.js');
const { draw } = await import('../packages/ui/svg-renderer.js');
const { serializeDocument, deserializeDocument } = await import('../packages/core/document.js');
const { getLineIntersection } = await import('../packages/core/geometry.js');
const { Definitions } = await import('../packages/core/solver/definitions.js');

const deg = (r) => r * 180 / Math.PI;
const norm = (d) => ((d % 360) + 360) % 360;

// two lines through a common point P at direction angles d1, d2 (degrees), each running from P + from to P + from + len along its direction
function build(S, d1, d2, P = { x: 400, y: 300 }, from = 40, len = 220) {
  const mk = (d) => { const r = d * Math.PI / 180; return [L.point(S, P.x + Math.cos(r) * from, P.y + Math.sin(r) * from), L.point(S, P.x + Math.cos(r) * (from + len), P.y + Math.sin(r) * (from + len))]; };
  const [a, b] = mk(d1), [c, d] = mk(d2);
  return { l1: L.line(S, a, b), l2: L.line(S, c, d), P };
}
const J = (S, id) => S.state.joints.get(id);
const dirOf = (S, sid) => { const s = L.shape(S, sid); const a = J(S, s.joints[0]), b = J(S, s.joints[1]); return Math.atan2(b.y - a.y, b.x - a.x); };
const intOf = (S, c) => { const [s1, s2] = c.shapes.map((id) => L.shape(S, id)); return getLineIntersection(J(S, s1.joints[0]), J(S, s1.joints[1]), J(S, s2.joints[0]), J(S, s2.joints[1])); };
// independent: the span (degrees) of the sector between the four rays that contains direction `ang` (degrees)
function spanContaining(S, c, ang) {
  const d1 = norm(deg(dirOf(S, c.shapes[0]))), d2 = norm(deg(dirOf(S, c.shapes[1])));
  const rays = [d1, d2, norm(d1 + 180), norm(d2 + 180)].sort((x, y) => x - y);
  const a = norm(ang);
  for (let i = 0; i < 4; i++) { const lo = rays[i], hi = i === 3 ? rays[0] + 360 : rays[i + 1]; const aa = i === 3 && a < lo ? a + 360 : a; if (aa >= lo && aa <= hi) return hi - lo; }
  throw new Error('no sector');
}
// what the stored constraint measures in the live geometry: the angle from its ray of line 1 to its ray of line 2, turning its way
const rayDeg = (S, c, i) => deg(dirOf(S, c.shapes[i])) + ((i === 0 ? c.sector.ray1 : c.sector.ray2) < 0 ? 180 : 0);
function measured(S, c) { return norm(c.sector.turn * (rayDeg(S, c, 1) - rayDeg(S, c, 0))); }
// does direction `ang` (degrees) lie inside the stored sector
function inSector(S, c, ang) { const from = c.sector.turn > 0 ? rayDeg(S, c, 0) : rayDeg(S, c, 1); return norm(ang - from) <= measured(S, c) + 1e-9; }
const arcSpan = (S, c) => {
  const svg = { viewBox: { baseVal: { x: -2000, y: -2000, width: 4000, height: 4000 } }, getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 800 }), innerHTML: '' };
  draw(S.state.joints, S.state.shapes, svg, null, null, [c], new Set(), new Set(), 'select', null, new Set(), null, null, null, null, null, false, null);
  const m = svg.innerHTML.match(/<path d="M ([-\d.e]+) ([-\d.e]+) A [-\d.e]+ [-\d.e]+ 0 [01] 1 ([-\d.e]+) ([-\d.e]+)"/);
  const int = intOf(S, c);
  return norm(deg(Math.atan2(+m[4] - int.y, +m[3] - int.x)) - deg(Math.atan2(+m[2] - int.y, +m[1] - int.x)));
};

// the owner's two lines (76.87 / 86.87 degrees) and a 30 / 150 pair; labels dropped in each of the 4 sectors
const PAIRS = [[76.86845, 86.86845], [30, 150], [20, 100]];
let cases = 0;
for (const [d1, d2] of PAIRS) {
  for (const turn of [0, 90, 180, 270]) {                                   // label direction = a point inside each of the four sectors
    const S = L.newSketch();
    const { l1, l2 } = build(S, d1, d2);
    const rays = [d1, d2, d1 + 180, d2 + 180].map(norm).sort((x, y) => x - y);
    const k = turn / 90, hi = k === 3 ? rays[0] + 360 : rays[k + 1];
    const labelDeg = (rays[k] + hi) / 2;
    const tag = `lines ${d1}/${d2}, label in sector ${k} (${(hi - rays[k]).toFixed(1)} deg)`;
    // the Dimension tool: created at the measured value, then the label follows the cursor while it is being placed
    assert(ConstraintManager.createConstraint(S.state, 'angle', { shapes: [l1, l2], value: L.measure(S, { type: 'angle', shapes: [l1, l2] }) }, { source: 'test' }), tag + ': created');
    const c = S.state.constraints.find((x) => x.type === 'angle');
    c.__placing = true; c.__newlyPlaced = true;
    const before = L.snapshot(S);
    const theta = L.measure(S, { type: 'angle', shapes: [l1, l2] });
    const int = intOf(S, c);
    updateConstraintOffset(S.state, c, { x: int.x + Math.cos(labelDeg * Math.PI / 180) * 300, y: int.y + Math.sin(labelDeg * Math.PI / 180) * 300 });
    c.__placing = false; c.__newlyPlaced = false;
    const span = hi - rays[k];
    // 1. stored value == the sector's span; the lines have not moved
    assert(Math.abs(c.value - span) < 1e-6, `${tag}: stored value ${c.value} != span ${span}`);
    assert(L.maxDeviation(S, before) === 0, tag + ': placing the label moved geometry');
    assert(theta > 0 && Math.abs(measured(S, c) - span) < 1e-6 && inSector(S, c, labelDeg), `${tag}: the stored sector ${JSON.stringify(c.sector)} is the one under the label (spans ${measured(S, c)})`);
    // 2. the drawn arc spans it
    assert(Math.abs(arcSpan(S, c) - span) < 0.5, `${tag}: arc spans ${arcSpan(S, c)} not ${span}`);
    // 3. the solver holds it: residual 0, the measured sector is still the chosen span after a jitter re-solve, nothing collapsed
    assert(measureResidual(c, S.state.joints, S.state.shapes) < 1e-9, tag + ': verifier residual 0 at creation');
    L.jitter(S, 11, 0.02, 200);
    assert(S.engine.solve(500).converged, tag + ': converged after jitter');
    assert(Math.abs(measured(S, c) - span) < 1e-3, `${tag}: after a jitter re-solve the dimension measures ${measured(S, c)}, not ${span}`);
    assert(Math.abs(spanContaining(S, c, labelDeg) - span) < 1e-3, `${tag}: the label's sector still spans ${spanContaining(S, c, labelDeg)}`);
    // 4. editing the value to 120 drives the chosen sector, the label stays in that sector
    const er = commitDimensionEdit(S.state, c, 120);
    assert(!er.reverted, tag + ': edit to 120 accepted ' + JSON.stringify(er));
    assert(Math.abs(measured(S, c) - 120) < 1e-3, `${tag}: after editing to 120 the dimension measures ${measured(S, c)}`);
    assert(Math.abs(arcSpan(S, c) - 120) < 0.5, `${tag}: after the edit the arc spans ${arcSpan(S, c)}`);
    // 5. the Jacobian guard covers the row variant: analytic == finite differences
    const fd = L.fdJacobian(S);
    assert(!fd.worst.some((w) => w.type === 'angle'), `${tag}: angle Jacobian differs from finite differences: ${JSON.stringify(fd.worst)}`);
    // 6. save / load keeps it; undo keeps it
    const doc = JSON.parse(JSON.stringify(serializeDocument(S.state)));
    const saved = doc.geometry.constraints.find((x) => x.type === 'angle');
    assert.deepStrictEqual(saved.sector, c.sector, tag + ': saved');
    S.state.saveState('edit');
    const keepSector = JSON.stringify(c.sector), keepVal = c.value;
    c.value = 33; c.sector = { ray1: -c.sector.ray1, ray2: c.sector.ray2, turn: -c.sector.turn };
    S.state.undo();
    const back = S.state.constraints.find((x) => x.type === 'angle');
    assert(back.value === keepVal && JSON.stringify(back.sector) === keepSector, tag + ': undo restores value + sector');
    const S2 = L.newSketch(); deserializeDocument(doc, S2.state);
    const loaded = S2.state.constraints.find((x) => x.type === 'angle');
    assert(loaded && JSON.stringify(loaded.sector) === keepSector && Math.abs(loaded.value - keepVal) < 1e-9, tag + ': loaded');
    cases++;
  }
}

// the row itself, at a 10 degree geometry (u at 0, v at 10): the 10 sector (+u -> +v counter-clockwise) and the 170 sector (+v -> -u, i.e.
// from -u clockwise to +v) hold it; the same values in the other sector do not
{
  const at = (d) => Float64Array.from([0, 0, 100, 0, 0, 0, Math.cos(d * Math.PI / 180) * 100, Math.sin(d * Math.PI / 180) * 100]);
  const err = (value, sector, d = 10) => Math.abs(Definitions.angle.computeError({ joints: [0, 1, 2, 3], value, sector }, at(d)));
  const CCW = { ray1: 1, ray2: 1, turn: 1 }, WIDE = { ray1: -1, ray2: 1, turn: -1 };
  assert(err(10, CCW) < 1e-9 && err(170, WIDE) < 1e-9, '10 in the CCW sector and 170 in the wide one hold a 10 degree pair');
  assert(err(170, CCW) > 100 && err(10, WIDE) > 100, '170 in the CCW sector and 10 in the wide one do not');
  // TASK 553: modulo 360, not 180: a 190 dimension (from +u counter-clockwise) is held by the 190 pose only, not by 10 or 170
  assert(err(190, CCW, 190) < 1e-9, '190 holds the 190 pose');
  for (const d of [10, 170]) assert(err(190, CCW, d) > 100, `190 is not held by the ${d} pose (residual ${err(190, CCW, d)})`);
  // and every sector variant: its value at its own pose is 0, the opposite pose (the old modulo-180 twin) is not
  for (const ray1 of [1, -1]) for (const ray2 of [1, -1]) for (const turn of [1, -1]) for (const value of [10, 120, 190, 270, 359]) {
    const sector = { ray1, ray2, turn }, pose = turn * value + (ray1 !== ray2 ? 180 : 0);
    assert(err(value, sector, pose) < 1e-9, `${JSON.stringify(sector)} ${value}: held at ${pose}`);
    assert(err(value, sector, pose + 180) > 100, `${JSON.stringify(sector)} ${value}: not held at the opposite pose ${pose + 180}`);
  }
}

// a constraint built in code without a sector measures the CCW sector from line 1 to line 2 (the default), modulo 360
{
  const S = L.newSketch();
  const { l1, l2 } = build(S, 0, 10);
  assert(ConstraintManager.createConstraint(S.state, 'angle', { shapes: [l1, l2], value: 170 }, { source: 'test' }));
  const c = S.state.constraints.find((x) => x.type === 'angle');
  assert.deepStrictEqual(c.sector, { ray1: 1, ray2: 1, turn: 1 }, 'the default sector is stored');
  S.engine.solve(500);
  const signed = norm(deg(dirOf(S, c.shapes[1]) - dirOf(S, c.shapes[0])));
  assert(Math.abs(signed - 170) < 1e-3, `a 170 without a sector holds the CCW angle 170 from line 1 to line 2 (not -10), got ${signed}`);
  assert(measureResidual(c, S.state.joints, S.state.shapes) < 1e-9, 'and the verifier agrees');
}

// a reference dimension becoming driving takes the sector its label sits in
{
  const S = L.newSketch();
  const { l1, l2 } = build(S, 76.86845, 86.86845);
  assert(ConstraintManager.createConstraint(S.state, 'angle', { shapes: [l1, l2], value: 10, isDriven: true, driven: true }, { source: 'test' }));
  const c = S.state.constraints.find((x) => x.type === 'angle');
  const int = intOf(S, c);
  c.glyphPos = { x: int.x + Math.cos(-8 * Math.PI / 180) * 300, y: int.y + Math.sin(-8 * Math.PI / 180) * 300 };   // the 170 sector
  toggleDriving(S.state, c);
  assert(!c.isDriven && Math.abs(c.value - 170) < 1e-6 && inSector(S, c, -8), `promoted reference: value ${c.value} sector ${JSON.stringify(c.sector)}`);
  assert(Math.abs(measured(S, c) - 170) < 1e-3, 'and the geometry measures 170 in that sector');
}
console.log(`angle-dimension-creation-sector: ${cases} creation cases (3 line pairs x 4 sectors) with edit, jitter, Jacobian, save/load, undo; row variants (modulo 360); default sector; promotion passed.`);
