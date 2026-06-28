// SOLVER SCENARIO TESTER — seeds the harness (./sketch.js) with user-level scenarios, runs them
// against the REAL packages/core, and prints a backlog table labelling each CURRENT pass/fail
// HONESTLY. The 3 known bugs are expected to FAIL today; the table IS the solver fix backlog.
//
// This file is a REPORTER, not a gate: it always exits 0 (so it never adds a baseline failure).
// Fixes come later, one at a time, each guarded by re-running its scenario here.

import { createSketch } from './sketch.js';
import { ConstraintManager } from '#core/constraint-manager.js';
import { CONSTRAINT_TYPES as T } from '#core/constants.js';
import { updateConstraintOffset } from '#app/ui/input-handlers/dimension-tool.js';
import { commitDimensionEdit, toggleDriving } from '#ui/dimension-seams.js';

const rows = [];
function record(name, pass, expected, nums) {
  rows.push({ name, pass, expected, nums });
}
function run(name, expected, fn) {
  try {
    const r = fn();
    record(name, !!r.pass, expected, r.nums || {});
  } catch (e) {
    record(name, false, expected, { ERROR: (e && e.message) ? e.message : String(e) });
  }
}
const f = (v) => (typeof v === 'number' ? (Math.abs(v) < 1e-4 ? '0' : v.toFixed(3)) : String(v));
const numsStr = (n) => Object.entries(n).map(([k, v]) => `${k}=${f(v)}`).join(' ');

// 1 — plain rect, drag a corner → still a rectangle (expect PASS)
run('1. plain rect + drag corner → isRectangle', 'PASS', () => {
  const s = createSketch();
  const r = s.rect(0, 0, 100, 60);
  s.solve();
  s.drag(r.j3, 40, 20);
  return { pass: s.isRectangle(r.corners), nums: { converged: s.converged, conflicts: s.conflicts.length } };
});

// 2 — rect + a dimension on an edge, drag a corner → still a rectangle (expect PASS — the drag fix)
run('2. dimensioned rect + drag corner → isRectangle', 'PASS', () => {
  const s = createSketch();
  const r = s.rect(0, 0, 100, 60);
  s.dimension(r.corners[0], r.corners[1], 100); // width dim on top edge
  s.solve();
  s.drag(r.j3, 40, 20);
  return { pass: s.isRectangle(r.corners), nums: { converged: s.converged, width: s.edgeLen(r.corners[0], r.corners[1]) } };
});

// 3 — over-constrain via an impossible dimension EDIT → must end as a valid, converged rect
//      (refuse+revert, or stay rectangular). Expect FAIL today (ERR-SOLVE-01 + geometry mangled).
run('3. over-constrain edit → refuse + revert to valid rect', 'PASS', () => {
  const s = createSketch();
  const r = s.rect(0, 0, 100, 60);
  s.dimension(r.corners[0], r.corners[1], 100);                 // width = 100 (driving)
  const diagNow = s.edgeLen(r.corners[0], r.corners[2]);
  const diag = s.dimension(r.corners[0], r.corners[2], diagNow); // diagonal (driving, independent)
  s.solve();
  s.editValue(diag, 50); // impossible: diagonal (50) < width (100) — triangle inequality → must be refused
  const refusedOK = s.isRectangle(r.corners) && s.converged === true && diag.value !== 50;
  // a normal IN-RANGE edit must STILL apply (don't over-revert valid edits)
  s.editValue(diag, diagNow + 20); // satisfiable — taller rect
  const validApplied = s.converged === true && s.isRectangle(r.corners) && Math.abs(diag.value - (diagNow + 20)) < 1e-6;
  return {
    pass: refusedOK && validApplied,
    nums: { refusedOK, validApplied, diagAfter: diag.value, converged: s.converged, isRect: s.isRectangle(r.corners), lastError: s.lastError || 'none' },
  };
});

// 4 — dimension an already-dimensioned edge → no silent duplicate DRIVING distance.
//      Two distances on the same edge are only allowed by the code with different dimModes; a 2nd
//      same-mode one is dropped. Either way there must be exactly ONE driver (no 2nd silent driver).
//      Expect FAIL today.
run('4. dimension already-dimensioned edge → one driver', 'PASS', () => {
  const s = createSketch();
  const r = s.rect(0, 0, 100, 60);
  const d1 = s.dimension(r.corners[0], r.corners[1], 100, { dimMode: 'horizontal' }); // D1 driving
  const d2 = s.dimension(r.corners[0], r.corners[1], 100, { dimMode: 'aligned' });    // 2nd dim on the same edge
  s.solve();
  const drivers = s.drivingDistanceCount(r.corners[0], r.corners[1]);
  return {
    pass: drivers === 1 && s.isDriven(d2) === true && s.isDriven(d1) === false && s.converged === true && s.isRectangle(r.corners),
    nums: { drivers, d1driving: !s.isDriven(d1), d2reference: s.isDriven(d2), converged: s.converged, isRect: s.isRectangle(r.corners) },
  };
});

