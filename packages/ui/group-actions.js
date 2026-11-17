// packages/ui/group-actions.js — TASK 756: THE user GROUP commands of the Design tab, in every app (SketchStudio, Shaper, Pen Plotter,
// Trace). Group / Ungroup (an undo step each), Enter group / Leave group (session UI, never an undo step). The keys (shortcuts.js
// sketch.group / sketch.ungroup, bound in input-manager.js), the canvas right-click / touch-and-hold menu (context-menu.js, opened by
// input-manager.js) and a group's row in the design browser (design-info-panel.js) all run these functions; what each one can do on the
// selection is ONE answer (#core/group-model.js groupCommands). Moved here from apps/shaper/src/main.js (task 751's Shaper-only wiring).

import { makeGroup, ungroup, enterGroup, stepOutOfGroup, groupCommands } from '#core/group-model.js';

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
  const gids = groupCommands(state).ungroup;
  if (!gids.length) { notify('No group on the selection', 'warning'); return 0; }
  if (typeof state.saveState === 'function') state.saveState('ungroup');
  for (const gid of gids) ungroup(state, gid);
  notify(`Ungrouped ${gids.length} group${gids.length === 1 ? '' : 's'}`, 'success');
  return gids.length;
}

/** Enter group: the one selected group becomes the entered level (what a double click on it does); nothing stays selected. -> the group id or null. */
export function enterSelectedGroup(state) {
  const gid = groupCommands(state).enter;
  if (!gid) return null;
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

/** The actions the shared context menu's group entries call (context-menu.js groupMenuItems): the same functions as the keys. */
export function groupMenuActions(state, notify = () => {}) {
  return {
    groupState: () => groupCommands(state),
    group: () => groupSelection(state, notify),
    ungroup: () => ungroupSelection(state, notify),
    enterGroup: () => enterSelectedGroup(state),
    leaveGroup: () => leaveEnteredGroup(state),
  };
}
