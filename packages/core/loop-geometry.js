// packages/core/loop-geometry.js — loop boundary polygons + point-in-polygon CONTAINMENT. Lifted from
// apps/shaper/src/prepare-view.js (SKETCH-4a) so profile resolution / vcarve / joints can reuse the geometry.
//
// PURITY NOTE: `sampleArc` samples the TRUE rendered curve via the browser SVG path API (getPointAtLength), so
// `loopPolygon` for an ARC loop needs the DOM (degrades to the endpoints in Node). `loopPolygon` for LINE/CIRCLE
// loops, `polyArea`, `pointInPolygon`, and `polygonContains` are PURE (no DOM) and Node-oracle-tested. The export
// HOST can precompute loop polygons in the browser and pass them in to keep `shaper-export` pure.

import { calculateArcPath } from './geometry.js';
import { buildNodeMap } from './loop-finder.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const EPS = 1e-9;
const dist2 = (a, b) => { const dx = a.x - b.x, dy = a.y - b.y; return dx * dx + dy * dy; };

// Sample an arc shape into points (start→end) using the SAME path math the renderer uses (TRUE curve, not chord).
export function sampleArc(s, state, N = 24) {
  const [p1, p2, p3] = (s.joints || []).map((id) => state.joints.get(id));
  if (!p1 || !p2 || !p3) return [];
  const d = calculateArcPath(p1, p2, p3, s.subType, { largeArc: s.largeArc, sweep: s.sweep });
  if (typeof document === 'undefined' || !document.createElementNS) return [{ x: p1.x, y: p1.y }, { x: p3.x, y: p3.y }];
  const path = document.createElementNS(SVG_NS, 'path'); path.setAttribute('d', d);
  let len = 0; try { len = path.getTotalLength(); } catch (_) {}
  if (!len) return [{ x: p1.x, y: p1.y }, { x: p3.x, y: p3.y }];
  const pts = [];
  for (let i = 0; i <= N; i++) { try { const pt = path.getPointAtLength((i / N) * len); pts.push({ x: pt.x, y: pt.y }); } catch (_) {} }
  return pts;
}

// Boundary polygon (ordered world points) for a loop — straight for lines, sampled for arcs, around-the-rim for circles.
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
    if (s && s.type === 'arc') {
      let samples = sampleArc(s, state);
      if (samples.length && dist2(samples[samples.length - 1], fromPos) < dist2(samples[0], fromPos)) samples = samples.reverse();
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

// SKETCH-4a: does `outer` STRICTLY contain `inner` (non-touching nesting)? A representative inner point inside outer
// AND polyArea(inner) < polyArea(outer) AND no edge of inner crosses any edge of outer. Used by profile hole
// resolution (a profile with holes → an evenodd compound path).
export function polygonContains(outer, inner) {
  if (!Array.isArray(outer) || !Array.isArray(inner) || outer.length < 3 || inner.length < 3) return false;
  if (polyArea(inner) >= polyArea(outer)) return false;     // equal or larger → not strictly contained
  if (!pointInPolygon(outer, inner[0])) return false;        // a representative inner point inside outer
  const n = inner.length, m = outer.length;
  for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) {  // no crossing → strict, non-touching
    if (segsCross(inner[i], inner[(i + 1) % n], outer[j], outer[(j + 1) % m])) return false;
  }
  return true;
}

function num(n) {
  let r = Math.round(Number(n) * 1e4) / 1e4;
  if (Object.is(r, -0)) r = 0;
  return String(r);
}

function angleSweep(center, start, end) {
  let d = Math.atan2(end.y - center.y, end.x - center.x) - Math.atan2(start.y - center.y, start.x - center.x);
  while (d <= -Math.PI) d += 2 * Math.PI;
  while (d > Math.PI) d -= 2 * Math.PI;
  return d > 0 ? 1 : 0;
}

