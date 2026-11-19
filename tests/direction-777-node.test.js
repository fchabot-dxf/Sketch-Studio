// tests/direction-777-node.test.js — TASK 777: clearer cutting direction marks on every determined toolpath.
// Pure node checks covering:
//  1. Single declaration (TRAVEL_STYLE -> TRAVEL_MIN_GAP_PX & CSS --sk-travel-* tokens, sparse slow parameters)
//  2. Conventional closed walls (outside CCW, inside CW, freehand/programmed pocket walls CW & islands CCW, split wall, stepped terraces)
//  3. Programmed clearing lines (Spiral rings + outward links, Raster zigzag passes + cleanup ring, Morphed spiral, Loop on + last finish turn)
//  4. Lead-in legs (On-line outline & Pocket Loop+Lead-in: tip -> junction, plus curved arc legPoints readiness for Task 778)
//  5. On-line tab strokes (each open stroke in its exported order)
//  6. Plain On-line (operator chooses on Origin), Guide, Stock, held gap strips -> no direction marks
//  7. Open-path AutoPass note (added on Loop-off programmed clearing; never duplicated where 775's LEAD_IN_TRADE_OFF already says it)
//  8. arrowsAlongPath (open & closed paths, spacing, minLen, zero-length segments, tangent alignment)
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { deriveCutFootprint, deriveCutTravel, arrowsAlongPath } from '#core/profile-model.js';
import { deriveCuts } from '#core/stepped-cut.js';
import { findLoops } from '#core/loop-finder.js';
import { loopPolygon } from '#core/loop-geometry.js';
import { effectiveCutRecord } from '../apps/shaper/src/shaper.js';
import { clearingSummary, clearingNoteItems, leadInSummary, leadInNoteItems, LEAD_IN_TRADE_OFF, OPEN_PATH_AUTOPASS_NOTE, keyOf } from '../apps/shaper/src/cut-plan.js';
import { TRAVEL_STYLE, TRAVEL_MIN_GAP_PX } from '../apps/shaper/src/prepare-view.js';

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const screenDir = (poly) => {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += poly[j].x * poly[i].y - poly[i].x * poly[j].y;
  return a > 0 ? 'cw' : 'ccw';
};
const nearPt = (a, b, tol = 1e-4) => Math.hypot(a.x - b.x, a.y - b.y) <= tol;
const angleDiff = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
const assertArrowsOnPath = (t, label) => {
  ok(t.arrows.length >= 1, `${label}: has at least 1 arrow`);
  const segCount = t.closed ? t.path.length : t.path.length - 1;
  for (const a of t.arrows) {
    let bestAng = Infinity;
    for (let i = 0; i < segCount; i++) {
      const p = t.path[i], q = t.path[(i + 1) % t.path.length];
      const dx = q.x - p.x, dy = q.y - p.y, l2 = dx * dx + dy * dy;
      if (l2 <= 1e-12) continue;
      const u = Math.max(0, Math.min(1, ((a.x - p.x) * dx + (a.y - p.y) * dy) / l2));
      if (Math.hypot(p.x + dx * u - a.x, p.y + dy * u - a.y) < 1e-5) {
        bestAng = Math.min(bestAng, angleDiff(Math.atan2(dy, dx), a.angle));
      }
    }
    ok(bestAng < 1e-5, `${label}: arrow (${a.x.toFixed(2)},${a.y.toFixed(2)}) lies on path and points along travel`);
  }
};

// Build a clean sketch state helper
function makeState(rects) {
  const joints = new Map(), shapes = [];
  let n = 0;
  const J = (x, y) => { const id = 'j' + (++n); joints.set(id, { x, y }); return id; };
  const line = (a, b) => { const id = 's' + (++n); shapes.push({ id, type: 'line', joints: [a, b] }); return id; };
  const firstEdges = rects.map(([x, y, w, h]) => {
    const p = [J(x, y), J(x + w, y), J(x + w, y + h), J(x, y + h)];
    return [0, 1, 2, 3].map((i) => line(p[i], p[(i + 1) % 4]))[0];
  });
  const state = { joints, shapes, constraints: [] };
  const shapeById = new Map(shapes.map((s) => [s.id, s]));
  const loops = findLoops(state).map((l) => ({ ...l, polygon: loopPolygon(l, state, shapeById) }));
  const loopPolys = Object.fromEntries(loops.map((l) => [l.id, l.polygon]));
  const loopFor = (idx) => loops.find((l) => l.edges.includes(firstEdges[idx]));
  return { state, loops, loopPolys, loopFor };
}
const travelFor = (g, loopIdx, rawRec) => {
  const rec = effectiveCutRecord(rawRec);
  const loop = g.loopFor(loopIdx);
  const cuts = deriveCuts({ kind: 'loop', id: loop.id }, rec, g.state, g.loops, g.loopPolys, new Set());
  const fps = deriveCutFootprint(cuts, rec, g.state);
  return { rec, cuts, fps, travel: deriveCutTravel(fps) };
};

