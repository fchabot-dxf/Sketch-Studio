// Shaper Prepare view — a Prepare-LOCAL render of the shared #core sketch + LOOP hover-highlight (SP1a + SP1c).
// Draws the EDGES (lines/arcs/circles) from the SHARED designController.state — NO joints — then finds the
// topological LOOPS (#core/loop-finder) once on mount and, on mousemove, highlights the loop under the cursor
// (point-in-loop; smallest-area on overlap). Render-on-demand: no RAF — the highlight redraws only on hover-CHANGE.
// It does NOT call the shared `#ui/svg-renderer.draw()` (which draws joints + is SketchStudio's), so the shared
// renderer stays byte-identical.

import { calculateArcPath } from '#core/geometry.js';
import { findLoops } from '#core/loop-finder.js';
import { cutTypeById, defaultCutRecord, availableTypes } from './shaper.js'; // SP1f: cut-type declarations + gating

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
// SP1e: an 'edge' (vector) highlight is a glowing STROKE overlay following the true geometry — visually distinct
// from the loop FILLS (loop = filled region; edge = thick stroke).
const EDGE_HOVER_STYLE = 'fill:none; stroke:var(--sk-hover, #7aa7e0); stroke-width:3.5; stroke-opacity:0.85; vector-effect:non-scaling-stroke; stroke-linecap:round; stroke-linejoin:round;';
const EDGE_SELECT_STYLE = 'fill:none; stroke:var(--sk-selection, #4c9aff); stroke-width:4; stroke-opacity:1; vector-effect:non-scaling-stroke; stroke-linecap:round; stroke-linejoin:round;';
const EDGE_TOL_PX = 6; // on-stroke hit tolerance, in SCREEN px (converted to world per-call → zoom-stable)

// World-space tolerance from screen px, derived from the live CTM scale (zoom-stable).
function worldTolerance(svgEl, screenPx) {
  try { const ctm = svgEl.getScreenCTM && svgEl.getScreenCTM(); if (ctm) { const sx = Math.hypot(ctm.a, ctm.b); if (sx > 0) return screenPx / sx; } } catch (_) {}
  return screenPx;
}
// point → segment distance (world units)
function distPointSeg(p, a, b) {
  const vx = b.x - a.x, vy = b.y - a.y, wx = p.x - a.x, wy = p.y - a.y;
  const len2 = vx * vx + vy * vy; let t = len2 > 0 ? (wx * vx + wy * vy) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy));
}
// distance from a world point to a precomputed edge-hit struct (line: segment; circle: |d−r|; arc: nearest sample seg)
function edgeDistAt(h, pt) {
  if (h.kind === 'seg') return distPointSeg(pt, h.a, h.b);
  if (h.kind === 'circle') return Math.abs(Math.hypot(pt.x - h.c.x, pt.y - h.c.y) - h.r);
  if (h.kind === 'poly') { let best = Infinity; for (let i = 0; i < h.samples.length - 1; i++) best = Math.min(best, distPointSeg(pt, h.samples[i], h.samples[i + 1])); return best; }
  return Infinity;
}
// edge highlight markup — the TRUE geometry as a stroke (reuses the renderer's path builders / calculateArcPath)
function edgeStrokeMarkup(s, state, style) {
  const J = state.joints;
  if (s.type === 'line') { const a = J.get(s.joints[0]), b = J.get(s.joints[1]); return (a && b) ? `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" style="${style}"/>` : ''; }
  if (s.type === 'circle') { const c = J.get(s.joints[0]); const r = (s.radius > 0) ? s.radius : 0; return (c && r) ? `<circle cx="${c.x}" cy="${c.y}" r="${r}" fill="none" style="${style}"/>` : ''; }
  if (s.type === 'arc') { const [p1, p2, p3] = (s.joints || []).map((id) => J.get(id)); return (p1 && p2 && p3) ? `<path d="${calculateArcPath(p1, p2, p3, s.subType, { largeArc: s.largeArc, sweep: s.sweep })}" fill="none" style="${style}"/>` : ''; }
  return '';
}

// ── Cut plan (SP1f): per-target cut assignments keyed by `${kind}:${id}`. Module-level so it PERSISTS across
// Prepare re-mounts (Design↔Prepare, re-enter) — loop ids are deterministic (SP1b) + edge ids are stable. ──
const keyOf = (kind, id) => kind + ':' + id;
const parseKey = (key) => { const i = key.indexOf(':'); return { kind: key.slice(0, i), id: key.slice(i + 1) }; };
const CUT_PLAN = new Map();
function getCutRecord(key) { return CUT_PLAN.get(key) || defaultCutRecord(); }
function setFieldFor(key, field, value) { const rec = CUT_PLAN.get(key) || defaultCutRecord(); rec[field] = value; CUT_PLAN.set(key, rec); return rec; }

