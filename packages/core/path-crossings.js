// packages/core/path-crossings.js — TASK 804: THE crossing check of written toolpaths (one place; the programmed pocket's hard rule and its tests reuse it).
// PURE (no DOM). Paths are polylines of {x, y} points (base mm), open or closed (a closed path may repeat its first point at the end).
//
// WHAT COUNTS (tolerance `tol`, default CROSSING_TOL_MM = 0.002 mm: twenty times the written resolution of 0.0001 mm, far below any stepover):
//  * a CROSSING = a place where one path passes from one side of another path (or of another, non-local part of itself) to the other side.
//  * a TOUCH is not a crossing: two paths meeting within `tol` and leaving on the side they came from, a path that ENDS on another (a raster pass ending
//    on its clean-up ring), a path running ALONG another (a link along a contour that is also cut as a ring) and leaving on the side it came from, and a
//    path passing an open path's END.
//  * along one path, the part within LOCAL_MM (arc length) of a point is its own neighbourhood, never a crossing with it.
// HOW (robust: no exact-zero test decides anything):
//  1. a PROPER crossing: two segments whose four ends each lie more than `tol` from the other segment, and that intersect.
//  2. a CONTACT: a run of consecutive vertices of path X within `tol` of path Y (or of a non-local part of X): the side of Y that X comes from (a point
//     of X just before the run, more than `tol` from Y) against the side it leaves to (just after it). Y's side of a point = the side of Y's nearest
//     feature: a segment (its left / right), or an inside vertex (the left side of a left turn is the wedge between its two segments, of a right turn
//     the rest), never an open path's end (a path ending there is a touch). Opposite sides = ONE crossing. A contact at a vertex of both paths is
//     counted from one of them only (the lower path index; for one path: the earlier vertex).
// Result: { count, crossings: [{ a, b, at: {x, y} }] } (a / b = the path indexes; a === b: the path crosses itself).
export const CROSSING_TOL_MM = 0.002;
const LOCAL_MM = 0.05;

const orient = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
function segDist(p, a, b) {
  const vx = b.x - a.x, vy = b.y - a.y, L = vx * vx + vy * vy;
  const t = L > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / L)) : 0;
  return { d: Math.hypot(p.x - a.x - t * vx, p.y - a.y - t * vy), t };
}

// a path as { pts, closed, n (segments), arc (cumulative arc length at each vertex), total }
function prep(path) {
  const raw = (path.points || path).map((p) => (Array.isArray(p) ? { x: p[0], y: p[1] } : p));
  const pts = [];
  for (const p of raw) if (!pts.length || Math.hypot(p.x - pts[pts.length - 1].x, p.y - pts[pts.length - 1].y) > 1e-9) pts.push(p);
  let closed = Boolean(path.closed);
  if (pts.length > 2 && Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y) <= 1e-9) { pts.pop(); closed = true; }
  const arc = [0];
  for (let i = 1; i < pts.length; i++) arc.push(arc[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  const total = arc[arc.length - 1] + (closed && pts.length > 1 ? Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y) : 0);
  return { pts, closed: closed && pts.length > 2, n: pts.length < 2 ? 0 : closed && pts.length > 2 ? pts.length : pts.length - 1, arc, total };
}
const segEnds = (P, i) => [P.pts[i], P.pts[(i + 1) % P.pts.length]];
// arc-length distance along P between vertex i and the nearest end of segment j
function arcGap(P, i, j) {
  const s = P.arc[i], a = P.arc[j], b = j + 1 < P.pts.length ? P.arc[j + 1] : P.total;
  if (s >= a && s <= b) return 0;
  let d = Math.min(Math.abs(s - a), Math.abs(s - b));
  if (P.closed) d = Math.min(d, P.total - Math.abs(s - a), P.total - Math.abs(s - b));
  return d;
}
// arc-length distance between two segments of one path (0 when they share a vertex)
function segGap(P, i, j) { return Math.min(arcGap(P, i, j), arcGap(P, (i + 1) % P.pts.length, j)); }

