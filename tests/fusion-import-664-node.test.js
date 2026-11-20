// tests/fusion-import-664-node.test.js — TASK 664: node tests for apps/shaper/src/fusion-import.js + bridge notice + undo/redo + Prepare picking.
import assert from 'node:assert';
import { open } from './helpers/node-app.js';
import { importFusionSelection } from '../apps/shaper/src/fusion-import.js';
import { keyOf, getCutRecord } from '../apps/shaper/src/cut-plan.js';
import { getStock, setStock } from '../apps/shaper/src/stock.js';
import { DEFAULT_STOCK } from '#core/relief-model.js';
import { findLoops, findOpenChains } from '#core/loop-finder.js';
import { createFusionBridge, FUSION_ACTIONS } from '../apps/shaper/src/fusion-bridge.js';
import { V2_PLAN } from './helpers/plan-v2.js'; // TASK S1: the test's v2 document of the plan, loaded through applyShaperDoc
import { getSelections } from '../apps/shaper/src/selection-list.js';

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, m); checks++; };
const near = (a, b, tol, m) => { assert.ok(Math.abs(a - b) <= tol, `${m}: ${a} vs ${b}`); checks++; };

const rectSegs = (x, y, w, h) => [
  { type: 'line', x1: x, y1: y, x2: x + w, y2: y },
  { type: 'line', x1: x + w, y1: y, x2: x + w, y2: y + h },
  { type: 'line', x1: x + w, y1: y + h, x2: x, y2: y + h },
  { type: 'line', x1: x, y1: y + h, x2: x, y2: y },
];

// Real Fusion sketch message shape (40x30 rect, d10 circle hole + disk region, 1 open line, 1 construction line)
const realSketchMessage = {
  action: 'selection_data',
  version: 1,
  units: 'mm',
  coordSystem: { yAxis: 'up', frame: 'plane-2d' },
  source: { kind: 'sketch', name: 'Sketch1' },
  stock: { thicknessMm: null },
  regions: [
    {
      id: 'reg_0',
      label: 'Profile 1',
      cutType: null,
      depthMm: null,
      outer: { closed: true, segments: rectSegs(0, 0, 40, 30) },
      holes: [
        { closed: true, segments: [{ type: 'circle', cx: 20, cy: 15, r: 5 }] },
      ],
    },
    {
      id: 'reg_1',
      label: 'Profile 2',
      cutType: null,
      depthMm: null,
      outer: { closed: true, segments: [{ type: 'circle', cx: 20, cy: 15, r: 5 }] },
      holes: [],
    },
  ],
  chains: [
    {
      id: 'chain_0',
      label: 'Chain 1',
      cutType: null,
      depthMm: null,
      closed: false,
      segments: [{ type: 'line', x1: 50, y1: 0, x2: 70, y2: 10 }],
    },
    {
      id: 'chain_1',
      label: 'Chain 2',
      cutType: null,
      depthMm: null,
      closed: false,
      segments: [{ type: 'line', x1: 0, y1: 15, x2: 40, y2: 15, construction: true }],
    },
  ],
  warnings: [],
};

