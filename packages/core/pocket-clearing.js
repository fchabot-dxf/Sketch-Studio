// packages/core/pocket-clearing.js — TASK 745: the PROGRAMMED POCKET. A plain Pocket record whose `clearing` is 'linked' | 'raster' | 'morphed' is cut
// as the toolpath the app computes (the Origin follows it as plain cuts), not as one pocket element the Origin clears by hand ('freehand', the default:
// byte-identical to before). PURE (no DOM). A derivation of the cut RECORD and the pocket's loops (never of the sketch): #core/stepped-cut
// deriveCuts (THE cut derivation of the export, the Prepare look and the 3D Review) passes every plain record's cuts through applyPocketClearing, so
// the downloaded file, Prepare and Review are one result. ONE derivation with a pattern parameter (planClearing).
// TASK 749: the record values are 'freehand' | 'linked' (shown "Spiral") | 'raster' | 'morphed' (shown "Morphed spiral"). 745's separate closed rings
// ("Concentric") are gone: the SAME rings, joined, are the Spiral. A document saved before 749 is mapped once, on read (apps/shaper/src/shaper-doc.js).
// TASK 750: the LOOP toggle (record field `loop`, any programmed pattern, default off) and NO step-downs in the app: every programmed clearing is written ONCE at
// the record's full cut depth (the Origin's own Pass Depth / AutoPass makes the step-downs; a stored per-pass depth (745) is dropped on read, shaper-doc.js).
//
// THE RULES (lengths base mm; r = the record's bit radius, s = the stepover = stepover % x the bit diameter, a = the finish allowance, R = the pocket
// region (its outer loop minus its islands) moved by the record's own offset (positive = away from the wall, as a pocket's offset)):
//  * CLEARING (the pattern), every path an ON-LINE cut (the bit's centre runs on it) at the full cut depth, inside the INSET region A0 = R offset inward
//    by r + a (its islands grow by the same: they are respected):
//     - THE RINGS (the Spiral's, and Raster's clean-up ring is ring 0): ring k = the contours of R offset inward by r + a + k * s (round joins, each
//       straight from R, never an offset of an offset), k = 0, 1, ... until nothing is left; a region that splits gives several loops for one ring;
//       the contours round an island are rings too.
//     - Spiral (TASK 749, 'linked'): the rings traversed INSIDE OUT, JOINED into open paths ("lines"): a line goes once fully round a ring, from the
//       point where it arrived back to that point, then a straight LINK to the next ring out, and so on; it ends with a full ring (the outermost of its
//       chain: for a pocket that does not split, ring 0, so no separate clean-up ring). THE LINK: from the end of ring k + 1 (the point P where it
//       started) straight to the NEAREST point Q of the rings of level k. Why it is safe and short: every point of ring k + 1 is r + a + (k + 1) s
//       from R's edge, so the disc of radius s round P lies in the region of ring k (R inset by r + a + k s), and the point s along P's own shortest
//       way to R's edge is ON ring k: |PQ| = s exactly, and the segment PQ lies in that disc, inside the ring-k region, so inside A0 (it never crosses
//       the wall or an island, it never leaves the area P is in). Measured on polygons (the offsets' 0.005 mm arc tolerance, 0.001 mm grid): the
//       bound guaranteed and tested is |PQ| <= s + 0.02 mm. Every ring is still cut whole (each ring's full loop is a stretch of its line), so the
//       swept area, the coverage and the leftover are those of the rings themselves.
//       SPLITS AND ISLANDS: rings form a tree, not a chain. The rings of the deepest level each start a line (at the middle of the ring's longest
//       edge: a link leaves along the normal, never from a rounded corner); going out, every line ending on a ring of level k + 1 links to its nearest
//       point on level k. A ring of level k that no line reaches starts a NEW line; a ring that several lines reach is continued by ONE of them (the
//       one with the most rings so far; a tie: the first found) and every other one ENDS at its own ring (it was cut whole: TASK 804: so the lines are
//       the CHAINS of ringChains, one per area, the shared rings in the line of the area with the most rings). ORDER: the lines in the
//       order they end, deepest first (inside out). The note says how many lines and why ("the pocket narrows" / "the pocket has islands"). Never
//       refused (a pocket the bit fits always has rings).
//     - Raster: straight passes one stepover apart at the Raster angle (degrees, counterclockwise ON SCREEN from the sketch's X axis: 0 = left /
//       right, 90 = up / down; an absolute angle, so the card says what the file has), centred across A0 (the outer margins between s / 2 and s),
//       clipped to A0 (an island cuts a pass into pieces). Kept as SEPARATE open paths in ZIGZAG order (pass k + 1 runs back the way pass k
//       came). Not joined into one path: a straight link between two pass ends can leave A0 on a curved or concave edge (it would cut the wall),
//       passes split by an island belong to different areas, and on the Origin every path is picked, plunged and followed one at a time anyway.
//       Then ONE clean-up ring = the contours of A0 (ring 0 of THE RINGS, as CAM does), which removes the scalloped pass ends.
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
//       TASK 804, PER AREA: where the rings SPLIT (a neck) the ring tree is cut into SEGMENTS (ringSegments: the shared rings before a split are one,
//       each branch another) and each segment is its own morphed spiral (the morphed turn of a ring whose next ring out has another area's lobe would
//       run over that area's rings); cut in the segments' order (the deepest first: the branches, then the shared rings out to the wall). A morphed
//       turn never walks back over itself (where both rings hold an arc at one phi, the inner arc first, then the outer: see transition).
//       NOT POSSIBLE (the option is refused with its reason, no silent fallback): a pocket with islands (an area round an island has no middle to
//       spiral from), or an area whose morphed turns would cross each other (THE HARD RULE, checked with #core/path-crossings: a long thin last ring,
//       e.g. the blob of tests/helpers/pocket-shapes-804.js or the L with no allowance).
//  * FINISH PASS (Loop off), last: the pocket's own outer loop as the Origin's INSIDE cut (the wall is exact with whatever bit is in the machine; the
//    record's offset is its cutOffset), and each island's loop as an OUTSIDE cut. Refused (the pocket is cut Freehand and the note says why) when that
//    pass would cut an island or the wall (an island closer to the wall or to another island than the bit). The same check holds with Loop on.
//  * LOOP (TASK 750, record field `loop`: true | false, default off, any programmed pattern): everything the record cuts (its clearing (TASK 804b: Raster
//    without its clean-up ring), AND the FINISH TURNS = the contours of R inset by EXACTLY r: a clean copy of the wall's shape, taking only the allowance skin, and each
//    island's turn at r outside it) is joined into CLOSED on-line paths (first point == last point, d ends with Z); no separate inside / outside cut
//    is written (TASK 787: with nothing to clear inside the allowance, any pattern's loops are the finish turns alone). A closed loop has NO start point on the Origin (the operator plunges anywhere) and AutoPass cuts it the same direction every pass. The wall is then exact for the card's bit only (the Origin does not offset an on-line path): the note
//    says so. With no allowance ring 0 already IS the finish turn (not written twice). Every link and return leg is a chain of straight steps between
//    points of turns that are cut anyway, each step inside the region of the outer of its two turns (the 749 nearest-point argument), so inside the
//    region the bit may sweep (R inset by r): it never crosses the wall or an island. Such a leg crosses the turns between its ends: harmless for an
//    on-line cut; the plan counts the crossings (loopCrossings) and the added length (loopExtra = the loop's length minus its turns' and passes'):
//     - Spiral: the 749 lines with the finish level added outside ring 0 (each line's anchors = where its rings start: one straight chain of
//       nearest points). Per line, its rings outer -> inner X0 (its last turn: the finish turn if the line reaches it), X1 .. Xn: start at X1's anchor,
//       IN on X1, X3, X5, ..., then OUT on the rings between (..., X4, X2), then X0, then close X0 -> X1 (one step). A step from Xi to Xj runs through
//       the anchors between (|i - j| - 1 crossings). One closed loop per line (749's chain rule: an island's finish turn is in the line that reaches it;
//       a turn no line reaches is a loop of its own).
//     - Raster (TASK 804b, owner design 2595: ZERO crossings): per area of A0 ONE closed path: the passes in their zigzag order (row by row) joined by
//       links ALONG the area's contour (the shorter way, from the pass's own end; a straight link only where two pass ends lie on different contours
//       and the segment is inside A0), then from the last pass's end a step of the allowance out to the WALL RING (the finish turn round the region
//       of R inset by r the area lies in), the wall ring WHOLE (started away from the first pass's start, so it comes back from that side), back along
//       it (the shorter arc, cut twice) to the first pass's start, and the step in: the wall ring lies outside every pass and link, so nothing crosses;
//       the finish turn IS the return. No clean-up ring: the wall ring's sweep (2 r from the wall) covers the passes' scallops (the leftover is Loop
//       off's for an allowance up to r). ISLANDS: each island's ring is a BALLOON on the path: from a point one allowance from it (a pass's end
//       first: the first, in the path's order, where nothing crosses) a step out, the ring whole (started back the way the path came), the same step
//       back; a link along the island's contour passing that point would cross, so a point no other link passes is found (on a rectangle's island:
//       the row where the links switch from under the island to over it). A wall ring another area already cut whole: that area's path only walks
//       its arc; a ring no area reaches: a loop of its own. Every candidate is checked with THE crossing check (#core/path-crossings); where none is
//       crossing-free (some concave shapes at some Raster angles: the zigzag's links along the contour interleave) the Loop is REFUSED ('loop
//       cross': cut as open paths + the separate wall; the note says so), never cut crossing. Where two pieces cannot be joined inside A0 (no common
//       contour, no inside segment) the Loop is REFUSED ('raster join').
//     - Morphed spiral: the spiral as it is (the gap between neighbouring turns stays the stepover), then the finish turn (a step of the allowance out
//       from where the closing turn ends and back), then the RETURN leg straight down the chain of turn starts (each step one stepover, along the chain
//       of nearest points every turn starts on) to the first point. Chosen over two interleaved arms at twice the pitch: the spiral's geometry is
//       unchanged (Loop off and on cut the same turns), the return leg is short (about the pocket's inset half-width) and crosses each turn once.
//  * LEFTOVER (never hidden): the part of R the bit does not sweep (the swept area of every clearing path at the record's bit radius + the finish
//    pass), ignoring slivers thinner than 2 x sliverMm (the offsets' rounding); reported when over leftoverTolMm2, with how much of it the bit cannot
//    reach at all (sharp inside corners, necks narrower than the bit: R minus R opened by r) and how much the pattern missed (a stepover too big).
//  * START MARK (TASK 778): every programmed pocket (Spiral, Raster,
//    Morphed; Loop on AND off) returns `startPoint` = the first point the bit cuts in the clearing route (Spiral / Morphed: the middle of the innermost
//    ring's longest edge; Raster: the start of the first pass; always ON the route, never on an island; Loop off: the route's start end). Written into
//    the exported SVG as a GUIDE (circle + cross, startMarkDiaMult x bit diameter across, never cut) and drawn in Prepare / Export 2D / Export 3D from
//    the same derivation.
//  * The clearing paths depend on the record's bit diameter (written as toolDia on every path); the finish pass does not.
import { offsetRegions, sweepPaths, clipOpenPaths, regionsArea, regionsFromRings, diffRegions, unionRegions } from './plot/clip.js';
import { loopWalk, walkPoints, sweeper } from './hold-part.js'; // TASK 775: sweeper moved to hold-part (an On line cut's strokes use it too)
import { num } from './loop-geometry.js';
import { pathCrossings } from './path-crossings.js'; // TASK 804: THE crossing check (the hard rule)

