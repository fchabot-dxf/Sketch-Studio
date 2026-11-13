// packages/ui/sketch-import.js — TASK 566: the ONE importer of an SVG or a DXF file into a Design canvas (a #core sketch).
//
// It does the host half of the import that used to be copied in Shaper, Pen Plotter and Trace: parse the SVG, walk the DOM threading the
// composed CTM, hand the descriptors to the PURE #core/svg-import (or the DXF text to #core/dxf-import), then land the result as ONE new
// named active sketch in ONE undo step. What differs between hosts is DECLARED as options, never branched on a host name:
//
//   importIntoSketch(text, fileName, controller, options) -> { ok, message, imported, sketch, format, fitted }
//     the parser is picked by the file extension, else by the sniffed content (looksLikeDxf); `controller.state` is the #core state and
//     `controller.svg` its canvas: TASK 570: the view is fitted to the IMPORTED shapes (the app's own fitToDrawing, here and nowhere else;
//     options.frame (optional) = () => { shapes, joints } the host wants framed instead of the imported shapes (TASK 573).
//     `fitted` = the view was set now, false when the canvas has no size yet: the fit is then armed for its first size).
//     The snapshot of the import's undo step also carries the host's data (state.hostSnapshot declared `asked`: Pen Plotter), so ONE undo
//     puts back what afterImport changed.
//     options.idPrefix        shape-id prefix (default: 'svg' / 'dxf')
//     options.silentTags      Set of lower-case tags that are structural, not dropped geometry (default: metadata title desc defs style)
//     options.inheritPaint    (el, parentPaint) -> paint: when given, the walk threads a paint down the tree and every descriptor carries
//                             it as `paint` (Pen Plotter: fill / stroke -> its pen styles)
//     options.describeElement (el) -> extra descriptor fields (Shaper: the element's cut record)
//     options.keepDescIds     keep `descId` on the imported shapes (Shaper: the cut plan is keyed by it); default: removed after afterImport
//     options.afterImport     (ctx) -> string | void, called once the shapes are in the sketch (ctx = { controller, state, format, fileName,
//                             descs, shapes, joints, sketch, root }); a returned string is added to the status message
//   mountImportDrop(el, run, { onHover })   a file dropped on `el` runs run(text, fileName)
//
// The entry in the File menu is declared ONCE here (importSidebarAction) and mounted by every host of the shared sidebar: sidebar-projects.js
// (SketchStudio, Shaper, Pen Plotter) and Trace's own createAppSidebar call; project-actions.js lists it in the project manager too.

import { computeImportScale, importSvgGeometry, multiplyMatrix, parseTransform, IDENTITY_MATRIX } from '#core/svg-import.js';
import { importDxf, looksLikeDxf } from '#core/dxf-import.js';
import { addSketch, activateSketch } from '#core/sketch-model.js';
import { newShapeId } from '#core/shape-id.js';
import { fitToDrawing } from './input-handlers/pan-zoom.js';
import { browserFileSeam, IMPORT_FILE_PICK } from './project-file.js';

export const IMPORT_ACTION_LABEL = 'Import SVG / DXF…';

/** Pick an SVG / DXF with the file chooser and hand its text to `importFile(text, fileName)`; resolves null when the picker was cancelled. */
export async function pickAndImport(importFile) {
  const picked = await browserFileSeam.open(IMPORT_FILE_PICK);
  if (!picked) return null;
  await importFile(picked.text, picked.name);
}

/** The File-menu action for createAppSidebar's `actions`. `getSidebar()` is the sidebar it is mounted in (read at click time): a failure shows in
 *  its drawer and changes nothing; success closes the drawer (the host shows the import's own status). */
export function importSidebarAction({ importFile, getSidebar, icon }) {
  return {
    id: 'import-file', label: IMPORT_ACTION_LABEL, icon, keepOpen: true,
    tooltip: 'Import an SVG (e.g. the Shaper Fusion add-in) or a Fusion sketch DXF into a new sketch',
    onClick: async () => {
      const sidebar = getSidebar();
      try { await pickAndImport(importFile); sidebar.close(); } catch (e) { sidebar.notify(e.message || String(e), 'error'); }
    },
  };
}

