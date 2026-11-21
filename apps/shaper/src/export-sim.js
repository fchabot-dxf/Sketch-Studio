// apps/shaper/src/export-sim.js — TASK 801 (owner turns 2555, 2608, 2667-2668): the Export step's SIMULATION controls (the "Simulate" panel over the view, its toggle at the
// view's top right, closed at first: nothing of the Export side panel moves) and the one loop that drives
// the three views from ONE timeline (cut-timeline.js: built once per plan from the preview copy of the file, its operations and its bit-centre travel; the same
// derivation Prepare, Paths and the file use). VCarve's PREVIEW TOOLPATHS panel: Preview selected / Preview all / Reset preview, Animate on / off, speed; Play / Pause,
// the scrubber, step to the previous / next operation and the label "Operation 2 of 5 · Roughing · level 3 of 8" work within the current run.
//   2D     the file's elements appear in cutting order (export-preview.js setSim: what is not cut yet is hidden)
//   Paths  the same, the rest faint, and the BIT (a circle of the operation's own bit, to scale: its diameter where it meets the board at that path's depth for a ball
//          nose / V-bit / tapered bit, #core cutter-profile) travelling along the bit-centre path, the part of the path it has travelled drawn solid
//   3D     the WOOD left after the carved paths (review-view.js setSim: the finished part's relief items carved as the timeline passes their element, cut-timeline.js
//          reliefSchedule) and, with "Show passes", each played path's swept volume in its operation's colour (shaper.js CUT_TYPES passColor)
// The 3D steps PER PATH: the wood is rebuilt when the timeline passes the end of a path (never between), the latest wins while a rebuild runs, and the last builds
// are kept (stepping back shows them again without a rebuild).
// While the plan's paths are generating or a ticked operation is OUT OF DATE the card shows the Export step's own line (export-payload.js whenGenerated, through the
// page's `ensure`) and no run: the simulation never plays stale paths. Reduced motion: no auto-play (Animate starts off, a preview goes straight to its end); the
// scrubber, the steps and Play still work.
import { buildTimeline, createPreviewSession, stepIndexAt, pointOnStep, travelledOf, elementStateAt, reliefSchedule, SIM } from './cut-timeline.js';
import { parseShaperSvg, previewItems } from './export-preview.js';
import { cutterProfile, isShapedCutter, isTaperedCutter } from '#core/cutter-profile.js';
import { unitInfo } from '#core/units.js';
import { cutTypeById } from './shaper.js';
import { mountDisclosure } from './disclosure.js'; // the panel's toggle: the declared fold (the Operations sheet's), CLOSED at first

const SCRUB_STEPS = 1000; // the scrubber's resolution (a run of any length)
const MAX_FRAME_S = 0.5;  // a frame longer than this (the tab was hidden) moves the run by this much at most
const FRAME_LOG = 240;    // the frame times kept for inspect()
const BUILD_SHARE = 0.25; // while a run PLAYS, the 3D wood is rebuilt at most this share of the time (after a rebuild of c ms, the next waits c / share - c ms): the
                          // frames in between stay free (the camera, the label, the scrubber); paused, scrubbed or stepped it is rebuilt at once

// a depth as the file writes it ("6 mm", "0.25 in") in mm, or null
function depthMm(text) {
  const m = /^(-?\d+(?:\.\d+)?)\s*(\S*)$/.exec(text || ''), u = m && unitInfo(m[2] || 'mm');
  return m && u && u.kind === 'length' ? Number(m[1]) * u.f : null;
}
/** The bit marker's radius (mm) for an operation's tool at a path's depth: the bit's radius, or for a shaped bit its half-width where it meets the board (#core
 *  cutterProfile xMax: a shallow V-bit / ball-nose path is narrower than the bit). */
export function markerRadius(tool, depth) {
  if (!tool || !(tool.dia > 0)) return 0;
  if (isShapedCutter(tool.shape) && depth > 0) {
    const p = cutterProfile(tool.shape, tool.dia, tool.angle, depth, isTaperedCutter(tool.shape) ? { taperAngle: tool.angle, shankDia: tool.shank } : null);
    if (p) return p.xMax;
  }
  return tool.dia / 2;
}

/**
 * mountExportSim({ els, ensure, reliefItems, mode, flat, solid, reducedMotion }) -> { refresh(sig), invalidate(), render(), inspect(), session }
 *   els          the panel's elements: { toggle (its button over the view), card (the panel), op, previewSel, previewAll, reset, play, prev, next, scrub, speed, animate, passes, passesRow, label }
 *   ensure       async (sig, say) => the preview copy { svg, ops, bitPaths, simElements } for this plan, or null (the page's: it waits for the paths and says why)
 *   reliefItems  () => the finished part's relief items (cut-plan.js planReliefItems of the ticked operations)
 *   mode         () => '3d' | '2d' | 'paths' (the view shown); flat = the 2D / Paths view (export-preview.js); solid = () => the 3D view (review-view.js) or null
 */
