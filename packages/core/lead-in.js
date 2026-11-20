// packages/core/lead-in.js — TASK 775 / 778: the TANGENTIAL ARC LEAD-IN for On line outlines. PURE (no DOM). A derivation of the cut RECORD
// (never of the sketch), in the deriveCuts family: #core/stepped-cut deriveCuts (THE cut derivation of the export, the Prepare look and the 3D Review)
// passes every plain record's cuts through applyLeadIn, so the downloaded file, Prepare, Export 2D and Export 3D are one result.
//
// FACTS (verified on the owner's Origin, 2026-11-17): a closed loop has NO start point on the Origin (the operator plunges anywhere) and, with AutoPass,
// keeps ONE cutting direction every pass. A closed outline with an open lead-in attached, written as ONE on-line path (M tip [L arc-start] A ... junction,
// all the way round, back to the junction, no Z) is ONE object, an OPEN path: an end dot at the tip, the other end at the junction; AutoPass reverses at
// the ends like any open path, so the cutting direction ALTERNATES each depth. That is the trade-off of a lead-in: a set start in waste wood.
// Programmed pockets get NO lead-in line at all (TASK 778, owner ruling: they carry a guide start mark instead, #core/pocket-clearing.js).
//
// THE RULES (lengths base mm; r = the record's bit radius):
//  * WHICH: an On line record (cut type 'online', not stepped) with `leadIn` true, on a CLOSED outline (a loop target: the record's OWN outline; the
//    automatic hole loops of a profile stay closed, as a Hold part holds only the record's own outline). An open line already has ends: nothing to add.
//    With On line TABS the outline is already open strokes, each with its own ends: no lead-in (the note says so).
//  * SHAPE (TASK 778): a TANGENTIAL ARC of radius R and sweep angle theta (15..180 deg, default 90) on the chosen side (`leadInSide`: 'outside' | 'inside')
//    that meets the loop at the junction J TANGENT to it, arriving in the direction t the loop leaves J (no cusp). Center C = J + R * n (n = unit normal
//    into the chosen side). Arc point at backward angle a in [0, theta]: P(a) = C - R * (cos(a) * n + sin(a) * t), so P(0) = J and the forward unit tangent
//    T(a) = cos(a) * t - sin(a) * n meets the loop with T(0) = t exactly. At 90 deg, arc start S = J + R * n - R * t (one radius out and one radius back).
//    Optional straight part of length L >= 0 BEFORE the arc, tangent to the arc at S: tip = S - L * T(theta) (default 0 = arc only).
//  * JUNCTION (where the arc meets the loop): by default (`leadInAt` null = calculated), the MIDDLE OF THE LONGEST STRAIGHT EDGE (or longest segment
//    when the outline has no straight edge, e.g. a circle). Draggable along the outline in Prepare (TASK 778): stored as `leadInAt` in [0, 1) (fraction of
//    the outline walk's perimeter from its start); null returns to the calculated junction.
//  * CALCULATED DEFAULTS (TASK 778): while a field is null (not user-set), it is calculated here from the bit and the outline at the junction:
//    Radius = one bit diameter, reduced to the largest radius passing ROOM (never under the bit radius; none fits = refused 'room'); Sweep = 90 deg,
//    reduced down to 15 when 90 deg at that radius does not fit; Length = 0.
//  * ROOM: every lead-in point (excluding J) must lie strictly on the chosen side of the outline, no lead-in segment may cross the outline, and no OTHER
//    part of the outline (segments other than the junction's own stretch; on a single-segment closed loop like a circle, the far half beyond +-90 deg) may
//    be closer to any lead-in point P than P's perpendicular distance h(P) = (P - J) . n from the junction's tangent line (tolerance 0.01 mm).
//    TASK 787: the same rule holds for EVERY hole loop of the part (the outline cut's `partHoleLoops`: each inner loop, one with its own record too): no
//    lead-in point inside a hole, no lead-in segment crossing a hole, and no hole closer to a lead-in point P than h(P) (0.01 mm), so a calculated
//    Radius / Sweep is reduced, or the lead-in refused 'room', when a hole is in the way. A part without holes: unchanged.
//  * WRITTEN: ONE OPEN on-line path, no Z: `M tip [L S] A R R 0 0 sweep J` followed by the loop's exact lines / arcs from J back to J.
//    Each cut carries `leadIn` = { role: 'arc', radius, sweep, length, side, r, at, atFrac, isCalc, tip, arcStart, junction, center, tangent, normal,
//    svgSweep, points, legPoints, loopPoints, d } and `extent` = points (so the exported viewBox holds the arc and tip outside the drawing); a refused lead-in leaves the cut
//    closed (byte-identical to without) and carries { role: 'refused', error, ... }.
import { loopWalk, walkAt, subWalk, walkPoints, piecesD, piecesPoints, nearestWalkFrac } from './hold-part.js'; // TASK 822: nearestWalkFrac moved to the walk's module (a tab handle uses it too)
import { num } from './loop-geometry.js';

