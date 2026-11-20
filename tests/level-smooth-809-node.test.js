// tests/level-smooth-809-node.test.js — TASK 809 (owner turns 2655, 2660-2661): SMOOTHING, a toolpath setting of Roughing and Contour (#core/level-smooth.js,
// its header). Every outline and mesh is BUILT IN THE TEST (never the owner's files).
//  1. THE FIT (fitClosed / smoothRing): a traced circle (a 0.3 mm polyline with a +-0.03 mm stair-like ripple) at 0.1 mm: far fewer pieces; every sample of
//     the curve (0.001 mm chords) within the tolerance of the traced polyline and every traced point within it of the curve; G1 at every join of two
//     cubics; a traced square keeps its 4 corners (and turns nowhere else); 0 = the traced polyline itself. smoothingOf: the defaults (Roughing 0.1,
//     Contour 0.05: TASK 810, owner turn 2688, was 0.02), 0 = off, any other op 0.
//  2. NO TOUCHING (smoothRegions): two islands 0.06 mm apart and a hole 0.05 mm inside an outline, at 0.1 mm: no ring touches another or itself, every
//     curve within the tolerance of the traced rings; a slot with sharp corners is kept (a corner is a corner); a FEATURE SMALLER THAN THE TOLERANCE
//     VANISHES: a 0.06 mm bump with no corner is not followed, an island of less than tol² goes.
//  3. CONTOUR on a sliced dome and a stepped boss (vertical walls shared by levels: the traced loops of two levels touch there): per level, no loop
//     touches another or itself; every loop lies in the next level's smoothed material, to Clipper's 0.001 mm grid (a shared wall is ONE curve); every curve within
//     the tolerance of the traced loops of its level; a traced point outside the smoothed material (the curve gone INTO the material) by at most the
//     tolerance.
//  4. ROUGHING: each pocket element smoothed: its rings within the tolerance of the traced element, never touching each other or themselves.
//  5. OFF: smoothing 0 = the paths of before (the same derivation, straight segments only).
//  6. THE APP (tests/helpers/node-app.js): Open STL (a dome) -> a Roughing record without `smoothing` cuts with its default 0.1 mm (the export has cubics,
//     the card's Smoothing row shows 0.1); typing 0 = one undo step, the export of polylines (no cubic), the levels untouched (the same height map);
//     undo puts the default back; a Contour of the part (its card shows 0.05, TASK 810); a Smoothing other than the default = another operation; the record's
//     `smoothing` is saved with the design.
import assert from 'node:assert';
import SettingsManager from '#core/settings-manager.js';
import { LEVEL_SMOOTH, smoothingOf, fitClosed, smoothRing, smoothRegions, ringsTouch, ringsCross, ringSelfTouch } from '#core/level-smooth.js';
import { readLevels, levelsContour, levelsRoughing } from '#core/stepped-cut.js';
import { levelsHeightMap } from '#core/height-map.js';
import { sliceStl } from '#core/stl-slice.js';
import { polyToPathD } from '#core/loop-geometry.js';
import * as M from './helpers/stl-mesh.js';
import { open, createProfile, createNamedDesign } from './helpers/node-app.js';
import { worldToScreen } from '#ui/coords.js';
import { CUT_PLAN, cutPlanEntries, contourKeyOf, deriveKeyFootprints, loopsWithPolygons, planOwnedLoops } from '../apps/shaper/src/cut-plan.js';
import { shaperSvgOf } from '../apps/shaper/src/export-payload.js';
import { planOperations } from '../apps/shaper/src/operations.js';

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };
SettingsManager.set('DOC_UNIT', 'mm');

