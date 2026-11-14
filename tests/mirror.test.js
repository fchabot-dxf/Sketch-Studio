// tests/mirror.test.js - TASK 585: #core/mirror.js and the Mirror tool's steps (packages/ui/input-handlers/mirror-tool.js) on a headless sketch.
// Every kind (MIRROR_KINDS): lines (about the Y axis, a slanted line), a shared corner, a rectangle (4 lines, coincident corners) -> a CLOSED copy,
// circles, arcs (true mirror, sweep flipped), beziers (control points mirrored), free points. Each: the copy is the exact mirror image, the links
// are symmetric constraints only, the DOF is unchanged (engine nullity = panel DOF = finite-difference nullity), one undo step, redo identical.
// Refusals as data (empty, the line among the objects, a locked sketch, an unknown kind), the copy in the ACTIVE sketch, the tool's two steps and
// the axis rule (REFERENCE_PICK_STEP), save / load.
import assert from 'node:assert';
import * as L from './harness/audit/lib.js';
import { ConstraintManager } from '#core/constraint-manager.js';
import { analyzeConstraintStatus } from '#core/constraint-status.js';
import { mirrorPoint } from '#core/symmetric.js';
import { mirrorObjects, MIRROR_KINDS } from '#core/mirror.js';
import { arcSweepInfo } from '#core/geometry.js';
import { makeBezier } from '#core/shapes.js';
import { serializeDocument, deserializeDocument } from '#core/document.js';
import { addSketch, activateSketch, setSketchLocked } from '#core/sketch-model.js';
import { referenceLinesPickable, REFERENCE_PICK_STEP, referenceShape } from '#core/reference-lines.js';
import { TOOL_MODES, MIRROR_STEPS } from '#core/constants.js';
import { beginMirror, handleMirrorPointerDown, mirrorDone } from '#ui/input-handlers/mirror-tool.js';

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const near = (a, b, tol = 1e-9) => Math.hypot(a.x - b.x, a.y - b.y) <= tol;
const P = (S, id) => { const j = S.state.joints.get(id); return { x: j.x, y: j.y }; };
const panelDof = (S) => analyzeConstraintStatus({ joints: S.state.joints, shapes: S.state.shapes, constraints: S.state.constraints.filter(c => !c.isDriven && !c.driven) }).dof;
function dof(S, label) {
  const n = L.nullity(S), panel = panelDof(S), fd = L.fdJacobian(S);
  ok(panel === n, `${label}: panel DOF ${panel} = engine nullity ${n}`);
  ok(fd.nullity === n, `${label}: finite-difference nullity ${fd.nullity} = ${n}`);
  return n;
}
const lineEnds = (S, id) => { const r = referenceShape(id); if (r) return r.axis === 'axis-x' ? [{ x: 0, y: 0 }, { x: 1, y: 0 }] : [{ x: 0, y: 0 }, { x: 0, y: 1 }]; return L.shape(S, id).joints.map(j => P(S, j)); };
const M = (S, lineId, p) => mirrorPoint(p, ...lineEnds(S, lineId));
const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).filter(k => !['glyphPos', '__visible', '__pos'].includes(k)).sort().map(k => [k, canon(v[k])])) : v);
const docText = (S) => JSON.stringify(canon(serializeDocument(S.state)));

// The common checks of one mirror: the made copy, its links, DOF, one undo step, redo identical, save / load.
function mirrorAndCheck(S, objects, lineId, label) {
  const d0 = dof(S, label + ' before');
  const t0 = docText(S), nShapes = S.state.shapes.length, nCons = S.state.constraints.length, nHist = S.state.history.length;
  const before = S.state.captureUndoSnapshot();
  const res = mirrorObjects(S.state, objects, lineId);
  ok(res.ok, `${label}: mirrored (${res.reason || ''})`);
  S.state.saveStateForce('mirror', before); // the tool's one undo step (recordConstraintStep, tested through the tool below)
  const made = S.state.constraints.slice(nCons);
  ok(made.every(c => c.type === 'symmetric' && c.line === lineId || (c.type === 'equal' && c.joints && c.joints.every(j => res.joints.includes(j)))),
    `${label}: only symmetric links about the line (+ an arc copy's own structural equal): ${made.map(c => c.type)}`);
  ok(S.state.shapes.length === nShapes + objects.shapes.length, `${label}: one copy per object shape`);
  ok(dof(S, label + ' after') === d0, `${label}: the copy adds no DOF (${d0})`);
  const t1 = docText(S);
  ok(S.state.history.length === nHist + 1, `${label}: one undo step`);
  S.state.undo(); ok(docText(S) === t0, `${label}: undo restores the document`);
  S.state.redo(); ok(docText(S) === t1, `${label}: redo is identical`);
  return res;
}

