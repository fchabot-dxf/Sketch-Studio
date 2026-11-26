// tests/constraint-activation-ux15-1005-node.test.js — TASK 1005 (UX-15 / B-14b,d + second-click & lifecycle matrix):
// For each of the 9 constraint tools and each host (SketchStudio, Shaper, Pen Plotter):
//   - a valid use leaves the tool active,
//   - a refusal leaves the tool active,
//   - a second ribbon click leaves the tool active,
//   - Esc exits to Select, and picking another tool exits to that tool.
// Also guards: H/V with preselected line stays in H/V in all hosts; Coincident ribbon does not clear selection.
import assert from 'node:assert';
import { open, createProfile, loadGlyphSheetFromDisk } from './helpers/node-app.js';
import { TOOL_MODES, CONSTRAINT_TOOLS } from '#core/constants.js';
import { setConstraintNotifier } from '#core/constraint-manager.js';
import { showNotification } from '#ui/notification-manager.js';

await loadGlyphSheetFromDisk();

const HOSTS = ['sketchstudio', 'shaper', 'penplotter'];
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
function addCircle(app, cx, cy, r) {
  const st = app.state;
  const c = st.genJ();
  st.joints.set(c, { x: cx, y: cy, fixed: false, sketchId: st.activeSketchId });
  const id = 'C_' + c;
  st.shapes.push({ id, type: 'circle', joints: [c], radius: r, sketchId: st.activeSketchId });
  app.frames(2);
  return { id, c, rim: [cx + r, cy] };
}
function clickRibbon(app, tool) {
  const btn = app.document.getElementById('tool-' + tool);
  assert.ok(btn, `ribbon button #tool-${tool} exists`);
  btn.click();
  app.frames(1);
}

