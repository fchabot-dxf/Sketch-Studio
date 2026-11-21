// tests/pocket-raster-loop-835-node.test.js — TASK 835 / 835b / 835c / 835d (was 804b's file): RASTER + LOOP that CUTS BOTH WAYS (#core/pocket-clearing.js
// rasterLoops: TASK 835d, the owner's drawing (turn 3150) and turn 3160: per AREA of the clearing ONE closed path: its pieces (every pass line one chord in
// each, cut perpendicular to the passes), each a SERPENTINE over its passes + a return LANE along one side, joined by LINKS; the rings (the wall's, each
// island's) closed paths of their own, after it), over the shapes of tests/helpers/pocket-shapes-804.js + the owner's bow-tie (the 804b reconstruction of
// Butterfly_key_1: 3 x 2 in, waist 0.5 in, 1/8 in bit, 0.02 in allowance), checked with THE crossing check #core/path-crossings.js:
//  1. at Raster angle 0, the shape's allowance and none: ONE closed path per area of the clearing (A0 = R inset by r + a) + the rings, each closed, zero
//     crossings (all paths together and each alone), the rings separate closed paths (the wall's + each island's, only a ring in each, after the loops),
//     a loop holds passes, links and the legs between only, every pass cut ONCE (uncut: a gap inside it of at most half a stepover (a link), and at its
//     lane end at most the turn-in: a stepover, at most a bit radius), no clean-up ring, the rings exactly r from the wall, every point inside R inset by r,
//     the leftover == Loop off's (and the raw swept area: no more than 0.03 mm² left), the plunge point (the start mark = the first path's first point) on
//     a pass at least a stepover inside the area (the owner's bow-tie's neck, the square's middle), (with an allowance) no loop runs on a ring; TASK 835b:
//     no corridor jog at the wall;
//  2. THE HARD RULE over the sweep shapes x angles 30 / 45 / 90 / 137 x allowance (the shape's / 0) x stepover 40 / 75 %: zero crossings, never refused,
//     one loop per area + the rings, every pass cut once, the leftover == Loop off's.
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
// every pass cut once: what of it is not cut is, inside it, a link's gap (half a stepover; the pieces' cut: 0.002 mm) or the turn-in where a piece's lane
// runs along a cut (the lane sweeps it): at most both pieces' lanes on one cut and a link (the S at 137 degrees, 75 %: two lanes, 6.0 mm); at an end, a stretch every point of which
// lies within the turn-in of the clearing's edge (the bay's passes stop a stepover short of the lane along them, at most a bit radius; + the 0.05 mm round
// the lane edge and the 0.005 mm the loop keeps inside the clearing's edge), or at most two turn-ins long (a short chord inside the turn-ins of a small
// piece at a cut: the star at 137 degrees, 4.0 mm): a short pass at a tip may be uncut whole. (What that leaves is the leftover's: held to Loop off's.) (Covered twice: at most 0.1 mm, where the area's edge is tangent to a pass at its end and the walk turns back along the wall
// within 0.003 mm of the pass line: the blob at 90 degrees, 0.067 mm). With no allowance a stretch of pass lying ON the clearing's edge is the ring's (the
// loop keeps 0.005 mm inside: the Ueven's base pass under its gap)
const cutOnce = (on, off, s, r, sh, a) => {
  const passes = off.clear.filter((c) => c.role === 'raster').map((c) => c.points), turnIn = Math.min(s, r);
  const ring = a > 0 ? null : offsetRegions(regionsFromRings([sh.outer, ...(sh.holes || [])], 'evenodd'), -r, 0.005).flatMap((g) => [g.outer, ...g.holes]).map((l) => l.map(([x, y]) => ({ x, y })));
  const onRing = (p) => ring.some((l) => { for (let i = 0; i + 1 < l.length; i++) { const A = l[i], B = l[i + 1], vx = B.x - A.x, vy = B.y - A.y, L = vx * vx + vy * vy, t = L ? Math.max(0, Math.min(1, ((p.x - A.x) * vx + (p.y - A.y) * vy) / L)) : 0; if (Math.hypot(p.x - A.x - t * vx, p.y - A.y - t * vy) <= 0.01) return true; } return false; });
  const A0 = offsetRegions(regionsFromRings([sh.outer, ...(sh.holes || [])], 'evenodd'), -(r + a), 0.005).flatMap((g) => [g.outer, ...g.holes]).map((l) => l.map(([x, y]) => ({ x, y })));
  const dEdge = (p) => { let m = Infinity; for (const l of A0) for (let i = 0; i + 1 < l.length; i++) { const A = l[i], B = l[i + 1], vx = B.x - A.x, vy = B.y - A.y, L = vx * vx + vy * vy, t = L ? Math.max(0, Math.min(1, ((p.x - A.x) * vx + (p.y - A.y) * vy) / L)) : 0; m = Math.min(m, Math.hypot(p.x - A.x - t * vx, p.y - A.y - t * vy)); } return m; };
  const nearEdge = (pts, u, v, T) => [0, 0.25, 0.5, 0.75, 1].every((f) => { const p = pts[0], q = pts[pts.length - 1], L = Math.hypot(q.x - p.x, q.y - p.y), t = (u + (v - u) * f) / L; return dEdge({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t }) <= T; });
  const ringOwns = (pts, u, v) => ring && [0.1, 0.5, 0.9].every((f) => { const p = pts[0], q = pts[pts.length - 1], L = Math.hypot(q.x - p.x, q.y - p.y), t = (u + (v - u) * f) / L; return onRing({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t }); });
  const cov = passCoverage(on.clear, passes), bad = (x, i) => !(x.twice <= 0.1 && x.uncut.reduce((m, iv) => { if (m.length && iv[0] - m[m.length - 1][1] <= 0.01) m[m.length - 1] = [m[m.length - 1][0], iv[1]]; else m.push(iv); return m; }, []).every(([u, v]) => { const T = turnIn + 0.07, L = x.length, a0 = u <= 0.003, a1 = v >= L - 0.003; return ringOwns(passes[i], u, v) || (!a0 && !a1 ? v - u <= 2 * T + s / 2 : v - u <= 2 * T || nearEdge(passes[i], u, v, T)); }));
  return { ok: !cov.some(bad), bad: cov.find(bad), gaps: cov.reduce((n, x) => n + x.gaps.length, 0) };
};
// the paths of a Loop plan: the RINGS (a path that is one 'finish' turn and nothing else) and the area LOOPS (the rest)
const sortPaths = (plan) => { const isRing = (c) => c.turns.length === 1 && c.turns[0].kind === 'finish'; return { rings: plan.clear.filter(isRing), loops: plan.clear.filter((c) => !isRing(c)), ringAt: plan.clear.map(isRing) }; };
const areasOf = (sh, r, a) => offsetRegions(regionsFromRings([sh.outer, ...(sh.holes || [])], 'evenodd'), -(r + a), 0.005).length;
const len = (c, kind) => c.turns.filter((t) => t.kind === kind).reduce((t, u) => { let L = 0; for (let i = u.start; i < u.end; i++) L += Math.hypot(c.points[i + 1].x - c.points[i].x, c.points[i + 1].y - c.points[i].y); return t + L; }, 0);
// TASK 835b (owner turn 3021, "dont like this"): NO CORRIDOR JOG at the wall: a STUB = a stretch of pass shorter than the wall band (a bit + a stepover)
// between a CORRIDOR side (a stretch between passes off the clearing's edge, A0 = R inset by r + a, further from it than the turn-in: a link hugging
// the wall is a plain turn) and a turn ON that edge. Counted on the loop's own turns.
const jogsOf = (plan, sh, r, a, s) => {
  const A0 = offsetRegions(regionsFromRings([sh.outer, ...(sh.holes || [])], 'evenodd'), -(r + a), 0.005).flatMap((g) => [g.outer, ...g.holes]).map((l) => l.map(([x, y]) => ({ x, y })));
  const d = (p) => { let m = Infinity; for (const l of A0) for (let i = 0; i + 1 < l.length; i++) { const A = l[i], B = l[i + 1], vx = B.x - A.x, vy = B.y - A.y, L = vx * vx + vy * vy, t = L ? Math.max(0, Math.min(1, ((p.x - A.x) * vx + (p.y - A.y) * vy) / L)) : 0; m = Math.min(m, Math.hypot(p.x - A.x - t * vx, p.y - A.y - t * vy)); } return m; };
  const band = 2 * r + s, w = Math.min(s, r); // TASK 835d: a serpentine's turns stand the turn-in (a stepover, at most r) from the lane: a turn, not a corridor
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
// THE LOOP checks shared by both sections: one closed loop per area + the rings separate and after, closed, crossing-free (together and each alone), every
// pass cut once, the leftover == Loop off's
const loopChecks = (tag, on, off, sh, r, a, s) => {
  const holes = (sh.holes || []).length, { rings, loops, ringAt } = sortPaths(on);
  eq([on.loopRefused, on.loop], [null, true], `${tag}: Loop, never refused`);
  ok(on.clear.every((c) => c.closed && c.points[0].x === c.points.at(-1).x && c.points[0].y === c.points.at(-1).y), `${tag}: every path closed (first point == last)`);
  eq(pathCrossings(on.clear.map((c) => ({ points: c.points, closed: true }))).count, 0, `${tag}: zero crossings (all the paths together)`);
  ok(on.clear.every((c) => pathCrossings([{ points: c.points, closed: true }]).count === 0), `${tag}: zero crossings on every path`);
  eq(loops.length, areasOf(sh, r, a), `${tag}: ONE closed loop per area of the clearing (the bit passes everywhere inside one)`);
  eq(rings.length, 1 + holes, `${tag}: the wall ring + each island's ring, each a closed path of its own`);
  ok(ringAt.indexOf(true) === loops.length && ringAt.slice(loops.length).every(Boolean), `${tag}: the rings cut after the loops (${ringAt})`);
  ok(loops.every((c) => c.turns.every((t) => t.kind === 'pass' || t.kind === 'link')), `${tag}: a loop holds passes, links and the legs between only (no ring, no clean-up ring)`);
  const cov = cutOnce(on, off, s, r, sh, a);
  ok(cov.ok, `${tag}: every pass cut once, edge to edge, but a link's gap and the turn-in at its lane end (${JSON.stringify(cov.bad)})`);
  ok(Math.abs(on.leftover.area - off.leftover.area) <= Math.max(0.2, off.leftover.area * 0.01), `${tag}: the leftover == Loop off's (${on.leftover.area.toFixed(3)} vs ${off.leftover.area.toFixed(3)} mm²)`);
  return { rings, loops, cov };
};
const table = [];

// ── 1. angle 0: the structure ──
for (const [name, sh] of Object.entries(SHAPES)) for (const allowance of [sh.allowance ?? ALLOW_MM, 0]) {
  const tag = `${name} raster Loop allowance ${allowance}`, more = { finishAllowance: allowance };
  const off = planOf(sh, more), on = planOf(sh, { ...more, loop: true }), st = settings(sh, more);
  const r = st.r, s = st.stepover, dist = distTo(sh);
  const { rings, loops, cov } = loopChecks(tag, on, off, sh, r, allowance, s);
  let worstIn = Infinity, worstF = 0;
  for (const c of on.clear) for (const p of c.points) worstIn = Math.min(worstIn, dist(p) - r);
  for (const c of rings) for (const p of c.points) worstF = Math.max(worstF, Math.abs(dist(p) - r));
  ok(worstIn >= -0.02, `${tag}: every point inside R inset by r (worst ${worstIn.toFixed(4)})`);
  ok(worstF <= 0.01, `${tag}: the rings exactly r from the wall / island (worst ${worstF.toFixed(5)})`);
  // THE WALL TRACED ONCE (owner turn 2991: "it goes over itself on every go around"): with an allowance, no loop runs ON a ring
  if (allowance > 0) {
    const ringL = offsetRegions(regionsFromRings([sh.outer, ...(sh.holes || [])], 'evenodd'), -r, 0.005).flatMap((g) => [g.outer, ...g.holes]).map((l) => l.map(([x, y]) => ({ x, y })));
    const onRing = (p) => ringL.some((l) => { for (let i = 0; i + 1 < l.length; i++) { const a = l[i], b = l[i + 1], vx = b.x - a.x, vy = b.y - a.y, L = vx * vx + vy * vy, t = L ? Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / L)) : 0; if (Math.hypot(p.x - a.x - t * vx, p.y - a.y - t * vy) <= 0.01) return true; } return false; });
    let along = 0;
    for (const c of loops) for (let i = 0; i + 1 < c.points.length; i++) { const p = c.points[i], q = c.points[i + 1]; if (onRing(p) && onRing(q) && onRing({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 })) along += Math.hypot(q.x - p.x, q.y - p.y); }
    ok(along <= 0.05, `${tag}: no loop runs on a ring (${along.toFixed(2)} mm does)`);
  }
  const dRaw = rawLeft(sh, on) - rawLeft(sh, off);
  ok(dRaw <= 0.03, `${tag}: the raw uncut area no more than Loop off's + 0.03 mm² (${dRaw.toFixed(4)})`);
  eq(jogsOf(on, sh, r, allowance, s), 0, `${tag}: no corridor jog at the wall (a stub of a pass between a corridor and the wall)`);
  // THE SEAM: the first point (the start mark, the plunge) on a pass at least a stepover inside the area (never at its edge)
  const c = on.clear[0];
  eq(on.startPoint, c.points[0], `${tag}: the start mark is the first path's first point`);
  ok(loops.every((k) => k.turns.some((t) => t.kind === 'pass' && t.start <= 1)), `${tag}: every loop starts on a pass`);
  const depth = dist(c.points[0]) - r - allowance;
  ok(depth >= s - 0.01, `${tag}: the plunge point at least a stepover inside the area (${depth.toFixed(2)} mm)`);
  if (name === 'ownerBowtie') ok(Math.abs(c.points[0].x) <= 0.4 * IN && Math.abs(c.points[0].y) <= 0.25 * IN, `${tag}: the plunge point in the bow-tie's middle (${JSON.stringify(c.points[0])})`);
  if (name === 'square') ok(Math.hypot(c.points[0].x - 40, c.points[0].y - 40) <= st.toolDia, `${tag}: the plunge point within a bit of the square's middle (${JSON.stringify(c.points[0])})`);
  const links = loops.reduce((t, k) => t + len(k, 'link'), 0);
  table.push(`${tag}: ${loops.length} loop(s) + ${rings.length} ring(s) = ${on.loopCount} plunges per depth, ${off.passes} passes (${cov.gaps} link gaps), links ${links.toFixed(1)} mm, plunge ${depth.toFixed(1)} mm inside, ${(on.length / 1000).toFixed(2)} m (Loop off ${((off.length + off.finishLength) / 1000).toFixed(2)} m)`);
}

// ── 2. THE HARD RULE over the sweep ──
let n = 0;
for (const [name, sh] of Object.entries(SHAPES)) for (const angle of [30, 45, 90, 137]) for (const allowance of [sh.allowance ?? ALLOW_MM, 0]) for (const stepover of [40, 75]) {
  const tag = `${name} angle ${angle} allowance ${allowance} stepover ${stepover}`, more = { rasterAngle: angle, finishAllowance: allowance, stepover };
  const off = planOf(sh, more), on = planOf(sh, { ...more, loop: true }), st = settings(sh, more);
  loopChecks(tag, on, off, sh, st.r, allowance, st.stepover);
  n++;
}
table.push(`the hard rule: ${n} more cases (angles 30 / 45 / 90 / 137 x allowance x stepover 40 / 75 %), zero crossings, none refused, one loop per area + the rings`);

console.log(table.join('\n'));
console.log(`pocket-raster-loop-835: ${checks} checks passed`);
