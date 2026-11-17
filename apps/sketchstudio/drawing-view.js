// apps/sketchstudio/drawing-view.js — TASK 725: SketchStudio's DRAWING step. A clean, read-only drawing of the design, to review it and make it:
// only the solid geometry of the visible sketches and every dimension, drawn by the ONE renderer (#ui/svg-renderer.js draw) with its declared
// CLEAN_DISPLAY profile (what it hides and keeps is listed there). Nothing else: no ribbon, browser, footer, drawer handle, toast, glyph, point,
// construction, axis or grid, no selection or hover (Drawing hands the renderer no selection, hover, tool or snap).
//
//   const drawing = mountDrawingView({ state, getName });
//   drawing.setShown(true | false)   the page's step router shows / hides it (main.js)
//   drawing.frame()                  one frame: the page's render loop calls it INSTEAD of Design's frame while Drawing shows
//   drawing.fit()                    the Fit button: frames the drawing with its dimension labels
//
// Read-only: the page gates every Design key / pointer listener off while Drawing shows (setupInput's isActive); here the only input is the shared
// pan-zoom (#ui/input-handlers/pan-zoom.js: wheel zoom, left / middle drag pan, two-finger pinch + pan) on Drawing's OWN view, so Design's view is never
// touched. Always current: every frame draws the live document (state), never a copy.
//
// PRINT (owner turn 2035): the Print button (next to Fit) opens the browser's print dialog (its "Save as PDF" makes the PDF: no PDF library). The SAME
// svg is printed: the print stylesheet below shows only this view (no app chrome), and the browser's `beforeprint` (the button, Ctrl+P, or a
// print-to-PDF) lays the drawing out for paper (planPrint): a STANDARD scale (10:1 ... 1:1 ... 1:10000) chosen as the largest at which the drawing and
// its labels fit the printable area common to A4 and US Letter with 12 mm margins, the page orientation from the drawing's aspect (@page size
// landscape / portrait), black on white, and a title line (name, unit, date, scale, "Sketch Studio"). `afterprint` puts the screen view back.

import { draw, CLEAN_DISPLAY, computeDimLabelBounds } from '#ui/svg-renderer.js';
import { setupPanZoom, fitViewToExtents, updateViewBox, resetPanZoomState, FIT_MARGIN, FIT_MIN_WIDTH } from '#ui/input-handlers/pan-zoom.js';
import { computeGeometryBounds } from '#core/geometry-bounds.js';
import { visibleScene } from '#core/sketch-model.js';
import { docUnit } from '#core/settings-manager.js';
import { ensureIconSymbols } from '#ui/cursor-manager.js';
import { SHORT_VIEWPORT_QUERY } from '#ui/short-viewport.js';
import { track } from '#ui/analytics.js'; // TASK 746: the Print action is a declared feature

/** The render context Drawing draws with: the clean display profile, and nothing else (no grid mount, no active sketch, so no dimming). */
export const DRAWING_RENDER_CTX = Object.freeze({ display: CLEAN_DISPLAY });

/** One Drawing frame: the live document's visible sketches, through the ONE renderer, with no selection / hover / tool / snap. */
export function drawDrawing({ state, svg, world }) {
  const scene = visibleScene(state);
  draw(scene.joints, scene.shapes, svg, null, null, scene.constraints, new Set(), new Set(), null, null, new Set(), null, null, null, null, null, false, world, DRAWING_RENDER_CTX);
}

// ── Print layout ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** CSS px per mm (CSS: 96 px = 1 in = 25.4 mm); world units are mm (#core units: base = 1 mm). */
export const MM_PER_PX = 25.4 / 96;
/** The page margin the print stylesheet asks for (@page margin). */
export const PRINT_MARGIN_MM = 12;
/** The title line's band under the drawing. */
export const PRINT_TITLE_MM = 10;
/** The drawing area, in mm, that fits BOTH A4 (210 x 297) and US Letter (215.9 x 279.4) inside PRINT_MARGIN_MM, less the title band. */
export const PRINT_AREA_MM = Object.freeze({
  landscape: Object.freeze({ w: 255, h: 186 - PRINT_TITLE_MM }),
  portrait: Object.freeze({ w: 186, h: 255 - PRINT_TITLE_MM }),
});
/** The share of the drawing area the drawing may fill (the rest is a quiet border inside the margins). */
const PRINT_FILL = 0.95;
/** The standard scales tried, largest first: 10:1, 5:1, 2:1, 1:1, 1:2, 1:5, 1:10 ... 1:10000 (paper mm per design mm). */
export const PRINT_SCALES = Object.freeze((() => { const out = []; for (let e = 1; e >= -4; e--) for (const m of [1, 0.5, 0.2]) out.push(m * 10 ** e); return out.filter((s) => s <= 10 && s >= 1e-4); })());

/** '2:1', '1:1', '1:20' */
export function scaleText(s) {
  return s >= 1 ? `${Math.round(s)}:1` : `1:${Math.round(1 / s)}`;
}