export const POCKET_CLEARING = Object.freeze({
  /** the record field `clearing`: Freehand (the Origin clears it: the default) | the patterns the app computes */
  patterns: Object.freeze([
    Object.freeze({ id: 'freehand', label: 'Freehand' }),
    Object.freeze({ id: 'linked', label: 'Spiral' }), // TASK 749: the rings joined into lines
    Object.freeze({ id: 'raster', label: 'Raster' }),
    Object.freeze({ id: 'morphed', label: 'Morphed spiral' }),
  ]),
  /** TASK 804: the Loop's cutting-arm PITCH, a multiple of the stepover (record field `loopPitch`): 1 = every ring cut on the way out, the return
   *  arm in the middle of the cut band (air); 2 = the classic Fermat (both arms cut, each every other ring); between: a blend */
  loopPitch: Object.freeze({ default: 1, min: 1, max: 2 }),
  /** stepover, % of the bit diameter (record field `stepover`) */
  stepoverPct: Object.freeze({ default: 40, min: 1, max: 100 }),
  /** finish allowance left for the finish pass, base mm by document unit family (record field `finishAllowance`): 0.5 mm / 0.02 in */
  finishAllowance: Object.freeze({ mm: 0.5, in: 0.508 }),
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
  /** TASK 778: pocket start mark target (circle + cross) total span = startMarkDiaMult x bit diameter; circle diameter = startMarkCircleRatio of that */
  startMarkDiaMult: 2,
  startMarkCircleRatio: 0.6,
});
const PATTERNS = new Set(['linked', 'raster', 'morphed']);
const FINISH_TOL_MM2 = 0.05; // the finish pass may not sweep more than this outside the pocket region (else it cuts an island or the wall)

/** TASK 778: the pocket start mark's SVG path `d` (circle + cross, declared once) centred on `pt` for a bit of diameter `toolDia`. */
export function startMarkPathD(pt, toolDia) {
  const arm = (toolDia * POCKET_CLEARING.startMarkDiaMult) / 2;
  const cr = arm * POCKET_CLEARING.startMarkCircleRatio;
  const { x, y } = pt;
  return `M ${num(x - cr)} ${num(y)} A ${num(cr)} ${num(cr)} 0 1 0 ${num(x + cr)} ${num(y)} A ${num(cr)} ${num(cr)} 0 1 0 ${num(x - cr)} ${num(y)} Z M ${num(x - arm)} ${num(y)} L ${num(x + arm)} ${num(y)} M ${num(x)} ${num(y - arm)} L ${num(x)} ${num(y + arm)}`;
}

/** The clearing a record is cut with: 'freehand' | 'linked' | 'raster' | 'morphed' (only a plain Pocket programs its clearing). */
export function clearingPattern(rec) {
  if (!rec || rec.terraceAs || rec.cutType !== 'pocket') return 'freehand';
  return PATTERNS.has(rec.clearing) ? rec.clearing : 'freehand';
}
/** The finish allowance default (base mm) for a document unit. */
export const allowanceDefault = (unit) => (unit === 'in' ? POCKET_CLEARING.finishAllowance.in : POCKET_CLEARING.finishAllowance.mm);

/** A record's clearing settings: { pattern, toolDia, r, stepoverPct, stepover (mm), allowance, offset, angle (deg), loop (TASK 750: true | false) }. */
export function clearingSettings(rec) {
  const S = POCKET_CLEARING.stepoverPct;
  const toolDia = Number(rec && rec.toolDia) > 0 ? Number(rec.toolDia) : 0;
  const pct = Number(rec && rec.stepover) > 0 ? Math.min(S.max, Math.max(S.min, Number(rec.stepover))) : S.default;
  const allowance = rec && rec.finishAllowance != null && Number.isFinite(Number(rec.finishAllowance)) && Number(rec.finishAllowance) >= 0 ? Number(rec.finishAllowance) : POCKET_CLEARING.finishAllowance.mm;
  const angle = rec && Number.isFinite(Number(rec.rasterAngle)) && rec.rasterAngle !== null && rec.rasterAngle !== '' ? Number(rec.rasterAngle) : POCKET_CLEARING.rasterAngle;
  const LP = POCKET_CLEARING.loopPitch, lp = Number(rec && rec.loopPitch);
  return { pattern: clearingPattern(rec), toolDia, r: toolDia / 2, stepoverPct: pct, stepover: (pct / 100) * toolDia, allowance, offset: Number(rec && rec.cutOffset) || 0, angle,
    loop: Boolean(rec && rec.loop === true), pitch: lp > 0 ? Math.min(LP.max, Math.max(LP.min, lp)) : LP.default };
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

// ── THE RINGS: [level][regions] (level 0 = the outermost, at r + a) ──
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

// ── the Spiral: the rings joined (see THE RULES) ──
// the nearest point of a closed loop (open {x,y}[]) to q: { i, t, d, p } (on the segment i -> i + 1)
function nearestOnLoop(pts, q) {
  let best = null;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length], f = distToSeg(q, a, b);
    if (!best || f.d < best.d) best = { i, t: f.t, d: f.d, p: P(a.x + (b.x - a.x) * f.t, a.y + (b.y - a.y) * f.t) };
  }
  return best;
}
// where a line starts on a ring no line reaches: the middle of the ring's longest edge
function ringStart(pts) {
  let li = 0;
  const segL = (i) => Math.hypot(pts[(i + 1) % pts.length].x - pts[i].x, pts[(i + 1) % pts.length].y - pts[i].y);
  for (let i = 1; i < pts.length; i++) if (segL(i) > segL(li)) li = i;
  const a = pts[li], b = pts[(li + 1) % pts.length];
  return { i: li, t: 0.5, p: P((a.x + b.x) / 2, (a.y + b.y) / 2) };
}
// a closed loop walked once round from `at` (a point on its segment at.i -> at.i + 1) back to it, in the loop's own direction
function loopFrom(pts, at) {
  const out = [at.p];
  for (let j = 1; j <= pts.length; j++) out.push(pts[(at.i + j) % pts.length]);
  out.push(at.p);
  return out.filter((q, j) => j === 0 || Math.hypot(q.x - out[j - 1].x, q.y - out[j - 1].y) > 1e-9);
}
/** The Spiral through the rings `levels` ([level][loops]: level 0 = the outermost; each loop an open {x,y}[] closed loop): the LINES (see THE RULES), in
 *  cutting order: [{ points, rings: [{ level, start, end }] (each ring's full loop = points[start..end], first = last), links: [from] (the link =
 *  points[from] -> points[from + 1]) }]. */