export const LEAD_IN = Object.freeze({
  /** the record field `leadIn` (true | false): the card's Off | On choice */
  modes: Object.freeze([Object.freeze({ id: 'off', label: 'Off' }), Object.freeze({ id: 'on', label: 'On' })]),
  /** the record field `leadInSide` (an On line outline only): which side of the line the arc sits on */
  sides: Object.freeze([Object.freeze({ id: 'outside', label: 'Outside' }), Object.freeze({ id: 'inside', label: 'Inside' })]),
  /** the record field `leadInSweep` (degrees): arc extent */
  sweep: Object.freeze({ defaultDeg: 90, minDeg: 15, maxDeg: 180, stepDeg: 15 }),
  /** the ROOM rule's tolerance (mm) */
  roomTolMm: 0.01,
  /** arc sampling chord sagitta (mm), matching hold-part.js / pocket-clearing.js */
  chordTolMm: 0.005,
});

const P = (x, y) => ({ x, y });
const TAU = 2 * Math.PI;
const EPS = 1e-9;
const maxAngle = (r, tol) => (r <= tol ? Math.PI / 4 : Math.min(Math.PI / 4, 2 * Math.acos(1 - tol / r)));
const optNum = (v) => (v != null && v !== '' && v !== false && v !== true && Number.isFinite(Number(v)) ? Number(v) : null);

function distToSeg(p, a, b) {
  const vx = b.x - a.x, vy = b.y - a.y, len2 = vx * vx + vy * vy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2)) : 0;
  return Math.hypot(p.x - a.x - t * vx, p.y - a.y - t * vy);
}
function distToPolys(p, polys) {
  let m = Infinity;
  for (const pts of polys) {
    for (let i = 0; i + 1 < pts.length; i++) {
      const d = distToSeg(p, pts[i], pts[i + 1]);
      if (d < m) m = d;
    }
  }
  return m;
}
function inPoly(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
const cross3 = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
function segsCross(p1, p2, p3, p4) {
  const d1 = cross3(p3, p4, p1), d2 = cross3(p3, p4, p2), d3 = cross3(p1, p2, p3), d4 = cross3(p1, p2, p4);
  return ((d1 > EPS && d2 < -EPS) || (d1 < -EPS && d2 > EPS)) && ((d3 > EPS && d4 < -EPS) || (d3 < -EPS && d4 > EPS));
}
function polylineCrossesRing(pts, ring) {
  const m = ring.length;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1];
    for (let j = 0; j < m; j++) {
      if (segsCross(a, b, ring[j], ring[(j + 1) % m])) return true;
    }
  }
  return false;
}

/**
 * TASK 778 MIGRATION: a record saved by task 775 with only `leadInLength` (a straight leg, no `leadInRadius` / `leadInSweep`) opens as an arc of
 * Radius = its old length and Length = 0 (same reach). Called on Shaper document read (shaper-doc.js).
 */
