// tests/audits/dimension-audit-1003-values-driven.mjs -- TASK 1003 (AUDIT ONLY, outside the gate)
// Area 2: VALUE ENTRY, DRIVING/REFERENCE (incl. task 1001), EFFECT ON GEOMETRY, DISPLAY, DELETE, COPY/PASTE.
// Run: node tests/audits/dimension-audit-1003-values-driven.mjs
import {
  design, openDesign, closeAll, theApp, J, S, dist, f, pt, row, quiet,
  toasts, clearToasts, boxOpen, boxEl, hintText, dimSummary, allDims, labelTextOf, labelEl,
  moveW, clickW, snapshot, movedText, residualText, dim, editDim,
} from './dimension-audit-1003-kit.js';
import SettingsManager from '#core/settings-manager.js';
import { toggleDriving, applyParameterChange } from '#core/dimension-seams.js';
import { deleteSelection, deleteConstraints, deleteShapes } from '#core/delete-manager.js';
import { selectionToEnvelope, pasteDocument } from '#ui/clipboard.js';
import { findCornerAtJoint, applyFillet } from '#core/fillet.js';
import { offsetChainOf, applyOffset } from '#core/offset.js';
import { mirrorObjectsOf, mirrorObjects } from '#core/mirror.js';
import { patternObjectsOf, applyPattern, patternDefaults } from '#core/pattern.js';
import { CONSTRAINT_TYPES } from '#core/constants.js';

function setUnit(u) { SettingsManager.set('DOC_UNIT', u, { persist: 'none' }); }

// ─── V2.1 VALUE ENTRY LIFECYCLE ─────────────────────────────────────────────
{
  // a) Quick-type digit while placing -> Enter (check value, undo steps)
  const doc = design({ a: [0, 0, true], b: [60, 0] }, [{ id: 'L1', type: 'line', joints: ['a', 'b'] }]);
  await openDesign(doc, { centre: { x: 30, y: 0 }, w: 200 });
  let app = theApp();
  const h0 = app.state.history.length;
  app.tool('dim');
  await clickW({ x: 30, y: 0 });
  await moveW({ x: 30, y: -20 });
  await quiet(() => { app.key('4'); });
  app.frames();
  const openAfterDigit = boxOpen();
  const valAfterDigit = boxEl().value;
  await quiet(() => { app.type('5'); app.enter(); });
  app.frames();
  row('V2.1.quickType', `openAfterDigit=${openAfterDigit} valAfterDigit="${valAfterDigit}" final=[${dimSummary(allDims()[0])}] b=${pt(J('b'))} undoSteps=${app.state.history.length - h0} tool=${app.state.currentTool}`);

  // b) Quick-type digit while placing on FULLY FIXED line -> what happens?
  const docFix = design({ a: [0, 0, true], b: [60, 0, true] }, [{ id: 'L1', type: 'line', joints: ['a', 'b'] }]);
  await openDesign(docFix, { centre: { x: 30, y: 0 }, w: 200 });
  app = theApp();
  app.tool('dim');
  await clickW({ x: 30, y: 0 });
  await moveW({ x: 30, y: -20 });
  await quiet(() => { app.key('4'); });
  app.frames();
  row('V2.1.quickTypeFixed', `placing=${!!app.state.placingConstraint} boxOpen=${boxOpen()} dims=${JSON.stringify(allDims().map(dimSummary))} toasts=${JSON.stringify(toasts())}`);

  // c) Enter while placing -> opens edit box -> Enter unchanged (1 undo step)
  await openDesign(doc, { centre: { x: 30, y: 0 }, w: 200 });
  app = theApp();
  const hEnter0 = app.state.history.length;
  app.tool('dim');
  await clickW({ x: 30, y: 0 });
  await moveW({ x: 30, y: -20 });
  await quiet(() => { app.enter(); });
  app.frames();
  const openAfterEnter1 = boxOpen();
  await quiet(() => { app.enter(); });
  app.frames();
  row('V2.1.enterPlace', `openAfterEnter1=${openAfterEnter1} openAfterEnter2=${boxOpen()} dims=${JSON.stringify(allDims().map(dimSummary))} undoSteps=${app.state.history.length - hEnter0}`);

  // d) Drag-release (>250ms) then double-click + Esc (does leaked __newlyPlaced DELETE the dim?!)
  await openDesign(doc, { centre: { x: 30, y: 0 }, w: 200 });
  app = theApp();
  app.tool('dim');
  const pS = app.toScreen(30, 0), pE = app.toScreen(30, -20);
  await quiet(async () => {
    app.move(pS.x, pS.y); app.down(pS.x, pS.y);
    app.move(pE.x, pE.y, { buttons: 1 });
    await app.pause(300);
    app.move(pE.x + 2, pE.y, { buttons: 1 });
    app.up(pE.x + 2, pE.y);
  });
  app.frames();
  const beforeEscCount = allDims().length;
  const newlyFlag = allDims()[0] && allDims()[0].__newlyPlaced;
  const gDrag = allDims()[0] && allDims()[0].glyphPos;
  const pLbl = app.toScreen(gDrag.x, gDrag.y);
  await app.pause(550);
  app.tool('select');
  await quiet(() => { app.dblclick(pLbl.x, pLbl.y, { target: () => labelEl(app, 0) }); });
  app.frames();
  const openedAfterDrag = boxOpen();
  await quiet(() => { app.esc(); });
  app.frames();
  row('V2.1.dragReleaseThenEsc', `beforeCount=${beforeEscCount} newlyFlag=${newlyFlag} opened=${openedAfterDrag} afterEscCount=${allDims().length} hist=${app.state.history.length}`);

  // e) Tab mid-edit in single edit box
  const docEdit = design(
    { a: [0, 0, true], b: [60, 0] },
    [{ id: 'L1', type: 'line', joints: ['a', 'b'] }],
    [{ type: 'distance', joints: ['a', 'b'], value: 60, dimMode: 'horizontal', offset: -20, name: 'd1' }],
  );
  await openDesign(docEdit, { centre: { x: 30, y: 0 }, w: 200 });
  const rTab = await editDim('d1', '75', { commit: 'tab' });
  row('V2.1.tabMidEdit', `res=${JSON.stringify(rTab)} d1=${dimSummary(dim('d1'))} b=${pt(J('b'))}`);

  // f) Esc mid-edit of JUST-PLACED dim vs EXISTING dim
  await openDesign(doc, { centre: { x: 30, y: 0 }, w: 200 });
  app = theApp();
  const hNew0 = app.state.history.length;
  app.tool('dim');
  await clickW({ x: 30, y: 0 });
  await moveW({ x: 30, y: -20 });
  await clickW({ x: 30, y: -20 }); // drops -> opens edit box
  const newBoxOpen = boxOpen();
  await quiet(() => { app.esc(); });
  app.frames();
  row('V2.1.escNewDim', `boxOpened=${newBoxOpen} boxAfterEsc=${boxOpen()} dimsAfterEsc=${allDims().length} undoDelta=${app.state.history.length - hNew0} tool=${app.state.currentTool}`);

  await openDesign(docEdit, { centre: { x: 30, y: 0 }, w: 200 });
  app = theApp();
  app.tool('dim');
  const rEscExist = await editDim('d1', '75', { tool: 'dim', commit: 'esc' });
  row('V2.1.escExistingDim', `res=${JSON.stringify(rEscExist)} d1=${dimSummary(dim('d1'))} b=${pt(J('b'))} tool=${app.state.currentTool}`);

  // g) Click away (outside press) mid-edit: unchanged, valid changed, invalid, unsolvable
  for (const [tag, text] of [['unchanged', null], ['valid', '80'], ['invalid', 'abc'], ['zero', '0']]) {
    await openDesign(docEdit, { centre: { x: 30, y: 0 }, w: 200 });
    app = theApp();
    app.tool('select');
    clearToasts();
    const g = dim('d1').glyphPos;
    const p = app.toScreen(g.x, g.y);
    await app.pause(550);
    await quiet(() => { app.dblclick(p.x, p.y, { target: () => labelEl(app, 0) }); });
    await app.waitFor(boxOpen, 'edit box', 600);
    const hBefore = app.state.history.length;
    if (text !== null) {
      await quiet(() => { const i = boxEl(); i.focus(); i.select(); app.key('a', { ctrl: true }); app.type(text); });
    }
    // Click empty canvas far away
    await clickW({ x: -60, y: 50 });
    row(`V2.1.clickAway.${tag}`, `boxOpen=${boxOpen()} d1=${dimSummary(dim('d1'))} b=${pt(J('b'))} undoDelta=${app.state.history.length - hBefore} toasts=${JSON.stringify(toasts())}`);
  }
}

