// tests/cut-offset-types-node.test.js — TASK 583 (node port of tests/cut-offset-types.test.js, TASK 450 + 450b + 456): On line and Guide take NO offset in Shaper Origin's
// own rules, but Studio shows and writes all three params for both. Declared on CUT_TYPES (params); read by the cut card, the export and the preview.
//  A. the declaration, the export and the preview rule (pure)
//  B. the cut card in the app (Shaper's declared Prepare stage through tests/helpers/node-app.js): the param rows follow the declaration for On line / Guide /
//     Inside / Pocket / Outside.
import assert from 'node:assert';
import { exportShaperSVG } from '#core/shaper-export.js';
import { findLoops } from '#core/loop-finder.js';
import { worldToScreen } from '#ui/coords.js';
import { CUT_TYPES, cutTypeHasParam, effectiveCutRecord } from '../apps/shaper/src/shaper.js';
import { open } from './helpers/node-app.js';

// ── declaration + export + preview (pure) ──
const ALL3 = ['cutDepth', 'cutOffset', 'toolDia'];
const decl = Object.fromEntries(CUT_TYPES.map((t) => [t.id, t.params]));
assert.deepStrictEqual(decl, { exterior: ALL3, interior: ALL3, pocket: ALL3, online: ALL3, guide: ALL3, stock: ['cutDepth'] }, 'ONE params declaration per cut type (TASK 472: Stock has only the thickness row)');
assert.ok(cutTypeHasParam('exterior', 'cutOffset') && cutTypeHasParam('online', 'cutOffset') && cutTypeHasParam('online', 'toolDia') && cutTypeHasParam('guide', 'cutDepth') && cutTypeHasParam('guide', 'cutOffset') && cutTypeHasParam('guide', 'toolDia'), 'guide keeps all three (Studio allows it)');
assert.ok(cutTypeHasParam(null, 'cutOffset'), 'no type chosen yet: nothing hidden');
assert.deepStrictEqual(effectiveCutRecord({ cutType: 'guide', cutDepth: 5, cutOffset: 2, toolDia: 6 }), { cutType: 'guide', cutDepth: 5, cutOffset: 2, toolDia: 6, autoOffset: 0 }, 'a guide keeps its params (and has no automatic offset)');
assert.strictEqual(effectiveCutRecord({ cutType: 'online', cutOffset: 2, cutDepth: 5, toolDia: 6 }).cutOffset, 0, 'on line: the PREVIEW ignores the offset (offsetMovesCut:false, Studio keeps the band centred)');
assert.strictEqual(CUT_TYPES.find((t) => t.id === 'online').offsetMovesCut, false);
assert.deepStrictEqual(CUT_TYPES.filter((t) => t.offsetMovesCut === false).map((t) => t.id), ['online']);
assert.strictEqual(effectiveCutRecord({ cutType: 'online', cutOffset: 2, cutDepth: 5, toolDia: 6 }).toolDia, 6, 'on line keeps the bit');
assert.strictEqual(effectiveCutRecord({ cutType: 'exterior', cutOffset: 2, cutDepth: 5, toolDia: 6 }).cutOffset, 2, 'outside keeps its offset');
{
  const state = { joints: new Map([['a', { x: 0, y: 0 }], ['b', { x: 40, y: 0 }], ['c', { x: 40, y: 20 }], ['d', { x: 0, y: 20 }]]),
    shapes: [['s1', 'a', 'b'], ['s2', 'b', 'c'], ['s3', 'c', 'd'], ['s4', 'd', 'a']].map(([id, p, q]) => ({ id, type: 'line', joints: [p, q] })), constraints: [] };
  const loop = findLoops(state)[0];
  const exp = (cutType, extra = {}) => exportShaperSVG({ state, entries: [{ target: { kind: 'loop', id: loop.id }, rec: { cutType, cutDepth: 5, cutOffset: 1.5, toolDia: 3.175, ...extra } }], encoding: CUT_TYPES, docUnit: 'mm' });
  const attrs = (svg) => ['cutDepth', 'cutOffset', 'toolDia'].filter((k) => svg.includes('shaper:' + k));
  assert.deepStrictEqual(attrs(exp('guide')), ['cutDepth', 'cutOffset', 'toolDia'], 'Guide keeps and exports all three (the type may be changed on the tool later)');
  assert.deepStrictEqual(attrs(exp('online')), ['cutDepth', 'cutOffset', 'toolDia'], 'On line: all three (Studio shows and writes an offset on On Line)');
  assert.ok(exp('online').includes('shaper:cutOffset="1.500 mm"'), 'On line writes its offset');
  for (const t of ['exterior', 'interior', 'pocket']) assert.deepStrictEqual(attrs(exp(t)), ['cutDepth', 'cutOffset', 'toolDia'], t + ' writes all three');
}

// ── the cut card in the app: the param rows shown follow the params declaration, for every type ──
const app = await open({ host: 'shaper' });
try {
  const doc = app.document;
  const q = (sel) => doc.querySelector(sel);
  const pressEl = (sel) => { const e = q(sel); assert(e, sel + ' not found'); app.press(e); };
  pressEl('[data-mode="design"]');
  const st = app.state;
  for (const k of [...st.joints.keys()]) st.joints.delete(k);
  st.shapes.length = 0; st.constraints.length = 0;
  const J = (id, x, y) => st.joints.set(id, { x, y });
  J('a', 0, 0); J('b', 60, 0); J('c', 60, 40); J('d', 0, 40);
  [['s1', 'a', 'b'], ['s2', 'b', 'c'], ['s3', 'c', 'd'], ['s4', 'd', 'a']].forEach(([id, p, q2]) => st.shapes.push({ id, type: 'line', joints: [p, q2] }));
  pressEl('[data-mode="prepare"]');
  const pc = doc.getElementById('prepare-canvas');
  const inside = worldToScreen(pc, { x: 30, y: 20 });
  app.click(Math.round(inside.x), Math.round(inside.y), { target: pc }); // select the loop
  const rowsShown = () => [...doc.querySelectorAll('.cut-row[data-param]')].filter((r) => doc.defaultView.getComputedStyle(r).display !== 'none').map((r) => r.dataset.param);
  const shown = {};
  for (const [typeId, label] of [['online', 'On line'], ['guide', 'Guide'], ['interior', 'Inside'], ['pocket', 'Pocket'], ['exterior', 'Outside']]) {
    pressEl('.cut-type-trigger');
    assert(!q('.cut-type-menu').hidden, 'cut type menu open');
    pressEl(`.cut-type-opt[data-id="${typeId}"]`);
    assert(q('.cut-type-menu').hidden, 'cut type menu closed');
    shown[typeId] = rowsShown();
    console.log(`${label}: rows ${JSON.stringify(shown[typeId])}`);
  }
  assert.deepStrictEqual(shown, { online: ALL3, guide: ALL3, interior: ALL3, pocket: ALL3, exterior: ALL3 }, 'card rows follow the params declaration (Guide shows all three)');
  console.log('cut-offset-types-node: ok');
} finally {
  await app.close();
}
