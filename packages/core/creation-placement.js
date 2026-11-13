// TASK 525 -- WHO MOVES at constraint creation, like Fusion (owner ruling 2026-11-12: "do it like Fusion").
//
// One mechanism, three declared parts:
//   1. holdClass(): ONE classifier, operand -> hold class ("line:free", "line:hv+pinned", "circle:sized", "point:fixed", ...), derived from the
//      solver (engine.jointFreedom: which joints / radii can still move) and the constraints on the operand.
//   2. WHO_MOVES (./creation-placement-table.js): per table key the order of the hold classes, lowest tier gives way first, and the tie
//      rule (which pick gives way when both are in one tier or a class is not ranked; Fusion's usual: the second, the first pick stays).
//      The table is DATA generated from the recorded Fusion cells by scripts/fusion-oracle/fit-placement-table.mjs (a test asserts the
//      module equals the script's output).
//   3. PLACE (below): per table key, which operands are the first / second pick and the motion that places the mover: ONE similarity
//      (rotate / scale about a pivot, or a translation) of the mover's body, its held points staying and coincident partners outside the
//      body dragged along; or (SOLVE_ALONE) the least-change solve of the mover with the anchor frozen. A placement counts only when it
//      satisfies the new constraint and leaves every existing driving constraint as satisfied as it was; otherwise the other operand is
//      tried; if neither can, the solve starts from the giving operand's placement and repairs the rest.
// The solver rows are not touched: the placement only chooses the pose the solve starts from.
import { CONSTRAINT_TYPES as T } from './constants.js';
import { measureResidual, measureShapeSizes, findCollapsedShape } from './constraint-verifier.js';
import { snapshotSolverState, restoreSolverState, hasRadiusUnknown } from './solver/engine.js';
import { SolverConfig } from './solver-config.js';
import { WHO_MOVES } from './creation-placement-table.js';
import { symmetricOperands, mirrorPoint } from './symmetric.js';

const EPS_SAT = 1e-6;     // a residual at or below this (mm or rad) is satisfied
const EPS_WORSE = 1e-7;   // a placement may not raise an existing constraint's residual by more than this
const EPS_POS = 1e-9;     // a held point "stays" when it moves less than this

const isDriving = (c) => !!c && !c.isDriven && !c.driven;
const shapeOf = (state, id) => state.shapes.find(s => s.id === id) || null;
const isCirc = (s) => !!s && (s.type === 'circle' || s.type === 'arc');
const isLine = (s) => !!s && s.type === 'line' && Array.isArray(s.joints) && s.joints.length >= 2;
const samePair = (j, a, b) => Array.isArray(j) && j.length >= 2 && ((j[0] === a && j[1] === b) || (j[0] === b && j[1] === a));
const lineOfPair = (state, a, b) => state.shapes.find(s => isLine(s) && samePair(s.joints, a, b)) || null;
const pos = (state, id) => { const j = state.joints.get(id); return j ? { x: j.x, y: j.y } : null; };
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const len = (v) => Math.hypot(v.x, v.y);
const ang = (v) => Math.atan2(v.y, v.x);
const wrapPi = (a) => { let x = a; while (x <= -Math.PI) x += 2 * Math.PI; while (x > Math.PI) x -= 2 * Math.PI; return x; };
const halfTurn = (a) => { let x = wrapPi(a); if (x > Math.PI / 2) x -= Math.PI; else if (x <= -Math.PI / 2) x += Math.PI; return x; };   // a line turn, mod 180, in (-90, 90]
const radiusOf = (state, s) => (typeof s.radius === 'number' ? s.radius : len(sub(pos(state, s.joints[1]), pos(state, s.joints[0]))));

// ---------------------------------------------------------------------------------------------------------- 1. the classifier
// The solver's view of what can still move: one jointFreedom() per creation (nullspace of the constraint Jacobian).
export function freedomOf(state) { return state.engine.jointFreedom(); }
const jointFree = (fr, id) => (fr.freedom.get(id) || 0) > 0;

// Operand = { kind: 'shape', id } | { kind: 'joint', id }. The shape a picked point belongs to (a drawn shape before a construction one).
function ownerShape(state, jointId) {
  const owners = state.shapes.filter(s => Array.isArray(s.joints) && s.joints.includes(jointId));
  return owners.find(s => !s.isConstruction) || owners[0] || null;
}

