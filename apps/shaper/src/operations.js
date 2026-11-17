// apps/shaper/src/operations.js — TASK 743: Shaper's OPERATIONS (owner turns 2099-2101 + 2145: "an op list, that's actually a group of Origin paths per op").
// An operation = the cut records that share the same TOOL (cutter shape + bit diameter, + the angle of a V-bit), the same CUT TYPE and the same
// CUTTING SETTINGS (the params the type declares: depth, offset; a stepped type's step depth / adaptive resolution; a held cut's Tabs / Onion skin
// values). It is DERIVED from the cut plan every time (planOperations): nothing about an operation is stored but its place in the ORDER, the one
// thing the user adds (OP_ORDER: the operation keys in the user's order, per document, saved with the cut plan and undone with it: shaper-doc.js).
// Guides and the Stock are not cut: one operation each (no tool), under the heading "Not cut".
//
// DEFAULT ORDER (no order stored, and where a NEW operation slots into a stored one):
//  1. by tool: the tools whose LAST cut frees the least come first, so the cut that frees the part (outside) is in the last tool's group and every
//     hole / pocket is cut while the part is still held. A tool's rank = the highest opRank (shaper.js CUT_TYPES) of its operations; ties: the
//     smaller bit first (fine detail before the heavy cut), then cutter shape, then V-bit angle. Not "smallest bit first" alone: that would put an
//     outside cut with a 1/8 in bit before a 1/4 in bit's inside holes, freeing the part before its holes are cut. Not "as first used": the plan's
//     order is the order the user happened to click regions in, which says nothing about the cutting order.
//  2. inside one tool: by opRank (on line, pockets, inside = holes, outside last: holes before the part is freed, pockets before through cuts),
//     then shallow before deep (unset depth last), then the smaller offset, then the plan's order.
//  A new operation (not in the stored order) is put right after the operation that comes before it in the default order (at the top when none does).
// INSIDE an operation the paths are in the plan's order of its regions, and per region in the derivation's order (#core/stepped-cut deriveCuts): an
// Outside plate's own holes before its outline, a stepped cut's terraces shallow to deep, a held cut's pass before its gap strips.
import { cutTypeById, cutTypeHasParam, effectiveCutRecord, CUTTER_SHAPES, BIT_PRESETS } from './shaper.js';
import { keyOf, loopsWithPolygons, steppedSummary } from './cut-plan.js';
import { ownedLoopIds } from '#core/profile-model.js';
import { deriveCuts, terraceOptions, resolutionLevel, STEP_DEPTH } from '#core/stepped-cut.js';
import { holdMode } from '#core/hold-part.js';
import { format as formatUnit } from '#core/units.js';
import { docUnit, lengthDecimals } from '#core/settings-manager.js';

// ── the user's ORDER (operation keys), per document: the one stored fact ──
let order = [];
/** The stored operation order (keys), [] = the default order. */
export const opOrder = () => order.slice();
/** Replace the stored order (keys; anything else is dropped). */
export function setOpOrder(keys) { order = Array.isArray(keys) ? keys.filter((k) => typeof k === 'string') : []; }

const round6 = (n) => Math.round(Number(n) * 1e6) / 1e6;
const isSet = (d) => d != null && d !== 'unset' && Number.isFinite(Number(d));
const depthOf = (d) => (isSet(d) ? round6(d) : 'unset');

/** A length in the document unit, as the cut card's notes write it ("6 mm", "0.25 in"), at the Length precision setting; `display: false` = the
 *  setting's Auto (4 decimals in inches, 3 otherwise): the words the exported FILE carries (its <title>), which a display setting must not change. */
export function lengthLabel(mm, { display = true } = {}) {
  const u = docUnit(), auto = u === 'in' ? 4 : 3;
  return `${Number(formatUnit(mm, u, { decimals: display ? lengthDecimals(auto) : auto }))} ${u}`;
}
const DISPLAY = (mm) => lengthLabel(mm), FILE = (mm) => lengthLabel(mm, { display: false });

