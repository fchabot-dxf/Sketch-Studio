// packages/core/relief-model.js — TASK 459: the finished WORKPIECE as 3D terraces, for the Shaper Review tab.
// PURE: no DOM, no three, no WebGL (the view only wraps the typed arrays into BufferGeometry). Imports #core/plot/clip.js
// (Clipper regions) and the vendored earcut only.
//
// ONE DERIVATION: this model takes what the cuts ALREADY derive — each item's `footprints` (output of
// profile-model.deriveCutFootprint: rings + fillRule) and its cut depth — and nothing else. It never recomputes bit
// geometry, offsets or corner rounding; the walls are exactly the footprint rings Prepare draws.
//
// METHOD (terraces / level sets): distinct depths d1<...<dn (clamped to the stock thickness T). R_k = union of the regions
// of every cut at least d_k deep (R_1 contains R_2 ...). Mesh = top face (stock minus R_1) + per level a floor
// (R_k minus R_{k+1}) at depth d_k (none when d_k = T: a THROUGH cut is open) + a wall strip along boundary(R_k) from d_{k-1} to
// d_k + the bottom face (stock minus the through region) + the four stock sides.
//
// WORLD AXES of the output (already three.js's layout, so the view does no swizzling): X = sketch x, Y = HEIGHT (top face
// y=0, bottom y=-T), Z = sketch y (down the screen in a top view with camera up = -Z, so a top view matches Prepare).
// Every face is flat-shaded with its true outward normal, wound counter-clockwise seen from outside.
import { regionsFromRings, unionRegions, diffRegions, intersectRegions } from './plot/clip.js';
import earcut from './plot/vendor/earcut.js';
import { cutterTerraces, isShapedCutter, SHAPE_SLICES } from './cutter-profile.js';

// Declared stock (all BASE mm, like cutDepth). width/height null = derived from the design bounds + margin on every side.
export const DEFAULT_STOCK = Object.freeze({ thickness: 19.05, width: null, height: null, margin: 12.7 });

// Unset-depth labels closer than this share one label (the labels are screen-sized, so nearer cuts would overprint).
const MARK_MERGE_MM = 10;
const finite = (v) => Number.isFinite(Number(v)) && v !== null && v !== '' && v !== true;

/** How one cut item enters the model: { kind: 'cut', depth, through, depthUnset } or { kind: 'skip', reason }. */
export function reliefDepth(cutTypeIn, cutDepth, T) {
  const cutType = cutTypeIn === 'exterior' ? 'outside' : cutTypeIn === 'interior' ? 'inside' : cutTypeIn; // the CUT_TYPES ids and the derived names
  const unset = cutDepth == null || cutDepth === 'unset' || !finite(cutDepth);
  if (cutType === 'outside' || cutType === 'inside') {
    if (unset) return { kind: 'cut', depth: T, through: true, depthUnset: true };   // a cut-out with no depth = through
    const d = Number(cutDepth);
    if (d < 0 || d >= T) return { kind: 'cut', depth: T, through: true, depthUnset: false }; // negative: through (UNVERIFIED vs the Origin)
    if (d === 0) return { kind: 'skip', reason: 'zero-depth' };
    return { kind: 'cut', depth: d, through: false, depthUnset: false };
  }
  if (cutType === 'pocket' || cutType === 'online') {                                // a pocket floor / an On Line groove (centred band)
    if (unset) return { kind: 'skip', reason: 'no-depth' };                          // never guess a pocket / groove depth
    const d = Number(cutDepth);
    if (d <= 0) return { kind: 'skip', reason: 'no-depth' };
    return d >= T ? { kind: 'cut', depth: T, through: true, depthUnset: false } : { kind: 'cut', depth: d, through: false, depthUnset: false };
  }
  return { kind: 'skip', reason: 'unsupported' };                                    // Guide is never cut
}

const toRing = (ring) => ring.map((p) => (Array.isArray(p) ? [p[0], p[1]] : [p.x, p.y]));
const area2 = (ring) => { let s = 0; const n = ring.length; for (let i = 0; i < n - 1; i++) s += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]; return s; };
const rectRegion = (b) => ({ outer: [[b.minX, b.minY], [b.maxX, b.minY], [b.maxX, b.maxY], [b.minX, b.maxY], [b.minX, b.minY]], holes: [] });

