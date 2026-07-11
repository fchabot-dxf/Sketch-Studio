// apps/penplotter/src/mix-toolpaths.js — COLOR-MIX-3: wire the pure color-mix (#core/color-mix) into the plotter's
// EXISTING fill/toolpath/export pipeline. An OPT-IN: a shape whose digital color the pen palette can't hit is
// reproduced as INTERLEAVED per-pen cross-hatch — one FILL toolpath per pen (pattern=hatch, spacing=penWidth/weight,
// distinct angle, pen=penId), targeting the shape. buildGcodeEntries then emits one gcode file PER pen (the existing
// pipeline, unchanged). Default stays nearest-single-pen (UNIFY-4c): a single pen within tolerance -> no mix.
//
// Each created toolpath is tagged `mixOf: shapeId` (+ `mixWeight`) so the mix is idempotent (re-apply replaces it),
// removable (clearMix), and surfaceable (the Design panel shows pens + weights). Plotter-side; the math is #core.

import { state, makeToolpath, DEFAULT_PEN_WIDTH } from './state.js';
import { mixForColor, mixFillParams } from '#core/color-mix.js';

const MIX_TOLERANCE = 16; // matches mixForColor's default: within this RGB distance of a single pen -> no mix.

// The pen-mix for a shape's DIGITAL color over the owned palette, or null when it has no color / the palette is empty.
// state.plotColors ({id,color,width}) is accepted directly by mixForColor (lenient {id,color} pens).
export function mixForShape(shapeId) {
  const hex = state.shapeColors.get(shapeId);
  if (!hex || !state.plotColors.length) return null;
  return mixForColor(hex, state.plotColors, { tolerance: MIX_TOLERANCE });
}

export function isMixed(shapeId) {
  return state.toolpaths.some(tp => tp.mixOf === shapeId);
}

// The mix toolpaths for a shape (in creation order) — for surfacing pens + weights.
export function mixToolpathsFor(shapeId) {
  return state.toolpaths.filter(tp => tp.mixOf === shapeId);
}

// Remove a shape's mix toolpaths; returns how many were removed. Keeps activeToolpathId valid.
export function clearMix(shapeId) {
  const before = state.toolpaths.length;
  state.toolpaths = state.toolpaths.filter(tp => tp.mixOf !== shapeId);
  if (state.activeToolpathId && !state.toolpaths.some(tp => tp.id === state.activeToolpathId)) {
    state.activeToolpathId = state.toolpaths.length ? state.toolpaths[0].id : null;
  }
  return before - state.toolpaths.length;
}

const penWidthOf = (penId) => {
  const p = state.plotColors.find(pc => pc.id === penId);
  return (p && p.width != null) ? p.width : DEFAULT_PEN_WIDTH;
};
const penNameOf = (penId) => {
  const p = state.plotColors.find(pc => pc.id === penId);
  return p ? (p.name || p.color || penId) : penId;
};

/**
 * applyMix(shapeId) -> { mixed, pens }
 *   Reproduce shapeId's out-of-palette color as a pen-mix: one FILL toolpath per pen (reusing makeToolpath + the fill
 *   pipeline). Idempotent (replaces any prior mix for the shape). A SINGLE pen within tolerance -> { mixed:false } (no
 *   toolpaths created; the default nearest-single-pen behaviour applies). `pens` = the per-pen fill params used.
 */
export function applyMix(shapeId) {
  clearMix(shapeId);
  const mix = mixForShape(shapeId);
  if (!mix || mix.length <= 1) return { mixed: false, pens: mix || [] }; // single pen within tol -> no mix (default)

  const params = mixFillParams(mix, penWidthOf); // spacing = each pen's width / its weight; distinct angle per pen
  for (const pr of params) {
    const tp = makeToolpath(`Mix ${penNameOf(pr.penId)}`, 'fill');
    tp.targetShapeIds = [shapeId];
    tp.plotColorId = pr.penId;
    tp.fill = { pattern: 'hatch', angle: pr.angle, spacing: pr.spacing, offset: 0 };
    tp.mixOf = shapeId;         // provenance: this toolpath is part of shapeId's color mix
    tp.mixWeight = pr.weight;
    state.toolpaths.push(tp);
  }
  return { mixed: true, pens: params };
}

// A human-readable summary "Mix: Red 50% + Yellow 50%" for the Design panel, or '' when the shape isn't mixed.
export function mixSummary(shapeId) {
  const tps = mixToolpathsFor(shapeId);
  if (!tps.length) return '';
  return 'Mix: ' + tps.map(tp => `${penNameOf(tp.plotColorId)} ${Math.round((tp.mixWeight || 0) * 100)}%`).join(' + ');
}
