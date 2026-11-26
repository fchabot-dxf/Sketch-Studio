// tests/drag-mirror-line-stay-ux10-1011-node.test.js -- TASK 1011 (UX-10 / B-12d):
// Dragging mirrored geometry must NOT rotate or translate a FREE mirror line (Fusion: mirror line stays unless
// dragged itself). Dragging the mirror line itself (by its endpoint or body) still moves it freely while keeping symmetry.
import assert from 'node:assert';
import { open, createProfile, createNamedDesign } from './helpers/node-app.js';
import SettingsManager from '#core/settings-manager.js';
import { mirrorObjects } from '#core/mirror.js';
import { mirrorPoint } from '#core/symmetric.js';
import { measureResidual } from '#core/constraint-verifier.js';

SettingsManager.set('GRID_MAGNETISM', 0.001, { persist: 'none' });

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const quiet = (fn) => {
  const l = console.log, w = console.warn;
  console.log = () => {}; console.warn = () => {};
  try { return fn(); } finally { console.log = l; console.warn = w; }
};

const DOC = {
  version: 3, hosts: {},
  geometry: {
    joints: [
      ['j_origin', { x: 0, y: 0, fixed: true, sketchId: 'sketch-1' }],
      ['m1', { x: 0, y: -50, fixed: false, sketchId: 'sketch-1' }],
      ['m2', { x: 0, y: 50, fixed: false, sketchId: 'sketch-1' }],
      ['a', { x: 30, y: 10, fixed: false, sketchId: 'sketch-1' }],
      ['b', { x: 50, y: 30, fixed: false, sketchId: 'sketch-1' }],
      ['c1', { x: 40, y: -25, fixed: false, sketchId: 'sketch-1' }],
    ],
    shapes: [
      { id: 'ML', type: 'line', joints: ['m1', 'm2'], isConstruction: true, sketchId: 'sketch-1' },
      { id: 'L1', type: 'line', joints: ['a', 'b'], sketchId: 'sketch-1' },
      { id: 'C1', type: 'circle', joints: ['c1'], radius: 10, sketchId: 'sketch-1' },
    ],
    constraints: [],
    sketches: [{ id: 'sketch-1', name: 'Sketch 1', visible: true }],
    activeSketchId: 'sketch-1', groups: [], profiles: [], parameters: [],
  },
};

