// packages/core/stl-slice.js — TASK 790: an STL mesh as ANOTHER SOURCE of the Fusion add-in's `selection_data` payload, so Shaper imports an STL through
// the ONE import path a Fusion selection takes (apps/shaper/src/fusion-import.js importFusionSelection). PURE (no DOM).
// TASK 807 (owner turns 2638-2640): an STL is imported as a RELIEF, always: ONE part with its depth information in `levels`, cut by Roughing (and
// the user's Contour). The per-feature import of TASK 790 (an outline, every pocket and through hole followed down plane sections of the mesh, their
// `slope` rings; owner: "feature is just stupid, ill just draw it") is gone, and so is the plane slicer it was read from (sections chained end point
// to end point: the spikes, the loops that did not close, the floral's back as noise): the levels are read from the part's HEIGHT MAP.
//
//   parseStl(bytes | text)                       -> { ok, triangles: Float32Array (9 per triangle), count, format } | { ok: false, message }
//   sliceStl(triangles, { up, unit, name })      -> { ok, payload, info: { sizeMm, triangles, sections, loops, grid, ms } } | { ok: false, message }
//   meshToBase64(triangles) / meshFromBase64(s)  the mesh as text (the Shaper document keeps it, so Up / Units can slice it again)
//
// READ: binary STL (80-byte header, uint32 count, 50 bytes per triangle) when the size matches the count, else ASCII (`solid` ... `facet` / `vertex`
// ... `endsolid`); anything else, a count that does not match, a number that is not one, no triangles, or more than STL_SLICE.maxTriangles: refused
// with a message. STL has no unit: `unit` (STL_UNITS) scales it to mm. `up` (STL_UP_SIDES) is the mesh axis that becomes the STOCK TOP (a proper
// rotation: never a mirror); the part is then placed with its lowest x / y at 0 (Y up, as the add-in's plane-2d frame) and its top at depth 0.
//
// LEVELS (top-down machining sees the part as its height field): the mesh's HEIGHT MAP from above (#core/height-map.js meshHeightGrid: the highest
// surface over every node of a grid, MESH_GRID.cellMm apart), then a LEVEL every STL_SLICE.stepMm from the top, one at every FLAT face of the mesh (a
// floor: its exact depth; faces closer than STL_SLICE.zSnapMm are one), one just below the top and one just above the bottom. A level at height z =
// the area where the surface is more than STL_SLICE.zSnapMm ABOVE z (just above a floor: the floor is not in it; the top level: the area within
// zSnapMm of the top), its loops by marching squares (#core/height-map.js gridContours: closed by construction, nested: material = inside an odd
// number of them; a wall steeper than one STL_SLICE.stepMm per cell put half way between its nodes, the same at every level), each reduced to within STL_SLICE.simplifyMm (Douglas-Peucker), a loop under STL_SLICE.sliverMm2 dropped as noise. What the top
// cannot see (an undercut, a hollow, a recess in the bottom) is not in the height map: it is never cut, by construction.
// THE PAYLOAD: ONE region, the RELIEF:
//   * its outer = the WORK AREA: the part's SILHOUETTE from above (the outline of every grid node a triangle covers), reduced to within
//     STL_SLICE.workAreaMm; when the part is seen as several separate pieces, the rectangle round them (their FOOTPRINT BOUNDS). Roughing grows it by
//     its bit margin (#core/stepped-cut.js LEVELS.workMarginBits: 2 bit diameters): that band round the part is cut to the full depth; no holes;
//   * cutType 'roughing' (the app's Roughing: Terraces by default), depth = the mesh height (= the stock thickness);
//   * `levels` (TASK 792, the contract's ONE optional field for a part's depth information) = [{ zFromTopMm, loops: [{ closed: true, segments }] }],
//     the MATERIAL SECTIONS above, from the top down (z = depth from the part's top, mm; loops in the payload's frame like `outer`, lines);
//   * WARNINGS: one, when an area of STL_SLICE.undercutMm2 or more is out of the top's reach (seen from above: something under the top surface
//     other than the part's own material down to its back: an overhang, a hollow, a recess in the bottom): the wood there is left.
import { meshHeightGrid, gridContoursAt } from './height-map.js';

