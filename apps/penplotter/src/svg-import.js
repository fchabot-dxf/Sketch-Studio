// SVG import: drag-drop and file picker.
//
// Layer-detection rules, in priority order:
//   1. If the SVG contains <g inkscape:groupmode="layer"> wrappers, use
//      them — Inkscape's native layer model.
//   2. Otherwise, walk every shape resolving its effective pen color
//      (= fill if filled, else stroke, inherited along the SVG tree)
//      and group by that color. Each unique color becomes one layer.
//      "One color = one pen = one layer" matches pen-plotter conventions.

// IMPORT-2B-4: installSvgImport + its loadSvgFile helper are DELETED — the binder was never called (it wired
// #importBtn/#importFile and a #canvasWrap drop, all in the permanently hidden Draw panel), so the whole chain was
// dead. The live importer is the Design tab: #importSvgBtn + drag-drop on #design-canvas-wrap -> importSvgToCore.
// STILL SHARED, do not touch: inheritPaint + penColorFor below — core-import.js resolves per-element paint through
// them. importSvgText and its art-store helpers are kept deliberately (see the WORK-LOG note): they are the
// reference implementation for the still-open S6 [D] "Inkscape-layer split" decision.

import { state, makeArtLayer, makeToolpath, findOrCreatePlotColor } from "./state.js";
import { INK_NS } from "./dom.js";
import { fitViewport } from "./viewport.js";
import { renderArt as render } from "./render-art.js"; // PP-3c: Draw's trimmed renderer
import { snapshot } from "./history.js";
import { syncDocFields } from "./settings.js"; // PP-6: real (un-stubbed); no-ops if the doc-size fields aren't mounted

export function importSvgText(text) {
    const doc = new DOMParser().parseFromString(text, "image/svg+xml");
    const root = doc.documentElement;
    if (root.tagName.toLowerCase() !== "svg") throw new Error("Not an SVG file.");
    snapshot(); // import is a single undoable action

    // Document size: width/height → viewBox → 200x200 fallback.
    let w = parseLen(root.getAttribute("width"));
    let h = parseLen(root.getAttribute("height"));
    const vb = (root.getAttribute("viewBox") || "").trim().split(/[ ,]+/).map(Number);
    if (!w && vb.length === 4) w = vb[2];
    if (!h && vb.length === 4) h = vb[3];
    state.doc.w = Math.round(w || 200);
    state.doc.h = Math.round(h || 200);
    syncDocFields();

    state.artLayers = [];
    state.toolpaths = [];
    // Reset the plot-color palette so it strictly reflects this import.
    // (If the user wants to keep accumulating across imports we can change
    // this — for now each import = a clean palette discovery.)
    state.plotColors = [];

    const inkscapeLayers = Array.from(root.children).filter(n =>
        n.tagName.toLowerCase() === "g"
        && n.getAttributeNS(INK_NS, "groupmode") === "layer"
    );

    if (inkscapeLayers.length > 0) {
        importFromInkscapeLayers(inkscapeLayers);
    } else {
        importByColorGrouping(root);
    }

    if (state.artLayers.length === 0) {
        const layer = makeArtLayer("imported");
        state.artLayers.push(layer);
        
        const tp = makeToolpath("imported (outline)", "outline", layer.id);
        state.toolpaths.push(tp);
    }
    state.activeArtLayerId = state.artLayers[state.artLayers.length - 1].id;
    state.activeToolpathId = state.toolpaths[state.toolpaths.length - 1].id;
    // Start with nothing selected — let the user choose what to work with.
    state.selectedShapeIds = new Set();
    fitViewport();
    render();
}

const EMPTY_PAINT = { fill: null, stroke: null };

