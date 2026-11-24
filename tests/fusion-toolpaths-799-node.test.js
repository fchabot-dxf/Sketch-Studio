// tests/fusion-toolpaths-799-node.test.js — TASK 799 (SA-13): automatic Fusion toolpaths sync,
// decimation, real Z depths, all cut types (walls, clearing lines, start mark cross, tabs, online,
// roughing, contour), ticks only, debounce + spinner, older-addin tolerance, and 500k synthetic relief measure.
import assert from 'node:assert/strict';
import { open } from './helpers/node-app.js';
import { worldToScreen } from '#ui/coords.js';
import SettingsManager from '#core/settings-manager.js';
import { sliceStl } from '#core/stl-slice.js';
import { readLevels, STEP_DEPTH, LEVELS } from '#core/stepped-cut.js';
import { buildShapesFromPrimitives } from '#core/dxf-import.js';
import { waveRelief } from './fixtures/wave-relief.js';
import { loopsWithPolygons, deriveFootprints } from '../apps/shaper/src/op-derive.js';
import { defaultCutRecord, effectiveCutRecord } from '../apps/shaper/src/shaper.js';
import { createFusionBridge, FUSION_ACTIONS } from '../apps/shaper/src/fusion-bridge.js';
import {
  TOOLPATHS_DEBOUNCE_MS,
  TOOLPATH_DECIMATE_TOL_MM,
  decimateToolpathPoints,
  buildToolpathsPayload,
  createFusionToolpathsSync,
} from '../apps/shaper/src/fusion-toolpaths.js';
import { importFusionSelection } from '../apps/shaper/src/fusion-import.js';
import { getSelections } from '../apps/shaper/src/selection-list.js';
import { removeSelection, clearSelections } from '../apps/shaper/src/selection-edit.js';
import { storeOps, setOpsOn } from '../apps/shaper/src/operations-store.js';
import { setPathsPort, localPort } from '../apps/shaper/src/op-paths.js';
import { clickOpen } from './helpers/prepare-open.js';

let checks = 0;
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };
const near = (a, b, tol, m) => { assert.ok(Math.abs(a - b) <= tol, `${m}: ${a} vs ${b}`); checks++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

SettingsManager.set('DOC_UNIT', 'mm', { persist: false });

// ── 1. Pure decimation & Y-down -> Y-up mapping ──
{
  const collinear = Array.from({ length: 50 }, (_, i) => ({ x: i * 2, y: -10 }));
  const openDec = decimateToolpathPoints(collinear, false, TOOLPATH_DECIMATE_TOL_MM);
  eq(openDec, [[0, 10], [98, 10]], 'decimateToolpathPoints reduces collinear open line and negates Y to Y-up');

  const box = [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }, { x: 100, y: -60 }, { x: 0, y: -60 }, { x: 0, y: 0 }];
  const closedDec = decimateToolpathPoints(box, true, TOOLPATH_DECIMATE_TOL_MM);
  eq(closedDec, [[0, 0], [100, 0], [100, 60], [0, 60]], 'decimateToolpathPoints keeps closed loop corners and strips closing duplicate');
}

