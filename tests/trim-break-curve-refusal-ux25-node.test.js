// tests/trim-break-curve-refusal-ux25-node.test.js -- UX-25 (TASK 1007):
// Trim and Break on an arc or circle emit a plain warning notice (matching Bezier), leave shapes/history untouched,
// and keep the active tool.
import assert from 'node:assert';
import { open, createProfile, createNamedDesign } from './helpers/node-app.js';

const doc = {
  version: 3, hosts: {},
  geometry: {
    joints: [
      ['j_origin', { x: 0, y: 0, fixed: true, sketchId: 'sketch-1' }],
      ['cc', { x: 80, y: 0, fixed: false, sketchId: 'sketch-1' }],
      ['ac', { x: 140, y: 0, fixed: false, sketchId: 'sketch-1' }],
      ['as', { x: 160, y: 0, fixed: false, sketchId: 'sketch-1' }],
      ['ae', { x: 140, y: 20, fixed: false, sketchId: 'sketch-1' }],
      ['ba', { x: 180, y: 0, fixed: false, sketchId: 'sketch-1' }],
      ['bb', { x: 230, y: 0, fixed: false, sketchId: 'sketch-1' }],
    ],
    shapes: [
      { id: 'C1', type: 'circle', joints: ['cc'], radius: 18, sketchId: 'sketch-1' },
      { id: 'A1', type: 'arc', joints: ['ac', 'as', 'ae'], sweep: true, sketchId: 'sketch-1' },
      { id: 'B1', type: 'bezier', joints: ['ba', 'bb'], c1: [195, 25], c2: [215, 25], sketchId: 'sketch-1' },
    ],
    constraints: [{ type: 'equal', joints: ['ac', 'as', 'ac', 'ae'] }],
    parameters: [],
    sketches: [{ id: 'sketch-1', name: 'Sketch 1', visible: true }],
    activeSketchId: 'sketch-1', groups: [], profiles: [],
  },
};

const profile = await createProfile();
await createNamedDesign(profile, 'sketchstudio', 'UX-25 Curve Refusals', doc);
const app = await open({ host: 'sketchstudio', profile });

const clearToasts = () => {
  const box = app.document.getElementById('notification-container');
  if (box) box.innerHTML = '';
};
const toasts = () => {
  const box = app.document.getElementById('notification-container');
  return box ? [...box.children].map((el) => el.textContent.trim()) : [];
};

try {
  const targets = {
    A1: [140 + 20 * Math.SQRT1_2, 20 * Math.SQRT1_2],
    C1: [98, 0],
    B1: [205, 18.75],
  };

  for (const tool of ['trim', 'break']) {
    const toolLabel = tool === 'trim' ? 'Trim' : 'Break';
    for (const [sid, [wx, wy]] of Object.entries(targets)) {
      app.tool(tool);
      clearToasts();
      const s0 = app.state.shapes.length;
      const h0 = app.state.history.length;
      const sp = app.toScreen(wx, wy);
      app.click(sp.x, sp.y);
      const msgs = toasts();
      assert.strictEqual(app.state.shapes.length, s0, `${tool} on ${sid}: shapes unchanged`);
      assert.strictEqual(app.state.history.length, h0, `${tool} on ${sid}: history unchanged`);
      assert.strictEqual(app.state.currentTool, tool, `${tool} on ${sid}: stays in tool`);
      assert.ok(msgs.some((m) => m.includes(toolLabel) && !/\[ERR-/.test(m)), `${tool} on ${sid}: plain notice emitted (got ${JSON.stringify(msgs)})`);
    }
  }
  console.log('trim-break-curve-refusal-ux25-node: ok');
} finally {
  await app.close();
}
