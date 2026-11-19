// packages/core/stepped-cut.js — TASK 714: STEPPED cuts. A wall that is not vertical (a drafted pocket, a chamfered / filleted / countersunk
// edge) cut with a straight end mill as a stair of plain cuts, from the wall's shape by height (the Fusion add-in's `slope` rings, SA-7,
// docs/SELECTION-BRIDGE.md rule 3a, stored with the cut record). PURE (no DOM). The ONE place terraces are made: deriveCuts below is the
// cut derivation the export (#core/shaper-export), the Prepare preview and the 3D Review (apps/shaper cut-plan.js deriveKeyFootprints) call:
// #core/profile-model deriveProfileCuts for every cut, with a stepped cut's outer cut replaced by its terraces (steppedTerraces).
// (Not inside profile-model itself: the booleans need Clipper (#core/plot/clip.js), which profile-model's many importers do not load.)
//
// A slope = { kind, label, rings: [{ z, segments }] }: z = depth from the part's top (mm, 0 = top), segments = one closed walk in WORLD
// coordinates (base mm, y down; the importer converts the payload): { type:'line', x1,y1,x2,y2 } | { type:'arc', cx,cy,r, x1,y1,x2,y2, ccw }
// (ccw = the angle atan2(y - cy, x - cx) INCREASES from (x1,y1) to (x2,y2), in world coordinates) | { type:'circle', cx,cy,r }.
//
// THE RULES (steppedTerraces):
//  * Step k is cut at depth k * step (the last one at the cut's depth); its outline is the region the cutter may clear to that depth without
//    cutting past the design surface ANYWHERE above it: for a pocket / an inside cut the INTERSECTION of the rings from the top to that depth,
//    for an outside cut their UNION (envelope). So the stair stays in the material side of the slope (the outline at the BOTTOM of each step),
//    and an UNDERCUT (a bottom chamfer / fillet: the wall comes back below material already left above) is cut straight at the outline above
//    it (`undercutBelow` = the depth below which the design cannot be reached from the top).
//  * A ring between two read rings is INTERPOLATED (same walk structure: each line / arc / circle moves linearly; exact for a draft or a
//    chamfer, a chord for a fillet, which the add-in reads every 0.25 mm). Two read rings of a different structure: the deeper one is used
//    for the depths between them (conservative: never past the surface).
//  * Consecutive steps whose outlines are the same (every boundary point of each within SAME_OUTLINE_TOL_MM of the other's boundary) are ONE
//    cut at the deeper depth: a vertical stretch of wall is one cut, a new step exists only where the outline changes.
//  * TASK 716: no spacing setting. Every distinct step is kept (the task 714 output); `stepGaps` gives the spacing that results (the closest
//    approach, outlineGap, of each step's outline to the next), which the card note shows. A record saved by task 715 has a stepSpacing: nothing
//    here reads it, so it is ignored (it cuts the same as before 715).
//  * An outline that equals one ring (read or interpolated) keeps that ring's exact walk (lines / arcs / circles) for the export; an outline
//    the boolean actually made (an undercut, rings that cross) is the Clipper polygon (#core/plot/clip.js, 1e-3 mm grid).
import { regionsFromRings, intersectRegions, unionRegions } from './plot/clip.js';
import { num, polyToPathD, compoundPathD } from './loop-geometry.js';
import { deriveProfileCuts } from './profile-model.js';
import { applyHoldPart } from './hold-part.js'; // TASK 742: tabs / onion skin on a plain Outside / Inside cut
import { applyPocketClearing } from './pocket-clearing.js'; // TASK 745: a plain Pocket's programmed clearing (Spiral / Raster / Morphed spiral)
import { applyLeadIn } from './lead-in.js'; // TASK 775: an On line outline's lead-in leg

/** The step depth a stepped cut takes (base mm): `defaultMm` when a record has none yet. */
export const STEP_DEPTH = Object.freeze({ defaultMm: 1 });
/** TASK 717: ADAPTIVE stepping's RESOLUTION = the maximum DEVIATION of the stair from the true slope (base mm; the CAM scallop / cusp height,
 *  see stepDeviation): the named levels, the default (Medium) and a typed (Custom) value is kept as typed. */
