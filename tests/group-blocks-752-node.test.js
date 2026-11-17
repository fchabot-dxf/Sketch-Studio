// tests/group-blocks-752-node.test.js — TASK 752 (node): a user GROUP that is not entered is ONE rigid block that the solver only TRANSLATES
// (engine.js NewtonSolver._pack: one x/y unknown per block, each member at a constant offset; group-model.js rigidBlocks says which groups).
//  0. documents WITHOUT groups solve bit-identically to before (solverDigest below: solve, a drag, DOF, rank tests on 4 owner documents,
//     its digest recorded on the engine before this task);
//  1. the letter fact: an outside line coincident with one corner of a letter (no inside constraints), dragged: the letter moves whole (every
//     joint by the same vector, every inside distance unchanged to 1e-9) or the line gives; the same drawing without its group deforms;
//  2. a dimension from a block to a fixed point moves the block rigidly when it is placed and when its value is edited (commitDimensionEdits);
//  3. two blocks constrained to each other (a coincident between their corners) meet, neither deforms;
//  4. nested groups (file > letters): not entered = the whole file is ONE block; the file entered = each letter a block; a letter entered =
//     its curves are free (and the other letter is still a block);
//  5. a constraint that would need the block to turn (horizontal on a slanted inside edge; parallel to a held line) is refused through the
//     existing mechanism and nothing moves; pushed past the manager, the solve reports the conflict and the block keeps its shape;
//  6. a circle of a block keeps its radius (not a solver unknown); a bezier's control points move with its block; a rollback
//     (snapshotSolverState / restoreSolverState) restores them;
//  7. DOF / colours (constraint-status): a free block's members are 2 DOF (the block's translation), nothing "constrained"; a fixed member, or a
//     member coincident with the origin, pins the whole block (all members 0 DOF, their shapes constrained) and it does not move; entering the
//     group changes the answer (the status cache holds the blocks);
//  8. rank test (isDimensionDetermined, dimension-seams.js): a dimension between two members of a block that is not entered is DETERMINED; a new
//     one is placed as a reference; the same with the group entered is a driving dimension;
//  9. reshape inside, leave, drag again: the new shape holds (offsets are the positions at each solve, nothing stored);
// 10. grouping / entering / leaving / solving adds nothing to state.constraints;
// 11. Shaper (tests/helpers/node-app.js, real pointer events): the imported word; a Line drawn onto a corner of B (the Line tool), then the line
//     dragged by its middle: B moves whole or the line gives (751's fact 1 turned);
// 12. solve time on a large import (a word of 160 letters, ~2000 joints): unknowns and solve time with the blocks vs the same drawing with
//     its groups taken away (= the solver before this task, section 0).
import assert from 'node:assert';
import { createEngine } from '#core/constraint-solver.js';
import { createSketchState } from '#core/sketch-state.js';
import { makeGroup, enterGroup, leaveGroups, stepOutOfGroup, rigidBlocks, shapesInGroup } from '#core/group-model.js';
import { ConstraintManager } from '#core/constraint-manager.js';
import { analyzeConstraintStatus } from '#core/constraint-status.js';
import { isDimensionDetermined, commitDimensionEdits } from '#core/dimension-seams.js';
import { snapshotSolverState, restoreSolverState } from '#core/solver/engine.js';
import { serializeDocument, deserializeDocument } from '#core/document.js';
import SettingsManager from '#core/settings-manager.js';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { open, createProfile } from './helpers/node-app.js';

SettingsManager.set('GRID_MAGNETISM', 0.001, { persist: 'none' });
let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };
const measured = {};
const quietly = (fn) => { const log = console.log, warn = console.warn; console.log = () => {}; console.warn = () => {}; try { return fn(); } finally { console.log = log; console.warn = warn; } };
const quiet = (fn) => async (...a) => { const log = console.log; console.log = () => {}; try { return await fn(...a); } finally { console.log = log; } };

// ---- 0. no groups: bit-identical to before. ONE digest of what the solver does on documents WITHOUT user groups: for each fixture document,
// load it (the shared document loader), a full solve, a 6-step drag of its first free joint (solve({ dragTarget })), a frame solve, then the
// DOF of every joint (jointFreedom) and the rank test of each driving dimension (isDistanceRedundant). It hashes every joint x / y and circle
// radius (their float64 bytes) and those answers. GOLDEN = this function run on the engine at 93e0164 (before this task).
const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const DIGEST_DOCUMENTS = [
  'owner-trapezoid.document.json',
  'dimension/owner-drag-frozen-589.document.json',
  'dimension/owner-rect-line-line-589.document.json',
  'drag/owner-two-arcs-575.json',
];

