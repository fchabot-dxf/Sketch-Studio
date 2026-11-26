// tests/drag-arc-centre-coincident-ux09-1011-node.test.js -- TASK 1011 (UX-09):
// When an arc centre is coincident with a line endpoint, dragging the coincident point must translate
// the arc rigidly (keeping its radius, matching Fusion task 584) regardless of joint Map / z-order.
import assert from 'node:assert';
import { open, createProfile, createNamedDesign } from './helpers/node-app.js';
import SettingsManager from '#core/settings-manager.js';
import { measureResidual } from '#core/constraint-verifier.js';

SettingsManager.set('GRID_MAGNETISM', 0.001, { persist: 'none' });

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const quiet = (fn) => {
  const l = console.log, w = console.warn;
  console.log = () => {}; console.warn = () => {};
  try { return fn(); } finally { console.log = l; console.warn = w; }
};

function makeDoc(cFirst, sFixed = false) {
  const arcJoints = [
    ['c', { x: 20, y: 20, fixed: false, sketchId: 'sketch-1' }],
    ['s', { x: 50, y: 20, fixed: sFixed, sketchId: 'sketch-1' }],
    ['e', { x: 20, y: 50, fixed: false, sketchId: 'sketch-1' }],
  ];
  const lineJoints = [
    ['p', { x: 20, y: 20, fixed: false, sketchId: 'sketch-1' }],
    ['q', { x: -10, y: 20, fixed: false, sketchId: 'sketch-1' }],
  ];
  const arcShape = { id: 'A1', type: 'arc', joints: ['c', 's', 'e'], sweep: true, sketchId: 'sketch-1' };
  const lineShape = { id: 'L1', type: 'line', joints: ['p', 'q'], sketchId: 'sketch-1' };
  return {
    version: 3, hosts: {},
    geometry: {
      joints: [['j_origin', { x: 0, y: 0, fixed: true, sketchId: 'sketch-1' }], ...(cFirst ? [...arcJoints, ...lineJoints] : [...lineJoints, ...arcJoints])],
      shapes: cFirst ? [arcShape, lineShape] : [lineShape, arcShape],
      constraints: [
        { type: 'equal', joints: ['c', 's', 'c', 'e'] },
        { type: 'coincident', joints: cFirst ? ['c', 'p'] : ['p', 'c'] },
      ],
      sketches: [{ id: 'sketch-1', name: 'Sketch 1', visible: true }],
      activeSketchId: 'sketch-1', groups: [], profiles: [], parameters: [],
    },
  };
}

async function runCase(cFirst, sFixed = false) {
  const profile = await createProfile();
  await createNamedDesign(profile, 'sketchstudio', `UX-09 cFirst=${cFirst}`, makeDoc(cFirst, sFixed));
  const app = await open({ host: 'sketchstudio', profile });
  try {
    const st = app.state;
    app.tool('select');
    const r = app.svg.getBoundingClientRect();
    Object.assign(st.view, { x: 20, y: 20, w: 240 });
    st.view.h = st.view.w / (r.width / r.height);
    app.svg.setAttribute('viewBox', `${st.view.x - st.view.w / 2} ${st.view.y - st.view.h / 2} ${st.view.w} ${st.view.h}`);
    app.frames();
    const a = app.toScreen(20, 20), b = app.toScreen(40, 40);
    let grabbedId = null;
    quiet(() => {
      app.move(a.x, a.y);
      app.down(a.x, a.y);
      grabbedId = st.drag && st.drag.id;
      for (let k = 1; k <= 15; k++) app.move(a.x + (b.x - a.x) * k / 15, a.y + (b.y - a.y) * k / 15, { buttons: 1 });
      app.up(b.x, b.y);
      app.frames(2);
    });
    const P = (id) => ({ x: st.joints.get(id).x, y: st.joints.get(id).y });
    const c = P('c'), s = P('s'), e = P('e'), p = P('p');
    const worstResidual = Math.max(0, ...st.constraints.map(k => measureResidual(k, st.joints, st.shapes)));
    return { grabbedId, c, s, e, p, rS: dist(c, s), rE: dist(c, e), worstResidual };
  } finally {
    await app.close();
  }
}

// 1. Both Map orders must translate the arc rigidly (radius stays 30) and produce the same geometry
const o1 = await runCase(true);
const o2 = await runCase(false);
assert.notStrictEqual(o1.grabbedId, o2.grabbedId, `two orders hit different coincident joints (${o1.grabbedId} vs ${o2.grabbedId})`);
for (const [tag, res] of [['cFirst=true', o1], ['cFirst=false', o2]]) {
  assert.ok(Math.abs(res.rS - 30) < 1e-3 && Math.abs(res.rE - 30) < 1e-3, `${tag}: radius kept at 30 (got rS=${res.rS.toFixed(4)}, rE=${res.rE.toFixed(4)})`);
  assert.ok(dist(res.c, { x: 40, y: 40 }) < 1 && dist(res.s, { x: 70, y: 40 }) < 1 && dist(res.e, { x: 40, y: 70 }) < 1, `${tag}: arc translated rigidly (c=${JSON.stringify(res.c)}, s=${JSON.stringify(res.s)}, e=${JSON.stringify(res.e)})`);
  assert.ok(dist(res.c, res.p) < 1e-6, `${tag}: line end stays coincident with arc centre`);
  assert.ok(res.worstResidual < 1e-6, `${tag}: all constraints hold`);
}
assert.ok(dist(o1.s, o2.s) < 1e-3 && dist(o1.e, o2.e) < 1e-3, `both orders match identically (s diff ${dist(o1.s, o2.s)}, e diff ${dist(o1.e, o2.e)})`);

// 2. Held-rim pivot case (task 582): when rim 's' is fixed, grabbing coincident 'p' still pivots keeping radius 30
const p1 = await runCase(true, true);
const p2 = await runCase(false, true);
for (const [tag, res] of [['pivot cFirst=true', p1], ['pivot cFirst=false', p2]]) {
  assert.ok(Math.abs(res.rS - 30) < 1e-3 && Math.abs(res.rE - 30) < 1e-3, `${tag}: pivot keeps radius 30 (got ${res.rS.toFixed(4)})`);
  assert.ok(dist(res.s, { x: 50, y: 20 }) < 1e-9, `${tag}: fixed rim stayed`);
  assert.ok(res.worstResidual < 1e-6, `${tag}: all constraints hold`);
}

console.log('drag-arc-centre-coincident-ux09-1011-node: ok');
