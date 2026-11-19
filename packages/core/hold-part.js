// packages/core/hold-part.js — TASK 742: HOLD PART on a through cut (an Outside or an Inside cut): TABS or an ONION SKIN, so the part (or a
// hole's slug) stays attached to the board until the operator frees it. PURE (no DOM). A derivation of the cut RECORD (never of the sketch):
// #core/stepped-cut.js deriveCuts (THE cut derivation of the export, the Prepare look and the 3D Review) passes every plain cut through
// applyHoldPart, so the downloaded file, Prepare and Review are one result.
//
// THE RULES (declared in HOLD_PART below):
//  * Which cuts: a plain Outside / Inside record (cut type exterior | outside | interior | inside, not a stepped type) whose `holdPart` is
//    'tabs' or 'skin'. Only the record's OWN outline is held; the automatic hole cuts of an Outside plate (and the islands of an Inside cut)
//    stay full-depth cuts as before.
//  * ONION SKIN: the cut is cut at depth - thickness all round, nothing else (the operator frees the part by hand: knife / flush trim).
//  * TABS: (1) the cut itself, unchanged but at depth - thickness (pass 1); (2) one GAP STRIP per gap between two tabs, at the full depth: a
//    CLOSED thin loop whose part-side edge is the outline itself over the gap (the exact lines / arcs, no offset applied here) and whose other
//    edge is the outline offset away from the part (outward for an Outside cut, inward for an Inside cut) by the strip width = the record's bit
//    diameter + HOLD_PART.stripExtraMm, joined by straight end caps along the outline's normal at the tab ends (a cap is shortened where the
//    offset outline comes closer, at a concave corner). A strip is written as an INSIDE cut: the Origin offsets it inward by the REAL bit's
//    radius, so its part-side leg cuts exactly where pass 1 ran (the bit's edge on the part's edge) whatever bit is used, up to the strip width.
//    Every end cap is exactly the strip width long (else another part of the outline's offset is in the way: refused).
//    The return leg runs in waste (optional). The strip WIDTH is the only number computed from the bit.
//  * COUNT: Auto = one tab per HOLD_PART.autoPerMm of perimeter (rounded up), at least HOLD_PART.autoMin; or the record's number.
//  * PLACEMENT: a tab lies inside ONE segment of the outline (a line, an arc or a bezier; a circle is one closed segment with no ends) with its centre at
//    least width / 2 + bit radius from that segment's ends (a corner, or a joint with the next arc / line), or width / 2 + strip width from an
//    end where the outline turns toward the strips' side (a concave corner seen from the waste: the strips' offsets meet there): a segment
//    shorter than that takes no tab, nor an arc that curves round the strips' side with a radius up to the strip width. The tabs are spread evenly by perimeter (k * perimeter / count from the middle of the longest stretch
//    that can take one), each moved to the nearest allowed point; a tab closer to the previous one than width + strip width (the gap a strip
//    needs) is dropped, and the count is first lowered until the even spacing leaves that gap. Fewer than asked: the summary says how many fit.
//  * REFUSED (the cut is exported as without hold, the summary says why): no cut depth; thickness >= depth (nothing to hold); no segment long
//    enough for a tab; the offset outline of a gap is not one ring (a neck narrower than the strip), or the record's bit + offset does not fit
//    in a strip (an offset over stripExtraMm / 2).
//  * TASK 775, ON LINE (the cut type 'online'; the Origin follows the line itself, material both sides): the same Hold part rows (one declaration).
//    TABS on a CLOSED outline: the line is written as SEPARATE OPEN STROKES, the tabs being the GAPS between them, each exactly the tab width long
//    along the outline (measured on the line the bit's centre follows): the gaps are simply NOT CUT, to the full depth (no thickness: the row is not
//    shown, tabsHaveThickness). The Origin splits a path of several strokes into separate objects (verified on the owner's machine 2026-11-17), so
//    each stroke is its own <path>. The wood left in a gap is the tab width minus the bit diameter (the bit reaches its radius past each stroke's
//    end): a tab width not over the bit diameter leaves nothing (refused). PLACEMENT: tabLayout with no strips (side 0): a tab inside one
//    segment, its centre width / 2 + the bit radius from the segment's ends; the strokes between two tabs at least one bit diameter long. Refused
//    on an OPEN line (a chain: tabs need a closed outline), with no segment long enough, or a tab not wider than the bit. ONION SKIN: the line
//    (a closed outline or an open line) cut at depth - thickness, as 742's.
import { arcSweepInfo } from './geometry.js';
import { num, chainToPathD } from './loop-geometry.js';
import { curvePointsFrom } from './curve-kinds.js'; // TASK 761: a bezier's points (its kind's declaration, at CURVE_TOLERANCE_MM)
import { offsetPolygonRound, sweepPaths } from './plot/clip.js';

