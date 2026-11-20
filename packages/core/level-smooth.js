// packages/core/level-smooth.js — TASK 809 (owner turns 2655, 2660-2661): SMOOTHING, a TOOLPATH setting of Roughing and Contour. PURE (no DOM).
// A relief's levels (#core/stl-slice.js: marching squares on a 0.1 mm height map, reduced by Douglas-Peucker) are many short straight segments with a
// slight stair-step. Each Roughing / Contour record has its own `smoothing` (a tolerance, base mm; LEVEL_SMOOTH.roughingMm / contourMm by default, 0 =
// off = the polylines as before): when the operation builds its paths from the levels (#core/stepped-cut.js levelsRoughing / levelsContour), each
// path's outline is FITTED with CUBIC BEZIERS (#core/curve-fit: Schneider's least squares and Newton steps), G1 where the outline is smooth, a CORNER
// kept where it turns by LEVEL_SMOOTH.cornerDeg or more within LEVEL_SMOOTH.cornerSpanMm either side. The LEVELS themselves are never changed (the
// record's `levels`, Prepare's height map and its outlines stay exact): each operation derives its own curves, once (memoised with its paths).
//
// THE RULES (tests/level-smooth-809-node.test.js):
//  * WITHIN THE TOLERANCE: a curve is accepted on a SAMPLED CHECK: sampled at a chord deviation of LEVEL_SMOOTH.checkShare of its fit tolerance, every
//    sample within the fit tolerance (LEVEL_SMOOTH.fitShare of the tolerance; the sampling slack counted in) of the outline it fits, every point of
//    that outline within it of the curve; else the piece is split at its worst point and fitted again (a two-point piece is the straight segment
//    itself, so a fit always ends). The fit is SYMMETRIC: the curve strays at most the tolerance to either side, so it never moves into the material
//    by more than the tolerance (not biased: a waste-side bias would halve the fitting budget; on the owner's rose at Roughing's 0.1 mm the segments
//    would drop 2.8 times instead of 11.6, and a cubic costs three times a straight segment in the file).
//  * NO TOUCHING, NESTING KEPT: the fitted rings of one region are COMBINED, not trusted: a region = its fitted outer MINUS its fitted holes, the
//    regions of a level = their UNION, and (Contour) a level's material = that INTERSECTED with the next deeper level's smoothed material, by Clipper
//    on the sampled curves (StrictlySimple: the result's rings never touch or cross) with every vertex traced back to the cubic and parameter it was
//    sampled from: each run of a result ring along one source curve is that curve's own piece (de Casteljau), the crossings between two curves a
//    straight segment of at most a sample's length. So two loops of a level never cross, a level's loops never cross the next level's (a shared
//    stretch is the SAME curve: they touch there, as the traced levels do), and a curve never crosses itself.
//  * FEATURES SMALLER THAN THE TOLERANCE MAY VANISH: a slot or a gap narrower than about the tolerance may close, an island or a hole smaller than it
//    may go.
//
//   smoothingOf(op, value)         -> the tolerance (base mm) of a Roughing / Contour record's `smoothing` (missing = the op's default; <= 0 = 0, off)
//   fitClosed(ring, tol)           -> SEGS: the closed outline [[x, y], ...] fitted within tol, [{ p0, c1, c2, p3 }] (cubics; { p0, p3, line: true } a line)
//   smoothRing(ring, tol)          -> a SMOOTHED RING (below) of the outline fitted at tol (0: the outline itself)
//   smoothRegions(regions, tol, { fit }) -> SMOOTHED REGIONS [{ outer, holes }] of Clipper regions (rings [[x, y], ...] closed); `fit(ring, isOuter)`
//                                    may hand back a SMOOTHED RING made before (a Contour level whose loop is the next level's)
//   intersectSmoothed(A, B, tol)   -> A ∩ B, SMOOTHED REGIONS (a run along B's curve is B's piece)
//   ringPathD(segs)                -> 'M x y C ... Z' (TASK 761's exported path numbers: #core/curve-kinds num; a line piece is `L`)
//   ringsTouch(A, B) / ringSelfTouch(A): two sampled closed rings [[x, y], ...] touch or cross / one touches itself (the tests' check)
// A SMOOTHED RING = { segs (SEGS), poly: [[x, y], ...] closed (sampled at CURVE_TOLERANCE_MM, as every bezier is wherever a polyline stands for it:
// footprints, the 3D Review, the Paths view), work: the samples the booleans use ({ pts, seg, t }: chord deviation LEVEL_SMOOTH.workShare of the
// tolerance, at most CURVE_TOLERANCE_MM), tol }.
import { bezier as bezAt, chordLengthParameterize, generateBezier, newtonRaphson } from './curve-fit.js';
import { bezierSteps, CURVE_TOLERANCE_MM, num } from './curve-kinds.js';
import { ClipperLib, CLIP_SCALE } from './plot/clip.js';

export const LEVEL_SMOOTH = Object.freeze({
  roughingMm: 0.1,      // Roughing's default tolerance (owner turn 2661)
  contourMm: 0.02,      // Contour's default tolerance (the finish)
  fitShare: 0.75,       // a curve is fitted within this share of the tolerance (the rest: the booleans' sampling and Clipper's 0.001 mm grid)
  checkShare: 0.1,      // the check samples a curve at a chord deviation of this share of its fit tolerance
  workShare: 0.2,       // the booleans sample the curves at a chord deviation of this share of the tolerance (at most CURVE_TOLERANCE_MM)
  cornerDeg: 60,        // a CORNER: the outline turns by this much or more over cornerSpanMm on each side of a point (and most there)
  cornerSpanMm: 0.25,   // 2.5 height-map cells: the stair-step of a traced outline is not a corner
  densifyMm: 0.5,       // a straight segment longer than this gets points every this much (the least squares need points along it)
  denoiseMm: 0.1,       // the cubics are fitted to the traced points averaged over this much arc length (a Gaussian sigma: one height-map cell)
  newtonPasses: 4,      // Newton-Raphson reparameterisations before a cubic is given up (Schneider)
});

