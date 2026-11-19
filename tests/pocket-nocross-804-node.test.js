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

// ── 1. THE HARD RULE ──
const table = [];
for (const [name, sh] of Object.entries(SHAPES_804)) {
  for (const pattern of ['linked', 'raster', 'morphed']) for (const loop of [false]) { // TASK 804 part 2: Loop off (Loop on: parts 3 and 4)
    const plan = planOf(sh, pattern, { loop });
    const tag = `${name} ${pattern} Loop ${loop ? 'on' : 'off'}`;
    const want = REFUSED[`${pattern}|${name}`] || null;
    eq(plan.refused, want, `${tag}: refused ${want || 'never'}`);
    if (plan.refused) { ok(CLEARING_REFUSED[plan.refused], `${tag}: the refusal has its words`); table.push(`${tag}: refused (${plan.refused})`); continue; }
    const x = pathCrossings(written(plan));
    eq(x.count, 0, `${tag}: no crossing (${JSON.stringify(x.crossings.slice(0, 3))})`);
    table.push(`${tag}: ${plan.clear.length} path(s), 0 crossings`);
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
console.log(`pocket-nocross-804: ${checks} checks passed`);
