// tests/export-sim-801-node.test.js — TASK 801: the Export step's SIMULATION timeline (apps/shaper/src/cut-timeline.js), pure, on the Shaper node page (tests/helpers/node-app.js;
// the mounted card and views: tests/export-sim-801-live.test.js). Drawings and STLs are built here (never an owner's file).
//  1. ORDER: the timeline = the operations in the Operations LIST order x each operation's elements in the FILE's order x each element's bit-centre travel in order
//     (op-derive.js bitCentrePaths, #core deriveCutTravel: path, direction): read off the preview copy the page makes (export-payload.js exportFileOf preview); a
//     reorder of the list reorders the timeline; guides are in no step; a cut with no travel (a plain On line, a Roughing level) plays along the derivation's tool
//     paths (op-derive.js simElements), with no direction.
//  2. DURATIONS: each step lasts its path's length (a closed path with its closing segment); the total is their sum; a run of some operations is their share.
//  3. SCRUB: stepIndexAt(t) is the step whose [t0, t1) holds t; pointOnStep is the point that far along the path (its start at t0, the middle of a segment half way,
//     back at the start at the end of a closed path); travelledOf ends at that point; labelAt "Operation 2 of 3 · Inside", with "level k of N" for a Roughing.
//  4. THE SESSION (VCarve's Preview toolpaths): inactive until a preview; Preview selected carves one operation into the current board, which keeps it; Preview all
//     every ticked operation in list order; a new preview finishes the one playing; Reset = the uncut board; Animate off = straight to the end; speeds; stepOp.
//  5. 3D SCHEDULE: every relief item (cut-plan.js planReliefItems: + opId, member, ord) is carved at the end of ITS element (same membership, same place): the counts
//     match per membership; at the end of Preview all the wood is the finished part (buildRelief of the scheduled items == the Review's build, triangle for triangle);
//     the passes (#core sweptVolumes): one range per item, the first item's top face area = its footprint's area.
//  6. The bit marker's radius: an end mill's radius; a V-bit's half-width at a shallow depth (#core cutterProfile).
import assert from 'node:assert';
import { open } from './helpers/node-app.js';
import SettingsManager from '#core/settings-manager.js';
import { findLoops } from '#core/loop-finder.js';
import { buildRelief, createReliefCache, sweptVolumes } from '#core/relief-model.js';
import { regionsFromRings } from '#core/plot/clip.js';
import * as M from './helpers/stl-mesh.js';
import { V2_PLAN } from './helpers/plan-v2.js';
import { exportFileOf, bitCentrePaths, simElements } from '../apps/shaper/src/export-payload.js';
import { parseShaperSvg, previewItems } from '../apps/shaper/src/export-preview.js';
import { planReliefItems } from '../apps/shaper/src/cut-plan.js';
import { storeOps, reorderOps } from '../apps/shaper/src/operations-store.js';
import { resolveStock } from '../apps/shaper/src/stock.js';
import { buildTimeline, stepIndexAt, pointOnStep, travelledOf, labelAt, elementStateAt, opStepTime, reliefSchedule, createPreviewSession, SIM } from '../apps/shaper/src/cut-timeline.js';
import { markerRadius } from '../apps/shaper/src/export-sim.js';

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };
const near = (a, b, tol, m) => { assert.ok(Math.abs(a - b) <= tol, `${m}: ${a} vs ${b} (tol ${tol})`); checks++; };
const TICKED = { ticked: true };
SettingsManager.set('DOC_UNIT', 'mm', { persist: false });
const lengthOf = (pts, closed) => { let L = 0; for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); if (closed) L += Math.hypot(pts[0].x - pts.at(-1).x, pts[0].y - pts.at(-1).y); return L; };