function solverDigest() {
  const h = crypto.createHash('sha256');
  const f64 = (v) => { const b = Buffer.alloc(8); b.writeDoubleLE(v); h.update(b); };
  const per = {};
  for (const name of DIGEST_DOCUMENTS) {
    const doc = JSON.parse(fs.readFileSync(path.join(FIX, name), 'utf8'));
    const engine = createEngine(null);
    engine.init();
    const state = createSketchState(engine, { x: 0, y: 0, w: 200, h: 200 });
    const log = console.log; console.log = () => {};
    try {
      const res = deserializeDocument(doc, state);
      if (res && res.ok === false) throw new Error('solver-digest: ' + name + ' did not load: ' + JSON.stringify(res));
      engine.solve(500);
      const id = [...state.joints.keys()].find((k) => k !== 'j_origin' && !state.joints.get(k).fixed);
      const j0 = { ...state.joints.get(id) };
      for (let k = 1; k <= 6; k++) engine.solve(8, { dragTarget: { jointId: id, x: j0.x + 3 * k, y: j0.y - 2 * k, stiffness: 1e4 } });
      engine.solve(500);
    } finally { console.log = log; }
    const fr = engine.jointFreedom();
    const one = crypto.createHash('sha256');
    for (const [jid, j] of state.joints) { h.update(jid); f64(j.x); f64(j.y); one.update(jid + ':' + j.x + ',' + j.y + ';'); h.update(String(fr.freedom.get(jid))); }
    for (const s of state.shapes) if (typeof s.radius === 'number') { h.update(s.id); f64(s.radius); one.update(s.id + ':' + s.radius + ';'); }
    h.update('nullity' + fr.nullity);
    for (const c of state.constraints) if (c.type === 'distance' && !c.isDriven && !c.driven) h.update(c.id + ':' + engine.isDistanceRedundant({ ...c }));
    per[name] = one.digest('hex').slice(0, 16);
  }
  return { digest: h.digest('hex'), per };
}

// (GOLDEN recorded at 93e0164, before task 752)
const GOLDEN = 'ca6725416257adc129ee0593deaf0c2739de25cb5fe1715d42d7c46eb7265b84';
{
  const d = quietly(() => solverDigest());
  measured.digest = d;
  eq(d.digest, GOLDEN, 'documents without groups: solve, drag, DOF and rank answers bit-identical to before task 752');
}

// ---- the kit: a sketch state over its own engine, letters made of loops of lines (shared joints, no constraint: what an import makes)
function mk() {
  const engine = createEngine(null); engine.init();
  const st = createSketchState(engine, { x: 0, y: 0, w: 200, h: 200 });
  let n = 0;
  const P = (x, y, fixed = false) => { const id = 'p' + (++n); st.joints.set(id, { x, y, fixed }); return id; };
  const line = (a, b) => { const s = { id: 'L' + (++n), type: 'line', joints: [a, b] }; st.shapes.push(s); return s.id; };
  const loop = (pts) => { const ids = pts.map(([x, y]) => P(x, y)); return ids.map((id, i) => line(id, ids[(i + 1) % ids.length])); };
  // a letter B-like block: an outline and a hole (two loops, 8 lines, 8 joints)
  const letter = (x, y, name) => { const shapes = [...loop([[x, y], [x + 20, y], [x + 20, y + 40], [x, y + 40]]), ...loop([[x + 5, y + 5], [x + 15, y + 5], [x + 15, y + 35], [x + 5, y + 35]])]; const g = name ? makeGroup(st, shapes, name) : null; return { shapes, g, joints: jointsOf(st, shapes) }; };
  // an outside line from (x, y) to the joint `to` (its end made coincident with it, through the constraint manager)
  const attach = (x, y, to) => { const a = P(x, y), b = P(x + 1, y + 1); const id = line(a, b); quietly(() => ConstraintManager.createConstraint(st, 'coincident', { joints: [b, to] }, { source: 'test' })); return { id, a, b }; };
  return { engine, st, P, line, loop, letter, attach };
}
const jointsOf = (st, shapeIds) => [...new Set(st.shapes.filter((s) => shapeIds.includes(s.id)).flatMap((s) => s.joints))];
const posOf = (st, ids) => ids.map((id) => { const j = st.joints.get(id); return { x: j.x, y: j.y }; });
// rigid: every joint moved by the same vector (spread) and every pairwise distance unchanged (dist)
function rigidity(p0, p1) {
  const v = { x: p1[0].x - p0[0].x, y: p1[0].y - p0[0].y };
  const spread = Math.max(...p1.map((p, i) => Math.hypot(p.x - p0[i].x - v.x, p.y - p0[i].y - v.y)));
  let dist = 0;
  for (let i = 0; i < p0.length; i++) for (let k = i + 1; k < p0.length; k++) dist = Math.max(dist, Math.abs(Math.hypot(p1[i].x - p1[k].x, p1[i].y - p1[k].y) - Math.hypot(p0[i].x - p0[k].x, p0[i].y - p0[k].y)));
  return { v, moved: Math.hypot(v.x, v.y), spread, dist };
}
// a drag the select tool makes (pullDrag): every carried joint pulled to its start + the grab's displacement, a quick solve per step, then the
// frame solve after the release
function drag(t, carried, dx, dy, steps = 6) {
  const { st, engine } = t;
  const init = new Map(carried.map((id) => [id, { ...st.joints.get(id) }]));
  quietly(() => {
    for (let k = 1; k <= steps; k++) {
      for (const id of carried) { const p = init.get(id); st.joints.get(id).dragTarget = { x: p.x + dx * k / steps, y: p.y + dy * k / steps }; }
      const p0 = init.get(carried[0]);
      engine.solve(8, { dragTarget: { jointId: carried[0], x: p0.x + dx * k / steps, y: p0.y + dy * k / steps, stiffness: 1e4 } });
    }
    for (const id of carried) delete st.joints.get(id).dragTarget;
    engine.solve(500);
  });
}

