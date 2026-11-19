// packages/core/height-map.js — TASK 792 (owner turns 2484-2485, Vectric's 2D view of a relief): a part's HEIGHT MAP, the image Shaper's Prepare draws
// UNDER the cut lines of a part that carries depth information. PURE (no DOM): the same code in the page and in the node tests.
//
// ONE DERIVATION: the image is made from the part's LEVELS (its material sections by depth: the cut record's `levels`, #core/stepped-cut.js readLevels;
// an STL's are #core/stl-slice.js's sections), the same sections Roughing and Contour cut from, never from a second geometry. A pixel's height = the
// SHALLOWEST section whose material holds the pixel's centre (material = inside an odd number of a section's loops), drawn as a GREY: lighter = nearer
// the top, darker = deeper (from HEIGHT_MAP.greyTop at the top to HEIGHT_MAP.greyDeep, spread by the area each section shows); a pixel no
// section holds is transparent. Sections between two levels' depths are not interpolated: the map shows the part as the levels read it.
// ONE IMAGE per levels list, of a fixed resolution: HEIGHT_MAP.maxPx pixels along the part's longer side (the 90 x 121 mm rose: 0.2 mm a pixel), drawn
// stretched over the part's box: the browser smooths it when zoomed in. Not per zoom: the image is built once (memoised per levels list) and costs no
// work while panning / zooming.
// THE GREYS on Prepare's DARK canvas (--sk-prep-bg #3F4145, grey 63): the deepest section is grey 85 (a step above the canvas, so the part's footprint
// reads), the top grey 140 (dark enough that the white edge lines, the mint selection and the depth chips keep a contrast of about 3:1 or more on its
// lightest pixels).
// The image is a PNG (grey + alpha, 8 bits) written here (stored, uncompressed deflate blocks: no compression library), as a data: URL.

export const HEIGHT_MAP = Object.freeze({ maxPx: 600, greyTop: 140, greyDeep: 85 });

const MEMO = new WeakMap(); // levels list (never mutated) -> map

/**
 * levelsHeightMap(levels, { maxPx }) -> { x0, y0, width (mm), height (mm), cols, rows, px (mm a pixel), href (data:image/png), ms } | null — the height map of
 * a levels list ([{ z, loops: [flat [x0, y0, ...] world mm] }], shallow to deep), or null when it holds no material.
 */
