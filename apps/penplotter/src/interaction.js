// Mouse handlers on the canvas. Dispatches by current tool.
// All shape geometry changes happen here; commits push onto the active layer.

import { state, uid, activeArtLayer, findShape, remapToolpathTargets } from "./state.js";
import { canvas, coordsEl, SVG_NS, toast } from "./dom.js";
import { screenToSvg, applyViewport, sharedView } from "./viewport.js"; // UNIFY-6: pan mutates the shared #ui view
import { translateShape, rotateShape, scaleShape, shapeCenter, deepCopyShape, combinedBounds, shapeBounds, getNodes, setNodes, makeShapeElement } from "./shapes.js";
import { gatherSnapCandidates, shapeVertices, findSnapDelta } from "./snapping.js";
import { resolveToolpathShapes } from "./preview.js"; // PP-4a: the real compute bridge (Toolpath stage)
import { syncTargetEditingSelection } from "./toolpath-layers-panel.js"; // PP-4b: real target-editing (un-stubbed)
import { closedPolygonFor, pointInPolygon } from "#core/plot/fills/utils.js";
import { crossingParams, trimSpanAt, removedSpanAt } from "./trim.js";
import { coreShapeToPolyline } from "#core/core-shape-to-polyline.js"; // WORKFLOW-FIX: hit-test #core geometry on the canvas

// Snap threshold is in SCREEN pixels — converted to mm per drag frame
// using the current viewport scale. That way a snap engages at a constant
// visual distance regardless of zoom level: looser when zoomed out, tight
// when zoomed in so you can place vertices precisely.
const SNAP_THRESHOLD_PX = 10;
import { renderArt as render } from "./render-art.js"; // PP-3b: Draw uses the trimmed renderArt, not render.js
import { showPreview, removePreview, cancelInteraction } from "./tools.js";
import { snapshot } from "./history.js";

function isSvgMode() {
    return state.preview.showSvg;
}

export function installCanvasHandlers() {
    canvas.addEventListener("mousedown", onDown);
    canvas.addEventListener("mousemove", onMove);
    canvas.addEventListener("mouseup", onUp);
    canvas.addEventListener("dblclick", onDblClick);
}

function onDown(e) {
    // Middle mouse or space-drag → pan
    if (e.button === 1 || (state.spaceDown && e.button === 0)) {
        state.interaction = {
            kind: "pan",
            startX: e.clientX, startY: e.clientY,
            originX: sharedView().x, originY: sharedView().y, // UNIFY-6: pan the SHARED #ui view rect
        };
        canvas.classList.add("panning");
        e.preventDefault();
        return;
    }
    if (e.button !== 0) return;

    const p = screenToSvg(e.clientX, e.clientY);

    // Toolpath / simulation mode: even when SVG view is off, the Select
    // tool still needs to work — it picks a toolpath from the overlay
    // via data-toolpath-id. Run startSelect, which has the showToolpath
    // branch built in.
    if (state.preview.showToolpath && state.tool === "select") {
        return startSelect(e, p);
    }

    // Shape tools (draw, rotate, scale, node, scissors) act on the artwork,
    // which is always rendered (faint in toolpath/sim view). They work in any
    // view now; while one is active the toolpath overlay stops capturing
    // clicks (body.shape-tools, see CSS) so clicks reach the shapes.

    if (state.tool === "select") return startSelect(e, p);
    if (state.tool === "rotate") return startRotate(e, p);
    if (state.tool === "scale")  return startScale(e, p);
    if (state.tool === "scissors") return doScissors(e, p);
    if (state.tool === "node") return doNodeEdit(e, p);

    const layer = activeArtLayer();
    if (!layer) return;

    if (state.tool === "polyline") return startOrExtendPolyline(p);
    if (state.tool === "freehand") return startFreehand(p);
    return startDraw(p);
}