export const HOLD_PART = Object.freeze({
  /** the record field `holdPart`: Off | Tabs | Onion skin */
  modes: Object.freeze([Object.freeze({ id: 'off', label: 'Off' }), Object.freeze({ id: 'tabs', label: 'Tabs' }), Object.freeze({ id: 'skin', label: 'Onion skin' })]),
  /** Auto count: one tab per this much perimeter (mm), rounded up, at least autoMin */
  autoPerMm: 150,
  autoMin: 3,
  /** gap strip width = the record's bit diameter + this (mm): any bit up to that width fits the strip */
  stripExtraMm: 1,
  /** the defaults a record gets when Hold part is first turned on, by document unit family (base mm): 10 mm / 3/8 in wide, 2 mm / 1/16 in thick */
  defaults: Object.freeze({ mm: Object.freeze({ tabWidth: 10, thickness: 2 }), in: Object.freeze({ tabWidth: 25.4 * 3 / 8, thickness: 25.4 / 16 }) }),
  /** arcs are sampled at this chord sagitta (mm) for the offset and the preview polygons */
  chordTolMm: 0.005,
});
/** The default tab width / thickness (base mm) for a document unit. */
export const holdDefaults = (unit) => (unit === 'in' ? HOLD_PART.defaults.in : HOLD_PART.defaults.mm);
/** The Auto tab count of an outline of this perimeter (mm). */
export const autoTabCount = (perimeterMm) => Math.max(HOLD_PART.autoMin, Math.ceil(perimeterMm / HOLD_PART.autoPerMm - 1e-9));

const isOutside = (ct) => ct === 'exterior' || ct === 'outside';
const isInside = (ct) => ct === 'interior' || ct === 'inside';
const isOnline = (ct) => ct === 'online'; // TASK 775
/** Can a cut of this type hold its part (a plain Outside / Inside cut; TASK 775: an On line cut)? */
export const typeHoldsPart = (cutType) => isOutside(cutType) || isInside(cutType) || isOnline(cutType);
/** TASK 775: do this type's TABS have a thickness (an Outside / Inside cut's tabs are cut down to it; an On line cut's tabs are gaps left uncut)? */
export const tabsHaveThickness = (cutType) => isOutside(cutType) || isInside(cutType);
/** The hold mode a record is cut with: 'tabs' | 'skin' | 'off' (any other type, a stepped record, no / another value). */
export function holdMode(rec) {
  if (!rec || rec.terraceAs || !typeHoldsPart(rec.cutType)) return 'off';
  return rec.holdPart === 'tabs' || rec.holdPart === 'skin' ? rec.holdPart : 'off';
}

