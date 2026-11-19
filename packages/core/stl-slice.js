// packages/core/stl-slice.js — TASK 790: an STL mesh as ANOTHER SOURCE of the Fusion add-in's `selection_data` payload (the regions of a body: the
// outline, every pocket and through hole, each with its depth and, when its wall is not vertical, its `slope` rings), so Shaper imports an STL through
// the ONE import path a Fusion selection takes (apps/shaper/src/fusion-import.js importFusionSelection). PURE (no DOM).
//
//   parseStl(bytes | text)                       -> { ok, triangles: Float32Array (9 per triangle), count, format } | { ok: false, message }
//   sliceStl(triangles, { up, unit, name })      -> { ok, payload, info: { sizeMm, triangles, sections, ms } } | { ok: false, message }
//   meshToBase64(triangles) / meshFromBase64(s)  the mesh as text (the Shaper document keeps it, so Up / Units can slice it again)
//
// READ: binary STL (80-byte header, uint32 count, 50 bytes per triangle) when the size matches the count, else ASCII (`solid` ... `facet` / `vertex`
// ... `endsolid`); anything else, a count that does not match, a number that is not one, no triangles, or more than STL_SLICE.maxTriangles: refused
// with a message. STL has no unit: `unit` (STL_UNITS) scales it to mm. `up` (STL_UP_SIDES) is the mesh axis that becomes the STOCK TOP (a proper
// rotation: never a mirror); the part is then placed with its lowest x / y at 0 (Y up, as the add-in's plane-2d frame) and its top at depth 0.
//
// SLICE (top-down machining only): a SECTION of the mesh every STL_SLICE.stepMm from the top (the add-in reads its rings every 0.25 mm) plus one just
// above every FLAT face (a pocket floor, a shoulder: exact depths), and one just below the top and just above the bottom. A section = the triangle /
// plane segments chained into closed loops (shared mesh edges give the same point exactly; pieces whose ends are within STL_SLICE.joinMm are joined;
// what still does not close is left out WITH a warning); collinear points are merged and a loop is reduced to within STL_SLICE.simplifyMm, a loop under STL_SLICE.sliverMm2 is noise and dropped, a loop
// whose points all lie on one circle (STL_SLICE.circle) is that circle. Loops nest: material (even depth) and air (odd depth).
// From the stack of sections, the SAME regions the add-in sends for a body:
//   * OUTLINE (outside cut, through, depth = the part's height): the part's outer loop at every depth, followed down from the top; a loop that splits
//     going down (legs under an overhang) follows its largest piece (the rest is an undercut: cut straight); separate raised parts that join lower
//     down cannot be one outline: it starts where they join (cut straight above) with a warning. Several separate parts = several outlines.
//   * POCKET / THROUGH HOLE: an air loop of the TOP section followed down (it may narrow, widen, split): it ends at its FLOOR (a pocket: depth = the
//     lowest mesh point under it) or reaches the bottom (a through hole, inside cut). Where a flat face inside it narrows it (a counterbore's shoulder),
//     what goes on below is its own pocket / hole. Material islands standing in a pocket are the pocket's holes. Air that is not open from the top (a
//     hollow, a recess in the bottom) cannot be cut from the top: a warning.
//   * SLOPE: a region whose loop changes with depth carries `slope` rings exactly as the add-in writes them (SELECTION-BRIDGE rule 3a: rings top-down,
//     { zFromTopMm, segments }; a straight stretch is its first and last ring). Its `outer` (the plain cut) is its STRAIGHT WALL (the loop it keeps over
//     the greatest depth); a wall that is nowhere straight is cut straight at its widest loop (a drafted pocket: its top opening, the add-in's own
//     rule, with its warning). An undercut (#core/stepped-cut.js steppedTerraces, the ONE place it is decided) gets the add-in's warning wording.
import { steppedTerraces, sameOutline, SAME_OUTLINE_TOL_MM } from './stepped-cut.js';
import { regionsFromRings, intersectRegions, regionsArea } from './plot/clip.js';

