// gate: exclusive
// tests/pocket-morphed-perf-856-node.test.js — TASK 856: O(K) linear scaling and <= 0.02 mm geometric equivalence for Morphed spiral
// (#core/pocket-clearing.js morphedSpiral) across:
//  1. Speed: 60 mm square, 1/16 in end mill, 70 rings (< 500 ms) and 144 rings (< 2000 ms);
//  2. Geometric accuracy vs pre-856 reference paths (tests/fixtures/pocket-856-morphed-pre.json, from 7957e1c2): max Hausdorff distance
//     <= 0.02 mm over the 835 / 804 test shapes and the 60 mm square at 20 / 40 / 70 rings;
//  3. Clearing & Loop invariants: 0 crossings (Loop off), leftover.missed <= leftoverTolMm2 (every ring cut), and Morphed + Loop (task 850)
//     still 1 loop per area with 0 stray crossings outside declared closing legs.
import assert from 'node:assert';
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import { planClearing, clearingSettings, strayCrossings, POCKET_CLEARING } from '#core/pocket-clearing.js';
import { pathCrossings } from '#core/path-crossings.js';
import { sweepPaths, regionsFromRings, diffRegions, regionsArea, offsetRegions } from '#core/plot/clip.js';
import { SHAPES_804, BIT_MM, ALLOW_MM } from './helpers/pocket-shapes-804.js';

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

const IN = 25.4;
const close = (pts) => [...pts, pts[0]];
const SHAPES = {
  ownerBowtie: { outer: close([[-1.5, -1], [0, -0.25], [1.5, -1], [1.5, 1], [0, 0.25], [-1.5, 1]].map(([x, y]) => [x * IN, y * IN])), bit: 0.125 * IN, allowance: 0.02 * IN },
  smallBowtie: { outer: close([[0, 0], [1.6, 0.775], [3.2, 0], [3.2, 2.1], [1.6, 1.325], [0, 2.1]].map(([x, y]) => [x * IN, y * IN])), bit: 0.125 * IN, allowance: 0.02 * IN },
  ...SHAPES_804,
};
const REF = JSON.parse(fs.readFileSync(new URL('./fixtures/pocket-856-morphed-pre.json', import.meta.url), 'utf8'));
eq(REF.from, '7957e1c2fc7d21486b2d4d2227ee705a340b4d9c', 'pre-856 reference fixture records exact commit 7957e1c2');

const dseg = (p, a, b) => {
  const vx = b.x - a.x, vy = b.y - a.y, L2 = vx * vx + vy * vy;
  const t = L2 ? Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / L2)) : 0;
  return Math.hypot(p.x - a.x - t * vx, p.y - a.y - t * vy);
};
const dirDist = (A, B) => {
  let m = 0;
  for (const p of A) {
    let d = Infinity;
    for (let i = 0; i + 1 < B.length; i++) d = Math.min(d, dseg(p, B[i], B[i + 1]));
    if (d > m) m = d;
  }
  return m;
};
const hausdorff = (A, B) => Math.max(dirDist(A, B), dirDist(B, A));

const sq = (W) => ({ outer: close([[0, 0], [W, 0], [W, W], [0, W]]), holes: [] });
const pctSq60 = (nRings) => (28.70625 / (nRings - 0.5) / (25.4 / 16)) * 100;
const written = (plan) => [...plan.clear.map((c) => ({ points: c.points, closed: c.closed })), ...(plan.loop ? [] : [...plan.wall, ...plan.islands.flat()].map((w) => ({ points: w, closed: true })))];

// ── 1. Timing guard: 60 mm square, 1/16 in end mill, 70 rings (< 500 ms) and 144 rings (< 2000 ms) ──
{
  const st70 = clearingSettings({ cutType: 'pocket', clearing: 'morphed', toolDia: 25.4 / 16, stepover: pctSq60(70), finishAllowance: 0.5, loop: false });
  const t70 = performance.now();
  const p70 = planClearing(sq(60), st70);
  const ms70 = performance.now() - t70;
  eq(p70.levels, 70, 'sq60 70 rings count');
  ok(ms70 < 500, `sq60 1/16in 70 rings completes under 500 ms (got ${ms70.toFixed(1)} ms)`);

  const st144 = clearingSettings({ cutType: 'pocket', clearing: 'morphed', toolDia: 25.4 / 16, stepover: pctSq60(144), finishAllowance: 0.5, loop: false });
  const t144 = performance.now();
  const p144 = planClearing(sq(60), st144);
  const ms144 = performance.now() - t144;
  eq(p144.levels, 144, 'sq60 144 rings count');
  ok(ms144 < 2000, `sq60 1/16in 144 rings completes under 2000 ms (got ${ms144.toFixed(1)} ms)`);
  eq(pathCrossings(written(p144)).count, 0, 'sq60 144 rings: 0 crossings');
  ok(p144.leftover.missed <= POCKET_CLEARING.leftoverTolMm2, `sq60 144 rings: coverage leftover.missed <= ${POCKET_CLEARING.leftoverTolMm2} (got ${p144.leftover.missed.toFixed(4)})`);
  console.log(`timing sq60: 70r=${ms70.toFixed(1)}ms, 144r=${ms144.toFixed(1)}ms`);
}