function newMesh() { return { p: [], n: [], i: [] }; }
function tri(m, a, b, c, want) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  if (nx * nx + ny * ny + nz * nz < 1e-18) return; // degenerate
  if (nx * want[0] + ny * want[1] + nz * want[2] < 0) { const t = b; b = c; c = t; }
  const base = m.p.length / 3;
  for (const v of [a, b, c]) { m.p.push(v[0], v[1], v[2]); m.n.push(want[0], want[1], want[2]); }
  m.i.push(base, base + 1, base + 2);
}
const finish = (m) => ({ positions: new Float32Array(m.p), normals: new Float32Array(m.n), indices: new Uint32Array(m.i) });

// A flat face (regions with holes) at height h, normal +Y (s=1) or -Y (s=-1).
function flatFace(m, regions, h, s) {
  for (const r of regions) {
    const rings = [r.outer, ...r.holes].map((g) => g.slice(0, -1)); // drop the closing duplicate
    const flat = [], holeIdx = [];
    rings.forEach((g, k) => { if (k > 0) holeIdx.push(flat.length / 2); for (const q of g) flat.push(q[0], q[1]); });
    const t = earcut(flat, holeIdx);
    for (let k = 0; k < t.length; k += 3) {
      const v = [t[k], t[k + 1], t[k + 2]].map((ix) => [flat[2 * ix], h, flat[2 * ix + 1]]);
      tri(m, v[0], v[1], v[2], [0, s, 0]);
    }
  }
}

// The regions of `list` whose bounding box overlaps the bounding box of `of` (a pure pre-filter: it never changes a boolean's result).
function near(list, of) {
  const bb = (rs) => { const b = [Infinity, Infinity, -Infinity, -Infinity]; for (const r of rs) for (const p of r.outer) { if (p[0] < b[0]) b[0] = p[0]; if (p[1] < b[1]) b[1] = p[1]; if (p[0] > b[2]) b[2] = p[0]; if (p[1] > b[3]) b[3] = p[1]; } return b; };
  const t = bb(of);
  return list.filter((r) => { const b = bb([r]); return b[0] <= t[2] && b[2] >= t[0] && b[1] <= t[3] && b[3] >= t[1]; });
}

// The directed boundary edges of `regions`, oriented so the removed region is on the LEFT (outer CCW, holes CW): [[x1,y1,x2,y2],...].
function boundaryEdges(regions) {
  const out = [];
  for (const r of regions) {
    const rings = [r.outer, ...r.holes].map((g, k) => {
      const ccw = area2(g) > 0;
      return (k === 0 ? ccw : !ccw) ? g : g.slice().reverse();
    });
    for (const g of rings) for (let i = 0; i < g.length - 1; i++) {
      const p = g[i], q = g[i + 1];
      if (Math.hypot(q[0] - p[0], q[1] - p[1]) >= 1e-9) out.push([p[0], p[1], q[0], q[1]]);
    }
  }
  return out;
}
const edgeKey = (e) => e.map((v) => Math.round(v * 1000)).join(',');

// Vertical WALLS, facing INTO the removed region, for every level's boundary from the previous level's depth down to its own.
// An edge that is the SAME on consecutive levels (a through-cut kerf is on the boundary of every level) is ONE tall quad, not a
// stack of one strip per level: without this a 29-level file spent 100k triangles re-drawing the same kerf walls.
function levelWalls(m, levelRegions, depths) {
  let open = new Map(); // edgeKey -> { e, top, bot } still growing downward
  const flush = (q) => {
    const [x1, y1, x2, y2] = q.e, dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy), nrm = [-dy / len, 0, dx / len];
    const a = [x1, q.top, y1], b = [x2, q.top, y2], c = [x2, q.bot, y2], d = [x1, q.bot, y1];
    tri(m, a, b, c, nrm); tri(m, a, c, d, nrm);
  };
  let prev = 0;
  levelRegions.forEach((regions, k) => {
    const next = new Map();
    for (const e of boundaryEdges(regions)) {
      const key = edgeKey(e), hit = open.get(key);
      if (hit) { hit.bot = -depths[k]; next.set(key, hit); open.delete(key); }
      else next.set(key, { e, top: -prev, bot: -depths[k] });
    }
    for (const q of open.values()) flush(q); // edges that stop here
    open = next;
    prev = depths[k];
  });
  for (const q of open.values()) flush(q);
}

