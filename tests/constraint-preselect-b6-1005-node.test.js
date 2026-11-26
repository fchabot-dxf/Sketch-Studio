// tests/constraint-preselect-b6-1005-node.test.js — TASK 1005 (B-6):
// Invalid preselection (e.g. preselected joint + Parallel/Perp/Collinear, preselected circle + H/V,
// joint + Tangent/Equal, circle + Midpoint, bezier + Symmetric) is refused in the ONE activation path,
// leaves no corrupt firstElement, never creates a corrupt constraint, and keeps the tool active.
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
  return { id, a, b, mid: [(x1 + x2) / 2, (y1 + y2) / 2] };
}
function addCircle(app, cx, cy, r) {
  const st = app.state;
  const c = st.genJ();
  st.joints.set(c, { x: cx, y: cy, fixed: false, sketchId: st.activeSketchId });
  const id = 'C_' + c;
  st.shapes.push({ id, type: 'circle', joints: [c], radius: r, sketchId: st.activeSketchId });
  app.frames(2);
  return { id, c };
}
function addBezier(app, x1, y1, x2, y2) {
  const st = app.state;
  const a = st.genJ(), b = st.genJ();
  st.joints.set(a, { x: x1, y: y1, fixed: false, sketchId: st.activeSketchId });
  st.joints.set(b, { x: x2, y: y2, fixed: false, sketchId: st.activeSketchId });
  const id = 'B_' + a;
  st.shapes.push({ id, type: 'bezier', joints: [a, b], c1: [x1, y2], c2: [x2, y1], sketchId: st.activeSketchId });
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
    const c1 = addCircle(app, cx + 4 * sc, cy - sc, sc);
    const b1 = addBezier(app, cx - 3 * sc, cy - 2 * sc, cx - sc, cy - 2 * sc);

    // 1. Preselect JOINT + Parallel -> refused, no corrupt parallel(jointId, lineId) when clicking a line next!
    app.esc();
    app.state.selectedJoints.add(l1.a);
    clearToasts(app.document);
    app.document.getElementById('tool-parallel').click();
    app.frames(1);
    assert.strictEqual(app.state.currentTool, TOOL_MODES.PARALLEL, `${host}: Parallel stays active after invalid joint preselect`);
    assert.ok(toasts(app.document).length >= 1, `${host}: Parallel refuses preselected joint`);
    assert.strictEqual(app.state.pendingConstraint?.firstElement ?? null, null, `${host}: Parallel clears invalid joint firstElement`);
    // Clicking l1 now starts a clean 1st pick (does NOT create a corrupt constraint)
    clickW(app, ...l1.mid);
    assert.strictEqual(app.state.constraints.filter((c) => c.type === CONSTRAINT_TYPES.PARALLEL).length, 0, `${host}: no corrupt parallel(jointId, lineId) created`);
    checks++;

    // 2. Preselect CIRCLE + H/V -> refused, firstElement cleared, clicking l1 next applies H/V cleanly
    app.esc();
    app.state.selectedShapes.add(c1.id);
    clearToasts(app.document);
    app.document.getElementById('tool-hv').click();
    app.frames(1);
    assert.strictEqual(app.state.currentTool, TOOL_MODES.HORIZONTAL_VERTICAL, `${host}: H/V stays active after invalid circle preselect`);
    assert.ok(toasts(app.document).length >= 1, `${host}: H/V refuses preselected circle`);
    assert.strictEqual(app.state.pendingConstraint?.firstElement ?? null, null, `${host}: H/V clears invalid circle firstElement`);
    clearToasts(app.document);
    clickW(app, ...l1.mid);
    assert.strictEqual(app.state.constraints.filter((c) => c.type === CONSTRAINT_TYPES.HORIZONTAL).length, 1, `${host}: H/V works on line right after invalid circle preselect`);
    checks++;

    // 3. Other invalid single preselections across remaining constraint tools
    const invalidCases = [
      { tool: TOOL_MODES.PERPENDICULAR, sel: () => app.state.selectedJoints.add(l1.a) },
      { tool: TOOL_MODES.COLLINEAR, sel: () => app.state.selectedJoints.add(l1.a) },
      { tool: TOOL_MODES.TANGENT, sel: () => app.state.selectedJoints.add(l1.a) },
      { tool: TOOL_MODES.EQUAL, sel: () => app.state.selectedJoints.add(l1.a) },
      { tool: TOOL_MODES.MIDPOINT, sel: () => app.state.selectedShapes.add(c1.id) },
      { tool: TOOL_MODES.SYMMETRIC, sel: () => app.state.selectedShapes.add(b1.id) },
      { tool: TOOL_MODES.COINCIDENT, sel: () => app.state.selectedShapes.add(b1.id) },
    ];
    for (const ic of invalidCases) {
      app.esc();
      ic.sel();
      clearToasts(app.document);
      app.document.getElementById('tool-' + ic.tool).click();
      app.frames(1);
      assert.strictEqual(app.state.currentTool, ic.tool, `${host}/${ic.tool}: stays active after invalid preselect`);
      assert.ok(toasts(app.document).length >= 1, `${host}/${ic.tool}: refuses invalid preselect`);
      assert.strictEqual(app.state.pendingConstraint?.firstElement ?? null, null, `${host}/${ic.tool}: clears invalid firstElement`);
      checks++;
    }
  } finally {
    await app.close();
  }
}

console.log(`constraint-preselect-b6-1005-node: ${checks} checks passed`);
