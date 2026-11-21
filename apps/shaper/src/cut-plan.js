// apps/shaper/src/cut-plan.js — the Shaper Prepare CUT-PLAN store. Per-target cut assignments keyed by
// `${kind}:${id}`:
//   • `loop:<outerLoopId>`  — a derived profile (keeps its outer loop's key so saved plans still load)
//   • `profile:<profileId>` — an explicit combined profile (created via Combine)
//   • `chain:<chainId>`     — an open vector chain (replaces legacy edge:<shapeId>)
// Module-level so it PERSISTS across Prepare re-mounts (Design↔Prepare, re-enter). This is app STATE (not #core).
// Extracted from prepare-view.js (SP1j-4) so it is the SINGLE source of truth read by BOTH Prepare AND shaper-export.

import { defaultCutRecord, effectiveCutRecord, STOCK_TYPE_ID, cutTypeById, cutTypeHasParam, CUT_TYPES } from './shaper.js';
import { deriveProfileCuts, deriveCutFootprintAt, makeProfile, ownedLoopIds, resolveProfileForLoop, derivedProfileForLoop, shapeIndexOf } from '#core/profile-model.js';
import { steppedTerraces, stepGaps, terraceOptions, deriveCuts, STEP_DEPTH, STEP_RESOLUTION, resolutionLevel, LEVELS, hasLevels, roughingAllowance, roughLayout, boundaryOf } from '#core/stepped-cut.js'; // TASK 810: a Roughing's boundary (TASK 817: the levels facts and the footprints are op-derive.js's)
import { docUnit, lengthText, angleText, areaText as coreAreaText } from '#core/settings-manager.js';
import { findLoops, findOpenChains } from '#core/loop-finder.js';
import { loopPolygon, pointInPolygon, loopSuccessors } from '#core/loop-geometry.js'; // TASK 832: loopSuccessors (followDesign)
import { holdMode, holdDefaults } from '#core/hold-part.js'; // TASK 742: tabs / onion skin on an Outside / Inside cut
import { POCKET_CLEARING, clearingPattern, allowanceDefault, morphedBlocker } from '#core/pocket-clearing.js'; // TASK 745: the programmed pocket
import { CONTOUR_TYPE, memberOf, membersInFileOrder, planKeyOf, regionOf, setRegion, storeOps, insertOp, addRef, removeRef, deleteOp, setOpType, setOpSettings, setOpsOn, setRefTabsAt, takeSeq, renameGeometry, regionKeys, listOrder, setOpsOrder, opById } from './operations-store.js'; // TASK S1: the operations + regions store
import { opKeyOf, newOpPlace, defaultOrderIds } from './operations.js'; // TASK S1: which operation a shape goes into (the operation key), where a new one goes
import { loopsWithPolygons, deriveFootprints } from './op-derive.js'; // TASK 817: THE derivation, shared with the background worker (paths-worker.js)
import { lookup as lookupPaths, pathsContext, pathsSig as pathsSigFn, isOutOfDate, followRenames } from './op-paths.js'; // TASK 817: the GENERATED paths (on OK, in the background)
export { loopsWithPolygons };

export const keyOf = (kind, id) => kind + ':' + id;
export const parseKey = (key) => { const i = key.indexOf(':'); return { kind: key.slice(0, i), id: key.slice(i + 1) }; };

// TASK S1 (docs/OPERATIONS-MODEL.md section 2): the plan lives in the OPERATIONS + REGIONS store (operations-store.js); a shape's RECORD (what every derivation
// takes) is rebuilt from its operation and its region: recordOf(op, ref) = { cutType: the operation's type, ...its settings, ...the region's slope / levels,
// tabsAt (TASK 822): the ref's dragged tabs }, cutDepth 'model' -> the shape's imported depth. The per-shape names of today's Prepare (S1 behaves as before) stay:
// a geometry key ('loop:<id>' ...) for its operation, `contour:<key>` for its part's Contour.
const SHAPE_FIELDS = new Set(['cutType', 'slope', 'levels', 'tabsAt']);
/** The settings part of a record (everything but the cut type, the region data and the dragged tabs). */
export const settingsPart = (rec) => Object.fromEntries(Object.entries(rec || {}).filter(([k]) => !SHAPE_FIELDS.has(k)));
const sourceDepth = (key) => { const s = (regionOf(key) || {}).source; return s && s.cutDepth != null ? s.cutDepth : undefined; };
/** The record of a membership (see above). */
export function recordOf(op, ref) {
  const r = { cutType: op.type, ...op.settings };
  if (r.cutDepth === 'model') r.cutDepth = sourceDepth(ref.key) ?? 'unset';
  if (op.type !== CONTOUR_TYPE) { const reg = regionOf(ref.key); if (reg) { if (reg.slope) r.slope = reg.slope; if (reg.levels) r.levels = reg.levels; } }
  if (Array.isArray(ref.tabsAt)) r.tabsAt = [...ref.tabsAt]; // TASK 822: the shape's dragged tabs (#core/hold-part tabsAtOf)
  return r;
}
/** The record of a plan key (a geometry key: its operation's; `contour:<key>`: its Contour's), or null when it is in no operation. */
export function getPlanRecord(planKey) { const m = memberOf(planKey); return m ? recordOf(m.op, m.ref) : null; }
/** The record Prepare shows / edits for a plan key: its operation's, else a fresh default record carrying the geometry's region data and its imported depth (a shape
 *  in no operation: an imported region without a cut type keeps the depth the import gave it, as its record did before task S1). */
export function getCutRecord(key) {
  return getPlanRecord(key) || freshRecord(key);
}
/** TASK S2: the record a shape in no operation has, and the one a NEW operation starts from (the quick flow, 4.4): a fresh default record carrying the geometry's
 *  region data and its imported depth. */
export function freshRecord(key) {
  const out = defaultCutRecord(), reg = isContourKey(key) ? null : regionOf(key);
  if (reg) { if (reg.source && reg.source.cutDepth != null) out.cutDepth = reg.source.cutDepth; if (reg.slope) out.slope = reg.slope; if (reg.levels) out.levels = reg.levels; }
  return out;
}
// ── TASK 798 (owner turns 2515-2537): the Operations list's TICKS. An operation's `on` (operations-store.js) decides whether it is shown and exported: `ticked: true`
// keeps the ticked operations only (Prepare's look, the 3D Review, the Export step's Paths / 2D and the exported SVG read the plan through it); without it, every
// operation (the Operations list itself, the hole ownership and the page of the file: the WHOLE design's, so every export lines up on the Origin). The STOCK is
// always ticked: it is the board, the guide every export is placed by (the Origin's anchors fall on the same points in every file; a design with no Stock: a partial
// file gets the frame guide instead, #core exportShaperSVG options.frame, advisor turn 2705). THE one filter: isTicked. ──
/** TASK 798: whether an operation is ticked (its `on`; the Stock always is). */
export const isTicked = (op) => op.type === STOCK_TYPE_ID || op.on !== false;
const planMembers = ({ ticked = false } = {}) => (ticked ? membersInFileOrder().filter(({ op }) => isTicked(op)) : membersInFileOrder());
/** The plan as [planKey, record] in FILE order (every membership, or with `ticked: true` the ticked operations' only; a Contour's record as stored, not resolved). */
export const planRecords = (opts) => planMembers(opts).map(({ op, ref }) => [planKeyOf(op, ref), recordOf(op, ref)]);
/** TASK S2: the memberships as Prepare's look draws them (a shape in two operations is drawn once per operation), in FILE order: [{ id: '<op id>|<geometry key>',
 *  opId, key (the geometry key), planKey, rec }] (`opts` = planRecords'). */
export const planMemberItems = (opts) => planMembers(opts).map(({ op, ref }) => ({ id: `${op.id}|${ref.key}`, opId: op.id, key: ref.key, planKey: planKeyOf(op, ref), rec: recordOf(op, ref) }));
/**
 * planEntries({ ticked }) — THE one reader (docs/OPERATIONS-MODEL.md section 2; it replaces cutPlanEntries): one entry per membership, in FILE order (seq), as the derivation
 * takes it: { key: '<op id>|<geometry key>', opId, planKey, target, rec } (resolveEntry: a Contour cuts its part's target with its part's depth / type / slope /
 * levels). A Contour whose part is in no operation derives nothing (no entry). TASK 798: `ticked: true` = the ticked operations' entries only (see above).
 */
export function planEntries(opts) {
  const out = [];
  for (const { op, ref } of planMembers(opts)) {
    const planKey = planKeyOf(op, ref);
    const e = resolveEntry(planKey, recordOf(op, ref));
    if (e) out.push({ key: `${op.id}|${ref.key}`, opId: op.id, planKey, target: e.target, rec: e.rec });
  }
  return out;
}

// ── TASK 792: a part's CONTOUR (the finish of its sloped walls: #core/stepped-cut.js, its TASK 792 header) is its OWN operation (type 'contour'); Prepare names its
// membership `contour:<the shape's key>` (e.g. 'contour:loop:loop_a-b'). TASK S2 (owner ruling turn 2713): a plain operation with its OWN settings, linked to no other
// operation: its Depth (typed, or 'model' = each shape's imported depth, as any Depth), its Walls (810) and its Wall side (`wallSide`, a drawn shape: #core
// levelsCutAs); resolveEntry hands the derivation the shape's target, its Depth as `baseDepth` and the shape's `slope` / `levels`. (S1 read them LIVE from the
// part's operation; a document saved before S2 gets explicit values equal to that reading: shaper-doc.js migrateV3.) ──
export const CONTOUR_KIND = 'contour';
export const contourKeyOf = (key) => keyOf(CONTOUR_KIND, key);
export const isContourKey = (key) => typeof key === 'string' && key.startsWith(CONTOUR_KIND + ':');
export const partKeyOf = (key) => (isContourKey(key) ? key.slice(CONTOUR_KIND.length + 1) : key);
/** The part's Contour record (with a cut type), or null. */
export const contourOf = (key) => getPlanRecord(contourKeyOf(key));
/** A plan entry as the derivation takes it: { key, target, rec }. A Contour record gets its shape's target, and its record its own depth as `baseDepth` (TASK S2)
 *  and the shape's `slope` and `levels`. Every other record: its own key's target, its record as stored (TASK 810: a
 *  Roughing whose boundary is the Stock or a picked shape gets that shape's target as `boundaryTarget`: withBoundaryTarget). */
export function resolveEntry(key, rec) {
  if (!isContourKey(key)) return { key, target: parseKey(key), rec: withBoundaryTarget(rec) };
  if (!rec) return null;
  const pk = partKeyOf(key), reg = regionOf(pk) || {};
  return { key, target: parseKey(pk), rec: { ...rec, baseDepth: rec.cutDepth, ...(reg.slope ? { slope: reg.slope } : {}), ...(reg.levels ? { levels: reg.levels } : {}) } };
}
/** TASK 810: a Roughing record whose boundary (#core boundaryOf) is the Stock or a picked Shape, with that shape's target `boundaryTarget` ({ kind, id }: the Stock
 *  of the plan, stockKeyOf; the picked `boundaryShape` key); without one (no Stock, nothing picked) the record as stored: the derivation then refuses with its reason.
 *  Every other record: itself (the same object). */
