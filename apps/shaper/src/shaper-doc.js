// apps/shaper/src/shaper-doc.js — Shaper's own document state, in ONE place (TASK 460), persisted through the shared document
// buffer's host sidecar (doc.hosts.shaper), exactly like Pen Plotter's plotter-doc.js (TASK 451):
//   • the CUT PLAN (CUT_PLAN records: cutType, cutDepth, cutOffset, toolDia, cutterShape, cutterAngle, ... every field of every
//     record, keyed by 'loop:<id>' / 'profile:<id>' / 'chain:<id>');
//   • the STOCK the 3D Review reads (apps/shaper/src/stock.js, the one declaration; defaults 3/4 in thick, 1/2 in margin);
//   • TASK 743: the OPERATION ORDER (operations.js: the operation keys in the user's order; [] = the default order). The operations themselves are
//     derived from the cut plan, never stored.
// Plain JSON-safe data. An old document has no sidecar: the defaults below apply.

import { CUT_PLAN, reconcileCutPlan, keepHolesFromOtherSketches } from './cut-plan.js'; // TASK 761: the stored plan reconciled with the document's regions, here, once; TASK 774
import { migrateLeadInRecord } from '#core/lead-in.js'; // TASK 778: 775 straight-leg record -> arc of Radius = old length, Length = 0
import { opOrder, setOpOrder } from './operations.js'; // TASK 743: the user's operation order
import { getStock, setStock } from './stock.js'; // THE stock declaration (TASK 459): {thickness, width, height, margin}, base mm
import { captureStl, applyStl, captureStlDoc, applyStlDoc } from './stl-source.js'; // TASK 790: the STL the design came from (or none)
import { captureSelections, applySelections, getSelections } from './selection-list.js'; // TASK 795: the selection list

// TASK 774: 2 = written under the SAME-SKETCH hole rule of derived faces (commit 27c00a4); a document below 2 (or a sidecar without a version) was
// saved under the old rule: applyShaperDoc keeps its cuts' holes from other sketches (cut-plan.js keepHolesFromOtherSketches).
const DOC_VERSION = 2;
const SAME_SKETCH_HOLES_VERSION = 2;

/** The cut-plan part: ONE capture used by the persisted document AND by the shared undo snapshots (TASK 463). */
export const captureCutPlan = () => [...CUT_PLAN.entries()].map(([key, rec]) => [key, { ...rec }]);
export function applyCutPlan(entries) {
  CUT_PLAN.clear();
  for (const [key, rec] of (Array.isArray(entries) ? entries : [])) CUT_PLAN.set(key, { ...rec });
}

/** TASK 743: what one step of the shared undo history keeps of Prepare (prepare-stage.js hostSnapshot): the cut plan and the operation order.
 *  TASK 790: + the STL source (stl-source.js, without its mesh): undoing an STL import / a new Up or Units gives the previous one back (or none). */
export const capturePrepare = () => ({ cutPlan: captureCutPlan(), opOrder: opOrder(), stl: captureStl(), selections: captureSelections(), stockThickness: getStock().thickness });
export function applyPrepare(p) {
  applyCutPlan(p && p.cutPlan);
  setOpOrder(p && p.opOrder);
  applyStl(p && p.stl);
  applySelections(p && p.selections); // TASK 795: the selection list, and the stock thickness an add set (TASK 794)
  if (p && Number.isFinite(p.stockThickness)) setStock({ ...getStock(), thickness: p.stockThickness });
}

/** The persisted Shaper document (what createDocumentBuffer's getHostData returns). TASK 790: `stl` only when the design came from an STL. */
export function captureShaperDoc() {
  const stl = captureStlDoc();
  const selections = getSelections(); // TASK 795: only when there are some (a design without selections writes the same bytes as before)
  return { version: DOC_VERSION, cutPlan: captureCutPlan(), stock: getStock(), opOrder: opOrder(), ...(stl ? { stl } : {}), ...(selections.length ? { selections } : {}) };
}

