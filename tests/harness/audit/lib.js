// TASK 508 -- constraint audit harness (library). NOT a test: tests/constraint-audit.test.js and scripts/constraint-audit.cjs
// both run the pipeline defined here. It builds drawings through the SAME core APIs the tools use (makeRectFromTwoJoints,
// makeArc, applyFillet, makePolygon, ConstraintManager.createConstraint, commitDimensionEdit, deleteConstraints,
// state.saveState/undo) and OBSERVES: it never fixes anything and never hand-writes solver rows.
//
// Pipeline per drawing (letters follow the task):
//   A geometry only -> B apply the recipe step by step -> C final state -> D verify + perturbed re-solves ->
//   E edit every dimension (0.8x / 1.25x / restore) -> F abuse (redundant, conflicting, delete, undo) -> G planegcs oracle.
import { createEngine } from '#core/constraint-solver.js';
import { createSketchState } from '#ui/sketch-state.js';
import { ConstraintManager, setConstraintNotifier } from '#core/constraint-manager.js';
import { measureResidual } from '#core/constraint-verifier.js';
import { deleteConstraints } from '#core/delete-manager.js';
import { commitDimensionEdit } from '#ui/dimension-seams.js';
import { analyzeConstraintStatus } from '#core/constraint-status.js';
import { makeRectFromTwoJoints, makeArc, makePolygon } from '#core/shapes.js';
import { addConstraint } from '#core/constraints.js';
import { perpendicularDistance } from '#core/geometry.js';
import { createNewtonSolver } from '#core/solver/engine.js';
import { findCornerBetweenLines, applyFillet } from '#core/fillet.js';
import { init_planegcs_module, GcsWrapper } from '@salusoft89/planegcs';

export const ITER = 500;
export const RES_TOL = 1e-6;       // per-constraint residual after a solve
export const GEOM_TOL = 1e-4;      // "same geometry"
export const SEEDS = [11, 23, 37, 51, 73];   // fixed jitter seeds
const NONE = () => {};

// ---------------------------------------------------------------- sketch
// NOTE: createEngine() shares one module-level store, so only ONE sketch lives at a time; drawings run one after another.
export function newSketch() {
  const engine = createEngine(null);
  engine.init();
  const state = createSketchState(engine, { x: 0, y: 0, w: 800, h: 800 });
  const S = { engine, state, msgs: [], names: {} };
  setConstraintNotifier((msg) => { S.msgs.push(String(msg)); });
  return S;
}
export const origin = 'j_origin';

export function point(S, x, y) { const id = S.state.genJ(); S.state.joints.set(id, { x, y, fixed: false }); return id; }
export function line(S, a, b, construction = false) {
  const id = 's_line_' + a + '_' + b;
  S.state.shapes.push({ id, type: 'line', joints: [a, b], isConstruction: construction });
  return id;
}
// line-tool polyline: every segment owns its two joints; the corners are joined by an auto 'coincident' constraint (what line-tool.js adds),
// NOT by a shared joint. Returns the segment shape ids and their [start,end] joint pairs.
export function polyline(S, pts, closed = true) {
  const segs = [];
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) {
    const a = point(S, pts[i][0], pts[i][1]), b = point(S, pts[(i + 1) % pts.length][0], pts[(i + 1) % pts.length][1]);
    segs.push({ id: line(S, a, b), a, b });
  }
  for (let i = 0; i + 1 < segs.length || (closed && i < segs.length); i++) {
    const nx = segs[(i + 1) % segs.length];
    ConstraintManager.createConstraint(S.state, 'coincident', { joints: [segs[i].b, nx.a] }, { source: 'line' });
  }
  return segs;
}
export function circle(S, cx, cy, r) {
  const c = point(S, cx, cy);
  const id = 's_circle_' + c;
  S.state.shapes.push({ id, type: 'circle', joints: [c], radius: r, isConstruction: false });   // exactly what circle-tool.js stores
  return { id, c };
}
// rect-tool: shapes pushed, then every structural constraint through ConstraintManager.createConstraint(source 'rect').
export function rect(S, x1, y1, x2, y2) {
  const c1 = point(S, x1, y1), c3 = point(S, x2, y2);
  const built = makeRectFromTwoJoints(S.state.joints, c1, c3, S.state.genJ);
  built.shapes.forEach(s => S.state.shapes.push(s));
  built.constraints.forEach(c => ConstraintManager.createConstraint(S.state, c.type, c, { source: 'rect' }));
  const [top, right, bottom, left] = built.shapes.map(s => s.id);
  return { top, right, bottom, left, lines: [top, right, bottom, left], c1, c3 };
}
// fillet-tool: the two-line pick -> findCornerBetweenLines -> applyFillet (it adds the arc, the virtual sharp V, the tangents and the radius dimension)
// FINDING (docs/CONSTRAINT-AUDIT.md): makeArc names a shape `s_arc_${Date.now()}`, so two arcs made in one millisecond share an id. A person never fillets twice
// in a millisecond, so the helper waits for the clock to tick (like the human gap between two clicks) instead of changing app code.
function tick() { const t = Date.now(); while (Date.now() === t) { /* spin one ms */ } }
export function fillet(S, lineA, lineB, r) {
  tick();
  const corner = findCornerBetweenLines(S.state, shape(S, lineA), shape(S, lineB));
  if (!corner) throw new Error('no fillet corner between ' + lineA + ' and ' + lineB);
  const res = applyFillet(S.state, corner, r);
  if (!res || !res.success) throw new Error('fillet failed: ' + (res && res.reason));
  return { arc: res.arc.id, V: res.virtualSharp, center: res.joints[0], tA: res.joints[1], tB: res.joints[2] };
}
// arc-tool: makeArc(centre, start, end), shape pushed, its structural constraint through ConstraintManager.createConstraint(source 'arc')
export function arc(S, c, a, b) {
  tick();   // see the makeArc same-millisecond id collision note on fillet()
  const built = makeArc(S.state.joints, c, a, b, 'CENTER');
  built.shapes.forEach(s => S.state.shapes.push(s));
  built.constraints.forEach(k => ConstraintManager.createConstraint(S.state, k.type, k, { source: 'arc' }));
  return built.shapes[0].id;
}
// polygon-tool: centre joint + first-corner joint, makePolygon, shapes pushed, constraints through the raw addConstraint (as polygon-tool.js does)
export function polygon(S, c, v, n) {
  const built = makePolygon(S.state.joints, c, v, n, S.state.genJ);
  built.shapes.forEach(s => S.state.shapes.push(s));
  built.constraints.forEach(k => addConstraint(S.state, k.type, k));
  return built;
}
export const shape = (S, id) => S.state.shapes.find(s => s.id === id);

