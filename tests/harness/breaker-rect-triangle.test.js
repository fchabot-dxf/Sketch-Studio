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

// ── SCENARIO 3: circle radius dimension — built EXACTLY like circle-tool.js builds one ──
// circle-tool.js:104 → state.shapes.push({ id, type:'circle', joints:[centerJointId], radius: r });
// circle-tool.js:108 → addConstraint(state, DISTANCE, { shape: shapeId, value: r, isRadius: true })
// NOTE: circle-tool.js uses packages/core/constraints.js's addConstraint (the plain path), NOT
// ConstraintManager.createConstraint (the redundancy/refuse-aware path rect-tool.js uses).
console.log('\n=== Circle: radius dimension add + edit (real circle-tool.js topology) ===');
{
  const s = createSketch();
  const { state, engine } = s;
  const { addConstraint } = await import('#core/constraints.js');
  const { CONSTRAINT_TYPES: CT } = await import('#core/constants.js');

  const centerId = s.point(50, 50, true); // pinned center, like a real anchored circle
  const shapeId = 'sCircle1';
  state.shapes.push({ id: shapeId, type: 'circle', joints: [centerId], radius: 20 });
  addConstraint(state, CT.DISTANCE, { shape: shapeId, value: 20, isRadius: true });
  s.solve();

  const shape = () => state.shapes.find(sh => sh.id === shapeId);
  const radiusConstraint = () => state.constraints.find(c => c.type === CT.DISTANCE && c.isRadius && c.shape === shapeId);

  check('C1 solve converges right after creating a locked-radius circle (before any edit)',
    s.converged === true, `converged=${s.converged} conflicts=${JSON.stringify(s.conflicts)}`);
  check('C1 radius constraint was created', !!radiusConstraint());
  check('C1 shape.radius starts at 20', shape().radius === 20, `got ${shape() && shape().radius}`);
  check('C1 shape has only ONE joint (real circle-tool topology, no rim joint)', shape().joints.length === 1,
    `joints=${JSON.stringify(shape().joints)}`);

  // Now edit the radius dimension to 35 via the REAL edit seam (numeric-input-manager's exact call).
  const { commitDimensionEdit } = await import('#ui/dimension-seams.js');
  const c = radiusConstraint();
  const { reverted, clash } = commitDimensionEdit(state, c, 35);
  s.solve();

  check('C1 edit was NOT reverted (solver thinks it converged)', reverted === false, `reverted=${reverted} clash=${clash}`);
  check('C1 dimension VALUE updated to 35 (what the label reads for a driving dim)', c.value === 35, `c.value=${c.value}`);
  check('C1 shape.radius (what actually gets DRAWN, per svg-renderer.js:873/1996) ALSO updated to 35',
    Math.abs(shape().radius - 35) < 0.05,
    `shape.radius=${shape().radius} — if this is still 20, the label says 35 but the drawn circle is still radius 20: ` +
    `a dimension that visibly does not apply to the geometry.`);
}

// ── SCENARIO 4: does a locked-radius circle's dead constraint corrupt the WHOLE document's solve? ──
// Hypothesis from Scenario 3: engine.js's isRadius synthesis (lines ~328-333) requires
// shape.joints.length >= 2, which a real circle-tool.js circle NEVER has (always exactly 1 joint,
// the center). So params.joints stays [] for that row, Definitions.distance.computeError reads
// params.joints[0]/[1] as undefined -> NaN residual. Since ALL constraint rows share ONE global
// cost (sum of squares) per engine.solve() call, a NaN in this one row could poison convergence for
// the ENTIRE sketch, not just the circle. Test: does an UNRELATED, otherwise-perfectly-solvable
// rectangle in the SAME document fail to converge purely because a locked-radius circle also exists?
console.log('\n=== Circle radius NaN-row blast-radius: does it break an UNRELATED rectangle in the same doc? ===');
{
  const s = createSketch();
  const { state } = s;
  const { addConstraint } = await import('#core/constraints.js');
  const { CONSTRAINT_TYPES: CT } = await import('#core/constants.js');

  // A perfectly normal, fully-dimensioned rectangle — on its own this always converges (Scenario 1).
  const r = s.rect(200, 200, 100, 60);
  const [c1, c2, c3] = r.corners;
  s.dimension(c1, c2, 100);
  s.dimension(c2, c3, 60);
  check('D1 baseline: rectangle alone converges', s.converged === true, JSON.stringify(s.conflicts));

  // Now add a SEPARATE, unrelated circle with a locked radius, exactly like circle-tool.js does at
  // creation time (addConstraint from constraints.js — the same path, no ConstraintManager).
  const centerId = s.point(50, 50, true);
  const shapeId = 'sCircle2';
  state.shapes.push({ id: shapeId, type: 'circle', joints: [centerId], radius: 20 });
  addConstraint(state, CT.DISTANCE, { shape: shapeId, value: 20, isRadius: true });
  s.solve();

  check('D1 solve still converges with an UNRELATED locked-radius circle also in the document',
    s.converged === true,
    `converged=${s.converged} conflicts=${JSON.stringify(s.conflicts)} — if false, one dead circle-radius ` +
    `constraint is corrupting the convergence state of the ENTIRE document, including shapes that have ` +
    `nothing to do with it.`);
  check('D1 the UNRELATED rectangle is STILL correctly dimensioned despite the circle',
    Math.abs(s.edgeLen(c1, c2) - 100) < 0.5 && Math.abs(s.edgeLen(c2, c3) - 60) < 0.5,
    `w=${s.edgeLen(c1, c2)} h=${s.edgeLen(c2, c3)} (expected ~100 / ~60)`);
}

