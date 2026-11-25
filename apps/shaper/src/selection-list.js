// apps/shaper/src/selection-list.js — TASK 795: the SELECTION LIST, in ONE place (like stl-source.js / stock.js): what the design was built from, one entry per
// selection the user added (a Fusion "Add selection", or the one STL / old-add-in selection that replaced the design). Shaper app state, module-level like CUT_PLAN.
// An entry names the geometry and the cut-plan records that selection made, so it can be removed (selection-edit.js) and so the SAME selectionId arriving again
// (the add-in re-sends after a Fusion edit) updates it in place:
//   { id, fusion, kind, text, name, sketchId, shapeIds, cutKeys, base, sigs, thicknessMm, regionCount }
//   id: the add-in's selectionId (uuid), or 'local-<n>' for a selection that has none (an STL, a payload of an old add-in); fusion: true = the id came from the add-in
//   (so the add-in has an overlay for it: only those ids are sent to it); kind: the payload's source.kind; text: the row's words (summary.text, else
//   "<source.name> · N regions"; an STL: its file name); cutKeys: the plan keys of its regions; base: key -> { cutType, cutDepth } as the payload gave them (what
//   Fusion said, so an update can tell what the user changed); sigs: key -> the region's geometry signature (an update keeps a matching record's settings).
//   frame: the payload's 3D frame (the Fusion toolpaths' frame); frames (TASK 891, add-in SA-36): key -> its region's own frame, when the payload gives one (each
//   body of a several-body selection is read in its own frame: its own top = depth 0).
//   • the UNDO snapshots (shaper-doc.js capturePrepare) and the DOCUMENT (captureShaperDoc: only when the list is not empty, so a design without selections
//     writes the same bytes as before) carry the list as plain JSON.
const LIST = [];
const LISTENERS = new Set();
let seq = 0;
let clearToken = null; // TASK 795c: tracks SA-15 row-X / Clear-all clear steps in Prepare undo/redo snapshots without mutating saved docs
let clearSeq = 0;

const clone = (e) => JSON.parse(JSON.stringify(e));
/** The id of a selection that came without one (an STL, a payload of an old add-in). */
export const localSelectionId = () => `local-${++seq}`;

/** Declared SA-15 summary.items labels (mirrors shaper-addin bridge.SUMMARY_ITEM_KINDS). */
export const SUMMARY_ITEM_WORDS = Object.freeze({
  body: ['body', 'bodies'],
  face: ['face', 'faces'],
  'sloped-face': ['sloped face', 'sloped faces'],
  sketch: ['sketch', 'sketches'],
  profile: ['profile', 'profiles'],
  curve: ['curve', 'curves'],
});

export function formatSummaryItem(item) {
  const kind = String((item && item.kind) || '');
  const count = Number(item && item.count) || 0;
  const names = Array.isArray(item && item.names) ? item.names.map((n) => String(n || '').trim()).filter(Boolean) : [];
  const rawDetail = typeof (item && item.detail) === 'string' ? item.detail.trim() : '';
  const [one, many] = SUMMARY_ITEM_WORDS[kind] || [kind || 'item', `${kind || 'item'}s`];
  const detail = rawDetail || `${count} ${count === 1 ? one : many}`;
  return names.length ? `${names.join(', ')} · ${detail}` : detail;
}

/** Expand one stored selection entry into Prepare bar rows (one per summary.items entry in order, or one fallback row for older payloads). */
export function selectionRowsOf(entry) {
  if (!entry) return [];
  if (entry.fusion && Array.isArray(entry.items) && entry.items.length > 0) {
    return entry.items.map((item) => ({
      id: entry.id,
      group: item.kind,
      kind: item.kind,
      count: item.count,
      names: item.names,
      text: formatSummaryItem(item),
      fusion: true,
    }));
  }
  return [{ id: entry.id, group: null, kind: entry.kind, text: entry.text, fusion: entry.fusion === true }];
}

/** The list, a copy (in the order the selections were added). */
export const getSelections = () => LIST.map(clone);
export const getClearToken = () => (clearToken ? clone(clearToken) : null);
export function makeClearToken({ restoreIds = [], clearPayload = null, redoPayloads = null }) {
  return {
    id: ++clearSeq,
    parentId: clearToken ? clearToken.id : null,
    restoreIds: [...restoreIds],
    clearPayload: clearPayload ? clone(clearPayload) : null,
    ...(Array.isArray(redoPayloads) && redoPayloads.length ? { redoPayloads: clone(redoPayloads) } : {}),
  };
}

