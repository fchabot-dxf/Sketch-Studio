// packages/core/journal.js — the OPS JOURNAL (TASK 507): an ordered, replayable log of how a drawing was built.
//
// README: the diagnostic report's `journal` field
// ------------------------------------------------
// The shared sketch state keeps the last HISTORY_DEPTH undo snapshots (packages/ui/sketch-state.js); each one is stamped with `t`
// (Date.now() when saved) and `label` (what the user did NEXT: 'line', 'rect', 'edit dimension 23.6 -> 17', 'delete shapes', ...).
// buildJournal() turns that history into
//
//   journal = {
//     base:      the OLDEST history snapshot as a document (serializeDocument shape: {version, geometry:{joints,shapes,constraints,
//                sketches, activeSketchId, groups, profiles, vcarves}, hosts}),
//     steps:     [{ seq, t, label, patch }]  one per history step, oldest first; applying patch k to the document after step k-1
//                gives the document after step k; the LAST step ends at the live document,
//     redo:      [{ seq, t, label, patch }]  the undone steps (state.redoStack) in the order Redo would re-apply them, starting from
//                the live document, so a report taken right after an Undo still shows the undone step,
//     current:   { seq, hash, counts }       a digest of the live document (replay verifies it),
//     truncated: null | { droppedSteps }     set when the oldest steps were folded into `base` to respect the size cap
//   }
//
// A PATCH is JSON-safe and keyed per document part: { joints, shapes, constraints, sketches, groups, profiles, vcarves, activeSketchId }
// — only the parts that changed are present. A list part is { removed:[indexInOld], changed:[[indexInOld, newItem]], added:[[indexInNew,
// item]] } (or { replace: list } / { unset: true } for a reorder or a part that appears/vanishes). Items are matched by KEY: joints and
// shapes by id, sketches/groups/profiles/vcarves by id when they have one, and CONSTRAINTS (which have NO stable id in this code base)
// by their content (canonical JSON) — so editing a dimension's value shows as one constraint removed + one added. activeSketchId is
// { to: value }. applyPatch is the exact inverse of diffSnapshots.
//
// HOW TO REPLAY A REPORT: save the pasted report JSON to a file and run `node scripts/replay-report.cjs report.json [out.json]`: it
// prints the step list ('3  12:04:11  Line   +2 joints +1 shape'), verifies the replayed document against journal.current.hash and
// writes it. In code: tests/harness/sketch.js replayReport(report) -> the final document (feed it to createSketch().load(...)).
//
// What the journal does NOT hold: the host's own undoable data (state.hostSnapshot, e.g. Shaper's cut plan) is not part of the
// document, so it is not journaled. Pure module: no DOM.
import { serializeDocument } from '#core/document.js';

export const DEFAULT_JOURNAL_MAX_BYTES = 3 * 1024 * 1024;

const jsonSafe = (v) => JSON.parse(JSON.stringify(v));
const str = (v) => JSON.stringify(v);
const byteLength = (s) => new TextEncoder().encode(s).length;

// list parts of doc.geometry and how an item is keyed (null = by content)
const LIST_PARTS = [
  ['joints', (item) => str(item[0])],
  ['shapes', (item) => (item && item.id != null ? str(item.id) : null)],
  ['constraints', () => null],
  ['sketches', (item) => (item && item.id != null ? str(item.id) : null)],
  ['groups', (item) => (item && item.id != null ? str(item.id) : null)],
  ['profiles', (item) => (item && item.id != null ? str(item.id) : null)],
  ['vcarves', (item) => (item && item.id != null ? str(item.id) : null)],
];

/** snapshot (or live state) -> a JSON-safe document (serializeDocument's shape). A document passes through untouched. */
export function snapshotToDoc(snapshotOrDoc) {
  if (snapshotOrDoc && snapshotOrDoc.geometry) return snapshotOrDoc;
  return jsonSafe(serializeDocument(snapshotOrDoc));
}

// keys of a list, duplicates made unique by an occurrence counter
function keysOf(list, keyOf) {
  const seen = new Map();
  return list.map((item) => {
    const k = keyOf(item) ?? str(item);
    const n = seen.get(k) || 0;
    seen.set(k, n + 1);
    return k + '#' + n;
  });
}

function diffList(a, b, keyOf) {
  if (a === undefined && b === undefined) return null;
  if (a === undefined) return { replace: b };
  if (b === undefined) return { unset: true };
  const ka = keysOf(a, keyOf), kb = keysOf(b, keyOf);
  const posInB = new Map(kb.map((k, j) => [k, j]));
  const matchedB = new Set();
  const removed = [], changed = [], added = [];
  let lastJ = -1;
  for (let i = 0; i < a.length; i++) {
    const j = posInB.get(ka[i]);
    if (j === undefined) { removed.push(i); continue; }
    if (j < lastJ) return { replace: b }; // the survivors were reordered: not expressible as removes + inserts
    lastJ = j;
    matchedB.add(j);
    if (str(a[i]) !== str(b[j])) changed.push([i, b[j]]);
  }
  for (let j = 0; j < b.length; j++) if (!matchedB.has(j)) added.push([j, b[j]]);
  if (!removed.length && !changed.length && !added.length) return null;
  const part = {};
  if (removed.length) part.removed = removed;
  if (changed.length) part.changed = changed;
  if (added.length) part.added = added;
  return part;
}

