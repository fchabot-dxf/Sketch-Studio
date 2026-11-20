// tests/transform-753-node.test.js — TASK 753 (node): the ONE core transform of a user group (#core/transform.js) and the two group locks
// (#core/group-model.js GROUP_LOCKS).
//  1. transformShapes on every shape kind (line, arc, circle radius, bezier control points) and nested groups; rotate +a then -a, scale s then
//     1/s: back to the start within 1e-9; a rotate keeps every distance, a scale multiplies every distance by s;
//  2. the box (groupBox) and the snaps (snapAngle, quarterTurns);
//  3. refusals with their reason: Lock size & angle, Full lock, a locked CHILD group, a fixed member, a member on the origin, a rectangular
//     pattern inside, a formula-valued length; a plain imported-style group (no constraints) never refuses;
//  4. horizontal / vertical inside: 90 / 270 swap H <-> V (and an H / V dimension's mode), 180 keeps them, 30 asks ONE confirm (the count),
//     confirmed it removes them (dimensions made reference) and the rest still holds; the plan is never applied without the confirm;
//  5. scale: an inside driving length dimension x s in the same step; uniform (every length ratio constant);
//  6. outside constraints: a free outside line coincident with a member follows; a member dimensioned to a fixed point shifts the group (the
//     dimension still holds); two outside horizontals to fixed points cannot both follow a turn: refused, NOTHING changed;
//  7. Full lock: the solver pins the block (rigidBlocks' hold), every member 0 DOF in the status (colours), a drag does not move it; Lock size
//     & angle alone: the drag still moves it; entering the full-locked group frees its curves;
//  8. the lock flags: saved / loaded (serializeDocument / deserializeDocument), undone / redone, absent when off (a document without locks saves
//     exactly as before), a group made or imported starts unlocked;
//  9. exports: a document's Shaper SVG / SketchStudio SVG + DXF are byte-identical with and without the lock flags; an UNtransformed
//     document is unchanged by the box being shown (nothing is written until a transform runs).
import assert from 'node:assert';
import { createEngine } from '#core/constraint-solver.js';
import { createSketchState } from '#core/sketch-state.js';
import { makeGroup, enterGroup, leaveGroups, rigidBlocks, shapesInGroup, GROUP_LOCKS, FULL_LOCK_HOLD, groupLockState, setGroupLock, lockHolder } from '#core/group-model.js';
import { ConstraintManager } from '#core/constraint-manager.js';
import { analyzeConstraintStatus } from '#core/constraint-status.js';
import { serializeDocument, deserializeDocument } from '#core/document.js';
import { makeRectFromTwoJoints } from '#core/shapes.js';
import SettingsManager from '#core/settings-manager.js';
import { transformPoint, transformShapes, groupBox, snapAngle, quarterTurns, planGroupTransform, runGroupTransform, transformConfirmText,
  TRANSFORM_EFFECT, effectKey, ROTATE_SNAP_DEG } from '#core/transform.js';
import { measureResidual } from '#core/constraint-verifier.js';
import fs from 'node:fs';
import path from 'node:path';
import { open } from './helpers/node-app.js';
import { buildSVG, buildDXF } from '../apps/sketchstudio/ui/export-manager.js';
import { planEntries } from '../apps/shaper/src/cut-plan.js';
import { shaperSvgOf, shaperPreviewOf } from '../apps/shaper/src/export-payload.js';

SettingsManager.set('GRID_MAGNETISM', 0.001, { persist: 'none' });
let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };
const near = (a, b, tol, m) => ok(Math.abs(a - b) <= tol, `${m}: ${a} vs ${b}`);
const quietly = (fn) => { const log = console.log, warn = console.warn; console.log = () => {}; console.warn = () => {}; try { return fn(); } finally { console.log = log; console.warn = warn; } };
const D = Math.PI / 180;

