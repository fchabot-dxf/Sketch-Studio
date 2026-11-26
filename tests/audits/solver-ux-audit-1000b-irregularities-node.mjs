// TASK 1000B — Independent Solver UI/UX Audit (Auditor B):
// Systematically probes UI/UX irregularities & asymmetries through the REAL Design tab in Node
// (tests/helpers/node-app.js) across SketchStudio, Shaper, and Pen Plotter.
// Run: node tests/audits/solver-ux-audit-1000b-irregularities-node.mjs
// AUDIT ONLY: observes and reports verbatim; exits 0.

import { open, createProfile, loadGlyphSheetFromDisk } from '../helpers/node-app.js';
import { setConstraintNotifier, ConstraintManager } from '#core/constraint-manager.js';
import { showNotification } from '#ui/notification-manager.js';
import { CONSTRAINT_TYPES, TOOL_MODES, SLOT_MODES } from '#core/constants.js';
import { makeArc } from '#core/shapes.js';
import { parseFilletRadius } from '#core/fillet.js';
import { parseOffsetDistance } from '#core/offset.js';
import * as ops from '#core/tool-ops.js';

await loadGlyphSheetFromDisk();

function readToasts(app) {
  const c = app.document.getElementById('notification-container');
  if (!c) return [];
  return [...c.children].map(el => ({
    level: el.getAttribute('data-level'),
    text: (el.querySelector('pre')?.textContent || el.textContent || '').trim(),
  }));
}
function clearToasts(app) {
  const c = app.document.getElementById('notification-container');
  if (c) c.innerHTML = '';
}

async function openHost(host = 'sketchstudio') {
  const profile = await createProfile();
  const app = await open({ host, profile });
  // Match SketchStudio main.js:66 (mountSketch already wires this for Shaper/PenPlotter)
  setConstraintNotifier(showNotification);
  return app;
}

function addLine(app, x1, y1, x2, y2) {
  const s = app.state;
  const a = s.genJ(), b = s.genJ();
  s.joints.set(a, { x: x1, y: y1, fixed: false });
  s.joints.set(b, { x: x2, y: y2, fixed: false });
  const id = 'L_' + a + '_' + b;
  s.shapes.push({ id, type: 'line', joints: [a, b] });
  app.frames(2);
  return { id, a, b, mid: { x: (x1 + x2) / 2, y: (y1 + y2) / 2 } };
}

function addCircle(app, cx, cy, r) {
  const s = app.state;
  const c = s.genJ();
  s.joints.set(c, { x: cx, y: cy, fixed: false });
  const id = 'C_' + c;
  s.shapes.push({ id, type: 'circle', joints: [c], radius: r });
  app.frames(2);
  return { id, c, rim: { x: cx + r, y: cy } };
}

function addArcShape(app, cx, cy, sx, sy, ex, ey, sweep = true) {
  const s = app.state;
  const c = s.genJ(), a = s.genJ(), b = s.genJ();
  s.joints.set(c, { x: cx, y: cy, fixed: false });
  s.joints.set(a, { x: sx, y: sy, fixed: false });
  s.joints.set(b, { x: ex, y: ey, fixed: false });
  const built = makeArc(s.joints, c, a, b, 'CENTER', false);
  built.shapes[0].sweep = sweep;
  s.shapes.push(built.shapes[0]);
  for (const con of built.constraints) ConstraintManager.createConstraint(s, con.type, con);
  app.frames(2);
  return { id: built.shapes[0].id, c, a, b };
}

function clickWorld(app, wx, wy, opts) {
  const p = app.toScreen(wx, wy);
  app.click(p.x, p.y, opts);
}

function section(t) { console.log('\n=== ' + t + ' ==='); }

// ===========================================================================
// PAIR 1 & PAIR 7: Tool button vs Keyboard shortcut vs Host (SketchStudio vs Shaper vs Pen Plotter)
// ===========================================================================
section('P1/P7-A: Pre-selected 2 shapes + E key vs Equal ribbon button');
{
  const app = await openHost('sketchstudio');
  const l1 = addLine(app, -5, 3, 5, 3);
  const l2 = addLine(app, -5, -3, 8, -3);
  app.state.selectedShapes.add(l1.id); app.state.selectedShapes.add(l2.id);
  clearToasts(app);
  app.tool('equal');
  const afterBtn = {
    tool: app.state.currentTool,
    equalCount: app.state.constraints.filter(c => c.type === 'equal').length,
    pending: app.state.pendingConstraint,
  };
  app.esc();
  app.state.selectedShapes.add(l1.id); app.state.selectedShapes.add(l2.id);
  clearToasts(app);
  app.key('e');
  const afterKey = {
    tool: app.state.currentTool,
    equalCount: app.state.constraints.filter(c => c.type === 'equal').length,
  };
  // Invalid pair (line + circle) + E key -> raw ERR-EQUAL-01 JSON toast
  app.esc();
  const ci = addCircle(app, 0, -7, 2);
  app.state.selectedShapes.add(l1.id); app.state.selectedShapes.add(ci.id);
  clearToasts(app);
  app.key('e');
  const invalidKeyToasts = readToasts(app);
  console.log('P1-A EQUAL 2-PRESELECT:', JSON.stringify({ afterBtn, afterKey, invalidKeyToasts }));
  await app.close();
}