/** The slicer's declared numbers (mm). */
export const STL_SLICE = Object.freeze({
  stepMm: 0.25,          // a level every step from the top (+ one at every flat face)
  maxTriangles: 1000000, // a bigger mesh is refused
  zSnapMm: 0.01,         // TASK 807: a level is the area MORE than this above its height (a floor flat only to its float noise is not in it); flat faces this close are one
  simplifyMm: 0.05,      // TASK 807: a level's loop is reduced to the fewest points within this of its marching-squares contour (Douglas-Peucker; half a MESH_GRID cell: the contour is only that close to the part)
  workAreaMm: 0.1,       // TASK 807: the work area (the silhouette) within this of it (Roughing grows it by 2 bits round the part)
  sliverMm2: 0.01,       // a loop smaller than this is noise
  undercutMm2: 0.5,      // TASK 807: an area out of the top's reach (seen from above) of at least this is warned about (less is mesh noise)
});
/** The mesh axis that becomes the stock top. */
export const STL_UP_SIDES = Object.freeze(['+Z', '-Z', '+Y', '-Y', '+X', '-X']);
/** What one STL unit is (STL files carry no unit). */
export const STL_UNITS = Object.freeze([Object.freeze({ id: 'mm', label: 'mm', mm: 1 }), Object.freeze({ id: 'in', label: 'in', mm: 25.4 })]);
export const STL_DEFAULTS = Object.freeze({ up: '+Z', unit: 'mm' });

const fail = (message) => ({ ok: false, message });
const r6 = (v) => Math.round(v * 1e6) / 1e6;
const fmt1 = (v) => String(Math.round(v * 10) / 10);

// ── READ ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
function toBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  return null;
}
const tooMany = (n) => fail(`This STL has ${n.toLocaleString('en-US')} triangles; the limit is ${STL_SLICE.maxTriangles.toLocaleString('en-US')}.`);

function parseBinary(bytes, n) {
  if (n === 0) return fail('This STL has no triangles.');
  if (n > STL_SLICE.maxTriangles) return tooMany(n);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tris = new Float32Array(9 * n);
  for (let i = 0; i < n; i++) {
    const off = 84 + 50 * i + 12; // the 12-byte normal is not read: the winding is not needed
    for (let k = 0; k < 9; k++) {
      const v = dv.getFloat32(off + 4 * k, true);
      if (!Number.isFinite(v)) return fail(`This STL is damaged: triangle ${i + 1} has a coordinate that is not a number.`);
      tris[9 * i + k] = v;
    }
  }
  return { ok: true, triangles: tris, count: n, format: 'binary' };
}

function parseAscii(text) {
  if (!/^\s*solid\b/i.test(text)) return fail('This is not an STL file.');
  const facets = (text.match(/\bfacet\b/gi) || []).length;
  const ends = (text.match(/\bendfacet\b/gi) || []).length;
  const coords = [];
  const re = /\bvertex\s+(\S+)\s+(\S+)\s+(\S+)/gi;
  for (let m; (m = re.exec(text));) coords.push(m[1], m[2], m[3]);
  const nv = coords.length / 3;
  if (facets === 0 && nv === 0) return fail('This STL has no triangles.');
  if (facets !== ends || nv !== 3 * facets || !/\bendsolid\b/i.test(text)) return fail(`This ASCII STL is damaged: ${facets} facets, ${ends} closed, ${nv} vertices${/\bendsolid\b/i.test(text) ? '' : ', no endsolid (the file ends early)'}.`);
  if (facets > STL_SLICE.maxTriangles) return tooMany(facets);
  const tris = new Float32Array(coords.length);
  for (let i = 0; i < coords.length; i++) {
    const v = Number(coords[i]);
    if (!Number.isFinite(v)) return fail(`This STL is damaged: "${coords[i]}" (triangle ${Math.floor(i / 9) + 1}) is not a number.`);
    tris[i] = v;
  }
  return { ok: true, triangles: tris, count: facets, format: 'ascii' };
}

/** An STL file (its bytes: ArrayBuffer / Uint8Array / Buffer, or an ASCII STL's text) -> its triangles, or a message saying why it is refused. */
export function parseStl(input) {
  if (typeof input === 'string') return parseAscii(input);
  const bytes = toBytes(input);
  if (!bytes) return fail('This is not an STL file.');
  if (!bytes.length) return fail('The file is empty.');
  const head = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.length, 256)));
  const solidText = /^\s*solid\b/i.test(head);
  if (bytes.length >= 84) {
    const n = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(80, true);
    if (84 + 50 * n === bytes.length) return parseBinary(bytes, n); // a binary STL (its header may start with "solid" too)
    if (!solidText) return fail(`This binary STL is damaged: its header says ${n.toLocaleString('en-US')} triangles (${(84 + 50 * n).toLocaleString('en-US')} bytes) but the file has ${bytes.length.toLocaleString('en-US')} bytes.`);
  }
  if (!solidText) return fail('This is not an STL file.');
  return parseAscii(new TextDecoder().decode(bytes));
}

