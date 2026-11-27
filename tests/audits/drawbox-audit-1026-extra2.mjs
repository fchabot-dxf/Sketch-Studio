// tests/audits/drawbox-audit-1026-extra2.mjs — TASK 1026 (AUDIT ONLY): inch document, over-constrain, Bezier (rows B-I*, B-OC*, B-BZ*)
// Run: node tests/audits/drawbox-audit-1026-extra2.mjs
import { start, row, f } from './drawbox-audit-1026-kit.js';

const k = await start({ tag: '1026-extra2', view: { cx: 0, cy: 0, vw: 220 } });
const near = (a, b, t = 0.06) => Math.abs(a - b) <= t;
const lines = (sn) => sn.shapes.filter((s) => s.type === 'line');
const circles = (sn) => sn.shapes.filter((s) => s.type === 'circle');
const dist = (sn) => sn.cons.filter((c) => c.type === 'distance');
const S = [-60, 10], M1 = [-20, 0], O = [-30, 0], R1 = [10, 0];
const bboxW = (sn) => { const L = lines(sn); const xs = L.flatMap((l) => [l.p[0], l.p[2]]); return Math.max(...xs) - Math.min(...xs); };
const inchOn = async () => { await k.setDocUnit('in'); };

try {
  // ───────── inch document ─────────
  for (const [id, txt, want, label] of [['a', '2', 50.8, 'a bare 2 (= 2 in)'], ['b', '2 in', 50.8, '"2 in"'], ['c', '25.4mm', 25.4, '"25.4mm"'], ['d', '1/2"', 12.7, '1/2"'], ['e', '1.5', 38.1, 'a bare 1.5'], ['f', '3 mm', 3, '"3 mm"'], ['g', '1/2', 12.7, 'a bare fraction 1/2']]) {
    await k.cell(`B-IL${id}`, 'Line (inch doc)', `length ${label}, Enter`, async () => {
      await inchOn(); await k.pickTool('line'); await k.clickW(...S); await k.moveW(...M1);
      if (id === 'a') row('B-ILa.box', `prefilled boxes in an inch document: ${JSON.stringify((await k.snap()).box.dualVals)}`);
      await k.typeText(txt); await k.pressKey('Enter');
    }, { check: (fin) => { const l = lines(fin)[0]; return l && near(l.len, want, 0.02) ? null : `len ${l && f(l.len, 3)} want ${want}`; } });
  }
  for (const [id, txt, want, label] of [['a', '2', 50.8, 'W bare 2'], ['b', '25.4mm', 25.4, 'W "25.4mm"']]) {
    await k.cell(`B-IR${id}`, 'Rect (inch doc)', `${label}, Enter`, async () => {
      await inchOn(); await k.pickTool('rect', 'rect-2pt'); await k.clickW(-40, -10); await k.moveW(10, 25); await k.typeText(txt); await k.pressKey('Enter');
    }, { check: (fin) => (near(bboxW(fin), want, 0.02) ? null : `w ${f(bboxW(fin), 3)} want ${want}`) });
  }
  for (const [id, txt, want, label] of [['a', '2', 25.4, 'Ø bare 2 (= 2 in, r 25.4)'], ['b', '1/2"', 6.35, 'Ø 1/2"']]) {
    await k.cell(`B-IC${id}`, 'Circle (inch doc)', `${label}, Enter`, async () => {
      await inchOn(); await k.pickTool('circle'); await k.clickW(...O); await k.moveW(...R1); await k.typeText(txt); await k.pressKey('Enter');
    }, { check: (fin) => (circles(fin).length === 1 && near(circles(fin)[0].r, want, 0.02) ? null : `r ${circles(fin)[0] && f(circles(fin)[0].r, 3)} want ${want}`) });
  }
  await k.cell('B-ID', 'Arc (inch doc)', 'radius bare 1 (= 1 in) then sweep 90', async () => {
    await inchOn(); await k.pickTool('arc'); await k.clickW(...O); await k.moveW(...R1); await k.typeText('1'); await k.pressKey('Enter'); await k.moveW(-5, -20); await k.typeText('90'); await k.pressKey('Enter');
  }, { check: (fin) => (dist(fin).some((d) => d.isRadius && near(d.value, 25.4, 0.02)) ? null : `dims ${JSON.stringify(dist(fin))}`) });
  await k.cell('B-IE', 'Polygon (inch doc)', 'R bare 1 (= 1 in)', async () => {
    await inchOn(); await k.pickTool('polygon'); await k.clickW(...O); await k.moveW(...R1); await k.typeText('1'); await k.pressKey('Enter');
  }, { check: (fin) => (dist(fin).some((d) => near(d.value, 25.4, 0.02)) ? null : `dims ${JSON.stringify(dist(fin))}`) });
  await k.cell('B-IF', 'Slot (inch doc)', 'span bare 2 (= 2 in), width bare 0.5', async () => {
    await inchOn(); await k.pickTool('slot', 'slot-c2c'); await k.clickW(-50, 5); await k.moveW(-5, -15); await k.typeText('2'); await k.pressKey('Enter'); await k.moveW(-25, 22); await k.typeText('0.5'); await k.pressKey('Enter');
  }, { check: (fin) => (dist(fin).some((d) => near(d.value, 50.8, 0.02)) && dist(fin).some((d) => near(d.value, 12.7, 0.02)) ? null : `dims ${JSON.stringify(dist(fin).map((d) => d.value))}`) });
  await k.cell('B-IG', 'Fillet (inch doc)', 'radius bare 0.25 (= 0.25 in)', async () => {
    await inchOn(); await k.pickTool('rect', 'rect-2pt'); await k.clickW(-40, -10); await k.moveW(10, 25); await k.clickW(10, 25); await k.pressKey('Escape'); await k.pressKey('Escape');
    await k.pickTool('fillet'); await k.clickW(-40, -10); await k.typeText('0.25'); await k.pressKey('Enter');
  }, { check: (fin) => (dist(fin).some((d) => d.isRadius && near(d.value, 6.35, 0.02)) ? null : `dims ${JSON.stringify(dist(fin))}`) });
  await k.cell('B-IH', 'Line (inch doc)', 'angle box in an inch document: unaffected (30)', async () => {
    await inchOn(); await k.pickTool('line'); await k.clickW(...S); await k.moveW(...M1); await k.pressKey('Tab'); await k.typeText('30'); await k.pressKey('Enter');
  }, { check: (fin) => (lines(fin).length === 1 && near(lines(fin)[0].ang, 30, 0.3) ? null : `ang ${lines(fin)[0] && f(lines(fin)[0].ang)}`) });

  // ───────── over-constrain: a typed length against a LOCKED point ─────────
  const lockAt = async (x, y) => { await k.setDocUnit('mm'); await k.pickTool('select'); await k.clickW(x, y); await k.clickEl('#btn-lock'); await k.pressKey('Escape'); };
  await k.cell('B-OC1', 'Line', 'start at the fixed origin, existing endpoint LOCKED 0.3 mm beyond the typed length: end merges with the locked point?', async () => {
    await k.pickTool('line'); await k.clickW(40, 0); await k.moveW(40, -20); await k.clickW(40, -20); await k.pressKey('Escape'); await k.pressKey('Escape');
    await lockAt(40, 0);
    await k.pickTool('line'); await k.clickW(0, 0); await k.moveW(40, 0); await k.typeText('40.3'); await k.pressKey('Enter');
  }, { check: (fin, live) => (live.st.toasts.length ? null : 'no warning for a typed length that conflicts with a locked point') });
  await k.cell('B-OC2', 'Line', 'typed length 40 exactly to a locked point: a redundant dimension?', async () => {
    await k.pickTool('line'); await k.clickW(40, 0); await k.moveW(40, -20); await k.clickW(40, -20); await k.pressKey('Escape'); await k.pressKey('Escape');
    await lockAt(40, 0);
    await k.pickTool('line'); await k.clickW(0, 0); await k.moveW(40, 0); await k.typeText('40'); await k.pressKey('Enter');
  }, { check: (fin, live) => null });
  await k.cell('B-OC3', 'Rect', 'W 40 H 20 with the first corner on the origin (fixed) and the opposite corner on a locked point: typed vs locked', async () => {
    await k.pickTool('line'); await k.clickW(30, 30); await k.moveW(30, 40); await k.clickW(30, 40); await k.pressKey('Escape'); await k.pressKey('Escape');
    await lockAt(30, 30);
    await k.pickTool('rect', 'rect-2pt'); await k.clickW(0, 0); await k.moveW(30, 30); await k.typeText('40'); await k.pressKey('Tab'); await k.typeText('20'); await k.pressKey('Enter');
  }, { check: null });

  // ───────── Bezier ─────────
  await k.cell('B-BZ1', 'Bezier', 'does the Bezier tool open any size box? (click, click, click, Enter)', async () => {
    await k.pickTool('bezier'); await k.clickW(-40, 0); await k.moveW(-20, 20); await k.clickW(-20, 20); const a = await k.snap(); row('B-BZ1.box', `after 2 clicks: dual=${a.box.dual} single=${a.box.single}`);
    await k.moveW(0, -10); await k.typeText('40'); const b = await k.snap(); row('B-BZ1.box2', `after typing 40: dual=${b.box.dual} single=${b.box.single}`); await k.pressKey('Enter');
  }, { check: null });
} finally { await k.close(); }
