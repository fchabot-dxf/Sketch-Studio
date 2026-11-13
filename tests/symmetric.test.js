// tests/symmetric.test.js — TASK 563: the SYMMETRIC constraint (like Fusion's Symmetric: entity 1, entity 2, then the symmetry line).
// Through the real seams: ConstraintManager.createConstraint, the real Symmetric tool handler, the engine (DOF = nullspace), the verifier,
// document save / load, undo / redo, the clipboard, the context menu and the who-moves table. Every DOF is checked three ways: the count
// expected, the panel's DOF (analyzeConstraintStatus, what the Design panel shows) and the finite-difference nullity of the rows.
import assert from 'node:assert';
import * as L from './harness/audit/lib.js';
import { ConstraintManager } from '#core/constraint-manager.js';
import { measureResidual } from '#core/constraint-verifier.js';
import { analyzeConstraintStatus } from '#core/constraint-status.js';
import { mirrorPoint } from '#core/symmetric.js';
import { serializeDocument, deserializeDocument } from '#core/document.js';
import { selectionToEnvelope } from '#ui/clipboard.js';
import { deleteSelection } from '#core/delete-manager.js';
import { handleConstraintPointerDown, resetConstraintState } from '#ui/input-handlers/constraint-tools.js';
import { referenceLinesPickable, referenceShape, REFERENCE_PICK_TOOLS, REFERENCE_PICK_STEP } from '#core/reference-lines.js';
import { TOOL_MODES, CONSTRAINT_TOOLS, CONSTRAINT_TYPES } from '#core/constants.js';
import { contextMenuItems, CONSTRAINT_MENU_TYPES } from '#ui/context-menu.js';
import { isDimension } from '#core/parameters.js';
import { WHO_MOVES } from '#core/creation-placement-table.js';
import { firstGivesWay } from '#core/creation-placement.js';

const SYM = CONSTRAINT_TYPES.SYMMETRIC;
let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const near = (a, b, tol = 1e-6) => Math.hypot(a.x - b.x, a.y - b.y) <= tol;
const P = (S, id) => S.state.joints.get(id);
const at = (S, id) => ({ x: P(S, id).x, y: P(S, id).y });
const panelDof = (S) => analyzeConstraintStatus({ joints: S.state.joints, shapes: S.state.shapes, constraints: S.state.constraints.filter(c => !c.isDriven && !c.driven) }).dof;
// the three DOF readings agree: the engine's nullity, the panel's DOF and the finite-difference nullity
function dof(S, label) {
  const n = L.nullity(S), panel = panelDof(S), fd = L.fdJacobian(S);
  ok(panel === n, `${label}: panel DOF ${panel} = engine nullity ${n}`);
  ok(fd.nullity === n, `${label}: finite-difference nullity ${fd.nullity} = ${n}`);
  ok(fd.worst.length === 0, `${label}: every row equals its finite difference (${JSON.stringify(fd.worst)})`);
  return n;
}
const ends = (S, lineId) => { const s = S.state.shapes.find(x => x.id === lineId) || referenceShape(lineId); return s.reference ? [{ x: 0, y: 0 }, s.axis === 'axis-x' ? { x: 1, y: 0 } : { x: 0, y: 1 }] : [at(S, s.joints[0]), at(S, s.joints[1])]; };
const mirrorOf = (S, id, lineId) => { const [a, b] = ends(S, lineId); return mirrorPoint(at(S, id), a, b); };
const create = (S, params) => ConstraintManager.createConstraint(S.state, SYM, params, { source: 'test' });
const solve = (S) => S.engine.solve(L.ITER);

