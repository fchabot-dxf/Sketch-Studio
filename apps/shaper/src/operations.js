// apps/shaper/src/operations.js — TASK 743: Shaper's OPERATIONS (owner turns 2099-2101 + 2145: "an op list"; send-back ruling: "I didn't mean to use actual
// SVG groups, just display groups as toolpaths"). DISPLAY ONLY: they group and order what Prepare's list and the Export step's 2D list show (the user's job
// plan); the downloaded / synced SVG never changes (export-payload.js: only the 2D view's PREVIEW copy tags each element with its operation, data-op).
// TASK S1 (docs/OPERATIONS-MODEL.md): the operations are STORED (operations-store.js, in list order); this module DESCRIBES them (describeOperations: their
// cuts and words) and keeps the operation KEY (opKeyOf) = the TOOL (cutter shape + bit diameter, + the angle of a V-bit), the CUT TYPE and the CUTTING SETTINGS
// the type declares (CUT_TYPES[].fields): a shape joins the operation of its key (cut-plan.js fileShape), and the v2 migration groups the records of an old
// document by it (shaper-doc.js). Guides and the Stock are not cut (no tool), under the heading "Not cut"; a Guide's settings are its depth / offset / bit
// (advisor ruling 1, task S1: they are written per element, so Guides with different values are different operations).
//
// DEFAULT ORDER (no order stored, and where a NEW operation slots into a stored one):
//  1. by tool: the tools whose LAST cut frees the least come first, so the cut that frees the part (outside) is in the last tool's group and every
//     hole / pocket is cut while the part is still held. A tool's rank = the highest opRank (shaper.js CUT_TYPES) of its operations; ties: the
//     smaller bit first (fine detail before the heavy cut), then cutter shape, then V-bit angle. Not "smallest bit first" alone: that would put an
//     outside cut with a 1/8 in bit before a 1/4 in bit's inside holes, freeing the part before its holes are cut. Not "as first used": the plan's
//     order is the order the user happened to click regions in, which says nothing about the cutting order.
//  2. inside one tool: by opRank (on line, pockets, inside = holes, outside last: holes before the part is freed, pockets before through cuts),
//     then shallow before deep (unset depth last), then the smaller offset, then the plan's order.
//  A NEW operation slots into the stored list by the same rule, once, when it is made (newOpIndex): when the list already has operations with its tool, it joins
//  them (before the first of them that the in-tool rule puts after it, else after the last of them: no extra tool change); a new tool goes right after the
//  operation that comes before it in the default order (at the top when none does). The v2 migration orders an old document's operations by its stored order.
// An operation's regions are listed in the plan's order.
import { cutTypeById, cutTypeHasParam, effectiveCutRecord, CUTTER_SHAPES, BIT_PRESETS, CUT_TYPES, STOCK_TYPE_ID } from './shaper.js';
import { parseKey, loopsWithPolygons, clearingWords, planEntries, recordOf, resolveEntry, isTicked } from './cut-plan.js'; // TASK 745: clearingWords; TASK S1: the store's entries
import { storeOps, planKeyOf } from './operations-store.js'; // TASK S1: the stored operations
import { ownedLoopIds } from '#core/profile-model.js';
import { deriveCuts, terraceOptions, resolutionLevel, STEP_DEPTH, LEVELS, roughingAllowance, hasLevels, roughLayout, boundaryOf, ROUGH_BOUNDARY, wallsDefault } from '#core/stepped-cut.js'; // TASK 810: a Roughing's boundary; a Contour's walls
import { smoothingOf } from '#core/level-smooth.js'; // TASK 809
import { holdMode, tabsHaveThickness } from '#core/hold-part.js';
import { outlineLeadIn, leadInSettings } from '#core/lead-in.js'; // TASK 775: an On line outline's lead-in is one of its settings
import { POCKET_CLEARING, clearingPattern, clearingSettings } from '#core/pocket-clearing.js'; // TASK 745: a programmed pocket's clearing is one of its settings
import { docUnit, lengthText, angleText } from '#core/settings-manager.js';