export function withBoundaryTarget(rec) {
  if (!rec || !(cutTypeById(rec.cutType) || {}).levelsOp || !hasLevels(rec)) return rec;
  const b = boundaryOf(rec);
  const key = b.kind === 'stock' ? stockKeyOf() : b.kind === 'shape' ? b.shape : null;
  return key ? { ...rec, boundaryTarget: parseKey(key) } : rec;
}
/** TASK 810: why a Roughing has nothing to cut (#core levelsRoughingFor's error), in the card note's words (a fact, not a nag). */
export const ROUGHING_REFUSED = {
  'no-stock': 'the design has no Stock: mark a closed shape as Stock, or pick another boundary',
  'no-shape': 'no boundary shape yet: press Pick, then click a closed shape',
  'shape-gone': 'the boundary shape is no longer in the design',
  'no-room': 'the boundary leaves no room for the bit',
  band: 'no level between the Top and the Depth (less the floor allowance)', // the Heights (Roughing and Contour); TASK S2: the Depth (810's Bottom row is gone)
};
/** TASK 810: rename the keys of a STORED v2 plan map (`rename`: old key -> new key) and drop some (`remove`), in place, the map's order kept: the records AND every
 *  reference to a key a record holds (`boundaryShape`). The v2 migration's (shaper-doc.js); the store renames through renameGeometry. */
export function renamePlanKeys(rename, remove, plan) {
  if (!rename.size && !remove.size) return;
  const entries = [...plan];
  plan.clear();
  for (const [key, rec] of entries) {
    if (remove.has(key)) continue;
    if (rec && typeof rec.boundaryShape === 'string' && rename.has(rec.boundaryShape)) rec.boundaryShape = rename.get(rec.boundaryShape);
    plan.set(rename.get(key) || key, rec);
  }
}

// ── TASK S1: THE writer. A shape's record changes (a card edit, a type pick, the bin, an import): the shape MOVES into the operation of the resulting settings
// (docs/OPERATIONS-MODEL.md section 6, S1: the list and the files stay today's):
//  * the same operation key as before (operations.js opKeyOf: tool + type + declared settings): it stays, and the operation takes the record's settings (one
//    settings set per operation: a value that is not part of the key is the operation's, advisor ruling 4, task S1);
//  * else it leaves its operation (removed when empty) and joins the first operation whose shapes have that key (taking its settings), or a NEW operation placed by
//    the default-order rule (operations.js newOpIndex: the 743 rule applied once at creation); it keeps its file place (`seq`) when it had one, else takes the next;
//  * no cut type (the bin, a Stock moved away): it leaves its operation and keeps no place (advisor ruling 2, task S1: assigned again, it goes to the end of the file).
// cutDepth is stored 'model' while every shape of the
// operation has an imported depth equal to it (normalizeDepth). Returns the shape's record now (null when it left every operation). `state` = the solved sketch
// (a new operation's place reads the derived cuts' ranks).
const memberKey = (planKey, rec) => { const e = resolveEntry(planKey, rec); return opKeyOf(e ? e.rec : rec); };
function normalizeDepth(op) {
  if (!op.geometry.length || op.settings.cutDepth === undefined) return;
  const d = recordOf(op, op.geometry[0]).cutDepth;
  const model = d !== 'unset' && Number.isFinite(Number(d)) && op.geometry.every((r) => { const s = sourceDepth(r.key); return s !== undefined && Number(s) === Number(d); });
  const next = model ? 'model' : d;
  if (op.settings.cutDepth !== next) setOpSettings(op, { ...op.settings, cutDepth: next });
}
function writeRegionData(key, rec) {
  const reg = regionOf(key) || {};
  if ((rec.slope || undefined) !== reg.slope || (rec.levels || undefined) !== reg.levels) setRegion(key, { ...reg, slope: rec.slope || undefined, levels: rec.levels || undefined });
}
/** TASK S1: the imported cut type / depth of a geometry (regions[key].source: what Fusion / the STL said; a Depth of 'model' follows it). */
export function setRegionSource(key, source) { setRegion(key, { ...(regionOf(key) || {}), source: source ? { cutType: source.cutType ?? null, cutDepth: source.cutDepth ?? 'unset' } : undefined }); }
/** TASK S1 (advisor ruling turn 2702): while the user has never reordered the list (listOrder 'default'), it is re-sorted by the default rule after every change
 *  (operations.js defaultOrderIds), as before S1: the part-freeing Outside after the holes. A stored order ('stored') is left as it is. */
export function settleOrder(state = null) {
  if (listOrder() !== 'default') return;
  const { ids, waits } = defaultOrderIds(state);
  orderWaits = waits; // TASK 817: a Roughing's / Contour's rank waits for its generated cuts: sorted again when they are there (settleWaiting)
  if (ids && ids.join('\n') !== storeOps().map((op) => op.id).join('\n')) setOpsOrder(ids);
}
// TASK 817: the ORDER that waits for generated paths. A Roughing / Contour ranks by the cuts it makes (operations.js levelsRank), and its cuts are generated in the
// background (op-paths.js): the default order is sorted again (settleOrder), and a NEW operation in a user-ordered list ('stored') is placed by the rule once more
// (as newOpIndex places it: the rule applied once, when it is made), when they are there. A placement waits only while nothing else moved in the list (the list
// order at the placement is kept with it): the user's own order always wins.
let orderWaits = false;
const placing = new Map(); // op id -> the list order (ids) when it was placed with its rank not known
const orderNow = () => storeOps().map((op) => op.id).join('\n');
function placeNew(state, draft) {
  const { index, known } = newOpPlace(state, draft);
  const op = insertOp(index, draft);
  if (!known && listOrder() === 'stored') placing.set(op.id, orderNow());
  return op;
}
/** TASK 817: do what waited for generated paths (see above), on the solved sketch `state`. Returns true when the list order changed (the caller refreshes). */
export function settleWaiting(state) {
  const before = orderNow();
  if (orderWaits) settleOrder(state);
  for (const [id, at] of [...placing]) {
    const op = opById(id), now = orderNow();
    if (!op || listOrder() !== 'stored' || now !== at) { placing.delete(id); continue; }
    const { index, known } = newOpPlace(state, { type: op.type, settings: op.settings, geometry: op.geometry }, { without: id });
    if (!known) continue;
    placing.delete(id);
    const ids = storeOps().map((o) => o.id).filter((x) => x !== id);
    ids.splice(index, 0, id);
    if (ids.join('\n') !== now) setOpsOrder(ids);
  }
  return orderNow() !== before;
}
/** TASK 817: whether something waits for generated paths (settleWaiting has work). */
export const orderWaiting = () => orderWaits || placing.size > 0;
export function fileShape(planKey, rec, state = null) {
  const out = fileShapeOnly(planKey, rec, state);
  settleOrder(state);
  return out;
}
function fileShapeOnly(planKey, rec, state) {
  const contour = isContourKey(planKey), key = partKeyOf(planKey);
  if (!contour && rec) writeRegionData(key, rec);
  const cur = memberOf(planKey);
  if (!rec || !rec.cutType) { if (cur) leaveOp(cur.op, cur.ref); return null; }
  const settings = settingsPart(rec);
  const tabsAt = !contour && Array.isArray(rec.tabsAt) ? rec.tabsAt : undefined; // TASK 822: the shape's dragged tabs stay with it
  const newKey = memberKey(planKey, rec);
  let seq;
  if (cur) {
    const others = cur.op.geometry.filter((r) => r !== cur.ref);
    const opKeyNow = others.length ? memberKey(planKeyOf(cur.op, others[0]), recordOf(cur.op, others[0])) : memberKey(planKey, recordOf(cur.op, cur.ref));
    if (cur.op.type === rec.cutType && opKeyNow === newKey) {
      setOpSettings(cur.op, cur.op.settings.cutDepth === 'model' && settings.cutDepth === recordOf(cur.op, cur.ref).cutDepth ? { ...settings, cutDepth: 'model' } : settings);
      setRefTabsAt(cur.ref, tabsAt);
      normalizeDepth(cur.op);
      return getPlanRecord(planKey);
    }
    seq = cur.ref.seq;
    leaveOp(cur.op, cur.ref);
  } else seq = takeSeq();
  const ref = { key, seq, ...(tabsAt !== undefined ? { tabsAt: [...tabsAt] } : {}) };
  const target = storeOps().find((op) => op.type === rec.cutType && op.geometry.length && !op.geometry.some((r) => r.key === key) && memberKey(planKeyOf(op, op.geometry[0]), recordOf(op, op.geometry[0])) === newKey);
  if (target) { addRef(target, ref); normalizeDepth(target); }
  else { const draft = { type: rec.cutType, settings, geometry: [ref] }; normalizeDepth(placeNew(state, draft)); }
  return getPlanRecord(planKey);
}
// fileShape MOVES a shape: the operation it leaves goes when it is left empty (as before task S2; an EMPTY operation made by the user stays: TASK S2)
function leaveOp(op, ref) { removeRef(op, ref); if (!op.geometry.length) deleteOp(op); }
/** Set one field of a shape's record (Prepare's card edits): fileShape with the resulting record. */
export function setFieldFor(key, field, value, state = null) { return fileShape(key, { ...getCutRecord(key), [field]: value }, state); }

// The Contour defaults: the last bit / cutter shape / step set on any Contour (owner's example: a 1/8 in ball nose at 0.25 mm). App state, like the step depth.
export const CONTOUR_DEFAULTS = Object.freeze({ toolDia: 3.175, cutterShape: 'ballnose', cutterAngle: 90, stepDepth: LEVELS.contourStepMm }); // TASK 810: declared (the card's tab dots read what a Contour starts with)
let lastContourV = { ...CONTOUR_DEFAULTS };
export const lastContour = () => ({ ...lastContourV });
export function rememberContour(field, value) { if (field in lastContourV && value != null) lastContourV = { ...lastContourV, [field]: value }; return lastContour(); }
// ── TASK S2 (docs/OPERATIONS-MODEL.md 4.2-4.4, section 6 S2): the OPERATION-FIRST writers. Prepare edits OPERATIONS: the active operation's settings are every one
// of its shapes' (no per-shape regrouping any more: an edited operation keeps its id, tick and place), shapes are added to / taken out of an operation, a shape in
// several operations has one membership per operation, the quick flow (a type picked for selected shapes) ALWAYS makes a NEW operation, the bin deletes the
// operation. Each writer is one step of the caller's undo (prepare-stage.js cutEdit). While the list keeps the default order (listOrder 'default') it is re-sorted
// after every change (settleOrder, as since S1). fileShape above stays the import's writer (it regroups imported shapes by their settings). ──
const closedOnly = (t) => Boolean(t) && t.targetKind !== 'path'; // a region type (and the Contour: a part's walls) needs a closed shape
/** TASK S2: why the shapes `keys` (geometry keys) cannot be an operation of `type`, or null when they can: THE one rule (the type's declared targetKind); its words are
 *  the one plain line the card shows when such a pick is refused (owner ruling turn 2716: never greyed). An empty list can take any type. */
