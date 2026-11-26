// TASK 1000B Round 2 — Independent Cross-Examination Probe Script (Auditor B)
// Independently reproduces / verifies Auditor 1's findings (UX-01..UX-29, DIV-01..DIV-04)
// and re-checks task 1001 (9b1eb8e4) notice fixes on current merged HEAD.
// Run: node tests/audits/solver-ux-audit-1000b-cross.mjs
// AUDIT ONLY: observes and prints verbatim; exits 0.

import { open, createProfile, loadGlyphSheetFromDisk } from '../helpers/node-app.js';
import { CONSTRAINT_TYPES } from '#core/constants.js';
import { ConstraintManager, setConstraintNotifier } from '#core/constraint-manager.js';
import { showNotification } from '#ui/notification-manager.js';
import { analyzeConstraintStatus } from '#core/constraint-status.js';
import { toggleDriving, commitDimensionEdits } from '#core/dimension-seams.js';
import { applyFillet, findCornerAtJoint } from '#core/fillet.js';
import { mirrorObjects, mirrorObjectsOf } from '#core/mirror.js';
import { breakShape } from '#core/break.js';
import { trimShape } from '#core/trim.js';
import SettingsManager from '#core/settings-manager.js';
import { selectionLockState } from '#ui/input-manager.js';
import { showEditInput } from '#ui/numeric-input-manager.js';
import * as ops from '#core/tool-ops.js';

await loadGlyphSheetFromDisk();
async function openApp({ app = 'sketchstudio' } = {}) {
  const profile = await createProfile();
  const inst = await open({ host: app, profile });
  setConstraintNotifier(showNotification);
  return inst;
}

