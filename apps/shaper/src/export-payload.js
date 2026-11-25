// apps/shaper/src/export-payload.js — TASK 718: Shaper's ONE call of the exporter (#core/shaper-export exportShaperSVG), declared once: the page's
// Generate Shaper SVG / Download / Sync (main.js generateShaperSvgPayload), the Export step's 2D preview (export-preview.js) and the node tests
// all serialize the cut plan through shaperSvgOf. Moved out of main.js unchanged (the loop polygons the host computes, the injected encoding, the
// doc unit); `preview: true` asks the exporter for the PREVIEW copy (its data-step attributes, never in the downloaded file).
import { svgOf, exportFilesOf, bitCentrePaths, simElements } from './op-derive.js'; // TASK 817: the file and the Paths view's travel, derived by the ONE module the background worker runs too
import { exportJob, idle as pathsIdle, onRecalculate } from './op-paths.js'; // TASK 817: the page's export, made in the background (the worker's memo caches warm from the paths it generated)
import { docUnit, lengthText } from '#core/settings-manager.js';
import { splitOf } from './split-files.js'; // TASK 888: Split into files (the setting; the chunks are made with the file, op-derive.js exportFilesOf)
import { exportEncoding, cutTypeById, STOCK_TYPE_ID } from './shaper.js';            // injected as the exporter's encoding; TASK 884: the type labels (the Operations list's)
import { describeOperations } from './operations.js'; // TASK 743: the operations (display only) the preview copy maps its elements to
import { hintLabel } from './param-hints.js'; // TASK S3: the Recalculate action's name (the toolbar button's)
import { planEntries, isTicked } from './cut-plan.js'; // TASK 798: the ticked operations (the file) and the whole plan (its frame); TASK 884: THE tick filter
import { storeOps } from './operations-store.js'; // TASK 884: the operations in the Operations list's order
import { shaperFileName, SHAPER_DEFAULT_NAME } from '#core/shaper-cloud.js';   // TASK 767: the one name rule (the upload applies it too)
import { UNTITLED } from '#ui/document-buffer-core.js'; // TASK 881: the autosave loop's own module (not the page-store wrapper)

// TASK 884 (owner turns 3607-3608): the file holds the TICKED operations only (task 798), so its NAME says which when it is not all of them. The operations a file can
// leave out = every one but the Stock (cut-plan.js isTicked: the board, always in the file), each with its NUMBER in the Operations list: its place in the list
// (operations-store.js storeOps, the order describeOperations lists and op-list.js numbers `i + 1`, the Stock counted), so reordering or deleting an operation
// before it changes the number (and so the name of a partial file).
const leavable = (ops) => ops.map((op, i) => ({ op, n: i + 1 })).filter(({ op }) => op.type !== STOCK_TYPE_ID);
/** TASK 884: the ticked part of a file's name: '' when every operation is ticked (the full file), else each ticked operation's type label (the Operations list's,
 *  cut type menuLabel) and its number there, in list order, joined by " - " ("Outside 1 - Outside 2": owner turn 3611, a dash survives shaperFileName where a comma became _). `ops` = the stored operations in list order. */
export function tickedNamePart(ops = storeOps()) {
  const all = leavable(ops), on = all.filter(({ op }) => isTicked(op));
  return on.length === all.length ? '' : on.map(({ op, n }) => `${(cutTypeById(op.type) || {}).menuLabel || op.type} ${n}`).join(' - ');
}
/** TASK 884: the key of the ticked set (the ShaperHub targets are kept per set: shaperhub-target.js): 'all' when every operation is ticked, else the ticked
 *  operations' ids, sorted (a reorder keeps the key; the name's numbers may change). */
export function tickedSetKey(ops = storeOps()) {
  const all = leavable(ops), on = all.filter(({ op }) => isTicked(op));
  return on.length === all.length ? 'all' : on.map(({ op }) => String(op.id)).sort().join(',');
}

/** TASK 767: THE name of every file the Export step produces (Generate Shaper SVG, the sidebar Download, the Sync to ShaperHub dialog's file name, TASK 884's
 *  replace on Generate), declared once: the design's name (the document tab's name; in Fusion mode the imported selection's name, main.js) cleaned by
 *  shaperFileName, + .svg. An Untitled design (or none) gets the default name (shaper-cloud.js SHAPER_DEFAULT_NAME + .svg). TASK 884: a file of SOME of the
 *  operations (`ops`, the stored operations in list order: some unticked) is "<design name> - <tickedNamePart>.svg" ("bromont - Outside 1.svg", "bromont - Outside 1 - Outside 2.svg"); every one
 *  ticked: the design's name alone, as before. */
