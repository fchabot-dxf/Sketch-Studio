// Right-panel toolpath list.
//
// Three-level tree:
//   1. Plot color folder      — one per pen in state.plotColors
//      2. Role subfolder       — "stroke" and "fill" buckets
//         3. Toolpath row      — one per individual path/shape
//
// Pen swatch on every row reflects the linked plot color, so renames in
// the Plot Colors panel cascade here automatically.

import { state, makeToolpath, toolpathColor, findOrCreatePlotColor } from "./state.js";
import { $, toast } from "./dom.js";
import { renderArt as render } from "./render-art.js"; // PP-4b: Draw's trimmed renderer (art + toolpath overlay)
import { snapshot } from "./history.js";
import { recalcPreview, isPreviewStale } from "./preview.js";

/** Reflect toolpath freshness on the Recalculate button: glows when the
 *  cached toolpath no longer matches the artwork, "Recalculating…" while busy. */
function updateRecalcButton() {
    const b = $("#recalcBtn");
    if (!b) return;
    const fetching = state.preview.cache && state.preview.cache.fetching;
    const stale = isPreviewStale();
    b.disabled = !!fetching;
    b.classList.toggle("stale", stale && !fetching);
    b.textContent = fetching ? "Recalculating…" : (stale ? "Recalculate •" : "Recalculate");
}

const collapsedPen = new Map();   // pen id → collapsed?
const collapsedRole = new Map();  // "pen|role" key → collapsed?

export function renderToolpathLayersPanel() {
    updateRecalcButton();
    const root = $("#toolpathLayers");
    if (!root) return;
    root.innerHTML = "";

    // Build pen → role → [toolpaths]. Unlinked toolpaths fall under "(no pen)".
    const byPen = new Map();
    for (const tp of state.toolpaths) {
        const penId = tp.plotColorId || "__none__";
        if (!byPen.has(penId)) byPen.set(penId, { outline: [], fill: [] });
        const role = tp.type === "fill" ? "fill" : "outline";
        byPen.get(penId)[role].push(tp);
    }

    // Iterate pens in palette order (plus "__none__" if present).
    const penIds = state.plotColors.map(p => p.id).filter(id => byPen.has(id));
    if (byPen.has("__none__")) penIds.push("__none__");

    for (const penId of penIds) {
        const pc = penId === "__none__"
            ? { id: "__none__", name: "(no pen)", color: "#666" }
            : state.plotColors.find(p => p.id === penId);
        if (!pc) continue;
        const buckets = byPen.get(penId);
        const total = buckets.outline.length + buckets.fill.length;

        root.appendChild(penHeader(pc, total, buckets));
        if (collapsedPen.get(penId)) continue;

        for (const role of ["outline", "fill"]) {
            const tps = buckets[role];
            if (!tps.length) continue;
            const roleKey = `${penId}|${role}`;
            root.appendChild(roleHeader(role, tps, roleKey, pc.color));
            if (collapsedRole.get(roleKey)) continue;
            for (const tp of tps) {
                root.appendChild(toolpathRow(tp, pc.color));
            }
        }
    }
}

