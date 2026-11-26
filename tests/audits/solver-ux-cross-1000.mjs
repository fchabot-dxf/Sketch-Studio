// tests/audits/solver-ux-cross-1000.mjs -- TASK 1000 ROUND 2 (Cross-examination of 1000B & post-1001 main re-check)
// Run: node tests/audits/solver-ux-cross-1000.mjs
// Independently tests every B-1..B-20 finding + task 1001 fixes on merged origin/main (3a88641c). Exits 0.
import { design, openDesign, closeAll, J, dist, snapshot, movedText, residualText, statusText, dragWorld, dragJoint, editDim, dim, row, f, pt, quiet, toasts, clearToasts, boxEl, boxOpen, labelEl, theApp } from './solver-ux-audit-1000-kit.js';
import { ConstraintManager } from '#core/constraint-manager.js';
import { toggleDriving, isDimensionDetermined } from '#core/dimension-seams.js';
import { deleteSelection, deleteConstraints } from '#core/delete-manager.js';
import { applyFillet, findCornerAtJoint, parseFilletRadius } from '#core/fillet.js';
import { mirrorObjects } from '#core/mirror.js';
import { parseOffsetDistance } from '#core/offset.js';
import { applyPattern, patternDefaults } from '#core/pattern.js';
import { findSnap } from '#ui/snap-detection.js';
import { CONSTRAINT_TYPES } from '#core/constants.js';
import * as ops from '#core/tool-ops.js';

const D = (a, b, value, name, extra = {}) => ({ type: 'distance', joints: [a, b], value, name, ...extra });
const H = (a, b) => ({ type: 'horizontal', joints: [a, b] });
const V = (a, b) => ({ type: 'vertical', joints: [a, b] });

async function clickWorld(app, x, y) {
  const p = app.toScreen(x, y);
  await quiet(async () => { app.move(p.x, p.y); app.down(p.x, p.y); app.up(p.x, p.y); });
}
function clickRibbon(app, toolId) {
  const btn = app.document.getElementById(`tool-${toolId}`) || app.document.querySelector(`[data-tool="${toolId}"]`);
  if (!btn) return false;
  btn.click(); app.frames(); return true;
}

