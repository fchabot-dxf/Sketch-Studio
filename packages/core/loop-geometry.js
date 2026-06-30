// packages/core/loop-geometry.js — loop boundary polygons + point-in-polygon CONTAINMENT. Lifted from
// apps/shaper/src/prepare-view.js (SKETCH-4a) so ISLANDS (S-4d) / vcarve / joints can reuse the geometry.
//
// PURITY NOTE: `sampleArc` samples the TRUE rendered curve via the browser SVG path API (getPointAtLength), so
// `loopPolygon` for an ARC loop needs the DOM (degrades to the endpoints in Node). `loopPolygon` for LINE/CIRCLE
// loops, `polyArea`, `pointInPolygon`, and `polygonContains` are PURE (no DOM) and Node-oracle-tested. (S-4d keeps
// `shaper-export` pure by having the export HOST compute the loop polygons and pass them in.)

import { calculateArcPath } from './geometry.js';

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
// AND polyArea(inner) < polyArea(outer) AND no edge of inner crosses any edge of outer. Used by the island detector
// (a loop-with-a-hole → an evenodd compound path).
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