export const STEP_RESOLUTION = Object.freeze({
  levels: Object.freeze([Object.freeze({ id: 'coarse', label: 'Coarse', mm: 0.5 }), Object.freeze({ id: 'medium', label: 'Medium', mm: 0.25 }), Object.freeze({ id: 'fine', label: 'Fine', mm: 0.1 })]),
  defaultMm: 0.25,
});
/** The named level of a deviation (base mm), or null for a typed (Custom) value. */
export const resolutionLevel = (mm) => STEP_RESOLUTION.levels.find((l) => Math.abs(l.mm - Number(mm)) < 1e-9) || null;
/** Two outlines are the SAME step when every boundary point of each lies within this distance (mm) of the other's boundary. */
export const SAME_OUTLINE_TOL_MM = 0.01;
/** Arcs and circles are sampled for the booleans and the preview with this chord sagitta (mm). */
export const RING_CHORD_TOL_MM = 0.005;
const JOIN_TOL_MM = 1e-3;   // two segment ends closer than this are one point of a ring walk
const Z_EPS = 1e-9;

const P = (x, y) => ({ x, y });
const near = (a, b, tol) => Math.hypot(a.x - b.x, a.y - b.y) <= tol;
const fin = (...v) => v.every(Number.isFinite);

function directed(seg) {
  if (!seg || typeof seg !== 'object') return null;
  const t = String(seg.type || '').toLowerCase();
  const n = (k) => Number(seg[k]);
  if (t === 'line') { const s = { type: 'line', a: P(n('x1'), n('y1')), b: P(n('x2'), n('y2')) }; return fin(s.a.x, s.a.y, s.b.x, s.b.y) && !near(s.a, s.b, 1e-9) ? s : null; }
  if (t === 'arc') { const s = { type: 'arc', c: P(n('cx'), n('cy')), r: n('r'), a: P(n('x1'), n('y1')), b: P(n('x2'), n('y2')), ccw: Boolean(seg.ccw) }; return fin(s.c.x, s.c.y, s.r, s.a.x, s.a.y, s.b.x, s.b.y) && s.r > 0 ? s : null; }
  if (t === 'circle') { const s = { type: 'circle', c: P(n('cx'), n('cy')), r: n('r') }; return fin(s.c.x, s.c.y, s.r) && s.r > 0 ? s : null; }
  return null;
}
const reversed = (s) => (s.type === 'line' ? { type: 'line', a: s.b, b: s.a } : s.type === 'arc' ? { ...s, a: s.b, b: s.a, ccw: !s.ccw } : s);

// The signed sweep (radians) of an arc segment from a to b in its direction.
function arcSweep(s) {
  const ta = Math.atan2(s.a.y - s.c.y, s.a.x - s.c.x), tb = Math.atan2(s.b.y - s.c.y, s.b.x - s.c.x);
  let sw = tb - ta;
  if (s.ccw) { while (sw <= 1e-12) sw += 2 * Math.PI; } else { while (sw >= -1e-12) sw -= 2 * Math.PI; }
  return sw;
}
const maxAngle = (r, tol) => (r <= tol ? Math.PI / 4 : Math.min(Math.PI / 4, 2 * Math.acos(1 - tol / r)));

/** A ring's segments -> its closed WALK (directed segments end to end, wound with a positive signed area in world x / y), or null when the
 *  segments do not form one closed ring. */
export function ringWalk(segments) {
  const segs = (Array.isArray(segments) ? segments : []).map(directed);
  if (!segs.length || segs.some((s) => !s)) return null;
  if (segs.length === 1) return segs[0].type === 'circle' ? [segs[0]] : null;
  if (segs.some((s) => s.type === 'circle')) return null;
  const used = new Array(segs.length).fill(false);
  const walk = [segs[0]]; used[0] = true;
  let end = segs[0].b;
  for (let k = 1; k < segs.length; k++) {
    let next = null;
    for (let i = 0; i < segs.length && !next; i++) {
      if (used[i]) continue;
      if (near(segs[i].a, end, JOIN_TOL_MM)) next = segs[i];
      else if (near(segs[i].b, end, JOIN_TOL_MM)) next = reversed(segs[i]);
      if (next) used[i] = true;
    }
    if (!next) return null;
    walk.push(next); end = next.b;
  }
  if (!near(end, walk[0].a, JOIN_TOL_MM)) return null;
  return signedArea(walkPolygon(walk)) < 0 ? walk.slice().reverse().map(reversed) : walk;
}