// ─── V2.2 UNITS, EXPRESSIONS, PARAMETERS & CLICK-TO-INSERT ──────────────────
{
  const docBase = () => design(
    { a: [0, 0, true], b: [60, 0], c: [0, 40, true], d: [40, 40], e: [80, 0, true], f: [80, 30, true] },
    [
      { id: 'L1', type: 'line', joints: ['a', 'b'] },
      { id: 'L2', type: 'line', joints: ['c', 'd'] },
      { id: 'L3', type: 'line', joints: ['e', 'f'] },
    ],
    [
      { type: 'horizontal', joints: ['a', 'b'] },
      { type: 'horizontal', joints: ['c', 'd'] },
      { type: 'distance', joints: ['a', 'b'], value: 60, dimMode: 'horizontal', offset: -20, name: 'd1' },
      { type: 'distance', joints: ['c', 'd'], value: 40, dimMode: 'horizontal', offset: 20, name: 'd2' },
      { type: 'distance', joints: ['e', 'f'], value: 30, dimMode: 'vertical', offset: 20, isDriven: true, driven: true, name: 'd3' },
    ],
    [{ name: 'W', unit: 'mm', expression: '25 mm', value: 25 }],
  );

  // mm doc expressions & mixed units
  setUnit('mm');
  const mmExprs = ['50', '2in', '1in + 5mm', '2cm', '10 + 20', '(10 + 5) * 2', 'sqrt(100)', 'sin(30)', '1/2 in', '1 1/2"', 'W * 2', 'W + 10mm', 'd2 * 1.5', 'width = 55'];
  for (const expr of mmExprs) {
    await openDesign(docBase(), { centre: { x: 40, y: 20 }, w: 260 });
    const r = await editDim('d1', expr);
    const c = dim('width') || dim('d1');
    row(`V2.2.mm.${expr}`, `opened=${r.opened} stillOpen=${r.boxStillOpen} hint="${r.hint}" dim=[${dimSummary(c)}] lbl=${c && labelTextOf(c)} b=${pt(J('b'))}`);
  }

  // in doc expressions + refusal toast unit check
  setUnit('in');
  for (const expr of ['2', '50mm', '1in + 5mm', '1 1/2"', '3/8', '-2']) {
    await openDesign(docBase(), { centre: { x: 40, y: 20 }, w: 260 });
    const r = await editDim('d1', expr);
    const c = dim('d1');
    row(`V2.2.in.${expr}`, `stillOpen=${r.boxStillOpen} hint="${r.hint}" toasts=${JSON.stringify(r.toasts)} dim=[${dimSummary(c)}] lbl=${c && labelTextOf(c)}`);
  }
  setUnit('mm');

  // Angle expressions
  const docAng = design(
    { a: [0, 0, true], b: [60, 0, true], c: [30, 51.9615] },
    [{ id: 'L1', type: 'line', joints: ['a', 'b'] }, { id: 'L2', type: 'line', joints: ['a', 'c'] }],
    [
      { type: 'distance', joints: ['a', 'c'], value: 60, name: 'd1' },
      { type: 'angle', shapes: ['L1', 'L2'], value: 60, sector: { ray1: 1, ray2: 1, turn: 1 }, offset: 30, name: 'd2' },
    ],
  );
  for (const expr of ['45', '45deg', '45°', '30 + 15', 'pi/4 rad', '0', '-15', '360', '361']) {
    await openDesign(docAng, { centre: { x: 30, y: 25 }, w: 220 });
    const r = await editDim('d2', expr);
    const c = dim('d2');
    row(`V2.2.ang.${expr}`, `stillOpen=${r.boxStillOpen} hint="${r.hint}" toasts=${JSON.stringify(r.toasts)} v=${c && f(c.value, 2)} ${residualText()}`);
  }

  // Click-to-insert dimension name while editing (task 866): driving dim, self, REFERENCE dim!
  await openDesign(docBase(), { centre: { x: 40, y: 20 }, w: 260 });
  let app = theApp();
  const idx1 = app.state.constraints.indexOf(dim('d1'));
  const idx2 = app.state.constraints.indexOf(dim('d2'));
  const idx3 = app.state.constraints.indexOf(dim('d3'));
  const g1 = dim('d1').glyphPos, g2 = dim('d2').glyphPos, g3 = dim('d3').glyphPos;
  const p1 = app.toScreen(g1.x, g1.y), p2 = app.toScreen(g2.x, g2.y), p3 = app.toScreen(g3.x, g3.y);
  await app.pause(550);
  await quiet(() => { app.dblclick(p1.x, p1.y, { target: () => labelEl(app, idx1) }); });
  await app.waitFor(boxOpen, 'edit box', 600);
  // Click d2 (driving)
  await quiet(() => { app.click(p2.x, p2.y, { target: () => labelEl(app, idx2) }); });
  const afterClickD2 = boxEl().value;
  // Click self (d1)
  await quiet(() => { app.click(p1.x, p1.y, { target: () => labelEl(app, idx1) }); });
  const afterClickSelf = boxEl().value;
  // Type " + " then click d3 (REFERENCE dim!)
  await quiet(() => { app.type(' + '); app.click(p3.x, p3.y, { target: () => labelEl(app, idx3) }); });
  const afterClickRef = boxEl().value;
  const hintAfterRef = hintText();
  await quiet(() => { app.enter(); });
  app.frames();
  row('V2.2.clickInsert', `afterD2="${afterClickD2}" afterSelf="${afterClickSelf}" afterRef="${afterClickRef}" hint="${hintAfterRef}" stillOpen=${boxOpen()} d1=[${dimSummary(dim('d1'))}]`);
}

