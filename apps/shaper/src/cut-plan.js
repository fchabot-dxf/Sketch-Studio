// apps/shaper/src/cut-plan.js — the Shaper Prepare CUT-PLAN store. Per-target cut assignments keyed by
// `${kind}:${id}`:
//   • `loop:<outerLoopId>`  — a derived profile (keeps its outer loop's key so saved plans still load)
//   • `profile:<profileId>` — an explicit combined profile (created via Combine)
//   • `chain:<chainId>`     — an open vector chain (replaces legacy edge:<shapeId>)
// Module-level so it PERSISTS across Prepare re-mounts (Design↔Prepare, re-enter). This is app STATE (not #core).
// Extracted from prepare-view.js (SP1j-4) so it is the SINGLE source of truth read by BOTH Prepare AND shaper-export.

import { defaultCutRecord, effectiveCutRecord, STOCK_TYPE_ID, cutTypeById } from './shaper.js';
import { deriveProfileCuts, deriveCutFootprint, deriveCutFootprintAt, resolveTargetKey, makeProfile, ownedLoopIds } from '#core/profile-model.js';
import { steppedTerraces, stepGaps, terraceOptions, deriveCuts, STEP_DEPTH, STEP_RESOLUTION, resolutionLevel } from '#core/stepped-cut.js';
import { format as formatUnit } from '#core/units.js';
import { docUnit } from '#core/settings-manager.js';
import { deriveVcarveContours, vbitHalfAngleTan } from '#core/vcarve.js';
import { findLoops, findOpenChains } from '#core/loop-finder.js';
import { loopPolygon, pointInPolygon } from '#core/loop-geometry.js';

export const keyOf = (kind, id) => kind + ':' + id;
export const parseKey = (key) => { const i = key.indexOf(':'); return { kind: key.slice(0, i), id: key.slice(i + 1) }; };

export const CUT_PLAN = new Map(); // key → cut record

export function getCutRecord(key) { return CUT_PLAN.get(key) || defaultCutRecord(); }
export function setFieldFor(key, field, value) { const rec = CUT_PLAN.get(key) || defaultCutRecord(); rec[field] = value; CUT_PLAN.set(key, rec); return rec; }

