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

// Declared stock (all BASE mm, like cutDepth). width/height null = derived from the design bounds + margin on every side.
export const DEFAULT_STOCK = Object.freeze({ thickness: 19.05, width: null, height: null, margin: 12.7 });

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
  if (cutType === 'pocket') {
    if (unset) return { kind: 'skip', reason: 'no-depth' };                          // never guess a pocket depth
    const d = Number(cutDepth);
    if (d <= 0) return { kind: 'skip', reason: 'no-depth' };
    return d >= T ? { kind: 'cut', depth: T, through: true, depthUnset: false } : { kind: 'cut', depth: d, through: false, depthUnset: false };
  }
  return { kind: 'skip', reason: 'unsupported' };                                    // On Line = slice S2; Guide is never cut
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

// A vertical wall strip along every ring of `regions`, from height hTop down to hBot, facing INTO the removed region.
function wallStrips(m, regions, hTop, hBot) {
  for (const r of regions) {
    const rings = [r.outer, ...r.holes].map((g, k) => {
      const ccw = area2(g) > 0;
      return (k === 0 ? ccw : !ccw) ? g : g.slice().reverse(); // outer CCW, holes CW => the removed region is on the LEFT
    });
    for (const g of rings) {
      for (let i = 0; i < g.length - 1; i++) {
        const p = g[i], q = g[i + 1], dx = q[0] - p[0], dy = q[1] - p[1], len = Math.hypot(dx, dy);
        if (len < 1e-9) continue;
        const nrm = [-dy / len, 0, dx / len];
        const a = [p[0], hTop, p[1]], b = [q[0], hTop, q[1]], c = [q[0], hBot, q[1]], d = [p[0], hBot, p[1]];
        tri(m, a, b, c, nrm); tri(m, a, c, d, nrm);
      }
    }
  }
}

/**
 * buildRelief({ stock, items, bounds }) -> { stockBox, levels, meshes:{top,floor,wall,bottom,side}, stats }
 *   stock   {thickness,width,height,margin} (defaults DEFAULT_STOCK); all base mm
 *   items   [{ key, cutType:'outside'|'inside'|'pocket'|..., cutDepth: mm | 'unset', footprints:[{ rings:[[{x,y}]], fillRule }] }]
 *   bounds  optional {minX,maxX,minY,maxY} of the design (joints); merged with the footprint rings for the derived size
 * Each mesh = { positions, normals, indices } (typed arrays). stats: triangles, per-group areas, skipped, unsetThrough.
 */
export function buildRelief({ stock, items = [], bounds = null } = {}) {
  const S = { ...DEFAULT_STOCK, ...(stock || {}) };
  const T = Number(S.thickness) > 0 ? Number(S.thickness) : DEFAULT_STOCK.thickness;
  const skipped = [], unsetThrough = [], entries = [];

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
    if (rule.depthUnset) unsetThrough.push(it.key);
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
  const R = new Array(depths.length);
  for (let k = depths.length - 1; k >= 0; k--) {
    R[k] = unionRegions(...entries.filter((e) => e.depth === depths[k]).map((e) => e.regions), k + 1 < depths.length ? R[k + 1] : []);
  }

  const top = newMesh(), floor = newMesh(), wall = newMesh(), bottom = newMesh(), side = newMesh();
  flatFace(top, depths.length ? diffRegions(rect, R[0]) : rect, 0, 1);
  let prev = 0;
  depths.forEach((d, k) => {
    const through = d >= T - 1e-9;
    if (!through) flatFace(floor, k + 1 < depths.length ? diffRegions(R[k], R[k + 1]) : R[k], -d, 1);
    wallStrips(wall, R[k], -prev, -d);
    prev = d;
  });
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
  return { stockBox: box, levels: depths.map((d, k) => ({ depth: d, through: d >= T - 1e-9, regions: R[k] })), meshes, stats: { triangles, areas, skipped, unsetThrough, levels: depths.length } };
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
