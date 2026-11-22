// tests/pocket-spiral-loop-850-node.test.js — TASK 850: SPIRAL and MORPHED SPIRAL with LOOP ON become ONE closed loop per area of the clearing (A0 = R inset
// by r + a), like Raster in task 835:
//  1. Rings cut in order at the normal stepover + declared closing return leg(s) (turn kind 'close') over floor the same depth pass has already swept;
//     THE CROSSING RULE (#core/pocket-clearing strayCrossings): 0 crossings outside declared closing legs.
//  2. Where rings split (a neck, a branch, around an island), the pieces are joined into ONE closed loop per AREA of A0; a separate loop only where the bit
//     cannot pass.
//  3. The finish is the Origin's NATIVE cut (finishInLoop = false for every pattern): the pocket's outer loop as an Inside cut, islands as Outside cuts.
//  4. Morphed + Loop is no longer refused with 'loop cross' (L, U, star, bowtie, smallBowtie, Ueven, dumbbell, S all succeed as 1 loop per area); only
//     Loop-off's own Morphed refusals ('morphed islands', 'morphed area') remain.
import assert from 'node:assert';
import { planClearing, clearingSettings, strayCrossings, finishInLoop } from '#core/pocket-clearing.js';
import { pathCrossings } from '#core/path-crossings.js';
import { regionsFromRings, diffRegions, regionsArea, offsetRegions, sweepPaths, clipOpenPaths } from '#core/plot/clip.js';
import { SHAPES_804, BIT_MM, ALLOW_MM } from './helpers/pocket-shapes-804.js';
import { passCoverage } from './helpers/raster-passes-835.js';

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };
const IN = 25.4, close = (pts) => [...pts, pts[0]];

const SHAPES = {
  ownerBowtie: { outer: close([[-1.5, -1], [0, -0.25], [1.5, -1], [1.5, 1], [0, 0.25], [-1.5, 1]].map(([x, y]) => [x * IN, y * IN])), bit: 0.125 * IN, allowance: 0.02 * IN },
  smallBowtie: { outer: close([[0, 0], [1.6, 0.775], [3.2, 0], [3.2, 2.1], [1.6, 1.325], [0, 2.1]].map(([x, y]) => [x * IN, y * IN])), bit: 0.125 * IN, allowance: 0.02 * IN },
  ...SHAPES_804,
};

const settings = (sh, pattern, more = {}) => clearingSettings({ cutType: 'pocket', clearing: pattern, toolDia: sh.bit || BIT_MM, stepover: 40, finishAllowance: sh.allowance ?? ALLOW_MM, rasterAngle: 0, ...more });
const planOf = (sh, pattern, more) => planClearing({ outer: sh.outer, holes: sh.holes || [] }, settings(sh, pattern, more));

const distTo = (sh) => {
  const loops = [sh.outer, ...(sh.holes || [])].map((r) => r.map(([x, y]) => ({ x, y })));
  const dseg = (p, a, b) => { const vx = b.x - a.x, vy = b.y - a.y, L = vx * vx + vy * vy; const t = L ? Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / L)) : 0; return Math.hypot(p.x - a.x - t * vx, p.y - a.y - t * vy); };
  return (p) => { let m = Infinity; for (const l of loops) for (let i = 0; i + 1 < l.length; i++) m = Math.min(m, dseg(p, l[i], l[i + 1])); return m; };
};
const rawLeft = (sh, plan) => regionsArea(diffRegions(regionsFromRings([sh.outer, ...(sh.holes || [])], 'evenodd'), plan.swept));
const areasOf = (sh, r, a) => offsetRegions(regionsFromRings([sh.outer, ...(sh.holes || [])], 'evenodd'), -(r + a), 0.005);

