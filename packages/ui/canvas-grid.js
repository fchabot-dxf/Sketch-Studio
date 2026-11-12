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
// 'lines' markup at the base level (fully opaque minors) is IDENTICAL to the <defs>/<rect> that used to live in apps/sketchstudio/index.html
// (same ids, attribute order, values, and the same per-zoom stroke-width retune). Zoomed OUT the grid has levels of
// detail (see gridLevel): the displayed minor spacing becomes GRID_SIZE × ratio^k (ratio = GRID_MAJOR_STEP/GRID_SIZE) so it
// never packs tighter than MIN_MINOR_PX on screen, and the minor lines fade in so level changes don't pop. Zoomed in
// it never subdivides. Snapping keeps using GRID_SIZE (input-manager.js), not the displayed level. Colours: the stroke/fill ATTRIBUTES
// keep SketchStudio's literal colours, and a tiny injected stylesheet re-routes them through --sk-grid-minor /
// --sk-grid-major (var() is not valid in SVG presentation attributes, but CSS beats them), falling back to the very
// same literals — so SketchStudio resolves to exactly its old colours while a host (Shaper's cream palette) retints.

import { dbg } from '#core/debug.js';
import SettingsManager from '#core/settings-manager.js';
import { basePer, UNITS, format as formatUnit } from '#core/units.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

export const GRID_MODES = ['lines', 'off', 'points'];
export const normalizeGridMode = (m) => (GRID_MODES.includes(m) ? m : 'lines');

// Level of detail: the displayed minor spacing is GRID_SIZE × (GRID_MAJOR_STEP/GRID_SIZE)^k, the smallest k whose
// on-screen spacing is >= MIN_MINOR_PX. Minor lines fade 0 -> 1 as that spacing grows MIN_MINOR_PX -> (1+MINOR_FADE_SPAN)×.
export const MIN_MINOR_PX = 8;
const MINOR_FADE_SPAN = 1;

const MINOR_COLOR = '#CBD5E1';
const MAJOR_COLOR = '#93C5FD';
const LABEL_COLOR = '#64748b';  // mid-grey: darker than the grid lines, lighter than geometry

export const LABEL_PX = 11;          // axis-number text size on screen, constant at any zoom
export const MIN_LABEL_GAP_PX = 40;  // never more than about one number per this many screen px along an axis

// The backmost rect (attribute ORDER matters for byte-identity with the old index.html markup).
const RECT_ATTRS = [['id', 'infinite-grid'], ['x', '-50000'], ['y', '-50000'], ['width', '100000'], ['height', '100000'], ['fill', 'url(#grid-heavy)']];

/** The <rect id="infinite-grid"> opening-tag markup for a mode ('off' hides it; the others are the old markup). */
export function gridRectMarkup(mode) {
  const attrs = RECT_ATTRS.map(([k, v]) => `${k}="${v}"`).join(' ');
  return `<rect ${attrs}${normalizeGridMode(mode) === 'off' ? ' display="none"' : ''}/>`;
}

// The grid spacing of a document unit, as DATA, in that unit. A unit with NO row (mm, cm) uses the GRID_SIZE /
// GRID_MAJOR_STEP settings (world units = mm: today's 2 / 10, still tunable in the Style panel), so the mm grid is exactly
// what it always was. A unit added later needs only a row here.
//   major     — { setting, default }: the major spacing in the unit, read from that declared setting (any positive number).
//   divisions — { setting, options }: how many minor squares per `major`, read from that declared setting (minor = major/n; snap = minor).
//   lodRatio  — the level-of-detail step (zoomed out each level multiplies the minor by it), per divisions value; `other`
//               for any value not listed. Decimal (10): x10 (0.1, 1, 10 in). Binary (2/4/8/16): x2 (1/16, 1/8, 1/4, 1/2,
//               1, then 2, 4, 8 in; the sequence starts from the chosen major M: M/16 ... M, 2M, 4M ...): every level stays a round number
//               of the chosen system, and the major follows as max(M, ratio x minor). Chosen over feet-style 6/12 in
//               because the plain doubling continues the same binary sequence with no special case.
export const GRID_INCH_DIVISIONS = [10, 2, 4, 8, 16];
export const GRID_SPACING_BY_UNIT = {
  in: { major: { setting: 'INCH_GRID_MAJOR', default: 1 }, divisions: { setting: 'INCH_GRID_DIVISIONS', options: GRID_INCH_DIVISIONS }, lodRatio: { 10: 10, other: 2 } },
};

