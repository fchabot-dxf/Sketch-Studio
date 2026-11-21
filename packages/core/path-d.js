// packages/core/path-d.js — TASK 786: the ONE reader of the SVG path data #core WRITES (absolute `M x y`, `L x y`, `A r r 0 large sweep x y`,
// `C x1 y1 x2 y2 x y`, `Z`: #core/loop-geometry, #core/curve-kinds, #core/stepped-cut, #core/hold-part, #core/pocket-clearing).
// PURE (no DOM). Two measures of a written path, exact (no sampling):
//   pathSignedArea(d) — the signed area its closed sub-paths enclose (shoelace sign, world y down: > 0 = the angle INCREASES along the walk,
//                       an SVG arc with sweep 1). An arc adds its chord + its circular segment; a cubic its exact Green's-theorem integral.
//   pathBounds(d)     — { minX, minY, maxX, maxY } of every point the path draws: line ends, an arc's ends + each axis extreme inside its sweep,
//                       a cubic's ends + each axis extreme inside (0, 1) (the roots of its derivative), NOT its control points.
// Any other command (relative, H / V / Q / S, an elliptical or rotated arc) is not written by #core and throws (never read silently wrong).

const NUM = /^-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i;

/** d → [{ start: {x,y}, segs: [{ c: 'L' | 'A' | 'C', from, to, ... }], closed }] — every sub-path of an absolute M / L / A / C / Z path. */
export function pathSubpaths(d) {
  const t = String(d || '').trim().split(/\s+/).filter(Boolean); // #core writes every command letter and number as its own token
  const subs = [];
  let i = 0, cmd = '', cur = null, pt = null;
  const n = () => {
    const tok = t[i++];
    if (tok === undefined || !NUM.test(tok)) throw new Error(`path-d: a number expected after ${cmd}, got ${tok} in "${d}"`);
    return Number(tok);
  };
  while (i < t.length) {
    if (/^[A-Za-z]$/.test(t[i])) {
      cmd = t[i++];
      if (cmd === 'Z') { if (!cur) throw new Error(`path-d: Z without a sub-path in "${d}"`); cur.closed = true; pt = cur.start; cur = null; continue; }
      if (!'MLAC'.includes(cmd)) throw new Error(`path-d: command ${cmd} is not one #core writes ("${d}")`);
      continue;
    }
    if (cmd === 'M') { pt = { x: n(), y: n() }; cur = { start: pt, segs: [], closed: false }; subs.push(cur); cmd = 'L'; continue; }
    if (!cur) throw new Error(`path-d: ${cmd} without a sub-path in "${d}"`);
    if (cmd === 'L') { const to = { x: n(), y: n() }; cur.segs.push({ c: 'L', from: pt, to }); pt = to; continue; }
    if (cmd === 'A') {
      const rx = n(), ry = n(), rot = n(), large = n(), sweep = n(), to = { x: n(), y: n() };
      if (rx !== ry || rot !== 0) throw new Error(`path-d: only circular, unrotated arcs are written by #core ("${d}")`);
      cur.segs.push({ c: 'A', from: pt, to, r: rx, large: large === 1, sweep: sweep === 1 }); pt = to; continue;
    }
    if (cmd === 'C') { const c1 = { x: n(), y: n() }, c2 = { x: n(), y: n() }, to = { x: n(), y: n() }; cur.segs.push({ c: 'C', from: pt, c1, c2, to }); pt = to; continue; }
    throw new Error(`path-d: a number before any command in "${d}"`);
  }
  return subs;
}

// An SVG arc's centre and signed sweep angle (SVG 1.1 F.6.5, rx = ry, no rotation; a radius too small for the chord is scaled up, as SVG does).
// null for a zero-length arc (SVG draws nothing).
function arcCentre(s) {
  const dx = (s.from.x - s.to.x) / 2, dy = (s.from.y - s.to.y) / 2, h2 = dx * dx + dy * dy;
  if (h2 === 0) return null;
  const r = Math.max(Math.abs(s.r), Math.sqrt(h2));
  const co = (s.large === s.sweep ? -1 : 1) * Math.sqrt(Math.max(0, (r * r - h2) / h2));
  const c = { x: co * dy + (s.from.x + s.to.x) / 2, y: -co * dx + (s.from.y + s.to.y) / 2 };
  const a0 = Math.atan2(s.from.y - c.y, s.from.x - c.x);
  let da = Math.atan2(s.to.y - c.y, s.to.x - c.x) - a0;
  if (s.sweep && da < 0) da += 2 * Math.PI;
  if (!s.sweep && da > 0) da -= 2 * Math.PI;
  return { c, r, a0, da };
}