// ---------------------------------------------------------------- measuring
export function snapshot(S) { const m = new Map(); for (const [id, j] of S.state.joints) m.set(id, { x: j.x, y: j.y }); return m; }
export function restore(S, snap) { for (const [id, p] of snap) { const j = S.state.joints.get(id); if (j) { j.x = p.x; j.y = p.y; } } }
export function maxDeviation(S, snap) {
  let d = 0;
  for (const [id, p] of snap) { const j = S.state.joints.get(id); if (!j) return Infinity; d = Math.max(d, Math.hypot(j.x - p.x, j.y - p.y)); if (!Number.isFinite(j.x + j.y)) return NaN; }
  return d;
}
export const hasNaN = (S) => [...S.state.joints.values()].some(j => !Number.isFinite(j.x) || !Number.isFinite(j.y));
export const isDriven = (c) => !!(c && (c.isDriven || c.driven));
export const drivers = (S) => S.state.constraints.filter(c => c && !isDriven(c) && c.type !== 'mouse_spring');

export function residuals(S) {
  let max = 0, worst = null;
  for (const c of drivers(S)) {
    const r = measureResidual(c, S.state.joints, S.state.shapes);
    if (!(r <= max)) { max = r; worst = c; }
  }
  return { max, worst };
}
export const describe = (c) => c ? `${c.type}${c.isRadius ? '(R)' : ''}${c.dimMode && c.type === 'distance' ? '/' + c.dimMode : ''}${c.value != null ? '=' + (+c.value).toFixed(3) : ''}` : '-';

// The ground truth (task 496): nullity of the Jacobian nullspace of the non-driven rows.
export function freedom(S) {
  const f = S.engine.jointFreedom();
  const free = [];
  for (const [id, n] of f.freedom) {
    if (n > 0 && id !== origin) free.push({ id, freedom: n, dirs: (f.freeX.has(id) ? 'x' : '') + (f.freeY.has(id) ? 'y' : '') });
  }
  return { nullity: f.nullity, free };
}
export const nullity = (S) => S.engine.jointFreedom().nullity;
export function movableJoints(S) { let n = 0; for (const [id, j] of S.state.joints) if (!j.fixed && id !== origin) n++; return n; }

// Sketch-wide size (max bbox side of the non-origin joints), for the 5% jitter.
export function drawingSize(S) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [id, j] of S.state.joints) { x0 = Math.min(x0, j.x); x1 = Math.max(x1, j.x); y0 = Math.min(y0, j.y); y1 = Math.max(y1, j.y); }
  return Math.max(x1 - x0, y1 - y0);
}