// ── 2. Full Shaper Prepare wiring with stubbed window.adsk.fusionSendData ──
setPathsPort(localPort({ async: false }));
const app = await open({ host: 'shaper' });
try {
  const st = app.state;
  const doc = app.document;
  const q = (s) => doc.querySelector(s);

  const sent = [];
  const spinStates = [];
  const fakeWindow = {
    adsk: {
      fusionSendData(action, data) {
        sent.push({ action, payload: JSON.parse(data) });
      },
    },
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
  };

  const errors = [];
  const bridge = createFusionBridge({
    globalTarget: fakeWindow,
    onError: (msg) => errors.push(msg),
  });
  const sync = createFusionToolpathsSync({
    bridge,
    getState: () => app.state,
    getOpenOpId: () => app.prepare.openId(),
    getSelections,
    onSpin: (busy) => spinStates.push(busy),
    debounceMs: 40,
    globalTarget: fakeWindow,
  });

  // Older add-in replying with Unknown action error for toolpaths / toolpaths_clear produces NO error notice.
  bridge.handle('error', JSON.stringify({ action: 'error', receivedAction: 'toolpaths', message: "Unknown action: 'toolpaths'" }));
  bridge.handle('error', JSON.stringify({ action: 'error', receivedAction: 'toolpaths_clear', message: "Unknown action: 'toolpaths_clear'" }));
  eq(errors, [], 'older add-in Unknown action error for toolpaths/toolpaths_clear is silently ignored');

  // Import a Fusion selection with Outline (outside 19mm), Pocket (pocket 8mm), Hole (inside 19mm), and an On-line chain (online 2mm) + frame at zTop=19mm.
  const rectSegs = (x0, y0, x1, y1) => [
    { type: 'line', x1: x0, y1: y0, x2: x1, y2: y0 },
    { type: 'line', x1: x1, y1: y0, x2: x1, y2: y1 },
    { type: 'line', x1: x1, y1: y1, x2: x0, y2: y1 },
    { type: 'line', x1: x0, y1: y1, x2: x0, y2: y0 },
  ];
  const frame = {
    units: 'mm',
    yAxis: 'up',
    originMm: [0, 0, 19],
    uAxis: [1, 0, 0],
    vAxis: [0, 1, 0],
    normal: [0, 0, 1],
    topHeightMm: 19,
  };
  const payload = {
    action: 'selection_data',
    version: 1,
    selectionId: 'sel-799-a',
    summary: { mode: 'Single Solid Body', items: [], text: 'Tray · top face' },
    units: 'mm',
    coordSystem: { yAxis: 'up', frame: 'plane-2d' },
    frame,
    source: { kind: 'face', name: 'Tray', documentName: 'TrayDoc' },
    stock: { thicknessMm: 19 },
    regions: [
      { id: 'reg_0', label: 'Outline', cutType: 'outside', depthMm: 19, through: true, outer: { closed: true, segments: rectSegs(0, 0, 120, 80) }, holes: [] },
      { id: 'reg_1', label: 'Pocket 1 (8mm)', cutType: 'pocket', depthMm: 8, through: false, outer: { closed: true, segments: rectSegs(15, 15, 75, 65) }, holes: [] },
      { id: 'reg_2', label: 'Through Hole 1', cutType: 'inside', depthMm: 19, through: true, outer: { closed: true, segments: [{ type: 'circle', cx: 98, cy: 40, r: 8 }] }, holes: [] },
    ],
    chains: [
      { id: 'chain_0', label: 'Chain 1', cutType: 'online', depthMm: 2, closed: false, segments: [{ type: 'line', x1: 90, y1: 10, x2: 110, y2: 10 }] },
    ],
    warnings: [],
  };

  app.modes.showMode('prepare');
  const res = importFusionSelection(payload, { controller: app.controller, prepare: app.prepare, file: true });
  ok(res.ok && res.imported > 0, 'selection imported');
  sync.notify();
  ok(spinStates[0] === true && sync.isPending(), 'spinner shown immediately before debounce');
  eq(sent.length, 0, 'nothing sent before debounce');
  await wait(80);
  eq(sent.length, 1, 'ONE toolpaths event sent after debounce');
  eq(sent[0].action, FUSION_ACTIONS.TOOLPATHS, 'sent action is toolpaths');
  eq(sent[0].payload.revision, 1, 'revision 1');
  eq(sent[0].payload.frame, frame, 'frame carried from selection_data');
  eq(spinStates.at(-1), false, 'spinner hidden after send');

  const ops = storeOps();
  ok(ops.length >= 4, '4 operations imported (online, pocket, interior, exterior)');
  const pocketOp = ops.find((o) => o.type === 'pocket');
  const outsideOp = ops.find((o) => o.type === 'exterior');
  const insideOp = ops.find((o) => o.type === 'interior');
  const onlineOp = ops.find((o) => o.type === 'online');
  ok(pocketOp && outsideOp && insideOp && onlineOp, 'all 4 operation types present');

  const p1 = sent[0].payload.paths;
  const pk1 = p1.filter((p) => p.op === pocketOp.id);
  ok(pk1.some((p) => p.cutType === 'pocket' && p.z === 8 && p.closed && p.toolDia === 3.175 && p.clearing === 'freehand' && p.role === 'wall'), 'freehand pocket wall carries toolDia, clearing=freehand, role=wall');
  ok(p1.some((p) => p.op === outsideOp.id && p.cutType === 'exterior' && p.z === 19 && p.closed && p.toolDia === 3.175 && p.clearing === undefined && p.role === 'outline'), 'exterior carries toolDia, no clearing, role=outline');
  ok(p1.some((p) => p.op === insideOp.id && p.cutType === 'interior' && p.z === 19 && p.closed && p.toolDia === 3.175 && p.clearing === undefined && p.role === 'outline'), 'interior hole carries toolDia, no clearing, role=outline');
  ok(p1.some((p) => p.op === onlineOp.id && p.cutType === 'online' && p.z === 2 && !p.closed && p.toolDia === 3.175 && p.clearing === undefined && p.role === 'outline'), 'online carries toolDia, no clearing, role=outline');

  const pressEl = (sel) => { const el = q(sel); assert.ok(el, sel + ' not found'); app.press(el); };
  const openOp = (id) => { pressEl(`#prepare-ops .ops-row[data-id="${id}"] .ops-pick`); pressEl(`#prepare-ops .ops-row[data-id="${id}"] .ops-edit`); };

  // Edit Pocket -> Spiral clearing + OK -> clearing lines + start mark cross sent!
  sent.length = 0;
  openOp(pocketOp.id);
  eq(app.prepare.openId(), pocketOp.id, 'pocket open for edit');
  pressEl('.cut-clear-trigger');
  pressEl('.cut-clear-opt[data-clearing="linked"]');
  // While open, no new toolpaths sent yet; press OK -> commits and generates!
  pressEl('.cut-ok');
  sync.notify();
  await wait(80);
  eq(sent.length, 1, 'edit + OK emits one toolpaths update');
  eq(sent[0].payload.revision, 2, 'revision 2');
  const p2 = sent[0].payload.paths;
  const pocketPaths = p2.filter((p) => p.op === pocketOp.id);
  ok(pocketPaths.some((p) => p.cutType === 'pocket' && p.z === 8 && p.clearing === 'linked' && p.role === 'clearing'), 'spiral clearing path carries clearing=linked and role=clearing');
  ok(pocketPaths.some((p) => p.cutType === 'pocket' && p.z === 8 && p.clearing === 'linked' && p.role === 'wall'), 'spiral finish wall carries clearing=linked and role=wall');
  ok(pocketPaths.filter((p) => p.cutType === 'guide' && !p.closed && p.points.length === 2 && p.clearing === 'linked' && p.role === 'start').length === 2, 'pocket start mark cross (2 open 2-pt strokes) carries clearing=linked and role=start');

  // Raster + Loop pocket -> role='loop' + clearing='raster'; V-bit pocket -> toolDia equals exported shaper:toolDia.
  {
    const { loops, loopPolys } = loopsWithPolygons(app.state);
    const targetLoop = loops.find((l) => l.edges.length === 4);
    const target = { kind: 'loop', id: targetLoop.id };
    const rasterLoopRec = effectiveCutRecord({ ...defaultCutRecord(), cutType: 'pocket', cutDepth: 8, toolDia: 6.35, clearing: 'raster', loop: true });
    const rlDerived = deriveFootprints(target, rasterLoopRec, app.state, loops, loopPolys, new Set());
    const rlRes = buildToolpathsPayload({
      items: [{ id: 'op-rl|loop:0', opId: 'op-rl', key: 'loop:0', rec: rasterLoopRec, derived: rlDerived }],
      derivedOf: (it) => it.derived,
      selections: [{ cutKeys: ['loop:0'], frame }],
    });
    ok(rlRes.paths.some((p) => p.clearing === 'raster' && p.role === 'loop' && p.toolDia === 6.35), 'raster+loop pocket emits clearing=raster, role=loop, toolDia=6.35');
    ok(rlRes.paths.some((p) => p.clearing === 'raster' && p.role === 'wall' && p.toolDia === 6.35), 'raster+loop native finish wall emits role=wall');
    ok(rlRes.paths.some((p) => p.clearing === 'raster' && p.role === 'start' && p.cutType === 'guide'), 'raster+loop start mark emits role=start');

    const vbitRec = effectiveCutRecord({ ...defaultCutRecord(), cutType: 'pocket', cutDepth: 5, toolDia: 6.35, cutterShape: 'vbit', cutterAngle: 90, clearing: 'freehand' });
    const vbDerived = deriveFootprints(target, vbitRec, app.state, loops, loopPolys, new Set());
    const vbRes = buildToolpathsPayload({
      items: [{ id: 'op-vb|loop:0', opId: 'op-vb', key: 'loop:0', rec: vbitRec, derived: vbDerived }],
      derivedOf: (it) => it.derived,
      selections: [{ cutKeys: ['loop:0'], frame }],
    });
    ok(vbRes.paths.every((p) => p.toolDia === vbDerived.rec.toolDia && p.clearing === 'freehand'), 'V-bit pocket sends exact exported toolDia and clearing=freehand');
  }

  // Edit Outside -> Tabs + OK -> pass depth + tab gap strips included!
  sent.length = 0;
  openOp(outsideOp.id);
  pressEl('.cut-hold-modes .cut-preset[data-value="tabs"]');
  pressEl('.cut-ok');
  sync.notify();
  await wait(80);
  eq(sent.length, 1, 'tabs edit + OK emits one toolpaths update');
  const outPaths = sent[0].payload.paths.filter((p) => p.op === outsideOp.id);
  ok(outPaths.some((p) => p.cutType === 'exterior' && p.z < 19 && p.z > 0), 'tabs pass at pass depth (< 19 mm)');
  ok(outPaths.some((p) => p.cutType === 'interior' && p.z === 19), 'tab gap strips at full depth (19 mm)');

  // Untick Pocket -> ONLY ticked operations emitted!
  sent.length = 0;
  pressEl(`#prepare-ops .ops-row[data-id="${pocketOp.id}"] .ops-tick`);
  sync.notify();
  await wait(80);
  eq(sent.length, 1, 'untick emits one toolpaths update');
  ok(!sent[0].payload.paths.some((p) => p.op === pocketOp.id), 'unticked pocket omitted from toolpaths');
  ok(sent[0].payload.paths.some((p) => p.op === outsideOp.id), 'ticked outside still included');

  // Undo -> Pocket comes back!
  sent.length = 0;
  app.undo();
  sync.notify();
  await wait(80);
  eq(sent.length, 1, 'undo emits one toolpaths update');
  ok(sent[0].payload.paths.some((p) => p.op === pocketOp.id), 'undo restores pocket toolpaths');

  // Redo -> Pocket unticked again!
  sent.length = 0;
  app.redo();
  sync.notify();
  await wait(80);
  eq(sent.length, 1, 'redo emits one toolpaths update');
  ok(!sent[0].payload.paths.some((p) => p.op === pocketOp.id), 'redo omits pocket again');

  // Clear all -> toolpaths_clear!
  sent.length = 0;
  clearSelections(app.controller, { prepare: app.prepare });
  sync.notify();
  await wait(80);
  eq(sent.length, 1, 'Clear all emits one event');
  eq(sent[0].action, FUSION_ACTIONS.TOOLPATHS_CLEAR, 'Clear all sends toolpaths_clear');

  eq(TOOLPATHS_DEBOUNCE_MS, 300, 'default debounce constant is 300 ms');
} finally {
  await app.close();
}

