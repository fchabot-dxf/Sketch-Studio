// tests/notices-1001-node.test.js — TASK 1001: remove "stupid" notices (normal behaviour -> silent;
// real user errors -> one plain sentence, no ERR- codes, no Reason/Args; Log still receives codes + args).
import assert from 'node:assert';
import { open } from './helpers/node-app.js';
import { CONSTRAINT_TYPES, TOOL_MODES } from '#core/constants.js';
import { ConstraintManager, setConstraintNotifier, OVER_CONSTRAINED_TEXT } from '#core/constraint-manager.js';
import { setDebugSink } from '#core/debug.js';
import { showNotification } from '#ui/notification-manager.js';
import { showEditInput } from '#ui/numeric-input-manager.js';
import { handleDimensionPointerDown } from '#ui/input-handlers/dimension-tool.js';
import { handleConstraintPointerDown } from '#ui/input-handlers/constraint-tools.js';
import * as exportMgr from '../apps/sketchstudio/ui/export-manager.js';

setConstraintNotifier(showNotification);

const logs = [];

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, m); checks++; };

const notices = (doc) => [...doc.querySelectorAll('#notification-container [data-level]')];
const clear = (doc) => notices(doc).forEach((e) => e.remove());
const logHas = (code) => logs.some((e) => e.args.some((a) => String(a).includes(code)));

