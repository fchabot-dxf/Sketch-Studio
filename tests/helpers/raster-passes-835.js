// tests/helpers/raster-passes-835.js — TASK 835: how a Raster loop cuts the Loop-off passes. For each pass (an open {x,y}[] segment of the Loop-off plan)
// the loop's 'pass' turns lying on its line (both ends within `tol` of it) are projected onto it: `covered` = the length of the pass they cover, `twice` =
// the length they cover more than once, `gaps` = the uncovered stretches inside the pass (where a corridor leaves it), `ends` = uncovered length at the
// pass's two ends (must be 0: every pass is cut up to the area's edge).
export function passCoverage(loops, passes, tol = 0.003) {
  const segs = [];
  for (const c of loops) for (const t of c.turns || []) if (t.kind === 'pass') for (let i = t.start; i < t.end; i++) segs.push([c.points[i], c.points[i + 1]]);
  return passes.map((pts) => {
    const a = pts[0], b = pts[pts.length - 1], L = Math.hypot(b.x - a.x, b.y - a.y), ux = (b.x - a.x) / L, uy = (b.y - a.y) / L;
    const off = (p) => Math.abs((p.x - a.x) * uy - (p.y - a.y) * ux), along = (p) => (p.x - a.x) * ux + (p.y - a.y) * uy;
    const iv = segs.filter(([p, q]) => off(p) <= tol && off(q) <= tol).map(([p, q]) => [Math.max(0, Math.min(along(p), along(q))), Math.min(L, Math.max(along(p), along(q)))]).filter(([u, v]) => v > u + 1e-9).sort((x, y) => x[0] - y[0]);
    let total = 0, union = 0, end = -Infinity;
    const gaps = [];
    for (const [u, v] of iv) {
      total += v - u;
      if (u > end) { if (end > -Infinity && u - end > tol) gaps.push(u - end); union += v - u; end = v; } else if (v > end) { union += v - end; end = v; }
    }
    const first = iv.length ? iv[0][0] : L, last = iv.length ? end : 0;
    return { length: L, covered: union, twice: total - union, gaps, ends: first + Math.max(0, L - last) };
  });
}