export function levelsHeightMap(levels, { maxPx = HEIGHT_MAP.maxPx } = {}) {
  if (!Array.isArray(levels) || !levels.length) return null;
  const key = maxPx;
  let byKey = MEMO.get(levels);
  if (byKey && byKey.has(key)) return byKey.get(key);
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const lv of levels) for (const f of lv.loops) for (let i = 0; i + 1 < f.length; i += 2) {
    if (f[i] < minX) minX = f[i]; if (f[i] > maxX) maxX = f[i]; if (f[i + 1] < minY) minY = f[i + 1]; if (f[i + 1] > maxY) maxY = f[i + 1];
  }
  let out = null;
  if (Number.isFinite(minX) && maxX > minX && maxY > minY) {
    const px = Math.max(maxX - minX, maxY - minY) / maxPx;
    const cols = Math.max(1, Math.ceil((maxX - minX) / px)), rows = Math.max(1, Math.ceil((maxY - minY) / px));
    const level = new Int16Array(cols * rows).fill(-1); // the shallowest section holding each pixel
    const order = levels.map((lv, k) => k).sort((a, b) => levels[a].z - levels[b].z);
    const rowsX = Array.from({ length: rows }, () => []);
    for (const k of order) {
      for (const r of rowsX) r.length = 0;
      for (const f of levels[k].loops) { // every edge's crossings with the pixel-centre rows it spans
        const n = f.length / 2;
        for (let i = 0, j = n - 1; i < n; j = i++) {
          const xa = f[2 * j], ya = f[2 * j + 1], xb = f[2 * i], yb = f[2 * i + 1];
          if (ya === yb) continue;
          const lo = Math.min(ya, yb), hi = Math.max(ya, yb);
          const r0 = Math.max(0, Math.ceil((lo - minY) / px - 0.5)), r1 = Math.min(rows - 1, Math.ceil((hi - minY) / px - 0.5) - 1);
          for (let r = r0; r <= r1; r++) { const y = minY + (r + 0.5) * px; rowsX[r].push(xa + ((y - ya) * (xb - xa)) / (yb - ya)); }
        }
      }
      for (let r = 0; r < rows; r++) { // even-odd spans
        const xs = rowsX[r];
        if (xs.length < 2) continue;
        xs.sort((a, b) => a - b);
        for (let s = 0; s + 1 < xs.length; s += 2) {
          const c0 = Math.max(0, Math.ceil((xs[s] - minX) / px - 0.5)), c1 = Math.min(cols - 1, Math.ceil((xs[s + 1] - minX) / px - 0.5) - 1);
          for (let c = c0, o = r * cols + c0; c <= c1; c++, o++) if (level[o] < 0) level[o] = k;
        }
      }
    }
    // the greys are spread by AREA (histogram equalisation, still monotone: a deeper section is never lighter): a section's grey sits at the middle of
    // its share of the part's pixels, counted from the top. Linear in raw depth, the rose's 3 mm of relief on its 4 mm base (whose sloped wall leaves a
    // thin ring of pixels at every section) got a third of the range and read as one flat grey.
    const count = new Float64Array(levels.length);
    let total = 0;
    for (let i = 0; i < level.length; i++) if (level[i] >= 0) { count[level[i]]++; total++; }
    const grey = new Uint8Array(levels.length);
    let above = 0;
    for (const k of [...order]) { const mid = total ? (above + count[k] / 2) / total : 0; grey[k] = Math.round(HEIGHT_MAP.greyTop - (HEIGHT_MAP.greyTop - HEIGHT_MAP.greyDeep) * mid); above += count[k]; }
    const raw = new Uint8Array(rows * (1 + 2 * cols)); // PNG rows: filter byte 0, then grey + alpha per pixel
    let any = false;
    for (let r = 0, o = 0; r < rows; r++) {
      raw[o++] = 0;
      for (let c = 0; c < cols; c++) { const k = level[r * cols + c]; if (k >= 0) { raw[o] = grey[k]; raw[o + 1] = 255; any = true; } o += 2; }
    }
    if (any) {
      const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
      out = { x0: minX, y0: minY, width: cols * px, height: rows * px, cols, rows, px, href: 'data:image/png;base64,' + toBase64(pngGreyAlpha(cols, rows, raw)), ms: Math.round(t1 - t0) };
    }
  }
  if (!byKey) { byKey = new Map(); MEMO.set(levels, byKey); }
  byKey.set(key, out);
  return out;
}

