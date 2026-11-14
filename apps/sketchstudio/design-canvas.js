// apps/sketchstudio/design-canvas.js — SketchStudio's Design canvas setup, DECLARED in one importable place (TASK 569). The page script
// (main.js) and the node test kit (tests/helpers/node-app.js) both read it, so a test drives the canvas exactly as the page sets it up:
// the initial view, the autosave buffer's options, and one frame of the render loop. No DOM is reached here except through the svg passed in.

import { SolverConfig } from '#core/solver-config.js';
import { draw } from '#ui/svg-renderer.js';
import { fitToDrawing } from '#ui/input-handlers/pan-zoom.js'; // TASK 494: frame a restored drawing
import { applyDefaultState } from '#core/state.js';

/** The page's Design canvas (index.html <svg id="svgCanvas">). */
export const CANVAS_ID = 'svgCanvas';

/** The empty starting sketch's view: about 20 world units wide, centred near the origin. */
export const INITIAL_VIEW = Object.freeze({ w: 20, x: 1.5, y: -1.5 });

/** initApp's canvas part: the state defaults (construction mode etc.), the empty store (engine.init: only j_origin), the initial view. */
export function initStudioCanvas(state, engine, svgEl) {
  // Initialize state defaults (construction mode etc.)
  try{ applyDefaultState(state); }catch(_){ }
  // initialize
  engine.init();
  // Empty starting sketch — only j_origin (created by engine.init()) exists.
  applyInitialView(state, svgEl);
}

/** Puts the initial view on the state and, once the canvas has a size, the matching viewBox on the svg (initApp). */
export function applyInitialView(state, svgEl) {
  state.view.w = INITIAL_VIEW.w;
  state.view.x = INITIAL_VIEW.x;
  state.view.y = INITIAL_VIEW.y;
  if (svgEl) {
    const rect = svgEl.getBoundingClientRect();
    if (rect.height > 0) {
      state.view.h = state.view.w / (rect.width / rect.height);
      svgEl.setAttribute('viewBox', `${state.view.x - state.view.w/2} ${state.view.y - state.view.h/2} ${state.view.w} ${state.view.h}`);
    }
  }
}

/** The options createDocumentBuffer gets from SketchStudio (no host sidecar). statusEl: the passive autosave indicator. */
export function studioBufferOptions({ state, engine, svg, statusEl }) {
  return {
    state,
    app: 'sketchstudio', canvas: svg, // TASK 474: the design records who saved it last
    onRestored: ({ reason }) => { try { engine.solve(500); } catch (_) {} if (reason !== 'switch') fitToDrawing(svg, state); }, // after the initial restore AND after Open / New / Open from file; TASK 494: the restored drawing is framed (an empty one keeps the view). TASK 587: a TAB SWITCH keeps the tab's own view (the buffer already put it back)
    onStatusChange: (s) => { statusEl.textContent = s === 'saving' ? 'Saving…' : s === 'saved' ? 'Saved' : ''; },
  };
}

/** One frame of the render loop: solve, (onSolved), draw, then the ribbon's active highlight follows state.currentTool. */
export function studioFrame({ engine, state, svg, worldGroup, ribbon, onSolved }) {
  // USE CONFIGURABLE ITERATIONS
  const iters = SolverConfig.ITERATIONS || 500;
  engine.solve(iters);
  if (onSolved) onSolved();
  draw(state.joints, state.shapes, svg, state.active, state.snapTarget, state.constraints, state.selectedJoints, state.selectedConstraints, state.currentTool, state.inference, state.selectedShapes, state.hoveredShape, state.hoveredJoint, state.hoveredConstraint, state.activeSnap, state.tempMousePos, state.drag ? true : false, worldGroup);
  // S7c-2d: sync the shared ribbon's active highlight to state.currentTool (covers KEYBOARD switchToTool, which
  // doesn't route through setTool). refresh() is a cheap class-toggle.
  if (ribbon) ribbon.refresh();
}
