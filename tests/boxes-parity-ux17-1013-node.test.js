// tests/boxes-parity-ux17-1013-node.test.js — TASK 1013 guarding test for UX-17 (a/b/c)
// Draw-time boxes reuse the edit box's ONE parse / validate / autocomplete path:
//   (a) `w = 50` and `w = d1 / 2` in draw-time boxes name the created dimension (never `"=" only as name = value at the start`),
//       duplicate names are refused, existing user params follow O4, and non-dimension fields (count/angle) refuse `=` cleanly.
//   (b) `-5` / `0` (and angle <= 0 or > 360, offset 0) keep the box OPEN with inline `#dimHint` + aria-invalid in BOTH draw-time and edit boxes (no toast, text kept).
//   (c) `#dimComplete` autocomplete works in single draw-time boxes, dual draw-time boxes, and the edit box (Tab inserts while open, switches fields when closed; Esc closes list first).
import assert from 'node:assert';
import { open, createProfile, createNamedDesign } from './helpers/node-app.js';
import { boxOpen } from './helpers/node-dom-read.js';
import { showEditInput } from '#ui/numeric-input-manager.js';

let passed = 0;
async function run(name, fn) {
  await fn();
  passed++;
  console.log(`  ok: ${name}`);
}

const docOf = (joints, shapes, constraints, parameters = []) => ({
  version: 3, hosts: {},
  geometry: {
    joints: [['j_origin', { x: 0, y: 0, fixed: true, sketchId: 'sketch-1' }], ...joints.map(([id, j]) => [id, { fixed: false, sketchId: 'sketch-1', ...j }])],
    shapes: shapes.map((s) => ({ sketchId: 'sketch-1', ...s })),
    constraints, parameters,
    sketches: [{ id: 'sketch-1', name: 'Sketch 1', visible: true }],
    activeSketchId: 'sketch-1', groups: [], profiles: [],
  },
});

async function openDoc(doc) {
  const profile = await createProfile();
  await createNamedDesign(profile, 'sketchstudio', 'UX17', doc);
  const app = await open({ host: 'sketchstudio', profile });
  const r = app.svg.getBoundingClientRect();
  Object.assign(app.state.view, { x: 40, y: 30, w: 240 });
  app.state.view.h = app.state.view.w / (r.width / r.height);
  app.svg.setAttribute('viewBox', `${app.state.view.x - app.state.view.w / 2} ${app.state.view.y - app.state.view.h / 2} ${app.state.view.w} ${app.state.view.h}`);
  app.frames(2);
  return app;
}

