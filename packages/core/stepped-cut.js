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
import { regionsFromRings, intersectRegions, unionRegions, diffRegions, offsetRegions, offsetPolygonRound, sweepPaths, regionsArea } from './plot/clip.js';
import { num, polyToPathD, compoundPathD } from './loop-geometry.js';
import { deriveProfileCuts } from './profile-model.js';
import { applyHoldPart } from './hold-part.js'; // TASK 742: tabs / onion skin on a plain Outside / Inside cut
import { applyPocketClearing } from './pocket-clearing.js'; // TASK 745: a plain Pocket's programmed clearing (Spiral / Raster / Morphed spiral)
import { applyLeadIn } from './lead-in.js'; // TASK 775: an On line outline's lead-in leg
import { smoothRegions, smoothRing, intersectSmoothed, ringPathD, smoothingOf } from './level-smooth.js'; // TASK 809: Smoothing, a toolpath setting of Roughing / Contour

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
// TASK 792 (performance): every vertex of A within `tol` of B's boundary. B's edges are binned once in a uniform grid (each edge in every cell its
// box grown by tol touches), so a vertex is tested only against the edges of its own cell: an edge outside that cell is farther than tol from the
// vertex, so the answer is exactly the all-pairs one (the same distToSeg test, the same <= tol), in about O(n) instead of O(n x m). Small rings
// keep the plain loop. The 790 rose's 2,700-point outlines took ~0.1 s per comparison all-pairs.
const GRID_MIN = 64;
const EDGE_GRID = new WeakMap(); // B -> Map(tol -> grid)
function edgeGrid(B, tol) {
  let byTol = EDGE_GRID.get(B);
  if (!byTol) { byTol = new Map(); EDGE_GRID.set(B, byTol); }
  let g = byTol.get(tol);
  if (g) return g;
  const bx = boxOf(B), n = B.length;
  const w = Math.max(bx[2] - bx[0], bx[3] - bx[1], tol);
  const h = Math.max(tol * 2, w / Math.max(1, Math.sqrt(n)));
  const cols = Math.max(1, Math.ceil((bx[2] - bx[0] + 2 * tol) / h) + 1), rows = Math.max(1, Math.ceil((bx[3] - bx[1] + 2 * tol) / h) + 1);
  const x0 = bx[0] - tol, y0 = bx[1] - tol;
  const cells = new Map();
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const a = B[j], b = B[i];
    const c0 = Math.floor((Math.min(a.x, b.x) - tol - x0) / h), c1 = Math.floor((Math.max(a.x, b.x) + tol - x0) / h);
    const r0 = Math.floor((Math.min(a.y, b.y) - tol - y0) / h), r1 = Math.floor((Math.max(a.y, b.y) + tol - y0) / h);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) { const k = r * cols + c; let l = cells.get(k); if (!l) cells.set(k, (l = [])); l.push(j); }
  }
  g = { x0, y0, h, cols, rows, cells };
  byTol.set(tol, g);
  return g;
}
function allWithin(A, B, tol) {
  if (A.length * B.length < GRID_MIN * GRID_MIN) {
    for (const p of A) {
      let ok = false;
      for (let i = 0, j = B.length - 1; i < B.length && !ok; j = i++) if (distToSeg(p, B[j], B[i]) <= tol) ok = true;
      if (!ok) return false;
    }
    return true;
  }
  const g = edgeGrid(B, tol), n = B.length;
  for (const p of A) {
    const c = Math.floor((p.x - g.x0) / g.h), r = Math.floor((p.y - g.y0) / g.h);
    const list = c >= 0 && r >= 0 && c < g.cols && r < g.rows ? g.cells.get(r * g.cols + c) : null;
    let ok = false;
    if (list) for (let k = 0; k < list.length && !ok; k++) { const j = list[k]; if (distToSeg(p, B[j], B[(j + 1) % n]) <= tol) ok = true; }
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
  const o = { kind: terraceKind(rec.terraceAs), step: rec.stepDepth, depth: rec.levelsOp === 'contour' ? rec.baseDepth : rec.cutDepth }; // TASK 792: a Contour runs to its part's depth
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
  if (rec && rec.levelsOp) return deriveLevelsCuts(target, rec, state, loops, loopPolys, ownedLoops); // TASK 792: Roughing / Contour
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

// ═══ TASK 792: ROUGHING and CONTOUR (owner turns 2474-2512) ═══════════════════════════════════════════════════════════════════════════════════════
// Two OPERATIONS for any part with depth information, each a set of plain XY cuts at fixed depths (the Origin cuts every path at ONE depth). The app
// declares them on its cut types (`levelsOp`, injected into the record as `terraceAs` was): deriveCuts above sends such a record here.
//  * ROUGHING ('roughing'; it REPLACES the stepped types of TASK 714: a stepped record opens as Roughing with allowance 0, which IS the stepped cut):
//    clear what lies above each level of the rough step (`stepDepth`), leaving `finishAllowance` on every wall for the Contour.
//  * CONTOUR ('contour'): the FINISH: an XY pass ALONG the walls at each level of the fine step (its own `stepDepth`, LEVELS.contourStepMm by
//    default), offset by the bit radius on the waste side (the Origin's Outside / Inside cut: material inside the loop = Outside cut, a hole in the
//    material = Inside cut), no clearing, its own bit (a ball nose is modelled by the 3D Review: relief-model's shaped-cutter terraces). The app keeps
//    it as its own record next to the part's (cut-plan.js: key `contour:<the part's key>`) and hands it the part's `slope` / `levels` / depth as
//    `baseDepth` / `baseType`.
// WHERE THE LEVELS COME FROM (both operations read them the same way):
//  1. `rec.levels` (readLevels: the payload's optional `levels` field, an STL's sections: #core/stl-slice.js): the part's MATERIAL SECTIONS by depth.
//     "The material at d" = the UNION of every section from the top down to d (the bottom-of-step rule of steppedTerraces applied to material: a cut
//     at d never touches what any section above d keeps; an undercut is cut straight). Roughing at d = ONE POCKET over the WORK AREA W minus that
//     material grown by the allowance, every material island a hole (each connected area is one pocket element: its outer + its holes). W = the part's
//     outline (the target's outer loop) grown by the allowance + LEVELS.workMarginBits bit diameters: the bit itself + the Origin's automatic pocket
//     offset (a quarter bit, apps/shaper shaper.js autoOffsetFraction) on each side take 1.5 bits; the half bit more lets the bit TRAVEL round the part at
//     its deepest level (at 1.5 the band only just holds the bit: the Origin could not move it, and the drawn footprint is empty).
//     Not the Stock outline: an STL has none, and wood farther out than one bit from the part is not in the part's way. Contour at d = an Outside cut
//     along each outer loop of that material and an Inside cut along each of its holes.
//     TASK 810 (owner turn 2656): that work area is the USER'S choice (ROUGH_BOUNDARY, roughingBoundary / roughingWorkGrow below): the BOUNDARY (the part's
//     silhouette, its bounding box, the Stock outline, or a closed shape the user picked), the TOOL rule (the bit inside / centred on / outside the boundary) and
//     an OFFSET; the defaults (Silhouette, Outside, the offset calculated: allowance + 3/4 bit) ARE the work area above, to the bit.
//  2. else `rec.slope` (a Fusion region's rings, SA-7): THE stepped engine above, unchanged: steppedTerraces at the step, every level cut as the
//     region's own plain type (levelsCutAs: pocket / inside / outside); Roughing's allowance goes into the cut OFFSET (the Origin leaves it on every
//     wall), so allowance 0 is byte for byte the stepped cut of TASKS 714-717. Contour = the same terraces at its fine step as Inside cuts (a pocket,
//     a hole) or Outside cuts (an outline); next to a plain Outside / Inside cut (which cuts its own wall) the level whose outline IS that wall is
//     not cut again. A plain Pocket does not finish its wall (the Origin keeps it back by its automatic offset): the Contour does.
//  3. else the drawn region is ONE level at its depth: Roughing = the pocket with the allowance (offset), Contour = its wall (an Inside cut along the
//     outer, an Outside cut round each island).
// Consecutive identical levels are ONE cut at the deeper depth (a vertical wall is cut once), as in steppedTerraces.
// drawTolMm: the round joins of the DRAWN footprints (Prepare, the 3D Review) are within this of the true arc, and a contour's drawn centre path within
// this of its offset (a display tolerance: a part's levels are thousands of points; at the 0.005 mm of the exported shapes' sampling the rose's first Review
// build took 90 s, at 0.05 mm 14 s, at 0.1 mm 8 s; the export never reads it).
// pocketKeepBackBits: the Origin's automatic pocket offset (a quarter of the bit: apps/shaper shaper.js CUT_TYPES pocket autoOffsetFraction, the same
// number), which a terrace's spill must cross; sliverMm2: a terrace / path piece smaller than this is boolean noise (the 1e-3 mm grid), not a path.
export const LEVELS = Object.freeze({ contourStepMm: 0.25, workMarginBits: 2, drawTolMm: 0.1, pocketKeepBackBits: 0.25, sliverMm2: 0.01 });

const r6 = (v) => Math.round(v * 1e6) / 1e6;
// one loop of the payload (its segments, in the payload frame) -> its polygon as a flat [x0, y0, x1, y1, ...] in WORLD mm (the same transform as
// fusion-import.js slopeFromRegion: x * scale, y * scale negated for a Y-up payload, an arc's direction flipped with it), or null when it does not close
function loopFlat(segments, scale, ys) {
  const raw = (Array.isArray(segments) ? segments : []).map((q) => {
    const t = String((q && q.type) || '').toLowerCase(), n = (k) => Number(q[k]) * scale, y = (k) => ys * Number(q[k]) * scale;
    if (t === 'line') return { type: 'line', x1: n('x1'), y1: y('y1'), x2: n('x2'), y2: y('y2') };
    if (t === 'arc') return { type: 'arc', cx: n('cx'), cy: y('cy'), r: n('r'), x1: n('x1'), y1: y('y1'), x2: n('x2'), y2: y('y2'), ccw: ys < 0 ? !q.ccw : Boolean(q.ccw) };
    if (t === 'circle') return { type: 'circle', cx: n('cx'), cy: y('cy'), r: n('r') };
    return { type: t };
  });
  const segs = raw.map(directed);
  if (!segs.length || segs.some((s) => !s)) return null;
  const inOrder = segs.length > 1 && !segs.some((s) => s.type === 'circle') && segs.every((s, i) => near(s.a, segs[(i + segs.length - 1) % segs.length].b, JOIN_TOL_MM));
  const walk = segs.length === 1 && segs[0].type === 'circle' ? segs : inOrder ? segs : ringWalk(raw); // the slicer writes a loop end to end: no search
  if (!walk) return null;
  const out = [];
  for (const p of walkPolygon(walk)) out.push(r6(p.x), r6(p.y));
  return out.length >= 6 ? out : null;
}
/** The payload's `levels` (TASK 792: [{ zFromTopMm, loops: [{ segments }] }], see #core/stl-slice.js) -> the cut record's `levels` = [{ z, loops: [flat
 *  polygon [x0, y0, ...] in world mm] }] shallow to deep (plain JSON: saved and undone with the record), or null when there are none or a loop does not
 *  close (the importer warns and imports the region without them). */
export function readLevels(raw, { scale = 1, yUp = true } = {}) {
  if (!Array.isArray(raw) || !raw.length) return null;
  const ys = yUp ? -1 : 1, out = [];
  for (const lv of raw) {
    const z = Number(lv && lv.zFromTopMm);
    if (!Number.isFinite(z)) return null;
    const loops = [];
    for (const L of (Array.isArray(lv.loops) ? lv.loops : [])) { const f = loopFlat(L && L.segments, scale, ys); if (!f) return null; loops.push(f); }
    out.push({ z, loops });
  }
  return out.sort((a, b) => a.z - b.z);
}
export const hasLevels = (rec) => Boolean(rec && Array.isArray(rec.levels) && rec.levels.length);

/** The plain type each level of a Roughing / Contour record is cut as: 'pocket' | 'interior' | 'exterior' (a levels Contour mixes Outside and Inside
 *  cuts: 'exterior' is returned for it, its holes are Inside cuts). */
export function levelsCutAs(rec) {
  if (!rec) return 'pocket';
  const kind = rec.slope && rec.slope.kind;
  if (rec.levelsOp === 'contour') {
    if (hasLevels(rec)) return 'exterior';
    const k = kind || (rec.baseType === 'exterior' ? 'outside' : 'pocket');
    return k === 'outside' ? 'exterior' : 'interior';
  }
  if (hasLevels(rec)) return 'pocket';
  return kind === 'outside' ? 'exterior' : kind === 'inside' ? 'interior' : 'pocket';
}
/** A Roughing record's allowance (base mm, >= 0; 0 for any other record). */
export const roughingAllowance = (rec) => (rec && rec.levelsOp === 'roughing' ? Math.max(0, Number(rec.finishAllowance) || 0) : 0);
/** The record a Roughing / Contour record's cuts are made AND drawn with: a Roughing record without `levels` takes its allowance as cut offset (path 2 / 3
 *  of the header); a Contour (its card has no depth row) its part's depth (`baseDepth`: the depth Prepare's chip shows). Every other record as it is. */
export function levelsWorkRecord(rec) {
  if (rec && rec.levelsOp === 'contour') return { ...rec, cutDepth: rec.baseDepth };
  const a = roughingAllowance(rec);
  return a > 0 && !hasLevels(rec) ? { ...rec, cutOffset: (Number(rec.cutOffset) || 0) + a } : rec;
}

// ── the section STACK of a levels list: per section its depth and the CUMULATIVE material (the union of every section from the top down to it) ──
const flatRing = (f) => { const r = []; for (let i = 0; i + 1 < f.length; i += 2) r.push([f[i], f[i + 1]]); if (r.length) r.push(r[0].slice()); return r; };
const STACKS = new WeakMap(); // levels array (never mutated) -> stack
function levelStack(levels) {
  let s = STACKS.get(levels);
  if (s) return s;
  const zs = [], cumulative = [];
  let C = [];
  for (const lv of levels) {
    const M = lv.loops.length ? regionsFromRings(lv.loops.map(flatRing), 'evenodd') : [];
    C = !C.length ? M : M.length ? unionRegions(C, M) : C;
    zs.push(lv.z); cumulative.push(C);
  }
  s = { zs, cumulative, memo: new Map() };
  STACKS.set(levels, s);
  return s;
}
// the section a cut at depth d reads: the first at or below d (its cumulative material holds everything above d: conservative), else the deepest
const sectionAt = (st, d) => { for (let i = 0; i < st.zs.length; i++) if (st.zs[i] >= d - Z_EPS) return i; return st.zs.length - 1; };
const ptsOf = (ring) => ring.slice(0, -1).map((q) => P(q[0], q[1]));
const POLYS = new WeakMap(); // regions -> [{ polygon, outer }] (one per ring; the polygons are reused, so their boxes / edge grids are built once)
function regionLoops(regions) {
  let l = POLYS.get(regions);
  if (!l) { l = regions.flatMap((g) => [{ polygon: ptsOf(g.outer), outer: true }, ...g.holes.map((h) => ({ polygon: ptsOf(h), outer: false }))]); POLYS.set(regions, l); }
  return l;
}
function sameRegionSets(A, B) {
  if (A === B) return true;
  const a = regionLoops(A), b = regionLoops(B);
  if (a.length !== b.length) return false;
  const used = new Uint8Array(b.length);
  for (const p of a) {
    let hit = -1;
    for (let i = 0; i < b.length && hit < 0; i++) if (!used[i] && b[i].outer === p.outer && sameOutline(p.polygon, b[i].polygon)) hit = i;
    if (hit < 0) return false;
    used[hit] = 1;
  }
  return true;
}
function depthList(step, D) {
  const s = Number(step) > 0 ? Number(step) : STEP_DEPTH.defaultMm, out = [];
  for (let i = 1; i * s < D - Z_EPS; i++) out.push(Math.round(i * s * 1e9) / 1e9);
  out.push(D);
  return out;
}
const narrowerThan = (ring, dia) => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const q of ring) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); } return Math.min(x1 - x0, y1 - y0) < dia; };

