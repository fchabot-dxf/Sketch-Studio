// tests/pocket-raster-loop-835-node.test.js — TASK 835 / 835b / 835c (was 804b's file): RASTER + LOOP that CUTS BOTH WAYS (#core/pocket-clearing.js
// rasterLoops: TASK 835c, owner turn 3131: per area SEVERAL closed paths, each the boundary of a CLUSTER's comb (every other strip joined by corridors on
// one straight spine near the cluster's middle), the rings (the wall's, each island's) closed paths of their own, cut after the clusters), over the shapes
// of tests/helpers/pocket-shapes-804.js + the owner's bow-tie (the 804b reconstruction of Butterfly_key_1: 3 x 2 in, waist 0.5 in, 1/8 in bit, 0.02 in
// allowance), checked with THE crossing check #core/path-crossings.js:
//  1. at Raster angle 0, the shape's allowance and none: every path closed, zero crossings (all paths together and each alone), the rings SEPARATE closed
//     paths (one per ring: the wall's + each island's, only a ring in each, after every cluster), every pass cut ONCE from the area's edge to the area's
//     edge but for its corridor gaps (each at most half a stepover: no flush plain turn leaves a pass end uncut), NO FLUSH PLAIN TURN (a link between two
//     passes hugging the wall), each cluster's corridors on ONE straight spine within a quarter of the cluster's mean pass length (+ a corridor width)
//     of its middle (the centroid of the region its loop encloses), no clean-up ring, the rings exactly r from the wall, every point inside R inset by r,
//     the leftover == Loop off's (and the raw swept area: no more than 0.03 mm² left), the plunge point (the start mark = the first path's first point)
//     on a pass at least a stepover inside the area (the owner's bow-tie's neck, the square's middle), (with an allowance) no cluster path runs on a ring;
//     TASK 835b: no corridor jog at the wall (no stub of a pass between a corridor and the wall);
//  2. THE HARD RULE over the sweep shapes x angles 30 / 45 / 90 / 137 x allowance (the shape's / 0) x stepover 40 / 75 %: zero crossings, never refused,
//     every path closed, the rings separate, every pass cut once, no flush turn, the spines, the leftover == Loop off's.
import assert from 'node:assert';
import { planClearing, clearingSettings } from '#core/pocket-clearing.js';
import { pathCrossings } from '#core/path-crossings.js';
import { regionsFromRings, diffRegions, regionsArea, offsetRegions } from '#core/plot/clip.js';
import { SHAPES_804, BIT_MM, ALLOW_MM } from './helpers/pocket-shapes-804.js';
import { passCoverage } from './helpers/raster-passes-835.js';

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };
const IN = 25.4, close = (pts) => [...pts, pts[0]];
const SHAPES = {
  ownerBowtie: { outer: close([[-1.5, -1], [0, -0.25], [1.5, -1], [1.5, 1], [0, 0.25], [-1.5, 1]].map(([x, y]) => [x * IN, y * IN])), bit: 0.125 * IN, allowance: 0.02 * IN },
  ...SHAPES_804,
};
const settings = (sh, more = {}) => clearingSettings({ cutType: 'pocket', clearing: 'raster', toolDia: sh.bit || BIT_MM, stepover: 40, finishAllowance: sh.allowance ?? ALLOW_MM, rasterAngle: 0, ...more });
const planOf = (sh, more) => planClearing({ outer: sh.outer, holes: sh.holes || [] }, settings(sh, more));
// the distance from a point to the pocket's edge (its outer loop and islands)
const distTo = (sh) => {
  const loops = [sh.outer, ...(sh.holes || [])].map((r) => r.map(([x, y]) => ({ x, y })));
  const dseg = (p, a, b) => { const vx = b.x - a.x, vy = b.y - a.y, L = vx * vx + vy * vy; const t = L ? Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / L)) : 0; return Math.hypot(p.x - a.x - t * vx, p.y - a.y - t * vy); };
  return (p) => { let m = Infinity; for (const l of loops) for (let i = 0; i + 1 < l.length; i++) m = Math.min(m, dseg(p, l[i], l[i + 1])); return m; };
};
const rawLeft = (sh, plan) => regionsArea(diffRegions(regionsFromRings([sh.outer, ...(sh.holes || [])], 'evenodd'), plan.swept));
// every pass cut once, edge to edge; what of it is not cut is a corridor gap (at most half a stepover, strictly inside it). TASK 835c: no flush plain
// turn, so no pass end is left uncut. (Covered twice: at most 0.1 mm, where the area's edge is tangent to a pass at its end and the walk turns back
// along the wall within 0.003 mm of the pass line: the blob at 90 degrees, 0.067 mm)
const cutOnce = (on, off, s) => {
  const passes = off.clear.filter((c) => c.role === 'raster').map((c) => c.points);
  const cov = passCoverage(on.clear, passes), bad = (x) => !(x.twice <= 0.1 && x.ends <= 0.01 && x.gaps.every((g) => g <= s / 2 + 0.01));
  return { ok: !cov.some(bad), bad: cov.find(bad), gaps: cov.reduce((n, x) => n + x.gaps.length, 0) };
};
// the paths of a Loop plan: the RINGS (a path that is one 'finish' turn and nothing else) and the CLUSTERS (the rest)
const sortPaths = (plan) => { const isRing = (c) => c.turns.length === 1 && c.turns[0].kind === 'finish'; return { rings: plan.clear.filter(isRing), clusters: plan.clear.filter((c) => !isRing(c)), ringAt: plan.clear.map(isRing) }; };
// distance to the clearing's edge (A0 = R inset by r + a)
const edgeDist = (sh, r, a) => {
  const A0 = offsetRegions(regionsFromRings([sh.outer, ...(sh.holes || [])], 'evenodd'), -(r + a), 0.005).flatMap((g) => [g.outer, ...g.holes]).map((l) => l.map(([x, y]) => ({ x, y })));
  return (p) => { let m = Infinity; for (const l of A0) for (let i = 0; i + 1 < l.length; i++) { const A = l[i], B = l[i + 1], vx = B.x - A.x, vy = B.y - A.y, L = vx * vx + vy * vy, t = L ? Math.max(0, Math.min(1, ((p.x - A.x) * vx + (p.y - A.y) * vy) / L)) : 0; m = Math.min(m, Math.hypot(p.x - A.x - t * vx, p.y - A.y - t * vy)); } return m; };
};
// TASK 835c: per cluster path its legs off the clearing's edge (a hairpin is on it): a FLUSH PLAIN TURN (a link next to a pass that HUGS the edge: all
// of it within the corridor width of it) or a CORRIDOR SIDE (the rest); the spine = the corridors' middle u; the cluster's middle = the u of the centroid of the region
// its path encloses; its mean width = its passes' mean length (a pass split by a corridor gap counted once)
const spinesOf = (plan, sh, r, a, s, angle) => {
  const d = edgeDist(sh, r, a), w = Math.min(s / 2, 0.9 * 2 * Math.sqrt(Math.max(0, r * r - Math.max(0, s - r) ** 2)));
  const th = (angle * Math.PI) / 180, U = { x: Math.cos(th), y: -Math.sin(th) }, uOf = (p) => p.x * U.x + p.y * U.y, nOf = (p) => -p.x * U.y + p.y * U.x;
  const out = [];
  let flush = 0;
  for (const c of sortPaths(plan).clusters) {
    const kind = new Array(c.points.length - 1).fill('leg');
    for (const t of c.turns || []) for (let i = t.start; i < t.end; i++) kind[i] = t.kind;
    const us = [], rows = new Map();
    for (let i = 0; i < kind.length; i++) {
      const p = c.points[i], q = c.points[i + 1], L = Math.hypot(q.x - p.x, q.y - p.y);
      if (L < 1e-6) continue;
      if (kind[i] === 'pass') { const k = Math.round(nOf(p) / (s / 2)); if (!rows.has(k)) rows.set(k, []); rows.get(k).push([Math.min(uOf(p), uOf(q)), Math.max(uOf(p), uOf(q))]); continue; }
      const ds = [0, 0.5, 1].map((t) => d({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t }));
      if (ds.some((v) => v <= 0.01)) continue; // on the edge: a hairpin
      if (Math.max(...ds) <= w + 0.02) { if (kind[i - 1] === 'pass' || kind[i + 1] === 'pass') flush++; } else us.push((uOf(p) + uOf(q)) / 2);
    }
    let A = 0, Mu = 0;
    const pts = c.points;
    for (let i = 0; i + 1 < pts.length; i++) { const f = pts[i].x * pts[i + 1].y - pts[i + 1].x * pts[i].y; A += f; Mu += (uOf(pts[i]) + uOf(pts[i + 1])) * f; }
    const m = Mu / (3 * A);
    let len = 0, cnt = 0;
    for (const iv of rows.values()) { iv.sort((x, y) => x[0] - y[0]); let cur = null; for (const [u0, u1] of iv) { if (cur && u0 <= cur[1] + s / 2 + 0.02) cur[1] = Math.max(cur[1], u1); else { if (cur) { len += cur[1] - cur[0]; cnt++; } cur = [u0, u1]; } } if (cur) { len += cur[1] - cur[0]; cnt++; } }
    if (!us.length) { out.push({ spine: null, m, W: cnt ? len / cnt : 0, off: 0, straight: 0 }); continue; }
    const lo = Math.min(...us), hi = Math.max(...us), x = (lo + hi) / 2;
    out.push({ spine: x, m, W: len / cnt, off: Math.abs(x - m), straight: hi - lo, w });
  }
  return { spines: out, flush };
};
// TASK 835b (owner turn 3021, "dont like this"): NO CORRIDOR JOG at the wall: a STUB = a stretch of pass shorter than the wall band (a bit + a stepover)
// between a CORRIDOR side (a stretch between passes off the clearing's edge, A0 = R inset by r + a, further from it than the corridor width: a link hugging
// the wall is a plain turn) and a turn ON that edge. Counted on the loop's own turns.
const jogsOf = (plan, sh, r, a, s) => {
  const A0 = offsetRegions(regionsFromRings([sh.outer, ...(sh.holes || [])], 'evenodd'), -(r + a), 0.005).flatMap((g) => [g.outer, ...g.holes]).map((l) => l.map(([x, y]) => ({ x, y })));
  const d = (p) => { let m = Infinity; for (const l of A0) for (let i = 0; i + 1 < l.length; i++) { const A = l[i], B = l[i + 1], vx = B.x - A.x, vy = B.y - A.y, L = vx * vx + vy * vy, t = L ? Math.max(0, Math.min(1, ((p.x - A.x) * vx + (p.y - A.y) * vy) / L)) : 0; m = Math.min(m, Math.hypot(p.x - A.x - t * vx, p.y - A.y - t * vy)); } return m; };
  const band = 2 * r + s, w = s / 2;
  let jogs = 0;
  for (const c of plan.clear) {
    const kind = new Array(c.points.length - 1).fill('leg');
    for (const t of c.turns || []) for (let i = t.start; i < t.end; i++) kind[i] = t.kind;
    const runs = [];
    for (let i = 0; i < kind.length; i++) { const k = kind[i] === 'pass' || kind[i] === 'finish' ? kind[i] : 'leg'; if (runs.length && runs.at(-1).k === k) runs.at(-1).i.push(i); else runs.push({ k, i: [i] }); }
    const sortOf = (run) => { if (!run || run.k !== 'leg') return run && run.k; const ds = run.i.flatMap((i) => [0, 0.5, 1].map((t) => d({ x: c.points[i].x + (c.points[i + 1].x - c.points[i].x) * t, y: c.points[i].y + (c.points[i + 1].y - c.points[i].y) * t }))); return ds.some((v) => v <= 0.01) ? 'edge' : Math.min(...ds) > w + 0.02 ? 'corridor' : 'hug'; };
    runs.forEach((run, k) => {
      if (run.k !== 'pass') return;
      const len = run.i.reduce((t, i) => t + Math.hypot(c.points[i + 1].x - c.points[i].x, c.points[i + 1].y - c.points[i].y), 0), s1 = sortOf(runs[k - 1]), s2 = sortOf(runs[k + 1]);
      if (len < band - 1e-6 && ((s1 === 'corridor' && s2 === 'edge') || (s1 === 'edge' && s2 === 'corridor'))) jogs++;
    });
  }
  return jogs;
};
// THE CLUSTER checks shared by both sections: closed, crossing-free (together and each alone), the rings separate and last, no flush turn, the spines
const clusterChecks = (tag, on, sh, r, a, s, angle) => {
  const holes = (sh.holes || []).length;
  ok(on.clear.every((c) => c.closed && c.points[0].x === c.points.at(-1).x && c.points[0].y === c.points.at(-1).y), `${tag}: every path closed (first point == last)`);
  eq(pathCrossings(on.clear.map((c) => ({ points: c.points, closed: true }))).count, 0, `${tag}: zero crossings (all the paths together)`);
  ok(on.clear.every((c) => pathCrossings([{ points: c.points, closed: true }]).count === 0), `${tag}: zero crossings on every path`);
  const { rings, clusters, ringAt } = sortPaths(on);
  eq(rings.length, 1 + holes, `${tag}: the wall ring + each island's ring, each a closed path of its own`);
  ok(ringAt.indexOf(true) === clusters.length && ringAt.slice(clusters.length).every(Boolean), `${tag}: the rings cut after every cluster (${ringAt})`);
  ok(clusters.length >= 1 && clusters.every((c) => c.turns.every((t) => t.kind === 'pass')), `${tag}: a cluster path holds passes and the legs between them only (no ring, no clean-up ring)`);
  const { spines, flush } = spinesOf(on, sh, r, a, s, angle);
  eq(flush, 0, `${tag}: no flush plain turn (a link between two passes hugging the wall)`);
  for (const k of spines) if (k.spine !== null) {
    ok(k.straight <= k.w + 0.01, `${tag}: a cluster's corridors on ONE straight spine (their sides span ${k.straight.toFixed(3)} mm across, a corridor is ${k.w.toFixed(3)})`);
    ok(k.off <= k.W / 4 + k.w, `${tag}: the spine near its cluster's middle (${k.off.toFixed(2)} mm off, a quarter of its mean width ${(k.W / 4).toFixed(2)} + a corridor width)`);
  }
  return { rings, clusters, spines };
};
const table = [];