// ── 1. Single declaration & CSS contract ──
{
  const period = TRAVEL_STYLE.dashPx + TRAVEL_STYLE.gapPx;
  const speed = period / TRAVEL_STYLE.durationSec;
  eq(TRAVEL_MIN_GAP_PX, 2 * TRAVEL_STYLE.dashPx, '1: TRAVEL_MIN_GAP_PX = 2 * dashPx (one constant)');
  ok(TRAVEL_STYLE.dashPx >= 8 && TRAVEL_STYLE.dashPx <= 10, `1: dash ${TRAVEL_STYLE.dashPx} px in 8-10`);
  ok(TRAVEL_STYLE.gapPx >= 28 && TRAVEL_STYLE.gapPx <= 36, `1: gap ${TRAVEL_STYLE.gapPx} px in 28-36`);
  ok(speed >= 6 && speed <= 8, `1: speed ${speed} px/s in 6-8`);
  ok(TRAVEL_STYLE.durationSec >= 4 && TRAVEL_STYLE.durationSec <= 6, `1: period duration ${TRAVEL_STYLE.durationSec} s`);
  const html = readFileSync(new URL('../apps/shaper/index.html', import.meta.url), 'utf8');
  ok(html.includes('stroke-dasharray: calc(var(--sk-travel-dash) * 1px) calc(var(--sk-travel-gap) * 1px);'), '1: .sk-travel dasharray reads CSS tokens');
  ok(html.includes('stroke-dashoffset: calc(var(--sk-travel-period) * -1px);'), '1: @keyframes sk-march reads --sk-travel-period');
  ok(html.includes('@media (prefers-reduced-motion: no-preference) { .sk-travel { animation: sk-march var(--sk-travel-duration) linear infinite; } }'), '1: opt-in motion under no-preference');
  ok(!/\.sk-travel-arrows\s*\{[^}]*display:\s*none/.test(html), '1: arrowheads always visible (not hidden)');
}

// ── 2. Conventional closed walls + stepped terraces ──
{
  const g = makeState([[0, 0, 80, 50], [25, 15, 20, 20]]);
  const out = travelFor(g, 0, { cutType: 'exterior', cutDepth: 10, cutOffset: 0, toolDia: 6 });
  eq(out.travel.map((t) => [t.role, t.direction, screenDir(t.path), t.closed]), [['inside', 'cw', 'cw', true], ['outside', 'ccw', 'ccw', true]], '2: outside frame: hole CW, outer CCW');
  for (const t of out.travel) assertArrowsOnPath(t, 'outside frame ' + t.role);

  const pock = travelFor(g, 0, { cutType: 'pocket', cutDepth: 10, cutOffset: 0, toolDia: 6, clearing: 'freehand' });
  eq(pock.travel.map((t) => [t.role, t.direction, screenDir(t.path)]), [['wall', 'cw', 'cw'], ['island', 'ccw', 'ccw']], '2: freehand pocket: wall CW, island CCW');

  // Stepped pocket (no island): every terrace carries conventional CW wall travel
  const gStep = makeState([[0, 0, 80, 50]]);
  const rings = [0, 2, 4, 6].map((z) => ({ z, segments: [{ type: 'circle', cx: 40, cy: 25, r: 20 - z * 0.5 }] }));
  const stepped = travelFor(gStep, 0, { cutType: 'roughing', cutDepth: 6, cutOffset: 0, toolDia: 6, stepDepth: 2, slope: { kind: 'pocket', label: 'Dish', rings } });
  ok(stepped.travel.length >= 3, '2: stepped pocket produces terrace travel entries: ' + stepped.travel.length);
  ok(stepped.travel.every((t) => t.role === 'wall' && t.direction === 'cw' && screenDir(t.path) === 'cw'), '2: every stepped terrace is CW wall');
}