/** A walk -> its polygon [{x,y}] (open: the closing point is not repeated); arcs and circles sampled at `tol` chord sagitta. */
export function walkPolygon(walk, tol = RING_CHORD_TOL_MM) {
  const out = [];
  for (const s of walk) {
    if (s.type === 'line') { out.push(P(s.a.x, s.a.y)); continue; }
    if (s.type === 'circle') {
      const n = Math.max(8, Math.ceil((2 * Math.PI) / maxAngle(s.r, tol)));
      for (let k = 0; k < n; k++) { const t = (2 * Math.PI * k) / n; out.push(P(s.c.x + s.r * Math.cos(t), s.c.y + s.r * Math.sin(t))); }
      continue;
    }
    const sw = arcSweep(s), ta = Math.atan2(s.a.y - s.c.y, s.a.x - s.c.x);
    const n = Math.max(1, Math.ceil(Math.abs(sw) / maxAngle(s.r, tol)));
    out.push(P(s.a.x, s.a.y));
    for (let k = 1; k < n; k++) { const t = ta + (sw * k) / n; out.push(P(s.c.x + s.r * Math.cos(t), s.c.y + s.r * Math.sin(t))); }
  }
  return out;
}

export function signedArea(poly) {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += poly[j].x * poly[i].y - poly[i].x * poly[j].y;
  return a / 2;
}

/** A walk -> a closed SVG path "d" (lines `L`, arcs `A` with the SVG sweep flag = the walk's own direction, a circle as two half arcs).
 *  `reverse` walks it the other way (a compound path's hole). A line closing edge is left to Z, as #core/loop-geometry loopToPathD does. */
export function walkPathD(walk, { reverse = false } = {}) {
  if (!walk || !walk.length) return '';
  if (walk.length === 1 && walk[0].type === 'circle') {
    const { c, r } = walk[0], sw = reverse ? 0 : 1;
    return `M ${num(c.x - r)} ${num(c.y)} A ${num(r)} ${num(r)} 0 1 ${sw} ${num(c.x + r)} ${num(c.y)} A ${num(r)} ${num(r)} 0 1 ${sw} ${num(c.x - r)} ${num(c.y)} Z`;
  }
  const w = reverse ? walk.slice().reverse().map(reversed) : walk;
  let d = `M ${num(w[0].a.x)} ${num(w[0].a.y)}`;
  w.forEach((s, i) => {
    if (s.type === 'line') { if (i < w.length - 1) d += ` L ${num(s.b.x)} ${num(s.b.y)}`; return; }
    const sw = arcSweep(s);
    d += ` A ${num(s.r)} ${num(s.r)} 0 ${Math.abs(sw) > Math.PI ? 1 : 0} ${sw > 0 ? 1 : 0} ${num(s.b.x)} ${num(s.b.y)}`;
  });
  return d + ' Z';
}

/** A ring between two read rings: the walk at fraction t (0 = a, 1 = b) when both walks have the same structure (the same segment types in
 *  the same cyclic order and direction; the cyclic shift that pairs the closest segment starts), else null. */
export function interpolateWalk(A, B, t) {
  if (!A || !B || A.length !== B.length) return null;
  const L = (p, q) => P(p.x + (q.x - p.x) * t, p.y + (q.y - p.y) * t), l = (u, v) => u + (v - u) * t;
  if (A.length === 1) return A[0].type === 'circle' && B[0].type === 'circle' ? [{ type: 'circle', c: L(A[0].c, B[0].c), r: l(A[0].r, B[0].r) }] : null;
  const n = A.length;
  let best = -1, bestCost = Infinity;
  for (let s = 0; s < n; s++) {
    let cost = 0, ok = true;
    for (let i = 0; i < n && ok; i++) {
      const a = A[i], b = B[(i + s) % n];
      if (a.type !== b.type || (a.type === 'arc' && a.ccw !== b.ccw)) ok = false;
      else cost += (a.a.x - b.a.x) ** 2 + (a.a.y - b.a.y) ** 2;
    }
    if (ok && cost < bestCost) { bestCost = cost; best = s; }
  }
  if (best < 0) return null;
  return A.map((a, i) => {
    const b = B[(i + best) % n];
    return a.type === 'line' ? { type: 'line', a: L(a.a, b.a), b: L(a.b, b.b) } : { type: 'arc', c: L(a.c, b.c), r: l(a.r, b.r), a: L(a.a, b.a), b: L(a.b, b.b), ccw: a.ccw };
  });
}

