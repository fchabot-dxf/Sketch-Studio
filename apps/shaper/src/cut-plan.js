// apps/shaper/src/cut-plan.js — the Shaper Prepare CUT-PLAN store. Per-target cut assignments keyed by
// `${kind}:${id}`:
//   • `loop:<outerLoopId>`  — a derived profile (keeps its outer loop's key so saved plans still load)
//   • `profile:<profileId>` — an explicit combined profile (created via Combine)
//   • `chain:<chainId>`     — an open vector chain (replaces legacy edge:<shapeId>)
// Module-level so it PERSISTS across Prepare re-mounts (Design↔Prepare, re-enter). This is app STATE (not #core).
// Extracted from prepare-view.js (SP1j-4) so it is the SINGLE source of truth read by BOTH Prepare AND shaper-export.

import { defaultCutRecord, effectiveCutRecord } from './shaper.js';
import { deriveProfileCuts, deriveCutFootprint, deriveCutFootprintAt, resolveTargetKey } from '#core/profile-model.js';
import { deriveVcarveContours, vbitHalfAngleTan } from '#core/vcarve.js';
import { findLoops } from '#core/loop-finder.js';
import { loopPolygon } from '#core/loop-geometry.js';

export const keyOf = (kind, id) => kind + ':' + id;
export const parseKey = (key) => { const i = key.indexOf(':'); return { kind: key.slice(0, i), id: key.slice(i + 1) }; };

export const CUT_PLAN = new Map(); // key → cut record

export function getCutRecord(key) { return CUT_PLAN.get(key) || defaultCutRecord(); }
export function setFieldFor(key, field, value) { const rec = CUT_PLAN.get(key) || defaultCutRecord(); rec[field] = value; CUT_PLAN.set(key, rec); return rec; }

// All ASSIGNED entries (a cutType is set) → [{ target:{kind,id}, rec }] for the exporter. Loop targets are resolved
// against the live design at export time (findLoops), so a stale id simply yields nothing.
export function cutPlanEntries() {
  const out = [];
  for (const [key, rec] of CUT_PLAN) {
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
 * deriveKeyFootprints(key, storedRec, state, loops, loopPolys) — THE ONE composition of the cut derivations for one plan
 * target: effectiveCutRecord -> deriveProfileCuts -> deriveCutFootprint. Returns { rec, cuts, footprints } (rec = the effective
 * record the footprints were derived with), or null when the target derives to nothing (stale key). Both Prepare's preview
 * (computeLook) and the 3D Review (planReliefItems) call this; no cut geometry is computed here.
 * `loops` must carry the host-side `polygon` (see loopsWithPolygons); `loopPolys` = { [loop id]: polygon }.
 */
export function deriveKeyFootprints(key, storedRec, state, loops, loopPolys) {
  const rec = effectiveCutRecord(storedRec); // TASK 450: On line / Guide take no offset: a stored one is ignored
  const cuts = deriveProfileCuts(parseKey(key), rec, state, loops, loopPolys);
  if (!cuts || !cuts.length) return null;
  return { rec, cuts, footprints: deriveCutFootprint(cuts, rec, state) };
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
    if (!stored || !stored.cutType || carved.has(key)) continue;
    const d = deriveKeyFootprints(key, stored, state, loops, loopPolys);
    if (!d) continue;
    const shape = { cutterShape: stored.cutterShape || 'endmill', cutterAngle: stored.cutterAngle, toolDia: d.rec.toolDia };
    const at = new Map(); // halfWidth -> footprints (one derivation per width, shared by this key's footprints)
    const atW = (w) => { if (!at.has(w)) at.set(w, deriveCutFootprintAt(d.cuts, d.rec, state, w)); return at.get(w); };
    const geo = cutsSig(d.cuts, state);
    d.footprints.forEach((fp, i) => items.push({ key, sig: sigHash([i, d.rec, geo]), cutType: fp.cutType, cutDepth: d.rec.cutDepth, footprints: [fp], shape, footprintsAt: (w) => [atW(w)[i]].filter(Boolean) }));
  }
  return items;
}
