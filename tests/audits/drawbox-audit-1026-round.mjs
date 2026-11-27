// tests/audits/drawbox-audit-1026-round.mjs — TASK 1026 (AUDIT ONLY): Circle (Ø box), Arc (R then sweep boxes), Polygon (R + N) matrices (rows B-C*, B-A*, B-P*)
// Run: node tests/audits/drawbox-audit-1026-round.mjs
import { start, row, f } from './drawbox-audit-1026-kit.js';

const k = await start({ tag: '1026-round', view: { cx: 0, cy: 0, vw: 220 } });
const near = (a, b, t = 0.06) => Math.abs(a - b) <= t;
const circles = (sn) => sn.shapes.filter((s) => s.type === 'circle');
const arcs = (sn) => sn.shapes.filter((s) => s.type === 'arc');
const dist = (sn) => sn.cons.filter((c) => c.type === 'distance');
const O = [-30, 0];     // centre click
const R1 = [10, 0];     // cursor: radius 40
const R2 = [-30, -30];  // cursor, another direction, radius 30

try {
  // ───────────────────────── CIRCLE (single variant: centre + diameter) ─────────────────────────
  const copen = async () => { await k.pickTool('circle'); await k.clickW(...O); await k.moveW(...R1); };
  const diaDim = (sn) => dist(sn).find((c) => c.isDiameter);
  await k.cell('B-C01', 'Circle', 'nothing typed: click then click (baseline)', async () => { await copen(); await k.clickW(...R1); },
    { check: (fin) => (circles(fin).length === 1 && near(circles(fin)[0].r, 40) && !dist(fin).length ? null : `circles ${JSON.stringify(circles(fin).map((c) => c.r))} dims ${dist(fin).length}`) });
  await k.cell('B-C02', 'Circle', 'click only, then Enter (cursor still on the centre)', async () => { await k.pickTool('circle'); await k.clickW(...O); await k.pressKey('Enter'); },
    { check: (fin, live) => (circles(fin).length ? 'Enter drew a circle with no size' : (!live.box.single ? 'box closed on a refused Enter' : null)) });
  await k.cell('B-C03', 'Circle', 'diameter only (60), Enter', async () => { await copen(); await k.typeText('60'); await k.pressKey('Enter'); },
    { check: (fin) => { const d = diaDim(fin); return circles(fin).length === 1 && near(circles(fin)[0].r, 30) && d && near(d.value, 60) && !d.driven ? null : `circles ${JSON.stringify(circles(fin).map((c) => c.r))} dims ${JSON.stringify(dist(fin))}`; } });
  await k.cell('B-C04', 'Circle', 'second field: none (a single box). Tab inside the box: where does focus go?', async () => { await copen(); await k.pressKey('Tab'); },
    { check: (fin, live) => (live.box.single ? null : 'box lost on Tab') });
  await k.cell('B-C05', 'Circle', 'diameter 60 then retyped 20, Enter', async () => { await copen(); await k.typeText('60'); await k.selField(0); await k.typeText('20'); await k.pressKey('Enter'); },
    { check: (fin) => (circles(fin).length === 1 && near(circles(fin)[0].r, 10) && dist(fin).length === 1 && near(dist(fin)[0].value, 20) ? null : `circles ${JSON.stringify(circles(fin).map((c) => c.r))} dims ${JSON.stringify(dist(fin).map((d) => d.value))}`) });
  await k.cell('B-C06', 'Circle', 'diameter 60 then Backspace x2 (empty): unlocks? cursor to R2, Enter', async () => { await copen(); await k.typeText('60'); await k.pressKey('Backspace'); await k.pressKey('Backspace'); await k.moveW(...R2); await k.pressKey('Enter'); },
    { check: (fin) => (circles(fin).length === 1 && near(circles(fin)[0].r, 30, 0.5) && !dist(fin).length ? null : `circles ${JSON.stringify(circles(fin).map((c) => c.r))} dims ${dist(fin).length}`) });
  await k.cell('B-C07', 'Circle', 'diameter 60 typed, mouse moved far (R2): lock holds', async () => { await copen(); await k.typeText('60'); await k.moveW(-30, -42); await k.pressKey('Enter'); },
    { check: (fin) => (circles(fin).length === 1 && near(circles(fin)[0].r, 30) ? null : `circles ${JSON.stringify(circles(fin).map((c) => c.r))}`) });
  await k.cell('B-C08', 'Circle', 'diameter 60 typed, commit by CLICK at R1', async () => { await copen(); await k.typeText('60'); await k.clickW(...R1); },
    { check: (fin) => (circles(fin).length === 1 && near(circles(fin)[0].r, 30) && dist(fin).length === 1 ? null : `circles ${JSON.stringify(circles(fin).map((c) => c.r))} dims ${dist(fin).length}`) });
  await k.cell('B-C09', 'Circle', 'centre click ON an existing point + diameter 60, Enter: coincident (BUG-183)', async () => {
    await k.pickTool('line'); await k.clickW(...O); await k.moveW(-30, -25); await k.clickW(-30, -25); await k.pressKey('Escape'); await k.pressKey('Escape');
    await k.pickTool('circle'); await k.clickW(...O); await k.moveW(10, 0); await k.typeText('60'); await k.pressKey('Enter');
  }, { check: (fin) => (fin.cons.some((c) => c.type === 'coincident') ? null : 'no coincident on the centre') });
  await k.cell('B-C10', 'Circle', 'centre click on an existing point + diameter 60, commit by CLICK', async () => {
    await k.pickTool('line'); await k.clickW(...O); await k.moveW(-30, -25); await k.clickW(-30, -25); await k.pressKey('Escape'); await k.pressKey('Escape');
    await k.pickTool('circle'); await k.clickW(...O); await k.moveW(10, 0); await k.typeText('60'); await k.clickW(10, 0);
  }, { check: (fin) => (fin.cons.some((c) => c.type === 'coincident') ? null : 'no coincident on the centre') });
  await k.cell('B-C11', 'Circle', 'rim click on an existing point, NOTHING typed: point on the circle', async () => {
    await k.pickTool('line'); await k.clickW(10, 20); await k.moveW(10, 30); await k.clickW(10, 30); await k.pressKey('Escape'); await k.pressKey('Escape');
    await k.pickTool('circle'); await k.clickW(-30, 20); await k.moveW(10, 20); await k.clickW(10, 20);
  }, { check: (fin) => (fin.cons.some((c) => c.type === 'pointOnLine' || c.type === 'pointOnCircle' || c.type === 'coincident') ? null : 'rim click on a point made no constraint') });
  await k.cell('B-C12', 'Circle', 'rim click on an existing point with a TYPED diameter that differs: typed wins, no constraint', async () => {
    await k.pickTool('line'); await k.clickW(10, 20); await k.moveW(10, 30); await k.clickW(10, 30); await k.pressKey('Escape'); await k.pressKey('Escape');
    await k.pickTool('circle'); await k.clickW(-30, 20); await k.moveW(10, 20); await k.typeText('30'); await k.clickW(10, 20);
  }, { check: (fin) => (circles(fin).length === 1 && near(circles(fin)[0].r, 15) ? null : `circles ${JSON.stringify(circles(fin).map((c) => c.r))}`) });
  await k.cell('B-C13', 'Circle', 'centre on the FIXED origin + typed diameter 60 (over-constrain risk: circle centre fixed)', async () => { await k.pickTool('circle'); await k.clickW(0, 0); await k.moveW(40, 0); await k.typeText('60'); await k.pressKey('Enter'); },
    { check: (fin) => (circles(fin).length === 1 && near(circles(fin)[0].r, 30) ? null : `circles ${JSON.stringify(circles(fin).map((c) => c.r))}`) });
  await k.cell('B-C14', 'Circle', 'formula "d1 / 2" (d1 = a line of 40 first)', async () => {
    await k.pickTool('line'); await k.clickW(-30, -35); await k.moveW(10, -35); await k.typeText('40'); await k.pressKey('Enter'); await k.pressKey('Escape'); await k.pressKey('Escape');
    await copen(); await k.typeText('d1 / 2'); await k.pressKey('Enter');
  }, { check: (fin) => { const d = diaDim(fin); return d && near(d.value, 20) && /d1\s*\/\s*2/.test(d.expression || '') ? null : `dims ${JSON.stringify(dist(fin))}`; } });
  await k.cell('B-C15', 'Circle', 'name "dia = 50"', async () => { await copen(); await k.typeText('dia = 50'); await k.pressKey('Enter'); },
    { check: (fin) => { const d = diaDim(fin); return d && d.name === 'dia' && near(d.value, 50) ? null : `dims ${JSON.stringify(dist(fin))}`; } });
  await k.cell('B-C16', 'Circle', 'existing parameter: circle 1 "dia = 50", circle 2 "dia"', async () => {
    await copen(); await k.typeText('dia = 50'); await k.pressKey('Enter');
    await k.pickTool('circle'); await k.clickW(60, 0); await k.moveW(80, 0); await k.typeText('dia'); await k.pressKey('Enter');
  }, { check: (fin) => (dist(fin).filter((d) => d.isDiameter).length === 2 && dist(fin).some((d) => d.expression === 'dia') ? null : `dims ${JSON.stringify(dist(fin))}`) });
  for (const [id, txt, want, label] of [['a', '2 in', 25.4, '"2 in" (diameter)'], ['b', '25.4mm', 12.7, '"25.4mm" (diameter)'], ['c', '1/2"', 6.35, '1/2" (diameter)']]) {
    await k.cell(`B-C17${id}`, 'Circle', `units: Ø ${label}`, async () => { await copen(); await k.typeText(txt); await k.pressKey('Enter'); },
      { check: (fin) => (circles(fin).length === 1 && near(circles(fin)[0].r, want, 0.02) ? null : `circles ${JSON.stringify(circles(fin).map((c) => c.r))}`) });
  }
  for (const [id, txt, label] of [['a', '0', '0'], ['b', '-5', '-5'], ['c', '99999', '99999'], ['d', '40abc', '"40abc"'], ['e', 'abc', '"abc"']]) {
    await k.cell(`B-C18${id}`, 'Circle', `diameter ${label}, Enter`, async () => { await copen(); await k.typeText(txt); await k.pressKey('Enter'); },
      { check: (fin, live) => (id === 'c' ? (circles(fin).length === 1 ? null : 'not accepted') : (circles(fin).length === 0 && live.box.single ? null : `circles ${circles(fin).length} boxOpen ${live.box.single}`)) });
  }
  await k.cell('B-C19', 'Circle', 'box shows the live diameter while the mouse moves (before typing)', async () => { await copen(); await k.moveW(...R2); },
    { check: (fin, live) => (live.box.singleVal && near(parseFloat(live.box.singleVal), 60, 0.5) ? null : `box value ${live.box.singleVal} (cursor diameter 60)`) });

  // ───────────────────────── ARC (single variant: centre, start, end) ─────────────────────────
  const aopen = async () => { await k.pickTool('arc'); await k.clickW(...O); await k.moveW(...R1); };
  const radDim = (sn) => dist(sn).find((c) => c.isRadius && !c.isDiameter);
  const arcCenterStart = [10, 0];
  const E1 = [-30, -40];     // end cursor (90 deg ccw on screen from the start)
  await k.cell('B-A01', 'Arc', 'nothing typed: click centre, click start, click end (baseline)', async () => { await aopen(); await k.clickW(...R1); await k.moveW(-10, -28); await k.moveW(...E1); await k.clickW(...E1); },
    { check: (fin) => (arcs(fin).length === 1 && !dist(fin).length ? null : `arcs ${arcs(fin).length} dims ${dist(fin).length}`) });
  await k.cell('B-A02', 'Arc', 'centre click only, then Enter (cursor on the centre)', async () => { await k.pickTool('arc'); await k.clickW(...O); await k.pressKey('Enter'); },
    { check: (fin, live) => (arcs(fin).length ? 'arc drawn' : (!live.box.single ? 'box closed' : null)) });
  await k.cell('B-A03', 'Arc', 'radius only (25), Enter: sweep box follows? then click end', async () => {
    await aopen(); await k.typeText('25'); await k.pressKey('Enter');
    const mid = await k.snap(); row('B-A03.mid', `after radius Enter: box=${JSON.stringify(mid.box)} shapes=${mid.shapes.length}`);
    await k.moveW(...E1); await k.clickW(...E1);
  }, { check: (fin) => { const d = radDim(fin); return arcs(fin).length === 1 && d && near(d.value, 25) && !d.driven ? null : `arcs ${arcs(fin).length} dims ${JSON.stringify(dist(fin))}`; } });
  await k.cell('B-A04', 'Arc', 'radius 25 Enter, then sweep only (90) Enter', async () => {
    await aopen(); await k.typeText('25'); await k.pressKey('Enter'); await k.moveW(-5, -20); await k.typeText('90'); await k.pressKey('Enter');
  }, { check: (fin) => (arcs(fin).length === 1 && radDim(fin) && near(radDim(fin).value, 25) ? null : `arcs ${arcs(fin).length} dims ${JSON.stringify(dist(fin))}`) });
  await k.cell('B-A05', 'Arc', 'radius NOT typed (cursor radius 40), start by click, sweep 120 typed, Enter', async () => {
    await aopen(); await k.clickW(...R1); await k.moveW(-10, -28); await k.typeText('120'); await k.pressKey('Enter');
  }, { check: (fin) => (arcs(fin).length === 1 && !dist(fin).length ? null : `arcs ${arcs(fin).length} dims ${JSON.stringify(dist(fin))}`) });
  await k.cell('B-A06', 'Arc', 'radius 25 then retyped 35, Enter, sweep 90 Enter', async () => {
    await aopen(); await k.typeText('25'); await k.selField(0); await k.typeText('35'); await k.pressKey('Enter'); await k.moveW(-5, -20); await k.typeText('90'); await k.pressKey('Enter');
  }, { check: (fin) => (arcs(fin).length === 1 && radDim(fin) && near(radDim(fin).value, 35) ? null : `dims ${JSON.stringify(dist(fin))}`) });
  await k.cell('B-A07', 'Arc', 'radius 25 then Backspace x2 (empty): unlocks? cursor radius 40, Enter then click end', async () => {
    await aopen(); await k.typeText('25'); await k.pressKey('Backspace'); await k.pressKey('Backspace'); await k.pressKey('Enter'); await k.moveW(...E1); await k.clickW(...E1);
  }, { check: (fin) => (arcs(fin).length === 1 && !dist(fin).length ? null : `dims ${JSON.stringify(dist(fin))}`) });
  await k.cell('B-A08', 'Arc', 'radius 25 typed, mouse moved to another direction (R2), Enter: start follows the cursor direction', async () => {
    await aopen(); await k.typeText('25'); await k.moveW(...R2); await k.pressKey('Enter'); const mid = await k.snap(); row('B-A08.mid', `box=${JSON.stringify(mid.box.single)} val=${mid.box.singleVal}`);
    await k.moveW(10, -5); await k.clickW(10, -5);
  }, { check: (fin) => (arcs(fin).length === 1 ? null : `arcs ${arcs(fin).length}`) });
  await k.cell('B-A09', 'Arc', 'radius 25 typed, commit the start by CLICK (not Enter), then end by click', async () => {
    await aopen(); await k.typeText('25'); await k.clickW(...R1); await k.moveW(...E1); await k.clickW(...E1);
  }, { check: (fin) => (arcs(fin).length === 1 && radDim(fin) && near(radDim(fin).value, 25) ? null : `arcs ${arcs(fin).length} dims ${JSON.stringify(dist(fin))}`) });
  await k.cell('B-A10', 'Arc', 'sweep 90 typed, commit by CLICK at the end cursor', async () => {
    await aopen(); await k.clickW(...R1); await k.moveW(-10, -28); await k.typeText('90'); await k.clickW(...E1);
  }, { check: (fin) => (arcs(fin).length === 1 ? null : `arcs ${arcs(fin).length}`) });
  await k.cell('B-A11', 'Arc', 'sweep typed then Backspace x2 (empty), then click end: unlocks?', async () => {
    await aopen(); await k.clickW(...R1); await k.moveW(-10, -28); await k.typeText('90'); await k.pressKey('Backspace'); await k.pressKey('Backspace'); await k.moveW(...E1); await k.clickW(...E1);
  }, { check: (fin) => (arcs(fin).length === 1 ? null : `arcs ${arcs(fin).length}`) });
  await k.cell('B-A12', 'Arc', 'centre click ON an existing point + radius 25 typed', async () => {
    await k.pickTool('line'); await k.clickW(...O); await k.moveW(-30, -25); await k.clickW(-30, -25); await k.pressKey('Escape'); await k.pressKey('Escape');
    await aopen(); await k.typeText('25'); await k.pressKey('Enter'); await k.moveW(...E1); await k.clickW(...E1);
  }, { check: (fin) => (fin.cons.some((c) => c.type === 'coincident') ? null : 'centre click on a point made no coincident') });
  await k.cell('B-A13', 'Arc', 'start click on an existing point, NO radius typed (control), end click', async () => {
    await k.pickTool('line'); await k.clickW(10, 0); await k.moveW(10, -25); await k.clickW(10, -25); await k.pressKey('Escape'); await k.pressKey('Escape');
    await aopen(); await k.clickW(10, 0); await k.moveW(...E1); await k.clickW(...E1);
  }, { check: (fin) => (fin.cons.some((c) => c.type === 'coincident' || c.type === 'pointOnLine') ? null : 'start click on a point made no constraint') });
  await k.cell('B-A14', 'Arc', 'radius typed 25, start click on an existing point 40 away: typed wins, no constraint', async () => {
    await k.pickTool('line'); await k.clickW(10, 0); await k.moveW(10, -25); await k.clickW(10, -25); await k.pressKey('Escape'); await k.pressKey('Escape');
    await aopen(); await k.typeText('25'); await k.clickW(10, 0); await k.moveW(...E1); await k.clickW(...E1);
  }, { check: (fin) => (arcs(fin).length === 1 && radDim(fin) && near(radDim(fin).value, 25) ? null : `dims ${JSON.stringify(dist(fin))}`) });
  await k.cell('B-A15', 'Arc', 'formula "d1 / 2" as radius', async () => {
    await k.pickTool('line'); await k.clickW(-30, -35); await k.moveW(10, -35); await k.typeText('40'); await k.pressKey('Enter'); await k.pressKey('Escape'); await k.pressKey('Escape');
    await aopen(); await k.typeText('d1 / 2'); await k.pressKey('Enter'); await k.moveW(-5, -20); await k.typeText('90'); await k.pressKey('Enter');
  }, { check: (fin) => { const d = radDim(fin); return d && near(d.value, 20) && /d1\s*\/\s*2/.test(d.expression || '') ? null : `dims ${JSON.stringify(dist(fin))}`; } });
  await k.cell('B-A16', 'Arc', 'name "rad = 25" as radius', async () => {
    await aopen(); await k.typeText('rad = 25'); await k.pressKey('Enter'); await k.moveW(-5, -20); await k.typeText('90'); await k.pressKey('Enter');
  }, { check: (fin) => { const d = radDim(fin); return d && d.name === 'rad' && near(d.value, 25) ? null : `dims ${JSON.stringify(dist(fin))}`; } });
  await k.cell('B-A17', 'Arc', 'sweep formula "360 / 4" and name "sw = 90"', async () => {
    await aopen(); await k.clickW(...R1); await k.moveW(-10, -28); await k.typeText('sw = 90'); await k.pressKey('Enter');
  }, { check: (fin) => (fin.cons.some((c) => c.type === 'angle' && c.name === 'sw') ? null : `a name typed in the sweep box creates no angle dimension; constraints ${JSON.stringify(fin.cons.map((c) => c.type))}`) });
  for (const [id, txt, want, label] of [['a', '1 in', 25.4, 'radius "1 in"'], ['b', '12.7mm', 12.7, 'radius "12.7mm"'], ['c', '1/2"', 12.7, 'radius 1/2"']]) {
    await k.cell(`B-A18${id}`, 'Arc', `units: ${label}`, async () => { await aopen(); await k.typeText(txt); await k.pressKey('Enter'); await k.moveW(-5, -20); await k.typeText('90'); await k.pressKey('Enter'); },
      { check: (fin) => (radDim(fin) && near(radDim(fin).value, want, 0.02) ? null : `dims ${JSON.stringify(dist(fin))}`) });
  }
  for (const [id, txt, label] of [['a', '0', 'radius 0'], ['b', '-5', 'radius -5'], ['c', '99999', 'radius 99999'], ['d', '40abc', 'radius "40abc"'], ['e', 'abc', 'radius "abc"']]) {
    await k.cell(`B-A19${id}`, 'Arc', `${label}, Enter`, async () => { await aopen(); await k.typeText(txt); await k.pressKey('Enter'); },
      { check: (fin, live) => (id === 'c' ? null : (live.box.single && !arcs(fin).length ? null : `box ${live.box.single}`)) });
  }
  for (const [id, txt, label] of [['a', '0', 'sweep 0'], ['b', '-90', 'sweep -90'], ['c', '360', 'sweep 360'], ['d', '720', 'sweep 720'], ['e', 'abc', 'sweep "abc"'], ['f', '90abc', 'sweep "90abc"']]) {
    await k.cell(`B-A20${id}`, 'Arc', `${label}, Enter`, async () => { await aopen(); await k.clickW(...R1); await k.moveW(-10, -28); await k.typeText(txt); await k.pressKey('Enter'); },
      { check: (fin, live) => (live.box.single ? (arcs(fin).length ? 'arc drawn but box still open' : null) : (arcs(fin).length === 1 ? null : 'box closed with no arc')) });
  }
  await k.cell('B-A21', 'Arc', 'box value after radius Enter is the sweep box (starts "0"?) and focus', async () => {
    await aopen(); await k.typeText('25'); await k.pressKey('Enter'); const mid = await k.snap(); row('B-A21.mid', `box single=${mid.box.single} val=${mid.box.singleVal} focus=${mid.box.focus}`);
  });

  // ───────────────────────── POLYGON (R x sides) ─────────────────────────
  const popen = async () => { await k.pickTool('polygon'); await k.clickW(...O); await k.moveW(...R1); };
  const nLines = (sn) => sn.shapes.filter((s) => s.type === 'line').length;
  const polyShapes = (sn) => sn.shapes.filter((s) => s.type !== 'circle');
  const radiusDim = (sn) => dist(sn).find((c) => !c.driven && !c.isDriven);
  const sidesOf = (sn) => { const ps = sn.shapes.filter((s) => s.type === 'polygon'); return ps.length ? (ps[0].extra && ps[0].extra.sides) : nLines(sn); };
  await k.cell('B-P01', 'Polygon', 'nothing typed: click centre, click corner (baseline, default sides)', async () => { await popen(); await k.clickW(...R1); },
    { check: (fin) => (polyShapes(fin).length && !dist(fin).length ? null : `shapes ${polyShapes(fin).length} dims ${dist(fin).length}`) });
  await k.cell('B-P02', 'Polygon', 'click only, then Enter', async () => { await k.pickTool('polygon'); await k.clickW(...O); await k.pressKey('Enter'); },
    { check: (fin, live) => (polyShapes(fin).length ? 'Enter drew a polygon with no size' : (!live.box.dual ? 'box closed' : null)) });
  await k.cell('B-P03', 'Polygon', 'R only (25), Enter', async () => { await popen(); await k.typeText('25'); await k.pressKey('Enter'); },
    { check: (fin) => (polyShapes(fin).length && radiusDim(fin) && near(radiusDim(fin).value, 25) ? null : `dims ${JSON.stringify(dist(fin))}`) });
  await k.cell('B-P04', 'Polygon', 'N only (Tab, 5), Enter', async () => { await popen(); await k.pressKey('Tab'); await k.typeText('5'); await k.pressKey('Enter'); },
    { check: (fin) => (sidesOf(fin) === 5 && !dist(fin).length ? null : `sides ${sidesOf(fin)} dims ${dist(fin).length}`) });
  await k.cell('B-P05', 'Polygon', 'both (R 25, N 5), Enter', async () => { await popen(); await k.typeText('25'); await k.pressKey('Tab'); await k.typeText('5'); await k.pressKey('Enter'); },
    { check: (fin) => (sidesOf(fin) === 5 && radiusDim(fin) && near(radiusDim(fin).value, 25) ? null : `sides ${sidesOf(fin)} dims ${JSON.stringify(dist(fin))}`) });
  await k.cell('B-P06', 'Polygon', 'R 25 then retyped 35, N 5 then retyped 7, Enter', async () => {
    await popen(); await k.typeText('25'); await k.pressKey('Tab'); await k.typeText('5'); await k.selField(0); await k.typeText('35'); await k.selField(1); await k.typeText('7'); await k.pressKey('Enter');
  }, { check: (fin) => (sidesOf(fin) === 7 && radiusDim(fin) && near(radiusDim(fin).value, 35) ? null : `sides ${sidesOf(fin)} dims ${JSON.stringify(dist(fin))}`) });
  await k.cell('B-P07', 'Polygon', 'R 25 and N 5 typed, then Backspace both to empty, Enter: unlock both?', async () => {
    await popen(); await k.typeText('25'); await k.pressKey('Backspace'); await k.pressKey('Backspace'); await k.pressKey('Tab'); await k.typeText('5'); await k.pressKey('Backspace'); await k.pressKey('Enter');
  }, { check: (fin) => (polyShapes(fin).length && !dist(fin).length ? null : `sides ${sidesOf(fin)} dims ${dist(fin).length}`) });
  await k.cell('B-P08', 'Polygon', 'R 25 typed, mouse moved to R2 direction: size holds, rotation follows', async () => { await popen(); await k.typeText('25'); await k.moveW(...R2); await k.pressKey('Enter'); },
    { check: (fin) => (polyShapes(fin).length && radiusDim(fin) && near(radiusDim(fin).value, 25) ? null : `dims ${JSON.stringify(dist(fin))}`) });
  await k.cell('B-P09', 'Polygon', 'R 25 N 5 typed, commit by CLICK at R1', async () => { await popen(); await k.typeText('25'); await k.pressKey('Tab'); await k.typeText('5'); await k.clickW(...R1); },
    { check: (fin) => (sidesOf(fin) === 5 && radiusDim(fin) && near(radiusDim(fin).value, 25) ? null : `sides ${sidesOf(fin)} dims ${JSON.stringify(dist(fin))}`) });
  await k.cell('B-P10', 'Polygon', 'centre click ON an existing point + R 25, Enter (coincident)', async () => {
    await k.pickTool('line'); await k.clickW(...O); await k.moveW(-30, -25); await k.clickW(-30, -25); await k.pressKey('Escape'); await k.pressKey('Escape');
    await popen(); await k.typeText('25'); await k.pressKey('Enter');
  }, { check: (fin) => (fin.cons.some((c) => c.type === 'coincident') ? null : 'no coincident on the centre') });
  await k.cell('B-P11', 'Polygon', 'corner click on an existing point, NOTHING typed (control)', async () => {
    await k.pickTool('line'); await k.clickW(10, 0); await k.moveW(10, -25); await k.clickW(10, -25); await k.pressKey('Escape'); await k.pressKey('Escape');
    await popen(); await k.clickW(10, 0);
  }, { check: (fin) => (fin.cons.some((c) => c.type === 'coincident') ? null : 'corner click on a point made no coincident') });
  await k.cell('B-P12', 'Polygon', 'corner click on an existing point with R 25 typed (differs): typed wins', async () => {
    await k.pickTool('line'); await k.clickW(10, 0); await k.moveW(10, -25); await k.clickW(10, -25); await k.pressKey('Escape'); await k.pressKey('Escape');
    await popen(); await k.typeText('25'); await k.clickW(10, 0);
  }, { check: (fin) => (radiusDim(fin) && near(radiusDim(fin).value, 25) ? null : `dims ${JSON.stringify(dist(fin))}`) });
  await k.cell('B-P13', 'Polygon', 'formula R "d1 / 2" and N "d1 / 8"', async () => {
    await k.pickTool('line'); await k.clickW(-30, -35); await k.moveW(10, -35); await k.typeText('40'); await k.pressKey('Enter'); await k.pressKey('Escape'); await k.pressKey('Escape');
    await popen(); await k.typeText('d1 / 2'); await k.pressKey('Tab'); await k.typeText('d1 / 8'); await k.pressKey('Enter');
  }, { check: (fin) => (radiusDim(fin) && /d1\s*\/\s*2/.test(radiusDim(fin).expression || '') && sidesOf(fin) === 5 ? null : `sides ${sidesOf(fin)} dims ${JSON.stringify(dist(fin))}`) });
  await k.cell('B-P14', 'Polygon', 'name R "pr = 25"', async () => { await popen(); await k.typeText('pr = 25'); await k.pressKey('Enter'); },
    { check: (fin) => (radiusDim(fin) && radiusDim(fin).name === 'pr' ? null : `dims ${JSON.stringify(dist(fin))}`) });
  await k.cell('B-P15', 'Polygon', 'name N "n = 6": a name in the count field', async () => { await popen(); await k.pressKey('Tab'); await k.typeText('n = 6'); await k.pressKey('Enter'); },
    { check: (fin) => (sidesOf(fin) === 6 ? null : `sides ${sidesOf(fin)}`) });
  for (const [id, txt, want, label] of [['a', '1 in', 25.4, 'R "1 in"'], ['b', '12.7mm', 12.7, 'R "12.7mm"'], ['c', '1/2"', 12.7, 'R 1/2"']]) {
    await k.cell(`B-P16${id}`, 'Polygon', `units: ${label}`, async () => { await popen(); await k.typeText(txt); await k.pressKey('Enter'); },
      { check: (fin) => (radiusDim(fin) && near(radiusDim(fin).value, want, 0.02) ? null : `dims ${JSON.stringify(dist(fin))}`) });
  }
  for (const [id, txt, label] of [['a', '0', 'R 0'], ['b', '-5', 'R -5'], ['c', '99999', 'R 99999'], ['d', '40abc', 'R "40abc"'], ['e', 'abc', 'R "abc"']]) {
    await k.cell(`B-P17${id}`, 'Polygon', `${label}, Enter`, async () => { await popen(); await k.typeText(txt); await k.pressKey('Enter'); },
      { check: (fin, live) => (id === 'c' ? null : (!polyShapes(fin).length && live.box.dual ? null : `shapes ${polyShapes(fin).length} box ${live.box.dual}`)) });
  }
  for (const [id, txt, want, label] of [['a', '2', 3, 'N 2 (below min)'], ['b', '3', 3, 'N 3'], ['c', '64', 64, 'N 64'], ['d', '65', 64, 'N 65 (above max)'], ['e', '0', 3, 'N 0'], ['f', '-5', 3, 'N -5'], ['g', '5.5', 5, 'N 5.5'], ['h', 'abc', null, 'N "abc"'], ['i', '1e1', 10, 'N "1e1"']]) {
    await k.cell(`B-P18${id}`, 'Polygon', `${label}, Enter (R 25)`, async () => { await popen(); await k.typeText('25'); await k.pressKey('Tab'); await k.typeText(txt); await k.pressKey('Enter'); },
      { check: (fin, live) => (want === null ? (!polyShapes(fin).length && live.box.dual ? null : `shapes ${polyShapes(fin).length}`) : (sidesOf(fin) === want ? null : `sides ${sidesOf(fin)} want ${want}`)) });
  }
  await k.cell('B-P19', 'Polygon', 'the next polygon: does the N box carry the last count (5)?', async () => {
    await popen(); await k.typeText('25'); await k.pressKey('Tab'); await k.typeText('5'); await k.pressKey('Enter');
    await k.pickTool('polygon'); await k.clickW(40, 0); await k.moveW(60, 0); const b = await k.snap(); row('B-P19.box', `second polygon box values ${JSON.stringify(b.box.dualVals)}`); await k.clickW(60, 0);
  }, { check: (fin) => null });
} finally { await k.close(); }
