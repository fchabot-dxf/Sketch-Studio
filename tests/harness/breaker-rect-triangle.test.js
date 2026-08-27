// BREAKER probe — advisor-authored, adversarial coverage ONLY. Written independently of the
// worker's live-click repro to triangulate: does the REAL #core engine (not the browser UI) already
// mishandle "draw + dimension + constrain + drag" for the two canonical shapes the user named
// (rectangle, triangle)? If this fails, the bug is in packages/core (solver/constraint-manager).
// If this passes but the live app still misbehaves, the bug is in the apps/sketchstudio UI/interaction
// wiring, not the math. Either way this narrows the worker's search — it does not replace it.
//
// Differences from tests/harness/solver-scenarios.test.js (deliberately, to cover new ground):
//  - a TRIANGLE built the way line-tool.js actually builds a closed polyline: 3 independent lines,
//    6 distinct joints, closed via 3 explicit COINCIDENT constraints (NOT shared joint indices) —
//    see line-tool.js:353 `addConstraint(..., COINCIDENT, { joints: [endId, nearby] })`.
//  - drags applied as a SEQUENCE of small incremental steps (like real mousemove events), not one
//    big jump — checks the solver stays stable frame-to-frame, not just at a single endpoint.
//  - an EQUAL constraint on the triangle (isoceles) stacked with SSS-style dimensioning.
//  - a redundant 3rd rectangle dimension (over-constrain) verified to refuse/reference, THEN an
//    incremental drag afterward (does the reference dimension stay live-reading, not stale).

import { createSketch } from './sketch.js';
import { CONSTRAINT_TYPES } from '#core/constants.js';

const failures = [];
function check(label, cond, detail) {
  if (!cond) failures.push(`${label}${detail ? ' — ' + detail : ''}`);
  console.log(cond ? `  ok   ${label}` : `  FAIL ${label}${detail ? ' — ' + detail : ''}`);
}

function incrementalDrag(s, jointId, totalDx, totalDy, steps = 20) {
  const stepDx = totalDx / steps, stepDy = totalDy / steps;
  let last;
  for (let i = 0; i < steps; i++) last = s.drag(jointId, stepDx, stepDy);
  return last;
}

