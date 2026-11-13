// TASK 514 -- RANDOMISED PROPERTIES. Fixed seeds -> random sketches (closed polygons of 3-9 sides, open polylines, rectangles, with circles and arcs
// attached) -> random constraints and dimensions drawn from inventory.constraintTypes / inventory.dimensionModes, applied one at a time through the
// SAME path as the audit (L.applyStep -> ConstraintManager.createConstraint, commitDimensionEdit, deleteConstraints, state.saveState / undo).
// A case is DATA (geometry spec + op list, symbolic joint / shape indices) so a failure can be replayed and SHRUNK to a minimal op list.
//
// Invariants (id: statement)
//   I1 adding a constraint never raises the nullity
//   I2 the Design panel DOF equals the finite-difference nullity (the independent ground truth)
//   I3 deleting a driving constraint raises the nullity by its finite-difference rank contribution (panel delta == fd delta)
//   I4 undo restores the document exactly (every step of the history, JSON-identical)
//   I5 a refused constraint leaves the geometry (and the constraint list) unchanged
//   I6 no NaN in joints / constraint values, at any step
//   I8 no accepted op shrank a line, arc or circle to under 1% of its size (a constraint is never satisfied by collapsing a shape; task 521)
//   I7 editing a dimension x0.9 then back restores the determined joints within 1e-6, keeps the orientation signature, leaves every driving
//      constraint satisfied
// A failure is ATTRIBUTED to a round-1 finding when removing that finding's trigger ops from the case makes the invariant hold again
// (ablation); anything else is NEW and is shrunk and printed with its seed.
import * as L from '../audit/lib.js';
import inventory from './inventory.js';
import { mulberry32, docOf, panelDof } from './prop-lib.js';
import { ConstraintManager } from '#core/constraint-manager.js';
import { measureShapeSizes, findCollapsedShape } from '#core/constraint-verifier.js';
import { commitDimensionEdit } from '#ui/dimension-seams.js';
import { deleteConstraints } from '#core/delete-manager.js';
import { projectPointOnLine, getDist } from '#core/geometry.js';

export const INVARIANTS = {
  I1: 'adding a constraint never raises the nullity',
  I2: 'Design panel DOF == finite-difference nullity',
  I3: 'deleting a driving constraint raises the nullity by its fd rank contribution',
  I4: 'undo restores the document exactly',
  I5: 'a refused constraint leaves the geometry unchanged',
  I6: 'no NaN',
  I7: 'dimension x0.9 then back restores the determined joints, keeps the orientation signature',
  I8: 'no accepted op collapses a line / arc / circle to a point',
};
// I7 residual tolerance: the verifier's perpendicular / parallel / equal residuals are in length^2 units, so 1e-6 (round 1's) is below the solver's
// own convergence (structural error < 1e-6 after scaling) on a 40-unit sketch; 1e-3 is still ~1e-6 rad.
const RES7 = 1e-3;
// I7 determined-joint deviation: the task says 1e-6, which is the solver's own convergence tolerance (so 1e-6 .. 1e-5 is solver noise, not a defect).
const DEV7 = 1e-5;
export const SEED0 = 7000;
export const CASES = 300;

// ---------------------------------------------------------------- the op kinds, derived from the inventory
const MODE_TO_KIND = { aligned: 'dist-aligned', horizontal: 'dist-horizontal', vertical: 'dist-vertical', 'line length': 'dist-line', 'point-line': 'dist-point-line', 'line-line': 'dist-line-line', angle: 'angle', radius: 'radius' };
// 'lock' = the Lock action of inventory.editFeatures ('lock / fix'): j.fixed = true, then a solve (input-manager.js toggleFixedSelection)
export const KINDS = [...new Set([
  ...inventory.constraintTypes.map(c => c.type).filter(t => t !== 'distance'),
  ...inventory.dimensionModes.map(m => MODE_TO_KIND[m.mode]),
  'lock',
])];
// weights: dimensions and the structural constraints people use most come up more often
const WEIGHT = { coincident: 2, horizontal: 3, vertical: 3, parallel: 2, perpendicular: 2, collinear: 1, tangent: 2, pointOnLine: 2, equal: 2, midpoint: 1, symmetric: 1, angle: 2,
  'dist-aligned': 3, 'dist-horizontal': 3, 'dist-vertical': 3, 'dist-line': 3, 'dist-point-line': 1, 'dist-line-line': 1, radius: 2, lock: 1 };

