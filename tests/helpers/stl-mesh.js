// tests/helpers/stl-mesh.js — TASK 790: closed triangle meshes BUILT IN THE TEST (no binary fixtures), written as binary or ASCII STL, for the
// STL slicer's tests (#core/stl-slice.js) and the live Open STL test.
//
//   lofted({ outer, cavities, apex }) -> Float32Array (9 per triangle)
//     outer     the part's outside: rings top -> bottom, [{ z, pts: [[x,y],...] }] (every ring the same point count, the walls join ring i to i+1)
//     cavities  [{ rings: [{ z, pts }...] top -> bottom, through }]: a pocket (its last ring is its floor) or a through hole (its last ring is at the bottom)
//     apex      [x, y, z]: the outside closes in a point at the top (a dome) instead of a flat top face
//   The flat faces (top with the cavities' openings, pocket floors, bottom with the through holes) are triangulated by the app's own vendored earcut.
//   rect(x0, y0, x1, y1), circle(cx, cy, r, n): ring point lists (counter-clockwise).
//   binaryStl(tris) -> Buffer, asciiStl(tris, name) -> string; transformMesh(tris, fn(x, y, z) -> [x, y, z]).
import earcut from '../../packages/core/plot/vendor/earcut.js';

export const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
export const circle = (cx, cy, r, n = 48) => Array.from({ length: n }, (_, i) => [cx + r * Math.cos((2 * Math.PI * i) / n), cy + r * Math.sin((2 * Math.PI * i) / n)]);

export function lofted({ outer, cavities = [], apex = null }) {
  const out = [];
  const tri = (a, b, c) => out.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  const at = (p, z) => [p[0], p[1], z];
  const walls = (rings) => {
    for (let i = 0; i + 1 < rings.length; i++) {
      const A = rings[i], B = rings[i + 1];
      if (A.pts.length !== B.pts.length) throw new Error('lofted: rings of different point counts');
      const n = A.pts.length;
      for (let j = 0; j < n; j++) {
        const a0 = at(A.pts[j], A.z), a1 = at(A.pts[(j + 1) % n], A.z), b0 = at(B.pts[j], B.z), b1 = at(B.pts[(j + 1) % n], B.z);
        tri(a0, b0, b1); tri(a0, b1, a1);
      }
    }
  };
  const cap = (ring, holes, z) => {
    const flat = [], holeIdx = [];
    for (const p of ring) flat.push(p[0], p[1]);
    for (const h of holes) { holeIdx.push(flat.length / 2); for (const p of h) flat.push(p[0], p[1]); }
    const all = [...ring, ...holes.flat()];
    const t = earcut(flat, holeIdx);
    for (let k = 0; k < t.length; k += 3) tri(at(all[t[k]], z), at(all[t[k + 1]], z), at(all[t[k + 2]], z));
  };
  walls(outer);
  for (const c of cavities) walls(c.rings);
  const top = outer[0], bottom = outer[outer.length - 1];
  if (apex) { const n = top.pts.length; for (let j = 0; j < n; j++) tri(apex, at(top.pts[j], top.z), at(top.pts[(j + 1) % n], top.z)); }
  else cap(top.pts, cavities.map((c) => c.rings[0].pts), top.z);
  for (const c of cavities) if (!c.through) cap(c.rings[c.rings.length - 1].pts, [], c.rings[c.rings.length - 1].z);
  cap(bottom.pts, cavities.filter((c) => c.through).map((c) => c.rings[c.rings.length - 1].pts), bottom.z);
  return new Float32Array(out);
}

export function transformMesh(tris, fn) {
  const out = new Float32Array(tris.length);
  for (let i = 0; i < tris.length; i += 3) { const [x, y, z] = fn(tris[i], tris[i + 1], tris[i + 2]); out[i] = x; out[i + 1] = y; out[i + 2] = z; }
  return out;
}

export function binaryStl(tris, header = 'binary STL built by the TASK 790 test') {
  const n = tris.length / 9;
  const buf = Buffer.alloc(84 + 50 * n);
  buf.write(header.slice(0, 80), 0, 'latin1');
  buf.writeUInt32LE(n, 80);
  for (let i = 0; i < n; i++) {
    const off = 84 + 50 * i;
    for (let k = 0; k < 9; k++) buf.writeFloatLE(tris[9 * i + k], off + 12 + 4 * k);
  }
  return buf;
}

export function asciiStl(tris, name = 'part') {
  const lines = [`solid ${name}`];
  const f = (v) => Number(v).toPrecision(9);
  for (let i = 0; i < tris.length; i += 9) {
    lines.push('  facet normal 0 0 0', '    outer loop');
    for (let k = 0; k < 9; k += 3) lines.push(`      vertex ${f(tris[i + k])} ${f(tris[i + k + 1])} ${f(tris[i + k + 2])}`);
    lines.push('    endloop', '  endfacet');
  }
  lines.push(`endsolid ${name}`);
  return lines.join('\n') + '\n';
}

// ── the parts the TASK 790 tests slice ──
const TAN10 = Math.tan((10 * Math.PI) / 180);
/** A 120 x 80 x 19 block (z 0..19) with a 60 x 40 x 8 VERTICAL pocket at (30..90, 20..60) and a d12 through hole at (100, 40). */
export const blockPocketHole = () => lofted({
  outer: [{ z: 19, pts: rect(0, 0, 120, 80) }, { z: 0, pts: rect(0, 0, 120, 80) }],
  cavities: [
    { rings: [{ z: 19, pts: rect(30, 20, 90, 60) }, { z: 11, pts: rect(30, 20, 90, 60) }] },
    { rings: [{ z: 19, pts: circle(100, 40, 6, 48) }, { z: 0, pts: circle(100, 40, 6, 48) }], through: true },
  ],
});
/** The same block with the 60 x 40 x 8 pocket's walls drafted `deg` degrees (the top opening 60 x 40), as tests/fixtures/sa7-slope/02-drafted-pocket.json. */
export const draftedPocket = (deg = 10) => {
  const t = Math.tan((deg * Math.PI) / 180) * 8;
  return lofted({
    outer: [{ z: 19, pts: rect(0, 0, 120, 80) }, { z: 0, pts: rect(0, 0, 120, 80) }],
    cavities: [{ rings: [{ z: 19, pts: rect(30, 20, 90, 60) }, { z: 11, pts: rect(30 + t, 20 + t, 90 - t, 60 - t) }] }],
  });
};
export { TAN10 };
/** A hemisphere dome of radius R standing on its flat base (z 0..R), `lat` latitude bands, `lon` sides. */
export function dome(R = 30, lat = 24, lon = 64, cx = R, cy = R) {
  const outer = [];
  for (let i = 1; i <= lat; i++) {
    const a = (Math.PI / 2) * (i / lat); // from the apex down to the equator
    outer.push({ z: R * Math.cos(a), pts: circle(cx, cy, R * Math.sin(a), lon) });
  }
  return lofted({ outer, apex: [cx, cy, R] });
}
/** A 100 x 60 x 15 block with a DOVETAIL pocket: 40 x 20 at the top, 50 x 30 at its 6 mm floor (an undercut). */
export const dovetailPocket = () => lofted({
  outer: [{ z: 15, pts: rect(0, 0, 100, 60) }, { z: 0, pts: rect(0, 0, 100, 60) }],
  cavities: [{ rings: [{ z: 15, pts: rect(30, 20, 70, 40) }, { z: 9, pts: rect(25, 15, 75, 45) }] }],
});
