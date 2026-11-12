// TASK 530 phase 2 -- DRAGGING (real mouse, qualitative). One cell list (pure data, cm; Fusion's unit) that is run twice: in a live Fusion 360
// with REAL mouse input (scripts/fusion-oracle/drag-batch-*.py, answers in tests/fixtures/fusion-oracle/drag-fusion.json) and through OUR real
// pointer-drag code path (runOurs below: handleSelectionPointerDown / Move / Up from packages/ui/input-handlers/selection-tools.js, the same
// calls input-manager.js makes for a mouse drag; the solver call is the one inside handleSelectionPointerMove). Phase 1 showed Fusion's constrained
// drag is PATH DEPENDENT, so only QUALITATIVE outcomes are compared (record() below): which points / radii moved, did the dragged point move,
// were all constraints and dimensions kept, rigid (translate / rotate) or stretch, refused (nothing moved).
import * as L from '../audit/lib.js';
import { ConstraintManager } from '#core/constraint-manager.js';
import { toggleFixedSelection } from '#ui/input-manager.js';
import { SolverConfig } from '#core/solver-config.js';
import { handleSelectionPointerDown, handleSelectionPointerMove, handleSelectionPointerUp } from '#ui/input-handlers/selection-tools.js';

// the ONE drag path of every cell (declared as data in the fixture header)
export const PATH = { shape: 'straight line from the grab point to the target', steps: 20, ms: 600, settleMs: 120, vectorFraction: 0.3 };
// the app's render loop (apps/sketchstudio/main.js loop(): engine.solve(SolverConfig.ITERATIONS || 500) every animation frame) runs between pointer events; it is what moves a
// BODY drag (the move handler's own solve passes the shape id as the spring joint; the frame solve auto-detects the first joint carrying joint.dragTarget). Frames per pointer move: 1
export const FRAMES_PER_MOVE = Number(process.env.DRAG_FRAMES || 1);
export const TOL_CM = 0.005;      // a point / radius that moved less than this "stayed" (0.5 px at 100 px/cm); ours is mm: x10
const R = (v) => Math.round(v * 10000) / 10000;

// ------------------------------------------------------------------------------------------------ the cells
const ln = (n, p0, p1) => ({ n, k: 'line', p: [p0, p1] });

function lineCells() {
  const out = [];
  for (const hold of ['free', 'H', 'len', 'fix0', 'fix0len', 'fixboth']) {
    const p = hold === 'H' ? [[0.3, 0.8], [2.0, 0.8]] : [[0.3, 0.4], [2.0, 1.2]];
    const len = Math.hypot(p[1][0] - p[0][0], p[1][1] - p[0][1]);
    const cons = [];
    if (hold === 'H') cons.push({ t: 'hv', e: 'A', d: 'H' });
    if (hold === 'len' || hold === 'fix0len') cons.push({ t: 'len', e: 'A', v: R(len) });
    if (hold === 'fix0' || hold === 'fix0len' || hold === 'fixboth') cons.push({ t: 'fix', pt: ['A', 0] });
    if (hold === 'fixboth') cons.push({ t: 'fix', pt: ['A', 1] });
    const u = [(p[1][0] - p[0][0]) / len, (p[1][1] - p[0][1]) / len];
    for (const target of ['end', 'mid']) out.push({ kind: 'line', hold, target, ents: [ln('A', p[0], p[1])], cons, size: len, axis: u, grab: target === 'end' ? { pt: ['A', 1] } : { body: 'A' }, from: target === 'end' ? p[1] : [(p[0][0] + p[1][0]) / 2, (p[0][1] + p[1][1]) / 2] });
  }
  return out;
}