/** The slicer's declared numbers (mm). */
export const STL_SLICE = Object.freeze({
  stepMm: 0.25,          // a section every step from the top (+ one above every flat face)
  maxTriangles: 1000000, // a bigger mesh is refused (TASK 790, measured: 50 000 triangles slice in ~0.1 s; the owner's 529 064-triangle relief in ~2 s in node, ~5 s file-to-notice in the page)
  joinMm: 0.01,          // section pieces whose ends are this close are joined (a mesh with tiny gaps)
  sliverMm2: 0.01,       // a closed section smaller than this is noise
  straightMm: 1e-4,      // a point this close to the line through its neighbours is merged away
  simplifyMm: 0.01,      // a section loop (not a circle) is reduced to the fewest points within this of it (Douglas-Peucker; = SAME_OUTLINE_TOL_MM)
  wallMm: 1,             // a STRAIGHT WALL: the same loop (within SAME_OUTLINE_TOL_MM) over at least this depth
  circle: Object.freeze({ minSides: 16, radialMm: 0.01, sagittaMm: 0.05 }), // a loop of >= minSides points, all within radialMm of one circle, chords within sagittaMm of it
});
/** The mesh axis that becomes the stock top. */
export const STL_UP_SIDES = Object.freeze(['+Z', '-Z', '+Y', '-Y', '+X', '-X']);
/** What one STL unit is (STL files carry no unit). */
export const STL_UNITS = Object.freeze([Object.freeze({ id: 'mm', label: 'mm', mm: 1 }), Object.freeze({ id: 'in', label: 'in', mm: 25.4 })]);
export const STL_DEFAULTS = Object.freeze({ up: '+Z', unit: 'mm' });

const fail = (message) => ({ ok: false, message });
const r6 = (v) => Math.round(v * 1e6) / 1e6;
const fmtMm = (v) => String(Math.round(v * 1000) / 1000);

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

// ── SECTIONS ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// The point where the plane crosses the edge i-j, computed from the edge's two ends in ONE order (so the two triangles sharing the edge give the same
// floats) and exactly the end point when that end lies on the plane.
function edgePoint(P, i, j, plane) {
  if (P[i] > P[j] || (P[i] === P[j] && (P[i + 1] > P[j + 1] || (P[i + 1] === P[j + 1] && P[i + 2] > P[j + 2])))) { const k = i; i = j; j = k; }
  if (P[i + 2] === plane) return [P[i], P[i + 1]];
  if (P[j + 2] === plane) return [P[j], P[j + 1]];
  const t = (plane - P[i + 2]) / (P[j + 2] - P[i + 2]);
  return [P[i] + t * (P[j] - P[i]), P[i + 1] + t * (P[j + 1] - P[i + 1])];
}

// The segments of the section at `plane`. A vertex ON the plane counts as below it (the section just above the plane: a floor at the plane is not in
// it), except for the top section (`top`: the section just below the top face).
function sectionSegments(P, active, plane, top) {
  const segs = [];
  for (const t of active) {
    const o = 9 * t;
    const a0 = top ? P[o + 2] >= plane : P[o + 2] > plane;
    const a1 = top ? P[o + 5] >= plane : P[o + 5] > plane;
    const a2 = top ? P[o + 8] >= plane : P[o + 8] > plane;
    if (a0 === a1 && a1 === a2) continue;
    const pts = [];
    if (a0 !== a1) pts.push(edgePoint(P, o, o + 3, plane));
    if (a1 !== a2) pts.push(edgePoint(P, o + 3, o + 6, plane));
    if (a2 !== a0) pts.push(edgePoint(P, o + 6, o, plane));
    if (pts[0][0] === pts[1][0] && pts[0][1] === pts[1][1]) continue;
    segs.push(pts);
  }
  return segs;
}

const keyOf = (p) => p[0] + ',' + p[1];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// Segments -> closed point loops (+ the count of pieces that would not close).
function chainLoops(segs) {
  const at = new Map();
  segs.forEach((s, i) => { for (const p of s) { const k = keyOf(p); let l = at.get(k); if (!l) at.set(k, (l = [])); l.push(i); } });
  const used = new Uint8Array(segs.length);
  const take = (p) => { for (const i of at.get(keyOf(p)) || []) if (!used[i]) { used[i] = 1; const s = segs[i]; return keyOf(s[0]) === keyOf(p) ? s[1] : s[0]; } return null; };
  const loops = [], open = [];
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const pts = [segs[i][0], segs[i][1]];
    const startKey = keyOf(pts[0]);
    let closed = false;
    for (let q = take(pts[pts.length - 1]); q; q = take(pts[pts.length - 1])) { if (keyOf(q) === startKey) { closed = true; break; } pts.push(q); }
    if (closed) { loops.push(pts); continue; }
    for (let q = take(pts[0]); q; q = take(pts[0])) pts.unshift(q); // the other way from the start
    open.push(pts);
  }
  // pieces with tiny gaps: join ends within joinMm, close a piece whose ends meet
  let changed = true;
  while (changed && open.length) {
    changed = false;
    for (let i = 0; i < open.length && !changed; i++) {
      const a = open[i];
      if (a.length > 2 && dist(a[0], a[a.length - 1]) <= STL_SLICE.joinMm) { loops.push(a); open.splice(i, 1); changed = true; break; }
      for (let j = 0; j < open.length && !changed; j++) {
        if (j === i) continue;
        const b = open[j], end = a[a.length - 1];
        if (dist(end, b[0]) <= STL_SLICE.joinMm) { a.push(...b); open.splice(j, 1); changed = true; }
        else if (dist(end, b[b.length - 1]) <= STL_SLICE.joinMm) { a.push(...b.slice().reverse()); open.splice(j, 1); changed = true; }
      }
    }
  }
  return { loops, open: open.length };
}