export function typeRefusal(type, keys) {
  const t = cutTypeById(type);
  if (!t) return 'unknown type';
  const open = keys.filter((k) => parseKey(k).kind === 'chain').length, an = /^[aeiou]/i.test(t.menuLabel) ? 'an' : 'a', needs = `${an} ${t.menuLabel.toLowerCase()} needs a closed shape`;
  if (closedOnly(t) && open) return keys.length === 1 ? `This open line can’t be ${an} ${t.menuLabel}: ${needs}` : `${open === keys.length ? `These ${open} open lines` : `${open} of the ${keys.length} shapes are open lines and`} can’t be ${an} ${t.menuLabel}: ${needs}`; // owner turn 2716's wording
  if (type === STOCK_TYPE_ID && keys.length > 1) return `The Stock is one shape, not ${keys.length}`;
  return null;
}
// what a record of `type` starts with, as a type pick set it before task S2: a Roughing takes the last step depth / adaptive choice / resolution used and the
// allowance of a part with no Contour (0; the Contour no longer sets it: owner rule "no setting silently changes another"); a Contour the last Contour's bit /
// cutter shape / step (lastContour) and the depth `rec` has (the shape's imported depth, or the operation's on a type change)
function startRecord(type, rec) {
  if (type === CONTOUR_TYPE) return { ...defaultCutRecord(), cutDepth: rec.cutDepth ?? 'unset', ...lastContour(), cutType: type };
  const r = { ...rec, cutType: type };
  if ((cutTypeById(type) || {}).levelsOp === 'roughing') {
    if (!(Number(r.stepDepth) > 0)) r.stepDepth = lastStepDepth();
    if (typeof r.adaptiveSteps !== 'boolean') r.adaptiveSteps = lastAdaptiveSteps();
    if (!(Number(r.stepDeviation) > 0)) r.stepDeviation = lastStepDeviation();
    r.finishAllowance = 0;
  }
  return r;
}
/**
 * newOperation(type, keys, state) — TASK S2, the QUICK FLOW (4.4, owner turns 2682-2684): a NEW operation of `type` holding the shapes `keys` (none = an empty one),
 * its settings from the first shape's fresh record (freshRecord + the remembered defaults, startRecord); Depth "From model" ('model') when every shape has an
 * imported depth (each is cut to its own, as each kept its own before). Its memberships take the next file places; it goes into the list by the default rule
 * (newOpIndex). Returns the operation. The Stock is never made here (setStock: one per document).
 */
export function newOperation(type, keys, state = null) {
  const rec = startRecord(type, keys.length ? freshRecord(keys[0]) : defaultCutRecord());
  const settings = settingsPart(rec);
  if (cutTypeHasParam(type, 'cutDepth') && keys.length && keys.every((k) => sourceDepth(k) !== undefined)) settings.cutDepth = 'model';
  const draft = { type, settings, geometry: keys.map((key) => ({ key, seq: takeSeq() })) };
  const op = placeNew(state, draft);
  settleOrder(state);
  return op;
}
/** TASK S2: the STOCK pick keeps the one-Stock move of before (task 472): the Stock operation holds the shape `key` alone (a previous Stock operation goes; the shape's
 *  other operations are untouched). Returns { op, moved } (moved = another shape was the Stock); the Stock as it is when `key` already is it. TASK S3: `key` null = an
 *  EMPTY Stock (the toolbar's Stock with nothing selected: a shape click then puts one in), replacing the Stock as a type change to the Stock does (one per document). */
export function setStock(key, state = null) {
  const prev = storeOps().find((op) => op.type === STOCK_TYPE_ID) || null;
  if (key && prev && prev.geometry.length === 1 && prev.geometry[0].key === key) return { op: prev, moved: false };
  const moved = Boolean(prev && prev.geometry.length);
  if (prev) deleteOp(prev);
  const draft = { type: STOCK_TYPE_ID, settings: settingsPart({ ...(key ? freshRecord(key) : defaultCutRecord()), cutType: STOCK_TYPE_ID }), geometry: key ? [{ key, seq: takeSeq() }] : [] };
  const op = placeNew(state, draft);
  settleOrder(state);
  return { op, moved };
}
/** TASK S2: change an operation's type (allowed when every shape can take it: typeRefusal; the card greys it otherwise). Its id, tick, place and shapes are kept, its
 *  settings too, plus what the type starts with (startRecord; a Contour starts from the last Contour's). To the Stock: it becomes the one Stock (another goes). */
export function changeOpType(op, type, state = null) {
  if (op.type === type) return op;
  if (type === STOCK_TYPE_ID) for (const o of storeOps().filter((x) => x !== op && x.type === STOCK_TYPE_ID)) deleteOp(o);
  const rec = startRecord(type, { cutType: op.type, ...op.settings });
  setOpType(op, type);
  setOpSettings(op, settingsPart(rec));
  settleOrder(state);
  return op;
}
/** TASK S2: set an operation's settings (`patch`: field -> value, base mm): they apply to ALL its shapes. A typed depth equal to every shape's imported depth is stored 'model' (as since S1). TASK 822: a tab count set (a number or Auto)
 *  lays the tabs out again: every shape's dragged tabs (`tabsAt`) are dropped. */
export function setOpFields(op, patch, state = null) {
  const rest = { ...patch };
  // TASK S2 (owner turns 2730-2731): a Depth set back to the model (null: a Roughing's / Contour's Bottom emptied or Reset) = 'model' where every shape has an imported
  // depth, else unset (a part's own levels / slope depth)
  if (Object.hasOwn(rest, 'cutDepth') && rest.cutDepth === null) rest.cutDepth = op.geometry.length && op.geometry.every((r) => sourceDepth(r.key) !== undefined) ? 'model' : 'unset';
  if (Object.keys(rest).length) setOpSettings(op, { ...op.settings, ...rest });
  if (Object.hasOwn(rest, 'tabCount')) for (const ref of op.geometry) if (Object.hasOwn(ref, 'tabsAt')) setRefTabsAt(ref, undefined); // TASK 822
  if (Object.hasOwn(rest, 'cutDepth')) normalizeDepth(op);
  settleOrder(state);
  return op;
}
/** TASK 822: the dragged tabs of ONE membership (its tab handles): every tab's centre as a perimeter fraction of its outline (#core/hold-part holdTabDragAt `at`). */
export function setShapeTabsAt(op, key, tabsAt, state = null) {
  const ref = op.geometry.find((r) => r.key === key);
  if (ref) setRefTabsAt(ref, tabsAt);
  settleOrder(state);
}
/** TASK S2: put the shape `key` into the operation (a new membership: the next file place); false when it is already in it. */
export function addShapeToOp(op, key, state = null) {
  if (op.geometry.some((r) => r.key === key)) return false;
  addRef(op, { key, seq: takeSeq() });
  settleOrder(state);
  return true;
}
/** TASK S2: take the shape `key` out of the operation (the operation stays, possibly empty; the shape stays in its other operations). */
export function removeShapeFromOp(op, key, state = null) {
  const ref = op.geometry.find((r) => r.key === key);
  if (!ref) return false;
  removeRef(op, ref);
  settleOrder(state);
  return true;
}
/** TASK S2 (owner turns 2710-2712, "I usually copy a toolpath and differentiate them separately", as Fusion's Duplicate): a NEW operation with the same type, settings,
 *  tick and shapes (each a new membership: the next file place, its dragged tabs kept), placed right after the original while the list order is the
 *  user's ('stored'), else by the default rule. Returns the copy. */
export function duplicateOperation(op, state = null) {
  const draft = { type: op.type, settings: { ...op.settings }, geometry: op.geometry.map((r) => ({ key: r.key, seq: takeSeq(), ...(Array.isArray(r.tabsAt) ? { tabsAt: [...r.tabsAt] } : {}) })) };
  const at = listOrder() === 'stored' ? storeOps().indexOf(op) + 1 : newOpPlace(state, draft).index; // (the default order: settleOrder below, or when the ranks are generated)
  const copy = insertOp(at, draft);
  if (op.on === false) setOpsOn([copy.id], false);
  settleOrder(state);
  return copy;
}
/** TASK S2: the bin: delete the operation (its shapes stay in their other operations). */
export function deleteOperation(op, state = null) {
  deleteOp(op);
  settleOrder(state);
}

// TASK 714: the STEP DEPTH a target switched to a stepped type gets when its record has none: the last step depth the user set on any stepped
// cut (owner turn 1947), STEP_DEPTH.defaultMm (#core/stepped-cut.js) until one is set. Base mm. App state, like the plan.
let lastStep = STEP_DEPTH.defaultMm;
export const lastStepDepth = () => lastStep;
export function rememberStepDepth(mm) { const n = Number(mm); if (n > 0) lastStep = n; return lastStep; }
// TASK 717: ADAPTIVE stepping, per record (`adaptiveSteps`, default OFF) with its RESOLUTION (`stepDeviation`, base mm, #core STEP_RESOLUTION): the last
// values set on any stepped cut are the next record's (switched to a stepped type) defaults, as for the step depth.
let lastAdaptive = false;
let lastDeviation = STEP_RESOLUTION.defaultMm;
export const lastAdaptiveSteps = () => lastAdaptive;
export function rememberAdaptiveSteps(on) { lastAdaptive = on === true; return lastAdaptive; }
export const lastStepDeviation = () => lastDeviation;
export function rememberStepDeviation(mm) { const n = Number(mm); if (n > 0) lastDeviation = n; return lastDeviation; }
/**
 * steppedSummary(storedRec) — TASK 714: what a STEPPED record's terraces are (the same steppedTerraces call #core/stepped-cut deriveCuts makes, through
 * the effective record): { count, depths (base mm, shallow to deep), undercutBelow (mm | null), label, error, deviation (TASK 717: the adaptive
 * resolution, base mm, or null when the steps are every Step depth) }, or null for any other record.
 */
export function steppedSummary(storedRec) {
  const rec = effectiveCutRecord(storedRec);
  if (!rec || !rec.terraceAs || !rec.slope) return null;
  const T = steppedTerraces(rec.slope, terraceOptions(rec));
  return { count: T.steps.length, gaps: stepGaps(T.steps), depths: T.steps.map((st) => st.depth), undercutBelow: T.undercutBelow, label: rec.slope.label || null, error: T.error, deviation: T.deviation ?? null };
}
// TASK 742: HOLD PART. The last tab count / width / thickness set on any record are the next record's when its Hold part is first turned on (null = never set:
// the declared default of the document unit, #core/hold-part holdDefaults; count Auto). App state, like the step depth above.
let lastTabCountV = 'auto', lastTabWidthV = null, lastHoldThicknessV = null;
export const lastTabCount = () => lastTabCountV;
export function rememberTabCount(v) { if (v === 'auto' || Number(v) >= 1) lastTabCountV = v === 'auto' ? 'auto' : Math.floor(Number(v)); return lastTabCountV; }
export const lastTabWidth = () => lastTabWidthV ?? holdDefaults(docUnit()).tabWidth;
export function rememberTabWidth(mm) { const n = Number(mm); if (n > 0) lastTabWidthV = n; return lastTabWidth(); }
export const lastHoldThickness = () => lastHoldThicknessV ?? holdDefaults(docUnit()).thickness;
export function rememberHoldThickness(mm) { const n = Number(mm); if (n > 0) lastHoldThicknessV = n; return lastHoldThickness(); }

/**
 * holdSummary(key, storedRec, state, loops, loopPolys, owned) — TASK 742: what a record's Hold part does, read off THE derivation (deriveCuts through
 * the effective record, as Prepare / Review / the export cut it): the `hold` of its outline cut (#core/hold-part applyHoldPart: role 'pass' with
 * depth / count / requested ..., or 'refused' with its error), or null when the record holds nothing.
 */