// ─── V2.3 INVALID / EXTREME / CYCLE / REFUSED EDITS & UNDO/REDO SAFETY ──────
{
  // Triangle (50, 40, 30) with an undoable drag so redoStack = 1!
  const docTri = () => design(
    { a: [0, 0, true], b: [50, 0, true], c: [32, 24] },
    [
      { id: 'L1', type: 'line', joints: ['a', 'b'] },
      { id: 'L2', type: 'line', joints: ['b', 'c'] },
      { id: 'L3', type: 'line', joints: ['c', 'a'] },
    ],
    [
      { type: 'distance', joints: ['a', 'b'], value: 50, dimMode: 'horizontal', offset: -20, isDriven: true, driven: true, name: 'd1' },
      { type: 'distance', joints: ['b', 'c'], value: 30, offset: 15, name: 'd2' },
      { type: 'distance', joints: ['c', 'a'], value: 40, offset: 15, name: 'd3' },
    ],
  );
  const badInputs = ['0', '-10', 'abc', '1e9', '1e309', 'NaN', '1/0', 'd2 * 2', 'foo', '200'];
  for (const inp of badInputs) {
    await openDesign(docTri(), { centre: { x: 25, y: 12 }, w: 200 });
    const app = theApp();
    // Create 1 redo entry: edit d2 -> 32 then undo!
    await editDim('d2', '32');
    await quiet(() => { app.undo(); });
    app.frames();
    const snap0 = snapshot();
    const redo0 = app.state.redoStack.length;
    const hist0 = app.state.history.length;
    const r = await editDim('d2', inp);
    row(`V2.3.bad.${inp}`, `stillOpen=${r.boxStillOpen} hint="${r.hint}" toasts=${JSON.stringify(r.toasts)} ${movedText(snap0)} hist=${hist0}->${app.state.history.length} redo=${redo0}->${app.state.redoStack.length} v=${f(dim('d2').value, 2)}`);
  }

  // Mutual cycle d2 = d3, d3 = d2
  await openDesign(docTri(), { centre: { x: 25, y: 12 }, w: 200 });
  await editDim('d2', 'd3');
  const rCyc = await editDim('d3', 'd2 + 1');
  row('V2.3.mutualCycle', `stillOpen=${rCyc.boxStillOpen} hint="${rCyc.hint}" d2=[${dimSummary(dim('d2'))}] d3=[${dimSummary(dim('d3'))}]`);

  // 500x40 rect shrunk to 4 (UX-02)
  const docRect500 = design(
    { a: [0, 0, true], b: [500, 0], c: [500, 40], d: [0, 40] },
    [
      { id: 'L1', type: 'line', joints: ['a', 'b'] },
      { id: 'L2', type: 'line', joints: ['b', 'c'] },
      { id: 'L3', type: 'line', joints: ['c', 'd'] },
      { id: 'L4', type: 'line', joints: ['d', 'a'] },
    ],
    [
      { type: 'horizontal', joints: ['a', 'b'] },
      { type: 'vertical', joints: ['b', 'c'] },
      { type: 'horizontal', joints: ['c', 'd'] },
      { type: 'vertical', joints: ['d', 'a'] },
      { type: 'distance', joints: ['a', 'b'], value: 500, dimMode: 'horizontal', offset: -30, name: 'd1' },
      { type: 'distance', joints: ['b', 'c'], value: 40, dimMode: 'vertical', offset: 30, name: 'd2' },
    ],
  );
  await openDesign(docRect500, { centre: { x: 250, y: 20 }, w: 800 });
  const r4 = await editDim('d1', '4');
  const r5 = await editDim('d1', '5');
  row('V2.3.rect500to4', `to4:toasts=${JSON.stringify(r4.toasts)} v=${f(dim('d1').value, 1)} | to5:toasts=${JSON.stringify(r5.toasts)} v=${f(dim('d1').value, 1)}`);
}