export function linkedSpiral(levels) {
  const lines = [];
  let open = []; // the lines whose last ring is on the level below the one being joined: { points, rings, links, end }
  for (let k = levels.length - 1; k >= 0; k--) {
    const loops = levels[k];
    const reach = loops.map(() => []);
    for (const ln of open) { // each line links from where its last ring ends to the nearest point of this level's rings
      let best = null;
      loops.forEach((pts, c) => { const f = nearestOnLoop(pts, ln.end); if (!best || f.d < best.d) best = { ...f, c }; });
      reach[best.c].push({ ln, at: best });
    }
    const next = [];
    loops.forEach((pts, c) => {
      const arrived = reach[c].slice().sort((x, y) => y.ln.rings.length - x.ln.rings.length); // stable: the line with the most rings goes on (a tie: the first)
      for (const x of arrived.slice(1)) lines.push(x.ln); // the others end at their own ring (cut whole)
      const ln = arrived.length ? arrived[0].ln : { points: [], rings: [], links: [] };
      const at = arrived.length ? arrived[0].at : ringStart(pts);
      if (arrived.length) ln.links.push(ln.points.length - 1);
      const loop = loopFrom(pts, at);
      ln.rings.push({ level: k, start: ln.points.length, end: ln.points.length + loop.length - 1 });
      ln.points.push(...loop);
      ln.end = at.p;
      next.push(ln);
    });
    open = next;
  }
  lines.push(...open);
  return lines.map(({ points, rings, links }) => ({ points, rings, links }));
}

// ── TASK 804: THE CHAINS and THE SEGMENTS (see THE RULES): one path per area ──
// the ring tree of `L` ([level][regions]): each region of level k + 1 lies in one region of level k (its parent). Nodes { k, g, kids, depth (levels from it
// down, itself included), area }, the roots (level 0) returned
function ringTree(L) {
  const nodes = L.map((E, k) => E.map((g) => ({ k, g, kids: [], depth: 1, area: regionsArea([g]) })));
  for (let k = 1; k < L.length; k++) for (const n of nodes[k]) {
    const q = P(n.g.outer[0][0], n.g.outer[0][1]);
    (nodes[k - 1].find((m) => inRegion(q, m.g)) || nodes[k - 1][0]).kids.push(n);
  }
  for (let k = L.length - 1; k >= 0; k--) for (const n of nodes[k]) n.depth = 1 + n.kids.reduce((d, c) => Math.max(d, c.depth), 0);
  return nodes[0] || [];
}
// the runs of the tree in CUTTING ORDER: the runs that start deepest first (the order 749's Spiral lines end in), a tie in the order found; each run
// [{ k, g }] outermost first. `through`: a run goes on into ONE child (the one with the most levels below it; a tie: the larger area) and every other
// child starts a run of its own (CHAINS); without it a run stops where the tree branches and every child starts a run (SEGMENTS)
function ringRuns(L, through) {
  const runs = [];
  const walk = (start) => {
    const run = [];
    for (let n = start; n;) {
      run.push(n);
      const kids = n.kids.slice().sort((x, y) => y.depth - x.depth || y.area - x.area);
      if (!through && kids.length > 1) { kids.forEach(walk); break; }
      kids.slice(1).forEach(walk);
      n = kids[0];
    }
    runs.push(run);
  };
  ringTree(L).forEach(walk);
  return runs.map((run, i) => ({ run, i })).sort((x, y) => y.run[0].k - x.run[0].k || x.i - y.i).map((x) => x.run.map(({ k, g }) => ({ k, g })));
}
/** The CHAINS of the rings `L` ([level][regions], level 0 the outermost): one per area, a chain going on through a split into the child with the most
 *  levels below it (TASK 804: the Loop's closed paths). */
export const ringChains = (L) => ringRuns(L, true);
/** The SEGMENTS of the rings `L`: the chains cut where the tree branches (the shared rings before a split are a segment of their own; TASK 804: the
 *  Morphed spiral's paths: a morphed turn never reaches into another area's arm). */
