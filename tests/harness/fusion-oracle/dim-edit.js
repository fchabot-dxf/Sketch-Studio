// TASK 528 -- FUSION AS AN ORACLE FOR EDITING A DIMENSION VALUE. A cell = one hold state of the graded grid (tests/harness/fusion-oracle/graded.js: the same builders,
// the same levels) + a dimension placed at its measured value + ONE edit of its value (grow x2, shrink x0.5, tiny, huge x20, zero, negative). Fusion's side is
// replayed by scripts/fusion-oracle/run-dim-edit.py (parameter.expression = the box); OUR side is commitDimensionEdit (packages/ui/dimension-seams.js), the one
// path the app uses when a value is typed. Everything here is DATA and pure node: nothing knows Fusion's API.
import * as L from '../audit/lib.js';
import { build } from '../coverage/matrix-build.js';
import { ConstraintManager } from '#core/constraint-manager.js';
import { commitDimensionEdit } from '#ui/dimension-seams.js';
import { perpendicularDistance } from '#core/geometry.js';
import { buildCells, materialize, applyLevel, TOL_F, TOL_O } from './graded.js';
import { serDoc } from './export.js';

export { TOL_F, TOL_O };
const ORIGIN = L.origin;
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// ---- edits: the new value of the dimension, from the value it was placed at (mm, or degrees for an angle)
export const EDITS = ['grow2', 'shrink05', 'tiny', 'huge20', 'zero', 'negative'];
export const EDIT_TEXT = { grow2: 'x2', shrink05: 'x0.5', tiny: '+1%', huge20: 'x20 (a neighbour may become impossible)', zero: 'to 0', negative: 'to minus the value' };
export function targetOf(isAngle, v, edit) {
  switch (edit) {
    case 'grow2': return isAngle ? Math.min(v * 2, 179) : v * 2;
    case 'shrink05': return v * 0.5;
    case 'tiny': return isAngle ? v + 0.5 : v * 1.01;
    case 'huge20': return isAngle ? 179 : v * 20;
    case 'zero': return 0;
    case 'negative': return -v;
  }
  throw new Error('unknown edit ' + edit);
}

// ---- the cell list. Dimension classes of the graded grid (every dimension mode of the Dimension tool but the point-to-line and the line-line, which the
// graded grid has no group for: they are added here), SAMPLED by a fixed stride so the list stays a few hundred runs (cells x EDITS).
const STRIDE = { 'dim-aligned': 5, 'dim-horizontal': 10, 'dim-vertical': 10, 'dim-angle': 4, 'dim-length': 1, 'dim-radius': 1 };
// point-to-line: [point operand kind, level, line level]; line-line: [level, level] of two parallel horizontal lines
const PT_LINE = [['P', '0', '0'], ['P', '0', '3'], ['P', '0', '4'], ['P', '0', '7'], ['P', '4', '0'], ['P', '4', '4'], ['P', '4', '7'], ['L', '0', '0'], ['L', '4', '4'], ['Z', '0', '0'], ['Z', '0', '4']];
const LINE_LINE = [['0', '0'], ['0', '4'], ['4', '0'], ['3', '4'], ['4', '7'], ['7', '7']];

export function dimEditCells() {
  const out = [];
  const seen = {};
  for (const c of buildCells()) {
    const s = STRIDE[c.group];
    if (!s) continue;
    const n = (seen[c.group] = (seen[c.group] || 0) + 1) - 1;
    if (n % s === 0) out.push({ ...c, dimClass: c.group });
  }
  for (const [k, la, lb] of PT_LINE) out.push({ id: `dim-point-line|${k}L|${la},${lb}`, group: 'dim-point-line', dimClass: 'dim-point-line', kinds: [k, 'L'], levels: [la, lb], extra: true });
  for (const [la, lb] of LINE_LINE) out.push({ id: `dim-line-line|LL|${la},${lb}`, group: 'dim-line-line', dimClass: 'dim-line-line', kinds: ['L', 'L'], levels: [la, lb], extra: true });
  return out;
}
export const classOf = (cell) => `${cell.group}|${cell.kinds.join('')}`;
export const jobId = (cell, edit) => `${cell.id}#${edit}`;

