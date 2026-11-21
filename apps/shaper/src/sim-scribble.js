// apps/shaper/src/sim-scribble.js — TASK 801d (owner turn 3179: "I'd want a faked free-motion sweep that's obviously freehand"): the Export SIMULATION's example of the
// hand moves inside a FREEHAND pocket (the Origin's own Pocket: the user clears its inside by hand, then the wall pass). It is an EXAMPLE, made for the simulation only:
// cut-timeline.js plays it before the pocket's wall pass and the label says so; it is never in the exported file, in Prepare, in the derivation or in the generated paths
// (op-derive.js / op-paths.js never import this module).
// The scribble is made once from the pocket's BIT-CENTRE region (its wall's bit-centre path minus its islands' bit-centre paths: where the bit's centre may go, the
// travel Prepare and the Paths view draw), so the bit never leaves where it may go: a few PATCHES (by area), each a wobbly, uneven zigzag of passes in its own direction
// (some along, some across, each tilted a little), the patches overlapping a little. DETERMINISTIC: every random choice comes from a generator seeded by the region itself
// (seedOf), so the same pocket plays the same scribble every time. Its passes are close enough (SCRIBBLE.spacing x the bit diameter, the spacing varied by at most
// SCRIBBLE.jitter) that the bit's footprint covers the region.
import { clipOpenPaths, regionsFromRings, intersectRegions, offsetRegions, regionsArea } from '#core/plot/clip.js';

/** The scribble's parameters, declared once (lengths are x the bit diameter). */
export const SCRIBBLE = Object.freeze({
  spacing: 0.7,      // the distance between two passes
  jitter: 0.2,       // each pass's distance from the one before varies by up to this share (uneven)
  wobble: 0.14,      // the hand's wobble: the largest sideways wander of a pass
  wobbleWave: 2.2,   // the wobble's wavelength
  sample: 0.3,       // a pass's points, this far apart
  tilt: 14,          // degrees: a patch's passes are turned by up to this from along / across
  patchSide: 7,      // one patch per (patchSide x the diameter)^2 of the region's area
  maxPatches: 5,
  overlap: 0.6,      // neighbouring patches overlap by this x the spacing
  join: 2.5,         // a turn to the next pass longer than this x the spacing is a new stroke (the hand moves over)
  inset: 0.01,       // mm: the scribble keeps this far inside the bit-centre region (Clipper's grid is 0.001 mm)
  words: 'freehand: your own moves, shown as an example', // what the label says while it plays
});