function onMove(e) {
    const p = screenToSvg(e.clientX, e.clientY);
    coordsEl.textContent = `${p.x.toFixed(2)}, ${p.y.toFixed(2)} mm`;

    // Scissors: highlight the span that a click would snip, as you hover.
    if (state.tool === "scissors" && !state.interaction && isSvgMode()) {
        updateTrimHover(e, p);
        return;
    }
    // Node edit: highlight the node a click would delete.
    if (state.tool === "node" && !state.interaction && isSvgMode()) {
        updateNodeHover(e, p);
        return;
    }
    // Select: VCarve-style hover ghost of exactly what a click will select —
    // pink for a toolpath (toolpath/sim view), black for an SVG shape. It's an
    // overlay only; the faint artwork underneath is left as-is.
    if (state.tool === "select" && !state.interaction) {
        updateSelectHover(e, p);
        return;
    }

    const it = state.interaction;
    if (!it) return;

    if (it.kind === "pan") {
        // panX/panY are the viewBox top-left in user-space (mm) since
        // we switched to viewBox-based zoom. To follow the cursor we
        // subtract the cursor screen delta converted to user-space:
        // dragging right reveals more of the doc on the left, which
        // means the viewBox slides left.
        const dxMm = (e.clientX - it.startX) / state.viewport.scale; // scale is the synced px-per-world cache
        const dyMm = (e.clientY - it.startY) / state.viewport.scale;
        const v = sharedView();
        v.x = it.originX - dxMm;
        v.y = it.originY - dyMm;
        applyViewport();
        return;
    }
    if (it.kind === "drag") {
        // Absolute delta from drag start. Reset shapes to originals, then
        // apply the delta. This lets us compute snapping against the
        // current absolute position rather than accumulating drift.
        let dx = p.x - it.startX, dy = p.y - it.startY;
        for (let i = 0; i < it.shapes.length; i++) {
            Object.assign(it.shapes[i], deepCopyShape(it.originals[i]));
            translateShape(it.shapes[i], dx, dy);
        }
        // Snap: collect all moving vertices in their current positions,
        // see if any land near a candidate, nudge the whole translation.
        const movingVerts = it.shapes.flatMap(shapeVertices);
        const thresholdMm = SNAP_THRESHOLD_PX / Math.max(0.001, state.viewport.scale);
        const snap = findSnapDelta(movingVerts, it.snapCandidates, thresholdMm);
        if (snap) {
            for (const s of it.shapes) translateShape(s, snap.dx, snap.dy);
            it.snapPoint = snap.snapPoint;
        } else {
            it.snapPoint = null;
        }
        render();
        return;
    }
    if (it.kind === "nodedrag") {
        it.nodes.pts[it.index] = [p.x, p.y];
        setNodes(it.shape, it.nodes.pts, it.nodes.closed);
        render();
        return;
    }
    if (it.kind === "draw") {
        it.x = p.x; it.y = p.y;
        showPreview(buildDrawPreviewEl(it));
        return;
    }
    if (it.kind === "marquee") {
        it.x = p.x; it.y = p.y;
        updateMarquee(it);
        render();
        return;
    }
    if (it.kind === "rotate") {
        if (it.released) return;
        const delta = Math.atan2(p.y - it.center[1], p.x - it.center[0]) - it.startAngle;
        it.value = delta * 180 / Math.PI;
        applyRotate(it);
        return;
    }
    if (it.kind === "scale") {
        if (it.released) return;
        const d = Math.hypot(p.x - it.center[0], p.y - it.center[1]);
        it.value = Math.max(0.05, d / it.startDist);
        applyScale(it);
        return;
    }
    if (it.kind === "polyline") {
        it.points[it.points.length - 1] = [p.x, p.y];
        showPreview(buildPolylinePreviewEl(it));
        return;
    }
    if (it.kind === "freehand") {
        const last = it.points[it.points.length - 1];
        if (Math.hypot(p.x - last[0], p.y - last[1]) > 0.3) {
            it.points.push([p.x, p.y]);
            showPreview(buildFreehandPreviewEl(it));
        }
    }
}

function onUp() {
    const it = state.interaction;
    if (!it) return;
    if (it.kind === "pan")      { canvas.classList.remove("panning"); state.interaction = null; return; }
    if (it.kind === "drag")     { state.interaction = null; return; }
    if (it.kind === "nodedrag") { state.interaction = null; return; }
    if (it.kind === "draw")     { commitDraw(); return; }
    if (it.kind === "freehand") { commitFreehand(); return; }
    if (it.kind === "rotate" || it.kind === "scale") {
        // Don't clear yet — leave the HUD up so the user can fine-tune
        // the value by typing, then commit with OK or revert with Cancel.
        it.released = true;
        return;
    }
    if (it.kind === "marquee") {
        // No drag = plain click on empty space → clear selection (unless
        // shift was held, which would keep the prior selection).
        // In toolpath mode we also clear the shape selection so the
        // user can wipe a stale shape-pick made before switching modes
        // (otherwise + Outline / + Fill would silently use it).
        const moved = (it.x !== it.startX) || (it.y !== it.startY);
        if (!moved && !it.additive) {
            if (it.scope === "toolpath") {
                state.selectedToolpathIds = new Set();
                state.activeToolpathId = null;
                state.selectedShapeIds = new Set();
            } else {
                state.selectedShapeIds = new Set();
            }
        }
        // Marquee changes drove selectedShapeIds — push that into the
        // toolpath being target-edited, if any.
        if (it.scope !== "toolpath") syncTargetEditingSelection();
        state.interaction = null;
        render();
        if (it.scope === "toolpath") {
            import("./active-layer-panel.js").then(m => m.renderActiveLayerPanel());
        }
        return;
    }
    // polyline waits for Enter / dblclick
}

function onDblClick() {
    if (state.interaction && state.interaction.kind === "polyline") commitPolyline();
}

