// tests/pattern-658.test.js - TASK 658: #core/pattern.js (Circular / Rectangular Pattern, like Fusion's) on a headless sketch
// (tests/harness/audit/lib.js: the real sketch state, engine and constraint paths the tools use).
//   Fusion's numbers (advisor, Fusion API): total 90 with quantity 4 -> 0 / 30 / 60 / 90 degrees; quantity 6 -> 8 regenerates (8 circles); a
//   circle R1 at (5, 0), 4 copies, the source radius edited -> every copy follows. Rectangular 3 x 2 at 5 / 4 mm. The owner's distance types:
//   quantity 3, Total 10 -> 0 / 5 / 10; Spacing 5 -> 0 / 5 / 10; quantity 3 -> 5 with Total 10 kept -> 0 / 2.5 / 5 / 7.5 / 10.
//   The solver: ONE constraint, the copies have 0 DOF with the sources held, analytic Jacobian = finite differences, no redundant row; a source
//   edit moves the copies; save / load, undo / redo, copy / paste; suppression (a deleted copy suppresses its instance); delete the source /
//   the constraint (the copies stay as plain geometry); symmetric; direction lines; refusals.
import assert from 'node:assert';
import * as L from './harness/audit/lib.js';
import {
  applyPattern, editPattern, patternDefaults, patternOperands, patternRowCount, patternResidual, patternSlots, patternDistanceFor,
  patternHandles, isPatternConstraint
} from '#core/pattern.js';
import { measureResidual } from '#core/constraint-verifier.js';
import { commitDimensionEdit } from '#ui/dimension-seams.js';
import { serializeDocument, deserializeDocument } from '#core/document.js';
import { deleteSelection } from '#core/delete-manager.js';
import { selectionToEnvelope, pasteDocument } from '#ui/clipboard.js';
import { ConstraintManager } from '#core/constraint-manager.js';

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const TOL = 1e-6;
const near = (a, b, msg, tol = TOL) => ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);
const P = (S, id) => { const j = S.state.joints.get(id); return { x: j.x, y: j.y }; };
const shape = (S, id) => S.state.shapes.find(s => s.id === id);
const userAngle = (p, c = { x: 0, y: 0 }) => { let a = Math.atan2(-(p.y - c.y), p.x - c.x) * 180 / Math.PI; if (a < -1e-9) a += 360; return a; };
const patterns = (S) => S.state.constraints.filter(isPatternConstraint);
const CIRC = 'circularPattern', RECT = 'rectangularPattern';