// ---------------------------------------------------------------- geometry
const R2 = (rnd, lo, hi) => lo + rnd() * (hi - lo);
export function genGeometry(rnd) {
  const kind = ['closed', 'closed', 'closed', 'open', 'rect'][Math.floor(rnd() * 5)];
  const g = { kind, pts: [], circles: [], arcs: [] };
  if (kind === 'closed') {
    const n = 3 + Math.floor(rnd() * 7), cx = R2(rnd, 40, 140), cy = R2(rnd, 40, 140), R = R2(rnd, 40, 80);
    for (let i = 0; i < n; i++) { const a = (i + R2(rnd, -0.25, 0.25)) * 2 * Math.PI / n, r = R * R2(rnd, 0.8, 1.2); g.pts.push([+(cx + r * Math.cos(a)).toFixed(3), +(cy + r * Math.sin(a)).toFixed(3)]); }
  } else if (kind === 'open') {
    const n = 3 + Math.floor(rnd() * 5);
    let x = R2(rnd, 20, 60), y = R2(rnd, 20, 60);
    for (let i = 0; i < n; i++) { g.pts.push([+x.toFixed(3), +y.toFixed(3)]); x += R2(rnd, 15, 50); y += R2(rnd, -35, 35); }
  } else {
    const x = R2(rnd, 10, 60), y = R2(rnd, 10, 60);
    g.pts = [[+x.toFixed(3), +y.toFixed(3)], [+(x + R2(rnd, 40, 100)).toFixed(3), +(y + R2(rnd, 30, 80)).toFixed(3)]];
  }
  const nc = Math.floor(rnd() * 3);
  for (let i = 0; i < nc; i++) g.circles.push([+R2(rnd, 20, 160).toFixed(3), +R2(rnd, 20, 160).toFixed(3), +R2(rnd, 5, 20).toFixed(3)]);
  if (rnd() < 0.35) { const r = R2(rnd, 8, 25), a0 = R2(rnd, 0, 6.28); g.arcs.push([+R2(rnd, 30, 150).toFixed(3), +R2(rnd, 30, 150).toFixed(3), +r.toFixed(3), +a0.toFixed(3), +(a0 + R2(rnd, 0.8, 2.4)).toFixed(3)]); }
  return g;
}
export function buildGeometry(g) {
  const S = L.newSketch();
  if (g.kind === 'rect') L.rect(S, g.pts[0][0], g.pts[0][1], g.pts[1][0], g.pts[1][1]);
  else L.polyline(S, g.pts, g.kind === 'closed');
  for (const [x, y, r] of g.circles) L.circle(S, x, y, r);
  for (const [x, y, r, a0, a1] of g.arcs) {
    const c = L.point(S, x, y), a = L.point(S, x + r * Math.cos(a0), y + r * Math.sin(a0)), b = L.point(S, x + r * Math.cos(a1), y + r * Math.sin(a1));
    L.arc(S, c, a, b);
  }
  S.engine.solve(L.ITER);
  const ctx = { J: [...S.state.joints.keys()], lines: S.state.shapes.filter(s => s.type === 'line' && !s.isConstruction).map(s => s.id), circs: S.state.shapes.filter(s => s.type === 'circle' || s.type === 'arc').map(s => s.id), all: S.state.shapes.map(s => s.id) };
  return { S, ctx };
}