// ── outline comparison ──
function distToSeg(p, a, b) {
  const vx = b.x - a.x, vy = b.y - a.y, len2 = vx * vx + vy * vy;
  let t = len2 > 0 ? ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy));
}
function allWithin(A, B, tol) {
  for (const p of A) {
    let ok = false;
    for (let i = 0, j = B.length - 1; i < B.length && !ok; j = i++) if (distToSeg(p, B[j], B[i]) <= tol) ok = true;
    if (!ok) return false;
  }
  return true;
}
/** The closest approach (mm) of two closed outlines' boundaries: the minimum over the vertices of each of the distance to the other's boundary. */
export function outlineGap(A, B) {
  let m = Infinity;
  for (const [P1, P2] of [[A, B], [B, A]]) {
    for (const p of P1) for (let i = 0, j = P2.length - 1; i < P2.length; j = i++) { const d = distToSeg(p, P2[j], P2[i]); if (d < m) m = d; }
  }
  return m;
}
const gapOutlines = (A, B) => Math.min(...A.flatMap((a) => B.map((b) => outlineGap(a.polygon, b.polygon))));
/** TASK 716: the closest approach (mm) between each step's outlines and the next step's: [gap(step 0, step 1), ...] (one fewer than the steps). */
export const stepGaps = (steps) => steps.slice(1).map((st, i) => gapOutlines(steps[i].outlines, st.outlines));
const BOX = new WeakMap();
function boxOf(poly) {
  let b = BOX.get(poly);
  if (!b) { b = [Infinity, Infinity, -Infinity, -Infinity]; for (const p of poly) { b[0] = Math.min(b[0], p.x); b[1] = Math.min(b[1], p.y); b[2] = Math.max(b[2], p.x); b[3] = Math.max(b[3], p.y); } BOX.set(poly, b); }
  return b;
}
/** Are two closed outlines the same within `tol` (mm)? Every vertex of each lies within tol of the other's boundary. */
export function sameOutline(A, B, tol = SAME_OUTLINE_TOL_MM) {
  if (A === B) return true;
  if (!A || !B || A.length < 3 || B.length < 3) return false;
  const a = boxOf(A), b = boxOf(B);
  for (let i = 0; i < 4; i++) if (Math.abs(a[i] - b[i]) > tol) return false;
  return allWithin(A, B, tol) && allWithin(B, A, tol);
}

const ringOf = (poly) => { const r = poly.map((p) => [p.x, p.y]); r.push([poly[0].x, poly[0].y]); return r; };
const regionOf = (poly) => regionsFromRings([ringOf(poly)], 'nonzero');
const outerPoly = (region) => region.outer.slice(0, -1).map((q) => P(q[0], q[1]));

// Parse a slope + build the per-ring ENVELOPE (the cuttable region down to each read ring) ONCE per (slope object, kind): records are never
// mutated, so the parsed form is reused across the preview, the Review and the export.
const PARSED = new WeakMap(); // slope -> Map(kind -> parsed)
function parse(slope, kind) {
  let byKind = PARSED.get(slope);
  if (!byKind) { byKind = new Map(); PARSED.set(slope, byKind); }
  if (byKind.has(kind)) return byKind.get(kind);
  const rings = [];
  for (const r of (Array.isArray(slope.rings) ? slope.rings : [])) {
    const z = Number(r && r.z);
    const walk = Number.isFinite(z) ? ringWalk(r.segments) : null;
    if (!walk) { byKind.set(kind, { error: `no closed ring at ${Number.isFinite(z) ? z : '?'} mm` }); return byKind.get(kind); }
    rings.push({ z, walk, poly: walkPolygon(walk) });
  }
  rings.sort((p, q) => p.z - q.z);
  if (rings.length < 2) { byKind.set(kind, { error: 'fewer than 2 rings' }); return byKind.get(kind); }
  const combine = kind === 'outside' ? unionRegions : intersectRegions;
  const env = [], exact = [];
  let undercutBelow = null;
  rings.forEach((ring, i) => {
    if (i === 0) { env.push(regionOf(ring.poly)); exact.push(0); return; }
    const E = combine(env[i - 1], regionOf(ring.poly));
    env.push(E);
    const one = E.length === 1 ? outerPoly(E[0]) : null;
    const ex = one && sameOutline(one, ring.poly) ? i : (one && exact[i - 1] >= 0 && sameOutline(one, rings[exact[i - 1]].poly) ? exact[i - 1] : -1);
    exact.push(ex);
    if (ex !== i && undercutBelow === null) undercutBelow = rings[i - 1].z; // this ring reaches past what the top lets the cutter reach
  });
  const parsed = { rings, env, exact, undercutBelow, combine };
  byKind.set(kind, parsed);
  return parsed;
}

