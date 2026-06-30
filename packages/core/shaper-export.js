// packages/core/shaper-export.js — pure serializer of a Prepare cut plan → a raw machine-ready Shaper Origin SVG
// STRING. PURE (no DOM). ADDITIVE — nothing imports it yet (SketchStudio byte-identical); reused by vcarve / joints.
//
// SP1j-1 (this slice): HEADER + LINE-only LOOP → one closed <path>. mm-CANONICAL — the viewBox AND the path coords
// are world units = base mm, UNSCALED; width/height are labelled mm (the base unit). The document unit is a DISPLAY
// lens only and (from SP1j-2) suffixes the per-element cut PARAMS — it never scales the geometry or the viewBox.
// ATTRIBUTE-FIRST: an explicit shaper:cutType (the cut ENCODING is INJECTED by the caller, so #core never imports the
// app's CUT_TYPES) plus the official fill/stroke. Arcs/circles, open EDGES, and the cutDepth/cutOffset/toolDia attrs
// are SP1j-2. Without the xmlns:shaper declaration the on-tool Origin ignores every custom attr.

import { findLoops } from './loop-finder.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const SHAPER_NS = 'http://www.shapertools.com/namespaces/shaper';

// number → compact string (≤ 4 dp, trailing zeros trimmed, no "-0"). World units = base mm.
function num(n) {
  let r = Math.round(Number(n) * 1e4) / 1e4;
  if (Object.is(r, -0)) r = 0;
  return String(r);
}

// loopToPathD(loop, state) → a CLOSED SVG path "d" from the loop's ordered boundary joints. SP1j-1: LINES only
// (M, then L per subsequent joint, Z). Arcs/circles = SP1j-2. Returns '' if the loop / a joint position is missing.
export function loopToPathD(loop, state) {
  if (!loop || !Array.isArray(loop.joints) || loop.joints.length < 2 || !state || !state.joints) return '';
  const pts = loop.joints.map((nid) => state.joints.get(nid));
  if (pts.some((p) => !p)) return '';
  let d = `M ${num(pts[0].x)} ${num(pts[0].y)}`;
  for (let i = 1; i < pts.length; i++) d += ` L ${num(pts[i].x)} ${num(pts[i].y)}`;
  return d + ' Z';
}

// Bounding box over ALL design joints (the workpiece bounds). Empty / missing → 0,0,0,0.
function boundsOf(state) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  if (state && state.joints && typeof state.joints.values === 'function') {
    for (const j of state.joints.values()) {
      if (!j || !Number.isFinite(j.x) || !Number.isFinite(j.y)) continue;
      if (j.x < minX) minX = j.x; if (j.y < minY) minY = j.y;
      if (j.x > maxX) maxX = j.x; if (j.y > maxY) maxY = j.y;
    }
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, w: 0, h: 0 };
  return { minX, minY, w: maxX - minX, h: maxY - minY };
}

// exportShaperSVG({ state, entries, encoding, docUnit }) → an SVG string.
//   state    — { joints: Map(id→{x,y}), shapes, constraints }   (loops re-derived via findLoops at export time)
//   entries  — [{ target:{kind,id}, rec:{cutType, …} }]          (the Prepare cut plan; only loops this slice)
//   encoding — [{ id, cutType, fill, stroke }, …] INJECTED       (cutType id → the Shaper machine encoding)
//   docUnit  — reserved (SP1j-2 cut-param suffixes); geometry is mm regardless.
export function exportShaperSVG({ state, entries, encoding } = {}) {
  const ents = Array.isArray(entries) ? entries : [];
  const enc = Array.isArray(encoding) ? encoding : [];
  const encOf = (id) => enc.find((t) => t && t.id === id) || null;

  const loopById = new Map(findLoops(state || {}).map((l) => [l.id, l]));

  const body = [];
  for (const e of ents) {
    if (!e || !e.target || !e.rec || !e.rec.cutType) continue;
    if (e.target.kind !== 'loop') continue;          // open EDGES → SP1j-2
    const loop = loopById.get(e.target.id);
    if (!loop) continue;                             // orphaned (the design changed after assignment) → skip
    const c = encOf(e.rec.cutType);
    if (!c) continue;
    const d = loopToPathD(loop, state);
    if (!d) continue;
    let attrs = `d="${d}" fill="${c.fill}"`;
    if (c.stroke && c.stroke !== 'none') attrs += ` stroke="${c.stroke}"`;
    attrs += ` shaper:cutType="${c.cutType}"`;
    body.push(`  <path ${attrs}/>`);
  }

  const b = boundsOf(state);
  const header = `<svg xmlns="${SVG_NS}" xmlns:shaper="${SHAPER_NS}" width="${num(b.w)}mm" height="${num(b.h)}mm" viewBox="${num(b.minX)} ${num(b.minY)} ${num(b.w)} ${num(b.h)}">`;
  return [header, ...body, '</svg>'].join('\n');
}
