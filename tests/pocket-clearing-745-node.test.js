// tests/pocket-clearing-745-node.test.js — TASK 745: the PROGRAMMED POCKET (#core/pocket-clearing.js through THE cut derivation #core/stepped-cut deriveCuts:
// the export, the Prepare look and the 3D Review read the same cuts) and the Operations list's delete bin.
//  1. the rules on a rectangle, an L, a circle, a pocket with an island and a dumbbell (a neck narrower than the bit), bit 6 mm, stepover 40 %, allowance 0.5:
//     Spiral (TASK 749: 745's Concentric rings, joined; Loop off: TASK 750's Loop is pocket-clearing-750-node): every ring of every line,
//     ring k (level k) = the region offset by r + allowance + k * stepover within 0.01 mm (every vertex), splits on the dumbbell; Raster at 0 / 45 / 90 deg: every pass inside the inset region, the passes one stepover apart, along the angle, zigzag, + the clean-up ring;
//     Morphed spiral: ONE open path, every turn within one stepover of the next one out (sampled), inside the inset region, the last turn = the inset
//     contour; refused with its reason on the island pocket and the dumbbell; for every pattern the swept area covers the region minus the reported
//     leftover (sampled on a 0.5 mm grid), the rectangle's leftover = its 4 corners (4 (1 - pi / 4) r²), the dumbbell's neck reported.
//  2. the export: Freehand = byte-identical (deriveCuts returns the SAME array; a record with clearing 'freehand' and settings writes the same file as one
//     without); Spiral (Loop off) = its open on-line lines ONCE at the full depth (TASK 750: no depth per pass) + the wall as an inside cut on the pocket's own loop + islands as outside cuts; depth
//     passes repeat the ring set at each pass depth; the preview copy's data-clear, never in the download.
//  3. the app: the Clearing dropdown (one undo step, the defaults, the rows, the note, the stepper), the spiral greyed with its reason on an island pocket,
//     the operations list's one row, save + reload byte-identical, inch defaults; the bin of an operation with 2 regions unassigns both in ONE undo step.
import assert from 'node:assert';
import { hintFor } from '../apps/shaper/src/hint.js'; // TASK 805: the tooltip's text (hints are no longer laid out in the card)
import { open, createProfile, createNamedDesign } from './helpers/node-app.js';
import { worldToScreen } from '#ui/coords.js';
import SettingsManager from '#core/settings-manager.js';
import { exportShaperSVG } from '#core/shaper-export.js';
import { findLoops } from '#core/loop-finder.js';
import { loopPolygon } from '#core/loop-geometry.js';
import { deriveCuts } from '#core/stepped-cut.js';
import { deriveProfileCuts, deriveCutFootprint } from '#core/profile-model.js';
import { POCKET_CLEARING, planClearing, clearingSettings, pocketRings, applyPocketClearing } from '#core/pocket-clearing.js';
import { planEntries, keyOf, planReliefItems } from '../apps/shaper/src/cut-plan.js';
import { exportEncoding } from '../apps/shaper/src/shaper.js';
import { shaperSvgOf } from '../apps/shaper/src/export-payload.js';
import { V2_PLAN, storedRecords } from './helpers/plan-v2.js'; // TASK S1: the test's v2 document of the plan, loaded through applyShaperDoc
import { clickOpen, editStep } from './helpers/prepare-open.js'; // TASK S2: an operation is opened to edit it


let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
// TASK 825: the card lists its warning lines (the leftover and its reason) FIRST; facts() = the note without them
const facts = (n) => n.filter((l) => !/^Leftover: |^Sharp inside corners|of it missed between passes/.test(l));
const ok = (c, m) => { assert.ok(c, m); checks++; };
const near = (a, b, tol, m) => { assert.ok(Math.abs(a - b) <= tol, `${m}: ${a} vs ${b} (tol ${tol})`); checks++; };
const BIT = 6, R = BIT / 2, ALLOW = 0.5, S = 0.4 * BIT, D0 = R + ALLOW;

function polyState(loops, circles = []) {
  const joints = new Map(), shapes = [];
  loops.forEach((pts, li) => pts.forEach((p, i) => {
    joints.set(`j${li}_${i}`, { x: p[0], y: p[1] });
    shapes.push({ id: `s${li}_${i}`, type: 'line', joints: [`j${li}_${i}`, `j${li}_${(i + 1) % pts.length}`] });
  }));
  for (const [id, c, r] of circles) { joints.set(id + 'o', { x: c[0], y: c[1] }); shapes.push({ id, type: 'circle', joints: [id + 'o'], radius: r }); }
  return { joints, shapes, constraints: [], groups: [], profiles: [] };
}
const RECT = [[0, 0], [100, 0], [100, 60], [0, 60]];
const LSHAPE = [[0, 0], [100, 0], [100, 40], [40, 40], [40, 100], [0, 100]];
const ISLAND = [[40, 20], [60, 20], [60, 40], [40, 40]];
const DUMBBELL = [[0, 0], [40, 0], [40, 18], [60, 18], [60, 0], [100, 0], [100, 40], [60, 40], [60, 22], [40, 22], [40, 40], [0, 40]]; // a 4 mm neck: narrower than the 6 mm bit
const SHAPES = {
  rectangle: () => polyState([RECT]),
  L: () => polyState([LSHAPE]),
  circle: () => polyState([], [['c', [50, 50], 30]]),
  island: () => polyState([RECT, ISLAND]),
  dumbbell: () => polyState([DUMBBELL]),
};
const polysOf = (st) => { const by = new Map(st.shapes.map((s) => [s.id, s])); const lp = {}; for (const l of findLoops(st)) lp[l.id] = loopPolygon(l, st, by); return lp; };
const outerLoopOf = (st) => { const loops = findLoops(st); return loops.reduce((a, l) => (Math.abs(area(polysOf(st)[l.id])) > Math.abs(area(polysOf(st)[a.id])) ? l : a), loops[0]); };
function area(pts) { let a = 0; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j].x * pts[i].y - pts[i].x * pts[j].y; return a / 2; }
const POCKET = (more = {}) => ({ cutType: 'pocket', cutDepth: 6, cutOffset: 0, toolDia: BIT, cutterShape: 'endmill', stepover: 40, finishAllowance: ALLOW, rasterAngle: 0, ...more });
const cutsOf = (st, rec) => { const loops = findLoops(st); return deriveCuts({ kind: 'loop', id: outerLoopOf(st).id }, rec, st, loops, polysOf(st), new Set()); };
const exportOf = (st, rec, options = {}) => exportShaperSVG({ state: st, entries: [{ target: { kind: 'loop', id: outerLoopOf(st).id }, rec }], encoding: exportEncoding(), docUnit: 'mm', options, loopPolys: polysOf(st) });

