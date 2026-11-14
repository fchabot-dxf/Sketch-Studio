// packages/core/loop-finder.js — find the TOPOLOGICAL loops (closed cycles of joined edges) of a sketch.
// PURE: a function of `state` (joints Map + shapes + constraints); NO DOM / rendering. Additive — nothing else in
// #core imports it (SketchStudio byte-identical). Consumed by Shaper's Prepare (SP1c+) where a loop = a selectable
// cut-region. Topological loops only (the locked design decision); intersection-derived arrangement faces are OUT.
//
// ALGORITHM (stated per spec): planar FACE TRAVERSAL on the joint POSITIONS. Build the joint↔edge graph
// (coincident joints merged into one node; lines + arc-chords = edges; circles = inherent standalone loops). At
// each node, sort the incident half-edges CCW by angle; the next half-edge of a face is the one immediately
// CLOCKWISE from the reverse arrival edge — tracing each BOUNDED face counter-clockwise (positive signed area).
// The single unbounded outer face per component comes out clockwise (negative area) and is dropped. This yields the
// MINIMAL enclosed loops (e.g. two rects sharing an edge → the 2 small loops, not the big outer one). Open chains /
// dangling edges fall into the outer face → no loop.
// ARCS: a 'CENTER'-subType arc stores joints[0]=center, joints[1]=start, joints[2]=end (per makeArc +
// calculateArcPath). Chord-approximated for connectivity + the angular sort — the chord is start→end
// (joints[1]→joints[2]); the center (joints[0]) is NOT a connectivity node. The loop's `edges` keeps the arc's
// shapeId so a consumer renders the true curve; the topology uses the chord. (LIMITATION: two arcs sharing both
// endpoints with an equal chord angle are ambiguous under chord-approx — disambiguating via the arc tangent is deferred.)

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

// Planar face traversal over straight/chord edges → the bounded (inner) faces.
function findFaces(edges, posOf) {
  const half = [];
  for (const e of edges) {
    half.push({ from: e.a, to: e.b, shapeId: e.shapeId });
    half.push({ from: e.b, to: e.a, shapeId: e.shapeId });
  }
  const out = new Map();      // node -> outgoing half-edges (sorted CCW by angle)
  const hmap = new Map();     // "from|to|shapeId" -> half-edge (to find the reverse)
  for (const h of half) {
    const p = posOf(h.from), q = posOf(h.to);
    h.angle = (p && q) ? Math.atan2(q.y - p.y, q.x - p.x) : 0;
    if (!out.has(h.from)) out.set(h.from, []);
    out.get(h.from).push(h);
    hmap.set(h.from + '|' + h.to + '|' + h.shapeId, h);
  }
  for (const arr of out.values()) arr.sort((a, b) => a.angle - b.angle);

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
    }
    if (bad) continue;
    area /= 2;
    if (area > 1e-9) faces.push(makeLoop(cycle.map((e) => e.from), cycle.map((e) => e.shapeId))); // bounded (CCW)
  }
  return faces;
}

/**
 * findLoops(state) → Loop[]   Loop = { id, joints:[nodeId...], edges:[shapeId...], closed:true } (ordered boundary).
 * Pure fn of state.joints (Map id→{x,y}) + state.shapes (line: 2 joints; arc: center/start/end at [0]/[1]/[2];
 * circle: center joint + radius) + state.constraints (coincident merges). Deterministic ids + order.
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
    if (s.type === 'line' && s.joints.length >= 2) {
      const a = node(s.joints[0]), b = node(s.joints[1]);
      if (a && b && a !== b) edges.push({ shapeId: s.id, a, b });
    } else if (s.type === 'arc' && s.joints.length >= 3) {
      const a = node(s.joints[1]), b = node(s.joints[2]); // chord = start (joints[1]) → end (joints[2]); joints[0] = center
      if (a && b && a !== b) edges.push({ shapeId: s.id, a, b });
    } else if (s.type === 'circle' && s.joints.length >= 1) {
      const c = node(s.joints[0]);
      if (c) loops.push(makeLoop([c], [s.id])); // a circle is one inherent closed loop
    }
  }

  loops.push(...findFaces(edges, posOf));
  loops.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)); // deterministic order
  return loops;
}

// THE END JOINTS of a curve, declared per shape kind (the joints a chain of curves passes through): a line's two joints, an arc's start /
// end (joints[1] / [2]; joints[0] is its centre), a bezier's first / last joint. A kind without an entry (a circle) has no ends.
const CURVE_ENDS = {
  line: { min: 2, ends: (j) => [j[0], j[1]] },
  arc: { min: 3, ends: (j) => [j[1], j[2]] },
  bezier: { min: 2, ends: (j) => [j[0], j[j.length - 1]] },
};
// The end joint ids of shape s (CURVE_ENDS), or null when its kind declares none (or it has too few joints).
export function curveEnds(s) {
  const d = s && CURVE_ENDS[s.type];
  return d && Array.isArray(s.joints) && s.joints.length >= d.min ? d.ends(s.joints) : null;
}

/**
 * findConnectedChain(state, shapeId, include) -> shape ids   (TASK 588: the select tool's double-click)
 * Every curve connected END TO END to the shape `shapeId`, through branches: two curves are connected when an end joint of one is an end
 * joint of the other or is made coincident with it (buildNodeMap). A curve is in the chain only when it is the same kind as the start one
 * (construction or normal) and include(shape) accepts it (the caller's pick rule: locked / hidden sketches are out). A shape without ends
 * (a circle) is a chain of itself. The start shape comes first, then breadth-first order.
 */
export function findConnectedChain(state, shapeId, include = () => true) {
  const shapes = (state && state.shapes) || [];
  const start = shapes.find((s) => s && s.id === shapeId);
  if (!start) return [];
  const construction = !!start.isConstruction;
  const node = buildNodeMap(state);
  const byNode = new Map();
  for (const s of shapes) {
    if (!s || s === start || !!s.isConstruction !== construction || !include(s)) continue;
    for (const j of (curveEnds(s) || [])) {
      const n = node(j);
      if (!byNode.has(n)) byNode.set(n, []);
      byNode.get(n).push(s);
    }
  }
  const chain = [start.id], seen = new Set(chain), queue = [start];
  while (queue.length) {
    for (const j of (curveEnds(queue.shift()) || [])) {
      for (const s of (byNode.get(node(j)) || [])) {
        if (seen.has(s.id)) continue;
        seen.add(s.id); chain.push(s.id); queue.push(s);
      }
    }
  }
  return chain;
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