// 4b — toggle a reference dim → driving while ANOTHER dim already drives → SWAP (one driver per edge)
run('4b. toggle ref→driving when another drives → swaps', 'PASS', () => {
  const s = createSketch();
  const r = s.rect(0, 0, 100, 60);
  const d1 = s.dimension(r.corners[0], r.corners[1], 100, { dimMode: 'horizontal' }); // D1 driving
  const d2 = s.dimension(r.corners[0], r.corners[1], 100, { dimMode: 'aligned' });    // D2 reference (one-driver rule)
  const ok = s.setDriving(d2);   // promote D2 → must DEMOTE D1 (swap), never refuse
  const drivers = s.drivingDistanceCount(r.corners[0], r.corners[1]);
  return {
    pass: ok === true && drivers === 1 && s.isDriven(d2) === false && s.isDriven(d1) === true && s.converged === true && s.lastError === null,
    nums: { drivers, d2nowDriving: !s.isDriven(d2), d1nowReference: s.isDriven(d1), converged: s.converged, lastError: s.lastError || 'none' },
  };
});

// 5 — toggle a reference dim → driving, when it is the ONLY would-be driver → should succeed.
//      A single edge dimension, demoted to reference, then promoted back to driving (nothing else
//      drives that edge, so there is no real conflict). Expect FAIL today.
run('5. toggle reference→driving (only would-be driver)', 'PASS', () => {
  const s = createSketch();
  const r = s.rect(0, 0, 100, 60);
  const d1 = s.dimension(r.corners[0], r.corners[1], 100); // D1 driving (the only dim on this edge)
  s.setReference(d1);            // demote to reference
  const wasRef = s.isDriven(d1); // true
  const ok = s.setDriving(d1);   // promote back — it is the sole would-be driver
  return {
    pass: ok === true && s.isDriven(d1) === false && s.lastError === null && s.converged === true,
    nums: { wasReference: wasRef, toggleOk: ok, nowDriving: !s.isDriven(d1), converged: s.converged, lastError: s.lastError || 'none' },
  };
});

// 6 — redundant CROSS-EDGE dimension → reference (and a genuinely-new height still DRIVES)
run('6. redundant cross-edge dimension → reference', 'PASS', () => {
  const s = createSketch();
  const r = s.rect(0, 0, 5, 5);
  const top = s.dimension(r.corners[0], r.corners[1], 5);     // top edge → driver
  const bottom = s.dimension(r.corners[3], r.corners[2], 5);  // opposite edge → REDUNDANT → reference
  const height = s.dimension(r.corners[1], r.corners[2], 5);  // height → NEW info → driver (no over-demote)
  s.solve();
  return {
    // both flags must agree (renderer/solver read isDriven || driven; they must never disagree)
    pass: bottom.isDriven === true && bottom.driven === true &&
          s.isDriven(top) === false && s.isDriven(height) === false &&
          s.converged === true && s.isRectangle(r.corners),
    nums: { bottomIsDriven: bottom.isDriven, bottomDriven: bottom.driven, topDrives: !s.isDriven(top), heightDrives: !s.isDriven(height), converged: s.converged, isRect: s.isRectangle(r.corners) },
  };
});

// 8 — conflicting dimension ADD → KEPT as a driven reference showing the actual value (never removed)
run('8. conflicting dimension ADD → kept as driven reference', 'PASS', () => {
  const s = createSketch();
  const r = s.rect(0, 0, 100, 60);
  s.dimension(r.corners[0], r.corners[1], 100); // top edge = 100 (driving)
  s.solve();
  const before = s.constraintCount;
  const d = s.dimension(r.corners[3], r.corners[2], 50); // bottom = 50 conflicts → kept as a REFERENCE
  const measured = d ? s.edgeLen(d.joints[0], d.joints[1]) : -1;
  return {
    pass: !!d && s.constraintCount === before + 1 && s.isDriven(d) === true && s.converged === true &&
          s.isRectangle(r.corners) && Math.abs(measured - 100) < 0.5 && s.lastError !== null,
    nums: { keptDelta: s.constraintCount - before, isRef: d && s.isDriven(d), measuredActual: measured, converged: s.converged, lastError: s.lastError || 'none' },
  };
});