/** Call fn({ removed, all, sync, restoreIds, redoClear }) after every change of the list. */
export function onSelectionsChange(fn) { LISTENERS.add(fn); return () => LISTENERS.delete(fn); }

function saneItem(it) {
  if (!it || typeof it !== 'object' || typeof it.kind !== 'string' || !it.kind) return null;
  const names = Array.isArray(it.names) ? it.names.map(String) : [];
  const detail = typeof it.detail === 'string' && it.detail.trim() ? it.detail.trim() : '';
  return { kind: it.kind, count: Number.isFinite(Number(it.count)) ? Number(it.count) : 0, names, ...(detail ? { detail } : {}) };
}

function sane(e) {
  if (!e || typeof e !== 'object' || typeof e.id !== 'string' || !e.id) return null;
  const list = (v) => (Array.isArray(v) ? v.map(String) : []);
  const map = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? clone(v) : {});
  const items = Array.isArray(e.items) ? e.items.map(saneItem).filter(Boolean) : [];
  return {
    id: e.id, fusion: e.fusion === true, kind: typeof e.kind === 'string' ? e.kind : '', text: String(e.text == null ? e.id : e.text),
    name: String(e.name || ''), sketchId: typeof e.sketchId === 'string' ? e.sketchId : null,
    shapeIds: list(e.shapeIds), cutKeys: list(e.cutKeys), base: map(e.base), sigs: map(e.sigs),
    thicknessMm: Number.isFinite(e.thicknessMm) ? e.thicknessMm : null, regionCount: Number.isFinite(e.regionCount) ? e.regionCount : 0,
    ...(items.length ? { items } : {}),
    ...(typeof e.payloadSig === 'string' && e.payloadSig ? { payloadSig: e.payloadSig } : {}),
    ...(typeof e.contentSig === 'string' && e.contentSig ? { contentSig: e.contentSig } : {}),
    ...(e.frame && typeof e.frame === 'object' && !Array.isArray(e.frame) ? { frame: clone(e.frame) } : {}),
    ...(e.frames && typeof e.frames === 'object' && !Array.isArray(e.frames) && Object.keys(e.frames).length ? { frames: clone(e.frames) } : {}),
  };
}

/** Replace the whole list (entries that are not objects with an id are dropped). Listeners hear which entries left it. */
export function setSelections(next, { all = false, sync = true, clearToken: nextToken = undefined, restoreIds = null, redoClear = null, redoPayloads = null } = {}) {
  const fresh = (Array.isArray(next) ? next : []).map(sane).filter(Boolean);
  const kept = new Set(fresh.map((e) => e.id));
  const removed = LIST.filter((e) => !kept.has(e.id)).map(clone);
  LIST.length = 0;
  LIST.push(...fresh);
  if (nextToken !== undefined) clearToken = nextToken ? clone(nextToken) : null;
  for (const fn of LISTENERS) {
    fn({ removed, all: Boolean(all) && removed.length > 0, sync, restoreIds, redoClear, redoPayloads });
  }
  return getSelections();
}

/** What one undo step keeps / the document writes: the list (plain JSON). */
export const captureSelections = () => getSelections();
export function applySelections(list, targetToken = undefined) {
  const cur = clearToken;
  let restoreIds = null, redoClear = null, redoPayloads = null, sync = true;
  if (targetToken !== undefined) {
    const curId = cur ? cur.id : null;
    const tgtId = targetToken ? targetToken.id : null;
    if (cur && cur.parentId === tgtId) {
      restoreIds = [...cur.restoreIds];
      sync = false;
    } else if (targetToken && targetToken.parentId === curId) {
      if (targetToken.clearPayload) redoClear = clone(targetToken.clearPayload);
      if (Array.isArray(targetToken.redoPayloads)) redoPayloads = clone(targetToken.redoPayloads);
      sync = false;
    }
  }
  return setSelections(list, { sync, clearToken: targetToken, restoreIds, redoClear, redoPayloads });
}