function penHeader(pc, total, buckets) {
    const row = document.createElement("div");
    row.className = "group-row";
    if (state.selectedPenId === pc.id) row.classList.add("pen-selected");

    // Drag handle — visible affordance + drag source for reordering
    // pen folders. Dropping one pen header on another swaps their
    // order in state.plotColors AND re-groups state.toolpaths so the
    // execution order matches the new panel order.
    const handle = el("span", "drag-handle", "⋮⋮");
    handle.title = "Drag to reorder pen";
    row.draggable = true;
    row.ondragstart = (e) => {
        e.dataTransfer.setData("text/plain", JSON.stringify({ kind: "pen-move", id: pc.id }));
        e.dataTransfer.effectAllowed = "move";
        row.classList.add("dragging");
    };
    row.ondragend = () => row.classList.remove("dragging");
    // Drop target — accepts either a pen reorder or a toolpath-move.
    installPenDropTarget(row, pc.id);
    const isCollapsed = !!collapsedPen.get(pc.id);

    // Chevron — its own click handles collapse toggle ONLY, so that
    // tapping the rest of the row can select the pen folder instead.
    const chev = el("span", "chevron", isCollapsed ? "▸" : "▾");
    chev.style.cursor = "pointer";
    chev.onclick = (e) => {
        e.stopPropagation();
        collapsedPen.set(pc.id, !isCollapsed);
        renderToolpathLayersPanel();
    };

    const exp = document.createElement("input");
    exp.type = "checkbox";
    exp.className = "exp";
    const allTps = [...buckets.outline, ...buckets.fill];
    exp.checked = allTps.every(t => t.export);
    exp.indeterminate = !exp.checked && allTps.some(t => t.export);
    exp.title = "Export entire pen";
    exp.onclick = (e) => e.stopPropagation();
    exp.onchange = () => { for (const t of allTps) t.export = exp.checked; render(); };

    // Pen header shows only the swatch as identity — hex codes like
    // "#3aa3ff" as a label are noise. The swatch is the name.
    const sw = document.createElement("span");
    sw.className = "swatch";
    sw.style.background = pc.color;
    sw.style.width = "16px";
    sw.style.height = "16px";
    sw.style.borderRadius = "3px";
    sw.style.border = "1px solid rgba(255,255,255,.25)";
    sw.title = pc.name;  // tooltip still shows the name for accessibility

    const count = el("span", "group-count", String(total));

    // Clicking the row (anywhere except the chevron / export checkbox)
    // selects this pen folder. New toolpath buttons honor that.
    row.onclick = () => {
        state.selectedPenId = state.selectedPenId === pc.id ? null : pc.id;
        renderToolpathLayersPanel();
    };
    row.style.display = "grid";
    row.style.gridTemplateColumns = "12px 12px 14px 16px 1fr auto";
    row.style.gap = "4px";
    // Empty filler so the count stays right-aligned in the last column.
    row.append(handle, chev, exp, sw, document.createElement("span"), count);
    return row;
}

function roleHeader(role, tps, roleKey, penColor) {
    const row = document.createElement("div");
    row.className = "group-row";
    row.style.paddingLeft = "18px";
    row.style.background = "rgba(255,255,255,.015)";
    // The role key is "{penId}|{role}". Extract the pen id so dropping
    // here works the same as dropping on the parent pen header.
    const penIdFromRoleKey = roleKey.split("|")[0];
    if (penIdFromRoleKey && penIdFromRoleKey !== "__none__") {
        installDropTarget(row, penIdFromRoleKey);
    }
    const isCollapsed = !!collapsedRole.get(roleKey);

    const chev = el("span", "chevron", isCollapsed ? "▸" : "▾");

    const exp = document.createElement("input");
    exp.type = "checkbox";
    exp.className = "exp";
    exp.checked = tps.every(t => t.export);
    exp.indeterminate = !exp.checked && tps.some(t => t.export);
    exp.title = `Export all ${role} paths`;
    exp.onclick = (e) => e.stopPropagation();
    exp.onchange = () => { for (const t of tps) t.export = exp.checked; render(); };

    const title = el("span", "group-name", role);
    title.style.fontSize = "11px";
    title.style.fontWeight = "500";
    const count = el("span", "group-count", String(tps.length));

    row.onclick = () => { collapsedRole.set(roleKey, !isCollapsed); renderToolpathLayersPanel(); };
    row.style.display = "grid";
    row.style.gridTemplateColumns = "12px 14px 1fr auto";
    row.style.gap = "4px";
    row.append(chev, exp, title, count);
    return row;
}

