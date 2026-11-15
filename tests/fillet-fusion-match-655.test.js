// TASK 655 (fillet audit F11-F14, F19): the Fillet does what Fusion does in four cases it used to refuse or differ in. Fusion ground truth
// (sketchArcs.addFillet, new documents): a T-junction fillets two of the three curves and leaves the third unchanged and detached; a
// construction + construction corner gives a construction arc, solid + construction a solid arc; a 179.5 degree corner at R 1 is filleted.
//  1. F12: a two-curve pick at a T (line+line, line+arc, arc+arc) fillets those two; the third keeps its end at the sharp point, detached,
//     with its own dimension;
//  3. F13 / F14: the arc's construction flag; the trimmed legs keep their own;
//  4. F19: 179.5 degrees at R 1 is created and the arc is tangent to both lines (numerically); exactly collinear is still refused;
//  5. diagnoseNoFillet: still right for what stays refused (parallel lines that do not meet) and says "Pick the two curves to fillet" at a T.
import assert from 'node:assert';
import * as L from './harness/audit/lib.js';
import { ConstraintManager } from '#core/constraint-manager.js';
import { findCornerAtPoint, findCornerBetweenLines, applyFillet, calculateFilletGeometry, diagnoseNoFillet } from '#core/fillet.js';

const P = (S, id) => S.state.joints.get(id);
const near = (a, b, tol = 1e-6) => Math.abs(a - b) < tol;
const dist = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);
const O0 = { x: 0, y: 0 };

// ---- 1. F12: T-junction, two-curve pick (Fusion: a (0,0)-(4,0), b (0,0)-(0,4), c (0,0)-(-3,-3); fillet a+b R1)
{
  const S = L.newSketch();
  const o = L.point(S, 0, 0), ae = L.point(S, 40, 0), be = L.point(S, 0, 40), ce = L.point(S, -30, -30);
  const a = L.line(S, o, ae), b = L.line(S, o, be), c = L.line(S, o, ce);
  const sa = L.shape(S, a), sb = L.shape(S, b), sc = L.shape(S, c);
  assert.strictEqual(findCornerAtPoint(S.state, O0, 5), null, 'a tap on a T-junction joint is not a corner (three curves)');
  assert.ok(findCornerBetweenLines(S.state, sa, sb), 'the two-curve pick finds the corner of a and b at the T');
  ConstraintManager.createConstraint(S.state, 'distance', { joints: [sc.joints[0], sc.joints[1]], value: 30 * Math.SQRT2 }, { source: 'dimension' });
  const dim = S.state.constraints.find((k) => k.type === 'distance');
  const res = applyFillet(S.state, findCornerBetweenLines(S.state, sa, sb), 10);
  assert.ok(res && res.success, 'the T fillet applies: ' + (res && res.reason));
  S.engine.solve(L.ITER);
  const a0 = P(S, sa.joints[0]), b0 = P(S, sb.joints[0]), c0 = P(S, sc.joints[0]);
  assert.ok(near(a0.x, 10) && near(a0.y, 0), `a is trimmed to (10,0): ${a0.x},${a0.y}`);
  assert.ok(near(b0.x, 0) && near(b0.y, 10), `b is trimmed to (0,10): ${b0.x},${b0.y}`);
  assert.ok(near(c0.x, 0, 1e-4) && near(c0.y, 0, 1e-4), `c keeps its end at the sharp point (0,0): ${c0.x},${c0.y}`);
  assert.ok(!sc.joints.some((j) => [sa.joints[0], sb.joints[0], res.virtualSharp].includes(j)), 'c shares no joint with a, b or the sharp V (detached)');
  const cEnd = P(S, sc.joints[1]);
  assert.ok(near(cEnd.x, -30) && near(cEnd.y, -30), 'c far end unmoved');
  assert.ok(near(dim.value, 30 * Math.SQRT2) && dim.joints.every((j) => sc.joints.includes(j)), `c's dimension followed c's end: ${JSON.stringify(dim.joints)} vs ${sc.joints}`);
  assert.strictEqual(S.state.constraints.filter((k) => k.type === 'tangent').length, 2, 'two tangents were added');
  assert.ok(dist(P(S, res.joints[0]), { x: 10, y: 10 }) < 1e-4, 'the fillet centre is (10,10)');
}

