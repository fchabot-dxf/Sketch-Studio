// packages/core/transform.js — TASK 753: THE rotate / scale of a user GROUP (stage A of "groups as blocks"). PURE (no DOM).
//
// A transform REWRITES the group's world geometry (nothing else is stored: no pose, no angle, no matrix): every member joint, a circle's
// radius, a bezier's two control points (shape data), and through shapesInGroup the curves of every group nested inside; an arc is its three
// joints (its sweep flag is unchanged by a rotation or a positive scale). Then the existing solve runs: the group is a rigid block the solver
// only translates (TASK 752), so geometry OUTSIDE it that is tied to it gives way first (springs hold the members where the bake put them)
// and the group shifts only where its outside constraints demand. Every caller (the box handles, the typed values, the menus) goes through
// planGroupTransform -> applyGroupTransform -> settleTransform -> transformBreaks, in ONE undo step (the UI's).
//
// The op: { pivot: {x, y}, angle (WORLD radians: the canvas is y-down, so a positive world angle turns CLOCKWISE on screen), scale (> 0) }.

import { CONSTRAINT_TYPES as T } from './constants.js';
import { shapesInGroup, lockHolder, GROUP_LOCKS } from './group-model.js';
import { computeGeometryBounds } from './geometry-bounds.js';
import { constraintOperands } from './creation-placement.js';
import { constraintReferencesAxis } from './reference-lines.js';
import { getCoincidentJoints } from './joints.js';
import { measureResidual } from './constraint-verifier.js';
import { snapshotSolverState, restoreSolverState } from './solver/engine.js';
import { SolverConfig } from './solver-config.js';

// THE effect of a rotate / a uniform scale on a constraint whose operands are ALL inside the group (design audit section 2.2, approved),
// as data. Row key = effectKey(c).
//   rotate: 'keep'      still satisfied after a rigid turn
//           'swapAt90'  exact at 90 / 270 degrees by swapping horizontal <-> vertical (kept as is at 180); at any other angle it cannot hold:
//                       the rotate asks ONE confirm and then removes it (a constraint) or makes it a reference (an H / V dimension)
//           'refuse'    the rotate is refused with the reason (stage A cannot carry it)
//   scale:  'keep'      a relation (no length): still satisfied after a uniform scale
//           'scaleValue' a length value: its value is multiplied by the factor in the same undo step (a formula-valued one refuses: change
//                       its parameter instead)
//           'refuse'    the scale is refused with the reason
export const TRANSFORM_EFFECT = Object.freeze({
  coincident: { rotate: 'keep', scale: 'keep' },
  pointOnLine: { rotate: 'keep', scale: 'keep' },
  horizontal: { rotate: 'swapAt90', scale: 'keep' },
  vertical: { rotate: 'swapAt90', scale: 'keep' },
  parallel: { rotate: 'keep', scale: 'keep' },
  perpendicular: { rotate: 'keep', scale: 'keep' },
  collinear: { rotate: 'keep', scale: 'keep' },
  tangent: { rotate: 'keep', scale: 'keep' },
  equal: { rotate: 'keep', scale: 'keep' },
  midpoint: { rotate: 'keep', scale: 'keep' },
  symmetric: { rotate: 'keep', scale: 'keep' },
  angle: { rotate: 'keep', scale: 'keep' },
  distance: { rotate: 'keep', scale: 'scaleValue' },           // aligned, point-to-line, line-to-line, radius, diameter
  distanceHV: { rotate: 'swapAt90', scale: 'scaleValue' },     // a horizontal / vertical dimension (dimMode)
  offset: { rotate: 'keep', scale: 'scaleValue' },
  circularPattern: { rotate: 'keep', scale: 'keep' },
  rectangularPattern: { rotate: 'refuse', scale: 'refuse' },   // its directions / spacings: stage C
});
export const effectKey = (c) => (c.type === T.DISTANCE && (c.dimMode === 'horizontal' || c.dimMode === 'vertical') ? 'distanceHV' : c.type);

// THE angle snaps of the rotate handle (degrees): the handle sticks to a multiple of ROTATE_SNAP_DEG within ROTATE_SNAP_MAGNET_DEG of it
// (a finger has no Shift); Shift snaps to the nearest multiple at any distance.
export const ROTATE_SNAP_DEG = 15;
export const ROTATE_SNAP_MAGNET_DEG = 2.5;
export const MIN_SCALE = 0.01; // a scale handle never folds the group onto its corner (and never mirrors it)
export const TRANSFORM_UNDO_LABELS = Object.freeze({ rotate: 'rotate group', scale: 'scale group' });

