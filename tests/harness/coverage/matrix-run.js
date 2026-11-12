// TASK 512 -- matrix harness, part B: the rows (constraint tools and dimension modes), the cell runner and the grid.
// Every constraint cell is driven through the REAL tool handler (handleConstraintPointerDown) and every dimension cell through the REAL Dimension tool
// (handleDimensionPointerDown + anchorPlacingDimension), with stubbed hits / svg: so "N/A by UI" is checked as the tool REFUSING that selection.
// A cell records: UI-allowed?, accepted or refused (+ERR code), converged, residual, nullity delta vs the expected removal, finite-difference nullity,
// PlaneGCS dof delta, bite (a jittered re-solve keeps the constraint), delete (nullity back) and undo (document identical).
import * as L from '../audit/lib.js';
import { TOOL_MODES } from '#core/constants.js';
import { SolverConfig } from '#core/solver-config.js';
import { ConstraintManager } from '#core/constraint-manager.js';
import { addConstraint } from '#core/constraints.js';
import { deleteConstraints } from '#core/delete-manager.js';
import { commitDimensionEdit } from '#ui/dimension-seams.js';
import { handleConstraintPointerDown, resetConstraintState } from '#ui/input-handlers/constraint-tools.js';
import { handleDimensionPointerDown, anchorPlacingDimension, resetDimensionState } from '#ui/input-handlers/dimension-tool.js';
import { KINDS, VARIANTS, lineLike, circleLike, build, applyVariant, docOf } from './matrix-build.js';
import { oracleState } from './matrix-oracle.js';
import { measureResidual } from '#core/constraint-verifier.js';

const svgStub = { viewBox: { baseVal: { x: 0, y: 0, width: 800, height: 800 } }, getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 800 }), innerHTML: '', setPointerCapture() {}, releasePointerCapture() {}, addEventListener() {}, removeEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; } };
const evt = (x, y) => ({ clientX: x, clientY: y, pointerType: 'mouse', pointerId: 1, target: { closest: () => null } });