function importFromInkscapeLayers(layerGroups) {
    for (const g of layerGroups) {
        const name = g.getAttributeNS(INK_NS, "label")
            || g.getAttribute("id")
            || `layer ${state.artLayers.length + 1}`;
        const inherited = inheritPaint(g, EMPTY_PAINT);
        const shapes = [];
        for (const node of Array.from(g.children)) collectShapes(node, inherited, shapes);
        const layerColor = penColorFor(inherited) || "#111111";
        const layer = makeArtLayer(name, layerColor);
        layer.shapes = shapes;
        state.artLayers.push(layer);

        // Auto-create starter outline toolpath and target the imported shapes.
        const tp = makeToolpath(`${name} (outline)`, "outline", layer.id);
        tp.targetShapeIds = layer.shapes.map(s => s.id);
        // Link to a plot color so the pen palette gets populated.
        const pc = findOrCreatePlotColor(layerColor, colorName(layerColor));
        tp.plotColorId = pc.id;
        state.toolpaths.push(tp);
    }
}

function importByColorGrouping(root) {
    // Two-pass model, each panel gets the grouping that fits it:
    //
    //   Pass 1 (art layers) — mirror the SVG <g> tree as-is. One art
    //     layer per group; shapes keep their per-element _fill/_stroke.
    //     No color splitting; the left panel shows the SVG hierarchy.
    //
    //   Pass 2 (toolpaths) — one toolpath PER SHAPE, carrying that
    //     shape's color + role. The right panel groups these into a
    //     three-level tree: plot color folder → stroke/fill subfolder
    //     → individual toolpath row per path.
    const allItems = [];
    walk(root, EMPTY_PAINT, allItems, []);

    // ---- Pass 1: art layers from SVG groups ----
    const layerBuckets = new Map();
    for (const item of allItems) {
        const pathKey = item.groupPath.join("/");
        if (!layerBuckets.has(pathKey)) {
            layerBuckets.set(pathKey, { groupPath: item.groupPath, shapes: [] });
        }
        layerBuckets.get(pathKey).shapes.push(item.shape);
    }
    for (const b of layerBuckets.values()) {
        const name = b.groupPath.length ? b.groupPath.join(" / ") : "ungrouped";
        const layer = makeArtLayer(name, "#111111");
        layer.shapes = b.shapes;
        layer.groupPath = [...b.groupPath];
        layer.group = b.groupPath[0] || "";
        state.artLayers.push(layer);
    }

    // ---- Pass 2: one toolpath per shape ----
    let idx = 0;
    for (const item of allItems) {
        idx++;
        const pc = findOrCreatePlotColor(item.color, colorName(item.color));
        const tp = makeToolpath(`path ${idx}`, item.role === "fill" ? "fill" : "outline", null);
        tp.targetShapeIds = [item.shape.id];
        tp.plotColorId = pc.id;
        if (item.role === "fill") {
            tp.fill.pattern = "hatch";
            tp.drawOutline = false;
        } else {
            tp.fill.pattern = "none";
            tp.drawOutline = true;
        }
        state.toolpaths.push(tp);
    }
}

function walk(node, parentPaint, out, groupPath = []) {
    const paint = inheritPaint(node, parentPaint);
    const tag = node.tagName && node.tagName.toLowerCase();
    if (tag === "svg") {
        // Don't add the root SVG to the path.
        for (const child of Array.from(node.children)) walk(child, paint, out, groupPath);
        return;
    }
    if (tag === "g") {
        // Use the most identifying name available — Inkscape's user-facing
        // label wins, then id, then class. Skip anonymous/empty groups so
        // they don't clutter the panel with "group" entries.
        const name = node.getAttributeNS(INK_NS, "label")
            || node.getAttribute("id")
            || node.getAttribute("class")
            || "";
        const nextPath = name ? [...groupPath, name] : groupPath;
        for (const child of Array.from(node.children)) walk(child, paint, out, nextPath);
        return;
    }
    const shape = nodeToShape(node);
    if (!shape) return;
    // Emit one entry per role the shape has. A shape with both fill and
    // stroke → two entries, two layers, two pens. groupPath gets attached
    // so the layer/toolpath panels can render the full SVG hierarchy.
    // Tri-state semantics on each shape:
    //   undefined → inherit from layer's <g>
    //   null      → explicit "none"
    //   string    → that color
    // We pin BOTH _fill and _stroke on import so the SVG view doesn't
    // accidentally inherit a stroke from the layer default on fill-only
    // imported shapes (or vice versa).
    if (paint.fill) {
        out.push({
            shape: { ...shape, id: shape.id + "_f", _fill: paint.fill, _stroke: null },
            color: paint.fill, role: "fill", groupPath: [...groupPath],
        });
    }
    if (paint.stroke) {
        out.push({
            shape: { ...shape, id: shape.id + "_s", _stroke: paint.stroke, _fill: null },
            color: paint.stroke, role: "stroke", groupPath: [...groupPath],
        });
    }
    if (!paint.fill && !paint.stroke) {
        // SVG's default fill is black when neither fill nor stroke is
        // set. Match the browser's rendering: produce a fill toolpath,
        // not a stroke one.
        out.push({
            shape: { ...shape, _fill: "#000000", _stroke: null },
            color: "#000000", role: "fill", groupPath: [...groupPath],
        });
    }
}

