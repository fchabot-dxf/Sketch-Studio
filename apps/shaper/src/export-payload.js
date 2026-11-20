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
import { describeOperations } from './operations.js'; // TASK 743: the operations (display only) the preview copy maps its elements to
import { planEntries } from './cut-plan.js'; // TASK 798: the ticked operations (the file) and the whole plan (its frame)
import { shaperFileName } from '#core/shaper-cloud.js';   // TASK 767: the one name rule (the upload applies it too)
import { UNTITLED } from '#ui/document-buffer.js';

/** TASK 767: THE name of every file the Export step produces (Generate Shaper SVG, the sidebar Download, the Sync to ShaperHub dialog's file name),
 *  declared once: the design's name (the document tab's name; in Fusion mode the imported selection's name, main.js) cleaned by shaperFileName,
 *  + .svg. An Untitled design (or none) gets the default name (shaper-cloud.js SHAPER_DEFAULT_NAME + .svg). */
export function exportFileName(designName) {
  return shaperFileName(!designName || designName === UNTITLED ? '' : designName);
}

/** The Shaper SVG of `entries` (the Prepare cut plan, cut-plan.js planEntries()) on the solved sketch `state`: the downloaded file, or with
 *  `preview: true` the same string plus the preview-only data-* attributes. TASK 798: `frame` = the WHOLE plan's entries (planEntries()) when `entries` are the
 *  ticked operations' (planEntries({ ticked: true })): the file then has the whole design's page and hole ownership (#core exportShaperSVG options.frame), so
 *  every partial export lines up on the Origin with the full one (a design with no Stock: + the frame guide, the whole file's drawn extent, advisor turn 2705);
 *  given only when it holds more entries than `entries` (everything ticked: today's file). */
export function shaperSvgOf(state, entries, { preview = false, written = null, frame = null } = {}) {
  const sById = new Map((state.shapes || []).map((s) => [s.id, s]));
  const loopPolys = {};
  for (const l of findLoops(state)) loopPolys[l.id] = loopPolygon(l, state, sById);
  const options = preview ? { previewData: true } : {};
  if (written) options.written = written; // TASK 793: receives { cut, entry } of each element in the file's order (the Export step's Paths view)
  if (frame && frame.length > entries.length) options.frame = { entries: frame }; // TASK 798
  return exportShaperSVG({ state, entries, encoding: exportEncoding(), docUnit: docUnit(), options, loopPolys });
}

/** TASK 798 (owner ruling turn 2537: "checked boxes export in one svg"): THE file of the Export step (Generate Shaper SVG, Download, Send to ShaperHub, the 2D /
 *  Paths views): the TICKED operations (planEntries({ ticked: true })) on the WHOLE plan's frame (planEntries(): the page and the hole ownership), on the solved
 *  sketch `state`. Returns null when nothing is ticked (or the plan is empty); else { svg, entries } (the download), or with `preview: true` shaperPreviewOf's
 *  { svg, ops, written } + entries. Everything ticked: today's file, byte for byte. */
export function exportFileOf(state, { preview = false } = {}) {
  const entries = planEntries({ ticked: true });
  if (!entries.length) return null;
  const frame = planEntries();
  if (preview) return { ...shaperPreviewOf(state, entries, frame), entries };
  return { svg: shaperSvgOf(state, entries, { frame }), entries };
}

/** TASK 743: the Export step's 2D view: { svg, ops } = the PREVIEW copy (shaperSvgOf with preview: true, each entry tagged with the id of its OPERATION, so
 *  every element carries data-op="<id>"; the entries stay in file order: the elements, their order and grouping are the download's) and the operations in the
 *  document's order (operations.js describeOperations, the same list Prepare shows). Operations are a display grouping: the downloaded file never changes.
 *  TASK S1: an element's operation is its entry's stored operation (`opId`). TASK 798: `entries` = the ticked operations', `frame` = the whole plan's (see shaperSvgOf). */
export function shaperPreviewOf(state, entries, frame = null) {
  const ops = describeOperations(state, entries, frame, { every: false }); // TASK 798: the ticked operations (`entries`), derived with the whole plan's hole ownership (`frame`); TASK S2: only the ones that cut
  const listed = new Set(ops.map((op) => op.id));
  const written = []; // TASK 793: the elements' cuts, in the file's order (the Paths view's bit-centre paths)
  return { svg: shaperSvgOf(state, entries.map((e) => (listed.has(e.opId) ? { ...e, op: e.opId } : e)), { preview: true, written, frame }), ops, written };
}

/** TASK 793: the Export step's Paths view: the bit-centre travel of every element of the file. `written` = shaperPreviewOf's list ({ cut, entry } of each
 *  element, in the file's order); returns [{ index (the element's place in the file), travel }] for the elements that have one, `travel` = deriveCutTravel's
 *  entries ({ role, direction, path (world points), closed }) from deriveCutFootprint of that cut: THE derivation Prepare draws (cut-plan.js
 *  deriveKeyFootprints composes the same two calls), so the view shows what Prepare shows, not a second geometry. An element with no determined travel
 *  (a plain On line cut, a guide, a held cut's gap strip, TASK 798 the frame guide of a partial file) has no entry. */
export function bitCentrePaths(state, written) {
  const out = [];
  written.forEach(({ cut }, index) => {
    if (!cut) return; // TASK 798: the frame guide of a partial file (#core exportShaperSVG options.frame) is no cut
    const travel = deriveCutTravel(deriveCutFootprint([cut], cut.rec, state));
    if (travel.length) out.push({ index, travel });
  });
  return out;
}

/** TASK 798: the Export step's ONE line while an operation is unticked (phone-readable): "Exporting 2 of 4 operations (unticked: Contour 1 mm (⅛″ ball nose),
 *  Outside 19 mm (¼″ end mill)). Place it with the same anchor as the earlier file." — `ops` = describeOperations(state) (every listed operation, with its `on` /
 *  `tickable`; the Stock is not counted: it is in every file). Everything ticked (or nothing to tick): ''. */
export function exportTickLine(ops) {
  const tickable = ops.filter((op) => op.tickable !== false);
  const on = tickable.filter((op) => op.on !== false);
  if (on.length === tickable.length) return '';
  const n = tickable.length, ops1 = n === 1 ? 'operation' : 'operations';
  if (!on.length) return `Exporting 0 of ${n} ${ops1}: every one is unticked. Tick one in Prepare's Operations list.`;
  const name = (op) => [op.typeLabel, op.depthText].filter(Boolean).join(' ') + (op.tool ? ` (${op.tool.label})` : '');
  return `Exporting ${on.length} of ${n} ${ops1} (unticked: ${tickable.filter((op) => op.on === false).map(name).join(', ')}). Place it with the same anchor as the earlier file.`;
}