/**
 * buildRelief({ stock, items, bounds }) -> { stockBox, levels, meshes:{top,floor,wall,bottom,side}, marks, stats }
 *   marks   [{ key, keys, kind:'depth-unset', point:[x,y] }] (one per SPOT; `keys` = every cut sharing it) — an Outside/Inside cut shown THROUGH only because its depth is unset (the view draws a label there)
 *   stock   {thickness,width,height,margin} (defaults DEFAULT_STOCK); all base mm
 *   items   [{ key, cutType:'outside'|'inside'|'pocket'|'online'|..., cutDepth: mm | 'unset', footprints:[{ rings:[[{x,y}]], fillRule }],
 *              shape?: { cutterShape, cutterAngle, toolDia }, footprintsAt?: (halfWidth) => footprints, slices? }]
 *              (shape + footprintsAt make a ball-nose / V-bit groove: terraces over its profile, see cutter-profile.js)
 *   bounds  optional {minX,maxX,minY,maxY} of the design (joints); merged with the footprint rings for the derived size
 * Each mesh = { positions, normals, indices } (typed arrays). stats: triangles, per-group areas, skipped, unsetThrough.
 */
export function buildRelief({ stock, items = [], bounds = null } = {}) {
  const S = { ...DEFAULT_STOCK, ...(stock || {}) };
  const T = Number(S.thickness) > 0 ? Number(S.thickness) : DEFAULT_STOCK.thickness;
  const skipped = [], unsetThrough = [], marks = [], entries = [];

  const b = bounds ? { ...bounds } : { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  const pending = [];
  for (const it of items) {
    const rule = reliefDepth(it.cutType, it.cutDepth, T);
    if (rule.kind === 'skip') { skipped.push({ key: it.key, cutType: it.cutType, reason: rule.reason }); continue; }
    const regions = [];
    for (const fp of it.footprints || []) {
      const rings = (fp.rings || []).filter((g) => g.length >= 3).map(toRing);
      for (const g of rings) for (const q of g) { b.minX = Math.min(b.minX, q[0]); b.maxX = Math.max(b.maxX, q[0]); b.minY = Math.min(b.minY, q[1]); b.maxY = Math.max(b.maxY, q[1]); }
      regions.push(...regionsFromRings(rings, fp.fillRule));
    }
    if (!regions.length) { skipped.push({ key: it.key, cutType: it.cutType, reason: 'nothing-cut' }); continue; }
    // TASK 464: a ball-nose / V-bit groove (not a through cut, which the bit clears at full width) = TERRACES over its profile; the
    // footprint at each half-width comes from the caller's `footprintsAt` (profile-model.deriveCutFootprintAt: the same derivation).
    const shape = it.shape && it.shape.cutterShape;
    if (!rule.through && isShapedCutter(shape) && typeof it.footprintsAt === 'function') {
      const n = Number(it.slices) > 0 ? Number(it.slices) : SHAPE_SLICES[shape];
      let any = false;
      for (const t of cutterTerraces(shape, it.shape.toolDia, it.shape.cutterAngle, rule.depth, n)) {
        const rs = [];
        for (const fp of it.footprintsAt(t.halfWidth) || []) rs.push(...regionsFromRings((fp.rings || []).filter((g) => g.length >= 3).map(toRing), fp.fillRule));
        if (rs.length) { pending.push({ depth: t.depth, regions: rs }); any = true; }
      }
      if (any) continue;
    }
    if (rule.depthUnset && !unsetThrough.includes(it.key)) { // one mark per cut (a profile's holes share its key), ON the cut: a vertex of its largest outer ring
      unsetThrough.push(it.key);
      const big = regions.reduce((m, r) => (Math.abs(area2(r.outer)) > Math.abs(area2(m.outer)) ? r : m), regions[0]);
      const pt = [big.outer[0][0], big.outer[0][1]];
      const near = marks.find((m) => Math.hypot(m.point[0] - pt[0], m.point[1] - pt[1]) < MARK_MERGE_MM); // one label per SPOT (an Outside + an Inside on one hole)
      if (near) near.keys.push(it.key); else marks.push({ key: it.key, keys: [it.key], kind: 'depth-unset', point: pt });
    }
    pending.push({ depth: rule.depth, regions });
  }

  // The stock box: derived = design/cut bounds + margin; explicit width/height are centred on the bounds.
  if (!Number.isFinite(b.minX)) { b.minX = 0; b.maxX = 0; b.minY = 0; b.maxY = 0; }
  const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2, m = Number(S.margin) || 0;
  const w = Number(S.width) > 0 ? Number(S.width) : (b.maxX - b.minX) + 2 * m;
  const h = Number(S.height) > 0 ? Number(S.height) : (b.maxY - b.minY) + 2 * m;
  const box = { minX: cx - w / 2, maxX: cx + w / 2, minY: cy - h / 2, maxY: cy + h / 2, thickness: T };
  const rect = [rectRegion(box)];

  for (const p of pending) {
    const regs = intersectRegions(p.regions, rect); // a cut cannot leave the board
    if (regs.length) entries.push({ depth: p.depth, regions: regs });
    else skipped.push({ cutType: 'any', reason: 'outside-stock' });
  }

  // Level sets, deepest first so each R_k = (its own entries) union R_{k+1}.
  const depths = [...new Set(entries.map((e) => e.depth))].sort((x, y) => x - y);
  const R = new Array(depths.length), E = new Array(depths.length); // E_k = the cuts of exactly this depth
  for (let k = depths.length - 1; k >= 0; k--) {
    E[k] = unionRegions(...entries.filter((e) => e.depth === depths[k]).map((e) => e.regions));
    if (k + 1 < depths.length) { // only the deeper regions near E_k can merge with it; the others are disjoint from it and carry over unchanged
      const nearSet = near(R[k + 1], E[k]);
      R[k] = [...unionRegions(E[k], nearSet), ...R[k + 1].filter((r) => !nearSet.includes(r))];
    } else R[k] = E[k];
  }

  const top = newMesh(), floor = newMesh(), wall = newMesh(), bottom = newMesh(), side = newMesh();
  flatFace(top, depths.length ? diffRegions(rect, R[0]) : rect, 0, 1);
  depths.forEach((d, k) => {
    const through = d >= T - 1e-9;
    // floor_k = R_k minus R_k+1 = E_k minus R_k+1; only the deeper regions near E_k can matter (a bbox pre-filter keeps each Clipper
    // call small: a through-cut kerf far away is in every level and would otherwise be re-processed 29 times).
    if (!through) flatFace(floor, k + 1 < depths.length ? diffRegions(E[k], near(R[k + 1], E[k])) : E[k], -d, 1);
  });
  levelWalls(wall, R, depths);
  const throughR = depths.length && depths[depths.length - 1] >= T - 1e-9 ? R[depths.length - 1] : [];
  flatFace(bottom, throughR.length ? diffRegions(rect, throughR) : rect, -T, -1);
  const corners = [[box.minX, box.minY], [box.maxX, box.minY], [box.maxX, box.maxY], [box.minX, box.maxY]];
  for (let i = 0; i < 4; i++) {
    const p = corners[i], q = corners[(i + 1) % 4], dx = q[0] - p[0], dy = q[1] - p[1], len = Math.hypot(dx, dy) || 1;
    const nrm = [dy / len, 0, -dx / len]; // outward for the CCW-in-(x,y) corner order above (right-hand normal)
    const a = [p[0], 0, p[1]], bb = [q[0], 0, q[1]], c = [q[0], -T, q[1]], d = [p[0], -T, p[1]];
    tri(side, a, bb, c, nrm); tri(side, a, c, d, nrm);
  }

  const meshes = { top: finish(top), floor: finish(floor), wall: finish(wall), bottom: finish(bottom), side: finish(side) };
  const triangles = Object.values(meshes).reduce((s, g) => s + g.indices.length / 3, 0);
  const areas = {};
  for (const [k, g] of Object.entries(meshes)) areas[k] = meshArea(g);
  return { stockBox: box, levels: depths.map((d, k) => ({ depth: d, through: d >= T - 1e-9, regions: R[k] })), meshes, marks, stats: { triangles, areas, skipped, unsetThrough, levels: depths.length } };
}

/** Total triangle area of a mesh (for tests and stats). */
export function meshArea(g) {
  let s = 0; const P = g.positions, I = g.indices;
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    s += 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
  }
  return s;
}
