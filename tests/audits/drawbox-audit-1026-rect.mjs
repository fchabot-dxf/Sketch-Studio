// tests/audits/drawbox-audit-1026-rect.mjs — TASK 1026 (AUDIT ONLY): Rectangle W x H box matrix, 2-point + centre + 3-point (rows B-R*)
// Run: node tests/audits/drawbox-audit-1026-rect.mjs
import { start, row, f } from './drawbox-audit-1026-kit.js';

const k = await start({ tag: '1026-rect', view: { cx: 0, cy: 0, vw: 220 } });
const near = (a, b, t = 0.06) => Math.abs(a - b) <= t;
const lines = (sn) => sn.shapes.filter((s) => s.type === 'line');
const dist = (sn) => sn.cons.filter((c) => c.type === 'distance');
const C1 = [-40, -10];     // first click
const C2 = [10, 25];       // cursor: 50 wide, 35 high (screen down-right)
const C2b = [-75, -25];    // cursor in the OPPOSITE quadrant
/** the bounding box of the lines of a rectangle: { w, h, x0, y0 } (mm) */
function bbox(sn) {
  const L = lines(sn); if (!L.length) return null;
  const xs = L.flatMap((l) => [l.p[0], l.p[2]]), ys = L.flatMap((l) => [l.p[1], l.p[3]]);
  return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys), x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys), n: L.length };
}
const sizeOk = (sn, w, h) => { const b = bbox(sn); return b && near(b.w, w, 0.2) && near(b.h, h, 0.2); };
// the two side dimensions of a typed rectangle: exactly one on a horizontal and one on a vertical side
const sideDims = (sn) => dist(sn).filter((c) => !c.driven && !c.isDriven);

