// tests/midpoint-own-end-b10-1005-node.test.js — TASK 1005 (B-10):
// Midpoint picked on a line's own endpoint OR an arc's own endpoint/centre:
// plain refusal, stays in Midpoint tool, pick buffer cleared, and next valid pick works immediately without Esc.
import assert from 'node:assert';
import { open, createProfile, loadGlyphSheetFromDisk } from './helpers/node-app.js';
import { TOOL_MODES, CONSTRAINT_TYPES } from '#core/constants.js';
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
  return { id, a, b, p1: [x1, y1], p2: [x2, y2], mid: [(x1 + x2) / 2, (y1 + y2) / 2] };
}
function addArc(app, cx, cy, r) {
  const st = app.state;
  const c = st.genJ(), s = st.genJ(), e = st.genJ();
  st.joints.set(c, { x: cx, y: cy, fixed: false, sketchId: st.activeSketchId });
  st.joints.set(s, { x: cx + r, y: cy, fixed: false, sketchId: st.activeSketchId });
  st.joints.set(e, { x: cx, y: cy + r, fixed: false, sketchId: st.activeSketchId });
  const id = 'A_' + c;
  st.shapes.push({ id, type: 'arc', subType: 'CENTER', joints: [c, s, e], sweep: true, sketchId: st.activeSketchId });
  app.frames(2);
  return { id, c, s, e, centerPt: [cx, cy], startPt: [cx + r, cy], arcPt: [cx + r * Math.SQRT1_2, cy + r * Math.SQRT1_2] };
}

let checks = 0;
for (const host of HOSTS) {
  const profile = await createProfile();
  const app = await open({ host, profile });
  setConstraintNotifier(showNotification);
  try {
    const cx = host === 'penplotter' ? 100 : 0;
    const cy = host === 'penplotter' ? 100 : (host === 'shaper' ? 10 : 0);
    const sc = host === 'penplotter' ? 18 : (host === 'shaper' ? 8 : 2);
    const l1 = addLine(app, cx - 2 * sc, cy + sc, cx + 2 * sc, cy + sc);
    const ext = addLine(app, cx - 2 * sc, cy + 3 * sc, cx, cy + 3 * sc);
    const arc = addArc(app, cx + 3 * sc, cy - sc, 1.5 * sc);

    // 1. Line then its own endpoint -> plain refusal, stays in midpoint, buffer cleared, next valid pick works without Esc
    app.esc();
    app.tool(TOOL_MODES.MIDPOINT);
    clearToasts(app.document);
    clickW(app, ...l1.mid);
    clickW(app, ...l1.p1);
    assert.strictEqual(app.state.currentTool, TOOL_MODES.MIDPOINT, `${host}: line+own-end stays in midpoint`);
    assert.ok(toasts(app.document).length >= 1, `${host}: line+own-end shows plain refusal (was silent)`);
    assert.ok(!app.state.pendingConstraint || !(app.state.pendingConstraint.selectionBuffer?.length), `${host}: line+own-end cleared pick buffer`);

    // Immediately pick external point + line WITHOUT pressing Esc -> must succeed (not wedged!)
    const midBefore = app.state.constraints.filter((c) => c.type === CONSTRAINT_TYPES.MIDPOINT).length;
    clickW(app, ...ext.p1);
    clickW(app, ...l1.mid);
    assert.strictEqual(app.state.constraints.filter((c) => c.type === CONSTRAINT_TYPES.MIDPOINT).length, midBefore + 1, `${host}: line midpoint works right after refusal (not wedged)`);
    assert.strictEqual(app.state.currentTool, TOOL_MODES.MIDPOINT, `${host}: still in midpoint after recovery`);
    checks++;

    // 2. Own endpoint then its own line (click quarter point on l1, away from ext.p1 which is now at l1's midpoint)
    app.esc();
    app.tool(TOOL_MODES.MIDPOINT);
    clearToasts(app.document);
    const l1a = app.state.joints.get(l1.a), l1b = app.state.joints.get(l1.b);
    clickW(app, l1b.x, l1b.y);
    clickW(app, l1a.x + (l1b.x - l1a.x) * 0.25, l1a.y + (l1b.y - l1a.y) * 0.25);
    assert.strictEqual(app.state.currentTool, TOOL_MODES.MIDPOINT, `${host}: own-end+line stays in midpoint`);
    assert.ok(toasts(app.document).length >= 1, `${host}: own-end+line shows plain refusal`);
    assert.ok(!app.state.pendingConstraint || !(app.state.pendingConstraint.selectionBuffer?.length), `${host}: own-end+line cleared pick buffer`);
    checks++;

    // 3. Arc then its own endpoint -> plain refusal, stays in midpoint, buffer cleared, next valid arc midpoint works
    app.esc();
    app.tool(TOOL_MODES.MIDPOINT);
    clearToasts(app.document);
    clickW(app, ...arc.arcPt);
    clickW(app, ...arc.startPt);
    assert.strictEqual(app.state.currentTool, TOOL_MODES.MIDPOINT, `${host}: arc+own-end stays in midpoint (did not exit to Select)`);
    assert.ok(toasts(app.document).length >= 1, `${host}: arc+own-end shows plain refusal`);
    assert.ok(!app.state.pendingConstraint || !(app.state.pendingConstraint.selectionBuffer?.length), `${host}: arc+own-end cleared pick buffer`);

    const midBeforeArc = app.state.constraints.filter((c) => c.type === CONSTRAINT_TYPES.MIDPOINT).length;
    clickW(app, ...ext.p2);
    clickW(app, ...arc.arcPt);
    assert.strictEqual(app.state.constraints.filter((c) => c.type === CONSTRAINT_TYPES.MIDPOINT).length, midBeforeArc + 1, `${host}: arc midpoint works right after refusal`);
    checks++;
  } finally {
    await app.close();
  }
}

console.log(`midpoint-own-end-b10-1005-node: ${checks} checks passed`);