// Closing leg check: inside A0 and every point over floor the loop has ALREADY swept before that closing leg
const legsOf = (c) => (c.turns || []).filter((t) => t.kind === 'close');
const legOk = (c, t, r, A0) => {
  const before = sweepPaths([{ points: c.points.slice(0, t.start + 1).map((p) => [p.x, p.y]), closed: false }], r, 0.005);
  const fits = offsetRegions(before, -(r - 0.02), 0.005);
  const inG = offsetRegions(A0, 0.01);
  const inside = (pt, g) => {
    const inR = (ring) => {
      let w = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const A = ring[i], B = ring[j];
        if ((A[1] > pt.y) !== (B[1] > pt.y) && pt.x < ((B[0] - A[0]) * (pt.y - A[1])) / (B[1] - A[1]) + A[0]) w = !w;
      }
      return w;
    };
    return inR(g.outer) && !g.holes.some(inR);
  };
  let inA0 = true, swept = true, totalL = 0;
  for (let i = t.start; i < t.end; i++) {
    const p = c.points[i], q = c.points[i + 1], L = Math.hypot(q.x - p.x, q.y - p.y);
    totalL += L;
    if (L < 1e-6) continue;
    const clipped = clipOpenPaths([[[p.x, p.y], [q.x, q.y]]], inG).reduce((u, pc) => u + Math.hypot(pc.at(-1)[0] - pc[0][0], pc.at(-1)[1] - pc[0][1]), 0);
    if (clipped < L - 0.005) inA0 = false;
    const n = Math.max(2, Math.ceil(L / 0.5));
    for (let k = 1; k < n; k++) {
      const pt = { x: p.x + ((q.x - p.x) * k) / n, y: p.y + ((q.y - p.y) * k) / n };
      if (!fits.some((g) => inside(pt, g))) { swept = false; break; }
    }
  }
  return { inA0, swept, L: totalL };
};

// Every ring contour of Spiral (L[0..K]) cut once in the loop's 'ring' turns (matching Loop off's ring coverage)
const spiralRingsCutOnce = (on, off, sh, r, a, s) => {
  const R = regionsFromRings([sh.outer, ...(sh.holes || [])], 'evenodd');
  const ringSegs = [];
  for (let k = 0; ; k++) {
    const E = offsetRegions(R, -(r + a + k * s), 0.005);
    if (!E.length) break;
    for (const g of E) {
      for (const ring of [g.outer, ...g.holes]) {
        for (let i = 0; i + 1 < ring.length; i++) {
          const p = { x: ring[i][0], y: ring[i][1] }, q = { x: ring[i + 1][0], y: ring[i + 1][1] };
          if (Math.hypot(q.x - p.x, q.y - p.y) > 1e-3) ringSegs.push([p, q]);
        }
      }
    }
  }
  const ringTurns = on.clear.flatMap((c) => (c.turns || []).filter((t) => t.kind === 'ring').map((t) => {
    const pts = c.points.slice(t.start, t.end + 1);
    return { points: pts, turns: [{ start: 0, end: pts.length - 1, kind: 'pass' }] };
  }));
  const offTurns = off.clear.flatMap((c) => (c.rings || []).map((rg) => {
    const pts = c.points.slice(rg.start, rg.end + 1);
    return { points: pts, turns: [{ start: 0, end: pts.length - 1, kind: 'pass' }] };
  }));
  const cov = passCoverage(ringTurns, ringSegs), covOff = passCoverage(offTurns, ringSegs);
  const bad = cov.find((x, i) => !(x.twice <= covOff[i].twice + 0.15 && x.uncut.every(([u, v]) => v - u <= 0.05)));
  return { ok: !bad, bad, count: ringSegs.length };
};

// Rings in order: each 'ring' turn lies at a single ring level k (dist to R boundary = r + a + k*s), and consecutive 'ring' turns without a 'close' turn
// between them step by at most 1 level (|dk| <= 1: 0 when two pieces of the same parent ring surround a branch detour, 1 when stepping to the next ring)
const spiralRingsInOrder = (on, sh, r, a, s) => {
  const dist = distTo(sh);
  for (const c of on.clear) {
    let prevK = null;
    for (const t of c.turns || []) {
      if (t.kind === 'close') { prevK = null; continue; }
      if (t.kind !== 'ring') continue;
      const mid = c.points[Math.floor((t.start + t.end) / 2)];
      const k = Math.round((dist(mid) - (r + a)) / s);
      if (prevK !== null && Math.abs(k - prevK) > 1) return { ok: false, from: prevK, to: k };
      prevK = k;
    }
  }
  return { ok: true };
};