// ── SCENARIO 5: arc integrity — does dragging/editing keep start+end equidistant from center? ──
// arc-tool.js:220-227: joints=[center,start,end], placed so start&end are equidistant from center at
// CREATION time, but makeArc() adds ZERO constraints (shapes.js:272 `constraints: []`). So nothing in
// the constraint system enforces "start and end stay on the same circle as center moves" — it's only
// true by construction. Does that integrity survive a drag? A CAD arc/fillet that visibly stops being
// circular after a drag would be a very common, very visible "constraints not applied correctly" symptom.
console.log('\n=== Arc: does start/end stay equidistant from center under drag + radius edit? ===');
{
  const s = createSketch();
  const { state } = s;
  const { makeArc } = await import('#core/shapes.js');
  const { ConstraintManager } = await import('#core/constraint-manager.js');
  const { CONSTRAINT_TYPES: CT } = await import('#core/constants.js');

  const R = 40;
  const centerId = s.point(0, 0, true);
  const startId = s.point(R, 0, false);                                  // angle 0
  const endId = s.point(R * Math.cos(Math.PI/2), R * Math.sin(Math.PI/2), false); // angle 90

  const res = makeArc(state.joints, centerId, startId, endId, 'CENTER', false);
  res.shapes.forEach(sh => state.engine.addShape(sh));
  // Consume res.constraints exactly like the real arc-tool.js:227 does (post-fix, makeArc now
  // returns a structural equal-radius constraint) -- this test predates that fix and needs updating
  // to match, or it's testing a topology no real caller produces any more.
  const { ConstraintManager: CM5 } = await import('#core/constraint-manager.js');
  (res.constraints || []).forEach(c => CM5.createConstraint(state, c.type, c, { source: 'arc' }));
  s.solve();

  const distTo = (a, b) => s.edgeLen(a, b);
  check('A1 arc built with start/end equidistant from center (by construction)',
    Math.abs(distTo(centerId, startId) - distTo(centerId, endId)) < 0.05,
    `start-radius=${distTo(centerId, startId)} end-radius=${distTo(centerId, endId)}`);

  // Add a radius dimension (like arc-tool.js does when the user types a radius), matching the real
  // path (ConstraintManager, not the plain addConstraint circle-tool.js uses).
  const shapeId = res.shapes[0].id;
  const dR = ConstraintManager.createConstraint(state, CT.DISTANCE, { shape: shapeId, value: R, isRadius: true }, { source: 'arc' });
  s.solve();
  check('A2 solve converges after adding the arc radius dimension', s.converged === true, JSON.stringify(s.conflicts));

  // Drag the END joint a little (simulating a user nudging the arc's end handle).
  const stepDx = 5, stepDy = -3;
  for (let i = 0; i < 10; i++) s.drag(endId, stepDx / 10, stepDy / 10);
  check('A3 after dragging END, start+end STILL equidistant from center (arc stays circular)',
    Math.abs(distTo(centerId, startId) - distTo(centerId, endId)) < 0.5,
    `start-radius=${distTo(centerId, startId)} end-radius=${distTo(centerId, endId)} — if these differ, dragging ` +
    `an arc's endpoint silently turns it into a non-circular shape.`);
  check('A4 after dragging END, the dimensioned radius (center-start) is unchanged',
    Math.abs(distTo(centerId, startId) - R) < 0.5, `got ${distTo(centerId, startId)} expected ~${R}`);

  // Now edit the radius dimension to a new value (like a user typing a new radius).
  const editRes = s.editValue(dR, 60);
  check('A5 arc radius EDIT was not reverted', editRes.converged !== false || s.lastError == null,
    `converged=${editRes && editRes.converged} lastError=${s.lastError}`);
  check('A6 after radius edit, start moved to the new radius', Math.abs(distTo(centerId, startId) - 60) < 0.5,
    `got ${distTo(centerId, startId)} expected ~60`);
  check('A7 after radius edit, END ALSO moved to the new radius (stayed a valid arc)',
    Math.abs(distTo(centerId, endId) - 60) < 0.5,
    `end-radius=${distTo(centerId, endId)} expected ~60 (start=${distTo(centerId, startId)}) — if end is still ` +
    `~40 while start is ~60, editing an arc's radius bends it out of shape instead of resizing it uniformly.`);
}