// ── measuring helpers (plain brute force: the test's own arithmetic) ──
const segDist = (p, a, b) => { const vx = b[0] - a[0], vy = b[1] - a[1], L = vx * vx + vy * vy; let t = L ? ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / L : 0; t = Math.max(0, Math.min(1, t)); return Math.hypot(p[0] - a[0] - t * vx, p[1] - a[1] - t * vy); };
const closed = (R) => (R[0][0] === R[R.length - 1][0] && R[0][1] === R[R.length - 1][1] ? R : [...R, R[0]]);
const distTo = (p, rings) => { let m = Infinity; for (const R of rings) { const C = closed(R); for (let i = 0; i + 1 < C.length; i++) m = Math.min(m, segDist(p, C[i], C[i + 1])); } return m; };
const inside = (p, rings) => { let c = false; for (const R of rings) { const C = closed(R); for (let i = 0; i + 1 < C.length; i++) { const a = C[i], b = C[i + 1]; if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c; } } return c; };
const bez = (s, t) => { if (s.line) return [s.p0.x + (s.p3.x - s.p0.x) * t, s.p0.y + (s.p3.y - s.p0.y) * t]; const u = 1 - t; return [u * u * u * s.p0.x + 3 * u * u * t * s.c1.x + 3 * u * t * t * s.c2.x + t * t * t * s.p3.x, u * u * u * s.p0.y + 3 * u * u * t * s.c1.y + 3 * u * t * t * s.c2.y + t * t * t * s.p3.y]; };
// the curve sampled at chords of at most `step` mm of its control polygon (fine enough for a 0.001 mm reading on these sizes)
const curvePts = (segs, n = 64) => segs.flatMap((s) => (s.line ? [bez(s, 0), bez(s, 0.5)] : Array.from({ length: n }, (_, k) => bez(s, k / n))));
const maxDist = (pts, rings) => pts.reduce((m, p) => Math.max(m, distTo(p, rings)), 0);
const flat = (R) => R.map((p) => [p[0], p[1]]);
const tangentAt = (s, end) => { const [a, b] = s.line ? [s.p0, s.p3] : end ? [s.c2, s.p3] : [s.p0, s.c1]; const L = Math.hypot(b.x - a.x, b.y - a.y); return [(b.x - a.x) / L, (b.y - a.y) / L]; };