// ---- 1b. line + arc legs at a T
{
  const S = L.newSketch();
  const o = L.point(S, 0, 0), le = L.point(S, 40, 0), te = L.point(S, -30, -30);
  const cc = L.point(S, 0, -30), a1 = L.point(S, 0, 0), a2 = L.point(S, 30, -30); // arc about (0,-30) from (0,0) to (30,-30): leaves (0,0) heading +x
  // the line goes up-left so it meets the arc at a real angle
  P(S, le).x = -20; P(S, le).y = 30;
  const ln = L.line(S, o, le), arc = L.arc(S, cc, a1, a2), third = L.line(S, o, te);
  const sl = L.shape(S, ln), sA = L.shape(S, arc), sT = L.shape(S, third);
  const corner = findCornerBetweenLines(S.state, sl, sA);
  assert.ok(corner, 'line + arc at a T: a corner');
  const res = applyFillet(S.state, corner, 3);
  assert.ok(res && res.success, 'line + arc T fillet applies: ' + (res && res.reason));
  const t0 = P(S, sT.joints[0]);
  assert.ok(near(t0.x, 0, 1e-4) && near(t0.y, 0, 1e-4), 'third line keeps its end at the sharp point (line + arc legs)');
  assert.ok(sT.joints[0] !== sl.joints[0] && sT.joints[0] !== sA.joints[1], 'the third line is detached');
}

// ---- 1c. arc + arc legs at a T
{
  const S = L.newSketch();
  const o = L.point(S, 0, 0), te = L.point(S, -30, 5);
  const arcA = L.arc(S, L.point(S, 0, 30), L.point(S, 0, 0), L.point(S, 30, 30)); // about (0,30)
  const arcB = L.arc(S, L.point(S, 30, 0), L.point(S, 0, 0), L.point(S, 30, 30)); // about (30,0)
  const third = L.line(S, o, te);
  const sA = L.shape(S, arcA), sB = L.shape(S, arcB), sT = L.shape(S, third);
  const corner = findCornerBetweenLines(S.state, sA, sB, [O0]);
  assert.ok(corner, 'arc + arc at a T: a corner');
  const res = applyFillet(S.state, corner, 4);
  assert.ok(res && res.success, 'arc + arc T fillet applies: ' + (res && res.reason));
  const t0 = P(S, sT.joints[0]);
  assert.ok(near(t0.x, 0, 1e-4) && near(t0.y, 0, 1e-4), 'third line keeps its end at the sharp point (arc + arc legs)');
}

// ---- 3. F13 / F14: construction flags
for (const [fa, fb, wantArc] of [[true, true, true], [false, true, false], [true, false, false], [false, false, false]]) {
  const S = L.newSketch();
  const o = L.point(S, 0, 0);
  const a = L.line(S, o, L.point(S, 40, 0)), b = L.line(S, o, L.point(S, 0, 40));
  const sa = L.shape(S, a), sb = L.shape(S, b);
  sa.isConstruction = fa; sb.isConstruction = fb;
  const tag = `construction ${fa}/${fb}`;
  assert.ok(findCornerAtPoint(S.state, O0, 5), `${tag}: the tap finds the corner of the two curves`);
  const corner = findCornerBetweenLines(S.state, sa, sb);
  assert.ok(corner, `${tag}: the two-curve pick finds the corner`);
  const res = applyFillet(S.state, corner, 5);
  assert.ok(res && res.success, `${tag}: applies`);
  assert.strictEqual(!!res.arc.isConstruction, wantArc, `${tag}: the arc isConstruction is ${wantArc}`);
  assert.strictEqual(!!sa.isConstruction, fa, `${tag}: line a keeps its flag`);
  assert.strictEqual(!!sb.isConstruction, fb, `${tag}: line b keeps its flag`);
}
{ // a polygon-style radial (construction) on a solid corner still hangs off the sharp point and is not a third curve of the corner
  const S = L.newSketch();
  const o = L.point(S, 0, 0);
  L.line(S, o, L.point(S, 40, 0)); L.line(S, o, L.point(S, 0, 40));
  const r = L.line(S, o, L.point(S, 20, 20));
  L.shape(S, r).isConstruction = true;
  const corner = findCornerAtPoint(S.state, O0, 5);
  assert.ok(corner, 'two solid lines + a construction radial: the tap still finds the solid corner');
  const res = applyFillet(S.state, corner, 5);
  assert.ok(res.success && !res.arc.isConstruction, 'the arc is solid');
  assert.strictEqual(L.shape(S, r).joints[0], res.virtualSharp, 'the radial is re-linked to the sharp V (unchanged behaviour)');
}

