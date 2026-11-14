// apps/shaper/src/cut-import.js — Shaper's SVG / DXF IMPORT into a new sketch, DECLARED in one importable place (TASK 583). The page script (main.js
// importFileToSketch) and the node test kit's tests both call importShaperFile(): the ONE shared importer (#ui/sketch-import.js) with what is Shaper's own
// declared as options: each element's cut record (describeElement), kept descIds, and connecting those records to the in-memory CUT_PLAN after the shapes are
// in (afterImport; a compound <path> becomes ONE pocket-with-hole profile: see assignImportedCuts). Moved out of main.js unchanged; the page keeps its status
// line and panel refresh.
import { importIntoSketch, mountImportDrop } from '#ui/sketch-import.js'; // TASK 566: the ONE SVG / DXF importer (+ the drop)
import SettingsManager from '#core/settings-manager.js';
import { extractCutRecord } from './shaper.js';
import { CUT_PLAN, assignImportedCuts } from './cut-plan.js';

/** The document unit (TASK 610: moved from main.js, which imports it). */
export const getDocUnit = () => SettingsManager.get('DOC_UNIT') || 'mm';

/** Import `text` (an SVG or a DXF) into `designController`'s sketch as a NEW sketch; returns the shared importer's result. getDocUnit(): the document unit. */
export function importShaperFile(designController, text, fileName, getDocUnit) {
  return importIntoSketch(text, fileName, designController, {
    describeElement: (el) => ({ cutRecord: extractCutRecord(el, getDocUnit()) }),
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
 * Design view (mountDrop). The page and the node test kit both call it. ensureSketch(): mounts the sketcher if it is not yet; getController(): the sketcher;
 * getInfoPanel(): the SKETCHES panel to refresh (or null); notify(msg): the status line; getDropHost(): the element a dropped file lands on.
 */
export function createShaperImporter({ ensureSketch, getController, getInfoPanel, notify, getDropHost }) {
  const importFile = (text, fileName) => {
    ensureSketch();
    const res = importShaperFile(getController(), text, fileName, getDocUnit);
    const panel = getInfoPanel();
    if (res.ok && panel) panel.refresh();
    notify(res.message);
  };
  const mountDrop = () => { const host = getDropHost(); if (host) mountImportDrop(host, importFile); };
  return { importFile, mountDrop };
}
