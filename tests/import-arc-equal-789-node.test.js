// TASK 789 bug 4 (hunt 784 #4): an arc imported from a DXF or an SVG holds its two ends on ONE circle, as a drawn arc does: it gets the same
// structural equal (|centre - start| = |centre - end|) from the one place every arc gets it (#core/shapes.js arcStructuralConstraints, read by
// makeArc and by the import). Before: an ungrouped imported arc whose radius was edited moved its start only (r start 200, end 317.5).
// Node kit (SketchStudio): the file goes through the host's own import (app.importFile), the groups are ungrouped (#core/group-model.js ungroup),
// a radius dimension is placed on the arc and its value typed (the box's commit path).
import assert from 'node:assert';
import fs from 'node:fs';
import { open, createProfile, createNamedDesign } from './helpers/node-app.js';
import { ConstraintManager } from '#core/constraint-manager.js';
import { CONSTRAINT_TYPES } from '#core/constants.js';
import { ungroup } from '#core/group-model.js';
import { previewDimensionInput } from '#core/parameters.js';
import { applyParameterChange, refusalReason } from '#core/dimension-seams.js';

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const near = (a, b, msg, tol = 1e-3) => ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

let app = null;
async function importInto(name, text) {
  if (app) { await app.close(); app = null; }
  const profile = await createProfile();
  await createNamedDesign(profile, 'sketchstudio', 'Import 789');
  app = await open({ host: 'sketchstudio', profile });
  app.importFile(text, name);
  app.frames();
  ok(app.state.shapes.length > 0, `${name} imports (${app.state.shapes.length} shapes)`);
  return app.state;
}
const J = (st, id) => st.joints.get(id);
const rimRadii = (st, arc) => {
  const [c, s, e] = arc.joints.map((id) => J(st, id));
  return [Math.hypot(s.x - c.x, s.y - c.y), Math.hypot(e.x - c.x, e.y - c.y)];
};
// ungroup everything, put a radius dimension on the arc, type `r` into it: both ends stay on the circle of radius r
function editRadius(st, arc, r, what) {
  const hasEqual = st.constraints.some((c) => c.type === 'equal' && Array.isArray(c.joints) && c.joints.length === 4
    && c.joints[0] === arc.joints[0] && c.joints[2] === arc.joints[0] && new Set([c.joints[1], c.joints[3]]).size === 2
    && [c.joints[1], c.joints[3]].every((j) => arc.joints.slice(1).includes(j)));
  ok(hasEqual, `${what}: the imported arc carries the structural equal |centre - start| = |centre - end|`);
  for (const g of [...(st.groups || [])].reverse()) ungroup(st, g.id);
  ok(!(st.groups || []).length, `${what}: ungrouped (${(st.groups || []).length} groups left)`);
  const [r0, r1] = rimRadii(st, arc);
  near(r0, r1, `${what}: imported on one circle`);
  const before = st.constraints.length;
  st.saveState('dimension');
  ConstraintManager.createConstraint(st, CONSTRAINT_TYPES.DISTANCE, { shape: arc.id, isRadius: true, value: r0 }, { source: 'toolbar' });
  const dim = st.constraints.slice(before).find((c) => c.type === CONSTRAINT_TYPES.DISTANCE && c.isRadius && c.shape === arc.id);
  ok(dim && !dim.isDriven && !dim.driven && dim.name, `${what}: a driving radius dimension (${dim && JSON.stringify({ name: dim.name, driven: dim.isDriven })})`);
  const pv = previewDimensionInput(st, dim, String(r), { unit: 'mm' });
  ok(pv.ok, `${what}: the box takes ${r} (${pv.hint})`);
  const res = applyParameterChange(st, pv.plan, 'edit');
  ok(res.ok, `${what}: radius ${r0.toFixed(3)} -> ${r} is applied (${res.ok ? '' : refusalReason(res)})`);
  const [s, e] = rimRadii(st, arc);
  near(s, r, `${what}: the start is on the new circle`);
  near(e, r, `${what}: the end is on the new circle (was left at the old radius)`);
}

try {
  // ---- DXF: the hunt's fixture (a polyline loop with bulges -> lines + arcs)
  {
    const st = await importInto('bulge-loop-in.dxf', fs.readFileSync('tests/fixtures/dxf/bulge-loop-in.dxf', 'utf8'));
    const arc = st.shapes.find((s) => s.type === 'arc');
    ok(!!arc, 'the DXF has an arc');
    editRadius(st, arc, 200, 'DXF arc');
  }
  // ---- SVG: a path with a circular `A` command (a half disc 60 wide)
  {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="100mm" viewBox="0 0 100 100"><path d="M 10 50 A 30 30 0 0 1 70 50 L 10 50 Z"/></svg>';
    const st = await importInto('half-disc.svg', svg);
    const arc = st.shapes.find((s) => s.type === 'arc');
    ok(!!arc, 'the SVG has an arc');
    editRadius(st, arc, 40, 'SVG arc');
  }
  console.log(`PASS import-arc-equal-789: ${checks} checks`);
} finally {
  if (app) await app.close();
}
