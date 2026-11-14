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

let _onRestore = null;
let _isActive = () => false;

// `isActive` gates the Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z listener to the stages this history owns (Toolpath, Export), so one
// keystroke drives ONE history: the Design stage's shared sketch history owns the keys while Design shows (TASK 444b).
export function installHistory(onRestore, isActive) {
    _onRestore = onRestore;
    _isActive = isActive;
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
}

/** Save the current state onto the undo stack BEFORE mutating. */
export function snapshot() {
    undoStack.push(serialize());
    if (undoStack.length > MAX_HISTORY) undoStack.shift();
    redoStack.length = 0; // any new action invalidates the redo branch
}

export function undo() {
    if (!undoStack.length) return;
    redoStack.push(serialize());
    restore(undoStack.pop());
}

export function redo() {
    if (!redoStack.length) return;
    undoStack.push(serialize());
    restore(redoStack.pop());
}

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
    const isCtrl = e.ctrlKey || e.metaKey;
    if (!isCtrl) return;
    const key = e.key.toLowerCase();
    if (key === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
    else if ((key === "z" && e.shiftKey) || key === "y") { e.preventDefault(); redo(); }
}
