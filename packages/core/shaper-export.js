// packages/core/shaper-export.js — pure serializer of a Prepare cut plan → a raw machine-ready Shaper Origin SVG
// STRING. PURE (no DOM). ADDITIVE — nothing imports it yet (SketchStudio byte-identical); reused by vcarve / joints.
//
// SP1j-1: HEADER + LINE-only loops. SP1j-2 (this slice): FULL geometry + the cut-param attrs —
//   • ARCS in a loop → an `A r r 0 largeArc sweep x y` segment, DIRECTION-AWARE (the loop may walk the arc start→end
//     or end→start; the sweep flag FLIPS on reverse traversal — derived from the arc's stored [center,start,end] +
//     largeArc/sweep, NOT a chord guess). The closing edge is emitted explicitly only when it's an arc (a line is
//     left to Z, so a pure-line loop is byte-identical to SP1j-1).
//   • CIRCLE loop → `<circle cx cy r>`. Open EDGE ('edge' kind) → its true geometry `<line>` / `<path>` / `<circle>`.
//   • Cut-param attrs (attribute-first): shaper:cutDepth / cutOffset / toolDia, unit-suffixed via
//     units.format(baseMM, docUnit, {unit:true}) → docUnit drives the PARAM suffixes; the geometry stays mm-canonical
//     (viewBox + coords = world/base mm, UNSCALED). cutDepth='unset' / cutOffset 0 / no toolDia → omitted.
// All 5 cut types come from the INJECTED encoding (so #core never imports the app's CUT_TYPES). Without the
// xmlns:shaper declaration the on-tool Origin ignores every custom attr.

import { findLoops } from './loop-finder.js';
import { format } from './units.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const SHAPER_NS = 'http://www.shapertools.com/namespaces/shaper';

// number → compact string (≤ 4 dp, trailing zeros trimmed, no "-0"). World units = base mm.
function num(n) {
  let r = Math.round(Number(n) * 1e4) / 1e4;
  if (Object.is(r, -0)) r = 0;
  return String(r);
}

// Fallback SVG sweep flag (when an arc shape doesn't carry one): the sign of the signed angle start→end about center.
function angleSweep(center, start, end) {
  let d = Math.atan2(end.y - center.y, end.x - center.x) - Math.atan2(start.y - center.y, start.x - center.x);
  while (d <= -Math.PI) d += 2 * Math.PI;
  while (d > Math.PI) d -= 2 * Math.PI;
  return d > 0 ? 1 : 0;
}

// One arc SEGMENT (no leading M) from fromPos to toPos, DIRECTION-AWARE. The stored sweep is for the arc's
// start→end; if the loop traverses it end→start the flag flips. r/largeArc are direction-invariant.
function arcSeg(shape, fromPos, toPos, state) {
  const center = state.joints.get(shape.joints[0]);
  const start = state.joints.get(shape.joints[1]);
  const end = state.joints.get(shape.joints[2]);
  if (!center || !start || !end) return `L ${num(toPos.x)} ${num(toPos.y)}`; // degenerate → straight fallback
  const r = Math.hypot(start.x - center.x, start.y - center.y);
  const stored = (typeof shape.sweep === 'boolean') ? (shape.sweep ? 1 : 0) : angleSweep(center, start, end);
  const forward = Math.hypot(fromPos.x - start.x, fromPos.y - start.y) <= Math.hypot(fromPos.x - end.x, fromPos.y - end.y);
  const sweep = forward ? stored : (stored ? 0 : 1);
  const largeArc = shape.largeArc ? 1 : 0;
  return `A ${num(r)} ${num(r)} 0 ${largeArc} ${sweep} ${num(toPos.x)} ${num(toPos.y)}`;
}

// A standalone open-arc path "M start A … end" (start→end as stored) — for an open EDGE arc.
function arcPathFull(shape, state) {
  const center = state.joints.get(shape.joints[0]);
  const start = state.joints.get(shape.joints[1]);
  const end = state.joints.get(shape.joints[2]);
  if (!center || !start || !end) return '';
  const r = Math.hypot(start.x - center.x, start.y - center.y);
  const sweep = (typeof shape.sweep === 'boolean') ? (shape.sweep ? 1 : 0) : angleSweep(center, start, end);
  const largeArc = shape.largeArc ? 1 : 0;
  return `M ${num(start.x)} ${num(start.y)} A ${num(r)} ${num(r)} 0 ${largeArc} ${sweep} ${num(end.x)} ${num(end.y)}`;
}

// loopToPathD(loop, state) → a CLOSED SVG path "d" from the loop's ordered boundary (joints[] + edges[]). Lines →
// `L x y`; arcs → a direction-aware `A …` segment. A line CLOSING edge is left to Z (so a pure-line loop is identical
// to SP1j-1); an arc closing edge is drawn explicitly. Returns '' on a missing loop / joint position.
export function loopToPathD(loop, state) {
  if (!loop || !Array.isArray(loop.joints) || loop.joints.length < 2 || !state || !state.joints) return '';
  const shapeById = new Map((state.shapes || []).map((s) => [s.id, s]));
  const pos = (nid) => state.joints.get(nid);
  const edges = Array.isArray(loop.edges) ? loop.edges : [];
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

// Bounding box over the design: joint positions + circle extents (center ± r). Empty → 0,0,0,0. (Arc bulge beyond
// its endpoints is approximated by the endpoints — a deferred refinement.)
function boundsOf(state) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const ext = (x, y) => { if (x < minX) minX = x; if (y < minY) minY = y; if (x > maxX) maxX = x; if (y > maxY) maxY = y; };
  if (state && state.joints && typeof state.joints.values === 'function') {
    for (const j of state.joints.values()) if (j && Number.isFinite(j.x) && Number.isFinite(j.y)) ext(j.x, j.y);
  }
  for (const s of ((state && state.shapes) || [])) {
    if (s && s.type === 'circle' && Array.isArray(s.joints)) {
      const c = state.joints.get(s.joints[0]); const r = Number(s.radius) || 0;
      if (c && r > 0) { ext(c.x - r, c.y - r); ext(c.x + r, c.y + r); }
    }
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, w: 0, h: 0 };
  return { minX, minY, w: maxX - minX, h: maxY - minY };
}

