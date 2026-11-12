// TASK 514 -- one small, self-contained REPRO per NEW finding of the properties audit (round-1 findings F1-F8 live in tests/harness/audit/findings.js).
// Each run() builds a tiny sketch through the same APIs the tools use and returns { ok, observed }: ok === true means the app behaves CORRECTLY,
// ok === false means the bug is present today. tests/coverage-properties.test.js pins every ok === false as a KNOWN entry (and fails loudly when
// one starts passing). `severity` / `diagnosis` feed docs/COVERAGE-AUDIT.md.
import * as L from '../audit/lib.js';
import { serializeDocument, deserializeDocument } from '#core/document.js';
import { toggleDriving } from '#ui/dimension-seams.js';
import { findCornerBetweenLines } from '#core/fillet.js';
import { panelDof, buildDrawing } from './prop-lib.js';
import { runCase } from './prop-random.js';
import * as scurve from './drawings/n1-scurve.js';

const roundTrip = (S) => {
  const doc = JSON.parse(JSON.stringify(serializeDocument(S.state)));
  const S2 = L.newSketch();
  deserializeDocument(doc, S2.state);
  return S2;
};

export const FINDINGS = [
  {
    id: 'N-F1', severity: 'HIGH', title: 'Fillet on a corner that sits AT the origin deletes the origin joint (j_origin)',
    where: 'packages/core/fillet.js:328-331 (applyFillet: "Delete the old corner cluster joints": for (const jid of cluster) joints.delete(jid))',
    diagnosis: "getCoincidentCluster adds every joint within 1e-4 of the corner (fillet.js:50-58), and j_origin is one when the corner is drawn on the origin; applyFillet then deletes the whole cluster, origin included. Every later constraint to j_origin (the usual anchor) has nothing to anchor to, and the status colouring, the engine and the exporters all assume j_origin exists.",
    task: 'applyFillet: delete only the cluster joints that are not j_origin (re-link the corner constraints to it instead).',
    run() {
      const S = L.newSketch();
      const seg = L.polyline(S, [[0, 0], [60, 0], [60, 40]], true);
      const before = S.state.joints.has(L.origin);
      L.fillet(S, seg[2].id, seg[0].id, 6);
      const after = S.state.joints.has(L.origin);
      return { ok: before && after, observed: `j_origin before the fillet: ${before}, after: ${after}; joints left: ${[...S.state.joints.keys()].map(k => k.slice(0, 9)).join(', ')}` };
    },
  },
  {
    id: 'N-F2', severity: 'MEDIUM', title: 'Fillet refuses every corner of a polygon made with the Polygon tool',
    where: 'packages/core/fillet.js:92 (findCornerAtJoint: incidentLines.length !== 2 -> null) with packages/core/shapes.js:260 (the polygon\'s construction radials end on every corner joint)',
    diagnosis: "A polygon-tool corner has THREE lines on it (two sides + the construction radial from the centre), and findCornerAtJoint requires exactly two (construction lines are not excluded), so findCornerBetweenLines returns null and the Fillet tool says there is no corner. The sides themselves are plain lines.",
    task: 'findCornerAtJoint: ignore construction lines when counting the lines on a corner (and keep the radial attached to the new tangent joint).',
    run() {
      const S = L.newSketch();
      const O = L.point(S, 3, 2), k0 = L.point(S, 43, 2);
      const built = L.polygon(S, O, k0, 5);
      const sides = built.shapes.filter(s => !s.isConstruction);
      const corner = findCornerBetweenLines(S.state, sides[0], sides[1]);
      return { ok: !!corner, observed: `findCornerBetweenLines(side0, side1) of a 5-gon from the polygon tool -> ${corner ? 'a corner' : 'null (Fillet finds no corner)'}` };
    },
  },
  {
    id: 'N-F3', severity: 'LOW', title: 'Save / load and undo drop dimSign / dimSignMode (the H/V dimension side lock)',
    where: 'packages/core/constraints.js:244-257 (createConstraint DISTANCE whitelist builds a fresh object) used by addConstraintObject in deserializeDocument and in _restoreSnapshot',
    diagnosis: "engine.js:270-279 locks WHICH SIDE of the first joint an H/V dimension's second joint sits on, by writing dimSign + dimSignMode onto the constraint at the first solve. serializeDocument keeps them, but every restore path rebuilds the constraint through createConstraint, whose DISTANCE branch copies a fixed list of fields without them. After a reload / undo the lock is re-derived from the CURRENT geometry (same side unless the geometry was moved across the line while unsolved), so the effect is rare; the document is not byte-identical.",
    task: 'createConstraint DISTANCE: carry dimSign / dimSignMode (or restore through a path that keeps every field).',
    run() {
      const S = L.newSketch();
      const a = L.point(S, 10, 10), b = L.point(S, 50, 20);
      L.line(S, a, b);
      L.applyStep(S, { type: 'distance', joints: [a, b], value: 40, dimMode: 'horizontal' }, {});
      const c1 = S.state.constraints.find(c => c.type === 'distance');
      const S2 = roundTrip(S);
      const c2 = S2.state.constraints.find(c => c.type === 'distance');
      return { ok: c1.dimSign === c2.dimSign && c1.dimSignMode === c2.dimSignMode, observed: `before the round trip dimSign=${c1.dimSign} dimSignMode=${c1.dimSignMode}; after save -> load dimSign=${c2.dimSign} dimSignMode=${c2.dimSignMode}` };
    },
  },
  {
    id: 'N-F4', severity: 'HIGH', title: 'A REFERENCE angle dimension becomes DRIVING again after save / load or undo',
    where: 'packages/core/constraints.js:272-284 (createConstraint ANGLE builds { type, shapes, value, offset, glyphPos, labelPos } only); radius dims also lose `driven` / `drivenReason` (:209-221)',
    diagnosis: "The DISTANCE branch carries isDriven / driven / drivenReason so 'import/export round-trips keep reference dimensions' (its own comment); the ANGLE branch was never given them. A person who right-clicks an angle dimension > 'Make reference' (toggleDriving), or whose angle the app demoted as redundant, loses that after Save / reload / any undo: the angle silently drives the sketch again (and can over-constrain or move it).",
    task: 'createConstraint ANGLE: carry isDriven / driven / drivenReason like DISTANCE does (and driven / drivenReason on the radius form).',
    run() {
      const S = L.newSketch();
      const seg = L.polyline(S, [[0, 0], [50, 0], [50, 30]], false);
      L.applyStep(S, { type: 'angle', shapes: [seg[0].id, seg[1].id], value: L.measure(S, { type: 'angle', shapes: [seg[0].id, seg[1].id] }) }, {});
      const c = S.state.constraints.find(k => k.type === 'angle');
      toggleDriving(S.state, c);   // the context menu's 'Make reference'
      const refBefore = L.isDriven(c);
      const S2 = roundTrip(S);
      const refAfter = L.isDriven(S2.state.constraints.find(k => k.type === 'angle'));
      return { ok: refBefore === true && refAfter === true, observed: `angle is a reference before save: ${refBefore}; after save -> load: ${refAfter ? 'still a reference' : 'DRIVING again'}` };
    },
  },
  {
    id: 'N-F5', severity: 'MEDIUM', title: "Collinear on two lines that already meet at a corner: the Design panel DOF is one too LOW (analytic Jacobian is one-sided)",
    where: 'packages/core/solver/definitions.js:233-247 (collinear.computeJacobian: derivatives only on the 2nd line\'s points) + engine.js:171-181 (row count = joints - 2)',
    diagnosis: "collinear anchors the FIRST line and fills the Jacobian only for the points of the second. When the two lines share a corner (coincident joints) the first row, cross(B-A, C-A) with C == B, is identically 0, yet the analytic row (-uy, ux)/|u| on C is non-zero, so the rank is over-counted by 1: the panel says 'N-1 degrees of freedom' while a finite-difference Jacobian says N. Same family as F6 (one-sided pointOnLine) for a different constraint; deleting the constraint then raises the panel DOF by 2 where the true rank contribution is 1.",
    task: 'Make collinear symmetric (derivatives on all four points) or drop the degenerate first row when the lines share a cluster.',
    run() {
      const S = L.newSketch();
      const seg = L.polyline(S, [[0, 0], [40, 10], [90, 5]], false);
      const before = L.fdJacobian(S).nullity;
      L.applyStep(S, { type: 'collinear', shapes: [seg[0].id, seg[1].id] }, {});
      const fd = L.fdJacobian(S).nullity, panel = panelDof(S);
      return { ok: panel === fd, observed: `two lines meeting at a corner made collinear: nullity before ${before}; panel DOF ${panel} vs finite-difference ${fd}` };
    },
  },
  {
    id: 'N-F6', severity: 'MEDIUM', title: 'Editing a dimension can flip an orientation: a tangent circle jumps to the other side of its line, an under-constrained arc inverts',
    where: 'packages/core/constraint-manager.js:197-203 (tangent branch auto-detect is "intentionally OFF"); no branch lock for an arc\'s sweep',
    diagnosis: "|signed distance| - r and cross(a-c, b-c) are satisfied on both sides / both senses, and nothing records which one the user drew. A x0.9 edit of an unrelated dimension (then back) can land on the other branch. The perpendicular and the H/V dimension already lock their branch (branch / dimSign); tangent and the arc sweep do not.",
    task: "Lock the tangent side and the arc's sweep sign at creation like perpendicular's branch (or on the first converged solve).",
    spec: [
      { geo: { kind: 'open', pts: [[28.775, 22.49], [65.471, 47.28], [80.985, 37.476], [104.038, 38.824]], circles: [[143.363, 85.138, 15.919], [96.677, 142.283, 8.89]], arcs: [] },
        ops: [{ k: 'dist-vertical', j: [8, 0], f: 1 }, { k: 'horizontal', j: [5, 6] }, { k: 'dist-horizontal', j: [6, 0], f: 1 }, { k: 'tangent', l: [0], c: [1] }, { k: 'tangent', l: [2], c: [1] }], what: 'tangent circle flips sides' },
      { geo: { kind: 'closed', pts: [[171.344, 134.849], [160.509, 159.551], [113.575, 158.813], [93.26, 150.111], [96.522, 104.924], [108.011, 84.53], [143.853, 99.312]], circles: [[89.716, 117.147, 17.029], [130.438, 100.119, 6.453]], arcs: [[71.348, 116.763, 8.396, 4.846, 6.732]] },
        ops: [{ k: 'dist-horizontal', j: [14, 19], f: 1.3 }], what: 'arc sweep inverts' },
    ],
    run() {
      const out = this.spec.map(sp => ({ what: sp.what, v: runCase({ seed: 0, geo: sp.geo, ops: sp.ops }, { only: 'I7' }).violations.filter(x => x.inv === 'I7') }));
      return { ok: out.every(o => o.v.length === 0), observed: out.map(o => `${o.what}: ${o.v.length ? o.v[0].msg.replace(/s_\w+/g, 's_*') : 'ok'}`).join(' | ') };
    },
  },
  {
    id: 'N-F7', severity: 'HIGH', title: 'Tangent between two arcs that share a rim joint (an S-curve, a slot, an arc fillet chain) is degenerate: the sketch is NOT fully constrained and no longer recovers from a nudge',
    where: 'packages/core/solver/definitions.js:355-373 (tangent circle-circle: |C1C2| - (r1 + r2)) + engine.js tangent branch (radii read from the rim joints as CONSTANTS in the Jacobian)',
    diagnosis: "With the rim joint Q shared, |C1Q| = r1 and |C2Q| = r2 are structural, and 'tangent' is |C1C2| = r1 + r2: the triangle inequality at its extremum (C1, Q, C2 collinear). The gradient of that row vanishes there (a double root), the analytic Jacobian treats r1, r2 as constants (finite differences do not: err 1.0), and the radius dimension of the 2nd arc is judged redundant and demoted. A line-to-arc tangent at the rim uses the endpoint form (perpendicularity) and is fine; the arc-arc one needs the same: (C1 - Q) x (C2 - Q) = 0.",
    task: 'definitions.tangent: when the two circles share a rim joint use the endpoint form cross(C1-Q, C2-Q) = 0 (planegcs tangent_aa / the shared-end branch the line case already has).',
    async run() {
      const { S } = buildDrawing(scurve);
      const fd = L.fdJacobian(S), analytic = L.nullity(S), panel = panelDof(S);
      const ref = L.snapshot(S), size = L.drawingSize(S);
      let back = 0;
      for (const seed of [11, 23, 37]) { L.restore(S, ref); L.jitter(S, seed, 0.02, size); const r = S.engine.solve(L.ITER); if (r.converged === true && L.maxDeviation(S, ref) < L.GEOM_TOL) back++; }
      return { ok: analytic === 0 && fd.nullity === 0 && back === 3, observed: `S-curve (11 constraints, expected fully constrained): panel ${panel}, analytic ${analytic}, finite-difference ${fd.nullity}; Jacobian rows differing from finite differences: [${fd.worst.map(e => e.type)}]; ${back}/3 starts jittered by 2% return to the drawn geometry` };
    },
  },
  // ---- two failures the random properties found that I could not trace to one cause (pinned so they cannot pass unnoticed) ----
  {
    id: 'N-U1', severity: 'LOW', title: 'UNEXPLAINED: deleting a vertical dimension raises the panel DOF by 1 while the finite-difference rank does not change (a redundant dimension accepted as driving)',
    where: 'unknown: repro below (property I3); candidate: engine.isDistanceRedundant does not cover this combination of vertical + perpendicular rows',
    diagnosis: 'Four ops on a 4-gon: dist-vertical, vertical, perpendicular (opposite sides), dist-vertical (0.001 apart). Not attributable to F1-F8 by ablation; it needs a closer look by the owner of the solver (task 510).',
    task: 'Investigate: why is the last dimension independent for the panel but dependent for finite differences.',
    spec: { geo: { kind: 'closed', pts: [[116.749, 71.77], [74.326, 115.608], [0.18, 49.4], [49.979, -6.621]], circles: [], arcs: [] },
      ops: [{ k: 'dist-vertical', j: [6, 4], f: 1 }, { k: 'vertical', j: [7, 5] }, { k: 'perpendicular', l: [2, 0] }, { k: 'dist-vertical', j: [1, 2], f: 0.9 }], inv: 'I3' },
    run() { const v = runCase({ seed: 0, geo: this.spec.geo, ops: this.spec.ops }, { only: this.spec.inv }).violations; return { ok: v.length === 0, observed: v.length ? v[0].msg : 'ok' }; },
  },
  {
    id: 'N-U2', severity: 'LOW', title: 'UNEXPLAINED: editing a dimension x0.9 and back leaves a determined joint 8e-3 away from where it was',
    where: 'unknown: repro below (property I7); involves a point-to-line dimension (the helper projection joint)',
    diagnosis: 'Six ops on a triangle with an arc. The dimension edit converges (residual 1e-8) and the edit back converges, but a joint the nullspace calls determined ends up 8e-3 from its start: the solution of the system is not unique near that configuration, or the helper joint of the point-to-line dimension (isInternal) drifts.',
    task: 'Investigate with the point-to-line dimension (dimension-tool.js create-point-to-line) removed from the case.',
    spec: { geo: { kind: 'closed', pts: [[95.84, 111.836], [7.958, 163.025], [15.84, 89.506]], circles: [], arcs: [[62.513, 76.915, 20.232, 5.901, 6.824]] },
      ops: [{ k: 'dist-horizontal', j: [4, 8], f: 1 }, { k: 'vertical', j: [3, 4] }, { k: 'dist-point-line', j: [1], l: [1] }, { k: 'dist-line', j: [3, 4], f: 1 }, { k: 'dist-vertical', j: [0, 6], f: 1.1 }, { k: 'parallel', l: [1, 2] }], inv: 'I7' },
    run() { const v = runCase({ seed: 0, geo: this.spec.geo, ops: this.spec.ops }, { only: this.spec.inv }).violations; return { ok: v.length === 0, observed: v.length ? v[0].msg : 'ok' }; },
  },
];