// ------------------------------------------------------------------ A. lines about the Y axis: a slanted line and a free point
{
  const S = L.newSketch();
  const a = L.point(S, 10, 5), b = L.point(S, 40, 25), q = L.point(S, 22, -8);
  const l = L.line(S, a, b);
  const res = mirrorAndCheck(S, { shapes: [l], joints: [q] }, 'ref_axis_y', 'Y axis');
  const c = L.shape(S, res.shapes[0]);
  ok(near(P(S, c.joints[0]), { x: -10, y: 5 }) && near(P(S, c.joints[1]), { x: -40, y: 25 }), 'Y axis: the line mirrored (x negated)');
  ok(near(P(S, res.joints[2]), { x: -22, y: -8 }), 'Y axis: the free point mirrored');
  ok(S.state.constraints.filter(k => k.type === 'symmetric').length === 3, 'Y axis: 3 point links (2 ends + the point)');
  // driving: the original moves, the copy follows
  S.state.joints.get(b).x = 50; S.state.joints.get(b).fixed = true; S.engine.solve(L.ITER);
  ok(near(P(S, c.joints[1]), M(S, 'ref_axis_y', P(S, b)), 1e-6), 'Y axis: moving the original end moves the copy end');
}

// ------------------------------------------------------------------ B. about a SLANTED sketch line; a shared corner (two lines sharing ONE joint)
{
  const S = L.newSketch();
  const m0 = L.point(S, 0, 0), m1 = L.point(S, 30, 40);
  const ML = L.line(S, m0, m1);
  const a = L.point(S, 30, 0), v = L.point(S, 50, 10), b = L.point(S, 60, -10);
  const l1 = L.line(S, a, v), l2 = L.line(S, v, b);
  const res = mirrorAndCheck(S, { shapes: [l1, l2], joints: [] }, ML, 'slanted');
  const [c1, c2] = res.shapes.map(id => L.shape(S, id));
  ok(c1.joints[1] === c2.joints[0], 'slanted: the shared corner stays ONE shared joint in the copy');
  for (const [o, cp] of [[a, c1.joints[0]], [v, c1.joints[1]], [b, c2.joints[1]]]) ok(near(P(S, cp), M(S, ML, P(S, o)), 1e-9), 'slanted: each point is its mirror image');
  ok(res.joints.length === 3 && S.state.constraints.filter(k => k.type === 'symmetric').length === 3, 'slanted: 3 copy points, 3 point links');
}