// ── 1. the fit ──
eq([smoothingOf('roughing'), smoothingOf('contour'), smoothingOf('roughing', 0), smoothingOf('contour', 0.05), smoothingOf('roughing', -1), smoothingOf('pocket', 0.1)], [0.1, 0.05, 0, 0.05, 0, 0], 'smoothingOf: the defaults (Roughing 0.1, Contour 0.05: TASK 810, owner turn 2688), 0 / negative = off, another op 0');
eq([LEVEL_SMOOTH.roughingMm, LEVEL_SMOOTH.contourMm], [0.1, 0.05], 'the declared defaults (owner turn 2661; the Contour 0.05: TASK 810, owner turn 2688)');
const ripple = (i) => 0.03 * Math.sin(i * 2.3) * Math.cos(i * 0.7); // a deterministic stair-like ripple of at most 0.03 mm
const tracedCircle = (cx, cy, r, step = 0.3) => { const n = Math.round((2 * Math.PI * r) / step); return Array.from({ length: n }, (_, i) => { const a = (2 * Math.PI * i) / n, rr = r + ripple(i); return [cx + rr * Math.cos(a), cy + rr * Math.sin(a)]; }); };
{
  const T = tracedCircle(30, 30, 20), tol = 0.1;
  const segs = fitClosed(T, tol);
  ok(segs.length > 0 && segs.length * 8 < T.length, `the circle: ${segs.length} pieces for ${T.length} traced points`);
  const cubics = segs.filter((s) => !s.line);
  ok(cubics.length === segs.length, 'the circle: all cubics (no corner, no stair followed)');
  segs.forEach((s, i) => { const n = segs[(i + 1) % segs.length]; ok(Math.hypot(s.p3.x - n.p0.x, s.p3.y - n.p0.y) < 1e-9, `the circle: piece ${i} ends where the next starts`); });
  const d1 = maxDist(curvePts(segs), [T]), d2 = maxDist(T, [curvePts(segs)]);
  ok(d1 <= tol, `the circle: every sample of the curve within ${tol} of the traced outline (${d1.toFixed(4)})`);
  ok(d2 <= tol, `the circle: every traced point within ${tol} of the curve (${d2.toFixed(4)})`);
  let g1 = 0;
  segs.forEach((s, i) => { const n = segs[(i + 1) % segs.length], a = tangentAt(s, true), b = tangentAt(n, false); g1 = Math.max(g1, Math.hypot(a[0] - b[0], a[1] - b[1])); });
  ok(g1 < 1e-6, `the circle: G1 at every join (largest tangent jump ${g1.toExponential(1)})`);
  const R = smoothRing(T, tol);
  eq([R.tol, R.segs, R.poly[0], R.poly[R.poly.length - 1]], [tol, R.segs, R.poly[0], R.poly[0]], 'smoothRing: its tolerance, its cubics, its polygon closed');
  ok(maxDist(curvePts(R.segs), [T]) <= tol, 'smoothRing: within the tolerance (fitted within LEVEL_SMOOTH.fitShare of it)');
  const off = smoothRing(T, 0);
  eq([off.tol, off.segs.length, off.segs.every((s) => s.line)], [0, T.length, true], 'tolerance 0: the traced polyline itself, one straight piece per traced segment');
}
{
  const sq = []; // a traced 20 mm square, 0.25 mm points, the same ripple
  for (let i = 0; i < 80; i++) sq.push([10 + i * 0.25, 10 + ripple(i)]);
  for (let i = 0; i < 80; i++) sq.push([30 + ripple(i + 80), 10 + i * 0.25]);
  for (let i = 0; i < 80; i++) sq.push([30 - i * 0.25, 30 + ripple(i + 160)]);
  for (let i = 0; i < 80; i++) sq.push([10 + ripple(i + 240), 30 - i * 0.25]);
  const segs = fitClosed(sq, 0.1), turns = [];
  segs.forEach((s, i) => { const n = segs[(i + 1) % segs.length], a = tangentAt(s, true), b = tangentAt(n, false); const deg = (Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1]))) * 180) / Math.PI; if (deg > 1) turns.push({ deg, at: [n.p0.x, n.p0.y] }); });
  eq(turns.length, 4, `the square: 4 corners (${turns.map((t) => t.deg.toFixed(0)).join(', ')} degrees), G1 everywhere else`);
  for (const t of turns) ok(t.deg > 75 && t.deg < 105 && // the sides' directions are read from the traced points within LEVEL_SMOOTH.cornerSpanMm of the corner (the ripple tilts them a few degrees)
     [[10, 10], [30, 10], [30, 30], [10, 30]].some((c) => Math.hypot(c[0] - t.at[0], c[1] - t.at[1]) <= 0.1), `the square: a corner of ${t.deg.toFixed(1)} degrees at a traced corner (${t.at.map((v) => v.toFixed(2))})`);
  ok(segs.length <= 12, `the square: ${segs.length} pieces for 320 traced points`);
  ok(maxDist(curvePts(segs), [sq]) <= 0.1, 'the square: within the tolerance');
}

