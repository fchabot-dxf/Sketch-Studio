// Snapshot-based undo/redo.
//
// Callers wrap mutating actions with `snapshot()` — which captures the
// pre-mutation state — then perform the change. Undo restores the most
// recent snapshot; redo re-applies it.
//
// The "preview" cache and viewport are excluded (transient, not user-visible
// state). Selection is reset on restore to avoid dangling shape ids.

import { state } from "./state.js";
import { $ } from "./dom.js";

const MAX_HISTORY = 100;
const undoStack = [];
const redoStack = [];

let _onRestore = null;

export function installHistory(onRestore) {
    _onRestore = onRestore;
    wireButtons();
    updateButtons();
    window.addEventListener("keydown", onKey);
}

/** Save the current state onto the undo stack BEFORE mutating. */
export function snapshot() {
    undoStack.push(serialize());
    if (undoStack.length > MAX_HISTORY) undoStack.shift();
    redoStack.length = 0; // any new action invalidates the redo branch
    updateButtons();
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
    return JSON.stringify({
        artLayers: state.artLayers,
        activeArtLayerId: state.activeArtLayerId,
        toolpaths: state.toolpaths,
        activeToolpathId: state.activeToolpathId,
        doc: { ...state.doc },
    });
}

function restore(snap) {
    const s = JSON.parse(snap);
    state.artLayers = s.artLayers;
    state.activeArtLayerId = s.activeArtLayerId;
    state.toolpaths = s.toolpaths || [];
    state.activeToolpathId = s.activeToolpathId || null;
    state.doc = s.doc;
    state.selectedShapeIds = new Set();
    state.interaction = null;
    updateButtons();
    if (_onRestore) _onRestore();
}

function wireButtons() {
    const u = $("#undoBtn"), r = $("#redoBtn");
    if (u) u.onclick = undo;
    if (r) r.onclick = redo;
}

function updateButtons() {
    const u = $("#undoBtn"), r = $("#redoBtn");
    if (u) u.disabled = !undoStack.length;
    if (r) r.disabled = !redoStack.length;
}

function onKey(e) {
    // Skip when typing in inputs (let standard text undo work).
    if (e.target.tagName === "INPUT") return;
    const isCtrl = e.ctrlKey || e.metaKey;
    if (!isCtrl) return;
    const key = e.key.toLowerCase();
    if (key === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
    else if ((key === "z" && e.shiftKey) || key === "y") { e.preventDefault(); redo(); }
}
