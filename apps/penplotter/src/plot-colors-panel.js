// Plot Colors panel — top of the right sidebar in plot/sim modes.
// Renders the pen palette discovered from imports and lets the user edit
// it. Each toolpath references a plot color by id, so renames/recolors
// here cascade to the Toolpath Layers list, toolpath preview, etc.

import { state, makePlotColor, DEFAULT_PEN_WIDTH } from "./state.js";
import { $, toast } from "./dom.js";
import { snapshot } from "./history.js";
import { renderArt as render } from "./render-art.js"; // PP-3c: Draw's trimmed renderer
// PP-3c STUB: cloud palette save/load is a CLOUD-stage feature. The Draw scaffold omits the load/save-palette
// buttons, so these are never invoked; the local stubs keep this panel free of cloud.js / dom.API_BASE deps (the
// pen add/assign path needs none of it). Real cloud wiring lands with the Cloud stage.
const cloud = { isConfigured: () => false, listPalettes: async () => [], listFolders: async () => [],
  saveFolders: async () => {}, setPaletteFolder: async () => {}, loadPalette: async () => null,
  savePalette: async () => {}, deletePalette: async () => {}, renamePalette: async () => {} };
function openPicker() {}
import { uiPrompt, uiChoose } from "./ui-dialog.js";

export function installPlotColorsPanel() {
    const addBtn = $("#addPlotColor");
    if (addBtn) addBtn.onclick = () => {
        snapshot();
        state.plotColors.push(makePlotColor(`pen ${state.plotColors.length + 1}`, "#111111"));
        render();
    };
    // Save = quick named save of the current pens. Load = the rich picker
    // popover (clickable list + delete/rename/duplicate), same UX as the
    // project picker. (The HTML buttons were previously left unwired.)
    const saveBtn = $("#savePalette");
    if (saveBtn) saveBtn.onclick = onSavePalette;
    const loadBtn = $("#loadPalette");
    if (loadBtn) loadBtn.onclick = (e) => openPalettePicker(e.currentTarget);
}

function openPalettePicker(anchor) {
    openPicker(anchor, {
        modal: true,
        title: "Palette presets",
        saveLbl: "Save as new",
        list: () => cloud.listPalettes(),

        // Folders
        folders: () => cloud.listFolders("palettes"),
        saveFolders: (arr) => cloud.saveFolders("palettes", arr),
        setItemFolder: (id, folder) => cloud.setPaletteFolder(id, folder),
        // Show each saved palette's pen colours as an inline swatch strip.
        // The list API only returns names, so lazily fetch per row.
        getSwatches: async (id) => {
            const obj = await cloud.loadPalette(id);
            return (obj && Array.isArray(obj.palette)) ? obj.palette.map(pc => pc && pc.color) : [];
        },
        save: async () => {
            if (!state.plotColors.length) { toast("No pens to save.", true); return null; }
            const name = await uiPrompt("Palette name:", suggestPaletteName());
            if (!name) return null;
            const payload = state.plotColors.map(pc => ({ ...pc }));
            return cloud.savePalette(name, payload);
        },
        load: async (id) => {
            const obj = await cloud.loadPalette(id);
            if (!obj || !Array.isArray(obj.palette)) { toast("Palette payload empty.", true); return; }
            applyPalette(obj.palette);
            toast(`Loaded palette "${obj.name || ""}"`);
        },
        del: (id) => cloud.deletePalette(id),
        rename: (id, newName) => cloud.renamePalette(id, newName),
        duplicate: async (id) => {
            const obj = await cloud.loadPalette(id);
            if (!obj || !Array.isArray(obj.palette)) throw new Error("Source palette missing.");
            const name = `${obj.name || "untitled"} (copy)`;
            return cloud.savePalette(name, obj.palette);
        },
    });
}

// ---------- cloud palette save / load ----------

async function onSavePalette() {
    if (!cloud.isConfigured()) { toast("Set Worker URL + API key in Settings first.", true); return; }
    if (!state.plotColors.length) { toast("No pens to save.", true); return; }
    const name = await uiPrompt("Palette name:", suggestPaletteName());
    if (!name) return;
    try {
        const payload = state.plotColors.map(pc => ({ ...pc }));
        const r = await cloud.savePalette(name, payload);
        toast(`Saved palette "${r.name}"`);
    } catch (e) {
        toast(e.message, true);
    }
}

/** Replace the current palette with `next`, gracefully reassigning
 *  any toolpaths whose pen disappeared to the nearest remaining pen. */
function applyPalette(next) {
    snapshot();
    const oldById = new Map(state.plotColors.map(pc => [pc.id, pc]));
    state.plotColors = next.map(pc => ({ ...pc }));
    const stillExists = new Set(state.plotColors.map(pc => pc.id));
    for (const tp of state.toolpaths) {
        if (tp.plotColorId && !stillExists.has(tp.plotColorId)) {
            const old = oldById.get(tp.plotColorId);
            tp.plotColorId = old ? nearestPen(old.color, state.plotColors).id : state.plotColors[0]?.id || null;
        }
    }
    render();
}