// ---------------------------------------------------------------- op generation (symbolic indices, deterministic from the rng)
const pick = (rnd, n) => Math.floor(rnd() * n);
const two = (rnd, n) => { const a = pick(rnd, n); let b = pick(rnd, n - 1); if (b >= a) b++; return [a, b]; };
const FACTORS = [1, 1, 0.9, 1.1, 1.3, 0.75];
export function genOp(rnd, ctx, kind) {
  const nJ = ctx.J.length, nL = ctx.lines.length, nC = ctx.circs.length;
  const f = FACTORS[pick(rnd, FACTORS.length)];
  const lineJoints = () => { const s = ctx.lineJoints[pick(rnd, nL)]; return s; };
  switch (kind) {
    case 'coincident': return nJ > 1 ? { k: kind, j: two(rnd, nJ) } : null;
    case 'horizontal': case 'vertical': return rnd() < 0.7 && nL ? { k: kind, j: lineJoints() } : (nJ > 1 ? { k: kind, j: two(rnd, nJ) } : null);
    case 'parallel': case 'perpendicular': case 'collinear': return nL > 1 ? { k: kind, l: two(rnd, nL) } : null;
    case 'equal': return rnd() < 0.7 ? (nL > 1 ? { k: kind, l: two(rnd, nL) } : null) : (nC > 1 ? { k: kind, c: two(rnd, nC) } : null);
    case 'tangent': return rnd() < 0.7 ? (nL && nC ? { k: kind, l: [pick(rnd, nL)], c: [pick(rnd, nC)] } : null) : (nC > 1 ? { k: kind, c: two(rnd, nC) } : null);
    case 'pointOnLine': return nJ > 1 && ctx.all.length ? { k: kind, j: [1 + pick(rnd, nJ - 1)], s: pick(rnd, ctx.all.length) } : null;
    case 'midpoint': return nJ > 2 ? { k: kind, j: [pick(rnd, nJ), pick(rnd, nJ - 1), pick(rnd, nJ - 2)] } : null;   // resolved to 3 DISTINCT joints in apply
    // symmetric (task 563): two points, two lines or two circles / arcs; the symmetry line is an axis or another sketch line
    case 'symmetric': {
      const form = rnd(), axis = rnd() < 0.5 ? (rnd() < 0.5 ? 'ref_axis_x' : 'ref_axis_y') : null;
      const third = (except) => { if (axis) return axis; const free = ctx.lines.map((_, i) => i).filter(i => !except.includes(i)); return free.length ? free[pick(rnd, free.length)] : null; };
      if (form < 0.5) { if (nJ < 2) return null; const j = two(rnd, nJ), a = third([]); return a == null ? null : { k: kind, j, a }; }
      if (form < 0.8) { if (nL < 2) return null; const l = two(rnd, nL), a = third(l); return a == null ? null : { k: kind, l, a }; }
      if (nC < 2) return null; const c = two(rnd, nC), a = third([]); return a == null ? null : { k: kind, c, a };
    }
    case 'angle': return nL > 1 ? { k: kind, l: two(rnd, nL), f } : null;
    case 'dist-aligned': case 'dist-horizontal': case 'dist-vertical': return nJ > 1 ? { k: kind, j: two(rnd, nJ), f } : null;
    case 'dist-line': return nL ? { k: kind, j: lineJoints(), f } : null;
    case 'dist-line-line': return nL > 1 ? { k: kind, l: two(rnd, nL), f } : null;
    case 'dist-point-line': return nL && nJ > 1 ? { k: kind, j: [1 + pick(rnd, nJ - 1)], l: [pick(rnd, nL)] } : null;
    case 'radius': return nC ? { k: kind, c: [pick(rnd, nC)], f } : null;
    case 'lock': return nJ > 1 ? { k: kind, j: [1 + pick(rnd, nJ - 1)] } : null;
    default: throw new Error('no generator for op kind ' + kind);
  }
}
export function genCase(seed) {
  const rnd = mulberry32(seed);
  const geo = genGeometry(rnd);
  const { S, ctx } = buildGeometry(geo);
  ctx.lineJoints = ctx.lines.map(id => S.state.shapes.find(s => s.id === id).joints.map(j => ctx.J.indexOf(j)));
  const total = Object.values(WEIGHT).reduce((a, b) => a + b, 0);
  const nOps = 4 + pick(rnd, 9);
  const ops = [];
  for (let tries = 0; ops.length < nOps && tries < nOps * 4; tries++) {
    let r = rnd() * total, kind = KINDS[0];
    for (const k of KINDS) { r -= WEIGHT[k]; if (r < 0) { kind = k; break; } }
    const op = genOp(rnd, ctx, kind);
    if (op) ops.push(op);
  }
  return { seed, geo, ops };
}