// a uniform grid of every segment's box (grown by tol): cells keyed by number, each a list of segment ids (path k, segment i -> id via `ids`)
function buildGrid(paths, tol) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, nSeg = 0, len = 0;
  for (const P of paths) { for (const p of P.pts) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); } nSeg += P.n; len += P.total; }
  const cell = Math.max(nSeg ? (len / nSeg) * 2 : 1, Math.hypot(maxX - minX, maxY - minY) / 2048, tol * 4, 1e-6);
  const map = new Map(), key = (i, j) => i * 1000003 + j, segs = [];
  paths.forEach((P, k) => {
    for (let i = 0; i < P.n; i++) {
      const id = segs.length, [a, b] = segEnds(P, i);
      segs.push([k, i]);
      const x0 = Math.floor((Math.min(a.x, b.x) - tol) / cell), x1 = Math.floor((Math.max(a.x, b.x) + tol) / cell);
      const y0 = Math.floor((Math.min(a.y, b.y) - tol) / cell), y1 = Math.floor((Math.max(a.y, b.y) + tol) / cell);
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) { const kk = key(x, y); let c = map.get(kk); if (!c) { c = []; map.set(kk, c); } c.push(id); }
    }
  });
  return { cell, map, key, segs, seen: new Int32Array(segs.length), stamp: 0 };
}
// every segment [k, i] whose grown box may hold a point within r of p
function near(grid, p, r) {
  const out = [], st = ++grid.stamp;
  const x0 = Math.floor((p.x - r) / grid.cell), x1 = Math.floor((p.x + r) / grid.cell), y0 = Math.floor((p.y - r) / grid.cell), y1 = Math.floor((p.y + r) / grid.cell);
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
    const c = grid.map.get(grid.key(x, y));
    if (c) for (const id of c) if (grid.seen[id] !== st) { grid.seen[id] = st; out.push(grid.segs[id]); }
  }
  return out;
}

