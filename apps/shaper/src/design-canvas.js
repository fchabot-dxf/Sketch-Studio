// apps/shaper/src/design-canvas.js — Shaper's Design canvas setup, DECLARED in one importable place (TASK 569). The page script (main.js
// ensureSketch / buildDesignUI) and the node test kit (tests/helpers/node-app.js) both read it: the shared sketcher's options, the shared
// ribbon's options, and the autosave buffer's options (the Shaper sidecar = cut plan + stock). TASK 881: the SKETCHES browser's mount is shaper-browser.js (a page without the Design view, the Fusion panel build, does not load it). The page's own views (info panel,
// Prepare, Review) come in as hooks; a host without them (the kit) passes none.

import { fitToDrawing } from '#ui/input-handlers/pan-zoom.js'; // TASK 494: frame a restored drawing
import { SAME_TAB_REASONS } from '#ui/document-buffer-core.js'; // TASK 766: the same tab shown again keeps its view (TASK 881: the loop's own module, not the page-store wrapper)
import { captureShaperDoc, applyShaperDoc, DOC_VERSION } from './shaper-doc.js';
import SettingsManager from '#core/settings-manager.js';

/** The page's Design canvas (index.html <svg id="design-canvas">). */
export const DESIGN_CANVAS_ID = 'design-canvas';

/** mountSketch options (the page adds isActive / onRender / notify, which are page hooks). */
export const DESIGN_CANVAS_OPTIONS = Object.freeze({
  seedDemo: false, // PERSIST-2: the autosave buffer decides what geometry (if any) to show
  grid: true,      // GRID-1: the shared GRID_MODE-driven canvas grid (Grid / None / Draft points in the settings modal)
  profiles: true,
});

/** createToolRibbon options (the page adds notify). */
export const RIBBON_OPTIONS = Object.freeze({ profiles: true, appId: 'shaper' }); // TASK 647: appId = the user's ribbon layout is kept per app

/**
 * The options createDocumentBuffer gets from Shaper. TASK 474: the SAME restore runs after the initial restore and after Open / New / Open
 * from file (onRestored), and a design without a Shaper sidecar resets the cut plan and stock to their defaults instead of inheriting the
 * previous design's. refreshViews(): the page's views that follow the sketch (inside the same try as the solve); afterSidecar(restore): what the
 * page re-mounts once the cut plan is back (restore = the buffer's onRestored payload; TASK 741: its removedVcarves is Prepare's one-time notice). session: createShaperSession() (TASK 605). No header status text (TASK 605: the tab dot shows it).
 * showDesign(): TASK 706, the mode router's (modes.js): a design the user opens (new / Open / Open from file) is shown in Design (document-buffer.js).
 */
export function shaperBufferOptions({ controller, canvas, session = null, refreshViews = () => {}, afterSidecar = () => {}, showDesign = null, store = undefined }) {
  return {
    state: controller.state,
    app: 'shaper', canvas, showDesign,
    ...(store ? { store } : {}),
    onRestored: (restore) => {
      const { hosts, reason } = restore;
      try {
        controller.engine.solve(500);
        if (!SAME_TAB_REASONS.has(reason)) fitToDrawing(canvas, controller.state); // TASK 494: frame the restored drawing (armed until the canvas has a size). TASK 587 / 766: the same tab shown again (a switch, its Drive version loaded) keeps its own view
        refreshViews();
      } catch (_) {}
      // TASK 460: restore the cut plan AFTER the sketch (loop/chain ids are derived from shape ids, so they are stable). No sidecar (an old buffer): defaults.
      // TASK 761: reconciled with the restored sketch's regions there (shaper-doc.js applyShaperDoc); its counts ride to afterSidecar as `cutPlan` (the notice).
      const cutPlan = applyShaperDoc(hosts && hosts.shaper, controller.state);
      afterSidecar({ ...restore, cutPlan });
    },
    hostName: 'shaper', getHostData: captureShaperDoc, hostVersion: DOC_VERSION, // TASK 812 (a sidecar of a higher version is opened, never written over: document-buffer.js); TASK 460: cut plan + stock persist across reloads (and cross-app saves keep them: TASK 458)
    session, // TASK 605: the tab's in-memory stage state (shaper-session.js); the save state is the tab dot (document-tabs.js) + the canvas's data-save-state
  };
}

/**
 * U3b (TASK 583: moved out of main.js unchanged): Shaper defaults to INCH — but ONLY when the user hasn't persisted a doc-unit choice. persist:false keeps it
 * in-memory (the default never writes to the shared 'sketch-studio-settings' localStorage, so it can't leak to a same-origin SketchStudio); only an explicit
 * toggle in the Settings modal persists.
 */
export function applyShaperUnitDefault() {
  try {
    const persisted = JSON.parse(localStorage.getItem('sketch-studio-settings') || '{}');
    if (persisted.DOC_UNIT === undefined) SettingsManager.set('DOC_UNIT', 'in', { persist: false });
  } catch (_) { /* localStorage blocked */ }
}