/**
 * THE one grid spacing, in WORLD units (mm), for a document unit: { GRID_SIZE, GRID_MAJOR_STEP, lodRatio? }. PURE.
 * `settings` carries GRID_SIZE / GRID_MAJOR_STEP and any row's divisions setting (INCH_GRID_DIVISIONS). The grid drawing
 * (svg-renderer.js) and the grid snap (input-manager.js) both read it: no second copy of the spacing. lodRatio is
 * undefined for a unit with no row (gridLevel then uses major/size, as it always did).
 */
export function gridSpacing(docUnit, settings) {
  const row = GRID_SPACING_BY_UNIT[docUnit];
  if (!row) return { GRID_SIZE: settings.GRID_SIZE, GRID_MAJOR_STEP: settings.GRID_MAJOR_STEP };
  const k = basePer(docUnit);
  const asked = Number(settings[row.divisions.setting]);
  const n = row.divisions.options.includes(asked) ? asked : row.divisions.options[0];
  const askedMajor = Number(settings[row.major.setting]);
  const major = askedMajor > 0 && Number.isFinite(askedMajor) ? askedMajor : row.major.default;
  return { GRID_SIZE: (major / n) * k, GRID_MAJOR_STEP: major * k, lodRatio: row.lodRatio[n] ?? row.lodRatio.other };
}

/** The displayed grid level for a zoom: { factor, minor, major (world units), minorPx, fade (minor opacity 0..1) }. PURE. */
export function gridLevel({ GRID_SIZE, GRID_MAJOR_STEP, scale, lodRatio }) {
  // lodRatio (gridSpacing's, for units with a row) = the step between levels; absent = major/size (the mm path, unchanged).
  const ratio = lodRatio || GRID_MAJOR_STEP / GRID_SIZE;
  const pxPerUnit = 1 / scale(1);
  let factor = 1;
  // ratio <= 1 cannot subdivide into levels; keep the base grid.
  if (ratio > 1 && Number.isFinite(pxPerUnit) && pxPerUnit > 0) {
    while (GRID_SIZE * factor * pxPerUnit < MIN_MINOR_PX && factor < 1e12) factor *= ratio;
  }
  const minor = GRID_SIZE * factor;
  const minorPx = minor * pxPerUnit;
  const fade = Math.min(1, Math.max(0, (minorPx - MIN_MINOR_PX) / (MINOR_FADE_SPAN * MIN_MINOR_PX)));
  return { factor, minor, major: factor === 1 ? GRID_MAJOR_STEP : Math.max(GRID_MAJOR_STEP, minor * ratio), minorPx, fade };
}

/**
 * The inner markup of the grid <defs> for the given spacing/zoom/mode. PURE (no DOM) so it can be snapshot-tested.
 * Zoomed out, the grid coarsens (old majors become the minors) and the minors fade in smoothly; zoomed in it never
 * subdivides below GRID_SIZE. Where the base level is shown fully opaque the markup is byte-identical to the original.
 * Snapping is NOT affected (it keeps using GRID_SIZE).
 *   GRID_SIZE / GRID_MAJOR_STEP: minor / major spacing in world units (the settings' GRID_SIZE / GRID_MAJOR_STEP).
 *   scale(px): screen px → world units at the current zoom (the renderer's own `scale`).
 * 'lines' (and 'off', which only hides the rect) = the pattern grid. 'points' = a dot at every grid intersection,
 * same levels, heavier at every major.
 */