// ═══ TASK 807 (owner turn 2640: "is there a reliable method to slice them"): a MESH's height map, the grid an STL relief's levels are read from ═════
// (#core/stl-slice.js sliceStl). Top-down machining sees a part as its height field: the highest surface over every point. Reading the levels from that
// field, instead of cutting the mesh with planes and chaining the cut segments end to end, makes them closed and clean BY CONSTRUCTION whatever the
// mesh's defects (duplicate points, gaps, slivers, faces inside the part, a face flat only to its float noise): no end point is matched anywhere.
// The Prepare picture above is drawn from the levels, so the picture and the levels come from this ONE grid.
//  * meshHeightGrid(P, { width, depth }): a Z-BUFFER from above: every triangle (x, y, z per point, the part placed with its lowest x / y at 0) is
//    rasterised onto NODES at the centres of square cells of MESH_GRID.cellMm (larger when the part would need more than MESH_GRID.maxCells nodes: the
//    cell grows to keep that count), each node keeping the HIGHEST z of the triangles over it (`h`; a node no triangle covers is EMPTY, -Infinity:
//    no part there), and, to tell what the top cannot see, the LOWEST (`lo`) and whether its vertical line crosses the mesh at a THIRD height
//    (`mid`: 1; heights within 1e-6 mm are one: a node on an edge two triangles share): a solid with nothing hidden is crossed twice, its top and
//    its back. One empty node all round (so every contour closes).
//  * gridContoursAt(grid, isos, { cliff }) / gridContours(grid, iso, { cliff }): the boundary of { nodes higher than iso } by MARCHING SQUARES, linear interpolation along the cell edges, but
//    HALF WAY on an edge to an empty node or one whose two heights differ by more than `cliff` (a wall steeper than cliff per cell: the grid cannot say
//    where in the cell such a wall stands, and interpolating would move a vertical wall by up to a cell from one level to the next); a saddle
//    cell is decided by its centre (the mean of its 4 nodes). Every crossed edge belongs to exactly two cells, so the pieces follow each other by EDGE NUMBER into closed loops; the material is on the left (Y up: an outer loop runs counter-clockwise, a hole
//    clockwise); loops never cross, so material = inside an odd number of them. Loops: [[x, y], ...] in mm, the first point not repeated at the end.
export const MESH_GRID = Object.freeze({ cellMm: 0.1, maxCells: 4000000 });

export function meshHeightGrid(P, { width, depth, cellMm = MESH_GRID.cellMm, maxCells = MESH_GRID.maxCells } = {}) {
  const c = Math.max(cellMm, Math.sqrt((width * depth) / maxCells));
  const nx = Math.max(1, Math.ceil(width / c)), ny = Math.max(1, Math.ceil(depth / c));
  const W = nx + 2, H = ny + 2; // + the empty node all round
  const h = new Float64Array(W * H).fill(-Infinity), lo = new Float64Array(W * H).fill(Infinity), mid = new Uint8Array(W * H), same = 1e-6;
  for (let o = 0; o + 8 < P.length; o += 9) { // node (i, j) sits at x = (i - 0.5) c, y = (j - 0.5) c
    const x0 = P[o], y0 = P[o + 1], z0 = P[o + 2], x1 = P[o + 3], y1 = P[o + 4], z1 = P[o + 5], x2 = P[o + 6], y2 = P[o + 7], z2 = P[o + 8];
    const a2 = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    if (Math.abs(a2) < 1e-12) continue; // seen edge-on from above: its neighbours cover its line
    const i0 = Math.max(1, Math.ceil(Math.min(x0, x1, x2) / c + 0.5)), i1 = Math.min(W - 2, Math.floor(Math.max(x0, x1, x2) / c + 0.5));
    const j0 = Math.max(1, Math.ceil(Math.min(y0, y1, y2) / c + 0.5)), j1 = Math.min(H - 2, Math.floor(Math.max(y0, y1, y2) / c + 0.5));
    const tol = -1e-9;
    for (let j = j0; j <= j1; j++) {
      const y = (j - 0.5) * c;
      for (let i = i0; i <= i1; i++) {
        const x = (i - 0.5) * c;
        const l1 = ((x - x0) * (y2 - y0) - (x2 - x0) * (y - y0)) / a2, l2 = ((x1 - x0) * (y - y0) - (x - x0) * (y1 - y0)) / a2;
        if (l1 < tol || l2 < tol || 1 - l1 - l2 < tol) continue; // the node is not under the triangle (its edges count: shared, never missed)
        const z = z0 + l1 * (z1 - z0) + l2 * (z2 - z0), k = j * W + i;
        if (h[k] === -Infinity) { h[k] = z; lo[k] = z; continue; }
        if (z > h[k] + same) { if (h[k] > lo[k] + same) mid[k] = 1; h[k] = z; }
        else if (z < lo[k] - same) { if (h[k] > lo[k] + same) mid[k] = 1; lo[k] = z; }
        else if (z > lo[k] + same && z < h[k] - same) mid[k] = 1;
      }
    }
  }
  return { cell: c, W, H, cols: nx, rows: ny, h, lo, mid };
}