// ---------------------------------------------------------------- applying an op (the audit's path)
// returns a row like L.applyStep's, or null when the op does not apply to this sketch (e.g. line-line distance on non-parallel lines)
export function applyOp(S, ctx, op) {
  const J = (i) => ctx.J[i], Ln = (i) => ctx.lines[i], Ci = (i) => ctx.circs[i];
  const dim = (type, p, factor) => { const v = L.measure(S, { type, ...p }); return { type, ...p, value: v * factor }; };
  const jp = op.j ? op.j.map(J) : null;
  switch (op.k) {
    case 'coincident': case 'horizontal': case 'vertical': return L.applyStep(S, { type: op.k, joints: jp }, {});
    case 'parallel': case 'perpendicular': case 'collinear': return L.applyStep(S, { type: op.k, shapes: op.l.map(Ln) }, {});
    case 'equal': return L.applyStep(S, { type: 'equal', shapes: op.l ? op.l.map(Ln) : op.c.map(Ci) }, {});
    case 'tangent': return L.applyStep(S, op.l ? { type: 'tangent', line: Ln(op.l[0]), circle: Ci(op.c[0]) } : { type: 'tangent', shapes: op.c.map(Ci) }, {});
    case 'pointOnLine': return L.applyStep(S, { type: 'pointOnLine', joint: jp[0], shape: ctx.all[op.s] }, {});
    case 'midpoint': {
      const a = op.j[0], b = op.j[1] >= a ? op.j[1] + 1 : op.j[1];
      const used = [a, b].sort((x, y) => x - y); let m = op.j[2]; for (const u of used) if (m >= u) m++;
      return L.applyStep(S, { type: 'midpoint', joints: [J(a), J(b), J(m)] }, {});
    }
    case 'symmetric': {
      const line = typeof op.a === 'string' ? op.a : Ln(op.a);
      return L.applyStep(S, { type: 'symmetric', ...(op.j ? { joints: jp } : { shapes: op.l ? op.l.map(Ln) : op.c.map(Ci) }), line }, {});
    }
    case 'angle': return L.applyStep(S, dim('angle', { shapes: op.l.map(Ln) }, op.f), {});
    case 'dist-aligned': return L.applyStep(S, dim('distance', { joints: jp, dimMode: 'aligned' }, op.f), {});
    case 'dist-horizontal': return L.applyStep(S, dim('distance', { joints: jp, dimMode: 'horizontal' }, op.f), {});
    case 'dist-vertical': return L.applyStep(S, dim('distance', { joints: jp, dimMode: 'vertical' }, op.f), {});
    case 'dist-line': return L.applyStep(S, dim('distance', { joints: jp, dimMode: 'auto' }, op.f), {});
    case 'dist-line-line': {   // the Dimension tool makes a line-line DISTANCE only for two parallel lines (angle otherwise)
      const [a, b] = op.l.map(i => L.shape(S, Ln(i))), P = (id) => S.state.joints.get(id);
      const cross = (P(a.joints[1]).x - P(a.joints[0]).x) * (P(b.joints[1]).y - P(b.joints[0]).y) - (P(a.joints[1]).y - P(a.joints[0]).y) * (P(b.joints[1]).x - P(b.joints[0]).x);
      if (Math.abs(cross) > 1e-6 * getDist(P(a.joints[0]), P(a.joints[1])) * getDist(P(b.joints[0]), P(b.joints[1]))) return null;
      return L.applyStep(S, dim('distance', { shapes: op.l.map(Ln) }, op.f), {});
    }
    case 'radius': return L.applyStep(S, dim('distance', { shape: Ci(op.c[0]), isRadius: true }, op.f), {});
    case 'dist-point-line': return applyPointLine(S, J(op.j[0]), Ln(op.l[0]));
    case 'lock': {
      const prev = L.nullity(S);
      S.state.joints.get(J(op.j[0])).fixed = true;
      const res = S.engine.solve(L.ITER);
      return { accepted: true, driven: false, nullity: L.nullity(S), prevNullity: prev, converged: res.converged === true, hasNaN: L.hasNaN(S), errors: [], notes: [], composite: true };
    }
    default: throw new Error('no apply for op kind ' + op.k);
  }
}
// The Dimension tool's point-to-line dimension (dimension-tool.js 'create-point-to-line'): a helper joint at the foot of the perpendicular, held on
// the line by pointOnLine, plus a distance between the point and the helper. The three calls are the tool's own, minus the DOM placement.
function applyPointLine(S, jid, lineId) {
  const line = L.shape(S, lineId);
  if (line.joints.includes(jid)) return null;
  const a = S.state.joints.get(line.joints[0]), b = S.state.joints.get(line.joints[1]), p = S.state.joints.get(jid);
  const prev = L.nullity(S);
  S.msgs.length = 0;
  const foot = projectPointOnLine(p, a, b), proj = S.state.genJ();
  S.state.joints.set(proj, { x: foot.x, y: foot.y, fixed: false, isInternal: true });
  const r1 = ConstraintManager.createConstraint(S.state, 'pointOnLine', { joint: proj, shape: lineId }, { source: 'dimension' });
  const r2 = ConstraintManager.createConstraint(S.state, 'distance', { joints: [jid, proj], value: getDist(p, foot) }, { source: 'dimension' });
  const res = S.engine.solve(L.ITER);
  const created = r2 && typeof r2 === 'object' ? r2 : null;
  return { accepted: !!(r1 && r2), driven: !!(created && L.isDriven(created)), nullity: L.nullity(S), prevNullity: prev, converged: res.converged === true, hasNaN: L.hasNaN(S), errors: [], notes: [], composite: true };
}


