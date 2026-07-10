// Layer panel UI on the left sidebar. Renders the design/art layers list.

import { state, makeArtLayer, uid, remapToolpathTargets } from "./state.js";
import { layersEl, $, toast } from "./dom.js";
import { renderArt as render } from "./render-art.js"; // PP-3c: Draw's trimmed renderer
import { snapshot } from "./history.js";
import { closedPolygonFor } from "#core/plot/fills/utils.js"; // PP-3c: shared pure util
import { unionPolygons } from "#core/plot/clip.js";           // PP-3c: shared robust boolean engine
import { uiConfirm, uiChoose } from "./ui-dialog.js";

// group name → boolean (collapsed?)
const collapsed = new Map();

export function renderLayersPanel() {
    layersEl.innerHTML = "";

    const tree = buildLayerTree();
    if (tree.length === 0) {
        layersEl.textContent = "No art layers.";
        return;
    }

    for (const group of tree) {
        layersEl.appendChild(groupRow(group));
        if (collapsed.get(group.id)) continue;

        for (const colorBucket of group.colors) {
            // Default the tree to the second level: color buckets start
            // collapsed (roles/shapes hidden) until the user expands one.
            if (!collapsed.has(colorBucket.id)) collapsed.set(colorBucket.id, true);
            layersEl.appendChild(colorRow(colorBucket, group));
            if (collapsed.get(colorBucket.id)) continue;

            for (const roleBucket of colorBucket.roles) {
                layersEl.appendChild(roleRow(roleBucket, colorBucket, group));
                if (collapsed.get(roleBucket.id)) continue;

                for (const shape of roleBucket.shapes) {
                    layersEl.appendChild(shapeRow(shape, roleBucket, colorBucket, group));
                }
            }
        }
    }
}

function buildLayerTree() {
    const groups = new Map();
    const hasNamedGroups = state.artLayers.some(l => l.group && l.group.trim() !== "");
    const rootName = hasNamedGroups ? "ungrouped" : "All shapes";

    for (const layer of state.artLayers) {
        const groupKey = hasNamedGroups ? (layer.group || "") : rootName;
        const groupName = hasNamedGroups ? (layer.group || rootName) : rootName;
        if (!groups.has(groupKey)) {
            groups.set(groupKey, { id: groupId(groupKey), name: groupName, layers: [], colors: [] });
        }
        groups.get(groupKey).layers.push(layer);
    }

    for (const group of groups.values()) {
        const buckets = new Map();
        for (const layer of group.layers) {
            for (const shape of layer.shapes) {
                const entries = [];
                if (shape._fill !== undefined && shape._fill !== null) entries.push({ role: "fill", color: shape._fill, shape });
                if (shape._stroke !== undefined && shape._stroke !== null) entries.push({ role: "stroke", color: shape._stroke, shape });
                if (entries.length === 0 && layer.color) entries.push({ role: "stroke", color: layer.color, shape });

                for (const entry of entries) {
                    const color = normalizeColor(entry.color || "#000000");
                    const colorKey = color;
                    if (!buckets.has(colorKey)) {
                        buckets.set(colorKey, { id: colorId(group.id, colorKey), color, roles: [] });
                    }
                    const colorBucket = buckets.get(colorKey);
                    let roleBucket = colorBucket.roles.find(r => r.role === entry.role);
                    if (!roleBucket) {
                        roleBucket = { id: roleId(colorBucket.id, entry.role), role: entry.role, shapes: [] };
                        colorBucket.roles.push(roleBucket);
                    }
                    roleBucket.shapes.push(shape);
                }
            }
        }
        group.colors = [...buckets.values()].sort((a, b) => a.color.localeCompare(b.color));
        for (const colorBucket of group.colors) {
            colorBucket.roles.sort((a, b) => a.role.localeCompare(b.role));
        }
    }

    return [...groups.values()];
}

function groupId(groupKey) { return `group:${groupKey}`; }
function colorId(groupId, color) { return `${groupId}:color:${color}`; }
function roleId(colorId, role) { return `${colorId}:role:${role}`; }

function normalizeColor(value) {
    return value ? value.trim().toLowerCase() : "#000000";
}

