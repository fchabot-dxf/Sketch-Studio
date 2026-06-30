// Shaper Prepare view — a Prepare-LOCAL render of the shared #core sketch + LOOP hover-highlight (SP1a + SP1c).
// Draws the EDGES (lines/arcs/circles) from the SHARED designController.state — NO joints — then finds the
// topological LOOPS (#core/loop-finder) once on mount and, on mousemove, highlights the loop under the cursor
// (point-in-loop; smallest-area on overlap). Render-on-demand: no RAF — the highlight redraws only on hover-CHANGE.
// It does NOT call the shared `#ui/svg-renderer.draw()` (which draws joints + is SketchStudio's), so the shared
// renderer stays byte-identical.

import { calculateArcPath } from '#core/geometry.js';
import { findLoops } from '#core/loop-finder.js';
import { cutTypeById, availableTypes } from './shaper.js'; // SP1f: cut-type declarations + gating
import { keyOf, parseKey, CUT_PLAN, getCutRecord, setFieldFor } from './cut-plan.js'; // SP1j-4: shared cut-plan store
import { offsetPolygon } from '#core/polygon-offset.js'; // SP1h2/h5/h6: offset toolpaths + tool-center pocket inset
import { format as fmtUnit } from '#core/units.js'; // SP1h4: pocket depth label in the document unit
import SettingsManager from '#core/settings-manager.js'; // SP1h4: read DOC_UNIT for the depth label
import { sampleArc, loopPolygon, polyArea, pointInPolygon } from '#core/loop-geometry.js'; // SKETCH-4a: lifted to #core

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

// ── Loop boundary polygons + hit-test — LIFTED to #core/loop-geometry.js (SKETCH-4a); re-imported above. ──

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
// SP1h4 (pocket): area-weighted centroid for label placement (vertex-average fallback for a near-degenerate ring).
function polyCentroid(poly) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const f = poly[j].x * poly[i].y - poly[i].x * poly[j].y;
    a += f; cx += (poly[j].x + poly[i].x) * f; cy += (poly[j].y + poly[i].y) * f;
  }
  if (Math.abs(a) < 1e-9) return poly.reduce((s, p) => ({ x: s.x + p.x / poly.length, y: s.y + p.y / poly.length }), { x: 0, y: 0 });
  return { x: cx / (3 * a), y: cy / (3 * a) };
}
// SP1h4: pocket depth → a ↓-prefixed label in the document unit (export form, e.g. '↓ 0.500in'). 'unset' → no label.
const pocketDepthLabel = (cutDepth) => {
  const v = Number(cutDepth);
  if (cutDepth == null || cutDepth === 'unset' || !Number.isFinite(v)) return '';
  return '↓ ' + fmtUnit(v, SettingsManager.get('DOC_UNIT') || 'mm', { unit: true });
};
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

// ── Cut plan (SP1f; extracted to ./cut-plan.js in SP1j-4): the per-target store + its keyOf/getCutRecord/setFieldFor
// now live in a shared module read by BOTH this look AND the SVG exporter. Behaviour unchanged — same Map. ──