// ------------------------------------------------------------------ C. a chain joined by COINCIDENT corners (the line tool) and a RECTANGLE
{
  const S = L.newSketch();
  const segs = L.polyline(S, [[20, 10], [40, 10], [40, 30]], false);
  const res = mirrorAndCheck(S, { shapes: segs.map(s => s.id), joints: [] }, 'ref_axis_x', 'chain');
  const [c1, c2] = res.shapes.map(id => L.shape(S, id));
  ok(c1.joints[1] === c2.joints[0], 'chain: the coincident corner (two joints) becomes ONE shared copy joint');
  ok(res.joints.length === 3, 'chain: 3 copy points for 3 distinct places');
  ok(!S.state.constraints.slice(-3).some(c => c.type === 'coincident'), 'chain: no coincident is copied');
}
{
  const S = L.newSketch();
  const R = L.rect(S, 10, 10, 50, 30);
  const res = mirrorAndCheck(S, { shapes: R.lines, joints: [] }, 'ref_axis_y', 'rectangle');
  const copies = res.shapes.map(id => L.shape(S, id));
  const use = new Map();
  for (const s of copies) for (const j of s.joints) use.set(j, (use.get(j) || 0) + 1);
  ok(use.size === 4 && [...use.values()].every(n => n === 2), 'rectangle: the copy is CLOSED: 4 corners, each shared by 2 of its 4 lines');
  const xs = [...use.keys()].map(j => P(S, j));
  ok(xs.every(p => p.x <= -10 + 1e-9 && p.x >= -50 - 1e-9), 'rectangle: the copy lies at x in [-50, -10]');
  ok(copies.every(s => s.groupId && s.groupId === copies[0].groupId && s.groupId !== L.shape(S, R.top).groupId), 'rectangle: the copy is its own closed group');
  ok(res.constraints.filter(c => c.type === 'symmetric').length === 4, 'rectangle: 4 point links (one per corner), no H/V / perpendicular / coincident copied');
}

// ------------------------------------------------------------------ D. circles and ARCS (true mirror: the circle form + the ends; sweep flipped), beziers
{
  const S = L.newSketch();
  const k = L.circle(S, 20, 10, 6);
  const c = L.point(S, 40, 0), s0 = L.point(S, 50, 0), e0 = L.point(S, 40, 10);
  const arc = L.arc(S, c, s0, e0);
  L.shape(S, arc).sweep = true; // increasing angle: 0 -> 90 degrees
  const bz = makeBezier(S.state.joints, L.point(S, 10, 30), L.point(S, 30, 30), [15, 40], [25, 45]).shapes[0];
  S.state.shapes.push(bz);
  const res = mirrorAndCheck(S, { shapes: [k.id, arc, bz.id], joints: [] }, 'ref_axis_y', 'curves');
  const [ck, ca, cb] = res.shapes.map(id => L.shape(S, id));
  ok(ck.type === 'circle' && near(P(S, ck.joints[0]), { x: -20, y: 10 }) && ck.radius === 6, 'circle: centre mirrored, radius copied');
  ok(res.constraints.some(x => x.shapes && x.shapes[0] === k.id && x.shapes[1] === ck.id), 'circle: ONE circle-form symmetric (centre + equal radius)');
  ok(!res.constraints.some(x => x.joints && x.joints[0] === k.c), 'circle: its centre gets no separate point link');
  ok(ca.type === 'arc' && ca.sweep === false, 'arc: the sweep direction flips');
  ok(near(P(S, ca.joints[0]), { x: -40, y: 0 }) && near(P(S, ca.joints[1]), { x: -50, y: 0 }) && near(P(S, ca.joints[2]), { x: -40, y: 10 }), 'arc: centre, start and end mirrored');
  const mid = (cs, ss, es, sw) => { const i = arcSweepInfo(cs, ss, es, { sweep: sw }), a = i.a0 + i.dir * i.span / 2, r = Math.hypot(ss.x - cs.x, ss.y - cs.y); return { x: cs.x + r * Math.cos(a), y: cs.y + r * Math.sin(a), span: i.span }; };
  const mo = mid(P(S, c), P(S, s0), P(S, e0), true), mc = mid(...ca.joints.map(j => P(S, j)), ca.sweep);
  ok(near(mc, M(S, 'ref_axis_y', mo), 1e-9) && Math.abs(mc.span - mo.span) < 1e-12, 'arc: the drawn arc is the mirror image (the sweep midpoint mirrors, same span)');
  ok(res.constraints.some(x => x.shapes && x.shapes[0] === arc && x.shapes[1] === ca.id), 'arc: the circle form (centre + equal radius)');
  ok(res.constraints.some(x => x.joints && x.joints[0] === s0) && res.constraints.some(x => x.joints && x.joints[0] === e0), 'arc: + its two end point links');
  ok(res.constraints.some(x => x.type === 'equal' && x.joints && x.joints[0] === ca.joints[0]), 'arc: the copy has its own arc definition (makeArc\'s structural equal)');
  ok(cb.type === 'bezier' && cb.c1[0] === -15 && cb.c1[1] === 40 && cb.c2[0] === -25 && cb.c2[1] === 45, 'bezier: control points mirrored');
  ok(res.constraints.filter(x => x.joints && (x.joints[0] === bz.joints[0] || x.joints[0] === bz.joints[1])).length === 2, 'bezier: its 2 end points linked');
  // the original arc's radius driven: the copy follows (a true mirror through the solve)
  const before = S.state.captureUndoSnapshot();
  ConstraintManager.createConstraint(S.state, 'distance', { shape: arc, value: 14, isRadius: true }, { source: 'test' });
  S.engine.solve(L.ITER);
  ok([0, 1, 2].every(i => near(P(S, ca.joints[i]), M(S, 'ref_axis_y', P(S, L.shape(S, arc).joints[i])), 1e-6)), 'arc: a radius edit on the original moves the copy to its mirror');
  S.state._restoreSnapshot(before);
  // save / load: the copy, the flipped sweep and the links survive
  const doc = serializeDocument(S.state);
  const T = L.newSketch();
  deserializeDocument(JSON.parse(JSON.stringify(doc)), T.state);
  ok(docText(T) === docText(S), 'save -> load: the same document');
  ok(L.nullity(T) === L.nullity(S), 'save -> load: the same DOF');
}
ok(Object.keys(MIRROR_KINDS).sort().join() === 'arc,bezier,circle,line', 'MIRROR_KINDS declares line, circle, arc, bezier');