function mk() {
  const engine = createEngine(null); engine.init();
  const st = createSketchState(engine, { x: 0, y: 0, w: 200, h: 200 });
  let n = 0;
  const P = (x, y, fixed = false) => { const id = 'p' + (++n); st.joints.set(id, { x, y, fixed }); return id; };
  const add = (s) => { s.id = s.id || (s.type[0].toUpperCase() + (++n)); st.shapes.push(s); return s.id; };
  const line = (a, b) => add({ type: 'line', joints: [a, b] });
  const loop = (pts) => { const ids = pts.map(([x, y]) => P(x, y)); return ids.map((id, i) => line(id, ids[(i + 1) % ids.length])); };
  const letter = (x, y, name) => { const shapes = [...loop([[x, y], [x + 20, y], [x + 20, y + 40], [x, y + 40]]), ...loop([[x + 5, y + 5], [x + 15, y + 5], [x + 15, y + 35], [x + 5, y + 35]])]; const g = name ? makeGroup(st, shapes, name) : null; return { shapes, g, joints: jointsOf(st, shapes) }; };
  const cm = (type, params) => quietly(() => ConstraintManager.createConstraint(st, type, params, { source: 'test' }));
  return { engine, st, P, add, line, loop, letter, cm };
}
const jointsOf = (st, shapeIds) => [...new Set(st.shapes.filter((s) => shapeIds.includes(s.id)).flatMap((s) => s.joints))];
const posOf = (st, ids) => ids.map((id) => { const j = st.joints.get(id); return { x: j.x, y: j.y }; });
const pairDists = (ps) => { const out = []; for (let i = 0; i < ps.length; i++) for (let k = i + 1; k < ps.length; k++) out.push(Math.hypot(ps[i].x - ps[k].x, ps[i].y - ps[k].y)); return out; };
const geometry = (st) => JSON.stringify({ j: [...st.joints].map(([id, j]) => [id, j.x, j.y]), s: st.shapes.map((s) => [s.id, s.radius, s.c1, s.c2]) });
const centre = (st, gid) => { const b = groupBox(st, gid); return { x: b.cx, y: b.cy }; };
const maxResidual = (st) => Math.max(0, ...st.constraints.filter((c) => !c.isDriven && !c.driven).map((c) => measureResidual(c, st.joints, st.shapes)));

