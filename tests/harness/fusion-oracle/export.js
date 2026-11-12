// TASK 518 part 1 -- turns one of OUR drawings into a plain-data JOB for Fusion: the document after build() (joints, shapes, structural constraints) and the
// ops (recipe steps, dimension edits, abuse probes) in the order our harness applies them. Fusion replays the job (scripts/fusion-oracle/run-jobs.py) and
// records the answers; the test replays the same recipe through OUR pipeline and compares. Pure data: nothing here knows Fusion's API.
import * as L from '../audit/lib.js';
import { arcSweepInfo } from '#core/geometry.js';

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

// A drawing's jobs. Returns { name, title, doc, ops, jobs } where each job = { id, ops: [...], record: 'all' | 'last' }.
// ops: { op:'add', label, type, ...resolved params, target?, measuredFirst? } | { op:'delete', uid } | { op:'edit', uid, value }
export function exportDrawing(mod, opts = {}) {
  const S = L.newSketch();
  const built = mod.build(S, opts);
  S.names = built.names;
  const uids = new Map();
  const doc = serDoc(S, uids);
  const steps = [];
  for (const step of mod.RECIPE) {
    const isDel = step.op === 'delete';
    let hit = null;
    if (isDel) hit = S.state.constraints.find(c => Object.entries(step.match).every(([k, v]) => (k === 'shape' || k === 'line' || k === 'circle' ? built.names[v] || v : v) === c[k]));
    const row = L.applyStep(S, step, built.names);
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
  const jobs = [{ id: 'recipe', record: 'all', ops: steps }];
  // E: every driving dimension x0.8 and x1.25, each in a fresh rebuild (Fusion cannot restore positions the way our harness does)
  const edits = [];
  for (const dim of dimsOf(S)) {
    const uid = uids.get(dim);
    for (const f of [0.8, 1.25]) edits.push({ uid, factor: f, value: dim.value * f, from: dim.value });
  }
  edits.forEach((e, i) => jobs.push({ id: `edit${i}`, record: 'coords', ops: [...steps, { op: 'edit', label: `edit x${e.factor}`, uid: e.uid, value: e.value }] }));
  // F: redundant / conflicting dimension on the finished drawing, and deleting one dimension
  const pr = built.probes || {};
  const pos = (n) => S.state.joints.get(built.names[n] || n);
  for (const kind of ['redundant', 'conflict']) {
    if (!pr[kind]) continue;
    const [a, b] = pr[kind].joints.map(n => built.names[n] || n);
    const A = S.state.joints.get(a), B = S.state.joints.get(b);
    const m = Math.hypot(A.x - B.x, A.y - B.y);
    jobs.push({ id: kind, record: 'last', ops: [...steps, { op: 'add', label: kind, type: 'distance', params: { type: 'distance', joints: [a, b], value: kind === 'conflict' ? m * 1.5 : m, dimMode: 'aligned' }, isDim: true, target: kind === 'conflict' ? m * 1.5 : m, uid: null }] });
  }
  if (pr.delete) {
    const dim = S.state.constraints.find(c => Object.entries(pr.delete).every(([k, v]) => (built.names[v] || v) === c[k] || (Array.isArray(c[k]) && c[k].join() === v.map(n => built.names[n] || n).join())));
    if (dim) jobs.push({ id: 'delete', record: 'last', ops: [...steps, { op: 'delete', label: 'delete ' + L.describe(dim), uid: uids.get(dim) }] });
  }
  return { name: mod.NAME, title: mod.TITLE, doc, jobs, edits };
}
