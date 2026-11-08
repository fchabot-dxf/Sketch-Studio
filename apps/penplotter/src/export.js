// Export: run the in-browser vpype pipeline on every exportable toolpath,
// render G-code per toolpath, package as a ZIP, and trigger a download.
// No backend needed — everything happens client-side via app/js/vpype/.

import { state, toolpathPenId } from "./state.js";
import { $, toast } from "./dom.js";
import { expandLayerWithFill } from "#core/plot/fills/index.js";   // PP-6: shared fill registry
import { expandLayerOutline } from "#core/plot/outlines/index.js"; // PP-6: shared outline registry
import { toolpathToGcodeSections, buildZip } from "#core/plot/index.js";   // PP-6: shared vpype gcode + zip
import { collectToolpathShapes } from "./core-geometry.js";         // TASK 440: unified shapes-of-a-toolpath

export function installExportButton() {
    $("#exportBtn").onclick = onExportClick;
}

export async function onExportClick() {
    if (state.toolpaths.every(tp => !tp.export)) {
        return toast("No active toolpaths selected for export — check at least one.", true);
    }

    const btn = $("#exportBtn"); // null when the sidebar triggers the export before the Export stage was ever mounted
    if (btn) { btn.disabled = true; btn.textContent = "Exporting…"; }
    try {
        const entries = buildGcodeEntries();
        if (entries.length === 0) {
            return toast("Nothing to plot — draw or import geometry on the Design tab, then target it with + Outline or + Fill.", true);
        }
        const zip = buildZip(entries);
        downloadBlob(zip, "plotter_gcode.zip");
        toast(exportSummary(entries.length));
    } catch (e) {
        toast(e.message, true);
        console.error(e);
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = "Export G-code (.zip)"; }
    }
}

/** Build the G-code ZIP entries ({ name, content }) for buildZip(): one file per pen (default) or one per exportable
 *  toolpath, per state.settings.export_files. Exported (PP-6) so the live-verify can inspect the gcode. */
export function buildGcodeEntries() {
    const perPen = state.settings.export_files !== "toolpath";
    const items = [];
    for (const tp of state.toolpaths) {
        if (!tp.export) continue;
        const targetShapes = collectToolpathShapes(tp);
        if (targetShapes.length === 0) continue;

        const finalShapes = expandToolpathShapes(tp, targetShapes);
        if (finalShapes.length === 0) continue;

        items.push({ tp, sections: toolpathToGcodeSections(finalShapes, {
            penUpZ:    state.settings.pen_up_z,
            penDownZ:  state.settings.pen_down_z,
            drawFeed:  state.settings.draw_feed,
            zFeed:     state.settings.z_feed,
            mergeTol:  0.05,
            simplifyTol: state.settings.tolerance_mm,
            docH:      state.doc.h,
            flipY:     true,
            label:     tp.name,
        }) });
    }

    const slug = (s) => String(s).replace(/[^a-z0-9_-]/gi, "_");
    if (!perPen) {
        return items.map(({ tp, sections }, i) => ({
            name: `${i + 1}_${slug(tp.name || `toolpath_${i + 1}`)}.gcode`,
            content: sections.header + sections.body + sections.footer,
        }));
    }

    // One file per pen, in the order each pen first appears in the panel; the preamble/postamble appear once.
    const groups = new Map();
    for (const it of items) {
        const penId = toolpathPenId(it.tp);
        if (!groups.has(penId)) groups.set(penId, []);
        groups.get(penId).push(it);
    }
    return [...groups.entries()].map(([penId, list], i) => {
        const pen = state.plotColors.find(p => p.id === penId);
        const name = penId && pen ? slug(pen.name || pen.color || `pen_${i + 1}`) : "no-pen";
        return {
            name: `${i + 1}_${name}.gcode`,
            content: list[0].sections.header + list.map(it => it.sections.body).join("") + list[0].sections.footer,
        };
    });
}

/** The export toast: how many files, and in which mode. */
export function exportSummary(count) {
    const mode = state.settings.export_files === "toolpath" ? "one per toolpath" : "one per pen";
    return `Exported ${count} G-code file${count === 1 ? "" : "s"} (${mode}) → plotter_gcode.zip`;
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

export { collectToolpathShapes };

function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
}