// ---- 1. the geometry rewrite on every shape kind, nested groups, round trips
{
  const t = mk(), { st, P, add } = t;
  const l = add({ type: 'line', joints: [P(0, 0), P(30, 10)] });
  const arc = add({ type: 'arc', subType: 'CENTER', joints: [P(50, 50), P(60, 50), P(50, 40)] });
  const circ = add({ type: 'circle', joints: [P(80, 20)], radius: 7 });
  const bez = add({ type: 'bezier', joints: [P(0, 60), P(40, 70)], c1: [10, 90], c2: [30, 40] });
  const inner = makeGroup(st, [arc, circ], 'inner');
  const outer = makeGroup(st, [l, bez, ...shapesInGroup(st, inner.id)], 'outer');
  eq(shapesInGroup(st, outer.id).length, 4, 'the outer group holds the line, the bezier and the nested group (arc + circle)');
  const ids = shapesInGroup(st, outer.id), js = jointsOf(st, ids);
  const g0 = geometry(st), p0 = posOf(st, js), r0 = st.shapes.find((s) => s.id === circ).radius;
  const B = st.shapes.find((s) => s.id === bez);
  const ctrl0 = [...B.c1, ...B.c2];
  const pivot = { x: 13.7, y: -4.2 };
  transformShapes(st, ids, { pivot, angle: 37 * D, scale: 1 });
  const p1 = posOf(st, js);
  const d0 = pairDists([...p0, { x: ctrl0[0], y: ctrl0[1] }]), d1 = pairDists([...p1, { x: B.c1[0], y: B.c1[1] }]);
  ok(d0.every((d, i) => Math.abs(d - d1[i]) < 1e-9), 'a rotate keeps every distance (joints and the bezier control point)');
  const q = transformPoint({ x: ctrl0[2], y: ctrl0[3] }, { pivot, angle: 37 * D, scale: 1 });
  ok(Math.abs(q.x - B.c2[0]) < 1e-12 && Math.abs(q.y - B.c2[1]) < 1e-12, 'the bezier c2 is rotated with its curve (shape data, not a joint)');
  eq(st.shapes.find((s) => s.id === circ).radius, r0, 'a rotate keeps the circle radius');
  transformShapes(st, ids, { pivot, angle: -37 * D, scale: 1 });
  const back = posOf(st, js);
  ok(back.every((p, i) => Math.hypot(p.x - p0[i].x, p.y - p0[i].y) < 1e-9) && Math.hypot(B.c1[0] - ctrl0[0], B.c1[1] - ctrl0[1]) < 1e-9, 'rotate +37 then -37: every joint and control point back within 1e-9');
  transformShapes(st, ids, { pivot, angle: 0, scale: 1.75 });
  const p2 = posOf(st, js), d2 = pairDists(p2), dd0 = pairDists(p0);
  ok(dd0.every((d, i) => Math.abs(d2[i] - 1.75 * d) < 1e-9), 'a scale x1.75 multiplies EVERY distance by 1.75 (uniform)');
  near(st.shapes.find((s) => s.id === circ).radius, r0 * 1.75, 1e-12, 'the circle radius x1.75');
  const arcS = st.shapes.find((s) => s.id === arc), [ac, a1, a2] = arcS.joints.map((id) => st.joints.get(id));
  near(Math.hypot(a1.x - ac.x, a1.y - ac.y), 17.5, 1e-9, 'the arc radius (its rim joints) x1.75');
  near(Math.hypot(a2.x - ac.x, a2.y - ac.y), 17.5, 1e-9, 'both rims');
  transformShapes(st, ids, { pivot, angle: 0, scale: 1 / 1.75 });
  const back2 = posOf(st, js);
  ok(back2.every((p, i) => Math.hypot(p.x - p0[i].x, p.y - p0[i].y) < 1e-9) && Math.abs(st.shapes.find((s) => s.id === circ).radius - r0) < 1e-12, 'scale 1.75 then 1/1.75: back within 1e-9');
  ok(JSON.parse(geometry(st)).j.every(([id, x, y], i) => Math.abs(x - JSON.parse(g0).j[i][1]) < 1e-9 && Math.abs(y - JSON.parse(g0).j[i][2]) < 1e-9), 'the whole document geometry is back');
  // 2. the box and the snaps
  const b = groupBox(st, outer.id);
  ok(b && Math.abs(b.minX) < 1e-9 && Math.abs(b.maxX - 87) < 1e-9 && Math.abs(b.cx - 43.5) < 1e-9, 'groupBox: exact extents (the circle to its rim): ' + JSON.stringify(b));
  near(snapAngle(14 * D), 15 * D, 1e-12, 'the rotate snaps to 15 within the magnet');
  near(snapAngle(11 * D), 11 * D, 1e-12, 'outside the magnet it is free');
  near(snapAngle(11 * D, true), 15 * D, 1e-12, 'Shift: the nearest 15 always');
  eq(ROTATE_SNAP_DEG, 15, 'the declared snap step');
  eq([quarterTurns(Math.PI / 2), quarterTurns(Math.PI), quarterTurns(-Math.PI / 2), quarterTurns(30 * D)], [1, 2, 3, null], 'quarterTurns');
}