/** pathCrossings(paths, { tol }) -> { count, crossings: [{ a, b, at }] } (see the header). `paths`: [{ points: [{x,y}|[x,y]], closed }]. */
export function pathCrossings(paths, opts = {}) {
  const tol = opts.tol > 0 ? opts.tol : CROSSING_TOL_MM;
  const Ps = paths.map(prep);
  const grid = buildGrid(Ps, tol);
  const crossings = [];
  // a segment of path k counts against vertex / segment of path k2 unless it is local (one path, within LOCAL_MM of arc length)
  const localSeg = (k, i, k2, j) => k === k2 && segGap(Ps[k], i, j) < LOCAL_MM;
  const localVtx = (k, v, k2, j) => k === k2 && arcGap(Ps[k], v, j) < LOCAL_MM;
  // 1. PROPER crossings
  for (const [k, P] of Ps.entries()) {
    for (let i = 0; i < P.n; i++) {
      const [a, b] = segEnds(P, i);
      const cand = near(grid, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, Math.hypot(b.x - a.x, b.y - a.y) / 2 + tol);
      for (const [k2, j] of cand) {
        if (k2 < k || (k2 === k && j <= i) || localSeg(k, i, k2, j)) continue;
        const [c, d] = segEnds(Ps[k2], j);
        if (segDist(a, c, d).d <= tol || segDist(b, c, d).d <= tol || segDist(c, a, b).d <= tol || segDist(d, a, b).d <= tol) continue; // a contact: step 2
        const o1 = orient(a, b, c), o2 = orient(a, b, d), o3 = orient(c, d, a), o4 = orient(c, d, b);
        if (((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) && ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0))) {
          const t = o3 / (o3 - o4);
          crossings.push({ a: k, b: k2, at: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t } });
        }
      }
    }
  }
  // the segments of path k2 within r of point p (not local to vertex v of path k when k2 === k): [j]
  const segsNear = (p, k, v, k2, r) => {
    const out = [];
    for (const [kk, j] of near(grid, p, r)) {
      if (kk !== k2 || localVtx(k, v, k2, j)) continue;
      const [c, d] = segEnds(Ps[kk], j);
      if (segDist(p, c, d).d <= r) out.push(j);
    }
    return out;
  };
  // the nearest feature of path k2 among its segments `js` to point p: { j, t, d }
  const nearestIn = (p, k2, js) => {
    let best = null;
    for (const j of js) { const [c, d] = segEnds(Ps[k2], j), f = segDist(p, c, d); if (!best || f.d < best.d) best = { j, t: f.t, d: f.d }; }
    return best;
  };
  // the side (+1 left / -1 right / 0 undefined) of path Y = Ps[k2] at its feature f for point p
  const sideOf = (k2, f, p) => {
    const Y = Ps[k2], m = Y.pts.length;
    const [c, d] = segEnds(Y, f.j);
    const L = Math.hypot(d.x - c.x, d.y - c.y) || 1;
    const atStart = f.t * L <= tol, atEnd = (1 - f.t) * L <= tol;
    if (!atStart && !atEnd) { const o = orient(c, d, p); return o > 0 ? 1 : o < 0 ? -1 : 0; }
    const vi = atStart ? f.j : (f.j + 1) % m; // the vertex
    if (!Y.closed && (vi === 0 || vi === m - 1)) return 0; // an open path's end
    const prev = Y.pts[(vi - 1 + m) % m], q = Y.pts[vi], next = Y.pts[(vi + 1) % m];
    const l1 = orient(prev, q, p) > 0, l2 = orient(q, next, p) > 0, turnLeft = orient(prev, q, next) >= 0;
    return (turnLeft ? l1 && l2 : l1 || l2) ? 1 : -1;
  };
  // 2. CONTACTS: each contact between a PASSAGE of path k (a run of its vertices) and a passage of path k2 (a run of its segments) within tol: a
  // point where several passages meet (a leg through a ring's start, where the ring also begins and ends) is one contact per pair of passages
  for (const [k, X] of Ps.entries()) {
    const m = X.pts.length;
    for (let k2 = 0; k2 < Ps.length; k2++) {
      const Y = Ps[k2];
      const pairs = new Map(); // "v:j" -> union-find parent
      X.pts.forEach((p, v) => { for (const j of segsNear(p, k, v, k2, tol)) pairs.set(v + ':' + j, v + ':' + j); });
      if (!pairs.size) continue;
      const find = (a) => { while (pairs.get(a) !== a) { pairs.set(a, pairs.get(pairs.get(a))); a = pairs.get(a); } return a; };
      const stepV = (v, dv) => (X.closed ? (v + dv + m) % m : v + dv), stepJ = (j, dj) => (Y.closed ? (j + dj + Y.n) % Y.n : j + dj);
      for (const key of pairs.keys()) {
        const [v, j] = key.split(':').map(Number);
        for (const dv of [-1, 0, 1]) for (const dj of [-1, 0, 1]) {
          const o = stepV(v, dv) + ':' + stepJ(j, dj);
          if (pairs.has(o)) { const a = find(key), b = find(o); if (a !== b) pairs.set(a, b); }
        }
      }
      const comps = new Map();
      for (const key of pairs.keys()) { const r = find(key); if (!comps.has(r)) comps.set(r, { V: new Set(), J: new Set(), at: new Map() }); const c = comps.get(r), [v, j] = key.split(':').map(Number); c.V.add(v); c.J.add(j); if (!c.at.has(v)) c.at.set(v, []); c.at.get(v).push(j); }
      for (const { V, J, at } of comps.values()) {
        if (V.size >= m) continue; // the whole path lies on the other: an overlap
        let v0 = [...V].find((v) => !V.has(stepV(v, -1)));
        if (v0 === undefined) continue;
        let v1 = v0;
        while (V.has(stepV(v1, 1)) && stepV(v1, 1) !== v0) v1 = stepV(v1, 1);
        if (!X.closed && (v0 === 0 || v1 === m - 1)) continue; // the path ends on the other: a touch
        const js = new Set(J);
        for (const j of J) for (const dj of [-1, 1]) { const o = stepJ(j, dj); if (o >= 0 && o < Y.n) js.add(o); }
        // dedupe: a contact at a vertex of both paths is counted from the lower path (one path: the earlier vertex)
        const f0 = nearestIn(X.pts[v0], k2, at.get(v0));
        const [c0, d0] = segEnds(Y, f0.j), L0 = Math.hypot(d0.x - c0.x, d0.y - c0.y) || 1;
        if (f0.t * L0 <= tol || (1 - f0.t) * L0 <= tol) { const yv = f0.t * L0 <= tol ? f0.j : (f0.j + 1) % Y.pts.length; if (k2 < k || (k2 === k && yv < v0)) continue; }
        // a point of X before the passage and after it, each more than tol from Y's passage (walking from the run's end vertex toward its neighbour)
        const sample = (v, w) => {
          const p = X.pts[v], q = X.pts[w], L = Math.hypot(q.x - p.x, q.y - p.y);
          if (!(L > 0)) return null;
          for (let dd = Math.min(L, tol * 4); ; dd = Math.min(L, dd * 2)) {
            const s = { x: p.x + ((q.x - p.x) * dd) / L, y: p.y + ((q.y - p.y) * dd) / L };
            const f = nearestIn(s, k2, js);
            if (f && f.d > tol) return { s, f };
            if (dd >= L) return null;
          }
        };
        const before = sample(v0, stepV(v0, -1)), after = sample(v1, stepV(v1, 1));
        if (!before || !after) continue;
        const s0 = sideOf(k2, before.f, before.s), s1 = sideOf(k2, after.f, after.s);
        if (s0 && s1 && s0 !== s1) crossings.push({ a: Math.min(k, k2), b: Math.max(k, k2), at: { ...X.pts[v0] } });
      }
    }
  }
  return { count: crossings.length, crossings };
}
