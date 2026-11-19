// packages/core/stl-slice.js — TASK 790: an STL mesh as ANOTHER SOURCE of the Fusion add-in's `selection_data` payload, so Shaper imports an STL through
// the ONE import path a Fusion selection takes (apps/shaper/src/fusion-import.js importFusionSelection). PURE (no DOM).
// TASK 807 (owner turns 2638-2640): an STL is imported as a RELIEF, always: ONE part with its depth information in `levels`, cut by Roughing (and
// the user's Contour). The per-feature import of TASK 790 (an outline, every pocket and through hole followed down plane sections of the mesh, their
// `slope` rings; owner: "feature is just stupid, ill just draw it") is gone, and so is the plane slicer it was read from (sections chained end point
// to end point: the spikes, the loops that did not close, the floral's back as noise): the levels are read from the part's HEIGHT MAP.
//
//   parseStl(bytes | text)                       -> { ok, triangles: Float32Array (9 per triangle), count, format } | { ok: false, message }
//   sliceStl(triangles, { up, unit, name, rotation }) -> { ok, payload, info: { sizeMm, triangles, sections, loops, grid, ms } } | { ok: false, message }
//   meshToBase64(triangles) / meshFromBase64(s)  the mesh as text (the Shaper document keeps it, so Up / Units can slice it again)
//
// READ: binary STL (80-byte header, uint32 count, 50 bytes per triangle) when the size matches the count, else ASCII (`solid` ... `facet` / `vertex`
// ... `endsolid`); anything else, a count that does not match, a number that is not one, no triangles, or more than STL_SLICE.maxTriangles: refused
// with a message. STL has no unit: `unit` (STL_UNITS) scales it to mm. `up` (STL_UP_SIDES) is the mesh axis that becomes the STOCK TOP (a proper
// rotation: never a mirror), or (TASK 808) any stored `rotation` (3x3, row-major: the Up sides are its presets, a clicked floor face sets it); the part is then placed with its lowest x / y at 0 (Y up, as the add-in's plane-2d frame) and its top at depth 0.
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

// ── ORIENT ─────────────────────────────────────────────────────────────────────────────────
// TASK 808 (owner turn 2641): the orientation is ONE stored ROTATION (a 3x3 matrix, row-major, 9 numbers; a proper rotation: never a mirror) applied to
// the mesh (in mm) before the height map. The six Up sides are PRESETS of it (UP_ROTATIONS: that axis becomes the stock top); a clicked FLOOR FACE sets
// the same rotation (rotationForFloor: the face's outward normal turned to point straight DOWN, -Z). A part is placed with its lowest x / y at 0 and its
// floor (its lowest point) at z 0.
export const UP_ROTATIONS = Object.freeze({
  '+Z': Object.freeze([1, 0, 0, 0, 1, 0, 0, 0, 1]),
  '-Z': Object.freeze([1, 0, 0, 0, -1, 0, 0, 0, -1]),
  '+Y': Object.freeze([1, 0, 0, 0, 0, -1, 0, 1, 0]),
  '-Y': Object.freeze([1, 0, 0, 0, 0, 1, 0, -1, 0]),
  '+X': Object.freeze([0, 1, 0, 0, 0, 1, 1, 0, 0]),
  '-X': Object.freeze([0, 1, 0, 0, 0, -1, -1, 0, 0]),
});
/** The outward normal a floor has for an Up side: the opposite of its axis. */
const UP_FLOOR = Object.freeze({ '+Z': [0, 0, -1], '-Z': [0, 0, 1], '+Y': [0, -1, 0], '-Y': [0, 1, 0], '+X': [-1, 0, 0], '-X': [1, 0, 0] });
/** The declared numbers of the floor pick. */
export const STL_ORIENT = Object.freeze({
  coplanarDeg: 2,    // the clicked face = the connected triangles round the picked one whose normals are within this of its own (their area-weighted mean normal is the floor's)
  axisCos: 1 - 1e-9, // a floor normal this close to an axis is that axis (its Up preset: the same rotation)
});
/** A stored rotation is 9 finite numbers. */
export const rotationOk = (r) => Array.isArray(r) && r.length === 9 && r.every(Number.isFinite);
const upOf = (rot) => Object.keys(UP_ROTATIONS).find((k) => UP_ROTATIONS[k].every((v, i) => v === rot[i])) || null;
const upOrDefault = (up) => (UP_ROTATIONS[up] ? up : STL_DEFAULTS.up);

