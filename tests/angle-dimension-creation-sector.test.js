// tests/angle-dimension-creation-sector.test.js -- TASK 543 round 2: the sector where the label is dropped when an angle dimension is CREATED
// decides what it measures (Fusion, measured through its API: 10.00 in the 10 degree sector, 170.00 in the 170 degree one; a later label drag
// changes nothing). The stored constraint is the CCW pair (task 511) plus the additive field `supplement: true` = "the value is the SUPPLEMENT of
// the pair's CCW angle". The solver row, the verifier and the arc all read it; an old constraint without it is unchanged.
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
// what the stored constraint measures in the live geometry: the CCW angle of its pair, or its supplement
function measured(S, c) {
  const d = norm(deg(dirOf(S, c.shapes[1]) - dirOf(S, c.shapes[0])));
  const th = d > 180 ? 360 - d : d;
  return c.supplement === true ? 180 - th : th;
}
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
    assert.strictEqual(c.supplement === true, Math.abs(span - theta) > 1e-6, tag + ': supplement flag is set exactly when the sector is the supplement of the pair angle');
    // 2. the drawn arc spans it
    assert(Math.abs(arcSpan(S, c) - span) < 0.5, `${tag}: arc spans ${arcSpan(S, c)} not ${span}`);
    // 3. the solver holds it: residual 0, the measured sector is still the chosen span after a jitter re-solve, nothing collapsed
    assert(measureResidual(c, S.state.joints, S.state.shapes) < 1e-9, tag + ': verifier residual 0 at creation');
    L.jitter(S, 11, 0.02, 200);
    assert(S.engine.solve(500).converged, tag + ': converged after jitter');
    assert(Math.abs(measured(S, c) - span) < 1e-3, `${tag}: after a jitter re-solve the dimension measures ${measured(S, c)}, not ${span}`);
    assert(Math.abs(spanContaining(S, c, labelDeg) - span) < 1e-3, `${tag}: the label's sector still spans ${spanContaining(S, c, labelDeg)}`);
    // 4. editing the value to 120 drives the chosen sector (CCW angle 120 or its supplement 60), the label stays in that sector
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
    assert.strictEqual(saved.supplement === true, c.supplement === true, tag + ': saved');
    S.state.saveState('edit');
    const keepSup = c.supplement === true, keepVal = c.value;
    c.value = 33; delete c.supplement;
    S.state.undo();
    const back = S.state.constraints.find((x) => x.type === 'angle');
    assert(back.value === keepVal && (back.supplement === true) === keepSup, tag + ': undo restores value + sector');
    const S2 = L.newSketch(); deserializeDocument(doc, S2.state);
    const loaded = S2.state.constraints.find((x) => x.type === 'angle');
    assert(loaded && (loaded.supplement === true) === keepSup && Math.abs(loaded.value - keepVal) < 1e-9, tag + ': loaded');
    cases++;
  }
}

// the row itself, both variants, at a 10 degree geometry: plain t = 10 and supplement t = 170 are satisfied, plain t = 170 / supplement t = 10 are not
{
  const pos = Float64Array.from([0, 0, 100, 0, 0, 0, Math.cos(10 * Math.PI / 180) * 100, Math.sin(10 * Math.PI / 180) * 100]);
  const err = (value, supplement) => Math.abs(Definitions.angle.computeError({ joints: [0, 1, 2, 3], value, supplement }, pos));
  assert(err(10, false) < 1e-9 && err(170, true) < 1e-9, 'plain 10 and supplement 170 hold a 10 degree pair');
  assert(err(170, false) > 100 && err(10, true) > 100, 'plain 170 and supplement 10 do not');
}

// an OLD constraint (no field) is untouched: its row is the signed line-to-line angle mod 180, exactly as before
{
  const S = L.newSketch();
  const { l1, l2 } = build(S, 0, 10);
  assert(ConstraintManager.createConstraint(S.state, 'angle', { shapes: [l1, l2], value: 170 }, { source: 'test' }));
  const c = S.state.constraints.find((x) => x.type === 'angle');
  assert(!('supplement' in c), 'no field unless asked');
  S.engine.solve(500);
  // today's row: the signed CCW angle line 1 -> line 2 is 170 MOD 180 (so 170 or -10), and the pair is not reordered or flagged
  const signed = norm(deg(dirOf(S, c.shapes[1]) - dirOf(S, c.shapes[0])));
  assert(Math.abs(((signed - 170) % 180 + 180) % 180) < 1e-3 || Math.abs(((signed - 170) % 180 + 180) % 180 - 180) < 1e-3, `an old-format 170 still holds the signed angle 170 mod 180 (today's behaviour), got ${signed}`);
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
  assert(!c.isDriven && Math.abs(c.value - 170) < 1e-6 && c.supplement === true, `promoted reference: value ${c.value} supplement ${c.supplement}`);
  assert(Math.abs(measured(S, c) - 170) < 1e-3, 'and the geometry measures 170 in that sector');
}
console.log(`angle-dimension-creation-sector: ${cases} creation cases (3 line pairs x 4 sectors) with edit, jitter, Jacobian, save/load, undo; row variants; old format; promotion passed.`);
