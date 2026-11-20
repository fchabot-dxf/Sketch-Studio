// apps/shaper/src/selection-edit.js — TASK 795: what the selection list (selection-list.js) does to the design: build an entry for a selection just imported
// (fusion-import.js importFusionSelection), take a selection's geometry + cut-plan records out again (✕, Clear all, and an update in place of the same
// selectionId), and keep the user's Prepare settings of a region that is still there after an update. The history step, the list change and the page's
// refresh are the callers' (one undo step each).
import { removeGeometry } from '#core/delete-manager.js';
import { getCutRecord, fileShape, settleOrder } from './cut-plan.js'; // TASK S1: a shape's record (its operation's, or its imported depth / region data), the one writer
import { renameGeometry } from './operations-store.js';
import { getSelections, setSelections, localSelectionId } from './selection-list.js';
import { setStlSource } from './stl-source.js';

const r4 = (n) => Math.round(Number(n) * 1e4) / 1e4;
const GEOM = ['type', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r'];
const segSig = (s) => GEOM.map((k) => (k === 'type' ? String((s && s.type) || '') : r4(s && s[k]))).join(',');
const loopSig = (l) => (Array.isArray(l && l.segments) ? l.segments.map(segSig).sort().join(';') : '');
/** A region's (or chain's) geometry as text: the same one again after a Fusion edit means "the same region": its outline and its holes in the payload's own numbers. */
export function regionSig(reg) {
  if (!reg) return '';
  if (Array.isArray(reg.segments)) return 'chain|' + loopSig(reg);
  return 'region|' + loopSig(reg.outer) + '|' + (Array.isArray(reg.holes) ? reg.holes.map(loopSig).sort().join('|') : '');
}

/** The row's words: summary.text, else "<source.name> · N regions" (an old add-in sends no summary); an STL is its file name. */
export function selectionText(data, sourceName, regionCount) {
  const t = data && data.summary && typeof data.summary.text === 'string' ? data.summary.text.trim() : '';
  if (t) return t;
  if (data && data.source && data.source.kind === 'stl') return sourceName;
  return `${sourceName} · ${regionCount} ${regionCount === 1 ? 'region' : 'regions'}`;
}

/** The records (and what Fusion said of them) of a selection about to be updated, by region signature, taken BEFORE its geometry goes: for keepSettings. */
export function priorRecords(entry) {
  const out = new Map();
  if (!entry) return out;
  for (const key of entry.cutKeys) {
    const rec = getCutRecord(key), sig = entry.sigs[key];
    if (rec && sig && !out.has(sig)) out.set(sig, { rec: { ...rec }, base: entry.base[key] || {} });
  }
  return out;
}

/** Build the entry of a selection just imported: its shapes, its plan keys (cutInfo: key -> the payload's region / chain), what Fusion said of each. */
export function buildEntry({ data, sourceName, regionCount, sketch, shapes, cutKeys, cutInfo, thicknessMm }) {
  const id = typeof data.selectionId === 'string' && data.selectionId ? data.selectionId : localSelectionId();
  const base = {}, sigs = {};
  for (const key of cutKeys) {
    const rec = getCutRecord(key);
    base[key] = { cutType: rec.cutType, cutDepth: rec.cutDepth };
    sigs[key] = regionSig(cutInfo.get(key));
  }
  return {
    id, fusion: typeof data.selectionId === 'string' && data.selectionId.length > 0, kind: (data.source && data.source.kind) || '',
    text: selectionText(data, sourceName, regionCount), name: sourceName, sketchId: sketch.id,
    shapeIds: shapes.map((s) => s.id), cutKeys: [...cutKeys], base, sigs, thicknessMm, regionCount,
  };
}

/** An update of the same selectionId: a region that is still there (the same signature) keeps its record, the user's settings. What Fusion changed since the last
 *  send (the cut type, the depth: compared with `base`) follows Fusion; one the user changed stays; the wall's slope always comes from the new payload. */
export function keepSettings(entry, prior, state = null) {
  for (const key of entry.cutKeys) {
    const old = prior.get(entry.sigs[key]);
    if (!old) continue;
    prior.delete(entry.sigs[key]); // two identical regions keep one record each
    const fresh = getCutRecord(key), now = entry.base[key];
    const merged = { ...old.rec };
    for (const f of ['cutType', 'cutDepth']) if (old.rec[f] === old.base[f] || old.base[f] === undefined) merged[f] = fresh[f];
    if (fresh.slope) merged.slope = fresh.slope; else delete merged.slope;
    fileShape(key, merged, state); // TASK S1: the shape moves into the operation of its kept settings
    entry.base[key] = now;
  }
}

/** Take a selection's geometry and cut-plan records out of the design (NO history, NO list change): its plan keys, its combined profiles, its shapes (and the
 *  points, constraints and dimensions only they used: delete-manager.js removeGeometry, THE rule), and the sketch it made. */
export function dropSelectionGeometry(st, entry) {
  const profileIds = new Set();
  renameGeometry(new Map(), new Set(entry.cutKeys)); // TASK S1: its shapes leave every operation, their region data goes
  settleOrder(st); // the list's default order (listOrder 'default') without them
  for (const key of entry.cutKeys) if (key.startsWith('profile:')) profileIds.add(key.slice('profile:'.length));
  if (Array.isArray(st.profiles) && profileIds.size) {
    for (let i = st.profiles.length - 1; i >= 0; i--) if (profileIds.has(st.profiles[i].id)) st.profiles.splice(i, 1);
  }
  removeGeometry(st, entry.shapeIds, []);
  if (st.selectedShapes && typeof st.selectedShapes.delete === 'function') for (const id of entry.shapeIds) st.selectedShapes.delete(id);
  const sketches = Array.isArray(st.sketches) ? st.sketches : [];
  const at = sketches.findIndex((s) => s.id === entry.sketchId);
  if (at >= 0 && sketches.length > 1) {
    sketches.splice(at, 1);
    if (st.activeSketchId === entry.sketchId) st.activeSketchId = (sketches.find((s) => s.locked !== true) || sketches[0]).id;
  }
}

/**
 * Remove ONE selection (✕): its geometry and cut-plan records go, in ONE undo step (Undo gives them back, with the list). The list change tells the add-in
 * (fusion-bridge.js: clear_selection) and the rows. -> { ok, message }
 */
export function removeSelection(controller, id, { prepare = null, onDone = null } = {}) {
  const st = controller && controller.state;
  const entry = getSelections().find((e) => e.id === id);
  if (!st || !entry) return { ok: false, message: 'No such selection' };
  if (typeof st.saveState === 'function') st.saveState('remove selection', { host: true });
  dropSelectionGeometry(st, entry);
  if (entry.kind === 'stl') setStlSource(null); // an STL's row is its source: the STL card goes with it
  setSelections(getSelections().filter((e) => e.id !== id));
  if (prepare && typeof prepare.afterRestore === 'function') prepare.afterRestore();
  if (typeof onDone === 'function') onDone();
  return { ok: true, message: `Removed ${entry.text}` };
}

/** Remove EVERY selection (Clear all): one undo step. The user's own drawing, if any, stays. */
export function clearSelections(controller, { prepare = null, onDone = null } = {}) {
  const st = controller && controller.state;
  const all = getSelections();
  if (!st || !all.length) return { ok: false, message: 'Nothing to clear' };
  if (typeof st.saveState === 'function') st.saveState('clear selections', { host: true });
  for (const entry of all) {
    dropSelectionGeometry(st, entry);
    if (entry.kind === 'stl') setStlSource(null);
  }
  setSelections([], { all: true });
  if (prepare && typeof prepare.afterRestore === 'function') prepare.afterRestore();
  if (typeof onDone === 'function') onDone();
  return { ok: true, message: `Cleared ${all.length} selections` };
}