// ── Mount: render edges + compute loops + wire kind-aware hover + click-to-select + cut-plan preview ──
export function mountPrepareView(state, svgEl, opts = {}) {
  if (!state || !svgEl) return { loops: [], selection: new Map(), destroy() {} };
  const onSelectionChange = opts.onSelectionChange || (() => {});
  svgEl.innerHTML = ''; // clean re-mount
  // z-order (later = on top): cut preview (behind) < selected < hover < edges (on top). Joints stay hidden.
  const cutG = mkGroup('prepare-cut-group');       svgEl.appendChild(cutG);
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
  const targetKey = (t) => keyOf(t.kind, t.id);

  // Precompute per-edge hit geometry once (Prepare geometry is static) — lines/circles analytic, arcs sampled.
  const edgeHits = (state.shapes || []).map((s) => {
    if (s.type === 'line') { const a = state.joints.get(s.joints[0]), b = state.joints.get(s.joints[1]); return (a && b) ? { id: s.id, kind: 'seg', a, b } : null; }
    if (s.type === 'circle') { const c = state.joints.get(s.joints[0]); const r = (s.radius > 0) ? s.radius : 0; return (c && r) ? { id: s.id, kind: 'circle', c, r } : null; }
    if (s.type === 'arc') { const samples = sampleArc(s, state, 32); return (samples.length >= 2) ? { id: s.id, kind: 'poly', samples } : null; }
    return null;
  }).filter(Boolean);

  // KIND-AWARE dispatcher: cursor → target. The user's PROXIMITY rule — ON the ink → the EDGE (vector);
  // in the open interior → the LOOP.
  function resolveTarget(worldPt) {
    // EDGE first: the nearest shape stroke within tolerance WINS over the loop (makes OPEN paths selectable too).
    const tol = worldTolerance(svgEl, EDGE_TOL_PX);
    let bestEdge = null, bestDist = tol;
    for (const h of edgeHits) { const d = edgeDistAt(h, worldPt); if (d <= bestDist) { bestDist = d; bestEdge = h; } }
    if (bestEdge) return { kind: 'edge', id: bestEdge.id };
    // else LOOP: the innermost (smallest-area) loop whose boundary polygon contains the point.
    let best = null;
    for (const l of loops) if (l.polygon.length >= 3 && pointInPoly(l.polygon, worldPt) && (!best || l.area < best.area)) best = l;
    return best ? { kind: 'loop', id: best.id } : null;
  }

  // ONE render path, branched by kind: loop → filled region; edge → glowing stroke overlay (true geometry).
  const targetMarkup = (t, loopStyle, edgeStyle) => {
    if (!t) return '';
    if (t.kind === 'loop') { const l = loopById.get(t.id); return (l && l.polygon.length >= 3) ? polyMarkup(l.polygon, loopStyle) : ''; }
    if (t.kind === 'edge') { const s = shapeById.get(t.id); return s ? edgeStrokeMarkup(s, state, edgeStyle) : ''; }
    return '';
  };

  // SP1f: persistent cut-plan preview — every assigned target painted in its dark-canvas preview color
  // (loop → filled region; edge → colored stroke). Re-read from CUT_PLAN on mount + whenever a cut changes.
  const renderCuts = () => {
    let out = '';
    for (const [key, rec] of CUT_PLAN) {
      if (!rec || !rec.cutType) continue;
      const ct = cutTypeById(rec.cutType); if (!ct) continue;
      const { kind, id } = parseKey(key);
      if (kind === 'loop' ? !loopById.has(id) : !shapeById.has(id)) continue; // only targets present in THIS view
      const loopStyle = `fill:${ct.previewFill}; fill-opacity:0.45; stroke:${ct.previewStroke}; stroke-width:1.25; stroke-opacity:0.75; vector-effect:non-scaling-stroke; stroke-linejoin:round;`;
      const edgeStyle = `fill:none; stroke:${ct.previewStroke}; stroke-width:3; stroke-opacity:0.9; vector-effect:non-scaling-stroke; stroke-linecap:round; stroke-linejoin:round;`;
      out += targetMarkup({ kind, id }, loopStyle, edgeStyle);
    }
    cutG.innerHTML = out;
  };

  const renderSelection = () => {
    let out = '';
    for (const t of selection.values()) out += targetMarkup(t, SELECT_STYLE, EDGE_SELECT_STYLE);
    selectG.innerHTML = out;
  };
  let hovered = null; // current hovered target { kind, id } | null
  const renderHover = () => {
    // Show the hover highlight UNLESS that target is already selected (selected style wins — no double-draw).
    hoverG.innerHTML = (hovered && !selection.has(targetKey(hovered))) ? targetMarkup(hovered, HOVER_STYLE, EDGE_HOVER_STYLE) : '';
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
    onSelectionChange(t || null);            // notify the cut panel (selected target | null)
  };
  svgEl.addEventListener('pointermove', onMove);
  svgEl.addEventListener('pointerleave', onLeave);
  svgEl.addEventListener('pointerdown', onDown);

  renderCuts(); // paint any cut plan persisted from a prior visit

  const selectedTarget = () => [...selection.values()][0] || null;
  return {
    loops, selection, resolveTarget, selectedTarget,
    recordFor: (t) => (t ? getCutRecord(targetKey(t)) : null),
    availableTypesFor: (t) => (t ? availableTypes(t.kind) : []),
    // Write the cut type onto the current single selection + repaint the cut layer (panel calls this).
    applyCutTypeToSelected(cutType) { const t = selectedTarget(); if (!t) return null; const rec = setFieldFor(targetKey(t), 'cutType', cutType); renderCuts(); return rec; },
    // SP1g: persist a numeric field (cutDepth / cutOffset / toolDia) on the selection. No recolor — those fields
    // drive the LATER tool-aware look (SP1h), not SP1f's cut color.
    setFieldOnSelected(field, value) { const t = selectedTarget(); if (!t) return null; return setFieldFor(targetKey(t), field, value); },
    destroy() {
      svgEl.removeEventListener('pointermove', onMove);
      svgEl.removeEventListener('pointerleave', onLeave);
      svgEl.removeEventListener('pointerdown', onDown);
    },
  };
}
