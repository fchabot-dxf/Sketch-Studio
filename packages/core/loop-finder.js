// packages/core/loop-finder.js — find the TOPOLOGICAL loops (closed cycles of joined edges) of a sketch.
// PURE: a function of `state` (joints Map + shapes + constraints); NO DOM / rendering. Consumed by Shaper's Prepare (SP1c+) where a loop = a selectable
// cut-region. Topological loops only (the locked design decision); intersection-derived arrangement faces are OUT.
//
// ALGORITHM (stated per spec): planar FACE TRAVERSAL on the joint POSITIONS. Build the joint↔edge graph
// (coincident joints merged into one node; every curve between two ends = an edge: lines, arcs, beziers; circles = inherent
// standalone loops). At each node, sort the incident half-edges CCW by the direction each LEAVES the node in; the next
// half-edge of a face is the one immediately CLOCKWISE from the reverse arrival edge — tracing each BOUNDED face
// counter-clockwise (positive signed area). The single unbounded outer face per component comes out clockwise (negative
// area) and is dropped. This yields the MINIMAL enclosed loops (e.g. two rects sharing an edge → the 2 small loops, not the
// big outer one). Open chains / dangling edges fall into the outer face → no loop.
// TASK 761: the CURVES' REAL GEOMETRY, read from their kind's declaration (#core/curve-kinds CURVE_KINDS, the one place): a curve
// joins its two END joints (an arc's start / end, joints[1] / [2]: its centre joints[0] is not a node; a bezier's first / last); at
// a node a curve leaves along its TANGENT (an arc: perpendicular to its radius; a bezier: towards its control point), not its chord,
// ties (two curves leaving tangent to each other) broken by their curvature; a face's signed area adds each curve's bulge (the area
// between it and its chord). So the two-edge loops a chord cannot see are found (an arc and its chord, a lens of two arcs, a bezier
// and a line). A line keeps the exact arithmetic of before (its chord direction, no bulge), so a drawing without curves is unchanged.
// The loop's `edges` keep the shape ids; consumers draw / sample each curve by the same declaration.

import { curveKind } from './curve-kinds.js'; // TASK 761: each curve kind's ends, tangent and bulge, declared once (CURVE_KINDS)

// Build a joint→canonical-node map (coincident joints merged; canonical = the min joint id in the cluster — stable).
// Equivalent to repeated getCoincidentJoints(), via one union-find pass.
export function buildNodeMap(state) {
  const parent = new Map();
  const find = (x) => {
    if (!parent.has(x)) { parent.set(x, x); return x; }
    let r = x; while (parent.get(r) !== r) r = parent.get(r);
    while (parent.get(x) !== r) { const n = parent.get(x); parent.set(x, r); x = n; }
    return r;
  };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
  for (const c of (state.constraints || [])) {
    if (c && c.type === 'coincident' && Array.isArray(c.joints) && c.joints.length >= 2) {
      for (let i = 1; i < c.joints.length; i++) union(c.joints[0], c.joints[i]);
    }
  }
  // Canonical = the lexicographically-min joint id per cluster, precomputed over ALL joints (query-order-independent).
  const minPerRoot = new Map();
  for (const jid of state.joints.keys()) {
    const r = find(jid);
    if (!minPerRoot.has(r) || String(jid) < String(minPerRoot.get(r))) minPerRoot.set(r, jid);
  }
  return (jid) => { const r = find(jid); return minPerRoot.has(r) ? minPerRoot.get(r) : jid; };
}

// Canonicalize a loop (stable id from its edge SET; ordered joints/edges preserve the boundary walk).
function makeLoop(nodes, edges) {
  const id = 'loop_' + edges.slice().sort().join('-');
  return { id, joints: nodes, edges, closed: true };
}

// Two half-edges leaving a node whose directions differ by less than this (radians) leave TANGENT to each other: the one that turns more to the
// left comes later counter-clockwise (TASK 761). Never applied between two lines (they keep the exact angle order of before).
const TANGENT_TIE = 1e-9;
const byLeaving = (a, b) => {
  const d = a.angle - b.angle;
  if (d !== 0 && ((a.straight && b.straight) || Math.abs(d) > TANGENT_TIE)) return d;
  return (a.bend - b.bend) || d;
};

