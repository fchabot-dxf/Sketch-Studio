// tests/pocket-nocross-804-node.test.js — TASK 804: NO CROSSING PATHS in a programmed pocket, guaranteed (#core/pocket-clearing.js, checked with THE
// crossing check #core/path-crossings.js, tolerance CROSSING_TOL_MM).
//  1. THE HARD RULE over every pattern (Spiral, Raster, Morphed spiral) x Loop off / on x the shapes of tests/helpers/pocket-shapes-804.js (square,
//     circle, L, U, a U of one width, star, blob, a pocket round one island, the 745 island pocket, the owner's triangle bow-tie, the dumbbell, the S
//     with two necks): no written path crosses itself and no two cross (the clearing paths + the finish pass Loop off); a refusal only with its reason
//     (the Morphed spiral: islands; an area whose morphed turns would cross).
//  2. WHERE A POCKET SPLITS each area gets its own path: Spiral lines = the chains (bow-tie 2, dumbbell 2, S 3, U of one width 2); the Morphed spiral
//     one per SEGMENT (the shared rings before a split are their own path: bow-tie 3, dumbbell 3, S 4), no longer refused; its words on the card.
//  3. The Morphed spiral's fold fix: the L's path is main's within 0.01 mm both ways (tests/fixtures/pocket-804-morphed-main.json), with fewer reversals.
import assert from 'node:assert';
import fs from 'node:fs';
import { planClearing, clearingSettings, ringChains, ringSegments } from '#core/pocket-clearing.js';
import { pathCrossings } from '#core/path-crossings.js';
import { offsetRegions, regionsFromRings } from '#core/plot/clip.js';
import { SHAPES_804, BIT_MM, ALLOW_MM } from './helpers/pocket-shapes-804.js';
import { clearingWords, CLEARING_REFUSED } from '../apps/shaper/src/cut-plan.js';

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };
const settings = (sh, pattern, more = {}) => clearingSettings({ cutType: 'pocket', clearing: pattern, toolDia: sh.bit || BIT_MM, stepover: 40, finishAllowance: sh.allowance ?? ALLOW_MM, rasterAngle: 0, ...more });
const planOf = (sh, pattern, more) => planClearing({ outer: sh.outer, holes: sh.holes || [] }, settings(sh, pattern, more));
// every written path of a plan: the clearing paths, and Loop off the finish pass (the wall's and the islands' centre loops)
const written = (plan) => [...plan.clear.map((c) => ({ points: c.points, closed: c.closed })), ...(plan.loop ? [] : [...plan.wall, ...plan.islands.flat()].map((w) => ({ points: w, closed: true })))];
// the refusals allowed (a reason, never a crossing path)
const REFUSED = { 'morphed|annulus': 'morphed islands', 'morphed|island': 'morphed islands', 'morphed|blob': 'morphed area' };
// the Loops refused (cut as the open paths + the wall, the note says so): the Morphed spiral's way back half way between its turns would cross them where
// a turn reaches into a corner its inner ring does not (the L's and the U's hollow corners, the star's and the triangles' sharp tips)
const LOOP_REFUSED = { 'morphed|L': 'loop cross', 'morphed|U': 'loop cross', 'morphed|star': 'loop cross', 'morphed|bowtie': 'loop cross', 'morphed|S|2': 'loop cross' }; // |2: at pitch 2 only

// ── 1. THE HARD RULE ──
const table = [];
for (const [name, sh] of Object.entries(SHAPES_804)) {
  for (const pattern of ['linked', 'raster', 'morphed']) for (const loop of [false, true]) { // TASK 804b: Raster Loop on included (part 4)
    const plan = planOf(sh, pattern, { loop });
    const tag = `${name} ${pattern} Loop ${loop ? 'on' : 'off'}`;
    const want = REFUSED[`${pattern}|${name}`] || null;
    eq(plan.refused, want, `${tag}: refused ${want || 'never'}`);
    if (plan.refused) { ok(CLEARING_REFUSED[plan.refused], `${tag}: the refusal has its words`); table.push(`${tag}: refused (${plan.refused})`); continue; }
    const wantLoop = loop ? LOOP_REFUSED[`${pattern}|${name}`] || null : null;
    eq(plan.loopRefused, wantLoop, `${tag}: the Loop refused ${wantLoop || 'never'}`);
    if (plan.loopRefused) ok(CLEARING_REFUSED[plan.loopRefused], `${tag}: the Loop's refusal has its words`);
    const x = pathCrossings(written(plan));
    eq(x.count, 0, `${tag}: no crossing (${JSON.stringify(x.crossings.slice(0, 3))})`);
    if (plan.loop) eq(plan.loopCrossings, 0, `${tag}: the plan's own count says 0`);
    table.push(`${tag}: ${plan.clear.length} path(s), 0 crossings${plan.loopRefused ? ` (Loop refused: ${plan.loopRefused})` : ''}`);
  }
}

