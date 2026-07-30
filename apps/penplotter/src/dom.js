// DOM references + tiny UI primitives (toast) for the penplotter Draw stage (PP-3a). MOUNT-ORDER-SAFE: the Draw
// stage mounts DYNAMICALLY via the 5-stage router, so the original eager `export const canvas = $("#canvas")` would
// capture null (the scaffold isn't in the DOM when this module first evaluates — the import-hoisting trap, same
// class as the clipper self-shim). Instead the element refs are ESM `let` LIVE bindings, resolved by initDom(root)
// AFTER the scaffold mounts; consumers `import { canvas }` and read the live value at CALL time (post-mount).

export const $ = (sel) => document.querySelector(sel);
export const SVG_NS = "http://www.w3.org/2000/svg";
export const INK_NS = "http://www.inkscape.org/namespaces/inkscape";

export let canvas = null;
export let canvasWrap = null;
export let layersEl = null;
export let coordsEl = null;
export let docInfoEl = null;
export let toastEl = null;
// IMPORT-2B-4: dropOverlay was resolved here for the deleted installSvgImport. The overlay now lives in the Design
// stage's own scaffold (#design-canvas-wrap) and is queried there — nothing in the Draw stage owns it any more.

// Resolve the Draw-stage element refs from a mounted container (falls back to document). Call once after the
// scaffold is in the DOM. The `export let` bindings above update live, so every importer sees the resolved nodes.
export function initDom(root) {
    const scope = root || document;
    const q = (sel) => (scope.querySelector && scope.querySelector(sel)) || document.querySelector(sel);
    canvas = q("#canvas");
    canvasWrap = q("#canvasWrap");
    layersEl = q("#layers");
    coordsEl = q("#coords");
    docInfoEl = q("#docInfo");
    toastEl = q("#toast");
}

let toastTimer = null;
export function toast(msg, isError = false) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.toggle("error", !!isError);
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), 3000);
}
