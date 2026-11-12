// TASK 524 -- a fillet on a corner whose joint is FIXED (locked, not the origin) keeps that joint: it is the corner's virtual sharp,
// the same rule as the origin case of task 517 (the origin is simply one fixed joint).
import * as L from './harness/audit/lib.js';
import { serializeDocument, deserializeDocument } from '#core/document.js';
import { ConstraintManager } from '#core/constraint-manager.js';
import { applyFillet, findCornerBetweenLines } from '#core/fillet.js';

const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };
const near = (a, b, t = 1e-4) => Math.abs(a - b) < t;

// a 60x40 rectangle away from the origin; lock the corner (60,40) the way the Lock action does (joint.fixed = true)
function lockedRect() {
  const S = L.newSketch();
  const r = L.rect(S, 10, 10, 70, 50);
  const corner = [...S.state.joints.entries()].find(([id, j]) => id !== L.origin && near(j.x, 70) && near(j.y, 50));
  assert(corner, 'found the (70,50) corner');
  corner[1].fixed = true;
  S.engine.solve(L.ITER);
  return { S, r, jid: corner[0] };
}
const cornerOf = (S, r, jid) => {
  const two = r.lines.map(id => S.state.shapes.find(s => s.id === id)).filter(s => s.joints.includes(jid) || S.state.constraints.some(c => c.type === 'coincident' && c.joints.includes(jid) && c.joints.some(x => s.joints.includes(x))));
  assert(two.length === 2, 'two lines meet at the locked corner');
  return findCornerBetweenLines(S.state, two[0], two[1]);
};

// ---- rectangle, locked non-origin corner
{
  const { S, r, jid } = lockedRect();
  const n0 = L.nullity(S);
  const corner = cornerOf(S, r, jid);
  assert(corner && corner.cluster.has(jid), 'the filleted corner is the locked one');
  S.state.saveState('fillet');
  const res = applyFillet(S.state, corner, 8);
  assert(res && res.success, 'fillet accepted');
  const j = S.state.joints.get(jid);
  assert(j && j.fixed === true && near(j.x, 70) && near(j.y, 50), `the locked joint still exists, fixed, at (70,50): ${JSON.stringify(j)}`);
  const arc = S.state.shapes.find(s => s.type === 'arc');
  assert(arc.filletSharp === jid, "the locked joint is the fillet's virtual sharp");
  assert(S.engine.solve(L.ITER).converged, 'solves');
  const [cj, p1, p2] = arc.joints.map(x => S.state.joints.get(x));
  assert(near(Math.hypot(p1.x - cj.x, p1.y - cj.y), 8) && near(Math.hypot(p2.x - cj.x, p2.y - cj.y), 8), 'fillet radius 8');
  assert(near(cj.x, 62) && near(cj.y, 42), `fillet centre at (62,42): (${cj.x}, ${cj.y})`);
  assert(S.state.shapes.every(s => !s.joints || s.joints.every(x => S.state.joints.has(x))), 'no shape references a missing joint');
  assert(L.nullity(S) === n0, `the sketch keeps its freedom (${n0} -> ${L.nullity(S)})`);
  console.log(`fillet on a locked corner (rectangle): joint kept, nullity ${n0} -> ${L.nullity(S)}`);

  // save / load round trip
  const doc = JSON.parse(JSON.stringify(serializeDocument(S.state)));
  const S2 = L.newSketch();
  assert(deserializeDocument(doc, S2.state).ok, 'loads');
  const j2 = S2.state.joints.get(jid);
  assert(j2 && j2.fixed === true && near(j2.x, 70) && near(j2.y, 50), 'save/load keeps the locked joint');
  assert(S2.engine.solve(L.ITER).converged && L.nullity(S2) === n0, 'save/load: solves, same freedom');

  // undo restores the corner
  S.state.undo();
  const ju = S.state.joints.get(jid);
  assert(ju && ju.fixed === true && near(ju.x, 70) && near(ju.y, 50), 'undo restores the locked corner joint');
  assert(!S.state.shapes.some(s => s.type === 'arc'), 'undo removes the arc');
  assert(S.engine.solve(L.ITER).converged && L.nullity(S) === n0, 'undo: solves, same freedom');
}

// ---- two coincident fixed joints in the corner: one is kept as V, the geometry stays pinned
{
  const { S, r, jid } = lockedRect();
  const extra = L.point(S, 70, 50);
  S.state.joints.get(extra).fixed = true;
  ConstraintManager.createConstraint(S.state, 'coincident', { joints: [extra, jid] }, { source: 'test' });
  S.engine.solve(L.ITER);
  const res = applyFillet(S.state, cornerOf(S, r, jid), 8);
  assert(res && res.success, 'fillet accepted with two fixed joints in the corner');
  const arc = S.state.shapes.find(s => s.type === 'arc');
  const v = S.state.joints.get(arc.filletSharp);
  assert(v && v.fixed === true && near(v.x, 70) && near(v.y, 50), 'one fixed joint is kept at the corner as V');
  assert(S.state.shapes.every(s => !s.joints || s.joints.every(x => S.state.joints.has(x))), 'no shape references a missing joint');
  assert(S.engine.solve(L.ITER).converged, 'solves');
  console.log(`two coincident fixed joints: V = ${arc.filletSharp} kept`);
}

// ---- a locked polygon corner
{
  const S = L.newSketch();
  const O = L.point(S, 0, 0), k0 = L.point(S, 40, 0);
  const built = L.polygon(S, O, k0, 6);
  const sides = built.shapes.filter(s => !s.isConstruction);
  S.engine.solve(L.ITER);
  // lock corner 1 (the joint shared by side 0 and side 1)
  const jid = sides[0].joints.find(x => sides[1].joints.includes(x));
  const p = S.state.joints.get(jid);
  const at = { x: p.x, y: p.y };
  p.fixed = true;
  S.engine.solve(L.ITER);
  const corner = findCornerBetweenLines(S.state, sides[0], sides[1]);
  assert(corner, 'polygon corner is filletable');
  const res = applyFillet(S.state, corner, 4);
  assert(res && res.success, `polygon fillet accepted: ${res && res.reason}`);
  const v = S.state.joints.get(jid);
  assert(v && v.fixed === true && near(v.x, at.x) && near(v.y, at.y), 'the locked polygon corner joint is kept, fixed, in place');
  assert(S.state.shapes.every(s => !s.joints || s.joints.every(x => S.state.joints.has(x))), 'no shape references a missing joint (radials included)');
  assert(S.engine.solve(L.ITER).converged, 'polygon solves');
  assert(L.hasNaN(S) === false, 'no NaN');
  console.log('locked polygon corner filleted: joint kept');
}
console.log('task 524 tests passed');
