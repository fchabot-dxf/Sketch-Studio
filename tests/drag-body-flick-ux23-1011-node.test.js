// tests/drag-body-flick-ux23-1011-node.test.js -- TASK 1011 (UX-23):
// A quick 1-step flick on a line's BODY must use the same sub-moves and reach the same pose
// as a quick 1-step flick on its joint (no stalling behind due to skipping sub-moves or
// instantaneous-tangent projection on curved 1-DOF motion).
import assert from 'node:assert';
import { open, createProfile, createNamedDesign } from './helpers/node-app.js';
import SettingsManager from '#core/settings-manager.js';
import { measureResidual } from '#core/constraint-verifier.js';

SettingsManager.set('GRID_MAGNETISM', 0.001, { persist: 'none' });

const D = (a, b, value, name) => ({ type: 'distance', joints: [a, b], value, name });
const quiet = (fn) => {
  const l = console.log, w = console.warn;
  console.log = () => {}; console.warn = () => {};
  try { return fn(); } finally { console.log = l; console.warn = w; }
};

function makeDoc(joints, shapes, constraints) {
  return {
    version: 3, hosts: {},
    geometry: {
      joints: [
        ['j_origin', { x: 0, y: 0, fixed: true, sketchId: 'sketch-1' }],
        ...Object.entries(joints).map(([id, [x, y, fixed]]) => [id, { x, y, fixed: !!fixed, sketchId: 'sketch-1' }]),
      ],
      shapes: shapes.map(s => ({ sketchId: 'sketch-1', ...s })),
      constraints,
      sketches: [{ id: 'sketch-1', name: 'Sketch 1', visible: true }],
      activeSketchId: 'sketch-1', groups: [], profiles: [], parameters: [],
    },
  };
}

async function runFlick(doc, from, to, viewW = 300) {
  const profile = await createProfile();
  await createNamedDesign(profile, 'sketchstudio', 'UX-23 Flick', doc);
  const app = await open({ host: 'sketchstudio', profile });
  try {
    const st = app.state;
    app.tool('select');
    const r = app.svg.getBoundingClientRect();
    Object.assign(st.view, { x: 0, y: 0, w: viewW });
    st.view.h = st.view.w / (r.width / r.height);
    app.svg.setAttribute('viewBox', `${st.view.x - st.view.w / 2} ${st.view.y - st.view.h / 2} ${st.view.w} ${st.view.h}`);
    app.frames();
    const a = app.toScreen(from.x, from.y), b = app.toScreen(to.x, to.y);
    let wasBody = false;
    quiet(() => {
      app.move(a.x, a.y);
      app.down(a.x, a.y);
      wasBody = !!(st.drag && st.drag.body);
      app.move(b.x, b.y, { buttons: 1 }); // single 1-step flick
      app.up(b.x, b.y);
      app.frames(2);
    });
    const worstResidual = Math.max(0, ...st.constraints.filter(c => !c.isDriven && !c.driven).map(c => measureResidual(c, st.joints, st.shapes)));
    const joints = Object.fromEntries([...st.joints].map(([id, j]) => [id, { x: j.x, y: j.y }]));
    return { wasBody, joints, worstResidual };
  } finally {
    await app.close();
  }
}

// 1. DR6.2a vs DR6.2b (CROSS UX-23): 1-DOF line length 60, flick joint b (60,0)->(-60,10) vs body mid (30,0)->(-30,10)
{
  const doc = makeDoc({ a: [0, 0, true], b: [60, 0] }, [{ id: 'L1', type: 'line', joints: ['a', 'b'] }], [D('a', 'b', 60, 'd1')]);
  const jRes = await runFlick(doc, { x: 60, y: 0 }, { x: -60, y: 10 }, 300);
  const bRes = await runFlick(doc, { x: 30, y: 0 }, { x: -30, y: 10 }, 300);
  assert.strictEqual(jRes.wasBody, false, 'joint flick used joint drag');
  assert.strictEqual(bRes.wasBody, true, 'body flick used body drag');
  assert.ok(jRes.worstResidual < 1e-6 && bRes.worstResidual < 1e-6, 'both satisfy length constraint');
  assert.ok(jRes.joints.b.x < 0 && jRes.joints.b.y > 0, `joint flick reached quadrant II: ${JSON.stringify(jRes.joints.b)}`);
  assert.ok(bRes.joints.b.x < 0 && bRes.joints.b.y > 0, `body flick reached quadrant II (got ${JSON.stringify(bRes.joints.b)}, joint got ${JSON.stringify(jRes.joints.b)})`);
}