section('P1/P7-B: Pre-selected slanted line + H/V ribbon vs H key across SketchStudio / Shaper / Pen Plotter');
{
  for (const host of ['sketchstudio', 'shaper', 'penplotter']) {
    const app = await openHost(host);
    // Place line comfortably inside each host's default viewBox, away from Origin (0,0)
    const cx = host === 'penplotter' ? 100 : 2;
    const cy = host === 'penplotter' ? 100 : (host === 'shaper' ? 10 : 3);
    const half = host === 'penplotter' ? 40 : (host === 'shaper' ? 20 : 4);
    const l1 = addLine(app, cx - half, cy, cx + half, cy + half * 0.2);
    // Ribbon click with preselected l1
    app.state.selectedShapes.add(l1.id);
    clearToasts(app);
    app.tool('hv');
    const afterRibbon = {
      tool: app.state.currentTool,
      hvCount: app.state.constraints.filter(c => c.type === 'horizontal' || c.type === 'vertical').length,
      pending: app.state.pendingConstraint,
      toasts: readToasts(app),
    };
    // Re-apply via preselection + H key (duplicate!)
    app.esc();
    app.state.selectedShapes.add(l1.id);
    clearToasts(app);
    app.key('h');
    const afterDupKey = {
      tool: app.state.currentTool,
      toasts: readToasts(app),
    };
    // Compare: click already-horizontal l1 with H/V tool active
    app.esc();
    app.tool('hv');
    clearToasts(app);
    const ja = app.state.joints.get(l1.a), jb = app.state.joints.get(l1.b);
    clickWorld(app, (ja.x + jb.x) / 2, (ja.y + jb.y) / 2);
    const afterDupToolClick = {
      tool: app.state.currentTool,
      toasts: readToasts(app),
    };
    // Test clicking same constraint tool button TWICE (toggle off?)
    app.esc();
    app.tool('parallel');
    const tool1 = app.state.currentTool;
    app.tool('parallel');
    const tool2 = app.state.currentTool;
    // Test Coincident button clearing selection in SketchStudio vs Shaper/PenPlotter
    app.esc();
    const l2 = addLine(app, cx - half, cy + half * 0.6, cx + half, cy + half * 0.6);
    app.state.selectedShapes.add(l1.id); app.state.selectedShapes.add(l2.id);
    app.tool('coincident');
    const coincSelAfter = app.state.selectedShapes.size;
    console.log(`P1/P7-B [${host}]:`, JSON.stringify({ afterRibbon, afterDupKey, afterDupToolClick, parallelReclick: [tool1, tool2], coincSelAfter }));
    await app.close();
  }
}

section('P1/P7-C: Switching tools mid-dimension-placement (ribbon click vs Esc)');
{
  for (const host of ['sketchstudio', 'shaper', 'penplotter']) {
    const app = await openHost(host);
    const cx = host === 'penplotter' ? 100 : 2;
    const cy = host === 'penplotter' ? 100 : (host === 'shaper' ? 10 : 3);
    const half = host === 'penplotter' ? 40 : (host === 'shaper' ? 20 : 4);
    const l1 = addLine(app, cx - half, cy, cx + half, cy);
    app.tool('dim');
    clickWorld(app, cx, cy); // starts placing length dimension! (away from origin)
    const duringPlacing = {
      constraints: app.state.constraints.length,
      placing: !!(app.state.placingConstraint && app.state.placingConstraint.__placing),
    };
    // Switch to Line tool WITHOUT pressing Esc!
    app.tool('line');
    const afterSwitchToLine = {
      tool: app.state.currentTool,
      constraints: app.state.constraints.length,
      placingFlagOnC: app.state.constraints.map(c => ({ type: c.type, placing: !!c.__placing })),
      statePlacing: !!app.state.placingConstraint,
    };
    // Switch back to Dimension tool and click empty space — does the phantom placing dim finalize?!
    app.tool('dim');
    clickWorld(app, cx, cy + half * 0.5);
    const afterReturnDimClick = {
      constraints: app.state.constraints.length,
      placingFlagOnC: app.state.constraints.map(c => ({ type: c.type, placing: !!c.__placing, value: +c.value.toFixed(2) })),
    };
    console.log(`P1/P7-C MID-DIM TOOL SWITCH [${host}]:`, JSON.stringify({ duringPlacing, afterSwitchToLine, afterReturnDimClick }));
    await app.close();
  }
}

