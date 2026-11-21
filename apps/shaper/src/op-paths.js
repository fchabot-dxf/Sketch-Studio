// apps/shaper/src/op-paths.js — TASK 817 (owner turns 2745-2748): the operations' GENERATED PATHS, on the main thread. Toolpaths are generated on OK, in the
// BACKGROUND (paths-worker.js, a module worker running op-derive.js: the same derivation code), while the page stays usable; the row of an operation that is
// generating shows a spinner; the views draw a result when it is there. This module is the one place that knows what has been generated:
//   * CONTENT-ADDRESSED: a result is filed under the signature of EVERYTHING its derivation reads (the target, the effective record with its levels / slope by their
//     content hash, the owned loops, the sketch geometry). A view asks for the signature of its inputs NOW, so it can only ever get the paths of exactly those inputs:
//     a stale result is never shown (an edit, a moved shape, an Undo change the signature), and coming back to earlier inputs (an Undo) finds their result again.
//   * ASKED BY READING: lookup() files a request for a signature it does not have (unless asked not to: a peek), so every reader of the plan (the list, Prepare's look,
//     the 3D Review, the notes) gets its paths generated without a list to keep; hold(opId) holds the requests of the OPEN operation (a reader names the operation it
//     reads for: its edits are not generated until OK, owner turn 2745; its Preview asks explicitly: request()).
//   * SUPERSEDED: retain(sigs) (the stage, after every change: the signatures the plan has now) drops the queued jobs of any other signature; a job already running
//     finishes and its result is filed by its signature (shown only if those inputs come back).
//   * WAITED FOR: idle() resolves when nothing is generating (the export and the 3D Review wait for it: never a stale or partial file).
//   * OUT OF DATE (TASK S3 addition, owner turns 3046-3047, "Fusion style"): a plan ITEM (a membership, '<op id>|<geometry key>') remembers the signature it was last
//     generated for (`generated`). A reader names the item it reads: its inputs' result is there = up to date; never generated (a document opened, an import, a new
//     operation's first reading) = asked for, as before; the inputs it was asked for = still generating; ANY OTHER inputs (a Design edit, an operation's inputs changed
//     while it is closed) = OUT OF DATE: nothing is asked for (no job), its last result stays readable (staleOf: drawn faint), until recalculate() (the Recalculate
//     button, OK of its edit session) asks for its inputs now. A result already filed for the inputs now (an Undo back) is up to date at once. forget() = another
//     document (nothing of it was generated here: shaper-doc.js applyShaperDoc, an import). A read that names no item asks as before (see mayAsk).
// THE PORT (how jobs reach op-derive.js createPathsServer): the page sets a WORKER port (main.js); without one (the node test kit, the node tests) the in-process
// localPort serves every job at once, on a structured COPY of the job and of the answer, exactly what crossing to the worker does. Same server, same derivation.
import { createPathsServer, packRec, unpackResult, REF_FIELDS } from './op-derive.js';
import { arcSamplesOf } from '../../../packages/core/curve-kinds.js'; // the sketch's arcs sampled here (the page's SVG DOM) for the worker, which has none

// FNV-1a of a string: the signatures (equal text = equal inputs)
function hashText(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h.toString(36) + '.' + str.length.toString(36); }

/** The in-process port: the worker's server (op-derive.js) run here on structured copies of each message (`async`: answers come in a later turn, as from a worker). */
export function localPort({ async = false } = {}) {
  let deliver = () => {};
  const later = (fn) => setTimeout(fn, 0);
  const server = createPathsServer({ post: (m) => { const c = structuredClone(m); if (async) later(() => deliver(c)); else deliver(c); }, schedule: async ? later : (fn) => fn() });
  return { kind: async ? 'local-async' : 'local', post: (m) => server.receive(structuredClone(m)), listen: (fn) => { deliver = fn; }, close() {} };
}
/** The page's port: a module Worker running paths-worker.js. A worker that fails (it could not load) fails every job it holds, loudly. */
export function workerPort(worker) {
  return { kind: 'worker', post: (m) => worker.postMessage(m), listen: (fn, fail) => { worker.onmessage = (e) => fn(e.data); worker.onerror = (e) => { console.error('paths worker failed', e && e.message); fail(e && e.message ? e.message : 'the paths worker failed'); }; }, close: () => worker.terminate() };
}

let port = null;
const cache = new Map();     // sig -> { result } (result = op-derive.js deriveItem's { paths, levels }; + error: the derivation threw)
const inflight = new Map();  // sig -> job id (a paths job not answered yet)
const jobs = new Map();      // job id -> { kind, sig, resolve, reject }
const listeners = new Set();
let current = new Set();     // the signatures the plan has now (retain): never evicted
const EXTRA = 48;            // results kept beyond the current ones (an Undo finds them)
let held = null, delivering = 0, nextId = 1, idleWaiters = [];