export function gridDefsMarkup({ GRID_SIZE, GRID_MAJOR_STEP, scale, gridMode, lodRatio }) {
  const { factor, minor: G, major: M, fade } = gridLevel({ GRID_SIZE, GRID_MAJOR_STEP, scale, lodRatio });
  // Fully opaque adds no attribute, so the base level stays byte-identical to the original markup.
  const op = (attr) => (fade < 1 ? ` ${attr}="${fade}"` : '');
  if (normalizeGridMode(gridMode) === 'points') {
    // Dots stay a roughly constant on-screen size (clamped in world units so they don't balloon when zoomed in).
    const rMinor = Math.min(scale(1.25), 0.25 * factor, G / 2);
    const rMajor = Math.min(scale(2), 0.5 * factor, M / 2);
    // Minor pattern is offset by half a tile so its (cx,cy)=(G/2,G/2) dot lands exactly on (k·G, m·G).
    // Major dots sit on the heavy tile's four corners (each tile draws a quarter; neighbours complete the dot).
    return `<pattern id="grid" x="${-G / 2}" y="${-G / 2}" width="${G}" height="${G}" patternUnits="userSpaceOnUse">`
      + `<circle cx="${G / 2}" cy="${G / 2}" r="${rMinor}" fill="${MINOR_COLOR}"${op('fill-opacity')}/></pattern>`
      + `<pattern id="grid-heavy" width="${M}" height="${M}" patternUnits="userSpaceOnUse">`
      + `<rect width="${M}" height="${M}" fill="url(#grid)"/>`
      + `<circle cx="0" cy="0" r="${rMajor}" fill="${MAJOR_COLOR}"/><circle cx="${M}" cy="0" r="${rMajor}" fill="${MAJOR_COLOR}"/>`
      + `<circle cx="0" cy="${M}" r="${rMajor}" fill="${MAJOR_COLOR}"/><circle cx="${M}" cy="${M}" r="${rMajor}" fill="${MAJOR_COLOR}"/>`
      + `</pattern>`;
  }
  // Clamp stroke widths so the lines don't saturate when zooming out (same numbers the old updateGrid used).
  const minorStroke = Math.min(scale(1), 0.2 * factor);  // max 0.2 units (10% of 2) at the base level
  const majorStroke = Math.min(scale(2), 1.0 * factor);  // max 1.0 units (10% of 10) at the base level
  return `<pattern id="grid" width="${G}" height="${G}" patternUnits="userSpaceOnUse">`
    + `<path d="M ${G} 0 L 0 0 0 ${G}" fill="none" stroke="${MINOR_COLOR}" stroke-width="${minorStroke}"${op('stroke-opacity')}/></pattern>`
    + `<pattern id="grid-heavy" width="${M}" height="${M}" patternUnits="userSpaceOnUse">`
    + `<rect width="${M}" height="${M}" fill="url(#grid)"/>`
    + `<path d="M ${M} 0 L 0 0 0 ${M}" fill="none" stroke="${MAJOR_COLOR}" stroke-width="${majorStroke}"/></pattern>`;
}

/**
 * The axis numbers of the grid: one at each displayed HEAVY line along the X axis (y = 0) and the Y axis (x = 0), both
 * sides of the origin (negatives carry a minus), none at 0. PURE (string). The number is the world coordinate in the file's
 * unit (world mm via the shared units.js format, its shortest form, the unit suffix stripped: the unit is the document's, shown
 * once in the Style panel). Sign convention = the app's own coordinates: world y is the SVG y (screenToWorld in coords.js:
 * y = vb.y + localY * scaleY), so y grows DOWN the screen and the Y-axis numbers below the origin are positive.
 * Rotated 90 degrees (read top-to-bottom); X numbers sit just below the axis line, Y numbers just right of it, centred on
 * their grid line. Dense levels skip numbers (every 2nd, 5th, 10th .. heavy line) so they stay >= MIN_LABEL_GAP_PX apart.
 *   vb: the viewBox { x, y, width, height }; scale(px) → world units; docUnit: 'mm' | 'cm' | 'in'.
 */