// geometry checks against the pocket's EXACT boundary (its loops' walks: arcs to 0.005 mm)
const distSeg = (p, a, b) => { const vx = b.x - a.x, vy = b.y - a.y, L = vx * vx + vy * vy; const t = L ? Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / L)) : 0; return Math.hypot(p.x - a.x - t * vx, p.y - a.y - t * vy); };
const distPolyline = (p, pts, closed) => { let m = Infinity; const n = closed ? pts.length : pts.length - 1; for (let i = 0; i < n; i++) m = Math.min(m, distSeg(p, pts[i], pts[(i + 1) % pts.length])); return m; };
const inPoly = (p, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c; } return c; };
function regionOf(st) {
  const pocket = deriveProfileCuts({ kind: 'loop', id: outerLoopOf(st).id }, { cutType: 'pocket' }, st, findLoops(st), polysOf(st)).find((c) => c.isCompound);
  const rings = pocketRings(pocket, st);
  const toXY = (ring) => ring.slice(0, -1).map(([x, y]) => ({ x, y }));
  const outer = toXY(rings.outer), holes = rings.holes.map(toXY);
  return { rings, outer, holes, inside: (p) => inPoly(p, outer) && !holes.some((h) => inPoly(p, h)), dist: (p) => Math.min(distPolyline(p, outer, true), ...holes.map((h) => distPolyline(p, h, true))) };
}
const regionsHit = (regions, p) => regions.some((g) => inPoly(p, g.outer.map(([x, y]) => ({ x, y }))) && !g.holes.some((h) => inPoly(p, h.map(([x, y]) => ({ x, y })))));
// the swept area covers the region minus the reported leftover: every point of a 0.5 mm grid inside the region is within r of a cut path, or in the leftover
function coverage(name, reg, plan) {
  const paths = [...plan.clear.map((c) => ({ pts: c.points, closed: c.closed })), ...plan.wall.map((pts) => ({ pts, closed: true })), ...plan.islands.flat().map((pts) => ({ pts, closed: true }))];
  const xs = reg.outer.map((p) => p.x), ys = reg.outer.map((p) => p.y);
  let inside = 0, missed = 0, worst = null;
  for (let x = Math.min(...xs) + 0.25; x < Math.max(...xs); x += 0.5) for (let y = Math.min(...ys) + 0.25; y < Math.max(...ys); y += 0.5) {
    const p = { x, y };
    if (!reg.inside(p)) continue;
    inside++;
    if (paths.some((q) => distPolyline(p, q.pts, q.closed) <= R + 0.01)) continue;
    if (regionsHit(plan.leftover.regions, p)) continue;
    // on the leftover's edge (its slivers are filtered at 0.01 mm): allowed within 0.02 mm of the swept edge
    if (paths.some((q) => distPolyline(p, q.pts, q.closed) <= R + 0.03)) continue;
    missed++; worst = p;
  }
  eq(missed, 0, `${name}: the swept area covers the region minus the reported leftover (${inside} grid points; first miss ${JSON.stringify(worst)})`);
}

