// tests/offset-fusion-match-667.test.js -- TASK 667: Fusion parity for Offset:
//   1. Deleting an offset dimension keeps the offset constraint with free distance (dimensioned: false):
//      - not a dimension (isDimension === false, no label, no name), +1 DOF
//      - moving the source chain moves the offset copy with it
//      - dragging an offset piece changes distance d uniformly across every piece
//      - d <= 0 is rejected through the revert / snapshot path (drag stops at last good pose)
//      - a reverted trial solve restores c.value (no stale drift)
//      - save / load keeps dimensioned: false; legacy main files (no dimensioned prop) load dimensioned
//      - undo / redo of deleting the offset dimension
//      - re-adding a dimension (Dimension tool on the pair) makes d driving again
//   2. Offset tool ends after OK (Enter and green check -> TOOL_MODES.SELECT)
//   3. "an arc" grammar (ConstraintManager + dimension-seams both use "an arc", never "a arc")
import assert from 'node:assert';
import * as L from './harness/audit/lib.js';
import {
  offsetChainOf, offsetSideAt, applyOffset, findUndimensionedOffsetPair, restoreOffsetDimension, offsetResidual
} from '#core/offset.js';
import { deleteConstraints, deleteSelection } from '#core/delete-manager.js';
import { isDimension } from '#core/parameters.js';
import { serializeDocument, deserializeDocument } from '#core/document.js';
import { CONSTRAINT_TYPES, TOOL_MODES } from '#core/constants.js';
import { ConstraintManager, setConstraintNotifier } from '#core/constraint-manager.js';
import { commitDimensionEdit } from '#ui/dimension-seams.js';
import { snapshotSolverState, restoreSolverState } from '#core/solver/engine.js';
import { open, createProfile, createNamedDesign } from './helpers/node-app.js';
import { labelEl } from './helpers/node-dom-read.js';

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const near = (a, b, msg, tol = 1e-4) => ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);
const P = (st, id) => { const j = st.joints.get(id); return { x: j.x, y: j.y }; };
const pointToLineDist = (p, a, b) => {
  const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1;
  return Math.abs(((p.x - a.x) * dy - (p.y - a.y) * dx) / l);
};