section('P1-D: Pre-selected 2 joints + D key vs Dimension tool click-click when H or Reference dim exists');
{
  const app = await openHost('sketchstudio');
  const l1 = addLine(app, -3, 2, 3, 6);
  ConstraintManager.createConstraint(app.state, CONSTRAINT_TYPES.DISTANCE, {
    joints: [l1.a, l1.b], value: 6, dimMode: 'horizontal',
  });
  app.frames(2);
  // Path 1: Preselect both joints, press D
  app.state.selectedJoints.add(l1.a); app.state.selectedJoints.add(l1.b);
  clearToasts(app);
  app.key('d');
  const preselectRes = {
    constraints: app.state.constraints.length,
    placing: !!app.state.placingConstraint,
    toasts: readToasts(app),
  };
  // Path 2: Dimension tool, click j1 then j2
  app.esc();
  clearToasts(app);
  app.tool('dim');
  clickWorld(app, -3, 2);
  clickWorld(app, 3, 6);
  const clickClickRes = {
    constraints: app.state.constraints.length,
    placing: !!app.state.placingConstraint,
    toasts: readToasts(app),
  };
  // Circle with ONLY a REFERENCE radius dim -> Dimension tool clicks circle
  app.esc();
  const ci = addCircle(app, 6, 3, 2);
  ConstraintManager.createConstraint(app.state, CONSTRAINT_TYPES.DISTANCE, {
    shape: ci.id, value: 2, isRadius: true, isDriven: true, driven: true,
  });
  app.frames(2);
  app.tool('dim');
  clickWorld(app, 8, 3);
  const circleAfterRefDim = app.state.constraints.filter(c => c.shape === ci.id).map(c => ({ isDriven: !!c.isDriven, driven: !!c.driven, placing: !!c.__placing }));
  console.log('P1-D PRESELECT-D vs CLICK-CLICK:', JSON.stringify({ preselectRes, clickClickRes, circleAfterRefDim }));
  await app.close();
}

// ===========================================================================
// PAIR 3 & PAIR 4: Line vs Arc vs Circle vs Bezier; Invalid-pick exit asymmetry; Pre-select wrong type
// ===========================================================================
section('P3/P4-A: Midpoint own-endpoint (Line vs Arc) — line silent wedge vs arc warning + exit');
{
  const app = await openHost('sketchstudio');
  const l1 = addLine(app, -5, 3, 5, 3); // away from origin!
  const arc1 = addArcShape(app, 0, -5, 3, -5, 0, -2, true);

  // Line + own endpoint in Midpoint tool
  app.tool('midpoint');
  clearToasts(app);
  clickWorld(app, 0, 3);   // line body (off origin!)
  clickWorld(app, -5, 3);  // line's OWN start endpoint
  const lineOwnEnd = {
    tool: app.state.currentTool,
    toasts: readToasts(app),
    pendingBuf: app.state.pendingConstraint?.selectionBuffer?.map(x => x.type + ':' + x.id) ?? null,
    selectedShapes: app.state.selectedShapes.size,
    selectedJoints: app.state.selectedJoints.size,
  };
  // Now click a VALID 3rd point (arc center at (0, -5)) while buffer is wedged!
  clearToasts(app);
  clickWorld(app, 0, -5);
  const lineAfterWedge = {
    midpointsCreated: app.state.constraints.filter(c => c.type === 'midpoint').length,
    pendingBuf: app.state.pendingConstraint?.selectionBuffer?.map(x => x.type + ':' + x.id) ?? null,
    toasts: readToasts(app),
  };

  // Compare: Arc + own endpoint in Midpoint tool
  app.esc();
  app.tool('midpoint');
  clearToasts(app);
  const midAngle = Math.PI / 4;
  clickWorld(app, 3 * Math.cos(midAngle), -5 + 3 * Math.sin(midAngle)); // arc body
  clickWorld(app, 3, -5); // arc's own start endpoint
  const arcOwnEnd = {
    tool: app.state.currentTool,
    toasts: readToasts(app),
  };
  console.log('P3-A MIDPOINT OWN-ENDPOINT (LINE vs ARC):', JSON.stringify({ lineOwnEnd, lineAfterWedge, arcOwnEnd }));
  await app.close();
}