// Orientation signature: signs that must not change under a valid edit.
//  L: cross of two line shapes sharing a joint (consecutive edges)   A: arc sweep sign   T: side of a tangent line the circle centre is on
export function signature(S) {
  const P = (id) => S.state.joints.get(id);
  const sgn = (v) => (Math.abs(v) < 1e-9 ? 0 : Math.sign(v));
  const out = new Map();
  const lines = S.state.shapes.filter(s => s.type === 'line' && !s.isConstruction);
  for (let i = 0; i < lines.length; i++) for (let k = i + 1; k < lines.length; k++) {
    const a = lines[i], b = lines[k];
    const sh = a.joints.find(j => b.joints.includes(j));
    if (!sh) continue;
    const ao = a.joints.find(j => j !== sh), bo = b.joints.find(j => j !== sh);
    const A = P(ao), B = P(bo), C = P(sh);
    out.set(`L:${a.id}x${b.id}`, sgn((A.x - C.x) * (B.y - C.y) - (A.y - C.y) * (B.x - C.x)));
  }
  for (const s of S.state.shapes) {
    if (s.type !== 'arc') continue;
    const [c, a, b] = s.joints.map(P);
    out.set(`A:${s.id}`, sgn((a.x - c.x) * (b.y - c.y) - (a.y - c.y) * (b.x - c.x)));
  }
  for (const c of S.state.constraints) {
    if (c.type !== 'tangent' || !c.line || !c.circle) continue;
    const l = shape(S, c.line), k = shape(S, c.circle);
    if (!l || !k) continue;
    const a = P(l.joints[0]), b = P(l.joints[1]), m = P(k.joints[0]);
    out.set(`T:${c.line}:${c.circle}`, sgn((b.x - a.x) * (m.y - a.y) - (b.y - a.y) * (m.x - a.x)));
  }
  return out;
}
export function signatureDiff(before, after) {
  const bad = [];
  for (const [k, v] of before) if (after.get(k) !== v) bad.push(`${k}: ${v} -> ${after.get(k)}`);
  return bad;
}

// ---------------------------------------------------------------- recipe application (B)
// A recipe step is DATA: { label, type, <targets by NAME>, value?, dimMode?, isRadius? }. Targets are names from the drawing's `names`
// map (joint ids / shape ids); strings that are not names pass through. Step kinds: type = a CONSTRAINT_TYPES value, or op:'delete'.
const REF_KEYS = ['joint', 'shape', 'line', 'circle'];
export function resolve(step, names) {
  const R = (v) => (typeof v === 'string' && names[v] != null ? names[v] : v);
  const out = { ...step };
  delete out.label; delete out.why;
  for (const k of REF_KEYS) if (out[k] != null) out[k] = R(out[k]);
  for (const k of ['joints', 'shapes']) if (out[k]) out[k] = out[k].map(R);
  return out;
}
// What the Dimension tool measures when a dimension is PLACED (it then opens the value box and the typed number goes through commitDimensionEdit).
export function measure(S, p) {
  const J = (id) => S.state.joints.get(id);
  if (p.type === 'angle') {
    const [s1, s2] = p.shapes.map(id => shape(S, id));
    const a1 = Math.atan2(J(s1.joints[1]).y - J(s1.joints[0]).y, J(s1.joints[1]).x - J(s1.joints[0]).x);
    const a2 = Math.atan2(J(s2.joints[1]).y - J(s2.joints[0]).y, J(s2.joints[1]).x - J(s2.joints[0]).x);
    let v = Math.abs((a1 - a2) * 180 / Math.PI); if (v > 180) v = 360 - v; return v;
  }
  if (p.isRadius) { const s = shape(S, p.shape); return typeof s.radius === 'number' ? s.radius : Math.hypot(J(s.joints[1]).x - J(s.joints[0]).x, J(s.joints[1]).y - J(s.joints[0]).y); }
  if (p.shapes) { const [s1, s2] = p.shapes.map(id => shape(S, id)); return Math.abs(perpendicularDistance(J(s2.joints[0]), J(s1.joints[0]), J(s1.joints[1]))); }
  const [a, b] = p.joints.map(J);
  if (p.dimMode === 'horizontal') return Math.abs(b.x - a.x);
  if (p.dimMode === 'vertical') return Math.abs(b.y - a.y);
  return Math.hypot(b.x - a.x, b.y - a.y);
}
export const ERR_RE = /\[?(ERR-[A-Z]+-\d+)\]?/g;