// ---------------------------------------------------------------------------------------------------------------- A. points
{ // about a FREE sketch line: the second pick mirrors onto the first (the first and the line stay); 2 DOF
  const S = L.newSketch();
  const p = L.point(S, 30, 10), q = L.point(S, -25, 14);
  const la = L.point(S, 2, -50), lb = L.point(S, -3, 60), line = L.line(S, la, lb);
  const d0 = dof(S, 'points/line before');
  const p0 = at(S, p), l0 = [at(S, la), at(S, lb)];
  const c = create(S, { joints: [p, q], line });
  ok(c && c.type === SYM, 'points about a sketch line: created');
  ok(JSON.stringify(c) === JSON.stringify({ type: SYM, joints: [p, q], line }), `stored form { type, joints, line }: ${JSON.stringify(c)}`);
  ok(solve(S).converged, 'converged');
  ok(near(at(S, q), mirrorOf(S, p, line), 1e-6), 'q is the mirror image of p');
  ok(near(at(S, p), p0, 1e-9) && near(at(S, la), l0[0], 1e-9) && near(at(S, lb), l0[1], 1e-9), 'who moves: the SECOND pick mirrored onto the first; the first and the line stayed');
  ok(measureResidual(c, S.state.joints, S.state.shapes) < 1e-6, 'verifier residual 0');
  ok(dof(S, 'points/line after') === d0 - 2, 'removes 2 DOF');
  // the symmetry line can still move (full derivative): the free line and p move together, q follows
  P(S, lb).x += 7; solve(S);
  ok(measureResidual(c, S.state.joints, S.state.shapes) < 1e-6, 'a moved symmetry line keeps p and q mirrored');
}
for (const axis of ['ref_axis_x', 'ref_axis_y']) { // about each axis (the built-in reference lines, task 539)
  const S = L.newSketch();
  const p = L.point(S, 20, 15), q = L.point(S, 35, -40);
  const d0 = dof(S, `points/${axis} before`);
  const c = create(S, { joints: [p, q], line: axis });
  ok(c && c.line === axis, `points about ${axis}: created, the axis stored by its reserved id`);
  ok(solve(S).converged, `${axis}: converged`);
  const want = axis === 'ref_axis_x' ? { x: 20, y: -15 } : { x: -20, y: 15 };
  ok(near(at(S, q), want, 1e-6) && near(at(S, p), { x: 20, y: 15 }, 1e-9), `${axis}: q at the mirror ${JSON.stringify(want)}, p unmoved`);
  ok(dof(S, `points/${axis} after`) === d0 - 2, `${axis}: removes 2 DOF`);
  ok(!S.state.shapes.some(s => s.reference) && !S.state.joints.has('j_ref_x') && !S.state.joints.has('j_ref_y'), `${axis}: no axis geometry in the document`);
}
{ // the second pick is HELD MORE (fixed): the first mirrors onto it instead
  const S = L.newSketch();
  const p = L.point(S, 20, 15), q = L.point(S, 35, -40);
  P(S, q).fixed = true;
  const c = create(S, { joints: [p, q], line: 'ref_axis_x' });
  ok(c && solve(S).converged, 'held second: created and converged');
  ok(near(at(S, q), { x: 35, y: -40 }, 1e-9) && near(at(S, p), { x: 35, y: 40 }, 1e-6), 'held second: q stayed, p moved to its mirror');
}

