// apps/shaper/src/modes.js — Shaper's MODE ROUTER, DECLARED in one importable place (TASK 583). The page script (main.js) and the node test kit
// (tests/helpers/node-app.js) both call createModeRouter() on the views findViews() finds: show the active mode's container, hide the rest, drive the
// Design RAF lifecycle, persist the active mode. Moved out of main.js unchanged; what only the page has (the drawer toggle, the Review view)
// comes in as hooks.
//
// S6a: the app shell — a view router over Design / Prepare / Review (TASK 706: the Explore SVG viewer is gone; a file comes in through Import SVG / DXF…
// into Design). The router only shows/hides containers. The shared sketcher (Design) mounts once; its RAF runs only while Design is the active mode, and the
// input layer's isActive gate is tied to the ACTIVE MODE (not mere visibility) so Prepare / Review keystrokes never reach the sketcher (R-COEXIST).

import { createHistoryRouter } from '#ui/history-control.js';
import { sketchHistory } from '#ui/input-manager.js';
import { commonStage } from '#ui/stage-names.js';

/** TASK 618: Shaper's Undo / Redo router, declared once (the page and the node test kit both call it): Design and Prepare own the shared sketch
 *  history (every cut-plan edit is a step of it, TASK 463); Review has none. */
export function createShaperHistory({ getController, getMode }) {
  return createHistoryRouter({ current: () => {
    const c = getController();
    return c && (getMode() === 'design' || getMode() === 'prepare') ? sketchHistory(c.state) : null;
  } });
}

export const MODE_KEY = 'shaper-mode';

export const SHAPER_STAGES = [
  commonStage('design'),
  commonStage('prepare'),
  commonStage('export', 'review'),   // TASK 707: the 3D board + export card, shown as "Export"; its stage id stays 'review' (a stored one still opens it)
];

// Stages hidden in Fusion 360 palette mode (?host=fusion): Design (no designing in add-in); Prepare + Review + export/upload handle the Fusion workflow.
export const FUSION_HIDDEN_STAGES = Object.freeze(['design']);
const FUSION_HIDDEN_SET = new Set(FUSION_HIDDEN_STAGES);

export function shaperStagesFor({ fusion = false } = {}) {
  return fusion ? SHAPER_STAGES.filter((s) => !FUSION_HIDDEN_SET.has(s.id)) : SHAPER_STAGES;
}

/** The stage the page opens on: the stored one if it is still a stage here, else Design (Prepare in Fusion mode). TASK 706: a stored 'explore' (the removed
 *  Explore viewer) is not a stage any more, so it opens Design; TASK 741: so does the removed V-carve stage's stored id. */
export function resolveInitialMode(storedMode, { fusion = false } = {}) {
  const stages = shaperStagesFor({ fusion });
  const fallback = fusion ? 'prepare' : 'design';
  const normalized = storedMode === 'simexport' ? 'review' : storedMode;
  return stages.some((s) => s.id === normalized) ? normalized : fallback;
}

/** The page's mode containers (absolute overlays, hidden attr). */
export const findViews = (doc) => ({
  design:    doc.getElementById('design-view'),  // the shared sketcher (absolute overlay)
  prepare:   doc.getElementById('view-prepare'),
  review:    doc.getElementById('view-review'),
});

/**
 * createModeRouter({ views, onActiveChange, getController, ensureSketch, enter, afterShow }) -> { showMode, current, showDesign }
 *   getController(): the mounted Design sketch controller (null before it exists). ensureSketch(): mounts it (the page does so lazily).
 *   enter: { prepare(enteringMode), review() } — the page's / the host's per-mode work, each optional.
 *   afterShow(mode): runs after the Design loop was started / stopped (the page's drawer toggle).
 */
export function createModeRouter({ views, stages = SHAPER_STAGES, defaultMode = stages[0].id, onActiveChange = null, getController, ensureSketch, enter = {}, afterShow = () => {} }) {
  const allowed = new Set(stages.map((s) => s.id));
  const fallback = allowed.has(defaultMode) ? defaultMode : stages[0].id;
  let currentMode = fallback;
  // The view router: show the active mode's container, hide the rest (absolute overlays, hidden attr). Drives the Design RAF lifecycle + persists the
  // active mode.
  function showMode(mode) {
    if (!allowed.has(mode) || !views[mode]) mode = fallback;
    const enteringMode = (mode !== currentMode);
    currentMode = mode;
    views.design.hidden    = (mode !== 'design');   // make the canvas visible BEFORE start() so frame 1 sees a laid-out svg
    views.prepare.hidden   = (mode !== 'prepare');
    views.review.hidden    = (mode !== 'review');
    if (onActiveChange) onActiveChange(mode);
    if (mode === 'design') { ensureSketch(); getController().start(); } // idempotent (guards against a second RAF)
    else if (getController()) getController().stop();                   // pause the RAF off Design
    afterShow(mode);
    // SP1a/SP1c: Prepare REUSES the shared Design sketch (no 2nd engine/RAF). Ensure it's mounted + solved, then mount
    // a Prepare-local view: edges (no joints) + topological-loop hover-highlight. Render-on-demand — geometry is
    // static in Prepare, so loops are found once on (re)mount; the highlight redraws only on hover-change (no RAF).
    if (mode === 'prepare' && enter.prepare) enter.prepare(enteringMode);
    if (mode === 'review' && enter.review) enter.review();
    try { localStorage.setItem(MODE_KEY, mode); } catch (_) { /* storage blocked */ }
  }
  // TASK 706 ("everything in Design"): the host's declared showDesign (document-buffer.js / sketch-import.js): a design the user opens (new / Open / Open from
  // file) or a drawing the user imports is shown in Design, from any stage. Fusion mode has no Design stage: nothing changes there.
  function showDesign() {
    if (allowed.has('design')) showMode('design');
  }
  return { showMode, current: () => currentMode, showDesign };
}