// TASK 749: a programmed pocket's `clearing` before 749 -> today's value: 'concentric' (the separate rings, replaced by the rings joined) -> 'linked' (Spiral),
// 'spiral' (the Morphed spiral) -> 'morphed'. Mapped HERE only, on reading a stored document (the one read of the Shaper part of a document: the shared
// #core/document.js hands doc.hosts.shaper over untouched); 749 never writes the old values, so the mapping is unambiguous. An operation key of the stored
// order (operations.js opKeyOf: JSON with the record's clearing pattern) is mapped the same way, so a reordered pocket keeps its place.
// TASK 750: a stored depth per pass (`passDepth`, 745) is DROPPED here (the Origin's Pass Depth / AutoPass makes the step-downs; the clearing is written once at
// the full depth), from the record and from a stored operation key (`"passDepth":<n | null>` in its clearing settings). An old 'concentric' pocket opens as
// Spiral with Loop off (no `loop` field): its open lines + the Origin's inside cut on the wall.
const OLD_CLEARING = Object.freeze({ concentric: 'linked', spiral: 'morphed' });
// TASK 766 (owner turn 2320): the allowance the clearing leaves on the walls is the FINISH allowance (the machining term); a record stored before 766 holds it
// as `wallAllowance`: renamed HERE, the one read of a stored Shaper document (the operation key never carried the field's name: operations.js `allowance`).
// TASK 792 (owner ruling, turn 2512): the STEPPED types are replaced by ROUGHING: a record stored as Stepped pocket / inside / outside opens as Roughing with
// the same step (`stepDepth`, `adaptiveSteps`, `stepDeviation` kept) and allowance 0 (no `finishAllowance`), which IS the stepped cut (its export is byte for
// byte the same: #core/stepped-cut.js deriveLevelsCuts, path 2); a stored operation key with the old type id is mapped the same way (opKeyNow). Mapped HERE
// only, the one read of a stored Shaper document.
const OLD_STEPPED = Object.freeze(['stepped-pocket', 'stepped-inside', 'stepped-outside']);
function withClearingNow(rec) {
  if (!rec || typeof rec !== 'object') return rec;
  if (OLD_STEPPED.includes(rec.cutType)) rec = { ...rec, cutType: 'roughing' }; // TASK 792
  const { passDepth, wallAllowance, ...now } = rec;
  if (wallAllowance !== undefined && now.finishAllowance === undefined) now.finishAllowance = wallAllowance;
  const mapped = Object.hasOwn(OLD_CLEARING, now.clearing) ? { ...now, clearing: OLD_CLEARING[now.clearing] } : now;
  return migrateLeadInRecord(mapped);
}
const opKeyNow = (k) => (typeof k === 'string'
  ? k.replace(/"pattern":"(concentric|spiral)"/, (m, v) => `"pattern":"${OLD_CLEARING[v]}"`)
    .replace(/"stepped-(pocket|inside|outside)"/, '"roughing"') // TASK 792: the stepped types are Roughing
    .replace(/,"passDepth":(null|-?[\d.eE+-]+)/, '')
    .replace(/,"leadIn":("bit"|-?[\d.eE+-]+)/, '') // TASK 778: pocket clearing no longer has lead-in
    .replace(/"leadIn":\{"length":("bit"|-?[\d.eE+-]+),"side":"(outside|inside)"\}/, (m, len, side) => `"leadIn":{"radius":${len === '"bit"' ? '"calc"' : len},"sweep":"calc","length":"calc","side":"${side}"}`)
  : k);

/** Restore a persisted Shaper document. Missing parts keep their defaults (an old buffer carries none of this; no opOrder = the default order).
 *  TASK 761: with the restored sketch `state`, the plan is reconciled with its regions HERE, the one read of a stored Shaper document, before any
 *  reader of the plan (cut-plan.js reconcileCutPlan: the legacy edge records, a chain record on an outline that is now a loop); returns its counts
 *  (the page's one notice, cut-plan.js cutPlanNotice), or null without a state. The stored file changes only when the user next saves.
 *  TASK 774: a document saved before the same-sketch hole rule (version below 2) keeps its cuts' holes from other sketches (keepHolesFromOtherSketches; its
 *  counts join the same notice). */
export function applyShaperDoc(d, state = null) {
  applyCutPlan(d && Array.isArray(d.cutPlan) ? d.cutPlan.map(([key, rec]) => [key, withClearingNow(rec)]) : d && d.cutPlan);
  setStock(d && d.stock);
  setOpOrder(d && Array.isArray(d.opOrder) ? d.opOrder.map(opKeyNow) : d && d.opOrder);
  applyStlDoc(d && d.stl); // TASK 790: the STL card's source (none for a design that did not come from an STL)
  applySelections(d && d.selections); // TASK 795: the selection list (none for a design that was not built from selections)
  if (!state) return null;
  const counts = reconcileCutPlan(state);
  const old = d && Array.isArray(d.cutPlan) && !(Number(d.version) >= SAME_SKETCH_HOLES_VERSION);
  return { ...counts, ...(old ? keepHolesFromOtherSketches(state) : { keptHoles: 0, lostHoles: 0 }) };
}
