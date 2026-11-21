// apps/shaper/src/cut-timeline.js — TASK 801 (owner turns 2555, 2608, 2667-2668): the Export step's SIMULATION, as data. PURE (no DOM, no three): the node tests
// read it as the page does.
//   THE TIMELINE (buildTimeline) is declared ONCE and the three Export views (2D, Paths, 3D) read the same one. It is built from the SAME derivation as Prepare / Paths
//   / the file: the preview copy's elements (export-preview.js previewItems: each element's operation, data-op, and its step, data-step), the operations in the
//   Operations list order (operations.js describeOperations, the preview's `ops`), and each element's bit-centre travel (op-derive.js bitCentrePaths: #core
//   deriveCutTravel, the paths in their cut DIRECTION). Order = the operations in list order x each operation's elements in the file's order (the exporter writes an
//   operation's cuts in their derivation order) x each element's travel paths in order. Nothing is hand-made: a step's path, direction and length are the travel's.
//   TIME is travel LENGTH (mm): each step lasts as long as its path is long (a closed path with its closing segment). An element with no travel (#core deriveCutTravel
//   determines none: a Roughing level the Origin pockets, a plain On line cut) plays along the derivation's own tool paths (op-derive.js simElements: deriveCutFootprint's
//   toolPaths) in their drawn order, role 'toolpath', with NO direction; one with neither is a step of length 0 at its place. Guides (the Stock, a pocket's start
//   mark) are never cut: they are in no step and always shown.
//   THE PREVIEW SESSION (createPreviewSession) is VCarve's PREVIEW TOOLPATHS panel (owner turns 2667-2668): "Preview selected" carves one operation into the CURRENT
//   virtual board, "Preview all" every ticked operation in the list order, "Reset preview" = the uncut board; the board KEEPS what earlier previews carved (until Reset),
//   a new preview first finishes the one in progress. The scrubber / steps / play work within the current run. Before the first preview (or after the plan changed) the
//   session is INACTIVE: the views show the finished part as before.
// The Origin is guided by hand and cuts each path in AutoPass depth passes: the simulation shows ORDER and DIRECTION, not real time (SIM.note); depth passes are not
// animated, each path is shown at its final depth.

/** The simulation's declared values: the speeds (x), the seconds the WHOLE file (every ticked operation) plays in at 1x (a run of some of them takes its share), the
 *  frame budget a 3D rebuild is measured against, and the one line under the controls. */
export const SIM = Object.freeze({
  speeds: Object.freeze([1, 4, 16]),
  fileSeconds: 40,
  note: 'Shows the order and direction of the cuts, not real time: the Origin is guided by hand and cuts each path in AutoPass depth passes. Each path is shown at its final depth (depth passes are not animated); a path with no set direction (a Roughing level, a plain On line) plays in its drawn order.',
});

