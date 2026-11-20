// apps/shaper/src/op-derive.js — TASK 817 (owner turns 2745-2748: "In fusion a toolpath generate is on ok and allow to work still, spin wheel on item only"): THE
// derivation of an operation's PATHS and of the Shaper FILE, in ONE module that the page's main thread, the node tests and the background worker (paths-worker.js)
// all import, so there is no second implementation: the worker runs these functions on a copy of the inputs, the main thread reads what they return.
//   deriveFootprints   one plan item's cuts + footprints: the composition cut-plan.js deriveKeyFootprints always made; deriveItem = that + a Roughing's / Contour's
//                      level facts (levelsFacts): what one background job generates
//   svgOf / bitCentrePaths   the Shaper SVG (the download, the 2D preview copy) and the Paths view's bit-centre travel (export-payload.js shaperSvgOf / bitCentrePaths)
//   createPathsServer  the worker's side of the protocol (a queue of jobs; a job no longer wanted is dropped before it starts)
//   packRefs / unpackRefs   the big, never-mutated inputs (a part's levels, a Fusion slope, the sketch, the export encoding) cross ONCE per worker: a job names them
// WORKER-SAFE: #core is imported by RELATIVE path (a module worker has no import map) and nothing here reads the DOM, the settings or the operations store: the
// caller hands every input in (the effective record, the sketch, the owned loops, the unit, the encoding).
import { findLoops } from '../../../packages/core/loop-finder.js';
import { loopPolygon } from '../../../packages/core/loop-geometry.js';
import { deriveCuts, levelsWorkRecord, hasLevels, levelsBand, levelsRoughingFor, roughLayout } from '../../../packages/core/stepped-cut.js';
import { deriveProfileCuts, deriveCutFootprint, deriveCutTravel } from '../../../packages/core/profile-model.js';
import { exportShaperSVG } from '../../../packages/core/shaper-export.js';
import { withArcSamples } from '../../../packages/core/curve-kinds.js'; // the sketch's arc samples made by the page (a worker has no SVG DOM to sample them)

/** The loops of `state` with their host-side polygons (what Prepare and the exporter use) + the { id: polygon } map. (Moved here from cut-plan.js, which re-exports it.) */
export function loopsWithPolygons(state) {
  const shapeById = new Map((state.shapes || []).map((sh) => [sh.id, sh]));
  const loops = findLoops(state).map((l) => ({ ...l, polygon: loopPolygon(l, state, shapeById) }));
  return { loops, loopPolys: Object.fromEntries(loops.map((l) => [l.id, l.polygon])) };
}

/**
 * levelsFacts(target, rec, state, loops, loopPolys, owned) — TASK 792 / 810: what a Roughing's / Contour's card note reads beside its cuts (cut-plan.js levelsSummary):
 * the heights' band is empty (`bandEmpty`), the Min terrace width's thin bands (`thin`) and the boundary's refusal (`roughingError`, #core levelsRoughingFor's error),
 * from the SAME memoised level derivation its cuts came from. Null for any other record.
 */
export function levelsFacts(target, rec, state, loops, loopPolys, owned) {
  if (!rec || !rec.levelsOp) return null;
  const outer = hasLevels(rec) && rec.levelsOp === 'roughing' ? (deriveProfileCuts(target, { ...rec, cutType: 'pocket' }, state, loops, loopPolys, owned).find((c) => c.isCompound) || {}).outerPoly : null;
  const band = levelsBand(rec, rec.levelsOp === 'contour' ? rec.baseDepth : rec.cutDepth); // TASK 810: its heights
  const LR = outer && !band.empty ? levelsRoughingFor({ ...rec, cutDepth: band.depth }, outer, state, loops, loopPolys) : null;
  const thin = LR && roughLayout(rec) === 'terraces' && Number(rec.minTerraceWidth) > 0 ? LR.steps.reduce((n, s) => n + (s.thin || 0), 0) : 0;
  return { bandEmpty: Boolean(band.empty), thin, roughingError: LR ? LR.error || null : null };
}

/**
 * deriveFootprints(target, rec, state, loops, loopPolys, owned) — THE one composition of the cut derivations for one plan item: `rec` = the EFFECTIVE record
 * (cut-plan.js: resolveEntry + effectiveCutRecord) -> #core deriveCuts (+ a stepped cut's terraces, a Roughing's / Contour's levels) -> deriveCutFootprint with the
 * record the cuts are made with (#core levelsWorkRecord: a Roughing's allowance). Returns { rec, cuts, footprints }, or null when the target derives to nothing.
 */