export function holdSummary(key, storedRec, state, loops, loopPolys, owned) {
  const rec = effectiveCutRecord(storedRec);
  if (holdMode(rec) === 'off') return null;
  const cuts = deriveCuts(parseKey(key), rec, state, loops, loopPolys, owned) || [];
  const c = cuts.find((x) => x.hold && x.hold.role !== 'strip');
  return c ? c.hold : null;
}
const HOLD_REFUSED = {
  'no cut depth': 'set a cut depth first',
  'open chain': 'tabs need a closed outline: this is an open line', // TASK 775: an On line cut's tabs
  'no thickness': 'set a thickness',
  'no tab width': 'set a tab width',
  thickness: 'nothing to hold',
  outline: 'the outline could not be read',
  strip: 'the outline is too tight for the gap strips here (or the offset is wider than the strip allows)',
};
/**
 * holdNoteItems(storedRec, hold) — TASK 742: the card note of a held record (doc unit), from its holdSummary: "Outside: 4 tabs, 10 mm wide, 2 mm thick:
 * 1 pass at 16 mm + 4 gaps at 18 mm", then "Gaps: cut the side against the part; the return leg is optional"; an onion skin "Outside: onion skin 2 mm:
 * 1 pass at 16 mm"; fewer tabs than asked: "only 2 of 4 tabs fit" (warning colour); a refused hold says why (warning colour; the cut is made without it). TASK 822:
 * tabs kept off the stretches where a gap strip does not fit (hold.narrow) say so (warning colour): "only 4 of 5 tabs fit: part of the outline is too narrow for
 * a gap strip", or with every tab placed "placed where a gap strip fits: part of the outline is too narrow for one".
 */
export function holdNoteItems(storedRec, hold) {
  if (!hold || !storedRec) return [];
  // each length's text is lengthText's (the one decider, TASK 728: an inch fraction in Fractional); the unit is written after it. TASK 757: at the card's precision
  // (3 decimals while Length precision is Auto, as its tab width / thickness / depth fields and the Operations list show them: "0.063 in thick", not 0.0625)
  const u = docUnit(), f = (mm) => lengthText(mm, { unit: u, show: 'field' });
  const name = (cutTypeById(storedRec.cutType) || {}).menuLabel || 'Cut';
  const what = hold.mode === 'skin' ? 'onion skin' : 'tabs';
  if (hold.role === 'refused') {
    const why = hold.error === 'thickness' ? `${hold.mode === 'skin' ? 'skin' : 'tab'} thickness ${f(hold.thickness)} ${u} is not less than the cut depth ${f(Number(hold.fullDepth))} ${u}: nothing to hold`
      : hold.error === 'no room' ? `no straight or curved stretch is long enough for a ${f(hold.width)} ${u} tab`
      : hold.error === 'tab narrow' ? `the tab width ${f(hold.width)} ${u} is not wider than the ${f(hold.toolDia)} ${u} bit: no wood would stay` // TASK 775
      : hold.error === 'offset' ? (hold.written > 0 // TASK 787: the Origin offsets every gap's ends by the cut offset: the gaps are laid out round tabs of the tab width - 2 x the offset
        ? `with the ${f(hold.offset)} ${u} offset each tab needs ${f(hold.written)} ${u} of outline (the tab width - 2 x the offset) and they do not fit`
        : `the ${f(hold.offset)} ${u} offset is half the ${f(hold.width)} ${u} tab width or more: no tab would stay`)
      : HOLD_REFUSED[hold.error] || hold.error;
    const text = `${name}: ${what} refused: ${why}; cut without them`;
    return [{ text, warn: text.slice(name.length + 2), title: 'Hold part is not applied to this cut' }];
  }
  if (hold.mode === 'skin') return [{ text: `${name}: onion skin ${f(hold.thickness)} ${u}: 1 pass at ${f(hold.depth)} ${u}` }];
  if (hold.role === 'stroke') { // TASK 775: an On line cut's tabs: the gaps between its strokes are left uncut (the owner's wording)
    const n = hold.count, items = [{ text: `Tabs: ${n} gap${n === 1 ? '' : 's'} of ${f(hold.width)} ${u} left uncut; cut them by hand afterwards` }];
    if (n < hold.requested) { const t = `Only ${n} of ${hold.requested} tabs fit`; items.push({ text: t, warn: t, title: 'the outline has too few stretches long enough for a tab' }); } // TASK 825 (V1): its own warning line (the card lists warnings first), not the tail of the long first line
    items.push({ text: `Each gap keeps ${f(hold.left)} ${u} of wood with a ${f(hold.toolDia)} ${u} bit (the gap minus the bit)` });
    return items;
  }
  const n = hold.count, gaps = `${n} gap${n === 1 ? '' : 's'}`;
  const items = [{ text: `${name}: ${n} tab${n === 1 ? '' : 's'}, ${f(hold.width)} ${u} wide, ${f(hold.thickness)} ${u} thick: 1 pass at ${f(hold.depth)} ${u} + ${gaps} at ${f(Number(hold.fullDepth))} ${u}` }];
  if (hold.narrow) { // TASK 822: tabs kept off the stretches too narrow for a gap strip (a stem, a neck); TASK 825: its words are a warning line of their own (the card lists warnings first)
    const t = n < hold.requested ? `Only ${n} of ${hold.requested} tabs fit: part of the outline is too narrow for a gap strip` : 'Placed where a gap strip fits: part of the outline is too narrow for one';
    items.push({ text: t, warn: t, title: 'a gap strip needs the strip width clear beside the outline' });
  } else if (n < hold.requested) { const t = `Only ${n} of ${hold.requested} tabs fit`; items.push({ text: t, warn: t, title: 'the outline has too few stretches long enough for a tab' }); } // TASK 825 (V1): its own warning line (the card lists warnings first), not the tail of the long first line
  items.push({ text: `Gaps: cut the side against the part; the return leg is optional`, once: true }); // TASK 839: the same for every operation (planNotes: once)
  return items;
}
/** TASK 742: the hold note items of every held record of the plan (the 3D Review's info, through planNotes; TASK 798: `opts` = planRecords' { ticked }). */
function planHoldNoteItems(state, opts) {
  const out = [];
  let geo = null;
  for (const [key, rec] of planRecords(opts)) {
    if (!rec || !rec.cutType || holdMode(effectiveCutRecord(rec)) === 'off') continue;
    if (!geo) { const { loops, loopPolys } = loopsWithPolygons(state); geo = { loops, loopPolys, owned: planOwnedLoops(state, loops, loopPolys) }; }
    out.push(...holdNoteItems(rec, holdSummary(key, rec, state, geo.loops, geo.loopPolys, geo.owned)));
  }
  return out;
}

/** TASK 777: the short note line for an open toolpath (e.g. Loop-off programmed clearing). */
export const OPEN_PATH_AUTOPASS_NOTE = 'AutoPass runs back along it on the next pass';

// TASK 745: the PROGRAMMED POCKET. The last stepover / finish allowance / raster angle / Loop (TASK 750) set on any record are the next record's when its
// Clearing is first set to a computed pattern (null = never set: the declared default, #core POCKET_CLEARING; the allowance by document unit; Loop off).
// A new pocket's Clearing is Freehand (the default). App state, like the step depth above.
let lastStepoverV = POCKET_CLEARING.stepoverPct.default, lastAllowanceV = null, lastRasterAngleV = POCKET_CLEARING.rasterAngle, lastLoopV = false;
export const lastStepover = () => lastStepoverV;
export function rememberStepover(pct) { const n = Number(pct); if (n > 0) lastStepoverV = n; return lastStepoverV; }
export const lastFinishAllowance = () => lastAllowanceV ?? allowanceDefault(docUnit());
export function rememberFinishAllowance(mm) { const n = Number(mm); if (Number.isFinite(n) && n >= 0) lastAllowanceV = n; return lastFinishAllowance(); }
export const lastLoop = () => lastLoopV;
export function rememberLoop(on) { lastLoopV = on === true; return lastLoopV; }
export const lastRasterAngle = () => lastRasterAngleV;
export function rememberRasterAngle(deg) { const n = Number(deg); if (Number.isFinite(n)) lastRasterAngleV = n; return lastRasterAngleV; }

/**
 * clearingSummary(key, storedRec, state, loops, loopPolys, owned) — TASK 745: what a programmed pocket's clearing is, read off THE derivation (deriveCuts through
 * the effective record, as Prepare / Review / the export cut it): the plan carried by its wall cut ({ pattern, levels, passes, turns, length, leftover,
 * settings, depths, ... }: #core/pocket-clearing applyPocketClearing), or for a refused one the pocket cut's { refused, summary }; null when the record is Freehand.
 * TASK 817: read off the GENERATED paths (pathsOf; `ctx` = a reading pass, `request` false = a peek): undefined while they are not there.
 */
export function clearingSummary(key, storedRec, state, loops, loopPolys, owned, { ctx = null, request = true } = {}) {
  const rec = effectiveCutRecord(storedRec);
  if (clearingPattern(rec) === 'freehand') return null;
  const d = pathsOf(key, storedRec, ctx || pathsCtx(state, { loops, loopPolys, owned }), { request }); // TASK 817: the generated paths (the same derivation)
  if (d === undefined) return undefined; // not generated (yet): no note
  const cuts = d ? d.cuts : [];
  const c = cuts.find((x) => x.clearing && x.clearing.summary); // the wall cut, a refused pocket, or (TASK 749) a Spiral's last line when its wall is in the line
  return c ? { ...c.clearing.summary, refused: c.clearing.role === 'refused' ? c.clearing.refused : null } : null;
}
/** TASK 745: why the Morphed spiral is not possible on a target ({ morphed: null | 'islands' | 'splits' | another refusal }) for its record's settings, or null
 *  for a target that is not a pocket region. */
export function clearingAvailability(key, storedRec, state, loops, loopPolys) {
  const rec = effectiveCutRecord(storedRec);
  if (!rec || rec.cutType !== 'pocket') return null;
  const pocket = (deriveProfileCuts(parseKey(key), rec, state, loops, loopPolys) || []).find((c) => c.isCompound);
  return pocket ? { morphed: morphedBlocker(pocket, rec, state) } : null;
}
/** TASK 745: the words of a refusal / a disabled choice. */
export const CLEARING_REFUSED = {
  islands: 'has islands: use Spiral or Raster',
  // TASK 804: a pocket whose rings split is no longer refused (one morphed spiral per area); what remains refused says what really happens
  area: 'the morphed turns of one area would cross each other: use Spiral or Raster',
  'morphed islands': 'has islands: use Spiral or Raster',
  'morphed area': 'the morphed turns of one area would cross each other: use Spiral or Raster',
  'raster join': 'a raster pass cannot be joined to the next inside the pocket; cut as open passes + the wall',
  'loop cross': 'its way back would cross the turns on this shape; cut as open paths + the wall', // TASK 804: never a crossing loop
  'islands close': 'an island is closer to the wall or to another island than the bit: the finish pass would cut it',
  'bit too big': 'the bit does not fit in the pocket',
  'no bit': 'set a bit diameter',
  outline: 'the outline could not be read',
};
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
/** TASK 745: a pocket's clearing in a few words: "spiral, 12 turns in 1 line + wall" (TASK 749; several lines say why: "spiral, 14 turns in 3 lines (the
 *  pocket has islands) + wall"), "raster 0°: 22 passes + 1 ring + wall", "morphed spiral: 13 turns + wall"; TASK 750 Loop on: the turns + wall, then
 *  "one closed loop" ("3 closed loops (the pocket has islands)"; TASK 775: a closed loop has no start point on the Origin, so nothing says where it
 *  starts or ends). */