const cross = (p, q) => p.x * q.y - q.x * p.y;
const bez = (s, u) => { const v = 1 - u; return { x: v * v * v * s.from.x + 3 * v * v * u * s.c1.x + 3 * v * u * u * s.c2.x + u * u * u * s.to.x, y: v * v * v * s.from.y + 3 * v * v * u * s.c1.y + 3 * v * u * u * s.c2.y + u * u * u * s.to.y }; };
const bezD = (s, u) => { const v = 1 - u; return { x: 3 * (v * v * (s.c1.x - s.from.x) + 2 * v * u * (s.c2.x - s.c1.x) + u * u * (s.to.x - s.c2.x)), y: 3 * (v * v * (s.c1.y - s.from.y) + 2 * v * u * (s.c2.y - s.c1.y) + u * u * (s.to.y - s.c2.y)) }; };
// 3-point Gauss-Legendre on [0, 1]: exact for the degree-5 polynomial x y' - y x' of a cubic
const GL = [[0.5 - Math.sqrt(0.15), 5 / 18], [0.5, 8 / 18], [0.5 + Math.sqrt(0.15), 5 / 18]];

/** The signed area (base mm²) enclosed by the CLOSED sub-paths of `d` (an open sub-path encloses nothing: its chord back is not a cut). */
export function pathSignedArea(d) {
  let total = 0;
  for (const sp of pathSubpaths(d)) {
    if (!sp.closed) continue;
    let a2 = 0; // twice the area
    for (const s of sp.segs) {
      if (s.c === 'L') a2 += cross(s.from, s.to);
      else if (s.c === 'A') { a2 += cross(s.from, s.to); const g = arcCentre(s); if (g) a2 += g.r * g.r * (g.da - Math.sin(g.da)); } // chord + circular segment
      else for (const [u, w] of GL) { const p = bez(s, u), q = bezD(s, u); a2 += w * cross(p, q); }
    }
    const last = sp.segs.length ? sp.segs[sp.segs.length - 1].to : sp.start;
    a2 += cross(last, sp.start); // Z: the straight closing edge (zero when the walk already ended at its start)
    total += a2 / 2;
  }
  return total;
}

/** The bounding box of every point `d` draws: { minX, minY, maxX, maxY }, or null for an empty path. */
export function pathBounds(d) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const ext = (p) => { if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y; if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y; };
  for (const sp of pathSubpaths(d)) {
    ext(sp.start);
    for (const s of sp.segs) {
      ext(s.to);
      if (s.c === 'A') {
        const g = arcCentre(s);
        if (!g) continue;
        const lo = Math.min(g.a0, g.a0 + g.da), hi = Math.max(g.a0, g.a0 + g.da);
        for (let k = Math.ceil(lo / (Math.PI / 2)); k * (Math.PI / 2) <= hi; k++) { const a = k * (Math.PI / 2); ext({ x: g.c.x + g.r * Math.cos(a), y: g.c.y + g.r * Math.sin(a) }); }
      } else if (s.c === 'C') {
        for (const ax of ['x', 'y']) { // B'(u) / 3 = A u² + B u + C per axis
          const p0 = s.from[ax], p1 = s.c1[ax], p2 = s.c2[ax], p3 = s.to[ax];
          const A = -p0 + 3 * p1 - 3 * p2 + p3, B = 2 * (p0 - 2 * p1 + p2), C = p1 - p0;
          const roots = Math.abs(A) < 1e-12 ? (Math.abs(B) < 1e-12 ? [] : [-C / B]) : (() => { const q = B * B - 4 * A * C; return q < 0 ? [] : [(-B + Math.sqrt(q)) / (2 * A), (-B - Math.sqrt(q)) / (2 * A)]; })();
          for (const u of roots) if (u > 0 && u < 1) ext(bez(s, u));
        }
      }
    }
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}
