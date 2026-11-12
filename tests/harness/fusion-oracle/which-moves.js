// TASK 518 part 0 -- WHICH GEOMETRY MOVES. One scenario list (pure data, units mm) that is run twice: in a live Fusion 360
// (scripts/fusion-oracle/run-which-moves.py, answers stored in tests/fixtures/fusion-oracle/which-moves.json) and through OUR
// ConstraintManager (runOurs below, the same audit-harness builders the tools use). Scenario = start geometry that deliberately does NOT
// satisfy the constraint, a prep (fix / H-V / dimension) and one act (the constraint or dimension under test, in pick order).
import * as L from '../audit/lib.js';
import { ConstraintManager } from '#core/constraint-manager.js';
import { toggleFixedSelection } from '#ui/input-manager.js';
import { commitDimensionEdit } from '#ui/dimension-seams.js';

export const MOVE_TOL = 1e-6;      // Fusion: "stayed" = every point and the radius moved < 1e-6 mm
export const OURS_TOL = 1e-4;      // ours: the Newton solve stops at ~1e-5..1e-4 of residual; below this is "stayed"

// ------------------------------------------------------------------------------------------------ the groups
const line = (n, p0, p1) => ({ n, k: 'line', p: [p0, p1] });
const circ = (n, c, r) => ({ n, k: 'circle', c, r });
const arc = (n, c, s, e) => ({ n, k: 'arc', c, s, e });
const pt = (n, p) => ({ n, k: 'pt', p });
const A_LINE = [[20, 20], [80, 35]];