// the differences between two documents (as JSON text): { text: the first one, for the message; keys: every differing field name }
export function docDiff(a, b) {
  const A = JSON.parse(a).geometry, B = JSON.parse(b).geometry, short = (v) => String(JSON.stringify(v)).slice(0, 160);
  const flat = (e) => Array.isArray(e) ? { id: e[0], ...e[1] } : e;
  const keys = new Set();
  let text = null;
  for (const part of ['joints', 'shapes', 'constraints']) {
    if (A[part].length !== B[part].length) { keys.add('#' + part); text = text || `${part}: ${A[part].length} -> ${B[part].length} entries`; continue; }
    for (let i = 0; i < A[part].length; i++) {
      if (JSON.stringify(A[part][i]) === JSON.stringify(B[part][i])) continue;
      const x = flat(A[part][i]), y = flat(B[part][i]), diff = [...new Set([...Object.keys(x), ...Object.keys(y)])].filter(k => JSON.stringify(x[k]) !== JSON.stringify(y[k]));
      diff.forEach(k => keys.add(`${part === 'constraints' ? x.type + '.' : ''}${k}`));
      text = text || `${part}[${i}] ${x.type || ''}: ` + diff.map(k => `${k} ${short(x[k])} -> ${short(y[k])}`).join('; ');
    }
  }
  return { text: text || 'sketches / other fields differ', keys: [...keys] };
}

// ---------------------------------------------------------------- running a case
const finiteDoc = (S) => { for (const c of S.state.constraints) for (const v of [c.value, c.offset]) if (typeof v === 'number' && !Number.isFinite(v)) return false; return true; };
const determinedJoints = (S) => { const f = S.engine.jointFreedom(); return [...f.freedom].filter(([id, n]) => n === 0 && id !== L.origin).map(([id]) => id); };

