// Snapshot-based undo/redo.
//
// Callers wrap mutating actions with `snapshot()` — which captures the
// pre-mutation state — then perform the change. Undo restores the most
// recent snapshot; redo re-applies it.
//
// The "preview" cache and viewport are excluded (transient, not user-visible
// state). Selection is reset on restore to avoid dangling shape ids.

import { state } from "./state.js";
import { captureHistoryState, applyHistoryState } from "./plotter-doc.js"; // TASK 451: one list of what the plotter owns, shared with persistence

const MAX_HISTORY = 100;
const undoStack = [];
const redoStack = [];

const listeners = new Set();
const changed = () => { for (const fn of listeners) fn(); };
let _onRestore = null;
let _isActive = () => false;
let _router = null; // TASK 618: the history router (history-control.js): the key and the header buttons share its run()

// `isActive` gates the Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z listener to the stages this history owns (Toolpath, Export), so one
// keystroke drives ONE history: the Design stage's shared sketch history owns the keys while Design shows (TASK 444b).
export function installHistory(onRestore, isActive, router) {
    _onRestore = onRestore;
    _isActive = isActive;
    _router = router;
    window.addEventListener("keydown", onKey);
}

/** TASK 587: a document tab's own copy of these two stacks (in memory, not in the document): captured when the tab is put aside, restored when it
 *  comes back; restoreHistorySession(undefined) = a design with no history yet. */
export function captureHistorySession() {
    return { undo: [...undoStack], redo: [...redoStack] };
}
export function restoreHistorySession(session) {
    undoStack.length = 0; redoStack.length = 0;
    if (session) { undoStack.push(...session.undo); redoStack.push(...session.redo); }
    changed();
}

/** Save the current state onto the undo stack BEFORE mutating. */
export function snapshot() {
    undoStack.push(serialize());
    if (undoStack.length > MAX_HISTORY) undoStack.shift();
    redoStack.length = 0; // any new action invalidates the redo branch
    changed();
}

export function undo() {
    if (!undoStack.length) return;
    redoStack.push(serialize());
    restore(undoStack.pop());
    changed();
}

export function redo() {
    if (!redoStack.length) return;
    undoStack.push(serialize());
    restore(redoStack.pop());
    changed();
}

/** TASK 618: this stack as a history source (history-control.js): Toolpath / Export's Undo / Redo. */
export const penHistory = {
    undo, redo,
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
    subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
};

function serialize() {
    return JSON.stringify(captureHistoryState());
}

function restore(snap) {
    applyHistoryState(JSON.parse(snap));
    state.selectedShapeIds = new Set();
    state.interaction = null;
    if (_onRestore) _onRestore();
}

function onKey(e) {
    if (!_isActive()) return;
    // Skip when typing in inputs (let standard text undo work).
    if (e.target.tagName === "INPUT") return;
    _router.runKey(e); // the SAME dispatch the header buttons use
}
