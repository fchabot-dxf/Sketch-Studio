// packages/core/loop-geometry.js — loop boundary polygons + point-in-polygon CONTAINMENT. Lifted from
// apps/shaper/src/prepare-view.js (SKETCH-4a) so profile resolution / joints can reuse the geometry.
//
// PURITY NOTE: `sampleArc` samples the TRUE rendered curve via the browser SVG path API (getPointAtLength), so
// `loopPolygon` for an ARC loop needs the DOM (degrades to the endpoints in Node). `loopPolygon` for LINE/CIRCLE/BEZIER
// loops, `polyArea`, `pointInPolygon`, and `polygonContains` are PURE (no DOM) and Node-oracle-tested. The export
// HOST can precompute loop polygons in the browser and pass them in to keep `shaper-export` pure.

import { buildNodeMap } from './loop-finder.js';
import { curveKind, curvePointsFrom, num, sampleArc } from './curve-kinds.js'; // TASK 761: each curve kind's geometry, declared once

export { num, sampleArc }; // TASK 761: moved to #core/curve-kinds.js (the per-kind declaration); re-exported for their callers

const EPS = 1e-9;

// Boundary polygon (ordered world points) for a loop — straight for lines, sampled for arcs and beziers (their kind's points), around-the-rim for circles.
export function loopPolygon(loop, state, shapeById) {
  const J = state.joints;
  if (loop.edges.length === 1) {
    const s = shapeById.get(loop.edges[0]);
    if (s && s.type === 'circle') {
      const c = J.get(loop.joints[0]); const r = (s.radius > 0) ? s.radius : 0;
      if (!c || !r) return [];
      const pts = []; for (let i = 0; i < 48; i++) { const t = (i / 48) * 2 * Math.PI; pts.push({ x: c.x + r * Math.cos(t), y: c.y + r * Math.sin(t) }); }
      return pts;
    }
  }
  const pts = [];
  for (let i = 0; i < loop.edges.length; i++) {
    const fromPos = J.get(loop.joints[i]);
    if (!fromPos) continue;
    const s = shapeById.get(loop.edges[i]);
    if (s && s.type !== 'line' && curveKind(s)) { // TASK 761: a curve (an arc, a bezier) sampled by its kind (#core/curve-kinds), walked from this joint
      const samples = curvePointsFrom(s, state, fromPos);
      for (let k = 0; k < samples.length - 1; k++) pts.push(samples[k]); // next edge contributes its own start
    } else {
      pts.push({ x: fromPos.x, y: fromPos.y });
    }
  }
  return pts;
}

// Absolute area of a simple polygon (shoelace).
export function polyArea(poly) { let a = 0; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += poly[j].x * poly[i].y - poly[i].x * poly[j].y; return Math.abs(a / 2); }

// Ray-crossing point-in-polygon (boundary cases are ambiguous, as is standard).
export function pointInPolygon(poly, p) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (((a.y > p.y) !== (b.y > p.y)) && (p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x)) inside = !inside;
  }
  return inside;
}

const cross3 = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
// Proper crossing of segments p1p2 & p3p4 (ignores shared endpoints / mere touching / collinear).
function segsCross(p1, p2, p3, p4) {
  const d1 = cross3(p3, p4, p1), d2 = cross3(p3, p4, p2), d3 = cross3(p1, p2, p3), d4 = cross3(p1, p2, p4);
  return ((d1 > EPS && d2 < -EPS) || (d1 < -EPS && d2 > EPS)) && ((d3 > EPS && d4 < -EPS) || (d3 < -EPS && d4 > EPS));
}

// TASK 732: a point STRICTLY INSIDE a simple polygon (never on its boundary): at its lexicographically lowest vertex v (a convex corner)
// with neighbours a and b, the centroid of the triangle a v b, unless other vertices fall inside that triangle: then the midpoint of v and
// the one of them farthest from the line a b (the classic interior-point construction; O'Rourke, Computational Geometry in C, 1.6).
function interiorPoint(poly) {
  const n = poly.length;
  let i = 0;
  for (let k = 1; k < n; k++) if (poly[k].x < poly[i].x || (poly[k].x === poly[i].x && poly[k].y < poly[i].y)) i = k;
  const v = poly[i], a = poly[(i - 1 + n) % n], b = poly[(i + 1) % n];
  const turn = Math.sign(cross3(a, v, b)); // the triangle's winding: a point is inside it when on the same side of its three edges
  let far = null, farDist = 0;
  for (let k = 0; k < n; k++) {
    const q = poly[k];
    if (k === i || q === a || q === b) continue;
    if (turn * cross3(a, v, q) > EPS && turn * cross3(v, b, q) > EPS && turn * cross3(b, a, q) > EPS) {
      const d = Math.abs(cross3(a, b, q));
      if (d > farDist) { farDist = d; far = q; }
    }
  }
  return far ? { x: (v.x + far.x) / 2, y: (v.y + far.y) / 2 } : { x: (a.x + v.x + b.x) / 3, y: (a.y + v.y + b.y) / 3 };
}