// the solver holds the pattern: sources (and their circle radii) held -> the copies have 0 DOF; analytic Jacobian = finite differences;
// a solve leaves every copy where it was made; the rows = the copies' unknowns (no redundant row)
function solverHolds(S, c, label, alone = true) { // alone: nothing else in the sketch is free (the whole nullity is 0)
  const src = c.sources.points, fixed = new Map();
  for (const j of [...src, ...(c.centre ? [c.centre] : [])]) { const J = S.state.joints.get(j); fixed.set(j, J.fixed); J.fixed = true; }
  for (const id of c.sources.shapes) { const s = shape(S, id); if (s.type === 'circle') S.state.constraints.push({ type: 'distance', shape: s.id, isRadius: true, value: s.radius, __tmp: true }); }
  for (const id of (c.directions || [])) if (id && shape(S, id)) for (const j of shape(S, id).joints) { const J = S.state.joints.get(j); if (!fixed.has(j)) { fixed.set(j, J.fixed); J.fixed = true; } }
  const f = S.engine.jointFreedom();
  const copies = c.instances.flatMap(i => i.joints);
  const free = copies.filter(j => (f.freedom.get(j) || 0) > 0);
  ok(free.length === 0 && (!alone || f.nullity === 0), `${label}: sources held -> the copies are fully defined (free ${free.length}, nullity ${f.nullity})`);
  const fd = L.fdJacobian(S);
  ok(fd.worst.length === 0, `${label}: analytic Jacobian = finite differences (${JSON.stringify(fd.worst)})`);
  ok(fd.nullity === f.nullity, `${label}: finite-difference nullity ${fd.nullity} = engine ${f.nullity}`);
  // no redundant row: the pattern's rows + the copies' arc equals = the copies' unknowns
  const unknowns = copies.length * 2 + c.instances.flatMap(i => i.shapes).filter(id => shape(S, id).type === 'circle').length;
  const equals = c.instances.flatMap(i => i.shapes).filter(id => shape(S, id).type === 'arc').length;
  ok(patternRowCount(c, S.state.shapes) + equals === unknowns, `${label}: rows ${patternRowCount(c, S.state.shapes)} + arc equals ${equals} = the copies' unknowns ${unknowns}`);
  for (let i = S.state.constraints.length - 1; i >= 0; i--) if (S.state.constraints[i].__tmp) S.state.constraints.splice(i, 1);
  for (const [j, was] of fixed) S.state.joints.get(j).fixed = was;
  const snap = L.snapshot(S);
  S.engine.solve(L.ITER);
  ok(L.maxDeviation(S, snap) < 1e-6, `${label}: a solve leaves the pattern where it was made`);
  near(measureResidual(c, S.state.joints, S.state.shapes), 0, `${label}: the verifier reads it satisfied`, 1e-9);
}
const make = (S, type, objects, values, label) => {
  const nC = S.state.constraints.length;
  const res = applyPattern(S.state, type, { shapes: [], joints: [], ...objects }, { ...patternDefaults(type), ...values });
  ok(res.ok, `${label}: made (${res.reason})`);
  const mine = S.state.constraints.slice(nC);
  ok(mine.filter(isPatternConstraint).length === 1 && mine.includes(res.constraint), `${label}: ONE pattern constraint`);
  ok(mine.every(k => k === res.constraint || (k.type === 'equal' && k.joints)), `${label}: besides it only the arc copies' structural equals (${mine.map(k => k.type)})`);
  ok(L.residuals(S).max < 1e-9, `${label}: every constraint satisfied as made (${L.describe(L.residuals(S).worst)} ${L.residuals(S).max})`);
  return res;
};
const centresOf = (S, c, si = 0) => c.instances.map(i => P(S, shape(S, i.shapes[si]).joints[0]));