section('P3-B: Coincident own-point on Arc / Circle vs Line');
{
  const app = await openHost('sketchstudio');
  const l1 = addLine(app, -6, 3, -1, 3);
  const arc1 = addArcShape(app, 3, 2, 6, 2, 3, 5, true);
  const ci = addCircle(app, -4, -3, 2);

  // Coincident: line's own end + line
  app.tool('coincident'); clearToasts(app);
  clickWorld(app, -6, 3);
  clickWorld(app, -3.5, 3);
  const lineOwn = { polCount: app.state.constraints.filter(c => c.type === 'pointOnLine').length, toasts: readToasts(app) };

  // Coincident: arc's own start + arc
  app.esc(); app.tool('coincident'); clearToasts(app);
  clickWorld(app, 6, 2);
  clickWorld(app, 3 + 3 * Math.cos(Math.PI / 4), 2 + 3 * Math.sin(Math.PI / 4));
  const arcOwn = { polCount: app.state.constraints.filter(c => c.type === 'pointOnLine').length, toasts: readToasts(app) };

  // Coincident: circle's own centre + circle rim
  app.esc(); app.tool('coincident'); clearToasts(app);
  clickWorld(app, -4, -3);
  clickWorld(app, -2, -3);
  const circleOwn = { polCount: app.state.constraints.filter(c => c.type === 'pointOnLine').length, toasts: readToasts(app) };

  console.log('P3-B COINCIDENT OWN-POINT (LINE vs ARC vs CIRCLE):', JSON.stringify({ lineOwn, arcOwn, circleOwn }));
  await app.close();
}

section('P3-C: Invalid pick across ALL constraint tools (stays in tool vs exits to Select!)');
{
  const app = await openHost('sketchstudio');
  const l1 = addLine(app, -5, 3, 0, 3);
  const l2 = addLine(app, 2, 3, 7, 3);
  const ci = addCircle(app, -3, -3, 2);

  const checks = [
    ['parallel on circle', 'parallel', [[-1, -3]]],
    ['perp on circle', 'perp', [[-1, -3]]],
    ['collinear on circle', 'collinear', [[-1, -3]]],
    ['hv on circle', 'hv', [[-1, -3]]],
    ['midpoint on circle', 'midpoint', [[-1, -3]]],
    ['coincident line+line', 'coincident', [[-2.5, 3], [4.5, 3]]],
    ['tangent line+line', 'tangent', [[-2.5, 3], [4.5, 3]]],
    ['equal line+circle', 'equal', [[-2.5, 3], [-1, -3]]],
    ['symmetric point+line', 'symmetric', [[-5, 3], [4.5, 3]]],
  ];
  const rows = [];
  for (const [label, tool, pts] of checks) {
    app.esc();
    app.tool(tool);
    clearToasts(app);
    for (const [x, y] of pts) clickWorld(app, x, y);
    rows.push({ label, toolAfter: app.state.currentTool, stayedInTool: app.state.currentTool === tool, toast: readToasts(app)[0]?.text || null });
  }
  console.log('P3-C INVALID-PICK TOOL-EXIT MATRIX:');
  for (const r of rows) console.log('  ', JSON.stringify(r));
  await app.close();
}

section('P3-D: Pre-selecting wrong element type (Point/Circle) then clicking Parallel / H/V');
{
  const app = await openHost('sketchstudio');
  const l1 = addLine(app, -5, 3, 0, 3);
  const ci = addCircle(app, 4, -3, 2);

  // Pre-select a CIRCLE, click H/V, then click a LINE
  app.state.selectedShapes.add(ci.id);
  app.tool('hv');
  clearToasts(app);
  clickWorld(app, -2.5, 3);
  const hvAfterPreselectCircle = {
    tool: app.state.currentTool,
    hvAdded: app.state.constraints.filter(c => c.type === 'horizontal' || c.type === 'vertical').length,
    toasts: readToasts(app),
  };

  // Pre-select a POINT, click Parallel, then click a LINE -> creates corrupt parallel(jointId, lineId)!
  app.esc();
  app.state.selectedJoints.add(l1.a);
  app.tool('parallel');
  clearToasts(app);
  clickWorld(app, -2.5, 3);
  const pCreated = app.state.constraints.filter(c => c.type === 'parallel');
  console.log('P3-D WRONG PRESELECT:', JSON.stringify({ hvAfterPreselectCircle, corruptParallel: pCreated }));
  await app.close();
}

