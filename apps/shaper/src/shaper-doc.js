// apps/shaper/src/shaper-doc.js — Shaper's own document state, in ONE place (TASK 460), persisted through the shared document
// buffer's host sidecar (doc.hosts.shaper), exactly like Pen Plotter's plotter-doc.js (TASK 451):
//   • TASK S1 (version 3, docs/OPERATIONS-MODEL.md 1.2): the OPERATIONS (in list order: their type, settings and shapes, each shape with its file-order `seq`),
//     the REGIONS (per geometry key: slope, levels, source) and nextSeq (operations-store.js); a version 2 document (the per-geometry cut plan records
//     `cutPlan` + the operation order `opOrder`) is MIGRATED here, the one read of a stored Shaper document (migrateV2, section 3);
//   • the STOCK the 3D Review reads (apps/shaper/src/stock.js, the one declaration; defaults 3/4 in thick, 1/2 in margin);
// Plain JSON-safe data. An old document has no sidecar: the defaults below apply.

import { reconcileCutPlan, reconcileStore, keepHolesFromOtherSketches, v2PlanEntries, isContourKey, partKeyOf, settingsPart, recordOf } from './cut-plan.js'; // TASK 761: the stored plan reconciled with the document's regions, here, once; TASK 774; TASK S1
import { opKeyOf, settingsOf, migrationOrder } from './operations.js'; // TASK S1: the v2 records grouped into operations as the list showed them
import { captureStore, applyStore, storeOps, membersOf, regionOf, removeRef, insertOp, setOpSettings, setOpsOn, CONTOUR_TYPE } from './operations-store.js'; // TASK S1: the operations + regions store; TASK S2: the Contours' own values (migrateContours)
import { wallsOf, levelsBand } from '#core/stepped-cut.js'; // TASK S2: a Contour's walls in effect; the band a Roughing / Contour is cut down to
import { getStock, setStock } from './stock.js'; // THE stock declaration (TASK 459): {thickness, width, height, margin}, base mm
import { captureStl, applyStl, captureStlDoc, applyStlDoc } from './stl-source.js'; // TASK 790: the STL the design came from (or none)
import { captureSelections, applySelections, getSelections } from './selection-list.js'; // TASK 795: the selection list

// TASK 774: 2 = written under the SAME-SKETCH hole rule of derived faces (commit 27c00a4); a document below 2 (or a sidecar without a version) was
// saved under the old rule: applyShaperDoc keeps its cuts' holes from other sketches (cut-plan.js keepHolesFromOtherSketches).
// TASK 812: exported: the document buffer opens a document of a HIGHER version but never writes over it (design-canvas.js hostVersion).
// TASK S1: 3 = the operations + regions store (docs/OPERATIONS-MODEL.md 1.2); a version 2 document is migrated on reading (migrateV2), written as 3 on the next save.
// TASK S2 (owner rulings turns 2713, 2730-2731): 4 = a Contour operation carries its OWN Depth, Walls and Wall side (a version 3 app would read its depth and walls
// LIVE from the shape's other operation, so it must not write over a version 4 document: task 812's guard), and a Roughing's / Contour's Depth IS the Heights' Bottom
// (one setting: `bottomDepth` is gone); a version 3 (or older) document is read into that form (migrateContours, then migrateHeights), written as 4 on the next save.
export const DOC_VERSION = 4;
const SAME_SKETCH_HOLES_VERSION = 2;
const OPERATIONS_VERSION = 3;
const OWN_CONTOUR_VERSION = 4; // TASK S2

/** TASK 743: what one step of the shared undo history keeps of Prepare (prepare-stage.js hostSnapshot). TASK S1: the operations store (its regions shared by
 *  reference: never mutated). TASK 790: + the STL source (stl-source.js, without its mesh): undoing an STL import / a new Up or Units gives the previous one back (or none). */
export const capturePrepare = () => ({ store: captureStore(), stl: captureStl(), selections: captureSelections(), stockThickness: getStock().thickness });
/** TASK S1: the part of a Prepare snapshot an edit compares (prepare-stage.js cutEdit): everything but the regions (the large levels: never changed by an edit). */
export const comparablePrepare = (p) => JSON.stringify([p.store.operations, p.store.nextSeq, p.store.listOrder, p.stl, p.selections, p.stockThickness]);
export function applyPrepare(p) {
  applyStore(p && p.store);
  applyStl(p && p.stl);
  applySelections(p && p.selections); // TASK 795: the selection list, and the stock thickness an add set (TASK 794)
  if (p && Number.isFinite(p.stockThickness)) setStock({ ...getStock(), thickness: p.stockThickness });
}