function usePort() {
  if (!port) setPathsPort(localPort());
  return port;
}
/** Set the port (main.js: a worker port; tests: a localPort({ async: true })). Everything generated so far is dropped (a new server knows nothing). */
export function setPathsPort(p) {
  if (port) port.close();
  port = p;
  cache.clear(); inflight.clear(); sent.clear(); lastUse.clear(); generated.clear(); genOps.clear(); // (TASK S3: nothing generated by this port yet)
  for (const j of jobs.values()) if (j.reject) j.reject(new Error('the paths port was replaced'));
  jobs.clear();
  port.listen(receive, (message) => { for (const id of [...jobs.keys()]) receive({ type: 'error', id, message }); });
}

// ── the big inputs, sent once (op-derive.js packRec): a levels list / slope by identity, the sketch by its geometry signature, the encoding by its text ──
const valueIds = new WeakMap(); let refN = 0;
const refValues = new Map(); // id -> value (the main thread's own object; a result's records are given these back)
const sent = new Set();      // ids the port's server has
const refId = (v) => { let id = valueIds.get(v); if (!id) { id = 'v' + (++refN); valueIds.set(v, id); refValues.set(id, v); } return id; };
const refValue = (id) => { if (!refValues.has(id)) throw new Error(`paths: unknown input ${id}`); return refValues.get(id); };
function refsFor(ids) {
  const out = [];
  for (const id of ids) if (!sent.has(id)) { out.push([id, refValues.get(id)]); sent.add(id); }
  return out;
}
const recIds = (rec) => REF_FIELDS.map((f) => rec && rec[f] && typeof rec[f] === 'object' ? refId(rec[f]) : null).filter(Boolean);

// ── signatures ──
const CONTENT = new WeakMap(); // a levels list / slope (never mutated) -> its content hash, made once
const contentSig = (v) => { let h = CONTENT.get(v); if (!h) { h = hashText(JSON.stringify(v)); CONTENT.set(v, h); } return h; };
const recSigText = (rec) => JSON.stringify(rec, (k, v) => (REF_FIELDS.includes(k) && v && typeof v === 'object' ? { content: contentSig(v) } : v));
/** The geometry signature of a solved sketch: what a derivation reads of it (its joints, shapes, constraints: #core findLoops merges coincident joints, and combined
 *  profiles). */
export function geometrySig(state) {
  return hashText(JSON.stringify([[...(state.joints || new Map()).entries()], state.shapes || [], state.constraints || [], state.profiles || []]));
}
/** The sketch as a job carries it (a copy is made where it crosses): joints, shapes, constraints, profiles, filed under its geometry signature, and its arcs
 *  sampled HERE (#core curve-kinds arcSamplesOf: the browser's SVG path API on the page; the worker derives with exactly these points, withArcSamples). */
function sketchRef(ctx) {
  const id = 's:' + ctx.geomSig;
  if (!refValues.has(id)) refValues.set(id, { joints: new Map(ctx.state.joints), shapes: [...(ctx.state.shapes || [])], profiles: [...(ctx.state.profiles || [])], constraints: [...(ctx.state.constraints || [])], arcSamples: arcSamplesOf(ctx.state) }); // plain arrays (the sketch's shapes array carries its own push)
  return id;
}
/** A reading context: ONE pass over the plan (the geometry signature and the owned loops are worked out once). `owned` = the plan's owned loop ids (a Set). */
export function pathsContext(state, { loops, loopPolys, owned }) {
  return { state, loops, loopPolys, owned, ownedSig: [...owned].sort().join(' '), geomSig: geometrySig(state) };
}
/** The signature of one plan item's derivation: `target` + `rec` = the EFFECTIVE record (cut-plan.js resolveEntry + effectiveCutRecord). */
export const pathsSig = (ctx, target, rec) => hashText(JSON.stringify([target, recSigText(rec), ctx.ownedSig, ctx.geomSig]));

