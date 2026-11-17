// Global keyboard shortcuts. Delete, escape, space-pan (the art-tool keys and the polyline Enter are gone: TASK 748).

import { state } from "./state.js";
import { canvas } from "./dom.js";
import { cancelInteraction } from "./tools.js";
import { renderArt as render } from "./render-art.js"; // PP-3b: Draw's trimmed renderer, not render.js
import { deleteActiveNode } from "./interaction.js";
import { exitTargetEditing } from "./toolpath-layers-panel.js"; // PP-4b: real target-editing exit (un-stubbed)
import { isTextEditingTarget } from "#ui/clipboard.js";
import { deleteSelection } from "#core/delete-manager.js"; // BURN-DOWN-1: Delete removes #core geometry (art store retired)
import { matchesShortcut } from "#ui/shortcuts.js"; // TASK 727: the keys are declared there

export function installKeyboard(isActive) {
    window.addEventListener("keydown", (e) => { if (isActive()) onKeyDown(e); });
    window.addEventListener("keyup", onKeyUp);
}

function onKeyDown(e) {
    if (isTextEditingTarget(e.target)) return;

    if (matchesShortcut(e, "view.panHold")) {
        state.spaceDown = true;
        canvas.classList.add("panning");
        e.preventDefault();
        return;
    }
    if (matchesShortcut(e, "edit.cancel")) {
        if (state.targetEditingToolpathId) { exitTargetEditing(); return; }
        if (state.interaction) return cancelInteraction();
        // Nothing in-flight — Esc becomes a "deselect everything"
        // shortcut. Works in any mode, including toolpath mode where
        // there's no empty-canvas to click on near the panel.
        if (state.selectedShapeIds.size || state.selectedToolpathIds.size) {
            state.selectedShapeIds = new Set();
            state.selectedToolpathIds = new Set();
            state.activeToolpathId = null;
            render();
        }
        return;
    }
    if (matchesShortcut(e, "edit.delete")) {
        if (e.defaultPrevented) { state.selectedShapeIds.clear(); render(); return; }
        // Node tool: Delete removes the selected node, not the whole shape.
        if (state.tool === "node" && state.activeNode) { deleteActiveNode(); return; }
        return deleteSelected();
    }
}

function onKeyUp(e) {
    if (matchesShortcut(e, "view.panHold")) {
        state.spaceDown = false;
        canvas.classList.remove("panning");
    }
}

function deleteSelected() {
    if (!state.selectedShapeIds.size) return;
    // BURN-DOWN-1: geometry lives in the #core sketch (the art store is retired). Delete the selected #core shapes +
    // their orphaned joints via the shared delete-manager. On the Design tab the #ui keydown also handles this
    // (idempotent — it fires first and clears the selection); this branch also covers Toolpath/Export, where the #ui
    // input layer is inactive so the plotter is the only handler.
    const cs = state.coreSketch;
    if (cs && cs.shapes) {
        cs.selectedShapes = new Set(state.selectedShapeIds);
        if (cs.selectedJoints && cs.selectedJoints.clear) cs.selectedJoints.clear();
        try { deleteSelection(cs); } catch (_) {}
    }
    state.selectedShapeIds.clear();
    render();
}