// ---------------------------------------------------------------------------
// 1a. Core + solver: delete dim keeps relation, +1 DOF, uniform d drag, d <= 0 revert, snapshot/restore, re-add
// ---------------------------------------------------------------------------
{
  const S = L.newSketch();
  const j0 = L.point(S, 0, 0), j1 = L.point(S, 60, 0), j2 = L.point(S, 60, 40);
  for (const jid of [j0, j1, j2]) S.state.joints.get(jid).fixed = true;
  const s0 = L.line(S, j0, j1), s1 = L.line(S, j1, j2);
  const ch = offsetChainOf(S.state, s0);
  ok(ch.ok, 'chain found for L-shape');
  const side = offsetSideAt(S.state, ch.chain, { x: 30, y: 20 });
  const res = applyOffset(S.state, ch.chain, 10, side);
  ok(res.ok, 'applied 10mm offset to fixed L-chain');
  const offC = S.state.constraints.find((c) => c.type === CONSTRAINT_TYPES.OFFSET);
  ok(offC && isDimension(offC) === true, 'initially dimensioned offset is a dimension');

  // Initial DOF = 0
  const sDim = S.state.engine.solve(500);
  ok(sDim.converged && !sDim.rankDeficient, `dimensioned offset has 0 free DOF (rankDeficient=${sDim.rankDeficient})`);

  // Delete the offset dimension -> constraint stays with dimensioned: false and +1 DOF
  const delCount = deleteConstraints(S.state, [offC]);
  ok(delCount === 1, `deleteConstraints reports 1 change (${delCount})`);
  ok(S.state.constraints.includes(offC), 'offset constraint stays in state.constraints after dimension delete');
  ok(offC.dimensioned === false, 'offset constraint marked dimensioned: false');
  ok(isDimension(offC) === false, 'isDimension returns false for undimensioned offset');
  ok(!offC.name && !offC.expression, 'dimension name/expression cleared when dimension deleted');

  const sFree = S.state.engine.solve(500);
  ok(sFree.converged && sFree.rankDeficient === true, `undimensioned offset adds 1 DOF (rankDeficient=${sFree.rankDeficient})`);
  const copy0 = S.state.shapes.find((s) => s.id === offC.shapes[1]);
  const copy1 = S.state.shapes.find((s) => s.id === offC.shapes[3]);
  const src0 = S.state.shapes.find((s) => s.id === offC.shapes[0]);
  const src1 = S.state.shapes.find((s) => s.id === offC.shapes[2]);
  const jf = S.state.engine.jointFreedom();
  ok(jf && jf.nullity === 1 && jf.freedom.get(copy0.joints[0]) === 1, `undimensioned offset has nullity 1 & rank 1 endpoint freedom (nullity=${jf && jf.nullity}, rank=${jf && jf.freedom.get(copy0.joints[0])})`);

  // Dragging one piece changes d uniformly across both pieces of the L-chain
  const dragJointId = copy0.joints[0];
  const dragJ = S.state.joints.get(dragJointId);
  const rDrag = S.state.engine.solve(500, { dragTarget: { jointId: dragJointId, x: 20, y: 20 } });
  ok(rDrag.converged, `dragging undimensioned offset piece to d=20 converged (${rDrag.error})`);
  near(offC.value, 20, 'c.value updated to dragged distance 20', 1e-3);
  for (const [src, off] of [[src0, copy0], [src1, copy1]]) {
    const a = P(S.state, src.joints[0]), b = P(S.state, src.joints[1]);
    for (const qid of off.joints) near(pointToLineDist(P(S.state, qid), a, b), 20, `piece ${off.id} stayed at d=20`, 1e-3);
  }

  // d <= 0 must be rejected through the revert / snapshot path, stopping at the last good pose
  const beforeCrossValue = offC.value;
  const beforeCrossX = dragJ.x, beforeCrossY = dragJ.y;
  const rCross = S.state.engine.solve(500, { dragTarget: { jointId: dragJointId, x: -5, y: -5 } });
  ok(rCross.converged === false, 'drag step crossing d <= 0 rejected (converged: false)');
  ok(offC.value > 0 && Math.abs(offC.value - beforeCrossValue) < 1e-6, `c.value stayed at last good position ${beforeCrossValue} (got ${offC.value})`);
  near(dragJ.x, beforeCrossX, 'dragged joint X stopped at last good position');
  near(dragJ.y, beforeCrossY, 'dragged joint Y stopped at last good position');

  // Reverted trial solve restores c.value
  const snap = snapshotSolverState(S.state.joints, S.state.shapes, S.state.constraints);
  S.state.engine.solve(500, { dragTarget: { jointId: dragJointId, x: 28, y: 28 } });
  ok(Math.abs(offC.value - 28) < 1e-2, `trial solve moved c.value to ~28 (got ${offC.value})`);
  restoreSolverState(S.state.joints, S.state.shapes, snap);
  near(offC.value, beforeCrossValue, 'restoreSolverState restored c.value exactly', 1e-9);
  near(dragJ.y, beforeCrossY, 'restoreSolverState restored joint positions', 1e-9);

  // Save / load preserves dimensioned: false, while legacy offset without `dimensioned` loads dimensioned
  const savedDoc = serializeDocument(S.state);
  const Sreload = L.newSketch();
  const ld = deserializeDocument(savedDoc, Sreload.state);
  ok(ld.ok, 'deserializeDocument succeeded');
  const relOff = Sreload.state.constraints.find((c) => c.type === CONSTRAINT_TYPES.OFFSET);
  ok(relOff && relOff.dimensioned === false && isDimension(relOff) === false, 'reloaded offset stays undimensioned');
  const legacyDoc = serializeDocument(S.state);
  const legacyConstraint = legacyDoc.geometry.constraints.find((c) => c.type === CONSTRAINT_TYPES.OFFSET);
  delete legacyConstraint.dimensioned;
  legacyConstraint.name = 'd1';
  const Sleg = L.newSketch();
  deserializeDocument(legacyDoc, Sleg.state);
  const legOff = Sleg.state.constraints.find((c) => c.type === CONSTRAINT_TYPES.OFFSET);
  ok(legOff && legOff.dimensioned !== false && isDimension(legOff) === true, 'legacy offset without dimensioned prop loads as dimensioned');

  // Re-adding dimension makes d driving again (switch back to a sketch with offC restored cleanly)
  const S3 = L.newSketch();
  const k0 = L.point(S3, 0, 0), k1 = L.point(S3, 60, 0), k2 = L.point(S3, 60, 40);
  for (const jid of [k0, k1, k2]) S3.state.joints.get(jid).fixed = true;
  const ls0 = L.line(S3, k0, k1); L.line(S3, k1, k2);
  const ch3 = offsetChainOf(S3.state, ls0);
  applyOffset(S3.state, ch3.chain, 10, offsetSideAt(S3.state, ch3.chain, { x: 30, y: 20 }));
  const off3 = S3.state.constraints.find((c) => c.type === CONSTRAINT_TYPES.OFFSET);
  deleteConstraints(S3.state, [off3]);
  const offCopy0 = S3.state.shapes.find((s) => s.id === off3.shapes[1]);
  S3.state.engine.solve(500, { dragTarget: { jointId: offCopy0.joints[0], x: 20, y: 20 } });
  near(off3.value, 20, 'dragged undimensioned copy to 20 before re-adding dim', 1e-3);
  ok(findUndimensionedOffsetPair(S3.state.constraints, ls0, offCopy0.id) === off3, 'findUndimensionedOffsetPair finds undimensioned offset');
  restoreOffsetDimension(S3.state, off3);
  ok(isDimension(off3) === true && off3.dimensioned !== false && /^d\d+$/.test(off3.name), 'restoreOffsetDimension restores dimension');
  const sReDim = S3.state.engine.solve(500);
  ok(sReDim.converged && !sReDim.rankDeficient, 're-dimensioned offset returns to 0 free DOF');
  const ed = commitDimensionEdit(S3.state, off3, 12);
  ok(!ed.reverted, 'editing re-added dimension drives geometry cleanly');
  near(S3.state.joints.get(offCopy0.joints[0]).y, 12, 'edited re-added dimension drove offset copy to 12', 1e-3);
}