// ── the outline as an exact WALK: lines { type:'line', a, b } and arcs { type:'arc', c, r, t0, sw } (start angle, signed sweep; a circle is one
// arc of sweep 2 pi, `closed`), end to end, wound with a POSITIVE signed area (world x / y), so the part side is on the LEFT of travel. TASK 761: a
// bezier is ONE segment { type:'poly', pts, cum } (its points, #core/curve-kinds at CURVE_TOLERANCE_MM, and their running lengths), walked by length ──
const P = (x, y) => ({ x, y });
const TAU = 2 * Math.PI;
/** A polyline segment of the walk (a bezier's points, start to end): its points and their running lengths. */
function polySeg(pts) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  return { type: 'poly', pts, cum };
}
// the chord of a poly segment holding length u: its index i (pts[i] -> pts[i + 1]) and the fraction along it
function polyAt(s, u) {
  let i = 0;
  while (i < s.pts.length - 2 && s.cum[i + 1] < u) i++;
  const L = s.cum[i + 1] - s.cum[i];
  return { i, k: L > 0 ? Math.min(1, Math.max(0, (u - s.cum[i]) / L)) : 0 };
}
const segLen = (s) => (s.type === 'line' ? Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y) : s.type === 'poly' ? s.cum[s.cum.length - 1] : s.r * Math.abs(s.sw));
const arcPt = (s, t) => P(s.c.x + s.r * Math.cos(t), s.c.y + s.r * Math.sin(t));
const segStart = (s) => (s.type === 'line' ? s.a : s.type === 'poly' ? s.pts[0] : arcPt(s, s.t0));
function pointAt(s, u) {
  if (s.type === 'line') { const L = segLen(s), k = L > 0 ? u / L : 0; return P(s.a.x + (s.b.x - s.a.x) * k, s.a.y + (s.b.y - s.a.y) * k); }
  if (s.type === 'poly') { const { i, k } = polyAt(s, u), a = s.pts[i], b = s.pts[i + 1]; return P(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k); }
  return arcPt(s, s.t0 + Math.sign(s.sw) * (u / s.r));
}
function tangentAt(s, u) {
  if (s.type === 'line') { const L = segLen(s); return P((s.b.x - s.a.x) / L, (s.b.y - s.a.y) / L); }
  if (s.type === 'poly') { const { i } = polyAt(s, u), a = s.pts[i], b = s.pts[i + 1], L = Math.hypot(b.x - a.x, b.y - a.y) || 1; return P((b.x - a.x) / L, (b.y - a.y) / L); }
  const t = s.t0 + Math.sign(s.sw) * (u / s.r), g = Math.sign(s.sw);
  return P(-Math.sin(t) * g, Math.cos(t) * g);
}
function subSeg(s, u0, u1) {
  if (s.type === 'line') return { type: 'line', a: pointAt(s, u0), b: pointAt(s, u1) };
  if (s.type === 'poly') return polySeg([pointAt(s, u0), ...s.pts.filter((_, i) => s.cum[i] > u0 + 1e-12 && s.cum[i] < u1 - 1e-12), pointAt(s, u1)]);
  const g = Math.sign(s.sw);
  return { type: 'arc', c: s.c, r: s.r, t0: s.t0 + g * (u0 / s.r), sw: g * ((u1 - u0) / s.r) };
}
const reverseSeg = (s) => (s.type === 'line' ? { type: 'line', a: s.b, b: s.a } : s.type === 'poly' ? polySeg(s.pts.slice().reverse()) : { ...s, t0: s.t0 + s.sw, sw: -s.sw });
const maxAngle = (r, tol) => (r <= tol ? Math.PI / 4 : Math.min(Math.PI / 4, 2 * Math.acos(1 - tol / r)));
/** A segment's points from its start (included) to its end (excluded), arcs sampled at `tol`. */
function segSamples(s, tol = HOLD_PART.chordTolMm) {
  if (s.type === 'line') return [s.a];
  if (s.type === 'poly') return s.pts.slice(0, -1);
  const n = Math.max(1, Math.ceil(Math.abs(s.sw) / maxAngle(s.r, tol)));
  const out = [];
  for (let k = 0; k < n; k++) out.push(arcPt(s, s.t0 + (s.sw * k) / n));
  return out;
}
/** A segment as SVG path text from its start (no M): `L x y` or `A r r 0 large sweep x y` (SVG sweep 1 = the angle increases, as #core/stepped-cut walkPathD). A full circle is two half arcs. */
function segD(s) {
  if (s.type === 'line') return `L ${num(s.b.x)} ${num(s.b.y)}`;
  if (s.type === 'poly') return s.pts.slice(1).map((q) => `L ${num(q.x)} ${num(q.y)}`).join(' ');
  if (Math.abs(s.sw) > TAU - 1e-9) { const h = { ...s, sw: s.sw / 2 }; return `${segD(h)} ${segD({ ...h, t0: s.t0 + s.sw / 2 })}`; }
  const e = arcPt(s, s.t0 + s.sw);
  return `A ${num(s.r)} ${num(s.r)} 0 ${Math.abs(s.sw) > Math.PI ? 1 : 0} ${s.sw > 0 ? 1 : 0} ${num(e.x)} ${num(e.y)}`;
}
function signedArea(poly) {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += poly[j].x * poly[i].y - poly[i].x * poly[j].y;
  return a / 2;
}

/**
 * loopWalk(loop, state) -> { segs, closed, length, starts } | null — a loop (#core/loop-finder: joints[] + edges[], edge k joins joint k to
 * k + 1, the last one closes) as its exact walk from the shapes (line ends; an arc's stored centre / start / end + sweep, the same reading as
 * #core/curve-kinds arcSeg; a circle's centre + radius; TASK 761: a bezier's points, #core/curve-kinds), wound with a positive signed area. `closed` = a circle (one segment with no ends).
 */
