// packages/ui/report-compact.js — TASK 591: the COMPACT diagnostic report ("Copy Report"). Pure module: no DOM, no state.
//
// The full report (diagnostic-log.js buildReport({ full: true })) is 360-670 KB of JSON, mostly noise: a journal that stores every
// constraint's label position again in every step, hundreds of pointer-move lines, redraw spam, full-precision floats. A person pastes
// the report into a chat; this turns the full report into the part a reader needs:
//
//   summary   app, url, ua, time, active tool, selection, counts, undo/redo line, the last error with its stack
//   document  the final document, once; numbers rounded to 6 decimals (|x| < 1e-9 written as 0)
//   journal   { base, steps, folded }: per step ONLY the joints that moved ([id, x, y]) and the constraints added / removed (whole
//             object), joints added/removed/changed, any other document part as the original journal patch, plus the action label.
//             Steps that change nothing but constraint label / glyph positions are folded into the count `folded`.
//             base + steps reproduces `document` (replayCompactJournal; label / glyph positions are the one thing it does NOT carry:
//             `document` has their final values).
//   log       the events worth reading: clicks, keys, tool changes, drag start / end, constraint adds / refusals, warnings, errors.
//             pointer-move and redraw spam is dropped and COUNTED in `dropped`.
//   touchTrace only on a touch device or when it holds non-move events; pointer-moves are counted, not listed.
//
// Times are seconds BEFORE the report ("-12.5" = 12.5 s earlier), so log lines and journal steps share one clock.
import { applyPatch, diffSnapshots } from '#core/journal.js';

// ── numbers ──────────────────────────────────────────────────────────────────────────────────────
export const ROUND_DECIMALS = 6;
export const ZERO_BELOW = 1e-9;
export function roundNum(x) {
  if (!Number.isFinite(x)) return x;
  if (Math.abs(x) < ZERO_BELOW) return 0;
  const r = Math.round(x * 1e6) / 1e6;
  return Object.is(r, -0) ? 0 : r;
}
/** a deep copy of any JSON-safe value with every number rounded by roundNum */
export function roundDeep(v) {
  if (typeof v === 'number') return roundNum(v);
  if (Array.isArray(v)) return v.map(roundDeep);
  if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) o[k] = roundDeep(v[k]); return o; }
  return v;
}

// ── constraints: identity ignores presentation ───────────────────────────────────────────────────
// Constraint label / glyph placement: moves with the view of the drawing, not with its geometry. A step that changes only these is folded.
export const PRESENTATION_KEYS = ['glyphPos', 'offset', '__visible', '__showGlyph'];
const stripPresentation = (c) => { const o = {}; for (const k of Object.keys(c)) if (!PRESENTATION_KEYS.includes(k)) o[k] = c[k]; return o; };
const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((q) => [q, x[q]])) : x));
/** the identity of a constraint: its canonical JSON without the presentation keys */
export const constraintKey = (c) => canon(stripPresentation(c));

const SHIFT_MIN_GROUP = 3;
// Joint ids look like `j42_1794606832787` (counter + creation time). In the move lists a joint is named by its counter alone (`j42`)
// when that prefix identifies exactly one joint id of the whole journal; otherwise by its full id. resolveId maps it back.
const prefixOf = (id) => String(id).split('_')[0];
function shortIdFn(ids) {
  const n = new Map();
  for (const id of ids) n.set(prefixOf(id), (n.get(prefixOf(id)) || 0) + 1);
  return (id) => (n.get(prefixOf(id)) === 1 && prefixOf(id) !== id ? prefixOf(id) : id);
}
const resolveIdFn = (ids) => { const m = new Map(ids.map((id) => [prefixOf(id), id])); return (x) => (ids.includes(x) ? x : m.get(x) || x); };
const sameJoint = (a, b) => canon(a) === canon(b);
const jointMap = (doc) => new Map(doc.geometry.joints);