// ── 0. finishInLoop is false for all patterns (native finish everywhere) ──
for (const pat of ['linked', 'raster', 'morphed']) {
  eq(finishInLoop(pat, false), false, `${pat} Loop off: finishInLoop is false`);
  eq(finishInLoop(pat, true), false, `${pat} Loop on: finishInLoop is false (native Inside/Outside finish)`);
}

// ── 1. Structure on the 14 shapes x 2 allowances for Spiral + Loop and Morphed + Loop ──
const checkLoopPlan = (tag, pattern, on, off, sh, r, a, s) => {
  const A0 = areasOf(sh, r, a);
  eq([on.refused, on.loopRefused, on.loop, on.nativeFinish], [null, null, true, true], `${tag}: Loop on built, never loop-refused, nativeFinish true`);
  eq(on.clear.length, A0.length, `${tag}: ONE closed loop per area of A0 (${A0.length})`);
  eq(on.loopCount, A0.length, `${tag}: loopCount == areas of A0`);
  ok(on.clear.every((c) => c.closed && Math.hypot(c.points[0].x - c.points.at(-1).x, c.points[0].y - c.points.at(-1).y) < 1e-9), `${tag}: every loop closed (first == last)`);
  const all = pathCrossings(on.clear.map((c) => ({ points: c.points, closed: true })));
  const stray = strayCrossings(on.clear.map((c) => ({ points: c.points, closed: true, turns: c.turns })));
  eq(stray.length, 0, `${tag}: THE CROSSING RULE: 0 stray crossings outside closing legs (all=${all.count}, stray=${JSON.stringify(stray.slice(0, 3))})`);
  for (const c of on.clear) {
    const cLegs = legsOf(c);
    ok(cLegs.length >= 1 && cLegs.at(-1).end === c.points.length - 1, `${tag}: loop ends with a declared closing leg`);
    for (const t of cLegs) {
      const k = legOk(c, t, r, A0);
      ok(k.inA0 && k.swept, `${tag}: closing leg (${k.L.toFixed(1)} mm) inside A0 and over already-swept floor (${JSON.stringify(k)})`);
    }
  }
  const allowedKinds = pattern === 'linked' ? new Set(['ring', 'close']) : new Set(['morphed', 'close']);
  ok(on.clear.every((c) => c.turns.every((t) => allowedKinds.has(t.kind))), `${tag}: turns are only ${[...allowedKinds].join('/')} (no finish ring in loop)`);
  eq([on.wall.length, on.islands.length], [off.wall.length, off.islands.length], `${tag}: native finish wall and islands match Loop off`);
  if (a > 0) {
    const ringL = offsetRegions(regionsFromRings([sh.outer, ...(sh.holes || [])], 'evenodd'), -r, 0.005).flatMap((g) => [g.outer, ...g.holes]).map((l) => l.map(([x, y]) => ({ x, y })));
    const onFinishRing = (p) => ringL.some((l) => {
      for (let i = 0; i + 1 < l.length; i++) {
        const A = l[i], B = l[i + 1], vx = B.x - A.x, vy = B.y - A.y, L = vx * vx + vy * vy;
        const t = L ? Math.max(0, Math.min(1, ((p.x - A.x) * vx + (p.y - A.y) * vy) / L)) : 0;
        if (Math.hypot(p.x - A.x - t * vx, p.y - A.y - t * vy) <= 0.01) return true;
      }
      return false;
    });
    let along = 0;
    for (const c of on.clear) for (let i = 0; i + 1 < c.points.length; i++) {
      const p = c.points[i], q = c.points[i + 1];
      if (onFinishRing(p) && onFinishRing(q) && onFinishRing({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 })) along += Math.hypot(q.x - p.x, q.y - p.y);
    }
    ok(along <= 0.05, `${tag}: no loop runs on the finish ring (${along.toFixed(2)} mm)`);
  }
  ok(Math.abs(on.leftover.area - off.leftover.area) <= Math.max(0.2, off.leftover.area * 0.01), `${tag}: leftover == Loop off's (${on.leftover.area.toFixed(3)} vs ${off.leftover.area.toFixed(3)} mm²)`);
  const dRaw = rawLeft(sh, on) - rawLeft(sh, off);
  ok(dRaw <= 0.05, `${tag}: raw uncut area <= Loop off's + 0.05 mm² (${dRaw.toFixed(4)})`);
  const dist = distTo(sh);
  let worstIn = Infinity;
  for (const c of on.clear) for (const p of c.points) worstIn = Math.min(worstIn, dist(p) - r);
  ok(worstIn >= -0.02, `${tag}: every point inside R inset by r (worst ${worstIn.toFixed(4)})`);
  eq(on.startPoint, on.clear[0].points[0], `${tag}: startPoint is the first loop's first point`);
  if (pattern === 'linked') {
    const ro = spiralRingsCutOnce(on, off, sh, r, a, s);
    ok(ro.ok, `${tag}: every ring cut once (${JSON.stringify(ro.bad)})`);
    const ord = spiralRingsInOrder(on, sh, r, a, s);
    ok(ord.ok, `${tag}: rings cut in order at normal stepover (${JSON.stringify(ord)})`);
  }
};