export function loopWalk(loop, state) {
  if (!loop || !Array.isArray(loop.joints) || !Array.isArray(loop.edges) || !state || !state.joints) return null;
  const J = (id) => state.joints.get(id);
  const shapeById = new Map((state.shapes || []).map((s) => [s.id, s]));
  let segs = [], closed = false;
  if (loop.edges.length === 1) {
    const s = shapeById.get(loop.edges[0]);
    if (!s || s.type !== 'circle') return null;
    const c = J(s.joints[0]), r = Number(s.radius) || 0;
    if (!c || !(r > 0)) return null;
    segs = [{ type: 'arc', c: P(c.x, c.y), r, t0: 0, sw: TAU }];
    closed = true;
  } else {
    const n = loop.joints.length;
    for (let i = 0; i < n; i++) {
      const from = J(loop.joints[i]), to = J(loop.joints[(i + 1) % n]), s = shapeById.get(loop.edges[i]);
      if (!from || !to || !s) return null;
      if (s.type === 'arc') {
        const c = J(s.joints[0]), st = J(s.joints[1]), en = J(s.joints[2]);
        if (!c || !st || !en) return null;
        const info = arcSweepInfo(c, st, en, { sweep: s.sweep });
        const forward = Math.hypot(from.x - st.x, from.y - st.y) <= Math.hypot(from.x - en.x, from.y - en.y);
        const r = Math.hypot(st.x - c.x, st.y - c.y);
        segs.push({ type: 'arc', c: P(c.x, c.y), r, t0: Math.atan2(from.y - c.y, from.x - c.x), sw: (forward ? info.dir : -info.dir) * info.span });
      } else if (s.type === 'line') {
        if (Math.hypot(to.x - from.x, to.y - from.y) > 1e-9) segs.push({ type: 'line', a: P(from.x, from.y), b: P(to.x, to.y) });
      } else if (s.type === 'bezier') { // TASK 761: the bezier's points from this joint, one segment
        const pts = curvePointsFrom(s, state, from);
        if (pts.length < 2) return null;
        segs.push(polySeg(pts.map((q) => P(q.x, q.y))));
      } else return null;
    }
  }
  if (!segs.length) return null;
  if (signedArea(segs.flatMap((s) => segSamples(s))) < 0) segs = segs.slice().reverse().map(reverseSeg);
  const starts = [];
  let length = 0;
  for (const s of segs) { starts.push(length); length += segLen(s); }
  return { segs, closed, length, starts };
}
/** The walk's polygon (open ring), arcs sampled. */
export const walkPoints = (w) => w.segs.flatMap((s) => segSamples(s));
const wrap = (w, s) => ((s % w.length) + w.length) % w.length;
function locate(w, s) {
  const x = wrap(w, s);
  let i = w.segs.length - 1;
  while (i > 0 && w.starts[i] > x) i--;
  return { i, u: Math.min(x - w.starts[i], segLen(w.segs[i])) };
}
/** The point and the unit tangent of the walk at perimeter position s. */
export function walkAt(w, s) { const { i, u } = locate(w, s); return { point: pointAt(w.segs[i], u), tangent: tangentAt(w.segs[i], u) }; }
/** The walk's pieces from perimeter position s0 forward by `len` (cyclic): a list of segments, end to end. */
export function subWalk(w, s0, len) {
  const out = [];
  let { i, u } = locate(w, s0), left = len;
  for (let guard = 0; left > 1e-12 && guard < 4 * w.segs.length + 4; guard++) {
    const L = segLen(w.segs[i]), take = Math.min(left, L - u);
    if (take > 1e-12) out.push(subSeg(w.segs[i], u, u + take));
    left -= take;
    i = (i + 1) % w.segs.length; u = 0;
  }
  return out;
}
/** Walk pieces (end to end) as SVG path text from the first piece's start (no M). */
export const piecesD = (pieces) => pieces.map(segD).join(' ');
/** TASK 775: walk pieces (end to end) as ONE open SVG path text: `M start` then each piece (exact lines / arcs, as the gap strips are written). */
export const openPiecesD = (pieces) => { const a = segStart(pieces[0]); return `M ${num(a.x)} ${num(a.y)} ${piecesD(pieces)}`; };
/** TASK 775: walk pieces as one polyline (arcs sampled at HOLD_PART.chordTolMm), the end point included. */
export function piecesPoints(pieces) {
  if (!pieces.length) return [];
  const last = pieces[pieces.length - 1];
  return [...pieces.flatMap((s) => segSamples(s)), pointAt(last, segLen(last))];
}

