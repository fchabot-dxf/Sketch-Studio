// packages/ui/profile-actions.js — Shared combine/uncombine actions for #ui consumers.
// Encapsulates selection validation, state snapshots, model calls, and user notification.

import { validateCombine, makeProfile, uncombineProfile, profileForShape } from '#core/profile-model.js';
import { findLoops } from '#core/loop-finder.js';
import { loopPolygon } from '#core/loop-geometry.js';

/**
 * Combine selected loops into a compound profile.
 * @param {object} state - Sketch app state
 * @param {function} [notify] - User toast/status callback: (msg, type) => void
 * @returns {object|null} The created profile, or null on failure
 */
export function doCombine(state, notify = () => {}) {
  if (!state) return null;
  const sel = (state.selectedShapes instanceof Set) ? [...state.selectedShapes] : [];
  if (sel.length < 2) {
    notify('Select shapes forming at least 2 closed loops to combine', 'warning');
    return null;
  }
  const loops = findLoops(state);
  const sb = new Map((state.shapes || []).map((s) => [s.id, s]));
  const loopPolys = Object.fromEntries(loops.map((l) => [l.id, loopPolygon(l, state, sb)]));
  const val = validateCombine(sel, loops, loopPolys);
  if (!val.ok) {
    notify(val.reason || 'Cannot combine selection', 'warning');
    return null;
  }
  try { state.saveState && state.saveState('combine'); } catch (_) {}
  const prof = makeProfile(state, val.outerLoop, val.innerLoops);
  notify(`Combined into ${prof.name || prof.id} (${val.innerLoops.length} hole${val.innerLoops.length === 1 ? '' : 's'})`, 'success');
  return prof;
}

/**
 * Uncombine any combined profiles touching the selected shapes.
 * @param {object} state - Sketch app state
 * @param {function} [notify] - User toast/status callback: (msg, type) => void
 * @returns {number} Number of profiles uncombined
 */
export function doUncombine(state, notify = () => {}) {
  if (!state) return 0;
  const sel = (state.selectedShapes instanceof Set) ? [...state.selectedShapes] : [];
  if (!sel.length) {
    notify('Select a combined profile to uncombine', 'warning');
    return 0;
  }
  const toRemove = new Set();
  for (const s of sel) {
    const p = profileForShape(s, state);
    if (p) toRemove.add(p.id);
  }
  if (!toRemove.size) {
    notify('No combined profile on the selection', 'warning');
    return 0;
  }
  try { state.saveState && state.saveState('uncombine'); } catch (_) {}
  for (const pid of toRemove) uncombineProfile(state, pid);
  notify(`Uncombined ${toRemove.size} profile${toRemove.size === 1 ? '' : 's'}`, 'success');
  return toRemove.size;
}
