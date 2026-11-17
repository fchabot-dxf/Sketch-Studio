// packages/core/pocket-clearing.js — TASK 745: the PROGRAMMED POCKET. A plain Pocket record whose `clearing` is 'concentric' | 'raster' | 'spiral' is
// cut as the toolpath the app computes (the Origin follows it as plain cuts), not as one pocket element the Origin clears by hand ('freehand', the
// default: byte-identical to before). PURE (no DOM). A derivation of the cut RECORD and the pocket's loops (never of the sketch): #core/stepped-cut
// deriveCuts (THE cut derivation of the export, the Prepare look and the 3D Review) passes every plain record's cuts through applyPocketClearing, so
// the downloaded file, Prepare and Review are one result. ONE derivation with a pattern parameter (planClearing).
//
// THE RULES (lengths base mm; r = the record's bit radius, s = the stepover = stepover % x the bit diameter, a = the wall allowance, R = the pocket
// region (its outer loop minus its islands) moved by the record's own offset (positive = away from the wall, as a pocket's offset)):
//  * CLEARING (the pattern), every path an ON-LINE cut (the bit's centre runs on it) at each depth pass, inside the INSET region A0 = R offset inward
//    by r + a (its islands grow by the same: they are respected):
//     - Concentric: ring k = the contours of R offset inward by r + a + k * s (round joins, each straight from R, never an offset of an offset),
//       k = 0, 1, ... until nothing is left; a region that splits gives several loops for one ring; the contours round an island are rings too.
//       ORDER: INSIDE OUT (the innermost ring first). Why: the first ring is a full-width slot (nothing cut beside it yet), and inside out that slot
//       is the shortest ring; every later ring has the cleared side inside it, so the bit takes one stepover of material all round, and the
//       last ring before the wall leaves the allowance for the finish pass.
//     - Raster: straight passes one stepover apart at the Raster angle (degrees, counterclockwise ON SCREEN from the sketch's X axis: 0 = left /
//       right, 90 = up / down; an absolute angle, so the card says what the file has), centred across A0 (the outer margins between s / 2 and s),
//       clipped to A0 (an island cuts a pass into pieces). Kept as SEPARATE open paths in ZIGZAG order (pass k + 1 runs back the way pass k
//       came). Not joined into one path: a straight link between two pass ends can leave A0 on a curved or concave edge (it would cut the wall),
//       passes split by an island belong to different areas, and on the Origin every path is picked, plunged and followed one at a time anyway.
//       Then ONE clean-up ring = the contours of A0 (ring 0 of Concentric, as CAM does), which removes the scalloped pass ends.
//     - Morphed spiral: ONE open path from the middle out, no lift: the central loop (the innermost ring), then one turn per ring morphing into the
//       next ring out, then a full closing turn along A0's contour (no clean-up ring needed). CONSTRUCTION: every ring point gets a parameter
//       phi in [0, 1): on the outermost ring its arc length / the ring's length from the START (the end of a chain of nearest points from the
//       middle of the innermost ring's longest edge out: every turn starts where its two rings are one stepover apart, never at a corner, where
//       the next turn out would leave late); on ring k + 1 the phi of its NEAREST point on ring k (an offset curve: that point is one stepover
//       away along the normal), so all rings share phi; where those nearest points jump (a convex corner of the inner ring; a part of the outer
//       ring the inner one does not reach: the end of an arm), each outer point in the jump gets its nearest point on the inner ring there (the
//       inner corner HOLDS while phi sweeps the outer corner). The turn from ring k + 1 out to ring k: at phi, with A / B = the inner / outer ring's
//       point at phi, the point A + phi * (B - A) (the lerp) while |A - B| <= s * sqrt 2 (the rings one stepover apart, or across an inner corner of 90
//       degrees or more: there the lerp IS the inner offset of the outer ring at depth (1 - phi) * s); where |A - B| is longer (an arm of the outer ring
//       the inner ring does not reach) the point lies (1 - phi) * reach from B toward A, the reach falling linearly from sqrt 2 stepovers at |A - B| =
//       s * sqrt 2 to one stepover at |A - B| = 2 s and staying one stepover beyond (continuous: the turn follows the arm one stepover in). So at phi the
//       turn is (1 - phi) * s inside ring k and the next turn out phi * s outside it along the same normal: the gap between neighbouring turns is the
//       stepover. The point lies on the segment from B to A inside ring k's region: the path stays in A0. Turns are simplified to POCKET_CLEARING.pathTolMm.
//       NOT POSSIBLE (the option is refused with its reason, no silent fallback): a pocket with islands, or one whose rings SPLIT (a neck).
//  * DEPTH PASSES: the record's `passDepth` (empty = one pass at the full depth): passes at passDepth, 2 x passDepth, ... and the full depth; the
//    clearing set is repeated at each pass depth, shallow to deep.
//  * FINISH PASS, last, at the full depth: the pocket's own outer loop as the Origin's INSIDE cut (the wall is exact with whatever bit is in the
//    machine; the record's offset is its cutOffset), and each island's loop as an OUTSIDE cut. Refused (the pocket is cut Freehand and the note says
//    why) when that pass would cut an island or the wall (an island closer to the wall or to another island than the bit).
//  * LEFTOVER (never hidden): the part of R the bit does not sweep (the swept area of every clearing path at the record's bit radius + the finish
//    pass), ignoring slivers thinner than 2 x sliverMm (the offsets' rounding); reported when over leftoverTolMm2, with how much of it the bit cannot
//    reach at all (sharp inside corners, necks narrower than the bit: R minus R opened by r) and how much the pattern missed (a stepover too big).
//  * The clearing paths depend on the record's bit diameter (written as toolDia on every path); the finish pass does not.
import { offsetRegions, sweepPaths, clipOpenPaths, regionsArea, regionsFromRings, diffRegions, unionRegions } from './plot/clip.js';
import { loopWalk, walkPoints } from './hold-part.js';
import { num } from './loop-geometry.js';

