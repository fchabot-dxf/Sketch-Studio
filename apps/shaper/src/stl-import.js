// apps/shaper/src/stl-import.js — TASK 790: Shaper's OPEN STL, DECLARED in one importable place (like cut-import.js): the page (main.js) and the node
// test kit both call createStlImporter(). An STL is one more SOURCE of the Fusion add-in's `selection_data` payload: #core/stl-slice.js reads and slices
// it, and the design is REPLACED through the ONE import path a Fusion selection takes (fusion-import.js importFusionSelection: the sketch, the cut plan,
// the stock thickness = the part's height, in ONE undo step, the same notice "Added <file>: N regions ..." / "Replaced with ..."). The STL it came from is
// then the design's STL source (stl-source.js: saved with the document), shown by the STL card in Prepare (stl-card.js), whose Up / Units slice it again
// and replace the design the same way (one undo step each). Shaper only: the other apps' file picks never offer STL (their shared IMPORT_FILE_PICK is
// SVG / DXF); this file declares Shaper's own.
import { browserFileSeam } from '#ui/project-file.js';
import { parseStl, sliceStl, STL_DEFAULTS } from '#core/stl-slice.js';
import { importFusionSelection } from './fusion-import.js';
import { selectionNotice } from './fusion-bridge.js';
import { getStlSource, setStlSource, rememberMesh, meshOf } from './stl-source.js';
import { mountStlCard } from './stl-card.js';

/** The drawer entry's icon: a cube (18 x 18, the drawer's stroke style). */
export const STL_ICON = '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 2.5l5.5 3v7L9 15.5l-5.5-3v-7zM3.5 5.5L9 8.5l5.5-3M9 8.5v7"/></svg>';

/** Shaper's file pick for Open STL: an STL, read as bytes (binary or ASCII STL). */
export const STL_FILE_PICK = Object.freeze({ description: 'STL 3D part', mime: 'model/stl', exts: Object.freeze(['.stl']), binary: true });

/**
 * createStlImporter({ ensureSketch, getController, prepare, panelEl, showPrepare, afterImport, notice })
 *   -> { openFile(bytes, name), reslice({ up } | { unit }), pickAndOpen() }
 *   ensureSketch(): mounts the sketcher. getController(): the sketcher. prepare: the Prepare stage (prepare-stage.js; the import re-mounts it).
 *   panelEl: Prepare's right column (#prepare-panel): the STL card goes first in it. showPrepare(): the mode router's (the result is shown in Prepare,
 *   where its cuts and its card are). afterImport(): the page's refresh after any selection import (the Review card's thickness, the history buttons).
 *   notice(text, isError): Prepare's one-line notice.
 *   Every call returns the import's result ({ ok, message, warnings, regionCount, ..., info: the slice's size / time }) or { ok: false, message } (a file
 *   that is not a readable STL, nothing to cut): the design is then unchanged.
 */
export function createStlImporter({ ensureSketch, getController, prepare, panelEl, showPrepare = () => {}, afterImport = () => {}, notice = () => {} }) {
  const card = mountStlCard(panelEl, { onChange: (next) => { const res = reslice(next); if (res && !res.ok) notice(res.message, true); } });
  // slice the mesh and replace the design with it; on success the STL source is this mesh with these settings
  const land = (tris, key, { name, up, unit }) => {
    ensureSketch();
    const sliced = sliceStl(tris, { name, up, unit });
    if (!sliced.ok) return sliced;
    showPrepare();
    const res = importFusionSelection(sliced.payload, { controller: getController(), prepare, onImport: afterImport });
    if (!res.ok) return res;
    if (res.imported) setStlSource({ name, up, unit, triangles: sliced.info.triangles, sizeMm: sliced.info.sizeMm, key }); // the card follows (stl-card.js)
    const message = selectionNotice(res.message, res.warnings);
    notice(message, false);
    return { ...res, message, info: sliced.info };
  };
  /** An STL file's bytes (or an ASCII STL's text) -> a new design (the defaults: STL_DEFAULTS, +Z up, mm). */
  const openFile = (bytes, name) => {
    const parsed = parseStl(bytes);
    if (!parsed.ok) return parsed;
    return land(parsed.triangles, rememberMesh(parsed.triangles), { name: String(name || 'part.stl'), ...STL_DEFAULTS });
  };
  /** The design's STL sliced again with another Up side or Units (null when the design has no STL source). */
  const reslice = (next = {}) => {
    const s = getStlSource();
    if (!s) return null;
    return land(meshOf(s.key), s.key, { name: s.name, up: next.up || s.up, unit: next.unit || s.unit });
  };
  /** The file chooser (Shaper's STL pick); resolves null when it was cancelled. */
  const pickAndOpen = async () => {
    const picked = await browserFileSeam.open(STL_FILE_PICK);
    return picked ? openFile(picked.bytes, picked.name) : null;
  };
  return { openFile, reslice, pickAndOpen };
}