/** the compact step between two ROUNDED documents (null when nothing but presentation differs) */
function compactStep(prev, next, short) {
  const step = {};
  const pj = jointMap(prev), nj = jointMap(next);
  const moved = [], added = [], changed = [], removed = [];
  for (const [id, j] of nj) {
    const o = pj.get(id);
    if (!o) { added.push([id, j]); continue; }
    if (sameJoint(o, j)) continue;
    const { x: ox, y: oy, ...oRest } = o, { x, y, ...rest } = j;
    if (canon(oRest) === canon(rest)) moved.push([id, x, y]); else changed.push([id, j]);
  }
  for (const id of pj.keys()) if (!nj.has(id)) removed.push(id);
  // joints that all moved by the SAME offset (a drag translating a whole sub-drawing) are listed once: [dx, dy, [ids]]. A group is only
  // made when old + offset rounds to exactly the reported new position for every member, so the replay is exact.
  const byDelta = new Map();
  for (const [id, x, y] of moved) {
    const o = pj.get(id);
    const dx = roundNum(x - o.x), dy = roundNum(y - o.y);
    if (roundNum(o.x + dx) !== x || roundNum(o.y + dy) !== y) continue;
    const k = dx + ',' + dy;
    if (!byDelta.has(k)) byDelta.set(k, { dx, dy, ids: [] });
    byDelta.get(k).ids.push(id);
  }
  const shifted = [], inGroup = new Set();
  for (const g of byDelta.values()) if (g.ids.length >= SHIFT_MIN_GROUP) { shifted.push([g.dx, g.dy, g.ids.map(short)]); g.ids.forEach((id) => inGroup.add(id)); }
  const single = moved.filter((m) => !inGroup.has(m[0])).map(([id, x, y]) => [short(id), x, y]);
  if (single.length) step.moved = single;
  if (shifted.length) step.shifted = shifted;
  if (added.length) step.addedJoints = added;
  if (changed.length) step.changedJoints = changed;
  if (removed.length) step.removedJoints = removed.map(short);

  const counts = new Map();
  for (const c of prev.geometry.constraints) { const k = constraintKey(c); counts.set(k, (counts.get(k) || 0) + 1); }
  const addedC = [];
  for (const c of next.geometry.constraints) {
    const k = constraintKey(c);
    const n = counts.get(k) || 0;
    if (n > 0) counts.set(k, n - 1); else addedC.push(stripPresentation(c));
  }
  const removedC = [];
  for (const c of prev.geometry.constraints) {
    const k = constraintKey(c);
    const n = counts.get(k) || 0;
    if (n > 0) { counts.set(k, n - 1); removedC.push(stripPresentation(c)); }
  }
  if (addedC.length) step.addedConstraints = addedC;
  if (removedC.length) step.removedConstraints = removedC;

  // every other document part (shapes, sketches, groups, profiles, parameters, vcarves, active sketch): the journal's own patch
  const patch = diffSnapshots(prev, next);
  delete patch.joints; delete patch.constraints;
  if (Object.keys(patch).length) step.patch = patch;
  return Object.keys(step).length ? step : null;
}

/**
 * compactJournal(journal, { now }) -> { base, steps, folded, redoSteps }
 *   journal: the full report's journal ({ base, steps, redo, current, truncated }).  now: ms timestamp the report's `t` clock counts from.
 */
export function compactJournal(journal, { now = Date.now() } = {}) {
  if (!journal) return null;
  const base = roundDeep(applyPatch(journal.base, {}));
  const docs = [base];
  for (const s of journal.steps) docs.push(roundDeep(applyPatch(docs[docs.length - 1], s.patch)));
  const short = shortIdFn([...new Set(docs.flatMap((d) => d.geometry.joints.map(([id]) => id)))]);
  const steps = [];
  let folded = 0;
  for (let i = 0; i < journal.steps.length; i++) {
    const s = journal.steps[i];
    const doc = docs[i], next = docs[i + 1];
    const cs = compactStep(doc, next, short);
    if (!cs) folded++;
    else steps.push({ n: s.seq, t: s.t == null ? null : Math.round((s.t - now) / 100) / 10, label: s.label, ...cs });
  }
  const out = { idNote: 'moved / shifted / removedJoints name a joint by its counter (j42 = j42_<stamp>) when that is unambiguous', base, steps, folded, finalHash: journal.current && journal.current.hash };
  if (journal.truncated) out.truncated = journal.truncated;
  return out;
}