/** A tool's name with lengths written by `len`: "¼″ end mill", "6 mm ball nose", "⅛″ 60° V-bit" (a bit of a BIT_PRESETS size goes by its fraction). */
function toolName(tool, len) {
  const preset = BIT_PRESETS.find((p) => Math.abs(p.value - tool.dia) < 1e-6);
  const size = tool.dia > 0 ? (preset ? `${preset.label}″` : len(tool.dia)) : 'no bit size';
  return [size, tool.angle != null ? `${tool.angle}°` : null, CUTTER_SHAPES.find((s) => s.id === tool.shape).label].filter(Boolean).join(' ');
}

/** The TOOL of a stored record: null for a type that is not cut (Guide, Stock); else { key, shape, dia, angle, label } (label: its name, toolName). */
export function toolOf(rec) {
  const t = rec && cutTypeById(rec.cutType);
  if (!t || t.opRank === 0) return null;
  const shape = CUTTER_SHAPES.some((s) => s.id === rec.cutterShape) ? rec.cutterShape : 'endmill';
  const dia = Number(rec.toolDia) > 0 ? round6(rec.toolDia) : 0;
  const angle = shape === 'vbit' ? Number(rec.cutterAngle) || 90 : null;
  const tool = { key: `${shape}|${dia}|${angle ?? ''}`, shape, dia, angle };
  return { ...tool, label: toolName(tool, DISPLAY) };
}

/** The CUTTING SETTINGS of a stored record that make two records one operation (the params its type declares, base mm), or null for a type not cut. */
export function settingsOf(rec) {
  const t = rec && cutTypeById(rec.cutType);
  if (!t || t.opRank === 0) return null;
  const s = {};
  if (cutTypeHasParam(rec.cutType, 'cutDepth')) s.depth = depthOf(rec.cutDepth);
  if (cutTypeHasParam(rec.cutType, 'cutOffset')) s.offset = round6(Number(rec.cutOffset) || 0);
  const eff = effectiveCutRecord(rec);
  if (eff.terraceAs) { // a stepped type: the step depth, or the adaptive resolution (#core terraceOptions: what the terraces are made with)
    const o = terraceOptions(eff);
    s.steps = o.deviation != null ? { deviation: round6(o.deviation) } : { step: round6(Number(o.step) > 0 ? o.step : STEP_DEPTH.defaultMm) };
  }
  const m = holdMode(eff); // TASK 742: a held cut's mode and its values (Off adds nothing)
  if (m === 'tabs') s.hold = { mode: m, count: rec.tabCount === 'auto' || !(Number(rec.tabCount) >= 1) ? 'auto' : Math.floor(Number(rec.tabCount)), width: round6(rec.tabWidth), thickness: round6(rec.holdThickness) };
  if (m === 'skin') s.hold = { mode: m, thickness: round6(rec.holdThickness) };
  return s;
}

/** The operation key of a stored record: tool + cut type + settings (Guide / Stock: the type alone). */
export function opKeyOf(rec) {
  const tool = toolOf(rec);
  return JSON.stringify([tool ? tool.key : null, rec.cutType, settingsOf(rec)]);
}

const rankOf = (op) => (cutTypeById(op.cutType) || {}).opRank ?? 9;
const depthNum = (op) => (op.settings && isSet(op.settings.depth) ? op.settings.depth : Infinity);
const shapeIndex = (tool) => CUTTER_SHAPES.findIndex((s) => s.id === tool.shape);

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
  const inTool = (a, b) => rankOf(a) - rankOf(b) || depthNum(a) - depthNum(b) || ((a.settings && a.settings.offset) || 0) - ((b.settings && b.settings.offset) || 0) || a.first - b.first;
  return [...tools.values()].sort(byTool).flatMap((g) => g.ops.sort(inTool));
}

