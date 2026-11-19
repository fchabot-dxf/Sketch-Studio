// packages/core/lead-in.js — TASK 775: the LEAD-IN. PURE (no DOM). A derivation of the cut RECORD (never of the sketch), in the deriveCuts family:
// #core/stepped-cut deriveCuts (THE cut derivation of the export, the Prepare look and the 3D Review) passes every plain record's cuts through
// applyLeadIn (an On line outline), and #core/pocket-clearing planClearing builds a programmed pocket's legs with pocketLeg (Loop on), so the downloaded
// file, Prepare, Export 2D and Export 3D are one result.
//
// FACTS (verified on the owner's Origin, 2026-11-17): a closed loop has NO start point on the Origin (the operator plunges anywhere) and, with AutoPass,
// keeps ONE cutting direction every pass. A closed square with an open LEG attached, written as ONE on-line path (M leg tip L junction, all the way
// round, back to the junction, no Z) is ONE object, an OPEN path: an end dot at the leg tip, the other end at the junction; AutoPass reverses at the
// ends like any open path, so the cutting direction ALTERNATES each depth. That is the trade-off of a lead-in: a set start in waste wood.
//
// THE RULES (lengths base mm; r = the record's bit radius):
//  * WHICH: an On line record (cut type 'online', not stepped) with `leadIn` true, on a CLOSED outline (a loop target: the record's OWN outline; the
//    automatic hole loops of a profile stay closed, as a Hold part holds only the record's own outline); and a programmed pocket with Loop on
//    (#core/pocket-clearing: every closed loop gets its leg). An open line already has ends: nothing to add. With On line TABS the outline is already
//    open strokes, each with its own ends: no lead-in (the summary says so).
//  * LENGTH = the record's `leadInLength`, or one bit diameter when it has none (follows the bit). At least the bit radius (else refused: 'short').
//  * OUTLINE JUNCTION (where the leg meets the loop): the MIDDLE OF THE LONGEST STRAIGHT EDGE (a leg along an edge's normal, never at a corner);
//    an outline with no straight edge (a circle, arcs, beziers): the middle of its longest segment. Not user-movable (state it on the card: the
//    note names it). THE LEG: straight from the junction along the outline's normal there, AWAY from the line into the side the record names
//    (`leadInSide`: 'outside' (default) | 'inside': the waste side the user picks), `length` long; the tip is the start. ROOM: every point of the leg
//    must be no closer to the outline than its distance from the junction, i.e. the tip is at least `length` from the whole outline (0.01 mm):
//    otherwise another part of the outline is in the way (refused: 'room').
//  * POCKET LEG (pocketLeg): from the loop's start J (its first point = its last: the junction) a straight leg INTO the cleared region, toward the
//    pocket's innermost rings (the deepest ring level of the pocket's own rings: the nearest such ring, the leg aimed at its nearest point, or at its
//    centroid when J lies on it), `length` long; the leg must lie inside the region the bit may sweep (R inset by r: never across the wall or an island,
//    asserted by the caller's `inside` test); the next nearest ring is tried when it does not; none fits: refused ('room').
//  * WRITTEN: ONE OPEN on-line path: M tip L junction, then the whole loop from the junction back to it, no Z (the exact lines / arcs of an outline;
//    a pocket loop's points). Each cut carries `leadIn` = { role: 'leg', tip, junction, length, side?, legPoints: [tip, junction] } (Prepare draws the
//    leg and the dots, Export 2D labels it, the footprint sweeps it) and `extent` = [tip] (the exported viewBox must hold the tip outside the drawing);
//    a refused lead-in leaves the cut closed and carries { role: 'refused', error }.
import { loopWalk, walkAt, subWalk, walkPoints, piecesD } from './hold-part.js';
import { num } from './loop-geometry.js';

export const LEAD_IN = Object.freeze({
  /** the record field `leadIn` (true | false): the card's Off | On choice */
  modes: Object.freeze([Object.freeze({ id: 'off', label: 'Off' }), Object.freeze({ id: 'on', label: 'On' })]),
  /** the record field `leadInSide` (an On line outline only): which side of the line the leg goes to */
  sides: Object.freeze([Object.freeze({ id: 'outside', label: 'Outside' }), Object.freeze({ id: 'inside', label: 'Inside' })]),
  /** the ROOM rule's tolerance (mm) */
  roomTolMm: 0.01,
});

const P = (x, y) => ({ x, y });
function distToSeg(p, a, b) {
  const vx = b.x - a.x, vy = b.y - a.y, len2 = vx * vx + vy * vy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2)) : 0;
  return Math.hypot(p.x - a.x - t * vx, p.y - a.y - t * vy);
}
const distToRing = (p, ring) => { let m = Infinity; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) m = Math.min(m, distToSeg(p, ring[j], ring[i])); return m; };

/** A record's lead-in settings: { on, length (base mm: the record's, or one bit diameter), side: 'outside' | 'inside', r (the bit radius) }. */
export function leadInSettings(rec) {
  const toolDia = Number(rec && rec.toolDia) > 0 ? Number(rec.toolDia) : 0;
  return { on: Boolean(rec && rec.leadIn === true), length: Number(rec && rec.leadInLength) > 0 ? Number(rec.leadInLength) : toolDia,
    side: rec && rec.leadInSide === 'inside' ? 'inside' : 'outside', r: toolDia / 2 };
}
/** Does an On line record ask for a lead-in on its outline? */
export const outlineLeadIn = (rec) => Boolean(rec && !rec.terraceAs && rec.cutType === 'online' && rec.leadIn === true);