export function migrateLeadInRecord(rec) {
  if (!rec || typeof rec !== 'object') return rec;
  if (rec.cutType === 'online' && Number(rec.leadInLength) > 0 && !Object.hasOwn(rec, 'leadInRadius') && !Object.hasOwn(rec, 'leadInSweep')) {
    return { ...rec, leadInRadius: Number(rec.leadInLength), leadInLength: null };
  }
  return rec;
}

/** A record's lead-in settings: { on, radius (mm | null = calculated), sweep (deg | null = calculated), length (mm | null = calculated 0),
 *  at (0..1 | null = calculated), side: 'outside' | 'inside', toolDia, r (bit radius) }. */
export function leadInSettings(rec) {
  const toolDia = Number(rec && rec.toolDia) > 0 ? Number(rec.toolDia) : 0;
  const rawAt = optNum(rec && rec.leadInAt);
  return {
    on: Boolean(rec && rec.leadIn === true),
    radius: optNum(rec && rec.leadInRadius),
    sweep: optNum(rec && rec.leadInSweep),
    length: optNum(rec && rec.leadInLength),
    at: rawAt != null ? (((rawAt % 1) + 1) % 1) : null,
    side: rec && rec.leadInSide === 'inside' ? 'inside' : 'outside',
    toolDia,
    r: toolDia / 2,
  };
}

/** Does an On line record ask for a lead-in on its outline? */
export const outlineLeadIn = (rec) => Boolean(rec && !rec.terraceAs && rec.cutType === 'online' && rec.leadIn === true);

/** The junction of an outline walk (THE RULES): when `atFrac` is null, the middle of its longest straight edge, else of its longest segment;
 *  when `atFrac` is a number in [0, 1), that perimeter fraction along the walk. Returns { s, frac, segIndex, at, calculated }. */
export function outlineJunction(w, atFrac = null) {
  const segL = (i) => (i + 1 < w.starts.length ? w.starts[i + 1] : w.length) - w.starts[i];
  if (atFrac != null && Number.isFinite(atFrac)) {
    const frac = ((atFrac % 1) + 1) % 1;
    const s = frac * w.length;
    let i = w.segs.length - 1;
    while (i > 0 && w.starts[i] > s + 1e-12) i--;
    return { s, frac, segIndex: i, at: w.segs[i].type, calculated: false };
  }
  const pick = (ok) => { let best = -1; w.segs.forEach((sg, i) => { if (ok(sg) && (best < 0 || segL(i) > segL(best) + 1e-9)) best = i; }); return best; };
  let i = pick((sg) => sg.type === 'line');
  if (i < 0) i = pick(() => true);
  const s = w.starts[i] + segL(i) / 2;
  return { s, frac: w.length > 0 ? s / w.length : 0, segIndex: i, at: w.segs[i].type, calculated: true };
}