/** `ops` in the stored order `keys`; an operation not in it slots in after its default-order predecessor (see the header). */
export function orderOps(ops, keys = order) {
  const def = defaultOpOrder(ops.slice());
  const byKey = new Map(ops.map((op) => [op.key, op]));
  const out = [];
  for (const k of keys) if (byKey.has(k) && !out.includes(k)) out.push(k);
  if (!out.length) return def;
  def.forEach((op, i) => {
    if (out.includes(op.key)) return;
    let at = 0;
    for (let j = i - 1; j >= 0; j--) { const p = out.indexOf(def[j].key); if (p >= 0) { at = p + 1; break; } }
    out.splice(at, 0, op.key);
  });
  return out.map((k) => byKey.get(k));
}

// an XML id for an operation (ASCII, base mm), the same whatever the order: its type, depth, the settings that are not the default (offset, the step or
// the adaptive resolution, tabs / onion skin) and its tool; a clash (two operations that differ only by a tab count / width / thickness) gets -2, -3 by key order
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9.]+/g, '-').replace(/^-+|-+$/g, '');
const numText = (n) => String(round6(n));
function assignIds(ops) {
  const base = (op) => { const s = op.settings || {}; return 'op-' + [op.cutType, s.depth !== undefined ? (s.depth === 'unset' ? 'unset' : numText(s.depth) + 'mm') : null,
    s.offset ? `offset-${numText(s.offset)}mm` : null, s.steps ? (s.steps.deviation != null ? `adaptive-${numText(s.steps.deviation)}mm` : `step-${numText(s.steps.step)}mm`) : null,
    s.hold ? s.hold.mode : null, op.tool ? `${op.tool.shape}-${numText(op.tool.dia)}mm${op.tool.angle != null ? '-' + op.tool.angle + 'deg' : ''}` : null].filter(Boolean).map(slug).join('-'); };
  const seen = new Map();
  for (const op of [...ops].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))) {
    const b = base(op), n = (seen.get(b) || 0) + 1;
    seen.set(b, n);
    op.id = n === 1 ? b : `${b}-${n}`;
  }
}

// the words of an operation, lengths written by `len`: { depthText, detail, regions, rowText, label }
function describe(op, len) {
  const type = cutTypeById(op.cutType);
  const typeLabel = (type && type.menuLabel) || op.cutType;
  const s = op.settings || {};
  const n = op.records.length, chains = op.records.every((r) => r.target.kind === 'chain');
  const regions = `${n} ${chains ? (n === 1 ? 'path' : 'paths') : (n === 1 ? 'region' : 'regions')}`;
  let depthText = s.depth === undefined ? null : s.depth === 'unset' ? 'depth unset' : len(s.depth);
  let detail = null;
  if (s.steps) { // a stepped operation: its steps (the terraces' depths over its regions) and the step / resolution
    const sums = op.records.map((r) => steppedSummary(r.rec)).filter((x) => x && !x.error);
    const counts = sums.map((x) => x.count), depths = sums.flatMap((x) => x.depths);
    if (depths.length) depthText = `${Math.min(...depths) === Math.max(...depths) ? '' : len(Math.min(...depths)).split(' ')[0] + '–'}${len(Math.max(...depths))}`;
    const lo = Math.min(...counts), hi = Math.max(...counts);
    if (counts.length) detail = `${lo === hi ? lo : `${lo}–${hi}`} step${hi === 1 ? '' : 's'}` + (s.steps.deviation != null ? `, adaptive ${(resolutionLevel(s.steps.deviation) || { label: 'Custom' }).label}` : '');
  }
  if (s.hold) { // a held operation: its pass and its gap strips (summed over its regions), from the derivation
    const holds = op.records.map((r) => (r.cuts.find((c) => c.hold && c.hold.role !== 'strip') || {}).hold).filter(Boolean);
    const pass = holds.find((h) => h.role === 'pass');
    if (pass) {
      const gaps = op.records.reduce((sum, r) => sum + r.cuts.filter((c) => c.hold && c.hold.role === 'strip').length, 0);
      depthText = pass.mode === 'skin' ? `pass ${len(pass.depth)}` : `pass ${len(pass.depth)} + gaps ${len(Number(pass.fullDepth))}`;
      detail = pass.mode === 'skin' ? `onion skin ${len(pass.thickness)}` : `${gaps} gap${gaps === 1 ? '' : 's'} (tabs ${len(pass.width)} wide, ${len(pass.thickness)} thick)`;
    }
    if (holds.some((h) => h.role === 'refused')) detail = (detail ? detail + ', ' : '') + `${s.hold.mode === 'skin' ? 'onion skin' : 'tabs'} refused on ${holds.filter((h) => h.role === 'refused').length}`;
  }
  if (s.offset) detail = (detail ? detail + ', ' : '') + `offset ${len(s.offset)}`;
  const what = [typeLabel, depthText].filter(Boolean).join(' · ');
  const tail = detail ? ` · ${detail}` : '';
  return { typeLabel, depthText, detail, regions,
    rowText: what,                                                             // the row (the tool is its heading)
    label: `${op.tool ? toolName(op.tool, len) + ' · ' : ''}${what} (${regions})${tail}` }; // "¼″ end mill · Pocket · 6 mm (3 regions)"
}