// ── SCENARIO 1: rectangle, fully dimensioned, dragged incrementally, edited, over-constrained ──
console.log('\n=== Rectangle: dimension + incremental drag + edit + over-constrain ===');
{
  const s = createSketch();
  const r = s.rect(0, 0, 100, 60);
  const [c1, c2, c3, c4] = r.corners;

  const dW = s.dimension(c1, c2, 100); // width (top edge)
  const dH = s.dimension(c2, c3, 60);  // height (right edge)
  check('R1 both dimensions attached as driving', s.isDriven(dW) === false && s.isDriven(dH) === false,
    `dW.driven=${s.isDriven(dW)} dH.driven=${s.isDriven(dH)}`);
  check('R1 solve converged after dimensioning', s.converged === true, JSON.stringify(s.conflicts));
  check('R1 is still a rectangle after dimensioning', s.isRectangle(r.corners));
  check('R1 width matches dimension', Math.abs(s.edgeLen(c1, c2) - 100) < 0.05, `got ${s.edgeLen(c1, c2)}`);
  check('R1 height matches dimension', Math.abs(s.edgeLen(c2, c3) - 60) < 0.05, `got ${s.edgeLen(c2, c3)}`);

  // Drag the far corner (c3) diagonally by a large amount, in small steps (like real mouse moves).
  incrementalDrag(s, c3, 40, 25, 25);
  check('R1 stays a rectangle after incremental drag', s.isRectangle(r.corners));
  check('R1 solve still converged after drag', s.converged === true, JSON.stringify(s.conflicts));
  // A drag on a fully-dimensioned rect should NOT change the dimensioned lengths — the drag is a
  // weak spring; the driving dimensions are structural and must win.
  check('R1 width UNCHANGED by drag (structural beats mouse-spring)', Math.abs(s.edgeLen(c1, c2) - 100) < 0.5,
    `got ${s.edgeLen(c1, c2)} (expected ~100)`);
  check('R1 height UNCHANGED by drag (structural beats mouse-spring)', Math.abs(s.edgeLen(c2, c3) - 60) < 0.5,
    `got ${s.edgeLen(c2, c3)} (expected ~60)`);

  // Edit the width dimension's value via the real edit seam, then drag again.
  s.editValue(dW, 150);
  check('R1 edit-value applied', Math.abs(s.edgeLen(c1, c2) - 150) < 0.05, `got ${s.edgeLen(c1, c2)}`);
  check('R1 still a rectangle after edit', s.isRectangle(r.corners));
  incrementalDrag(s, c1, -10, -10, 10);
  check('R1 stays a rectangle after post-edit drag', s.isRectangle(r.corners));
  check('R1 width still 150 after post-edit drag', Math.abs(s.edgeLen(c1, c2) - 150) < 0.5,
    `got ${s.edgeLen(c1, c2)}`);

  // Over-constrain: a 3rd, redundant distance on the OTHER pair of parallel edges (bottom + left),
  // both already implied by the two driving dims + H/V. Should become a REFERENCE, not corrupt geometry,
  // per the "rectangle-or-refuse" invariant.
  const dBottom = s.dimension(c4, c3, 999); // deliberately wrong value — should NOT force the shape to 999
  check('R1 redundant 3rd dimension did NOT distort the rectangle',
    Math.abs(s.edgeLen(c4, c3) - 150) < 0.5, `got ${s.edgeLen(c4, c3)} (expected ~150, NOT 999)`);
  check('R1 redundant 3rd dimension is a REFERENCE (not driving)', s.isDriven(dBottom) === true,
    `isDriven=${s.isDriven(dBottom)}`);
  check('R1 still a rectangle after redundant dimension add', s.isRectangle(r.corners));

  // Drag again after the reference exists. NOTE: the constraint's stored `.value` (999) stays frozen
  // by design — svg-renderer.js reads LIVE geometry for a driven/reference dimension's displayed
  // label (valToShow = isDrivenFlag ? liveLen : c.value), and dimension-seams.js's toggleDriving()
  // re-syncs `.value` from live geometry the moment a reference is promoted back to driving. So the
  // frozen internal `.value` is correct, verified-safe bookkeeping, NOT a display bug — confirmed by
  // reading both call sites rather than assuming. This check asserts the CONTRACT that actually
  // matters: the live geometry (what gets rendered) still tracks the real shape after the drag.
  incrementalDrag(s, c2, 5, 0, 10);
  const liveBottom = s.edgeLen(c4, c3);
  check('R1 reference edge LIVE geometry (what the renderer shows) tracks the real shape, not the stale 999',
    Math.abs(liveBottom - 150) < 1, `live geometry=${liveBottom} (expected ~150, NOT 999)`);
}