export const POCKET_CLEARING = Object.freeze({
  /** the record field `clearing`: Freehand (the Origin clears it: the default) | the patterns the app computes */
  patterns: Object.freeze([
    Object.freeze({ id: 'freehand', label: 'Freehand' }),
    Object.freeze({ id: 'concentric', label: 'Concentric' }),
    Object.freeze({ id: 'raster', label: 'Raster' }),
    Object.freeze({ id: 'spiral', label: 'Morphed spiral' }),
  ]),
  /** stepover, % of the bit diameter (record field `stepover`) */
  stepoverPct: Object.freeze({ default: 40, min: 1, max: 100 }),
  /** wall allowance left for the finish pass, base mm by document unit family (record field `wallAllowance`): 0.5 mm / 0.02 in */
  wallAllowance: Object.freeze({ mm: 0.5, in: 0.508 }),
  /** raster angle, degrees (record field `rasterAngle`) */
  rasterAngle: 0,
  /** the feed the card's time estimate assumes (mm per minute: a steady hand-guided pace on the Origin) */
  feedMmPerMin: 1000,
  /** uncut area (mm²) at or below this is not reported; slivers thinner than 2 x sliverMm (mm) are the offsets' rounding, not uncut material */
  leftoverTolMm2: 0.1,
  sliverMm: 0.01,
  /** arcs sampled / rounded at this chord sagitta (mm); paths simplified to this deviation (mm) */
  chordTolMm: 0.005,
  pathTolMm: 0.01,
  /** a safety bound on the number of rings */
  maxRings: 2000,
});
const PATTERNS = new Set(['concentric', 'raster', 'spiral']);
const FINISH_TOL_MM2 = 0.05; // the finish pass may not sweep more than this outside the pocket region (else it cuts an island or the wall)

/** The clearing a record is cut with: 'freehand' | 'concentric' | 'raster' | 'spiral' (only a plain Pocket programs its clearing). */
export function clearingPattern(rec) {
  if (!rec || rec.terraceAs || rec.cutType !== 'pocket') return 'freehand';
  return PATTERNS.has(rec.clearing) ? rec.clearing : 'freehand';
}
/** The wall allowance default (base mm) for a document unit. */
export const allowanceDefault = (unit) => (unit === 'in' ? POCKET_CLEARING.wallAllowance.in : POCKET_CLEARING.wallAllowance.mm);

/** A record's clearing settings: { pattern, toolDia, r, stepoverPct, stepover (mm), allowance, offset, passDepth (mm | null), angle (deg) }. */
export function clearingSettings(rec) {
  const S = POCKET_CLEARING.stepoverPct;
  const toolDia = Number(rec && rec.toolDia) > 0 ? Number(rec.toolDia) : 0;
  const pct = Number(rec && rec.stepover) > 0 ? Math.min(S.max, Math.max(S.min, Number(rec.stepover))) : S.default;
  const allowance = rec && rec.wallAllowance != null && Number.isFinite(Number(rec.wallAllowance)) && Number(rec.wallAllowance) >= 0 ? Number(rec.wallAllowance) : POCKET_CLEARING.wallAllowance.mm;
  const angle = rec && Number.isFinite(Number(rec.rasterAngle)) && rec.rasterAngle !== null && rec.rasterAngle !== '' ? Number(rec.rasterAngle) : POCKET_CLEARING.rasterAngle;
  return { pattern: clearingPattern(rec), toolDia, r: toolDia / 2, stepoverPct: pct, stepover: (pct / 100) * toolDia, allowance, offset: Number(rec && rec.cutOffset) || 0, passDepth: Number(rec && rec.passDepth) > 0 ? Number(rec.passDepth) : null, angle };
}