export function exportFileName(designName, ops = storeOps()) {
  const base = !designName || designName === UNTITLED ? '' : designName;
  const part = tickedNamePart(ops);
  return shaperFileName(part ? `${base || SHAPER_DEFAULT_NAME} - ${part}` : base);
}

/** TASK 888: THE NAME OF A CHUNK FILE (a split operation's file: split-files.js THE FILES), declared once next to exportFileName: the export's name `name` (exportFileName,
 *  or the name typed in the Sync dialog) without .svg, then " - ", the split operation's type label and number (the Operations list's, as tickedNamePart) and its chunk in
 *  brackets: By depth its band in the document unit ("bromont - Contour 2 (0-10 mm).svg"), By levels its levels ("bromont - Contour 2 (levels 1-20).svg", one level:
 *  "(level 21)"); through shaperFileName. `ops` = the stored operations in list order. */
export function chunkFileName(name, chunk, ops = storeOps()) {
  const stem = shaperFileName(name).replace(/\.svg$/i, '');
  const me = leavable(ops).find(({ op }) => String(op.id) === String(chunk.opId));
  const opName = me ? `${(cutTypeById(me.op.type) || {}).menuLabel || me.op.type} ${me.n}` : 'Operation';
  return shaperFileName(`${stem} - ${opName} (${chunkRangeText(chunk)})`);
}
/** TASK 888: a chunk's range as its file name says it: "0-10 mm" (By depth, the document unit, decimals) or "levels 1-20" / "level 21" (By levels). */
export function chunkRangeText(chunk) {
  if (chunk.mode === 'depth') return `${lengthText(chunk.from, { fractions: false })}-${lengthText(chunk.to, { show: 'unit', fractions: false })}`;
  return chunk.first === chunk.last ? `level ${chunk.first}` : `levels ${chunk.first}-${chunk.last}`;
}
/** TASK 888: the ShaperHub target key of a chunk file (shaperhub-target.js: 884's key of the ticked set, extended with the chunk: its operation, mode and range), so a
 *  replace never reaches another chunk's file, nor the file of a chunk whose range changed. */
export const chunkSetKey = (setKey, chunk) => `${setKey}|${chunk.opId}:${chunk.mode}:${chunk.mode === 'depth' ? `${+chunk.from.toFixed(6)}-${+chunk.to.toFixed(6)}` : `${chunk.first}-${chunk.last}`}`;
/** TASK 888: an export's chunk files with their names ([{ name, svg, chunk }], chunkFileName of `name`), or null when the export is one file (`files` null). */
export const namedFiles = (files, name, ops = storeOps()) => (files && files.length ? files.map((f) => ({ name: chunkFileName(name, f.chunk, ops), svg: f.svg, chunk: f.chunk })) : null);
/** TASK 888: the name of the zip a split export downloads as (main.js / shaper-app.js): the export's name with .zip. */
export const zipFileName = (name) => shaperFileName(name).replace(/\.svg$/i, '.zip');
/** TASK 888: the chunk files' plan of the ticked operations (split-files.js fileSpecs' `plan`), or null when none of them is split. A split is read only on a type that
 *  has levels (Roughing, Contour: CUT_TYPES levelsOp): a setting kept from another type splits nothing. */
export function splitPlan(ops = storeOps()) {
  const ticked = ops.filter((op) => isTicked(op));
  const plan = {
    ops: ticked.filter((op) => op.type !== STOCK_TYPE_ID).map((op) => ({ id: op.id, split: (cutTypeById(op.type) || {}).levelsOp ? splitOf(op.settings, docUnit()) : null })),
    stock: ticked.filter((op) => op.type === STOCK_TYPE_ID).map((op) => op.id),
  };
  return plan.ops.some((o) => o.split) ? plan : null;
}

/** The Shaper SVG of `entries` (the Prepare cut plan, cut-plan.js planEntries()) on the solved sketch `state`: the downloaded file, or with
 *  `preview: true` the same string plus the preview-only data-* attributes. TASK 798: `frame` = the WHOLE plan's entries (planEntries()) when `entries` are the
 *  ticked operations' (planEntries({ ticked: true })): the file then has the whole design's page and hole ownership (#core exportShaperSVG options.frame), so
 *  every partial export lines up on the Origin with the full one (a design with no Stock: + the frame guide, the whole file's drawn extent, advisor turn 2705);
 *  given only when it holds more entries than `entries` (everything ticked: today's file). */