await (async () => {
  // ======== POST-1001 RE-CHECK (UX-14, UX-16, UX-19 / B-20a) ========
  let app = await openDesign(design(
    { a: [0, 0, true], b: [80, 0], c: [80, 40], d: [0, 40] },
    [{ id: 'L1', type: 'line', joints: ['a', 'b'] }, { id: 'L2', type: 'line', joints: ['b', 'c'] }, { id: 'L3', type: 'line', joints: ['c', 'd'] }, { id: 'L4', type: 'line', joints: ['d', 'a'] }],
    [H('a', 'b'), V('b', 'c'), H('c', 'd'), V('d', 'a'), D('a', 'b', 80, 'd1'), D('b', 'c', 40, 'd2')]), { centre: { x: 40, y: 20 }, w: 220 });
  {
    clearToasts(); ConstraintManager.createConstraint(app.state, CONSTRAINT_TYPES.ANGLE, { shapes: ['L1', 'L2'], value: 45 }, { source: 'toolbar' });
    const tAngle = toasts();
    clearToasts(); ConstraintManager.createConstraint(app.state, CONSTRAINT_TYPES.SYMMETRIC, { joints: ['a', 'a'], line: 'L2' }, { source: 'toolbar' });
    const tSym = toasts();
    clearToasts(); ConstraintManager.createConstraint(app.state, CONSTRAINT_TYPES.DISTANCE, { joints: ['a', 'c'], value: Math.hypot(80, 40) }, { source: 'toolbar' });
    const tDistRef = toasts();
    row('MAIN1001.notices', `angle45-on-HV=${JSON.stringify(tAngle)}; sym-same-pt=${JSON.stringify(tSym)}; redundant-dist=${JSON.stringify(tDistRef)}`);
  }
  app = await openDesign(design({ a: [0, 0, true], b: [50, 0, true] }, [{ id: 'L1', type: 'line', joints: ['a', 'b'] }], [D('a', 'b', 50, 'd1')]), { centre: { x: 25, y: 0 }, w: 160 });
  {
    const h0 = app.state.history.length;
    const ed = await editDim('d1', '70');
    row('MAIN1001.UX16', `dblclick fixed-end driving dim: opened=${ed.opened}, toasts=${JSON.stringify(ed.toasts)}, nowDriven=${!!dim('d1').isDriven}, hist ${h0}->${app.state.history.length}`);
  }
  app = await openDesign(design({ a: [0, 0], b: [60, 0], c: [100, 20] }, [{ id: 'L1', type: 'line', joints: ['a', 'b'] }, { id: 'C1', type: 'circle', joints: ['c'], radius: 20 }]), { centre: { x: 50, y: 10 }, w: 260 });
  {
    app.state.selectedShapes.add('L1'); app.state.selectedShapes.add('C1'); clearToasts();
    await quiet(async () => app.key('e'));
    const tE = toasts();
    clearToasts(); clickRibbon(app, 'equal');
    const tBtn = toasts();
    row('MAIN1001.UX14', `L1+C1 press E toasts=${JSON.stringify(tE)}; click Equal ribbon toasts=${JSON.stringify(tBtn)}`);
  }

  // ======== B-3: toggleDriving on parallel line-line & point-to-axis ref dims ========
  app = await openDesign(design(
    { a: [0, 0, true], b: [60, 0, true], c: [0, 55], d: [60, 55] },
    [{ id: 'L1', type: 'line', joints: ['a', 'b'] }, { id: 'L2', type: 'line', joints: ['c', 'd'] }],
    [H('c', 'd'), { type: 'distance', shapes: ['L1', 'L2'], value: 20, isDriven: true, driven: true, name: 'd1' }]), { centre: { x: 30, y: 25 }, w: 220 });
  {
    const y0 = J('c').y;
    const res = toggleDriving(app.state, dim('d1'));
    row('XB-3a', `line-line ref (born 20, moved to y=${f(y0)}) toggleDriving: res=${JSON.stringify(res)}, val=${f(dim('d1').value)}, yAfter=${f(J('c').y)}`);
  }
  app = await openDesign(design(
    { p: [20, 60] },
    [],
    [{ type: 'distance', joints: ['p', 'j_origin', 'j_ref_x'], value: 25, isDriven: true, driven: true, name: 'd1' }]), { centre: { x: 20, y: 30 }, w: 220 });
  {
    const y0 = J('p').y;
    const res = toggleDriving(app.state, dim('d1'));
    row('XB-3b', `point-to-axis ref (born 25, moved to y=${f(y0)}) toggleDriving: res=${JSON.stringify(res)}, val=${f(dim('d1').value)}, yAfter=${f(J('p').y)}`);
  }

  // ======== B-6: Preselect joint + Parallel -> corrupt parallel(jointId, lineId); preselect Circle + H/V + click line ========
  app = await openDesign(design(
    { a: [0, 0], b: [60, 0], p: [30, 40], q: [80, 50], cc: [110, 20] },
    [{ id: 'L1', type: 'line', joints: ['a', 'b'] }, { id: 'L2', type: 'line', joints: ['p', 'q'] }, { id: 'C1', type: 'circle', joints: ['cc'], radius: 15 }]), { centre: { x: 55, y: 25 }, w: 260 });
  {
    app.state.selectedJoints.add('p');
    clickRibbon(app, 'parallel');
    clearToasts();
    await clickWorld(app, 30, 0); // click L1
    const par = app.state.constraints.filter((c) => c.type === 'parallel');
    row('XB-6a', `preselect joint p -> click Parallel -> click L1: parallel=${JSON.stringify(par.map((c) => c.shapes))}, toasts=${JSON.stringify(toasts())}`);
    app.esc();
    app.state.selectedShapes.clear(); app.state.selectedJoints.clear();
    app.state.selectedShapes.add('C1');
    clickRibbon(app, 'hv');
    clearToasts();
    await clickWorld(app, 30, 0); // click L1
    row('XB-6b', `preselect circle C1 -> click H/V -> click L1: tool=${app.state.currentTool}, hvCount=${app.state.constraints.filter((c) => c.type === 'horizontal' || c.type === 'vertical').length}, toasts=${JSON.stringify(toasts())}`);
  }

  // ======== B-7: Switch tool mid-dimension placement leaks phantom __placing dim across hosts ========
  for (const host of ['sketchstudio', 'shaper', 'penplotter']) {
    app = await openDesign(design({ a: [0, 20], b: [60, 20] }, [{ id: 'L1', type: 'line', joints: ['a', 'b'] }]), { centre: { x: 30, y: 20 }, w: 200, host });
    app.tool('dim');
    await clickWorld(app, 30, 20); // enters placing mode (off X-axis!)
    const mid = { n: app.state.constraints.length, placing: !!app.state.placingConstraint };
    app.tool('line'); // switch away without Esc
    const after = { tool: app.state.currentTool, n: app.state.constraints.length, placing: !!app.state.placingConstraint, flags: app.state.constraints.map((c) => !!c.__placing) };
    row(`XB-7.${host}`, `mid=${JSON.stringify(mid)} -> switchToLine=${JSON.stringify(after)}`);
    app.tool('dim'); app.esc(); // reset module-level dimensionState.placingConstraint before next host
  }

  // ======== B-8: Circle draw-time Enter drops centerSnapTarget & fails with no mouse move ========
  app = await openDesign(design({ a: [0, 0, true], b: [40, 0] }, [{ id: 'L1', type: 'line', joints: ['a', 'b'] }]), { centre: { x: 20, y: 0 }, w: 200 });
  {
    app.tool('circle');
    const pA = app.toScreen(40, 0), pMove = app.toScreen(70, 0);
    await quiet(async () => { app.move(pA.x, pA.y); app.down(pA.x, pA.y); app.up(pA.x, pA.y); app.move(pMove.x, pMove.y); });
    await quiet(async () => { const i = boxEl(); i.focus(); i.select(); app.key('a', { ctrl: true }); app.type('30'); app.enter(); });
    const c1 = app.state.shapes.find((s) => s.type === 'circle');
    const coin1 = app.state.constraints.filter((c) => c.type === 'coincident' && c.joints.includes(c1?.joints[0])).length;
    row('XB-8a', `circle click snapped to b(40,0) -> move -> type "30"+Enter: created=${!!c1}, r=${f(c1?.radius)}, coincidentOnCenter=${coin1}`);
  }
  app = await openDesign(design({ a: [0, 0, true], b: [40, 0] }, [{ id: 'L1', type: 'line', joints: ['a', 'b'] }]), { centre: { x: 20, y: 0 }, w: 200 });
  {
    app.tool('circle');
    const pA = app.toScreen(40, 0);
    await quiet(async () => { app.move(pA.x, pA.y); app.down(pA.x, pA.y); app.up(pA.x, pA.y); }); // NO move after click-1
    await quiet(async () => { const i = boxEl(); i.focus(); i.select(); app.key('a', { ctrl: true }); app.type('30'); app.enter(); });
    const c2 = app.state.shapes.find((s) => s.type === 'circle');
    row('XB-8b', `circle click-1 NO move -> type "30"+Enter: created=${!!c2}, stillActive=${!!app.state.active}`);
  }

  // ======== B-9: Redundant Angle dim (90 deg) on H+V lines born DRIVING silently ========
  app = await openDesign(design(
    { a: [0, 0, true], b: [60, 0], c: [60, 40] },
    [{ id: 'L1', type: 'line', joints: ['a', 'b'] }, { id: 'L2', type: 'line', joints: ['b', 'c'] }],
    [H('a', 'b'), V('b', 'c')]), { centre: { x: 30, y: 20 }, w: 200 });
  {
    clearToasts();
    const ang = ConstraintManager.createConstraint(app.state, CONSTRAINT_TYPES.ANGLE, { shapes: ['L1', 'L2'], value: 90, name: 'd1' }, { source: 'toolbar' });
    const det = ang ? isDimensionDetermined(app.state, ang) : null;
    const tCreate = toasts();
    row('XB-9', `angle=90 on H+V lines: created=${!!ang}, isDriven=${!!(ang && ang.isDriven)}, isDetermined=${det}, toasts=${JSON.stringify(tCreate)}`);
  }

  // ======== B-10: Midpoint own-endpoint on Line vs Arc ========
  app = await openDesign(design(
    { a: [0, 0], b: [60, 0], p: [30, 40], q: [60, 40], ac: [120, 0], as: [150, 0], ae: [120, 30] },
    [{ id: 'L1', type: 'line', joints: ['a', 'b'] }, { id: 'L2', type: 'line', joints: ['p', 'q'] }, { id: 'A1', type: 'arc', joints: ['ac', 'as', 'ae'], sweep: true }],
    [{ type: 'equal', joints: ['ac', 'as', 'ac', 'ae'] }]), { centre: { x: 75, y: 15 }, w: 280 });
  {
    app.tool('midpoint'); clearToasts();
    await clickWorld(app, 30, 0); // L1
    await clickWorld(app, 0, 0);  // L1's own endpoint a
    const afterOwn = { tool: app.state.currentTool, bufLen: app.state.pendingConstraint?.selectionBuffer?.length, toasts: toasts() };
    await clickWorld(app, 30, 40); // valid external point p
    const afterExt = { bufLen: app.state.pendingConstraint?.selectionBuffer?.length, midpoints: app.state.constraints.filter((c) => c.type === 'midpoint').length, toasts: toasts() };
    app.esc();
    app.tool('midpoint'); clearToasts();
    await clickWorld(app, 120 + 30 * Math.SQRT1_2, 30 * Math.SQRT1_2); // A1
    await clickWorld(app, 150, 0); // A1's own endpoint as
    const arcOwn = { tool: app.state.currentTool, bufLen: app.state.pendingConstraint?.selectionBuffer?.length, toasts: toasts() };
    row('XB-10', `Line own-end=${JSON.stringify(afterOwn)} -> nextValidPt=${JSON.stringify(afterExt)}; Arc own-end=${JSON.stringify(arcOwn)}`);
  }

  // ======== B-11: Coincident own-endpoint on Line vs Arc vs Circle ========
  app = await openDesign(design(
    { a: [0, 0], b: [60, 0], ac: [120, 0], as: [150, 0], ae: [120, 30], cc: [200, 0] },
    [{ id: 'L1', type: 'line', joints: ['a', 'b'] }, { id: 'A1', type: 'arc', joints: ['ac', 'as', 'ae'], sweep: true }, { id: 'C1', type: 'circle', joints: ['cc'], radius: 20 }],
    [{ type: 'equal', joints: ['ac', 'as', 'ac', 'ae'] }]), { centre: { x: 100, y: 10 }, w: 320 });
  {
    const polCount = () => app.state.constraints.filter((c) => c.type === 'pointOnLine').length;
    app.tool('coincident'); clearToasts();
    await clickWorld(app, 30, 0); await clickWorld(app, 0, 0);
    const lineOwn = { pol: polCount(), toasts: toasts() };
    app.esc(); app.tool('coincident'); clearToasts();
    await clickWorld(app, 120 + 30 * Math.SQRT1_2, 30 * Math.SQRT1_2); await clickWorld(app, 150, 0);
    const arcOwn = { pol: polCount(), toasts: toasts() };
    app.esc(); app.tool('coincident'); clearToasts();
    await clickWorld(app, 220, 0); await clickWorld(app, 200, 0);
    const circOwn = { pol: polCount(), toasts: toasts() };
    row('XB-11', `Coincident own-end: lineOwn=${JSON.stringify(lineOwn)}, arcOwn=${JSON.stringify(arcOwn)}, circOwn=${JSON.stringify(circOwn)}`);
  }

  // ======== B-12a (free-R fillet cusp via ops.rect + ops.fillet) & B-12b (10 deg arc past start -> ~350 deg) ========
  {
    const sFI = ops.newSketchState();
    const r2 = ops.rect(sFI, 0, 0, 60, 40);
    const f2 = ops.fillet(sFI, r2.top, r2.right, 10);
    deleteConstraints(sFI, [sFI.constraints.find((c) => c.isRadius && c.shape === f2.arc)]);
    const rightTop = sFI.shapes.find((s) => s.id === r2.right).joints[0];
    const jRT = sFI.joints.get(rightTop), p0 = { x: jRT.x, y: jRT.y };
    for (let k = 1; k <= 15; k++) {
      const tx = p0.x - 45 * k / 15, ty = p0.y;
      jRT.dragTarget = { x: tx, y: ty };
      sFI.engine.solve(20, { dragTarget: { jointId: rightTop, x: tx, y: ty, stiffness: 1e4 } });
    }
    delete jRT.dragTarget; sFI.engine.solve(500);
    const arc = sFI.shapes.find((s) => s.id === f2.arc);
    const fc = sFI.joints.get(arc.joints[0]), fs = sFI.joints.get(arc.joints[1]), fe = sFI.joints.get(arc.joints[2]), vs = sFI.joints.get(arc.filletSharp);
    row('XB-12a', `free-R fillet drag rightTop left -45: arcC=${pt(fc)}, arcS=${pt(fs)}, arcE=${pt(fe)}, vSharp=${pt(vs)}, r=${f(dist(fc, fs))}, flippedOutside=${fc.x > vs.x}`);
  }
  // B-12b: 10 deg arc, 10-step solver drag end past start (no snap!)
  app = await openDesign(design(
    { c: [0, 0, true], s: [30, 0, true], e: [29.5, 5.2] },
    [{ id: 'A1', type: 'arc', joints: ['c', 's', 'e'], sweep: true }],
    [{ type: 'equal', joints: ['c', 's', 'c', 'e'] }]), { centre: { x: 0, y: 0 }, w: 180 });
  {
    const a0 = Math.atan2(J('e').y, J('e').x) * 180 / Math.PI;
    for (let k = 1; k <= 10; k++) {
      app.state.engine.solve(40, { dragTarget: { jointId: 'e', x: 29.5, y: 5.2 - 10.4 * k / 10, stiffness: 1e4 } });
    }
    let a1 = Math.atan2(J('e').y, J('e').x) * 180 / Math.PI;
    if (a1 < 0) a1 += 360;
    row('XB-12b', `10-deg arc 10-step solver drag past start: spanBefore=${f(a0, 2)}deg -> spanAfter=${f(a1, 2)}deg (wrapped>330=${a1 > 330})`);
  }

  // ======== B-13: Circle with ONLY Reference radius dim -> Dim tool click ========
  app = await openDesign(design(
    { c: [0, 0, true] },
    [{ id: 'C1', type: 'circle', joints: ['c'], radius: 20 }],
    [{ type: 'distance', shape: 'C1', value: 20, isRadius: true, isDriven: true, driven: true, name: 'd1' }]), { centre: { x: 0, y: 0 }, w: 160 });
  {
    app.tool('dim'); clearToasts();
    await clickWorld(app, 20, 0);
    const added = app.state.constraints[app.state.constraints.length - 1];
    row('XB-13', `circle with ONLY ref radius dim -> Dim tool click: totalDims=${app.state.constraints.length}, newIsDriven=${!!(added && added.isDriven)}, toasts=${JSON.stringify(toasts())}`);
    app.esc();
  }

  // ======== B-14c: Duplicate H/V via pre-select H key / ribbon (SILENT!) vs H/V tool (red toast) ========
  app = await openDesign(design({ a: [0, 0], b: [60, 0] }, [{ id: 'L1', type: 'line', joints: ['a', 'b'] }], [H('a', 'b')]), { centre: { x: 30, y: 0 }, w: 200 });
  {
    app.state.selectedShapes.add('L1'); clearToasts();
    await quiet(async () => app.key('h'));
    const tKey = toasts();
    clearToasts(); clickRibbon(app, 'hv');
    const tRib = toasts();
    app.state.selectedShapes.clear();
    clickRibbon(app, 'hv'); clearToasts();
    await clickWorld(app, 30, 0);
    const tTool = toasts();
    row('XB-14c', `dup H on already-H line: preselect H-key=${JSON.stringify(tKey)}; preselect H/V-ribbon=${JSON.stringify(tRib)}; H/V-tool click=${JSON.stringify(tTool)}`);
  }

  // ======== B-15: Invalid pick across all 9 constraint tools (exit to Select vs stay active) ========
  app = await openDesign(design(
    { a: [0, 0], b: [50, 0], c: [0, 30], d: [50, 30], cc: [100, 15], p: [100, 50] },
    [{ id: 'L1', type: 'line', joints: ['a', 'b'] }, { id: 'L2', type: 'line', joints: ['c', 'd'] }, { id: 'C1', type: 'circle', joints: ['cc'], radius: 15 }]), { centre: { x: 50, y: 20 }, w: 260 });
  {
    const cases = [
      ['parallel', [[115, 15]]],             // circle
      ['perp', [[115, 15]]],                 // circle
      ['collinear', [[115, 15]]],            // circle
      ['hv', [[115, 15]]],                   // circle
      ['midpoint', [[115, 15]]],             // circle
      ['symmetric', [[100, 50], [25, 0]]],   // point + line
      ['coincident', [[25, 0], [25, 30]]],   // line + line
      ['tangent', [[25, 0], [25, 30]]],      // line + line
      ['equal', [[25, 0], [115, 15]]],       // line + circle
    ];
    const out = {};
    for (const [tool, pts] of cases) {
      app.esc(); app.tool(tool); clearToasts();
      for (const [x, y] of pts) await clickWorld(app, x, y);
      out[tool] = app.state.currentTool === tool ? 'STAY' : 'EXIT->' + app.state.currentTool;
    }
    row('XB-15', `invalid pick tool retention: ${JSON.stringify(out)}`);
  }

  // ======== B-16: Double-click pattern label in Dimension tool vs Select tool ========
  app = await openDesign(design({ a: [0, 0], b: [20, 0] }, [{ id: 'L1', type: 'line', joints: ['a', 'b'] }]), { centre: { x: 30, y: 10 }, w: 220 });
  {
    const pr = applyPattern(app.state, CONSTRAINT_TYPES.RECTANGULAR_PATTERN, { shapes: ['L1'], joints: [] }, { ...patternDefaults(CONSTRAINT_TYPES.RECTANGULAR_PATTERN), quantity: [3, 1], distance: [30, 10] });
    app.frames();
    const idx = app.state.constraints.indexOf(pr.constraint);
    const lbl = () => app.svg.querySelector(`.pattern-label[data-constraint-idx="${idx}"], .dim-label[data-constraint-idx="${idx}"]`);
    const gp = pr.constraint.glyphPos;
    const p = gp ? app.toScreen(gp.x, gp.y) : null;
    app.tool('dim');
    await app.pause(550);
    if (p && lbl()) await quiet(async () => { app.dblclick(p.x, p.y, { target: lbl }); });
    const dimInputOpened = boxOpen();
    app.esc();
    row('XB-16', `pattern label dblclick in Dimension tool: labelFound=${!!lbl()}, dimInputOpened=${dimInputOpened}`);
  }

  // ======== B-17: Tangent pick order — free+free (Fusion 200/200) vs SAME-TIER tie (line:free + circle:sized)! ========
  for (const [tag, extra] of [['free-free', []], ['tie-lineFree-circleSized', [{ type: 'distance', shape: 'C1', value: 20, isRadius: true, name: 'd1' }]]]) {
    for (const order of ['L-then-C', 'C-then-L']) {
      app = await openDesign(design({ a: [0, 0], b: [60, 0], cc: [30, 45] }, [{ id: 'L1', type: 'line', joints: ['a', 'b'] }, { id: 'C1', type: 'circle', joints: ['cc'], radius: 20 }], extra), { centre: { x: 30, y: 20 }, w: 220 });
      const s0 = snapshot();
      app.tool('tangent');
      if (order === 'L-then-C') { await clickWorld(app, 30, 0); await clickWorld(app, 50, 45); }
      else { await clickWorld(app, 50, 45); await clickWorld(app, 30, 0); }
      const lMove = Math.max(dist(s0.get('a'), J('a')), dist(s0.get('b'), J('b')));
      const cMove = dist(s0.get('cc'), J('cc'));
      row(`XB-17.${tag}.${order}`, `lineMoved=${f(lMove)}, circleMoved=${f(cMove)}, r=${f(app.state.shapes.find((s) => s.id === 'C1').radius)}`);
    }
  }

  // ======== B-18a: Rect corner (cluster of 2 welded joints) dragged to line midpoint ========
  app = await openDesign(design(
    { t1: [0, 0, true], t2: [0, 80, true], r1: [40, 20], r2: [40, 20], r3: [80, 20], r4: [40, 60] },
    [{ id: 'LT', type: 'line', joints: ['t1', 't2'] }, { id: 'R1', type: 'line', joints: ['r1', 'r3'] }, { id: 'R2', type: 'line', joints: ['r2', 'r4'] }],
    [{ type: 'coincident', joints: ['r1', 'r2'] }]), { centre: { x: 30, y: 40 }, w: 220 });
  {
    let midSnap = null, posAtSnap = null;
    // Drag cluster r1/r2 to 3px off LT midpoint (0,40)
    const pMid = app.toScreen(0, 40);
    const offWorld = { x: 1.0, y: 39.2 }; // inside 10px magnet of (0,40)
    await dragJoint('r1', offWorld, 20, { watch: (k) => { if (k === 20) { midSnap = app.state.activeSnap ? { type: app.state.activeSnap.type, isLocked: app.state.activeSnap.isLocked } : null; posAtSnap = pt(J('r1')); } } });
    row('XB-18a', `cluster drag to near LT midpoint (0,40): snapAtEnd=${JSON.stringify(midSnap)}, posDuringDrag=${posAtSnap}, posAfterRelease=${pt(J('r1'))}, midConstraints=${app.state.constraints.filter((c) => c.type === 'midpoint').length}`);
  }

  // ======== B-19b/c/d/e: Polygon, Slot, Line angle, Fillet/Offset formulas ========
  row('XB-19e', `parseFilletRadius("d1 / 2")=${parseFilletRadius('d1 / 2')}, parseOffsetDistance("d1 / 2")=${parseOffsetDistance('d1 / 2')}`);
  app = await openDesign(design({ a: [0, 0, true], b: [60, 0] }, [{ id: 'L1', type: 'line', joints: ['a', 'b'] }], [H('a', 'b'), D('a', 'b', 60, 'd1')]), { centre: { x: 40, y: 30 }, w: 240 });
  {
    // Polygon box with formula "d1 / 2"
    app.tool('polygon');
    const p1 = app.toScreen(60, 50), p2 = app.toScreen(80, 50);
    await quiet(async () => { app.move(p1.x, p1.y); app.down(p1.x, p1.y); app.up(p1.x, p1.y); app.move(p2.x, p2.y); });
    const pInp = app.document.querySelector('#dualInput input');
    if (pInp) await quiet(async () => { pInp.focus(); pInp.select(); app.key('a', { ctrl: true }); app.type('d1 / 2'); app.enter(); });
    const distDims = app.state.constraints.filter((c) => c.type === 'distance');
    row('XB-19b', `polygon draw-time "d1 / 2": shapes=${app.state.shapes.length}, distDims=${JSON.stringify(distDims.map((c) => ({ name: c.name, val: c.value, expr: c.expression || null })))}`);
  }
  // B-19c: Slot modes (slot-c2c vs slot-center): typed span formula "d1 / 2" & width formula "d1 / 4"
  for (const mode of ['slot-c2c', 'slot-center']) {
    app = await openDesign(design({ a: [0, 0, true], b: [60, 0] }, [{ id: 'L1', type: 'line', joints: ['a', 'b'] }], [H('a', 'b'), D('a', 'b', 60, 'd1')]), { centre: { x: 40, y: 40 }, w: 240 });
    app.state.slotMode = mode;
    app.tool('slot');
    const p1 = app.toScreen(10, 40), p2 = app.toScreen(50, 40), p3 = app.toScreen(50, 55);
    await quiet(async () => { app.move(p1.x, p1.y); app.down(p1.x, p1.y); app.up(p1.x, p1.y); app.move(p2.x, p2.y); });
    if (boxOpen()) await quiet(async () => { const i = boxEl(); i.focus(); i.select(); app.key('a', { ctrl: true }); app.type('d1 / 2'); app.enter(); });
    await quiet(async () => { app.move(p3.x, p3.y); });
    if (boxOpen()) await quiet(async () => { const i = boxEl(); i.focus(); i.select(); app.key('a', { ctrl: true }); app.type('d1 / 4'); app.enter(); });
    const distDims = app.state.constraints.filter((c) => c.type === 'distance' && c.name !== 'd1');
    row(`XB-19c.${mode}`, `slot ${mode} span="d1 / 2" width="d1 / 4": shapes=${app.state.shapes.length}, newDims=${JSON.stringify(distDims.map((c) => ({ val: f(c.value), expr: c.expression || null })))}`);
  }
  // Line box: length 50, Tab, angle 30, Enter
  app = await openDesign(design({}, []), { centre: { x: 40, y: 20 }, w: 240 });
  {
    app.tool('line');
    const p1 = app.toScreen(0, 0), p2 = app.toScreen(40, 20);
    await quiet(async () => { app.move(p1.x, p1.y); app.down(p1.x, p1.y); app.up(p1.x, p1.y); app.move(p2.x, p2.y); });
    const inps = [...app.document.querySelectorAll('#dualInput input')];
    if (inps.length === 2) await quiet(async () => {
      inps[0].focus(); inps[0].select(); app.key('a', { ctrl: true }); app.type('50');
      inps[1].focus(); inps[1].select(); app.key('a', { ctrl: true }); app.type('30');
      app.enter();
    });
    row('XB-19d', `line draw-time length=50 angle=30: shapes=${app.state.shapes.length}, constraints=${JSON.stringify(app.state.constraints.map((c) => ({ type: c.type, val: c.value })))}`);
  }

  // ======== B-20b (fixed-endpoint Bezier marked fixedShapes) & B-20c (JOINT_PRIORITY_RADIUS=15 unscaled by touch boost) ========
  app = await openDesign(design(
    { a: [0, 0, true], b: [60, 0, true] },
    [{ id: 'B1', type: 'bezier', joints: ['a', 'b'], c1: [20, 30], c2: [40, -30] }]), { centre: { x: 30, y: 0 }, w: 200 });
  {
    row('XB-20b', `fixed-endpoint Bezier status: ${statusText()}`);
  }
  app = await openDesign(design({ a: [0, 0], b: [100, 0] }, [{ id: 'L1', type: 'line', joints: ['a', 'b'] }]), { centre: { x: 50, y: 0 }, w: 200 });
  {
    // Put cursor 18px right of joint a (on the line L1): distToJoint=18 > 15, distToLine=0 -> with boost=2 (touch), jointThreshold=60, yet JOINT_PRIORITY_RADIUS stays 15!
    const pA = app.toScreen(0, 0);
    const ptDesktop = { x: pA.x + 18, y: pA.y };
    const snapDesk = findSnap(app.state.joints, app.state.shapes, app.svg, ptDesktop, [], false, false, 1);
    const snapTouch = findSnap(app.state.joints, app.state.shapes, app.svg, ptDesktop, [], false, false, 2);
    row('XB-20c', `cursor 18px right of joint a along L1: boost=1 -> ${snapDesk?.type} (d=${f(snapDesk?.dist, 1)}); boost=2 (touch) -> ${snapTouch?.type} (d=${f(snapTouch?.dist, 1)})`);
  }

  await closeAll();
})();
console.log('solver-ux-cross-1000.mjs: printed (exit 0 whatever the rows say)');
