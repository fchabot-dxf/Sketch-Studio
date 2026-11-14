// apps/shaper/src/modes.js — Shaper's MODE ROUTER, DECLARED in one importable place (TASK 583). The page script (main.js) and the node test kit
// (tests/helpers/node-app.js) both call createModeRouter() on the views findViews() finds: show the active mode's container, hide the rest, drive the
// Design RAF lifecycle, persist the active mode. Moved out of main.js unchanged; what only the page has (the drawer toggle, the Vcarve and Review views)
// comes in as hooks.
//
// S6a: 4-mode app shell — a view router over Explore / Design / Prepare / Simulate-Export. The SVG editor (Explore) is inited ONCE and never re-inited; the
// router only shows/hides containers. The shared sketcher (Design) mounts once on first entry; its RAF runs only while Design is the active mode, and the
// input layer's isActive gate is tied to the ACTIVE MODE (not mere visibility) so Explore/Prepare/Sim keystrokes never reach the sketcher (R-COEXIST).

import { createHistoryRouter } from '#ui/history-control.js';
import { sketchHistory } from '#ui/input-manager.js';

/** TASK 618: Shaper's Undo / Redo router, declared once (the page and the node test kit both call it): Design and Prepare own the shared sketch
 *  history (every cut-plan edit is a step of it, TASK 463); Explore, Vcarve and Review have none. */
export function createShaperHistory({ getController, getMode }) {
  return createHistoryRouter({ current: () => {
    const c = getController();
    return c && (getMode() === 'design' || getMode() === 'prepare') ? sketchHistory(c.state) : null;
  } });
}

export const MODE_KEY = 'shaper-mode';

export const SHAPER_STAGES = [
  { id: 'explore', label: 'Explore' },
  { id: 'design',  label: 'Design' },
  { id: 'vcarve',  label: 'Vcarve' },
  { id: 'prepare', label: 'Prepare' },
  { id: 'review',  label: 'Review' },
];

/** The page's mode containers. Explore is in normal flow (display); the others are absolute overlays (hidden attr). */
export const findViews = (doc) => ({
  explore:   doc.querySelector('main.layout'),   // the existing SVG editor (normal flow)
  design:    doc.getElementById('design-view'),  // the shared sketcher (absolute overlay)
  vcarve:    doc.getElementById('view-vcarve'),   // VCARVE-3a: the Vcarve space (skeleton)
  prepare:   doc.getElementById('view-prepare'),
  review:    doc.getElementById('view-review'),
});

/**
 * createModeRouter({ views, onActiveChange, getController, ensureSketch, enter, afterShow }) -> { showMode, current }
 *   getController(): the mounted Design sketch controller (null before it exists). ensureSketch(): mounts it (the page does so lazily).
 *   enter: { vcarve(), prepare(enteringMode), review() } — the page's / the host's per-mode work, each optional.
 *   afterShow(mode): runs after the Design loop was started / stopped (the page's drawer toggle).
 */
export function createModeRouter({ views, onActiveChange = null, getController, ensureSketch, enter = {}, afterShow = () => {} }) {
  let currentMode = 'explore';
  // The view router: show the active mode's container, hide the rest. Explore is in normal flow (display); the
  // other three are absolute overlays (hidden attr). Drives the Design RAF lifecycle + persists the active mode.
  function showMode(mode) {
    if (!views[mode]) mode = 'explore';
    const enteringMode = (mode !== currentMode);
    currentMode = mode;
    views.explore.style.display = (mode === 'explore') ? '' : 'none';
    views.design.hidden    = (mode !== 'design');   // make the canvas visible BEFORE start() so frame 1 sees a laid-out svg
    views.vcarve.hidden    = (mode !== 'vcarve');   // VCARVE-3a: static skeleton — no mount needed yet (live view = 3b)
    views.prepare.hidden   = (mode !== 'prepare');
    views.review.hidden    = (mode !== 'review');
    if (onActiveChange) onActiveChange(mode);
    if (mode === 'design') { ensureSketch(); getController().start(); } // idempotent (guards against a second RAF)
    else if (getController()) getController().stop();                   // pause the RAF off Design
    afterShow(mode);
    // VCARVE-3b: the Vcarve workspace operates on the shared Design sketch — ensure it's mounted + solved, then mount the
    // live view once (re-populate its region list on each entry, since the sketch may have changed, e.g. after an import).
    if (mode === 'vcarve' && enter.vcarve) enter.vcarve();
    // SP1a/SP1c: Prepare REUSES the shared Design sketch (no 2nd engine/RAF). Ensure it's mounted + solved, then mount
    // a Prepare-local view: edges (no joints) + topological-loop hover-highlight. Render-on-demand — geometry is
    // static in Prepare, so loops are found once on (re)mount; the highlight redraws only on hover-change (no RAF).
    if (mode === 'prepare' && enter.prepare) enter.prepare(enteringMode);
    if (mode === 'review' && enter.review) enter.review();
    try { localStorage.setItem(MODE_KEY, mode); } catch (_) { /* storage blocked */ }
  }
  return { showMode, current: () => currentMode };
}
