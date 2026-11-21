// tests/spur-gear-840-node.test.js -- TASK 840 (owner turn 3072: "Im thinking a gear template"): the SPUR GEAR template's GEOMETRY (#core/gear-geometry.js
// spurTooth, the tooth the recipe of #core/templates.js 'spur-gear' draws; tests/spur-gear-840-doc-node.test.js checks the built drawing is exactly it).
//  1. THE INVOLUTE: the flank's two arcs against the TRUE involute (this file's own formula: the tooth's half angle at radius r is
//     pi / (2 z) + inv(alpha) - inv(acos(rb / r)) - (b / 2) / rb), both ways (every involute point to the arcs, every arc point to the involute):
//     at most 0.05 mm at the default size and at most 0.5 % of the module at any size, over teeth 6 / 12 / 24 / 60 / 200 x module 1 / 3 / 10 x
//     20 / 14.5 deg;
//  2. MESH: two gears of one module at centre distance (z1 + z2) m / 2, turned together through one pitch: the least clearance between their
//     outlines (negative = overlap), with the default backlash and with none (the radial line under the base circle is no undercut: the small
//     pinions' figures are reported, not asserted);
//  3. the limits (bore, backlash) refuse with a plain line; the bank declares the gear after the bolt circle, its params and kinds.
import assert from 'node:assert';
import { TEMPLATES, TemplateRefusal, buildTemplate, templateById } from '#core/templates.js';
import { spurTooth } from '#core/gear-geometry.js';

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const t = templateById('spur-gear');
const DEG = Math.PI / 180, TAU = 2 * Math.PI;
const report = [];

// ── the TRUE involute (this file's own): the right flank's point at radius r, user coordinates (Y up, the tooth's axis +Y)
const inv = (a) => Math.tan(a) - a;
function trueFlank(z, m, alphaDeg, b, r) {
  const rb = z * m / 2 * Math.cos(alphaDeg * DEG);
  const psi = Math.PI / (2 * z) + inv(alphaDeg * DEG) - inv(Math.acos(Math.min(1, rb / r))) - (b / 2) / rb;
  return { x: r * Math.sin(psi), y: r * Math.cos(psi) };
}
const segDist = (q, a, b) => { const dx = b.x - a.x, dy = b.y - a.y, l = dx * dx + dy * dy; const u = l ? Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.y - a.y) * dy) / l)) : 0; return Math.hypot(q.x - a.x - u * dx, q.y - a.y - u * dy); };
// an arc { c, a (start), e (end) } counter-clockwise from a to e: its points
function arcPoints(c, a, e, n) {
  const r = Math.hypot(a.x - c.x, a.y - c.y), a0 = Math.atan2(a.y - c.y, a.x - c.x), sw = ((Math.atan2(e.y - c.y, e.x - c.x) - a0) % TAU + TAU) % TAU;
  return Array.from({ length: n + 1 }, (_, i) => ({ x: c.x + r * Math.cos(a0 + sw * i / n), y: c.y + r * Math.sin(a0 + sw * i / n) }));
}
// the deviation of the flank arcs (two { c, a, e }, S -> J -> A) from the true involute between the radii of S and A, both ways
function deviation(z, m, alphaDeg, b, arcs) {
  const rS = Math.hypot(arcs[0].a.x, arcs[0].a.y), rA = Math.hypot(arcs[1].e.x, arcs[1].e.y), N = 3000;
  const inv_ = Array.from({ length: N + 1 }, (_, i) => trueFlank(z, m, alphaDeg, b, rS + (rA - rS) * i / N));
  const poly = arcs.flatMap((k) => arcPoints(k.c, k.a, k.e, 1500));
  const toPoly = (q, P) => { let d = Infinity; for (let i = 0; i + 1 < P.length; i++) d = Math.min(d, segDist(q, P[i], P[i + 1])); return d; };
  let e = 0;
  for (let i = 0; i <= N; i += 10) e = Math.max(e, toPoly(inv_[i], poly));
  for (let i = 0; i < poly.length; i += 10) e = Math.max(e, toPoly(poly[i], inv_));
  return e;
}
const toothArcs = (g) => [{ c: g.C1, a: g.S, e: g.J }, { c: g.C2, a: g.J, e: g.A }];

