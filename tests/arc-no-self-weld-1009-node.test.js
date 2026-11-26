// tests/arc-no-self-weld-1009-node.test.js -- TASK 1009 (UX-03): dragging an arc's own endpoint onto its opposite endpoint
// must NOT snap-weld them together with a coincident constraint. Control: dragging a separate line end onto an arc end still snaps.
import assert from 'node:assert';
import { open, createProfile, createNamedDesign } from './helpers/node-app.js';
import SettingsManager from '#core/settings-manager.js';
import { measureResidual } from '#core/constraint-verifier.js';

SettingsManager.set('GRID_MAGNETISM', 0.001, { persist: 'none' });

const quiet = (fn) => async (...a) => {
  const log = console.log, warn = console.warn;
  console.log = () => {}; console.warn = () => {};
  try { return await fn(...a); } finally { console.log = log; console.warn = warn; }
};

function design(joints, shapes, constraints = []) {
  return {
    version: 3, hosts: {},
    geometry: {
      joints: [
        ['j_origin', { x: 0, y: 0, fixed: true, sketchId: 'sketch-1' }],
        ...Object.entries(joints).map(([id, [x, y, fixed]]) => [id, { x, y, fixed: !!fixed, sketchId: 'sketch-1' }]),
      ],
      shapes: shapes.map((s) => ({ sketchId: 'sketch-1', ...s })),
      constraints,
      sketches: [{ id: 'sketch-1', name: 'Sketch 1', visible: true }],
      activeSketchId: 'sketch-1',
      groups: [], profiles: [], parameters: [],
    },
  };
}

async function openDesign(doc, centre = { x: 0, y: 0 }, w = 200) {
  const profile = await createProfile();
  await createNamedDesign(profile, 'sketchstudio', 'UX-03', doc);
  const app = await open({ host: 'sketchstudio', profile });
  const st = app.state;
  app.tool('select');
  const r = app.svg.getBoundingClientRect();
  Object.assign(st.view, { x: centre.x, y: centre.y, w });
  st.view.h = st.view.w / (r.width / r.height);
  app.svg.setAttribute('viewBox', `${st.view.x - st.view.w / 2} ${st.view.y - st.view.h / 2} ${st.view.w} ${st.view.h}`);
  app.frames();
  return app;
}

const pos = (st, id) => { const j = st.joints.get(id); return { x: j.x, y: j.y }; };
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const drag = quiet(async (app, from, waypoints, steps = 20, onStep = () => {}) => {
  const a = app.toScreen(from.x, from.y);
  app.move(a.x, a.y);
  app.down(a.x, a.y);
  assert.ok(app.state.drag, 'drag started');
  let cur = a;
  for (const wpt of waypoints) {
    const b = app.toScreen(wpt.x, wpt.y);
    for (let k = 1; k <= steps; k++) {
      const mx = cur.x + (b.x - cur.x) * k / steps;
      const my = cur.y + (b.y - cur.y) * k / steps;
      app.move(mx, my, { buttons: 1 });
      onStep(app.state);
    }
    cur = b;
  }
  app.up(cur.x, cur.y);
  assert.ok(!app.state.drag, 'drag ended');
});

const coincidents = (st) => st.constraints.filter((c) => c && c.type === 'coincident');

// 1. DR4.1 repro: arc c(0,0) s(40,0) e(0,40); drag e around past s(40,0)
{
  const app = await openDesign(design(
    { c: [0, 0, true], s: [40, 0, true], e: [0, 40, false] },
    [{ id: 'A1', type: 'arc', subType: 'CENTER', joints: ['c', 's', 'e'], sweep: true }],
    [{ type: 'equal', joints: ['c', 's', 'c', 'e'] }],
  ));
  try {
    const snapsOffered = [];
    await drag(app, pos(app.state, 'e'), [
      { x: -40, y: 0 }, { x: 0, y: -40 }, { x: 39.8, y: -3 }, { x: 40, y: 0 }, { x: 39.8, y: 3 },
    ], 20, (st) => {
      if (st.activeSnap && st.activeSnap.type === 'joint') snapsOffered.push(st.activeSnap.targetId);
    });
    const coinc = coincidents(app.state);
    assert.strictEqual(coinc.length, 0, `dragging arc end past own start must not add coincident (got ${JSON.stringify(coinc.map((c) => c.joints))})`);
    assert.ok(!snapsOffered.includes('s'), `must not offer snap onto arc own start s (offered: ${JSON.stringify(snapsOffered)})`);
    assert.ok(dist(pos(app.state, 'e'), pos(app.state, 's')) > 1, 'arc end did not stay welded onto start');
    for (const c of app.state.constraints) {
      if (!c || c.driven || c.type === 'mouse_spring') continue;
      assert.ok(measureResidual(c, app.state.joints, app.state.shapes) < 1e-6);
    }
    console.log('1 DR4.1 arc end drag past start: coincidents=0, dist(e,s)=', dist(pos(app.state, 'e'), pos(app.state, 's')).toFixed(3));
  } finally {
    await app.close();
  }
}

// 2. Arc whose start is coincident with j_origin: dragging end over origin / s must not snap to s or j_origin
{
  const app = await openDesign(design(
    { c: [40, 0, true], s: [0, 0, false], e: [80, 0, false] },
    [{ id: 'A1', type: 'arc', subType: 'CENTER', joints: ['c', 's', 'e'], sweep: true }],
    [{ type: 'coincident', joints: ['s', 'j_origin'] }, { type: 'equal', joints: ['c', 's', 'c', 'e'] }],
  ), { x: 40, y: 0 }, 220);
  try {
    const n0 = coincidents(app.state).length;
    await drag(app, pos(app.state, 'e'), [{ x: 40, y: 40 }, { x: 0.2, y: 2 }, { x: 0, y: 0 }, { x: 0.2, y: -2 }]);
    const coinc = coincidents(app.state);
    assert.strictEqual(coinc.length, n0, `origin-coincident arc end must not self-weld via j_origin (got ${JSON.stringify(coinc.map((c) => c.joints))})`);
    assert.ok(dist(pos(app.state, 'e'), pos(app.state, 's')) > 1, 'arc end stayed past origin');
    console.log('2 origin-coincident arc start: no self-weld, dist(e,s)=', dist(pos(app.state, 'e'), pos(app.state, 's')).toFixed(3));
  } finally {
    await app.close();
  }
}

// 3. Control: dragging an UNRELATED free line end onto the arc's start s STILL snaps and adds coincident
{
  const app = await openDesign(design(
    { c: [0, 0, true], s: [40, 0, true], e: [0, 40, false], la: [65, 25, true], lb: [55, 5, false] },
    [
      { id: 'A1', type: 'arc', subType: 'CENTER', joints: ['c', 's', 'e'], sweep: true },
      { id: 'L1', type: 'line', joints: ['la', 'lb'] },
    ],
    [{ type: 'equal', joints: ['c', 's', 'c', 'e'] }],
  ));
  try {
    await drag(app, pos(app.state, 'lb'), [{ x: 40, y: 0 }], 15);
    const coinc = coincidents(app.state);
    assert.strictEqual(coinc.length, 1, `control: separate line end snaps onto arc start (got ${coinc.length} coincidents)`);
    assert.ok(dist(pos(app.state, 'lb'), pos(app.state, 's')) < 1e-6, 'control: lb welded to s');
    console.log('3 control separate line end snaps cleanly onto arc start');
  } finally {
    await app.close();
  }
}

console.log('arc-no-self-weld-1009-node.test.js PASSED');