export function applyStep(S, step, names) {
  const row = { label: step.label, type: step.type || step.op, accepted: null, errors: [], notes: [], converged: null, residual: null, nullity: null, driven: false };
  const before = S.state.constraints.length;
  const prevNullity = nullity(S);
  S.msgs.length = 0;
  if (step.op === 'delete') {
    const hit = S.state.constraints.find(c => Object.entries(step.match).every(([k, v]) => (k === 'shape' || k === 'line' || k === 'circle' ? names[v] || v : v) === c[k]));
    row.accepted = !!hit;
    if (hit) deleteConstraints(S.state, [hit]);
  } else {
    const params = resolve(step, names);
    // UI flow for a dimension: placed at the MEASURED value, then the typed number is committed through commitDimensionEdit.
    // `direct: true` creates it straight at the target value (rect-tool / live-input path) -- used by the findings repros.
    const isDim = (step.type === 'distance' || step.type === 'angle') && step.value != null;
    const target = params.value;
    if (isDim && !step.direct) params.value = measure(S, params);
    const res = ConstraintManager.createConstraint(S.state, step.type, params, { source: 'audit' });
    row.accepted = !!res;
    const created = res && typeof res === 'object' ? res : null;
    if (created) { row.driven = isDriven(created); if (created.drivenReason) row.notes.push(created.drivenReason); }
    if (created && isDim && !step.direct && !row.driven && Math.abs(target - params.value) > 1e-12) {
      const er = commitDimensionEdit(S.state, created, target);
      row.edit = er;
      if (er.reverted) row.notes.push('typed value ' + target + ' REFUSED: ' + (er.clash || er.reason || 'reverted'));
    }
    row.constraint = created;
    if (!res && S.state.constraints.length > before) row.notes.push('refused but a constraint was added');
  }
  for (const m of S.msgs) { for (const e of m.matchAll(ERR_RE)) row.errors.push(e[1]); }
  row.messages = [...S.msgs];
  const r = S.engine.solve(ITER);
  row.converged = r.converged === true;
  row.residual = residuals(S).max;
  row.nullity = nullity(S);
  row.prevNullity = prevNullity;
  // accepted, DRIVING, and the DOF count did not move: redundant with what is there (or inert, e.g. a circle's radius dimension)
  row.noEffect = row.accepted === true && !row.driven && row.nullity === prevNullity && step.op !== 'delete';
  row.hasNaN = hasNaN(S);
  return row;
}

// ---------------------------------------------------------------- D: perturbed re-solves
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
export function jitter(S, seed, frac, size) {
  const rnd = mulberry32(seed), amp = size * frac;
  for (const [id, j] of S.state.joints) {
    if (j.fixed || id === origin) continue;
    j.x += (rnd() * 2 - 1) * amp; j.y += (rnd() * 2 - 1) * amp;
  }
}
export function perturbedSolves(S, ref, size) {
  const out = [];
  for (const seed of SEEDS) {
    restore(S, ref);
    jitter(S, seed, 0.05, size);
    const r = S.engine.solve(ITER);
    out.push({ seed, converged: r.converged === true, residual: residuals(S).max, dev: maxDeviation(S, ref) });
  }
  restore(S, ref); S.engine.solve(ITER);
  return out;
}

// ---------------------------------------------------------------- E: edit every dimension through the UI seam
export function dimensionsOf(S) {
  return S.state.constraints.filter(c => c && c.type === 'distance' && !isDriven(c) || c && c.type === 'angle' && !isDriven(c));
}
export function editAll(S, ref) {
  const rows = [];
  for (const dim of dimensionsOf(S)) {
    const v0 = dim.value;
    for (const f of [0.8, 1.25]) {
      restore(S, ref); S.engine.solve(ITER);
      const sig0 = signature(S);
      const r = commitDimensionEdit(S.state, dim, v0 * f);
      const res = S.engine.solve(ITER);
      const rr = residuals(S);
      const row = { dim: describe(dim), factor: f, target: v0 * f, reverted: !!r.reverted, reason: r.reason || r.clash || '', converged: res.converged === true,
        residual: rr.max, worst: describe(rr.worst), nan: hasNaN(S), nullity: nullity(S), flips: signatureDiff(sig0, signature(S)) };
      // back to the original value: reversibility
      commitDimensionEdit(S.state, dim, v0);
      S.engine.solve(ITER);
      row.backDev = maxDeviation(S, ref);
      row.backValue = dim.value;
      rows.push(row);
      dim.value = v0;
    }
  }
  restore(S, ref); S.engine.solve(ITER);
  return rows;
}

