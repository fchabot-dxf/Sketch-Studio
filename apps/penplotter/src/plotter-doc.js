// apps/penplotter/src/plotter-doc.js — the Pen Plotter's own document state, in ONE place (TASK 451).
// Two consumers share it so there is a single list of "what the plotter owns":
//   - history.js (undo/redo) takes the HISTORY subset: art layers, toolpaths, pens, active ids, doc size.
//   - the autosave buffer (sketch-stage.js, host sidecar doc.hosts.penplotter) takes that PLUS what undo must NOT
//     rewind: the machine settings, the per-shape style records and the static-shape ids. Those are edited without a
//     snapshot(), so an undo that restored them would silently revert edits made since the last snapshot.
// Plain data only (JSON-safe); Map/Set become arrays. #core stays pure — this file is plotter-side.

import { state, reseedUid, initLayers } from "./state.js";
import { sanitizeSettings, sanitizeDoc, sanitizePens, sanitizeToolpaths } from "./fields.js"; // TASK 453: declared ranges

const DOC_VERSION = 1;

/** The undo subset (what history.js snapshots). */
export function captureHistoryState() {
    return {
        artLayers: state.artLayers,
        activeArtLayerId: state.activeArtLayerId,
        toolpaths: state.toolpaths,
        plotColors: state.plotColors, // TASK 445: toolpaths/art layers reference pens by id, so they restore together
        activeToolpathId: state.activeToolpathId,
        doc: { ...state.doc },
    };
}

/** Apply an undo-subset object (already a fresh copy: JSON.parse'd). */
export function applyHistoryState(s) {
    state.artLayers = s.artLayers;
    state.activeArtLayerId = s.activeArtLayerId;
    state.toolpaths = s.toolpaths || [];
    state.plotColors = s.plotColors || [];
    state.activeToolpathId = s.activeToolpathId || null;
    state.doc = s.doc;
}

/** TASK 570: what an SVG / DXF import changes outside the sketch (paper size, pens, per-shape styles, static ids), for the sketch undo step
 *  of the import (state.hostSnapshot, declared `asked`: only the import's snapshot carries it, so undoing a drawing step never touches it).
 *  JSON-safe deep copy; the toolpaths, settings and art layers are not touched by an import and are not in it. */
export function captureImportState() {
    return JSON.parse(JSON.stringify({
        doc: state.doc,
        plotColors: state.plotColors,
        shapeStyles: Array.from(state.shapeStyles.entries()),
        staticShapeIds: Array.from(state.staticShapeIds),
    }));
}

/** Put back a captureImportState() result (a fresh copy, so the stored snapshot stays intact for the next undo / redo). */
export function applyImportState(d) {
    const c = JSON.parse(JSON.stringify(d));
    state.doc = c.doc;
    state.plotColors = c.plotColors;
    state.shapeStyles = new Map(c.shapeStyles);
    state.staticShapeIds = new Set(c.staticShapeIds);
}

/** The persisted document = the undo subset + the parts undo leaves alone. */
export function capturePlotterDoc() {
    return {
        version: DOC_VERSION,
        ...captureHistoryState(),
        settings: { ...state.settings },
        shapeStyles: Array.from(state.shapeStyles.entries()),
        staticShapeIds: Array.from(state.staticShapeIds),
    };
}

/** The plotter state of a design that carries NO plotter sidecar (a new / other-app design): the same defaults a fresh page has.
 *  Without it, opening such a design would keep the previous design's pens and toolpaths and autosave them into it. */
export function resetPlotterDoc() {
    state.doc = sanitizeDoc(undefined);
    state.plotColors = [];
    state.settings = sanitizeSettings(undefined);
    state.shapeStyles = new Map();
    state.staticShapeIds = new Set();
    initLayers(); // the starter toolpath, as on a fresh page
}

/** Restore a persisted plotter document. Missing parts keep their defaults (an old buffer carries none of this). */
export function applyPlotterDoc(d) {
    applyHistoryState(d);
    // TASK 453: an old saved document may hold anything (a 0 spacing, an empty feed, a 99999 mm paper): load it clamped.
    state.doc = sanitizeDoc(state.doc);
    state.plotColors = sanitizePens(state.plotColors);
    state.toolpaths = sanitizeToolpaths(state.toolpaths);
    state.settings = sanitizeSettings({ ...state.settings, ...(d.settings || {}) });
    state.shapeStyles = new Map(d.shapeStyles || []);
    state.staticShapeIds = new Set(d.staticShapeIds || []);
    // New ids come from a module counter that restarts at 1 on every page load: move it past every restored id.
    reseedUid([
        ...state.artLayers.flatMap(l => [l.id, ...(l.shapes || []).map(s => s.id)]),
        ...state.toolpaths.map(t => t.id),
        ...state.plotColors.map(p => p.id),
    ]);
}
