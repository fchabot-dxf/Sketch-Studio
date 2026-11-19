// TASK 789 bug 1 (hunt 784 #1): a Tangent between two circles / arcs keeps the side they are on, as Fusion does. The branch (internal = one
// inside the other, external = apart) is chosen ONCE when the constraint is made, from the current geometry, stored on the constraint and
// saved / reloaded / undone with it; a file saved before the field existed keeps external. Node kit (the real Tangent tool clicks, SketchStudio).
import assert from 'node:assert';
import { open, createProfile, createNamedDesign } from './helpers/node-app.js';

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const near = (a, b, msg, tol = 1e-3) => ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

const docOf = (joints, shapes, constraints = []) => ({
  version: 3, hosts: {},
  geometry: {
    joints: [['j_origin', { x: 0, y: 0, fixed: true, sketchId: 'sketch-1' }], ...joints.map(([id, j]) => [id, { fixed: false, sketchId: 'sketch-1', ...j }])],
    shapes: shapes.map((s) => ({ sketchId: 'sketch-1', ...s })),
    constraints,
    sketches: [{ id: 'sketch-1', name: 'Sketch 1', visible: true }],
    activeSketchId: 'sketch-1', groups: [], profiles: [], parameters: [],
  },
});
// two circles: c1 at the origin (fixed) r1, c2 at (x2, 0) r2, both radii dimensioned
const twoCircles = (r1, x2, r2, constraints = []) => docOf(
  [['c1', { x: 0, y: 0, fixed: true }], ['c2', { x: x2, y: 0 }]],
  [{ id: 'cir1', type: 'circle', joints: ['c1'], radius: r1 }, { id: 'cir2', type: 'circle', joints: ['c2'], radius: r2 }],
  [{ type: 'distance', shape: 'cir1', value: r1, isRadius: true, name: 'd1' }, { type: 'distance', shape: 'cir2', value: r2, isRadius: true, name: 'd2' }, ...constraints]);

let app = null;
async function openDoc(doc, profile = null) {
  if (app) { await app.close(); app = null; }
  profile = profile || await createProfile();
  if (doc) await createNamedDesign(profile, 'sketchstudio', 'Tangent 789', doc);
  app = await open({ host: 'sketchstudio', profile });
  return profile;
}
const J = (id) => app.state.joints.get(id);
const centreDist = (a, b) => Math.hypot(J(b).x - J(a).x, J(b).y - J(a).y);
const tangents = () => app.state.constraints.filter((c) => c.type === 'tangent');
// the Tangent tool, a click on each shape's rim (world points)
function tangentTool(p1, p2) {
  app.tool('tangent');
  for (const p of [p1, p2]) { const s = app.toScreen(p.x, p.y); app.click(s.x, s.y); }
  app.esc();
}

try {
  // ---- circle inside circle, already touching: stays internal (was ejected to 55 = r1 + r2)
  await openDoc(twoCircles(40, 25, 15));
  tangentTool({ x: 0, y: 40 }, { x: 25, y: 15 });
  ok(tangents().length === 1, `one tangent made (${tangents().length})`);
  ok(tangents()[0].branch === 'internal', `the tangent is stored internal (${tangents()[0].branch})`);
  near(centreDist('c1', 'c2'), 25, 'internally touching circles stay where they are (|r1 - r2|)');

  // ---- circle inside circle, NOT touching: becomes internally tangent (|r1 - r2| = 25), not pushed outside
  await openDoc(twoCircles(40, 8, 15));
  tangentTool({ x: 0, y: 40 }, { x: 8, y: 15 });
  ok(tangents()[0] && tangents()[0].branch === 'internal', `inside -> internal (${tangents()[0] && tangents()[0].branch})`);
  near(centreDist('c1', 'c2'), 25, 'a circle inside another touches it from inside');

  // ---- circles apart: external (r1 + r2 = 55)
  await openDoc(twoCircles(40, 70, 15));
  tangentTool({ x: 0, y: 40 }, { x: 70, y: 15 });
  ok(tangents()[0] && tangents()[0].branch === 'external', `apart -> external (${tangents()[0] && tangents()[0].branch})`);
  near(centreDist('c1', 'c2'), 55, 'circles apart touch from outside');

  // ---- an arc inside a circle (arc centre (10,0), radius 20, from (30,0) to (10,20) counter-clockwise): internal, |40 - 20| = 20
  await openDoc(docOf(
    [['c1', { x: 0, y: 0, fixed: true }], ['ac', { x: 10, y: 0 }], ['as', { x: 30, y: 0 }], ['ae', { x: 10, y: 20 }]],
    [{ id: 'cir1', type: 'circle', joints: ['c1'], radius: 40 }, { id: 'arc1', type: 'arc', joints: ['ac', 'as', 'ae'], ccw: true }],
    [{ type: 'distance', shape: 'cir1', value: 40, isRadius: true, name: 'd1' }, { type: 'equal', joints: ['ac', 'as', 'ac', 'ae'] }]));
  const arcMid = { x: 10 + 20 * Math.cos(Math.PI / 4), y: 20 * Math.sin(Math.PI / 4) };
  tangentTool({ x: 0, y: 40 }, arcMid);
  ok(tangents()[0] && tangents()[0].branch === 'internal', `arc inside a circle -> internal (${tangents()[0] && tangents()[0].branch})`);
  const rArc = Math.hypot(J('as').x - J('ac').x, J('as').y - J('ac').y);
  near(centreDist('c1', 'ac'), Math.abs(40 - rArc), 'the arc touches the circle from inside');
  ok(centreDist('c1', 'ac') < 40, `the arc's centre stays inside the circle (${centreDist('c1', 'ac')})`);

  // ---- undo / redo carry the branch; save + reload keeps it and the solve keeps internal
  let profile = await openDoc(twoCircles(40, 8, 15));
  tangentTool({ x: 0, y: 40 }, { x: 8, y: 15 });
  ok(tangents().length === 1 && tangents()[0].branch === 'internal', 'made internal');
  app.undo();
  ok(tangents().length === 0, `Ctrl+Z removes it (${tangents().length})`);
  near(centreDist('c1', 'c2'), 8, 'Ctrl+Z puts the circle back');
  app.redo();
  ok(tangents().length === 1 && tangents()[0].branch === 'internal', `Ctrl+Y brings it back internal (${tangents().map((c) => c.branch)})`);
  near(centreDist('c1', 'c2'), 25, 'redo: internally tangent again');
  const saved = await app.storedDoc();
  const savedTangent = saved.geometry.constraints.find((c) => c.type === 'tangent');
  ok(savedTangent && savedTangent.branch === 'internal', `the saved file holds branch internal (${JSON.stringify(savedTangent)})`);
  profile = await openDoc(null, profile);
  ok(tangents().length === 1 && tangents()[0].branch === 'internal', `reloaded: still internal (${tangents().map((c) => c.branch)})`);
  app.engine.solve(500);
  near(centreDist('c1', 'c2'), 25, 'reloaded + solved: still touching from inside');

  // ---- a file saved before the field (a tangent with no branch) keeps external
  await openDoc(twoCircles(40, 25, 15, [{ type: 'tangent', shapes: ['cir1', 'cir2'] }]));
  ok(tangents().length === 1 && tangents()[0].branch === undefined, `an old tangent loads with no branch (${tangents()[0] && tangents()[0].branch})`);
  app.engine.solve(500);
  near(centreDist('c1', 'c2'), 55, 'an old tangent with no branch solves external, as it always did');

  console.log(`PASS tangent-branch-789: ${checks} checks`);
} finally {
  if (app) await app.close();
}