const round6 = (n) => Math.round(Number(n) * 1e6) / 1e6;
const isSet = (d) => d != null && d !== 'unset' && Number.isFinite(Number(d));
const depthOf = (d) => (isSet(d) ? round6(d) : 'unset');

/** A length in the document unit as an operation's words write it ("6 mm", "0.25 in", 1/16 in in Fractional): TASK 757, the one length-format decider (lengthText,
 *  TASK 728) at the cut card's precision (3 decimals while Length precision is Auto: its fields, its depth chips and the Export list show the same digits),
 *  trailing zeros dropped, the unit written after it as the card's notes write it. */
export function lengthLabel(mm) {
  const u = docUnit();
  return `${lengthText(mm, { unit: u, show: 'field' })} ${u}`;
}

/** A tool's name: "¼″ end mill", "6 mm ball nose", "⅛″ 60° V-bit" (a bit of a BIT_PRESETS size goes by its fraction). */
function toolName(tool) {
  const preset = BIT_PRESETS.find((p) => Math.abs(p.value - tool.dia) < 1e-6);
  const size = tool.dia > 0 ? (preset ? `${preset.label}″` : lengthLabel(tool.dia)) : 'no bit size';
  return [size, tool.angle != null ? angleText(tool.angle, { show: 'deg' }) : null, CUTTER_SHAPES.find((s) => s.id === tool.shape).label].filter(Boolean).join(' ');
}

/** The TOOL of a stored record: null for a type that is not cut (Guide, Stock); else { key, shape, dia, angle, label } (label: its name, toolName). */
export function toolOf(rec) {
  const t = rec && cutTypeById(rec.cutType);
  if (!t || t.opRank === 0) return null;
  const shape = CUTTER_SHAPES.some((s) => s.id === rec.cutterShape) ? rec.cutterShape : 'endmill';
  const dia = Number(rec.toolDia) > 0 ? round6(rec.toolDia) : 0;
  const angle = shape === 'vbit' ? Number(rec.cutterAngle) || 90 : null;
  const tool = { key: `${shape}|${dia}|${angle ?? ''}`, shape, dia, angle };
  return { ...tool, label: toolName(tool) };
}