function rectCells() {
  const out = [];
  const x0 = 0.3, y0 = 0.4, w = 1.7, h = 1.3;
  const c = [[x0, y0], [x0 + w, y0], [x0 + w, y0 + h], [x0, y0 + h]];
  const ents = [0, 1, 2, 3].map(i => ln('R' + i, c[i], c[(i + 1) % 4]));
  const base = [{ t: 'coinc', a: ['R0', 1], b: ['R1', 0] }, { t: 'coinc', a: ['R1', 1], b: ['R2', 0] }, { t: 'coinc', a: ['R2', 1], b: ['R3', 0] }, { t: 'coinc', a: ['R3', 1], b: ['R0', 0] },
    { t: 'hv', e: 'R0', d: 'H' }, { t: 'hv', e: 'R1', d: 'V' }, { t: 'hv', e: 'R2', d: 'H' }, { t: 'hv', e: 'R3', d: 'V' }];
  for (const hold of ['free', 'fix0', 'dims', 'fix0dims']) {
    const cons = base.slice();
    if (hold === 'dims' || hold === 'fix0dims') cons.push({ t: 'len', e: 'R0', v: w }, { t: 'len', e: 'R1', v: h });
    if (hold === 'fix0' || hold === 'fix0dims') cons.push({ t: 'fix', pt: ['R0', 0] });
    for (const target of ['corner', 'edge']) out.push({ kind: 'rect', hold, target, ents, cons, size: w, axis: [1, 0], grab: target === 'corner' ? { pt: ['R1', 1] } : { body: 'R0' }, from: target === 'corner' ? c[2] : [x0 + w / 2, y0] });
  }
  return out;
}

function circleCells() {
  const out = [];
  const c = [1.2, 1.1], r = 0.8;
  for (const hold of ['free', 'rad', 'fixc', 'fixcrad']) {
    const cons = [];
    if (hold === 'rad' || hold === 'fixcrad') cons.push({ t: 'rad', e: 'C', v: r });
    if (hold === 'fixc' || hold === 'fixcrad') cons.push({ t: 'fix', pt: ['C', 0] });
    for (const target of ['centre', 'rim']) out.push({ kind: 'circle', hold, target, ents: [{ n: 'C', k: 'circle', c, r }], cons, size: 2 * r, axis: [1, 0], grab: target === 'centre' ? { pt: ['C', 0] } : { body: 'C' }, from: target === 'centre' ? c : [c[0] + r, c[1]] });
  }
  return out;
}

function arcCells() {
  const out = [];
  const c = [1.2, 0.5], r = 0.9, a0 = 20 * Math.PI / 180, a1 = 160 * Math.PI / 180;
  const s = [R(c[0] + r * Math.cos(a0)), R(c[1] + r * Math.sin(a0))], e = [R(c[0] + r * Math.cos(a1)), R(c[1] + r * Math.sin(a1))];
  for (const hold of ['free', 'rad', 'fixc', 'fixcrad']) {
    const cons = [];
    if (hold === 'rad' || hold === 'fixcrad') cons.push({ t: 'rad', e: 'A', v: r });
    if (hold === 'fixc' || hold === 'fixcrad') cons.push({ t: 'fix', pt: ['A', 0] });
    for (const target of ['end', 'centre']) out.push({ kind: 'arc', hold, target, ents: [{ n: 'A', k: 'arc', c, s, e }], cons, size: 2 * r, axis: [1, 0], grab: { pt: ['A', target === 'end' ? 2 : 0] }, from: target === 'end' ? e : c });
  }
  return out;
}

function twoLineCells() {
  const out = [];
  const k = [0.4, 0.4], a = [2.0, 0.6], b = [0.8, 1.9];
  const la = Math.hypot(a[0] - k[0], a[1] - k[1]), lb = Math.hypot(b[0] - k[0], b[1] - k[1]);
  const ents = [ln('A', k, a), ln('B', k, b)];
  for (const hold of ['free', 'fixk', 'fixklens']) {
    const cons = [{ t: 'coinc', a: ['A', 0], b: ['B', 0] }];
    if (hold !== 'free') cons.push({ t: 'fix', pt: ['A', 0] });
    if (hold === 'fixklens') cons.push({ t: 'len', e: 'A', v: R(la) }, { t: 'len', e: 'B', v: R(lb) });
    for (const target of ['end', 'corner']) out.push({ kind: 'twolines', hold, target, ents, cons, size: la, axis: [(a[0] - k[0]) / la, (a[1] - k[1]) / la], grab: { pt: [target === 'end' ? 'A' : 'B', target === 'end' ? 1 : 0] }, from: target === 'end' ? a : k });
  }
  return out;
}