export const ringSegments = (L) => ringRuns(L, false);

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
// TASK 804: phi steps BACK by more than this (a tenth of a turn) only where the inner ring's nearest points jump over an arm it does not reach that covers
// more than half the outer ring (a split: another area's lobe; measured 0.40 to 0.50 on the bow-tie, the dumbbell, the S, the U), never by rounding (at
// most 0.008, the circle's smallest ring): such a step is the jump FORWARD over the arm (both rings wind the same way)
const WRAP_BACK = 0.1;
function propagate(inner, outer, h, s) {
  const g = segGrid(outer, Math.max(s, h * 4));
  const raw = inner.map((q) => phiAt(outer, nearestOn(g, q)));
  const ph = [];
  raw.forEach((v, j) => {
    if (!j) { ph.push(v % 1); return; }
    let x = v + Math.round(ph[j - 1] - v); // the unwrapped value nearest the previous one
    if (x < ph[j - 1] - WRAP_BACK) x += 1;  // TASK 804: see WRAP_BACK
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
// the point of a sampled ring at phi (piecewise linear between its samples). Where several samples share phi (an arc of the ring whose nearest points
// on the ring inside it all hold one corner) the point is the LAST of them, or with `first` the first of them (TASK 804: the turn walks such an arc
// once, never back: see transition)
function ringAt(S, phi, first = false) {
  let lo = 0, hi = S.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (first ? S[m].phi < phi : S[m].phi <= phi) lo = m; else hi = m; }
  if (first && S[hi].phi === phi) return S[hi].p;
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
  // at one phi (both rings may hold an arc there) the inner ring's samples come first (a stable sort), each with the FIRST outer point at that phi, then
  // the outer ring's samples, each with the LAST inner point there: the turn walks the inner arc, then the outer arc, never back (TASK 804: it went back
  // over the arc it had just walked, a fold that crossed itself on a star's or a blob's hollow corners)
  const ev = [...inner.map((x) => ({ phi: x.phi, A: x.p })), ...outer.map((x) => ({ phi: x.phi, B: x.p }))].sort((a, b) => a.phi - b.phi);
  const out = ev.map((e) => {
    const A = e.A || ringAt(inner, e.phi), B = e.B || ringAt(outer, e.phi, true);
    const L = Math.hypot(A.x - B.x, A.y - B.y), k = L <= CAP * s ? 1 - e.phi : ((1 - e.phi) * depthOf(L / s) * s) / L;
    return P(B.x + k * (A.x - B.x), B.y + k * (A.y - B.y));
  });
  out.phis = ev.map((e) => e.phi); // TASK 804: each point's phi
  return out;
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
  const turns = [sampled[K].map((x) => x.p)], phis = [sampled[K].map((x) => x.phi)];
  for (let k = K - 1; k >= 0; k--) { const t = transition(sampled[k + 1], sampled[k], s); turns.push(t); phis.push(t.phis); }
  if (K > 0) { turns.push(sampled[0].map((x) => x.p)); phis.push(sampled[0].map((x) => x.phi)); }
  const points = [], starts = [];
  for (const t of turns) {
    const sp = simplifyPath(t, tol);
    starts.push(points.length ? points.length - 1 : 0);
    for (const p of points.length ? sp.slice(1) : sp) points.push(p);
  }
  return { points, turns: starts, dense: turns.map((t, j) => ({ pts: t, phi: phis[j] })) }; // TASK 804: each turn's points with their phi (the Loop's return arm)
}
/** TASK 804: the Morphed spiral's GRADUAL LOOP of one segment: the morphed spiral through `rings` (outermost first: the finish turn, or the segment's own
 *  outermost ring; the cutting levels pitch' x s apart) out to its closing turn, then the RETURN arm back in: at each phi the point half way between a
 *  turn and the next one out (the middle of the band they cut), from the outermost back to the middle, ending where the spiral began. A loopBuilder, or
 *  null (no spiral, or its turns would cross: the caller refuses the Loop). */
function morphedGradualLoop(rings, s, finish) {
  const sp = morphedSpiral(rings, s);
  if (!sp) return null;
  const T = sp.dense;
  if (T.length < 2) { const b = loopBuilder(); b.turn(sp.points, 'morphed'); if (!same(b.last(), b.pts[0])) b.leg([b.pts[0]]); return b; } // one ring: its own loop
  const at = (t, phi) => { // the turn's point at phi (the first of several at one phi)
    let lo = 0, hi = t.phi.length - 1;
    if (phi <= t.phi[0]) return t.pts[0];
    if (phi >= t.phi[hi]) return t.pts[hi];
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (t.phi[m] < phi) lo = m; else hi = m; }
    const f = t.phi[hi] > t.phi[lo] ? (phi - t.phi[lo]) / (t.phi[hi] - t.phi[lo]) : 1;
    return P(t.pts[lo].x + (t.pts[hi].x - t.pts[lo].x) * f, t.pts[lo].y + (t.pts[hi].y - t.pts[lo].y) * f);
  };
  const back = [];
  for (let j = T.length - 2; j >= 0; j--) { // between turn j and turn j + 1, phi from 1 down to 0
    const ph = [...new Set([...T[j].phi, ...T[j + 1].phi])].filter((v) => v >= 0 && v <= 1).sort((x, y) => y - x);
    const mid = ph.map((v) => { const p = at(T[j], v), q = at(T[j + 1], v); return P((p.x + q.x) / 2, (p.y + q.y) / 2); });
    back.push(...(back.length ? mid.slice(1) : mid));
  }
  const b = loopBuilder(), last = sp.turns[sp.turns.length - 1];
  b.turn(sp.points.slice(0, last + 1), 'morphed');
  b.turn(sp.points.slice(last), finish ? 'finish' : 'ring'); // its closing turn: the finish turn when the segment reaches the wall
  b.turn(simplifyPath(back, POCKET_CLEARING.pathTolMm), 'return');
  if (!same(b.last(), b.pts[0])) b.leg([b.pts[0]]);
  b.cutStep = s;
  return b;
}

// ── TASK 750: the LOOP (see THE RULES): closed paths (first point == last point) ──
const same = (p, q) => Math.hypot(p.x - q.x, p.y - q.y) < 1e-9;
// a loop being built: its points, its turns ([{ start, end, kind }]: pts[start..end] is a turn / pass / ring: 'ring' | 'finish' | 'pass' | 'cleanup' |
// 'morphed'), the length of its legs (links, steps, returns: the rest) and the turns its legs cross
function loopBuilder() {
  const pts = [], turns = [];
  // a point equal to the last one (within 1e-9 mm) is not added again; a turn's own point replaces a leg's computed copy of it (its exact vertex is kept)
  const add = (list, exact) => { for (const q of list) { if (!pts.length || !same(pts[pts.length - 1], q)) pts.push(q); else if (exact) pts[pts.length - 1] = q; } };
  const b = { pts, turns, legs: 0, crossings: 0, last: () => pts[pts.length - 1],
    turn(list, kind) { const start = pts.length && same(pts[pts.length - 1], list[0]) ? pts.length - 1 : pts.length; add(list, true); turns.push({ start, end: pts.length - 1, kind }); },
    leg(list, crossings = 0) { let at = pts.length ? pts[pts.length - 1] : list[0]; for (const q of list) { b.legs += Math.hypot(q.x - at.x, q.y - at.y); at = q; } b.crossings += crossings; add(list); } };
  return b;
}
const inRing = (p, ring) => { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const a = ring[i], q = ring[j]; if ((a.y > p.y) !== (q.y > p.y) && p.x < ((q.x - a.x) * (p.y - a.y)) / (q.y - a.y) + a.x) c = !c; } return c; };
const inRegion = (p, g) => inRing(p, toXY(g.outer)) && !g.holes.some((h) => inRing(p, toXY(h)));
// a straight segment inside `regions` (grown by 0.01 mm by the caller: a segment along their edge counts as inside)
function segmentInside(a, b, regions) {
  const L = Math.hypot(b.x - a.x, b.y - a.y);
  if (L < 1e-6) return true;
  const got = clipOpenPaths([[[a.x, a.y], [b.x, b.y]]], regions).reduce((t, piece) => t + pathLength(piece.map(([x, y]) => P(x, y)), false), 0);
  return got >= L - 2e-3;
}
// the shorter way along a closed loop (open {x,y}[]) from `from` to `to` (points on it: { i, t, p }, on the segment i -> i + 1)
function alongLoop(pts, from, to) {
  const n = pts.length;
  const fwd = [from.p];
  if (!(from.i === to.i && to.t >= from.t)) for (let j = (from.i + 1) % n; ; j = (j + 1) % n) { fwd.push(pts[j]); if (j === to.i) break; }
  fwd.push(to.p);
  const bwd = [from.p];
  if (!(from.i === to.i && to.t <= from.t)) for (let j = from.i; ; j = (j - 1 + n) % n) { bwd.push(pts[j]); if (j === (to.i + 1) % n) break; }
  bwd.push(to.p);
  return pathLength(fwd, false) <= pathLength(bwd, false) ? fwd : bwd;
}
// the nearest point of any of `loops` to q: { c, i, t, d, p }
function nearestOfLoops(loops, q) {
  let best = null;
  loops.forEach((pts, c) => { const f = nearestOnLoop(pts, q); if (!best || f.d < best.d) best = { ...f, c }; });
  return best;
}
// ── TASK 804: THE GRADUAL LOOP (see THE RULES): per chain, a double spiral of exact offset levels with its transitions side by side ──
// a point ON a closed loop (open {x,y}[]): { i, t, p } on its segment i -> i + 1
const onLoop = (pts, i, t) => { const a = pts[i], b = pts[(i + 1) % pts.length]; return { i, t, p: P(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t) }; };
// the point `len` further along a closed loop from `at` (its own direction)
function aheadOn(pts, at, len) {
  let i = at.i, t = at.t, left = len;
  for (let n = 0; n <= pts.length + 1; n++) {
    const a = pts[i], b = pts[(i + 1) % pts.length], L = Math.hypot(b.x - a.x, b.y - a.y), rest = (1 - t) * L;
    if (rest >= left && L > 0) return onLoop(pts, i, t + left / L);
    left -= rest; i = (i + 1) % pts.length; t = 0;
  }
  return onLoop(pts, i, 0);
}
// a closed loop walked from `from` to `to` (points on it) FORWARD (dir 1, the loop's own direction) or BACKWARD (dir -1), never through `to` before the end
function walkLoop(pts, from, to, dir) {
  const n = pts.length, out = [from.p];
  if (dir > 0) {
    if (!(from.i === to.i && to.t > from.t)) for (let j = (from.i + 1) % n; ; j = (j + 1) % n) { out.push(pts[j]); if (j === to.i) break; }
  } else if (!(from.i === to.i && to.t < from.t)) for (let j = from.i; ; j = (j - 1 + n) % n) { out.push(pts[j]); if (j === (to.i + 1) % n) break; }
  out.push(to.p);
  return out.filter((q, j) => j === 0 || !same(q, out[j - 1]));
}
const containsPt = (loop, q) => inRing(q, loop);
// C lies BETWEEN loops A and B (one inside the other): A inside C inside B, or B inside C inside A
const between = (C, A, B) => (containsPt(C, A[0]) && containsPt(B, C[0])) || (containsPt(C, B[0]) && containsPt(A, C[0]));
// the loops of a chain at the offsets D (positive): a loop of the chain itself where D is its offset, else the contour of R at that offset that lies between
// the chain's two loops round it; null when there is none
function levelLoops(seq, D, R) {
  const known = seq.slice().sort((x, y) => y.delta - x.delta); // by delta, the centre first
  const levels = [];
  for (const d of D) {
    const hit = known.find((q) => Math.abs(q.delta - d) < 1e-9);
    if (hit) { levels.push(positive(hit.pts)); continue; }
    const inner = known.filter((q) => q.delta > d).pop(), outer = known.find((q) => q.delta < d);
    const C = inner && outer ? contoursOf(offsetRegions(R, -d, POCKET_CLEARING.chordTolMm)).find((c) => between(c, inner.pts, outer.pts)) : null;
    if (!C) return null;
    levels.push(positive(C));
  }
  return levels;
}
// the CUTTING offsets of a chain: from its centre out every pitch' x s (pitch' <= pitch, equal steps) to its outermost clearing ring: { cutD (centre
// first), step }
function cuttingOffsets(clear, s, pitch) {
  const centre = clear[clear.length - 1], top = clear[0];
  const span = centre.delta - top.delta, N = span > 1e-9 ? Math.ceil(span / (pitch * s) - 1e-9) : 0, step = N ? span / N : 0;
  return { cutD: Array.from({ length: N + 1 }, (_, i) => centre.delta - i * step), step };
}
/**
 * gradualLoop(seq, R, s, pitch) -> a closed loop (loopBuilder) or null: THE GRADUAL LOOP of one chain. `seq` = its loops from the outer turnaround (the
 * finish turn, or a branch's own outermost ring) to the CENTRE: [{ pts (closed loop, open {x,y}[]), delta (its offset from R's edge), finish }], each
 * inside the previous (or, round an island, each round the previous). The CUTTING levels: from the centre out every pitch' x s (pitch' <= pitch: the
 * same steps from the centre to the outermost clearing ring), then the finish turn; the RETURN levels: half way between two cutting levels (exact
 * offsets of R, the one between its neighbours). The path: the centre ring, then out ring by ring to the finish turn (whole), then back in on the
 * return levels the other way round, then one step to the start. Every level is walked whole but for a short WINDOW (lambda along it from the SEAM: a
 * chain of nearest points from the middle of the centre's longest edge out, `seam` picks another edge), where the steps between levels run SIDE BY
 * SIDE: out from a_i to b_(i+2) (cutting), in from b_j to a_(j-2) (return), all parallel; no step passes over a level.
 */