// ── Mount: render edges + compute loops + wire kind-aware hover + click-to-select + cut-plan preview ──
export function mountPrepareView(state, svgEl, opts = {}) {
  if (!state || !svgEl) return { loops: [], selection: new Map(), destroy() {} };
  const onSelectionChange = opts.onSelectionChange || (() => {});
  svgEl.innerHTML = ''; // clean re-mount
  // SP1h4: a diagonal HATCH pattern (pocket preview colour) for the cleared region. userSpaceOnUse → world-unit
  // spacing (scales with the geometry). One <defs> per mount; referenced by the pocket cleared-region fill.
  const defs = document.createElementNS(SVG_NS, 'defs');
  const pocketCt = cutTypeById('pocket');
  const hatchColor = (pocketCt && pocketCt.previewStroke) || '#5fb87a';
  defs.innerHTML = `<pattern id="prepare-pocket-hatch" patternUnits="userSpaceOnUse" width="3.2" height="3.2" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="3.2" style="stroke:${hatchColor}; stroke-width:0.7; stroke-opacity:0.85;"/></pattern>`;
  svgEl.appendChild(defs);
  // z-order (later = on top): cut TINT (behind) < edges < toolpath (tool-aware look) < selected < hover. Joints hidden.
  const cutG = mkGroup('prepare-cut-group');           svgEl.appendChild(cutG);
  renderPrepareGeometry(state, svgEl);                 // edges — above the cut tint
  const toolpathG = mkGroup('prepare-toolpath-group'); svgEl.appendChild(toolpathG); // SP1h: tool-aware look (above edges)
  const selectG = mkGroup('prepare-select-group');     svgEl.appendChild(selectG);
  const hoverG = mkGroup('prepare-hover-group');       svgEl.appendChild(hoverG);

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
    for (const l of loops) if (l.polygon.length >= 3 && pointInPolygon(l.polygon, worldPt) && (!best || l.area < best.area)) best = l;
    return best ? { kind: 'loop', id: best.id } : null;
  }

  // ONE render path, branched by kind: loop → filled region; edge → glowing stroke overlay (true geometry).
  const targetMarkup = (t, loopStyle, edgeStyle) => {
    if (!t) return '';
    if (t.kind === 'loop') { const l = loopById.get(t.id); return (l && l.polygon.length >= 3) ? polyMarkup(l.polygon, loopStyle) : ''; }
    if (t.kind === 'edge') { const s = shapeById.get(t.id); return s ? edgeStrokeMarkup(s, state, edgeStyle) : ''; }
    return '';
  };

  // SP1h5: per-target cut LOOK = the CUTTER PATH, cached by (cutType,toolDia,cutOffset,cutDepth,docUnit). Every CUTTING
  // type renders a tool-WIDTH BAND (the kerf — stroke-width = toolDia in WORLD units) + a dashed CENTERLINE (the
  // tool-center path) in the type's preview colour: ON-LINE on the path; OUTSIDE/INSIDE on the boundary offset by
  // toolDia/2 ± cutOffset (the band straddles the boundary). GUIDE = a dashed reference (NO band — not a cut). POCKET =
  // a hatch-filled cleared region (the ONLY fill, in the cut layer) + a depth label. NO flat region tint anymore.
  const lookCache = new Map(); // targetKey → { sig, region, path }
  const sigOf = (rec) => `${rec.cutType}|${rec.toolDia}|${rec.cutOffset}|${rec.cutDepth}|${SettingsManager.get('DOC_UNIT')}`;
  const computeLook = (key, rec) => {
    const { kind, id } = parseKey(key);
    if (kind === 'loop' ? !loopById.has(id) : !shapeById.has(id)) return { region: '', path: '' }; // only THIS view's targets
    const ct = rec && rec.cutType ? cutTypeById(rec.cutType) : null;
    if (!ct) return { region: '', path: '' };
    const t = { kind, id };
    const color = ct.previewStroke;
    const toolDia = Number(rec.toolDia) || 0;
    // shared cutter-path look: a semi-transparent BAND (world-unit kerf) + a dashed CENTERLINE (zoom-stable).
    const bandStyle = `fill:none; stroke:${color}; stroke-width:${toolDia}; stroke-opacity:0.28; stroke-linejoin:round; stroke-linecap:round;`;
    const centerStyle = `fill:none; stroke:${color}; stroke-width:1.5; stroke-opacity:0.95; vector-effect:non-scaling-stroke; stroke-dasharray:5 3; stroke-linejoin:round; stroke-linecap:round;`;
    const bandAndCenter = (poly) => (toolDia > 0 ? polyMarkup(poly, bandStyle) : '') + polyMarkup(poly, centerStyle);

    if (ct.targetKind === 'region') { // loop-only (gating) — OUTSIDE / INSIDE / POCKET
      const l = (kind === 'loop') ? loopById.get(id) : null;
      if (!l || l.polygon.length < 3) return { region: '', path: '' };
      if (ct.id === 'pocket') {
        // POCKET (SP1h6) = the TOOL-CENTER reachable region = the loop INSET by toolDia/2 (+ cutOffset). The hatch
        // fills only UP TO the tool centre, leaving a toolDia/2 margin to the wall (the bit centre can't get closer).
        // The ONLY fill — a hatch in the CUT layer — + a depth label. toolDia/2 ≥ half-width → empty (no garbage).
        // (Inset corners are miter/sharp — correct at CONVEX corners; a CONCAVE pocket's reflex corners would ideally
        // round by the tool radius — a one-word follow-up: pass {join:'round'} to round the reflex gaps.)
        const cleared = offsetPolygon(l.polygon, -((toolDia / 2) + (Number(rec.cutOffset) || 0)));
        if (cleared.length < 3) return { region: '', path: '' };
        const region = polyMarkup(cleared, `fill:url(#prepare-pocket-hatch); stroke:${color}; stroke-width:1.25; stroke-opacity:0.85; vector-effect:non-scaling-stroke; stroke-linejoin:round;`);
        let path = '';
        const label = pocketDepthLabel(rec.cutDepth);
        if (label) { const c = polyCentroid(cleared); path = `<text x="${c.x}" y="${c.y}" text-anchor="middle" dominant-baseline="central" style="font-size:7px; fill:${color}; font-family:sans-serif; paint-order:stroke; stroke:rgba(0,0,0,0.6); stroke-width:0.6;">${label}</text>`; }
        return { region, path };
      }
      // OUTSIDE / INSIDE — the CENTERLINE = the boundary offset by toolDia/2 ± cutOffset; the band straddles it (kerf).
      const r = toolDia / 2 + (Number(rec.cutOffset) || 0);
      const off = offsetPolygon(l.polygon, ct.id === 'exterior' ? r : -r);
      return { region: '', path: off.length >= 3 ? bandAndCenter(off) : '' };
    }
    // PATH types (loop or edge) — GUIDE / ON-LINE
    if (ct.id === 'guide') {
      const dash = `fill:none; stroke:${color}; stroke-width:1.5; stroke-opacity:0.9; vector-effect:non-scaling-stroke; stroke-dasharray:5 4; stroke-linejoin:round; stroke-linecap:round;`;
      return { region: '', path: targetMarkup(t, dash, dash) }; // dashed reference — NO band (not a cut)
    }
    // ON-LINE — band + dashed centerline ON the path/boundary itself (the tool rides the line).
    return { region: '', path: (toolDia > 0 ? targetMarkup(t, bandStyle, bandStyle) : '') + targetMarkup(t, centerStyle, centerStyle) };
  };
  const getLook = (key, rec) => { const sig = sigOf(rec); const hit = lookCache.get(key); if (hit && hit.sig === sig) return hit; const look = computeLook(key, rec); look.sig = sig; lookCache.set(key, look); return look; };

  const renderCuts = () => { let out = ''; for (const [key, rec] of CUT_PLAN) if (rec && rec.cutType) out += getLook(key, rec).region; cutG.innerHTML = out; };
  const renderToolpaths = () => { let out = ''; for (const [key, rec] of CUT_PLAN) if (rec && rec.cutType) out += getLook(key, rec).path; toolpathG.innerHTML = out; };
  // ONE reactive refresh: repaint BOTH layers (getLook recomputes only the changed target — its sig changed). Wired
  // to every cut-field change (cutType / toolDia / cutOffset) so the look updates LIVE without a re-mount.
  const refreshLook = () => { renderCuts(); renderToolpaths(); };

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

  refreshLook(); // paint the persisted cut plan — flat tint + tool-aware look

  const selectedTarget = () => [...selection.values()][0] || null;
  return {
    loops, selection, resolveTarget, selectedTarget,
    recordFor: (t) => (t ? getCutRecord(targetKey(t)) : null),
    availableTypesFor: (t) => (t ? availableTypes(t.kind) : []),
    // Write the cut type onto the current single selection + refresh the tool-aware look (panel calls this).
    applyCutTypeToSelected(cutType) { const t = selectedTarget(); if (!t) return null; const rec = setFieldFor(targetKey(t), 'cutType', cutType); refreshLook(); return rec; },
    // SP1h1: persist a numeric field (cutDepth / cutOffset / toolDia) on the selection + refresh the look LIVE — the
    // on-line band re-widths on a toolDia change; offset/depth feed h2–h4.
    setFieldOnSelected(field, value) { const t = selectedTarget(); if (!t) return null; const rec = setFieldFor(targetKey(t), field, value); refreshLook(); return rec; },
    destroy() {
      svgEl.removeEventListener('pointermove', onMove);
      svgEl.removeEventListener('pointerleave', onLeave);
      svgEl.removeEventListener('pointerdown', onDown);
    },
  };
}