// -------- select --------
function startSelect(e, p) {
    removePreview(); // drop the hover ghost as the click resolves
    // In toolpath mode, clicking a polyline activates its toolpath
    // instead of selecting an underlying shape. Shift-click toggles
    // multi-selection; empty-area drag starts a box-select that picks
    // every toolpath whose target geometry falls in the box.
    if (state.preview.showToolpath) {
        // Near a toolpath stroke (within tolerance) → pick that toolpath.
        const tol = TP_PICK_PX / Math.max(0.001, state.viewport.scale);
        const tpid = nearestToolpathWithin(p, tol);
        if (tpid) {
            if (e.shiftKey) {
                if (state.selectedToolpathIds.has(tpid)) state.selectedToolpathIds.delete(tpid);
                else state.selectedToolpathIds.add(tpid);
            } else {
                state.selectedToolpathIds = new Set([tpid]);
            }
            state.activeToolpathId = tpid;
            render();
            import("./active-layer-panel.js").then(m => m.renderActiveLayerPanel());
            return;
        }
        // In the gap between strokes → select the geometry underneath. WORKFLOW-FIX: the geometry now lives in the
        // #core sketch (art store retired), so resolve a #core shape by direct stroke-click (data-shape-id) or by
        // interior/near-stroke geometry (coreShapeAtPoint), and select it -> state.selectedShapeIds (UNIFY-2 targeting).
        const gapShape = shapeAtPoint(p);                       // legacy art shape (empty post-UNIFY-7), kept for safety
        if (gapShape) { beginShapeDrag(p, gapShape.id, e.shiftKey); return; }
        const cid = (e.target.dataset && e.target.dataset.shapeId) || coreShapeAtPoint(p, tol);
        if (cid) { selectCoreShape(cid, e.shiftKey); return; }
        // Empty → rubber-band marquee that picks toolpaths + #core shapes in the box.
        state.interaction = {
            kind: "marquee",
            scope: "toolpath",
            startX: p.x, startY: p.y, x: p.x, y: p.y,
            additive: e.shiftKey,
            initialSelection: new Set(state.selectedToolpathIds),
            initialShapeSelection: new Set(state.selectedShapeIds),
        };
        render();
        return;
    }
    const sid = e.target.dataset && e.target.dataset.shapeId;
    if (sid) {
        // In target-editing mode, clicking a shape toggles its
        // membership in the target rather than starting a drag. Shift
        // toggles individually; plain click toggles too (since the
        // typical action is to build the target up by clicking around).
        if (state.targetEditingToolpathId) {
            if (state.selectedShapeIds.has(sid) && (e.shiftKey || e.ctrlKey || e.metaKey)) {
                state.selectedShapeIds.delete(sid);
            } else {
                if (!e.shiftKey && !e.ctrlKey && !e.metaKey) {
                    if (state.selectedShapeIds.has(sid)) {
                        state.selectedShapeIds.delete(sid);
                    } else {
                        state.selectedShapeIds.add(sid);
                    }
                } else {
                    state.selectedShapeIds.add(sid);
                }
            }
            syncTargetEditingSelection();
            render();
            return;
        }
        beginShapeDrag(p, sid, e.shiftKey);
    } else {
        // Empty-area click → start a rubber-band marquee. Shift keeps
        // existing selection; without shift we'll clear it on mouseup.
        state.interaction = {
            kind: "marquee",
            startX: p.x, startY: p.y, x: p.x, y: p.y,
            additive: e.shiftKey,
            initialSelection: new Set(state.selectedShapeIds),
        };
    }
    render();
}

function updateMarquee(it) {
    const minX = Math.min(it.startX, it.x), maxX = Math.max(it.startX, it.x);
    const minY = Math.min(it.startY, it.y), maxY = Math.max(it.startY, it.y);
    // Standard CAD convention:
    //   left → right  = window  : only shapes fully inside the box
    //   right → left  = crossing: any shape that touches the box
    const isWindow = it.x >= it.startX;
    it.mode = isWindow ? "window" : "crossing";

    // Toolpath-scope marquee — pick toolpaths whose target geometry
    // falls in (window) / touches (crossing) the box. Bounds come from
    // the toolpath's resolved target shapes so the selection matches
    // what the user actually sees in the preview.
    if (it.scope === "toolpath") {
        const next = new Set(it.additive ? it.initialSelection : []);
        for (const tp of state.toolpaths) {
            if (!tp.visible) continue;
            const shapes = resolveToolpathShapes(tp);
            if (!shapes.length) continue;
            const b = combinedBounds(shapes);
            const fullyInside = b.minX >= minX && b.maxX <= maxX
                             && b.minY >= minY && b.maxY <= maxY;
            const touches = !(b.maxX < minX || b.minX > maxX
                           || b.maxY < minY || b.minY > maxY);
            const hit = isWindow ? fullyInside : touches;
            if (hit) next.add(tp.id);
        }
        state.selectedToolpathIds = next;
        // Keep activeToolpathId synced — primary stays valid if still
        // selected; otherwise fall back to the first in the new set.
        if (next.size && !next.has(state.activeToolpathId)) {
            state.activeToolpathId = [...next][0];
        } else if (!next.size) {
            state.activeToolpathId = null;
        }
        // WORKFLOW-FIX: also select #core SHAPES whose geometry falls in (window) / touches (crossing) the box, so a
        // marquee in Fill/Toolpath grabs the vectors for targeting (state.selectedShapeIds -> UNIFY-2).
        const cs = state.coreSketch;
        const shapeNext = new Set(it.additive ? (it.initialShapeSelection || []) : []);
        if (cs && cs.shapes) for (const sh of cs.shapes) {
            const pts = coreShapeToPolyline(sh, cs.joints);
            if (!pts || !pts.length) continue;
            let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity;
            for (const q of pts) { if (q[0] < mnx) mnx = q[0]; if (q[0] > mxx) mxx = q[0]; if (q[1] < mny) mny = q[1]; if (q[1] > mxy) mxy = q[1]; }
            const fullyInside = mnx >= minX && mxx <= maxX && mny >= minY && mxy <= maxY;
            const touches = !(mxx < minX || mnx > maxX || mxy < minY || mny > maxY);
            if (isWindow ? fullyInside : touches) shapeNext.add(sh.id);
        }
        state.selectedShapeIds = shapeNext;
        return;
    }

    const next = new Set(it.additive ? it.initialSelection : []);
    for (const layer of state.layers) {
        if (!layer.visible) continue;
        for (const s of layer.shapes) {
            const b = shapeBounds(s);
            const fullyInside = b.minX >= minX && b.maxX <= maxX
                             && b.minY >= minY && b.maxY <= maxY;
            const touches = !(b.maxX < minX || b.minX > maxX
                           || b.maxY < minY || b.minY > maxY);
            const hit = isWindow ? fullyInside : touches;
            if (hit) next.add(s.id);
        }
    }
    state.selectedShapeIds = next;
}

