// TASK 514 -- PlaneGCS oracle for the coverage audit. tests/harness/audit/lib.js translates a sketch into PlaneGCS primitives but leaves two of our
// constraint kinds UNMAPPED (collinear, and tangent between two arcs/circles); the round-1 audit never used them. This adds exactly those two
// mappings on top of lib.toPlanegcs and solves; it changes nothing in lib.js.
import { GcsWrapper } from '@salusoft89/planegcs';
import * as L from '../audit/lib.js';

export async function oracleDof(S) {
  const mod = await L.planegcs();
  const { prims, unmapped } = L.toPlanegcs(S);
  const lineOf = (id) => S.state.shapes.find(s => s.id === id);
  const still = [];
  let n = 0;
  for (const c of unmapped) {
    const [a, b] = (c.shapes || []).map(lineOf);
    if (c.type === 'collinear' && a && b && a.type === 'line' && b.type === 'line') {
      // true collinearity: both endpoints of the 2nd line lie on the 1st (the app's solver anchors the 1st line, see finding N-F5)
      for (const j of b.joints) prims.push({ id: `x_col_${++n}`, type: 'point_on_line_ppp', p_id: j, lp1_id: a.joints[0], lp2_id: a.joints[1] });
    } else if (c.type === 'tangent' && a && b && a.type !== 'line' && b.type !== 'line') {
      prims.push({ id: `x_tcc_${++n}`, type: 'tangent_cc', c1_id: a.id, c2_id: b.id });
    } else still.push(c);
  }
  const w = new GcsWrapper(new mod.GcsSystem());
  try {
    w.push_primitives_and_params(prims);
    const status = w.solve();
    return { status, dof: w.gcs.dof(), conflicting: w.get_gcs_conflicting_constraints().length, redundant: w.get_gcs_redundant_constraints().length, unmapped: still.length };
  } finally { w.destroy_gcs_module(); }
}