// ===========================================================================
// PAIR 5: Snap vs Tool (Midpoint drag on rect corner cluster -> no snap during drag, jumps on release!; Arc midpoint snap)
// ===========================================================================
section('P5: Snap vs Tool (Rect corner cluster drag to line midpoint; Arc midpoint snap)');
{
  const app = await openHost('sketchstudio');
  const target = addLine(app, -5, 4, 5, 4); // midpoint at (0, 4)
  const r = ops.rect(app.state, -4, -4, 0, 0); // bottom-right corner c3 at (0, 0)
  app.frames(2);
  const from = app.toScreen(0, 0);
  const midSc = app.toScreen(0, 4);
  const nearMid = { x: midSc.x + 4, y: midSc.y - 4 };
  app.move(from.x, from.y);
  app.down(from.x, from.y);
  for (let i = 1; i <= 8; i++) {
    app.move(from.x + (nearMid.x - from.x) * i / 8, from.y + (nearMid.y - from.y) * i / 8, { buttons: 1 });
  }
  const draggedId = app.state.drag.id;
  const posDuringDrag = { ...app.state.joints.get(draggedId) };
  const snapDuringDrag = app.state.activeSnap ? { type: app.state.activeSnap.type, isLocked: app.state.activeSnap.isLocked } : null;
  app.up(nearMid.x, nearMid.y);
  const posAfterRelease = { ...app.state.joints.get(draggedId) };
  const midConstraints = app.state.constraints.filter(c => c.type === 'midpoint').length;
  console.log('P5-A RECT CORNER CLUSTER DRAG TO MIDPOINT:', JSON.stringify({
    targetMid: [0, 4],
    snapDuringDrag,
    posDuringDrag: [+posDuringDrag.x.toFixed(4), +posDuringDrag.y.toFixed(4)],
    posAfterRelease: [+posAfterRelease.x.toFixed(4), +posAfterRelease.y.toFixed(4)],
    jumpOnReleaseDist: +Math.hypot(posAfterRelease.x - posDuringDrag.x, posAfterRelease.y - posDuringDrag.y).toFixed(4),
    midConstraints,
  }));

  // P5-B: Hover with Line tool over a fresh LINE's midpoint vs an ARC's sweep midpoint
  app.esc();
  const lFresh = addLine(app, -8, -6, -2, -6); // midpoint (-5, -6)
  const arc1 = addArcShape(app, 6, -2, 9, -2, 6, 1, true); // sweep midpoint at 45 deg
  const arcMid = { x: 6 + 3 * Math.SQRT1_2, y: -2 + 3 * Math.SQRT1_2 };
  app.tool('line');
  const lMidSc = app.toScreen(-5, -6);
  app.move(lMidSc.x + 2, lMidSc.y);
  const lineHoverSnap = app.state.snapTarget ? { type: app.state.snapTarget.type } : null;
  const aMidSc = app.toScreen(arcMid.x, arcMid.y);
  app.move(aMidSc.x + 2, aMidSc.y);
  const arcHoverSnap = app.state.snapTarget ? { type: app.state.snapTarget.type } : null;
  console.log('P5-B HOVER MIDPOINT SNAP (LINE vs ARC):', JSON.stringify({ lineHoverSnap, arcHoverSnap }));
  await app.close();
}

// ===========================================================================
// PAIR 6: Selection order A-then-B vs B-then-A (Tangent line+circle vs circle+line)
// ===========================================================================
section('P6: Selection order A-then-B vs B-then-A (Tangent Line+Circle vs Circle+Line)');
{
  const results = {};
  for (const order of ['line-then-circle', 'circle-then-line']) {
    const app = await openHost('sketchstudio');
    const l1 = addLine(app, -5, 4, 5, 4);
    const ci = addCircle(app, 0, -2, 2);
    const lBefore = { y: app.state.joints.get(l1.a).y };
    const cBefore = { y: app.state.joints.get(ci.c).y, r: app.state.shapes.find(s => s.id === ci.id).radius };
    app.tool('tangent');
    if (order === 'line-then-circle') { clickWorld(app, 0, 4); clickWorld(app, 2, -2); }
    else { clickWorld(app, 2, -2); clickWorld(app, 0, 4); }
    const lAfter = { y: +app.state.joints.get(l1.a).y.toFixed(3) };
    const cAfter = { y: +app.state.joints.get(ci.c).y.toFixed(3), r: +app.state.shapes.find(s => s.id === ci.id).radius.toFixed(3) };
    results[order] = {
      lineMoved: Math.abs(lAfter.y - lBefore.y) > 0.01,
      circleMoved: Math.abs(cAfter.y - cBefore.y) > 0.01 || Math.abs(cAfter.r - cBefore.r) > 0.01,
      lAfter, cAfter,
    };
    await app.close();
  }
  console.log('P6 TANGENT ORDER (LINE+CIRCLE vs CIRCLE+LINE):', JSON.stringify(results));
}