// The cuttable outlines at depth d: [{ polygon, walk|null }] (walk = the exact ring when the outline is one).
function outlinesAt(pr, d) {
  const { rings, env, exact, combine } = pr;
  const last = rings.length - 1;
  const fromEnv = (i) => {
    if (exact[i] >= 0) return [{ polygon: rings[exact[i]].poly, walk: rings[exact[i]].walk }];
    return env[i].map((r) => ({ polygon: outerPoly(r), walk: null }));
  };
  if (d <= rings[0].z + Z_EPS) return fromEnv(0);
  let j = 0;
  while (j < last && rings[j + 1].z <= d + Z_EPS) j++;
  if (j === last || Math.abs(rings[j].z - d) <= Z_EPS) return fromEnv(j);
  const w = interpolateWalk(rings[j].walk, rings[j + 1].walk, (d - rings[j].z) / (rings[j + 1].z - rings[j].z));
  if (!w) return fromEnv(j + 1); // different structures: the deeper read ring (conservative)
  const wp = walkPolygon(w);
  const E = combine(env[j], regionOf(wp));
  const one = E.length === 1 ? outerPoly(E[0]) : null;
  if (one && sameOutline(one, wp)) return [{ polygon: wp, walk: w }];
  if (one && exact[j] >= 0 && sameOutline(one, rings[exact[j]].poly)) return [{ polygon: rings[exact[j]].poly, walk: rings[exact[j]].walk }];
  return E.map((r) => ({ polygon: outerPoly(r), walk: null }));
}