/** The junction of an outline walk (THE RULES): { s: the perimeter position of the middle of its longest straight edge, else of its longest segment,
 *  at: that segment's type ('line' | 'arc' | 'poly') }. */
export function outlineJunction(w) {
  const len = (i) => (i + 1 < w.starts.length ? w.starts[i + 1] : w.length) - w.starts[i];
  const pick = (ok) => { let best = -1; w.segs.forEach((sg, i) => { if (ok(sg) && (best < 0 || len(i) > len(best) + 1e-9)) best = i; }); return best; };
  let i = pick((sg) => sg.type === 'line');
  if (i < 0) i = pick(() => true);
  return { s: w.starts[i] + len(i) / 2, at: w.segs[i].type };
}

/** The leg of an outline walk (THE RULES): { s, at, junction, tip, normal } or { error: 'room' }. side 'outside' = away from the part (the walk keeps the
 *  part on its LEFT: #core/hold-part loopWalk), 'inside' = into it. */
export function outlineLeg(w, { length, side = 'outside' }) {
  const { s, at } = outlineJunction(w);
  const { point: J, tangent: t } = walkAt(w, s);
  const g = side === 'inside' ? -1 : 1, n = P(g * t.y, -g * t.x);
  const tip = P(J.x + n.x * length, J.y + n.y * length);
  if (distToRing(tip, walkPoints(w)) < length - LEAD_IN.roomTolMm) return { error: 'room', s, at, junction: J, tip };
  return { s, at, junction: J, tip, normal: n };
}

/**
 * applyLeadIn(cuts, rec, state) -> cuts — an On line record's cuts with its outline's lead-in (unchanged, the SAME array, when the record has none).
 * The record's own closed outline cut gets `geom` = the ONE open path (leg + the whole loop, no Z), `leadIn` and `extent`; refused: `leadIn` = { role:
 * 'refused', error: 'tabs' | 'short' | 'no length' | 'outline' | 'room' } and the cut stays closed.
 */
export function applyLeadIn(cuts, rec, state) {
  if (!outlineLeadIn(rec) || !Array.isArray(cuts)) return cuts;
  const st = leadInSettings(rec);
  const strokes = cuts.find((c) => c && c.hold && c.hold.role === 'stroke');
  const outer = cuts.find((c) => c && !c.isHole && c.kind === 'loop' && c.loop);
  const own = strokes || outer;
  if (!own) return cuts; // an open line: it has its ends already
  const base = { length: st.length, side: st.side };
  const refuse = (error) => cuts.map((c) => (c === own ? { ...c, leadIn: { ...base, role: 'refused', error } } : c));
  if (strokes) return refuse('tabs');
  if (!(st.length > 0)) return refuse('no length');
  if (st.length < st.r - 1e-9) return refuse('short');
  const w = loopWalk(outer.loop, state);
  if (!w) return refuse('outline');
  const leg = outlineLeg(w, st);
  if (leg.error) return refuse(leg.error);
  const { tip, junction: J } = leg;
  const d = `M ${num(tip.x)} ${num(tip.y)} L ${num(J.x)} ${num(J.y)} ${piecesD(subWalk(w, leg.s, w.length))}`;
  const leadIn = { ...base, role: 'leg', at: leg.at, tip, junction: J, legPoints: [tip, J], d: `M ${num(tip.x)} ${num(tip.y)} L ${num(J.x)} ${num(J.y)}` };
  return cuts.map((c) => (c === outer ? { ...c, geom: { tag: 'path', a: `d="${d}"` }, leadIn, extent: [tip] } : c));
}

function centroid(pts) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const f = pts[j].x * pts[i].y - pts[i].x * pts[j].y; a += f; cx += (pts[j].x + pts[i].x) * f; cy += (pts[j].y + pts[i].y) * f; }
  return Math.abs(a) > 1e-12 ? P(cx / (3 * a), cy / (3 * a)) : pts[0];
}
function nearestOnRing(ring, q) {
  let best = null, bd = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j], b = ring[i], vx = b.x - a.x, vy = b.y - a.y, len2 = vx * vx + vy * vy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((q.x - a.x) * vx + (q.y - a.y) * vy) / len2)) : 0;
    const p = P(a.x + t * vx, a.y + t * vy), d = Math.hypot(p.x - q.x, p.y - q.y);
    if (d < bd) { bd = d; best = p; }
  }
  return { p: best, d: bd };
}
/**
 * pocketLeg(J, rings, length, inside) -> { tip, junction: J, legPoints } | null — a programmed pocket loop's leg (THE RULES, POCKET LEG): J = the loop's
 * start, `rings` = the pocket's innermost ring level (closed loops, open {x,y}[]), `inside(a, b)` = is the segment a-b inside the region the bit may sweep.
 */
export function pocketLeg(J, rings, length, inside) {
  const cands = rings.filter((r) => r.length >= 3).map((ring) => ({ ring, ...nearestOnRing(ring, J) })).sort((a, b) => a.d - b.d);
  for (const c of cands) {
    const aim = c.d > 1e-6 ? c.p : centroid(c.ring);
    const dx = aim.x - J.x, dy = aim.y - J.y, L = Math.hypot(dx, dy);
    if (!(L > 1e-9)) continue;
    const tip = P(J.x + (dx / L) * length, J.y + (dy / L) * length);
    if (inside(tip, J)) return { tip, junction: J, legPoints: [tip, J] };
  }
  return null;
}
