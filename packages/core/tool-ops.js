// packages/core/tool-ops.js -- TASK 680: the app's drawing TOOLS as headless OPERATIONS. PURE, no DOM.
//
// Each operation does what its tool does when the user clicks: it calls EXACTLY the core function(s) the tool's input handler
// (packages/ui/input-handlers/*) calls, on a sketch state, in the same order, so a drawing made with these operations has the structure
// a user drawing it with the tools gets (a template is a RECIPE of these operations, #core/templates.js; the constraint audit harness,
// tests/harness/audit/lib.js, draws with them too). Coordinates are WORLD (Y down). A "click" on empty canvas makes a new joint
// (click()); a click on an existing joint is that joint's id (a string), and each operation then does what its tool does with it.
// History (saveState / undo groups) is the tool layer's and is not taken here: it is not part of the drawing.
//
//   newSketchState()                         a sketch of its own (#core/constraint-solver.js createEngine + #core/sketch-state.js), the
//                                            open design untouched (task 679)
//   click(state, x, y)                       the joint a click on empty canvas makes (state.genJ)
//   polyline(state, pts, closed, construction)
//                                            Line tool (line-tool.js): every segment owns its two joints; the next segment starts on a NEW
//                                            joint tied to the previous end by a raw coincident (#core/constraints.js addConstraint); a start
//                                            on an existing joint IS that joint; an end on an existing joint is a new joint + a raw coincident
//                                            (its findNearbyJoint auto-coincident; its snap's coincident is then already held: not added)
//   rect(state, x1, y1, x2, y2, construction)
//                                            Rect tool, two corners (rect-tool.js): makeRectFromTwoJoints, the shapes pushed, each structural
//                                            constraint through ConstraintManager.createConstraint (source 'rect')
//   circle(state, cx, cy, r, construction)  Circle tool (circle-tool.js): a new centre joint, the circle shape (newShapeId) with its radius
//   arc(state, c, a, b, { sweep, construction })
//                                            Arc tool, centre mode (arc-tool.js): makeArc(centre, start, end), the shape pushed, its equal-radius
//                                            rule through ConstraintManager.createConstraint (source 'arc'), the winding (`sweep`) on the shape
//   polygon(state, c, v, n, construction)   Polygon tool (polygon-tool.js): makePolygon, shapes pushed, constraints through the raw addConstraint
//   slot(state, c1, c2, width, construction)
//                                            Slot tool, centre to centre (slot-tool.js, task 673): makeSlotCenterToCenter, the shapes pushed,
//                                            its constraints through the raw addConstraint; a pick on an existing joint REUSES it
//   fillet(state, lineA, lineB, r)          Fillet tool, two-line pick (fillet-tool.js): findCornerBetweenLines -> applyFillet
//   snap(state, joint, target)              what a tool does when its click lands on a joint (target = joint id) or on a curve (target =
//                                            { shape }): #core/snap-constraints.js applySnapConstraint (coincident / point on the curve)
//   constrain(state, type, params)          a constraint tool (constraint-tools.js): ConstraintManager.createConstraint (source 'toolbar')
//   dimension(state, pick, label, text)     Dimension tool (dimension-tool.js) + its value box (numeric-input-manager.js): the constraint made
//                                            by ConstraintManager.createConstraint at the MEASURED value, placed by the label point the user
//                                            drops (#core/dim-label.js updateConstraintOffset / placeRadiusLabel: the mode, offset, value), then
//                                            the typed text through #core/parameters.js previewDimensionInput and
//                                            #core/dimension-seams.js applyParameterChange (the box's commit)
//   typeDimension(state, c, text)           a text typed into an existing dimension's box (a double click on its label): the same commit
//   parameter(state, name, unit, text, comment)
//                                            the Parameters window's + Add row: #core/parameters.js planChange createParameter, committed by
//                                            applyParameterChange
//   pattern(state, type, objects, values)   Pattern tools (pattern-tool.js): #core/pattern.js applyPattern
//
// Every operation THROWS when its tool would refuse (no corner, a refused constraint, a dimension that comes in as a reference, a text the
// box refuses): a recipe never builds something other than what it says.

