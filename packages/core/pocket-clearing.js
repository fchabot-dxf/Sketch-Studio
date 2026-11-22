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
//       right, 90 = up / down; an absolute angle, so the card says what the file has; TASK 853: 'auto' resolves per pocket to the long side of the
//       minimum-area bounding rectangle of its outer boundary, keeping 0°/90° when no edge improves the area by > 0.5 %), centred across A0 (the outer margins between s / 2 and s),
//       clipped to A0 (an island cuts a pass into pieces). TASK 835e (owner turn 3153): joined end to end into ONE OPEN ZIGZAG per area of A0
//       (rasterZigzags; AutoPass reverses at its two ends): the area's pieces (THE PIECES below: every pass one chord in each), each line by line,
//       every other chord the other way, the pieces one after the other; between two chords THE JOIN: straight inside the area, or straight to its edge,
//       along it either way round and straight off it, the shortest that crosses no chord and no join so far (never outside A0: a straight join is tested
//       against the area itself, so it never passes a concave wall, where the clean-up ring runs); none: another open path; THE crossing check then
//       splits a path where a join still touches across (a run along the wall another join took). (Before 835e: one open path per pass.) Its sweep (the
//       leftover) counts its passes, the clean-up ring and the finish (its joins only add). Then ONE clean-up ring = the contours of A0 (ring 0 of THE
//       RINGS, as CAM does), which removes the scalloped pass ends.
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
//  * FINISH PASS (Loop off; TASK 835e: and Raster with Loop on, finishInLoop), last: the pocket's own outer loop as the Origin's INSIDE cut (the wall is exact with whatever bit is in the machine; the
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
//     - Raster (TASK 835, owner turns 2990-2996: a loop that CUTS BOTH WAYS, no long air run, the start in the middle; ZERO crossings; TASK 835d, the
//       owner's drawing on 835c's bow-tie (turn 3150: "Why not like this") and turn 3160 ("the only time we force 2 loops is if the bit actually doesn't
//       pass")): per area of A0 ONE closed path (an area = a part of the region the bit's centre reaches: separate areas only where the bit cannot pass).
//       TASK 835e (owner turn 3168): the finish is the Origin's native INSIDE / OUTSIDE cut (FINISH PASS above, finishInLoop), not ring paths: the wall
//       exact for whatever bit is in the machine. Built in three steps, one general rule each (nothing in it knows a shape):
//       (1) THE PIECES: regions of the area in each of which every pass line is ONE chord, cut PERPENDICULAR to the passes. A CHANNEL = the gaps between
//       two neighbouring chords of a line, continued over the next lines while they overlap (the notch between a bow-tie's wings, a U's arms, round an
//       island); where a channel CLOSES (the next line is one chord across it) the area is cut along the line perpendicular to the passes through the
//       middle of the channel's last gap, from that next line to the area's edge (only that stretch of the line; one cut where two channels meet the same
//       stretch); the same again inside each piece that still has a line of two chords (a few rounds at most).
//       (2) Per piece THE SERPENTINE + LANE: the strips between its consecutive pass lines (and the margins beyond its first / last line), one cell each,
//       alternate HELD / BAY; the comb = the held cells and, in every bay, its part within TURN-IN along the passes of its edge on the LANE side (and 0.05
//       mm round that edge, so a stretch of it along the passes still joins). The comb's boundary, walked once, is the owner's loop: a serpentine over the
//       passes (each pass once; the hairpins on the other side run along the wall or the cut), its turns on the lane side turn-in short of the lane, and
//       the return LANE along the clearing's edge on that side (r + the allowance from the wall). TURN-IN = a stepover, at most a bit radius: every point
//       between a turn and the lane then lies within a bit radius of the path (the worst, beside a held strip, (t^2 + s^2 / 4) / 2t from it for t =
//       turn-in, is at most r while t <= r). THE LANE SIDE: the side (the passes' low-u ends or their high-u ends) more of whose ends lie on the wall (not
//       on a cut); a tie: the straighter (the smaller sum of the steps between neighbouring ends along the passes); a tie: the high-u ends. TASK 835e
//       (owner ruling 2): two pieces never both run their lane along the SAME cut: the one whose other side lies more on the wall takes that side.
//       (3) THE LINKS: the pieces' combs joined into ONE region with no hole by a link across a cut of a spanning tree of the pieces (from the piece nearest
//       the area's middle; two pieces are neighbours where they face each other across a cut). Across a cut some pass line crosses (half a stepover clear
//       of its ends) the two pieces ALTERNATE (one holds the strip below each line at the cut, the other the strip above: no stretch of the cut walked
//       twice) and link at the line nearest the cut's middle: the cut's sliver beside the first one's strip over half a stepover, and the corner of the
//       other one's bay beside it (half a stepover along the line and below it) up to its strip: the loop crosses the cut twice, half a stepover apart
//       (out and back through the same passage on opposite sides; it runs over that bay corner, which may be cut already: the owner accepts air on a link
//       where there is no room); the other piece's pass loses half a stepover there (the bit sweeps it, as a corridor's gap). Across a shorter cut the two
//       hold the SAME strips and link by the sliver beside a strip both hold. The boundary of one region with no hole crosses nothing, by construction;
//       THE CROSSING RULE (strayCrossings, TASK 835e) still runs over all the paths. The loop's link stretches are turns of kind 'link'.
//       The SEAM (the first point, the start mark: the plunge) is a pass point near the area's middle (its centroid when that lies two stepovers inside it,
//       else the point of its deepest inset nearest the centroid); of the seams near it and both ways round, the one with the shortest CLOSING STRETCH (from
//       the last point on the area's edge back to the seam). TASK 835e (owner ruling 1): THE CLOSING LEG (closingLeg): where the loop would end over
//       floor already cleared (the bit's disc inside what it swept before and what the finish cuts after), it ends instead with a straight leg from the
//       last point that still cuts back to its start, inside the area, over floor it has already swept, and shorter than the stretch it replaces by half
//       a stepover at least; a turn of kind 'close', the ONE place a crossing is allowed (THE CROSSING RULE, strayCrossings). (Measured: on the serpentine
//       the closing stretch runs back along the start's own pass, so a leg pays a little only where the loop ends through a link: WORK-LOG TURN 835e.)
//       No clean-up ring. WHY NOT "out on the odd passes, back on the even ones" (the advisor's first sketch, 835): an odd pass joined at both
//       ends closes the strip it bounds on that side, so an even pass lies in a bay with ONE mouth and the way back would have to come out the way it went
//       in; 804b's loop failed because its turns ran ON the wall and the return retraced them (here the turns stop turn-in short of the lane). Refused
//       ('loop cross', cut as the open zigzag + the wall; the note says so) only where no loop keeps THE CROSSING RULE; a pass in no area: 'raster
//       join'. (Measured: WORK-LOG TURNS 835, 835b, 835c, 835d, 835e.)
//     - Morphed spiral: the spiral as it is (the gap between neighbouring turns stays the stepover), then the finish turn (a step of the allowance out
//       from where the closing turn ends and back), then the RETURN leg straight down the chain of turn starts (each step one stepover, along the chain
//       of nearest points every turn starts on) to the first point. Chosen over two interleaved arms at twice the pitch: the spiral's geometry is
//       unchanged (Loop off and on cut the same turns), the return leg is short (about the pocket's inset half-width) and crosses each turn once.
//  * LEFTOVER (never hidden): the part of R the bit does not sweep (the swept area of every clearing path at the record's bit radius + the finish
//    pass), ignoring slivers thinner than 2 x sliverMm (the offsets' rounding); reported when over leftoverTolMm2, with how much of it the bit cannot
//    reach at all (sharp inside corners, necks narrower than the bit: R minus R opened by r) and how much the pattern missed (a stepover too big).
//  * START MARK (TASK 778): every programmed pocket (Spiral, Raster,
//    Morphed; Loop on AND off) returns `startPoint` = the first point the bit cuts in the clearing route (Spiral / Morphed: the middle of the innermost
//    ring's longest edge; Raster: the start of the first pass, TASK 835 Loop on: the first loop's seam (near the area's middle); always ON the route, never on an island; Loop off: the route's start end). Written into
//    the exported SVG as a GUIDE (circle + cross, startMarkDiaMult x bit diameter across, never cut) and drawn in Prepare / Export 2D / Export 3D from
//    the same derivation.
//  * The clearing paths depend on the record's bit diameter (written as toolDia on every path); the finish pass does not.
import { offsetRegions, sweepPaths, clipOpenPaths, regionsArea, regionsFromRings, diffRegions, unionRegions, intersectRegions } from './plot/clip.js';
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
  /** raster angle, degrees (record field `rasterAngle`): 'auto' (long side of the pocket's minimum-area bounding rectangle) or a number (0 fallback for legacy records) */
  rasterAngle: Object.freeze({ default: 'auto', fallback: 0, min: 0, max: 180 }),
  /** the feed the card's time estimate assumes (mm per minute: a steady hand-guided pace on the Origin) */
  feedMmPerMin: 1000,
  /** uncut area (mm²) at or below this is not reported; slivers thinner than 2 x sliverMm (mm) are the offsets' rounding, not uncut material */
  leftoverTolMm2: 0.1,
  sliverMm: 0.01,
  /** arcs sampled / rounded at this chord sagitta (mm); paths simplified to this deviation (mm) */
  chordTolMm: 0.005,
  pathTolMm: 0.01,
  /** TASK 856: morphed spiral sampling bounds (mm) and corner-band width (in stepovers). Near vertices (`cornerMult * s`) and on short/curved segments
   *  sample at `h = clamp(s / 10, minMm, maxMm)`; along long straight interiors use `max(h, straightMm)` so per-ring work is O(1) while staying <= 0.02 mm Hausdorff. */
  morphedSample: Object.freeze({ minMm: 0.02, maxMm: 0.5, straightMm: 0.3, cornerMult: 2.5 }),
  /** a safety bound on the number of rings */
  maxRings: 2000,
  /** TASK 778: pocket start mark target (circle + cross) total span = startMarkDiaMult x bit diameter; circle diameter = startMarkCircleRatio of that */
  startMarkDiaMult: 2,
  startMarkCircleRatio: 0.6,
});
const PATTERNS = new Set(['linked', 'raster', 'morphed']);
/** TASK 835e / TASK 850 (owner turns 3166-3169: every programmed pattern with Loop on or off uses the Origin's native Inside / Outside finish cut): WHERE a
 *  programmed pocket's FINISH is written, in ONE place. Always false (never inside the clearing loop): the pocket's outer loop is written as an INSIDE cut and
 *  each island's as an OUTSIDE cut (the wall exact for whatever bit is in the machine, an offset settable at the Origin). */
export const finishInLoop = (_pattern, _loop) => false;
/** TASK 835e (owner, 2026-11-21: a closed On line path that CROSSES itself still cuts as a loop with AutoPass; Studio follows an On line path exactly): THE
 *  CROSSING RULE of the programmed paths, in ONE place. #core/path-crossings counts every crossing; one is ALLOWED only on a stretch declared as a CLOSING
 *  LEG (a turn of kind 'close': a straight leg back to its loop's start over floor the same depth pass has already swept, built by closingLeg); everywhere
 *  else every path stays crossing-free. `paths` = [{ points, closed, turns? }]; returns the crossings that break the rule ([] = it holds). */
export function strayCrossings(paths) {
  const legs = paths.map((c) => (c.turns || []).filter((t) => t.kind === 'close').flatMap((t) => c.points.slice(t.start, t.end).map((q, i) => [q, c.points[t.start + i + 1]])));
  return pathCrossings(paths).crossings.filter((x) => ![x.a, x.b].some((k) => legs[k].some(([q, w]) => distToSeg(x.at, q, w).d <= 0.01)));
}
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
  const rawAngle = rec && rec.rasterAngle;
  const angle = rawAngle === 'auto' ? 'auto' : (Number.isFinite(Number(rawAngle)) && rawAngle !== null && rawAngle !== '' ? Number(rawAngle) : POCKET_CLEARING.rasterAngle.fallback);
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
/** TASK 853: Auto raster angle (degrees in [0, 180), ON SCREEN CCW from +X): the long side of the minimum-area bounding rectangle of `outer`
 *  (closed [[x,y],...] ring or {x,y}[] points), falling back to 0° / 90° when no hull edge beats the axis-aligned box by > 0.5 % (circles, regular polygons). */