// Build the tangential arc (+ optional straight segment before it) at junction `junc` on walk `w`.
function buildLeadGeometry(w, junc, { radius, sweep, length = 0, side = 'outside' }) {
  const { point: J, tangent: t } = walkAt(w, junc.s);
  const g = side === 'inside' ? -1 : 1;
  const n = P(g * t.y, -g * t.x); // unit normal into the chosen side
  const theta = (sweep * Math.PI) / 180;
  const C = P(J.x + n.x * radius, J.y + n.y * radius);
  const arcAt = (a) => P(C.x - radius * (Math.cos(a) * n.x + Math.sin(a) * t.x), C.y - radius * (Math.cos(a) * n.y + Math.sin(a) * t.y));
  const arcStart = arcAt(theta);
  const startTan = P(Math.cos(theta) * t.x - Math.sin(theta) * n.x, Math.cos(theta) * t.y - Math.sin(theta) * n.y);
  const straight = length > 1e-9 ? length : 0;
  const tip = straight > 0 ? P(arcStart.x - straight * startTan.x, arcStart.y - straight * startTan.y) : arcStart;
  const points = [];
  if (straight > 0) {
    const ns = Math.max(2, Math.ceil(straight / 1));
    for (let k = 0; k < ns; k++) {
      const f = k / ns;
      points.push(P(tip.x + (arcStart.x - tip.x) * f, tip.y + (arcStart.y - tip.y) * f));
    }
  }
  const na = Math.max(8, Math.ceil(theta / maxAngle(radius, LEAD_IN.chordTolMm)));
  for (let k = 0; k <= na; k++) points.push(arcAt(theta * (1 - k / na)));
  const largeArc = sweep > 180 + 1e-9 ? 1 : 0;
  const svgSweep = side === 'inside' ? 1 : 0; // proved: u x v = t x n = -g (+1 inside, -1 outside)
  const d = straight > 0
    ? `M ${num(tip.x)} ${num(tip.y)} L ${num(arcStart.x)} ${num(arcStart.y)} A ${num(radius)} ${num(radius)} 0 ${largeArc} ${svgSweep} ${num(J.x)} ${num(J.y)}`
    : `M ${num(arcStart.x)} ${num(arcStart.y)} A ${num(radius)} ${num(radius)} 0 ${largeArc} ${svgSweep} ${num(J.x)} ${num(J.y)}`;
  return { junction: J, tangent: t, normal: n, center: C, arcStart, startTan, tip, points, svgSweep, d, radius, sweep, length: straight, side };
}

// Precompute ROOM-check structures once per (walk, junction) so binary search for calculated defaults is fast.
function roomContext(w, junc, holes = []) {
  const ring = walkPoints(w);
  const circle = w.closed && w.segs.length === 1 && w.segs[0].type === 'arc' ? w.segs[0] : null;
  let otherPolys;
  if (w.segs.length > 1) {
    otherPolys = [];
    w.segs.forEach((sg, i) => { if (i !== junc.segIndex) otherPolys.push(piecesPoints([sg])); });
  } else {
    // Single closed segment (circle or single closed curve): the far half beyond +-90 deg along the perimeter
    otherPolys = [piecesPoints(subWalk(w, junc.s + w.length / 4, w.length / 2))];
  }
  return { ring, circle, otherPolys, ownSeg: w.segs[junc.segIndex], holes, holePolys: holes.map((h) => [...h, h[0]]) }; // TASK 787: the part's hole rings (open) and closed
}

function fitsRoom(ctx, geom) {
  const { ring, circle, otherPolys, ownSeg, holes, holePolys } = ctx;
  const { points, junction: J, normal: n, radius, side } = geom;
  const wantInside = side === 'inside';
  // If the junction lies on an arc segment and the lead-in curves onto its concave side, the lead-in arc must be tighter than the segment's radius
  if (ownSeg && ownSeg.type === 'arc') {
    const ux = (ownSeg.c.x - J.x) / ownSeg.r, uy = (ownSeg.c.y - J.y) / ownSeg.r;
    if (n.x * ux + n.y * uy > 0.5 && radius >= ownSeg.r - 1e-6) return false;
  }
  // Check every sampled point from tip up to the last sample before J
  for (let i = 0; i < points.length - 1; i++) {
    const p = points[i];
    const h = (p.x - J.x) * n.x + (p.y - J.y) * n.y;
    if (circle) {
      const dc = Math.hypot(p.x - circle.c.x, p.y - circle.c.y);
      if (wantInside ? dc >= circle.r - 1e-6 : dc <= circle.r + 1e-6) return false;
    } else if (i === 0 || h > LEAD_IN.chordTolMm * 2) {
      if (inPoly(p, ring) !== wantInside) return false;
    }
    if (otherPolys.length && distToPolys(p, otherPolys) < h - LEAD_IN.roomTolMm) return false;
    if (holes.length && (holes.some((hr) => inPoly(p, hr)) || distToPolys(p, holePolys) < h - LEAD_IN.roomTolMm)) return false; // TASK 787: every hole, the same rule
  }
  if (!circle && polylineCrossesRing(points, ring)) return false;
  if (holes.some((hr) => polylineCrossesRing(points, hr))) return false;
  return true;
}