// ── TASK 792 (owner turns 2600-2602): the cutting ORDER of a levels operation: DEPTH-FIRST PER AREA. An area = one connected piece of the part's
// top removal region (Roughing) / of its deepest material (Contour); the areas in travel order (the top-left one first, then always the nearest next);
// inside an area its paths shallow to deep, the paths of one level nearest-next. (For AutoPass the order changes no depth: every path is cut from the
// surface; depth-first keeps the bit in one area, shallow before deep as the owner reads a part.) ──
const boxOfRing = (ring) => { const b = [Infinity, Infinity, -Infinity, -Infinity]; for (const q of ring) { if (q[0] < b[0]) b[0] = q[0]; if (q[1] < b[1]) b[1] = q[1]; if (q[0] > b[2]) b[2] = q[0]; if (q[1] > b[3]) b[3] = q[1]; } return b; };
const centreOf = (b) => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
const boxIn = (a, b, eps = 1e-3) => a[0] >= b[0] - eps && a[1] >= b[1] - eps && a[2] <= b[2] + eps && a[3] <= b[3] + eps;
// the area of a path: the smallest area box that holds its box
const areaOfBox = (box, areaBoxes) => { let best = -1, size = Infinity; areaBoxes.forEach((b, i) => { const s = (b[2] - b[0]) * (b[3] - b[1]); if (boxIn(box, b) && s < size) { size = s; best = i; } }); return best < 0 ? 0 : best; };
function depthFirstPerArea(items, areaBoxes) {
  const boxes = areaBoxes.length ? areaBoxes : [[-Infinity, -Infinity, Infinity, Infinity]];
  const byArea = boxes.map(() => []);
  for (const it of items) byArea[areaOfBox(it.box, boxes)].push(it);
  const out = [];
  let at = null;
  const nearestFirst = (list) => {
    const left = list.slice(), seq = [];
    while (left.length) {
      let k = 0;
      if (at) { let d = Infinity; left.forEach((x, i) => { const c = centreOf(x.box), e = Math.hypot(c[0] - at[0], c[1] - at[1]); if (e < d) { d = e; k = i; } }); }
      else left.forEach((x, i) => { if (x.box[1] < left[k].box[1] - 1e-9 || (Math.abs(x.box[1] - left[k].box[1]) <= 1e-9 && x.box[0] < left[k].box[0])) k = i; });
      const [x] = left.splice(k, 1); seq.push(x); at = centreOf(x.box);
    }
    return seq;
  };
  for (const area of nearestFirst(byArea.map((list, i) => ({ box: boxes[i], list })).filter((a) => a.list.length))) {
    for (const lv of [...new Set(area.list.map((x) => x.level))].sort((p, q) => p - q)) out.push(...nearestFirst(area.list.filter((x) => x.level === lv)));
  }
  return out;
}