function gradualLoop(seq, R, s, pitch, seam = 0, lambdaScale = 1, along = false) {
  const fin = seq[0].finish ? seq[0] : null, clear = fin ? seq.slice(1) : seq;
  if (!clear.length) return finishTurnLoop(positive(fin.pts));
  const { cutD, step } = cuttingOffsets(clear, s, pitch);
  if (fin) cutD.push(fin.delta);
  const D = []; // the levels from the centre out: cutting, return, cutting, ..., the outermost cutting level
  cutD.forEach((d, i) => { if (i) D.push((cutD[i - 1] + d) / 2); D.push(d); });
  const levels = levelLoops(seq, D, R);
  if (!levels) return null;
  if (levels.length === 1) { const b = loopBuilder(); b.turn(loopFrom(levels[0], ringStart(levels[0])), fin ? 'finish' : 'ring'); return b; }
  // the seam: from the middle of the centre's (seam + 1)-th longest edge, the nearest point of each level out
  const c0 = levels[0], order = c0.map((_, i) => i).sort((x, y) => Math.hypot(c0[(y + 1) % c0.length].x - c0[y].x, c0[(y + 1) % c0.length].y - c0[y].y) - Math.hypot(c0[(x + 1) % c0.length].x - c0[x].x, c0[(x + 1) % c0.length].y - c0[x].y));
  if (seam >= order.length) return null;
  // seam 0: the middle of the centre ring's longest edge as 749's line starts there (ringStart on the ring as offset gives it: the same start mark)
  const A = [seam === 0 ? (() => { const f = nearestOnLoop(c0, ringStart(clear[clear.length - 1].pts).p); return { i: f.i, t: f.t, p: f.p }; })() : onLoop(c0, order[seam], 0.5)];
  for (let i = 1; i < levels.length; i++) { const f = nearestOnLoop(levels[i], A[i - 1].p); A.push({ i: f.i, t: f.t, p: f.p }); }
  const edge = Math.hypot(c0[(order[seam] + 1) % c0.length].x - c0[order[seam]].x, c0[(order[seam] + 1) % c0.length].y - c0[order[seam]].y);
  const lambda = Math.min(step || s, edge / 4) * lambdaScale;
  // the window's other side: lambda on along the centre ring, then the nearest point of each level out (two chains of nearest points: the window is
  // the band between two normals, as wide in angle on a small ring as on a big one, so its steps stay parallel)
  // (`along`: else lambda on along every level, the window as long on each: where two normals of a hollow corner meet, the other way holds)
  const B = [aheadOn(c0, A[0], lambda)];
  for (let i = 1; i < levels.length; i++) { const f = along ? aheadOn(levels[i], A[i], lambda) : nearestOnLoop(levels[i], B[i - 1].p); B.push({ i: f.i, t: f.t, p: f.p }); }
  const M = levels.length - 1, b = loopBuilder();
  for (let i = 0; i < M; i += 2) { b.turn(walkLoop(levels[i], B[i], A[i], 1), 'ring'); b.leg([B[i + 2].p]); } // out: each cutting level, then the step out
  b.turn([...walkLoop(levels[M], B[M], A[M], 1), B[M].p], fin ? 'finish' : 'ring'); // the outer turnaround, whole
  for (let j = M - 1; j >= 1; j -= 2) { b.leg([A[j].p]); b.turn(walkLoop(levels[j], A[j], B[j], -1), 'return'); } // in: each return level the other way
  b.leg([B[0].p]); // the step to the start
  b.cutStep = step || null;
  b.centre = { pts: levels[0], A: A[0], B: B[0], ahead: lambda }; // the centre ring, walked first from B to A (a bridge to another loop starts there)
  return b;
}

/** TASK 804: the Spiral's Loop CHAINS ([seq] for gradualLoop): per chain of the ring tree (ringChains) its rings' outer contours, after the wall's finish
 *  turn when it reaches the wall; per island its rings round it (the holes of the rings, each family going on into the hole round it), after the island's
 *  finish turn. With no allowance ring 0 IS the finish turn. A finish turn no chain reaches is its own loop (`alone`). */
function spiralLoopChains(L, finishLoops, r, a, s) {
  const d = (k) => r + a + k * s, used = new Set(), seqs = [], bridges = [];
  const finishFor = (pts, hole) => { // the finish turn round this ring 0 contour (the wall's: around it; an island's: inside it)
    const c = finishLoops.findIndex((F, c) => !used.has(c) && (hole ? containsPt(pts, F[0]) && !containsPt(F, pts[0]) : containsPt(F, pts[0])));
    if (c < 0) return null;
    used.add(c);
    return { pts: finishLoops[c], delta: r, finish: true };
  };
  const withFinish = (seq, hole) => {
    if (a > 0) { const f = finishFor(seq[0].pts, hole); return f ? [f, ...seq] : seq; }
    seq[0] = { ...seq[0], finish: true }; return seq;
  };
  const deepHoles = []; // per seq: the hole contours of its deepest region (a chain that stays round an island to its end), to bridge to
  for (const ch of ringChains(L)) {
    const seq = ch.map(({ k, g }) => ({ pts: toXY(g.outer), delta: d(k) }));
    seqs.push(ch[0].k === 0 ? withFinish(seq, false) : seq);
    deepHoles.push(ch[ch.length - 1].g.holes.map((h) => h[0]));
  }
  // the islands' families: from each hole of ring 0 out, the hole of the next ring round it (one family goes on where two meet: the first found)
  const holes = L.map((E) => E.flatMap((g) => g.holes.map(toXY)).filter((h) => h.length >= 3));
  const taken = holes.map((H) => H.map(() => false));
  (holes[0] || []).forEach((h0, c0) => {
    taken[0][c0] = true;
    const seq = [{ pts: h0, delta: d(0) }];
    for (let k = 1, cur = h0; k < holes.length; k++) {
      const c = holes[k].findIndex((h, c) => !taken[k][c] && containsPt(h, cur[0]));
      if (c < 0) break;
      taken[k][c] = true; cur = holes[k][c]; seq.push({ pts: cur, delta: d(k) });
    }
    const into = deepHoles.findIndex((hs) => hs.some((q) => same(P(q[0], q[1]), seq[seq.length - 1].pts[0])));
    if (into >= 0 && !bridges.some(([o]) => o === into)) bridges.push([into, seqs.length]); // its family ends on a hole of that chain's deepest region
    seqs.push(withFinish(seq, true));
  });
  const alone = finishLoops.filter((_, c) => !used.has(c));
  return { seqs, alone, bridges };
}
/** TASK 804: two gradual loops whose centre rings face each other across a strip no path runs in (the wall's chain and an island's, where the rings round
 *  the island never split) joined into ONE closed loop by two parallel BRIDGES: from p1 on the first centre ring to its nearest point q1 on the second,
 *  round the second loop (the other way) to q2, the nearest point of p2 (a stepover on from p1), back to p2. p1 is half way round the first centre ring
 *  from its seam (away from both windows). */
function bridgeLoops(b1, b2, s) {
  const c1 = b1.centre, c2 = b2.centre, L1 = pathLength(c1.pts, true), L2 = pathLength(c2.pts, true);
  const t0 = b1.turns[0];
  const posOn = (c, q) => pathLength(walkLoop(c.pts, c.B, q, 1), false); // how far along the centre walk (from B) a point of the centre ring is
  for (const f of [0.5, 0.25, 0.75]) { // p1: half way round the first centre walk (else a quarter): q1, q2 must lie on the second's walk, in order
    const p1 = aheadOn(c1.pts, c1.B, (L1 - c1.ahead) * f), p2 = aheadOn(c1.pts, p1, s);
    const n1 = nearestOnLoop(c2.pts, p1.p), n2 = nearestOnLoop(c2.pts, p2.p);
    const q1 = { i: n1.i, t: n1.t, p: n1.p }, q2 = { i: n2.i, t: n2.t, p: n2.p };
    const a1 = posOn(c2, q1), a2 = posOn(c2, q2);
    if (!(a1 > 1e-6 && a2 > a1 + 1e-6 && a2 < L2 - c2.ahead - 1e-6)) continue;
    // the second loop as a cycle from q2 round to q1 (the arc q1 -> q2 of its centre ring left out), walked backwards: q1 ... q2
    const cyc = [...walkLoop(c2.pts, q2, c2.A, 1), ...b2.pts.slice(b2.turns[0].end + 1), ...walkLoop(c2.pts, c2.B, q1, 1)];
    const out = loopBuilder();
    out.turn(walkLoop(c1.pts, c1.B, p1, 1), 'ring');
    out.leg([q1.p]);
    out.turn(cyc.reverse(), 'bridged');
    out.leg([p2.p]);
    out.turn(walkLoop(c1.pts, p2, c1.A, 1), 'ring');
    const shift = out.pts.length - 1 - t0.end; // b1.pts[t0.end] is A, the last point so far
    for (const t of b1.turns.slice(1)) out.turns.push({ start: t.start + shift, end: t.end + shift, kind: t.kind });
    out.pts.push(...b1.pts.slice(t0.end + 1));
    out.legs += b1.legs + b2.legs;
    out.cutStep = Math.max(b1.cutStep || 0, b2.cutStep || 0);
    return out;
  }
  return null;
}
// THE GRADUAL LOOP of every chain, each checked against itself and the ones before (THE HARD RULE): a chain whose window crosses tries it measured the
// other way, then half as long, then the next seam (the centre's next longest edge); null when none is crossing-free
function gradualLoops(seqs, alone, R, s, pitch, bridges = []) {
  const done = [];
  const paths = () => done.map((b) => ({ points: b.pts, closed: true }));
  for (const seq of seqs) {
    let got = null;
    for (let seam = 0; seam < 8 && !got; seam++) for (const [sc, along] of [[1, false], [1, true], [0.5, false], [0.5, true]]) {
      const b = gradualLoop(seq, R, s, pitch, seam, sc, along);
      if (b && !pathCrossings([{ points: b.pts, closed: true }, ...paths()]).count) { got = b; break; }
    }
    if (!got) return null;
    done.push(got);
  }
  // the bridges (an island's family into the wall's chain): one closed loop where the joined loop crosses nothing, else the two stay apart
  const gone = new Set();
  for (const [o, h] of bridges) {
    const m = bridgeLoops(done[o], done[h], s);
    if (!m) continue;
    const others = done.filter((_, i) => i !== o && i !== h && !gone.has(i)).map((b) => ({ points: b.pts, closed: true }));
    if (pathCrossings([{ points: m.pts, closed: true }, ...others]).count) continue;
    done[o] = m; gone.add(h);
  }
  const out = done.filter((_, i) => !gone.has(i));
  for (const F of alone) out.push(finishTurnLoop(F));
  return out;
}