// act(order) -> the act record for pick order ['A','B'] | ['B','A']
export const GROUPS = [
  // ---- one-entity groups (a line; "A fixed" = which end stays) ----
  { id: 'horizontal-line', single: true, ents: () => [line('A', [20, 20], [80, 35])], act: () => ({ op: 'hv', d: 'H', order: ['A'] }) },
  { id: 'vertical-line', single: true, ents: () => [line('A', [20, 20], [33, 80])], act: () => ({ op: 'hv', d: 'V', order: ['A'] }) },
  // ---- points ----
  { id: 'horizontal-2pt', pair: true, noFixfull: true, ents: () => [pt('A', [20, 20]), pt('B', [80, 38])], act: (o) => ({ op: 'hv2', d: 'H', pts: o.map(n => [n, 0]) }) },
  { id: 'vertical-2pt', pair: true, noFixfull: true, ents: () => [pt('A', [20, 20]), pt('B', [38, 80])], act: (o) => ({ op: 'hv2', d: 'V', pts: o.map(n => [n, 0]) }) },
  { id: 'coincident-pp', pair: true, ents: () => [line('A', ...A_LINE), line('B', [100, 60], [150, 90])], act: (o) => ({ op: 'coincident', pts: o.map(n => [n, n === 'A' ? 1 : 0]) }) },
  // ---- line-line ----
  { id: 'parallel', pair: true, shareable: true, ents: (sh) => [line('A', ...A_LINE), line('B', sh ? [80, 35] : [30, 70], sh ? [150, 85] : [100, 120])], act: (o) => ({ op: 'parallel', order: o }) },
  { id: 'perpendicular', pair: true, shareable: true, ents: (sh) => [line('A', ...A_LINE), line('B', sh ? [80, 35] : [100, 40], sh ? [110, 95] : [130, 100])], act: (o) => ({ op: 'perp', order: o }) },
  { id: 'collinear', pair: true, shareable: true, ents: (sh) => [line('A', [20, 20], [80, 32]), line('B', sh ? [80, 32] : [95, 50], sh ? [135, 44] : [150, 62])], act: (o) => ({ op: 'collinear', order: o }) },
  { id: 'equal-line-line', pair: true, shareable: true, ents: (sh) => [line('A', ...A_LINE), line('B', sh ? [80, 35] : [30, 70], sh ? [180, 50] : [130, 80])], act: (o) => ({ op: 'equal', order: o }) },
  // ---- point + curve ----
  { id: 'pointOnLine', pair: true, noPtDim: true, ents: () => [pt('A', [50, 60]), line('B', [20, 20], [100, 30])], act: (o) => ({ op: 'pointon', pt: ['A', 0], curve: 'B', order: o.map(n => (n === 'A' ? 'pt' : 'curve')) }), oursOrderless: true },
  { id: 'pointOnCircle', pair: true, ents: () => [pt('A', [70, 50]), circ('B', [40, 40], 15)], act: (o) => ({ op: 'pointon', pt: ['A', 0], curve: 'B', order: o.map(n => (n === 'A' ? 'pt' : 'curve')) }), oursOrderless: true },
  { id: 'midpoint', pair: true, ents: () => [pt('A', [55, 50]), line('B', [20, 20], [100, 30])], act: (o) => ({ op: 'midpoint', pt: ['A', 0], curve: 'B', order: o.map(n => (n === 'A' ? 'pt' : 'curve')) }), oursOrderless: true },
  // ---- equal ----
  { id: 'equal-circle-circle', pair: true, ents: () => [circ('A', [40, 40], 15), circ('B', [110, 50], 25)], act: (o) => ({ op: 'equal', order: o }) },
  { id: 'equal-arc-arc', pair: true, ents: () => [arc('A', [40, 40], [55, 40], [40, 55]), arc('B', [110, 50], [135, 50], [110, 75])], act: (o) => ({ op: 'equal', order: o }) },
  // Fusion's API refuses equal(arc, circle) with "invalid argument value" (measured 2026-11-11), so one row only
  { id: 'equal-arc-circle', pair: true, onlyFree: true, ents: () => [arc('A', [40, 40], [55, 40], [40, 55]), circ('B', [110, 50], 25)], act: (o) => ({ op: 'equal', order: o }) },
  // ---- tangent ----
  { id: 'tangent-line-circle', pair: true, ents: () => [line('A', [20, 20], [120, 30]), circ('B', [70, 70], 15)], act: (o) => ({ op: 'tangent', order: o }) },
  { id: 'tangent-line-arc', pair: true, ents: () => [line('A', [20, 20], [120, 30]), arc('B', [70, 70], [85, 70], [70, 85])], act: (o) => ({ op: 'tangent', order: o }) },
  { id: 'tangent-circle-circle', pair: true, ents: () => [circ('A', [40, 40], 15), circ('B', [110, 50], 25)], act: (o) => ({ op: 'tangent', order: o }) },
  { id: 'tangent-arc-arc', pair: true, ents: () => [arc('A', [40, 40], [55, 40], [40, 55]), arc('B', [110, 50], [135, 50], [110, 75])], act: (o) => ({ op: 'tangent', order: o }) },
  // ---- dimensions (value set to scale x measured, so the geometry has to move) ----
  { id: 'dim-aligned', pair: true, ents: () => [line('A', ...A_LINE), line('B', [110, 60], [160, 90])], act: (o) => ({ op: 'dist', mode: 'aligned', scale: 1.4, pts: o.map(n => [n, n === 'A' ? 1 : 0]) }) },
  { id: 'dim-horizontal', pair: true, ents: () => [line('A', ...A_LINE), line('B', [110, 60], [160, 90])], act: (o) => ({ op: 'dist', mode: 'horizontal', scale: 1.4, pts: o.map(n => [n, n === 'A' ? 1 : 0]) }) },
  { id: 'dim-vertical', pair: true, ents: () => [line('A', ...A_LINE), line('B', [110, 60], [160, 90])], act: (o) => ({ op: 'dist', mode: 'vertical', scale: 1.4, pts: o.map(n => [n, n === 'A' ? 1 : 0]) }) },
  { id: 'dim-length', single: true, ents: () => [line('A', ...A_LINE)], act: () => ({ op: 'len', scale: 1.4, order: ['A'] }) },
  { id: 'dim-radius-circle', single: true, ents: () => [circ('A', [40, 40], 15)], act: () => ({ op: 'radius', scale: 1.4, order: ['A'] }) },
  { id: 'dim-radius-arc', single: true, ents: () => [arc('A', [40, 40], [55, 40], [40, 55])], act: () => ({ op: 'radius', scale: 1.4, order: ['A'] }) },
  { id: 'dim-angle', pair: true, ents: () => [line('A', ...A_LINE), line('B', [100, 40], [130, 100])], act: (o) => ({ op: 'angle', delta: 20, order: o }) },
];