const profile = await createProfile();
await createNamedDesign(profile, 'sketchstudio', 'UX-10 Mirror Line Stay', DOC);
const app = await open({ host: 'sketchstudio', profile });
try {
  const st = app.state;
  const res = mirrorObjects(st, { shapes: ['L1', 'C1'], joints: [] }, 'ML');
  assert.ok(res.ok, 'mirror created');
  const copyL = st.shapes.find(s => s.id === res.shapes[0]);
  const copyC = st.shapes.find(s => s.id === res.shapes[1]);
  app.tool('select');
  const r = app.svg.getBoundingClientRect();
  Object.assign(st.view, { x: 0, y: 0, w: 240 });
  st.view.h = st.view.w / (r.width / r.height);
  app.svg.setAttribute('viewBox', `${st.view.x - st.view.w / 2} ${st.view.y - st.view.h / 2} ${st.view.w} ${st.view.h}`);
  app.frames();

  const P = (id) => ({ x: st.joints.get(id).x, y: st.joints.get(id).y });
  const dragW = (from, to, steps = 15) => quiet(() => {
    const a = app.toScreen(from.x, from.y), b = app.toScreen(to.x, to.y);
    app.drag(a, b, steps);
  });
  const worstResidual = () => Math.max(0, ...st.constraints.filter(c => !c.isDriven && !c.driven).map(c => measureResidual(c, st.joints, st.shapes)));

  // 1. DR4.3b: drag mirrored line endpoint a (30,10) -> (40,35): free mirror line ML MUST NOT move
  dragW(P('a'), { x: 40, y: 35 });
  assert.ok(dist(P('m1'), { x: 0, y: -50 }) < 1e-9 && dist(P('m2'), { x: 0, y: 50 }) < 1e-9, `1. joint drag: mirror line stayed (m1=${JSON.stringify(P('m1'))}, m2=${JSON.stringify(P('m2'))})`);
  assert.ok(dist(P('a'), { x: 40, y: 35 }) < 1, `1. joint a followed cursor: ${JSON.stringify(P('a'))}`);
  assert.ok(dist(P(copyL.joints[0]), mirrorPoint(P('a'), P('m1'), P('m2'))) < 1e-5, '1. mirror copy follows a');
  assert.ok(worstResidual() < 1e-6, `1. residual ok (${worstResidual()})`);

  // 2. B-12d: drag a ACROSS the mirror line to (-40, 10): ML still stays at x=0
  dragW(P('a'), { x: -40, y: 10 });
  assert.ok(dist(P('m1'), { x: 0, y: -50 }) < 1e-9 && dist(P('m2'), { x: 0, y: 50 }) < 1e-9, `2. drag across mirror line: ML stayed (m1=${JSON.stringify(P('m1'))}, m2=${JSON.stringify(P('m2'))})`);
  assert.ok(dist(P('a'), { x: -40, y: 10 }) < 1 && dist(P(copyL.joints[0]), { x: 40, y: 10 }) < 1, `2. mirrored pair crossed cleanly (a=${JSON.stringify(P('a'))}, copy=${JSON.stringify(P(copyL.joints[0]))})`);
  assert.ok(worstResidual() < 1e-6, '2. residual ok');

  // 3. Body drag of mirrored line L1 AND circle C1 rim: ML still stays at x=0
  const midL1 = { x: (P('a').x + P('b').x) / 2, y: (P('a').y + P('b').y) / 2 };
  dragW(midL1, { x: midL1.x + 15, y: midL1.y - 10 });
  assert.ok(dist(P('m1'), { x: 0, y: -50 }) < 1e-9 && dist(P('m2'), { x: 0, y: 50 }) < 1e-9, `3a. body drag L1: ML stayed (m1=${JSON.stringify(P('m1'))}, m2=${JSON.stringify(P('m2'))})`);
  assert.ok(worstResidual() < 1e-6, '3a. residual ok');

  dragW({ x: 50, y: -25 }, { x: 56, y: -25 }); // C1 rim radius 10 -> 16
  assert.ok(dist(P('m1'), { x: 0, y: -50 }) < 1e-9 && dist(P('m2'), { x: 0, y: 50 }) < 1e-9, `3b. circle rim drag: ML stayed`);
  assert.ok(Math.abs(copyC.radius - 16) < 1, `3b. mirrored circle radius followed (${copyC.radius})`);
  assert.ok(worstResidual() < 1e-6, '3b. residual ok');

  // 4. Dragging the mirror line ML ITSELF (endpoint m2, then body) MUST still move ML freely while keeping symmetry!
  dragW(P('m2'), { x: 20, y: 50 });
  assert.ok(dist(P('m2'), { x: 20, y: 50 }) < 1, `4a. dragging ML endpoint moved ML (m2=${JSON.stringify(P('m2'))})`);
  assert.ok(dist(P(copyL.joints[0]), mirrorPoint(P('a'), P('m1'), P('m2'))) < 1e-5, '4a. mirrored geometry updated for tilted ML');
  assert.ok(worstResidual() < 1e-6, '4a. residual ok');

  const midML = { x: (P('m1').x + P('m2').x) / 2, y: (P('m1').y + P('m2').y) / 2 };
  const m1Before = P('m1');
  dragW(midML, { x: midML.x - 15, y: midML.y });
  assert.ok(dist(P('m1'), m1Before) > 5, `4b. dragging ML body moved ML (m1 ${JSON.stringify(m1Before)} -> ${JSON.stringify(P('m1'))})`);
  assert.ok(worstResidual() < 1e-6, '4b. residual ok');

  console.log('drag-mirror-line-stay-ux10-1011-node: ok');
} finally {
  await app.close();
}