// MERGE-1: the transform HUD (rotate/scale degree popup) is DELETED — the #transformHud DOM/CSS are gone, art
// rotate/scale is retired, and a #core-joint rotate/scale is a later restore (it won't reuse this popup).

function applyRotate(it) {
    const radians = it.value * Math.PI / 180;
    for (let i = 0; i < it.shapes.length; i++) {
        Object.assign(it.shapes[i], deepCopyShape(it.originals[i]));
        rotateShape(it.shapes[i], radians, it.center[0], it.center[1]);
    }
    render();
}

function applyScale(it) {
    const factor = Math.max(0.001, it.value);
    for (let i = 0; i < it.shapes.length; i++) {
        Object.assign(it.shapes[i], deepCopyShape(it.originals[i]));
        scaleShape(it.shapes[i], factor, it.center[0], it.center[1]);
    }
    render();
}

// -------- rotate / scale (operate on the entire selection) --------
function startRotate(e, p) {
    const targets = prepareTransformTargets(e);
    if (!targets) return;
    snapshot();
    const { shapes, center } = targets;
    state.interaction = {
        kind: "rotate",
        shapes,
        center,
        startAngle: Math.atan2(p.y - center[1], p.x - center[0]),
        originals: shapes.map(deepCopyShape),
        value: 0,
        released: false,
    };
    render();
}

function startScale(e, p) {
    const targets = prepareTransformTargets(e);
    if (!targets) return;
    snapshot();
    const { shapes, center } = targets;
    state.interaction = {
        kind: "scale",
        shapes,
        center,
        startDist: Math.max(0.5, Math.hypot(p.x - center[0], p.y - center[1])),
        originals: shapes.map(deepCopyShape),
        value: 1,
        released: false,
    };
    render();
}

/** Resolve which shapes to transform and the pivot point. If the user
 *  clicked a selected shape, the whole selection moves together around
 *  the group centroid. If they clicked an unselected shape, that one
 *  becomes the new (single) selection. */
function prepareTransformTargets(e) {
    // Rotate/scale always operate on the current selection. Drag anywhere
    // on the canvas — the click target doesn't matter. If nothing's
    // selected, the tool does nothing (use the Select tool first).
    if (state.selectedShapeIds.size === 0) return null;
    const shapes = [...state.selectedShapeIds].map(findShape).filter(Boolean);
    if (!shapes.length) return null;
    const b = combinedBounds(shapes);
    return { shapes, center: [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2] };
}

// -------- draw (line/rect/ellipse) --------
function startDraw(p) {
    state.interaction = { kind: "draw", startX: p.x, startY: p.y, x: p.x, y: p.y };
}

function commitDraw() {
    const it = state.interaction;
    const layer = activeArtLayer();
    if (!layer) { state.interaction = null; return; }
    const moved = Math.hypot(it.x - it.startX, it.y - it.startY) > 0.5;
    if (!moved) { cancelInteraction(); return; }

    snapshot(); // about to add a shape
    let shape = null;
    if (state.tool === "line") {
        shape = { id: uid("s"), type: "line", x1: it.startX, y1: it.startY, x2: it.x, y2: it.y };
    } else if (state.tool === "rect") {
        shape = { id: uid("s"), type: "rect",
            x: Math.min(it.startX, it.x), y: Math.min(it.startY, it.y),
            w: Math.abs(it.x - it.startX), h: Math.abs(it.y - it.startY) };
    } else if (state.tool === "ellipse") {
        shape = { id: uid("s"), type: "ellipse",
            cx: (it.startX + it.x) / 2, cy: (it.startY + it.y) / 2,
            rx: Math.abs(it.x - it.startX) / 2, ry: Math.abs(it.y - it.startY) / 2 };
    }
    if (shape) layer.shapes.push(shape);
    state.interaction = null;
    removePreview();
    render();
}