/** TASK 804b: THE RASTER'S LOOP (see THE RULES): per area of A0 ONE closed path with ZERO crossings: its passes in zigzag order joined along the area's
 *  contour, then a step out to its WALL RING (the finish turn round the Rr region the area lies in), the wall ring WHOLE, back along it to the first
 *  pass's start; each island's ring a BALLOON (a step out, the ring whole, the same step back) where nothing crosses; a ring no area reaches is a loop of
 *  its own. { loops: [builder], refused: null | 'raster join' | 'loop cross' } */
function rasterLoops(A0, pieces, Rr, a) {
  const grownA0 = offsetRegions(A0, 0.01), loops = [], owned = new Set(); // owned: 'region:contour' of a ring already cut whole
  const rings = Rr.map((G) => [G.outer, ...G.holes].map(toXY)); // per region of Rr: its wall ring, then its islands' rings
  const near = a + 0.01; // a step to a ring is the allowance long (+ the offsets' rounding)
  const crosses = (items) => pathCrossings([{ points: assemble(items).pts, closed: true }, ...loops.map((b) => ({ points: b.pts, closed: true }))]).count > 0;
  // the region (of A0, of Rr) a pass lies in: the one holding a point of it (its middle, else a quarter of the way: a pass along an island's edge has its
  // middle ON that edge)
  const holding = (regions, pc) => {
    if (regions.length === 1) return 0;
    const u = pc.points[0], v = pc.points[pc.points.length - 1];
    for (const t of [0.5, 0.25, 0.75, 0.125, 0.875]) { const q = P(u.x + (v.x - u.x) * t, u.y + (v.y - u.y) * t), k = regions.findIndex((g) => inRegion(q, g)); if (k >= 0) return k; }
    return -1;
  };
  const inArea = pieces.map((pc) => holding(A0, pc));
  if (inArea.includes(-1)) return { loops: [], refused: 'raster join' }; // a pass in no area (not met on the test shapes): refused, never dropped
  for (const [gk, g] of A0.entries()) {
    const C = [g.outer, ...g.holes].map(toXY).filter((pts) => pts.length >= 3);
    const pcs = pieces.filter((_, i) => inArea[i] === gk);
    if (!pcs.length) { // an area no pass reaches: its contours are its clean-up rings, each a loop of its own (with no allowance they are the finish turns: below)
      if (a > 0) for (const pts of C) { const b = loopBuilder(); b.turn(loopFrom(pts, ringStart(pts)), 'cleanup'); loops.push(b); }
      continue;
    }
    // the passes in zigzag order, each joined to the next ALONG the area's contour (the shorter way), or straight where they end on two contours
    const items = [{ kind: 'pass', pts: pcs[0].points }];
    for (let k = 1; k < pcs.length; k++) {
      const e = pcs[k - 1].points[pcs[k - 1].points.length - 1], s0 = pcs[k].points[0], le = nearestOfLoops(C, e), ls = nearestOfLoops(C, s0);
      if (le.c === ls.c) items.push({ kind: null, pts: alongLoop(C[le.c], { ...le, p: e }, { ...ls, p: s0 }) }); // from the pass's own end (no 0.0001 mm jog)
      else if (segmentInside(e, s0, grownA0)) items.push({ kind: null, pts: [s0] });
      else return { loops: [], refused: 'raster join' };
      items.push({ kind: 'pass', pts: pcs[k].points });
    }
    const S = pcs[0].points[0], last = pcs[pcs.length - 1].points, E = last[last.length - 1];
    const gi = holding(Rr, pcs[0]); // the region of Rr round the area
    if (gi < 0) return { loops: [], refused: 'loop cross' };
    // THE WALL RING: from the last pass's end E a step out to it, the ring whole starting AWAY from the first pass's start S (so it comes back to the step
    // from S's side), then back along it (the shorter arc, already cut) to S's step, and in to S. A ring another area already cut whole: only the arc
    const W = rings[gi][0], fE = onRing(W, E), fS = onRing(W, S);
    if (!(fE.d <= near && fS.d <= near)) return { loops: [], refused: 'loop cross' }; // the first / last pass does not end next to the wall ring
    const arcLen = (dir) => pathLength(walkLoop(W, fS, fE, dir), false);
    const short = arcLen(1) <= arcLen(-1) ? 1 : -1, own = !owned.has(`${gi}:0`);
    const wallOf = (dir) => (own
      ? [{ kind: null, pts: [fE.p] }, { kind: 'finish', pts: walkLoop(W, fE, fE, dir) }, { kind: null, pts: walkLoop(W, fE, fS, -dir) }, { kind: null, pts: [S] }]
      : [{ kind: null, pts: [fE.p] }, { kind: null, pts: walkLoop(W, fE, fS, -dir) }, { kind: null, pts: [S] }]);
    let path = null;
    for (const dir of [short, -short]) { const t = [...items, ...wallOf(dir)]; if (!crosses(t)) { path = t; break; } }
    if (!path) return { loops: [], refused: 'loop cross' };
    if (own) owned.add(`${gi}:0`);
    // THE ISLANDS' RINGS: each a balloon from a point of the path one allowance from it (a pass's end first), started back the way the path came (so it
    // returns from the side the path goes on to); the first such point where nothing crosses
    for (let c = 1; c < rings[gi].length; c++) {
      if (owned.has(`${gi}:${c}`)) continue;
      const H = rings[gi][c], upto = path.length - (own ? 4 : 3), at = [];
      for (let i = 0; i < upto; i++) path[i].pts.forEach((p, j) => at.push({ i, j, p, d: nearestOnLoop(H, p).d, end: path[i].kind === 'pass' && (j === 0 || j === path[i].pts.length - 1) ? 1 : 0 }));
      const cand = at.filter((x) => x.d <= near).sort((x, y) => y.end - x.end).slice(0, 96); // the pass ends first, in the path's order
      if (!cand.length) continue; // no pass reaches it: a loop of its own (below)
      let got = null;
      const flat = assemble(path).pts;
      for (const x of cand) {
        const k = flat.findIndex((q) => same(q, x.p));
        const prev = flat[(k - 1 + flat.length) % flat.length], next = flat[(k + 1) % flat.length];
        const Q = onRing(H, x.p), h0 = H[Q.i], h1 = H[(Q.i + 1) % H.length];
        const along = (q, r) => ((r.x - q.x) * (h1.x - h0.x) + (r.y - q.y) * (h1.y - h0.y)) / (Math.hypot(r.x - q.x, r.y - q.y) || 1);
        const pref = along(prev, x.p) + along(x.p, next) > 0 ? -1 : 1; // back the way the path came, away from where it goes on
        for (const dir of [pref, -pref]) {
          const balloon = [{ kind: null, pts: [Q.p] }, { kind: 'finish', pts: walkLoop(H, Q, Q, dir) }, { kind: null, pts: [x.p] }];
          const it = path[x.i], t = x.j === 0 ? [...path.slice(0, x.i), ...balloon, ...path.slice(x.i)]
            : x.j === it.pts.length - 1 ? [...path.slice(0, x.i + 1), ...balloon, ...path.slice(x.i + 1)]
              : [...path.slice(0, x.i), { kind: it.kind, pts: it.pts.slice(0, x.j + 1) }, ...balloon, { kind: it.kind, pts: it.pts.slice(x.j) }, ...path.slice(x.i + 1)];
          if (!crosses(t)) { got = t; break; }
        }
        if (got) break;
      }
      if (!got) return { loops: [], refused: 'loop cross' }; // an island no balloon reaches without a crossing: refused, never cut crossing
      path = got;
      owned.add(`${gi}:${c}`);
    }
    loops.push(assemble(path));
  }
  rings.forEach((rs, gi) => rs.forEach((F, c) => { if (!owned.has(`${gi}:${c}`)) loops.push(finishTurnLoop(F)); })); // a ring no area cut: a loop of its own
  return { loops, refused: null };
}
// TASK 804b: a closed loop ({ points, turns }) cut at every turn's start and end into pieces (its turns and the legs between), for its sweep: a piece
// that ends where it began (a ring walked whole) is swept as a closed ring (an open path whose ends meet is not swept whole by Clipper's offset)
function loopPieces(c) {
  const at = [...new Set([0, ...c.turns.flatMap((t) => [t.start, t.end]), c.points.length - 1])].sort((x, y) => x - y);
  const out = [];
  for (let k = 0; k + 1 < at.length; k++) {
    const pts = c.points.slice(at[k], at[k + 1] + 1), ring = pts.length > 3 && same(pts[0], pts[pts.length - 1]);
    out.push({ points: ring ? pts.slice(0, -1) : pts, closed: ring });
  }
  return out;
}
// the nearest point of a ring to q ({ i, t, d, p }): q itself where it lies on the ring (no allowance: the step has no length, and no 0.0001 mm jog)
const onRing = (pts, q) => { const f = nearestOnLoop(pts, q); return f.d < 1e-3 ? { ...f, p: q } : f; };
// the items ({ kind: a turn's kind | null (a leg), pts }) as a closed loop (loopBuilder)
function assemble(items) {
  const b = loopBuilder();
  for (const it of items) if (it.kind) b.turn(it.pts, it.kind); else b.leg(it.pts);
  return b;
}
/** A finish turn no clearing reaches, as a closed loop of its own (Raster's rule above; TASK 787: every pattern's, when there is nothing to clear). */
function finishTurnLoop(F) { const b = loopBuilder(); b.turn(loopFrom(F, ringStart(F)), 'finish'); return b; }