// ── 3. Large synthetic relief STL (~500k triangles, 90 x 120 mm, Roughing + Contour) benchmark ──
{
  const rawTris = waveRelief({ n: 497, size: 120 });
  for (let i = 1; i < rawTris.length; i += 3) rawTris[i] *= 0.75; // 120 x 90 mm
  const triCount = rawTris.length / 9;
  ok(triCount >= 499000, `synthetic wave relief has ~500k triangles (${triCount})`);

  const sliced = sliceStl(rawTris, { name: 'wave-500k.stl' });
  ok(sliced.ok, '500k wave relief sliced');
  const reg = sliced.payload.regions[0];
  const prims = reg.outer.segments.map((s) => ({ k: 'line', a: [s.x1, s.y1], b: [s.x2, s.y2], con: false }));
  let jn = 0;
  const built = buildShapesFromPrimitives(prims, { genJ: () => 'j' + (jn++), idPrefix: 'w', scale: 1, yUp: true });
  const st = { joints: new Map(built.joints.map((j) => [j.id, { x: j.x, y: j.y }])), shapes: built.shapes, profiles: [], constraints: [] };
  const { loops, loopPolys } = loopsWithPolygons(st);
  const target = { kind: 'loop', id: loops[0].id };
  const levels = readLevels(reg.levels, { scale: 1, yUp: true });
  const owned = new Set();

  const roughRec = effectiveCutRecord({ ...defaultCutRecord(), cutType: 'roughing', cutDepth: reg.depthMm, stepDepth: STEP_DEPTH.defaultMm, toolDia: 3.175, finishAllowance: 0, levels });
  const contourRec = effectiveCutRecord({ ...defaultCutRecord(), cutType: 'contour', cutDepth: reg.depthMm, baseDepth: reg.depthMm, stepDepth: LEVELS.contourStepMm, toolDia: 3.175, cutterShape: 'ballnose', levels });

  const roughDerived = deriveFootprints(target, roughRec, st, loops, loopPolys, owned);
  const contourDerived = deriveFootprints(target, contourRec, st, loops, loopPolys, owned);
  const items = [
    { id: 'op-1|loop:0', opId: 'op-1', key: 'loop:0', rec: roughRec, derived: roughDerived },
    { id: 'op-2|contour:loop:0', opId: 'op-2', key: 'loop:0', rec: contourRec, derived: contourDerived },
  ];
  const rawVerts = items.reduce((sum, it) => sum + it.derived.footprints.reduce((s2, fp) => s2 + (fp.toolPaths || []).reduce((s3, tp) => s3 + tp.points.length, 0), 0), 0);

  const t0 = performance.now();
  const res = buildToolpathsPayload({ items, derivedOf: (it) => it.derived, selections: [{ cutKeys: ['loop:0'], frame: { originMm: [0, 0, reg.depthMm], uAxis: [1, 0, 0], vAxis: [0, 1, 0], normal: [0, 0, 1], topHeightMm: reg.depthMm } }] });
  const jsonText = JSON.stringify({ action: 'toolpaths', revision: 1, ...res });
  const decMs = performance.now() - t0;
  const decVerts = res.paths.reduce((sum, p) => sum + p.points.length, 0);

  ok(res.paths.length > 50, `wave relief produced ${res.paths.length} paths`);
  ok(decVerts < rawVerts, `decimation reduced vertices ${rawVerts} -> ${decVerts}`);
  ok(res.paths.some((p) => p.cutType === 'roughing' && p.z > 0), 'roughing paths at real depths');
  ok(res.paths.some((p) => p.cutType === 'contour' && p.z > 0), 'contour paths at real depths');
  ok(decMs < 500, `decimation + JSON serialization fast (${decMs.toFixed(1)} ms)`);
  console.log(`500k wave relief: ${triCount} tris, ${res.paths.length} paths, verts ${rawVerts}->${decVerts}, JSON ${(jsonText.length / 1024).toFixed(1)} KB, ${decMs.toFixed(1)} ms`);
}

console.log(`fusion-toolpaths-799-node: ${checks} checks passed`);
