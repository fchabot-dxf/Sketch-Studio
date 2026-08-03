/**
 * edit-view.js
 * Mounts the shared #core sketch canvas into the Edit tab and imports
 * traced SVG geometry into it via #core/svg-import.js.
 *
 * Pattern mirrors apps/shaper/src/main.js importSvgToSketch().
 */

import { mountSketch }     from '#ui/sketch-canvas.js';
import { createToolRibbon } from '#ui/tool-ribbon.js';
import { computeImportScale, importSvgGeometry,
         multiplyMatrix, parseTransform, IDENTITY_MATRIX } from '#core/svg-import.js';
import { addSketch, activateSketch } from '#core/sketch-model.js';

const SVG_IMPORT_TAGS = new Set(['line','rect','circle','ellipse','polyline','polygon','path']);
const SKIP_SILENT     = new Set(['metadata','title','desc','defs','style']);

let designController = null;
let infoPanel        = null;
let ribbonMounted    = false;
let importSeq        = 0;

/**
 * Lazy-mount the sketch canvas the first time the Edit tab is opened.
 * Returns the controller so app.js can reference it.
 */
export function ensureEditMount() {
  if (designController) return designController;

  const svgEl     = document.getElementById('design-canvas');
  const ribbonEl  = document.getElementById('design-ribbon');
  const bodyEl    = document.getElementById('design-body');
  const emptyEl   = document.getElementById('edit-empty');

  if (!svgEl) return null;

  // Mount the shared sketch engine + renderer
  designController = mountSketch(svgEl);

  // Mount the shared tool ribbon (shared CREATE + INSPECT + CONSTRAIN groups)
  if (ribbonEl && !ribbonMounted) {
    const ribbon = createToolRibbon({ extraGroups: [] });
    ribbonEl.appendChild(ribbon.el);
    ribbonMounted = true;
  }

  // Show the canvas, hide empty state
  if (ribbonEl) ribbonEl.hidden = false;
  if (bodyEl)   bodyEl.hidden   = false;
  if (emptyEl)  emptyEl.style.display = 'none';

  return designController;
}

/**
 * Import an SVG string into the shared #core sketch as a new named sketch.
 * Called when the user clicks "Send to Editor".
 *
 * @param {string} svgText   - The raw SVG markup string from the tracer
 * @param {string} name      - Sketch name (e.g. the source filename)
 * @param {function} onStatus - Callback(message) for toast feedback
 */
export function importSvgToEdit(svgText, name, onStatus) {
  const ctrl = ensureEditMount();
  if (!ctrl) { onStatus?.('Edit canvas not ready'); return; }

  const st = ctrl.state;

  // Parse SVG text → DOM
  const parser = new DOMParser();
  const doc    = parser.parseFromString(svgText, 'image/svg+xml');
  const svg    = doc.querySelector('svg');
  if (!svg) { onStatus?.('Could not parse SVG'); return; }

  // Extract element descriptors (mirrors shaper's svgImportDescriptors)
  const descs = [], skippedEls = [];
  const walk = (parent, ctm) => {
    for (const el of parent.children) {
      const tag  = (el.tagName || '').toLowerCase();
      const tf   = el.getAttribute?.('transform') || '';
      const ectm = tf ? multiplyMatrix(ctm, parseTransform(tf)) : ctm;
      if (tag === 'g' || tag === 'svg') { walk(el, ectm); continue; }
      if (!SVG_IMPORT_TAGS.has(tag)) {
        if (tag && !SKIP_SILENT.has(tag)) skippedEls.push('<' + tag + '>');
        continue;
      }
      const a = n => el.getAttribute(n);
      const base = { tag, ctm: ectm };
      if      (tag === 'line')                 descs.push({ ...base, x1:a('x1'), y1:a('y1'), x2:a('x2'), y2:a('y2') });
      else if (tag === 'rect')                 descs.push({ ...base, x:a('x'), y:a('y'), width:a('width'), height:a('height'), rx:a('rx'), ry:a('ry') });
      else if (tag === 'circle')               descs.push({ ...base, cx:a('cx'), cy:a('cy'), r:a('r') });
      else if (tag === 'ellipse')              descs.push({ ...base, cx:a('cx'), cy:a('cy'), rx:a('rx'), ry:a('ry') });
      else if (tag === 'polyline' || tag === 'polygon') descs.push({ ...base, points:a('points') });
      else if (tag === 'path')                 descs.push({ ...base, d:a('d') });
    }
  };
  walk(svg, IDENTITY_MATRIX);

  // Compute scale from SVG width/height/viewBox
  const { scale, label, assumed } = computeImportScale({
    width:   svg.getAttribute('width'),
    height:  svg.getAttribute('height'),
    viewBox: svg.getAttribute('viewBox'),
  });

  // Import into #core state
  const { joints, shapes, stats } = importSvgGeometry(descs, {
    genJ:     () => st.genJ(),
    scale,
    idPrefix: 'tr' + (importSeq++),
  });

  const skipN = skippedEls.length + (stats.skipped || []).reduce((n, s) => n + s.count, 0);

  if (!shapes.length) {
    onStatus?.('Nothing imported' + (skipN ? ` · ${skipN} skipped` : ''));
    return;
  }

  try { st.saveState?.(); } catch (_) {}

  const sk = addSketch(st, name || 'Traced');
  activateSketch(st, sk.id);
  for (const j of joints) st.joints.set(j.id, { x: j.x, y: j.y });
  for (const s of shapes)  st.shapes.push(s);

  onStatus?.(
    `Imported ${shapes.length} shapes → ${sk.name} @ ${label}` +
    (assumed ? ' (assumed scale)' : '') +
    (skipN   ? ` · ${skipN} skipped` : '')
  );
}