/** The smoothing tolerance (base mm) of a Roughing ('roughing') / Contour ('contour') record whose `smoothing` is `value`: missing = the op's default,
 *  a number <= 0 (or not a number) = 0 (off); any other op: 0. */
export function smoothingOf(op, value) {
  if (op !== 'roughing' && op !== 'contour') return 0;
  if (value === undefined || value === null || value === '') return op === 'contour' ? LEVEL_SMOOTH.contourMm : LEVEL_SMOOTH.roughingMm;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// ── points ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const unit = (a) => { const l = Math.hypot(a.x, a.y); return l > 1e-15 ? { x: a.x / l, y: a.y / l } : { x: 1, y: 0 }; };
const neg = (a) => ({ x: -a.x, y: -a.y });
function segDist(p, a, b) {
  const vx = b.x - a.x, vy = b.y - a.y, L2 = vx * vx + vy * vy;
  let t = L2 > 0 ? ((p.x - a.x) * vx + (p.y - a.y) * vy) / L2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(p.x - a.x - t * vx, p.y - a.y - t * vy);
}
// a ring [[x, y], ...] (closed or not) -> [{x, y}] without its closing point or repeated points
function cleanRing(ring) {
  const out = [];
  for (const q of ring) { const p = { x: q[0], y: q[1] }, l = out[out.length - 1]; if (!l || Math.hypot(p.x - l.x, p.y - l.y) > 1e-9) out.push(p); }
  while (out.length > 1 && Math.hypot(out[0].x - out[out.length - 1].x, out[0].y - out[out.length - 1].y) <= 1e-9) out.pop();
  return out;
}
function densify(pts, step) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length], L = Math.hypot(b.x - a.x, b.y - a.y), k = Math.ceil(L / step);
    out.push(a);
    for (let j = 1; j < k; j++) out.push({ x: a.x + ((b.x - a.x) * j) / k, y: a.y + ((b.y - a.y) * j) / k, added: true }); // not a traced point
  }
  return out;
}
function arcLengths(Q) { const s = [0]; for (let i = 1; i < Q.length; i++) s.push(s[i - 1] + Math.hypot(Q[i].x - Q[i - 1].x, Q[i].y - Q[i - 1].y)); return s; }
function pointAt(Q, S, s) { // the point at arc length s along the open polyline Q (clamped)
  if (s <= 0) return Q[0];
  if (s >= S[S.length - 1]) return Q[Q.length - 1];
  let a = 0, b = S.length - 1;
  while (b - a > 1) { const m = (a + b) >> 1; if (S[m] <= s) a = m; else b = m; }
  const f = S[b] > S[a] ? (s - S[a]) / (S[b] - S[a]) : 0;
  return { x: Q[a].x + (Q[b].x - Q[a].x) * f, y: Q[a].y + (Q[b].y - Q[a].y) * f };
}