// ---------------------------------------------------------------------------------------------------------------- B. lines
{ // two lines about a sketch line: the end pairs mirror (the segments are mirror images); a line drawn the other way is paired crossed; 4 DOF
  const S = L.newSketch();
  const a1 = L.point(S, 10, 0), a2 = L.point(S, 40, 20), l1 = L.line(S, a1, a2);
  const b1 = L.point(S, -45, 18), b2 = L.point(S, -12, 3), l2 = L.line(S, b1, b2);   // drawn from the far end: crossed pairing
  const s1 = L.point(S, 0, -50), s2 = L.point(S, 0, 60), axisLine = L.line(S, s1, s2, true);   // a CONSTRUCTION line as the symmetry line
  P(S, s1).fixed = true; P(S, s2).fixed = true;
  const d0 = dof(S, 'lines before');
  const c = create(S, { shapes: [l1, l2], line: axisLine });
  ok(c && JSON.stringify(c.joints) === JSON.stringify([a1, b2, a2, b1]), `lines: crossed end pairs stored ${JSON.stringify(c && c.joints)}`);
  ok(JSON.stringify(Object.keys(c)) === JSON.stringify(['type', 'joints', 'shapes', 'line']), 'stored form { type, joints, shapes, line }');
  ok(solve(S).converged, 'lines: converged');
  ok(near(at(S, b2), mirrorOf(S, a1, axisLine), 1e-6) && near(at(S, b1), mirrorOf(S, a2, axisLine), 1e-6), 'lines: each end is the mirror of its pair');
  ok(near(at(S, a1), { x: 10, y: 0 }, 1e-9) && near(at(S, a2), { x: 40, y: 20 }, 1e-9), 'lines: the first line stayed');
  ok(dof(S, 'lines after') === d0 - 4, 'lines: removes 4 DOF');
}
{ // two lines about the Y axis, sharing an end (a V): the shared end lies on the axis, 3 DOF
  const S = L.newSketch();
  const v = L.point(S, 2, 30), a = L.point(S, 30, 0), b = L.point(S, -26, 4);
  const l1 = L.line(S, v, a), l2 = L.line(S, v, b);
  const d0 = dof(S, 'V before');
  const c = create(S, { shapes: [l1, l2], line: 'ref_axis_y' });
  ok(c && JSON.stringify(c.joints) === JSON.stringify([v, v, a, b]), 'V: the shared end pairs with itself');
  ok(solve(S).converged && Math.abs(P(S, v).x) < 1e-6 && near(at(S, b), { x: -P(S, a).x, y: P(S, a).y }, 1e-6), 'V: the shared end on the axis, the other ends mirrored');
  ok(dof(S, 'V after') === d0 - 3, 'V: removes 3 DOF (the shared pair is one row: on the axis)');
}

// ---------------------------------------------------------------------------------------------------------------- C. circles / arcs
{ // two circles about the X axis: centres mirror, radii equal (3 DOF: a circle's radius is a solver unknown)
  const S = L.newSketch();
  const c1 = L.circle(S, 30, 10, 8), c2 = L.circle(S, -20, 30, 12);
  const d0 = dof(S, 'circles before');
  const c = create(S, { shapes: [c1.id, c2.id], line: 'ref_axis_x' });
  ok(c && JSON.stringify(c) === JSON.stringify({ type: SYM, shapes: [c1.id, c2.id], line: 'ref_axis_x' }), 'circles: stored { type, shapes, line }');
  ok(solve(S).converged, 'circles: converged');
  const C2 = L.shape(S, c2.id);
  ok(near(at(S, c2.c), { x: 30, y: -10 }, 1e-6) && Math.abs(C2.radius - 8) < 1e-6, `circles: second centre mirrored, radius 8 (${C2.radius})`);
  ok(near(at(S, c1.c), { x: 30, y: 10 }, 1e-9) && L.shape(S, c1.id).radius === 8, 'circles: the first circle stayed');
  ok(dof(S, 'circles after') === d0 - 3, 'circles: removes 3 DOF');
}
{ // a circle and an arc about the Y axis: the arc's live radius follows the circle's
  const S = L.newSketch();
  const circ = L.circle(S, 40, 20, 10);
  const ac = L.point(S, -35, 30), as = L.point(S, -20, 30), ae = L.point(S, -35, 45);
  const arcId = L.arc(S, ac, as, ae);
  const d0 = dof(S, 'circle+arc before');
  const c = create(S, { shapes: [circ.id, arcId], line: 'ref_axis_y' });
  ok(c && solve(S).converged, 'circle + arc: created, converged');
  const r = Math.hypot(P(S, as).x - P(S, ac).x, P(S, as).y - P(S, ac).y);
  ok(near(at(S, ac), { x: -40, y: 20 }, 1e-5) && Math.abs(r - 10) < 1e-5, `circle + arc: arc centre (-40, 20), radius 10 (${r})`);
  ok(dof(S, 'circle+arc after') === d0 - 3, 'circle + arc: removes 3 DOF');
}

