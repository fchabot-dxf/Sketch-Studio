// tests/driving-reference-1006-node.test.js - TASK 1006 (SketchStudio through tests/helpers/node-app.js): the Driving / Reference switch and the
// undo of switches and locks. Each section guards one audit bug (docs/SOLVER-UX-AUDIT-1000.md UX-, 1000B B-, docs/DIMENSION-AUDIT-1003.md D-):
//   1. UX-01 = B-2 = D-17  promoting an H or V reference dimension on a diagonal keeps its own measured value (|dx| / |dy|), the shape does not jump
//   2. B-3                 promoting a MOVED line-line or point-to-axis reference keeps its current value (no snap back to the value it was born with)
//   3. D-4                 promoting an angle-to-axis reference keeps the line where it is (it collapsed to the origin)
//   4. UX-08 = B-4 = D-19  Driving <-> Reference (context menu) and Lock / Unlock (F, the ribbon Lock, the context menu) are each ONE undo step;
//                          undo brings a dimension's formula back; a refused switch records no step
//   5. UX-16               double-clicking a driving dimension the sketch already determines opens its value box (never a silent demotion);
//                          a value it cannot take is refused with a notice and nothing changes
//   6. DIV-03 / DD-3       double-clicking a Reference dimension opens its value box READ-ONLY, showing what its label shows; Enter / Esc / a
//                          press outside close it and change nothing (a just-placed reference is not deleted by Esc)
//   7. B-9 = D-25          a redundant ANGLE dimension is born Reference, as a redundant distance is; a free one is still born Driving
// Every section runs (a failure is collected, not thrown at once) so the fail-first run shows each bug.
import assert from 'node:assert';
import { open } from './helpers/node-app.js';
import { labelEl, labelPoint, boxOpen } from './helpers/node-dom-read.js';
import { deserializeDocument } from '#core/document.js';
import { fitToDrawing } from '#ui/input-handlers/pan-zoom.js';
import { CONSTRAINT_TYPES } from '#core/constants.js';
import { ConstraintManager } from '#core/constraint-manager.js';
import { toggleDriving, isDimensionDetermined } from '#core/dimension-seams.js';

const near = (a, b, m, eps = 1e-3) => assert.ok(Math.abs(a - b) <= eps, `${m}: got ${a}, expected ${b}`);
const failures = [];
async function section(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failures.push(name); console.log(`FAIL ${name}\n     ${(e && e.message || String(e)).split('\n')[0]}`); }
}

const app = await open({ host: 'sketchstudio', width: 1280, height: 800 });
const st = app.state;
const dim = (name) => st.constraints.find((c) => c.name === name);
const joint = (id) => st.joints.get(id);
const toasts = () => [...app.document.querySelectorAll('#notification-container pre, #notification-container [data-level]')].map((e) => e.textContent.trim()).filter(Boolean);
const clearToasts = () => { const n = app.document.getElementById('notification-container'); if (n) n.innerHTML = ''; };
const box = () => app.document.getElementById('dimInput');
const hint = () => app.document.getElementById('dimHint');
/** load a design: joints { id: [x, y, fixed] }, shapes (lines), constraints; fit the view, select tool, nothing selected */
function load(jointsSpec, shapes = [], constraints = []) {
  if (boxOpen(app)) app.esc();
  const joints = Object.entries(jointsSpec).map(([id, [x, y, fixed]]) => [id, { x, y, fixed: !!fixed }]);
  assert.ok(deserializeDocument({ version: 3, geometry: { joints, shapes, constraints } }, st).ok, 'the design loads');
  st.selectedJoints.clear(); st.selectedShapes.clear(); if (st.selectedConstraints) st.selectedConstraints.clear();
  app.tool('select');
  fitToDrawing(app.svg, st);
  app.frames(3);
  clearToasts();
}
const line = (id, a, b) => ({ id, type: 'line', joints: [a, b] });
const labelOf = (c) => { const idx = st.constraints.indexOf(c); return { idx, ...labelPoint(app, idx) }; };
async function dblClickDim(c) {
  await app.pause(550); // the app pairs clicks into a double click by their time: start a fresh pair
  const l = labelOf(c);
  app.dblclick(l.x, l.y, { target: () => labelEl(app, l.idx) });
  app.frames(2);
}
function contextMenuItem(c, id) {
  const l = labelOf(c);
  app.rightClick(l.x, l.y, { target: () => labelEl(app, l.idx) });
  const item = app.document.querySelector(`.sk-context-menu .sk-context-item[data-id="${id}"]`);
  assert.ok(item, `the context menu has ${id}`);
  item.click(); app.frames(2);
}

