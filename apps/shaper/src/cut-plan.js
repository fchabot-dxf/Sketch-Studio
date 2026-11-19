// apps/shaper/src/cut-plan.js — the Shaper Prepare CUT-PLAN store. Per-target cut assignments keyed by
// `${kind}:${id}`:
//   • `loop:<outerLoopId>`  — a derived profile (keeps its outer loop's key so saved plans still load)
//   • `profile:<profileId>` — an explicit combined profile (created via Combine)
//   • `chain:<chainId>`     — an open vector chain (replaces legacy edge:<shapeId>)
// Module-level so it PERSISTS across Prepare re-mounts (Design↔Prepare, re-enter). This is app STATE (not #core).
// Extracted from prepare-view.js (SP1j-4) so it is the SINGLE source of truth read by BOTH Prepare AND shaper-export.

import { defaultCutRecord, effectiveCutRecord, STOCK_TYPE_ID, cutTypeById } from './shaper.js';
import { deriveProfileCuts, deriveCutFootprint, deriveCutFootprintAt, makeProfile, ownedLoopIds, resolveProfileForLoop, derivedProfileForLoop, shapeIndexOf } from '#core/profile-model.js';
import { steppedTerraces, stepGaps, terraceOptions, deriveCuts, STEP_DEPTH, STEP_RESOLUTION, resolutionLevel } from '#core/stepped-cut.js';
import { docUnit, lengthText, angleText, areaText as coreAreaText } from '#core/settings-manager.js';
import { findLoops, findOpenChains } from '#core/loop-finder.js';
import { loopPolygon, pointInPolygon } from '#core/loop-geometry.js';
import { holdMode, holdDefaults } from '#core/hold-part.js'; // TASK 742: tabs / onion skin on an Outside / Inside cut
import { POCKET_CLEARING, clearingPattern, allowanceDefault, morphedBlocker } from '#core/pocket-clearing.js'; // TASK 745: the programmed pocket
import { outlineLeadIn, leadInSettings } from '#core/lead-in.js'; // TASK 775: an On line outline's lead-in

export const keyOf = (kind, id) => kind + ':' + id;
export const parseKey = (key) => { const i = key.indexOf(':'); return { kind: key.slice(0, i), id: key.slice(i + 1) }; };

export const CUT_PLAN = new Map(); // key → cut record

export function getCutRecord(key) { return CUT_PLAN.get(key) || defaultCutRecord(); }
export function setFieldFor(key, field, value) { const rec = CUT_PLAN.get(key) || defaultCutRecord(); rec[field] = value; CUT_PLAN.set(key, rec); return rec; }

// TASK 714: the STEP DEPTH a target switched to a stepped type gets when its record has none: the last step depth the user set on any stepped
// cut (owner turn 1947), STEP_DEPTH.defaultMm (#core/stepped-cut.js) until one is set. Base mm. App state, like CUT_PLAN.
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
 * 1 pass at 16 mm"; fewer tabs than asked: "only 2 of 4 tabs fit" (warning colour); a refused hold says why (warning colour; the cut is made without it).
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
      : HOLD_REFUSED[hold.error] || hold.error;
    const text = `${name}: ${what} refused: ${why}; cut without them`;
    return [{ text, warn: text.slice(name.length + 2), title: 'Hold part is not applied to this cut' }];
  }
  if (hold.mode === 'skin') return [{ text: `${name}: onion skin ${f(hold.thickness)} ${u}: 1 pass at ${f(hold.depth)} ${u}` }];
  if (hold.role === 'stroke') { // TASK 775: an On line cut's tabs: the gaps between its strokes are left uncut (the owner's wording)
    const n = hold.count, items = [{ text: `Tabs: ${n} gap${n === 1 ? '' : 's'} of ${f(hold.width)} ${u} left uncut; cut them by hand afterwards` }];
    if (n < hold.requested) { const t = ` (only ${n} of ${hold.requested} tabs fit)`; items[0].text += t; items[0].warn = t; items[0].title = 'the outline has too few stretches long enough for a tab'; }
    items.push({ text: `Each gap keeps ${f(hold.left)} ${u} of wood with a ${f(hold.toolDia)} ${u} bit (the gap minus the bit)` });
    return items;
  }
  const n = hold.count, gaps = `${n} gap${n === 1 ? '' : 's'}`;
  const items = [{ text: `${name}: ${n} tab${n === 1 ? '' : 's'}, ${f(hold.width)} ${u} wide, ${f(hold.thickness)} ${u} thick: 1 pass at ${f(hold.depth)} ${u} + ${gaps} at ${f(Number(hold.fullDepth))} ${u}` }];
  if (n < hold.requested) { const t = ` (only ${n} of ${hold.requested} tabs fit)`; items[0].text += t; items[0].warn = t; items[0].title = 'the outline has too few stretches long enough for a tab'; }
  items.push({ text: `Gaps: cut the side against the part; the return leg is optional` });
  return items;
}
/** TASK 742: the hold notes of every held record of the plan (the 3D Review's info). */
export function planHoldNotes(state, plan = CUT_PLAN) {
  const out = [];
  let geo = null;
  for (const [key, rec] of plan) {
    if (!rec || !rec.cutType || holdMode(effectiveCutRecord(rec)) === 'off') continue;
    if (!geo) { const { loops, loopPolys } = loopsWithPolygons(state); geo = { loops, loopPolys, owned: planOwnedLoops(state, loops, loopPolys, plan) }; }
    out.push(...holdNoteItems(rec, holdSummary(key, rec, state, geo.loops, geo.loopPolys, geo.owned)).map((i) => i.text));
  }
  return out;
}