import { createEngine } from './constraint-solver.js';
import { createSketchState } from './sketch-state.js';
import { ConstraintManager } from './constraint-manager.js';
import { addConstraint } from './constraints.js';
import { makeRectFromTwoJoints, makeArc, makePolygon } from './shapes.js';
import { makeSlotCenterToCenter } from './slot.js';
import { findCornerBetweenLines, applyFillet } from './fillet.js';
import { applySnapConstraint } from './snap-constraints.js';
import { newShapeId } from './shape-id.js';
import { CONSTRAINT_TYPES } from './constants.js';
import { getDist, perpendicularDistance } from './geometry.js';
import { updateConstraintOffset, placeRadiusLabel } from './dim-label.js';
import { sceneJoints, sceneShapes } from './reference-lines.js';
import { planChange, previewDimensionInput } from './parameters.js';
import { applyParameterChange, dimensionInputLabel } from './dimension-seams.js';
import { applyPattern } from './pattern.js';
import { findUndimensionedOffsetPair, restoreOffsetDimension } from './offset.js';

const VIEW = { x: 0, y: 0, w: 800, h: 800 };
const shapeById = (state, id) => state.shapes.find((s) => s.id === id);
const isJointRef = (p) => typeof p === 'string';

/** A sketch of its own: its own engine store and state (the open design, if any, is never touched). */
export function newSketchState() {
  const engine = createEngine(null);
  engine.init();
  return createSketchState(engine, { ...VIEW });
}

/** The joint a tool's click on empty canvas makes. */
export function click(state, x, y) {
  const id = state.genJ();
  state.joints.set(id, { x, y, fixed: false });
  return id;
}

/**
 * Line tool: a chain of segments through `pts` ([x, y] clicks, or the id of an existing joint clicked), `closed` = the last click is back on
 * the chain's first joint. -> [{ id, a, b }] (each segment's shape id and its own two joints).
 */
export function polyline(state, pts, closed = true, construction = false) {
  const posOf = (p) => (isJointRef(p) ? state.joints.get(p) : { x: p[0], y: p[1] });
  const newAt = (p) => { const q = posOf(p); return click(state, q.x, q.y); };
  const segs = [];
  let start = isJointRef(pts[0]) ? pts[0] : newAt(pts[0]); // a start on a joint IS that joint (line-tool.js handleLinePointerDown)
  const first = start;
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) {
    const target = closed && i === n - 1 ? first : pts[i + 1];
    const end = newAt(target);
    if (isJointRef(target)) addConstraint(state, CONSTRAINT_TYPES.COINCIDENT, { joints: [end, target] }); // the end on a joint: auto coincident
    const id = newShapeId('s');
    state.shapes.push({ id, type: 'line', joints: [start, end], isConstruction: !!construction });
    segs.push({ id, a: start, b: end });
    if (i + 1 < n) { // the chain goes on: the next segment starts on a new joint tied to this end
      const next = newAt(target);
      addConstraint(state, CONSTRAINT_TYPES.COINCIDENT, { joints: [end, next] });
      start = next;
    }
  }
  return segs;
}

/** Rect tool, two corners (c1 = the first click, c3 = the opposite corner). -> { top, right, bottom, left, lines, c1, c3 } (Y down: `top` is y1's edge). */
export function rect(state, x1, y1, x2, y2, construction = false) {
  const c1 = click(state, x1, y1), c3 = click(state, x2, y2);
  const built = makeRectFromTwoJoints(state.joints, c1, c3, state.genJ, construction);
  built.shapes.forEach((s) => state.shapes.push(s));
  built.constraints.forEach((c) => { if (!ConstraintManager.createConstraint(state, c.type, c, { source: 'rect' })) throw new Error(`rect: ${c.type} refused`); });
  const [top, right, bottom, left] = built.shapes.map((s) => s.id);
  return { top, right, bottom, left, lines: [top, right, bottom, left], c1, c3 };
}

/** Circle tool: a new centre joint at (cx, cy) and the circle of radius r. -> { id, c }. */
export function circle(state, cx, cy, r, construction = false) {
  const c = click(state, cx, cy);
  const id = newShapeId('s');
  state.shapes.push({ id, type: 'circle', joints: [c], radius: r, isConstruction: !!construction });
  return { id, c };
}

/**
 * Arc tool (centre, start, end: three click joints). `sweep` = the winding the drag had (arc-tool.js: totalSweep > 0; false = counter-clockwise
 * on screen); the tool always records it, a caller that does not pass it leaves the shape's own default. -> the arc's shape id.
 */