// Hold class of a shape: family + the features that hold it, in a fixed order. "full" = no joint (and no radius) of it can move.
function shapeClass(state, fr, sh) {
  const family = isLine(sh) ? 'line' : sh.type;
  const js = sh.joints || [];
  const pinned = js.filter(id => !jointFree(fr, id)).length;
  const radiusHeld = sh.type !== 'circle' || !fr.radiusFree.has(sh.id);
  if (js.length && pinned === js.length && radiusHeld) return family + ':full';
  const cs = state.constraints.filter(isDriving);
  const f = [];
  if (isLine(sh) && cs.some(c => (c.type === T.HORIZONTAL || c.type === T.VERTICAL) && samePair(c.joints, js[0], js[1]))) f.push('hv');
  // a fixed point the shape passes through that is not one of its own joints (a line centred on the origin, a line through a fixed point)
  if (cs.some(c => (c.type === T.MIDPOINT && isLine(sh) && samePair(c.joints, js[0], js[1]) && !jointFree(fr, c.joints[2]))
    || (c.type === T.POINT_ON_LINE && c.shape === sh.id && !js.includes(c.joint) && !jointFree(fr, c.joint)))) f.push('centred');
  if (pinned) f.push('pinned');
  if (cs.some(c => c.type === T.DISTANCE && ((c.isRadius && c.shape === sh.id)
    || (!c.isRadius && isLine(sh) && (c.dimMode || 'aligned') === 'aligned' && c.joints && c.joints.length === 2 && samePair(c.joints, js[0], js[1]))))) f.push('sized');
  // attached: own joints (still free) shared with another shape or coincident with a joint of another shape
  const attached = js.filter(id => jointFree(fr, id) && (
    state.shapes.some(o => o !== sh && Array.isArray(o.joints) && o.joints.includes(id))
    || cs.some(c => c.type === T.COINCIDENT && Array.isArray(c.joints) && c.joints.includes(id)
      && c.joints.some(o => o !== id && !js.includes(o) && state.shapes.some(t => t !== sh && Array.isArray(t.joints) && t.joints.includes(o)))))).length;
  if (attached === 1) f.push('corner'); else if (attached >= 2) f.push('chain');
  return family + ':' + (f.length ? f.join('+') : 'free');
}

// THE classifier. A picked point that cannot move is "point:fixed"; otherwise a point takes the class of the shape it belongs to.
export function holdClass(state, fr, op) {
  if (op.kind === 'shape') { const sh = shapeOf(state, op.id); return sh ? shapeClass(state, fr, sh) : 'unknown'; }
  if (!jointFree(fr, op.id)) return 'point:fixed';
  const sh = ownerShape(state, op.id);
  return sh ? shapeClass(state, fr, sh) : 'point:free';
}

// ---------------------------------------------------------------------------------------------------------- 3. the placements
// The mover's body, by mode: 'shape' = its shape(s) and everything that shares a joint with them; 'component' = also what is coincident
// with one of its joints (a rect-tool rectangle, a polyline). Never crossing into the anchor.
function bodyOf(state, op, anchorJoints, mode) {
  const coincident = mode === 'component' ? state.constraints.filter(c => isDriving(c) && c.type === T.COINCIDENT && Array.isArray(c.joints)) : [];
  const joints = new Set(), shapes = [];
  const start = op.kind === 'shape' ? [shapeOf(state, op.id)].filter(Boolean)
    : state.shapes.filter(s => Array.isArray(s.joints) && s.joints.includes(op.id) && !s.joints.some(x => anchorJoints.has(x)));
  if (op.kind === 'joint') joints.add(op.id);
  const seen = new Set();
  const queue = [...start];
  while (queue.length) {
    const s = queue.shift();
    if (seen.has(s.id)) continue;
    seen.add(s.id); shapes.push(s);
    for (const j of s.joints) {
      joints.add(j);
      if (anchorJoints.has(j)) continue;
      const linked = [j];
      for (const c of coincident) if (c.joints.includes(j)) for (const o of c.joints) if (!anchorJoints.has(o) && !linked.includes(o)) linked.push(o);
      for (const k of linked) for (const t of state.shapes) if (!seen.has(t.id) && Array.isArray(t.joints) && t.joints.includes(k) && !t.joints.some(x => anchorJoints.has(x))) queue.push(t);
    }
  }
  return { joints, shapes };
}

