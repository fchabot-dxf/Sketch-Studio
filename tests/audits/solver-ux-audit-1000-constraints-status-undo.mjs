// tests/audits/solver-ux-audit-1000-constraints-status-undo.mjs -- TASK 1000 (AUDIT, outside the gate)
// Run: node tests/audits/solver-ux-audit-1000-constraints-status-undo.mjs
// Covers: CONSTRAINT ADD/DELETE, STATUS colouring & over-constrained recovery, UNDO/REDO across solves,
// and MODIFY tools (Fillet / Mirror / Offset / Pattern / Trim / Break) under later drags.
import { design, openDesign, closeAll, J, dist, snapshot, moved, movedText, residualText, status, statusText, dragWorld, dragJoint, editDim, editText, dim, row, f, pt, quiet, toasts, clearToasts, theApp } from './solver-ux-audit-1000-kit.js';
import { ConstraintManager } from '#core/constraint-manager.js';
import { deleteConstraints, deleteSelection, deleteShapes, deleteJoints } from '#core/delete-manager.js';
import { applyFillet, findCornerAtJoint } from '#core/fillet.js';
import { mirrorObjects } from '#core/mirror.js';
import { offsetChainOf, applyOffset } from '#core/offset.js';
import { applyPattern, patternDefaults } from '#core/pattern.js';
import { trimShape } from '#core/trim.js';
import { breakShape } from '#core/break.js';
import { toggleDriving } from '#core/dimension-seams.js';
import { selectionLockState } from '#ui/input-manager.js';
import { CONSTRAINT_TYPES } from '#core/constants.js';

const D = (a, b, value, name, extra = {}) => ({ type: 'distance', joints: [a, b], value, name, ...extra });
const H = (a, b) => ({ type: 'horizontal', joints: [a, b] });
const V = (a, b) => ({ type: 'vertical', joints: [a, b] });

const RECT = (extra = []) => design(
  { a: [0, 0, true], b: [80, 0], c: [80, 40], d: [0, 40] },
  [{ id: 'L1', type: 'line', joints: ['a', 'b'] }, { id: 'L2', type: 'line', joints: ['b', 'c'] }, { id: 'L3', type: 'line', joints: ['c', 'd'] }, { id: 'L4', type: 'line', joints: ['d', 'a'] }],
  [H('a', 'b'), V('b', 'c'), H('c', 'd'), V('d', 'a'), D('a', 'b', 80, 'd1'), D('b', 'c', 40, 'd2'), ...extra]);

function findDangling(st) {
  const sids = new Set(st.shapes.map((s) => s.id));
  sids.add('ref_axis_x'); sids.add('ref_axis_y');
  const bad = [];
  for (const c of st.constraints) {
    if (!c) continue;
    for (const j of [...(c.joints || []), ...(c.joint ? [c.joint] : [])]) {
      if (!st.joints.has(j) && j !== 'ref_origin' && j !== 'ref_x_end' && j !== 'ref_y_end') bad.push(`${c.type}:missing-joint(${j})`);
    }
    for (const s of [...(c.shapes || []), ...(c.shape ? [c.shape] : []), ...(c.line ? [c.line] : []), ...(c.circle ? [c.circle] : [])]) {
      if (!sids.has(s)) bad.push(`${c.type}:missing-shape(${s})`);
    }
  }
  return bad;
}