/** The persisted Shaper document (what createDocumentBuffer's getHostData returns). TASK 790: `stl` only when the design came from an STL (TASK 841: the list of
 *  its STL sources, one per relief part: stl-source.js captureStlDoc). */
export function captureShaperDoc() {
  const stl = captureStlDoc();
  const selections = getSelections(); // TASK 795: only when there are some (a design without selections writes the same bytes as before)
  const { operations, regions, nextSeq, listOrder } = captureStore();
  return { version: DOC_VERSION, operations, regions, nextSeq, listOrder, stock: getStock(), ...(stl ? { stl } : {}), ...(selections.length ? { selections } : {}) };
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
  return Object.hasOwn(OLD_CLEARING, now.clearing) ? { ...now, clearing: OLD_CLEARING[now.clearing] } : now;
}
const opKeyNow = (k) => (typeof k === 'string'
  ? k.replace(/"pattern":"(concentric|spiral)"/, (m, v) => `"pattern":"${OLD_CLEARING[v]}"`)
    .replace(/"stepped-(pocket|inside|outside)"/, '"roughing"') // TASK 792: the stepped types are Roughing
    .replace(/,"passDepth":(null|-?[\d.eE+-]+)/, '')
  : k);

// TASK 836 (owner ruling 2026-11-20: lead-ins removed from the app): a stored document's lead-in is DROPPED here, the one read of a stored Shaper document, before
// anything reads it: every `leadIn*` field (leadIn, leadInSide, leadInRadius, leadInSweep, leadInLength, leadInAt) of a version 2 record and of a version 3 / 4
// operation's settings, a membership's dragged lead-in position (`at`), and the `"leadIn":...` part of a stored operation key (an On line outline's, or a
// pocket's of before 778). An On line outline that had one is cut as the plain closed loop. The document is not changed in place (the caller's object).
const LEAD_IN_KEY = /^leadIn/;
const LEAD_IN_IN_KEY = /(,"leadIn":(\{[^{}]*\}|"[^"]*"|-?[\d.eE+-]+|true|false|null))|("leadIn":(\{[^{}]*\}|"[^"]*"|-?[\d.eE+-]+|true|false|null),?)/g;
const noLeadIn = (rec) => (rec && typeof rec === 'object' && Object.keys(rec).some((k) => LEAD_IN_KEY.test(k)) ? Object.fromEntries(Object.entries(rec).filter(([k]) => !LEAD_IN_KEY.test(k))) : rec);
function dropLeadIn(d) {
  if (!d || typeof d !== 'object') return d;
  const out = { ...d };
  if (Array.isArray(d.cutPlan)) out.cutPlan = d.cutPlan.map((e) => (Array.isArray(e) ? [e[0], noLeadIn(e[1]), ...e.slice(2)] : e));
  if (Array.isArray(d.opOrder)) out.opOrder = d.opOrder.map((k) => (typeof k === 'string' ? k.replace(LEAD_IN_IN_KEY, '') : k));
  if (Array.isArray(d.operations)) {
    out.operations = d.operations.map((op) => (op && typeof op === 'object' ? {
      ...op,
      ...(op.settings ? { settings: noLeadIn(op.settings) } : {}),
      ...(Array.isArray(op.geometry) ? { geometry: op.geometry.map((r) => (r && typeof r === 'object' && Object.hasOwn(r, 'at') ? Object.fromEntries(Object.entries(r).filter(([k]) => k !== 'at')) : r)) } : {}),
    } : op));
  }
  return out;
}