// Mover = the body plus what holds it: hard pivots (points that cannot move: a joint with no freedom, an anchor joint, a fixed point the body
// passes through) and soft attachments (free joints coincident with a joint outside the body: dragged along, or a pivot for a pure turn).
function moverOf(state, fr, op, anchorOp, mode) {
  const anchorJoints = new Set(anchorOp.kind === 'joint' ? [anchorOp.id] : ((shapeOf(state, anchorOp.id) || {}).joints || []));
  const body = bodyOf(state, op, anchorJoints, mode);
  const hardIds = [...body.joints].filter(j => !jointFree(fr, j) || anchorJoints.has(j));
  const hard = hardIds.map(j => pos(state, j));
  const cs = state.constraints.filter(isDriving);
  for (const c of cs) {
    if (c.type === T.POINT_ON_LINE && body.shapes.some(s => s.id === c.shape) && !body.joints.has(c.joint) && !jointFree(fr, c.joint)) hard.push(pos(state, c.joint));
    if (c.type === T.MIDPOINT && c.joints && c.joints.length === 3 && body.joints.has(c.joints[0]) && body.joints.has(c.joints[1]) && !body.joints.has(c.joints[2]) && !jointFree(fr, c.joints[2])) hard.push(pos(state, c.joints[2]));
  }
  const pivots = [];
  for (const p of hard) if (p && !pivots.some(q => len(sub(p, q)) < EPS_POS)) pivots.push(p);
  // coincident partners outside the body, transitively (a coincident cluster moves together)
  const partners = new Map();
  for (const j of body.joints) {
    if (hardIds.includes(j)) continue;
    const cl = new Set([j]); const q = [j];
    while (q.length) { const x = q.shift(); for (const c of cs) if (c.type === T.COINCIDENT && Array.isArray(c.joints) && c.joints.includes(x)) for (const o of c.joints) if (!cl.has(o) && !body.joints.has(o)) { cl.add(o); q.push(o); } }
    cl.delete(j);
    if (cl.size) partners.set(j, [...cl]);
  }
  return { op, body, pivots, hardIds, partners, anchorJoints };
}

// Similarity x -> P + s R(th) (x - P) + t.
const motion = (P, s, th, t = { x: 0, y: 0 }) => ({ P, s, c: Math.cos(th), n: Math.sin(th), t });
const moveTo = (m, x) => { const dx = x.x - m.P.x, dy = x.y - m.P.y; return { x: m.P.x + m.s * (m.c * dx - m.n * dy) + m.t.x, y: m.P.y + m.s * (m.n * dx + m.c * dy) + m.t.y }; };
const translation = (t) => motion({ x: 0, y: 0 }, 1, 0, t);

// The one pivot of a pure turn: the single hard pivot, else (softPivot) the single attached joint of the mover's own shape, else `fallback`.
function turnPivot(state, M, ownJoints, fallback, softPivot) {
  if (M.pivots.length > 1) return null;
  if (M.pivots.length === 1) return M.pivots[0];
  if (softPivot) { const att = ownJoints.filter(j => M.partners.has(j)); if (att.length === 1) return pos(state, att[0]); }
  return fallback;
}
// The motion that takes the point Q (of the mover) to T: a translation when nothing holds the mover, else the turn + scale about its one pivot.
function pointMotion(M, Q, T) {
  if (M.pivots.length > 1) return null;
  if (M.pivots.length === 0) return translation(sub(T, Q));
  const H = M.pivots[0], q = sub(Q, H), t = sub(T, H);
  if (len(q) < EPS_POS) return null;
  return motion(H, len(t) / len(q), ang(t) - ang(q));
}
const lineEnds = (state, sh) => [pos(state, sh.joints[0]), pos(state, sh.joints[1])];
const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const project = (X, a, b) => { const u = sub(b, a), l2 = u.x * u.x + u.y * u.y; const k = ((X.x - a.x) * u.x + (X.y - a.y) * u.y) / l2; return { x: a.x + k * u.x, y: a.y + k * u.y }; };
const unitNormal = (a, b) => { const u = sub(b, a), l = len(u); return { x: -u.y / l, y: u.x / l }; };

// The placement that is not one similarity: the least-change solve of the mover alone (trySolveAlone), the anchor frozen. Fusion moves the
// mover this way for tangents, equal circles and angle dimensions (a free line stretches, a circle slides AND resizes).
const SOLVE_ALONE = Object.freeze({ solveAlone: true });