// ---- 1. the letter fact (engine level): the outside line dragged by both ends (a shape drag carries its two joints)
{
  const t = mk(), { st } = t;
  const B = t.letter(10, 10, 'B');
  const L = t.attach(-20, -20, B.joints[0]);
  const p0 = posOf(st, B.joints), l0 = posOf(st, [L.a, L.b]);
  drag(t, [L.a, L.b], 15, -10);
  const r = rigidity(p0, posOf(st, B.joints)), l1 = posOf(st, [L.a, L.b]);
  measured.letter = { ...r, lineMoved: Math.hypot(l1[0].x - l0[0].x, l1[0].y - l0[0].y) };
  ok(r.spread < 1e-9 && r.dist < 1e-9, 'the letter keeps its shape: every joint by the same vector, every inside distance unchanged ' + JSON.stringify(r));
  ok(Math.abs(r.v.x - 15) < 1e-6 && Math.abs(r.v.y + 10) < 1e-6, 'the letter moved whole with the line (nothing holds it): ' + JSON.stringify(r.v));
  const c = st.joints.get(L.b), k = st.joints.get(B.joints[0]);
  ok(Math.hypot(c.x - k.x, c.y - k.y) < 1e-9, 'the line end is still on the corner');
  // the line's FREE end dragged alone: the letter is not pulled apart (it stays or moves whole)
  const q0 = posOf(st, B.joints);
  drag(t, [L.a], -12, 9);
  const r2 = rigidity(q0, posOf(st, B.joints));
  measured.letterFreeEnd = r2;
  ok(r2.spread < 1e-9 && r2.dist < 1e-9, 'dragging the line\'s free end: the letter keeps its shape ' + JSON.stringify(r2));
  // the same drawing WITHOUT its group (= the solver before task 752 for this drawing): the corner is pulled alone, the letter deforms
  const u = mk(), U = u.letter(10, 10, null), UL = u.attach(-20, -20, U.joints[0]);
  const u0 = posOf(u.st, U.joints);
  drag(u, [UL.a, UL.b], 15, -10);
  const ru = rigidity(u0, posOf(u.st, U.joints));
  measured.letterNoGroup = ru;
  ok(ru.dist > 1, 'without the group the corner is pulled alone (the old behaviour of a group): ' + JSON.stringify(ru));
}

// ---- 2. a dimension from a block corner to a fixed point: placed, then its value edited
{
  const t = mk(), { st } = t;
  const B = t.letter(10, 10, 'B');
  const F = t.P(0, -30, true);
  const p0 = posOf(st, B.joints);
  const c = quietly(() => ConstraintManager.createConstraint(st, 'distance', { joints: [B.joints[0], F], value: 60 }, { source: 'test' }));
  ok(c && !c.isDriven, 'the position dimension is driving');
  const a = st.joints.get(B.joints[0]), f = st.joints.get(F);
  const r1 = rigidity(p0, posOf(st, B.joints));
  ok(Math.abs(Math.hypot(a.x - f.x, a.y - f.y) - 60) < 1e-6 && r1.spread < 1e-9 && r1.dist < 1e-9 && r1.moved > 1, 'placed: the block moved rigidly to read 60 ' + JSON.stringify(r1));
  eq(isDimensionDetermined(st, c), false, 'a member-to-fixed-point dimension is not determined (it positions the block)');
  const p1 = posOf(st, B.joints);
  const res = quietly(() => commitDimensionEdits(st, [{ c, value: 75 }]));
  const r2 = rigidity(p1, posOf(st, B.joints));
  measured.dimEdit = { res: { reverted: res.reverted }, ...r2, value: Math.hypot(st.joints.get(B.joints[0]).x - f.x, st.joints.get(B.joints[0]).y - f.y) };
  ok(!res.reverted && Math.abs(measured.dimEdit.value - 75) < 1e-6 && r2.spread < 1e-9 && r2.dist < 1e-9 && r2.moved > 1, 'edited to 75: the block moved rigidly ' + JSON.stringify(measured.dimEdit));
}

