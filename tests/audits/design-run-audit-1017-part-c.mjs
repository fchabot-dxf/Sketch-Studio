// tests/audits/design-run-audit-1017-part-c.mjs — TASK 1017 (AUDIT ONLY, outside the gate)
// PART C: Router jig template (mm) — real-UI live headless Chrome (1280x800) end-to-end audit.
// Run: node tests/audits/design-run-audit-1017-part-c.mjs
import { startStudio, row, f } from './design-run-audit-1017-kit.js';
import { sleep } from '../helpers/cdp-browser.js';

function summarize(st) {
  const lines = st.shapes.filter((s) => s.tag === 'line');
  const arcs = st.shapes.filter((s) => s.tag === 'path');
  const circles = st.shapes.filter((s) => s.tag === 'circle');
  const constr = st.shapes.filter((s) => s.construction);
  return `shapes=${st.shapes.length}(L:${lines.length},A:${arcs.length},C:${circles.length},constr:${constr.length}) joints=${st.jointCount} dof=${st.totalDof}(free:${st.freeCount},full:${st.fullyConstrained}) dims=${JSON.stringify(st.labels.map((l) => l.text))} tool=${st.activeTool} toasts=${JSON.stringify(st.toasts.map((t) => `[${t.level}] ${t.text}`))}`;
}

