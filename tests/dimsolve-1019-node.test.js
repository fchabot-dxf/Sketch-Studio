// tests/dimsolve-1019-node.test.js — TASK 1019 guarding tests (Node, the real Design tab through tests/helpers/node-app.js).
//   R1-04 (docs/DESIGN-RUN-AUDIT-1016.md): a 2nd orthogonal point-point dimension (vertical after horizontal on the same pair; vertical from
//     another corner after an aligned one) is born DRIVING while the point can still move (Fusion: bracket.json 'hole x' + 'hole y'). The
//     Dimension tool's legacy "both joints fixed" sandbox (it counted the new dimension itself and tested an ALIGNED distance at the H/V value)
//     demoted it; only the one rank test (isDimensionDetermined, at the value box) decides now.
//   R2-02 (docs/DESIGN-RUN-AUDIT-1017.md): a reference dimension beside an edge's driving one survives Undo + Redo and save + reload
//     (hasConstraint took the reference for a duplicate of the driving one).
//   R1-01 control (no fillets): a point-to-line distance from a sized circle's centre to an axis and to a fixed edge moves the circle.
import assert from 'node:assert/strict';
import { open, createProfile, createNamedDesign } from './helpers/node-app.js';
import SettingsManager from '#core/settings-manager.js';
import { resetDimensionState } from '#ui/input-handlers/dimension-tool.js';
import { serializeDocument, deserializeDocument } from '#core/document.js';
import { isPointLineDistance } from '#core/geometry.js';

SettingsManager.set('GRID_MAGNETISM', 0.001, { persist: 'none' });

const realLog = console.log, realWarn = console.warn;
async function quiet(fn) { console.log = () => {}; console.warn = () => {}; try { return await fn(); } finally { console.log = realLog; console.warn = realWarn; } }

function makeDoc(joints, shapes, constraints = []) {
  return {
    version: 3, hosts: {},
    geometry: {
      joints: [
        ['j_origin', { x: 0, y: 0, fixed: true, sketchId: 'sketch-1' }],
        ...Object.entries(joints).map(([id, [x, y, fixed]]) => [id, { x, y, fixed: !!fixed, sketchId: 'sketch-1' }]),
      ],
      shapes: shapes.map((s) => ({ sketchId: 'sketch-1', isConstruction: false, ...s })),
      constraints, parameters: [],
      sketches: [{ id: 'sketch-1', name: 'Sketch 1', visible: true }],
      activeSketchId: 'sketch-1', groups: [], profiles: [],
    },
  };
}

let app = null;
async function openDesign(doc, { centre = { x: 40, y: -25 }, w = 140 } = {}) {
  if (app) { await quiet(() => app.close()); app = null; }
  const profile = await createProfile();
  await quiet(async () => {
    await createNamedDesign(profile, 'sketchstudio', 'Dimsolve 1019', doc);
    app = await open({ host: 'sketchstudio', profile, width: 1600, height: 900 });
  });
  app.tool('select');
  resetDimensionState(app.state);
  const r = app.svg.getBoundingClientRect();
  Object.assign(app.state.view, { x: centre.x, y: centre.y, w });
  app.state.view.h = app.state.view.w / (r.width / r.height);
  app.svg.setAttribute('viewBox', `${app.state.view.x - app.state.view.w / 2} ${app.state.view.y - app.state.view.h / 2} ${app.state.view.w} ${app.state.view.h}`);
  app.frames();
  return app;
}
// a click as the browser sends it: the pointer travels to the point, then press + release
async function clickW(x, y) {
  const p = app.toScreen(x, y);
  await quiet(() => { app.move(p.x, p.y); app.down(p.x, p.y); app.up(p.x, p.y); });
  app.frames();
}
async function moveW(x, y) { const p = app.toScreen(x, y); await quiet(() => app.move(p.x, p.y)); app.frames(); }
async function typeEnter(text) { await quiet(() => { app.type(text); app.enter(); }); app.frames(); }
const boxOpen = () => { const el = app.document.getElementById('dimInput'); return !!el && !el.classList.contains('hidden'); };
const dists = () => app.state.constraints.filter((c) => c && c.type === 'distance');
const pointPair = (a, b) => dists().filter((c) => c.joints && c.joints.length === 2 && c.joints.includes(a) && c.joints.includes(b));
const driven = (c) => !!(c.isDriven || c.driven);
const P = (id) => app.state.joints.get(id);

let failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`PASS ${name}`); } catch (err) { failed++; console.error(`FAIL ${name}: ${err.message}`); }
}

// A Ø6 hole (centre h at 13,-12, its diameter dimensioned) and a fixed corner k at (50,-30).
const holeDoc = (extra = []) => makeDoc(
  { h: [13, -12], k: [50, -30, true], m: [80, -30, true] },
  [{ id: 'C', type: 'circle', joints: ['h'], radius: 3 }],
  [{ type: 'distance', shape: 'C', value: 6, isRadius: true, isDiameter: true, name: 'd1' }, ...extra],
);