export function deriveFootprints(target, rec, state, loops, loopPolys, owned) {
  const cuts = deriveCuts(target, rec, state, loops, loopPolys, owned); // TASK 714: a stepped record derives to its terraces (the exporter's derivation too)
  if (!cuts || !cuts.length) return null;
  const work = levelsWorkRecord(rec); // TASK 792: a Roughing's allowance is drawn with its cuts (#core levelsWorkRecord: the record they are made with)
  return { rec: work, cuts, footprints: deriveCutFootprint(cuts, work, state) };
}
/** TASK 817: what ONE background job generates for a plan item: { paths: deriveFootprints (or null), levels: levelsFacts (or null) }. */
export const deriveItem = (target, rec, state, loops, loopPolys, owned) => ({ paths: deriveFootprints(target, rec, state, loops, loopPolys, owned), levels: levelsFacts(target, rec, state, loops, loopPolys, owned) });

/** The Shaper SVG of `entries` on the solved sketch `state` (export-payload.js shaperSvgOf hands in the app's encoding and the document unit): the downloaded file,
 *  or with `preview: true` the same string plus the preview-only data-* attributes; `written` receives { cut, entry } of each element (TASK 793); `frame` = the
 *  whole plan's entries when `entries` are a part of it (TASK 798). */
export function svgOf({ state, entries, encoding, docUnit, preview = false, written = null, frame = null }) {
  const sById = new Map((state.shapes || []).map((s) => [s.id, s]));
  const loopPolys = {};
  for (const l of findLoops(state)) loopPolys[l.id] = loopPolygon(l, state, sById);
  const options = preview ? { previewData: true } : {};
  if (written) options.written = written; // TASK 793: receives { cut, entry } of each element in the file's order (the Export step's Paths view)
  if (frame && frame.length > entries.length) options.frame = { entries: frame }; // TASK 798
  return exportShaperSVG({ state, entries, encoding, docUnit, options, loopPolys });
}

/** TASK 793: the Export step's Paths view: the bit-centre travel of every element of the file. `written` = svgOf's list ({ cut, entry } of each element, in the
 *  file's order); returns [{ index (the element's place in the file), travel }] for the elements that have one, `travel` = deriveCutTravel's entries ({ role,
 *  direction, path (world points), closed }) from deriveCutFootprint of that cut: THE derivation Prepare draws (deriveFootprints composes the same two calls). An
 *  element with no determined travel (a plain On line cut, a guide, a held cut's gap strip, TASK 798 the frame guide of a partial file) has no entry. */
export function bitCentrePaths(state, written) {
  const out = [];
  written.forEach(({ cut }, index) => {
    if (!cut) return; // TASK 798: the frame guide of a partial file (#core exportShaperSVG options.frame) is no cut
    const travel = deriveCutTravel(deriveCutFootprint([cut], cut.rec, state));
    if (travel.length) out.push({ index, travel });
  });
  return out;
}

// ── the big inputs, sent ONCE per worker (TASK 817). A job carries `{ $ref: id }` in their place: a record's `levels` (an STL part's sections, megabytes) and `slope`
// (a Fusion region's rings), the sketch (`state`) and the export encoding. Both sides keep the value under its id, so the worker's #core memo caches (keyed by the
// levels list itself) stay warm from one job to the next, and a result's records come back naming the main thread's own lists. ──
export const REF_FIELDS = Object.freeze(['levels', 'slope']);
const isRef = (v) => Boolean(v) && typeof v === 'object' && typeof v.$ref === 'string' && Object.keys(v).length === 1;
/** A record with its big fields replaced by refs: `idOf(value)` names a value (null: kept as it is). The same object when nothing is replaced. */
export function packRec(rec, idOf) {
  if (!rec || typeof rec !== 'object') return rec;
  let out = rec;
  for (const f of REF_FIELDS) { const v = rec[f]; const id = v && typeof v === 'object' && !isRef(v) ? idOf(v) : null; if (id) { if (out === rec) out = { ...rec }; out[f] = { $ref: id }; } }
  return out;
}
/** A record with its refs replaced by the values `valueOf(id)` names (unknown id: an Error). The same object when it holds no ref. */
export function unpackRec(rec, valueOf) {
  if (!rec || typeof rec !== 'object') return rec;
  let out = rec;
  for (const f of REF_FIELDS) { const v = rec[f]; if (isRef(v)) { if (out === rec) out = { ...rec }; out[f] = valueOf(v.$ref); } }
  return out;
}
/** A job's result (deriveItem) as it crosses to the main thread: the records packed (packRec), and each cut's `sweep` (a memoised FUNCTION of the bit radius, #core
 *  stepped-cut / hold-part / pocket-clearing) left out: a function cannot be copied, and the footprints it was used for are in the result. */
