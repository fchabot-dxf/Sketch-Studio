// tests/trim-mirror-r203-1018-node.test.js -- TASK 1018, audit R2-03: Trim keeps a mirrored pair of lines mirrored.
// Mirror ties a copy to its original by its two END pairs (point symmetric, Fusion's). Trimming the tails of both lines at a cutter removed the
// tail ends and their pair, so the copy was free to turn: moving the original moved one side only. Trim now keeps the mirror as the LINE form
// (the infinite lines mirror; each line keeps its own cut on the cutter).
import assert from 'node:assert';
import { open, createProfile, createNamedDesign } from './helpers/node-app.js';

const docOf = (joints, shapes, constraints) => ({
  version: 3, hosts: {},
  geometry: {
    joints: [['j_origin', { x: 0, y: 0, fixed: true, sketchId: 'sketch-1' }], ...joints.map(([id, j]) => [id, { fixed: false, sketchId: 'sketch-1', ...j }])],
    shapes: shapes.map((s) => ({ sketchId: 'sketch-1', ...s })),
    constraints, parameters: [],
    sketches: [{ id: 'sketch-1', name: 'Sketch 1', visible: true }],
    activeSketchId: 'sketch-1', groups: [], profiles: [],
  },
});

const profile = await createProfile();
await createNamedDesign(profile, 'sketchstudio', 'R2-03 mirror trim', docOf(
  [['m1', { x: 0, y: -60, fixed: true }], ['m2', { x: 0, y: 60, fixed: true }],
    ['aR', { x: 10, y: 5 }], ['bR', { x: 46, y: 27 }], ['aL', { x: -10, y: 5 }], ['bL', { x: -46, y: 27 }],
    ['k1', { x: -60, y: 22, fixed: true }], ['k2', { x: 60, y: 22, fixed: true }]],
  [{ id: 'CL', type: 'line', joints: ['m1', 'm2'], isConstruction: true },
    { id: 'GR', type: 'line', joints: ['aR', 'bR'] }, { id: 'GL', type: 'line', joints: ['aL', 'bL'] },
    { id: 'K', type: 'line', joints: ['k1', 'k2'] }],
  [{ type: 'symmetric', joints: ['aR', 'aL'], line: 'CL' }, { type: 'symmetric', joints: ['bR', 'bL'], line: 'CL' }],
));
const app = await open({ host: 'sketchstudio', profile });
const S = () => app.state;
const J = (id) => S().joints.get(id);
const shape = (id) => S().shapes.find((s) => s.id === id);
const clickW = (x, y) => { const p = app.toScreen(x, y); app.click(p.x, p.y); };

try {
  app.tool('trim');
  clickW(42, 24.56);  // GR's tail, past the cutter K (y = 22)
  clickW(-42, 24.56); // GL's tail
  app.tool('select');
  const gr = shape('GR'), gl = shape('GL');
  const mR = J(gr.joints[1]), mL = J(gl.joints[1]);
  assert.ok(Math.abs(mR.y - 22) < 1e-6 && Math.abs(mL.y - 22) < 1e-6, 'both lines end on the cutter');
  assert.ok(S().constraints.some((c) => c.type === 'symmetric' && c.line === 'CL' && Array.isArray(c.shapes) && c.shapes.includes('GR') && c.shapes.includes('GL')),
    'the removed ends\' mirror pair became the two lines\' mirror (line form)');
  assert.ok(S().constraints.some((c) => c.type === 'symmetric' && c.joints && c.joints.includes('aR') && c.joints.includes('aL')), 'the kept ends stay mirrored');

  // Move the original's kept end: the copy follows as its mirror image, both cut ends stay on the cutter
  app.drag(app.toScreen(10, 5), app.toScreen(16, 2), 12);
  const aR = J('aR'), aL = J('aL'), mR2 = J(gr.joints[1]), mL2 = J(gl.joints[1]);
  assert.ok(Math.hypot(aR.x - 10, aR.y - 5) > 1, `the original's end moved (got ${JSON.stringify(aR)})`);
  assert.ok(Math.abs(aL.x + aR.x) < 1e-3 && Math.abs(aL.y - aR.y) < 1e-3, 'the copy\'s kept end mirrors it');
  const angR = Math.atan2(mR2.y - aR.y, mR2.x - aR.x), angL = Math.atan2(mL2.y - aL.y, mL2.x - aL.x);
  assert.ok(Math.abs(angL - (Math.PI - angR)) < 1e-3, `the copy turns with the original: angR=${(angR * 180 / Math.PI).toFixed(3)} angL=${(angL * 180 / Math.PI).toFixed(3)} (expected ${(180 - angR * 180 / Math.PI).toFixed(3)})`);
  assert.ok(Math.abs(mR2.y - 22) < 1e-6 && Math.abs(mL2.y - 22) < 1e-6 && Math.abs(mL2.x + mR2.x) < 1e-3, 'the cut ends stay on the cutter, mirrored');
  console.log('trim-mirror-r203-1018-node: ok');
} finally {
  await app.close();
}