const SVG_IMPORT_TAGS = new Set(['line', 'rect', 'circle', 'ellipse', 'polyline', 'polygon', 'path']);
const DEFAULT_SILENT_TAGS = new Set(['metadata', 'title', 'desc', 'defs', 'style']); // structural, not dropped geometry

/** Parse SVG text into its root <svg> element; throws an Error with a readable message. */
export function parseSvgText(text) {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const err = doc.querySelector('parsererror');
  if (err) throw new Error(err.textContent.replace(/\s+/g, ' ').trim().slice(0, 200));
  const svg = doc.documentElement;
  if (!svg || svg.tagName.toLowerCase() !== 'svg') throw new Error('Root element is not <svg>');
  return svg;
}

// The DOM walk: per-element descriptors { tag, ctm, descId, [paint], ...rawAttrs }, threading the composed CTM down the tree so nested group
// art (potrace / Illustrator / Inkscape wrap ALL art in one transformed group) imports placed + un-flipped. Unsupported tags are collected.
function svgDescriptors(svg, { silentTags = DEFAULT_SILENT_TAGS, inheritPaint = null, describeElement = null } = {}) {
  const descs = [], skippedEls = [];
  let descSeq = 0;
  const walk = (parent, ctm, paint) => {
    for (const el of parent.children) {
      const tag = (el.tagName || '').toLowerCase();
      const tf = (el.getAttribute && el.getAttribute('transform')) || '';
      const elCtm = tf ? multiplyMatrix(ctm, parseTransform(tf)) : ctm;
      const elPaint = inheritPaint ? inheritPaint(el, paint) : null;
      if (tag === 'g' || tag === 'svg') { walk(el, elCtm, elPaint); continue; } // groups (and a nested svg) recurse
      if (!SVG_IMPORT_TAGS.has(tag)) { if (tag && !silentTags.has(tag)) skippedEls.push('<' + tag + '>'); continue; }
      const a = (n) => el.getAttribute(n);
      const base = { tag, ctm: elCtm, descId: 'desc_' + (descSeq++), ...(elPaint ? { paint: elPaint } : {}), ...(describeElement ? describeElement(el) : {}) };
      if (tag === 'line') descs.push({ ...base, x1: a('x1'), y1: a('y1'), x2: a('x2'), y2: a('y2') });
      else if (tag === 'rect') descs.push({ ...base, x: a('x'), y: a('y'), width: a('width'), height: a('height'), rx: a('rx'), ry: a('ry') });
      else if (tag === 'circle') descs.push({ ...base, cx: a('cx'), cy: a('cy'), r: a('r') });
      else if (tag === 'ellipse') descs.push({ ...base, cx: a('cx'), cy: a('cy'), rx: a('rx'), ry: a('ry') });
      else if (tag === 'polyline' || tag === 'polygon') descs.push({ ...base, points: a('points') });
      else if (tag === 'path') descs.push({ ...base, d: a('d') });
    }
  };
  walk(svg, IDENTITY_MATRIX, inheritPaint ? { fill: null, stroke: null } : null);
  return { descs, skippedEls };
}

// the skipped elements as { tag, reason, count } rows, like the parsers' own stats.skipped
function skipRows(skippedEls, parserSkipped) {
  const rows = (parserSkipped || []).map((s) => ({ ...s }));
  for (const tag of skippedEls) { const r = rows.find((x) => x.tag === tag && x.reason === 'not imported'); if (r) r.count++; else rows.push({ tag, reason: 'not imported', count: 1 }); }
  return rows;
}

