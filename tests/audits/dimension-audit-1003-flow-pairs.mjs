// tests/audits/dimension-audit-1003-flow-pairs.mjs -- TASK 1003 (AUDIT ONLY, outside the gate)
// Area 3: TOOL FLOW (persistence, re-click, Esc sub-states, mid-pick/placement/edit tool switches)
//         & PAIRS / IRREGULARITIES (ribbon vs shortcut vs preselect vs draw-time box; SketchStudio vs Shaper vs Pen Plotter).
// Run: node tests/audits/dimension-audit-1003-flow-pairs.mjs
import {
  design, openDesign, closeAll, theApp, J, f, pt, row, quiet,
  toasts, clearToasts, boxOpen, boxEl, hintText, completeEl, dimSummary, allDims, labelTextOf, labelEl,
  moveW, clickW, dim, editDim,
} from './dimension-audit-1003-kit.js';

const HOSTS = ['sketchstudio', 'shaper', 'penplotter'];

// ─── F3.1 TOOL PERSISTENCE (owner ruling: stays active after each use) ──────
{
  const doc = design(
    {
      a: [-60, 0, true], b: [-10, 0],
      c: [10, 0], d: [60, 0],
      e: [10, 30], f: [60, 30],
      g: [-60, 40, true], h: [-10, 40, true], // fixed line (auto-ref)
      cc: [90, 15],
      bz1: [-60, -40], bz2: [-10, -40],
    },
    [
      { id: 'L1', type: 'line', joints: ['a', 'b'] },
      { id: 'L2', type: 'line', joints: ['c', 'd'] },
      { id: 'L3', type: 'line', joints: ['e', 'f'] },
      { id: 'LF', type: 'line', joints: ['g', 'h'] },
      { id: 'C1', type: 'circle', joints: ['cc'], radius: 15 },
      { id: 'B1', type: 'bezier', joints: ['bz1', 'bz2'], c1: [-45, -20], c2: [-25, -20] },
    ],
  );
  await openDesign(doc, { centre: { x: 15, y: 10 }, w: 280 });
  const app = theApp();
  app.tool('dim');
  // 1) Line dim + Enter
  await clickW({ x: -35, y: 0 }); await clickW({ x: -35, y: -15 });
  if (boxOpen()) { await quiet(() => app.enter()); app.frames(); }
  const afterLine = app.state.currentTool;
  // 2) Parallel dim + Enter
  await clickW({ x: 35, y: 0 }); await clickW({ x: 35, y: 30 }); await clickW({ x: 80, y: 15 });
  if (boxOpen()) { await quiet(() => app.enter()); app.frames(); }
  const afterPar = app.state.currentTool;
  // 3) Auto-reference dim (fixed line)
  await clickW({ x: -35, y: 40 }); await clickW({ x: -35, y: 55 });
  const afterRef = app.state.currentTool;
  // 4) Circle dim + Enter
  await clickW({ x: 105, y: 15 }); await clickW({ x: 115, y: 30 });
  if (boxOpen()) { await quiet(() => app.enter()); app.frames(); }
  const afterCirc = app.state.currentTool;
  // 5) Refusal on Bezier body
  await clickW({ x: -35, y: -25 });
  const afterBezierRefuse = app.state.currentTool;
  // 6) Click empty space
  await clickW({ x: -100, y: -60 });
  const afterEmpty = app.state.currentTool;
  row('F3.1.persistence', `line=${afterLine} par=${afterPar} ref=${afterRef} circ=${afterCirc} bezierRefuse=${afterBezierRefuse} empty=${afterEmpty}`);
}

// ─── F3.2 RE-CLICKING DIM RIBBON & PRESSING D AGAIN (3 HOSTS) ───────────────
for (const host of HOSTS) {
  const doc = design({ a: [0, 0, true], b: [60, 0] }, [{ id: 'L1', type: 'line', joints: ['a', 'b'] }]);
  await openDesign(doc, { centre: { x: 30, y: 0 }, w: 200, host });
  const app = theApp();
  app.tool('dim');
  const t1 = app.state.currentTool;
  app.tool('dim'); // re-click ribbon button
  const t2 = app.state.currentTool;
  await quiet(() => { app.key('d'); }); // press D again
  app.frames();
  const t3 = app.state.currentTool;
  // Now start placing, then re-click Dim button!
  await clickW({ x: 30, y: 0 });
  const placingBefore = !!app.state.placingConstraint;
  app.tool('dim');
  const placingAfterReclick = !!app.state.placingConstraint;
  const t4 = app.state.currentTool;
  row(`F3.2.reclick.${host}`, `click1=${t1} click2=${t2} keyD=${t3} placingReclick=${placingBefore}->${placingAfterReclick} tool=${t4}`);
}

