// packages/ui/close-path-actions.js — TASK 760: THE Close path command of the Design tab, in every app (SketchStudio, Shaper, Pen Plotter, Trace).
// The geometry is #core/close-path.js; this module is the command: ONE undo step per run (recordConstraintStep: saved only when something was
// closed), the notice that says what happened and why anything was refused (never silent), and the import's offer. Its entries:
//   the ribbon button (Modify, beside Break: #ui/tool-ribbon.js) and its key (tool.closePath, #ui/shortcuts.js) switch to the CLOSE_PATH tool;
//   switching to it runs beginClosePath (input-manager.js TOOL_BEGIN): with a Select-tool selection its chains are closed at once, else the tool
//   waits for a click on an open outline (handleClosePathPointerDown). While the tool is on, every free end of every open chain in the active
//   sketch is marked on the canvas (#ui/svg-renderer.js, from #core/close-path.js openChainEnds). The tool stays on (as Trim, Break, Fillet).
//   the canvas right-click / touch-and-hold menu's "Close path" (context-menu.js, shown when the selection holds an open chain it can close).
//   the import's offer (#ui/sketch-import.js offerToCloseImported): ONE notice with a "Close them" action.

import { planClosePaths, applyClosePath, closeOfferedChains, nearClosedChains, closePathPick, CLOSE_PATH_UNDO_LABEL } from '#core/close-path.js';
import { lengthText } from '#core/settings-manager.js';
import { recordConstraintStep } from '#ui/input-handlers/constraint-tools.js';
import { warnOtherSketch } from '#ui/input-handlers/active-sketch-warning.js';
import { track } from '#ui/analytics.js';

const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
const gapText = (mm) => lengthText(mm, { auto: 3, trim: 'auto', show: 'unit', fractions: false });
// a refused chain's reasons, each once with its count
function reasonsText(refused) {
  const by = new Map();
  for (const p of refused) by.set(p.reason, (by.get(p.reason) || 0) + 1);
  return [...by].map(([r, n]) => (n > 1 ? `${r} (×${n})` : r)).join('; ');
}

/**
 * closePathOnShapes(state, shapeIds, notify) -> { closed: [plan], refused: [plan] }   the chains of these curves (the active sketch's) are
 * closed, each as #core/close-path.js plans it, in ONE undo step (none when nothing was closed). notify(message, level) says what was done and,
 * for each refused chain, why. The closed chains (and their new lines) are selected: the result is seen.
 */
export function closePathOnShapes(state, shapeIds, notify = () => {}) {
  const plans = planClosePaths(state, shapeIds);
  const ok = plans.filter((p) => p.ok), refused = plans.filter((p) => !p.ok);
  if (!plans.length) { notify('Close path: click an open outline (a line, an arc or a curve of the active sketch).', 'info'); return { closed: [], refused }; }
  const results = ok.length ? recordConstraintStep(state, CLOSE_PATH_UNDO_LABEL, () => ok.map((p) => applyClosePath(state, p))) : [];
  if (ok.length) {
    track('close-path');
    selectClosed(state, ok, results);
  }
  const done = ok.length ? `Closed ${plural(ok.length, 'path')}` + detail(ok, results) : '';
  const no = refused.length ? `${ok.length ? ' · ' : ''}${refused.length === 1 && !ok.length ? 'Not closed' : plural(refused.length, 'path') + ' not closed'}: ${reasonsText(refused)}` : '';
  notify('Close path: ' + done + no, ok.length ? 'success' : 'warning');
  return { closed: ok, refused };
}

// "(a line added)" / "(ends joined, moved 0.004 mm)" for one path; the counts for several
function detail(ok, results) {
  const lines = results.filter((r) => r.mode === 'line').length, joined = results.length - lines;
  if (ok.length === 1) return results[0].mode === 'line' ? ` (a line added across ${gapText(ok[0].gap)})` : ` (its ends made coincident, moved ${gapText(results[0].moved)})`;
  return ` (${[lines ? plural(lines, 'line') + ' added' : '', joined ? plural(joined, 'pair') + ' of ends made coincident' : ''].filter(Boolean).join(', ')})`;
}

