// TASK 512 -- PlaneGCS oracle for the matrix: the 508 translation (L.toPlanegcs) plus the two constraint forms 508 left unmapped
// (collinear, circle-circle tangent). `mapped` is false when a constraint still has no PlaneGCS twin, and the dof is then not compared.
import * as L from '../audit/lib.js';
import { GcsWrapper } from '@salusoft89/planegcs';
import { measureResidual, measureShapeSizes, COLLAPSE_RATIO } from '#core/constraint-verifier.js';
import { referenceShape, REFERENCE_JOINTS } from '#core/reference-lines.js';
import { symmetricOperands } from '#core/symmetric.js';
import { sceneShapes, sceneJoints } from '#core/reference-lines.js';

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
    } else if (c.type === 'symmetric' && symmetricOperands(c, sceneShapes(S.state.shapes))) {
      // task 563: PlaneGCS's p2p_symmetric_ppl per mirrored pair (+ equal_radius_cc for circles / arcs: toPlanegcs makes an arc a circle); an axis
      // symmetry line is added as its two fixed points and a line
      const o = symmetricOperands(c, sceneShapes(S.state.shapes));
      const ax = referenceShape(c.line);
      if (ax && !prims.some(q => q.id === ax.id)) {
        for (const j of REFERENCE_JOINTS.filter(r => ax.joints.includes(r.id))) prims.push({ id: j.id, type: 'point', x: j.x, y: j.y, fixed: true });
        prims.push({ id: ax.id, type: 'line', p1_id: ax.joints[0], p2_id: ax.joints[1] });
      }
      // a pair that is ONE joint (two lines sharing an end, two circles sharing a centre) mirrors onto itself = lies on the line: PlaneGCS's
      // p2p_symmetric_ppl of a point with itself has an identically zero equation (it reports it conflicting), so it is given as point-on-line
      for (const [p, q] of o.pairs) prims.push(p === q ? { id: `x_sym_${++n}`, type: 'point_on_line_ppp', p_id: p, lp1_id: o.line[0], lp2_id: o.line[1] }
        : { id: `x_sym_${++n}`, type: 'p2p_symmetric_ppl', p1_id: p, p2_id: q, l_id: c.line });
      // task 572, the line form: mirror(q) on line a1-a2, per end q of line 2. PlaneGCS has no such primitive: a FREE helper point m mirrors q
      // (p2p_symmetric_ppl, 2 equations) and lies on the line (point_on_line_ppp, 1): +2 unknowns, 3 equations = the one row per end
      for (const [q, a1, a2] of o.onLine) {
        const mid = `x_symm_${++n}`, Q = S.state.joints.get(q), A = sceneJoints(S.state.joints);
        const s1 = A.get(o.line[0]), s2 = A.get(o.line[1]), ux = s2.x - s1.x, uy = s2.y - s1.y, k = ((Q.x - s1.x) * ux + (Q.y - s1.y) * uy) / (ux * ux + uy * uy);
        prims.push({ id: mid, type: 'point', x: 2 * (s1.x + k * ux) - Q.x, y: 2 * (s1.y + k * uy) - Q.y, fixed: false });
        prims.push({ id: `x_sym_${++n}`, type: 'p2p_symmetric_ppl', p1_id: q, p2_id: mid, l_id: c.line });
        prims.push({ id: `x_sym_${++n}`, type: 'point_on_line_ppp', p_id: mid, lp1_id: a1, lp2_id: a2 });
      }
      if (o.sizes) prims.push({ id: `x_sym_${++n}`, type: 'equal_radius_cc', c1_id: c.shapes[0], c2_id: c.shapes[1] });
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