// ── TASK 717: ADAPTIVE stepping (the step placement by a RESOLUTION, the CAM scallop / cusp height) ──
// THE DEVIATION of one step, from depth a (the previous step's floor, or the part's top) to depth b (this step's floor), the step cut at the
// conservative bottom-of-step outline O(b) as every step is: in the PROFILE PLANE at a point q of O(b)'s boundary, with u = the distance from q
// to the boundary of the cuttable outline O(t) at the depth t, the TRUE WALL is the curve (u_q(t), t) for t from a to b (u_q(b) = 0), and the
// STAIR is the TREAD at depth a (from the wall to q) and the RISER through q (from a down to b). The wall never moves away from the riser as t
// grows (the outlines are nested: O(b) inside O(t) for a pocket / an inside cut, around it for an outside cut, so u_q does not increase), and
// for such a wall the farthest point of either curve from the other is the stair's INNER CORNER (q at depth a): the deviation (the HAUSDORFF
// distance of the two profile curves) = the distance from that corner to the wall (WORK-LOG TURN 717 gives the proof). A straight wall at the
// angle A from vertical: h * sin(A) for a step of height h.
// Evaluated on the slope rings: the wall is the polyline through t = a, every read ring depth between, and b (u is linear between read rings:
// the rings are interpolated linearly), plus the deeper read ring just below a read ring whose next ring does not interpolate (the
// conservative jump of outlinesAt); the corner distance = the min over that polyline's segments of the point-to-segment distance; the step's
// deviation = the MAX over every vertex q of O(b)'s outlines (the ring walks' polygons: arcs sampled at RING_CHORD_TOL_MM).
const JUMP_DZ_MM = 1e-6;  // the deeper ring is sampled this far below a read ring that does not interpolate to the next one
const ORIGIN = P(0, 0);
function boundaryDist(p, polys) {
  let m = Infinity;
  for (const Q of polys) for (let i = 0, j = Q.length - 1; i < Q.length; j = i++) { const d = distToSeg(p, Q[j], Q[i]); if (d < m) m = d; }
  return m;
}
// The deviation of the step a -> b (mm); `at(t)` = the outlines at depth t (memoised by the caller). Stops early once it exceeds `limit`.
function deviationOf(pr, a, b, at, limit = Infinity) {
  const { rings } = pr;
  if (!pr.jumps) pr.jumps = rings.map((r, j) => j < rings.length - 1 && !interpolateWalk(r.walk, rings[j + 1].walk, 0.5));
  const ts = [a];
  rings.forEach((r, j) => {
    if (r.z > a + Z_EPS && r.z < b - Z_EPS) ts.push(r.z);
    if (pr.jumps[j] && r.z >= a - Z_EPS && r.z + JUMP_DZ_MM < b - Z_EPS) ts.push(r.z + JUMP_DZ_MM);
  });
  ts.push(b);
  ts.sort((p, q) => p - q);
  const polys = ts.map((t) => at(t).map((o) => o.polygon));
  let worst = 0;
  for (const o of at(b)) {
    for (const q of o.polygon) {
      let r = Infinity, prev = null;
      for (let i = 0; i < ts.length && r > 0; i++) {
        const pt = P(boundaryDist(q, polys[i]), ts[i] - a);
        if (prev) { const d = distToSeg(ORIGIN, prev, pt); if (d < r) r = d; }
        prev = pt;
      }
      if (r > worst) { worst = r; if (worst > limit) return worst; }
    }
  }
  return worst;
}
const memoAt = (pr) => {
  const zMax = pr.rings[pr.rings.length - 1].z, memo = new Map();
  return (t) => { const k = Math.min(t, zMax); let o = memo.get(k); if (!o) { o = outlinesAt(pr, k); memo.set(k, o); } return o; };
};
// THE PLACEMENT: walking down from the slope's top, each next step at the DEEPEST depth (to 0.001 mm) whose step stays within `tol`: the
// cut's full depth when that step is within it, else the bisection between the previous floor (a step of 0: within) and the full depth (not).
// The deviation grows with b (a deeper floor only widens the leftover), so the bisection finds that depth. A wall that jumps right below a
// (a flat shelf: no step can stay within) gets a 0.001 mm step, so the walk always ends. Memoised per (parsed slope, tol, depth).
const UM = 1000;
const ADAPTIVE = new WeakMap(); // parsed slope -> Map(`${tol}|${D}` -> depths)
function adaptiveDepths(pr, tol, D) {
  let byKey = ADAPTIVE.get(pr);
  if (!byKey) { byKey = new Map(); ADAPTIVE.set(pr, byKey); }
  const key = `${tol}|${D}`;
  if (byKey.has(key)) return byKey.get(key);
  const at = memoAt(pr), within = (a, b) => deviationOf(pr, a, b, at, tol) <= tol;
  const um = (a, n) => Math.round(a * UM + n) / UM;
  const depths = [];
  let a = pr.rings[0].z;
  while (a < D - Z_EPS) {
    if (within(a, D)) { depths.push(D); break; }
    let lo = 0, hi = Math.ceil((D - a) * UM - 1e-6); // in 0.001 mm below a: lo is within, hi is not (it reaches D)
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (within(a, um(a, mid))) lo = mid; else hi = mid; }
    a = um(a, Math.max(1, lo));
    depths.push(a);
  }
  if (!depths.length) depths.push(D);
  byKey.set(key, depths);
  return depths;
}
/** TASK 717: the deviation (mm) of the step from depth `from` to depth `to` of a slope (the ONE measure adaptive stepping places steps by). */
export function stepDeviation(slope, { kind = 'pocket', from, to } = {}) {
  const k = kind === 'outside' ? 'outside' : kind === 'inside' ? 'inside' : 'pocket';
  const pr = slope && typeof slope === 'object' ? parse(slope, k) : { error: 'no slope' };
  if (pr.error) return null;
  return deviationOf(pr, Number(from), Number(to), memoAt(pr));
}