/** The orientation of an Up side: { up, rotation, floor: null }. */
export const orientationForUp = (up) => ({ up: upOrDefault(up), rotation: [...UP_ROTATIONS[upOrDefault(up)]], floor: null });
/**
 * The orientation whose floor is the face with outward normal `n` (any direction): { up: the Up side when n is along an axis (that preset's rotation: a
 * part keeps its layout), else null; rotation; floor: the unit normal, kept for the record } | null (no direction). A tilted normal turns by the
 * SHORTEST ARC to -Z.
 */
export function rotationForFloor(n) {
  const len = Math.hypot(n[0], n[1], n[2]);
  if (!(len > 1e-12)) return null;
  const u = [n[0] / len, n[1] / len, n[2] / len];
  for (const id of Object.keys(UP_FLOOR)) {
    const f = UP_FLOOR[id];
    if (u[0] * f[0] + u[1] * f[1] + u[2] * f[2] >= STL_ORIENT.axisCos) return { up: id, rotation: [...UP_ROTATIONS[id]], floor: u };
  }
  // Rodrigues: the rotation taking u to d = (0, 0, -1): axis a = u x d = (-uy, ux, 0), cos = u . d = -uz (u is not within 1e-9 of d here: a preset took it)
  const c = -u[2], ax = -u[1], ay = u[0], k = (1 + u[2]) / (ax * ax + ay * ay); // 1 / (1 + c), as (1 + uz) / (ux² + uy²): stable when u is nearly +Z (1 + c is a cancellation there)
  const R = [c + ax * ax * k, ax * ay * k, ay, ax * ay * k, c + ay * ay * k, -ax, -ay, ax, c];
  return { up: upOf(R), rotation: R, floor: u };
}
/** The orientation options mean: { up (the Up side when the rotation is a preset, else null), rotation } (a stored rotation wins over `up`). */
export function orientationOf({ rotation = null, up = STL_DEFAULTS.up } = {}) {
  if (rotationOk(rotation)) return { rotation: [...rotation], up: upOf(rotation) };
  return { rotation: [...UP_ROTATIONS[upOrDefault(up)]], up: upOrDefault(up) };
}

const unitMm = (unit) => (STL_UNITS.find((u) => u.id === unit) || STL_UNITS[0]).mm;

/** The mesh turned by `rotation` and scaled to mm: its bounds { minX, minY, minZ, maxX, maxY, maxZ } (no copy of the mesh). */
export function orientedBounds(tris, { rotation, unit = STL_DEFAULTS.unit } = {}) {
  const R = rotationOk(rotation) ? rotation : UP_ROTATIONS[STL_DEFAULTS.up], mm = unitMm(unit);
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < tris.length; i += 3) {
    const a = tris[i] * mm, b = tris[i + 1] * mm, c = tris[i + 2] * mm;
    const x = R[0] * a + R[1] * b + R[2] * c, y = R[3] * a + R[4] * b + R[5] * c, z = R[6] * a + R[7] * b + R[8] * c;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  return { minX, minY, minZ, maxX, maxY, maxZ };
}
/** The triangles turned and scaled to mm, placed with min x = min y = 0 and the floor at z 0: { P: Float64Array, zTop, zBot (0), sizeMm }. `rotation` wins over `up`. */
export function orientMesh(tris, { up = STL_DEFAULTS.up, unit = STL_DEFAULTS.unit, rotation = null } = {}) {
  const R = orientationOf({ rotation, up }).rotation, mm = unitMm(unit);
  const { minX, minY, minZ, maxX, maxY, maxZ } = orientedBounds(tris, { rotation: R, unit });
  const P = new Float64Array(tris.length);
  for (let i = 0; i < tris.length; i += 3) {
    const a = tris[i] * mm, b = tris[i + 1] * mm, c = tris[i + 2] * mm;
    P[i] = R[0] * a + R[1] * b + R[2] * c - minX;
    P[i + 1] = R[3] * a + R[4] * b + R[5] * c - minY;
    P[i + 2] = R[6] * a + R[7] * b + R[8] * c - minZ;
  }
  return { P, zTop: maxZ - minZ, zBot: 0, sizeMm: { x: maxX - minX, y: maxY - minY, z: maxZ - minZ } };
}