const nearAxis = (p) => (Math.abs(p[1][0] - p[0][0]) >= Math.abs(p[1][1] - p[0][1]) ? 'H' : 'V');

// the prep records for one operand under a variant; null = not applicable for that operand kind
function prepFor(e, v, group) {
  const n = e.n;
  if (v === 'fix1') return [{ op: 'fix', pt: [n, 0] }];
  if (v === 'fix2') return e.k === 'line' ? [{ op: 'fix', pt: [n, 1] }] : null;
  if (v === 'fixfull') {
    if (e.k === 'pt') return null;
    if (e.k === 'line') return [{ op: 'fixline', e: n }];
    if (e.k === 'circle') return [{ op: 'fix', pt: [n, 0] }, { op: 'rad', e: n }];
    return [{ op: 'fixline', e: n }];     // arc: centre, start, end
  }
  if (v === 'hv') return e.k === 'line' ? [{ op: 'hv', e: n, d: nearAxis(e.p) }] : null;
  if (v === 'dim') {
    if (e.k === 'line') return [{ op: 'len', e: n }];
    if (e.k === 'circle' || e.k === 'arc') return [{ op: 'rad', e: n }];
    return null;
  }
  return null;
}

export function buildScenarios() {
  const out = [];
  for (const g of GROUPS) {
    // pointOnLine / pointOnCircle / midpoint: Fusion's API takes the point FIRST (curve first is a type error), and our constraint has no pick order
    const orders = g.single ? [['A']] : (g.oursOrderless ? [['A', 'B']] : [['A', 'B'], ['B', 'A']]);
    const base = g.ents(false);
    const variants = [{ v: 'free' }];
    const names = g.single ? ['A'] : ['A', 'B'];
    for (const [i, n] of names.entries()) {
      const e = base.find(x => x.n === n);
      for (const v of ['fix1', 'fix2', 'fixfull', 'hv', 'dim']) {
        if (v === 'fix2' && !g.single) continue;           // pair groups: one point / fully fixed / H-V / dimensioned
        if (v === 'fixfull' && g.noFixfull) continue;
        if (v === 'dim' && g.noPtDim && e.k === 'pt') continue;
        const p = prepFor(e, v, g);
        if (p) variants.push({ v: `${n}_${v}`, prep: p });
      }
    }
    if (g.shareable) variants.push({ v: 'shared', shared: { 'B.0': ['A', 1] }, sharedEnts: true });
    for (const va of g.onlyFree ? variants.slice(0, 1) : variants) for (const o of orders) {
      const oursOrderless = g.oursOrderless && o[0] === 'B';
      const ents = g.ents(!!va.sharedEnts);
      out.push({ id: `${g.id}.${va.v}.${o.join('')}`, group: g.id, variant: va.v, order: o.join(''), ents, prep: va.prep || [], shared: va.shared || null, act: g.act(o), oursOrderless });
    }
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ ours
const posOfJ = (S, id) => { const j = S.state.joints.get(id); return [j.x, j.y]; };
export function snapOurs(S, built) {
  const out = {};
  for (const [n, e] of Object.entries(built)) {
    const d = { pts: e.joints.map(j => posOfJ(S, j)) };
    if (e.k === 'circle') d.r = L.shape(S, e.shape).radius;
    if (e.k === 'arc') { const c = posOfJ(S, e.joints[0]), s = posOfJ(S, e.joints[1]); d.r = Math.hypot(s[0] - c[0], s[1] - c[1]); }
    out[n] = d;
  }
  return out;
}
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// The scenario's geometric act (not a dimension) as the type + params our tools pass, or null for a dimension act.
export function actOf(sc, built) {
  const a = sc.act;
  const J = (ref) => built[ref[0]].joints[ref[1]];
  switch (a.op) {
    case 'hv2': return { type: a.d === 'H' ? 'horizontal' : 'vertical', params: { joints: a.pts.map(J) } };
    case 'hv': return { type: a.d === 'H' ? 'horizontal' : 'vertical', params: { joints: built[a.order[0]].joints.slice(0, 2) } };
    case 'parallel': return { type: 'parallel', params: { shapes: a.order.map(n => built[n].shape) } };
    case 'perp': return { type: 'perpendicular', params: { shapes: a.order.map(n => built[n].shape) } };
    case 'collinear': return { type: 'collinear', params: { shapes: a.order.map(n => built[n].shape) } };
    case 'equal': return { type: 'equal', params: { shapes: a.order.map(n => built[n].shape) } };
    case 'tangent': {
      const [f, s] = a.order.map(n => built[n]);
      if (f.k === 'line' || s.k === 'line') { const l = f.k === 'line' ? f : s, c = f.k === 'line' ? s : f; return { type: 'tangent', params: { line: l.shape, circle: c.shape } }; }
      return { type: 'tangent', params: { shapes: [f.shape, s.shape] } };
    }
    case 'coincident': return { type: 'coincident', params: { joints: a.pts.map(J) } };
    case 'pointon': return { type: 'pointOnLine', params: { joint: J(a.pt), shape: built[a.curve].shape } };
    case 'midpoint': { const l = built[a.curve]; return { type: 'midpoint', params: { joints: [l.joints[0], l.joints[1], J(a.pt)] } }; }
    default: return null;
  }
}

// The scenario's dimension act: { type, params (placed at the MEASURED value, as the Dimension tool does), target (the typed value) }, or null.
export function dimActOf(sc, built, S) {
  const a = sc.act;
  const J = (ref) => built[ref[0]].joints[ref[1]];
  const rad = (n) => { const e = built[n]; return e.k === 'circle' ? L.shape(S, e.shape).radius : dist(posOfJ(S, e.joints[0]), posOfJ(S, e.joints[1])); };
  switch (a.op) {
    case 'dist': {
      const [p, q] = a.pts.map(J), P = posOfJ(S, p), Q = posOfJ(S, q);
      const m = a.mode === 'aligned' ? dist(P, Q) : a.mode === 'horizontal' ? Math.abs(Q[0] - P[0]) : Math.abs(Q[1] - P[1]);
      return { type: 'distance', params: { joints: [p, q], value: m, dimMode: a.mode }, target: m * a.scale };
    }
    case 'len': { const j = built[a.order[0]].joints; const m = dist(posOfJ(S, j[0]), posOfJ(S, j[1])); return { type: 'distance', params: { joints: j.slice(0, 2), value: m, dimMode: 'aligned' }, target: m * a.scale }; }
    case 'radius': return { type: 'distance', params: { shape: built[a.order[0]].shape, value: rad(a.order[0]), isRadius: true }, target: rad(a.order[0]) * a.scale };
    case 'angle': {
      const [f, s] = a.order.map(n => built[n].joints.map(j => posOfJ(S, j)));
      const ang = (l) => Math.atan2(l[1][1] - l[0][1], l[1][0] - l[0][0]);
      let v = Math.abs((ang(f) - ang(s)) * 180 / Math.PI); if (v > 180) v = 360 - v;   // the Dimension tool's own measure
      return { type: 'angle', params: { shapes: a.order.map(n => built[n].shape), value: v }, target: v + a.delta };
    }
    default: return null;
  }
}

// The scenario's geometry and prep in OUR sketch, before the act.
export function buildOurs(sc) {
  const S = L.newSketch();
  const st = S.state;
  const built = {};
  for (const e of sc.ents) {
    if (e.k === 'line') {
      const sh = sc.shared && sc.shared[e.n + '.0'];
      const a = sh ? built[sh[0]].joints[sh[1]] : L.point(S, ...e.p[0]);
      const b = L.point(S, ...e.p[1]);
      built[e.n] = { k: 'line', shape: L.line(S, a, b), joints: [a, b] };
    } else if (e.k === 'circle') { const c = L.circle(S, e.c[0], e.c[1], e.r); built[e.n] = { k: 'circle', shape: c.id, joints: [c.c] }; }
    else if (e.k === 'arc') {
      const c = L.point(S, ...e.c), s = L.point(S, ...e.s), en = L.point(S, ...e.e);
      built[e.n] = { k: 'arc', shape: L.arc(S, c, s, en), joints: [c, s, en] };
    } else if (e.k === 'pt') { const p = L.point(S, ...e.p); built[e.n] = { k: 'pt', shape: null, joints: [p] }; }
  }
  const J = (ref) => built[ref[0]].joints[ref[1]];
  const mk = (type, params) => ConstraintManager.createConstraint(st, type, params, { source: 'audit' });
  const lock = (ids) => { st.selectedJoints = new Set(ids); toggleFixedSelection(st); st.selectedJoints = new Set(); };
  const radiusOf = (n) => { const e = built[n]; return e.k === 'circle' ? L.shape(S, e.shape).radius : dist(posOfJ(S, e.joints[0]), posOfJ(S, e.joints[1])); };
  const rec = { prepFailed: null };
  // the UI flow of a dimension: placed at the MEASURED value, then the typed number goes through commitDimensionEdit (what Fusion's "edit the parameter" is)
  const placeAndEdit = (params, target, type = 'distance') => {
    const c = mk(type, params);
    if (c && typeof c === 'object' && !L.isDriven(c)) { const er = commitDimensionEdit(st, c, target); rec.reverted = !!(er && er.reverted); }
    return c;
  };
  for (const p of sc.prep) {
    if (p.op === 'fix') lock([J(p.pt)]);
    else if (p.op === 'fixline') lock(built[p.e].joints);
    else if (p.op === 'hv') mk(p.d === 'H' ? 'horizontal' : 'vertical', { joints: built[p.e].joints.slice(0, 2) });
    else if (p.op === 'len') mk('distance', { joints: built[p.e].joints.slice(0, 2), value: dist(posOfJ(S, built[p.e].joints[0]), posOfJ(S, built[p.e].joints[1])), dimMode: 'aligned' });
    else if (p.op === 'rad') mk('distance', { shape: built[p.e].shape, value: radiusOf(p.e), isRadius: true });
  }
  S.engine.solve(L.ITER);
  return { S, st, built, rec, mk, placeAndEdit };
}

export function runOurs(sc) {
  const { S, st, built, rec, mk, placeAndEdit } = buildOurs(sc);
  rec.before = snapOurs(S, built);
  const a = sc.act;
  const nC0 = st.constraints.length;
  S.msgs.length = 0;
  let ret;
  const muted = (f) => { const e = console.error, w = console.warn; console.error = () => {}; console.warn = () => {}; try { return f(); } finally { console.error = e; console.warn = w; } };
  muted(() => {
    const geo = actOf(sc, built);
    if (geo) { ret = mk(geo.type, geo.params); return; }
    const d = dimActOf(sc, built, S);
    if (!d) throw new Error('act ' + a.op);
    ret = placeAndEdit(d.params, d.target, d.type);
    if (d.type === 'angle') rec.dim0_deg = d.params.value;
  });
  rec.accepted = !!ret;
  const created = st.constraints.slice(nC0).filter(c => c);
  rec.driven = created.some(L.isDriven);
  rec.after = snapOurs(S, built);
  rec.msg = S.msgs.join(' | ').slice(0, 160);
  rec.nullity = L.nullity(S);
  return rec;
}

// ------------------------------------------------------------------------------------------------ comparing
// which entities moved (any point or the radius by more than tol)
export function movedSet(before, after, tol) {
  const moved = {};
  for (const n of Object.keys(before)) {
    let d = 0;
    before[n].pts.forEach((p, i) => { d = Math.max(d, dist(p, after[n].pts[i])); });
    if (before[n].r != null) d = Math.max(d, Math.abs(before[n].r - after[n].r));
    moved[n] = d > tol;
  }
  return moved;
}
// per point: which points moved (finer than per entity), as a string like "A:01 B:--"
export function pointMoves(before, after, tol) {
  return Object.keys(before).map(n => n + ':' + before[n].pts.map((p, i) => (dist(p, after[n].pts[i]) > tol ? 'M' : '.')).join('') + (before[n].r != null ? (Math.abs(before[n].r - after[n].r) > tol ? 'r' : '.') : '')).join(' ');
}

// one cell: Fusion's answer vs ours. `same` = both accepted or both refused, and (when accepted) the same points / radii moved.
export function cellOf(f, o) {
  const fm = f.accepted ? pointMoves(f.before, f.after, MOVE_TOL) : 'refused';
  const om = o.accepted ? pointMoves(o.before, o.after, OURS_TOL) : 'refused';
  return { fusion: fm, ours: o.accepted && o.driven ? om + ' (reference)' : om, same: fm === om && !(o.accepted && o.driven) };
}