// ── 1. Real Fusion sketch message: 1 sketch, deduplicated circle, construction, V2_PLAN keys, BOTH loops selectable ──
{
  V2_PLAN.clear();
  setStock({ ...DEFAULT_STOCK });
  const app = await open({ host: 'shaper' });
  try {
    app.modes.showMode('prepare');

    const sketchesBefore = app.state.sketches.length;
    const res = importFusionSelection(realSketchMessage, { controller: app.controller, prepare: app.prepare });

    eq(res.ok, true, 'real sketch import succeeds');
    eq(res.message, 'Added Sketch1: 2 regions, 2 chains', 'notice message matches spec');
    eq(app.state.sketches.length, sketchesBefore + 1, 'exactly 1 new sketch created');
    eq(res.sketch.name, 'Sketch1', 'sketch named after source.name');
    eq(app.state.activeSketchId, res.sketch.id, 'new sketch is active');

    // 4 rect lines + 1 deduplicated circle + 1 open chain line + 1 construction line = 7 shapes (NOT 8)
    eq(app.state.shapes.length, 7, 'circle hole and disk share 1 circle shape (no duplicate curve)');
    const circles = app.state.shapes.filter((s) => s.type === 'circle');
    const lines = app.state.shapes.filter((s) => s.type === 'line');
    const constr = app.state.shapes.filter((s) => s.isConstruction);
    eq(circles.length, 1, 'exactly 1 circle emitted');
    eq(lines.length, 6, '6 line shapes emitted (4 rect + 1 open + 1 construction)');
    eq(constr.length, 1, 'exactly 1 construction line shape');

    // Y-up -> Y-down negation check on circle center (20, 15) -> (20, -15) and rect corner (40, 30) -> (40, -30)
    const cc = app.state.joints.get(circles[0].joints[0]);
    near(cc.x, 20, 1e-6, 'circle cx');
    near(cc.y, -15, 1e-6, 'circle cy negated Y-up -> Y-down');
    eq(circles[0].radius, 5, 'circle radius 5mm');

    // Shared corner joints on rectangle: 4 distinct corner joints (not 8)
    const rectLoops = findLoops(app.state);
    eq(rectLoops.length, 2, 'findLoops finds 2 closed loops (rect + circle)');
    const rectLoop = rectLoops.find((l) => l.edges.length === 4);
    const circleLoop = rectLoops.find((l) => l.edges.length === 1);
    ok(rectLoop && circleLoop, 'found both 4-edge rect loop and 1-edge circle loop');
    eq(circleLoop.edges[0], circles[0].id, 'disk loop references the single shared circle');
    eq(rectLoop.joints.length, 4, 'rect closed cleanly on 4 shared corner joints');

    // Construction line is excluded from loops & open chains (not a guide entry in V2_PLAN)
    const chains = findOpenChains(app.state, rectLoops);
    eq(chains.length, 1, 'findOpenChains returns only the non-construction open line chain');
    const openChain = chains[0];
    ok(!openChain.shapes.some((s) => s.isConstruction), 'open chain contains no construction shapes');

    // Cut plan keys & null/unset defaults
    const rectKey = keyOf('loop', rectLoop.id);
    const circleKey = keyOf('loop', circleLoop.id);
    const chainKey = keyOf('chain', openChain.id);
    // TASK S1: a sketch region has no cut type, so it is in no operation; the selection names its regions and Prepare's record of each is the default
    eq(JSON.stringify(getSelections().at(-1).cutKeys.slice().sort()), JSON.stringify([rectKey, circleKey, chainKey].sort()), 'the selection names the rect loop, the circle disk loop and the open chain (no construction line)');
    eq(V2_PLAN.size, 0, 'none of them is in an operation (no cut type)');
    eq(getCutRecord(rectKey).cutType, null, 'sketch region defaults cutType to null');
    eq(getCutRecord(rectKey).cutDepth, 'unset', 'sketch region defaults cutDepth to unset');

    // Both outer rectangle AND inner circle disk stay selectable in Prepare
    const pv = app.prepare.view();
    ok(pv, 'Prepare view mounted');
    const pickRect = pv.resolveTarget({ x: 5, y: -5 });
    const pickDisk = pv.resolveTarget({ x: 20, y: -15 });
    const pickChain = pv.resolveTarget({ x: 60, y: -5 });
    eq(pickRect && `${pickRect.kind}:${pickRect.id}`, rectKey, 'picking inside rect selects rect loop');
    eq(pickDisk && `${pickDisk.kind}:${pickDisk.id}`, circleKey, 'picking inside hole selects circle disk loop');
    eq(pickChain && `${pickChain.kind}:${pickChain.id}`, chainKey, 'picking open chain selects chain target');
  } finally {
    await app.close();
  }
}