/** The depth passes (base mm, shallow to deep, the last = the cut depth) of a cut depth with an optional depth per pass; an unset depth = one pass. */
export function passDepths(cutDepth, passDepth) {
  const D = Number(cutDepth);
  if (cutDepth == null || cutDepth === 'unset' || !(D > 0)) return [cutDepth];
  const p = Number(passDepth);
  if (!(p > 0) || p >= D - 1e-9) return [D];
  const out = [];
  for (let i = 1; i * p < D - 1e-9; i++) out.push(Math.round(i * p * 1e9) / 1e9);
  out.push(D);
  return out;
}

// ── geometry helpers ([x, y] points inside, { x, y } at the edges) ──
const P = (x, y) => ({ x, y });
const toXY = (ring) => ring.slice(0, -1).map(([x, y]) => P(x, y)); // a closed [[x,y]...] ring (closing point repeated) -> open {x,y}[]
const closedRing = (pts) => [...pts.map((p) => [p.x, p.y]), [pts[0].x, pts[0].y]];
const contoursOf = (regions) => regions.flatMap((r) => [r.outer, ...r.holes]).map(toXY).filter((pts) => pts.length >= 3);
function signedArea(pts) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j].x * pts[i].y - pts[i].x * pts[j].y;
  return a / 2;
}
const positive = (pts) => (signedArea(pts) < 0 ? pts.slice().reverse() : pts);
function pathLength(pts, closed) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  if (closed && pts.length > 2) L += Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y);
  return L;
}
function distToSeg(p, a, b) {
  const vx = b.x - a.x, vy = b.y - a.y, L = vx * vx + vy * vy;
  const t = L > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / L)) : 0;
  return { d: Math.hypot(p.x - a.x - t * vx, p.y - a.y - t * vy), t };
}
/** Douglas-Peucker on an open polyline (the ends are kept). */
export function simplifyPath(pts, tol) {
  if (pts.length <= 2) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop();
    let worst = -1, at = -1;
    for (let k = i + 1; k < j; k++) { const d = distToSeg(pts[k], pts[i], pts[j]).d; if (d > worst) { worst = d; at = k; } }
    if (worst > tol) { keep[at] = 1; stack.push([i, at], [at, j]); }
  }
  return pts.filter((_, k) => keep[k]);
}
const withoutSlivers = (regions) => (regions.length ? offsetRegions(offsetRegions(regions, -POCKET_CLEARING.sliverMm), POCKET_CLEARING.sliverMm) : []);
const pathD = (pts, closed) => `M ${pts.map((p) => `${num(p.x)} ${num(p.y)}`).join(' L ')}${closed ? ' Z' : ''}`;

// ── concentric rings: [level][loops] (level 0 = the outermost, at r + a) ──
function ringLevels(R, d0, s) {
  const levels = [];
  if (!(s > 0)) return levels;
  for (let k = 0; k < POCKET_CLEARING.maxRings; k++) {
    const E = offsetRegions(R, -(d0 + k * s), POCKET_CLEARING.chordTolMm);
    if (!E.length) break;
    levels.push(E);
  }
  return levels;
}

// ── raster passes ──
function rasterPasses(A0, s, angleDeg) {
  const th = (angleDeg * Math.PI) / 180;
  const u = P(Math.cos(th), -Math.sin(th)); // ON SCREEN counterclockwise from +X (world y points down)
  const n = P(-u.y, u.x);
  const pts = A0.flatMap((r) => r.outer);
  if (!pts.length || !(s > 0)) return [];
  const pu = pts.map(([x, y]) => x * u.x + y * u.y), pn = pts.map(([x, y]) => x * n.x + y * n.y);
  const uLo = Math.min(...pu) - 1, uHi = Math.max(...pu) + 1, lo = Math.min(...pn), hi = Math.max(...pn);
  const width = hi - lo;
  const m = Math.max(1, Math.ceil(width / s - 1e-9) - 1);
  const start = lo + (width - (m - 1) * s) / 2;
  const lines = [];
  for (let k = 0; k < m; k++) {
    const c = start + k * s;
    lines.push([[n.x * c + u.x * uLo, n.y * c + u.y * uLo], [n.x * c + u.x * uHi, n.y * c + u.y * uHi]]);
  }
  const byLine = new Map();
  for (const piece of clipOpenPaths(lines, A0)) {
    const a = piece[0], b = piece[piece.length - 1];
    const k = Math.round((((a[0] + b[0]) / 2) * n.x + ((a[1] + b[1]) / 2) * n.y - start) / s);
    let seg = piece.map(([x, y]) => P(x, y));
    const ua = seg[0].x * u.x + seg[0].y * u.y, ub = seg[seg.length - 1].x * u.x + seg[seg.length - 1].y * u.y;
    if (ua > ub) seg = seg.reverse();
    if (pathLength(seg, false) < 1e-3) continue;
    if (!byLine.has(k)) byLine.set(k, []);
    byLine.get(k).push(seg);
  }
  const out = [];
  [...byLine.keys()].sort((a, b) => a - b).forEach((k, i) => {
    const segs = byLine.get(k).sort((p, q) => (p[0].x * u.x + p[0].y * u.y) - (q[0].x * u.x + q[0].y * u.y));
    const zig = i % 2 === 1; // every other pass runs back the way the previous one came
    for (const seg of zig ? segs.reverse() : segs) out.push({ points: zig ? seg.slice().reverse() : seg, line: k, offset: start + k * s });
  });
  return out;
}