// ── the fit of one OPEN run ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Each cubic is Schneider's least squares (#core/curve-fit generateBezier, Newton reparameterisation) of a DENOISED copy of the run (the traced points
// averaged over LEVEL_SMOOTH.denoiseMm of arc length: the stair-step is not followed) with the end tangents given, and is accepted only on the sampled
// check against the TRACED points themselves. The run is covered GREEDILY: from where the last cubic ended, the longest stretch one cubic fits
// (doubling, then halving), G1 with the last; where no cubic covers three traced segments (a cubic costs three straight segments in the file), the
// traced segment itself (a straight piece: the traced outline is exact). Every accepted end point is within the fit tolerance of its traced point, so
// a straight piece from it is within it too.
// the sampled check of the cubic `bz` against Q[a..b] (u: one parameter per point) -> its error (the sampling slack included; it stops past ftol)
function checkFit(bz, Q, a, b, u, ftol) {
  for (let i = 1; i < u.length; i++) if (!(u[i] >= u[i - 1])) return Infinity; // a parameter running back: no fit
  let err = 0;
  for (let i = a; i <= b; i++) { const p = bezAt(bz, u[i - a]); const e = Math.hypot(p.x - Q[i].x, p.y - Q[i].y); if (e > err) { err = e; if (err > ftol) return err; } }
  const chord = ftol * LEVEL_SMOOTH.checkShare;
  const n = Math.max(8, Math.min(1024, bezierSteps(bz, chord)));
  const cx = bz[3].x - bz[0].x, cy = bz[3].y - bz[0].y;
  let j = 0;
  for (let k = 0; k <= n; k++) { // the curve always moves along its chord (no loop, no cusp, no turning back)
    const t = k / n, v = 1 - t;
    const dx = v * v * (bz[1].x - bz[0].x) + 2 * v * t * (bz[2].x - bz[1].x) + t * t * (bz[3].x - bz[2].x), dy = v * v * (bz[1].y - bz[0].y) + 2 * v * t * (bz[2].y - bz[1].y) + t * t * (bz[3].y - bz[2].y);
    if (!(dx * cx + dy * cy > 0)) return Infinity;
  }
  for (let k = 1; k < n; k++) { // every sample within ftol of the traced polyline (its segments about the sample's parameter: an upper bound of the distance)
    const t = k / n, p = bezAt(bz, t);
    while (j + 1 < u.length - 1 && u[j + 1] < t) j++;
    let d = Infinity;
    for (let q = Math.max(0, j - 1); q <= Math.min(u.length - 2, j + 1); q++) d = Math.min(d, segDist(p, Q[a + q], Q[a + q + 1]));
    if (d > err) { err = d; if (err + chord > ftol) return err + chord; }
  }
  return err + chord;
}
const lineSeg = (p0, p3) => ({ p0, p3, line: true });
// the run Q averaged over arc length (a Gaussian of sigma s, its weights renormalised near the ends; the two ends kept)
function denoise(Q, S, s) {
  if (!(s > 0) || Q.length < 3) return Q.slice();
  const out = [Q[0]], w2 = 2 * s * s;
  let lo = 0, hi = 0;
  for (let i = 1; i < Q.length - 1; i++) {
    while (S[i] - S[lo] > 2 * s) lo++;
    while (hi + 1 < Q.length && S[hi + 1] - S[i] <= 2 * s) hi++;
    let x = 0, y = 0, W = 0;
    for (let k = lo; k <= hi; k++) { const d = S[k] - S[i], w = Math.exp(-(d * d) / w2); x += w * Q[k].x; y += w * Q[k].y; W += w; }
    out.push({ x: x / W, y: y / W });
  }
  out.push(Q[Q.length - 1]);
  return out;
}
function fitRun(Q, tL, tR, ftol, out) {
  const last = Q.length - 1, S = arcLengths(Q), T = denoise(Q, S, Math.min(LEVEL_SMOOTH.denoiseMm, ftol)), span = LEVEL_SMOOTH.cornerSpanMm;
  const tangentAt = (m) => { // centred on T[m], inside the run
    const w = Math.min(span, S[m] / 2, (S[last] - S[m]) / 2);
    return w > 0 ? unit(sub(pointAt(T, S, S[m] + w), pointAt(T, S, S[m] - w))) : unit(sub(Q[Math.min(last, m + 1)], Q[Math.max(0, m - 1)]));
  };
  const traced = [0]; // traced points (not added by densify) up to each index
  for (let i = 1; i <= last; i++) traced.push(traced[i - 1] + (Q[i].added ? 0 : 1));
  let a = 0, cur = Q[0], l = tL;
  const tryFit = (b) => { // one cubic from cur to T[b] (Q[last] at the run's end) -> { bz, r } | null
    const r = b === last ? tR : neg(tangentAt(b));
    const pts = [cur, ...T.slice(a + 1, b), b === last ? Q[last] : T[b]];
    let u = chordLengthParameterize(pts), bz = generateBezier(pts, u, l, r), e = checkFit(bz, Q, a, b, u, ftol);
    for (let it = 0; it < LEVEL_SMOOTH.newtonPasses && e > ftol && e <= 4 * ftol; it++) {
      const u2 = u.map((ui, k) => Math.min(1, Math.max(0, newtonRaphson(bz, pts[k], ui))));
      u2[0] = 0; u2[u2.length - 1] = 1;
      const bz2 = generateBezier(pts, u2, l, r), e2 = checkFit(bz2, Q, a, b, u2, ftol);
      if (!(e2 < e)) break;
      u = u2; bz = bz2; e = e2;
    }
    return e <= ftol ? { bz, r } : null;
  };
  while (a < last) {
    if (last - a < 3) { // the run's last traced segments: one cubic to its end if it fits (G1 into the corner or the seam), else the segments themselves
      const f = tryFit(last);
      if (f) out.push({ p0: f.bz[0], c1: f.bz[1], c2: f.bz[2], p3: f.bz[3] });
      else for (let k = a + 1; k <= last; k++) { out.push(lineSeg(cur, Q[k])); cur = Q[k]; }
      break;
    }
    let best = null, bestB = -1, fail = -1;
    for (let step = 3; ; step *= 2) { // doubling
      const b = Math.min(last, a + step), f = tryFit(b);
      if (!f) { fail = b; break; }
      best = f; bestB = b;
      if (b === last) break;
    }
    if (best && fail > 0) { // halving between the longest that fits and the first that does not
      let lo = bestB, hi = fail;
      while (hi - lo > 1) { const m = (lo + hi) >> 1, f = tryFit(m); if (f) { lo = m; best = f; } else hi = m; }
      bestB = lo;
    }
    if (best && traced[bestB] - traced[a] >= 3) { out.push({ p0: best.bz[0], c1: best.bz[1], c2: best.bz[2], p3: best.bz[3] }); cur = best.bz[3]; l = neg(best.r); a = bestB; continue; } // a cubic (three numbers pairs) pays for three traced segments or more
    let nx = a + 1; // no cubic covers three traced segments here: the traced segment itself (to its next traced point, past the densifying ones)
    while (nx < last && Q[nx].added) nx++;
    out.push(lineSeg(cur, Q[nx])); cur = Q[nx]; a = nx; l = tangentAt(a);
  }
}

/** fitClosed(ring, tol) -> SEGS (header): the closed outline ring ([[x, y], ...]) within tol (the sampled check), corners kept, in order (the last
 *  ending at the first's start); null for fewer than 3 points. */