// ---------------------------------------------------------------- F: abuse
export function abuse(S, probes, ref) {
  const out = {};
  const base = nullity(S);
  const pos0 = snapshot(S);
  // (1) redundant: a dimension equal to what the geometry already implies
  if (probes.redundant) {
    const [a, b] = probes.redundant.joints.map(n => S.names[n] || n);
    const A = S.state.joints.get(a), B = S.state.joints.get(b);
    const value = Math.hypot(A.x - B.x, A.y - B.y);
    const nC = S.state.constraints.length;
    const row = applyStep(S, { label: 'redundant ' + probes.redundant.joints.join('-'), type: 'distance', joints: [a, b], value, dimMode: 'aligned' }, {});
    out.redundant = { value, accepted: row.accepted, driven: row.driven, converged: row.converged, residual: row.residual, nullity: row.nullity, errors: row.errors, notes: row.notes, added: S.state.constraints.length - nC, dev: maxDeviation(S, pos0) };
    if (row.constraint) S.state.constraints.splice(S.state.constraints.indexOf(row.constraint), 1);
    restore(S, pos0); S.engine.solve(ITER);
  }
  // (2) conflicting: an impossible value on an already-determined pair
  if (probes.conflict) {
    const [a, b] = probes.conflict.joints.map(n => S.names[n] || n);
    const A = S.state.joints.get(a), B = S.state.joints.get(b);
    const value = Math.hypot(A.x - B.x, A.y - B.y) * 1.5;
    const nC = S.state.constraints.length;
    const row = applyStep(S, { label: 'conflict ' + probes.conflict.joints.join('-'), type: 'distance', joints: [a, b], value, dimMode: 'aligned' }, {});
    out.conflict = { value, accepted: row.accepted, driven: row.driven, converged: row.converged, residual: row.residual, nullity: row.nullity, errors: row.errors, notes: row.notes, added: S.state.constraints.length - nC, dev: maxDeviation(S, pos0), storedValue: row.constraint ? row.constraint.value : null };
    if (row.constraint) S.state.constraints.splice(S.state.constraints.indexOf(row.constraint), 1);
    restore(S, pos0); S.engine.solve(ITER);
  }
  // (3) delete one dimension: nullity must rise by exactly one; (4) undo it: back to the base nullity and the same geometry
  if (probes.delete) {
    const dim = S.state.constraints.find(c => Object.entries(probes.delete).every(([k, v]) => (S.names[v] || v) === c[k] || (Array.isArray(c[k]) && c[k].join() === v.map(n => S.names[n] || n).join())));
    if (dim) {
      S.state.saveState();   // what the UI does before a delete (deleteConstraints also saves; one more is harmless)
      const n0 = S.state.constraints.length;
      deleteConstraints(S.state, [dim]);
      S.engine.solve(ITER);
      const after = nullity(S);
      out.delete = { dim: describe(dim), nullityBefore: base, nullityAfter: after, removed: n0 - S.state.constraints.length };
      S.state.undo();   // deleteConstraints saved its own snapshot, so one undo reverts the delete (a second would revert my extra save)
      const solved = S.engine.solve(ITER);
      out.undo = { nullity: nullity(S), constraints: S.state.constraints.length, converged: solved.converged === true, residual: residuals(S).max, dev: maxDeviation(S, pos0), constraintsBefore: n0 };
      S.state.undo(); S.state.history.length = 0;
    } else out.delete = { error: 'no such dimension' };
  }
  return out;
}

// ---------------------------------------------------------------- G: independent oracle (FreeCAD's PlaneGCS)
let planegcsMod = null;
export async function planegcs() { if (!planegcsMod) planegcsMod = await init_planegcs_module(); return planegcsMod; }
const radiansOf = (deg) => deg * Math.PI / 180;