/**
 * The paper layout of the drawing (pure): { orientation, scale, scaleText, area: {w, h} mm, view: {x, y, w, h} world }, or null for an empty drawing.
 * For each standard scale, largest first, the drawing's box (solid geometry + its dimension labels as drawn at that scale's zoom: labels keep their
 * on-screen size, 1 CSS px = 1/96 in) picks the orientation (wider than tall: landscape) and must fit PRINT_FILL of that orientation's area.
 */
export function planPrint(state) {
  const geo = computeGeometryBounds(state, { construction: CLEAN_DISPLAY.construction });
  if (!geo) return null;
  for (const s of PRINT_SCALES) {
    const zoom = MM_PER_PX / s; // world units per CSS px on the paper
    const lab = computeDimLabelBounds(state, zoom);
    const b = lab ? { minX: Math.min(geo.minX, lab.minX), minY: Math.min(geo.minY, lab.minY), maxX: Math.max(geo.maxX, lab.maxX), maxY: Math.max(geo.maxY, lab.maxY) } : geo;
    const w = b.maxX - b.minX, h = b.maxY - b.minY;
    const orientation = w >= h ? 'landscape' : 'portrait';
    const area = PRINT_AREA_MM[orientation];
    if (w * s <= area.w * PRINT_FILL && h * s <= area.h * PRINT_FILL) {
      return { orientation, scale: s, scaleText: scaleText(s), area, view: { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2, w: area.w / s, h: area.h / s } };
    }
  }
  return null;
}

/** The title line under the printed drawing. */
export function titleLine({ name, unit, date, plan }) {
  return [name || 'Untitled', 'Units: ' + unit, date, plan ? `Scale ${plan.scaleText} (print at 100%)` : 'Not to scale', 'Sketch Studio'].join('  ·  ');
}

// ── The view ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const PRINT_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 9V3.5h10V9"/><rect x="3.5" y="9" width="17" height="8" rx="1.5"/><path d="M7 14h10v6.5H7z"/><circle cx="17" cy="11.5" r="0.6" fill="currentColor"/></svg>';

let stylesInjected = false;
function injectStyles() {
  if (stylesInjected || typeof document === 'undefined' || !document.head) return;
  stylesInjected = true;
  const s = document.createElement('style');
  s.id = 'sk-drawing-styles';
  s.textContent = `
/* the Drawing view covers the page under the step bar (the header row), so nothing of Design shows through it; the ☰ drawer (z 9400+) still opens over it */
.sk-drawing { position: fixed; left: 0; right: 0; bottom: 0; top: var(--sk-header-h, 44px); z-index: 9300; background: var(--sk-drawing-paper, #ffffff); }
.sk-drawing[hidden] { display: none; }
.sk-drawing-canvas { display: block; width: 100%; height: 100%; touch-action: none; cursor: grab; }
.sk-drawing-world * { pointer-events: none; } /* nothing in the drawing is a target: a press lands on the canvas (pan) */
.sk-drawing-title { display: none; }
/* phone portrait / short landscape: Design keeps the steps in the ☰ drawer behind its peeking handle; Drawing shows the step bar instead (the way back)
   and no drawer handle over the drawing */
@media (max-width: 640px), ${SHORT_VIEWPORT_QUERY} {
  body.sk-drawing-shown { --sk-header-h: 44px; } /* the header row's desktop height (sketcher.css sets 0 px there: no header bar on phones) */
  body.sk-drawing-shown .sk-header { display: flex !important; }
  body.sk-drawing-shown .sk-sidebar-handle { display: none !important; }
}
body.sk-drawing-shown #notification-container { display: none !important; } /* no toast from Design over the drawing */
@media print {
  html, body { height: auto !important; overflow: visible !important; background: #ffffff !important; }
  body.sk-drawing-shown > :not(.sk-drawing) { display: none !important; }
  body.sk-drawing-shown .sk-drawing { position: static; display: flex; flex-direction: column; align-items: center; background: #ffffff;
    --sk-geo-fixed: #000000; --sk-constraint-stroke: #000000; --sk-muted: #ffffff; --sk-joint-fill: #000000; }
  body.sk-drawing-shown .sk-drawing-actions { display: none !important; }
  body.sk-drawing-shown .sk-drawing-canvas { flex: none; cursor: auto; }
  body.sk-drawing-shown .sk-drawing-title { display: block; box-sizing: border-box; margin-top: 2mm; padding-top: 1.5mm; border-top: 0.3mm solid #000000;
    font: 8.5pt/1.2 system-ui, -apple-system, 'Segoe UI', sans-serif; color: #000000; white-space: nowrap; overflow: hidden; }
}
`;
  document.head.appendChild(s);
}

/**
 * Mounts the (hidden) Drawing view on the page. getName(): the design's name for the print title line.
 * Returns { el, svg, world, view, isShown, setShown, frame, fit, preparePrint, endPrint }.
 */