// the closed chains and their new lines become the selection (what was closed is seen)
function selectClosed(state, plans, results) {
  if (!state.selectedShapes) return;
  state.selectedShapes.clear();
  if (state.selectedJoints) state.selectedJoints.clear();
  for (const p of plans) for (const id of p.ids) state.selectedShapes.add(id);
  for (const r of results) if (r.lineId) state.selectedShapes.add(r.lineId);
}

/** Switching to the Close path tool (TOOL_BEGIN): a selection's chains are closed at once; with none the tool says what to click. */
export function beginClosePath(state, notify = () => {}) {
  const sel = state.selectedShapes ? [...state.selectedShapes] : [];
  if (sel.length) return closePathOnShapes(state, sel, notify);
  notify('Close path: click an open outline to close it (its open ends are marked).', 'info');
  return null;
}

/**
 * A press in the Close path tool. hitJoint / hitShape = the app's pick under the pointer in the ACTIVE sketch (a point picks the curve it ends);
 * otherShape = with none, another sketch's curve within reach (task 660: the one warning). A press on nothing pans (false).
 */
export function handleClosePathPointerDown(e, state, hitJoint, hitShape, otherShape, notify = () => {}) {
  if (e.button !== undefined && e.button !== 0) return false;
  const include = closePathPick(state);
  const shape = hitShape && hitShape.shape && include(hitShape.shape) ? hitShape.shape
    : hitJoint ? (state.shapes || []).find((s) => include(s) && (s.joints || []).includes(hitJoint.id)) || null : null;
  if (!shape) return warnOtherSketch(state, 'Close path', otherShape);
  closePathOnShapes(state, [shape.id], notify);
  return true;
}

/** The canvas menu's "Close path" applies: the selection holds an open chain Close path can close. */
export function canClosePathSelection(state) {
  const sel = state.selectedShapes ? [...state.selectedShapes] : [];
  return sel.length > 0 && planClosePaths(state, sel).some((p) => p.ok);
}

/** The actions the shared context menu's Close path entry calls (context-menu.js): the same function as the tool. */
export function closePathMenuActions(state, notify = () => {}) {
  return {
    closePathState: () => canClosePathSelection(state),
    closePath: () => closePathOnShapes(state, [...state.selectedShapes], notify),
  };
}

/**
 * TASK 760: the import's offer. After an SVG / DXF import (its own undo step already taken), the open chains of the imported `shapes` whose gap is
 * near-closed (#core/close-path.js nearClosedChains) are offered in ONE notice with a "Close them" action; nothing is closed unless the user
 * picks it. showNotice(message, level, duration, { action }) = #ui/notification-manager.js showNotification. -> the offer (null: nothing offered).
 */
export function offerToCloseImported(state, shapes, showNotice) {
  const near = nearClosedChains(state, shapes.map((s) => s.id));
  if (!near.offered.length) return null;
  const n = near.offered.length;
  const message = `${plural(n, 'outline is', 'outlines are')} almost closed (largest gap ${gapText(near.largestGap)})` +
    (near.leftOpen ? ` · ${plural(near.leftOpen, 'open path')} left open` : '');
  showNotice(message, 'info', OFFER_MS, { action: { label: 'Close them', onClick: () => closeOffered(state, near.offered, showNotice) } });
  return { ...near, message };
}
const OFFER_MS = 20000;

/** The offer's "Close them": exactly the offered chains that are still those open chains, in ONE undo step of their own; they are selected. */
export function closeOffered(state, offered, notify = () => {}) {
  const res = recordConstraintStep(state, CLOSE_PATH_UNDO_LABEL, () => closeOfferedChains(state, offered));
  if (res.closed.length) {
    track('close-path');
    selectClosed(state, res.closed, res.results);
  }
  notify(res.closed.length ? `Closed ${plural(res.closed.length, 'outline')}` + (res.skipped ? ` · ${res.skipped} changed since the import, not closed` : '')
    : 'Nothing closed: the outlines changed since the import', res.closed.length ? 'success' : 'warning');
  return res;
}