// ── 2. Real arcs via arcShape (Y-up ccw -> sweep = !ccw) & bridge warnings[] notice ──
{
  V2_PLAN.clear();
  setStock({ ...DEFAULT_STOCK });
  const app = await open({ host: 'shaper' });
  try {
    app.modes.showMode('prepare');

    const notices = [];
    const bridge = createFusionBridge({
      globalTarget: { adsk: { fusionSendData: () => {} } },
      onNotice: (t) => notices.push(t),
      onSelectionData: (p) => importFusionSelection(p, { controller: app.controller, prepare: app.prepare }),
    });

    const arcPayload = {
      action: 'selection_data',
      version: 1,
      units: 'mm',
      coordSystem: { yAxis: 'up', frame: 'plane-2d' },
      source: { kind: 'sketch', name: 'ArcPlate' },
      regions: [
        {
          id: 'reg_arc',
          cutType: null,
          depthMm: null,
          outer: {
            closed: true,
            segments: [
              { type: 'line', x1: 0, y1: 0, x2: 10, y2: 0 },
              { type: 'arc', cx: 10, cy: 5, r: 5, x1: 10, y1: 0, x2: 10, y2: 10, ccw: true },
              { type: 'line', x1: 10, y1: 10, x2: 0, y2: 10 },
              { type: 'line', x1: 0, y1: 10, x2: 0, y2: 0 },
            ],
          },
          holes: [],
        },
      ],
      chains: [],
      warnings: ['1 spline flattened to lines'],
    };

    bridge.handle(FUSION_ACTIONS.SELECTION_DATA, JSON.stringify(arcPayload));
    eq(notices.at(-1), 'Added ArcPlate: 1 regions, 0 chains (1 spline flattened to lines)', 'bridge surfaces warnings in notice');

    const arcShape = app.state.shapes.find((s) => s.type === 'arc');
    ok(arcShape, 'real arc shape emitted (not flattened)');
    eq(arcShape.subType, 'CENTER', 'arc subType is CENTER');
    eq(arcShape.sweep, false, 'Y-up ccw:true becomes Y-down sweep:false');
    eq(findLoops(app.state).length, 1, 'arc + 3 lines form closed loop');
  } finally {
    await app.close();
  }
}

// ── 3. Body-style message: cutType mapping (outside/inside/pocket) + depthMm + island makeProfile + stock.thicknessMm ──
{
  V2_PLAN.clear();
  setStock({ ...DEFAULT_STOCK });
  const app = await open({ host: 'shaper' });
  try {
    app.modes.showMode('prepare');

    const bodyMsg = {
      action: 'selection_data',
      version: 1,
      units: 'mm',
      coordSystem: { yAxis: 'up', frame: 'plane-2d' },
      source: { kind: 'body', name: 'Bracket Body' },
      stock: { thicknessMm: 19.05 },
      regions: [
        {
          id: 'reg_pocket_island',
          label: 'Pocket Face',
          cutType: 'pocket',
          depthMm: 6.5,
          outer: { closed: true, segments: rectSegs(0, 0, 50, 40) },
          holes: [{ closed: true, segments: rectSegs(15, 10, 20, 20) }],
        },
        {
          id: 'reg_inside',
          label: 'Bolt Hole',
          cutType: 'inside',
          depthMm: 19.05,
          outer: { closed: true, segments: [{ type: 'circle', cx: 70, cy: 20, r: 4 }] },
          holes: [],
        },
        {
          id: 'reg_outside',
          label: 'Outer Profile',
          cutType: 'outside',
          depthMm: 19.05,
          outer: { closed: true, segments: rectSegs(90, 0, 30, 30) },
          holes: [],
        },
      ],
      chains: [],
      warnings: [],
    };

    const res = importFusionSelection(bodyMsg, { controller: app.controller, prepare: app.prepare });
    eq(res.ok, true, 'body import succeeds');
    eq(res.sketch.name, 'Bracket Body', 'sketch named after body source');
    eq(app.state.profiles.length, 1, 'pocket with non-standalone island creates 1 combined profile via makeProfile');

    const profKey = keyOf('profile', app.state.profiles[0].id);
    const profRec = V2_PLAN.get(profKey);
    ok(profRec, 'V2_PLAN has profile:<id> record');
    eq(profRec.cutType, 'pocket', 'pocket cutType mapped');
    eq(profRec.cutDepth, 6.5, 'pocket cutDepth set to 6.5mm');

    const entries = [...V2_PLAN.values()];
    ok(entries.some((r) => r.cutType === 'interior' && r.cutDepth === 19.05), 'inside mapped to interior with 19.05mm depth');
    ok(entries.some((r) => r.cutType === 'exterior' && r.cutDepth === 19.05), 'outside mapped to exterior with 19.05mm depth');
    near(getStock().thickness, 19.05, 1e-6, 'stock.thicknessMm updated via setStock');
  } finally {
    await app.close();
  }
}