function toolpathRow(toolpath, penColor) {
    const row = document.createElement("div");
    row.className = "tp-layer-row";
    row.style.paddingLeft = "34px";
    if (toolpath.id === state.activeToolpathId) row.classList.add("active");

    // Drag source — drop on a pen header (or its role header) moves
    // this toolpath into that pen. Drop on ANOTHER toolpath row puts
    // the dragged set before/after that row in state.toolpaths,
    // reassigning to the target row's pen at the same time. Multi-
    // selection moves together.
    row.draggable = true;
    row.ondragstart = (e) => {
        const ids = state.selectedToolpathIds.has(toolpath.id) && state.selectedToolpathIds.size > 1
            ? [...state.selectedToolpathIds]
            : [toolpath.id];
        e.dataTransfer.setData("text/plain", JSON.stringify({ kind: "toolpath-move", ids }));
        e.dataTransfer.effectAllowed = "move";
        row.classList.add("dragging");
    };
    row.ondragend = () => row.classList.remove("dragging");

    // Drop target — reorder. We don't use the generic installDropTarget
    // because for rows we also care about insertion position.
    row.ondragover = (e) => {
        if (!e.dataTransfer.types.includes("text/plain")) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        // Cursor Y vs row midpoint decides before/after.
        const rect = row.getBoundingClientRect();
        const after = e.clientY > rect.top + rect.height / 2;
        row.classList.toggle("drop-before", !after);
        row.classList.toggle("drop-after",   after);
    };
    row.ondragleave = () => {
        row.classList.remove("drop-before", "drop-after");
    };
    row.ondrop = (e) => {
        e.preventDefault();
        const after = row.classList.contains("drop-after");
        row.classList.remove("drop-before", "drop-after");
        let payload;
        try { payload = JSON.parse(e.dataTransfer.getData("text/plain") || "null"); }
        catch { return; }
        if (!payload || payload.kind !== "toolpath-move" || !Array.isArray(payload.ids)) return;
        reorderToolpaths(payload.ids, toolpath.id, after);
    };
    // Multi-selection highlight — box-select in toolpath mode marks every
    // hit toolpath, the row should reflect that for bulk edit clarity.
    if (state.selectedToolpathIds.has(toolpath.id)) row.classList.add("selected");
    // Target-editing highlight — orange tint so it's visually distinct
    // from a plain selection.
    if (state.targetEditingToolpathId === toolpath.id) row.classList.add("target-editing");
    // S2 (7b): reverse cross-highlight — mark this row when the geometry it targets is hovered on the canvas.
    if (state.hoveredShapeId && (toolpath.targetShapeIds || []).includes(state.hoveredShapeId)) row.classList.add("geo-hovered");
    // S2 (7a): hovering the row ghosts its target geometry on the canvas (canvas-only redraw — keeps this row's
    // listeners alive; the row's own :hover highlight is CSS).
    row.onmouseenter = () => { state.hoveredToolpathId = toolpath.id; render({ skipPanels: true }); };
    row.onmouseleave = () => { if (state.hoveredToolpathId === toolpath.id) { state.hoveredToolpathId = null; render({ skipPanels: true }); } };

    const exp = document.createElement("input");
    exp.type = "checkbox";
    exp.className = "exp";
    exp.checked = !!toolpath.export;
    exp.title = "Include in G-code export";
    exp.onclick = (e) => e.stopPropagation();
    exp.onchange = () => { toolpath.export = exp.checked; render(); };

    const sw = document.createElement("span");
    sw.className = "swatch";
    sw.style.background = toolpathColor(toolpath);

    // Render the name as a plain span — a single click on it activates
    // the row (selects the toolpath) instead of entering edit mode. To
    // rename, double-click; we swap the span for an input in-place.
    const nameSpan = document.createElement("span");
    nameSpan.className = "tp-layer-name";
    nameSpan.textContent = toolpath.name;
    nameSpan.style.fontSize = "11px";
    nameSpan.style.cursor = "pointer";
    nameSpan.style.overflow = "hidden";
    nameSpan.style.textOverflow = "ellipsis";
    nameSpan.style.whiteSpace = "nowrap";
    // Double-clicking the name (or anywhere on the row) edits the target
    // shapes — the natural gesture. Rename moved to the ✎ icon.
    nameSpan.ondblclick = (e) => { e.stopPropagation(); enterTargetEditing(toolpath); };

    const beginRename = () => {
        const input = document.createElement("input");
        input.value = toolpath.name;
        input.style.background = "var(--panel-2)";
        input.style.border = "1px solid var(--accent-hi)";
        input.style.color = "inherit";
        input.style.fontSize = "11px";
        input.style.padding = "0 3px";
        input.style.minWidth = "0";
        input.style.width = "100%";
        const commit = () => {
            toolpath.name = input.value || "path";
            renderToolpathLayersPanel();
        };
        input.onblur = commit;
        input.onkeydown = (ev) => {
            if (ev.key === "Enter") { ev.preventDefault(); input.blur(); }
            else if (ev.key === "Escape") { input.value = toolpath.name; input.blur(); }
        };
        input.onclick = (ev) => ev.stopPropagation();
        nameSpan.replaceWith(input);
        input.focus();
        input.select();
    };

    const ren = document.createElement("span");
    ren.className = "ren";
    ren.innerHTML = "✎";
    ren.title = "Rename toolpath";
    ren.style.cursor = "pointer";
    ren.style.fontSize = "10px";
    ren.style.color = "var(--text-dim)";
    ren.onclick = (e) => { e.stopPropagation(); beginRename(); };

    const del = document.createElement("span");
    del.className = "del";
    del.innerHTML = "&times;";
    del.title = "Delete toolpath";
    del.style.cursor = "pointer";
    del.style.fontSize = "13px";
    del.onclick = (e) => {
        e.stopPropagation();
        if (state.toolpaths.length <= 1) { toast("Need at least one toolpath.", true); return; }
        // Bulk delete: if the row is part of a multi-selection, drop
        // the whole selection in one go. Otherwise just this row.
        const isMulti = state.selectedToolpathIds.has(toolpath.id) && state.selectedToolpathIds.size > 1;
        const victims = isMulti ? state.selectedToolpathIds : new Set([toolpath.id]);
        if (state.toolpaths.length - victims.size < 1) {
            toast("Can't delete every toolpath — keep at least one.", true);
            return;
        }
        snapshot();
        state.toolpaths = state.toolpaths.filter(t => !victims.has(t.id));
        state.selectedToolpathIds = new Set();
        if (!state.toolpaths.find(t => t.id === state.activeToolpathId)) {
            state.activeToolpathId = state.toolpaths[state.toolpaths.length - 1].id;
        }
        render();
    };

    row.onclick = (e) => {
        // Clicking ANY toolpath row exits target-editing on whichever
        // toolpath was being edited — so the user can move to another
        // toolpath without having to press Esc first.
        if (state.targetEditingToolpathId && state.targetEditingToolpathId !== toolpath.id) {
            state.targetEditingToolpathId = null;
        }
        // Shift / ctrl click toggles multi-selection so bulk edits can
        // include several toolpaths at once; plain click replaces the
        // selection with just this one.
        if (e.shiftKey || e.ctrlKey || e.metaKey) {
            if (state.selectedToolpathIds.has(toolpath.id)) {
                state.selectedToolpathIds.delete(toolpath.id);
            } else {
                state.selectedToolpathIds.add(toolpath.id);
            }
        } else {
            state.selectedToolpathIds = new Set([toolpath.id]);
        }
        state.activeToolpathId = toolpath.id;
        render();
        import("./active-layer-panel.js").then(m => m.renderActiveLayerPanel());
    };

    // Double-click anywhere on the row (except the name span, which has
    // its own dblclick → rename) enters TARGET-EDITING mode for this
    // toolpath. The canvas flips to SVG view (so shapes are clickable),
    // the row's existing target becomes the canvas selection, and any
    // subsequent shape pick / marquee writes back to tp.targetShapeIds
    // live. Esc or clicking another toolpath exits.
    row.ondblclick = (e) => {
        e.stopPropagation();
        enterTargetEditing(toolpath);
    };

    // Visible drag handle on the left so the user has an obvious grip.
    // The whole row is draggable (set above) — the handle is decorative
    // + a hover-target with a clear cursor cue.
    const handle = el("span", "drag-handle", "⋮⋮");
    handle.title = "Drag to reorder";

    row.style.display = "grid";
    row.style.gridTemplateColumns = "12px 14px 12px 1fr 14px 14px";
    row.style.gap = "6px";
    row.append(handle, exp, sw, nameSpan, ren, del);
    return row;
}