// fill (always) + stroke (omit when 'none'), from the injected encoding.
function colorAttrs(enc) {
  let s = ` fill="${enc.fill}"`;
  if (enc.stroke && enc.stroke !== 'none') s += ` stroke="${enc.stroke}"`;
  return s;
}
// attribute-first shaper:* — cutType always; cutDepth (if set) / cutOffset (if ≠0) / toolDia (if >0) unit-suffixed.
function shaperAttrs(rec, enc, docUnit) {
  let s = ` shaper:cutType="${enc.cutType}"`;
  const dep = Number(rec.cutDepth);
  if (rec.cutDepth != null && rec.cutDepth !== 'unset' && Number.isFinite(dep)) s += ` shaper:cutDepth="${format(dep, docUnit, { unit: true })}"`;
  const off = Number(rec.cutOffset);
  if (Number.isFinite(off) && off !== 0) s += ` shaper:cutOffset="${format(off, docUnit, { unit: true })}"`;
  const tool = Number(rec.toolDia);
  if (Number.isFinite(tool) && tool > 0) s += ` shaper:toolDia="${format(tool, docUnit, { unit: true })}"`;
  return s;
}

function circleEl(s, state, common) {
  const c = state.joints.get(s.joints[0]); const r = Number(s.radius) || 0;
  return (c && r > 0) ? `<circle cx="${num(c.x)}" cy="${num(c.y)}" r="${num(r)}"${common}/>` : '';
}
// A loop → <circle> (a single-circle loop) or a closed <path>.
function loopElement(loop, state, shapeById, common) {
  if (Array.isArray(loop.edges) && loop.edges.length === 1) {
    const s = shapeById.get(loop.edges[0]);
    if (s && s.type === 'circle') return circleEl(s, state, common);
  }
  const d = loopToPathD(loop, state);
  return d ? `<path d="${d}"${common}/>` : '';
}
// An open edge → its true geometry (online/guide cut along the vector).
function edgeElement(shape, state, common) {
  if (shape.type === 'line') {
    const a = state.joints.get(shape.joints[0]), b = state.joints.get(shape.joints[1]);
    return (a && b) ? `<line x1="${num(a.x)}" y1="${num(a.y)}" x2="${num(b.x)}" y2="${num(b.y)}"${common}/>` : '';
  }
  if (shape.type === 'circle') return circleEl(shape, state, common);
  if (shape.type === 'arc') { const d = arcPathFull(shape, state); return d ? `<path d="${d}"${common}/>` : ''; }
  return '';
}

// exportShaperSVG({ state, entries, encoding, docUnit }) → an SVG string.
//   state    — { joints: Map(id→{x,y}), shapes, constraints }   (loops re-derived via findLoops at export time)
//   entries  — [{ target:{kind,id}, rec:{cutType, cutDepth, cutOffset, toolDia} }]   (the Prepare cut plan)
//   encoding — [{ id, cutType, fill, stroke }, …] INJECTED       (cutType id → the Shaper machine encoding)
//   docUnit  — 'mm' | 'cm' | 'in' — suffixes the cut PARAMS; the geometry stays mm-canonical.
export function exportShaperSVG({ state, entries, encoding, docUnit } = {}) {
  const ents = Array.isArray(entries) ? entries : [];
  const enc = Array.isArray(encoding) ? encoding : [];
  const encOf = (id) => enc.find((t) => t && t.id === id) || null;
  const shapeById = new Map(((state && state.shapes) || []).map((s) => [s.id, s]));
  const loopById = new Map(findLoops(state || {}).map((l) => [l.id, l]));

  const body = [];
  for (const e of ents) {
    if (!e || !e.target || !e.rec || !e.rec.cutType) continue;
    const c = encOf(e.rec.cutType);
    if (!c) continue;
    const common = colorAttrs(c) + shaperAttrs(e.rec, c, docUnit);
    let el = '';
    if (e.target.kind === 'loop') {
      const loop = loopById.get(e.target.id);
      if (loop) el = loopElement(loop, state, shapeById, common); // orphaned (design changed) → '' → skipped
    } else if (e.target.kind === 'edge') {
      const shape = shapeById.get(e.target.id);
      if (shape) el = edgeElement(shape, state, common);
    }
    if (el) body.push('  ' + el);
  }

  const b = boundsOf(state);
  const header = `<svg xmlns="${SVG_NS}" xmlns:shaper="${SHAPER_NS}" width="${num(b.w)}mm" height="${num(b.h)}mm" viewBox="${num(b.minX)} ${num(b.minY)} ${num(b.w)} ${num(b.h)}">`;
  return [header, ...body, '</svg>'].join('\n');
}
