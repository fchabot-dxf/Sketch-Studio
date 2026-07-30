// Single source of truth for app state. Other modules import this directly.
// Keep this file dumb — no DOM, no rendering.

import { nearestColorIndex } from "#core/color-match.js"; // UNIFY-4c: digital -> physical pen (nearest match)

let nextId = 1;
export const uid = (prefix = "id") => `${prefix}${nextId++}`;

export const state = {
    doc: { w: 200, h: 200 },     // always stored in mm (plot/G-code unit)
    docUnit: "mm",               // UI display unit: "mm" | "in"
    artLayers: [],
    get layers() { return this.artLayers; },
    set layers(value) { this.artLayers = value; },
    activeArtLayerId: null,
    // UNIFY-2: handle to the #core SKETCH store (controller.state: shapes + joints), set by sketch-stage on mount.
    // Lets a toolpath TARGET #core geometry DIRECTLY (resolveCoreShapes -> coreShapeToPolyline at collect-time), no
    // bake. COEXISTS with the art store (UNIFY-7 retires artLayers). null until the Design/Sketch tab mounts.
    coreSketch: null,
    // STYLE-1 (was UNIFY-4c's shapeColors: id -> hex): per-shape DIGITAL STYLE record, edited in the Design tab.
    // Plotter-side (#core stays pure). Keyed by shape id (art OR #core sketch shape); value = a style record, see
    // makeShapeStyle. MODEL (user-confirmed): stroke -> the OUTLINE pen, fill -> the FILL pen. Read it through
    // shapeStyle(id), never directly — that accessor also normalizes the LEGACY bare-hex value.
    shapeStyles: new Map(),
    // UNIFY-throttle: shape ids the plotter has marked STATIC (imported/dense, unedited). The sketcher SKIPS them
    // per-frame (perf) + the color underlay draws them; NOT-marked = LIVE (drawn by the sketcher, joints visible).
    // Freehand/drawn geometry is LIVE (joints show); imports (UNIFY-5) land static. Selecting a static shape -> live.
    staticShapeIds: new Set(),
    toolpaths: [],
    activeToolpathId: null,
    // Plot colors = the pens the user actually owns. Discovered from
    // imported SVGs, editable in the Plot Colors panel. Art layers point
    // at a plot color via layer.plotColorId so renames/recolorings here
    // cascade everywhere the pen is used.
    plotColors: [],
    tool: "select",
    selectedShapeIds: new Set(),
    // Node-edit tool: the node currently selected (for drag / Delete).
    activeNode: null, // { shapeId, index } | null
    // Toolpath multi-selection — populated by box-select in toolpath mode.
    // activeToolpathId stays the "primary" (last-clicked / first-selected).
    selectedToolpathIds: new Set(),
    // S2: row<->canvas cross-highlight. hoveredToolpathId = the op ROW under the cursor (ghost its target geometry on
    // canvas); hoveredShapeId = the #core geometry under the cursor on the plotter canvas (mark its owning op row).
    hoveredToolpathId: null,
    hoveredShapeId: null,
    // When set, canvas shape selection feeds back into this toolpath's
    // targetShapeIds. Enter via double-click on a toolpath row, exit
    // via Esc / clicking another row.
    targetEditingToolpathId: null,
    // The pen folder currently "selected" in the toolpath layers panel.
    // New toolpaths created via the + Outline / + Fill buttons inherit
    // this plotColorId so they land in the folder you just clicked.
    selectedPenId: null,
    settings: { pen_up_z: 5, pen_down_z: -1, draw_feed: 2000, z_feed: 1000, tolerance_mm: 0.1 },
    viewport: { scale: 1, panX: 0, panY: 0 },
    interaction: null,
    spaceDown: false,
    // The artwork and the toolpath are ALWAYS both drawn on the canvas
    // (showSvg/showToolpath stay true). The only view switch is simulatePens:
    // off → full-opacity artwork + thin toolpath lines; on → the pen-width
    // "simulation" with the artwork faded to a ghost behind it.
    preview: { showSvg: true, showToolpath: true, simulatePens: false },
    // When false (default), editing the artwork does NOT recompute the
    // toolpath — the user hits Recalculate. Toggle in the Settings modal.
    autoRecalc: false,
    // Identity of the cloud project we last loaded or saved. Save (the
    // "save" button, no name prompt) overwrites this id via PUT; Save
    // As creates a new id. Cleared when the user opens a fresh / blank
    // project or clears state.
    currentProject: { id: null, name: null },
};

/** Default fill settings applied to new and imported layers. */
export const DEFAULT_FILL = { pattern: "none", angle: 45, spacing: 2.0 };

const MM_PER_IN = 25.4;
/** STYLE-5: the document size as a display string in the CURRENT unit — "200 × 150 mm" / "7.87 × 5.91 in".
 *  Declared HERE (state owns doc + docUnit, and this module imports nothing app-side, so no cycle) because the app
 *  was already hand-rolling this conversion in two places — settings.js's private toDisplay/roundDisplay for the
 *  dialog fields and viewport.js's inline fmt() for the #docInfo readout — and the Document button was about to be
 *  a third, hardcoding "mm". One formatter so every place that shows the doc size agrees.
 *  (#docInfo still uses its own inline integer formatting; it can adopt this whenever that is in scope.) */
