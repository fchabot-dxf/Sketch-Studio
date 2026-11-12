// TASK 518 part 0b -- GRADED which-moves: every constraint / dimension mode of part 0, crossed over every shape kind of the inventory and over how much each
// operand is already held (levels). A = the FIRST pick, B = the SECOND pick (so pick order is the row/column order of the grid, no separate flag).
// A cell is built in OUR sketch with the same builders the tools use (matrix-build.build -> L.rect / L.polygon / L.fillet / L.arc / L.circle), the level is
// applied with real constraints (createConstraint / the Lock action), the document is exported as plain data (export.js serDoc) and replayed in Fusion
// (scripts/fusion-oracle/run-jobs.py), then the SAME act runs through ConstraintManager. Compared: accepted, and per operand: moved? and how.
import * as L from '../audit/lib.js';
import { build } from '../coverage/matrix-build.js';
import { ConstraintManager } from '#core/constraint-manager.js';
import { toggleFixedSelection } from '#ui/input-manager.js';
import { commitDimensionEdit } from '#ui/dimension-seams.js';
import { serDoc } from './export.js';

export const TOL_F = 1e-6;      // Fusion: stayed < 1e-6 mm
export const TOL_O = 1e-4;      // ours: the solver's stop tolerance
const ORIGIN = L.origin;

// ---- levels (strings). Line: 0 free, 1 corner (an endpoint coincident with another free line), 2 length dim, 3 H/V, 4 one end fixed, 5 end fixed + length,
// 6 H/V + end fixed, 7 fully constrained by constraints + dimensions (H/V + length + two position dims from the origin), o one end coincident with the origin,
// m midpoint at the origin. Rect side: 0, 4 corner fixed, 8 whole rectangle fully constrained. Polygon side: 0, 4 centre fixed, 7 polygon fully constrained.
// Circle / arc: 0, c centre fixed, r radius dim, cr both. Fillet arc (it carries its own R dim): 0, c. Point: 0, 4 fixed. Origin: 0.
export const LEVELS = {
  L: ['0', '1', '2', '3', '4', '5', '6', '7'], C: ['0', '4'], R: ['0', '8'], S: ['0'],
  O: ['0', 'c', 'r', 'cr'], A: ['0', 'c', 'r', 'cr'], F: ['0', 'c'], P: ['0', '4'], Z: ['0'],
};
const LEVELS_LO = ['0', '1', '2', '3', '4', '5', '6', '7', 'o', 'm'];   // L-L of the point groups: the origin levels too
const LEVELS_SHORT = { L: ['0', '3', '4', '7'] };          // a free-standing line against a non-line operand
const LEVELS_PTS = { L: ['0', '3', '4', '7', 'o', 'm'], R: ['0'], O: ['0', 'c'], A: ['0'], P: ['0', '4'], Z: ['0'] };   // point operands of the point groups

const LINE = ['L', 'C', 'S', 'R'], CIRC = ['O', 'A', 'F'], PT = ['L', 'R', 'O', 'A', 'P', 'Z'];
const isLine = (k) => LINE.includes(k), isCirc = (k) => CIRC.includes(k);

// layout slots: where each operand is built (so the start geometry does NOT satisfy the constraint). slot1 = the first entity of the pair role, slot2 the second.
const SLOT = {
  ll: [{ at: [20, 20], dir: [60, 15] }, { at: [30, 70], dir: [70, 50] }],
  coll: [{ at: [20, 20], dir: [60, 12] }, { at: [95, 50], dir: [55, 12] }],
  eq: [{ at: [20, 20], dir: [60, 15] }, { at: [30, 70], dir: [100, 10] }],
  ang: [{ at: [20, 20], dir: [60, 15] }, { at: [100, 40], dir: [30, 60] }],
  pp: [{ at: [20, 20], dir: [60, 15] }, { at: [110, 60], dir: [50, 30] }],
  tan: [{ at: [20, 20], dir: [100, 10] }, { at: [70, 70], dir: [60, 20] }],      // slot1 = the line-like, slot2 = the circle-like
  pt: [{ at: [55, 55], dir: [60, 15] }, { at: [20, 20], dir: [100, 10] }],        // slot1 = the point, slot2 = the curve it goes on
  one: [{ at: [20, 20], dir: [60, 15] }],
  cc: [{ at: [40, 40], dir: [60, 15] }, { at: [110, 50], dir: [60, 15] }],
};

