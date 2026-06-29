// Shaper Prepare view — a Prepare-LOCAL render of the shared #core sketch + LOOP hover-highlight (SP1a + SP1c).
// Draws the EDGES (lines/arcs/circles) from the SHARED designController.state — NO joints — then finds the
// topological LOOPS (#core/loop-finder) once on mount and, on mousemove, highlights the loop under the cursor
// (point-in-loop; smallest-area on overlap). Render-on-demand: no RAF — the highlight redraws only on hover-CHANGE.
// It does NOT call the shared `#ui/svg-renderer.draw()` (which draws joints + is SketchStudio's), so the shared
// renderer stays byte-identical.

import { calculateArcPath } from '#core/geometry.js';
import { findLoops } from '#core/loop-finder.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const EDGE_STYLE = 'fill:none; stroke:var(--sk-geo-free, #7aa7e0); stroke-width:1.5; vector-effect:non-scaling-stroke; stroke-linecap:round;';

// ── Edge render (SP1a) ───────────────────────────────────────────────────────
function edgesMarkup(state) {
  const J = state.joints, out = [];
  for (const s of (state.shapes || [])) {
    if (s.type === 'line') {
      const a = s.joints && J.get(s.joints[0]); const b = s.joints && J.get(s.joints[1]);
      if (a && b) out.push(`<line data-shape-id="${s.id}" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" style="${EDGE_STYLE}"/>`);
    } else if (s.type === 'circle') {
      const c = s.joints && J.get(s.joints[0]); const r = (typeof s.radius === 'number' && s.radius > 0) ? s.radius : 0;
      if (c && r) out.push(`<circle data-shape-id="${s.id}" cx="${c.x}" cy="${c.y}" r="${r}" style="${EDGE_STYLE}"/>`);
    } else if (s.type === 'arc') {
      const [p1, p2, p3] = (s.joints || []).map((id) => J.get(id));
      if (p1 && p2 && p3) out.push(`<path data-shape-id="${s.id}" d="${calculateArcPath(p1, p2, p3, s.subType, { largeArc: s.largeArc, sweep: s.sweep })}" style="${EDGE_STYLE}"/>`);
    }
  }
  return out.join('');
}

export function renderPrepareGeometry(state, svgEl) {
  if (!state || !svgEl) return null;
  let g = svgEl.querySelector('#prepare-world-group');
  if (!g) { g = document.createElementNS(SVG_NS, 'g'); g.id = 'prepare-world-group'; svgEl.appendChild(g); }
  g.innerHTML = edgesMarkup(state);
  return g;
}

// ── Loop boundary polygons (for hit-test + true-curve outline) ────────────────
const dist2 = (a, b) => { const dx = a.x - b.x, dy = a.y - b.y; return dx * dx + dy * dy; };

// Sample an arc shape into points (start→end) using the SAME path math the renderer uses (TRUE curve, not chord).
function sampleArc(s, state, N = 24) {
  const [p1, p2, p3] = (s.joints || []).map((id) => state.joints.get(id));
  if (!p1 || !p2 || !p3) return [];
  const d = calculateArcPath(p1, p2, p3, s.subType, { largeArc: s.largeArc, sweep: s.sweep });
  const path = document.createElementNS(SVG_NS, 'path'); path.setAttribute('d', d);
  let len = 0; try { len = path.getTotalLength(); } catch (_) {}
  if (!len) return [{ x: p1.x, y: p1.y }, { x: p3.x, y: p3.y }];
  const pts = [];
  for (let i = 0; i <= N; i++) { try { const pt = path.getPointAtLength((i / N) * len); pts.push({ x: pt.x, y: pt.y }); } catch (_) {} }
  return pts;
}

// Boundary polygon (ordered world points) for a loop — straight for lines, sampled for arcs, around-the-rim for circles.
function loopPolygon(loop, state, shapeById) {
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

function polyArea(poly) { let a = 0; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += poly[j].x * poly[i].y - poly[i].x * poly[j].y; return Math.abs(a / 2); }
function pointInPoly(poly, p) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (((a.y > p.y) !== (b.y > p.y)) && (p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x)) inside = !inside;
  }
  return inside;
}

function clientToWorld(svgEl, cx, cy) {
  try {
    const ctm = svgEl.getScreenCTM && svgEl.getScreenCTM();
    if (ctm && svgEl.createSVGPoint) { const pt = svgEl.createSVGPoint(); pt.x = cx; pt.y = cy; const w = pt.matrixTransform(ctm.inverse()); return { x: w.x, y: w.y }; }
  } catch (_) {}
  return null;
}