// ------------------------------------------------------------------------------------------------------------------ rows
// arity: 1 = one operand (columns are the 8 kinds), 2 = two operands (columns are the 36 unordered kind pairs).
// ui(kx, ky): would the tool accept this selection? nominal(kx, ky): the DOF the constraint should remove (sep variant).
const both = (f) => (x, y) => f(x) && f(y);
const anyLine = (x, y) => lineLike(x) || lineLike(y);
export const ROWS = [
  { id: 'coincident', label: 'coincident', type: 'coincident', arity: 2, tool: TOOL_MODES.COINCIDENT, ui: () => true, nominal: () => 2, hits: (X, Y) => [{ joint: X.jn }, { joint: Y.jn }], produces: c => c.type === 'coincident' },
  { id: 'horizontal-2pt', label: 'horizontal (2 joints)', type: 'horizontal', arity: 2, tool: TOOL_MODES.HORIZONTAL_VERTICAL, ui: () => true, nominal: () => 1, layout: [170, 20], hits: (X, Y) => [{ joint: X.jn }, { joint: Y.jn }], produces: c => c.type === 'horizontal' },
  { id: 'vertical-2pt', label: 'vertical (2 joints)', type: 'vertical', arity: 2, tool: TOOL_MODES.HORIZONTAL_VERTICAL, ui: () => true, nominal: () => 1, layout: [20, 170], hits: (X, Y) => [{ joint: X.jn }, { joint: Y.jn }], produces: c => c.type === 'vertical' },
  { id: 'horizontal-line', label: 'horizontal (a line)', type: 'horizontal', arity: 1, tool: TOOL_MODES.HORIZONTAL_VERTICAL, ui: lineLike, nominal: () => 1, dir: [80, 20], hits: (X) => [{ shape: X }], produces: c => c.type === 'horizontal' },
  { id: 'vertical-line', label: 'vertical (a line)', type: 'vertical', arity: 1, tool: TOOL_MODES.HORIZONTAL_VERTICAL, ui: lineLike, nominal: () => 1, dir: [20, 80], hits: (X) => [{ shape: X }], produces: c => c.type === 'vertical' },
  { id: 'parallel', label: 'parallel', type: 'parallel', arity: 2, tool: TOOL_MODES.PARALLEL, ui: both(lineLike), nominal: () => 1, hits: (X, Y) => [{ shape: X }, { shape: Y }], produces: c => c.type === 'parallel' },
  { id: 'perpendicular', label: 'perpendicular', type: 'perpendicular', arity: 2, tool: TOOL_MODES.PERPENDICULAR, ui: both(lineLike), nominal: () => 1, hits: (X, Y) => [{ shape: X }, { shape: Y }], produces: c => c.type === 'perpendicular' },
  { id: 'collinear', label: 'collinear', type: 'collinear', arity: 2, tool: TOOL_MODES.COLLINEAR, ui: both(lineLike), nominal: () => 2, hits: (X, Y) => [{ shape: X }, { shape: Y }], produces: c => c.type === 'collinear' },
  { id: 'tangent', label: 'tangent', type: 'tangent', arity: 2, tool: TOOL_MODES.TANGENT, ui: (x, y) => (lineLike(x) && circleLike(y)) || (circleLike(x) && lineLike(y)) || (circleLike(x) && circleLike(y)), nominal: () => 1, hits: (X, Y) => [{ shape: X }, { shape: Y }], produces: c => c.type === 'tangent' },
  { id: 'equal', label: 'equal', type: 'equal', arity: 2, tool: TOOL_MODES.EQUAL, ui: (x, y) => (lineLike(x) && lineLike(y)) || (circleLike(x) && circleLike(y)),
    // two circles: the radius is shape data, not a DOF; two fillet arcs: each already carries a driving R
    nominal: (x, y) => (lineLike(x) ? 1 : ((x === 'O' && y === 'O') || (x === 'F' && y === 'F') ? 0 : 1)), hits: (X, Y) => [{ shape: X }, { shape: Y }], produces: c => c.type === 'equal' },
  { id: 'midpoint-line', label: 'midpoint (line + joint)', type: 'midpoint', arity: 2, tool: TOOL_MODES.MIDPOINT, ui: anyLine, nominal: () => 2,
    hits: (X, Y) => (lineLike(X.k) ? [{ shape: X }, { joint: Y.jn }] : [{ shape: Y }, { joint: X.jn }]), produces: c => c.type === 'midpoint' },
  { id: 'midpoint-3pt', label: 'midpoint (3 joints)', type: 'midpoint', arity: 2, tool: TOOL_MODES.MIDPOINT, ui: () => true, nominal: () => 2, extraPoint: true,
    hits: (X, Y, Z) => [{ joint: X.jn }, { joint: Y.jn }, { joint: Z.jn }], produces: c => c.type === 'midpoint' },
  // ---- dimensions (the Dimension tool)
  { id: 'dim-aligned', label: 'dim point-point aligned', type: 'distance', arity: 2, dim: true, mode: 'aligned', ui: () => true, nominal: () => 1, layout: [150, 90], produces: c => c.type === 'distance' && c.joints && c.joints.length === 2 && !c.isRadius },
  { id: 'dim-horizontal', label: 'dim point-point H', type: 'distance', arity: 2, dim: true, mode: 'horizontal', ui: () => true, nominal: () => 1, layout: [150, 90], produces: c => c.type === 'distance' && c.joints && c.joints.length === 2 && !c.isRadius },
  { id: 'dim-vertical', label: 'dim point-point V', type: 'distance', arity: 2, dim: true, mode: 'vertical', ui: () => true, nominal: () => 1, layout: [150, 90], produces: c => c.type === 'distance' && c.joints && c.joints.length === 2 && !c.isRadius },
  { id: 'dim-length', label: 'dim line length', type: 'distance', arity: 1, dim: true, mode: 'length', ui: lineLike, nominal: () => 1, produces: c => c.type === 'distance' && c.joints && c.joints.length === 2 && !c.isRadius },
  { id: 'dim-point-line', label: 'dim point to line', type: 'distance', arity: 2, dim: true, mode: 'pointline', ui: anyLine, nominal: () => 1, layout: [30, 90], produces: c => c.type === 'distance' && c.joints && c.joints.length === 2 && !c.isRadius },
  { id: 'dim-line-line', label: 'dim line to line (parallel)', type: 'distance', arity: 2, dim: true, mode: 'linesline', ui: both(lineLike), nominal: () => 1, parallel: true, layout: [30, 90], produces: c => c.type === 'distance' && c.shapes && c.shapes.length === 2 },
  { id: 'dim-line-line-yx', label: 'dim line to line (other pick order)', type: 'distance', arity: 2, dim: true, mode: 'linesline', swap: true, ui: both(lineLike), nominal: () => 1, parallel: true, layout: [30, 90], produces: c => c.type === 'distance' && c.shapes && c.shapes.length === 2 },
  { id: 'dim-angle-xy', label: 'dim angle (X then Y)', type: 'angle', arity: 2, dim: true, mode: 'angle', ui: both(lineLike), nominal: () => 1, layout: [120, 60], dir2: [30, 70], produces: c => c.type === 'angle' },
  { id: 'dim-angle-yx', label: 'dim angle (Y then X)', type: 'angle', arity: 2, dim: true, mode: 'angle', swap: true, ui: both(lineLike), nominal: () => 1, layout: [120, 60], dir2: [30, 70], produces: c => c.type === 'angle' },
  { id: 'dim-radius', label: 'dim radius', type: 'distance', arity: 1, dim: true, mode: 'radius', ui: circleLike, nominal: (x) => (x === 'O' ? 0 : x === 'F' ? 0 : 1), produces: c => c.type === 'distance' && c.isRadius },
];
// diameter: the label branch exists (svg-renderer.js) but no tool creates it -> not a cell, reported as "no creation path" (see the inventory)
export const NO_PATH_ROWS = ['dim-diameter'];