// the inputs the worker keeps are bounded: the sketches of the last KEEP_SKETCHES geometries and the last KEEP_INPUTS other inputs (levels lists, slopes, the
// encoding) it was sent, never one a job still waiting names; the others are forgotten on both sides (sent again when a job needs them again)
const KEEP_SKETCHES = 4, KEEP_INPUTS = 24;
const lastUse = new Map(); let useN = 0;
function staleRefs() {
  const busy = new Set();
  for (const j of jobs.values()) for (const id of j.ids || []) busy.add(id);
  const out = [];
  for (const [sketch, cap] of [[true, KEEP_SKETCHES], [false, KEEP_INPUTS]]) {
    const mine = [...sent].filter((id) => id.startsWith('s:') === sketch).sort((a, b) => lastUse.get(a) - lastUse.get(b));
    let n = mine.length;
    for (const id of mine) { if (n <= cap) break; if (busy.has(id)) continue; out.push(id); n--; }
  }
  for (const id of out) { sent.delete(id); lastUse.delete(id); const v = refValues.get(id); if (id.startsWith('v') && v) valueIds.delete(v); refValues.delete(id); }
  return out;
}
function post(msg, ids) {
  const p = usePort();
  const refs = refsFor(ids);
  for (const id of ids) lastUse.set(id, ++useN);
  const forget = staleRefs();
  p.post({ ...msg, ...(refs.length ? { refs } : {}), ...(forget.length ? { forget } : {}) });
}
function want(sig, ctx, target, rec) {
  if (cache.has(sig) || inflight.has(sig)) return;
  usePort(); // (made before the job is filed: a new port starts from nothing)
  const id = 'p' + (nextId++);
  const sid = sketchRef(ctx), ids = [sid, ...recIds(rec)];
  inflight.set(sig, id);
  jobs.set(id, { kind: 'paths', sig, ids });
  post({ type: 'paths', id, target, rec: packRec(rec, refId), state: { $ref: sid }, owned: [...ctx.owned] }, ids);
}
function file(sig, entry) {
  cache.delete(sig); cache.set(sig, entry);
  let extra = 0;
  for (const k of cache.keys()) if (!current.has(k)) extra++;
  for (const k of [...cache.keys()]) { if (extra <= EXTRA) break; if (!current.has(k) && k !== sig) { cache.delete(k); extra--; } }
}
function receive(msg) {
  const j = jobs.get(msg.id);
  jobs.delete(msg.id);
  if (!j) return;
  if (j.kind === 'paths') {
    if (msg.type === 'error') { console.error(`generating paths failed: ${msg.message}`, msg.stack || ''); file(j.sig, { result: { paths: null, levels: null, error: msg.message } }); }
    else file(j.sig, { result: unpackResult(msg.result, refValue) });
    if (inflight.get(j.sig) === msg.id) inflight.delete(j.sig);
  } else if (msg.type === 'error') j.reject(new Error(msg.message));
  else j.resolve(msg.result);
  if (!inflight.size && idleWaiters.length) { const w = idleWaiters; idleWaiters = []; for (const f of w) f(); }
  if (!delivering && j.kind === 'paths') for (const fn of [...listeners]) fn();
}

/**
 * lookup(ctx, target, rec, { request = true }) — the generated derivation of one plan item for exactly these inputs: { paths, levels } (op-derive.js deriveItem,
 * copied across; paths null when the target derives to nothing, both null when the derivation failed: told on the console), or UNDEFINED while it is not there
 * (generating; or not asked for: a peek, a pause).
 * A miss files the request (unless `request` is false, or `opId` = the operation held: open); the in-process port answers at once, so the node tests read it here.
 */
