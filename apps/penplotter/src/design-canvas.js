// apps/penplotter/src/design-canvas.js — Pen Plotter's Design canvas setup, DECLARED in one importable place (TASK 569). The page script
// (sketch-stage.js mountSketchStage) and the node test kit (tests/helpers/node-app.js) both read it: the shared sketcher's options and the
// autosave buffer's options (the plotter sidecar = plotter-doc.js). The page's own panels come in as hooks; a host without them passes none.

import { capturePlotterDoc, applyPlotterDoc, resetPlotterDoc } from './plotter-doc.js';
import { captureHistorySession, restoreHistorySession } from './history.js';

/** mountSketch options (the page adds isActive / onRender / isStatic / shouldSolve, which are page hooks). */
export const DESIGN_CANVAS_OPTIONS = Object.freeze({
  seedDemo: false, // PERSIST-2: the autosave buffer decides what geometry to show
});

/**
 * The options createDocumentBuffer gets from Pen Plotter. TASK 474: the SAME restore runs after the initial restore and after Open / New /
 * Open from file (onRestored); a design with no plotter sidecar resets the plotter state to defaults (it must not inherit the previous
 * design's pens and toolpaths). refreshPanels(): the page's panels (inside the same try as the solve); afterSidecar(): the page's repaint
 * once the plotter document is back (it gets { reason }: a tab switch keeps the tab's own view, TASK 587). statusEl: the passive autosave indicator (optional).
 * TASK 587: `session` = the Toolpath / Export stages' own undo stacks (history.js): in memory, not in the document, so a tab keeps them aside while another is shown.
 */
export function plotterBufferOptions({ controller, canvas, statusEl = null, refreshPanels = () => {}, afterSidecar = () => {} }) {
  return {
    state: controller.state,
    app: 'penplotter', canvas,
    onRestored: ({ hosts, reason }) => {
      try { controller.engine.solve(500); refreshPanels(); } catch (_) {}
      if (hosts && hosts.penplotter) applyPlotterDoc(hosts.penplotter); else resetPlotterDoc();
      afterSidecar({ reason });
    },
    session: { capture: captureHistorySession, restore: restoreHistorySession },
    hostName: 'penplotter', getHostData: capturePlotterDoc, // TASK 451: doc size, pens, toolpaths, settings, styles ride in doc.hosts.penplotter
    onStatusChange: (s) => { if (statusEl) statusEl.textContent = s === 'saving' ? 'Saving…' : s === 'saved' ? 'Saved' : ''; },
  };
}