// Translate the CURRENT sketch (joints, shapes, constraints) into PlaneGCS primitives. Joints become points, lines lines, an arc a circle with
// both rim joints on it, a circle shape a circle with its stored (constant) radius. Each of our constraints becomes its natural PlaneGCS one.
export function toPlanegcs(S) {
  const prims = [];
  const P = (id) => S.state.joints.get(id);
  for (const [id, j] of S.state.joints) prims.push({ id, type: 'point', x: j.x, y: j.y, fixed: !!j.fixed || id === origin });
  const lineIds = new Set();
  let n = 0;
  const nid = (p) => `${p}${++n}`;
  const helperLine = (a, b) => { const id = nid('h_line_'); prims.push({ id, type: 'line', p1_id: a, p2_id: b }); return id; };
  const circles = new Map();
  for (const s of S.state.shapes) {
    if (s.type === 'line') { prims.push({ id: s.id, type: 'line', p1_id: s.joints[0], p2_id: s.joints[1] }); lineIds.add(s.id); }
    else if (s.type === 'circle') {
      prims.push({ id: s.id, type: 'circle', c_id: s.joints[0], radius: s.radius }); circles.set(s.id, s);
      if (!S.state.constraints.some(c => c && c.type === 'distance' && c.isRadius && c.shape === s.id && !isDriven(c))) prims.push({ id: nid('k_'), type: 'circle_radius', c_id: s.id, radius: s.radius });   // the app treats shape.radius as a constant (a radius dim, when present, says it)
    } else if (s.type === 'arc') {
      const [c, a] = s.joints;
      prims.push({ id: s.id, type: 'circle', c_id: c, radius: Math.hypot(P(a).x - P(c).x, P(a).y - P(c).y) }); circles.set(s.id, s);
      prims.push({ id: nid('k_'), type: 'point_on_circle', p_id: s.joints[1], c_id: s.id });
      prims.push({ id: nid('k_'), type: 'point_on_circle', p_id: s.joints[2], c_id: s.id });
    }
  }
  const unmapped = [];
  for (const c of S.state.constraints) {
    if (!c || isDriven(c) || c.type === 'mouse_spring') continue;
    const add = (o) => prims.push({ id: nid('k_'), ...o });
    switch (c.type) {
      case 'coincident': add({ type: 'p2p_coincident', p1_id: c.joints[0], p2_id: c.joints[1] }); break;
      case 'horizontal': add({ type: 'horizontal_pp', p1_id: c.joints[0], p2_id: c.joints[1] }); break;
      case 'vertical': add({ type: 'vertical_pp', p1_id: c.joints[0], p2_id: c.joints[1] }); break;
      case 'distance': {
        if (c.isRadius) {
          const s = shape(S, c.shape);
          if (s) add({ type: 'circle_radius', c_id: s.id, radius: c.value });
        } else if (c.shapes && c.shapes.length === 2 && !(c.joints && c.joints.length >= 2)) {
          const l1 = shape(S, c.shapes[0]), l2 = shape(S, c.shapes[1]);
          add({ type: 'p2l_distance', p_id: l2.joints[0], l_id: l1.id, distance: c.value });
        } else if (c.dimMode === 'horizontal' || c.dimMode === 'vertical') {
          const k = c.dimMode === 'horizontal' ? 'x' : 'y';
          add({ type: 'difference', param1: { o_id: c.joints[0], prop: k }, param2: { o_id: c.joints[1], prop: k }, difference: (c.dimSign === -1 ? -1 : 1) * c.value });
        } else add({ type: 'p2p_distance', p1_id: c.joints[0], p2_id: c.joints[1], distance: c.value });
        break;
      }
      case 'pointOnLine': {
        const s = shape(S, c.shape);
        if (s && s.type === 'line') add({ type: 'point_on_line_ppp', p_id: c.joint, lp1_id: s.joints[0], lp2_id: s.joints[1] });
        else if (s) add({ type: 'point_on_circle', p_id: c.joint, c_id: s.id });
        break;
      }
      case 'midpoint': {
        const [a, b, m] = c.joints;
        add({ type: 'point_on_line_ppp', p_id: m, lp1_id: a, lp2_id: b });
        add({ type: 'equal_length', l1_id: helperLine(a, m), l2_id: helperLine(m, b) });
        break;
      }
      case 'equal': {
        if (c.joints && c.joints.length >= 4) {
          const [a, b, cc, d] = c.joints;
          const isArcRim = S.state.shapes.some(s => s.type === 'arc' && s.joints[0] === a && s.joints[0] === cc && ((s.joints[1] === b && s.joints[2] === d) || (s.joints[1] === d && s.joints[2] === b)));
          if (!isArcRim) add({ type: 'equal_length', l1_id: helperLine(a, b), l2_id: helperLine(cc, d) });   // an arc's structural |CA|=|CB| is the circle itself
        } else {
          const [s1, s2] = c.shapes.map(id => shape(S, id));
          if (s1.type === 'line' && s2.type === 'line') add({ type: 'equal_length', l1_id: s1.id, l2_id: s2.id });
          else add({ type: 'equal_radius_cc', c1_id: s1.id, c2_id: s2.id });
        }
        break;
      }
      case 'tangent': {
        if (c.line && c.circle) {
          // A line that ENDS on the arc's rim (a fillet) is tangent AT that point: the radius to it is perpendicular to the line (FreeCAD's
          // endpoint tangency). A plain tangent_lc plus rim-on-circle would be a double root there (reported redundant, DOF wrong).
          const l = shape(S, c.line), k = shape(S, c.circle);
          const rim = k.joints.slice(1).find(j => l.joints.includes(j));
          if (rim) add({ type: 'perpendicular_pppp', l1p1_id: k.joints[0], l1p2_id: rim, l2p1_id: l.joints[0], l2p2_id: l.joints[1] });
          else add({ type: 'tangent_lc', l_id: c.line, c_id: c.circle });
        }
        else unmapped.push(c);
        break;
      }
      case 'parallel': add({ type: 'parallel', l1_id: c.shapes[0], l2_id: c.shapes[1] }); break;
      case 'perpendicular': add({ type: 'perpendicular_ll', l1_id: c.shapes[0], l2_id: c.shapes[1] }); break;
      case 'angle': {
        const [l1, l2] = c.shapes.map(id => shape(S, id));
        const ang = (l) => Math.atan2(P(l.joints[1]).y - P(l.joints[0]).y, P(l.joints[1]).x - P(l.joints[0]).x);
        let d = ang(l2) - ang(l1); while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
        add({ type: 'l2l_angle_ll', l1_id: l1.id, l2_id: l2.id, angle: (d < 0 ? -1 : 1) * radiansOf(c.value) });
        break;
      }
      default: unmapped.push(c);
    }
  }
  return { prims, unmapped };
}

