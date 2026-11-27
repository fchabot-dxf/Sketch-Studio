// tests/trim-break-curve-refusal-ux25-node.test.js -- UX-25 (TASK 1007):
// Trim and Break on a curve they cannot cut emit a plain warning notice, leave shapes/history untouched, and keep the active tool.
// TASK 1018 (R1-12, owner ruling): Trim and Break now TAKE arcs and circles (tests/trim-break-curves-r112-1018-node.test.js), so only the
// Bezier refuses; a press on the arc and the circle here must not show the old refusal.
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
    B1: [205, 18.75],
  };
  for (const tool of ['trim', 'break']) {
    for (const [wx, wy] of [[140 + 20 * Math.SQRT1_2, 20 * Math.SQRT1_2], [98, 0]]) {
      app.tool(tool);
      clearToasts();
      const sp = app.toScreen(wx, wy);
      app.click(sp.x, sp.y);
      assert.ok(!toasts().some((m) => /not available on an? (arc|circle)/.test(m)), `${tool} takes an arc / a circle: no refusal (got ${JSON.stringify(toasts())})`);
      app.undo();
    }
  }

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
