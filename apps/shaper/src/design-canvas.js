// apps/shaper/src/design-canvas.js — Shaper's Design canvas setup, DECLARED in one importable place (TASK 569). The page script (main.js
// ensureSketch / buildDesignUI) and the node test kit (tests/helpers/node-app.js) both read it: the shared sketcher's options, the shared
// ribbon's options, and the autosave buffer's options (the Shaper sidecar = cut plan + stock). The page's own views (info panel, Vcarve,
// Prepare, Review) come in as hooks; a host without them (the kit) passes none.

import { fitToDrawing } from '#ui/input-handlers/pan-zoom.js'; // TASK 494: frame a restored drawing
import { captureShaperDoc, applyShaperDoc } from './shaper-doc.js';

/** The page's Design canvas (index.html <svg id="design-canvas">). */
export const DESIGN_CANVAS_ID = 'design-canvas';

/** mountSketch options (the page adds isActive / onRender / notify, which are page hooks). */
export const DESIGN_CANVAS_OPTIONS = Object.freeze({
  seedDemo: false, // PERSIST-2: the autosave buffer decides what geometry (if any) to show
  grid: true,      // GRID-1: the shared GRID_MODE-driven canvas grid (Grid / None / Draft points in the settings modal)
  profiles: true,
});

/** createToolRibbon options (the page adds notify). */
export const RIBBON_OPTIONS = Object.freeze({ profiles: true });

/**
 * The options createDocumentBuffer gets from Shaper. TASK 474: the SAME restore runs after the initial restore and after Open / New / Open
 * from file (onRestored), and a design without a Shaper sidecar resets the cut plan and stock to their defaults instead of inheriting the
 * previous design's. refreshViews(): the page's views that follow the sketch (inside the same try as the solve); afterSidecar(): what the
 * page re-mounts once the cut plan is back. statusEl: the passive autosave indicator (optional).
 */
export function shaperBufferOptions({ controller, canvas, statusEl = null, refreshViews = () => {}, afterSidecar = () => {} }) {
  return {
    state: controller.state,
    app: 'shaper', canvas,
    onRestored: ({ hosts }) => {
      try {
        controller.engine.solve(500);
        fitToDrawing(canvas, controller.state); // TASK 494: frame the restored drawing (armed until the canvas has a size)
        refreshViews();
      } catch (_) {}
      // TASK 460: restore the cut plan AFTER the sketch (loop/chain ids are derived from shape ids, so they are stable). No sidecar (an old buffer): defaults.
      applyShaperDoc(hosts && hosts.shaper);
      afterSidecar();
    },
    hostName: 'shaper', getHostData: captureShaperDoc, // TASK 460: cut plan + stock persist across reloads (and cross-app saves keep them: TASK 458)
    onStatusChange: (s) => { if (statusEl) statusEl.textContent = s === 'saving' ? 'Saving…' : s === 'saved' ? 'Saved' : ''; },
  };
}