// ---- 3. two blocks constrained to each other
{
  const t = mk(), { st } = t;
  const A = t.letter(10, 10, 'A'), B = t.letter(60, 30, 'B');
  const a0 = posOf(st, A.joints), b0 = posOf(st, B.joints);
  const c = quietly(() => ConstraintManager.createConstraint(st, 'coincident', { joints: [A.joints[1], B.joints[0]] }, { source: 'test' }));
  ok(!!c, 'the coincident between two blocks is added');
  const ra = rigidity(a0, posOf(st, A.joints)), rb = rigidity(b0, posOf(st, B.joints));
  const pa = st.joints.get(A.joints[1]), pb = st.joints.get(B.joints[0]);
  measured.twoBlocks = { A: ra, B: rb, gap: Math.hypot(pa.x - pb.x, pa.y - pb.y) };
  ok(measured.twoBlocks.gap < 1e-6 && ra.spread < 1e-9 && rb.spread < 1e-9 && ra.dist < 1e-9 && rb.dist < 1e-9 && ra.moved + rb.moved > 1, 'the corners meet, both blocks keep their shape ' + JSON.stringify(measured.twoBlocks));
  // a third outside line on B: dragging it moves B, and A with it (they are joined by the coincident), both whole
  const L = t.attach(100, 100, B.joints[2]);
  const a1 = posOf(st, A.joints), b1 = posOf(st, B.joints);
  drag(t, [L.a, L.b], 10, 10);
  const ra2 = rigidity(a1, posOf(st, A.joints)), rb2 = rigidity(b1, posOf(st, B.joints));
  ok(ra2.spread < 1e-9 && rb2.spread < 1e-9 && Math.abs(ra2.v.x - rb2.v.x) < 1e-6 && Math.abs(ra2.v.y - rb2.v.y) < 1e-6 && rb2.moved > 1, 'dragging B\'s line: A and B move together, whole ' + JSON.stringify({ ra2, rb2 }));
}

// ---- 4. nested groups: file > letters
{
  const t = mk(), { st } = t;
  const L1 = t.letter(10, 10, 'L1'), L2 = t.letter(60, 10, 'L2');
  const file = makeGroup(st, [...L1.shapes, ...L2.shapes], 'file');
  eq([L1.g.parentId, L2.g.parentId], [file.id, file.id], 'the letters are inside the file group');
  const blocks = () => rigidBlocks(st).map((b) => [b.id, b.shapes.length]);
  eq(blocks(), [[file.id, 16]], 'not entered: the whole file is ONE block');
  const Lin = t.attach(-20, -20, L1.joints[0]);
  const fileJ = [...L1.joints, ...L2.joints];
  let p0 = posOf(st, fileJ);
  drag(t, [Lin.a, Lin.b], 8, 6);
  let r = rigidity(p0, posOf(st, fileJ));
  ok(r.spread < 1e-9 && r.moved > 1, 'not entered: the line drags the whole file (both letters by the same vector) ' + JSON.stringify(r));
  enterGroup(st, file.id);
  eq(blocks(), [[L1.g.id, 8], [L2.g.id, 8]], 'the file entered: each letter is a block');
  p0 = posOf(st, L1.joints); const q0 = posOf(st, L2.joints);
  drag(t, [Lin.a, Lin.b], 8, 6);
  r = rigidity(p0, posOf(st, L1.joints)); const r2 = rigidity(q0, posOf(st, L2.joints));
  ok(r.spread < 1e-9 && r.moved > 1 && r2.moved < 1e-9, 'the file entered: the line drags its letter whole, the other letter stays ' + JSON.stringify({ r, r2 }));
  enterGroup(st, L1.g.id);
  eq(blocks(), [[file.id, 8]], 'the letter entered: its curves are free; the other letter (outside the entered group) is still a block');
  p0 = posOf(st, L1.joints);
  drag(t, [Lin.a, Lin.b], 8, 6);
  r = rigidity(p0, posOf(st, L1.joints));
  ok(r.dist > 1, 'the letter entered: the corner moves alone (free curves) ' + JSON.stringify(r));
  measured.nested = 'ok';
}