const app = await open({ host: 'shaper' });
// the page's preview copy of the plan and the timeline made from it (what export-sim.js builds from the page's previewCopy)
const timelineOf = (st, only = null) => {
  const p = exportFileOf(st, { preview: true });
  const items = previewItems(parseShaperSvg(p.svg, app.document));
  const bitPaths = bitCentrePaths(st, p.written), elements = simElements(st, p.written, bitPaths);
  return { p, items, bitPaths, simEls: elements, tl: buildTimeline({ items, ops: p.ops, bitPaths, elements, only }) };
};
try {
  // ── the drawing: a plate (Outside) with a hole (Inside), a Raster pocket, a plain On line square, a Guide ──
  const st = app.state;
  for (const k of [...st.joints.keys()]) st.joints.delete(k);
  st.shapes.length = 0; st.constraints.length = 0; st.profiles.length = 0;
  const poly = (n, pts) => { pts.forEach(([x, y], i) => st.joints.set(n + 'j' + i, { x, y })); pts.forEach((_, i) => st.shapes.push({ id: n + 's' + i, type: 'line', joints: [n + 'j' + i, n + 'j' + ((i + 1) % pts.length)] })); };
  const circ = (n, x, y, r) => { st.joints.set(n + 'c', { x, y }); st.shapes.push({ id: n + 's', type: 'circle', joints: [n + 'c'], radius: r }); };
  poly('P', [[0, 0], [200, 0], [200, 120], [0, 120]]);
  circ('H', 30, 30, 12);
  poly('R', [[70, 15], [180, 15], [180, 60], [70, 60]]);
  poly('O', [[70, 80], [120, 80], [120, 105], [70, 105]]);
  circ('G', 165, 95, 10);
  const loopOf = (p) => findLoops(st).find((l) => l.edges.every((e) => e.startsWith(p)));
  const B = { cutOffset: 0, toolDia: 6.35, cutterShape: 'endmill' };
  V2_PLAN.use(st).load([
    ['loop:' + loopOf('P').id, { ...B, cutType: 'exterior', cutDepth: 18 }],
    ['loop:' + loopOf('H').id, { ...B, cutType: 'interior', cutDepth: 18 }],
    ['loop:' + loopOf('R').id, { ...B, cutType: 'pocket', cutDepth: 4, clearing: 'raster', stepover: 40, finishAllowance: 0.5, rasterAngle: 0 }],
    ['loop:' + loopOf('O').id, { ...B, cutType: 'online', cutDepth: 3 }],
    ['loop:' + loopOf('G').id, { cutType: 'guide', cutDepth: 0, cutOffset: 0, toolDia: 6.35 }],
  ]);
  const listIds = () => storeOps().map((o) => o.id);
  const typeOf = (id) => storeOps().find((o) => o.id === id).type;

  // ── 1. ORDER ──
  let { p, items, bitPaths, simEls, tl } = timelineOf(st);
  const cuttingInList = listIds().filter((id) => items.some((it) => it.op === id && it.cutType !== 'guide'));
  eq(tl.ops.map((o) => o.id), cuttingInList, 'the timeline\'s operations = the Operations list order (the ones that cut)');
  eq(tl.count, 4, 'four cutting operations (the Guide cuts nothing)');
  for (const o of tl.ops) {
    const steps = tl.steps.slice(o.first, o.last + 1);
    const els = [...new Set(steps.map((s) => s.element))];
    eq(els, items.map((it, i) => [it, i]).filter(([it]) => it.op === o.id && it.cutType !== 'guide').map(([, i]) => i), `${typeOf(o.id)}: its elements in the file's order`);
    for (const e of els) {
      const own = steps.filter((s) => s.element === e && s.path);
      const bp = (bitPaths.find((b) => b.index === e) || { travel: [] }).travel;
      if (bp.length) eq(own.map((s) => [s.role, s.direction, s.path]), bp.map((t) => [t.role, t.direction, t.path]), `${typeOf(o.id)} element ${e}: its steps = its bit-centre travel, in order, with its direction`);
      else eq(own.map((s) => [s.role, s.direction, s.path]), (simEls[e].toolPaths || []).map((tp) => ['toolpath', null, tp.points]), `${typeOf(o.id)} element ${e} (no travel): its steps = the derivation's tool paths, no direction`);
    }
  }
  ok(!tl.steps.some((s) => items[s.element].cutType === 'guide'), 'no guide is a step');
  const onl = tl.ops.find((o) => typeOf(o.id) === 'online');
  const onlSteps = tl.steps.slice(onl.first, onl.last + 1);
  ok(onlSteps.length >= 1 && onlSteps.every((s) => s.role === 'toolpath' && s.direction === null && s.len > 0), `a plain On line cut (deriveCutTravel determines no direction) plays along its tool path, no direction (${onlSteps.length} steps)`);
  ok(!bitPaths.some((b) => items[b.index].op === onl.id), 'and it has no bit-centre travel (the Paths view draws none for it, as before)');
  // a reorder of the list reorders the timeline
  const before = tl.ops.map((o) => o.id);
  reorderOps([...listIds()].reverse());
  ({ p, items, bitPaths, simEls, tl } = timelineOf(st));
  eq(tl.ops.map((o) => o.id), [...before].reverse(), 'the list reordered (reversed): the timeline follows it');
  eq(tl.ops.map((o) => o.n), [1, 2, 3, 4], 'numbered in the new order');
  reorderOps(before);
  ({ p, items, bitPaths, simEls, tl } = timelineOf(st));

  // ── 2. DURATIONS ──
  for (const s of tl.steps) if (s.path) near(s.t1 - s.t0, lengthOf(s.path, s.closed), 1e-6, `step ${s.element}/${s.travel} lasts its path's length`);
  near(tl.total, tl.steps.reduce((a, s) => a + s.len, 0), 1e-6, 'the total = the sum of the lengths');
  for (let i = 1; i < tl.steps.length; i++) near(tl.steps[i].t0, tl.steps[i - 1].t1, 1e-9, `step ${i} starts where ${i - 1} ends`);
  const raster = tl.ops.find((o) => typeOf(o.id) === 'pocket');
  ok(raster.last - raster.first + 1 >= 5, `the raster pocket's passes are steps of their own (${raster.last - raster.first + 1})`);
  const runR = timelineOf(st, new Set([raster.id])).tl;
  near(runR.total, raster.t1 - raster.t0, 1e-6, 'a run of one operation = its share of the file');
  eq([runR.ops[0].n, runR.count], [raster.n, 4], 'its number stays the file\'s ("Operation n of 4")');

  // ── 3. SCRUB ──
  const s0 = tl.steps.find((s) => s.path && s.path.length > 2);
  const k0 = tl.steps.indexOf(s0);
  eq(stepIndexAt(tl, s0.t0), k0, 'scrub to a step\'s start: that step');
  eq(stepIndexAt(tl, (s0.t0 + s0.t1) / 2), k0, 'scrub to its middle: that step');
  eq(pointOnStep(s0, s0.t0), { x: s0.path[0].x, y: s0.path[0].y }, 'the bit at its start point');
  const half = s0.t0 + Math.hypot(s0.path[1].x - s0.path[0].x, s0.path[1].y - s0.path[0].y) / 2;
  const mid = pointOnStep(s0, half);
  near(mid.x, (s0.path[0].x + s0.path[1].x) / 2, 1e-9, 'half way along the first segment: x'); near(mid.y, (s0.path[0].y + s0.path[1].y) / 2, 1e-9, 'y');
  if (s0.closed) { const end = pointOnStep(s0, s0.t1); near(end.x, s0.path[0].x, 1e-9, 'a closed path ends back at its start: x'); near(end.y, s0.path[0].y, 1e-9, 'y'); }
  const tr = travelledOf(s0, half);
  eq(tr.length, 2, 'travelled half a segment: its start and the bit\'s point');
  eq(tr[1], mid, 'the trail ends at the bit');
  eq(stepIndexAt(tl, tl.total), tl.steps.length - 1, 'scrub to the end: the last step');
  eq(labelAt(tl, tl.ops[1].t0 + 1e-6), `Operation 2 of 4 · ${p.ops.find((o) => o.id === tl.ops[1].id).typeLabel}`, 'the label: Operation 2 of 4 · its type');
  eq(elementStateAt(tl, s0.element, s0.t0 - 1e-6 > 0 ? s0.t0 - 1e-6 : 0) === 'done', false, 'an element is not cut before its start');
  eq(elementStateAt(tl, s0.element, (s0.t0 + s0.t1) / 2), 'active', 'being cut in its middle');
  eq(elementStateAt(tl, s0.element, tl.elements.get(s0.element).t1), 'done', 'cut at its end');
  eq(opStepTime(tl, tl.ops[1].t0 + 5, -1), tl.ops[1].t0, 'step back from inside an operation: its start');
  eq(opStepTime(tl, tl.ops[1].t0, -1), tl.ops[0].t0, 'step back from its start: the one before');
  eq(opStepTime(tl, tl.ops[1].t0 + 5, 1), tl.ops[2].t0, 'step forward: the next operation\'s start');
  eq(opStepTime(tl, tl.ops.at(-1).t0 + 1, 1), tl.total, 'step forward from the last: the end');

  // ── 4. THE SESSION ──
  const make = (only) => timelineOf(st, only).tl;
  const S = createPreviewSession({ animate: true });
  S.setTimeline(make);
  eq(S.view().active, false, 'inactive until a preview (the finished part is shown)');
  S.previewSelected(raster.id);
  let v = S.view();
  eq([v.active, v.playing, v.t, v.run.ops.map((o) => o.id)], [true, true, 0, [raster.id]], 'Preview selected: a run of that operation, playing from 0');
  const rate = tl.total / SIM.fileSeconds;
  S.advance(1); near(S.view().t, rate, 1e-6, '1 s at 1x: the whole file\'s length / SIM.fileSeconds');
  S.setSpeed(16); S.advance(0.5); near(S.view().t, rate * 9, 1e-6, '0.5 s at 16x: 8 s more');
  S.setSpeed(4); S.advance(1e6); v = S.view();
  eq([v.playing, v.t], [false, v.total], 'it pauses at its end');
  const plate = tl.ops.find((o) => typeOf(o.id) === 'exterior');
  S.previewSelected(plate.id); v = S.view();
  eq([...v.carved], [raster.id], 'a new preview: the board KEEPS the earlier one (carved)');
  S.pause(); S.seek(v.total / 2);
  S.previewAll(tl.ops.map((o) => o.id)); v = S.view();
  eq([...v.carved].sort(), [raster.id, plate.id].sort(), 'a preview started while one is part way: that one is finished first (carved)');
  eq(v.run.ops.map((o) => o.id), tl.ops.map((o) => o.id), 'Preview all: every ticked operation, in list order');
  S.reset(); v = S.view();
  eq([v.active, v.carved.size, v.run], [true, 0, null], 'Reset preview: the uncut board');
  S.setAnimate(false); S.previewSelected(onl.id); v = S.view();
  eq([v.playing, v.t === v.total], [false, true], 'Animate off: a preview goes straight to its end');
  S.setAnimate(true); S.previewAll(tl.ops.map((o) => o.id)); S.pause();
  S.seek(tl.ops[2].t0 + 1); S.stepOp(-1); eq(S.view().t, tl.ops[2].t0, 'stepOp(-1) inside operation 3: its start');
  S.stepOp(1); eq(S.view().t, tl.ops[3].t0, 'stepOp(+1): operation 4');
  S.setTimeline(make); eq([S.view().active, S.view().run], [false, null], 'a new plan: inactive again');

  // ── 5. 3D SCHEDULE ──
  const relief = planReliefItems(st, TICKED);
  ok(relief.every((it) => typeof it.opId === 'string' && it.member.startsWith(it.opId + '|') && Number.isInteger(it.ord)), 'every relief item names its operation, membership and place');
  const full = timelineOf(st).tl;
  const sched = reliefSchedule(full, relief);
  const cutting = relief.filter((it) => full.ops.some((o) => o.id === it.opId));
  eq(relief.filter((it) => !cutting.includes(it)).map((it) => it.cutType), ['guide'], 'the one relief item of no cutting operation is the Guide (it removes nothing)');
  eq(sched.length, cutting.length, 'every relief item of a cutting operation is scheduled');
  const els = [...full.elements.values()];
  for (const s of sched) {
    const isMark = s.item.footprints.some((fp) => fp.clearing && fp.clearing.role === 'start');
    const e = isMark ? els.filter((x) => x.member && x.member.key === s.item.member).at(-1) : els.find((x) => x.member && x.member.key === s.item.member && x.member.ord === s.item.ord);
    ok(e && e.t1 === s.time && full.ops[e.op].id === s.item.opId, `relief item ${s.item.member}#${s.item.ord}: ${isMark ? 'the pocket start mark (a guide: no step) shown at the end of the last element of its pocket' : 'carved at the end of its own element'}`);
  }
  eq(sched.filter((s) => s.item.footprints.some((fp) => fp.clearing && fp.clearing.role === 'start')).length, 1, 'one start mark (of the raster pocket)');
  for (let i = 1; i < sched.length; i++) ok(sched[i].time >= sched[i - 1].time, 'in time order');
  const stock = resolveStock(st).stock;
  const ref = buildRelief({ stock, items: relief, cache: createReliefCache() });
  const atEnd = buildRelief({ stock, items: sched.map((s) => s.item), cache: createReliefCache() });
  eq(atEnd.stats.triangles, ref.stats.triangles, `at the end of Preview all the wood is the finished part (${ref.stats.triangles} triangles)`);
  eq([...atEnd.meshes.floor.positions], [...ref.meshes.floor.positions], 'its floors vertex for vertex');
  const first = sched.filter((s) => s.time <= full.ops[0].t1);
  ok(first.length > 0 && first.length < sched.length, `after operation 1, ${first.length} of ${sched.length} items are carved`);
  const sv = sweptVolumes(relief, { thickness: stock.thickness });
  eq(sv.ends.length, relief.length, 'the passes: one index range per item');
  ok(sv.ends.every((e, i) => i === 0 || e >= sv.ends[i - 1]), 'the ranges grow in order (a draw range shows the first k)');
  { // the first item that removes wood: its top face (y = 0, normal +y) has the area of its footprint
    const k = sv.ends.findIndex((e) => e > 0), it = relief[k];
    const from = k ? sv.ends[k - 1] : 0;
    let top = 0;
    for (let t = from; t < sv.ends[k]; t += 3) {
      const [a, b, c] = [sv.indices[t], sv.indices[t + 1], sv.indices[t + 2]].map((i) => [sv.positions[3 * i], sv.positions[3 * i + 1], sv.positions[3 * i + 2]]);
      if (a[1] === 0 && b[1] === 0 && c[1] === 0 && sv.normals[3 * sv.indices[t] + 1] === 1) top += Math.abs((b[0] - a[0]) * (c[2] - a[2]) - (c[0] - a[0]) * (b[2] - a[2])) / 2;
    }
    const regs = it.footprints.flatMap((fp) => regionsFromRings((fp.rings || []).filter((g) => g.length >= 3).map((g) => g.map((q) => [q.x, q.y])), fp.fillRule));
    const area = regs.reduce((s, r) => s + Math.abs(r.outer.slice(0, -1).reduce((a, q, i, o) => a + q[0] * o[(i + 1) % o.length][1] - o[(i + 1) % o.length][0] * q[1], 0)) / 2 - r.holes.reduce((h, g) => h + Math.abs(g.slice(0, -1).reduce((a, q, i, o) => a + q[0] * o[(i + 1) % o.length][1] - o[(i + 1) % o.length][0] * q[1], 0)) / 2, 0), 0);
    near(top, area, Math.max(0.05, area * 1e-6), `the first pass's top face = its footprint's area (${area.toFixed(2)} mm²)`);
  }

  // ── 3b. a Roughing's levels in the label (an STL relief: a dome) ──
  {
    const res = app.stl.openFile(M.binaryStl(M.dome(25, 16, 48)), 'dome.stl');
    ok(res.ok, 'the dome opens as a relief: ' + res.message);
    const { tl: rt, items: ri } = timelineOf(app.state);
    const ro = rt.ops.find((o) => typeOf(o.id) === 'roughing');
    const levels = ri.filter((it) => it.op === ro.id && it.step);
    ok(levels.length > 3, `its Roughing writes its levels (${levels.length} elements with a step)`);
    const st3 = rt.steps.slice(ro.first, ro.last + 1).find((s) => s.level && s.level.k === 3 && s.path);
    eq(labelAt(rt, st3.t0 + 1e-6), `Operation ${ro.n} of ${rt.count} · Roughing · level 3 of ${st3.level.n}`, 'the label names the level: "Operation 1 of 1 · Roughing · level 3 of N"');
    const rel2 = planReliefItems(app.state, TICKED), sch2 = reliefSchedule(rt, rel2);
    eq(sch2.length, rel2.length, 'the relief: every item scheduled');
    const byMember = (list, f) => { const m = new Map(); for (const x of list) m.set(f(x), (m.get(f(x)) || 0) + 1); return [...m.entries()].sort(); };
    eq(byMember(rel2, (x) => x.member), byMember([...rt.elements.values()].filter((e) => e.member), (e) => e.member.key), 'per membership: as many relief items as elements (one footprint and one element per cut)');
  }

  // ── 6. the bit marker ──
  eq(markerRadius({ shape: 'endmill', dia: 6.35 }, 5), 3.175, 'an end mill: its radius');
  near(markerRadius({ shape: 'vbit', dia: 12.7, angle: 90 }, 2), 2, 1e-9, 'a 90° V-bit 2 mm deep: 2 mm half-width at the board');
  eq(markerRadius({ shape: 'vbit', dia: 12.7, angle: 90 }, 20), 6.35, 'deeper than its flutes: its radius');
  ok(markerRadius({ shape: 'ballnose', dia: 6.35 }, 1) < 3.175, 'a ball nose 1 mm deep: narrower than its radius');
} finally {
  V2_PLAN.clear();
  app.close();
}
console.log(`export-sim-801-node.test.js: ok (${checks} checks)`);