// ---------------------------------------------------------------------------------------------------------------- D. refusals
{
  const S = L.newSketch();
  const p = L.point(S, 20, 15), q = L.point(S, 35, -40), r = L.point(S, 35, -40);
  const a1 = L.point(S, 10, 0), a2 = L.point(S, 40, 20), l1 = L.line(S, a1, a2);
  const b1 = L.point(S, -10, 0), b2 = L.point(S, -40, 20), l2 = L.line(S, b1, b2);
  const n0 = S.state.constraints.length;
  const refused = (params, why) => {
    S.msgs.length = 0;
    const res = create(S, params);
    ok(res === null && S.state.constraints.length === n0 + extra, `${why}: refused (${S.msgs.join(' | ')})`);
    return S.msgs.join(' ');
  };
  let extra = 0;
  ok(/same point/.test(refused({ joints: [p, p], line: 'ref_axis_x' }, 'the same point twice')), 'the same point: the message says so');
  ConstraintManager.createConstraint(S.state, CONSTRAINT_TYPES.COINCIDENT, { joints: [q, r] }, { source: 'test' }); extra++;
  ok(/same point/.test(refused({ joints: [q, r], line: 'ref_axis_x' }, 'two coincident points')), 'coincident points are one point');
  ok(/same line/.test(refused({ shapes: [l1, l1], line: 'ref_axis_y' }, 'the same line twice')), 'the same line twice: says so');
  ok(/symmetry line cannot be one of/.test(refused({ shapes: [l1, l2], line: l1 }, 'the symmetry line is an entity')), 'the line as an entity: says so');
  refused({ joints: [p, q], line: 'no_such_line' }, 'an unknown symmetry line');
  // lines symmetric about the Y axis; a SECOND identical one is a duplicate; a point pair it already makes symmetric is redundant
  const c = create(S, { shapes: [l1, l2], line: 'ref_axis_y' }); extra++;
  ok(c && solve(S).converged, 'lines about Y: created');
  refused({ shapes: [l2, l1], line: 'ref_axis_y' }, 'the same symmetric again (other pick order): a duplicate');
  ok(/already symmetric/.test(refused({ joints: [a1, c.joints[1]], line: 'ref_axis_y' }, 'an end pair the line symmetric already holds')), 'redundant: "already symmetric"');
  // both points fixed and not mirrored: nothing can move
  const f1 = L.point(S, 5, 5), f2 = L.point(S, 9, 9); P(S, f1).fixed = true; P(S, f2).fixed = true;
  ok(/fixed and not symmetric/.test(refused({ joints: [f1, f2], line: 'ref_axis_x' }, 'two fixed points that are not mirrored')), 'fixed + not mirrored: says so');
  // both fixed and already mirrored: redundant
  const g1 = L.point(S, 5, 7), g2 = L.point(S, 5, -7); P(S, g1).fixed = true; P(S, g2).fixed = true;
  ok(/already symmetric/.test(refused({ joints: [g1, g2], line: 'ref_axis_x' }, 'two fixed points that are already mirrored')), 'fixed + mirrored: redundant');
  ok(dof(S, 'after the refusals') >= 0, 'the sketch is still consistent');
}