// TASK 812: the SETTINGS FIELDS, each computed from a stored record in ONE place: `eff` = effectiveCutRecord(rec), `rec` = the stored record. A cut type
// DECLARES which of them it has (shaper.js CUT_TYPES[].fields, the one table: docs/OPERATIONS-MODEL.md 1.5); a field answers undefined when it adds nothing (the
// key stays the one before the setting existed). The ORDER of a type's `fields` is the order of the key's settings.
const SETTING_FIELDS = {
  depth: (rec) => depthOf(rec.cutDepth),
  offset: (rec) => round6(Number(rec.cutOffset) || 0),
  bit: (rec) => round6(Number(rec.toolDia) || 0), // TASK S1: a type that is not cut has no tool, yet a Guide's bit is written to the file (its settings)
  steps: (rec, eff) => {
    if (eff.terraceAs) { // a sloped Roughing (TASK 714's stepped cut): the step depth, or the adaptive resolution (#core terraceOptions: what the terraces are made with)
      const o = terraceOptions(eff);
      return o.deviation != null ? { deviation: round6(o.deviation) } : { step: round6(Number(o.step) > 0 ? o.step : STEP_DEPTH.defaultMm) };
    }
    if (eff.levelsOp) return { step: round6(Number(rec.stepDepth) > 0 ? rec.stepDepth : eff.levelsOp === 'contour' ? LEVELS.contourStepMm : STEP_DEPTH.defaultMm) }; // TASK 792: Roughing / Contour
    return undefined;
  },
  allowance: (rec, eff) => (roughingAllowance(eff) > 0 ? round6(roughingAllowance(eff)) : undefined), // TASK 792: a Roughing's allowance (0 adds nothing: a stepped record's key is the one before 792)
  layout: (rec, eff) => (eff.levelsOp === 'roughing' && hasLevels(eff) && roughLayout(eff) === 'nested' ? 'nested' : undefined), // TASK 792 (owner turn 2604): the Nested layout (Terraces, the default, adds nothing)
  minWidth: (rec, eff) => (eff.levelsOp === 'roughing' && hasLevels(eff) && roughLayout(eff) === 'terraces' && Number(rec.minTerraceWidth) > 0 ? round6(rec.minTerraceWidth) : undefined), // TASK 792: the Min terrace width (0 adds nothing)
  smoothing: (rec, eff) => (eff.levelsOp && smoothingOf(eff.levelsOp, rec.smoothing) !== smoothingOf(eff.levelsOp, undefined) ? round6(smoothingOf(eff.levelsOp, rec.smoothing)) : undefined), // TASK 809: a Smoothing other than the operation's default (the default adds nothing)
  walls: (rec, eff) => (eff.levelsOp === 'contour' && (rec.walls === 'all' || rec.walls === 'sloped') && rec.walls !== wallsDefault(eff) ? rec.walls : undefined), // TASK 810: a Contour's which walls off its default (today's choice adds nothing)
  heights: (rec, eff) => { // TASK 810: a Roughing / Contour's Heights, each off its default (the Surface, the part's depth, no floor allowance add nothing)
    if (!eff.levelsOp) return undefined;
    const o = {};
    if (Number(rec.topDepth) > 0) o.top = round6(rec.topDepth);
    if (rec.bottomDepth != null && Number(rec.bottomDepth) > 0) o.bottom = round6(rec.bottomDepth);
    if (Number(rec.floorAllowance) > 0) o.floor = round6(rec.floorAllowance);
    return Object.keys(o).length ? o : undefined;
  },
  boundary: (rec, eff) => { // TASK 810: a Roughing's machining boundary (a part with levels), each part off its default (Silhouette, Outside, the calculated offset add nothing)
    if (eff.levelsOp !== 'roughing' || !hasLevels(eff)) return undefined;
    const b = boundaryOf(rec), o = {};
    if (b.kind !== ROUGH_BOUNDARY.defaultKind) o.kind = b.kind;
    if (b.kind === 'shape' && b.shape) o.shape = b.shape;
    if (b.tool !== ROUGH_BOUNDARY.defaultTool) o.tool = b.tool;
    if (b.offset != null) o.offset = round6(b.offset);
    return Object.keys(o).length ? o : undefined;
  },
  hold: (rec, eff) => { // TASK 742: a held cut's mode and its values (Off adds nothing)
    const m = holdMode(eff);
    if (m === 'tabs') return { mode: m, count: rec.tabCount === 'auto' || !(Number(rec.tabCount) >= 1) ? 'auto' : Math.floor(Number(rec.tabCount)), width: round6(rec.tabWidth), ...(tabsHaveThickness(rec.cutType) ? { thickness: round6(rec.holdThickness) } : {}) }; // TASK 775: an On line cut's tabs have no thickness
    if (m === 'skin') return { mode: m, thickness: round6(rec.holdThickness) };
    return undefined;
  },
  clearing: (rec, eff) => { // TASK 745: a programmed pocket's clearing and the values it is computed with (Freehand adds nothing: the key is the one before 745)
    const pat = clearingPattern(eff);
    if (pat === 'freehand') return undefined;
    const c = clearingSettings(eff);
    // TASK 750: no step-downs here; Loop on adds `loop` (off adds nothing); TASK 778: pockets have no lead-in; TASK 812: the Loop's arm pitch (it changes the cuts: pocket-clearing.js; the default adds nothing)
    return { pattern: pat, stepover: round6(c.stepoverPct), allowance: round6(c.allowance), ...(pat === 'raster' ? { angle: round6(c.angle) } : {}), ...(c.loop ? { loop: true, ...(c.pitch !== POCKET_CLEARING.loopPitch.default ? { loopPitch: round6(c.pitch) } : {}) } : {}) };
  },
  leadIn: (rec, eff) => { // TASK 778: an On line outline's tangential arc lead-in (Off adds nothing)
    if (!outlineLeadIn(eff)) return undefined;
    const l = leadInSettings(eff);
    return { radius: l.radius != null ? round6(l.radius) : 'calc', sweep: l.sweep != null ? round6(l.sweep) : 'calc', length: l.length != null ? round6(l.length) : 'calc', side: l.side, ...(l.at != null ? { at: round6(l.at) } : {}) };
  },
};