// ------------------------------------------------------------------ E. refusals (data, nothing changes) and the ACTIVE sketch
{
  const S = L.newSketch();
  const a = L.point(S, 10, 5), b = L.point(S, 40, 25);
  const l = L.line(S, a, b);
  const m0 = L.point(S, 0, -10), m1 = L.point(S, 0, 10), ML = L.line(S, m0, m1);
  const refused = (objects, line, re, label) => { const t = docText(S), r = mirrorObjects(S.state, objects, line); ok(!r.ok && re.test(r.reason) && docText(S) === t, `${label}: refused (${r.reason}), nothing changed`); };
  refused({ shapes: [], joints: [] }, ML, /select the objects/, 'empty selection');
  refused({ shapes: [l, ML], joints: [] }, ML, /cannot be one of the objects/, 'the mirror line among the objects');
  refused({ shapes: [l], joints: [] }, null, /pick the mirror line/, 'no line');
  refused({ shapes: [l], joints: [] }, a, /pick the mirror line/, 'a point is not a line');
  S.state.shapes.push({ id: 's_odd', type: 'text', joints: [a] });
  refused({ shapes: ['s_odd'], joints: [] }, ML, /a text cannot be mirrored/, 'an unknown kind');
  S.state.shapes.pop();
  const z = L.point(S, 5, 5), zl = L.line(S, z, L.point(S, 5, 5));
  const t1 = docText(S);
  const rz = mirrorObjects(S.state, { shapes: [l], joints: [] }, zl);
  ok(!rz.ok && /no length/.test(rz.reason) && docText(S) === t1, 'a mirror line of no length: refused');
  // a locked sketch: its objects are refused; the copy of an unlocked object lands in the ACTIVE sketch
  const sk2 = addSketch(S.state); activateSketch(S.state, sk2.id);
  ok(setSketchLocked(S.state, 'sketch-1', true).ok, 'sketch 1 locked (the active one is sketch 2)');
  const t2 = docText(S);
  const rl = mirrorObjects(S.state, { shapes: [l], joints: [] }, 'ref_axis_y');
  ok(!rl.ok && /locked sketch/.test(rl.reason) && docText(S) === t2, 'a selection in a locked sketch: refused');
  setSketchLocked(S.state, 'sketch-1', false);
  const ra = mirrorObjects(S.state, { shapes: [l], joints: [] }, 'ref_axis_y');
  ok(ra.ok && ra.shapes.every(id => L.shape(S, id).sketchId === sk2.id) && ra.joints.every(j => S.state.joints.get(j).sketchId === sk2.id),
    'the copy lands in the ACTIVE sketch (sketch 2), the original stays in sketch 1');
  ok(L.shape(S, l).sketchId !== sk2.id, 'the original is not moved');
}