// group: kind pairs (in pick order), the layout, the level policy and the act.
//   act(S, X, Y) -> { type, params, dim?: {scale|delta, mode, ...} }   (types of CONSTRAINT_TYPES, dimensions go through the UI flow: placed, then edited)
const jnOf = (X) => X.jn;
const lineJ = (X) => L.shape(X.S, X.shape).joints;
export const GROUPS = [
  { id: 'parallel', slot: 'll', pairs: () => pairsLL(), full: true, act: (X, Y) => ({ type: 'parallel', params: { shapes: [X.shape, Y.shape] } }) },
  { id: 'perpendicular', slot: 'll', pairs: () => pairsLL(), full: true, act: (X, Y) => ({ type: 'perpendicular', params: { shapes: [X.shape, Y.shape] } }) },
  { id: 'collinear', slot: 'coll', pairs: () => pairsLL(), full: true, act: (X, Y) => ({ type: 'collinear', params: { shapes: [X.shape, Y.shape] } }) },
  { id: 'equal-line-line', slot: 'eq', pairs: () => pairsLL(), full: true, act: (X, Y) => ({ type: 'equal', params: { shapes: [X.shape, Y.shape] } }) },
  { id: 'dim-angle', slot: 'ang', pairs: () => pairsLL(), full: true, act: (X, Y) => ({ type: 'angle', params: { shapes: [X.shape, Y.shape] }, dim: { delta: 20 } }) },
  { id: 'coincident-pp', slot: 'pp', pairs: () => crossPts(), full: true, act: (X, Y) => ({ type: 'coincident', params: { joints: [jnOf(X), jnOf(Y)] } }) },
  { id: 'dim-aligned', slot: 'pp', pairs: () => crossPts(), full: true, act: (X, Y) => ({ type: 'distance', params: { joints: [jnOf(X), jnOf(Y)], dimMode: 'aligned' }, dim: { scale: 1.4 } }) },
  { id: 'dim-horizontal', slot: 'pp', pairs: () => crossPts(), act: (X, Y) => ({ type: 'distance', params: { joints: [jnOf(X), jnOf(Y)], dimMode: 'horizontal' }, dim: { scale: 1.4 } }) },
  { id: 'dim-vertical', slot: 'pp', pairs: () => crossPts(), act: (X, Y) => ({ type: 'distance', params: { joints: [jnOf(X), jnOf(Y)], dimMode: 'vertical' }, dim: { scale: 1.4 } }) },
  { id: 'horizontal-2pt', slot: 'pp', pairs: () => crossPts(), act: (X, Y) => ({ type: 'horizontal', params: { joints: [jnOf(X), jnOf(Y)] } }) },
  { id: 'vertical-2pt', slot: 'pp', pairs: () => crossPts(), act: (X, Y) => ({ type: 'vertical', params: { joints: [jnOf(X), jnOf(Y)] } }) },
  { id: 'pointOnLine', slot: 'pt', pairs: () => cross(PT, LINE), act: (X, Y) => ({ type: 'pointOnLine', params: { joint: jnOf(X), shape: Y.shape } }) },
  { id: 'pointOnCircle', slot: 'pt', pairs: () => cross(PT, CIRC), act: (X, Y) => ({ type: 'pointOnLine', params: { joint: jnOf(X), shape: Y.shape } }) },
  { id: 'midpoint', slot: 'pt', pairs: () => cross(PT, LINE), act: (X, Y, S) => { const j = L.shape(S, Y.shape).joints; return { type: 'midpoint', params: { joints: [j[0], j[1], jnOf(X)] } }; } },
  { id: 'equal-circle', slot: 'cc', pairs: () => cross(CIRC, CIRC), act: (X, Y) => ({ type: 'equal', params: { shapes: [X.shape, Y.shape] } }) },
  { id: 'tangent-line-circle', slot: 'tan', pairs: () => [...cross(LINE, CIRC), ...cross(CIRC, LINE)], act: (X, Y) => (isLine(X.k) ? { type: 'tangent', params: { line: X.shape, circle: Y.shape } } : { type: 'tangent', params: { line: Y.shape, circle: X.shape } }) },
  { id: 'tangent-circle-circle', slot: 'cc', pairs: () => cross(CIRC, CIRC), act: (X, Y) => ({ type: 'tangent', params: { shapes: [X.shape, Y.shape] } }) },
  { id: 'horizontal-line', slot: 'one', single: true, pairs: () => LINE.map(k => [k]), act: (X, Y, S) => { const j = L.shape(S, X.shape).joints; return { type: 'horizontal', params: { joints: [j[0], j[1]] } }; } },
  { id: 'vertical-line', slot: 'one', single: true, pairs: () => LINE.map(k => [k]), act: (X, Y, S) => { const j = L.shape(S, X.shape).joints; return { type: 'vertical', params: { joints: [j[0], j[1]] } }; } },
  { id: 'dim-length', slot: 'one', single: true, pairs: () => LINE.map(k => [k]), act: (X, Y, S) => { const j = L.shape(S, X.shape).joints; return { type: 'distance', params: { joints: [j[0], j[1]], dimMode: 'aligned' }, dim: { scale: 1.4 } }; } },
  { id: 'dim-radius', slot: 'one', single: true, pairs: () => CIRC.map(k => [k]), act: (X) => ({ type: 'distance', params: { shape: X.shape, isRadius: true }, dim: { scale: 1.4 } }) },
];
const pairsLL = () => [['L', 'L'], ['L', 'C'], ['C', 'L'], ['L', 'S'], ['S', 'L'], ['L', 'R'], ['R', 'L'], ['C', 'C'], ['S', 'S'], ['R', 'R']];
function cross(A, B) { const o = []; for (const a of A) for (const b of B) o.push([a, b]); return o; }
function crossPts() { return cross(PT, PT).filter(([a, b]) => !(a === 'Z' && b === 'Z')); }