// ---------------------------------------------------------------- circular: Fusion's 90 deg / 4 -> 0, 30, 60, 90; follow; regenerate
{
  const S = L.newSketch();
  const C = L.circle(S, 5, 0, 1);
  const r = make(S, CIRC, { shapes: [C.id] }, { centre: L.origin, quantity: 4, angle: 90 }, 'circular 4 x 90');
  const c = r.constraint;
  ok(c.instances.length === 3 && S.state.shapes.filter(s => s.type === 'circle').length === 4, 'quantity 4 = the source + 3 copies');
  const angles = centresOf(S, c).map(p => userAngle(p));
  [30, 60, 90].forEach((a, k) => near(angles[k], a, `total 90, quantity 4: copy ${k + 1} at ${a} deg`, 1e-9));
  centresOf(S, c).forEach((p, k) => near(Math.hypot(p.x, p.y), 5, `copy ${k + 1} stays 5 from the centre`, 1e-9));
  c.instances.forEach((i, k) => near(shape(S, i.shapes[0]).radius, 1, `copy ${k + 1} R1`, 1e-12));
  solverHolds(S, c, 'circular 4 x 90');
  // the copies FOLLOW the source: its radius dimension 1 -> 1.5 (Fusion: the source diameter edited -> every copy follows)
  ConstraintManager.createConstraint(S.state, 'distance', { shape: C.id, isRadius: true, value: 1 }, { source: 'test' });
  const rad = S.state.constraints.find(k => k.type === 'distance' && k.isRadius && k.shape === C.id);
  const e1 = commitDimensionEdit(S.state, rad, 1.5);
  ok(!e1.reverted, `the source radius 1 -> 1.5 is accepted (${e1.reason || e1.clash})`);
  c.instances.forEach((i, k) => near(shape(S, i.shapes[0]).radius, 1.5, `copy ${k + 1} follows: R 1.5`, 1e-6));
  // the source MOVED (its centre dragged by a solve to (8, 0)): every copy turns with it
  const cen = S.state.joints.get(C.c); cen.x = 8; cen.y = 0; cen.fixed = true;
  S.engine.solve(L.ITER); cen.fixed = false;
  centresOf(S, c).forEach((p, k) => { near(Math.hypot(p.x, p.y), 8, `source moved to 8: copy ${k + 1} 8 from the centre`, 1e-6); near(userAngle(p), 30 * (k + 1), `source moved: copy ${k + 1} still at ${30 * (k + 1)} deg`, 1e-6); });
  // total 360, quantity 6 -> 8 (Fusion: 8 circles); the ONE regenerate path (editPattern -> syncPattern)
  ok(editPattern(S.state, c, { angle: 360, quantity: 6 }).ok, '360 / 6 accepted');
  ok(S.state.shapes.filter(s => s.type === 'circle').length === 6, '360 / 6: 6 circles');
  centresOf(S, c).forEach((p, k) => near(userAngle(p), 60 * (k + 1), `360 / 6: copy ${k + 1} at ${60 * (k + 1)} deg`, 1e-6));
  const keep = c.instances[0].shapes[0];
  ok(editPattern(S.state, c, { quantity: 8 }).ok, 'quantity 6 -> 8 accepted');
  ok(S.state.shapes.filter(s => s.type === 'circle').length === 8 && c.instances.length === 7, `quantity 8: 8 circles (Fusion) (${c.instances.length + 1})`);
  ok(c.instances[0].shapes[0] === keep, 'regenerate keeps the copies it still has (same ids), adds the new ones');
  centresOf(S, c).forEach((p, k) => near(userAngle(p), 45 * (k + 1), `360 / 8: copy ${k + 1} at ${45 * (k + 1)} deg`, 1e-6));
  solverHolds(S, c, 'circular 360 / 8');
  ok(editPattern(S.state, c, { quantity: 3 }).ok && S.state.shapes.filter(s => s.type === 'circle').length === 3, 'quantity 8 -> 3 removes copies (3 circles)');
  ok(S.state.constraints.length === 2, `the removed copies leave nothing behind (constraints: ${S.state.constraints.map(k => k.type)})`);
  // refusals: nothing changes
  const before = JSON.stringify(c), nShapes = S.state.shapes.length;
  for (const [v, why] of [[{ quantity: 1 }, 'quantity'], [{ quantity: 2.5 }, 'quantity'], [{ angle: 0 }, 'angle'], [{ angle: 400 }, 'angle']]) {
    const e = editPattern(S.state, c, v);
    ok(!e.ok && new RegExp(why).test(e.reason), `${JSON.stringify(v)} refused (${e.reason})`);
  }
  ok(JSON.stringify(c) === before && S.state.shapes.length === nShapes, 'a refused edit changes nothing');
  // symmetric (advisor, Fusion API): the quantity is the TOTAL count, the step as without it (total / (N - 1)), the instances around the source,
  // an even count's extra one on the negative side. Fusion: 4 at 90 deg -> -60, -30, 0, 30.
  const symAngles = () => [0, ...centresOf(S, c).map(p => { const a = userAngle(p); return a > 180 ? a - 360 : a; })].map(a => Number(a.toFixed(6))).sort((a, b) => a - b);
  for (const [n, want] of [[4, [-60, -30, 0, 30]], [3, [-45, 0, 45]], [5, [-45, -22.5, 0, 22.5, 45]]]) {
    ok(editPattern(S.state, c, { symmetric: true, angle: 90, quantity: n }).ok, `symmetric 90 / ${n} accepted`);
    ok(JSON.stringify(symAngles()) === JSON.stringify(want) && c.instances.length === n - 1, `symmetric 90 / ${n}: ${want} (${symAngles()})`);
  }
  ok(editPattern(S.state, c, { symmetric: true, angle: 90, quantity: 4 }).ok, 'back to Fusion\'s 4 at 90');
  solverHolds(S, c, 'circular symmetric');
}