// ---- building one cell in OUR sketch (the dimension not yet placed)
function mkOperand(S, k, at, dir) {
  if (k === 'Z') return { k, shape: null, joints: [ORIGIN], jn: ORIGIN };
  const X = build(S, k, at[0], at[1], dir);
  return { ...X };
}
export function materializeCell(cell) {
  if (!cell.extra) return materialize(cell);
  const S = L.newSketch();
  const [ka, kb] = cell.kinds;
  let X, Y, act;
  if (cell.group === 'dim-point-line') {
    X = mkOperand(S, ka, [55, 55], [60, 15]); Y = mkOperand(S, kb, [20, 20], [100, 10]);
    if (!applyLevel(S, X, cell.levels[0]) && cell.levels[0] !== '0') return { na: 'level' };
    if (!applyLevel(S, Y, cell.levels[1])) return { na: 'level' };
    const lj = L.shape(S, Y.shape).joints;
    act = { type: 'distance', params: { joints: [X.jn, lj[0], lj[1]] } };
  } else {
    X = mkOperand(S, ka, [20, 20], [60, 0]); Y = mkOperand(S, kb, [30, 70], [60, 0]);
    if (!applyLevel(S, X, cell.levels[0])) return { na: 'level' };
    if (!applyLevel(S, Y, cell.levels[1])) return { na: 'level' };
    act = { type: 'distance', params: { shapes: [X.shape, Y.shape] } };
  }
  S.engine.solve(L.ITER);
  if (L.hasNaN(S)) return { na: 'NaN' };
  const J = (id) => { const j = S.state.joints.get(id); return j ? { x: j.x, y: j.y } : { x: 0, y: 0 }; };
  let measured;
  if (act.params.shapes) { const [s1, s2] = act.params.shapes.map(id => L.shape(S, id)); measured = Math.abs(perpendicularDistance(J(s2.joints[0]), J(s1.joints[0]), J(s1.joints[1]))); }
  else { const [p, a, b] = act.params.joints; measured = Math.abs(perpendicularDistance(J(p), J(a), J(b))); }
  const doc = serDoc(S, new Map());
  return { S, X, Y, doc, act: { ...act, dim: {} }, measured };
}

// ---- what the dimension measures on a set of coordinates (the same function for Fusion's and ours; the sign is dropped: a negative edit is judged by |value|)
export function dimEnds(M) {
  const p = M.act.params, S = M.S;
  if (p.isRadius) { const sh = L.shape(S, p.shape); return [{ n: 'radius', shapes: [p.shape], joints: [] }, { n: 'centre', shapes: [], joints: [sh.joints[0]] }]; }
  if (p.shapes) return p.shapes.map((id, i) => ({ n: 'line' + (i + 1), shapes: [id], joints: L.shape(S, id).joints.slice() }));
  if (p.joints.length === 3) return [{ n: 'point', shapes: [], joints: [p.joints[0]] }, { n: 'line', shapes: [], joints: [p.joints[1], p.joints[2]] }];
  return [{ n: 'a', shapes: [], joints: [p.joints[0]] }, { n: 'b', shapes: [], joints: [p.joints[1]] }];
}
export function measureOn(M, snap) {
  const p = M.act.params, S = M.S;
  const P = (id) => (id === ORIGIN ? [0, 0] : snap.pts[id]);
  if (p.isRadius) return snap.radii[p.shape];
  if (M.act.type === 'angle') {
    const [a, b] = p.shapes.map(id => L.shape(S, id).joints.map(P));
    const ang = (l) => Math.atan2(l[1][1] - l[0][1], l[1][0] - l[0][0]);
    let v = Math.abs((ang(a) - ang(b)) * 180 / Math.PI); if (v > 180) v = 360 - v; return v;
  }
  if (p.shapes) { const [s1, s2] = p.shapes.map(id => L.shape(S, id).joints.map(P)); return Math.abs(perpendicularDistance({ x: s2[0][0], y: s2[0][1] }, { x: s1[0][0], y: s1[0][1] }, { x: s1[1][0], y: s1[1][1] })); }
  if (p.joints.length === 3) { const [q, a, b] = p.joints.map(P); return Math.abs(perpendicularDistance({ x: q[0], y: q[1] }, { x: a[0], y: a[1] }, { x: b[0], y: b[1] })); }
  const [a, b] = p.joints.map(P);
  return p.dimMode === 'horizontal' ? Math.abs(b[0] - a[0]) : p.dimMode === 'vertical' ? Math.abs(b[1] - a[1]) : dist(a, b);
}

