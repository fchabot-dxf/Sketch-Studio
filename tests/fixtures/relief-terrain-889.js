// tests/fixtures/relief-terrain-889.js — TASK 889: the synthetic relief of the advisor's screenshot run (scratchpad make_relief_stl.py, ported line for line): a
// sculpted terrain on a 4 mm base, 120 x 80 mm, peaks to 23.5 mm, a 72 x 48 grid on top, watertight. Its RIDGE starts abruptly at x = 18 mm (the `u > 0.15`
// factor): a 5 mm step crossed in ONE grid cell (x 16.67 -> 18.33 mm), a near-vertical wall where every Contour level runs (task 889 bug 3).
// Returns the flat triangle list of tests/helpers/stl-mesh.js (binaryStl writes it; float32 as the Python's struct '<3f').
export const RELIEF_TERRAIN = Object.freeze({ nx: 72, ny: 48, w: 120, h: 80, base: 4, cliffX: 18 });

export function reliefTerrain() {
  const { nx: NX, ny: NY, w: W, h: H, base: BASE } = RELIEF_TERRAIN;
  const z = (x, y) => {
    const u = x / W, v = y / H;
    let h = 0;
    h += 14.0 * Math.exp(-((u - 0.30) ** 2 + (v - 0.55) ** 2) / 0.018); // main dome
    h += 9.0 * Math.exp(-((u - 0.72) ** 2 + (v - 0.35) ** 2) / 0.010); // second peak
    h += 3.0 * Math.sin(u * 14.0) * Math.cos(v * 9.0); // ripples
    h += 5.0 * Math.exp(-((v - 0.80 + 0.25 * u) ** 2) / 0.004) * (u > 0.15 ? 1 : 0); // ridge (cut off at u = 0.15: the cliff)
    h -= 4.0 * Math.exp(-((u - 0.55) ** 2 + (v - 0.70) ** 2) / 0.006); // bowl
    return BASE + Math.max(1.0, h + 6.0);
  };
  const pts = [];
  for (let i = 0; i <= NX; i++) { const col = []; for (let j = 0; j <= NY; j++) { const x = (i * W) / NX, y = (j * H) / NY; col.push([x, y, z(x, y)]); } pts.push(col); }
  const tris = [];
  const tri = (a, b, c) => tris.push(...a, ...b, ...c);
  const quad = (a, b, c, d) => { tri(a, b, c); tri(a, c, d); }; // counter-clockwise seen from outside
  const bot = (p) => [p[0], p[1], 0];
  for (let i = 0; i < NX; i++) for (let j = 0; j < NY; j++) {
    quad(pts[i][j], pts[i + 1][j], pts[i + 1][j + 1], pts[i][j + 1]); // top
    quad(bot(pts[i][j]), bot(pts[i][j + 1]), bot(pts[i + 1][j + 1]), bot(pts[i + 1][j])); // bottom
  }
  for (let i = 0; i < NX; i++) {
    let a = pts[i][0], c = pts[i + 1][0]; quad([a[0], 0, 0], [c[0], 0, 0], c, a); // y = 0 side
    a = pts[i][NY]; c = pts[i + 1][NY]; quad([c[0], H, 0], [a[0], H, 0], a, c); // y = H side
  }
  for (let j = 0; j < NY; j++) {
    let a = pts[0][j], c = pts[0][j + 1]; quad([0, c[1], 0], [0, a[1], 0], a, c); // x = 0 side
    a = pts[NX][j]; c = pts[NX][j + 1]; quad([W, a[1], 0], [W, c[1], 0], c, a); // x = W side
  }
  return tris;
}
