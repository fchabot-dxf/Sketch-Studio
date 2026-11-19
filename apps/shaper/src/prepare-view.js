// Shaper Prepare view — a Prepare-LOCAL render of the shared #core sketch + LOOP hover-highlight (SP1a + SP1c).
// Draws the EDGES (lines/arcs/circles) from the SHARED designController.state — NO joints — then finds the
// topological LOOPS (#core/loop-finder) once on mount and, on mousemove, highlights the loop under the cursor
// (point-in-loop; smallest-area on overlap). Render-on-demand: no RAF — the highlight redraws only on hover-CHANGE.
// It does NOT call the shared `#ui/svg-renderer.draw()` (which draws joints + is SketchStudio's), so the shared
// renderer stays byte-identical.

import { calculateArcPath } from '#core/geometry.js';
import { findLoops, findOpenChains } from '#core/loop-finder.js';
import { cutTypeById, availableTypes, STOCK_TYPE_ID, effectiveCutRecord, contourAllowed } from './shaper.js'; // SP1f: cut-type declarations + gating; TASK 792: where a Contour may be added
import { keyOf, parseKey, CUT_PLAN, getCutRecord, setFieldFor, deriveKeyFootprints, planOwnedLoops, stockKeyOf, lastStepDepth, rememberStepDepth, lastAdaptiveSteps, rememberAdaptiveSteps, lastStepDeviation, rememberStepDeviation, steppedNoteItems,
  holdSummary, holdNoteItems, lastTabCount, rememberTabCount, lastTabWidth, rememberTabWidth, lastHoldThickness, rememberHoldThickness,
  clearingSummary, clearingNoteItems, clearingAvailability, lastStepover, rememberStepover, lastFinishAllowance, rememberFinishAllowance, lastLoop, rememberLoop, lastRasterAngle, rememberRasterAngle,
  lastLeadInSide, rememberLeadInSide, leadInNoteItems, leadInSummary,
  CONTOUR_KIND, contourKeyOf, contourOf, isContourKey, partKeyOf, setContour, rememberContour, levelsSummary, levelsNoteItems } from './cut-plan.js'; // SP1j-4: shared cut-plan store; TASK 742: Hold part; TASK 745: the programmed pocket; TASK 792: Roughing / Contour
import { leadInDragAt } from '#core/lead-in.js'; // TASK 778: draggable lead-in junction (ONE pure derivation)
import { hasLevels } from '#core/stepped-cut.js'; // TASK 792: a record that carries a part's levels
import { levelsHeightMap } from '#core/height-map.js'; // TASK 792: its height map, drawn under the cut lines
import SettingsManager, { docUnit, lengthText, isPrecisionKey } from '#core/settings-manager.js'; // SP1h4: read DOC_UNIT for the depth label
import { loopPolygon, polyArea, pointInPolygon, loopToPathD, chainToPathD } from '#core/loop-geometry.js'; // SKETCH-4a: lifted to #core
import { curveKind } from '#core/curve-kinds.js'; // TASK 761: each curve kind's points / path
import { resolveProfileViews, resolveProfileForLoop, resolveProfileAtPoint, derivedProfileForLoop, resolveTargetKey, deriveCutTravel, arrowsAlongPath, nearestPointOnPaths, thinTravel } from '#core/profile-model.js';
import { handlePanZoomPointerDown, handlePanZoomPointerMove, handlePanZoomPointerUp, handlePanZoomWheel, fitViewToExtents } from '#ui/input-handlers/pan-zoom.js';
import { screenToWorld } from '#ui/coords.js';
import { updateViewBox } from '#ui/input-manager.js'; // TASK 605: put a document tab's own Prepare view back

const SVG_NS = 'http://www.w3.org/2000/svg';
// TASK 455: every colour/width of the Prepare look is a CSS class + --sk-prep-* token in apps/shaper/index.html (no hex here).
const EDGE_CLASS = 'sk-edge'; // idle: ONLY the thin white svg line (guide targets add sk-edge-guide)

