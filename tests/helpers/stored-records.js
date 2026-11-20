// tests/helpers/stored-records.js — TASK S1: a SAVED Shaper sidecar (version 3: the operations store) read the way a test of before S1 read its per-shape cut plan.
// Plain data only (no app module): node-side live tests read the stored document with it.

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
