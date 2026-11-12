// TASK 518 part 1 -- turns one of OUR drawings into a plain-data JOB for Fusion: the document after build() (joints, shapes, structural constraints) and the
// ops (recipe steps, dimension edits, abuse probes) in the order our harness applies them. Fusion replays the job (scripts/fusion-oracle/run-jobs.py) and
// records the answers; the test replays the same recipe through OUR pipeline and compares. Pure data: nothing here knows Fusion's API.
import * as L from '../audit/lib.js';
import { arcSweepInfo } from '#core/geometry.js';
import { commitDimensionEdit } from '#ui/dimension-seams.js';
import { deleteConstraints } from '#core/delete-manager.js';

const RUNTIME = /^__/;
const ORIGIN = L.origin;

// a JSON-safe, id-stable copy of a constraint (runtime fields dropped)
export function serConstraint(c) {
  const o = {};
  for (const [k, v] of Object.entries(c)) if (!RUNTIME.test(k) && typeof v !== 'function' && v !== undefined) o[k] = v;
  return JSON.parse(JSON.stringify(o));
}

// the document as it stands: joints {id: [x, y, fixed]}, shapes, constraints (each with a uid assigned in order)
export function serDoc(S, uids) {
  const joints = {};
  for (const [id, j] of S.state.joints) joints[id] = [j.x, j.y, !!j.fixed];
  const shapes = S.state.shapes.map(s => {
    const o = { id: s.id, type: s.type, joints: s.joints.slice(), construction: !!s.isConstruction };
    if (s.type === 'circle') o.radius = s.radius;
    if (s.type === 'arc') {
      const [c, a, b] = s.joints.map(id => S.state.joints.get(id));
      const info = arcSweepInfo(c, a, b, { largeArc: s.largeArc, sweep: s.sweep });
      o.sweep = info.dir * info.span;      // signed angle (rad) from start to end, in the same x/y numbers Fusion gets
    }
    return o;
  });
  const constraints = S.state.constraints.filter(c => c && c.type !== 'mouse_spring').map(c => { if (!uids.has(c)) uids.set(c, uids.size + 1); return { uid: uids.get(c), ...serConstraint(c) }; });
  return { joints, shapes, constraints };
}

const dimsOf = (S) => L.dimensionsOf(S);

// OUR side of the comparison: the state after a step as plain arrays indexed like the Fusion fixtures (joints: document order without the origin; shapes: document order)
export function oursSnap(S, jointIds, shapeIds) {
  const P = (id) => { const j = S.state.joints.get(id); return j ? [j.x, j.y] : null; };
  const rad = (sh) => (sh.type === 'circle' ? sh.radius : sh.type === 'arc' ? Math.hypot(P(sh.joints[0])[0] - P(sh.joints[1])[0], P(sh.joints[0])[1] - P(sh.joints[1])[1]) : null);
  const f = L.freedom(S), free = new Set(f.free.map(x => x.id));
  const full = shapeIds.map(id => {
    const sh = S.state.shapes.find(x => x.id === id);
    if (!sh) return null;
    const joints = sh.joints.filter(j => j !== ORIGIN);
    let ok = joints.every(j => !free.has(j));
    if (sh.type === 'circle') ok = ok && S.state.constraints.some(c => c && c.type === 'distance' && c.isRadius && c.shape === id && !L.isDriven(c));   // a circle's radius is shape data: it counts only when dimensioned (Fusion's rule)
    return ok;
  });
  const inShape = new Set(S.state.shapes.flatMap(sh => sh.joints));
  const fullPts = jointIds.map(j => (inShape.has(j) ? null : !free.has(j)));
  const circlesDimmed = S.state.shapes.filter(sh => sh.type === 'circle').every(sh => S.state.constraints.some(c => c && c.type === 'distance' && c.isRadius && c.shape === sh.id && !L.isDriven(c)));
  return { pts: jointIds.map(P), radii: shapeIds.map(id => { const sh = S.state.shapes.find(x => x.id === id); return sh ? rad(sh) : null; }), full, fullPts, sketchFull: f.nullity === 0 && circlesDimmed, nullity: f.nullity, residual: L.residuals(S).max };
}

// A drawing's jobs. Returns { name, title, doc, ops, jobs } where each job = { id, ops: [...], record: 'all' | 'last' }.
// ops: { op:'add', label, type, ...resolved params, target?, measuredFirst? } | { op:'delete', uid } | { op:'edit', uid, value }
// put Fusion's coordinates (and circle radii) into our sketch, measure the residual of every driving constraint, put ours back
export function fusionResidual(S, jointIds, shapeIds, snap) {
  const saved = L.snapshot(S), radii = new Map();
  jointIds.forEach((id, i) => { const j = S.state.joints.get(id), p = snap.pts[i]; if (j && p) { j.x = p[0]; j.y = p[1]; } });
  shapeIds.forEach((id, i) => { const sh = S.state.shapes.find(x => x.id === id); if (sh && sh.type === 'circle' && snap.radii[i] != null) { radii.set(sh, sh.radius); sh.radius = snap.radii[i]; } });
  const r = L.residuals(S).max;
  L.restore(S, saved); for (const [sh, v] of radii) sh.radius = v;
  return r;
}

