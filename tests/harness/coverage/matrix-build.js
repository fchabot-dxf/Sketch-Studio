// TASK 512 -- matrix harness, part A: shape-kind builders, the four variants, the document snapshot. Everything is made with the SAME builders the
// tools use (L.* from tests/harness/audit/lib.js: makeArc, makePolygon, applyFillet, the line-tool coincident joins, makeBezier).
import * as L from '../audit/lib.js';
import { makeBezier } from '#core/shapes.js';
import { toggleFixedSelection } from '#ui/input-manager.js';
import { ConstraintManager } from '#core/constraint-manager.js';

// column kinds (the shape kinds of the inventory that can be an operand). Letters keep the grid narrow.
export const KINDS = [
  { k: 'L', name: 'line', lineLike: true },
  { k: 'C', name: 'construction line', lineLike: true },
  { k: 'S', name: 'polygon side', lineLike: true },
  { k: 'R', name: 'rect side', lineLike: true },
  { k: 'O', name: 'circle', circleLike: true },
  { k: 'A', name: 'arc', circleLike: true },
  { k: 'F', name: 'fillet arc', circleLike: true },
  { k: 'B', name: 'bezier' },
  { k: 'P', name: 'point' },
];
export const kind = (k) => KINDS.find(x => x.k === k);
export const lineLike = (k) => !!kind(k).lineLike;
export const circleLike = (k) => !!kind(k).circleLike;
export const hasShape = (k) => k !== 'P';

export const VARIANTS = ['sep', 'shared', 'locked', 'dimmed'];

// Build one operand of kind k at (ox, oy). dir: direction of line-like operands. Returns { k, shape, joints, jn (the joint this kind offers as "its point"), extra }.
export function build(S, k, ox, oy, dir = [60, 20]) {
  const st = S.state;
  switch (k) {
    case 'L': case 'C': {
      const a = L.point(S, ox, oy), b = L.point(S, ox + dir[0], oy + dir[1]);
      const id = L.line(S, a, b, k === 'C');
      return { k, shape: id, joints: [a, b], jn: a };
    }
    case 'S': {
      const c = L.point(S, ox + 40, oy + 40), v = L.point(S, ox + 40 + 35, oy + 40);   // pentagon, circumradius 35, first corner to the right of the centre
      const built = L.polygon(S, c, v, 5);
      const side = built.shapes.find(s => s.type === 'line' && !s.isConstruction);
      return { k, shape: side.id, joints: side.joints.slice(), jn: side.joints[0], extra: { centre: c } };
    }
    case 'R': {   // the top side of a rect-tool rectangle (2-point mode): its H/V + corner joints come with it
      { const t = Date.now(); while (Date.now() === t) { /* two rects in one millisecond share an id base (finding F7's family): wait like a person would */ } }
      const r = L.rect(S, ox, oy, ox + Math.max(Math.abs(dir[0]), 40), oy + 40);
      const top = L.shape(S, r.top);
      return { k, shape: r.top, joints: top.joints.slice(), jn: top.joints[0], extra: { rect: r } };
    }
    case 'O': { const r = L.circle(S, ox, oy, 15); return { k, shape: r.id, joints: [r.c], jn: r.c }; }
    case 'A': {
      const c = L.point(S, ox, oy), s = L.point(S, ox + 20, oy), e = L.point(S, ox, oy + 20);
      const id = L.arc(S, c, s, e);
      return { k, shape: id, joints: [c, s, e], jn: c };
    }
    case 'F': {
      const segs = L.polyline(S, [[ox + 50, oy], [ox, oy], [ox, oy + 50]], false);
      const f = L.fillet(S, segs[0].id, segs[1].id, 10);
      const arc = L.shape(S, f.arc);
      return { k, shape: f.arc, joints: arc.joints.slice(), jn: arc.joints[0], extra: { lines: segs.map(s => s.id) } };
    }
    case 'B': {
      const p0 = L.point(S, ox, oy), p3 = L.point(S, ox + 60, oy + 20);
      const built = makeBezier(st.joints, p0, p3, [ox + 20, oy - 30], [ox + 40, oy + 50]);
      built.shapes.forEach(s => st.shapes.push(s));
      return { k, shape: built.shapes[0].id, joints: [p0, p3], jn: p0 };
    }
    case 'P': { const p = L.point(S, ox, oy); return { k, shape: null, joints: [p], jn: p }; }
  }
  throw new Error('unknown kind ' + k);
}