// ── 1. the involute bound, the tooth as spurTooth makes it (the recipe draws exactly these points: tests/spur-gear-840-doc-node.test.js)
let worstRel = 0;
for (const z of [6, 12, 24, 60, 200]) for (const m of [1, 3, 10]) for (const alpha of [20, 14.5]) {
  const b = 0.1, g = spurTooth({ teeth: z, module: m, pressureAngle: alpha, backlash: b });
  const e = deviation(z, m, alpha, b, toothArcs(g));
  worstRel = Math.max(worstRel, e / m);
  ok(e <= 0.005 * m, `involute z ${z} m ${m} ${alpha} deg: ${e.toFixed(5)} mm <= 0.5 % of the module`);
  if (m === 3) ok(e <= 0.05, `involute z ${z} m 3 ${alpha} deg: ${e.toFixed(5)} mm <= 0.05 mm`);
  if (m === 1) report.push(`involute z ${z} ${alpha} deg: max deviation ${(e * 100).toFixed(3)} % of the module (${(e * 3).toFixed(4)} mm at module 3)`);
}
report.push(`involute: worst ${(worstRel * 100).toFixed(3)} % of the module over 6..200 teeth x 1 / 3 / 10 x 20 / 14.5 deg`);

// ── 2. MESH: the outline of a whole gear from spurTooth (arcs sampled every ~0.02 module), tooth k turned k * 360 / z
function toothPolyline(g, m) {
  const n = (c, a, e) => Math.max(8, Math.ceil(Math.hypot(a.x - e.x, a.y - e.y) / (0.02 * m)));
  const O = { x: 0, y: 0 }, right = [...arcPoints(O, g.G, g.F, n(O, g.G, g.F)), ...arcPoints(g.C1, g.S, g.J, n(g.C1, g.S, g.J)), ...arcPoints(g.C2, g.J, g.A, n(g.C2, g.J, g.A))];
  const tipHalf = arcPoints(O, g.A, { x: 0, y: g.circles.ra }, n(O, g.A, { x: 0, y: g.circles.ra }));
  const half = [...right, ...tipHalf];
  return [...half, ...half.slice().reverse().map((p) => ({ x: -p.x, y: p.y }))]; // G -> ... -> tip middle -> ... -> G' (the gap middles at -pi / z, +pi / z)
}
const rot = (p, a) => ({ x: p.x * Math.cos(a) - p.y * Math.sin(a), y: p.x * Math.sin(a) + p.y * Math.cos(a) });
function pointInPoly(P, q) { let inside = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) if ((P[i].y > q.y) !== (P[j].y > q.y) && q.x < (P[j].x - P[i].x) * (q.y - P[i].y) / (P[j].y - P[i].y) + P[i].x) inside = !inside; return inside; }
// the gear (centre `at`, turned `turn` rad counter-clockwise): its teeth within `reach` teeth of the direction `towards` (rad) as polylines, and inside(q)
function placedGear(z, m, alpha, b, at, turn, towards, reach = 3) {
  const g = spurTooth({ teeth: z, module: m, pressureAngle: alpha, backlash: b }), tooth = toothPolyline(g, m), pitch = TAU / z;
  const sector = [{ x: 0, y: 0 }, ...tooth];
  const teeth = [];
  for (let k = 0; k < z; k++) {
    const a = turn + k * pitch, axis = Math.PI / 2 + a, d = Math.atan2(Math.sin(axis - towards), Math.cos(axis - towards));
    if (Math.abs(d) > reach * pitch) continue;
    const pts = tooth.map((p) => { const q = rot(p, a); return { x: q.x + at.x, y: q.y + at.y }; });
    pts.box = { x0: Math.min(...pts.map((p) => p.x)), x1: Math.max(...pts.map((p) => p.x)), y0: Math.min(...pts.map((p) => p.y)), y1: Math.max(...pts.map((p) => p.y)) };
    teeth.push(pts);
  }
  const inside = (q) => { // turned back into tooth 0's sector (the gap middles at +-pi / z round +Y)
    const p = rot({ x: q.x - at.x, y: q.y - at.y }, -turn), ang = Math.atan2(p.x, p.y), k = Math.round(ang / pitch);
    return pointInPoly(sector, rot(p, k * pitch));
  };
  return { teeth, inside, g, at };
}
function meshClearance(z1, z2, m, alpha, b, steps = 12) {
  const a = (z1 + z2) * m / 2;
  let least = Infinity;
  for (let s = 0; s < steps; s++) {
    const t1 = (TAU / z1) * s / steps, t2 = -t1 * z1 / z2 + (z2 % 2 === 0 ? Math.PI / z2 : 0); // gear 2 above, turning the other way, a gap facing gear 1's tooth 0
    const g1 = placedGear(z1, m, alpha, b, { x: 0, y: 0 }, t1, Math.PI / 2), g2 = placedGear(z2, m, alpha, b, { x: 0, y: a }, t2, -Math.PI / 2);
    for (const [A, B] of [[g1, g2], [g2, g1]]) for (const poly of A.teeth) for (const q of poly) {
      if (Math.hypot(q.x - B.at.x, q.y - B.at.y) > B.g.circles.ra + 0.5 * m) continue; // only the points that reach the other gear
      let d = 0.5 * m;
      for (const P of B.teeth) {
        const bx = Math.max(P.box.x0 - q.x, 0, q.x - P.box.x1), by = Math.max(P.box.y0 - q.y, 0, q.y - P.box.y1);
        if (Math.hypot(bx, by) >= d) continue;
        for (let i = 0; i + 1 < P.length; i++) d = Math.min(d, segDist(q, P[i], P[i + 1]));
      }
      if (d < 0.5 * m) least = Math.min(least, B.inside(q) ? -d : d);
    }
  }
  return least;
}
const meshTable = [];
for (const [z1, z2] of [[24, 24], [17, 60], [12, 36], [12, 12], [6, 24], [6, 6]]) for (const alpha of [20, 14.5]) {
  const m = 3, withB = meshClearance(z1, z2, m, alpha, 0.1), none = meshClearance(z1, z2, m, alpha, 0);
  meshTable.push({ z1, z2, alpha, withB, none });
  report.push(`mesh ${z1} + ${z2} teeth, module 3, ${alpha} deg, centre distance ${(z1 + z2) * m / 2} mm: least clearance ${withB.toFixed(4)} mm with 0.1 mm backlash, ${none.toFixed(4)} mm with none`);
}
// gears free of the involute's interference (both at or above 17 teeth at 20 deg, and the pairs the measurement shows clear): no overlap with the
// default allowance, and the clearance it adds is the allowance (the two flanks' fit errors aside); with none, any overlap is within the fit
const fitTol = 2 * 0.0022 * 3;
for (const r of meshTable.filter((x) => x.alpha === 20 && x.z1 >= 17)) {
  ok(r.withB > 0, `mesh ${r.z1} + ${r.z2} at 20 deg: no overlap with the 0.1 mm backlash (${r.withB.toFixed(4)})`);
  ok(Math.abs(r.withB - r.none - 0.1) <= fitTol + 0.02, `mesh ${r.z1} + ${r.z2} at 20 deg: the allowance adds about 0.1 mm (${(r.withB - r.none).toFixed(4)})`);
  ok(r.none >= -fitTol, `mesh ${r.z1} + ${r.z2} at 20 deg, no backlash: overlap within the fit (${r.none.toFixed(4)})`);
}

// ── 3. limits, the bank
for (const [params, param] of [[{ bore: 70 }, 'bore'], [{ backlash: 5 }, 'backlash']]) {
  let err = null;
  try { buildTemplate(t, params); } catch (e) { err = e; }
  ok(err instanceof TemplateRefusal && err.param === param && /use less than/.test(err.message), `${JSON.stringify(params)}: refused on ${param} with a plain line (${err && err.message})`);
}
const ids = TEMPLATES.map((x) => x.id);
eq(ids.indexOf('spur-gear'), ids.indexOf('bolt-circle') + 1, 'the bank: the spur gear right after the bolt circle');
eq(Object.entries(t.params).map(([k, s]) => [k, s.kind || 'length']), [['teeth', 'count'], ['module', 'length'], ['pressureAngle', 'choice'], ['bore', 'length'], ['backlash', 'length']], 'the params and their kinds');
eq([t.params.teeth.min, t.params.teeth.max, t.params.teeth.default, t.params.pressureAngle.options.map((o) => o.value)], [6, 200, 24, ['20', '14.5']], 'teeth 6..200 (24), pressure angle 20 / 14.5');
console.log(report.join('\n'));
console.log(`spur-gear-840-node: ${checks} checks passed`);