/**
 * outlineArc(w, opts) -> the resolved tangential arc lead-in on walk `w`:
 *   { s, frac, segIndex, at, isCalc, radius, sweep, length, side, r, junction, tangent, normal, center, arcStart, tip, points, svgSweep, d, error? }
 * Calculates any null (un-typed) Radius / Sweep / Length from the bit and the outline (THE RULES, CALCULATED DEFAULTS). `holes` (TASK 787) = the part's
 * hole rings ({x,y}[] each, open), kept clear by the ROOM rule like the outline.
 * Pure, no DOM: the ONE calculation used by export, Prepare, Export 2D/3D, and the cut card.
 */
export function outlineArc(w, { radius = null, sweep = null, length = null, at = null, side = 'outside', r = 0, toolDia = 0, holes = [] } = {}) {
  const junc = outlineJunction(w, at);
  const ctx = roomContext(w, junc, holes);
  const isCalc = { radius: radius == null, sweep: sweep == null, length: length == null, at: at == null };
  const L = length != null ? length : 0;
  const rMin = r > 0 ? r : toolDia / 2;
  const rDef = toolDia > 0 ? toolDia : 2 * rMin;
  const sDef = LEAD_IN.sweep.defaultDeg, sMin = LEAD_IN.sweep.minDeg, sMax = LEAD_IN.sweep.maxDeg;
  const tryGeom = (R, sw) => buildLeadGeometry(w, junc, { radius: R, sweep: sw, length: L, side });
  const check = (R, sw) => { const g = tryGeom(R, sw); return fitsRoom(ctx, g) ? g : null; };
  const pack = (g, error = null) => ({ ...junc, ...g, r: rMin, isCalc, ...(error ? { error } : {}) });

  if (L < -1e-9) return pack(tryGeom(radius ?? (rDef || 1), sweep ?? sDef), 'length');
  if (radius == null && !(rDef > 0)) return pack(tryGeom(1, sweep ?? sDef), 'no length');
  if (radius != null && !(radius > 0)) return pack(tryGeom(rDef || 1, sweep ?? sDef), 'no length');
  if (radius != null && radius < rMin - 1e-9) return pack(tryGeom(radius, sweep ?? sDef), 'short');
  if (sweep != null && (sweep < sMin - 1e-9 || sweep > sMax + 1e-9)) return pack(tryGeom(radius ?? rDef, Math.min(sMax, Math.max(sMin, sweep))), 'sweep');

  const maxRadiusFor = (sw) => {
    const full = check(rDef, sw);
    if (full) return { R: rDef, g: full };
    if (!check(rMin, sw)) return null;
    let lo = rMin, hi = rDef;
    for (let k = 0; k < 24; k++) { const mid = (lo + hi) / 2; if (check(mid, sw)) lo = mid; else hi = mid; }
    const R = Math.max(rMin, Math.floor(lo * 1000) / 1000);
    return { R, g: check(R, sw) || check(rMin, sw) };
  };
  const maxSweepFor = (R) => {
    const full = check(R, sDef);
    if (full) return { sw: sDef, g: full };
    if (!check(R, sMin)) return null;
    let lo = sMin, hi = sDef;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (check(R, mid)) lo = mid; else hi = mid - 1; }
    return { sw: lo, g: check(R, lo) };
  };

  if (radius == null && sweep == null) {
    const byR = maxRadiusFor(sDef);
    if (byR) return pack(byR.g);
    const byS = maxSweepFor(rMin);
    if (byS) return pack(byS.g);
    return pack(tryGeom(rMin, sMin), 'room');
  }
  if (radius == null) {
    const byR = maxRadiusFor(sweep);
    if (byR) return pack(byR.g);
    return pack(tryGeom(rMin, sweep), 'room');
  }
  if (sweep == null) {
    const byS = maxSweepFor(radius);
    if (byS) return pack(byS.g);
    return pack(tryGeom(radius, sMin), 'room');
  }
  const g = check(radius, sweep);
  return g ? pack(g) : pack(tryGeom(radius, sweep), 'room');
}

