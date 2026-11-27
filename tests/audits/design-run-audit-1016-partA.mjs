// tests/audits/design-run-audit-1016-partA.mjs — TASK 1016 Part A: L-bracket plate (mm) real-UI audit.
// Run: node tests/audits/design-run-audit-1016-partA.mjs
import { sleep } from '../helpers/cdp-browser.js';
import {
  launchStudio, frameWorldBox, w2s, mouseMove, mouseClick, mouseDblClick, mouseDrag,
  typeText, keyEnter, keyTab, keyEsc, keyDelete, ctrlA, ctrlZ, ctrlY, ctrlS,
  pressTool, readDoc, analyzeDoc, findDimLabelOnScreen, captureWorld, captureClip,
  reopenSavedDesign, row,
} from './design-run-audit-1016-kit.js';

function summarize(tag, snap, analysis) {
  const dimSummary = (analysis.dims || []).map((d) => `${d.name || '?'}=${d.value}${d.expr ? `(${d.expr})` : ''}${d.driven ? '[ref]' : ''}[${d.mode},meas=${d.measured != null ? d.measured.toFixed(2) : '?'}]`).join(', ');
  console.log(`\n[${tag}] tool=${snap.activeTool} shapes=${analysis.shapesCount} joints=${analysis.jointsCount} cons=${analysis.constraintsCount} nullity=${analysis.nullity} FC=${analysis.fullyConstrained} unsat=${analysis.unsatCount}${analysis.unsatCount ? '(' + analysis.unsatTypes.join(',') + ')' : ''}`);
  console.log(`  dims: ${dimSummary || '(none)'}`);
  console.log(`  freeShapes(${analysis.freeShapes?.length || 0}): ${(analysis.freeShapes || []).join(', ')}`);
  console.log(`  constraintTypes: ${JSON.stringify(analysis.constraintTypes || {})}`);
  if (snap.toasts.length) console.log(`  toasts: ${JSON.stringify(snap.toasts)}`);
}

