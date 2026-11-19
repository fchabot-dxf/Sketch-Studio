// apps/shaper/src/export-payload.js — TASK 718: Shaper's ONE call of the exporter (#core/shaper-export exportShaperSVG), declared once: the page's
// Generate Shaper SVG / Download / Sync (main.js generateShaperSvgPayload), the Export step's 2D preview (export-preview.js) and the node tests
// all serialize the cut plan through shaperSvgOf. Moved out of main.js unchanged (the loop polygons the host computes, the injected encoding, the
// doc unit); `preview: true` asks the exporter for the PREVIEW copy (its data-step attributes, never in the downloaded file).
import { exportShaperSVG } from '#core/shaper-export.js';
import { findLoops } from '#core/loop-finder.js';
import { deriveCutFootprint, deriveCutTravel } from '#core/profile-model.js'; // TASK 793: the bit-centre paths, the derivation Prepare draws
import { loopPolygon } from '#core/loop-geometry.js';   // HOST computes loop polys (DOM) → serializer stays pure
import { docUnit } from '#core/settings-manager.js';
import { exportEncoding } from './shaper.js';            // injected as the exporter's encoding
import { planOperations, opIdsByPlanKey } from './operations.js'; // TASK 743: the operations (display only) the preview copy maps its elements to
import { shaperFileName } from '#core/shaper-cloud.js';   // TASK 767: the one name rule (the upload applies it too)
import { UNTITLED } from '#ui/document-buffer.js';

/** TASK 767: THE name of every file the Export step produces (Generate Shaper SVG, the sidebar Download, the Sync to ShaperHub dialog's file name),
 *  declared once: the design's name (the document tab's name; in Fusion mode the imported selection's name, main.js) cleaned by shaperFileName,
 *  + .svg. An Untitled design (or none) gets the default name (shaper-cloud.js SHAPER_DEFAULT_NAME + .svg). */
export function exportFileName(designName) {
  return shaperFileName(!designName || designName === UNTITLED ? '' : designName);
}

/** The Shaper SVG of `entries` (the Prepare cut plan, cutPlanEntries()) on the solved sketch `state`: the downloaded file, or with
 *  `preview: true` the same string plus the preview-only data-* attributes. */
export function shaperSvgOf(state, entries, { preview = false, written = null } = {}) {
  const sById = new Map((state.shapes || []).map((s) => [s.id, s]));
  const loopPolys = {};
  for (const l of findLoops(state)) loopPolys[l.id] = loopPolygon(l, state, sById);
  const options = preview ? { previewData: true } : {};
  if (written) options.written = written; // TASK 793: receives { cut, entry } of each element in the file's order (the Export step's Paths view)
  return exportShaperSVG({ state, entries, encoding: exportEncoding(), docUnit: docUnit(), options, loopPolys });
}

/** TASK 743: the Export step's 2D view: { svg, ops } = the PREVIEW copy (shaperSvgOf with preview: true, each entry tagged with the id of its OPERATION, so
 *  every element carries data-op="<id>"; the entries stay in plan order: the elements, their order and grouping are the download's) and the operations in the
 *  document's order (operations.js planOperations, the same list Prepare shows). Operations are a display grouping: the downloaded file never changes. */
export function shaperPreviewOf(state, entries) {
  const ops = planOperations(state, entries);
  const ids = opIdsByPlanKey(ops);
  const written = []; // TASK 793: the elements' cuts, in the file's order (the Paths view's bit-centre paths)
  return { svg: shaperSvgOf(state, entries.map((e) => (ids.has(`${e.target.kind}:${e.target.id}`) ? { ...e, op: ids.get(`${e.target.kind}:${e.target.id}`) } : e)), { preview: true, written }), ops, written };
}

/** TASK 793: the Export step's Paths view: the bit-centre travel of every element of the file. `written` = shaperPreviewOf's list ({ cut, entry } of each
 *  element, in the file's order); returns [{ index (the element's place in the file), travel }] for the elements that have one, `travel` = deriveCutTravel's
 *  entries ({ role, direction, path (world points), closed }) from deriveCutFootprint of that cut: THE derivation Prepare draws (cut-plan.js
 *  deriveKeyFootprints composes the same two calls), so the view shows what Prepare shows, not a second geometry. An element with no determined travel
 *  (a plain On line cut, a guide, a held cut's gap strip) has no entry. */
export function bitCentrePaths(state, written) {
  const out = [];
  written.forEach(({ cut }, index) => {
    const travel = deriveCutTravel(deriveCutFootprint([cut], cut.rec, state));
    if (travel.length) out.push({ index, travel });
  });
  return out;
}