export function mountDrawingView({ state, getName = () => '' }) {
  injectStyles();
  ensureIconSymbols(['icon-recenter']);
  const el = document.createElement('div');
  el.className = 'sk-drawing';
  el.id = 'drawing-view';
  el.hidden = true;
  el.innerHTML =
    '<svg id="drawingCanvas" class="sk-drawing-canvas" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Drawing"><g class="sk-drawing-world"></g></svg>' +
    '<div class="sk-canvas-corner sk-drawing-actions">' +
    // TASK 725 (owner turn 2035): Print sits next to Fit, the same small corner button
    '<button type="button" class="sk-corner-btn" id="btn-drawing-fit" title="Fit" aria-label="Fit the drawing"><svg viewBox="0 0 24 24" aria-hidden="true"><use href="#icon-recenter"/></svg></button>' +
    `<button type="button" class="sk-corner-btn" id="btn-drawing-print" title="Print (or Save as PDF)" aria-label="Print">${PRINT_ICON}</button>` +
    '</div>' +
    '<div class="sk-drawing-title"></div>';
  document.body.appendChild(el);
  const svg = el.querySelector('svg');
  const world = el.querySelector('.sk-drawing-world');
  const titleEl = el.querySelector('.sk-drawing-title');

  // Drawing's OWN view (Design's state.view is never read or written here), panned / zoomed by the shared pan-zoom
  const viewState = {
    view: { x: 0, y: 0, w: 100, h: 100 },
    allowEmptyPan: true, // a left drag on the drawing pans (there is no tool)
    _panZoom: { isPanning: false, lastPanPoint: null, lastTouchDistance: null, touchPoints: new Map(), isPinching: false, lastPinchCenter: null, lastPinchDistance: null },
  };
  setupPanZoom(svg, viewState, { attachListeners: true });

  let shown = false;
  let pendingFit = false; // entering Drawing frames the drawing, once it has geometry and the canvas has a size (a stored Drawing step opens before the design restores)
  let printing = null; // the screen view kept while the drawing is laid out for paper
  const sized = () => { const r = svg.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  // a press or a wheel is the user taking the view: an entry fit still pending is dropped
  svg.addEventListener('pointerdown', () => { pendingFit = false; });
  svg.addEventListener('wheel', () => { pendingFit = false; }, { passive: true });
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => { if (shown && sized()) updateViewBox(svg, viewState.view); }).observe(svg);

  const fit = () => {
    if (!sized() || !computeGeometryBounds(state, { construction: CLEAN_DISPLAY.construction })) return false;
    fitViewToExtents(svg, viewState.view, state, { padding: 1 + 2 * FIT_MARGIN, minWidth: FIT_MIN_WIDTH, construction: CLEAN_DISPLAY.construction });
    return true;
  };
  const frame = () => {
    if (!shown) return;
    if (pendingFit && !printing && fit()) pendingFit = false;
    drawDrawing({ state, svg, world });
  };
  const setShown = (on) => {
    on = !!on;
    if (on === shown) return;
    shown = on;
    el.hidden = !on;
    document.body.classList.toggle('sk-drawing-shown', on);
    resetPanZoomState(viewState);
    if (on) { pendingFit = true; frame(); }
  };

  // ── print: lay the same svg out for paper while the browser prints, then put the screen view back ──
  const pageStyle = document.createElement('style');
  pageStyle.id = 'sk-drawing-page';
  const preparePrint = () => {
    if (!shown || printing) return;
    const plan = planPrint(state);
    printing = { view: { ...viewState.view } };
    pageStyle.textContent = `@page { size: ${plan ? plan.orientation : 'auto'}; margin: ${PRINT_MARGIN_MM}mm; }`;
    document.head.appendChild(pageStyle);
    if (plan) {
      svg.style.width = plan.area.w + 'mm';
      svg.style.height = plan.area.h + 'mm';
      titleEl.style.width = plan.area.w + 'mm';
      Object.assign(viewState.view, plan.view);
      updateViewBox(svg, viewState.view);
    }
    titleEl.textContent = titleLine({ name: getName(), unit: docUnit(), date: new Date().toLocaleDateString(), plan });
    el.dataset.printScale = plan ? plan.scaleText : '';
    el.dataset.printOrientation = plan ? plan.orientation : '';
    drawDrawing({ state, svg, world }); // the drawing at the paper zoom (labels keep their size on paper)
  };
  const endPrint = () => {
    if (!printing) return;
    svg.style.width = svg.style.height = titleEl.style.width = '';
    pageStyle.remove();
    Object.assign(viewState.view, printing.view);
    printing = null;
    delete el.dataset.printScale; delete el.dataset.printOrientation;
    updateViewBox(svg, viewState.view);
    frame();
  };
  window.addEventListener('beforeprint', preparePrint);
  window.addEventListener('afterprint', endPrint);

  el.querySelector('#btn-drawing-fit').addEventListener('click', () => { pendingFit = false; fit(); frame(); });
  el.querySelector('#btn-drawing-print').addEventListener('click', () => { track('print'); window.print(); }); // TASK 746: that a print was asked for, nothing about the design

  return { el, svg, world, view: viewState.view, isShown: () => shown, setShown, frame, fit, preparePrint, endPrint };
}
