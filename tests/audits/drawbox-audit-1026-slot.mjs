// tests/audits/drawbox-audit-1026-slot.mjs — TASK 1026 (AUDIT ONLY): Slot span / width boxes, five variants (rows B-S*)
// Run: node tests/audits/drawbox-audit-1026-slot.mjs
import { start, row, f } from './drawbox-audit-1026-kit.js';

const k = await start({ tag: '1026-slot', view: { cx: 0, cy: 0, vw: 220 } });
const near = (a, b, t = 0.08) => Math.abs(a - b) <= t;
const dist = (sn) => sn.cons.filter((c) => c.type === 'distance');
const P1 = [-50, 5];       // first click
const P2 = [0, 5];         // second click: exactly horizontal, 50 away (cursor for the span)
const P2d = [-5, -15];     // second click: not axis-aligned (53.8 away)
const W1 = [-25, 22];      // width cursor (17 off the axis -> width 34)
/** bounding box of everything drawn (lines + arcs' joints) */
function bbox(sn) {
  const pts = [];
  for (const s of sn.shapes) { if (s.p) pts.push([s.p[0], s.p[1]], [s.p[2], s.p[3]]); if (s.pts) pts.push(...s.pts); if (s.c) pts.push(s.c); }
  if (!pts.length) return null;
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys), n: sn.shapes.length };
}
const drawn = (sn) => sn.shapes.length > 0;
const typedDims = (sn) => dist(sn).filter((c) => !c.driven && !c.isDriven);