function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
}

/** + Outline / + Fill behavior. Decision tree:
 *
 *    SVG shapes are currently selected
 *      → create ONE toolpath per distinct plot color among those
 *        shapes (so e.g. 3 red + 2 blue + 1 yellow selected → 3
 *        new outline toolpaths). The shape's _stroke (or _fill as
 *        fallback) drives the color for outline; _fill (or _stroke
 *        fallback) drives fill.
 *
 *    No shape selection
 *      → create an empty toolpath assigned to the currently selected
 *        pen folder (state.selectedPenId) and immediately enter
 *        target-editing so the user can click shapes to populate it. */
function createToolpathAndEdit(type) {
    const sel = state.selectedShapeIds;
    if (sel && sel.size > 0) {
        createToolpathsFromSelection(type);
        return;
    }
    snapshot();
    const n = state.toolpaths.length + 1;
    const tp = makeToolpath(`${type} ${n}`, type, null);
    tp.targetShapeIds = []; // start empty — user picks via canvas
    tp.targetArtLayerId = null;
    if (state.selectedPenId) tp.plotColorId = state.selectedPenId;
    insertToolpathInStack(tp);
    state.activeToolpathId = tp.id;
    enterTargetEditing(tp);
}

/** Place a newly created toolpath next to its siblings in state.toolpaths.
 *  Operation / render order follows array order, so a new outline for
 *  pen "red" should land right after the existing red outlines instead
 *  of at the very end of the whole list. Falls back to last position
 *  in the same pen, then to global append. */