export function columnsFor(row) {
  const ks = KINDS.map(k => k.k);
  if (row.arity === 1) return ks.map(k => [k]);
  const out = [];
  for (let i = 0; i < ks.length; i++) for (let j = i; j < ks.length; j++) out.push([ks[i], ks[j]]);
  return out;
}

// ------------------------------------------------------------------------------------------------------------------ driving
function muted(fn) { const e = console.error, w = console.warn; console.error = () => {}; console.warn = () => {}; try { return fn(); } finally { console.error = e; console.warn = w; } }
const hitJ = (S, id) => ({ id, j: S.state.joints.get(id) });
const hitS = (S, op) => ({ shape: L.shape(S, op.shape) });
const sh = (S, h) => (h.shape && h.shape.shape ? hitS(S, h.shape) : null);
const posOf = (S, id) => S.state.joints.get(id);

function driveConstraintTool(S, row, hits) {
  const st = S.state;
  st.currentTool = row.tool; st.pendingConstraint = null;
  const rets = [];
  muted(() => { for (const h of hits) rets.push(handleConstraintPointerDown(null, null, st, h.joint ? hitJ(S, h.joint) : null, sh(S, h), null)); });
  resetConstraintState(st);
  return rets;
}
function wForMode(S, mode, A, B) {
  const dx = B.x - A.x, dy = B.y - A.y, len = Math.hypot(dx, dy) || 1;
  if (mode === 'aligned') return { x: (A.x + B.x) / 2 - dy / len * 30, y: (A.y + B.y) / 2 + dx / len * 30 };            // inside the perpendicular band
  if (mode === 'horizontal') return { x: B.x, y: B.y + 50 * Math.sign(dy || 1) };                                         // past B, pulled along y
  if (mode === 'vertical') return { x: B.x + 50 * Math.sign(dx || 1), y: B.y };                                           // past B, pulled along x
  return { x: B.x, y: B.y };
}
function driveDimensionTool(S, row, hits) {
  const st = S.state;
  st.currentTool = TOOL_MODES.DIMENSION;
  resetDimensionState(st);
  const rets = [];
  const click = (x, y, hJ, hS) => muted(() => rets.push(handleDimensionPointerDown(evt(x, y), svgStub, st, hJ, hS, null)));
  const pos = (h) => (h.joint ? posOf(S, h.joint) : (() => { const s = h.shape.shape ? L.shape(S, h.shape.shape) : { joints: [h.shape.jn] }; const a = posOf(S, s.joints[0]), b = posOf(S, s.joints[1] || s.joints[0]); return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - 25 }; })());
  const mk = (h) => [h.joint ? hitJ(S, h.joint) : null, sh(S, h)];
  if (row.mode === 'aligned' || row.mode === 'horizontal' || row.mode === 'vertical') {
    const A = posOf(S, hits[0].joint), B = posOf(S, hits[1].joint);
    click(A.x, A.y, ...mk(hits[0]));
    const w = wForMode(S, row.mode, A, B);
    click(w.x, w.y, ...mk(hits[1]));
  } else {
    hits.forEach((h, i) => { const p = pos(h); click(p.x, p.y, ...mk(h)); });
  }
  muted(() => anchorPlacingDimension(svgStub, st));
  resetDimensionState(st);
  return rets;
}