// Merge collinear points (the two triangles of a flat wall give two pieces of one line).
function simplify(pts) {
  const tol = STL_SLICE.straightMm;
  const between = (a, b, c) => { // b on the segment a-c within tol
    const vx = c[0] - a[0], vy = c[1] - a[1], L = Math.hypot(vx, vy);
    if (L < 1e-12) return dist(a, b) <= tol;
    const d = Math.abs((b[0] - a[0]) * vy - (b[1] - a[1]) * vx) / L;
    const t = ((b[0] - a[0]) * vx + (b[1] - a[1]) * vy) / (L * L);
    return d <= tol && t > 0 && t < 1;
  };
  let out = [];
  for (const p of pts) { if (out.length && dist(out[out.length - 1], p) <= 1e-9) continue; out.push(p); }
  if (out.length > 1 && dist(out[0], out[out.length - 1]) <= 1e-9) out.pop();
  let changed = true;
  while (changed && out.length > 3) {
    changed = false;
    const st = [];
    for (const p of out) { while (st.length >= 2 && between(st[st.length - 2], st[st.length - 1], p)) { st.pop(); changed = true; } st.push(p); }
    while (st.length > 3 && between(st[st.length - 2], st[st.length - 1], st[0])) { st.pop(); changed = true; }
    while (st.length > 3 && between(st[st.length - 1], st[0], st[1])) { st.shift(); changed = true; }
    out = st;
  }
  return out;
}

function signedArea(pts) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
  return a / 2;
}
function bboxOf(pts) {
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  for (const p of pts) { if (p[0] < b[0]) b[0] = p[0]; if (p[1] < b[1]) b[1] = p[1]; if (p[0] > b[2]) b[2] = p[0]; if (p[1] > b[3]) b[3] = p[1]; }
  return b;
}
function inPoly(p, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const inBox = (p, b) => p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3];
const boxesMeet = (a, b) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];

// A loop whose points all lie on one circle (a cylinder, a sphere, a cone cut across): { cx, cy, r }, or null.
function circleOf(pts) {
  const C = STL_SLICE.circle;
  if (pts.length < C.minSides) return null;
  let cx = 0, cy = 0;
  for (const p of pts) { cx += p[0]; cy += p[1]; }
  cx /= pts.length; cy /= pts.length;
  const rs = pts.map((p) => Math.hypot(p[0] - cx, p[1] - cy));
  const r = rs.reduce((s, v) => s + v, 0) / rs.length;
  if (!(r > 0) || rs.some((v) => Math.abs(v - r) > C.radialMm)) return null;
  const maxGap = 2 * Math.acos(Math.max(-1, 1 - C.sagittaMm / r));
  const ang = pts.map((p) => Math.atan2(p[1] - cy, p[0] - cx)).sort((a, b) => a - b);
  for (let i = 0; i < ang.length; i++) { const g = i === ang.length - 1 ? ang[0] + 2 * Math.PI - ang[i] : ang[i + 1] - ang[i]; if (g > maxGap) return null; }
  return { cx, cy, r };
}

// Douglas-Peucker on a CLOSED loop: the fewest points whose outline stays within `tol` of the loop (split at its two farthest-apart points).
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

// A section loop: whole circles are detected on its points as read; any other loop is reduced to STL_SLICE.simplifyMm (a mesh cut across
// gives many tiny segments: 0.0005 mm ones in a real mesh).
function makeLoop(raw) {
  const circle = circleOf(raw);
  const pts = circle ? raw : reduceLoop(raw, STL_SLICE.simplifyMm);
  return { pts, abs: Math.abs(signedArea(pts)), bbox: bboxOf(pts), circle, nest: 0, parent: null, children: [] };
}