// ---- 5. a constraint that needs the block to TURN: refused / a reported conflict, never a deformation
{
  const t = mk(), { st } = t;
  const sh = t.loop([[40, 50], [50, 10], [60, 50]]); // a slanted letter A (a triangle)
  const A = makeGroup(st, sh, 'A');
  const J = jointsOf(st, sh);
  const p0 = posOf(st, J), n0 = st.constraints.length;
  const h = quietly(() => ConstraintManager.createConstraint(st, 'horizontal', { joints: [J[0], J[1]] }, { source: 'test' }));
  const r = rigidity(p0, posOf(st, J));
  measured.rotateHorizontal = { created: !!h, ...r };
  ok(h === null && st.constraints.length === n0 && r.moved === 0 && r.dist === 0, 'horizontal on a slanted inside edge: refused, nothing moves ' + JSON.stringify(measured.rotateHorizontal));
  // parallel between the slanted edge and a HELD horizontal line (both ends fixed)
  const f1 = t.P(0, -10, true), f2 = t.P(30, -10, true), held = t.line(f1, f2);
  const pp = quietly(() => ConstraintManager.createConstraint(st, 'parallel', { shapes: [sh[0], held] }, { source: 'test' }));
  const r2 = rigidity(p0, posOf(st, J));
  measured.rotateParallel = { created: !!pp, ...r2 };
  ok(pp === null && r2.dist < 1e-12, 'parallel to a held line (the block would have to turn): refused, the block keeps its shape ' + JSON.stringify(measured.rotateParallel));
  // past the manager (a constraint already in a document): the solve reports it and the block keeps its shape
  st.constraints.push({ id: 'cH', type: 'horizontal', joints: [J[0], J[1]] });
  const res = quietly(() => t.engine.solve(500));
  const r3 = rigidity(p0, posOf(st, J));
  measured.rotateSolve = { converged: res.converged, conflicts: res.conflicts.map((c) => c.id), ...r3 };
  ok(!res.converged && res.conflicts.some((c) => c.id === 'cH') && r3.dist < 1e-9, 'a horizontal already in the document: the solve reports the conflict, the block keeps its shape ' + JSON.stringify(measured.rotateSolve));
  st.constraints.pop();
  eq(A.id, rigidBlocks(st)[0].id, '(the triangle is a block)');
}

// ---- 6. a circle of a block keeps its radius; a bezier's control points move with its block; a rollback restores them
{
  const t = mk(), { st } = t;
  const B = t.letter(10, 10, null);
  const cc = t.P(40, 20); const circ = { id: 'C1', type: 'circle', joints: [cc], radius: 6 }; st.shapes.push(circ);
  const b0 = t.P(10, 60), b3 = t.P(30, 60); const bz = { id: 'Z1', type: 'bezier', joints: [b0, b3], c1: [12, 70], c2: [28, 50] }; st.shapes.push(bz);
  const lk = t.line(b3, cc);
  makeGroup(st, [...B.shapes, 'C1', 'Z1', lk], 'G');
  const all = jointsOf(st, [...B.shapes, 'C1', 'Z1', lk]);
  const rad = quietly(() => ConstraintManager.createConstraint(st, 'distance', { shape: 'C1', isRadius: true, value: 9 }, { source: 'test' }));
  ok(circ.radius === 6 && (!rad || rad.isDriven), 'a radius dimension on a block circle cannot resize it: radius ' + circ.radius + ', dimension ' + (rad ? (rad.isDriven ? 'reference' : 'driving') : 'refused'));
  ok(!t.engine.jointFreedom().radiusFree.has('C1'), 'the circle radius of a block is not a free unknown');
  if (rad) st.constraints.splice(st.constraints.indexOf(rad), 1);
  const L = t.attach(-20, -20, B.joints[0]);
  const p0 = posOf(st, all), c0 = [[...bz.c1], [...bz.c2]];
  drag(t, [L.a, L.b], 11, 7);
  const r = rigidity(p0, posOf(st, all));
  const cErr = Math.max(Math.hypot(bz.c1[0] - c0[0][0] - r.v.x, bz.c1[1] - c0[0][1] - r.v.y), Math.hypot(bz.c2[0] - c0[1][0] - r.v.x, bz.c2[1] - c0[1][1] - r.v.y));
  measured.circleBezier = { ...r, radius: circ.radius, controlErr: cErr };
  ok(r.spread < 1e-9 && r.moved > 1 && circ.radius === 6 && cErr < 1e-9, 'the block (lines, circle, bezier) moved whole: radius kept, control points carried ' + JSON.stringify(measured.circleBezier));
  const snap = snapshotSolverState(st.joints, st.shapes, st.constraints);
  const c1 = [...bz.c1];
  drag(t, [L.a, L.b], 5, 5);
  ok(Math.abs(bz.c1[0] - c1[0] - 5) < 1e-6, 'a second drag carried the controls again');
  restoreSolverState(st.joints, st.shapes, snap);
  eq(bz.c1, c1, 'restoreSolverState puts the control points back with the joints');
}