/** The SETTINGS of a record that make two records one operation (the settings its type declares, CUT_TYPES[].fields, base mm), or null for a type that declares none. */
export function settingsOf(rec) {
  const t = rec && cutTypeById(rec.cutType);
  if (!t || !t.fields.length) return null;
  const eff = effectiveCutRecord(rec);
  const s = {};
  for (const f of t.fields) { const v = SETTING_FIELDS[f](rec, eff); if (v !== undefined) s[f] = v; }
  return s;
}

/** The operation key of a stored record: tool + cut type + settings (Guide / Stock: the type alone). */
export function opKeyOf(rec) {
  const tool = toolOf(rec);
  return JSON.stringify([tool ? tool.key : null, rec.cutType, settingsOf(rec)]);
}

const rankOf = (op) => op.rank ?? (cutTypeById(op.cutType) || {}).opRank ?? 9; // TASK 792: a Roughing / Contour operation's rank is derived (planOperations)
const cutSettings = (op) => ((cutTypeById(op.cutType) || {}).opRank > 0 ? op.settings : null); // TASK S1: a Guide's settings (declared since S1) never order it: what is not cut keeps the plan's order
const depthNum = (op) => { const s = cutSettings(op); return s && isSet(s.depth) ? s.depth : Infinity; };
const shapeIndex = (tool) => CUTTER_SHAPES.findIndex((s) => s.id === tool.shape);
const toolKeyOf = (op) => (op.tool ? op.tool.key : '');
// inside one tool: on line, pockets, inside, outside (opRank); shallow before deep; the smaller offset; the plan's order
const offsetNum = (op) => { const s = cutSettings(op); return (s && s.offset) || 0; };
const inTool = (a, b) => rankOf(a) - rankOf(b) || depthNum(a) - depthNum(b) || offsetNum(a) - offsetNum(b) || (a.first === b.first ? 0 : a.first - b.first); // TASK S2: an empty operation has no file place (Infinity): after the others

/** The DEFAULT order of `ops` (see the header). */
export function defaultOpOrder(ops) {
  const tools = new Map(); // tool key ('' = not cut) → { tool, ops, rank }
  for (const op of ops) {
    const k = op.tool ? op.tool.key : '';
    if (!tools.has(k)) tools.set(k, { tool: op.tool, ops: [], rank: -1 });
    const g = tools.get(k);
    g.ops.push(op); g.rank = Math.max(g.rank, rankOf(op));
  }
  const byTool = (a, b) => (!a.tool ? -1 : !b.tool ? 1 : a.rank - b.rank || a.tool.dia - b.tool.dia || shapeIndex(a.tool) - shapeIndex(b.tool) || (a.tool.angle ?? 0) - (b.tool.angle ?? 0));
  return [...tools.values()].sort(byTool).flatMap((g) => g.ops.sort(inTool));
}