// SCENARIO 6: circle tangent to a line, then the circle's radius is edited via the just-fixed
// commitDimensionEdit path -- does tangency survive a radius change?
// constraint-tools.js:218 -> ConstraintManager.createConstraint(state, TANGENT, { line, circle }).
console.log("\n=== Circle tangent-to-line + radius edit (built on the just-landed radius fix) ===");
{
  const s = createSketch();
  const state = s.state;
  const addConstraintMod = await import('#core/constraints.js');
  const addConstraint = addConstraintMod.addConstraint;
  const cmMod = await import('#core/constraint-manager.js');
  const ConstraintManager = cmMod.ConstraintManager;
  const ctMod = await import('#core/constants.js');
  const CT = ctMod.CONSTRAINT_TYPES;

  const line = s.line(-100, 0, 100, 0);
  const centerId = s.point(0, 30, false);
  const shapeId = "sTanCircle";
  state.shapes.push({ id: shapeId, type: "circle", joints: [centerId], radius: 30 });
  addConstraint(state, CT.DISTANCE, { shape: shapeId, value: 30, isRadius: true });
  ConstraintManager.createConstraint(state, CT.TANGENT, { line: line.id, circle: shapeId }, { source: "toolbar" });
  s.solve();

  const shape = () => state.shapes.find(sh => sh.id === shapeId);
  // IMPORTANT: neither line endpoint is pinned here (matches a freshly-drawn, undimensioned line --
  // line-tool.js never sets fixed:true by default), so the line is just as free to move as the
  // circle's center. An earlier version of this gap check assumed the line stays put at y=0, which
  // produced a FALSE finding (looked like a solver bug; was actually this test's wrong assumption --
  // the solver had correctly moved the line too as part of a valid tangent solution). Compute the gap
  // from the line's ACTUAL current endpoints every time, never an assumed-fixed position.
  const tangentGap = () => {
    const A = s.pos(line.a), B = s.pos(line.b), C = s.pos(centerId);
    const ux = B.x - A.x, uy = B.y - A.y, wx = C.x - A.x, wy = C.y - A.y;
    const cross = wx * uy - wy * ux, lu = Math.hypot(ux, uy);
    return Math.abs(cross / lu) - shape().radius;
  };

  check("TAN1 solve converged after tangent add", s.converged === true, JSON.stringify(s.conflicts));
  check("TAN1 tangent holds initially (center-to-line distance == radius)", Math.abs(tangentGap()) < 0.5,
    "center.y=" + s.pos(centerId).y + " radius=" + shape().radius);

  // Real bug, found + fixed by the worker (t374, commit 87d3516): editing this radius via the real
  // commitDimensionEdit seam used to revert ("conflicts with tangent") because a circle's isRadius row
  // (no rim joint) produced a NaN residual that poisoned the WHOLE gradient once the circle also
  // participated in a real tangent constraint -- confirmed fixed here with a CORRECTED gap measurement
  // (using the line's live position, not an assumed-fixed one).
  const radiusDim = state.constraints.find(c => c.type === CT.DISTANCE && c.isRadius && c.shape === shapeId);
  s.editValue(radiusDim, 50);
  check("TAN2 radius edit was NOT reverted", s.lastError == null, "lastError=" + s.lastError);
  check("TAN2 radius actually updated to 50", Math.abs(shape().radius - 50) < 0.5, "got " + shape().radius);
  check("TAN2 tangency genuinely holds after the edit (line may have moved too -- that's fine, still tangent)",
    Math.abs(tangentGap()) < 0.5,
    "gap=" + tangentGap() + " center=" + JSON.stringify(s.pos(centerId)) + " line=" + JSON.stringify([s.pos(line.a), s.pos(line.b)]));

  for (let i = 0; i < 10; i++) s.drag(centerId, 4, 0);
  check("TAN3 tangency MAINTAINED after dragging the center sideways", Math.abs(tangentGap()) < 0.5,
    "gap=" + tangentGap());
}