// 9 — conflicting GEOMETRIC constraint ADD → refuse + revert (not a measurement, so it's removed)
run('9. conflicting GEOMETRIC constraint ADD → refuse + revert', 'PASS', () => {
  const s = createSketch();
  const a = s.point(0, 0, true);   // pinned
  const b = s.point(10, 5, true);  // pinned on a diagonal
  s.solve();
  const before = s.constraintCount;
  // a & b are pinned on a diagonal; forcing the a-b edge HORIZONTAL is unsatisfiable (and not a measurement)
  ConstraintManager.createConstraint(s.state, T.HORIZONTAL, { joints: [a, b] }, { source: 'scenario' });
  s.solve();
  return {
    pass: s.constraintCount === before && s.converged === true && s.lastError !== null,
    nums: { keptDelta: s.constraintCount - before, converged: s.converged, lastError: s.lastError || 'none' },
  };
});

// 10 — a reference is FREE: dragging ignores it and its value tracks the geometry (engine skips driven)
run('10. reference is free — drag ignores it, value tracks', 'PASS', () => {
  const s = createSketch();
  const a = s.point(0, 0, true);
  const b = s.point(10, 0, false);
  const d = s.dimension(a, b, 10);   // driving distance
  s.setReference(d);                  // → reference (driven)
  s.solve();
  const start = s.edgeLen(a, b);      // ~10
  s.drag(b, 18, 0);                   // pull b far — a reference must NOT hold the distance at 10
  const after = s.edgeLen(a, b);
  return {
    pass: s.isDriven(d) === true && start > 8 && start < 12 && after > 22, // geometry free; ref shows `after`
    nums: { isRef: s.isDriven(d), startLen: start, afterLen: after, refShows: after.toFixed(1) },
  };
});

// 11 — APP add path: the placement step (real dimension-tool updateConstraintOffset) must NOT demote a
//      rank-redundant CROSS-edge reference back to a driver (the "renders as driver despite the notice" bug).
run('11. app placement keeps cross-edge reference driven', 'PASS', () => {
  const s = createSketch();
  const r = s.rect(0, 0, 8, 5);
  s.dimension(r.corners[1], r.corners[2], 5);              // RIGHT height (c2-c3) — driver
  const left = s.dimension(r.corners[0], r.corners[3], 5); // LEFT height (c1-c4) — rank-redundant → reference
  // run the exact dimension-tool placement step that used to overwrite isDriven
  try { left.__placing = true; } catch (_) {}
  updateConstraintOffset(s.state, left, { x: -10, y: 2.5 });
  try { left.__placing = false; } catch (_) {}
  s.solve();
  return {
    pass: left.isDriven === true && left.driven === true && s.converged === true,
    nums: { leftIsDriven: left.isDriven, leftDriven: left.driven, drivers: s.drivingDistanceCount(r.corners[0], r.corners[3]), converged: s.converged },
  };
});

// 12 — EDIT seam driven directly: over-constraining edit refuses+reverts; a valid edit applies
run('12. commitDimensionEdit seam — refuse+revert + valid apply', 'PASS', () => {
  const s = createSketch();
  const r = s.rect(0, 0, 100, 60);
  s.dimension(r.corners[0], r.corners[1], 100);
  const diagNow = s.edgeLen(r.corners[0], r.corners[2]);
  const diag = s.dimension(r.corners[0], r.corners[2], diagNow);
  s.solve();
  const bad = commitDimensionEdit(s.state, diag, 50);            // diagonal 50 < width 100 → impossible
  const good = commitDimensionEdit(s.state, diag, diagNow + 20); // satisfiable
  s.solve();
  return {
    pass: bad.reverted === true && !!bad.clash && good.reverted === false &&
          s.isRectangle(r.corners) && s.converged === true && Math.abs(diag.value - (diagNow + 20)) < 1e-6,
    nums: { badReverted: bad.reverted, badClash: bad.clash || 'none', goodApplied: !good.reverted, diagValue: diag.value, isRect: s.isRectangle(r.corners) },
  };
});

