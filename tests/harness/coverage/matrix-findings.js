// TASK 512 -- one self-contained REPRO per NEW finding of the matrix (round 1 = F1..F8 in tests/harness/audit/findings.js). Each run() returns
// { ok, observed }: ok === true means the app behaves CORRECTLY, ok === false means the bug is present today. Everything goes through the real
// tool handlers / seams, never through hand-written solver rows.
import * as L from '../audit/lib.js';
import { TOOL_MODES } from '#core/constants.js';
import { ConstraintManager } from '#core/constraint-manager.js';
import { deleteConstraints } from '#core/delete-manager.js';
import { perpendicularDistance } from '#core/geometry.js';
import { handleDimensionPointerDown, anchorPlacingDimension, resetDimensionState } from '#ui/input-handlers/dimension-tool.js';
import { runCell, ROWS } from './matrix-run.js';
import { build, applyVariant } from './matrix-build.js';

const svg = { viewBox: { baseVal: { x: 0, y: 0, width: 800, height: 800 } }, getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 800 }), setPointerCapture() {}, releasePointerCapture() {} };
const evt = (x, y) => ({ clientX: x, clientY: y, pointerType: 'mouse', pointerId: 1, target: { closest: () => null } });
const J = (S, id) => S.state.joints.get(id);
const quiet = (fn) => { const e = console.error, w = console.warn; console.error = () => {}; console.warn = () => {}; try { return fn(); } finally { console.error = e; console.warn = w; } };
function click(S, x, y, hitJoint, hitShape) {
  try { quiet(() => handleDimensionPointerDown(evt(x, y), svg, S.state, hitJoint, hitShape, null)); return null; } catch (e) { return e; }
}