// One section: its loops (nested: nest 0 = the part's outer material, odd = air, even > 0 = material standing in air).
function buildSection(segs) {
  const { loops: raw, open } = chainLoops(segs);
  const loops = raw.map(simplify).filter((p) => p.length >= 3).map(makeLoop).filter((L) => L.abs >= STL_SLICE.sliverMm2);
  for (const L of loops) {
    const s = L.pts[0];
    let parent = null, n = 0;
    for (const M of loops) {
      if (M === L || M.abs <= L.abs || !inBox(s, M.bbox) || !inPoly(s, M.pts)) continue;
      n++;
      if (!parent || M.abs < parent.abs) parent = M;
    }
    L.nest = n; L.parent = parent;
  }
  for (const L of loops) if (L.parent) L.parent.children.push(L);
  return { loops, open };
}

const ringOf = (pts) => { const r = pts.map((p) => [p[0], p[1]]); r.push([pts[0][0], pts[0][1]]); return r; };
function overlaps(A, B) {
  if (!boxesMeet(A.bbox, B.bbox)) return false;
  if (inPoly(A.pts[0], B.pts) || inPoly(B.pts[0], A.pts)) return true;
  return regionsArea(intersectRegions(regionsFromRings([ringOf(A.pts)]), regionsFromRings([ringOf(B.pts)]))) > 1e-6;
}

// ── TRACKING ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const newChain = (loop, k, extra = {}) => ({ rings: [{ k, loop }], start: k, end: null, ...extra });
const lastLoop = (c) => c.rings[c.rings.length - 1].loop;

// Is the point in MATERIAL at a level (inside an odd number of its loops)?
const inMaterial = (lv, p) => lv.loops.reduce((n, L) => n + (inBox(p, L.bbox) && inPoly(p, L.pts) ? 1 : 0), 0) % 2 === 1;
// A point inside a loop (its centroid when that is inside, else the middle of its first edge moved a hair inward).
function insidePoint(L) {
  let cx = 0, cy = 0;
  for (const p of L.pts) { cx += p[0]; cy += p[1]; }
  const c = [cx / L.pts.length, cy / L.pts.length];
  if (inPoly(c, L.pts)) return c;
  const [a, b] = [L.pts[0], L.pts[1]], m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], len = dist(a, b) || 1;
  const nrm = [-(b[1] - a[1]) / len, (b[0] - a[0]) / len], e = 1e-4;
  const q = [m[0] + nrm[0] * e, m[1] + nrm[1] * e];
  return inPoly(q, L.pts) ? q : [m[0] - nrm[0] * e, m[1] - nrm[1] * e];
}

// AIR followed down from the top: pockets and through holes (and the hollows that are not open from the top). An air loop that first shows below
// the top is OPEN when the level above has no material there (a pocket in a lower face), else it is a hollow.
function trackCavities(levels, floorBetween) {
  const chains = [];
  let active = [];
  levels.forEach((lv, k) => {
    const holes = lv.loops.filter((L) => L.nest % 2 === 1);
    if (k === 0) { active = holes.map((h) => newChain(h, 0, { hollow: false })); chains.push(...active); return; }
    const ownersOf = holes.map((h) => active.filter((c) => overlaps(lastLoop(c), h)));
    const conts = new Map(active.map((c) => [c, 0]));
    ownersOf.forEach((os) => os.forEach((c) => conts.set(c, conts.get(c) + 1)));
    const next = [], ended = new Set();
    holes.forEach((h, i) => {
      const owners = ownersOf[i];
      if (!owners.length) { const c = newChain(h, k, { hollow: inMaterial(levels[k - 1], insidePoint(h)) }); chains.push(c); next.push(c); return; }
      const primary = owners.reduce((a, b) => (lastLoop(b).abs > lastLoop(a).abs ? b : a));
      for (const o of owners) if (o !== primary) ended.add(o); // two air loops join going down: the larger one goes on (the stepped cut sees the undercut)
      if (conts.get(primary) === 1 && !ended.has(primary) && !floorBetween(k - 1, lastLoop(primary), h)) { primary.rings.push({ k, loop: h }); next.push(primary); return; }
      ended.add(primary); // it splits, or a floor narrows it: what goes on below is its own pocket / hole
      const c = newChain(h, k, { hollow: primary.hollow, parent: primary });
      chains.push(c); next.push(c);
    });
    for (const c of active) if (!next.includes(c) && c.end === null) c.end = k - 1;
    active = next;
  });
  for (const c of active) if (c.end === null) { c.end = levels.length - 1; c.through = true; }
  return chains;
}