// ── 1. the rules ──
const settings = (pattern, more = {}) => ({ ...clearingSettings(POCKET({ clearing: pattern, ...more })), pattern });
eq([POCKET_CLEARING.stepoverPct.default, POCKET_CLEARING.finishAllowance.mm, POCKET_CLEARING.finishAllowance.in, POCKET_CLEARING.rasterAngle.default, POCKET_CLEARING.rasterAngle.fallback, POCKET_CLEARING.feedMmPerMin], [40, 0.5, 0.508, 'auto', 0, 1000], 'declared: stepover 40 %, allowance 0.5 mm / 0.02 in, raster auto (0 fallback), the time at 1000 mm/min');
const results = {};
for (const [name, mk] of Object.entries(SHAPES)) {
  const st = mk(), reg = regionOf(st);
  // Spiral (TASK 749: the rings joined; Loop off: the wall is 745's finish pass)
  const conc = planClearing(reg.rings, settings('linked'));
  results[name] = { conc };
  eq(conc.refused, null, `${name}: Spiral is programmed`);
  const spans = conc.clear.flatMap((c) => c.rings.map((g) => ({ ...g, pts: c.points.slice(g.start, g.end + 1) })));
  ok(conc.levels > 0 && spans.length === conc.loops && conc.clear.length === conc.lines, `${name}: ${conc.levels} rings, ${conc.loops} loops in ${conc.lines} lines`);
  ok(conc.clear.every((c) => !c.closed && c.role === 'linked') && spans.every((g) => g.pts.length >= 4 && g.pts[0] === g.pts[g.pts.length - 1]), `${name}: every line open, every ring of it a full loop`);
  let worstRing = 0;
  for (const g of spans) for (const p of g.pts) worstRing = Math.max(worstRing, Math.abs(reg.dist(p) - (D0 + g.level * S)));
  ok(worstRing <= 0.01, `${name}: ring k is the region offset by r + allowance + k * stepover within 0.01 mm (worst ${worstRing.toFixed(5)} mm)`);
  ok(conc.clear.every((c) => c.rings.every((g, i) => i === 0 || g.level === c.rings[i - 1].level - 1)), `${name}: inside out (each line from its innermost ring out)`);
  coverage(`${name} spiral`, reg, conc);
  // Raster at 0 / 45 / 90
  for (const angle of [0, 45, 90]) {
    const ras = planClearing(reg.rings, settings('raster', { rasterAngle: angle }));
    eq(ras.refused, null, `${name}: Raster ${angle} is programmed`);
    // TASK 835e: the passes are joined into open zigzags (one per area where every join can be made); the passes themselves: plan.passLines (their offset
    // across the passes, as rasterPasses gives it)
    const passes = ras.passLines.map((l) => ({ points: l.points, closed: false, offset: l.offset })), cleanup = ras.clear.filter((c) => c.role === 'cleanup');
    const zz = ras.clear.filter((c) => c.role === 'raster');
    ok(zz.length >= 1 && zz.every((c) => !c.closed) && zz.reduce((n, c) => n + c.turns.filter((t) => t.kind === 'pass').length, 0) >= passes.length, `${name} raster ${angle}: ${zz.length} open zigzag(s) holding the ${passes.length} passes (a pass a cut between pieces splits: two chords; each pass once: tests/pocket-raster-loop-835-node.test.js)`);
    ok(passes.length > 0 && passes.length === ras.passes && cleanup.length === ras.cleanup && cleanup.length >= 1, `${name} raster ${angle}: ${passes.length} passes + ${cleanup.length} clean-up ring(s)`);
    ok(passes.every((c) => !c.closed && c.points.length === 2), `${name} raster ${angle}: each pass is one open straight path`);
    let worstIn = Infinity;
    for (const c of passes) for (let t = 0; t <= 1; t += 0.05) { const a = c.points[0], b = c.points[1], p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }; ok(reg.inside(p), `${name} raster ${angle}: inside the region`); worstIn = Math.min(worstIn, reg.dist(p)); }
    ok(worstIn >= D0 - 0.01, `${name} raster ${angle}: every pass lies inside the inset region (closest ${worstIn.toFixed(4)} mm >= r + allowance ${D0})`);
    const dir = { x: Math.cos(angle * Math.PI / 180), y: -Math.sin(angle * Math.PI / 180) };
    ok(passes.every((c) => { const a = c.points[0], b = c.points[1], L = Math.hypot(b.x - a.x, b.y - a.y); return Math.abs(Math.abs(((b.x - a.x) * dir.x + (b.y - a.y) * dir.y) / L) - 1) < 1e-6; }), `${name} raster ${angle}: every pass runs along ${angle} deg (on screen, counterclockwise from X)`);
    const offs = [...new Set(passes.map((c) => Math.round(c.offset * 1e6) / 1e6))].sort((a, b) => a - b);
    const steps = offs.slice(1).map((o, i) => (o - offs[i]) / S); // a gap of two or more: no pass there (the inset region is split, e.g. the dumbbell's neck)
    ok(steps.length === 0 || (steps.every((k) => Math.abs(k - Math.round(k)) < 1e-6) && Math.min(...steps.map(Math.round)) === 1), `${name} raster ${angle}: neighbouring passes are exactly one stepover (${S} mm) apart (every gap a whole number of stepovers: ${[...new Set(steps.map(Math.round))]})`);
    // the passes' own spacing measured: the distance between neighbouring parallel passes (the perpendicular gap)
    const nrm = { x: -dir.y, y: dir.x }, proj = (c) => c.points[0].x * nrm.x + c.points[0].y * nrm.y;
    const gaps = [...new Set(passes.map((c) => Math.round(proj(c) * 1e2) / 1e2))].map((g) => passes.map(proj).find((v) => Math.round(v * 1e2) / 1e2 === g)).sort((a, b) => a - b);
    ok(gaps.slice(1).every((g, i) => { const k = Math.round((g - gaps[i]) / S); return k >= 1 && Math.abs(g - gaps[i] - k * S) < 2e-3; }), `${name} raster ${angle}: measured spacing == stepover (to the clipper's 0.001 mm grid)`);
    let zig = true;
    for (let i = 1; i < passes.length; i++) if (passes[i].offset !== passes[i - 1].offset) { const a = passes[i - 1], b = passes[i]; const da = { x: a.points[1].x - a.points[0].x, y: a.points[1].y - a.points[0].y }, db = { x: b.points[1].x - b.points[0].x, y: b.points[1].y - b.points[0].y }; if (da.x * db.x + da.y * db.y >= 0) zig = false; }
    ok(zig, `${name} raster ${angle}: consecutive passes alternate direction (zigzag)`);
    let worstClean = 0;
    for (const c of cleanup) for (const p of c.points) worstClean = Math.max(worstClean, Math.abs(reg.dist(p) - D0));
    ok(worstClean <= 0.01, `${name} raster ${angle}: the clean-up ring is the region offset by r + allowance (worst ${worstClean.toFixed(5)})`);
    coverage(`${name} raster ${angle}`, reg, ras);
    if (angle === 0) results[name].ras = ras;
  }
  // Morphed spiral
  const sp = planClearing(reg.rings, settings('morphed'));
  results[name].sp = sp;
  if (name === 'island') { eq([sp.refused, sp.morphedBlocked, sp.clear.length], ['morphed islands', 'islands', 0], 'island: the morphed spiral is refused: has islands'); continue; }
  // TASK 804: a pocket whose rings split is no longer refused: one morphed spiral per area (the two bells + the rings they share), checked in
  // tests/pocket-nocross-804-node.test.js
  if (name === 'dumbbell') { eq([sp.refused, sp.morphedBlocked, sp.clear.length, sp.linesWhy], [null, null, 2, 'splits'], 'dumbbell: one morphed spiral per bell (TASK 804: its neck is narrower than the bit, so the rings are two areas from the first)'); continue; }
  eq([sp.refused, sp.clear.length, sp.clear[0].role, sp.clear[0].closed], [null, 1, 'morphed', false], `${name}: the morphed spiral is ONE open path`);
  const pts = sp.clear[0].points, starts = sp.clear[0].turnStarts;
  eq(starts.length, conc.levels + 1, `${name}: ${starts.length} turns = the central loop + one per ring out + the closing turn`);
  let worstIn = Infinity;
  for (const p of pts) { ok(reg.inside(p), `${name} spiral: inside the region`); worstIn = Math.min(worstIn, reg.dist(p)); }
  ok(worstIn >= D0 - 0.02, `${name} spiral: inside the inset region (closest ${worstIn.toFixed(4)} mm)`);
  const turn = (j) => pts.slice(starts[j], j + 1 < starts.length ? starts[j + 1] + 1 : pts.length);
  let worstGap = 0;
  for (let j = 0; j + 1 < starts.length; j++) {
    const a = turn(j), b = turn(j + 1);
    for (let i = 0; i + 1 < a.length; i++) {
      const L = Math.hypot(a[i + 1].x - a[i].x, a[i + 1].y - a[i].y), n = Math.max(1, Math.ceil(L / 0.2));
      for (let k = 0; k < n; k++) { const p = { x: a[i].x + ((a[i + 1].x - a[i].x) * k) / n, y: a[i].y + ((a[i + 1].y - a[i].y) * k) / n }; worstGap = Math.max(worstGap, distPolyline(p, b, false)); }
    }
  }
  ok(worstGap <= S + 0.03, `${name} spiral: every turn is within one stepover of the next turn out (worst ${worstGap.toFixed(4)} mm, stepover ${S})`);
  const last = turn(starts.length - 1);
  let worstLast = 0;
  for (const p of last) worstLast = Math.max(worstLast, Math.abs(reg.dist(p) - D0));
  ok(worstLast <= 0.02, `${name} spiral: the closing turn runs along the inset contour (worst ${worstLast.toFixed(4)})`);
  near(Math.hypot(pts[0].x - last[last.length - 1].x, pts[0].y - last[last.length - 1].y) > 0 ? 1 : 0, 1, 0, `${name} spiral: it starts in the middle, not where it ends`);
  coverage(`${name} spiral`, reg, sp);
}
const corner = 4 * (1 - Math.PI / 4) * R * R;
near(results.rectangle.conc.leftover.area, corner, corner * 0.03, 'rectangle: the leftover is its 4 sharp corners, 4 (1 - pi/4) r²');
near(results.rectangle.conc.leftover.missed, 0, 0.1, 'rectangle: nothing missed between rings');
near(results.circle.conc.leftover.area, 0, 0.1, 'circle: no leftover');
ok(results.dumbbell.conc.leftover.area > 50 && results.dumbbell.conc.leftover.unreachable > 50, `dumbbell: the 4 mm neck is reported (${results.dumbbell.conc.leftover.area.toFixed(1)} mm² not reached by the 6 mm bit)`);
ok(results.dumbbell.conc.loops > results.dumbbell.conc.levels, 'dumbbell: the rings split into two areas');
ok(results.island.conc.loops > results.island.conc.levels, 'island: rings round the island too');
{ // a stepover too big for the bit: the pattern misses material, and says so (100 x 66, 100 %: the last ring leaves a 5 mm strip the 3 mm radius cannot reach)
  const reg = regionOf(polyState([[[0, 0], [100, 0], [100, 66], [0, 66]]]));
  const big = planClearing(reg.rings, settings('linked', { stepover: 100 }));
  ok(big.leftover.missed > POCKET_CLEARING.leftoverTolMm2, `spiral at 100 %: ${big.leftover.missed.toFixed(1)} mm² missed between passes, reported`);
  near(planClearing(reg.rings, settings('linked')).leftover.missed, 0, 0.1, 'the same pocket at 40 %: nothing missed');
}
console.log('rules: ' + JSON.stringify(Object.fromEntries(Object.entries(results).map(([k, v]) => [k, { rings: v.conc.levels, loops: v.conc.loops, lines: v.conc.lines, rasterPasses: v.ras.passes, turns: v.sp.turns, leftoverMm2: +v.conc.leftover.area.toFixed(2) }]))));