try {
for (const mode of ['rect-2pt', 'rect-center']) {
  const P = mode === 'rect-2pt' ? 'R2' : 'RC';
  const centre = mode === 'rect-center';
  const open = async () => { await k.pickTool('rect', mode); await k.clickW(...C1); await k.moveW(...C2); };
  // expected extents of a typed W x H from the first click
  const ext = (w, h) => (centre ? [w, h] : [w, h]);

  await k.cell(`B-${P}01`, `Rect ${mode}`, 'nothing typed: click then click (baseline)', async () => {
    await open(); await k.clickW(...C2);
  }, { check: (fin) => (sideDims(fin).length ? 'click-click made a driving dim' : (sizeOk(fin, centre ? 100 : 50, centre ? 70 : 35) ? null : `bbox ${JSON.stringify(bbox(fin))}`)) });

  await k.cell(`B-${P}02`, `Rect ${mode}`, 'click only, then Enter (cursor still on the first point)', async () => {
    await k.pickTool('rect', mode); await k.clickW(...C1); await k.pressKey('Enter');
  }, { check: (fin, live) => (lines(fin).length ? 'Enter drew a rectangle with no size' : (!live.box.dual ? 'box closed on a refused Enter' : null)) });

  await k.cell(`B-${P}02b`, `Rect ${mode}`, 'click, Enter (refused, no size), then move: is the box still there? then click C2', async () => {
    await k.pickTool('rect', mode); await k.clickW(...C1); await k.pressKey('Enter');
    const a = await k.snap(); row(`B-${P}02b.afterEnter`, `box dual=${a.box.dual} vals=${JSON.stringify(a.box.dualVals)} focus=${a.box.focus}`);
    await k.moveW(...C2); const b = await k.snap(); row(`B-${P}02b.afterMove`, `box dual=${b.box.dual} vals=${JSON.stringify(b.box.dualVals)}`); await k.clickW(...C2);
  });
  await k.cell(`B-${P}03`, `Rect ${mode}`, 'first field only (W 40), Enter', async () => {
    await open(); await k.typeText('40'); await k.pressKey('Enter');
  }, { check: (fin) => { const w = centre ? 40 : 40; return sizeOk(fin, w, centre ? 70 : 35) && sideDims(fin).length === 1 && near(sideDims(fin)[0].value, 40) ? null : `bbox ${JSON.stringify(bbox(fin))} dims ${JSON.stringify(sideDims(fin).map((d) => d.value))}`; } });

  await k.cell(`B-${P}04`, `Rect ${mode}`, 'second field only (Tab, H 20), Enter', async () => {
    await open(); await k.pressKey('Tab'); await k.typeText('20'); await k.pressKey('Enter');
  }, { check: (fin) => (sizeOk(fin, centre ? 100 : 50, 20) && sideDims(fin).length === 1 && near(sideDims(fin)[0].value, 20) ? null : `bbox ${JSON.stringify(bbox(fin))} dims ${JSON.stringify(sideDims(fin).map((d) => d.value))}`) });

  await k.cell(`B-${P}05`, `Rect ${mode}`, 'both fields (W 40, H 20), Enter', async () => {
    await open(); await k.typeText('40'); await k.pressKey('Tab'); await k.typeText('20'); await k.pressKey('Enter');
  }, { check: (fin) => (sizeOk(fin, 40, 20) && sideDims(fin).length === 2 ? null : `bbox ${JSON.stringify(bbox(fin))} dims ${JSON.stringify(sideDims(fin).map((d) => d.value))}`) });

  await k.cell(`B-${P}06`, `Rect ${mode}`, 'W 40 then retyped 25, Enter', async () => {
    await open(); await k.typeText('40'); await k.selField(0); await k.typeText('25'); await k.pressKey('Enter');
  }, { check: (fin) => (sizeOk(fin, 25, centre ? 70 : 35) && sideDims(fin).length === 1 && near(sideDims(fin)[0].value, 25) ? null : `bbox ${JSON.stringify(bbox(fin))} dims ${JSON.stringify(sideDims(fin).map((d) => d.value))}`) });

  await k.cell(`B-${P}07`, `Rect ${mode}`, 'W 40 then Backspace x2 (empty): unlocks? then cursor to C2b, Enter', async () => {
    await open(); await k.typeText('40'); await k.pressKey('Backspace'); await k.pressKey('Backspace'); await k.moveW(...C2b); await k.pressKey('Enter');
  }, { check: (fin) => { const w = Math.abs(C2b[0] - C1[0]) * (centre ? 2 : 1); return sizeOk(fin, w, Math.abs(C2b[1] - C1[1]) * (centre ? 2 : 1)) && !sideDims(fin).length ? null : `bbox ${JSON.stringify(bbox(fin))} dims ${sideDims(fin).length}`; } });

  await k.cell(`B-${P}08`, `Rect ${mode}`, 'W 40 H 20 typed, then the mouse moves to the OPPOSITE quadrant, Enter: size holds, side follows', async () => {
    await open(); await k.typeText('40'); await k.pressKey('Tab'); await k.typeText('20'); await k.moveW(...C2b); await k.pressKey('Enter');
  }, { check: (fin) => { const b = bbox(fin); return b && near(b.w, 40) && near(b.h, 20) && b.x1 <= C1[0] + 0.1 && b.y1 <= C1[1] + 0.1 ? null : `bbox ${JSON.stringify(b)}: not extended up-left`; } });

  await k.cell(`B-${P}09`, `Rect ${mode}`, 'W 40 H 20 typed, commit by CLICK at C2', async () => {
    await open(); await k.typeText('40'); await k.pressKey('Tab'); await k.typeText('20'); await k.clickW(...C2);
  }, { check: (fin) => (sizeOk(fin, 40, 20) && sideDims(fin).length === 2 ? null : `bbox ${JSON.stringify(bbox(fin))} dims ${JSON.stringify(sideDims(fin).map((d) => d.value))}`) });

  await k.cell(`B-${P}10`, `Rect ${mode}`, 'first click ON the origin (fixed point) + W 40 H 20: coincident with the origin', async () => {
    await k.pickTool('rect', mode); await k.clickW(0, 0); await k.moveW(30, 20); await k.typeText('40'); await k.pressKey('Tab'); await k.typeText('20'); await k.pressKey('Enter');
  }, { check: (fin) => (fin.cons.some((c) => c.type === 'coincident' && JSON.stringify(c.joints).includes('j_origin')) ? null : 'first click on the origin made no coincident') });

  await k.cell(`B-${P}11`, `Rect ${mode}`, 'first click on an existing endpoint (a line end) + W 40, Enter', async () => {
    await k.pickTool('line'); await k.clickW(-60, 20); await k.moveW(-60, 35); await k.clickW(-60, 35); await k.pressKey('Escape'); await k.pressKey('Escape');
    await k.pickTool('rect', mode); await k.clickW(-60, 35); await k.moveW(-20, 20); await k.typeText('40'); await k.pressKey('Enter');
  }, { check: (fin) => (fin.cons.some((c) => c.type === 'coincident') ? null : 'first click on the endpoint made no coincident') });

  await k.cell(`B-${P}12`, `Rect ${mode}`, 'typed W 40 H 20 while the cursor sits on an existing point (snap): typed size wins, no coincident', async () => {
    await k.pickTool('line'); await k.clickW(60, -30); await k.moveW(80, -30); await k.clickW(80, -30); await k.pressKey('Escape'); await k.pressKey('Escape');
    await k.pickTool('rect', mode); await k.clickW(0, 0); await k.moveW(80, -30); await k.typeText('40'); await k.pressKey('Tab'); await k.typeText('20'); await k.pressKey('Enter');
  }, { check: (fin) => { const b = bbox(fin.shapes.filter((s) => s.type === 'line').length > 1 ? { shapes: fin.shapes.filter((s) => s.type === 'line').slice(1) } : fin); return null; } });

  await k.cell(`B-${P}13`, `Rect ${mode}`, 'formula: a named dim d1 first, then W "d1 / 2", H "d1 / 4"', async () => {
    await k.pickTool('line'); await k.clickW(-30, -35); await k.moveW(10, -35); await k.typeText('40'); await k.pressKey('Enter'); await k.pressKey('Escape'); await k.pressKey('Escape');
    await open(); await k.typeText('d1 / 2'); await k.pressKey('Tab'); await k.typeText('d1 / 4'); await k.pressKey('Enter');
  }, { check: (fin) => { const d = dist(fin).filter((x) => x.expression); return d.length === 2 && d.some((x) => /d1\s*\/\s*2/.test(x.expression) && near(x.value, 20)) && d.some((x) => /d1\s*\/\s*4/.test(x.expression) && near(x.value, 10)) ? null : `dims ${JSON.stringify(dist(fin).map((x) => [x.name, x.value, x.expression]))}`; } });

  await k.cell(`B-${P}14`, `Rect ${mode}`, 'names: W "w = 50", H "h = 30"', async () => {
    await open(); await k.typeText('w = 50'); await k.pressKey('Tab'); await k.typeText('h = 30'); await k.pressKey('Enter');
  }, { check: (fin) => { const d = dist(fin); return d.some((x) => x.name === 'w' && near(x.value, 50)) && d.some((x) => x.name === 'h' && near(x.value, 30)) ? null : `dims ${JSON.stringify(d.map((x) => [x.name, x.value]))}`; } });

  await k.cell(`B-${P}15`, `Rect ${mode}`, 'existing parameter: rect 1 "w = 50" then rect 2 with W "w" and H "w / 2"', async () => {
    await open(); await k.typeText('w = 50'); await k.pressKey('Tab'); await k.typeText('30'); await k.pressKey('Enter');
    await k.pickTool('rect', mode); await k.clickW(50, -30); await k.moveW(80, -10); await k.typeText('w'); await k.pressKey('Tab'); await k.typeText('w / 2'); await k.pressKey('Enter');
  }, { check: (fin) => { const d = dist(fin).filter((x) => x.expression); return d.some((x) => x.expression === 'w') && d.some((x) => /w\s*\/\s*2/.test(x.expression)) ? null : `dims ${JSON.stringify(dist(fin).map((x) => [x.name, x.value, x.expression]))}`; } });

  for (const [id, txt, want, label] of [['a', '2 in', 50.8, '"2 in"'], ['b', '25.4mm', 25.4, '"25.4mm"'], ['c', '1/2"', 12.7, '1/2"']]) {
    await k.cell(`B-${P}16${id}`, `Rect ${mode}`, `units W ${label} in an mm document, Enter`, async () => {
      await open(); await k.typeText(txt); await k.pressKey('Enter');
    }, { check: (fin) => { const b = bbox(fin); return b && near(b.w, want, 0.02) ? null : `bbox ${JSON.stringify(b)}`; } });
  }
  for (const [id, txt, label] of [['a', '0', 'W 0'], ['b', '-5', 'W -5'], ['c', '99999', 'W 99999'], ['d', '40abc', 'W "40abc"'], ['e', 'abc', 'W "abc"']]) {
    await k.cell(`B-${P}17${id}`, `Rect ${mode}`, `${label}, Enter`, async () => {
      await open(); await k.typeText(txt); await k.pressKey('Enter');
    }, { check: (fin, live) => (id === 'c' ? (lines(fin).length ? 'accepted (no upper limit)' : null) : (lines(fin).length === 0 && live.box.dual ? null : `shapes ${lines(fin).length}, boxOpen ${live.box.dual}`)) });
  }
  await k.cell(`B-${P}18`, `Rect ${mode}`, 'H 0 typed after valid W, Enter', async () => {
    await open(); await k.typeText('40'); await k.pressKey('Tab'); await k.typeText('0'); await k.pressKey('Enter');
  }, { check: (fin, live) => (lines(fin).length === 0 && live.box.dual ? null : `shapes ${lines(fin).length}, boxOpen ${live.box.dual}`) });
  await k.cell(`B-${P}19`, `Rect ${mode}`, 'click while a typed W is refused (W 0 typed, click at C2)', async () => {
    await open(); await k.typeText('0'); await k.clickW(...C2);
  }, { check: (fin, live) => (lines(fin).length === 0 && live.box.dual ? null : `shapes ${lines(fin).length}, boxOpen ${live.box.dual}`) });
  await k.cell(`B-${P}20`, `Rect ${mode}`, 'undo steps for a typed rectangle (both fields)', async () => {
    await open(); await k.typeText('40'); await k.pressKey('Tab'); await k.typeText('20'); await k.pressKey('Enter');
  }, { check: (fin) => null });
}

// ── 3-point rectangle ──
const B1 = [-50, -10], B2 = [0, -10], B3 = [0, 20];
await k.cell('B-R301', 'Rect 3-point', 'nothing typed: click, click, click (baseline)', async () => {
  await k.pickTool('rect', 'rect-3pt'); await k.clickW(...B1); await k.moveW(...B2); await k.clickW(...B2); await k.moveW(...B3); await k.clickW(...B3);
}, { check: (fin) => (sizeOk(fin, 50, 30) && !sideDims(fin).length ? null : `bbox ${JSON.stringify(bbox(fin))}`) });
await k.cell('B-R302', 'Rect 3-point', 'after click 1: does a box open on its own?', async () => {
  await k.pickTool('rect', 'rect-3pt'); await k.clickW(...B1); await k.moveW(...B2);
}, { check: (fin, live) => (live.box.dual || live.box.single ? null : 'no size box after the first click (the 2-point / centre rectangles open W x H here)') });
await k.cell('B-R303', 'Rect 3-point', 'after click 1: type 40 (opens a box?), Enter', async () => {
  await k.pickTool('rect', 'rect-3pt'); await k.clickW(...B1); await k.moveW(...B2); await k.typeText('40'); await k.pressKey('Enter');
}, { check: (fin) => (sizeOk(fin, 40, 0) || (bbox(fin) && near(bbox(fin).w, 40)) ? null : `bbox ${JSON.stringify(bbox(fin))} dims ${JSON.stringify(sideDims(fin).map((d) => d.value))}`) });
await k.cell('B-R304', 'Rect 3-point', 'after click 1: type 40, Tab, 20, Enter', async () => {
  await k.pickTool('rect', 'rect-3pt'); await k.clickW(...B1); await k.moveW(...B2); await k.typeText('40'); await k.pressKey('Tab'); await k.typeText('20'); await k.pressKey('Enter');
}, { check: (fin) => (sizeOk(fin, 40, 20) ? null : `bbox ${JSON.stringify(bbox(fin))} dims ${JSON.stringify(sideDims(fin).map((d) => d.value))}`) });
await k.cell('B-R305', 'Rect 3-point', 'after click 2 (base set): box open?', async () => {
  await k.pickTool('rect', 'rect-3pt'); await k.clickW(...B1); await k.moveW(...B2); await k.clickW(...B2); await k.moveW(...B3);
}, { check: (fin, live) => (live.box.dual || live.box.single ? null : 'no height box after the base click') });
await k.cell('B-R306', 'Rect 3-point', 'after click 2: type 20 (height), Enter', async () => {
  await k.pickTool('rect', 'rect-3pt'); await k.clickW(...B1); await k.moveW(...B2); await k.clickW(...B2); await k.moveW(...B3); await k.typeText('20'); await k.pressKey('Enter');
}, { check: (fin) => (sizeOk(fin, 50, 20) ? null : `bbox ${JSON.stringify(bbox(fin))} dims ${JSON.stringify(sideDims(fin).map((d) => d.value))}`) });
await k.cell('B-R307', 'Rect 3-point', 'after click 2: type 20 (height), commit by CLICK at B3', async () => {
  await k.pickTool('rect', 'rect-3pt'); await k.clickW(...B1); await k.moveW(...B2); await k.clickW(...B2); await k.moveW(...B3); await k.typeText('20'); await k.clickW(...B3);
}, { check: (fin) => (sizeOk(fin, 50, 20) ? null : `bbox ${JSON.stringify(bbox(fin))}`) });
await k.cell('B-R308', 'Rect 3-point', 'after click 2: type 40 Tab 20 Enter (a dual box on the third step?)', async () => {
  await k.pickTool('rect', 'rect-3pt'); await k.clickW(...B1); await k.moveW(...B2); await k.clickW(...B2); await k.moveW(...B3); await k.typeText('40'); await k.pressKey('Tab'); await k.typeText('20'); await k.pressKey('Enter');
}, { check: (fin) => (sizeOk(fin, 50, 20) ? null : `bbox ${JSON.stringify(bbox(fin))}`) });
await k.cell('B-R309', 'Rect 3-point', 'after click 2: type 0, Enter', async () => {
  await k.pickTool('rect', 'rect-3pt'); await k.clickW(...B1); await k.moveW(...B2); await k.clickW(...B2); await k.moveW(...B3); await k.typeText('0'); await k.pressKey('Enter');
}, { check: (fin, live) => (lines(fin).length === 0 && (live.box.dual || live.box.single) ? null : `shapes ${lines(fin).length}`) });
await k.cell('B-R310', 'Rect 3-point', 'after click 2: formula/name: "h = 20"', async () => {
  await k.pickTool('rect', 'rect-3pt'); await k.clickW(...B1); await k.moveW(...B2); await k.clickW(...B2); await k.moveW(...B3); await k.typeText('h = 20'); await k.pressKey('Enter');
}, { check: (fin) => (dist(fin).some((d) => d.name === 'h') ? null : `dims ${JSON.stringify(dist(fin).map((x) => [x.name, x.value]))}`) });
await k.cell('B-R311', 'Rect 3-point', 'first and second click on existing points (snap): coincidents made', async () => {
  await k.pickTool('line'); await k.clickW(-50, -10); await k.moveW(-50, 5); await k.clickW(-50, 5); await k.pressKey('Escape'); await k.pressKey('Escape');
  await k.pickTool('rect', 'rect-3pt'); await k.clickW(-50, 5); await k.moveW(0, 5); await k.clickW(0, 5); await k.moveW(0, 30); await k.clickW(0, 30);
}, { check: (fin) => (fin.cons.some((c) => c.type === 'coincident') ? null : 'first click on the endpoint made no coincident') });
} finally { await k.close(); }