// 13 — TOGGLE seam driven directly: flip a reference → driving with the one-driver-per-edge swap
run('13. toggleDriving seam — flip + swap', 'PASS', () => {
  const s = createSketch();
  const r = s.rect(0, 0, 100, 60);
  const d1 = s.dimension(r.corners[0], r.corners[1], 100, { dimMode: 'horizontal' }); // driver
  const d2 = s.dimension(r.corners[0], r.corners[1], 100, { dimMode: 'aligned' });    // reference (one-driver rule)
  const res = toggleDriving(s.state, d2); // promote d2 → swap demotes d1
  s.solve();
  return {
    pass: res.nowDriving === true && res.swapped === true && d2.isDriven === false && d1.isDriven === true && s.converged === true,
    nums: { nowDriving: res.nowDriving, swapped: res.swapped, d2drives: !d2.isDriven, d1ref: d1.isDriven, converged: s.converged },
  };
});

// 14 — toggle seam RANK-REDUNDANCY swap: promoting a redundant CROSS-edge reference demotes the determiner
//      (the toggle-path analogue of #6 — repro: rect right-height driver, promote left-height reference).
run('14. toggleDriving — rank-redundancy cross-edge swap', 'PASS', () => {
  const s = createSketch();
  const r = s.rect(0, 0, 8, 5);
  const right = s.dimension(r.corners[1], r.corners[2], 5); // right height (c2-c3) — driver
  const left = s.dimension(r.corners[0], r.corners[3], 5);  // left height (c1-c4) — redundant → reference
  toggleDriving(s.state, left);                              // promote left → must DEMOTE right (not 2 drivers)
  s.solve();
  const heightDrivers = s.drivingDistanceCount(r.corners[0], r.corners[3]) + s.drivingDistanceCount(r.corners[1], r.corners[2]);
  return {
    pass: left.isDriven === false && right.isDriven === true && heightDrivers === 1 && s.converged === true,
    nums: { leftDrives: !left.isDriven, rightRef: right.isDriven, heightDrivers, converged: s.converged },
  };
});

// 15 — NON-redundant ref→driving toggle still just PROMOTES (no over-demote of an independent driver)
run('15. toggleDriving — non-redundant promote keeps the other driver', 'PASS', () => {
  const s = createSketch();
  const r = s.rect(0, 0, 8, 5);
  const width = s.dimension(r.corners[0], r.corners[1], 8); // width (c1-c2) — driver
  const height = s.dimension(r.corners[1], r.corners[2], 5); // height (c2-c3) — independent driver
  s.setReference(height);          // demote height → reference (width still drives)
  toggleDriving(s.state, height);  // promote height back → independent of width → NO demotion of width
  s.solve();
  return {
    pass: height.isDriven === false && width.isDriven === false && s.converged === true && s.isRectangle(r.corners),
    nums: { heightDrives: !height.isDriven, widthStillDrives: !width.isDriven, converged: s.converged, isRect: s.isRectangle(r.corners) },
  };
});

// 16 — a SATISFIABLE geometric add still APPLIES (don't over-refuse). (Valid-tangent-kept is covered by
//      the tracked tests/tangent-sandbox.test.js, which stays green.)
run('16. satisfiable coincident ADD → applied (not over-refused)', 'PASS', () => {
  const s = createSketch();
  const a = s.point(0, 0, true);  // fixed anchor
  const b = s.point(2, 0, false); // free, near a → coincident is satisfiable (b merges to a)
  s.solve();
  ConstraintManager.createConstraint(s.state, T.COINCIDENT, { joints: [a, b] }, { source: 'scenario' });
  s.solve();
  const kept = s.state.constraints.some(c => c.type === T.COINCIDENT);
  return { pass: kept && s.converged === true && s.edgeLen(a, b) < 0.01, nums: { kept, converged: s.converged, dist: s.edgeLen(a, b) } };
});

// 17 — INFEASIBLE tangent ADD → refuse + revert (center + line pinned so tangency can't be reached)
run('17. infeasible tangent ADD → refuse + revert', 'PASS', () => {
  const s = createSketch();
  const la = s.point(0, 0, true), lb = s.point(0, 100, true); // pinned vertical line at x=0
  s.engine.addShape({ id: 'Li', type: 'line', joints: [la, lb] });
  const cc = s.point(20, 50, true);                           // center PINNED at x=20 (dist 20 != radius 10)
  s.engine.addShape({ id: 'Ci', type: 'circle', joints: [cc], radius: 10 });
  s.solve();
  const before = s.constraintCount;
  ConstraintManager.createConstraint(s.state, T.TANGENT, { shapes: ['Li', 'Ci'] }, { source: 'scenario' });
  s.solve();
  const kept = s.state.constraints.some(c => c.type === T.TANGENT);
  return { pass: !kept && s.constraintCount === before && s.lastError !== null, nums: { kept, delta: s.constraintCount - before, lastError: s.lastError || 'none' } };
});

