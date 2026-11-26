// tests/hv-dup-notice-b14c-1005-node.test.js — TASK 1005 (B-14c):
// Duplicate H/V via preselect + H key, preselect + H/V ribbon button, and H/V tool click all show the
// same "Sketch geometry over constrained" notice across SketchStudio, Shaper and Pen Plotter.
import assert from 'node:assert';
import { open, createProfile, loadGlyphSheetFromDisk } from './helpers/node-app.js';
import { TOOL_MODES, CONSTRAINT_TYPES } from '#core/constants.js';
import { setConstraintNotifier, OVER_CONSTRAINED_TEXT } from '#core/constraint-manager.js';
import { showNotification } from '#ui/notification-manager.js';

await loadGlyphSheetFromDisk();

const HOSTS = ['sketchstudio', 'shaper', 'penplotter'];
const toasts = (doc) => [...doc.querySelectorAll('#notification-container [data-level]')].map((el) => (el.querySelector('pre')?.textContent || el.textContent || '').trim());
const clearToasts = (doc) => { const c = doc.getElementById('notification-container'); if (c) c.innerHTML = ''; };

function clickW(app, x, y) {
  const p = app.toScreen(x, y);
  app.click(p.x, p.y);
}
function addLine(app, x1, y1, x2, y2) {
  const st = app.state;
  const a = st.genJ(), b = st.genJ();
  st.joints.set(a, { x: x1, y: y1, fixed: false, sketchId: st.activeSketchId });
  st.joints.set(b, { x: x2, y: y2, fixed: false, sketchId: st.activeSketchId });
  const id = 'L_' + a + '_' + b;
  st.shapes.push({ id, type: 'line', joints: [a, b], sketchId: st.activeSketchId });
  app.frames(2);
  return { id, a, b };
}

let checks = 0;
for (const host of HOSTS) {
  const profile = await createProfile();
  const app = await open({ host, profile });
  setConstraintNotifier(showNotification);
  try {
    const cx = host === 'penplotter' ? 100 : 0;
    const cy = host === 'penplotter' ? 100 : (host === 'shaper' ? 10 : 2);
    const sc = host === 'penplotter' ? 20 : (host === 'shaper' ? 10 : 2);
    const l1 = addLine(app, cx - 2 * sc, cy, cx + 2 * sc, cy + 0.3 * sc);

    // 1st apply: preselect + H/V ribbon makes it Horizontal
    app.esc();
    app.state.selectedShapes.add(l1.id);
    clearToasts(app.document);
    app.document.getElementById('tool-hv').click();
    app.frames(1);
    assert.strictEqual(app.state.constraints.filter((c) => c.type === CONSTRAINT_TYPES.HORIZONTAL).length, 1, `${host}: 1st H/V added`);
    assert.strictEqual(toasts(app.document).length, 0, `${host}: 1st H/V silent`);

    // 2a. Duplicate via preselect + H key
    app.esc();
    app.state.selectedShapes.add(l1.id);
    clearToasts(app.document);
    app.key('h');
    const keyMsgs = toasts(app.document);
    assert.ok(keyMsgs.some((m) => m.includes(OVER_CONSTRAINED_TEXT)), `${host}: duplicate H/V via H key tells over constrained (got ${JSON.stringify(keyMsgs)})`);
    assert.strictEqual(app.state.currentTool, TOOL_MODES.HORIZONTAL_VERTICAL, `${host}: H key keeps hv active`);
    checks++;

    // 2b. Duplicate via preselect + H/V ribbon
    app.esc();
    app.state.selectedShapes.add(l1.id);
    clearToasts(app.document);
    app.document.getElementById('tool-hv').click();
    app.frames(1);
    const btnMsgs = toasts(app.document);
    assert.ok(btnMsgs.some((m) => m.includes(OVER_CONSTRAINED_TEXT)), `${host}: duplicate H/V via ribbon tells over constrained (got ${JSON.stringify(btnMsgs)})`);
    assert.strictEqual(app.state.currentTool, TOOL_MODES.HORIZONTAL_VERTICAL, `${host}: H/V ribbon keeps hv active`);
    checks++;

    // 2c. Duplicate via H/V tool click matches the same notice
    app.esc();
    app.tool(TOOL_MODES.HORIZONTAL_VERTICAL);
    clearToasts(app.document);
    const ja = app.state.joints.get(l1.a), jb = app.state.joints.get(l1.b);
    clickW(app, (ja.x + jb.x) / 2, (ja.y + jb.y) / 2);
    const clickMsgs = toasts(app.document);
    assert.ok(clickMsgs.some((m) => m.includes(OVER_CONSTRAINED_TEXT)), `${host}: duplicate H/V via tool click tells over constrained`);
    checks++;
  } finally {
    await app.close();
  }
}

console.log(`hv-dup-notice-b14c-1005-node: ${checks} checks passed`);