// direction placements: turn the mover line by `th(moverDir, anchorDir)` about its pivot
const turnLine = (thOf, softPivot) => (state, M, A, c) => {
  const ms = shapeOf(state, M.op.id), as = shapeOf(state, A.id);
  if (!isLine(ms) || !isLine(as)) return null;
  const [p, q] = lineEnds(state, ms), [a, b] = lineEnds(state, as);
  const th = thOf(sub(q, p), sub(b, a), M.op.id === c.shapes[1], c);
  if (th == null) return null;
  const P = turnPivot(state, M, ms.joints, mid(p, q), softPivot);
  return P ? motion(P, 1, th) : null;
};
const parallelTurn = (u, d) => halfTurn(ang(d) - ang(u));
// perpendicular: the smaller turn to 90 degrees; exactly parallel is a tie and turns counter-clockwise (+90)
const perpendicularTurn = (u, d) => { const th = halfTurn(ang(d) + Math.PI / 2 - ang(u)); return Math.abs(Math.abs(th) - Math.PI / 2) < 1e-12 ? Math.PI / 2 : th; };
const turnPerpendicular = turnLine(perpendicularTurn, true);

export const PLACE = {
  parallel: { operands: (s, c) => shapesOp(c), place: turnLine(parallelTurn, true) },
  // perpendicular: the mover turns to 90 degrees. With a handedness locked (createConstraint's lockPerpendicularBranch) the solver row
  // u x v - branch|u||v| is stationary at EXACTLY 90 degrees (its Jacobian row vanishes and the DOF count loses it), so then the mover
  // reaches it by the least-change solve of the mover alone instead of the exact turn.
  perpendicular: { operands: (s, c) => shapesOp(c), place: (state, M, A, c) => (c.branch === 1 || c.branch === -1 ? SOLVE_ALONE : turnPerpendicular(state, M, A, c)) },
  // collinear: turn parallel about the hard pivot (else the midpoint), then slide onto the anchor's line (only when nothing holds the mover)
  collinear: {
    operands: (s, c) => shapesOp(c),
    place: (state, M, A) => {
      const ms = shapeOf(state, M.op.id), as = shapeOf(state, A.id);
      if (!isLine(ms) || !isLine(as)) return null;
      const [p, q] = lineEnds(state, ms), [a, b] = lineEnds(state, as);
      if (M.pivots.length > 1) return null;
      const P = M.pivots.length ? M.pivots[0] : mid(p, q);
      const turn = motion(P, 1, parallelTurn(sub(q, p), sub(b, a)));
      if (M.pivots.length) return turn;
      const m2 = moveTo(turn, mid(p, q)), n = unitNormal(a, b), off = (m2.x - a.x) * n.x + (m2.y - a.y) * n.y;
      return { ...turn, t: { x: -off * n.x, y: -off * n.y } };
    },
  },
  // equal lines: scale the mover about its held point (else its single attached end, else its start): one end slides along the line
  'equal-line-line': {
    operands: (s, c) => shapesOp(c),
    place: (state, M, A) => {
      const ms = shapeOf(state, M.op.id), as = shapeOf(state, A.id);
      if (!isLine(ms) || !isLine(as)) return null;
      const [p, q] = lineEnds(state, ms), [a, b] = lineEnds(state, as);
      const l = len(sub(q, p));
      if (l < EPS_POS) return null;
      const P = turnPivot(state, M, ms.joints, p, true);
      return P ? motion(P, len(sub(b, a)) / l, 0) : null;
    },
  },
  // equal circles / arcs: the mover alone takes the anchor's radius by least change (Fusion moves a free arc's centre too)
  'equal-circle': { operands: (s, c) => shapesOp(c), place: () => SOLVE_ALONE },
  // point-point: the mover's point goes onto the anchor's point / row / column, at the dimension's distance
  'coincident-pp': { body: 'component', operands: (s, c) => jointsOp(c), place: (state, M, A) => pointMotion(M, pos(state, M.op.id), pos(state, A.id)) },
  'horizontal-2pt': { body: 'component', operands: (s, c) => jointsOp(c), place: (state, M, A) => toRow(state, M, A) },
  'vertical-2pt': { body: 'component', operands: (s, c) => jointsOp(c), place: (state, M, A) => toColumn(state, M, A) },
  'dim-aligned': { body: 'component', operands: (s, c) => jointsOp(c), place: (state, M, A, c) => atDistance(state, M, A, c) },
  'dim-horizontal': { body: 'component', operands: (s, c) => jointsOp(c), place: (state, M, A, c) => atDistance(state, M, A, c) },
  'dim-vertical': { body: 'component', operands: (s, c) => jointsOp(c), place: (state, M, A, c) => atDistance(state, M, A, c) },
  // angle: the mover alone takes the new angle by least change (Fusion stretches a free line, swings a pinned one)
  'dim-angle': { operands: (s, c) => shapesOp(c), place: () => SOLVE_ALONE },
  // point on a line: the point moves onto the line (its foot), or the line moves through the point (slides along its normal, or turns
  // about its held point)
  pointOnLine: {
    body: 'component',
    operands: (s, c) => [{ kind: 'joint', id: c.joint }, { kind: 'shape', id: c.shape }],
    place: (state, M, A) => {
      if (M.op.kind === 'joint') { const as = shapeOf(state, A.id); const [a, b] = lineEnds(state, as); return pointMotion(M, pos(state, M.op.id), project(pos(state, M.op.id), a, b)); }
      const ms = shapeOf(state, M.op.id), X = pos(state, A.id), [p, q] = lineEnds(state, ms);
      if (M.pivots.length > 1) return null;
      if (!M.pivots.length) return translation(sub(X, project(X, p, q)));
      const H = M.pivots[0];
      if (len(sub(X, H)) < EPS_POS) return null;
      return motion(H, 1, halfTurn(ang(sub(X, H)) - ang(sub(q, p))));
    },
  },
  // point on a circle / arc: the point moves radially onto the rim, or the circle slides along the centre line, or (centre held) resizes
  pointOnCircle: {
    body: 'component',
    operands: (s, c) => [{ kind: 'joint', id: c.joint }, { kind: 'shape', id: c.shape }],
    place: (state, M, A) => {
      if (M.op.kind === 'joint') {
        const as = shapeOf(state, A.id), C = pos(state, as.joints[0]), Q = pos(state, M.op.id), d = sub(Q, C), l = len(d), R = radiusOf(state, as);
        return l < EPS_POS ? null : pointMotion(M, Q, { x: C.x + d.x / l * R, y: C.y + d.y / l * R });
      }
      return circleThrough(state, M, shapeOf(state, M.op.id), pos(state, A.id));
    },
  },
  // midpoint: the point moves to the line's midpoint, or the line moves (slides, or turns + scales about its held point) so its midpoint lands on the point
  midpoint: {
    body: 'component',
    operands: (s, c) => { const l = lineOfPair(s, c.joints[0], c.joints[1]); return l ? [{ kind: 'joint', id: c.joints[2] }, { kind: 'shape', id: l.id }] : null; },
    place: (state, M, A) => {
      if (M.op.kind === 'joint') { const [a, b] = lineEnds(state, shapeOf(state, A.id)); return pointMotion(M, pos(state, M.op.id), mid(a, b)); }
      const [p, q] = lineEnds(state, shapeOf(state, M.op.id));
      return pointMotion(M, mid(p, q), pos(state, A.id));
    },
  },
  'tangent-line-circle': {
    operands: (s, c) => (c.line && c.circle ? [{ kind: 'shape', id: c.line }, { kind: 'shape', id: c.circle }] : shapesOp(c)),
    place: (state, M, A) => {
      const ms = shapeOf(state, M.op.id), as = shapeOf(state, A.id);
      const line = isLine(ms) ? ms : as, circ = isLine(ms) ? as : ms;
      if (!isLine(line) || !isCirc(circ)) return null;
      const [a, b] = lineEnds(state, line), C = pos(state, circ.joints[0]), R = radiusOf(state, circ), n = unitNormal(a, b);
      const d = (C.x - a.x) * n.x + (C.y - a.y) * n.y, dt = (d < 0 ? -1 : 1) * R;
      if (ms === line) return SOLVE_ALONE;      // Fusion stretches a free line onto the circle, slides an H/V one, swings a pinned one
      if (M.pivots.length > 1) return null;
      if (!M.pivots.length) return translation({ x: (dt - d) * n.x, y: (dt - d) * n.y });
      if (len(sub(M.pivots[0], C)) > EPS_POS || R < EPS_POS) return null;
      return motion(C, Math.abs(d) / R, 0);
    },
  },
  // tangent circles: the mover alone by least change (Fusion slides and resizes a free circle, resizes one whose centre is held)
  'tangent-circle-circle': { operands: (s, c) => shapesOp(c), place: () => SOLVE_ALONE },
  // symmetric (task 563, #core/symmetric.js): the mover becomes the MIRROR IMAGE of the anchor across the symmetry line (the line stays). A point
  // goes to the anchor point's mirror (its body translates, or turns + scales about its one held point); a free line / circle / arc is taken
  // by ONE similarity onto the anchor's mirror image (a line: its two paired ends; a circle / arc: centre and radius); a mover that is held
  // somewhere takes it by the least-change solve of the mover alone.
  symmetric: {
    body: 'component',
    operands: (s, c) => {
      const o = symmetricOperands(c, s.shapes);
      if (!o) return null;
      return o.form === 'points' ? jointsOp(c) : shapesOp(c);
    },
    place: (state, M, A, c) => {
      const o = symmetricOperands(c, state.shapes);
      const la = pos(state, o.line[0]), lb = pos(state, o.line[1]);
      const R = (id) => mirrorPoint(pos(state, id), la, lb);
      if (o.form === 'points') return pointMotion(M, pos(state, M.op.id), R(A.id));
      if (M.pivots.length) return SOLVE_ALONE;
      if (o.form === 'lines') {
        const moverIsFirst = M.op.id === c.shapes[0];
        const [[m1, a1], [m2, a2]] = o.pairs.map(([p, q]) => (moverIsFirst ? [p, q] : [q, p]));   // [the mover's end, the anchor's end]
        return similarityTaking(pos(state, m1), pos(state, m2), R(a1), R(a2));
      }
      const ms = shapeOf(state, M.op.id), as = shapeOf(state, A.id), C = pos(state, ms.joints[0]), rm = radiusOf(state, ms);
      return rm < EPS_POS ? null : motion(C, radiusOf(state, as) / rm, 0, sub(R(as.joints[0]), C));
    },
  },
};
// The direct similarity that takes p1 -> t1 and p2 -> t2 (a turn + scale about p1, then a translation), or null for a zero-length mover.
function similarityTaking(p1, p2, t1, t2) {
  const d = sub(p2, p1), e = sub(t2, t1);
  if (len(d) < EPS_POS) return null;
  return motion(p1, len(e) / len(d), ang(e) - ang(d), sub(t1, p1));
}
function toRow(state, M, A) { const Q = pos(state, M.op.id); return pointMotion(M, Q, { x: Q.x, y: pos(state, A.id).y }); }
function toColumn(state, M, A) { const Q = pos(state, M.op.id); return pointMotion(M, Q, { x: pos(state, A.id).x, y: Q.y }); }
// the mover's point at the dimension's value from the anchor's point: along the line joining them (aligned), or along x / y
function atDistance(state, M, A, c) {
  const Q = pos(state, M.op.id), P = pos(state, A.id), d = sub(Q, P), v = c.value, mode = c.dimMode || 'aligned';
  if (mode === 'horizontal') return pointMotion(M, Q, { x: P.x + (d.x < 0 ? -v : v), y: Q.y });
  if (mode === 'vertical') return pointMotion(M, Q, { x: Q.x, y: P.y + (d.y < 0 ? -v : v) });
  const l = len(d);
  return l < EPS_POS ? null : pointMotion(M, Q, { x: P.x + d.x / l * v, y: P.y + d.y / l * v });
}
function shapesOp(c) { return Array.isArray(c.shapes) && c.shapes.length === 2 ? [{ kind: 'shape', id: c.shapes[0] }, { kind: 'shape', id: c.shapes[1] }] : null; }
function jointsOp(c) { return Array.isArray(c.joints) && c.joints.length === 2 ? [{ kind: 'joint', id: c.joints[0] }, { kind: 'joint', id: c.joints[1] }] : null; }
// the circle (mover) passes through X: slide its centre along the centre line, or (centre held) change its radius
function circleThrough(state, M, sh, X) {
  const C = pos(state, sh.joints[0]), R = radiusOf(state, sh), d = sub(C, X), l = len(d);
  if (M.pivots.length > 1 || l < EPS_POS) return null;
  if (!M.pivots.length) return translation({ x: X.x + d.x / l * R - C.x, y: X.y + d.y / l * R - C.y });
  if (len(sub(M.pivots[0], C)) > EPS_POS || R < EPS_POS) return null;
  return motion(C, l / R, 0);
}

