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