let checks = 0;
for (const host of HOSTS) {
  const profile = await createProfile();
  const app = await open({ host, profile });
  setConstraintNotifier(showNotification);
  try {
    const cx = host === 'penplotter' ? 100 : 0;
    const cy = host === 'penplotter' ? 100 : (host === 'shaper' ? 10 : 0);
    const sc = host === 'penplotter' ? 18 : (host === 'shaper' ? 8 : 1.8);

    // 1. Preselected slanted line + H/V ribbon -> applies H/V AND stays in hv (all hosts)
    {
      const l = addLine(app, cx - 2 * sc, cy + sc, cx + 2 * sc, cy + 1.2 * sc);
      app.esc();
      app.state.selectedShapes.add(l.id);
      clickRibbon(app, TOOL_MODES.HORIZONTAL_VERTICAL);
      assert.strictEqual(app.state.currentTool, TOOL_MODES.HORIZONTAL_VERTICAL, `${host}: H/V preselected line stays in hv`);
      assert.strictEqual(app.state.constraints.filter((c) => c.type === 'horizontal').length, 1, `${host}: H/V applied to preselected line`);
      app.esc();
      assert.strictEqual(app.state.currentTool, TOOL_MODES.SELECT, `${host}: Esc exits hv to select`);
      checks++;
    }

    // 2. Coincident ribbon with 2 preselected shapes does NOT clear selection in any host
    {
      const l1 = addLine(app, cx - 3 * sc, cy - 2 * sc, cx - sc, cy - 2 * sc);
      const l2 = addLine(app, cx + sc, cy - 2 * sc, cx + 3 * sc, cy - 2 * sc);
      app.esc();
      app.state.selectedShapes.add(l1.id);
      app.state.selectedShapes.add(l2.id);
      clickRibbon(app, TOOL_MODES.COINCIDENT);
      assert.strictEqual(app.state.currentTool, TOOL_MODES.COINCIDENT, `${host}: Coincident active`);
      assert.strictEqual(app.state.selectedShapes.size, 2, `${host}: Coincident ribbon keeps selection (no host divergence)`);
      app.esc();
      checks++;
    }

    // 3. Full 9-tool lifecycle matrix: use -> stays; refusal -> stays; 2nd ribbon click -> stays;
    //    ONE Esc after a first pick -> Select & pick buffer empty (turn 3764); other tool -> exits
    const ptOf = (jid) => { const j = app.state.joints.get(jid); return [j.x, j.y]; };
    const midOf = (line) => { const a = app.state.joints.get(line.a), b = app.state.joints.get(line.b); return [(a.x + b.x) / 2, (a.y + b.y) / 2]; };
    const toolOps = {
      [TOOL_MODES.HORIZONTAL_VERTICAL]: () => {
        const l = addLine(app, cx - 2 * sc, cy + 2 * sc, cx + 2 * sc, cy + 2.3 * sc);
        const c = addCircle(app, cx + 4 * sc, cy + 2 * sc, 0.7 * sc);
        return { use: [l.mid], refuse: [c.rim], firstPick: () => ptOf(l.a) };
      },
      [TOOL_MODES.PARALLEL]: () => {
        const a = addLine(app, cx - 2 * sc, cy + 2 * sc, cx + 2 * sc, cy + 2.2 * sc);
        const b = addLine(app, cx - 2 * sc, cy + 3.2 * sc, cx + 2 * sc, cy + 3.8 * sc);
        const c = addCircle(app, cx + 4 * sc, cy + 2 * sc, 0.7 * sc);
        return { use: [a.mid, b.mid], refuse: [c.rim], firstPick: () => midOf(a) };
      },
      [TOOL_MODES.PERPENDICULAR]: () => {
        const a = addLine(app, cx - 2 * sc, cy + 2 * sc, cx + 2 * sc, cy + 2 * sc);
        const b = addLine(app, cx + sc, cy + 3 * sc, cx + 1.3 * sc, cy + 5 * sc);
        const c = addCircle(app, cx + 4 * sc, cy + 2 * sc, 0.7 * sc);
        return { use: [a.mid, b.mid], refuse: [c.rim], firstPick: () => midOf(a) };
      },
      [TOOL_MODES.COLLINEAR]: () => {
        const a = addLine(app, cx - 3 * sc, cy + 2 * sc, cx - sc, cy + 2 * sc);
        const b = addLine(app, cx + sc, cy + 2.5 * sc, cx + 3 * sc, cy + 2.5 * sc);
        const c = addCircle(app, cx + 4 * sc, cy + 4 * sc, 0.7 * sc);
        return { use: [a.mid, b.mid], refuse: [c.rim], firstPick: () => midOf(a) };
      },
      [TOOL_MODES.COINCIDENT]: () => {
        const a = addLine(app, cx - 3 * sc, cy + 2 * sc, cx - sc, cy + 2 * sc);
        const b = addLine(app, cx + sc, cy + 2 * sc, cx + 3 * sc, cy + 2 * sc);
        return { use: [a.p2, b.p1], refuse: [a.mid, b.mid], firstPick: () => ptOf(a.a) };
      },
      [TOOL_MODES.TANGENT]: () => {
        const a = addLine(app, cx - 2 * sc, cy + 2 * sc, cx + 2 * sc, cy + 2 * sc);
        const b = addLine(app, cx - 2 * sc, cy + 3.5 * sc, cx + 2 * sc, cy + 3.5 * sc);
        const c = addCircle(app, cx, cy + 0.5 * sc, 0.8 * sc);
        return { use: [a.mid, c.rim], refuse: [a.mid, b.mid], firstPick: () => midOf(a) };
      },
      [TOOL_MODES.EQUAL]: () => {
        const a = addLine(app, cx - 3 * sc, cy + 2 * sc, cx - sc, cy + 2 * sc);
        const b = addLine(app, cx + sc, cy + 2 * sc, cx + 3.5 * sc, cy + 2 * sc);
        const c = addCircle(app, cx, cy + 4 * sc, 0.7 * sc);
        return { use: [a.mid, b.mid], refuse: [a.mid, c.rim], firstPick: () => midOf(a) };
      },
      [TOOL_MODES.MIDPOINT]: () => {
        const a = addLine(app, cx - 2 * sc, cy + 2 * sc, cx + 2 * sc, cy + 2 * sc);
        const b = addLine(app, cx, cy + 3.2 * sc, cx + 2 * sc, cy + 3.2 * sc);
        const c = addCircle(app, cx + 4 * sc, cy + 2 * sc, 0.7 * sc);
        return { use: [b.p1, a.mid], refuse: [c.rim], firstPick: () => ptOf(b.b) };
      },
      [TOOL_MODES.SYMMETRIC]: () => {
        const a = addLine(app, cx - 3 * sc, cy + 2 * sc, cx - 1.5 * sc, cy + 3 * sc);
        const b = addLine(app, cx + 1.5 * sc, cy + 2 * sc, cx + 3 * sc, cy + 3.2 * sc);
        const m = addLine(app, cx, cy + sc, cx, cy + 4 * sc);
        return { use: [a.p1, b.p1, m.mid], refuse: [a.p2, b.mid], firstPick: () => ptOf(a.a) };
      },
    };

    for (const tool of CONSTRAINT_TOOLS) {
      // Fresh scene per tool
      app.state.shapes.length = 0;
      app.state.constraints.length = 0;
      for (const id of [...app.state.joints.keys()]) if (id !== 'j_origin') app.state.joints.delete(id);
      app.esc();
      const { use, refuse, firstPick } = toolOps[tool]();

      // Enter via ribbon
      clickRibbon(app, tool);
      assert.strictEqual(app.state.currentTool, tool, `${host}/${tool}: entered via ribbon`);

      // Second ribbon click -> stays active
      clickRibbon(app, tool);
      assert.strictEqual(app.state.currentTool, tool, `${host}/${tool}: 2nd ribbon click stays active`);

      // Valid use -> constraint added AND stays active
      const cBefore = app.state.constraints.length;
      for (const [x, y] of use) clickW(app, x, y);
      assert.ok(app.state.constraints.length > cBefore, `${host}/${tool}: valid use created constraint`);
      assert.strictEqual(app.state.currentTool, tool, `${host}/${tool}: stays active after valid use`);

      // Refusal -> stays active
      clearToasts(app.document);
      for (const [x, y] of refuse) clickW(app, x, y);
      assert.strictEqual(app.state.currentTool, tool, `${host}/${tool}: stays active after refusal`);

      // Esc (idle) -> exits to Select
      app.esc();
      assert.strictEqual(app.state.currentTool, TOOL_MODES.SELECT, `${host}/${tool}: Esc exits to Select`);
      assert.strictEqual(app.state.pendingConstraint, null, `${host}/${tool}: Esc leaves pendingConstraint null`);

      // Owner ruling turn 3764: ONE Esc after a first pick clears pending pick AND exits to Select
      clickRibbon(app, tool);
      clickW(app, ...firstPick());
      const pc = app.state.pendingConstraint;
      assert.ok(pc && (pc.firstElement || (pc.selectionBuffer && pc.selectionBuffer.length > 0)), `${host}/${tool}: first pick recorded in pendingConstraint`);
      app.esc();
      assert.strictEqual(app.state.currentTool, TOOL_MODES.SELECT, `${host}/${tool}: ONE Esc after first pick exits to Select`);
      assert.strictEqual(app.state.pendingConstraint, null, `${host}/${tool}: ONE Esc after first pick clears pick buffer`);
      assert.strictEqual(app.state.selectedJoints.size, 0, `${host}/${tool}: ONE Esc clears selectedJoints`);
      assert.strictEqual(app.state.selectedShapes.size, 0, `${host}/${tool}: ONE Esc clears selectedShapes`);

      // Re-enter then pick another tool -> exits to Line
      clickRibbon(app, tool);
      assert.strictEqual(app.state.currentTool, tool, `${host}/${tool}: re-entered`);
      clickRibbon(app, TOOL_MODES.LINE);
      assert.strictEqual(app.state.currentTool, TOOL_MODES.LINE, `${host}/${tool}: another tool exits`);
      checks++;
    }
  } finally {
    await app.close();
  }
}

console.log(`constraint-activation-ux15-1005-node: ${checks} checks passed`);