export function packResult(item, idOf) {
  const p = item.paths;
  if (!p) return item;
  const cuts = p.cuts.map((c) => {
    const { sweep, ...rest } = c; // eslint-disable-line no-unused-vars
    return rest.rec ? { ...rest, rec: packRec(rest.rec, idOf) } : rest;
  });
  return { ...item, paths: { ...p, rec: packRec(p.rec, idOf), cuts } };
}
/** packResult undone on the receiving side (the records name the receiver's own lists again). */
export function unpackResult(item, valueOf) {
  const p = item.paths;
  if (!p) return item;
  return { ...item, paths: { ...p, rec: unpackRec(p.rec, valueOf), cuts: p.cuts.map((c) => (c.rec ? { ...c, rec: unpackRec(c.rec, valueOf) } : c)) } };
}

/**
 * createPathsServer({ post, schedule }) — the WORKER's side (paths-worker.js runs it on the worker's own messages; the main thread's in-process port, op-paths.js
 * localPort, runs the very same code on copies of its messages). Messages in:
 *   { refs: [[id, value]...] }   values a later job names (may ride on any message); { forget: [id...] } drops some
 *   { type: 'paths', id, target, rec, state, owned }   deriveItem of one plan item (`state` / `rec` fields by ref; `owned` = the owned loop ids)
 *   { type: 'export', id, args }   svgOf(args) (+ bitCentrePaths when args.preview) = { svg, bitPaths }
 *   { type: 'drop', ids }   queued jobs no longer wanted (a job already running finishes; its answer is ignored by the caller)
 * Messages out: { type, id, result } or { type: 'error', id, message, stack }. Jobs run one at a time, in order, each in its own `schedule`d turn, so a 'drop'
 * that arrives while one runs reaches the queue before the next starts.
 */
export function createPathsServer({ post, schedule }) {
  const refs = new Map(), ids = new Map(); // id -> value; value -> id (a result's records are packed with the ids they came with)
  const geo = new WeakMap(); // a sketch -> its loops (made once per sketch)
  const queue = [];
  let busy = false;
  const valueOf = (id) => { if (!refs.has(id)) throw new Error(`paths worker: unknown input ${id}`); return refs.get(id); };
  const idOf = (v) => ids.get(v) || null;
  const geometry = (state) => { let g = geo.get(state); if (!g) { g = loopsWithPolygons(state); geo.set(state, g); } return g; };
  // every job runs with its sketch's arc samples (the page's: op-paths.js sketchRef, #core curve-kinds arcSamplesOf), so the polygons are the page's
  function run(job) {
    if (job.type === 'paths') {
      const state = valueOf(job.state.$ref);
      return withArcSamples(state.arcSamples, () => {
        const { loops, loopPolys } = geometry(state);
        return packResult(deriveItem(job.target, unpackRec(job.rec, valueOf), state, loops, loopPolys, new Set(job.owned)), idOf);
      });
    }
    const a = job.args;
    const state = valueOf(a.state.$ref), encoding = valueOf(a.encoding.$ref);
    const entries = a.entries.map((e) => ({ ...e, rec: unpackRec(e.rec, valueOf) }));
    const frame = a.frame ? a.frame.map((e) => ({ ...e, rec: unpackRec(e.rec, valueOf) })) : null;
    return withArcSamples(state.arcSamples, () => {
      const written = a.preview ? [] : null;
      const svg = svgOf({ state, entries, encoding, docUnit: a.docUnit, preview: a.preview, written, frame });
      return { svg, bitPaths: written ? bitCentrePaths(state, written) : null };
    });
  }
  function next() {
    const job = queue.shift();
    if (!job) { busy = false; return; }
    let reply;
    try { reply = { type: job.type, id: job.id, result: run(job) }; } catch (e) { reply = { type: 'error', id: job.id, message: e && e.message ? e.message : String(e), stack: e && e.stack ? String(e.stack) : null }; }
    post(reply);
    if (queue.length) schedule(next); else busy = false;
  }
  return {
    receive(msg) {
      if (msg.refs) for (const [id, v] of msg.refs) { refs.set(id, v); ids.set(v, id); }
      if (msg.forget) for (const id of msg.forget) { const v = refs.get(id); refs.delete(id); if (v !== undefined) ids.delete(v); }
      if (msg.type === 'drop') { const gone = new Set(msg.ids); for (let i = queue.length - 1; i >= 0; i--) if (gone.has(queue[i].id)) queue.splice(i, 1); return; }
      if (msg.type !== 'paths' && msg.type !== 'export') return;
      queue.push(msg);
      if (!busy) { busy = true; schedule(next); }
    },
    queued: () => queue.length,
  };
}
