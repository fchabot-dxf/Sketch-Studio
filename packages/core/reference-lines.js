// packages/core/reference-lines.js - the built-in REFERENCE LINES (task 539): the X axis (y = 0) and the Y axis (x = 0) as two
// fixed, endless lines through j_origin that a constraint or dimension can name like any line. PURE (no DOM).
//
// They are NOT document geometry: they are in no state.shapes / state.joints, so exports, profiles, thumbnails, the Params list,
// the shape count, selection and delete never see them. A "scene" (the real containers read LIVE + the reserved entries) is handed
// only to the code that RESOLVES a constraint's shape / joint id (the solver, the verifier, the status analysis, the constraint
// manager, the renderer's glyph lookup). A constraint stores an axis by its reserved id, the same fields as for any line.
import { AXIS_SNAP_TARGETS, ORIGIN_JOINT_ID, TOOL_MODES } from './constants.js';

// The reserved line of each axis: { id, type:'line', joints:[j_origin, end], reference:true, axis:<snap type> }.
export const REFERENCE_SHAPES = Object.freeze(Object.entries(AXIS_SNAP_TARGETS).map(([axis, a]) =>
  Object.freeze({ id: a.shapeId, type: 'line', joints: Object.freeze([ORIGIN_JOINT_ID, a.endJointId]), reference: true, axis, label: a.label })));
// The reserved fixed end joint of each axis (the origin itself is the real j_origin).
export const REFERENCE_JOINTS = Object.freeze(Object.values(AXIS_SNAP_TARGETS).map(a => Object.freeze({ id: a.endJointId, x: a.end.x, y: a.end.y, fixed: true, reference: true })));

const SHAPE_BY_ID = new Map(REFERENCE_SHAPES.map(s => [s.id, s]));
const JOINT_BY_ID = new Map(REFERENCE_JOINTS.map(j => [j.id, j]));

export const isReferenceShapeId = (id) => SHAPE_BY_ID.has(id);
export const isReferenceJointId = (id) => JOINT_BY_ID.has(id);
export const referenceShape = (id) => SHAPE_BY_ID.get(id) || null;
// The axis snap type ('axis-x' / 'axis-y') of a reserved shape id, or null.
export const axisOfShapeId = (id) => (SHAPE_BY_ID.get(id) || {}).axis || null;

// A constraint that names an axis (shape / shapes / line / circle fields, or a dimension's shapes).
export function constraintReferencesAxis(c) {
  if (!c) return false;
  if (isReferenceShapeId(c.shape) || isReferenceShapeId(c.line) || isReferenceShapeId(c.circle)) return true;
  return Array.isArray(c.shapes) && c.shapes.some(isReferenceShapeId);
}

// The tool modes that ASK FOR A TARGET an axis can be: the ONE declaration of "an axis is pickable now". Everything else (select,
// drawing, H/V, equal, midpoint ...) never sees an axis, so it cannot be hit, selected, dragged or deleted.
export const REFERENCE_PICK_TOOLS = Object.freeze([
  TOOL_MODES.PARALLEL, TOOL_MODES.PERPENDICULAR, TOOL_MODES.COLLINEAR, TOOL_MODES.TANGENT, TOOL_MODES.COINCIDENT, TOOL_MODES.DIMENSION
]);
export const referenceLinesPickable = (state) => !!state && REFERENCE_PICK_TOOLS.includes(state.currentTool);
// The shapes a target pick may hit now: the real ones, then (only while pickable) the two axes LAST, so real geometry wins a tie.
export function pickableShapes(state) {
  return referenceLinesPickable(state) ? [...state.shapes, ...REFERENCE_SHAPES] : state.shapes;
}

// Joints: the real Map read live, then the reserved end joints. Same read API as Map (the solver uses get / has / size / entries /
// keys / values / forEach / iteration); writes go to the real Map.
export class SceneJoints extends Map {
  constructor(base) { super(); this.base = base; this.extra = new Map(REFERENCE_JOINTS.map(j => [j.id, { x: j.x, y: j.y, fixed: true }])); }
  get(id) { return this.base.has(id) ? this.base.get(id) : this.extra.get(id); }
  has(id) { return this.base.has(id) || this.extra.has(id); }
  get size() { return this.base.size + this.extra.size; }
  set(id, v) { this.base.set(id, v); return this; }
  delete(id) { return this.base.delete(id); }
  clear() { this.base.clear(); }
  *entries() { yield* this.base.entries(); yield* this.extra.entries(); }
  *keys() { for (const [k] of this.entries()) yield k; }
  *values() { for (const [, v] of this.entries()) yield v; }
  forEach(fn, thisArg) { for (const [k, v] of this.entries()) fn.call(thisArg, v, k, this); }
  [Symbol.iterator]() { return this.entries(); }
}
// Shapes: the real array read live, then the two axes. The read API the resolvers use (find / filter / some / every / map /
// forEach / indexOf / length / iteration).
export class SceneShapes {
  constructor(base) { this.base = base; }
  _all() { return [...this.base, ...REFERENCE_SHAPES]; }
  get length() { return this.base.length + REFERENCE_SHAPES.length; }
  find(fn, t) { return this._all().find(fn, t); }
  findIndex(fn, t) { return this._all().findIndex(fn, t); }
  filter(fn, t) { return this._all().filter(fn, t); }
  some(fn, t) { return this._all().some(fn, t); }
  every(fn, t) { return this._all().every(fn, t); }
  map(fn, t) { return this._all().map(fn, t); }
  forEach(fn, t) { return this._all().forEach(fn, t); }
  indexOf(x) { return this._all().indexOf(x); }
  includes(x) { return this._all().includes(x); }
  [Symbol.iterator]() { return this._all()[Symbol.iterator](); }
}
// The scene of a (joints, shapes) pair; idempotent.
export const sceneJoints = (joints) => (joints instanceof SceneJoints ? joints : new SceneJoints(joints));
export const sceneShapes = (shapes) => (shapes instanceof SceneShapes ? shapes : new SceneShapes(shapes));

// A shape by id: a real one, or a reserved axis (what a pending constraint's first element needs).
export function findShapeById(shapes, id) {
  return (shapes && shapes.find(s => s && s.id === id)) || referenceShape(id) || null;
}

// The two points (world) of a reserved line, from the declaration alone (the origin and the end): for the code that needs the
// geometry of an axis without any joint container (the pointer pick, the highlight).
export function referenceEnds(shape) {
  const a = shape && AXIS_SNAP_TARGETS[shape.axis];
  return a ? [{ x: 0, y: 0 }, { x: a.end.x, y: a.end.y }] : null;
}
