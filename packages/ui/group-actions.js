// packages/ui/group-actions.js — TASK 756: THE user GROUP commands of the Design tab, in every app (SketchStudio, Shaper, Pen Plotter,
// Trace). Group / Ungroup (an undo step each), Enter group / Leave group (session UI, never an undo step). The keys (shortcuts.js
// sketch.group / sketch.ungroup, bound in input-manager.js), the canvas right-click / touch-and-hold menu (context-menu.js, opened by
// input-manager.js) and a group's row in the design browser (design-info-panel.js) all run these functions; what each one can do on the
// selection is ONE answer (#core/group-model.js groupCommands). Moved here from apps/shaper/src/main.js (task 751's Shaper-only wiring).

import { makeGroup, ungroup, enterGroup, stepOutOfGroup, groupCommands, groupLockState, setGroupLock, GROUP_LOCKS } from '#core/group-model.js';
import { track } from '#ui/analytics.js';

const clearSelection = (state) => {
  if (state.selectedJoints) state.selectedJoints.clear();
  if (state.selectedConstraints) state.selectedConstraints.clear();
  if (state.selectedShapes) state.selectedShapes.clear();
};

/** Group: the selected shapes become ONE new group (a whole selected group goes in whole: #core/group-model.js makeGroup). One undo step.
 *  notify(message, level): the host's status line. -> the group, or null (fewer than two things selected). */
export function groupSelection(state, notify = () => {}) {
  if (!groupCommands(state).group) { notify('Select 2+ shapes to group', 'warning'); return null; }
  const sel = [...state.selectedShapes];
  if (typeof state.saveState === 'function') state.saveState('group');
  const g = makeGroup(state, sel);
  notify(`Grouped ${sel.length} shapes → ${g.name}`, 'success');
  return g;
}

/** Ungroup: each group the selection holds (groupCommands().ungroup) is dissolved ONE level. One undo step. -> how many were dissolved. */
export function ungroupSelection(state, notify = () => {}) {
  const cmds = groupCommands(state), gids = cmds.ungroup;
  if (!gids.length) { notify(cmds.text ? 'A text is one object: Convert to shapes (its menu) turns it into curves' : 'No group on the selection', 'warning'); return 0; } // TASK 845
  if (typeof state.saveState === 'function') state.saveState('ungroup');
  for (const gid of gids) ungroup(state, gid);
  notify(`Ungrouped ${gids.length} group${gids.length === 1 ? '' : 's'}`, 'success');
  return gids.length;
}

/** Enter group: the one selected group becomes the entered level (what a double click on it does); nothing stays selected. -> the group id or null. */
export function enterSelectedGroup(state) {
  const { enter: gid, text } = groupCommands(state);
  if (!gid || text) return null; // TASK 845: a text's group is never entered (its editor opens instead)
  enterGroup(state, gid);
  clearSelection(state);
  return gid;
}

/** Leave group: one level out of the entered group (what Esc and a click on empty canvas do); nothing stays selected. -> true when a group was entered. */
export function leaveEnteredGroup(state) {
  const left = stepOutOfGroup(state);
  clearSelection(state);
  return left;
}

/** TASK 753: toggle lock `kind` ('sizeAngle' = "Lock size & angle", 'full' = "Full lock": #core/group-model.js GROUP_LOCKS) of group `gid`
 *  (default: the one selected group). ONE undo step. The box's padlocks, the canvas / hold menu and a group's browser row all run this.
 *  Lock size & angle cannot be turned off while Full lock (which implies it) is on: refused with the reason.
 *  -> { on } (the new state), or { refused: reason }. */
export function toggleGroupLock(state, kind, gid = groupCommands(state).enter, notify = () => {}) {
  const g = gid && (state.groups || []).find((x) => x.id === gid);
  if (!g || !GROUP_LOCKS[kind]) return { refused: 'Select one group to lock it' };
  const now = groupLockState(state, gid);
  if (kind === 'sizeAngle' && now.full) {
    const refused = `${g.name}: ${GROUP_LOCKS.full.label} is on (it holds size & angle too): unlock it first`;
    notify(refused, 'warning');
    return { refused };
  }
  const on = !now[kind];
  if (typeof state.saveState === 'function') state.saveState(on ? 'lock group' : 'unlock group');
  setGroupLock(state, gid, kind, on);
  track('group-lock');
  notify(`${g.name}: ${GROUP_LOCKS[kind].label} ${on ? 'on' : 'off'}`, 'success');
  return { on };
}

/** The actions the shared context menu's group entries call (context-menu.js groupMenuItems): the same functions as the keys. */
export function groupMenuActions(state, notify = () => {}) {
  return {
    groupState: () => groupCommands(state),
    group: () => groupSelection(state, notify),
    ungroup: () => ungroupSelection(state, notify),
    enterGroup: () => enterSelectedGroup(state),
    leaveGroup: () => leaveEnteredGroup(state),
    // TASK 753: the two locks of the one selected group (its state, and the toggle the box's padlocks run)
    // (named apart from the geometry menu's lockState / toggleLock: the Fix of points, a different command)
    groupLocks: () => { const gid = groupCommands(state).enter; return gid ? groupLockState(state, gid) : null; },
    toggleGroupLock: (kind) => toggleGroupLock(state, kind, groupCommands(state).enter, notify),
  };
}