export function arc(state, c, a, b, { sweep, construction = false } = {}) {
  const built = makeArc(state.joints, c, a, b, 'CENTER', construction);
  built.shapes.forEach((s) => state.shapes.push(s));
  built.constraints.forEach((k) => { if (!ConstraintManager.createConstraint(state, k.type, k, { source: 'arc' })) throw new Error('arc: its equal-radius rule refused'); });
  if (typeof sweep === 'boolean') built.shapes[0].sweep = sweep;
  return built.shapes[0].id;
}

/** Polygon tool: centre joint c, first corner joint v, n sides. -> makePolygon's { shapes, constraints }. */
export function polygon(state, c, v, n, construction = false) {
  const built = makePolygon(state.joints, c, v, n, state.genJ, construction);
  built.shapes.forEach((s) => state.shapes.push(s));
  built.constraints.forEach((k) => addConstraint(state, k.type, k));
  return built;
}

/** Slot tool, centre to centre: the two end centres (joint ids: a pick on a joint reuses it) and the width. -> makeSlotCenterToCenter's result. */
export function slot(state, c1, c2, width, construction = false) {
  const built = makeSlotCenterToCenter(state.joints, c1, c2, width, state.genJ, construction);
  if (!built.shapes.length) throw new Error('slot: no slot between those centres');
  built.shapes.forEach((s) => state.shapes.push(s));
  built.constraints.forEach((k) => addConstraint(state, k.type, k));
  return built;
}

/** Fillet tool, two-line pick: the corner between the two lines rounded at r. -> { arc, V, center, tA, tB, radiusConstraint }. */
export function fillet(state, lineA, lineB, r) {
  const corner = findCornerBetweenLines(state, shapeById(state, lineA), shapeById(state, lineB));
  if (!corner) throw new Error('no fillet corner between ' + lineA + ' and ' + lineB);
  const res = applyFillet(state, corner, r);
  if (!res || !res.success) throw new Error('fillet failed: ' + (res && res.reason));
  return { arc: res.arc.id, V: res.virtualSharp, center: res.joints[0], tA: res.joints[1], tB: res.joints[2], radiusConstraint: res.radiusConstraint };
}

/** A tool's click that landed on a joint (target: its id) or on a curve (target: { shape }): the snap's constraint. */
export function snap(state, joint, target) {
  const at = state.joints.get(joint);
  const t = isJointRef(target) ? { type: 'joint', targetId: target, pt: { x: at.x, y: at.y }, isLocked: true }
    : { type: 'line', targetId: target.shape, pt: { x: at.x, y: at.y }, isLocked: true };
  if (!applySnapConstraint(state, joint, t)) throw new Error(`snap of ${joint} on ${isJointRef(target) ? target : target.shape}: nothing added`);
}

/** A constraint tool's pick: ConstraintManager.createConstraint (source 'toolbar'). -> the constraint. */
export function constrain(state, type, params) {
  const c = ConstraintManager.createConstraint(state, type, params, { source: 'toolbar' });
  if (!c) throw new Error(`${type} refused`);
  return c;
}

/**
 * Dimension tool: the picks, the LABEL POINT the user drops (world), then the TEXT typed in its value box (a number, a formula, a name).
 *   pick = { joints: [a, b] }  two points: the mode (aligned / horizontal / vertical) is the one the label point gives (detectDimMode)
 *        | { point, line }     a point to a line: the perpendicular distance
 *        | { shape }           a circle's or an arc's radius
 *        | { lines: [l1, l2] } two lines: their distance when parallel, else the angle (the sector under the label)
 * -> the dimension (a DRIVING one; the operation throws when the tool would make a reference or the box refuses the text).
 */