// ─── V2.4 DRIVING vs REFERENCE (TASK 1001 & TOGGLES BOTH WAYS) ───────────────
{
  // a) Auto-reference on fully defined geometry: check NO popup (task 1001) AND parentheses on label!
  const docAuto = () => design(
    {
      a: [0, 0, true], b: [60, 0, true],      // fixed line
      c: [0, 30, true], d: [60, 30],          // free line with existing dim d1=60
      e: [0, 60, true], f: [60, 60], g: [0, 100], // H + V lines for 90 deg redundant angle
    },
    [
      { id: 'LF', type: 'line', joints: ['a', 'b'] },
      { id: 'LD', type: 'line', joints: ['c', 'd'] },
      { id: 'LH', type: 'line', joints: ['e', 'f'] },
      { id: 'LV', type: 'line', joints: ['e', 'g'] },
    ],
    [
      { type: 'horizontal', joints: ['c', 'd'] },
      { type: 'distance', joints: ['c', 'd'], value: 60, dimMode: 'horizontal', offset: 15, name: 'd1' },
      { type: 'horizontal', joints: ['e', 'f'] },
      { type: 'vertical', joints: ['e', 'g'] },
    ],
  );
  await openDesign(docAuto(), { centre: { x: 30, y: 45 }, w: 260 });
  let app = theApp();
  app.tool('dim');
  clearToasts();
  // Fixed line
  await clickW({ x: 30, y: 0 }); await moveW({ x: 30, y: -15 }); await clickW({ x: 30, y: -15 });
  const cFix = allDims()[allDims().length - 1];
  row('V2.4.autoRef.fixedLine', `dim=[${dimSummary(cFix)}] lbl=${labelTextOf(cFix)} box=${boxOpen()} toasts=${JSON.stringify(toasts())}`);

  // 2nd dim on already-dimensioned line
  clearToasts();
  await clickW({ x: 30, y: 30 }); await moveW({ x: 30, y: 45 }); await clickW({ x: 30, y: 45 });
  const c2nd = allDims()[allDims().length - 1];
  row('V2.4.autoRef.2ndSameLine', `dim=[${dimSummary(c2nd)}] lbl=${labelTextOf(c2nd)} box=${boxOpen()} toasts=${JSON.stringify(toasts())}`);

  // Redundant angle on H+V lines!
  clearToasts();
  await clickW({ x: 30, y: 60 }); await clickW({ x: 0, y: 80 }); await moveW({ x: 20, y: 80 }); await clickW({ x: 20, y: 80 });
  const cAng = allDims()[allDims().length - 1];
  const angBox = boxOpen();
  if (angBox) { await quiet(() => app.enter()); app.frames(); }
  row('V2.4.autoRef.redundantAngleHV', `dim=[${dimSummary(cAng)}] lbl=${labelTextOf(cAng)} box=${angBox} toasts=${JSON.stringify(toasts())}`);

  // Redundant angle on 3-side-dimensioned triangle (non-H/V!) -> born DRIVING, then dblclick silently mutates to REF w/o undo!
  const docTriAng = design(
    { a: [0, 0, true], b: [60, 0, true], c: [30, 51.9615] },
    [
      { id: 'L1', type: 'line', joints: ['a', 'b'] },
      { id: 'L2', type: 'line', joints: ['b', 'c'] },
      { id: 'L3', type: 'line', joints: ['c', 'a'] },
    ],
    [
      { type: 'distance', joints: ['b', 'c'], value: 60, offset: 15, name: 'd1' },
      { type: 'distance', joints: ['c', 'a'], value: 60, offset: 15, name: 'd2' },
    ],
  );
  await openDesign(docTriAng, { centre: { x: 30, y: 20 }, w: 220 });
  app = theApp();
  app.tool('dim');
  clearToasts();
  await clickW({ x: 30, y: 0 }); await clickW({ x: 15, y: 26 }); await moveW({ x: 25, y: 12 }); await clickW({ x: 25, y: 12 });
  const cTriAng = allDims()[allDims().length - 1];
  const triAngBox = boxOpen();
  if (triAngBox) { await quiet(() => app.enter()); app.frames(); }
  const hTriBeforeDbl = app.state.history.length;
  const beforeDblSummary = dimSummary(cTriAng);
  const beforeDblLbl = labelTextOf(cTriAng);
  // Now double-click it!
  const rTriDbl = await editDim(cTriAng.name, '70');
  row('V2.4.autoRef.redundantAngleTri', `born=[${beforeDblSummary}] lbl=${beforeDblLbl} boxAtPlace=${triAngBox} | afterDbl:opened=${rTriDbl.opened} now=[${dimSummary(cTriAng)}] lbl=${labelTextOf(cTriAng)} hist=${hTriBeforeDbl}->${app.state.history.length} toasts=${JSON.stringify(rTriDbl.toasts)}`);

  // b) Toggle Ref -> Driving on every mode after geometry moved while Reference!
  // 1) H-ref on diagonal (0,0)-(30,40)
  const docHV = design(
    { a: [0, 0, true], b: [30, 40] },
    [{ id: 'L1', type: 'line', joints: ['a', 'b'] }],
    [{ type: 'distance', joints: ['a', 'b'], value: 30, dimMode: 'horizontal', offset: 20, isDriven: true, driven: true, name: 'd1' }],
  );
  await openDesign(docHV, { centre: { x: 20, y: 20 }, w: 200 });
  app = theApp();
  const hT0 = app.state.history.length;
  const resH = toggleDriving(app.state, dim('d1'));
  row('V2.4.toggle.Href->Drv', `res=${JSON.stringify(resH)} v=${f(dim('d1').value, 2)} b=${pt(J('b'))} hist=${hT0}->${app.state.history.length}`);

  // 2) V-ref on diagonal
  const docV = design(
    { a: [0, 0, true], b: [30, 40] },
    [{ id: 'L1', type: 'line', joints: ['a', 'b'] }],
    [{ type: 'distance', joints: ['a', 'b'], value: 40, dimMode: 'vertical', offset: 20, isDriven: true, driven: true, name: 'd1' }],
  );
  await openDesign(docV, { centre: { x: 20, y: 20 }, w: 200 });
  const resV = toggleDriving(theApp().state, dim('d1'));
  row('V2.4.toggle.Vref->Drv', `res=${JSON.stringify(resV)} v=${f(dim('d1').value, 2)} b=${pt(J('b'))}`);

  // 3) Parallel line-line ref (born at 20, moved to 55)
  const docPar = design(
    { a: [0, 0, true], b: [60, 0, true], c: [0, 55], d: [60, 55] },
    [{ id: 'L1', type: 'line', joints: ['a', 'b'] }, { id: 'L2', type: 'line', joints: ['c', 'd'] }],
    [{ type: 'parallel', shapes: ['L1', 'L2'] }, { type: 'distance', shapes: ['L1', 'L2'], value: 20, isDriven: true, driven: true, name: 'd1' }],
  );
  await openDesign(docPar, { centre: { x: 30, y: 25 }, w: 200 });
  const resPar = toggleDriving(theApp().state, dim('d1'));
  row('V2.4.toggle.ParRef->Drv', `res=${JSON.stringify(resPar)} v=${f(dim('d1').value, 2)} c=${pt(J('c'))}`);

  // 4) Point-to-Axis ref (born at 25, moved to 60)
  const docPtAx = design(
    { p: [30, 60] }, [],
    [{ type: 'distance', joints: ['p', 'j_origin', 'j_ref_x'], value: 25, isDriven: true, driven: true, name: 'd1' }],
  );
  await openDesign(docPtAx, { centre: { x: 30, y: 30 }, w: 200 });
  const resPtAx = toggleDriving(theApp().state, dim('d1'));
  row('V2.4.toggle.PtAxisRef->Drv', `res=${JSON.stringify(resPtAx)} v=${f(dim('d1').value, 2)} p=${pt(J('p'))}`);

  // 5) Angle-to-Axis ref (born at 30, moved to 60) — does toggleDriving miss ref_axis_x in state.shapes.find?!
  const docAngAx = design(
    { a: [0, 0, true], b: [30, 51.9615] },
    [{ id: 'L1', type: 'line', joints: ['a', 'b'] }],
    [{ type: 'angle', shapes: ['L1', 'ref_axis_x'], value: 30, sector: { ray1: 1, ray2: 1, turn: 1 }, offset: 25, isDriven: true, driven: true, name: 'd1' }],
  );
  await openDesign(docAngAx, { centre: { x: 20, y: 25 }, w: 200 });
  const resAngAx = toggleDriving(theApp().state, dim('d1'));
  row('V2.4.toggle.AngAxisRef->Drv', `res=${JSON.stringify(resAngAx)} v=${f(dim('d1').value, 2)} b=${pt(J('b'))}`);

  // 6) Circle radius ref (born at 20, resized to 35) -> toggleDriving
  const docCRef = design(
    { cc: [0, 0, true] },
    [{ id: 'C1', type: 'circle', joints: ['cc'], radius: 35 }],
    [{ type: 'distance', shape: 'C1', value: 20, isRadius: true, isDriven: true, driven: true, name: 'd1' }],
  );
  await openDesign(docCRef, { centre: { x: 0, y: 0 }, w: 200 });
  const resCRef = toggleDriving(theApp().state, dim('d1'));
  row('V2.4.toggle.CircRef->Drv', `res=${JSON.stringify(resCRef)} v=${f(dim('d1').value, 2)} r=${f(S('C1').radius, 2)}`);

  // 7) Context menu toggleDriving: undo check, O9 refusal (used by d2), O11 clears formula
  const docCtx = design(
    { a: [0, 0, true], b: [60, 0], c: [0, 40, true], d: [30, 40] },
    [{ id: 'L1', type: 'line', joints: ['a', 'b'] }, { id: 'L2', type: 'line', joints: ['c', 'd'] }],
    [
      { type: 'horizontal', joints: ['a', 'b'] }, { type: 'horizontal', joints: ['c', 'd'] },
      { type: 'distance', joints: ['a', 'b'], value: 60, dimMode: 'horizontal', offset: -20, name: 'd1' },
      { type: 'distance', joints: ['c', 'd'], value: 30, dimMode: 'horizontal', offset: 20, expression: 'd1 / 2', name: 'd2' },
    ],
  );
  await openDesign(docCtx, { centre: { x: 30, y: 20 }, w: 220 });
  app = theApp();
  // Try making d1 reference while d2 reads d1 (O9 refusal)
  const resO9 = toggleDriving(app.state, dim('d1'));
  // Make d2 reference via right-click context menu (O11 clears expression; check undo!)
  const idxD2 = app.state.constraints.indexOf(dim('d2'));
  const gD2 = dim('d2').glyphPos;
  const pD2 = app.toScreen(gD2.x, gD2.y);
  const hCtx0 = app.state.history.length;
  await quiet(() => { app.rightClick(pD2.x, pD2.y, { target: () => labelEl(app, idxD2) }); });
  const refBtn = app.document.querySelector('.sk-context-item[data-id="dim-reference"]');
  const menuItems = [...app.document.querySelectorAll('.sk-context-item')].map((el) => el.dataset.id + ':' + el.textContent.trim());
  if (refBtn) await quiet(() => { refBtn.click(); });
  app.frames();
  row('V2.4.ctxToggle', `O9=${JSON.stringify(resO9)} menu=${JSON.stringify(menuItems)} d2After=[${dimSummary(dim('d2'))}] lbl=${labelTextOf(dim('d2'))} hist=${hCtx0}->${app.state.history.length}`);
}

