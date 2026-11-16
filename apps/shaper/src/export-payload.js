// apps/shaper/src/export-payload.js — TASK 718: Shaper's ONE call of the exporter (#core/shaper-export exportShaperSVG), declared once: the page's
// Generate Shaper SVG / Download / Sync (main.js generateShaperSvgPayload), the Export step's 2D preview (export-preview.js) and the node tests
// all serialize the cut plan through shaperSvgOf. Moved out of main.js unchanged (the loop polygons the host computes, the injected encoding, the
// doc unit, groupByCut); `preview: true` asks the exporter for the PREVIEW copy (its data-step attributes, never in the downloaded file).
import { exportShaperSVG } from '#core/shaper-export.js';
import { findLoops } from '#core/loop-finder.js';
import { loopPolygon } from '#core/loop-geometry.js';   // HOST computes loop polys (DOM) → serializer stays pure
import { docUnit } from '#core/settings-manager.js';
import { exportEncoding } from './shaper.js';            // injected as the exporter's encoding

/** The Shaper SVG of `entries` (the Prepare cut plan, cutPlanEntries()) on the solved sketch `state`: the downloaded file, or with
 *  `preview: true` the same string plus the preview-only data-* attributes. */
export function shaperSvgOf(state, entries, { preview = false } = {}) {
  const sById = new Map((state.shapes || []).map((s) => [s.id, s]));
  const loopPolys = {};
  for (const l of findLoops(state)) loopPolys[l.id] = loopPolygon(l, state, sById);
  const options = preview ? { groupByCut: true, previewData: true } : { groupByCut: true };
  return exportShaperSVG({ state, entries, encoding: exportEncoding(), docUnit: docUnit(), options, loopPolys });
}