export function autoRasterAngle(outer) {
  const raw = (Array.isArray(outer) ? outer : []).map((q) => (Array.isArray(q) ? [q[0], q[1]] : [q.x, q.y]));
  if (raw.length > 1 && Math.hypot(raw[0][0] - raw[raw.length - 1][0], raw[0][1] - raw[raw.length - 1][1]) < 1e-9) raw.pop();
  if (raw.length < 3) return POCKET_CLEARING.rasterAngle.fallback;
  const sorted = raw.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], hi = [];
  for (const pt of sorted) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], pt) <= 0) lo.pop(); lo.push(pt); }
  for (let i = sorted.length - 1; i >= 0; i--) { const pt = sorted[i]; while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], pt) <= 0) hi.pop(); hi.push(pt); }
  const hull = [...lo.slice(0, -1), ...hi.slice(0, -1)];
  if (hull.length < 3) return POCKET_CLEARING.rasterAngle.fallback;
  const boxAt = (ux, uy) => {
    const nx = -uy, ny = ux;
    let u0 = Infinity, u1 = -Infinity, n0 = Infinity, n1 = -Infinity;
    for (const [x, y] of hull) {
      const u = x * ux + y * uy, n = x * nx + y * ny;
      if (u < u0) u0 = u; if (u > u1) u1 = u;
      if (n < n0) n0 = n; if (n > n1) n1 = n;
    }
    return { w: u1 - u0, h: n1 - n0, area: (u1 - u0) * (n1 - n0) };
  };
  const b0 = boxAt(1, 0);
  const axisAngle = b0.h > b0.w + 1e-6 ? 90 : 0;
  let best = null;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
    if (L < 1e-9) continue;
    const ux = dx / L, uy = dy / L, nx = -uy, ny = ux, box = boxAt(ux, uy);
    const lx = box.w >= box.h - 1e-6 ? ux : nx, ly = box.w >= box.h - 1e-6 ? uy : ny;
    let deg = ((Math.atan2(-ly, lx) * 180) / Math.PI % 180 + 180) % 180;
    deg = Math.round(deg * 1e4) / 1e4;
    if (deg >= 180) deg = 0;
    if (!best || box.area < best.area - 1e-9 || (Math.abs(box.area - best.area) <= 1e-9 && deg < best.angle)) best = { area: box.area, angle: deg };
  }
  return !best || best.area >= b0.area * (1 - 0.005) ? axisAngle : best.angle;
}

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

// ── the morphed spiral (see THE RULES; TASK 856: O(K) linear streaming + straight-edge sampling + non-accumulating propagate) ──
// Measured cause of pre-856 O(K^4) time / O(K^3) memory: propagate appended all outer samples onto inner segments (`|S_k| = sum_{j<=k} D_j`) and
// stacked zero-length corner holds into single segGrid cells (14,891 segments in one cell at 40 rings), while densify shrunk h with s/10 along straight edges.
function densifyAdaptive(pts, h, margin, hCoarse) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy);
    if (L <= 2 * margin + hCoarse) {
      const n = Math.max(1, Math.ceil(L / h));
      for (let k = 0; k < n; k++) out.push(P(a.x + (dx * k) / n, a.y + (dy * k) / n));
    } else {
      const ux = dx / L, uy = dy / L, nEdge = Math.ceil(margin / h);
      for (let k = 0; k < nEdge; k++) { const d = (margin * k) / nEdge; out.push(P(a.x + ux * d, a.y + uy * d)); }
      const midL = L - 2 * margin, nMid = Math.max(1, Math.ceil(midL / hCoarse));
      for (let k = 0; k < nMid; k++) { const d = margin + (midL * k) / nMid; out.push(P(a.x + ux * d, a.y + uy * d)); }
      for (let k = 0; k < nEdge; k++) { const d = L - margin + (margin * k) / nEdge; out.push(P(a.x + ux * d, a.y + uy * d)); }
    }
  }
  return out;
}
function byLengthFlat(pts) {
  const L = pathLength(pts, true), n = pts.length + 1;
  const px = new Float64Array(n), py = new Float64Array(n), phi = new Float64Array(n);
  let acc = 0;
  for (let i = 0; i < pts.length; i++) {
    if (i) acc += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    px[i] = pts[i].x; py[i] = pts[i].y; phi[i] = acc / L;
  }
  px[n - 1] = pts[0].x; py[n - 1] = pts[0].y; phi[n - 1] = 1;
  return { n, px, py, phi };
}
function makeOuterQueryFlat(S, cell) {
  const m = S.n - 1, { px, py, phi } = S;
  const vx = new Float64Array(m), vy = new Float64Array(m), L2arr = new Float64Array(m);
  let gMinX = Infinity, gMaxX = -Infinity, gMinY = Infinity, gMaxY = -Infinity;
  const map = new Map(), key = (i, j) => (i * 73856093) ^ (j * 19349663);
  for (let i = 0; i < m; i++) {
    const x1 = px[i], y1 = py[i], x2 = px[i + 1], y2 = py[i + 1], dx = x2 - x1, dy = y2 - y1;
    vx[i] = dx; vy[i] = dy; L2arr[i] = dx * dx + dy * dy;
    const x0 = Math.floor(Math.min(x1, x2) / cell), gx1 = Math.floor(Math.max(x1, x2) / cell);
    const y0 = Math.floor(Math.min(y1, y2) / cell), gy1 = Math.floor(Math.max(y1, y2) / cell);
    if (x0 < gMinX) gMinX = x0; if (gx1 > gMaxX) gMaxX = gx1;
    if (y0 < gMinY) gMinY = y0; if (gy1 > gMaxY) gMaxY = gy1;
    for (let x = x0; x <= gx1; x++) for (let y = y0; y <= gy1; y++) { const k = key(x, y); let c = map.get(k); if (!c) { c = []; map.set(k, c); } c.push(i); }
  }
  const seen = new Int32Array(m);
  let stamp = 0;
  return (qx, qy) => {
    for (let R = cell; ; R *= 2) {
      let bestI = -1, bestT = 0, bestD2 = Infinity;
      const x0 = Math.max(gMinX, Math.floor((qx - R) / cell)), x1 = Math.min(gMaxX, Math.floor((qx + R) / cell));
      const y0 = Math.max(gMinY, Math.floor((qy - R) / cell)), y1 = Math.min(gMaxY, Math.floor((qy + R) / cell));
      if ((x1 - x0 + 1) * (y1 - y0 + 1) > m) {
        for (let i = 0; i < m; i++) {
          const L2 = L2arr[i], t = L2 > 0 ? Math.max(0, Math.min(1, ((qx - px[i]) * vx[i] + (qy - py[i]) * vy[i]) / L2)) : 0;
          const dx = qx - px[i] - t * vx[i], dy = qy - py[i] - t * vy[i], d2 = dx * dx + dy * dy;
          if (d2 < bestD2) { bestD2 = d2; bestI = i; bestT = t; }
        }
        return phi[bestI] + (phi[bestI + 1] - phi[bestI]) * bestT;
      }
      stamp++;
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
        const bucket = map.get(key(x, y));
        if (!bucket) continue;
        for (let bi = 0; bi < bucket.length; bi++) {
          const i = bucket[bi];
          if (seen[i] === stamp) continue;
          seen[i] = stamp;
          const L2 = L2arr[i], t = L2 > 0 ? Math.max(0, Math.min(1, ((qx - px[i]) * vx[i] + (qy - py[i]) * vy[i]) / L2)) : 0;
          const dx = qx - px[i] - t * vx[i], dy = qy - py[i] - t * vy[i], d2 = dx * dx + dy * dy;
          if (d2 < bestD2) { bestD2 = d2; bestI = i; bestT = t; }
        }
      }
      if ((bestI >= 0 && bestD2 <= R * R) || R > 1e6) return phi[bestI] + (phi[bestI + 1] - phi[bestI]) * bestT;
    }
  };
}
const WRAP_BACK = 0.1;
function propagateFlat(inner, outer, h, s) {
  const query = makeOuterQueryFlat(outer, Math.max(s * 1.5, h * 4));
  const n = inner.length, raw = new Float64Array(n), ph = new Float64Array(n);
  for (let j = 0; j < n; j++) raw[j] = query(inner[j].x, inner[j].y);
  for (let j = 0; j < n; j++) {
    const v = raw[j];
    if (!j) { ph[0] = v % 1; continue; }
    let x = v + Math.round(ph[j - 1] - v);
    if (x < ph[j - 1] - WRAP_BACK) x += 1;
    if (x < ph[j - 1]) x = ph[j - 1];
    ph[j] = x;
  }
  let last = raw[0] + Math.round(ph[n - 1] - raw[0]);
  if (last < ph[n - 1]) last += 1;
  if (Math.abs(last - ph[0] - 1) > 0.25) return null;
  const oN = outer.n, oPx = outer.px, oPy = outer.py, oPhi = outer.phi;
  const firstAbove = (v) => { let lo = 0, hi = oN; while (lo < hi) { const m = (lo + hi) >> 1; if (oPhi[m] <= v) lo = m + 1; else hi = m; } return lo; };
  const sx = [], sy = [], sp = [], isInn = [];
  // Collapse stacked zero-length corner holds (p == p == p) and collinear non-inner outer projections so S never grows cumulatively across rings
  const pushPt = (x, y, phi, innFlag) => {
    while (sx.length >= 2) {
      const k1 = sx.length - 1, k2 = sx.length - 2;
      if (sx[k2] === sx[k1] && sy[k2] === sy[k1] && sx[k1] === x && sy[k1] === y) { sx.pop(); sy.pop(); sp.pop(); isInn.pop(); continue; }
      if (!isInn[k1]) {
        const dx = x - sx[k2], dy = y - sy[k2], L2 = dx * dx + dy * dy, dphi = phi - sp[k2];
        if (L2 > 0 && dphi > 0) {
          const bx = sx[k1] - sx[k2], by = sy[k1] - sy[k2], u = (bx * dx + by * dy) / L2;
          if (u >= 0 && u <= 1 && (bx * dy - by * dx) ** 2 / L2 <= 1e-22 && Math.abs(sp[k1] - (sp[k2] + u * dphi)) <= 1e-11) {
            sx.pop(); sy.pop(); sp.pop(); isInn.pop(); continue;
          }
        }
      }
      break;
    }
    sx.push(x); sy.push(y); sp.push(phi); isInn.push(innFlag);
  };
  for (let j = 0; j < n; j++) {
    const a = ph[j], b = j + 1 < n ? ph[j + 1] : last, q = inner[j], qn = inner[(j + 1) % n];
    pushPt(q.x, q.y, a, 1);
    const vx = qn.x - q.x, vy = qn.y - q.y, L2 = vx * vx + vy * vy;
    for (let m = Math.floor(a); m <= Math.floor(b); m++) {
      for (let i = firstAbove(a - m); i < oN && oPhi[i] + m < b; i++) {
        if (oPhi[i] + m <= a) continue;
        const t = L2 > 0 ? Math.max(0, Math.min(1, ((oPx[i] - q.x) * vx + (oPy[i] - q.y) * vy) / L2)) : 0;
        pushPt(q.x + vx * t, q.y + vy * t, oPhi[i] + m, 0);
      }
    }
  }
  pushPt(inner[0].x, inner[0].y, last, 1);
  const c = Math.ceil(ph[0] - 1e-12), span = last - ph[0], mLen = sx.length, extLen = mLen * 2 - 1;
  const xAt = (idx) => (idx < mLen ? sx[idx] : sx[idx - mLen + 1]);
  const yAt = (idx) => (idx < mLen ? sy[idx] : sy[idx - mLen + 1]);
  const phiExt = (idx) => (idx < mLen ? sp[idx] : sp[idx - mLen + 1] + span);
  const cross = (v) => {
    for (let i = 0; i < extLen - 1; i++) {
      const ap = phiExt(i), bp = phiExt(i + 1);
      if (ap <= v && bp >= v) {
        const ax = xAt(i), ay = yAt(i), bx = xAt(i + 1), by = yAt(i + 1);
        const t = bp > ap ? (v - ap) / (bp - ap) : 0;
        return { i, x: ax + (bx - ax) * t, y: ay + (by - ay) * t };
      }
    }
    return null;
  };
  const s0 = cross(c), s1 = cross(c + 1);
  if (!s0 || !s1) return null;
  let cnt = 2;
  for (let i = s0.i + 1; i <= s1.i; i++) { const p = phiExt(i); if (p > c && p < c + 1) cnt++; }
  const outX = new Float64Array(cnt), outY = new Float64Array(cnt), outPhi = new Float64Array(cnt);
  outX[0] = s0.x; outY[0] = s0.y; outPhi[0] = 0;
  let w = 1;
  for (let i = s0.i + 1; i <= s1.i; i++) { const p = phiExt(i); if (p > c && p < c + 1) { outX[w] = xAt(i); outY[w] = yAt(i); outPhi[w] = p - c; w++; } }
  outX[w] = s1.x; outY[w] = s1.y; outPhi[w] = 1;
  return { n: cnt, px: outX, py: outY, phi: outPhi };
}
function ringAtFlat(S, phi, first = false) {
  let lo = 0, hi = S.n - 1;
  const sp = S.phi;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (first ? sp[m] < phi : sp[m] <= phi) lo = m; else hi = m; }
  if (first && sp[hi] === phi) return { x: S.px[hi], y: S.py[hi] };
  const pa = sp[lo], pb = sp[hi];
  const t = pb > pa ? Math.max(0, Math.min(1, (phi - pa) / (pb - pa))) : 0;
  return { x: S.px[lo] + (S.px[hi] - S.px[lo]) * t, y: S.py[lo] + (S.py[hi] - S.py[lo]) * t };
}
const CAP = Math.SQRT2, ARM = 2;
const depthOf = (l) => (l <= CAP ? l : l >= ARM ? 1 : CAP - ((CAP - 1) * (l - CAP)) / (ARM - CAP));
function transitionFlat(inner, outer, s) {
  const nI = inner.n, nO = outer.n, out = [];
  let i = 0, j = 0;
  while (i < nI || j < nO) {
    let phi, ax, ay, bx, by;
    if (j >= nO || (i < nI && inner.phi[i] <= outer.phi[j])) {
      phi = inner.phi[i]; ax = inner.px[i]; ay = inner.py[i]; i++;
      const B = ringAtFlat(outer, phi, true); bx = B.x; by = B.y;
    } else {
      phi = outer.phi[j]; bx = outer.px[j]; by = outer.py[j]; j++;
      const A = ringAtFlat(inner, phi, false); ax = A.x; ay = A.y;
    }
    const L = Math.hypot(ax - bx, ay - by), k = L <= CAP * s ? 1 - phi : ((1 - phi) * depthOf(L / s) * s) / L;
    out.push(P(bx + k * (ax - bx), by + k * (ay - by)));
  }
  return out;
}
/** The morphed spiral through `rings` (outermost first, one closed loop each, open {x,y}[]) for a stepover s: { points, turns: [start index of each
 *  turn in points] } (an open path: the central loop, a turn per ring out, the closing turn along rings[0]), or null. */
