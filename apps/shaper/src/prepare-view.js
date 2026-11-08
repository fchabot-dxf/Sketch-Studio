// Shaper Prepare view — a Prepare-LOCAL render of the shared #core sketch + LOOP hover-highlight (SP1a + SP1c).
// Draws the EDGES (lines/arcs/circles) from the SHARED designController.state — NO joints — then finds the
// topological LOOPS (#core/loop-finder) once on mount and, on mousemove, highlights the loop under the cursor
// (point-in-loop; smallest-area on overlap). Render-on-demand: no RAF — the highlight redraws only on hover-CHANGE.
// It does NOT call the shared `#ui/svg-renderer.draw()` (which draws joints + is SketchStudio's), so the shared
// renderer stays byte-identical.

import { calculateArcPath } from '#core/geometry.js';
import { findLoops, findOpenChains } from '#core/loop-finder.js';
import { cutTypeById, availableTypes, effectiveCutRecord } from './shaper.js'; // SP1f: cut-type declarations + gating
import { keyOf, parseKey, CUT_PLAN, getCutRecord, setFieldFor } from './cut-plan.js'; // SP1j-4: shared cut-plan store
import { formatShaperParam } from '#core/units.js'; // TASK 455: the depth chip text, same formatter as the export
import SettingsManager from '#core/settings-manager.js'; // SP1h4: read DOC_UNIT for the depth label
import { sampleArc, loopPolygon, polyArea, pointInPolygon, loopToPathD, chainToPathD } from '#core/loop-geometry.js'; // SKETCH-4a: lifted to #core
import { resolveProfileViews, resolveProfileForLoop, resolveProfileAtPoint, derivedProfileForLoop, resolveTargetKey, deriveProfileCuts, deriveCutFootprint, deriveCutTravel } from '#core/profile-model.js';
import { handlePanZoomPointerDown, handlePanZoomPointerMove, handlePanZoomPointerUp, handlePanZoomWheel, fitViewToExtents } from '#ui/input-handlers/pan-zoom.js';
import { screenToWorld } from '#ui/coords.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
// TASK 455: every colour/width of the Prepare look is a CSS class + --sk-prep-* token in apps/shaper/index.html (no hex here).
const EDGE_CLASS = 'sk-edge'; // idle: ONLY the thin white svg line (guide targets add sk-edge-guide)