// ---------------------------------------------------------------------------
// 1b. Moving source chain moves closed undimensioned offset copy with it
// ---------------------------------------------------------------------------
{
  const S = L.newSketch();
  const rect = L.rect(S, 0, 0, 60, 40);
  const ch = offsetChainOf(S.state, rect.top);
  applyOffset(S.state, ch.chain, 8, offsetSideAt(S.state, ch.chain, { x: 30, y: 20 }));
  const rectOff = S.state.constraints.find((c) => c.type === CONSTRAINT_TYPES.OFFSET);
  deleteConstraints(S.state, [rectOff]);
  const copyTop = S.state.shapes.find((s) => s.id === rectOff.shapes[1]);
  const copyBeforeY = S.state.joints.get(copyTop.joints[0]).y;
  const rectJointIds = new Set(rect.lines.flatMap((id) => S.state.shapes.find((s) => s.id === id).joints));
  for (const jid of rectJointIds) {
    const j = S.state.joints.get(jid); j.x += 25; j.y += 15; j.fixed = true;
  }
  const rMove = S.state.engine.solve(500);
  ok(rMove.converged, `moving source rect moves closed undimensioned offset copy (${rMove.error})`);
  const copyAfterY = S.state.joints.get(copyTop.joints[0]).y;
  ok(copyAfterY > copyBeforeY + 10 && rectOff.value > 0, `closed undimensioned offset copy followed source move (y ${copyBeforeY} -> ${copyAfterY}, d=${rectOff.value})`);
  near(copyAfterY - 15, rectOff.value, 'all offset pieces share uniform free distance d', 1e-4);
  near(offsetResidual(rectOff, S.state.joints, S.state.shapes, () => 0), 0, 'closed offset residual 0 after source move', 1e-4);
}