/** replayCompactJournal({ base, steps }) -> the document after every compact step (rounded numbers; no label / glyph positions) */
export function replayCompactJournal({ base, steps }) {
  let doc = base;
  for (const s of steps) {
    if (s.patch) doc = applyPatch(doc, s.patch);
    const g = { ...doc.geometry };
    let joints = g.joints.map(([id, j]) => [id, j]);
    const resolve = resolveIdFn(joints.map(([id]) => id));
    const at = new Map(joints.map(([id], i) => [id, i]));
    for (const [sid, x, y] of s.moved || []) { const id = resolve(sid), i = at.get(id); joints[i] = [id, { ...joints[i][1], x, y }]; }
    for (const [dx, dy, sids] of s.shifted || []) for (const sid of sids) { const id = resolve(sid), i = at.get(id); const j = joints[i][1]; joints[i] = [id, { ...j, x: roundNum(j.x + dx), y: roundNum(j.y + dy) }]; }
    for (const [id, j] of s.changedJoints || []) joints[at.get(id)] = [id, j];
    if (s.removedJoints) { const rm = new Set(s.removedJoints.map(resolve)); joints = joints.filter(([id]) => !rm.has(id)); }
    for (const e of s.addedJoints || []) joints.push(e);
    g.joints = joints;
    const cons = g.constraints.slice();
    for (const c of s.removedConstraints || []) {
      const k = constraintKey(c);
      const i = cons.findIndex((q) => constraintKey(q) === k);
      if (i >= 0) cons.splice(i, 1);
    }
    for (const c of s.addedConstraints || []) cons.push(c);
    g.constraints = cons;
    doc = { ...doc, geometry: g };
  }
  return doc;
}

// ── log ──────────────────────────────────────────────────────────────────────────────────────────
// What the compact report leaves OUT of the event log, as DATA (each is counted under `dropped`, never silently lost). A line is dropped
// when its category matches and its first argument starts with `message`. warn / error lines are never dropped.
export const COMPACT_DROP = [
  { category: 'selection', message: '[selection-tools] pointerMove' },
  { category: 'selection', message: '[selection-tools] bestVisible check' },
  { category: 'renderer', message: '' },                       // every redraw
  { category: 'joints', message: '[input-manager] hit detection' },
  { category: 'solver', message: 'converged in' },
  { category: 'snap', message: '[ug.snap]' },
  { category: 'snap', message: '[SNAP CHECK]' },
  { category: 'magnifier', message: 'focus' },
  // the sketch re-adds EVERY constraint on each undo / drag restore: the journal's addedConstraints is the record of real adds
  { category: 'constraints', message: '[addConstraint] Adding constraint:' },
  // clicks are in the touch trace (pointerdown / pointerup with their target)
  { category: 'input', message: '[input-manager] svg pointerdown' },
  { category: 'input', message: 'svg pointerup' },
];
const isDropped = (e) => e.level !== 'warn' && e.level !== 'error' && COMPACT_DROP.some((d) => d.category === e.category && typeof e.args[0] === 'string' && e.args[0].startsWith(d.message));
export const MAX_ARG_CHARS = 240;
const stripDeep = (v) => {
  if (Array.isArray(v)) return v.map(stripDeep);
  if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) if (!PRESENTATION_KEYS.includes(k)) o[k] = stripDeep(v[k]); return o; }
  return v;
};
const clip = (a) => {
  const s = typeof a === 'string' ? a : JSON.stringify(a);
  return s.length > MAX_ARG_CHARS ? s.slice(0, MAX_ARG_CHARS) + `…(+${s.length - MAX_ARG_CHARS})` : a;
};
const ago = (t, now) => Math.round((t - now) / 100) / 10;