await test('R1-04a: vertical origin->hole after a horizontal one on the same pair is born DRIVING and takes a typed value', async () => {
  await openDesign(holeDoc([{ type: 'distance', joints: ['j_origin', 'h'], value: 13, dimMode: 'horizontal', name: 'd2' }]));
  app.tool('dim');
  await clickW(0, 0);
  await clickW(13, -12);
  for (const x of [16, 19, 22]) await moveW(x, -6);        // pulled sideways: a VERTICAL dimension
  await clickW(22, -6);
  const v = pointPair('j_origin', 'h').find((c) => c.dimMode === 'vertical');
  assert.ok(v, 'a vertical dimension origin -> hole exists');
  assert.equal(driven(v), false, 'born driving (Y is still free)');
  assert.ok(boxOpen(), 'its value box opened');
  await typeEnter('10');
  assert.ok(Math.abs(P('h').y + 10) < 1e-6 && Math.abs(P('h').x - 13) < 1e-6, `hole moved to (13,-10): ${JSON.stringify(P('h'))}`);
});

await test('R1-04b: vertical from another fixed corner after an aligned one is born DRIVING', async () => {
  await openDesign(holeDoc([{ type: 'distance', joints: ['m', 'h'], value: Math.hypot(67, 18), dimMode: 'aligned', name: 'd2' }]));
  app.tool('dim');
  await clickW(50, -30);
  await clickW(13, -12);
  for (const x of [8, 4, 0]) await moveW(x, -20);
  await clickW(0, -20);
  const v = pointPair('k', 'h').find((c) => c.dimMode === 'vertical');
  assert.ok(v, 'a vertical dimension corner -> hole exists');
  assert.equal(driven(v), false, 'born driving (the hole can still move)');
  assert.ok(boxOpen(), 'its value box opened');
});

await test('R1-04c: a dimension the sketch already determines is still born a reference (the rank test)', async () => {
  await openDesign(holeDoc([
    { type: 'distance', joints: ['j_origin', 'h'], value: 13, dimMode: 'horizontal', name: 'd2' },
    { type: 'distance', joints: ['j_origin', 'h'], value: 12, dimMode: 'vertical', name: 'd3' },
  ]));
  app.tool('dim');
  await clickW(50, -30);
  await clickW(13, -12);
  for (const x of [8, 4, 0]) await moveW(x, -20);
  await clickW(0, -20);
  const v = pointPair('k', 'h').find((c) => c.dimMode === 'vertical');
  assert.ok(v, 'a vertical dimension corner -> hole exists');
  assert.equal(driven(v), true, 'the hole is fully placed: a reference');
  assert.equal(boxOpen(), false, 'no value box for a reference');
});

// a line from the origin, its length dimensioned 80 with the Dimension tool, then a second length dimension on it: the reference (80)
// (docs/DESIGN-RUN-AUDIT-1017.md E-01)
async function lineWithReference() {
  await openDesign(makeDoc({ b: [70, 0] }, [{ id: 'L', type: 'line', joints: ['j_origin', 'b'] }]), { centre: { x: 40, y: -20 }, w: 140 });
  app.tool('dim');
  await clickW(35, 0);
  await moveW(35, -18);
  await clickW(35, -18);
  await typeEnter('80');
  await clickW(40, 0);
  await moveW(40, -30);
  await clickW(40, -34);
  await quiet(() => app.esc()); app.frames();
  const pair = pointPair('j_origin', 'b');
  assert.equal(pair.length, 2, 'two length dimensions on the line');
  assert.deepEqual(pair.map(driven).sort(), [false, true], 'one driving, one reference');
}
const pairShape = () => pointPair('j_origin', 'b').map((c) => `${driven(c) ? 'ref' : 'drv'}:${(c.dimMode || 'aligned')}:${c.value.toFixed(3)}`).sort();

await test('R2-02a: Undo then Redo keeps the reference dimension', async () => {
  await lineWithReference();
  const before = pairShape();
  await quiet(() => app.undo()); app.frames();
  assert.equal(pointPair('j_origin', 'b').length, 1, 'undo takes the reference away');
  await quiet(() => app.redo()); app.frames();
  assert.deepEqual(pairShape(), before, 'redo brings it back exactly');
});

await test('R2-02b: Undo of a later step keeps the reference dimension', async () => {
  await lineWithReference();
  const before = pairShape();
  app.tool('line');
  await clickW(0, -10); await clickW(0, -40); await quiet(() => app.esc()); app.frames();
  await quiet(() => app.undo()); app.frames();
  assert.deepEqual(pairShape(), before, 'the snapshot it restores holds both dimensions');
});

await test('R2-02c: save + reload keeps the reference dimension', async () => {
  await lineWithReference();
  const before = pairShape();
  const doc = JSON.parse(JSON.stringify(serializeDocument(app.state)));
  const res = deserializeDocument(doc, app.state);
  assert.ok(res.ok, 'the document loads');
  assert.deepEqual(pairShape(), before, 'the loaded drawing holds both dimensions');
});

