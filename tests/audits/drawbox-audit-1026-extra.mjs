// tests/audits/drawbox-audit-1026-extra.mjs — TASK 1026 (AUDIT ONLY): follow-up cells found while reading the first runs (rows B-X*)
// Run: node tests/audits/drawbox-audit-1026-extra.mjs
import { start, row, f } from './drawbox-audit-1026-kit.js';

const k = await start({ tag: '1026-extra', view: { cx: 0, cy: 0, vw: 220 } });
const near = (a, b, t = 0.06) => Math.abs(a - b) <= t;
const lines = (sn) => sn.shapes.filter((s) => s.type === 'line');
const dist = (sn) => sn.cons.filter((c) => c.type === 'distance');
const S = [-60, 10], M1 = [-20, 0], M2 = [-30, 38];
const O = [-30, 0], R1 = [10, 0];

try {
  // right-click finalize control (no typing)
  await k.cell('B-X01', 'Line', 'control: right-click on the canvas with NOTHING typed (finalizes the segment)', async () => {
    await k.pickTool('line'); await k.clickW(...S); await k.moveW(...M2); await k.clickW(...M2, { button: 'right' });
  }, { check: (fin) => (lines(fin).length === 1 ? null : `lines ${lines(fin).length}`) });
  await k.cell('B-X02', 'Line', 'right-click with a typed length 40 and cursor at M2 (1 mm from the typed end): one segment?', async () => {
    await k.pickTool('line'); await k.clickW(...S); await k.moveW(...M2); await k.typeText('40'); await k.clickW(...M2, { button: 'right' });
  }, { check: (fin) => (lines(fin).length === 1 ? null : `lines ${lines(fin).length} lens ${JSON.stringify(lines(fin).map((l) => f(l.len)))}`) });
  // typed length ends within 0.5 mm of an unrelated existing joint: is that joint moved / merged?
  await k.cell('B-X03', 'Line', 'typed length 40 whose end lands 0.3 mm from an existing endpoint (no snap on it): merged? is the old point moved?', async () => {
    await k.pickTool('line'); await k.clickW(10, 30); await k.moveW(10, 40); await k.clickW(10, 40); await k.pressKey('Escape'); await k.pressKey('Escape');
    const before = await k.snap(); row('B-X03.before', k.sum(before));
    await k.pickTool('line'); await k.clickW(-30, 30.3 - 0.0); await k.moveW(10, 30); await k.typeText('40.3'); await k.pressKey('Enter');
  }, { check: (fin) => { const l = lines(fin); return l.length === 2 && l.every((x) => Math.abs(x.p[0] - 10) > 1 || Math.abs(x.p[1] - 30) < 0.05) ? null : `lines ${JSON.stringify(l.map((x) => x.p.map((v) => f(v))))}`; } });
  // angle box: names, formulas
  await k.cell('B-X04', 'Line', 'angle box: a name "ang = 30" (Tab first), Enter', async () => {
    await k.pickTool('line'); await k.clickW(...S); await k.moveW(...M1); await k.pressKey('Tab'); await k.typeText('ang = 30'); await k.pressKey('Enter');
  }, { check: (fin, live) => (lines(fin).length === 1 ? null : `no line; hint "${live.box.hint}"`) });
  await k.cell('B-X05', 'Line', 'angle box: formula "90 / 3" (Tab first), Enter', async () => {
    await k.pickTool('line'); await k.clickW(...S); await k.moveW(...M1); await k.pressKey('Tab'); await k.typeText('90 / 3'); await k.pressKey('Enter');
  }, { check: (fin) => (lines(fin).length === 1 && near(lines(fin)[0].ang, 30, 0.3) ? null : `lines ${JSON.stringify(lines(fin).map((x) => f(x.ang)))}`) });
  await k.cell('B-X06', 'Line', 'angle typed 30 then Backspace x2 (empty): unlocks? cursor to M2, Enter', async () => {
    await k.pickTool('line'); await k.clickW(...S); await k.moveW(...M1); await k.pressKey('Tab'); await k.typeText('30'); await k.pressKey('Backspace'); await k.pressKey('Backspace'); await k.moveW(...M2); await k.pressKey('Enter');
  }, { check: (fin) => { const a = -Math.atan2(M2[1] - S[1], M2[0] - S[0]) * 180 / Math.PI; return lines(fin).length === 1 && near(lines(fin)[0].ang, a, 1.5) ? null : `ang ${lines(fin)[0] && f(lines(fin)[0].ang)} want ${f(a)}`; } });
  await k.cell('B-X07', 'Line', 'phone-style: after typing a length, does the second field show the live angle (not stale)? read both fields after a mouse move', async () => {
    await k.pickTool('line'); await k.clickW(...S); await k.moveW(...M1); await k.typeText('40'); await k.moveW(...M2);
    const b = await k.snap(); row('B-X07.box', `fields ${JSON.stringify(b.box.dualVals)} (the angle follows the cursor; typed length holds)`);
  });
  // circle: Tab then Enter -> which element took the focus
  await k.cell('B-X08', 'Circle', 'Tab inside the single box, then Enter: what takes the focus / does a toolbar button fire?', async () => {
    await k.pickTool('circle'); await k.clickW(...O); await k.moveW(...R1); await k.typeText('60'); await k.pressKey('Tab');
    const a = await k.cdp.evalJs(`(() => { const e = document.activeElement; return e ? (e.tagName + '#' + (e.id || '') + ' "' + (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 30) + '"') : null; })()`);
    row('B-X08.focus', `after Tab: ${a}`);
    await k.pressKey('Enter');
  });
  // arc: radius cleared then click ; sweep cleared then Enter
  await k.cell('B-X09', 'Arc', 'radius 25, Backspace x2 (empty), commit the START by CLICK at the cursor (radius 40): unlocked?', async () => {
    await k.pickTool('arc'); await k.clickW(...O); await k.moveW(...R1); await k.typeText('25'); await k.pressKey('Backspace'); await k.pressKey('Backspace'); await k.clickW(...R1); await k.moveW(-30, -40); await k.clickW(-30, -40);
  }, { check: (fin) => { const a = fin.shapes.find((s) => s.type === 'arc'); return a && near(Math.hypot(a.pts[1][0] - a.pts[0][0], a.pts[1][1] - a.pts[0][1]), 40, 0.5) ? null : `start ${JSON.stringify(a && a.pts)}`; } });
  await k.cell('B-X10', 'Arc', 'sweep 90, Backspace x2 (empty), Enter: unlocked (box then holds nothing)?', async () => {
    await k.pickTool('arc'); await k.clickW(...O); await k.moveW(...R1); await k.clickW(...R1); await k.moveW(-10, -28); await k.typeText('90'); await k.pressKey('Backspace'); await k.pressKey('Backspace'); await k.pressKey('Enter');
  }, { check: (fin, live) => (live.box.single && !fin.shapes.length ? null : `box ${live.box.single} shapes ${fin.shapes.length}`) });
  await k.cell('B-X11', 'Arc', 'radius "rr = 25" (a legal name)', async () => {
    await k.pickTool('arc'); await k.clickW(...O); await k.moveW(...R1); await k.typeText('rr = 25'); await k.pressKey('Enter'); await k.moveW(-5, -20); await k.typeText('90'); await k.pressKey('Enter');
  }, { check: (fin) => (dist(fin).some((d) => d.name === 'rr' && d.isRadius) ? null : `dims ${JSON.stringify(dist(fin))}`) });
  // polygon: N cleared falls back to the remembered count?
  await k.cell('B-X12', 'Polygon', 'a first polygon with N 9 (remembered), then a second: N 4 typed, Backspace (empty), Enter: falls back to 9?', async () => {
    await k.pickTool('polygon'); await k.clickW(-30, 0); await k.moveW(10, 0); await k.typeText('20'); await k.pressKey('Tab'); await k.typeText('9'); await k.pressKey('Enter');
    await k.pickTool('polygon'); await k.clickW(40, 0); await k.moveW(70, 0); await k.typeText('20'); await k.pressKey('Tab'); await k.typeText('4'); await k.pressKey('Backspace'); await k.pressKey('Enter');
  }, { check: (fin) => { const n = fin.shapes.filter((s) => s.type === 'line').length; return n === 36 ? null : `lines ${n} (2 x 9 sides x 2 = 36 expected if the second fell back to 9)`; } });
  // the box right after Enter on a chain and Backspace on the chain's second box
  await k.cell('B-X13', 'Line', 'chain: seg 2 box, type 25, Backspace x2, Enter (seg 2 unlocked?)', async () => {
    await k.pickTool('line'); await k.clickW(...S); await k.moveW(...M1); await k.typeText('40'); await k.pressKey('Enter'); await k.moveW(20, 30); await k.typeText('25'); await k.pressKey('Backspace'); await k.pressKey('Backspace'); await k.pressKey('Enter');
  }, { check: (fin) => { const l = lines(fin); return l.length === 2 && !near(l[1].len, 2.0, 0.5) ? null : `lens ${JSON.stringify(l.map((x) => f(x.len)))}`; } });
} finally { await k.close(); }