// ---------------------------------------------------------------- circular of a line chain + an arc (joined copies, arc equals, 0 DOF)
{
  const S = L.newSketch();
  const segs = L.polyline(S, [[10, 0], [20, 0], [20, -5]], false);
  const ac = L.point(S, 25, -5), as = L.point(S, 20, -5), ae = L.point(S, 25, -10);
  ConstraintManager.createConstraint(S.state, 'coincident', { joints: [segs[1].b, as] }, { source: 'line' });
  const arc = L.arc(S, ac, as, ae);
  const pt = L.point(S, 15, -15);
  const lone = S.state.joints.get(pt); lone.orphanAllowed = true;
  const r = make(S, CIRC, { shapes: [segs[0].id, segs[1].id, arc], joints: [pt] }, { centre: L.origin, quantity: 4, angle: 360 }, 'circular chain + arc + point');
  const c = r.constraint;
  ok(c.sources.points.length === 6, `the joined corners are ONE point each: 6 source points (${c.sources.points.length})`);
  for (const inst of c.instances) {
    const [l1, l2, a] = inst.shapes.map(id => shape(S, id));
    ok(l1.joints[1] === l2.joints[0] && l2.joints[1] === a.joints[1], `instance ${inst.at}: the copy chain is joined (shared joints)`);
    ok(S.state.constraints.some(k => k.type === 'equal' && k.joints && k.joints[0] === a.joints[0] && k.joints[3] === a.joints[2]), `instance ${inst.at}: the arc copy has its structural equal`);
  }
  solverHolds(S, c, 'circular chain + arc + point');
  // a construction source stays construction
  shape(S, segs[0].id).isConstruction = true;
  ok(editPattern(S.state, c, { objects: { shapes: [segs[0].id, segs[1].id, arc], joints: [pt] } }).ok, 're-pick (rebuild) accepted');
  ok(c.instances.every(i => shape(S, i.shapes[0]).isConstruction === true && !shape(S, i.shapes[1]).isConstruction), 'construction copies of a construction source (solid of solid)');
  solverHolds(S, c, 'circular after a re-pick');
  // the centre: a point of its own; refused as one of the loose objects
  const res2 = applyPattern(S.state, CIRC, { shapes: [], joints: [pt] }, { ...patternDefaults(CIRC), centre: pt });
  ok(!res2.ok && /centre/.test(res2.reason), `the centre cannot be one of the objects (${res2.reason})`);
}

