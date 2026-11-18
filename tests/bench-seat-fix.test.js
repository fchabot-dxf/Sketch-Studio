// tests/bench-seat-fix.test.js -- Regression tests for curved-bench-seat Circular Pattern + trig formulas:
//   1. gap = 0 allowed cleanly (paramRefusal & num0 & solve) in mm and in
//   2. Any sweepAngle in (0, 360] works across odd/even slat counts (0.5, 1, 30, 60, 120, 160, 179.9, 180, 180.1, 200, 240, 270, 350, 360)
//   3. User-reported inch scenarios solve cleanly with 0 DOF, exact radii, gap (incl. 0), identical slats, sweep span, and Y symmetry
//   4. Physical limits (negative gap, sweepAngle > 360, gap >= max inner chord) throw plain TemplateRefusal messages
//   5. Live parameter edits after opening (sweep_angle, gap, outer_radius, inner_radius, circularPattern quantity) maintain 0 DOF
import assert from 'node:assert';
import * as L from './harness/audit/lib.js';
import { templateById, buildTemplate, TemplateRefusal } from '#core/templates.js';
import { deserializeDocument } from '#core/document.js';
import { worldToUserY } from '#core/units.js';
import { planChange } from '#core/parameters.js';
import { applyParameterChange } from '#core/dimension-seams.js';

const muted = (f) => { const l = console.log, w = console.warn, e = console.error, d = console.debug; console.log = console.warn = console.error = console.debug = () => {}; try { return f(); } finally { console.log = l; console.warn = w; console.error = e; console.debug = d; } };
const bench = templateById('curved-bench-seat');
const open = (params = {}, unit = 'mm') => {
  const S = L.newSketch();
  const res = muted(() => deserializeDocument(JSON.parse(JSON.stringify(buildTemplate(bench, params, unit))), S.state));
  assert.ok(res.ok, `bench ${JSON.stringify(params)} (${unit}): loads (${res.reason})`);
  assert.deepStrictEqual(muted(() => S.engine.solve(L.ITER)).conflicts || [], [], `bench ${JSON.stringify(params)}: 0 conflicts`);
  assert.strictEqual(L.nullity(S), 0, `bench ${JSON.stringify(params)}: 0 DOF`);
  return S;
};
const U = (S, id) => { const p = S.state.joints.get(id); return { x: p.x, y: worldToUserY(p.y) }; };
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const lineDist = (p, a, b) => Math.abs((p.x - a.x) * (b.y - a.y) - (p.y - a.y) * (b.x - a.x)) / dist(a, b);
const near = (a, b, m, tol = 1e-4) => assert.ok(Math.abs(a - b) < tol, `${m}: ${a} vs ${b}`);
const basePer = (u) => (u === 'in' ? 25.4 : 1);

let checks = 0;

// 1. User-reported inch scenarios + 360 full-circle zero-gap
for (const [params, unit] of [
  [{ slats: 8, outerRadius: 66, innerRadius: 46, sweepAngle: 180, gap: 0.375 }, 'in'],
  [{ slats: 20, outerRadius: 66, innerRadius: 46, sweepAngle: 160, gap: 0 }, 'in'],
  [{ slats: 8, outerRadius: 66, innerRadius: 46, sweepAngle: 360, gap: 0 }, 'in'],
  [{ slats: 9, outerRadius: 66, innerRadius: 46, sweepAngle: 270, gap: 0.25 }, 'in'],
]) {
  const S = open(params, unit);
  const f = basePer(unit), Ro = params.outerRadius * f, Ri = params.innerRadius * f, gapMm = params.gap * f, n = params.slats;
  const lines = S.state.shapes.filter((s) => s.type === 'line' && !s.isConstruction);
  const arcs = S.state.shapes.filter((s) => s.type === 'arc');
  assert.strictEqual(arcs.length, 2 * n);
  assert.strictEqual(lines.length, 2 * n);
  const sides = lines.map((s) => s.joints.map((id) => U(S, id)));
  for (const [a, b] of sides) near(lineDist({ x: 0, y: 0 }, a, b), gapMm / 2, `${JSON.stringify(params)}: offset gap/2`);
  const midAngle = ([A, B]) => { const q = [...A, ...B].reduce((acc, p) => ({ x: acc.x + p.x / 4, y: acc.y + p.y / 4 }), { x: 0, y: 0 }); return ((Math.atan2(q.y, q.x) - Math.PI / 2 + Math.PI * 3) % (Math.PI * 2)) - Math.PI; };
  const ordered = Array.from({ length: n }, (_, k) => [sides[2 * k], sides[2 * k + 1]]).sort((a, b) => midAngle(a) - midAngle(b));
  for (let k = 0; k + 1 < n; k++) near(lineDist(ordered[k + 1][0][0], ordered[k][1][0], ordered[k][1][1]), gapMm, `${JSON.stringify(params)}: gap ${k}`);
  for (const a of arcs) { const r = dist(U(S, a.joints[0]), U(S, a.joints[1])); assert.ok(Math.abs(r - Ro) < 1e-4 || Math.abs(r - Ri) < 1e-4); }
  const xs = sides.flat().map((q) => q.x);
  near(Math.max(...xs) + Math.min(...xs), 0, `${JSON.stringify(params)}: Y symmetric`);
  checks += 6;
}

