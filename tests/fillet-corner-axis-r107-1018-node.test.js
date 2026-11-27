// tests/fillet-corner-axis-r107-1018-node.test.js -- TASK 1018, audit R1-07 (and R1-01, R1-02, R1-03, the same cause, traced by task 1019).
// The 1016 Part A L-bracket (80 x 50 with a 30 x 20 notch, drawn from the origin; its corner (0, -50) snapped onto the Y axis: pointOnLine(corner,
// ref_axis_y)), all six corners filleted R 5 with the Fillet tool. The fillet deleted the corner joint but left that pointOnLine naming it (it
// relinked only constraints with a `joints` ARRAY): a dangling constraint that a reload pruned (R1-07), and whose NaN residual made the solver
// refuse every later edit that moves geometry: d1 80 -> 100 (R1-02), a hole's dimension 10 -> 15 (R1-03), a point-to-line dimension from a
// sized circle to the axis (R1-01), all "Can't set ... conflicts with distance". The fillet now relinks it to the corner's virtual sharp, as it
// does a measurement (the sharp corner stays on the axis; Fusion: unverified).
import assert from 'node:assert';
import { open, createProfile, createNamedDesign } from './helpers/node-app.js';
import { serializeDocument } from '#core/document.js';
import { previewDimensionInput } from '#core/parameters.js';
import { applyParameterChange } from '#core/dimension-seams.js';

const P = (x, y) => ({ x, y, fixed: false, sketchId: 'sketch-1' });
const line = (id, a, b) => ({ id, type: 'line', joints: [a, b], sketchId: 'sketch-1' });
const doc = {
  version: 3, hosts: {},
  geometry: {
    joints: [['j_origin', { x: 0, y: 0, fixed: true, sketchId: 'sketch-1' }], ['a1', P(80, 0)], ['b0', P(80, 0)], ['b1', P(80, -30)], ['c0', P(80, -30)], ['c1', P(50, -30)],
      ['d0', P(50, -30)], ['d1', P(50, -50)], ['e0', P(50, -50)], ['e1', P(0, -50)], ['f0', P(0, -50)], ['f1', P(0, 0)]],
    shapes: [line('L1', 'j_origin', 'a1'), line('L2', 'b0', 'b1'), line('L3', 'c0', 'c1'), line('L4', 'd0', 'd1'), line('L5', 'e0', 'e1'), line('L6', 'f0', 'f1')],
    constraints: [
      { type: 'distance', joints: ['j_origin', 'a1'], value: 80, offset: 30, name: 'd1' },
      { type: 'coincident', joints: ['a1', 'b0'] }, { type: 'vertical', joints: ['b0', 'b1'] }, { type: 'coincident', joints: ['b1', 'c0'] },
      { type: 'distance', joints: ['c0', 'c1'], value: 30, offset: 30, name: 'd2' }, { type: 'coincident', joints: ['c1', 'd0'] }, { type: 'vertical', joints: ['d0', 'd1'] },
      { type: 'coincident', joints: ['d1', 'e0'] }, { type: 'pointOnLine', joint: 'e1', shape: 'ref_axis_y' }, { type: 'horizontal', joints: ['e0', 'e1'] },
      { type: 'coincident', joints: ['e1', 'f0'] }, { type: 'coincident', joints: ['f1', 'j_origin'] }, { type: 'vertical', joints: ['f0', 'f1'] },
      { type: 'horizontal', joints: ['j_origin', 'a1'] }, { type: 'horizontal', joints: ['c0', 'c1'] },
      { type: 'distance', joints: ['d0', 'd1'], value: 20, offset: 10, dimMode: 'vertical', dimSign: -1, dimSignMode: 'vertical', name: 'd3' },
      { type: 'distance', joints: ['f0', 'f1'], value: 50, offset: -14, dimMode: 'vertical', dimSign: 1, dimSignMode: 'vertical', name: 'd4' },
    ],
    parameters: [], sketches: [{ id: 'sketch-1', name: 'Sketch 1', visible: true }], activeSketchId: 'sketch-1', groups: [], profiles: [],
  },
};

const profile = await createProfile();
await createNamedDesign(profile, 'sketchstudio', 'R1-07 L-bracket', doc);
let app = await open({ host: 'sketchstudio', profile });
const S = () => app.state;
const named = (n) => S().constraints.find((c) => c.name === n);
const edit = (c, text) => {
  const pv = previewDimensionInput(S(), c, text, { unit: 'mm' });
  assert.ok(pv.ok, `${c.name} -> ${text} previews (${pv.hint || ''})`);
  return applyParameterChange(S(), pv.plan, 'edit ' + c.name);
};
// every joint a constraint names exists (the scene's reference points too)
const dangling = () => S().constraints.filter((c) => [...(Array.isArray(c.joints) ? c.joints : []), ...(c.joint ? [c.joint] : [])]
  .some((j) => !S().joints.has(j) && !/^j_ref_/.test(j)));