// a 32-bit seeded generator (mulberry32) and the seed of a region (FNV-1a of its points at 0.001 mm)
function generator(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
export function seedOf(rings) {
  let h = 2166136261;
  for (const ring of rings) for (const p of ring) for (const v of [Math.round(p.x * 1000), Math.round(p.y * 1000)]) { h ^= v & 0xffff; h = Math.imul(h, 16777619); h ^= v >>> 16; h = Math.imul(h, 16777619); }
  return h >>> 0;
}
const ringIn = (ring, x, y) => { let inside = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const a = ring[i], b = ring[j]; if ((a[1] > y) !== (b[1] > y) && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside; } return inside; };
/** Whether (x, y) is inside the regions ([{ outer, holes }], [[x, y]] rings). */
export const inRegions = (regions, x, y) => regions.some((r) => ringIn(r.outer, x, y) && !r.holes.some((h) => ringIn(h, x, y)));

/**
 * scribble({ outer, holes, dia, margin }) -> { passes: [{ points: [{ x, y }], stroke }], region } — the example hand moves in the bit-centre region `outer` minus `holes`
 * ({x, y} rings: the pocket's wall and island travel paths) for a bit of diameter `dia`, kept `margin` mm further in (the Origin's clearing keeps its automatic
 * offset + the cut's offset from the wall: what the hand clears is what the 3D removes for the pocket, so the scribble never carves more than the finished pocket). `passes` in play order; a pass starts where the one before ended unless it
 * begins a new `stroke`. `region` = the regions the scribble keeps inside (the tests read it). Empty when the region or the bit is nothing.
 */
export function scribble({ outer, holes = [], dia, margin = 0 }) {
  const s = SCRIBBLE.spacing * dia;
  if (!(s > 0) || !outer || outer.length < 3) return { passes: [], region: [] };
  const toRing = (r) => r.map((p) => [p.x, p.y]);
  const region = offsetRegions(regionsFromRings([toRing(outer), ...holes.map(toRing)], 'evenodd'), -(Math.max(0, margin) + SCRIBBLE.inset));
  if (!region.length) return { passes: [], region };
  const rnd = generator(seedOf([outer, ...holes]));
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of outer) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
  const along = maxX - minX >= maxY - minY; // the patches follow the region's longer side
  const n = Math.max(1, Math.min(SCRIBBLE.maxPatches, Math.round(regionsArea(region) / (SCRIBBLE.patchSide * dia) ** 2)));
  const L0 = along ? minX : minY, L = (along ? maxX : maxY) - L0, ov = SCRIBBLE.overlap * s;
  const first = rnd() < 0.5 ? 0 : 1; // the first patch along or across; the next ones alternate
  const passes = [];
  let stroke = -1;
  for (let k = 0; k < n; k++) {
    const a = L0 + (L * k) / n - (k ? ov : 0), b = L0 + (L * (k + 1)) / n + (k < n - 1 ? ov : 0);
    const box = along ? [[a, minY], [b, minY], [b, maxY], [a, maxY]] : [[minX, a], [maxX, a], [maxX, b], [minX, b]];
    const patch = intersectRegions(region, regionsFromRings([box]));
    if (!patch.length) continue;
    const across = (k + first) % 2 === 1;
    const angle = ((across ? 90 : 0) + (rnd() * 2 - 1) * SCRIBBLE.tilt) * (Math.PI / 180);
    const d = [Math.cos(angle), Math.sin(angle)], nrm = [-d[1], d[0]]; // the passes run along d, one after the other along nrm
    const proj = (p, v) => p[0] * v[0] + p[1] * v[1];
    const pts = patch.flatMap((r) => r.outer);
    const lo = Math.min(...pts.map((p) => proj(p, nrm))), hi = Math.max(...pts.map((p) => proj(p, nrm)));
    const dLo = Math.min(...pts.map((p) => proj(p, d))) - s, dHi = Math.max(...pts.map((p) => proj(p, d))) + s;
    const offsets = [];
    for (let c = lo + s * (0.3 + 0.2 * rnd()); c < hi; c += s * (1 + (rnd() * 2 - 1) * SCRIBBLE.jitter)) offsets.push(c);
    if (!offsets.length || hi - offsets[offsets.length - 1] > 0.8 * s) offsets.push(hi - s * 0.35); // the last pass close to the far side
    let lastEnd = null;
    offsets.forEach((c, j) => {
      const P = (t) => [nrm[0] * c + d[0] * t, nrm[1] * c + d[1] * t];
      const pieces = clipOpenPaths([[P(dLo), P(dHi)]], patch).map((pc) => (proj(pc[0], d) <= proj(pc[pc.length - 1], d) ? pc : pc.slice().reverse()))
        .sort((u, v) => proj(u[0], d) - proj(v[0], d));
      const ordered = j % 2 ? pieces.reverse().map((pc) => pc.slice().reverse()) : pieces; // a zigzag: every other pass comes back
      for (const pc of ordered) {
        const start = pc[0];
        const turn = lastEnd && Math.hypot(start[0] - lastEnd[0], start[1] - lastEnd[1]);
        const joined = lastEnd && turn <= SCRIBBLE.join * s && insideSegment(region, lastEnd, start);
        if (!joined) stroke++;
        const amp = SCRIBBLE.wobble * dia * (0.5 + 0.5 * rnd()), wave = SCRIBBLE.wobbleWave * dia * (0.7 + 0.6 * rnd()), ph = [rnd() * 6.283, rnd() * 6.283];
        const line = wobbly(region, pc, nrm, dia, amp, wave, ph);
        passes.push({ points: (joined ? [{ x: lastEnd[0], y: lastEnd[1] }] : []).concat(line), stroke });
        lastEnd = pc[pc.length - 1];
      }
    });
  }
  return { passes, region };
}
// whether the straight move a -> b stays inside the regions (one piece, as long as the move)
function insideSegment(regions, a, b) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (L < 1e-9) return true;
  const got = clipOpenPaths([[a, b]], regions);
  return got.length === 1 && Math.abs(got[0].reduce((t, p, i) => (i ? t + Math.hypot(p[0] - got[0][i - 1][0], p[1] - got[0][i - 1][1]) : 0), 0) - L) < 0.01;
}
// a straight piece made a hand's line: points every SCRIBBLE.sample x dia, each moved sideways by a smooth seeded wander (two waves); the ends stay where they are (the
// turns join), and a point the wander would carry out of the region stays on the straight piece (which is inside)
function wobbly(regions, pc, nrm, dia, amp, wave, ph) {
  const [a, b] = [pc[0], pc[pc.length - 1]], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const m = Math.max(1, Math.ceil(L / (SCRIBBLE.sample * dia)));
  const out = [];
  for (let i = 0; i <= m; i++) {
    const u = (L * i) / m, x0 = a[0] + (b[0] - a[0]) * (i / m), y0 = a[1] + (b[1] - a[1]) * (i / m);
    const w = i === 0 || i === m ? 0 : amp * (0.65 * Math.sin((2 * Math.PI * u) / wave + ph[0]) + 0.35 * Math.sin((2 * Math.PI * u) / (0.37 * wave) + ph[1]));
    const x = x0 + nrm[0] * w, y = y0 + nrm[1] * w;
    out.push(inRegions(regions, x, y) ? { x, y } : { x: x0, y: y0 });
  }
  return out;
}
