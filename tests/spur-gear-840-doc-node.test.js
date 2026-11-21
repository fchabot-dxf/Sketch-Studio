// tests/spur-gear-840-doc-node.test.js -- TASK 840: the SPUR GEAR template's BUILT drawing (#core/templates.js 'spur-gear'; the geometry alone, the
// involute bound over every size, the mesh and the limits: tests/spur-gear-840-node.test.js).
//  1. the built drawing's flank arcs (solved) ARE spurTooth's (so tests/spur-gear-840-node.test.js's bound is the drawing's), and measured against the
//     true involute (this file's own formula) too: at most 0.5 % of the module, 0.05 mm at module 3;
//  2. ONE closed outline (the app's loop finder) + the bore's loop inside it; the teeth are the circular pattern's instances (quantity = teeth);
//  3. Shaper's Outside cut and Pocket of it derive (the Prepare derivation: deriveCuts -> deriveCutFootprint -> deriveCutTravel) with 0 crossings;
//  4. an inch document: the parameters in inches (module 1/8 in, backlash 0.004 in, bore 3/8 in) and the geometry from them;
//  5. the template picker (Shaper, node page) lists the gear after the bolt circle; its start view has the teeth, module, bore and backlash fields
//     and the pressure angle's glyph picker (20 / 14.5 deg).
import assert from 'node:assert';
import * as L from './harness/audit/lib.js';
import { buildTemplate, templateById } from '#core/templates.js';
import { spurTooth } from '#core/gear-geometry.js';
import { deserializeDocument } from '#core/document.js';
import { findLoops } from '#core/loop-finder.js';
import { loopPolygon, polygonContains } from '#core/loop-geometry.js';
import { deriveCutFootprint, deriveCutTravel } from '#core/profile-model.js';
import { deriveCuts } from '#core/stepped-cut.js';
import { pathCrossings } from '#core/path-crossings.js';
import { basePer } from '#core/units.js';
import { effectiveCutRecord } from '../apps/shaper/src/shaper.js';
import { open, createProfile } from './helpers/node-app.js';

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const muted = (f) => { const l = console.log, w = console.warn, e = console.error, d = console.debug; console.log = console.warn = console.error = console.debug = () => {}; try { return f(); } finally { console.log = l; console.warn = w; console.error = e; console.debug = d; } };
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

// ── the BUILT drawing, solved: { S (the sketch), pattern, loops, user(j) }
function solvedGear(params = {}, unit) {
  const doc = muted(() => buildTemplate(t, params, unit));
  const S = L.newSketch();
  ok(muted(() => deserializeDocument(JSON.parse(JSON.stringify(doc)), S.state)).ok, `gear ${JSON.stringify(params)}: loads`);
  const r = muted(() => S.engine.solve(L.ITER));
  eq(r.conflicts || [], [], `gear ${JSON.stringify(params)}: 0 conflicts`);
  eq(L.nullity(S), 0, `gear ${JSON.stringify(params)}: fully constrained`);
  const pattern = S.state.constraints.find((c) => c.type === 'circularPattern');
  const user = (id) => { const j = S.state.joints.get(id); return { x: j.x, y: -j.y }; };
  return { doc, S, pattern, user };
}
// the source tooth's flank arcs, right (centre right of the axis... both halves) as { c, a, e } in user coordinates, the right flank first
function drawnFlanks(G) {
  const arcs = G.pattern.sources.shapes.map((id) => G.S.state.shapes.find((s) => s.id === id)).filter((s) => s.type === 'arc')
    .map((s) => ({ c: G.user(s.joints[0]), a: G.user(s.joints[1]), e: G.user(s.joints[2]) })).filter((k) => Math.hypot(k.c.x, k.c.y) > 1e-6);
  const right = arcs.filter((k) => k.a.x > 0 && k.e.x > 0).sort((p, q) => Math.hypot(p.a.x, p.a.y) - Math.hypot(q.a.x, q.a.y));
  const left = arcs.filter((k) => k.a.x < 0 && k.e.x < 0).map((k) => ({ c: { x: -k.c.x, y: k.c.y }, a: { x: -k.e.x, y: k.e.y }, e: { x: -k.a.x, y: k.a.y } }))
    .sort((p, q) => Math.hypot(p.a.x, p.a.y) - Math.hypot(q.a.x, q.a.y)); // mirrored, so it runs S -> A like the right one
  return { right, left };
}
const near = (p, q, tol, m) => ok(Math.hypot(p.x - q.x, p.y - q.y) < tol, `${m}: (${p.x.toFixed(6)}, ${p.y.toFixed(6)}) vs (${q.x.toFixed(6)}, ${q.y.toFixed(6)})`);
for (const [z, m, alpha] of [[6, 1, 20], [6, 10, 14.5], [12, 3, 20], [12, 3, 14.5], [24, 3, 20]]) {
  const b = 0.1, G = solvedGear({ teeth: z, module: m, pressureAngle: String(alpha), backlash: b, bore: m }), g = spurTooth({ teeth: z, module: m, pressureAngle: alpha, backlash: b });
  const { right, left } = drawnFlanks(G);
  eq([right.length, left.length], [2, 2], `z ${z}: two arcs a flank`);
  toothArcs(g).forEach((k, i) => { for (const f of ['c', 'a', 'e']) { near(right[i][f], k[f], 1e-6, `z ${z} m ${m} ${alpha}: right arc ${i} ${f} is spurTooth's`); near(left[i][f], k[f], 1e-6, `z ${z} m ${m} ${alpha}: left arc ${i} ${f} mirrors it`); } });
  const e = Math.max(deviation(z, m, alpha, b, right), deviation(z, m, alpha, b, left));
  ok(e <= 0.005 * m && (m !== 3 || e <= 0.05), `drawn z ${z} m ${m} ${alpha}: involute deviation ${e.toFixed(5)} mm`);
  report.push(`drawn z ${z} m ${m} ${alpha} deg: involute deviation ${e.toFixed(5)} mm (${(e / m * 100).toFixed(3)} % of the module)`);
}