try {
  // Fillet the six corners R 5 in one Fillet session (the tool, its radius box)
  app.tool('fillet');
  for (const [x, y] of [[0, 0], [80, 0], [80, -30], [50, -30], [50, -50], [0, -50]]) { const p = app.toScreen(x, y); app.click(p.x, p.y); }
  const box = app.document.getElementById('fillet-radius-input');
  assert.ok(box, 'the radius box is open');
  box.focus(); box.value = ''; app.type('5'); app.enter();
  app.tool('select');
  assert.strictEqual(S().shapes.filter((s) => s.type === 'arc').length, 6, 'six fillets');

  // R1-02 (the edits run on the live design, before any reload, as the user's did): the overall width 80 -> 100 on the filleted outline
  const r2 = edit(named('d1'), '100');
  assert.ok(r2.ok, `d1 80 -> 100 is accepted (got ${r2.reason || ''})`);
  assert.ok(Math.abs(named('d1').value - 100) < 1e-9 && S().shapes.filter((s) => s.type === 'arc').length === 6, 'd1 = 100, the six fillets kept');

  // R1-03: a hole placed by a horizontal dimension from the origin (and its height from the X axis), then moved 10 -> 15
  const hc = 'hole1c';
  S().joints.set(hc, { x: 10, y: -12, fixed: false, sketchId: 'sketch-1' });
  S().shapes.push({ id: 'hole1', type: 'circle', joints: [hc], radius: 3, sketchId: 'sketch-1' });
  S().constraints.push({ type: 'distance', shape: 'hole1', isRadius: true, isDiameter: true, value: 6, name: 'd20' },
    { type: 'distance', joints: ['j_origin', hc], value: 10, dimMode: 'horizontal', dimSign: 1, dimSignMode: 'horizontal', name: 'd21' },
    { type: 'distance', joints: [hc, 'j_origin', 'j_ref_x'], value: 12, name: 'd22' });
  S().engine.solve(200);
  const r3 = edit(named('d21'), '15');
  assert.ok(r3.ok, `the hole's d21 10 -> 15 is accepted (got ${r3.reason || ''})`);
  assert.ok(Math.abs(S().joints.get(hc).x - 15) < 1e-6, 'the hole moved to x = 15');

  // R1-01: a point-to-line dimension from a sized circle to the Y axis, typed
  const h2 = 'hole2c';
  S().joints.set(h2, { x: 13.1, y: -40, fixed: false, sketchId: 'sketch-1' });
  S().shapes.push({ id: 'hole2', type: 'circle', joints: [h2], radius: 3, sketchId: 'sketch-1' });
  S().constraints.push({ type: 'distance', shape: 'hole2', isRadius: true, isDiameter: true, value: 6, name: 'd23' },
    { type: 'distance', joints: [h2, 'j_origin', 'j_ref_x'], value: 40, name: 'd24' },
    { type: 'distance', joints: [h2, 'j_origin', 'j_ref_y'], value: 13.1, name: 'd25' });
  S().engine.solve(200);
  const r1 = edit(named('d25'), '10');
  assert.ok(r1.ok, `the circle's point-to-line d25 -> 10 is accepted (got ${r1.reason || ''})`);
  assert.ok(Math.abs(S().joints.get(h2).x - 10) < 1e-6, 'the circle moved to 10 from the Y axis');

  // R1-07 (after the edits, as the audit's A18 save came after them): nothing dangles; the axis constraint now holds the (0, -50) corner's virtual sharp
  assert.deepStrictEqual(dangling(), [], 'no constraint names a deleted joint');
  const onAxis = S().constraints.find((c) => c.type === 'pointOnLine' && c.shape === 'ref_axis_y');
  const sharp = onAxis && S().joints.get(onAxis.joint);
  assert.ok(sharp && sharp.virtualSharp && Math.abs(sharp.x) < 1e-6 && Math.abs(sharp.y + 50) < 1e-6, `the axis constraint holds the corner's virtual sharp (got ${JSON.stringify(onAxis)})`);
  const before = S().constraints.length, saved = serializeDocument(S());
  await app.close();
  const again = await createProfile();
  await createNamedDesign(again, 'sketchstudio', 'R1-07 reload', saved);
  app = await open({ host: 'sketchstudio', profile: again });
  assert.strictEqual(S().constraints.length, before, 'Save + reload keeps every constraint');

  console.log('fillet-corner-axis-r107-1018-node: ok');
} finally {
  await app.close();
}