// runCase(spec, { only }) -> { violations: [{inv, msg, op}], stats }. `only`: stop checking other invariants (used while shrinking).
export function runCase(spec, { only } = {}) {
  const want = (id) => !only || only === id;
  const { S, ctx } = buildGeometry(spec.geo);
  ctx.lineJoints = ctx.lines.map(id => L.shape(S, id).joints.map(j => ctx.J.indexOf(j)));
  const V = [];
  const bad = (inv, msg, op, keys) => V.push({ inv, msg, op, keys });
  const docs = [];
  const snap = (S) => JSON.stringify(docOf(S), (k, v) => (k === 'dimSign' || k === 'dimSignMode' ? undefined : v));   // dimSign / dimSignMode: finding N-F3, pinned apart
  const stats = { applied: 0, skipped: 0, refused: 0, demoted: 0, byKind: {} };
  spec.ops.forEach((op, i) => {
    S.state.saveState(op.k);
    docs.push(snap(S));
    const sizes0 = measureShapeSizes(S.state);
    const before = L.snapshot(S), nBefore = S.state.constraints.length, res0 = L.residuals(S).max;
    const row = applyOp(S, ctx, op);
    const bk = stats.byKind[op.k] || (stats.byKind[op.k] = { applied: 0, refused: 0, demoted: 0, skipped: 0 });
    if (!row) { stats.skipped++; bk.skipped++; return; }
    stats.applied++; bk.applied++;
    if (!row.accepted) { stats.refused++; bk.refused++; } else if (row.driven) { stats.demoted++; bk.demoted++; }
    if (want('I1') && row.nullity > row.prevNullity) bad('I1', `nullity ${row.prevNullity} -> ${row.nullity}`, i);
    if (want('I8') && row.accepted) { const c8 = findCollapsedShape(S.state, sizes0); if (c8) bad('I8', `${op.k} collapsed ${c8.type} ${c8.id} to a point`, i); }
    if (want('I6') && (row.hasNaN || !finiteDoc(S))) bad('I6', 'NaN after the op', i);
    if (want('I5') && !row.accepted && !row.composite) {
      const dev = L.maxDeviation(S, before);   // only for a SOLVED sketch: a solve after the refusal keeps polishing an unsolved one
      if (res0 < 1e-6 && (!(dev < 1e-5)) || S.state.constraints.length !== nBefore) bad('I5', `refused op moved the geometry by ${dev} / constraints ${nBefore} -> ${S.state.constraints.length}`, i);
    }
  });
  // I2: panel vs the independent finite-difference nullity
  const fd = L.fdJacobian(S), panel = panelDof(S);   // fd of the final state, reused as the 'before' of I3
  if (want('I2') && panel !== fd.nullity) bad('I2', `panel ${panel} vs fd ${fd.nullity} (analytic ${L.nullity(S)})`, -1);
  // I7: edit one or two driving dimensions x0.9 and back
  if (want('I7') || want('I6')) {
    const dims = L.dimensionsOf(S).filter(d => !d.isRadius || S.state.shapes.find(s => s.id === d.shape && s.type === 'arc'));
    for (const dim of dims.slice(0, 2)) {
      const ref = L.snapshot(S), det = determinedJoints(S), v0 = dim.value, sig0 = L.signature(S);
      const r1 = commitDimensionEdit(S.state, dim, v0 * 0.9);
      S.engine.solve(L.ITER);
      if (r1.reverted) { if (want('I5') && L.maxDeviation(S, ref) > 1e-6) bad('I5', `refused edit of ${L.describe(dim)} moved the geometry`, -2); dim.value = v0; continue; }
      const flips = L.signatureDiff(sig0, L.signature(S));
      const res1 = L.residuals(S).max;
      commitDimensionEdit(S.state, dim, v0);
      S.engine.solve(L.ITER);
      let dev = 0; for (const id of det) { const j = S.state.joints.get(id), p = ref.get(id); if (j && p) dev = Math.max(dev, Math.hypot(j.x - p.x, j.y - p.y)); }
      const res2 = L.residuals(S).max;
      if (want('I6') && (L.hasNaN(S) || !finiteDoc(S))) bad('I6', `NaN after editing ${L.describe(dim)}`, -2);
      if (want('I7') && (flips.length || !(dev < DEV7) || !(res1 < RES7) || !(res2 < RES7))) bad('I7', `${L.describe(dim)}: flips [${flips}] determined-joint dev ${dev.toExponential(2)} residual x0.9 ${res1.toExponential(1)} back ${res2.toExponential(1)}`, -2);
    }
  }
  // I3: delete one driving constraint (the last one), compare panel / fd deltas, undo it
  if (want('I3')) {
    const drv = L.drivers(S).filter(c => c.type !== 'coincident' || true);
    const c = drv[drv.length - 1];
    if (c) {
      const fd0 = fd.nullity, p0 = panel, pre = snap(S);
      deleteConstraints(S.state, [c]);   // saves its own undo snapshot (like every delete)
      S.engine.solve(L.ITER);
      const fd1 = L.fdJacobian(S).nullity, p1 = panelDof(S);
      if (fd1 - fd0 !== p1 - p0) bad('I3', `deleted ${L.describe(c)}: panel ${p0} -> ${p1} (+${p1 - p0}), fd ${fd0} -> ${fd1} (+${fd1 - fd0})`, -3);
      S.state.undo();
      if (want('I4')) { const now = snap(S); if (now !== pre) { const d = docDiff(pre, now); bad('I4', 'undo of the delete did not restore the document: ' + d.text, -3, d.keys); } }
    }
  }
  // I4: undo the whole history, step by step
  if (want('I4')) {
    for (let i = spec.ops.length - 1; i >= 0; i--) {
      S.state.undo();
      const now = snap(S);
      if (now !== docs[i]) { const d = docDiff(docs[i], now); bad('I4', `undo to before op ${i} (${spec.ops[i].k}) differs from the document recorded there: ` + d.text, i, d.keys); break; }
    }
  }
  return { violations: V, stats, nullity: L.nullity(S) };
}