function collectShapes(node, parentPaint, out) {
    const tag = node.tagName && node.tagName.toLowerCase();
    if (!tag) return;
    if (tag === "g") {
        const paint = inheritPaint(node, parentPaint);
        for (const c of Array.from(node.children)) collectShapes(c, paint, out);
        return;
    }
    const s = nodeToShape(node);
    if (s) out.push(s);
}

/** Resolve effective fill + stroke for a node, inheriting from the parent
 *  paint state. Honors both XML attributes and inline `style="..."`. */
export function inheritPaint(node, parentPaint) {
    if (!node || node.nodeType !== 1) return parentPaint;
    const fill = readPaint(node, "fill");
    const stroke = readPaint(node, "stroke");
    return {
        fill: fill === undefined ? parentPaint.fill : fill,
        stroke: stroke === undefined ? parentPaint.stroke : stroke,
    };
}

function readPaint(node, attr) {
    const direct = node.getAttribute && node.getAttribute(attr);
    if (direct != null) {
        const raw = direct.trim();
        const lower = raw.toLowerCase();
        const gradientMatch = lower.match(/^url\(\s*['"]?#([^\)'"]+)['"]?\s*\)$/);
        if (gradientMatch) {
            const color = resolveGradientColor(node, gradientMatch[1]);
            if (color != null) return color;
        }
        if (lower === "none" || lower === "transparent") return null;
        if (lower !== "") return normalizeColor(raw);
    }
    const style = node.getAttribute && node.getAttribute("style");
    if (style) {
        const re = new RegExp(`(?:^|;)\\s*${attr}\\s*:\\s*([^;]+)`, "i");
        const m = style.match(re);
        if (m) {
            const raw = m[1].trim();
            const lower = raw.toLowerCase();
            const gradientMatch = lower.match(/^url\(\s*['"]?#([^\)'"]+)['"]?\s*\)$/);
            if (gradientMatch) {
                const color = resolveGradientColor(node, gradientMatch[1]);
                if (color != null) return color;
            }
            if (lower === "none" || lower === "transparent") return null;
            return normalizeColor(raw);
        }
    }
    return undefined;
}

function resolveGradientColor(node, gradientId) {
    const doc = node.ownerDocument || document;
    const grad = doc.getElementById(gradientId);
    if (!grad) return undefined;
    const tag = grad.tagName && grad.tagName.toLowerCase();
    if (tag !== "lineargradient" && tag !== "radialgradient") return undefined;

    const stopColors = [];
    for (const stop of Array.from(grad.querySelectorAll("stop"))) {
        const stopColor = parseStopColor(stop);
        if (stopColor) stopColors.push(stopColor);
    }
    if (!stopColors.length) return undefined;
    return normalizeColor(stopColors[0]);
}

function parseStopColor(stop) {
    const direct = stop.getAttribute && stop.getAttribute("stop-color");
    if (direct != null && direct.trim() !== "") return direct.trim();
    const style = stop.getAttribute && stop.getAttribute("style");
    if (style) {
        const m = style.match(/(?:^|;)\s*stop-color\s*:\s*([^;]+)/i);
        if (m && m[1].trim() !== "") return m[1].trim();
    }
    return null;
}

/** Pen color = fill if it exists and isn't none, else stroke, else null.
 *  Filled shapes drive the layer color because that's the visible color
 *  the user designed with — and a pen plotter realizes "fill" as a
 *  hatching pattern in the same color. */