function suggestPaletteName() {
    const n = state.plotColors.length;
    return `palette-${n}-pens-${new Date().toISOString().slice(0, 10)}`;
}

export function renderPlotColorsPanel() {
    const root = $("#plotColors");
    if (!root) return;
    root.innerHTML = "";

    if (state.plotColors.length === 0) {
        root.innerHTML = `<div class="empty">Import an SVG or click + to add a pen.</div>`;
        return;
    }

    for (const pc of state.plotColors) {
        root.appendChild(plotColorRow(pc));
    }
}

function plotColorRow(pc) {
    const row = document.createElement("div");
    row.className = "pc-row";

    // Count how many toolpaths use this pen — small badge for at-a-glance
    // sense of which pens actually matter.
    const usedBy = state.toolpaths.filter(tp => tp.plotColorId === pc.id).length;

    // Swatch — click opens a native color picker that updates the pen.
    const swatch = document.createElement("button");
    swatch.className = "pc-swatch";
    swatch.style.background = pc.color;
    swatch.title = "Click to change pen color";
    const colorInput = document.createElement("input");
    colorInput.type = "color";
    colorInput.value = pc.color;
    colorInput.style.position = "absolute";
    colorInput.style.opacity = "0";
    colorInput.style.pointerEvents = "none";
    colorInput.style.width = "1px"; colorInput.style.height = "1px";
    swatch.appendChild(colorInput);
    swatch.onclick = () => colorInput.click();
    let pickStarted = false;
    colorInput.oninput = () => {
        if (!pickStarted) { snapshot(); pickStarted = true; }
        pc.color = colorInput.value;
        render();
    };
    colorInput.onchange = () => { pickStarted = false; };

    // Name input — rename the pen.
    const name = document.createElement("input");
    name.className = "pc-name";
    name.type = "text";
    name.value = pc.name;
    name.onchange = () => {
        snapshot();
        pc.name = name.value || "pen";
        render();
    };

    // Pen tip width (mm) — the pen owns the width; all its toolpaths draw
    // at it, and it's saved with the palette preset.
    const width = document.createElement("input");
    width.className = "pc-width";
    width.type = "number";
    width.min = "0.05"; width.max = "5"; width.step = "0.05";
    width.value = pc.width != null ? pc.width : DEFAULT_PEN_WIDTH;
    width.title = "Pen width (mm) — applies to every toolpath using this pen";
    width.onchange = () => {
        snapshot();
        pc.width = Math.max(0.01, +width.value || DEFAULT_PEN_WIDTH);
        render();
    };

    const badge = document.createElement("span");
    badge.className = "pc-badge";
    badge.textContent = usedBy;
    badge.title = `${usedBy} toolpath${usedBy === 1 ? "" : "s"} using this pen`;

    const del = document.createElement("span");
    del.className = "pc-del";
    del.textContent = "×";
    del.title = "Delete pen — toolpaths get reassigned to the nearest remaining pen";
    del.onclick = async (e) => {
        e.stopPropagation();
        const remaining = state.plotColors.filter(p => p.id !== pc.id);
        if (remaining.length === 0) {
            toast("Can't delete the last pen — at least one is required.", true);
            return;
        }
        let target = null;
        if (usedBy > 0) {
            const closest = nearestPen(pc.color, remaining);
            const choiceId = await uiChoose(
                `Delete "${pc.name}". ${usedBy} toolpath${usedBy === 1 ? "" : "s"} use it — reassign to which pen?`,
                remaining.map(p => ({ value: p.id, label: p.name + (p.id === closest.id ? "  (closest)" : ""), color: p.color })),
                { defaultValue: closest.id, okLabel: "Delete & reassign" },
            );
            if (!choiceId) return;
            target = remaining.find(p => p.id === choiceId) || closest;
        }
        snapshot();
        if (target) {
            for (const tp of state.toolpaths) {
                if (tp.plotColorId === pc.id) tp.plotColorId = target.id;
            }
        }
        state.plotColors = remaining;
        render();
    };

    row.append(swatch, name, width, badge, del);
    return row;
}

/** Find the pen in `pool` whose color is closest to `targetHex` in RGB
 *  Euclidean distance — used to gracefully reassign toolpaths when their
 *  pen is deleted. */
function nearestPen(targetHex, pool) {
    const [tr, tg, tb] = hexToRgb(targetHex);
    let best = pool[0], bestDist = Infinity;
    for (const p of pool) {
        const [r, g, b] = hexToRgb(p.color);
        const d = (r - tr) ** 2 + (g - tg) ** 2 + (b - tb) ** 2;
        if (d < bestDist) { bestDist = d; best = p; }
    }
    return best;
}

function hexToRgb(h) {
    const m = (h || "#111111").trim().match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
    if (!m) return [17, 17, 17];
    return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}