// ── the morphed spiral (see THE RULES) ──
function densify(pts, h) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / h));
    for (let k = 0; k < n; k++) out.push(P(a.x + ((b.x - a.x) * k) / n, a.y + ((b.y - a.y) * k) / n));
  }
  return out;
}
// a uniform grid over a closed sample list's segments (i -> i + 1, the list repeats its first sample at the end) for nearest-point queries
function segGrid(S, cell) {
  const map = new Map(), key = (i, j) => i * 73856093 ^ j * 19349663;
  for (let i = 0; i < S.length - 1; i++) {
    const a = S[i].p, b = S[i + 1].p;
    const x0 = Math.floor(Math.min(a.x, b.x) / cell), x1 = Math.floor(Math.max(a.x, b.x) / cell), y0 = Math.floor(Math.min(a.y, b.y) / cell), y1 = Math.floor(Math.max(a.y, b.y) / cell);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) { const k = key(x, y); let c = map.get(k); if (!c) { c = []; map.set(k, c); } c.push(i); }
  }
  return { cell, map, key, S };
}
function nearestOn(g, q) {
  for (let R = g.cell; ; R *= 2) {
    const x0 = Math.floor((q.x - R) / g.cell), x1 = Math.floor((q.x + R) / g.cell), y0 = Math.floor((q.y - R) / g.cell), y1 = Math.floor((q.y + R) / g.cell);
    let best = null;
    const seen = new Set();
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
      for (const i of g.map.get(g.key(x, y)) || []) {
        if (seen.has(i)) continue;
        seen.add(i);
        const f = distToSeg(q, g.S[i].p, g.S[i + 1].p);
        if (!best || f.d < best.d) best = { i, t: f.t, d: f.d };
      }
    }
    if (best && best.d <= R) return best;
    if (R > 1e6) return best;
  }
}
const phiAt = (S, f) => S[f.i].phi + (S[f.i + 1].phi - S[f.i].phi) * f.t;
// a ring's samples with phi by arc length from its first vertex: [{ p, phi }] closed (the last = the first, phi 1)
function byLength(pts) {
  const L = pathLength(pts, true);
  const out = [];
  let acc = 0;
  pts.forEach((p, i) => { if (i) acc += Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y); out.push({ p, phi: acc / L }); });
  out.push({ p: pts[0], phi: 1 });
  return out;
}
// ring k + 1's samples with the phi of their nearest point on ring k (outer, sampled with phi), rotated to start at phi 0: [{ p, phi }] closed, or null.
// Between two inner samples the phi of their nearest points can jump (a convex corner of the inner ring: its nearest point jumps across the outer
// ring's corner; a part of the outer ring the inner one does not reach): every outer sample whose phi lies in that jump is put on the inner segment
// at ITS nearest point there (an outer corner's samples all land on the inner corner: the corner HOLDS while phi sweeps the outer corner).
function propagate(inner, outer, h, s) {
  const g = segGrid(outer, Math.max(s, h * 4));
  const raw = inner.map((q) => phiAt(outer, nearestOn(g, q)));
  const ph = [];
  raw.forEach((v, j) => {
    if (!j) { ph.push(v % 1); return; }
    let x = v + Math.round(ph[j - 1] - v); // the unwrapped value nearest the previous one
    if (x < ph[j - 1]) x = ph[j - 1];      // never backwards (rounding)
    ph.push(x);
  });
  let last = raw[0] + Math.round(ph[ph.length - 1] - raw[0]);
  if (last < ph[ph.length - 1]) last += 1;
  if (Math.abs(last - ph[0] - 1) > 0.25) return null; // the rings do not wind the same way round (never for nested offsets)
  const n = inner.length, oPhi = outer.map((x) => x.phi); // outer: phi 0 .. 1, closed
  const firstAbove = (v) => { let lo = 0, hi = oPhi.length; while (lo < hi) { const m = (lo + hi) >> 1; if (oPhi[m] <= v) lo = m + 1; else hi = m; } return lo; };
  const S = [];
  for (let j = 0; j < n; j++) {
    const a = ph[j], b = j + 1 < n ? ph[j + 1] : last, q = inner[j], qn = inner[(j + 1) % n];
    S.push({ p: q, phi: a });
    for (let m = Math.floor(a); m <= Math.floor(b); m++) { // the outer samples with phi in (a, b) (phi unwrapped by whole turns m)
      for (let i = firstAbove(a - m); i < oPhi.length && oPhi[i] + m < b; i++) {
        if (oPhi[i] + m <= a) continue;
        const f = distToSeg(outer[i].p, q, qn);
        S.push({ p: P(q.x + (qn.x - q.x) * f.t, q.y + (qn.y - q.y) * f.t), phi: oPhi[i] + m });
      }
    }
  }
  S.push({ p: inner[0], phi: last });
  // rotate to phi = 0 (an integer): the loop runs from ph[0] to ph[0] + 1
  const c = Math.ceil(ph[0] - 1e-12);
  const ext = [...S, ...S.slice(1).map((x) => ({ p: x.p, phi: x.phi + (last - ph[0]) }))];
  const cross = (v) => {
    for (let i = 0; i < ext.length - 1; i++) {
      const A = ext[i], B = ext[i + 1];
      if (A.phi <= v && B.phi >= v) {
        const t = B.phi > A.phi ? (v - A.phi) / (B.phi - A.phi) : 0;
        return { i, pt: { p: P(A.p.x + (B.p.x - A.p.x) * t, A.p.y + (B.p.y - A.p.y) * t), phi: v } };
      }
    }
    return null;
  };
  const s0 = cross(c), s1 = cross(c + 1);
  if (!s0 || !s1) return null;
  const out = [s0.pt, ...ext.slice(s0.i + 1, s1.i + 1).filter((x) => x.phi > c && x.phi < c + 1), s1.pt];
  return out.map((x) => ({ p: x.p, phi: x.phi - c }));
}
// the point of a sampled ring at phi (piecewise linear between its samples)
function ringAt(S, phi) {
  let lo = 0, hi = S.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (S[m].phi <= phi) lo = m; else hi = m; }
  const A = S[lo], B = S[hi];
  const t = B.phi > A.phi ? Math.max(0, Math.min(1, (phi - A.phi) / (B.phi - A.phi))) : 0;
  return P(A.p.x + (B.p.x - A.p.x) * t, A.p.y + (B.p.y - A.p.y) * t);
}
// the turn from ring `inner` out to ring `outer` (both sampled with phi from 0 to 1) for a stepover s: at phi the point (1 - phi) * s from B toward A
// (the lerp A + phi * (B - A) where |A - B| <= s)
// the reach from the outer ring toward A, in stepovers, for |A - B| = l stepovers: l (the lerp) up to sqrt 2 (an inner corner of 90 degrees or more: the lerp is exactly the
// inner offset there), then falling linearly to 1 at l = 2 and 1 beyond (an arm the inner ring does not reach: the turn follows the outer ring one stepover in)
const CAP = Math.SQRT2, ARM = 2;
const depthOf = (l) => (l <= CAP ? l : l >= ARM ? 1 : CAP - ((CAP - 1) * (l - CAP)) / (ARM - CAP));
function transition(inner, outer, s) {
  const ev = [...inner.map((x) => ({ phi: x.phi, A: x.p })), ...outer.map((x) => ({ phi: x.phi, B: x.p }))].sort((a, b) => a.phi - b.phi);
  return ev.map((e) => {
    const A = e.A || ringAt(inner, e.phi), B = e.B || ringAt(outer, e.phi);
    const L = Math.hypot(A.x - B.x, A.y - B.y), k = L <= CAP * s ? 1 - e.phi : ((1 - e.phi) * depthOf(L / s) * s) / L;
    return P(B.x + k * (A.x - B.x), B.y + k * (A.y - B.y));
  });
}
/** The morphed spiral through `rings` (outermost first, one closed loop each, open {x,y}[]) for a stepover s: { points, turns: [start index of each
 *  turn in points] } (an open path: the central loop, a turn per ring out, the closing turn along rings[0]), or null. */