// ── TASK 810 (owner turn 2656: "is the machining area outside or inside the geometry, and any offset from that" is the user's decision): Roughing's MACHINING
// BOUNDARY, a part with levels (a sloped or drawn region's Roughing cuts its own region). Record fields: `boundary` (ROUGH_BOUNDARY.kinds; none = Silhouette),
// `boundaryShape` (the plan key of the picked closed shape, 'loop:<id>' | 'profile:<id>': the app resolves it, and the Stock's, into `boundaryTarget`), `boundaryTool`
// (ROUGH_BOUNDARY.tools; none = Outside), `boundaryOffset` (base mm, signed: + moves the boundary out, - in, before the tool rule; none / null = CALCULATED).
// THE RULE: the bit's CENTRE may go as far as the boundary moved by the offset, then by the tool rule (Inside: one bit radius in, so its edge stays inside the
// line; On: on it; Outside: one bit radius out, so its edge just touches the line from outside). The pocket written (the work area W) is that limit grown by
// what the Origin keeps its bit back from a pocket's line: the bit radius + its automatic offset (LEVELS.pocketKeepBackBits). So W = the boundary grown by
// offset + boundaryToolBits(tool) bit diameters, boundaryToolBits = (centre in radii) / 2 + 1/2 + 1/4: Inside 0.25, On 0.75, Outside 1.25.
// THE DEFAULTS reproduce TASK 792's work area exactly (the silhouette grown by the allowance + LEVELS.workMarginBits = 2 bits): Silhouette, Outside, and the
// calculated offset = the allowance + BOUNDARY_CALC_OFFSET_BITS bit diameters, BOUNDARY_CALC_OFFSET_BITS = 2 - 1.25 = 0.75; the growth is then written
// allowance + (0.75 + 1.25) * bit = allowance + 2 * bit, the same floating-point operations as before (0.75 + 1.25 is exactly 2), so the export is byte for byte the same.
export const ROUGH_BOUNDARY = Object.freeze({
  kinds: Object.freeze([Object.freeze({ id: 'silhouette', label: 'Silhouette' }), Object.freeze({ id: 'box', label: 'Bounding box' }), Object.freeze({ id: 'stock', label: 'Stock' }), Object.freeze({ id: 'shape', label: 'Shape' })]),
  tools: Object.freeze([Object.freeze({ id: 'inside', label: 'Inside', centreRadii: -1 }), Object.freeze({ id: 'on', label: 'On', centreRadii: 0 }), Object.freeze({ id: 'outside', label: 'Outside', centreRadii: 1 })]),
  defaultKind: 'silhouette', defaultTool: 'outside',
});
/** The work area's growth past the (offset) boundary for a tool rule, in bit diameters (the rule above). */
export const boundaryToolBits = (toolId) => (ROUGH_BOUNDARY.tools.find((t) => t.id === toolId) || ROUGH_BOUNDARY.tools.find((t) => t.id === ROUGH_BOUNDARY.defaultTool)).centreRadii / 2 + 0.5 + LEVELS.pocketKeepBackBits;
/** The calculated offset's bit diameters (+ the wall allowance): what makes the defaults TASK 792's work area. */
export const BOUNDARY_CALC_OFFSET_BITS = LEVELS.workMarginBits - boundaryToolBits(ROUGH_BOUNDARY.defaultTool);
/** A Roughing record's boundary: { kind, tool, offset (base mm, or null = calculated), shape (plan key | null) } (unset fields = the defaults). */
export function boundaryOf(rec) {
  const r = rec || {};
  const kind = ROUGH_BOUNDARY.kinds.some((k) => k.id === r.boundary) ? r.boundary : ROUGH_BOUNDARY.defaultKind;
  const tool = ROUGH_BOUNDARY.tools.some((t) => t.id === r.boundaryTool) ? r.boundaryTool : ROUGH_BOUNDARY.defaultTool;
  const offset = r.boundaryOffset != null && Number.isFinite(Number(r.boundaryOffset)) ? Number(r.boundaryOffset) : null;
  return { kind, tool, offset, shape: typeof r.boundaryShape === 'string' && r.boundaryShape ? r.boundaryShape : null };
}
/** The calculated offset (base mm): the wall allowance + BOUNDARY_CALC_OFFSET_BITS bit diameters (what an empty Offset row means). */
export const boundaryCalcOffset = (rec) => roughingAllowance(rec) + BOUNDARY_CALC_OFFSET_BITS * Math.max(0, Number(rec && rec.toolDia) || 0);
/** The work area's growth past the boundary (base mm): the offset + the tool rule (the defaults: allowance + 2 bits, written as TASK 792 wrote it). */
export function roughingWorkGrow(rec) {
  const b = boundaryOf(rec), dia = Math.max(0, Number(rec && rec.toolDia) || 0), tb = boundaryToolBits(b.tool);
  return b.offset == null ? roughingAllowance(rec) + (BOUNDARY_CALC_OFFSET_BITS + tb) * dia : b.offset + tb * dia;
}
/** The boundary's outline (world mm polygon) of a Roughing record whose part outline (its target's outer loop) is `partOuter`: { polygon } or { error }:
 *  'no-stock' (Stock chosen, the document has none), 'no-shape' (Shape chosen, none picked), 'shape-gone' (the picked shape / the Stock no longer derives). */
