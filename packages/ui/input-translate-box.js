// ═══════════════════════════════════════════════════════════════════════════════
// BOX / KEYBOARD TRANSLATOR (task 1031 plan 2.4; task 1034: Circle is its first user)
// ═══════════════════════════════════════════════════════════════════════════════
// The on-canvas value boxes and the canvas value keys, turned into tool-session calls. The box DOM, its parsing and its refusals stay in
// #ui/numeric-input-manager.js (NIM); a box a session opens names the session as its OWNER, so NIM calls it directly instead of raising the
// window liveDimension* events every tool filters by field name:
//   an edit -> session.values;  Enter -> session.step at the session's lastHover (via 'enter');  Tab: NIM's own (a one-field box keeps the focus, B-15).
//   Esc and Ctrl+Z at the opening value stay NIM's liveDimensionCancelled, which input-manager turns into THE canvas Esc / Undo (task 1030):
//   that cancel reaches the session through cancelActiveWork.
// The canvas keys: a value key (shortcuts.js draw.typeValue) goes into the current step's box (B-4).

import { matchesShortcut } from '#ui/shortcuts.js';
import { hideInput, refuseLiveInputClick } from '#ui/numeric-input-manager.js';
import { openCreationBoxesAt, followCreationBoxesAt, liveExpression, liveName, liveAssign } from '#ui/input-handlers/base-tool.js';

// what one field of a live box holds, as a session reads it: typed = the user's own number (a field emptied or reset to its opening text is not)
const fieldValues = (d) => {
    const value = typeof d.value === 'number' ? d.value : NaN;
    const typed = !!(d.typed && d.typed[0]) && !(d.reset && d.reset[0]) && Number.isFinite(value);
    return { value, typed, expression: typed ? liveExpression(d, 0) : null, name: typed ? liveName(d, 0) : null, assign: typed ? liveAssign(d, 0) : null };
};

/** open `box` (a step's declared box) for `session`, beside the pointer at `screen`; `refuse` = the box's own value rule (task 1028), bound to the draw's picks */
export function openStepBox(session, box, { screen, value, focus, initialKey = null, refuse = null }) {
    const owner = {
        values: (detail) => session.values(box.id, fieldValues(detail)),
        // Enter: the values the box reads now, then THE step at the last hover; the box stays open unless the step built the shape
        // (a box opened by that step takes the focus: the keyboard is the user's already)
        enter: (detail) => { session.values(box.id, fieldValues(detail)); return session.step({ ...session.lastHover, via: 'enter', focus: true }) !== 'built'; },
    };
    openCreationBoxesAt(screen, { single: { field: box.id, quantity: box.quantity, refuse } }, [value], { focus, initialKey, owner });
}
/** the open box follows the pointer and shows the live value (a typed field keeps its text; a step with no live value now keeps the last one shown) */
export const followStepBox = (screen, value) => { if (screen) followCreationBoxesAt(screen, Number.isFinite(value) ? [value] : []); };
export const closeStepBox = () => hideInput();
/** the box refusal gate of every step (task 782): a typed value the box refuses refuses the step, from any device */
export const boxRefuses = () => refuseLiveInputClick();

/** a canvas key for the active session; true when it was the session's (input-manager then prevents its default) */
export function sessionCanvasKey(e, session) {
    if (matchesShortcut(e, 'draw.typeValue')) return session.typeInto(e.key);
    return false;
}