// SKETCH-4a: does `outer` contain `inner` (nesting: a hole or an island)? A point strictly inside inner is inside outer
// AND polyArea(inner) < polyArea(outer) AND no edge of inner crosses any edge of outer. Used by profile hole
// resolution (a profile with holes → an evenodd compound path). TASK 732: that point is one strictly INSIDE inner (interiorPoint), not its
// first vertex: a neighbouring face sharing an edge (a box divider standing on a board: its first vertex ON the board's edge, where the
// ray test is ambiguous) lies beside outer, never inside it.
export function polygonContains(outer, inner) {
  if (!Array.isArray(outer) || !Array.isArray(inner) || outer.length < 3 || inner.length < 3) return false;
  if (polyArea(inner) >= polyArea(outer)) return false;     // equal or larger → not strictly contained
  if (!pointInPolygon(outer, interiorPoint(inner))) return false; // a point strictly inside inner is inside outer
  const n = inner.length, m = outer.length;
  for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) {  // no crossing → strict, non-touching
    if (segsCross(inner[i], inner[(i + 1) % n], outer[j], outer[(j + 1) % m])) return false;
  }
  return true;
}

// loopToPathD(loop, state) → a CLOSED SVG path "d" from the loop's ordered boundary (joints[] + edges[]). Each edge is its kind's path
// command (#core/curve-kinds pathSeg): lines → `L x y`; arcs → a direction-aware `A …` segment; beziers → a cubic `C` (TASK 761); single-circle loops → two `A r r` half-arcs + `Z`. A line CLOSING
// edge is left to Z (so a pure-line loop is identical to SP1j-1); an arc closing edge is drawn explicitly. Returns ''
// on a missing loop / joint position.
export function loopToPathD(loop, state, { reverse = false } = {}) {
  if (!loop || !Array.isArray(loop.joints) || !state || !state.joints) return '';
  if (reverse && Array.isArray(loop.edges) && loop.edges.length > 1) {
    // TASK 456: walk the SAME loop the other way round: joints [j0,j1..jn-1] -> [j0,jn-1..j1], edges [e0..en-1] -> [en-1..e0]
    // (edge k joins joint k to joint k+1; the closing edge joins jn-1 to j0). arcSeg is direction-aware, so arcs flip their sweep.
    const j = loop.joints;
    return loopToPathD({ ...loop, joints: [j[0], ...j.slice(1).reverse()], edges: loop.edges.slice().reverse() }, state);
  }
  const shapeById = new Map((state.shapes || []).map((s) => [s.id, s]));
  const edges = Array.isArray(loop.edges) ? loop.edges : [];
  if (edges.length === 1) {
    const s = shapeById.get(edges[0]);
    if (s && s.type === 'circle') {
      const cid = (Array.isArray(s.joints) && s.joints[0]) || loop.joints[0];
      const c = cid ? state.joints.get(cid) : null;
      const r = Number(s.radius) || 0;
      if (!c || !(r > 0)) return '';
      const sw = reverse ? 1 : 0; // a hole circle winds the other way
      return `M ${num(c.x - r)} ${num(c.y)} A ${num(r)} ${num(r)} 0 1 ${sw} ${num(c.x + r)} ${num(c.y)} A ${num(r)} ${num(r)} 0 1 ${sw} ${num(c.x - r)} ${num(c.y)} Z`;
    }
  }
  if (loop.joints.length < 2) return '';
  const pos = (nid) => state.joints.get(nid);
  const n = loop.joints.length;
  const p0 = pos(loop.joints[0]);
  if (!p0) return '';
  let d = `M ${num(p0.x)} ${num(p0.y)}`;
  for (let i = 1; i < n; i++) {
    const fromP = pos(loop.joints[i - 1]), toP = pos(loop.joints[i]);
    if (!fromP || !toP) return '';
    const s = shapeById.get(edges[i - 1]), k = curveKind(s);
    d += ' ' + (k ? k.pathSeg(s, state, fromP, toP) : `L ${num(toP.x)} ${num(toP.y)}`);
  }
  const closing = shapeById.get(edges[n - 1]);
  if (closing && closing.type !== 'line' && curveKind(closing)) { // a curved closing edge (an arc, a bezier) is drawn; a line is left to Z
    const fromP = pos(loop.joints[n - 1]);
    if (fromP) d += ' ' + curveKind(closing).pathSeg(closing, state, fromP, p0);
  }
  return d + ' Z';
}