// ─── F3.3 ESC AT EVERY SUB-STATE ────────────────────────────────────────────
{
  const doc = design(
    { a: [0, 0, true], b: [60, 0], c: [0, 30], d: [60, 30] },
    [{ id: 'L1', type: 'line', joints: ['a', 'b'] }, { id: 'L2', type: 'line', joints: ['c', 'd'] }],
  );
  // a) Esc while idle in Dim
  await openDesign(doc, { centre: { x: 30, y: 15 }, w: 200 });
  let app = theApp();
  app.tool('dim');
  await quiet(() => app.esc()); app.frames();
  row('F3.3.escIdle', `tool=${app.state.currentTool}`);

  // b) Esc mid-pick (after 1st point click)
  await openDesign(doc, { centre: { x: 30, y: 15 }, w: 200 });
  app = theApp();
  app.tool('dim');
  await clickW({ x: 0, y: 0 });
  const activeBefore = app.state.active && app.state.active.mode;
  await quiet(() => app.esc()); app.frames();
  row('F3.3.escMidPick', `activeBefore=${activeBefore} activeAfter=${app.state.active} toolAfter=${app.state.currentTool}`);

  // c) Esc mid-placement (while label follows cursor)
  await openDesign(doc, { centre: { x: 30, y: 15 }, w: 200 });
  app = theApp();
  const h0 = app.state.history.length;
  app.tool('dim');
  await clickW({ x: 30, y: 0 });
  const dimsDuring = allDims().length;
  await quiet(() => app.esc()); app.frames();
  row('F3.3.escMidPlace', `dims=${dimsDuring}->${allDims().length} placing=${!!app.state.placingConstraint} hist=${h0}->${app.state.history.length} toolAfter=${app.state.currentTool}`);

  // d) CRITICAL CHECK: Re-click an EXISTING parallel dim pair (L1->L2) then press Esc! Does Esc DELETE the existing dim?!
  const docPar = design(
    { a: [0, 0, true], b: [60, 0], c: [0, 30], d: [60, 30] },
    [{ id: 'L1', type: 'line', joints: ['a', 'b'] }, { id: 'L2', type: 'line', joints: ['c', 'd'] }],
    [{ type: 'distance', shapes: ['L1', 'L2'], value: 30, offset: 20, name: 'd1' }],
  );
  await openDesign(docPar, { centre: { x: 30, y: 15 }, w: 200 });
  app = theApp();
  const hPar0 = app.state.history.length;
  app.tool('dim');
  await clickW({ x: 30, y: 0 });   // L1 -> length preview
  await clickW({ x: 30, y: 30 });  // L2 -> recovers EXISTING d1 into placing!
  const placingExisting = app.state.placingConstraint === dim('d1');
  await quiet(() => app.esc()); app.frames();
  row('F3.3.escOnRecoveredExistingPar', `placingExisting=${placingExisting} d1StillExists=${!!dim('d1')} dimsAfterEsc=${allDims().length} hist=${hPar0}->${app.state.history.length}`);

  // Same check for EXISTING ANGLE dim!
  const docAng = design(
    { a: [0, 0, true], b: [60, 0, true], c: [30, 50] },
    [{ id: 'L1', type: 'line', joints: ['a', 'b'] }, { id: 'L2', type: 'line', joints: ['a', 'c'] }],
    [{ type: 'angle', shapes: ['L1', 'L2'], value: 59.036, sector: { ray1: 1, ray2: 1, turn: 1 }, offset: 25, name: 'd1' }],
  );
  await openDesign(docAng, { centre: { x: 30, y: 20 }, w: 200 });
  app = theApp();
  const hAng0 = app.state.history.length;
  app.tool('dim');
  await clickW({ x: 30, y: 0 });
  await clickW({ x: 15, y: 25 });
  const placingExistingAng = app.state.placingConstraint === dim('d1');
  await quiet(() => app.esc()); app.frames();
  row('F3.3.escOnRecoveredExistingAng', `placingExisting=${placingExistingAng} d1StillExists=${!!dim('d1')} dimsAfterEsc=${allDims().length} hist=${hAng0}->${app.state.history.length}`);
}