const LINES_WHY = { splits: ' (the pocket narrows: one per area)', islands: ' (the pocket has islands)' }; // TASK 804: "one per area"
export function clearingWords(sum) {
  if (!sum || sum.refused) return null;
  const what = sum.pattern === 'raster' ? `raster ${angleText(Number(sum.settings.angle), { show: 'deg' })}: ${plural(sum.passes, 'pass', 'passes')} + ${plural(sum.cleanup, 'ring', 'rings')}`
    : sum.pattern === 'morphed' ? `morphed spiral: ${plural(sum.turns, 'turn', 'turns')}${!sum.loop && sum.lines > 1 ? ` in ${sum.lines} paths${sum.linesWhy ? LINES_WHY[sum.linesWhy] : ''}` : ''}` // TASK 804: one per area
    : `spiral, ${plural(sum.loops, 'turn', 'turns')}${sum.loop ? '' : ` in ${plural(sum.lines, 'line', 'lines')}${sum.linesWhy ? LINES_WHY[sum.linesWhy] : ''}`}`;
  if (!sum.loop) return `${what} + wall`;
  const why = sum.linesWhy && sum.loopCount > 1 ? LINES_WHY[sum.linesWhy] : '';
  return `${what} + wall: ${sum.loopCount === 1 ? 'one closed loop' : `${sum.loopCount} closed loops${why}`}`;
}
// an area (mm²) in the document unit's area rule: mm² (under 1 cm²) / cm², or in²; formatted with the ONE length precision rule
export function areaText(mm2, u) {
  return u === 'in' ? coreAreaText(mm2, { unit: 'in' }) : coreAreaText(mm2, { unit: mm2 < 100 ? 'mm' : 'cm' });
}
/**
 * clearingNoteItems(storedRec, sum) — TASK 745: the card note of a programmed pocket (doc unit), from its clearingSummary: "Pocket: spiral, 12 turns in 1 line + wall, stepover
 * 2.4 mm, 3.4 m of path, about 4 min at 1000 mm/min" (the path = every clearing path at every depth pass + the finish pass; the time at the declared feed
 * POCKET_CLEARING.feedMmPerMin), the depth passes, then "Drawn for a 6 mm bit: a smaller bit leaves ridges" (the rings follow the card's bit; the wall does
 * not), then the leftover (warning colour) "7.8 mm² not reached by a 6 mm bit (sharp inside corners, necks narrower than the bit)" (or how much the pattern
 * missed); a refused clearing says why (warning colour; the pocket is cut Freehand).
 */
export function clearingNoteItems(storedRec, sum) {
  if (!sum || !storedRec) return [];
  const u = docUnit(), f = (mm) => lengthText(mm, { unit: u, show: 'field', fractions: false });
  const label = (POCKET_CLEARING.patterns.find((p) => p.id === clearingPattern(effectiveCutRecord(storedRec))) || {}).label || 'Clearing';
  if (sum.refused) {
    const text = `Pocket: ${label} refused: ${CLEARING_REFUSED[sum.refused] || sum.refused}; cut as Freehand`;
    return [{ text, warn: text.slice('Pocket: '.length), title: 'the clearing is not programmed: the Origin clears this pocket by hand' }];
  }
  const st = sum.settings, bit = `${lengthText(st.toolDia, { unit: u, show: 'field' })} ${u}`; // the bit as its field shows it
  const total = sum.length + (sum.finishLength || 0);
  const pathWords = u === 'in' ? `${(total / 304.8).toFixed(1)} ft` : `${(total / 1000).toFixed(1)} m`;
  const feed = u === 'in' ? `${Math.round(POCKET_CLEARING.feedMmPerMin / 25.4)} in/min` : `${POCKET_CLEARING.feedMmPerMin} mm/min`;
  const minutes = total / POCKET_CLEARING.feedMmPerMin;
  const items = [{ text: `Pocket: ${clearingWords(sum)}, stepover ${f(st.stepover)} ${u}, ${pathWords} of path, about ${minutes < 1 ? 1 : Math.round(minutes)} min at ${feed}` }];
  // TASK 839: `once` = a line that says the same for every operation (the bit's, the Origin's): the 3D Review's info writes it once (planNotes)
  if (sum.clear.length) items.push({ text: `Drawn for a ${bit} bit: a smaller bit leaves ridges`, once: true });
  if (sum.loop) items.push({ text: `Wall cut in the same line: exact for a ${bit} bit only`, once: true }); // TASK 750: the Origin does not offset an on-line path
  if (sum.loopRefused) { const t = `Loop refused: ${CLEARING_REFUSED[sum.loopRefused] || sum.loopRefused}`; items.push({ text: t, warn: t, title: 'the pocket is cut with open paths + the Origin\'s inside cut on the wall' }); }
  items.push({ text: 'Depth passes: set Pass Depth or AutoPass on the Origin', once: true }); // TASK 750: the clearing is written once, at the full depth
  if (!sum.loop && Array.isArray(sum.clear) && sum.clear.some((c) => !c.closed)) items.push({ text: OPEN_PATH_AUTOPASS_NOTE, once: true }); // TASK 777: open clearing paths reverse on AutoPass
  const lo = sum.leftover;
  if (lo && lo.area > POCKET_CLEARING.leftoverTolMm2) {
    // TASK 825 (V1): the warning is the leftover itself (two lines on the card); WHY it is left is the line after it (the card's area is three lines: a four-line warning was cut)
    const t = `${areaText(lo.area, u)} not reached by a ${bit} bit`;
    items.push({ text: `Leftover: ${t}`, warn: t, title: 'material the bit does not reach (orange in Prepare)' });
    const why = lo.missed > POCKET_CLEARING.leftoverTolMm2 ? `${areaText(lo.missed, u)} of it missed between passes: lower the stepover` : 'Sharp inside corners, necks narrower than the bit';
    items.push({ text: why, warn: why, title: 'material the bit does not reach (orange in Prepare)' }); // a warning line too: it stays right under the leftover
  }
  return items;
}
/** TASK 745: the clearing note items of every programmed pocket of the plan (the 3D Review's info, through planNotes; TASK 798: `opts` = planRecords' { ticked }). */
function planClearingNoteItems(state, opts) {
  const out = [];
  let geo = null;
  for (const [key, rec] of planRecords(opts)) {
    if (!rec || !rec.cutType || clearingPattern(effectiveCutRecord(rec)) === 'freehand') continue;
    if (!geo) { const { loops, loopPolys } = loopsWithPolygons(state); geo = { loops, loopPolys, owned: planOwnedLoops(state, loops, loopPolys) }; geo.ctx = pathsCtx(state, geo); }
    out.push(...clearingNoteItems(rec, clearingSummary(key, rec, state, geo.loops, geo.loopPolys, geo.owned, { ctx: geo.ctx })));
  }
  return out;
}

/** Outlines closer than this (base mm, 1/16 in) are flagged on the card: hard to pick one by one on the Origin (advisor hint, owner may remove). */
export const CLOSE_OUTLINES_MM = 25.4 / 16;
/**
 * The note of a stepped record as items { text, warn?, title? } (the card shows `warn` in the warning colour with `title`; `text` is the whole line,
 * what the 3D Review's info shows). Doc unit. "Pocket 1 (8mm): 8 steps, 1 to 8 mm · outlines 0.18 mm apart" (one value when
 * evenly spaced, "min–max" otherwise), then "undercut below ..." when there is one. TASK 717, adaptive stepping: "Pocket 1 (8mm): adaptive,
 * Medium (0.25 mm): 7 steps at 6.19 · 6.69 · 7.07 · 7.39 · 7.67 · 7.93 · 8 mm · outlines 0.21–0.5 mm apart" (the level's name, or Custom).
 */
export function steppedNoteItems(storedRec) {
  const s = steppedSummary(storedRec);
  if (!s) return [];
  // the text of each length is lengthText's (the one decider); the unit is written once after the list. g: adaptive depths, gTol: the resolution and the
  // outline spacing (tolerances finer than any inch fraction: always decimals)
  const u = docUnit(), f = (mm) => lengthText(mm, { unit: u, show: 'field' });
  const name = s.label || (cutTypeById(storedRec.cutType) || {}).menuLabel || 'Stepped cut';
  if (s.error) return [{ text: `${name}: the slope could not be read (${s.error}): nothing is cut` }];
  const n = `${s.count} step${s.count === 1 ? '' : 's'}`;
  const g = f;
  const gTol = (mm) => lengthText(mm, { unit: u, show: 'field', fractions: false });
  const item = { text: s.deviation === null
    ? `${name}: ${n}, ${s.count > 1 ? `${f(s.depths[0])} to ` : ''}${f(s.depths[s.depths.length - 1])} ${u}`
    : `${name}: adaptive, ${(resolutionLevel(s.deviation) || { label: 'Custom' }).label} (${gTol(s.deviation)} ${u}): ${n} at ${s.depths.map(g).join(' \u00b7 ')} ${u}` };
  if (s.gaps.length) {
    const lo = Math.min(...s.gaps), hi = Math.max(...s.gaps);
    const spacing = ` \u00b7 outlines ${gTol(lo) === gTol(hi) ? gTol(lo) : `${gTol(lo)}\u2013${gTol(hi)}`} ${u} apart`;
    item.text += spacing;
    if (lo < CLOSE_OUTLINES_MM - 1e-9) { item.warn = spacing; item.title = `outlines this close may be hard to pick on the Origin: try a ${s.deviation === null ? 'bigger step' : 'coarser resolution'}`; } // TASK 717: adaptive has no step
  }
  const items = [item];
  if (s.undercutBelow !== null) items.push({ text: `${name}: undercut below ${f(s.undercutBelow)} ${u} cut straight` });
  return items;
}
/** The note lines (text) of a stepped record. */
export const steppedNoteLines = (storedRec) => steppedNoteItems(storedRec).map((i) => i.text);
/** The note lines of every stepped record of the plan (the 3D Review's info; TASK 798: `opts` = planRecords' { ticked }). */
export function planSteppedNotes(opts) {
  const out = [];
  for (const [, rec] of planRecords(opts)) if (rec && rec.cutType) out.push(...steppedNoteLines(rec));
  return out;
}

// The entries of a STORED v2 plan map (the v2 migration's: shaper-doc.js; a Contour record resolved against its part's record in the same map), as the
// derivation takes them. Loop targets are resolved against the live design (findLoops), so a stale id simply yields nothing.
export function v2PlanEntries(plan) {
  const out = [];
  for (const [key, rec] of plan) {
    if (!rec || !rec.cutType) continue;
    if (!isContourKey(key)) { out.push({ key, target: parseKey(key), rec: v2WithBoundaryTarget(rec, plan) }); continue; }
    const pk = partKeyOf(key), part = plan.get(pk);
    if (part && part.cutType) out.push({ key, target: parseKey(pk), rec: { ...rec, baseDepth: part.cutDepth, baseType: part.cutType, ...(part.slope ? { slope: part.slope } : {}), ...(part.levels ? { levels: part.levels } : {}) } });
  }
  return out;
}
function v2WithBoundaryTarget(rec, plan) {
  if (!rec || !(cutTypeById(rec.cutType) || {}).levelsOp || !hasLevels(rec)) return rec;
  const b = boundaryOf(rec);
  const key = b.kind === 'stock' ? [...plan].find(([, r]) => r && r.cutType === STOCK_TYPE_ID)?.[0] : b.kind === 'shape' ? b.shape : null;
  return key ? { ...rec, boundaryTarget: parseKey(key) } : rec;
}

/**
 * levelsSummary(key, storedRec, state, loops, loopPolys, owned, plan) — TASK 792: what a Roughing / Contour record cuts, read off THE derivation (deriveCuts
 * through the effective record, as Prepare / Review / the export cut it): { op, source ('levels' | 'slope' | 'drawn'), depths (base mm, shallow to deep),
 * passes (cuts written), allowance, islands / small (Roughing from levels: the most material islands left standing on one level, and those narrower than
 * the bit), toolDia }, or null for any other record (or a Contour whose part has no cut type). TASK 817: read off the GENERATED paths (itemOf; `ctx` = a reading
 * pass, `request` false = a peek): undefined while they are not there.
 */