// compoundPathD(outerLoop, holeLoops, state) — TASK 456: THE one place a compound path "d" is built (combined profiles, pockets
// with islands, outside/inside profiles with holes): the outer loop plus each hole wound the OPPOSITE way, exactly like Shaper
// Studio, so it fills correctly under BOTH nonzero (the default, so no fill-rule attribute is needed) and evenodd. '' when the
// outer is missing.
export function compoundPathD(outerLoop, holeLoops, state) {
  const outerD = loopToPathD(outerLoop, state);
  if (!outerD) return '';
  return [outerD, ...(holeLoops || []).map((hl) => loopToPathD(hl, state, { reverse: true })).filter(Boolean)].join(' ');
}

// chainToPathD(chain, state) → an OPEN SVG path "d" from an open chain of shapes (lines / arcs / beziers).
// Orders the chain's shapes end to end, emitting `M x y` then each curve's kind's path command (#core/curve-kinds pathSeg:
// `L`, a direction-aware `A`, a cubic `C`). No Z. TASK 761: a bezier was skipped here before (its curve missing from the export).
export function chainToPathD(chain, state) {
  if (!chain || !state || !state.joints) return '';
  const shapeById = new Map((state.shapes || []).map((s) => [s.id, s]));
  const shapes = Array.isArray(chain.shapes)
    ? chain.shapes
    : (Array.isArray(chain.edges) ? chain.edges.map((id) => shapeById.get(id)).filter(Boolean) : []);
  if (!shapes.length) return '';

  const node = buildNodeMap(state);
  const pos = (jid) => state.joints.get(jid);
  const endsOf = (s) => { // TASK 761: a curve of any declared kind (line, arc, bezier: #core/curve-kinds), by its end joints
    const k = curveKind(s);
    if (!k) return null;
    const [a, b] = k.ends(s.joints);
    return { a, b, na: node(a), nb: node(b) };
  };

  if (shapes.length === 1) {
    const s = shapes[0];
    const e = endsOf(s);
    if (!e) return '';
    const pa = pos(e.a), pb = pos(e.b);
    if (!pa || !pb) return '';
    return `M ${num(pa.x)} ${num(pa.y)} ${curveKind(s).pathSeg(s, state, pa, pb)}`;
  }

  // Multi-shape chain: build adjacency graph
  const nodeDegrees = new Map();
  const nodeToShapes = new Map();
  for (const s of shapes) {
    const e = endsOf(s);
    if (!e) continue;
    nodeDegrees.set(e.na, (nodeDegrees.get(e.na) || 0) + 1);
    nodeDegrees.set(e.nb, (nodeDegrees.get(e.nb) || 0) + 1);
    if (!nodeToShapes.has(e.na)) nodeToShapes.set(e.na, []);
    nodeToShapes.get(e.na).push(s);
    if (!nodeToShapes.has(e.nb)) nodeToShapes.set(e.nb, []);
    nodeToShapes.get(e.nb).push(s);
  }

  // Pick start node: prefer degree-1 nodes (the endpoints of an open chain)
  const deg1 = [];
  for (const [nid, deg] of nodeDegrees) {
    if (deg === 1) deg1.push(nid);
  }
  deg1.sort();
  const allNodes = [...nodeDegrees.keys()].sort();

  const visitedShapes = new Set();
  let d = '';

  while (visitedShapes.size < shapes.length) {
    // Find next unvisited shape to start or continue a walk
    let startNode = deg1.find((nid) => (nodeToShapes.get(nid) || []).some((s) => !visitedShapes.has(s.id)));
    if (!startNode) {
      startNode = allNodes.find((nid) => (nodeToShapes.get(nid) || []).some((s) => !visitedShapes.has(s.id)));
    }
    if (!startNode) break;

    let curNode = startNode;
    let subpathStarted = false;

    while (true) {
      const candidates = (nodeToShapes.get(curNode) || []).filter((s) => !visitedShapes.has(s.id));
      if (!candidates.length) break;
      const s = candidates[0];
      visitedShapes.add(s.id);
      const e = endsOf(s);
      if (!e) break;

      const forward = (curNode === e.na);
      const fromJid = forward ? e.a : e.b;
      const toJid = forward ? e.b : e.a;
      const nextNode = forward ? e.nb : e.na;

      const fromP = pos(fromJid), toP = pos(toJid);
      if (!fromP || !toP) break;

      if (!subpathStarted) {
        d += (d ? ' ' : '') + `M ${num(fromP.x)} ${num(fromP.y)}`;
        subpathStarted = true;
      }
      d += ' ' + curveKind(s).pathSeg(s, state, fromP, toP);
      curNode = nextNode;
    }
  }

  return d;
}


// polyToPathD(pts) → a CLOSED SVG path "d" from an ordered array of polygon points [{x, y}, ...].
export function polyToPathD(pts) {
  if (!Array.isArray(pts) || pts.length < 2) return '';
  let d = `M ${num(pts[0].x)} ${num(pts[0].y)}`;
  for (let i = 1; i < pts.length; i++) {
    d += ` L ${num(pts[i].x)} ${num(pts[i].y)}`;
  }
  return d + ' Z';
}
