// apps/shaper/src/shaper-doc.js — Shaper's own document state, in ONE place (TASK 460), persisted through the shared document
// buffer's host sidecar (doc.hosts.shaper), exactly like Pen Plotter's plotter-doc.js (TASK 451):
//   • the CUT PLAN (CUT_PLAN records: cutType, cutDepth, cutOffset, toolDia, cutterShape, cutterAngle, ... every field of every
//     record, keyed by 'loop:<id>' / 'profile:<id>' / 'chain:<id>');
//   • the STOCK the 3D Review reads (apps/shaper/src/stock.js, the one declaration; defaults 3/4 in thick, 1/2 in margin);
//   • TASK 743: the OPERATION ORDER (operations.js: the operation keys in the user's order; [] = the default order). The operations themselves are
//     derived from the cut plan, never stored.
// Plain JSON-safe data. An old document has no sidecar: the defaults below apply.

import { CUT_PLAN } from './cut-plan.js';
import { opOrder, setOpOrder } from './operations.js'; // TASK 743: the user's operation order
import { getStock, setStock } from './stock.js'; // THE stock declaration (TASK 459): {thickness, width, height, margin}, base mm

const DOC_VERSION = 1;

/** The cut-plan part: ONE capture used by the persisted document AND by the shared undo snapshots (TASK 463). */
export const captureCutPlan = () => [...CUT_PLAN.entries()].map(([key, rec]) => [key, { ...rec }]);
export function applyCutPlan(entries) {
  CUT_PLAN.clear();
  for (const [key, rec] of (Array.isArray(entries) ? entries : [])) CUT_PLAN.set(key, { ...rec });
}

/** TASK 743: what one step of the shared undo history keeps of Prepare (prepare-stage.js hostSnapshot): the cut plan and the operation order. */
export const capturePrepare = () => ({ cutPlan: captureCutPlan(), opOrder: opOrder() });
export function applyPrepare(p) {
  applyCutPlan(p && p.cutPlan);
  setOpOrder(p && p.opOrder);
}

/** The persisted Shaper document (what createDocumentBuffer's getHostData returns). */
export function captureShaperDoc() {
  return { version: DOC_VERSION, cutPlan: captureCutPlan(), stock: getStock(), opOrder: opOrder() };
}

// TASK 749: a programmed pocket's `clearing` before 749 -> today's value: 'concentric' (the separate rings, replaced by the rings joined) -> 'linked' (Spiral),
// 'spiral' (the Morphed spiral) -> 'morphed'. Mapped HERE only, on reading a stored document (the one read of the Shaper part of a document: the shared
// #core/document.js hands doc.hosts.shaper over untouched); 749 never writes the old values, so the mapping is unambiguous. An operation key of the stored
// order (operations.js opKeyOf: JSON with the record's clearing pattern) is mapped the same way, so a reordered pocket keeps its place.
const OLD_CLEARING = Object.freeze({ concentric: 'linked', spiral: 'morphed' });
const withClearingNow = (rec) => (rec && Object.hasOwn(OLD_CLEARING, rec.clearing) ? { ...rec, clearing: OLD_CLEARING[rec.clearing] } : rec);
const opKeyNow = (k) => (typeof k === 'string' ? k.replace(/"pattern":"(concentric|spiral)"/, (m, v) => `"pattern":"${OLD_CLEARING[v]}"`) : k);

/** Restore a persisted Shaper document. Missing parts keep their defaults (an old buffer carries none of this; no opOrder = the default order). */
export function applyShaperDoc(d) {
  applyCutPlan(d && Array.isArray(d.cutPlan) ? d.cutPlan.map(([key, rec]) => [key, withClearingNow(rec)]) : d && d.cutPlan);
  setStock(d && d.stock);
  setOpOrder(d && Array.isArray(d.opOrder) ? d.opOrder.map(opKeyNow) : d && d.opOrder);
}