function tangentCells() {
  const out = [];
  const c = [1.1, 1.3], r = 0.7, y = c[1] - r;
  const ents = [ln('L', [0.2, y], [2.1, y]), { n: 'C', k: 'circle', c, r }];
  for (const hold of ['free', 'fixc', 'full']) {
    const cons = [{ t: 'tang', line: 'L', circle: 'C' }];
    if (hold === 'fixc' || hold === 'full') cons.push({ t: 'fix', pt: ['C', 0] });
    if (hold === 'full') cons.push({ t: 'rad', e: 'C', v: r }, { t: 'hv', e: 'L', d: 'H' }, { t: 'fix', pt: ['L', 0] });
    for (const target of ['lineend', 'rim']) out.push({ kind: 'tangent', hold, target, ents, cons, size: 1.9, axis: [1, 0], grab: target === 'lineend' ? { pt: ['L', 1] } : { body: 'C' }, from: target === 'lineend' ? [2.1, y] : [c[0] + r, c[1]] });
  }
  return out;
}

// corner on the ORIGIN: the cell sits at the real origin (only one such cell per sketch / copy): a line from the origin, a rectangle with a corner on it
function originCells() {
  const lineP = [[0, 0], [1.9, 0.6]], len = Math.hypot(1.9, 0.6);
  const rc = [[0, 0], [-1.6, 0], [-1.6, -1.2], [0, -1.2]];
  const rents = [0, 1, 2, 3].map(i => ln('R' + i, rc[i], rc[(i + 1) % 4]));
  const rbase = [{ t: 'coinc', a: ['R0', 1], b: ['R1', 0] }, { t: 'coinc', a: ['R1', 1], b: ['R2', 0] }, { t: 'coinc', a: ['R2', 1], b: ['R3', 0] }, { t: 'coinc', a: ['R3', 1], b: ['R0', 0] },
    { t: 'hv', e: 'R0', d: 'H' }, { t: 'hv', e: 'R1', d: 'V' }, { t: 'hv', e: 'R2', d: 'H' }, { t: 'hv', e: 'R3', d: 'V' }, { t: 'origin', pt: ['R0', 0] }];
  return [
    { kind: 'line', hold: 'origin', target: 'end', ents: [ln('A', ...lineP)], cons: [{ t: 'origin', pt: ['A', 0] }], size: len, axis: [1.9 / len, 0.6 / len], grab: { pt: ['A', 1] }, from: lineP[1], origin: true, slot: 'o0' },
    { kind: 'rect', hold: 'origin', target: 'corner', ents: rents, cons: rbase, size: 1.6, axis: [1, 0], grab: { pt: ['R1', 1] }, from: rc[2], origin: true, slot: 'o1' },
  ];
}

// vectors: along / across the shape's axis, diagonal; one size = vectorFraction of the shape size
function withVectors(cell) {
  const out = [];
  const a1 = cell.axis, a2 = [-a1[1], a1[0]], d = PATH.vectorFraction * cell.size;
  const vs = { along: [a1[0] * d, a1[1] * d], across: [a2[0] * d, a2[1] * d], diag: [(a1[0] + a2[0]) * d / Math.SQRT2, (a1[1] + a2[1]) * d / Math.SQRT2] };
  for (const [vn, v] of Object.entries(vs)) {
    const id = `${cell.kind}.${cell.hold}.${cell.target}.${vn}`;
    const c = { id, kind: cell.kind, hold: cell.hold, target: cell.target, vec: vn, ents: cell.ents, cons: cell.cons, grab: cell.grab, from: cell.from.map(R), to: [R(cell.from[0] + v[0]), R(cell.from[1] + v[1])] };
    if (cell.origin) c.origin = true;
    out.push(c);
  }
  return out;
}