const lengthOf = (pts, closed) => {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  if (closed && pts.length > 2) L += Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y);
  return L;
};
// cumulative lengths at each vertex (+ the closing vertex of a closed path)
function cumulative(pts, closed) {
  const c = [0];
  for (let i = 1; i < pts.length; i++) c.push(c[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  if (closed && pts.length > 2) c.push(c[c.length - 1] + Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y));
  return c;
}
const isCut = (it) => it.cutType && it.cutType !== 'guide';

/**
 * buildTimeline({ items, ops, bitPaths, members, only }) -> { ops, steps, elements, total, count }
 *   items     the preview copy's elements in FILE order (export-preview.js previewItems: { op, cutType, step, ... })
 *   ops       the operations in LIST order (the preview's `ops`: describeOperations; { id, typeLabel, cutType, tool })
 *   bitPaths  [{ index (the element's place in the file), travel: [{ role, direction, path, closed }] }] (op-derive.js bitCentrePaths)
 *   elements  optional, per element (op-derive.js simElements): { key: its membership '<op id>|<geometry key>', ord: its place among that membership's elements (the
 *             3D schedule), toolPaths?: the derivation's tool paths of a cut with no travel } | null
 *   only      optional Set of operation ids: the RUN (a preview of some operations); the numbering ("Operation 2 of 5") stays the whole file's
 * ops:   [{ id, n (1-based among the file's cutting operations), label, cutType, tool, first, last (step indices), t0, t1 }] (the run's, in list order)
 * steps: [{ op (index in ops), element, travel (index, -1: none), role, direction, path, closed, len, cum, t0, t1, level: { k, n } | null }]
 * elements: Map(element index -> { op, first, last, t0, t1, member }) ; total = the run's length (mm); count = the file's cutting operations.
 */
export function buildTimeline({ items, ops, bitPaths, elements = null, only = null }) {
  const travelOf = new Map((bitPaths || []).map((b) => [b.index, b.travel || []]));
  const byOp = new Map();
  items.forEach((it, i) => { if (it.op && isCut(it)) { if (!byOp.has(it.op)) byOp.set(it.op, []); byOp.get(it.op).push(i); } });
  const cutting = (ops || []).filter((op) => byOp.has(op.id));
  const out = { ops: [], steps: [], elements: new Map(), total: 0, count: cutting.length };
  let t = 0;
  cutting.forEach((op, n) => {
    if (only && !only.has(op.id)) return;
    const k = out.ops.length;
    const entry = { id: op.id, n: n + 1, label: op.typeLabel || op.cutType, cutType: op.cutType, tool: op.tool || null, first: out.steps.length, last: -1, t0: t, t1: t };
    for (const i of byOp.get(op.id)) {
      const it = items[i], el = elements && elements[i] ? elements[i] : null;
      const travel = travelOf.get(i) || (el && el.toolPaths ? el.toolPaths.map((tp) => ({ role: 'toolpath', direction: null, path: tp.points, closed: tp.closed })) : []); // no travel: the derivation's tool paths, no direction
      const first = out.steps.length, t0 = t;
      const level = it.step ? { k: it.step.k, n: it.step.n } : null;
      if (!travel.length) out.steps.push({ op: k, element: i, travel: -1, role: null, direction: null, path: null, closed: false, len: 0, cum: null, t0: t, t1: t, level });
      travel.forEach((tr, j) => {
        const len = lengthOf(tr.path, tr.closed);
        out.steps.push({ op: k, element: i, travel: j, role: tr.role, direction: tr.direction, path: tr.path, closed: Boolean(tr.closed), len, cum: cumulative(tr.path, tr.closed), t0: t, t1: t + len, level });
        t += len;
      });
      out.elements.set(i, { op: k, first, last: out.steps.length - 1, t0, t1: t, member: el ? { key: el.key, ord: el.ord } : null });
    }
    entry.last = out.steps.length - 1; entry.t1 = t;
    out.ops.push(entry);
  });
  out.total = t;
  return out;
}

/** The index of the step the time `t` is in (the last step that starts at or before t; a step of length 0 is passed once t is past it). -1 when there is none. */
export function stepIndexAt(tl, t) {
  const s = tl.steps;
  if (!s.length) return -1;
  if (t >= tl.total) return s.length - 1;
  let lo = 0, hi = s.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (s[mid].t0 <= t) lo = mid; else hi = mid - 1; }
  while (lo + 1 < s.length && s[lo].t1 <= t && s[lo + 1].t0 <= t) lo++; // a run of zero-length steps at t
  return lo;
}

/** The bit's point at time `t` on its step's path: { x, y } (the path's start for a step with no path: none). Linear along the path's own segments. */
export function pointOnStep(step, t) {
  if (!step || !step.path) return null;
  const P = step.path, c = step.cum, d = Math.max(0, Math.min(step.len, t - step.t0));
  let i = 1;
  while (i < c.length - 1 && c[i] < d) i++;
  const a = P[i - 1], b = i < P.length ? P[i] : P[0]; // the closing segment of a closed path ends at its first point
  const seg = c[i] - c[i - 1], f = seg > 0 ? (d - c[i - 1]) / seg : 0;
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
}
/** The part of the step's path already travelled at `t` (its points up to the bit's point), for the Paths view's solid trail. */
export function travelledOf(step, t) {
  if (!step || !step.path) return [];
  const P = step.path, c = step.cum, d = Math.max(0, Math.min(step.len, t - step.t0));
  const out = [P[0]];
  for (let i = 1; i < c.length && c[i] <= d; i++) out.push(i < P.length ? P[i] : P[0]);
  const p = pointOnStep(step, t);
  if (p && d < step.len) out.push(p);
  return out;
}

/** "Operation 2 of 5 · Roughing · level 3 of 8": the run's step at `t` in words ('' with no step). */
export function labelAt(tl, t) {
  const i = stepIndexAt(tl, t);
  if (i < 0) return '';
  const s = tl.steps[i], op = tl.ops[s.op];
  return [`Operation ${op.n} of ${tl.count}`, op.label, s.level ? `level ${s.level.k} of ${s.level.n}` : null].filter(Boolean).join(' · ');
}

/** The state of an element of the run at `t`: 'done' (cut), 'active' (being cut) or 'todo'; an element that is not in the run: null. A zero-length element is done
 *  once the time is past its place (or the run is at its end). */
export function elementStateAt(tl, i, t) {
  const e = tl.elements.get(i);
  if (!e) return null;
  if (t >= tl.total || (t >= e.t1 && t > e.t0)) return 'done';
  if (t >= e.t0 && t < e.t1) return 'active';
  return 'todo';
}

