// packages/ui/canvas-grid.js — the ONE shared sketcher-canvas grid (TASK 419b/421).
//
// SketchStudio's own canvas (via defaultRenderCtx in svg-renderer.js) and every host that mounts the shared Design
// canvas with `mountSketch(svg, { grid: true })` (Shaper) draw their grid from THIS module, driven by the declared
// GRID_MODE setting (#core/settings-manager.js): 'lines' (default — the grid SketchStudio always had) | 'off' | 'points'.
// Pen Plotter does NOT use it: its paper grid (apps/penplotter/src/paper-grid.js) marks the page on every plotter tab.
//
// The grid is SVG: <defs> holding <pattern id="grid"> (minor) + <pattern id="grid-heavy"> (major, nests the minor),
// then a huge <rect id="infinite-grid"> filled with url(#grid-heavy), both inserted as the FIRST children of the host
// svg (behind everything). url(#…) needs page-unique ids, so there is ONE grid per page: ensureCanvasGrid() refuses
// (dbg.warn, returns null) if those ids already exist outside the svg it was handed. Every lookup is scoped to that
// svg (svgEl.querySelector) — nothing here uses document.getElementById.
//
// 'lines' markup is deliberately IDENTICAL to the <defs>/<rect> that used to live in apps/sketchstudio/index.html
// (same ids, attribute order, values, and the same per-zoom stroke-width retune). Colours: the stroke/fill ATTRIBUTES
// keep SketchStudio's literal colours, and a tiny injected stylesheet re-routes them through --sk-grid-minor /
// --sk-grid-major (var() is not valid in SVG presentation attributes, but CSS beats them), falling back to the very
// same literals — so SketchStudio resolves to exactly its old colours while a host (Shaper's cream palette) retints.

import { dbg } from '#core/debug.js';
import SettingsManager from '#core/settings-manager.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

export const GRID_MODES = ['lines', 'off', 'points'];
export const normalizeGridMode = (m) => (GRID_MODES.includes(m) ? m : 'lines');

const MINOR_COLOR = '#CBD5E1';
const MAJOR_COLOR = '#93C5FD';

// The backmost rect (attribute ORDER matters for byte-identity with the old index.html markup).
const RECT_ATTRS = [['id', 'infinite-grid'], ['x', '-50000'], ['y', '-50000'], ['width', '100000'], ['height', '100000'], ['fill', 'url(#grid-heavy)']];

/** The <rect id="infinite-grid"> opening-tag markup for a mode ('off' hides it; the others are the old markup). */
export function gridRectMarkup(mode) {
  const attrs = RECT_ATTRS.map(([k, v]) => `${k}="${v}"`).join(' ');
  return `<rect ${attrs}${normalizeGridMode(mode) === 'off' ? ' display="none"' : ''}/>`;
}

/**
 * The inner markup of the grid <defs> for the given spacing/zoom/mode. PURE (no DOM) so it can be snapshot-tested.
 *   GRID_SIZE / GRID_MAJOR_STEP: minor / major spacing in world units (the settings' GRID_SIZE / GRID_MAJOR_STEP).
 *   scale(px): screen px → world units at the current zoom (the renderer's own `scale`).
 * 'lines' (and 'off', which only hides the rect) = today's pattern grid. 'points' = a dot at every grid intersection,
 * same spacing, heavier every GRID_MAJOR_STEP.
 */
export function gridDefsMarkup({ GRID_SIZE, GRID_MAJOR_STEP, scale, gridMode }) {
  const G = GRID_SIZE, M = GRID_MAJOR_STEP;
  if (normalizeGridMode(gridMode) === 'points') {
    // Dots stay a roughly constant on-screen size (clamped in world units so they don't balloon when zoomed in).
    const rMinor = Math.min(scale(1.25), 0.25, G / 2);
    const rMajor = Math.min(scale(2), 0.5, M / 2);
    // Minor pattern is offset by half a tile so its (cx,cy)=(G/2,G/2) dot lands exactly on (k·G, m·G).
    // Major dots sit on the heavy tile's four corners (each tile draws a quarter; neighbours complete the dot).
    return `<pattern id="grid" x="${-G / 2}" y="${-G / 2}" width="${G}" height="${G}" patternUnits="userSpaceOnUse">`
      + `<circle cx="${G / 2}" cy="${G / 2}" r="${rMinor}" fill="${MINOR_COLOR}"/></pattern>`
      + `<pattern id="grid-heavy" width="${M}" height="${M}" patternUnits="userSpaceOnUse">`
      + `<rect width="${M}" height="${M}" fill="url(#grid)"/>`
      + `<circle cx="0" cy="0" r="${rMajor}" fill="${MAJOR_COLOR}"/><circle cx="${M}" cy="0" r="${rMajor}" fill="${MAJOR_COLOR}"/>`
      + `<circle cx="0" cy="${M}" r="${rMajor}" fill="${MAJOR_COLOR}"/><circle cx="${M}" cy="${M}" r="${rMajor}" fill="${MAJOR_COLOR}"/>`
      + `</pattern>`;
  }
  // Clamp stroke widths so the lines don't saturate when zooming out (same numbers the old updateGrid used).
  const minorStroke = Math.min(scale(1), 0.2);  // max 0.2 units (10% of 2)
  const majorStroke = Math.min(scale(2), 1.0);  // max 1.0 units (10% of 10)
  return `<pattern id="grid" width="${G}" height="${G}" patternUnits="userSpaceOnUse">`
    + `<path d="M ${G} 0 L 0 0 0 ${G}" fill="none" stroke="${MINOR_COLOR}" stroke-width="${minorStroke}"/></pattern>`
    + `<pattern id="grid-heavy" width="${M}" height="${M}" patternUnits="userSpaceOnUse">`
    + `<rect width="${M}" height="${M}" fill="url(#grid)"/>`
    + `<path d="M ${M} 0 L 0 0 0 ${M}" fill="none" stroke="${MAJOR_COLOR}" stroke-width="${majorStroke}"/></pattern>`;
}