// The part's OUTER material loops followed down from the top: the outlines. Where the outer loop WIDENS going down at a flat face (a SHOULDER: a boss,
// raised letters standing on a plate), the raised parts above it are not outlines: the area around them down to that face is a pocket whose islands
// are the raised parts (`shoulders`), and the outline goes on from the face down.
function trackOutlines(levels, { shoulderAt }) {
  const chains = [], shoulders = [];
  let active = [];
  levels.forEach((lv, k) => {
    const islands = lv.loops.filter((L) => L.nest === 0);
    const ownersOf = islands.map((I) => active.filter((c) => overlaps(lastLoop(c), I)));
    // each chain goes on with its LARGEST continuation; the others are material under an overhang (an undercut: cut straight)
    const choice = new Map();
    for (const c of active) {
      let best = null;
      islands.forEach((I, i) => { if (ownersOf[i].includes(c) && (!best || I.abs > best.abs)) best = I; });
      if (best) choice.set(c, best);
    }
    const next = [];
    islands.forEach((I, i) => {
      const owners = ownersOf[i];
      if (!owners.length) { const c = newChain(I, k); chains.push(c); next.push(c); return; }
      const choosers = owners.filter((c) => choice.get(c) === I);
      if (!choosers.length) { for (const c of owners) c.undercutAt = c.undercutAt ?? k - 1; return; } // under an overhang
      const primary = choosers.reduce((a, b) => (lastLoop(b).abs > lastLoop(a).abs ? b : a));
      if (shoulderAt(k - 1, I, choosers.map(lastLoop))) { // a shoulder: the raised parts end here; the outline starts again from the face
        for (const o of choosers) { o.end = k - 1; o.raised = true; }
        shoulders.push({ k: k - 1, outer: I, raised: choosers });
        const c = newChain(I, k); chains.push(c); next.push(c);
        return;
      }
      if (choosers.length > 1) { // separate raised parts join here with no flat face between: one outline from here down, cut straight above
        for (const o of choosers) if (o !== primary) { o.end = k - 1; o.merged = true; primary.parts = (primary.parts || 1) + (o.parts || 1); }
        primary.joinedAt = k; // its outline starts here (cut straight above); ONE warning per outline says how many parts joined (sliceStl)
        primary.rings = [];
      }
      primary.rings.push({ k, loop: I }); next.push(primary);
    });
    for (const c of active) if (!next.includes(c) && c.end === null) c.end = k - 1;
    active = next;
  });
  for (const c of active) if (c.end === null) { c.end = levels.length - 1; c.through = true; }
  return { chains, shoulders };
}

// ── REGIONS ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const segmentsOf = (L) => {
  if (L.circle) return [{ type: 'circle', cx: r6(L.circle.cx), cy: r6(L.circle.cy), r: r6(L.circle.r) }];
  return L.pts.map((p, i) => { const q = L.pts[(i + 1) % L.pts.length]; return { type: 'line', x1: r6(p[0]), y1: r6(p[1]), x2: r6(q[0]), y2: r6(q[1]) }; });
};
const polyOf = (L) => L.pts.map((p) => ({ x: p[0], y: p[1] }));
const sameLoop = (A, B) => (A.circle && B.circle
  ? Math.hypot(A.circle.cx - B.circle.cx, A.circle.cy - B.circle.cy) <= SAME_OUTLINE_TOL_MM && Math.abs(A.circle.r - B.circle.r) <= SAME_OUTLINE_TOL_MM
  : !A.circle === !B.circle && sameOutline(polyOf(A), polyOf(B)));

// The undercut of a wall: the depth below which it comes back under what the top keeps (THE rule: #core/stepped-cut.js steppedTerraces), or null.
function undercutOf(kind, slope, depth) {
  if (!slope) return null;
  return steppedTerraces({ kind, rings: slope.map((r) => ({ z: r.zFromTopMm, segments: r.segments })) }, { kind, step: depth, depth }).undercutBelow;
}