// ── 2. per area ──
const levelsOf = (sh) => {
  const r = (sh.bit || BIT_MM) / 2, a = sh.allowance ?? ALLOW_MM, s = 0.4 * (sh.bit || BIT_MM), R = regionsFromRings([sh.outer, ...(sh.holes || [])], 'evenodd'), L = [];
  for (let k = 0; ; k++) { const E = offsetRegions(R, -(r + a + k * s), 0.005); if (!E.length) return L; L.push(E); }
};
const LINES = { bowtie: 2, dumbbell: 2, S: 3, Ueven: 2, U: 1, L: 1, square: 1, star: 1 };
const SEGMENTS = { bowtie: 3, dumbbell: 3, S: 4, Ueven: 3, U: 1, L: 1, square: 1, star: 1 };
for (const name of Object.keys(LINES)) {
  const sh = SHAPES_804[name], L = levelsOf(sh);
  eq(ringChains(L).length, LINES[name], `${name}: ${LINES[name]} chain(s)`);
  eq(ringSegments(L).length, SEGMENTS[name], `${name}: ${SEGMENTS[name]} segment(s)`);
  const sp = planOf(sh, 'linked'), mo = planOf(sh, 'morphed');
  eq([sp.lines, sp.clear.length], [LINES[name], LINES[name]], `${name}: the Spiral has one line per chain`);
  eq([mo.refused, mo.lines, mo.clear.length, mo.linesWhy], [null, SEGMENTS[name], SEGMENTS[name], SEGMENTS[name] > 1 ? 'splits' : null], `${name}: the Morphed spiral, one per segment`);
  // the chains' order: the chain that reaches the wall is cut last (its last ring is level 0)
  const chains = ringChains(L);
  eq(chains[chains.length - 1][0].k, 0, `${name}: the chain reaching the wall is cut last`);
  ok(chains.every((ch, i) => i === 0 || ch[0].k <= chains[i - 1][0].k), `${name}: the chains that start deepest first`);
}
{
  const mo = planOf(SHAPES_804.bowtie, 'morphed');
  const w = clearingWords({ ...mo, settings: settings(SHAPES_804.bowtie, 'morphed') });
  eq(w, `morphed spiral: ${mo.turns} turns in 3 paths (the pocket narrows: one per area) + wall`, 'the bow-tie Morphed words: how many paths and why');
  const sp = planOf(SHAPES_804.bowtie, 'linked');
  eq(clearingWords({ ...sp, settings: settings(SHAPES_804.bowtie, 'linked') }), `spiral, ${sp.loops} turns in 2 lines (the pocket narrows: one per area) + wall`, 'the bow-tie Spiral words');
  ok(!/narrower than the bit/.test(Object.values(CLEARING_REFUSED).join(' ')), 'no refusal says "a neck narrower than the bit" any more');
  eq(CLEARING_REFUSED['morphed area'], 'the morphed turns of one area would cross each other: use Spiral or Raster', 'what remains refused says what happens');
}

