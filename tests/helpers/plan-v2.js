// tests/helpers/plan-v2.js — TASK S1 (docs/OPERATIONS-MODEL.md section 6: "tests that poke CUT_PLAN directly load a v2 sidecar through applyShaperDoc instead: the
// real migration path, no test-only code"). V2_PLAN is a test's VERSION 2 DOCUMENT of the cut plan (the per-geometry records of before S1, keyed 'loop:<id>' /
// 'profile:<id>' / 'chain:<id>' / 'contour:<part key>', in the order they were set, + the operation order `opOrder`), written the way a test wrote CUT_PLAN:
//   set(key, rec) / delete(key) / clear() / setOrder(keys): the document is rebuilt and LOADED through shaper-doc.js applyShaperDoc (the one read of a stored
//     Shaper document: its v2 -> v3 migration into the operations store), with the sketch given to use(state) (the load reconciles with it, and orders the
//     operations by the cuts they make, as the app does), or none;
//   get(key) / has(key) / size / keys() / values() / entries() / iteration: what the app's store now holds (cut-plan.js planRecords / getPlanRecord: each shape's
//     record, a Contour's as stored), as a LIVE record: reading a field reads the store now; writing (or deleting) a field writes the document with that record
//     changed (set(key, ...): loaded again), as a test changed a CUT_PLAN record in place.
// The document a write starts from is the app's store as it is (an edit the test made through the app is kept): its records in file order, plus each region a
// shape in no operation still has (its slope / levels and imported depth).
import { applyShaperDoc } from '../../apps/shaper/src/shaper-doc.js';
import { planRecords, getPlanRecord, getCutRecord, recordOf, resolveEntry } from '../../apps/shaper/src/cut-plan.js';
import { opKeyOf } from '../../apps/shaper/src/operations.js';
import { memberOf, regionKeys, regionOf, storeOps, planKeyOf } from '../../apps/shaper/src/operations-store.js';
import { getStock } from '../../apps/shaper/src/stock.js';
import { captureStlDoc } from '../../apps/shaper/src/stl-source.js';
import { getSelections } from '../../apps/shaper/src/selection-list.js';

let STATE = null;
let ORDER = [];
// a shape's live record (see the header)
const recordNow = (key) => getPlanRecord(key) || (regionOf(key) ? { ...getCutRecord(key), cutType: null } : null); // a shape in no operation with region data: its record without a cut type (as before S1)
function live(key) {
  const now = () => recordNow(key) || {};
  return new Proxy({}, {
    get: (t, p) => now()[p],
    set: (t, p, v) => { V2_PLAN.set(key, { ...now(), [p]: v }); return true; },
    deleteProperty: (t, p) => { const r = { ...now() }; delete r[p]; V2_PLAN.set(key, r); return true; },
    has: (t, p) => p in now(),
    ownKeys: () => Reflect.ownKeys(now()),
    getOwnPropertyDescriptor: (t, p) => { const r = now(); return Object.hasOwn(r, p) ? { value: r[p], writable: true, enumerable: true, configurable: true } : undefined; },
  });
}
const freeze = (r, key) => (r ? live(key) : r);

function records() {
  const out = planRecords().map(([k, r]) => [k, { ...r }]);
  for (const k of regionKeys()) if (!memberOf(k)) out.push([k, { ...getCutRecord(k), cutType: null }]); // a region whose shape is in no operation
  return out;
}
function load(list) {
  const stl = captureStlDoc(), selections = getSelections();
  return applyShaperDoc({ version: 2, cutPlan: list, stock: getStock(), opOrder: ORDER, ...(stl ? { stl } : {}), ...(selections.length ? { selections } : {}) }, STATE);
}

export const V2_PLAN = {
  /** The sketch the next loads reconcile with and order by (null: none). Returns V2_PLAN. */
  use(state) { STATE = state || null; return this; },
  set(key, rec) {
    const list = records(), i = list.findIndex(([k]) => k === key);
    if (i >= 0) list[i] = [key, { ...rec }]; else list.push([key, { ...rec }]);
    load(list);
    return this;
  },
  delete(key) { const list = records(), n = list.length, kept = list.filter(([k]) => k !== key); load(kept); return kept.length !== n; },
  clear() { load([]); },
  /** Load these records at once ([[key, rec], ...]: the whole plan) and, given, this operation order. Returns applyShaperDoc's result. */
  load(list, { order } = {}) { if (order) ORDER = order.slice(); return load(list.map(([k, r]) => [k, { ...r }])); },
  /** The stored operation order of the v2 document (operation keys); [] = the default order. */
  setOrder(keys) { ORDER = Array.isArray(keys) ? keys.slice() : []; load(records()); },
  order: () => ORDER.slice(),
  get: (key) => freeze(recordNow(key), key),
  has: (key) => getPlanRecord(key) !== null,
  get size() { return planRecords().length; },
  keys: () => planRecords().map(([k]) => k)[Symbol.iterator](),
  values: () => planRecords().map(([k, r]) => freeze(r, k))[Symbol.iterator](),
  entries: () => planRecords().map(([k, r]) => [k, freeze(r, k)])[Symbol.iterator](),
  [Symbol.iterator]() { return this.entries(); },
};

/** The per-shape records a SAVED version 3 Shaper sidecar holds, [[planKey, record]] in file order (each shape's operation's type + settings, its region's slope /
 *  levels, its dragged lead-in position; Depth 'model' read from its region's source): what a test of before S1 read as d.hosts.shaper.cutPlan. */
export function storedRecords(side) {
  const regions = (side && side.regions) || {};
  const out = [];
  for (const op of (side && side.operations) || []) {
    for (const ref of op.geometry) {
      const r = { cutType: op.type, ...op.settings }, g = regions[ref.key] || {};
      if (r.cutDepth === 'model') r.cutDepth = g.source && g.source.cutDepth != null ? g.source.cutDepth : 'unset';
      if (op.type !== 'contour') { if (g.slope) r.slope = g.slope; if (g.levels) r.levels = g.levels; }
      if (Object.hasOwn(ref, 'at')) r.leadInAt = ref.at;
      out.push([op.type === 'contour' ? 'contour:' + ref.key : ref.key, r, ref.seq]);
    }
  }
  return out.sort((a, b) => a[2] - b[2]).map(([k, r]) => [k, r]);
}

/** The operation keys (operations.js opKeyOf) of the STORED operations, in list order: the order a test of before S1 read as opOrder(). */
export const storedOpKeys = () => storeOps().map((op) => { const ref = op.geometry[0], r = recordOf(op, ref), e = resolveEntry(planKeyOf(op, ref), r); return opKeyOf(e ? e.rec : r); });

/** Load `plan` (a Map or [[key, record], ...]: a v2 plan) for the sketch `state` (through applyShaperDoc), then return fn(): a derivation of that plan. */
export function withPlan(state, plan, fn) { V2_PLAN.use(state).load([...plan]); return fn(); }