// ---- 3. refusals and their reasons
{
  const t = mk(), { st } = t;
  const A = t.letter(0, 0, 'A');
  const op = { pivot: { x: 10, y: 20 }, angle: 30 * D, scale: 1 };
  const plain = runGroupTransform(st, A.g.id, op);
  ok(plain.ok, 'a plain group (no constraints, like an import) rotates: ' + JSON.stringify(plain.reason));
  ok(quietly(() => runGroupTransform(st, A.g.id, { ...op, angle: 0, scale: 2.5 })).ok, 'and scales');
  setGroupLock(st, A.g.id, 'sizeAngle', true);
  eq(planGroupTransform(st, A.g.id, op).reason, 'A has Lock size & angle on: unlock it to rotate', 'Lock size & angle refuses a rotate');
  eq(planGroupTransform(st, A.g.id, { ...op, angle: 0, scale: 2 }).reason, 'A has Lock size & angle on: unlock it to scale', '... and a scale');
  ok(planGroupTransform(st, A.g.id, { ...op, angle: 0, scale: 1 }).ok, '... not a plain move (identity)');
  setGroupLock(st, A.g.id, 'sizeAngle', false); setGroupLock(st, A.g.id, 'full', true);
  eq(planGroupTransform(st, A.g.id, op).reason, 'A has Full lock on: unlock it to rotate', 'Full lock refuses a rotate');
  eq(groupLockState(st, A.g.id), { sizeAngle: true, full: true }, 'Full lock implies Lock size & angle');
  setGroupLock(st, A.g.id, 'full', false);
  // a locked CHILD
  const Bl = t.letter(40, 0, 'B');
  const file = makeGroup(st, [...A.shapes, ...Bl.shapes], 'file');
  setGroupLock(st, Bl.g.id, 'sizeAngle', true);
  eq(lockHolder(st, file.id, 'sizeAngle'), Bl.g.id, 'lockHolder finds the locked child');
  eq(planGroupTransform(st, file.id, op).reason, 'B has Lock size & angle on: unlock it to rotate', 'a locked child refuses the parent rotate');
  setGroupLock(st, Bl.g.id, 'sizeAngle', false);
  // a fixed member
  st.joints.get(A.joints[2]).fixed = true;
  eq(planGroupTransform(st, A.g.id, op).reason, 'a point of A is fixed: unlock it to rotate', 'a fixed point inside refuses');
  st.joints.get(A.joints[2]).fixed = false;
  // a member coincident with the origin
  const t2 = mk(), O = t2.letter(-10, -10, 'O');
  const og = t2.cm('coincident', { joints: [O.joints[0], 'j_origin'] });
  ok(og, 'the corner made coincident with the origin');
  eq(planGroupTransform(t2.st, O.g.id, { pivot: { x: 0, y: 0 }, angle: 0, scale: 2 }).reason, 'a point of O is fixed: unlock it to scale', 'a member on the origin refuses');
  // a formula-valued inside length (a dimension inside, made while the group is entered)
  const t3 = mk(), F = t3.letter(0, 0, 'F');
  enterGroup(t3.st, F.g.id);
  const dim = t3.cm('distance', { joints: [F.joints[0], F.joints[1]], value: 20 });
  ok(dim && !dim.isDriven, 'inside the entered group the dimension is driving');
  leaveGroups(t3.st);
  dim.expression = 'W'; dim.name = 'd1';
  eq(planGroupTransform(t3.st, F.g.id, { pivot: { x: 0, y: 0 }, angle: 0, scale: 2 }).reason, 'the size of F is set by d1 = W: change that value instead', 'a formula-valued length refuses a scale');
  ok(planGroupTransform(t3.st, F.g.id, { pivot: { x: 0, y: 0 }, angle: 30 * D, scale: 1 }).ok, '... a rotate keeps it (a length is unchanged by a turn)');
  // the table: every constraint type has a row
  for (const type of ['coincident', 'pointOnLine', 'horizontal', 'vertical', 'parallel', 'perpendicular', 'collinear', 'tangent', 'equal', 'midpoint', 'symmetric', 'angle', 'distance', 'offset', 'circularPattern', 'rectangularPattern']) ok(TRANSFORM_EFFECT[effectKey({ type })], 'TRANSFORM_EFFECT declares ' + type);
  eq(effectKey({ type: 'distance', dimMode: 'vertical' }), 'distanceHV', 'an H / V dimension has its own row');
  // a rectangular pattern inside
  const fake = { type: 'rectangularPattern', sources: { shapes: [A.shapes[0]] }, instances: [{ joints: [A.joints[1], A.joints[2]], shapes: [A.shapes[1]] }] }; // copies inside the group
  st.constraints.push(fake);
  eq(planGroupTransform(st, A.g.id, op).reason, 'Rectangular pattern inside A cannot turn with it yet', 'a rectangular pattern inside refuses a rotate');
  st.constraints.pop();
}