// ---------------------------------------------------------------- rectangular: 3 x 2 at 5 / 4 mm; the owner's distance types
{
  const S = L.newSketch();
  const C = L.circle(S, 0, 0, 1);
  const r = make(S, RECT, { shapes: [C.id] }, { quantity: [3, 2], distance: [5, 4] }, 'rectangular 3 x 2');
  const c = r.constraint;
  ok(c.instances.length === 5 && S.state.shapes.length === 6, '3 x 2 = 6 circles');
  const got = centresOf(S, c).map(p => `${Number(p.x.toFixed(6))},${Number((-p.y).toFixed(6))}`).sort();
  ok(JSON.stringify(got) === JSON.stringify(['0,4', '10,0', '10,4', '5,0', '5,4']), `copies at (5i, 4j) user (${got})`);
  solverHolds(S, c, 'rectangular 3 x 2');
  // the owner's node test (distance types), along direction 1
  const xs = () => c.instances.filter(i => i.at[1] === 0).map(i => Number(P(S, shape(S, i.shapes[0]).joints[0]).x.toFixed(6))).sort((a, b) => a - b);
  ok(editPattern(S.state, c, { quantity: [3, 1], distance: [10, 4], distanceType: 'total' }).ok, 'quantity 3, Total 10');
  ok(JSON.stringify([0, ...xs()]) === JSON.stringify([0, 5, 10]), `Total 10, 3 -> 0 / 5 / 10 (${xs()})`);
  ok(patternDistanceFor(c, 0, 'spacing') === 5, 'switching Total -> Spacing keeps the copies: the value becomes 5');
  ok(editPattern(S.state, c, { distance: [patternDistanceFor(c, 0, 'spacing'), 4], distanceType: 'spacing' }).ok, 'Spacing 5');
  ok(JSON.stringify([0, ...xs()]) === JSON.stringify([0, 5, 10]), `Spacing 5, 3 -> 0 / 5 / 10 (${xs()})`);
  ok(editPattern(S.state, c, { distance: [10, 4], distanceType: 'total' }).ok && editPattern(S.state, c, { quantity: [5, 1] }).ok, 'Total 10, quantity 3 -> 5');
  ok(JSON.stringify([0, ...xs()]) === JSON.stringify([0, 2.5, 5, 7.5, 10]), `Total 10 kept, 5 -> 0 / 2.5 / 5 / 7.5 / 10 (${xs()})`);
  solverHolds(S, c, 'rectangular Total 10 / 5');
  // symmetric in direction 1: 3 in total, Total 10 -> spacing 5 as without it, around the source: -5 / 0 / 5
  ok(editPattern(S.state, c, { quantity: [3, 1], symmetric: [true, false] }).ok, 'symmetric 3, Total 10');
  ok(JSON.stringify(xs()) === JSON.stringify([-5, 5]), `symmetric Total 10, 3 -> -5 / 0 / 5 (${xs()})`);
  // the arrow handle sits on the last instance of direction 1, pointing +X
  const h = patternHandles(S.state, c).find(x => x.k === 0);
  ok(h && Math.abs(h.point.x + 5) < 1e-9 && h.dir.x === -1 && h.steps === 1, `the direction-1 arrow at the far-end instance (symmetric: the negative side on a tie) (${JSON.stringify(h)})`);
  ok(editPattern(S.state, c, { quantity: [4, 1], symmetric: [false, false] }).ok, 'not symmetric, 4');
  const h4 = patternHandles(S.state, c).find(x => x.k === 0);
  ok(h4 && Math.abs(h4.point.x - 10) < 1e-9 && h4.dir.x === 1 && h4.steps === 3, `not symmetric: the arrow at the last instance (${JSON.stringify(h4)})`);
  // refusals
  for (const v of [{ quantity: [1, 1] }, { quantity: [0, 2] }, { distance: [0, 4] }]) ok(!editPattern(S.state, c, v).ok, `${JSON.stringify(v)} refused`);
}

// ---------------------------------------------------------------- Fusion's rectangular symmetric case (advisor, Fusion API): a line at x = 200 mm, direction 1
// quantity 3, spacing 20 mm, symmetric -> lines at x = 180, 200, 220 (Fusion's API reported cm: 18 / 20 / 22)
{
  const S = L.newSketch();
  const a = L.point(S, 200, 0), b = L.point(S, 200, -50);
  const ln = L.line(S, a, b);
  const r = make(S, RECT, { shapes: [ln] }, { quantity: [3, 1], distance: [20, 10], distanceType: 'spacing', symmetric: [true, false] }, 'rectangular symmetric 3 at 20');
  const xs = [200, ...r.constraint.instances.map(i => P(S, shape(S, i.shapes[0]).joints[0]).x)].map(x => Number(x.toFixed(6))).sort((p, q) => p - q);
  ok(JSON.stringify(xs) === JSON.stringify([180, 200, 220]), `Fusion: 3 lines at x = 180, 200, 220 (${xs})`);
  solverHolds(S, r.constraint, 'rectangular symmetric');
}

// ---------------------------------------------------------------- rectangular along a picked LINE: the copies follow the line's turn
{
  const S = L.newSketch();
  const a = L.point(S, 0, 0), b = L.point(S, 30, -30);
  const dir = L.line(S, a, b, true);
  const C = L.circle(S, 50, 0, 2);
  const r = make(S, RECT, { shapes: [C.id] }, { quantity: [3, 1], distance: [10, 5], directions: [dir, null] }, 'rectangular along a line');
  const c = r.constraint;
  const q = centresOf(S, c);
  near(q[0].x, 50 + 10 / Math.SQRT2, 'along the 45 deg line: copy 1 x'); near(q[0].y, -10 / Math.SQRT2, 'copy 1 y');
  solverHolds(S, c, 'rectangular along a line');
  const B = S.state.joints.get(b); B.x = 30; B.y = 0; B.fixed = true; S.state.joints.get(a).fixed = true; S.state.joints.get(C.c).fixed = true; // the source held: the copies give way
  S.engine.solve(L.ITER);
  const q2 = centresOf(S, c);
  near(q2[1].x, 70, 'the line turned to horizontal: copy 2 at x 70', 1e-6); near(q2[1].y, 0, 'copy 2 at y 0', 1e-6);
}