// ---- cell list (data only)
export function buildCells() {
  const cells = [];
  for (const g of GROUPS) {
    for (const kinds of g.pairs()) {
      const [ka, kb] = kinds;
      const ptGroup = g.id === 'pointOnLine' || g.id === 'pointOnCircle' || g.id === 'midpoint';
      const levelsOf = (k, other, first) => {
        if (g.slot === 'pp') return (ka === 'L' && kb === 'L') ? (g.full ? LEVELS_LO : ['0', '2', '3', '4', '7']) : LEVELS_PTS[k];
        if (ptGroup) return first ? LEVELS_PTS[k] : (k === 'L' ? LEVELS_SHORT.L : LEVELS[k]);
        if (k === 'L' && other !== 'L') return LEVELS_SHORT.L;
        return LEVELS[k];
      };
      for (const la of levelsOf(ka, kb, true)) {
        if (g.single) { cells.push({ id: `${g.id}|${ka}|${la}`, group: g.id, kinds: [ka], levels: [la] }); continue; }
        for (const lb of levelsOf(kb, ka, false)) cells.push({ id: `${g.id}|${ka}${kb}|${la},${lb}`, group: g.id, kinds: [ka, kb], levels: [la, lb] });
      }
    }
  }
  return cells;
}
// the class of a cell: group + kind pair (what KNOWN is keyed by)
export const classOf = (cell) => `${cell.group}|${cell.kinds.join('')}`;

// ---- building one cell in OUR sketch
const mk = (S, type, params) => ConstraintManager.createConstraint(S.state, type, params, { source: 'audit' });
const lock = (S, ids) => { S.state.selectedJoints = new Set(ids); toggleFixedSelection(S.state); S.state.selectedJoints = new Set(); };
const P = (S, id) => { const j = S.state.joints.get(id); return [j.x, j.y]; };
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const near = (a, b) => (Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1]) ? 'H' : 'V');

function mkOperand(S, k, slot) {
  if (k === 'Z') return { k, shape: null, joints: [ORIGIN], jn: ORIGIN, comp: { shapes: [], joints: [] }, S };
  const n0 = S.state.shapes.length, j0 = new Set(S.state.joints.keys());
  const X = build(S, k, slot.at[0], slot.at[1], slot.dir);
  const shapes = S.state.shapes.slice(n0).map(s => s.id);
  const joints = new Set(X.joints);
  for (const s of S.state.shapes.slice(n0)) for (const j of s.joints) joints.add(j);
  if (X.extra && X.extra.centre) joints.add(X.extra.centre);
  for (const j of S.state.joints.keys()) if (!j0.has(j) && (k === 'F')) joints.add(j);   // the fillet's virtual sharp
  return { ...X, S, comp: { shapes, joints: [...joints] } };
}

