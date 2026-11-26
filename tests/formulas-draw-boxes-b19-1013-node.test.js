// tests/formulas-draw-boxes-b19-1013-node.test.js — TASK 1013 guarding test for B-19 b / c / e
// Every draw-time / Modify value box keeps typed formulas (and names) in the dimension it creates, same as the edit box:
//   B-19b: Polygon draw-time box `d1 / 2` creates a driving radius dimension with expression `d1 / 2` that follows `d1`.
//   B-19c: Slot modes (`slot-c2c`, `slot-overall`, `slot-center`, and arc slot) keep span dim+formula AND width formula; both follow `d1`.
//   B-19e: Fillet and Offset boxes accept formulas (`d1 / 4`, `-d1 / 4`, `r = d1 / 4`), store the expression on the created dim, follow `d1`, and offer `#dimComplete`.
import assert from 'node:assert';
import { open, createProfile, createNamedDesign } from './helpers/node-app.js';
import { previewDimensionInput } from '#core/parameters.js';
import { applyParameterChange } from '#core/dimension-seams.js';
import { SLOT_MODES } from '#core/constants.js';
import { parseFilletRadius } from '#core/fillet.js';
import { parseOffsetDistance } from '#core/offset.js';

let passed = 0;
async function run(name, fn) {
  await fn();
  passed++;
  console.log(`  ok: ${name}`);
}

const baseDoc = (extraJoints = [], extraShapes = [], extraConstraints = []) => ({
  version: 3, hosts: {},
  geometry: {
    joints: [
      ['j_origin', { x: 0, y: 0, fixed: true, sketchId: 'sketch-1' }],
      ['a', { x: 0, y: 0, fixed: true, sketchId: 'sketch-1' }],
      ['b', { x: 60, y: 0, fixed: false, sketchId: 'sketch-1' }],
      ...extraJoints.map(([id, j]) => [id, { fixed: false, sketchId: 'sketch-1', ...j }]),
    ],
    shapes: [
      { id: 'L1', type: 'line', joints: ['a', 'b'], sketchId: 'sketch-1' },
      ...extraShapes.map((s) => ({ sketchId: 'sketch-1', ...s })),
    ],
    constraints: [
      { type: 'horizontal', joints: ['a', 'b'] },
      { type: 'distance', joints: ['a', 'b'], value: 60, name: 'd1', offset: 15 },
      ...extraConstraints,
    ],
    parameters: [],
    sketches: [{ id: 'sketch-1', name: 'Sketch 1', visible: true }],
    activeSketchId: 'sketch-1', groups: [], profiles: [],
  },
});

async function openDoc(doc) {
  const profile = await createProfile();
  await createNamedDesign(profile, 'sketchstudio', 'B19', doc);
  const app = await open({ host: 'sketchstudio', profile });
  const r = app.svg.getBoundingClientRect();
  Object.assign(app.state.view, { x: 40, y: 40, w: 260 });
  app.state.view.h = app.state.view.w / (r.width / r.height);
  app.svg.setAttribute('viewBox', `${app.state.view.x - app.state.view.w / 2} ${app.state.view.y - app.state.view.h / 2} ${app.state.view.w} ${app.state.view.h}`);
  app.frames(2);
  return app;
}