// ---------------------------------------------------------------- save / load, undo / redo, copy / paste
{
  const S = L.newSketch();
  const R = L.rect(S, 10, 0, 20, -10);
  const h0 = S.state.history.length, before = S.state.captureUndoSnapshot();
  const r = make(S, CIRC, { shapes: R.lines }, { centre: L.origin, quantity: 5, angle: 360 }, 'circular rectangle');
  S.state.saveStateForce('circular pattern', before);
  ok(S.state.history.length === h0 + 1, 'one undo step');
  solverHolds(S, r.constraint, 'circular rectangle');
  for (const inst of r.constraint.instances) {
    const ls = inst.shapes.map(id => shape(S, id));
    ok(ls.every((l, k) => l.joints[1] === ls[(k + 1) % 4].joints[0] || ls.some(m => m !== l && m.joints.includes(l.joints[1]))), `instance ${inst.at}: the copy rectangle is closed`);
  }
  const doc = serializeDocument(S.state), json = JSON.stringify(doc);
  const shapes0 = S.state.shapes.length;
  S.state.undo();
  ok(S.state.shapes.length === 4 && !patterns(S).length, 'Undo: the pattern and its copies are gone');
  S.state.redo();
  ok(S.state.shapes.length === shapes0 && patterns(S).length === 1 && patternResidual(patterns(S)[0], S.state.joints, S.state.shapes, (s) => s.radius) < 1e-9, 'Redo: back, holding');
  const S2 = L.newSketch();
  ok(deserializeDocument(JSON.parse(json), S2.state).ok, 'the document loads');
  const back = patterns(S2)[0];
  ok(back && JSON.stringify(back) === JSON.stringify(r.constraint), 'save / load keeps the pattern record exactly');
  solverHolds(S2, back, 'circular rectangle loaded');
  ok(editPattern(S2.state, back, { quantity: 3 }).ok && S2.state.shapes.length === 12, 'the loaded pattern regenerates (quantity 5 -> 3: 12 lines)');
  // copy / paste of the WHOLE pattern (the centre is a point of the copy): the pasted pattern holds its own copies
  const S3 = L.newSketch();
  const cc = L.circle(S3, 20, 0, 3), C2 = L.circle(S3, 30, 0, 1);
  const r3 = make(S3, CIRC, { shapes: [C2.id] }, { centre: cc.c, quantity: 4, angle: 360 }, 'circular about a circle centre');
  for (const s of S3.state.shapes) S3.state.selectedShapes.add(s.id);
  const env = selectionToEnvelope(S3.state);
  const pasted = pasteDocument(S3.state, env.document);
  ok(pasted.ok && patterns(S3).length === 2, `the whole pattern pastes as a pattern (${patterns(S3).length})`);
  const p2 = patterns(S3)[1];
  ok(p2.centre !== r3.constraint.centre && p2.instances.every(i => i.shapes.every(id => !r3.constraint.instances.some(j => j.shapes.includes(id)))), 'the pasted pattern names the pasted geometry');
  solverHolds(S3, p2, 'pasted pattern', false);
  // only some copies selected: they paste as plain geometry, no pattern
  S3.state.selectedShapes.clear(); S3.state.selectedShapes.add(r3.constraint.instances[0].shapes[0]);
  const part = pasteDocument(S3.state, selectionToEnvelope(S3.state).document);
  ok(part.ok && patterns(S3).length === 2, 'a copy pasted alone is plain geometry (no new pattern)');
}