// ------------------------------------------------------------------ F. the TOOL: pre-selection, the two steps, the axis rule, one undo step
{
  const S = L.newSketch();
  const st = S.state;
  const a = L.point(S, 10, 5), b = L.point(S, 40, 25), l = L.line(S, a, b);
  const k = L.circle(S, 20, -10, 4);
  const hit = (shape) => ({ shape, pt: { x: 0, y: 0 } });
  const E = {};
  // no selection: OBJECTS; the axes are not pickable there
  st.currentTool = TOOL_MODES.MIRROR; beginMirror(st);
  ok(st.mirror.step === MIRROR_STEPS.OBJECTS && !referenceLinesPickable(st), 'no pre-selection: OBJECTS step, the axes are not pickable');
  ok(typeof REFERENCE_PICK_STEP[TOOL_MODES.MIRROR] === 'function', 'REFERENCE_PICK_STEP declares the Mirror tool');
  ok(mirrorDone(st) === 'refused' && st.mirror.step === MIRROR_STEPS.OBJECTS, 'Enter with nothing selected: refused, still OBJECTS');
  ok(handleMirrorPointerDown(E, null, st, null, hit(L.shape(S, l))) && st.selectedShapes.has(l), 'a click adds a shape to the objects');
  ok(handleMirrorPointerDown(E, null, st, null, hit(L.shape(S, k.id))) && st.selectedShapes.has(k.id), 'a second shape');
  handleMirrorPointerDown(E, null, st, null, hit(L.shape(S, k.id)));
  ok(!st.selectedShapes.has(k.id), 'a second click on it removes it');
  ok(!handleMirrorPointerDown(E, null, st, null, hit(referenceShape('ref_axis_y'))), 'an axis is no object');
  ok(mirrorDone(st) === 'next' && st.mirror.step === MIRROR_STEPS.LINE && referenceLinesPickable(st), 'Enter: the LINE step; the axes are pickable now');
  ok(handleMirrorPointerDown(E, null, st, null, hit(L.shape(S, l))) && st.mirror.line === null, 'the LINE step: an object as the mirror line is refused');
  ok(mirrorDone(st) === 'wait', 'Enter before a line is picked: nothing happens');
  const h0 = st.history.length, n0 = st.shapes.length;
  ok(handleMirrorPointerDown(E, null, st, null, hit(referenceShape('ref_axis_y'))) && st.mirror.line === 'ref_axis_y' && st.selectedShapes.has('ref_axis_y'), 'the Y axis picked (lit like the selection)');
  ok(st.shapes.length === n0, 'nothing is made before Enter');
  ok(mirrorDone(st) === 'mirrored', 'Enter: mirrored');
  ok(st.shapes.length === n0 + 1 && st.history.length === h0 + 1 && st.history[h0].label === 'mirror', 'one copy, ONE undo step labelled "mirror"');
  ok(st.selectedShapes.size === 0 && st.mirror === null, 'the selection is cleared and the pick ends');
  // a pre-selection: the tool starts at the LINE step
  st.currentTool = TOOL_MODES.MIRROR; st.selectedShapes.add(k.id); beginMirror(st);
  ok(st.mirror.step === MIRROR_STEPS.LINE && st.mirror.objects.shapes.join() === k.id, 'a pre-selection is the objects: the tool starts at the LINE step');
  st.currentTool = TOOL_MODES.SELECT;
  ok(!referenceLinesPickable(st), 'another tool: the axes are not pickable (the stale pick is not read)');
  // a refused confirm leaves no undo step
  st.currentTool = TOOL_MODES.MIRROR; st.mirror.line = 'ref_axis_y';
  st.shapes.splice(st.shapes.findIndex(s => s.id === k.id), 1);
  const h1 = st.history.length;
  ok(mirrorDone(st) === 'refused' && st.history.length === h1, 'a refused mirror (the object is gone): no undo step');
}

console.log(`mirror: ${checks} checks ok`);