export function docSizeLabel() {
    const inch = state.docUnit === "in";
    const f = (mm) => (inch ? (mm / MM_PER_IN).toFixed(2) : String(Math.round(mm * 100) / 100));
    return `${f(state.doc.w)} × ${f(state.doc.h)} ${inch ? "in" : "mm"}`;
}

export const DEFAULT_PEN_WIDTH = 0.5; // mm — typical fineliner
export const DEFAULT_OUTLINE = {
    style: "normal",
    passes: 1,
    dash_length: 2,
    dash_gap: 1,
    amplitude: 0.8,
    frequency: 0.7,
};

export function makeArtLayer(name, color = "#111111") {
    return {
        id: uid("layer"),
        name,
        color,            // pure SVG/design concern — untouched by plot colors
        visible: true,
        shapes: [],
        group: "",
    };
}

export function makePlotColor(name, color, width = DEFAULT_PEN_WIDTH) {
    return { id: uid("pen"), name, color, width };
}

// ─── STYLE-1: the per-shape DIGITAL STYLE record ──────────────────────────────────────────────────────────────
// { stroke: hex|null, fill: hex|null, width: mm }.  stroke drives the OUTLINE pen · fill drives the FILL pen ·
// null on either = "None" (that role gets no pen).  width is DISPLAY-ONLY: what gets plotted is the physical PEN's
// width (penWidthFor), never this. Kept as PLOTTER state — #core shapes carry no style, exactly as before.
export const DEFAULT_STROKE_WIDTH = 0.5; // mm — display width for a fresh/imported style

export function makeShapeStyle(stroke = "#000000", fill = null, width = DEFAULT_STROKE_WIDTH) {
    return { stroke, fill, width };
}

/** The style record for a shape, NORMALIZED — or null when the shape has no style at all.
 *  MIGRATION: the pre-STYLE-1 store held a BARE HEX per shape (shapeColors: id -> "#rrggbb"). A string value is
 *  read as { stroke: hex, fill: null, width: default } — the same single-color behaviour it had before — so an older
 *  document, a cloud restore, or any code still writing a plain hex keeps rendering and bucketing. (Nothing in the
 *  app persists this map today — history.serialize covers artLayers/toolpaths/doc only — so this tolerance IS the
 *  migration; there is no stored payload to rewrite.) */
export function shapeStyle(shapeId) {
    const v = state.shapeStyles.get(shapeId);
    if (v == null) return null;
    if (typeof v === "string") return makeShapeStyle(v, null, DEFAULT_STROKE_WIDTH); // legacy id -> hex
    return {
        stroke: v.stroke || null,
        fill: v.fill || null,
        width: v.width != null ? v.width : DEFAULT_STROKE_WIDTH,
    };
}

/** Patch a shape's style, creating the record if absent. `patch` may carry any of {stroke, fill, width};
 *  `fill: null` is an explicit None (so pass it deliberately, not by omission). */
export function setShapeStyle(shapeId, patch) {
    const cur = shapeStyle(shapeId) || makeShapeStyle();
    const next = { ...cur, ...patch };
    state.shapeStyles.set(shapeId, next);
    return next;
}

/** The DIGITAL color to RENDER a shape in / map to a pen. STROKE first (the outline is the shape's line), falling
 *  back to FILL so a fill-only import — an SVG <path fill="red"> with no stroke — is still visible and still maps
 *  to a pen instead of going neutral grey. BUCKETING does NOT use this: creating toolpaths needs the strict
 *  per-role paint (no cross-fallback), so "None" can actually mean none. */
export function shapeColorFor(shapeId) {
    const st = shapeStyle(shapeId);
    return st ? (st.stroke || st.fill || null) : null;
}

/** UNIFY-4c: the PHYSICAL pen id for a shape's DIGITAL color — nearest match over the owned palette. Null when the
 *  shape has no digital color or the palette is empty. Pen stays a plotter concept (state.plotColors + shapeStyles). */
export function penIdForShape(shapeId) {
    const hex = shapeColorFor(shapeId);
    if (!hex || !state.plotColors.length) return null;
    const idx = nearestColorIndex(hex, state.plotColors.map(p => p.color));
    return idx >= 0 ? state.plotColors[idx].id : null;
}

/** UNIFY-4c/3b: a toolpath's effective PHYSICAL pen id — its explicit plotColorId if set, else DERIVED from its
 *  target geometry's digital colors (the first target shape that maps to a pen). Gated: art toolpaths keep their
 *  explicit pen (or fall through to the type default in toolpathColor), so nothing existing changes. */
export function toolpathPenId(tp) {
    if (!tp) return null;
    if (tp.plotColorId) return tp.plotColorId;
    for (const id of (tp.targetShapeIds || [])) { const p = penIdForShape(id); if (p) return p; }
    return null;
}