export function morphedSpiral(rings, s) {
  if (!rings.length) return null;
  const h = Math.min(0.5, Math.max(0.02, s / 10));
  // phi = 0 is a CHAIN of nearest points from the middle of the innermost ring's longest edge out to the outermost ring (each one stepover from the
  // next: every turn starts where its two rings are one stepover apart, never at a corner, so the path is continuous and the next turn out leaves on time)
  const R0 = rings.map(positive);
  const nearestOnPoly = (poly, p) => {
    let best = null;
    for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length], f = distToSeg(p, a, b); if (!best || f.d < best.d) best = { i, t: f.t, d: f.d, p: P(a.x + (b.x - a.x) * f.t, a.y + (b.y - a.y) * f.t) }; }
    return best;
  };
  const inn = R0[R0.length - 1];
  let li = 0;
  const segL = (o, i) => Math.hypot(o[(i + 1) % o.length].x - o[i].x, o[(i + 1) % o.length].y - o[i].y);
  for (let i = 1; i < inn.length; i++) if (segL(inn, i) > segL(inn, li)) li = i;
  let c = P((inn[li].x + inn[(li + 1) % inn.length].x) / 2, (inn[li].y + inn[(li + 1) % inn.length].y) / 2);
  for (let k = R0.length - 2; k >= 0; k--) c = nearestOnPoly(R0[k], c).p;
  const o = R0[0], at = nearestOnPoly(o, c);
  const start = [at.p, ...o.slice(at.i + 1), ...o.slice(0, at.i + 1)];
  const sampled = [byLength(densify(start, h))];
  for (let k = 1; k < rings.length; k++) {
    const S = propagate(densify(positive(rings[k]), h), sampled[k - 1], h, s);
    if (!S) return null;
    sampled.push(S);
  }
  const K = sampled.length - 1, tol = POCKET_CLEARING.pathTolMm;
  const turns = [sampled[K].map((x) => x.p)];
  for (let k = K - 1; k >= 0; k--) turns.push(transition(sampled[k + 1], sampled[k], s));
  if (K > 0) turns.push(sampled[0].map((x) => x.p));
  const points = [], starts = [];
  for (const t of turns) {
    const sp = simplifyPath(t, tol);
    starts.push(points.length ? points.length - 1 : 0);
    for (const p of points.length ? sp.slice(1) : sp) points.push(p);
  }
  return { points, turns: starts };
}

