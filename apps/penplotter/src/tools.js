// Tool selection + drawing-preview helpers shared with interaction.js.

import { state } from "./state.js";
import { canvas } from "./dom.js";

const TOOL_CLASSES = ["tool-select", "tool-rotate", "tool-scale", "tool-line", "tool-rect", "tool-ellipse", "tool-polyline", "tool-freehand", "tool-scissors", "tool-node"];

// Shape-editing tools — while one is active in toolpath/sim view, the
// toolpath overlay must stop capturing clicks so they reach the artwork.
const SHAPE_EDIT_TOOLS = ["node", "scissors", "rotate", "scale", "line", "rect", "ellipse", "polyline", "freehand"];

export function setTool(tool) {
    state.tool = tool;
    canvas.classList.remove(...TOOL_CLASSES);
    canvas.classList.add(`tool-${tool}`);
    document.querySelectorAll(".tool").forEach(b =>
        b.classList.toggle("active", b.dataset.tool === tool)
    );
    document.body.classList.toggle("shape-tools", SHAPE_EDIT_TOOLS.includes(tool));
    if (state.interaction) cancelInteraction();
    removePreview(); // clear any scissors hover highlight when switching tools
}

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

export function installToolbar() {
    document.querySelectorAll(".tool").forEach(b => b.onclick = () => setTool(b.dataset.tool));
    // Float the tool stack over the canvas (works in both desktop and the
    // stacked mobile layout, since the canvas wrap is the canvas in both).
    const wrap = document.getElementById("canvasWrap");
    const tools = document.getElementById("allTools");
    if (wrap && tools && tools.parentNode !== wrap) wrap.appendChild(tools);
}