// Solve the translated sketch from the CURRENT positions. Returns dof / conflicting / redundant / positions.
export async function oracleSolve(S) {
  const mod = await planegcs();
  const { prims, unmapped } = toPlanegcs(S);
  const w = new GcsWrapper(new mod.GcsSystem());
  try {
    w.push_primitives_and_params(prims);
    const status = w.solve();
    w.apply_solution();
    const pos = new Map();
    for (const p of w.sketch_index.get_primitives()) if (p.type === 'point') pos.set(p.id, { x: p.x, y: p.y });
    return { status, dof: w.gcs.dof(), conflicting: w.get_gcs_conflicting_constraints().length, redundant: w.get_gcs_redundant_constraints().length,
      partial: w.get_gcs_partially_redundant_constraints().length, pos, unmapped: unmapped.length };
  } finally { w.destroy_gcs_module(); }
}

export async function oracle(S, ref, size) {
  const base = await oracleSolve(S);
  const seeds = [];
  for (const seed of SEEDS.slice(0, 3)) {
    restore(S, ref); jitter(S, seed, 0.05, size);
    const o = await oracleSolve(S);
    const r = S.engine.solve(ITER);
    let dev = 0;
    for (const [id, p] of o.pos) { const j = S.state.joints.get(id); if (j) dev = Math.max(dev, Math.hypot(p.x - j.x, p.y - j.y)); }
    seeds.push({ seed, ours: r.converged === true, oursResidual: residuals(S).max, planegcsStatus: o.status, planegcsConflicting: o.conflicting, dev });
  }
  restore(S, ref); S.engine.solve(ITER);
  let selfDev = 0;
  for (const [id, p] of base.pos) { const j = S.state.joints.get(id); if (j) selfDev = Math.max(selfDev, Math.hypot(p.x - j.x, p.y - j.y)); }
  return { dof: base.dof, status: base.status, conflicting: base.conflicting, redundant: base.redundant, partial: base.partial, unmapped: base.unmapped, selfDev, seeds };
}

// ---------------------------------------------------------------- the whole pipeline
export async function runDrawing(drawing, { oracleOn = true, buildOpts = {} } = {}) {
  const S = newSketch();
  const R = { name: drawing.NAME, title: drawing.TITLE, recipe: drawing.RECIPE };
  const built = drawing.build(S, buildOpts);
  S.names = built.names;
  // A. geometry only: the builders' own structural constraints (rect welds, arc equal radius, polygon equals, fillet tangents) are
  //    part of "the geometry"; strip them for the bare count, which must be exactly 2 x movable joints.
  {
    const keep = S.state.constraints.splice(0, S.state.constraints.length);
    R.A = { joints: S.state.joints.size, movable: movableJoints(S), bareNullity: nullity(S) };
    S.state.constraints.push(...keep);
    S.engine.solve(ITER);
    R.A.builderNullity = nullity(S); R.A.builderConstraints = S.state.constraints.length;
  }
  // B. recipe
  R.B = [];
  for (const step of drawing.RECIPE) R.B.push(applyStep(S, step, built.names));
  // C. final state
  S.engine.solve(ITER);
  const f = freedom(S);
  const status = analyzeConstraintStatus({ joints: S.state.joints, shapes: S.state.shapes, constraints: S.state.constraints });
  const fd = fdJacobian(S);
  R.C = { fdNullity: fd.nullity, jacobianErrors: fd.worst, nullity: f.nullity, free: f.free, panelDof: status.dof, converged: S.engine.solve(ITER).converged === true, constraints: S.state.constraints.length, joints: S.state.joints.size };
  const ref = snapshot(S);
  const size = drawingSize(S);
  R.size = size;
  // D. verify
  {
    const rr = residuals(S);
    R.D = { verifierMax: rr.max, worst: describe(rr.worst), nan: hasNaN(S), perturbed: perturbedSolves(S, ref, size) };
  }
  // E. edit every dimension
  R.E = editAll(S, ref);
  // F. abuse
  R.F = abuse(S, built.probes || {}, ref);
  S.engine.solve(ITER);
  restore(S, ref);
  // X. drawing-specific semantic checks (does a declared constraint really bite?)
  R.X = [];
  for (const chk of (built.checks || [])) { const pos = snapshot(S); const res = chk.run(S); R.X.push({ name: chk.name, ...res }); restore(S, pos); S.engine.solve(ITER); }
  // G. oracle
  R.G = oracleOn ? await oracle(S, ref, size) : null;
  R.S = S;
  return R;
}