// ─── F3.4 SWITCHING TOOLS MID-PICK / MID-PLACEMENT / MID-EDIT (3 HOSTS) ─────
for (const host of HOSTS) {
  const doc = design({ a: [0, 0, true], b: [60, 0], p: [30, 40] }, [{ id: 'L1', type: 'line', joints: ['a', 'b'] }]);

  // a) Switch via ribbon (#tool-line) mid-placement
  await openDesign(doc, { centre: { x: 30, y: 15 }, w: 200, host });
  let app = theApp();
  const h0 = app.state.history.length;
  app.tool('dim');
  await clickW({ x: 30, y: 0 });
  app.tool('line'); // switch away via ribbon!
  const afterRibbon = {
    tool: app.state.currentTool,
    placing: !!app.state.placingConstraint,
    dims: allDims().map(dimSummary),
    histDelta: app.state.history.length - h0,
  };

  // b) Switch via shortcut ('l') mid-placement
  await openDesign(doc, { centre: { x: 30, y: 15 }, w: 200, host });
  app = theApp();
  const h1 = app.state.history.length;
  app.tool('dim');
  await clickW({ x: 30, y: 0 });
  await quiet(() => app.key('l')); app.frames();
  const afterKey = {
    tool: app.state.currentTool,
    placing: !!app.state.placingConstraint,
    dims: allDims().map(dimSummary),
    histDelta: app.state.history.length - h1,
  };

  // c) Switch via ribbon mid-pick (1st point picked -> switch to Line -> return to Dim -> click another point!)
  await openDesign(doc, { centre: { x: 30, y: 15 }, w: 200, host });
  app = theApp();
  app.tool('dim');
  await clickW({ x: 0, y: 0 }); // 1st point 'a'
  app.tool('line');
  app.tool('dim');
  await clickW({ x: 30, y: 40 }); // click 'p' — does leaked pendingDimension pair it with 'a'?!
  const midPickHijack = allDims().map(dimSummary);

  // d) Switch tool via ribbon while #dimInput edit box is open!
  await openDesign(doc, { centre: { x: 30, y: 15 }, w: 200, host });
  app = theApp();
  app.tool('dim');
  await clickW({ x: 30, y: 0 });
  await clickW({ x: 30, y: -15 }); // opens edit box
  const openBeforeSwitch = boxOpen();
  app.tool('line'); // note: click() in node-app only dispatches click, not pointerdown; also test press()!
  const openAfterClick = boxOpen();
  const btnLine = app.document.getElementById('tool-line');
  if (btnLine) await quiet(() => app.press(btnLine));
  const openAfterPress = boxOpen();

  row(`F3.4.switch.${host}`, `ribbonMidPlace=${JSON.stringify(afterRibbon)} | keyMidPlace=${JSON.stringify(afterKey)} | midPickHijack=${JSON.stringify(midPickHijack)} | midEdit=${openBeforeSwitch}->click:${openAfterClick}->press:${openAfterPress}`);
}

// ─── F3.5 PATH PAIRS: PRESELECT RIBBON vs D-KEY vs CLICK-CLICK ──────────────
{
  const docPre = () => design(
    {
      a: [0, 0, true], b: [30, 40],         // diagonal L1 with H-dim d1=30
      c: [60, 0], d: [90, 40],              // parallel L2
      e: [60, 0], g: [110, 0],              // crossing L3
      p: [15, -25],
      c1: [-40, 0], c2: [-90, 0],           // C1 has ref dim only, C2 free
      ac: [-40, 50], as: [-25, 50], ae: [-40, 65],
    },
    [
      { id: 'L1', type: 'line', joints: ['a', 'b'] },
      { id: 'L2', type: 'line', joints: ['c', 'd'] },
      { id: 'L3', type: 'line', joints: ['e', 'g'] },
      { id: 'C1', type: 'circle', joints: ['c1'], radius: 15 },
      { id: 'C2', type: 'circle', joints: ['c2'], radius: 15 },
      { id: 'A1', type: 'arc', joints: ['ac', 'as', 'ae'], sweep: true },
    ],
    [
      { type: 'distance', joints: ['a', 'b'], value: 30, dimMode: 'horizontal', offset: 25, name: 'd1' },
      { type: 'distance', shape: 'C1', value: 15, isRadius: true, isDriven: true, driven: true, name: 'd2' },
    ],
  );

  const preCases = [
    ['1line_L2', ['L2'], []],
    ['2parLines', ['L1', 'L2'], []],
    ['2crossLines', ['L2', 'L3'], []],
    ['2pts_withHdim', [], ['a', 'b']],
    ['pt+line', ['L2'], ['p']],
    ['1circ_free', ['C2'], []],
    ['1circ_refOnly', ['C1'], []],
    ['1arc', ['A1'], []],
    ['1pt', [], ['p']],
    ['2circles', ['C1', 'C2'], []],
    ['pt+circle', ['C2'], ['p']],
    ['3items', ['L1', 'L2', 'L3'], []],
  ];

  for (const [tag, shs, js] of preCases) {
    const out = {};
    for (const via of ['ribbon', 'keyD']) {
      await openDesign(docPre(), { centre: { x: 10, y: 15 }, w: 300 });
      const app = theApp();
      app.state.selectedShapes = new Set(shs);
      app.state.selectedJoints = new Set(js);
      clearToasts();
      const beforeN = allDims().length;
      if (via === 'ribbon') app.tool('dim');
      else { await quiet(() => app.key('d')); app.frames(); }
      const added = allDims().slice(beforeN).map(dimSummary);
      out[via] = {
        tool: app.state.currentTool,
        placing: !!app.state.placingConstraint,
        active: app.state.active ? app.state.active.mode : null,
        added,
        selLeft: app.state.selectedShapes.size + app.state.selectedJoints.size,
        toasts: toasts(),
      };
    }
    const same = JSON.stringify(out.ribbon) === JSON.stringify(out.keyD);
    row(`F3.5.pre.${tag}`, `same=${same} ribbon=${JSON.stringify(out.ribbon)}${same ? '' : ' keyD=' + JSON.stringify(out.keyD)}`);
  }
}