try {
  await section('1. UX-01 = B-2 = D-17: H / V reference on a diagonal promotes at its own value', () => {
    for (const [mode, value] of [['horizontal', 30], ['vertical', 40]]) {
      load({ a: [0, 0, true], b: [30, 40] }, [line('L1', 'a', 'b')],
        [{ type: 'distance', joints: ['a', 'b'], value, dimMode: mode, offset: 20, isDriven: true, driven: true, name: 'd1' }]);
      const res = toggleDriving(st, dim('d1'));
      assert.strictEqual(res.refused, false, `${mode}: not refused`);
      near(dim('d1').value, value, `${mode}: the promoted value is its own measured value, not the diagonal 50`);
      near(joint('b').x, 30, `${mode}: b.x did not move`); near(joint('b').y, 40, `${mode}: b.y did not move`);
    }
  });

  await section('2. B-3: a moved line-line / point-to-axis reference promotes at its current value', () => {
    load({ a: [0, 0, true], b: [60, 0, true], c: [0, 55], d: [60, 55] }, [line('L1', 'a', 'b'), line('L2', 'c', 'd')],
      [{ type: 'parallel', shapes: ['L1', 'L2'] }, { type: 'distance', shapes: ['L1', 'L2'], value: 20, isDriven: true, driven: true, name: 'd1' }]);
    assert.strictEqual(toggleDriving(st, dim('d1')).refused, false, 'line-line: not refused');
    near(dim('d1').value, 55, 'line-line: promoted at the current 55, not the born 20');
    near(joint('c').y, 55, 'line-line: c stayed'); near(joint('d').y, 55, 'line-line: d stayed');

    load({ p: [30, 60] }, [], [{ type: 'distance', joints: ['p', 'j_origin', 'j_ref_x'], value: 25, isDriven: true, driven: true, name: 'd1' }]);
    assert.strictEqual(toggleDriving(st, dim('d1')).refused, false, 'point-to-axis: not refused');
    near(dim('d1').value, 60, 'point-to-axis: promoted at the current 60, not the born 25');
    near(joint('p').y, 60, 'point-to-axis: p stayed');
  });

  await section('3. D-4: an angle-to-axis reference promotes at its current angle, the line stays', () => {
    for (const [axis, deg] of [['ref_axis_x', 60], ['ref_axis_y', 30]]) {
      load({ a: [0, 0, true], b: [30, 51.961524] }, [line('L1', 'a', 'b')],
        [{ type: 'angle', shapes: ['L1', axis], value: 15, offset: 25, isDriven: true, driven: true, name: 'd1' }]);
      assert.strictEqual(toggleDriving(st, dim('d1')).refused, false, `${axis}: not refused`);
      near(dim('d1').value, deg, `${axis}: promoted at the current ${deg} degrees`, 0.05);
      near(joint('b').x, 30, `${axis}: b.x stayed`, 0.01); near(joint('b').y, 51.961524, `${axis}: b.y stayed`, 0.01);
    }
  });

  await section('4a. UX-08 = B-4 = D-19: Driving -> Reference (context menu) is one undo step; undo brings the formula back', () => {
    load({ a: [0, 0, true], b: [60, 0], c: [0, 40, true], d: [30, 40] }, [line('L1', 'a', 'b'), line('L2', 'c', 'd')], [
      { type: 'horizontal', joints: ['a', 'b'] }, { type: 'horizontal', joints: ['c', 'd'] },
      { type: 'distance', joints: ['a', 'b'], value: 60, dimMode: 'horizontal', offset: -20, name: 'd1' },
      { type: 'distance', joints: ['c', 'd'], value: 30, dimMode: 'horizontal', offset: 20, expression: 'd1 / 2', name: 'd2' },
    ]);
    const h0 = st.history.length;
    contextMenuItem(dim('d2'), 'dim-reference');
    assert.strictEqual(dim('d2').isDriven, true, 'd2 is a reference');
    assert.strictEqual(dim('d2').expression, undefined, 'its formula is cleared (O11)');
    assert.strictEqual(st.history.length, h0 + 1, 'the switch is ONE undo step');
    app.undo();
    assert.strictEqual(dim('d2').isDriven, false, 'undo: d2 drives again');
    assert.strictEqual(dim('d2').expression, 'd1 / 2', 'undo: its formula is back');
    app.redo();
    assert.strictEqual(dim('d2').isDriven, true, 'redo: a reference again');
    app.undo();
    // refused: d1 is read by d2's formula (O9): nothing changes, no undo step, the redo branch is kept
    const h1 = st.history.length, r1 = st.redoStack.length;
    contextMenuItem(dim('d1'), 'dim-reference');
    assert.strictEqual(dim('d1').isDriven, false, 'refused: d1 still drives');
    assert.strictEqual(st.history.length, h1, 'refused: no undo step');
    assert.strictEqual(st.redoStack.length, r1, 'refused: the redo branch is kept');
    // Reference -> Driving is one undo step too
    load({ a: [0, 0, true], b: [30, 40] }, [line('L1', 'a', 'b')],
      [{ type: 'distance', joints: ['a', 'b'], value: 50, offset: 20, isDriven: true, driven: true, name: 'd1' }]);
    const h2 = st.history.length;
    contextMenuItem(dim('d1'), 'dim-driving');
    assert.strictEqual(dim('d1').isDriven, false, 'd1 drives');
    assert.strictEqual(st.history.length, h2 + 1, 'Reference -> Driving is ONE undo step');
    app.undo();
    assert.strictEqual(dim('d1').isDriven, true, 'undo: a reference again');
  });

  await section('4b. UX-08 = B-4: Lock / Unlock by F, the ribbon Lock and the context menu are each one undo step', () => {
    load({ a: [0, 0, true], b: [60, 0], c: [0, 30], e: [60, 30] }, [line('L1', 'a', 'b'), line('L2', 'c', 'e')]);
    const p = app.toScreen(60, 0);
    // F on the selected point b
    app.click(p.x, p.y);
    assert.ok(st.selectedJoints.has('b'), 'b is selected');
    let h = st.history.length;
    app.key('f');
    assert.strictEqual(joint('b').fixed, true, 'F locks b');
    assert.strictEqual(st.history.length, h + 1, 'F: ONE undo step');
    app.undo();
    assert.strictEqual(joint('b').fixed, false, 'undo unlocks b');
    assert.ok(st.shapes.some((s) => s.id === 'L2'), 'undo did not take anything else back');
    app.redo();
    assert.strictEqual(joint('b').fixed, true, 'redo locks b again');
    // the ribbon Lock (b selected and locked: unlock)
    st.selectedJoints.clear(); st.selectedJoints.add('b'); app.frames();
    h = st.history.length;
    const btn = app.document.getElementById('btn-lock');
    assert.ok(btn, 'the ribbon has the Lock button');
    btn.click(); app.frames();
    assert.strictEqual(joint('b').fixed, false, 'the ribbon Lock unlocks b');
    assert.strictEqual(st.history.length, h + 1, 'ribbon: ONE undo step');
    app.undo();
    assert.strictEqual(joint('b').fixed, true, 'undo locks b again');
    // the context menu Lock on the point
    h = st.history.length;
    app.rightClick(p.x, p.y);
    const item = app.document.querySelector('.sk-context-menu .sk-context-item[data-id="geo-lock"]');
    assert.ok(item, 'the context menu has Lock');
    item.click(); app.frames();
    assert.strictEqual(joint('b').fixed, false, 'the context menu unlocks b');
    assert.strictEqual(st.history.length, h + 1, 'context menu: ONE undo step');
    app.undo();
    assert.strictEqual(joint('b').fixed, true, 'undo locks b again');
  });

  await section('5. UX-16: double-clicking a determined driving dimension opens its box, never demotes it', async () => {
    load({ a: [0, 0, true], b: [50, 0, true] }, [line('L1', 'a', 'b')],
      [{ type: 'distance', joints: ['a', 'b'], value: 50, dimMode: 'horizontal', offset: -20, name: 'd1' }]);
    assert.strictEqual(isDimensionDetermined(st, dim('d1')), true, 'precondition: the locked ends determine d1');
    const h0 = st.history.length;
    for (const tool of ['select', 'dim']) {
      app.tool(tool);
      await dblClickDim(dim('d1'));
      assert.strictEqual(boxOpen(app), true, `${tool}: the value box opens`);
      assert.strictEqual(box().readOnly, false, `${tool}: it can be typed`);
      assert.strictEqual(box().value, '50', `${tool}: it shows 50`);
      assert.strictEqual(dim('d1').isDriven, false, `${tool}: d1 still drives`);
      app.esc();
      assert.strictEqual(boxOpen(app), false, `${tool}: Esc closes it`);
      assert.ok(st.constraints.includes(dim('d1')), `${tool}: Esc kept d1`);
      assert.strictEqual(st.history.length, h0, `${tool}: no undo step`);
    }
    app.tool('select');
    await dblClickDim(dim('d1'));
    clearToasts();
    const i = box(); i.focus(); i.select(); i.value = '70'; i.dispatchEvent(new app.window.Event('input', { bubbles: true }));
    app.enter();
    assert.strictEqual(boxOpen(app), false, '70: the box closed');
    near(dim('d1').value, 50, '70: refused, d1 keeps 50');
    assert.strictEqual(dim('d1').isDriven, false, '70: d1 still drives');
    near(joint('b').x, 50, '70: the geometry did not move');
    assert.strictEqual(st.history.length, h0, '70: no undo step');
    assert.ok(toasts().length > 0, '70: the refusal is told: ' + JSON.stringify(toasts()));
  });

  await section('6. DIV-03 / DD-3: double-clicking a Reference dimension opens its box read-only', async () => {
    // a moved horizontal reference on a diagonal: born 10, its label shows the current |dx| 30
    load({ a: [0, 0, true], b: [30, 40] }, [line('L1', 'a', 'b')],
      [{ type: 'distance', joints: ['a', 'b'], value: 10, dimMode: 'horizontal', offset: 20, isDriven: true, driven: true, name: 'd1' }]);
    const h0 = st.history.length;
    for (const [tool, close] of [['select', 'enter'], ['dim', 'esc'], ['select', 'outside']]) {
      app.tool(tool);
      await dblClickDim(dim('d1'));
      assert.strictEqual(boxOpen(app), true, `${tool}: the box opens`);
      assert.strictEqual(box().readOnly, true, `${tool}: read-only`);
      assert.strictEqual(box().value, '30', `${tool}: it shows what the label shows (30)`);
      assert.ok(hint() && !hint().classList.contains('hidden') && /reference/i.test(hint().textContent), `${tool}: the hint says why: ${hint() && hint().textContent}`);
      if (close === 'enter') app.enter();
      else if (close === 'esc') app.esc();
      else { const far = app.toScreen(-60, 60); app.click(far.x, far.y); }
      assert.strictEqual(boxOpen(app), false, `${tool}: ${close} closes it`);
      assert.strictEqual(box().readOnly, false, `${tool}: the box is typeable again for the next dimension`);
      assert.strictEqual(dim('d1').isDriven, true, `${tool}: still a reference`);
      near(dim('d1').value, 10, `${tool}: its value untouched`);
      near(joint('b').x, 30, `${tool}: the geometry untouched`);
      assert.strictEqual(st.history.length, h0, `${tool}: no undo step`);
    }
    // a JUST-PLACED reference (a dimension on a line with both ends locked): Esc on its read-only box does not delete it
    load({ a: [0, 0, true], b: [60, 0, true] }, [line('L1', 'a', 'b')]);
    app.tool('dim');
    const m = app.toScreen(30, 0), drop = app.toScreen(30, -15);
    app.click(m.x, m.y); app.move(drop.x, drop.y); app.click(drop.x, drop.y);
    assert.strictEqual(boxOpen(app), false, 'placing a reference opens no box');
    const placed = st.constraints.find((c) => c.type === CONSTRAINT_TYPES.DISTANCE);
    assert.ok(placed && placed.isDriven, 'the placed dimension is a reference');
    await dblClickDim(placed);
    assert.strictEqual(boxOpen(app), true, 'its box opens');
    assert.strictEqual(box().readOnly, true, 'read-only');
    assert.strictEqual(box().value, '60', 'it shows 60');
    app.esc();
    assert.ok(st.constraints.includes(placed), 'Esc did not delete the placed reference');
  });

  await section('7. B-9 = D-25: a redundant angle is born Reference, a free one Driving', () => {
    load({ a: [0, 0, true], b: [60, 0], c: [0, 50] }, [line('L1', 'a', 'b'), line('L2', 'a', 'c')],
      [{ type: 'horizontal', joints: ['a', 'b'] }, { type: 'vertical', joints: ['a', 'c'] }]);
    const hv = ConstraintManager.createConstraint(st, CONSTRAINT_TYPES.ANGLE, { shapes: ['L1', 'L2'], value: 90 });
    assert.ok(hv, 'the angle on an H and a V line is added');
    assert.strictEqual(hv.isDriven, true, 'on an H and a V line (90 already determined) it is born Reference');
    assert.strictEqual(hv.driven, true, 'both flags');
    load({ a: [0, 0, true], b: [60, 0, true], c: [30, 51.961524] }, [line('L1', 'a', 'b'), line('L2', 'b', 'c'), line('L3', 'c', 'a')],
      [{ type: 'distance', joints: ['b', 'c'], value: 60, name: 'd1' }, { type: 'distance', joints: ['c', 'a'], value: 60, name: 'd2' }]);
    const tri = ConstraintManager.createConstraint(st, CONSTRAINT_TYPES.ANGLE, { shapes: ['L1', 'L3'], value: 60 });
    assert.ok(tri, 'the angle in the dimensioned triangle is added');
    assert.strictEqual(tri.isDriven, true, 'in a triangle its three sides determine, it is born Reference');
    // the same distance rule, for comparison: a redundant distance is born Reference
    const side = ConstraintManager.createConstraint(st, CONSTRAINT_TYPES.DISTANCE, { joints: ['a', 'b'], value: 60 });
    assert.ok(side && side.isDriven, 'a redundant distance is born Reference (the one rule)');
    load({ a: [0, 0, true], b: [60, 0, true], c: [30, 51.961524] }, [line('L1', 'a', 'b'), line('L2', 'a', 'c')]);
    const free = ConstraintManager.createConstraint(st, CONSTRAINT_TYPES.ANGLE, { shapes: ['L1', 'L2'], value: 60 });
    assert.ok(free, 'the free angle is added');
    assert.strictEqual(free.isDriven, false, 'a free angle is born Driving');
  });
} finally {
  await app.close();
}
if (failures.length) { console.error(`driving-reference-1006-node: ${failures.length} section(s) failed: ${failures.join(' | ')}`); process.exitCode = 1; }
else console.log('driving-reference-1006-node: all sections ok');