/**
 * tabLayout(walk, { count, width, bitRadius, gap, side }) -> { perimeter, requested, tabs: [{ s, s0, s1 }] } — where the tabs go (THE PLACEMENT
 * rule above). count = the asked number (Auto resolved by the caller), width = the tab width, bitRadius = the record's bit radius, gap = the
 * strip width (the least gap between two tabs), side = +1 strips outside the part (Outside cut), -1 inside (Inside cut). s = the tab's centre, s0 / s1 its ends, as perimeter positions (s0 < s1, s1 may pass the
 * perimeter on a circle), ordered by s.
 */
export function tabLayout(w, { count, width, bitRadius, gap, side = 1 }) {
  const Pm = w.length, half = width / 2, r = Math.max(0, bitRadius || 0);
  const out = { perimeter: Pm, requested: count, tabs: [] };
  const n0 = w.segs.length;
  const endTan = (sg) => tangentAt(sg, segLen(sg)), startTan = (sg) => tangentAt(sg, 0);
  // a joint where the outline turns toward the strip's side (a concave corner seen from the strip): the strips' offsets meet there
  const closesOnStrip = (i) => { const a = endTan(w.segs[(i - 1 + n0) % n0]), b = startTan(w.segs[i]); return side * (a.x * b.y - a.y * b.x) < -1e-9; };
  const zones = w.closed ? [{ lo: 0, hi: Pm, all: true }]
    : w.segs.map((sg, i) => {
      if (sg.type === 'arc' && side * Math.sign(sg.sw) < 0 && sg.r <= gap + 1e-9) return null; // an arc curving round the strip side tighter than the strip
      const lo = w.starts[i] + half + (closesOnStrip(i) ? gap : r), hi = w.starts[i] + segLen(sg) - half - (closesOnStrip((i + 1) % n0) ? gap : r);
      return hi >= lo - 1e-9 ? { lo, hi } : null;
    }).filter(Boolean);
  if (!zones.length || !(count >= 1)) return out;
  let n = Math.floor(count);
  while (n > 0 && Pm / n - width < gap - 1e-9) n--;
  if (n < 1) return out;
  const cyc = (a, b) => { const d = Math.abs(wrap(w, a) - wrap(w, b)); return Math.min(d, Pm - d); };
  const snap = (x) => {
    let best = null, bd = Infinity;
    for (const z of zones) {
      const y = z.all ? wrap(w, x) : Math.min(z.hi, Math.max(z.lo, wrap(w, x)));
      const d = cyc(x, y);
      if (d < bd - 1e-9) { bd = d; best = y; }
    }
    return best;
  };
  const longest = zones.reduce((a, z) => (z.hi - z.lo > a.hi - a.lo ? z : a), zones[0]);
  const start = longest.all ? 0 : (longest.lo + longest.hi) / 2;
  const centres = [...new Set(Array.from({ length: n }, (_, k) => snap(start + (k * Pm) / n)).map((v) => Math.round(v * 1e9) / 1e9))].sort((a, b) => a - b);
  const kept = [];
  for (const c of centres) if (!kept.length || c - kept[kept.length - 1] >= width + gap - 1e-9) kept.push(c);
  while (kept.length > 1 && kept[0] + Pm - kept[kept.length - 1] < width + gap - 1e-9) kept.pop();
  out.tabs = kept.map((s) => ({ s, s0: s - half, s1: s + half }));
  return out;
}

// the first crossing of the ray from p along unit n with the rings' edges: { ring, edge, k (along the edge), t (along the ray), point } | null
function rayHit(rings, p, n) {
  let best = null;
  rings.forEach((R, ri) => {
    for (let i = 0; i < R.length; i++) {
      const a = R[i], b = R[(i + 1) % R.length];
      const ex = b.x - a.x, ey = b.y - a.y, den = n.x * ey - n.y * ex;
      if (Math.abs(den) < 1e-15) continue;
      const qx = a.x - p.x, qy = a.y - p.y;
      const t = (qx * ey - qy * ex) / den, k = (qx * n.y - qy * n.x) / den;
      if (t > 1e-9 && k >= -1e-12 && k <= 1 + 1e-12 && (!best || t < best.t)) best = { ring: ri, edge: i, k: Math.min(1, Math.max(0, k)), t, point: P(p.x + n.x * t, p.y + n.y * t) };
    }
  });
  return best;
}
const NEAR_MM = 2e-3;
const CAP_TOL_MM = 0.01; // an end cap reaches the offset outline at the strip width (else another part of the outline's offset is in the way)
// the ring's vertices strictly between hit A and hit B going forward (the ring's own direction)
function ringBetween(R, A, B) {
  const pos = (h) => h.edge + h.k;
  const out = [];
  const pa = pos(A), pb = pos(B), n = R.length;
  let span = pb - pa;
  if (span <= 0) span += n;
  for (let j = Math.floor(pa) + 1; j < pa + span - 1e-12; j++) {
    const q = R[j % n];
    if (Math.hypot(q.x - A.point.x, q.y - A.point.y) > NEAR_MM && Math.hypot(q.x - B.point.x, q.y - B.point.y) > NEAR_MM) out.push(q); // the offset's own vertex at a cap point
  }
  return out;
}

