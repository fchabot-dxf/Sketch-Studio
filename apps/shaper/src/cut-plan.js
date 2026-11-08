// apps/shaper/src/cut-plan.js — the Shaper Prepare CUT-PLAN store. Per-target cut assignments keyed by
// `${kind}:${id}`:
//   • `loop:<outerLoopId>`  — a derived profile (keeps its outer loop's key so saved plans still load)
//   • `profile:<profileId>` — an explicit combined profile (created via Combine)
//   • `chain:<chainId>`     — an open vector chain (replaces legacy edge:<shapeId>)
// Module-level so it PERSISTS across Prepare re-mounts (Design↔Prepare, re-enter). This is app STATE (not #core).
// Extracted from prepare-view.js (SP1j-4) so it is the SINGLE source of truth read by BOTH Prepare AND shaper-export.

import { defaultCutRecord } from './shaper.js';

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