/**
 * migrateV2(plan, storedOrder, state, selections) — TASK S1, docs/OPERATIONS-MODEL.md section 3: a version 2 plan (a Map of records, mapped to today's values and
 * reconciled) to the operations store. Returns the migration report { records, unassigned, operations, splits, hiddenLost, guideOps, model }.
 *  1. the records in their order: record i's file order `seq` = i + 1 (the file order is kept exactly);
 *  2. region data out of each record: slope / levels to regions[key]; `source` = the selection entry's `base[key]` (what the import said) when there is one;
 *  3. records grouped by today's operation key (operations.js opKeyOf of the record as the derivation takes it: a Contour with its part's data): the operations the
 *     list showed; a `contour:<key>` record joins a Contour operation whose shape is `<key>` (its depth / type read live from its part: advisor ruling 3);
 *  4. inside a group, a record whose declared settings (settingsOf) differ from the first's becomes its own operation right after it (`splits`: 0 by construction
 *     since the declared table is the key, TASK 812); a record whose OTHER settings differ takes the first's (one settings set per operation, advisor ruling 4:
 *     counted in `hiddenLost`);
 *  5. Depth becomes 'model' where every shape of the operation has an imported depth equal to it (`model`);
 *  6. list order = the stored order (operations.js migrationOrder: orderOps over today's operations, a Guide key of before 'S1' standing for every Guide operation);
 *     a group none of whose records derives a cut (stale) goes after them;
 *  7. ids op-1 ... op-n in list order; on: true.
 * Unassigned records (cut type null) and a Contour whose part is unassigned are not migrated (they derive nothing; `unassigned`). `guideOps` = the Guide operations
 * (more than one: Guides with different depth / offset / bit, advisor ruling 1).
 */
export function migrateV2(plan, storedOrder, state, selections) {
  const base = {};
  for (const e of Array.isArray(selections) ? selections : []) if (e && e.base && typeof e.base === 'object') for (const [k, v] of Object.entries(e.base)) if (!(k in base) && v) base[k] = v;
  const report = { records: plan.size, unassigned: 0, operations: 0, splits: 0, hiddenLost: 0, guideOps: 0, model: 0 };
  const regions = {}, seqOf = new Map();
  let seq = 0;
  for (const [planKey, rec] of plan) {
    seqOf.set(planKey, ++seq);
    if (!rec || isContourKey(planKey)) continue;
    const region = {};
    if (rec.slope) region.slope = rec.slope;
    if (rec.levels) region.levels = rec.levels;
    if (base[planKey]) region.source = { cutType: base[planKey].cutType ?? null, cutDepth: base[planKey].cutDepth ?? 'unset' };
    if (Object.keys(region).length) regions[planKey] = region;
  }
  const entries = v2PlanEntries(plan); // the assigned records as the derivation takes them (a Contour with its part's data; none for an unassigned part)
  report.unassigned = [...plan.values()].filter((r) => r && r.cutType).length - entries.length + [...plan.values()].filter((r) => !r || !r.cutType).length;
  const groups = new Map(); // operation key -> [{ entry, rec (stored) }]
  for (const e of entries) {
    const k = opKeyOf(e.rec);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push({ entry: e, rec: plan.get(e.key) });
  }
  const stable = (o) => JSON.stringify(Object.keys(o).sort().map((k) => [k, o[k]]));
  const ops = []; // { key (operation key), type, settings, members }
  for (const [k, members] of groups) {
    let current = null;
    for (const m of members) {
      if (current && JSON.stringify(settingsOf(m.entry.rec)) !== JSON.stringify(settingsOf(current.members[0].entry.rec))) { report.splits++; current = null; }
      if (!current) { current = { key: ops.some((o) => o.key === k) ? `${k}#${ops.length}` : k, type: m.rec.cutType, settings: settingsPart(m.rec), members: [] }; ops.push(current); }
      else if (stable(settingsPart(m.rec)) !== stable(current.settings)) report.hiddenLost++;
      current.members.push(m);
    }
  }
  const order = migrationOrder(state, ops.map((o) => ({ key: o.key, entries: o.members.map((m) => ({ ...m.entry, planKey: m.entry.key, n: entries.indexOf(m.entry) })) })), storedOrder);
  const byKey = new Map(ops.map((o) => [o.key, o]));
  const operations = order.map((k, i) => {
    const o = byKey.get(k);
    const geometry = o.members.map(({ entry }) => ({ key: partKeyOf(entry.key), seq: seqOf.get(entry.key) }));
    const settings = { ...o.settings };
    const d = settings.cutDepth;
    if (o.type !== 'contour' && d !== undefined && d !== 'unset' && Number.isFinite(Number(d)) && geometry.every((g) => regions[g.key] && regions[g.key].source && Number(regions[g.key].source.cutDepth) === Number(d))) { settings.cutDepth = 'model'; report.model++; }
    return { id: `op-${i + 1}`, type: o.type, on: true, settings, geometry };
  });
  report.operations = operations.length;
  report.guideOps = operations.filter((op) => op.type === 'guide').length;
  applyStore({ operations, regions, nextSeq: seq + 1, listOrder: storedOrder.length ? 'stored' : 'default' }); // the list order is the user's only if the document stored one
  return report;
}