// ------------------------------------------------------------------------------------------------------------------ the cell
const eps = SolverConfig.VERIFIER_TOLERANCE;   // the app's own definition of 'satisfied' (0.001); residuals are in the verifier's units
export const spy = { calls: [], orig: null };
function spyOn() { if (spy.orig) return; spy.orig = ConstraintManager.createConstraint; ConstraintManager.createConstraint = function (state, type, params, opts) { const r = spy.orig.call(this, state, type, params, opts); spy.calls.push({ type, params: { ...params }, result: r }); return r; }; }
function spyOff() { if (spy.orig) { ConstraintManager.createConstraint = spy.orig; spy.orig = null; } }

const fdNull = (S) => L.fdJacobian(S);

// run one cell. cols = [kx] or [kx, ky]; variant in VARIANTS. Returns the record.
export async function runCell(row, cols, variant) {
  const rec = { row: row.id, cols: cols.join(''), variant, na: null, ui: !!row.ui(cols[0], cols[1] || cols[0]), accepted: false, driven: false, issues: [], notes: [], errors: [] };
  const S = L.newSketch();
  const st = S.state;
  const [kx, ky] = cols;
  const lay = row.layout || [150, 20];
  const X = build(S, kx, 100, 100, row.dir || [60, 20]);
  let Y = null, Z = null;
  if (ky) {
    let dir = row.dir2 || (row.parallel ? (lineLike(kx) ? [st.joints.get(X.joints[1]).x - st.joints.get(X.joints[0]).x, st.joints.get(X.joints[1]).y - st.joints.get(X.joints[0]).y] : [60, 20]) : [60, 20]);
    if (row.id.startsWith('dim-angle')) dir = row.dir2;
    Y = build(S, ky, 100 + lay[0], 100 + lay[1], dir);
    if (row.parallel && ky === 'S' && kx === 'S') { /* two polygons built with the same orientation: their first sides are parallel */ }
  }
  if (row.extraPoint) {
    const A = st.joints.get(X.jn), B = st.joints.get(Y.jn);
    Z = build(S, 'P', (A.x + B.x) / 2 + 3, (A.y + B.y) / 2 - 2);
  }
  const v = applyVariant(S, variant, X, Y);
  if (v.na) { rec.na = v.na; return rec; }
  rec.notes.push(v.note);
  // a polygon-side pair for the parallel rows: ensure it really is parallel, otherwise the Dimension tool would have offered an angle
  if (row.parallel && lineLike(kx) && lineLike(ky)) {
    const dirOf = (o) => { const a = st.joints.get(o.joints[0]), b = st.joints.get(o.joints[1]); return [b.x - a.x, b.y - a.y]; };
    const d1 = dirOf(X), d2 = dirOf(Y);
    if (Math.abs(d1[0] * d2[1] - d1[1] * d2[0]) > 1e-6 * Math.hypot(...d1) * Math.hypot(...d2)) { rec.na = 'not parallel by construction (the tool would offer an angle)'; return rec; }
  }
  S.engine.solve(L.ITER);
  const nullity0 = L.nullity(S), fd0 = fdNull(S).nullity;
  const or0 = await oracleState(S);
  const doc0 = docOf(S);
  const nC0 = st.constraints.length, nJ0 = st.joints.size;
  const snap0 = L.snapshot(S);
  S.msgs.length = 0; spy.calls.length = 0; spyOn();
  let hits;
  try {
    hits = row.dim ? dimHits(S, row, X, Y) : row.hits(X, Y, Z);
    if (rec.ui) { const why = selfSelection(S, row, hits); if (why && why.startsWith('degenerate')) { rec.na = why; spyOff(); return rec; }
      if (why) { rec.ui = false; rec.notes.push('UI refuses: ' + why); } }
    try { if (row.dim) driveDimensionTool(S, row, hits); else driveConstraintTool(S, row, hits); }
    catch (e) { rec.threw = e.message; rec.issues.push('tool-threw'); rec.notes.push('threw: ' + String(e.message).slice(0, 120)); }
  } finally { spyOff(); }
  for (const m of S.msgs) for (const e of m.matchAll(L.ERR_RE)) rec.errors.push(e[1]);
  const added = st.constraints.slice(nC0).filter(c => c);
  const prod = added.filter(row.produces);
  rec.accepted = prod.length > 0;
  rec.driven = prod.some(L.isDriven);
  if (!rec.accepted && [...added, ...spy.calls].some(c => (row.id.startsWith('horizontal') && c.type === 'vertical') || (row.id.startsWith('vertical') && c.type === 'horizontal'))) { rec.na = 'the tool picked the other orientation (it decides H or V from the geometry)'; return rec; }
  if (!rec.accepted && row.id.startsWith('dim-angle') && added.some(c => c.type === 'distance' && c.shapes)) { rec.na = 'the lines are parallel: the tool offers a line-line distance, not an angle'; return rec; }
  if (!rec.accepted && row.id === 'dim-radius' && st.constraints.some(c => c && c.isRadius && c.shape === X.shape)) { rec.ui = false; rec.notes.push('UI: a radius dimension already exists on this shape; the tool re-opens it instead of adding a second'); }
  if (!rec.accepted) {
    // refused. Allowed by the UI -> was the refusal right? Ask PlaneGCS whether the constraint is feasible (raw add of what the tool tried to create).
    if (st.constraints.length !== nC0 + added.length || L.hasNaN(S)) rec.issues.push('nan');
    const tried = spy.calls.filter(c => c.result === null && c.type === row.type);
    if (rec.ui) {
      if (tried.length) {
        const t = tried[0];
        const rawDoc = docOf(S);
        let rawOk = false;
        try { rawOk = !!addConstraint(st, t.type, { ...t.params }); } catch (e) { rec.notes.push('raw add threw ' + e.message); }
        const o = await oracleState(S);
        rec.oracleFeasible = rawOk ? !(o.conflicting > 0 || o.status >= 2 || o.residual > 1e-3 || o.collapsed) : null;
        if (!rawOk) rec.notes.push('the constraint cannot even be stored (addConstraint refuses): no oracle verdict');
        rec.oracleMapped = o.mapped;
        // restore
        st.constraints.length = nC0 + added.length;
        if (rec.oracleFeasible && o.mapped) rec.issues.push('refused-feasible');
      } else rec.issues.push('ui-refused-without-attempt');
    }
    rec.refusedCleanly = docOf(S) === doc0;
    if (!rec.refusedCleanly) { rec.issues.push('refusal-changed-document'); rec.notes.push(docDiff(docOf(S), doc0)); }
    if (!rec.ui && rec.accepted) rec.issues.push('ui-should-refuse');
    return finish(rec);
  }
  if (!rec.ui) rec.issues.push('ui-should-refuse');
  // ---- accepted: measure
  const solved = S.engine.solve(L.ITER);
  rec.converged = solved.converged === true;
  rec.residual = L.residuals(S).max;
  rec.nan = L.hasNaN(S);
  const newJoints = st.joints.size - nJ0;
  rec.nullity = L.nullity(S);
  rec.delta = rec.nullity - nullity0;
  const fdr = fdNull(S);
  rec.fdDelta = fdr.nullity - fd0;
  rec.jacobian = fdr.worst;
  const or1 = await oracleState(S);
  rec.oracleMapped = or1.mapped && or0.mapped;
  rec.oracleDelta = or1.dof - or0.dof;
  rec.oracleConflict = or1.conflicting;
  rec.nominal = row.nominal(kx, ky || kx);
  if (rec.driven) rec.notes.push((prod[0].drivenReason || 'reference').slice(0, 60));
  // ---- verdicts
  const drivingExpected = !(row.id === 'dim-radius' && kx === 'F');   // a fillet arc already carries its driving R
  if (rec.driven && drivingExpected) {
    const why = String(prod[0].drivenReason || '');
    const f1 = /edge already has a driving dimension/.test(why) && (row.mode === 'horizontal' || row.mode === 'vertical') && variant === 'dimmed';   // an H/V dimension beside an aligned one is NOT a duplicate
    const angleRef = row.id.startsWith('dim-angle') || row.mode === 'linesline';
    if (f1 || (!/already|redundant|determined|fixed/i.test(why) && variant === 'sep')) rec.issues.push('demoted');
    else if (angleRef && variant === 'sep') rec.issues.push('demoted');
    else rec.notes.push('reference: ' + why.slice(0, 50));
  }
  if (!rec.converged) rec.issues.push('no-converge');
  if (rec.nan) rec.issues.push('nan');
  if (!(rec.residual < eps)) rec.issues.push('residual');
  if (row.dim && !rec.driven) { rec.moved = L.maxDeviation(S, snap0); if (!(rec.moved < 1e-3)) rec.issues.push('dim-moved-geometry'); }   // a dimension placed at its measured value must leave the drawing alone
  if (rec.delta !== rec.fdDelta) rec.issues.push('nullity!=fd');
  if (rec.oracleMapped && rec.delta !== rec.oracleDelta) rec.issues.push('nullity!=oracle');
  if (rec.oracleMapped && rec.oracleConflict > 0 && !rec.driven) rec.issues.push('accepted-conflict');
  if (rec.nominal != null && !rec.driven && rec.delta !== -rec.nominal) {   // nominal is set for the sep variant only
    if ((variant !== 'sep' || kx === 'R' || ky === 'R' || (kx === 'F' && ky === 'F')) && rec.delta === rec.fdDelta && (!rec.oracleMapped || rec.delta === rec.oracleDelta) && rec.delta > -rec.nominal) rec.notes.push(`implied: removes ${-rec.delta} of ${rec.nominal}`);
    else rec.issues.push('nominal');
  }
  if (row.dim && prod[0] && row.mode !== 'linesline' && row.mode !== 'angle' && row.mode !== 'radius' && row.mode !== 'length' && row.mode !== 'pointline') {
    const dm = prod[0].dimMode;
    if (dm !== row.mode) { if (dm === 'aligned' && (row.mode === 'horizontal' || row.mode === 'vertical')) { rec.na = 'near-axis pair: the tool keeps these aligned (H/V would be redundant)'; return rec; } rec.issues.push('dimmode:' + dm); }
  }
  // ---- bite: a jittered re-solve keeps every driving constraint satisfied
  const ref = L.snapshot(S);
  L.jitter(S, 11, 0.03, L.drawingSize(S));
  const rj = S.engine.solve(L.ITER);
  rec.biteResidual = L.residuals(S).max;
  if (!(rj.converged === true) || !(rec.biteResidual < eps)) rec.issues.push('bite');
  if (row.id === 'equal' && (circleLike(kx))) {   // the radii must really follow each other
    const [s1, s2] = [L.shape(S, X.shape), L.shape(S, Y.shape)];
    const rad = (s) => (typeof s.radius === 'number' ? s.radius : Math.hypot(st.joints.get(s.joints[1]).x - st.joints.get(s.joints[0]).x, st.joints.get(s.joints[1]).y - st.joints.get(s.joints[0]).y));
    if (Math.abs(rad(s1) - rad(s2)) > 1e-3) { rec.issues.push('equal-radius-not-solved'); rec.notes.push(`radii ${rad(s1).toFixed(2)} / ${rad(s2).toFixed(2)}`); }
  }
  L.restore(S, ref); S.engine.solve(L.ITER);
  // ---- edit a driving dimension 1.25x (the numeric input path)
  if (row.dim && !rec.driven && prod[0] && typeof prod[0].value === 'number' && prod[0].value > 0 && !prod[0].isRadius) {
    const c = prod[0], v0 = c.value, p0 = L.snapshot(S);
    const er = commitDimensionEdit(st, c, v0 * 1.25);
    rec.edit = er.reverted ? 'refused' : 'ok';
    if (!er.reverted) { rec.editResidual = L.residuals(S).max; if (!(rec.editResidual < eps)) rec.issues.push('edit-residual'); commitDimensionEdit(st, c, v0); }
    else rec.notes.push('edit x1.25 refused: ' + (er.clash || er.reason || ''));
    if (er.reverted && variant === 'sep') rec.issues.push('edit-refused');
    L.restore(S, p0); S.engine.solve(L.ITER);
  }
  // ---- delete: nullity returns to the baseline; undo: the document is identical
  const doc1 = docOf(S);
  const nullityBeforeDelete = L.nullity(S);
  deleteConstraints(st, added);
  S.engine.solve(L.ITER);
  rec.nullityAfterDelete = L.nullity(S) - 2 * newJoints;   // the helper joint of a point-line dimension stays behind, free
  if (rec.nullityAfterDelete !== nullity0) rec.issues.push('delete-nullity');
  st.undo();
  S.engine.solve(L.ITER);
  rec.undoIdentical = docOf(S) === doc1 || sameDoc(docOf(S), doc1);
  if (!rec.undoIdentical) { rec.issues.push('undo-document'); rec.notes.push(docDiff(docOf(S), doc1)); if (process.env.DBGDOC) { const a = JSON.parse(docOf(S)), b = JSON.parse(doc1); console.log(JSON.stringify(a.constraints.slice(-1))); console.log(JSON.stringify(b.constraints.slice(-1))); console.log(a.joints.length, b.joints.length, JSON.stringify(a.shapes) === JSON.stringify(b.shapes)); } }
  if (L.nullity(S) !== nullityBeforeDelete) rec.issues.push('undo-nullity');
  return finish(rec);
}
function sameDoc(a, b) { return a === b; }
export function docDiff(a, b) {
  const A = JSON.parse(a), B = JSON.parse(b), out = [];
  if (A.joints.length !== B.joints.length) out.push(`joints ${A.joints.length} vs ${B.joints.length}`);
  A.joints.forEach((j, i) => { const k = B.joints[i]; if (k && JSON.stringify(j) !== JSON.stringify(k)) out.push(`joint ${j[0]}: ${JSON.stringify(j.slice(1))} vs ${JSON.stringify(k.slice(1))}`); });
  if (JSON.stringify(A.shapes) !== JSON.stringify(B.shapes)) out.push('shapes differ');
  if (A.constraints.length !== B.constraints.length) out.push(`constraints ${A.constraints.length} vs ${B.constraints.length}`);
  A.constraints.forEach((c, i) => { const k = B.constraints[i]; if (k && JSON.stringify(c) !== JSON.stringify(k)) out.push(`constraint ${i}: ${JSON.stringify(c)} vs ${JSON.stringify(k)}`); });
  return out.slice(0, 3).join(' ;; ').slice(0, 400);
}
function finish(rec) { rec.pass = rec.issues.length === 0; return rec; }

