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
import { fitToDrawing } from '#ui/input-handlers/pan-zoom.js'; // TASK 494: frame a restored drawing
import { mountDesignSidePanel } from '#ui/design-side-panel.js'; // task 577b: the shared side panel with the SKETCHES tree (the same mount SketchStudio uses)
import { createDocumentBuffer } from '#ui/document-buffer.js'; // TASK 567: the SAME autosave / project buffer every other app binds its Design canvas to


let designController = null;
let docBuffer        = null;
let sidePanel        = null;

/**
 * Mount the shared sketch canvas into the Edit tab ONCE, at boot (the project buffer must exist before the first tab visit so a saved design
 * is restored whichever tab the page opens on), and bind it to the shared project store through createDocumentBuffer, exactly as Pen Plotter's
 * and Shaper's Design canvases are. The host declares ITS sidecar (doc.hosts.trace): `getHostData()` at save time, `applyHost(hosts.trace | undefined)`
 * after every restore (initial, Open, New, Open from file). `isActive()`: the Edit tab is the showing one (gates the canvas's document-level input).
 */
export function mountEdit({ isActive, getHostData, applyHost, onStatusChange }) {
  const svgEl     = document.getElementById('design-canvas');
  const ribbonEl  = document.getElementById('design-ribbon');
  const bodyEl    = document.getElementById('design-body');
  const emptyEl   = document.getElementById('edit-empty');
  if (!svgEl) return null;

  designController = mountSketch(svgEl, { isActive, seedDemo: false, onRender: () => { if (sidePanel) sidePanel.tick(); } }); // the buffer below decides what geometry (if any) to show
  const ribbon = createToolRibbon({ state: designController.state, extraGroups: [], parameters: false }); // O14: Trace has no Parameters window
  ribbonEl.appendChild(ribbon.el);
  ribbonEl.hidden = false;
  bodyEl.hidden   = false;
  emptyEl.style.display = 'none';
  // the Edit tab's side panel: the SKETCHES tree beside the canvas (#design-body is a flex row); the phone-width drawer button goes in the app header
  sidePanel = mountDesignSidePanel({ container: bodyEl, state: designController.state, engine: designController.engine, storageKey: 'trace-design-panel-collapsed', toggleHost: document.querySelector('.tr-header') });
  sidePanel.drawer.toggleEl.style.display = 'none'; // shown only while the Edit tab shows (startEdit / stopEdit)

  docBuffer = createDocumentBuffer({
    state: designController.state, app: 'trace', canvas: svgEl,
    hostName: 'trace', getHostData,
    onRestored: ({ hosts, reason }) => {
      try { designController.engine.solve(500); } catch (e) { console.error('solve after restore failed', e); }
      if (reason !== 'switch') fitToDrawing(svgEl, designController.state); // TASK 587: a tab switch keeps the tab's own view
      applyHost(hosts && hosts.trace);
    },
    onStatusChange,
  });
  docBuffer.restore();
  docBuffer.start();
  return designController;
}

/** The project buffer of this app (the File menu reads it lazily). */
export const getEditBuffer = () => docBuffer;
/** The Edit canvas's sketch state (the diagnostic report's document section reads it). */
export const getEditState = () => designController && designController.state;
/** The render loop runs only while the Edit tab shows (the same start / stop every host gives its Design canvas). */
export const startEdit = () => { if (sidePanel) sidePanel.drawer.toggleEl.style.display = ''; return designController && designController.start(); };
export const stopEdit  = () => { if (sidePanel) { sidePanel.drawer.close(); sidePanel.drawer.toggleEl.style.display = 'none'; } return designController && designController.stop(); };

/**
 * Import an SVG (or DXF) text into the shared #core sketch as a new named sketch, through the ONE shared importer (#ui/sketch-import.js);
 * Trace only declares its shape-id prefix and the default sketch name. Used by "Send to Editor" and by the File menu's Import SVG / DXF…
 * Returns the importer's result { ok, message, ... }.
 */
export function importToEdit(text, name) {
  if (!designController) return { ok: false, message: 'Edit canvas not ready' };
  return importIntoSketch(text, name || 'Traced', designController, { idPrefix: 'tr' });
}