// Planar face traversal over the edges (each a curve of a declared kind, walked from its start `a` to its end `b`) → the bounded (inner) faces.
function findFaces(edges, posOf, J) {
  const half = [];
  for (const e of edges) {
    half.push({ from: e.a, to: e.b, shapeId: e.shapeId, edge: e, forward: true });
    half.push({ from: e.b, to: e.a, shapeId: e.shapeId, edge: e, forward: false });
  }
  const out = new Map();      // node -> outgoing half-edges (sorted CCW by the direction they leave in)
  const hmap = new Map();     // "from|to|shapeId" -> half-edge (to find the reverse)
  for (const h of half) {
    const p = posOf(h.from), q = posOf(h.to);
    const kind = h.edge.kind, leave = kind.leave ? kind.leave(h.edge.shape, J, !h.forward) : null; // a straight kind leaves along its chord
    h.straight = !kind.leave;
    h.angle = leave ? Math.atan2(leave.dy, leave.dx) : (p && q) ? Math.atan2(q.y - p.y, q.x - p.x) : 0;
    h.bend = leave ? leave.bend : 0;
    if (!out.has(h.from)) out.set(h.from, []);
    out.get(h.from).push(h);
    hmap.set(h.from + '|' + h.to + '|' + h.shapeId, h);
  }
  for (const arr of out.values()) arr.sort(byLeaving);

  const next = (h) => {
    const arr = out.get(h.to); if (!arr || !arr.length) return null;
    const rev = hmap.get(h.to + '|' + h.from + '|' + h.shapeId); // reverse arrival edge (v→u)
    const i = arr.indexOf(rev); if (i < 0) return null;
    return arr[(i - 1 + arr.length) % arr.length];               // clockwise-adjacent → next face edge (inner CCW)
  };

  const used = new Set();
  const faces = [];
  for (const start of half) {
    if (used.has(start)) continue;
    const cycle = [];
    let h = start, ok = true, guard = 0;
    do {
      if (used.has(h)) { ok = false; break; }
      used.add(h); cycle.push(h);
      h = next(h);
    } while (h && h !== start && guard++ < 100000);
    if (!ok || h !== start || cycle.length < 2) continue; // open / malformed → skip

    let area = 0, bad = false;
    for (const e of cycle) {
      const p = posOf(e.from), q = posOf(e.to);
      if (!p || !q) { bad = true; break; }
      area += p.x * q.y - q.x * p.y;
      if (!e.straight) area += 2 * (e.forward ? 1 : -1) * e.edge.kind.bulge(e.edge.shape, J); // TASK 761: the curve's area beyond its chord
    }
    if (bad) continue;
    area /= 2;
    if (area > 1e-9) faces.push(makeLoop(cycle.map((e) => e.from), cycle.map((e) => e.shapeId))); // bounded (CCW)
  }
  return faces;
}

/**
 * findLoops(state) → Loop[]   Loop = { id, joints:[nodeId...], edges:[shapeId...], closed:true } (ordered boundary).
 * Pure fn of state.joints (Map id→{x,y}) + state.shapes (line: 2 joints; arc: center/start/end at [0]/[1]/[2]; bezier: its end
 * joints + control points c1 / c2; circle: center joint + radius) + state.constraints (coincident merges). Deterministic ids + order.
 */
export function findLoops(state) {
  if (!state || !state.joints || typeof state.joints.get !== 'function') return [];
  const shapes = state.shapes || [];
  const node = buildNodeMap(state);
  const posOf = (nid) => { const j = state.joints.get(nid); return j ? { x: j.x, y: j.y } : null; };

  const loops = [];
  const edges = [];
  for (const s of shapes) {
    if (!s || !Array.isArray(s.joints)) continue;
    if (s.isConstruction) continue; // TASK 478: construction geometry (a Fusion DASHED line) is never a cut path, so it must not split a loop
    const kind = curveKind(s);
    if (kind) { // TASK 761: a line, an arc or a bezier joins its two end joints (CURVE_KINDS ends)
      const [ja, jb] = kind.ends(s.joints);
      const a = node(ja), b = node(jb);
      if (a && b && a !== b) edges.push({ shapeId: s.id, a, b, kind, shape: s });
    } else if (s.type === 'circle' && s.joints.length >= 1) {
      const c = node(s.joints[0]);
      if (c) loops.push(makeLoop([c], [s.id])); // a circle is one inherent closed loop
    }
  }

  loops.push(...findFaces(edges, posOf, state.joints));
  loops.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)); // deterministic order
  return loops;
}

// THE END JOINTS of a curve, declared per shape kind (the joints a chain of curves passes through): a line's two joints, an arc's start /
// end (joints[1] / [2]; joints[0] is its centre), a bezier's first / last joint: TASK 761, declared with the rest of each kind's geometry in
// #core/curve-kinds.js (CURVE_KINDS). A kind without an entry (a circle) has no ends.
// The end joint ids of shape s, or null when its kind declares none (or it has too few joints).
export function curveEnds(s) {
  const d = curveKind(s);
  return d ? d.ends(s.joints) : null;
}