// ---- 4. horizontal / vertical inside (a hand-made rectangle: 2 horizontal + 2 vertical)
function rectGroup() {
  const t = mk(), { st } = t;
  const a = t.P(0, 0), c = t.P(40, 20);
  const res = makeRectFromTwoJoints(st.joints, a, c, () => 'r' + Math.random().toString(36).slice(2, 8));
  for (const s of res.shapes) st.shapes.push(s);
  for (const k of res.constraints) t.cm(k.type, k);
  const g = makeGroup(st, res.shapes.map((s) => s.id), 'Rect');
  quietly(() => st.engine.solve(500));
  return { t, st, g, ids: res.shapes.map((s) => s.id) };
}
{
  const R = rectGroup(), { st, g } = R;
  const hv = () => st.constraints.filter((c) => c.type === 'horizontal' || c.type === 'vertical').map((c) => c.type).sort();
  eq(hv(), ['horizontal', 'horizontal', 'vertical', 'vertical'], 'the rectangle holds 2 H + 2 V');
  const box = groupBox(st, g.id), pivot = { x: box.cx, y: box.cy };
  const before = st.constraints.filter((c) => c.type === 'horizontal').map((c) => c.joints.join());
  const r90 = quietly(() => runGroupTransform(st, g.id, { pivot, angle: Math.PI / 2, scale: 1 }));
  ok(r90.ok && r90.plan.swaps.length === 4 && !r90.plan.confirm, 'rotate 90: no confirm, the 4 H / V swapped');
  eq(st.constraints.filter((c) => c.type === 'vertical').map((c) => c.joints.join()).sort(), before.sort(), 'the former horizontals are now verticals');
  ok(maxResidual(st) < 1e-6, 'everything still holds after 90: ' + maxResidual(st));
  const b2 = groupBox(st, g.id);
  ok(Math.abs(b2.w - 20) < 1e-6 && Math.abs(b2.h - 40) < 1e-6, 'the 40 x 20 rectangle is now 20 x 40');
  const r180 = quietly(() => runGroupTransform(st, g.id, { pivot, angle: Math.PI, scale: 1 }));
  ok(r180.ok && !r180.plan.swaps.length && maxResidual(st) < 1e-6, '180: the H / V kept as they are, all hold');
  const n0 = st.constraints.length, g0 = geometry(st);
  const r30 = quietly(() => runGroupTransform(st, g.id, { pivot, angle: 30 * D, scale: 1 }));
  ok(!r30.ok && r30.plan && r30.plan.confirm === 4, 'rotate 30: asks a confirm for 4 constraints');
  eq(r30.needsConfirm, 'Rotating Rect removes 4 horizontal / vertical constraints inside it (Undo brings them back).', 'the confirm text');
  ok(st.constraints.length === n0 && geometry(st) === g0, 'not confirmed: nothing changed');
  const ok30 = quietly(() => runGroupTransform(st, g.id, { pivot, angle: 30 * D, scale: 1 }, { confirmed: true }));
  ok(ok30.ok && st.constraints.length === n0 - 4 && !hv().length, 'confirmed: the 4 H / V removed');
  ok(maxResidual(st) < 1e-6, 'the rest still holds');
  const L = st.shapes.find((s) => s.id === R.ids[0]), [p, q] = L.joints.map((id) => st.joints.get(id));
  near(Math.abs(Math.atan2(q.y - p.y, q.x - p.x)) / D % 90, 60, 1e-6, 'its edges are at 30 / 120 degrees now (mod 90: 60)');
  // an H / V dimension inside swaps its mode at 90 and becomes a reference at 30
  const R2 = rectGroup();
  enterGroup(R2.st, R2.g.id);
  const L2 = R2.st.shapes.find((s) => s.id === R2.ids[0]);
  const hd = R2.t.cm('distance', { joints: [L2.joints[0], L2.joints[1]], value: 40, dimMode: 'horizontal' });
  leaveGroups(R2.st);
  ok(hd && hd.dimMode === 'horizontal' && !hd.isDriven, 'an H dimension inside (driving)');
  const bx = groupBox(R2.st, R2.g.id);
  ok(quietly(() => runGroupTransform(R2.st, R2.g.id, { pivot: { x: bx.cx, y: bx.cy }, angle: -Math.PI / 2, scale: 1 })).ok, 'rotate 90 the other way');
  eq(hd.dimMode, 'vertical', '90: the H dimension became a V dimension');
  ok(maxResidual(R2.st) < 1e-6 && Math.abs(measureResidual(hd, R2.st.joints, R2.st.shapes)) < 1e-6, 'it still reads 40');
  const r = quietly(() => runGroupTransform(R2.st, R2.g.id, { pivot: { x: bx.cx, y: bx.cy }, angle: 20 * D, scale: 1 }));
  eq(r.needsConfirm, 'Rotating Rect removes 4 horizontal / vertical constraints and makes 1 horizontal / vertical dimension reference inside it (Undo brings them back).', '20: one confirm names both');
  ok(quietly(() => runGroupTransform(R2.st, R2.g.id, { pivot: { x: bx.cx, y: bx.cy }, angle: 20 * D, scale: 1 }, { confirmed: true })).ok && hd.isDriven, 'confirmed: the dimension is a reference');
}