/**
 * migrateContours() — TASK S2 (owner ruling turn 2713, docs/OPERATIONS-MODEL.md 1.4 / 3): a version 3 store (or a version 2 one just migrated) to version 4. Up to
 * version 3 a Contour read its depth, its wall side and its walls' default LIVE from its shape's other operation (S1: the shape's one operation besides its Contour);
 * since S2 it is a plain operation with its OWN settings. Each Contour membership gets the values that reading gave at load, so every file stays byte for byte:
 *   cutDepth  'model' where the other operation's Depth is 'model' (it then follows the imported depth, as it did), else that operation's depth;
 *   walls     the choice in effect (#core wallsOf: its own, else the default its part's type gave);
 *   wallSide  'outside' where the part was an Outside cut, else 'inside' (#core levelsCutAs: read only for a shape whose slope / levels do not say it).
 * The values are one settings set per operation: a Contour whose shapes read different values is split, the shapes with other values going to a NEW Contour right
 * after it (keeping their file places; `splits`, 0 on the 909-case corpus). A membership with no other operation (it derived nothing) leaves the Contour (`noPart`;
 * its file is unchanged; an operation left empty stays, listed "no shapes yet"). Returns { contours, splits, noPart }.
 */
export function migrateContours() {
  const report = { contours: 0, splits: 0, noPart: 0 };
  for (const op of storeOps().filter((o) => o.type === CONTOUR_TYPE)) {
    report.contours++;
    const groups = new Map(); // the values as JSON -> { values, refs }
    for (const ref of [...op.geometry]) {
      const part = membersOf(ref.key).find((m) => m.op.type !== CONTOUR_TYPE); // S1's part (memberOf: the shape's one other operation)
      if (!part) { removeRef(op, ref); report.noPart++; continue; }
      const prec = recordOf(part.op, part.ref), reg = regionOf(ref.key) || {};
      const values = {
        cutDepth: part.op.settings.cutDepth === 'model' ? 'model' : prec.cutDepth,
        walls: wallsOf({ ...op.settings, levelsOp: 'contour', baseType: prec.cutType, ...(reg.slope ? { slope: reg.slope } : {}), ...(reg.levels ? { levels: reg.levels } : {}) }),
        wallSide: prec.cutType === 'exterior' ? 'outside' : 'inside',
      };
      const k = JSON.stringify(values);
      if (!groups.has(k)) groups.set(k, { values, refs: [] });
      groups.get(k).refs.push(ref);
    }
    const [first, ...rest] = [...groups.values()];
    if (first) setOpSettings(op, { ...op.settings, ...first.values });
    let at = storeOps().indexOf(op) + 1;
    for (const g of rest) {
      for (const ref of g.refs) removeRef(op, ref);
      const copy = insertOp(at++, { type: CONTOUR_TYPE, settings: { ...op.settings, ...g.values }, geometry: g.refs });
      if (op.on === false) setOpsOn([copy.id], false);
      report.splits++;
    }
  }
  return report;
}

/**
 * migrateHeights() — TASK S2 (owner rulings turns 2730-2731, docs/OPERATIONS-MODEL.md 1.4): a Roughing's / Contour's Depth IS its Heights' Bottom, ONE setting (cutDepth:
 * 'model' / unset = the model's depth, a value = the cut stops at that depth). Up to version 3 they were two (cutDepth, and 810's `bottomDepth`, the lower limit); the
 * cuts were made down to their band's depth (#core levelsBand: min(depth, bottom), less the floor allowance), so a stored bottom becomes the Depth of that band
 * (levelsBand with that bottom: exactly the number the cuts were made to) and `bottomDepth` goes: the same cuts, byte for byte. Where the bottom was not above the
 * depth it changed nothing and the Depth is kept as stored ('model' stays 'model'). One settings set per operation: shapes that end at different depths are split
 * into a NEW operation each, right after it (`splits`, 0 on the 909-case corpus). Returns { merged, splits }.
 */