// ===========================================================================
// PAIR 8: Before vs After Undo/Redo (Lock F skips undo and undoes earlier geometry!)
// ===========================================================================
section('P8: Undo/Redo missing steps (Lock F undoes earlier shape; Dblclick determined dim mutates without undo)');
{
  const app = await openHost('sketchstudio');
  const l1 = addLine(app, -4, 3, 4, 3);
  app.state.saveState('before l2');
  const l2 = addLine(app, -4, -3, 4, -3);
  app.frames(2);
  const hBeforeF = app.state.history.length;
  // Lock l1 via F key
  app.state.selectedShapes.add(l1.id);
  app.key('f');
  const hAfterF = app.state.history.length;
  const l1FixedAfterF = app.state.joints.get(l1.a).fixed;
  // Press Undo expecting l1 to unlock — instead l2 is deleted!
  app.undo();
  console.log('P8-A LOCK (F) UNDO:', JSON.stringify({
    hBeforeF, hAfterF, l1FixedAfterF,
    shapesAfterUndo: app.state.shapes.length,
    l2DeletedByUndo: !app.state.shapes.some(s => s.id === l2.id),
    l1FixedAfterUndo: app.state.joints.get(l1.a)?.fixed,
  }));
  await app.close();
}
{
  const app = await openHost('sketchstudio');
  const l1 = addLine(app, 1, 2, 6, 2);
  const l2 = addLine(app, 1, 2, 1, 7);
  ConstraintManager.createConstraint(app.state, CONSTRAINT_TYPES.COINCIDENT, { joints: [l1.a, l2.a] });
  ConstraintManager.createConstraint(app.state, CONSTRAINT_TYPES.HORIZONTAL, { joints: [l1.a, l1.b] });
  ConstraintManager.createConstraint(app.state, CONSTRAINT_TYPES.VERTICAL, { joints: [l2.a, l2.b] });
  const ang = ConstraintManager.createConstraint(app.state, CONSTRAINT_TYPES.ANGLE, { shapes: [l1.id, l2.id], value: 90 });
  app.state.saveState('before dblclick');
  app.frames(2);
  const hBefore = app.state.history.length;
  const drivenBefore = !!ang.isDriven;
  clearToasts(app);
  const idx = app.state.constraints.indexOf(ang);
  const targetLabel = app.svg.querySelector(`.dim-label[data-constraint-idx="${idx}"]`);
  const gp = ang.glyphPos ? app.toScreen(ang.glyphPos.x, ang.glyphPos.y) : app.toScreen(3, 4);
  if (targetLabel) {
    app.dblclick(gp.x, gp.y, { target: () => app.svg.querySelector(`.dim-label[data-constraint-idx="${idx}"]`) });
  }
  console.log('P8-B DBLCLICK DETERMINED ANGLE DIM:', JSON.stringify({
    foundLabel: !!targetLabel, drivenBefore, drivenAfter: !!ang.isDriven, hBefore, hAfter: app.state.history.length, toasts: readToasts(app),
  }));
  await app.close();
}

