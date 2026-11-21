// tests/helpers/wave-relief.js — TASK 801: a generated RELIEF for the Export simulation's measures (never an owner's STL): a closed height field, a smooth wave
// surface z = base + amp * (0.5 + 0.25 sin(2 pi x / wx) + 0.25 cos(2 pi y / wy)) over a size x size mm square, n x n cells (2 n^2 top triangles), its four sides down
// to z = 0 and a bottom fan from its centre. waveRelief({ n: 320 }) is ~205 000 triangles. Written as binary STL by tests/helpers/stl-mesh.js binaryStl.
export function waveRelief({ n = 320, size = 120, base = 4, amp = 12, wx = 60, wy = 45 } = {}) {
  const h = (x, y) => base + amp * (0.5 + 0.25 * Math.sin((2 * Math.PI * x) / wx) + 0.25 * Math.cos((2 * Math.PI * y) / wy));
  const step = size / n, P = (i, j) => [i * step, j * step, h(i * step, j * step)];
  const out = [];
  const tri = (a, b, c) => out.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { // the top, facing up (counter-clockwise seen from above)
    const a = P(i, j), b = P(i + 1, j), c = P(i + 1, j + 1), d = P(i, j + 1);
    tri(a, b, c); tri(a, c, d);
  }
  const ring = []; // the boundary, counter-clockwise seen from above
  for (let i = 0; i < n; i++) ring.push([i, 0]);
  for (let j = 0; j < n; j++) ring.push([n, j]);
  for (let i = n; i > 0; i--) ring.push([i, n]);
  for (let j = n; j > 0; j--) ring.push([0, j]);
  const centre = [size / 2, size / 2, 0];
  ring.forEach(([i, j], k) => {
    const [i2, j2] = ring[(k + 1) % ring.length];
    const a = P(i, j), b = P(i2, j2), a0 = [a[0], a[1], 0], b0 = [b[0], b[1], 0];
    tri(a0, b0, b); tri(a0, b, a); // the side, facing out
    tri(centre, b0, a0); // the bottom, facing down
  });
  return new Float32Array(out);
}
