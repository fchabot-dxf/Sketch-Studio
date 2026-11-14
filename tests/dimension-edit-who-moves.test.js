// tests/dimension-edit-who-moves.test.js - TASK 611: typing a new value into a dimension moves what Fusion moves, and nothing else.
// FUSION (measured by task 611 with the real mouse in Fusion 2706.1.17: a new unsaved document, the sketch built through the API, the value typed into
// the dimension's own box after a real double-click, Enter; cm, here mm = cm x 10; .evidence/611/fusion-read-*.json, docs/FUSION-COMPARISON.md
// "Dimension edit: what moves (task 611)"):
//   C1  free CONSTRUCTION line K x = 0 (0,-10)-(0,50); A (0,40)->(-30,40) horizontal, its start on K, length 30 -> 40: A's END moves to (-40,40); K, A's start stay
//   C2  C1 + B (-30,40)->(-30,10) vertical sharing A's end + a circle, mirrored about K (Fusion's 4 symmetries): A's end and B move by -10 in x, the copy follows
//       (+10), K and both circles stay
//   C3  C1 with K a NORMAL line: the same as C1
//   C4  C1 without the horizontal (A to (-30,30)), length 31.62 -> 40: A's end slides along A to (-37.947,27.351); K, A's start stay
//   C5  point-to-line distance from free line A's start (-10,20) to free line L x = 0, 10 -> 20: L moves (+10 in x), A stays
//   C6  angle between free L and free A (A's start on L), 90 -> 60 degrees: L stays, A moves (both ends; the distribution differs, see below)
//   C7  A (0,40)->(-30,40) horizontal between free L1 x = 0 and free L2 x = -30 (an end on each), 30 -> 40: Fusion TRANSLATES both lines (+5.556, -4.444)
//   C8  C7 without the horizontal (A to (-30,30)), 31.62 -> 40: A's end slides down L2 to (-30,13.542); both lines and A's start stay
//   R1 / R4 / R8  C1 / C4 / C8 with the dimension picked END FIRST: the same answers (the pick order does not decide)
//   R9  C1 drawn the other way (A (-30,40)->(0,40), its END on K): A's free START moves to (-40,40)
// Rule (packages/core/creation-placement.js editGiver + solveGivingWay): the operand that gives way moves (two points of one line: the point NOT attached
// to other geometry; both attached: the line's end point; two bodies: the who-moves table; a point-to-line distance: the point-on-line ranking), with
// what must follow it; the rest is held.
// Ours differs from Fusion (reported): C6 A's two ends share the turn differently (ours (0,12.132)/(-27.256,27.868), Fusion (0,14.804)/(-24.75,29.093));
// C7 ours keeps L1 and A's start and turns L2 through (-40,40), Fusion translates both lines.
import assert from 'node:assert';
import * as L from './harness/audit/lib.js';
import { ConstraintManager } from '#core/constraint-manager.js';
import { commitDimensionEdit } from '#ui/dimension-seams.js';
import { mirrorObjects } from '#core/mirror.js';
import { measureResidual } from '#core/constraint-verifier.js';

let checks = 0;
const failures = [];   // every cell is checked; the failures are listed together at the end
const ok = (cond, msg) => { if (cond) checks++; else failures.push(msg); };
const TOL = 1e-6;
const mk = (S, type, p) => { assert.ok(ConstraintManager.createConstraint(S.state, type, p, { source: 'test' }), 'created ' + type); return S.state.constraints[S.state.constraints.length - 1]; };
const lenA = Math.hypot(30, 10);