// apply a level to an operand; returns false when it could not be applied
export function applyLevel(S, X, lv) {
  if (lv === '0') return true;
  const st = S.state;
  const lenDim = (a, b) => mk(S, 'distance', { joints: [a, b], value: dist(P(S, a), P(S, b)), dimMode: 'aligned' });
  const posDims = (j) => { const p = P(S, j); mk(S, 'distance', { joints: [ORIGIN, j], value: Math.abs(p[0]), dimMode: 'horizontal' }); mk(S, 'distance', { joints: [ORIGIN, j], value: Math.abs(p[1]), dimMode: 'vertical' }); };
  const k = X.k;
  if (k === 'L' || k === 'C') {
    const [a, b] = X.joints;
    if (lv === '1') { const A = P(S, a); const e0 = L.point(S, A[0], A[1]), e1 = L.point(S, A[0] - 25, A[1] + 35); L.line(S, e0, e1); mk(S, 'coincident', { joints: [a, e0] }); }
    else if (lv === '2') lenDim(a, b);
    else if (lv === '3') mk(S, near(P(S, a), P(S, b)) === 'H' ? 'horizontal' : 'vertical', { joints: [a, b] });
    else if (lv === '4') lock(S, [a]);
    else if (lv === '5') { lock(S, [a]); lenDim(a, b); }
    else if (lv === '6') { mk(S, near(P(S, a), P(S, b)) === 'H' ? 'horizontal' : 'vertical', { joints: [a, b] }); lock(S, [a]); }
    else if (lv === '7') { mk(S, near(P(S, a), P(S, b)) === 'H' ? 'horizontal' : 'vertical', { joints: [a, b] }); lenDim(a, b); posDims(a); }
    else if (lv === 'o') mk(S, 'coincident', { joints: [a, ORIGIN] });
    else if (lv === 'm') mk(S, 'midpoint', { joints: [a, b, ORIGIN] });
    else return false;
  } else if (k === 'R') {
    const r = X.extra.rect;
    if (lv === '4') lock(S, [r.c1]);
    else if (lv === '8') {
      const A = P(S, r.c1), B = P(S, r.c3);
      mk(S, 'distance', { joints: [r.c1, r.c3], value: Math.abs(B[0] - A[0]), dimMode: 'horizontal' });
      mk(S, 'distance', { joints: [r.c1, r.c3], value: Math.abs(B[1] - A[1]), dimMode: 'vertical' });
      posDims(r.c1);
    } else return false;
  } else if (k === 'S') {
    const c = X.extra.centre;
    if (lv === '4') lock(S, [c]);
    else if (lv === '7') {
      const sh = L.shape(S, X.shape); const v = sh.joints[0];
      posDims(c);
      mk(S, 'distance', { joints: [c, v], value: dist(P(S, c), P(S, v)), dimMode: 'aligned' });
      mk(S, near(P(S, c), P(S, v)) === 'H' ? 'horizontal' : 'vertical', { joints: [c, v] });
    } else return false;
  } else if (k === 'O' || k === 'A' || k === 'F') {
    const sh = L.shape(S, X.shape);
    const centre = sh.joints[0];
    const rad = () => { const r = typeof sh.radius === 'number' ? sh.radius : dist(P(S, sh.joints[0]), P(S, sh.joints[1])); mk(S, 'distance', { shape: sh.id, value: r, isRadius: true }); };
    if (lv === 'c') lock(S, [centre]);
    else if (lv === 'r') rad();
    else if (lv === 'cr') { lock(S, [centre]); rad(); }
    else return false;
  } else if (k === 'P') { if (lv === '4') lock(S, [X.jn]); else return false; }
  else return false;
  return true;
}

// layout slot of an operand: for the asymmetric groups the slot follows the kind class, for the symmetric ones the pick order
function slotsFor(g, ka, kb) {
  const sl = SLOT[g.slot];
  if (g.slot === 'tan') return isLine(ka) ? [sl[0], sl[1]] : [sl[1], sl[0]];
  return [sl[0], sl[1] || sl[0]];
}