export function exportDrawing(mod, opts = {}) {
  const S = L.newSketch();
  const built = mod.build(S, opts);
  S.names = built.names;
  const uids = new Map();
  const doc = serDoc(S, uids);
  const jointIds = Object.keys(doc.joints).filter(j => j !== ORIGIN), shapeIds = doc.shapes.map(x => x.id);
  const steps = [], oursSteps = [];
  for (const step of mod.RECIPE) {
    const isDel = step.op === 'delete';
    let hit = null;
    if (isDel) hit = S.state.constraints.find(c => Object.entries(step.match).every(([k, v]) => (k === 'shape' || k === 'line' || k === 'circle' ? built.names[v] || v : v) === c[k]));
    const row = L.applyStep(S, step, built.names);
    const so = { accepted: !!row.accepted, driven: !!row.driven, converged: !!row.converged, ...oursSnap(S, jointIds, shapeIds) };
    // does FUSION's solved geometry satisfy OUR constraint set at this step? (another valid branch is not a disagreement; a violation is)
    const fs_ = opts.fusion && opts.fusion.steps[oursSteps.length];
    if (fs_ && fs_.accepted && fs_.snap) so.fusionResidual = fusionResidual(S, jointIds, shapeIds, fs_.snap);
    oursSteps.push(so);
    if (isDel) steps.push({ op: 'delete', label: step.label, uid: hit ? uids.get(hit) : null, oursAccepted: row.accepted });
    else {
      const p = L.resolve(step, built.names);
      const isDim = (step.type === 'distance' || step.type === 'angle') && step.value != null;
      const created = row.constraint;
      if (created && !uids.has(created)) uids.set(created, uids.size + 1);
      steps.push({ op: 'add', label: step.label, type: step.type, params: serConstraint(p), isDim, target: isDim ? p.value : null, uid: created ? uids.get(created) : null, oursAccepted: row.accepted });
    }
  }
  S.engine.solve(L.ITER);
  const ref = L.snapshot(S);
  const ours = { steps: oursSteps, jobs: {} };
  const jobs = [{ id: 'recipe', record: 'all', ops: steps }];
  // E: every driving dimension x0.8 and x1.25, each in a fresh rebuild (Fusion cannot restore positions the way our harness does)
  const edits = [];
  for (const dim of dimsOf(S)) {
    const uid = uids.get(dim);
    for (const f of [0.8, 1.25]) edits.push({ uid, factor: f, value: dim.value * f, from: dim.value });
  }
  edits.forEach((e, i) => jobs.push({ id: `edit${i}`, record: 'coords', ops: [...steps, { op: 'edit', label: `edit x${e.factor}`, uid: e.uid, value: e.value }] }));
  // ours: the same edits through the UI seam (restore the finished drawing first, as the harness does)
  const dimByUid = new Map([...uids.entries()].map(([c, u]) => [u, c]));
  edits.forEach((e, i) => {
    L.restore(S, ref); S.engine.solve(L.ITER);
    const dim = dimByUid.get(e.uid), v0 = dim.value;
    const r = commitDimensionEdit(S.state, dim, e.value);
    const res = S.engine.solve(L.ITER);
    ours.jobs[`edit${i}`] = { accepted: !r.reverted, ...oursSnap(S, jointIds, shapeIds), converged: res.converged === true };
    commitDimensionEdit(S.state, dim, v0); dim.value = v0;
  });
  L.restore(S, ref); S.engine.solve(L.ITER);
  // F: redundant / conflicting dimension on the finished drawing, and deleting one dimension
  const pr = built.probes || {};
  const pos = (n) => S.state.joints.get(built.names[n] || n);
  for (const kind of ['redundant', 'conflict']) {
    if (!pr[kind]) continue;
    const [a, b] = pr[kind].joints.map(n => built.names[n] || n);
    const A = S.state.joints.get(a), B = S.state.joints.get(b);
    const m = Math.hypot(A.x - B.x, A.y - B.y);
    jobs.push({ id: kind, record: 'last', ops: [...steps, { op: 'add', label: kind, type: 'distance', params: { type: 'distance', joints: [a, b], value: kind === 'conflict' ? m * 1.5 : m, dimMode: 'aligned' }, isDim: true, target: kind === 'conflict' ? m * 1.5 : m, uid: null }] });
    L.restore(S, ref); S.engine.solve(L.ITER);
    const row = L.applyStep(S, { label: kind, type: 'distance', joints: [a, b], value: kind === 'conflict' ? m * 1.5 : m, dimMode: 'aligned' }, {});
    ours.jobs[kind] = { accepted: !!row.accepted, driven: !!row.driven, ...oursSnap(S, jointIds, shapeIds) };
    if (row.constraint) S.state.constraints.splice(S.state.constraints.indexOf(row.constraint), 1);
    L.restore(S, ref); S.engine.solve(L.ITER);
  }
  if (pr.delete) {
    const dim = S.state.constraints.find(c => Object.entries(pr.delete).every(([k, v]) => (built.names[v] || v) === c[k] || (Array.isArray(c[k]) && c[k].join() === v.map(n => built.names[n] || n).join())));
    if (dim) {
      jobs.push({ id: 'delete', record: 'last', ops: [...steps, { op: 'delete', label: 'delete ' + L.describe(dim), uid: uids.get(dim) }] });
      deleteConstraints(S.state, [dim]); S.engine.solve(L.ITER);
      ours.jobs.delete = { accepted: true, ...oursSnap(S, jointIds, shapeIds) };
      S.state.undo(); S.engine.solve(L.ITER);
    }
  }
  return { name: mod.NAME, title: mod.TITLE, doc, jobs, edits, ours, jointIds, shapeIds };
}
