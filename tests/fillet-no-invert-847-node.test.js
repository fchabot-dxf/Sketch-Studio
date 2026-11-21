// tests/fillet-no-invert-847-node.test.js -- TASK 847 (part B): a FILLET arc never turns inside out in a solve.
// Task 846's case (838's showcase panel): a 0.3 x 0.7 in vent slot, its corners filleted R 0.1 in, the four fillet radius dimensions DELETED (free
// radii), then its position dimension changed 4.3 -> 3.95 in. The solve took the 0.35 in move into the free radii: 0.052 / 0.064 / 0.298 / 0.324 in,
// and two fillets crossed through zero radius to the OUTSIDE of their corners (centre outside the slot, the line running into the arc and the arc
// running back out: a cusp), the loop crossing itself (846: D-shaped in 2D, no cut in 3D).
// THE rule (#core/solver/definitions.js tangent, filletTravel): a fillet arc's tangent row at its shared end has no zero on the cusp side, so a
// solve can only land on the smooth fillet. Here the move then cannot be taken by the radii without a fillet going through zero; the least-change
// solve ends against that and does not converge, so the edit is REFUSED (the existing plain line: "conflicts with ...") and the slot and its
// four R 0.1 fillets stay exactly as they were. With the radius dimensions kept, the same edit moves the slot (846's keepR build).
// Also: the row itself (continuous where the cusp side begins, never zero on it, the same row as before on the smooth side) and its derivative.
import assert from 'node:assert';
import * as L from './harness/audit/lib.js';
import * as ops from '#core/tool-ops.js';
import { commitDimensionEdit } from '#core/dimension-seams.js';
import { Definitions } from '#core/solver/definitions.js';

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const IN = 25.4;
const quiet = (f) => { const l = console.log, w = console.warn, e = console.error, d = console.debug; console.log = console.warn = console.error = console.debug = () => {}; try { return f(); } finally { console.log = l; console.warn = w; console.error = e; console.debug = d; } };

// each fillet: its radius, and whether it is SMOOTH: at both ends the arc's travel continues its line's travel (no cusp), its centre on the
// inner side of the corner (the side of each line the slot's interior is on)
function fillets(S, fil, inside) {
  const st = S.state, J = (id) => st.joints.get(id);
  return fil.map((f) => {
    const a = L.shape(S, f.arc), C = J(a.joints[0]), A = J(a.joints[1]), B = J(a.joints[2]);
    const r = Math.hypot(A.x - C.x, A.y - C.y);
    // the centre and the slot's inside point on the same side of each leg line (the legs: the lines tangent to this arc)
    const legs = st.constraints.filter((c) => c.type === 'tangent' && c.circle === f.arc).map((c) => L.shape(S, c.line));
    const side = (l, p) => { const [u, v] = l.joints.map(J); return Math.sign((v.x - u.x) * (p.y - u.y) - (v.y - u.y) * (p.x - u.x)); };
    const inner = legs.length === 2 && legs.every((l) => side(l, C) === side(l, inside));
    return { r, inner };
  });
}

function build({ keepRadii }) {
  const S = L.newSketch(), st = S.state;
  const r = quiet(() => L.rect(S, 4.3 * IN, 4.3 * IN, 4.6 * IN, 5.0 * IN));
  const dx = quiet(() => ops.dimension(st, { joints: [L.origin, r.c1], dimMode: 'horizontal' }, { x: 2 * IN, y: 3 * IN }, String(4.3 * IN)));
  quiet(() => ops.dimension(st, { joints: [L.origin, r.c1], dimMode: 'vertical' }, { x: 1 * IN, y: 2 * IN }, String(4.3 * IN)));
  quiet(() => ops.dimension(st, { joints: L.shape(S, r.top).joints, dimMode: 'horizontal' }, { x: 4.45 * IN, y: 4 * IN }, String(0.3 * IN)));
  quiet(() => ops.dimension(st, { joints: L.shape(S, r.right).joints, dimMode: 'vertical' }, { x: 5 * IN, y: 4.6 * IN }, String(0.7 * IN)));
  const fil = [[r.top, r.right], [r.right, r.bottom], [r.bottom, r.left], [r.left, r.top]].map(([a, b]) => quiet(() => L.fillet(S, a, b, 0.1 * IN)));
  if (!keepRadii) for (let i = st.constraints.length - 1; i >= 0; i--) { const c = st.constraints[i]; if (c.type === 'distance' && c.isRadius && fil.some((f) => f.arc === c.shape)) st.constraints.splice(i, 1); }
  quiet(() => S.engine.solve(L.ITER));
  return { S, dx, fil, corner: () => st.joints.get(dx.joints[1]) };
}

