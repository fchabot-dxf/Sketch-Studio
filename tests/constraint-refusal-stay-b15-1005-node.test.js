// tests/constraint-refusal-stay-b15-1005-node.test.js — TASK 1005 (B-15):
// Every constraint tool stays active after a refused / invalid pick across SketchStudio, Shaper and Pen Plotter,
// and still shows its refusal message (owner ruling turn 3741).
import assert from 'node:assert';
import { open, createProfile, loadGlyphSheetFromDisk } from './helpers/node-app.js';
import { TOOL_MODES, CONSTRAINT_TOOLS } from '#core/constants.js';
import { setConstraintNotifier } from '#core/constraint-manager.js';
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
  return { id, a, b, mid: [(x1 + x2) / 2, (y1 + y2) / 2] };
}
function addCircle(app, cx, cy, r) {
  const st = app.state;
  const c = st.genJ();
  st.joints.set(c, { x: cx, y: cy, fixed: false, sketchId: st.activeSketchId });
  const id = 'C_' + c;
  st.shapes.push({ id, type: 'circle', joints: [c], radius: r, sketchId: st.activeSketchId });
  app.frames(2);
  return { id, c, rim: [cx, cy - r] }; // TASK 1020: the top of the rim (its right end sat on Shaper's X axis, which Parallel / Perpendicular / Collinear now take there)
}

let checks = 0;
for (const host of HOSTS) {
  const profile = await createProfile();
  const app = await open({ host, profile });
  setConstraintNotifier(showNotification);
  try {
    const cx = host === 'penplotter' ? 100 : 0;
    const cy = host === 'penplotter' ? 100 : (host === 'shaper' ? 10 : 0);
    const scale = host === 'penplotter' ? 20 : (host === 'shaper' ? 10 : 2);
    const l1 = addLine(app, cx - 2 * scale, cy + scale, cx + 2 * scale, cy + scale);
    const l2 = addLine(app, cx - 2 * scale, cy + 2.5 * scale, cx + 2 * scale, cy + 2.5 * scale);
    const c1 = addCircle(app, cx + 4 * scale, cy - scale, scale);

    // Invalid pick for each of the 9 constraint tools
    const cases = [
      { tool: TOOL_MODES.PARALLEL, clicks: [c1.rim] },
      { tool: TOOL_MODES.PERPENDICULAR, clicks: [c1.rim] },
      { tool: TOOL_MODES.COLLINEAR, clicks: [c1.rim] },
      { tool: TOOL_MODES.HORIZONTAL_VERTICAL, clicks: [c1.rim] },
      { tool: TOOL_MODES.MIDPOINT, clicks: [c1.rim] },
      { tool: TOOL_MODES.SYMMETRIC, clicks: [[cx - 2 * scale, cy + scale], l2.mid] }, // point then line -> wrong family
      { tool: TOOL_MODES.COINCIDENT, clicks: [l1.mid, l2.mid] }, // line + line
      { tool: TOOL_MODES.TANGENT, clicks: [l1.mid, l2.mid] },    // line + line
      { tool: TOOL_MODES.EQUAL, clicks: [l1.mid, c1.rim] },      // line + circle
    ];
    assert.deepStrictEqual(cases.map((c) => c.tool).sort(), [...CONSTRAINT_TOOLS].sort(), 'covers all 9 constraint tools');

    for (const tc of cases) {
      app.esc();
      app.tool(tc.tool);
      assert.strictEqual(app.state.currentTool, tc.tool, `${host}/${tc.tool}: tool activated`);
      clearToasts(app.document);
      for (const [x, y] of tc.clicks) clickW(app, x, y);
      const msgs = toasts(app.document);
      assert.ok(msgs.length >= 1, `${host}/${tc.tool}: refusal notice shown`);
      assert.strictEqual(app.state.currentTool, tc.tool, `${host}/${tc.tool}: stays active after refusal (got ${app.state.currentTool})`);
      checks++;
    }
  } finally {
    await app.close();
  }
}

console.log(`constraint-refusal-stay-b15-1005-node: ${checks} checks passed`);