function groupRow(group) {
    const row = document.createElement("div");
    row.className = "group-row";

    const isCollapsed = !!collapsed.get(group.id);
    const chevron = document.createElement("span");
    chevron.className = "chevron";
    chevron.textContent = isCollapsed ? "▸" : "▾";

    const visAll = document.createElement("span");
    visAll.className = "vis";
    const allVisible = group.layers.every(l => l.visible);
    visAll.textContent = allVisible ? "●" : "○";
    visAll.title = allVisible ? "Hide group" : "Show group";
    visAll.onclick = (e) => {
        e.stopPropagation();
        const target = !allVisible;
        for (const l of group.layers) l.visible = target;
        render();
    };

    const title = document.createElement("span");
    title.className = "group-name";
    title.textContent = group.name;

    const count = document.createElement("span");
    count.className = "group-count";
    count.textContent = `${group.colors.reduce((sum, c) => sum + c.roles.reduce((r, b) => r + b.shapes.length, 0), 0)}`;

    row.onclick = () => { collapsed.set(group.id, !isCollapsed); renderLayersPanel(); };
    row.append(chevron, visAll, title, count);
    return row;
}

function colorRow(colorBucket, group) {
    const row = document.createElement("div");
    row.className = "group-row indented";

    const isCollapsed = !!collapsed.get(colorBucket.id);
    const chevron = document.createElement("span");
    chevron.className = "chevron";
    chevron.textContent = isCollapsed ? "▸" : "▾";

    const sw = document.createElement("span");
    sw.className = "swatch";
    sw.style.background = colorBucket.color;

    const title = document.createElement("span");
    title.className = "group-name";
    title.textContent = colorBucket.color;

    const count = document.createElement("span");
    count.className = "group-count";
    count.textContent = `${colorBucket.roles.reduce((sum, role) => sum + role.shapes.length, 0)}`;

    row.onclick = () => { collapsed.set(colorBucket.id, !isCollapsed); renderLayersPanel(); };
    row.append(chevron, sw, title, count);
    return row;
}

function roleRow(roleBucket, colorBucket, group) {
    const row = document.createElement("div");
    row.className = "group-row indented";
    row.style.paddingLeft = "32px";
    // No swatch on role rows — drop the swatch column so the name gets the
    // wide cell instead of being squeezed into 14px and clipped ("f..").
    row.style.gridTemplateColumns = "12px 1fr auto";

    const isCollapsed = !!collapsed.get(roleBucket.id);
    const chevron = document.createElement("span");
    chevron.className = "chevron";
    chevron.textContent = isCollapsed ? "▸" : "▾";

    const title = document.createElement("span");
    title.className = "group-name";
    title.textContent = roleBucket.role === "fill" ? "Fills" : "Strokes";

    const count = document.createElement("span");
    count.className = "group-count";
    count.textContent = `${roleBucket.shapes.length}`;

    row.onclick = () => { collapsed.set(roleBucket.id, !isCollapsed); renderLayersPanel(); };
    row.append(chevron, title, count);
    return row;
}

function shapeRow(shape, roleBucket, colorBucket, group) {
    const row = document.createElement("div");
    row.className = "layer-row indented shape-leaf";
    row.style.paddingLeft = "48px";
    if (state.selectedShapeIds.has(shape.id)) row.classList.add("active");

    const sw = document.createElement("span");
    sw.className = "swatch";
    sw.style.background = colorBucket.color;

    const label = document.createElement("span");
    label.className = "group-name";
    label.textContent = shapeLabel(shape, roleBucket.role);

    row.onclick = (e) => {
        e.stopPropagation();
        state.selectedShapeIds = new Set([shape.id]);
        render();
    };
    row.append(sw, label);
    return row;
}

function shapeLabel(shape, role) {
    const type = shape.type || "path";
    const suffix = shape.id ? ` (${shape.id.slice(-6)})` : "";
    return `${type}${suffix}`;
}