const RIGHT = Math.PI / 2;
// The quarter turns of `angle` when it is an exact multiple of 90 degrees (within float noise), else null.
export function quarterTurns(angle) {
  const q = angle / RIGHT, n = Math.round(q);
  return Math.abs(q - n) < 1e-9 ? ((n % 4) + 4) % 4 : null;
}
/** The snapped angle (radians) for a raw handle angle: the nearest ROTATE_SNAP_DEG multiple when within the magnet (or always with `hard`). */
export function snapAngle(angle, hard = false) {
  const step = ROTATE_SNAP_DEG * Math.PI / 180, n = Math.round(angle / step);
  return (hard || Math.abs(angle - n * step) <= ROTATE_SNAP_MAGNET_DEG * Math.PI / 180) ? n * step : angle;
}

/** One point through the op: pivot + scale * R(angle) * (p - pivot). */
export function transformPoint(p, { pivot, angle = 0, scale = 1 }) {
  const c = Math.cos(angle) * scale, s = Math.sin(angle) * scale, dx = p.x - pivot.x, dy = p.y - pivot.y;
  return { x: pivot.x + c * dx - s * dy, y: pivot.y + s * dx + c * dy };
}

/** THE geometry rewrite: the shapes `shapeIds` (a group's: shapesInGroup, its nested groups included) through the op. Each joint they use once,
 *  a circle's radius x scale, a bezier's control points (new arrays: an undo snapshot keeps the old ones). -> { joints: [ids], shapes }. */
export function transformShapes(state, shapeIds, op) {
  const ids = new Set(shapeIds || []);
  const shapes = ((state && state.shapes) || []).filter((s) => s && ids.has(s.id));
  const joints = new Set();
  for (const s of shapes) for (const jid of (s.joints || [])) joints.add(jid);
  for (const jid of joints) { const j = state.joints.get(jid); if (!j) continue; const q = transformPoint(j, op); j.x = q.x; j.y = q.y; }
  const tp = (c) => { const q = transformPoint({ x: c[0], y: c[1] }, op); return [q.x, q.y]; };
  for (const s of shapes) {
    if (s.type === 'circle' && Number.isFinite(s.radius)) s.radius *= (op.scale ?? 1);
    if (s.type === 'bezier') { if (Array.isArray(s.c1)) s.c1 = tp(s.c1); if (Array.isArray(s.c2)) s.c2 = tp(s.c2); }
  }
  return { joints: [...joints], shapes };
}

/** The group's axis-aligned box in world units { minX, minY, maxX, maxY, w, h, cx, cy } (the exact extents: arcs by sweep, beziers by their
 *  curve: #core/geometry-bounds.js), or null. Square to the screen whatever the group was turned by (nothing stores an angle). */
export function groupBox(state, gid) {
  const ids = new Set(shapesInGroup(state, gid));
  const b = computeGeometryBounds({ joints: state.joints, shapes: (state.shapes || []).filter((s) => ids.has(s.id)) });
  return b ? { ...b, cx: (b.minX + b.maxX) / 2, cy: (b.minY + b.maxY) / 2 } : null;
}

// A constraint's name in a message: a dimension's own name (d3), else its kind ("Horizontal", "Point on line").
export function constraintLabel(c) {
  if (c && typeof c.name === 'string' && c.name) return c.name;
  const t = String((c && c.type) || 'constraint').replace(/([A-Z])/g, ' $1').toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}
const groupName = (state, gid) => { const g = (state.groups || []).find((x) => x.id === gid); return g ? g.name : 'this group'; };

/** The constraints INSIDE the group (every operand a member point, no axis) and the member joint set. */
export function insideConstraints(state, gid) {
  const members = new Set();
  const ids = new Set(shapesInGroup(state, gid));
  for (const s of (state.shapes || [])) if (ids.has(s.id)) for (const j of (s.joints || [])) members.add(j);
  const inside = [];
  for (const c of (state.constraints || [])) {
    if (!c || constraintReferencesAxis(c)) continue;
    const o = constraintOperands(state, c);
    const all = [...o.joints, ...o.references];
    if (all.length && all.every((j) => members.has(j))) inside.push(c);
  }
  return { members, inside };
}

/**
 * THE plan of a rotate / scale of group `gid` (nothing changes here). op = { pivot, angle, scale }.
 * -> { ok: false, reason } (refused: a lock, a fixed point, an inside constraint stage A cannot carry, a formula-valued length) or
 *    { ok: true, gid, shapeIds, joints, swaps, removes, references, scales, confirm } where
 *    swaps = inside H / V constraints and H / V dimensions swapped (an exact quarter turn), removes / references = inside H / V constraints
 *    removed / H / V dimensions made reference (any other angle; `confirm` = how many, the UI asks once before), scales = inside length values x s.
 */