// ── 2. no touching; features smaller than the tolerance vanish ──
const ring = (pts) => closed(pts.map((p) => [p[0], p[1]]));
const allRings = (regions) => regions.flatMap((g) => [g.outer, ...g.holes]);
const touchFree = (rings, m) => {
  rings.forEach((r, i) => ok(!ringSelfTouch(r.poly), `${m}: ring ${i} does not touch itself`));
  for (let i = 0; i < rings.length; i++) for (let j = i + 1; j < rings.length; j++) ok(!ringsTouch(rings[i].poly, rings[j].poly), `${m}: rings ${i} and ${j} do not touch`);
};
{
  const a = M.circle(10, 10, 5, 200), b = M.circle(20.06, 10, 5, 200); // two islands, their outlines 0.06 mm apart at the closest
  const gap = Math.min(...a.map((p) => distTo(p, [b])));
  ok(gap > 0 && gap < 0.1, `two islands ${gap.toFixed(3)} mm apart (closer than the tolerance)`);
  const S = smoothRegions([{ outer: ring(a), holes: [] }, { outer: ring(b), holes: [] }], 0.1);
  touchFree(allRings(S), 'two close islands');
  for (const r of allRings(S)) ok(maxDist(r.poly, [a, b]) <= 0.1, 'two close islands: every curve within the tolerance of the traced rings');
  const box = [[0, 0], [40, 0], [40, 30], [0, 30]], hole = [[0.05, 5], [0.05, 25], [10, 25], [10, 5]]; // a hole whose left side is 0.05 mm inside the outline
  const S2 = smoothRegions([{ outer: ring(box), holes: [ring(hole)] }], 0.1);
  touchFree(allRings(S2), 'a hole 0.05 mm inside the outline');
  const slot = [[0, 0], [20, 0], [20, 20], [10.02, 20], [10.02, 15], [9.98, 15], [9.98, 20], [0, 20]]; // a 0.04 mm slot, 5 mm deep: its corners are real corners
  const S3 = smoothRegions([{ outer: ring(slot), holes: [] }], 0.1);
  eq(S3.length, 1, 'the slotted square: one region');
  ok(distTo([10, 15], [S3[0].outer.poly]) <= 0.1 && maxDist(S3[0].outer.poly, [slot]) <= 0.1, 'a slot with sharp corners (a turn of 60 degrees or more) is kept: its corners are corners');
  // a FEATURE SMALLER THAN THE TOLERANCE VANISHES: a 0.06 mm bump 1 mm wide (no corner) on a 20 mm side is not followed; an island of less than tol² goes
  const bumped = [];
  for (let i = 0; i <= 80; i++) { const x = i * 0.25, h = Math.abs(x - 10) < 0.5 ? 0.06 * Math.cos(Math.PI * (x - 10)) ** 2 : 0; bumped.push([x, -h]); }
  bumped.push([20, 20], [0, 20]);
  const S4 = smoothRegions([{ outer: ring(bumped), holes: [] }], 0.1);
  const dip = Math.min(...S4[0].outer.poly.filter((p) => Math.abs(p[0] - 10) < 0.6).map((p) => p[1]));
  ok(dip > -0.045, `a bump of 0.06 mm (smaller than the tolerance) is smoothed away: the curve reaches ${dip.toFixed(3)} there`);
  ok(maxDist(S4[0].outer.poly, [bumped]) <= 0.1, 'the bumped side: the curve within the tolerance of the traced outline');
  const S5 = smoothRegions([{ outer: ring(box), holes: [] }, { outer: ring([[50, 15], [50.05, 15], [50.05, 15.05], [50, 15.05]]), holes: [] }], 0.1);
  eq(S5.length, 1, 'an island of 0.0025 mm² (less than tol²) vanishes');
}

// ── 3. Contour: nesting, touching, deviation, the material ──
const slicedLevels = (tris) => { const r = sliceStl(tris, { name: 'part.stl' }); assert.ok(r.ok, r.message); return readLevels(r.payload.regions[0].levels); };
const moon = (r) => M.circle(25, 25, r, 96).map(([x, y]) => [Math.max(18, x), y]); // a disc cut straight at x = 18
const stepped = () => M.lofted({ outer: [ // three stacked discs cut at the same x = 18: one vertical wall through three levels, arcs elsewhere
  { z: 12, pts: moon(10) }, { z: 8, pts: moon(10) }, { z: 8, pts: moon(16) }, { z: 4, pts: moon(16) }, { z: 4, pts: moon(22) }, { z: 0, pts: moon(22) }] });