// selections the tool refuses by its own rule (not a solver matter): the same joint twice, or a joint on the line it is paired with
function selfSelection(S, row, hits) {
  const js = hits.filter(h => h.joint).map(h => h.joint);
  if (new Set(js).size < js.length) return 'the same joint picked twice (self-click)';
  if (row.type === 'coincident' && js.length === 2 && S.state.shapes.some(sh => sh.joints && sh.joints.includes(js[0]) && sh.joints.includes(js[1]))) return 'degenerate: both joints belong to one shape (coincident would collapse it)';
  const line = hits.find(h => h.shape && h.shape.shape && L.shape(S, h.shape.shape) && L.shape(S, h.shape.shape).type === 'line');
  if (line && js.length === 1 && L.shape(S, line.shape.shape).joints.includes(js[0])) return 'the joint is an end of the line it is paired with';
  return null;
}
function dimHits(S, row, X, Y) {
  const m = row.mode;
  if (m === 'aligned' || m === 'horizontal' || m === 'vertical') return [{ joint: X.jn }, { joint: Y.jn }];
  if (m === 'length' || m === 'radius') return [{ shape: X }];
  if (m === 'pointline') return lineLike(X.k) ? [{ joint: Y.jn }, { shape: X }] : [{ joint: X.jn }, { shape: Y }];
  if (m === 'linesline' || m === 'angle') return row.swap ? [{ shape: Y }, { shape: X }] : [{ shape: X }, { shape: Y }];
  throw new Error('mode ' + m);
}