// ── the plan of one pocket (memoised: the same loops + settings give the same plan) ──
const MEMO = new Map(), MEMO_MAX = 48;
/**
 * planClearing({ outer, holes }, settings) -> the clearing of a pocket region (THE RULES), independent of depth:
 *   { pattern, clear: [{ points, closed, role: 'ring' | 'raster' | 'cleanup' | 'spiral', level?, index, count }] (in cutting order),
 *     levels (Concentric / spiral: the number of rings), loops (their loops), passes (Raster), cleanup (Raster: the clean-up loops), turns (spiral),
 *     wall: [centre loops], islands: [[centre loops] per island], swept (regions), leftover: { area, unreachable, missed, regions }, length (mm),
 *     spiralBlocked: null | 'islands' | 'splits', refused: null | 'no bit' | 'bit too big' | 'islands close' | 'spiral islands' | 'spiral splits' }
 * outer / holes = closed [[x,y],...] rings (base mm).
 */
export function planClearing(rings, st) {
  const key = JSON.stringify([rings, st.pattern, st.r, st.stepover, st.allowance, st.offset, st.pattern === 'raster' ? st.angle : null]);
  if (MEMO.has(key)) return MEMO.get(key);
  const plan = computePlan(rings, st);
  MEMO.set(key, plan);
  if (MEMO.size > MEMO_MAX) MEMO.delete(MEMO.keys().next().value);
  return plan;
}
function computePlan({ outer, holes }, st) {
  const { pattern, r, stepover: s, allowance: a, offset: off } = st;
  const base = { pattern, clear: [], levels: 0, loops: 0, passes: 0, cleanup: 0, turns: 0, wall: [], islands: [], swept: [], leftover: { area: 0, unreachable: 0, missed: 0, regions: [] }, length: 0, spiralBlocked: null, refused: null };
  if (!(r > 0)) return { ...base, refused: 'no bit' };
  const R0 = regionsFromRings([outer, ...holes], 'evenodd');
  const R = off ? offsetRegions(R0, -off, POCKET_CLEARING.chordTolMm) : R0;
  const outerR = off ? offsetRegions(regionsFromRings([outer]), -off, POCKET_CLEARING.chordTolMm) : regionsFromRings([outer]);
  const islandR = holes.map((h) => (off ? offsetRegions(regionsFromRings([h]), off, POCKET_CLEARING.chordTolMm) : regionsFromRings([h])));
  // the finish pass: the wall's centre (the outer loop offset inward by r) and each island's (offset outward by r), as the Origin cuts them
  const wall = contoursOf(offsetRegions(outerR, -r, POCKET_CLEARING.chordTolMm));
  if (!wall.length || !R.length) return { ...base, refused: 'bit too big' };
  const islands = islandR.map((ir) => contoursOf(offsetRegions(ir, r, POCKET_CLEARING.chordTolMm)));
  const finish = [...wall, ...islands.flat()].map((pts) => ({ points: pts.map((p) => [p.x, p.y]), closed: true }));
  const finishSwept = sweepPaths(finish, r, POCKET_CLEARING.chordTolMm);
  if (regionsArea(withoutSlivers(diffRegions(finishSwept, R))) > FINISH_TOL_MM2) return { ...base, wall, islands, refused: 'islands close' };
  // the clearing
  const d0 = r + a;
  let clear = [], levels = 0, loops = 0, passes = 0, cleanup = 0, turns = 0, spiralBlocked = null;
  const needRings = pattern === 'concentric' || pattern === 'spiral';
  const L = needRings ? ringLevels(R, d0, s) : [];
  if (needRings) {
    spiralBlocked = holes.length ? 'islands' : L.some((E) => E.length !== 1 || E[0].holes.length) ? 'splits' : null;
    levels = L.length;
    loops = L.reduce((n, E) => n + contoursOf(E).length, 0);
  }
  if (pattern === 'concentric') {
    for (let k = L.length - 1; k >= 0; k--) for (const pts of contoursOf(L[k])) clear.push({ points: pts, closed: true, role: 'ring', level: k, index: L.length - k, count: L.length });
  } else if (pattern === 'spiral') {
    if (spiralBlocked) return { ...base, wall, islands, levels, loops, spiralBlocked, refused: 'spiral ' + spiralBlocked };
    if (L.length) {
      const sp = morphedSpiral(L.map((E) => toXY(E[0].outer)), s);
      if (!sp) return { ...base, wall, islands, levels, loops, spiralBlocked: 'splits', refused: 'spiral splits' };
      turns = sp.turns.length;
      clear.push({ points: sp.points, closed: false, role: 'spiral', index: 1, count: 1, turnStarts: sp.turns });
    }
  } else if (pattern === 'raster') {
    const A0 = offsetRegions(R, -d0, POCKET_CLEARING.chordTolMm);
    const lines = A0.length ? rasterPasses(A0, s, st.angle) : [];
    passes = lines.length;
    lines.forEach((l, i) => clear.push({ points: l.points, closed: false, role: 'raster', index: i + 1, count: lines.length, offset: l.offset }));
    const ring0 = contoursOf(A0);
    cleanup = ring0.length;
    ring0.forEach((pts, i) => clear.push({ points: pts, closed: true, role: 'cleanup', level: 0, index: i + 1, count: ring0.length }));
  }
  // what the bit sweeps (the clearing + the finish pass) and what it leaves
  const all = [...clear.map((c) => ({ points: c.points.map((p) => [p.x, p.y]), closed: c.closed })), ...finish];
  const swept = sweepPaths(all, r, POCKET_CLEARING.chordTolMm);
  const leftR = withoutSlivers(diffRegions(R, swept));
  const area = regionsArea(leftR);
  const reachable = offsetRegions(offsetRegions(R, -r, POCKET_CLEARING.chordTolMm), r, POCKET_CLEARING.chordTolMm);
  const unreachable = Math.min(area, regionsArea(withoutSlivers(diffRegions(R, reachable))));
  const length = clear.reduce((t, c) => t + pathLength(c.points, c.closed), 0);
  const finishLength = [...wall, ...islands.flat()].reduce((t, pts) => t + pathLength(pts, true), 0);
  return { pattern, clear, levels, loops, passes, cleanup, turns, wall, islands, swept, leftover: { area, unreachable, missed: Math.max(0, area - unreachable), regions: leftR }, length, finishLength, spiralBlocked, refused: null };
}

