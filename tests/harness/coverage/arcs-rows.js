// TASK 531 -- extreme arcs, part B: the constraint / dimension ROWS an arc takes (DATA), the partner builders, and the cell runner.
// Every constraint is created through the REAL tool handler (matrix-run.js driveConstraintTool / driveDimensionTool, the real snap path for "point on arc",
// the real Lock toggle), every dimension edit through commitDimensionEdit, the end drag through the select tool's solver seam (prop-drag.js dragJoint),
// save / load through serializeDocument / deserializeDocument. It OBSERVES; it fixes nothing.
//
// A CELL = (arc variant, row, hold state). Hold states (the matrix's, applied by its own applyVariant where it applies):
//   sep     nothing shared, partner built near the arc          shared  the partner's own point is merged into the arc's START joint
//   locked  every joint of the arc locked (Lock button / F key) dimmed  the arc already carries a driving radius dimension
import * as L from '../audit/lib.js';
import { TOOL_MODES, CONSTRAINT_TYPES } from '#core/constants.js';
import { SolverConfig } from '#core/solver-config.js';
import { ConstraintManager } from '#core/constraint-manager.js';
import { addConstraint } from '#core/constraints.js';
import { deleteConstraints } from '#core/delete-manager.js';
import { applySnapConstraint } from '#core/snap-constraints.js';
import { serializeDocument, deserializeDocument } from '#core/document.js';
import { commitDimensionEdit } from '#ui/dimension-seams.js';
import { toggleFixedSelection } from '#ui/input-manager.js';
import { driveConstraintTool, driveDimensionTool, spy, spyOn, spyOff, selfSelection } from './matrix-run.js';
import { applyVariant, docOf } from './matrix-build.js';
import { oracleState } from './matrix-oracle.js';
import { dragJoint } from './prop-drag.js';
import { buildArc, arcByTool, measureArc } from './arcs-variants.js';

export const STATES = ['sep', 'shared', 'locked', 'dimmed'];
const eps = SolverConfig.VERIFIER_TOLERANCE;
const P = (S, id) => S.state.joints.get(id);
const rot = (v, a) => ({ x: v.x * Math.cos(a) - v.y * Math.sin(a), y: v.x * Math.sin(a) + v.y * Math.cos(a) });
const operand = (S, k, id) => ({ k, shape: id, joints: L.shape(S, id).joints.slice(), jn: L.shape(S, id).joints[0] });

// where things are: arc centre c, start s, end e, radius, unit radial u at the start, the outward tangent at the start, a size for partners
function frame(S, X) {
  const [c, s, e] = X.joints.map(id => P(S, id));
  const m = measureArc(S, X.shape), R = m.R;
  const u = { x: (s.x - c.x) / R, y: (s.y - c.y) / R };
  const travel = { x: -u.y * m.dir, y: u.x * m.dir };
  return { c, s, e, R, u, m, out: { x: -travel.x, y: -travel.y }, sz: Math.min(60, Math.max(8, R * 1.5)) };
}
const pt = (S, x, y) => L.point(S, x, y);