function layerRow(layer, indented) {
    const row = document.createElement("div");
    row.className = "layer-row" + (indented ? " indented" : "");
    if (layer.id === state.activeArtLayerId) row.classList.add("active");

    // Count selected shapes in this layer for the visual indicator.
    let selectedCount = 0;
    for (const s of layer.shapes) {
        if (state.selectedShapeIds.has(s.id)) selectedCount++;
    }
    if (selectedCount > 0) row.classList.add("has-selection");

    const vis = el("span", { class: "vis", title: layer.visible ? "Hide on canvas" : "Show on canvas" },
                   layer.visible ? "●" : "○");
    vis.onclick = (e) => { e.stopPropagation(); layer.visible = !layer.visible; render(); };

    const sw = el("span", { class: "swatch", title: "Click to change color" });
    sw.style.background = layer.color;
    sw.onclick = (e) => {
        e.stopPropagation();
        const input = document.createElement("input");
        input.type = "color"; input.value = layer.color;
        input.oninput = (ev) => { layer.color = ev.target.value; render(); };
        input.click();
    };

    const baseName = indented && layer.group
        ? layer.name.replace(new RegExp("^" + escapeRe(layer.group) + "\\s*/\\s*"), "")
        : layer.name;

    const name = el("input", { class: "name", value: baseName });
    name.onclick = (e) => e.stopPropagation();
    name.onchange = (e) => {
        const v = e.target.value || "layer";
        layer.name = indented && layer.group ? `${layer.group} / ${v}` : v;
        renderLayersPanel();
    };

    const badge = selectedCount > 0
        ? el("span", { class: "sel-count", title: `${selectedCount} selected` }, String(selectedCount))
        : null;

    const del = el("span", { class: "del", title: "Delete layer" }, "×");
    del.onclick = (e) => {
        e.stopPropagation();
        if (state.artLayers.length <= 1) { toast("Need at least one layer.", true); return; }
        snapshot();
        state.artLayers = state.artLayers.filter(l => l.id !== layer.id);
        if (state.activeArtLayerId === layer.id) state.activeArtLayerId = state.artLayers[state.artLayers.length - 1].id;
        render();
    };

    row.onclick = () => {
        state.activeArtLayerId = layer.id;
        renderLayersPanel();
    };
    row.append(vis, sw, name);
    if (badge) row.append(badge);
    row.append(del);
    return row;
}

function el(tag, attrs = {}, text) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (text != null) e.textContent = text;
    return e;
}

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

export function installLayerButtons() {
    $("#addLayer").onclick = () => {
        snapshot();
        const colors = ["#111111", "#c4444f", "#0e639c", "#3a8a3e", "#a060b0", "#c08020"];
        const color = colors[state.artLayers.length % colors.length];
        const layer = makeArtLayer(`layer ${state.artLayers.length + 1}`, color);
        state.artLayers.push(layer);
        state.activeArtLayerId = layer.id;
        render();
    };
    $("#clearLayer").onclick = async () => {
        const l = state.artLayers.find(l => l.id === state.activeArtLayerId);
        if (!l || !l.shapes.length) return;
        if (!await uiConfirm(`Clear all shapes in "${l.name}"?`)) return;
        snapshot();
        l.shapes = [];
        render();
    };
    const mergeBtn = $("#mergeShapes");
    if (mergeBtn) mergeBtn.onclick = mergeSelectedShapes;
}

/** Boolean-union the selected shapes into a single path (their combined
 *  outline) via Clipper. The result lands in the layer of the first
 *  selected shape and inherits its fill/stroke styling. */
async function mergeSelectedShapes() {
    const ids = state.selectedShapeIds;
    if (!ids || ids.size < 2) { toast("Select 2 or more shapes to merge.", true); return; }

    const sel = [];
    let targetLayer = null;
    for (const l of state.artLayers) {
        for (const s of l.shapes) {
            if (ids.has(s.id)) { sel.push(s); if (!targetLayer) targetLayer = l; }
        }
    }
    if (sel.length < 2) { toast("Select 2 or more shapes to merge.", true); return; }

    const polys = sel.map(closedPolygonFor).filter(p => p && p.length >= 4);
    if (polys.length < 2) { toast("Merge needs at least 2 closed shapes.", true); return; }

    const rings = unionPolygons(polys);
    if (!rings.length) { toast("Merge produced no geometry.", true); return; }

    const mode = await uiChoose(
        `Merge ${sel.length} shapes into one outline?`,
        [
            { value: "replace", label: "Replace the originals with the merged shape" },
            { value: "keep", label: "Keep the originals and add the merged shape" },
        ],
        { defaultValue: "replace", okLabel: "Merge" },
    );
    if (!mode) return; // cancelled

    snapshot();
    const d = rings
        .map(r => "M " + r.map(p => `${p[0].toFixed(3)},${p[1].toFixed(3)}`).join(" L ") + " Z")
        .join(" ");
    const merged = { id: uid("shape"), type: "path", d };
    for (const k of ["_fill", "_stroke", "_strokeWidth"]) {
        if (sel[0][k] !== undefined) merged[k] = sel[0][k];
    }
    if (mode === "replace") {
        for (const s of sel) remapToolpathTargets(s.id, [merged.id]); // toolpaths follow the merge
        for (const l of state.artLayers) l.shapes = l.shapes.filter(s => !ids.has(s.id));
    }
    targetLayer.shapes.push(merged);
    state.selectedShapeIds = new Set([merged.id]);
    render();
    toast(mode === "replace" ? `Merged ${sel.length} shapes` : `Merged ${sel.length} shapes (originals kept)`);
}