// TASK 714: the STEP DEPTH a target switched to a stepped type gets when its record has none: the last step depth the user set on any stepped
// cut (owner turn 1947), STEP_DEPTH.defaultMm (#core/stepped-cut.js) until one is set. Base mm, never below STEP_DEPTH.minMm. App state, like CUT_PLAN.
let lastStep = STEP_DEPTH.defaultMm;
export const lastStepDepth = () => lastStep;
export function rememberStepDepth(mm) { const n = Number(mm); if (n > 0) lastStep = Math.max(STEP_DEPTH.minMm, n); return lastStep; }
// TASK 717: ADAPTIVE stepping, per record (`adaptiveSteps`, default OFF) with its RESOLUTION (`stepDeviation`, base mm, #core STEP_RESOLUTION): the last
// values set on any stepped cut are the next record's (switched to a stepped type) defaults, as for the step depth.
let lastAdaptive = false;
let lastDeviation = STEP_RESOLUTION.defaultMm;
export const lastAdaptiveSteps = () => lastAdaptive;
export function rememberAdaptiveSteps(on) { lastAdaptive = on === true; return lastAdaptive; }
export const lastStepDeviation = () => lastDeviation;
export function rememberStepDeviation(mm) { const n = Number(mm); if (n > 0) lastDeviation = Math.max(STEP_RESOLUTION.minMm, n); return lastDeviation; }
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
  const u = docUnit(), f = (mm) => String(Number(formatUnit(mm, u, { decimals: 3 })));
  const name = s.label || (cutTypeById(storedRec.cutType) || {}).menuLabel || 'Stepped cut';
  if (s.error) return [{ text: `${name}: the slope could not be read (${s.error}): nothing is cut` }];
  const n = `${s.count} step${s.count === 1 ? '' : 's'}`;
  const g = (mm) => String(Number(formatUnit(mm, u, { decimals: u === 'in' ? 4 : 2 })));
  const item = { text: s.deviation === null
    ? `${name}: ${n}, ${s.count > 1 ? `${f(s.depths[0])} to ` : ''}${f(s.depths[s.depths.length - 1])} ${u}`
    : `${name}: adaptive, ${(resolutionLevel(s.deviation) || { label: 'Custom' }).label} (${g(s.deviation)} ${u}): ${n} at ${s.depths.map(g).join(' \u00b7 ')} ${u}` };
  if (s.gaps.length) {
    const lo = Math.min(...s.gaps), hi = Math.max(...s.gaps);
    const spacing = ` \u00b7 outlines ${g(lo) === g(hi) ? g(lo) : `${g(lo)}\u2013${g(hi)}`} ${u} apart`;
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
 * migrateEdgeRecords(loops, chains, plan = CUT_PLAN, vcarves = null) → { dropped, moved, vcarveUpdated }
 * For each `edge:<shapeId>` key:
 *   - if the shape is in a loop → delete the record and count it;
 *   - if it's in a chain whose `chain:<id>` key has no record → move it there;
 *   - otherwise delete it and count it.
 * For each vcarve in `vcarves` with a bare loop/profile id (no ':'):
 *   - converts it to the canonical 'loop:<id>' or 'profile:<id>' format.
 */
export function migrateEdgeRecords(loops, chains, plan = CUT_PLAN, vcarves = null) {
  const loopEdgeIds = new Set();
  const loopIds = new Set();
  for (const l of (loops || [])) {
    loopIds.add(l.id);
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
  let vcarveUpdated = 0;

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

  if (Array.isArray(vcarves)) {
    for (const vc of vcarves) {
      if (vc && vc.region && typeof vc.region === 'string' && !vc.region.includes(':')) {
        if (loopIds.has(vc.region)) {
          vc.region = 'loop:' + vc.region;
          vcarveUpdated++;
        } else if (vc.region.startsWith('profile-')) {
          vc.region = 'profile:' + vc.region;
          vcarveUpdated++;
        }
      }
    }
  }

  return { dropped, moved, vcarveUpdated };
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

// Terraces per V-carve ring: each contour ring is one V-bit pass (exactly what the exporter emits as an On Line cut at the ring's
// depth); 3 slices read as the V, and a big stack (many rings) drops to 1 to stay inside the triangle budget.
const VCARVE_SLICES = 3, VCARVE_BIG_STACK = 40;

/**
 * planReliefItems(state, plan = CUT_PLAN) — the cut plan + the V-carves as the 3D Review's input, one item per derived
 * footprint: [{ key, cutType, cutDepth, footprints:[fp], shape, footprintsAt }], via deriveKeyFootprints / deriveCutFootprintAt
 * (the same derivation at another cutter half-width). Stale keys derive to nothing, as in the exporter. A region that has a
 * V-carve is NOT also cut by its plan entry (the exporter drops it the same way).
 */
export function planReliefItems(state, plan = CUT_PLAN) {
  const { loops, loopPolys } = loopsWithPolygons(state);
  const owned = planOwnedLoops(state, loops, loopPolys, plan);
  const items = [];

  // V-carve: every contour ring = a V-bit On Line pass at the ring's own depth (deriveVcarveContours is the ONE derivation).
  const carved = new Set();
  for (const vc of (state.vcarves || [])) {
    if (!vc || !vc.region) continue;
    const spec = resolveTargetKey(vc.region, state, loops, loopPolys);
    if (!spec || spec.invalid || !spec.outer) continue;
    carved.add(keyOf('loop', spec.outer)); if (spec.profileId) carved.add(keyOf('profile', spec.profileId));
    const boundary = loopPolys[spec.outer];
    if (!boundary || boundary.length < 3) continue;
    const holes = (spec.inners || []).map((hid) => loopPolys[hid]).filter((p) => p && p.length >= 3);
    const contours = deriveVcarveContours(boundary, vc, { holes });
    const angle = (vc.vbit && vc.vbit.angle) || 90, tan = vbitHalfAngleTan(angle);
    const slices = contours.length > VCARVE_BIG_STACK ? 1 : VCARVE_SLICES;
    for (const c of contours) {
      const rec = { cutType: 'online', cutDepth: c.depth, cutOffset: 0, toolDia: 2 * c.depth * tan, cutterShape: 'vbit', cutterAngle: angle, autoOffset: 0 };
      const cuts = [{ kind: 'loop', polygon: c.polygon, cutType: 'online', offsetSide: 0, isCompound: false }];
      items.push({ key: 'vcarve:' + (vc.id || ''), sig: sigHash(['vc', rec, slices, cutsSig(cuts, state)]), cutType: 'online', cutDepth: c.depth, footprints: deriveCutFootprint(cuts, rec, state),
        shape: { cutterShape: 'vbit', cutterAngle: angle, toolDia: rec.toolDia }, slices, footprintsAt: (w) => deriveCutFootprintAt(cuts, rec, state, w) });
    }
  }

  for (const [key, stored] of plan) {
    if (!stored || !stored.cutType || carved.has(key) || stored.cutType === STOCK_TYPE_ID) continue; // a Stock loop is the board, not a cut (planStockProfile)
    const d = deriveKeyFootprints(key, stored, state, loops, loopPolys, owned);
    if (!d) continue;
    const shape = { cutterShape: stored.cutterShape || 'endmill', cutterAngle: stored.cutterAngle, toolDia: d.rec.toolDia };
    const at = new Map(); // halfWidth -> footprints (one derivation per width, shared by this key's footprints)
    const atW = (w) => { if (!at.has(w)) at.set(w, deriveCutFootprintAt(d.cuts, d.rec, state, w)); return at.get(w); };
    const geo = cutsSig(d.cuts, state);
    d.footprints.forEach((fp, i) => items.push({ key, sig: sigHash([i, d.rec, geo]), cutType: fp.cutType, cutDepth: fp.terrace ? fp.terrace.depth : d.rec.cutDepth, footprints: [fp], shape, footprintsAt: (w) => [atW(w)[i]].filter(Boolean) })); // TASK 714: a terrace at its own depth
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