// replace joint `drop` by `keep` everywhere (shapes, constraints). The merged joint stays where `keep` is.
function mergeJoint(S, keep, drop) {
  const st = S.state;
  for (const s of st.shapes) if (Array.isArray(s.joints)) s.joints = s.joints.map(j => (j === drop ? keep : j));
  for (const c of st.constraints) {
    if (!c) continue;
    if (Array.isArray(c.joints)) c.joints = c.joints.map(j => (j === drop ? keep : j));
    if (c.joint === drop) c.joint = keep;
  }
  st.joints.delete(drop);
}

// the variants. X and Y are built operands (Y null for a single-operand cell).
//  sep:    nothing shared
//  shared: Y's own point is merged into X's last joint (the two shapes share a joint, as after a weld / polygon / fillet / import)
//  locked: every joint of X is locked through the REAL toggleFixedSelection (the Lock button / F key)
//  dimmed: X (and Y) already carry a driving dimension (the pair's aligned distance; or the length / radius of a lone shape)
export function applyVariant(S, variant, X, Y) {
  const st = S.state;
  if (variant === 'sep') return { note: '' };
  if (variant === 'shared') {
    if (!Y) return { na: 'one operand: no second shape to share a joint with' };
    const keep = X.joints[X.joints.length > 1 ? 1 : 0], drop = Y.jn;
    mergeJoint(S, keep, drop);
    Y.joints = Y.joints.map(j => (j === drop ? keep : j));
    Y.jn = Y.joints.length > 1 && Y.joints[1] !== keep ? Y.joints[1] : keep;   // pick the joint that is NOT the shared one when the shape has another
    return { note: 'shared joint ' + keep };
  }
  if (variant === 'locked') {
    st.selectedJoints = new Set(X.joints);
    toggleFixedSelection(st);
    st.selectedJoints = new Set();
    if (!X.joints.every(j => st.joints.get(j).fixed)) throw new Error('lock did not fix ' + X.joints);
    return { note: 'X locked' };
  }
  if (variant === 'dimmed') {
    const dims = [];
    const aligned = (a, b) => { const A = st.joints.get(a), B = st.joints.get(b); return ConstraintManager.createConstraint(st, 'distance', { joints: [a, b], value: Math.hypot(B.x - A.x, B.y - A.y), dimMode: 'aligned' }, { source: 'audit' }); };
    if (Y) dims.push(aligned(X.jn, Y.jn));
    else if ((X.k === 'L' || X.k === 'C' || X.k === 'S')) dims.push(aligned(X.joints[0], X.joints[1]));
    else if (X.k === 'O' || X.k === 'A') {
      const s = L.shape(S, X.shape); const c = st.joints.get(s.joints[0]);
      const r = typeof s.radius === 'number' ? s.radius : Math.hypot(st.joints.get(s.joints[1]).x - c.x, st.joints.get(s.joints[1]).y - c.y);
      dims.push(ConstraintManager.createConstraint(st, 'distance', { shape: s.id, value: r, isRadius: true }, { source: 'audit' }));
    }
    if (!dims.length) return { na: 'nothing to pre-dimension on this operand' };
    S.engine.solve(L.ITER);
    return { note: 'pre-existing ' + dims.map(d => L.describe(d)).join(',') };
  }
  throw new Error('variant ' + variant);
}

// the document, as the undo stack would restore it: joints, shapes, constraints (volatile __ fields and ids of runtime objects dropped), numbers rounded
export function docOf(S) {
  // canonical form: numbers rounded to 1e-8, volatile __ fields dropped, object keys sorted (undo rebuilds objects in another key order)
  const canon = (v, k) => {
    if (typeof k === 'string' && k.startsWith('__')) return undefined;
    if (typeof v === 'number') return Math.round(v * 1e8) / 1e8;
    if (v && typeof v === 'object' && !Array.isArray(v)) return Object.fromEntries(Object.keys(v).sort().map(key => [key, v[key]]));
    return v;
  };
  return JSON.stringify({
    joints: [...S.state.joints.entries()].map(([id, j]) => [id, j.x, j.y, !!j.fixed]).sort((a, b) => (a[0] < b[0] ? -1 : 1)),
    shapes: S.state.shapes,
    constraints: S.state.constraints.filter(c => c && c.type !== 'mouse_spring'),
  }, canon);
}