function applyList(a, part) {
  if (part.unset) return undefined;
  if (part.replace !== undefined) return part.replace;
  const changed = new Map(part.changed || []);
  const removed = new Set(part.removed || []);
  const survivors = [];
  for (let i = 0; i < a.length; i++) if (!removed.has(i)) survivors.push(changed.has(i) ? changed.get(i) : a[i]);
  const added = part.added || [];
  const out = [];
  let s = 0, n = 0;
  const total = survivors.length + added.length;
  for (let k = 0; k < total; k++) {
    if (n < added.length && added[n][0] === k) out.push(added[n++][1]);
    else out.push(survivors[s++]);
  }
  return out;
}

/** diffSnapshots(a, b) -> a compact JSON-safe patch (empty object when equal). a/b: snapshots, live states or documents. */
export function diffSnapshots(a, b) {
  const da = snapshotToDoc(a).geometry, db = snapshotToDoc(b).geometry;
  const patch = {};
  for (const [name, keyOf] of LIST_PARTS) {
    const part = diffList(da[name], db[name], keyOf);
    if (part) patch[name] = part;
  }
  if (str(da.activeSketchId) !== str(db.activeSketchId)) patch.activeSketchId = { to: db.activeSketchId };
  return patch;
}

/** applyPatch(snapshot, patch) -> the document after the patch (the exact inverse of diffSnapshots). Inputs are not mutated (the result shares unchanged items with them). */
export function applyPatch(snapshotOrDoc, patch) {
  const src = snapshotToDoc(snapshotOrDoc);
  const doc = { ...src, geometry: { ...src.geometry } }; // list parts are replaced, never edited in place
  const g = doc.geometry;
  for (const [name] of LIST_PARTS) {
    if (!patch[name]) continue;
    const next = applyList(g[name], patch[name]);
    if (next === undefined) delete g[name]; else g[name] = next;
  }
  if (patch.activeSketchId) {
    if (patch.activeSketchId.to === undefined) delete g.activeSketchId; else g.activeSketchId = patch.activeSketchId.to;
  }
  return doc;
}

/** a short digest of a document (FNV-1a over its JSON): replay checks the rebuilt drawing against it. */
export function documentHash(doc) {
  const s = str(doc);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

const counts = (doc) => ({ joints: doc.geometry.joints.length, shapes: doc.geometry.shapes.length, constraints: doc.geometry.constraints.length });

/** replayJournal(journal, { includeRedo }) -> the final document: every patch applied in order to base. */
export function replayJournal(journal, { includeRedo = false } = {}) {
  let doc = snapshotToDoc(journal.base);
  for (const step of journal.steps) doc = applyPatch(doc, step.patch);
  if (includeRedo) for (const step of (journal.redo || [])) doc = applyPatch(doc, step.patch);
  return doc;
}

/**
 * buildJournal(history, current, { redoStack, maxBytes }) -> journal (see the README above).
 *   history: state.history (stamped snapshots, oldest first); current: the live state (or a snapshot / document);
 *   redoStack: state.redoStack. maxBytes (default 3 MB): when the serialized journal is bigger, the OLDEST steps are folded
 *   into a newer base and journal.truncated = { droppedSteps } says how many.
 */
export function buildJournal(history, current, { redoStack = [], maxBytes = DEFAULT_JOURNAL_MAX_BYTES } = {}) {
  const curDoc = snapshotToDoc(current);
  const docs = history.map(snapshotToDoc);
  docs.push(curDoc);
  let steps = history.map((snap, i) => ({ seq: i + 1, t: snap.t ?? null, label: snap.label ?? null, patch: diffSnapshots(docs[i], docs[i + 1]) }));
  const redo = [];
  let prev = curDoc;
  for (let k = redoStack.length - 1; k >= 0; k--) {
    const snap = redoStack[k];
    const d = snapshotToDoc(snap);
    redo.push({ seq: history.length + redo.length + 1, t: snap.t ?? null, label: snap.label ?? null, patch: diffSnapshots(prev, d) });
    prev = d;
  }
  const journal = {
    base: docs[0], steps, redo,
    current: { seq: history.length, hash: documentHash(curDoc), counts: counts(curDoc) },
    truncated: null,
  };
  let dropped = 0;
  while (steps.length && byteLength(str(journal)) > maxBytes) {
    const n = Math.max(1, Math.ceil(steps.length / 10));
    let doc = journal.base;
    for (let i = 0; i < n; i++) doc = applyPatch(doc, steps[i].patch);
    journal.base = doc;
    steps = steps.slice(n);
    journal.steps = steps;
    dropped += n;
    journal.truncated = { droppedSteps: dropped };
  }
  return journal;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
/** describePatch(patch) -> '+2 joints +1 shape' (added, -removed, ~changed counts per part). */
export function describePatch(patch) {
  const out = [];
  for (const [name] of LIST_PARTS) {
    const p = patch[name];
    if (!p) continue;
    const word = name.replace(/s$/, '');
    if (p.replace !== undefined) out.push(`${name} replaced`);
    else if (p.unset) out.push(`${name} removed`);
    else {
      if (p.added) out.push(`+${plural(p.added.length, word)}`);
      if (p.removed) out.push(`-${plural(p.removed.length, word)}`);
      if (p.changed) out.push(`~${plural(p.changed.length, word)}`);
    }
  }
  if (patch.activeSketchId) out.push(`active sketch -> ${patch.activeSketchId.to}`);
  return out.join(' ') || 'no change';
}