function arcSeg(shape, fromPos, toPos, state) {
  const center = state.joints.get(shape.joints[0]);
  const start = state.joints.get(shape.joints[1]);
  const end = state.joints.get(shape.joints[2]);
  if (!center || !start || !end) return `L ${num(toPos.x)} ${num(toPos.y)}`;
  const r = Math.hypot(start.x - center.x, start.y - center.y);
  const stored = (typeof shape.sweep === 'boolean') ? (shape.sweep ? 1 : 0) : angleSweep(center, start, end);
  const forward = Math.hypot(fromPos.x - start.x, fromPos.y - start.y) <= Math.hypot(fromPos.x - end.x, fromPos.y - end.y);
  const sweep = forward ? stored : (stored ? 0 : 1);
  const largeArc = shape.largeArc ? 1 : 0;
  return `A ${num(r)} ${num(r)} 0 ${largeArc} ${sweep} ${num(toPos.x)} ${num(toPos.y)}`;
}

// loopToPathD(loop, state) → a CLOSED SVG path "d" from the loop's ordered boundary (joints[] + edges[]). Lines →
// `L x y`; arcs → a direction-aware `A …` segment; single-circle loops → two `A r r` half-arcs + `Z`. A line CLOSING
// edge is left to Z (so a pure-line loop is identical to SP1j-1); an arc closing edge is drawn explicitly. Returns ''
// on a missing loop / joint position.
export function loopToPathD(loop, state) {
  if (!loop || !Array.isArray(loop.joints) || !state || !state.joints) return '';
  const shapeById = new Map((state.shapes || []).map((s) => [s.id, s]));
  const edges = Array.isArray(loop.edges) ? loop.edges : [];
  if (edges.length === 1) {
    const s = shapeById.get(edges[0]);
    if (s && s.type === 'circle') {
      const cid = (Array.isArray(s.joints) && s.joints[0]) || loop.joints[0];
      const c = cid ? state.joints.get(cid) : null;
      const r = Number(s.radius) || 0;
      if (!c || !(r > 0)) return '';
      return `M ${num(c.x - r)} ${num(c.y)} A ${num(r)} ${num(r)} 0 1 0 ${num(c.x + r)} ${num(c.y)} A ${num(r)} ${num(r)} 0 1 0 ${num(c.x - r)} ${num(c.y)} Z`;
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
    const s = shapeById.get(edges[i - 1]);
    d += ' ' + (s && s.type === 'arc' ? arcSeg(s, fromP, toP, state) : `L ${num(toP.x)} ${num(toP.y)}`);
  }
  const closing = shapeById.get(edges[n - 1]);
  if (closing && closing.type === 'arc') {
    const fromP = pos(loop.joints[n - 1]);
    if (fromP) d += ' ' + arcSeg(closing, fromP, p0, state);
  }
  return d + ' Z';
}

// chainToPathD(chain, state) → an OPEN SVG path "d" from an open chain of shapes (lines/arcs).
// Orders the chain's shapes end to end, emitting `M x y` then `L x y` for lines and direction-aware `arcSeg`
// for arcs. No Z. Reuses arcSeg directly.
export function chainToPathD(chain, state) {
  if (!chain || !state || !state.joints) return '';
  const shapeById = new Map((state.shapes || []).map((s) => [s.id, s]));
  const shapes = Array.isArray(chain.shapes)
    ? chain.shapes
    : (Array.isArray(chain.edges) ? chain.edges.map((id) => shapeById.get(id)).filter(Boolean) : []);
  if (!shapes.length) return '';

  const node = buildNodeMap(state);
  const pos = (jid) => state.joints.get(jid);
  const endsOf = (s) => {
    if (!s || !Array.isArray(s.joints)) return null;
    if (s.type === 'line' && s.joints.length >= 2) return { a: s.joints[0], b: s.joints[1], na: node(s.joints[0]), nb: node(s.joints[1]) };
    if (s.type === 'arc' && s.joints.length >= 3) return { a: s.joints[1], b: s.joints[2], na: node(s.joints[1]), nb: node(s.joints[2]) };
    return null;
  };

  if (shapes.length === 1) {
    const s = shapes[0];
    const e = endsOf(s);
    if (!e) return '';
    const pa = pos(e.a), pb = pos(e.b);
    if (!pa || !pb) return '';
    const seg = (s.type === 'arc') ? arcSeg(s, pa, pb, state) : `L ${num(pb.x)} ${num(pb.y)}`;
    return `M ${num(pa.x)} ${num(pa.y)} ${seg}`;
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
      const seg = (s.type === 'arc') ? arcSeg(s, fromP, toP, state) : `L ${num(toP.x)} ${num(toP.y)}`;
      d += ' ' + seg;
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