/**
 * holdStrips(w, layout, side, stripWidth) -> [{ polygon, d, tabFrom, tabTo }] | null — the GAP STRIPS (the TABS rule above) of a tab layout on
 * walk w; side = +1 strips outside the part (an Outside cut), -1 inside (an Inside cut). null when a gap's offset is not one ring.
 */
export function holdStrips(w, layout, side, stripWidth) {
  const tabs = layout.tabs;
  if (!tabs.length) return [];
  const rings = offsetPolygonRound(walkPoints(w).map((p) => [p.x, p.y]), side * stripWidth, HOLD_PART.chordTolMm)
    .map((r) => { const pts = r.slice(0, -1).map(([x, y]) => P(x, y)); return signedArea(pts) < 0 ? pts.reverse() : pts; });
  if (!rings.length) return null;
  const awayAt = (s) => { const { point, tangent } = walkAt(w, s); return { point, n: P(side * tangent.y, -side * tangent.x) }; }; // right of travel = away from the part
  const out = [];
  for (let k = 0; k < tabs.length; k++) {
    const from = tabs[k], to = tabs[(k + 1) % tabs.length];
    const sa = from.s1, len = wrap(w, to.s0 - sa) || w.length;
    const A = awayAt(sa), B = awayAt(sa + len);
    const hA = rayHit(rings, A.point, A.n), hB = rayHit(rings, B.point, B.n);
    if (!hA || !hB || hA.ring !== hB.ring || Math.abs(hA.t - stripWidth) > CAP_TOL_MM || Math.abs(hB.t - stripWidth) > CAP_TOL_MM) return null; // each cap is exactly the strip width
    const pieces = subWalk(w, sa, len);
    const outer = [hA.point, ...ringBetween(rings[hA.ring], hA, hB), hB.point].reverse();
    const inner = pieces.flatMap((s) => segSamples(s));
    const polygon = [...inner, B.point, ...outer];
    const d = `M ${num(A.point.x)} ${num(A.point.y)} ${piecesD(pieces)} ${outer.map((q) => `L ${num(q.x)} ${num(q.y)}`).join(' ')} Z`;
    out.push({ polygon, d, tabFrom: k, tabTo: (k + 1) % tabs.length });
  }
  return out;
}

/**
 * applyHoldPart(cuts, rec, state) -> cuts — #core/profile-model deriveProfileCuts' cuts for `rec`, with its hold applied (unchanged, the SAME
 * array, when holdMode(rec) is 'off'). The record's own outline cut (the outer loop cut, not a hole) becomes pass 1 (rec.cutDepth = depth -
 * thickness) carrying `hold` = { mode, role: 'pass', depth, fullDepth, thickness, width, requested, count, perimeter, stripWidth, marks }
 * (marks = SVG path texts on the outline: each tab's span, or the whole outline for an onion skin); each gap strip follows it as an Inside cut
 * at the full depth with `geom` (its exported element: the strip), `polygon` = its bit-centre path (offsetSide 0) and `hold` = { mode, role: 'strip',
 * index, count, depth, d (the strip's path text, as exported), outline (the strip as a polygon, arcs sampled) }. A refused hold leaves
 * every cut as it is and puts `hold` = { mode, role: 'refused', error, ... } on the outline cut.
 */