/** The mesh as base64 text (Float32 little-endian, 9 per triangle) and back. */
export function meshToBase64(tris) {
  const f = tris instanceof Float32Array ? tris : new Float32Array(tris);
  const bytes = new Uint8Array(f.buffer, f.byteOffset, f.byteLength);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function meshFromBase64(text) {
  const s = atob(String(text || ''));
  if (s.length % 36 !== 0) return null;
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}

// ── ORIENT ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// The chosen up axis -> +Z by a proper rotation (determinant +1: a part is never mirrored).
const ROTATE = Object.freeze({
  '+Z': (x, y, z) => [x, y, z],
  '-Z': (x, y, z) => [x, -y, -z],
  '+Y': (x, y, z) => [x, -z, y],
  '-Y': (x, y, z) => [x, z, -y],
  '+X': (x, y, z) => [y, z, x],
  '-X': (x, y, z) => [y, -z, -x],
});
/** The triangles turned so `up` is +Z and scaled to mm, placed with min x = min y = 0: { P: Float64Array, zTop, zBot, sizeMm }. */
export function orientMesh(tris, { up = STL_DEFAULTS.up, unit = STL_DEFAULTS.unit } = {}) {
  const rot = ROTATE[up] || ROTATE[STL_DEFAULTS.up];
  const mm = (STL_UNITS.find((u) => u.id === unit) || STL_UNITS[0]).mm;
  const P = new Float64Array(tris.length);
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < tris.length; i += 3) {
    const [x, y, z] = rot(tris[i] * mm, tris[i + 1] * mm, tris[i + 2] * mm);
    P[i] = x; P[i + 1] = y; P[i + 2] = z;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  for (let i = 0; i < P.length; i += 3) { P[i] -= minX; P[i + 1] -= minY; }
  return { P, zTop: maxZ, zBot: minZ, sizeMm: { x: maxX - minX, y: maxY - minY, z: maxZ - minZ } };
}


// ── LEVELS ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
function signedArea(pts) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
  return a / 2;
}

// Douglas-Peucker on a CLOSED loop: the fewest points whose outline stays within `tol` of the loop (split at the point farthest from its first).
function reduceLoop(pts, tol) {
  if (pts.length <= 4) return pts;
  const segDist = (p, a, b) => {
    const vx = b[0] - a[0], vy = b[1] - a[1], L2 = vx * vx + vy * vy;
    let t = L2 > 0 ? ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / L2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return Math.hypot(p[0] - a[0] - t * vx, p[1] - a[1] - t * vy);
  };
  const keep = new Uint8Array(pts.length);
  const run = (i, j) => { // pts i..j (indices, j > i) with i and j kept
    const stack = [[i, j]];
    while (stack.length) {
      const [a, b] = stack.pop();
      let worst = -1, at = -1;
      for (let k = a + 1; k < b; k++) { const d = segDist(pts[k], pts[a], pts[b % pts.length]); if (d > worst) { worst = d; at = k; } }
      if (worst > tol) { keep[at] = 1; stack.push([a, at], [at, b]); }
    }
  };
  let far = 0, fd = -1;
  for (let k = 1; k < pts.length; k++) { const d = dist(pts[0], pts[k]); if (d > fd) { fd = d; far = k; } }
  keep[0] = 1; keep[far] = 1;
  run(0, far); run(far, pts.length);
  const out = pts.filter((_, k) => keep[k]);
  return out.length >= 3 ? out : pts;
}

// A level's loops (#core/height-map.js gridContoursAt; a wall rising more than one level step from a node to the next is put half way: so a vertical
// wall is the same loop at every level it crosses, one cut) reduced to `tol`, slivers dropped.
const reduced = (loops, tol) => loops.map((L) => reduceLoop(L, tol)).filter((L) => L.length >= 3 && Math.abs(signedArea(L)) >= STL_SLICE.sliverMm2);

// The area the top cannot see (mm²): the grid nodes whose vertical line crosses the mesh at more than two heights (a hollow, an overhang over a
// lower face, a face inside the part) or whose lowest surface is not the bottom (material over air: an overhang at the edge, a recess in the
// bottom). Read off the height map (#core/height-map.js meshHeightGrid `mid`, `lo`), not the faces' winding.
function hiddenMm2(grid, zBot) {
  const { mid, lo, h, cell } = grid, back = zBot + STL_SLICE.zSnapMm;
  let k = 0;
  for (let i = 0; i < h.length; i++) if (mid[i] || (h[i] !== -Infinity && lo[i] > back)) k++;
  return k * cell * cell;
}