// ── 1. angle 0: the structure ──
for (const [name, sh] of Object.entries(SHAPES)) for (const allowance of [sh.allowance ?? ALLOW_MM, 0]) {
  const tag = `${name} raster Loop allowance ${allowance}`, more = { finishAllowance: allowance };
  const off = planOf(sh, more), on = planOf(sh, { ...more, loop: true }), st = settings(sh, more);
  const r = st.r, s = st.stepover, dist = distTo(sh);
  eq([on.loopRefused, on.loop], [null, true], `${tag}: Loop, not refused`);
  const { rings, clusters, spines } = clusterChecks(tag, on, sh, r, allowance, s, 0);
  const cov = cutOnce(on, off, s);
  ok(cov.ok, `${tag}: every pass cut once, edge to edge, but for its corridor gaps (${JSON.stringify(cov.bad)})`);
  let worstIn = Infinity, worstF = 0;
  for (const c of on.clear) for (const p of c.points) worstIn = Math.min(worstIn, dist(p) - r);
  for (const c of rings) for (const p of c.points) worstF = Math.max(worstF, Math.abs(dist(p) - r));
  ok(worstIn >= -0.02, `${tag}: every point inside R inset by r (worst ${worstIn.toFixed(4)})`);
  ok(worstF <= 0.01, `${tag}: the rings exactly r from the wall / island (worst ${worstF.toFixed(5)})`);
  // THE WALL TRACED ONCE (owner turn 2991: "it goes over itself on every go around"): with an allowance, no cluster path runs ON a ring
  if (allowance > 0) {
    const ringL = offsetRegions(regionsFromRings([sh.outer, ...(sh.holes || [])], 'evenodd'), -r, 0.005).flatMap((g) => [g.outer, ...g.holes]).map((l) => l.map(([x, y]) => ({ x, y })));
    const onRing = (p) => ringL.some((l) => { for (let i = 0; i + 1 < l.length; i++) { const a = l[i], b = l[i + 1], vx = b.x - a.x, vy = b.y - a.y, L = vx * vx + vy * vy, t = L ? Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / L)) : 0; if (Math.hypot(p.x - a.x - t * vx, p.y - a.y - t * vy) <= 0.01) return true; } return false; });
    let along = 0;
    for (const c of clusters) for (let i = 0; i + 1 < c.points.length; i++) { const p = c.points[i], q = c.points[i + 1]; if (onRing(p) && onRing(q) && onRing({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 })) along += Math.hypot(q.x - p.x, q.y - p.y); }
    ok(along <= 0.05, `${tag}: no cluster path runs on a ring (${along.toFixed(2)} mm does)`);
  }
  // (the sliver filter of the reported leftover rounds a sharp unreachable tip differently (the star with no allowance: up to 0.15 mm² either way): the raw
  // uncut area is held to 0.03 mm²)
  ok(Math.abs(on.leftover.area - off.leftover.area) <= Math.max(0.2, off.leftover.area * 0.01), `${tag}: the leftover == Loop off's (${on.leftover.area.toFixed(3)} vs ${off.leftover.area.toFixed(3)} mm²)`);
  const dRaw = rawLeft(sh, on) - rawLeft(sh, off);
  ok(dRaw <= 0.03, `${tag}: the raw uncut area no more than Loop off's + 0.03 mm² (${dRaw.toFixed(4)})`);
  eq(jogsOf(on, sh, r, allowance, s), 0, `${tag}: no corridor jog at the wall (a stub of a pass between a corridor and the wall)`);
  // THE SEAMS: every cluster path starts on a pass; the first (the start mark, the plunge) at least a stepover inside the area (never at its edge)
  const c = on.clear[0];
  eq(on.startPoint, c.points[0], `${tag}: the start mark is the first path's first point`);
  ok(clusters.every((k) => k.turns.some((t) => t.kind === 'pass' && t.start <= 1)), `${tag}: every cluster path starts on a pass`);
  const depth = dist(c.points[0]) - r - allowance;
  ok(depth >= s - 0.01, `${tag}: the plunge point at least a stepover inside the area (${depth.toFixed(2)} mm)`);
  if (name === 'ownerBowtie') ok(Math.abs(c.points[0].x) <= 0.4 * IN && Math.abs(c.points[0].y) <= 0.25 * IN, `${tag}: the plunge point in the bow-tie's middle (${JSON.stringify(c.points[0])})`);
  if (name === 'square') { ok(Math.hypot(c.points[0].x - 40, c.points[0].y - 40) <= st.toolDia, `${tag}: the plunge point within a bit of the square's middle (${JSON.stringify(c.points[0])})`); eq(clusters.length, 1, `${tag}: a convex area is ONE cluster`); }
  const worstOff = Math.max(0, ...spines.map((k) => k.off));
  table.push(`${tag}: ${clusters.length} cluster(s) + ${rings.length} ring(s) = ${on.loopCount} plunges per depth, ${off.passes} passes (${cov.gaps} corridor gaps), spines off their middle <= ${worstOff.toFixed(2)} mm, plunge ${depth.toFixed(1)} mm inside, ${(on.length / 1000).toFixed(2)} m (Loop off ${((off.length + off.finishLength) / 1000).toFixed(2)} m)`);
}