/** `ops` in the order `keys`; an operation not in it slots in by the default rule (see the header). */
export function orderOps(ops, keys) {
  const def = defaultOpOrder(ops.slice());
  const byKey = new Map(ops.map((op) => [op.key, op]));
  const out = [];
  for (const k of keys) if (byKey.has(k) && !out.includes(k)) out.push(k);
  if (!out.length) return def;
  def.forEach((op, i) => {
    if (out.includes(op.key)) return;
    const sameTool = out.map((k, at) => ({ op: byKey.get(k), at })).filter((x) => toolKeyOf(x.op) === toolKeyOf(op));
    let at = 0;
    if (sameTool.length) { const later = sameTool.find((x) => inTool(op, x.op) < 0); at = later ? later.at : sameTool[sameTool.length - 1].at + 1; }
    else for (let j = i - 1; j >= 0; j--) { const p = out.indexOf(def[j].key); if (p >= 0) { at = p + 1; break; } }
    out.splice(at, 0, op.key);
  });
  return out.map((k) => byKey.get(k));
}

/** TASK S2: the sub-line of an operation with no shapes yet (docs/OPERATIONS-MODEL.md section 0). */
export const EMPTY_WORDS = 'no shapes yet: click shapes to add';
// the words of an operation: { depthText, detail, regions, rowText, label }
function describe(op) {
  const len = lengthLabel;
  const type = cutTypeById(op.cutType);
  const typeLabel = (type && type.menuLabel) || op.cutType;
  const s = type && type.opRank === 0 ? {} : op.settings || {}; // a Guide / the Stock: no depth or offset in its words (as before its settings were declared)
  const n = op.records.length, chains = op.records.every((r) => r.target.kind === 'chain');
  const regions = `${n} ${chains ? (n === 1 ? 'path' : 'paths') : (n === 1 ? 'region' : 'regions')}`;
  let depthText = s.depth === undefined ? null : s.depth === 'unset' ? 'depth unset' : len(s.depth);
  let detail = null;
  if (type && type.levelsOp) { // TASK 792: a Roughing / Contour operation: its levels (the depths its cuts are made at, from the derivation) and the step / resolution
    const levelsOf = (r) => [...new Set(r.cuts.map((c) => Number(c.terrace ? c.terrace.depth : c.rec && c.rec.cutDepth)).filter(Number.isFinite))];
    const counts = op.records.map((r) => levelsOf(r).length), depths = op.records.flatMap(levelsOf);
    if (depths.length) depthText = `${Math.min(...depths) === Math.max(...depths) ? '' : len(Math.min(...depths)).split(' ')[0] + '–'}${len(Math.max(...depths))}`;
    const lo = Math.min(...counts), hi = Math.max(...counts);
    if (counts.length) detail = `${lo === hi ? lo : `${lo}–${hi}`} level${hi === 1 ? '' : 's'}` + (s.steps && s.steps.deviation != null ? `, adaptive ${(resolutionLevel(s.steps.deviation) || { label: 'Custom' }).label}` : '')
      + (s.allowance ? `, allowance ${len(s.allowance)}` : '') + (s.layout ? ', nested' : '');
  }
  if (s.hold) { // a held operation: its pass and its gap strips (summed over its regions), from the derivation
    const holds = op.records.map((r) => (r.cuts.find((c) => c.hold && c.hold.role !== 'strip') || {}).hold).filter(Boolean);
    const pass = holds.find((h) => h.role === 'pass');
    const stroke = holds.find((h) => h.role === 'stroke'); // TASK 775: an On line cut's tabs (its strokes; the gaps between them left uncut)
    if (stroke) { const tabs = holds.filter((h) => h.role === 'stroke').reduce((t, h) => t + h.count, 0); detail = `${tabs} tab${tabs === 1 ? '' : 's'} (gaps ${len(stroke.width)} left uncut)`; }
    if (pass) {
      const gaps = op.records.reduce((sum, r) => sum + r.cuts.filter((c) => c.hold && c.hold.role === 'strip').length, 0);
      depthText = pass.mode === 'skin' ? `pass ${len(pass.depth)}` : `pass ${len(pass.depth)} + gaps ${len(Number(pass.fullDepth))}`;
      detail = pass.mode === 'skin' ? `onion skin ${len(pass.thickness)}` : `${gaps} gap${gaps === 1 ? '' : 's'} (tabs ${len(pass.width)} wide, ${len(pass.thickness)} thick)`;
    }
    if (holds.some((h) => h.role === 'refused')) detail = (detail ? detail + ', ' : '') + `${s.hold.mode === 'skin' ? 'onion skin' : 'tabs'} refused on ${holds.filter((h) => h.role === 'refused').length}`;
  }
  let typeWords = typeLabel;
  if (s.clearing) { // TASK 745: a programmed pocket: "Pocket (spiral)" and its clearing from the derivation ("spiral, 12 turns in 1 line + wall"), summed words per region
    const sums = op.records.map((r) => (r.cuts.find((c) => c.clearing && c.clearing.summary) || {}).clearing).filter(Boolean); // the cut that carries the plan (TASK 749: a Spiral's last line)
    typeWords = `${typeLabel} (${POCKET_CLEARING.patterns.find((p) => p.id === s.clearing.pattern).label.toLowerCase()})`; // TASK 749: the pattern's own label
    const words = [...new Set(sums.filter((c) => c.role !== 'refused').map((c) => clearingWords(c.summary)))];
    const refused = sums.filter((c) => c.role === 'refused').length;
    detail = [words.join('; '), refused ? `refused on ${refused}: cut as Freehand` : null].filter(Boolean).join(', ') || null;
  }
  if (s.leadIn) { // TASK 775 / 778: the row says "lead-in arc" (+ how many were refused, from the derivation)
    const refused = op.records.filter((r) => r.cuts.some((c) => c.leadIn && c.leadIn.role === 'refused')).length;
    const words = `lead-in arc ${s.leadIn.side}${refused ? ` (refused on ${refused})` : ''}`;
    detail = (detail ? detail + ', ' : '') + words;
  }
  if (s.offset) detail = (detail ? detail + ', ' : '') + `offset ${len(s.offset)}`;
  const what = [typeWords, depthText].filter(Boolean).join(' · ');
  const tail = detail ? ` · ${detail}` : '';
  return { typeLabel, depthText, detail, regions,
    rowText: what,                                                             // the row (the tool is its heading)
    label: `${op.tool ? op.tool.label + ' · ' : ''}${what} (${regions})${tail}` }; // "¼″ end mill · Pocket · 6 mm (3 regions)"
}

