// Shaper Prepare view — a lightweight, Prepare-LOCAL render of the shared #core sketch geometry (SP1a).
// Draws the EDGES (lines / arcs / circles) from the SHARED designController.state — and NO joints (in Prepare the
// selection unit is a closed LOOP, not a joint). It deliberately does NOT call the shared `#ui/svg-renderer.draw()`
// (which draws joints + is SketchStudio's renderer), so the shared renderer stays byte-identical. Render-on-demand:
// the sketch is already solved in Design, so this just paints the current geometry when Prepare is shown.

import { calculateArcPath } from '#core/geometry.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

// Edge stroke — themed to Shaper's dark palette (--sk-geo-free), a consistent screen width via non-scaling-stroke.
const EDGE_STYLE = 'fill:none; stroke:var(--sk-geo-free, #7aa7e0); stroke-width:1.5; vector-effect:non-scaling-stroke; stroke-linecap:round;';

// Build the edge markup for state.shapes (NO joints). Positions are read from state.joints (the solved sketch).
function edgesMarkup(state) {
  const joints = state.joints;
  const out = [];
  for (const s of (state.shapes || [])) {
    if (s.type === 'line') {
      const a = s.joints && joints.get(s.joints[0]);
      const b = s.joints && joints.get(s.joints[1]);
      if (!a || !b) continue;
      out.push(`<line data-shape-id="${s.id}" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" style="${EDGE_STYLE}"/>`);
    } else if (s.type === 'circle') {
      const c = s.joints && joints.get(s.joints[0]);
      const r = (typeof s.radius === 'number' && s.radius > 0) ? s.radius : 0;
      if (!c || !r) continue;
      out.push(`<circle data-shape-id="${s.id}" cx="${c.x}" cy="${c.y}" r="${r}" style="${EDGE_STYLE}"/>`);
    } else if (s.type === 'arc') {
      const [p1, p2, p3] = (s.joints || []).map((id) => joints.get(id));
      if (!p1 || !p2 || !p3) continue;
      const d = calculateArcPath(p1, p2, p3, s.subType, { largeArc: s.largeArc, sweep: s.sweep });
      out.push(`<path data-shape-id="${s.id}" d="${d}" style="${EDGE_STYLE}"/>`);
    }
  }
  return out.join('');
}

// Render (or re-render) the Prepare geometry into svgEl, inside a #prepare-world-group. Edges only — no joints.
export function renderPrepareGeometry(state, svgEl) {
  if (!state || !svgEl) return null;
  let g = svgEl.querySelector('#prepare-world-group');
  if (!g) { g = document.createElementNS(SVG_NS, 'g'); g.id = 'prepare-world-group'; svgEl.appendChild(g); }
  g.innerHTML = edgesMarkup(state);
  return g;
}