// ── 4. THE GRADUAL LOOP (Spiral, Morphed spiral): one closed path per chain (Spiral) / segment (Morphed), the finish turn exactly r from the wall, inside
// R inset by r, the leftover == Loop off's, the cutting arm's step = pitch' x stepover (<= pitch x stepover); the path length at pitch 1 vs 2 ──
const distTo = (sh) => {
  const loops = [sh.outer, ...(sh.holes || [])].map((r) => r.map(([x, y]) => ({ x, y })));
  const dseg = (p, a, b) => { const vx = b.x - a.x, vy = b.y - a.y, L = vx * vx + vy * vy; const t = L ? Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / L)) : 0; return Math.hypot(p.x - a.x - t * vx, p.y - a.y - t * vy); };
  return (p) => { let m = Infinity; for (const l of loops) for (let i = 0; i + 1 < l.length; i++) m = Math.min(m, dseg(p, l[i], l[i + 1])); return m; };
};
const lengths = [];
for (const [name, sh] of Object.entries(SHAPES_804)) for (const pattern of ['linked', 'morphed']) {
  const off = planOf(sh, pattern);
  if (off.refused) continue;
  const r = (sh.bit || BIT_MM) / 2, s = 0.4 * (sh.bit || BIT_MM), dist = distTo(sh), row = [];
  for (const pitch of [1, 1.5, 2]) {
    const on = planOf(sh, pattern, { loop: true, loopPitch: pitch }), tag = `${name} ${pattern} Loop pitch ${pitch}`;
    if (on.loopRefused) { eq(on.loopRefused, LOOP_REFUSED[`${pattern}|${name}`] || LOOP_REFUSED[`${pattern}|${name}|${pitch}`] || null, `${tag}: refused only as listed`); row.push('refused'); continue; }
    eq(pathCrossings(on.clear.map((c) => ({ points: c.points, closed: true }))).count, 0, `${tag}: zero crossings`);
    ok(on.clear.every((c) => c.closed && c.role === 'loop' && c.points[0].x === c.points.at(-1).x && c.points[0].y === c.points.at(-1).y), `${tag}: closed paths (first point == last)`);
    if (pattern === 'linked') eq(on.loopCount, sh.chains, `${tag}: ${sh.chains} closed loop(s), one per chain`);
    else eq(on.loopCount, off.clear.length, `${tag}: one closed loop per segment`);
    let worstIn = Infinity, worstF = 0;
    for (const c of on.clear) {
      for (const p of c.points) worstIn = Math.min(worstIn, dist(p) - r);
      for (const t of c.turns.filter((u) => u.kind === 'finish')) for (const p of c.points.slice(t.start, t.end + 1)) worstF = Math.max(worstF, Math.abs(dist(p) - r));
    }
    ok(worstIn >= -0.02, `${tag}: every point inside R inset by r (worst ${worstIn.toFixed(4)})`);
    ok(worstF <= 0.01, `${tag}: the finish turns exactly r from the wall / island (worst ${worstF.toFixed(5)})`);
    ok(on.clear.some((c) => c.turns.some((t) => t.kind === 'finish')), `${tag}: the wall's finish turn is in a loop`);
    ok(Math.abs(on.leftover.area - off.leftover.area) <= Math.max(0.2, off.leftover.area * 0.01), `${tag}: the leftover == Loop off's (${on.leftover.area.toFixed(3)} vs ${off.leftover.area.toFixed(3)} mm²)`);
    ok(on.loopStep <= pitch * s + 1e-9, `${tag}: the cutting arm steps ${on.loopStep.toFixed(3)} mm <= ${pitch} x the stepover`);
    ok(on.loopStep / 2 <= s + 1e-9, `${tag}: neighbouring cuts (the return arm half way) at most one stepover apart (${(on.loopStep / 2).toFixed(3)} mm)`);
    row.push(`${on.loopCount} loop(s) ${(on.length / 1000).toFixed(2)} m step ${on.loopStep.toFixed(2)} mm`);
  }
  lengths.push(`${name} ${pattern}: Loop off ${((off.length + off.finishLength) / 1000).toFixed(2)} m | pitch 1: ${row[0]} | 1.5: ${row[1]} | 2: ${row[2]}`);
}
{
  const sp = planOf(SHAPES_804.bowtie, 'linked', { loop: true });
  eq(clearingWords({ ...sp, settings: settings(SHAPES_804.bowtie, 'linked', { loop: true }) }), `spiral, ${sp.loops} turns + wall: 2 closed loops (the pocket narrows: one per area)`, 'the bow-tie Loop words');
  const ann = planOf(SHAPES_804.annulus, 'linked', { loop: true });
  eq(clearingWords({ ...ann, settings: settings(SHAPES_804.annulus, 'linked', { loop: true }) }), `spiral, ${ann.loops} turns + wall: one closed loop`, "round one island: one closed loop (the wall's rings and the island's bridged)");
}