// ---------------------------------------------------------------- independent Jacobian cross-check (finite differences)
// engine.jointFreedom() reads the nullspace of the ANALYTIC Jacobian. This rebuilds the same residual rows into a second solver object and
// differentiates them numerically, so a row whose analytic derivative is incomplete (one-sided pointOnLine, ...) shows up as an error here and as a
// different nullity. Rows are attributed to constraints in order (coincident/midpoint 2 rows, every other type 1).
export function fdJacobian(S) {
  const nonDriven = S.state.constraints.filter(c => c && !isDriven(c) && c.type !== 'mouse_spring');
  const solver = createNewtonSolver(S.state.joints, S.state.constraints, S.state.shapes, { maxIter: ITER, tol: 1e-6, lambdaInit: 1e-3, lambdaUp: 10, lambdaDown: 0.1 });
  const x0 = solver._pack(), n = x0.length, asm = solver._assemble(x0), m = asm.m;
  const owners = [];
  for (const c of nonDriven) { const k = (c.type === 'coincident' || c.type === 'midpoint') ? 2 : 1; for (let i = 0; i < k; i++) owners.push(c); }
  const eps = 1e-6, Jfd = [];
  for (let i = 0; i < m; i++) Jfd.push(new Float64Array(n));
  for (let k = 0; k < n; k++) {
    const xp = Float64Array.from(x0), xm = Float64Array.from(x0); xp[k] += eps; xm[k] -= eps;
    const a = solver._assemble(xp).r, b = solver._assemble(xm).r;
    for (let i = 0; i < m; i++) Jfd[i][k] = (a[i] - b[i]) / (2 * eps);
  }
  const byType = new Map();
  const mapped = owners.length === m;
  for (let i = 0; i < m; i++) {
    let err = 0; for (let k = 0; k < n; k++) err = Math.max(err, Math.abs(Jfd[i][k] - asm.J[i * n + k]));
    const t = mapped ? owners[i].type + (owners[i].mutual ? '(mutual)' : '') : 'row' + i;
    byType.set(t, Math.max(byType.get(t) || 0, err));
  }
  // nullity from the finite-difference rows: Gaussian elimination on row-normalised rows
  const R = Jfd.map(v => { let nn = 0; for (const x of v) nn += x * x; nn = Math.sqrt(nn); return nn < 1e-9 ? null : v.map(x => x / nn); }).filter(Boolean);
  let rank = 0;
  for (let c = 0; c < n && rank < R.length; c++) {
    let best = rank, bv = Math.abs(R[rank][c]);
    for (let i = rank + 1; i < R.length; i++) if (Math.abs(R[i][c]) > bv) { bv = Math.abs(R[i][c]); best = i; }
    if (bv < 1e-6) continue;
    [R[rank], R[best]] = [R[best], R[rank]];
    for (let i = 0; i < R.length; i++) if (i !== rank) { const f = R[i][c] / R[rank][c]; if (f) for (let j = c; j < n; j++) R[i][j] -= f * R[rank][j]; }
    rank++;
  }
  return { n, m, nullity: n - rank, worst: [...byType].filter(([, e]) => e > 1e-4).map(([type, err]) => ({ type, err })) };
}

// ---------------------------------------------------------------- tables (used by the script and the doc)
const fmt = (v) => (typeof v === 'number' ? (Math.abs(v) < 1e-12 ? '0' : Math.abs(v) < 1e-3 ? v.toExponential(1) : (+v.toFixed(4)).toString()) : String(v));
export function tableB(R) {
  const lines = [`  ${'#'.padEnd(3)}${'step'.padEnd(46)}${'accepted'.padEnd(10)}${'conv'.padEnd(6)}${'resid'.padEnd(9)}${'nullity'.padEnd(8)}notes`];
  R.B.forEach((r, i) => {
    const note = [r.driven ? 'DRIVEN' : '', ...r.errors, ...(r.accepted ? [] : ['REFUSED']), ...r.notes.map(x => x.slice(0, 60))].filter(Boolean).join(' | ');
    lines.push(`  ${String(i + 1).padEnd(3)}${(r.label || r.type).slice(0, 45).padEnd(46)}${(r.accepted ? 'yes' : 'NO').padEnd(10)}${(r.converged ? 'yes' : 'NO').padEnd(6)}${fmt(r.residual).padEnd(9)}${String(r.nullity).padEnd(8)}${note}`);
  });
  return lines.join('\n');
}
export function summaryRow(R) {
  const pert = R.D.perturbed;
  const same = pert.filter(p => p.converged && p.dev < GEOM_TOL).length;
  const edits = R.E.length, editsOk = R.E.filter(e => !e.reverted && e.converged && e.residual < RES_TOL && !e.nan && e.nullity === 0 && e.flips.length === 0 && e.backDev < GEOM_TOL).length;
  return { drawing: R.name, joints: R.C.joints, constraints: R.C.constraints, nullity: R.C.nullity, panelDof: R.C.panelDof, verifier: R.D.verifierMax, perturbed: `${same}/${pert.length}`, edits: `${editsOk}/${edits}`,
    planegcsDof: R.G ? R.G.dof : 'n/a', refused: R.B.filter(r => !r.accepted).length, demoted: R.B.filter(r => r.accepted && r.driven).length };
}
export { NONE };