export function penColorFor(paint) {
    if (paint.fill) return paint.fill;
    if (paint.stroke) return paint.stroke;
    return null;
}

function nodeToShape(node) {
    const tag = node.tagName && node.tagName.toLowerCase();
    if (!tag) return null;
    const sid = () => "s" + (++_sCounter);
    switch (tag) {
        case "line":
            return { id: sid(), type: "line",
                x1: +node.getAttribute("x1") || 0, y1: +node.getAttribute("y1") || 0,
                x2: +node.getAttribute("x2") || 0, y2: +node.getAttribute("y2") || 0 };
        case "rect":
            return { id: sid(), type: "rect",
                x: +node.getAttribute("x") || 0, y: +node.getAttribute("y") || 0,
                w: +node.getAttribute("width") || 0, h: +node.getAttribute("height") || 0 };
        case "ellipse":
            return { id: sid(), type: "ellipse",
                cx: +node.getAttribute("cx") || 0, cy: +node.getAttribute("cy") || 0,
                rx: +node.getAttribute("rx") || 0, ry: +node.getAttribute("ry") || 0 };
        case "circle": {
            const r = +node.getAttribute("r") || 0;
            return { id: sid(), type: "ellipse",
                cx: +node.getAttribute("cx") || 0, cy: +node.getAttribute("cy") || 0,
                rx: r, ry: r };
        }
        case "polyline":
        case "polygon": {
            const pts = (node.getAttribute("points") || "").trim().split(/[ ,]+/).map(Number);
            const arr = [];
            for (let i = 0; i + 1 < pts.length; i += 2) arr.push([pts[i], pts[i + 1]]);
            if (tag === "polygon" && arr.length) arr.push(arr[0]);
            return arr.length >= 2 ? { id: sid(), type: "polyline", points: arr } : null;
        }
        case "path": {
            const d = node.getAttribute("d");
            return d ? { id: sid(), type: "path", d } : null;
        }
    }
    return null;
}
let _sCounter = 0;

/** Convert any CSS color (named, #rgb, #rrggbb, rgb(...)) to lowercase #rrggbb. */
function normalizeColor(color) {
    if (!color) return "#111111";
    const c = String(color).trim().toLowerCase();
    // Hex shorthand.
    if (/^#[0-9a-f]{3}$/.test(c)) {
        return "#" + c[1] + c[1] + c[2] + c[2] + c[3] + c[3];
    }
    if (/^#[0-9a-f]{6}$/.test(c)) return c;
    // rgb(...) / rgba(...).
    const rgb = c.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/);
    if (rgb) {
        const hex = (n) => Math.max(0, Math.min(255, +n)).toString(16).padStart(2, "0");
        return "#" + hex(rgb[1]) + hex(rgb[2]) + hex(rgb[3]);
    }
    // Named color — defer to the browser via a throwaway element.
    if (!_colorProbe) {
        _colorProbe = document.createElement("div");
        _colorProbe.style.display = "none";
        document.body.appendChild(_colorProbe);
    }
    _colorProbe.style.color = "";
    _colorProbe.style.color = c;
    const computed = window.getComputedStyle(_colorProbe).color;
    if (computed) {
        const m = computed.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/);
        if (m) {
            const hex = (n) => Math.max(0, Math.min(255, +n)).toString(16).padStart(2, "0");
            return "#" + hex(m[1]) + hex(m[2]) + hex(m[3]);
        }
    }
    return "#111111";
}
let _colorProbe = null;

/** Friendly layer name from a hex color. */
function colorName(hex) {
    const known = {
        "#000000": "black", "#111111": "black",
        "#ffffff": "white",
        "#ff0000": "red", "#00ff00": "green", "#0000ff": "blue",
        "#ffff00": "yellow", "#ff00ff": "magenta", "#00ffff": "cyan",
    };
    return known[hex] || hex;
}

function parseLen(v) {
    if (!v) return null;
    const m = String(v).trim().match(/^([\d.]+)\s*(mm|cm|in|px|)?$/);
    if (!m) return null;
    const n = +m[1];
    switch (m[2]) {
        case "cm": return n * 10;
        case "in": return n * 25.4;
        case "px": return n * 25.4 / 96;
        default: return n;
    }
}