// ── 3. Programmed clearing lines: Raster, Spiral, Morphed, Loop ──
{
  const g = makeState([[0, 0, 80, 50]]);
  const base = { cutType: 'pocket', cutDepth: 10, cutOffset: 0, toolDia: 6, stepover: 50, finishAllowance: 0.5, rasterAngle: 0 };

  // Raster (Loop OFF): alternating zigzag passes + CW cleanup ring + CW finish wall
  const rast = travelFor(g, 0, { ...base, clearing: 'raster', loop: false });
  const passes = rast.travel.filter((t) => t.role === 'raster');
  const cleanups = rast.travel.filter((t) => t.role === 'cleanup');
  const walls = rast.travel.filter((t) => t.role === 'wall');
  ok(passes.length >= 4, '3 raster: has multiple passes: ' + passes.length);
  eq([cleanups.length, walls.length], [1, 1], '3 raster: 1 cleanup ring + 1 wall');
  ok(passes.every((p) => !p.closed && p.direction === 'forward'), '3 raster: passes are open forward paths');
  // Verify alternating zigzag direction (+X then -X then +X ...)
  for (let i = 0; i < passes.length; i++) {
    const dx = passes[i].path.at(-1).x - passes[i].path[0].x;
    ok(i % 2 === 0 ? dx > 0 : dx < 0, `3 raster pass ${i}: zigzag dx=${dx.toFixed(2)}`);
    assertArrowsOnPath(passes[i], `raster pass ${i}`);
  }
  eq(screenDir(cleanups[0].path), 'cw', '3 raster cleanup ring: CW');
  eq(screenDir(walls[0].path), 'cw', '3 raster finish wall: CW');

  // Spiral (Loop OFF): inside-out rings + outward links + CW finish wall
  const spir = travelFor(g, 0, { ...base, clearing: 'linked', loop: false });
  const linked = spir.travel.filter((t) => t.role === 'linked');
  eq(linked.length, 1, '3 spiral: 1 linked line');
  ok(!linked[0].closed && linked[0].path.length > 20, '3 spiral: open polyline');
  // Verify inside-out: start is closer to pocket center (40, 25) than end!
  const center = { x: 40, y: 25 };
  const dStart = Math.hypot(linked[0].path[0].x - center.x, linked[0].path[0].y - center.y);
  const dEnd = Math.hypot(linked[0].path.at(-1).x - center.x, linked[0].path.at(-1).y - center.y);
  ok(dStart < dEnd, `3 spiral: runs inside-out (start dist ${dStart.toFixed(1)} < end dist ${dEnd.toFixed(1)})`);
  // Verify link segments step outward (first link in clearing cut)
  const linkIdx = [];
  for (let i = 0; i + 1 < linked[0].path.length; i++) {
    const a = linked[0].path[i], b = linked[0].path[i + 1];
    // On an axis-aligned rectangle pocket, links step perpendicular to the ring edge by ~stepover (3 mm)
    if (Math.abs(a.x - 40) < 1e-3 && Math.abs(b.x - 40) < 1e-3 && Math.abs(b.y - a.y) > 1) linkIdx.push(i);
  }
  ok(linkIdx.length >= 1, '3 spiral: found outward link segments: ' + linkIdx.length);
  for (const li of linkIdx) {
    const a = linked[0].path[li], b = linked[0].path[li + 1];
    ok(Math.hypot(b.x - center.x, b.y - center.y) > Math.hypot(a.x - center.x, a.y - center.y), `3 spiral link ${li}: moves outward`);
  }
  assertArrowsOnPath(linked[0], 'spiral linked');

  // Morphed spiral (Loop OFF)
  const morph = travelFor(g, 0, { ...base, clearing: 'morphed', loop: false });
  const mLine = morph.travel.filter((t) => t.role === 'morphed');
  eq(mLine.length, 1, '3 morphed: 1 open spiral path');
  ok(!mLine[0].closed && Math.hypot(mLine[0].path[0].x - center.x, mLine[0].path[0].y - center.y) < Math.hypot(mLine[0].path.at(-1).x - center.x, mLine[0].path.at(-1).y - center.y), '3 morphed: spirals inside-out');
  assertArrowsOnPath(mLine[0], 'morphed spiral');

  // Loop ON (without lead-in): closed loop including finish turn
  const lp = travelFor(g, 0, { ...base, clearing: 'linked', loop: true, leadIn: false });
  eq(lp.travel.map((t) => [t.role, t.closed]), [['loop', true]], '3 loop ON (no lead-in): closed loop travel');
  assertArrowsOnPath(lp.travel[0], 'pocket loop');

  // Loop ON + saved leadIn: true (TASK 778: pocket lead-in removed; pocket ignores leadIn, stays a closed loop + guide start mark)
  const lpLead = travelFor(g, 0, { ...base, clearing: 'linked', loop: true, leadIn: true, leadInLength: 6 });
  eq(lpLead.travel.map((t) => [t.role, t.closed]), [['loop', true]], '3 loop ON + saved leadIn:true: stays closed loop (no pocket lead-in leg)');
  assertArrowsOnPath(lpLead.travel[0], 'pocket loop');
}