function buildDrawPreviewEl(it) {
    let el;
    if (state.tool === "line") {
        el = document.createElementNS(SVG_NS, "line");
        el.setAttribute("x1", it.startX); el.setAttribute("y1", it.startY);
        el.setAttribute("x2", it.x); el.setAttribute("y2", it.y);
    } else if (state.tool === "rect") {
        el = document.createElementNS(SVG_NS, "rect");
        el.setAttribute("x", Math.min(it.startX, it.x));
        el.setAttribute("y", Math.min(it.startY, it.y));
        el.setAttribute("width", Math.abs(it.x - it.startX));
        el.setAttribute("height", Math.abs(it.y - it.startY));
    } else if (state.tool === "ellipse") {
        el = document.createElementNS(SVG_NS, "ellipse");
        el.setAttribute("cx", (it.startX + it.x) / 2);
        el.setAttribute("cy", (it.startY + it.y) / 2);
        el.setAttribute("rx", Math.abs(it.x - it.startX) / 2);
        el.setAttribute("ry", Math.abs(it.y - it.startY) / 2);
    }
    return el;
}

// -------- polyline --------
function startOrExtendPolyline(p) {
    if (!state.interaction || state.interaction.kind !== "polyline") {
        state.interaction = { kind: "polyline", points: [[p.x, p.y], [p.x, p.y]] };
    } else {
        state.interaction.points[state.interaction.points.length - 1] = [p.x, p.y];
        state.interaction.points.push([p.x, p.y]);
    }
    showPreview(buildPolylinePreviewEl(state.interaction));
}

export function commitPolyline() {
    const it = state.interaction;
    if (!it || it.points.length < 3) { cancelInteraction(); return; }
    const layer = activeArtLayer();
    if (!layer) { cancelInteraction(); return; }
    snapshot();
    const pts = it.points.slice(0, -1); // drop live preview vertex
    layer.shapes.push({ id: uid("s"), type: "polyline", points: pts });
    state.interaction = null;
    removePreview();
    render();
}

function buildPolylinePreviewEl(it) {
    const el = document.createElementNS(SVG_NS, "polyline");
    el.setAttribute("points", it.points.map(p => `${p[0]},${p[1]}`).join(" "));
    return el;
}

// -------- freehand --------
function startFreehand(p) {
    state.interaction = { kind: "freehand", points: [[p.x, p.y]] };
}

function commitFreehand() {
    const it = state.interaction;
    if (!it || it.points.length < 2) { cancelInteraction(); return; }
    const layer = activeArtLayer();
    if (!layer) { cancelInteraction(); return; }
    snapshot();
    const d = "M " + it.points.map(p => `${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join(" L ");
    layer.shapes.push({ id: uid("s"), type: "path", d });
    state.interaction = null;
    removePreview();
    render();
}

function buildFreehandPreviewEl(it) {
    const el = document.createElementNS(SVG_NS, "path");
    el.setAttribute("d", "M " + it.points.map(p => `${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join(" L "));
    return el;
}

// ----- scissors / trim -----

/** Convert a shape to { pts:[[x,y],…], closed } for trimming. */
function shapeToPolyline(shape) {
    if (shape.type === "line") {
        return { pts: [[shape.x1, shape.y1], [shape.x2, shape.y2]], closed: false };
    }
    if (shape.type === "polyline") {
        const pts = shape.points.map(p => [p[0], p[1]]);
        let closed = false;
        if (pts.length > 2) {
            const a = pts[0], b = pts[pts.length - 1];
            if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6) { closed = true; pts.pop(); }
        }
        return { pts, closed };
    }
    const poly = closedPolygonFor(shape); // rect / ellipse / path → closed ring
    if (!poly) return null;
    const pts = poly.map(p => [p[0], p[1]]);
    if (pts.length > 1) {
        const a = pts[0], b = pts[pts.length - 1];
        if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6) pts.pop();
    }
    return { pts, closed: true };
}

/** Resolve the hovered/clicked shape + its cutters (every other visible
 *  vector) for the scissors tool. Returns null when not over a shape. */
function trimContext(e) {
    const sid = e.target.dataset && e.target.dataset.shapeId;
    if (!sid) return null;
    let target = null, layer = null;
    for (const l of state.artLayers) {
        const s = l.shapes.find(s => s.id === sid);
        if (s) { target = s; layer = l; break; }
    }
    if (!target) return null;
    const tpl = shapeToPolyline(target);
    if (!tpl || tpl.pts.length < 2) return null;
    const cutters = [];
    for (const l of state.artLayers) {
        if (!l.visible) continue;
        for (const s of l.shapes) {
            if (s.id === sid) continue;
            const pl = shapeToPolyline(s);
            if (pl && pl.pts.length >= 2) cutters.push(pl);
        }
    }
    return { target, layer, tpl, cutters };
}