// ── SCENARIO 2: triangle, built the way line-tool.js really builds one (separate joints + explicit
//    coincident closes), SSS-dimensioned, EQUAL leg constraint, dragged incrementally ──
console.log('\n=== Triangle: real line-tool topology + SSS dimension + EQUAL + incremental drag ===');
{
  const s = createSketch();
  const { state, engine } = s;

  // Three independent lines, as line-tool.js draws them (fresh joints per segment).
  const l1 = s.line(0, 0, 100, 0);     // base:  p0(0,0) -> p1(100,0)
  const l2 = s.line(100, 0, 60, 80);   // right: p2(100,0)-> p3(60,80)
  const l3 = s.line(60, 80, 0, 0);     // left:  p4(60,80)-> p5(0,0)

  // Pin the base's origin (matches rect()'s pinFirst convention — removes translation DOF for a
  // deterministic solve; a real drawn sketch isn't pinned, but scenario needs SOME anchor).
  state.joints.get(l1.a).fixed = true;

  // Close the triangle with the SAME mechanism the real tool uses: explicit coincident constraints
  // between the separate endpoint joints, not shared indices.
  const CC = CONSTRAINT_TYPES.COINCIDENT;
  const { ConstraintManager } = await import('#core/constraint-manager.js');
  ConstraintManager.createConstraint(state, CC, { joints: [l1.b, l2.a] }, { source: 'close' });
  ConstraintManager.createConstraint(state, CC, { joints: [l2.b, l3.a] }, { source: 'close' });
  ConstraintManager.createConstraint(state, CC, { joints: [l3.b, l1.a] }, { source: 'close' });
  s.solve();

  const coincidentGap = (a, b) => s.edgeLen(a, b);
  check('T1 corner 1 coincident after closing', coincidentGap(l1.b, l2.a) < 0.05, `gap=${coincidentGap(l1.b, l2.a)}`);
  check('T1 corner 2 coincident after closing', coincidentGap(l2.b, l3.a) < 0.05, `gap=${coincidentGap(l2.b, l3.a)}`);
  check('T1 corner 3 coincident after closing', coincidentGap(l3.b, l1.a) < 0.05, `gap=${coincidentGap(l3.b, l1.a)}`);

  // SSS dimension all three sides.
  const dBase = s.dimension(l1.a, l1.b, 100);
  const dRight = s.dimension(l2.a, l2.b, 90);
  const dLeft = s.dimension(l3.a, l3.b, 90);
  check('T1 solve converged after SSS dimensioning', s.converged === true, JSON.stringify(s.conflicts));
  check('T1 base length matches', Math.abs(s.edgeLen(l1.a, l1.b) - 100) < 0.1, `got ${s.edgeLen(l1.a, l1.b)}`);
  check('T1 right length matches', Math.abs(s.edgeLen(l2.a, l2.b) - 90) < 0.1, `got ${s.edgeLen(l2.a, l2.b)}`);
  check('T1 left length matches', Math.abs(s.edgeLen(l3.a, l3.b) - 90) < 0.1, `got ${s.edgeLen(l3.a, l3.b)}`);
  check('T1 corners STILL coincident after SSS dimensioning (no gap opened)',
    coincidentGap(l1.b, l2.a) < 0.1 && coincidentGap(l2.b, l3.a) < 0.1 && coincidentGap(l3.b, l1.a) < 0.1,
    `gaps=${[coincidentGap(l1.b, l2.a), coincidentGap(l2.b, l3.a), coincidentGap(l3.b, l1.a)]}`);

  // Drag the apex incrementally (real mouse-move style) — the fixed base + SSS should let the
  // triangle rotate/settle but MUST keep all 3 corners coincident and all 3 lengths correct.
  incrementalDrag(s, l2.b, 40, -30, 30); // dragging l2.b == l3.a (the apex)
  check('T1 solve converged after apex drag', s.converged === true, JSON.stringify(s.conflicts));
  check('T1 corners STILL coincident after drag (no gap opened at apex)',
    coincidentGap(l2.b, l3.a) < 0.1, `gap=${coincidentGap(l2.b, l3.a)}`);
  check('T1 all corners coincident after drag',
    coincidentGap(l1.b, l2.a) < 0.1 && coincidentGap(l2.b, l3.a) < 0.1 && coincidentGap(l3.b, l1.a) < 0.1,
    `gaps=${[coincidentGap(l1.b, l2.a), coincidentGap(l2.b, l3.a), coincidentGap(l3.b, l1.a)]}`);
  check('T1 side lengths UNCHANGED by drag (SSS beats mouse-spring)',
    Math.abs(s.edgeLen(l1.a, l1.b) - 100) < 0.5 && Math.abs(s.edgeLen(l2.a, l2.b) - 90) < 0.5 && Math.abs(s.edgeLen(l3.a, l3.b) - 90) < 0.5,
    `lengths=${[s.edgeLen(l1.a, l1.b), s.edgeLen(l2.a, l2.b), s.edgeLen(l3.a, l3.b)]}`);

  // Now stack an EQUAL constraint on top (make right == left explicitly, isoceles), drag again.
  const { ConstraintManager: CM2 } = await import('#core/constraint-manager.js');
  const dEqual = CM2.createConstraint(state, CONSTRAINT_TYPES.EQUAL,
    { joints: [l2.a, l2.b, l3.a, l3.b] }, { source: 'equal' });
  s.solve();
  incrementalDrag(s, l1.b, -15, 10, 15);
  check('T1 EQUAL + drag: right and left legs stay equal',
    Math.abs(s.edgeLen(l2.a, l2.b) - s.edgeLen(l3.a, l3.b)) < 0.5,
    `right=${s.edgeLen(l2.a, l2.b)} left=${s.edgeLen(l3.a, l3.b)}`);
  check('T1 EQUAL + drag: still coincident everywhere',
    coincidentGap(l1.b, l2.a) < 0.2 && coincidentGap(l2.b, l3.a) < 0.2 && coincidentGap(l3.b, l1.a) < 0.2,
    `gaps=${[coincidentGap(l1.b, l2.a), coincidentGap(l2.b, l3.a), coincidentGap(l3.b, l1.a)]}`);
}

console.log(`\n${failures.length === 0 ? 'ALL PASS' : failures.length + ' FAILURE(S)'}`);
if (failures.length) {
  console.log(failures.map(f => '  - ' + f).join('\n'));
  process.exit(1);
}