export function dimension(state, pick, label, text, { unit = 'mm' } = {}) {
  const J = sceneJoints(state.joints), S = sceneShapes(state.shapes);
  let c;
  if (pick.joints) {
    const [a, b] = pick.joints;
    c = ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.DISTANCE, { joints: [a, b], value: getDist(J.get(a), J.get(b)), dimMode: pick.dimMode || 'auto' });
  } else if (pick.point) {
    const ln = S.find((s) => s.id === pick.line), [la, lb] = ln.joints;
    if (la === pick.point || lb === pick.point) throw new Error('dimension: a point against its own line');
    c = ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.DISTANCE, { joints: [pick.point, la, lb], value: Math.abs(perpendicularDistance(J.get(pick.point), J.get(la), J.get(lb))) }, { source: 'dimension' });
  } else if (pick.shape) {
    const sh = S.find((s) => s.id === pick.shape), centre = J.get(sh.joints[0]);
    const radius = typeof sh.radius === 'number' ? sh.radius : getDist(centre, J.get(sh.joints[1]));
    const has = state.constraints.some((k) => k && k.type === CONSTRAINT_TYPES.DISTANCE && k.shape === sh.id && typeof k.value === 'number');
    c = ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.DISTANCE, { shape: sh.id, value: radius, isRadius: true, isDriven: has });
    if (c) { c.glyphPos = label; placeRadiusLabel(c, centre, label); }
  } else if (pick.lines) {
    const [s1, s2] = pick.lines.map((id) => S.find((s) => s.id === id));
    const [p, q, r, t] = [s1.joints[0], s1.joints[1], s2.joints[0], s2.joints[1]].map((id) => J.get(id));
    const a1 = Math.atan2(q.y - p.y, q.x - p.x), a2 = Math.atan2(t.y - r.y, t.x - r.x);
    const d = Math.abs((a1 + Math.PI * 2) % Math.PI - (a2 + Math.PI * 2) % Math.PI);
    const parallel = d < 0.01 || Math.abs(d - Math.PI) < 0.01;
    const undimOffset = parallel ? findUndimensionedOffsetPair(state.constraints, s1.id, s2.id) : null; // task 667: an offset pair gets its own dimension back
    if (undimOffset) {
      restoreOffsetDimension(state, undimOffset);
      undimOffset.__restoredDimension = true;
      c = undimOffset;
    } else if (parallel) {
      c = ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.DISTANCE, { shapes: [s1.id, s2.id], value: Math.abs(perpendicularDistance(p, r, t)) });
    } else {
      let v = Math.abs((a1 - a2) * 180 / Math.PI); if (v > 180) v = 360 - v;
      c = ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.ANGLE, { shapes: [s1.id, s2.id], value: v });
    }
  } else throw new Error('dimension: unknown pick');
  if (!c || typeof c !== 'object') throw new Error('dimension refused');
  if (!pick.shape) { // the label follows the pointer while it is placed (dimension-tool.js startPlacing / handleDimensionPointerMove)
    c.__placing = true; c.__newlyPlaced = true;
    if (pick.dimMode) c.__lockDimMode = pick.dimMode;
    updateConstraintOffset(state, c, label);
    delete c.__lockDimMode;
  }
  if (c.isDriven || c.driven) throw new Error(`dimension ${c.name}: the tool makes it a reference (${c.drivenReason || 'already determined'})`);
  return typeDimension(state, c, text, { unit });
}

/** The text typed in a driving dimension's value box (its box after it is placed, or a double click on its label): the box's commit. */
export function typeDimension(state, c, text, { unit = 'mm' } = {}) {
  const pv = previewDimensionInput(state, c, text, { unit }); // numeric-input-manager.js handleCommit
  if (!pv.ok) throw new Error(`dimension ${c.name}: "${text}" refused (${pv.hint})`);
  c.isDriven = false; c.driven = false; c.__newlyPlaced = false; c.__placing = false;
  const res = applyParameterChange(state, pv.plan, dimensionInputLabel(c, pv), { snapshot: false });
  if (!res.ok) throw new Error(`dimension ${c.name}: "${text}" reverted (${res.reason || res.clash || res.message})`);
  return c;
}

/** The Parameters window's + Add row: a user parameter `name` (unit, expression text, comment). */
export function parameter(state, name, unit, text, comment) {
  const plan = planChange(state, { type: 'createParameter', name, unit, text, comment });
  if (!plan.ok) throw new Error(`parameter ${name}: ${plan.message}`);
  const res = applyParameterChange(state, plan, 'add parameter', { snapshot: false });
  if (!res.ok) throw new Error(`parameter ${name}: ${res.reason || res.message}`);
}

/** A dimension or pattern-value expression set by name (the Parameters window's Expression cell): #core/parameters.js planChange setDimension. */
export function setDimension(state, name, text) {
  const plan = planChange(state, { type: 'setDimension', name, text });
  if (!plan.ok) throw new Error(`dimension ${name}: ${plan.message}`);
  const res = applyParameterChange(state, plan, 'set expression', { snapshot: false });
  if (!res.ok) throw new Error(`dimension ${name}: ${res.reason || res.message}`);
}

/** A pattern tool: #core/pattern.js applyPattern on the objects ({ shapes, joints }) with the values. -> the pattern constraint. */
export function pattern(state, type, objects, values) {
  const made = applyPattern(state, type, objects, values);
  if (!made.ok) throw new Error('pattern: ' + made.reason);
  return made.constraint;
}