await (async () => {
  // ================ C1: CONSTRAINT ADD (redundant, conflicting, notices) ================
  let app = await openDesign(RECT(), { centre: { x: 40, y: 20 }, w: 220 });
  {
    const tryAdd = (id, type, params, source = 'toolbar') => {
      clearToasts();
      const before = snapshot();
      const n0 = app.state.constraints.length;
      const res = ConstraintManager.createConstraint(app.state, type, params, { source });
      row(id, `add ${type} (${source}): res=${res ? (res.isDriven ? 'REFERENCE' : 'ADDED') : 'null'}, count ${n0}->${app.state.constraints.length}, ${movedText(before)}, toasts=${JSON.stringify(toasts())}`);
    };
    tryAdd('C1.1', CONSTRAINT_TYPES.HORIZONTAL, { joints: ['a', 'b'] }); // exact duplicate
    tryAdd('C1.2', CONSTRAINT_TYPES.VERTICAL, { joints: ['a', 'b'] }); // direct contradiction H vs V
    tryAdd('C1.3', CONSTRAINT_TYPES.PERPENDICULAR, { shapes: ['L1', 'L3'] }); // parallel lines perp conflict
    tryAdd('C1.4', CONSTRAINT_TYPES.PARALLEL, { shapes: ['L1', 'L2'] }); // perp lines parallel conflict
    tryAdd('C1.5', CONSTRAINT_TYPES.COLLINEAR, { shapes: ['L1', 'L2'] }); // H vs V collinear
    tryAdd('C1.6', CONSTRAINT_TYPES.EQUAL, { shapes: ['L1', 'L2'] }); // 80 vs 40 fixed conflict
    tryAdd('C1.7', CONSTRAINT_TYPES.DISTANCE, { joints: ['a', 'c'], value: Math.hypot(80, 40) }); // redundant diagonal -> reference
    tryAdd('C1.8', CONSTRAINT_TYPES.ANGLE, { shapes: ['L1', 'L2'], value: 45 }); // conflicting angle -> reference with [ERR-...]?
    tryAdd('C1.9', CONSTRAINT_TYPES.SYMMETRIC, { joints: ['a', 'a'], line: 'L2' }); // invalid pick -> [ERR-CMATH-01] leak!
    tryAdd('C1.10', CONSTRAINT_TYPES.PARALLEL, { shapes: ['L1', 'L3'] }); // REDUNDANT (already both H, not exact duplicate!)
    tryAdd('C1.11', CONSTRAINT_TYPES.PERPENDICULAR, { shapes: ['L1', 'L2'] }); // REDUNDANT (already H + V, not exact duplicate!)
    tryAdd('C1.12', CONSTRAINT_TYPES.EQUAL, { shapes: ['L1', 'L3'] }); // REDUNDANT (both already 80 via rect!)
  }

  // C1.13: What about adding a constraint when a sketch is ALREADY over-constrained (residual > 0)?
  app = await openDesign(design(
    { a: [0, 0, true], b: [50, 0], c: [50, 40], p: [100, 10], q: [130, 20] },
    [{ id: 'L1', type: 'line', joints: ['a', 'b'] }, { id: 'L2', type: 'line', joints: ['b', 'c'] }, { id: 'L3', type: 'line', joints: ['c', 'a'] }, { id: 'L4', type: 'line', joints: ['p', 'q'] }],
    [H('a', 'b'), D('a', 'b', 50, 'd1'), D('b', 'c', 40, 'd2'), D('c', 'a', 120, 'd3')]), { centre: { x: 50, y: 20 }, w: 260 });
  {
    clearToasts();
    const res = ConstraintManager.createConstraint(app.state, CONSTRAINT_TYPES.HORIZONTAL, { joints: ['p', 'q'] }, { source: 'toolbar' });
    row('C1.13', `add H to UNRELATED free line L4 while triangle is conflicted: res=${res ? 'ADDED' : 'null'}, toasts=${JSON.stringify(toasts())}, ${residualText()}`);
  }

  // ================ C2: CONSTRAINT DELETE (including locked sketch bug!) ================
  // C2.1: Delete constraint on a LOCKED sketch via deleteSelection (delete-manager.js:183-187!)
  app = await openDesign(design(
    { a: [0, 0, true], b: [60, 0] },
    [{ id: 'L1', type: 'line', joints: ['a', 'b'] }],
    [H('a', 'b'), D('a', 'b', 60, 'd1')]), { centre: { x: 30, y: 0 }, w: 200 });
  {
    app.state.sketches.push({ id: 'sketch-2', name: 'Sketch 2', visible: true, locked: false });
    app.state.sketches[0].locked = true;
    app.state.activeSketchId = 'sketch-2';
    const d1 = dim('d1');
    app.state.selectedConstraints.add(d1);
    app.state.selectedShapes.add('L1');
    const nC0 = app.state.constraints.length, nS0 = app.state.shapes.length;
    deleteSelection(app.state);
    row('C2.1', `deleteSelection with LOCKED sketch-1 shape L1 + dim d1 selected: shapes ${nS0}->${app.state.shapes.length}, constraints ${nC0}->${app.state.constraints.length} (d1 still present: ${app.state.constraints.includes(d1)})`);
  }

  // C2.2: Deleting a dimension referenced by another formula (O10) -> then Undo
  app = await openDesign(RECT(), { centre: { x: 40, y: 20 }, w: 220 });
  await editDim('d2', 'd1 / 2');
  {
    const d1 = dim('d1');
    const before = snapshot();
    deleteConstraints(app.state, [d1]);
    const afterDel = { hasD1: !!dim('d1'), d2Val: dim('d2')?.value, d2Expr: dim('d2')?.expression, params: app.state.parameters.map((p) => `${p.name}=${p.value}`), moved: movedText(before), res: residualText() };
    await quiet(async () => app.undo());
    const afterUndo = { hasD1: !!dim('d1'), d2Val: dim('d2')?.value, d2Expr: dim('d2')?.expression, params: app.state.parameters.map((p) => `${p.name}=${p.value}`), moved: movedText(before), res: residualText() };
    row('C2.2', `delete d1 (used by d2="d1 / 2") then Undo: afterDel=${JSON.stringify(afterDel)}; afterUndo=${JSON.stringify(afterUndo)}`);
  }

  // ================ C3: DELETING GEOMETRY REFERENCED BY CONSTRAINTS ================
  // C3.1: Delete fillet arc / fillet leg / virtual sharp
  app = await openDesign(RECT(), { centre: { x: 40, y: 20 }, w: 220 });
  {
    const corner = findCornerAtJoint(app.state, 'b');
    applyFillet(app.state, corner, 10);
    const arc = app.state.shapes.find((s) => s.type === 'arc');
    deleteShapes(app.state, [arc.id]);
    row('C3.1', `delete fillet arc: shapes=${app.state.shapes.length}, constraints=${app.state.constraints.length}, dangling=${JSON.stringify(findDangling(app.state))}, ${statusText()}`);
  }
  // C3.2: Delete mirror line after mirroring
  app = await openDesign(design(
    { m1: [0, -50, true], m2: [0, 50, true], a: [30, 10], b: [60, 30] },
    [{ id: 'ML', type: 'line', joints: ['m1', 'm2'], isConstruction: true }, { id: 'L1', type: 'line', joints: ['a', 'b'] }]), { centre: { x: 0, y: 10 }, w: 260 });
  {
    mirrorObjects(app.state, { shapes: ['L1'], joints: [] }, 'ML');
    deleteShapes(app.state, ['ML']);
    row('C3.2', `delete mirror line ML: shapes=${app.state.shapes.length}, constraints=${app.state.constraints.length}, dangling=${JSON.stringify(findDangling(app.state))}`);
  }
  // C3.3: Delete offset source line vs delete offset copy line
  app = await openDesign(design(
    { a: [0, 0, true], b: [80, 0] },
    [{ id: 'L1', type: 'line', joints: ['a', 'b'] }],
    [H('a', 'b'), D('a', 'b', 80, 'd1')]), { centre: { x: 40, y: 10 }, w: 220 });
  {
    const ch = offsetChainOf(app.state, 'L1');
    const off = applyOffset(app.state, ch.chain, 10, 1);
    deleteShapes(app.state, [off.shapes[0]]);
    row('C3.3', `delete offset copy line: shapes=${app.state.shapes.length}, constraints=${app.state.constraints.length}, types=${JSON.stringify(app.state.constraints.map((c) => c.type))}, dangling=${JSON.stringify(findDangling(app.state))}`);
  }
  // C3.4: Delete offset SOURCE line of a 4-line rectangle offset (delete ONE side of source!)
  app = await openDesign(RECT(), { centre: { x: 40, y: 20 }, w: 220 });
  {
    const ch = offsetChainOf(app.state, 'L1');
    applyOffset(app.state, ch.chain, 5, 1);
    deleteShapes(app.state, ['L1']);
    row('C3.4', `delete 1 side of offset source rect: shapes=${app.state.shapes.length}, constraints=${app.state.constraints.length}, offsetLeft=${app.state.constraints.filter((c) => c.type === 'offset').length}, dangling=${JSON.stringify(findDangling(app.state))}, ${residualText()}`);
  }

  // ================ S1: STATUS COLOURING & OVER-CONSTRAINED RECOVERY ================
  // S1.1: Fillet on two LOCKED lines -> selectionLockState + status
  app = await openDesign(design(
    { a: [0, 0, true], b: [60, 0, true], c: [60, 50, true] },
    [{ id: 'L1', type: 'line', joints: ['a', 'b'] }, { id: 'L2', type: 'line', joints: ['b', 'c'] }]), { centre: { x: 30, y: 25 }, w: 220 });
  {
    const stBefore = statusText();
    const corner = findCornerAtJoint(app.state, 'b');
    applyFillet(app.state, corner, 10);
    app.state.selectedShapes.clear(); app.state.selectedShapes.add('L1');
    const lockL1 = selectionLockState(app.state);
    row('S1.1', `fillet on two locked lines L1,L2: before=${stBefore}; after=${statusText()}; selectionLockState(L1)=${JSON.stringify(lockL1)} (L1 joints fixed: ${app.state.shapes.find((s) => s.id === 'L1').joints.map((j) => app.state.joints.get(j)?.fixed)})`);
  }
  // S1.2: Over-constrained recovery: conflicted triangle -> delete d3 -> does status recover?
  app = await openDesign(design(
    { a: [0, 0, true], b: [50, 0], c: [50, 40] },
    [{ id: 'L1', type: 'line', joints: ['a', 'b'] }, { id: 'L2', type: 'line', joints: ['b', 'c'] }, { id: 'L3', type: 'line', joints: ['c', 'a'] }],
    [H('a', 'b'), D('a', 'b', 50, 'd1'), D('b', 'c', 40, 'd2'), D('c', 'a', 120, 'd3')]), { centre: { x: 25, y: 20 }, w: 220 });
  {
    const stConf = statusText();
    const resConf = residualText();
    deleteConstraints(app.state, [dim('d3')]);
    row('S1.2', `conflicted triangle -> delete d3: before=(${stConf}; ${resConf}); after=(${statusText()}; ${residualText()}; a=${pt(J('a'))} b=${pt(J('b'))} c=${pt(J('c'))})`);
  }
  // S1.3: Status after editing a dimension to degenerate 180 deg triangle (30+40=70)
  app = await openDesign(design(
    { a: [0, 0, true], b: [30, 0], c: [30, 40] },
    [{ id: 'L1', type: 'line', joints: ['a', 'b'] }, { id: 'L2', type: 'line', joints: ['b', 'c'] }, { id: 'L3', type: 'line', joints: ['c', 'a'] }],
    [H('a', 'b'), D('a', 'b', 30, 'd1'), D('b', 'c', 40, 'd2'), D('c', 'a', 50, 'd3')]), { centre: { x: 15, y: 20 }, w: 180 });
  {
    await editDim('d3', '70');
    row('S1.3', `degenerate flat triangle (30,40,70): c=${pt(J('c'))}, ${statusText()}, ${residualText()}`);
  }

  // ================ U1: UNDO / REDO ACROSS SOLVES ================
  // U1.1: Drag that moves constrained neighbours -> Undo -> Redo
  app = await openDesign(design(
    { a: [0, 0, true], b: [60, 0], c: [60, 40], d: [0, 40] },
    [{ id: 'L1', type: 'line', joints: ['a', 'b'] }, { id: 'L2', type: 'line', joints: ['b', 'c'] }, { id: 'L3', type: 'line', joints: ['c', 'd'] }, { id: 'L4', type: 'line', joints: ['d', 'a'] }],
    [H('a', 'b'), V('b', 'c'), H('c', 'd'), V('d', 'a')]), { centre: { x: 40, y: 20 }, w: 240 });
  {
    const s0 = snapshot();
    await dragJoint('c', { x: 110, y: 70 }, 20);
    const sDrag = snapshot();
    await quiet(async () => app.undo());
    const sUndo = snapshot();
    await quiet(async () => app.redo());
    const sRedo = snapshot();
    row('U1.1', `rect drag c->(110,70) Undo/Redo: drag moved b=${pt(sDrag.get('b'))} c=${pt(sDrag.get('c'))} d=${pt(sDrag.get('d'))}; undo vs init ${movedText(s0, sUndo)}; redo vs drag ${movedText(sDrag, sRedo)}`);
  }

  // U1.2: Angle dim edited across 180 (60 -> 270) -> Undo -> Redo
  app = await openDesign(design(
    { a: [0, 0, true], b: [60, 0, true], c: [25, 43.30127] },
    [{ id: 'L1', type: 'line', joints: ['a', 'b'] }, { id: 'L2', type: 'line', joints: ['a', 'c'] }],
    [D('a', 'c', 50, 'd1'), { type: 'angle', shapes: ['L1', 'L2'], joints: ['b', 'a', 'c'], value: 60, name: 'd2' }]), { centre: { x: 10, y: 10 }, w: 200 });
  {
    const s0 = snapshot();
    await editDim('d2', '270');
    const sEdit = snapshot();
    await quiet(async () => app.undo());
    const sUndo = snapshot(); const d2Undo = dim('d2').value;
    await quiet(async () => app.redo());
    const sRedo = snapshot(); const d2Redo = dim('d2').value;
    row('U1.2', `angle 60->270 Undo/Redo: edit c=${pt(sEdit.get('c'))}; undo vs init ${movedText(s0, sUndo)} d2=${d2Undo}; redo vs edit ${movedText(sEdit, sRedo)} d2=${d2Redo}`);
  }

  // ================ M1: MODIFY TOOLS UNDER LATER DRAGS ================
  // M1.1: OFFSET — delete offset dim (undimensionOffset) on negative offset then drag copy; also drag source of normal offset
  app = await openDesign(design(
    { a: [0, 0, true], b: [80, 0], c: [80, 40], d: [0, 40] },
    [{ id: 'L1', type: 'line', joints: ['a', 'b'] }, { id: 'L2', type: 'line', joints: ['b', 'c'] }, { id: 'L3', type: 'line', joints: ['c', 'd'] }, { id: 'L4', type: 'line', joints: ['d', 'a'] }],
    [H('a', 'b'), V('b', 'c'), H('c', 'd'), V('d', 'a')]), { centre: { x: 40, y: 20 }, w: 260 });
  {
    const ch = offsetChainOf(app.state, 'L1');
    const off = applyOffset(app.state, ch.chain, 8, 1);
    const offC = app.state.constraints.find((c) => c.type === 'offset');
    const offS0 = app.state.shapes.find((s) => s.id === off.shapes[0]);
    const pBefore = J(offS0.joints[0]);
    // Drag source corner c outward (+20, +20)
    await dragJoint('c', { x: 100, y: 60 }, 20);
    const afterSrcDrag = { c: pt(J('c')), off0: pt(J(offS0.joints[0])), res: residualText() };
    // Now delete offset dimension (undimensionOffset) and drag offset copy!
    deleteConstraints(app.state, [offC]);
    const copyJ = offS0.joints[0];
    const beforeCopyDrag = J(copyJ);
    await dragJoint(copyJ, { x: beforeCopyDrag.x + 15, y: beforeCopyDrag.y + 15 }, 20);
    row('M1.1', `offset rect: afterSrcDrag=${JSON.stringify(afterSrcDrag)}; after undimensionOffset+drag copy: ${pt(beforeCopyDrag)}->${pt(J(copyJ))}, offC.value=${f(offC.value)}, ${residualText()}`);
  }

  // M1.2: OFFSET on a negative offset value: edit d -> -10 (flips side), then drag source
  app = await openDesign(design(
    { a: [0, 0, true], b: [80, 0] },
    [{ id: 'L1', type: 'line', joints: ['a', 'b'] }],
    [H('a', 'b'), D('a', 'b', 80, 'd1')]), { centre: { x: 40, y: 0 }, w: 240 });
  {
    const ch = offsetChainOf(app.state, 'L1');
    const off = applyOffset(app.state, ch.chain, 10, 1);
    const offC = app.state.constraints.find((c) => c.type === 'offset');
    const offLine = app.state.shapes.find((s) => s.id === off.shapes[0]);
    const yBefore = J(offLine.joints[0]).y;
    const ed = await editDim(offC.name, '-10');
    const yAfterNeg = J(offLine.joints[0]).y;
    row('M1.2', `offset line d=+10 -> "-10": edit=${editText(ed)}, y ${f(yBefore)}->${f(yAfterNeg)}, val=${offC.value}, ${residualText()}`);
  }

  // M1.3: MIRROR of a FILLET ARC (arc.sweep === undefined!) -> drag corner!
  app = await openDesign(design(
    { m1: [0, -60, true], m2: [0, 60, true], a: [20, 0, true], b: [70, 0], c: [70, 50] },
    [{ id: 'ML', type: 'line', joints: ['m1', 'm2'], isConstruction: true }, { id: 'L1', type: 'line', joints: ['a', 'b'] }, { id: 'L2', type: 'line', joints: ['b', 'c'] }],
    [H('a', 'b'), D('a', 'b', 50, 'd1'), D('b', 'c', 50, 'd2')]), { centre: { x: 0, y: 20 }, w: 260 });
  {
    const corner = findCornerAtJoint(app.state, 'b');
    applyFillet(app.state, corner, 10);
    const origArc = app.state.shapes.find((s) => s.type === 'arc');
    const mr = mirrorObjects(app.state, { shapes: ['L1', 'L2', origArc.id], joints: [] }, 'ML');
    const mirArc = app.state.shapes.find((s) => s.id === mr.shapes[2]);
    row('M1.3', `mirror fillet arc: orig.sweep=${origArc.sweep}, mir.sweep=${mirArc && mirArc.sweep}, orig joints=${origArc.joints.map((j) => pt(J(j))).join(' ')}, mir joints=${mirArc.joints.map((j) => pt(J(j))).join(' ')}, ${residualText()}`);
  }

  // M1.4: PATTERN (rectangular & circular) under later drags
  app = await openDesign(design(
    { a: [10, 10], b: [30, 10] },
    [{ id: 'L1', type: 'line', joints: ['a', 'b'] }],
    [H('a', 'b'), D('a', 'b', 20, 'd1')]), { centre: { x: 50, y: 20 }, w: 260 });
  {
    const pr = applyPattern(app.state, CONSTRAINT_TYPES.RECTANGULAR_PATTERN, { shapes: ['L1'], joints: [] }, { ...patternDefaults(CONSTRAINT_TYPES.RECTANGULAR_PATTERN), quantity: [3, 1], distance: [40, 10] });
    const copy1 = pr.ok ? app.state.shapes.find((s) => s.id === pr.shapes[0]) : null;
    if (!copy1) { row('M1.4', `rect pattern failed: ${JSON.stringify(pr)}`); } else {
    const beforeCopy = J(copy1.joints[0]);
    await dragJoint('a', { x: 20, y: 25 }, 15);
    const afterSrc = { a: pt(J('a')), copy0: pt(J(copy1.joints[0])), deltaCopy: pt({ x: J(copy1.joints[0]).x - beforeCopy.x, y: J(copy1.joints[0]).y - beforeCopy.y }), res: residualText() };
    // Try dragging the pattern COPY!
    const aBefore = J('a'), c0Before = J(copy1.joints[0]);
    await dragJoint(copy1.joints[0], { x: c0Before.x + 20, y: c0Before.y + 15 }, 15);
    const afterCopyDrag = { a: pt(J('a')), aMoved: f(dist(aBefore, J('a'))), copy0: pt(J(copy1.joints[0])), copyMoved: f(dist(c0Before, J(copy1.joints[0]))), res: residualText() };
    row('M1.4a', `rect pattern (3x1): ok=${pr.ok}; dragSrc=${JSON.stringify(afterSrc)}; dragCopy=${JSON.stringify(afterCopyDrag)}`);
    }
    // M1.4b: Circular pattern about origin: drag source & drag copy
    app = await openDesign(design(
      { a: [30, 0], b: [50, 0] },
      [{ id: 'L1', type: 'line', joints: ['a', 'b'] }],
      [D('a', 'b', 20, 'd1')]), { centre: { x: 0, y: 0 }, w: 220 });
    const pc = applyPattern(app.state, CONSTRAINT_TYPES.CIRCULAR_PATTERN, { shapes: ['L1'], joints: [] }, { ...patternDefaults(CONSTRAINT_TYPES.CIRCULAR_PATTERN), quantity: 4, centre: 'j_origin' });
    const ccopy = pc.ok ? app.state.shapes.find((s) => s.id === pc.shapes[0]) : null;
    if (!ccopy) { row('M1.4b', `circular pattern failed: ${JSON.stringify(pc)}`); } else {
      const a0 = J('a'), cp0 = J(ccopy.joints[0]);
      await dragJoint('a', { x: 40, y: 10 }, 15);
      const afterSrc = { a: pt(J('a')), cp0: pt(cp0), cp1: pt(J(ccopy.joints[0])), res: residualText() };
      const cpBefore = J(ccopy.joints[0]);
      await dragJoint(ccopy.joints[0], { x: cpBefore.x + 15, y: cpBefore.y + 15 }, 15);
      row('M1.4b', `circular pattern (4x360 about origin): dragSrc=${JSON.stringify(afterSrc)}; dragCopy a=${pt(J('a'))}, cp=${pt(J(ccopy.joints[0]))}, ${residualText()}`);
    }
  }

  // M1.5: BREAK a constrained horizontal dimensioned line -> drag the break midpoint M!
  app = await openDesign(design(
    { a: [0, 0, true], b: [80, 0] },
    [{ id: 'L1', type: 'line', joints: ['a', 'b'] }],
    [H('a', 'b'), D('a', 'b', 80, 'd1')]), { centre: { x: 40, y: 0 }, w: 220 });
  {
    const br = breakShape(app.state, 'L1', 0.5);
    const stAfterBreak = statusText();
    await dragJoint(br.midJointId, { x: 40, y: 30 }, 15);
    row('M1.5', `BREAK H+D80 line L1 at t=0.5 -> drag midJoint ${br.midJointId} to (40,30): statusAfterBreak=(${stAfterBreak}); mid=${pt(J(br.midJointId))} (bent into V!), a=${pt(J('a'))}, b=${pt(J('b'))}, constraints=${JSON.stringify(app.state.constraints.map((c) => `${c.type}:${(c.joints || []).join(',')}`))}`);
  }

  // M1.6: TRIM a line against a crossing cutter line -> drag the cutter line (does trimmed end stay on cutter?)
  app = await openDesign(design(
    { a: [0, 20, true], b: [100, 20], c: [50, 0], d: [50, 60] },
    [{ id: 'L1', type: 'line', joints: ['a', 'b'] }, { id: 'L2', type: 'line', joints: ['c', 'd'] }],
    [H('a', 'b'), V('c', 'd')]), { centre: { x: 50, y: 20 }, w: 240 });
  {
    const tr = trimShape(app.state, 'L1', { x: 80, y: 20 });
    const l1End = app.state.shapes.find((s) => s.id === 'L1').joints[1];
    const pBefore = J(l1End);
    await dragJoint('c', { x: 70, y: 0 }, 15);
    row('M1.6', `TRIM L1 against vertical cutter L2 -> drag cutter x=50->70: trimmedEnd ${pt(pBefore)}->${pt(J(l1End))}, cutter c=${pt(J('c'))}, constraints=${JSON.stringify(app.state.constraints.map((c) => c.type))}`);
  }

  // M1.7: TRIM a dimensioned RECTANGLE top edge at a crossing line -> does the old width dimension d1 survive on the orphaned corner?!
  app = await openDesign(design(
    { a: [0, 0, true], b: [80, 0], c: [80, 40], d: [0, 40], x1: [40, -10], x2: [40, 50] },
    [{ id: 'L1', type: 'line', joints: ['a', 'b'] }, { id: 'L2', type: 'line', joints: ['b', 'c'] }, { id: 'L3', type: 'line', joints: ['c', 'd'] }, { id: 'L4', type: 'line', joints: ['d', 'a'] }, { id: 'LX', type: 'line', joints: ['x1', 'x2'] }],
    [H('a', 'b'), V('b', 'c'), H('c', 'd'), V('d', 'a'), D('a', 'b', 80, 'd1'), D('b', 'c', 40, 'd2')]), { centre: { x: 40, y: 20 }, w: 240 });
  {
    trimShape(app.state, 'L1', { x: 60, y: 0 });
    const d1 = dim('d1');
    const l1 = app.state.shapes.find((s) => s.id === 'L1');
    row('M1.7', `TRIM right half of dimensioned rect edge L1(a-b): L1.joints=${JSON.stringify(l1.joints)}, d1 still exists=${!!d1}, d1.joints=${JSON.stringify(d1 && d1.joints)}, L1 len=${f(dist(J(l1.joints[0]), J(l1.joints[1])))}, d1.val=${d1 && d1.value}`);
  }

  await closeAll();
})();
console.log('solver-ux-audit-1000-constraints-status-undo.mjs: printed (exit 0 whatever the rows say)');
