// apps/shaper/src/selection-list.js — TASK 795: the SELECTION LIST, in ONE place (like stl-source.js / stock.js): what the design was built from, one entry per
// selection the user added (a Fusion "Add selection", or the one STL / old-add-in selection that replaced the design). Shaper app state, module-level like CUT_PLAN.
// An entry names the geometry and the cut-plan records that selection made, so it can be removed (selection-edit.js) and so the SAME selectionId arriving again
// (the add-in re-sends after a Fusion edit) updates it in place:
//   { id, fusion, kind, text, name, sketchId, shapeIds, cutKeys, base, sigs, thicknessMm, regionCount }
//   id: the add-in's selectionId (uuid), or 'local-<n>' for a selection that has none (an STL, a payload of an old add-in); fusion: true = the id came from the add-in
//   (so the add-in has an overlay for it: only those ids are sent to it); kind: the payload's source.kind; text: the row's words (summary.text, else
//   "<source.name> · N regions"; an STL: its file name); cutKeys: the plan keys of its regions; base: key -> { cutType, cutDepth } as the payload gave them (what
//   Fusion said, so an update can tell what the user changed); sigs: key -> the region's geometry signature (an update keeps a matching record's settings).
//   • the UNDO snapshots (shaper-doc.js capturePrepare) and the DOCUMENT (captureShaperDoc: only when the list is not empty, so a design without selections
//     writes the same bytes as before) carry the list as plain JSON.
const LIST = [];
const LISTENERS = new Set();
let seq = 0;

const clone = (e) => JSON.parse(JSON.stringify(e));
/** The id of a selection that came without one (an STL, a payload of an old add-in). */
export const localSelectionId = () => `local-${++seq}`;

/** The list, a copy (in the order the selections were added). */
export const getSelections = () => LIST.map(clone);
/** Call fn({ removed, all }) after every change of the list (the rows; the add-in's overlay): removed = the entries that left it (copies); all = the user cleared every one. */
export function onSelectionsChange(fn) { LISTENERS.add(fn); return () => LISTENERS.delete(fn); }

function sane(e) {
  if (!e || typeof e !== 'object' || typeof e.id !== 'string' || !e.id) return null;
  const list = (v) => (Array.isArray(v) ? v.map(String) : []);
  const map = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? clone(v) : {});
  return {
    id: e.id, fusion: e.fusion === true, kind: typeof e.kind === 'string' ? e.kind : '', text: String(e.text == null ? e.id : e.text),
    name: String(e.name || ''), sketchId: typeof e.sketchId === 'string' ? e.sketchId : null,
    shapeIds: list(e.shapeIds), cutKeys: list(e.cutKeys), base: map(e.base), sigs: map(e.sigs),
    thicknessMm: Number.isFinite(e.thicknessMm) ? e.thicknessMm : null, regionCount: Number.isFinite(e.regionCount) ? e.regionCount : 0,
    ...(e.frame && typeof e.frame === 'object' && !Array.isArray(e.frame) ? { frame: clone(e.frame) } : {}),
  };
}

/** Replace the whole list (entries that are not objects with an id are dropped). Listeners hear which entries left it. */
export function setSelections(next, { all = false } = {}) {
  const fresh = (Array.isArray(next) ? next : []).map(sane).filter(Boolean);
  const kept = new Set(fresh.map((e) => e.id));
  const removed = LIST.filter((e) => !kept.has(e.id)).map(clone);
  LIST.length = 0;
  LIST.push(...fresh);
  for (const fn of LISTENERS) fn({ removed, all: Boolean(all) && removed.length > 0 });
  return getSelections();
}

/** What one undo step keeps / the document writes: the list (plain JSON). */
export const captureSelections = () => getSelections();
export const applySelections = (list) => setSelections(list);
