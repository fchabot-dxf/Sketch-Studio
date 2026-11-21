// tests/fusion-replace-712-node.test.js — TASK 712 (owner ruling: "Replace"): in the Fusion palette a selection_data REPLACES the design
// (apps/shaper/src/fusion-import.js importFusionSelection, the ONE rule): the previous imported geometry, its sketches and its cut-plan records
// go, the new selection lands alone, in ONE undo step (Ctrl+Z gives the previous selection back with the cut type the user had set, Ctrl+Y the
// new one). A body + chains payload lands as one plan; an older pile-up (several sketches) is replaced whole; the normal Shaper Import SVG
// still adds a NEW sketch. Driven through the real bridge (createFusionBridge.handle) and the real Prepare cut card (a click, the type menu).
import assert from 'node:assert';
import { open } from './helpers/node-app.js';
import { worldToScreen } from '#ui/coords.js';
import { keyOf } from '../apps/shaper/src/cut-plan.js';
import { createFusionBridge, FUSION_ACTIONS } from '../apps/shaper/src/fusion-bridge.js';
import { importFusionSelection } from '../apps/shaper/src/fusion-import.js';
import { findLoops, findOpenChains } from '#core/loop-finder.js';
import { V2_PLAN } from './helpers/plan-v2.js'; // TASK S1: the test's v2 document of the plan, loaded through applyShaperDoc
import { getSelections } from '../apps/shaper/src/selection-list.js';
import { clickOpen } from './helpers/prepare-open.js'; // TASK S2: an operation is opened to edit it

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

const rectSegs = (x, y, w, h) => [
  { type: 'line', x1: x, y1: y, x2: x + w, y2: y },
  { type: 'line', x1: x + w, y1: y, x2: x + w, y2: y + h },
  { type: 'line', x1: x + w, y1: y + h, x2: x, y2: y + h },
  { type: 'line', x1: x, y1: y + h, x2: x, y2: y },
];
const msg = (name, regions, chains = [], extra = {}) => ({
  action: 'selection_data', version: 1, units: 'mm', coordSystem: { yAxis: 'up', frame: 'plane-2d' },
  source: { kind: extra.kind || 'sketch', name }, stock: extra.stock || null, regions, chains, warnings: [],
});
// FIRST: a 20 x 20 square at the origin (no cut type: a sketch selection). SECOND: a 30 x 10 plate far to the right with a d6 hole.
const FIRST = msg('FirstPart', [{ id: 'r1', cutType: null, depthMm: null, outer: { closed: true, segments: rectSegs(0, 0, 20, 20) }, holes: [] }]);
const SECOND = msg('Body1', [
  { id: 'o', label: 'Outline', cutType: 'outside', depthMm: 12, outer: { closed: true, segments: rectSegs(100, 0, 30, 10) },
    holes: [{ closed: true, segments: [{ type: 'circle', cx: 115, cy: 5, r: 3 }] }] },
  { id: 'h', label: 'Hole', cutType: 'inside', depthMm: 12, outer: { closed: true, segments: [{ type: 'circle', cx: 115, cy: 5, r: 3 }] }, holes: [] },
], [], { kind: 'body', stock: { thicknessMm: 12 } });

const sketchNames = (st) => st.sketches.map((s) => s.name);
const planTypes = () => [...V2_PLAN.entries()].map(([k, r]) => [k.split(':')[0], r.cutType]).sort();
const shapeIds = (st) => st.shapes.map((s) => s.id).sort();

