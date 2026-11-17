// apps/shaper/src/export-payload.js — TASK 718: Shaper's ONE call of the exporter (#core/shaper-export exportShaperSVG), declared once: the page's
// Generate Shaper SVG / Download / Sync (main.js generateShaperSvgPayload), the Export step's 2D preview (export-preview.js) and the node tests
// all serialize the cut plan through shaperSvgOf. Moved out of main.js unchanged (the loop polygons the host computes, the injected encoding, the
// doc unit, groupByCut); `preview: true` asks the exporter for the PREVIEW copy (its data-step attributes, never in the downloaded file).
import { exportShaperSVG } from '#core/shaper-export.js';
import { findLoops } from '#core/loop-finder.js';
import { loopPolygon } from '#core/loop-geometry.js';   // HOST computes loop polys (DOM) → serializer stays pure
import { docUnit } from '#core/settings-manager.js';
import { exportEncoding } from './shaper.js';            // injected as the exporter's encoding
import { planOperations, opEntries } from './operations.js'; // TASK 743: one <g> per operation, in the operation order

/** The Shaper SVG of `entries` (the Prepare cut plan, cutPlanEntries()) on the solved sketch `state`: the downloaded file, or with
 *  `preview: true` the same string plus the preview-only data-* attributes. TASK 743: each OPERATION (operations.js planOperations, in the document's
 *  operation order) is one <g> (groupByOp); { svg, ops } = shaperExportOf. */
export function shaperExportOf(state, entries, { preview = false } = {}) {
  const sById = new Map((state.shapes || []).map((s) => [s.id, s]));
  const loopPolys = {};
  for (const l of findLoops(state)) loopPolys[l.id] = loopPolygon(l, state, sById);
  const ops = planOperations(state, entries);
  const options = preview ? { groupByCut: true, groupByOp: true, previewData: true } : { groupByCut: true, groupByOp: true };
  return { svg: exportShaperSVG({ state, entries: opEntries(ops, entries), encoding: exportEncoding(), docUnit: docUnit(), options, loopPolys }), ops };
}
export const shaperSvgOf = (state, entries, opts) => shaperExportOf(state, entries, opts).svg;