// ── Edge render (SP1a) ───────────────────────────────────────────────────────
function edgesMarkup(state) {
  const J = state.joints, out = [];
  for (const s of (state.shapes || [])) {
    if (s.type === 'line') {
      const a = s.joints && J.get(s.joints[0]); const b = s.joints && J.get(s.joints[1]);
      if (a && b) out.push(`<line data-shape-id="${s.id}" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" class="${EDGE_CLASS}"/>`);
    } else if (s.type === 'circle') {
      const c = s.joints && J.get(s.joints[0]); const r = (typeof s.radius === 'number' && s.radius > 0) ? s.radius : 0;
      if (c && r) out.push(`<circle data-shape-id="${s.id}" cx="${c.x}" cy="${c.y}" r="${r}" class="${EDGE_CLASS}"/>`);
    } else if (s.type === 'arc') {
      const [p1, p2, p3] = (s.joints || []).map((id) => J.get(id));
      if (p1 && p2 && p3) out.push(`<path data-shape-id="${s.id}" d="${calculateArcPath(p1, p2, p3, s.subType, { largeArc: s.largeArc, sweep: s.sweep })}" class="${EDGE_CLASS}"/>`);
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
const polyMarkup = (poly, style) => `<polygon points="${poly.map((p) => p.x + ',' + p.y).join(' ')}" style="${style}"/>`;
const polyRingD = (poly) => (poly && poly.length >= 3) ? ('M ' + poly.map((p) => p.x + ' ' + p.y).join(' L ') + ' Z') : '';
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
const depthChip = (x, y, cutDepth) => {
  const v = Number(cutDepth);
  const set = cutDepth != null && cutDepth !== 'unset' && Number.isFinite(v);
  let val = 'unset', unit = '';
  if (set) { const f = formatShaperParam(v, SettingsManager.get('DOC_UNIT') || 'mm'); const i = f.lastIndexOf(' '); val = f.slice(0, i); unit = f.slice(i); }
  const w = (2 + val.length + unit.length) * 2.9 + 6, h = 8.5;
  return `<g class="sk-chip"><rect class="sk-chip-bg" x="${x - w / 2}" y="${y - h / 2}" width="${w}" height="${h}" rx="2.5"/>` +
    `<text class="sk-chip-text" x="${x}" y="${y}" text-anchor="middle" dominant-baseline="central">↓ <tspan class="sk-chip-val">${val}</tspan><tspan class="sk-chip-unit">${unit}</tspan></text></g>`;
};
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
function edgeStrokeMarkup(s, state, cls) {
  const J = state.joints;
  if (s.type === 'line') { const a = J.get(s.joints[0]), b = J.get(s.joints[1]); return (a && b) ? `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" class="${cls}"/>` : ''; }
  if (s.type === 'circle') { const c = J.get(s.joints[0]); const r = (s.radius > 0) ? s.radius : 0; return (c && r) ? `<circle cx="${c.x}" cy="${c.y}" r="${r}" class="${cls}"/>` : ''; }
  if (s.type === 'arc') { const [p1, p2, p3] = (s.joints || []).map((id) => J.get(id)); return (p1 && p2 && p3) ? `<path d="${calculateArcPath(p1, p2, p3, s.subType, { largeArc: s.largeArc, sweep: s.sweep })}" class="${cls}"/>` : ''; }
  return '';
}

// ── Cut plan (SP1f; extracted to ./cut-plan.js in SP1j-4): the per-target store + its keyOf/getCutRecord/setFieldFor
// now live in a shared module read by BOTH this look AND the SVG exporter. Behaviour unchanged — same Map. ──

// ── Mount: render edges + compute loops + wire kind-aware hover + click-to-select + cut-plan preview ──
export function mountPrepareView(state, svgEl, opts = {}) {
  if (!state || !svgEl) return { loops: [], selection: new Map(), destroy() {} };
  const onSelectionChange = opts.onSelectionChange || (() => {});
  svgEl.innerHTML = ''; // clean re-mount

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
  fitViewToExtents(svgEl, view, state);
  // SP1h4: a diagonal HATCH pattern (pocket preview colour) for the cleared region. userSpaceOnUse → world-unit
  // spacing (scales with the geometry). One <defs> per mount; referenced by the pocket cleared-region fill.
  const defs = document.createElementNS(SVG_NS, 'defs');
  // TASK 455: pocket marks = short white diagonal strokes in a regular grid, alternating "\" and "/" (a sparse X-hatch)
  defs.innerHTML = `<pattern id="prepare-pocket-marks" patternUnits="userSpaceOnUse" width="12" height="12"><g class="sk-mark">` +
    `<line x1="1.8" y1="1.8" x2="4.2" y2="4.2"/><line x1="10.2" y1="1.8" x2="7.8" y2="4.2"/>` +
    `<line x1="1.8" y1="10.2" x2="4.2" y2="7.8"/><line x1="10.2" y1="10.2" x2="7.8" y2="7.8"/></g></pattern>`;
  svgEl.appendChild(defs);
  // z-order (later = on top): cut TINT (behind) < edges < toolpath (tool-aware look) < selected < hover. Joints hidden.
  const cutG = mkGroup('prepare-cut-group');           svgEl.appendChild(cutG);
  renderPrepareGeometry(state, svgEl);                 // edges — above the cut tint
  const selectG = mkGroup('prepare-select-group');     svgEl.appendChild(selectG);
  const hoverG = mkGroup('prepare-hover-group');       svgEl.appendChild(hoverG);
  // TASK 455: the tool path + depth chip sit ABOVE the highlighted boundary (an On Line's black dashes ride on its bold mint line)
  const toolpathG = mkGroup('prepare-toolpath-group'); svgEl.appendChild(toolpathG);

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
    if (s.type === 'arc') { const samples = sampleArc(s, state, 32); return (samples.length >= 2) ? { id: s.id, kind: 'poly', samples } : null; }
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
  const sigOf = (rec) => `${rec.cutType}|${rec.toolDia}|${rec.cutOffset}|${rec.cutDepth}|${SettingsManager.get('DOC_UNIT')}`;
  const computeLook = (key, storedRec) => {
    const rec = effectiveCutRecord(storedRec); // TASK 450: On line / Guide take no offset — a stored one is ignored here
    const { kind, id } = parseKey(key);
    const t = { kind, id };
    const cuts = deriveProfileCuts(t, rec, state, loops, loopPolys);
    if (!cuts || !cuts.length) return { region: '', path: '' };
    const ct = rec && rec.cutType ? cutTypeById(rec.cutType) : null;
    if (!ct) return { region: '', path: '' };
    // TASK 455: the idle state is ONLY the svg line, so a look exists only to be drawn in the hover / selected states. Every
    // type uses the same state model; only the SHAPE differs. A Guide is a line only (no band, dashes or chip).
    if (ct.id === 'guide') return { region: '', path: '', hasTravel: false };
    // TASK 447: the FOOTPRINT of the round bit (what it really removes) comes from ONE core derivation
    // (#core/profile-model deriveCutFootprint); this view only draws the rings it returns. Uncut material (corners the
    // bit cannot reach) is simply the area the footprint does not cover — never highlighted.
    const isOnline = ct.id === 'online';
    const tpClass = isOnline ? 'sk-tp sk-tp-online' : 'sk-tp';
    let region = '', path = '', hasTravel = false, chip = null;
    for (const fp of deriveCutFootprint(cuts, rec, state)) {
      const rings = fp.rings.filter((ring) => ring.length >= 3);
      // TASK 452: the pocket's FINISH ring (the Inside/Outside band at zero offset, wall -> 2r in) under the clearing area
      const finish = (fp.finishRings || []).filter((ring) => ring.length >= 3);
      if (finish.length) region += `<path d="${finish.map(polyRingD).join(' ')}" fill-rule="nonzero" class="sk-finish"/>`;
      if (rings.length) {
        const d = rings.map(polyRingD).join(' ');
        region += `<path d="${d}" fill-rule="${fp.fillRule}" class="sk-band"/>`;
        if (fp.kind === 'pocket') region += `<path d="${d}" fill-rule="${fp.fillRule}" class="sk-pocket-marks" fill="url(#prepare-pocket-marks)"/>`;
      }
      // TASK 449: conventional TRAVEL (one core derivation): marching dashes along the bit-centre path in the travel
      // direction (CSS animation, no RAF); static arrows for prefers-reduced-motion. On line has none.
      const travel = deriveCutTravel([fp]);
      for (const t of travel) {
        path += `<path class="sk-travel" d="${polyRingD(t.path)}"/>`;
        path += `<g class="sk-travel-arrows">${t.arrows.map((a) => `<polygon transform="translate(${a.x} ${a.y}) rotate(${a.angle * 180 / Math.PI})" points="3.2,0 -2.4,2.4 -2.4,-2.4"/>`).join('')}</g>`;
        hasTravel = true;
      }
      if (fp.kind === 'pocket') {
        if (rings.length && !chip) chip = pocketLabelPoint(rings[0], rings.slice(1));
      } else if (fp.chain) {
        path += (fp.chain.shapes || []).map((s) => edgeStrokeMarkup(s, state, tpClass)).join('');
        if (!chip && fp.anchor) chip = fp.anchor;
      } else if (fp.center && !travel.length) {
        path += polyMarkup(fp.center, tpClass);
      }
      if (!chip && fp.anchor) chip = fp.anchor;
    }
    if (chip) path += depthChip(chip.x, chip.y, rec.cutDepth);
    return { region, path, hasTravel };
  };
  const getLook = (key, rec) => { const sig = sigOf(rec); const hit = lookCache.get(key); if (hit && hit.sig === sig) return hit; const look = computeLook(key, rec); look.sig = sig; lookCache.set(key, look); return look; };

  // TASK 455: the SAME state model for every cut type — idle: only the svg line; hover: dark band + bold white boundary +
  // dashed tool path + depth chip; selected: teal band + bold mint boundary + the same path/chip; selected+hover: selected with
  // a slightly brighter band. The colours are the --sk-prep-* tokens (apps/shaper/index.html).
  let hovered = null; // current hovered target { kind, id } | null
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
    toolpathG.innerHTML = out;
  };
  // idle guide lines are the one coloured exception: thin blue
  const guideShapeIds = () => {
    const ids = new Set();
    for (const [key, rec] of CUT_PLAN) {
      if (!(rec && rec.cutType === 'guide')) continue;
      const { kind, id } = parseKey(key);
      const addLoop = (lid) => { const l = loopById.get(lid); if (l) for (const e of (l.edges || [])) ids.add(e); };
      if (kind === 'loop') addLoop(id);
      else if (kind === 'chain') { const c = chainById.get(id); if (c) for (const sh of (c.shapes || [])) ids.add(sh.id); }
      else if (kind === 'profile') { const v = profileViews.get(id); if (v) { addLoop(v.outerLoopId); for (const h of (v.innerLoopIds || [])) addLoop(h); } }
    }
    return ids;
  };
  const refreshEdgeClasses = () => {
    const guides = guideShapeIds();
    svgEl.querySelectorAll('[data-shape-id]').forEach((el) => el.classList.toggle('sk-edge-guide', guides.has(el.getAttribute('data-shape-id'))));
  };
  // ONE reactive refresh: repaint the look layers (getLook recomputes only the changed target — its sig changed). Wired
  // to every cut-field change AND to hover / selection changes so the look follows the state.
  const refreshLook = () => {
    renderCuts(); renderToolpaths(); refreshEdgeClasses();
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
  };
  const onMove = (e) => {
    if (handlePanZoomPointerMove(e, svgEl, viewState)) return;
    const wp = screenToWorld(svgEl, e.clientX, e.clientY);
    if (!wp) return;
    setHover(resolveTarget(wp));
  };
  const onLeave = () => setHover(null);
  const onDown = (e) => {
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
    handlePanZoomPointerUp(e, svgEl, viewState);
  };
  svgEl.addEventListener('wheel', onWheel, { passive: false });
  svgEl.addEventListener('pointermove', onMove);
  svgEl.addEventListener('pointerleave', onLeave);
  svgEl.addEventListener('pointerdown', onDown);
  svgEl.addEventListener('pointerup', onUp);

  const selectedTarget = () => {
    let last = null;
    for (const v of selection.values()) last = v;
    return last;
  };
  const selectedTargets = () => [...selection.values()];

  refreshLook(); // paint the persisted cut plan — flat tint + tool-aware look

  return {
    loops, selection, resolveTarget, selectedTarget, selectedTargets, profileLoopsForTarget,
    view, viewState,
    recordFor: (t) => (t ? getCutRecord(targetKey(t)) : null),
    availableTypesFor: (t) => (t ? availableTypes(t.kind) : []),
    // Write the cut type onto every selected target + refresh the tool-aware look (panel calls this).
    applyCutTypeToSelected(cutType) {
      if (selection.size === 0) return null;
      const ct = cutTypeById(cutType);
      let lastRec = null;
      for (const t of selection.values()) {
        if (t.kind === 'chain' && ct && ct.targetKind !== 'path') continue;
        lastRec = setFieldFor(targetKey(t), 'cutType', cutType);
      }
      refreshLook();
      return lastRec;
    },
    // SP1h1: persist a numeric field (cutDepth / cutOffset / toolDia) onto every selected target + refresh LIVE.
    setFieldOnSelected(field, value) {
      if (selection.size === 0) return null;
      let lastRec = null;
      for (const t of selection.values()) {
        lastRec = setFieldFor(targetKey(t), field, value);
      }
      refreshLook();
      return lastRec;
    },
    destroy() {
      svgEl.removeEventListener('wheel', onWheel);
      svgEl.removeEventListener('pointermove', onMove);
      svgEl.removeEventListener('pointerleave', onLeave);
      svgEl.removeEventListener('pointerdown', onDown);
      svgEl.removeEventListener('pointerup', onUp);
    },
  };
}