const SVG_NS_G = SVG_NS;
const mkGroup = (id) => { const g = document.createElementNS(SVG_NS_G, 'g'); g.id = id; return g; };
const polyMarkup = (poly, style) => `<polygon points="${poly.map((p) => p.x + ',' + p.y).join(' ')}" style="${style}"/>`;
// Hover = LIGHT fill; Selected = STRONGER fill + a solid outline in the selection var — visually distinct (SP1d).
const HOVER_STYLE = 'fill:var(--sk-hover, #7aa7e0); fill-opacity:0.16; stroke:var(--sk-hover, #7aa7e0); stroke-width:1.5; stroke-opacity:0.6; vector-effect:non-scaling-stroke; stroke-linejoin:round;';
const SELECT_STYLE = 'fill:var(--sk-selection, #4c9aff); fill-opacity:0.30; stroke:var(--sk-selection, #4c9aff); stroke-width:2.5; stroke-opacity:1; vector-effect:non-scaling-stroke; stroke-linejoin:round;';

// ── Mount: render edges + compute loops + wire kind-aware hover + click-to-select ──
export function mountPrepareView(state, svgEl) {
  if (!state || !svgEl) return { loops: [], selection: new Map(), destroy() {} };
  svgEl.innerHTML = ''; // clean re-mount
  // z-order (later = on top): selected (behind) < hover < edges (on top). Joints stay hidden.
  const selectG = mkGroup('prepare-select-group'); svgEl.appendChild(selectG);
  const hoverG = mkGroup('prepare-hover-group');   svgEl.appendChild(hoverG);
  renderPrepareGeometry(state, svgEl);

  const shapeById = new Map((state.shapes || []).map((s) => [s.id, s]));
  const loops = findLoops(state).map((l) => { const polygon = loopPolygon(l, state, shapeById); return { ...l, polygon, area: polyArea(polygon) }; });
  const loopById = new Map(loops.map((l) => [l.id, l]));

  // SP1d — DECLARED selection model. A target is { kind: 'loop' | 'edge', id }. The selection is a COLLECTION keyed
  // by `${kind}:${id}` — single-select BEHAVIOR this slice, but the Map shape is forward-safe for multi-select
  // (shift-click) and for the 'edge' kind (SP1e). 'edge' is declared in the union but not yet resolvable.
  const selection = new Map(); // key -> { kind, id }
  const targetKey = (t) => t.kind + ':' + t.id;

  // KIND-AWARE dispatcher: cursor → target. ONE seam for both kinds.
  function resolveTarget(worldPt) {
    // SP1e SEAM — the on-stroke 'edge' branch goes HERE, FIRST: if the cursor is within stroke tolerance of a
    // vector (an open path, or a loop's edge), return { kind: 'edge', id: shapeId } — edge WINS over loop. The
    // proximity rule (on the stroke → edge; in the open interior → loop) lives here. Not built this slice.
    // TODAY — LOOP kind only: the innermost (smallest-area) loop whose boundary polygon contains the point.
    let best = null;
    for (const l of loops) if (l.polygon.length >= 3 && pointInPoly(l.polygon, worldPt) && (!best || l.area < best.area)) best = l;
    return best ? { kind: 'loop', id: best.id } : null;
  }

  // Resolve a target → its renderable boundary polygon (only the 'loop' kind has one today).
  const polyOf = (t) => (t && t.kind === 'loop') ? loopById.get(t.id) : null;

  const renderSelection = () => {
    let out = '';
    for (const t of selection.values()) { const l = polyOf(t); if (l && l.polygon.length >= 3) out += polyMarkup(l.polygon, SELECT_STYLE); }
    selectG.innerHTML = out;
  };
  let hovered = null; // current hovered target { kind, id } | null
  const renderHover = () => {
    // Show the hover outline UNLESS that target is already selected (selected style wins — no double-draw).
    const l = (hovered && !selection.has(targetKey(hovered))) ? polyOf(hovered) : null;
    hoverG.innerHTML = (l && l.polygon.length >= 3) ? polyMarkup(l.polygon, HOVER_STYLE) : '';
  };

  const setHover = (t) => {
    const k = t ? targetKey(t) : null, pk = hovered ? targetKey(hovered) : null;
    if (k !== pk) { hovered = t; renderHover(); } // redraw on hover-CHANGE only
  };
  const onMove = (e) => { const wp = clientToWorld(svgEl, e.clientX, e.clientY); if (!wp) return; setHover(resolveTarget(wp)); };
  const onLeave = () => setHover(null);
  const onDown = (e) => {
    const wp = clientToWorld(svgEl, e.clientX, e.clientY); if (!wp) return;
    const t = resolveTarget(wp);
    selection.clear();                       // single-select BEHAVIOR (shift-click multi-select is a later slice)
    if (t) selection.set(targetKey(t), t);   // click empty → cleared selection
    renderSelection(); renderHover();        // redraw on selection-CHANGE; refresh hover (a now-selected loop drops its hover)
  };
  svgEl.addEventListener('pointermove', onMove);
  svgEl.addEventListener('pointerleave', onLeave);
  svgEl.addEventListener('pointerdown', onDown);

  return {
    loops, selection, resolveTarget,
    destroy() {
      svgEl.removeEventListener('pointermove', onMove);
      svgEl.removeEventListener('pointerleave', onLeave);
      svgEl.removeEventListener('pointerdown', onDown);
    },
  };
}