// ── 1. Two selections in a row: only the second shows; ONE undo step; undo -> the first with its edited cut type; redo -> the second ──
{
  V2_PLAN.clear();
  const app = await open({ host: 'shaper' });
  try {
    const doc = app.document;
    const st = app.state;
    const q = (sel) => doc.querySelector(sel);
    const pressEl = (sel) => { const e = q(sel); assert(e, sel + ' not found'); app.press(e); };
    pressEl('.sk-header-tab[data-tab="prepare"]');
    const notices = [];
    const bridge = createFusionBridge({
      globalTarget: { adsk: { fusionSendData: () => {} } },
      onNotice: (t) => notices.push(t),
      onError: (t) => notices.push('ERROR ' + t),
      onSelectionData: (p) => importFusionSelection(p, { controller: app.controller, prepare: app.prepare }),
    });
    const pc = doc.getElementById('prepare-canvas');
    const clickRaw = (x, y) => { const p = worldToScreen(pc, { x, y }); app.click(Math.round(p.x), Math.round(p.y), { target: pc }); };
    const clickAt = (x, y) => clickOpen(app, () => clickRaw(x, y)); // TASK S2: OK the open operation, click, open the clicked shape's operation (tests/helpers/prepare-open.js)

    bridge.handle(FUSION_ACTIONS.SELECTION_DATA, JSON.stringify(FIRST));
    eq(notices.at(-1), 'Added FirstPart: 1 regions, 0 chains', 'a first selection into an empty palette says Added');
    eq(sketchNames(st), ['Sketch 1', 'FirstPart'], 'the first selection lands in its own sketch');
    eq(st.shapes.length, 4, 'the first selection: 4 lines');
    const firstShapes = shapeIds(st);
    const firstKey = getSelections().at(-1).cutKeys[0];
    eq(V2_PLAN.size, 0, 'the first selection: its region has no cut type, so it is in no operation (TASK S1; it was a record without a cut type)');

    // the user sets the cut type on the first selection in Prepare (a click on the square, then Pocket: TASK S3, the operations toolbar)
    clickAt(10, -10);
    pressEl('#op-type-pocket'); // TASK S3: the operations toolbar's button (the quick flow: a NEW operation, open)
    eq(V2_PLAN.get(firstKey).cutType, 'pocket', 'the user set Pocket on the first selection');

    const histBefore = st.history.length;
    bridge.handle(FUSION_ACTIONS.SELECTION_DATA, JSON.stringify(SECOND));
    console.log('after the second selection:', JSON.stringify({ notice: notices.at(-1), sketches: sketchNames(st), shapes: st.shapes.length, plan: planTypes() }));
    eq(notices.at(-1), 'Replaced with Body1: 2 regions, 0 chains', 'the notice says the design was replaced');
    eq(sketchNames(st), ['Sketch 1', 'Body1'], 'only the new selection\'s sketch (the first one\'s sketch is gone)');
    eq(st.shapes.length, 5, 'only the new selection\'s shapes: 4 lines + 1 circle');
    ok(!firstShapes.some((id) => st.shapes.some((s) => s.id === id)), 'no shape of the first selection is left');
    eq([...st.joints.keys()].filter((id) => st.shapes.every((s) => !(s.joints || []).includes(id))), ['j_origin'], 'no joint of the first selection is left (only the origin is unused)');
    eq(V2_PLAN.size, 2, 'only the new selection\'s cut-plan records');
    ok(!V2_PLAN.has(firstKey), 'the first selection\'s cut record is gone');
    eq(planTypes(), [['loop', 'exterior'], ['loop', 'interior']], 'the new plan: outline exterior + hole interior');
    eq(st.history.length, histBefore + 1, 'the replace is ONE undo step');
    const secondShapes = shapeIds(st);
    const secondPlan = planTypes();
    eq(app.prepare.view().resolveTarget({ x: 10, y: -10 }), null, 'Prepare: nothing to pick where the first square was');
    ok(app.prepare.view().resolveTarget({ x: 105, y: -5 }), 'Prepare: the new outline is pickable');

    app.key('z', { ctrl: true });
    eq(sketchNames(st), ['Sketch 1', 'FirstPart'], 'Ctrl+Z: the first selection\'s sketch is back');
    eq(shapeIds(st), firstShapes, 'Ctrl+Z: the first selection\'s shapes are back');
    eq(V2_PLAN.size, 1, 'Ctrl+Z: the first selection\'s plan is back');
    eq(V2_PLAN.get(firstKey) && V2_PLAN.get(firstKey).cutType, 'pocket', 'Ctrl+Z: with the cut type the user had set (Pocket)');

    app.key('y', { ctrl: true });
    eq(sketchNames(st), ['Sketch 1', 'Body1'], 'Ctrl+Y: the new selection again');
    eq(shapeIds(st), secondShapes, 'Ctrl+Y: the new selection\'s shapes');
    eq(planTypes(), secondPlan, 'Ctrl+Y: the new selection\'s plan');
  } finally {
    await app.close();
  }
}