// the dimensions (distance / angle, driving) of the document, in the order serDoc numbers constraints: uid = position + 1
export function dimUids(S) {
  const list = S.state.constraints.filter(c => c && c.type !== 'mouse_spring');
  const o = [];
  list.forEach((c, i) => { if ((c.type === 'distance' || c.type === 'angle') && !L.isDriven(c)) o.push({ uid: i + 1, c }); });
  return o;
}

// ---- OUR side of one (cell, edit): place the dimension at its measured value (the tool), then type the new value (commitDimensionEdit)
const snapAll = (S) => { const pts = {}, radii = {}; for (const [id, j] of S.state.joints) pts[id] = [j.x, j.y]; for (const s of S.state.shapes) { if (s.type === 'circle') radii[s.id] = s.radius; else if (s.type === 'arc') radii[s.id] = dist(pts[s.joints[0]], pts[s.joints[1]]); } return { pts, radii }; };
export function oursEdit(cell, edit) {
  const M = materializeCell(cell);
  if (M.na) return { na: M.na };
  const { S, act, measured } = M;
  const isAngle = act.type === 'angle';
  const muted = (f) => { const e = console.error, w = console.warn; console.error = () => {}; console.warn = () => {}; try { return f(); } finally { console.error = e; console.warn = w; } };
  const dimsBefore = new Map(dimUids(S).map(d => [d.uid, d.c.value]));
  let c = null, r = null, before = null;
  const target = targetOf(isAngle, measured, edit);
  muted(() => {
    const created = ConstraintManager.createConstraint(S.state, act.type, { ...act.params, value: measured }, { source: 'dimension' });
    c = created && typeof created === 'object' ? created : null;
    if (c) before = snapAll(S);
    if (c && !L.isDriven(c)) r = commitDimensionEdit(S.state, c, target);
  });
  if (!c) return { M, accepted: false, target };
  const after = snapAll(S);
  const dimsAfter = {};
  for (const d of dimUids(S)) dimsAfter[d.uid] = d.c.value;
  return { M, accepted: true, driven: L.isDriven(c), target, before, refused: !!(r && r.reverted), reason: r ? (r.reason || r.clash || '') : '', after, value: c.value, dimsBefore: Object.fromEntries(dimsBefore), dimsAfter };
}
// ---- the comparison key of one run, from before / after coordinates keyed by joint id / shape id (Fusion's are mapped onto this build's ids by index)
export function keyOfRun(M, before, after, tol, info) {
  const ends = dimEnds(M);
  const endJoints = new Set(ends.flatMap(e => e.joints));
  const moved = [];
  for (const e of ends) {
    let m = e.joints.some(j => j !== ORIGIN && before.pts[j] && after.pts[j] && dist(before.pts[j], after.pts[j]) > tol);
    if (e.shapes.some(s => before.radii[s] != null && after.radii[s] != null && Math.abs(before.radii[s] - after.radii[s]) > tol)) m = true;
    if (m) moved.push(e.n);
  }
  let others = 0;
  for (const j of Object.keys(before.pts)) if (!endJoints.has(j) && j !== ORIGIN && after.pts[j] && dist(before.pts[j], after.pts[j]) > tol) others++;
  // radii of shapes that are not the dimension's own
  const own = new Set(ends.flatMap(e => e.shapes));
  for (const s of Object.keys(before.radii)) if (!own.has(s) && after.radii[s] != null && Math.abs(before.radii[s] - after.radii[s]) > tol) others++;
  const want = Math.abs(info.target);
  const reached = Math.abs(measureOn(M, after) - want) <= Math.max(1e-3, want * 1e-6);
  const dimsKept = Object.keys(info.dimsBefore || {}).every(u => info.dimsAfter[u] == null || Math.abs(info.dimsAfter[u] - info.dimsBefore[u]) <= 1e-4 * Math.max(1, Math.abs(info.dimsBefore[u])));
  return { moved: moved.length ? moved.join('+') : '.', others: others > 0, reached, dimsKept };
}
export const keyText = (k, refused) => (refused ? 'refused' : `moves ${k.moved}${k.others ? ' +others' : ''}${k.reached ? '' : ' (value not reached)'}${k.dimsKept ? '' : ' (another dimension changed)'}`);