/**
 * applyLeadIn(cuts, rec, state) -> cuts — an On line record's cuts with its outline's tangential arc lead-in (unchanged, the SAME array, when the
 * record has none). The record's own closed outline cut gets `geom` = the ONE open path (lead-in arc [+ straight] + the whole loop, no Z), `leadIn`
 * and `extent`; refused: `leadIn` = { role: 'refused', error: 'tabs' | 'short' | 'no length' | 'sweep' | 'length' | 'outline' | 'room', ... } and
 * the cut stays closed.
 */
export function applyLeadIn(cuts, rec, state) {
  if (!outlineLeadIn(rec) || !Array.isArray(cuts)) return cuts;
  const st = leadInSettings(rec);
  const strokes = cuts.find((c) => c && c.hold && c.hold.role === 'stroke');
  const outer = cuts.find((c) => c && !c.isHole && c.kind === 'loop' && c.loop);
  const own = strokes || outer;
  if (!own) return cuts; // an open line: it has its ends already
  const isCalc = { radius: st.radius == null, sweep: st.sweep == null, length: st.length == null, at: st.at == null };
  const base = { radius: st.radius ?? st.toolDia, sweep: st.sweep ?? LEAD_IN.sweep.defaultDeg, length: st.length ?? 0, side: st.side, r: st.r, atFrac: st.at, isCalc };
  const refuse = (error, extra = {}) => cuts.map((c) => (c === own ? { ...c, leadIn: { ...base, ...extra, role: 'refused', error } } : c));
  if (strokes) return refuse('tabs');
  const w = loopWalk(outer.loop, state);
  if (!w) return refuse('outline');
  const holeWalks = (outer.partHoleLoops || []).map((hl) => loopWalk(hl, state)); // TASK 787: every hole of the part (the ROOM rule keeps them clear)
  if (holeWalks.some((hw) => !hw)) return refuse('outline');
  const res = outlineArc(w, { ...st, holes: holeWalks.map(walkPoints) });
  const info = {
    radius: res.radius, sweep: res.sweep, length: res.length, side: res.side, r: res.r,
    at: res.at, atFrac: res.frac, isCalc: res.isCalc,
    tip: res.tip, arcStart: res.arcStart, junction: res.junction, center: res.center, tangent: res.tangent, normal: res.normal,
    svgSweep: res.svgSweep, points: res.points, d: res.d,
  };
  if (res.error) return refuse(res.error, info);
  const loopPieces = subWalk(w, res.s, w.length);
  const fullD = `${res.d} ${piecesD(loopPieces)}`;
  const leadIn = { ...info, role: 'arc', legPoints: res.points, loopPoints: piecesPoints(loopPieces) };
  return cuts.map((c) => (c === outer ? { ...c, geom: { tag: 'path', a: `d="${fullD}"` }, leadIn, extent: res.points } : c));
}

/**
 * TASK 778: evaluate dragging the junction handle to world point `worldPt` on `outerLoop` for record `rec` (ONE derivation; Prepare never computes
 * outline geometry itself). `holeLoops` (TASK 787) = the part's hole loops, kept clear as in the export. Returns { atFrac, leadIn } or null when the walk
 * cannot be read.
 */
export function leadInDragAt(outerLoop, rec, state, worldPt, holeLoops = []) {
  const w = loopWalk(outerLoop, state);
  if (!w) return null;
  const hit = nearestWalkFrac(w, worldPt);
  const derived = applyLeadIn([{ kind: 'loop', loop: outerLoop, isHole: false, rec, partHoleLoops: holeLoops }], { ...rec, leadIn: true, leadInAt: hit.frac }, state);
  const leadIn = derived && derived[0] ? derived[0].leadIn : null;
  return leadIn ? { atFrac: hit.frac, leadIn } : null;
}