export function shaperSvgOf(state, entries, { preview = false, written = null, frame = null } = {}) {
  return svgOf({ state, entries, encoding: exportEncoding(), docUnit: docUnit(), preview, written, frame }); // TASK 817: op-derive.js (moved there unchanged: the worker runs it too)
}

/** TASK 798 (owner ruling turn 2537: "checked boxes export in one svg"): THE file of the Export step (Generate Shaper SVG, Download, Send to ShaperHub, the 2D /
 *  Paths views): the TICKED operations (planEntries({ ticked: true })) on the WHOLE plan's frame (planEntries(): the page and the hole ownership), on the solved
 *  sketch `state`. Returns null when nothing is ticked (or the plan is empty); else { svg, entries, files } (the download; TASK 888: `files` = the chunk files
 *  [{ svg, chunk }] when a ticked Roughing / Contour is split into files, else null), or with `preview: true` shaperPreviewOf's { svg, ops, written } + entries
 *  (the whole operations: a preview is never split). Everything ticked: today's file, byte for byte. */
export function exportFileOf(state, { preview = false } = {}) {
  const job = exportFileJob(state, { preview });
  if (!job) return null;
  if (!preview) { const { svg, files } = exportFilesOf(job.args); return { svg, entries: job.entries, files }; } // TASK 888: + the chunk files (null: none split)
  const written = [];
  return { svg: svgOf({ ...job.args, written }), ops: job.ops, written, entries: job.entries };
}
/** TASK 817: what exportFileOf writes, as svgOf's arguments: { entries, ops (preview: the operations listed), args } (null when nothing is ticked). The page hands
 *  `args` to the background worker (exportFileInBackground), the node tests to svgOf here: the same file. */
function exportFileJob(state, { preview = false } = {}) {
  const entries = planEntries({ ticked: true });
  if (!entries.length) return null;
  const frame = planEntries();
  const base = { state, encoding: exportEncoding(), docUnit: docUnit(), frame, preview };
  if (!preview) return { entries, ops: null, args: { ...base, entries, split: splitPlan() } }; // TASK 888: the chunk files of a split operation (the views show the whole operation)
  const p = previewEntries(state, entries, frame);
  return { entries, ops: p.ops, args: { ...base, entries: p.entries } };
}
/** TASK 817: the Export step's file made in the BACKGROUND (op-paths.js exportJob: op-derive.js svgOf + bitCentrePaths in the paths worker, queued after the paths
 *  it is generating): resolves exportFileOf's { svg, entries } (preview: + ops and the Paths view's bitPaths instead of `written`, TASK 801 + `simElements`: op-derive.js
 *  simElements), or null when nothing is ticked.
 *  The caller waits until nothing is generating first (main.js): the operations listed are then read off finished paths. */
export async function exportFileInBackground(state, { preview = false } = {}) {
  const job = exportFileJob(state, { preview });
  if (!job) return null;
  const { svg, bitPaths, simElements: sim, files } = await exportJob(job.args);
  return preview ? { svg, ops: job.ops, bitPaths, simElements: sim, entries: job.entries } : { svg, entries: job.entries, files: files || null }; // TASK 801: + what the simulation reads of each element; TASK 888: + the chunk files
}
/** TASK 817 (brief item 4): every operation's paths asked for (describeOperations reads them), then, while some are being generated, `say` gets ONE plain line ("Waiting
 *  for 2 operations to finish") and the wait goes on until none is: the Export step and the 3D Review read finished paths only. Resolves the number of waits.
 *  TASK S3 addition (owner turns 3046-3047, Fusion style): out-of-date paths are never used silently: while a TICKED operation is OUT OF DATE (op-paths.js) `say` gets
 *  the line "2 operations are out of date" with the Recalculate action (`recalculate`: the stage's, the toolbar button's function; say(text, { label, run })) and the
 *  wait goes on until a Recalculate, then for the paths it asks for. */