/** The slope rule a plain cut type follows: 'pocket' | 'inside' | 'outside' (the CUT_TYPES ids and the Shaper names both read). */
export function terraceKind(cutType) {
  if (cutType === 'exterior' || cutType === 'outside') return 'outside';
  if (cutType === 'interior' || cutType === 'inside') return 'inside';
  return 'pocket';
}

const sameOutlines = (A, B) => A.length === B.length && A.every((o, i) => sameOutline(o.polygon, B[i].polygon));

/** TASK 717: a stepped cut record -> its steppedTerraces options (the ONE mapping, for the derivation and the card note): the step depth, the
 *  cut depth, and when the record has `adaptiveSteps` ON its `stepDeviation` (base mm; STEP_RESOLUTION.defaultMm when it has none). */
export function terraceOptions(rec) {
  const o = { kind: terraceKind(rec.terraceAs), step: rec.stepDepth, depth: rec.cutDepth };
  if (rec.adaptiveSteps === true) o.deviation = Number(rec.stepDeviation) > 0 ? Number(rec.stepDeviation) : STEP_RESOLUTION.defaultMm;
  return o;
}

/**
 * steppedTerraces(slope, { kind, step, depth, deviation }) -> { steps, undercutBelow, zTop, zMax, error } (+ `deviation` when adaptive)
 *   kind   'pocket' | 'inside' | 'outside' (pocket and inside clear the INTERSECTION of the rings above a depth, outside keeps their UNION)
 *   step   the step depth (base mm; STEP_DEPTH.defaultMm when missing)
 *   deviation  TASK 717: ADAPTIVE stepping when > 0: the steps are placed by this maximum deviation (base mm;
 *          adaptiveDepths) instead of every `step`; everything else (outlines, merge, undercut) is the same
 *   depth  the cut's full depth (base mm); missing / unset = the slope's deepest ring. Below the deepest ring the wall is vertical.
 *   steps  [{ depth, outlines: [{ polygon:[{x,y}], walk|null }] }], shallow to deep, identical consecutive steps merged into the deeper one
 *   undercutBelow  the depth (mm) below which the wall comes back under material left above (cut straight there), or null
 *   error  why there are no steps (a ring that does not close, fewer than 2 rings), else null
 */
export function steppedTerraces(slope, { kind = 'pocket', step, depth, deviation } = {}) {
  const none = (error) => ({ steps: [], undercutBelow: null, zTop: null, zMax: null, error });
  if (!slope || typeof slope !== 'object') return none('no slope');
  const k = kind === 'outside' ? 'outside' : kind === 'inside' ? 'inside' : 'pocket';
  const pr = parse(slope, k);
  if (pr.error) return none(pr.error);
  const zMax = pr.rings[pr.rings.length - 1].z;
  const D = Number(depth) > 0 && depth !== true ? Number(depth) : zMax;
  const tol = Number(deviation) > 0 ? Number(deviation) : null;
  let depths;
  if (tol !== null) depths = adaptiveDepths(pr, tol, D);
  else {
    const s = Number(step) > 0 ? Number(step) : STEP_DEPTH.defaultMm;
    depths = [];
    for (let i = 1; i * s < D - Z_EPS; i++) depths.push(Math.round(i * s * 1e9) / 1e9);
    depths.push(D);
  }
  // identical steps merge into the DEEPER one (the bottom-of-step rule), compared with the run's FIRST outline (its reference), never with the step just merged:
  // a gradual slope otherwise creeps into one step, so a smaller step could give fewer steps. Drift inside one merged step stays within SAME_OUTLINE_TOL_MM.
  const steps = [];
  let reference = null;
  for (const d of depths) {
    const outlines = outlinesAt(pr, Math.min(d, zMax));
    if (steps.length && sameOutlines(reference, outlines)) steps[steps.length - 1] = { depth: d, outlines };
    else { steps.push({ depth: d, outlines }); reference = outlines; }
  }
  const undercut = pr.undercutBelow !== null && pr.undercutBelow < D - Z_EPS ? pr.undercutBelow : null;
  const out = { steps, undercutBelow: undercut, zTop: pr.rings[0].z, zMax, error: null };
  if (tol !== null) out.deviation = tol;
  return out;
}