async function main() {
  const { cdp, net, url } = await launchStudio({ tag: '1016-partA' });
  try {
    // ── A0: Frame canvas for 80x50 mm (growing to 100x50 later) ──
    const box = await frameWorldBox(cdp, -18, -68, 112, 34);
    console.log('[A0] canvasBox:', JSON.stringify(box), 'blockedRemote:', net.blocked().length);

    // ── A1..A6: Draw L-bracket outline 80x50 with 30x20 top-right notch, bottom-left on origin (0,0) ──
    await pressTool(cdp, 'tool-line');

    // A1: click origin (0,0), move right, type 80 Tab 0 Enter -> bottom edge (0,0)->(80,0)
    const pOrigin = await w2s(cdp, 0, 0);
    await mouseClick(cdp, pOrigin.x, pOrigin.y);
    const pRightGuide = await w2s(cdp, 60, 0);
    await mouseMove(cdp, pRightGuide.x, pRightGuide.y);
    await typeText(cdp, '80');
    await keyTab(cdp);
    await typeText(cdp, '0');
    await keyEnter(cdp);
    let snap = await readDoc(cdp);
    let an = analyzeDoc(snap.doc);
    summarize('A1 after 80 Tab 0 Enter', snap, an);

    // A2: continue up to (80, -30) — click (vertical inference; height left free for drag step)
    const p80_30 = await w2s(cdp, 80, -30);
    await mouseMove(cdp, p80_30.x, p80_30.y);
    await sleep(80);
    await mouseClick(cdp, p80_30.x, p80_30.y);

    // A3: continue left, type 30 Tab 180 Enter -> (50, -30)
    const p50_30 = await w2s(cdp, 50, -30);
    await mouseMove(cdp, p50_30.x, p50_30.y);
    await typeText(cdp, '30');
    await keyTab(cdp);
    await typeText(cdp, '180');
    await keyEnter(cdp);

    // A4: continue up to (50, -50) — click
    const p50_50 = await w2s(cdp, 50, -50);
    await mouseMove(cdp, p50_50.x, p50_50.y);
    await sleep(80);
    await mouseClick(cdp, p50_50.x, p50_50.y);

    // A5: continue left to (0, -50) — click
    const p0_50 = await w2s(cdp, 0, -50);
    await mouseMove(cdp, p0_50.x, p0_50.y);
    await sleep(80);
    await mouseClick(cdp, p0_50.x, p0_50.y);

    // A6: close loop back to origin (0, 0)
    await mouseMove(cdp, pOrigin.x, pOrigin.y);
    await sleep(80);
    await mouseClick(cdp, pOrigin.x, pOrigin.y);
    await keyEsc(cdp);
    snap = await readDoc(cdp); an = analyzeDoc(snap.doc);
    summarize('A6 after closing L-outline', snap, an);
    const d1Offset = snap.doc.geometry.constraints.find((c) => c.type === 'distance' && c.value === 80)?.offset;
    console.log('  d1(80) offset:', d1Offset, 'horizontalCount:', an.constraintTypes.horizontal || 0);
    const shotA6 = await captureWorld(cdp, 'partA-01-outline.png', -20, -68, 102, 34, 40);
    console.log('  shot:', shotA6.rel, shotA6.md5);

    // ── A6b: Work around B-19d (typed angle dropped Horizontal): add H/V to bottom & notch-bottom edges ──
    await pressTool(cdp, 'tool-hv');
    const pBotMid = await w2s(cdp, 40, 0);
    await mouseClick(cdp, pBotMid.x, pBotMid.y);
    const pNotchBMid = await w2s(cdp, 65, -30);
    await mouseClick(cdp, pNotchBMid.x, pNotchBMid.y);
    await keyEsc(cdp);

    // ── A7a: Dimension notch height = 20 (leaving overall height 50 free!) ──
    await pressTool(cdp, 'tool-dim');
    const pNotchV = await w2s(cdp, 50, -40);
    await mouseClick(cdp, pNotchV.x, pNotchV.y);
    const pNotchVOff = await w2s(cdp, 60, -40);
    await mouseClick(cdp, pNotchVOff.x, pNotchVOff.y);
    await typeText(cdp, '20');
    await keyEnter(cdp);
    await keyEsc(cdp);

    // ── A7b: Change-your-mind #1 — DRAG free top-left corner (0,-50) -> (0,-62) before last dim ──
    const pCorner = await w2s(cdp, 0, -50);
    const pCornerTo = await w2s(cdp, 0, -62);
    await mouseDrag(cdp, pCorner, pCornerTo, { steps: 16, settle: 260 });
    snap = await readDoc(cdp); an = analyzeDoc(snap.doc);
    summarize('A7b after dragging free corner (0,-50)->(0,-62)', snap, an);
    const shotA7 = await captureWorld(cdp, 'partA-02-drag-corner.png', -20, -72, 102, 22, 45);
    console.log('  shot:', shotA7.rel, shotA7.md5);

    // ── A8a: Click Dim immediately after corner drag (pre-selected corner silently cancels 1st click!) ──
    await pressTool(cdp, 'tool-dim');
    const pLeftMid = await w2s(cdp, 0, -30);
    await mouseClick(cdp, pLeftMid.x, pLeftMid.y);
    const pLeftOff = await w2s(cdp, -14, -30);
    await mouseClick(cdp, pLeftOff.x, pLeftOff.y);
    await typeText(cdp, '50');
    await keyEnter(cdp);
    snap = await readDoc(cdp); an = analyzeDoc(snap.doc);
    const dim50FirstTry = an.dims.some((d) => Math.abs(d.value - 50) < 0.01);
    summarize(`A8a Dim right after corner drag (dim50Created=${dim50FirstTry})`, snap, an);

    // ── A8b: Click left edge again to place overall height = 50 ──
    if (!dim50FirstTry) {
      await mouseClick(cdp, pLeftMid.x, pLeftMid.y);
      await mouseClick(cdp, pLeftOff.x, pLeftOff.y);
      await typeText(cdp, '50');
      await keyEnter(cdp);
    }
    await keyEsc(cdp);
    snap = await readDoc(cdp); an = analyzeDoc(snap.doc);
    summarize('A8b after overall height 50 dim', snap, an);
    const shotA8 = await captureWorld(cdp, 'partA-03-outline-constrained.png', -25, -65, 102, 34, 40);
    console.log('  shot:', shotA8.rel, shotA8.md5);

    // ── A9: Fillet the 5 outer corners R5 ──
    await pressTool(cdp, 'tool-fillet');
    for (const [, cx, cy] of [
      ['top-left', 0, -50],
      ['top-mid', 50, -50],
      ['mid-right', 80, -30],
      ['bot-right', 80, 0],
      ['origin', 0, 0],
    ]) {
      const sp = await w2s(cdp, cx, cy);
      await mouseClick(cdp, sp.x, sp.y, { settle: 220 });
      await ctrlA(cdp);
      await typeText(cdp, '5');
      await keyEnter(cdp);
      await sleep(220);
    }
    // ── A10: Fillet inner notch corner (50,-30) R3 ──
    const pInner = await w2s(cdp, 50, -30);
    await mouseClick(cdp, pInner.x, pInner.y, { settle: 220 });
    await ctrlA(cdp);
    await typeText(cdp, '3');
    await keyEnter(cdp);
    await keyEsc(cdp);
    snap = await readDoc(cdp); an = analyzeDoc(snap.doc);
    summarize('A10 after all 6 fillets (5x R5 outer + 1x R3 inner)', snap, an);
    const shotA10 = await captureWorld(cdp, 'partA-05-all-fillets.png', -25, -65, 102, 34, 40);
    console.log('  shot:', shotA10.rel, shotA10.md5);

    // ── A10b PROBE: Test 80 -> 100 on the bare 6-fillet L-bracket (BEFORE holes/slot) to isolate root cause! ──
    const lbl80Bare = await findDimLabelOnScreen(cdp, (l) => /^80(\.0+)?$/.test(l.text));
    let bare80To100Val = null;
    if (lbl80Bare) {
      await mouseDblClick(cdp, lbl80Bare.x, lbl80Bare.y);
      await ctrlA(cdp);
      await typeText(cdp, '100');
      await keyEnter(cdp);
      await sleep(320);
      snap = await readDoc(cdp); an = analyzeDoc(snap.doc);
      bare80To100Val = an.dims.find((d) => d.name === 'd1')?.value ?? null;
      summarize('A10b PROBE 80 -> 100 on bare 6-fillet L-bracket', snap, an);
      if (Math.abs((bare80To100Val || 0) - 100) < 0.01) {
        await ctrlZ(cdp);
        await sleep(250);
      }
    }

    // ── A11a/b: Hole 1 Ø6 — PROBE Point->Line & Line->Point on filleted edge (both refuse with conflicts with distance!) ──
    await pressTool(cdp, 'tool-circle');
    const pH1 = await w2s(cdp, 13, -12);
    await mouseClick(cdp, pH1.x, pH1.y);
    await typeText(cdp, '6');
    await keyEnter(cdp);
    await keyEsc(cdp);

    // Probe 1: Hole 1 center -> filleted left edge = 10
    await pressTool(cdp, 'tool-dim');
    snap = await readDoc(cdp); an = analyzeDoc(snap.doc);
    let h1 = an.shapes.find((s) => s.type === 'circle');
    let pH1c = await w2s(cdp, h1.pts[0][0], h1.pts[0][1]);
    const pLeftEdge = await w2s(cdp, 0, -25);
    await mouseClick(cdp, pH1c.x, pH1c.y);
    await mouseClick(cdp, pLeftEdge.x, pLeftEdge.y);
    const pOff1 = await w2s(cdp, 5, -22);
    await mouseClick(cdp, pOff1.x, pOff1.y);
    await typeText(cdp, '10');
    await keyEnter(cdp);
    await keyEsc(cdp);
    snap = await readDoc(cdp); an = analyzeDoc(snap.doc);
    summarize('A11a PROBE Point->Line (Hole1 -> filleted left edge = 10)', snap, an);
    const a11aToast = snap.toasts.find((t) => t.includes('10 mm')) || '';
    const a11aDistVal = an.dims.find((d) => d.name === 'd12')?.value ?? null;
    const shotA11Refusal = await captureWorld(cdp, 'partA-06a-hole-edge-conflict.png', -25, -65, 102, 34, 40);
    console.log('  shot:', shotA11Refusal.rel, shotA11Refusal.md5);
    await ctrlZ(cdp); // undo stuck 13.061 dim
    await sleep(220);

    // Probe 2: Origin -> Hole 1 (H=10), then Origin -> Hole 1 (V) -> observe 2nd orthogonal point-to-point dim auto-born as [ref]!
    await pressTool(cdp, 'tool-dim');
    snap = await readDoc(cdp); an = analyzeDoc(snap.doc);
    h1 = an.shapes.find((s) => s.type === 'circle');
    pH1c = await w2s(cdp, h1.pts[0][0], h1.pts[0][1]);
    await mouseClick(cdp, pOrigin.x, pOrigin.y);
    await mouseClick(cdp, pH1c.x, pH1c.y);
    const pOffH1x = await w2s(cdp, 5, -22);
    await mouseClick(cdp, pOffH1x.x, pOffH1x.y);
    await typeText(cdp, '10');
    await keyEnter(cdp);
    // 2nd dim on SAME pair (Origin -> Hole 1) placed vertically -> born [ref]!
    snap = await readDoc(cdp); an = analyzeDoc(snap.doc);
    h1 = an.shapes.find((s) => s.type === 'circle');
    pH1c = await w2s(cdp, h1.pts[0][0], h1.pts[0][1]);
    await mouseClick(cdp, pOrigin.x, pOrigin.y);
    await mouseClick(cdp, pH1c.x, pH1c.y);
    const pOffH1y = await w2s(cdp, 22, -6);
    await mouseClick(cdp, pOffH1y.x, pOffH1y.y);
    await keyEsc(cdp);
    snap = await readDoc(cdp); an = analyzeDoc(snap.doc);
    const a11bRef = !!(an.dims.find((d) => d.name === 'd13')?.driven);
    const a11bNullity = an.nullity;
    summarize('A11b PROBE 2nd orthogonal dim on Origin->Hole1 (born [ref] on free Y!)', snap, an);
    await ctrlZ(cdp); // undo bogus ref dim d13
    await sleep(220);

    // Workaround for Hole 1 Y = 10: dimension Hole 1 center to X-axis (at (-10, 0), clear of the filleted bottom edge!)
    await pressTool(cdp, 'tool-dim');
    snap = await readDoc(cdp); an = analyzeDoc(snap.doc);
    h1 = an.shapes.find((s) => s.type === 'circle');
    pH1c = await w2s(cdp, h1.pts[0][0], h1.pts[0][1]);
    const pXAxis = await w2s(cdp, -10, 0);
    await mouseClick(cdp, pH1c.x, pH1c.y);
    await mouseClick(cdp, pXAxis.x, pXAxis.y);
    const pOffH1yAxis = await w2s(cdp, 22, -5);
    await mouseClick(cdp, pOffH1yAxis.x, pOffH1yAxis.y);
    await typeText(cdp, '10');
    await keyEnter(cdp);
    await keyEsc(cdp);
    snap = await readDoc(cdp); an = analyzeDoc(snap.doc);
    summarize('A11c after Hole 1 positioned at (10, -10) via Origin X + X-axis Y', snap, an);

    // ── A12: Hole 2 Ø6 at (70, -20) — X=10 from virtual sharp (80,-30) + Y=10 below notch via (80,0) or X-axis = 20 ──
    await pressTool(cdp, 'tool-circle');
    const pH2 = await w2s(cdp, 68, -18);
    await mouseClick(cdp, pH2.x, pH2.y);
    await typeText(cdp, '6');
    await keyEnter(cdp);
    await keyEsc(cdp);
    snap = await readDoc(cdp); an = analyzeDoc(snap.doc);
    let h2 = an.shapes.filter((s) => s.type === 'circle').pop();

    // Dimension Hole 2 X = 10 from virtual sharp (80, -30) (H mode: place label above at (74, -36))
    // and Y = 10 from virtual sharp (50, -30) (V mode: DIFFERENT corner joint so it avoids the same-pair ref bug, AND tracks notch lower edge!)
    const pVS_80_30 = await w2s(cdp, 80, -30);
    const pVS_50_30 = await w2s(cdp, 50, -30);
    await pressTool(cdp, 'tool-dim');
    let pH2c = await w2s(cdp, h2.pts[0][0], h2.pts[0][1]);
    await mouseClick(cdp, pVS_80_30.x, pVS_80_30.y);
    await mouseClick(cdp, pH2c.x, pH2c.y);
    const pOffH2x = await w2s(cdp, 74, -36);
    await mouseClick(cdp, pOffH2x.x, pOffH2x.y);
    await typeText(cdp, '10');
    await keyEnter(cdp);

    snap = await readDoc(cdp); an = analyzeDoc(snap.doc);
    h2 = an.shapes.filter((s) => s.type === 'circle').pop();
    pH2c = await w2s(cdp, h2.pts[0][0], h2.pts[0][1]);
    await mouseClick(cdp, pVS_50_30.x, pVS_50_30.y);
    await mouseClick(cdp, pH2c.x, pH2c.y);
    const pOffH2y = await w2s(cdp, 88, -24);
    await mouseClick(cdp, pOffH2y.x, pOffH2y.y);
    await typeText(cdp, '10');
    await keyEnter(cdp);
    await keyEsc(cdp);
    snap = await readDoc(cdp); an = analyzeDoc(snap.doc);
    summarize('A12 after Hole 2 positioned at (70, -20)', snap, an);
    const a12d16Ref = !!(an.dims.find((d) => d.name === 'd16')?.driven);
    const slotHorizBefore = an.constraintTypes.horizontal || 0;
    console.log('  A12 circles:', JSON.stringify(an.shapes.filter((s) => s.type === 'circle')));
    console.log('  A12 d15/d16 raw:', JSON.stringify((snap.doc.geometry.constraints || []).filter((c) => c.name === 'd15' || c.name === 'd16')));

    // ── A13: Horizontal Slot 20x6 centred on long leg's midline (x=40, y=-15) ──
    await pressTool(cdp, 'tool-slot');
    const pS1 = await w2s(cdp, 30, -15);
    await mouseClick(cdp, pS1.x, pS1.y);
    const pS2 = await w2s(cdp, 50, -15);
    await mouseMove(cdp, pS2.x, pS2.y);
    await typeText(cdp, '20');
    await keyEnter(cdp);
    const pSw = await w2s(cdp, 50, -18);
    await mouseMove(cdp, pSw.x, pSw.y);
    await typeText(cdp, '6');
    await keyEnter(cdp);
    await keyEsc(cdp);

    // Add Horizontal constraint to slot centerline (Slot tool dropped H inference on typed span!)
    snap = await readDoc(cdp); an = analyzeDoc(snap.doc);
    const slotHorizAfterDraw = an.constraintTypes.horizontal || 0;
    const scl0 = an.shapes.find((s) => s.type === 'line' && s.constr);
    if (scl0) {
      await pressTool(cdp, 'tool-hv');
      const pScl = await w2s(cdp, (scl0.pts[0][0] + scl0.pts[1][0]) / 2, (scl0.pts[0][1] + scl0.pts[1][1]) / 2);
      await mouseClick(cdp, pScl.x, pScl.y);
      await keyEsc(cdp);
    }

    // Position slot: Y = 15 from X-axis (midline of 30mm leg) AND X = (d1 - 20) / 2 from Origin (so 80 -> 100 keeps slot centered!)
    snap = await readDoc(cdp); an = analyzeDoc(snap.doc);
    const widthDim = an.dims.find((d) => Math.abs(d.value - 80) < 0.01);
    const widthName = widthDim?.name || 'd1';
    const scl1 = an.shapes.find((s) => s.type === 'line' && s.constr);
    if (scl1) {
      const leftPt = scl1.pts[0][0] <= scl1.pts[1][0] ? scl1.pts[0] : scl1.pts[1];
      await pressTool(cdp, 'tool-dim');
      // 1) Slot left center -> X-axis = 15
      let pSl = await w2s(cdp, leftPt[0], leftPt[1]);
      await mouseClick(cdp, pSl.x, pSl.y);
      await mouseClick(cdp, pXAxis.x, pXAxis.y);
      const pOffV = await w2s(cdp, 25, -7);
      await mouseClick(cdp, pOffV.x, pOffV.y);
      await typeText(cdp, '15');
      await keyEnter(cdp);

      // 2) Slot left center -> Y-axis = (d1 - 20) / 2
      snap = await readDoc(cdp); an = analyzeDoc(snap.doc);
      const scl2 = an.shapes.find((s) => s.type === 'line' && s.constr);
      const leftPt2 = scl2.pts[0][0] <= scl2.pts[1][0] ? scl2.pts[0] : scl2.pts[1];
      pSl = await w2s(cdp, leftPt2[0], leftPt2[1]);
      const pYAxis = await w2s(cdp, 0, -58);
      await mouseClick(cdp, pSl.x, pSl.y);
      await mouseClick(cdp, pYAxis.x, pYAxis.y);
      const pOffH = await w2s(cdp, 15, -38);
      await mouseClick(cdp, pOffH.x, pOffH.y);
      await typeText(cdp, `(${widthName} - 20) / 2`);
      await keyEnter(cdp);
      await keyEsc(cdp);
    }
    snap = await readDoc(cdp); an = analyzeDoc(snap.doc);
    summarize('A13 COMPLETE Part A — check fully constrained!', snap, an);
    console.log('  A13 circles:', JSON.stringify(an.shapes.filter((s) => s.type === 'circle')));
    console.log('  A13 slot CL:', JSON.stringify(an.shapes.find((s) => s.constr)));
    const shotA13 = await captureWorld(cdp, 'partA-07-full-constrained.png', -25, -65, 105, 38, 40);
    console.log('  shot:', shotA13.rel, shotA13.md5);

    // ── A14: Change-your-mind #2 — Change REAL 80 dimension label -> 100! ──
    const lbl80 = await findDimLabelOnScreen(cdp, (l) => /^80(\.0+)?$/.test(l.text));
    console.log('[A14] REAL 80 dim label:', JSON.stringify(lbl80));
    if (lbl80) {
      await mouseDblClick(cdp, lbl80.x, lbl80.y);
      await ctrlA(cdp);
      await typeText(cdp, '100');
      await keyEnter(cdp);
      await sleep(350);
    }
    snap = await readDoc(cdp); an = analyzeDoc(snap.doc);
    summarize('A14 after changing 80 -> 100', snap, an);
    const a14Val = an.dims.find((d) => d.name === 'd1')?.value ?? null;
    const a14Toast = snap.toasts.find((t) => t.includes('100 mm')) || '';
    console.log('  A14 lines:', JSON.stringify(an.shapes.filter((s) => s.type === 'line').map((s) => ({ id: s.id, constr: s.constr, pts: s.pts }))));
    console.log('  A14 circles:', JSON.stringify(an.shapes.filter((s) => s.type === 'circle')));
    console.log('  A14 arcs:', JSON.stringify(an.shapes.filter((s) => s.type === 'arc').map((s) => ({ id: s.id, pts: s.pts }))));
    const shotA14 = await captureWorld(cdp, 'partA-08-after-80-to-100.png', -25, -65, 118, 38, 40);
    console.log('  shot:', shotA14.rel, shotA14.md5);

    // ── A15a: Observe virtual-sharp steal when clicking R5 fillet arc at normal view ──
    const topLeftArc = an.shapes.find((s) => s.type === 'arc' && s.pts[0][0] < 15 && s.pts[0][1] < -35);
    let a15aArcSurvived = null, a15aDimsLost = [];
    if (topLeftArc) {
      const dimsBeforeA15a = new Set(an.dims.map((d) => d.name));
      const [acx, acy] = topLeftArc.pts[0];
      const pArcMidNormal = await w2s(cdp, acx - 3.535, acy - 3.535);
      await mouseClick(cdp, pArcMidNormal.x, pArcMidNormal.y);
      await keyDelete(cdp);
      snap = await readDoc(cdp); an = analyzeDoc(snap.doc);
      a15aArcSurvived = an.shapes.some((s) => s.id === topLeftArc.id);
      const dimsAfterA15a = new Set(an.dims.map((d) => d.name));
      a15aDimsLost = [...dimsBeforeA15a].filter((n) => !dimsAfterA15a.has(n));
      summarize('A15a PROBE click R5 fillet arc at normal view + Delete (hits virtual sharp!)', snap, an);
      await ctrlZ(cdp);
      await sleep(250);
    }

    // ── A15b: Zoom in on top-left R5 fillet arc, TRULY delete arc, then try to re-add it! ──
    await frameWorldBox(cdp, -5, -56, 18, -36);
    snap = await readDoc(cdp); an = analyzeDoc(snap.doc);
    const tlArcZoom = an.shapes.find((s) => s.type === 'arc' && s.pts[0][0] < 15 && s.pts[0][1] < -35);
    let a15cInputOpen = null, a15cToolAfter1Esc = null, a15cToast = '';
    if (tlArcZoom) {
      const [acx, acy] = tlArcZoom.pts[0];
      const pArcMidZoom = await w2s(cdp, acx - 3.535, acy - 3.535);
      await mouseClick(cdp, pArcMidZoom.x, pArcMidZoom.y);
      await keyDelete(cdp);
      snap = await readDoc(cdp); an = analyzeDoc(snap.doc);
      summarize('A15b after TRULY deleting top-left R5 fillet arc (zoomed in)', snap, an);
      const shotA15b = await captureWorld(cdp, 'partA-09a-fillet-truly-deleted.png', -6, -56, 18, -36, 30);
      console.log('  shot:', shotA15b.rel, shotA15b.md5);

      await pressTool(cdp, 'tool-fillet');
      const pL = await w2s(cdp, 0, -40);
      const pT = await w2s(cdp, 12, -50);
      await mouseClick(cdp, pL.x, pL.y, { settle: 200 });
      await mouseClick(cdp, pT.x, pT.y, { settle: 240 });
      a15cInputOpen = await cdp.evalJs(`!!document.getElementById('fillet-radius-input')`);
      console.log('  [A15c] fillet input opened on disconnected lines after delete?:', a15cInputOpen);
      if (a15cInputOpen) {
        await ctrlA(cdp);
        await typeText(cdp, '5');
        await keyEnter(cdp);
      }
      await keyEsc(cdp);
      snap = await readDoc(cdp); an = analyzeDoc(snap.doc);
      a15cToolAfter1Esc = snap.activeTool;
      a15cToast = snap.toasts.find((t) => t.includes('corner to fillet')) || '';
      summarize('A15c after trying to re-add R5 fillet + 1st Esc', snap, an);
      console.log('  [A15c] activeTool after 1st Esc (still tool-fillet?):', a15cToolAfter1Esc);
      const shotA15c = await captureWorld(cdp, 'partA-09b-fillet-readd-attempt.png', -6, -56, 18, -36, 30);
      console.log('  shot:', shotA15c.rel, shotA15c.md5);
      // 2nd Esc to actually exit Fillet tool -> Select
      if (a15cToolAfter1Esc !== 'tool-select') {
        await keyEsc(cdp);
        await sleep(160);
      }

      // Restore the deleted fillet via Ctrl+Z so A16 tests moving Hole 1 on the intact bracket
      await ctrlZ(cdp);
      await sleep(250);
    }

    // ── A16: Zoom back out & Move Hole 1 by editing its X=10 dim -> 15 (now in tool-select!) ──
    await frameWorldBox(cdp, -22, -68, 118, 38);
    const pH1xHint = await w2s(cdp, 5, -22);
    const h1xLbl = await cdp.evalJs(`(() => {
      const list = [...document.querySelectorAll('#svgCanvas g.dim-label text')]
        .map((t) => { const r = t.getBoundingClientRect(); return { text: t.textContent.trim(), x: r.left + r.width/2, y: r.top + r.height/2 }; })
        .filter((l) => /^10(\\.0+)?$/.test(l.text));
      list.sort((a, b) => Math.hypot(a.x - ${pH1xHint.x}, a.y - ${pH1xHint.y}) - Math.hypot(b.x - ${pH1xHint.x}, b.y - ${pH1xHint.y}));
      return list[0] || null;
    })()`);
    console.log('[A16] Hole 1 X=10 label:', JSON.stringify(h1xLbl));
    if (h1xLbl) {
      await mouseDblClick(cdp, h1xLbl.x, h1xLbl.y);
      await ctrlA(cdp);
      await typeText(cdp, '15');
      await keyEnter(cdp);
      await sleep(280);
    }
    snap = await readDoc(cdp); an = analyzeDoc(snap.doc);
    const a16Val = an.dims.find((d) => d.name === 'd12')?.value ?? null;
    const a16Toast = snap.toasts.find((t) => t.includes('15 mm')) || '';
    summarize('A16 after moving Hole 1 X dim 10 -> 15', snap, an);
    console.log('  A16 circles:', JSON.stringify(an.shapes.filter((s) => s.type === 'circle')));
    const shotA16 = await captureWorld(cdp, 'partA-10-hole-moved.png', -25, -65, 118, 38, 40);
    console.log('  shot:', shotA16.rel, shotA16.md5);

    // ── A17: Undo (Ctrl+Z) back to empty & Redo (Ctrl+Y) forward again ──
    const preUndoAn = an;
    const pEmpty = await w2s(cdp, 112, 18);
    await mouseClick(cdp, pEmpty.x, pEmpty.y, { settle: 120 });
    let undoSteps = 0;
    for (let i = 0; i < 120; i++) {
      const sNow = await readDoc(cdp);
      if (sNow.undoDisabled) break;
      await ctrlZ(cdp);
      undoSteps++;
    }
    const afterUndoSnap = await readDoc(cdp);
    const afterUndoAn = analyzeDoc(afterUndoSnap.doc);
    summarize(`A17a after ${undoSteps} Ctrl+Z`, afterUndoSnap, afterUndoAn);

    let redoSteps = 0;
    for (let i = 0; i < undoSteps; i++) {
      const sNow = await readDoc(cdp);
      if (sNow.redoDisabled) break;
      await ctrlY(cdp);
      redoSteps++;
    }
    const afterRedoSnap = await readDoc(cdp);
    const afterRedoAn = analyzeDoc(afterRedoSnap.doc);
    summarize(`A17b after ${redoSteps} Ctrl+Y`, afterRedoSnap, afterRedoAn);
    const dimsMatchUR = JSON.stringify(preUndoAn.dims.map((d) => [d.name, d.value, d.expr])) === JSON.stringify(afterRedoAn.dims.map((d) => [d.name, d.value, d.expr]));
    console.log('  undo/redo diff shapes:', preUndoAn.shapesCount, '->', afterUndoAn.shapesCount, '->', afterRedoAn.shapesCount,
      'cons:', preUndoAn.constraintsCount, '->', afterUndoAn.constraintsCount, '->', afterRedoAn.constraintsCount, 'dimsMatch:', dimsMatchUR);

    // ── A18: Save (Ctrl+S), reload page, close tab & reopen — verify persistence ──
    const preSaveDoc = afterRedoSnap.doc;
    const preSaveAn = afterRedoAn;
    await ctrlS(cdp);
    await sleep(350);
    await ctrlA(cdp);
    await typeText(cdp, 'Part A L-Bracket');
    await keyEnter(cdp);
    await sleep(500);
    await cdp.flushAutosave();

    await cdp.navigate(url, 15000);
    await cdp.waitForApp('svgCanvas');
    await sleep(500);
    const postReloadSnap = await readDoc(cdp);
    const postReloadAn = analyzeDoc(postReloadSnap.doc);
    summarize('A18a after Save + Reload', postReloadSnap, postReloadAn);
    const droppedOnReload = [];
    if (preSaveAn.constraintsCount !== postReloadAn.constraintsCount) {
      const preCs = preSaveDoc.geometry.constraints;
      const postCs = postReloadSnap.doc.geometry.constraints;
      const preJointIds = new Set(preSaveDoc.geometry.joints.map(([id]) => id));
      const postJointIds = new Set(postReloadSnap.doc.geometry.joints.map(([id]) => id));
      console.log('  LOST CONSTRAINTS DIFF pre:', preCs.length, 'post:', postCs.length);
      const postKeys = new Set(postCs.map((c) => JSON.stringify([c.type, c.joint, c.shape, c.joints, c.shapes, c.value])));
      for (const c of preCs) {
        const k = JSON.stringify([c.type, c.joint, c.shape, c.joints, c.shapes, c.value]);
        if (!postKeys.has(k)) {
          droppedOnReload.push({ type: c.type, joint: c.joint, shape: c.shape, jointInPre: preJointIds.has(c.joint) });
          console.log('   DROPPED ON RELOAD:', JSON.stringify(c), 'jointInPre:', preJointIds.has(c.joint), 'jointInPost:', postJointIds.has(c.joint));
        }
      }
    }
    const shotA18 = await captureClip(cdp, 'partA-12-after-reload.png', { x: 250, y: 110, width: 960, height: 640 });
    console.log('  shot:', shotA18.rel, shotA18.md5);

    const reopenRes = await reopenSavedDesign(cdp, 'Part A L-Bracket');
    const postReopenSnap = await readDoc(cdp);
    const postReopenAn = analyzeDoc(postReopenSnap.doc);
    const reopenMatches = reopenRes.opened && postReloadAn.shapesCount === postReopenAn.shapesCount && postReloadAn.constraintsCount === postReopenAn.constraintsCount &&
      JSON.stringify(postReloadAn.dims.map((d) => [d.name, d.value, d.expr])) === JSON.stringify(postReopenAn.dims.map((d) => [d.name, d.value, d.expr]));
    console.log('[A18b] reopenSavedDesign:', JSON.stringify(reopenRes), 'shapes:', postReopenAn.shapesCount, 'cons:', postReopenAn.constraintsCount, 'matchesReload:', reopenMatches);

    // ── Standardized ROW summary lines (Part A: R1-01..R1-11) ──
    console.log('\n--- PART A AUDIT ROWS ---');
    row('R1-01', 'Part A / A11a,A11c,A13', a11aToast ? 'BUG' : 'OK',
      `point-to-line from sized circle/slot to fixed edge/axis refused (d12 stayed ${a11aDistVal?.toFixed(2)}, toast=${JSON.stringify(a11aToast)})`);
    row('R1-02', 'Part A / A10b,A14', (bare80To100Val === 80 && a14Val === 80) ? 'BUG' : 'OK',
      `editing width d1 80->100 on filleted L-bracket refused (bare=${bare80To100Val}, full=${a14Val}, toast=${JSON.stringify(a14Toast)})`);
    row('R1-03', 'Part A / A16', a16Val === 10 ? 'BUG' : 'OK',
      `moving Hole 1 X dim d12 10->15 refused (d12=${a16Val}, toast=${JSON.stringify(a16Toast)})`);
    row('R1-04', 'Part A / A11b,A12', (a11bRef || a12d16Ref) ? 'BUG' : 'OK',
      `2nd orthogonal point-to-point dim born [ref] while Y free (A11b d13Ref=${a11bRef} nullity=${a11bNullity}; A12 d16Ref=${a12d16Ref})`);
    row('R1-05', 'Part A / A15b,A15c', a15cInputOpen === false ? 'BUG' : 'OK',
      `deleting fillet leaves 5x5 gap and Fillet refuses re-add (inputOpen=${a15cInputOpen}, toast=${JSON.stringify(a15cToast)})`);
    row('R1-06', 'Part A / A15a', (a15aArcSurvived && a15aDimsLost.length > 0) ? 'BUG' : 'OK',
      `clicking R5 fillet arc at normal desktop zoom hits virtual sharp; Delete removed ${JSON.stringify(a15aDimsLost)} while arc survived=${a15aArcSurvived}`);
    row('R1-07', 'Part A / A18a', droppedOnReload.length > 0 ? 'BUG' : 'OK',
      `Save+Reload dropped ${droppedOnReload.length} orphaned constraint(s): ${JSON.stringify(droppedOnReload)} (pre=${preSaveAn.constraintsCount} -> post=${postReloadAn.constraintsCount}, reopenMatches=${reopenMatches})`);
    row('R1-08', 'Part A / A13a', slotHorizAfterDraw === slotHorizBefore ? 'BUG' : 'OK',
      `Slot tool dropped Horizontal inference on typed span 20 Enter (horizontal count ${slotHorizBefore} -> ${slotHorizAfterDraw})`);
    row('R1-09', 'Part A / A15c', a15cToolAfter1Esc === 'tool-fillet' ? 'DIVERGENCE' : 'OK',
      `Fillet tool required 2 Esc presses to exit after failed corner pick (activeTool after 1st Esc=${a15cToolAfter1Esc})`);
    row('R1-10', 'Part A / A7b->A8a', !dim50FirstTry ? 'FRICTION' : 'OK',
      `activating Dimension right after corner drag left corner selected and silently cancelled 1st edge click (dim50FirstTry=${dim50FirstTry})`);
    row('R1-11', 'Part A / A6,A11-A13', d1Offset >= 25 ? 'FRICTION' : 'OK',
      `auto-placed dimension labels drift/overlap (d1 default offset=${d1Offset}mm; circle Ø6 leaders cross into slot/arc — see ${shotA13.rel})`);
    console.log('\n[NET] blocked remote URLs:', JSON.stringify(net.blocked()));
  } finally {
    await cdp.close();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
