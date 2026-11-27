// tests/audits/design-run-audit-1017-extra.mjs — TASK 1017 (AUDIT ONLY, outside the gate)
// Focused live-Chrome isolation probes for edge cases uncovered during Part C & Part D runs.
// Run: node tests/audits/design-run-audit-1017-extra.mjs
import { startStudio, row, f } from './design-run-audit-1017-kit.js';
import { sleep } from '../helpers/cdp-browser.js';

const studio = await startStudio({ tag: '1017-extra', view: { cx: 60, cy: -40, vw: 240 } });
try {
  // ─── E-01: Auto-reference dimension Undo + Redo loss check ───
  await studio.openFresh();
  await studio.clickTool('line');
  await studio.clickW(0, 0);
  await studio.moveW(80, 0);
  await studio.clickW(80, 0);
  await studio.pressKey('Escape');
  // Add driving dim 80
  await studio.clickTool('dim');
  await studio.clickW(40, 0);
  await studio.moveW(40, -18);
  await studio.clickW(40, -18);
  await studio.typeText('80');
  await studio.pressKey('Enter');
  // Add 2nd (auto-reference) dim on same line
  await studio.clickW(40, 0);
  await studio.moveW(40, -34);
  await studio.clickW(40, -34);
  await studio.pressKey('Escape');
  const e1Before = await studio.readState();
  // Add one more line afterwards, then Undo all & Redo all
  await studio.clickTool('line');
  await studio.clickW(0, 0);
  await studio.moveW(0, -50);
  await studio.clickW(0, -50);
  await studio.pressKey('Escape');
  const e1BeforeUndo = await studio.readState();
  let u1 = 0;
  while ((await studio.readState()).canUndo && u1 < 20) { await studio.pressKey('z', { ctrl: true, settle: 90 }); u1++; }
  const e1Empty = await studio.readState();
  let r1 = 0;
  while ((await studio.readState()).canRedo && r1 < 20) { await studio.pressKey('y', { ctrl: true, settle: 90 }); r1++; }
  const e1AfterRedo = await studio.readState();
  row('E-01a.autoRefUndoRedo', `afterPlace=${JSON.stringify(e1Before.labels.map(l=>l.text))} beforeUndo=${JSON.stringify(e1BeforeUndo.labels.map(l=>l.text))} undo=${u1}(shapes=${e1Empty.shapes.length},dims=${e1Empty.labels.length}) redo=${r1} afterRedo=${JSON.stringify(e1AfterRedo.labels.map(l=>l.text))}`);

  // Also test 1x Undo right after placing an auto-reference dim (without adding anything after!)
  await studio.clickTool('dim');
  await studio.clickW(40, 0);
  await studio.moveW(40, -48);
  await studio.clickW(40, -48);
  await studio.pressKey('Escape');
  const e1bBefore = await studio.readState();
  await studio.pressKey('z', { ctrl: true, settle: 120 });
  const e1bAfterUndo = await studio.readState();
  await studio.pressKey('y', { ctrl: true, settle: 120 });
  const e1bAfterRedo = await studio.readState();
  row('E-01b.singleUndoAutoRef', `before=${JSON.stringify(e1bBefore.labels.map(l=>l.text))} after1Undo=${JSON.stringify(e1bAfterUndo.labels.map(l=>l.text))} after1Redo=${JSON.stringify(e1bAfterRedo.labels.map(l=>l.text))} shapesAfterUndo=${e1bAfterUndo.shapes.length} shapesBefore=${e1bBefore.shapes.length}`);

  // ─── E-02: Break directly on a solid hypotenuse (NO overlapping construction line!) with hole at midpoint + angle dim ───
  await studio.openFresh();
  await studio.setView(60, -45, 280);
  // Draw right triangle (0,0)-(150,0)-(0,-100)
  await studio.clickTool('line');
  await studio.clickW(0, 0);
  await studio.moveW(150, 0);
  await studio.clickW(150, 0);
  await studio.moveW(0, -100);
  await studio.clickW(0, -100);
  await studio.moveW(0, 0);
  await studio.clickW(0, 0);
  await studio.pressKey('Escape');
  // Dimension legs 150 and 100
  await studio.clickTool('dim');
  await studio.clickW(75, 0); await studio.moveW(75, 16); await studio.clickW(75, 16); await studio.typeText('150'); await studio.pressKey('Enter');
  await studio.clickW(0, -50); await studio.moveW(-18, -50); await studio.clickW(-18, -50); await studio.typeText('100'); await studio.pressKey('Enter');
  // Add angle dim on hypotenuse
  await studio.clickW(75, 0); await studio.clickW(75, -50); await studio.moveW(112, -14); await studio.clickW(112, -14);
  if ((await studio.readState()).dimBoxOpen) await studio.pressKey('Enter');
  await studio.pressKey('Escape');
  // Add circle centered at midpoint (75,-50) with Ø 5
  await studio.clickTool('circle');
  await studio.clickW(75, -50);
  await studio.moveW(80, -50);
  await studio.typeText('5');
  await studio.pressKey('Enter');
  await studio.pressKey('Escape');
  const e2Before = await studio.readState();
  // Now Break the solid hypotenuse right at the circle center (75,-50)!
  await studio.clearToasts();
  await studio.clickTool('break');
  await studio.clickW(75, -50);
  await studio.pressKey('Escape');
  const e2AfterBreak = await studio.readState();
  const diag2 = e2AfterBreak.shapes.filter((s) => s.tag === 'line' && Math.abs(s.x2 - s.x1) > 5 && Math.abs(s.y2 - s.y1) > 5);
  const profileCount = await studio.cdp.evalJs(`document.querySelectorAll('#svgCanvas path.profile-fill').length`);
  row('E-02a.breakSolidHyp', `before=[L:${e2Before.shapes.filter(s=>s.tag==='line').length},dof:${e2Before.totalDof},dims:${JSON.stringify(e2Before.labels.map(l=>l.text))}] -> after=[L:${e2AfterBreak.shapes.filter(s=>s.tag==='line').length},dof:${e2AfterBreak.totalDof},dims:${JSON.stringify(e2AfterBreak.labels.map(l=>l.text))},profiles:${profileCount}] diagHalves=${JSON.stringify(diag2.map(l=>({id:l.id,x1:f(l.x1),y1:f(l.y1),x2:f(l.x2),y2:f(l.y2),len:f(l.len)})))}`);
  const capE2 = await studio.captureWorld('extra-e02-break-solid-hyp.png', -28, -118, 170, 28);
  row('E-02a.img', `${capE2.rel} md5=${capE2.md5}`);

  // Check if dragging the break joint moves it off-line or stays collinear, AND check whether SketchStudio has any "merge/join" tool
  if (diag2.length === 2) {
    // Try dragging the break point (75, -50) perpendicular by (+15, -20)
    await studio.clickTool('select');
    await studio.dragW([75, -50], [90, -70]);
    const e2AfterDrag = await studio.readState();
    const diag2Drag = e2AfterDrag.shapes.filter((s) => s.tag === 'line' && Math.abs(s.x2 - s.x1) > 5 && Math.abs(s.y2 - s.y1) > 5);
    row('E-02b.dragAfterBreak', `dof=${e2AfterDrag.totalDof} diagAfterDrag=${JSON.stringify(diag2Drag.map(l=>({x1:f(l.x1),y1:f(l.y1),x2:f(l.x2),y2:f(l.y2)})))} circle=${JSON.stringify(e2AfterDrag.shapes.filter(s=>s.tag==='circle').map(c=>({cx:f(c.cx),cy:f(c.cy)})))}`);
    const capE2b = await studio.captureWorld('extra-e02b-drag-after-break.png', -28, -118, 170, 28);
    row('E-02b.img', `${capE2b.rel} md5=${capE2b.md5}`);

    // Re-join via Collinear + Coincident (and check if Close Path does anything)
    await studio.pressKey('z', { ctrl: true }); // undo drag
    await studio.clickTool('collinear');
    await studio.clickW(112, -25);
    await studio.clickW(37, -75);
    await studio.pressKey('Escape');
    const e2Collinear = await studio.readState();
    row('E-02c.rejoinCollinear', `dof=${e2Collinear.totalDof} toasts=${JSON.stringify(e2Collinear.toasts)}`);
  }

  // ─── E-03: Reference label format on Radius (`R 15`) vs Diameter (`Ø 5`) & driving angle promotion on triangle ───
  await studio.openFresh();
  await studio.setView(60, -50, 290);
  // Draw triangle with 150, 100, and angle (33.7°) + arc R 15
  await studio.clickTool('line');
  await studio.clickW(0, 0); await studio.moveW(150, 0); await studio.clickW(150, 0);
  await studio.moveW(0, -100); await studio.clickW(0, -100);
  await studio.moveW(0, 0); await studio.clickW(0, 0);
  await studio.pressKey('Escape');
  await studio.clickTool('dim');
  await studio.clickW(75, 0); await studio.moveW(75, 16); await studio.clickW(75, 16); await studio.typeText('150'); await studio.pressKey('Enter');
  await studio.clickW(0, -50); await studio.moveW(-18, -50); await studio.clickW(-18, -50); await studio.typeText('100'); await studio.pressKey('Enter');
  await studio.clickW(90, 0); await studio.clickW(75, -50); await studio.moveW(112, -14); await studio.clickW(112, -14);
  if ((await studio.readState()).dimBoxOpen) await studio.pressKey('Enter');
  await studio.pressKey('Escape');
  // Arc R 15
  await studio.clickTool('arc');
  await studio.clickW(0, 0); await studio.moveW(15, 0); await studio.clickW(15, 0); await studio.moveW(10, -10); await studio.moveW(0, -15); await studio.clickW(0, -15);
  await studio.pressKey('Escape');
  const arcId = (await studio.readState()).shapes.find(s => s.tag === 'path')?.id;
  const arcMid = await studio.cdp.evalJs(`(() => { const p = document.querySelector('#svgCanvas path.shape-elem[data-shape-id="${arcId}"]'); const q = p.getPointAtLength(p.getTotalLength()*0.5); return {x:q.x,y:q.y}; })()`);
  await studio.clickTool('dim');
  await studio.clickW(arcMid.x, arcMid.y); await studio.moveW(26, -24); await studio.clickW(26, -24); await studio.typeText('15'); await studio.pressKey('Enter');
  await studio.pressKey('Escape');
  // Flip R 15 -> Reference (check formatting: "R (15)" vs "(R 15)")
  await studio.clickTool('select');
  let st3 = await studio.readState();
  const rLbl = st3.labels.find(l => /R\s*15/.test(l.text));
  let rRefLbl = null;
  if (rLbl) {
    await studio.clickScreen(rLbl.cx, rLbl.cy, { button: 'right' }); await sleep(150);
    await studio.clickEl('.sk-context-item[data-id="dim-reference"]'); await sleep(180);
    rRefLbl = (await studio.readState()).labels.find(l => l.idx === rLbl.idx);
  }
  // Flip 100 -> Reference, then promote (33.7°) -> Driving, then edit 33.7° -> 40°!
  st3 = await studio.readState();
  const h100 = st3.labels.find(l => /^100/.test(l.text));
  if (h100) {
    await studio.clickScreen(h100.cx, h100.cy, { button: 'right' }); await sleep(150);
    await studio.clickEl('.sk-context-item[data-id="dim-reference"]'); await sleep(180);
  }
  st3 = await studio.readState();
  const a33 = st3.labels.find(l => /33\.7/.test(l.text));
  let aPromoted = null;
  if (a33) {
    await studio.clickScreen(a33.cx, a33.cy, { button: 'right' }); await sleep(150);
    await studio.clickEl('.sk-context-item[data-id="dim-driving"]'); await sleep(200);
    const stAfterPromoteAng = await studio.readState();
    aPromoted = stAfterPromoteAng.labels.find(l => l.idx === a33.idx);
    if (aPromoted) {
      await studio.clickScreen(aPromoted.cx, aPromoted.cy, { clicks: 2 });
      await studio.typeText('40');
      await studio.pressKey('Enter');
      await sleep(250);
    }
  }
  const stAfterAng40 = await studio.readState();
  row('E-03.refFormatAndAngDrive', `labelsStart=${JSON.stringify(st3.labels.map(l=>l.text))} R15_as_ref=${JSON.stringify(rRefLbl?.text)} promotedAng=${JSON.stringify(aPromoted?.text)} afterEdit40=${JSON.stringify(stAfterAng40.labels.map(l=>l.text))} dof=${stAfterAng40.totalDof} toasts=${JSON.stringify(stAfterAng40.toasts)}`);

  // ─── E-04: Offset Esc check (does ONE Esc cancel box AND leave Offset tool per owner 1-Esc ruling?) ───
  await studio.openFresh();
  await studio.setView(0, 0, 200);
  await studio.clickTool('rect');
  await studio.clickW(-40, -20); await studio.moveW(40, 20); await studio.clickW(40, 20);
  await studio.pressKey('Escape');
  await studio.clickTool('offset');
  await studio.clickW(0, -20); // opens offset box
  const offOpen = await studio.readState();
  await studio.pressKey('Escape');
  const after1Esc = await studio.readState();
  await studio.pressKey('Escape');
  const after2Esc = await studio.readState();
  row('E-04.offsetEsc', `beforeEsc=[tool:${offOpen.activeTool},box:${offOpen.offsetBoxOpen}] after1Esc=[tool:${after1Esc.activeTool},box:${after1Esc.offsetBoxOpen}] after2Esc=[tool:${after2Esc.activeTool},box:${after2Esc.offsetBoxOpen}]`);
} finally {
  await studio.close();
}
process.exit(0);