// ── THE FLOOR FACE ───────────────────────────────────────────────────────────────────────────
const ADJ = new WeakMap(); // the mesh -> { nrm: unit normal per triangle, area, near: the triangles sharing an edge with each }
function adjacency(tris) {
  let a = ADJ.get(tris);
  if (a) return a;
  const n = tris.length / 9, nrm = new Float64Array(3 * n), area = new Float64Array(n);
  let span = 0;
  for (let i = 0; i < tris.length; i++) if (Math.abs(tris[i]) > span) span = Math.abs(tris[i]);
  const q = 1e-5 * (span || 1); // corners closer than this are one (a mesh's shared corners are bit-equal; this only forgives float noise)
  const ids = new Map(), vid = new Int32Array(3 * n);
  for (let t = 0; t < n; t++) {
    const o = 9 * t;
    const ux = tris[o + 3] - tris[o], uy = tris[o + 4] - tris[o + 1], uz = tris[o + 5] - tris[o + 2];
    const vx = tris[o + 6] - tris[o], vy = tris[o + 7] - tris[o + 1], vz = tris[o + 8] - tris[o + 2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx, L = Math.hypot(cx, cy, cz);
    area[t] = L / 2;
    if (L > 0) { nrm[3 * t] = cx / L; nrm[3 * t + 1] = cy / L; nrm[3 * t + 2] = cz / L; }
    for (let k = 0; k < 3; k++) {
      const key = Math.round(tris[o + 3 * k] / q) + ',' + Math.round(tris[o + 3 * k + 1] / q) + ',' + Math.round(tris[o + 3 * k + 2] / q);
      let id = ids.get(key);
      if (id === undefined) { id = ids.size; ids.set(key, id); }
      vid[3 * t + k] = id;
    }
  }
  const edges = new Map(), near = Array.from({ length: n }, () => []);
  for (let t = 0; t < n; t++) {
    for (let k = 0; k < 3; k++) {
      const p = vid[3 * t + k], r = vid[3 * t + (k + 1) % 3], key = p < r ? p * 4294967296 + r : r * 4294967296 + p;
      const o = edges.get(key);
      if (o === undefined) edges.set(key, t); else if (o !== t) { near[t].push(o); near[o].push(t); }
    }
  }
  a = { nrm, area, near };
  ADJ.set(tris, a);
  return a;
}
/**
 * The FLOOR FACE round triangle `tri`: the triangles connected to it through shared edges whose normals are within STL_ORIENT.coplanarDeg of the PICKED
 * triangle's own (not of their neighbour's: a curved face does not creep round; a triangle wound the other way is the same plane, so the line, not the
 * arrow, is compared); the face's normal = their area-weighted mean, unit. Its SIDE: toward `facing` (a direction toward the viewer: the side of the
 * face the user can see and clicked, whatever the file's winding) when given, else the picked triangle's winding (counter-clockwise seen from outside).
 * -> { normal: [x, y, z], triangles: n } | null (no such triangle, or a degenerate one).
 */
export function floorFaceAt(tris, tri, { angleDeg = STL_ORIENT.coplanarDeg, facing = null } = {}) {
  const { nrm, area, near } = adjacency(tris);
  if (!(tri >= 0 && 3 * tri + 2 < nrm.length) || (nrm[3 * tri] === 0 && nrm[3 * tri + 1] === 0 && nrm[3 * tri + 2] === 0)) return null;
  const cos = Math.cos((angleDeg * Math.PI) / 180), sx = nrm[3 * tri], sy = nrm[3 * tri + 1], sz = nrm[3 * tri + 2];
  const seen = new Set([tri]), stack = [tri];
  let nx = 0, ny = 0, nz = 0;
  while (stack.length) {
    const t = stack.pop();
    const d = nrm[3 * t] * sx + nrm[3 * t + 1] * sy + nrm[3 * t + 2] * sz, w = (d < 0 ? -1 : 1) * area[t];
    nx += nrm[3 * t] * w; ny += nrm[3 * t + 1] * w; nz += nrm[3 * t + 2] * w;
    for (const m of near[t]) {
      if (seen.has(m)) continue;
      if (Math.abs(nrm[3 * m] * sx + nrm[3 * m + 1] * sy + nrm[3 * m + 2] * sz) >= cos) { seen.add(m); stack.push(m); }
    }
  }
  const L = Math.hypot(nx, ny, nz);
  if (!(L > 0)) return null;
  const flip = facing && nx * facing[0] + ny * facing[1] + nz * facing[2] < 0 ? -1 : 1;
  return { normal: [flip * nx / L, flip * ny / L, flip * nz / L], triangles: seen.size };
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
export function sliceStl(tris, { up = STL_DEFAULTS.up, unit = STL_DEFAULTS.unit, name = 'part.stl', rotation = null } = {}) {
  const t0 = now();
  const n = Math.floor((tris && tris.length) / 9);
  if (!n) return fail('This STL has no triangles.');
  const { P, zTop, zBot, sizeMm } = orientMesh(tris, { up, unit, rotation });
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