export function lookup(ctx, target, rec, { request = true, opId = null, item = null } = {}) {
  const sig = pathsSig(ctx, target, rec);
  let hit = cache.get(sig);
  if (hit && item && !(held && opId === held)) fileAsked(item, sig); // TASK S3: up to date (an Undo back to generated inputs too)
  if (!hit && request && !(held && opId === held) && mayAsk(item, sig)) { delivering++; try { want(sig, ctx, target, rec); } finally { delivering--; } hit = cache.get(sig); }
  if (!hit) return undefined;
  cache.delete(sig); cache.set(sig, hit); // most recently used
  return hit.result;
}
// ── TASK S3: OUT OF DATE (see the header) ──
const generated = new Map(); // item id -> the signature it was last generated (asked) for
const genOps = new Set();    // the operations (ids) some item of which was generated: a NEW membership of one (a shape whose key a Design edit renamed) is out of date too
const opOf = (item) => item.slice(0, item.indexOf('|'));
const fileAsked = (item, sig) => { generated.set(item, sig); genOps.add(opOf(item)); };
// may a read of `item` ask for `sig`? Never generated (nor its operation): yes, and it is filed as asked for; asked for these inputs: yes; else: out of date. A read that
// names no item (the 3D Review's items and notes: read after the Export step's wait, whenGenerated, which waits while a ticked operation is out of date) asks as before.
function mayAsk(item, sig) {
  if (!item) return true;
  const last = generated.get(item);
  if (last === undefined) { if (genOps.has(opOf(item))) return false; fileAsked(item, sig); return true; }
  return last === sig;
}
const outOfDateSig = (sig, item) => { const last = generated.get(item); return !cache.has(sig) && (last === undefined ? genOps.has(opOf(item)) : last !== sig); };
/** TASK S3: whether `item` is OUT OF DATE for these inputs: it (or its operation) was generated for other inputs and these have no result (the open operation, held, never is). */
export function isOutOfDate(ctx, target, rec, item, opId = null) {
  if (held && opId === held) return false;
  return outOfDateSig(pathsSig(ctx, target, rec), item);
}
/** TASK S3: whether `item` is up to date for these inputs (their result is there, or they are what it was last asked for). */
export function isUpToDate(ctx, target, rec, item) {
  const sig = pathsSig(ctx, target, rec);
  return cache.has(sig) || generated.get(item) === sig;
}
/** TASK S3: the signature an out-of-date item was last generated for (its paths are drawn faint: resultOf), or null. */
export function staleOf(item) { return generated.get(item) || null; }
/** TASK S3: RECALCULATE: ask for these items' inputs now ([{ item, target, rec }]: the Recalculate button, OK of an edit session); returns their signatures. */
export function recalculate(ctx, items) {
  const sigs = [];
  delivering++;
  try { for (const { item, target, rec } of items) { const sig = pathsSig(ctx, target, rec); sigs.push(sig); fileAsked(item, sig); want(sig, ctx, target, rec); } } finally { delivering--; }
  for (const fn of [...recalcListeners]) fn();
  return sigs;
}
const recalcListeners = new Set();
/** TASK S3: fn() after every recalculate() (the Export step's wait for out-of-date operations goes on). Returns the unsubscribe. */
export function onRecalculate(fn) { recalcListeners.add(fn); return () => recalcListeners.delete(fn); }
/** TASK S3: another document: nothing of it has been generated here (opening it generates it, as before). */
export function forget() { generated.clear(); genOps.clear(); }
/** TASK S3: the signatures the items were last generated for (kept: an out-of-date item's last paths are drawn faint). */
export const generatedSigs = () => [...new Set(generated.values())];
/** Ask for these items even for the operation held (an open operation's Preview, TASK 817 addendum): [{ target, rec }]; returns their signatures. */
export function request(ctx, items) {
  const sigs = [];
  delivering++;
  try { for (const { target, rec } of items) { const sig = pathsSig(ctx, target, rec); sigs.push(sig); want(sig, ctx, target, rec); } } finally { delivering--; }
  return sigs;
}
/** Hold the requests read for this operation (it is open: its edits are generated on OK or by its Preview), or none (null). */
export function hold(opId) { held = opId || null; }
/** The signatures the plan has now: the queued jobs of any other signature are dropped (superseded: the last change wins), and these results are never evicted. */
export function retain(sigs) {
  current = new Set(sigs);
  const drop = [];
  for (const [sig, id] of [...inflight]) if (!current.has(sig)) { inflight.delete(sig); drop.push(id); }
  if (drop.length) usePort().post({ type: 'drop', ids: drop });
  if (!inflight.size && idleWaiters.length) { const w = idleWaiters; idleWaiters = []; for (const f of w) f(); }
}
/** The result filed under this signature (a peek: nothing is asked for), or undefined. */
export function resultOf(sig) { const hit = cache.get(sig); return hit ? hit.result : undefined; }
/** Whether this signature is being generated / has a result. */
export const isGenerating = (sig) => inflight.has(sig);
export const hasResult = (sig) => cache.has(sig);
/** How many plan items are being generated now. */
export const generatingCount = () => inflight.size;
/** Resolves when nothing is being generated. */
export function idle() { return inflight.size ? new Promise((res) => idleWaiters.push(res)) : Promise.resolve(); }
/** Told after each result that arrives LATER (from the worker): the views redraw. Returns the unsubscribe. */
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

/** TASK 817: the Shaper file made in the background (op-derive.js svgOf + bitCentrePaths with `preview`): `args` = { state, entries, frame, encoding, docUnit, preview }
 *  (the sketch as svgOf takes it). Resolves { svg, bitPaths }. Queued after the paths jobs already asked for (the worker's memo caches are warm from them). */
export function exportJob({ state, entries, frame = null, encoding, docUnit, preview = false }) {
  const ctx = { state, geomSig: geometrySig(state) };
  const sid = sketchRef(ctx), eid = 'e:' + hashText(JSON.stringify(encoding));
  if (!refValues.has(eid)) refValues.set(eid, encoding);
  const packEntries = (list) => list.map((e) => ({ ...e, rec: packRec(e.rec, refId) }));
  const ids = [sid, eid, ...entries.flatMap((e) => recIds(e.rec)), ...(frame || []).flatMap((e) => recIds(e.rec))];
  const id = 'x' + (nextId++);
  usePort();
  return new Promise((resolve, reject) => {
    jobs.set(id, { kind: 'export', resolve, reject, ids });
    post({ type: 'export', id, args: { state: { $ref: sid }, encoding: { $ref: eid }, entries: packEntries(entries), frame: frame ? packEntries(frame) : null, docUnit, preview } }, ids);
  });
}