for (const [name, sh] of Object.entries(SHAPES)) {
  for (const allowance of [sh.allowance ?? ALLOW_MM, 0]) {
    for (const pattern of ['linked', 'morphed']) {
      const tag = `${name} ${pattern} Loop allow=${allowance}`;
      const more = { finishAllowance: allowance };
      const off = planOf(sh, pattern, more), on = planOf(sh, pattern, { ...more, loop: true }), st = settings(sh, pattern, more);
      if (pattern === 'morphed' && off.refused) {
        eq(on.refused, off.refused, `${tag}: Morphed refused only when Loop off is refused (${off.refused})`);
        continue;
      }
      checkLoopPlan(tag, pattern, on, off, sh, st.r, allowance, st.stepover);
    }
  }
}

// ── 2. A pocket whose neck is narrower than the bit (2 disconnected A0 areas -> 2 closed loops) ──
{
  const narrowDumbbell = {
    outer: close([[0, 0], [40, 0], [40, 18], [60, 18], [60, 0], [100, 0], [100, 40], [60, 40], [60, 22], [40, 22], [40, 40], [0, 40]]),
    bit: 6, allowance: 0.5,
  };
  for (const pattern of ['linked', 'morphed']) {
    const tag = `narrowDumbbell ${pattern} Loop`;
    const off = planOf(narrowDumbbell, pattern), on = planOf(narrowDumbbell, pattern, { loop: true }), st = settings(narrowDumbbell, pattern);
    eq(on.clear.length, 2, `${tag}: 2 areas (4 mm neck < 6 mm bit) -> 2 closed loops`);
    checkLoopPlan(tag, pattern, on, off, narrowDumbbell, st.r, st.allowance, st.stepover);
  }
}

// ── 3. Stepover 75% sweep across all 14 shapes x 2 allowances ──
for (const [name, sh] of Object.entries(SHAPES)) {
  for (const allowance of [sh.allowance ?? ALLOW_MM, 0]) {
    for (const pattern of ['linked', 'morphed']) {
      const tag = `${name} ${pattern} Loop allow=${allowance} step=75`;
      const more = { finishAllowance: allowance, stepover: 75 };
      const off = planOf(sh, pattern, more), on = planOf(sh, pattern, { ...more, loop: true }), st = settings(sh, pattern, more);
      if (pattern === 'morphed' && off.refused) {
        eq(on.refused, off.refused, `${tag}: Morphed refused only when Loop off is refused (${off.refused})`);
        continue;
      }
      checkLoopPlan(tag, pattern, on, off, sh, st.r, allowance, st.stepover);
    }
  }
}

console.log(`pocket-spiral-loop-850: ${checks} checks passed`);