export function roughingBoundary(rec, partOuter, state, loops, loopPolys) {
  const b = boundaryOf(rec);
  if (b.kind === 'silhouette') return { polygon: partOuter };
  if (b.kind === 'box') { const [x0, y0, x1, y1] = boxOf(partOuter); return { polygon: [P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1)] }; }
  const t = rec && rec.boundaryTarget;
  if (!t) return { error: b.kind === 'stock' ? 'no-stock' : 'no-shape' };
  const own = deriveProfileCuts(t, { cutType: 'pocket', cutDepth: 1, cutOffset: 0, toolDia: 0 }, state, loops, loopPolys).find((c) => !c.isHole && c.kind !== 'chain');
  const polygon = own && (own.isCompound ? own.outerPoly : own.polygon);
  return polygon && polygon.length >= 3 ? { polygon } : { error: 'shape-gone' };
}
/** The Roughing of a record with levels (levelsRoughing on its boundary, work area growth, step, depth, bit, allowance, layout, min width), or the boundary's error. */
export function levelsRoughingFor(rec, partOuter, state, loops, loopPolys) {
  const b = roughingBoundary(rec, partOuter, state, loops, loopPolys);
  if (b.error) return { steps: [], paths: [], layout: roughLayout(rec), zMax: null, error: b.error };
  return levelsRoughing(rec.levels, { outer: b.polygon, grow: roughingWorkGrow(rec), step: rec.stepDepth, depth: rec.cutDepth, toolDia: rec.toolDia, allowance: roughingAllowance(rec), layout: roughLayout(rec), minWidth: rec.minTerraceWidth });
}

// ── TASK 810 (owner turns 2657-2658): the HEIGHTS of a Roughing / Contour (any source: levels, slope rings, a drawn region): it cuts only a BAND of depths.
// Record fields: `topDepth` (base mm below the surface where it starts; none = the Surface: a level at or above it is not cut), `bottomDepth` (the depth it stops
// at; none = the part's depth: the Roughing's Depth, the Contour's part's: "From model" for a part read from Fusion or an STL), `floorAllowance` (base mm >= 0: the
// deepest level stops that much above the bottom; separate from the wall allowance; none / 0 = none). The levels are made as before down to the band's bottom
// (bottom - floor allowance: its last level there), then the levels shallower than or at the top are dropped. None of them set: the depth as it was (byte for byte).
const modelDepth = (rec) => (hasLevels(rec) ? rec.levels[rec.levels.length - 1].z : rec.slope && Array.isArray(rec.slope.rings) && rec.slope.rings.length ? Math.max(...rec.slope.rings.map((r) => Number(r && r.z)).filter(Number.isFinite)) : null);
/** levelsBand(rec, partDepth) -> { top (base mm, 0 = the surface), depth (the depth the levels are made to: partDepth itself when no height is set), empty (no level
 *  can be cut between the top and the bottom) }. */