// Which table key a creation belongs to (the graded Fusion groups), or null when no who-moves placement applies.
export function placementKey(state, type, c) {
  const shp = (i) => (Array.isArray(c.shapes) ? shapeOf(state, c.shapes[i]) : null);
  switch (type) {
    case T.PARALLEL: case T.PERPENDICULAR: return isLine(shp(0)) && isLine(shp(1)) ? type : null;
    case T.COLLINEAR: return isLine(shp(0)) && isLine(shp(1)) ? 'collinear' : null;
    case T.EQUAL: return isLine(shp(0)) && isLine(shp(1)) ? 'equal-line-line' : isCirc(shp(0)) && isCirc(shp(1)) ? 'equal-circle' : null;
    case T.COINCIDENT: return Array.isArray(c.joints) && c.joints.length === 2 ? 'coincident-pp' : null;
    case T.HORIZONTAL: case T.VERTICAL:
      return Array.isArray(c.joints) && c.joints.length === 2 ? type + '-2pt' : null;
    case T.POINT_ON_LINE: { const s = c.shape ? shapeOf(state, c.shape) : null; return isLine(s) ? 'pointOnLine' : isCirc(s) ? 'pointOnCircle' : null; }
    case T.DISTANCE: {
      if (!isDriving(c) || typeof c.value !== 'number') return null;
      if (c.isRadius || !Array.isArray(c.joints) || c.joints.length !== 2) return null;       // radius, point-to-line, line-line: no pair to place
      return 'dim-' + (c.dimMode || 'aligned');
    }
    case T.ANGLE: return isDriving(c) && typeof c.value === 'number' && isLine(shp(0)) && isLine(shp(1)) ? 'dim-angle' : null;
    case T.MIDPOINT: return Array.isArray(c.joints) && c.joints.length === 3 && lineOfPair(state, c.joints[0], c.joints[1]) ? 'midpoint' : null;
    case T.SYMMETRIC: return symmetricOperands(c, state.shapes) ? 'symmetric' : null;
    case T.TANGENT: {
      const pair = c.line && c.circle ? [shapeOf(state, c.line), shapeOf(state, c.circle)] : [shp(0), shp(1)];
      if (pair.some(x => !x)) return null;
      if (pair.some(isLine) && pair.some(isCirc)) return 'tangent-line-circle';
      return pair.every(isCirc) ? 'tangent-circle-circle' : null;
    }
    default: return null;
  }
}