function insertToolpathInStack(tp) {
    let lastSameBucket = -1;
    let lastSamePen = -1;
    for (let i = 0; i < state.toolpaths.length; i++) {
        const t = state.toolpaths[i];
        if (t.plotColorId === tp.plotColorId) {
            lastSamePen = i;
            if (t.type === tp.type) lastSameBucket = i;
        }
    }
    const at = lastSameBucket >= 0 ? lastSameBucket + 1
            : lastSamePen    >= 0 ? lastSamePen    + 1
            : state.toolpaths.length;
    state.toolpaths.splice(at, 0, tp);
}

/** Split state.selectedShapeIds by their natural color and create one
 *  toolpath per color. For outline type, the relevant color is the
 *  shape's _stroke (then _fill, then black). For fill type, it's
 *  _fill (then _stroke, then black). Plot colors are matched by hex;
 *  missing pens are created via findOrCreatePlotColor. */
function createToolpathsFromSelection(type) {
    const artPick = (s) => (type === "outline" ? (s._stroke || s._fill) : (s._fill || s._stroke)) || "#000000";

    // Resolve each selected id -> { id, color }. WORKFLOW-FIX: the geometry now lives in the #core sketch (art store
    // retired UNIFY-7), so resolve BOTH stores — art shapes by their _stroke/_fill, #core shapes by their DIGITAL
    // color (state.shapeColors). Without the #core branch, a selection of drawn/imported vectors produced NO toolpath.
    const ids = state.selectedShapeIds;
    const resolved = [];        // { id, color }
    const foundArt = new Set();
    for (const al of state.artLayers) {
        for (const s of al.shapes) if (ids.has(s.id)) { resolved.push({ id: s.id, color: artPick(s) }); foundArt.add(s.id); }
    }
    const cs = state.coreSketch;
    if (cs && cs.shapes) {
        const coreIds = new Set(cs.shapes.map(sh => sh.id));
        for (const id of ids) if (!foundArt.has(id) && coreIds.has(id)) resolved.push({ id, color: state.shapeColors.get(id) || "#000000" });
    }
    if (!resolved.length) return;

    // Bucket by lower-cased hex color -> one toolpath per color (a pen created/found per color).
    const byColor = new Map();
    for (const r of resolved) {
        const c = (r.color || "#000000").toLowerCase();
        if (!byColor.has(c)) byColor.set(c, []);
        byColor.get(c).push(r.id);
    }

    snapshot();
    let firstTp = null;
    for (const [color, shapeIds] of byColor) {
        const pc = findOrCreatePlotColor(color, color);
        const tp = makeToolpath(`${type} ${state.toolpaths.length + 1}`, type, null);
        tp.targetShapeIds = shapeIds.slice();
        tp.targetArtLayerId = null;
        tp.plotColorId = pc.id;
        // Land next to existing same-pen / same-type entries so render
        // and G-code order respect the panel grouping.
        insertToolpathInStack(tp);
        if (!firstTp) firstTp = tp;
    }
    if (firstTp) {
        state.activeToolpathId = firstTp.id;
        state.selectedToolpathIds = new Set([firstTp.id]);
    }
    toast(`Created ${byColor.size} ${type} toolpath${byColor.size === 1 ? "" : "s"}.`);
    render();
}

