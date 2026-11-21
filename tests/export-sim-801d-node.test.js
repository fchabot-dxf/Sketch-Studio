// tests/export-sim-801d-node.test.js — TASK 801d (owner turn 3179: "a faked free-motion sweep that's obviously freehand"): in the Export SIMULATION only, a FREEHAND pocket
// (the Origin's own Pocket, cleared by hand) plays an example of hand moves (apps/shaper/src/sim-scribble.js) before its wall pass. On the Shaper node page
// (tests/helpers/node-app.js), a pocket with an island drawn here:
//  1. the timeline: the pocket's element plays its scribble passes (role 'scribble', no direction) and then its wall and island travel; the label says it is an example.
//  2. INSIDE: every point of the scribble is inside the region the clearing's bit centre may go (the wall's bit-centre path minus the island's, kept the clearing's
//     margin in: the automatic offset; #core deriveCutFootprint stage 1).
//  3. COVERS: the bit's footprint along the scribble covers at least 97 % of that region's area (the stated tolerance: the wobble keeps a few slivers at the turns).
//  4. LOOKS HAND-MADE: more than one patch, passes along AND across, not straight lines (points off the pass's chord).
//  5. DETERMINISTIC: two builds of the timeline (two preview copies) give the same scribble, point for point.
//  6. 3D: each scribble pass carves the pocket progressively (relief items at its depth, at the pass's end); at the end of the run the wood is the finished part
//     (triangle for triangle, as without the scribble).
//  7. NO LEAK: the exported file is byte-identical before and after the simulation is built and played; the generated paths (op-paths.js) of the plan are unchanged; the
//     exporter, the derivation, the generated paths and Prepare never import the simulation modules.
import assert from 'node:assert';
import fs from 'node:fs';
import { open } from './helpers/node-app.js';
import SettingsManager from '#core/settings-manager.js';
import { findLoops } from '#core/loop-finder.js';
import { buildRelief, createReliefCache } from '#core/relief-model.js';
import { regionsFromRings, offsetRegions, intersectRegions, sweepPaths, regionsArea } from '#core/plot/clip.js';
import { V2_PLAN } from './helpers/plan-v2.js';
import { exportFileOf, bitCentrePaths, simElements } from '../apps/shaper/src/export-payload.js';
import { parseShaperSvg, previewItems } from '../apps/shaper/src/export-preview.js';
import { planReliefItems, planEntries, pathsCtx, entryPathsOf } from '../apps/shaper/src/cut-plan.js';
import { resolveStock } from '../apps/shaper/src/stock.js';
import { buildTimeline, labelAt, reliefSchedule, createPreviewSession, elementStateAt } from '../apps/shaper/src/cut-timeline.js';
import { SCRIBBLE, inRegions } from '../apps/shaper/src/sim-scribble.js';
import { cutTypeById } from '../apps/shaper/src/shaper.js';

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };
SettingsManager.set('DOC_UNIT', 'mm', { persist: false });
const DIA = 6.35, R = DIA / 2;

