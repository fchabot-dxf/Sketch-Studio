// tests/coincident-868-node.test.js — TASK 868: Coincident tool creates pointOnLine for point + line (ordinary or offset)
// in either pick order, moves coincident rect corner pairs together onto the line, and tells the user on redundant/conflicting picks.
import assert from 'node:assert';
import { open } from './helpers/node-app.js';
import { TOOL_MODES, CONSTRAINT_TYPES } from '#core/constants.js';
import { ConstraintManager, setConstraintNotifier } from '#core/constraint-manager.js';
import { handleConstraintPointerDown, resetConstraintState } from '#ui/input-handlers/constraint-tools.js';
import { showNotification } from '#ui/notification-manager.js';

setConstraintNotifier(showNotification);

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, m); checks++; };

function buildOwnerSketch(st, { fixInner = true } = {}) {
  let seq = 200;
  const addJ = (x, y, fixed = false) => { const id = 'j' + (++seq); st.joints.set(id, { x, y, sketchId: st.activeSketchId, ...(fixed ? { fixed: true } : {}) }); return id; };
  const addLine = (a, b, gid) => {
    const id = 's' + (++seq);
    st.shapes.push({ id, type: 'line', joints: [a, b], sketchId: st.activeSketchId, ...(gid ? { groupId: gid } : {}) });
    return id;
  };
  const makeRect = (x0, y0, x1, y1, gid) => {
    const corners = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
    const lines = [];
    for (let i = 0; i < 4; i++) {
      const a = addJ(corners[i][0], corners[i][1]);
      const b = addJ(corners[(i + 1) % 4][0], corners[(i + 1) % 4][1]);
      lines.push({ s: addLine(a, b, gid), a, b });
    }
    for (let i = 0; i < 4; i++) {
      const prev = lines[i].b, next = lines[(i + 1) % 4].a;
      ConstraintManager.createConstraint(st, CONSTRAINT_TYPES.COINCIDENT, { joints: [prev, next] }, { source: 'rect', autoSolve: false });
      ConstraintManager.createConstraint(st, i % 2 === 0 ? CONSTRAINT_TYPES.HORIZONTAL : CONSTRAINT_TYPES.VERTICAL, { joints: [lines[i].a, lines[i].b] }, { source: 'rect', autoSolve: false });
    }
    return lines;
  };
  const inner = makeRect(-161.925, -85.725, 161.925, 85.725, 'offset_482');
  if (fixInner) {
    st.joints.get(inner[0].a).fixed = true;
    st.joints.get(inner[2].b).fixed = true;
  }
  const rectB = makeRect(-27.567815, -94.130958, 1.753287, 85.725, 'rect_486');
  const innerBottom = st.shapes.find((s) => s.id === inner[0].s);
  const innerTop = st.shapes.find((s) => s.id === inner[2].s);
  ConstraintManager.createConstraint(st, CONSTRAINT_TYPES.POINT_ON_LINE, { joint: rectB[1].b, shape: innerTop.id }, { source: 'snap' });
  const j890 = rectB[0].a;
  const j892 = rectB[3].b;
  const o1 = addJ(-50, 140, true), o2 = addJ(50, 140, true);
  const ordId = addLine(o1, o2);
  const ordLine = st.shapes.find((s) => s.id === ordId);
  return { innerBottom, innerTop, rectB, j890, j892, ordLine, addJ };
}

const toasts = (doc) => [...doc.querySelectorAll('#notification-container [data-level]')].map((e) => e.textContent.trim());
const clearToasts = (doc) => doc.querySelectorAll('#notification-container [data-level]').forEach((e) => e.remove());

// 1. Owner's case: rect corner j892 then inner offset bottom line -> adds pointOnLine and moves j892 + twin j890 onto y = -85.725
{
  const app = await open({ host: 'sketchstudio', width: 1280, height: 800 });
  try {
    const st = app.state;
    const { innerBottom, j890, j892 } = buildOwnerSketch(st);
    ok(Math.abs(st.joints.get(j892).y - (-94.130958)) < 0.01, 'pre-condition: corner not yet on bottom line');
    st.currentTool = TOOL_MODES.COINCIDENT;
    resetConstraintState(st);
    const h1 = handleConstraintPointerDown(null, app.svg, st, { id: j892, j: st.joints.get(j892) }, null, null);
    const h2 = handleConstraintPointerDown(null, app.svg, st, null, { shape: innerBottom }, null);
    eq(h1, true, 'corner pick accepted');
    eq(h2, true, 'offset bottom line second pick handled');
    const pol = st.constraints.find((c) => c.type === CONSTRAINT_TYPES.POINT_ON_LINE && c.joint === j892 && c.shape === innerBottom.id);
    ok(!!pol, 'pointOnLine constraint added between corner and offset bottom line');
    ok(Math.abs(st.joints.get(j892).y - (-85.725)) < 1e-3, `corner moved onto bottom line (y=${st.joints.get(j892).y})`);
    ok(Math.abs(st.joints.get(j890).y - (-85.725)) < 1e-3, `twin corner moved with it (y=${st.joints.get(j890).y})`);
  } finally {
    await app.close();
  }
}