// The loops of one level from the cells its contour crosses (`cells`: their numbers, any order): see gridContoursAt.
function contoursOfCells(grid, iso, cells, count, cliff) {
  const { W, h, cell: c } = grid;
  const next = new Map(); // a crossed edge -> the edge its piece goes on to (in the cell on its left)
  // edge numbers: 2 (j W + i) = from node (i, j) to (i + 1, j); 2 (j W + i) + 1 = from (i, j) to (i, j + 1)
  const ins = [false, false, false, false], crossed = [0, 0, 0, 0], exits = [false, false, false, false];
  for (let q = 0; q < count; q++) {
    const k = cells[q];
    const vbl = h[k], vbr = h[k + 1], vtr = h[k + W + 1], vtl = h[k + W];
    ins[0] = vbl > iso; ins[1] = vbr > iso; ins[2] = vtr > iso; ins[3] = vtl > iso;
    // the cell's edges counter-clockwise: bottom (bl -> br), right (br -> tr), top (tr -> tl), left (tl -> bl); leaving the material = an exit
    const edges = [2 * k, 2 * (k + 1) + 1, 2 * (k + W), 2 * k + 1];
    let n = 0;
    for (let e = 0; e < 4; e++) { const a = ins[e]; if (a !== ins[(e + 1) % 4]) { crossed[n] = edges[e]; exits[n] = a; n++; } }
    if (n === 2) { if (exits[0]) next.set(crossed[0], crossed[1]); else next.set(crossed[1], crossed[0]); continue; }
    if (n !== 4) continue;
    const joined = (vbl + vbr + vtr + vtl) / 4 > iso; // a saddle: its two material corners meet through the centre, or not
    for (let p = 0; p < 4; p++) if (exits[p]) next.set(crossed[p], crossed[joined ? (p + 1) % 4 : (p + 3) % 4]);
  }
  const point = (e) => {
    const k = e >> 1, i = k % W, j = (k - i) / W, k2 = e & 1 ? k + W : k + 1;
    const ha = h[k], hb = h[k2];
    const t = ha === -Infinity || hb === -Infinity || Math.abs(hb - ha) > cliff ? 0.5 : (iso - ha) / (hb - ha);
    return e & 1 ? [(i - 0.5) * c, (j - 0.5 + t) * c] : [(i - 0.5 + t) * c, (j - 0.5) * c];
  };
  const loops = [];
  for (const start of next.keys()) {
    if (!next.has(start)) continue;
    const pts = [];
    for (let e = start; next.has(e);) { pts.push(point(e)); const f = next.get(e); next.delete(e); e = f; }
    if (pts.length >= 3) loops.push(pts);
  }
  return loops;
}

/** gridContoursAt(grid, isos, { cliff }) -> one loops list per iso (header). The cells each level crosses are found ONCE for all the levels (a cell
 *  between its lowest and highest node is crossed by the levels in between: two binary searches in the sorted isos), so the work follows the contours'
 *  length, not the grid's size times the number of levels (a 482 mm tall part sliced every 0.25 mm: 1930 levels). */