// 1. 846's case: the free radii
{
  const { S, dx, fil, corner } = build({ keepRadii: false });
  const before = fillets(S, fil, { x: 4.45 * IN, y: 4.65 * IN });
  ok(before.every((f) => Math.abs(f.r - 0.1 * IN) < 1e-6 && f.inner), `free radii, before the edit: four smooth R 0.1 in fillets (${before.map((f) => (f.r / IN).toFixed(3)).join(' / ')})`);
  const snap = L.snapshot(S);
  const res = quiet(() => commitDimensionEdit(S.state, dx, 3.95 * IN));
  const after = fillets(S, fil, { x: corner().x + 0.15 * IN, y: 4.65 * IN });
  console.log(`free radii, x 4.3 -> 3.95 in: ${res.reverted ? 'refused (' + (res.reason || 'conflicts with ' + res.clash) + ')' : 'kept'}; corner x ${(corner().x / IN).toFixed(3)} in; fillets ${after.map((f) => 'R ' + (f.r / IN).toFixed(3) + (f.inner ? '' : ' INVERTED')).join(' / ')}`);
  ok(after.every((f) => f.inner && f.r > 0), `no fillet turned inside out (${after.map((f) => (f.r / IN).toFixed(3) + (f.inner ? '' : ' inverted')).join(' / ')})`);
  ok(res.reverted === true, 'the move cannot be taken by the free radii: the edit is refused');
  ok(/conflicts with/.test(res.clash ? `conflicts with ${res.clash}` : res.reason || ''), `with the existing plain line (${JSON.stringify(res)})`);
  ok(L.maxDeviation(S, snap) < 1e-6, `and the slot and its fillets are exactly as they were (moved ${L.maxDeviation(S, snap)})`);
  ok(Math.abs(dx.value - 4.3 * IN) < 1e-9, 'the dimension keeps its value');
}

// 2. the radius dimensions kept (846's keepR build): the same edit moves the slot, the fillets stay R 0.1
{
  const { S, dx, fil, corner } = build({ keepRadii: true });
  const res = quiet(() => commitDimensionEdit(S.state, dx, 3.95 * IN));
  const after = fillets(S, fil, { x: corner().x + 0.15 * IN, y: 4.65 * IN });
  ok(!res.reverted, `kept radii: the edit is kept (${JSON.stringify(res)})`);
  ok(Math.abs(corner().x - 3.95 * IN) < 1e-6, `the slot moved to x 3.95 in (${(corner().x / IN).toFixed(4)})`);
  ok(after.every((f) => Math.abs(f.r - 0.1 * IN) < 1e-6 && f.inner), `four smooth R 0.1 in fillets (${after.map((f) => (f.r / IN).toFixed(3)).join(' / ')})`);
}

// 3. the row: a fillet's tangent row at its shared end. Dense layout: 0 the arc's centre C, 1 the line's far end F, 2 the line's shared end = the
// arc's start A, 3 the arc's end E. The line runs F (0, 0) -> A (8, 0). R = A - C; the arc E = C + (-Ry, Rx) turns 90 degrees counter-clockwise
// from A, so it runs on from the line (smooth) when Ry < 0 (C above the line) and back out of A (a cusp) when Ry > 0.
{
  const tangent = Definitions.tangent;
  const P = { joints: [0, 1, 2], sharedEnd: 'b', fillet: { start: 2, end: 3 } }, OLD = { joints: [0, 1, 2], sharedEnd: 'b' };
  const pose = (rx, ry) => [8 - rx, -ry, 0, 0, 8, 0, 8 - rx - ry, -ry + rx]; // C, F, A, E for R = (rx, ry)
  const val = (pos, p = P) => tangent.computeError(p, Float64Array.from(pos));
  const row = (pos) => { const out = new Float64Array(pos.length); tangent.computeJacobian(P, Float64Array.from(pos), out); return out; };
  ok(Math.abs(val(pose(0, -2))) < 1e-12, `the smooth fillet (C 2 above A) satisfies the row (${val(pose(0, -2))})`);
  const near = pose(0.3, -1.7);
  ok(Object.is(val(near), val(near, OLD)), `on the smooth side the row is the row before task 847 (${val(near)} vs ${val(near, OLD)})`);
  const cusp = pose(0, 2);
  ok(Math.abs(val(cusp, OLD)) < 1e-12, `the cusp (C 2 below A) satisfies the row before task 847 (${val(cusp, OLD)})`);
  ok(Math.abs(val(cusp) - 4) < 1e-12, `the cusp does not satisfy the fillet row (${val(cusp)} = 2 |R| - s, |R| = 2, s = 0)`);
  // never zero on the cusp side: R = 2 (cos a, sin a), 0 < a < 180 degrees
  let least = Infinity;
  for (let k = 1; k < 180; k++) { const a = k * Math.PI / 180; least = Math.min(least, Math.abs(val(pose(2 * Math.cos(a), 2 * Math.sin(a))))); }
  ok(least >= 2 - 1e-9, `no zero on the cusp side (the least |row| over the poses ${least}, |R| = 2)`);
  // continuous where the cusp side begins (C on the line: R along it, either way)
  for (const a0 of [0, Math.PI]) {
    const below = val(pose(2 * Math.cos(a0 - 1e-9), 2 * Math.sin(a0 - 1e-9))), above = val(pose(2 * Math.cos(a0 + 1e-9), 2 * Math.sin(a0 + 1e-9)));
    ok(Math.abs(below - above) < 1e-6, `continuous at ${a0 ? 180 : 0} degrees (${below} vs ${above})`);
  }
  // the derivative, both sides, against central differences (every coordinate, the line's far end and the arc's end included)
  for (const [name, pos] of [['smooth side', near], ['cusp side', pose(0.7, 1.6).map((v, i) => v + 0.01 * i)]]) {
    const J = row(pos);
    let err = 0;
    for (let k = 0; k < pos.length; k++) { const p = pos.slice(), m = pos.slice(); p[k] += 1e-6; m[k] -= 1e-6; err = Math.max(err, Math.abs((val(p) - val(m)) / 2e-6 - J[k])); }
    ok(err < 1e-6, `${name}: the row's derivative matches central differences (worst ${err})`);
  }
}

console.log(`fillet-no-invert-847-node.test.js: ok (${checks} checks)`);
