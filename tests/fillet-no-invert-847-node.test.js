// tests/fillet-no-invert-847-node.test.js -- TASK 847 (part B): a FILLET arc never turns inside out in a solve.
// Task 846's case (838's showcase panel): a 0.3 x 0.7 in vent slot, its corners filleted R 0.1 in, the four fillet radius dimensions DELETED (free
// radii), then its position dimension changed 4.3 -> 3.95 in. The solve took the 0.35 in move into the free radii: 0.052 / 0.064 / 0.298 / 0.324 in,
// and two fillets crossed through zero radius to the OUTSIDE of their corners (centre outside the slot, the line running into the arc and the arc
// running back out: a cusp), the loop crossing itself (846: D-shaped in 2D, no cut in 3D).
// THE rule (#core/solver/engine.js _filletTurnedOut, _resultValid, _keepsFillets): a result that turns out a fillet that was smooth at the solve's
// start is no solution. The solve tries once more from the start, refusing every step that would turn a fillet out; a smooth answer found then
// is kept, else the solve ends not converged (or, if even that end turns one out, rejected: nothing moves). Here no answer keeps the fillets
// smooth (the free radii are the cheapest unknowns to move, and every way they take the move crosses one through zero), so the edit is REFUSED
// (the existing plain line: "conflicts with ...") and the slot and its four R 0.1 fillets stay exactly as they were. With the radius
// dimensions kept, the same edit moves the slot (846's keepR).
import assert from 'node:assert';
import * as L from './harness/audit/lib.js';
import * as ops from '#core/tool-ops.js';
import { commitDimensionEdit } from '#core/dimension-seams.js';

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

// 3. the rule itself, on a plain solve (no edit walk, no giving way): the 0.35 in move solved at once from the pose before it. origin/main's solve
// put two fillets outside their corners and called it converged (error 6.4e-7). Now that result is invalid: the solve tries once more from the
// start refusing every step that turns a fillet out, finds no answer that keeps them smooth, and says so (not converged); every fillet stays
// smooth with a positive radius.
{
  const { S, dx, fil, corner } = build({ keepRadii: false });
  dx.value = 3.95 * IN;
  const res = quiet(() => S.engine.solve(L.ITER));
  const after = fillets(S, fil, { x: corner().x + 0.15 * IN, y: 4.65 * IN });
  console.log(`plain solve of the move: converged ${res.converged}, error ${res.error.toExponential(2)}; fillets ${after.map((f) => 'R ' + (f.r / IN).toFixed(3) + (f.inner ? '' : ' INVERTED')).join(' / ')}`);
  ok(res.converged === false, `the move cannot be solved with the fillets smooth: not converged (${JSON.stringify({ converged: res.converged, rejected: res.rejected })})`);
  ok(after.every((f) => f.inner && f.r > 0), `and no fillet turned out (${after.map((f) => (f.r / IN).toFixed(3) + (f.inner ? '' : ' inverted')).join(' / ')})`);
}

// 4. an edit the fillets can follow is kept as before: the same slot, radii free, its width edited 0.3 -> 0.5 in. (Where origin/main's first
// result turned a fillet out but a smooth answer exists, the second try finds it: task 486's fillet-corner-dimension-drives, its top width
// 40 -> 15.7 between two filleted corners, origin/main kept the right fillet turned out; now both stay smooth.)
{
  const { S, fil, corner } = build({ keepRadii: false });
  const w = S.state.constraints.find((c) => c.type === 'distance' && c.dimMode === 'horizontal' && Math.abs(c.value - 0.3 * IN) < 1e-9);
  const res = quiet(() => commitDimensionEdit(S.state, w, 0.5 * IN));
  const after = fillets(S, fil, { x: corner().x + 0.25 * IN, y: 4.65 * IN });
  ok(!res.reverted, `free radii, width 0.3 -> 0.5 in: the edit is kept (${JSON.stringify(res)})`);
  ok(after.every((f) => f.inner && f.r > 0), `every fillet smooth (${after.map((f) => (f.r / IN).toFixed(3) + (f.inner ? '' : ' inverted')).join(' / ')})`);
}

console.log(`fillet-no-invert-847-node.test.js: ok (${checks} checks)`);