// 2. Large jump > MAX_DRAG_STEP (100) on a body drag: must walk the same sub-moves as a joint drag
{
  const doc = makeDoc({ a: [0, 0], b: [40, 0] }, [{ id: 'L1', type: 'line', joints: ['a', 'b'] }], [{ type: 'horizontal', joints: ['a', 'b'] }, D('a', 'b', 40, 'd1')]);
  const profile = await createProfile();
  await createNamedDesign(profile, 'sketchstudio', 'UX-23 SubMoves', doc);
  const app = await open({ host: 'sketchstudio', profile });
  try {
    const st = app.state;
    app.tool('select');
    const r = app.svg.getBoundingClientRect();
    Object.assign(st.view, { x: 140, y: 0, w: 400 });
    st.view.h = st.view.w / (r.width / r.height);
    app.svg.setAttribute('viewBox', `${st.view.x - st.view.w / 2} ${st.view.y - st.view.h / 2} ${st.view.w} ${st.view.h}`);
    app.frames();
    const a = app.toScreen(20, 0), b = app.toScreen(270, 0); // 250 mm > MAX_DRAG_STEP (100) -> 3 sub-moves
    const solveIters = [];
    const origSolve = app.engine.solve.bind(app.engine);
    app.engine.solve = (iters, opts) => {
      if (opts && opts.dragTarget && opts.dragTarget.body) solveIters.push(iters);
      return origSolve(iters, opts);
    };
    quiet(() => {
      app.move(a.x, a.y);
      app.down(a.x, a.y);
      assert.ok(st.drag && st.drag.body, 'body drag started');
      app.move(b.x, b.y, { buttons: 1 });
      app.up(b.x, b.y);
      app.frames(2);
    });
    assert.strictEqual(solveIters.length, 3, `250mm body flick walked 3 sub-moves, got ${JSON.stringify(solveIters)}`);
    assert.deepStrictEqual(solveIters.slice(0, 2), [500, 500], `intermediate body sub-moves solved to convergence: ${JSON.stringify(solveIters)}`);
    assert.ok(Math.abs(st.joints.get('a').x - 250) < 2 && Math.abs(st.joints.get('b').x - 290) < 2, `line arrived at cursor: a=${st.joints.get('a').x}, b=${st.joints.get('b').x}`);
  } finally {
    await app.close();
  }
}

// 3. Curved 1-DOF large flick > MAX_DRAG_STEP (100): L = 140 mm, body (70,0)->(-70,10) does not stall at 8 deg
{
  const doc = makeDoc({ a: [0, 0, true], b: [140, 0] }, [{ id: 'L1', type: 'line', joints: ['a', 'b'] }], [D('a', 'b', 140, 'd1')]);
  const bRes = await runFlick(doc, { x: 70, y: 0 }, { x: -70, y: 10 }, 500);
  assert.strictEqual(bRes.wasBody, true, 'large curved body flick used body drag');
  assert.ok(bRes.worstResidual < 1e-6, 'large curved body flick satisfies length constraint');
  assert.ok(bRes.joints.b.y > 90 && bRes.joints.b.x < 110, `large curved body flick swung well past tangent stall (got ${JSON.stringify(bRes.joints.b)})`);
}

console.log('drag-body-flick-ux23-1011-node: ok');
