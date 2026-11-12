// TASK 515 -- a circle's RADIUS is a solver unknown, like Fusion and PlaneGCS (whose circle has a radius parameter).
// A circle is one centre joint + `radius`: a free circle has 3 DOF, a centre on the origin 1, + a radius dimension 0. Radius dimension,
// equal, tangent and point-on-circle act on the radius through the solve (CONSTRAINT-AUDIT F2 / O2). Everything goes through the same seams
// the tools use (ConstraintManager.createConstraint, commitDimensionEdit, deleteConstraints, serialize/deserialize).
import assert from 'node:assert';
import * as L from './harness/audit/lib.js';
import { ConstraintManager } from '#core/constraint-manager.js';
import { commitDimensionEdit } from '#ui/dimension-seams.js';
import { analyzeConstraintStatus } from '#core/constraint-status.js';
import { serializeDocument, deserializeDocument } from '#core/document.js';
import { createSketches } from '#core/sketch-model.js';

const add = (S, type, params) => ConstraintManager.createConstraint(S.state, type, params, { source: 'test' });
const status = (S) => analyzeConstraintStatus({ joints: S.state.joints, shapes: S.state.shapes, constraints: S.state.constraints });
const R = (S, id) => L.shape(S, id).radius;
const near = (a, b, tol = 1e-6) => Math.abs(a - b) < tol;
let n = 0;
const ok = (name, cond, detail = '') => { assert.ok(cond, name + (detail ? '  ' + detail : '')); console.log('ok    ' + name); n++; };

// 1. DOF: free circle 3; centre on the origin 1; + radius dimension 0 (and the Design panel / shape colour agree)
{
  const S = L.newSketch();
  const k = L.circle(S, 30, 20, 10);
  ok('a free circle has 3 DOF (centre x, y and the radius)', L.nullity(S) === 3, 'nullity ' + L.nullity(S));
  ok('the Design panel DOF of a free circle is 3', status(S).dof === 3);
  add(S, 'coincident', { joints: [k.c, L.origin] });
  S.engine.solve(L.ITER);
  ok('centre on the origin: 1 DOF left (the radius)', L.nullity(S) === 1, 'nullity ' + L.nullity(S));
  const f = S.engine.jointFreedom();
  ok('jointFreedom names the circle radius free', f.radiusFree.has(k.id) && f.freedom.get(k.c) === 0);
  ok('a circle whose radius is free is NOT drawn fully constrained', !status(S).fixedShapes.has(k.id));
  const d = add(S, 'distance', { shape: k.id, value: 10, isRadius: true });
  ok('the first radius dimension of a circle is driving', d && !d.isDriven && !d.driven);
  S.engine.solve(L.ITER);
  ok('centre on the origin + radius dimension: 0 DOF', L.nullity(S) === 0 && status(S).dof === 0, 'nullity ' + L.nullity(S));
  ok('... and the circle is drawn fully constrained', status(S).fixedShapes.has(k.id) && !S.engine.jointFreedom().radiusFree.has(k.id));
  const r = commitDimensionEdit(S.state, d, 14);
  ok('editing the radius dimension drives the radius through the solve', !r.reverted && near(R(S, k.id), 14), JSON.stringify([r, R(S, k.id)]));
  const dup = add(S, 'distance', { shape: k.id, value: 14, isRadius: true });
  ok('a second radius dimension on the same circle is a reference (already determined)', !dup || dup.isDriven || dup.driven);
}

// 2. equal(c1, c2) then edit c1's radius: both follow (F2)
{
  const S = L.newSketch();
  const a = L.circle(S, 0, 50, 8), b = L.circle(S, 60, 50, 12);
  const da = add(S, 'distance', { shape: a.id, value: 8, isRadius: true });
  const e = add(S, 'equal', { shapes: [a.id, b.id] });
  S.engine.solve(L.ITER);
  ok('equal on two circles is accepted and makes the radii equal', !!e && near(R(S, a.id), R(S, b.id)) && near(R(S, a.id), 8), `${R(S, a.id)} / ${R(S, b.id)}`);
  ok('equal on two circles removes one DOF (2 x 3 - radius dim - equal = 4)', L.nullity(S) === 4, 'nullity ' + L.nullity(S));
  const r = commitDimensionEdit(S.state, da, 11);
  ok('edit c1 radius 8 -> 11: both circles follow', !r.reverted && near(R(S, a.id), 11) && near(R(S, b.id), 11), JSON.stringify([r, R(S, a.id), R(S, b.id)]));
}