const hintState = (app) => {
  const h = app.document.getElementById('dimHint');
  const shown = !!h && !h.classList.contains('hidden');
  return { shown, text: shown ? h.textContent.trim() : '', err: !!(h && h.classList.contains('err')) };
};
const compState = (app) => {
  const c = app.document.getElementById('dimComplete');
  const shown = !!c && !c.classList.contains('hidden');
  const items = shown ? [...c.querySelectorAll('li')].map((li) => ({
    name: li.querySelector('.dc-name').textContent,
    sel: li.getAttribute('aria-selected') === 'true',
  })) : [];
  return { shown, items };
};
const readToasts = (app) => [...app.document.querySelectorAll('#notification-container [data-level]')].map((e) => e.textContent.trim().replace(/\s+/g, ' ')).filter(Boolean);
const clearToasts = (app) => { for (const e of app.document.querySelectorAll('#notification-container [data-level]')) e.remove(); };
const dualInputs = (app) => [...app.document.querySelectorAll('#dualInput input')];
const setInput = (app, el, text) => {
  el.focus();
  el.value = text;
  if (typeof el.setSelectionRange === 'function') el.setSelectionRange(text.length, text.length);
  el.dispatchEvent(new app.window.Event('input', { bubbles: true }));
};
const pressKey = (app, el, key) => {
  el.dispatchEvent(new app.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
};

// ── (a) `w = 50` and `w = d1 / 2` in Line draw-time box ──
await run('UX-17a: Line draw-time box accepts w = 50, names dim w, refuses duplicate w, updates user param ply', async () => {
  const app = await openDoc(docOf(
    [['a', { x: 0, y: 0, fixed: true }], ['b', { x: 60, y: 0 }]],
    [{ id: 'L1', type: 'line', joints: ['a', 'b'] }],
    [{ type: 'horizontal', joints: ['a', 'b'] }, { type: 'distance', joints: ['a', 'b'], value: 60, name: 'd1', offset: 15 }],
    [{ name: 'ply', unit: 'mm', expression: '18 mm' }],
  ));
  try {
    app.tool('line');
    const p1 = app.toScreen(0, 30), p2 = app.toScreen(40, 30);
    app.click(p1.x, p1.y);
    app.move(p2.x, p2.y);

    const [lenIn, angIn] = dualInputs(app);
    assert.ok(lenIn, 'Line dual input opened');

    // 1. w = 50 creates line of length 50 with dimension named w
    setInput(app, lenIn, 'w = 50');
    assert.strictEqual(lenIn.getAttribute('aria-invalid'), 'false', 'w = 50 is valid, hint=' + JSON.stringify(hintState(app)));
    pressKey(app, lenIn, 'Enter');
    const wDim = app.state.constraints.find((c) => c.type === 'distance' && c.name === 'w');
    assert.ok(wDim, 'dimension named w was created');
    assert.ok(Math.abs(wDim.value - 50) < 1e-6, `w value is 50 (got ${wDim.value})`);
    assert.strictEqual(wDim.expression || null, null, 'plain value w = 50 stores no expression');
    assert.strictEqual(app.state.parameters.length, 1, 'no extra user parameter created (only ply)');

    // 2. Duplicate name `w = 30` is refused with NAME_TAKEN (like edit box)
    const nShapesBeforeDup = app.state.shapes.length;
    setInput(app, lenIn, 'w = 30');
    assert.strictEqual(lenIn.getAttribute('aria-invalid'), 'true', 'duplicate w = 30 is invalid');
    assert.match(hintState(app).text, /already used/i, `duplicate hint: ${hintState(app).text}`);
    pressKey(app, lenIn, 'Enter');
    assert.strictEqual(app.state.shapes.length, nShapesBeforeDup, 'duplicate name places nothing');

    // 3. `half = d1 / 2` names dim half AND preserves expression d1 / 2
    app.move(app.toScreen(80, 60).x, app.toScreen(80, 60).y);
    setInput(app, lenIn, 'half = d1 / 2');
    assert.strictEqual(lenIn.getAttribute('aria-invalid'), 'false', 'half = d1 / 2 is valid');
    pressKey(app, lenIn, 'Enter');
    const halfDim = app.state.constraints.find((c) => c.type === 'distance' && c.name === 'half');
    assert.ok(halfDim, 'dimension named half was created');
    assert.ok(Math.abs(halfDim.value - 30) < 1e-6, `half value is 30 (got ${halfDim.value})`);
    assert.strictEqual(halfDim.expression, 'd1 / 2', `half keeps expression d1 / 2 (got ${halfDim.expression})`);

    // 4. Existing user parameter `ply = 22` updates ply and makes the new dim read ply
    app.move(app.toScreen(120, 60).x, app.toScreen(120, 60).y);
    setInput(app, lenIn, 'ply = 22');
    assert.strictEqual(lenIn.getAttribute('aria-invalid'), 'false', 'ply = 22 is valid');
    pressKey(app, lenIn, 'Enter');
    const plyParam = app.state.parameters.find((p) => p.name === 'ply');
    assert.strictEqual(plyParam.expression, '22 mm', `ply updated to 22 mm (got ${plyParam.expression})`);
    const plyDim = app.state.constraints.find((c) => c.type === 'distance' && c.expression === 'ply');
    assert.ok(plyDim && Math.abs(plyDim.value - 22) < 1e-6, 'new dim reads ply = 22');

    // 5. Non-dimension angle field refuses `a = 30` WITHOUT the self-contradictory message
    setInput(app, angIn, 'a = 30');
    assert.strictEqual(angIn.getAttribute('aria-invalid'), 'true', 'angle field refuses assignment');
    const angHint = hintState(app).text;
    assert.ok(angHint && !/only as\s+name\s*=\s*value\s+at the start/i.test(angHint), `angle field hint is not self-contradictory: "${angHint}"`);

    app.esc();
  } finally {
    await app.close();
  }
});

// ── (b) `-5` / `0` keep box OPEN with inline hint in BOTH draw-time and edit boxes ──
await run('UX-17b: -5 and 0 keep box open with inline #dimHint and no toast in BOTH draw-time and edit boxes', async () => {
  const app = await openDoc(docOf(
    [['a', { x: 0, y: 0, fixed: true }], ['b', { x: 60, y: 0 }], ['c', { x: 30, y: 40 }]],
    [
      { id: 'L1', type: 'line', joints: ['a', 'b'] },
      { id: 'L2', type: 'line', joints: ['a', 'c'] },
    ],
    [
      { type: 'horizontal', joints: ['a', 'b'] },
      { type: 'distance', joints: ['a', 'b'], value: 60, name: 'd1', offset: 15 },
      { type: 'angle', shapes: ['L1', 'L2'], joints: ['b', 'a', 'c'], value: 53.13, name: 'd2' },
    ],
  ));
  try {
    const d1 = app.state.constraints.find((c) => c.name === 'd1');
    const d2 = app.state.constraints.find((c) => c.name === 'd2');

    // Edit box: -5 and 0 stay open with inline hint, aria-invalid, NO toast, value preserved in input
    for (const bad of ['-5', '0']) {
      clearToasts(app);
      const h0 = app.state.history.length;
      showEditInput(app.svg, app.state, d1);
      const inp = app.document.getElementById('dimInput');
      setInput(app, inp, bad);
      assert.strictEqual(inp.getAttribute('aria-invalid'), 'true', `edit box "${bad}" marks aria-invalid`);
      assert.strictEqual(hintState(app).shown, true, `edit box "${bad}" shows inline #dimHint`);
      assert.strictEqual(hintState(app).err, true, `edit box "${bad}" hint has .err`);
      assert.match(hintState(app).text, /more than 0/i, `edit box "${bad}" hint text: "${hintState(app).text}"`);
      pressKey(app, inp, 'Enter');
      assert.strictEqual(boxOpen(app), true, `edit box "${bad}" STAYS OPEN on Enter`);
      assert.strictEqual(inp.value, bad, `edit box "${bad}" keeps typed text so user can edit it`);
      assert.deepStrictEqual(readToasts(app), [], `edit box "${bad}" shows NO toast (inline hint only)`);
      assert.strictEqual(d1.value, 60, `edit box "${bad}" does not mutate d1`);
      assert.strictEqual(app.state.history.length, h0, `edit box "${bad}" records no undo step`);
      pressKey(app, inp, 'Escape');
    }

    // Recovery: fix -5 -> 75 and Enter commits cleanly
    showEditInput(app.svg, app.state, d1);
    const inp = app.document.getElementById('dimInput');
    setInput(app, inp, '-5');
    pressKey(app, inp, 'Enter');
    assert.strictEqual(boxOpen(app), true, 'stays open on -5');
    setInput(app, inp, '75');
    pressKey(app, inp, 'Enter');
    assert.strictEqual(boxOpen(app), false, 'closes on valid 75');
    assert.ok(Math.abs(d1.value - 75) < 1e-6, `d1 updated to 75 (got ${d1.value})`);

    // Angle edit box: 0, -30, 361 also stay open with inline hint
    for (const badAng of ['0', '-30', '361']) {
      clearToasts(app);
      showEditInput(app.svg, app.state, d2);
      setInput(app, inp, badAng);
      assert.strictEqual(inp.getAttribute('aria-invalid'), 'true', `angle "${badAng}" invalid`);
      assert.strictEqual(hintState(app).shown && hintState(app).err, true, `angle "${badAng}" inline err hint`);
      pressKey(app, inp, 'Enter');
      assert.strictEqual(boxOpen(app), true, `angle "${badAng}" stays open on Enter`);
      assert.deepStrictEqual(readToasts(app), [], `angle "${badAng}" shows no toast`);
      pressKey(app, inp, 'Escape');
    }

    // Draw-time box: -5 and 0 also stay open with inline hint and no toast
    clearToasts(app);
    app.tool('line');
    const p1 = app.toScreen(0, 50), p2 = app.toScreen(40, 50);
    app.click(p1.x, p1.y);
    app.move(p2.x, p2.y);
    const [lenIn] = dualInputs(app);
    for (const bad of ['-5', '0']) {
      setInput(app, lenIn, bad);
      pressKey(app, lenIn, 'Enter');
      assert.strictEqual(app.document.getElementById('dualInput').classList.contains('hidden'), false, `draw box "${bad}" stays open`);
      assert.strictEqual(hintState(app).shown && hintState(app).err, true, `draw box "${bad}" shows inline err hint`);
      assert.match(hintState(app).text, /more than 0/i, `draw box "${bad}" hint text`);
      assert.deepStrictEqual(readToasts(app), [], `draw box "${bad}" shows no toast`);
    }
    app.esc();
  } finally {
    await app.close();
  }
});

// ── (c) `#dimComplete` autocomplete in dual & single draw-time boxes ──
await run('UX-17c: #dimComplete autocomplete works in dual (Line) and single (Circle) draw-time boxes', async () => {
  const app = await openDoc(docOf(
    [['a', { x: 0, y: 0, fixed: true }], ['b', { x: 60, y: 0 }]],
    [{ id: 'L1', type: 'line', joints: ['a', 'b'] }],
    [{ type: 'horizontal', joints: ['a', 'b'] }, { type: 'distance', joints: ['a', 'b'], value: 60, name: 'd1', offset: 15 }],
    [{ name: 'width', unit: 'mm', expression: '45 mm' }],
  ));
  try {
    // 1. Dual box (Line): typing "wi" shows #dimComplete with "width", Tab inserts without switching fields, next Tab switches field
    app.tool('line');
    const p1 = app.toScreen(0, 30), p2 = app.toScreen(40, 30);
    app.click(p1.x, p1.y);
    app.move(p2.x, p2.y);
    const [lenIn, angIn] = dualInputs(app);

    setInput(app, lenIn, 'wi');
    let cs = compState(app);
    assert.strictEqual(cs.shown, true, 'dual draw-time box opens #dimComplete for "wi"');
    assert.strictEqual(cs.items[0].name, 'width', `top completion is width: ${JSON.stringify(cs.items)}`);

    // Tab inserts "width" and stays in lenIn
    pressKey(app, lenIn, 'Tab');
    assert.strictEqual(lenIn.value, 'width', `Tab inserts completion (got "${lenIn.value}")`);
    assert.strictEqual(compState(app).shown, false, 'list closes after Tab insert');
    assert.strictEqual(app.document.activeElement, lenIn, 'focus stays on lenIn after completion Tab');

    // Esc while completion open closes completion, keeps draw-time box open
    setInput(app, lenIn, 'd');
    assert.strictEqual(compState(app).shown, true, '#dimComplete opens for "d"');
    assert.ok(compState(app).items.some((x) => x.name === 'd1'), 'offers d1');
    pressKey(app, lenIn, 'Escape');
    assert.strictEqual(compState(app).shown, false, 'first Esc closes #dimComplete');
    assert.strictEqual(app.document.getElementById('dualInput').classList.contains('hidden'), false, 'first Esc keeps dual draw-time box open');

    // Tab when completion is closed switches to angIn
    pressKey(app, lenIn, 'Tab');
    assert.strictEqual(app.document.activeElement, angIn, 'Tab switches to second field when completion closed');
    app.esc();

    // 2. Single draw-time box (Circle): typing "d" opens #dimComplete offering d1, Tab inserts d1
    app.tool('circle');
    const c1 = app.toScreen(30, 50), c2 = app.toScreen(50, 50);
    app.click(c1.x, c1.y);
    app.move(c2.x, c2.y);
    const single = app.document.getElementById('dimInput');
    setInput(app, single, 'd');
    cs = compState(app);
    assert.strictEqual(cs.shown, true, 'single draw-time box opens #dimComplete for "d"');
    assert.ok(cs.items.some((x) => x.name === 'd1'), 'single draw-time box offers d1');
    pressKey(app, single, 'Tab');
    assert.strictEqual(single.value, 'd1', `single box Tab inserts d1 (got "${single.value}")`);
    assert.strictEqual(compState(app).shown, false, 'single box list closes after Tab');
    app.esc();
  } finally {
    await app.close();
  }
});

console.log(`PASS boxes-parity-ux17-1013-node (${passed} tests)`);
