// apps/shaper/src/split-files.js — TASK 888 (owner turns 3627-3628: "in roughing and contour maybe we may want to separate an op into many files", by depth AND by
// number of levels: "Both"): a Roughing's / Contour's "Split into files", declared ONCE here: the setting (its modes and defaults, read by the cut card, the Operations
// list's settings key and the export), the CHUNKS an operation's levels make, and which elements each exported file keeps.
// WORKER-SAFE (op-derive.js runs the export in the paths worker): plain data and functions, no DOM, no settings, no store.
//
// THE RULES (stated once; the node test tests/split-files-888-node.test.js checks each):
//  * a LEVEL = one depth an element of the operation is cut at: the depth the file writes for it (its cut's `rec.cutDepth`: #core stepped-cut writes every level's cut at
//    its own depth). Several elements at one depth (islands, the outlines of one level) are ONE level. Levels are counted top down (shallow to deep).
//  * By depth, every N (base mm): band k (k = 1, 2, ...) holds the levels deeper than (k - 1) * N and down to k * N INCLUSIVE: a level exactly on a boundary is in the
//    shallower band (the file that ends there). Band 1 also holds a level at the surface or above it and an element with no depth. A band with no level makes no file.
//  * By levels, N per file: the first N levels, the next N, ...; the last file holds what is left (fewer when the count does not divide).
//  * THE FILES of an export whose ticked operations hold a split one: for each split operation, in the Operations list's order, one file per chunk, top down. Every file
//    holds the Stock (the board: a guide, never cut; it is what every file is placed by). The ticked operations that are NOT split are in the FIRST file only (so
//    nothing is cut twice). A split operation's elements are in its own files only. Every file is written on the whole plan's page (#core exportShaperSVG options.keep).
//  * No split operation ticked: no chunks (the one file of today, byte for byte).

/** The setting: record field `splitFiles` ('depth' | 'levels'; none / anything else = Off), `splitDepth` (base mm > 0) and `splitLevels` (an integer >= 1); each mode
 *  keeps its own number, so switching back and forth keeps both. The defaults are what an unset number means (the card shows them). */
export const SPLIT_FILES = Object.freeze({
  modes: Object.freeze([Object.freeze({ id: 'off', label: 'Off' }), Object.freeze({ id: 'depth', label: 'By depth' }), Object.freeze({ id: 'levels', label: 'By levels' })]),
  defaultDepth: Object.freeze({ mm: 10, in: 12.7 }), // base mm, by the document unit (10 mm, 1/2 in)
  defaultLevels: 20,
});
/** The default depth band (base mm) in the document unit `unit` ('in' = 1/2 in; any metric unit = 10 mm). */
export const splitDepthDefault = (unit) => (unit === 'in' ? SPLIT_FILES.defaultDepth.in : SPLIT_FILES.defaultDepth.mm);
/** The mode of a record: 'off' | 'depth' | 'levels'. */
export const splitModeOf = (rec) => (rec && (rec.splitFiles === 'depth' || rec.splitFiles === 'levels') ? rec.splitFiles : 'off');
/** A record's split: null (Off) | { mode: 'depth', every: base mm } | { mode: 'levels', every: a count }. `unit` = the document unit (an unset depth's default). */
export function splitOf(rec, unit = 'mm') {
  const mode = splitModeOf(rec);
  if (mode === 'depth') return { mode, every: Number(rec.splitDepth) > 0 ? Number(rec.splitDepth) : splitDepthDefault(unit) };
  if (mode === 'levels') return { mode, every: Number(rec.splitLevels) >= 1 ? Math.floor(Number(rec.splitLevels)) : SPLIT_FILES.defaultLevels };
  return null;
}

const EPS = 1e-6;
/** The depth an element is cut at (its cut's record), or NaN (no depth: 'unset'). */
export const elementDepth = (cut) => Number(cut && cut.rec ? cut.rec.cutDepth : NaN);
/** The distinct finite depths of `depths` (base mm), shallow to deep (two within EPS are one level). */
export function levelsOf(depths) {
  const out = [];
  for (const d of [...depths].filter(Number.isFinite).sort((a, b) => a - b)) if (!out.length || d - out[out.length - 1] > EPS) out.push(d);
  return out;
}