// ── 2. THE HARD RULE over the sweep ──
let n = 0;
for (const [name, sh] of Object.entries(SHAPES)) for (const angle of [30, 45, 90, 137]) for (const allowance of [sh.allowance ?? ALLOW_MM, 0]) for (const stepover of [40, 75]) {
  const tag = `${name} angle ${angle} allowance ${allowance} stepover ${stepover}`, more = { rasterAngle: angle, finishAllowance: allowance, stepover };
  const off = planOf(sh, more), on = planOf(sh, { ...more, loop: true }), st = settings(sh, more);
  eq([on.loopRefused, on.loop], [null, true], `${tag}: Loop, never refused`);
  clusterChecks(tag, on, sh, st.r, allowance, st.stepover, angle);
  const cov = cutOnce(on, off, st.stepover);
  ok(cov.ok, `${tag}: every pass cut once, edge to edge, but for its corridor gaps (${JSON.stringify(cov.bad)})`);
  ok(Math.abs(on.leftover.area - off.leftover.area) <= Math.max(0.2, off.leftover.area * 0.01), `${tag}: the leftover == Loop off's (${on.leftover.area.toFixed(3)} vs ${off.leftover.area.toFixed(3)} mm²)`);
  n++;
}
table.push(`the hard rule: ${n} more cases (angles 30 / 45 / 90 / 137 x allowance x stepover 40 / 75 %), zero crossings, none refused, rings separate, no flush turn`);

console.log(table.join('\n'));
console.log(`pocket-raster-loop-835: ${checks} checks passed`);