export function morphedSpiral(rings, s, opts = null) {
  if (!rings.length) return null;
  const MS = POCKET_CLEARING.morphedSample;
  const h = Math.min(MS.maxMm, Math.max(MS.minMm, s / 10)), margin = s * MS.cornerMult, hCoarse = Math.max(h, MS.straightMm);
  const R0 = rings.map(positive);
  const nearestOnPoly = (poly, p) => {
    let best = null;
    for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length], f = distToSeg(p, a, b); if (!best || f.d < best.d) best = { i, t: f.t, d: f.d, p: P(a.x + (b.x - a.x) * f.t, a.y + (b.y - a.y) * f.t) }; }
    return best;
  };
  let c;
  if (opts && opts.endOnOuter) {
    c = opts.endOnOuter;
  } else {
    const inn = R0[R0.length - 1];
    if (opts && opts.seedFrom) {
      c = nearestOnPoly(inn, opts.seedFrom).p;
    } else {
      let li = 0;
      const segL = (o, i) => Math.hypot(o[(i + 1) % o.length].x - o[i].x, o[(i + 1) % o.length].y - o[i].y);
      for (let i = 1; i < inn.length; i++) if (segL(inn, i) > segL(inn, li)) li = i;
      c = P((inn[li].x + inn[(li + 1) % inn.length].x) / 2, (inn[li].y + inn[(li + 1) % inn.length].y) / 2);
    }
    for (let k = R0.length - 2; k >= 0; k--) c = nearestOnPoly(R0[k], c).p;
  }
  const o = R0[0], at = nearestOnPoly(o, c);
  const start = [at.p, ...o.slice(at.i + 1), ...o.slice(0, at.i + 1)];
  const tol = POCKET_CLEARING.pathTolMm;
  const toPts = (S) => { const a = new Array(S.n); for (let i = 0; i < S.n; i++) a[i] = P(S.px[i], S.py[i]); return a; };
  // Stream outer -> inner keeping only adjacent ring pair (prev, curr) in memory and simplifying each transition turn on the fly
  let prev = byLengthFlat(densifyAdaptive(start, h, margin, hCoarse));
  const closingTurn = rings.length > 1 ? simplifyPath(toPts(prev), tol) : null;
  const revTurns = [];
  for (let k = 1; k < rings.length; k++) {
    const curr = propagateFlat(densifyAdaptive(R0[k], h, margin, hCoarse), prev, h, s);
    if (!curr) return null;
    revTurns.push(simplifyPath(transitionFlat(curr, prev, s), tol));
    prev = curr;
  }
  const turns = [simplifyPath(toPts(prev), tol)];
  for (let i = revTurns.length - 1; i >= 0; i--) turns.push(revTurns[i]);
  if (closingTurn) turns.push(closingTurn);
  const points = [], starts = [];
  for (const t of turns) {
    starts.push(points.length ? points.length - 1 : 0);
    for (const p of points.length ? t.slice(1) : t) points.push(p);
  }
  return { points, turns: starts };
}

// ── TASK 750 / TASK 850: the LOOP (see THE RULES): ONE closed loop per area of A0 (first point == last point) ──
const same = (p, q) => Math.hypot(p.x - q.x, p.y - q.y) < 1e-9;
// a loop being built: its points, its turns ([{ start, end, kind }]: pts[start..end] is a turn / pass / ring: 'ring' | 'pass' | 'cleanup' | 'morphed' |
// 'link' | 'close'), the length of its legs (links, steps: the rest) and the turns its legs cross
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

// TASK 850: arc-length distance along a closed contour `pts` from `at` to `target` in direction +1
function arcPosAlong(pts, at, target) {
  const n = pts.length;
  const distToEnd = (i, t) => (1 - t) * Math.hypot(pts[(i + 1) % n].x - pts[i].x, pts[(i + 1) % n].y - pts[i].y);
  if (target.i === at.i && target.t >= at.t - 1e-9) {
    return (target.t - at.t) * Math.hypot(pts[(at.i + 1) % n].x - pts[at.i].x, pts[(at.i + 1) % n].y - pts[at.i].y);
  }
  let L = distToEnd(at.i, at.t);
  for (let k = (at.i + 1) % n; k !== target.i; k = (k + 1) % n) L += distToEnd(k, 0);
  L += target.t * Math.hypot(pts[(target.i + 1) % n].x - pts[target.i].x, pts[(target.i + 1) % n].y - pts[target.i].y);
  return L;
}
function walkSegmentForward(pts, from, to) {
  const n = pts.length, out = [from.p];
  if (!(from.i === to.i && to.t >= from.t - 1e-9)) {
    for (let j = (from.i + 1) % n; ; j = (j + 1) % n) { out.push(pts[j]); if (j === to.i) break; }
  }
  out.push(to.p);
  return out.filter((q, j) => j === 0 || !same(q, out[j - 1]));
}
// Walk closed ring `pts` once around from `startAt` back to `startAt`, visiting sorted side-branch detours `[{ at, fn }]` along the way
function walkRingWithDetours(b, pts, startAt, detours, kind = 'ring') {
  const ordered = detours.map((d) => ({ ...d, s: arcPosAlong(pts, startAt, d.at) })).sort((x, y) => x.s - y.s);
  let cur = startAt;
  for (const d of ordered) {
    b.turn(walkSegmentForward(pts, cur, d.at), kind);
    d.fn(b, d.at.p);
    cur = d.at;
  }
  const n = pts.length, rest = [cur.p];
  if (!ordered.length || !(cur.i === startAt.i && startAt.t > cur.t + 1e-9)) {
    for (let j = (cur.i + 1) % n; ; j = (j + 1) % n) { rest.push(pts[j]); if (j === startAt.i) break; }
  }
  rest.push(startAt.p);
  b.turn(rest.filter((q, j) => j === 0 || !same(q, rest[j - 1])), kind);
}
// TASK 850: append a declared closing return leg (turn kind 'close') from `fromPt` to `toPt`, straight when inside area `g` and over floor already swept by
// `b`, else pulled tight along `chainPts` (the anchor chain from `toPt` out to `fromPt`)
function appendCloseLeg(b, fromPt, toPt, chainPts, g, r) {
  const inG = offsetRegions([g], 0.01);
  const near = [fromPt, ...(chainPts || []), toPt], m = 2 * r + 0.2;
  const bx = [Math.min(...near.map((q) => q.x)) - m, Math.min(...near.map((q) => q.y)) - m, Math.max(...near.map((q) => q.x)) + m, Math.max(...near.map((q) => q.y)) + m];
  const inBox = (u, v) => Math.max(u.x, v.x) >= bx[0] && Math.min(u.x, v.x) <= bx[2] && Math.max(u.y, v.y) >= bx[1] && Math.min(u.y, v.y) <= bx[3];
  const local = [];
  for (let i = 0; i + 1 < b.pts.length; i++) if (inBox(b.pts[i], b.pts[i + 1])) {
    const last = local[local.length - 1];
    if (last && last.end === i) { last.points.push([b.pts[i + 1].x, b.pts[i + 1].y]); last.end = i + 1; }
    else local.push({ points: [[b.pts[i].x, b.pts[i].y], [b.pts[i + 1].x, b.pts[i + 1].y]], closed: false, end: i + 1 });
  }
  const sweptBefore = local.length ? sweepPaths(local.map(({ points }) => ({ points, closed: false })), r, POCKET_CLEARING.chordTolMm) : [];
  const fitsBefore = offsetRegions(sweptBefore, -(r - 0.02), POCKET_CLEARING.chordTolMm);
  const safeSeg = (a, z) => {
    if (!insideSeg(a, z, inG)) return false;
    const L = Math.hypot(z.x - a.x, z.y - a.y), n = Math.max(2, Math.ceil(L / 0.25));
    for (let k = 1; k < n; k++) {
      const p = P(a.x + ((z.x - a.x) * k) / n, a.y + ((z.y - a.y) * k) / n);
      if (!fitsBefore.some((reg) => inRegion(p, reg))) return false;
    }
    return true;
  };
  let path = [fromPt, toPt];
  if (!safeSeg(fromPt, toPt) && chainPts && chainPts.length >= 2) {
    const raw = [fromPt, ...chainPts.slice().reverse(), toPt].filter((q, i, l) => i === 0 || !same(q, l[i - 1]));
    const short = [raw[0]];
    for (let i = 0; i < raw.length - 1;) {
      let next = i + 1;
      for (let j = raw.length - 1; j > i + 1; j--) if (safeSeg(raw[i], raw[j])) { next = j; break; }
      short.push(raw[next]);
      i = next;
    }
    path = short;
  }
  const len = pathLength(path, false);
  b.legs += len;
  b.turn([b.last(), ...path.slice(1)], 'close');
}
// Shorten the end of an open morphed polyline by `trimMm` (interpolating on the segment so a long straight edge is never popped whole), avoiding tangential
// overlap with the previous turn where the closing leg turns inward
function trimMorphedEnd(pts, minIdx = 2, trimMm = 0.25) {
  const out = pts.slice();
  let rem = trimMm;
  while (out.length > minIdx + 1 && rem > 1e-9) {
    const a = out[out.length - 2], b = out[out.length - 1], L = Math.hypot(b.x - a.x, b.y - a.y);
    if (L <= rem + 1e-9) { rem -= L; out.pop(); }
    else { const t = (L - rem) / L; out[out.length - 1] = P(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t); rem = 0; }
  }
  return out;
}

/** TASK 850: Spiral + Loop = ONE closed loop per area of A0 (L[0]). Every ring contour in the area (outer contours and island hole contours across L[0..K])
 *  is cut once in order at the normal stepover s (inside out along the area's deepest stem; side branches entered from their parent ring, cut in order to
 *  their leaf, and returned to the parent ring by a declared 'close' leg over already-swept floor), then closed back to the stem's start by a declared 'close'
 *  leg over already-swept floor. Checked with strayCrossings (0 crossings outside 'close' legs). */