// ---------------------------------------------------------------------------------------------------------------- E. the tool (real handler)
{
  const S = L.newSketch(); const st = S.state;
  const p = L.point(S, 20, 15), q = L.point(S, 35, -40);
  const a = L.point(S, 0, 0), b = L.point(S, 50, 10), line = L.line(S, a, b);
  ok(CONSTRAINT_TOOLS.includes(TOOL_MODES.SYMMETRIC) && !REFERENCE_PICK_TOOLS.includes(TOOL_MODES.SYMMETRIC) && typeof REFERENCE_PICK_STEP[TOOL_MODES.SYMMETRIC] === 'function',
    'Symmetric is a constraint tool; it asks for an axis at one step only (REFERENCE_PICK_STEP), not always (REFERENCE_PICK_TOOLS)');
  const hitJ = (id) => ({ id, j: P(S, id) });
  const click = (j, shape) => handleConstraintPointerDown(null, null, st, j ? hitJ(j) : null, shape ? { shape } : null, null);
  st.currentTool = TOOL_MODES.SYMMETRIC; resetConstraintState(st);
  ok(!referenceLinesPickable(st), 'pick 1: an axis is not pickable');
  ok(click(null, referenceShape('ref_axis_x')) === false && !st.pendingConstraint.selectionBuffer.length, 'an axis cannot be entity 1');
  ok(click(p, null) === true && !referenceLinesPickable(st), 'pick 1 (a point) taken; pick 2: an axis is not pickable');
  ok(click(null, L.shape(S, line)) === false, 'a line cannot be entity 2 after a point (two points, two lines or two circles)');
  st.currentTool = TOOL_MODES.SYMMETRIC; resetConstraintState(st);
  ok(click(p, null) && click(p, null) === false, 'the same point twice is refused by the tool');
  resetConstraintState(st);
  const h0 = st.history.length;
  ok(click(p, null) && click(q, null) && referenceLinesPickable(st), 'picks 1 and 2 (two points); pick 3: an axis IS pickable');
  ok(click(q, null) === false, 'pick 3 must be a line (a point is refused)');
  ok(click(null, referenceShape('ref_axis_y')) === true && !st.pendingConstraint, 'pick 3: the Y axis; the tool is ready for the next');
  const c = st.constraints.find(x => x.type === SYM);
  ok(c && c.line === 'ref_axis_y' && JSON.stringify(c.joints) === JSON.stringify([p, q]), 'the tool stored symmetric [p, q] about the Y axis');
  ok(!referenceLinesPickable(st), 'after the creation an axis is no longer pickable');
  ok(!st.selectedJoints.has(p) && !st.selectedJoints.has(q), 'the picks are released from the selection');
  solve(S);
  ok(near(at(S, q), { x: -20, y: 15 }, 1e-6), 'q mirrored across the Y axis');
  // undo / redo: the tool made ONE step
  ok(st.history.length === h0 + 1, `one undo step (${h0} -> ${st.history.length})`);
  const docAfter = JSON.stringify(serializeDocument(st));
  st.undo(); solve(S);
  ok(!st.constraints.some(x => x.type === SYM) && near(at(S, q), { x: 35, y: -40 }, 1e-9), 'undo: the constraint is gone and q is back');
  st.redo(); solve(S);
  ok(st.constraints.some(x => x.type === SYM) && JSON.stringify(serializeDocument(st)) === docAfter, 'redo: the same document again');
  // pick a line as the symmetry line (sketch line), entities two circles
  const c1 = L.circle(S, 60, 40, 5), c2 = L.circle(S, 70, -30, 9);
  resetConstraintState(st);
  ok(click(null, L.shape(S, c1.id)) && click(null, L.shape(S, c2.id)) && click(null, L.shape(S, line)), 'circle, circle, sketch line');
  const cc = st.constraints.find(x => x.type === SYM && x.shapes);
  ok(cc && cc.line === line && solve(S).converged && Math.abs(L.shape(S, c2.id).radius - L.shape(S, c1.id).radius) < 1e-6, 'two circles symmetric about a sketch line, radii equal');
  // a refused creation leaves no undo step
  const h1 = st.history.length;
  resetConstraintState(st);
  click(p, null); click(q, null); click(null, referenceShape('ref_axis_y'));   // the same symmetric again: a duplicate
  ok(st.history.length === h1, 'a refused creation leaves no undo step');
}

// ---------------------------------------------------------------------------------------------------------------- F. save / load
{
  const S = L.newSketch();
  const p = L.point(S, 20, 15), q = L.point(S, 35, -40);
  const a1 = L.point(S, 10, 0), a2 = L.point(S, 40, 20), l1 = L.line(S, a1, a2);
  const b1 = L.point(S, -10, 0), b2 = L.point(S, -40, 20), l2 = L.line(S, b1, b2);
  const k1 = L.circle(S, 30, 30, 4), k2 = L.circle(S, -30, 30, 6);
  create(S, { joints: [p, q], line: 'ref_axis_x' }); create(S, { shapes: [l1, l2], line: 'ref_axis_y' }); create(S, { shapes: [k1.id, k2.id], line: l1 });
  solve(S);
  const doc = serializeDocument(S.state);
  const text = JSON.stringify(doc);
  const n = L.nullity(S);
  const T = L.newSketch();
  const res = deserializeDocument(JSON.parse(text), T.state);
  ok(res.ok, 'load ok');
  ok(JSON.stringify(serializeDocument(T.state)) === text, 'save -> load -> save: byte-identical');
  ok(T.state.constraints.filter(c => c.type === SYM).length === 3, 'all three symmetric forms loaded');
  ok(T.engine.solve(L.ITER).converged && T.state.constraints.filter(c => c.type === SYM).every(c => measureResidual(c, T.state.joints, T.state.shapes) < 1e-6), 'loaded: every symmetric satisfied');
  ok(L.nullity(T) === n, `loaded: same DOF ${n}`);
}

