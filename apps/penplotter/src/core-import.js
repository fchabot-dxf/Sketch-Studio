// apps/penplotter/src/core-import.js — UNIFY-5: import an SVG into the #core SKETCH (constrainable, shown in the
// Design tab). MIRRORS Shaper's importSvgToSketch (no fork): a host DOM walk -> descriptors (with a composed CTM +
// each element's resolved fill/stroke) -> the PURE #core/svg-import (importSvgGeometry + parsePathSubpaths +
// computeImportScale + the matrix layer) -> the sketch's #core shapes. Per-element DIGITAL color -> state.shapeColors
// (plotter-side; the UNIFY-4c nearest-pen map derives the physical pen). DENSE imports are marked STATIC (the
// UNIFY-throttle skip holds ~60 FPS); small imports stay LIVE/constrainable. Unsupported/degraded elements are
// COUNTED + surfaced (IMPORT-3), never silently dropped.

import { importSvgGeometry, computeImportScale, parseTransform, multiplyMatrix, IDENTITY_MATRIX } from '#core/svg-import.js';
import { addSketch, activateSketch } from '#core/sketch-model.js';
import { state, findOrCreatePlotColor } from './state.js';
import { inheritPaint, penColorFor } from './svg-import.js'; // reuse the plotter's paint resolver (UNIFY-7 relocates)

const TAGS = new Set(['line', 'rect', 'circle', 'ellipse', 'polyline', 'polygon', 'path']);
const SKIP_SILENT = new Set(['metadata', 'title', 'desc', 'defs', 'style', 'clippath', 'lineargradient', 'radialgradient']);
const DENSE_THRESHOLD = 200; // > this many imported shapes -> mark the whole import STATIC (perf); small stays LIVE

// Host DOM walk: per-element descriptors { tag, ctm, color, ...rawAttrs } threading the composed CTM + inherited
// paint. Unsupported tags are counted (never silently dropped).
function extract(svg) {
  const descs = [], skipped = {};
  const bump = (k) => { skipped[k] = (skipped[k] || 0) + 1; };
  const walk = (parent, ctm, paint) => {
    for (const el of parent.children) {
      const tag = (el.tagName || '').toLowerCase();
      const tf = (el.getAttribute && el.getAttribute('transform')) || '';
      const elCtm = tf ? multiplyMatrix(ctm, parseTransform(tf)) : ctm;
      const elPaint = inheritPaint(el, paint);
      if (tag === 'g' || tag === 'svg') { walk(el, elCtm, elPaint); continue; }
      if (!TAGS.has(tag)) { if (tag && !SKIP_SILENT.has(tag)) bump('<' + tag + '>'); continue; }
      const a = (n) => el.getAttribute(n);
      const base = { tag, ctm: elCtm, color: penColorFor(elPaint) || '#000000' };
      if (tag === 'line') descs.push({ ...base, x1: a('x1'), y1: a('y1'), x2: a('x2'), y2: a('y2') });
      else if (tag === 'rect') descs.push({ ...base, x: a('x'), y: a('y'), width: a('width'), height: a('height'), rx: a('rx'), ry: a('ry') });
      else if (tag === 'circle') descs.push({ ...base, cx: a('cx'), cy: a('cy'), r: a('r') });
      else if (tag === 'ellipse') descs.push({ ...base, cx: a('cx'), cy: a('cy'), rx: a('rx'), ry: a('ry') });
      else if (tag === 'polyline' || tag === 'polygon') descs.push({ ...base, points: a('points') });
      else if (tag === 'path') descs.push({ ...base, d: a('d') });
    }
  };
  walk(svg, IDENTITY_MATRIX, { fill: null, stroke: null });
  return { descs, skipped };
}

// Import svgText into controller's #core sketch. Returns { imported, sketchName, scaleLabel, static, skippedSummary }.
export function importSvgToCore(svgText, fileName, controller) {
  const st = controller.state, engine = controller.engine;
  let doc; try { doc = new DOMParser().parseFromString(svgText, 'image/svg+xml'); } catch (_) { return { error: 'parse failed' }; }
  const svg = doc.documentElement;
  if (!svg) return { error: 'no svg root' };
  const { descs, skipped } = extract(svg);
  const { scale, label } = computeImportScale({ width: svg.getAttribute('width'), height: svg.getAttribute('height'), viewBox: svg.getAttribute('viewBox') });

  // Land the import in a NEW named sketch (like Shaper). idBase makes per-descriptor shape ids unique.
  const sk = addSketch(st, (fileName || 'Imported').replace(/\.svg$/i, '') || 'Imported');
  activateSketch(st, sk.id);
  const idBase = 'imp' + Date.now().toString(36) + '_';

  const importedIds = [];
  let seq = 0;
  // Per-descriptor so each element's DIGITAL color maps exactly to the shapes it produced. genJ is shared (unique
  // joint ids); idPrefix is unique per descriptor (unique shape ids). importSvgGeometry stats carry ellipse/S-T-A skips.
  for (const d of descs) {
    const { joints, shapes, stats } = importSvgGeometry([d], { genJ: () => engine.genJ(), scale, idPrefix: idBase + (seq++) });
    for (const j of joints) st.joints.set(j.id, { x: j.x, y: j.y });
    for (const s of shapes) { st.shapes.push(s); importedIds.push(s.id); state.shapeColors.set(s.id, d.color); }
    for (const r of (stats.skipped || [])) bumpInto(skipped, r.tag + ' ' + r.reason, r.count);
    if (d.color) findOrCreatePlotColor(d.color); // seed the physical pen palette (digital -> owned pen)
  }

  // DENSE import -> mark STATIC so the sketcher skips it per-frame (the underlay draws it); small stays LIVE.
  const dense = importedIds.length > DENSE_THRESHOLD;
  if (dense) for (const id of importedIds) state.staticShapeIds.add(id);

  const skippedSummary = Object.entries(skipped).map(([k, n]) => `${k} x${n}`).join(', ');
  return { imported: importedIds.length, sketchName: sk.name, scaleLabel: label, static: dense, skippedSummary };
}

function bumpInto(obj, k, n) { obj[k] = (obj[k] || 0) + n; }
