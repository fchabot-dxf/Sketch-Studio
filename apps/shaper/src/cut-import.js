// apps/shaper/src/cut-import.js — Shaper's SVG / DXF IMPORT into a new sketch, DECLARED in one importable place (TASK 583). The page script (main.js
// importFileToSketch) and the node test kit's tests both call importShaperFile(): the ONE shared importer (#ui/sketch-import.js) with what is Shaper's own
// declared as options: each element's cut record (describeElement), kept descIds, and connecting those records to the in-memory CUT_PLAN after the shapes are
// in (afterImport; a compound <path> becomes ONE pocket-with-hole profile: see assignImportedCuts). Moved out of main.js unchanged; the page keeps its status
// line and panel refresh.
import { importIntoSketch, mountImportDrop } from '#ui/sketch-import.js'; // TASK 566: the ONE SVG / DXF importer (+ the drop)
import { docUnit } from '#core/settings-manager.js';
import { extractCutRecord } from './shaper.js';
import { CUT_PLAN, assignImportedCuts } from './cut-plan.js';

/**
 * TASK 706: an element's cut attributes as Shaper reads them: per attribute, the element's OWN value, else the nearest ancestor <g>'s (not the root <svg>).
 * Shaper's own export USED TO group the elements that share a cut under one <g> carrying the fill / stroke / shaper:* (removed in TASK 802: the
 * Origin reads the cut from each element); files exported before that still import, so a parent <g>'s attribute is inherited. The reader has the two methods extractCutRecord reads (getAttribute, getAttributeNS).
 */
export function inheritedCutAttributes(el) {
  const nearest = (read) => {
    const own = read(el);
    if (own != null) return own;
    for (let g = el.parentNode; g && g.nodeType === 1 && g.tagName.toLowerCase() === 'g'; g = g.parentNode) {
      const v = read(g);
      if (v != null) return v;
    }
    return null;
  };
  return {
    getAttribute: (name) => nearest((n) => n.getAttribute(name)),
    getAttributeNS: (ns, name) => nearest((n) => n.getAttributeNS(ns, name)),
  };
}

/** Import `text` (an SVG or a DXF) into `designController`'s sketch as a NEW sketch; returns the shared importer's result. getDocUnit(): the document unit.
 *  showDesign(): TASK 706, the mode router's: the import lands in Design, shown (sketch-import.js calls it first); omitted by a caller with no stages. */
export function importShaperFile(designController, text, fileName, getDocUnit, { showDesign = null } = {}) {
  return importIntoSketch(text, fileName, designController, {
    showDesign,
    describeElement: (el) => ({ cutRecord: extractCutRecord(inheritedCutAttributes(el), getDocUnit()) }),
    keepDescIds: true,
    afterImport: ({ state, descs }) => {
      const cutRecordByDesc = new Map();
      for (const d of descs) {
        if (d.cutRecord && (d.cutRecord.cutType || (d.cutRecord.cutDepth != null && d.cutRecord.cutDepth !== 'unset'))) cutRecordByDesc.set(d.descId, d.cutRecord);
      }
      const n = assignImportedCuts(state, cutRecordByDesc, CUT_PLAN);
      return n ? `${n} cut${n === 1 ? '' : 's'} kept` : null;
    },
  });
}

/**
 * TASK 610: what the page script did around importShaperFile, moved here unchanged: the sidebar's "Import SVG / DXF…" entry (importFile) and the drop on the
 * page (mountDrop). The page and the node test kit both call it. ensureSketch(): mounts the sketcher if it is not yet; getController(): the sketcher;
 * getInfoPanel(): the SKETCHES panel to refresh (or null); notify(msg): the status line; getDropHost(): the element a dropped file lands on (TASK 706: the
 * whole page). showDesign(): the mode router's (modes.js), declared to the shared importer: the import is shown in Design, from any stage (the canvas then
 * has its size for the import's fit, and the status line, which lives over the Design view, is seen).
 */
export function createShaperImporter({ ensureSketch, getController, getInfoPanel, notify, getDropHost, showDesign }) {
  const importFile = (text, fileName) => {
    ensureSketch();
    const res = importShaperFile(getController(), text, fileName, docUnit, { showDesign });
    const panel = getInfoPanel();
    if (res.ok && panel) panel.refresh();
    notify(res.message);
  };
  const mountDrop = () => { const host = getDropHost(); if (host) mountImportDrop(host, importFile); };
  return { importFile, mountDrop };
}