/** The heading of a run of operations with this tool: "Change to ¼″ end mill", or "Not cut" (Guide / Stock). */
export const toolHeading = (tool) => (tool ? `Change to ${tool.label}` : 'Not cut');

// TASK 792: a Roughing / Contour operation ranks as the plain cuts it makes (pockets 2, inside 3, outside 4: an outline's roughing frees the part); a Contour (the finish) after them
function levelsRank(op) {
  const t = cutTypeById(op.cutType);
  if (!t || !t.levelsOp) return undefined;
  const ranks = op.records.flatMap((r) => r.cuts.map((c) => (cutTypeById(c.rec && c.rec.cutType) || {}).opRank)).filter(Number.isFinite);
  return Math.max(t.opRank, ...ranks) + (t.levelsOp === 'contour' ? 0.5 : 0);
}
// each entry's cuts (#core/stepped-cut deriveCuts, as the exporter, Prepare and the 3D Review derive them), grouped by operation id: Map(opId -> [{ planKey, target, pick, rec, cuts, i }])
function entryCutsByOp(state, entries, geo = null) {
  const ents = (entries || []).filter((e) => e && e.target && e.rec && e.rec.cutType);
  const byOp = new Map();
  if (!ents.length) return byOp;
  const { loops, loopPolys, owned } = geo || plannedGeometry(state, ents);
  ents.forEach((e, i) => {
    const cuts = deriveCuts(e.target, effectiveCutRecord(e.rec), state, loops, loopPolys, owned) || [];
    if (!cuts.length) return;
    if (!byOp.has(e.opId)) byOp.set(e.opId, []);
    byOp.get(e.opId).push({ planKey: e.planKey, target: e.target, pick: parseKey(e.planKey), rec: e.rec, cuts, i }); // TASK 792: a Contour's planKey is `contour:<part key>`
  });
  return byOp;
}