function spiralLoops(L, r, s) {
  if (!L.length) return [];
  const loopsOut = [];
  for (const g0 of L[0]) {
    const outerNodes = L.map((E, k) => E.filter((reg) => (k === 0 ? reg === g0 : inRegion(P(reg.outer[0][0], reg.outer[0][1]), g0))).map((reg) => ({
      k, kind: 'outer', g: reg, pts: positive(toXY(reg.outer)), children: [], parent: null, depth: 1, area: regionsArea([reg]),
    })));
    for (let k = 1; k < L.length; k++) for (const u of outerNodes[k]) {
      const par = outerNodes[k - 1].find((m) => inRegion(u.pts[0], m.g)) || outerNodes[k - 1][0];
      u.parent = par; par.children.push({ child: u });
    }
    const holeNodes = L.map((_, k) => outerNodes[k].flatMap((on) => on.g.holes.map((h) => ({
      k, kind: 'hole', host: on, g: on.g, pts: positive(toXY(h)), children: [], parent: null, depth: 1, area: Math.abs(signedArea(toXY(h))),
    })).filter((hn) => hn.pts.length >= 3)));
    for (let k = L.length - 1; k >= 0; k--) for (const h of holeNodes[k]) {
      const up = k + 1 < L.length ? holeNodes[k + 1].find((H) => containsPt(H.pts, h.pts[0]) && !containsPt(h.pts, H.pts[0])) : null;
      if (up) { h.parent = up; up.children.push({ child: h }); continue; }
      const reg = h.host.g, regClear = diffRegions([reg], (h.host.children || []).map((c) => c.child.g)), regIn = offsetRegions(regClear, 0.005);
      let best = null;
      const step = Math.max(1, Math.floor(h.pts.length / 24));
      for (let i = 0; i < h.pts.length; i += step) {
        const q = h.pts[i], f = nearestOnLoop(h.host.pts, q);
        if ((!best || f.d < best.d) && insideSeg(q, f.p, regIn)) best = { atParent: f, atChild: { i, t: 0, p: q }, d: f.d, parent: h.host, regIn };
      }
      if (!best && h.host.children.length) {
        const fullIn = offsetRegions([reg], 0.005);
        for (const c of h.host.children) for (let i = 0; i < h.pts.length; i += step) {
          const q = h.pts[i], f = nearestOnLoop(c.child.pts, q);
          if ((!best || f.d < best.d) && insideSeg(q, f.p, fullIn)) best = { atParent: f, atChild: { i, t: 0, p: q }, d: f.d, parent: c.child, regIn: fullIn };
        }
      }
      if (!best) { const q = h.pts[0], f = nearestOnLoop(h.host.pts, q); best = { atParent: f, atChild: { i: 0, t: 0, p: q }, d: f.d, parent: h.host, regIn }; }
      h.parent = best.parent; best.parent.children.push({ child: h, edgeHint: best });
    }
    const allNodes = [...outerNodes.flat(), ...holeNodes.flat()];
    const computeDepth = (u) => { u.depth = u.children.length ? 1 + Math.max(...u.children.map((c) => computeDepth(c.child))) : 1; return u.depth; };
    const root = outerNodes[0][0];
    computeDepth(root);
    const depthToRoot = (u) => { let d = 0; for (let p = u; p; p = p.parent) d++; return d; };
    const startLeaf = allNodes.filter((u) => !u.children.length).sort((x, y) => {
      const dx = depthToRoot(x), dy = depthToRoot(y);
      return dy !== dx ? dy - dx : x.kind !== y.kind ? (x.kind === 'outer' ? -1 : 1) : y.area - x.area;
    })[0];
    const stemSet = new Set(), stemPath = [];
    for (let u = startLeaf; u; u = u.parent) { stemSet.add(u); stemPath.push(u); }

    const b = loopBuilder();
    b.cutStep = s;
    const pStart = ringStart(startLeaf.pts);
    const cutBranch = (edge, parentExitPt, returnTarget, bObj, anchorChain) => {
      const u = edge.child, enterAt = edge.edgeHint ? edge.edgeHint.atChild : nearestOnLoop(u.pts, parentExitPt);
      bObj.leg([enterAt.p]);
      const chainNow = [...anchorChain, enterAt.p];
      const kids = u.children.slice().sort((x, y) => y.child.depth - x.child.depth || y.child.area - x.child.area);
      const mainEdge = kids[0] || null, sideEdges = kids.slice(1);
      const detours = sideEdges.map((se) => ({
        at: se.edgeHint ? se.edgeHint.atParent : nearestOnLoop(u.pts, ringStart(se.child.pts).p),
        fn: (bb, pOnU) => cutBranch(se, pOnU, pOnU, bb, [pOnU]),
      }));
      walkRingWithDetours(bObj, u.pts, enterAt, detours, 'ring');
      if (mainEdge) cutBranch(mainEdge, enterAt.p, returnTarget, bObj, chainNow);
      else appendCloseLeg(bObj, bObj.last(), returnTarget, chainNow, g0, r);
    };

    let curEnter = pStart;
    const stemAnchors = [pStart.p];
    for (let idx = 0; idx < stemPath.length; idx++) {
      const u = stemPath[idx];
      if (idx > 0) {
        const prev = stemPath[idx - 1], viaEdge = u.children.find((c) => c.child === prev), f = nearestOnLoop(u.pts, curEnter.p);
        curEnter = viaEdge && viaEdge.edgeHint && !insideSeg(curEnter.p, f.p, viaEdge.edgeHint.regIn) ? viaEdge.edgeHint.atParent : f;
        b.leg([curEnter.p]);
        stemAnchors.push(curEnter.p);
      }
      const detours = u.children.filter((c) => !stemSet.has(c.child)).map((se) => ({
        at: se.edgeHint ? se.edgeHint.atParent : nearestOnLoop(u.pts, ringStart(se.child.pts).p),
        fn: (bb, pOnU) => cutBranch(se, pOnU, pOnU, bb, [pOnU]),
      }));
      walkRingWithDetours(b, u.pts, curEnter, detours, 'ring');
    }
    appendCloseLeg(b, b.last(), pStart.p, stemAnchors, g0, r);
    loopsOut.push(b);
  }
  return strayCrossings(loopsOut.map((b) => ({ points: b.pts, closed: true, turns: b.turns }))).length ? null : loopsOut;
}

/** TASK 850: Morphed + Loop = ONE closed loop per area of A0 (L[0]), joining the area's morphed segments at the normal stepover s and closing with declared
 *  'close' leg(s) over already-swept floor. Checked with strayCrossings (0 crossings outside 'close' legs). */
function morphedLoops(L, r, s, allChains, allSps) {
  if (!L.length) return [];
  const loopsOut = [];
  for (const g0 of L[0]) {
    const singleArea = L[0].length === 1;
    const chains = singleArea ? allChains : ringSegments(L.map((E, k) => E.filter((reg) => (k === 0 ? reg === g0 : inRegion(P(reg.outer[0][0], reg.outer[0][1]), g0)))));
    const segNodes = chains.map((ch, idx) => {
      const rings = ch.map((n) => positive(toXY(n.g.outer)));
      const sp = singleArea ? allSps[idx] : morphedSpiral(rings, s);
      if (!sp) return null;
      return {
        ch, rings, sp,
        kTop: ch[0].k, kBot: ch[ch.length - 1].k,
        gTop: ch[0].g, gBot: ch[ch.length - 1].g,
        outerRing: rings[0], innerRing: rings[rings.length - 1],
        children: [], parent: null, depth: 1, area: regionsArea([ch[0].g]),
      };
    });
    if (segNodes.some((x) => !x)) return null;
    for (const u of segNodes) {
      if (u.kTop === 0) continue;
      const par = segNodes.find((m) => m.kBot === u.kTop - 1 && inRegion(u.outerRing[0], m.gBot));
      u.parent = par; par.children.push({ child: u });
    }
    const rootSeg = segNodes.find((u) => u.kTop === 0);
    const computeDepth = (u) => { u.depth = u.ch.length + (u.children.length ? Math.max(...u.children.map((c) => computeDepth(c.child))) : 0); return u.depth; };
    computeDepth(rootSeg);
    const startLeaf = segNodes[0];
    const stemSet = new Set(), stemPath = [];
    for (let u = startLeaf; u; u = u.parent) { stemSet.add(u); stemPath.push(u); }

    for (let idx = 1; idx < stemPath.length; idx++) {
      const u = stemPath[idx], prev = stemPath[idx - 1];
      if (nearestOnLoop(prev.outerRing, u.sp.points[0]).d > s + 0.1) {
        const spSeeded = morphedSpiral(u.rings, s, { seedFrom: prev.sp.points[prev.sp.points.length - 1] });
        if (spSeeded && !pathCrossings([{ points: spSeeded.points, closed: false }]).count) u.sp = spSeeded;
      }
    }
    for (let idx = stemPath.length - 1; idx >= 1; idx--) {
      const u = stemPath[idx], prev = stemPath[idx - 1];
      const targetEnd = nearestOnLoop(prev.outerRing, u.sp.points[0]).p;
      if (Math.hypot(prev.sp.points[prev.sp.points.length - 1].x - targetEnd.x, prev.sp.points[prev.sp.points.length - 1].y - targetEnd.y) > 0.05) {
        const spAligned = morphedSpiral(prev.rings, s, { endOnOuter: targetEnd });
        if (spAligned && !pathCrossings([{ points: spAligned.points, closed: false }]).count) prev.sp = spAligned;
      }
    }

    const b = loopBuilder();
    b.cutStep = s;
    const pStart = startLeaf.sp.points[0];
    const cutMorphedBranch = (u, returnTarget, bObj, anchorChain) => {
      const sp = u.sp, uEnd = sp.points[sp.points.length - 1];
      bObj.leg([uEnd]);
      const chainNow = [...anchorChain, ...sp.turns.map((idx) => sp.points[idx]).reverse()];
      const kids = u.children.slice().sort((x, y) => y.child.depth - x.child.depth || y.child.area - x.child.area);
      const mainEdge = kids[0] || null, sideEdges = kids.slice(1);
      if (!kids.length) {
        bObj.turn(trimMorphedEnd(sp.points.slice().reverse(), 2), 'morphed');
        appendCloseLeg(bObj, bObj.last(), returnTarget, chainNow, g0, r);
        return;
      }
      if (u.rings.length > 1) bObj.turn(sp.points.slice(sp.turns[1]).reverse(), 'morphed');
      const enterInnerAt = nearestOnLoop(u.innerRing, bObj.last());
      const detours = sideEdges.map((se) => ({
        at: nearestOnLoop(u.innerRing, se.child.sp.points[se.child.sp.points.length - 1]),
        fn: (bb, pOnU) => cutMorphedBranch(se.child, pOnU, bb, [pOnU]),
      }));
      walkRingWithDetours(bObj, u.innerRing, enterInnerAt, detours, 'morphed');
      if (mainEdge) cutMorphedBranch(mainEdge.child, returnTarget, bObj, chainNow);
      else appendCloseLeg(bObj, bObj.last(), returnTarget, chainNow, g0, r);
    };

    const stemAnchors = [];
    for (let idx = 0; idx < stemPath.length; idx++) {
      const u = stemPath[idx], isLastStem = idx === stemPath.length - 1;
      if (idx === 0) {
        const pts = isLastStem ? trimMorphedEnd(u.sp.points, u.sp.turns.at(-1) + 2) : u.sp.points;
        b.turn(pts, 'morphed');
        for (const tIdx of u.sp.turns) if (tIdx < pts.length) stemAnchors.push(pts[tIdx]);
      } else {
        const uStartAt = nearestOnLoop(u.innerRing, u.sp.points[0]);
        b.leg([uStartAt.p]);
        stemAnchors.push(uStartAt.p);
        const detours = u.children.filter((c) => !stemSet.has(c.child)).map((se) => ({
          at: nearestOnLoop(u.innerRing, se.child.sp.points[se.child.sp.points.length - 1]),
          fn: (bb, pOnU) => cutMorphedBranch(se.child, pOnU, bb, [pOnU]),
        }));
        walkRingWithDetours(b, u.innerRing, uStartAt, detours, 'morphed');
        if (u.rings.length > 1) {
          const rawRest = u.sp.points.slice(u.sp.turns[1]);
          b.turn(isLastStem ? trimMorphedEnd(rawRest, 2) : rawRest, 'morphed');
          for (const tIdx of u.sp.turns.slice(1)) if (tIdx < u.sp.points.length) stemAnchors.push(u.sp.points[tIdx]);
        }
      }
    }
    appendCloseLeg(b, b.last(), pStart, stemAnchors, g0, r);
    loopsOut.push(b);
  }
  return strayCrossings(loopsOut.map((b) => ({ points: b.pts, closed: true, turns: b.turns }))).length ? null : loopsOut;
}