export function gridLabelsMarkup({ GRID_SIZE, GRID_MAJOR_STEP, lodRatio, scale, vb, docUnit }) {
  if (!vb || !(vb.width > 0) || !(vb.height > 0)) return '';
  const { major: M } = gridLevel({ GRID_SIZE, GRID_MAJOR_STEP, scale, lodRatio });
  const unit = UNITS.includes(docUnit) ? docUnit : 'mm';
  const majorPx = M / scale(1);
  // the smallest of 1, 2, 5, 10, 20, 50, ... heavy lines that keeps the gap
  const steps = []; for (let d = 1; d < 1e12; d *= 10) steps.push(d, 2 * d, 5 * d);
  const every = steps.find((n) => n * majorPx >= MIN_LABEL_GAP_PX) || steps[steps.length - 1];
  const step = M * every;
  const fs = scale(LABEL_PX);
  const text = (v) => formatUnit(v, unit, { unit: true }).slice(0, -unit.length);
  const out = [];
  const each = (from, to, emit) => {
    for (let i = Math.ceil(from / step); i * step <= to; i++) { if (i !== 0) emit(i * step); }
  };
  // X axis: number centred on its vertical grid line, below the axis.
  each(vb.x, vb.x + vb.width, (x) => out.push(`<text transform="translate(${x} ${scale(5)}) rotate(90)" dominant-baseline="central">${text(x)}</text>`));
  // Y axis: number centred on its horizontal grid line, right of the axis.
  each(vb.y, vb.y + vb.height, (y) => out.push(`<text transform="translate(${scale(5) + fs / 2} ${y}) rotate(90)" text-anchor="middle" dominant-baseline="central">${text(y)}</text>`));
  return `<g id="grid-labels" font-size="${fs}" pointer-events="none" style="user-select:none">${out.join('')}</g>`;
}

// ── DOM glue ────────────────────────────────────────────────────────────────

let stylesInjected = false;
function injectStyles() {
  if (stylesInjected || typeof document === 'undefined' || !document.head) return;
  if (document.head.querySelector('#sk-canvas-grid-styles')) { stylesInjected = true; return; }
  const s = document.createElement('style');
  s.id = 'sk-canvas-grid-styles';
  s.textContent = `#grid path{stroke:var(--sk-grid-minor,${MINOR_COLOR})}#grid circle{fill:var(--sk-grid-minor,${MINOR_COLOR})}`
    + `#grid-heavy path{stroke:var(--sk-grid-major,${MAJOR_COLOR})}#grid-heavy circle{fill:var(--sk-grid-major,${MAJOR_COLOR})}`
    + `#grid-labels text{fill:var(--sk-grid-label,${LABEL_COLOR});font-family:inherit}`;
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

/** Mount (if needed) + retune the grid (and its axis numbers) on svgEl for the given spacing/zoom/mode/unit. Returns false if it refused. */
export function updateCanvasGrid({ svgEl, GRID_SIZE, GRID_MAJOR_STEP, scale, gridMode, lodRatio, docUnit }) {
  const parts = ensureCanvasGrid(svgEl);
  if (!parts) return false;
  const mode = normalizeGridMode(gridMode);
  const markup = gridDefsMarkup({ GRID_SIZE, GRID_MAJOR_STEP, scale, gridMode: mode, lodRatio });
  // The axis numbers: part of the same grid, so they follow the same mode ('off' draws none) and the same levels.
  const vb = svgEl.viewBox && svgEl.viewBox.baseVal;
  const labels = mode === 'off' ? '' : gridLabelsMarkup({ GRID_SIZE, GRID_MAJOR_STEP, lodRatio, scale, vb, docUnit });
  const sig = mode + '|' + markup + '|' + labels;
  if (applied.get(svgEl) !== sig || !parts.defs.firstChild) {
    parts.defs.innerHTML = markup;
    if (mode === 'off') parts.rect.setAttribute('display', 'none'); else parts.rect.removeAttribute('display');
    let g = svgEl.querySelector('#grid-labels');
    if (g && g.parentNode) g.parentNode.removeChild(g);
    if (labels) parts.rect.insertAdjacentHTML('afterend', labels);
    applied.set(svgEl, sig);
  }
  return true;
}

/** updateCanvasGrid with the mode and unit read live from the declared GRID_MODE / DOC_UNIT settings (what both render ctxs call). */
export function updateGridFromSettings({ svgEl, GRID_SIZE, GRID_MAJOR_STEP, scale, lodRatio }) {
  return updateCanvasGrid({ svgEl, GRID_SIZE, GRID_MAJOR_STEP, scale, lodRatio, gridMode: SettingsManager.get('GRID_MODE'), docUnit: SettingsManager.get('DOC_UNIT') || 'mm' });
}