export function applyHoldPart(cuts, rec, state) {
  const mode = holdMode(rec);
  if (mode === 'off' || !Array.isArray(cuts)) return cuts;
  if (isOnline(rec.cutType)) return onlineHold(cuts, rec, state, mode); // TASK 775
  const outer = cuts.find((c) => c && !c.isHole && c.kind === 'loop' && c.loop);
  if (!outer) return cuts;
  const D = Number(rec.cutDepth), t = Number(rec.holdThickness), width = Number(rec.tabWidth), toolDia = Number(rec.toolDia) || 0;
  const base = { mode, fullDepth: rec.cutDepth, thickness: t, width: mode === 'tabs' ? width : null };
  const withHold = (hold) => cuts.map((c) => (c === outer ? { ...c, hold } : c));
  const refuse = (error, extra = {}) => withHold({ ...base, ...extra, role: 'refused', error });
  if (rec.cutDepth === 'unset' || rec.cutDepth == null || !(D > 0)) return refuse('no cut depth');
  if (!(t > 0)) return refuse('no thickness');
  if (t >= D - 1e-9) return refuse('thickness');
  const w = loopWalk(outer.loop, state);
  if (!w) return refuse('outline');
  const depth = Math.round((D - t) * 1e9) / 1e9;
  const pass = (hold) => ({ ...outer, rec: { ...outer.rec, cutDepth: depth }, hold: { ...base, role: 'pass', depth, ...hold } });
  if (mode === 'skin') return cuts.map((c) => (c === outer ? pass({ marks: [`M ${num(segStart(w.segs[0]).x)} ${num(segStart(w.segs[0]).y)} ${piecesD(w.segs)} Z`] }) : c));
  if (!(width > 0)) return refuse('no tab width');
  const stripWidth = toolDia + HOLD_PART.stripExtraMm;
  const requested = rec.tabCount === 'auto' || !(Number(rec.tabCount) >= 1) ? autoTabCount(w.length) : Math.floor(Number(rec.tabCount));
  const side = isOutside(rec.cutType) ? 1 : -1;
  const layout = tabLayout(w, { count: requested, width, bitRadius: toolDia / 2, gap: stripWidth, side });
  const sizes = { requested, count: layout.tabs.length, perimeter: w.length, stripWidth };
  if (!layout.tabs.length) return refuse('no room', sizes);
  const strips = holdStrips(w, layout, side, stripWidth);
  if (!strips) return refuse('strip', sizes);
  const marks = layout.tabs.map((tb) => { const pc = subWalk(w, tb.s0, width), a = segStart(pc[0]); return `M ${num(a.x)} ${num(a.y)} ${piecesD(pc)}`; });
  const stripType = rec.cutType === 'outside' || rec.cutType === 'inside' ? 'inside' : 'interior';
  // the bit-CENTRE path of each strip cut by the record's bit (the strip shrunk by its radius + the record's offset, round joins: the ROBUST offset,
  // a strip is a thin loop with corners): the cut's `polygon` with offsetSide 0, so the footprint (#core/profile-model deriveCutFootprint) sweeps
  // exactly it. The export writes the strip itself (`geom`); the Origin does this offset with the real bit.
  const inset = toolDia / 2 + (Number(rec.cutOffset) || 0);
  const ring = (pts) => [...pts.map((q) => [q.x, q.y]), [pts[0].x, pts[0].y]]; // closed, as offsetPolygonRound returns its rings
  const centres = strips.map((st) => (inset !== 0 ? offsetPolygonRound(ring(st.polygon), -inset, HOLD_PART.chordTolMm) : [ring(st.polygon)]));
  if (centres.some((c) => c.length !== 1)) return refuse('strip', sizes);
  const stripCuts = strips.map((st, index) => ({
    kind: 'loop', loopId: outer.loopId, polygon: centres[index][0].slice(0, -1).map(([x, y]) => P(x, y)), cutType: stripType, offsetSide: 0, isHole: false, isCompound: false,
    rec: { ...outer.rec, cutType: stripType, cutDepth: D }, geom: { tag: 'path', a: `d="${st.d}"` },
    hold: { mode, role: 'strip', index, count: strips.length, depth: D, d: st.d, outline: st.polygon },
  }));
  const out = [];
  for (const c of cuts) { if (c === outer) out.push(pass({ ...sizes, marks }), ...stripCuts); else out.push(c); }
  return out;
}

/** The area a bit sweeps along tool-centre paths, at any radius (memoised per radius): `centers` = [{ points: [{x,y}], closed }] -> sweep(radius) =
 *  open rings [{x,y}[]] (outer contours and holes). #core/profile-model deriveCutFootprint draws a cut that carries `sweep` + `centers` with it
 *  (TASK 745's programmed pocket; TASK 775 moved it here from pocket-clearing.js, unchanged: an On line cut's strokes and lead-in use it too). */
