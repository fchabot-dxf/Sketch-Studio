// TASK 508 -- one small, self-contained REPRO per finding. Each `run()` builds a tiny sketch through the same APIs the tools use and
// returns { ok, observed }: ok === true means the app behaves CORRECTLY, ok === false means the bug is present today.
// tests/constraint-audit.test.js pins every ok === false as a KNOWN entry (and fails loudly when one starts passing).
import * as L from './lib.js';
import { commitDimensionEdit } from '#ui/dimension-seams.js';
import { makeArc } from '#core/shapes.js';
import * as d4 from './d4-triangle.js';

const J = (S, id) => S.state.joints.get(id);

export const FINDINGS = [
  {
    id: 'F1', severity: 'HIGH', title: 'a horizontal AND a vertical dimension between the same two points: the 2nd is demoted to a reference',
    diagnosis: 'ConstraintManager._edgeHasDrivingDistance compares the joint pair only, not dimMode; an H dim and a V dim measure different things.',
    run() {
      const S = L.newSketch(); const P = L.point(S, 60, 20);
      const h = L.applyStep(S, { type: 'distance', joints: [L.origin, P], value: 60, dimMode: 'horizontal' }, {});
      const v = L.applyStep(S, { type: 'distance', joints: [L.origin, P], value: 20, dimMode: 'vertical' }, {});
      return { ok: !v.driven && v.nullity === 0, observed: `H dim: driven=${h.driven} nullity=${h.nullity}; V dim: driven=${v.driven} (${v.notes.join('; ')}) nullity=${v.nullity}; P=(${J(S, P).x.toFixed(2)},${J(S, P).y.toFixed(2)})` };
    },
  },
  {
    id: 'F2', severity: 'HIGH', title: "'equal' on two circles is accepted but never changes a radius (radius is shape data, not a solver unknown)",
    diagnosis: "engine.js builds equal's joints from shape.joints; a circle has ONE joint, so the row has no radii; the verifier measures the radii, so the sketch shows a residual the solver cannot reduce, and editing one radius is refused.",
    run() {
      const S = L.newSketch(); const a = L.circle(S, 0, 0, 8), b = L.circle(S, 50, 0, 8);
      const e = L.applyStep(S, { type: 'equal', shapes: [a.id, b.id] }, {});
      L.shape(S, b.id).radius = 12; S.engine.solve(500);
      const r = L.residuals(S);
      const refused = commitDimensionEdit(S.state, { type: 'distance', isRadius: true, shape: a.id, value: 8 }, 6).reverted;
      const ra = L.shape(S, a.id).radius, rb = L.shape(S, b.id).radius;
      return { ok: Math.abs(ra - rb) < 1e-6 && !refused, observed: `equal accepted=${e.accepted} nullity=${e.nullity}; after b.radius=12 and a solve: radii ${ra} / ${rb}, residual ${r.max.toExponential(2)} (${L.describe(r.worst)}); radius edit refused=${refused}` };
    },
  },
  {
    id: 'F3', severity: 'HIGH', title: 'an angle dimension placed on two lines whose signed angle is clockwise deforms the sketch at its own measured value (collapses it to zero length once the triangle is isosceles)',
    diagnosis: 'the dimension seam measures |a1-a2|, but definitions.angle is the SIGNED (CCW) angle u->v: a clockwise pair is unsatisfiable at its own measured value and the solver "converges" on a zero-length line (cross and dot both 0).',
    run() {
      const S = L.newSketch(); const b = d4.build(S); const N = b.names;
      L.applyStep(S, { type: 'coincident', joints: [N.A, L.origin] }, {});
      L.applyStep(S, { type: 'horizontal', joints: [N.A, N.B] }, {});
      const len = () => Math.hypot(J(S, N.B).x - J(S, N.A).x, J(S, N.B).y - J(S, N.A).y);
      const len0 = len();
      const row = L.applyStep(S, { type: 'angle', shapes: [N.lAB, N.lCA], value: L.measure(S, { type: 'angle', shapes: [N.lAB, N.lCA] }), direct: true }, {});
      return { ok: Math.abs(len() - len0) < 1e-3, observed: `angle at its measured value ${row.constraint ? row.constraint.value.toFixed(2) : '?'}: accepted=${row.accepted} converged=${row.converged} residual=${row.residual.toExponential(1)}; |AB| ${len0.toFixed(2)} -> ${len().toFixed(4)}` };
    },
  },
  {
    id: 'F4', severity: 'MEDIUM', title: 'angle / perpendicular between two lines that SHARE a joint (fillet rims, polygon corners, imports, welds): angle is a no-op, perpendicular is refused',
    diagnosis: "engine.js dedupes the shape joints ([...new Set]) for angle/perpendicular/parallel, so a shared corner leaves 3 joints where definitions.js reads 4 (joints[3] undefined -> NaN row). Only 'equal' is exempt from the dedupe.",
    run() {
      const tri = () => {
        const S = L.newSketch();
        const A = L.point(S, 0, 0), B = L.point(S, 100, 0), C = L.point(S, 40, 70);
        const l1 = L.line(S, A, B), l2 = L.line(S, A, C);
        S.engine.solve(500);
        return { S, l1, l2 };
      };
      // (1) angle dimension typed on two lines sharing corner A: the lines end up at the typed angle
      const a = tri(); const n0 = L.nullity(a.S);
      const ang = L.applyStep(a.S, { type: 'angle', shapes: [a.l1, a.l2], value: 60 }, {});
      const got = L.measure(a.S, { type: 'angle', shapes: [a.l1, a.l2] });
      // (2) perpendicular on the shared corner: accepted, solved, the lines meet at 90 degrees
      const p = tri();
      const perp = L.applyStep(p.S, { type: 'perpendicular', shapes: [p.l1, p.l2] }, {});
      const pm = L.measure(p.S, { type: 'angle', shapes: [p.l1, p.l2] });
      // (3) a regular hexagon (makePolygon: adjacent sides share a corner): an angle dimension between two adjacent sides is solved
      const h = L.newSketch(); const c = L.point(h, 0, 0), v = L.point(h, 50, 0);
      const hex = L.polygon(h, c, v, 6); h.engine.solve(500);
      const sides = hex.shapes.filter(s => !s.isConstruction).map(s => s.id);
      const hv = L.measure(h, { type: 'angle', shapes: [sides[0], sides[1]] });
      const hang = L.applyStep(h, { type: 'angle', shapes: [sides[0], sides[1]], value: hv, direct: true }, {});
      const ok = Math.abs(got - 60) < 1e-3 && perp.accepted && Math.abs(pm - 90) < 1e-2 && perp.converged && hang.accepted && hang.converged && hang.residual < 1e-6 && !hang.hasNaN;
      return { ok, observed: `angle 60 typed: nullity ${n0} -> ${ang.nullity}, measured ${got.toFixed(3)} deg (${ang.notes.join(';') || 'no note'}); perpendicular accepted=${perp.accepted} errors=${perp.errors.join(',')} measured ${pm.toFixed(3)} deg; hexagon adjacent-side angle ${hv.toFixed(3)}: accepted=${hang.accepted} converged=${hang.converged} residual=${hang.residual.toExponential(1)}` };
    },
  },
  {
    id: 'F5', severity: 'MEDIUM', title: 'a feasible tangent is refused ERR-CSOLVE-01 depending on the ORDER the three tangents are added',
    diagnosis: 'ConstraintManager._sandboxVerify judges feasibility from a 45-iteration burst starting at the current (far) geometry: tangent CA is refused right after tangent AB but accepted after tangent BC.',
    run() {
      const S = L.newSketch(); const b = d4.build(S); S.names = b.names;
      const order = ['A at the origin', 'base AB horizontal', 'equal sides CA = BC', 'interior angle at A', 'M = midpoint of the base', 'circle centre on the axis C-M', 'circle tangent to AB'];
      const pick = (label) => d4.RECIPE.find(s => s.label.startsWith(label));
      for (const l of order) L.applyStep(S, pick(l), b.names);
      const ca = L.applyStep(S, pick('circle tangent to CA'), b.names);
      return { ok: ca.accepted, observed: `tangent CA right after tangent AB: accepted=${ca.accepted} errors=${ca.errors.join(',')} ${ca.messages.join(' | ').slice(0, 100)}` };
    },
  },
  {
    id: 'F6', severity: 'HIGH', title: 'DOF (nullity) reports 0 on a sketch that still has a degree of freedom: non-mutual pointOnLine has a one-sided Jacobian',
    diagnosis: "definitions.point_on_line only differentiates the POINT unless `mutual`; jointFreedom() reads the nullspace of that analytic Jacobian, so a pointOnLine onto a movable line hides the line's freedom (finite-difference Jacobian error 0.745 on that row; planegcs says dof 1).",
    async run() {
      const S = L.newSketch(); const b = d4.build(S); S.names = b.names;
      for (const st of d4.RECIPE) L.applyStep(S, st, b.names);
      const ang = S.state.constraints.find(c => c.type === 'angle');
      S.state.constraints.splice(S.state.constraints.indexOf(ang), 1);
      S.engine.solve(500);
      const ours = L.nullity(S), fd = L.fdJacobian(S), pg = await L.oracleSolve(S);
      const ref = L.snapshot(S); const ys = [];
      for (const seed of [1, 2, 3]) { L.restore(S, ref); L.jitter(S, seed, 0.05, 100); S.engine.solve(500); ys.push(J(S, b.names.C).y.toFixed(2)); }
      return { ok: ours === 1, observed: `angle dimension removed: nullity=${ours}, finite-difference nullity=${fd.nullity}, planegcs dof=${pg.dof}; re-solves from jittered starts put C.y at ${ys.join(', ')} (a free family)` };
    },
  },
  {
    id: 'F7', severity: 'LOW', title: 'makeArc names a shape s_arc_<Date.now()>: two arcs made in the same millisecond share an id',
    diagnosis: 'shapes.js makeArc: id = `s_arc_${Date.now()}` (groupId likewise); applyFillet and any scripted/import path that makes two arcs in one tick collides (planegcs refuses the duplicate; the app silently aliases them).',
    run() {
      const joints = new Map(); let n = 0; const ids = new Set(), groups = new Set(); let dup = false;
      for (let i = 0; i < 1000 && !dup; i++) {
        const c = 'c' + n++, a = 'a' + n++, b = 'b' + n++;
        joints.set(c, { x: 0, y: 0 }); joints.set(a, { x: 1, y: 0 }); joints.set(b, { x: 0, y: 1 });
        const sh = makeArc(joints, c, a, b).shapes[0];
        if (ids.has(sh.id) || groups.has(sh.groupId)) dup = true; ids.add(sh.id); groups.add(sh.groupId);
      }
      return { ok: !dup && ids.size === 1000 && groups.size === 1000, observed: dup ? 'two makeArc calls produced the same shape id or groupId' : `${ids.size} distinct ids and ${groups.size} distinct groupIds in 1000 arcs` };
    },
  },
  {
    id: 'F8', severity: 'MEDIUM', title: 'an outline with ONE joint per corner (DXF/SVG import, weld) does not return to its geometry from a jittered start / flips orientation on edits',
    diagnosis: 'UNCLEAR root cause: the identical bracket drawn with the line tool (coincident pairs) is clean (5/5 starts, 30/30 edits); with shared corner joints seed 51 does not converge (residual 3.5) and AB-length edits flip a corner sign.',
    async run() {
      const d3 = await import('./d3-bracket.js');
      const R = await L.runDrawing(d3, { oracleOn: false, buildOpts: { shared: true } });
      const bad = R.D.perturbed.filter(p => !p.converged || p.dev >= L.GEOM_TOL);
      const flips = R.E.filter(e => e.flips.length);
      return { ok: bad.length === 0 && flips.length === 0, observed: `perturbed starts that did not return: seeds ${bad.map(p => p.seed).join(',') || 'none'} (residual ${bad.map(p => p.residual.toExponential(1)).join(',')}); dimension edits that flipped an orientation sign: ${flips.length}` };
    },
  },
];