// ── 2 + 3. the default gear: one outline, the bore, the teeth = the pattern's instances; Outside / Pocket with 0 crossings
for (const params of [{}, { teeth: 6 }, { teeth: 12, pressureAngle: '14.5' }]) {
  const z = params.teeth || 24, G = solvedGear(params), st = G.S.state;
  eq([G.pattern.quantity, G.pattern.angle, G.pattern.instances.length], [z, 360, z - 1], `z ${z}: the teeth are the circular pattern's instances (${z} = the source + ${z - 1} copies)`);
  const sById = new Map(st.shapes.map((s) => [s.id, s]));
  const loops = findLoops(st).map((l) => ({ ...l, polygon: loopPolygon(l, st, sById) }));
  const outline = loops.find((l) => l.edges.length > 1), bore = loops.find((l) => l.edges.length === 1);
  eq(loops.length, 2, `z ${z}: two loops (the outline and the bore)`);
  eq(outline.edges.length, z * G.pattern.sources.shapes.length, `z ${z}: ONE outline through every tooth (${z} x ${G.pattern.sources.shapes.length} curves)`);
  ok(sById.get(bore.edges[0]).type === 'circle' && polygonContains(outline.polygon, bore.polygon), `z ${z}: the bore is a circle inside the outline (a hole)`);
  const loopPolys = Object.fromEntries(loops.map((l) => [l.id, l.polygon]));
  for (const raw of [{ cutType: 'exterior', cutDepth: 6, cutOffset: 0, toolDia: 3.175 }, { cutType: 'pocket', cutDepth: 3, cutOffset: 0, toolDia: 3.175, clearing: 'raster' }]) {
    const rec = effectiveCutRecord(raw), cuts = deriveCuts({ kind: 'loop', id: outline.id }, rec, st, loops, loopPolys, new Set());
    const travel = deriveCutTravel(deriveCutFootprint(cuts, rec, st));
    ok(cuts.length > 0 && travel.length > 0, `z ${z} ${raw.cutType}: derives a toolpath`);
    const crossings = pathCrossings(travel.map((p) => ({ points: p.path, closed: p.closed }))).count;
    eq(crossings, 0, `z ${z} ${raw.cutType}: 0 crossings`);
    report.push(`z ${z} ${raw.cutType} (3.175 mm bit): ${travel.length} path(s), ${crossings} crossings`);
  }
}

// ── 4. an inch document: inch parameters, inch geometry
{
  const G = solvedGear({}, 'in'), P = Object.fromEntries(G.doc.geometry.parameters.map((p) => [p.name, p.expression]));
  eq(P, { module: '0.125 in', bore: '0.375 in', backlash: '0.004 in' }, 'inch document: the user parameters in inches');
  const tipDim = G.S.state.constraints.find((c) => c.isRadius && c.expression && /\+ 2\) \* module/.test(c.expression)) || G.S.state.constraints.find((c) => c.isRadius && Math.abs(c.value - 13 * 0.125 * 25.4) < 1e-6);
  ok(tipDim && Math.abs(tipDim.value / basePer('in') - 1.625) < 1e-9, `inch document: the tip radius is (24 + 2) x 1/8 in / 2 = 1.625 in (${tipDim && tipDim.value / basePer('in')})`);
  report.push(`inch document: module 0.125 in (diametral pitch 8), backlash 0.004 in, bore 0.375 in, tip radius ${(tipDim.value / basePer('in')).toFixed(4)} in`);
}

const profile = await createProfile();
const app = await open({ host: 'shaper', profile, sidebar: true });
try {
  const doc = app.document, q = (s) => doc.querySelector(s), qa = (s) => [...doc.querySelectorAll(s)];
  app.press(q('.sk-sidebar-btn')); await app.pause(120);
  app.press(q('[data-action="templates"]')); await app.pause(120);
  const cards = qa('.sk-tp-card').map((c) => c.dataset.template);
  eq(cards.indexOf('spur-gear'), cards.indexOf('bolt-circle') + 1, 'the picker: the Spur gear card after the Bolt circle');
  eq(q('.sk-tp-card[data-template="spur-gear"] .sk-tp-name').textContent, 'Spur gear', 'the card is named Spur gear');
  app.press(q('.sk-tp-card[data-template="spur-gear"]')); await app.pause(200);
  eq(qa('.sk-tp-start[data-template="spur-gear"] .sk-tp-field').map((f) => f.dataset.param), ['teeth', 'module', 'pressureAngle', 'bore', 'backlash'], 'the start view: a field for every param');
  const choice = qa('.sk-tp-field[data-param="pressureAngle"] .sk-tp-choice button');
  eq(choice.map((b) => [b.dataset.value, b.getAttribute('aria-label'), !!b.querySelector('svg polygon')]), [['20', '20 deg pressure angle', true], ['14.5', '14.5 deg pressure angle', true]], 'the pressure angle: a glyph picker of the two rack angles');
} finally { await app.close(); }

console.log(report.join('\n'));
console.log(`spur-gear-840-doc-node: ${checks} checks passed`);