// the cells, built through the tools' own core calls (mm); each returns its named points, the dimension and the new value
const CELLS = {
  C1: (S, construction = true) => {
    const k0 = L.point(S, 0, -10), k1 = L.point(S, 0, 50), K = L.line(S, k0, k1, construction);
    const a0 = L.point(S, 0, 40), a1 = L.point(S, -30, 40); L.line(S, a0, a1);
    mk(S, 'horizontal', { joints: [a0, a1] }); mk(S, 'pointOnLine', { joint: a0, shape: K });
    return { pts: { Ks: k0, Ke: k1, As: a0, Ae: a1 }, dim: mk(S, 'distance', { joints: [a0, a1], value: 30 }), to: 40 };
  },
  C2: (S) => {
    const k0 = L.point(S, 0, -10), k1 = L.point(S, 0, 50), K = L.line(S, k0, k1, true);
    const [A, B] = L.polyline(S, [[0, 40], [-30, 40], [-30, 10]], false);
    mk(S, 'pointOnLine', { joint: A.a, shape: K }); mk(S, 'horizontal', { joints: [A.a, A.b] }); mk(S, 'vertical', { joints: [B.a, B.b] });
    const C = L.circle(S, -15, 20, 5);
    const dim = mk(S, 'distance', { joints: [A.a, A.b], value: 30 }); mk(S, 'distance', { shape: C.id, value: 5, isRadius: true });
    const n0 = S.state.shapes.length;
    const r = mirrorObjects(S.state, { shapes: [A.id, B.id, C.id], joints: [] }, K);
    assert.ok(r.ok, 'mirrored');
    const [a2, b2, c2] = S.state.shapes.slice(n0);
    return { pts: { Ks: k0, Ke: k1, As: A.a, Ae: A.b, Bs: B.a, Be: B.b, Cc: C.c, A2s: a2.joints[0], A2e: a2.joints[1], B2e: b2.joints[1], C2c: c2.joints[0] }, circles: { C: C.id, C2: c2.id }, dim, to: 40 };
  },
  C3: (S) => CELLS.C1(S, false),
  C4: (S) => {
    const k0 = L.point(S, 0, -10), k1 = L.point(S, 0, 50), K = L.line(S, k0, k1, true);
    const a0 = L.point(S, 0, 40), a1 = L.point(S, -30, 30); L.line(S, a0, a1);
    mk(S, 'pointOnLine', { joint: a0, shape: K });
    return { pts: { Ks: k0, Ke: k1, As: a0, Ae: a1 }, dim: mk(S, 'distance', { joints: [a0, a1], value: lenA }), to: 40 };
  },
  C5: (S) => {
    const l0 = L.point(S, 0, -10), l1 = L.point(S, 0, 50); L.line(S, l0, l1);
    const a0 = L.point(S, -10, 20), a1 = L.point(S, -40, 30); L.line(S, a0, a1);
    return { pts: { Ls: l0, Le: l1, As: a0, Ae: a1 }, dim: mk(S, 'distance', { joints: [a0, l0, l1], value: 10 }), to: 20 };
  },
  C6: (S) => {
    const l0 = L.point(S, 0, -10), l1 = L.point(S, 0, 50), Ll = L.line(S, l0, l1);
    const a0 = L.point(S, 0, 20), a1 = L.point(S, -30, 20), A = L.line(S, a0, a1);
    mk(S, 'pointOnLine', { joint: a0, shape: Ll });
    return { pts: { Ls: l0, Le: l1, As: a0, Ae: a1 }, dim: mk(S, 'angle', { shapes: [Ll, A], value: L.measure(S, { type: 'angle', shapes: [Ll, A] }) }), to: 60 };
  },
  C7: (S, h = true) => {
    const p0 = L.point(S, 0, -10), p1 = L.point(S, 0, 50), L1 = L.line(S, p0, p1);
    const q0 = L.point(S, -30, -10), q1 = L.point(S, -30, 50), L2 = L.line(S, q0, q1);
    const a0 = L.point(S, 0, 40), a1 = L.point(S, -30, h ? 40 : 30); L.line(S, a0, a1);
    if (h) mk(S, 'horizontal', { joints: [a0, a1] });
    mk(S, 'pointOnLine', { joint: a0, shape: L1 }); mk(S, 'pointOnLine', { joint: a1, shape: L2 });
    return { pts: { L1s: p0, L1e: p1, L2s: q0, L2e: q1, As: a0, Ae: a1 }, dim: mk(S, 'distance', { joints: [a0, a1], value: h ? 30 : lenA }), to: 40 };
  },
  C8: (S) => CELLS.C7(S, false),
  R1: (S) => endFirst(S, CELLS.C1(S)),
  R4: (S) => endFirst(S, CELLS.C4(S)),
  R8: (S) => endFirst(S, CELLS.C8(S)),
  R9: (S) => {
    const k0 = L.point(S, 0, -10), k1 = L.point(S, 0, 50), K = L.line(S, k0, k1, true);
    const a0 = L.point(S, -30, 40), a1 = L.point(S, 0, 40); L.line(S, a0, a1);
    mk(S, 'horizontal', { joints: [a0, a1] }); mk(S, 'pointOnLine', { joint: a1, shape: K });
    return { pts: { Ks: k0, Ke: k1, As: a0, Ae: a1 }, dim: mk(S, 'distance', { joints: [a0, a1], value: 30 }), to: 40 };
  },
};
// the same cell with its length dimension picked END first (the Dimension tool's pick order is the joints' order)
function endFirst(S, cell) {
  S.state.constraints.splice(S.state.constraints.indexOf(cell.dim), 1);
  return { ...cell, dim: mk(S, 'distance', { joints: [cell.dim.joints[1], cell.dim.joints[0]], value: cell.dim.value }) };
}

