// tests/circle-typed-snap-b8-1013-node.test.js — TASK 1013 guarding test for B-8
// Circle tool:
//   1. Click centre snapped onto an existing joint -> move -> type diameter + Enter: keeps centre coincident (same as click-2).
//   2. Click centre snapped onto an existing joint -> NO mouse move -> type diameter + Enter: places circle immediately & keeps centre coincident.
//   3. Click centre -> NO mouse move -> Enter with nothing typed: places nothing and keeps box open waiting for radius/diameter.
import assert from 'node:assert';
import { open, createProfile, createNamedDesign } from './helpers/node-app.js';

let passed = 0;
async function run(name, fn) {
  await fn();
  passed++;
  console.log(`  ok: ${name}`);
}

const lineDoc = () => ({
  version: 3, hosts: {},
  geometry: {
    joints: [
      ['j_origin', { x: 0, y: 0, fixed: true, sketchId: 'sketch-1' }],
      ['a', { x: 0, y: 0, fixed: true, sketchId: 'sketch-1' }],
      ['b', { x: 40, y: 0, fixed: false, sketchId: 'sketch-1' }],
    ],
    shapes: [{ id: 'L1', type: 'line', joints: ['a', 'b'], sketchId: 'sketch-1' }],
    constraints: [],
    parameters: [],
    sketches: [{ id: 'sketch-1', name: 'Sketch 1', visible: true }],
    activeSketchId: 'sketch-1', groups: [], profiles: [],
  },
});

async function openDoc() {
  const profile = await createProfile();
  await createNamedDesign(profile, 'sketchstudio', 'B8', lineDoc());
  const app = await open({ host: 'sketchstudio', profile });
  const r = app.svg.getBoundingClientRect();
  Object.assign(app.state.view, { x: 30, y: 0, w: 200 });
  app.state.view.h = app.state.view.w / (r.width / r.height);
  app.svg.setAttribute('viewBox', `${app.state.view.x - app.state.view.w / 2} ${app.state.view.y - app.state.view.h / 2} ${app.state.view.w} ${app.state.view.h}`);
  app.frames(2);
  return app;
}

const hasCenterCoincident = (state, circleShape, targetJointId) => {
  const cid = circleShape.joints[0];
  if (cid === targetJointId) return true;
  return state.constraints.some((c) => c.type === 'coincident' && Array.isArray(c.joints) && c.joints.includes(cid) && c.joints.includes(targetJointId));
};

await run('B-8a: Circle snapped to existing joint -> move -> type 30 + Enter keeps centre coincident', async () => {
  const app = await openDoc();
  try {
    app.tool('circle');
    const bSc = app.toScreen(40, 0);
    app.move(bSc.x, bSc.y);
    app.click(bSc.x, bSc.y);
    const rimSc = app.toScreen(60, 0);
    app.move(rimSc.x, rimSc.y);
    app.type('30');
    app.enter();

    const cir = app.state.shapes.find((s) => s.type === 'circle');
    assert.ok(cir, 'circle created');
    assert.ok(Math.abs(cir.radius - 15) < 1e-6, `circle radius is 15 (got ${cir.radius})`);
    assert.strictEqual(hasCenterCoincident(app.state, cir, 'b'), true, 'centre keeps coincident constraint to snapped joint b');
  } finally {
    await app.close();
  }
});

await run('B-8b: Circle snapped to existing joint -> NO mouse move -> type 30 + Enter commits & keeps centre coincident', async () => {
  const app = await openDoc();
  try {
    app.tool('circle');
    const bSc = app.toScreen(40, 0);
    app.move(bSc.x, bSc.y);
    app.click(bSc.x, bSc.y);
    // NO mouse move after click 1!
    app.type('30');
    app.enter();

    const cir = app.state.shapes.find((s) => s.type === 'circle');
    assert.ok(cir, 'circle created immediately after click 1 + type + Enter with no mouse move');
    assert.ok(Math.abs(cir.radius - 15) < 1e-6, `circle radius is 15 (got ${cir.radius})`);
    assert.strictEqual(app.state.active, null, 'circle draw finished cleanly');
    assert.strictEqual(hasCenterCoincident(app.state, cir, 'b'), true, 'centre keeps coincident constraint to snapped joint b');
  } finally {
    await app.close();
  }
});

await run('B-8c: Circle click 1 -> NO mouse move -> Enter with nothing typed keeps box open and places nothing', async () => {
  const app = await openDoc();
  try {
    app.tool('circle');
    const pSc = app.toScreen(10, 20);
    app.move(pSc.x, pSc.y);
    app.click(pSc.x, pSc.y);
    // Nothing moved, nothing typed
    app.enter();

    const cir = app.state.shapes.find((s) => s.type === 'circle');
    assert.strictEqual(cir, undefined, 'no zero-radius circle created');
    assert.ok(app.state.active && app.state.active.mode === 'circle', 'draw stays active');
    const inp = app.document.getElementById('dimInput');
    assert.ok(inp && !inp.classList.contains('hidden'), 'box stays open waiting for a diameter');
    app.esc();
  } finally {
    await app.close();
  }
});

console.log(`PASS circle-typed-snap-b8-1013-node (${passed} tests)`);
