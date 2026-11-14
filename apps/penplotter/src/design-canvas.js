// apps/penplotter/src/design-canvas.js — Pen Plotter's Design canvas setup, DECLARED in one importable place (TASK 569). The page script
// (sketch-stage.js mountSketchStage) and the node test kit (tests/helpers/node-app.js) both read it: the shared sketcher's options and the
// autosave buffer's options (the plotter sidecar = plotter-doc.js). The page's own panels come in as hooks; a host without them passes none.

import { capturePlotterDoc, applyPlotterDoc, resetPlotterDoc } from './plotter-doc.js';
import { captureHistorySession, restoreHistorySession } from './history.js';
import { state } from './state.js';

/** mountSketch options (the page adds isActive / onRender / isStatic / shouldSolve, which are page hooks). */
export const DESIGN_CANVAS_OPTIONS = Object.freeze({
  seedDemo: false, // PERSIST-2: the autosave buffer decides what geometry to show
  grid: true,      // the shared GRID_MODE-driven canvas grid, over the paper (the paper rectangle is drawn by sketch-stage.js paperGridMarkup)
});

/**
 * TASK 605: a Pen Plotter DOCUMENT TAB's in-memory state (not in the document or the sidecar): the Toolpath / Export undo stacks (history.js, TASK 587) and what is selected
 * in the Toolpath stage: the selected toolpaths, the toolpath whose targets are being edited, the selected pen folder, the selected shapes. Captured when the tab is put aside,
 * restored when it comes back; restore(undefined) = a design with none yet (nothing selected). Ids are per document ("toolpath3" exists in both of two designs), so a
 * selection must never carry over to another tab. Not kept (derived or per app): the toolpath preview (recomputed on every switch: afterSidecar), the pan / zoom (the
 * buffer keeps the shared view), the stage and the tool (the app's, not the document's), the Recalculate-pending flag (the preview is recomputed on a switch).
 */
export function captureTabSession() {
  return {
    history: captureHistorySession(),
    selectedToolpathIds: [...state.selectedToolpathIds], targetEditingToolpathId: state.targetEditingToolpathId,
    selectedPenId: state.selectedPenId, selectedShapeIds: [...state.selectedShapeIds],
  };
}
export function restoreTabSession(s) {
  restoreHistorySession(s && s.history);
  state.selectedToolpathIds = new Set(s ? s.selectedToolpathIds : []);
  state.targetEditingToolpathId = s ? s.targetEditingToolpathId : null;
  state.selectedPenId = s ? s.selectedPenId : null;
  state.selectedShapeIds = new Set(s ? s.selectedShapeIds : []);
}

/**
 * The options createDocumentBuffer gets from Pen Plotter. TASK 474: the SAME restore runs after the initial restore and after Open / New /
 * Open from file (onRestored); a design with no plotter sidecar resets the plotter state to defaults (it must not inherit the previous
 * design's pens and toolpaths). refreshPanels(): the page's panels (inside the same try as the solve); afterSidecar(): the page's repaint
 * once the plotter document is back (it gets { reason }: a tab switch keeps the tab's own view, TASK 587). afterSession(): the page repaints once the tab's session is back (TASK 605). No header status text: the tab dot shows the save state (TASK 605).
 * TASK 587: `session` = the Toolpath / Export stages' own undo stacks (history.js): in memory, not in the document, so a tab keeps them aside while another is shown.
 */
export function plotterBufferOptions({ controller, canvas, refreshPanels = () => {}, afterSidecar = () => {}, afterSession = () => {} }) {
  return {
    state: controller.state,
    app: 'penplotter', canvas,
    onRestored: ({ hosts, reason }) => {
      try { controller.engine.solve(500); refreshPanels(); } catch (_) {}
      if (hosts && hosts.penplotter) applyPlotterDoc(hosts.penplotter); else resetPlotterDoc();
      afterSidecar({ reason });
    },
    session: { capture: captureTabSession, restore: (s) => { restoreTabSession(s); afterSession(); } }, // TASK 605: afterSession() = the page repaints with the tab's own selection
    hostName: 'penplotter', getHostData: capturePlotterDoc, // TASK 451: doc size, pens, toolpaths, settings, styles ride in doc.hosts.penplotter
  };
}