// ---- 7. DOF / colours: a free block, a block with a fixed member, a block coincident with the origin; entering changes the answer
{
  const t = mk(), { st } = t;
  const B = t.letter(10, 10, 'B');
  let s = analyzeConstraintStatus(st);
  measured.dofFree = { dof: s.dof, members: B.joints.map((id) => s.jointDOFs.get(id)), constrained: B.shapes.filter((id) => s.constrainedShapes.has(id)).length };
  eq(measured.dofFree, { dof: 2, members: B.joints.map(() => 2), constrained: 0 }, 'a free block: 2 DOF (its translation), each member 2, no member shape constrained (black)');
  const s0 = analyzeConstraintStatus({ joints: st.joints, shapes: st.shapes, constraints: st.constraints });
  eq(s0.dof, 16, 'the same call without the groups (a host that passes none): every joint free (16)');
  st.joints.get(B.joints[3]).fixed = true;
  s = analyzeConstraintStatus(st);
  measured.dofFixed = { dof: s.dof, members: B.joints.map((id) => s.jointDOFs.get(id)), constrained: B.shapes.filter((id) => s.constrainedShapes.has(id)).length };
  eq(measured.dofFixed, { dof: 0, members: B.joints.map(() => 0), constrained: 8 }, 'a fixed member pins the whole block: every member 0 DOF, every shape constrained');
  const L = t.attach(-20, -20, B.joints[0]);
  const p0 = posOf(st, B.joints);
  drag(t, [L.a, L.b], 15, -10);
  eq(rigidity(p0, posOf(st, B.joints)).moved, 0, 'a block with a fixed member does not move (the line gives)');
  enterGroup(st, B.g.id);
  s = analyzeConstraintStatus(st);
  eq(B.joints.map((id) => s.jointDOFs.get(id)), B.joints.map((id) => (id === B.joints[3] ? 0 : (id === B.joints[0] ? 2 : 2))), 'the group entered: only the fixed joint is held (the status cache holds the blocks)');
  leaveGroups(st);
  st.joints.get(B.joints[3]).fixed = false;
  // coincident with the origin pins it too
  const u = mk();
  const C = u.letter(10, 10, 'C');
  quietly(() => ConstraintManager.createConstraint(u.st, 'coincident', { joints: [C.joints[0], 'j_origin'] }, { source: 'test' }));
  const c0 = posOf(u.st, C.joints);
  s = analyzeConstraintStatus(u.st);
  measured.dofOrigin = { dof: s.dof, members: C.joints.map((id) => s.jointDOFs.get(id)), corner: c0[0] };
  ok(s.dof === 0 && C.joints.every((id) => s.jointDOFs.get(id) === 0) && Math.hypot(c0[0].x, c0[0].y) < 1e-9, 'a member coincident with the origin: the block moved onto it whole and is pinned ' + JSON.stringify(measured.dofOrigin));
  const rc = rigidity([{ x: 10, y: 10 }, { x: 30, y: 10 }], posOf(u.st, C.joints.slice(0, 2)));
  ok(rc.spread < 1e-9, 'it moved there rigidly');
}

// ---- 8. rank test: a dimension inside a block
{
  const t = mk(), { st } = t;
  const B = t.letter(10, 10, 'B');
  const probe = { id: 'probe', type: 'distance', joints: [B.joints[0], B.joints[2]], value: 30 };
  measured.determined = { notEntered: isDimensionDetermined(st, probe) };
  const c = quietly(() => ConstraintManager.createConstraint(st, 'distance', { joints: [B.joints[0], B.joints[1]], value: 25 }, { source: 'test' }));
  measured.determined.placed = c ? (c.isDriven ? 'reference' : 'driving') : 'refused';
  ok(measured.determined.notEntered === true && c && c.isDriven && st.joints.get(B.joints[1]).x === 30, 'not entered: a dimension between two members is determined; a new one is placed as a reference, nothing moves ' + JSON.stringify(measured.determined));
  st.constraints.splice(st.constraints.indexOf(c), 1);
  enterGroup(st, B.g.id);
  measured.determined.entered = isDimensionDetermined(st, probe);
  eq(measured.determined.entered, false, 'the group entered: the same dimension is free to drive');
  // a driving dimension made inside the entered group; typed again with the group left: refused (the block cannot resize), entered: applied
  const d = quietly(() => ConstraintManager.createConstraint(st, 'distance', { joints: [B.joints[0], B.joints[1]], value: 20 }, { source: 'test' }));
  ok(d && !d.isDriven, 'inside the entered group the dimension is driving');
  leaveGroups(st);
  const p0 = posOf(st, B.joints);
  const res = quietly(() => commitDimensionEdits(st, [{ c: d, value: 25 }]));
  const r = rigidity(p0, posOf(st, B.joints));
  measured.determined.editLeft = { reverted: res.reverted, value: d.value, moved: r.moved, dist: r.dist };
  ok(res.reverted && d.value === 20 && r.moved === 0 && r.dist === 0, 'the group left: typing 25 into it is refused, nothing moves ' + JSON.stringify(measured.determined.editLeft));
  enterGroup(st, B.g.id);
  const res2 = quietly(() => commitDimensionEdits(st, [{ c: d, value: 25 }]));
  const a = st.joints.get(B.joints[0]), b = st.joints.get(B.joints[1]);
  ok(!res2.reverted && Math.abs(Math.hypot(b.x - a.x, b.y - a.y) - 25) < 1e-6, 'entered again: 25 applies (the letter is reshaped)');
}