// E-01b: a SECOND reference length on the same line (the probe's third dimension): undo + redo and save + reload bring all three back
await test('R2-02d: a second reference on the same edge survives Undo + Redo and save + reload', async () => {
  await lineWithReference();
  app.tool('dim');
  await clickW(40, 0);
  await moveW(40, -44);
  await clickW(40, -48);
  await quiet(() => app.esc()); app.frames();
  const before = pairShape();
  assert.equal(before.length, 3, 'three length dimensions: ' + before.join(' '));
  await quiet(() => app.undo()); app.frames();
  await quiet(() => app.redo()); app.frames();
  assert.deepEqual(pairShape(), before, 'redo brings all three back');
  const doc = JSON.parse(JSON.stringify(serializeDocument(app.state)));
  assert.ok(deserializeDocument(doc, app.state).ok, 'the document loads');
  assert.deepEqual(pairShape(), before, 'the loaded drawing holds all three');
});

// BEHAVIOUR CHANGE (task 1019, R2-02): loading a file no longer drops a constraint as a duplicate. A file holding two DRIVING distances on the
// same pair loads both (before: the second was silently dropped, its value lost); the sketch shows what it holds, with no crash: equal values
// solve, different values are a conflict drawn in the error colour on the line.
await test('R2-02 behaviour change: a file with a duplicate driving distance loads both and shows it honestly', async () => {
  const dup = (v2) => makeDoc({ b: [80, 0] }, [{ id: 'L', type: 'line', joints: ['j_origin', 'b'] }],
    [{ type: 'distance', joints: ['j_origin', 'b'], value: 80, name: 'd1' }, { type: 'distance', joints: ['j_origin', 'b'], value: v2, name: 'd2' }]);
  const lineStroke = () => app.svg.querySelector('[data-shape-id="L"]').getAttribute('style');
  await openDesign(dup(80), { centre: { x: 40, y: -20 }, w: 140 });
  assert.deepEqual(pointPair('j_origin', 'b').map((c) => `${c.name}=${c.value}${driven(c) ? ' ref' : ''}`), ['d1=80', 'd2=80'], 'both loaded');
  const same = app.state.engine.solve(500);
  assert.equal(same.converged, true, 'equal duplicates solve');
  assert.ok(!/sk-error/.test(lineStroke()), 'no conflict colour: ' + lineStroke());
  await openDesign(dup(90), { centre: { x: 40, y: -20 }, w: 140 });
  assert.deepEqual(pointPair('j_origin', 'b').map((c) => `${c.name}=${c.value}`), ['d1=80', 'd2=90'], 'both loaded, the 90 is not lost');
  const clash = app.state.engine.solve(500);
  assert.equal(clash.converged, false, 'different duplicates cannot both hold');
  assert.deepEqual((clash.conflicts || []).map((k) => k.value).sort(), [80, 90], 'the solve names both as the conflict');
  app.frames();
  assert.ok(/sk-error/.test(lineStroke()), 'the line is drawn in the conflict colour: ' + lineStroke());
});

// R1-01 control: a rectangle with no fillets (corners a b c e, fixed), the Ø6 hole; the hole's centre is dimensioned to the X axis and
// to the rectangle's left edge, each typed: the hole moves, the rectangle stays
await test('R1-01 control (no fillets): circle centre -> X axis and -> fixed edge move the circle', async () => {
  await openDesign(makeDoc(
    { h: [13, -12], b: [80, 0, true], c: [80, -50, true], e: [0, -50, true] },
    [{ id: 'B', type: 'line', joints: ['j_origin', 'b'] }, { id: 'R', type: 'line', joints: ['b', 'c'] }, { id: 'T', type: 'line', joints: ['c', 'e'] },
      { id: 'Lf', type: 'line', joints: ['e', 'j_origin'] }, { id: 'C', type: 'circle', joints: ['h'], radius: 3 }],
    [{ type: 'distance', shape: 'C', value: 6, isRadius: true, isDiameter: true, name: 'd1' }]));
  app.tool('dim');
  await clickW(13, -12); await clickW(-10, 0); await moveW(25, -6); await clickW(25, -6);
  assert.ok(dists().some((c) => isPointLineDistance(c) && c.joints[2] === 'j_ref_x' && !driven(c)), 'a driving distance hole -> X axis');
  assert.ok(boxOpen(), 'its value box opened');
  await typeEnter('10');
  assert.ok(Math.abs(P('h').y + 10) < 1e-6, `hole on y = -10: ${JSON.stringify(P('h'))}`);
  await clickW(13, -10); await clickW(0, -30); await moveW(6, -22); await clickW(6, -22);
  assert.ok(dists().some((c) => isPointLineDistance(c) && c.joints.includes('e') && !driven(c)), 'a driving distance hole -> left edge');
  await typeEnter('20');
  assert.ok(Math.abs(P('h').x - 20) < 1e-6 && Math.abs(P('h').y + 10) < 1e-6, `hole at (20,-10): ${JSON.stringify(P('h'))}`);
});

if (app) await quiet(() => app.close());
if (failed) { console.error(`dimsolve-1019: ${failed} failed`); process.exit(1); }
console.log('dimsolve-1019 OK');