// ---------------------------------------------------------------------------------------------------------------- G. clipboard, parameters, context menu
{
  const S = L.newSketch(); const st = S.state;
  const a1 = L.point(S, 10, 0), a2 = L.point(S, 40, 20), l1 = L.line(S, a1, a2);
  const b1 = L.point(S, -10, 0), b2 = L.point(S, -40, 20), l2 = L.line(S, b1, b2);
  const s1 = L.point(S, 0, -30), s2 = L.point(S, 0, 30), line = L.line(S, s1, s2);
  const k1 = L.circle(S, 30, 30, 4), k2 = L.circle(S, -30, 30, 6);
  create(S, { shapes: [l1, l2], line });
  create(S, { shapes: [k1.id, k2.id], line: 'ref_axis_y' });
  solve(S);
  const copied = (ids) => { st.selectedShapes.clear(); ids.forEach(id => st.selectedShapes.add(id)); return selectionToEnvelope(st).document.geometry.constraints.filter(c => c.type === SYM); };
  ok(copied([l1, l2, line]).length === 1, 'clipboard: copied when both lines AND the symmetry line are copied');
  ok(copied([l1, l2]).length === 0, 'clipboard: not copied without the symmetry line');
  ok(copied([l1, line]).length === 0, 'clipboard: not copied with one entity only');
  ok(copied([k1.id, k2.id]).length === 0, 'clipboard: never copied when the symmetry line is an axis');
  st.selectedShapes.clear();
  // parameters: a symmetric is no dimension (the Parameters list shows none)
  ok(st.constraints.filter(c => c.type === SYM).every(c => !isDimension(c)), 'parameters: symmetric is not a dimension');
  // context menu: the symmetric glyph's menu is Delete, and it deletes exactly that constraint
  ok(CONSTRAINT_MENU_TYPES.includes(SYM), 'the symmetric glyph has a context menu');
  const target = st.constraints.find(c => c.type === SYM && c.line === line);
  st.selectedConstraints.add(target);
  const items = contextMenuItems('constraint', { target: { kind: 'constraint', constraint: target }, actions: { deleteSelection: () => deleteSelection(st) } });
  ok(items.length === 1 && items[0].id === 'con-delete' && items[0].label === 'Delete constraint', 'menu: one item, Delete constraint');
  const n0 = st.constraints.length, shapes0 = st.shapes.length;
  items[0].onSelect();
  ok(st.constraints.length === n0 - 1 && !st.constraints.includes(target) && st.shapes.length === shapes0, 'menu Delete removed the constraint only');
}

// ---------------------------------------------------------------------------------------------------------------- H. the who-moves row
{
  const e = WHO_MOVES.symmetric;
  ok(e && /declared, task 563/.test(e.rule) && e.cells === 0 && e.tie === 'second', 'the table has a DECLARED symmetric row (no Fusion cells), tie: the second gives way');
  ok(!firstGivesWay('symmetric', 'line:free', 'line:free') && !firstGivesWay('symmetric', 'point:free', 'point:free'), 'equal hold: the second mirrors onto the first');
  ok(firstGivesWay('symmetric', 'line:free', 'line:pinned') && firstGivesWay('symmetric', 'point:free', 'point:fixed') && firstGivesWay('symmetric', 'circle:free', 'circle:sized'), 'the second held more: the first gives way');
  ok(!firstGivesWay('symmetric', 'line:pinned+sized', 'line:hv'), 'the first held more: the second gives way');
}

console.log(`symmetric.test.js: ${checks} checks passed`);
