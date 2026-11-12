// TASK 512 -- PlaneGCS oracle for the matrix: the 508 translation (L.toPlanegcs) plus the two constraint forms 508 left unmapped
// (collinear, circle-circle tangent). `mapped` is false when a constraint still has no PlaneGCS twin, and the dof is then not compared.
import * as L from '../audit/lib.js';
import { GcsWrapper } from '@salusoft89/planegcs';
import { measureResidual, measureShapeSizes, COLLAPSE_RATIO } from '#core/constraint-verifier.js';

export async function oracleState(S) {
  const mod = await L.planegcs();
  const { prims, unmapped } = L.toPlanegcs(S);
  let n = 0;
  const left = [];
  for (const c of unmapped) {
    if (c.type === 'collinear' && c.shapes && c.shapes.length === 2) {
      const [l1, l2] = c.shapes.map(id => L.shape(S, id));
      prims.push({ id: `x_col_${++n}a`, type: 'point_on_line_ppp', p_id: l2.joints[0], lp1_id: l1.joints[0], lp2_id: l1.joints[1] });
      prims.push({ id: `x_col_${n}b`, type: 'point_on_line_ppp', p_id: l2.joints[1], lp1_id: l1.joints[0], lp2_id: l1.joints[1] });
    } else if (c.type === 'tangent' && c.shapes && c.shapes.length === 2) {
      prims.push({ id: `x_tcc_${++n}`, type: 'tangent_cc', c1_id: c.shapes[0], c2_id: c.shapes[1] });
    } else left.push(c);
  }
  const w = new GcsWrapper(new mod.GcsSystem());
  try {
    w.push_primitives_and_params(prims);
    const status = w.solve();
    w.apply_solution();
    // PlaneGCS reports 'success' for a constraint it cannot move fixed points to satisfy: judge by OUR verifier on ITS positions
    const solved = new Map();
    for (const [id, j] of S.state.joints) solved.set(id, { ...j });
    for (const q of w.sketch_index.get_primitives()) if (q.type === 'point' && solved.has(q.id)) { solved.get(q.id).x = q.x; solved.get(q.id).y = q.y; }
    let residual = 0;
    for (const c of S.state.constraints) if (c && !L.isDriven(c) && c.type !== 'mouse_spring') { const r = measureResidual(c, solved, S.state.shapes); if (!(r <= residual)) residual = r; }
    // a 'solution' that collapses a line to a point is not a drawing (PlaneGCS accepts it, the app must not)
    let collapsed = false;
    for (const sh of S.state.shapes) if (sh.type === 'line' && sh.joints.length === 2) { const a = solved.get(sh.joints[0]), b = solved.get(sh.joints[1]); if (a && b && Math.hypot(a.x - b.x, a.y - b.y) < 1e-3) collapsed = true; }
    // TASK 550: likewise an arc whose two ends meet (the app's own rule, constraint-verifier.js findCollapsedShape, EA-1)
    { const sizes = (P) => measureShapeSizes({ joints: P, shapes: S.state.shapes }), was = sizes(S.state.joints), now = sizes(solved);
      for (const sh of S.state.shapes) { const w = was.get(sh.id), n = now.get(sh.id); if (sh.type === 'arc' && w && n && w.length === 3 && n.length === 3 && w[1] > 1e-6 && n[1] < w[1] * COLLAPSE_RATIO && n[2] < w[2] * COLLAPSE_RATIO) collapsed = true; } }
    return { collapsed, residual, status, dof: w.gcs.dof(), conflicting: w.get_gcs_conflicting_constraints().length, redundant: w.get_gcs_redundant_constraints().length, mapped: left.length === 0 };
  } finally { w.destroy_gcs_module(); }
}
