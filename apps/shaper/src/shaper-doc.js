// apps/shaper/src/shaper-doc.js — Shaper's own document state, in ONE place (TASK 460), persisted through the shared document
// buffer's host sidecar (doc.hosts.shaper), exactly like Pen Plotter's plotter-doc.js (TASK 451):
//   • the CUT PLAN (CUT_PLAN records: cutType, cutDepth, cutOffset, toolDia, cutterShape, cutterAngle, ... every field of every
//     record, keyed by 'loop:<id>' / 'profile:<id>' / 'chain:<id>');
//   • the STOCK the 3D Review reads (apps/shaper/src/stock.js, the one declaration; defaults 3/4 in thick, 1/2 in margin).
// The V-carve records live in the shared sketch state (state.vcarves) and already ride in the buffer's geometry, so they are
// NOT duplicated here. Plain JSON-safe data. An old document has no sidecar: the defaults below apply.

import { CUT_PLAN } from './cut-plan.js';
import { getStock, setStock } from './stock.js'; // THE stock declaration (TASK 459): {thickness, width, height, margin}, base mm

const DOC_VERSION = 1;

/** The persisted Shaper document (what createDocumentBuffer's getHostData returns). */
export function captureShaperDoc() {
  return { version: DOC_VERSION, cutPlan: [...CUT_PLAN.entries()].map(([key, rec]) => [key, { ...rec }]), stock: getStock() };
}

/** Restore a persisted Shaper document. Missing parts keep their defaults (an old buffer carries none of this). */
export function applyShaperDoc(d) {
  CUT_PLAN.clear();
  for (const [key, rec] of (d && Array.isArray(d.cutPlan) ? d.cutPlan : [])) CUT_PLAN.set(key, { ...rec });
  setStock(d && d.stock);
}