/** A pocket cut's region rings ({ outer, holes }: closed [[x,y],...], arcs exact to chordTolMm) from its loops (#core/hold-part loopWalk), or null. */
export function pocketRings(cut, state) {
  const ring = (loop) => { const w = loopWalk(loop, state); if (!w) return null; const pts = walkPoints(w); return pts.length >= 3 ? closedRing(pts) : null; };
  const outer = cut && cut.outerLoop ? ring(cut.outerLoop) : null;
  if (!outer) return null;
  const holes = (cut.holeLoops || []).map(ring);
  return holes.some((h) => !h) ? null : { outer, holes };
}

/** The spiral's availability on a pocket cut for a record's settings: null (possible) | 'islands' | 'splits' | another refusal. */
export function spiralBlocker(cut, rec, state) {
  const rings = pocketRings(cut, state);
  if (!rings) return 'outline';
  if (rings.holes.length) return 'islands';
  const plan = planClearing(rings, { ...clearingSettings(rec), pattern: 'spiral' });
  return plan.spiralBlocked || plan.refused || null;
}

// the sweep of a cut's centre paths at a bit radius (deriveCutFootprint calls it with the record's radius, or a shaped cutter's half-width)
function sweeper(centers) {
  const memo = new Map();
  return (rr) => {
    if (!memo.has(rr)) memo.set(rr, sweepPaths(centers.map((c) => ({ points: c.points.map((p) => [p.x, p.y]), closed: c.closed })), rr, POCKET_CLEARING.chordTolMm)
      .flatMap((g) => [g.outer, ...g.holes].map((ring) => ring.slice(0, -1).map(([x, y]) => P(x, y)))));
    return memo.get(rr);
  };
}