export function levelsSummary(key, storedRec, state, loops, loopPolys, owned, { ctx = null, request = true } = {}) {
  const e = storedRec && storedRec.cutType ? resolveEntry(key, storedRec) : null;
  const rec = e ? effectiveCutRecord(e.rec) : null;
  if (!rec || !rec.levelsOp) return null;
  const item = itemOf(key, storedRec, ctx || pathsCtx(state, { loops, loopPolys, owned }), { request }); // TASK 817: the generated paths and level facts (the same derivation)
  if (item === undefined) return undefined; // not generated (yet): no note
  const cuts = item.paths ? item.paths.cuts : [];
  const depthOf = (c) => Number(c.terrace ? c.terrace.depth : c.rec && c.rec.cutDepth);
  const depths = [...new Set(cuts.map(depthOf).filter(Number.isFinite))].sort((a, b) => a - b);
  const perLevel = new Map();
  for (const c of cuts) if (c.terrace && c.terrace.islands != null) perLevel.set(c.terrace.depth, { islands: c.terrace.islands, small: c.terrace.small });
  const worst = [...perLevel.values()].reduce((m, v) => (v.islands > m.islands ? v : m), { islands: 0, small: 0 });
  // TASK 792 / 810: a Roughing from levels, as its cuts were made (#core levelsRoughingFor: its boundary): the bands the Min terrace width leaves, and why it has nothing to cut
  // (TASK 817: op-derive.js levelsFacts, generated with its cuts)
  const f = item.levels || { bandEmpty: false, thin: 0, roughingError: null };
  const thin = f.thin;
  const refused = f.bandEmpty ? 'band' : f.roughingError && ROUGHING_REFUSED[f.roughingError] ? f.roughingError : null;
  return { op: rec.levelsOp, layout: roughLayout(rec), source: hasLevels(rec) ? 'levels' : rec.slope ? 'slope' : 'drawn', depths, passes: cuts.length, allowance: roughingAllowance(rec), islands: worst.islands, small: worst.small, thin, minWidth: Number(rec.minTerraceWidth) || 0, toolDia: Number(rec.toolDia) || 0, refused };
}
/**
 * levelsNoteItems(storedRec, sum) — TASK 792: the card note of a Roughing / Contour record (doc unit), from its levelsSummary: "Roughing: 4 levels, 1 to
 * 7.05 mm" (a sloped region's Roughing keeps the stepped note of TASKS 714-717, steppedNoteItems), "Roughing: 0.5 mm left on every wall for the Contour",
 * "Roughing: up to 36 islands left standing (12 narrower than the 6.35 mm bit)", "Contour: 24 levels, 0.25 to 7.05 mm: 61 passes along the walls". An
 * empty derivation says so in the warning colour.
 */
export function levelsNoteItems(storedRec, sum) {
  if (!sum || !storedRec) return [];
  const u = docUnit(), f = (mm) => lengthText(mm, { unit: u, show: 'field' });
  const name = sum.op === 'contour' ? 'Contour' : 'Roughing';
  if (sum.refused) { const t = `${name}: nothing to cut: ${ROUGHING_REFUSED[sum.refused]}`; return [{ text: t, warn: t.slice(name.length + 2) }]; } // TASK 810: the boundary's reason
  if (!sum.depths.length) { const t = `${name}: nothing to cut (no level, or the part has no depth)`; return [{ text: t, warn: t.slice(name.length + 2), title: 'set the part\u2019s depth' }]; }
  const items = [];
  const n = sum.depths.length, span = `${n > 1 ? `${f(sum.depths[0])} to ` : ''}${f(sum.depths[n - 1])} ${u}`;
  if (sum.op === 'contour') items.push({ text: `Contour: ${n} level${n === 1 ? '' : 's'}, ${span}: ${sum.passes} pass${sum.passes === 1 ? '' : 'es'} along the walls` });
  else {
    if (sum.source !== 'slope') items.push({ text: `Roughing: ${n} level${n === 1 ? '' : 's'}, ${span}${sum.source === 'levels' ? `, ${sum.layout === 'nested' ? 'nested' : 'terraces'}: ${sum.passes} path${sum.passes === 1 ? '' : 's'}` : ''}` }); // TASK 792: the layout and its paths
    if (sum.allowance > 0) items.push({ text: `Roughing: ${f(sum.allowance)} ${u} left on every wall for the Contour` });
    if (sum.thin > 0) items.push({ text: `Roughing: ${sum.thin} band${sum.thin === 1 ? '' : 's'} narrower than ${f(sum.minWidth)} ${u} left uncut` }); // TASK 792: the Min terrace width
    if (sum.source === 'levels' && sum.islands > 1) items.push({ text: `Roughing: up to ${sum.islands} raised areas left standing on a level${sum.small ? ` (${sum.small} narrower than the ${f(sum.toolDia)} ${u} bit)` : ''}` }); // one = the part itself
  }
  return items;
}
/** TASK 792: the notes of every Roughing / Contour record of the plan (the 3D Review's info; a sloped Roughing's stepped note is in planSteppedNotes; TASK 798: `opts` = planRecords' { ticked }). */
function planLevelsNoteItems(state, opts) {
  const out = [];
  let geo = null;
  for (const [key, rec] of planRecords(opts)) {
    if (!rec || !(cutTypeById(rec.cutType) || {}).levelsOp) continue;
    if (!geo) { const { loops, loopPolys } = loopsWithPolygons(state); geo = { loops, loopPolys, owned: planOwnedLoops(state, loops, loopPolys) }; geo.ctx = pathsCtx(state, geo); }
    out.push(...levelsNoteItems(rec, levelsSummary(key, rec, state, geo.loops, geo.loopPolys, geo.owned, { ctx: geo.ctx })));
  }
  return out;
}
/**
 * planNotes(state, opts) — TASK 839: THE one assembly of the 3D Review's info lines: every record's stepped (TASK 714), hold (TASK 742), clearing (TASK 745) and
 * Roughing / Contour (TASK 792) notes, in that order; each record's own lines stay its own (two equal pockets: two lines), a line marked `once` (the same words for
 * every operation: "Depth passes: set Pass Depth or AutoPass on the Origin") is written the first time only. TASK 798: `opts` = planRecords' { ticked }.
 */
export function planNotes(state, opts) {
  const seen = new Set();
  return [...planSteppedNotes(opts).map((text) => ({ text })), ...planHoldNoteItems(state, opts), ...planClearingNoteItems(state, opts), ...planLevelsNoteItems(state, opts)]
    .filter((i) => !i.once || (!seen.has(i.text) && seen.add(i.text))).map((i) => i.text);
}

/**
 * migrateEdgeRecords(loops, chains, plan) → { dropped, moved } (a STORED v2 plan map: the v2 migration's)
 * For each `edge:<shapeId>` key:
 *   - if the shape is in a loop → delete the record and count it;
 *   - if it's in a chain whose `chain:<id>` key has no record → move it there;
 *   - otherwise delete it and count it.
 */
export function migrateEdgeRecords(loops, chains, plan) {
  const loopEdgeIds = new Set();
  for (const l of (loops || [])) {
    for (const eid of (l.edges || [])) loopEdgeIds.add(eid);
  }
  const chainByShapeId = new Map();
  for (const c of (chains || [])) {
    const shapeIds = Array.isArray(c.edges) ? c.edges : (c.shapes || []).map((s) => s.id);
    for (const sid of shapeIds) {
      chainByShapeId.set(sid, c);
    }
  }

  let dropped = 0;
  let moved = 0;

  for (const [key, rec] of [...plan.entries()]) {
    const { kind, id } = parseKey(key);
    if (kind === 'edge') {
      const shapeId = id;
      if (loopEdgeIds.has(shapeId)) {
        plan.delete(key);
        dropped++;
      } else if (chainByShapeId.has(shapeId)) {
        const chain = chainByShapeId.get(shapeId);
        const chainKey = keyOf('chain', chain.id);
        if (!plan.has(chainKey)) {
          plan.set(chainKey, { ...rec });
          moved++;
        } else {
          dropped++;
        }
        plan.delete(key);
      } else {
        plan.delete(key);
        dropped++;
      }
    }
  }

  return { dropped, moved };
}

// The shape ids a loop / chain id names ('loop_' / 'chain_' + its shape ids sorted and joined with '-', #core/loop-finder), split back against the
// document's shape ids (an id may itself hold a '-'): the ids in order, or null when the text is not made of the document's shape ids.
function idsNamedBy(text, shapeIds) {
  const tok = text.split('-'), n = tok.length;
  const back = new Array(n + 1).fill(null);
  back[0] = -1;
  for (let i = 0; i < n; i++) {
    if (back[i] === null) continue;
    for (let j = i + 1; j <= n; j++) if (back[j] === null && shapeIds.has(tok.slice(i, j).join('-'))) back[j] = i;
  }
  if (back[n] === null) return null;
  const out = [];
  for (let j = n; j > 0; j = back[j]) out.unshift(tok.slice(back[j], j).join('-'));
  return out;
}

/**
 * reconcileCutPlan(state, plan) -> { edgeMoved, edgeDropped, kept, removed } — THE reconciliation of a stored cut plan with the
 * document's regions, run ONCE where a Shaper document is read (shaper-doc.js applyShaperDoc, before any reader of the plan: Prepare, the
 * operations list, Export 2D / 3D, Generate / Sync), never on undo snapshots:
 *  - the legacy `edge:<shapeId>` records (migrateEdgeRecords: moved to their chain, or dropped when the shape is in a loop);
 *  - TASK 761 (advisor ruling on the 761 STOP): a bezier is an edge of the loop finder now, so an outline with a bezier that was an OPEN CHAIN when
 *    the plan was saved can be a LOOP. A stored `chain:<id>` record that no longer resolves, where a loop has EXACTLY the chain's shapes (the same
 *    sorted ids: 'chain_X' -> 'loop_X'), MOVES to `loop:<id>` with its settings (On line / Guide are cut on a loop the same way), in its place in
 *    the plan (the operations' first-record order). The stored operation order needs no renaming: an operation key is the tool, cut type and
 *    settings (operations.js opKeyOf), never the target. A stored chain / loop record that no longer resolves for the same cause and has no exact
 *    match (a chain that is now a loop plus open tails; a line loop a bezier now splits) is REMOVED: its shapes all exist and one of them is a
 *    bezier, or an edge of a loop that has a bezier edge. Any other stale record is left as before (it derives to nothing).
 * The counts feed the one notice (cutPlanNotice). Mutates `plan` (order kept).
 */
export function reconcileCutPlan(state, plan) {
  const loops = findLoops(state), chains = findOpenChains(state, loops);
  const { dropped: edgeDropped, moved: edgeMoved } = migrateEdgeRecords(loops, chains, plan);
  const { rename, remove } = staleKeyMoves(state, loops, chains, [...plan.keys()]);
  renamePlanKeys(rename, remove, plan); // TASK 810: the records and the keys they reference
  return { edgeMoved, edgeDropped, kept: rename.size, removed: remove.size };
}
/** TASK S1: the same reconciliation of the STORE (a version 3 document: its geometry keys move through renameGeometry; it holds no legacy edge keys). TASK 832: then
 *  every shape follows its Design edits (followDesign): a document saved before its operations were followed opens on the shapes they cut. */