// TASK 745: the PROGRAMMED POCKET. The last stepover / finish allowance / raster angle / Loop (TASK 750) set on any record are the next record's when its
// Clearing is first set to a computed pattern (null = never set: the declared default, #core POCKET_CLEARING; the allowance by document unit; Loop off).
// A new pocket's Clearing is Freehand (the default). App state, like the step depth above.
// TASK 775: the LEAD-IN. The last leg length / side set on any record are the next record's when its Lead-in is first turned On (length null = never set: one
// bit diameter, #core leadInSettings; side Outside). App state, like the step depth above.
let lastLeadInLengthV = null, lastLeadInSideV = 'outside';
export const lastLeadInLength = () => lastLeadInLengthV;
export function rememberLeadInLength(mm) { const n = Number(mm); if (n > 0) lastLeadInLengthV = n; return lastLeadInLengthV; }
export const lastLeadInSide = () => lastLeadInSideV;
export function rememberLeadInSide(v) { if (v === 'outside' || v === 'inside') lastLeadInSideV = v; return lastLeadInSideV; }
/**
 * leadInSummary(key, storedRec, state, loops, loopPolys, owned) — TASK 775: what an On line record's lead-in does, read off THE derivation (deriveCuts through the
 * effective record, as Prepare / Review / the export cut it): the `leadIn` of its outline cut (#core/lead-in applyLeadIn: role 'leg' with tip / junction / length /
 * side / at, or 'refused' with its error), or null when the record has none. (A programmed pocket's lead-in is in its clearing summary.)
 */
export function leadInSummary(key, storedRec, state, loops, loopPolys, owned) {
  const rec = effectiveCutRecord(storedRec);
  if (!outlineLeadIn(rec)) return null;
  const cuts = deriveCuts(parseKey(key), rec, state, loops, loopPolys, owned) || [];
  const c = cuts.find((x) => x.leadIn);
  return c ? { ...c.leadIn, r: leadInSettings(rec).r } : null;
}
/** TASK 775: the one line every lead-in note carries (the trade-off, owner's wording). */
export const LEAD_IN_TRADE_OFF = "Lead-in: you start at the leg's end; AutoPass then reverses at each end, so the cutting direction alternates.";
const LEAD_REFUSED = {
  'no length': 'set a bit diameter or a length',
  outline: 'the outline could not be read',
  room: 'another part of the outline is in the way of the leg: try the other side or a shorter leg',
};
/**
 * leadInNoteItems(storedRec, lead) — TASK 775: the card note of an On line outline's lead-in (doc unit), from its leadInSummary: "On line: lead-in 3.175 mm
 * outside, from the middle of the longest straight edge" + the trade-off line; a refused one says why (warning colour; the outline is cut as a closed loop).
 */
