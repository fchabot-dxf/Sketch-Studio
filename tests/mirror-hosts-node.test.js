// tests/mirror-hosts-node.test.js - TASK 585: the Mirror tool is part of the ONE shared Design tab: the same ribbon button and the same flow in the
// hosts that mount the canvas through #ui/sketch-canvas.js (Shaper, Pen Plotter), through the node kit (tests/helpers/node-app.js). Their tool switch
// is the shared switchToTool (SketchStudio's is its own handleToolActivate: tests/mirror-fusion-node.test.js). A stored line is restored, then: the
// ribbon's Mirror, click the line, Enter, click the Y axis, Enter -> its mirror image, one symmetric link per end, one undo step.
import assert from 'node:assert';
import * as L from './harness/audit/lib.js';
import { serializeDocument } from '#core/document.js';
import { open, createProfile, createNamedDesign } from './helpers/node-app.js';

const S = L.newSketch();
const a = L.point(S, 20, 10), b = L.point(S, 60, 40);
const LINE = L.line(S, a, b);
const DOC = serializeDocument(S.state);

for (const host of ['shaper', 'penplotter']) {
  const profile = await createProfile();
  await createNamedDesign(profile, host, 'Mirror 585 ' + host, DOC);
  const app = await open({ host, profile });
  try {
    const st = app.state, at = (x, y) => app.toScreen(x, y), click = (p) => app.click(p.x, p.y);
    const btn = app.document.getElementById('tool-mirror');
    assert.ok(btn && btn.closest('.sk-ribbon-group').querySelector('.sk-ribbon-group-label').textContent === 'Create', `${host}: Mirror in the ribbon's Create group`);
    assert.strictEqual(st.shapes.length, 1, `${host}: the stored line is restored`);
    const h0 = st.history.length;
    app.tool('mirror');
    assert.strictEqual(st.mirror && st.mirror.step, 'objects', `${host}: the tool starts at the OBJECTS step`);
    click(at(40, 25));
    assert.ok(st.selectedShapes.has(LINE), `${host}: the click selects the line`);
    app.enter();
    click(at(0, 25));
    assert.strictEqual(st.mirror.line, 'ref_axis_y', `${host}: the Y axis picked`);
    app.enter();
    const c = st.shapes[1];
    const P = (id) => st.joints.get(id);
    assert.ok(c && c.type === 'line' && Math.abs(P(c.joints[0]).x + P(a).x) < 1e-9 && Math.abs(P(c.joints[0]).y - P(a).y) < 1e-9
      && Math.abs(P(c.joints[1]).x + P(b).x) < 1e-9 && Math.abs(P(c.joints[1]).y - P(b).y) < 1e-9, `${host}: the mirror image about the Y axis`);
    const sym = st.constraints.filter((k) => k.type === 'symmetric');
    assert.ok(sym.length === 2 && sym.every((k) => k.line === 'ref_axis_y' && k.joints), `${host}: two point links about the Y axis`);
    assert.ok(st.history.length === h0 + 1 && st.currentTool === 'select', `${host}: one undo step, the tool ends`);
    app.undo();
    assert.ok(st.shapes.length === 1 && !st.constraints.some((k) => k.type === 'symmetric'), `${host}: Ctrl+Z removes the whole mirror`);
    console.log(`mirror-hosts-node: ${host} ok`);
  } finally {
    await app.close();
  }
}