// SCENARIO 7: freeform PARALLEL + PERPENDICULAR on independently-drawn lines (constraint-tools.js's
// real {shapes:[id1,id2]} path, not rect-tool's built-in H/V) + drag.
console.log("\n=== Freeform parallel/perpendicular (2 independent lines, real constraint-tools.js path) + drag ===");
{
  const s = createSketch();
  const state = s.state;
  const cmMod2 = await import('#core/constraint-manager.js');
  const ConstraintManager = cmMod2.ConstraintManager;
  const ctMod2 = await import('#core/constants.js');
  const CT = ctMod2.CONSTRAINT_TYPES;

  const lineA = s.line(0, 0, 100, 20);
  state.joints.get(lineA.a).fixed = true;
  const lineB = s.line(0, 50, 100, 55);

  ConstraintManager.createConstraint(state, CT.PARALLEL, { shapes: [lineA.id, lineB.id] }, { source: "toolbar" });
  s.solve();
  const angleOf = (l) => { const a = s.pos(l.a), b = s.pos(l.b); return Math.atan2(b.y - a.y, b.x - a.x); };
  const angleDiff = (a1, a2) => { let d = Math.abs(a1 - a2) % Math.PI; return Math.min(d, Math.PI - d); };

  check("PP1 solve converged after PARALLEL", s.converged === true, JSON.stringify(s.conflicts));
  check("PP1 lines are actually parallel", angleDiff(angleOf(lineA), angleOf(lineB)) < 0.01,
    "angleA=" + angleOf(lineA) + " angleB=" + angleOf(lineB));

  for (let i = 0; i < 15; i++) s.drag(lineB.b, 2, -3);
  check("PP2 still parallel after dragging lineB", angleDiff(angleOf(lineA), angleOf(lineB)) < 0.05,
    "angleA=" + angleOf(lineA) + " angleB=" + angleOf(lineB));

  const lineC = s.line(0, -50, 30, -80);
  ConstraintManager.createConstraint(state, CT.PERPENDICULAR, { shapes: [lineA.id, lineC.id] }, { source: "toolbar" });
  s.solve();
  const perpOf = () => { const d = angleDiff(angleOf(lineA), angleOf(lineC)); return Math.abs(d - Math.PI / 2); };
  check("PP3 solve converged after PERPENDICULAR", s.converged === true, JSON.stringify(s.conflicts));
  check("PP3 lines are actually perpendicular", perpOf() < 0.01, "diff-from-90deg(rad)=" + perpOf());
  for (let i = 0; i < 10; i++) s.drag(lineC.b, -5, 2);
  check("PP4 still perpendicular after dragging lineC", perpOf() < 0.05, "diff-from-90deg(rad)=" + perpOf());
  check("PP4 lineA/lineB STILL parallel too (multi-constraint stack holds)", angleDiff(angleOf(lineA), angleOf(lineB)) < 0.05,
    "angleA=" + angleOf(lineA) + " angleB=" + angleOf(lineB));
}