// ---------------------------------------------------------------------------
// 2. Real app flow (node-app): delete dim key/selection, label hides, undo/redo,
//    re-add dim via Dimension tool, tool ends after Enter & touch check
// ---------------------------------------------------------------------------
{
  const profile = await createProfile();
  await createNamedDesign(profile, 'sketchstudio', 'Offset 667 node');
  const app = await open({ host: 'sketchstudio', profile });
  try {
    const st = app.state, doc = app.document;
    const r = app.svg.getBoundingClientRect();
    const C = { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    const at = (dx, dy) => ({ x: C.x + dx, y: C.y + dy });
    const click = (p, o) => app.click(p.x, p.y, o);
    for (let i = 0; i < 20 && Math.abs(app.toScreen(15, 0).x - app.toScreen(0, 0).x) > 100; i++) app.wheel(C.x, C.y, 300);

    // Draw L and fix source
    const P1 = at(-200, -150), P2 = at(-200, 120), P3 = at(150, 120);
    app.tool('line'); click(P1); click(P2); click(P3); app.esc();
    for (const s of st.shapes) for (const jid of s.joints) st.joints.get(jid).fixed = true;

    // Offset tool -> Enter -> MUST end tool and return to TOOL_MODES.SELECT
    app.tool('offset');
    click(at(-200, -20));
    app.move(C.x - 100, C.y - 20);
    const box = () => doc.getElementById('offset-distance-input');
    box().select(); app.type('10'); app.enter();
    ok(!box(), 'Enter closes offset box');
    ok(st.currentTool === TOOL_MODES.SELECT, `Offset tool ends after Enter -> Select (got ${st.currentTool})`);

    const offC = st.constraints.find((c) => c.type === CONSTRAINT_TYPES.OFFSET);
    const offIdx = st.constraints.indexOf(offC);
    ok(!!labelEl(app, offIdx), 'offset dimension label exists before delete');

    // Touch Offset -> green check -> MUST also end tool and return to TOOL_MODES.SELECT
    app.tool('offset');
    click(at(0, 120), { pointerType: 'touch' });
    click(at(0, 200), { pointerType: 'touch' });
    const check = doc.querySelector('.sk-done');
    ok(check && !check.hidden, 'green check visible on touch');
    check.click(); app.frames();
    ok(st.currentTool === TOOL_MODES.SELECT, `Offset tool ends after green check -> Select (got ${st.currentTool})`);
    app.undo();
    ok(st.constraints.filter((c) => c.type === CONSTRAINT_TYPES.OFFSET).length === 1, 'undo removed second offset cleanly');

    // Select the offset dimension and deleteSelection -> offset constraint remains with dimensioned: false, label gone
    const c1 = st.constraints.find((c) => c.type === CONSTRAINT_TYPES.OFFSET);
    st.selectedConstraints.clear();
    st.selectedConstraints.add(c1);
    deleteSelection(st);
    app.frames();
    ok(st.constraints.includes(c1) && c1.dimensioned === false, 'deleteSelection keeps offset constraint with dimensioned: false');
    ok(!labelEl(app, st.constraints.indexOf(c1)), 'dimension label removed after deleting offset dimension');

    // Undo / Redo deleting the offset dimension
    app.undo(); app.frames();
    const u1 = st.constraints.find((c) => c.type === CONSTRAINT_TYPES.OFFSET);
    ok(u1 && u1.dimensioned !== false && isDimension(u1) === true, 'Undo restores offset dimension');
    ok(!!labelEl(app, st.constraints.indexOf(u1)), 'Undo restores offset dimension label');
    app.redo(); app.frames();
    const r1 = st.constraints.find((c) => c.type === CONSTRAINT_TYPES.OFFSET);
    ok(r1 && r1.dimensioned === false && isDimension(r1) === false, 'Redo removes offset dimension again');
    ok(!labelEl(app, st.constraints.indexOf(r1)), 'Redo hides offset dimension label again');

    // Re-add dimension via Dimension tool by picking a source + offset parallel pair
    const sSrcId = r1.shapes[0], sOffId = r1.shapes[1];
    app.tool('select');
    st.selectedShapes.clear();
    st.selectedShapes.add(sSrcId);
    st.selectedShapes.add(sOffId);
    app.tool('dim');
    app.frames();
    ok(r1.dimensioned !== false && isDimension(r1) === true, 'Dimension tool on offset pair re-enabled offset dimension');
    // Drop placement click on canvas so edit box opens, then type 14 + Enter
    click(at(-100, -20));
    const dimInput = doc.getElementById('dimInput');
    ok(dimInput && !dimInput.classList.contains('hidden'), 'dimension edit box opens for re-added offset dimension');
    dimInput.select(); app.type('14'); app.enter();
    near(r1.value, 14, 're-added offset dimension drives value to 14', 1e-2);
  } finally { await app.close(); }
}

// ---------------------------------------------------------------------------
// 3. Grammar: "an arc" (ConstraintManager collapse warning + dimension-seams collapse reason)
// ---------------------------------------------------------------------------
{
  const S = L.newSketch();
  const q = L.point(S, 0, 0), c = L.point(S, 0, 0), p1 = L.point(S, 20, 0), p2 = L.point(S, 0, 20);
  S.state.joints.get(q).fixed = true;
  S.state.joints.get(c).fixed = true;
  S.state.shapes.push({ id: 'arc1', type: 'arc', joints: [c, p1, p2] });
  ConstraintManager.createConstraint(S.state, CONSTRAINT_TYPES.DISTANCE, { joints: [q, p1], value: 20 });
  const dArc = S.state.constraints[S.state.constraints.length - 1];
  const rCollapse = commitDimensionEdit(S.state, dArc, 0.001);
  ok(rCollapse.reverted && /\ban arc\b/.test(rCollapse.reason) && !/\ba arc\b/.test(rCollapse.reason),
    `dimension-seams says "an arc": ${rCollapse.reason}`);

  const S3 = L.newSketch();
  const cmMsgs = [];
  setConstraintNotifier((m) => cmMsgs.push(String(m)));
  const c3 = L.point(S3, 0, 0), a3 = L.point(S3, 20, 0), b3 = L.point(S3, 0, 20);
  S3.state.joints.get(c3).fixed = true;
  S3.state.shapes.push({ id: 'arc1', type: 'arc', joints: [c3, a3, b3] });
  ConstraintManager.createConstraint(S3.state, CONSTRAINT_TYPES.COINCIDENT, { joints: [a3, b3] }, { skipVerify: true });
  const msgText = cmMsgs.join(' | ');
  ok(/\ban arc\b/.test(msgText) && !/\ba arc\b/.test(msgText), `ConstraintManager says "an arc": ${msgText}`);
}

console.log(`offset-fusion-match-667: ${checks} checks passed`);