// ---- 9. reshape inside, leave, drag again: the new shape holds
{
  const t = mk(), { st } = t;
  const B = t.letter(10, 10, 'B');
  enterGroup(st, B.g.id);
  drag(t, [B.joints[2]], 6, 4); // a corner dragged inside the entered group: the letter is reshaped
  const reshaped = posOf(st, B.joints);
  ok(Math.hypot(reshaped[2].x - 30, reshaped[2].y - 50) > 1, 'inside the entered group the corner moved alone');
  leaveGroups(st);
  const L = t.attach(-20, -20, B.joints[0]);
  const p0 = posOf(st, B.joints);
  drag(t, [L.a, L.b], -9, 12);
  const r = rigidity(p0, posOf(st, B.joints));
  measured.reshape = r;
  ok(r.spread < 1e-9 && r.dist < 1e-9 && r.moved > 1, 'left again: the line drags the reshaped letter whole (the new shape holds) ' + JSON.stringify(r));
}

// ---- 10. grouping / entering / leaving adds nothing to the constraints
{
  const t = mk(), { st } = t;
  const B = t.letter(10, 10, null);
  const L = t.attach(-20, -20, B.joints[0]);
  const before = JSON.stringify(st.constraints);
  const g = makeGroup(st, B.shapes, 'B');
  quietly(() => t.engine.solve(500));
  enterGroup(st, g.id); quietly(() => t.engine.solve(500));
  stepOutOfGroup(st); quietly(() => t.engine.solve(500));
  analyzeConstraintStatus(st);
  eq(JSON.stringify(st.constraints), before, 'state.constraints unchanged by grouping, entering, leaving and the solves');
  eq(JSON.stringify(serializeDocument(st).geometry.constraints), JSON.stringify(serializeDocument(st).geometry.constraints), '(serialized the same)');
  ok(!serializeDocument(st).geometry.groups.some((x) => Object.keys(x).some((k) => !['id', 'name', 'sketchId', 'parentId'].includes(k))), 'nothing about the block is stored on the group');
  void L;
}

// ---- 11. Shaper, real pointer events: a Line drawn onto a corner of the imported letter B, then dragged by its middle
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="200mm" height="60mm" viewBox="0 0 200 60">
  <path id="O" fill="#000000" d="M10 10 H30 V50 H10 Z M15 15 H25 V45 H15 Z"/>
  <path id="B" fill="#000000" d="M70 10 H90 V50 H70 Z M75 15 H85 V27 H75 Z M75 33 H85 V45 H75 Z"/>