export function gridContoursAt(grid, isos, { cliff = Infinity } = {}) {
  const { W, H, h } = grid;
  const L = isos.length, order = isos.map((v, k) => k).sort((a, b) => isos[a] - isos[b]), sorted = order.map((k) => isos[k]);
  const first = (v) => { let a = 0, b = L; while (a < b) { const m = (a + b) >> 1; if (sorted[m] < v) a = m + 1; else b = m; } return a; }; // the first iso >= v
  const span = (k) => { // the sorted levels [a, b) crossing cell k: min <= iso < max
    const v0 = h[k], v1 = h[k + 1], v2 = h[k + W + 1], v3 = h[k + W];
    const mx = Math.max(v0, v1, v2, v3);
    if (mx === -Infinity) return 0;
    const a = first(Math.min(v0, v1, v2, v3)), b = first(mx);
    return a < b ? a * (L + 1) + b : 0;
  };
  const cellsN = (W - 1) * (H - 1), count = new Int32Array(L + 1);
  const spans = new Int32Array(cellsN); // a * (L + 1) + b, or 0
  for (let j = 0, q = 0; j + 1 < H; j++) for (let i = 0; i + 1 < W; i++, q++) { const s = span(j * W + i); spans[q] = s; if (s) { const a = (s / (L + 1)) | 0, b = s % (L + 1); count[a]++; count[b]--; } }
  const per = new Int32Array(L); let run = 0;
  for (let t = 0; t < L; t++) { run += count[t]; per[t] = run; }
  const lists = Array.from({ length: L }, (_, t) => new Int32Array(per[t])), fill = new Int32Array(L);
  for (let j = 0, q = 0; j + 1 < H; j++) for (let i = 0; i + 1 < W; i++, q++) {
    const s = spans[q];
    if (!s) continue;
    const a = (s / (L + 1)) | 0, b = s % (L + 1), k = j * W + i;
    for (let t = a; t < b; t++) lists[t][fill[t]++] = k;
  }
  const out = new Array(L);
  for (let t = 0; t < L; t++) out[order[t]] = contoursOfCells(grid, sorted[t], lists[t], per[t], cliff);
  return out;
}
/** gridContours(grid, iso, { cliff }) -> the loops of one level (gridContoursAt for one iso). */
export const gridContours = (grid, iso, opts = {}) => gridContoursAt(grid, [iso], opts)[0];

// ── a minimal PNG writer: colour type 4 (grey + alpha), 8 bits, the image data in STORED deflate blocks (zlib, no compression) ──
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(bytes, start, end) { let c = 0xffffffff; for (let i = start; i < end; i++) c = CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function pngGreyAlpha(w, h, raw) {
  const blocks = Math.max(1, Math.ceil(raw.length / 65535));
  const zlen = 2 + raw.length + 5 * blocks + 4;
  const z = new Uint8Array(zlen);
  let o = 0;
  z[o++] = 0x78; z[o++] = 0x01;
  for (let b = 0; b < blocks; b++) {
    const s = b * 65535, n = Math.min(65535, raw.length - s);
    z[o++] = b === blocks - 1 ? 1 : 0; z[o++] = n & 0xff; z[o++] = n >>> 8; z[o++] = ~n & 0xff; z[o++] = (~n >>> 8) & 0xff;
    z.set(raw.subarray(s, s + n), o); o += n;
  }
  let a = 1, bsum = 0; for (let i = 0; i < raw.length; i++) { a = (a + raw[i]) % 65521; bsum = (bsum + a) % 65521; }
  const ad = ((bsum << 16) | a) >>> 0; z[o++] = ad >>> 24; z[o++] = (ad >>> 16) & 0xff; z[o++] = (ad >>> 8) & 0xff; z[o++] = ad & 0xff;
  const chunk = (type, data) => { const c = new Uint8Array(12 + data.length); const dv = new DataView(c.buffer); dv.setUint32(0, data.length); for (let i = 0; i < 4; i++) c[4 + i] = type.charCodeAt(i); c.set(data, 8); dv.setUint32(8 + data.length, crc32(c, 4, 8 + data.length)); return c; };
  const ihdr = new Uint8Array(13); const dv = new DataView(ihdr.buffer); dv.setUint32(0, w); dv.setUint32(4, h); ihdr[8] = 8; ihdr[9] = 4; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const parts = [Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', z), chunk('IEND', new Uint8Array(0))];
  const png = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let q = 0; for (const p of parts) { png.set(p, q); q += p.length; }
  return png;
}
function toBase64(bytes) { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); }