// 2. Sweep angle matrix across odd/even slat counts and gap=0 vs positive
const sweeps = [1, 30, 60, 90, 120, 160, 179.9, 180, 180.1, 200, 240, 270, 350, 360];
for (const sw of sweeps) {
  for (const slats of [2, 3, 8, 9]) {
    for (const gap of [0, 10]) {
      const Ri = 450, maxGap = 2 * Ri * Math.sin((Math.PI * sw) / (360 * slats));
      if (gap >= maxGap) continue;
      open({ slats, outerRadius: 900, innerRadius: Ri, sweepAngle: sw, gap }, 'mm');
      checks++;
    }
  }
}

// 3. Limits & zero validation
for (const [params, wantParam] of [
  [{ gap: -1 }, 'gap'],
  [{ sweepAngle: 361 }, 'sweepAngle'],
  [{ slats: 8, outerRadius: 1600, innerRadius: 1100, sweepAngle: 60, gap: 250 }, 'gap'],
]) {
  let caught = null;
  try { muted(() => buildTemplate(bench, params, 'mm')); } catch (e) { caught = e; }
  assert(caught instanceof TemplateRefusal, `${JSON.stringify(params)}: throws TemplateRefusal`);
  assert.strictEqual(caught.param, wantParam, `${JSON.stringify(params)}: targets ${wantParam}`);
  checks += 2;
}

// 4. Live parameter edits after opening (including 0 <-> >0 gap, >= 180 sweep, and circular pattern quantity)
const E = open({ slats: 8, outerRadius: 900, innerRadius: 450, sweepAngle: 60, gap: 10 }, 'mm');
for (const [name, text] of [['sweep_angle', '180 deg'], ['sweep_angle', '240 deg'], ['sweep_angle', '360 deg'], ['gap', '0 mm'], ['gap', '25 mm'], ['outer_radius', '1200 mm'], ['inner_radius', '300 mm']]) {
  const pl = planChange(E.state, { type: 'setParameter', name, text });
  assert.ok(pl.ok, `plan ${name}=${text}: ${pl.message}`);
  const ap = muted(() => applyParameterChange(E.state, pl, name));
  assert.ok(ap.ok, `apply ${name}=${text}: ${ap.reason || ''}`);
  assert.strictEqual(L.nullity(E), 0, `after ${name}=${text}: 0 DOF`);
  checks += 3;
}
const pat = E.state.constraints.find((c) => c.type === 'circularPattern');
for (const q of [12, 6, 8]) {
  const pl = planChange(E.state, { type: 'setDimension', name: pat.names.quantity, text: String(q) });
  assert.ok(pl.ok, `plan qty=${q}: ${pl.message}`);
  const ap = muted(() => applyParameterChange(E.state, pl, 'qty'));
  assert.ok(ap.ok, `apply qty=${q}: ${ap.reason || ''}`);
  assert.strictEqual(E.state.shapes.filter((s) => s.type === 'arc').length, 2 * q);
  assert.strictEqual(L.nullity(E), 0);
  checks += 4;
}

console.log(`bench-seat-fix: ${checks} checks passed`);