/** Move the toolpaths whose ids are in `draggedIds` to a position
 *  before-or-after `anchorId` in state.toolpaths, and reassign them to
 *  the anchor's pen so the new position respects the panel grouping.
 *  Preserves the relative order of the dragged set. */
function reorderToolpaths(draggedIds, anchorId, insertAfter) {
    const ids = new Set(draggedIds);
    // Skip no-op: dropping the only dragged item right onto itself.
    if (ids.size === 1 && ids.has(anchorId)) return;
    snapshot();

    const anchor = state.toolpaths.find(t => t.id === anchorId);
    if (!anchor) return;
    const targetPen = anchor.plotColorId;

    // Pull dragged out, preserving order.
    const dragged = [];
    const rest = [];
    for (const tp of state.toolpaths) {
        if (ids.has(tp.id)) {
            tp.plotColorId = targetPen;
            dragged.push(tp);
        } else {
            rest.push(tp);
        }
    }
    // Find anchor index in `rest`, splice dragged in.
    const ai = rest.findIndex(t => t.id === anchorId);
    if (ai < 0) {
        state.toolpaths = [...rest, ...dragged];
    } else {
        const at = insertAfter ? ai + 1 : ai;
        state.toolpaths = [...rest.slice(0, at), ...dragged, ...rest.slice(at)];
    }
    render();
}

/** Reorder state.plotColors so `draggedId` lands before-or-after
 *  `anchorId`, then re-bucket state.toolpaths to follow the new pen
 *  order — within a pen the relative toolpath order is preserved.
 *  This makes the panel's top-to-bottom reading the authoritative
 *  execution / render order. */
function reorderPens(draggedId, anchorId, insertAfter) {
    if (draggedId === anchorId) return;
    snapshot();
    const draggedPc = state.plotColors.find(p => p.id === draggedId);
    if (!draggedPc) return;
    const without = state.plotColors.filter(p => p.id !== draggedId);
    const ai = without.findIndex(p => p.id === anchorId);
    if (ai < 0) return;
    const at = insertAfter ? ai + 1 : ai;
    state.plotColors = [...without.slice(0, at), draggedPc, ...without.slice(at)];

    // Re-bucket state.toolpaths to match the new pen order. Within
    // each pen, preserve the existing relative order.
    const ordered = [];
    const byPen = new Map();
    for (const tp of state.toolpaths) {
        const k = tp.plotColorId || "__none__";
        if (!byPen.has(k)) byPen.set(k, []);
        byPen.get(k).push(tp);
    }
    for (const pc of state.plotColors) {
        if (byPen.has(pc.id)) ordered.push(...byPen.get(pc.id));
        byPen.delete(pc.id);
    }
    // Any leftovers (penless toolpaths, or pens that vanished) tail.
    for (const arr of byPen.values()) ordered.push(...arr);
    state.toolpaths = ordered;
    render();
}

/** Drop target for pen headers — accepts either "pen-move" (reorder
 *  plot colors) or "toolpath-move" (reassign plotColorId on a dragged
 *  toolpath). One handler so the same drop zone serves both gestures. */
function installPenDropTarget(row, penId) {
    row.ondragover = (e) => {
        if (!e.dataTransfer.types.includes("text/plain")) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        row.classList.add("drop-target");
    };
    row.ondragleave = () => row.classList.remove("drop-target");
    row.ondrop = (e) => {
        e.preventDefault();
        row.classList.remove("drop-target");
        let payload;
        try { payload = JSON.parse(e.dataTransfer.getData("text/plain") || "null"); }
        catch { return; }
        if (!payload) return;
        if (payload.kind === "pen-move") {
            // Insertion side: cursor Y relative to the row midpoint.
            const rect = row.getBoundingClientRect();
            const after = e.clientY > rect.top + rect.height / 2;
            reorderPens(payload.id, penId, after);
            return;
        }
        if (payload.kind === "toolpath-move" && Array.isArray(payload.ids)) {
            const ids = new Set(payload.ids);
            let changed = 0;
            snapshot();
            for (const tp of state.toolpaths) {
                if (ids.has(tp.id) && tp.plotColorId !== penId) {
                    tp.plotColorId = penId;
                    changed++;
                }
            }
            if (changed) {
                toast(`Moved ${changed} toolpath${changed === 1 ? "" : "s"} to new pen.`);
                render();
            }
        }
    };
}