// ── 2. the export ──
const elementsOf = (svg) => {
  const attrs = (s) => Object.fromEntries([...s.matchAll(/([\w:-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
  const out = []; let group = null;
  for (const line of svg.split('\n').map((l) => l.trim())) {
    if (line.startsWith('<g')) throw new Error('TASK 802: the export has a <g>, every element must carry its own cut attributes: ' + line);
    if (line.startsWith('</g')) { group = null; continue; }
    const m = /^<(path|circle|polygon)\s(.*)\/>$/.exec(line);
    if (!m) continue;
    const a = { ...(group || {}), ...attrs(m[2]) };
    out.push({ tag: m[1], cutType: a['shaper:cutType'], depth: a['shaper:cutDepth'], tool: a['shaper:toolDia'], offset: a['shaper:cutOffset'], d: a.d || null, clear: a['data-clear'] || null });
  }
  return out;
};
{
  const st = SHAPES.island();
  const plain = { cutType: 'pocket', cutDepth: 6, cutOffset: 0, toolDia: BIT };
  const cuts = deriveProfileCuts({ kind: 'loop', id: outerLoopOf(st).id }, plain, st, findLoops(st), polysOf(st));
  ok(applyPocketClearing(cuts, plain, st) === cuts && applyPocketClearing(cuts, { ...plain, clearing: 'freehand', stepover: 30 }, st) === cuts, 'Freehand: applyPocketClearing returns the SAME array (the derivation is untouched)');
  const svg0 = exportOf(st, plain);
  eq(exportOf(st, { ...plain, clearing: 'freehand', stepover: 30, finishAllowance: 1, loop: true, rasterAngle: 45 }), svg0, 'Freehand: byte-identical to a record without clearing (the settings never reach the file)');
  eq(elementsOf(svg0).map((e) => e.cutType), ['pocket'], 'Freehand: one pocket element, as before');
  // Spiral (Loop off), ONCE at the full depth (TASK 750: the Origin's Pass Depth / AutoPass makes the step-downs)
  const rec = POCKET({ clearing: 'linked' });
  const plan = results.island.conc;
  const els = elementsOf(exportOf(st, rec));
  const rings = els.filter((e) => e.cutType === 'online');
  eq(rings.length, plan.lines, `Spiral: its ${plan.lines} lines, once`);
  eq([...new Set(rings.map((e) => e.depth))], ['6.000 mm'], 'the lines at the full depth only');
  ok(rings.every((e) => !/Z$/.test(e.d) && e.tool === '6.000 mm' && e.offset === '0mm'), 'every line is an open on-line path with the card\'s bit (toolDia 6 mm), offset 0');
  eq(els.slice(-3).map((e) => [e.cutType, e.depth]), [['inside', '6.000 mm'], ['outside', '6.000 mm'], ['guide', undefined]], 'last: the wall (inside), the island (outside) at full depth, then the pocket start mark (guide)');
  eq(els.at(-3).d, elementsOf(exportOf(st, plain))[0].d.split(' M ')[0], 'the wall is the pocket\'s own outer loop, exactly as the file writes it');
  // the exported rings are the derivation's: each ring's points = the plan's
  const first = rings.filter((e) => e.depth === '6.000 mm').map((e) => e.d.replace(/[MLZ]/g, ' ').trim().split(/\s+/).map(Number));
  const planPts = plan.clear.map((c) => c.points.flatMap((p) => [Math.round(p.x * 1e4) / 1e4, Math.round(p.y * 1e4) / 1e4]));
  eq(first, planPts, 'the file\'s lines are the derivation\'s lines, point for point (inside out)');
  // the preview copy: data-clear on each element; the download has none
  const pv = elementsOf(exportOf(st, rec, { previewData: true }));
  eq(pv.filter((e) => e.cutType === 'online').map((e) => e.clear), plan.clear.map((c) => `linked ${c.index}/${plan.lines}`), 'preview: data-clear "linked k/N" (line k of N)');
  eq(pv.slice(-3).map((e) => e.clear), ['wall', 'island 1/1', 'start'], 'preview: "wall", "island 1/1", "start"');
  ok(!/data-/.test(exportOf(st, rec)), 'the download has no data-* attribute');
  // the 3D Review / Prepare: one footprint per cut, the band = the sweep of the cut's own centre path (start mark is a guide with no cut rings)
  const cutsP = cutsOf(st, rec), fps = deriveCutFootprint(cutsP, rec, st);
  eq(fps.length, cutsP.length, 'one footprint per cut');
  ok(fps.every((f) => f.clearing && (f.clearing.role === 'start' ? f.kind === 'guide' && f.rings.length === 0 : f.rings.length > 0)), 'every footprint carries its clearing role (cut paths sweep; start mark is a guide)');
  // Raster + spiral export: open paths + start mark guide
  const ras = elementsOf(exportOf(SHAPES.rectangle(), POCKET({ clearing: 'raster' })));
  // TASK 835e: Loop off = ONE open zigzag (the rectangle: one area) + the closed clean-up ring + the start mark
  ok(ras.filter((e) => e.cutType === 'online').length === 2 && ras.filter((e) => e.cutType === 'online' && !/Z$/.test(e.d)).length === 1 && ras.at(-1).cutType === 'guide', 'Raster: ONE open on-line zigzag + closed clean-up ring + start mark guide');
  const spx = elementsOf(exportOf(SHAPES.L(), POCKET({ clearing: 'morphed' })));
  eq(spx.map((e) => [e.cutType, /Z$/.test(e.d)]), [['online', false], ['inside', true], ['guide', false]], 'Morphed spiral: ONE open on-line path, the wall, then the start mark guide');
  const refused = elementsOf(exportOf(SHAPES.island(), POCKET({ clearing: 'morphed' })));
  eq(refused.map((e) => e.cutType), ['pocket'], 'a refused spiral (islands) is cut Freehand (its note says so)');
}

// ── 3. the app ──
SettingsManager.set('DOC_UNIT', 'mm');
SettingsManager.set('LENGTH_PRECISION', null);
const drawInto = (app, st0) => {
  const st = app.state;
  for (const k of [...st.joints.keys()]) st.joints.delete(k);
  st.shapes.length = 0; st.constraints.length = 0;
  for (const [k, v] of st0.joints) st.joints.set(k, v);
  st.shapes.push(...st0.shapes);
};
const harness = (app) => {
  const doc = app.document, q = (s) => doc.querySelector(s);
  const pressElRaw = (s) => { const e = typeof s === 'string' ? q(s) : s; assert(e, s + ' not found'); app.press(e); };
  const pressEl = (s) => editStep(app, () => pressElRaw(s)); // TASK S2: a change of the open operation = its own step (tests/helpers/prepare-open.js)
  const clickRaw = (x, y, o) => { const pc = doc.getElementById('prepare-canvas'); const p = worldToScreen(pc, { x, y }); app.click(Math.round(p.x), Math.round(p.y), { target: pc, ...o }); };
  const clickAt = (x, y, o) => clickOpen(app, () => clickRaw(x, y, o)); // TASK S2: OK the open operation, click, open the clicked shape's operation (tests/helpers/prepare-open.js)
  const pick = (id) => { if (app.prepare.openId()) { pressEl('.cut-type-trigger'); pressEl(`.cut-type-opt[data-id="${id}"]`); } else pressEl(`#op-type-${id}`); }; // TASK S3: an open operation: the card's type menu (a type change); none: the operations toolbar (a NEW operation, open)
  const clearing = (id) => { pressEl('.cut-clear-trigger'); pressEl(`.cut-clear-opt[data-clearing="${id}"]`); };
  const note = () => [...doc.querySelectorAll('.cut-note div')].map((d) => d.textContent);
  const typedRaw = (cls, v) => { const i = q(cls); i.value = v; i.dispatchEvent(new app.window.Event('change')); };
  const typed = (cls, v) => editStep(app, () => typedRaw(cls, v)); // TASK S2: a change of the open operation = its own step (tests/helpers/prepare-open.js)
  const shown = (row) => { const r = q(`.cut-row[data-row="${row}"]`); return r.style.display !== 'none' && !('off' in r.dataset); }; // TASK 813: a row that does not apply stays in place, greyed (data-off): not shown as an applicable row
  const step = (row, d) => pressEl(`.cut-row[data-row="${row}"] .cut-step[data-d="${d}"]`);
  const ops = () => [...doc.querySelectorAll('#prepare-ops .ops-row')].map((r) => `${r.querySelector('.ops-name').textContent} | ${r.querySelector('.ops-sub').textContent}`);
  return { q, pressEl, clickAt, pick, clearing, note, typed, shown, step, ops };
};
const keyAt = (st, x, y) => { const loops = findLoops(st), lp = polysOf(st); const l = loops.filter((x0) => inPoly({ x, y }, lp[x0.id])).sort((a, b) => Math.abs(area(lp[a.id])) - Math.abs(area(lp[b.id])))[0]; return keyOf('loop', l.id); };
let svgSaved = null, recSaved = null;
const profile = await createProfile();
await createNamedDesign(profile, 'shaper', 'Pocket 745');
{
  V2_PLAN.clear(); V2_PLAN.setOrder([]);
  const app = await open({ host: 'shaper', profile });
  try {
    const h = harness(app), st = app.state;
    h.pressEl('.sk-header-tab[data-tab="design"]');
    // a pocket with an island (left), a plain rectangle pocket (right), a second plain pocket (bottom right)
    drawInto(app, polyState([RECT, ISLAND, [[120, 0], [220, 0], [220, 60], [120, 60]], [[120, 80], [180, 80], [180, 120], [120, 120]]]));
    st.saveState('draw');
    h.pressEl('.sk-header-tab[data-tab="prepare"]');
    h.clickAt(170, 10);
    h.pick('pocket');
    h.typed('.cut-depth', '6');
    h.typed('.cut-bit', '6');
    ok(h.shown('clearing') && !h.shown('stepover') && !h.shown('finishAllowance') && !h.shown('loop') && !h.shown('rasterAngle'), 'Pocket: the Clearing row, Freehand: no other clearing row');
    eq([h.q('.cut-clear-cur').textContent, h.note()], ['Freehand', []], 'Freehand by default, no note');
    const kR = keyAt(st, 170, 10), svgFree = shaperSvgOf(st, planEntries());
    h.pressEl('.cut-clear-trigger');
    eq([...app.document.querySelectorAll('.cut-clear-opt')].map((b) => [b.dataset.clearing, b.querySelector('.cut-clear-name').textContent, b.disabled, b.querySelector('svg.cut-ic') !== null]),
      [['freehand', 'Freehand', false, true], ['linked', 'Spiral', false, true], ['raster', 'Raster', false, true], ['morphed', 'Morphed spiral', false, true]], 'the dropdown: 4 choices, each with its pattern icon');
    h.pressEl('.cut-clear-trigger');
    let n0 = st.history.length;
    h.clearing('linked');
    eq(st.history.length, n0 + 1, 'Spiral: ONE undo step');
    const r = V2_PLAN.get(kR);
    eq([r.clearing, r.stepover, r.finishAllowance, r.loop, r.rasterAngle, 'passDepth' in r], ['linked', 40, 0.5, false, 'auto', false], 'the defaults: stepover 40 %, allowance 0.5 mm, Loop off, raster auto (no depth per pass field)');
    ok(h.shown('stepover') && h.shown('finishAllowance') && h.shown('loop') && !h.shown('rasterAngle') && !h.q('.cut-pass-depth'), 'Spiral: Stepover, Finish allowance, Loop (no Raster angle, no Depth per pass row)');
    eq([h.q('.cut-stepover').value, h.q('.cut-stepover-len').textContent, h.q('.cut-finish-allowance').value, h.q('.cut-loop').checked], ['40', '= 2.4 mm', '0.5', false], 'the fields: 40 % = 2.4 mm, 0.5, depth per pass empty (full depth)');
    eq(hintFor(h.q('.cut-row[data-row="finishAllowance"] [data-hint]')), 'Left on the walls by the clearing passes; the Origin’s inside cut takes it off for a clean edge. 0 = none.', 'TASK 766: the Finish allowance hint, Loop off');
    eq(h.q('.cut-row[data-row="finishAllowance"] .cut-field-label').textContent, 'Finish allowance', 'TASK 766: the row is Finish allowance');
    const nt = h.note();
    console.log('card note: ' + JSON.stringify(nt));
    ok(/^Pocket: spiral, 12 turns in 1 line \+ wall, stepover 2\.4 mm, \d+\.\d m of path, about \d+ min at 1000 mm\/min$/.test(nt[2]), 'the note: turns in 1 line + wall, stepover, path length, time at the declared feed: ' + nt[0]);
    eq(nt[3], 'Drawn for a 6 mm bit: a smaller bit leaves ridges', 'the note names the bit the rings are drawn for');
    eq(nt[4], 'Depth passes: set Pass Depth or AutoPass on the Origin', 'the note: the step-downs are the Origin\'s (TASK 750)');
    eq(nt[5], 'AutoPass runs back along it on the next pass', 'the note: open clearing path reverses on AutoPass (TASK 777)');
    ok(/^Leftover: 7\.\d+ mm² not reached by a 6 mm bit$/.test(nt[0]), 'TASK 825: the leftover (the 4 corners) is the note FIRST line: ' + nt[0]);
    eq(nt[1], 'Sharp inside corners, necks narrower than the bit', 'and its reason the line after it');
    ok(h.q('.cut-note .cut-note-warn') && h.q('.cut-note .cut-note-warn').textContent.startsWith('7.'), 'the leftover is in the warning colour');
    const els = elementsOf(shaperSvgOf(st, planEntries()));
    eq(els.map((e) => e.cutType), ['online', 'inside', 'guide'], 'the download: ONE on-line path (the 12 turns) + the wall + the pocket start mark (guide)');
    // the stepper: + 5 % -> 45 %, ONE undo step, the rings redraw
    n0 = st.history.length;
    h.step('stepover', 1);
    eq([V2_PLAN.get(kR).stepover, st.history.length], [45, n0 + 1], 'stepover + -> 45 %, ONE undo step');
    ok(/^Pocket: spiral, 10 turns in 1 line \+ wall, stepover 2\.7 mm/.test(facts(h.note())[0]), 'the note follows: ' + facts(h.note())[0]);
    h.typed('.cut-bit', '3.175');
    ok(/^Pocket: spiral, \d+ turns in 1 line \+ wall, stepover 1\.429 mm/.test(facts(h.note())[0]) && facts(h.note())[1] === 'Drawn for a 3.175 mm bit: a smaller bit leaves ridges', 'a smaller bit: more rings, the stepover follows the bit: ' + h.note().slice(0, 2).join(' / '));
    app.undo();
    eq(V2_PLAN.get(kR).toolDia, 6, 'undo: the bit back to 6 mm');
    // Raster: + its angle row; presets
    h.clearing('raster');
    ok(h.shown('rasterAngle'), 'Raster: the Raster angle row');
    eq([...h.q('.cut-angle-presets').querySelectorAll('.cut-preset')].map((b) => b.textContent + (b.classList.contains('is-active') ? '*' : '')), ['Auto*', '0°', '45°', '90°'], 'angle presets Auto / 0 / 45 / 90, Auto active');
    ok(/^Pocket: raster auto \(0°\): \d+ passes \+ 1 ring \+ wall/.test(facts(h.note())[0]), 'Raster note: ' + facts(h.note())[0]);
    h.pressEl('.cut-angle-presets .cut-preset[data-value="45"]');
    eq(V2_PLAN.get(kR).rasterAngle, 45, 'preset 45');
    ok(/^Pocket: raster 45°/.test(facts(h.note())[0]), 'the note follows the angle');
    // depth per pass
    // the spiral
    ok(h.shown('loop'), 'Raster: the Loop row too');
    h.clearing('morphed');
    ok(/^Pocket: morphed spiral: \d+ turns \+ wall/.test(facts(h.note())[0]) && !h.shown('rasterAngle') && h.shown('loop'), 'Morphed spiral: its note, no angle row, the Loop row');
    // the island pocket: the spiral greyed with its reason
    h.clickAt(5, 5);
    h.pick('pocket'); h.typed('.cut-depth', '6'); h.typed('.cut-bit', '6');
    h.pressEl('.cut-clear-trigger');
    const spiralOpt = h.q('.cut-clear-opt[data-clearing="morphed"]');
    eq([spiralOpt.getAttribute('aria-disabled'), spiralOpt.classList.contains('is-disabled'), spiralOpt.querySelector('.cut-clear-why'), hintFor(spiralOpt).startsWith('has islands: use Spiral or Raster.')], ['true', true, null, true], 'the island pocket: Morphed spiral greyed, its reason is its tooltip (TASK 813: no line under it)');
    ok(!h.q('.cut-clear-opt[data-clearing="linked"]').disabled, 'the island pocket: Spiral is never disabled');
    h.pressEl('.cut-clear-opt[data-clearing="linked"]');
    const kI = keyAt(st, 5, 5);
    eq(V2_PLAN.get(kI).clearing, 'linked', 'the island pocket: Spiral');
    // the operations list: ONE row per programmed pocket
    const list = h.ops();
    console.log('ops: ' + JSON.stringify(list));
    ok(list.some((t) => /^Pocket \(spiral\) · 6 mm \| 1 region · spiral, 14 turns in 3 lines \(the pocket has islands\) \+ wall$/.test(t)) && list.some((t) => /^Pocket \(morphed spiral\) · 6 mm \| 1 region · morphed spiral: \d+ turns \+ wall$/.test(t)), 'the operations list: ONE row per programmed pocket with its clearing');
    // the 3D Review: every cut at its own depth
    const items = planReliefItems(st);
    ok(items.length > 2 && items.every((i) => i.cutDepth === 6), `Review: ${items.length} items (the spiral, the rings, walls, the island), all at 6 mm`);
    svgSaved = shaperSvgOf(st, planEntries()); recSaved = JSON.stringify([...V2_PLAN]);
    ok(svgSaved !== svgFree, 'the download changed with the clearing');
    const d = await app.storedDoc();
    ok(JSON.stringify(storedRecords(d.hosts.shaper)).includes('"clearing":"morphed"') && JSON.stringify(storedRecords(d.hosts.shaper)).includes('"clearing":"linked"'), 'the autosave stores the clearing');
  } finally { await app.close(); }
}
V2_PLAN.clear(); V2_PLAN.setOrder([]);
{
  const app = await open({ host: 'shaper', profile });
  try {
    app.modes.showMode('prepare');
    eq(JSON.stringify([...V2_PLAN]), recSaved, 'after a reload the records are back');
    eq(shaperSvgOf(app.state, planEntries()), svgSaved, 'and the download is byte-identical');
    // the bin of an operation with 2 regions: both unassigned in ONE undo step
    const h = harness(app), st = app.state;
    h.clickAt(130, 90); h.pick('pocket'); h.typed('.cut-depth', '6'); h.typed('.cut-bit', '6');
    h.clickAt(5, 5); h.pick('exterior');
    h.clickAt(130, 90, { shift: true });
    // two plain pockets of the same settings = one operation: make the second like the first
    V2_PLAN.clear(); V2_PLAN.setOrder([]);
    const kA = keyAt(st, 170, 10), kB = keyAt(st, 130, 90), kI = keyAt(st, 5, 5);
    V2_PLAN.set(kA, { cutType: 'pocket', cutDepth: 6, cutOffset: 0, toolDia: 6, cutterShape: 'endmill', cutterAngle: 90 });
    V2_PLAN.set(kB, { cutType: 'pocket', cutDepth: 6, cutOffset: 0, toolDia: 6, cutterShape: 'endmill', cutterAngle: 90 });
    V2_PLAN.set(kI, { cutType: 'exterior', cutDepth: 12, cutOffset: 0, toolDia: 6, cutterShape: 'endmill', cutterAngle: 90 });
    app.prepare.view().refreshLook(); app.prepare.opList.refresh();
    const rows = [...app.document.querySelectorAll('#prepare-ops .ops-row')];
    eq(h.ops(), ['Pocket · 6 mm | 2 regions', 'Outside · 12 mm | 1 region'], 'two operations: the 2 pockets, the outside');
    h.pressEl(rows[0].querySelector('.ops-pick'));
    eq(app.prepare.view().selection.size, 2, 'the pockets\' operation is picked');
    const before = shaperSvgOf(st, planEntries()), elsBefore = elementsOf(before), plan0 = JSON.stringify([...V2_PLAN]), order0 = V2_PLAN.order();
    const bin = app.document.querySelector(`#prepare-ops .ops-row[data-id="${rows[0].dataset.id}"] .ops-del`); // TASK S2: the selected row's X (its actions show on the selected row only)
    eq([bin.textContent, bin.getAttribute('aria-label')], ['\u2715', 'Delete operation 1 (its shapes stay in their other operations)'], 'the selected row\'s X');
    const n0 = st.history.length;
    h.pressEl(bin);
    eq(st.history.length, n0 + 1, 'the delete is ONE undo step');
    eq([V2_PLAN.get(kA), V2_PLAN.get(kB), V2_PLAN.get(kI).cutType], [null, null, 'exterior'], 'both regions unassigned (TASK S1: they leave the operation, which goes), the other kept');
    eq(h.ops(), ['Outside · 12 mm | 1 region'], 'the list loses the operation');
    eq(app.prepare.view().selection.size, 0, 'the selection (that operation) clears');
    const elsAfter = elementsOf(shaperSvgOf(st, planEntries()));
    eq(elsAfter, elsBefore.filter((e) => e.cutType !== 'pocket'), 'the export loses exactly those two pocket elements');
    eq(st.shapes.length, 16, 'the sketch geometry is untouched');
    app.undo();
    eq(JSON.stringify([...V2_PLAN]), plan0, 'Ctrl+Z: the records back');
    eq([V2_PLAN.order(), h.ops()], [order0, ['Pocket · 6 mm | 2 regions', 'Outside · 12 mm | 1 region']], 'and the operation in its place');
    eq(shaperSvgOf(st, planEntries()), before, 'the export as before');
  } finally { await app.close(); }
}
V2_PLAN.clear(); V2_PLAN.setOrder([]);
{ // inches: the allowance default is 0.02 in
  SettingsManager.set('DOC_UNIT', 'in');
  const app = await open({ host: 'shaper' });
  try {
    const h = harness(app), st = app.state;
    h.pressEl('.sk-header-tab[data-tab="design"]');
    drawInto(app, polyState([RECT])); st.saveState('draw');
    h.pressEl('.sk-header-tab[data-tab="prepare"]');
    h.clickAt(50, 30); h.pick('pocket'); h.typed('.cut-depth', '0.25'); h.typed('.cut-bit', '0.25');
    h.clearing('linked');
    const r = V2_PLAN.get(keyAt(st, 50, 30));
    eq(r.finishAllowance, 0.508, 'inches: the allowance default 0.02 in (0.508 mm)');
    eq(r.stepover, 45, 'the last stepover set (45 %, above) is used by the next pocket');
    eq(h.q('.cut-finish-allowance').value, '0.02', 'shown as 0.02 in');
    ok(/^Pocket: spiral, \d+ turns in 1 line \+ wall, stepover 0\.113 in, \d+\.\d ft of path, about \d+ min at 39 in\/min$/.test(h.note()[2]), 'the inch note: ' + h.note()[2]);
    ok(/^Leftover: 0\.\d+ in² not reached by a 0\.25 in bit$/.test(h.note()[0]), 'the inch leftover (TASK 825: the warnings come first): ' + h.note()[0]);
  } finally { await app.close(); SettingsManager.set('DOC_UNIT', 'mm'); }
}
V2_PLAN.clear(); V2_PLAN.setOrder([]);
console.log(`pocket-clearing-745-node.test.js: ok (${checks} checks)`);