// ── the plan of one pocket (memoised: the same loops + settings give the same plan) ──
const MEMO = new Map(), MEMO_MAX = 48;
/**
 * planClearing({ outer, holes }, settings) -> the clearing of a pocket region (THE RULES), independent of depth:
 *   { pattern, clear: [{ points, closed, role: 'linked' | 'raster' | 'cleanup' | 'morphed', level?, index, count }] (in cutting order; a Spiral line also
 *     carries its rings: [{ level, start, end, finish }] (TASK 750 Loop on: the finish turn at r has level -1, or 0 with no allowance; finish = true) and
 *     links: [from], see linkedSpiral); TASK 750 Loop on: clear = the closed loops [{ points (first == last), closed: true, role: 'loop', index, count }],
 *     loop: true, loopCount, loopCrossings, loopExtra (mm), loopRefused (null | 'raster join' | 'loop cross': Loop off cut instead, the note says so),
 *     levels (Spiral / Morphed spiral: the number of rings), loops
 *     (their loops), lines (Spiral: its lines) + linesWhy (null | 'islands' | 'splits': why there are several), passes (Raster), cleanup (Raster: the
 *     clean-up loops), turns (Morphed spiral), wall: [centre loops], islands: [[centre loops] per island], swept (regions), leftover: { area,
 *     unreachable, missed, regions }, length (mm), morphedBlocked: null | 'islands' | 'splits', refused: null | 'no bit' | 'bit too big' |
 *     'islands close' | 'morphed islands' | 'morphed splits' }
 * outer / holes = closed [[x,y],...] rings (base mm).
 */
export function planClearing(rings, st) {
  const key = JSON.stringify([rings, st.pattern, st.r, st.stepover, st.allowance, st.offset, st.pattern === 'raster' ? st.angle : null, st.loop, st.loop ? st.pitch : null]);
  if (MEMO.has(key)) return MEMO.get(key);
  const plan = computePlan(rings, st);
  MEMO.set(key, plan);
  if (MEMO.size > MEMO_MAX) MEMO.delete(MEMO.keys().next().value);
  return plan;
}
function computePlan({ outer, holes }, st) {
  const { pattern, r, stepover: s, allowance: a, offset: off } = st;
  const base = { pattern, clear: [], levels: 0, loops: 0, passes: 0, cleanup: 0, turns: 0, wall: [], islands: [], swept: [], leftover: { area: 0, unreachable: 0, missed: 0, regions: [] }, length: 0, lines: 0, linesWhy: null, loop: false, loopCount: 0, loopCrossings: 0, loopExtra: 0, loopRefused: null, startPoint: null, morphedBlocked: null, refused: null };
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
  let clear = [], levels = 0, loops = 0, lines = 0, linesWhy = null, passes = 0, cleanup = 0, turns = 0, morphedBlocked = null;
  const needRings = pattern === 'linked' || pattern === 'morphed';
  const L = needRings ? ringLevels(R, d0, s) : [];
  if (needRings) {
    morphedBlocked = holes.length ? 'islands' : null; // TASK 804: a pocket whose rings split is morphed per area (one spiral per chain)
    levels = L.length;
    loops = L.reduce((n, E) => n + contoursOf(E).length, 0);
  }
  // TASK 750, LOOP on: the finish turns = the contours of R inset by exactly r (the wall's, each island's); with no allowance ring 0 already is that turn
  const Rr = st.loop ? offsetRegions(R, -r, POCKET_CLEARING.chordTolMm) : [];
  const finishLoops = st.loop && a > 0 ? contoursOf(Rr) : [];
  let built = null, loopRefused = null; // the closed loops (loopBuilder) when Loop is on
  if (pattern === 'linked') {
    // with Loop on the finish level is joined outside ring 0 by the same rule (the link from ring 0 is the allowance long)
    const finishLevel = finishLoops.length ? [finishLoops] : [];
    const ls = linkedSpiral([...finishLevel, ...L.map(contoursOf)]);
    const shift = finishLevel.length;
    lines = ls.length;
    linesWhy = lines > 1 ? (holes.length ? 'islands' : 'splits') : null;
    ls.forEach((ln, i) => clear.push({ points: ln.points, closed: false, role: 'linked', index: i + 1, count: ls.length,
      rings: ln.rings.map((g) => ({ ...g, level: g.level - shift, finish: st.loop && g.level === 0 })), links: ln.links }));
    if (st.loop) { // TASK 804: THE GRADUAL LOOP per chain (zero crossings), or refused (cut as the lines + the wall; the note says so)
      const { seqs, alone, bridges } = spiralLoopChains(L, finishLoops, r, a, s);
      built = gradualLoops(seqs, alone, R, s, st.pitch, bridges);
      if (!built) loopRefused = 'loop cross';
      else linesWhy = built.length > 1 ? (holes.length ? 'islands' : 'splits') : null;
    }
  } else if (pattern === 'morphed') {
    if (morphedBlocked) return { ...base, wall, islands, levels, loops, morphedBlocked, refused: 'morphed ' + morphedBlocked };
    // TASK 804: one morphed spiral PER SEGMENT (per area; the shared rings before a split are their own), in the segments' cutting order
    const chains = ringSegments(L), sps = [];
    for (const ch of chains) {
      const sp = morphedSpiral(ch.map((n) => toXY(n.g.outer)), s);
      // an area whose turns would cross each other (THE HARD RULE, #core/path-crossings) is refused, never cut crossing
      if (!sp || pathCrossings([{ points: sp.points, closed: false }]).count) return { ...base, wall, islands, levels, loops, morphedBlocked: 'area', refused: 'morphed area' };
      sps.push(sp);
    }
    lines = sps.length;
    linesWhy = lines > 1 ? 'splits' : null;
    sps.forEach((sp, i) => { turns += sp.turns.length; clear.push({ points: sp.points, closed: false, role: 'morphed', index: i + 1, count: sps.length, turnStarts: sp.turns }); });
    if (st.loop && sps.length) { // TASK 804: THE GRADUAL LOOP per segment (the morphed spiral out, the return arm in the middle of its bands), crossing-free or refused
      const used = new Set(), done = [];
      for (const ch of chains) {
        const seq = ch.map(({ k, g }) => ({ pts: toXY(g.outer), delta: d0 + k * s }));
        const { cutD, step } = cuttingOffsets(seq, s, st.pitch);
        let rings = levelLoops(seq, cutD, R), fin = ch[0].k === 0 && !(a > 0); // with no allowance ring 0 IS the finish turn
        if (rings && ch[0].k === 0 && a > 0) { // the segment that reaches the wall ends on the wall's finish turn
          const c = finishLoops.findIndex((F, c) => !used.has(c) && containsPt(F, seq[0].pts[0]));
          if (c >= 0) { used.add(c); rings = [...rings, positive(finishLoops[c])]; fin = true; }
        }
        const b = rings ? morphedGradualLoop(rings.slice().reverse(), step || s, fin) : null;
        if (!b || pathCrossings([{ points: b.pts, closed: true }, ...done.map((x) => ({ points: x.pts, closed: true }))]).count) { loopRefused = 'loop cross'; break; }
        done.push(b);
      }
      if (!loopRefused) built = [...done, ...finishLoops.filter((_, c) => !used.has(c)).map(finishTurnLoop)];
    }
  } else if (pattern === 'raster') {
    const A0 = offsetRegions(R, -d0, POCKET_CLEARING.chordTolMm);
    const pieces = A0.length ? rasterPasses(A0, s, st.angle) : [];
    passes = pieces.length;
    pieces.forEach((l, i) => clear.push({ points: l.points, closed: false, role: 'raster', index: i + 1, count: pieces.length, offset: l.offset }));
    const ring0 = contoursOf(A0);
    cleanup = ring0.length;
    ring0.forEach((pts, i) => clear.push({ points: pts, closed: true, role: 'cleanup', level: 0, index: i + 1, count: ring0.length }));
    if (st.loop && A0.length) {
      const rl = rasterLoops(A0, pieces, Rr, a);
      if (rl.refused) loopRefused = rl.refused; else built = rl.loops;
      linesWhy = holes.length ? 'islands' : A0.length > 1 ? 'splits' : null;
    }
  }
  // TASK 787: Loop on with NOTHING to clear (A0 empty: the bit + the allowance fill the pocket, only the finish turns fit): the loops are the finish turns
  // alone, each a loop of its own, as the Spiral's lines and Raster's rule already give: the Loop and its start mark are kept, never dropped silently
  if (st.loop && !built && !loopRefused && !clear.length && finishLoops.length) built = finishLoops.map(finishTurnLoop);
  // TASK 778: the pocket START MARK point (always ON the clearing route, never on an island): Spiral / Morphed = middle of the innermost ring's
  // longest edge (first point of the first line/spiral, which stays on the loop when Loop is on); Raster = start of the first pass.
  const innerStart = pattern === 'linked' || pattern === 'morphed' ? (clear.length && clear[0].points.length ? clear[0].points[0] : null) : null;
  const loop = Boolean(built && built.length);
  let loopCrossings = 0, loopExtra = 0, loopStep = 0;
  if (loop) {
    loopStep = built.reduce((m, b) => Math.max(m, b.cutStep || 0), 0); // TASK 804: the cutting arm's widest step (mm): pitch' x stepover
    loopCrossings = pathCrossings(built.map((b) => ({ points: b.pts, closed: true }))).count; // TASK 804: THE crossing check (0: the hard rule)
    loopExtra = built.reduce((t, b) => t + b.legs, 0);
    clear = built.map((b, i) => ({ points: b.pts, closed: true, role: 'loop', index: i + 1, count: built.length, turns: b.turns }));
    if (pattern !== 'linked') linesWhy = clear.length > 1 ? linesWhy : null;
  }
  // TASK 804: the Spiral's gradual Loop: the start mark at its first loop's seam on the centre ring (the middle of that ring's longest edge: ON the route)
  const seamStart = loop && pattern === 'linked' && built[0].centre ? built[0].centre.A.p : null;
  const startPoint = seamStart || innerStart || (clear.length && clear[0].points.length ? clear[0].points[0] : null);
  // what the bit sweeps (the clearing + the finish pass) and what it leaves
  // TASK 804b: a Raster loop walks back along its wall ring and its islands' steps (a path folding back on itself, which Clipper's offset of the whole path
  // does not sweep: the two sides cancel): its sweep is the union of its turns' and legs' sweeps, each piece swept on its own
  const sweepOf = (c) => (loop && pattern === 'raster' ? loopPieces(c) : [c]).map((q) => ({ points: q.points.map((p) => [p.x, p.y]), closed: q.closed }));
  const all = [...clear.flatMap(sweepOf), ...(loop ? [] : finish)]; // Loop on: the finish turns are in the loops
  const swept = sweepPaths(all, r, POCKET_CLEARING.chordTolMm);
  const leftR = withoutSlivers(diffRegions(R, swept));
  const area = regionsArea(leftR);
  const reachable = offsetRegions(offsetRegions(R, -r, POCKET_CLEARING.chordTolMm), r, POCKET_CLEARING.chordTolMm);
  const unreachable = Math.min(area, regionsArea(withoutSlivers(diffRegions(R, reachable))));
  const length = clear.reduce((t, c) => t + pathLength(c.points, c.closed), 0);
  const finishLength = loop ? 0 : [...wall, ...islands.flat()].reduce((t, pts) => t + pathLength(pts, true), 0);
  return { pattern, clear, levels, loops, passes, cleanup, turns, wall, islands, swept, leftover: { area, unreachable, missed: Math.max(0, area - unreachable), regions: leftR }, length, finishLength, lines, linesWhy,
    loop, loopCount: loop ? clear.length : 0, loopCrossings, loopExtra, loopStep, loopRefused, startPoint, morphedBlocked, refused: null };
}