// Build the cell in our sketch: returns { S, X, Y, doc, act } or { na }.
export function materialize(cell) {
  const g = GROUPS.find(x => x.id === cell.group);
  const S = L.newSketch();
  const [ka, kb] = cell.kinds;
  const [s1, s2] = slotsFor(g, ka, kb);
  const X = mkOperand(S, ka, s1);
  const Y = kb ? mkOperand(S, kb, s2) : null;
  // the point groups place the pair's two points apart: a Z (origin) operand sits at the origin by definition
  if (!applyLevel(S, X, cell.levels[0])) return { na: 'level ' + cell.levels[0] + ' not applicable to ' + ka };
  if (Y && !applyLevel(S, Y, cell.levels[1])) return { na: 'level ' + cell.levels[1] + ' not applicable to ' + kb };
  S.engine.solve(L.ITER);
  if (L.hasNaN(S)) return { na: 'prep produced NaN' };
  const act = g.act(X, Y, S);
  // measured value for dimensions (what the tool places), and the target
  let measured = null;
  if (act.dim) {
    const p = act.params;
    if (act.type === 'angle') {
      const [a, b] = act.params.shapes.map(id => L.shape(S, id).joints.map(j => P(S, j)));
      const ang = (l) => Math.atan2(l[1][1] - l[0][1], l[1][0] - l[0][0]);
      measured = Math.abs((ang(a) - ang(b)) * 180 / Math.PI); if (measured > 180) measured = 360 - measured;
    } else if (p.isRadius) { const sh = L.shape(S, p.shape); measured = typeof sh.radius === 'number' ? sh.radius : dist(P(S, sh.joints[0]), P(S, sh.joints[1])); }
    else { const A = P(S, p.joints[0]), B = P(S, p.joints[1]); measured = p.dimMode === 'horizontal' ? Math.abs(B[0] - A[0]) : p.dimMode === 'vertical' ? Math.abs(B[1] - A[1]) : dist(A, B); }
  }
  const uids = new Map();
  const doc = serDoc(S, uids);
  return { S, X, Y, doc, act, measured };
}

// ---- running the act in OUR sketch. Returns { accepted, driven, before, after, originOk }
const snapAll = (S) => { const m = {}; for (const [id, j] of S.state.joints) m[id] = [j.x, j.y]; return m; };
const radiiOf = (S) => { const r = {}; for (const s of S.state.shapes) { if (s.type === 'circle') r[s.id] = s.radius; else if (s.type === 'arc') r[s.id] = dist(P(S, s.joints[0]), P(S, s.joints[1])); } return r; };
export function runOursCell(M) {
  const { S, act, measured } = M;
  const before = { pts: snapAll(S), radii: radiiOf(S) };
  const muted = (f) => { const e = console.error, w = console.warn; console.error = () => {}; console.warn = () => {}; try { return f(); } finally { console.error = e; console.warn = w; } };
  let ret;
  muted(() => {
    if (act.dim) {
      const c = mk(S, act.type, { ...act.params, value: measured });
      const target = act.dim.scale != null ? measured * act.dim.scale : measured + act.dim.delta;
      if (c && typeof c === 'object' && !L.isDriven(c)) commitDimensionEdit(S.state, c, target);
      ret = c;
    } else ret = mk(S, act.type, act.params);
  });
  const created = ret && typeof ret === 'object' ? ret : null;
  const o = S.state.joints.get(ORIGIN);
  return { accepted: !!ret, driven: !!(created && L.isDriven(created)), before, after: { pts: snapAll(S), radii: radiiOf(S) }, originOk: !!o && o.x === 0 && o.y === 0 };
}