// ---- Fusion's recorded answer vs ours for one run. fx = the stored record (positions by index). Returns { fusion, ours, same, note }.
const r6 = (v) => (typeof v === 'number' ? Math.round(v * 1e6) / 1e6 : v);
export function fusionRecord(rec, doc) {
  const jids = Object.keys(doc.joints).filter(j => j !== ORIGIN), sids = doc.shapes.map(s => s.id);
  const P = (m) => jids.map(j => (m.pts[j] || []).map(r6)), R = (m) => sids.map(s => (m.radii[s] == null ? null : r6(m.radii[s])));
  const o = { add: rec.add };
  if (rec.setupError) return { setupError: rec.setupError };
  if (rec.after) Object.assign(o, { before: { pts: P(rec.afterAdd), radii: R(rec.afterAdd) }, after: { pts: P(rec.after), radii: R(rec.after) }, valueAdd: rec.valueAdd, value: rec.value, health: rec.health, editError: rec.edit.error, dimsBefore: rec.dimsBefore, dimsAfter: rec.dimsAfter });
  return o;
}
export function compareRun(cell, edit, fx) {
  const o = oursEdit(cell, edit);
  if (o.na) return { na: o.na };
  const M = o.M;
  const jids = [...M.S.state.joints.keys()].filter(j => j !== ORIGIN), sids = M.S.state.shapes.map(s => s.id);
  const toMap = (snap) => { const pts = {}, radii = {}; jids.forEach((j, i) => { pts[j] = snap.pts[i]; }); sids.forEach((s, i) => { if (snap.radii[i] != null) radii[s] = snap.radii[i]; }); return { pts, radii }; };
  let fusion, ours, note = '';
  if (!fx.add.accepted) { fusion = 'not editable'; note = 'Fusion refuses the dimension: ' + (/OVER_CONSTRAINED/.test(fx.add.error) ? 'over-constrained' : 'duplicate'); }
  else if (fx.add.driving === false) fusion = 'not editable';
  else if (fx.health[0] !== 0 || fx.editError) fusion = 'refused';
  else fusion = keyText(keyOfRun(M, toMap(fx.before), toMap(fx.after), TOL_F, { target: o.target, dimsBefore: fx.dimsBefore, dimsAfter: fx.dimsAfter }), false);
  if (!o.accepted) { ours = 'not editable'; note += ' | ours refuses the dimension'; }
  else if (o.driven) { ours = 'not editable'; note += ' | ours places it as a reference'; }
  else if (o.refused) ours = 'refused';
  else ours = keyText(keyOfRun(M, o.before, o.after, TOL_O, { target: o.target, dimsBefore: o.dimsBefore, dimsAfter: o.dimsAfter }), false);
  const same = fusion === ours;
  return { fusion, ours, same, note, reason: o.reason };
}