</svg>`;
{
  const app = await quiet(open)({ host: 'shaper', profile: await createProfile() });
  try {
    const st = app.state;
    await quiet(app.importFile)(SVG, 'word.svg');
    const G = Object.fromEntries(st.groups.map((g) => [g.name, g]));
    const bIds = shapesInGroup(st, G.B.id), bJ = jointsOf(st, bIds);
    const corner = bJ.map((id) => ({ id, ...st.joints.get(id) })).sort((a, b) => (a.y - b.y) || (a.x - b.x))[0];
    const cs = app.toScreen(corner.x, corner.y);
    app.tool('line');
    const from = { x: cs.x - 40, y: cs.y - 120 };
    quietly(() => { app.click(from.x, from.y); app.move(cs.x, cs.y); app.click(cs.x, cs.y); app.esc(); app.esc(); });
    const Lsh = st.shapes[st.shapes.length - 1];
    const end = Lsh.joints.find((j) => j === corner.id || st.constraints.some((c) => c.type === 'coincident' && c.joints.includes(j) && c.joints.includes(corner.id)));
    ok(Lsh.type === 'line' && !Lsh.userGroupId && !!end, 'the Line tool drew a line ending on B\'s corner (a coincident or the same point)');
    app.tool('select');
    const b0 = posOf(st, bJ), l0 = posOf(st, Lsh.joints);
    const a = st.joints.get(Lsh.joints[0]), b = st.joints.get(Lsh.joints[1]);
    const mid = app.toScreen((a.x + b.x) / 2, (a.y + b.y) / 2);
    await app.pause(600);
    await quiet(async () => app.drag(mid, { x: mid.x + 40, y: mid.y - 30 }, 10))();
    const r = rigidity(b0, posOf(st, bJ)), l1 = posOf(st, Lsh.joints);
    const lineMoved = Math.max(...l1.map((p, i) => Math.hypot(p.x - l0[i].x, p.y - l0[i].y)));
    const e = st.joints.get(end), k = st.joints.get(corner.id);
    measured.shaperLetter = { letterBJoints: bJ.length, ...r, lineMoved, endOnCorner: Math.hypot(e.x - k.x, e.y - k.y) };
    ok(r.spread < 1e-9 && r.dist < 1e-9, 'Shaper: B keeps its shape (moves whole or stays) ' + JSON.stringify(measured.shaperLetter));
    ok(r.moved > 1 || lineMoved > 1, 'Shaper: the drag moved something (the letter whole, or the line)');
    ok(measured.shaperLetter.endOnCorner < 1e-6, 'Shaper: the line still ends on the corner');
  } finally { await app.close(); }
}

// ---- 12. solve time on a large import: blocks vs the same drawing with its groups taken away
{
  const N = 160, cols = 20;
  let body = '';
  for (let i = 0; i < N; i++) { const x = 10 + (i % cols) * 30, y = 10 + Math.floor(i / cols) * 50; body += `<path id="b${i}" fill="#000000" d="M${x} ${y} H${x + 20} V${y + 40} H${x} Z M${x + 5} ${y + 5} H${x + 15} V${y + 17} H${x + 5} Z M${x + 5} ${y + 23} H${x + 15} V${y + 35} H${x + 5} Z"/>`; }
  const big = `<svg xmlns="http://www.w3.org/2000/svg" width="620mm" height="420mm" viewBox="0 0 620 420">${body}</svg>`;
  const app = await quiet(open)({ host: 'shaper', profile: await createProfile() });
  try {
    const st = app.state, engine = st.engine;
    await quiet(app.importFile)(big, 'big.svg');
    const joints = [...st.joints.keys()].filter((id) => st.shapes.some((s) => s.joints.includes(id)));
    const groups = st.groups;
    const corner = st.shapes[0].joints[0];
    const time = (fn, reps) => { fn(); const t0 = process.hrtime.bigint(); for (let i = 0; i < reps; i++) fn(); return Number(process.hrtime.bigint() - t0) / 1e6 / reps; };
    const run = () => quietly(() => {
      const nullity = engine.jointFreedom().nullity;
      const frame = time(() => engine.solve(500), 5);
      const p = { ...st.joints.get(corner) };
      let k = 0;
      const dragStep = time(() => { k++; engine.solve(8, { dragTarget: { jointId: corner, x: p.x + 0.1 * k, y: p.y, stiffness: 1e4 } }); }, 5);
      // a drag of the whole file (the select tool's group drag: every joint carries its target, selection-tools pullDrag)
      const groupDragStep = time(() => { for (const id of joints) { const j = st.joints.get(id); j.dragTarget = { x: j.x + 0.1, y: j.y }; } const j0 = st.joints.get(corner); engine.solve(8, { dragTarget: { jointId: corner, x: j0.x + 0.1, y: j0.y, stiffness: 1e4 } }); }, 5);
      for (const id of joints) delete st.joints.get(id).dragTarget;
      return { unknowns: nullity, frameMs: +frame.toFixed(2), dragStepMs: +dragStep.toFixed(2), groupDragStepMs: +groupDragStep.toFixed(2) };
    });
    const withBlocks = run();
    const snap = snapshotSolverState(st.joints, st.shapes, st.constraints);
    st.groups = []; engine.setGroupState(st);
    const without = run();
    st.groups = groups; engine.setGroupState(st);
    restoreSolverState(st.joints, st.shapes, snap);
    measured.large = { shapes: st.shapes.length, joints: joints.length, groups: groups.length, withBlocks, withoutGroups: without };
    eq(withBlocks.unknowns, 2, 'the whole imported file (not entered) is 2 unknowns: ' + JSON.stringify(measured.large));
    eq(without.unknowns, joints.length * 2, 'the same drawing without its groups: 2 per joint');
  } finally { await app.close(); }
}

console.log('TASK 752 measured: ' + JSON.stringify(measured));
console.log(`group-blocks-752-node: ${checks} checks passed`);