export function migrateHeights() {
  const report = { merged: 0, splits: 0 };
  for (const op of storeOps().filter((o) => (o.type === 'roughing' || o.type === CONTOUR_TYPE) && o.settings.bottomDepth != null)) {
    const bottom = Number(op.settings.bottomDepth) > 0 ? Number(op.settings.bottomDepth) : null;
    const { bottomDepth, ...rest } = op.settings;
    report.merged++;
    if (bottom === null) { setOpSettings(op, rest); continue; }
    const groups = new Map(); // the depth as JSON -> { depth, refs }
    for (const ref of op.geometry) {
      const rec = recordOf(op, ref), reg = regionOf(ref.key) || {};
      const stop = levelsBand({ bottomDepth: bottom, ...(reg.levels ? { levels: reg.levels } : {}), ...(reg.slope ? { slope: reg.slope } : {}) }, rec.cutDepth).depth;
      const depth = Number(rec.cutDepth) > 0 && Number(rec.cutDepth) === stop ? rest.cutDepth : stop; // the bottom changed nothing: the Depth as stored
      const k = JSON.stringify(depth);
      if (!groups.has(k)) groups.set(k, { depth, refs: [] });
      groups.get(k).refs.push(ref);
    }
    const [first, ...others] = [...groups.values()];
    setOpSettings(op, { ...rest, cutDepth: first ? first.depth : Math.min(Number(rest.cutDepth) > 0 ? Number(rest.cutDepth) : bottom, bottom) });
    let at = storeOps().indexOf(op) + 1;
    for (const g of others) {
      for (const ref of g.refs) removeRef(op, ref);
      const copy = insertOp(at++, { type: op.type, settings: { ...rest, cutDepth: g.depth }, geometry: g.refs });
      if (op.on === false) setOpsOn([copy.id], false);
      report.splits++;
    }
  }
  return report;
}

/** Restore a persisted Shaper document. Missing parts keep their defaults (an old buffer carries none of this).
 *  TASK S1: a version 3 document's operations store as stored; a version 2 one (or older) MIGRATED (migrateV2) after today's value mapping (withClearingNow,
 *  opKeyNow) and the reconciliation below; its report rides in the result (`migration`). The stored file changes only when the user next saves.
 *  TASK 761: with the restored sketch `state`, the plan is reconciled with its regions HERE, the one read of a stored Shaper document, before any
 *  reader of the plan (cut-plan.js reconcileCutPlan: the legacy edge records, a chain record on an outline that is now a loop; reconcileStore for version 3);
 *  returns its counts (the page's one notice, cut-plan.js cutPlanNotice), or null without a state.
 *  TASK 774: a document saved before the same-sketch hole rule (version below 2) keeps its cuts' holes from other sketches (keepHolesFromOtherSketches; its
 *  counts join the same notice). */
export function applyShaperDoc(stored, state = null) {
  const d = dropLeadIn(stored); // TASK 836
  setStock(d && d.stock);
  applyStlDoc(d && d.stl, d && d.selections); // TASK 790: the STL card's source (none for a design that did not come from an STL); TASK 841: a list, one per relief part
  if (d && Number(d.version) >= OPERATIONS_VERSION) {
    applyStore(d);
    applySelections(d && d.selections); // TASK 795: the selection list (none for a design that was not built from selections)
    const counts = state ? { ...reconcileStore(state), keptHoles: 0, lostHoles: 0 } : null;
    const contours = Number(d.version) < OWN_CONTOUR_VERSION ? migrateContours() : null; // TASK S2: version 3: the Contours' own values
    const heights = Number(d.version) < OWN_CONTOUR_VERSION ? migrateHeights() : null; // TASK S2: version 3: a Roughing's / Contour's Depth = its Bottom
    return counts ? { ...counts, ...(contours ? { contours, heights } : {}) } : null;
  }
  const plan = new Map((d && Array.isArray(d.cutPlan) ? d.cutPlan : []).filter((e) => Array.isArray(e) && typeof e[0] === 'string').map(([key, rec]) => [key, rec && typeof rec === 'object' ? withClearingNow({ ...rec }) : rec]));
  let counts = null;
  if (state) {
    const old = d && Array.isArray(d.cutPlan) && !(Number(d.version) >= SAME_SKETCH_HOLES_VERSION);
    counts = { ...reconcileCutPlan(state, plan), ...(old ? keepHolesFromOtherSketches(state, plan) : { keptHoles: 0, lostHoles: 0 }) };
  }
  const migration = migrateV2(plan, d && Array.isArray(d.opOrder) ? d.opOrder.filter((k) => typeof k === 'string').map(opKeyNow) : [], state, d && d.selections);
  migration.contours = migrateContours(); // TASK S2: then version 3 -> 4 (the Contours' own values; a Roughing's / Contour's Depth = its Bottom)
  migration.heights = migrateHeights();
  applySelections(d && d.selections); // TASK 795: the selection list (none for a design that was not built from selections)
  return state ? { ...counts, migration } : null;
}