export function leadInNoteItems(storedRec, lead) {
  if (!lead || !storedRec) return [];
  const u = docUnit(), f = (mm) => lengthText(mm, { unit: u, show: 'field' });
  const name = (cutTypeById(storedRec.cutType) || {}).menuLabel || 'Cut';
  if (lead.role === 'refused' && lead.error === 'tabs') return [{ text: `${name}: no lead-in with tabs: each stroke has its own ends` }]; // the Lead-in row is hidden with Tabs; the stored choice waits
  if (lead.role === 'refused') {
    const why = lead.error === 'short' ? `the leg ${f(lead.length)} ${u} is shorter than the bit radius ${f(lead.r)} ${u}` : LEAD_REFUSED[lead.error] || lead.error;
    const text = `${name}: lead-in refused: ${why}; cut as a closed loop`;
    return [{ text, warn: text.slice(name.length + 2), title: 'the line is cut as a closed loop (no start point)' }];
  }
  return [{ text: `${name}: lead-in ${f(lead.length)} ${u} ${lead.side}, from the middle of the longest ${lead.at === 'line' ? 'straight edge' : 'segment'}` }, { text: LEAD_IN_TRADE_OFF }];
}
/** TASK 775: the lead-in notes of every On line outline with a lead-in (the 3D Review's info; a programmed pocket's are in its clearing notes). */
export function planLeadInNotes(state, plan = CUT_PLAN) {
  const out = [];
  let geo = null;
  for (const [key, rec] of plan) {
    if (!rec || !rec.cutType || !outlineLeadIn(effectiveCutRecord(rec))) continue;
    if (!geo) { const { loops, loopPolys } = loopsWithPolygons(state); geo = { loops, loopPolys, owned: planOwnedLoops(state, loops, loopPolys, plan) }; }
    out.push(...leadInNoteItems(rec, leadInSummary(key, rec, state, geo.loops, geo.loopPolys, geo.owned)).map((i) => i.text));
  }
  return out;
}

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
 */
export function clearingSummary(key, storedRec, state, loops, loopPolys, owned) {
  const rec = effectiveCutRecord(storedRec);
  if (clearingPattern(rec) === 'freehand') return null;
  const cuts = deriveCuts(parseKey(key), rec, state, loops, loopPolys, owned) || [];
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
  splits: 'splits at a neck narrower than the bit: use Spiral or Raster',
  'morphed islands': 'has islands: use Spiral or Raster',
  'morphed splits': 'splits at a neck narrower than the bit: use Spiral or Raster',
  'raster join': 'a raster pass cannot be joined to the next inside the pocket; cut as open passes + the wall',
  'islands close': 'an island is closer to the wall or to another island than the bit: the finish pass would cut it',
  'bit too big': 'the bit does not fit in the pocket',
  'no bit': 'set a bit diameter',
  outline: 'the outline could not be read',
  'lead-in short': 'the leg is shorter than the bit radius', // TASK 775: a programmed pocket's lead-in
  'lead-in room': 'no straight leg of that length fits inside the cleared area: try a shorter leg',
};
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
/** TASK 745: a pocket's clearing in a few words: "spiral, 12 turns in 1 line + wall" (TASK 749; several lines say why: "spiral, 14 turns in 3 lines (the
 *  pocket has islands) + wall"), "raster 0°: 22 passes + 1 ring + wall", "morphed spiral: 13 turns + wall"; TASK 750 Loop on: the turns + wall, then
 *  "one closed loop" ("3 closed loops (the pocket has islands)"; TASK 775: a closed loop has no start point on the Origin, so nothing says where it
 *  starts or ends); with a lead-in "one loop with a lead-in" ("3 loops with lead-ins (...)"). */