// ---- classes of difference. A run that differs from Fusion belongs to the FIRST rule whose test holds; the KNOWN file lists, per rule, the runs (written by
// scripts/fusion-oracle/dim-edit-known.mjs). A run no rule explains is 'unclassified': the test fails on it.
const parse = (k) => {
  if (k === 'refused' || k === 'not editable') return { kind: k, moved: [], others: false };
  const m = /^moves (\S+?)( \+others)?( \(|$)/.exec(k);
  return { kind: 'moves', moved: m[1] === '.' ? [] : m[1].split('+'), others: !!m[2] };
};
export const RULES = [
  { id: 'negative-refused', reason: 'a negative value: Fusion accepts it (the dimension is signed, the geometry keeps or flips its side); ours refuses it and reverts', test: (c, e, f, o) => e === 'negative' && o.kind === 'refused' && f.kind === 'moves' },
  { id: 'negative-radius', reason: 'a negative radius: Fusion keeps the circle as it is (the parameter reads the negative value); ours stores a negative radius on the circle', test: (c, e, f, o, ot) => c === 'dim-radius' && e === 'negative' && f.kind === 'moves' && /value not reached/.test(ot) },
  { id: 'zero-refused', reason: 'a zero distance between two points: Fusion makes them coincide; ours refuses it (it would collapse a line to a point, task 521)', test: (c, e, f, o) => e === 'zero' && f.kind === 'moves' && o.kind === 'refused' },
  { id: 'zero-length', reason: 'a zero value: Fusion cannot solve it (the sketch goes to an error state, the geometry stays); ours accepts 0 for the edited dimension and collapses the length', test: (c, e, f, o) => e === 'zero' && f.kind === 'refused' && o.kind === 'moves' },
  { id: 'fusion-refuses-dimension', reason: 'Fusion refuses to place this dimension (the quantity is already determined: over-constrained); ours places it as a DRIVING dimension, so the edit moves nothing or is refused', test: (c, e, f, o) => f.kind === 'not editable' && o.kind !== 'not editable' },
  { id: 'ours-reference', reason: 'ours places this dimension as a reference (it counts the quantity as already determined: a zero distance to the origin) where Fusion places it driving and edits it', test: (c, e, f, o) => o.kind === 'not editable' && f.kind !== 'not editable' },
  // task 525: the cell's level setup now moves ONE operand (an H/V on a line moves its second end only), so OUR start geometry can differ from the one
  // Fusion recorded, and the target is twice OUR measured value: Fusion (health 0, it reached twice ITS measured value) then reads 'not reached'.
  { id: 'start-geometry', reason: 'RE-CHECK IN FUSION. Since task 525 our start geometry differs from the recorded one (the level setup moves one operand: an H/V on a line keeps its first end, e.g. line at y=20 where Fusion recorded y=27.5), so the target (twice OUR measured value) is not Fusion\'s: Fusion reached its own doubled value with health 0 (dim-aligned|LP|7,0#grow2: valueAdd 95.6883, value read back 191.3766, point moved (110,60) -> (200,92.5)) and reads \'value not reached\' here; ours reaches the target with every other constraint kept (on main ours fell short too, so these runs matched)', test: (c, e, f, o, ot, ft) => f.kind === 'moves' && o.kind === 'moves' && f.moved.join() === o.moved.join() && /value not reached/.test(ft) && !/value not reached/.test(ot) },
  { id: 'point-alone', reason: 'Fusion moves the picked end alone (its line stretches); ours moves it with its line (the who-moves placement translates the giving line). A point-alone body for H/V dimensions was tried in task 525 (315: 287 -> 299, graded: 1996 -> 2011, dim-edit 654 same) but re-opens N-F6 (a tangent circle flips sides on a dimension edit): needs the N-F6 branch lock first', test: (c, e, f, o) => f.kind === 'moves' && o.kind === 'moves' && f.moved.join() === o.moved.join() && !f.others && o.others },
  { id: 'angle-short', reason: 'an angle edited far (dim-angle|SS|0,0#huge20: two parallel polygon sides, 0 -> 179 degrees): ours turns the same side but its angle does not read the typed value (the angle row is satisfied modulo 180 degrees, so the stepped turn of the polygon can stop on the other branch); Fusion reaches it', test: (c, e, f, o, ot, ft) => c === 'dim-angle' && f.kind === 'moves' && o.kind === 'moves' && f.moved.join() === o.moved.join() && !/value not reached/.test(ft) && /value not reached/.test(ot) },
  { id: 'arc-centre', reason: 'arc radius: Fusion keeps the arc centre and moves the end points; ours moves the centre as well (least change over the whole arc)', test: (c, e, f, o) => c === 'dim-radius' && f.moved.join() === 'radius' && o.moved.includes('centre') },
  { id: 'both-operands', reason: 'Fusion moves ONE operand of the dimension (the second picked, or the one that is not held); ours spreads the change over both ends / both lines (least change)', test: (c, e, f, o) => f.kind === 'moves' && o.kind === 'moves' && f.moved.length === 1 && o.moved.length >= 2 },
  { id: 'neighbours', reason: 'same operand moves, but Fusion also moves the far end of the line / connected points (its solver minimises the movement of every free point); ours moves only the dimensioned point', test: (c, e, f, o) => f.kind === 'moves' && o.kind === 'moves' && f.moved.join() === o.moved.join() && f.others !== o.others },
  { id: 'other-operand', reason: 'a different operand moves than in Fusion', test: (c, e, f, o) => f.kind === 'moves' && o.kind === 'moves' && f.moved.join() !== o.moved.join() },
];
export function classifyDiff(dimClass, edit, fusion, ours) {
  const f = parse(fusion), o = parse(ours);
  const r = RULES.find(x => x.test(dimClass, edit, f, o, ours, fusion));
  return r ? r.id : 'unclassified';
}