export function reconcileStore(state) {
  const loops = findLoops(state), chains = findOpenChains(state, loops);
  const keys = [...new Set([...storeOps().flatMap((op) => op.geometry.map((r) => r.key)), ...regionKeys()])];
  const { rename, remove } = staleKeyMoves(state, loops, chains, keys);
  renameGeometry(rename, remove);
  followDesign(state);
  return { edgeMoved: 0, edgeDropped: 0, kept: rename.size, removed: remove.size };
}
/**
 * followDesign(state) -> the number of geometry keys that moved — TASK 832 (owner rulings turns 2955-2965: "this makes the toolpath out of date, but not nothing to
 * cut, simple recalc"): an operation's shapes FOLLOW the Design edits made to them. A loop key names its outline's edges (#core/loop-finder.js); an edit that
 * changes them (a fillet, a point added on a side, a shape snapped or pinned onto it, a shared side deleted, a divider across it) gives the same shape another
 * key: every stored key that is no longer a loop moves to its successors (#core/loop-geometry.js loopSuccessors: the loops that hold its surviving edges and lie
 * in or around its old region), in every operation that has it, with its region data (renameGeometry). A split shape: each piece, at the shape's file place; two
 * shapes of one operation merged into one: one membership. Nothing is ever removed: a key with no successor (its edges deleted, or its outline opened: a side
 * trimmed or made construction) stays as it is, and comes back when the outline is whole again (construction turned off). A pure function of the store and the
 * sketch, run where the plan is read against a sketch that may have been edited since: Prepare built (prepare-stage.js mountPrepare), the Review entered
 * (main.js), an undo / redo step restored (prepare-stage.js restoreCutPlanFromHistory) and a document read (reconcileStore). Not an undo step of its own:
 * the next step's snapshot carries the followed keys.
 */
export function followDesign(state) {
  const keys = [...new Set([...storeOps().flatMap((op) => op.geometry.map((r) => r.key)), ...regionKeys()])].filter((k) => parseKey(k).kind === 'loop');
  if (!keys.length) return 0;
  const live = new Set(findLoops(state).map((l) => l.id));
  const stale = keys.filter((k) => !live.has(parseKey(k).id));
  if (!stale.length) return 0; // nothing edited away: no polygon is sampled
  const { loops } = loopsWithPolygons(state);
  const rename = new Map();
  for (const key of stale) {
    const next = loopSuccessors(parseKey(key).id, state, loops);
    if (next.length) rename.set(key, next.length === 1 ? keyOf('loop', next[0]) : next.map((n) => keyOf('loop', n)));
  }
  renameGeometry(rename);
  followRenames(rename); // TASK S3: a renamed shape's memberships are out of date (generated for the shape before the edit), not new ones
  return rename.size;
}
// the stale chain / loop keys of a plan that move (rename) or go (remove): see reconcileCutPlan
function staleKeyMoves(state, loops, chains, keys) {
  const loopIds = new Set(loops.map((l) => l.id)), chainIds = new Set(chains.map((c) => c.id));
  const has = new Set(keys);
  const shapeById = new Map((state.shapes || []).map((sh) => [sh.id, sh]));
  const shapeIds = new Set(shapeById.keys());
  const isBezier = (id) => (shapeById.get(id) || {}).type === 'bezier';
  const nearBezier = new Set(loops.filter((l) => l.edges.some(isBezier)).flatMap((l) => l.edges)); // the edges of loops that have a bezier edge
  const rename = new Map(), remove = new Set();
  for (const key of keys) {
    const { kind, id } = parseKey(key);
    const stale = (kind === 'chain' && !chainIds.has(id)) || (kind === 'loop' && !loopIds.has(id));
    if (!stale || !id.startsWith(kind + '_')) continue;
    const named = id.slice(kind.length + 1);
    if (kind === 'chain' && loopIds.has('loop_' + named) && !has.has(keyOf('loop', 'loop_' + named))) { rename.set(key, keyOf('loop', 'loop_' + named)); continue; }
    const members = idsNamedBy(named, shapeIds);
    if (members && members.some((m) => isBezier(m) || nearBezier.has(m))) remove.add(key);
  }
  return { rename, remove };
}

/**
 * keepHolesFromOtherSketches(state, plan) -> { keptHoles, lostHoles } (a STORED v2 plan map: the v2 migration's) — TASK 774 (owner turn 2357), run ONCE where a Shaper document SAVED BEFORE
 * the same-sketch hole rule is read (shaper-doc.js applyShaperDoc: a sidecar `version` below 2). Commit 27c00a4 made a derived face's automatic holes
 * same-sketch only (#core/profile-model.js directlyContainedLoops); a stored `loop:<id>` record on a face whose holes were drawn in ANOTHER sketch then
 * derives without them (a Pocket clears through its islands, an Outside plate loses its hole cuts). Such a record keeps the geometry it was saved with:
 * it MOVES (its settings, its place in the plan) to an explicit combined profile with those holes ('profile:<id>', the existing makeProfile, the
 * same as a Combine: visible in Design, Uncombine undoes it), and is counted in `keptHoles` (the one-time notice).
 * The holes the profile gets = the face's holes under the old rule (holesFromAllSketches) that its cut actually used: every hole for a pocket (a
 * stepped pocket too: its islands stay uncut), the holes WITHOUT their own record for any other cut (TASK 711: a hole with its own record is cut
 * by that record only, so it stays out of the profile and its own record keeps resolving to itself).
 * A record whose old holes cannot go into a profile without changing ANOTHER record (a pocket island with its own record, or a hole already in a
 * combined profile: combined profiles never share a loop, resolveProfileViews) is left as it is and counted in `lostHoles` (the notice names it).
 * A record of a face whose holes the rule did not change (no hole in another sketch; or a face a combined profile already covers) is untouched.
 * Mutates `plan` (order kept) and state.profiles. A NEW cut made after the load follows the same-sketch rule.
 */
export function keepHolesFromOtherSketches(state, plan) {
  const { loops, loopPolys } = loopsWithPolygons(state);
  const loopById = new Map(loops.map((l) => [l.id, l]));
  const shapeById = shapeIndexOf(state);
  const owned = ownedLoopIds(v2PlanEntries(plan), state, loops, loopPolys, CUT_TYPES);
  const covered = (loopId) => { const p = resolveProfileForLoop(loopId, state, loops, loopPolys, { shapeById }); return !!p && !p.isDerived; };
  const rename = new Map();
  let lostHoles = 0;
  for (const [key, rec] of plan) {
    const { kind, id } = parseKey(key);
    if (kind !== 'loop' || !rec || !rec.cutType || !loopById.has(id)) continue;
    const now = resolveProfileForLoop(id, state, loops, loopPolys, { shapeById });
    if (!now || !now.isDerived) continue; // a combined profile covers it: the hole rule never applied
    const before = derivedProfileForLoop(id, loops, loopPolys, state, { holesFromAllSketches: true });
    const t = cutTypeById(rec.cutType);
    const pocket = ((t && t.terraceAs) || rec.cutType) === 'pocket';
    const used = (ids) => (pocket ? ids : ids.filter((h) => !owned.has(h)));
    const holes = used(before.inners);
    const nowHoles = used(now.inners);
    if (holes.length === nowHoles.length && holes.every((h) => nowHoles.includes(h))) continue; // the cut is the same under both rules
    if (holes.some((h) => covered(h) || (pocket && owned.has(h)))) { lostHoles++; continue; }
    const prof = makeProfile(state, loopById.get(id), holes.map((h) => loopById.get(h)));
    rename.set(key, keyOf('profile', prof.id));
  }
  renamePlanKeys(rename, new Set(), plan); // TASK 810: the records and the keys they reference
  return { keptHoles: rename.size, lostHoles };
}

/** The one-time notice of a reconciliation (reconcileCutPlan's counts), or null when nothing changed. The legacy edge part is worded as before. */
export function cutPlanNotice(r) {
  if (!r) return null;
  const groups = [], edge = [];
  if (r.edgeMoved > 0) edge.push(`${r.edgeMoved} edge cut${r.edgeMoved === 1 ? '' : 's'} moved to chain`);
  if (r.edgeDropped > 0) edge.push(`${r.edgeDropped} dropped from closed loop${r.edgeDropped === 1 ? '' : 's'}`);
  if (edge.length) groups.push(edge.join(', '));
  if (r.kept > 0) groups.push(r.kept === 1 ? '1 cut was on an outline that is now a closed shape and was kept' : `${r.kept} cuts were on outlines that are now closed shapes and were kept`);
  if (r.removed > 0) groups.push(r.removed === 1 ? '1 cut no longer matches a shape and was removed: assign it again' : `${r.removed} cuts no longer match a shape and were removed: assign them again`);
  // TASK 774: keepHolesFromOtherSketches's counts
  if (r.keptHoles > 0) groups.push(r.keptHoles === 1 ? '1 cut kept its holes from other sketches (now a combined profile)' : `${r.keptHoles} cuts kept their holes from other sketches (now combined profiles)`);
  if (r.lostHoles > 0) groups.push(r.lostHoles === 1 ? '1 cut no longer has its holes from other sketches (a hole has its own cut): check it in Prepare' : `${r.lostHoles} cuts no longer have their holes from other sketches (a hole has its own cut): check them in Prepare`);
  return groups.length ? `Cut plan updated: ${groups.join('; ')}` : null;
}

/**
 * deriveKeyFootprints(key, storedRec, state, loops, loopPolys, owned) — THE ONE composition of the cut derivations for one plan
 * target: effectiveCutRecord -> deriveProfileCuts (#core/stepped-cut deriveCuts: + a stepped cut's terraces) -> deriveCutFootprint. Returns { rec, cuts, footprints } (rec = the effective
 * record the footprints were derived with), or null when the target derives to nothing (stale key). Both Prepare's preview
 * (computeLook) and the 3D Review (planReliefItems) call this; no cut geometry is computed here.
 * `loops` must carry the host-side `polygon` (see loopsWithPolygons); `loopPolys` = { [loop id]: polygon }; `owned` = the loops with
 * their own record in the plan (planOwnedLoops), never cut again as a hole of this target (TASK 711, as the exporter does).
 */
export function deriveKeyFootprints(key, storedRec, state, loops, loopPolys, owned) {
  const e = resolveEntry(key, storedRec); // TASK 792: a part's Contour cuts the part
  if (!e) return null;
  return deriveFootprints(e.target, effectiveCutRecord(e.rec), state, loops, loopPolys, owned); // TASK 450: On line / Guide take no offset (effectiveCutRecord); TASK 817: op-derive.js, the worker's too
}

/**
 * TASK 817: the GENERATED paths. pathsCtx(state, geo) = one reading pass over the plan (op-paths.js pathsContext: the sketch's geometry signature, the plan's owned
 * loops; `geo` = { loops, loopPolys, owned } when the caller has them). pathsOf(key, storedRec, ctx, { request }) = deriveKeyFootprints' result for this plan item
 * as the background generation made it ({ rec, cuts, footprints }; null: it derives to nothing), or UNDEFINED while it is generating / not asked for (a peek:
 * request false; `opId` = the operation it is read for: the open one's edits are generated on OK); itemOf = the whole job's result { paths, levels } (op-derive.js deriveItem: + a Roughing's /
 * Contour's level facts). The same resolution as deriveKeyFootprints (resolveEntry + effectiveCutRecord).
 */