// ── 2. ONE payload carrying a body's regions AND sketch chains lands as ONE plan (combining = one selection) ──
{
  V2_PLAN.clear();
  const app = await open({ host: 'shaper' });
  try {
    app.modes.showMode('prepare');
    const st = app.state;
    const combined = msg('Body1 + lines', [
      { id: 'o', cutType: 'outside', depthMm: 18, outer: { closed: true, segments: rectSegs(0, 0, 60, 40) },
        holes: [{ closed: true, segments: [{ type: 'circle', cx: 30, cy: 20, r: 5 }] }] },
      { id: 'h', cutType: 'inside', depthMm: 18, outer: { closed: true, segments: [{ type: 'circle', cx: 30, cy: 20, r: 5 }] }, holes: [] },
    ], [
      { id: 'c0', cutType: null, depthMm: null, closed: false, segments: [{ type: 'line', x1: 70, y1: 0, x2: 90, y2: 20 }, { type: 'line', x1: 90, y1: 20, x2: 110, y2: 0 }] },
      { id: 'c1', cutType: null, depthMm: null, closed: false, segments: [{ type: 'line', x1: 0, y1: 50, x2: 60, y2: 50, construction: true }] },
    ], { kind: 'body', stock: { thicknessMm: 18 } });
    importFusionSelection(FIRST, { controller: app.controller, prepare: app.prepare }); // something already in the palette
    const res = importFusionSelection(combined, { controller: app.controller, prepare: app.prepare });
    console.log('combined:', JSON.stringify({ message: res.message, sketches: sketchNames(st), shapes: st.shapes.length, plan: planTypes() }));
    eq(res.message, 'Replaced with Body1 + lines: 2 regions, 2 chains', 'the combined notice counts the regions and the chains');
    eq(sketchNames(st), ['Sketch 1', 'Body1 + lines'], 'the combined selection is ONE sketch');
    eq(st.shapes.length, 8, '4 outline lines + 1 circle + 2 chain lines + 1 construction line');
    eq(planTypes(), [['loop', 'exterior'], ['loop', 'interior']], 'ONE plan: the body\'s outline + hole (TASK S1: the open chain has no cut type: in no operation)');
    eq(getSelections().at(-1).cutKeys.map((k) => k.split(':')[0]).sort(), ['chain', 'loop', 'loop'], 'the selection names the outline, the hole AND the open chain');
    const loops = findLoops(st);
    eq(findOpenChains(st, loops).length, 1, 'the open chain is one cuttable path');
    ok(getSelections().at(-1).cutKeys.includes(keyOf('chain', findOpenChains(st, loops)[0].id)), 'the chain is in the same selection (TASK S1: no cut type: in no operation)');
  } finally {
    await app.close();
  }
}

// ── 3. An older pile-up (several sketches, made by imports before this change) is replaced whole, not added to; undo gives it back ──
{
  V2_PLAN.clear();
  const app = await open({ host: 'shaper' });
  try {
    const st = app.state;
    const RECT = '<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="100mm" viewBox="0 0 100 100"><rect x="10" y="10" width="30" height="20" fill="none" stroke="#000"/></svg>';
    app.importFile(RECT, 'old-a.svg');
    app.importFile(RECT.replace('x="10"', 'x="50"'), 'old-b.svg');
    const pile = { sketches: sketchNames(st), shapes: shapeIds(st) };
    console.log('pile-up before:', JSON.stringify({ sketches: pile.sketches, shapes: pile.shapes.length }));
    eq([pile.sketches, pile.shapes.length], [['Sketch 1', 'old-a', 'old-b'], 8], 'a pile-up of several imports (several sketches) is in the design');
    app.modes.showMode('prepare');
    const res = importFusionSelection(SECOND, { controller: app.controller, prepare: app.prepare });
    eq(res.message, 'Replaced with Body1: 2 regions, 0 chains', 'the pile-up is replaced');
    eq(sketchNames(st), ['Sketch 1', 'Body1'], 'after: only the new selection');
    eq(st.shapes.length, 5, 'after: only its 5 shapes');
    st.undo();
    eq({ sketches: sketchNames(st), shapes: shapeIds(st) }, pile, 'undo: the whole pile-up is back as it was');
  } finally {
    await app.close();
  }
}

// ── 4. The normal Shaper app's Import SVG still ADDS a new sketch each time (unchanged) ──
{
  V2_PLAN.clear();
  const app = await open({ host: 'shaper' });
  try {
    const st = app.state;
    const RECT = '<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="100mm" viewBox="0 0 100 100"><rect x="10" y="10" width="30" height="20" fill="none" stroke="#000"/></svg>';
    app.importFile(RECT, 'part-a.svg');
    const afterA = st.shapes.length;
    app.importFile(RECT.replace('x="10"', 'x="50"'), 'part-b.svg');
    eq(sketchNames(st), ['Sketch 1', 'part-a', 'part-b'], 'Import SVG: each file is a NEW sketch, the earlier one kept');
    eq(st.shapes.length, afterA + 4, 'Import SVG: the earlier file\'s shapes are kept');
  } finally {
    await app.close();
  }
}

// ── 5. A selection with nothing importable leaves the design as it is (its notice wording is unchanged from before TASK 712) ──
{
  V2_PLAN.clear();
  const app = await open({ host: 'shaper' });
  try {
    const st = app.state;
    importFusionSelection(FIRST, { controller: app.controller, prepare: app.prepare });
    const before = { sketches: sketchNames(st), shapes: shapeIds(st), plan: planTypes(), hist: st.history.length };
    const res = importFusionSelection(msg('Empty', [], []), { controller: app.controller, prepare: app.prepare });
    eq(res.message, 'Added Empty: 0 regions, 0 chains', 'the notice for an empty selection (unchanged wording)');
    eq({ sketches: sketchNames(st), shapes: shapeIds(st), plan: planTypes(), hist: st.history.length }, before, 'an empty selection changes nothing');
  } finally {
    await app.close();
  }
}

console.log(`fusion-replace-712-node: ${checks} checks passed`);