// ---- 5. scale with an inside driving length
{
  const t = mk(), { st } = t;
  const A = t.letter(0, 0, 'A');
  enterGroup(st, A.g.id);
  const d = t.cm('distance', { joints: [A.joints[0], A.joints[1]], value: 20 });
  leaveGroups(st);
  const p0 = posOf(st, A.joints), d0 = pairDists(p0);
  const r = quietly(() => runGroupTransform(st, A.g.id, { pivot: { x: 0, y: 0 }, angle: 0, scale: 1.5 }));
  ok(r.ok && r.plan.scales.length === 1, 'scale x1.5 with an inside dimension: done');
  eq(d.value, 30, 'the inside dimension x1.5 in the same step');
  const d1 = pairDists(posOf(st, A.joints));
  ok(d0.every((x, i) => Math.abs(d1[i] / x - 1.5) < 1e-9), 'every length ratio 1.5 (uniform)');
  ok(maxResidual(st) < 1e-6, 'all hold');
}

// ---- 6. outside constraints
{
  // a free outside line coincident with a member: it follows
  const t = mk(), { st } = t;
  const A = t.letter(0, 0, 'A');
  const a = t.P(-30, -30), b = t.P(-5, -5); t.line(a, b);
  t.cm('coincident', { joints: [b, A.joints[1]] });
  const r = quietly(() => runGroupTransform(st, A.g.id, { pivot: { x: 10, y: 20 }, angle: 45 * D, scale: 1 }));
  ok(r.ok, 'rotate with a free line attached: done');
  const e = st.joints.get(b), k = st.joints.get(A.joints[1]);
  ok(Math.hypot(e.x - k.x, e.y - k.y) < 1e-6 && maxResidual(st) < 1e-6, 'the line end followed the corner');
  // a member dimensioned to a FIXED point: the group shifts so the dimension still reads its value
  const t2 = mk(), B = t2.letter(0, 0, 'B'), F = t2.P(-20, -20, true);
  const dim = t2.cm('distance', { joints: [B.joints[0], F], value: 30 });
  ok(dim && !dim.isDriven, 'a driving position dimension');
  const r2 = quietly(() => runGroupTransform(t2.st, B.g.id, { pivot: centre(t2.st, B.g.id), angle: 60 * D, scale: 1.2 }));
  ok(r2.ok && Math.abs(measureResidual(dim, t2.st.joints, t2.st.shapes)) < 1e-6, 'rotate + scale: the dimension still reads 30 (the group shifted)');
  // two outside horizontals to two fixed points cannot both follow a turn: refused, nothing changed
  const t3 = mk(), C = t3.letter(0, 0, 'C'), F1 = t3.P(-50, 0, true), F2 = t3.P(-50, 40, true);
  t3.cm('horizontal', { joints: [C.joints[0], F1] }); t3.cm('horizontal', { joints: [C.joints[3], F2] });
  quietly(() => t3.st.engine.solve(500));
  const g0 = geometry(t3.st), n0 = t3.st.constraints.length;
  const r3 = quietly(() => runGroupTransform(t3.st, C.g.id, { pivot: centre(t3.st, C.g.id), angle: 30 * D, scale: 1 }));
  eq(r3.ok, false, 'two horizontals to fixed points: the rotate is refused');
  eq(r3.reason, 'it would break Horizontal (tied to geometry that cannot follow)', 'with the reason');
  ok(geometry(t3.st) === g0 && t3.st.constraints.length === n0, 'nothing changed');
}