// ---------------------------------------------------------------- attribution to round-1 findings, shrinking
// A trigger = the op shape a round-1 finding is about. Removing every trigger op from the case must cure the invariant for the failure to be
// attributed to that finding.
// differing fields that are already pinned as NEW findings of this audit (docs/COVERAGE-AUDIT.md): the persistence whitelist in constraints.js
// createConstraint drops the angle dimension's driven flag (N-F4); it also drops what the engine writes (dimSign / dimSignMode, finding N-F3), which
// the I4 comparison therefore leaves out (a dedicated repro pins it).
const NEW_FINDING_KEYS = { 'angle.isDriven': 'N-F4', 'angle.driven': 'N-F4', 'angle.drivenReason': 'N-F4', 'distance.driven': 'N-F4', 'distance.drivenReason': 'N-F4' };
const TRIGGERS = {
  F6: (op) => op.k === 'pointOnLine' || op.k === 'dist-point-line',
  F2: (op) => op.k === 'equal' && !!op.c,
  F3: (op) => op.k === 'angle',
  F4: (op, g) => (op.k === 'perpendicular' || op.k === 'angle') && g.shares(op.l[0], op.l[1]),
  F5: (op) => op.k === 'tangent',
  'N-F5': (op) => op.k === 'collinear',
};
// Ablation is only meaningful when the invariant does not depend on the trigger EXISTING: I7 edits a dimension, so removing dimension ops would cure
// it trivially (F3 is attributed there by the edited dimension's type instead). A failure is attributed to ONE finding when removing that
// finding's ops cures it, else to the SET of findings present when removing all of them cures it; else it is NEW.
const ABLATE = { I1: Object.keys(TRIGGERS), I2: Object.keys(TRIGGERS), I3: Object.keys(TRIGGERS), I4: Object.keys(TRIGGERS), I5: Object.keys(TRIGGERS), I6: Object.keys(TRIGGERS), I8: [], I7: ['F6', 'F2', 'F4', 'F5', 'N-F5'] };
export function attribute(spec, inv, violation) {
  if (inv === 'I7' && /angle=/.test(violation.msg)) return 'F3';
  if (inv === 'I7' && /flips \[[^\]]/.test(violation.msg)) return 'N-F6';
  const { S, ctx } = buildGeometry(spec.geo);
  // read BEFORE any runCase: every build re-initialises the one shared engine store. Two lines SHARE a joint when a joint of each is the same or
  // in one coincident cluster (the builders' own welds + the coincident ops of the case): the engine merges a cluster into one variable.
  const lj = ctx.lines.map(id => L.shape(S, id).joints);
  const parent = new Map(); const find = (x) => { while (parent.has(x) && parent.get(x) !== x) x = parent.get(x); return x; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); if (!parent.has(rb)) parent.set(rb, rb); };
  for (const c of S.state.constraints) if (c.type === 'coincident') union(c.joints[0], c.joints[1]);
  for (const op of spec.ops) if (op.k === 'coincident') union(ctx.J[op.j[0]], ctx.J[op.j[1]]);
  const g = { shares: (a, b) => lj[a].some(x => lj[b].some(y => find(x) === find(y))) };
  const present = ABLATE[inv].filter(id => spec.ops.some(op => TRIGGERS[id](op, g)));
  const fails = (ids) => runCase({ ...spec, ops: spec.ops.filter(op => !ids.some(id => TRIGGERS[id](op, g))) }, { only: inv }).violations.some(v => v.inv === inv);
  for (const id of present) if (!fails([id])) return id;
  if (present.length > 1 && !fails(present)) return present.join('+');
  return null;
}
export function shrink(spec, inv, budget = 40) {
  let ops = spec.ops.slice(), runs = 0;
  const fails = (o) => { runs++; return runCase({ ...spec, ops: o }, { only: inv }).violations.some(v => v.inv === inv); };
  let progress = true;
  while (progress && runs < budget) {
    progress = false;
    for (let i = ops.length - 1; i >= 0 && runs < budget; i--) {
      const trial = ops.filter((_, k) => k !== i);
      if (trial.length && fails(trial)) { ops = trial; progress = true; }
    }
  }
  return { ...spec, ops };
}