// ── 2. 60 mm square at 20 / 40 / 70 rings vs pre-856 fixture: Hausdorff <= 0.02 mm, 0 crossings, coverage, Loop ON ──
const refMissedSq60 = (refSegs, plan, r) => {
  const R = regionsFromRings([sq(60).outer], 'evenodd');
  const finish = plan.wall.map((w) => ({ points: w.map((p) => [p.x, p.y]), closed: true }));
  const swept = sweepPaths([...refSegs.map((pts) => ({ points: pts.map((p) => [p.x, p.y]), closed: false })), ...finish], r, POCKET_CLEARING.chordTolMm);
  const left = regionsArea(offsetRegions(offsetRegions(diffRegions(R, swept), -POCKET_CLEARING.sliverMm), POCKET_CLEARING.sliverMm));
  return Math.max(0, left - plan.leftover.unreachable);
};
for (const n of [20, 40, 70]) {
  const st = (loop) => clearingSettings({ cutType: 'pocket', clearing: 'morphed', toolDia: 25.4 / 16, stepover: pctSq60(n), finishAllowance: 0.5, loop });
  const off = planClearing(sq(60), st(false));
  const refSegs = REF.sq60[n].map((seg) => seg.map(([x, y]) => ({ x, y })));
  eq(off.clear.length, refSegs.length, `sq60 ${n}r segment count`);
  let hMax = 0;
  for (let i = 0; i < refSegs.length; i++) hMax = Math.max(hMax, hausdorff(off.clear[i].points, refSegs[i]));
  ok(hMax <= 0.02, `sq60 ${n}r Hausdorff <= 0.02 mm (got ${hMax.toExponential(3)} mm)`);
  eq(pathCrossings(written(off)).count, 0, `sq60 ${n}r Loop off: 0 crossings`);
  const refMiss = refMissedSq60(refSegs, off, st(false).r);
  ok(off.leftover.missed <= Math.max(POCKET_CLEARING.leftoverTolMm2, refMiss + 0.05), `sq60 ${n}r leftover.missed ${off.leftover.missed.toFixed(4)} <= bound (ref ${refMiss.toFixed(4)})`);

  const on = planClearing(sq(60), st(true));
  eq([on.refused, on.loopRefused, on.loop, on.loopCount], [null, null, true, 1], `sq60 ${n}r Loop on: 1 loop per area`);
  eq(strayCrossings(on.clear.map((c) => ({ points: c.points, closed: true, turns: c.turns }))).length, 0, `sq60 ${n}r Loop on: 0 crossings outside closing legs`);
  ok(Math.abs(on.leftover.area - off.leftover.area) <= Math.max(0.2, off.leftover.area * 0.01), `sq60 ${n}r Loop on leftover matches Loop off`);
}

// ── 3. All 835 / 804 test shapes vs pre-856 fixture: Hausdorff <= 0.02 mm, 0 crossings, coverage, Loop ON ──
const REFUSED = { annulus: 'morphed islands', island: 'morphed islands', blob: 'morphed area' };
for (const [name, sh] of Object.entries(SHAPES)) {
  const st = (loop) => clearingSettings({ cutType: 'pocket', clearing: 'morphed', toolDia: sh.bit || BIT_MM, stepover: 40, finishAllowance: sh.allowance ?? ALLOW_MM, rasterAngle: 0, loop });
  const off = planClearing({ outer: sh.outer, holes: sh.holes || [] }, st(false));
  const want = REFUSED[name] || null;
  eq(off.refused, want, `${name}: refused=${want}`);
  if (off.refused) continue;

  const refSegs = REF.shapes[name].map((seg) => seg.map(([x, y]) => ({ x, y })));
  eq(off.clear.length, refSegs.length, `${name}: segment count unchanged (${refSegs.length})`);
  let hMax = 0;
  for (let i = 0; i < refSegs.length; i++) hMax = Math.max(hMax, hausdorff(off.clear[i].points, refSegs[i]));
  ok(hMax <= 0.02, `${name}: Hausdorff <= 0.02 mm (got ${hMax.toExponential(3)} mm)`);
  eq(pathCrossings(written(off)).count, 0, `${name} Loop off: 0 crossings`);
  ok(off.leftover.missed <= POCKET_CLEARING.leftoverTolMm2, `${name} leftover.missed <= ${POCKET_CLEARING.leftoverTolMm2} (got ${off.leftover.missed.toFixed(4)})`);

  const on = planClearing({ outer: sh.outer, holes: sh.holes || [] }, st(true));
  eq([on.refused, on.loopRefused, on.loop, on.loopCount], [null, null, true, 1], `${name} Loop on: 1 loop per area`);
  eq(strayCrossings(on.clear.map((c) => ({ points: c.points, closed: true, turns: c.turns }))).length, 0, `${name} Loop on: 0 crossings outside closing legs`);
  ok(Math.abs(on.leftover.area - off.leftover.area) <= Math.max(0.2, off.leftover.area * 0.01), `${name} Loop on leftover matches Loop off`);
}

console.log(`pocket-morphed-perf-856: ${checks} checks passed`);