// partner builders: (S, X, F) -> operand. Positions are NEAR the arc, never already satisfying the constraint.
export const PARTNERS = {
  line: (S, X, F) => {   // a line starting beside the arc start, 25 degrees off the tangent
    const d = rot(F.out, 25 * Math.PI / 180), a = pt(S, F.s.x + F.u.x * 0.4 * F.sz, F.s.y + F.u.y * 0.4 * F.sz), b = pt(S, F.s.x + F.u.x * 0.4 * F.sz + d.x * F.sz, F.s.y + F.u.y * 0.4 * F.sz + d.y * F.sz);
    return { k: 'L', shape: L.line(S, a, b), joints: [a, b], jn: a };
  },
  arc: (S, X, F) => {    // an ordinary 30 degree arc starting EXACTLY at the arc start, its centre 15 degrees off the radial through the start (so not tangent yet)
    const Rb = Math.min(30, Math.max(5, F.R)), d = rot(F.u, 15 * Math.PI / 180);
    const c2 = { x: F.s.x + d.x * Rb, y: F.s.y + d.y * Rb };
    return arcByTool(S, c2.x, c2.y, Rb, 30, Math.atan2(F.s.y - c2.y, F.s.x - c2.x));
  },
  circle: (S, X, F) => {
    const Rc = Math.min(20, Math.max(5, F.R)), cx = F.c.x + F.u.x * (F.R + 1.3 * Rc), cy = F.c.y + F.u.y * (F.R + 1.3 * Rc), r = L.circle(S, cx, cy, Rc);
    return { k: 'O', shape: r.id, joints: [r.c], jn: r.c };
  },
  pointS: (S, X, F) => { const p = pt(S, F.s.x + F.u.x * 0.3 * F.sz, F.s.y + F.u.y * 0.3 * F.sz); return { k: 'P', shape: null, joints: [p], jn: p }; },
  pointE: (S, X, F) => { const ue = { x: (F.e.x - F.c.x) / F.R, y: (F.e.y - F.c.y) / F.R }, p = pt(S, F.e.x + ue.x * 0.3 * F.sz, F.e.y + ue.y * 0.3 * F.sz); return { k: 'P', shape: null, joints: [p], jn: p }; },
  pointMid: (S, X, F) => {   // near the chord midpoint
    const mx = (F.s.x + F.e.x) / 2, my = (F.s.y + F.e.y) / 2, ch = Math.hypot(F.e.x - F.s.x, F.e.y - F.s.y) || 1;
    const p = pt(S, mx - (F.e.y - F.s.y) / ch * 0.05 * F.sz, my + (F.e.x - F.s.x) / ch * 0.05 * F.sz);
    return { k: 'P', shape: null, joints: [p], jn: p };
  },
  pointArc: (S, X, F) => {   // 10% outside the arc, at the middle of its sweep
    const mu = rot(F.u, F.m.dir * F.m.span / 2), p = pt(S, F.c.x + mu.x * F.R * 1.1, F.c.y + mu.y * F.R * 1.1);
    return { k: 'P', shape: null, joints: [p], jn: p, onCircle: { x: F.c.x + mu.x * F.R, y: F.c.y + mu.y * F.R } };
  },
  pointOff: (S, X, F) => {   // 10% outside the CIRCLE, in the middle of the part the arc does NOT cover
    const mu = rot(F.u, F.m.dir * (F.m.span + (2 * Math.PI - F.m.span) / 2)), p = pt(S, F.c.x + mu.x * F.R * 1.1, F.c.y + mu.y * F.R * 1.1);
    return { k: 'P', shape: null, joints: [p], jn: p, onCircle: { x: F.c.x + mu.x * F.R, y: F.c.y + mu.y * F.R } };
  },
  chordLine: (S, X, F, row) => {  // returns the FREE line; the chord (a line through the arc's own two end joints) is operand Z
    const ch = Math.hypot(F.e.x - F.s.x, F.e.y - F.s.y) || 1, d = rot({ x: (F.e.x - F.s.x) / ch, y: (F.e.y - F.s.y) / ch }, (row.angle || 20) * Math.PI / 180);
    const a = pt(S, F.s.x + F.u.x * 0.8 * F.sz, F.s.y + F.u.y * 0.8 * F.sz), b = pt(S, F.s.x + F.u.x * 0.8 * F.sz + d.x * F.sz, F.s.y + F.u.y * 0.8 * F.sz + d.y * F.sz);
    return { k: 'L', shape: L.line(S, a, b), joints: [a, b], jn: a };
  },
};
const chordOf = (S, X) => { const id = L.line(S, X.joints[1], X.joints[2]); return { k: 'L', shape: id, joints: [X.joints[1], X.joints[2]], jn: X.joints[1] }; };