export function fitClosed(ring, tol) {
  const raw = cleanRing(ring);
  if (raw.length < 3 || !(tol > 0)) return null;
  const pts = densify(raw, Math.max(LEVEL_SMOOTH.densifyMm, 4 * tol)), n = pts.length;
  const ext = [...pts, ...pts, pts[0]], S = arcLengths(ext), L = S[n]; // the loop twice round: every window is a plain range of the middle copy
  const W = Math.min(LEVEL_SMOOTH.cornerSpanMm, L / 8);
  const at = (i, d) => pointAt(ext, S, S[i + n] + d);
  const turn = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const p = pts[i], d1 = unit(sub(p, at(i, -W))), d2 = unit(sub(at(i, W), p));
    turn[i] = Math.acos(Math.max(-1, Math.min(1, d1.x * d2.x + d1.y * d2.y)));
  }
  const lim = (LEVEL_SMOOTH.cornerDeg * Math.PI) / 180, corners = [];
  for (let i = 0; i < n; i++) {
    if (turn[i] < lim) continue;
    let most = true; // the most turning point within W either side (a tie: the first)
    for (let k = 1; most && k < n && S[i + n + k] - S[i + n] <= W; k++) if (turn[(i + k) % n] > turn[i]) most = false;
    for (let k = 1; most && k < n && S[i + n] - S[i + n - k] <= W; k++) if (turn[(i - k + n) % n] >= turn[i]) most = false;
    if (most) corners.push(i);
  }
  const segs = [];
  if (!corners.length) { // one smooth closed run from point 0, G1 where it closes
    const t = unit(sub(at(0, W), at(0, -W)));
    fitRun([...pts, pts[0]], t, neg(t), tol, segs);
  } else {
    for (let c = 0; c < corners.length; c++) {
      const i = corners[c], j = corners[(c + 1) % corners.length], run = [];
      for (let k = i; ; k = (k + 1) % n) { run.push(pts[k]); if (run.length > 1 && k === j) break; }
      const RS = arcLengths(run), w = Math.min(W, RS[RS.length - 1] / 3);
      fitRun(run, unit(sub(pointAt(run, RS, w), run[0])), unit(sub(pointAt(run, RS, RS[RS.length - 1] - w), run[run.length - 1])), tol, segs);
    }
  }
  const out = []; // straight pieces in line (a traced segment cut by the densifying points) are one
  for (const sg of segs) {
    const pv = out[out.length - 1];
    if (pv && pv.line && sg.line && Math.abs((pv.p3.x - pv.p0.x) * (sg.p3.y - pv.p0.y) - (pv.p3.y - pv.p0.y) * (sg.p3.x - pv.p0.x)) <= 1e-12 * Math.max(1, Math.hypot(sg.p3.x - pv.p0.x, sg.p3.y - pv.p0.y))
      && (pv.p3.x - pv.p0.x) * (sg.p3.x - sg.p0.x) + (pv.p3.y - pv.p0.y) * (sg.p3.y - sg.p0.y) > 0) { out[out.length - 1] = lineSeg(pv.p0, sg.p3); continue; }
    out.push(sg);
  }
  return out;
}

// ── SEGS: evaluate, split, sample, write ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const ptOf = (s, t) => (s.line ? lerp(s.p0, s.p3, t) : bezAt([s.p0, s.c1, s.c2, s.p3], t));
const stepsOf = (s, chord) => (s.line ? 1 : bezierSteps([s.p0, s.c1, s.c2, s.p3], chord));
// the piece of segment s between t0 < t1 (de Casteljau, twice)
function pieceOf(s, t0, t1) {
  if (t0 <= 0 && t1 >= 1) return s;
  if (s.line) return lineSeg(lerp(s.p0, s.p3, t0), lerp(s.p0, s.p3, t1));
  const split = (p0, c1, c2, p3, t) => { const a = lerp(p0, c1, t), b = lerp(c1, c2, t), c = lerp(c2, p3, t), d = lerp(a, b, t), e = lerp(b, c, t), f = lerp(d, e, t); return [[p0, a, d, f], [f, e, c, p3]]; };
  let q = [s.p0, s.c1, s.c2, s.p3];
  if (t1 < 1) q = split(...q, t1)[0];
  if (t0 > 0) q = split(...q, t0 / t1)[1];
  return { p0: q[0], c1: q[1], c2: q[2], p3: q[3] };
}
const reverseSeg = (s) => (s.line ? lineSeg(s.p3, s.p0) : { p0: s.p3, c1: s.c2, c2: s.c1, p3: s.p0 });
/** SEGS sampled at chord deviation `chord` -> [[x, y], ...] closed. */
export function sampleSegs(segs, chord = CURVE_TOLERANCE_MM) {
  const out = [];
  for (const s of segs) { const n = stepsOf(s, chord); for (let k = 0; k < n; k++) { const p = ptOf(s, k / n); out.push([p.x, p.y]); } }
  out.push([out[0][0], out[0][1]]);
  return out;
}
/** 'M x y C ... Z' of closed SEGS (TASK 761's path numbers; a line piece `L`). */
export function ringPathD(segs) {
  let d = `M ${num(segs[0].p0.x)} ${num(segs[0].p0.y)}`;
  for (const s of segs) d += s.line ? ` L ${num(s.p3.x)} ${num(s.p3.y)}` : ` C ${num(s.c1.x)} ${num(s.c1.y)} ${num(s.c2.x)} ${num(s.c2.y)} ${num(s.p3.x)} ${num(s.p3.y)}`;
  return d + ' Z';
}
const polySegs = (ring) => { const pts = cleanRing(ring); return pts.map((p, i) => lineSeg(p, pts[(i + 1) % pts.length])); };
// a SMOOTHED RING (header) of SEGS fitted at tol
const workChord = (tol) => Math.min(CURVE_TOLERANCE_MM, Math.max(1 / CLIP_SCALE, tol * LEVEL_SMOOTH.workShare));
function ringOfSegs(segs, tol) {
  const chord = workChord(tol);
  const pts = [], seg = [], t = [];
  segs.forEach((s, i) => { const n = stepsOf(s, chord); for (let k = 0; k < n; k++) { const p = ptOf(s, k / n); pts.push(p); seg.push(i); t.push(k / n); } });
  return ringOfWork(segs, { pts, seg, t }, tol);
}
// a SMOOTHED RING of SEGS and its polygon (work: its vertices on the curves, each with its segment and parameter)
const ringOfWork = (segs, work, tol) => ({ segs, poly: [...work.pts.map((p) => [p.x, p.y]), [work.pts[0].x, work.pts[0].y]], work, tol });
/** smoothRing(ring, tol) -> a SMOOTHED RING (header) of the outline ring ([[x, y], ...]) fitted within LEVEL_SMOOTH.fitShare x tol (tol 0: the
 *  outline itself, its straight segments), or null for fewer than 3 points. */