// ── Edge render (SP1a) ───────────────────────────────────────────────────────
// TASK 788: a bezier edge's path (M a, its kind's cubic C): ONE builder for the idle edge and for the highlight / centreline strokes
function bezierPathD(s, state) {
  const k = curveKind(s), [ja, jb] = k ? k.ends(s.joints) : [], a = ja && state.joints.get(ja), b = jb && state.joints.get(jb);
  return (a && b) ? `M ${a.x} ${a.y} ${k.pathSeg(s, state, a, b)}` : '';
}
function edgesMarkup(state) {
  const J = state.joints, out = [];
  for (const s of (state.shapes || [])) {
    if (s.isConstruction) continue; // TASK 757: construction geometry (a Slot's centre line, a centreline) is never a cut edge: the loop finder ignores it (TASK 478), Prepare does not draw it
    if (s.type === 'line') {
      const a = s.joints && J.get(s.joints[0]); const b = s.joints && J.get(s.joints[1]);
      if (a && b) out.push(`<line data-shape-id="${s.id}" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" class="${EDGE_CLASS}"/>`);
    } else if (s.type === 'circle') {
      const c = s.joints && J.get(s.joints[0]); const r = (typeof s.radius === 'number' && s.radius > 0) ? s.radius : 0;
      if (c && r) out.push(`<circle data-shape-id="${s.id}" cx="${c.x}" cy="${c.y}" r="${r}" class="${EDGE_CLASS}"/>`);
    } else if (s.type === 'arc') {
      const [p1, p2, p3] = (s.joints || []).map((id) => J.get(id));
      if (p1 && p2 && p3) out.push(`<path data-shape-id="${s.id}" d="${calculateArcPath(p1, p2, p3, s.subType, { sweep: s.sweep })}" class="${EDGE_CLASS}"/>`);
    } else if (s.type === 'bezier') { // TASK 761: a bezier edge, its kind's path (#core/curve-kinds: a cubic C); Prepare did not draw it before
      const d = bezierPathD(s, state);
      if (d) out.push(`<path data-shape-id="${s.id}" d="${d}" class="${EDGE_CLASS}"/>`);
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

const SVG_NS_G = SVG_NS;
const mkGroup = (id) => { const g = document.createElementNS(SVG_NS_G, 'g'); g.id = id; return g; };
const polyMarkup = (poly, cls) => `<polygon points="${poly.map((p) => p.x + ',' + p.y).join(' ')}" class="${cls}"/>`;
const polyRingD = (poly) => (poly && poly.length >= 3) ? ('M ' + poly.map((p) => p.x + ' ' + p.y).join(' L ') + ' Z') : '';
// TASK 745: a tool-centre path ({ points, closed }) and regions ({ outer, holes }: closed [[x,y]] rings) as path text
const toolPathD = (tp) => (tp.closed ? polyRingD(tp.points) : (tp.points.length >= 2 ? 'M ' + tp.points.map((p) => p.x + ' ' + p.y).join(' L ') : ''));
const regionsD = (regions) => regions.flatMap((r) => [r.outer, ...r.holes]).map((g) => 'M ' + g.map((q) => q[0] + ' ' + q[1]).join(' L ') + ' Z').join(' ');
const CLEAR_PATH_ROLES = new Set(['linked', 'raster', 'cleanup', 'morphed', 'loop']); // TASK 749: a Spiral line ('linked'), the Morphed spiral ('morphed'); TASK 750: a closed loop
const profilePathMarkup = (outerPoly, holePolys, cls) => {
  const parts = [polyRingD(outerPoly), ...(holePolys || []).map(polyRingD)].filter(Boolean);
  return parts.length ? `<path d="${parts.join(' ')}" fill-rule="evenodd" class="${cls}"/>` : '';
};
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
// Keep pocket depth label inside the cleared material when holes open the centroid (e.g. concentric ring/frame).
function pocketLabelPoint(clearedOuter, clearedHoles) {
  const c = polyCentroid(clearedOuter);
  const inRing = (pt) => pointInPolygon(clearedOuter, pt) && !(clearedHoles || []).some((hp) => pointInPolygon(hp, pt));
  if (!clearedHoles || !clearedHoles.length || inRing(c)) return c;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of clearedOuter) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  }
  const N = 64;
  // Probe vertical line through c.x (top band first), then horizontal line through c.y
  for (const probe of [
    (k) => ({ x: c.x, y: minY + (k / N) * (maxY - minY) }),
    (k) => ({ x: minX + (k / N) * (maxX - minX), y: c.y }),
  ]) {
    let bestStart = -1, bestLen = 0, curStart = -1, curLen = 0;
    for (let k = 0; k <= N; k++) {
      if (inRing(probe(k))) {
        if (curStart < 0) curStart = k;
        curLen++;
        if (curLen > bestLen) { bestLen = curLen; bestStart = curStart; }
      } else {
        curStart = -1; curLen = 0;
      }
    }
    if (bestLen > 0) return probe(bestStart + (bestLen - 1) / 2);
  }
  return c;
}
// TASK 455: the depth chip — a rounded dark rect with white text "↓ 0.300 in" (arrow, BOLD value, lighter unit); "↓ unset" when unset.
const CHIP_H_PX = 16;
const chipParts = (cutDepth) => {
  const v = Number(cutDepth);
  const set = cutDepth != null && cutDepth !== 'unset' && Number.isFinite(v);
  let val = 'unset', unit = '';
  if (set) { val = lengthText(v, { show: 'field' }); unit = ' ' + docUnit(); } // TASK 728 / 770: the value's text is the one length-format decider's
  return { val, unit, w: (2 + val.length + unit.length) * 6.3 + 10 };
};
// TASK 780: a chip that would cover the cut's pocket START MARK (a world-size square of half-width mark.arm) moves straight up, in screen px, until its box clears the mark's.
const CHIP_MARK_GAP_PX = 2;
const clearOfStartMark = (pos, mark, w, k) => {
  if (!mark) return pos;
  const armPx = mark.arm / k, dx = Math.abs(pos.x - mark.point.x) / k, dy = (pos.y - mark.point.y) / k;
  if (dx >= w / 2 + armPx || Math.abs(dy) >= CHIP_H_PX / 2 + armPx) return pos;
  return { x: pos.x, y: mark.point.y - (armPx + CHIP_H_PX / 2 + CHIP_MARK_GAP_PX) * k };
};
const depthChip = (x, y, cutDepth, k) => {
  const { val, unit, w } = chipParts(cutDepth);
  // TASK 731: CONSTANT SCREEN SIZE. The chip is laid out in screen px (font 11 = the dimension labels', height 16, 6.3 px per glyph + 10 padding)
  // inside a <g> scaled by k = world units per screen px (worldTolerance(svg, 1), the one zoom-stable conversion), so it never grows with zoom or a small design.
  const h = CHIP_H_PX;
  return `<g class="sk-chip" transform="translate(${x} ${y}) scale(${k})"><rect class="sk-chip-bg" x="${-w / 2}" y="${-h / 2}" width="${w}" height="${h}" rx="4"/>` +
    `<text class="sk-chip-text" x="0" y="0" text-anchor="middle" dominant-baseline="central">↓ <tspan class="sk-chip-val">${val}</tspan><tspan class="sk-chip-unit">${unit}</tspan></text></g>`;
};
const EDGE_TOL_PX = 6; // on-stroke hit tolerance, in SCREEN px (converted to world per-call → zoom-stable)
// TASK 777: ONE declaration of the travel direction mark pattern (screen px + period duration).
// mountPrepareView pushes --sk-travel-* onto svgEl so .sk-travel and @keyframes sk-march read the SAME constants;
// TRAVEL_MIN_GAP_PX (TASK 757) and arrowhead spacing derive from it — no second number anywhere.
export const TRAVEL_STYLE = Object.freeze({
  dashPx: 8,            // short dash length on screen (px)
  gapPx: 28,            // sparse gap between dashes on screen (px)
  durationSec: 5,       // one period (36 px) per 5 s -> 7.2 px/s
  arrowEveryPeriods: 2, // one dart arrowhead every 2 dash periods (72 px on screen)
  arrowMinPathPx: 10,   // paths shorter than this on screen get no arrowhead
});
export const TRAVEL_PERIOD_PX = TRAVEL_STYLE.dashPx + TRAVEL_STYLE.gapPx; // 36 px
export const TRAVEL_MIN_GAP_PX = 2 * TRAVEL_STYLE.dashPx; // TASK 757 / 777: two dash lengths of .sk-travel (16 px)
export const TRAVEL_ARROW_SPACING_PX = TRAVEL_STYLE.arrowEveryPeriods * TRAVEL_PERIOD_PX; // 72 px
/** TASK 793: push the ONE travel declaration (TRAVEL_STYLE) onto an <svg> as the --sk-travel-* custom properties .sk-travel / @keyframes sk-march read:
 *  Prepare's canvas and the Export step's Paths view both call it. */
export function applyTravelStyle(svgEl) {
  if (!svgEl.style || typeof svgEl.style.setProperty !== 'function') return;
  svgEl.style.setProperty('--sk-travel-dash', String(TRAVEL_STYLE.dashPx));
  svgEl.style.setProperty('--sk-travel-gap', String(TRAVEL_STYLE.gapPx));
  svgEl.style.setProperty('--sk-travel-period', String(TRAVEL_PERIOD_PX));
  svgEl.style.setProperty('--sk-travel-duration', `${TRAVEL_STYLE.durationSec}s`);
}
// Screen-px dart arrowhead geometry per travel kind: tip forward (+x), swept tail wings, notched rear
export const DART_DIMS = Object.freeze({
  wall:   Object.freeze({ tip: 3.8, tail: -2.85, halfW: 2.6, notch: -1.5 }),
  clear:  Object.freeze({ tip: 3.0, tail: -2.25, halfW: 2.1, notch: -1.1 }),
  online: Object.freeze({ tip: 3.6, tail: -2.7,  halfW: 2.5, notch: -1.4 }),
});
export const dartSeg = (a, dims, k) => {
  const c = Math.cos(a.angle), s = Math.sin(a.angle);
  const tx = (x, y) => `${(a.x + (x * c - y * s) * k).toFixed(3)} ${(a.y + (x * s + y * c) * k).toFixed(3)}`;
  return `M ${tx(dims.tip, 0)} L ${tx(dims.tail, dims.halfW)} L ${tx(dims.notch, 0)} L ${tx(dims.tail, -dims.halfW)} Z `;
};

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
function edgeStrokeMarkup(s, state, cls) {
  const J = state.joints;
  if (s.type === 'line') { const a = J.get(s.joints[0]), b = J.get(s.joints[1]); return (a && b) ? `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" class="${cls}"/>` : ''; }
  if (s.type === 'circle') { const c = J.get(s.joints[0]); const r = (s.radius > 0) ? s.radius : 0; return (c && r) ? `<circle cx="${c.x}" cy="${c.y}" r="${r}" class="${cls}"/>` : ''; }
  if (s.type === 'arc') { const [p1, p2, p3] = (s.joints || []).map((id) => J.get(id)); return (p1 && p2 && p3) ? `<path d="${calculateArcPath(p1, p2, p3, s.subType, { sweep: s.sweep })}" class="${cls}"/>` : ''; }
  if (s.type === 'bezier') { const d = bezierPathD(s, state); return d ? `<path d="${d}" class="${cls}"/>` : ''; } // TASK 788: an open bezier chain's highlight / centreline
  return '';
}

// ── Cut plan (SP1f; extracted to ./cut-plan.js in SP1j-4): the per-target store + its keyOf/getCutRecord/setFieldFor
// now live in a shared module read by BOTH this look AND the SVG exporter. Behaviour unchanged — same Map. ──

// ── Mount: render edges + compute loops + wire kind-aware hover + click-to-select + cut-plan preview ──
export function mountPrepareView(state, svgEl, opts = {}) {
  if (!state || !svgEl) return { loops: [], selection: new Map(), destroy() {} };
  const onSelectionChange = opts.onSelectionChange || (() => {});
  const onNotice = opts.onNotice || (() => {}); // TASK 472: a transient one-line notice (the Stock role moved)
  const onCommitField = opts.onCommitField || ((key, field, value) => { setFieldFor(key, field, value); refreshLook(); }); // TASK 778: dragging the lead-in handle commits ONE undo step via prepare-stage
  svgEl.innerHTML = ''; // clean re-mount
  // TASK 777: push ONE declaration of the travel dash pattern to CSS custom properties on svgEl so .sk-travel and @keyframes sk-march share TRAVEL_STYLE
  applyTravelStyle(svgEl);

  // Local view state for Prepare canvas, initialized by fitting to sketch extents
  const view = { x: 0, y: 0, w: 120, h: 90 };
  const viewState = {
    view,
    allowEmptyPan: true,
    _panZoom: {
      isPanning: false,
      lastPanPoint: null,
      lastTouchDistance: null,
      touchPoints: new Map(),
      isPinching: false,
      lastPinchCenter: null,
      lastPinchDistance: null,
    },
  };
  fitViewToExtents(svgEl, view, state, { avoidEl: opts.avoidEl, inset: opts.inset, avoidGap: opts.avoidGap });
  // SP1h4: a diagonal HATCH pattern (pocket preview colour) for the cleared region. userSpaceOnUse → world-unit
  // spacing (scales with the geometry). One <defs> per mount; referenced by the pocket cleared-region fill.
  const defs = document.createElementNS(SVG_NS, 'defs');
  // TASK 455: pocket marks = short white diagonal strokes in a regular grid, alternating "\" and "/" (a sparse X-hatch)
  defs.innerHTML = `<pattern id="prepare-pocket-marks" patternUnits="userSpaceOnUse" width="12" height="12"><g class="sk-mark">` +
    `<line x1="1.8" y1="1.8" x2="4.2" y2="4.2"/><line x1="10.2" y1="1.8" x2="7.8" y2="4.2"/>` +
    `<line x1="1.8" y1="10.2" x2="4.2" y2="7.8"/><line x1="10.2" y1="10.2" x2="7.8" y2="7.8"/></g></pattern>`;
  svgEl.appendChild(defs);
  // z-order (later = on top): cut TINT (behind) < edges < toolpath (tool-aware look) < selected < hover. Joints hidden.
  // TASK 792: a part's HEIGHT MAP (#core/height-map.js, from its levels) UNDER everything: the cut tint, the edges, the tool paths and chips stay on top
  const heightG = mkGroup('prepare-heightmap-group');  svgEl.appendChild(heightG);
  const cutG = mkGroup('prepare-cut-group');           svgEl.appendChild(cutG);
  renderPrepareGeometry(state, svgEl);                 // edges — above the cut tint
  const selectG = mkGroup('prepare-select-group');     svgEl.appendChild(selectG);
  const hoverG = mkGroup('prepare-hover-group');       svgEl.appendChild(hoverG);
  // TASK 455: the tool path + depth chip sit ABOVE the highlighted boundary (an On Line's black dashes ride on its bold mint line)
  const toolpathG = mkGroup('prepare-toolpath-group'); svgEl.appendChild(toolpathG);
  const chipG = mkGroup('prepare-chip-group');         svgEl.appendChild(chipG); // the depth chip rides on the tool path
  const dragG = mkGroup('prepare-lead-drag-group');    svgEl.appendChild(dragG); // TASK 778: live preview while dragging the lead-in handle
  const handleG = mkGroup('prepare-handle-group');     svgEl.appendChild(handleG); // TASK 778: draggable junction handle (44 px hit area)

  const shapeById = new Map((state.shapes || []).map((s) => [s.id, s]));
  const loops = findLoops(state).map((l) => { const polygon = loopPolygon(l, state, shapeById); return { ...l, polygon, area: polyArea(polygon) }; });
  const loopById = new Map(loops.map((l) => [l.id, l]));
  const loopPolys = Object.fromEntries(loops.map((l) => [l.id, l.polygon]));
  const profileViews = resolveProfileViews(state, loops, loopPolys);
  const chains = findOpenChains(state, loops);
  const chainById = new Map(chains.map((c) => [c.id, c]));
  const chainByShapeId = new Map();
  for (const c of chains) {
    for (const s of (c.shapes || [])) chainByShapeId.set(s.id, c);
  }

  // Selection model: a target is { kind: 'loop' | 'profile' | 'chain', id } keyed by `${kind}:${id}`:
  //   • derived profile → `loop:<outerLoopId>` (preserves saved cut plans)
  //   • combined profile → `profile:<profileId>`
  //   • open chain → `chain:<chainId>`
  // Shift+click (e.shiftKey) toggles targets in `selection`; plain click selects one (or clears on empty space).
  const selection = new Map(); // key -> { kind, id }
  const targetKey = (t) => keyOf(t.kind, t.id);

  const profileLoopsForTarget = (t) => {
    if (!t) return null;
    const spec = resolveTargetKey(t, state, loops, loopPolys);
    if (!spec || spec.invalid || !spec.outer) return null;
    const outer = loopById.get(spec.outer);
    if (!outer || outer.polygon.length < 3) return null;
    const holes = (spec.inners || []).map((hid) => loopById.get(hid)).filter((hl) => hl && hl.polygon.length >= 3);
    return { outer, holes, isDerived: Boolean(spec.isDerived), profileId: spec.profileId };
  };

  // Precompute per-edge hit geometry once (Prepare geometry is static) — lines/circles analytic, arcs sampled.
  const edgeHits = (state.shapes || []).map((s) => {
    if (s.type === 'line') { const a = state.joints.get(s.joints[0]), b = state.joints.get(s.joints[1]); return (a && b) ? { id: s.id, kind: 'seg', a, b } : null; }
    if (s.type === 'circle') { const c = state.joints.get(s.joints[0]); const r = (s.radius > 0) ? s.radius : 0; return (c && r) ? { id: s.id, kind: 'circle', c, r } : null; }
    if (s.type === 'arc' || s.type === 'bezier') { const samples = curveKind(s) ? curveKind(s).points(s, state, 32) : []; return (samples.length >= 2) ? { id: s.id, kind: 'poly', samples } : null; } // TASK 761: a bezier's points too (#core/curve-kinds)
    return null;
  }).filter(Boolean);

  // STEP 3: Picking.
  // (a) INK: nearest shape within tol.
  //     - If in some loop's edges: smallest-area loop, return its profile via resolveProfileForLoop.
  //     - If in an open chain: return { kind: 'chain', id: chain.id }.
  // (b) INTERIOR: resolveProfileAtPoint.
  // Map profile: derived -> { kind: 'loop', id: profile.outer }; combined -> { kind: 'profile', id: profile.id }.
  // NEVER return kind 'edge'.
  function resolveTarget(worldPt) {
    const mapProfileToTarget = (prof) => {
      if (!prof || !prof.outer) return null;
      if (prof.isDerived) return { kind: 'loop', id: prof.outer };
      const v = profileViews.get(prof.id);
      if (!v || v.invalid) return null;
      return { kind: 'profile', id: prof.id };
    };

    // (a) INK
    const tol = worldTolerance(svgEl, EDGE_TOL_PX);
    let bestEdge = null, bestDist = tol;
    for (const h of edgeHits) { const d = edgeDistAt(h, worldPt); if (d <= bestDist) { bestDist = d; bestEdge = h; } }
    if (bestEdge) {
      const inLoops = loops.filter((l) => (l.edges || []).includes(bestEdge.id));
      if (inLoops.length > 0) {
        inLoops.sort((a, b) => a.area - b.area);
        const smallestLoop = inLoops[0];
        const prof = resolveProfileForLoop(smallestLoop.id, state, loops, loopPolys);
        const tgt = mapProfileToTarget(prof);
        if (tgt) return tgt;
      }
      const chain = chainByShapeId.get(bestEdge.id);
      if (chain) {
        return { kind: 'chain', id: chain.id };
      }
    }

    // (b) INTERIOR
    const prof = resolveProfileAtPoint(worldPt, state, loops, loopPolys);
    return mapProfileToTarget(prof);
  }

  // STEP 4: Highlight markup.
  //   - kind 'loop' -> ONE <path fill-rule="evenodd"> = outer loop polygon + DIRECT holes open;
  //   - kind 'profile' -> resolveProfileViews.get(id).d, evenodd style;
  //   - kind 'chain' -> edgeStrokeMarkup for each member shape.
  const targetMarkup = (t, cls) => {
    if (!t) return '';
    if (t.kind === CONTOUR_KIND) return targetMarkup(parseKey(t.id), cls); // TASK 792: a part's Contour highlights the part
    if (t.kind === 'loop') {
      const outerLoop = loopById.get(t.id);
      if (!outerLoop) return '';
      const prof = derivedProfileForLoop(t.id, loops, loopPolys, state);
      const holePolys = (prof && prof.inners ? prof.inners : []).map((hid) => loopPolys[hid]).filter((p) => p && p.length >= 3);
      return profilePathMarkup(outerLoop.polygon, holePolys, cls);
    }
    if (t.kind === 'profile') {
      const v = profileViews.get(t.id);
      if (!v || !v.d) return '';
      return `<path d="${v.d}" fill-rule="evenodd" class="${cls}"/>`;
    }
    if (t.kind === 'chain') {
      const chain = chainById.get(t.id);
      if (!chain) return '';
      return (chain.shapes || []).map((s) => edgeStrokeMarkup(s, state, cls)).join('');
    }
    return '';
  };

  // SP1h5: per-target cut LOOK = the CUTTER PATH, cached by (cutType,toolDia,cutOffset,cutDepth,docUnit).
  const lookCache = new Map(); // targetKey → { sig, region, path }
  // TASK 711: which loops have their own record (a hole with one is not cut again by its enclosing target) follows the ASSIGNED keys:
  // derived once per change of that key list, and part of every look's signature (assigning a hole's cut changes its plate's look).
  let owned = { keys: null, set: null };
  const ownedNow = () => {
    const keys = [...CUT_PLAN].filter(([, r]) => r && r.cutType).map(([k]) => k).sort().join(' ');
    if (owned.keys !== keys) owned = { keys, set: planOwnedLoops(state, loops, loopPolys) };
    return owned;
  };
  const sigOf = (rec) => `${rec.cutType}|${rec.toolDia}|${rec.cutOffset}|${rec.cutDepth}|${rec.stepDepth}|${rec.adaptiveSteps}|${rec.stepDeviation}|${rec.holdPart}|${rec.tabCount}|${rec.tabWidth}|${rec.holdThickness}|${rec.clearing}|${rec.stepover}|${rec.finishAllowance}|${rec.rasterAngle}|${rec.loop}|${rec.leadIn}|${rec.leadInRadius}|${rec.leadInSweep}|${rec.leadInLength}|${rec.leadInSide}|${rec.leadInAt}|${docUnit()}|${ownedNow().keys}`; // TASK 714 / 717: a stepped cut's look follows its step depth / adaptive resolution; TASK 742: its Hold part; TASK 745: its Clearing; TASK 775 / 778: its lead-in arc + position
  const computeLook = (key, storedRec) => {
    const derived = deriveKeyFootprints(key, storedRec, state, loops, loopPolys, ownedNow().set); // the ONE composition (cut-plan.js), shared with the 3D Review
    if (!derived) return { region: '', path: '', toolPaths: [], leadHandles: [] };
    const { rec, footprints } = derived;
    const ct = rec && rec.cutType ? cutTypeById(rec.cutType) : null;
    if (!ct) return { region: '', path: '', toolPaths: [], leadHandles: [] };
    // TASK 455: the idle state is ONLY the svg line, so a look exists only to be drawn in the hover / selected states. Every
    // type uses the same state model; only the SHAPE differs. A Guide is a line only (no band, dashes or chip).
    if (ct.id === 'guide' || ct.id === STOCK_TYPE_ID) return { region: '', path: '', hasTravel: false, toolPaths: [], leadHandles: [] }; // a Guide / the Stock: a line only (the Stock has its label)
    // TASK 447: the FOOTPRINT of the round bit (what it really removes) comes from ONE core derivation
    // (#core/profile-model deriveCutFootprint); this view only draws the rings it returns. Uncut material (corners the
    // bit cannot reach) is simply the area the footprint does not cover — never highlighted.
    const isOnline = ct.id === 'online';
    const tpClass = isOnline ? 'sk-tp sk-tp-online' : 'sk-tp';
    let region = '', path = '', hasTravel = false, chip = null, startMark = null;
    const toolPaths = [];
    const leadHandles = []; // TASK 778: draggable handles at On line lead-in junctions
    // TASK 449 / 777: travel marks (sparse slow marching dashes + zoom-stable screen-sized dart arrowheads); TASK 757: a STEPPED cut's (a terrace's)
    // go to `stepped`, thinned at draw time (renderStepAndArrows: outlines closer on screen than TRAVEL_MIN_GAP_PX carry none).
    const stepped = [];
    const travels = [];
    let rasterIdx = 0;
    // TASK 775 / 777 / 778: a LEAD-IN ARC (from the one derivation): its path `lead.d`, a filled dot at its tip, a ring at the junction, and its draggable handle
    const isActiveLead = (lead) => Boolean(lead && (lead.role === 'arc' || lead.role === 'leg') && Array.isArray(lead.legPoints) && lead.legPoints.length >= 2);
    const addLeadLeg = (lead) => {
      if (!isActiveLead(lead)) return;
      const d = lead.d || toolPathD({ points: lead.legPoints, closed: false });
      if (d) path += `<path class="sk-lead-leg" d="${d}"/>`;
    };
    const addLeadDots = (lead) => {
      if (!isActiveLead(lead)) return;
      const tip = lead.tip || lead.legPoints[0];
      const j = lead.junction || lead.legPoints[lead.legPoints.length - 1];
      path += `<circle class="sk-lead-end" cx="${j.x}" cy="${j.y}" r="1.2"/><circle class="sk-lead-tip" cx="${tip.x}" cy="${tip.y}" r="1.6"/>`;
      if (lead.role === 'arc') leadHandles.push({ key, junction: j });
    };
    const addTravel = (fp, t) => {
      const d = toolPathD({ points: t.path, closed: t.closed });
      if (!d) return;
      const kind = t.role === 'leadin' || t.role === 'online' || t.role === 'stroke' ? 'online'
        : CLEAR_PATH_ROLES.has(t.role) ? 'clear' : 'wall';
      const cls = t.role === 'leadin' ? 'sk-travel sk-travel-lead'
        : (t.role === 'online' || t.role === 'stroke') ? 'sk-travel sk-travel-online'
        : CLEAR_PATH_ROLES.has(t.role) ? 'sk-travel sk-travel-clear' : 'sk-travel';
      const markup = `<path class="${cls}" d="${d}"/>`;
      if (fp.terrace) stepped.push({ ring: t.path, markup, t, kind });
      else { path += markup; travels.push({ t, kind, rasterIdx: t.role === 'raster' ? rasterIdx++ : -1 }); }
    };
    for (const fp of footprints) {
      // TASK 745 / 777 / 778: a programmed pocket: clearing paths (thin continuous guide + sparse slow travel dashes & darts), swept band, leftover, walls / islands, and start mark target
      if (fp.clearing) {
        const cl = fp.clearing;
        if (cl.role === 'start') { // TASK 778: pocket start mark (circle + cross, declared once)
          path += `<path class="sk-pocket-start" d="${cl.d}"/>`;
          startMark = { point: cl.point, arm: cl.dia / 2 };
          continue;
        }
        toolPaths.push(...(fp.toolPaths || []));
        if (cl.summary) { // the cut that carries the plan: the wall's (TASK 749: a Spiral's last line when its wall is in the line)
          if (cl.summary.swept && cl.summary.swept.length) region += `<path d="${regionsD(cl.summary.swept)}" fill-rule="evenodd" class="sk-band"/>`;
          if (cl.summary.leftover && cl.summary.leftover.regions.length) region += `<path d="${regionsD(cl.summary.leftover.regions)}" fill-rule="evenodd" class="sk-leftover"/>`;
        }
        if (CLEAR_PATH_ROLES.has(cl.role)) {
          for (const tp of fp.toolPaths || []) {
            path += `<path class="sk-clear-path${cl.role === 'cleanup' ? ' sk-clear-cleanup' : ''}${cl.role === 'loop' ? ' sk-clear-loop' : ''}" d="${toolPathD(tp)}"/>`;
          }
          const travel = deriveCutTravel([fp]);
          for (const t of travel) { addTravel(fp, t); hasTravel = true; }
          if (!chip && fp.anchor) chip = fp.anchor;
          continue;
        }
        const travel = deriveCutTravel([fp]);
        for (const t of travel) { addTravel(fp, t); hasTravel = true; }
        if (!travel.length) for (const tp of fp.toolPaths || []) path += `<path class="${tpClass}" d="${toolPathD(tp)}"/>`;
        if (!chip && fp.anchor) chip = fp.anchor;
        continue;
      }
      const rings = fp.rings.filter((ring) => ring.length >= 3);
      // TASK 452: the pocket's FINISH ring (the Inside/Outside band at zero offset, wall -> 2r in) under the clearing area
      const finish = (fp.finishRings || []).filter((ring) => ring.length >= 3);
      if (finish.length) region += `<path d="${finish.map(polyRingD).join(' ')}" fill-rule="nonzero" class="sk-finish"/>`;
      if (rings.length) {
        const d = rings.map(polyRingD).join(' ');
        region += `<path d="${d}" fill-rule="${fp.fillRule}" class="sk-band"/>`;
        if (fp.kind === 'pocket') region += `<path d="${d}" fill-rule="${fp.fillRule}" class="sk-pocket-marks" fill="url(#prepare-pocket-marks)"/>`;
      }
      // TASK 449 / 777: travel marks (one core derivation): sparse slow marching dashes + zoom-stable dart arrowheads (CSS animation, no RAF).
      toolPaths.push(...(fp.toolPaths || []));
      // TASK 742: a held cut: its tabs marked on the outline (an onion skin: the whole outline), each gap strip drawn as it is exported (its own
      // band shows what the bit removes; no travel marks on the strips, their loops are too small to read)
      if (fp.hold && (fp.hold.role === 'pass' || fp.hold.role === 'stroke')) for (const d of fp.hold.marks || []) path += `<path class="${fp.hold.mode === 'skin' ? 'sk-skin-mark' : 'sk-tab-mark'}" d="${d}"/>`;
      if (fp.hold && fp.hold.role === 'strip') { path += `<path class="sk-strip" d="${fp.hold.d}"/>`; continue; }
      if (fp.hold && fp.hold.role === 'stroke') { // TASK 775 / 777: an On line cut's tabs: each stroke as exported, with its travel marks
        path += `<path class="sk-stroke" d="${fp.hold.d}"/>`;
        const travel = deriveCutTravel([fp]);
        for (const t of travel) { addTravel(fp, t); hasTravel = true; }
        if (!chip && fp.anchor) chip = fp.anchor;
        continue;
      }
      addLeadLeg(fp.leadIn); // TASK 775 / 778: an On line outline's lead-in arc (base curve under 777's travel dashes)
      const travel = deriveCutTravel([fp]);
      for (const t of travel) { addTravel(fp, t); hasTravel = true; }
      if (fp.kind === 'pocket') {
        if (rings.length && !chip) chip = pocketLabelPoint(rings[0], rings.slice(1));
      } else if (fp.chain) {
        path += (fp.chain.shapes || []).map((s) => edgeStrokeMarkup(s, state, tpClass)).join('');
        if (!chip && fp.anchor) chip = fp.anchor;
      } else if (fp.center && !travel.length) {
        path += polyMarkup(fp.center, tpClass);
      }
      addLeadDots(fp.leadIn); // TASK 775 / 778: tip dot, junction ring, and draggable handle on top of travel marks
      if (!chip && fp.anchor) chip = fp.anchor;
    }
    return { region, path, hasTravel, toolPaths, anchor: chip, startMark, depth: rec.cutDepth, stepped, steppedGaps: new Map(), travels, leadHandles };
  };
  const getLook = (key, rec) => { const sig = sigOf(rec) + (isContourKey(key) ? '#' + sigOf(CUT_PLAN.get(partKeyOf(key)) || {}) : ''); const hit = lookCache.get(key); if (hit && hit.sig === sig) return hit; const look = computeLook(key, rec); look.sig = sig; lookCache.set(key, look); return look; };

  // TASK 455: the SAME state model for every cut type — idle: only the svg line; hover: dark band + bold white boundary +
  // dashed tool path + depth chip; selected: teal band + bold mint boundary + the same path/chip; selected+hover: selected with
  // a slightly brighter band. The colours are the --sk-prep-* tokens (apps/shaper/index.html).
  let hovered = null; // current hovered target { kind, id } | null
  let lastZoomK = null; // TASK 777: skip zoom-dependent DOM rebuilds during a pure pan (k unchanged)
  const stateOf = (key) => {
    const sel = selection.has(key), hov = !!hovered && targetKey(hovered) === key;
    return sel ? (hov ? 'hot' : 'sel') : (hov ? 'hover' : null);
  };
  const renderCuts = () => {
    let out = '';
    for (const [key, rec] of CUT_PLAN) { if (!(rec && rec.cutType)) continue; const st = stateOf(key); if (st) out += `<g class="sk-st-${st}">${getLook(key, rec).region}</g>`; }
    cutG.innerHTML = out;
  };
  const renderToolpaths = () => {
    let out = '';
    for (const [key, rec] of CUT_PLAN) { if (rec && rec.cutType && stateOf(key)) out += getLook(key, rec).path; }
    toolpathG.innerHTML = out + '<g class="sk-travel-steps"></g><g class="sk-travel-arrows-layer"></g>';
    lastZoomK = null;
    renderStepAndArrows();
  };
  // TASK 757 / 777: stepped travel marks thinned by TRAVEL_MIN_GAP_PX (#core thinTravel) + zoom-stable dart arrowheads (#core arrowsAlongPath)
  // batched into one <path> per style kind so panning and dense clearing pockets stay smooth.
  const renderStepAndArrows = () => {
    const stepLayer = toolpathG.querySelector('.sk-travel-steps');
    const arrowLayer = toolpathG.querySelector('.sk-travel-arrows-layer');
    if (!stepLayer && !arrowLayer) return;
    const k = worldTolerance(svgEl, 1);
    const minGap = k * TRAVEL_MIN_GAP_PX;
    const spacing = k * TRAVEL_ARROW_SPACING_PX;
    const minLen = k * TRAVEL_STYLE.arrowMinPathPx;
    let stepOut = '';
    const dByKind = { clear: '', wall: '', online: '' };
    const pushArrows = (entry) => {
      const dims = DART_DIMS[entry.kind] || DART_DIMS.wall;
      const phase = entry.rasterIdx >= 0 && entry.rasterIdx % 2 === 1 ? 0.72 : 0.5;
      for (const a of arrowsAlongPath(entry.t.path, entry.t.closed, { spacing, minLen, phase })) dByKind[entry.kind] += dartSeg(a, dims, k);
    };
    for (const [key, rec] of CUT_PLAN) {
      if (!(rec && rec.cutType && stateOf(key))) continue;
      const look = getLook(key, rec);
      if (look.travels) for (const entry of look.travels) pushArrows(entry);
      if (look.stepped && look.stepped.length) {
        for (const i of thinTravel(look.stepped.map((t) => t.ring), minGap, look.steppedGaps)) {
          stepOut += look.stepped[i].markup;
          pushArrows(look.stepped[i]);
        }
      }
    }
    if (stepLayer) stepLayer.innerHTML = stepOut;
    if (arrowLayer) {
      let arrowsOut = '';
      if (dByKind.clear) arrowsOut += `<path class="sk-travel-arrows sk-travel-arrows-clear" d="${dByKind.clear}"/>`;
      if (dByKind.wall) arrowsOut += `<path class="sk-travel-arrows" d="${dByKind.wall}"/>`;
      if (dByKind.online) arrowsOut += `<path class="sk-travel-arrows sk-travel-arrows-online" d="${dByKind.online}"/>`;
      arrowLayer.innerHTML = arrowsOut;
    }
    lastZoomK = k;
  };
  let leadDrag = null; // TASK 778: active junction handle drag { pointerId, key, loop, holes (TASK 787), startAt, lastGood, startJunction, previewLead, refused }
  const renderHandles = () => {
    const k = worldTolerance(svgEl, 1);
    if (leadDrag) {
      const j = leadDrag.previewLead && leadDrag.previewLead.junction ? leadDrag.previewLead.junction : leadDrag.startJunction;
      handleG.innerHTML = j
        ? `<g class="sk-lead-handle is-dragging${leadDrag.refused ? ' is-refused' : ''}" data-lead-key="${leadDrag.key}" transform="translate(${j.x} ${j.y}) scale(${k})"><circle class="sk-lead-hit" r="22"/><circle class="sk-lead-knob" r="6"/></g>`
        : '';
      return;
    }
    let out = '';
    for (const [key, rec] of CUT_PLAN) {
      if (!(rec && rec.cutType && selection.has(key))) continue;
      const look = getLook(key, rec);
      for (const h of look.leadHandles || []) {
        out += `<g class="sk-lead-handle" data-lead-key="${h.key}" transform="translate(${h.junction.x} ${h.junction.y}) scale(${k})"><circle class="sk-lead-hit" r="22"/><circle class="sk-lead-knob" r="6"/></g>`;
      }
    }
    handleG.innerHTML = out;
  };
  const renderDragPreview = () => {
    toolpathG.classList.toggle('is-lead-dragging', Boolean(leadDrag));
    if (!leadDrag || !leadDrag.previewLead) { dragG.innerHTML = ''; renderHandles(); return; }
    const ld = leadDrag.previewLead;
    const cls = leadDrag.refused ? ' is-refused' : '';
    let out = '';
    if (ld.d) out += `<path class="sk-lead-leg${cls}" d="${ld.d}"/>`;
    if (ld.junction) out += `<circle class="sk-lead-end${cls}" cx="${ld.junction.x}" cy="${ld.junction.y}" r="1.2"/>`;
    if (ld.tip) out += `<circle class="sk-lead-tip${cls}" cx="${ld.tip.x}" cy="${ld.tip.y}" r="1.6"/>`;
    dragG.innerHTML = out;
    renderHandles();
  };
  const renderZoomed = () => { // what a zoom/resize changes (skipped on pure pan when k is unchanged): thinned stepped marks, dart arrowheads, chips, lead-in handle size
    const k = worldTolerance(svgEl, 1);
    if (lastZoomK === null || Math.abs(k - lastZoomK) > 1e-9) { renderStepAndArrows(); renderChips(); renderHandles(); }
  };
  // TASK 455: the depth chip sits ON the tool path (centred on the dashed line) at the point NEAREST THE CURSOR and follows the cursor
  // along it while hovering; selected-but-not-hovered it STAYS at its last spot (a target's first appearance uses the stable
  // default anchor the footprint derivation provides).
  let hoverPt = null;
  const lastChip = new Map();
  const renderChips = () => {
    let out = '';
    for (const [key, rec] of CUT_PLAN) {
      if (!(rec && rec.cutType && stateOf(key))) continue;
      const look = getLook(key, rec);
      if (!look.anchor && !(look.toolPaths && look.toolPaths.length)) continue;
      const hov = hovered && targetKey(hovered) === key && hoverPt;
      const near = hov ? nearestPointOnPaths(look.toolPaths, hoverPt) : null;
      const pos = near || lastChip.get(key) || look.anchor;
      if (!pos) continue;
      lastChip.set(key, pos);
      const ck = worldTolerance(svgEl, 1);
      const at = clearOfStartMark(pos, look.startMark, chipParts(look.depth).w, ck);
      out += depthChip(at.x, at.y, look.depth, ck);
    }
    // TASK 472: the Stock loop always carries its label (it is the board): "STOCK <thickness>" just above the loop's top-left corner
    const sk = stockKeyOf(CUT_PLAN);
    if (sk) {
      const spec = resolveTargetKey(parseKey(sk), state, loops, loopPolys);
      const poly = spec && !spec.invalid && spec.outer ? loopPolys[spec.outer] : null;
      if (poly && poly.length >= 3) {
        const x0 = Math.min(...poly.map((p) => p.x)), y0 = Math.min(...poly.map((p) => p.y));
        const t = Number(CUT_PLAN.get(sk).cutDepth), set = CUT_PLAN.get(sk).cutDepth !== 'unset' && Number.isFinite(t);
        const txt = 'STOCK ' + (set ? lengthText(t, { show: 'unit' }) : '(thickness unset)');
        out += `<text class="sk-stock-label" x="${x0}" y="${y0 - 2.5}">${txt}</text>`;
      }
    }
    chipG.innerHTML = out;
  };
  // idle guide lines are the one coloured exception: thin blue
  const shapeIdsOfType = (cutType) => {
    const ids = new Set();
    for (const [key, rec] of CUT_PLAN) {
      if (!(rec && rec.cutType === cutType)) continue;
      const { kind, id } = parseKey(key);
      const addLoop = (lid) => { const l = loopById.get(lid); if (l) for (const e of (l.edges || [])) ids.add(e); };
      if (kind === 'loop') addLoop(id);
      else if (kind === 'chain') { const c = chainById.get(id); if (c) for (const sh of (c.shapes || [])) ids.add(sh.id); }
      else if (kind === 'profile') { const v = profileViews.get(id); if (v) { addLoop(v.outerLoopId); for (const h of (v.innerLoopIds || [])) addLoop(h); } }
    }
    return ids;
  };
  const refreshEdgeClasses = () => {
    const guides = shapeIdsOfType('guide'), stocks = shapeIdsOfType('stock'); // TASK 472: the Stock loop is drawn distinctly (warm tan, dashed)
    svgEl.querySelectorAll('[data-shape-id]').forEach((el) => {
      const sid = el.getAttribute('data-shape-id');
      el.classList.toggle('sk-edge-guide', guides.has(sid)); el.classList.toggle('sk-edge-stock', stocks.has(sid));
    });
  };
  // ONE reactive refresh: repaint the look layers (getLook recomputes only the changed target — its sig changed). Wired
  // to every cut-field change AND to hover / selection changes so the look follows the state.
  // TASK 792 (owner turns 2484-2485): every record that carries a part's LEVELS (an STL's outline, a Fusion part that sends them) shows its height map,
  // always (no toggle), never for a drawn design (no record has levels). Rebuilt only when the set of levels lists changes (each map is memoised).
  let heightLists = [];
  const renderHeightMap = () => {
    const lists = [];
    for (const rec of CUT_PLAN.values()) if (rec && hasLevels(rec) && !lists.includes(rec.levels)) lists.push(rec.levels);
    if (lists.length === heightLists.length && lists.every((l, i) => l === heightLists[i])) return;
    heightLists = lists;
    heightG.innerHTML = lists.map((l) => levelsHeightMap(l)).filter(Boolean)
      .map((m) => `<image class="sk-heightmap" href="${m.href}" x="${m.x0}" y="${m.y0}" width="${m.width}" height="${m.height}" preserveAspectRatio="none" pointer-events="none"/>`).join('');
  };
  const refreshLook = () => {
    renderHeightMap();
    renderCuts(); renderToolpaths(); renderChips(); renderHandles(); refreshEdgeClasses();
    // TASK 449: the one-line direction legend shows only while a visible (hovered / selected) cut has a travel direction
    const legend = document.getElementById('prepare-dir-legend');
    if (legend) { let any = false; for (const [key, rec] of CUT_PLAN) if (rec && rec.cutType && stateOf(key) && getLook(key, rec).hasTravel) any = true; legend.hidden = !any; }
  };

  const renderSelection = () => {
    let out = '';
    for (const t of selection.values()) out += targetMarkup(t, 'sk-hl sk-hl-select');
    selectG.innerHTML = out;
  };
  const renderHover = () => {
    // Show the hover highlight UNLESS that target is already selected (selected style wins — no double-draw).
    const k = hovered ? targetKey(hovered) : null;
    const rec = k ? CUT_PLAN.get(k) : null;
    hoverG.innerHTML = (hovered && !selection.has(k)) ? targetMarkup(hovered, 'sk-hl ' + (rec && rec.cutType ? 'sk-hl-hover-cut' : 'sk-hl-hover')) : '';
    refreshLook();
  };

  const setHover = (t) => {
    const k = t ? targetKey(t) : null, pk = hovered ? targetKey(hovered) : null;
    if (k !== pk) { hovered = t; renderHover(); } // redraw on hover-CHANGE only
  };
  const onWheel = (e) => {
    handlePanZoomWheel(e, svgEl, viewState);
    renderZoomed(); // TASK 731: the chip keeps its screen size across a zoom; TASK 757: the stepped travel marks re-thin
  };
  const finishLeadDrag = (e, commit) => {
    if (!leadDrag || (e && e.pointerId !== leadDrag.pointerId)) return false;
    const d = leadDrag;
    leadDrag = null;
    try { if (e && svgEl.hasPointerCapture && svgEl.hasPointerCapture(e.pointerId)) svgEl.releasePointerCapture(e.pointerId); } catch (_) {}
    renderDragPreview();
    if (commit && !d.refused && d.lastGood !== d.startAt && (d.lastGood != null) && (d.startAt == null || Math.abs(d.lastGood - d.startAt) > 1e-6)) {
      onCommitField(d.key, 'leadInAt', d.lastGood);
    }
    return true;
  };
  const onMove = (e) => {
    if (leadDrag && e.pointerId === leadDrag.pointerId) {
      e.stopPropagation(); e.preventDefault();
      const wp = screenToWorld(svgEl, e.clientX, e.clientY);
      if (!wp) return;
      const rec = CUT_PLAN.get(leadDrag.key);
      const res = rec ? leadInDragAt(leadDrag.loop, effectiveCutRecord(rec), state, wp, leadDrag.holes) : null; // TASK 787: the part's holes kept clear, as in the export
      if (res && res.leadIn) {
        leadDrag.previewLead = res.leadIn;
        if (res.leadIn.role === 'arc') { leadDrag.lastGood = res.atFrac; leadDrag.refused = false; }
        else { leadDrag.refused = true; }
        renderDragPreview();
      }
      return;
    }
    if (handlePanZoomPointerMove(e, svgEl, viewState)) { renderZoomed(); return; } // a pinch changes the zoom
    const wp = screenToWorld(svgEl, e.clientX, e.clientY);
    if (!wp) return;
    hoverPt = wp;
    setHover(resolveTarget(wp));
    if (hovered) renderChips(); // the chip follows the cursor along the path
  };
  const onLeave = () => { if (!leadDrag) { hoverPt = null; setHover(null); } };
  const onDown = (e) => {
    // TASK 778: dragging the selected cut's lead-in junction handle slides it along the outline and NEVER pans the view (mouse or touch)
    const handleEl = e.target && e.target.closest ? e.target.closest('.sk-lead-handle') : null;
    if (handleEl && (e.button == null || e.button === 0)) {
      const key = handleEl.getAttribute('data-lead-key');
      const pl = key ? profileLoopsForTarget(parseKey(key)) : null;
      const rec = key ? CUT_PLAN.get(key) : null;
      if (pl && pl.outer && rec) {
        e.stopPropagation(); e.preventDefault();
        try { svgEl.setPointerCapture(e.pointerId); } catch (_) {}
        const startLead = leadInSummary(key, rec, state, loops, loopPolys, ownedNow().set);
        leadDrag = {
          pointerId: e.pointerId, key, loop: pl.outer, holes: pl.holes,
          startAt: rec.leadInAt ?? null, lastGood: rec.leadInAt ?? null,
          startJunction: startLead ? startLead.junction : null, previewLead: startLead, refused: false,
        };
        renderDragPreview();
        return;
      }
    }
    // Two-finger touch pinch or middle-button drag: always pan/zoom
    if (e.pointerType === 'touch' && handlePanZoomPointerDown(e, svgEl, viewState)) {
      return;
    }
    if (e.button === 1) {
      handlePanZoomPointerDown(e, svgEl, viewState);
      return;
    }
    const wp = screenToWorld(svgEl, e.clientX, e.clientY);
    const t = wp ? resolveTarget(wp) : null;
    if (e.shiftKey) {
      if (t) {
        const k = targetKey(t);
        if (selection.has(k)) selection.delete(k);
        else selection.set(k, t);
      }
    } else {
      selection.clear();
      if (t) {
        selection.set(targetKey(t), t);
      } else {
        // Click empty canvas: cleared selection and initiate empty-canvas pan drag
        handlePanZoomPointerDown(e, svgEl, viewState);
      }
    }
    renderSelection(); renderHover();        // (renderHover also repaints the look layers) redraw on selection-CHANGE; refresh hover (a now-selected profile drops its hover)
    onSelectionChange(t || selectedTarget()); // notify the cut panel (last clicked target, or selected target | null)
  };
  const onUp = (e) => {
    if (finishLeadDrag(e, true)) return;
    handlePanZoomPointerUp(e, svgEl, viewState);
  };
  const onCancel = (e) => {
    if (finishLeadDrag(e, false)) return;
    handlePanZoomPointerUp(e, svgEl, viewState);
  };
  svgEl.addEventListener('wheel', onWheel, { passive: false });
  svgEl.addEventListener('pointermove', onMove);
  svgEl.addEventListener('pointerleave', onLeave);
  svgEl.addEventListener('pointerdown', onDown);
  svgEl.addEventListener('pointerup', onUp);
  svgEl.addEventListener('pointercancel', onCancel);

  const selectedTarget = () => {
    let last = null;
    for (const v of selection.values()) last = v;
    return last;
  };
  const selectedTargets = () => [...selection.values()];
  // TASK 605: a document tab keeps its Prepare selection and view aside while another tab shows (prepare-session.js); these put them back on a fresh mount.
  const setSelection = (targets) => {
    selection.clear();
    for (const t of targets) selection.set(targetKey(t), t);
    renderSelection(); renderHover();
    onSelectionChange(selectedTarget());
  };
  const setView = (v) => { Object.assign(view, v); updateViewBox(svgEl, view); renderZoomed(); };
  const chipResizeObs = typeof ResizeObserver === 'function' ? new ResizeObserver(() => renderZoomed()) : null; // TASK 731: a resize changes world-per-px
  if (chipResizeObs) chipResizeObs.observe(svgEl);

  refreshLook(); // paint the persisted cut plan — flat tint + tool-aware look
  const unsubDocUnit = SettingsManager && SettingsManager.subscribe
    ? SettingsManager.subscribe((key) => { if (key === 'DOC_UNIT' || isPrecisionKey(key)) refreshLook(); })
    : null;

  return {
    loops, selection, resolveTarget, selectedTarget, selectedTargets, profileLoopsForTarget, setSelection, setView,
    view, viewState,
    recordFor: (t) => (t ? getCutRecord(targetKey(t)) : null),
    availableTypesFor: (t) => (t ? availableTypes(t.kind, getCutRecord(targetKey(t))) : []), // TASK 714: the stepped types need the record's slope
    holdFor: (t) => (t ? holdSummary(targetKey(t), getCutRecord(targetKey(t)), state, loops, loopPolys, ownedNow().set) : null), // TASK 742: what its Hold part does (the derivation's)
    clearingFor: (t) => (t ? clearingAvailability(targetKey(t), getCutRecord(targetKey(t)), state, loops, loopPolys) : null), // TASK 745: which Clearing choices it can take
    clearingSummaryFor: (t) => (t ? clearingSummary(targetKey(t), getCutRecord(targetKey(t)), state, loops, loopPolys, ownedNow().set) : null), // TASK 745: what its clearing is (the derivation's)
    leadInFor: (t) => (t ? leadInSummary(targetKey(t), getCutRecord(targetKey(t)), state, loops, loopPolys, ownedNow().set) : null), // TASK 778: the calculated / resolved arc summary
    contourFor: (t) => (t && t.kind !== CONTOUR_KIND ? { allowed: contourAllowed(getCutRecord(targetKey(t))), on: Boolean(contourOf(targetKey(t))) } : null), // TASK 792: the part card's Contour row
    selectContour() { // TASK 792: "Edit contour": the selected part's Contour record (its own card)
      const t = selectedTarget();
      if (t && t.kind !== CONTOUR_KIND && contourOf(targetKey(t))) this.setSelection([{ kind: CONTOUR_KIND, id: targetKey(t) }]);
    },
    noteFor(t) { // TASK 714: a stepped cut's steps / undercut, for the cut card; TASK 742: its Hold part; TASK 745: its programmed clearing
      if (!t) return [];
      const rec = getCutRecord(targetKey(t));
      return [...steppedNoteItems(rec), ...levelsNoteItems(rec, levelsSummary(targetKey(t), rec, state, loops, loopPolys, ownedNow().set)), // TASK 792: Roughing / Contour
        ...holdNoteItems(rec, this.holdFor(t)), ...clearingNoteItems(rec, this.clearingSummaryFor(t)), ...leadInNoteItems(rec, this.leadInFor(t))]; // TASK 775 / 778: an On line outline's lead-in arc
    },
    // Write the cut type onto every selected target + refresh the tool-aware look (panel calls this).
    refreshLook, // TASK 463: repaint after an undo/redo restored the cut plan
    applyCutTypeToSelected(cutType) {
      if (selection.size === 0) return null;
      const ct = cutTypeById(cutType);
      let lastRec = null;
      if (cutType === STOCK_TYPE_ID) { // ONE Stock per document: the role MOVES to this loop (the previous holder is unassigned) and the notice says so
        const targets = [...selection.values()].filter((t) => t.kind !== 'chain');
        const t = targets[targets.length - 1];
        if (!t) return null;
        const prev = stockKeyOf(CUT_PLAN), mine = targetKey(t);
        if (prev && prev !== mine) { setFieldFor(prev, 'cutType', null); onNotice('Stock moved to this loop (there is one Stock per document)'); }
        else if (!prev) onNotice('This closed loop is now the Stock: the board in Export');
        lastRec = setFieldFor(mine, 'cutType', STOCK_TYPE_ID);
        refreshLook();
        return lastRec;
      }
      for (const t of selection.values()) {
        if (t.kind === 'chain' && ct && ct.targetKind !== 'path') continue;
        const k = targetKey(t);
        if (t.kind === CONTOUR_KIND && !(ct && ct.targetKind === 'finish')) continue; // TASK 792: a part's Contour record stays a Contour
        if (ct && ct.levelsOp === 'roughing') { // TASK 714 / 792: a record with no step depth yet takes the last one used (and the last adaptive choice and resolution, TASK 717);
          // the allowance is 0 while the part has no Contour, else the declared finish allowance (owner ruling, turn 2512)
          if (!(Number(CUT_PLAN.get(k) && CUT_PLAN.get(k).stepDepth) > 0)) setFieldFor(k, 'stepDepth', lastStepDepth());
          if (typeof CUT_PLAN.get(k).adaptiveSteps !== 'boolean') setFieldFor(k, 'adaptiveSteps', lastAdaptiveSteps());
          if (!(Number(CUT_PLAN.get(k).stepDeviation) > 0)) setFieldFor(k, 'stepDeviation', lastStepDeviation());
          setFieldFor(k, 'finishAllowance', contourOf(k) ? lastFinishAllowance() : 0);
        }
        lastRec = setFieldFor(k, 'cutType', cutType);
        if (contourOf(k) && !contourAllowed(CUT_PLAN.get(k))) setContour(k, false); // TASK 792: a part whose new type takes no Contour loses it
      }
      refreshLook();
      return lastRec;
    },
    // SP1h1: persist a numeric field (cutDepth / cutOffset / toolDia) onto every selected target + refresh LIVE.
    setFieldOnSelected(field, value) {
      if (selection.size === 0) return null;
      if (field === 'stepDepth' && ![...selection.keys()].every(isContourKey)) value = rememberStepDepth(value); // TASK 714: the next cut switched to a stepped type (TASK 792: Roughing) starts from it; a Contour's fine step is its own (rememberContour)
      if (field === 'adaptiveSteps') value = rememberAdaptiveSteps(value); // TASK 717: same for adaptive stepping and its resolution
      if (field === 'stepDeviation') value = rememberStepDeviation(value);
      if (field === 'tabCount') value = rememberTabCount(value); // TASK 742: the next record turned to Tabs / Onion skin starts from them
      if (field === 'tabWidth') value = rememberTabWidth(value);
      if (field === 'holdThickness') value = rememberHoldThickness(value);
      if (field === 'stepover') value = rememberStepover(value); // TASK 745: the next pocket set to a computed clearing starts from them
      if (field === 'finishAllowance') value = rememberFinishAllowance(value);
      if (field === 'loop') value = rememberLoop(value); // TASK 750
      if (field === 'leadInSide') value = rememberLeadInSide(value); // TASK 775 / 778: Side is remembered; Radius / Sweep / Length default to calculated (null)
      if (field === 'rasterAngle') value = rememberRasterAngle(value);
      let lastRec = null;
      for (const t of selection.values()) {
        const k = targetKey(t);
        if (field === 'contour') { if (!isContourKey(k) && contourAllowed(CUT_PLAN.get(k))) lastRec = setContour(k, value === true); continue; } // TASK 792: add / remove the part's Contour (its own record)
        if (isContourKey(k)) rememberContour(field, value); // TASK 792: the next Contour starts from this one's bit / shape / step
        if (field === 'clearing' && value !== 'freehand') { // TASK 745: the Morphed spiral only where it is possible (never a silent fallback); a pocket set to a computed
          // clearing without its own values takes the last ones set (or the declared defaults)
          if (value === 'morphed') { const av = clearingAvailability(k, CUT_PLAN.get(k) || {}, state, loops, loopPolys); if (!av || av.morphed) continue; }
          const r = CUT_PLAN.get(k) || {};
          if (!(Number(r.stepover) > 0)) setFieldFor(k, 'stepover', lastStepover());
          if (!(r.finishAllowance != null && Number(r.finishAllowance) >= 0)) setFieldFor(k, 'finishAllowance', lastFinishAllowance());
          if (typeof r.loop !== 'boolean') setFieldFor(k, 'loop', lastLoop()); // TASK 750: the last Loop set (off until set)
          if (!Number.isFinite(Number(r.rasterAngle)) || r.rasterAngle === null) setFieldFor(k, 'rasterAngle', lastRasterAngle());
        }
        if (field === 'leadIn' && value === true) { // TASK 778: Radius / Sweep / Length / Position start calculated (null); Side takes lastLeadInSide()
          const r = CUT_PLAN.get(k) || {};
          if (!Object.hasOwn(r, 'leadInRadius')) setFieldFor(k, 'leadInRadius', null);
          if (!Object.hasOwn(r, 'leadInSweep')) setFieldFor(k, 'leadInSweep', null);
          if (!Object.hasOwn(r, 'leadInLength')) setFieldFor(k, 'leadInLength', null);
          if (!Object.hasOwn(r, 'leadInAt')) setFieldFor(k, 'leadInAt', null);
          if (r.leadInSide !== 'outside' && r.leadInSide !== 'inside') setFieldFor(k, 'leadInSide', lastLeadInSide());
        }
        if (field === 'holdPart' && value !== 'off') { // TASK 742: a record turned to Tabs / Onion skin without its own values takes the last ones set (or the unit's defaults)
          const r = CUT_PLAN.get(k) || {};
          if (!(r.tabCount === 'auto' || Number(r.tabCount) >= 1)) setFieldFor(k, 'tabCount', lastTabCount());
          if (!(Number(r.tabWidth) > 0)) setFieldFor(k, 'tabWidth', lastTabWidth());
          if (!(Number(r.holdThickness) > 0)) setFieldFor(k, 'holdThickness', lastHoldThickness());
        }
        lastRec = setFieldFor(k, field, value);
      }
      refreshLook();
      return lastRec;
    },
    destroy() {
      if (unsubDocUnit) unsubDocUnit();
      if (chipResizeObs) chipResizeObs.disconnect();
      svgEl.removeEventListener('wheel', onWheel);
      svgEl.removeEventListener('pointermove', onMove);
      svgEl.removeEventListener('pointerleave', onLeave);
      svgEl.removeEventListener('pointerdown', onDown);
      svgEl.removeEventListener('pointerup', onUp);
      svgEl.removeEventListener('pointercancel', onCancel);
    },
  };
}