// 18 — INFEASIBLE coincident ADD (two pinned, distinct joints) → refuse + revert
run('18. infeasible coincident ADD → refuse + revert', 'PASS', () => {
  const s = createSketch();
  const a = s.point(0, 0, true), b = s.point(10, 0, true); // both pinned, distinct → can't coincide
  s.solve();
  const before = s.constraintCount;
  ConstraintManager.createConstraint(s.state, T.COINCIDENT, { joints: [a, b] }, { source: 'scenario' });
  s.solve();
  const kept = s.state.constraints.some(c => c.type === T.COINCIDENT);
  return { pass: !kept && s.constraintCount === before && s.lastError !== null, nums: { kept, delta: s.constraintCount - before, lastError: s.lastError || 'none' } };
});

// 19 — COLLINEAR anchors the established (axis-aligned) line: a V-constrained vertical line made collinear
//      with another line STAYS vertical (the other rotates onto it), even when selected SECOND.
run('19. collinear anchors the established (vertical) line', 'PASS', () => {
  const s = createSketch();
  const a = s.point(0, 0, true), b = s.point(0, 10, false);   // L_vert
  s.engine.addShape({ id: 'Lv', type: 'line', joints: [a, b] });
  ConstraintManager.createConstraint(s.state, T.VERTICAL, { joints: [a, b] }, { source: 'scenario' });
  const c = s.point(5, 5, false), d = s.point(15, 7, false);  // L_other (free, sloped)
  s.engine.addShape({ id: 'Lo', type: 'line', joints: [c, d] });
  s.solve();
  // select the OTHER line FIRST (the order that used to drag the vertical to ~45 / false-converge)
  ConstraintManager.createConstraint(s.state, T.COLLINEAR, { shapes: ['Lo', 'Lv'] }, { source: 'scenario' });
  s.solve();
  const vAngle = Math.abs(Math.atan2(s.pos(b).y - s.pos(a).y, s.pos(b).x - s.pos(a).x) * 180 / Math.PI);
  const oAngle = Math.abs(Math.atan2(s.pos(d).y - s.pos(c).y, s.pos(d).x - s.pos(c).x) * 180 / Math.PI);
  return {
    pass: Math.abs(vAngle - 90) < 1 && Math.abs(oAngle - 90) < 1 && s.converged === true,
    nums: { vertAngle: vAngle.toFixed(1), otherAngle: oAngle.toFixed(1), converged: s.converged },
  };
});

// 20 — FREEHAND (unconstrained) vertical + angled line → collinear anchors the vertical in BOTH orders
//      (geometric axis-alignment, no V constraint). A vertical line must not change angle.
function freehandCollinear(order) {
  const s = createSketch();
  const a = s.point(0, 0, true), b = s.point(0, 10, false); // freehand vertical — NO V constraint
  s.engine.addShape({ id: 'Lv', type: 'line', joints: [a, b] });
  const c = s.point(5, 5, false), d = s.point(15, 7, false); // angled
  s.engine.addShape({ id: 'Lo', type: 'line', joints: [c, d] });
  s.solve();
  const shapes = order === 'vert-first' ? ['Lv', 'Lo'] : ['Lo', 'Lv'];
  ConstraintManager.createConstraint(s.state, T.COLLINEAR, { shapes }, { source: 'scenario' });
  s.solve();
  const vAngle = Math.abs(Math.atan2(s.pos(b).y - s.pos(a).y, s.pos(b).x - s.pos(a).x) * 180 / Math.PI);
  return { s, vAngle };
}
run('20. freehand vertical + angled collinear → vertical anchored (both orders)', 'PASS', () => {
  const vf = freehandCollinear('vert-first');
  const of = freehandCollinear('other-first');
  return {
    pass: Math.abs(vf.vAngle - 90) < 1 && vf.s.converged === true &&
          Math.abs(of.vAngle - 90) < 1 && of.s.converged === true,
    nums: { vertFirstAngle: vf.vAngle.toFixed(1), otherFirstAngle: of.vAngle.toFixed(1), vfConv: vf.s.converged, ofConv: of.s.converged },
  };
});