/** TASK 835 / 835d / 835e: THE RASTER'S LOOP (see THE RULES): per area of A0 ONE closed path that CUTS BOTH WAYS: its PIECES (every pass one chord in each),
 *  each a serpentine over its passes + a return lane along one side, joined by links; it starts on its pass nearest the area's middle and may end with a
 *  closing leg (closingLeg; `after` = what the finish sweeps after it); THE CROSSING RULE (strayCrossings). The finish is the Origin's native cut (not
 *  here). `Rr` (R inset by r) tells where the area's edge is. { loops: [builder], refused: null | 'raster join' | 'loop cross' } */
function rasterLoops(A0, pieces, Rr, s, r, a, angleDeg, after) {
  const rings = Rr.map((G) => [G.outer, ...G.holes].map(toXY)); // per region of Rr: its wall ring, then its islands' rings
  const near = a + 0.01; // a point of the area's edge lies the allowance from a ring (+ the offsets' rounding)
  const th = (angleDeg * Math.PI) / 180, U = P(Math.cos(th), -Math.sin(th)), N = P(-U.y, U.x); // the passes' frame (as rasterPasses)
  const frame = { uOf: (p) => p.x * U.x + p.y * U.y, nOf: (p) => p.x * N.x + p.y * N.y, at: (u, n) => P(U.x * u + N.x * n, U.y * u + N.y * n), N };
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
  const cleanup = (g) => [g.outer, ...g.holes].map(toXY).filter((q) => q.length >= 3).map((pts) => { const b = loopBuilder(); b.turn(loopFrom(pts, ringStart(pts)), 'cleanup'); return b; });
  const out = [];
  let last = null;
  for (const [gk, g] of A0.entries()) {
    const pcs = pieces.filter((_, i) => inArea[i] === gk);
    if (!pcs.length) { if (a > 0) out.push(...cleanup(g)); continue; } // an area no pass reaches: its contours are its clean-up rings (no allowance: the native finish cuts it)
    const gi = holding(Rr, pcs[0]); // the region of Rr round the area
    if (gi < 0) return { loops: [], refused: 'loop cross' };
    const centre = areaCentre(g, s), parts = monotonePieces(g, pcs, frame, s).filter((pt) => pt.pcs.length);
    // the pieces' parities: ALTERNATING across a cut a pass line crosses (joinPieces), the SAME across a shorter one: set piece by piece through the cuts
    // (breadth first), both overall flips tried, the shorter loop kept
    const lineN = (k) => pcs[0].offset + (k - pcs[0].line) * s, allLines = [...new Set(pcs.map((p) => p.line))];
    const crossed = (cut) => { const n = cut.seg.map(frame.nOf), lo = Math.min(...n), hi = Math.max(...n); return allLines.some((k) => lineN(k) - s / 2 > lo + 0.005 && lineN(k) + 0.01 < hi - 0.005); };
    const colour = parts.map(() => -1), cutOf = (i, j) => sharedCut(parts, i, j, frame);
    parts.forEach((_, i0) => {
      if (colour[i0] >= 0) return;
      colour[i0] = 0;
      for (const queue = [i0]; queue.length;) { const i = queue.shift(); parts.forEach((_, j) => { const c = j !== i && colour[j] < 0 && cutOf(i, j); if (c) { colour[j] = crossed(c) ? 1 - colour[i] : colour[i]; queue.push(j); } }); }
    });
    // the lanes: each piece's own side (laneOf), except that two pieces never both run their lane along the SAME cut (TASK 835e, owner ruling 2: no cut
    // run twice): then the one whose other side lies more on the wall takes that side
    const lanes = parts.map((pt) => laneOf(pt, s, frame));
    parts.forEach((_, i) => parts.forEach((_, j) => {
      if (j <= i || !lanes[i].cut || lanes[i].cut !== lanes[j].cut) return;
      const k = lanes[i].otherWall >= lanes[j].otherWall ? i : j;
      lanes[k] = laneOf(parts[k], s, frame, 1 - lanes[k].lane);
    }));
    let best = null;
    for (const flip of [0, 1]) {
      const combs = parts.map((pt, i) => laneComb(pt, (colour[i] + flip) % 2, s, r, frame, lanes[i].lane));
      if (combs.some((c) => !c)) continue;
      const J = joinPieces(parts, combs, centre, s, frame), T = J ? J.T : null;
      if (!T) continue;
      const near5 = J.links.length ? offsetRegions(unionRegions(...J.links), 0.005) : [], linkAt = (p) => near5.some((x) => inRegion(p, x)); // (its links' stretches: kind 'link')
      const b = combLoop({ pts: toXY(T.outer), centre }, { rowOf: rowOfArea(pcs, s, frame), w: s }, rings[gi], near, s, linkAt);
      if (!b || pathCrossings([{ points: b.pts, closed: true }]).count) continue;
      const length = pathLength(b.pts, false);
      if (!best || length < best.length) best = { b, length };
    }
    if (!best) return { loops: [], refused: 'loop cross' }; // no loop that crosses nothing: refused, never cut crossing
    out.push(closingLeg(best.b, g, r, s, after));
    last = best.b.pts[0];
  }
  // TASK 835e: no rings here: the finish is the Origin's native inside / outside cut (finishInLoop); THE CROSSING RULE over all the loops
  if (strayCrossings(out.map((b) => ({ points: b.pts, closed: true, turns: b.turns }))).length) return { loops: [], refused: 'loop cross' };
  return { loops: out, refused: null };
}
// the pass line index a point lies on (within 0.003 mm of it), or null: over an area's passes
function rowOfArea(pcs, s, F) {
  const kmin = Math.min(...pcs.map((p) => p.line)), kmax = Math.max(...pcs.map((p) => p.line)), c0 = pcs[0].offset, l0 = pcs[0].line;
  return (p) => { const k = Math.round((F.nOf(p) - c0) / s) + l0; return k >= kmin && k <= kmax && Math.abs(F.nOf(p) - (c0 + (k - l0) * s)) < 0.003 ? k : null; };
}
// TASK 835d (owner turn 3160: one closed loop per area; "the only time we force 2 loops is if the bit actually doesn't pass"): the pieces' combs JOINED into
// ONE region with no hole (its boundary: ONE closed loop, crossing nothing by construction) by a LINK across each cut of a spanning tree of the pieces (from
// the piece nearest the area's middle, breadth first). Two pieces whose cut is crossed by a pass line (half a stepover clear of its ends) ALTERNATE across
// it (one holds the strip below each line at the cut, the other the strip above: no stretch of the cut walked twice) and link at the line nearest the
// cut's middle: the cut's sliver beside the first one's strip over half a stepover below the line, and the corner of the other one's bay beside it (half a
// stepover along the line, half a stepover below it) up to its strip: the loop crosses the cut twice, half a stepover apart (out and back through the
// same passage on opposite sides), and the second piece's pass loses half a stepover where the link joins it (the bit sweeps it, as a corridor's gap). Two
// pieces whose cut no line crosses (shorter than that) hold the SAME strips and link by the cut's sliver beside a strip both hold (its passes run on
// straight). { T (the region), links (the link regions) }, or null (pieces that no link joins, or a hole)
// TASK 835d: do pieces i and j FACE each other across `cut` at its offset nn (a point just on each side of it in one of them each)
function facingAt(parts, i, j, cut, nn, F) {
  const L = F.at(cut.c - 0.01, nn), R = F.at(cut.c + 0.01, nn);
  return (inRegion(L, parts[i].g) && inRegion(R, parts[j].g)) || (inRegion(L, parts[j].g) && inRegion(R, parts[i].g));
}
// the cut across which pieces i and j face each other somewhere (sampled every 0.1 mm along it), or undefined: their NEIGHBOURHOOD
function sharedCut(parts, i, j, F) {
  return parts[i].cuts.find((c) => { if (!parts[j].cuts.includes(c)) return false; const n = c.seg.map(F.nOf), lo = Math.min(...n), hi = Math.max(...n); for (let t = lo + 0.05; t < hi; t += 0.1) if (facingAt(parts, i, j, c, t, F)) return true; return false; });
}
function joinPieces(parts, combs, centre, s, F) {
  const { uOf, nOf, at } = F, h = s / 2, e = 1e-3;
  const rect = (u0, u1, n0, n1) => regionsFromRings([closedRing([at(Math.min(u0, u1), Math.min(n0, n1)), at(Math.max(u0, u1), Math.min(n0, n1)), at(Math.max(u0, u1), Math.max(n0, n1)), at(Math.min(u0, u1), Math.max(n0, n1))])]);
  if (parts.length === 1) return { T: combs[0].T, links: [] };
  const dist = (i) => Math.min(...toXY(combs[i].T.outer).map((p) => Math.hypot(p.x - centre.x, p.y - centre.y)));
  const root = parts.map((_, i) => i).reduce((m, i) => (dist(i) < dist(m) ? i : m), 0);
  const seen = new Set([root]), links = [];
  for (const queue = [root]; queue.length;) {
    const i = queue.shift();
    parts.forEach((pj, j) => {
      if (seen.has(j)) return;
      const cut = sharedCut(parts, i, j, F);
      if (!cut) return;
      seen.add(j); queue.push(j);
      const n = cut.seg.map(nOf), lo = Math.min(...n), hi = Math.max(...n), mid = (lo + hi) / 2, c = cut.c, A = combs[i], B = combs[j];
      // (a cut may border several pieces on one side, cut again later: the link where these two face each other)
      const facing = (nn) => facingAt(parts, i, j, cut, nn, F);
      if (A.parity === B.parity) { // the same strips: the sliver beside a strip both hold, the one nearest the cut's middle
        const js = [];
        for (let k = Math.floor((lo - A.nOf(A.lines[0])) / s) + A.lines[0] - 1; A.nOf(k) < hi; k++) { const a0 = Math.max(lo, A.nOf(k)) + 0.005, a1 = Math.min(hi, A.nOf(k + 1)) - 0.005; if (a1 > a0 + 0.01 && A.holds(k) && B.holds(k) && facing(a0 + 0.005) && facing(a1 - 0.005)) js.push([a0, a1]); }
        const best = js.sort((x, y) => Math.abs((x[0] + x[1]) / 2 - mid) - Math.abs((y[0] + y[1]) / 2 - mid))[0];
        links.push(best ? rect(c - 10 * e, c + 10 * e, best[0], best[1]) : null);
        return;
      }
      const ks = A.lines.filter((k) => B.lines.includes(k) && A.nOf(k) - h > lo + 0.005 && A.nOf(k) + 0.01 < hi - 0.005 && facing(A.nOf(k) - h + 0.005) && facing(A.nOf(k) + 0.005)).sort((x, y) => Math.abs(A.nOf(x) - mid) - Math.abs(A.nOf(y) - mid));
      if (!ks.length) { links.push(null); return; }
      const k = ks[0], y = A.nOf(k), X = A.holds(k - 1) ? i : j, Y = X === i ? j : i;
      const sy = inRegion(at(c + 0.01, y - h / 2), parts[Y].g) ? 1 : -1; // the side of the cut piece Y lies on, there
      links.push(unionRegions(rect(c - 10 * e, c + 10 * e, y - h, y), intersectRegions(rect(c, c + sy * h, y - h, y + 0.01), [parts[Y].g]))); // (0.01 mm into each piece: the clip grid)
    });
  }
  if (links.some((l) => !l) || seen.size !== parts.length) return null;
  const T = unionRegions(...combs.map((cb) => [cb.T]), ...links);
  return T.length === 1 && !T[0].holes.length ? { T: T[0], links } : null;
}
// TASK 835e (owner ruling 1): THE CLOSING LEG. A loop that would end walking over floor already cleared (its CLOSING STRETCH: every point of it with the
// bit's disc inside what the loop swept before it and what the finish cuts after, `after`) ends instead with a STRAIGHT leg from the last point that still
// cuts back to its start, where that leg lies inside the area `g`, runs over floor the loop has already swept (the bit's disc inside it all along), and is
// shorter than the stretch it replaces (by half a stepover at least). The leg is a turn of kind 'close' and may cross the passes it runs over (THE
// CROSSING RULE, strayCrossings). The loop as it was where no leg pays. (What counts as swept before: the loop up to its last pass, a conservative floor)
function closingLeg(b, g, r, s, after) {
  const pts = b.pts, n = pts.length - 1;
  if (n < 3) return b;
  const arc = [0];
  for (let i = 1; i <= n; i++) arc.push(arc[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  const total = arc[n];
  const pointAt = (L) => { let i = 1; while (i < n && arc[i] < L) i++; const t = arc[i] > arc[i - 1] ? (L - arc[i - 1]) / (arc[i] - arc[i - 1]) : 0; return { i: i - 1, p: P(pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t) }; };
  const lastPass = b.turns.filter((t) => t.kind === 'pass').pop(), win = lastPass ? total - arc[lastPass.start] : 0, cut0 = pointAt(total - win), before = [...pts.slice(0, cut0.i + 1), cut0.p];
  // (swept only near what is tested: the last pass's stretch, the start, and 2 r + 0.1 mm round their box)
  const near = [...pts.slice(cut0.i), pts[0]], m = 2 * r + 0.1, bx = [Math.min(...near.map((q) => q.x)) - m, Math.min(...near.map((q) => q.y)) - m, Math.max(...near.map((q) => q.x)) + m, Math.max(...near.map((q) => q.y)) + m];
  const inBox = (u, v) => Math.max(u.x, v.x) >= bx[0] && Math.min(u.x, v.x) <= bx[2] && Math.max(u.y, v.y) >= bx[1] && Math.min(u.y, v.y) <= bx[3];
  const local = [];
  for (let i = 0; i + 1 < before.length; i++) if (inBox(before[i], before[i + 1])) { const last = local[local.length - 1]; if (last && last.end === i) { last.points.push([before[i + 1].x, before[i + 1].y]); last.end = i + 1; } else local.push({ points: [[before[i].x, before[i].y], [before[i + 1].x, before[i + 1].y]], closed: false, end: i + 1 }); }
  const box = regionsFromRings([closedRing([P(bx[0], bx[1]), P(bx[2], bx[1]), P(bx[2], bx[3]), P(bx[0], bx[3])])]);
  const sweptBefore = local.length ? sweepPaths(local.map(({ points }) => ({ points, closed: false })), r, POCKET_CLEARING.chordTolMm) : [];
  const fits = offsetRegions(unionRegions(sweptBefore, intersectRegions(after, box)), -(r - 0.01), POCKET_CLEARING.chordTolMm), fitsBefore = offsetRegions(sweptBefore, -(r - 0.01), POCKET_CLEARING.chordTolMm);
  const airAt = (q) => fits.some((e) => inRegion(q, e)), overCut = (q) => fitsBefore.some((e) => inRegion(q, e)), h = 0.25; // (the stretch skipped: cut before or by the finish after; the leg: over floor cut before it)
  let e0 = total;
  while (e0 - h > total - win && airAt(pointAt(e0 - h).p)) e0 -= h; // the closing stretch: from e0 to the end, all air
  if (total - e0 < s) return b;
  const S = pts[0], inG = offsetRegions([g], 0.01);
  for (let e = e0; e < total - s; e += 0.5) {
    const E = pointAt(e), L = Math.hypot(S.x - E.p.x, S.y - E.p.y);
    if (L > total - e - s / 2) continue; // it must pay
    const steps = Math.max(1, Math.ceil(L / h));
    let ok = insideSeg(E.p, S, inG);
    for (let k = 1; ok && k < steps; k++) ok = overCut(P(E.p.x + ((S.x - E.p.x) * k) / steps, E.p.y + ((S.y - E.p.y) * k) / steps));
    if (!ok) continue;
    const keep = [...pts.slice(0, E.i + 1)], at = same(keep[keep.length - 1], E.p) ? keep.length - 1 : keep.push(E.p) - 1;
    keep.push(S);
    const turns = b.turns.filter((t) => t.start < at).map((t) => ({ start: t.start, end: Math.min(t.end, at), kind: t.kind })).filter((t) => t.end > t.start);
    turns.push({ start: at, end: at + 1, kind: 'close' });
    const inTurn = new Array(keep.length).fill(false);
    for (const t of turns) for (let i = t.start; i < t.end; i++) inTurn[i] = true;
    const legs = keep.slice(1).reduce((u, q, i) => u + (inTurn[i] ? 0 : Math.hypot(q.x - keep[i].x, q.y - keep[i].y)), 0); // (what is not a turn)
    return { pts: keep, turns, legs, crossings: 0, cutStep: b.cutStep, closing: { from: E.p, saved: total - e - L } };
  }
  return b;
}
// a straight segment inside `regions` (grown by 0.01 mm by the caller: a segment along their edge counts as inside)
function insideSeg(a, b, regions) {
  const L = Math.hypot(b.x - a.x, b.y - a.y);
  if (L < 1e-6) return true;
  return clipOpenPaths([[[a.x, a.y], [b.x, b.y]]], regions).reduce((t, piece) => t + pathLength(piece.map(([x, y]) => P(x, y)), false), 0) >= L - 2e-3;
}
// two segments CROSS properly: each one's ends more than 0.002 mm off the other and on its two sides (a touch, an end on the other, a run along it: no)
function properCross(a, b, c, d) {
  const o = (p, q, w) => (q.x - p.x) * (w.y - p.y) - (q.y - p.y) * (w.x - p.x);
  if ([[a, c, d], [b, c, d], [c, a, b], [d, a, b]].some(([p, q, w]) => distToSeg(p, q, w).d <= 0.002)) return false;
  return o(c, d, a) * o(c, d, b) < 0 && o(a, b, c) * o(a, b, d) < 0;
}
// TASK 835e (owner turn 3153): RASTER WITH LOOP OFF = ONE OPEN ZIGZAG per area of A0 (AutoPass reverses at its two ends): the area's pieces (monotonePieces:
// every pass one chord in each), each line by line, every other chord the other way; the pieces one after the other, each started at whichever of its four
// corners makes the way in from the end so far + the way on from its own end to a piece still left the shortest; between two chords THE JOIN: straight
// inside the area, or straight to the area's edge, along it (either way round) and straight off it, the shortest that crosses no chord and no join so far
// (never outside A0); none: another open path. Then THE crossing check: a join that still crosses (along the wall where another ran) splits its path.
// [{ points, turns ('pass' per chord) }]
function rasterZigzags(A0, pieces, s, angleDeg) {
  const th = (angleDeg * Math.PI) / 180, U = P(Math.cos(th), -Math.sin(th)), N = P(-U.y, U.x);
  const F = { uOf: (p) => p.x * U.x + p.y * U.y, nOf: (p) => p.x * N.x + p.y * N.y, at: (u, n) => P(U.x * u + N.x * n, U.y * u + N.y * n), N };
  const inArea = pieces.map((pc) => { const u = pc.points[0], v = pc.points[pc.points.length - 1]; for (const t of [0.5, 0.25, 0.75, 0.125, 0.875]) { const q = P(u.x + (v.x - u.x) * t, u.y + (v.y - u.y) * t), k = A0.findIndex((g) => inRegion(q, g)); if (k >= 0) return k; } return 0; });
  const out = [];
  for (const [gk, g] of A0.entries()) {
    const pcs = pieces.filter((_, i) => inArea[i] === gk);
    if (!pcs.length) continue;
    const parts = monotonePieces(g, pcs, F, s).filter((pt) => pt.pcs.length), contours = [g.outer, ...g.holes].map(toXY), inG = offsetRegions([g], 0.01);
    const join = (p, q, clean) => { // the shortest way from p to q that `clean` takes: straight (inside the area itself: never past a concave wall, where the
      // clean-up ring runs); or straight to a contour, along it (either way), straight off it (each straight stretch checked only when its turn comes)
      const opts = [{ pts: [p, q], inside: [[p, q, [g]]] }];
      for (const C of contours) {
        const a = nearestOnLoop(C, p), z = nearestOnLoop(C, q), inside = [...(a.d > 0.01 ? [[p, a.p, inG]] : []), ...(z.d > 0.01 ? [[z.p, q, inG]] : [])];
        for (const dir of [1, -1]) opts.push({ pts: [p, ...walkLoop(C, { i: a.i, t: a.t, p: a.p }, { i: z.i, t: z.t, p: z.p }, dir), q].filter((w, k, l) => k === 0 || !same(w, l[k - 1])), inside });
      }
      opts.forEach((o) => { o.L = pathLength(o.pts, false); });
      const found = opts.sort((x, y) => x.L - y.L).find((o) => clean(o.pts) && o.inside.every(([u, v, regs]) => insideSeg(u, v, regs)));
      return found ? found.pts : null;
    };
    // a piece's chords in cutting order for one of its four corners (from its first or last line, from the low-u or the high-u end)
    const chords = parts.map((pt) => { const { span, ks, cOf } = chordsOf(pt, s, F); return ks.map((k) => [F.at(span.get(k)[0], cOf(k)), F.at(span.get(k)[1], cOf(k))]); });
    const orderOf = (i, rev, flip) => (rev ? chords[i].slice().reverse() : chords[i]).map((c, k) => ((k % 2 === 1) !== flip ? [c[1], c[0]] : c));
    const left = new Set(parts.map((_, i) => i));
    let b = null;
    const segs = chords.flat().map((c) => [c[0], c[1]]), first = out.length; // every chord (cut or to come) and every join so far: a new join crosses none of them
    const flushPath = () => { if (b && b.pts.length > 1) out.push({ points: b.pts, turns: b.turns }); b = null; };
    while (left.size) {
      // (the corner: the shortest way in from the end so far, then the shortest way on from its own end to a corner of a piece still left)
      const corners = (i) => [false, true].flatMap((rev) => [false, true].map((flip) => orderOf(i, rev, flip)));
      const onward = (i, q) => Math.min(Infinity, ...[...left].filter((j) => j !== i).flatMap((j) => corners(j).map((sq) => Math.hypot(sq[0][0].x - q.x, sq[0][0].y - q.y))));
      let pick = null;
      for (const i of left) for (const seq of corners(i)) {
        const end = seq[seq.length - 1][1], into = b ? Math.hypot(seq[0][0].x - b.last().x, seq[0][0].y - b.last().y) : 0, on = left.size > 1 ? onward(i, end) : 0;
        const d = b ? into + on : on + (F.nOf(seq[0][0]) + F.uOf(seq[0][0]) * 1e-6) * 1e-9; // (the first: its end nearest another piece; a tie: the lowest corner)
        if (!pick || d < pick.d - 1e-9) pick = { i, seq, d };
      }
      left.delete(pick.i);
      for (const c of pick.seq) {
        if (b) {
          const clean = (w) => w.slice(1).every((q, k) => !segs.some(([a, z]) => properCross(w[k], q, a, z))); // (it crosses no chord and no join so far)
          const j = join(b.last(), c[0], clean);
          if (j) { b.leg(j); j.slice(1).forEach((q, k) => segs.push([j[k], q])); } else flushPath();
        }
        if (!b) b = loopBuilder();
        b.turn(c, 'pass');
      }
    }
    flushPath();
    // THE crossing check over the area's open paths: a join that still crosses (a run along the wall another join took: no proper crossing) is dropped, the
    // path split there
    for (let n = 0; n < 50; n++) {
      const x = pathCrossings(out.slice(first).map((z) => ({ points: z.points, closed: false }))).crossings[0];
      if (!x) break;
      const zi = first + [x.a, x.b].sort((u, v) => v - u)[0], z = out[zi], ts = z.turns.filter((t) => t.kind === 'pass');
      let cut = -1, best = Infinity;
      for (let k = 1; k < ts.length; k++) for (let i = ts[k - 1].end; i < ts[k].start; i++) { const d = distToSeg(x.at, z.points[i], z.points[i + 1]).d; if (d < best) { best = d; cut = k; } }
      if (cut < 0) break;
      const A = ts[cut - 1].end, B = ts[cut].start, shift = (t, o) => ({ start: t.start - o, end: t.end - o, kind: t.kind });
      out.splice(zi, 1, { points: z.points.slice(0, A + 1), turns: z.turns.filter((t) => t.end <= A) }, { points: z.points.slice(B), turns: z.turns.filter((t) => t.start >= B).map((t) => shift(t, B)) });
    }
  }
  return out;
}
// TASK 835: the middle of an area of A0 (a region): its centroid where that lies inside it at least two stepovers from its edge (the bow-tie's neck), else
// the point of its deepest inset nearest the centroid (an annulus, a U whose centroid falls in the gap or next to its edge, a dumbbell's thin neck)
function areaCentre(g, s) {
  const o = toXY(g.outer);
  let A = 0, cx = 0, cy = 0;
  for (const ring of [o, ...g.holes.map(toXY)]) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const f = ring[j].x * ring[i].y - ring[i].x * ring[j].y; A += f; cx += (ring[j].x + ring[i].x) * f; cy += (ring[j].y + ring[i].y) * f; }
  const c = Math.abs(A) > 1e-9 ? P(cx / (3 * A), cy / (3 * A)) : o[0];
  if (inRegion(c, g) && contoursOf([g]).every((l) => nearestOnLoop(l, c).d >= 2 * s)) return c;
  let d = 0, step = Math.max(s, 0.5), last = [g];
  for (let n = 0; n < 60 && step > 0.02; n++) {
    const E = offsetRegions([g], -(d + step), POCKET_CLEARING.chordTolMm);
    if (E.length) { d += step; last = E; } else step /= 2;
  }
  const q = toXY(last.reduce((m, e) => (regionsArea([e]) > regionsArea([m]) ? e : m)).outer); // (round an island: a thin ring)
  return q.reduce((m, p) => (Math.hypot(p.x - c.x, p.y - c.y) < Math.hypot(m.x - c.x, m.y - c.y) ? p : m)); // its point nearest the centroid
}
// TASK 835d (owner's drawing, turn 3150: "Why not like this"): THE PIECES of an area g for its passes `pcs`: regions in each of which every pass line is ONE
// chord, cut PERPENDICULAR to the passes. A CHANNEL = the gaps between two neighbouring chords of a line, continued over the next lines while they overlap
// (the notch between a bow-tie's wings, a U's arms, round an island); where a channel CLOSES (the next line is one chord across it) the area is cut along the
// line perpendicular to the passes through the middle of the channel's last gap, from that next line to the area's edge (only that stretch of the line); the
// same again inside each piece that still has a line of two chords (a few rounds at most). [{ g, pcs (the passes clipped to it), cuts (the cut stretches
// along its edge: { c, seg }) }]
function monotonePieces(g, pcs, F, s, round = 0, cutIds = []) { // (cutIds: the cuts already on its edge)
  const { uOf, nOf, at } = F;
  const c0 = pcs[0].offset, l0 = pcs[0].line, cOf = (k) => c0 + (k - l0) * s;
  const lines = new Map();
  for (const pc of pcs) { const u = [uOf(pc.points[0]), uOf(pc.points[pc.points.length - 1])]; if (!lines.has(pc.line)) lines.set(pc.line, []); lines.get(pc.line).push([Math.min(...u), Math.max(...u)]); }
  for (const v of lines.values()) v.sort((x, y) => x[0] - y[0]);
  const gapsOf = (k) => { const ch = lines.get(k) || []; return ch.slice(1).map((c, i) => [ch[i][1], c[0]]); };
  const ks = [...lines.keys()].sort((x, y) => x - y), cuts = [];
  const o = toXY(g.outer), ns = o.map(nOf), nLo = Math.min(...ns) - 1, nHi = Math.max(...ns) + 1;
  const cutAt = (k, gap, next) => { // the cut through the middle of `gap` (line k) where line `next` is one chord across it
    const c = (gap[0] + gap[1]) / 2;
    if (!(lines.get(next) || []).some(([u0, u1]) => u0 < c && u1 > c)) return;
    const seg = clipOpenPaths([[[at(c, nLo).x, at(c, nLo).y], [at(c, nHi).x, at(c, nHi).y]]], [g]).map((pc) => pc.map(([x, y]) => P(x, y)))
      .find((pc) => { const n = pc.map(nOf); return Math.min(...n) <= cOf(next) + 1e-6 && Math.max(...n) >= cOf(next) - 1e-6; });
    // (one cut per stretch: a channel closed from both ends (the bow-tie's two notches) meets the same stretch twice, its two middles a hair apart)
    if (seg && !cuts.some((q) => Math.abs(q.c - c) < s && Math.min(...q.seg.map(nOf)) < Math.max(...seg.map(nOf)) && Math.max(...q.seg.map(nOf)) > Math.min(...seg.map(nOf)))) cuts.push({ c, seg });
  };
  for (const k of ks) for (const gap of gapsOf(k)) {
    const overlaps = (k2) => gapsOf(k2).some((h) => h[0] < gap[1] && h[1] > gap[0]);
    if (!overlaps(k - 1)) cutAt(k, gap, k - 1); // the channel's end below
    if (!overlaps(k + 1)) cutAt(k, gap, k + 1); // and above
  }
  if (!cuts.length || round >= 4) return [{ g, pcs, cuts: cutIds }];
  const sliver = unionRegions(...cuts.map(({ c, seg }) => { const n = seg.map(nOf); return regionsFromRings([closedRing([at(c - 1e-3, Math.min(...n) - 0.05), at(c + 1e-3, Math.min(...n) - 0.05), at(c + 1e-3, Math.max(...n) + 0.05), at(c - 1e-3, Math.max(...n) + 0.05)])]); }));
  const out = [];
  for (const part of diffRegions([g], sliver).filter((e) => regionsArea([e]) > 1e-3)) {
    const ppcs = [];
    for (const pc of pcs) for (const piece of clipOpenPaths([pc.points.map((p) => [p.x, p.y])], [part])) { const pts = piece.map(([x, y]) => P(x, y)); if (pathLength(pts, false) > 1e-3) ppcs.push({ ...pc, points: uOf(pts[0]) <= uOf(pts[pts.length - 1]) === uOf(pc.points[0]) <= uOf(pc.points[pc.points.length - 1]) ? pts : pts.reverse() }); }
    const mine = [...cutIds, ...cuts.filter((c) => contoursOf([part]).some((l) => c.seg.some((q) => nearestOnLoop(l, q).d < 0.01)))];
    if (!ppcs.length) { out.push({ g: part, pcs: [], cuts: mine }); continue; }
    ppcs.sort((x, y) => x.line - y.line);
    out.push(...monotonePieces(part, ppcs, F, s, round + 1, mine).map((q) => ({ ...q, cuts: [...new Set([...mine, ...q.cuts])] })));
  }
  return out;
}
// TASK 835d: THE SERPENTINE + LANE of one piece (every pass line one chord): the STRIPS between its consecutive pass lines (and the margins beyond its first /
// last line), each one CELL, alternate (`parity`: the strips whose line index is even (0) / odd (1) are HELD, the others BAYS); the comb = the held cells and,
// in every bay, its part within a stepover (at most a bit radius) ALONG THE PASSES of its edge on the LANE side (the corridor: all of them one band along
// that side). Its boundary, walked once, IS the owner's loop: every pass once (a held strip's two passes and the hairpin at the other side:
// the serpentine, its turns on the lane side a stepover short of the lane), then back along the lane (the clearing's edge on that side, r + the allowance
// from the wall). THE LANE SIDE: the side (the passes' low-u ends or their high-u ends) more of whose ends lie on the area's wall (not on a cut); a tie: the
// straighter (the smaller sum of the steps between neighbouring ends along the passes); a tie: the high-u ends (laneOf; `lane` given). { T (the comb), lines
// (its pass line indices), nOf (a line's offset), holds (a strip index: held?), lane } or null (not one region with no hole)
// a piece's chords per pass line: Map(line -> [low u, high u]), its lines in order, and a line's offset
function chordsOf(pt, s, F) {
  const pcs = [...pt.pcs].sort((x, y) => x.line - y.line), c0 = pcs[0].offset, l0 = pcs[0].line, span = new Map();
  for (const pc of pcs) { const u = [F.uOf(pc.points[0]), F.uOf(pc.points[pc.points.length - 1])], q = span.get(pc.line); span.set(pc.line, q ? [Math.min(q[0], ...u), Math.max(q[1], ...u)] : [Math.min(...u), Math.max(...u)]); }
  return { span, ks: [...span.keys()].sort((x, y) => x - y), cOf: (j) => c0 + (j - l0) * s, pcs };
}
// TASK 835d / 835e: THE LANE SIDE of a piece (0: the passes' low-u ends, 1: their high-u ends; `force`: that one): the side more of whose ends lie on the wall
// (not on a cut); a tie: the straighter (the smaller sum of the steps between neighbouring ends along the passes); a tie: the high-u ends. { lane, cut (the
// cut half or more of the lane side's ends lie on, or null), otherWall (how many ends of the other side lie on the wall) }
function laneOf(pt, s, F, force = null) {
  const { span, ks, cOf } = chordsOf(pt, s, F), cutAt = (q) => pt.cuts.find((c) => distToSeg(q, c.seg[0], c.seg[c.seg.length - 1]).d < 0.01) || null;
  const score = (side) => {
    const e = ks.map((k) => F.at(span.get(k)[side], cOf(k))), on = e.map(cutAt);
    let walk = 0;
    for (let i = 1; i < e.length; i++) walk += Math.abs(F.uOf(e[i]) - F.uOf(e[i - 1]));
    const most = [...new Set(on.filter(Boolean))].map((c) => [c, on.filter((x) => x === c).length]).sort((x, y) => y[1] - x[1])[0];
    return { wall: on.filter((c) => !c).length, walk, cut: most && most[1] * 2 >= e.length ? most[0] : null };
  };
  const sc = [score(0), score(1)];
  const lane = force !== null ? force : sc[0].wall !== sc[1].wall ? (sc[0].wall > sc[1].wall ? 0 : 1) : sc[0].walk < sc[1].walk - 1e-6 ? 0 : 1;
  return { lane, cut: sc[lane].cut, otherWall: sc[1 - lane].wall };
}
function laneComb(pt, parity, s, r, F, lane) {
  const { uOf, nOf, at } = F, g = pt.g, { span, ks, cOf, pcs } = chordsOf(pt, s, F);
  const kmin = pcs[0].line, kmax = pcs[pcs.length - 1].line;
  const o = toXY(g.outer), us = o.map(uOf), ns = o.map(nOf);
  const uLo = Math.min(...us) - 1, uHi = Math.max(...us) + 1, nLo = Math.min(...ns) - 1, nHi = Math.max(...ns) + 1;
  const rect = (u0, u1, n0, n1) => regionsFromRings([closedRing([at(u0, n0), at(u1, n0), at(u1, n1), at(u0, n1)])]);
  const holds = (j) => (((j + parity) % 2) + 2) % 2 === 0;
  const cells = [];
  for (let j = kmin - 1; j <= kmax; j++) {
    const n0 = j < kmin ? nLo : cOf(j), n1 = j >= kmax ? nHi : cOf(j + 1);
    for (const e of intersectRegions([g], rect(uLo, uHi, n0, n1))) if (regionsArea([e]) > 1e-3) cells.push({ j, g: e, held: holds(j) });
  }
  // the turns stand a stepover in from the lane, at most a bit radius (then every point between a turn and the lane lies within a bit radius of the path:
  // the worst one, beside a held strip, (t^2 + s^2 / 4) / 2t from it for t = turnIn, is at most r while t <= r)
  const turnIn = Math.min(s, r);
  const corridors = cells.filter((c) => !c.held && span.has(c.j) && span.has(c.j + 1)).map((c) => {
    // the bay's part within `turnIn` ALONG THE PASSES of its edge on the lane side (the chain of its contour between its two passes, on that side; and
    // 0.05 mm round that edge, so a stretch of it running along the passes still joins): its two passes end turnIn short of the lane and join along that
    // edge moved turnIn in (the turn); it reaches a hair into the held cells on both sides (one region)
    // (its contour's edges that do not lie along one of its two pass lines, in runs: its two side chains)
    const n0 = cOf(c.j), n1 = cOf(c.j + 1), q = toXY(c.g.outer), m = q.length;
    const onPass = (i) => { const p = q[i], r2 = q[(i + 1) % m]; return [n0, n1].some((n) => Math.abs(nOf(p) - n) < 0.003 && Math.abs(nOf(r2) - n) < 0.003); };
    const i0 = [...Array(m).keys()].find((i) => onPass(i) && !onPass((i + 1) % m));
    if (i0 === undefined) return [];
    const sides = [];
    for (let k = 1; k <= m; k++) { const i = (i0 + k) % m; if (onPass(i)) continue; if (onPass((i - 1 + m) % m)) sides.push([q[i]]); sides[sides.length - 1].push(q[(i + 1) % m]); }
    if (!sides.length) return [];
    const meanU = (ch) => ch.reduce((t, p) => t + uOf(p), 0) / ch.length;
    const edge = sides.reduce((m, ch) => ((lane ? meanU(ch) > meanU(m) : meanU(ch) < meanU(m)) ? ch : m));
    const nearCells = unionRegions(...cells.filter((x) => x.j >= c.j - 1 && x.j <= c.j + 1).map((x) => [x.g]));
    // (that edge swept `turnIn` along the passes, toward the piece: each of its segments with the copy of it turnIn in, a parallelogram)
    const ins = (p) => at(uOf(p) + (lane ? -turnIn : turnIn), nOf(p)), toward = Math.sign(nOf(edge[edge.length - 1]) - nOf(edge[0])) * 0.01;
    edge.unshift(at(uOf(edge[0]), nOf(edge[0]) - toward)); edge.push(at(uOf(edge[edge.length - 1]), nOf(edge[edge.length - 1]) + toward)); // a hair into the held cells
    return intersectRegions(nearCells, unionRegions(...edge.slice(1).map((q, i) => regionsFromRings([closedRing([edge[i], q, ins(q), ins(edge[i])])])),
      sweepPaths([{ points: edge.map((p) => [p.x, p.y]), closed: false }], 0.05, POCKET_CLEARING.chordTolMm))); // (and 0.05 mm round it: a stretch of it along the passes has no width swept along them)
  });
  const T = unionRegions(...cells.filter((c) => c.held).map((c) => [c.g]), ...corridors);
  if (T.length !== 1 || T[0].holes.length) return null;
  return { T: T[0], lines: ks, nOf: cOf, holds, lane, parity };
}
// TASK 835: the closed loop round a comb (835d: an area's joined pieces), from its SEAM: a point of a pass near the area's middle (its pass point nearest it, and
// the corners where a pass meets a leg within two stepovers of that, a stepover inside the clearing). The way back to the seam ends on the pass cut
// LAST: of those seams and both ways round, the one whose CLOSING STRETCH (from the last point on the area's edge back to the seam) is SHORTEST
// is taken (a tie: the nearest the middle). A builder, or null (a comb with no pass)
function combLoop(cl, comb, rs, near, s, linkAt = null) {
  const rowAt = (pts, i) => { const k = comb.rowOf(pts[i]); return k !== null && k === comb.rowOf(pts[(i + 1) % pts.length]); };
  const base = cl.pts, nb = base.length, centre = cl.centre, edge = base.map((p) => rs.some((H) => nearestOnLoop(H, p).d <= near)); // on the area's edge
  let p0 = null;
  base.forEach((p, i) => { if (rowAt(base, i)) { const q = base[(i + 1) % nb], f = distToSeg(centre, p, q); if (!p0 || f.d < p0.d - 1e-9) p0 = { i, d: f.d, p: P(p.x + (q.x - p.x) * f.t, p.y + (q.y - p.y) * f.t) }; } });
  if (!p0) return null;
  const cands = [{ i: p0.i, p: p0.p, d: p0.d, inside: true }]; // inside: a point within segment i -> i + 1
  base.forEach((p, i) => { const d = Math.hypot(p.x - centre.x, p.y - centre.y); if (!edge[i] && (rowAt(base, i) || rowAt(base, (i - 1 + nb) % nb)) && d <= p0.d + 2 * s + comb.w && rs.every((H) => nearestOnLoop(H, p).d >= near + s - 0.01)) cands.push({ i, p, d }); }); // (TASK 835d: a stepover inside the clearing)
  let pick = null;
  for (const c of cands) for (const dir of [1, -1]) {
    const ring = []; // the loop from c round in direction dir: [{ p, edge }] (c first)
    for (let k = c.inside ? 1 : 0; k < nb + (c.inside ? 1 : 0); k++) { const j = (c.i + k) % nb; ring.push({ p: base[j], edge: edge[j] }); }
    const fwd = c.inside ? [{ p: c.p, edge: false }, ...ring] : ring;
    const seq = (dir > 0 ? fwd : [fwd[0], ...fwd.slice(1).reverse()]).filter((x, k, l) => k === 0 || !same(x.p, l[k - 1].p));
    if (same(seq[seq.length - 1].p, seq[0].p)) seq.pop();
    let close = 0;
    for (let j = seq.length - 1; j >= 0; j--) { const q = seq[(j + 1) % seq.length].p; close += Math.hypot(seq[j].p.x - q.x, seq[j].p.y - q.y); if (seq[j].edge) break; }
    if (!pick || close < pick.close - 1e-6 || (Math.abs(close - pick.close) <= 1e-6 && c.d < pick.d - 1e-9)) pick = { close, d: c.d, seq };
  }
  const pts = pick.seq.map((x) => x.p), n = pts.length;
  const items = []; // the loop's items: its passes (on a pass line), TASK 835d its links (`linkAt` holds the middle of the stretch) and the legs between
  let run = [pts[0]], kind = null;
  const flush = () => { if (run.length > 1) items.push(kind === 'link' ? { kind: 'link', pts: run } : kind !== null ? { kind: 'pass', pts: run } : { kind: null, pts: items.length ? run.slice(1) : run }); run = [run[run.length - 1]]; }; // (a first leg keeps the seam)
  for (let i = 0; i < n; i++) {
    const a = pts[i], q = pts[(i + 1) % n], row = comb.rowOf(a) !== null && comb.rowOf(a) === comb.rowOf(q) ? comb.rowOf(a) : null;
    const k = row === null && linkAt && linkAt(P((a.x + q.x) / 2, (a.y + q.y) / 2)) ? 'link' : row;
    if (run.length > 1 && k !== kind) flush();
    kind = k; run.push(pts[(i + 1) % n]);
  }
  flush();
  return assemble(items);
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
// the items ({ kind: a turn's kind | null (a leg), pts }) as a closed loop (loopBuilder)
function assemble(items) {
  const b = loopBuilder();
  for (const it of items) if (it.kind) b.turn(it.pts, it.kind); else b.leg(it.pts);
  return b;
}

// ── the plan of one pocket (memoised: the same loops + settings give the same plan) ──
const MEMO = new Map(), MEMO_MAX = 48;
/**
 * planClearing({ outer, holes }, settings) -> the clearing of a pocket region (THE RULES), independent of depth:
 *   { pattern, clear: [{ points, closed, role: 'linked' | 'raster' | 'cleanup' | 'morphed', level?, index, count }] (in cutting order; a Spiral line also
 *     carries its rings: [{ level, start, end, finish }] and
 *     links: [from], see linkedSpiral); TASK 750 / 850 Loop on: clear = the closed loops [{ points (first == last), closed: true, role: 'loop', index, count }],
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
  let clear = [], levels = 0, loops = 0, lines = 0, linesWhy = null, passes = 0, cleanup = 0, turns = 0, morphedBlocked = null, passLines = null, rasterAngle = null;
  const needRings = pattern === 'linked' || pattern === 'morphed';
  const L = needRings ? ringLevels(R, d0, s) : [];
  if (needRings) {
    morphedBlocked = holes.length ? 'islands' : null; // TASK 804: a pocket whose rings split is morphed per area (one spiral per chain)
    levels = L.length;
    loops = L.reduce((n, E) => n + contoursOf(E).length, 0);
  }
  const Rr = st.loop && pattern === 'raster' ? offsetRegions(R, -r, POCKET_CLEARING.chordTolMm) : [];
  let built = null, loopRefused = null; // the closed loops (loopBuilder) when Loop is on
  if (pattern === 'linked') {
    const ls = linkedSpiral(L.map(contoursOf));
    lines = ls.length;
    linesWhy = lines > 1 ? (holes.length ? 'islands' : 'splits') : null;
    ls.forEach((ln, i) => clear.push({ points: ln.points, closed: false, role: 'linked', index: i + 1, count: ls.length,
      rings: ln.rings.map((g) => ({ ...g, finish: false })), links: ln.links }));
    if (st.loop && L.length) { // TASK 850: ONE closed loop per area of A0 (the rings in order at normal stepover + declared closing return leg(s) over swept floor)
      built = spiralLoops(L, r, s);
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
    if (st.loop && sps.length) { // TASK 850: ONE closed loop per area of A0 (the area's morphed segments joined + declared closing return leg(s) over swept floor)
      built = morphedLoops(L, r, s, chains, sps);
      if (!built) loopRefused = 'loop cross';
      else linesWhy = built.length > 1 ? 'splits' : null;
    }
  } else if (pattern === 'raster') {
    rasterAngle = st.angle === 'auto' ? autoRasterAngle(outer) : st.angle;
    const A0 = offsetRegions(R, -d0, POCKET_CLEARING.chordTolMm);
    const pieces = A0.length ? rasterPasses(A0, s, rasterAngle) : [];
    passes = pieces.length;
    passLines = pieces.map((l) => ({ points: l.points, offset: l.offset }));
    // TASK 835e: the passes as ONE open zigzag per area (rasterZigzags), its chords 'pass' turns
    const zz = A0.length ? rasterZigzags(A0, pieces, s, rasterAngle) : [];
    zz.forEach((z, i) => clear.push({ points: z.points, closed: false, role: 'raster', index: i + 1, count: zz.length, turns: z.turns }));
    const ring0 = contoursOf(A0);
    cleanup = ring0.length;
    ring0.forEach((pts, i) => clear.push({ points: pts, closed: true, role: 'cleanup', level: 0, index: i + 1, count: ring0.length }));
    if (st.loop && A0.length) {
      const rl = rasterLoops(A0, pieces, Rr, s, r, a, rasterAngle, finishSwept); // (the native finish cuts after the loop: what a closing leg may count on)
      if (rl.refused) loopRefused = rl.refused; else built = rl.loops;
      linesWhy = holes.length ? 'islands' : A0.length > 1 ? 'splits' : null;
    }
  }
  // TASK 778 / 850: the pocket START MARK point (always ON the clearing route, never on an island): the first clearing path's first point.
  const innerStart = pattern === 'linked' || pattern === 'morphed' ? (clear.length && clear[0].points.length ? clear[0].points[0] : null) : null;
  const loop = Boolean(built && built.length);
  let loopCrossings = 0, loopExtra = 0, loopStep = 0;
  if (loop) {
    loopStep = built.reduce((m, b) => Math.max(m, b.cutStep || 0), 0);
    loopCrossings = pathCrossings(built.map((b) => ({ points: b.pts, closed: true }))).count;
    loopExtra = built.reduce((t, b) => t + b.legs, 0);
    clear = built.map((b, i) => ({ points: b.pts, closed: true, role: 'loop', index: i + 1, count: built.length, turns: b.turns }));
    if (pattern !== 'linked') linesWhy = clear.length > 1 ? linesWhy : null;
  }
  const startPoint = (loop ? clear[0].points[0] : innerStart) || (clear.length && clear[0].points.length ? clear[0].points[0] : null);
  // what the bit sweeps (the clearing + the finish pass) and what it leaves
  // TASK 835e / 850: any closed loop with turns is swept piece by piece (loopPieces); a Loop-off ZIGZAG by its passes alone
  const nativeFinish = !finishInLoop(pattern, loop);
  const zigPasses = (c) => c.turns.filter((t) => t.kind === 'pass').map((t) => ({ points: c.points.slice(t.start, t.end + 1), closed: false }));
  const sweepOf = (c) => (c.turns ? (c.closed ? loopPieces(c) : zigPasses(c)) : [c]).map((q) => ({ points: q.points.map((p) => [p.x, p.y]), closed: q.closed }));
  const all = [...clear.flatMap(sweepOf), ...(nativeFinish ? finish : [])];
  const swept = sweepPaths(all, r, POCKET_CLEARING.chordTolMm);
  const leftR = withoutSlivers(diffRegions(R, swept));
  const area = regionsArea(leftR);
  const reachable = offsetRegions(offsetRegions(R, -r, POCKET_CLEARING.chordTolMm), r, POCKET_CLEARING.chordTolMm);
  const unreachable = Math.min(area, regionsArea(withoutSlivers(diffRegions(R, reachable))));
  const length = clear.reduce((t, c) => t + pathLength(c.points, c.closed), 0);
  const finishLength = nativeFinish ? [...wall, ...islands.flat()].reduce((t, pts) => t + pathLength(pts, true), 0) : 0;
  return { pattern, clear, levels, loops, passes, cleanup, turns, wall, islands, swept, leftover: { area, unreachable, missed: Math.max(0, area - unreachable), regions: leftR }, length, finishLength, lines, linesWhy,
    loop, loopCount: loop ? clear.length : 0, loopCrossings, loopExtra, loopStep, loopRefused, startPoint, morphedBlocked, refused: null,
    ...(pattern === 'raster' ? { ...(st.angle === 'auto' ? { angle: rasterAngle } : {}), nativeFinish, passLines } : loop ? { nativeFinish } : {}) }; // TASK 835e / 850: nativeFinish on Raster and on Loop; TASK 853: resolved angle for 'auto'
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
    const carries = plan.loop && !plan.nativeFinish && i === plan.clear.length - 1; // TASK 750: no wall cut: the last loop carries the summary (TASK 835e: a Raster loop has its wall cut)
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
  if (plan.loop && !plan.nativeFinish) return cuts.flatMap((c) => (c === pocket ? [...out, ...markCut] : [c])); // TASK 750: the wall's and the islands' finish turns are in the closed loops (TASK 835e: Spiral / Morphed)
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