const app = await open({ host: 'shaper' });
const timelineOf = (st) => {
  const p = exportFileOf(st, { preview: true });
  const items = previewItems(parseShaperSvg(p.svg, app.document));
  const bitPaths = bitCentrePaths(st, p.written);
  return { p, items, tl: buildTimeline({ items, ops: p.ops, bitPaths, elements: simElements(st, p.written, bitPaths) }) };
};
try {
  const st = app.state;
  for (const k of [...st.joints.keys()]) st.joints.delete(k);
  st.shapes.length = 0; st.constraints.length = 0; st.profiles.length = 0;
  const poly = (n, pts) => { pts.forEach(([x, y], i) => st.joints.set(n + 'j' + i, { x, y })); pts.forEach((_, i) => st.shapes.push({ id: n + 's' + i, type: 'line', joints: [n + 'j' + i, n + 'j' + ((i + 1) % pts.length)] })); };
  poly('P', [[0, 0], [160, 0], [160, 90], [0, 90]]);            // the freehand pocket
  poly('I', [[60, 30], [85, 30], [85, 55], [60, 55]]);          // its island
  const loopOf = (p) => findLoops(st).find((l) => l.edges.every((e) => e.startsWith(p)));
  V2_PLAN.use(st).load([['loop:' + loopOf('P').id, { cutType: 'pocket', cutDepth: 5, cutOffset: 0, toolDia: DIA, cutterShape: 'endmill' }]]); // Freehand (no clearing)
  const svgBefore = exportFileOf(st).svg;
  const ctx = pathsCtx(st);
  const pathsBefore = JSON.stringify(planEntries().map((e) => entryPathsOf(e.target, e.rec, ctx)));

  // ── 1. the timeline ──
  const { items, tl } = timelineOf(st);
  const el = [...tl.elements.entries()].find(([i]) => items[i].cutType === 'pocket');
  ok(el, 'the freehand pocket is an element of the timeline');
  const [, E] = el;
  const steps = tl.steps.slice(E.first, E.last + 1);
  const scr = steps.filter((s) => s.role === 'scribble'), rest = steps.filter((s) => s.role !== 'scribble');
  ok(scr.length > 10, `its example hand moves are steps of their own (${scr.length} passes)`);
  eq(steps.slice(0, scr.length).map((s) => s.role), scr.map(() => 'scribble'), 'they play FIRST');
  eq(rest.map((s) => s.role).sort(), ['island', 'wall'], 'then its wall and island travel, as before');
  ok(scr.every((s) => s.direction === null && !s.closed), 'no direction (they are an example)');
  eq(labelAt(tl, scr[2].t0 + 1e-6), `Operation 1 of 1 · Pocket (${SCRIBBLE.words})`, 'the label says it is an example');
  eq(labelAt(tl, rest[0].t0 + 1e-6), 'Operation 1 of 1 · Pocket', 'the wall pass: the plain label');
  eq(elementStateAt(tl, el[0], scr[3].t0 + 1e-6), 'active', 'the pocket is being cut while they play');

  // ── 2. inside the region its bit centre may go ──
  const wall = rest.find((s) => s.role === 'wall').path, island = rest.find((s) => s.role === 'island').path;
  const margin = cutTypeById('pocket').autoOffsetFraction * DIA;
  const C = offsetRegions(regionsFromRings([wall.map((p) => [p.x, p.y]), island.map((p) => [p.x, p.y])], 'evenodd'), -margin);
  const pts = scr.flatMap((s) => s.path);
  ok(pts.length > 200, `${pts.length} points`);
  const outside = pts.filter((p) => !inRegions(C, p.x, p.y));
  eq(outside, [], 'every point of the scribble is inside the clearing\'s bit-centre region (the wall\'s minus the island\'s, the clearing margin in)');

  // ── 3. it covers the region ──
  const swept = sweepPaths(scr.map((s) => ({ points: s.path.map((p) => [p.x, p.y]), closed: false })), R);
  const cover = regionsArea(intersectRegions(C, swept)) / regionsArea(C);
  console.log(`coverage of the bit-centre region by the bit along the scribble: ${(cover * 100).toFixed(2)} %`);
  ok(cover >= 0.97, `the bit's footprint along the scribble covers >= 97 % of the region (${(cover * 100).toFixed(2)} %)`);

  // ── 4. it looks hand-made ──
  const dirs = scr.filter((s) => s.path.length > 4).map((s) => { const a = s.path[1], b = s.path[s.path.length - 2]; return Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) ? 'along' : 'across'; });
  ok(dirs.includes('along') && dirs.includes('across'), `patches in different directions (${dirs.filter((d) => d === 'along').length} along, ${dirs.filter((d) => d === 'across').length} across)`);
  const offChord = (path) => { const a = path[1], b = path[path.length - 1], L = Math.hypot(b.x - a.x, b.y - a.y) || 1; return Math.max(...path.slice(1).map((p) => Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / L)); };
  ok(scr.filter((s) => s.path.length > 6 && offChord(s.path) > 0.05 * DIA).length > scr.length / 2, 'most passes wobble off their straight line');

  // ── 5. deterministic ──
  const again = timelineOf(st).tl;
  eq(again.steps.filter((s) => s.role === 'scribble').map((s) => s.path), scr.map((s) => s.path), 'two builds: the same scribble, point for point');

  // ── 6. 3D ──
  const relief = planReliefItems(st, { ticked: true });
  const sched = reliefSchedule(tl, relief);
  const sItems = sched.filter((x) => x.item.scribble);
  eq(sItems.length, scr.length, 'one relief item per scribble pass');
  ok(sItems.every((x, i) => x.time === scr[i].t1 && x.item.cutDepth === relief[0].cutDepth), 'each carved at its pass\'s end, at the pocket\'s depth');
  const stock = resolveStock(st).stock;
  const half = buildRelief({ stock, items: sched.filter((x) => x.time <= scr[Math.floor(scr.length / 2)].t1).map((x) => x.item), cache: createReliefCache() });
  ok(half.stats.levels === 1 && half.stats.areas.floor > 0, 'half way through the scribble the pocket floor is partly cut');
  const full = buildRelief({ stock, items: relief, cache: createReliefCache() });
  ok(half.stats.areas.floor < full.stats.areas.floor * 0.9, `... less than the finished floor (${half.stats.areas.floor.toFixed(0)} < ${full.stats.areas.floor.toFixed(0)} mm²)`);
  const end = buildRelief({ stock, items: sched.map((x) => x.item), cache: createReliefCache() });
  eq([end.stats.triangles, end.stats.areas.floor.toFixed(6)], [full.stats.triangles, full.stats.areas.floor.toFixed(6)], 'at the end the wood is the finished part (triangles, floor area)');

  // ── 7. no leak ──
  const S = createPreviewSession({ animate: true });
  S.setTimeline((only) => buildTimeline({ items, ops: timelineOf(st).p.ops, bitPaths: bitCentrePaths(st, exportFileOf(st, { preview: true }).written), only }));
  S.previewAll([tl.ops[0].id]); S.advance(5); S.advance(1e6);
  eq(exportFileOf(st).svg, svgBefore, 'the exported file is byte-identical after the simulation was built and played');
  eq(JSON.stringify(planEntries().map((e) => entryPathsOf(e.target, e.rec, pathsCtx(st)))), pathsBefore, 'the generated paths are unchanged');
  for (const f of ['apps/shaper/src/op-derive.js', 'apps/shaper/src/op-paths.js', 'apps/shaper/src/export-payload.js', 'packages/core/shaper-export.js', 'apps/shaper/src/prepare-view.js', 'apps/shaper/src/cut-plan.js', 'packages/core/profile-model.js']) {
    const src = fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
    ok(!/^import[^;]*(sim-scribble|cut-timeline|export-sim)/m.test(src) && !/import\([^)]*(sim-scribble|cut-timeline|export-sim)/.test(src), `${f} does not import the simulation`);
  }
} finally {
  V2_PLAN.clear();
  app.close();
}
console.log(`export-sim-801d-node.test.js: ok (${checks} checks)`);