const LINES_WHY = { splits: ' (the pocket narrows)', islands: ' (the pocket has islands)' };
export function clearingWords(sum) {
  if (!sum || sum.refused) return null;
  const what = sum.pattern === 'raster' ? `raster ${angleText(Number(sum.settings.angle), { show: 'deg' })}: ${plural(sum.passes, 'pass', 'passes')} + ${plural(sum.cleanup, 'ring', 'rings')}`
    : sum.pattern === 'morphed' ? `morphed spiral: ${plural(sum.turns, 'turn', 'turns')}`
    : `spiral, ${plural(sum.loops, 'turn', 'turns')}${sum.loop ? '' : ` in ${plural(sum.lines, 'line', 'lines')}${sum.linesWhy ? LINES_WHY[sum.linesWhy] : ''}`}`;
  if (!sum.loop) return `${what} + wall`;
  const why = sum.linesWhy && sum.loopCount > 1 ? LINES_WHY[sum.linesWhy] : '';
  if (sum.leadIn) return `${what} + wall: ${sum.loopCount === 1 ? 'one loop with a lead-in' : `${sum.loopCount} loops with lead-ins${why}`}`; // TASK 775
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
  if (sum.clear.length) items.push({ text: `Drawn for a ${bit} bit: a smaller bit leaves ridges` });
  if (sum.loop) items.push({ text: `Wall cut in the same line: exact for a ${bit} bit only` }); // TASK 750: the Origin does not offset an on-line path
  if (sum.loopRefused) { const t = `Loop refused: ${CLEARING_REFUSED[sum.loopRefused] || sum.loopRefused}`; items.push({ text: t, warn: t, title: 'the pocket is cut with open paths + the Origin\'s inside cut on the wall' }); }
  if (sum.leadIn) items.push({ text: `Lead-in: ${sum.loopCount === 1 ? 'a leg' : `${sum.loopCount} legs`} of ${f(st.leadInLength)} ${u} from inside the cleared area to the loop` }, { text: LEAD_IN_TRADE_OFF }); // TASK 775
  if (sum.leadInRefused) { const t = `Lead-in refused: ${CLEARING_REFUSED[sum.leadInRefused] || sum.leadInRefused}`; items.push({ text: t, warn: t, title: 'the pocket is cut as closed loops (no start point)' }); }
  items.push({ text: 'Depth passes: set Pass Depth or AutoPass on the Origin' }); // TASK 750: the clearing is written once, at the full depth
  const lo = sum.leftover;
  if (lo && lo.area > POCKET_CLEARING.leftoverTolMm2) {
    let t = `${areaText(lo.area, u)} not reached by a ${bit} bit`;
    t += lo.missed > POCKET_CLEARING.leftoverTolMm2 ? ` (${areaText(lo.missed, u)} of it missed between passes: lower the stepover)` : ' (sharp inside corners, necks narrower than the bit)';
    items.push({ text: `Leftover: ${t}`, warn: t, title: 'material the bit does not reach (orange in Prepare)' });
  }
  return items;
}
/** TASK 745: the clearing notes of every programmed pocket of the plan (the 3D Review's info). */
export function planClearingNotes(state, plan = CUT_PLAN) {
  const out = [];
  let geo = null;
  for (const [key, rec] of plan) {
    if (!rec || !rec.cutType || clearingPattern(effectiveCutRecord(rec)) === 'freehand') continue;
    if (!geo) { const { loops, loopPolys } = loopsWithPolygons(state); geo = { loops, loopPolys, owned: planOwnedLoops(state, loops, loopPolys, plan) }; }
    out.push(...clearingNoteItems(rec, clearingSummary(key, rec, state, geo.loops, geo.loopPolys, geo.owned)).map((i) => i.text));
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
/** The note lines of every stepped record of the plan (the 3D Review's info). */
export function planSteppedNotes(plan = CUT_PLAN) {
  const out = [];
  for (const rec of plan.values()) if (rec && rec.cutType) out.push(...steppedNoteLines(rec));
  return out;
}

// All ASSIGNED entries (a cutType is set) → [{ target:{kind,id}, rec }] for the exporter. Loop targets are resolved
// against the live design at export time (findLoops), so a stale id simply yields nothing.
export function cutPlanEntries(plan = CUT_PLAN) {
  const out = [];
  for (const [key, rec] of plan) {
    if (rec && rec.cutType) { const { kind, id } = parseKey(key); out.push({ target: { kind, id }, rec }); }
  }
  return out;
}

/**
 * migrateEdgeRecords(loops, chains, plan = CUT_PLAN) → { dropped, moved }
 * For each `edge:<shapeId>` key:
 *   - if the shape is in a loop → delete the record and count it;
 *   - if it's in a chain whose `chain:<id>` key has no record → move it there;
 *   - otherwise delete it and count it.
 */
export function migrateEdgeRecords(loops, chains, plan = CUT_PLAN) {
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
 * reconcileCutPlan(state, plan = CUT_PLAN) -> { edgeMoved, edgeDropped, kept, removed } — THE reconciliation of a stored cut plan with the
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
export function reconcileCutPlan(state, plan = CUT_PLAN) {
  const loops = findLoops(state), chains = findOpenChains(state, loops);
  const { dropped: edgeDropped, moved: edgeMoved } = migrateEdgeRecords(loops, chains, plan);
  const loopIds = new Set(loops.map((l) => l.id)), chainIds = new Set(chains.map((c) => c.id));
  const shapeById = new Map((state.shapes || []).map((sh) => [sh.id, sh]));
  const shapeIds = new Set(shapeById.keys());
  const isBezier = (id) => (shapeById.get(id) || {}).type === 'bezier';
  const nearBezier = new Set(loops.filter((l) => l.edges.some(isBezier)).flatMap((l) => l.edges)); // the edges of loops that have a bezier edge
  const rename = new Map(), remove = new Set();
  for (const key of plan.keys()) {
    const { kind, id } = parseKey(key);
    const stale = (kind === 'chain' && !chainIds.has(id)) || (kind === 'loop' && !loopIds.has(id));
    if (!stale || !id.startsWith(kind + '_')) continue;
    const named = id.slice(kind.length + 1);
    if (kind === 'chain' && loopIds.has('loop_' + named) && !plan.has(keyOf('loop', 'loop_' + named))) { rename.set(key, keyOf('loop', 'loop_' + named)); continue; }
    const members = idsNamedBy(named, shapeIds);
    if (members && members.some((m) => isBezier(m) || nearBezier.has(m))) remove.add(key);
  }
  if (rename.size || remove.size) {
    const entries = [...plan];
    plan.clear();
    for (const [key, rec] of entries) if (!remove.has(key)) plan.set(rename.get(key) || key, rec);
  }
  return { edgeMoved, edgeDropped, kept: rename.size, removed: remove.size };
}

/**
 * keepHolesFromOtherSketches(state, plan = CUT_PLAN) -> { keptHoles, lostHoles } — TASK 774 (owner turn 2357), run ONCE where a Shaper document SAVED BEFORE
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
export function keepHolesFromOtherSketches(state, plan = CUT_PLAN) {
  const { loops, loopPolys } = loopsWithPolygons(state);
  const loopById = new Map(loops.map((l) => [l.id, l]));
  const shapeById = shapeIndexOf(state);
  const owned = ownedLoopIds(cutPlanEntries(plan), state, loops, loopPolys);
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
  if (rename.size) {
    const entries = [...plan];
    plan.clear();
    for (const [key, rec] of entries) plan.set(rename.get(key) || key, rec);
  }
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
  const rec = effectiveCutRecord(storedRec); // TASK 450: On line / Guide take no offset: a stored one is ignored
  const cuts = deriveCuts(parseKey(key), rec, state, loops, loopPolys, owned); // TASK 714: a stepped record derives to its terraces (the exporter's derivation too)
  if (!cuts || !cuts.length) return null;
  return { rec, cuts, footprints: deriveCutFootprint(cuts, rec, state) };
}

/** TASK 711: the loops that have their own record in `plan` (#core ownedLoopIds over the plan's assigned entries, the set the exporter
 *  derives from the same entries). */
export function planOwnedLoops(state, loops, loopPolys, plan = CUT_PLAN) {
  return ownedLoopIds(cutPlanEntries(plan), state, loops, loopPolys);
}

/** The loops of `state` with their host-side polygons (what Prepare and the exporter use) + the { id: polygon } map. */
export function loopsWithPolygons(state) {
  const shapeById = new Map((state.shapes || []).map((sh) => [sh.id, sh]));
  const loops = findLoops(state).map((l) => ({ ...l, polygon: loopPolygon(l, state, shapeById) }));
  return { loops, loopPolys: Object.fromEntries(loops.map((l) => [l.id, l.polygon])) };
}

// A content SIGNATURE for the Review's build cache (FNV-1a of the JSON text): equal signature = equal footprints, so the model can
// reuse the work of an earlier build. Covers the effective record and the cut GEOMETRY (polygons, chain joints), never object identity.
function sigHash(value) {
  const str = JSON.stringify(value); let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h.toString(36) + '.' + str.length.toString(36);
}
const cutsSig = (cuts, state) => cuts.map((c) => [c.kind, c.cutType, c.offsetSide, c.isCompound, c.polygon || null, c.outerPoly || null, c.holePolys || null,
  c.chain ? (c.chain.shapes || []).map((sh) => [sh, (sh.joints || []).map((id) => { const j = state.joints.get(id); return j ? [j.x, j.y] : null; })]) : null]);

/**
 * planReliefItems(state, plan = CUT_PLAN) — the cut plan as the 3D Review's input, one item per derived
 * footprint: [{ key, cutType, cutDepth, footprints:[fp], shape, footprintsAt }], via deriveKeyFootprints / deriveCutFootprintAt
 * (the same derivation at another cutter half-width). Stale keys derive to nothing, as in the exporter.
 */
export function planReliefItems(state, plan = CUT_PLAN) {
  const { loops, loopPolys } = loopsWithPolygons(state);
  const owned = planOwnedLoops(state, loops, loopPolys, plan);
  const items = [];

  for (const [key, stored] of plan) {
    if (!stored || !stored.cutType || stored.cutType === STOCK_TYPE_ID) continue; // a Stock loop is the board, not a cut (planStockProfile)
    const d = deriveKeyFootprints(key, stored, state, loops, loopPolys, owned);
    if (!d) continue;
    const shape = { cutterShape: stored.cutterShape || 'endmill', cutterAngle: stored.cutterAngle, toolDia: d.rec.toolDia };
    const at = new Map(); // halfWidth -> footprints (one derivation per width, shared by this key's footprints)
    const atW = (w) => { if (!at.has(w)) at.set(w, deriveCutFootprintAt(d.cuts, d.rec, state, w)); return at.get(w); };
    const geo = cutsSig(d.cuts, state);
    d.footprints.forEach((fp, i) => items.push({ key, sig: sigHash([i, d.rec, geo]), cutType: fp.cutType, cutDepth: fp.terrace ? fp.terrace.depth : fp.hold && fp.hold.depth != null ? fp.hold.depth : d.rec.cutDepth, footprints: [fp], shape, footprintsAt: (w) => [atW(w)[i]].filter(Boolean) })); // TASK 714: a terrace at its own depth; TASK 742: a held cut's pass / gap strip at its own
  }
  return items;
}


/** The key of the Stock loop in the plan ('loop:<id>' | 'profile:<id>'), or null. ONE stock per document: Prepare moves the role, and if a
 *  loaded document somehow holds two, the first in the plan wins. */
export function stockKeyOf(plan = CUT_PLAN) {
  for (const [key, rec] of plan) if (rec && rec.cutType === STOCK_TYPE_ID) return key;
  return null;
}

/**
 * planStockProfile(state, plan = CUT_PLAN) — TASK 472: the board profile of the Stock loop, or null when there is none (or it no longer
 * derives to a loop). { key, thickness (base mm, or null when unset), outer, holes (closed rings [[x,y],...]), sig }. The rings are the
 * loop polygons the derivation already yields for the target (deriveProfileCuts): the outer loop, and the holes of an explicit combined profile.
 * No geometry is computed here.
 */
export function planStockProfile(state, plan = CUT_PLAN) {
  const key = stockKeyOf(plan);
  if (!key) return null;
  const { loops, loopPolys } = loopsWithPolygons(state);
  const rec = effectiveCutRecord(plan.get(key));
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
 * assignImportedCuts(state, cutRecordByDesc, plan = CUT_PLAN) — TASK 478: connect the cut metadata an SVG import carried (one record per
 * source element, keyed by the shapes' `descId`) to the plan; returns how many cuts were assigned.
 *  - an element that forms ONE closed loop -> 'loop:<id>' (as before);
 *  - a COMPOUND element (several closed subpaths in one <path>: the Fusion add-in's pocket with an island) -> its biggest loop is the outer,
 *    the loops inside it are its HOLES, and the plan gets ONE explicit combined profile ('profile:<id>', makeProfile) with the record: a
 *    pocket with a hole, not two separate pockets (the island must stay uncut); subpaths outside the outer keep their own loop record;
 *  - an open chain keeps today's rule (On Line / Guide, or any record with a depth).
 */
export function assignImportedCuts(state, cutRecordByDesc, plan = CUT_PLAN) {
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
    if (list.length === 1) { plan.set(keyOf('loop', list[0].id), { ...rec }); n++; continue; }
    const sorted = [...list].sort((a, b) => polyArea(b.polygon) - polyArea(a.polygon));
    const outer = sorted[0];
    const inside = sorted.slice(1).filter((l) => pointInPolygon(outer.polygon, l.polygon[0]));
    const apart = sorted.slice(1).filter((l) => !inside.includes(l));
    if (inside.length) { const prof = makeProfile(state, outer, inside); plan.set(keyOf('profile', prof.id), { ...rec }); n++; }
    else { plan.set(keyOf('loop', outer.id), { ...rec }); n++; }
    for (const l of apart) { plan.set(keyOf('loop', l.id), { ...rec }); n++; }
  }
  for (const c of findOpenChains(state, loops)) {
    for (const sh of (c.shapes || [])) {
      if (!sh.descId || !cutRecordByDesc.has(sh.descId)) continue;
      const rec = cutRecordByDesc.get(sh.descId);
      if (rec.cutType === 'online' || rec.cutType === 'guide' || (rec.cutDepth != null && rec.cutDepth !== 'unset')) {
        const chainKey = keyOf('chain', c.id);
        if (!plan.has(chainKey)) { plan.set(chainKey, { ...rec, cutType: rec.cutType || 'online' }); n++; }
      }
    }
  }
  return n;
}