/**
 * chunksOf(depths, split) — the chunks of an operation whose elements are cut at `depths` (base mm, one per element, in any order; NaN = no depth): [{ index (1-based),
 * count, lo, hi, first, last, from, to }] top down. lo / hi = the chunk's depths: an element belongs to it when its depth is > lo (lo null: no upper limit) and <= hi
 * (hi null: no lower limit; the last chunk). first / last = its levels' numbers (1-based, inclusive); from / to = By depth: its band (base mm), By levels: null.
 * `split` null: [].
 */
export function chunksOf(depths, split) {
  if (!split) return [];
  const levels = levelsOf(depths);
  const out = [];
  if (split.mode === 'depth') {
    const N = split.every;
    const bandOf = (d) => Math.max(1, Math.ceil(d / N - EPS)); // (k - 1) N < d <= k N; at or above the surface: band 1
    const bands = [...new Set(levels.map(bandOf))].sort((a, b) => a - b);
    if (!bands.length) bands.push(1); // no finite depth: one file
    bands.forEach((k, i) => {
      const mine = levels.filter((d) => bandOf(d) === k);
      const first = levels.indexOf(mine[0]) + 1;
      out.push({ index: i + 1, lo: i === 0 ? null : (k - 1) * N, hi: i === bands.length - 1 ? null : k * N, first: first || 1, last: first ? first + mine.length - 1 : 1, from: (k - 1) * N, to: k * N });
    });
  } else {
    const N = split.every, L = Math.max(1, levels.length);
    for (let j = 0; j * N < L; j++) {
      const a = j * N, b = Math.min(L, (j + 1) * N); // levels a + 1 .. b
      out.push({ index: j + 1, lo: j === 0 ? null : levels[a - 1], hi: b >= L ? null : levels[b - 1], first: a + 1, last: b, from: null, to: null });
    }
  }
  return out.map((c) => ({ ...c, count: out.length }));
}
/** Whether an element cut at `depth` belongs to `chunk` (no depth: the first chunk). */
export function inChunk(depth, chunk) {
  if (!Number.isFinite(depth)) return chunk.index === 1;
  return (chunk.lo == null || depth > chunk.lo + EPS) && (chunk.hi == null || depth <= chunk.hi + EPS);
}

/**
 * fileSpecs(plan, depthsOf) — THE FILES of an export (the rules above). `plan` = { ops: [{ id, split }] (the TICKED operations other than the Stock, in the Operations
 * list's order; `split` = splitOf), stock: [the Stock operations' ids] }; `depthsOf(opId)` = the depths of that operation's elements in the file. Returns null when no
 * operation is split, else [{ whole: [op ids written whole], chunk: { opId, mode, every, ...chunksOf's chunk } }] in file order.
 */
export function fileSpecs(plan, depthsOf) {
  const split = plan.ops.filter((o) => o.split);
  if (!split.length) return null;
  const rest = plan.ops.filter((o) => !o.split).map((o) => o.id);
  const files = [];
  for (const o of split) {
    for (const c of chunksOf(depthsOf(o.id), o.split)) {
      files.push({ whole: [...plan.stock, ...(files.length ? [] : rest)], chunk: { opId: o.id, mode: o.split.mode, every: o.split.every, ...c } });
    }
  }
  return files;
}
/** The exporter's `keep` of a file spec (#core exportShaperSVG options.keep): an element of an operation written whole, or of the chunk's operation in the chunk. */
export function keepOf(spec) {
  const whole = new Set(spec.whole.map(String)), chunkOp = String(spec.chunk.opId);
  return (meta) => {
    const id = meta && meta.entry ? String(meta.entry.opId) : null;
    if (id == null) return true;
    if (whole.has(id)) return true;
    return id === chunkOp && inChunk(elementDepth(meta.cut), spec.chunk);
  };
}