try {
  for (const mode of ['slot-c2c', 'slot-overall', 'slot-center']) {
    const P = mode === 'slot-c2c' ? 'C2C' : mode === 'slot-overall' ? 'OV' : 'CP';
    const open = async (to = P2d) => { await k.pickTool('slot', mode); await k.clickW(...P1); await k.moveW(...to); };
    const toWidth = async (spanText = null) => { await open(); if (spanText) { await k.typeText(spanText); await k.pressKey('Enter'); } else { await k.clickW(...P2d); } await k.moveW(...W1); };

    await k.cell(`B-${P}01`, `Slot ${mode}`, 'nothing typed: click, click, click (baseline)', async () => { await open(); await k.clickW(...P2d); await k.moveW(...W1); await k.clickW(...W1); },
      { check: (fin) => (drawn(fin) && !typedDims(fin).length ? null : `shapes ${fin.shapes.length} dims ${typedDims(fin).length}`) });
    await k.cell(`B-${P}02`, `Slot ${mode}`, 'click only (span box), Enter with no length', async () => { await k.pickTool('slot', mode); await k.clickW(...P1); await k.pressKey('Enter'); },
      { check: (fin, live) => (drawn(fin) ? 'Enter drew a slot with no span' : (!live.box.single ? 'box closed on a refused Enter' : null)) });
    await k.cell(`B-${P}03`, `Slot ${mode}`, 'span only (40), Enter, then width by click', async () => {
      await toWidth('40'); const mid = await k.snap(); row(`B-${P}03.mid`, `after span Enter: box single=${mid.box.single} val=${mid.box.singleVal} focus=${mid.box.focus}`); await k.clickW(...W1);
    }, { check: (fin) => { const d = typedDims(fin); return drawn(fin) && d.length === 1 && near(d[0].value, 40) ? null : `shapes ${fin.shapes.length} dims ${JSON.stringify(dist(fin).map((x) => [x.value, x.name]))}`; } });
    await k.cell(`B-${P}04`, `Slot ${mode}`, 'width only (12): spans by click, width typed, Enter', async () => { await toWidth(); await k.typeText('12'); await k.pressKey('Enter'); },
      { check: (fin) => { const d = typedDims(fin); return drawn(fin) && d.length === 1 && near(d[0].value, 12) ? null : `shapes ${fin.shapes.length} dims ${JSON.stringify(dist(fin).map((x) => [x.value, x.name, x.driven]))}`; } });
    await k.cell(`B-${P}05`, `Slot ${mode}`, 'both: span 40 Enter, width 12 Enter', async () => { await toWidth('40'); await k.typeText('12'); await k.pressKey('Enter'); },
      { check: (fin) => { const d = typedDims(fin).map((x) => x.value).sort((a, b) => a - b); return drawn(fin) && d.length === 2 && near(d[0], 12) && near(d[1], 40) ? null : `shapes ${fin.shapes.length} dims ${JSON.stringify(dist(fin).map((x) => [x.value, x.name, x.driven]))}`; } });
    await k.cell(`B-${P}06`, `Slot ${mode}`, 'span 40 then retyped 25, Enter, width by click', async () => { await open(); await k.typeText('40'); await k.selField(0); await k.typeText('25'); await k.pressKey('Enter'); await k.moveW(...W1); await k.clickW(...W1); },
      { check: (fin) => { const d = typedDims(fin); return drawn(fin) && d.length === 1 && near(d[0].value, 25) ? null : `dims ${JSON.stringify(dist(fin).map((x) => [x.value]))}`; } });
    await k.cell(`B-${P}07`, `Slot ${mode}`, 'span 40 then Backspace x2 (empty): unlocks, then click the end', async () => { await open(); await k.typeText('40'); await k.pressKey('Backspace'); await k.pressKey('Backspace'); await k.clickW(...P2d); await k.moveW(...W1); await k.clickW(...W1); },
      { check: (fin) => (drawn(fin) && !typedDims(fin).length ? null : `dims ${JSON.stringify(dist(fin).map((x) => [x.value, x.driven]))}`) });
    await k.cell(`B-${P}08`, `Slot ${mode}`, 'span 40 typed, mouse moved to the other quadrant (-80,-20): lock holds, direction follows', async () => { await open(); await k.typeText('40'); await k.moveW(-80, -20); await k.pressKey('Enter'); await k.moveW(-70, -10); await k.clickW(-70, -10); },
      { check: (fin) => { const d = typedDims(fin); return drawn(fin) && d.length === 1 && near(d[0].value, 40) ? null : `dims ${JSON.stringify(dist(fin).map((x) => x.value))}`; } });
    await k.cell(`B-${P}09`, `Slot ${mode}`, 'span 40 typed, advance by CLICK (not Enter), width by click', async () => { await open(); await k.typeText('40'); await k.clickW(...P2d); await k.moveW(...W1); await k.clickW(...W1); },
      { check: (fin) => { const d = typedDims(fin); return drawn(fin) && d.length === 1 && near(d[0].value, 40) ? null : `dims ${JSON.stringify(dist(fin).map((x) => x.value))}`; } });
    await k.cell(`B-${P}10`, `Slot ${mode}`, 'width 12 typed, commit by CLICK', async () => { await toWidth(); await k.typeText('12'); await k.clickW(...W1); },
      { check: (fin) => { const d = typedDims(fin); return drawn(fin) && d.length === 1 && near(d[0].value, 12) ? null : `shapes ${fin.shapes.length} dims ${JSON.stringify(dist(fin).map((x) => x.value))}`; } });
    await k.cell(`B-${P}11`, `Slot ${mode}`, 'first click ON an existing point (coincident), second click on another existing point + typed span that differs', async () => {
      await k.pickTool('line'); await k.clickW(-50, 5); await k.moveW(-50, -20); await k.clickW(-50, -20); await k.pressKey('Escape'); await k.pressKey('Escape');
      await k.pickTool('line'); await k.clickW(60, -20); await k.moveW(60, 20); await k.clickW(60, 20); await k.pressKey('Escape'); await k.pressKey('Escape');
      await k.pickTool('slot', mode); await k.clickW(-50, 5); await k.moveW(60, 20); await k.typeText('40'); await k.pressKey('Enter'); await k.moveW(0, 25); await k.clickW(0, 25);
    }, { check: (fin) => (fin.cons.some((c) => c.type === 'coincident') ? null : 'no coincident from the first click on a point') });
    await k.cell(`B-${P}12`, `Slot ${mode}`, 'second click on an existing point, NOTHING typed (control)', async () => {
      await k.pickTool('line'); await k.clickW(60, -20); await k.moveW(60, 20); await k.clickW(60, 20); await k.pressKey('Escape'); await k.pressKey('Escape');
      await k.pickTool('slot', mode); await k.clickW(-50, 5); await k.moveW(60, 20); await k.clickW(60, 20); await k.moveW(0, 25); await k.clickW(0, 25);
    }, { check: (fin) => (fin.cons.some((c) => c.type === 'coincident' || c.type === 'pointOnLine') ? null : 'second click on a point made no constraint') });
    await k.cell(`B-${P}13`, `Slot ${mode}`, 'H inference: cursor exactly horizontal, typed span 40 [R1-08, task 1021]', async () => { await open(P2); await k.typeText('40'); await k.pressKey('Enter'); await k.moveW(-25, 22); await k.clickW(-25, 22); },
      { check: (fin) => (fin.cons.some((c) => c.type === 'horizontal') ? null : 'no horizontal on the centre line (R1-08, task 1021)') });
    await k.cell(`B-${P}14`, `Slot ${mode}`, 'H inference, NOTHING typed (control): exactly horizontal click', async () => { await open(P2); await k.clickW(...P2); await k.moveW(-25, 22); await k.clickW(-25, 22); },
      { check: (fin) => (fin.cons.some((c) => c.type === 'horizontal') ? null : 'no horizontal on the centre line even by click (R1-08, task 1021)') });
    await k.cell(`B-${P}15`, `Slot ${mode}`, 'formula: d1 = a line of 40 first, then span "d1 / 2" and width "d1 / 4"', async () => {
      await k.pickTool('line'); await k.clickW(-30, -35); await k.moveW(10, -35); await k.typeText('40'); await k.pressKey('Enter'); await k.pressKey('Escape'); await k.pressKey('Escape');
      await open(); await k.typeText('d1 / 2'); await k.pressKey('Enter'); await k.moveW(...W1); await k.typeText('d1 / 4'); await k.pressKey('Enter');
    }, { check: (fin) => { const d = dist(fin).filter((x) => x.expression); return d.length === 2 && d.some((x) => /d1\s*\/\s*2/.test(x.expression)) && d.some((x) => /d1\s*\/\s*4/.test(x.expression)) ? null : `dims ${JSON.stringify(dist(fin).map((x) => [x.name, x.value, x.expression]))}`; } });
    await k.cell(`B-${P}16`, `Slot ${mode}`, 'names: span "len = 50", width "wd = 10"', async () => { await open(); await k.typeText('len = 50'); await k.pressKey('Enter'); await k.moveW(...W1); await k.typeText('wd = 10'); await k.pressKey('Enter'); },
      { check: (fin) => { const d = dist(fin); return d.some((x) => x.name === 'len' && near(x.value, 50)) && d.some((x) => x.name === 'wd' && near(x.value, 10)) ? null : `dims ${JSON.stringify(d.map((x) => [x.name, x.value]))}`; } });
    await k.cell(`B-${P}17`, `Slot ${mode}`, 'existing parameter: slot 1 "len = 50" (span), slot 2 span "len"', async () => {
      await open(); await k.typeText('len = 50'); await k.pressKey('Enter'); await k.moveW(...W1); await k.typeText('10'); await k.pressKey('Enter');
      await k.pickTool('slot', mode); await k.clickW(-50, -35); await k.moveW(-10, -30); await k.typeText('len'); await k.pressKey('Enter'); await k.moveW(-25, -20); await k.clickW(-25, -20);
    }, { check: (fin) => (dist(fin).some((x) => x.expression === 'len') ? null : `dims ${JSON.stringify(dist(fin).map((x) => [x.name, x.value, x.expression]))}`) });
    for (const [id, txt, want, label] of [['a', '2 in', 50.8, 'span "2 in"'], ['b', '25.4mm', 25.4, 'span "25.4mm"'], ['c', '1/2"', 12.7, 'span 1/2"']]) {
      await k.cell(`B-${P}18${id}`, `Slot ${mode}`, `units: ${label}`, async () => { await open(); await k.typeText(txt); await k.pressKey('Enter'); await k.moveW(...W1); await k.clickW(...W1); },
        { check: (fin) => { const d = typedDims(fin); return d.length === 1 && near(d[0].value, want, 0.02) ? null : `dims ${JSON.stringify(dist(fin).map((x) => x.value))}`; } });
    }
    for (const [id, txt, label] of [['a', '0', 'span 0'], ['b', '-5', 'span -5'], ['c', '99999', 'span 99999'], ['d', '40abc', 'span "40abc"'], ['e', 'abc', 'span "abc"']]) {
      await k.cell(`B-${P}19${id}`, `Slot ${mode}`, `${label}, Enter`, async () => { await open(); await k.typeText(txt); await k.pressKey('Enter'); },
        { check: (fin, live) => (id === 'c' ? null : (live.box.single && !drawn(fin) ? null : `box ${live.box.single} drawn ${drawn(fin)}`)) });
    }
    for (const [id, txt, label] of [['a', '0', 'width 0'], ['b', '-5', 'width -5'], ['c', '99999', 'width 99999'], ['d', '12abc', 'width "12abc"']]) {
      await k.cell(`B-${P}20${id}`, `Slot ${mode}`, `${label}, Enter`, async () => { await toWidth(); await k.typeText(txt); await k.pressKey('Enter'); },
        { check: (fin, live) => (id === 'c' ? null : (live.box.single && !drawn(fin) ? null : `box ${live.box.single} drawn ${drawn(fin)}`)) });
    }
    await k.cell(`B-${P}21`, `Slot ${mode}`, 'width typed then Backspace x2 (empty): unlocks, commit by click', async () => { await toWidth(); await k.typeText('12'); await k.pressKey('Backspace'); await k.pressKey('Backspace'); await k.clickW(...W1); },
      { check: (fin) => (drawn(fin) && !typedDims(fin).length ? null : `dims ${JSON.stringify(dist(fin).map((x) => [x.value, x.driven]))}`) });
    await k.cell(`B-${P}22`, `Slot ${mode}`, 'undo-step count for a typed slot (span + width)', async () => { await toWidth('40'); await k.typeText('12'); await k.pressKey('Enter'); });
    if (mode !== 'slot-c2c') continue;   // the remaining straight variants share the code of the cells above; the lighter pass is the baseline + typed pair
  }

  // ── arc slots ──
  for (const mode of ['slot-arc-3pt', 'slot-arc-center']) {
    const P = mode === 'slot-arc-3pt' ? 'A3' : 'AC';
    const A = [-40, 15], B = [0, 15], Cc = [-20, -10];
    await k.cell(`B-${P}01`, `Slot ${mode}`, 'nothing typed: 3 clicks + width click (baseline)', async () => {
      await k.pickTool('slot', mode); await k.clickW(...A); await k.moveW(...B); await k.clickW(...B); await k.moveW(...Cc); await k.clickW(...Cc); await k.moveW(-20, -22); await k.clickW(-20, -22);
    }, { check: (fin) => (drawn(fin) && !typedDims(fin).length ? null : `shapes ${fin.shapes.length} dims ${typedDims(fin).length}`) });
    await k.cell(`B-${P}02`, `Slot ${mode}`, 'first click, then which box? (live read of the box after click 1 and click 2)', async () => {
      await k.pickTool('slot', mode); await k.clickW(...A); await k.moveW(...B); const a = await k.snap(); row(`B-${P}02.a`, `after click 1: single=${a.box.single} val=${a.box.singleVal}`);
      await k.clickW(...B); await k.moveW(...Cc); const b = await k.snap(); row(`B-${P}02.b`, `after click 2: single=${b.box.single} val=${b.box.singleVal}`);
      await k.clickW(...Cc); await k.moveW(-20, -22); const c = await k.snap(); row(`B-${P}02.c`, `after click 3: single=${c.box.single} val=${c.box.singleVal}`);
    });
    await k.cell(`B-${P}03`, `Slot ${mode}`, 'typed 30 in the first box (span/radius), Enter, then the rest by click', async () => {
      await k.pickTool('slot', mode); await k.clickW(...A); await k.moveW(...B); await k.typeText('30'); await k.pressKey('Enter'); await k.moveW(...Cc); const m = await k.snap(); row(`B-${P}03.mid`, `after Enter: single=${m.box.single} val=${m.box.singleVal}`); await k.clickW(...Cc); await k.moveW(-20, -22); await k.clickW(-20, -22);
    }, { check: (fin) => (typedDims(fin).length ? null : 'a typed span made no dimension') });
    await k.cell(`B-${P}04`, `Slot ${mode}`, 'width typed 8 at the end, Enter', async () => {
      await k.pickTool('slot', mode); await k.clickW(...A); await k.moveW(...B); await k.clickW(...B); await k.moveW(...Cc); await k.clickW(...Cc); await k.moveW(-20, -22); await k.typeText('8'); await k.pressKey('Enter');
    }, { check: (fin) => (typedDims(fin).some((d) => near(d.value, 8)) ? null : `dims ${JSON.stringify(dist(fin).map((x) => [x.value, x.driven]))}`) });
    await k.cell(`B-${P}05`, `Slot ${mode}`, 'formula "d1 / 2" in the first box and name "wd = 8" for the width', async () => {
      await k.pickTool('line'); await k.clickW(-30, -35); await k.moveW(10, -35); await k.typeText('40'); await k.pressKey('Enter'); await k.pressKey('Escape'); await k.pressKey('Escape');
      await k.pickTool('slot', mode); await k.clickW(...A); await k.moveW(...B); await k.typeText('d1 / 2'); await k.pressKey('Enter'); await k.moveW(...Cc); await k.clickW(...Cc); await k.moveW(-20, -22); await k.typeText('wd = 8'); await k.pressKey('Enter');
    }, { check: (fin) => (dist(fin).some((d) => /d1\s*\/\s*2/.test(d.expression || '')) && dist(fin).some((d) => d.name === 'wd') ? null : `dims ${JSON.stringify(dist(fin).map((x) => [x.name, x.value, x.expression]))}`) });
  }
} finally { await k.close(); }