for (const [name, tris, tol] of [['the dome', M.dome(30), 0.02], ['the dome', M.dome(30), 0.1], ['the stepped boss', stepped(), 0.02], ['the stepped boss', stepped(), 0.1]]) {
  const levels = slicedLevels(tris), m = `${name} at ${tol} mm`;
  const T0 = levelsContour(levels, { step: 0.25 }), T1 = levelsContour(levels, { step: 0.25, smoothing: tol });
  ok(T1.paths.length > 0 && T1.paths.every((p) => p.ring && p.ring.segs.length), `${m}: ${T1.paths.length} passes, each a smoothed ring`);
  const exact = new Map(T0.steps.map((s) => [s.depth, s.outline.map((l) => l.polygon.map((p) => [p.x, p.y]))]));
  let dev = 0, into = 0, outside = 0, cross = 0, outMax = 0;
  T1.steps.forEach((st, k) => {
    const E = exact.get(st.depth);
    ok(E, `${m}: level ${st.depth} is a level of the exact Contour too`);
    const rings = st.outline.map((l) => l.ring);
    touchFree(rings, `${m} level ${st.depth}`);
    const mine = rings.map((r) => r.poly);
    for (const l of st.loops) for (let i = 0; i < l.ring.poly.length; i += 2) dev = Math.max(dev, distTo(l.ring.poly[i], E));
    for (const P of E) for (let i = 0; i < P.length; i += 2) if (!inside(P[i], mine)) into = Math.max(into, distTo(P[i], mine));
    const next = T1.steps[k + 1];
    if (next) {
      const N = next.outline.map((l) => l.ring.poly);
      for (const l of st.loops) {
        for (const q of N) if (ringsCross(l.ring.poly, q)) cross++;
        for (let i = 0; i < l.ring.poly.length; i += 3) { const p = l.ring.poly[i]; if (!inside(p, N)) { const d = distTo(p, N); outMax = Math.max(outMax, d); if (d > 1e-6) outside++; } }
      }
    }
  });
  ok(dev <= tol, `${m}: every curve within the tolerance of its level's traced loops (largest ${dev.toFixed(4)} mm)`);
  ok(into <= tol, `${m}: into the material by at most the tolerance (largest ${into.toFixed(4)} mm)`);
  ok(outMax <= 1e-3, `${m}: every loop inside the next level's smoothed material, to Clipper's 0.001 mm grid (${outside} sampled points outside it, by at most ${outMax.toFixed(4)} mm; ${cross} crossings of that size)`);
}

// ── 4. Roughing ──
{
  const levels = slicedLevels(stepped()), tol = 0.1;
  const R = levelsRoughing(levels, { outer: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: -50 }, { x: 0, y: -50 }], step: 1, toolDia: 3.175 });
  let n = 0;
  for (const p of R.paths) for (const reg of p.regions) {
    const S = smoothRegions([reg], tol);
    for (const g of S) {
      touchFree([g.outer, ...g.holes], `Roughing element ${n}`);
      for (const r of [g.outer, ...g.holes]) ok(maxDist(r.poly, [reg.outer, ...reg.holes]) <= tol, `Roughing element ${n}: within the tolerance of the traced element`);
    }
    n++;
  }
  ok(n >= 3, `Roughing: ${n} pocket elements smoothed`);
}

// ── 5. off ──
{
  const levels = slicedLevels(M.dome(30));
  const A = levelsContour(levels, { step: 0.25 }), B = levelsContour(levels, { step: 0.25, smoothing: 0 });
  eq(B, A, 'smoothing 0: the very Contour of before (one derivation, memoised)');
  ok(A.paths.every((p) => p.ring === null), 'smoothing 0: no smoothed ring on any pass');
}