/**
 * applyPocketClearing(cuts, rec, state) -> cuts — #core/profile-model deriveProfileCuts' cuts for `rec` with its clearing programmed (unchanged, the SAME
 * array, when clearingPattern(rec) is 'freehand'). The pocket cut becomes, per depth pass, the clearing paths as ON-LINE cuts (kind 'clearing', the
 * exported `geom`, `centers` = the tool-centre path, `sweep(radius)` = its swept area, `clearing` = { role, index, count, level, pass, passes, depth }),
 * then the finish pass: the outer loop as an INSIDE cut ('interior', the loop itself: the exporter writes its exact lines / arcs) and each island as
 * an OUTSIDE cut ('exterior'), at the full depth. The wall cut's `clearing.summary` = the plan (counts, length, leftover, swept) for the card, the
 * operations list and the Prepare look. A refused clearing leaves the pocket cut as it is with `clearing` = { role: 'refused', refused, summary }.
 */
export function applyPocketClearing(cuts, rec, state) {
  const pattern = clearingPattern(rec);
  if (pattern === 'freehand' || !Array.isArray(cuts)) return cuts;
  const pocket = cuts.find((c) => c && c.isCompound && c.cutType === 'pocket');
  if (!pocket) return cuts;
  const st = clearingSettings(rec);
  const rings = pocketRings(pocket, state);
  const plan = rings ? planClearing(rings, st) : { pattern, refused: 'outline' };
  const depths = passDepths(rec.cutDepth, st.passDepth);
  const summary = { ...plan, settings: st, depths };
  if (plan.refused) return cuts.map((c) => (c === pocket ? { ...c, clearing: { role: 'refused', refused: plan.refused, summary } } : c));
  const out = [];
  depths.forEach((depth, pass) => {
    for (const c of plan.clear) {
      const centers = [{ points: c.points, closed: c.closed }];
      out.push({ kind: 'clearing', cutType: 'online', offsetSide: 0, isHole: false, isCompound: false, centers, sweep: sweeper(centers),
        rec: { ...pocket.rec, cutType: 'online', cutDepth: depth, cutOffset: 0 }, geom: { tag: 'path', a: `d="${pathD(c.points, c.closed)}"` },
        clearing: { role: c.role, index: c.index, count: c.count, level: c.level ?? null, pass, passes: depths.length, depth, ...(c.turnStarts ? { turnStarts: c.turnStarts } : {}) } });
    }
  });
  const D = rec.cutDepth;
  const wallCenters = plan.wall.map((pts) => ({ points: pts, closed: true }));
  out.push({ kind: 'loop', loop: pocket.outerLoop, loopId: pocket.outerLoop.id, polygon: pocket.outerPoly, cutType: 'interior', offsetSide: -1, isHole: false, isCompound: false,
    centers: wallCenters, sweep: sweeper(wallCenters), rec: { ...pocket.rec, cutType: 'interior', cutDepth: D }, clearing: { role: 'wall', pass: depths.length - 1, passes: depths.length, depth: D, summary } });
  (pocket.holeLoops || []).forEach((hl, i) => {
    const centers = (plan.islands[i] || []).map((pts) => ({ points: pts, closed: true }));
    out.push({ kind: 'loop', loop: hl, loopId: hl.id, polygon: (pocket.holePolys || [])[i], cutType: 'exterior', offsetSide: 1, isHole: true, isCompound: false,
      centers, sweep: sweeper(centers), rec: { ...pocket.rec, cutType: 'exterior', cutDepth: D }, clearing: { role: 'island', index: i + 1, count: pocket.holeLoops.length, pass: depths.length - 1, passes: depths.length, depth: D } });
  });
  return cuts.flatMap((c) => (c === pocket ? out : [c]));
}