// ── 4. On-line Lead-in (straight 775 + curved arc readiness 778) ──
{
  const g = makeState([[0, 0, 60, 40]]);
  for (const side of ['outside', 'inside']) {
    const res = travelFor(g, 0, { cutType: 'online', cutDepth: 6, toolDia: 4, leadIn: true, leadInLength: 6, leadInSide: side });
    eq(res.travel.map((t) => [t.role, t.closed]), [['leadin', false], ['online', false]], `4 online lead-in (${side}): leg + open outline`);
    const fp = res.fps[0];
    ok(nearPt(res.travel[0].path[0], fp.leadIn.tip) && nearPt(res.travel[0].path.at(-1), fp.leadIn.junction), `4 online lead-in (${side}): leg runs tip -> junction`);
    ok(nearPt(res.travel[1].path[0], fp.leadIn.junction) && nearPt(res.travel[1].path.at(-1), fp.leadIn.junction), `4 online lead-in (${side}): loop starts and ends at junction`);
    eq(screenDir(res.travel[1].path.slice(0, -1)), 'cw', `4 online lead-in (${side}): loop runs CW (matches loopWalk export)`);
    assertArrowsOnPath(res.travel[0], `online lead-in leg (${side})`);
    assertArrowsOnPath(res.travel[1], `online lead-in loop (${side})`);
  }

  // Task 778 arc readiness: a curved multi-point arc leadIn.legPoints is used verbatim (never flattened to tip->junction chord)
  const arcPts = Array.from({ length: 17 }, (_, i) => {
    const th = Math.PI + (i / 16) * (Math.PI / 2); // quarter-circle arc radius 10 centered at (30, 10): from (20, 10) to (30, 0)
    return { x: 30 + 10 * Math.cos(th), y: 10 + 10 * Math.sin(th) };
  });
  const synthFp = {
    kind: 'band', cutType: 'online',
    center: [{ x: 0, y: 0 }, { x: 60, y: 0 }, { x: 60, y: 40 }, { x: 0, y: 40 }],
    leadIn: { role: 'leg', tip: arcPts[0], junction: arcPts.at(-1), legPoints: arcPts },
  };
  const [arcLeg] = deriveCutTravel([synthFp]);
  eq(arcLeg.role, 'leadin', '4 arc lead-in: role is leadin');
  eq(arcLeg.path.length, arcPts.length, '4 arc lead-in: preserves all arc points (not 2-point straight chord)');
  // Midpoint arrow sits on the arc at (30 - 10*cos(45°), 10 - 10*sin(45°)) ≈ (22.93, 2.93), NOT on the straight chord midpoint (25, 5)
  const mid = arcLeg.arrows[0];
  ok(Math.hypot(mid.x - (30 - 10 * Math.SQRT1_2), mid.y - (10 - 10 * Math.SQRT1_2)) < 0.1, `4 arc lead-in: arrow sits on the arc (${mid.x.toFixed(2)},${mid.y.toFixed(2)}), not the chord`);
  ok(Math.hypot(mid.x - 25, mid.y - 5) > 2, '4 arc lead-in: arrow clearly off the straight tip->junction chord');
}

// ── 5. On-line Tab strokes ──
{
  const g = makeState([[0, 0, 80, 60]]);
  const tabs = travelFor(g, 0, { cutType: 'online', cutDepth: 6, toolDia: 3.175, holdPart: 'tabs', tabCount: 3, tabWidth: 10 });
  eq(tabs.travel.length, 3, '5 online tabs: 3 strokes get travel marks');
  ok(tabs.travel.every((t) => t.role === 'stroke' && !t.closed && t.direction === 'forward'), '5 online tabs: open forward strokes');
  for (let i = 0; i < 3; i++) {
    const fpPts = tabs.fps[i].toolPaths[0].points;
    ok(nearPt(tabs.travel[i].path[0], fpPts[0]) && nearPt(tabs.travel[i].path.at(-1), fpPts.at(-1)), `5 online tab stroke ${i}: matches exported stroke order`);
    assertArrowsOnPath(tabs.travel[i], `tab stroke ${i}`);
  }
}