// ---- 7. Full lock holds the group
{
  const t = mk(), { st } = t;
  const A = t.letter(0, 0, 'A');
  setGroupLock(st, A.g.id, 'full', true);
  const blk = rigidBlocks(st)[0];
  ok(blk.shapes.includes(FULL_LOCK_HOLD), 'the full-locked block carries the hold (the origin as a member)');
  const status = analyzeConstraintStatus({ joints: st.joints, shapes: st.shapes, constraints: st.constraints, groups: st.groups, enteredGroupId: st.enteredGroupId });
  ok(A.joints.every((j) => status.fixedJoints.has(j)), 'every member is fixed in the status (0 DOF: the colours show it held)');
  ok(A.shapes.every((s) => status.fixedShapes.has(s)), 'every member shape fixed');
  const p0 = posOf(st, A.joints);
  const drag = (dx, dy) => quietly(() => {
    for (const id of A.joints) { const j = st.joints.get(id); j.dragTarget = { x: j.x + dx, y: j.y + dy }; }
    const j0 = st.joints.get(A.joints[0]);
    st.engine.solve(8, { dragTarget: { jointId: A.joints[0], x: j0.x + dx, y: j0.y + dy, stiffness: 1e4 } });
    for (const id of A.joints) delete st.joints.get(id).dragTarget;
    st.engine.solve(500);
  });
  drag(15, 9);
  ok(posOf(st, A.joints).every((p, i) => p.x === p0[i].x && p.y === p0[i].y), 'a drag does not move a full-locked group');
  // a free outside point dimensioned to a member: the outside point gives, never the group
  const F = t.P(-40, 0); const dim = t.cm('distance', { joints: [F, A.joints[0]], value: 15 });
  ok(dim && posOf(st, A.joints).every((p, i) => p.x === p0[i].x && p.y === p0[i].y), 'a dimension from a free point: the point moves, the group stays');
  st.constraints.splice(st.constraints.indexOf(dim), 1); // (a drag of a group dimensioned to a FREE point barely moves it, locked or not: reported, not this task)
  // Lock size & angle alone: the group still moves
  setGroupLock(st, A.g.id, 'full', false); setGroupLock(st, A.g.id, 'sizeAngle', true);
  ok(!rigidBlocks(st)[0].shapes.includes(FULL_LOCK_HOLD), 'Lock size & angle adds no hold');
  const q0 = posOf(st, A.joints);
  drag(15, 9);
  const q1 = posOf(st, A.joints);
  ok(q1.every((p, i) => Math.abs(p.x - q0[i].x - 15) < 1e-6 && Math.abs(p.y - q0[i].y - 9) < 1e-6), 'Lock size & angle: a drag still moves it rigidly');
  // a full-locked CHILD pins its parent block; entering the full-locked group frees its curves
  setGroupLock(st, A.g.id, 'sizeAngle', false);
  const Bl = t.letter(60, 0, 'B'); const file = makeGroup(st, [...A.shapes, ...Bl.shapes], 'file');
  setGroupLock(st, Bl.g.id, 'full', true);
  ok(rigidBlocks(st).find((b) => b.id === file.id).shapes.includes(FULL_LOCK_HOLD), 'a full-locked child pins the parent block it is in');
  enterGroup(st, file.id);
  ok(rigidBlocks(st).find((b) => b.id === Bl.g.id).shapes.includes(FULL_LOCK_HOLD) && !rigidBlocks(st).find((b) => b.id === A.g.id).shapes.includes(FULL_LOCK_HOLD), 'the file entered: B is held, A free');
  enterGroup(st, Bl.g.id);
  ok(!rigidBlocks(st).some((b) => b.shapes.includes(FULL_LOCK_HOLD)), 'B entered: its curves are free (entering is reshaping)');
  leaveGroups(st);
}

// ---- 8. the lock flags: saved / loaded, undone / redone, absent when off, every new group starts unlocked
{
  const t = mk(), { st } = t;
  const A = t.letter(0, 0, 'A');
  eq(groupLockState(st, A.g.id), { sizeAngle: false, full: false }, 'a made group starts unlocked');
  const plainDoc = JSON.stringify(serializeDocument(st));
  ok(!/lockSizeAngle|fullLock/.test(plainDoc), 'a document without locks saves no lock field');
  st.saveState('lock'); setGroupLock(st, A.g.id, 'sizeAngle', true);
  st.saveState('lock'); setGroupLock(st, A.g.id, 'full', true);
  const doc = serializeDocument(st);
  eq(doc.geometry.groups.find((g) => g.id === A.g.id), { ...A.g, lockSizeAngle: true, fullLock: true }, 'both flags saved flat on the group entry');
  const t2 = mk(); quietly(() => deserializeDocument(JSON.parse(JSON.stringify(doc)), t2.st));
  eq(groupLockState(t2.st, A.g.id), { sizeAngle: true, full: true }, 'loaded back');
  quietly(() => st.undo());
  eq(groupLockState(st, A.g.id), { sizeAngle: true, full: false }, 'undo: Full lock off again');
  quietly(() => st.undo());
  eq(groupLockState(st, A.g.id), { sizeAngle: false, full: false }, 'undo: unlocked');
  quietly(() => st.redo());
  eq(groupLockState(st, A.g.id), { sizeAngle: true, full: false }, 'redo');
  setGroupLock(st, A.g.id, 'sizeAngle', false);
  ok(!('lockSizeAngle' in st.groups.find((g) => g.id === A.g.id)), 'off removes the field');
  eq(GROUP_LOCKS.sizeAngle.label + ' / ' + GROUP_LOCKS.full.label, 'Lock size & angle / Full lock', 'the declared labels');
}