const app = await open({ host: 'sketchstudio', width: 1280, height: 800 });
setDebugSink((entry) => logs.push(entry));
try {
  const st = app.state, doc = app.document;
  let seq = 0;
  const J = (x, y, fixed = false) => { const id = 'q' + (++seq); st.joints.set(id, { x, y, fixed, sketchId: st.activeSketchId }); return id; };
  const line = (a, b) => { const s = { id: 'L' + (++seq), type: 'line', joints: [a, b], sketchId: st.activeSketchId }; st.shapes.push(s); return s; };
  const circle = (c, r) => { const s = { id: 'C' + (++seq), type: 'circle', joints: [c], radius: r, sketchId: st.activeSketchId }; st.shapes.push(s); return s; };

  // 1. Export: runExport exists; success -> no toast; failure -> Export failed toast; notify throw surfaces
  ok(typeof exportMgr.runExport === 'function', 'export-manager exports runExport');
  const origCreate = URL.createObjectURL;
  const origRevoke = URL.revokeObjectURL;
  URL.createObjectURL = () => 'blob:mock';
  URL.revokeObjectURL = () => {};
  try {
    const la = line(J(0, 0), J(50, 0));
    clear(doc);
    const resOk = exportMgr.runExport(st, 'sketch', 'svg', {}, showNotification);
    eq(resOk.ok, true, 'runExport svg ok');
    eq(notices(doc).length, 0, 'Export success shows no toast');

    clear(doc);
    const resFail = exportMgr.runExport(st, 'sketch', 'bogus', {}, showNotification);
    eq(resFail.ok, false, 'runExport bogus fails');
    eq(notices(doc).length, 1, 'Export failure shows 1 toast');
    ok(notices(doc)[0].textContent.includes('Export failed:'), 'Export failure keeps Export failed message');

    assert.throws(() => exportMgr.runExport(st, 'sketch', 'bogus', {}, () => { throw new Error('boom'); }), /boom/, 'notify error surfaces instead of silent catch');
    checks++;
    // remove la so sketch is clean
    st.shapes = st.shapes.filter((s) => s !== la);
  } finally {
    URL.createObjectURL = origCreate;
    URL.revokeObjectURL = origRevoke;
  }

  // 2. Equal hotkey (E) on a line + a circle -> plain sentence, no code/Reason/Args, and ERR-EQUAL-01 logged
  const eqLine = line(J(10, 10), J(60, 10));
  const eqCircle = circle(J(100, 100), 25);
  st.selectedShapes.clear();
  st.selectedShapes.add(eqLine.id);
  st.selectedShapes.add(eqCircle.id);
  clear(doc);
  logs.length = 0;
  doc.dispatchEvent(new app.window.KeyboardEvent('keydown', { key: 'e', bubbles: true, cancelable: true }));
  eq(notices(doc).length, 1, 'Equal invalid selection shows 1 toast');
  const eqText = notices(doc)[0].textContent.trim().replace(/^[^A-Za-z]+/, '');
  eq(eqText, 'Equal needs two lines, or two circles or arcs.', 'Equal toast is one plain sentence');
  ok(!/ERR-|Reason:|Args:/.test(eqText), 'Equal toast has no code, Reason, or Args');
  ok(logHas('ERR-EQUAL-01'), 'Equal invalid selection logs ERR-EQUAL-01');
  st.selectedShapes.clear();

  // 2b. Equal tool (constraint-tools.js) on a line + a circle -> identical plain sentence and ERR-EQUAL-01 logged
  clear(doc);
  logs.length = 0;
  st.currentTool = TOOL_MODES.EQUAL;
  st.pendingConstraint = null;
  handleConstraintPointerDown(null, app.svg, st, null, { shape: eqLine }, null);
  handleConstraintPointerDown(null, app.svg, st, null, { shape: eqCircle }, null);
  eq(notices(doc).length, 1, 'Equal tool invalid selection shows 1 toast');
  eq(notices(doc)[0].textContent.trim().replace(/^[^A-Za-z]+/, ''), 'Equal needs two lines, or two circles or arcs.', 'Equal tool toast matches hotkey plain sentence');
  ok(logHas('ERR-EQUAL-01'), 'Equal tool invalid selection logs ERR-EQUAL-01');
  st.selectedShapes.clear();

  // 3. Dimension on already-defined geometry (both dimension-tool.js paths + numeric-input-manager.js) -> no toast, code logged
  const fx1 = J(200, 0, true), fx2 = J(260, 0, true);
  line(fx1, fx2);
  clear(doc);
  logs.length = 0;
  // Create a driving distance on two fixed joints, then open edit input -> numeric-input-manager marks it driven without toast
  const cDet = ConstraintManager.createConstraint(st, CONSTRAINT_TYPES.DISTANCE, { joints: [fx1, fx2], value: 60, isDriven: false }, { skipVerify: true, quietReference: true });
  ok(!!cDet, 'created test distance');
  cDet.isDriven = false; cDet.driven = false;
  showEditInput(app.svg, st, cDet);
  eq(cDet.isDriven, true, 'numeric-input-manager marks determined dim as driven');
  eq(notices(doc).length, 0, 'numeric-input-manager shows no toast for driven dim');
  ok(logHas('ERR-DRIVEN-02'), 'numeric-input-manager logs ERR-DRIVEN-02');

  // dimension-tool.js placement on fixed joints where sandbox cannot satisfy value -> ERR-DIM-02 logged, no toast
  clear(doc);
  logs.length = 0;
  st.currentTool = TOOL_MODES.DIMENSION;
  st.placingConstraint = null;
  const p1 = st.joints.get(fx1), p2 = st.joints.get(fx2);
  const ev = { pointerType: 'mouse', clientX: 230, clientY: 20, target: { closest: () => null } };
  handleDimensionPointerDown(ev, app.svg, st, { id: fx1, j: p1 }, null, null);
  handleDimensionPointerDown(ev, app.svg, st, { id: fx2, j: p2 }, null, null);
  const pending = st.placingConstraint;
  ok(!!pending && pending.__placing, 'dimension-tool started placing');
  pending.isDriven = false;
  pending.driven = false;
  pending.value = 999;
  handleDimensionPointerDown(ev, app.svg, st, null, null, { x: 230, y: -20 });
  eq(pending.isDriven, true, 'dimension-tool marks unsatisfiable dim on fixed joints as driven');
  eq(notices(doc).length, 0, 'dimension-tool placement on fixed joints shows no toast');
  ok(logHas('ERR-DIM-02'), 'dimension-tool logs ERR-DIM-02');

  // 4. ConstraintManager auto-driven on fixed joints -> no toast, reference logged; math-rejected -> no [ERR-CMATH-01]
  clear(doc);
  logs.length = 0;
  const fx3 = J(400, 0, true), fx4 = J(460, 0, true);
  const cAutoRef = ConstraintManager.createConstraint(st, CONSTRAINT_TYPES.DISTANCE, { joints: [fx3, fx4], value: 60, isDriven: false });
  ok(cAutoRef && cAutoRef.isDriven, 'distance on fixed joints auto-driven');
  eq(notices(doc).length, 0, 'ConstraintManager auto-driven shows no toast');
  ok(logHas('Dimension added as reference'), 'ConstraintManager logs reference reason');

  // Symmetric with same point twice -> math-rejected, no [ERR-CMATH-01] in toast
  clear(doc);
  logs.length = 0;
  const dl1 = line(J(300, 0), J(350, 0));
  const symRef = ConstraintManager.createConstraint(st, CONSTRAINT_TYPES.SYMMETRIC, { joints: [dl1.joints[0], dl1.joints[0]], line: 'ref_axis_y' });
  eq(symRef, null, 'symmetric same point rejected');
  eq(notices(doc).length, 1, 'symmetric same point shows 1 toast');
  ok(!/\[ERR-CMATH-01\]/.test(notices(doc)[0].textContent), 'symmetric rejection toast has no [ERR-CMATH-01]');
  ok(logHas('ERR-CMATH-01'), 'symmetric rejection logs ERR-CMATH-01');

  // 5. Task 874 over-constrained notice is untouched
  eq(OVER_CONSTRAINED_TEXT, 'Sketch geometry over constrained', 'task 874 OVER_CONSTRAINED_TEXT unchanged');
} finally {
  setDebugSink(null);
  await app.close();
}

console.log(`notices-1001-node: ${checks} checks passed`);