// 2. Twin corner j890 + offset bottom line, AND reverse order (line first, then point) on ordinary line, AND point + point
{
  const app = await open({ host: 'sketchstudio', width: 1280, height: 800 });
  try {
    const st = app.state;
    const { innerBottom, j890, ordLine, addJ } = buildOwnerSketch(st);
    st.currentTool = TOOL_MODES.COINCIDENT;
    resetConstraintState(st);

    // 2a. Twin j890 + innerBottom
    eq(handleConstraintPointerDown(null, app.svg, st, { id: j890, j: st.joints.get(j890) }, null, null), true, 'twin j890 first pick');
    eq(handleConstraintPointerDown(null, app.svg, st, null, { shape: innerBottom }, null), true, 'twin j890 + offset bottom line');
    ok(st.constraints.some((c) => c.type === CONSTRAINT_TYPES.POINT_ON_LINE && c.joint === j890 && c.shape === innerBottom.id), 'twin pointOnLine added');
    ok(Math.abs(st.joints.get(j890).y - (-85.725)) < 1e-3, 'twin moved onto bottom line');

    // 2b. Other order: ordinary line first, then free point
    const fp = addJ(10, 120);
    eq(handleConstraintPointerDown(null, app.svg, st, null, { shape: ordLine }, null), true, 'ordinary line first pick');
    eq(handleConstraintPointerDown(null, app.svg, st, { id: fp, j: st.joints.get(fp) }, null, null), true, 'point second pick onto line');
    ok(st.constraints.some((c) => c.type === CONSTRAINT_TYPES.POINT_ON_LINE && c.joint === fp && c.shape === ordLine.id), 'line-then-point added pointOnLine');
    ok(Math.abs(st.joints.get(fp).y - 140) < 1e-3, `point moved onto ordinary line (y=${st.joints.get(fp).y})`);

    // 2c. Point + Point
    const p1 = addJ(40, 40), p2 = addJ(55, 45);
    eq(handleConstraintPointerDown(null, app.svg, st, { id: p1, j: st.joints.get(p1) }, null, null), true, 'p1 first pick');
    eq(handleConstraintPointerDown(null, app.svg, st, { id: p2, j: st.joints.get(p2) }, null, null), true, 'p2 second pick');
    ok(st.constraints.some((c) => c.type === CONSTRAINT_TYPES.COINCIDENT && c.joints && c.joints.includes(p1) && c.joints.includes(p2)), 'point+point added coincident');
  } finally {
    await app.close();
  }
}

// 3. Redundant / conflicting / invalid picks ALWAYS tell the user (no silent end)
{
  const app = await open({ host: 'sketchstudio', width: 1280, height: 800 });
  try {
    const st = app.state;
    const doc = app.document;
    const { innerBottom, j890, j892, ordLine, addJ } = buildOwnerSketch(st);
    st.currentTool = TOOL_MODES.COINCIDENT;
    resetConstraintState(st);

    // 3a. Add pointOnLine(j892, innerBottom), then try duplicate (j892 + innerBottom) -> notice
    handleConstraintPointerDown(null, app.svg, st, { id: j892, j: st.joints.get(j892) }, null, null);
    handleConstraintPointerDown(null, app.svg, st, null, { shape: innerBottom }, null);
    clearToasts(doc);
    handleConstraintPointerDown(null, app.svg, st, { id: j892, j: st.joints.get(j892) }, null, null);
    eq(handleConstraintPointerDown(null, app.svg, st, null, { shape: innerBottom }, null), true, 'duplicate point+line returns true');
    ok(toasts(doc).length >= 1, `duplicate point+line notifies user (got ${JSON.stringify(toasts(doc))})`);

    // 3b. Twin j890 + innerBottom when cluster (j892) is already on innerBottom -> redundant notice
    clearToasts(doc);
    handleConstraintPointerDown(null, app.svg, st, { id: j890, j: st.joints.get(j890) }, null, null);
    eq(handleConstraintPointerDown(null, app.svg, st, null, { shape: innerBottom }, null), true, 'twin redundant point+line returns true');
    ok(toasts(doc).length >= 1, `twin redundant point+line notifies user (got ${JSON.stringify(toasts(doc))})`);

    // 3c. Line + line -> invalid notice
    clearToasts(doc);
    handleConstraintPointerDown(null, app.svg, st, null, { shape: innerBottom }, null);
    eq(handleConstraintPointerDown(null, app.svg, st, null, { shape: ordLine }, null), true, 'line+line returns true');
    ok(toasts(doc).length >= 1, `line+line notifies user (got ${JSON.stringify(toasts(doc))})`);

    // 3d. Fixed point not on fixed line -> conflict notice
    clearToasts(doc);
    const fixedPt = addJ(0, 0, true);
    handleConstraintPointerDown(null, app.svg, st, { id: fixedPt, j: st.joints.get(fixedPt) }, null, null);
    eq(handleConstraintPointerDown(null, app.svg, st, null, { shape: innerBottom }, null), true, 'conflicting point+line returns true');
    ok(toasts(doc).length >= 1, `conflicting point+line notifies user (got ${JSON.stringify(toasts(doc))})`);
  } finally {
    await app.close();
  }
}

console.log(`coincident-868-node: ${checks} checks passed`);