export function importIntoSketch(text, fileName, controller, options = {}) {
  const st = controller.state;
  const format = looksLikeDxf(fileName, text) ? 'dxf' : 'svg';
  const fail = (message) => ({ ok: false, message, imported: 0, sketch: null, format });
  const genJ = () => st.genJ();
  const idPrefix = newShapeId(options.idPrefix || format);

  let parsed, descs = [], root = null, label, assumed = false, construction = 0, skipped;
  if (format === 'dxf') {
    // DXF (Fusion: right-click the sketch > Save As DXF): true lines / arcs / circles / beziers, static, units from $INSUNITS,
    // DASHED lines = construction geometry. A malformed file is a readable status, never a throw into the UI.
    const res = importDxf(text, { genJ, idPrefix });
    if (res.error) return fail('Import failed: ' + res.error);
    parsed = res;
    ({ label, assumed } = res.stats); construction = res.stats.construction || 0;
    skipped = skipRows([], res.stats.skipped);
  } else {
    let svg; try { svg = parseSvgText(text); } catch (e) { return fail('Import failed: ' + e.message); }
    let skippedEls;
    ({ descs, skippedEls } = svgDescriptors(svg, options));
    root = { width: svg.getAttribute('width'), height: svg.getAttribute('height'), viewBox: svg.getAttribute('viewBox') };
    const sc = computeImportScale(root);
    label = sc.label; assumed = sc.assumed;
    parsed = importSvgGeometry(descs, { genJ, scale: sc.scale, idPrefix });
    skipped = skipRows(skippedEls, parsed.stats.skipped);
  }
  const { joints, shapes } = parsed;
  const skipN = skipped.reduce((n, s) => n + s.count, 0);
  if (!shapes.length) return fail('Nothing imported' + (skipN ? ` · ${skipN} skipped` : ''));

  // ONE undo step: the state before the import is saved once, then the sketch + its joints + its shapes are added.
  st.saveState('import ' + (fileName || 'file'), { host: true });
  const sketch = addSketch(st, (fileName || 'Imported').replace(/\.(svg|dxf)$/i, '') || 'Imported');
  activateSketch(st, sketch.id);
  for (const j of joints) st.joints.set(j.id, { x: j.x, y: j.y });
  for (const s of shapes) st.shapes.push(s);

  const extra = options.afterImport ? options.afterImport({ controller, state: st, format, fileName, descs, shapes, joints, sketch, root }) : null;
  if (!options.keepDescIds) for (const s of shapes) delete s.descId;

  // TASK 570: frame the imported shapes (not the whole drawing): the same fit a restored drawing gets, through a view of the state that holds only them.
  // TASK 573: a host may declare WHAT is framed instead: options.frame() -> { shapes, joints } (e.g. Pen Plotter: its paper rectangle). Still ONE fit.
  const framed = options.frame ? options.frame() : { shapes };
  const fitted = fitToDrawing(controller.svg, Object.create(st, Object.fromEntries(Object.entries(framed).map(([k, v]) => [k, { value: v }]))));

  const detail = skipped.map((s) => `${s.tag} ${s.reason} ×${s.count}`).join('; ');
  const message = `Imported ${shapes.length} shapes → ${sketch.name} @ ${label}${assumed ? ' (assumed)' : ''}` +
    (construction ? ` · ${construction} construction` : '') + (extra ? ` · ${extra}` : '') + (skipN ? ` · ${skipN} skipped/degraded: ${detail}` : '');
  return { ok: true, message, imported: shapes.length, sketch, format, fitted };
}

/** A file dropped on `el` runs run(text, fileName) (the first file; the parser is picked from the name / content). onHover(bool) shows a drop cue. */
export function mountImportDrop(el, run, { onHover = null } = {}) {
  const hasFiles = (e) => !!(e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files'));
  el.addEventListener('dragover', (e) => { if (!hasFiles(e)) return; e.preventDefault(); if (onHover) onHover(true); });
  // dragleave also fires when the pointer crosses onto a CHILD: only report leaving when it truly left
  el.addEventListener('dragleave', (e) => { if (onHover && !el.contains(e.relatedTarget)) onHover(false); });
  el.addEventListener('drop', async (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault(); if (onHover) onHover(false);
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) await run(await f.text(), f.name);
  });
}