// ─── F3.6 DRAW-TIME BOX vs EDIT BOX IRREGULARITIES ──────────────────────────
{
  const docDraw = () => design(
    { a: [0, 0, true], b: [60, 0] },
    [{ id: 'L1', type: 'line', joints: ['a', 'b'] }],
    [{ type: 'horizontal', joints: ['a', 'b'] }, { type: 'distance', joints: ['a', 'b'], value: 60, dimMode: 'horizontal', offset: -20, name: 'd1' }],
  );

  // 1) Line draw-time box: type "w = 50", "-5", "d" autocomplete, and click-to-insert d1 (task 876)
  await openDesign(docDraw(), { centre: { x: 30, y: 20 }, w: 220 });
  let app = theApp();
  app.tool('line');
  await clickW({ x: 0, y: 30 });
  await moveW({ x: 40, y: 30 });
  // Live dual box for line!
  const dualW = app.document.querySelector('#dualInput input');
  const dualOpen = dualW && !app.document.getElementById('dualInput').classList.contains('hidden');
  let drawEqHint = '', drawAuto = false, drawClickInsert = '';
  if (dualOpen) {
    await quiet(() => { dualW.focus(); dualW.select(); app.type('w = 50'); });
    drawEqHint = hintText();
    await quiet(() => { dualW.focus(); dualW.select(); app.key('a', { ctrl: true }); app.type('d'); });
    const cl = completeEl();
    drawAuto = !!cl && !cl.classList.contains('hidden');
    // Click d1 label while typing in draw-time box (task 876)
    await quiet(() => { dualW.focus(); dualW.select(); app.key('a', { ctrl: true }); app.type('2 * '); });
    const idx1 = app.state.constraints.indexOf(dim('d1'));
    const g1 = dim('d1').glyphPos;
    const p1 = app.toScreen(g1.x, g1.y);
    await quiet(() => { app.click(p1.x, p1.y, { target: () => labelEl(app, idx1) }); });
    drawClickInsert = dualW.value;
    await quiet(() => { app.enter(); });
    app.frames();
  }
  const lineCreatedDim = allDims().slice(1).map(dimSummary);
  row('F3.6.drawLineBox', `dualOpen=${dualOpen} eqHint="${drawEqHint}" autocomplete=${drawAuto} clickInsert="${drawClickInsert}" createdDims=${JSON.stringify(lineCreatedDim)}`);

  // 2) Circle draw-time box: type "d1" (60) -> creates RADIUS dim with "(d1) / 2" (DIV-01 / B-19a)
  await openDesign(docDraw(), { centre: { x: 30, y: 20 }, w: 220 });
  app = theApp();
  app.tool('circle');
  await clickW({ x: 30, y: 40 });
  await moveW({ x: 50, y: 40 });
  const cBoxOpen = boxOpen();
  if (cBoxOpen) {
    await quiet(() => { const i = boxEl(); i.focus(); i.select(); app.key('a', { ctrl: true }); app.type('d1'); app.enter(); });
    app.frames();
  }
  const circShape = app.state.shapes.find((s) => s.type === 'circle');
  const circDims = allDims().slice(1).map(dimSummary);
  row('F3.6.drawCircleBox', `boxOpen=${cBoxOpen} radius=${circShape && f(circShape.radius, 2)} createdDims=${JSON.stringify(circDims)}`);

  // 3) Rect draw-time box: type "d1" x "d1 / 2" -> check created dims & formulas
  await openDesign(docDraw(), { centre: { x: 30, y: 20 }, w: 220 });
  app = theApp();
  app.tool('rect');
  await clickW({ x: 0, y: 30 });
  await moveW({ x: 40, y: 60 });
  const rInputs = [...app.document.querySelectorAll('#dualInput input')];
  if (rInputs.length === 2) {
    await quiet(() => {
      rInputs[0].focus(); rInputs[0].select(); app.key('a', { ctrl: true }); app.type('d1');
      rInputs[1].focus(); rInputs[1].select(); app.key('a', { ctrl: true }); app.type('d1 / 2');
      app.enter();
    });
    app.frames();
  }
  row('F3.6.drawRectBox', `createdDims=${JSON.stringify(allDims().slice(1).map(dimSummary))}`);
}

await closeAll();
process.exit(0);
