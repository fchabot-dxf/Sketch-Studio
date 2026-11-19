// tests/helpers/pocket-shapes-804.js — TASK 804: the pocket shapes the no-crossing rule is checked over (base mm, closed [[x, y], ...] rings, the
// closing point repeated, as #core/pocket-clearing pocketRings gives them): { name: { outer, holes, bit, allowance, chains } } where `chains` = the expected
// number of ring chains (one closed Loop per chain: the owner's list, task 804).
const close = (pts) => [...pts, pts[0]];
const poly = (n, f) => close(Array.from({ length: n }, (_, i) => f((i / n) * Math.PI * 2)));
const IN = 25.4;
export const BIT_MM = 6;
export const ALLOW_MM = 0.5;
export const SHAPES_804 = {
  square: { outer: close([[0, 0], [80, 0], [80, 80], [0, 80]]), chains: 1 },
  circle: { outer: poly(128, (t) => [50 + 30 * Math.cos(t), 50 + 30 * Math.sin(t)]), chains: 1 },
  L: { outer: close([[0, 0], [100, 0], [100, 40], [40, 40], [40, 100], [0, 100]]), chains: 1 },
  U: { outer: close([[0, 0], [100, 0], [100, 90], [70, 90], [70, 30], [30, 30], [30, 90], [0, 90]]), chains: 1 },
  star: { outer: poly(10, (t) => { const r = Math.round(t / (Math.PI / 5)) % 2 ? 22 : 50; return [60 + r * Math.sin(t), 60 - r * Math.cos(t)]; }), chains: 1 },
  blob: { outer: poly(96, (t) => { const r = 40 + 8 * Math.sin(3 * t) + 5 * Math.cos(5 * t); return [60 + r * Math.cos(t), 60 + r * Math.sin(t)]; }), chains: 1 },
  island: { outer: close([[0, 0], [100, 0], [100, 60], [0, 60]]), holes: [close([[40, 20], [60, 20], [60, 40], [40, 40]])], chains: 1 },
  // the owner's triangle bow-tie (images/126.png): two triangles meeting at a neck, inches, a 0.125 in bit
  bowtie: { outer: close([[0, 0], [3.2, 1.55], [6.4, 0], [6.4, 4.2], [3.2, 2.65], [0, 4.2]].map(([x, y]) => [x * IN, y * IN])), bit: 0.125 * IN, allowance: 0.02 * IN, chains: 2 },
  dumbbell: { outer: close([[0, 0], [40, 0], [40, 14], [60, 14], [60, 0], [100, 0], [100, 40], [60, 40], [60, 26], [40, 26], [40, 40], [0, 40]]), chains: 2 },
  // an S with two necks: three rooms joined by two necks (each 16 mm, wider than the bit)
  S: { outer: close([[0, 0], [50, 0], [50, 40], [33, 40], [33, 60], [100, 60], [100, 100], [83, 100], [83, 120], [100, 120], [100, 160], [50, 160], [50, 120], [67, 120], [67, 100], [0, 100], [0, 60], [17, 60], [17, 40], [0, 40]]), chains: 3 },
};