/**
 * A chain's rings [{ z, loop }] -> { outer, slope, straight, atTop, undercut } for a region cut as `kind` ('outside' | 'pocket' | 'inside') to `depth`.
 *  slope: runs of the same loop (each compared with its run's FIRST loop) keep their first and last ring; null for one run (a vertical wall).
 *  outer (the plain cut): only the rings down to the undercut count (the plain cut never cuts what the top keeps): the longest STRAIGHT run of at least
 *  STL_SLICE.wallMm (its widest loop for an outline, its narrowest for air: within SAME_OUTLINE_TOL_MM of each other), else the WIDEST ring (a
 *  pocket's top opening, a dome's base).
 */
function wallOf(rings, kind, depth) {
  const runs = [];
  for (const r of rings) {
    const run = runs[runs.length - 1];
    if (run && sameLoop(run.first.loop, r.loop)) { run.last = r; run.all.push(r); } else runs.push({ first: r, last: r, all: [r] });
  }
  let slope = null;
  if (runs.length > 1) {
    slope = [];
    for (const run of runs) {
      slope.push({ zFromTopMm: r6(run.first.z), segments: segmentsOf(run.first.loop) });
      if (run.last !== run.first) slope.push({ zFromTopMm: r6(run.last.z), segments: segmentsOf(run.last.loop) });
    }
  }
  const undercut = undercutOf(kind, slope, depth);
  const reach = (r) => undercut === null || r.z <= undercut + 1e-9;
  const bigger = (a, b) => (b.loop.abs > a.loop.abs + 1e-9 ? b : a), smaller = (a, b) => (b.loop.abs < a.loop.abs - 1e-9 ? b : a);
  const straight = runs.map((run) => ({ ...run, all: run.all.filter(reach) })).filter((run) => run.all.length > 1)
    .reduce((best, run) => { const span = run.all[run.all.length - 1].z - run.all[0].z; return span >= STL_SLICE.wallMm - 1e-9 && (!best || span > best.span) ? { run, span } : best; }, null);
  const reached = rings.filter(reach);
  const widest = reached.reduce(bigger);
  const outer = straight ? straight.run.all.reduce(kind === 'outside' ? bigger : smaller).loop : widest.loop;
  return { outer, slope, straight: !!straight, atTop: !straight && widest === rings[0], undercut };
}

/**
 * sliceStl(triangles, { up, unit, name }) -> { ok, payload, info } | { ok: false, message }
 *   payload  a `selection_data` payload (the add-in's contract: units mm, Y up, stock.thicknessMm = the part's height, regions, warnings) whose
 *            source is { kind: 'stl', name, documentName: the name without .stl }
 *   info     { sizeMm: { x, y, z }, triangles, sections, ms }
 */