/** UNIFY-4c: the color the color-underlay draws a shape in — its MAPPED physical pen color; falls back to the raw
 *  digital color when there's no palette, or a neutral when uncolored. */
export function penColorForShape(shapeId) {
    const penId = penIdForShape(shapeId);
    if (penId) { const pc = state.plotColors.find(p => p.id === penId); if (pc) return pc.color; }
    return shapeColorFor(shapeId) || "#333333";
}

/** Effective pen width (mm) for a toolpath — the width of its (possibly derived) pen. Pen width is the single source
 *  of truth. Falls back to a toolpath's legacy per-toolpath width, then the default. */
export function penWidthFor(tp) {
    if (!tp) return DEFAULT_PEN_WIDTH;
    const pen = state.plotColors.find(p => p.id === toolpathPenId(tp));
    if (pen && pen.width != null) return pen.width;
    return tp.penWidth != null ? tp.penWidth : DEFAULT_PEN_WIDTH;
}

/** Look up an existing plot color by exact hex, or create one. Returns
 *  the plot-color object. Used at import time to seed the pen palette. */
export function findOrCreatePlotColor(color, suggestedName) {
    const norm = (color || "").toLowerCase();
    let pc = state.plotColors.find(p => p.color.toLowerCase() === norm);
    if (pc) return pc;
    pc = makePlotColor(suggestedName || color, color);
    state.plotColors.push(pc);
    return pc;
}

/** Resolve a toolpath's plotting color: the linked plot color, or a
 *  reasonable default if unlinked. */
export function toolpathColor(tp) {
    if (!tp) return "#111111";
    const penId = toolpathPenId(tp); // UNIFY-4c: explicit pen, else derived from the target geometry's digital color
    if (penId) {
        const pc = state.plotColors.find(p => p.id === penId);
        if (pc) return pc.color;
    }
    return tp.type === "fill" ? "#ff8a3d" : "#3aa3ff";
}

export function makeToolpath(name, type, targetArtLayerId = null) {
    return {
        id: uid("toolpath"),
        name,
        type, // "outline" or "fill"
        targetType: "selection",
        targetArtLayerId, // retained for compatibility, but selection is the default target
        targetShapeIds: [],
        // Which pen plots this operation. Null = use the default scheme color
        // (blue/orange) per type. Set at import time and editable in the UI.
        plotColorId: null,
        export: true,
        visible: true,
        penWidth: DEFAULT_PEN_WIDTH,
        drawOutline: type === "outline",
        outline: { ...DEFAULT_OUTLINE },
        fill: {
            pattern: type === "fill" ? "hatch" : "none",
            angle: 45,
            spacing: 2.0,
            offset: 0
        },
    };
}

export function initLayers() {
    // UNIFY-7: seed ONLY the default toolpath (the art store is retired). It targets #core geometry by SELECTION
    // (targetShapeIds), resolved via resolveCoreShapes — no art layer to target.
    state.artLayers = [];
    state.activeArtLayerId = null;
    const toolpath = makeToolpath("Outline", "outline");
    state.toolpaths = [toolpath];
    state.activeToolpathId = toolpath.id;
}

export function activeArtLayer() {
    return state.artLayers.find(l => l.id === state.activeArtLayerId) || null;
}

export function activeToolpath() {
    return state.toolpaths.find(tp => tp.id === state.activeToolpathId) || null;
}

/** Toolpaths in Toolpath-Operations-panel order, which is also the order
 *  they're drawn: pen folders (palette order), outline ops before fill ops
 *  within each pen, preserving array order within a role. Single source of
 *  truth so the simulation z-stacks paths by completion order — earlier
 *  ops underneath, later ops on top. */
export function orderedToolpaths() {
    const byPen = new Map();
    for (const tp of state.toolpaths) {
        const penId = tp.plotColorId || "__none__";
        if (!byPen.has(penId)) byPen.set(penId, { outline: [], fill: [] });
        byPen.get(penId)[tp.type === "fill" ? "fill" : "outline"].push(tp);
    }
    const penIds = state.plotColors.map(p => p.id).filter(id => byPen.has(id));
    if (byPen.has("__none__")) penIds.push("__none__");
    const out = [];
    for (const penId of penIds) {
        const b = byPen.get(penId);
        out.push(...b.outline, ...b.fill);
    }
    return out;
}

/** When a shape is replaced by editing (scissors split, merge, …), re-point
 *  any toolpath that targeted the old shape id at the new id(s), so the
 *  toolpath's preview/output follows the edit instead of going blank. */
export function remapToolpathTargets(oldId, newIds) {
    for (const tp of state.toolpaths) {
        if (!tp.targetShapeIds || !tp.targetShapeIds.includes(oldId)) continue;
        const out = [];
        for (const id of tp.targetShapeIds) {
            const repl = id === oldId ? newIds : [id];
            for (const n of repl) if (n && !out.includes(n)) out.push(n);
        }
        tp.targetShapeIds = out;
    }
}

export function findShape(sid) {
    for (const l of state.artLayers) {
        const s = l.shapes.find(s => s.id === sid);
        if (s) return s;
    }
    return null;
}