// ── 6. Plain On-line, Guide, Stock, held gap strips -> no direction marks ──
{
  const g = makeState([[0, 0, 60, 40]]);
  eq(travelFor(g, 0, { cutType: 'online', cutDepth: 6, toolDia: 4 }).travel, [], '6 plain closed On-line: no travel (operator chooses)');
  eq(travelFor(g, 0, { cutType: 'guide', cutDepth: 'unset', toolDia: 4 }).travel, [], '6 Guide: no travel');
  eq(travelFor(g, 0, { cutType: 'stock', cutDepth: 19, toolDia: 4 }).travel, [], '6 Stock: no travel');
  const heldOut = travelFor(g, 0, { cutType: 'exterior', cutDepth: 12, toolDia: 6, holdPart: 'tabs', tabCount: 3, tabWidth: 10, holdThickness: 2 });
  eq(heldOut.travel.map((t) => t.role), ['outside'], '6 held Outside with tabs: pass 1 gets travel, gap strips do not');
}

// ── 7. Open-path AutoPass note (no duplication with 775 LEAD_IN_TRADE_OFF) ──
{
  const g = makeState([[0, 0, 80, 50]]);
  const k = keyOf('loop', g.loopFor(0).id);
  const owned = new Set();
  for (const pat of ['linked', 'raster', 'morphed']) {
    const recOff = { cutType: 'pocket', cutDepth: 10, cutOffset: 0, toolDia: 6, clearing: pat, stepover: 50, finishAllowance: 0.5, rasterAngle: 0, loop: false };
    const notesOff = clearingNoteItems(recOff, clearingSummary(k, recOff, g.state, g.loops, g.loopPolys, owned)).map((i) => i.text);
    eq(notesOff.filter((t) => t === OPEN_PATH_AUTOPASS_NOTE).length, 1, `7 ${pat} Loop off: includes AutoPass reverse line once`);

    const recOn = { ...recOff, loop: true, leadIn: false };
    const notesOn = clearingNoteItems(recOn, clearingSummary(k, recOn, g.state, g.loops, g.loopPolys, owned)).map((i) => i.text);
    eq(notesOn.filter((t) => t === OPEN_PATH_AUTOPASS_NOTE).length, 0, `7 ${pat} Loop on (closed): no open-path AutoPass reverse line`);

    const recLead = { ...recOff, loop: true, leadIn: true, leadInLength: 6 };
    const notesLead = clearingNoteItems(recLead, clearingSummary(k, recLead, g.state, g.loops, g.loopPolys, owned)).map((i) => i.text);
    eq(notesLead.filter((t) => t === OPEN_PATH_AUTOPASS_NOTE).length, 0, `7 ${pat} Loop+saved leadIn: closed loop, no open-path AutoPass line`);
  }
  const recOL = { cutType: 'online', cutDepth: 6, toolDia: 4, leadIn: true, leadInLength: 6, leadInSide: 'outside' };
  const notesOL = leadInNoteItems(recOL, leadInSummary(k, recOL, g.state, g.loops, g.loopPolys, owned)).map((i) => i.text);
  ok(notesOL.includes(LEAD_IN_TRADE_OFF) && !notesOL.includes(OPEN_PATH_AUTOPASS_NOTE), '7 On-line Lead-in: reuses 775 trade-off line, no duplicate');
}

// ── 8. arrowsAlongPath edge cases ──
{
  const seg = [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 100, y: 0 }]; // leading duplicate point
  const a1 = arrowsAlongPath(seg, false, { spacing: 40, minLen: 10 });
  eq(a1.length, 2, '8 open path 100 with spacing 40 -> 2 arrows');
  ok(a1.every((a) => Math.abs(a.angle) < 1e-9 && a.x > 0 && a.x < 100), '8 open path arrows point +X and stay inside segment');
  eq(arrowsAlongPath([{ x: 0, y: 0 }, { x: 5, y: 0 }], false, { spacing: 40, minLen: 10 }), [], '8 path shorter than minLen -> 0 arrows');
  const shortMid = arrowsAlongPath([{ x: 0, y: 0 }, { x: 15, y: 0 }], false, { spacing: 72, minLen: 10 });
  eq(shortMid.length, 1, '8 short path >= minLen -> 1 arrow at midpoint');
  ok(Math.abs(shortMid[0].x - 7.5) < 1e-6, '8 short path arrow sits at midpoint');
}

console.log(`direction-777-node: ok (${checks} checks)`);
