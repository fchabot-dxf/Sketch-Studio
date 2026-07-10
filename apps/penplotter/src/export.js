// Export: run the in-browser vpype pipeline on every exportable toolpath,
// render G-code per toolpath, package as a ZIP, and trigger a download.
// No backend needed — everything happens client-side via app/js/vpype/.

import { state } from "./state.js";
import { $, toast } from "./dom.js";
import { expandLayerWithFill } from "#core/plot/fills/index.js";   // PP-6: shared fill registry
import { expandLayerOutline } from "#core/plot/outlines/index.js"; // PP-6: shared outline registry
import { toolpathToGcode, buildZip } from "#core/plot/index.js";   // PP-6: shared vpype gcode + zip
import { resolveCoreShapes } from "./core-geometry.js";           // UNIFY-2: target #core geometry directly

export function installExportButton() {
    $("#exportBtn").onclick = onExportClick;
}

async function onExportClick() {
    if (state.toolpaths.every(tp => !tp.export)) {
        return toast("No active toolpaths selected for export — check at least one.", true);
    }

    const btn = $("#exportBtn");
    btn.disabled = true;
    btn.textContent = "Exporting…";
    try {
        const entries = buildGcodeEntries();
        if (entries.length === 0) {
            return toast("Nothing to plot — add vectors to your art layers first.", true);
        }
        const zip = buildZip(entries);
        downloadBlob(zip, "plotter_gcode.zip");
        toast(`Exported ${entries.length} G-code file${entries.length === 1 ? "" : "s"} → plotter_gcode.zip`);
    } catch (e) {
        toast(e.message, true);
        console.error(e);
    } finally {
        btn.disabled = false;
        btn.textContent = "Export G-code (.zip)";
    }
}

/** Build one G-code file per exportable toolpath. Returns ZIP entries
 *  ({ name, content }) ready to be passed to buildZip(). Exported (PP-6) so the live-verify can inspect the gcode. */
export function buildGcodeEntries() {
    const entries = [];
    let idx = 0;
    for (const tp of state.toolpaths) {
        if (!tp.export) continue;
        const targetShapes = collectToolpathShapes(tp);
        if (targetShapes.length === 0) continue;

        const finalShapes = expandToolpathShapes(tp, targetShapes);
        if (finalShapes.length === 0) continue;

        idx++;
        const safeName = (tp.name || `toolpath_${idx}`).replace(/[^a-z0-9_-]/gi, "_");
        const gcode = toolpathToGcode(finalShapes, {
            penUpZ:    state.settings.pen_up_z,
            penDownZ:  state.settings.pen_down_z,
            drawFeed:  state.settings.draw_feed,
            zFeed:     state.settings.z_feed,
            mergeTol:  0.05,
            simplifyTol: state.settings.tolerance_mm || 0.1,
            docH:      state.doc.h,
            flipY:     true,
            label:     tp.name,
        });
        entries.push({ name: `${idx}_${safeName}.gcode`, content: gcode });
    }
    return entries;
}

/** Apply outline/fill expansion (the same logic Render uses) so the
 *  shapes fed to vpype already include dashed outlines, hatching, etc. */
function expandToolpathShapes(tp, targetShapes) {
    const outlineShapes = tp.type === "outline" && tp.drawOutline !== false
        ? expandLayerOutline(targetShapes, tp.outline)
        : [];
    const filled = tp.type === "fill"
        ? expandLayerWithFill({ ...tp, shapes: targetShapes })
        : [];
    const fillOnly = tp.type === "fill"
        ? filled.slice(targetShapes.length)
        : [];
    return [...outlineShapes, ...fillOnly];
}

export function collectToolpathShapes(tp) {
    if (tp.targetType === "layer") {
        const layer = state.artLayers.find(l => l.id === tp.targetArtLayerId);
        return layer ? layer.shapes : [];
    }
    const selectedIds = new Set(tp.targetShapeIds.length ? tp.targetShapeIds : state.selectedShapeIds);
    if (selectedIds.size === 0) return [];
    const out = [];
    const found = new Set();
    for (const layer of state.artLayers) {
        for (const s of layer.shapes) {
            if (selectedIds.has(s.id)) { out.push(s); found.add(s.id); }
        }
    }
    // UNIFY-2: unmatched ids may name #core SKETCH geometry -> resolve directly (no bake). Coexists with art.
    const rest = [...selectedIds].filter(id => !found.has(id));
    if (rest.length) out.push(...resolveCoreShapes(rest));
    return out;
}

function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
}
