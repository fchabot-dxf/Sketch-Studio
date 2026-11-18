// tests/fillet-session-678-node.test.js -- TASK 678: multi-corner Fillet session + applyFillet({ equalTo }) + equal edit/delete/undo.
import assert from 'node:assert';
import * as L from './harness/audit/lib.js';
import { applyFillet, findCornerAtPoint } from '#core/fillet.js';
import { ConstraintManager } from '#core/constraint-manager.js';
import { deleteConstraints } from '#core/delete-manager.js';
import { previewDimensionInput } from '#core/parameters.js';
import { applyParameterChange } from '#core/dimension-seams.js';
import { open } from './helpers/node-app.js';
import { CONSTRAINT_TYPES } from '#core/constants.js';

const arcRadius = (S, arc) => {
  const c = S.state.joints.get(arc.joints[0]);
  const r = S.state.joints.get(arc.joints[1]);
  return Math.hypot(r.x - c.x, r.y - c.y);
};
const equalShapePairs = (constraints) =>
  (constraints || []).filter((c) => c && c.type === CONSTRAINT_TYPES.EQUAL && Array.isArray(c.shapes) && c.shapes.length === 2);

// ---- Part 1: Core applyFillet({ equalTo }), 0 DOF, editing first radius, deleting EQUAL ----
{
  const S = L.newSketch();
  const p0 = L.point(S, 0, 0);
  S.state.joints.get(p0).fixed = true;
  const p1 = L.point(S, 40, 0);
  const p2 = L.point(S, 40, 30);
  const p3 = L.point(S, 0, 30);
  L.shape(S, L.line(S, p0, p1));
  L.shape(S, L.line(S, p1, p2));
  L.shape(S, L.line(S, p2, p3));
  L.shape(S, L.line(S, p3, p0));
  ConstraintManager.createConstraint(S.state, 'horizontal', { joints: [p0, p1] });
  ConstraintManager.createConstraint(S.state, 'horizontal', { joints: [p3, p2] });
  ConstraintManager.createConstraint(S.state, 'vertical', { joints: [p1, p2] });
  ConstraintManager.createConstraint(S.state, 'vertical', { joints: [p0, p3] });
  ConstraintManager.createConstraint(S.state, 'distance', { joints: [p0, p1], value: 40 });
  ConstraintManager.createConstraint(S.state, 'distance', { joints: [p0, p3], value: 30 });
  const baseSolve = S.engine.solve(L.ITER);
  assert.strictEqual(baseSolve.converged && !baseSolve.rankDeficient, true, 'baseline rectangle is 0 DOF');

  // Corner 1: normal applyFillet (gets driving radius dimension)
  const c0 = findCornerAtPoint(S.state, { x: 40, y: 0 }, 1);
  const res0 = applyFillet(S.state, c0, 5);
  assert.ok(res0 && res0.success && res0.radiusConstraint, 'first fillet creates radiusConstraint');
  assert.strictEqual(S.engine.jointFreedom().nullity, 0, 'after 1st fillet: 0 DOF');

  // Corner 2 & Corner 3: { equalTo: res0.arc.id } (adds EQUAL constraint instead of radius dim)
  const c1 = findCornerAtPoint(S.state, { x: 40, y: 30 }, 1);
  const res1 = applyFillet(S.state, c1, 5, { equalTo: res0.arc.id });
  assert.ok(res1 && res1.success, '2nd fillet with equalTo succeeds: ' + (res1 && res1.reason));
  assert.strictEqual(res1.radiusConstraint, null, '2nd fillet with equalTo creates no radiusConstraint');
  assert.ok(res1.equalConstraint && res1.equalConstraint.type === CONSTRAINT_TYPES.EQUAL, '2nd fillet returns EQUAL constraint');
  assert.strictEqual(S.engine.jointFreedom().nullity, 0, 'after 2nd equal fillet: 0 DOF');

  const c2 = findCornerAtPoint(S.state, { x: 0, y: 30 }, 1);
  const res2 = applyFillet(S.state, c2, 5, { equalTo: res0.arc.id });
  assert.ok(res2 && res2.success, '3rd fillet with equalTo succeeds: ' + (res2 && res2.reason));
  assert.strictEqual(res2.radiusConstraint, null, '3rd fillet creates no radiusConstraint');
  assert.strictEqual(S.engine.jointFreedom().nullity, 0, 'after 3rd equal fillet: 0 DOF');

  assert.strictEqual(S.state.constraints.filter((c) => c.isRadius).length, 1, 'exactly 1 radius dimension for all 3 corners');
  assert.strictEqual(equalShapePairs(S.state.constraints).length, 2, 'exactly 2 EQUAL constraints on the 2 later arcs');

  // Changing first fillet's radius dimension moves ALL 3 equal arcs
  const pvUp = previewDimensionInput(S.state, res0.radiusConstraint, '10', { unit: 'mm' });
  assert.strictEqual(pvUp.ok, true);
  const editUp = applyParameterChange(S.state, pvUp.plan, 'edit fillet radius', { snapshot: false });
  assert.strictEqual(editUp.ok, true, 'edit R=10 succeeds: ' + editUp.reason);
  for (const [idx, r] of [res0, res1, res2].entries()) {
    assert.ok(Math.abs(arcRadius(S, r.arc) - 10) < 1e-4, `arc ${idx} moved to R=10, got ${arcRadius(S, r.arc)}`);
  }

  // Exact shared-leg collapse (15 + 15 = 30 on 30mm leg) is refused and reverted cleanly
  const pvCollapse = previewDimensionInput(S.state, res0.radiusConstraint, '15', { unit: 'mm' });
  assert.strictEqual(pvCollapse.ok, true);
  const editCollapse = applyParameterChange(S.state, pvCollapse.plan, 'collapse radius', { snapshot: false });
  assert.strictEqual(editCollapse.ok, false, 'collapsing shared leg between equal fillets is refused');
  assert.strictEqual(editCollapse.reverted, true, 'collapse refusal sets reverted=true');
  for (const [idx, r] of [res0, res1, res2].entries()) {
    assert.ok(Math.abs(arcRadius(S, r.arc) - 10) < 1e-4, `after refused collapse arc ${idx} stayed at R=10`);
  }

  // Bad equalTo target refuses cleanly with zero dangling shapes
  const shapesBeforeBad = S.state.shapes.length;
  const c3 = findCornerAtPoint(S.state, { x: 0, y: 0 }, 1);
  const badRes = applyFillet(S.state, c3, 5, { equalTo: 'no_such_arc' });
  assert.strictEqual(badRes.success, false, 'bad equalTo refuses cleanly');
  assert.strictEqual(S.state.shapes.length, shapesBeforeBad, 'bad equalTo leaves state.shapes untouched');

  // Deleting ONE equal constraint frees ONLY that corner's arc (1 DOF) and leaves the other equal arc coupled
  deleteConstraints(S.state, [res2.equalConstraint]);
  assert.strictEqual(equalShapePairs(S.state.constraints).length, 1, 'deleting equal constraint leaves 1 equal pair');
  assert.strictEqual(S.engine.jointFreedom().nullity, 1, 'deleting equal constraint frees 1 DOF on that corner');
  const pvShrink = previewDimensionInput(S.state, res0.radiusConstraint, '6', { unit: 'mm' });
  assert.strictEqual(pvShrink.ok, true);
  const editShrink = applyParameterChange(S.state, pvShrink.plan, 'edit after delete equal', { snapshot: false });
  assert.strictEqual(editShrink.ok, true, 'edit to 6 succeeds after freeing 3rd corner: ' + editShrink.reason);
  assert.ok(Math.abs(arcRadius(S, res0.arc) - 6) < 1e-4, 'arc 0 updated to 6');
  assert.ok(Math.abs(arcRadius(S, res1.arc) - 6) < 1e-4, 'arc 1 still equal -> updated to 6');
  assert.ok(Math.abs(arcRadius(S, res2.arc) - 10) < 1e-4, `freed arc 2 kept its own radius ~10, got ${arcRadius(S, res2.arc)}`);
}