export const outOfDateLine = (n) => `${n} operation${n === 1 ? ' is' : 's are'} out of date`;
const nextRecalculate = () => new Promise((res) => { const off = onRecalculate(() => { off(); res(); }); });
export async function whenGenerated(state, say = () => {}, { recalculate = null } = {}) {
  let waits = 0;
  for (;;) {
    const ops = describeOperations(state);
    const stale = ops.filter((op) => op.outOfDate && op.on !== false).length;
    if (stale) {
      waits++;
      say(outOfDateLine(stale), recalculate ? { label: hintLabel('opRecalculate'), run: () => recalculate(null) } : null);
      await nextRecalculate();
      continue;
    }
    const n = ops.filter((op) => op.pending).length;
    if (!n) return waits;
    waits++;
    say(`Waiting for ${n} operation${n === 1 ? '' : 's'} to finish`);
    await pathsIdle();
  }
}
/** TASK 817: THE page's export (Generate Shaper SVG, Download, Send to ShaperHub, the 2D / Paths views): it waits for the paths being generated (whenGenerated), then
 *  the file is made in the background from what is stored at that moment: never a stale or partial file. */
export async function exportWhenGenerated(state, { preview = false, say = () => {}, recalculate = null } = {}) {
  await whenGenerated(state, say, { recalculate });
  return exportFileInBackground(state, { preview });
}

/** TASK 743: the Export step's 2D view: { svg, ops } = the PREVIEW copy (shaperSvgOf with preview: true, each entry tagged with the id of its OPERATION, so
 *  every element carries data-op="<id>"; the entries stay in file order: the elements, their order and grouping are the download's) and the operations in the
 *  document's order (operations.js describeOperations, the same list Prepare shows). Operations are a display grouping: the downloaded file never changes.
 *  TASK S1: an element's operation is its entry's stored operation (`opId`). TASK 798: `entries` = the ticked operations', `frame` = the whole plan's (see shaperSvgOf). */
export function shaperPreviewOf(state, entries, frame = null) {
  const p = previewEntries(state, entries, frame);
  const written = []; // TASK 793: the elements' cuts, in the file's order (the Paths view's bit-centre paths)
  return { svg: shaperSvgOf(state, p.entries, { preview: true, written, frame }), ops: p.ops, written };
}
// the preview copy's operations and its entries tagged with them (TASK 817: shared by shaperPreviewOf and the background export)
function previewEntries(state, entries, frame) {
  const ops = describeOperations(state, entries, frame, { every: false }); // TASK 798: the ticked operations (`entries`), derived with the whole plan's hole ownership (`frame`); TASK S2: only the ones that cut
  const listed = new Set(ops.map((op) => op.id));
  return { ops, entries: entries.map((e) => (listed.has(e.opId) ? { ...e, op: e.opId } : e)) };
}

// TASK 793: bitCentrePaths(state, written), the Export step's Paths view (the bit-centre travel of every element of the file), moved unchanged to op-derive.js
// (TASK 817: the background export computes it next to the file); re-exported here for its callers.
export { bitCentrePaths, simElements }; // TASK 801: + what the simulation reads of each element (op-derive.js)

/** TASK 798: the Export step's ONE line while an operation is unticked (phone-readable): "Exporting 2 of 4 operations (unticked: 3. Contour · 1 mm (⅛″ ball nose),
 *  4. Outside · 19 mm (¼″ end mill)). Place it with the same anchor as the earlier file." — `ops` = describeOperations(state) (every listed operation, with its `on` /
 *  `tickable`; the Stock is not counted: it is in every file). Everything ticked (or nothing to tick): ''. */
export function exportTickLine(ops) {
  const tickable = ops.filter((op) => op.tickable !== false);
  const on = tickable.filter((op) => op.on !== false);
  if (on.length === tickable.length) return '';
  const n = tickable.length, ops1 = n === 1 ? 'operation' : 'operations';
  if (!on.length) return `Exporting 0 of ${n} ${ops1}: every one is unticked. Tick one in Prepare's Operations list.`;
  const name = (op) => `${ops.indexOf(op) + 1}. ${op.rowText}` + (op.tool ? ` (${op.tool.label})` : ''); // TASK 825 (V2): the operation's words in the Operations list (its row's text: a Spiral pocket is "Pocket (spiral) · 6 mm") and its number there
  return `Exporting ${on.length} of ${n} ${ops1} (unticked: ${tickable.filter((op) => op.on === false).map(name).join(', ')}). Place it with the same anchor as the earlier file.`;
}
