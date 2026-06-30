// apps/shaper/src/cut-plan.js — the Shaper Prepare CUT-PLAN store. Per-target cut assignments keyed by
// `${kind}:${id}`. Module-level so it PERSISTS across Prepare re-mounts (Design↔Prepare, re-enter) — loop ids are
// deterministic (SP1b) + edge ids are stable. This is app STATE (not a pure algorithm → NOT #core). Extracted from
// prepare-view.js (SP1j-4) so it is the SINGLE source of truth read by BOTH the Prepare look AND the SVG exporter.

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