// Fusion's answer per cell (mm): every named point after the edit. Points not listed for C6 / C7 are checked separately (the reported divergences).
const sq = (x) => x * x;
const C4END = { x: -40 * 30 / lenA, y: 40 - 40 * 10 / lenA };   // A's start + 40 along A's direction: Fusion (-37.94733, 27.35089)
const C8END = { x: -30, y: 40 - Math.sqrt(sq(40) - sq(30)) };  // A's end down L2 at length 40: Fusion (-30, 13.54249)
const KSTAY = { Ks: { x: 0, y: -10 }, Ke: { x: 0, y: 50 } };
const FUSION = {
  C1: { ...KSTAY, As: { x: 0, y: 40 }, Ae: { x: -40, y: 40 } },
  C2: { ...KSTAY, As: { x: 0, y: 40 }, Ae: { x: -40, y: 40 }, Bs: { x: -40, y: 40 }, Be: { x: -40, y: 10 }, Cc: { x: -15, y: 20 }, A2s: { x: 0, y: 40 }, A2e: { x: 40, y: 40 }, B2e: { x: 40, y: 10 }, C2c: { x: 15, y: 20 } },
  C3: { ...KSTAY, As: { x: 0, y: 40 }, Ae: { x: -40, y: 40 } },
  C4: { ...KSTAY, As: { x: 0, y: 40 }, Ae: C4END },
  C5: { Ls: { x: 10, y: -10 }, Le: { x: 10, y: 50 }, As: { x: -10, y: 20 }, Ae: { x: -40, y: 30 } },
  C6: { Ls: { x: 0, y: -10 }, Le: { x: 0, y: 50 } },
  C8: { L1s: { x: 0, y: -10 }, L1e: { x: 0, y: 50 }, L2s: { x: -30, y: -10 }, L2e: { x: -30, y: 50 }, As: { x: 0, y: 40 }, Ae: C8END },
  R1: { ...KSTAY, As: { x: 0, y: 40 }, Ae: { x: -40, y: 40 } },
  R4: { ...KSTAY, As: { x: 0, y: 40 }, Ae: C4END },
  R8: { L1s: { x: 0, y: -10 }, L1e: { x: 0, y: 50 }, L2s: { x: -30, y: -10 }, L2e: { x: -30, y: 50 }, As: { x: 0, y: 40 }, Ae: C8END },
  R9: { ...KSTAY, As: { x: -40, y: 40 }, Ae: { x: 0, y: 40 } },
};

const fmt = (p) => `(${p.x.toFixed(4)},${p.y.toFixed(4)})`;
for (const name of Object.keys(CELLS)) {
  const S = L.newSketch();
  const cell = CELLS[name](S);
  const J = (k) => S.state.joints.get(cell.pts[k]);
  const res = commitDimensionEdit(S.state, cell.dim, cell.to);
  ok(!res.reverted, `${name}: the edit to ${cell.to} is accepted ${JSON.stringify(res)}`);
  ok(cell.dim.value === cell.to && measureResidual(cell.dim, S.state.joints, S.state.shapes) <= TOL, `${name}: the dimension is ${cell.to} and holds`);
  ok(L.residuals(S).max <= TOL, `${name}: every constraint holds (worst ${L.residuals(S).max})`);
  for (const [k, want] of Object.entries(FUSION[name] || {})) {
    const got = J(k);
    ok(Math.hypot(got.x - want.x, got.y - want.y) <= TOL, `${name}: ${k} at ${fmt(got)}, Fusion ${fmt(want)}`);
  }
  if (cell.circles) for (const id of Object.values(cell.circles)) ok(Math.abs(L.shape(S, id).radius - 5) <= TOL, `${name}: circle ${id} keeps r 5`);
  if (name === 'C6') {
    // Fusion's operand: A moves (both ends: its start slides down L), L stays (asserted above). Ours and Fusion share the turn differently.
    ok(Math.abs(J('As').x) <= TOL && J('As').y < 20 && J('Ae').y > 20, `C6: A turns, its start sliding down L: A ${fmt(J('As'))} ${fmt(J('Ae'))} (Fusion (0,14.804) (-24.750,29.093))`);
  }
  if (name === 'C7') {
    // Fusion translates both lines (A stays at y = 40); ours keeps L1 and A's start and turns L2 through A's end (-40,40): A at y = 40 like Fusion
    ok(Math.abs(J('As').y - 40) <= TOL && Math.abs(J('Ae').y - 40) <= TOL, `C7: A stays at y = 40 (Fusion's): ${fmt(J('As'))} ${fmt(J('Ae'))}`);
    ok(Math.hypot(J('L1s').x, J('L1s').y + 10) <= TOL && Math.hypot(J('L1e').x, J('L1e').y - 50) <= TOL && Math.hypot(J('As').x, J('As').y - 40) <= TOL,
      `C7 (ours, a reported divergence: Fusion moves L1 by +5.556): L1 and A's start stay`);
  }
  console.log(`${name}: ${Object.keys(cell.pts).map((k) => k + ' ' + fmt(J(k))).join('  ')}`);
}
if (failures.length) { console.error(`dimension-edit-who-moves FAILED (${failures.length}):` + failures.map((f) => '\n  ' + f).join('')); process.exit(1); }
console.log(`dimension-edit-who-moves: ${checks} checks ok`);