export function sliceStl(tris, { up = STL_DEFAULTS.up, unit = STL_DEFAULTS.unit, name = 'part.stl' } = {}) {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const n = Math.floor((tris && tris.length) / 9);
  if (!n) return fail('This STL has no triangles.');
  const { P, zTop, zBot, sizeMm } = orientMesh(tris, { up, unit });
  const H = zTop - zBot;
  if (!(H > 1e-6) || !(sizeMm.x > 1e-6) || !(sizeMm.y > 1e-6)) return fail('This STL is flat: it has no height or no area seen from the chosen Up side.');
  const warnings = [];
  const warn = (w) => { if (!warnings.includes(w)) warnings.push(w); };

  // the planes: the top (just below it), every step, every flat face (just above it), the bottom (just above it)
  const flat = new Map(); // z -> [centroid x, y][] of the flat triangles there
  for (let t = 0; t < n; t++) {
    const o = 9 * t;
    if (P[o + 2] === P[o + 5] && P[o + 5] === P[o + 8]) {
      const z = P[o + 2];
      if (!flat.has(z)) flat.set(z, []);
      flat.get(z).push([(P[o] + P[o + 3] + P[o + 6]) / 3, (P[o + 1] + P[o + 4] + P[o + 7]) / 3]);
    }
  }
  const planes = [{ z: zTop, top: true }];
  const cand = [zBot, ...[...flat.keys()].filter((z) => z < zTop)];
  for (let k = 1; zTop - k * STL_SLICE.stepMm > zBot + 1e-9; k++) cand.push(zTop - k * STL_SLICE.stepMm);
  cand.sort((a, b) => b - a);
  for (const z of cand) {
    const prev = planes[planes.length - 1];
    if (prev.z - z < 1e-7) { if (flat.has(z) && !prev.top) prev.z = z; continue; } // a step that falls on a flat face: the face's own height
    planes.push({ z, top: false });
  }

  // sweep the triangles down through the planes
  const zmin = new Float64Array(n), zmax = new Float64Array(n);
  for (let t = 0; t < n; t++) { const o = 9 * t; zmin[t] = Math.min(P[o + 2], P[o + 5], P[o + 8]); zmax[t] = Math.max(P[o + 2], P[o + 5], P[o + 8]); }
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => zmax[b] - zmax[a]);
  let next = 0, active = [];
  let openPieces = 0;
  const levels = planes.map((pl) => {
    while (next < n && zmax[order[next]] >= pl.z) active.push(order[next++]);
    active = active.filter((t) => zmin[t] <= pl.z);
    const sec = buildSection(sectionSegments(P, active, pl.z, pl.top));
    openPieces += sec.open;
    return { z: pl.z, depth: zTop - pl.z, loops: sec.loops };
  });
  if (openPieces) warn(`${openPieces} section piece${openPieces === 1 ? '' : 's'} did not close (the mesh has holes): left out`);
  const depthOf = (k) => levels[k].depth;

  // a FLOOR between level k (just above it) and the next: a flat face at level k's height inside `above` and outside `below`
  const floorBetween = (k, above, below) => {
    const pts = flat.get(levels[k].z);
    return !!pts && pts.some((p) => inBox(p, above.bbox) && inPoly(p, above.pts) && !inPoly(p, below.pts));
  };
  // the lowest mesh point under a loop between level k and the next level down
  const lowestUnder = (k, L) => {
    const zHi = levels[k].z, zLo = k + 1 < levels.length ? levels[k + 1].z : zBot;
    let low = zHi;
    for (let i = 0; i < P.length; i += 3) {
      const z = P[i + 2];
      if (z < low && z >= zLo && z <= zHi) { const p = [P[i], P[i + 1]]; if (inBox(p, L.bbox) && inPoly(p, L.pts)) low = z; }
    }
    return zTop - low;
  };

  // the highest mesh point over a loop (within its box: a flat top's corners lie ON the loop) between level k and the level above: the top of a
  // chain that first shows at level k
  const topOver = (k, L) => {
    const zLo = levels[k].z, zHi = k > 0 ? levels[k - 1].z : zTop;
    let high = zLo;
    for (let i = 0; i < P.length; i += 3) { const z = P[i + 2]; if (z > high && z >= zLo && z <= zHi && inBox([P[i], P[i + 1]], L.bbox)) high = z; }
    return zTop - high;
  };
  const shoulderAt = (k, outer, raised) => {
    const pts = flat.get(levels[k].z);
    return !!pts && pts.some((p) => inBox(p, outer.bbox) && inPoly(p, outer.pts) && !raised.some((R) => inBox(p, R.bbox) && inPoly(p, R.pts)));
  };
  const lowTop = (c) => { const d = c.start > 0 ? topOver(c.start, c.rings[0].loop) : 0; return d > 1e-6 ? d : null; };

  const regions = [];
  const ringsOf = (c) => c.rings.map((r) => ({ z: depthOf(r.k), loop: r.loop }));

  // OUTLINES
  const { chains: outlines, shoulders } = trackOutlines(levels, { shoulderAt });
  const parts = outlines.filter((c) => c.through && c.rings.length);
  outlines.filter((c) => !c.through && !c.merged && !c.raised).forEach((c) => warn(`A part from ${fmtMm(depthOf(c.start))} to ${fmtMm(depthOf(c.end))} mm does not reach the bottom: not cut`));
  for (const c of outlines.filter((x) => x.raised || (x.through && !shoulders.some((s) => s.k + 1 === x.start)))) {
    const d = lowTop(c);
    if (d !== null) warn(`A raised part whose top is ${fmtMm(d)} mm down is left at full height`);
  }
  parts.sort((a, b) => a.rings[0].loop.bbox[0] - b.rings[0].loop.bbox[0] || a.rings[0].loop.bbox[1] - b.rings[0].loop.bbox[1]);
  parts.forEach((c, i) => {
    const label = parts.length === 1 ? 'Outline' : `Outline ${i + 1}`;
    const w = wallOf(ringsOf(c), 'outside', H);
    if (c.joinedAt != null) warn(`${label}: ${c.parts} separate raised parts above ${fmtMm(depthOf(c.joinedAt))} mm cannot be traced: cut straight there`);
    if (!w.straight && w.slope) warn(`${label}: sloped walls cut straight at the widest outline`);
    const under = [w.undercut, c.undercutAt != null ? depthOf(c.undercutAt) : null].filter((v) => v !== null);
    if (under.length) warn(`${label}: undercut below ${fmtMm(Math.min(...under))} mm cut straight`);
    regions.push({ label, cutType: 'outside', depthMm: r6(H), through: true, outer: { closed: true, segments: segmentsOf(w.outer) }, holes: [], ...(w.slope ? { slope: w.slope } : {}) });
  });

  // POCKETS and THROUGH HOLES
  const cavities = trackCavities(levels, floorBetween);
  // a hollow's top: the flat face right above its first section (its ceiling), else that section's depth
  const ceiling = (c) => depthOf(c.start > 0 && flat.has(levels[c.start - 1].z) ? c.start - 1 : c.start);
  for (const c of cavities.filter((x) => x.hollow)) {
    warn(c.through ? `A recess in the bottom (up to ${fmtMm(ceiling(c))} mm from the top) cannot be reached from the top: not cut`
      : `A hollow from ${fmtMm(ceiling(c))} to ${fmtMm(depthOf(c.end))} mm cannot be reached from the top: not cut`);
  }
  const open = cavities.filter((x) => !x.hollow);
  open.sort((a, b) => a.start - b.start || a.rings[0].loop.bbox[0] - b.rings[0].loop.bbox[0] || a.rings[0].loop.bbox[1] - b.rings[0].loop.bbox[1]);
  let nPocket = 0, nHole = 0;
  for (const c of open) {
    const last = lastLoop(c);
    const depth = c.through ? H : lowestUnder(c.end, last);
    const name = c.through ? `Through Hole ${++nHole}` : `Pocket ${++nPocket}`;
    const label = c.through ? name : `${name} (${fmtMm(depth)}mm)`;
    const kind = c.through ? 'inside' : 'pocket';
    const w = wallOf(ringsOf(c), kind, depth);
    if (!w.straight && w.slope && w.undercut !== 0) warn(w.atTop ? `${name}: drafted walls cut straight at the top opening` : `${name}: sloped walls cut straight at the widest opening`);
    if (w.undercut !== null) warn(`${name}: undercut below ${fmtMm(w.undercut)} mm cut straight`);
    const islands = c.through ? [] : last.children;
    const firstIsland = c.rings.find((r) => r.loop.children.length);
    if (firstIsland && firstIsland.k > c.start) warn(`${name}: an island whose top is ${fmtMm(depthOf(firstIsland.k))} mm down is left at full height`);
    regions.push({
      label, cutType: c.through ? 'inside' : 'pocket', depthMm: r6(depth), through: !!c.through,
      outer: { closed: true, segments: segmentsOf(w.outer) },
      holes: islands.map((I) => ({ closed: true, segments: segmentsOf(I) })),
      ...(w.slope ? { slope: w.slope } : {}),
    });
  }
  // SHOULDERS: the area around raised parts, down to the face they stand on (a pocket; the raised parts are its islands, cut straight at their base)
  for (const s of shoulders) {
    const depth = depthOf(s.k);
    const name = `Pocket ${++nPocket}`;
    if (s.raised.some((c) => wallOf(ringsOf(c), 'outside', depth).slope)) warn(`${name}: the sloped walls of a raised part are cut straight at its base`);
    regions.push({
      label: `${name} (${fmtMm(depth)}mm)`, cutType: 'pocket', depthMm: r6(depth), through: false,
      outer: { closed: true, segments: segmentsOf(s.outer) },
      holes: s.raised.map((c) => ({ closed: true, segments: segmentsOf(lastLoop(c)) })),
    });
  }
  if (!regions.length) return fail('Nothing to cut was found in this STL from the chosen Up side.');
  regions.forEach((r, i) => { r.id = `reg_${i}`; });

  const documentName = String(name).replace(/\.stl$/i, '') || 'part';
  const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return {
    ok: true,
    payload: {
      action: 'selection_data', version: 1, units: 'mm', coordSystem: { yAxis: 'up', frame: 'plane-2d' },
      source: { kind: 'stl', name: String(name), documentName },
      stock: { thicknessMm: r6(H) },
      regions: regions.map(({ id, ...r }) => ({ id, ...r })),
      chains: [],
      warnings,
    },
    info: { sizeMm: { x: r6(sizeMm.x), y: r6(sizeMm.y), z: r6(sizeMm.z) }, triangles: n, sections: levels.length, ms: Math.round(t1 - t0) },
  };
}