// ------------------------------------------------------------------------------------------------------------------ rows (DATA)
// kind: 'tool' constraint tool | 'dim' Dimension tool | 'snap' the snap path (point on arc) | 'lock' the Lock toggle
// partner: key of PARTNERS (or null); shared: true when a hold state 'shared' (partner point merged into the arc start) makes sense
// nominal: the DOF the row should remove (sep, ordinary arc)
const jt = (i) => (X) => ({ joint: X.joints[i] });   // 0 centre, 1 start, 2 end
const C = 0, Sx = 1, E = 2;
const H = TOOL_MODES.HORIZONTAL_VERTICAL;
const isHV = (c) => c.type === 'horizontal' || c.type === 'vertical';
export const ROWS = [
  { id: 'tangent-line', type: 'tangent', label: 'tangent: line and arc', kind: 'tool', tool: TOOL_MODES.TANGENT, partner: 'line', shared: true, nominal: 1, hits: (X, Y) => [{ shape: X }, { shape: Y }], produces: c => c.type === 'tangent' },
  { id: 'tangent-arc', type: 'tangent', label: 'tangent: arc and arc', kind: 'tool', tool: TOOL_MODES.TANGENT, partner: 'arc', shared: true, nominal: 1, hits: (X, Y) => [{ shape: X }, { shape: Y }], produces: c => c.type === 'tangent' },
  { id: 'tangent-circle', type: 'tangent', label: 'tangent: circle and arc', kind: 'tool', tool: TOOL_MODES.TANGENT, partner: 'circle', nominal: 1, hits: (X, Y) => [{ shape: X }, { shape: Y }], produces: c => c.type === 'tangent' },
  { id: 'coincident-start', type: 'coincident', label: 'coincident: arc start and a point', kind: 'tool', tool: TOOL_MODES.COINCIDENT, partner: 'pointS', nominal: 2, hits: (X, Y) => [jt(Sx)(X), { joint: Y.jn }], produces: c => c.type === 'coincident' },
  { id: 'coincident-end', type: 'coincident', label: 'coincident: arc end and a point', kind: 'tool', tool: TOOL_MODES.COINCIDENT, partner: 'pointE', nominal: 2, hits: (X, Y) => [jt(E)(X), { joint: Y.jn }], produces: c => c.type === 'coincident' },
  { id: 'coincident-centre', type: 'coincident', label: 'coincident: arc centre and a circle centre (concentric)', kind: 'tool', tool: TOOL_MODES.COINCIDENT, partner: 'circle', nominal: 2, hits: (X, Y) => [jt(C)(X), { joint: Y.jn }], produces: c => c.type === 'coincident' },
  { id: 'coincident-own-ends', type: 'coincident', label: 'coincident: the arc\'s own start and end (zero sweep; the arc already holds both at one radius, so 1 DOF)', kind: 'tool', tool: TOOL_MODES.COINCIDENT, partner: null, nominal: 1, own: true, hits: (X) => [jt(Sx)(X), jt(E)(X)], produces: c => c.type === 'coincident' },
  { id: 'point-on-arc', type: 'pointOnLine', label: 'point on arc (snap path), point inside the sweep', kind: 'snap', partner: 'pointArc', nominal: 1, produces: c => c.type === CONSTRAINT_TYPES.POINT_ON_LINE },
  { id: 'point-on-arc-off', type: 'pointOnLine', label: 'point on arc (snap path), point on the circle OUTSIDE the sweep', kind: 'snap', partner: 'pointOff', nominal: 1, produces: c => c.type === CONSTRAINT_TYPES.POINT_ON_LINE },
  { id: 'equal-arc', type: 'equal', label: 'equal: arc and arc', kind: 'tool', tool: TOOL_MODES.EQUAL, partner: 'arc', shared: true, nominal: 1, hits: (X, Y) => [{ shape: X }, { shape: Y }], produces: c => c.type === 'equal' },
  { id: 'equal-circle', type: 'equal', label: 'equal: arc and circle', kind: 'tool', tool: TOOL_MODES.EQUAL, partner: 'circle', nominal: 1, hits: (X, Y) => [{ shape: X }, { shape: Y }], produces: c => c.type === 'equal' },
  { id: 'midpoint-chord', type: 'midpoint', label: 'midpoint: a point on the middle of the chord (3 joints)', kind: 'tool', tool: TOOL_MODES.MIDPOINT, partner: 'pointMid', nominal: 2, hits: (X, Y) => [jt(Sx)(X), jt(E)(X), { joint: Y.jn }], produces: c => c.type === 'midpoint' },
  { id: 'hv-start-end', type: 'hv', label: 'horizontal or vertical (the tool decides): start and end', kind: 'tool', tool: H, partner: null, nominal: 1, hits: (X) => [jt(Sx)(X), jt(E)(X)], produces: isHV },
  { id: 'hv-centre-end', type: 'hv', label: 'horizontal or vertical (the tool decides): centre and end', kind: 'tool', tool: H, partner: null, nominal: 1, hits: (X) => [jt(C)(X), jt(E)(X)], produces: isHV },
  { id: 'hv-centre-start', type: 'hv', label: 'horizontal or vertical (the tool decides): centre and start', kind: 'tool', tool: H, partner: null, nominal: 1, hits: (X) => [jt(C)(X), jt(Sx)(X)], produces: isHV },
  { id: 'parallel-chord', type: 'parallel', label: 'parallel: the chord line (through the arc ends) and a free line', kind: 'tool', tool: TOOL_MODES.PARALLEL, partner: 'chordLine', chord: true, shared: true, nominal: 1, hits: (X, Y, Z) => [{ shape: Z }, { shape: Y }], produces: c => c.type === 'parallel' },
  { id: 'perpendicular-chord', type: 'perpendicular', angle: 110, label: 'perpendicular: the chord line and a free line', kind: 'tool', tool: TOOL_MODES.PERPENDICULAR, partner: 'chordLine', chord: true, shared: true, nominal: 1, hits: (X, Y, Z) => [{ shape: Z }, { shape: Y }], produces: c => c.type === 'perpendicular' },
  { id: 'collinear-chord', type: 'collinear', label: 'collinear: the chord line and a free line', kind: 'tool', tool: TOOL_MODES.COLLINEAR, partner: 'chordLine', chord: true, shared: true, nominal: 2, hits: (X, Y, Z) => [{ shape: Z }, { shape: Y }], produces: c => c.type === 'collinear' },
  { id: 'hv-chord-line', type: 'hv', label: 'horizontal or vertical (the tool decides): the chord line (line pick)', kind: 'tool', tool: H, partner: null, chord: true, nominal: 1, hits: (X, Y, Z) => [{ shape: Z }], produces: isHV },
  { id: 'dim-radius', type: 'distance', label: 'dimension: radius', kind: 'dim', mode: 'radius', partner: null, nominal: 1, hits: (X) => [{ shape: X }], produces: c => c.type === 'distance' && c.isRadius, edits: true },
  { id: 'dim-chord', type: 'distance', label: 'dimension: aligned, start to end (the chord)', kind: 'dim', mode: 'aligned', partner: null, nominal: 1, hits: (X) => [jt(Sx)(X), jt(E)(X)], produces: c => c.type === 'distance' && c.joints && c.joints.length === 2 && !c.isRadius, edits: true },
  { id: 'dim-centre-start', type: 'distance', label: 'dimension: aligned, centre to start', kind: 'dim', mode: 'aligned', partner: null, nominal: 1, hits: (X) => [jt(C)(X), jt(Sx)(X)], produces: c => c.type === 'distance' && c.joints && c.joints.length === 2 && !c.isRadius, edits: true },
  { id: 'dim-centre-end', type: 'distance', label: 'dimension: aligned, centre to end', kind: 'dim', mode: 'aligned', partner: null, nominal: 1, hits: (X) => [jt(C)(X), jt(E)(X)], produces: c => c.type === 'distance' && c.joints && c.joints.length === 2 && !c.isRadius, edits: true },
  { id: 'dim-h-chord', type: 'distance', label: 'dimension: horizontal, start to end', kind: 'dim', mode: 'horizontal', partner: null, nominal: 1, hits: (X) => [jt(Sx)(X), jt(E)(X)], produces: c => c.type === 'distance' && c.joints && c.joints.length === 2 && !c.isRadius, edits: true },
  { id: 'dim-v-chord', type: 'distance', label: 'dimension: vertical, start to end', kind: 'dim', mode: 'vertical', partner: null, nominal: 1, hits: (X) => [jt(Sx)(X), jt(E)(X)], produces: c => c.type === 'distance' && c.joints && c.joints.length === 2 && !c.isRadius, edits: true },
  { id: 'dim-h-centre-end', type: 'distance', label: 'dimension: horizontal, centre to end', kind: 'dim', mode: 'horizontal', partner: null, nominal: 1, hits: (X) => [jt(C)(X), jt(E)(X)], produces: c => c.type === 'distance' && c.joints && c.joints.length === 2 && !c.isRadius, edits: true },
  { id: 'dim-v-centre-end', type: 'distance', label: 'dimension: vertical, centre to end', kind: 'dim', mode: 'vertical', partner: null, nominal: 1, hits: (X) => [jt(C)(X), jt(E)(X)], produces: c => c.type === 'distance' && c.joints && c.joints.length === 2 && !c.isRadius, edits: true },
  { id: 'lock-start', label: 'lock (fix) the start joint', kind: 'lock', joints: [Sx], partner: null, nominal: 2 },
  { id: 'lock-end', label: 'lock (fix) the end joint', kind: 'lock', joints: [E], partner: null, nominal: 2 },
  { id: 'lock-centre', label: 'lock (fix) the centre joint', kind: 'lock', joints: [C], partner: null, nominal: 2 },
];

