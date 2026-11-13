/**
 * edit-view.js
 * Mounts the shared #core sketch canvas into the Edit tab and imports
 * traced SVG geometry into it via #core/svg-import.js.
 *
 * Uses the shared importer #ui/sketch-import.js (the same one Shaper, Pen Plotter and SketchStudio use).
 */

import { mountSketch }     from '#ui/sketch-canvas.js';
import { createToolRibbon } from '#ui/tool-ribbon.js';
import { importIntoSketch } from '#ui/sketch-import.js';


let designController = null;
let infoPanel        = null;
let ribbonMounted    = false;

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
    const ribbon = createToolRibbon({ state: designController.state, extraGroups: [], parameters: false }) // O14: Trace has no Parameters window;
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
 * Import an SVG (or DXF) text into the shared #core sketch as a new named sketch, through the ONE shared importer (#ui/sketch-import.js);
 * Trace only declares its shape-id prefix and the default sketch name. Used by "Send to Editor" and by the File menu's Import SVG / DXF…
 * Returns the importer's result { ok, message, ... }.
 */
export function importToEdit(text, name) {
  const ctrl = ensureEditMount();
  if (!ctrl) return { ok: false, message: 'Edit canvas not ready' };
  return importIntoSketch(text, name || 'Traced', ctrl, { idPrefix: 'tr' });
}
