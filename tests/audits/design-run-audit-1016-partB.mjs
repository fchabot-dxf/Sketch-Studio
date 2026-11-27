// tests/audits/design-run-audit-1016-partB.mjs — TASK 1016 Part B: Round flange (mm) real-UI audit.
// Run: node tests/audits/design-run-audit-1016-partB.mjs
import { sleep } from '../helpers/cdp-browser.js';
import {
  launchStudio, frameWorldBox, w2s, mouseMove, mouseClick,
  typeText, keyEnter, keyTab, keyEsc, ctrlA, ctrlZ, ctrlY, ctrlS,
  pressTool, clickSelector, readDoc, analyzeDoc, captureWorld, captureClip,
  reopenSavedDesign, row,
} from './design-run-audit-1016-kit.js';

function summarize(tag, snap, analysis) {
  const dimSummary = (analysis.dims || []).map((d) => `${d.name || '?'}=${d.value}${d.expr ? `(${d.expr})` : ''}${d.driven ? '[ref]' : ''}[${d.mode},meas=${d.measured != null ? d.measured.toFixed(2) : '?'}]`).join(', ');
  const paramSummary = (analysis.parameters || []).map((p) => `${p.name}=${p.expression}[${p.unit || 'none'}]`).join(', ');
  const patSummary = (analysis.patterns || []).map((p) => `${p.type}(qty=${p.quantity},expr=${JSON.stringify(p.expressions)},inst=${p.instances})`).join(', ');
  console.log(`\n[${tag}] tool=${snap.activeTool} shapes=${analysis.shapesCount} joints=${analysis.jointsCount} cons=${analysis.constraintsCount} nullity=${analysis.nullity} FC=${analysis.fullyConstrained} unsat=${analysis.unsatCount}${analysis.unsatCount ? '(' + analysis.unsatTypes.join(',') + ')' : ''}`);
  if (paramSummary) console.log(`  params: ${paramSummary}`);
  console.log(`  dims: ${dimSummary || '(none)'}`);
  if (patSummary) console.log(`  patterns: ${patSummary}`);
  console.log(`  freeShapes(${analysis.freeShapes?.length || 0}): ${(analysis.freeShapes || []).join(', ')}`);
  console.log(`  constraintTypes: ${JSON.stringify(analysis.constraintTypes || {})}`);
  if (snap.toasts.length) console.log(`  toasts: ${JSON.stringify(snap.toasts)}`);
}

async function addUserParam(cdp, name, expr, unit = 'mm') {
  await clickSelector(cdp, '.sk-pwin .pt-add');
  await sleep(160);
  await typeText(cdp, name);
  await keyTab(cdp);
  await typeText(cdp, expr);
  if (unit !== 'mm') {
    // Tab from Expression input into the Unit <select> (does not open OS dropdown popup)
    await keyTab(cdp);
    await sleep(100);
    const info = await cdp.evalJs(`(() => {
      const s = document.querySelector('.sk-pwin tr.pt-new select.pt-in');
      if (!s) return null;
      return { focused: document.activeElement === s, cur: s.selectedIndex, opts: [...s.options].map((o) => o.value) };
    })()`);
    const targetIdx = info ? info.opts.indexOf(unit) : -1;
    if (info && targetIdx >= 0 && targetIdx !== info.cur) {
      const diff = targetIdx - info.cur;
      const key = diff > 0 ? 'ArrowDown' : 'ArrowUp';
      const vk = diff > 0 ? 40 : 38;
      for (let k = 0; k < Math.abs(diff); k++) {
        await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code: key, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
        await sleep(70);
      }
    }
    // Shift+Tab back to Expression input and press Enter to commit
    await keyTab(cdp, true);
    await sleep(100);
    await keyEnter(cdp);
  } else {
    await keyEnter(cdp);
  }
  await sleep(220);
}

