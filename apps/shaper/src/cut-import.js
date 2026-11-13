// apps/shaper/src/cut-import.js — Shaper's SVG / DXF IMPORT into a new sketch, DECLARED in one importable place (TASK 583). The page script (main.js
// importFileToSketch) and the node test kit's tests both call importShaperFile(): the ONE shared importer (#ui/sketch-import.js) with what is Shaper's own
// declared as options: each element's cut record (describeElement), kept descIds, and connecting those records to the in-memory CUT_PLAN after the shapes are
// in (afterImport; a compound <path> becomes ONE pocket-with-hole profile: see assignImportedCuts). Moved out of main.js unchanged; the page keeps its status
// line and panel refresh.
import { importIntoSketch } from '#ui/sketch-import.js'; // TASK 566: the ONE SVG / DXF importer
import { extractCutRecord } from './shaper.js';
import { CUT_PLAN, assignImportedCuts } from './cut-plan.js';

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
