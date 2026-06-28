// STANDARD constraint conformance battery.
// For EVERY constraint type, two invariants:
//   (1) SOLVE    — from a perturbed start the solver SATISFIES the constraint (geometric residual ~0).
//   (2) DRAG     — a mouse-spring drag on a free joint can NOT break it (the rect-shear fix, generalized
//                  from horizontal/vertical to every type — if `tangent`/`equal`/etc. caves like H/V did,
//                  this catches it on the day we run, not the day the user hits it).
// Built on the harness (sketch.js). Observes only — NO fixes. Reporter, exits 0 (it's a board, not a gate).
//
// Setup convention per pattern: pin the joints that DEFINE the reference, leave ONE joint free that the
// constraint must pin, start it perturbed (constraint initially violated), then drag that free joint
// toward the violating direction. Geometry, not the solver's self-report, is the judge.

import { createSketch } from './sketch.js';
import { CONSTRAINT_TYPES as T } from '#core/constants.js';

const TOL = 0.1;
const near = (a, b, t = TOL) => Math.abs(a - b) <= t;

let CID = 0;
const con = (s, type, joints, extra = {}) =>
  s.engine.addConstraint({ id: 'cc' + (++CID), type, joints: [...joints], ...extra });

const vec = (s, a, b) => { const A = s.pos(a), B = s.pos(b); return { x: B.x - A.x, y: B.y - A.y }; };
const cross = (u, v) => u.x * v.y - u.y * v.x;
const dot = (u, v) => u.x * v.x + u.y * v.y;
const unit = (u) => { const l = Math.hypot(u.x, u.y) || 1e-12; return { x: u.x / l, y: u.y / l }; };
const perp = (s, p, a, b) => { const u = vec(s, a, b), w = vec(s, a, p); return Math.abs(cross(u, w)) / (Math.hypot(u.x, u.y) || 1e-12); };

// each: build(s) → { drag: jointId, dd: [dx,dy], check: () => bool }
const PATTERNS = [
  { name: 'coincident', build(s) { const a = s.point(0, 0, true), b = s.point(5, 5, false); con(s, T.COINCIDENT, [a, b]); return { drag: b, dd: [3, 3], check: () => near(s.pos(a).x, s.pos(b).x) && near(s.pos(a).y, s.pos(b).y) }; } },
  { name: 'horizontal', build(s) { const a = s.point(0, 0, true), b = s.point(10, 5, false); con(s, T.HORIZONTAL, [a, b]); return { drag: b, dd: [0, 4], check: () => near(s.pos(a).y, s.pos(b).y) }; } },
  { name: 'vertical', build(s) { const a = s.point(0, 0, true), b = s.point(5, 10, false); con(s, T.VERTICAL, [a, b]); return { drag: b, dd: [4, 0], check: () => near(s.pos(a).x, s.pos(b).x) }; } },
  { name: 'distance', build(s) { const a = s.point(0, 0, true), b = s.point(6, 0, false); con(s, T.DISTANCE, [a, b], { value: 10 }); return { drag: b, dd: [3, 4], check: () => near(s.edgeLen(a, b), 10) }; } },
  { name: 'point_on_line', build(s) { const A = s.point(0, 0, true), B = s.point(10, 0, true), P = s.point(5, 5, false); con(s, T.POINT_ON_LINE, [P, A, B]); return { drag: P, dd: [0, 4], check: () => near(perp(s, P, A, B), 0) }; } },
  { name: 'midpoint', build(s) { const a = s.point(0, 0, true), b = s.point(10, 0, true), m = s.point(3, 5, false); con(s, T.MIDPOINT, [a, b, m]); return { drag: m, dd: [3, 4], check: () => { const M = s.pos(m), A = s.pos(a), B = s.pos(b); return near(M.x, (A.x + B.x) / 2) && near(M.y, (A.y + B.y) / 2); } }; } },
  { name: 'collinear', build(s) { const A = s.point(0, 0, true), B = s.point(10, 0, true), C = s.point(5, 5, false); con(s, T.COLLINEAR, [A, B, C]); return { drag: C, dd: [0, 4], check: () => near(perp(s, C, A, B), 0) }; } },
  { name: 'parallel', build(s) { const a = s.point(0, 0, true), b = s.point(10, 0, true), c = s.point(0, 5, true), d = s.point(10, 9, false); con(s, T.PARALLEL, [a, b, c, d]); return { drag: d, dd: [0, 4], check: () => near(cross(unit(vec(s, a, b)), unit(vec(s, c, d))), 0) }; } },
  { name: 'perpendicular', build(s) { const a = s.point(0, 0, true), b = s.point(10, 0, true), c = s.point(0, 0, true), d = s.point(3, 5, false); con(s, T.PERPENDICULAR, [a, b, c, d]); return { drag: d, dd: [4, 0], check: () => near(dot(unit(vec(s, a, b)), unit(vec(s, c, d))), 0) }; } },
];

const mark = (b) => (b ? 'PASS ✅' : 'FAIL ❌');
console.log('\n=============== CONSTRAINT CONFORMANCE  (solve · survive-a-drag) ===============');
console.log('  constraint         solve    drag-holds');
console.log('  ----------------------------------------------------------------------------');
let pass = 0;
for (const p of PATTERNS) {
  const s = createSketch();
  const ctx = p.build(s);
  s.solve();
  const solved = !!ctx.check();
  if (ctx.drag) s.drag(ctx.drag, ctx.dd[0], ctx.dd[1]);
  const held = !!ctx.check();
  if (solved && held) pass++;
  console.log(`  ${p.name.padEnd(16)}   ${mark(solved)}   ${mark(held)}`);
}
console.log('  ----------------------------------------------------------------------------');
console.log(`  ${pass}/${PATTERNS.length} constraints conform (satisfied AND survive a drag).`);
console.log('  TODO (need circle/angle setup): equal · angle · tangent · concentric · point-on-circle');
console.log('===============================================================================\n');
// GATING regression guard: if any constraint stops surviving a drag (like H/V did pre-fix), fail the suite.
process.exit(pass === PATTERNS.length ? 0 : 1);