// ===========================================================================
// PAIR 9: Draw-time box vs Click / Edit afterwards
// ===========================================================================
section('P9: Draw-time value box vs Click / Edit afterwards');
{
  // 9a. Circle snapped to Origin: Mouse Click-2 vs Typing diameter + Enter!
  const app1 = await openHost('sketchstudio');
  app1.tool('circle');
  const origSc = app1.toScreen(0, 0);
  app1.click(origSc.x + 2, origSc.y + 2);
  const rimSc = app1.toScreen(3, 0);
  app1.click(rimSc.x, rimSc.y);
  const circleClick = {
    shapes: app1.state.shapes.length,
    coincidentOnCenter: app1.state.constraints.filter(c => c.type === 'coincident').length,
    radiusDim: app1.state.constraints.filter(c => c.isRadius).length,
  };
  await app1.close();

  const app2 = await openHost('sketchstudio');
  app2.tool('circle');
  const origSc2 = app2.toScreen(0, 0);
  app2.click(origSc2.x + 2, origSc2.y + 2);
  const pMove = app2.toScreen(2, 0);
  app2.move(pMove.x, pMove.y);
  app2.type('6');
  app2.enter();
  const circleEnter = {
    shapes: app2.state.shapes.length,
    radius: app2.state.shapes[0]?.radius,
    coincidentOnCenter: app2.state.constraints.filter(c => c.type === 'coincident').length,
    radiusDim: app2.state.constraints.filter(c => c.isRadius).map(c => ({ value: c.value, isDiameter: !!c.isDiameter })),
  };
  await app2.close();

  // 9b. Circle click 1 -> NO mouse move -> type 6 -> Enter!
  const app3 = await openHost('sketchstudio');
  app3.tool('circle');
  const o3 = app3.toScreen(0, 0);
  app3.click(o3.x + 2, o3.y + 2);
  app3.type('6');
  app3.enter();
  const circleNoMoveEnter = {
    shapes: app3.state.shapes.length,
    stillActive: !!app3.state.active,
  };
  await app3.close();

  // 9c. Polygon draw-time box: type formula `d1 / 2` -> NO radius dimension, formula dropped!
  const app4 = await openHost('sketchstudio');
  const refL = addLine(app4, -6, 5, 6, 5);
  ConstraintManager.createConstraint(app4.state, CONSTRAINT_TYPES.DISTANCE, { joints: [refL.a, refL.b], value: 12 });
  app4.frames(2);
  app4.tool('polygon');
  const pc = app4.toScreen(0, 0);
  app4.click(pc.x, pc.y);
  app4.move(pc.x + 40, pc.y);
  app4.type('d1 / 2');
  app4.enter();
  const polyDims = app4.state.constraints.filter(c => c.type === 'distance');
  const polyRes = {
    shapesCount: app4.state.shapes.length,
    distanceConstraintsTotal: polyDims.length,
    polyExprs: polyDims.map(c => ({ name: c.name, value: c.value, expr: c.expression || null })),
  };
  await app4.close();

  // 9d. Line draw-time box: type length 5, Tab, angle 0 -> NO H/V or angle constraint!
  const app5 = await openHost('sketchstudio');
  app5.tool('line');
  const lp = app5.toScreen(-3, 2);
  app5.click(lp.x, lp.y);
  app5.move(lp.x + 50, lp.y - 30);
  app5.type('5');
  app5.key('Tab');
  app5.type('0');
  app5.enter();
  const lineBoxRes = {
    shapes: app5.state.shapes.length,
    constraints: app5.state.constraints.filter(c => c.type !== 'coincident').map(c => ({ type: c.type, value: c.value })),
  };
  await app5.close();

  // 9e. Slot C2C typed span formula `d1 / 2` vs Center-Point slot typed span formula `d1 / 2`
  const slotRes = {};
  for (const mode of [SLOT_MODES.CENTER_TO_CENTER, SLOT_MODES.CENTER_POINT]) {
    const appS = await openHost('sketchstudio');
    const rL = addLine(appS, -6, 6, 6, 6);
    ConstraintManager.createConstraint(appS.state, CONSTRAINT_TYPES.DISTANCE, { joints: [rL.a, rL.b], value: 12 });
    appS.frames(2);
    appS.state.slotMode = mode;
    appS.tool('slot');
    const sp1 = appS.toScreen(-2, -2);
    appS.click(sp1.x, sp1.y);
    appS.move(sp1.x + 80, sp1.y);
    appS.type('d1 / 2');
    appS.enter(); // advances to width
    appS.move(sp1.x + 80, sp1.y + 30);
    appS.type('d1 / 4');
    appS.enter(); // commits slot
    slotRes[mode] = appS.state.constraints.filter(c => c.type === 'distance').map(c => ({
      name: c.name, value: +c.value.toFixed(2), isRadius: !!c.isRadius, isDiameter: !!c.isDiameter, expr: c.expression || null,
    }));
    await appS.close();
  }

  // 9f. Fillet & Offset boxes: do their parsers accept formula `d1 / 2`?
  const filletFormulaParsed = parseFilletRadius('d1 / 2', 'mm');
  const offsetFormulaParsed = parseOffsetDistance('d1 / 2', 'mm');

  console.log('P9 DRAW-TIME BOX ASYMMETRIES:', JSON.stringify({
    circleClick, circleEnter, circleNoMoveEnter, polyRes, lineBoxRes, slotRes, filletFormulaParsed, offsetFormulaParsed,
  }));
}

// ===========================================================================
// PAIR 7 EXTRA: Pen Plotter shouldSolve gate on constraint add / dim edit
// ===========================================================================
section('P7-D: Pen Plotter shouldSolve gate vs SketchStudio');
{
  const app = await openHost('penplotter');
  const l1 = addLine(app, 40, 40, 80, 45);
  app.frames(2);
  const dyBefore = Math.abs(app.state.joints.get(l1.b).y - app.state.joints.get(l1.a).y);
  app.tool('hv');
  clickWorld(app, 60, 42.5);
  app.frames(3);
  const dyAfter = Math.abs(app.state.joints.get(l1.b).y - app.state.joints.get(l1.a).y);
  console.log('P7-D PENPLOTTER HV SOLVE:', JSON.stringify({ dyBefore: +dyBefore.toFixed(3), dyAfter: +dyAfter.toFixed(3) }));
  await app.close();
}