// ---- Part 2: Fillet tool session (multi-pick while open, 1 undo step, Esc, Enter-between, 675 C, 666 invalid) ----
const app = await open({ host: 'sketchstudio' });
try {
  const st = app.state, doc = app.document;
  const O = app.toScreen(0, 0);
  const P = (dx, dy) => ({ x: O.x + 200 + dx, y: O.y + 100 + dy });
  const dispatchCtrlZ = (el) => {
    const ev = new doc.defaultView.KeyboardEvent('keydown', {
      key: 'z', code: 'KeyZ', ctrlKey: true, shiftKey: false, bubbles: true, cancelable: true,
    });
    el.dispatchEvent(ev);
    app.frames();
    return ev;
  };
  const setBoxText = (el, text) => {
    el.value = text;
    el.dispatchEvent(new doc.defaultView.Event('input', { bubbles: true }));
    app.frames();
  };

  // Closed rectangle with 4 corners
  const corners = [P(-80, -60), P(80, -60), P(80, 60), P(-80, 60)];
  app.tool('line');
  for (const pt of corners) app.click(pt.x, pt.y);
  app.click(corners[0].x, corners[0].y);
  app.esc();
  assert.strictEqual(st.shapes.filter((s) => s.type === 'line').length, 4, '4-line rectangle built');
  const histBase = st.history.length;

  app.tool('fillet');
  // Click corner 0 -> box opens; click corner 1 & corner 2 while box stays open
  app.click(corners[0].x, corners[0].y);
  const fBox = doc.getElementById('fillet-radius-input');
  assert.ok(fBox, 'radius box opens on 1st corner');
  app.click(corners[1].x, corners[1].y);
  assert.strictEqual(doc.getElementById('fillet-radius-input'), fBox, 'same radius box stays open after 2nd corner');
  app.click(corners[2].x, corners[2].y);
  assert.strictEqual(doc.getElementById('fillet-radius-input'), fBox, 'same radius box stays open after 3rd corner');
  assert.strictEqual(doc.querySelectorAll('#fillet-tool-overlay path[d*=" A "]').length, 3, 'all 3 pending corners previewed');
  assert.strictEqual(st.history.length, histBase, '0 undo steps while picking corners');

  // 666 invalid check + 675 C Ctrl+Z restore inside multi-corner box
  setBoxText(fBox, '0');
  assert.strictEqual(fBox.getAttribute('aria-invalid'), 'true', '666 invalid marks box red');
  assert.strictEqual(doc.querySelector('.sk-done')?.disabled, true, '666 invalid disables check button');
  assert.strictEqual(doc.querySelectorAll('#fillet-tool-overlay path[d*=" A "]').length, 0, '666 invalid hides previews');
  dispatchCtrlZ(fBox);
  assert.strictEqual(fBox.value, '5', '675 C Ctrl+Z restores default 5 in one step');
  assert.strictEqual(fBox.getAttribute('aria-invalid'), 'false', 'aria-invalid cleared after Ctrl+Z');
  assert.strictEqual(doc.querySelector('.sk-done')?.disabled, false, '.sk-done re-enabled after Ctrl+Z');
  assert.strictEqual(doc.querySelectorAll('#fillet-tool-overlay path[d*=" A "]').length, 3, 'all 3 previews return after Ctrl+Z');

  // Esc cancels all 3 with zero fillets and zero history steps
  app.esc();
  assert.strictEqual(doc.getElementById('fillet-radius-input'), null, 'Esc closes box');
  assert.strictEqual(st.shapes.filter((s) => s.type === 'arc').length, 0, 'Esc applies 0 fillets');
  assert.strictEqual(st.history.length, histBase, 'Esc adds 0 history steps');

  // Re-pick 3 corners while box open, type 4, press Enter -> 1 radius dim + 2 equal constraints in 1 undo step
  app.click(corners[0].x, corners[0].y);
  app.click(corners[1].x, corners[1].y);
  app.click(corners[2].x, corners[2].y);
  const fBox2 = doc.getElementById('fillet-radius-input');
  setBoxText(fBox2, '4');
  fBox2.dispatchEvent(new doc.defaultView.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  assert.strictEqual(doc.getElementById('fillet-radius-input'), null, 'Enter closes box');
  assert.strictEqual(st.shapes.filter((s) => s.type === 'arc').length, 3, '3 arcs applied');
  assert.strictEqual(st.constraints.filter((c) => c.isRadius).length, 1, '1 radius dimension created');
  assert.strictEqual(equalShapePairs(st.constraints).length, 2, '2 EQUAL constraints created');
  assert.strictEqual(st.history.length, histBase + 1, 'all 3 fillets = 1 undo step');

  // One Undo removes all 3 fillets cleanly
  st.undo();
  assert.strictEqual(st.shapes.filter((s) => s.type === 'arc').length, 0, 'ONE undo removes all 3 arcs');
  assert.strictEqual(st.constraints.filter((c) => c.isRadius).length, 0, 'ONE undo removes radius dim');
  assert.strictEqual(equalShapePairs(st.constraints).length, 0, 'ONE undo removes EQUAL constraints');

  // Enter-between-corners: each corner gets its own radius dimension and its own undo step
  for (let i = 0; i < 3; i++) {
    app.click(corners[i].x, corners[i].y);
    const box = doc.getElementById('fillet-radius-input');
    assert.ok(box, `separate corner ${i} opens box`);
    box.dispatchEvent(new doc.defaultView.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  }
  assert.strictEqual(st.shapes.filter((s) => s.type === 'arc').length, 3, 'Enter-between creates 3 arcs');
  assert.strictEqual(st.constraints.filter((c) => c.isRadius).length, 3, 'Enter-between creates 3 radius dims');
  assert.strictEqual(equalShapePairs(st.constraints).length, 0, 'Enter-between creates 0 EQUAL constraints');
  assert.strictEqual(st.history.length, histBase + 3, 'Enter-between adds 3 undo steps');

  console.log('fillet-session-678-node: all checks passed');
} finally {
  app.close();
}
