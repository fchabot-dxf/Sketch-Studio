// apps/penplotter/src/core-import.js — UNIFY-5 / TASK 478 / TASK 566: import an SVG or a DXF into the #core SKETCH (constrainable, shown in the
// Design tab) through the ONE shared importer (#ui/sketch-import.js). What is the plotter's own is declared as options: the paint resolver
// (each element's fill / stroke), the extra structural tags, the shape-id prefix, and afterImport, which gives every imported shape its
// DIGITAL style -> state.shapeStyles (the UNIFY-4c nearest-pen map derives the physical pen), a pen for every colour, marks the geometry
// STATIC (imported art DISPLAYS in its pen colours via the underlay; select a subset to constrain it) and sets the paper size.
// Unsupported / degraded elements are COUNTED + surfaced (IMPORT-3) by the shared message, never silently dropped.

import { computeImportSize } from '#core/svg-import.js';
import { importIntoSketch } from '#ui/sketch-import.js';
import { state, findOrCreatePlotColor, makeShapeStyle, DEFAULT_STROKE_WIDTH } from './state.js';
import { inheritPaint, penColorFor } from './svg-import.js'; // the plotter's paint resolver (UNIFY-7 relocates)
import { setDocSize } from './settings.js';                  // IMPORT-DOC-SIZE: the import defines the paper size

const SILENT_TAGS = new Set(['metadata', 'title', 'desc', 'defs', 'style', 'clippath', 'lineargradient', 'radialgradient']);

// returns the paper-size note of the status message when the import changed the paper (`paperSet` reports it to the caller)
function afterImport({ format, descs, shapes, root }, paperSet) {
  const byDesc = new Map(descs.map((d) => [d.descId, d]));
  const styleOf = new Map(); // descId -> the style record of that element (one per element, copied per shape)
  const black = makeShapeStyle('#000000', null, DEFAULT_STROKE_WIDTH); // a DXF carries no paint: every shape gets the default pen
  for (const s of shapes) {
    const d = byDesc.get(s.descId);
    if (d && !styleOf.has(s.descId)) {
      // STYLE-1: one style record from the element's RESOLVED paint. An element with neither fill nor stroke is black-filled per SVG's
      // default (what penColorFor assumes), so fall back to that colour as the STROKE rather than leaving the shape paintless.
      const color = penColorFor(d.paint) || '#000000';
      const style = makeShapeStyle(d.paint.stroke || (d.paint.fill ? null : color), d.paint.fill || null, DEFAULT_STROKE_WIDTH);
      styleOf.set(s.descId, style);
      // ONE rule (TASK 465): every colour an element paints with gets a pen: its STROKE colour and its FILL colour.
      for (const c of [style.stroke, style.fill]) if (c) findOrCreatePlotColor(c);
    }
    const style = d ? styleOf.get(s.descId) : black;
    state.shapeStyles.set(s.id, { ...style });
    state.staticShapeIds.add(s.id);
  }
  if (format === 'dxf') findOrCreatePlotColor(black.stroke);
  // IMPORT-DOC-SIZE: the SVG's size (from the SAME scale its coordinates were baked with) defines the paper; null = unknowable -> keep the doc
  const size = root ? computeImportSize(root) : null;
  if (size && setDocSize(size.w, size.h)) { paperSet(); return `paper ${state.doc.w}×${state.doc.h} mm`; }
  return null;
}

/** Import `text` (an SVG or a DXF) into controller's #core sketch. Returns the shared result plus `docSet` (the paper size was changed). */
export function importFileToCore(text, fileName, controller) {
  let docSet = false;
  const res = importIntoSketch(text, fileName, controller, { idPrefix: 'imp', silentTags: SILENT_TAGS, inheritPaint, afterImport: (ctx) => afterImport(ctx, () => { docSet = true; }) });
  return { ...res, docSet };
}