export function sweeper(centers) {
  const memo = new Map();
  return (rr) => {
    if (!memo.has(rr)) memo.set(rr, sweepPaths(centers.map((c) => ({ points: c.points.map((p) => [p.x, p.y]), closed: c.closed })), rr, HOLD_PART.chordTolMm)
      .flatMap((g) => [g.outer, ...g.holes].map((ring) => ring.slice(0, -1).map(([x, y]) => P(x, y)))));
    return memo.get(rr);
  };
}

/**
 * TASK 775: an ON LINE record's Hold part (THE RULES above, ON LINE). Onion skin: the record's own line (the outer loop, or an open line) at depth -
 * thickness, `hold` role 'pass' as 742's. Tabs: the record's own CLOSED outline as open STROKES (kind 'stroke': `geom` = the exported open path,
 * exact lines / arcs; `centers` / `sweep` = the bit-centre line and its sweep, for the footprint) at the full depth, each with `hold` = { mode: 'tabs',
 * role: 'stroke', index, count, depth, d, requested, perimeter, width, toolDia, left (the wood a gap keeps: width - the bit diameter), marks (on the
 * first stroke: each tab's span on the outline) }. A refused hold leaves the cuts as they are, `hold` = { role: 'refused', error } on the record's own cut.
 */
function onlineHold(cuts, rec, state, mode) {
  const outer = cuts.find((c) => c && !c.isHole && c.kind === 'loop' && c.loop);
  const own = outer || cuts.find((c) => c && c.kind === 'chain');
  if (!own) return cuts;
  const D = Number(rec.cutDepth), t = Number(rec.holdThickness), width = Number(rec.tabWidth), toolDia = Number(rec.toolDia) || 0;
  const base = { mode, fullDepth: rec.cutDepth, thickness: mode === 'skin' ? t : null, width: mode === 'tabs' ? width : null, online: true };
  const refuse = (error, extra = {}) => cuts.map((c) => (c === own ? { ...c, hold: { ...base, ...extra, role: 'refused', error } } : c));
  if (mode === 'skin') {
    if (rec.cutDepth === 'unset' || rec.cutDepth == null || !(D > 0)) return refuse('no cut depth');
    if (!(t > 0)) return refuse('no thickness');
    if (t >= D - 1e-9) return refuse('thickness');
    const depth = Math.round((D - t) * 1e9) / 1e9;
    let mark = null;
    if (outer) { const w = loopWalk(outer.loop, state); if (!w) return refuse('outline'); mark = `${openPiecesD(w.segs)} Z`; }
    else mark = chainToPathD(own.chain, state);
    return cuts.map((c) => (c === own ? { ...c, rec: { ...c.rec, cutDepth: depth }, hold: { ...base, role: 'pass', depth, marks: mark ? [mark] : [] } } : c));
  }
  if (!outer) return refuse('open chain');
  if (!(width > 0)) return refuse('no tab width');
  if (!(width > toolDia + 1e-9)) return refuse('tab narrow', { toolDia });
  const w = loopWalk(outer.loop, state);
  if (!w) return refuse('outline');
  const requested = rec.tabCount === 'auto' || !(Number(rec.tabCount) >= 1) ? autoTabCount(w.length) : Math.floor(Number(rec.tabCount));
  const layout = tabLayout(w, { count: requested, width, bitRadius: toolDia / 2, gap: toolDia, side: 0 });
  const sizes = { requested, count: layout.tabs.length, perimeter: w.length, toolDia, left: width - toolDia };
  if (!layout.tabs.length) return refuse('no room', sizes);
  const marks = layout.tabs.map((tb) => openPiecesD(subWalk(w, tb.s0, width)));
  const n = layout.tabs.length;
  const strokes = layout.tabs.map((from, k) => {
    const to = layout.tabs[(k + 1) % n], len = wrap(w, to.s0 - from.s1); // one tab: the stroke runs round to its other end
    const pieces = subWalk(w, from.s1, len), d = openPiecesD(pieces), centers = [{ points: piecesPoints(pieces), closed: false }];
    return { kind: 'stroke', loopId: outer.loopId, cutType: outer.cutType, offsetSide: 0, isHole: false, isCompound: false, centers, sweep: sweeper(centers),
      rec: { ...outer.rec }, geom: { tag: 'path', a: `d="${d}"` },
      hold: { ...base, role: 'stroke', index: k, count: n, depth: rec.cutDepth, d, ...sizes, ...(k === 0 ? { marks } : {}) } };
  });
  return cuts.flatMap((c) => (c === outer ? strokes : [c]));
}