/** A pocket cut's region rings ({ outer, holes }: closed [[x,y],...], arcs exact to chordTolMm) from its loops (#core/hold-part loopWalk), or null. */
export function pocketRings(cut, state) {
  const ring = (loop) => { const w = loopWalk(loop, state); if (!w) return null; const pts = walkPoints(w); return pts.length >= 3 ? closedRing(pts) : null; };
  const outer = cut && cut.outerLoop ? ring(cut.outerLoop) : null;
  if (!outer) return null;
  const holes = (cut.holeLoops || []).map(ring);
  return holes.some((h) => !h) ? null : { outer, holes };
}

/** The Morphed spiral's availability on a pocket cut for a record's settings: null (possible) | 'islands' | 'splits' | another refusal. (The Spiral is never refused.) */
export function morphedBlocker(cut, rec, state) {
  const rings = pocketRings(cut, state);
  if (!rings) return 'outline';
  if (rings.holes.length) return 'islands';
  const plan = planClearing(rings, { ...clearingSettings(rec), pattern: 'morphed' });
  return plan.morphedBlocked || plan.refused || null;
}

/**
 * applyPocketClearing(cuts, rec, state) -> cuts — #core/profile-model deriveProfileCuts' cuts for `rec` with its clearing programmed (unchanged, the SAME
 * array, when clearingPattern(rec) is 'freehand'). The pocket cut becomes the clearing paths as ON-LINE cuts at the record's cut depth, ONCE (TASK 750: no
 * step-downs here: the Origin's Pass Depth; kind 'clearing', the exported `geom`, `centers` = the tool-centre path, `sweep(radius)` = its swept area, `clearing` = { role, index,
 * count, level, depth }), then the finish pass: the outer loop as an INSIDE cut ('interior', the loop itself: the exporter writes its exact lines / arcs)
 * and each island as an OUTSIDE cut ('exterior') (TASK 750: not with Loop on: the finish turns are in the closed loops, and the last loop carries the
 * summary), then (TASK 778) the pocket start mark as a GUIDE element (circle + cross at plan.startPoint; never cut). The wall cut's `clearing.summary` = the
 * plan (counts, length, leftover, swept) for the card, the operations list and the Prepare look. A refused clearing leaves the pocket cut as it is with
 * `clearing` = { role: 'refused', refused, summary }.
 */
export function applyPocketClearing(cuts, rec, state) {
  const pattern = clearingPattern(rec);
  if (pattern === 'freehand' || !Array.isArray(cuts)) return cuts;
  const pocket = cuts.find((c) => c && c.isCompound && c.cutType === 'pocket');
  if (!pocket) return cuts;
  const st = clearingSettings(rec);
  const rings = pocketRings(pocket, state);
  const plan = rings ? planClearing(rings, st) : { pattern, refused: 'outline' };
  const D = rec.cutDepth, depth = Number(D) > 0 ? Number(D) : D; // the clearing paths at the cut depth (a number), ONCE
  const summary = { ...plan, settings: st };
  if (plan.refused) return cuts.map((c) => (c === pocket ? { ...c, clearing: { role: 'refused', refused: plan.refused, summary } } : c));
  const out = plan.clear.map((c, i) => {
    const centers = [{ points: c.points, closed: c.closed }];
    const carries = plan.loop && i === plan.clear.length - 1; // TASK 750: no wall cut: the last loop carries the summary
    return { kind: 'clearing', cutType: 'online', offsetSide: 0, isHole: false, isCompound: false, centers, sweep: sweeper(centers),
      rec: { ...pocket.rec, cutType: 'online', cutDepth: depth, cutOffset: 0 }, geom: { tag: 'path', a: `d="${pathD(c.points, c.closed)}"` },
      clearing: { role: c.role, index: c.index, count: c.count, level: c.level ?? null, depth, ...(c.turnStarts ? { turnStarts: c.turnStarts } : {}), ...(carries ? { summary } : {}) } };
  });
  const markCut = plan.startPoint && st.toolDia > 0 ? (() => {
    const d = startMarkPathD(plan.startPoint, st.toolDia);
    return [{ kind: 'mark', cutType: 'guide', offsetSide: 0, isHole: false, isCompound: false,
      rec: { ...pocket.rec, cutType: 'guide', cutDepth: 'unset', cutOffset: 0 }, geom: { tag: 'path', a: `d="${d}"` },
      clearing: { role: 'start', point: plan.startPoint, dia: st.toolDia * POCKET_CLEARING.startMarkDiaMult, d } }];
  })() : [];
  if (plan.loop) return cuts.flatMap((c) => (c === pocket ? [...out, ...markCut] : [c])); // TASK 750: the wall's and the islands' finish turns are in the closed loops
  const wallCenters = plan.wall.map((pts) => ({ points: pts, closed: true }));
  out.push({ kind: 'loop', loop: pocket.outerLoop, loopId: pocket.outerLoop.id, polygon: pocket.outerPoly, cutType: 'interior', offsetSide: -1, isHole: false, isCompound: false,
    centers: wallCenters, sweep: sweeper(wallCenters), rec: { ...pocket.rec, cutType: 'interior', cutDepth: D }, clearing: { role: 'wall', depth: D, summary } });
  (pocket.holeLoops || []).forEach((hl, i) => {
    const centers = (plan.islands[i] || []).map((pts) => ({ points: pts, closed: true }));
    out.push({ kind: 'loop', loop: hl, loopId: hl.id, polygon: (pocket.holePolys || [])[i], cutType: 'exterior', offsetSide: 1, isHole: true, isCompound: false,
      centers, sweep: sweeper(centers), rec: { ...pocket.rec, cutType: 'exterior', cutDepth: D }, clearing: { role: 'island', index: i + 1, count: pocket.holeLoops.length, depth: D } });
  });
  out.push(...markCut);
  return cuts.flatMap((c) => (c === pocket ? out : [c]));
}