// ── DOM glue ────────────────────────────────────────────────────────────────

let stylesInjected = false;
function injectStyles() {
  if (stylesInjected || typeof document === 'undefined' || !document.head) return;
  if (document.head.querySelector('#sk-canvas-grid-styles')) { stylesInjected = true; return; }
  const s = document.createElement('style');
  s.id = 'sk-canvas-grid-styles';
  s.textContent = `#grid path{stroke:var(--sk-grid-minor,${MINOR_COLOR})}#grid circle{fill:var(--sk-grid-minor,${MINOR_COLOR})}`
    + `#grid-heavy path{stroke:var(--sk-grid-major,${MAJOR_COLOR})}#grid-heavy circle{fill:var(--sk-grid-major,${MAJOR_COLOR})}`;
  document.head.appendChild(s);
  stylesInjected = true;
}

/**
 * Idempotently make sure svgEl owns the grid <defs> + #infinite-grid rect (first children, behind everything).
 * Returns { defs, rect }, or null if it refused (no svg, or the grid ids already live outside this svg).
 */
export function ensureCanvasGrid(svgEl) {
  if (!svgEl || typeof svgEl.querySelector !== 'function') return null;
  const ownRect = svgEl.querySelector('#infinite-grid');
  const own = svgEl.querySelector('#grid');
  if (ownRect) {
    const defs = (own && own.parentNode) || svgEl.querySelector('defs');
    if (defs) return { defs, rect: ownRect };
  }
  // One grid per page: url(#grid) resolves the first match in the document, so a foreign #grid would hijack ours.
  const foreign = typeof document !== 'undefined' && document.querySelectorAll
    ? [...document.querySelectorAll('#grid, #grid-heavy, #infinite-grid')].filter((el) => !svgEl.contains(el)) : [];
  if (foreign.length) {
    dbg.warn('canvas-grid', '[canvas-grid] refusing to mount: grid ids already exist outside this svg (one grid per page)');
    return null;
  }
  injectStyles();
  const rect = document.createElementNS(SVG_NS, 'rect');
  for (const [k, v] of RECT_ATTRS) rect.setAttribute(k, v);
  const defs = document.createElementNS(SVG_NS, 'defs');
  svgEl.insertBefore(rect, svgEl.firstChild);
  svgEl.insertBefore(defs, rect);
  return { defs, rect };
}

const applied = new WeakMap(); // svgEl → last applied signature (skip the DOM write on idle frames)

/** Mount (if needed) + retune the grid on svgEl for the given spacing/zoom/mode. Returns false if it refused. */
export function updateCanvasGrid({ svgEl, GRID_SIZE, GRID_MAJOR_STEP, scale, gridMode }) {
  const parts = ensureCanvasGrid(svgEl);
  if (!parts) return false;
  const mode = normalizeGridMode(gridMode);
  const markup = gridDefsMarkup({ GRID_SIZE, GRID_MAJOR_STEP, scale, gridMode: mode });
  const sig = mode + '|' + markup;
  if (applied.get(svgEl) !== sig || !parts.defs.firstChild) {
    parts.defs.innerHTML = markup;
    if (mode === 'off') parts.rect.setAttribute('display', 'none'); else parts.rect.removeAttribute('display');
    applied.set(svgEl, sig);
  }
  return true;
}

/** updateCanvasGrid with the mode read live from the declared GRID_MODE setting (what both render ctxs call). */
export function updateGridFromSettings({ svgEl, GRID_SIZE, GRID_MAJOR_STEP, scale }) {
  return updateCanvasGrid({ svgEl, GRID_SIZE, GRID_MAJOR_STEP, scale, gridMode: SettingsManager.get('GRID_MODE') });
}