/**
 * describeOperations(state, entries = planEntries()) → the STORED operations (operations-store.js, in list order) with their cuts and words on the solved sketch
 * `state`: [{ key (= id), id, tool, cutType, settings, records: [{ planKey, target, rec, cuts }], first, label, rowText, depthText, detail, regions, heading }]
 * (the words in the doc unit at the Length precision setting). A shape that derives to no cut (a stale target) is in no row; an operation none of whose shapes
 * derives a cut is not listed (S1: the list as before). TASK 798: + `on` (its tick, cut-plan.js isTicked) and `tickable` (false for the Stock: always exported, the
 * board every file is placed by); `frame` = the whole plan's entries when `entries` are the ticked ones (the hole ownership stays the whole plan's, as the export).
 */
export function describeOperations(state, entries = planEntries(), frame = null) {
  const ents = (entries || []).filter((e) => e && e.target && e.rec && e.rec.cutType);
  const byOp = entryCutsByOp(state, entries, frame && frame.length > ents.length ? plannedGeometry(state, frame.filter((e) => e && e.target && e.rec && e.rec.cutType)) : null); // TASK 798: the whole plan's hole ownership
  const ops = [];
  for (const stored of storeOps()) {
    const records = (byOp.get(stored.id) || []).map(({ i, ...r }) => r);
    const rec = records.length ? records[0].rec : { cutType: stored.type, ...stored.settings }; // TASK S2: EVERY operation is listed (an empty one, one that cuts nothing), with its own settings
    const op = { key: stored.id, id: stored.id, tool: toolOf(rec), cutType: stored.type, settings: settingsOf(rec), records, shapes: stored.geometry.map((r) => r.key), first: records.length ? byOp.get(stored.id)[0].i : Infinity, on: isTicked(stored), tickable: stored.type !== STOCK_TYPE_ID }; // TASK 798: its tick (the Stock: always, not tickable); TASK S2: `shapes` = its geometry keys
    op.rank = levelsRank(op);
    Object.assign(op, describe(op), { heading: toolHeading(op.tool) });
    if (!stored.geometry.length) op.regions = EMPTY_WORDS; // TASK S2
    else if (!records.length) { const n = stored.geometry.length; op.regions = `${n} shape${n === 1 ? '' : 's'}: nothing to cut`; } // TASK S2: listed all the same (it is opened from its row)
    ops.push(op);
  }
  return ops;
}