// ------------------------------------------------------------------------------------------------------------------ the arc checks
// Given the measure of the arc BEFORE (g0) and AFTER (g1) something, the arc-specific failure names. Only pathologies: an arc that
// is not an arc any more, flips to the other side of the circle, or is drawn wrongly. (Changes of size a constraint asks for are notes, not failures.)
export function arcIssues(g0, g1, prefix = '') {
  const out = [];
  const add = (n) => out.push(prefix + n);
  if (!g1.finite) { add('arc-nonfinite'); return out; }
  if (g1.chord < 1e-6 || g1.span < 1e-6) add('zero-sweep');
  if (!g1.pathOk) add('path-bad');
  if (Math.abs(g1.span - g0.span) > Math.PI) add('sweep-wrap');
  else if (g0.span > 1e-6 && g1.span < g0.span * 0.25 && g1.span >= 1e-6) add('sweep-shrunk');
  if (g1.R < g0.R * 1e-3 || g1.R < 1e-6) add('radius-collapse');
  else if (g1.R > g0.R * 1e3) add('radius-blowup');
  if (!g1.flagCoherent) add('stale-large-arc');
  if (Math.abs(g1.R - g1.Re) > 1e-3 * Math.max(g1.R, 1)) add('not-circular');
  return out;
}
const brief = (g) => ({ R: +g.R.toPrecision(6), Re: +g.Re.toPrecision(6), chord: +g.chord.toPrecision(4), signedDeg: +g.signedDeg.toFixed(4), cross: g.cross, flags: g.flagged ? `${g.largeArc ? 'L' : 's'}${g.sweepFlag ? '+' : '-'}` : 'none' });

