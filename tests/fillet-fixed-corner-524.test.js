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

// ---- lines locked (Lock action on selected lines = every joint of each line fixed), then the corner filleted (measured in Fusion:
// accepted, the trimmed lines stay locked, the arc is free)
import { selectionLockState } from '#ui/input-manager.js';
const lineGeom = (S, id) => { const s = S.state.shapes.find(x => x.id === id); const [a, b] = s.joints.map(j => S.state.joints.get(j)); return { a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y }, ang: Math.atan2(b.y - a.y, b.x - a.x) }; };
for (const lockedSet of ['both', 'one']) {
  const { S, r, jid } = lockedRect();
  S.state.joints.get(jid).fixed = false;                       // start from a clean rectangle: only the Lock action below fixes anything
  const two = r.lines.map(id => S.state.shapes.find(s => s.id === id)).filter(s => s.joints.some(x => x === jid || S.state.constraints.some(c => c.type === 'coincident' && c.joints.includes(jid) && c.joints.includes(x))));
  assert(two.length === 2, 'two lines at the corner');
  const toLock = lockedSet === 'both' ? two : [two[0]];
  const other = lockedSet === 'both' ? null : two[1];
  S.state.selectedShapes = new Set(toLock.map(s => s.id));
  S.state.selectedJoints = new Set();
  const otherBefore0 = other && lineGeom(S, other.id);
  for (const s of toLock) s.joints.forEach(x => { S.state.joints.get(x).fixed = true; });
  assert(S.engine.solve(L.ITER).converged, `${lockedSet}: solves locked`);
  const before = { n: L.nullity(S), free: L.freedom(S).free };
  const geom0 = Object.fromEntries(toLock.map(s => [s.id, lineGeom(S, s.id)]));
  const fixedAt0 = Object.fromEntries(toLock.flatMap(s => s.joints.map(x => { const j = S.state.joints.get(x); return [x, { x: j.x, y: j.y }]; })));
  const corner = findCornerBetweenLines(S.state, two[0], two[1]);
  assert(corner, `${lockedSet}: corner found`);
  const res = applyFillet(S.state, corner, 8);
  assert(res && res.success, `${lockedSet}: fillet accepted: ${res && res.reason}`);
  assert(S.engine.solve(L.ITER).converged, `${lockedSet}: solves after the fillet`);
  const after = { n: L.nullity(S), free: L.freedom(S).free };
  console.log(`[${lockedSet} locked] nullity ${before.n} -> ${after.n}; free before ${JSON.stringify(before.free)}; free after ${JSON.stringify(after.free)}`);
  const arc = S.state.shapes.find(s => s.type === 'arc');
  // the lines: trimmed lines of the locked set must not move or turn
  const freeIds = new Set(after.free.map(f => f.id));
  for (const s of toLock) {
    assert(s.joints.every(x => S.state.joints.has(x)), `${lockedSet}: line joints exist`);
    const g = lineGeom(S, s.id);
    assert(near(g.ang, geom0[s.id].ang), `${lockedSet}: line ${s.id} direction unchanged`);
  }
  // far-end joints (not the tangent end) are still fixed at the same positions
  for (const [x, p] of Object.entries(fixedAt0)) {
    const j = S.state.joints.get(x);
    if (j) assert(j.fixed === true && near(j.x, p.x) && near(j.y, p.y), `${lockedSet}: joint ${x} still fixed at its place`);
  }
  // re-solve from a small jitter: directions come back unchanged
  for (const jidk of S.state.joints.keys()) { const j = S.state.joints.get(jidk); if (!j.fixed) { j.x += 0.7; j.y -= 0.5; } }
  assert(S.engine.solve(L.ITER).converged, `${lockedSet}: re-solves after a jitter`);
  for (const s of toLock) assert(near(lineGeom(S, s.id).ang, geom0[s.id].ang, 1e-3), `${lockedSet}: line ${s.id} direction unchanged after the jitter`);
  assert(after.n === before.n, `${lockedSet}: the fillet adds no freedom (${before.n} -> ${after.n}): the radius is dimensioned, the arc is held by tangents`);
  assert(JSON.stringify(after.free.map(f => f.id + f.dirs)) === JSON.stringify(before.free.map(f => f.id + f.dirs)), `${lockedSet}: the same joints are free in the same directions as before`);
  // which trimmed-line joints remain free
  const tangentEnds = toLock.map(s => s.joints.find(x => !fixedAt0[x]));
  assert(tangentEnds.every(x => x && !freeIds.has(x)), `${lockedSet}: the new tangent ends are not free (held by the tangent, the radius and the locked far end)`);
  console.log(`[${lockedSet} locked] tangent-end joints ${JSON.stringify(tangentEnds)} free after: ${tangentEnds.map(x => freeIds.has(x))}`);
  // Lock state of each trimmed line afterwards (reported, not changed)
  for (const s of toLock) {
    S.state.selectedShapes = new Set([s.id]);
    console.log(`[${lockedSet} locked] selectionLockState(line ${s.id}) = ${JSON.stringify(selectionLockState(S.state))}`);
  }
  if (other) {
    const og = lineGeom(S, other.id);
    console.log(`[one locked] other line ${other.id} before ${JSON.stringify(otherBefore0)} after ${JSON.stringify(og)}`);
  }
}
console.log('task 524 tests passed');