// ─── V2.5 EFFECT ON GEOMETRY (WHO MOVES, ARC FLIP, CHAINS, MIRROR/PATTERN) ─
{
  // Free line a=(10,0), b=(70,0): edit length 60 -> 80 (which end moves?)
  const docFreeL = design(
    { a: [10, 0], b: [70, 0] },
    [{ id: 'L1', type: 'line', joints: ['a', 'b'] }],
    [{ type: 'distance', joints: ['a', 'b'], value: 60, dimMode: 'horizontal', offset: -20, name: 'd1' }],
  );
  await openDesign(docFreeL, { centre: { x: 40, y: 0 }, w: 200 });
  await editDim('d1', '80');
  row('V2.5.freeLine', `a=${pt(J('a'))} b=${pt(J('b'))} ${residualText()}`);

  // Pinned-right line a=(10,0), b=(70,0,fixed): edit 60 -> 80
  const docPinR = design(
    { a: [10, 0], b: [70, 0, true] },
    [{ id: 'L1', type: 'line', joints: ['a', 'b'] }],
    [{ type: 'distance', joints: ['a', 'b'], value: 60, dimMode: 'horizontal', offset: -20, name: 'd1' }],
  );
  await openDesign(docPinR, { centre: { x: 40, y: 0 }, w: 200 });
  await editDim('d1', '80');
  row('V2.5.pinRightLine', `a=${pt(J('a'))} b=${pt(J('b'))} ${residualText()}`);

  // Free point-point A->B vs B->A edit 40 -> 60
  for (const [tag, js] of [['A->B', ['a', 'b']], ['B->A', ['b', 'a']]]) {
    const docPP = design({ a: [10, 0], b: [50, 0] }, [], [{ type: 'distance', joints: js, value: 40, dimMode: 'horizontal', offset: -20, name: 'd1' }]);
    await openDesign(docPP, { centre: { x: 30, y: 0 }, w: 200 });
    await editDim('d1', '60');
    row(`V2.5.freePtPt.${tag}`, `a=${pt(J('a'))} b=${pt(J('b'))}`);
  }

  // Two free parallel lines L1->L2 vs L2->L1 edit 30 -> 50
  for (const [tag, shs] of [['L1->L2', ['L1', 'L2']], ['L2->L1', ['L2', 'L1']]]) {
    const docPar = design(
      { a: [0, 0], b: [60, 0], c: [0, 30], d: [60, 30] },
      [{ id: 'L1', type: 'line', joints: ['a', 'b'] }, { id: 'L2', type: 'line', joints: ['c', 'd'] }],
      [{ type: 'horizontal', joints: ['a', 'b'] }, { type: 'horizontal', joints: ['c', 'd'] }, { type: 'distance', shapes: shs, value: 30, offset: 20, name: 'd1' }],
    );
    await openDesign(docPar, { centre: { x: 30, y: 15 }, w: 220 });
    await editDim('d1', '50');
    row(`V2.5.freePar.${tag}`, `L1y=${f(J('a').y, 2)} L2y=${f(J('c').y, 2)} ${residualText()}`);
  }

  // Arc radius edit (does arc flip sweep?)
  const docArc = design(
    { c: [0, 0, true], s: [30, 0], e: [0, 30] },
    [{ id: 'A1', type: 'arc', joints: ['c', 's', 'e'], sweep: true }],
    [{ type: 'equal', joints: ['c', 's', 'c', 'e'] }, { type: 'distance', shape: 'A1', value: 30, isRadius: true, offset: 45, labelAngle: 0.78, name: 'd1' }],
  );
  await openDesign(docArc, { centre: { x: 15, y: 15 }, w: 200 });
  await editDim('d1', '50');
  const s50 = J('s'), e50 = J('e');
  await editDim('d1', '10');
  const s10 = J('s'), e10 = J('e');
  row('V2.5.arcRadius', `r50:s=${pt(s50)},e=${pt(e50)},|cs|=${f(dist(J('c'), s50), 2)} | r10:s=${pt(s10)},e=${pt(e10)},|cs|=${f(dist(J('c'), s10), 2)} ${residualText()}`);

  // Chained 3-segment polyline: edit seg1, seg2, seg3
  const docChain = design(
    { p0: [0, 0, true], p1: [30, 0], p2: [60, 0], p3: [90, 0] },
    [
      { id: 'L1', type: 'line', joints: ['p0', 'p1'] },
      { id: 'L2', type: 'line', joints: ['p1', 'p2'] },
      { id: 'L3', type: 'line', joints: ['p2', 'p3'] },
    ],
    [
      { type: 'horizontal', joints: ['p0', 'p1'] },
      { type: 'horizontal', joints: ['p1', 'p2'] },
      { type: 'horizontal', joints: ['p2', 'p3'] },
      { type: 'distance', joints: ['p0', 'p1'], value: 30, dimMode: 'horizontal', offset: -20, name: 'd1' },
      { type: 'distance', joints: ['p1', 'p2'], value: 30, dimMode: 'horizontal', offset: -20, name: 'd2' },
      { type: 'distance', joints: ['p2', 'p3'], value: 30, dimMode: 'horizontal', offset: -20, name: 'd3' },
    ],
  );
  await openDesign(docChain, { centre: { x: 45, y: 0 }, w: 240 });
  await editDim('d2', '50');
  row('V2.5.chain', `p0=${pt(J('p0'))} p1=${pt(J('p1'))} p2=${pt(J('p2'))} p3=${pt(J('p3'))} ${residualText()}`);

  // Mirrored line dim edit with FREE mirror line (task 611 check)
  const docMir = design(
    { m1: [0, -50], m2: [0, 50], a: [20, 10], b: [50, 10] },
    [{ id: 'ML', type: 'line', joints: ['m1', 'm2'], isConstruction: true }, { id: 'L1', type: 'line', joints: ['a', 'b'] }],
    [{ type: 'horizontal', joints: ['a', 'b'] }, { type: 'distance', joints: ['a', 'b'], value: 30, dimMode: 'horizontal', offset: 20, name: 'd1' }],
  );
  await openDesign(docMir, { centre: { x: 0, y: 10 }, w: 240 });
  await quiet(() => { mirrorObjects(theApp().state, mirrorObjectsOf(['L1'], []), 'ML'); });
  theApp().frames();
  await editDim('d1', '50');
  const copyM = theApp().state.shapes.find((s) => s.id !== 'ML' && s.id !== 'L1');
  row('V2.5.mirrorEditFreeML', `m1=${pt(J('m1'))} m2=${pt(J('m2'))} L1len=${f(dist(J('a'), J('b')), 2)} copyLen=${f(dist(J(copyM.joints[0]), J(copyM.joints[1])), 2)} ${residualText()}`);
}