/** Wire a panel row as a drop target that reassigns dragged toolpaths
 *  to `penId`. Reassignment ONLY changes plotColorId — type (outline /
 *  fill) is preserved, as are the shape's own _fill/_stroke values. */
function installDropTarget(row, penId) {
    row.ondragover = (e) => {
        // Only accept our own drag payload, ignore everything else.
        if (!e.dataTransfer.types.includes("text/plain")) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        row.classList.add("drop-target");
    };
    row.ondragleave = () => row.classList.remove("drop-target");
    row.ondrop = (e) => {
        e.preventDefault();
        row.classList.remove("drop-target");
        let payload;
        try { payload = JSON.parse(e.dataTransfer.getData("text/plain") || "null"); }
        catch { return; }
        if (!payload || payload.kind !== "toolpath-move" || !Array.isArray(payload.ids)) return;
        const ids = new Set(payload.ids);
        let changed = 0;
        snapshot();
        for (const tp of state.toolpaths) {
            if (ids.has(tp.id) && tp.plotColorId !== penId) {
                tp.plotColorId = penId;
                changed++;
            }
        }
        if (changed) {
            toast(`Moved ${changed} toolpath${changed === 1 ? "" : "s"} to new pen.`);
            render();
        }
    };
}

/** Enter target-editing mode for a toolpath. The user stays in their
 *  current view (typically Toolpath view); a body class disables the
 *  toolpath overlay's pointer capture so clicks land on the shapes
 *  underneath. The toolpath's existing target shapes are pre-selected
 *  so the user can add/remove from there. Esc / clicking another row
 *  exits via exitTargetEditing. */
export function enterTargetEditing(toolpath) {
    state.targetEditingToolpathId = toolpath.id;
    state.activeToolpathId = toolpath.id;
    state.selectedToolpathIds = new Set([toolpath.id]);
    state.selectedShapeIds = new Set(toolpath.targetShapeIds || []);
    document.body.classList.add("target-editing");
    toast(`Editing target for "${toolpath.name}" — click shapes, Esc to finish`);
    showTargetBanner(toolpath.name); // BURN-DOWN-4: persistent on-canvas banner (toast fades; this stays while editing)
    render();
    import("./active-layer-panel.js").then(m => m.renderActiveLayerPanel());
}

export function exitTargetEditing() {
    if (!state.targetEditingToolpathId) return;
    state.targetEditingToolpathId = null;
    document.body.classList.remove("target-editing");
    showTargetBanner(null); // BURN-DOWN-4: hide the banner
    render();
}

// BURN-DOWN-4: show/hide the persistent target-editing banner over the canvas. name=null hides it.
function showTargetBanner(name) {
    const el = $("#targetEditBanner");
    if (!el) return;
    if (name == null) { el.hidden = true; return; }
    el.textContent = `Editing target for "${name}" — click shapes, Esc to finish`;
    el.hidden = false;
}

/** Push the current canvas shape selection into the toolpath being
 *  target-edited. Called from interaction.js after any selection
 *  change while in target-editing mode. */
export function syncTargetEditingSelection() {
    const id = state.targetEditingToolpathId;
    if (!id) return;
    const tp = state.toolpaths.find(t => t.id === id);
    if (!tp) { state.targetEditingToolpathId = null; return; }
    tp.targetShapeIds = [...state.selectedShapeIds];
    // Clear the targetArtLayerId fallback so the resolved shapes
    // really come from our explicit picks, not the layer default.
    tp.targetArtLayerId = null;
}

export function installToolpathLayersPanel() {
    const recalc = $("#recalcBtn");
    if (recalc) recalc.onclick = () => recalcPreview(); // fetchPreview re-renders on done
    $("#addOutlineTp").onclick = () => createToolpathAndEdit("outline");
    $("#addFillTp").onclick    = () => createToolpathAndEdit("fill");
    $("#exportAll").onclick = () => {
        for (const tp of state.toolpaths) tp.export = true;
        render();
    };
    $("#exportNone").onclick = () => {
        for (const tp of state.toolpaths) tp.export = false;
        render();
    };
}