// SCENARIO 8: angle-defined triangle (SAS: two sides + included angle) + drag.
console.log("\n=== Angle-defined triangle (SAS) + drag ===");
{
  const s = createSketch();
  const state = s.state;
  const cmMod3 = await import('#core/constraint-manager.js');
  const ConstraintManager = cmMod3.ConstraintManager;
  const ctMod3 = await import('#core/constants.js');
  const CT = ctMod3.CONSTRAINT_TYPES;

  const l1 = s.line(0, 0, 80, 0);
  state.joints.get(l1.a).fixed = true;
  const l2 = s.line(0, 0, 40, 60);
  // Real topology (per line-tool.js): shared vertex = TWO separate joints tied by an explicit
  // COINCIDENT constraint, not a literally-shared joint id.
  ConstraintManager.createConstraint(state, CT.COINCIDENT, { joints: [l1.a, l2.a] }, { source: "toolbar" });

  s.dimension(l1.a, l1.b, 80);
  s.dimension(l2.a, l2.b, 70);
  // ANGLE's REAL validated param shape is {shapes:[s1,s2], value} (constraint-manager.js:791-793),
  // not raw joints -- confirmed by reading _validateParams (line 989-990) after createConstraint
  // returned null on a first, wrong-shaped attempt.
  const dAngle = ConstraintManager.createConstraint(state, CT.ANGLE, { shapes: [l1.id, l2.id], value: 50 }, { source: "toolbar" });
  check("SAS0 angle constraint was actually created", !!dAngle, "createConstraint returned " + JSON.stringify(dAngle));
  s.solve();

  const angleBetween = () => {
    const a = s.pos(l1.a), b = s.pos(l1.b), c = s.pos(l2.a), d = s.pos(l2.b);
    const u = Math.atan2(b.y - a.y, b.x - a.x), v = Math.atan2(d.y - c.y, d.x - c.x);
    let diff = Math.abs(u - v) * 180 / Math.PI; if (diff > 180) diff = 360 - diff; return diff;
  };
  check("SAS1 solve converged", s.converged === true, JSON.stringify(s.conflicts));
  check("SAS1 angle matches (~50deg)", Math.abs(angleBetween() - 50) < 1, "got " + angleBetween());
  check("SAS1 side lengths hold", Math.abs(s.edgeLen(l1.a, l1.b) - 80) < 0.5 && Math.abs(s.edgeLen(l2.a, l2.b) - 70) < 0.5,
    "l1=" + s.edgeLen(l1.a, l1.b) + " l2=" + s.edgeLen(l2.a, l2.b));

  for (let i = 0; i < 15; i++) s.drag(l2.b, -10, 5);
  check("SAS2 angle STILL matches after drag", Math.abs(angleBetween() - 50) < 1, "got " + angleBetween());
  check("SAS2 side lengths STILL hold after drag",
    Math.abs(s.edgeLen(l1.a, l1.b) - 80) < 0.5 && Math.abs(s.edgeLen(l2.a, l2.b) - 70) < 0.5,
    "l1=" + s.edgeLen(l1.a, l1.b) + " l2=" + s.edgeLen(l2.a, l2.b));
  check("SAS2 shared vertex (l1.a/l2.a) still coincident after drag", s.edgeLen(l1.a, l2.a) < 0.1,
    "gap=" + s.edgeLen(l1.a, l2.a));
}

// SCENARIO 9: midpoint-centering -- constrain a rectangle's diagonal midpoint coincident with a
// fixed origin point (recent project fix: "a shape can now be centered on the origin").
console.log("\n=== Midpoint centering: constrain a rectangle's center to a fixed origin point ===");
{
  const s = createSketch();
  const state = s.state;
  const cmMod4 = await import('#core/constraint-manager.js');
  const ConstraintManager = cmMod4.ConstraintManager;
  const ctMod4 = await import('#core/constants.js');
  const CT = ctMod4.CONSTRAINT_TYPES;

  const r = s.rect(500, 500, 80, 40);
  const c1 = r.corners[0], c3 = r.corners[2];
  const originId = s.point(0, 0, true);
  const midId = s.point(999, 999, false);

  ConstraintManager.createConstraint(state, CT.MIDPOINT, { joints: [c1, c3, midId] }, { source: "toolbar" });
  ConstraintManager.createConstraint(state, CT.COINCIDENT, { joints: [midId, originId] }, { source: "toolbar" });
  s.solve();

  const center = () => { const a = s.pos(c1), b = s.pos(c3); return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; };
  check("MID1 solve converged", s.converged === true, JSON.stringify(s.conflicts));
  check("MID1 rectangle is now centered on the origin (bidirectional midpoint pulled the WHOLE shape)",
    Math.hypot(center().x, center().y) < 0.5, "center=" + JSON.stringify(center()));
  check("MID1 still a rectangle after centering", s.isRectangle(r.corners));

  for (let i = 0; i < 15; i++) s.drag(c1, -10, -5);
  check("MID2 still centered on origin after dragging a corner", Math.hypot(center().x, center().y) < 0.5,
    "center=" + JSON.stringify(center()));
  check("MID2 still a rectangle after drag", s.isRectangle(r.corners));
}

console.log(`\n${failures.length === 0 ? 'ALL PASS' : failures.length + ' FAILURE(S)'}`);
if (failures.length) {
  console.log(failures.map(f => '  - ' + f).join('\n'));
  process.exit(1);
}