export const NEW_FINDINGS = [
  {
    id: 'NEW-1', severity: 'HIGH', row: 'dim-point-line',
    title: 'the point-to-line dimension throws ReferenceError on every use (and leaves its undo group open)',
    diagnosis: 'packages/ui/input-handlers/dimension-tool.js:619 calls finalizeDimBirth(c, state) AFTER the block that declares `const c` (line 610): `c` is out of scope. The constraints are already created when it throws, but endDimUndo never runs.',
    proposal: 'declare c before the if (a && b && firstJ) block, or move finalizeDimBirth inside it; add a node test that drives joint-then-line and asserts no throw and one undo step.',
    async run() {
      const S = L.newSketch(); const st = S.state;
      const a = L.point(S, 100, 100), b = L.point(S, 200, 100), p = L.point(S, 140, 60); const ln = L.line(S, a, b);
      st.currentTool = TOOL_MODES.DIMENSION; resetDimensionState(st);
      click(S, 140, 60, { id: p, j: J(S, p) }, null);
      const err = click(S, 150, 100, null, { shape: L.shape(S, ln) });
      const open = !!st._undoGroupActive;
      const made = st.constraints.map(L.describe).join(', ');
      resetDimensionState(st);
      return { ok: !err && !open, observed: `second click (joint, then line): ${err ? err.name + ': ' + err.message : 'no throw'}; constraints created: ${made}; undo group left open: ${open}` };
    },
  },
  {
    id: 'NEW-2', severity: 'HIGH', row: 'dim-point-line',
    title: 'the point-to-line dimension does not hold a perpendicular distance: the helper joint slides along the line',
    diagnosis: 'dimension-tool.js:597-612 makes a helper joint on the line (pointOnLine) and dimensions |P - helper|; nothing makes P-helper perpendicular to the line, so the helper slides and the real perpendicular distance changes while every residual is 0. It also leaves the helper as 1 free DOF in the Design panel.',
    proposal: 'add a perpendicular (or a point-line distance row in definitions.js, as line-line has) so the dimension is the true point-to-line distance; test: lock P and one line end, swing the other end, the distance must hold.',
    async run() {
      const S = L.newSketch(); const st = S.state;
      const a = L.point(S, 100, 100), b = L.point(S, 200, 100), p = L.point(S, 140, 60); const ln = L.line(S, a, b);
      st.currentTool = TOOL_MODES.DIMENSION; resetDimensionState(st);
      click(S, 140, 60, { id: p, j: J(S, p) }, null);
      click(S, 150, 100, null, { shape: L.shape(S, ln) });   // (throws NEW-1 after creating the constraints; they are what the user is left with)
      quiet(() => anchorPlacingDimension(svg, st));          // the next click drops the label
      resetDimensionState(st);
      const d0 = Math.abs(perpendicularDistance(J(S, p), J(S, a), J(S, b)));
      for (const id of [a, p]) J(S, id).fixed = true;       // lock P and one end of the line
      J(S, b).y -= 40;                                       // swing the other end towards P
      S.engine.solve(L.ITER);
      const d1 = Math.abs(perpendicularDistance(J(S, p), J(S, a), J(S, b)));
      return { ok: Math.abs(d1 - d0) < 1e-3, observed: `perpendicular distance ${d0.toFixed(3)} when dimensioned; after swinging the line end it is ${d1.toFixed(3)} with max residual ${L.residuals(S).max.toExponential(1)} (the dimension reads satisfied)` };
    },
  },
  {
    id: 'NEW-3', severity: 'HIGH', row: 'perpendicular',
    title: 'perpendicular is refused (ERR-CSOLVE-01) between two EXACTLY parallel lines (angle 0 or 180), e.g. two lines that are both horizontal',
    diagnosis: 'constraint-manager.js:1019-1020 lockPerpendicularBranch skips the branch lock when |sin theta| < 0.1, so definitions.js:288 falls back to r = u.v. From an EXACTLY parallel start cross(u,v) = 0 is a stationary point of that residual: 500 iterations stay at the start (residual pi/2; the forced add does not converge either). A 0.01 degree tilt already solves, so the failure is only the exact-parallel case, which is the common one (lines with H or V constraints, snapped lines). PlaneGCS solves the same constraint.',
    proposal: 'give the branchless perpendicular a starting rotation (pick the branch from the sign of cross, or +1 when it is 0) instead of skipping; test: perpendicular on two parallel horizontal lines is accepted and solves.',
    async run() {
      const tryDir = (dx, dy) => {
        const S = L.newSketch(); const mk = (x, y, ex, ey) => { const p = L.point(S, x, y), q = L.point(S, x + ex, y + ey); return L.line(S, p, q); };
        const l1 = mk(100, 100, 60, 0), l2 = mk(250, 110, dx, dy);
        return !!ConstraintManager.createConstraint(S.state, 'perpendicular', { shapes: [l1, l2] }, { source: 'audit' });
      };
      const par = tryDir(60, 0), slight = tryDir(60, 0.01), tilted = tryDir(60, 30);
      return { ok: par && slight && tilted, observed: `first line horizontal; second line direction (60,0) parallel: accepted=${par}; (60,0.01) 0.01 deg: accepted=${slight}; (60,30) 27 deg: accepted=${tilted}` };
    },
  },
  {
    id: 'NEW-5', severity: 'HIGH', row: 'dim-line-line',
    title: 'a line-to-line dimension made with the Dimension tool is born as a REFERENCE (ERR-CSOLVE-02) with a NEGATIVE value, in one of the two click orders',
    diagnosis: 'dimension-tool.js:437 passes value: perpendicularDistance(j1a, j2a, j2b), which is SIGNED (geometry.js:122-130 uses a normal vector); definitions.js:32 compares Math.abs(signed) - value, so a negative value is a conflict and the sandbox demotes it. Which order breaks depends on which side line 2 is on.',
    proposal: 'pass Math.abs(...) (the solver already uses |signed|); test: both click orders on any two parallel lines give a driving, positive dimension.',
    async run() {
      const one = (first) => {
        const S = L.newSketch(); const st = S.state;
        const a = L.point(S, 100, 100), b = L.point(S, 160, 120), c = L.point(S, 130, 190), d = L.point(S, 190, 210);
        const l1 = L.line(S, a, b), l2 = L.line(S, c, d);
        st.currentTool = TOOL_MODES.DIMENSION; resetDimensionState(st);
        const ids = first ? [l1, l2] : [l2, l1];
        click(S, 130, 85, null, { shape: L.shape(S, ids[0]) });
        click(S, 160, 175, null, { shape: L.shape(S, ids[1]) });
        const k = st.constraints.find(x => x && x.type === 'distance' && x.shapes);
        resetDimensionState(st);
        return k ? `value ${k.value.toFixed(2)} driven=${!!(k.isDriven || k.driven)}${k.drivenReason ? ' (' + k.drivenReason + ')' : ''}` : 'none created';
      };
      const A = one(true), B = one(false);
      const good = (t) => /value [0-9]/.test(t) && /driven=false/.test(t);
      return { ok: good(A) && good(B), observed: `click line 1 then line 2: ${A}; click line 2 then line 1: ${B}` };
    },
  },
  {
    id: 'NEW-6', severity: 'LOW', row: 'tangent',
    title: 'a feasible tangent between a circle and an arc (or two arcs) is refused when the arc radius has to change a lot; PlaneGCS solves it',
    diagnosis: 'the radius of an arc is a joint distance the solver must move; from the current pose even 500 iterations leave the residual at 53 (circle 15 / arc 20 with the centres dimensioned 151 apart: tangent needs R 136). Same family as F5 (feasibility judged from the pose) but not a sandbox-burst issue: a forced add does not converge either.',
    proposal: 'seed the arc radius from the tangency (like seedFilletForRadius does for fillets) or verify with a continuation; test: the tangent in this repro is accepted.',
    async run() { const r = await runCell(ROWS.find(x => x.id === 'tangent'), ['O', 'A'], 'dimmed'); return { ok: r.pass, observed: `tangent circle/arc, centres dimensioned 151 apart: accepted=${r.accepted} errors=${r.errors.join(',')} oracleFeasible=${r.oracleFeasible}` }; },
  },
];