export function smoothRing(ring, tol) {
  const segs = tol > 0 ? fitClosed(ring, tol * LEVEL_SMOOTH.fitShare) : polySegs(ring);
  return segs && segs.length >= (tol > 0 ? 1 : 3) ? ringOfSegs(segs, tol) : null;
}

// ── the BOOLEANS on smoothed rings, each result vertex traced back to its curve ────────────────────────────────────────────────────────────────────
const KEY = (X, Y) => X * 4194304 + Y; // exact for |X|, |Y| < 2^21 (2 km at 0.001 mm)
function clipPath(ring, positive) {
  const path = ring.work.pts.map((p) => ({ X: Math.round(p.x * CLIP_SCALE), Y: Math.round(p.y * CLIP_SCALE) }));
  if (ClipperLib.Clipper.Orientation(path) !== positive) path.reverse();
  return path;
}
// a result ring (Clipper path) -> { segs, pts, seg, t }: SEGS where each run of vertices along one source ring's samples is that ring's own piece, the rest
// straight segments; pts = the vertices (the polygon Clipper made: the segs pass through every one), seg / t = the segment each starts or lies on.
// opts.prefer (a Set of source ring numbers) + opts.within(points): between two runs along the same PREFERRED ring (the same direction), what lies
// between (other curves' runs, crossings) is replaced by the preferred ring's own piece when every sample of that piece passes `within` (the traced
// outline's tolerance): a Contour level and the next deeper level weaving along the same wall take ONE curve there, the deeper's (shared: they touch).
function rebuild(path, src, rings, opts) {
  const n = path.length;
  const at = path.map((v) => src.get(KEY(v.X, v.Y)) || null); // { r, q } | null (a crossing Clipper made)
  const step = (a, b) => { // +1 / -1 when b is the sample after / before a on the same ring, else 0
    if (!a || !b || a.r !== b.r) return 0;
    const Q = rings[a.r].work.pts.length, d = (b.q - a.q + Q) % Q;
    return d === 1 ? 1 : d === Q - 1 ? -1 : 0;
  };
  // start at a vertex where a run begins (else the whole ring is one run of one source, followed round)
  let s0 = -1;
  for (let i = 0; i < n && s0 < 0; i++) { const p = (i - 1 + n) % n, pp = (i - 2 + n) % n; const d = step(at[p], at[i]); if (!d || d !== step(at[pp], at[p])) s0 = i; }
  if (s0 < 0) { // one source ring, all of it
    const r = rings[at[0].r], w = step(at[0], at[1]) > 0 ? r : reverseRing(r);
    return { segs: w.segs, pts: w.work.pts, seg: w.work.seg, t: w.work.t };
  }
  const items = []; // round the ring from s0: runs { r, qa, qb, dir } and lone points { p }
  for (let k = 0; k < n;) {
    const i = (s0 + k) % n, a = at[i];
    let j = k, dir = 0;
    if (a) { dir = step(a, at[(s0 + k + 1) % n]); if (dir) while (j + 1 < n && step(at[(s0 + j) % n], at[(s0 + j + 1) % n]) === dir) j++; }
    items.push(dir && j > k ? { r: a.r, qa: a.q, qb: at[(s0 + j) % n].q, dir } : { p: a ? rings[a.r].work.pts[a.q] : { x: path[i].X / CLIP_SCALE, y: path[i].Y / CLIP_SCALE } });
    k = j + 1;
  }
  if (opts && opts.prefer) mergeRuns(items, rings, opts);
  // emit: the SEGS, and the ring's polygon = its vertices in order (each run's source samples, each lone point), each with the segment it starts or
  // lies on and its parameter there (so this ring can be a source of the next boolean in turn)
  const startOf = (it) => (it.p ? it.p : rings[it.r].work.pts[it.qa]);
  const segs = [], pts = [], seg = [], t = [];
  let cur = null; // the end point of what is built so far (not yet a vertex)
  const lineTo = (p) => { if (cur && Math.hypot(p.x - cur.x, p.y - cur.y) > 1e-9) { pts.push(cur); seg.push(segs.length); t.push(0); segs.push(lineSeg(cur, p)); } cur = p; };
  const spike = 3 / CLIP_SCALE;
  for (let k = 0; k < items.length; k++) {
    const it = items[k];
    if (it.p && cur) { // a lone point (a crossing on Clipper's 0.001 mm grid) that only turns the way back over a grid step or two: a spike, dropped
      const nx = startOf(items[(k + 1) % items.length]), ux = it.p.x - cur.x, uy = it.p.y - cur.y, vx = nx.x - it.p.x, vy = nx.y - it.p.y;
      if (ux * vx + uy * vy < 0 && Math.min(Math.hypot(ux, uy), Math.hypot(vx, vy)) < spike) continue;
    }
    lineTo(startOf(it));
    if (it.p) continue;
    const { pieces, map } = curvePiece(rings[it.r], it.qa, it.qb, it.dir);
    for (const m of map) { pts.push(m.p); seg.push(segs.length + m.k); t.push(m.t); }
    segs.push(...pieces);
    cur = rings[it.r].work.pts[it.qb];
  }
  lineTo(startOf(items[0])); // back to the start
  return { segs, pts, seg, t };
}
// a SMOOTHED RING walked the other way
function reverseRing(ring) {
  const N = ring.segs.length, { pts, seg, t } = ring.work, Q = pts.length;
  const out = { pts: [], seg: [], t: [] };
  for (let k = 0; k < Q; k++) {
    const q = (Q - k) % Q, s = seg[q], u = t[q];
    out.pts.push(pts[q]);
    if (u > 0) { out.seg.push(N - 1 - s); out.t.push(1 - u); } else { out.seg.push((N - s) % N); out.t.push(0); }
  }
  return { segs: ring.segs.slice().reverse().map(reverseSeg), work: out };
}
// mergeRuns (rebuild's opts): a preferred run and the next preferred run of the same ring and direction joined along that ring, when its piece
// between them is forward of the first, no longer than twice what it replaces (+ 1 mm: it is a detour of the same wall, not the way round), and
// passes `within`
function mergeRuns(items, rings, { prefer, within }) {
  const len = (pts) => { let L = 0; for (let k = 1; k < pts.length; k++) L += Math.hypot(pts[k].x - pts[k - 1].x, pts[k].y - pts[k - 1].y); return L; };
  for (let i = 0; i < items.length; i++) {
    const A = items[i];
    if (A.p || !prefer.has(A.r)) continue;
    for (;;) {
      let j = i + 1;
      while (j < items.length && (items[j].p || !prefer.has(items[j].r))) j++;
      if (j >= items.length) break;
      const B = items[j];
      if (B.r !== A.r || B.dir !== A.dir) break;
      const W = rings[A.r].work.pts, Q = W.length, gap = (((B.qa - A.qb) * A.dir) % Q + Q) % Q;
      if (!gap) break;
      const piece = [];
      for (let k = 0; k <= gap; k++) piece.push(W[(((A.qb + A.dir * k) % Q) + Q) % Q]);
      const replaced = [W[A.qb]];
      for (let k = i + 1; k < j; k++) { const it = items[k]; if (it.p) replaced.push(it.p); else replaced.push(rings[it.r].work.pts[it.qa], rings[it.r].work.pts[it.qb]); }
      replaced.push(W[B.qa]);
      if (len(piece) > 2 * len(replaced) + 1 || !piece.every(within)) break;
      A.qb = B.qb;
      items.splice(i + 1, j - i);
    }
  }
}
// the source ring's curve from its sample qa to qb, forward (dir 1) or backward (-1): { pieces (SEGS), map: one { p, k (piece), t } per sample from qa
// up to qb (qb itself not: it ends the last piece) }
function curvePiece(ring, qa, qb, dir) {
  const { pts, seg, t } = ring.work, segs = ring.segs, N = segs.length, Q = pts.length;
  const from = dir > 0 ? qa : qb, to = dir > 0 ? qb : qa; // the forward walk from `from` to `to`
  const ranges = []; // [segment, t0, t1] in forward order
  let sa = seg[from], ta = t[from];
  const sb = seg[to], tb = t[to];
  for (let guard = 0; guard <= N; guard++) {
    if (sa === sb && ta <= tb) { if (tb > ta) ranges.push([sa, ta, tb]); break; }
    if (ta < 1) ranges.push([sa, ta, 1]);
    sa = (sa + 1) % N; ta = 0;
  }
  const fwd = []; // the forward position of each sample from `from` up to `to` (exclusive): [range index, t within it]
  let k = 0;
  for (let q = from; q !== to; q = (q + 1) % Q) {
    while (k < ranges.length - 1 && (seg[q] !== ranges[k][0] || t[q] >= ranges[k][2])) k++;
    const [, t0, t1] = ranges[k];
    fwd.push({ q, k, t: (t[q] - t0) / (t1 - t0) });
  }
  const pieces = ranges.map(([s, t0, t1]) => pieceOf(segs[s], t0, t1));
  if (dir > 0) return { pieces, map: fwd.map((f) => ({ p: pts[f.q], k: f.k, t: f.t })) };
  // backward: the pieces reversed; the samples from qa back to qb (exclusive) = the forward ones after `from`, in reverse, plus none for qb (= from)
  const m = pieces.length, map = [{ p: pts[qa], k: 0, t: 0 }];
  for (let i = fwd.length - 1; i >= 1; i--) { const f = fwd[i]; map.push(f.t > 0 ? { p: pts[f.q], k: m - 1 - f.k, t: 1 - f.t } : { p: pts[f.q], k: m - f.k, t: 0 }); }
  return { pieces: pieces.reverse().map(reverseSeg), map };
}
function regionsOf(tree, src, rings, tol, opts) {
  const out = [];
  const tiny = tol * tol; // a ring enclosing less than tol² (a crossing's sliver; a feature smaller than the tolerance) is dropped
  const make = (contour) => {
    if (Math.abs(ClipperLib.Clipper.Area(contour)) < tiny * CLIP_SCALE * CLIP_SCALE) return null;
    const r = rebuild(contour, src, rings, opts);
    return r.segs.length ? ringOfWork(r.segs, { pts: r.pts, seg: r.seg, t: r.t }, tol) : null;
  };
  const walk = (node) => {
    const outer = make(node.Contour());
    const holes = node.Childs().map((h) => make(h.Contour())).filter(Boolean);
    if (outer) out.push({ outer, holes });
    for (const h of node.Childs()) for (const inner of h.Childs()) walk(inner);
  };
  for (const top of tree.Childs()) walk(top);
  return out;
}
// Clipper `type` on the subject regions' rings and the clip regions' rings (NonZero, outer positive / holes negative; StrictlySimple when the result
// touches at a vertex). within: see rebuild (the clip rings preferred).
function combine(type, subj, clip, tol, within = null) {
  const rings = [], src = new Map();
  const add = (ring, positive) => {
    const r = rings.length; rings.push(ring);
    ring.work.pts.forEach((p, q) => { const k = KEY(Math.round(p.x * CLIP_SCALE), Math.round(p.y * CLIP_SCALE)); if (!src.has(k)) src.set(k, { r, q }); });
    return clipPath(ring, positive);
  };
  const paths = (regions) => regions.flatMap((g) => [add(g.outer, true), ...g.holes.map((h) => add(h, false))]);
  const sp = paths(subj), firstClip = rings.length, cp = paths(clip);
  if (!sp.length) return [];
  const run = (options) => {
    const c = new ClipperLib.Clipper(options), tree = new ClipperLib.PolyTree();
    c.AddPaths(sp, ClipperLib.PolyType.ptSubject, true);
    if (cp.length) c.AddPaths(cp, ClipperLib.PolyType.ptClip, true);
    c.Execute(type, tree, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
    return tree;
  };
  let tree = run(ClipperLib.Clipper.ioPreserveCollinear);
  if (touchingVertices(tree)) tree = run(ClipperLib.Clipper.ioPreserveCollinear | ClipperLib.Clipper.ioStrictlySimple); // rings that touch at a vertex: split them (StrictlySimple is slow: only then)
  const opts = within ? { prefer: new Set(rings.map((r, i) => i).filter((i) => i >= firstClip)), within } : null;
  return regionsOf(tree, src, rings, tol, opts);
}
// a result's rings share a vertex (one ring passing a point twice, or two rings meeting there): Clipper's non-strict output can touch only so
function touchingVertices(tree) {
  const seen = new Set();
  const walk = (node) => { for (const ch of node.Childs()) { for (const v of ch.Contour()) { const k = KEY(v.X, v.Y); if (seen.has(k)) return true; seen.add(k); } if (walk(ch)) return true; } return false; };
  return walk(tree);
}
// (p) => p is within d of an edge of the rings ([[x, y], ...] closed): a grid of the edges, each in every cell its box grown by d touches
function nearChecker(rings, d) {
  let L = 0, m = 0, x0 = Infinity, y0 = Infinity;
  for (const R of rings) for (let k = 0; k + 1 < R.length; k++) { L += Math.hypot(R[k + 1][0] - R[k][0], R[k + 1][1] - R[k][1]); m++; x0 = Math.min(x0, R[k][0]); y0 = Math.min(y0, R[k][1]); }
  const h = Math.max(2 * d, m ? L / m : 1), cells = new Map(), key = (i, j) => i * 1048576 + j;
  for (const R of rings) for (let k = 0; k + 1 < R.length; k++) {
    const a = R[k], b = R[k + 1];
    for (let i = Math.floor((Math.min(a[0], b[0]) - d - x0) / h); i <= Math.floor((Math.max(a[0], b[0]) + d - x0) / h); i++) {
      for (let j = Math.floor((Math.min(a[1], b[1]) - d - y0) / h); j <= Math.floor((Math.max(a[1], b[1]) + d - y0) / h); j++) { const kk = key(i, j); let l = cells.get(kk); if (!l) cells.set(kk, (l = [])); l.push([a, b]); }
    }
  }
  return (p) => {
    const l = cells.get(key(Math.floor((p.x - x0) / h), Math.floor((p.y - y0) / h)));
    if (l) for (const [a, b] of l) if (segDist(p, { x: a[0], y: a[1] }, { x: b[0], y: b[1] }) <= d) return true;
    return false;
  };
}

/**
 * smoothRegions(regions, tol, { fit }) -> SMOOTHED REGIONS (header): each region's outer and holes fitted (`fit(ring, isOuter)`, smoothRing at tol
 * by default: a caller may hand back a ring fitted before), each region = its fitted outer minus its fitted holes, the result the UNION of them all
 * (always through Clipper: a fitted ring that crosses itself or another is resolved there). tol <= 0: the regions' own rings as straight segments.
 */
export function smoothRegions(regions, tol, { fit = null } = {}) {
  if (!(tol > 0)) return regions.map((g) => ({ outer: smoothRing(g.outer, 0), holes: g.holes.map((h) => smoothRing(h, 0)).filter(Boolean) })).filter((g) => g.outer);
  const fitOne = fit || ((ring) => smoothRing(ring, tol));
  const parts = [];
  for (const g of regions) {
    const outer = fitOne(g.outer, true);
    if (!outer) continue;
    const holes = g.holes.map((h) => fitOne(h, false)).filter(Boolean);
    parts.push(...(holes.length ? combine(ClipperLib.ClipType.ctDifference, [{ outer, holes: [] }], holes.map((h) => ({ outer: h, holes: [] })), tol) : [{ outer, holes: [] }]));
  }
  return parts.length ? combine(ClipperLib.ClipType.ctUnion, parts, [], tol) : [];
}
/** intersectSmoothed(A, B, tol, traced) -> A ∩ B (SMOOTHED REGIONS): where A's curves leave B, B's own curve pieces; and where A and B weave along
 *  the same wall, B's curve all along it when that stays within the tolerance of `traced` (the regions A was fitted to: Clipper's ring form). */
export function intersectSmoothed(A, B, tol, traced = null) {
  if (!A.length || !B.length) return [];
  const within = traced ? nearChecker(traced.flatMap((g) => [g.outer, ...g.holes]), tol - workChord(tol)) : null;
  return combine(ClipperLib.ClipType.ctIntersection, A, B, tol, within);
}

// ── touching / crossing of sampled rings (the tests' check; a grid of segment boxes) ──────────────────────────────────────────────────────────────
const orient = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const onSeg = (a, b, c) => Math.min(a[0], b[0]) <= c[0] && c[0] <= Math.max(a[0], b[0]) && Math.min(a[1], b[1]) <= c[1] && c[1] <= Math.max(a[1], b[1]);
function segsMeet(a, b, c, d) { // the closed segments ab and cd share a point
  const o1 = orient(a, b, c), o2 = orient(a, b, d), o3 = orient(c, d, a), o4 = orient(c, d, b);
  if (((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) && ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0))) return true;
  return (o1 === 0 && onSeg(a, b, c)) || (o2 === 0 && onSeg(a, b, d)) || (o3 === 0 && onSeg(c, d, a)) || (o4 === 0 && onSeg(c, d, b));
}
function segsCross(a, b, c, d) { // they cross properly (each strictly separates the other's ends)
  const o1 = orient(a, b, c), o2 = orient(a, b, d), o3 = orient(c, d, a), o4 = orient(c, d, b);
  return ((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) && ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0));
}
const boxOf = (R) => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const q of R) { if (q[0] < x0) x0 = q[0]; if (q[0] > x1) x1 = q[0]; if (q[1] < y0) y0 = q[1]; if (q[1] > y1) y1 = q[1]; } return [x0, y0, x1, y1]; };
const cellFor = (R) => { let L = 0; for (let k = 0; k + 1 < R.length; k++) L += Math.hypot(R[k + 1][0] - R[k][0], R[k + 1][1] - R[k][1]); return Math.max(1e-3, (2 * L) / Math.max(1, R.length - 1)); };
function gridOf(R, bx, cell) {
  const g = new Map();
  for (let k = 0; k + 1 < R.length; k++) {
    const a = R[k], b = R[k + 1];
    const i0 = Math.floor((Math.min(a[0], b[0]) - bx[0]) / cell), i1 = Math.floor((Math.max(a[0], b[0]) - bx[0]) / cell);
    const j0 = Math.floor((Math.min(a[1], b[1]) - bx[1]) / cell), j1 = Math.floor((Math.max(a[1], b[1]) - bx[1]) / cell);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const kk = i * 1048576 + j; let l = g.get(kk); if (!l) g.set(kk, (l = [])); l.push(k); }
  }
  return g;
}
function pairsOf(A, B, test) {
  const bA = boxOf(A), bB = boxOf(B);
  if (bA[0] > bB[2] || bB[0] > bA[2] || bA[1] > bB[3] || bB[1] > bA[3]) return false;
  const bx = [Math.min(bA[0], bB[0]), Math.min(bA[1], bB[1])], cell = Math.max(cellFor(A), cellFor(B)), g = gridOf(A, bx, cell);
  for (let k = 0; k + 1 < B.length; k++) {
    const c = B[k], d = B[k + 1];
    const i0 = Math.floor((Math.min(c[0], d[0]) - bx[0]) / cell), i1 = Math.floor((Math.max(c[0], d[0]) - bx[0]) / cell);
    const j0 = Math.floor((Math.min(c[1], d[1]) - bx[1]) / cell), j1 = Math.floor((Math.max(c[1], d[1]) - bx[1]) / cell);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const l = g.get(i * 1048576 + j); if (l) for (const s of l) if (test(A[s], A[s + 1], c, d)) return true; }
  }
  return false;
}
/** Two closed sampled rings ([[x, y], ...]) touch or cross (share any point). */
export const ringsTouch = (A, B) => pairsOf(A, B, segsMeet);
/** Two closed sampled rings CROSS (a proper crossing of two of their segments: touching or running together is not one). */
export const ringsCross = (A, B) => pairsOf(A, B, segsCross);
/** A closed sampled ring touches or crosses itself (two segments that are not neighbours share a point). */
export function ringSelfTouch(A) {
  const n = A.length - 1;
  if (n < 4) return false;
  const g = gridOf(A, boxOf(A), cellFor(A));
  for (const l of g.values()) {
    for (let x = 0; x < l.length; x++) for (let y = x + 1; y < l.length; y++) {
      const s = Math.min(l[x], l[y]), t = Math.max(l[x], l[y]);
      if (s === t || t - s === 1 || (s === 0 && t === n - 1)) continue;
      if (segsMeet(A[s], A[s + 1], A[t], A[t + 1])) return true;
    }
  }
  return false;
}
