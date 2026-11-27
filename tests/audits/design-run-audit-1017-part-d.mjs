// tests/audits/design-run-audit-1017-part-d.mjs — TASK 1017 (AUDIT ONLY, outside the gate)
// PART D: Frame gusset / triangle (mm) — real-UI live headless Chrome (1280x800) end-to-end audit.
// Run: node tests/audits/design-run-audit-1017-part-d.mjs
import { startStudio, row, f } from './design-run-audit-1017-kit.js';
import { sleep } from '../helpers/cdp-browser.js';

function summarize(st) {
  const lines = st.shapes.filter((s) => s.tag === 'line');
  const arcs = st.shapes.filter((s) => s.tag === 'path');
  const circles = st.shapes.filter((s) => s.tag === 'circle');
  const constr = st.shapes.filter((s) => s.construction);
  return `shapes=${st.shapes.length}(L:${lines.length},A:${arcs.length},C:${circles.length},constr:${constr.length}) joints=${st.jointCount} dof=${st.totalDof}(free:${st.freeCount},blue:${st.blueShapes},full:${st.fullyConstrained}) dims=${JSON.stringify(st.labels.map((l) => l.text))} tool=${st.activeTool} toasts=${JSON.stringify(st.toasts.map((t) => `[${t.level}] ${t.text}`))}`;
}