// ---- how an operand moved (same function for Fusion's and our coordinates)
export function describeOperand(jointIds, shapeIds, before, after, tolX) {
  const tol = tolX;
  const ids = jointIds.filter(j => j !== ORIGIN && before.pts[j] && after.pts[j]);
  const dv = ids.map(j => [after.pts[j][0] - before.pts[j][0], after.pts[j][1] - before.pts[j][1]]);
  const movedIdx = dv.map((v, i) => (Math.hypot(v[0], v[1]) > tol ? i : -1)).filter(i => i >= 0);
  let rch = false;
  for (const s of shapeIds) if (before.radii[s] != null && after.radii[s] != null && Math.abs(before.radii[s] - after.radii[s]) > tol) rch = true;
  if (!movedIdx.length && !rch) return { m: 0, how: '-' };
  let how;
  if (!movedIdx.length) how = 'radius';
  else {
    const same = movedIdx.every(i => Math.hypot(dv[i][0] - dv[movedIdx[0]][0], dv[i][1] - dv[movedIdx[0]][1]) <= Math.max(tol, 1e-9) * 10) && movedIdx.length === ids.length;
    if (same) how = 'translate';
    else {
      // pairwise distances: unchanged = rigid (rotation / translate+rotate), uniform ratio = scale, else deform
      let rigid = true, ratio = null, uniform = true;
      for (let i = 0; i < ids.length; i++) for (let k = i + 1; k < ids.length; k++) {
        const d0 = dist(before.pts[ids[i]], before.pts[ids[k]]), d1 = dist(after.pts[ids[i]], after.pts[ids[k]]);
        if (Math.abs(d0 - d1) > tol * 10) rigid = false;
        if (d0 > 1e-9) { const r = d1 / d0; if (ratio == null) ratio = r; else if (Math.abs(r - ratio) > 1e-4) uniform = false; }
      }
      if (ids.length === 2) how = movedIdx.length === 1 ? 'one end' : (rigid ? 'rotate' : 'stretch');
      else if (movedIdx.length === 1) how = 'one point (deform)';
      else how = rigid ? 'rotate' : uniform ? 'scale' : 'deform';
    }
    if (rch) how += '+radius';
  }
  return { m: movedIdx.length || 1, how };
}
export function moveOf(M, before, after, tolX) {
  const jx = M.X.comp.joints, jy = M.Y ? M.Y.comp.joints : [];
  const sx = M.X.comp.shapes, sy = M.Y ? M.Y.comp.shapes : [];
  const X = describeOperand(jx, sx, before, after, tolX), Y = M.Y ? describeOperand(jy, sy, before, after, tolX) : null;
  // anything else that moved (a chain helper line, the other joints of the sketch)
  const known = new Set([...jx, ...jy]);
  let other = 0;
  for (const j of Object.keys(before.pts)) if (!known.has(j) && j !== ORIGIN && after.pts[j] && Math.hypot(after.pts[j][0] - before.pts[j][0], after.pts[j][1] - before.pts[j][1]) > tolX) other++;
  return { X, Y, other: other > 0 ? 1 : 0 };
}
export const keyOf = (mv) => `${mv.X.m ? mv.X.how : '.'} / ${mv.Y ? (mv.Y.m ? mv.Y.how : '.') : '-'}${mv.other ? ' +other' : ''}`;

// ---- one cell: Fusion's recorded answer vs ours
export function fusionMove(M, fres) {
  const step = fres.steps[fres.steps.length - 1];
  if (!fres.initial || !step) return null;
  if (!step.accepted) return { accepted: false, error: step.error };
  // positions are stored by index (joint order of the document minus the origin, shape order): map them onto this build's ids
  const jids = [...M.S.state.joints.keys()].filter(j => j !== ORIGIN), sids = M.S.state.shapes.map(s => s.id);
  const toMap = (snap) => { const pts = {}, radii = {}; jids.forEach((j, i) => { pts[j] = snap.pts[i]; }); sids.forEach((s, i) => { if (snap.radii[i] != null) radii[s] = snap.radii[i]; }); return { pts, radii }; };
  const before = toMap(fres.initial), after = toMap(step.snap);
  const full = {}; sids.forEach((s, i) => { full[s] = step.snap.full ? step.snap.full[i] : null; });
  return { accepted: true, mv: moveOf(M, before, after, TOL_F), originOk: step.snap.origin[0] === 0 && step.snap.origin[1] === 0, valueError: step.valueError, full, driving: step.driving };
}
export function oursMove(M) {
  const r = runOursCell(M);
  if (!r.accepted) return { accepted: false, originOk: r.originOk };
  return { accepted: true, driven: r.driven, mv: moveOf(M, r.before, r.after, TOL_O), originOk: r.originOk };
}
export function cellKey(f, o) {
  const fk = f.accepted ? keyOf(f.mv) : 'refused';
  const ok = o.accepted ? keyOf(o.mv) + (o.driven ? ' (reference)' : '') : 'refused';
  return { fusion: fk, ours: ok, same: fk === ok };
}