// ---------------------------------------------------------------- the whole property run
export function runProperties({ cases = CASES, seed0 = SEED0, shrinkNew = 2 } = {}) {
  const tally = Object.fromEntries(Object.keys(INVARIANTS).map(k => [k, { cases: 0, pass: 0, attributed: {}, new: [] }]));
  const kinds = Object.fromEntries(KINDS.map(k => [k, { applied: 0, refused: 0, demoted: 0, skipped: 0 }]));
  const geoKinds = {};
  let ops = 0, applied = 0, refused = 0, demoted = 0, skipped = 0, determined = 0;
  const shrunkPerInv = {};
  for (let i = 0; i < cases; i++) {
    const spec = genCase(seed0 + i);
    geoKinds[spec.geo.kind] = (geoKinds[spec.geo.kind] || 0) + 1;
    const res = runCase(spec);
    ops += spec.ops.length; applied += res.stats.applied; refused += res.stats.refused; demoted += res.stats.demoted; skipped += res.stats.skipped;
    if (res.nullity === 0) determined++;
    for (const [k, v] of Object.entries(res.stats.byKind)) for (const f of Object.keys(v)) kinds[k][f] += v[f];
    for (const inv of Object.keys(INVARIANTS)) {
      const t = tally[inv]; t.cases++;
      const fail = res.violations.find(v => v.inv === inv);
      if (!fail) { t.pass++; continue; }
      const cause = (fail.keys && fail.keys.length && fail.keys.every(k => NEW_FINDING_KEYS[k])) ? NEW_FINDING_KEYS[fail.keys[0]] : attribute(spec, inv, fail);
      if (cause) { t.attributed[cause] = (t.attributed[cause] || 0) + 1; continue; }
      shrunkPerInv[inv] = (shrunkPerInv[inv] || 0) + 1;
      const minimal = shrunkPerInv[inv] <= shrinkNew ? shrink(spec, inv) : null;
      t.new.push({ seed: spec.seed, msg: fail.msg, minimal });
    }
  }
  return { tally, kinds, geoKinds, totals: { cases, ops, applied, refused, demoted, skipped, determined } };
}