// The shapes an operand belongs to: a shape is itself; a picked point belongs to every shape that has it as a joint.
const shapesOfOperand = (state, op) => (op.kind === 'shape' ? [op.id] : state.shapes.filter(s => Array.isArray(s.joints) && s.joints.includes(op.id)).map(s => s.id));

// The creation as the table sees it: { key, ops: [first pick, second pick] } or null. "Who moves" is a question between two DIFFERENT
// bodies: when both operands belong to the SAME shape (two points of one line / arc / circle: H / V of a line, its length, an arc's centre
// and end, a radius), there is no anchor and no giver: nothing is placed and the constraint goes to the solve from the untouched pose.
export function creationOperands(state, type, c) {
  const key = placementKey(state, type, c);
  const spec = key && PLACE[key];
  const ops = spec ? spec.operands(state, c) : null;
  if (!ops) return null;
  const first = new Set(shapesOfOperand(state, ops[0]));
  if (shapesOfOperand(state, ops[1]).some(id => first.has(id))) return null;
  return { key, ops };
}

// ---------------------------------------------------------------------------------------------------------- 2. reading the table
const rankOf = (entry, cls) => { const i = entry ? entry.tiers.findIndex(t => t.includes(cls)) : -1; return i < 0 ? null : i; };
// true when the FIRST pick is the one that gives way: its class is in a lower tier; the same tier, or a class the table does not rank,
// follows the key's tie rule (Fusion's usual: the second pick gives way; a key without an entry uses that too)
export function firstGivesWay(key, clsFirst, clsSecond) {
  const e = WHO_MOVES[key], rf = rankOf(e, clsFirst), rs = rankOf(e, clsSecond);
  if (rf != null && rs != null && rf !== rs) return rf < rs;
  return !!e && e.tie === 'first';
}