function readToasts(app) {
  const box = app.document.getElementById('notification-container');
  if (!box) return [];
  return [...box.querySelectorAll('[data-level]')].map(el => ({
    level: el.getAttribute('data-level'),
    text: (el.querySelector('pre')?.textContent || el.textContent || '').trim(),
  }));
}
function clearToasts(app) {
  const box = app.document.getElementById('notification-container');
  if (box) box.innerHTML = '';
}
function clickW(app, x, y, opts = {}) {
  const p = app.toScreen(x, y);
  app.click(p.x, p.y, opts);
}
function dragW(app, x1, y1, x2, y2, steps = 8) {
  const a = app.toScreen(x1, y1), b = app.toScreen(x2, y2);
  app.move(a.x, a.y);
  app.down(a.x, a.y);
  for (let i = 1; i <= steps; i++) {
    app.move(a.x + (b.x - a.x) * i / steps, a.y + (b.y - a.y) * i / steps, { buttons: 1 });
  }
  app.up(b.x, b.y);
  app.frames(2);
}
function setView(app, cx, cy, halfW = 120) {
  const r = app.svg.getBoundingClientRect();
  const halfH = halfW * (r.height / r.width);
  app.state.view = { x: cx - halfW, y: cy - halfH, w: halfW * 2, h: halfH * 2 };
  app.svg.setAttribute('viewBox', `${app.state.view.x} ${app.state.view.y} ${app.state.view.w} ${app.state.view.h}`);
  app.frames(2);
}
function makeRect(app, x1, y1, x2, y2) {
  const r = ops.rect(app.state, x1, y1, x2, y2);
  const byId = (x) => typeof x === 'string' ? app.state.shapes.find(s => s.id === x) : x;
  const top = byId(r.top), right = byId(r.right), bottom = byId(r.bottom), left = byId(r.left);
  return {
    lines: [top.id, right.id, bottom.id, left.id],
    joints: [top.joints[0], top.joints[1], right.joints[1], bottom.joints[1]],
  };
}
function addLine(app, x1, y1, x2, y2, { fixed1 = false, fixed2 = false, id } = {}) {
  const sk = app.state.activeSketchId || 'sketch-1';
  const a = 'ja_' + Math.random().toString(36).slice(2, 7);
  const b = 'jb_' + Math.random().toString(36).slice(2, 7);
  app.state.joints.set(a, { x: x1, y: y1, fixed: fixed1, sketchId: sk });
  app.state.joints.set(b, { x: x2, y: y2, fixed: fixed2, sketchId: sk });
  const lid = id || `L_${a}_${b}`;
  app.state.shapes.push({ id: lid, type: 'line', joints: [a, b], sketchId: sk, isConstruction: false });
  app.frames(2);
  return { id: lid, a, b };
}
function typeIntoEditBox(app, text) {
  const inp = app.document.getElementById('dimInput');
  if (!inp || inp.classList.contains('hidden')) return { opened: false };
  inp.value = text;
  inp.dispatchEvent(new app.window.Event('input', { bubbles: true }));
  inp.dispatchEvent(new app.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  app.frames(2);
  const hintEl = app.document.getElementById('dimHint');
  const compEl = app.document.getElementById('dimComplete');
  return {
    opened: true,
    stillOpen: !inp.classList.contains('hidden'),
    hint: hintEl && !hintEl.classList.contains('hidden') ? hintEl.textContent.trim() : null,
    compVisible: !!(compEl && !compEl.classList.contains('hidden') && compEl.children.length > 0),
  };
}

// ===========================================================================
// UX-02: 500x40 rect shrunk to 4 mm vs 5 mm (findCollapsedShape 1% rule)
// ===========================================================================
{
  const app = await openApp({ app: 'sketchstudio' });
  setView(app, 250, 20, 400);
  const r = makeRect(app, 0, 0, 500, 40);
  app.state.joints.get(r.joints[0]).fixed = true;
  const d1 = ConstraintManager.createConstraint(app.state, CONSTRAINT_TYPES.DISTANCE, { joints: [r.joints[0], r.joints[1]], value: 500, name: 'd1' });
  ConstraintManager.createConstraint(app.state, CONSTRAINT_TYPES.DISTANCE, { joints: [r.joints[1], r.joints[2]], value: 40, name: 'd2' });
  app.frames(2);

  clearToasts(app);
  showEditInput(app.svg, app.state, d1);
  const res4 = typeIntoEditBox(app, '4');
  const t4 = readToasts(app);
  const valAfter4 = d1.value;

  clearToasts(app);
  showEditInput(app.svg, app.state, d1);
  const res5 = typeIntoEditBox(app, '5');
  const t5 = readToasts(app);
  const valAfter5 = d1.value;
  console.log('CROSS UX-02 (500x40->4 vs 5):', JSON.stringify({ res4, t4, valAfter4, res5, t5, valAfter5 }));
  await app.close();
}

// ===========================================================================
// UX-03: Drag arc end onto own start snaps & adds permanent coincident(e,s) vs Coincident tool refuses
// ===========================================================================
{
  const app = await openApp({ app: 'sketchstudio' });
  setView(app, 0, 0, 80);
  const sk = app.state.activeSketchId || 'sketch-1';
  app.state.joints.set('c', { x: 0, y: 0, fixed: true, sketchId: sk });
  app.state.joints.set('s', { x: 40, y: 0, fixed: true, sketchId: sk });
  app.state.joints.set('e', { x: 0, y: 40, sketchId: sk });
  app.state.shapes.push({ id: 'A1', type: 'arc', joints: ['c', 's', 'e'], sweep: true, sketchId: sk });
  ConstraintManager.createConstraint(app.state, CONSTRAINT_TYPES.EQUAL, { joints: ['c', 's', 'c', 'e'] });
  app.frames(2);

  // First try Coincident tool on (s, e)
  clearToasts(app);
  const toolRes = ConstraintManager.createConstraint(app.state, CONSTRAINT_TYPES.COINCIDENT, { joints: ['s', 'e'] }, { source: 'toolbar' });
  const toolToasts = readToasts(app);

  // Now drag e smoothly around the circle onto s(40,0)
  clearToasts(app);
  const scE = app.toScreen(0, 40);
  app.move(scE.x, scE.y);
  app.down(scE.x, scE.y);
  for (const deg of [120, 180, 240, 300, 345, 355, 359, 360]) {
    const rad = deg * Math.PI / 180;
    const p = app.toScreen(40 * Math.cos(rad), 40 * Math.sin(rad));
    app.move(p.x, p.y, { buttons: 1 });
  }
  const scS = app.toScreen(40, 0);
  app.up(scS.x, scS.y);
  app.frames(2);
  const je = app.state.joints.get('e');
  const coincs = app.state.constraints.filter(c => c.type === CONSTRAINT_TYPES.COINCIDENT).map(c => c.joints);
  console.log('CROSS UX-03 (ARC END DRAG SNAP vs TOOL):', JSON.stringify({
    toolRefused: toolRes === null, toolToasts,
    eAfterDrag: [+je.x.toFixed(3), +je.y.toFixed(3)],
    coincidentsAfterDrag: coincs,
  }));
  await app.close();
}

// ===========================================================================
// UX-04: breakShape ignores constraints -> broken horizontal line bends into V
// ===========================================================================
{
  const app = await openApp({ app: 'sketchstudio' });
  setView(app, 40, 0, 80);
  const l1 = addLine(app, 0, 0, 80, 0, { fixed1: true, id: 'L1' });
  ConstraintManager.createConstraint(app.state, CONSTRAINT_TYPES.HORIZONTAL, { joints: [l1.a, l1.b] });
  ConstraintManager.createConstraint(app.state, CONSTRAINT_TYPES.DISTANCE, { joints: [l1.a, l1.b], value: 80 });
  app.frames(2);
  const brk = breakShape(app.state, 'L1', 0.5);
  app.frames(2);
  dragW(app, 40, 0, 40, 30, 8);
  const jm = app.state.joints.get(brk.midJointId);
  console.log('CROSS UX-04 (BREAK LINE BEND):', JSON.stringify({
    midJoint: brk.midJointId,
    midAfterDrag: [+jm.x.toFixed(2), +jm.y.toFixed(2)],
    constraints: app.state.constraints.map(c => `${c.type}:${(c.joints || []).join(',')}`),
  }));
  await app.close();
}

// ===========================================================================
// UX-05: R10 fillet arc sweep=undefined; drag corner leg past 180 folds inside-out; mirrored fillet sweep=undefined
// ===========================================================================
{
  const app = await openApp({ app: 'sketchstudio' });
  setView(app, 50, 20, 100);
  const sk = app.state.activeSketchId || 'sketch-1';
  app.state.joints.set('a', { x: 0, y: 0, fixed: true, sketchId: sk });
  app.state.joints.set('b', { x: 50, y: 0, sketchId: sk });
  app.state.joints.set('c', { x: 50, y: 50, sketchId: sk });
  app.state.shapes.push(
    { id: 'L1', type: 'line', joints: ['a', 'b'], sketchId: sk },
    { id: 'L2', type: 'line', joints: ['b', 'c'], sketchId: sk }
  );
  ConstraintManager.createConstraint(app.state, CONSTRAINT_TYPES.HORIZONTAL, { joints: ['a', 'b'] });
  ConstraintManager.createConstraint(app.state, CONSTRAINT_TYPES.DISTANCE, { joints: ['a', 'b'], value: 50 });
  ConstraintManager.createConstraint(app.state, CONSTRAINT_TYPES.DISTANCE, { joints: ['b', 'c'], value: 50 });
  const corner = findCornerAtJoint(app.state, 'b');
  const fil = applyFillet(app.state, corner, 10);
  const arc = app.state.shapes.find(s => s.type === 'arc');
  const sweepBefore = arc.sweep;
  // Also mirror the fillet arc about x=-20
  app.state.joints.set('m1', { x: -20, y: -50, fixed: true, sketchId: sk });
  app.state.joints.set('m2', { x: -20, y: 50, fixed: true, sketchId: sk });
  app.state.shapes.push({ id: 'ML', type: 'line', joints: ['m1', 'm2'], sketchId: sk, isConstruction: true });
  mirrorObjects(app.state, mirrorObjectsOf([arc.id], []), 'ML');
  const mirArc = app.state.shapes.filter(s => s.type === 'arc' && s.id !== arc.id)[0];
  const mirSweep = mirArc ? mirArc.sweep : 'missing';
  app.frames(2);
  // Drag c down past 180 deg to (95, -15)
  dragW(app, 50, 50, 95, -15, 10);
  const ac = app.state.joints.get(arc.joints[0]);
  const as = app.state.joints.get(arc.joints[1]);
  const ae = app.state.joints.get(arc.joints[2]);
  const jc = app.state.joints.get('c');
  console.log('CROSS UX-05 (FILLET SWEEP & PAST-180 FOLD):', JSON.stringify({
    filletSweep: sweepBefore === undefined ? 'undefined' : sweepBefore,
    mirroredFilletSweep: mirSweep === undefined ? 'undefined' : mirSweep,
    cAfter: [+jc.x.toFixed(2), +jc.y.toFixed(2)],
    arcCenter: [+ac.x.toFixed(2), +ac.y.toFixed(2)],
    arcStart: [+as.x.toFixed(2), +as.y.toFixed(2)],
    arcEnd: [+ae.x.toFixed(2), +ae.y.toFixed(2)],
    crossedBack: as.x > ae.x && jc.y < 0,
  }));
  await app.close();
}

// ===========================================================================
// UX-08 extra check: toggleDriving discards formula (c.expression) permanently with no undo
// ===========================================================================
{
  const app = await openApp({ app: 'sketchstudio' });
  const l1 = addLine(app, 0, 0, 20, 0, { fixed1: true });
  const l2 = addLine(app, 0, 20, 40, 20, { fixed1: true });
  const d1 = ConstraintManager.createConstraint(app.state, CONSTRAINT_TYPES.DISTANCE, { joints: [l1.a, l1.b], value: 20, name: 'd1' });
  const d2 = ConstraintManager.createConstraint(app.state, CONSTRAINT_TYPES.DISTANCE, { joints: [l2.a, l2.b], value: 40, name: 'd2', expression: 'd1 * 2' });
  const hBefore = app.state.history.length;
  toggleDriving(app.state, d2);
  console.log('CROSS UX-08 (TOGGLE DRIVING FORMULA LOSS + NO UNDO):', JSON.stringify({
    hBefore, hAfter: app.state.history.length, exprAfterToggle: d2.expression ?? null, isDriven: !!d2.isDriven,
  }));
  await app.close();
}

// ===========================================================================
// UX-09: Arc centre coincident with line end — Map order changes rigid translate vs radius shrink!
// ===========================================================================
{
  const runOrder = async (cFirst) => {
    const app = await openApp({ app: 'sketchstudio' });
    setView(app, 30, 30, 100);
    const sk = app.state.activeSketchId || 'sketch-1';
    if (cFirst) {
      app.state.joints.set('c', { x: 20, y: 20, sketchId: sk });
      app.state.joints.set('p', { x: 20, y: 20, sketchId: sk });
    } else {
      app.state.joints.set('p', { x: 20, y: 20, sketchId: sk });
      app.state.joints.set('c', { x: 20, y: 20, sketchId: sk });
    }
    app.state.joints.set('s', { x: 50, y: 20, sketchId: sk });
    app.state.joints.set('e', { x: 20, y: 50, sketchId: sk });
    app.state.joints.set('q', { x: -10, y: 20, sketchId: sk });
    app.state.shapes.push(
      { id: 'A1', type: 'arc', joints: ['c', 's', 'e'], sweep: true, sketchId: sk },
      { id: 'L1', type: 'line', joints: ['p', 'q'], sketchId: sk }
    );
    ConstraintManager.createConstraint(app.state, CONSTRAINT_TYPES.EQUAL, { joints: ['c', 's', 'c', 'e'] });
    ConstraintManager.createConstraint(app.state, CONSTRAINT_TYPES.COINCIDENT, { joints: ['c', 'p'] });
    app.frames(2);
    dragW(app, 20, 20, 40, 40, 8);
    const jc = app.state.joints.get('c'), js = app.state.joints.get('s');
    const rAfter = Math.hypot(js.x - jc.x, js.y - jc.y);
    await app.close();
    return { cFirst, cAfter: [+jc.x.toFixed(2), +jc.y.toFixed(2)], rBefore: 30, rAfter: +rAfter.toFixed(3) };
  };
  const o1 = await runOrder(true);
  const o2 = await runOrder(false);
  console.log('CROSS UX-09 (ARC CENTRE COINCIDENT MAP ORDER):', JSON.stringify({ o1, o2 }));
}

// ===========================================================================
// UX-11: Trim (a) no pointOnLine to cutter, (b) orphaned dim spanning trimmed gap on rect
// ===========================================================================
{
  const app = await openApp({ app: 'sketchstudio' });
  setView(app, 40, 20, 100);
  const l1 = addLine(app, 0, 20, 80, 20, { fixed1: true, id: 'L1' });
  const l2 = addLine(app, 50, 0, 50, 50, { id: 'L2' });
  ConstraintManager.createConstraint(app.state, CONSTRAINT_TYPES.VERTICAL, { joints: [l2.a, l2.b] });
  trimShape(app.state, 'L1', { x: 65, y: 20 });
  app.frames(2);
  const trimmedEndId = app.state.shapes.find(s => s.id === 'L1').joints[1];
  dragW(app, 50, 10, 70, 10, 6);
  const te = { ...app.state.joints.get(trimmedEndId) };
  const cutX = app.state.joints.get(l2.a).x;
  await app.close();

  // (b) Rect top edge sharing corner joint 'b' with right edge trimmed against vertical cutter at x=40
  const app2 = await openApp({ app: 'sketchstudio' });
  const sk2 = app2.state.activeSketchId || 'sketch-1';
  app2.state.joints.set('a', { x: 0, y: 0, fixed: true, sketchId: sk2 });
  app2.state.joints.set('b', { x: 80, y: 0, sketchId: sk2 });
  app2.state.joints.set('c', { x: 80, y: 40, sketchId: sk2 });
  app2.state.shapes.push(
    { id: 'L1', type: 'line', joints: ['a', 'b'], sketchId: sk2 },
    { id: 'L2', type: 'line', joints: ['b', 'c'], sketchId: sk2 }
  );
  const d1 = ConstraintManager.createConstraint(app2.state, CONSTRAINT_TYPES.DISTANCE, { joints: ['a', 'b'], value: 80, name: 'd1' });
  addLine(app2, 40, -10, 40, 50, { id: 'CUT' });
  trimShape(app2.state, 'L1', { x: 60, y: 0 });
  const topLine = app2.state.shapes.find(s => s.id === 'L1');
  const a0 = app2.state.joints.get(topLine.joints[0]), a1 = app2.state.joints.get(topLine.joints[1]);
  const d1Still = app2.state.constraints.includes(d1);
  console.log('CROSS UX-11 (TRIM NO POL + ORPHANED RECT DIM):', JSON.stringify({
    trimmedEndAfterCutterDrag: [+te.x.toFixed(2), +te.y.toFixed(2)], cutterXAfterDrag: +cutX.toFixed(2),
    rectTopLenAfterTrim: +Math.hypot(a1.x - a0.x, a1.y - a0.y).toFixed(2),
    d1StillExists: d1Still, d1Val: d1.value, d1Joints: d1.joints, topLineJoints: topLine.joints,
  }));
  await app2.close();
}

// ===========================================================================
// UX-12: Drag 0-DOF rect corner wipes redoStack (1 -> 0)
// ===========================================================================
{
  const app = await openApp({ app: 'sketchstudio' });
  setView(app, 25, 20, 80);
  const r = makeRect(app, 0, 0, 50, 40);
  app.state.joints.get(r.joints[0]).fixed = true;
  ConstraintManager.createConstraint(app.state, CONSTRAINT_TYPES.DISTANCE, { joints: [r.joints[0], r.joints[1]], value: 50 });
  ConstraintManager.createConstraint(app.state, CONSTRAINT_TYPES.DISTANCE, { joints: [r.joints[1], r.joints[2]], value: 40 });
  // Create a free line, save, undo so redoStack has 1 item
  app.state.saveState('before-free');
  addLine(app, -30, 0, -30, 20);
  app.state.undo();
  const redoBefore = app.state.redoStack.length;
  dragW(app, 50, 40, 70, 60, 5);
  const cAfter = app.state.joints.get(r.joints[2]);
  console.log('CROSS UX-12 (0-DOF DRAG WIPES REDOSTACK):', JSON.stringify({
    redoBefore, redoAfter: app.state.redoStack.length, cornerAfter: [+cAfter.x.toFixed(2), +cAfter.y.toFixed(2)],
  }));
  await app.close();
}

// ===========================================================================
// UX-13: Dimension tool Line -> AxisX (angle) vs AxisX -> Line (length!)
// ===========================================================================
{
  const runDimOrder = async (axisFirst) => {
    const app = await openApp({ app: 'sketchstudio' });
    setView(app, 30, 15, 80);
    addLine(app, 0, 0, 60, 30, { fixed1: true, id: 'L1' });
    app.tool('dim');
    if (axisFirst) {
      clickW(app, 40, 0);   // X-axis
      clickW(app, 30, 15);  // L1
      clickW(app, 45, 8);   // place
    } else {
      clickW(app, 30, 15);  // L1
      clickW(app, 40, 0);   // X-axis
      clickW(app, 45, 8);   // place
    }
    const cs = app.state.constraints.map(c => ({ type: c.type, shapes: c.shapes, value: +Number(c.value).toFixed(3) }));
    await app.close();
    return { axisFirst, constraints: cs };
  };
  console.log('CROSS UX-13 (LINE<->AXISX DIM ORDER):', JSON.stringify({
    lineThenAxis: await runDimOrder(false),
    axisThenLine: await runDimOrder(true),
  }));
}

// ===========================================================================
// UX-15 4th subcase: Preselect Line + 1 Joint -> H key vs H/V ribbon button
// ===========================================================================
{
  const app = await openApp({ app: 'sketchstudio' });
  const l1 = addLine(app, 0, 10, 40, 14, { id: 'L1' });
  const l2 = addLine(app, 0, 30, 20, 30, { id: 'L2' });
  app.state.selectedShapes.add(l1.id);
  app.state.selectedJoints.add(l2.a);
  app.tool('hv');
  const afterBtn = { tool: app.state.currentTool, hvCount: app.state.constraints.filter(c => c.type === 'horizontal' || c.type === 'vertical').length };
  app.esc();
  app.state.selectedShapes.add(l1.id);
  app.state.selectedJoints.add(l2.a);
  app.key('h');
  const afterKey = { tool: app.state.currentTool, hvCount: app.state.constraints.filter(c => c.type === 'horizontal' || c.type === 'vertical').length };
  console.log('CROSS UX-15d (LINE+JOINT H-BTN vs H-KEY):', JSON.stringify({ afterBtn, afterKey }));
  await app.close();
}

// ===========================================================================
// UX-16 & UX-19 on MERGED MAIN (post-task 1001): fixed-end dim dblclick + C1.8/C1.9 toasts
// ===========================================================================
{
  const app = await openApp({ app: 'sketchstudio' });
  const l1 = addLine(app, 0, 0, 50, 0, { fixed1: true, fixed2: true, id: 'L1' });
  const d1 = { type: CONSTRAINT_TYPES.DISTANCE, joints: [l1.a, l1.b], value: 50, name: 'd1', isDriven: false };
  app.state.constraints.push(d1);
  app.frames(2);
  clearToasts(app);
  const hBefore = app.state.history.length;
  showEditInput(app.svg, app.state, d1);
  const ux16 = {
    editorOpen: !app.document.getElementById('dimInput').classList.contains('hidden'),
    isDrivenAfter: !!d1.isDriven,
    hBefore, hAfter: app.state.history.length,
    toasts: readToasts(app),
  };

  // C1.8: H + V lines -> add angle 45 (triggers math-precheck auto-driven: lines are H and V)
  const la = addLine(app, 0, 20, 40, 20, { id: 'LA' });
  const lb = addLine(app, 0, 20, 0, 60, { id: 'LB' });
  ConstraintManager.createConstraint(app.state, CONSTRAINT_TYPES.HORIZONTAL, { joints: [la.a, la.b] });
  ConstraintManager.createConstraint(app.state, CONSTRAINT_TYPES.VERTICAL, { joints: [lb.a, lb.b] });
  clearToasts(app);
  const angRes = ConstraintManager.createConstraint(app.state, CONSTRAINT_TYPES.ANGLE, { shapes: ['LA', 'LB'], value: 45 }, { source: 'toolbar' });
  const c18Toasts = readToasts(app);

  // C1.9: Symmetric same point twice (math-precheck reject)
  clearToasts(app);
  const symRes = ConstraintManager.createConstraint(app.state, CONSTRAINT_TYPES.SYMMETRIC, { joints: [la.a, la.a], shapes: ['LB'] }, { source: 'toolbar' });
  const c19Toasts = readToasts(app);
  console.log('CROSS UX-16 & UX-19 (POST-1001):', JSON.stringify({
    ux16,
    c18: { isDriven: !!angRes?.isDriven, drivenReason: angRes?.drivenReason, toasts: c18Toasts },
    c19: { rejected: symRes === null, toasts: c19Toasts },
  }));
  await app.close();
}

// ===========================================================================
// UX-17: Draw-time box vs Edit box (w = 50 hint, -5 behavior, autocomplete #dimComplete)
// ===========================================================================
{
  const app = await openApp({ app: 'sketchstudio' });
  setView(app, 0, 0, 80);
  const d1Line = addLine(app, -40, -30, 0, -30, { fixed1: true });
  const d1 = ConstraintManager.createConstraint(app.state, CONSTRAINT_TYPES.DISTANCE, { joints: [d1Line.a, d1Line.b], value: 40, name: 'd1' });
  app.frames(2);

  // Draw-time line box (#dualInput first <input>)
  app.tool('line');
  clickW(app, -20, 10);
  const m = app.toScreen(20, 10);
  app.move(m.x, m.y);
  const feedLive = (val, pressEnter) => {
    const dual = app.document.getElementById('dualInput');
    const box = dual ? dual.querySelector('input') : null;
    if (!box) return { found: false };
    box.value = val;
    box.dispatchEvent(new app.window.Event('input', { bubbles: true }));
    if (pressEnter) box.dispatchEvent(new app.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    const hint = app.document.getElementById('dimHint');
    const comp = app.document.getElementById('dimComplete');
    return {
      found: true,
      stillOpen: !dual.classList.contains('hidden'),
      hint: hint && !hint.classList.contains('hidden') ? hint.textContent.trim() : null,
      compVisible: !!(comp && !comp.classList.contains('hidden') && comp.children.length > 0),
    };
  };
  const drawNeg = feedLive('-5', true);
  const drawEq = feedLive('w = 50', true);
  const drawComp = feedLive('d', false);
  app.esc();

  // Edit box comparison
  clearToasts(app);
  showEditInput(app.svg, app.state, d1);
  const editComp = (() => {
    const inp = app.document.getElementById('dimInput');
    inp.value = 'd';
    inp.dispatchEvent(new app.window.Event('input', { bubbles: true }));
    const comp = app.document.getElementById('dimComplete');
    return !!(comp && !comp.classList.contains('hidden') && comp.children.length > 0);
  })();
  const editNeg = typeIntoEditBox(app, '-5');
  const editNegToasts = readToasts(app);
  clearToasts(app);
  showEditInput(app.svg, app.state, d1);
  const editEq = typeIntoEditBox(app, 'w = 50');
  console.log('CROSS UX-17 (DRAW vs EDIT BOX):', JSON.stringify({
    drawNeg, drawEq, drawComp,
    editComp, editNeg, editNegToasts, editEq, d1AfterEq: { name: d1.name, value: d1.value },
  }));
  await app.close();
}

// ===========================================================================
// UX-18: DOC_UNIT='in' refusal toast prints raw mm (2540 / -50.8)
// ===========================================================================
{
  const prevUnit = SettingsManager.get('DOC_UNIT');
  SettingsManager.set('DOC_UNIT', 'in');
  const app = await openApp({ app: 'sketchstudio' });
  try {
    const l1 = addLine(app, 0, 0, 50.8, 0, { fixed1: true });
    const d1 = ConstraintManager.createConstraint(app.state, CONSTRAINT_TYPES.DISTANCE, { joints: [l1.a, l1.b], value: 50.8, name: 'd1' });
    app.frames(2);
    clearToasts(app);
    showEditInput(app.svg, app.state, d1);
    typeIntoEditBox(app, '-2');
    const negInchToasts = readToasts(app);
    console.log('CROSS UX-18 (INCH REFUSAL IN MM):', JSON.stringify({ docUnit: SettingsManager.get('DOC_UNIT'), negInchToasts }));
  } finally {
    SettingsManager.set('DOC_UNIT', prevUnit || 'mm');
    await app.close();
  }
}

// ===========================================================================
// UX-20 & UX-21: Conflicted triangle (50,40,120) -> no conflict visual + blocks unrelated L4
// ===========================================================================
{
  const app = await openApp({ app: 'sketchstudio' });
  const sk = app.state.activeSketchId || 'sketch-1';
  app.state.joints.set('a', { x: 0, y: 0, fixed: true, sketchId: sk });
  app.state.joints.set('b', { x: 50, y: 0, sketchId: sk });
  app.state.joints.set('c', { x: 25, y: 30, sketchId: sk });
  app.state.shapes.push(
    { id: 'L1', type: 'line', joints: ['a', 'b'], sketchId: sk },
    { id: 'L2', type: 'line', joints: ['b', 'c'], sketchId: sk },
    { id: 'L3', type: 'line', joints: ['c', 'a'], sketchId: sk }
  );
  app.state.constraints.push(
    { type: CONSTRAINT_TYPES.HORIZONTAL, joints: ['a', 'b'] },
    { type: CONSTRAINT_TYPES.DISTANCE, joints: ['a', 'b'], value: 50, name: 'd1' },
    { type: CONSTRAINT_TYPES.DISTANCE, joints: ['b', 'c'], value: 40, name: 'd2' },
    { type: CONSTRAINT_TYPES.DISTANCE, joints: ['c', 'a'], value: 120, name: 'd3' }
  );
  app.state.engine.solve(500);
  app.frames(2);
  const st = analyzeConstraintStatus(app.state);
  const ja = app.state.joints.get('a'), jb = app.state.joints.get('b'), jc = app.state.joints.get('c');
  const abLen = Math.hypot(jb.x - ja.x, jb.y - ja.y);
  // UX-21: add completely unrelated free slanted line L4 and try Horizontal
  const l4 = addLine(app, 0, 80, 40, 95, { id: 'L4' });
  clearToasts(app);
  const hRes = ConstraintManager.createConstraint(app.state, CONSTRAINT_TYPES.HORIZONTAL, { joints: [l4.a, l4.b] }, { source: 'toolbar' });
  console.log('CROSS UX-20 & UX-21 (CONFLICTED TRIANGLE):', JSON.stringify({
    abLen: +abLen.toFixed(2), abError: +Math.abs(abLen - 50).toFixed(2),
    fixedShapes: [...st.fixedShapes],
    l4HorizontalBlocked: hRes === null,
    l4Toasts: readToasts(app),
  }));
  await app.close();
}

// ===========================================================================
// UX-22: Multi-select fixed L1 + free L2 -> drag L2 moves 0
// ===========================================================================
{
  const app = await openApp({ app: 'sketchstudio' });
  setView(app, 40, 20, 100);
  const l1 = addLine(app, 0, 0, 40, 0, { fixed1: true, fixed2: true, id: 'L1' });
  const l2 = addLine(app, 60, 20, 100, 20, { id: 'L2' });
  app.state.selectedShapes.add(l1.id);
  app.state.selectedShapes.add(l2.id);
  dragW(app, 60, 20, 60, 60, 6);
  const pAfter = app.state.joints.get(l2.a);
  console.log('CROSS UX-22 (MULTI-SELECT FIXED+FREE DRAG):', JSON.stringify({
    pBefore: [60, 20], pAfter: [+pAfter.x.toFixed(2), +pAfter.y.toFixed(2)],
  }));
  await app.close();
}

// ===========================================================================
// UX-23: Fast 1-step flick — joint drag vs body drag sub-moves
// ===========================================================================
{
  const runFlick = async (body) => {
    const app = await openApp({ app: 'sketchstudio' });
    setView(app, 0, 0, 100);
    const l1 = addLine(app, 0, 0, 60, 0, { fixed1: true, id: 'L1' });
    ConstraintManager.createConstraint(app.state, CONSTRAINT_TYPES.DISTANCE, { joints: [l1.a, l1.b], value: 60 });
    app.frames(2);
    const a = body ? app.toScreen(30, 0) : app.toScreen(60, 0);
    const b = body ? app.toScreen(-30, 10) : app.toScreen(-60, 10);
    app.move(a.x, a.y);
    app.down(a.x, a.y);
    app.move(b.x, b.y, { buttons: 1 }); // 1-step fast flick
    app.up(b.x, b.y);
    app.frames(2);
    const jb = app.state.joints.get(l1.b);
    await app.close();
    return { body, bAfter: [+jb.x.toFixed(2), +jb.y.toFixed(2)] };
  };
  console.log('CROSS UX-23 (1-STEP FLICK JOINT vs BODY):', JSON.stringify({
    jointFlick: await runFlick(false),
    bodyFlick: await runFlick(true),
  }));
}

// ===========================================================================
// UX-25: Trim & Break silent on Arc/Circle vs warning on Bezier
// ===========================================================================
{
  const app = await openApp({ app: 'sketchstudio' });
  setView(app, 0, 0, 100);
  const sk = app.state.activeSketchId || 'sketch-1';
  app.state.joints.set('c1', { x: -40, y: 0, sketchId: sk });
  app.state.shapes.push({ id: 'C1', type: 'circle', joints: ['c1'], radius: 15, sketchId: sk });
  app.state.joints.set('ac', { x: -40, y: 40, sketchId: sk });
  app.state.joints.set('as', { x: -25, y: 40, sketchId: sk });
  app.state.joints.set('ae', { x: -40, y: 55, sketchId: sk });
  app.state.shapes.push({ id: 'A1', type: 'arc', joints: ['ac', 'as', 'ae'], sweep: true, sketchId: sk });
  app.state.joints.set('ba', { x: 10, y: 0, sketchId: sk });
  app.state.joints.set('bb', { x: 50, y: 0, sketchId: sk });
  app.state.shapes.push({ id: 'B1', type: 'bezier', joints: ['ba', 'bb'], c1: [20, 20], c2: [40, -20], sketchId: sk });
  app.frames(2);
  app.tool('trim');
  clearToasts(app);
  clickW(app, -25, 0); // circle rim
  const trimCircle = readToasts(app);
  clearToasts(app);
  clickW(app, -40 + 15 * Math.SQRT1_2, 40 + 15 * Math.SQRT1_2); // arc mid
  const trimArc = readToasts(app);
  clearToasts(app);
  clickW(app, 30, 0); // bezier midpoint
  const trimBezier = readToasts(app);
  app.tool('break');
  clearToasts(app);
  clickW(app, -25, 0);
  const breakCircle = readToasts(app);
  clearToasts(app);
  clickW(app, -40 + 15 * Math.SQRT1_2, 40 + 15 * Math.SQRT1_2);
  const breakArc = readToasts(app);
  clearToasts(app);
  clickW(app, 30, 0);
  const breakBezier = readToasts(app);
  console.log('CROSS UX-25 (TRIM/BREAK CIRCLE/ARC vs BEZIER):', JSON.stringify({ trimCircle, trimArc, trimBezier, breakCircle, breakArc, breakBezier }));
  await app.close();
}

// ===========================================================================
// UX-26: Fillet on two locked lines -> selectionLockState(L1).locked === false
// ===========================================================================
{
  const app = await openApp({ app: 'sketchstudio' });
  const sk = app.state.activeSketchId || 'sketch-1';
  app.state.joints.set('a', { x: 0, y: 0, fixed: true, sketchId: sk });
  app.state.joints.set('b', { x: 50, y: 0, fixed: true, sketchId: sk });
  app.state.joints.set('c', { x: 50, y: 50, fixed: true, sketchId: sk });
  app.state.shapes.push(
    { id: 'L1', type: 'line', joints: ['a', 'b'], sketchId: sk },
    { id: 'L2', type: 'line', joints: ['b', 'c'], sketchId: sk }
  );
  applyFillet(app.state, findCornerAtJoint(app.state, 'b'), 10);
  app.state.selectedShapes.clear();
  app.state.selectedShapes.add('L1');
  const ls = selectionLockState(app.state);
  const st = analyzeConstraintStatus(app.state);
  console.log('CROSS UX-26 (FILLET ON LOCKED LINES LOCK STATE):', JSON.stringify({
    selectionLockState: ls, l1InFixedShapes: st.fixedShapes.has('L1'),
  }));
  await app.close();
}

// ===========================================================================
// UX-28: Degenerate triangle (30,40,10) refused edit drifts 0.0018 mm on revert()
// ===========================================================================
{
  const app = await openApp({ app: 'sketchstudio' });
  const sk = app.state.activeSketchId || 'sketch-1';
  app.state.joints.set('a', { x: 0, y: 0, fixed: true, sketchId: sk });
  app.state.joints.set('b', { x: 30, y: 0, fixed: true, sketchId: sk });
  app.state.joints.set('c', { x: -10, y: 0, sketchId: sk });
  app.state.shapes.push(
    { id: 'L1', type: 'line', joints: ['a', 'b'], sketchId: sk },
    { id: 'L2', type: 'line', joints: ['b', 'c'], sketchId: sk },
    { id: 'L3', type: 'line', joints: ['c', 'a'], sketchId: sk }
  );
  ConstraintManager.createConstraint(app.state, CONSTRAINT_TYPES.DISTANCE, { joints: ['a', 'b'], value: 30, name: 'd1' });
  ConstraintManager.createConstraint(app.state, CONSTRAINT_TYPES.DISTANCE, { joints: ['b', 'c'], value: 40, name: 'd2' });
  const d3 = ConstraintManager.createConstraint(app.state, CONSTRAINT_TYPES.DISTANCE, { joints: ['c', 'a'], value: 10, name: 'd3' });
  app.state.engine.solve(500);
  const cBefore = { ...app.state.joints.get('c') };
  const res = commitDimensionEdits(app.state, [{ c: d3, value: 5 }], { engine: app.state.engine });
  const cAfter = { ...app.state.joints.get('c') };
  const drift = Math.hypot(cAfter.x - cBefore.x, cAfter.y - cBefore.y);
  console.log('CROSS UX-28 (DEGENERATE TRIANGLE REVERT DRIFT):', JSON.stringify({
    reverted: !res.ok, reason: res.reason,
    cBefore: [+cBefore.x.toFixed(6), +cBefore.y.toFixed(6)],
    cAfter: [+cAfter.x.toFixed(6), +cAfter.y.toFixed(6)],
    driftMm: +drift.toFixed(6),
  }));
  await app.close();
}

// ===========================================================================
// DIV-02, DIV-03, DIV-04 verification
// ===========================================================================
{
  const app = await openApp({ app: 'sketchstudio' });
  setView(app, 25, 20, 80);
  const r = makeRect(app, 0, 0, 50, 40);
  app.state.joints.get(r.joints[0]).fixed = true;
  const parRes = ConstraintManager.createConstraint(app.state, CONSTRAINT_TYPES.PARALLEL, { shapes: [r.lines[0], r.lines[2]] }, { source: 'toolbar' });
  const eqRes = ConstraintManager.createConstraint(app.state, CONSTRAINT_TYPES.EQUAL, { shapes: [r.lines[0], r.lines[2]] }, { source: 'toolbar' });
  // DIV-03: double-click reference dim
  const refDim = ConstraintManager.createConstraint(app.state, CONSTRAINT_TYPES.DISTANCE, { joints: [r.joints[0], r.joints[1]], value: 50, isDriven: true, driven: true });
  clearToasts(app);
  showEditInput(app.svg, app.state, refDim);
  const refOpened = !app.document.getElementById('dimInput').classList.contains('hidden');
  const refToasts = readToasts(app);
  // DIV-04: bezier end drag vs body drag
  const sk = app.state.activeSketchId || 'sketch-1';
  app.state.joints.set('za', { x: -40, y: 0, sketchId: sk });
  app.state.joints.set('zb', { x: -10, y: 0, sketchId: sk });
  const bz = { id: 'BZ', type: 'bezier', joints: ['za', 'zb'], c1: [-30, 15], c2: [-20, -15], sketchId: sk };
  app.state.shapes.push(bz);
  app.frames(2);
  const c1BeforeEnd = [...bz.c1];
  dragW(app, -40, 0, -40, 20, 5);
  const c1AfterEnd = [...bz.c1];
  console.log('CROSS DIV-02/03/04:', JSON.stringify({
    div02RedundantParAccepted: !!parRes, div02RedundantEqAccepted: !!eqRes,
    div03RefEditOpened: refOpened, div03RefToasts: refToasts,
    div04EndDragC1Delta: [+(c1AfterEnd[0] - c1BeforeEnd[0]).toFixed(2), +(c1AfterEnd[1] - c1BeforeEnd[1]).toFixed(2)],
  }));
  await app.close();
}