export function levelsBand(rec, partDepth) {
  const r = rec || {};
  const top = Number(r.topDepth) > 0 ? Number(r.topDepth) : 0;
  const bottom = r.bottomDepth != null && Number(r.bottomDepth) > 0 ? Number(r.bottomDepth) : null;
  const floor = Number(r.floorAllowance) > 0 ? Number(r.floorAllowance) : 0;
  if (!top && bottom == null && !floor) return { top: 0, depth: partDepth, empty: false };
  const part = Number(partDepth) > 0 && partDepth !== true ? Number(partDepth) : modelDepth(r);
  const stop = bottom != null ? (part != null ? Math.min(part, bottom) : bottom) : part;
  if (stop == null) return { top, depth: partDepth, empty: false }; // no depth known (a drawn region with its depth unset): nothing to limit
  const depth = stop - floor;
  return { top, depth, empty: !(depth > top + Z_EPS) };
}
// ── TASK 810 (docs/OPERATIONS-MODEL.md 1.4 / 5): a Contour's WHICH WALLS, record field `walls`: 'all' (every level's pass) | 'sloped' (Sloped only: the level whose
// outline IS the shape's own outline is not cut: the straight wall a plain Outside / Inside cut already makes; exactly TASK 792's own-wall rule, `sameOutline`).
// None stored = TODAY'S choice (wallsDefault): Sloped only for the Contour of a plain Outside / Inside cut on a sloped region (its slope rings, no levels), All
// otherwise; so a Contour cuts byte for byte what it cut before until the user picks.
export const CONTOUR_WALLS = Object.freeze({ choices: Object.freeze([Object.freeze({ id: 'all', label: 'All' }), Object.freeze({ id: 'sloped', label: 'Sloped only' })]) });
export const wallsDefault = (rec) => (rec && rec.slope && !hasLevels(rec) && (rec.baseType === 'exterior' || rec.baseType === 'interior') ? 'sloped' : 'all');
export const wallsOf = (rec) => (rec && (rec.walls === 'all' || rec.walls === 'sloped') ? rec.walls : wallsDefault(rec));
/** The depth a cut of a Roughing / Contour is made at (its level's, else its record's). */
const cutLevelDepth = (c) => Number(c.terrace ? c.terrace.depth : c.rec && c.rec.cutDepth);

/** TASK 792 (owner turn 2604): Roughing's two LAYOUTS, the record field `roughLayout` (a part with levels; a sloped region's Roughing is the stepped engine,
 *  nested by nature). `terraces` (the default): every spot cut ONCE, from the surface to its own floor (no air passes; best on deep or gentle reliefs).
 *  `nested`: level k = one pocket over everything that must reach at least d_k (fewer, bigger, continuous paths; best on steep or blocky parts). */
export const ROUGH_LAYOUT = Object.freeze({ layouts: Object.freeze([Object.freeze({ id: 'terraces', label: 'Terraces' }), Object.freeze({ id: 'nested', label: 'Nested' })]), defaultId: 'terraces' });
export const roughLayout = (rec) => (rec && rec.roughLayout === 'nested' ? 'nested' : 'terraces');
// what the Origin's pocket clears inside a region (TASK 452's footprint rule: the bit kept back from the boundary by its radius + the automatic offset,
// opened by its radius): erode by r + m, grow by r
// TASK 807: a TERRACE piece narrower than the drawing tolerance (LEVELS.drawTolMm: nothing left once shrunk by half of it) is the offsets' own noise,
// not a band to cut: E_k and E_k+1 are offsets whose round joins are only within drawTolMm of the true arcs, so where two levels' walls are closer
// than that (a near-vertical wall; levels read off a grid, an STL's: the owner's rose made 1449 terrace paths, 127 without them) their difference is
// a string of slivers. Such a piece lies within the Origin's offset m of the wall at its depth, where no pocket cuts to that depth anyway.
const thinnerThanTol = (g) => !offsetRegions([g], -LEVELS.drawTolMm / 2, LEVELS.drawTolMm).length;
const pocketClears = (regions, r, m) => (r > 0 ? offsetRegions(offsetRegions(regions, -(r + m), LEVELS.drawTolMm), r, LEVELS.drawTolMm) : regions);

/**
 * levelsRoughing(levels, { outer, grow, step, depth, toolDia, allowance, layout }) -> { steps, paths, layout, zMax, error } — Roughing from a levels list (header,
 * path 1). Levels: one every `step` (base mm, STEP_DEPTH.defaultMm when missing) down to `depth` (the part's depth; missing = the deepest section);
 * identical consecutive levels (the same cumulative material within SAME_OUTLINE_TOL_MM, compared with the run's FIRST level) are ONE level at the deeper
 * depth. REMOVAL R_k = the work area W minus the material at d_k grown by the allowance (R_1 holds R_2 ...). W = `outer` grown by `grow` (base mm; TASK 810: the
 * boundary and its growth, roughingWorkGrow; missing = the allowance + LEVELS.workMarginBits bits, TASK 792's). A W the bit's centre has no room in (nothing left once
 * shrunk by the bit radius + the Origin's offset: a boundary smaller than the bit, Inside) is refused: error 'no-room', no path.
 *  * layout 'nested': every connected piece of R_k is a path (a pocket at d_k); a piece the next level has too (the same outline, holes included) is cut
 *    there, not here (the same outline over consecutive levels = ONE path at the deepest of them).
 *  * layout 'terraces' (owner turns 2601-2603): TERRACE T_k = E_k minus E_k+1 (the deepest level's = its E), E_k = R_k shrunk by the Origin's automatic
 *    pocket offset m (a quarter bit: no pocket ever cuts within m of its boundary, so a spot within m of the wall at d_k cannot have the floor d_k): the
 *    spots whose floor is d_k, exactly what nested pocket k clears and pocket k+1 does not (the m strip on every design wall is left, as by any pocket,
 *    for the finish). Each connected piece is a path. Its cut region = the piece SPILLED over DEEPER wood (inside R_k: never a shallower terrace, the
 *    design or its allowance) only where needed: (1) round the piece by m (the pocket keeps its bit m back: without it the piece's own border would be
 *    left), (2) round every spot of the piece a pocket over (1) still cannot clear (thinner than the bit, a narrow end) by 2 (r + m), the width the bit
 *    needs to enter. Overlap = the cut area minus the terrace area. MIN TERRACE WIDTH (`minWidth`, base mm; owner turns 2605-2607): a piece narrower than
 *    it (nothing left after shrinking it by half of it) is not roughed at all (no path, no spill; counted in its step's `thin`); 0 = every piece.
 * steps: [{ depth, pieces, islands, small, area (R_k), cut (the area its paths cut) }] (islands = material standing in R_k, small = those narrower than
 * the bit); paths in cutting order (depthFirstPerArea over the pieces of R_1): [{ depth, level, region (the terrace / nested piece), regions (the pocket
 * elements written), box }].
 */