// an operation as the default-order rule reads it: { key, tool, cutType, settings, rank, first } (its shapes' records and cuts on `state`)
const EMPTY_STATE = Object.freeze({ joints: new Map(), shapes: [], constraints: [], profiles: [] });
// the loops of `state` and the loops the entries own (#core ownedLoopIds: never cut again as a hole)
function plannedGeometry(state, entries) {
  const { loops, loopPolys } = loopsWithPolygons(state);
  return { loops, loopPolys, owned: ownedLoopIds(entries, state, loops, loopPolys, CUT_TYPES) };
}
function orderView(state, op, entries, geo) {
  const recs = op.geometry.map((ref) => resolveEntry(planKeyOf(op, ref), recordOf(op, ref))).filter(Boolean);
  const rec = recs.length ? recs[0].rec : { cutType: op.type, ...op.settings };
  const levels = Boolean((cutTypeById(op.type) || {}).levelsOp); // only a Roughing / Contour ranks by its cuts
  const mine = levels ? entries.filter((e) => op.geometry.some((ref) => e.planKey === planKeyOf(op, ref))) : [];
  const records = [...(entryCutsByOp(state, mine.map((e) => ({ ...e, opId: 'x' })), levels ? geo() : null).get('x') || [])];
  return { key: op.id, tool: toolOf(rec), cutType: op.type, settings: settingsOf(rec), rank: levelsRank({ cutType: op.type, records }), first: Math.min(...op.geometry.map((r) => r.seq)) };
}
const OLD_GUIDE_KEY = JSON.stringify([null, 'guide', null]); // the one Guide operation's key before task S1 (a Guide declared no settings)
/**
 * migrationOrder(state, groups, storedOrder) -> the group keys in list order — TASK S1, docs/OPERATIONS-MODEL.md section 3 step 6: the v2 migration's operations
 * (`groups` = [{ key: the operation key, entries: [{ planKey, target, rec, n (the record's place in the plan) }] }]) ordered as the list showed them: orderOps over
 * the operations that derive a cut on the solved sketch `state` (as planOperations listed them before S1), in the stored order (old keys mapped by the caller; the
 * Guide key of before S1 stands for every Guide operation, in the default order); the groups that derive nothing (stale) after them, in plan order. Without a
 * state every group is listed (nothing is derived).
 */
export function migrationOrder(state, groups, storedOrder) {
  const all = groups.flatMap((g) => g.entries.map((e) => ({ ...e, opId: g.key }))).sort((a, b) => a.n - b.n);
  const byOp = state ? entryCutsByOp(state, all) : new Map();
  const views = [], stale = [];
  for (const g of groups) {
    const records = byOp.get(g.key) || [];
    if (state && !records.length) { stale.push(g.key); continue; }
    const rec = g.entries[0].rec;
    views.push({ key: g.key, tool: toolOf(rec), cutType: rec.cutType, settings: settingsOf(rec), rank: levelsRank({ cutType: rec.cutType, records }), first: records.length ? records[0].i : all.findIndex((e) => e.opId === g.key) });
  }
  const guides = defaultOpOrder(views.filter((v) => v.cutType === 'guide')).map((v) => v.key);
  const keys = (storedOrder || []).flatMap((k) => (k === OLD_GUIDE_KEY ? guides : [k]));
  return [...orderOps(views, keys).map((v) => v.key), ...stale];
}

/** TASK S1 (listOrder 'default', advisor ruling turn 2702): the stored operations' ids in the DEFAULT order (defaultOpOrder) on the solved sketch `state`: what the
 *  list is while the user has never reordered it, as before S1 (re-sorted after every change). */
export function defaultOrderIds(state) {
  const st = state || EMPTY_STATE;
  const entries = planEntries();
  let g = null; const geo = () => g || (g = plannedGeometry(st, entries)); // only a Roughing / Contour ranks by its cuts: the loops are read for one only
  return defaultOpOrder(storeOps().map((op) => orderView(st, op, entries, geo))).map((v) => v.key);
}

/** TASK S1: where a NEW operation (`draft` = { type, settings, geometry }) goes in the stored list: the default-order rule applied once (see the header), on the solved
 *  sketch `state` (a Roughing / Contour ranks by the cuts it makes). */
export function newOpIndex(state, draft) {
  const st = state || EMPTY_STATE;
  const ops = storeOps();
  const entries = planEntries();
  const draftEntries = draft.geometry.map((ref) => { const pk = planKeyOf(draft, ref), e = resolveEntry(pk, recordOf(draft, ref)); return e ? { ...e, planKey: pk } : null; }).filter(Boolean);
  let g = null; const geo = () => g || (g = plannedGeometry(st, [...entries, ...draftEntries]));
  const views = ops.map((op) => orderView(st, op, entries, geo));
  const mine = { ...orderView(st, { ...draft, id: '\u0000new' }, draftEntries, geo), key: '\u0000new' };
  const ordered = orderOps([...views, mine], ops.map((op) => op.id));
  return ordered.indexOf(mine);
}