// ── 6. the app ──
{
  CUT_PLAN.clear();
  const profile = await createProfile();
  await createNamedDesign(profile, 'shaper', 'Smoothing 809');
  const app = await open({ host: 'shaper', profile });
  try {
    const doc = app.document, q = (s) => doc.querySelector(s), st = app.state;
    const pressEl = (s) => { const e = q(s); assert(e, s + ' not found'); app.press(e); };
    const pc = doc.getElementById('prepare-canvas');
    const clickAt = (x, y) => { const p = worldToScreen(pc, { x, y }); app.click(Math.round(p.x), Math.round(p.y), { target: pc }); };
    const setField = (sel, text) => { const inp = q(sel); inp.value = text; inp.dispatchEvent(new app.window.Event('change')); };
    const rowShown = (name) => { const r = q(`.cut-row[data-row="${name}"]`); return Boolean(r) && r.style.display !== 'none'; };
    const res = app.stl.openFile(M.binaryStl(M.dome(30)), 'dome.stl');
    ok(res.ok, 'Open STL: the dome');
    const [key, rec] = [...CUT_PLAN.entries()].find(([, r]) => r.cutType === 'roughing');
    eq('smoothing' in rec, false, 'the Roughing record has no smoothing of its own: the default');
    const levelsJson = JSON.stringify(rec.levels), mapBefore = levelsHeightMap(rec.levels).href;
    clickAt(30, -30);
    eq(q('.cut-type-cur').textContent, 'Roughing', 'its card');
    ok(rowShown('smoothing'), 'the Smoothing row (a part with levels)');
    eq([q('.cut-row[data-row="smoothing"] .cut-field-label').textContent, q('.cut-smoothing').value], ['Smoothing', '0.1'], 'Smoothing: 0.1 (the default)');
    const svgOf = () => shaperSvgOf(st, cutPlanEntries());
    const cubicsIn = (svg) => (svg.match(/ C /g) || []).length;
    const on = svgOf();
    ok(cubicsIn(on) > 0, `the export: the smoothed paths are cubics (${cubicsIn(on)} C commands)`);
    const { loops, loopPolys } = loopsWithPolygons(st), owned = planOwnedLoops(st, loops, loopPolys);
    const d0 = deriveKeyFootprints(key, CUT_PLAN.get(key), st, loops, loopPolys, owned);
    ok(d0.cuts.length > 0 && d0.cuts.every((c) => /C /.test(c.geom.a)), 'Prepare / the 3D Review / the Paths view derive the same smoothed cuts (each path written with cubics)');
    const hist = st.history.length;
    setField('.cut-smoothing', '0');
    eq(CUT_PLAN.get(key).smoothing, 0, 'typed 0: the record keeps 0 (off)');
    eq(st.history.length, hist + 1, 'one undo step');
    const offSvg = svgOf();
    eq(cubicsIn(offSvg), 0, 'off: the export has no cubic (the straight segments of the levels)');
    const d1 = deriveKeyFootprints(key, CUT_PLAN.get(key), st, loops, loopPolys, owned);
    ok(d1.cuts.every((c) => c.geom.a === `d="${[c.outerPoly, ...c.holePolys].map(polyToPathD).join(' ')}"`), 'off: every path is its polygon as before (polyToPathD)');
    eq([JSON.stringify(CUT_PLAN.get(key).levels), levelsHeightMap(CUT_PLAN.get(key).levels).href], [levelsJson, mapBefore], 'the levels are never changed: the same levels, the same height map');
    eq(q('.cut-smoothing').value, '0', 'the row shows 0');
    doc.getElementById('btn-undo').click();
    eq(CUT_PLAN.get(key).smoothing, undefined, 'undo: the default again');
    ok(cubicsIn(svgOf()) > 0, 'undo: cubics again');
    // the part's Contour: its own Smoothing (0.05 by default: TASK 810, owner turn 2688)
    pressEl('.cut-row[data-row="contour"] .cut-preset[data-value="true"]');
    pressEl('.cut-contour-edit');
    eq(q('.cut-type-cur').textContent, 'Contour', 'Edit contour: the Contour card');
    ok(rowShown('smoothing'), 'the Contour card: its Smoothing row (its part has levels)');
    eq(q('.cut-smoothing').value, '0.05', 'the Contour: 0.05 (its default)');
    const crec = CUT_PLAN.get(contourKeyOf(key));
    eq('smoothing' in crec, false, 'the Contour record: the default, not stored');
    const ops = () => planOperations(st, cutPlanEntries()).map((o) => o.cutType);
    eq(ops(), ['roughing', 'contour'], 'two operations');
    setField('.cut-smoothing', '0.03');
    eq(CUT_PLAN.get(contourKeyOf(key)).smoothing, 0.03, 'the Contour at 0.03');
    ok(planOperations(st, cutPlanEntries()).some((o) => o.settings && o.settings.smoothing === 0.03), 'a Smoothing other than the default is in the operation\'s settings (its own operation)');
    const saved = await app.storedDoc();
    const plan = new Map(saved.hosts.shaper.cutPlan);
    eq(plan.get(contourKeyOf(key)).smoothing, 0.03, 'saved with the design');
  } finally { await app.close(); }
}

console.log(`level-smooth-809-node: ${checks} checks passed`);