/**
 * findConnectedChain(state, shapeId, include) -> shape ids   (TASK 588: the select tool's double-click)
 * Every curve connected END TO END to the shape `shapeId`, through branches: two curves are connected when an end joint of one is an end
 * joint of the other or is made coincident with it (buildNodeMap). A curve is in the chain only when it is the same kind as the start one
 * (construction or normal) and include(shape) accepts it (the caller's pick rule: locked / hidden sketches are out). A shape without ends
 * (a circle) is a chain of itself. The start shape comes first, then breadth-first order.
 */
export function findConnectedChain(state, shapeId, include = () => true) {
  const start = ((state && state.shapes) || []).find((s) => s && s.id === shapeId);
  return start ? chainWalker(state, include)(start) : [];
}

/**
 * findConnectedChains(state, include) -> [shape ids]   (TASK 751: an import's pieces)
 * EVERY chain of the state's shapes (those include() accepts), each exactly what findConnectedChain gives from its first shape, in the order of
 * the shapes; the graph is built once (a drawing of thousands of chains: one pass, not one per chain).
 */
export function findConnectedChains(state, include = () => true) {
  const walk = chainWalker(state, include);
  const seen = new Set(), chains = [];
  for (const s of ((state && state.shapes) || [])) {
    if (!s || seen.has(s.id) || !include(s)) continue;
    const chain = walk(s);
    for (const id of chain) seen.add(id);
    chains.push(chain);
  }
  return chains;
}

// THE chain rule, its graph built once for a state: walk(start) -> the chain of `start` (findConnectedChain's rule above): the curves
// include() accepts, linked through their end joints (merged by coincidence, buildNodeMap), a curve only with curves of its own kind.
function chainWalker(state, include) {
  const node = buildNodeMap(state);
  const key = (s, j) => (s.isConstruction ? 'c:' : 'n:') + node(j);
  const byKey = new Map();
  for (const s of ((state && state.shapes) || [])) {
    if (!s || !include(s)) continue;
    for (const j of (curveEnds(s) || [])) {
      const k = key(s, j);
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k).push(s);
    }
  }
  return (start) => {
    const chain = [start.id], seen = new Set(chain), queue = [start];
    while (queue.length) {
      const cur = queue.shift();
      for (const j of (curveEnds(cur) || [])) {
        for (const s of (byKey.get(key(start, j)) || [])) {
          if (seen.has(s.id)) continue;
          seen.add(s.id); chain.push(s.id); queue.push(s);
        }
      }
    }
    return chain;
  };
}

/**
 * findOpenChains(state, loops) → Chain[]
 * Returns [{ id, shapes, edges }] for each connected group (connected through shared/coincident joints)
 * of shapes that are in NO loop's `edges`.
 * id = 'chain_' + member shape ids sorted and joined with '-'.
 */
export function findOpenChains(state, loops) {
  if (!state || !state.joints || typeof state.joints.get !== 'function') return [];
  const allLoops = loops || findLoops(state);
  const loopEdgeIds = new Set();
  for (const l of allLoops) {
    if (Array.isArray(l.edges)) {
      for (const eid of l.edges) loopEdgeIds.add(eid);
    }
  }

  const shapes = state.shapes || [];
  const candidateShapes = shapes.filter((s) => s && s.id && !loopEdgeIds.has(s.id) && !s.isConstruction); // TASK 478: construction is never a chain either
  if (!candidateShapes.length) return [];

  const node = buildNodeMap(state);
  const endpointsOf = (s) => {
    if (!s || !Array.isArray(s.joints)) return [];
    const ends = curveEnds(s);
    return (ends || s.joints).map((j) => node(j));
  };

  const nodeToShapes = new Map();
  for (const s of candidateShapes) {
    const ends = endpointsOf(s);
    for (const nid of ends) {
      if (!nid) continue;
      if (!nodeToShapes.has(nid)) nodeToShapes.set(nid, []);
      nodeToShapes.get(nid).push(s);
    }
  }

  const visited = new Set();
  const chains = [];

  for (const s of candidateShapes) {
    if (visited.has(s.id)) continue;
    const comp = [];
    const queue = [s];
    visited.add(s.id);

    while (queue.length > 0) {
      const cur = queue.shift();
      comp.push(cur);
      const ends = endpointsOf(cur);
      for (const nid of ends) {
        if (!nid) continue;
        const neighbors = nodeToShapes.get(nid) || [];
        for (const nxt of neighbors) {
          if (!visited.has(nxt.id)) {
            visited.add(nxt.id);
            queue.push(nxt);
          }
        }
      }
    }

    comp.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const shapeIds = comp.map((x) => x.id);
    const id = 'chain_' + shapeIds.join('-');
    chains.push({ id, shapes: comp, edges: shapeIds });
  }

  chains.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return chains;
}

