// Drawing-preview helpers shared with interaction.js (the art-tool picker setTool / installToolbar went with the art-tool keys: TASK 748).

import { state } from "./state.js";
import { canvas } from "./dom.js";

let previewEl = null;

export function showPreview(el) {
    removePreview();
    el.classList.add("preview");
    el.classList.remove("shape");
    canvas.appendChild(el);
    previewEl = el;
}

export function removePreview() {
    if (previewEl && previewEl.parentNode) previewEl.parentNode.removeChild(previewEl);
    previewEl = null;
}

// Late import to avoid circular evaluation pain; render() is event-driven.
let _render = null;
async function lazyRender() {
    if (!_render) _render = (await import("./render-art.js")).renderArt; // PP-3b: Draw's trimmed renderer
    _render();
}

export function cancelInteraction() {
    const it = state.interaction;
    // Pending rotate/scale leaves shapes in a tentative position — revert them before clearing.
    // (MERGE-1: the degree HUD is gone; a #core-joint rotate/scale is a later restore.)
    if (it && (it.kind === "rotate" || it.kind === "scale")) {
        for (let i = 0; i < it.shapes.length; i++) {
            Object.assign(it.shapes[i], JSON.parse(JSON.stringify(it.originals[i])));
        }
    }
    state.interaction = null;
    removePreview();
    lazyRender();
}