const studio = await startStudio({ tag: '1017-part-c', view: { cx: 0, cy: 0, vw: 210 } });
try {
  // ─── C-01: Open fresh SketchStudio Design tab ───
  await studio.openFresh();
  let st = await studio.readState();
  row('C-01', `fresh open: ${summarize(st)}`);

  // ─── C-02: Construction centrelines (vertical & horizontal through origin) ───
  await studio.clearToasts();
  const constrClicked = await studio.clickEl('.sk-construction-btn, button[aria-label*="Construction"]');
  st = await studio.readState();
  row('C-02a', `toggle Construction button clicked=${constrClicked} constructionOn=${st.constructionOn}`);

  // Draw vertical construction line (0, -40) -> (0, 40)
  await studio.clickTool('line');
  await studio.clickW(0, -40);
  await studio.moveW(0, 40);
  await studio.clickW(0, 40);
  await studio.pressKey('Escape');
  // Draw horizontal construction line (-72, 0) -> (72, 0)
  await studio.clickTool('line');
  await studio.clickW(-72, 0);
  await studio.moveW(72, 0);
  await studio.clickW(72, 0);
  await studio.pressKey('Escape');

  // Constrain both centrelines: Midpoint with origin (0,0) + length dims 80 and 144 (dropped away from axes!)
  await studio.clickTool('midpoint');
  await studio.clickW(0, 0);
  await studio.clickW(0, -35);
  await studio.clickW(0, 0);
  await studio.clickW(-66, 0);
  await studio.pressKey('Escape');

  await studio.clickTool('dim');
  await studio.clickW(0, -35);
  await studio.moveW(-80, -22);
  await studio.clickW(-80, -22);
  await studio.typeText('80');
  await studio.pressKey('Enter');
  await studio.clickW(-66, 0);
  await studio.moveW(-30, -44);
  await studio.clickW(-30, -44);
  await studio.typeText('144');
  await studio.pressKey('Enter');
  await studio.pressKey('Escape');

  // Turn Construction OFF
  await studio.clickEl('.sk-construction-btn, button[aria-label*="Construction"]');
  st = await studio.readState();
  row('C-02b', `after construction centrelines: constructionOn=${st.constructionOn} ${summarize(st)}`);

  // ─── C-03: 2-Point Rectangle 120 x 60 off-centre via draw-time box ───
  await studio.clearToasts();
  await studio.clickTool('rect');
  await studio.clickW(-48, -22);
  await studio.moveW(55, 30);
  const stMidRect = await studio.readState();
  await studio.typeText('120');
  await studio.pressKey('Tab');
  await studio.typeText('60');
  await studio.pressKey('Enter');
  await studio.pressKey('Escape');
  st = await studio.readState();
  const solidLines3 = st.shapes.filter((s) => s.tag === 'line' && !s.construction);
  row('C-03', `rect 120x60 draw-time dualBox=${stMidRect.dualBoxOpen} -> solidLines=${solidLines3.length} ${summarize(st)}`);

  // ─── C-04: Center rectangle on origin using Symmetric constraint about Y axis & X axis ───
  await studio.clearToasts();
  const rectLeft = solidLines3.find((l) => Math.abs(l.x1 - l.x2) < 1 && l.x1 < 0);
  const rectRight = solidLines3.find((l) => Math.abs(l.x1 - l.x2) < 1 && l.x1 > 0);
  await studio.clickTool('symmetric');
  await studio.clickW(rectLeft.x1, -12);
  await studio.clickW(rectRight.x1, -12);
  await studio.clickW(0, -35);
  let stSym1 = await studio.readState();
  row('C-04a', `after Symmetric L/R about Y: ${summarize(stSym1)}`);

  const solid4 = stSym1.shapes.filter((s) => s.tag === 'line' && !s.construction);
  const rTop2 = solid4.find((l) => Math.abs(l.y1 - l.y2) < 1 && l.y1 < 0);
  const rBot2 = solid4.find((l) => Math.abs(l.y1 - l.y2) < 1 && l.y1 > 0);
  if (stSym1.activeTool !== 'tool-symmetric') await studio.clickTool('symmetric');
  await studio.clickW(28, rTop2.y1);
  await studio.clickW(28, rBot2.y1);
  await studio.clickW(-66, 0);
  await studio.pressKey('Escape');
  st = await studio.readState();
  const rectAfterSym = st.shapes.filter((s) => s.tag === 'line' && !s.construction);
  row('C-04b', `after Symmetric T/B about X: stayedActive=${stSym1.activeTool === 'tool-symmetric'} ${summarize(st)}`);
  row('C-04c', `rect coords=${JSON.stringify(rectAfterSym.map((l) => ({ id: l.id, x1: f(l.x1), y1: f(l.y1), x2: f(l.x2), y2: f(l.y2) })))}`);

  // ─── C-05: Offset tool — inner outline 8 mm inward ───
  await studio.clearToasts();
  await studio.clickTool('offset');
  // Click top outer edge at (25, -30)
  await studio.clickW(25, -30);
  await sleep(160);
  const focusAfterPick = await studio.cdp.evalJs(`document.activeElement ? document.activeElement.id || document.activeElement.tagName : null`);
  // Click inside rectangle at (25, -15) to choose inward side (as the tool's flow describes)
  await studio.clickW(25, -15);
  await sleep(100);
  const focusAfterSideClick = await studio.cdp.evalJs(`({ active: document.activeElement ? (document.activeElement.id || document.activeElement.tagName) : null, boxVal: document.getElementById('offset-distance-input')?.value })`);
  // Try typing 8 + Enter right after clicking inside
  await studio.typeText('8');
  await studio.pressKey('Enter');
  await sleep(150);
  let stOffTry1 = await studio.readState();
  const boxValAfterTry1 = await studio.cdp.evalJs(`document.getElementById('offset-distance-input')?.value ?? null`);
  row('C-05a.focusBug', `focusAfterPick=${focusAfterPick} focusAfterSideClick=${JSON.stringify(focusAfterSideClick)} boxValAfterTry1=${boxValAfterTry1} offsetStillOpen=${stOffTry1.offsetBoxOpen} shapesAfterTry1=${stOffTry1.shapes.length}`);
  const capOffBug = await studio.captureWorld('part-c-05a-offset-focus-bug.png', -72, -40, 72, 40);
  row('C-05a.img', `${capOffBug.rel} md5=${capOffBug.md5}`);

  // Workaround: explicitly click the #offset-distance-input box to re-focus it, select all, type 8 + Enter
  if (stOffTry1.offsetBoxOpen) {
    await studio.clickEl('#offset-distance-input');
    await studio.pressKey('a', { ctrl: true });
    await studio.typeText('8');
    await studio.pressKey('Enter');
    await sleep(200);
  }
  st = await studio.readState();
  const toolAfterOffsetCommit = st.activeTool;
  if (st.activeTool !== 'tool-select') await studio.pressKey('Escape');
  st = await studio.readState();
  const solidAfterOff = st.shapes.filter((s) => s.tag === 'line' && !s.construction);
  const innerLines = solidAfterOff.filter((l) => Math.max(Math.abs(l.x1), Math.abs(l.x2)) < 58 && Math.max(Math.abs(l.y1), Math.abs(l.y2)) < 28);
  row('C-05b', `offset 8mm committed: toolAfterCommit=${toolAfterOffsetCommit} innerCount=${innerLines.length} ${summarize(st)}`);
  row('C-05c', `inner coords=${JSON.stringify(innerLines.map((l) => ({ id: l.id, x1: f(l.x1), y1: f(l.y1), x2: f(l.x2), y2: f(l.y2), len: f(l.len) })))}`);
  const capOff = await studio.captureWorld('part-c-05b-offset-ok.png', -72, -40, 72, 40);
  row('C-05b.img', `${capOff.rel} md5=${capOff.md5}`);

  // ─── C-06: Angled guide line on right at 30 deg to X axis (lower half y in [6..27], crosses inner bottom y=+22) ───
  await studio.clearToasts();
  const idsBeforeGuide = new Set(st.shapes.map((s) => s.id));
  await studio.clickTool('line');
  await studio.clickW(8, 6);
  await studio.moveW(46, 27);
  await studio.clickW(46, 27);
  await studio.pressKey('Escape');
  st = await studio.readState();
  const guideR = st.shapes.find((s) => !idsBeforeGuide.has(s.id));
  row('C-06a', `guideR drawn: ${JSON.stringify(guideR ? { id: guideR.id, x1: f(guideR.x1), y1: f(guideR.y1), x2: f(guideR.x2), y2: f(guideR.y2) } : null)} ${summarize(st)}`);

  // Dimension angle 30 deg between guideR and horizontal centreline (X axis)
  await studio.clickTool('dim');
  const gMidX = (guideR.x1 + guideR.x2) / 2, gMidY = (guideR.y1 + guideR.y2) / 2;
  await studio.clickW(gMidX, gMidY);
  await studio.clickW(35, 0);
  await studio.moveW(32, 8);
  await studio.clickW(32, 8);
  const stAngBox = await studio.readState();
  await studio.typeText('30');
  await studio.pressKey('Enter');
  await studio.pressKey('Escape');
  st = await studio.readState();
  const guideRAfterAng = st.shapes.find((s) => s.id === guideR.id);
  const angDeg = guideRAfterAng ? Math.atan2(guideRAfterAng.y2 - guideRAfterAng.y1, guideRAfterAng.x2 - guideRAfterAng.x1) * 180 / Math.PI : null;
  row('C-06b', `angle dim 30: boxOpened=${stAngBox.dimBoxOpen} boxVal=${stAngBox.dimBoxVal} actualAngle=${f(angDeg)}deg ${summarize(st)}`);

  // ─── C-07: Mirror right guide line about vertical centreline (Y axis) with Mirror tool ───
  await studio.clearToasts();
  const idsBeforeMirror = new Set(st.shapes.map((s) => s.id));
  await studio.clickTool('mirror');
  const gr = st.shapes.find((s) => s.id === guideR.id);
  await studio.clickW((gr.x1 + gr.x2) / 2, (gr.y1 + gr.y2) / 2);
  await studio.pressKey('Enter'); // OBJECTS -> LINE
  await studio.clickW(0, -35);    // vertical construction centreline
  await studio.pressKey('Enter'); // commit mirror
  st = await studio.readState();
  const guideL = st.shapes.find((s) => !idsBeforeMirror.has(s.id));
  row('C-07', `mirror guideR -> guideL=${JSON.stringify(guideL ? { id: guideL.id, x1: f(guideL.x1), y1: f(guideL.y1), x2: f(guideL.x2), y2: f(guideL.y2) } : null)} ${summarize(st)}`);
  const capMir = await studio.captureWorld('part-c-07-mirror.png', -65, -35, 65, 35);
  row('C-07.img', `${capMir.rel} md5=${capMir.md5}`);

  // ─── C-08: Trim both angled guide lines at the inner bottom edge (y = +22) ───
  await studio.clearToasts();
  await studio.clickTool('trim');
  const gr8 = st.shapes.find((s) => s.id === guideR.id);
  const gl8 = guideL ? st.shapes.find((s) => s.id === guideL.id) : null;
  if (gr8) {
    const xBot = gr8.y2 > gr8.y1 ? gr8.x2 : gr8.x1, yBot = Math.max(gr8.y1, gr8.y2);
    const xTop = gr8.y2 > gr8.y1 ? gr8.x1 : gr8.x2, yTop = Math.min(gr8.y1, gr8.y2);
    const t22 = (22 - yTop) / (yBot - yTop);
    const tx = xTop + (xBot - xTop) * ((t22 + 1) / 2);
    const ty = yTop + (yBot - yTop) * ((t22 + 1) / 2);
    await studio.clickW(tx, ty);
  }
  if (gl8) {
    const xBot = gl8.y2 > gl8.y1 ? gl8.x2 : gl8.x1, yBot = Math.max(gl8.y1, gl8.y2);
    const xTop = gl8.y2 > gl8.y1 ? gl8.x1 : gl8.x2, yTop = Math.min(gl8.y1, gl8.y2);
    const t22 = (22 - yTop) / (yBot - yTop);
    const tx = xTop + (xBot - xTop) * ((t22 + 1) / 2);
    const ty = yTop + (yBot - yTop) * ((t22 + 1) / 2);
    await studio.clickW(tx, ty);
  }
  await studio.pressKey('Escape');
  st = await studio.readState();
  const grTrim = st.shapes.find((s) => s.id === guideR.id);
  const glTrim = guideL ? st.shapes.find((s) => s.id === guideL.id) : null;
  row('C-08', `after Trim: guideR=${JSON.stringify(grTrim ? { x1: f(grTrim.x1), y1: f(grTrim.y1), x2: f(grTrim.x2), y2: f(grTrim.y2) } : null)} guideL=${JSON.stringify(glTrim ? { x1: f(glTrim.x1), y1: f(glTrim.y1), x2: f(glTrim.x2), y2: f(glTrim.y2) } : null)} ${summarize(st)}`);
  const capTrim = await studio.captureWorld('part-c-08-trim.png', -65, -35, 65, 35);
  row('C-08.img', `${capTrim.rel} md5=${capTrim.md5}`);

  // ─── C-08b: Check if Trim preserved Mirror symmetry on the trimmed bottom ends (before Tangent masks it!) ───
  await studio.clickTool('select');
  const angPreArc = st.labels.find((l) => /30/.test(l.text) && /°/.test(l.text));
  if (angPreArc) {
    await studio.clickScreen(angPreArc.cx, angPreArc.cy, { clicks: 2 });
    await studio.typeText('45');
    await studio.pressKey('Enter');
    await sleep(250);
  }
  const stTrimMir = await studio.readState();
  const grTM = stTrimMir.shapes.find((s) => s.id === guideR.id);
  const glTM = guideL ? stTrimMir.shapes.find((s) => s.id === guideL.id) : null;
  const angTMR = grTM ? Math.atan2(grTM.y2 - grTM.y1, grTM.x2 - grTM.x1) * 180 / Math.PI : null;
  const angTML = glTM ? Math.atan2(glTM.y2 - glTM.y1, glTM.x2 - glTM.x1) * 180 / Math.PI : null;
  row('C-08b.trimBreaksMirror', `pre-arc angle->45: angR=${f(angTMR)}deg angL=${f(angTML)}deg(expected 135deg) guideR=${JSON.stringify(grTM ? { x1: f(grTM.x1), y1: f(grTM.y1), x2: f(grTM.x2), y2: f(grTM.y2) } : null)} guideL=${JSON.stringify(glTM ? { x1: f(glTM.x1), y1: f(glTM.y1), x2: f(glTM.x2), y2: f(glTM.y2) } : null)}`);
  const capTM = await studio.captureWorld('part-c-08b-trim-breaks-mirror.png', -65, -35, 65, 35);
  row('C-08b.img', `${capTM.rel} md5=${capTM.md5}`);
  // Undo the temporary 30->45 check so we continue Part C at 30 deg
  await studio.pressKey('z', { ctrl: true });
  await sleep(200);
  st = await studio.readState();

  // ─── C-09: Tangent arc joining their top ends + constrain fully ───
  await studio.clearToasts();
  const idsBeforeArc = new Set(st.shapes.map((s) => s.id));
  const grTop = grTrim ? (grTrim.y1 < grTrim.y2 ? { x: grTrim.x1, y: grTrim.y1 } : { x: grTrim.x2, y: grTrim.y2 }) : { x: 8, y: 6 };
  const glTop = glTrim ? (glTrim.y1 < glTrim.y2 ? { x: glTrim.x1, y: glTrim.y1 } : { x: glTrim.x2, y: glTrim.y2 }) : { x: -8, y: 6 };
  await studio.clickTool('arc');
  await studio.clickW(0, 19);
  await studio.moveW(glTop.x, glTop.y);
  await studio.clickW(glTop.x, glTop.y);
  await studio.moveW(0, 3);
  await studio.moveW(grTop.x, grTop.y);
  await studio.clickW(grTop.x, grTop.y);
  await studio.pressKey('Escape');
  st = await studio.readState();
  const arcShape = st.shapes.find((s) => !idsBeforeArc.has(s.id));
  row('C-09a', `arc drawn: ${JSON.stringify(arcShape)} ${summarize(st)}`);

  // Compute actual arc points: midpoint (crosses Y centreline at x=0) and off-axis point at 25% of arc length
  const arcPts = await studio.cdp.evalJs(`(() => {
    const p = document.querySelector('#svgCanvas path.shape-elem[data-shape-id="${arcShape?.id}"]');
    if (!p) return null;
    const len = p.getTotalLength();
    const mid = p.getPointAtLength(len * 0.5);
    const q = p.getPointAtLength(len * 0.25);
    return { mid: { x: mid.x, y: mid.y }, offAxis: { x: q.x, y: q.y } };
  })()`);
  row('C-09.arcPts', JSON.stringify(arcPts));

  // First record the construction-line-wins-over-arc hit-test issue when clicking arc apex on Y centreline
  if (arcShape && arcPts && grTrim) {
    await studio.clickTool('tangent');
    await studio.clickW(arcPts.mid.x, arcPts.mid.y);
    await studio.clickW((grTrim.x1 + grTrim.x2) / 2, (grTrim.y1 + grTrim.y2) / 2);
    const stApexHit = await studio.readState();
    row('C-09b.apexHitBug', `clicking arc apex at (0, ${f(arcPts.mid.y)}) over Y centreline: ${summarize(stApexHit)}`);

    // Now click the arc OFF the Y centreline (25% along arc) -> apply Tangent to guideR and guideL!
    await studio.clearToasts();
    if (stApexHit.activeTool !== 'tool-tangent') await studio.clickTool('tangent');
    await studio.clickW(arcPts.offAxis.x, arcPts.offAxis.y);
    await studio.clickW((grTrim.x1 + grTrim.x2) / 2, (grTrim.y1 + grTrim.y2) / 2);
    const stT1 = await studio.readState();
    row('C-09b', `tangent arc(offAxis)+guideR: ${summarize(stT1)}`);
    if (glTrim) {
      await studio.clearToasts();
      if (stT1.activeTool !== 'tool-tangent') await studio.clickTool('tangent');
      const arcPt2 = await studio.cdp.evalJs(`(() => {
        const p = document.querySelector('#svgCanvas path.shape-elem[data-shape-id="${arcShape.id}"]');
        if (!p) return null;
        const q = p.getPointAtLength(p.getTotalLength() * 0.75);
        return { x: q.x, y: q.y };
      })()`);
      await studio.clickW(arcPt2.x, arcPt2.y);
      await studio.clickW((glTrim.x1 + glTrim.x2) / 2, (glTrim.y1 + glTrim.y2) / 2);
      const stT2 = await studio.readState();
      row('C-09c', `tangent arc(offAxis)+guideL: stayedActive=${stT1.activeTool === 'tool-tangent'} ${summarize(stT2)}`);
    }
    await studio.pressKey('Escape');
  }

  // Dimension arc radius = 16 (clicking arc OFF the Y centreline!) and top-end distance from X axis = 6 to fully constrain
  await studio.clearToasts();
  st = await studio.readState();
  if (arcShape) {
    const arcPt3 = await studio.cdp.evalJs(`(() => {
      const p = document.querySelector('#svgCanvas path.shape-elem[data-shape-id="${arcShape.id}"]');
      if (!p) return null;
      const q = p.getPointAtLength(p.getTotalLength() * 0.25);
      return { x: q.x, y: q.y };
    })()`);
    await studio.clickTool('dim');
    await studio.clickW(arcPt3.x, arcPt3.y);
    await studio.moveW(-15, -10);
    await studio.clickW(-15, -10);
    await studio.typeText('16');
    await studio.pressKey('Enter');

    st = await studio.readState();
    const grNow = st.shapes.find((s) => s.id === guideR.id);
    const ptTop = grNow ? (grNow.y1 < grNow.y2 ? { x: grNow.x1, y: grNow.y1 } : { x: grNow.x2, y: grNow.y2 }) : grTop;
    await studio.clickW(ptTop.x, ptTop.y);
    await studio.clickW(25, 0);
    await studio.moveW(ptTop.x + 12, ptTop.y / 2);
    await studio.clickW(ptTop.x + 12, ptTop.y / 2);
    await studio.typeText('6');
    await studio.pressKey('Enter');
    await studio.pressKey('Escape');
  }
  st = await studio.readState();
  row('C-10', `Part C complete (30deg, off=8): ${summarize(st)}`);
  row('C-10.freeJoints', JSON.stringify(st.joints.filter((j) => j.dof > 0)));
  const capDone30 = await studio.captureWorld('part-c-10-complete-30deg.png', -68, -38, 68, 38);
  row('C-10.img', `${capDone30.rel} md5=${capDone30.md5}`);

  // ─── C-11: Edit angle 30 -> 45 deg ───
  await studio.clearToasts();
  await studio.clickTool('select');
  const angLbl = st.labels.find((l) => /30/.test(l.text) && /°/.test(l.text));
  row('C-11a', `found angle label=${JSON.stringify(angLbl)}`);
  if (angLbl) {
    await studio.clickScreen(angLbl.cx, angLbl.cy, { clicks: 2 });
    await studio.typeText('45');
    await studio.pressKey('Enter');
    await sleep(300);
  }
  st = await studio.readState();
  const gr45 = st.shapes.find((s) => s.id === guideR.id);
  const gl45 = guideL ? st.shapes.find((s) => s.id === guideL.id) : null;
  const ang45R = gr45 ? Math.atan2(gr45.y2 - gr45.y1, gr45.x2 - gr45.x1) * 180 / Math.PI : null;
  const ang45L = gl45 ? Math.atan2(gl45.y2 - gl45.y1, gl45.x2 - gl45.x1) * 180 / Math.PI : null;
  row('C-11b', `after angle->45: angR=${f(ang45R)} angL=${f(ang45L)} guideR=${JSON.stringify(gr45 ? { x1: f(gr45.x1), y1: f(gr45.y1), x2: f(gr45.x2), y2: f(gr45.y2) } : null)} guideL=${JSON.stringify(gl45 ? { x1: f(gl45.x1), y1: f(gl45.y1), x2: f(gl45.x2), y2: f(gl45.y2) } : null)} ${summarize(st)}`);
  const cap45 = await studio.captureWorld('part-c-11-angle45.png', -68, -38, 68, 38);
  row('C-11.img', `${cap45.rel} md5=${cap45.md5}`);

  // ─── C-12: Edit offset 8 -> 10 mm ───
  await studio.clearToasts();
  const offLbl = st.labels.find((l) => /^-?8(\.0+)?$/.test(l.text.replace(/[()]/g, '').trim()));
  row('C-12a', `found offset label=${JSON.stringify(offLbl)}`);
  if (offLbl) {
    await studio.clickScreen(offLbl.cx, offLbl.cy, { clicks: 2 });
    await studio.typeText('10');
    await studio.pressKey('Enter');
    await sleep(300);
  }
  st = await studio.readState();
  const gr10 = st.shapes.find((s) => s.id === guideR.id);
  const gl10 = guideL ? st.shapes.find((s) => s.id === guideL.id) : null;
  const inner10 = st.shapes.filter((s) => s.tag === 'line' && !s.construction && s.id !== guideR.id && (!guideL || s.id !== guideL.id) && Math.max(Math.abs(s.x1), Math.abs(s.x2)) < 58);
  row('C-12b', `after offset->10: guideR=${JSON.stringify(gr10 ? { x1: f(gr10.x1), y1: f(gr10.y1), x2: f(gr10.x2), y2: f(gr10.y2) } : null)} guideL=${JSON.stringify(gl10 ? { x1: f(gl10.x1), y1: f(gl10.y1), x2: f(gl10.x2), y2: f(gl10.y2) } : null)} innerBox=${JSON.stringify(inner10.map((l) => [f(l.x1), f(l.y1), f(l.x2), f(l.y2)]))} ${summarize(st)}`);
  const cap10 = await studio.captureWorld('part-c-12-offset10.png', -68, -38, 68, 38);
  row('C-12.img', `${cap10.rel} md5=${cap10.md5}`);

  // ─── C-13: Undo all the way to empty, then Redo all the way forward ───
  const snapBeforeUndo = await studio.readState();
  let undoSteps = 0;
  for (let i = 0; i < 60; i++) {
    const cur = await studio.readState();
    if (!cur.canUndo) break;
    await studio.pressKey('z', { ctrl: true, settle: 90 });
    undoSteps++;
  }
  const stAfterUndoAll = await studio.readState();
  let redoSteps = 0;
  for (let i = 0; i < 60; i++) {
    const cur = await studio.readState();
    if (!cur.canRedo) break;
    await studio.pressKey('y', { ctrl: true, settle: 90 });
    redoSteps++;
  }
  const stAfterRedoAll = await studio.readState();
  row('C-13', `undoSteps=${undoSteps} afterUndoAll=[shapes=${stAfterUndoAll.shapes.length},joints=${stAfterUndoAll.jointCount},dims=${stAfterUndoAll.labels.length}] | redoSteps=${redoSteps} afterRedoAll=[shapes=${stAfterRedoAll.shapes.length},joints=${stAfterRedoAll.jointCount},dof=${stAfterRedoAll.totalDof},dims=${JSON.stringify(stAfterRedoAll.labels.map((l) => l.text))}] vs before=[shapes=${snapBeforeUndo.shapes.length},joints=${snapBeforeUndo.jointCount},dof=${snapBeforeUndo.totalDof},dims=${JSON.stringify(snapBeforeUndo.labels.map((l) => l.text))}]`);

  // ─── C-14: Save (Ctrl+S), reload page, verify reopened design ───
  await studio.clearToasts();
  await studio.pressKey('s', { ctrl: true, settle: 250 });
  const saveDialogInfo = await studio.cdp.evalJs(`(() => {
    const inp = document.querySelector('.sk-file-dialog input[type="text"], [aria-modal="true"] input[type="text"], .sk-modal input');
    const btn = [...document.querySelectorAll('[aria-modal="true"] button, .sk-file-dialog button')].find((b) => /save/i.test(b.textContent));
    return { hasInput: !!inp, val: inp ? inp.value : null, hasBtn: !!btn, btnText: btn ? btn.textContent.trim() : null };
  })()`);
  row('C-14a', `Ctrl+S dialog: ${JSON.stringify(saveDialogInfo)}`);
  if (saveDialogInfo.hasInput) {
    await studio.cdp.evalJs(`(() => { const i = document.querySelector('[aria-modal="true"] input[type="text"], .sk-file-dialog input[type="text"], .sk-modal input'); if (i) { i.focus(); i.select(); } })()`);
    await studio.typeText('PartC-RouterJig');
    await studio.pressKey('Enter', { settle: 500 });
  }
  await sleep(600);
  const bufBeforeReload = await studio.readBufferDoc();
  await studio.cdp.navigate(studio.url, 12000);
  await studio.cdp.waitForApp('svgCanvas');
  await sleep(600);
  await studio.setView(0, 0, 210);
  const stReloaded = await studio.readState();
  const bufAfterReload = await studio.readBufferDoc();
  row('C-14b', `after reload: name=${bufAfterReload?.name} id=${bufAfterReload?.designId} (before=${bufBeforeReload?.name}/${bufBeforeReload?.designId}) ${summarize(stReloaded)}`);
  row('C-14c', `reloaded constraints=${JSON.stringify((bufAfterReload?.doc?.geometry?.constraints || []).map((c) => ({ type: c.type, name: c.name, val: c.value, expr: c.expression, driven: !!(c.isDriven || c.driven) })))}`);
} finally {
  await studio.close();
}
process.exit(0);
