// apps/shaper/src/cut-import.js — Shaper's SVG / DXF IMPORT into a new sketch, DECLARED in one importable place (TASK 583). The page script (main.js
// importFileToSketch) and the node test kit's tests both call importShaperFile(): the ONE shared importer (#ui/sketch-import.js) with what is Shaper's own
// declared as options: each element's cut record (describeElement), kept descIds, and connecting those records to the plan (the operations store) after the shapes are
// in (afterImport; a compound <path> becomes ONE pocket-with-hole profile: see assignImportedCuts). Moved out of main.js unchanged; the page keeps its status
// line and panel refresh.
import { importIntoSketch, mountImportDrop } from '#ui/sketch-import.js'; // TASK 566: the ONE SVG / DXF importer (+ the drop)
import { docUnit } from '#core/settings-manager.js';
import { extractCutRecord, cutTypeId, defaultCutRecord } from './shaper.js';
import { assignImportedCuts } from './cut-plan.js';

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
      const n = assignImportedCuts(state, cutRecordByDesc);
      return n ? `${n} cut${n === 1 ? '' : 's'} kept` : null;
    },
  });
}

/**
 * TASK 843: a TEMPLATE's declared cuts (#core/templates.js: the document's hosts.template.cuts, [{ shapes: [shape ids], cutType: the Shaper file's word,
 * cutDepth: mm }]) connected to the plan through the import's own rule (cut-plan.js assignImportedCuts: a closed loop of those shapes = its region, an
 * open chain = its On line / Guide), each record the default one with its type and depth. Run when a design WITHOUT a Shaper part opens (design-canvas.js
 * onRestored): a template started here, or in another app and opened here for the first time; once Shaper has saved its own part, that part is the plan.
 * Returns how many cuts were assigned.
 */
export function applyTemplateCuts(state, template) {
  const cuts = template && Array.isArray(template.cuts) ? template.cuts : [];
  const recordOf = new Map(), cutOf = new Map(); // 'cut:<index>' -> its record; shape id -> its cut's name
  cuts.forEach((c, i) => {
    const cutType = cutTypeId(c && c.cutType);
    if (!cutType || !Array.isArray(c.shapes)) return;
    recordOf.set(`cut:${i}`, { ...defaultCutRecord(), cutType, cutDepth: Number.isFinite(c.cutDepth) ? c.cutDepth : 'unset' });
    for (const id of c.shapes) cutOf.set(id, `cut:${i}`);
  });
  return assignImportedCuts(state, recordOf, (sh) => cutOf.get(sh.id));
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