// ---------------------------------------------------------------- delete: a copy suppresses its instance; the source / the constraint
{
  const S = L.newSketch();
  const segs = L.polyline(S, [[10, 0], [20, 0], [20, -5]], false);
  const r = make(S, RECT, { shapes: segs.map(x => x.id) }, { quantity: [4, 1], distance: [30, 5] }, 'rectangular chain');
  const c = r.constraint;
  const victim = c.instances[1];
  S.state.selectedShapes.add(victim.shapes[0]);
  deleteSelection(S.state);
  ok(c.suppressed.includes('2,0') && !c.instances.some(i => i.at.join() === '2,0'), `deleting one copy line suppresses its instance (${c.suppressed})`);
  ok(!victim.shapes.some(id => shape(S, id)) && !victim.joints.some(j => S.state.joints.has(j)), 'the instance\'s other copies go too');
  ok(patternSlots(c).filter(x => !x.suppressed).length === 2 && c.instances.length === 2, 'two instances left');
  solverHolds(S, c, 'after a suppression');
  ok(editPattern(S.state, c, { suppressed: [] }).ok && c.instances.length === 3, 'un-suppressing brings the instance back (the regenerate)');
  solverHolds(S, c, 'after un-suppressing');
  // delete the constraint: the copies stay, plain
  const copies = c.instances.flatMap(i => i.shapes);
  S.state.selectedConstraints.add(c);
  deleteSelection(S.state);
  ok(!patterns(S).length && copies.every(id => shape(S, id)), 'deleting the pattern constraint keeps the copies as plain geometry');
  // a new pattern, then delete its SOURCE: the pattern goes, the copies stay
  const r2 = make(S, RECT, { shapes: [segs[0].id] }, { quantity: [2, 1], distance: [0, 5].map((v, k) => (k ? v : 50)) }, 'rectangular one line');
  const copy = r2.constraint.instances[0].shapes[0];
  S.state.selectedShapes.add(segs[0].id);
  deleteSelection(S.state);
  ok(!patterns(S).length && shape(S, copy), 'deleting the source ends the pattern; its copy stays');
}

// ---------------------------------------------------------------- the active sketch (task 659's rule): objects, centre, direction line
{
  const S = L.newSketch(), st = S.state;
  const mk = (x1, y1, x2, y2, sk) => { const a = L.point(S, x1, y1), b = L.point(S, x2, y2); const s = shape(S, L.line(S, a, b)); for (const j of [a, b]) st.joints.get(j).sketchId = sk; s.sketchId = sk; return s; };
  const other = mk(10, 0, 20, 0, 'sketch-2'), own = mk(10, 10, 20, 10, 'sketch-1'), otherDir = mk(0, 30, 10, 40, 'sketch-2');
  st.activeSketchId = 'sketch-1';
  const snap = () => JSON.stringify([[...st.joints], st.shapes, st.constraints]);
  const before = snap();
  const r1 = applyPattern(st, CIRC, { shapes: [other.id], joints: [] }, { ...patternDefaults(CIRC), centre: L.origin });
  ok(!r1.ok && /active sketch/.test(r1.reason), `objects of another sketch are refused (${r1.reason})`);
  const r2 = applyPattern(st, CIRC, { shapes: [own.id], joints: [] }, { ...patternDefaults(CIRC), centre: other.joints[0] });
  ok(!r2.ok && /centre point must be in the active sketch/.test(r2.reason), `a centre of another sketch is refused (${r2.reason})`);
  const r3 = applyPattern(st, RECT, { shapes: [own.id], joints: [] }, { ...patternDefaults(RECT), directions: [otherDir.id, null] });
  ok(!r3.ok && /direction 1 line must be in the active sketch/.test(r3.reason), `a direction line of another sketch is refused (${r3.reason})`);
  ok(snap() === before, 'the refusals wrote nothing');
  const r4 = make(S, CIRC, { shapes: [own.id] }, { centre: L.origin, quantity: 3, angle: 360 }, 'the active sketch, about the origin');
  ok(r4.constraint.instances.every((i) => i.shapes.every((id) => shape(S, id).sketchId === 'sketch-1') && i.joints.every((j) => st.joints.get(j).sketchId === 'sketch-1')), 'the copies land in the active sketch');
}

console.log(`pattern-658: ${checks} checks passed`);