// ── THE PAYLOAD ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const lineSegments = (pts) => pts.map((p, i) => { const q = pts[(i + 1) % pts.length]; return { type: 'line', x1: r6(p[0]), y1: r6(p[1]), x2: r6(q[0]), y2: r6(q[1]) }; });
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/**
 * sliceStl(triangles, { up, unit, name }) -> { ok, payload, info } | { ok: false, message }
 *   payload  a `selection_data` payload (the add-in's contract: units mm, Y up, stock.thicknessMm = the part's height, warnings) with ONE region, the
 *            RELIEF (header), whose source is { kind: 'stl', name, documentName: the name without .stl }
 *   info     { sizeMm: { x, y, z }, triangles, sections (levels), loops (in all levels), grid: { cols, rows, cellMm, ms }, ms }
 */
export function sliceStl(tris, { up = STL_DEFAULTS.up, unit = STL_DEFAULTS.unit, name = 'part.stl' } = {}) {
  const t0 = now();
  const n = Math.floor((tris && tris.length) / 9);
  if (!n) return fail('This STL has no triangles.');
  const { P, zTop, zBot, sizeMm } = orientMesh(tris, { up, unit });
  const H = zTop - zBot;
  if (!(H > 1e-6) || !(sizeMm.x > 1e-6) || !(sizeMm.y > 1e-6)) return fail('This STL is flat: it has no height or no area seen from the chosen Up side.');
  const grid = meshHeightGrid(P, { width: sizeMm.x, depth: sizeMm.y });
  const tGrid = now();

  // the level heights: the top (just below it), every step, every flat face (just above it), the bottom (just above it); closer than zSnapMm: one
  const flat = new Set();
  for (let o = 0; o < P.length; o += 9) if (P[o + 2] === P[o + 5] && P[o + 5] === P[o + 8]) flat.add(P[o + 2]);
  const planes = [{ z: zTop, top: true }];
  const cand = [zBot, ...[...flat].filter((z) => z < zTop)];
  for (let k = 1; zTop - k * STL_SLICE.stepMm > zBot + 1e-9; k++) cand.push(zTop - k * STL_SLICE.stepMm);
  cand.sort((a, b) => b - a);
  for (const z of cand) {
    const prev = planes[planes.length - 1];
    if (prev.z - z < STL_SLICE.zSnapMm) { if (flat.has(z) && !prev.top) prev.z = z; continue; } // a step on a flat face: the face's own height
    planes.push({ z, top: false });
  }
  // every level's loops and the silhouette (the nodes a triangle covers) in ONE pass over the grid
  const contours = gridContoursAt(grid, [...planes.map((pl) => (pl.top ? pl.z - STL_SLICE.zSnapMm : pl.z + STL_SLICE.zSnapMm)), -Infinity], { cliff: STL_SLICE.stepMm });
  const levels = planes.map((pl, k) => ({ zFromTopMm: r6(zTop - pl.z), loops: reduced(contours[k], STL_SLICE.simplifyMm) }));

  // the work area: the silhouette (one piece), else the footprint bounds
  const outers = reduced(contours[planes.length], STL_SLICE.workAreaMm).filter((L) => signedArea(L) > 0);
  const work = outers.length === 1 ? outers[0] : [[0, 0], [sizeMm.x, 0], [sizeMm.x, sizeMm.y], [0, sizeMm.y]];

  const warnings = [];
  const hidden = hiddenMm2(grid, zBot);
  if (hidden >= STL_SLICE.undercutMm2) warnings.push(`${fmt1(hidden)} mm² of the part is out of the top's reach (an overhang, a hollow, a recess under it): the wood there is left`);

  const region = {
    id: 'reg_0', label: 'Relief', cutType: 'roughing', depthMm: r6(H), through: true,
    outer: { closed: true, segments: lineSegments(work) }, holes: [],
    levels: levels.map((lv) => ({ zFromTopMm: lv.zFromTopMm, loops: lv.loops.map((L) => ({ closed: true, segments: lineSegments(L) })) })),
  };
  const documentName = String(name).replace(/\.stl$/i, '') || 'part';
  const t1 = now();
  return {
    ok: true,
    payload: {
      action: 'selection_data', version: 1, units: 'mm', coordSystem: { yAxis: 'up', frame: 'plane-2d' },
      source: { kind: 'stl', name: String(name), documentName },
      stock: { thicknessMm: r6(H) },
      regions: [region],
      chains: [],
      warnings,
    },
    info: {
      sizeMm: { x: r6(sizeMm.x), y: r6(sizeMm.y), z: r6(sizeMm.z) }, triangles: n, sections: levels.length, loops: levels.reduce((s, lv) => s + lv.loops.length, 0),
      grid: { cols: grid.cols, rows: grid.rows, cellMm: r6(grid.cell), ms: Math.round(tGrid - t0) }, ms: Math.round(t1 - t0),
    },
  };
}