// The least-change move of the mover alone: the anchor is frozen (its joints held, a circle's radius held by a temporary radius
// dimension), the new constraint is added and the sketch solved; kept only when the solve converges without collapsing a shape.
function trySolveAlone(state, anchorOp, cand) {
  const anchorShapes = anchorOp.kind === 'shape' ? [shapeOf(state, anchorOp.id)] : [];
  const anchorJoints = anchorOp.kind === 'joint' ? [anchorOp.id] : (anchorShapes[0] ? anchorShapes[0].joints : []);
  const snap = snapshotSolverState(state.joints, state.shapes), sizes = measureShapeSizes(state);
  const freed = anchorJoints.map(id => state.joints.get(id)).filter(j => j && !j.fixed);
  const temps = [cand, ...anchorShapes.filter(hasRadiusUnknown).map(s => ({ type: T.DISTANCE, shape: s.id, isRadius: true, value: s.radius }))];
  let res = null;
  try {
    for (const j of freed) j.fixed = true;
    state.constraints.push(...temps);
    res = state.engine.solve(SolverConfig.ITERATIONS || 500);
  } finally {
    for (const j of freed) j.fixed = false;
    for (const t of temps) { const i = state.constraints.indexOf(t); if (i >= 0) state.constraints.splice(i, 1); }
  }
  const ok = !!(res && res.converged) && !findCollapsedShape(state, sizes);
  if (!ok) restoreSolverState(state.joints, state.shapes, snap);
  return ok;
}