// ===========================================================================
// EXTRA IRREGULARITIES: Pattern label dblclick (Select vs Dim); Dim press-drag vs click-click;
// Dim point+own-line vs line+own-point; SketchStudio bar vs dropdown shortcut re-press
// ===========================================================================
section('EXTRA: Dim tool asymmetries (pattern label dblclick, press-drag vs click-click, point+own-line vs line+own-point, bar vs dropdown shortcut)');
{
  // E1. Dim tool point-then-own-line vs line-then-own-point
  const app = await openHost('sketchstudio');
  const l1 = addLine(app, -4, 3, 4, 3);
  app.tool('dim');
  clearToasts(app);
  clickWorld(app, -4, 3); // point first
  clickWorld(app, 0, 3);  // then its own line
  const pointThenOwnLine = { constraints: app.state.constraints.length, placing: !!app.state.placingConstraint, toasts: readToasts(app) };

  app.esc();
  app.tool('dim');
  clearToasts(app);
  clickWorld(app, 0, 3);  // line first
  clickWorld(app, -4, 3); // then its own endpoint
  const lineThenOwnPoint = { constraints: app.state.constraints.length, placing: !!app.state.placingConstraint, toasts: readToasts(app) };

  // E2. SketchStudio keyboard shortcut pressed TWICE: tool IN BAR (parallel -> #tool-parallel exists) vs NOT IN BAR (symmetric / collinear if in dropdown)
  app.esc();
  const inBarTools = [...app.document.querySelectorAll('.sk-ribbon-btn[data-tool]')].map(b => b.dataset.tool);
  // Press 'p' (or whatever parallel's key is) vs a dropdown tool's key via shortcuts
  const { shortcutById } = await import('#ui/shortcuts.js');
  const testShortcutToggle = (tool, shortcutId) => {
    app.esc();
    const rec = shortcutById(shortcutId);
    const spec = rec && rec.keys && rec.keys[0];
    const hasBtn = !!app.document.getElementById('tool-' + tool);
    if (!spec) return { tool, hasBtn, key: null };
    const send = () => app.key(spec.key, { shift: !!spec.shift, ctrl: !!spec.ctrl, alt: !!spec.alt });
    send();
    const t1 = app.state.currentTool;
    send();
    const t2 = app.state.currentTool;
    return { tool, hasBtn, key: (spec.shift ? 'Shift+' : '') + spec.key, after1: t1, after2: t2 };
  };
  const keyToggleParallel = testShortcutToggle('parallel', 'tool.parallel');
  const keyToggleMidpoint = testShortcutToggle('midpoint', 'tool.midpoint');
  const keyToggleCollinear = testShortcutToggle('collinear', 'tool.collinear');

  // E3. Dimension tool press-drag (>250 ms) vs click-click: does edit box (#dimInput) open?
  app.esc();
  app.state.constraints.length = 0;
  app.tool('dim');
  const mSc = app.toScreen(0, 3);
  app.move(mSc.x, mSc.y);
  app.down(mSc.x, mSc.y);
  await app.pause(300);
  app.move(mSc.x, mSc.y - 40, { buttons: 1 });
  app.up(mSc.x, mSc.y - 40);
  const dimInput = app.document.getElementById('dimInput');
  const dragDropEditOpen = !!(dimInput && !dimInput.classList.contains('hidden'));
  const dragDropPlaced = app.state.constraints.length;

  app.esc();
  app.state.constraints.length = 0;
  app.tool('dim');
  clickWorld(app, 0, 3);
  clickWorld(app, 0, 1);
  const clickClickEditOpen = !!(dimInput && !dimInput.classList.contains('hidden'));

  // E4. Double-clicking a PATTERN label in Select tool vs Dimension tool!
  app.esc();
  const { applyPattern, patternObjectsOf, patternDefaults } = await import('#core/pattern.js');
  const pr = ops.rect(app.state, -4, -3, -2, -1);
  const pat = applyPattern(app.state, CONSTRAINT_TYPES.RECTANGULAR_PATTERN, patternObjectsOf(pr.lines, []), {
    ...patternDefaults(CONSTRAINT_TYPES.RECTANGULAR_PATTERN), quantity: [3, 1], distance: [6, 4],
  });
  app.frames(3);
  const pIdx = app.state.constraints.indexOf(pat.constraint);
  const pLbl = app.svg.querySelector(`.dim-label[data-constraint-idx="${pIdx}"]`);
  app.tool('dim');
  let dimToolPatEditOpen = null, dimToolPatErr = null;
  if (pLbl) {
    try {
      const sp = app.toScreen(-2, -2);
      app.dblclick(sp.x, sp.y, { target: () => app.svg.querySelector(`.dim-label[data-constraint-idx="${pIdx}"]`) });
      dimToolPatEditOpen = !!(dimInput && !dimInput.classList.contains('hidden'));
    } catch (err) { dimToolPatErr = String(err); }
  }

  console.log('EXTRA:', JSON.stringify({
    pointThenOwnLine, lineThenOwnPoint,
    inBarToolsCount: inBarTools.length,
    keyToggleParallel, keyToggleMidpoint, keyToggleCollinear,
    dragDropPlaced, dragDropEditOpen, clickClickEditOpen,
    patternLabelFound: !!pLbl, dimToolPatEditOpen, dimToolPatErr,
  }));
  await app.close();
}