export function buildCells() {
  const all = [...lineCells(), ...rectCells(), ...circleCells(), ...arcCells(), ...twoLineCells(), ...tangentCells(), ...originCells()];
  // the origin cells: only ONE vector each in the recording (one origin per sketch): along for the line, diag for the rectangle
  const cells = [];
  for (const c of all) for (const v of withVectors(c)) {
    if (c.origin && !((c.kind === 'line' && v.vec === 'along') || (c.kind === 'rect' && v.vec === 'diag'))) continue;
    cells.push(v);
  }
  return cells;
}

// ------------------------------------------------------------------------------------------------ the record (shared by Fusion and ours)
// snap = { A: { pts: [[x,y],...], r? } }; metrics = every length / radius that a constraint set could dimension
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
function metrics(cell, snap) {
  const m = {};
  for (const e of cell.ents) {
    if (e.k === 'line') m[e.n] = dist(snap[e.n].pts[0], snap[e.n].pts[1]);
    else if (e.k === 'circle') m[e.n] = snap[e.n].r;
    else if (e.k === 'arc') m[e.n] = dist(snap[e.n].pts[0], snap[e.n].pts[1]);
  }
  return m;
}
const dimmed = (cell) => new Set(cell.cons.filter(c => c.t === 'len' || c.t === 'rad').map(c => c.e));

// before / after: snaps in `unit` units (cm for Fusion, mm for ours: tol scales)
export function record(cell, before, after, unit = 1) {
  const tol = TOL_CM * unit;
  const names = cell.ents.map(e => e.n);
  const moved = names.map(n => n + ':' + before[n].pts.map((p, i) => (dist(p, after[n].pts[i]) > tol ? 'M' : '.')).join('') + (before[n].r != null ? (Math.abs(before[n].r - after[n].r) > tol ? 'r' : '.') : '')).join(' ');
  const anyMoved = /M|r/.test(moved);
  const g = cell.grab.pt ? after[cell.grab.pt[0]].pts[cell.grab.pt[1]] : null, g0 = cell.grab.pt ? before[cell.grab.pt[0]].pts[cell.grab.pt[1]] : null;
  const draggedMoved = cell.grab.pt ? dist(g, g0) > tol : anyMoved;
  // constraints / dimensions kept (checked on the AFTER geometry)
  const P = (r) => after[r[0]].pts[r[1]], P0 = (r) => before[r[0]].pts[r[1]];
  let kept = true; const broken = [];
  const bad = (what) => { kept = false; broken.push(what); };
  for (const c of cell.cons) {
    if (c.t === 'fix') { if (dist(P(c.pt), P0(c.pt)) > tol) bad('fix'); }
    else if (c.t === 'origin') { if (dist(P(c.pt), [0, 0]) > tol) bad('origin'); }
    else if (c.t === 'hv') { const p = after[c.e].pts; if (Math.abs(c.d === 'H' ? p[0][1] - p[1][1] : p[0][0] - p[1][0]) > tol) bad('hv'); }
    else if (c.t === 'coinc') { if (dist(P(c.a), P(c.b)) > tol) bad('coinc'); }
    else if (c.t === 'len') { if (Math.abs(dist(after[c.e].pts[0], after[c.e].pts[1]) - c.v * unit) > tol) bad('len'); }
    else if (c.t === 'rad') { const e = cell.ents.find(x => x.n === c.e); const rr = e.k === 'circle' ? after[c.e].r : dist(after[c.e].pts[0], after[c.e].pts[1]); if (Math.abs(rr - c.v * unit) > tol) bad('rad'); }
    else if (c.t === 'tang') { const l = after[c.line].pts; const ce = after[c.circle].pts[0]; const rr = after[c.circle].r; const dx = l[1][0] - l[0][0], dy = l[1][1] - l[0][1]; const d = Math.abs((ce[0] - l[0][0]) * dy - (ce[1] - l[0][1]) * dx) / Math.hypot(dx, dy); if (Math.abs(d - rr) > tol) bad('tang'); }
  }
  // arc: both rim points stay on one circle
  for (const e of cell.ents) if (e.k === 'arc') { const a = after[e.n].pts; if (Math.abs(dist(a[0], a[1]) - dist(a[0], a[2])) > tol) bad('arc-radii'); }
  // what changed shape: an UNdimensioned length / radius changed = stretch
  const m0 = metrics(cell, before), m1 = metrics(cell, after), dm = dimmed(cell);
  const stretched = Object.keys(m0).filter(n => Math.abs(m1[n] - m0[n]) > tol && !dm.has(n));
  let mode;
  if (!anyMoved) mode = 'none';
  else if (stretched.length) mode = 'stretch';
  else {
    const disp = []; for (const n of names) before[n].pts.forEach((p, i) => { const q = after[n].pts[i]; if (dist(p, q) > tol) disp.push([q[0] - p[0], q[1] - p[1]]); });
    const allSame = disp.every(d => dist(d, disp[0]) <= 2 * tol) && names.every(n => before[n].pts.every((p, i) => dist(p, after[n].pts[i]) > tol));
    mode = allSame ? 'translate' : 'rotate';
  }
  return { moved, draggedMoved, kept, broken: broken.join(','), mode };
}