function muteAll(fn) { const e = console.error, w = console.warn, d = console.debug, l = console.log; console.error = console.warn = console.debug = () => {}; try { return fn(); } finally { console.error = e; console.warn = w; console.debug = d; } void l; }

// ------------------------------------------------------------------------------------------------------------------ the cell
export async function runArcCell(row, v, state) {
  const rec = { row: row.id, variant: v.id, state, na: null, accepted: false, issues: [], notes: [], errors: [], g0: null, g1: null };
  const S = L.newSketch(), st = S.state;
  const X = buildArc(S, v);
  const F = frame(S, X);
  let Y = row.partner ? PARTNERS[row.partner](S, X, F, row) : null, Z = null;
  if (row.chord) Z = chordOf(S, X);
  // ---- hold state
  if (state === 'shared') {
    if (!row.shared || !Y) { rec.na = 'no second shape with a joint to share with the arc start'; return rec; }
    applyVariant(S, 'shared', X, Y);
    rec.notes.push('partner point merged into the arc start');
  } else if (state === 'locked') {
    if (row.kind === 'lock') { rec.na = 'the row is itself a lock'; return rec; }
    applyVariant(S, 'locked', X, Y);
  } else if (state === 'dimmed') {
    if (X.k === 'F') { rec.na = 'a fillet arc already carries its driving radius'; return rec; }
    if (row.id === 'dim-radius') { rec.na = 'the tool re-opens the existing radius dimension'; return rec; }
    const r = ConstraintManager.createConstraint(st, 'distance', { shape: X.shape, value: F.R, isRadius: true }, { source: 'audit' });
    if (!r) { rec.na = 'the radius dimension on the bare arc was refused'; return rec; }
  }
  S.engine.solve(L.ITER);
  const g0 = measureArc(S, X.shape);
  rec.g0 = brief(g0);
  rec.arcIssues0 = arcIssues(g0, g0, 'base-');     // the sketch itself must be a valid arc before the row is applied
  const nullity0 = L.nullity(S), fd0 = L.fdJacobian(S).nullity, or0 = await oracleState(S);
  const doc0 = docOf(S), nC0 = st.constraints.length, nJ0 = st.joints.size, snap0 = L.snapshot(S);
  // ---- the row, through the real path
  S.msgs.length = 0; spy.calls.length = 0; spyOn();
  let hits = null, snapRes = null;
  try {
    try {
      if (row.kind === 'lock') {
        st.selectedJoints = new Set(row.joints.map(i => X.joints[i])); toggleFixedSelection(st); st.selectedJoints = new Set();
      } else if (row.kind === 'snap') {
        const arcShape = L.shape(S, X.shape);
        snapRes = muteAll(() => applySnapConstraint(st, Y.jn, { type: 'shape', targetId: X.shape, shape: arcShape, pt: { ...Y.onCircle } }));
      } else {
        hits = row.hits(X, Y, Z);
        const why = row.kind === 'tool' ? selfSelection(S, row, hits) : null;
        if (why) rec.notes.push('matrix would call this N/A: ' + why);   // we drive the REAL tool anyway: what it does with it is the finding
        if (row.kind === 'dim') muteAll(() => driveDimensionTool(S, row, hits)); else muteAll(() => driveConstraintTool(S, row, hits));
      }
    } catch (e) { rec.threw = e.message; rec.issues.push('tool-threw'); rec.notes.push('threw: ' + String(e.message).slice(0, 120)); }
  } finally { spyOff(); }
  for (const m of S.msgs) for (const e of m.matchAll(L.ERR_RE)) rec.errors.push(e[1]);
  const added = st.constraints.slice(nC0).filter(c => c);
  const prod = row.produces ? added.filter(row.produces) : [];
  rec.accepted = row.kind === 'lock' ? row.joints.every(i => st.joints.get(X.joints[i]).fixed) : prod.length > 0;
  rec.driven = prod.some(L.isDriven);
  if (!rec.accepted) {
    if (L.hasNaN(S)) rec.issues.push('nan');
    const tried = spy.calls.filter(c => c.result === null && (row.type === 'hv' ? (c.type === 'horizontal' || c.type === 'vertical') : c.type === row.type));
    const rawType = tried[0] ? tried[0].type : null;
    if (tried.length) {   // refused: ask PlaneGCS whether the constraint was feasible
      const t = tried[0];
      let rawOk = false;
      try { rawOk = !!addConstraint(st, t.type, { ...t.params }); } catch (e) { rec.notes.push('raw add threw ' + e.message); }
      const o = await oracleState(S);
      rec.oracleFeasible = rawOk ? !(o.conflicting > 0 || o.status >= 2 || o.residual > 1e-3 || o.collapsed) : null;
      rec.oracleMapped = o.mapped;
      st.constraints.length = nC0 + added.length;
      if (rec.oracleFeasible && o.mapped) rec.issues.push('refused-feasible');
    } else if (!rec.threw && row.kind === 'tool' && !row.own) rec.issues.push('ui-refused-without-attempt');
    void rawType;
    rec.refusedCleanly = docOf(S) === doc0;
    if (!rec.refusedCleanly) rec.issues.push('refusal-changed-document');
    rec.g1 = rec.g0;
    return finish(rec);
  }
  // ---- accepted: measure
  const solved = S.engine.solve(L.ITER);
  rec.converged = solved.converged === true;
  rec.residual = L.residuals(S).max;
  rec.nan = L.hasNaN(S);
  const newJoints = st.joints.size - nJ0;
  rec.nullity = L.nullity(S); rec.delta = rec.nullity - nullity0;
  const fdr = L.fdJacobian(S);
  rec.fdDelta = fdr.nullity - fd0;
  { let mag = 1; for (const j of st.joints.values()) mag = Math.max(mag, Math.abs(j.x), Math.abs(j.y)); const thr = 1e-4 * Math.max(1, mag / 100); rec.jacobian = fdr.worst.filter(w => w.err > thr); }   // finite differences lose digits with the coordinate size (R = 5000)
  const or1 = await oracleState(S);
  rec.oracleMapped = or1.mapped && or0.mapped; rec.oracleDelta = or1.dof - or0.dof; rec.oracleConflict = or1.conflicting;
  rec.nominal = row.nominal;
  if (!rec.converged) rec.issues.push('no-converge');
  if (rec.nan) rec.issues.push('nan');
  if (!(rec.residual < eps)) rec.issues.push('residual');
  if (rec.delta !== rec.fdDelta) rec.issues.push('nullity!=fd');
  if (rec.oracleMapped && rec.delta !== rec.oracleDelta) rec.issues.push('nullity!=oracle');
  if (rec.oracleMapped && rec.oracleConflict > 0 && !rec.driven) rec.issues.push('accepted-conflict');
  if (rec.jacobian.length) { rec.issues.push('jacobian'); rec.notes.push('J!=fd ' + rec.jacobian.map(j => `${j.type} ${j.err.toExponential(1)}`).join(',')); }
  if (!rec.driven && state === 'sep' && X.k === 'A' && rec.delta !== -row.nominal && rec.delta === rec.fdDelta) rec.issues.push('nominal');
  const g1 = measureArc(S, X.shape);
  rec.g1 = brief(g1);
  rec.arcIssues = arcIssues(g0, g1);
  rec.factor = { R: +(g1.R / g0.R).toPrecision(4), span: +(g1.span / (g0.span || 1)).toPrecision(4) };
  // ---- jitter re-solve: still satisfied, still an arc, and (fully determined) back to the same pose
  const ref = L.snapshot(S), size = L.drawingSize(S);
  L.jitter(S, 11, 0.03, size);
  const rj = S.engine.solve(L.ITER);
  rec.biteResidual = L.residuals(S).max;
  if (!(rj.converged === true) || !(rec.biteResidual < eps)) rec.issues.push('bite');
  const gj = measureArc(S, X.shape);
  // a jitter moves every joint at random: an under-constrained arc legitimately ends up with another sweep, so only a DETERMINED arc is judged on its sweep
  rec.jitterIssues = rec.nullity === 0 ? arcIssues(g1, gj, 'jitter-') : arcIssues(g1, gj, 'jitter-').filter(i => /nonfinite|path-bad/.test(i));
  if (rec.nullity === 0 && L.maxDeviation(S, ref) > 1e-3) { rec.issues.push('pose-not-restored'); rec.notes.push('dev ' + L.maxDeviation(S, ref).toExponential(1)); }
  L.restore(S, ref); S.engine.solve(L.ITER);
  // ---- dimension edit x1.5 / x0.67 (every dimension row)
  rec.edits = {};
  const radiusDim = st.constraints.find(c => c && c.type === 'distance' && c.isRadius && c.shape === X.shape && !L.isDriven(c));
  const editTarget = row.edits ? prod[0] : radiusDim;
  if (editTarget && !L.isDriven(editTarget) && (row.edits ? !rec.driven : true)) {
    const c = editTarget;
    for (const f of [1.5, 0.67]) {
      const p0 = L.snapshot(S), v0 = c.value;
      const er = commitDimensionEdit(st, c, v0 * f);
      if (er.reverted) { rec.edits[f] = 'refused'; rec.notes.push(`edit x${f} refused: ${er.clash || er.reason || ''}`); }
      else {
        const ge = measureArc(S, X.shape), res = L.residuals(S).max;
        rec.edits[f] = { R: +ge.R.toPrecision(5), signedDeg: +ge.signedDeg.toFixed(3) };
        if (!(res < eps)) rec.issues.push(`edit${f}-residual`);
        for (const i of arcIssues(g1, ge, `edit${f}-`)) rec.issues.push(i);
        commitDimensionEdit(st, c, v0);
      }
      L.restore(S, p0); S.engine.solve(L.ITER);
    }
  }
  // ---- a small drag of the END joint through the select tool's solver seam
  {
    const id = X.joints[2], ref2 = L.snapshot(S), gb = measureArc(S, X.shape);
    muteAll(() => dragJoint(S, id, 2, 1.5));
    const gd = measureArc(S, X.shape);
    rec.dragIssues = arcIssues(gb, gd, 'drag-');
    rec.drag = { signedDeg: +gd.signedDeg.toFixed(3), R: +gd.R.toPrecision(5), locked: !!st.joints.get(id).fixed, moved: +Math.hypot(st.joints.get(id).x - ref2.get(id).x, st.joints.get(id).y - ref2.get(id).y).toFixed(4) };
    if (L.hasNaN(S)) rec.dragIssues.push('drag-nan');
    L.restore(S, ref2); S.engine.solve(L.ITER);
  }
  // ---- delete the constraint, undo: the document is identical
  if (row.kind !== 'lock') {
    const doc1 = docOf(S), nullityBefore = L.nullity(S);
    deleteConstraints(st, added);
    S.engine.solve(L.ITER);
    rec.nullityAfterDelete = L.nullity(S) - 2 * newJoints;
    if (rec.nullityAfterDelete !== nullity0) rec.issues.push('delete-nullity');
    st.undo(); S.engine.solve(L.ITER);
    if (docOf(S) !== doc1) rec.issues.push('undo-document');
    if (L.nullity(S) !== nullityBefore) rec.issues.push('undo-nullity');
  }
  // ---- save / load (LAST: newSketch() replaces the shared engine store). Flags, joints and the drawn arc survive.
  {
    const gs = measureArc(S, X.shape), raw = JSON.parse(JSON.stringify(serializeDocument(S.state)));
    const S2 = L.newSketch();
    const res = deserializeDocument(raw, S2.state);
    const sh2 = L.shape(S2, X.shape);
    if (!res.ok || !sh2) rec.issues.push('saveload-failed');
    else {
      const g2 = measureArc(S2, X.shape);
      rec.saveLoad = { flagsSame: g2.largeArc === gs.largeArc && g2.sweepFlag === gs.sweepFlag, spanDev: Math.abs(g2.span - gs.span), radiusDev: Math.abs(g2.R - gs.R) };
      if (!rec.saveLoad.flagsSame) rec.issues.push('saveload-flags');
      if (!(rec.saveLoad.spanDev < 1e-9) || !(rec.saveLoad.radiusDev < 1e-9)) rec.issues.push('saveload-geometry');
    }
  }
  void snap0;
  for (const i of rec.arcIssues) rec.issues.push(i);
  for (const i of rec.jitterIssues) rec.issues.push(i);
  for (const i of rec.dragIssues) rec.issues.push(i);
  return finish(rec);
}
function finish(rec) { if (rec.arcIssues0) for (const i of rec.arcIssues0) rec.issues.push(i); rec.pass = rec.issues.length === 0; return rec; }

// the grid
export async function runArcMatrix({ variants, rows = ROWS, states = STATES, only = null } = {}) {
  const cells = [];
  for (const v of variants) for (const row of rows) for (const state of states) {
    if (only && !only(v, row, state)) continue;
    let rec;
    try { rec = await runArcCell(row, v, state); }
    catch (e) { rec = { row: row.id, variant: v.id, state, na: null, accepted: false, issues: ['harness-threw:' + e.message.split('\n')[0]], notes: [e.stack.split('\n').slice(0, 3).join(' | ')], errors: [], pass: false }; }
    cells.push(rec);
  }
  return cells;
}
