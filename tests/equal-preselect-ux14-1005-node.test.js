// tests/equal-preselect-ux14-1005-node.test.js — TASK 1005 (UX-14 / B-14a):
// Equal ribbon button and E shortcut both run through the ONE activation path:
// 2 valid preselected shapes -> apply Equal immediately & stay in Equal;
// 2 invalid preselected shapes (line + circle) -> same plain refusal & stay in Equal.
import assert from 'node:assert';
import { open, createProfile, loadGlyphSheetFromDisk } from './helpers/node-app.js';
import { TOOL_MODES, CONSTRAINT_TYPES } from '#core/constants.js';
import { setConstraintNotifier } from '#core/constraint-manager.js';
import { showNotification } from '#ui/notification-manager.js';
import { EQUAL_SELECTION_REFUSAL } from '#ui/input-handlers/constraint-tools.js';

await loadGlyphSheetFromDisk();

const HOSTS = ['sketchstudio', 'shaper', 'penplotter'];
const toasts = (doc) => [...doc.querySelectorAll('#notification-container [data-level]')].map((el) => (el.querySelector('pre')?.textContent || el.textContent || '').trim());
const clearToasts = (doc) => { const c = doc.getElementById('notification-container'); if (c) c.innerHTML = ''; };

function addLine(app, x1, y1, x2, y2) {
  const st = app.state;
  const a = st.genJ(), b = st.genJ();
  st.joints.set(a, { x: x1, y: y1, fixed: false, sketchId: st.activeSketchId });
  st.joints.set(b, { x: x2, y: y2, fixed: false, sketchId: st.activeSketchId });
  const id = 'L_' + a + '_' + b;
  st.shapes.push({ id, type: 'line', joints: [a, b], sketchId: st.activeSketchId });
  app.frames(2);
  return id;
}
function addCircle(app, cx, cy, r) {
  const st = app.state;
  const c = st.genJ();
  st.joints.set(c, { x: cx, y: cy, fixed: false, sketchId: st.activeSketchId });
  const id = 'C_' + c;
  st.shapes.push({ id, type: 'circle', joints: [c], radius: r, sketchId: st.activeSketchId });
  app.frames(2);
  return id;
}

let checks = 0;
for (const host of HOSTS) {
  const profile = await createProfile();
  const app = await open({ host, profile });
  setConstraintNotifier(showNotification);
  try {
    const l1 = addLine(app, 0, 10, 20, 10);
    const l2 = addLine(app, 0, 20, 35, 20);
    const l3 = addLine(app, 0, 30, 50, 30);
    const c1 = addCircle(app, 60, 10, 10);

    // 1. Preselect 2 lines -> Equal RIBBON button applies Equal immediately & stays in Equal
    app.esc();
    app.state.selectedShapes.add(l1);
    app.state.selectedShapes.add(l2);
    clearToasts(app.document);
    app.document.getElementById('tool-equal').click();
    app.frames(1);
    assert.strictEqual(app.state.constraints.filter((c) => c.type === CONSTRAINT_TYPES.EQUAL).length, 1, `${host}: Equal ribbon button applied to 2 preselected lines`);
    assert.strictEqual(app.state.currentTool, TOOL_MODES.EQUAL, `${host}: Equal ribbon stays active`);
    checks++;

    // 2. Preselect 2 lines -> E key gives the SAME result (applies Equal & stays in Equal)
    app.esc();
    app.state.selectedShapes.add(l2);
    app.state.selectedShapes.add(l3);
    clearToasts(app.document);
    app.key('e');
    assert.strictEqual(app.state.constraints.filter((c) => c.type === CONSTRAINT_TYPES.EQUAL).length, 2, `${host}: E key applied to 2 preselected lines`);
    assert.strictEqual(app.state.currentTool, TOOL_MODES.EQUAL, `${host}: E key stays active in Equal`);
    checks++;

    // 3. Invalid 2-shape preselect (line + circle) -> ribbon button and E key show the SAME refusal & stay in Equal
    for (const via of ['ribbon', 'key']) {
      app.esc();
      app.state.selectedShapes.add(l1);
      app.state.selectedShapes.add(c1);
      clearToasts(app.document);
      if (via === 'ribbon') app.document.getElementById('tool-equal').click();
      else app.key('e');
      app.frames(1);
      const msgs = toasts(app.document);
      assert.strictEqual(msgs.length, 1, `${host}/${via}: invalid 2-shape preselect shows 1 refusal`);
      assert.ok(msgs[0].includes(EQUAL_SELECTION_REFUSAL), `${host}/${via}: exact Equal refusal text (got ${msgs[0]})`);
      assert.strictEqual(app.state.currentTool, TOOL_MODES.EQUAL, `${host}/${via}: stays active in Equal after refusal`);
      assert.strictEqual(app.state.constraints.filter((c) => c.type === CONSTRAINT_TYPES.EQUAL).length, 2, `${host}/${via}: no corrupt equal added`);
      checks++;
    }
  } finally {
    await app.close();
  }
}

console.log(`equal-preselect-ux14-1005-node: ${checks} checks passed`);