// ---- 9. exports of an UNtransformed document: byte-identical with the file group selected (its box drawn), hovered, and both locks on
{
  const SVG = fs.readFileSync(path.resolve('tests/fixtures/svg/letters-756.svg'), 'utf8');
  const quiet = (fn) => async (...a) => { const log = console.log; console.log = () => {}; try { return await fn(...a); } finally { console.log = log; } };
  for (const host of ['shaper', 'sketchstudio']) {
    const app = await quiet(open)({ host, sidebar: true });
    try {
      const st = app.state;
      await quiet(app.importFile)(SVG, 'letters.svg');
      const file = st.groups.find((g) => !g.parentId);
      const outputs = () => (host === 'shaper' ? (() => { const e = planEntries(); return { svg: shaperSvgOf(st, e), preview: shaperPreviewOf(st, e).svg }; })() : { svg: buildSVG(st), dxf: buildDXF(st) });
      app.frames();
      const plain = outputs();
      const geo0 = geometry(st);
      st.currentTool = 'select';
      for (const id of shapesInGroup(st, file.id)) st.selectedShapes.add(id);
      st.hoverOwner = st.shapes.find((s) => s.userGroupId).id;
      setGroupLock(st, file.id, 'sizeAngle', true); setGroupLock(st, file.id, 'full', true);
      app.frames();
      const drawn = app.svg.querySelector('.tbox');
      ok(drawn && drawn.getAttribute('data-mode') === 'select', host + ': the box is drawn for the selected file group');
      eq(outputs(), plain, host + ': the exports are byte-identical with the box shown and both locks on');
      ok(geometry(st) === geo0, host + ': showing the box and locking wrote no geometry');
      ok(plain.svg.length > 300, host + ': the export has content');
    } finally { await app.close(); }
  }
}

// ---- 10. the typed values (#ui/transform-box.js parseTransformInput) and the box layout's touch targets never overlapping
{
  const { parseTransformInput, boxLayout, TBOX } = await import('#ui/transform-box.js');
  const box = { minX: 0, minY: 0, maxX: 40, maxY: 20, w: 40, h: 20, cx: 20, cy: 10 };
  const r = parseTransformInput('rotate', '30', box);
  near(r.angle, -30 * D, 1e-15, 'typed 30: counter-clockwise on screen (the canvas is y-down: a negative world angle)');
  eq(r.pivot, { x: 20, y: 10 }, 'about the box centre');
  eq(parseTransformInput('rotate', '-45°', box).angle, 45 * D, 'typed -45°');
  eq(parseTransformInput('scale', '150%', box).scale, 1.5, 'typed 150%');
  eq(parseTransformInput('scale', '150', box).scale, 1.5, 'a bare number is a percent');
  near(parseTransformInput('scale', '80 mm', box).scale, 2, 1e-12, 'a width with its unit: 80 mm / 40 mm');
  ok(parseTransformInput('scale', '0', box).error && parseTransformInput('rotate', 'abc', box).error, 'nonsense is refused with a hint');
  for (const coarse of [false, true]) {
    const tiny = { minX: 0, minY: 0, maxX: 0.1, maxY: 0.1, w: 0.1, h: 0.1, cx: 0.05, cy: 0.05 };
    const lay = boxLayout(tiny, 1, coarse), pts = [lay.rotate, ...lay.corners, lay.locks.sizeAngle, lay.locks.full];
    const hit = TBOX.hit[coarse ? 'coarse' : 'fine'];
    let min = Infinity; for (let i = 0; i < pts.length; i++) for (let k = i + 1; k < pts.length; k++) min = Math.min(min, Math.hypot(pts[i].x - pts[k].x, pts[i].y - pts[k].y));
    ok(min >= 2 * hit, `${coarse ? 'touch' : 'mouse'}: on a tiny group no two targets overlap (closest ${min} px >= ${2 * hit})`);
  }
}

console.log(`transform-753-node: ${checks} checks passed`);