// ── 4. Two Add selections -> TASK 712 (owner ruling "Replace"): the second REPLACES the first; ONE undo gives the first back (sketch + geometry + cut plan) ──
{
  V2_PLAN.clear();
  setStock({ ...DEFAULT_STOCK });
  const app = await open({ host: 'shaper' });
  try {
    app.modes.showMode('prepare');

    const msg1 = {
      action: 'selection_data',
      units: 'mm',
      coordSystem: { yAxis: 'up', frame: 'plane-2d' },
      source: { kind: 'sketch', name: 'FirstPart' },
      regions: [{ id: 'r1', cutType: 'outside', depthMm: 10, outer: { closed: true, segments: rectSegs(0, 0, 20, 20) }, holes: [] }],
      chains: [],
    };
    const msg2 = {
      action: 'selection_data',
      units: 'mm',
      coordSystem: { yAxis: 'up', frame: 'plane-2d' },
      source: { kind: 'sketch', name: 'SecondPart' },
      regions: [{ id: 'r2', cutType: 'pocket', depthMm: 4, outer: { closed: true, segments: rectSegs(40, 0, 25, 25) }, holes: [] }],
      chains: [],
    };

    const r1 = importFusionSelection(msg1, { controller: app.controller, prepare: app.prepare });
    const shapesAfterFirst = app.state.shapes.length;
    const sketchesAfterFirst = app.state.sketches.length;
    const planAfterFirst = V2_PLAN.size;

    const r2 = importFusionSelection(msg2, { controller: app.controller, prepare: app.prepare });
    eq(r1.sketch.name, 'FirstPart', 'first import made FirstPart');
    eq(r2.sketch.name, 'SecondPart', 'second import made SecondPart');
    eq(r2.message, 'Replaced with SecondPart: 1 regions, 0 chains', 'the second notice says Replaced');
    eq(app.state.sketches.map((s) => s.name).join('|'), 'Sketch 1|SecondPart', 'only SecondPart after the 2nd Add selection (FirstPart replaced)');
    eq(app.state.shapes.length, 4, 'only the second selection shapes');
    eq(V2_PLAN.size, 1, 'only the second selection cut plan entry');
    ok(!V2_PLAN.has(r1.cutKeys[0]) && V2_PLAN.has(r2.cutKeys[0]), 'FirstPart cut entry gone, SecondPart in V2_PLAN');

    // ONE undo gives FirstPart back (sketch, geometry, and cut plan entry)
    const histBeforeUndo = app.state.history.length;
    app.state.undo();
    eq(app.state.history.length, histBeforeUndo - 1, 'undo pops exactly one snapshot');
    eq(app.state.sketches.length, sketchesAfterFirst, 'one undo brought the FirstPart sketch back');
    eq(app.state.shapes.length, shapesAfterFirst, 'one undo brought the FirstPart shapes back');
    eq(V2_PLAN.size, planAfterFirst, 'one undo restored V2_PLAN to FirstPart only');
    ok(V2_PLAN.has(r1.cutKeys[0]) && !V2_PLAN.has(r2.cutKeys[0]), 'FirstPart cut entry back, SecondPart removed');
  } finally {
    await app.close();
  }
}

console.log(`fusion-import-664-node: ${checks} checks passed`);