/** Hover feedback: draw the span the click would snip, in red. */
function updateTrimHover(e, p) {
    const ctx = trimContext(e);
    if (!ctx) { removePreview(); return; }
    const cuts = crossingParams(ctx.tpl.pts, ctx.tpl.closed, ctx.cutters);
    const span = removedSpanAt(ctx.tpl.pts, ctx.tpl.closed, cuts, [p.x, p.y]);
    if (!span || span.length < 2) { removePreview(); return; }
    const el = document.createElementNS(SVG_NS, "polyline");
    el.setAttribute("points", span.map(pt => `${pt[0]},${pt[1]}`).join(" "));
    el.classList.add("trim-cut");
    showPreview(el);
}

/** Scissors: snip the clicked vector, removing the span between its two
 *  nearest crossings with other visible vectors. The remainder stays as
 *  open polyline(s); a closed shape re-closes across the cut. */
function doScissors(e, p) {
    const ctx = trimContext(e);
    if (!ctx) return;
    const { target, layer, tpl, cutters } = ctx;

    const cuts = crossingParams(tpl.pts, tpl.closed, cutters);
    const pieces = trimSpanAt(tpl.pts, tpl.closed, cuts, [p.x, p.y]);
    if (!pieces || !pieces.length) {
        toast("Nothing to trim here — the vector must cross another at this spot.", true);
        return;
    }

    removePreview();
    snapshot();
    const idx = layer.shapes.indexOf(target);
    const made = pieces.map(piece => {
        const points = piece.map(p => [p[0], p[1]]);
        // Trimming a closed shape closes the remainder back up (a straight
        // chord across the cut) so it stays a filled region.
        if (tpl.closed && points.length >= 2) points.push([points[0][0], points[0][1]]);
        const sh = { id: uid("shape"), type: "polyline", points };
        if (tpl.closed && target._fill !== undefined) sh._fill = target._fill;
        if (target._stroke !== undefined) sh._stroke = target._stroke;
        if (target._strokeWidth !== undefined) sh._strokeWidth = target._strokeWidth;
        return sh;
    });
    layer.shapes.splice(idx, 1, ...made);
    remapToolpathTargets(target.id, made.map(s => s.id)); // keep toolpaths attached
    state.selectedShapeIds = new Set(made.map(s => s.id));
    render();
}

// ----- node edit -----

const NODE_PICK_PX = 12;

function nearestNode(pts, pt) {
    let bi = -1, bd = Infinity;
    for (let i = 0; i < pts.length; i++) {
        const d = Math.hypot(pts[i][0] - pt[0], pts[i][1] - pt[1]);
        if (d < bd) { bd = d; bi = i; }
    }
    return { i: bi, d: bd };
}

/** The single shape currently selected for node editing (must be node-
 *  editable), with its node list — or null. */
function selectedNodeShape() {
    if (state.selectedShapeIds.size !== 1) return null;
    const sid = [...state.selectedShapeIds][0];
    for (const l of state.artLayers) {
        const s = l.shapes.find(x => x.id === sid);
        if (s) { const nodes = getNodes(s); return nodes ? { shape: s, layer: l, nodes } : null; }
    }
    return null;
}

/** Hover feedback: ring the node a click would delete (on the selected
 *  shape, whose nodes are all shown as handles). */
function updateNodeHover(e, p) {
    const sel = selectedNodeShape();
    if (!sel) { removePreview(); return; }
    const thr = NODE_PICK_PX / Math.max(0.001, state.viewport.scale);
    const nn = nearestNode(sel.nodes.pts, [p.x, p.y]);
    if (nn.i < 0 || nn.d > thr) { removePreview(); return; }
    const c = sel.nodes.pts[nn.i];
    const el = document.createElementNS(SVG_NS, "circle");
    el.setAttribute("cx", c[0]); el.setAttribute("cy", c[1]);
    el.setAttribute("r", Math.max(0.4, thr * 0.45));
    el.classList.add("node-hi");
    showPreview(el);
}

/** Node tool mousedown: if a node of the selected shape is under the cursor,
 *  select it (Delete removes it) and start dragging it. Otherwise select the
 *  shape under the cursor so all its nodes show as handles. */
function doNodeEdit(e, p) {
    const sel = selectedNodeShape();
    if (sel) {
        const thr = NODE_PICK_PX / Math.max(0.001, state.viewport.scale);
        const nn = nearestNode(sel.nodes.pts, [p.x, p.y]);
        if (nn.i >= 0 && nn.d <= thr) {
            state.activeNode = { shapeId: sel.shape.id, index: nn.i };
            snapshot(); // about to move the node
            state.interaction = { kind: "nodedrag", shape: sel.shape, nodes: sel.nodes, index: nn.i };
            removePreview();
            render();
            return;
        }
    }
    // Not on a node → (re)select the shape under the cursor to edit it.
    const sid = e.target.dataset && e.target.dataset.shapeId;
    state.selectedShapeIds = sid ? new Set([sid]) : new Set();
    state.activeNode = null;
    removePreview();
    render();
}