async function editUserParam(cdp, name, newExpr) {
  const sel = `.sk-pwin tr.pt-user[data-name="${name}"] input[data-col="expression"]`;
  await clickSelector(cdp, sel);
  await ctrlA(cdp);
  await typeText(cdp, newExpr);
  await keyEnter(cdp);
  await sleep(320);
}

async function main() {
  const { cdp, net, url } = await launchStudio({ tag: '1016-partB' });
  try {
    // ── B0: Frame canvas for Ø100 mm flange (growing to Ø120 later) ──
    const box = await frameWorldBox(cdp, -72, -72, 72, 72);
    console.log('[B0] canvasBox:', JSON.stringify(box), 'blockedRemote:', net.blocked().length);

    // ── B1: Open Parameters window and create OD=100, BC=OD-30, n=6 (unitless), bolt=8 ──
    await clickSelector(cdp, '#btn-parameters');
    await sleep(300);
    await addUserParam(cdp, 'OD', '100', 'mm');
    await addUserParam(cdp, 'BC', 'OD - 30', 'mm');
    await addUserParam(cdp, 'n', '6', '');
    await addUserParam(cdp, 'bolt', '8', 'mm');
    let snap = await readDoc(cdp);
    let an = analyzeDoc(snap.doc);
    summarize('B1 after creating 4 user parameters (n unitless)', snap, an);
    const pwinRect = await cdp.evalJs(`(() => { const r = document.querySelector('.sk-pwin')?.getBoundingClientRect(); return r ? { x: r.left, y: r.top, width: r.width, height: r.height } : null; })()`);
    if (pwinRect) {
      const shotB1 = await captureClip(cdp, 'partB-01-params.png', pwinRect);
      console.log('  shot:', shotB1.rel, shotB1.md5);
    }
    await clickSelector(cdp, '.sk-pwin .sk-dock-close');
    await sleep(200);

    // ── B2: Draw outer circle Ø100 (OD) centred on origin (0,0) ──
    await pressTool(cdp, 'tool-circle');
    const pOrigin = await w2s(cdp, 0, 0);
    await mouseClick(cdp, pOrigin.x, pOrigin.y);
    await typeText(cdp, 'OD');
    await keyEnter(cdp);
    snap = await readDoc(cdp); an = analyzeDoc(snap.doc);
    summarize('B2 after outer circle OD (Ø100)', snap, an);

    // ── B3: Draw centre hole Ø20 centred on origin (0,0) ──
    await mouseClick(cdp, pOrigin.x, pOrigin.y);
    await typeText(cdp, '20');
    await keyEnter(cdp);
    snap = await readDoc(cdp); an = analyzeDoc(snap.doc);
    summarize('B3 after centre hole Ø20', snap, an);

    // ── B4: Toggle Construction ON, draw bolt circle Ø70 (BC) centred on origin, toggle Construction OFF ──
    const constructTitle = await cdp.evalJs(`document.getElementById('btn-construct-toggle')?.getAttribute('title') || ''`);
    await clickSelector(cdp, '#btn-construct-toggle');
    await sleep(140);
    await mouseClick(cdp, pOrigin.x, pOrigin.y);
    await typeText(cdp, 'BC');
    await keyEnter(cdp);
    await clickSelector(cdp, '#btn-construct-toggle');
    await sleep(140);
    snap = await readDoc(cdp); an = analyzeDoc(snap.doc);
    summarize('B4 after construction bolt circle BC (Ø70)', snap, an);
    const concentricLabels = await cdp.evalJs(`(() => {
      return [...document.querySelectorAll('#svgCanvas g.dim-label text')].map((t) => {
        const r = t.getBoundingClientRect();
        return { text: t.textContent.trim(), left: +r.left.toFixed(1), top: +r.top.toFixed(1), right: +r.right.toFixed(1), bottom: +r.bottom.toFixed(1) };
      });
    })()`);
    console.log('[B4] concentric dim label rects:', JSON.stringify(concentricLabels));

    // ── B5: Draw 1st bolt hole Ø8 (bolt) on top of BC (0, -35) ──
    const pBoltTop = await w2s(cdp, 0, -35);
    await mouseClick(cdp, pBoltTop.x, pBoltTop.y);
    await typeText(cdp, 'bolt');
    await keyEnter(cdp);
    await keyEsc(cdp);
    snap = await readDoc(cdp); an = analyzeDoc(snap.doc);
    summarize('B5a after drawing bolt hole Ø8 (bolt) at (0, -35)', snap, an);

    if (!an.fullyConstrained) {
      const boltC = an.shapes.find((s) => s.type === 'circle' && Math.abs(s.r - 4) < 0.5);
      if (boltC) {
        await pressTool(cdp, 'tool-hv');
        const pBc = await w2s(cdp, boltC.pts[0][0], boltC.pts[0][1]);
        await mouseClick(cdp, pBc.x, pBc.y);
        await mouseClick(cdp, pOrigin.x, pOrigin.y);
        await keyEsc(cdp);
        snap = await readDoc(cdp); an = analyzeDoc(snap.doc);
        summarize('B5b after adding Vertical(boltCenter, origin)', snap, an);
      }
    }
    const shotB5 = await captureWorld(cdp, 'partB-02-before-pattern.png', -62, -62, 62, 62, 40);
    console.log('  shot:', shotB5.rel, shotB5.md5);

    // ── B6a: Observe Circular Pattern pick at normal flange zoom (JOINT_PRIORITY_RADIUS steals Ø8 rim!) ──
    await pressTool(cdp, 'tool-circularPattern');
    await sleep(220);
    const boltC = an.shapes.find((s) => s.type === 'circle' && Math.abs(s.r - 4) < 0.5);
    const pBoltRimNormal = await w2s(cdp, boltC.pts[0][0] + boltC.r, boltC.pts[0][1]);
    await mouseClick(cdp, pBoltRimNormal.x, pBoltRimNormal.y, { settle: 220 });
    const pickedAtNormalZoom = await cdp.evalJs(`document.querySelector('.sk-pattern-dialog .sk-pat-pick[data-pick="objects"]')?.textContent?.trim()`);
    console.log('[B6a] Circular Pattern Objects label after clicking Ø8 rim at normal flange zoom:', JSON.stringify(pickedAtNormalZoom));
    await keyEsc(cdp);
    await sleep(180);
    // Probe whether Esc left the mistakenly picked joint STILL selected (leaked into next Circular Pattern!)
    await pressTool(cdp, 'tool-circularPattern');
    await sleep(200);
    const leakedOnReopen = await cdp.evalJs(`document.querySelector('.sk-pattern-dialog .sk-pat-pick[data-pick="objects"]')?.textContent?.trim()`);
    console.log('[B6a] Circular Pattern Objects label immediately after Esc + reopen (leaked selection?):', JSON.stringify(leakedOnReopen));
    await keyEsc(cdp);
    await sleep(160);
    // Click empty canvas to clear the leaked selection from B6a before B6b
    const pClearB6 = await w2s(cdp, 65, 65);
    await mouseClick(cdp, pClearB6.x, pClearB6.y, { settle: 160 });

    // ── B6b: Zoom in on bolt hole so rim > 15px from center, pick bolt CIRCLE, then zoom back & pick origin + qty = n ──
    await frameWorldBox(cdp, -18, -48, 18, -22);
    await pressTool(cdp, 'tool-circularPattern');
    await sleep(220);
    const pBoltRimZoom = await w2s(cdp, boltC.pts[0][0] + boltC.r, boltC.pts[0][1]);
    await mouseClick(cdp, pBoltRimZoom.x, pBoltRimZoom.y, { settle: 220 });
    const pickedAtZoom = await cdp.evalJs(`document.querySelector('.sk-pattern-dialog .sk-pat-pick[data-pick="objects"]')?.textContent?.trim()`);
    console.log('[B6b] Circular Pattern Objects label after clicking Ø8 rim zoomed in:', JSON.stringify(pickedAtZoom));
    // Zoom back out to pick origin (0,0) as Center Point
    await frameWorldBox(cdp, -72, -72, 72, 72);
    await clickSelector(cdp, '.sk-pattern-dialog .sk-pat-pick[data-pick="centre"]');
    await sleep(160);
    const pOriginNow = await w2s(cdp, 0, 0);
    await mouseClick(cdp, pOriginNow.x, pOriginNow.y, { settle: 280 });
    // Probe entering a mm-unit parameter ('bolt') in Quantity first and clicking OK to capture the backwards unit error hint
    await clickSelector(cdp, '.sk-pattern-dialog input[data-slot="quantity"]');
    await ctrlA(cdp);
    await typeText(cdp, 'bolt');
    await sleep(160);
    await clickSelector(cdp, '.sk-pattern-dialog .sk-pat-ok');
    await sleep(240);
    const qtyMmSnap = await readDoc(cdp);
    const qtyMmHint = await cdp.evalJs(`document.querySelector('.sk-pattern-dialog .sk-pat-hint')?.textContent?.trim() || ''`);
    const qtyMmToast = qtyMmSnap.toasts.find((t) => /plain number|length|Circular Pattern/i.test(t)) || '';
    console.log('[B6b] Quantity refusal for mm-unit param "bolt": hint=', JSON.stringify(qtyMmHint), 'toast=', JSON.stringify(qtyMmToast));
    // Now enter unitless 'n' in Quantity field
    await clickSelector(cdp, '.sk-pattern-dialog input[data-slot="quantity"]');
    await ctrlA(cdp);
    await typeText(cdp, 'n');
    await sleep(240);
    const patDlgInfo = await cdp.evalJs(`(() => {
      const d = document.querySelector('.sk-pattern-dialog');
      if (!d) return null;
      const q = d.querySelector('input[data-slot="quantity"]');
      return { visible: true, qtyVal: q?.value, qtyInvalid: q?.getAttribute('aria-invalid'), hint: d.querySelector('.sk-pat-hint')?.textContent?.trim() };
    })()`);
    console.log('[B6b] Circular Pattern dialog before OK:', JSON.stringify(patDlgInfo));
    await clickSelector(cdp, '.sk-pattern-dialog .sk-pat-ok');
    await sleep(320);
    snap = await readDoc(cdp); an = analyzeDoc(snap.doc);
    summarize('B6b after Circular Pattern (6 bolt holes Ø8 driven by n)', snap, an);
    console.log('  B6b bolt circles count:', an.shapes.filter((s) => s.type === 'circle' && Math.abs(s.r - 4) < 0.5).length);
    console.log('  B6b bolt circles:', JSON.stringify(an.shapes.filter((s) => s.type === 'circle' && Math.abs(s.r - 4) < 0.5)));
    const shotB6 = await captureWorld(cdp, 'partB-03-circular-pattern.png', -62, -62, 62, 62, 40);
    console.log('  shot:', shotB6.rel, shotB6.md5);

    // ── B7: Keyway 6 wide, 3 deep at the top of the centre hole (Ø20, r=10) ──
    await frameWorldBox(cdp, -20, -20, 20, 18);
    await pressTool(cdp, 'tool-line');
    const rimY = -Math.sqrt(100 - 9); // -9.53939
    const pKwBL = await w2s(cdp, -3, rimY);
    const pKwTL = await w2s(cdp, -3, -13);
    const pKwTR = await w2s(cdp, 3, -13);
    const pKwBR = await w2s(cdp, 3, rimY);
    await mouseClick(cdp, pKwBL.x, pKwBL.y);
    await mouseMove(cdp, pKwTL.x, pKwTL.y);
    await sleep(80);
    await mouseClick(cdp, pKwTL.x, pKwTL.y);
    await mouseMove(cdp, pKwTR.x, pKwTR.y);
    await sleep(80);
    await mouseClick(cdp, pKwTR.x, pKwTR.y);
    await mouseMove(cdp, pKwBR.x, pKwBR.y);
    await sleep(80);
    await mouseClick(cdp, pKwBR.x, pKwBR.y);
    await keyEsc(cdp);
    snap = await readDoc(cdp); an = analyzeDoc(snap.doc);
    summarize('B7a after drawing 3 keyway lines', snap, an);

    // B7b-probe: Click horizontal keyway roof, then click directly above its midpoint on Y-axis (0, -16.5) -> observe axis-steal 90° angle bug!
    const kwTop = an.shapes.find((s) => s.type === 'line' && Math.abs(s.pts[0][1] - s.pts[1][1]) < 1);
    const pOriginZoom = await w2s(cdp, 0, 0);
    let b7bAngleHijacked = false;
    await pressTool(cdp, 'tool-dim');
    if (kwTop) {
      const pTopPick = await w2s(cdp, -1.5, -13);
      const pOnYAxis = await w2s(cdp, 0, -16.5);
      await mouseClick(cdp, pTopPick.x, pTopPick.y);
      await mouseClick(cdp, pOnYAxis.x, pOnYAxis.y);
      // Read state BEFORE Esc so we see if a 90° angle ref dim or placing dim was created!
      snap = await readDoc(cdp); an = analyzeDoc(snap.doc);
      b7bAngleHijacked = !!(an.constraintTypes.angle);
      summarize('B7b-probe dropping horizontal line dim label onto Y-axis (0,-16.5)', snap, an);
      await keyEsc(cdp);
      snap = await readDoc(cdp); an = analyzeDoc(snap.doc);
      if (an.constraintTypes.angle) {
        await ctrlZ(cdp);
        await sleep(200);
      }
    }

    // B7c: Now dimension keyway cleanly: width = 6 (drop label off Y-axis at (-2, -16.5)), depth = 13 from origin (d2/2 + 3), centred left wall 3 from origin
    await pressTool(cdp, 'tool-dim');
    const pTopPick = await w2s(cdp, -1.5, -13);
    const pTopOff = await w2s(cdp, -2.5, -16.5);
    await mouseClick(cdp, pTopPick.x, pTopPick.y);
    await mouseClick(cdp, pTopOff.x, pTopOff.y);
    await typeText(cdp, '6');
    await keyEnter(cdp);

    // Depth = 3 above Ø20 bore -> 13 from origin (or d2 / 2 + 3)
    const pTopPick2 = await w2s(cdp, 1.5, -13);
    const pDepthOff = await w2s(cdp, 8.5, -7);
    await mouseClick(cdp, pOriginZoom.x, pOriginZoom.y);
    await mouseClick(cdp, pTopPick2.x, pTopPick2.y);
    await mouseClick(cdp, pDepthOff.x, pDepthOff.y);
    await typeText(cdp, '13');
    await keyEnter(cdp);

    // Centre horizontally: left wall 3 from origin
    const pLeftPick = await w2s(cdp, -3, -11.3);
    const pHalfOff = await w2s(cdp, -1.5, -5);
    await mouseClick(cdp, pOriginZoom.x, pOriginZoom.y);
    await mouseClick(cdp, pLeftPick.x, pLeftPick.y);
    await mouseClick(cdp, pHalfOff.x, pHalfOff.y);
    await typeText(cdp, '3');
    await keyEnter(cdp);
    await keyEsc(cdp);
    snap = await readDoc(cdp); an = analyzeDoc(snap.doc);
    summarize('B7c after dimensioning keyway cleanly (6 wide, 3 deep = 13 from origin, centred)', snap, an);
    console.log('  B7c keyway lines:', JSON.stringify(an.shapes.filter((s) => s.type === 'line')));
    const shotB7 = await captureWorld(cdp, 'partB-04-keyway-before-trim.png', -15, -19, 15, 14, 35);
    console.log('  shot:', shotB7.rel, shotB7.md5);

    // ── B8: Trim the arc of the centre hole between the keyway walls! ──
    await pressTool(cdp, 'tool-trim');
    const pTopArc = await w2s(cdp, 0, -10);
    await mouseMove(cdp, pTopArc.x, pTopArc.y);
    await sleep(140);
    const trimHoverOverlay = await cdp.evalJs(`!!document.getElementById('trim-tool-overlay')`);
    await mouseClick(cdp, pTopArc.x, pTopArc.y, { settle: 260 });
    await keyEsc(cdp);
    snap = await readDoc(cdp); an = analyzeDoc(snap.doc);
    const b8TrimToast = snap.toasts.find((t) => /Trim.*circle/i.test(t)) || '';
    console.log('[B8] trim hover overlay on Ø20 circle arc:', trimHoverOverlay);
    summarize('B8 after clicking Ø20 top arc with Trim tool', snap, an);
    const shotB8 = await captureWorld(cdp, 'partB-05-after-trim-attempt.png', -15, -19, 15, 14, 35);
    console.log('  shot:', shotB8.rel, shotB8.md5);

    // ── B9: Frame full flange & check fully constrained status ──
    await frameWorldBox(cdp, -78, -78, 78, 78);
    snap = await readDoc(cdp); an = analyzeDoc(snap.doc);
    summarize('B9 COMPLETE Part B — check fully constrained!', snap, an);

    // ── B10: Change-your-mind #1 — Open Parameters window, change OD 100->120 and n 6->8 ──
    await clickSelector(cdp, '#btn-parameters');
    await sleep(250);
    await editUserParam(cdp, 'OD', '120');
    snap = await readDoc(cdp); an = analyzeDoc(snap.doc);
    summarize('B10a after changing OD 100 -> 120', snap, an);
    await editUserParam(cdp, 'n', '8');
    snap = await readDoc(cdp); an = analyzeDoc(snap.doc);
    summarize('B10b after changing n 6 -> 8', snap, an);
    const boltCircles8 = an.shapes.filter((s) => s.type === 'circle' && Math.abs(s.r - 4) < 0.5);
    const radiiFromOrigin8 = boltCircles8.map((c) => +Math.hypot(c.pts[0][0], c.pts[0][1]).toFixed(3));
    console.log('  B10b bolt circles count:', boltCircles8.length, 'radiiFromOrigin:', JSON.stringify(radiiFromOrigin8));
    const shotB10Params = await captureClip(cdp, 'partB-06a-params-OD120-n8.png', { x: 0, y: 80, width: 1280, height: 700 });
    console.log('  shot:', shotB10Params.rel, shotB10Params.md5);
    await clickSelector(cdp, '.sk-pwin .sk-dock-close');
    await sleep(200);
    const shotB10 = await captureWorld(cdp, 'partB-06b-flange-OD120-n8.png', -72, -72, 72, 72, 40);
    console.log('  shot:', shotB10.rel, shotB10.md5);

    // ── B11: Change-your-mind #2 — Undo BOTH parameter changes (Ctrl+Z twice) ──
    const pEmpty = await w2s(cdp, 68, 68);
    await mouseClick(cdp, pEmpty.x, pEmpty.y, { settle: 140 });
    await ctrlZ(cdp);
    await sleep(250);
    snap = await readDoc(cdp); an = analyzeDoc(snap.doc);
    summarize('B11a after 1st Ctrl+Z (undo n=8 -> 6)', snap, an);
    await ctrlZ(cdp);
    await sleep(250);
    snap = await readDoc(cdp); an = analyzeDoc(snap.doc);
    summarize('B11b after 2nd Ctrl+Z (undo OD=120 -> 100)', snap, an);
    const boltCircles6 = an.shapes.filter((s) => s.type === 'circle' && Math.abs(s.r - 4) < 0.5);
    const radiiFromOrigin6 = boltCircles6.map((c) => +Math.hypot(c.pts[0][0], c.pts[0][1]).toFixed(3));
    console.log('  B11b bolt circles count:', boltCircles6.length, 'radiiFromOrigin:', JSON.stringify(radiiFromOrigin6));
    const shotB11 = await captureWorld(cdp, 'partB-07-after-undo-params.png', -72, -72, 72, 72, 40);
    console.log('  shot:', shotB11.rel, shotB11.md5);

    // ── B12: End check 1 — Ctrl+Z back to empty & Ctrl+Y forward again ──
    const preUndoAn = an;
    let undoSteps = 0;
    for (let i = 0; i < 120; i++) {
      const sNow = await readDoc(cdp);
      if (sNow.undoDisabled) break;
      await ctrlZ(cdp);
      undoSteps++;
    }
    const afterUndoSnap = await readDoc(cdp);
    const afterUndoAn = analyzeDoc(afterUndoSnap.doc);
    summarize(`B12a after ${undoSteps} Ctrl+Z`, afterUndoSnap, afterUndoAn);

    // Redo back to the same point (undoSteps times, NOT past B11 into the undone OD=120/n=8!)
    let redoSteps = 0;
    for (let i = 0; i < undoSteps; i++) {
      const sNow = await readDoc(cdp);
      if (sNow.redoDisabled) break;
      await ctrlY(cdp);
      redoSteps++;
    }
    const afterRedoSnap = await readDoc(cdp);
    const afterRedoAn = analyzeDoc(afterRedoSnap.doc);
    summarize(`B12b after ${redoSteps} Ctrl+Y (back to pre-undo OD=100, n=6)`, afterRedoSnap, afterRedoAn);
    console.log('  undo/redo match shapes:', preUndoAn.shapesCount, '->', afterUndoAn.shapesCount, '->', afterRedoAn.shapesCount,
      'cons:', preUndoAn.constraintsCount, '->', afterUndoAn.constraintsCount, '->', afterRedoAn.constraintsCount,
      'params:', JSON.stringify(preUndoAn.parameters) === JSON.stringify(afterRedoAn.parameters),
      'patterns:', JSON.stringify(preUndoAn.patterns) === JSON.stringify(afterRedoAn.patterns),
      'FC:', preUndoAn.fullyConstrained, '->', afterRedoAn.fullyConstrained);

    // ── B13: End check 2 — Save (Ctrl+S), reload page, reopen & verify persistence ──
    const preSaveAn = afterRedoAn;
    await ctrlS(cdp);
    await sleep(350);
    await ctrlA(cdp);
    await typeText(cdp, 'Part B Round Flange');
    await keyEnter(cdp);
    await sleep(500);
    await cdp.flushAutosave();
    const preReloadSnap = await readDoc(cdp);

    await cdp.navigate(url, 15000);
    await cdp.waitForApp('svgCanvas');
    await sleep(500);
    const postReloadSnap = await readDoc(cdp);
    const postReloadAn = analyzeDoc(postReloadSnap.doc);
    summarize('B13 after Save + Reload', postReloadSnap, postReloadAn);
    console.log('  tab:', JSON.stringify(preReloadSnap.activeTab), '->', JSON.stringify(postReloadSnap.activeTab));
    console.log('  save/reload match shapes:', preSaveAn.shapesCount === postReloadAn.shapesCount,
      'cons:', preSaveAn.constraintsCount === postReloadAn.constraintsCount,
      'params:', JSON.stringify(preSaveAn.parameters) === JSON.stringify(postReloadAn.parameters),
      'dims:', JSON.stringify(preSaveAn.dims.map((d) => [d.name, d.value, d.expr, d.driven])) === JSON.stringify(postReloadAn.dims.map((d) => [d.name, d.value, d.expr, d.driven])),
      'patterns:', JSON.stringify(preSaveAn.patterns) === JSON.stringify(postReloadAn.patterns),
      'constr:', JSON.stringify(preSaveAn.shapes.map((s) => s.constr)) === JSON.stringify(postReloadAn.shapes.map((s) => s.constr)),
      'FC:', preSaveAn.fullyConstrained, '->', postReloadAn.fullyConstrained);
    const shotB13 = await captureClip(cdp, 'partB-08-after-reload.png', { x: 250, y: 110, width: 960, height: 640 });
    console.log('  shot:', shotB13.rel, shotB13.md5);

    const reopenRes = await reopenSavedDesign(cdp, 'Part B Round Flange');
    const postReopenSnap = await readDoc(cdp);
    const postReopenAn = analyzeDoc(postReopenSnap.doc);
    const reopenMatches = postReloadAn.shapesCount === postReopenAn.shapesCount &&
      postReloadAn.constraintsCount === postReopenAn.constraintsCount &&
      JSON.stringify(postReloadAn.parameters) === JSON.stringify(postReopenAn.parameters) &&
      JSON.stringify(postReloadAn.dims.map((d) => [d.name, d.value, d.expr, d.driven])) === JSON.stringify(postReopenAn.dims.map((d) => [d.name, d.value, d.expr, d.driven])) &&
      JSON.stringify(postReloadAn.patterns) === JSON.stringify(postReopenAn.patterns) &&
      JSON.stringify(postReloadAn.shapes.map((s) => s.constr)) === JSON.stringify(postReopenAn.shapes.map((s) => s.constr)) &&
      postReloadAn.fullyConstrained === postReopenAn.fullyConstrained;
    console.log('[B13b] reopenSavedDesign:', JSON.stringify(reopenRes), 'shapes:', postReopenAn.shapesCount, 'cons:', postReopenAn.constraintsCount, 'FC:', postReopenAn.fullyConstrained, 'reopenMatches:', reopenMatches);

    // ── Standardized ROW summary lines (Part B: R1-12..R1-17) ──
    const labelsOverlap = (() => {
      for (let i = 0; i < concentricLabels.length; i++) {
        for (let j = i + 1; j < concentricLabels.length; j++) {
          const a = concentricLabels[i], b = concentricLabels[j];
          if (a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top) return true;
        }
      }
      return false;
    })();
    console.log('\n--- PART B AUDIT ROWS ---');
    row('R1-12', 'Part B / B8', b8TrimToast ? 'BUG' : 'OK',
      `Trim cannot trim circle/arc for keyway (hoverOverlay=${trimHoverOverlay}, toast=${JSON.stringify(b8TrimToast)})`);
    row('R1-13', 'Part B / B7b', b7bAngleHijacked ? 'BUG' : 'OK',
      `dropping horizontal line dim label above midpoint onto Y-axis (0,-16.5) hijacked length dim into (90°) Reference Angle (angleHijacked=${b7bAngleHijacked})`);
    row('R1-14', 'Part B / B6a', (pickedAtNormalZoom === '1 selected' && leakedOnReopen === '1 selected') ? 'BUG' : 'OK',
      `Circular Pattern at flange zoom picked bolt center joint instead of Ø8 rim (${JSON.stringify(pickedAtNormalZoom)}) AND Esc leaked selection into reopened dialog (${JSON.stringify(leakedOnReopen)})`);
    row('R1-15', 'Part B / B2-B4,B10', labelsOverlap ? 'FRICTION' : 'OK',
      `concentric circle diameter labels auto-place horizontally on top of each other (overlap=${labelsOverlap}, rects=${JSON.stringify(concentricLabels.map((l) => [l.text, l.left, l.top]))})`);
    row('R1-16', 'Part B / B1,B6', (qtyMmToast || qtyMmHint) ? 'FRICTION' : 'OK',
      `Parameters +Add defaults Unit to mm (read-only after create) and mm param in Circular Pattern Quantity prints backwards error (${JSON.stringify(qtyMmToast || qtyMmHint)})`);
    row('R1-17', 'Part B / B4', /\(K\)/i.test(constructTitle) ? 'DIVERGENCE' : 'OK',
      `Construction toggle shortcut is K (${JSON.stringify(constructTitle)}) vs Fusion 360 X (unverified)`);

    console.log('\n[NET] blocked remote URLs:', JSON.stringify(net.blocked()));
  } finally {
    await cdp.close();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