// ------------------------------------------------------------------------------------------------------------------ the grid
export async function runMatrix({ rows = ROWS, variants = VARIANTS, only = null } = {}) {
  const cells = [];
  for (const row of rows) for (const cols of columnsFor(row)) for (const variant of variants) {
    if (only && !only(row, cols, variant)) continue;
    let rec;
    try { rec = await runCell(row, cols, variant); }
    catch (e) { rec = { row: row.id, cols: cols.join(''), variant, na: null, ui: true, accepted: false, issues: ['harness-threw:' + e.message.split('\n')[0]], notes: [e.stack.split('\n').slice(0, 3).join(' | ')], errors: [], pass: false }; }
    cells.push(rec);
  }
  return cells;
}

// ------------------------------------------------------------------------------------------------------------------ classification
// One verdict per cell: PASS | N/A (the tool refuses the selection, checked) | NA-BUILD (no meaningful sketch for this cell) | F<n> (caused by a
// round-1 finding of docs/CONSTRAINT-AUDIT.md) | NEW-<n> (docs/COVERAGE-AUDIT.md) | UNCLASSIFIED (a failure no rule explains: the test fails).
// The rules are explicit and ordered; each cites the evidence that ties the cell to the finding.
export function classify(c) {
  if (c.na) return { v: 'NA-BUILD', why: c.na };
  if (c.pass) return !c.ui && !c.accepted ? { v: 'N/A', why: 'refused by the tool, document untouched' } : { v: 'PASS' };
  const has = (i) => c.issues.some(x => x === i || x.startsWith(i + ':'));
  const shared = c.variant === 'shared';
  const r = c.row;
  if (r === 'dim-point-line' && has('tool-threw')) return { v: 'NEW-1', also: has('nominal') ? ['NEW-2'] : [] };   // the tool throws on EVERY use; where the DOF is also wrong that is NEW-2
  if (r === 'dim-point-line' && (has('nominal') || has('edit-refused'))) return { v: 'NEW-2' };
  if (r === 'perpendicular' && has('refused-feasible')) return { v: shared ? 'F4' : 'NEW-3' };
  if ((r === 'parallel' || r === 'collinear') && has('refused-feasible') && shared) return { v: 'F4' };
  if (r === 'parallel' && has('bite') && shared) return { v: 'F4' };
  if (r === 'equal' && has('refused-feasible')) return { v: 'F2' };
  if (r === 'tangent' && has('refused-feasible')) return { v: 'NEW-6' };
  if ((r === 'dim-horizontal' || r === 'dim-vertical') && has('demoted')) return { v: 'F1' };
  if (r.startsWith('dim-angle') && has('undo-nullity')) return { v: 'NEW-4' };
  if (r.startsWith('dim-angle') && has('bite') && shared) return { v: 'F4' };   // shared-joint angle not enforced (F4; tolerated)
  // the clockwise pick order moves the drawing at the angle's own measured value (F3), with or without a shared joint (after task 510 a shared-corner angle is enforced, so it shows F3 too)
  if (r.startsWith('dim-angle') && (has('dim-moved-geometry') || has('residual'))) return { v: 'F3' };
  if (r.startsWith('dim-line-line') && has('demoted')) return { v: 'NEW-5' };
  if (has('nullity!=fd')) return { v: 'F6' };
  if (r === 'collinear' && (has('nominal') || has('nullity!=oracle'))) return { v: 'NEW-7' };
  if (r === 'parallel' && has('bite')) return { v: 'NEW-8' };
  return { v: 'UNCLASSIFIED', why: c.issues.join('+') };
}