export function mountExportSim({ els, ensure, reliefItems, mode, flat, solid, reducedMotion = false }) {
  const session = createPreviewSession({ animate: !reducedMotion });
  let data = null, dataSig, call = 0, raf = 0, last = 0, fullSched = null, runSched = null, schedRun = -1, woodKey = null, nextBuildAt = 0;
  const frames = [], rebuilds = [];
  mountDisclosure({ host: els.toggle, head: els.toggle, body: els.card, open: false }); // over the view: open while the user simulates
  els.animate.checked = !reducedMotion;
  els.speed.replaceChildren(...SIM.speeds.map((x) => new Option(`${x}×`, String(x))));

  function invalidate() {
    data = null; dataSig = undefined; fullSched = null; runSched = null; schedRun = -1; woodKey = null;
    session.setTimeline(null);
    stop();
    render();
  }
  /** The plan shown now (`sig`, the Export step's signature): its timeline made (once per plan), the session inactive until a Preview. */
  async function refresh(sig) {
    if (sig === dataSig && data) { render(); return; }
    const mine = ++call;
    invalidate();
    dataSig = sig;
    els.label.textContent = '';
    const p = await ensure(sig, say);
    if (mine !== call) return;
    if (!p) { els.label.textContent = 'No cuts to simulate'; render(); return; }
    const items = previewItems(parseShaperSvg(p.svg, els.card.ownerDocument));
    const make = (only) => buildTimeline({ items, ops: p.ops, bitPaths: p.bitPaths || [], elements: p.simElements || null, only });
    data = { items, ops: p.ops, make, full: make(null), relief: null };
    session.setTimeline(make);
    fillOps();
    render();
  }
  const say = (text, action) => { // the page's waiting / out-of-date line (sayIn): into the label, the card's buttons off meanwhile
    els.label.replaceChildren();
    const doc = els.label.ownerDocument;
    if (action) { const b = doc.createElement('button'); b.type = 'button'; b.className = 'sk-wait-action'; b.textContent = action.label; b.addEventListener('click', () => action.run()); els.label.append(`${text}. `, b); }
    else { const s = doc.createElement('span'); s.className = 'sk-wait-spin'; s.setAttribute('aria-hidden', 'true'); els.label.append(s, text); }
    setEnabled(false);
  };
  function fillOps() {
    const keep = els.op.value;
    els.op.replaceChildren(...data.full.ops.map((o) => new Option(`${o.n}. ${data.ops.find((x) => x.id === o.id).rowText || o.label}`, o.id)));
    if (data.full.ops.some((o) => o.id === keep)) els.op.value = keep;
  }
  function setEnabled(on) {
    for (const k of ['op', 'previewSel', 'previewAll', 'reset']) els[k].disabled = !on;
    const run = on && session.view().run;
    for (const k of ['play', 'prev', 'next', 'scrub']) els[k].disabled = !run;
  }

  const reliefOf = () => { if (!data.relief) data.relief = reliefItems(); return data.relief; };
  function schedules(v) {
    if (!fullSched) {
      fullSched = new Map(); // op id -> its relief items in timeline order (the passes' mesh order)
      for (const s of reliefSchedule(data.full, reliefOf())) { if (!fullSched.has(s.opId)) fullSched.set(s.opId, []); fullSched.get(s.opId).push(s.item); }
    }
    if (v.run && schedRun !== v.runId) { runSched = reliefSchedule(v.run, reliefOf()); schedRun = v.runId; }
    if (!v.run) { runSched = []; schedRun = v.runId; }
  }
  const isDone = (s, v) => v.t >= v.total || (v.t >= s.time && v.t > s.t0);

  function render() {
    const v = session.view();
    setEnabled(!!data);
    els.play.dataset.state = v.playing ? 'pause' : 'play';
    els.play.setAttribute('aria-label', v.playing ? 'Pause' : 'Play');
    els.scrub.value = String(v.run && v.total > 0 ? Math.round((v.t / v.total) * SCRUB_STEPS) : 0);
    els.speed.value = String(v.speed);
    els.passesRow.hidden = mode() !== '3d';
    if (data) els.label.textContent = !v.active ? 'Press Preview to simulate the cuts' : v.run ? v.label || 'Nothing to cut in this preview' : 'Uncut board: press Preview';
    const m = mode();
    if (!data || !v.active) { woodKey = null; flat.setSim(null); const s = solid(); if (s) s.setSim(null); return; }
    if (m === '3d') { const s = solid(); if (s) render3d(v, s); return; }
    woodKey = null;
    flat.setSim(flatView(v));
  }
  function flatView(v) {
    const run = v.run, states = data.items.map((it, i) => {
      if (!it.op || !it.cutType || it.cutType === 'guide') return null;
      if (v.carved.has(it.op)) return 'done';
      const s = run ? elementStateAt(run, i, v.t) : null;
      return s || 'todo';
    });
    let marker = null, trail = null;
    if (run && v.t < run.total && mode() === 'paths') {
      const step = run.steps[stepIndexAt(run, v.t)];
      const p = step && pointOnStep(step, v.t);
      if (p) { marker = { ...p, r: markerRadius(run.ops[step.op].tool, depthMm(data.items[step.element].depth)) }; trail = travelledOf(step, v.t); }
    }
    return { states, marker, trail };
  }
  function render3d(v, s) {
    schedules(v);
    const inRun = new Set(v.run ? v.run.ops.map((o) => o.id) : []);
    const doneRun = runSched.filter((x) => isDone(x, v));
    const key = `${v.runId}|${[...v.carved].sort().join(',')}|${doneRun.length}`; // the set grows with the time in a run: its size names it
    const items = () => [...reliefOf().filter((it) => v.carved.has(it.opId)), ...doneRun.filter((x) => !v.carved.has(x.opId)).map((x) => x.item)];
    const shownOps = [...new Set([...v.carved, ...inRun])];
    const count = (id) => (v.carved.has(id) ? (fullSched.get(id) || []).length : doneRun.filter((x) => x.opId === id).length);
    const passes = { key: dataSig, show: els.passes.checked, ops: shownOps.filter((id) => fullSched.has(id)).map((id) => ({ id, color: passColorOf(id), items: fullSched.get(id), count: count(id) })) };
    const now = performance.now();
    const wait = v.playing && woodKey !== null && key !== woodKey && now < nextBuildAt; // playing: the last rebuild's share of the time is not over yet
    const r = s.setSim({ key, items, passes, keepWood: wait });
    if (!wait) woodKey = key;
    if (r && r.built) {
      nextBuildAt = performance.now() + r.woodMs * (1 / BUILD_SHARE - 1);
      rebuilds.push({ ms: Math.round(r.woodMs), run: doneRun.length }); if (rebuilds.length > FRAME_LOG) rebuilds.shift();
    }
  }
  const passColorOf = (id) => cutTypeById(data.ops.find((o) => o.id === id).cutType).passColor; // a cutting operation's type declares it (shaper.js CUT_TYPES)

  // the loop: one requestAnimationFrame while a run plays
  function frame(now) {
    raf = 0;
    const dt = last ? Math.min(MAX_FRAME_S, (now - last) / 1000) : 0;
    last = now;
    frames.push(dt * 1000); if (frames.length > FRAME_LOG) frames.shift();
    session.advance(dt);
    render();
    if (session.view().playing) raf = requestAnimationFrame(frame); else last = 0;
  }
  function go() { if (!raf && session.view().playing) { last = 0; raf = requestAnimationFrame(frame); } }
  function stop() { if (raf) cancelAnimationFrame(raf); raf = 0; last = 0; }
  const act = (fn) => () => { if (!data) return; fn(); render(); go(); };
  els.previewSel.addEventListener('click', act(() => session.previewSelected(els.op.value)));
  els.previewAll.addEventListener('click', act(() => session.previewAll(data.full.ops.map((o) => o.id))));
  els.reset.addEventListener('click', act(() => { stop(); session.reset(); }));
  els.play.addEventListener('click', act(() => { if (session.view().playing) { session.pause(); stop(); } else session.play(); }));
  els.prev.addEventListener('click', act(() => { stop(); session.stepOp(-1); }));
  els.next.addEventListener('click', act(() => { stop(); session.stepOp(1); }));
  els.scrub.addEventListener('input', act(() => { const v = session.view(); session.pause(); stop(); session.seek((Number(els.scrub.value) / SCRUB_STEPS) * v.total); }));
  els.speed.addEventListener('change', act(() => session.setSpeed(els.speed.value)));
  els.animate.addEventListener('change', act(() => { session.setAnimate(els.animate.checked); if (!els.animate.checked) stop(); }));
  els.passes.addEventListener('change', () => render());
  render();

  /** What the card and the views show now (the live tests read it): the session, the label, frame times and the 3D rebuilds. */
  function inspect() {
    const v = session.view();
    return { active: v.active, playing: v.playing, t: v.t, total: v.total, speed: v.speed, animate: v.animate, label: els.label.textContent, carved: [...v.carved],
      run: v.run ? v.run.ops.map((o) => ({ id: o.id, n: o.n, label: o.label, t0: o.t0, t1: o.t1, steps: o.last - o.first + 1 })) : null, count: data ? data.full.count : 0,
      step: v.run ? stepIndexAt(v.run, v.t) : -1, scrub: Number(els.scrub.value), frames: frames.slice(), rebuilds: rebuilds.slice(),
      ops: [...els.op.options].map((o) => ({ id: o.value, text: o.textContent })), disabled: Object.fromEntries(['previewSel', 'play', 'scrub'].map((k) => [k, els[k].disabled])) };
  }
  /** Pause a run (the Export step is left: nothing plays unseen). */
  function pause() { session.pause(); stop(); render(); }
  return { refresh, invalidate, render, pause, inspect, session, clearLog: () => { frames.length = 0; rebuilds.length = 0; } };
}