// Frame well clear of the top-left SKETCHES floating card so (0,-100) is always clickable
const studio = await startStudio({ tag: '1017-part-d', view: { cx: 45, cy: -50, vw: 310 } });
try {
  // ─── D-01: Fresh open ───
  await studio.openFresh();
  let st = await studio.readState();
  row('D-01', `fresh open: ${summarize(st)}`);

  // ─── D-02: Draw horizontal leg with `leg = 150` in the draw-time box ───
  await studio.clearToasts();
  await studio.clickTool('line');
  await studio.clickW(0, 0);
  await studio.moveW(130, 0);
  const stMidL1 = await studio.readState();
  await studio.typeText('leg = 150');
  await studio.pressKey('Enter');
  await studio.pressKey('Escape');
  st = await studio.readState();
  const leg1 = st.shapes.find((s) => s.tag === 'line');
  row('D-02', `draw-time "leg = 150": liveBox=${stMidL1.dimBoxOpen} -> leg1=${JSON.stringify(leg1 ? { id: leg1.id, x1: f(leg1.x1), y1: f(leg1.y1), x2: f(leg1.x2), y2: f(leg1.y2), len: f(leg1.len) } : null)} ${summarize(st)}`);

  // ─── D-03: Draw vertical leg with `leg * 2/3` as a formula in the draw-time box ───
  await studio.clearToasts();
  const ids2 = new Set(st.shapes.map((s) => s.id));
  await studio.clickTool('line');
  await studio.clickW(0, 0);
  await studio.moveW(0, -85);
  await studio.typeText('leg * 2/3');
  await studio.pressKey('Enter');
  await studio.pressKey('Escape');
  st = await studio.readState();
  const leg2 = st.shapes.find((s) => !ids2.has(s.id));
  row('D-03a.drawTimeNoHV', `draw-time "leg * 2/3": leg2=${JSON.stringify(leg2 ? { id: leg2.id, x1: f(leg2.x1), y1: f(leg2.y1), x2: f(leg2.x2), y2: f(leg2.y2), len: f(leg2.len) } : null)} ${summarize(st)}`);

  // Apply H/V constraints manually since draw-time Enter did not lock H/V on leg1/leg2!
  await studio.clickTool('hv');
  await studio.clickW(75, 0);
  await studio.clickW(0, -50);
  await studio.pressKey('Escape');
  st = await studio.readState();
  row('D-03b.afterManualHV', summarize(st));

  // ─── D-04: Draw hypotenuse (150,0) -> (0,-100) + Angle dimension on hypotenuse ───
  await studio.clearToasts();
  const ids3 = new Set(st.shapes.map((s) => s.id));
  await studio.clickTool('line');
  await studio.clickW(150, 0);
  await studio.moveW(0, -100);
  await studio.clickW(0, -100);
  await studio.pressKey('Escape');
  st = await studio.readState();
  const hyp = st.shapes.find((s) => !ids3.has(s.id));
  row('D-04a', `hypotenuse drawn: ${JSON.stringify(hyp ? { id: hyp.id, x1: f(hyp.x1), y1: f(hyp.y1), x2: f(hyp.x2), y2: f(hyp.y2), len: f(hyp.len) } : null)} ${summarize(st)}`);

  // Place Angle dimension between horizontal leg and hypotenuse
  await studio.clickTool('dim');
  await studio.clickW(90, 0);
  await studio.clickW(75, -50);
  await studio.moveW(112, -14);
  await studio.clickW(112, -14);
  const stAngDrop = await studio.readState();
  if (stAngDrop.dimBoxOpen) await studio.pressKey('Enter');
  await studio.pressKey('Escape');
  st = await studio.readState();
  row('D-04b', `hypotenuse angle dim: boxOpenedOnDrop=${stAngDrop.dimBoxOpen} ${summarize(st)}`);
  const capTri = await studio.captureWorld('part-d-04-triangle.png', -25, -120, 175, 25);
  row('D-04.img', `${capTri.rel} md5=${capTri.md5}`);

  // ─── D-05: 3-point arc relief at right-angle corner (0,0) ───
  await studio.clearToasts();
  const arcVariants = await studio.cdp.evalJs(`(() => {
    const btn = document.getElementById('tool-arc');
    const caret = btn && btn.parentElement ? btn.parentElement.querySelector('.sk-ribbon-caret, [data-variants]') : null;
    const allArcBtns = [...document.querySelectorAll('button')].filter(b => /arc/i.test(b.textContent + ' ' + b.title + ' ' + (b.id || ''))).map(b => ({ id: b.id, text: b.textContent.trim(), title: b.title }));
    return { hasArcBtn: !!btn, hasVariantCaret: !!caret, allArcBtns };
  })()`);
  row('D-05a.no3ptArc', JSON.stringify(arcVariants));

  // Workaround: Center-Start-End arc at (0,0), start (15,0), end (0,-15), R 15
  const ids5 = new Set(st.shapes.map((s) => s.id));
  await studio.clickTool('arc');
  await studio.clickW(0, 0);
  await studio.moveW(15, 0);
  await studio.clickW(15, 0);
  await studio.moveW(10, -10);
  await studio.moveW(0, -15);
  await studio.clickW(0, -15);
  await studio.pressKey('Escape');
  st = await studio.readState();
  const reliefArc = st.shapes.find((s) => !ids5.has(s.id));
  if (reliefArc) {
    const midArc = await studio.cdp.evalJs(`(() => {
      const p = document.querySelector('#svgCanvas path.shape-elem[data-shape-id="${reliefArc.id}"]');
      if (!p) return null;
      const q = p.getPointAtLength(p.getTotalLength() * 0.5);
      return { x: q.x, y: q.y };
    })()`);
    if (midArc) {
      await studio.clickTool('dim');
      await studio.clickW(midArc.x, midArc.y);
      await studio.moveW(26, -24);
      await studio.clickW(26, -24);
      await studio.typeText('15');
      await studio.pressKey('Enter');
      await studio.pressKey('Escape');
    }
  }
  const stBeforeCornerTrim = await studio.readState();
  row('D-05b.arcBeforeTrim', `reliefArc=${JSON.stringify(reliefArc)} ${summarize(stBeforeCornerTrim)}`);

  // Trim the corner stubs (6,0) and (0,-6) inside the relief arc -> observe Trim deleting the entire legs!
  await studio.clearToasts();
  await studio.clickTool('trim');
  await studio.clickW(6, 0);
  await studio.clickW(0, -6);
  await studio.pressKey('Escape');
  st = await studio.readState();
  row('D-05c.trimDeletesWholeLegs', summarize(st));
  const capRelief = await studio.captureWorld('part-d-05-relief-trim-bug.png', -25, -120, 175, 25);
  row('D-05.img', `${capRelief.rel} md5=${capRelief.md5}`);

  // Undo the 2 destructive corner trims so we keep the triangle + relief arc and continue Part D
  await studio.pressKey('z', { ctrl: true });
  await studio.pressKey('z', { ctrl: true });
  st = await studio.readState();
  row('D-05e.undoCornerTrim', summarize(st));

  // ─── D-06: Three holes Ø5 along hypotenuse: equal spacing, 15 from each end ───
  await studio.clearToasts();
  const h1 = { x: 150 - 15 * 0.8321, y: -15 * 0.5547 }; // (137.52, -8.32)
  const h3 = { x: 15 * 0.8321, y: -100 + 15 * 0.5547 }; // (12.48, -91.68)
  const h2 = { x: 75, y: -50 };

  // Turn Construction ON and draw 3 chained construction segments along hypotenuse: A -> H1 -> H3 -> B
  await studio.clickEl('.sk-construction-btn, button[aria-label*="Construction"]');
  const idsBeforeConstr = new Set(st.shapes.map((s) => s.id));
  await studio.clickTool('line');
  await studio.clickW(150, 0);
  await studio.moveW(h1.x, h1.y);
  await studio.clickW(h1.x, h1.y);
  await studio.moveW(h3.x, h3.y);
  await studio.clickW(h3.x, h3.y);
  await studio.moveW(0, -100);
  await studio.clickW(0, -100);
  await studio.pressKey('Escape');
  await studio.clickEl('.sk-construction-btn, button[aria-label*="Construction"]');
  st = await studio.readState();
  const cSegs = st.shapes.filter((s) => !idsBeforeConstr.has(s.id));
  row('D-06a.constrSegs', `created=${cSegs.length} segs=${JSON.stringify(cSegs.map((s) => ({ id: s.id, constr: s.construction, x1: f(s.x1), y1: f(s.y1), x2: f(s.x2), y2: f(s.y2), len: f(s.len) })))}`);

  if (cSegs.length >= 3) {
    const s1 = cSegs[0], s2 = cSegs[1], s3 = cSegs[2];
    const m1 = { x: (s1.x1 + s1.x2) / 2, y: (s1.y1 + s1.y2) / 2 };
    const m3 = { x: (s3.x1 + s3.x2) / 2, y: (s3.y1 + s3.y2) / 2 };

    // Constrain seg1 = 15 (dimensioning the 2 endpoints of seg1 so we don't hit hypotenuse underneath!)
    await studio.clickTool('dim');
    await studio.clickW(s1.x1, s1.y1);
    await studio.clickW(s1.x2, s1.y2);
    await studio.moveW(m1.x + 18, m1.y - 18);
    await studio.clickW(m1.x + 18, m1.y - 18);
    await studio.typeText('15');
    await studio.pressKey('Enter');
    await studio.pressKey('Escape');

    // Equal on seg1 and seg3 (note: overlapping solid hypotenuse steals both clicks -> "Pick a second curve, a different one.")
    await studio.clearToasts();
    await studio.clickTool('equal');
    await studio.clickW(m1.x, m1.y);
    await studio.clickW(m3.x, m3.y);
    await studio.pressKey('Escape');
    const stEqSeg = await studio.readState();
    row('D-06b.overlapEqualBug', summarize(stEqSeg));

    // Workaround for overlapping construction line: dimension seg3 endpoints = 15 (or equal via endpoints) so H3 is 15mm from top vertex!
    await studio.clearToasts();
    await studio.clickTool('dim');
    await studio.clickW(s3.x1, s3.y1);
    await studio.clickW(s3.x2, s3.y2);
    await studio.moveW(m3.x + 18, m3.y - 18);
    await studio.clickW(m3.x + 18, m3.y - 18);
    await studio.typeText('15');
    await studio.pressKey('Enter');
    await studio.pressKey('Escape');

    // Draw 3 circles: C1 at H1 with draw-time diameter `5`, C2 at midpoint H2, C3 at H3
    st = await studio.readState();
    const idsBeforeCircs = new Set(st.shapes.map((s) => s.id));
    await studio.clickTool('circle');
    await studio.clickW(s1.x2, s1.y2);
    await studio.moveW(s1.x2 + 6, s1.y2);
    await studio.typeText('5');
    await studio.pressKey('Enter');

    await studio.clickW(h2.x, h2.y);
    await studio.moveW(h2.x + 5, h2.y);
    await studio.clickW(h2.x + 5, h2.y);

    await studio.clickW(s3.x1, s3.y1);
    await studio.moveW(s3.x1 + 5, s3.y1);
    await studio.clickW(s3.x1 + 5, s3.y1);
    await studio.pressKey('Escape');

    st = await studio.readState();
    const circs = st.shapes.filter((s) => !idsBeforeCircs.has(s.id) && s.tag === 'circle');
    row('D-06c.circlesDrawn', `count=${circs.length} circles=${JSON.stringify(circs.map((c) => ({ id: c.id, cx: f(c.cx), cy: f(c.cy), r: f(c.r) })))} ${summarize(st)}`);

    if (circs.length === 3) {
      // First try Equal C1=C2 at overview zoom (vw~310, where C1 r=2.5mm is ~10px < 15px joint radius!)
      await studio.clearToasts();
      await studio.clickTool('equal');
      await studio.clickW(circs[0].cx, circs[0].cy - circs[0].r);
      await studio.clickW(circs[1].cx, circs[1].cy - circs[1].r);
      await studio.pressKey('Escape');
      const stEqSmallZoom = await studio.readState();
      const c2AfterZoomBug = stEqSmallZoom.shapes.find((s) => s.id === circs[1].id);
      row('D-06c.smallCircleRimBug', `at vw~310 Equal(C1 r=2.5, C2): C2.r=${f(c2AfterZoomBug?.r)} (expected 2.5) toasts=${JSON.stringify(stEqSmallZoom.toasts)}`);

      // Now zoom in so r=2.5mm rims are ~25px (>15px joint priority) while keeping both circles inside the canvas
      await studio.setView(105, -28, 130);
      await studio.clearToasts();
      await studio.clickTool('equal');
      await studio.clickW(circs[0].cx, circs[0].cy - circs[0].r);
      await studio.clickW(circs[1].cx, circs[1].cy - circs[1].r);
      await studio.setView(44, -70, 130);
      await studio.clickW(circs[1].cx, circs[1].cy + 2.5);
      await studio.clickW(circs[2].cx, circs[2].cy + circs[2].r);
      await studio.pressKey('Escape');
      await studio.setView(45, -50, 310);

      // Ensure C2 center is Midpoint of hypotenuse (already snapped during draw? check!)
      const stMidCheck = await studio.readState();
      if (stMidCheck.totalDof > 0) {
        await studio.clearToasts();
        await studio.clickTool('midpoint');
        await studio.clickW(circs[1].cx, circs[1].cy);
        await studio.clickW(h2.x + 18 * 0.832, h2.y + 18 * 0.555);
        await studio.pressKey('Escape');
      }
    }
  }
  st = await studio.readState();
  const holes6 = st.shapes.filter((s) => s.tag === 'circle');
  row('D-06d.holesComplete', `holes=${JSON.stringify(holes6.map((c) => ({ id: c.id, cx: f(c.cx), cy: f(c.cy), d: f(c.r * 2) })))} ${summarize(st)}`);
  row('D-06.freeJoints', JSON.stringify(st.joints.filter((j) => j.dof > 0)));
  const capHoles = await studio.captureWorld('part-d-06-holes.png', -25, -120, 175, 25);
  row('D-06.img', `${capHoles.rel} md5=${capHoles.md5}`);

  // ─── D-07: Change `leg` in the Parameters window (150 -> 180) ───
  await studio.clearToasts();
  await studio.clickEl('#btn-parameters');
  await sleep(250);
  const pwinInfo = await studio.cdp.evalJs(`(() => {
    const win = document.querySelector('.sk-pwin');
    if (!win) return null;
    const rows = [...win.querySelectorAll('tbody tr')].map((tr) => {
      const inputs = [...tr.querySelectorAll('input')].map((i) => i.value);
      const cells = [...tr.querySelectorAll('td')].map((td) => td.textContent.trim());
      return { inputs, cells };
    });
    const refBadge = win.querySelector('.sk-pt-ref, [class*="ref"]');
    const rb = refBadge ? refBadge.getBoundingClientRect() : null;
    return { open: getComputedStyle(win).display !== 'none', rows, refBadge: rb ? { text: refBadge.textContent.trim(), w: Math.round(rb.width), h: Math.round(rb.height) } : null };
  })()`);
  row('D-07a.paramsOpen', JSON.stringify(pwinInfo));
  const capParams = await studio.capture('part-d-07a-params-window.png');
  row('D-07a.img', `${capParams.rel} md5=${capParams.md5}`);

  // Find the Expression <input> in the row whose Name <input> has value === 'leg'
  const legExprPos = await studio.cdp.evalJs(`(() => {
    const win = document.querySelector('.sk-pwin');
    if (!win) return null;
    for (const tr of win.querySelectorAll('tbody tr')) {
      const inps = [...tr.querySelectorAll('input')];
      if (inps.length >= 2 && inps[0].value.trim() === 'leg') {
        const r = inps[1].getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2, val: inps[1].value };
      }
    }
    return null;
  })()`);
  row('D-07b.legExprInput', JSON.stringify(legExprPos));
  if (legExprPos) {
    await studio.clickScreen(legExprPos.x, legExprPos.y);
    await studio.pressKey('a', { ctrl: true });
    await studio.typeText('180');
    await studio.pressKey('Enter');
    await sleep(350);
  }
  const pwinAfter = await studio.cdp.evalJs(`(() => {
    const win = document.querySelector('.sk-pwin');
    if (!win) return null;
    return [...win.querySelectorAll('tbody tr')].map((tr) => ({
      inputs: [...tr.querySelectorAll('input')].map((i) => i.value),
      cells: [...tr.querySelectorAll('td')].map((td) => td.textContent.trim()),
    }));
  })()`);
  await studio.clickEl('#btn-parameters');
  await sleep(150);
  await studio.setView(70, -40, 360);
  st = await studio.readState();
  const holesAfterParam = st.shapes.filter((s) => s.tag === 'circle');
  const leg1After = st.shapes.find((s) => s.id === leg1?.id);
  const leg2After = st.shapes.find((s) => s.id === leg2?.id);
  row('D-07c.afterParamEdit', `leg1Len=${f(leg1After?.len)} leg2Len=${f(leg2After?.len)} holes=${JSON.stringify(holesAfterParam.map((c) => ({ cx: f(c.cx), cy: f(c.cy), d: f(c.r * 2) })))} ${summarize(st)}`);
  row('D-07d.pwinAfter', JSON.stringify(pwinAfter));
  const capParamAfter = await studio.captureWorld('part-d-07c-after-param-180.png', -25, -140, 205, 25);
  row('D-07c.img', `${capParamAfter.rel} md5=${capParamAfter.md5}`);

  // ─── D-08: Flip one dimension to Reference and back (O9 refusal on `leg`, then real toggle on `Ø 5` / `15`) ───
  await studio.clearToasts();
  await studio.clickTool('select');
  const legLbl = st.labels.find((l) => /^180(\.0+)?$/.test(l.text.trim()));
  if (legLbl) {
    await studio.clickScreen(legLbl.cx, legLbl.cy, { button: 'right' });
    await sleep(150);
    await studio.clickEl('.sk-context-item[data-id="dim-reference"]');
    await sleep(200);
  }
  let stO9 = await studio.readState();
  row('D-08a.flipLegO9', `legLbl=${JSON.stringify(legLbl)} toasts=${JSON.stringify(stO9.toasts)}`);

  await studio.clearToasts();
  const flipLbl = stO9.labels.find((l) => /Ø\s*5/.test(l.text)) || stO9.labels.find((l) => /^R\s*15/.test(l.text)) || stO9.labels.find((l) => /^15(\.0+)?$/.test(l.text));
  let flippedToRef = null, flippedBack = null;
  if (flipLbl) {
    await studio.clickScreen(flipLbl.cx, flipLbl.cy, { button: 'right' });
    await sleep(150);
    await studio.clickEl('.sk-context-item[data-id="dim-reference"]');
    await sleep(200);
    const stMidFlip = await studio.readState();
    flippedToRef = stMidFlip.labels.find((l) => l.idx === flipLbl.idx);
    if (flippedToRef) {
      await studio.clickScreen(flippedToRef.cx, flippedToRef.cy, { button: 'right' });
      await sleep(150);
      await studio.clickEl('.sk-context-item[data-id="dim-driving"]');
      await sleep(200);
      const stBackFlip = await studio.readState();
      flippedBack = stBackFlip.labels.find((l) => l.idx === flipLbl.idx);
    }
  }
  st = await studio.readState();
  row('D-08b.flipRefAndBack', `orig=${JSON.stringify(flipLbl?.text)} -> ref=${JSON.stringify(flippedToRef?.text)} -> back=${JSON.stringify(flippedBack?.text)} toasts=${JSON.stringify(st.toasts)}`);

  // ─── D-09: Lock the triangle and try to drag it; unlock it ───
  await studio.clearToasts();
  await studio.clickTool('select');
  await studio.clickW(90, 0);
  await studio.clickW(0, -60, { modifiers: 8 });
  await studio.clickW(120, -40, { modifiers: 8 }); // hypotenuse
  await studio.pressKey('f');
  await sleep(150);
  const stLocked = await studio.readState();
  const fixedCountLocked = stLocked.joints.filter((j) => j.fixed).length;
  const beforeDragRight = stLocked.joints.find((j) => Math.hypot(j.x - 180, j.y) < 1);
  await studio.dragW([180, 0], [205, 20]);
  const stAfterLockedDrag = await studio.readState();
  const afterDragRight = stAfterLockedDrag.joints.find((j) => j.id === beforeDragRight?.id);
  const lockedDragMove = (beforeDragRight && afterDragRight) ? Math.hypot(afterDragRight.x - beforeDragRight.x, afterDragRight.y - beforeDragRight.y) : null;

  await studio.clickW(90, 0);
  await studio.clickW(0, -60, { modifiers: 8 });
  await studio.clickW(120, -40, { modifiers: 8 });
  await studio.pressKey('f');
  await sleep(150);
  const stUnlocked = await studio.readState();
  const fixedCountUnlocked = stUnlocked.joints.filter((j) => j.fixed).length;
  row('D-09.lockDragUnlock', `fixedLocked=${fixedCountLocked} lockedDragMove=${f(lockedDragMove, 4)} fixedUnlocked=${fixedCountUnlocked} toasts=${JSON.stringify(stUnlocked.toasts)}`);

  // ─── D-10: Break the hypotenuse at one hole (middle hole H2 at (90,-60)) and re-join it ───
  await studio.clearToasts();
  st = await studio.readState();
  const holesNow = st.shapes.filter((s) => s.tag === 'circle');
  const midHole = holesNow.reduce((best, c) => (!best || Math.hypot(c.cx - 90, c.cy + 60) < Math.hypot(best.cx - 90, best.cy + 60) ? c : best), null);
  const solidLinesBeforeBreak = st.shapes.filter((s) => s.tag === 'line' && !s.construction).length;
  await studio.clickTool('break');
  if (midHole) {
    // Click on hypotenuse at the middle hole (90, -60)
    await studio.clickW(midHole.cx, midHole.cy);
  } else {
    await studio.clickW(90, -60);
  }
  await studio.pressKey('Escape');
  const stAfterBreak = await studio.readState();
  const solidLinesAfterBreak = stAfterBreak.shapes.filter((s) => s.tag === 'line' && !s.construction).length;
  const diagLines = stAfterBreak.shapes.filter((s) => s.tag === 'line' && !s.construction && Math.abs(s.x2 - s.x1) > 5 && Math.abs(s.y2 - s.y1) > 5);
  row('D-10a.afterBreak', `midHole=${JSON.stringify(midHole ? { cx: f(midHole.cx), cy: f(midHole.cy) } : null)} solidLines:${solidLinesBeforeBreak}->${solidLinesAfterBreak} diagHalves=${JSON.stringify(diagLines.map((l) => ({ id: l.id, x1: f(l.x1), y1: f(l.y1), x2: f(l.x2), y2: f(l.y2), len: f(l.len) })))} ${summarize(stAfterBreak)}`);
  const capBreak = await studio.captureWorld('part-d-10a-break.png', -25, -140, 205, 25);
  row('D-10a.img', `${capBreak.rel} md5=${capBreak.md5}`);

  // Re-join broken hypotenuse: Coincident at break point + Collinear on the two halves
  if (diagLines.length >= 2) {
    await studio.clearToasts();
    await studio.clickTool('collinear');
    await studio.clickW((diagLines[0].x1 + diagLines[0].x2) / 2, (diagLines[0].y1 + diagLines[0].y2) / 2);
    await studio.clickW((diagLines[1].x1 + diagLines[1].x2) / 2, (diagLines[1].y1 + diagLines[1].y2) / 2);
    await studio.pressKey('Escape');
  }
  const stAfterRejoin = await studio.readState();
  row('D-10c.afterRejoin', summarize(stAfterRejoin));

  // ─── D-11: Undo all the way to empty, Redo all the way forward ───
  const snapBeforeUndo = await studio.readState();
  let undoSteps = 0;
  for (let i = 0; i < 80; i++) {
    const cur = await studio.readState();
    if (!cur.canUndo) break;
    await studio.pressKey('z', { ctrl: true, settle: 90 });
    undoSteps++;
  }
  const stAfterUndoAll = await studio.readState();
  let redoSteps = 0;
  for (let i = 0; i < 80; i++) {
    const cur = await studio.readState();
    if (!cur.canRedo) break;
    await studio.pressKey('y', { ctrl: true, settle: 90 });
    redoSteps++;
  }
  const stAfterRedoAll = await studio.readState();
  row('D-11.undoRedo', `undoSteps=${undoSteps} afterUndoAll=[shapes=${stAfterUndoAll.shapes.length},joints=${stAfterUndoAll.jointCount},dims=${stAfterUndoAll.labels.length}] | redoSteps=${redoSteps} afterRedoAll=[shapes=${stAfterRedoAll.shapes.length},joints=${stAfterRedoAll.jointCount},dof=${stAfterRedoAll.totalDof},dims=${JSON.stringify(stAfterRedoAll.labels.map((l) => l.text))}] vs before=[shapes=${snapBeforeUndo.shapes.length},joints=${snapBeforeUndo.jointCount},dof=${snapBeforeUndo.totalDof},dims=${JSON.stringify(snapBeforeUndo.labels.map((l) => l.text))}]`);

  // ─── D-12: Save (Ctrl+S), reload page, verify reopened design restores everything ───
  await studio.clearToasts();
  await studio.pressKey('s', { ctrl: true, settle: 250 });
  const hasSaveInp = await studio.cdp.evalJs(`!!document.querySelector('[aria-modal="true"] input[type="text"], .sk-file-dialog input[type="text"], .sk-modal input')`);
  if (hasSaveInp) {
    await studio.cdp.evalJs(`(() => { const i = document.querySelector('[aria-modal="true"] input[type="text"], .sk-file-dialog input[type="text"], .sk-modal input'); if (i) { i.focus(); i.select(); } })()`);
    await studio.typeText('PartD-Gusset');
    await studio.pressKey('Enter', { settle: 500 });
  }
  await sleep(600);
  const bufBeforeReload = await studio.readBufferDoc();
  await studio.cdp.navigate(studio.url, 12000);
  await studio.cdp.waitForApp('svgCanvas');
  await sleep(600);
  await studio.setView(70, -60, 340);
  const stReloaded = await studio.readState();
  const bufAfterReload = await studio.readBufferDoc();
  row('D-12a.reload', `name=${bufAfterReload?.name} id=${bufAfterReload?.designId} (before=${bufBeforeReload?.name}/${bufBeforeReload?.designId}) ${summarize(stReloaded)}`);
  row('D-12b.reloadedDims', JSON.stringify((bufAfterReload?.doc?.geometry?.constraints || []).filter((c) => c.type === 'distance' || c.type === 'angle').map((c) => ({ name: c.name, type: c.type, val: c.value, expr: c.expression, driven: !!(c.isDriven || c.driven), isDia: !!c.isDiameter }))));
} finally {
  await studio.close();
}
process.exit(0);