/** The heading of a run of operations with this tool: "Change to ¼″ end mill", or "Not cut" (Guide / Stock). */
export const toolHeading = (tool) => (tool ? `Change to ${tool.label}` : 'Not cut');

/**
 * planOperations(state, entries, keys = the stored order) → the operations of the cut plan `entries` (cutPlanEntries(): [{ target, rec }] in plan order) on the
 * solved sketch `state`, in order: [{ key, id, tool, cutType, settings, records: [{ planKey, target, rec, cuts }], first, label, rowText, depthText, detail,
 * regions, heading, title }]: the words at the Length precision setting (the lists), `title` = the label at its Auto (the exported group's <title>).
 * A record that derives to no cut (a stale target) is in no operation. `cuts` = that record's cuts (#core/stepped-cut deriveCuts, as the exporter, Prepare
 * and the 3D Review derive them).
 */
export function planOperations(state, entries, keys = order) {
  const ents = (entries || []).filter((e) => e && e.target && e.rec && e.rec.cutType);
  if (!ents.length) return [];
  const { loops, loopPolys } = loopsWithPolygons(state);
  const owned = ownedLoopIds(ents, state, loops, loopPolys);
  const byKey = new Map();
  ents.forEach((e, i) => {
    const cuts = deriveCuts(e.target, effectiveCutRecord(e.rec), state, loops, loopPolys, owned) || [];
    if (!cuts.length) return;
    const key = opKeyOf(e.rec);
    if (!byKey.has(key)) byKey.set(key, { key, tool: toolOf(e.rec), cutType: e.rec.cutType, settings: settingsOf(e.rec), records: [], first: i });
    byKey.get(key).records.push({ planKey: keyOf(e.target.kind, e.target.id), target: e.target, rec: e.rec, cuts });
  });
  const ops = [...byKey.values()];
  assignIds(ops);
  for (const op of ops) Object.assign(op, describe(op, DISPLAY), { heading: toolHeading(op.tool), title: describe(op, FILE).label });
  return orderOps(ops, keys);
}

/** The exporter's entries for `entries`: each operation's records in operation order, each carrying its `op` ({ id, title, heading, text }: one SVG <g>;
 *  heading and text = its tool heading and its words as Prepare's list shows them, for the Export step's preview copy only), then the
 *  records in no operation (they cut nothing, but a hole's own record still keeps its plate from cutting it: #core ownedLoopIds), in plan order. */
export function opEntries(ops, entries) {
  const out = [];
  const inOp = new Set();
  for (const op of ops) for (const r of op.records) { inOp.add(r.planKey); out.push({ target: r.target, rec: r.rec, op: { id: op.id, title: op.title, heading: op.heading, text: [op.rowText, op.regions, op.detail].filter(Boolean).join(' · ') } }); }
  for (const e of entries || []) if (e && e.target && !inOp.has(keyOf(e.target.kind, e.target.id))) out.push(e);
  return out;
}