export function levelsRoughing(levels, { outer, grow, step, depth, toolDia, allowance = 0, layout = 'terraces', minWidth = 0 } = {}) {
  if (!Array.isArray(levels) || !levels.length) return { steps: [], paths: [], layout, zMax: null, error: 'no levels' };
  if (!Array.isArray(outer) || outer.length < 3) return { steps: [], paths: [], layout, zMax: null, error: 'no outline' };
  const st = levelStack(levels), zMax = st.zs[st.zs.length - 1];
  const D = Number(depth) > 0 && depth !== true ? Number(depth) : zMax;
  const dia = Math.max(0, Number(toolDia) || 0), a = Math.max(0, Number(allowance) || 0);
  const nested = layout === 'nested';
  const minW = !nested && Number(minWidth) > 0 ? Number(minWidth) : 0;
  const g = grow != null && Number.isFinite(Number(grow)) ? Number(grow) : a + LEVELS.workMarginBits * dia; // TASK 810: the boundary's growth (roughingWorkGrow)
  const key = ['R', nested ? 'N' : 'T', step, D, dia, a, minW, g, outer.length, ...boxOf(outer)].join('|');
  if (st.memo.has(key)) return st.memo.get(key);
  const W = offsetRegions(regionsFromRings([ringOf(outer)], 'nonzero'), g);
  if (!W.length || (dia > 0 && !offsetRegions(W, -(dia / 2 + LEVELS.pocketKeepBackBits * dia), LEVELS.drawTolMm).length)) { // TASK 810: no room for the bit's centre
    const none = { steps: [], paths: [], layout: nested ? 'nested' : 'terraces', zMax, error: 'no-room' };
    st.memo.set(key, none);
    return none;
  }
  const runs = [];
  let ref = -1;
  for (const d of depthList(step, D)) {
    const i = sectionAt(st, Math.min(d, zMax));
    if (runs.length && sameRegionSets(st.cumulative[ref], st.cumulative[i])) runs[runs.length - 1] = { depth: d, section: i }; // compared with the run's FIRST level
    else { runs.push({ depth: d, section: i }); ref = i; }
  }
  const R = runs.map(({ section }) => { const C = st.cumulative[section]; const M = a > 0 && C.length ? offsetRegions(C, a) : C; return M.length ? diffRegions(W, M) : W; });
  const r = dia / 2, m = LEVELS.pocketKeepBackBits * dia;
  // terraces: the spot's floor counts the Origin's automatic offset m (every pocket keeps its bit m back from its boundary, so nothing within m of the
  // wall at d_k is ever cut to d_k): E_k = R_k shrunk by m, T_k = E_k minus E_k+1 (exactly the spots a nested pocket k clears and pocket k+1 does not)
  const E = !nested && m > 0 ? R.map((g) => offsetRegions(g, -m, LEVELS.drawTolMm)) : R;
  const steps = [], items = [];
  runs.forEach(({ depth: d }, k) => {
    const pieces = (nested ? R[k].filter((g) => !(k + 1 < runs.length && R[k + 1].some((h) => sameRegionSets([g], [h]))))
      : (k + 1 < runs.length ? diffRegions(E[k], E[k + 1]) : E[k])).filter((g) => regionsArea([g]) > LEVELS.sliverMm2 && (nested || !thinnerThanTol(g)));
    let cut = 0, thin = 0;
    for (const piece of pieces) {
      if (minW > 0 && !offsetRegions([piece], -minW / 2, LEVELS.drawTolMm).length) { thin++; continue; } // (owner turns 2605-2607) narrower than the Min terrace width: not roughed
      let regions = [piece];
      if (!nested && dia > 0) {
        const base = intersectRegions(offsetRegions([piece], m, LEVELS.drawTolMm), R[k]); // (1) its own area + the Origin's offset round it, inside R_k
        const missed = diffRegions([piece], pocketClears(base, r, m)).filter((g) => regionsArea([g]) > LEVELS.sliverMm2);
        regions = missed.length ? unionRegions(base, intersectRegions(offsetRegions(missed, 2 * (r + m), LEVELS.drawTolMm), R[k])) : base; // (2) room for the bit, only there
      }
      cut += regionsArea(regions);
      items.push({ depth: d, level: k, region: piece, regions, box: boxOfRing(piece.outer) });
    }
    const holes = R[k].flatMap((g) => g.holes);
    steps.push({ depth: d, pieces: pieces.length, thin, islands: holes.length, small: holes.filter((h) => narrowerThan(h, dia)).length, area: regionsArea(R[k]), cut });
  });
  const out = { steps, paths: depthFirstPerArea(items, R.length ? R[0].map((g) => boxOfRing(g.outer)) : []), layout: nested ? 'nested' : 'terraces', zMax, error: null };
  st.memo.set(key, out);
  return out;
}

/**
 * levelsContour(levels, { step, depth, smoothing }) -> { steps: [{ depth, loops: [{ polygon:[{x,y}], outer }], outline }], paths, zMax, error } — Contour from a
 * levels list (header, path 1): a level every `step` (LEVELS.contourStepMm when missing) down to `depth`; its loops = the boundary of the cumulative
 * material there (outer = an outer loop: Outside cut; else a hole in the material: Inside cut). A loop the next deeper level has too (within
 * SAME_OUTLINE_TOL_MM) is cut there, not here (the same outline over consecutive levels = ONE path at the deepest of them: a vertical wall once, at its
 * bottom); a level left with no loop is no level. `paths` = every loop in cutting order, DEPTH-FIRST PER AREA (areas = the connected pieces of the
 * deepest material): [{ depth, level, polygon, outer, box, ring }].
 * TASK 809: `smoothing` (base mm, 0 = off) = the Contour's Smoothing: each level's material is then its SMOOTHED material (smoothedSections), its loops
 * the smoothed rings (`ring`: #core/level-smooth.js, `polygon` its sampled curve); the same rule of the same outline (on the smoothed loops) and order.
 */