// ---- 4. F19: near-straight corner (line a along +x, line b leaves the corner at 179.5 degrees from it)
{
  const theta = 179.5 * Math.PI / 180;
  const S = L.newSketch();
  const o = L.point(S, 0, 0), ae = L.point(S, 50, 0), be = L.point(S, 50 * Math.cos(theta), 50 * Math.sin(theta));
  const sa = L.shape(S, L.line(S, o, ae)), sb = L.shape(S, L.line(S, o, be));
  const g = calculateFilletGeometry(P(S, ae), O0, P(S, be), 1);
  assert.ok(g.valid, '179.5 degrees at R 1: the geometry is valid: ' + g.reason);
  const res = applyFillet(S.state, findCornerBetweenLines(S.state, sa, sb), 1);
  assert.ok(res && res.success, '179.5 degrees at R 1: a fillet is created: ' + (res && res.reason));
  S.engine.solve(L.ITER);
  const C = P(S, res.joints[0]), ta = P(S, res.joints[1]), tb = P(S, res.joints[2]);
  assert.ok(near(dist(C, ta), 1, 1e-6) && near(dist(C, tb), 1, 1e-6), `the arc has radius 1: ${dist(C, ta)}, ${dist(C, tb)}`);
  // tangent: the radius to each tangent point is perpendicular to its line, and the tangent point lies ON the line
  for (const [t, far] of [[ta, P(S, ae)], [tb, P(S, be)]]) {
    const lx = far.x - t.x, ly = far.y - t.y, ll = Math.hypot(lx, ly);
    const dotp = Math.abs((lx * (t.x - C.x) + ly * (t.y - C.y)) / ll);
    assert.ok(dotp < 1e-6, `the radius is perpendicular to the line at the tangent point (|dot| ${dotp})`);
    const off = Math.abs(far.x * t.y - far.y * t.x) / Math.hypot(far.x, far.y);
    assert.ok(off < 1e-6, `the tangent point lies on its line (off by ${off})`);
  }
  console.log(`179.5 deg R 1: tangent length ${dist(ta, O0).toFixed(5)} mm`);
}
{ // exactly collinear is still refused; folded back exactly too; a hair off straight gives a point-sized arc: refused
  const g = calculateFilletGeometry({ x: 50, y: 0 }, O0, { x: -50, y: 0 }, 1);
  assert.ok(!g.valid && /collinear/i.test(g.reason), 'exactly collinear: refused as collinear: ' + g.reason);
  const f = calculateFilletGeometry({ x: 50, y: 0 }, O0, { x: 80, y: 0 }, 1);
  assert.ok(!f.valid && /collinear/i.test(f.reason), 'folded back exactly: refused as collinear');
  const tiny = calculateFilletGeometry({ x: 50, y: 0 }, O0, { x: -50, y: 50 * 1e-6 }, 1);
  assert.ok(!tiny.valid && /too small|collinear/i.test(tiny.reason), 'a hair off straight: refused (' + tiny.reason + ')');
  const a = 0.2 * Math.PI / 180;
  const ok = calculateFilletGeometry({ x: 50, y: 0 }, O0, { x: -50 * Math.cos(a), y: 50 * Math.sin(a) }, 5);
  assert.ok(ok.valid, 'a 179.8 degree corner at R 5 is created: ' + ok.reason);
}

// ---- 5. diagnoseNoFillet
{
  const S = L.newSketch();
  L.line(S, L.point(S, 0, 0), L.point(S, 40, 0)); L.line(S, L.point(S, 0, 10), L.point(S, 40, 10)); // parallel, do not meet
  assert.strictEqual(findCornerAtPoint(S.state, O0, 3), null, 'parallel lines: no corner');
  assert.strictEqual(diagnoseNoFillet(S.state, O0, 3), 'Fillet needs a corner between two lines', 'parallel lines that do not meet: the corner message');
}
{
  const S = L.newSketch();
  const o = L.point(S, 0, 0);
  L.line(S, o, L.point(S, 40, 0)); L.line(S, o, L.point(S, 0, 40)); L.line(S, o, L.point(S, -30, -30));
  assert.strictEqual(diagnoseNoFillet(S.state, O0, 3), 'Pick the two curves to fillet', 'a T-junction: pick the two curves');
}
console.log('fillet-fusion-match-655.test.js: ok');