// 21 — COLLINEAR of a vertical + a horizontal line (perpendicular) → REFUSED (not added, both keep angle)
run('21. collinear of perpendicular axis-aligned lines → refused', 'PASS', () => {
  const s = createSketch();
  const a = s.point(0, 0, true), b = s.point(0, 10, false);  // vertical
  s.engine.addShape({ id: 'Lv', type: 'line', joints: [a, b] });
  const c = s.point(5, 5, false), d = s.point(15, 5, false); // horizontal
  s.engine.addShape({ id: 'Lh', type: 'line', joints: [c, d] });
  s.solve();
  const before = s.constraintCount;
  const res = ConstraintManager.createConstraint(s.state, T.COLLINEAR, { shapes: ['Lv', 'Lh'] }, { source: 'scenario' });
  s.solve();
  const vAngle = Math.abs(Math.atan2(s.pos(b).y - s.pos(a).y, s.pos(b).x - s.pos(a).x) * 180 / Math.PI);
  const hAngle = Math.abs(Math.atan2(s.pos(d).y - s.pos(c).y, s.pos(d).x - s.pos(c).x) * 180 / Math.PI);
  const kept = s.state.constraints.some(co => co.type === T.COLLINEAR);
  return {
    pass: res === null && !kept && s.constraintCount === before && Math.abs(vAngle - 90) < 1 && hAngle < 1 && s.lastError !== null,
    nums: { refused: res === null, kept, vertAngle: vAngle.toFixed(1), horizAngle: hAngle.toFixed(1), lastError: s.lastError || 'none' },
  };
});

// 22 — center a (free) rect on the origin: midpoint(diagonal)=center, then COINCIDENT(center, origin).
//      The completed midpoint Jacobian lets the coincident TRANSLATE the rect (was wrongly rejected).
run('22. center a rect on origin (midpoint + coincident)', 'PASS', () => {
  const s = createSketch();
  const r = s.rect(50, 30, 20, 14, { pinFirst: false }); // free rect — can translate
  const center = s.point(60, 37, false);                 // = midpoint of the diagonal c1-c3
  ConstraintManager.createConstraint(s.state, T.MIDPOINT, { joints: [r.corners[0], r.corners[2], center] }, { source: 'scenario' });
  s.solve();
  const res = ConstraintManager.createConstraint(s.state, T.COINCIDENT, { joints: [center, 'j_origin'] }, { source: 'scenario' });
  s.solve();
  const cdist = Math.hypot(s.pos(center).x, s.pos(center).y);
  return {
    pass: !!res && cdist < 0.05 && s.isRectangle(r.corners) && s.converged === true,
    nums: { accepted: !!res, centerDist: cdist.toFixed(3), isRect: s.isRectangle(r.corners), converged: s.converged },
  };
});

// BRIDGE — serialize → load → solve round-trip (proves s.load replays a real exported sketch)
run('bridge: serialize → load → solve round-trip', 'PASS', () => {
  const a = createSketch();
  const ra = a.rect(0, 0, 80, 50);
  a.dimension(ra.corners[0], ra.corners[1], 80);
  a.solve();
  const model = a.serialize();
  const b = createSketch();
  b.load(model);
  b.solve();
  return {
    pass: b.constraintCount === a.constraintCount && b.isRectangle(ra.corners),
    nums: { constraints: b.constraintCount, converged: b.converged, isRect: b.isRectangle(ra.corners) },
  };
});

// ── REPORT ────────────────────────────────────────────────────────────────────
const w = Math.max(...rows.map(r => r.name.length));
console.log('\n========================= SOLVER SCENARIO BACKLOG =========================');
console.log(`  ${'scenario'.padEnd(w)}  result  (expected)`);
console.log('  ' + '-'.repeat(w + 22));
for (const r of rows) {
  const tag = r.pass ? 'PASS ✅' : 'FAIL ❌';
  console.log(`  ${r.name.padEnd(w)}  ${tag}  (${r.expected})`);
  console.log(`  ${' '.repeat(w)}    └─ ${numsStr(r.nums)}`);
}
const failing = rows.filter(r => !r.pass).map(r => r.name);
console.log('  ' + '-'.repeat(w + 22));
console.log(`  ${rows.filter(r => r.pass).length}/${rows.length} pass. FIX BACKLOG (failing): ${failing.length ? failing.map(n => n.split('.')[0]).join(', ') : 'none'}`);
console.log('===========================================================================\n');

// Reporter: never fail the suite — the table above is the deliverable. (exit 0)
