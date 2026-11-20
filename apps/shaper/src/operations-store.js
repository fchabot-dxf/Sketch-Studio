// apps/shaper/src/operations-store.js — TASK S1 (docs/OPERATIONS-MODEL.md 1.2-1.6): the OPERATIONS + REGIONS store, the one place Shaper's cut plan lives
// (it replaces the per-geometry CUT_PLAN map). Plain JSON-safe data, module-level (it persists across Prepare re-mounts), saved in the Shaper sidecar (version 3,
// shaper-doc.js) and in the shared undo snapshots:
//   operations: [{ id, type, on, settings, geometry: [{ key, seq, at? }] }]   array order = the Operations list order (no separate opOrder)
//     id        'op-<n>', stable for life (the preview's data-op, the list rows)
//     type      a CUT_TYPES id ('contour' = a part's Contour: its refs are the PARTS' keys, cut-plan.js resolveEntry gives it its part's depth, type, slope, levels)
//     settings  the operation's settings, base mm, today's record field names (no cutType, no region data, no leadInAt); cutDepth 'model' = each shape's
//               own imported depth (regions[key].source.cutDepth)
//     geometry  the shapes it cuts: `seq` = the FILE order (one counter per document, nextSeq: a new membership takes the next number, a moved one keeps its
//               own), `at` = a dragged lead-in position on that shape's outline (today's leadInAt)
//   regions: { [geometry key]: { slope?, levels?, source? } }  the data that belongs to a GEOMETRY whatever operations use it (entries replaced, never mutated:
//            undo snapshots share them by reference); source = { cutType, cutDepth } as the import gave them
//   nextSeq: the next file-order number
// This module holds the data and its primitives only; the rules of WHICH operation a shape goes into are cut-plan.js's (fileShape), the one writer.

const S = { ops: [], regions: {}, nextSeq: 1 };
let version = 0;          // bumped on every change: the lookup index below is rebuilt once per version
let index = null;         // { version, byPlanKey: Map(planKey -> { op, ref }) }
export const CONTOUR_TYPE = 'contour';
export const CONTOUR_PREFIX = 'contour:';

const cloneOp = (op) => ({ id: op.id, type: op.type, on: op.on !== false, settings: { ...op.settings }, geometry: op.geometry.map((r) => ({ ...r })) });
const bump = () => { version++; index = null; };

/** The stored operations, in list order (live objects: read them, change them only through this module). */
export const storeOps = () => S.ops;
/** The store's change counter (a cache key for readers). */
export const storeVersion = () => version;
/** The region data of a geometry key, or null. */
export const regionOf = (key) => S.regions[key] || null;
/** Every region key. */
export const regionKeys = () => Object.keys(S.regions);

/** The plan key of a membership: the geometry key, or `contour:<key>` for a Contour operation's (the Prepare selection's names, cut-plan.js). */
export const planKeyOf = (op, ref) => (op.type === CONTOUR_TYPE ? CONTOUR_PREFIX + ref.key : ref.key);
/** { op, ref } of a plan key, or null (a geometry is in at most one operation besides its Contour in S1). */
export function memberOf(planKey) {
  if (!index || index.version !== version) {
    const byPlanKey = new Map();
    for (const op of S.ops) for (const ref of op.geometry) { const k = planKeyOf(op, ref); if (!byPlanKey.has(k)) byPlanKey.set(k, { op, ref }); }
    index = { version, byPlanKey };
  }
  return index.byPlanKey.get(planKey) || null;
}
/** Every membership in FILE order (seq): [{ op, ref }]. */
export function membersInFileOrder() {
  const out = [];
  for (const op of S.ops) for (const ref of op.geometry) out.push({ op, ref });
  return out.sort((a, b) => a.ref.seq - b.ref.seq);
}