/** Step to the previous (-1) / next (+1) operation: the time of its start. Back from inside an operation = its own start; next from the last = the end. */
export function opStepTime(tl, t, dir) {
  if (!tl.ops.length) return 0;
  const EPS = 1e-6;
  if (dir > 0) { const next = tl.ops.find((o) => o.t0 > t + EPS); return next ? next.t0 : tl.total; }
  const cur = [...tl.ops].reverse().find((o) => o.t0 < t - EPS);
  return cur ? cur.t0 : 0;
}

/**
 * The 3D SCHEDULE: when each relief item (cut-plan.js planReliefItems: one per footprint of a membership, with `member` + `ord`) is carved in the run: its
 * element's end time. A relief item is the `ord`-th footprint of its membership; the element is the membership's element of the same place (the exporter writes one
 * element per cut, the derivation gives one footprint per cut), the last of them when the membership wrote fewer. An item of an operation in the run that no element
 * maps to is carved at its operation's end. Items of operations not in the run are left out. Returns [{ item, opId, time (its element's end), t0 (its start) }] in time
 * order: an item is carved once the run's time is at its end and past its start (elementStateAt's rule), or the run is at its end.
 */
export function reliefSchedule(tl, reliefItems) {
  const byMember = new Map(); // membership key -> its elements by ord
  for (const e of tl.elements.values()) {
    if (!e.member) continue;
    if (!byMember.has(e.member.key)) byMember.set(e.member.key, []);
    byMember.get(e.member.key)[e.member.ord] = e;
  }
  const opOf = new Map(tl.ops.map((o) => [o.id, o]));
  const out = [];
  for (const item of reliefItems) {
    const op = opOf.get(item.opId);
    if (!op) continue;
    const own = (byMember.get(item.member) || []).filter(Boolean);
    const e = (byMember.get(item.member) || [])[item.ord] || own[own.length - 1] || null;
    out.push(e ? { item, opId: item.opId, time: e.t1, t0: e.t0 } : { item, opId: item.opId, time: op.t1, t0: op.t0 });
  }
  return out.sort((a, b) => a.time - b.time);
}

/**
 * createPreviewSession() — the VCarve-style preview state (see the header). Pure: the caller ticks it (advance) and draws its view().
 *   setTimeline(fn)  the file's timeline maker: fn(only) -> buildTimeline(... only) (the plan changed: the session goes INACTIVE, the finished part is shown)
 *   previewSelected(id) / previewAll(ids)  start a run (the current run is finished first: its operations are carved)
 *   reset()          the uncut board (nothing carved, no run); play() / pause() / seek(t) / stepOp(dir) / setSpeed(x) / setAnimate(on)
 *   advance(seconds) the time a frame took: the run moves by seconds x speed x (file length / SIM.fileSeconds) mm; it pauses at its end (its operations carved)
 *   view()           { active, carved: Set(op ids), run: timeline | null, t, playing, speed, animate, label, total }
 * A preview with animate OFF goes straight to its end (VCarve's "Animate" box); `animate` starts as the caller says (off under reduced motion: no auto-play).
 */
export function createPreviewSession({ animate = true } = {}) {
  let make = null, fileLength = 0, active = false, carved = new Set(), run = null, t = 0, playing = false, speed = SIM.speeds[0], anim = animate, runId = 0;
  const finishRun = () => { if (run) for (const o of run.ops) carved.add(o.id); };
  function start(ids) {
    if (!make) return false;
    if (!active) { active = true; carved = new Set(); run = null; }
    finishRun();
    run = make(new Set(ids)); runId++;
    t = 0; playing = anim && run.total > 0;
    if (!anim) t = run.total;
    return true;
  }
  return {
    setTimeline(fn) { make = fn; fileLength = fn ? fn(null).total : 0; active = false; carved = new Set(); run = null; t = 0; playing = false; },
    previewSelected(id) { return start([id]); },
    previewAll(ids) { return start(ids); },
    reset() { if (!make) return; active = true; carved = new Set(); run = null; t = 0; playing = false; runId++; },
    play() { if (!run) return; if (t >= run.total) t = 0; playing = run.total > 0; },
    pause() { playing = false; },
    seek(v) { if (!run) return; t = Math.max(0, Math.min(run.total, Number(v) || 0)); },
    stepOp(dir) { if (!run) return; playing = false; t = opStepTime(run, t, dir); },
    setSpeed(x) { if (SIM.speeds.includes(Number(x))) speed = Number(x); },
    setAnimate(on) { anim = Boolean(on); if (!anim) playing = false; },
    advance(seconds) {
      if (!run || !playing) return false;
      const rate = fileLength / SIM.fileSeconds; // mm per second at 1x
      t = Math.min(run.total, t + seconds * speed * rate);
      if (t >= run.total) playing = false;
      return true;
    },
    view() { return { active, carved: new Set(carved), run, runId, t, playing, speed, animate: anim, total: run ? run.total : 0, label: run ? labelAt(run, t) : '' }; },
  };
}