/** Delete the node currently selected by the node tool (Delete key). Bridges
 *  its neighbours; a closed shape stays closed. */
export function deleteActiveNode() {
    const a = state.activeNode;
    if (!a) return false;
    const shape = findShape(a.shapeId);
    if (!shape) { state.activeNode = null; return false; }
    const nodes = getNodes(shape);
    if (!nodes) return false;
    const minNodes = nodes.closed ? 3 : 2;
    if (a.index < 0 || a.index >= nodes.pts.length || nodes.pts.length <= minNodes) {
        toast("Can't delete — too few nodes left.", true);
        return false;
    }
    snapshot();
    nodes.pts.splice(a.index, 1);
    setNodes(shape, nodes.pts, nodes.closed);
    state.activeNode = null;
    render();
    return true;
}

// ----- select: geometric hit-testing + hover ghost -----

const GHOST_TOOLPATH = "#ff2e88"; // pink
const GHOST_SHAPE = "#111111";    // black
const GHOST_OPACITY = "0.65";
const TP_PICK_PX = 7;             // hover/click tolerance to a toolpath stroke

function pointSegDist(px, py, a, b) {
    const vx = b[0] - a[0], vy = b[1] - a[1];
    const wx = px - a[0], wy = py - a[1];
    const len2 = vx * vx + vy * vy || 1e-9;
    let t = (wx * vx + wy * vy) / len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return Math.hypot(px - (a[0] + t * vx), py - (a[1] + t * vy));
}

/** Id of the nearest visible toolpath whose plotted stroke is within `tol`
 *  of point p, or null. Lets you grab a thin stroke without pixel-aiming. */
function nearestToolpathWithin(p, tol) {
    let best = null, bestD = tol;
    for (const layer of (state.preview.cache.polylineLayers || [])) {
        const tp = state.toolpaths.find(t => t.id === layer.id);
        if (tp && !tp.visible) continue;
        for (const stroke of layer.strokes) {
            for (let i = 0; i + 1 < stroke.length; i++) {
                const d = pointSegDist(p.x, p.y, stroke[i], stroke[i + 1]);
                if (d < bestD) { bestD = d; best = layer.id; }
            }
        }
    }
    return best;
}

/** WORKFLOW-FIX: the topmost #core sketch shape hit by point p — interior (closed shapes) or within `tol` mm of any
 *  segment (open shapes / edges). Returns the #core shape id, or null. Mirrors how RENDER-FIX draws the geometry
 *  (coreShapeToPolyline), so what you click is what you see. */
function coreShapeAtPoint(p, tol) {
    const cs = state.coreSketch;
    if (!cs || !cs.shapes) return null;
    for (let i = cs.shapes.length - 1; i >= 0; i--) {
        const sh = cs.shapes[i];
        const pts = coreShapeToPolyline(sh, cs.joints);
        if (!pts || pts.length < 2) continue;
        const a = pts[0], b = pts[pts.length - 1];
        const closed = Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6;
        if (closed && pointInPolygon([p.x, p.y], pts)) return sh.id;
        for (let k = 0; k + 1 < pts.length; k++) if (pointSegDist(p.x, p.y, pts[k], pts[k + 1]) <= tol) return sh.id;
    }
    return null;
}

/** WORKFLOW-FIX: select a #core shape into state.selectedShapeIds (highlight + targeting) — NOT a drag (the plotter
 *  canvas is for targeting; editing is the Design tab). Honors target-editing mode + shift-toggle. */
function selectCoreShape(sid, additive) {
    if (state.targetEditingToolpathId) {
        if (state.selectedShapeIds.has(sid)) state.selectedShapeIds.delete(sid); else state.selectedShapeIds.add(sid);
        syncTargetEditingSelection();
    } else if (additive) {
        if (state.selectedShapeIds.has(sid)) state.selectedShapeIds.delete(sid); else state.selectedShapeIds.add(sid);
    } else {
        state.selectedShapeIds = new Set([sid]);
    }
    render();
}

/** PARITY-AUDIT: a black hover-ghost (thick outline halo) of a #core shape, flattened the way it's drawn. */
function coreGhost(sid) {
    const cs = state.coreSketch;
    const sh = cs && cs.shapes && cs.shapes.find(s => s.id === sid);
    if (!sh) return null;
    const pts = coreShapeToPolyline(sh, cs.joints);
    if (!pts || pts.length < 2) return null;
    const el = document.createElementNS(SVG_NS, "polyline");
    el.setAttribute("points", pts.map(p => `${p[0]},${p[1]}`).join(" "));
    el.style.fill = "none";
    el.style.stroke = GHOST_SHAPE;
    el.style.strokeWidth = "4";
    el.style.strokeLinejoin = "round";
    el.style.opacity = GHOST_OPACITY;
    el.style.pointerEvents = "none";
    el.setAttribute("vector-effect", "non-scaling-stroke");
    return el;
}

