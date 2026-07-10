// packages/core/core-shape-to-polyline.js — the SEAM (PP-7b): flatten a SOLVED #core sketch shape into a polyline
// (a list of [x, y] world points), so #core constraint geometry can flow into a downstream consumer. The pen
// plotter uses it to BAKE a solved sketch into an art layer, which the existing Draw/Fill/Toolpath/Export pipeline
// then carries to G-code. App-agnostic, purely additive #core (imports only #core/loop-geometry).
//
// PURITY: line + circle are PURE (no DOM). Arc REUSES the existing #core arc sampler (loop-geometry.sampleArc) —
// north star #2: reuse, NEVER hand-roll a 2nd sampler. sampleArc samples the TRUE rendered curve via the browser
// SVG path API (getPointAtLength); in Node (no DOM) it degrades to the arc's endpoints. This module adds NO new DOM
// code and NO second sampler of its own.

import { sampleArc } from './loop-geometry.js';

const CIRCLE_SEGMENTS = 64; // full-circle rim resolution (a plotter draws a circle as a fine polygon)

// shape  — a #core shape: { type:'line'|'circle'|'arc', joints:[jointId...], radius?, subType?, largeArc?, sweep? }.
// joints — the sketch's joint Map (id -> { x, y }), i.e. state.joints.
// opts   — { circleSegments?, arcSegments? } (defaults 64 / 24).
// Returns [[x,y], ...] (>= 2 points), or [] if the shape can't be resolved.
export function coreShapeToPolyline(shape, joints, opts = {}) {
  if (!shape || !joints || !Array.isArray(shape.joints)) return [];
  const J = (id) => joints.get(id);
  switch (shape.type) {
    case 'line': {
      const a = J(shape.joints[0]), b = J(shape.joints[1]);
      if (!a || !b) return [];
      return [[a.x, a.y], [b.x, b.y]];
    }
    case 'circle': {
      const c = J(shape.joints[0]);
      const r = (typeof shape.radius === 'number' && shape.radius > 0) ? shape.radius : 0;
      if (!c || !r) return [];
      const n = opts.circleSegments || CIRCLE_SEGMENTS;
      const pts = [];
      for (let i = 0; i <= n; i++) { const t = (i / n) * 2 * Math.PI; pts.push([c.x + r * Math.cos(t), c.y + r * Math.sin(t)]); }
      return pts; // closed: last point == first
    }
    case 'arc': {
      // Reuse the EXISTING #core arc sampler (true curve in the browser, endpoints in Node). Pass a minimal
      // { joints } state — that's all sampleArc reads.
      const samples = sampleArc(shape, { joints }, opts.arcSegments || 24);
      return samples.map((p) => [p.x, p.y]);
    }
    default:
      return [];
  }
}