// the class of a record: the qualitative outcome compared with Fusion
export const sig = (r) => `${r.moved} | dragged=${r.draggedMoved ? 'y' : 'n'} | kept=${r.kept ? 'y' : 'n'} | ${r.mode}`;

// ------------------------------------------------------------------------------------------------ ours: through the app's real pointer-drag path
const SVG = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 1000 }), viewBox: { baseVal: { x: 0, y: 0, width: 1000, height: 1000 } }, setPointerCapture: () => {}, releasePointerCapture: () => {} };
const OFF = 100;     // mm: the cell sits away from the (0,0) origin joint, except the origin cells
const muted = (f) => { const l = console.log, e = console.error, w = console.warn; console.log = () => {}; console.error = () => {}; console.warn = () => {}; try { return f(); } finally { console.log = l; console.error = e; console.warn = w; } };

export function runOurs(cell) {
  const S = L.newSketch(), st = S.state;
  const o = cell.origin ? [0, 0] : [OFF, OFF];
  const X = (p) => [p[0] * 10 + o[0], p[1] * 10 + o[1]];
  const built = {};
  for (const e of cell.ents) {
    if (e.k === 'line') { const a = L.point(S, ...X(e.p[0])), b = L.point(S, ...X(e.p[1])); built[e.n] = { k: 'line', shape: L.line(S, a, b), joints: [a, b] }; }
    else if (e.k === 'circle') { const c = L.circle(S, ...X(e.c), e.r * 10); built[e.n] = { k: 'circle', shape: c.id, joints: [c.c] }; }
    else if (e.k === 'arc') { const c = L.point(S, ...X(e.c)), s = L.point(S, ...X(e.s)), en = L.point(S, ...X(e.e)); built[e.n] = { k: 'arc', shape: L.arc(S, c, s, en), joints: [c, s, en] }; }
  }
  const J = (r) => built[r[0]].joints[r[1]];
  const pos = (id) => { const j = st.joints.get(id); return [j.x, j.y]; };
  const mk = (type, params) => ConstraintManager.createConstraint(st, type, params, { source: 'audit' });
  const lock = (ids) => { st.selectedJoints = new Set(ids); toggleFixedSelection(st); st.selectedJoints = new Set(); };
  const radiusOf = (n) => { const e = built[n]; return e.k === 'circle' ? L.shape(S, e.shape).radius : dist(pos(e.joints[0]), pos(e.joints[1])); };
  const refused = [];
  for (const c of cell.cons) {
    let ok = true;
    if (c.t === 'fix') lock([J(c.pt)]);
    else if (c.t === 'origin') ok = !!mk('coincident', { joints: [L.origin, J(c.pt)] });
    else if (c.t === 'hv') ok = !!mk(c.d === 'H' ? 'horizontal' : 'vertical', { joints: built[c.e].joints.slice(0, 2) });
    else if (c.t === 'coinc') ok = !!mk('coincident', { joints: [J(c.a), J(c.b)] });
    else if (c.t === 'len') ok = !!mk('distance', { joints: built[c.e].joints.slice(0, 2), value: c.v * 10, dimMode: 'aligned' });
    else if (c.t === 'rad') ok = !!mk('distance', { shape: built[c.e].shape, value: c.v * 10, isRadius: true });
    else if (c.t === 'tang') ok = !!mk('tangent', { line: built[c.line].shape, circle: built[c.circle].shape });
    if (!ok) refused.push(c.t);
  }
  muted(() => S.engine.solve(L.ITER));
  const snap = () => { const out = {}; for (const [n, e] of Object.entries(built)) { const d = { pts: e.joints.map(pos) }; if (e.k === 'circle') d.r = L.shape(S, e.shape).radius; if (e.k === 'arc') d.r = dist(pos(e.joints[0]), pos(e.joints[1])); out[n] = d; } return out; };
  const before = snap(), nC0 = st.constraints.length;
  // the real pointer sequence of a mouse drag: down on the entity, 20 moves along the straight path, up
  st.currentTool = 'select'; st.selectedJoints = new Set(); st.selectedShapes = new Set(); st.selectedConstraints = new Set();
  const A = X(cell.from), B = X(cell.to);
  const ev = (p) => ({ clientX: p[0], clientY: p[1], pointerId: 1, target: { closest: () => null, dataset: {} } });
  let started;
  muted(() => {
    if (cell.grab.pt) { const id = J(cell.grab.pt); started = handleSelectionPointerDown(ev(A), SVG, st, { id, j: st.joints.get(id) }, null, null); }
    else { const sh = L.shape(S, built[cell.grab.body].shape); started = handleSelectionPointerDown(ev(A), SVG, st, null, { shape: sh, pt: { x: A[0], y: A[1] } }, null); }
    const frame = () => { for (let k = 0; k < FRAMES_PER_MOVE; k++) S.engine.solve(SolverConfig.ITERATIONS || 500); };
    for (let i = 1; i <= PATH.steps; i++) { handleSelectionPointerMove(ev([A[0] + (B[0] - A[0]) * i / PATH.steps, A[1] + (B[1] - A[1]) * i / PATH.steps]), SVG, st); frame(); }
    handleSelectionPointerUp(ev(B), SVG, st); frame();
  });
  const after = snap();
  // the origin cells: the origin joint is part of the record only through the 'origin' constraint (compared against 0,0 in mm)
  const toCm = (s) => { const out = {}; for (const [n, d] of Object.entries(s)) out[n] = { pts: d.pts.map(p => [(p[0] - o[0]) / 10, (p[1] - o[1]) / 10]), ...(d.r != null ? { r: d.r / 10 } : {}) }; return out; };
  const rec = record(cell, toCm(before), toCm(after), 1);
  return { ...rec, started: !!started, refusedPrep: refused, addedConstraints: st.constraints.length - nC0, before: toCm(before), after: toCm(after) };
}

// ------------------------------------------------------------------------------------------------ comparing
// fx = the recorded Fusion answers. A cell was run TWICE in Fusion (copies a, b); two runs that differ in class = 'unstable' (not compared).
export function compareCell(cell, fx, oursCache) {
  const ra = fx.results[cell.id + '#a'], rb = fx.results[cell.id + '#b'];
  if (!ra || !rb || !Object.keys(ra.after).length || !Object.keys(rb.after).length) return { state: 'missing' };
  const a = record(cell, ra.before, ra.after), b = record(cell, rb.before, rb.after);
  if (sig(a) !== sig(b)) return { state: 'unstable', a, b };
  const o = (oursCache && oursCache.get(cell.id)) || runOurs(cell);
  if (oursCache) oursCache.set(cell.id, o);
  if (sig(a) === sig(o)) return { state: 'same', f: a, o };
  const word = (r) => (r.draggedMoved ? r.mode : 'none');
  return { state: 'diff', f: a, o, cls: `${cell.kind}.${cell.target}: ${word(a)} -> ${word(o)}${a.mode === o.mode ? ' (moved set)' : ''}` };
}