export function compactLog(log, { now = Date.now() } = {}) {
  const dropped = {};
  const out = [];
  for (const e of log) {
    const n = e.count || 1;
    if (isDropped(e)) { dropped[e.category] = (dropped[e.category] || 0) + n; continue; }
    const loud = e.level === 'warn' || e.level === 'error';
    const [msg, ...rest] = e.args;
    const line = { t: ago(e.t, now), cat: e.category };
    if (e.level !== 'log') line.lvl = e.level;
    if (n > 1) line.n = n;
    line.msg = loud ? msg : clip(msg);
    if (rest.length) line.data = loud ? roundDeep(rest) : roundDeep(stripDeep(rest)).map(clip);
    out.push(line);
  }
  return { log: out, dropped };
}

/** the newest error entry of the log: { t, message, stack } (null when there is none) */
export function lastErrorOf(log, { now = Date.now() } = {}) {
  for (let i = log.length - 1; i >= 0; i--) {
    const e = log[i];
    if (e.level !== 'error') continue;
    const strs = e.args.filter((a) => typeof a === 'string');
    const err = e.args.find((a) => a && typeof a === 'object' && a.error);
    const stack = err ? err.stack : (strs.find((s) => /\n\s+at /.test(s)) || null);
    return { t: ago(e.t, now), category: e.category, message: err ? err.message : strs[0] || null, stack };
  }
  return null;
}

// ── touch trace ──────────────────────────────────────────────────────────────────────────────────
export function compactTouchTrace(trace, { now = Date.now() } = {}) {
  const isTouch = trace.some((e) => e.pointerType === 'touch' || e.pointerType === 'pen');
  const events = trace.filter((e) => e.type !== 'pointermove');
  const moves = trace.length - events.length;
  if (!isTouch && !events.length) return null;
  return {
    pointerMovesDropped: moves,
    events: events.map((e) => {
      const { t, ...rest } = e;
      for (const k of Object.keys(rest)) if (rest[k] === false || rest[k] == null) delete rest[k];
      return { t: ago(t, now), ...rest };
    }),
  };
}

// ── the report ───────────────────────────────────────────────────────────────────────────────────
/**
 * buildCompactReport(full, { now }) -> the compact report. `full` is diagnostic-log.js buildReport({ full: true }) (its `session` field
 * carries what only the live state knows: tool, selection, undo / redo labels).
 */
export function buildCompactReport(full, { now = Date.parse(full.t) || Date.now() } = {}) {
  const session = full.session || {};
  const doc = full.document ? roundDeep(full.document) : null;
  const journal = compactJournal(full.journal, { now });
  const lg = compactLog(full.log || [], { now });
  const touch = compactTouchTrace(full.touchTrace || [], { now });
  const g = doc && doc.geometry;
  const labels = session.undoLabels || (full.journal ? full.journal.steps.map((s) => s.label) : []);
  const undoDepth = session.undoDepth != null ? session.undoDepth : (full.journal ? full.journal.steps.length : 0);
  const redoDepth = session.redoDepth != null ? session.redoDepth : (full.journal ? (full.journal.redo || []).length : 0);
  const summary = {
    app: full.app, url: full.url, ua: full.ua, t: full.t,
    build: null, // the build exposes no sha / version to the page: the url (deploy host) and the time are all there is
    settings: full.settings || {}, // every user setting that differs from its default (glyph style, units, grid / snap, theme ...)
    tool: session.tool ?? null,
    selection: session.selection ?? null,
    counts: g ? { shapes: g.shapes.length, joints: g.joints.length, constraints: g.constraints.length, journalSteps: full.journal ? full.journal.steps.length : 0, redoSteps: full.journal ? (full.journal.redo || []).length : 0 } : null,
    undoRedo: `undo ${undoDepth} / redo ${redoDepth}; last ${Math.min(10, labels.length)}: ${labels.slice(-10).join(', ')}`,
    lastError: lastErrorOf(full.log || [], { now }),
  };
  const report = { summary, document: doc, journal, log: lg.log, dropped: lg.dropped };
  if (touch) report.touchTrace = touch;
  if (full.journalError) report.journalError = full.journalError;
  report.viewport = full.viewport && { innerWidth: full.viewport.innerWidth, innerHeight: full.viewport.innerHeight, devicePixelRatio: full.viewport.devicePixelRatio };
  return report;
}