/**
 * deriveCuts(target, rec, state, loops, loopPolys, ownedLoops) — THE cut derivation of a plan entry (same arguments and result as
 * #core/profile-model deriveProfileCuts, which it returns unchanged for every record without `terraceAs`).
 * A STEPPED cut: `rec.terraceAs` = the plain type each step is cut as (the app injects it from its cut type's declaration:
 * 'pocket' | 'interior' | 'exterior'), `rec.slope` = the wall's rings (#core/stepped-cut.js). The plain type's own cuts (this function with
 * rec.cutType = terraceAs), with its OUTER cut replaced by one cut per terrace from steppedTerraces (THE one terrace derivation), shallow to
 * deep: a copy of that cut with the step's outline (`polygon`, or `outerPoly` for a pocket, which keeps its islands), its depth
 * (rec.cutDepth), `geom` (the exported element: the ring's exact lines / arcs / circle, or the boolean's polygon) and
 * `terrace` = { index, count, depth, undercutBelow, label }. The plain cut's other cuts (an Outside plate's holes) are kept as they are.
 * No slope, or a slope that does not read (steppedTerraces error): no cut at all (never a straight cut in its place).
 * TASK 742: a plain record's cuts go through #core/hold-part applyHoldPart (tabs / onion skin; the same array when the record holds nothing).
 * A stepped record never holds its part (holdMode is 'off' for it).
 * TASK 745: then through #core/pocket-clearing applyPocketClearing (a plain Pocket's programmed clearing; the same array when the record is Freehand).
 * A stepped pocket is never programmed (clearingPattern is 'freehand' for it).
 * TASK 775: then through #core/lead-in applyLeadIn (an On line outline's lead-in leg; the same array when the record has none). A programmed pocket's
 * lead-in legs are made by its clearing plan (Loop on).
 */
export function deriveCuts(target, rec, state, loops, loopPolys, ownedLoops) {
  if (!rec || !rec.terraceAs) return applyLeadIn(applyPocketClearing(applyHoldPart(deriveProfileCuts(target, rec, state, loops, loopPolys, ownedLoops), rec, state), rec, state), rec, state); // TASK 742 / 745 / 775: unchanged unless the record holds its part / programs its pocket / has a lead-in
  const { terraceAs, slope, ...rest } = rec;
  if (!slope) return [];
  const plain = deriveProfileCuts(target, { ...rest, cutType: terraceAs }, state, loops, loopPolys, ownedLoops);
  const outer = plain.find((c) => !c.isHole && c.kind !== 'chain');
  if (!outer) return [];
  const T = steppedTerraces(slope, terraceOptions(rec)); // TASK 717: the step depth, or the adaptive deviation
  if (!T.steps.length) return [];
  const ref = outer.isCompound ? outer.outerPoly : outer.polygon;
  const flip = ref && ref.length >= 3 && signedArea(ref) < 0; // wind each outline like the target's own outer loop (a pocket's holes go the other way)
  const terraced = [];
  T.steps.forEach((st, index) => {
    for (const o of st.outlines) {
      const polygon = flip ? o.polygon.slice().reverse() : o.polygon;
      const d = o.walk ? walkPathD(o.walk, { reverse: flip }) : polyToPathD(polygon);
      const terrace = { index, count: T.steps.length, depth: st.depth, undercutBelow: T.undercutBelow, label: slope.label || null };
      const r = { ...outer.rec, cutDepth: st.depth };
      if (outer.isCompound) {
        const full = compoundPathD(outer.outerLoop, outer.holeLoops, state, { outerD: d }); // TASK 786: each island wound opposite to THIS terrace's outline
        terraced.push({ ...outer, outerPoly: polygon, d: full, geom: { tag: 'path', a: `d="${full}"` }, rec: r, terrace });
      } else {
        const c = o.walk && o.walk.length === 1 && o.walk[0].type === 'circle' ? o.walk[0] : null;
        const geom = c ? { tag: 'circle', a: `cx="${num(c.c.x)}" cy="${num(c.c.y)}" r="${num(c.r)}"` } : { tag: 'path', a: `d="${d}"` };
        terraced.push({ ...outer, polygon, geom, rec: r, terrace });
      }
    }
  });
  return [...plain.filter((c) => c !== outer), ...terraced];
}