// ── 5. TASK 804b: RASTER + LOOP (owner design 2595): per area ONE closed path, zero crossings (the hard rule above), the passes row by row, then the step
// out to the WALL RING, the ring whole, back along it to the first pass's start; each island's ring a balloon; no clean-up ring; the leftover == Loop off's ──
for (const [name, sh] of Object.entries(SHAPES_804)) for (const allowance of [sh.allowance ?? ALLOW_MM, 0]) {
  const tag = `${name} raster Loop allowance ${allowance}`, more = { finishAllowance: allowance };
  const off = planOf(sh, 'raster', more), on = planOf(sh, 'raster', { ...more, loop: true });
  const r = (sh.bit || BIT_MM) / 2, dist = distTo(sh), holes = (sh.holes || []).length;
  eq([on.loopRefused, on.loop, on.loopCount], [null, true, 1], `${tag}: one closed path (one area)`);
  eq(pathCrossings(on.clear.map((c) => ({ points: c.points, closed: true }))).count, 0, `${tag}: zero crossings`);
  const c = on.clear[0], kinds = c.turns.map((t) => t.kind);
  ok(c.closed && c.points[0].x === c.points.at(-1).x && c.points[0].y === c.points.at(-1).y, `${tag}: closed (first point == last)`);
  eq(c.points[0], off.clear[0].points[0], `${tag}: it starts where the first pass starts (the start mark)`);
  eq(kinds.filter((k) => k === 'pass').length, off.passes, `${tag}: every pass, in the zigzag order`);
  ok(!kinds.includes('cleanup'), `${tag}: no clean-up ring`);
  eq(kinds.filter((k) => k === 'finish').length, 1 + holes, `${tag}: the wall ring + each island's ring, each once`);
  eq(kinds.at(-1), 'finish', `${tag}: the wall ring is the last turn (then only the way back along it and the step in)`);
  let worstIn = Infinity, worstF = 0;
  for (const p of c.points) worstIn = Math.min(worstIn, dist(p) - r);
  for (const t of c.turns.filter((u) => u.kind === 'finish')) for (const p of c.points.slice(t.start, t.end + 1)) worstF = Math.max(worstF, Math.abs(dist(p) - r));
  ok(worstIn >= -0.02, `${tag}: every point inside R inset by r (worst ${worstIn.toFixed(4)})`);
  ok(worstF <= 0.01, `${tag}: the rings exactly r from the wall / island (worst ${worstF.toFixed(5)})`);
  // (the same bound as the gradual Loop's above: the leftover's sliver filter rounds a sharp unreachable tip differently, e.g. the star with no allowance:
  // 58.947 vs 58.880 mm² after it, 58.683 vs 58.687 before it: the Loop leaves less)
  ok(Math.abs(on.leftover.area - off.leftover.area) <= Math.max(0.2, off.leftover.area * 0.01), `${tag}: the leftover == Loop off's (${on.leftover.area.toFixed(3)} vs ${off.leftover.area.toFixed(3)} mm²)`);
  table.push(`${tag}: 1 loop, ${off.passes} passes, ${1 + holes} ring(s), ${(on.length / 1000).toFixed(2)} m (Loop off ${((off.length + off.finishLength) / 1000).toFixed(2)} m)`);
}
{ // where no zigzag joined along the contour is crossing-free (the star at 45 degrees: its links interleave between the points), the Loop is REFUSED, never cut crossing
  const sh = SHAPES_804.star, on = planOf(sh, 'raster', { loop: true, rasterAngle: 45 });
  eq([on.loopRefused, on.loop], ['loop cross', false], 'star raster 45 degrees: the Loop refused (its zigzag links would cross)');
  eq(pathCrossings(written(on)).count, 0, 'star raster 45 degrees: what is written (the open passes + the clean-up ring + the wall) crosses nothing');
  ok(CLEARING_REFUSED[on.loopRefused], 'the refusal has its words (a plain line on the card)');
}

// ── 3. the Morphed spiral's fold fix: main's path within 0.01 mm, fewer reversals ──
{
  const MAIN = JSON.parse(fs.readFileSync(new URL('./fixtures/pocket-804-morphed-main.json', import.meta.url), 'utf8'));
  const dseg = (p, a, b) => { const vx = b.x - a.x, vy = b.y - a.y, L = vx * vx + vy * vy; const t = L ? Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / L)) : 0; return Math.hypot(p.x - a.x - t * vx, p.y - a.y - t * vy); };
  const far = (P, Q) => { let m = 0; for (const p of P) { let d = Infinity; for (let i = 0; i + 1 < Q.length; i++) d = Math.min(d, dseg(p, Q[i], Q[i + 1])); m = Math.max(m, d); } return m; };
  const reversals = (pts) => { let c = 0; for (let i = 2; i < pts.length; i++) { const a = pts[i - 2], b = pts[i - 1], q = pts[i]; const ux = b.x - a.x, uy = b.y - a.y, vx = q.x - b.x, vy = q.y - b.y; if ((ux * vx + uy * vy) / (Math.hypot(ux, uy) * Math.hypot(vx, vy) || 1) < -0.866) c++; } return c; };
  for (const [key, pts] of Object.entries(MAIN.paths)) {
    const [name, more] = key.split('|');
    const old = pts.map(([x, y]) => ({ x, y })), now = planOf(SHAPES_804[name], 'morphed', JSON.parse(more)).clear[0].points;
    const d1 = far(old, now), d2 = far(now, old);
    ok(d1 <= 0.01 && d2 <= 0.01, `${key}: the same path as main's within 0.01 mm (${d1.toFixed(4)} / ${d2.toFixed(4)})`);
    ok(reversals(now) < reversals(old), `${key}: fewer reversals than main's (${reversals(now)} < ${reversals(old)}: the hollow-corner arc walked once)`);
    table.push(`${key} morphed vs main: within ${Math.max(d1, d2).toFixed(4)} mm, reversals ${reversals(old)} -> ${reversals(now)}`);
  }
}
console.log(table.join('\n'));
console.log(lengths.join('\n'));
console.log(`pocket-nocross-804: ${checks} checks passed`);