export function levelsContour(levels, { step, depth, smoothing = 0 } = {}) {
  if (!Array.isArray(levels) || !levels.length) return { steps: [], paths: [], zMax: null, error: 'no levels' };
  const st = levelStack(levels), zMax = st.zs[st.zs.length - 1];
  const D = Number(depth) > 0 && depth !== true ? Number(depth) : zMax;
  const s = Number(step) > 0 ? Number(step) : LEVELS.contourStepMm;
  const tol = Number(smoothing) > 0 ? Number(smoothing) : 0;
  const key = ['C', s, D, tol].join('|');
  if (st.memo.has(key)) return st.memo.get(key);
  const depths = depthList(s, D), per = depths.map((d) => sectionAt(st, Math.min(d, zMax)));
  const smoothed = tol > 0 ? smoothedSections(st, per, tol) : null;
  const loopsAt = per.map((i) => (smoothed ? smoothed.get(i) : regionLoops(st.cumulative[i])));
  const steps = [], items = [];
  depths.forEach((d, k) => {
    const next = k + 1 < depths.length ? loopsAt[k + 1] : null;
    const loops = !next ? loopsAt[k] : per[k] === per[k + 1] ? [] : loopsAt[k].filter((l) => !next.some((q) => q.outer === l.outer && sameOutline(l.polygon, q.polygon)));
    if (!loops.length) return;
    for (const l of loops) items.push({ depth: d, level: steps.length, polygon: l.polygon, outer: l.outer, box: boxOf(l.polygon), ring: l.ring || null });
    steps.push({ depth: d, loops, outline: loopsAt[k] }); // TASK 809: outline = every loop of the level (those cut deeper too: the material it nests in)
  });
  const deepest = st.cumulative[per[per.length - 1]] || [];
  const out = { steps, paths: depthFirstPerArea(items, deepest.map((g) => boxOfRing(g.outer))), zMax, error: null };
  st.memo.set(key, out);
  return out;
}
// TASK 809: the SMOOTHED MATERIAL of each section a Contour cuts (`per`: the sections, any order), deepest first: S_i = the section's cumulative
// material smoothed (#core/level-smooth.js smoothRegions: each loop fitted, outer minus holes, one union), then INTERSECTED with the next deeper
// section's smoothed material (intersectSmoothed: a level's loops never cross the next level's; where they meet they share the deeper curve). A loop
// of section i that IS a loop of the next deeper section (the same outline, SAME_OUTLINE_TOL_MM: a vertical wall) takes that loop's fitted ring, so
// the same wall is the same curve at both levels (and the rule of the same outline still finds it). -> Map(section -> [{ polygon, outer, ring }]).
function smoothedSections(st, per, tol) {
  const memoKey = 'S|' + tol;
  let bySection = st.memo.get(memoKey);
  if (!bySection) { bySection = new Map(); st.memo.set(memoKey, bySection); }
  const used = [...new Set(per)].sort((a, b) => b - a);
  const out = new Map();
  let deeper = null; // the next deeper used section's entry: { below, regions (smoothed), fits: [{ outer, poly, ring }], loops }
  for (const i of used) {
    let entry = bySection.get(i);
    if (!entry || entry.below !== deeper) { // made on the same deeper entry (that one made on its own: the chain is the same)
      const fits = [];
      const fit = (ring, isOuter) => {
        const poly = ptsOf(ring);
        const same = deeper && deeper.fits.find((f) => f.outer === isOuter && sameOutline(poly, f.poly));
        const sm = same ? same.ring : smoothRing(ring, tol);
        fits.push({ outer: isOuter, poly, ring: sm });
        return sm;
      };
      const own = smoothRegions(st.cumulative[i], tol, { fit });
      const regions = deeper ? intersectSmoothed(own, deeper.regions, tol, st.cumulative[i]) : own;
      entry = { below: deeper, regions, fits, loops: regions.flatMap((g) => [{ polygon: ptsOf(g.outer.poly), outer: true, ring: g.outer }, ...g.holes.map((h) => ({ polygon: ptsOf(h.poly), outer: false, ring: h }))]) };
      bySection.set(i, entry);
    }
    out.set(i, entry.loops);
    deeper = entry;
  }
  return out;
}

// ── the CUTS (deriveCuts' result for a Roughing / Contour record): what the export writes (`geom`), what Prepare and the 3D Review draw (the footprint
// comes from `centers` / `sweep`, #core/profile-model deriveCutFootprint: Clipper offsets, so a wavy part outline or an island narrower than the bit is
// drawn too, where the simple-loop #core/polygon-offset returns nothing); `terrace` = its level { index, count, depth, label } as a stepped cut's ──
const lazy = (o, name, make) => { let v; Object.defineProperty(o, name, { enumerable: true, configurable: true, get: () => (v === undefined ? (v = make()) : v) }); return o; };
function levelPocketCut(reg, rec, terrace, smoothD = null) { // TASK 809: smoothD = the smoothed region's path (its rings' cubics), reg its sampled rings
  const outerPoly = ptsOf(reg.outer), holePolys = reg.holes.map(ptsOf);
  const d = smoothD || [outerPoly, ...holePolys].map(polyToPathD).join(' '); // Clipper winds a hole opposite to its outer (TASK 786's rule holds)
  const r = (Number(rec.toolDia) || 0) / 2, margin = (Number(rec.cutOffset) || 0) + (Number(rec.autoOffset) || 0); // the pocket footprint's rule (TASK 452)
  const cut = { kind: 'profile', cutType: 'pocket', isCompound: true, isHole: false, outerPoly, holePolys, outerOffsetSide: -1, holeOffsetSide: 1,
    rec: { ...rec, cutType: 'pocket', cutDepth: terrace.depth }, d, geom: { tag: 'path', a: `d="${d}"` }, terrace };
  let centre = null;
  const centreOf = () => centre || (centre = r > 0 ? offsetRegions([reg], -(r + margin), LEVELS.drawTolMm) : []);
  const memo = new Map();
  lazy(cut, 'centers', () => centreOf().flatMap((g) => [g.outer, ...g.holes]).map((ring) => ({ points: ptsOf(ring), closed: true })));
  cut.sweep = (w) => { if (!memo.has(w)) memo.set(w, w > 0 ? offsetRegions(centreOf(), w, LEVELS.drawTolMm).flatMap((g) => [g.outer, ...g.holes]).map(ptsOf) : []); return memo.get(w); };
  return cut;
}
// a closed ring [[x,y],...] (closing point repeated) reduced to the fewest points within `tol` of it (Douglas-Peucker, split at its point farthest from the
// first): the DRAWN centre path of a contour (LEVELS.drawTolMm; sweeping a 2,700-point loop for each slice of a ball nose made the rose's Review take a minute)
function reduceRing(ring, tol) {
  const pts = ring.slice(0, -1), n = pts.length;
  if (n <= 8) return ring;
  const seg = (p, a, b) => distToSeg(P(p[0], p[1]), P(a[0], a[1]), P(b[0], b[1]));
  let far = 0, fd = -1;
  for (let k = 1; k < n; k++) { const d = Math.hypot(pts[k][0] - pts[0][0], pts[k][1] - pts[0][1]); if (d > fd) { fd = d; far = k; } }
  const keep = new Uint8Array(n); keep[0] = 1; keep[far] = 1;
  const stack = [[0, far], [far, n]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let worst = -1, at = -1;
    for (let k = a + 1; k < b; k++) { const d = seg(pts[k], pts[a], pts[b % n]); if (d > worst) { worst = d; at = k; } }
    if (worst > tol) { keep[at] = 1; stack.push([a, at], [at, b]); }
  }
  const out = pts.filter((_, k) => keep[k]);
  return out.length >= 3 ? [...out, out[0]] : ring;
}
function levelContourCut(polygon, outer, rec, terrace, ring = null) { // TASK 809: ring = the smoothed ring (its cubics are the path), polygon its sampled curve
  const cutType = outer ? 'exterior' : 'interior', side = outer ? 1 : -1;
  const r = (Number(rec.toolDia) || 0) / 2, off = Number(rec.cutOffset) || 0;
  const cut = { kind: 'loop', polygon, cutType, offsetSide: side, isHole: !outer, isCompound: false, rec: { ...rec, cutType, cutDepth: terrace.depth },
    geom: { tag: 'path', a: `d="${ring && ring.segs ? ringPathD(ring.segs) : polyToPathD(polygon)}"` }, terrace };
  const memo = new Map();
  lazy(cut, 'centers', () => (r > 0 ? offsetPolygonRound(polygon.map((p) => [p.x, p.y]), side * (r + off), LEVELS.drawTolMm).map((ring) => ({ points: ptsOf(reduceRing(ring, LEVELS.drawTolMm)), closed: true })) : []));
  cut.sweep = (w) => { // the band the bit sweeps along its centre path (hold-part sweeper's rule, at the drawing tolerance)
    if (!memo.has(w)) memo.set(w, w > 0 ? sweepPaths(cut.centers.map((c) => ({ points: c.points.map((p) => [p.x, p.y]), closed: true })), w, LEVELS.drawTolMm).flatMap((g) => [g.outer, ...g.holes]).map(ptsOf) : []);
    return memo.get(w);
  };
  return cut;
}