export function pathsCtx(state, geo = null) {
  const g = geo && geo.loops ? geo : loopsWithPolygons(state);
  return pathsContext(state, { loops: g.loops, loopPolys: g.loopPolys, owned: geo && geo.owned ? geo.owned : planOwnedLoops(state, g.loops, g.loopPolys) });
}
/** TASK 817: what a plan item's derivation takes: { target, rec } (rec = the EFFECTIVE record), or null when it has no entry: THE resolution (deriveKeyFootprints'). */
export function pathsInputOf(key, storedRec) {
  const e = resolveEntry(key, storedRec);
  return e ? { target: e.target, rec: effectiveCutRecord(e.rec) } : null;
}
export function itemOf(key, storedRec, ctx, { request = true, opId = null, item = null } = {}) {
  const input = pathsInputOf(key, storedRec);
  if (!input) return { paths: null, levels: null };
  return lookupPaths(ctx, input.target, input.rec, { request, opId, item }); // TASK S3: `item` = the membership read (its out-of-date rule: op-paths.js)
}
export function pathsOf(key, storedRec, ctx, opts) { const it = itemOf(key, storedRec, ctx, opts); return it === undefined ? undefined : it.paths; }
/** TASK 817: the generated paths of an entry already resolved (planEntries: { target, rec }), as pathsOf. */
export function entryPathsOf(target, resolvedRec, ctx, opts) { const it = lookupPaths(ctx, target, effectiveCutRecord(resolvedRec), opts); return it === undefined ? undefined : it.paths; }
/** TASK S3: whether a plan item (a membership: `item` = '<op id>|<geometry key>') is OUT OF DATE (op-paths.js): an entry resolved (planEntries), or a member item (planMemberItems). */
export function entryOutOfDate(target, resolvedRec, ctx, item, opId = null) { return isOutOfDate(ctx, target, effectiveCutRecord(resolvedRec), item, opId); }
export function itemOutOfDate(key, storedRec, ctx, item, opId = null) { const input = pathsInputOf(key, storedRec); return Boolean(input) && isOutOfDate(ctx, input.target, input.rec, item, opId); }
/** TASK 817: the signature of a plan item's derivation (op-paths.js pathsSig), or null when it has no entry. */
export function pathsSigOf(key, storedRec, ctx) {
  const input = pathsInputOf(key, storedRec);
  return input ? pathsSigFn(ctx, input.target, input.rec) : null;
}

/** TASK 711: the loops that have their own record in `plan` (#core ownedLoopIds over the plan's assigned entries, the set the exporter
 *  derives from the same entries). TASK 798: EVERY operation's, ticked or not (an unticked hole is still its own cut, left out: never cut by its plate). */
export function planOwnedLoops(state, loops, loopPolys) {
  return ownedLoopIds(planEntries(), state, loops, loopPolys, CUT_TYPES);
}

// TASK 817: loopsWithPolygons (the loops of `state` with their host-side polygons + the { id: polygon } map) moved to op-derive.js (the worker needs it); re-exported above.

// A content SIGNATURE for the Review's build cache (FNV-1a of the JSON text): equal signature = equal footprints, so the model can
// reuse the work of an earlier build. Covers the effective record and the cut GEOMETRY (polygons, chain joints), never object identity.
function sigHash(value) {
  const str = JSON.stringify(value); let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h.toString(36) + '.' + str.length.toString(36);
}
const LEVELS_SIG = new WeakMap(); // TASK 792: a levels list (never mutated) -> its content hash, made once
const levelsSig = (levels) => { let h = LEVELS_SIG.get(levels); if (!h) { h = sigHash(levels); LEVELS_SIG.set(levels, h); } return h; };
const cutsSig = (cuts, state) => cuts.map((c) => [c.kind, c.cutType, c.offsetSide, c.isCompound, c.polygon || null, c.outerPoly || null, c.holePolys || null,
  c.chain ? (c.chain.shapes || []).map((sh) => [sh, (sh.joints || []).map((id) => { const j = state.joints.get(id); return j ? [j.x, j.y] : null; })]) : null]);

/**
 * planReliefItems(state, opts) — the cut plan as the 3D Review's input, one item per derived
 * footprint: [{ key, cutType, cutDepth, footprints:[fp], shape, footprintsAt }], via deriveKeyFootprints / deriveCutFootprintAt
 * (the same derivation at another cutter half-width). Stale keys derive to nothing, as in the exporter. TASK 798: `opts` = planRecords' { ticked } (the 3D Review
 * shows the ticked operations); the hole ownership stays the whole plan's (planOwnedLoops), so a ticked cut is derived exactly as with everything ticked.
 */
export function planReliefItems(state, opts) {
  const { loops, loopPolys } = loopsWithPolygons(state);
  const owned = planOwnedLoops(state, loops, loopPolys);
  const ctx = pathsCtx(state, { loops, loopPolys, owned }); // TASK 817: the generated paths (the Review waits until nothing is generating: main.js)
  const items = [];

  for (const [key, stored] of planRecords(opts)) {
    if (!stored || !stored.cutType || stored.cutType === STOCK_TYPE_ID) continue; // a Stock loop is the board, not a cut (planStockProfile)
    const d = pathsOf(key, stored, ctx);
    if (!d) continue; // nothing to cut (TASK 817: or not generated yet)
    const shape = { cutterShape: stored.cutterShape || 'endmill', cutterAngle: stored.cutterAngle, toolDia: d.rec.toolDia };
    const at = new Map(); // halfWidth -> footprints (one derivation per width, shared by this key's footprints)
    // TASK 817: a shaped cutter's other widths sweep the cuts again (#core deriveCutFootprintAt calls each cut's `sweep`, a function that does not cross from the worker):
    // they are derived from the main thread's own derivation of the same item (deriveKeyFootprints), made once, only when the 3D build asks for a width
    let own = null;
    const atW = (w) => { if (!at.has(w)) { if (!own) own = deriveKeyFootprints(key, stored, state, loops, loopPolys, owned); at.set(w, deriveCutFootprintAt(own.cuts, own.rec, state, w)); } return at.get(w); };
    const geo = d.rec.levelsOp ? sigHash(cutsSig(d.cuts, state)) : cutsSig(d.cuts, state); // TASK 792: a Roughing / Contour hashes its geometry ONCE (254 contour passes re-stringified it per item); every other record's signature is the one before 792
    const recSig = d.rec.levelsOp ? sigHash(d.rec.levels ? { ...d.rec, levels: levelsSig(d.rec.levels) } : d.rec) : d.rec; // TASK 792: the same for its record (its part's sections by their own hash, made once per list)
    d.footprints.forEach((fp, i) => items.push({ key, sig: sigHash([i, recSig, geo]), cutType: fp.cutType, cutDepth: fp.terrace ? fp.terrace.depth : fp.hold && fp.hold.depth != null ? fp.hold.depth : d.rec.cutDepth, footprints: [fp], shape, footprintsAt: (w) => [atW(w)[i]].filter(Boolean) })); // TASK 714: a terrace at its own depth; TASK 742: a held cut's pass / gap strip at its own
  }
  return items;
}


/** The key of the Stock loop in the plan ('loop:<id>' | 'profile:<id>'), or null. ONE stock per document: Prepare moves the role, and if a
 *  loaded document somehow holds two, the first in the plan wins. */
export function stockKeyOf() {
  for (const { op, ref } of membersInFileOrder()) if (op.type === STOCK_TYPE_ID) return ref.key;
  return null;
}

/**
 * planStockProfile(state) — TASK 472: the board profile of the Stock loop, or null when there is none (or it no longer
 * derives to a loop). { key, thickness (base mm, or null when unset), outer, holes (closed rings [[x,y],...]), sig }. The rings are the
 * loop polygons the derivation already yields for the target (deriveProfileCuts): the outer loop, and the holes of an explicit combined profile.
 * No geometry is computed here.
 */
export function planStockProfile(state) {
  const key = stockKeyOf();
  if (!key) return null;
  const { loops, loopPolys } = loopsWithPolygons(state);
  const rec = effectiveCutRecord(getPlanRecord(key));
  const cuts = deriveProfileCuts(parseKey(key), rec, state, loops, loopPolys);
  const ring = (poly) => { const r = poly.map((p) => [p.x, p.y]); return r.concat([r[0].slice()]); };
  const outerCut = (cuts || []).find((c) => !c.isHole && c.polygon && c.polygon.length >= 3);
  if (!outerCut) return null;
  // Holes only from an EXPLICIT combined profile ('profile:<id>', made with Combine): the loops merely DRAWN inside a plain Stock loop
  // (the parts to be cut out of the board) are NOT holes of the board; deriveProfileCuts would call them holes of a derived profile.
  const holes = parseKey(key).kind === 'profile' ? cuts.filter((c) => c.isHole && c.polygon && c.polygon.length >= 3).map((c) => ring(c.polygon)) : [];
  const t = Number(rec.cutDepth);
  const outer = ring(outerCut.polygon);
  return { key, thickness: rec.cutDepth !== 'unset' && Number.isFinite(t) && t > 0 ? t : null, outer, holes, sig: sigHash([outer, holes]) };
}


/**
 * assignImportedCuts(state, cutRecordByDesc) — TASK 478: connect the cut metadata an SVG import carried (one record per
 * source element, keyed by the shapes' `descId`) to the plan; returns how many cuts were assigned.
 *  - an element that forms ONE closed loop -> 'loop:<id>' (as before);
 *  - a COMPOUND element (several closed subpaths in one <path>: the Fusion add-in's pocket with an island) -> its biggest loop is the outer,
 *    the loops inside it are its HOLES, and the plan gets ONE explicit combined profile ('profile:<id>', makeProfile) with the record: a
 *    pocket with a hole, not two separate pockets (the island must stay uncut); subpaths outside the outer keep their own loop record;
 *  - an open chain keeps today's rule (On Line / Guide, or any record with a depth).
 */
export function assignImportedCuts(state, cutRecordByDesc) {
  if (!cutRecordByDesc || cutRecordByDesc.size === 0) return 0;
  const shapeById = new Map((state.shapes || []).map((sh) => [sh.id, sh]));
  const { loops } = loopsWithPolygons(state);
  const polyArea = (poly) => { let a = 0; for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length]; a += p.x * q.y - q.x * p.y; } return Math.abs(a / 2); };
  const byDesc = new Map(); // descId -> [loop] (loops whose edges all come from that one element)
  for (const loop of loops) {
    const ids = new Set();
    for (const e of (loop.edges || [])) { const sh = shapeById.get(e); if (sh && sh.descId) ids.add(sh.descId); }
    if (ids.size !== 1) continue;
    const d = [...ids][0];
    if (!cutRecordByDesc.has(d)) continue;
    if (!byDesc.has(d)) byDesc.set(d, []);
    byDesc.get(d).push(loop);
  }
  let n = 0;
  for (const [d, list] of byDesc) {
    const rec = cutRecordByDesc.get(d);
    if (list.length === 1) { fileShape(keyOf('loop', list[0].id), { ...rec }, state); n++; continue; }
    const sorted = [...list].sort((a, b) => polyArea(b.polygon) - polyArea(a.polygon));
    const outer = sorted[0];
    const inside = sorted.slice(1).filter((l) => pointInPolygon(outer.polygon, l.polygon[0]));
    const apart = sorted.slice(1).filter((l) => !inside.includes(l));
    if (inside.length) { const prof = makeProfile(state, outer, inside); fileShape(keyOf('profile', prof.id), { ...rec }, state); n++; }
    else { fileShape(keyOf('loop', outer.id), { ...rec }, state); n++; }
    for (const l of apart) { fileShape(keyOf('loop', l.id), { ...rec }, state); n++; }
  }
  for (const c of findOpenChains(state, loops)) {
    for (const sh of (c.shapes || [])) {
      if (!sh.descId || !cutRecordByDesc.has(sh.descId)) continue;
      const rec = cutRecordByDesc.get(sh.descId);
      if (rec.cutType === 'online' || rec.cutType === 'guide' || (rec.cutDepth != null && rec.cutDepth !== 'unset')) {
        const chainKey = keyOf('chain', c.id);
        if (!memberOf(chainKey)) { fileShape(chainKey, { ...rec, cutType: rec.cutType || 'online' }, state); n++; }
      }
    }
  }
  return n;
}