// 3. equal(circle, arc): the circle's radius and the arc's centre-rim distance
{
  const S = L.newSketch();
  const k = L.circle(S, 0, 0, 5);
  const c = L.point(S, 50, 0), s = L.point(S, 70, 0), t = L.point(S, 50, 20);
  const arc = L.arc(S, c, s, t);
  const e = add(S, 'equal', { shapes: [k.id, arc] });
  S.engine.solve(L.ITER);
  const J = (id) => S.state.joints.get(id);
  const ra = Math.hypot(J(s).x - J(c).x, J(s).y - J(c).y);
  ok('equal(circle, arc) makes the circle radius equal to the arc radius', !!e && near(R(S, k.id), ra, 1e-5), `${R(S, k.id)} / ${ra}`);
}

// 4. tangent line-circle with the radius free moves the radius (the line and the centre are held)
{
  const S = L.newSketch();
  const k = L.circle(S, 0, 0, 10);
  add(S, 'coincident', { joints: [k.c, L.origin] });
  const p = L.point(S, -50, 25), q = L.point(S, 50, 25);
  S.state.joints.get(p).fixed = true; S.state.joints.get(q).fixed = true;
  const ln = L.line(S, p, q);
  const t = add(S, 'tangent', { line: ln, circle: k.id });
  S.engine.solve(L.ITER);
  ok('tangent to a held line: the free radius moves to 25 (centre stays on the origin)', !!t && near(R(S, k.id), 25, 1e-5) && near(S.state.joints.get(k.c).x, 0) && near(S.state.joints.get(k.c).y, 0), 'radius ' + R(S, k.id));
}

// 5. tangent circle-circle (external): the moving circle resizes when both centres are held (Fusion 2706.1.17)
{
  const S = L.newSketch();
  const a = L.circle(S, 0, 0, 10), b = L.circle(S, 40, 0, 10);
  add(S, 'coincident', { joints: [a.c, L.origin] });
  add(S, 'distance', { shape: a.id, value: 10, isRadius: true });
  const cb = S.state.joints.get(b.c); cb.fixed = true;
  const t = add(S, 'tangent', { shapes: [a.id, b.id] });
  S.engine.solve(L.ITER);
  ok('tangent circle-circle with both centres held: the free radius becomes 40 - 10 = 30', !!t && near(R(S, b.id), 30, 1e-5), 'radius ' + R(S, b.id));
}

// 6. point on circle: a held point pulls the free radius
{
  const S = L.newSketch();
  const k = L.circle(S, 0, 0, 10);
  add(S, 'coincident', { joints: [k.c, L.origin] });
  const p = L.point(S, 30, 40); S.state.joints.get(p).fixed = true;
  const c = add(S, 'pointOnLine', { joint: p, shape: k.id });
  S.engine.solve(L.ITER);
  ok('a held point on a circle with a free radius: radius 50', !!c && near(R(S, k.id), 50, 1e-5), 'radius ' + R(S, k.id));
  ok('... and the circle is then fully constrained (0 DOF)', L.nullity(S) === 0);
}

// 7. a refused / rolled-back edit restores the radius too (the snapshot covers the radius unknown)
{
  const S = L.newSketch();
  const k = L.circle(S, 0, 0, 10);
  add(S, 'coincident', { joints: [k.c, L.origin] });
  const p = L.point(S, -50, 25), q = L.point(S, 50, 25);
  S.state.joints.get(p).fixed = true; S.state.joints.get(q).fixed = true;
  add(S, 'tangent', { line: L.line(S, p, q), circle: k.id });
  const d = add(S, 'distance', { shape: k.id, value: R(S, k.id), isRadius: true });
  S.engine.solve(L.ITER);
  const before = R(S, k.id);
  const r = commitDimensionEdit(S.state, d, 40);   // impossible: the radius is determined by the tangent to the held line
  S.engine.solve(L.ITER);
  ok('an impossible radius edit is refused and the radius is back at its value', (r.reverted || d.isDriven) && near(R(S, k.id), before, 1e-6), JSON.stringify([r, before, R(S, k.id)]));
}

// 8. saved files: an old document (radius stored on the shape) loads unchanged; the radius is the start value of the unknown
{
  const S = L.newSketch();
  const k = L.circle(S, 30, 20, 7.5);
  S.engine.solve(L.ITER);
  const doc = serializeDocument({ ...S.state, ...createSketches() });
  const T = L.newSketch();
  deserializeDocument(JSON.parse(JSON.stringify(doc)), { ...T.state, ...createSketches() });
  T.engine.solve(L.ITER);
  const s2 = T.state.shapes.find(s => s.type === 'circle');
  ok('a saved circle loads with its stored radius and keeps it through a solve', !!s2 && s2.radius === 7.5 && s2.id === k.id, JSON.stringify(s2));
  ok('the loaded free circle has 3 DOF', L.nullity(T) === 3);
}

console.log(`circle-radius-dof: ${n} checks passed`);