// ─── V2.6 DISPLAY MARKUP, DELETE, COPY/PASTE ────────────────────────────────
{
  // a) Inspect ANGLE ARROWS orientation in SVG markup!!
  const docDisp = design(
    { a: [0, 0, true], b: [60, 0, true], c: [30, 51.9615], cc: [-50, 20, true] },
    [
      { id: 'L1', type: 'line', joints: ['a', 'b'] },
      { id: 'L2', type: 'line', joints: ['a', 'c'] },
      { id: 'C1', type: 'circle', joints: ['cc'], radius: 20 },
    ],
    [
      { type: 'distance', joints: ['a', 'b'], value: 60, dimMode: 'horizontal', offset: -20, name: 'd1' },
      { type: 'angle', shapes: ['L1', 'L2'], value: 60, sector: { ray1: 1, ray2: 1, turn: 1 }, offset: 30, name: 'd2' },
      { type: 'distance', shape: 'C1', value: 20, isRadius: true, offset: 35, labelAngle: 0.4, name: 'd3' },
    ],
  );
  await openDesign(docDisp, { centre: { x: 0, y: 20 }, w: 240 });
  const app = theApp();
  const angIdx = app.state.constraints.indexOf(dim('d2'));
  const angPolys = [...app.svg.querySelectorAll(`polygon[data-constraint-idx="${angIdx}"]`)].map((p) => p.getAttribute('points'));
  // Check tip->base direction of start arrow vs radial vs tangent!
  const parsePoly = (str) => str.trim().split(/\s+/).map((pair) => pair.split(',').map(Number));
  const angCheck = angPolys.map((pts, i) => {
    const [tip, b1, b2] = parsePoly(pts);
    const baseMid = [(b1[0] + b2[0]) / 2, (b1[1] + b2[1]) / 2];
    const arrowDir = [tip[0] - baseMid[0], tip[1] - baseMid[1]]; // vector arrow points toward
    const radial = [tip[0], tip[1]]; // from origin (0,0) to tip
    const tangent = [-tip[1], tip[0]]; // CCW tangent
    const norm = (v) => { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; };
    const ad = norm(arrowDir), rad = norm(radial), tan = norm(tangent);
    const dotRad = ad[0] * rad[0] + ad[1] * rad[1];
    const dotTan = ad[0] * tan[0] + ad[1] * tan[1];
    return `arrow${i}:dotRadial=${f(dotRad, 3)},dotTangent=${f(dotTan, 3)}`;
  });
  row('V2.6.angleArrows', `${angCheck.join(' | ')} (expected |dotTangent|=1, dotRadial=0!)`);

  // Check radius leader line endpoints vs label text position
  const radIdx = app.state.constraints.indexOf(dim('d3'));
  const radLine = app.svg.querySelector(`line[data-constraint-idx="${radIdx}"]`);
  const radLbl = labelEl(app, radIdx);
  const radTxt = radLbl && radLbl.querySelector('text');
  row('V2.6.radiusLeader', `line=(${f(+radLine.getAttribute('x1'), 1)},${f(+radLine.getAttribute('y1'), 1)})->(${f(+radLine.getAttribute('x2'), 1)},${f(+radLine.getAttribute('y2'), 1)}) textXY=(${f(+radTxt.getAttribute('x'), 1)},${f(+radTxt.getAttribute('y'), 1)}) transform="${radTxt.getAttribute('transform') || ''}"`);

  // b) Delete dimension: geometry must not move; O10 kept param
  const docDelDim = design(
    { a: [0, 0, true], b: [60, 0], c: [0, 40, true], d: [30, 40] },
    [{ id: 'L1', type: 'line', joints: ['a', 'b'] }, { id: 'L2', type: 'line', joints: ['c', 'd'] }],
    [
      { type: 'horizontal', joints: ['a', 'b'] }, { type: 'horizontal', joints: ['c', 'd'] },
      { type: 'distance', joints: ['a', 'b'], value: 60, dimMode: 'horizontal', offset: -20, name: 'd1' },
      { type: 'distance', joints: ['c', 'd'], value: 30, dimMode: 'horizontal', offset: 20, expression: 'd1 / 2', name: 'd2' },
    ],
  );
  await openDesign(docDelDim, { centre: { x: 30, y: 20 }, w: 220 });
  const snapDel = snapshot();
  deleteConstraints(theApp().state, [dim('d1')]);
  theApp().frames();
  row('V2.6.deleteDim', `${movedText(snapDel)} d1Gone=${!dim('d1')} d2=[${dimSummary(dim('d2'))}] params=${JSON.stringify(theApp().state.parameters)}`);

  // c) Delete GEOMETRY under a dimension:
  // 1) Shared-corner rectangle edge L1 with length dim d1 AND point-to-line dim d2=[p, a, b]!
  const docDelGeo = design(
    { a: [0, 0, true], b: [60, 0], c: [60, 40], d: [0, 40], p: [30, -25] },
    [
      { id: 'L1', type: 'line', joints: ['a', 'b'] },
      { id: 'L2', type: 'line', joints: ['b', 'c'] },
      { id: 'L3', type: 'line', joints: ['c', 'd'] },
      { id: 'L4', type: 'line', joints: ['d', 'a'] },
    ],
    [
      { type: 'horizontal', joints: ['a', 'b'] },
      { type: 'vertical', joints: ['b', 'c'] },
      { type: 'horizontal', joints: ['c', 'd'] },
      { type: 'vertical', joints: ['d', 'a'] },
      { type: 'distance', joints: ['a', 'b'], value: 60, dimMode: 'horizontal', offset: -10, name: 'd1' },
      { type: 'distance', joints: ['p', 'a', 'b'], value: 25, offset: 15, name: 'd2' },
    ],
  );
  await openDesign(docDelGeo, { centre: { x: 30, y: 10 }, w: 220 });
  deleteShapes(theApp().state, ['L1']);
  theApp().frames();
  row('V2.6.deleteSharedEdge', `shapesLeft=${theApp().state.shapes.map((s) => s.id).join(',')} dimsLeft=${JSON.stringify(allDims().map(dimSummary))} labels=${JSON.stringify(allDims().map(labelTextOf))}`);

  // 2) Delete circle under radius dim, delete one line of angle/parallel dim
  const docDelCirc = design(
    { cc: [0, 0], a: [30, 0], b: [80, 0], c: [30, 30], d: [80, 30], e: [60, 40] },
    [
      { id: 'C1', type: 'circle', joints: ['cc'], radius: 15 },
      { id: 'L1', type: 'line', joints: ['a', 'b'] },
      { id: 'L2', type: 'line', joints: ['c', 'd'] },
      { id: 'L3', type: 'line', joints: ['a', 'e'] },
    ],
    [
      { type: 'distance', shape: 'C1', value: 15, isRadius: true, name: 'd1' },
      { type: 'distance', shapes: ['L1', 'L2'], value: 30, name: 'd2' },
      { type: 'angle', shapes: ['L1', 'L3'], value: 53.13, sector: { ray1: 1, ray2: 1, turn: 1 }, name: 'd3' },
    ],
  );
  await openDesign(docDelCirc, { centre: { x: 40, y: 20 }, w: 220 });
  deleteShapes(theApp().state, ['C1', 'L1']);
  theApp().frames();
  row('V2.6.deleteCircAndLine', `dimsLeft=${JSON.stringify(allDims().map(dimSummary))}`);

  // d) Copy/Paste dimensioned geometry (rect + formula d2=d1/2 + user param W + ref dim + dim to origin)
  const docCP = design(
    { a: [10, 10], b: [70, 10], c: [70, 40], d: [10, 40] },
    [
      { id: 'L1', type: 'line', joints: ['a', 'b'] },
      { id: 'L2', type: 'line', joints: ['b', 'c'] },
      { id: 'L3', type: 'line', joints: ['c', 'd'] },
      { id: 'L4', type: 'line', joints: ['d', 'a'] },
    ],
    [
      { type: 'horizontal', joints: ['a', 'b'] },
      { type: 'vertical', joints: ['b', 'c'] },
      { type: 'horizontal', joints: ['c', 'd'] },
      { type: 'vertical', joints: ['d', 'a'] },
      { type: 'distance', joints: ['a', 'b'], value: 60, dimMode: 'horizontal', offset: -15, expression: 'W', name: 'd1' },
      { type: 'distance', joints: ['b', 'c'], value: 30, dimMode: 'vertical', offset: 15, expression: 'd1 / 2', name: 'd2' },
      { type: 'distance', joints: ['c', 'd'], value: 60, dimMode: 'horizontal', offset: 15, isDriven: true, driven: true, name: 'd3' },
      { type: 'distance', joints: ['j_origin', 'a'], value: 14.142, offset: 10, name: 'd4' },
    ],
    [{ name: 'W', expression: '60', value: 60 }],
  );
  await openDesign(docCP, { centre: { x: 40, y: 25 }, w: 240 });
  const appCP = theApp();
  appCP.state.selectedShapes = new Set(['L1', 'L2', 'L3', 'L4']);
  const env = selectionToEnvelope(appCP.state);
  const pasted = pasteDocument(appCP.state, env.document, { step: 1, unit: 'mm' });
  appCP.frames();
  const pastedDims = pasted.constraints.filter((c) => c.type === 'distance' || c.type === 'angle').map(dimSummary);
  row('V2.6.copyPaste', `pastedShapes=${pasted.shapes.length} pastedDims=${JSON.stringify(pastedDims)} frozen=${JSON.stringify(pasted.frozen)} ${residualText()}`);
}

await closeAll();
process.exit(0);