export function planGroupTransform(state, gid, op) {
  const angle = op.angle || 0, scale = op.scale ?? 1;
  const rotating = Math.abs(angle) > 1e-12, scaling = Math.abs(scale - 1) > 1e-12;
  const name = groupName(state, gid);
  const shapeIds = shapesInGroup(state, gid);
  if (!shapeIds.length) return { ok: false, reason: 'the group is empty' };
  if (!(scale > 0)) return { ok: false, reason: 'a scale must be more than 0 %' };
  const verb = rotating && scaling ? 'rotate or scale' : rotating ? 'rotate' : 'scale';
  if (rotating || scaling) {
    const full = lockHolder(state, gid, 'full');
    if (full) return { ok: false, reason: `${groupName(state, full)} has ${GROUP_LOCKS.full.label} on: unlock it to ${verb}` };
    const lock = lockHolder(state, gid, 'sizeAngle');
    if (lock) return { ok: false, reason: `${groupName(state, lock)} has ${GROUP_LOCKS.sizeAngle.label} on: unlock it to ${verb}` };
  }
  const { members, inside } = insideConstraints(state, gid);
  // a fixed point inside (a Lock on a member, or a member coincident with a fixed point / the origin): the same rule as a drag
  const driving = (state.constraints || []).filter((c) => c && !c.isDriven && !c.driven);
  if (rotating || scaling) for (const jid of members) {
    const held = [...getCoincidentJoints(jid, driving)].some((id) => id === 'j_origin' || (state.joints.get(id) || {}).fixed);
    if (held) return { ok: false, reason: `a point of ${name} is fixed: unlock it to ${verb}` };
  }
  const turns = rotating ? quarterTurns(angle) : 0;
  const swaps = [], removes = [], references = [], scales = [];
  for (const c of inside) {
    const eff = TRANSFORM_EFFECT[effectKey(c)] || { rotate: 'keep', scale: 'keep' };
    const driven = !!(c.isDriven || c.driven);
    if (rotating && eff.rotate === 'refuse') return { ok: false, reason: `${constraintLabel(c)} inside ${name} cannot turn with it yet` };
    if (scaling && eff.scale === 'refuse') return { ok: false, reason: `${constraintLabel(c)} inside ${name} cannot scale with it yet` };
    if (rotating && eff.rotate === 'swapAt90' && !driven) {
      if (turns === 1 || turns === 3) swaps.push(c);
      else if (turns === null) (c.type === T.DISTANCE ? references : removes).push(c);
    }
    if (scaling && eff.scale === 'scaleValue' && !driven) {
      if (typeof c.expression === 'string' && c.expression) return { ok: false, reason: `the size of ${name} is set by ${constraintLabel(c)} = ${c.expression}: change that value instead` };
      scales.push(c);
    }
  }
  return { ok: true, gid, shapeIds, joints: [...members], swaps, removes, references, scales, confirm: removes.length + references.length };
}

/** The confirm a plan needs before it runs (an angle that is not a quarter turn, with H / V inside), or null. */
export function transformConfirmText(state, plan) {
  if (!plan || !plan.confirm) return null;
  const parts = [];
  if (plan.removes.length) parts.push(`removes ${plan.removes.length} horizontal / vertical constraint${plan.removes.length === 1 ? '' : 's'}`);
  if (plan.references.length) parts.push(`makes ${plan.references.length} horizontal / vertical dimension${plan.references.length === 1 ? '' : 's'} reference`);
  return `Rotating ${groupName(state, plan.gid)} ${parts.join(' and ')} inside it (Undo brings ${plan.confirm === 1 ? 'it' : 'them'} back).`;
}

/** Run a plan: the geometry rewrite, then the inside constraints (swaps, length values, and, when `removals`, the confirmed removals /
 *  references; a preview while the handle moves passes removals: false). */