/** The next file-order number (taken). */
export const takeSeq = () => S.nextSeq++;
/** A new operation id: one more than the highest stored 'op-<n>'. */
function newId() {
  let n = 0;
  for (const op of S.ops) { const m = /^op-(\d+)$/.exec(op.id); if (m) n = Math.max(n, Number(m[1])); }
  return `op-${n + 1}`;
}
/** Insert a NEW operation at list position `at` (its id minted here); returns it. */
export function insertOp(at, { type, settings, geometry = [] }) {
  const op = { id: newId(), type, on: true, settings: { ...settings }, geometry: geometry.map((r) => ({ ...r })) };
  S.ops.splice(Math.max(0, Math.min(at, S.ops.length)), 0, op);
  bump();
  return op;
}
/** Put a membership into an operation (kept in seq order). */
export function addRef(op, ref) {
  op.geometry.push({ ...ref });
  op.geometry.sort((a, b) => a.seq - b.seq);
  bump();
}
/** Take a membership out of its operation; an operation left with no shape is removed (S1: the list never shows an empty operation). */
export function removeRef(op, ref) {
  op.geometry = op.geometry.filter((r) => r !== ref);
  if (!op.geometry.length) S.ops = S.ops.filter((o) => o !== op);
  bump();
}
/** Replace an operation's settings. */
export function setOpSettings(op, settings) { op.settings = { ...settings }; bump(); }
/** Set / clear a membership's dragged lead-in position. */
export function setRefAt(ref, at) {
  if (at === undefined) delete ref.at; else ref.at = at;
  bump();
}
/** The list order: `ids` first (in that order), the operations not named keep their order after them. */
export function reorderOps(ids) {
  const byId = new Map(S.ops.map((op) => [op.id, op]));
  const head = [];
  for (const id of ids) if (byId.has(id) && !head.includes(byId.get(id))) head.push(byId.get(id));
  S.ops = [...head, ...S.ops.filter((op) => !head.includes(op))];
  bump();
}
/** Replace a geometry's region data (null / {} = none). */
export function setRegion(key, region) {
  const clean = region && Object.fromEntries(Object.entries(region).filter(([, v]) => v != null));
  if (clean && Object.keys(clean).length) S.regions[key] = clean; else delete S.regions[key];
  bump();
}

/**
 * renameGeometry(rename, remove) — docs/OPERATIONS-MODEL.md 1.6: rename geometry keys (`rename`: old -> new) and drop some (`remove`): in every operation's refs, in
 * `regions` and in any setting that holds a key (TASK 810's Roughing boundary shape, `boundaryShape`). The one place keys move. An operation left empty is removed.
 */
export function renameGeometry(rename, remove = new Set()) {
  if (!rename.size && !remove.size) return;
  for (const op of S.ops) {
    op.geometry = op.geometry.filter((r) => !remove.has(r.key)).map((r) => (rename.has(r.key) ? { ...r, key: rename.get(r.key) } : r));
    if (typeof op.settings.boundaryShape === 'string' && rename.has(op.settings.boundaryShape)) op.settings = { ...op.settings, boundaryShape: rename.get(op.settings.boundaryShape) };
  }
  S.ops = S.ops.filter((op) => op.geometry.length);
  const regions = {};
  for (const [k, v] of Object.entries(S.regions)) if (!remove.has(k)) regions[rename.get(k) || k] = v;
  S.regions = regions;
  bump();
}

/** The store as plain data: what the document (v3) and the undo snapshots keep. Regions are shared by reference (never mutated). */
export const captureStore = () => ({ operations: S.ops.map(cloneOp), regions: { ...S.regions }, nextSeq: S.nextSeq });
/** Replace the store from captureStore()'s form (anything missing: empty). */
export function applyStore(d) {
  S.ops = Array.isArray(d && d.operations) ? d.operations.filter((op) => op && typeof op.id === 'string' && typeof op.type === 'string' && Array.isArray(op.geometry))
    .map((op) => cloneOp({ ...op, settings: op.settings || {} })) : [];
  S.regions = d && d.regions && typeof d.regions === 'object' ? { ...d.regions } : {};
  const maxSeq = Math.max(0, ...S.ops.flatMap((op) => op.geometry.map((r) => Number(r.seq) || 0)));
  const next = Number(d && d.nextSeq);
  S.nextSeq = Number.isFinite(next) && next > maxSeq ? next : maxSeq + 1;
  bump();
}

// a token per region OBJECT (entries are replaced, never mutated: an equal token = the same slope / levels / source), for a reader's change signature (main.js reviewSig)
const TOKENS = new WeakMap();
let tokenCount = 0;
/** The store as a short change signature: the operations as JSON + a token per region entry (no levels stringified). */
export function storeSignature() {
  const regions = Object.entries(S.regions).map(([k, v]) => { if (!TOKENS.has(v)) TOKENS.set(v, ++tokenCount); return [k, TOKENS.get(v)]; });
  return JSON.stringify([S.ops, regions]);
}