const setInput = (app, el, text) => {
  el.focus();
  el.value = text;
  if (typeof el.setSelectionRange === 'function') el.setSelectionRange(text.length, text.length);
  el.dispatchEvent(new app.window.Event('input', { bubbles: true }));
};
const pressKey = (app, el, key) => {
  el.dispatchEvent(new app.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
};
const updateD1 = (app, text) => {
  const d1 = app.state.constraints.find((c) => c.name === 'd1');
  const pv = previewDimensionInput(app.state, d1, text, { unit: 'mm' });
  assert.ok(pv.ok, `preview d1=${text}: ${JSON.stringify(pv)}`);
  const res = applyParameterChange(app.state, pv.plan, `d1 -> ${text}`);
  assert.ok(res.ok, `apply d1=${text}: ${JSON.stringify(res)}`);
};

// ── B-19b: Polygon draw-time box `d1 / 2` creates radius dim with formula ──
await run('B-19b: Polygon draw-time box "d1 / 2" creates driving radius dim that follows d1', async () => {
  const app = await openDoc(baseDoc());
  try {
    app.tool('polygon');
    const c = app.toScreen(50, 50), m = app.toScreen(80, 50);
    app.click(c.x, c.y);
    app.move(m.x, m.y);
    const inp = app.document.querySelector('#dualInput input');
    assert.ok(inp, 'polygon dual box opened');
    setInput(app, inp, 'd1 / 2');
    pressKey(app, inp, 'Enter');

    const polyDim = app.state.constraints.find((x) => x.type === 'distance' && x.name !== 'd1');
    assert.ok(polyDim, 'polygon created a radius distance dimension');
    assert.ok(Math.abs(polyDim.value - 30) < 1e-6, `polygon radius dim = 30 (got ${polyDim.value})`);
    assert.strictEqual(polyDim.expression, 'd1 / 2', `polygon dim keeps formula (got ${polyDim.expression})`);

    // Changing d1 from 60 -> 80 resizes the polygon radius to 40
    updateD1(app, '80');
    assert.ok(Math.abs(polyDim.value - 40) < 1e-4, `polygon radius followed d1 -> 40 (got ${polyDim.value})`);
    const [jA, jB] = polyDim.joints.map((id) => app.state.joints.get(id));
    assert.ok(Math.abs(Math.hypot(jB.x - jA.x, jB.y - jA.y) - 40) < 1e-3, 'polygon geometry followed d1 -> 40');
  } finally {
    await app.close();
  }
});

// ── B-19c: Slot modes keep span dim + formula AND width formula ──
for (const mode of [SLOT_MODES.CENTER_TO_CENTER, SLOT_MODES.OVERALL, SLOT_MODES.CENTER_POINT]) {
  await run(`B-19c (${mode}): span="d1 / 2" and width="d1 / 4" create/keep both formulas and follow d1`, async () => {
    const app = await openDoc(baseDoc());
    try {
      app.state.slotMode = mode;
      app.tool('slot');
      const p1 = app.toScreen(10, 50), p2 = app.toScreen(50, 50), p3 = app.toScreen(50, 65);
      app.click(p1.x, p1.y);
      app.move(p2.x, p2.y);
      const box1 = app.document.getElementById('dimInput');
      assert.ok(box1 && !box1.classList.contains('hidden'), `${mode}: span box open`);
      setInput(app, box1, 'd1 / 2');
      pressKey(app, box1, 'Enter');

      app.move(p3.x, p3.y);
      const box2 = app.document.getElementById('dimInput');
      assert.ok(box2 && !box2.classList.contains('hidden'), `${mode}: width box open`);
      setInput(app, box2, 'd1 / 4');
      pressKey(app, box2, 'Enter');

      const newDims = app.state.constraints.filter((c) => c.type === 'distance' && c.name !== 'd1');
      const spanDim = newDims.find((c) => !c.isRadius && !c.isDiameter);
      const widthDim = newDims.find((c) => c.isDiameter || c.isRadius);
      assert.ok(spanDim, `${mode}: span dim created (${JSON.stringify(newDims)})`);
      assert.ok(Math.abs(spanDim.value - 30) < 1e-4, `${mode}: span = 30 (got ${spanDim.value})`);
      assert.strictEqual(spanDim.expression, 'd1 / 2', `${mode}: span expression = "d1 / 2" (got ${spanDim.expression})`);
      assert.ok(widthDim, `${mode}: width dim exists`);
      assert.ok(Math.abs(widthDim.value - 15) < 1e-4, `${mode}: width = 15 (got ${widthDim.value})`);
      assert.strictEqual(widthDim.expression, 'd1 / 4', `${mode}: width expression = "d1 / 4" (got ${widthDim.expression})`);

      // Edit d1 60 -> 80: both span (40) and width (20) follow!
      updateD1(app, '80');
      assert.ok(Math.abs(spanDim.value - 40) < 1e-3, `${mode}: span followed d1 -> 40 (got ${spanDim.value})`);
      assert.ok(Math.abs(widthDim.value - 20) < 1e-3, `${mode}: width followed d1 -> 20 (got ${widthDim.value})`);
    } finally {
      await app.close();
    }
  });
}

// ── B-19e (Fillet): Fillet radius box accepts `d1 / 4`, keeps formula, follows d1, and offers #dimComplete ──
await run('B-19e (Fillet): Fillet box accepts "d1 / 4", stores expression on radius dim, follows d1, and offers #dimComplete', async () => {
  const app = await openDoc(baseDoc(
    [['c', { x: 60, y: 60 }]],
    [{ id: 'L2', type: 'line', joints: ['b', 'c'] }],
    [{ type: 'vertical', joints: ['b', 'c'] }, { type: 'distance', joints: ['b', 'c'], value: 60, name: 'd2' }],
  ));
  try {
    assert.strictEqual(parseFilletRadius('d1 / 4', 'mm', app.state), 15, 'parseFilletRadius evaluates formula with state');

    app.tool('fillet');
    const cornerSc = app.toScreen(60, 0);
    app.click(cornerSc.x, cornerSc.y);
    const inp = app.document.getElementById('fillet-radius-input');
    assert.ok(inp, 'fillet radius input opened');

    // Autocomplete works in fillet box
    setInput(app, inp, 'd');
    const comp = app.document.getElementById('dimComplete');
    assert.ok(comp && !comp.classList.contains('hidden') && comp.children.length > 0, 'fillet box opens #dimComplete for "d"');

    // Type formula d1 / 6 (= 10 mm) and Enter
    setInput(app, inp, 'd1 / 6');
    assert.strictEqual(inp.getAttribute('aria-invalid'), 'false', 'd1 / 6 is valid in fillet box');
    pressKey(app, inp, 'Enter');
    assert.strictEqual(app.document.getElementById('fillet-radius-input'), null, 'fillet box closed on apply');

    const filletDim = app.state.constraints.find((c) => c.type === 'distance' && c.isRadius);
    assert.ok(filletDim, 'fillet radius dim created');
    assert.ok(Math.abs(filletDim.value - 10) < 1e-4, `fillet radius = 10 (got ${filletDim.value})`);
    assert.strictEqual(filletDim.expression, 'd1 / 6', `fillet dim keeps formula (got ${filletDim.expression})`);

    // Changing d1 60 -> 90 updates fillet radius to 15
    updateD1(app, '90');
    assert.ok(Math.abs(filletDim.value - 15) < 1e-3, `fillet radius followed d1 -> 15 (got ${filletDim.value})`);
  } finally {
    await app.close();
  }
});

// ── B-19e (Offset): Offset distance box accepts `d1 / 6` (and `-d1 / 6`), keeps formula, follows d1, and offers #dimComplete ──
await run('B-19e (Offset): Offset box accepts "d1 / 6", stores expression on offset dim, follows d1, and offers #dimComplete', async () => {
  const app = await openDoc(baseDoc());
  try {
    assert.strictEqual(parseOffsetDistance('d1 / 6', 'mm', app.state), 10, 'parseOffsetDistance evaluates formula with state');
    assert.strictEqual(parseOffsetDistance('-d1 / 6', 'mm', app.state), -10, 'parseOffsetDistance evaluates negative formula with state');

    app.tool('offset');
    const lineSc = app.toScreen(30, 0);
    app.click(lineSc.x, lineSc.y);
    const inp = app.document.getElementById('offset-distance-input');
    assert.ok(inp, 'offset distance input opened');

    // Autocomplete works in offset box
    setInput(app, inp, 'd');
    const comp = app.document.getElementById('dimComplete');
    assert.ok(comp && !comp.classList.contains('hidden') && comp.children.length > 0, 'offset box opens #dimComplete for "d"');

    // Type formula d1 / 6 (= 10 mm) and Enter
    setInput(app, inp, 'd1 / 6');
    pressKey(app, inp, 'Enter');
    assert.strictEqual(app.document.getElementById('offset-distance-input'), null, 'offset box closed on apply');

    const offDim = app.state.constraints.find((c) => c.type === 'offset');
    assert.ok(offDim, 'offset dim created');
    assert.ok(Math.abs(offDim.value - 10) < 1e-4, `offset value = 10 (got ${offDim.value})`);
    assert.strictEqual(offDim.expression, 'd1 / 6', `offset dim keeps formula (got ${offDim.expression})`);

    // Changing d1 60 -> 90 updates offset distance to 15
    updateD1(app, '90');
    assert.ok(Math.abs(offDim.value - 15) < 1e-3, `offset followed d1 -> 15 (got ${offDim.value})`);
  } finally {
    await app.close();
  }
});

console.log(`PASS formulas-draw-boxes-b19-1013-node (${passed} tests)`);