/** Topmost art shape whose interior contains point p, or null. */
function shapeAtPoint(p) {
    for (const l of state.artLayers) {
        if (!l.visible) continue;
        for (let i = l.shapes.length - 1; i >= 0; i--) {
            const poly = closedPolygonFor(l.shapes[i]);
            if (poly && pointInPolygon([p.x, p.y], poly)) return l.shapes[i];
        }
    }
    return null;
}

/** Select shape `sid` and start dragging it (shared by SVG-view select and
 *  toolpath-view gap-select). */
function beginShapeDrag(p, sid, additive) {
    if (!additive) state.selectedShapeIds.clear();
    state.selectedShapeIds.add(sid);
    snapshot();
    const shapeIds = new Set(state.selectedShapeIds);
    const movingShapes = [...shapeIds].map(findShape).filter(Boolean);
    state.interaction = {
        kind: "drag",
        startX: p.x, startY: p.y,
        shapeIds,
        shapes: movingShapes,
        originals: movingShapes.map(deepCopyShape),
        snapCandidates: gatherSnapCandidates(shapeIds),
        snapPoint: null,
    };
    render();
}

/** S2 (7b): record the #core shape under the cursor + refresh ONLY the ops panel (so its owning row gets the
 *  .geo-hovered cue) — gated on change, and panel-only so the canvas hover ghost isn't wiped. */
function setHoveredShapeId(id) {
    if (state.hoveredShapeId === (id || null)) return;
    state.hoveredShapeId = id || null;
    import("./toolpath-layers-panel.js").then(m => m.renderToolpathLayersPanel()).catch(() => {});
}

/** Shape hover/selection ghost: the shape's OUTLINE, stroked thick. The
 *  stroke straddles the edge so it both touches the shape and outsets a
 *  little — a halo, not a filled blob. */
function ghostElement(shape, color) {
    const el = makeShapeElement(shape);
    // Inline styles win over the .preview class showPreview adds.
    el.style.fill = "none";
    el.style.stroke = color;
    el.style.strokeWidth = "4";   // thicker than the selected outline (2)
    el.style.strokeLinejoin = "round";
    el.style.strokeDasharray = "none";
    el.style.opacity = GHOST_OPACITY;
    el.style.pointerEvents = "none";
    el.setAttribute("vector-effect", "non-scaling-stroke");
    return el;
}

/** Hover preview for the Select tool: a translucent ghost of what a click
 *  would select — pink toolpath in toolpath/sim view, black shape in SVG
 *  view. Pure overlay; doesn't touch the base artwork opacity. */
function updateSelectHover(e, p) {
    if (state.preview.showToolpath) {
        // Near a stroke (within tolerance) → pink ghost of that toolpath's
        // EXACT plotted vector. In the gap between strokes → black ghost of
        // the shape underneath (so you can grab shapes without a modifier).
        const tol = TP_PICK_PX / Math.max(0.001, state.viewport.scale);
        const tpid = nearestToolpathWithin(p, tol);
        if (tpid) {
            const layer = (state.preview.cache.polylineLayers || []).find(l => l.id === tpid);
            const g = document.createElementNS(SVG_NS, "g");
            g.style.opacity = GHOST_OPACITY;
            g.style.pointerEvents = "none";
            for (const stroke of layer.strokes) {
                if (stroke.length < 2) continue;
                const pl = document.createElementNS(SVG_NS, "polyline");
                pl.setAttribute("points", stroke.map(q => `${q[0]},${q[1]}`).join(" "));
                pl.style.fill = "none";
                pl.style.stroke = GHOST_TOOLPATH;
                pl.style.strokeWidth = "4.5"; // heaviest: idle 0.8 < selected 2.8 < hover 4.5
                pl.style.strokeDasharray = "3 2";
                pl.style.strokeLinecap = "round";
                pl.style.strokeLinejoin = "round";
                pl.setAttribute("vector-effect", "non-scaling-stroke");
                g.appendChild(pl);
            }
            setHoveredShapeId(null); // hovering a toolpath stroke, not a bare vector
            showPreview(g);
            return;
        }
        const gapShape = shapeAtPoint(p);
        if (gapShape) {
            setHoveredShapeId(null);
            const el = ghostElement(gapShape, GHOST_SHAPE);
            el.style.opacity = GHOST_OPACITY;
            showPreview(el);
            return;
        }
        // PARITY-AUDIT restore: hover-ghost a #core VECTOR (the geometry lives in #core now, not the art store) — the
        // black outline halo a click would select, matching the original Draw hover feedback.
        const cid = coreShapeAtPoint(p, tol);
        const cg = cid ? coreGhost(cid) : null;
        if (cg) { setHoveredShapeId(cid); showPreview(cg); return; } // S2 (7b): mark the owning op row
        setHoveredShapeId(null);
        removePreview();
        return;
    }
    const sid = e.target.dataset && e.target.dataset.shapeId;
    const shape = sid && findShape(sid);
    if (!shape) { removePreview(); return; }
    const el = ghostElement(shape, GHOST_SHAPE);
    el.style.opacity = GHOST_OPACITY;
    showPreview(el);
}