// TASK 809: a Roughing's paths SMOOTHED at tol (#core/level-smooth.js smoothRegions: each pocket element's rings fitted, its outer minus its holes):
// per path, its pocket elements [{ reg: { outer, holes } (the sampled curves, Clipper's ring form), d (the cubics' path) }]. Made once per Roughing
// result and tolerance (both never mutated). A pocket element narrower than about the tolerance may vanish.
const SMOOTHED_ROUGHING = new WeakMap(); // levelsRoughing result -> Map(tol -> per path list)
function smoothedRoughing(R, tol) {
  let byTol = SMOOTHED_ROUGHING.get(R);
  if (!byTol) { byTol = new Map(); SMOOTHED_ROUGHING.set(R, byTol); }
  if (!byTol.has(tol)) {
    byTol.set(tol, R.paths.map((p) => p.regions.flatMap((reg) => smoothRegions([reg], tol).map((g) => ({
      reg: { outer: g.outer.poly, holes: g.holes.map((h) => h.poly) }, d: [g.outer, ...g.holes].map((r) => ringPathD(r.segs)).join(' '),
    })))));
  }
  return byTol.get(tol);
}

// deriveCuts for a record with `levelsOp` (header). The record carries `levels` and / or `slope` (a Contour: its part's, with `baseDepth` / `baseType`).
// TASK 810: only the band of its heights (levelsBand): made down to the band's depth, the levels at or above its top dropped; an empty band cuts nothing.
function deriveLevelsCuts(target, rec, state, loops, loopPolys, ownedLoops) {
  const band = levelsBand(rec, rec.levelsOp === 'contour' ? rec.baseDepth : rec.cutDepth);
  if (band.empty) return [];
  const cuts = deriveLevelsCutsTo(target, rec, band.depth, state, loops, loopPolys, ownedLoops);
  return band.top > 0 ? cuts.filter((c) => cutLevelDepth(c) > band.top + Z_EPS) : cuts;
}
function deriveLevelsCutsTo(target, rec, depth, state, loops, loopPolys, ownedLoops) {
  const op = rec.levelsOp;
  const label = (rec.slope && rec.slope.label) || null;
  const work = { ...levelsWorkRecord(rec), cutDepth: depth };
  // TASK 810: a Contour's Sloped only (wallsOf): the levels whose outline IS the shape's own outline (its own cut as `as`) are not cut (TASK 792's rule, any source)
  const ownWallSkipped = (cuts, as) => {
    if (op !== 'contour' || wallsOf(rec) !== 'sloped') return cuts;
    const own = deriveProfileCuts(target, { ...work, cutType: as }, state, loops, loopPolys, ownedLoops).find((c) => !c.isHole && c.kind !== 'chain');
    const wall = own && (own.isCompound ? own.outerPoly : own.polygon);
    return wall ? cuts.filter((c) => !c.terrace || !sameOutline(c.isCompound ? c.outerPoly : c.polygon, wall)) : cuts;
  };
  for (const k of ['levelsOp', 'levels', 'terraceAs', 'baseType', 'baseDepth', 'finishAllowance', 'roughLayout', 'minTerraceWidth', 'smoothing', 'boundary', 'boundaryShape', 'boundaryTarget', 'boundaryTool', 'boundaryOffset', 'topDepth', 'bottomDepth', 'floorAllowance', 'walls']) delete work[k]; // TASK 810: + the boundary's, the heights' and the walls' fields // `slope` stays: the stepped engine reads it
  if (hasLevels(rec)) { // path 1
    const plain = deriveProfileCuts(target, { ...work, cutType: 'pocket' }, state, loops, loopPolys, ownedLoops).find((c) => c.isCompound);
    if (!plain) return [];
    delete work.slope;
    const tol = smoothingOf(op, rec.smoothing); // TASK 809: the operation's Smoothing (0 = its polylines)
    if (op === 'contour') { // its paths in cutting order (depth-first per area)
      const T = levelsContour(rec.levels, { step: rec.stepDepth, depth, smoothing: tol });
      return ownWallSkipped(T.paths.map((p) => levelContourCut(p.polygon, p.outer, work, { index: p.level, count: T.steps.length, depth: p.depth, undercutBelow: null, label }, p.ring)), levelsCutAs(rec)); // TASK 810: Sloped only
    }
    const R = levelsRoughingFor({ ...rec, cutDepth: depth }, plain.outerPoly, state, loops, loopPolys); // TASK 810: on its boundary (an error: no path)
    const S = tol > 0 ? smoothedRoughing(R, tol) : null;
    return R.paths.flatMap((p, i) => (S ? S[i] : p.regions.map((reg) => ({ reg, d: null }))).map(({ reg, d }) => levelPocketCut(reg, work, { index: p.level, count: R.steps.length, depth: p.depth, undercutBelow: null, label, islands: R.steps[p.level].islands, small: R.steps[p.level].small }, d)));
  }
  const as = levelsCutAs(rec);
  if (rec.slope) { // path 2: THE stepped engine (allowance 0: the stepped cut of 714 byte for byte)
    return ownWallSkipped(deriveCuts(target, { ...work, terraceAs: as }, state, loops, loopPolys, ownedLoops), as); // TASK 810: Sloped only = TASK 792's skip next to a plain Outside / Inside cut (its default there)
  }
  return deriveProfileCuts(target, { ...work, cutType: as }, state, loops, loopPolys, ownedLoops); // path 3: one level, the drawn region at its depth
}