export function applyGroupTransform(state, plan, op, { removals = true } = {}) {
  transformShapes(state, plan.shapeIds, op);
  for (const c of plan.swaps) {
    if (c.type === T.HORIZONTAL) c.type = T.VERTICAL;
    else if (c.type === T.VERTICAL) c.type = T.HORIZONTAL;
    else if (c.dimMode === 'horizontal' || c.dimMode === 'vertical') {
      c.dimMode = c.dimMode === 'horizontal' ? 'vertical' : 'horizontal';
      delete c.dimSign; delete c.dimSignMode; // the engine locks the side again from the turned geometry at the next solve (engine.js)
    }
  }
  for (const c of plan.scales) if (Number.isFinite(c.value)) c.value *= op.scale;
  if (!removals) return;
  for (const c of plan.references) { c.isDriven = true; c.driven = true; delete c.expression; }
  if (plan.removes.length) {
    const gone = new Set(plan.removes);
    for (let i = state.constraints.length - 1; i >= 0; i--) if (gone.has(state.constraints[i])) state.constraints.splice(i, 1);
  }
}

// The constraint fields a transform writes (applyGroupTransform), kept by snapshotTransform with the solver state.
const CONSTRAINT_FIELDS = ['type', 'value', 'dimMode', 'dimSign', 'dimSignMode', 'isDriven', 'driven', 'expression'];
/** A rollback point for a transform in progress (the handle's every move starts again from it, a refusal returns to it). */
export function snapshotTransform(state) {
  return {
    solver: snapshotSolverState(state.joints, state.shapes, state.constraints),
    list: [...state.constraints],
    fields: state.constraints.map((c) => CONSTRAINT_FIELDS.map((k) => [k, Object.prototype.hasOwnProperty.call(c, k), c[k]])),
  };
}
export function restoreTransform(state, snap) {
  restoreSolverState(state.joints, state.shapes, snap.solver);
  state.constraints.splice(0, state.constraints.length, ...snap.list);
  snap.list.forEach((c, i) => { for (const [k, had, v] of snap.fields[i]) { if (had) c[k] = v; else delete c[k]; } });
}

/** The driving constraints NOT satisfied now (by reference): taken before a transform, so transformBreaks names only what it broke. */
export function unsatisfied(state) {
  const tol = SolverConfig.VERIFIER_TOLERANCE || 0.001, out = new Set();
  for (const c of (state.constraints || [])) if (c && !c.isDriven && !c.driven && measureResidual(c, state.joints, state.shapes) > tol) out.add(c);
  return out;
}
/** What a transform broke: the driving constraints unsatisfied now that were satisfied `before` (unsatisfied(state) at the start). */
export function transformBreaks(state, before) {
  return [...unsatisfied(state)].filter((c) => !before.has(c));
}

/** THE solve after a rewrite: the existing solve, with each member pulled to where the bake put it (the drag springs, TASK 584), so free outside
 *  geometry tied to the group gives way first and the group shifts only where its outside constraints demand; then the plain solve the app's
 *  frame runs. `iters`: the quick pass while the handle moves, the full one on release. */
export function settleTransform(state, jointIds, iters = SolverConfig.ITERATIONS || 500) {
  const pulled = (jointIds || []).map((id) => [id, state.joints.get(id)]).filter(([, j]) => j && !j.fixed);
  for (const [, j] of pulled) j.dragTarget = { x: j.x, y: j.y };
  try {
    if (pulled.length) {
      const [id, j] = pulled[0];
      state.engine.solve(iters, { dragTarget: { jointId: id, x: j.x, y: j.y, stiffness: (SolverConfig.DRAG_STRENGTH || 1.0) * 1e4 } });
    }
  } finally {
    for (const [, j] of pulled) delete j.dragTarget;
  }
  return state.engine.solve(iters);
}

/**
 * THE whole transform, as every caller runs it: plan, rewrite, solve, check. A refusal or a break restores everything (nothing changed).
 * `confirmed`: the user accepted the plan's confirm (transformConfirmText); without it a plan that needs one is returned as { ok: false, confirm }.
 * -> { ok: true, plan } | { ok: false, reason } | { ok: false, needsConfirm: text, plan }.
 */
export function runGroupTransform(state, gid, op, { confirmed = false } = {}) {
  const plan = planGroupTransform(state, gid, op);
  if (!plan.ok) return plan;
  const ask = transformConfirmText(state, plan);
  if (ask && !confirmed) return { ok: false, needsConfirm: ask, plan };
  const snap = snapshotTransform(state), before = unsatisfied(state);
  applyGroupTransform(state, plan, op);
  settleTransform(state, plan.joints);
  const broke = transformBreaks(state, before);
  if (broke.length) {
    restoreTransform(state, snap);
    const names = [...new Set(broke.map(constraintLabel))];
    return { ok: false, reason: `it would break ${names.slice(0, 3).join(', ')}${names.length > 3 ? ` and ${names.length - 3} more` : ''} (tied to geometry that cannot follow)` };
  }
  return { ok: true, plan };
}