// Apply `mo` to the mover; keep it only if the new constraint is satisfied and (unless `force`) no existing driving constraint got worse.
// Returns true when kept.
function tryMotion(state, M, mo, cand, before, force = false) {
  if (!mo || ![mo.s, mo.c, mo.n, mo.t.x, mo.t.y].every(Number.isFinite) || mo.s <= 0) return false;
  for (const id of M.hardIds) { const p = pos(state, id), q = moveTo(mo, p); if (len(sub(p, q)) > EPS_POS * Math.max(1, len(p))) return false; }
  const saved = new Map(), radii = new Map();
  const put = (id, x) => { const j = state.joints.get(id); if (!saved.has(id)) saved.set(id, { x: j.x, y: j.y }); j.x = x.x; j.y = x.y; };
  for (const id of M.body.joints) {
    if (M.hardIds.includes(id)) continue;
    const p = pos(state, id), q = moveTo(mo, p);
    put(id, q);
    for (const o of M.partners.get(id) || []) { const j = state.joints.get(o); put(o, { x: j.x + q.x - p.x, y: j.y + q.y - p.y }); }
  }
  if (Math.abs(mo.s - 1) > 1e-15) for (const s of M.body.shapes) if (s.type === 'circle' && typeof s.radius === 'number') { radii.set(s, s.radius); s.radius *= mo.s; }
  const ok = measureResidual(cand, state.joints, state.shapes) <= EPS_SAT
    && (force || before.every(([c, r]) => measureResidual(c, state.joints, state.shapes) <= r + EPS_WORSE));
  if (!ok) {
    for (const [id, p] of saved) { const j = state.joints.get(id); j.x = p.x; j.y = p.y; }
    for (const [s, r] of radii) s.radius = r;
  }
  return ok;
}

// THE creation placement. Called by ConstraintManager.placeForCreation (createConstraint before the solve, its sandbox check, and a
// dimension's value edit). Returns true when an operand was placed.
export function placeForCreation(state, type, normalized) {
  if (!state || !state.engine || typeof state.engine.jointFreedom !== 'function') return false;
  const cand = { ...normalized, type };
  if (measureResidual(cand, state.joints, state.shapes) <= EPS_SAT) return false;        // already satisfied: nothing moves
  const co = creationOperands(state, type, normalized);
  if (!co) return false;
  const fr = freedomOf(state);
  const [first, second] = co.ops;
  const order = firstGivesWay(co.key, holdClass(state, fr, first), holdClass(state, fr, second)) ? [first, second] : [second, first];
  const before = state.constraints.filter(isDriving).map(c => [c, measureResidual(c, state.joints, state.shapes)]);
  let start = null;
  for (const [mover, anchor] of [order, [order[1], order[0]]]) {
    const M = moverOf(state, fr, mover, anchor, PLACE[co.key].body || 'shape');
    const mo = PLACE[co.key].place(state, M, anchor, normalized);
    if (mo === SOLVE_ALONE ? trySolveAlone(state, anchor, cand) : tryMotion(state, M, mo, cand, before)) return true;
    if (!start && mo && mo !== SOLVE_ALONE) start = { M, mo };
  }
  // neither operand can satisfy it alone: the solve starts from the giving operand's placement (it repairs the rest; from the unplaced
  // pose the solve may not leave a stationary start, e.g. a perpendicular from exactly parallel lines)
  return !!start && tryMotion(state, start.M, start.mo, cand, before, true);
}
