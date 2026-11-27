// tests/audits/drawbox-audit-1026-modify.mjs — TASK 1026 (AUDIT ONLY): the modify tools' value boxes: Fillet radius, Offset distance, Circular / Rectangular Pattern dialogs (rows B-F*, B-O*, B-PC*, B-PR*)
// Run: node tests/audits/drawbox-audit-1026-modify.mjs
import { start, row, f } from './drawbox-audit-1026-kit.js';

const k = await start({ tag: '1026-modify', view: { cx: 0, cy: 0, vw: 220 } });
const near = (a, b, t = 0.06) => Math.abs(a - b) <= t;
const lines = (sn) => sn.shapes.filter((s) => s.type === 'line');
const arcs = (sn) => sn.shapes.filter((s) => s.type === 'arc');
const circles = (sn) => sn.shapes.filter((s) => s.type === 'circle');
const dist = (sn) => sn.cons.filter((c) => c.type === 'distance');
const CORNER = [-40, -10];

const rectBase = async () => { await k.pickTool('rect', 'rect-2pt'); await k.clickW(-40, -10); await k.moveW(10, 25); await k.clickW(10, 25); await k.pressKey('Escape'); await k.pressKey('Escape'); };
const fbox = () => k.cdp.evalJs(`(() => { const e = document.getElementById('fillet-radius-input'); return e ? { val: e.value, inv: e.getAttribute('aria-invalid'), focus: document.activeElement === e } : null; })()`);
const obox = () => k.cdp.evalJs(`(() => { const e = document.getElementById('offset-distance-input'); return e ? { val: e.value, inv: e.getAttribute('aria-invalid'), focus: document.activeElement === e } : null; })()`);
const fopen = async () => { await rectBase(); await k.pickTool('fillet'); await k.clickW(...CORNER); };
const oopen = async (to = [-15, -25]) => { await rectBase(); await k.pickTool('offset'); await k.clickW(-15, -10); await k.moveW(...to); };
const note = async (id, what, fn) => { const v = await fn(); row(id, `${what}: ${JSON.stringify(v)}`); };

try {
  // ───────────────────────── FILLET ─────────────────────────
  await k.cell('B-F01', 'Fillet', 'click the corner, Enter (nothing typed: the default radius)', async () => { await fopen(); await note('B-F01.box', 'box after the corner click', fbox); await k.pressKey('Enter'); },
    { check: (fin) => (arcs(fin).length === 1 && dist(fin).some((d) => d.isRadius && !d.isDiameter) ? null : `arcs ${arcs(fin).length} dims ${JSON.stringify(dist(fin))}`) });
  await k.cell('B-F03', 'Fillet', 'radius 8, Enter', async () => { await fopen(); await k.typeText('8'); await k.pressKey('Enter'); },
    { check: (fin) => { const d = dist(fin).find((x) => x.isRadius); return arcs(fin).length === 1 && d && near(d.value, 8) && fin.cons.filter((c) => c.type === 'tangent').length === 2 ? null : `dims ${JSON.stringify(dist(fin))}`; } });
  await k.cell('B-F05', 'Fillet', 'radius 8 then retyped 6, Enter', async () => { await fopen(); await k.typeText('8'); await k.selField(0); await k.typeText('6'); await k.pressKey('Enter'); },
    { check: (fin) => { const d = dist(fin).find((x) => x.isRadius); return d && near(d.value, 6) ? null : `dims ${JSON.stringify(dist(fin))}`; } });
  await k.cell('B-F06', 'Fillet', 'radius 8 then Backspace x2 (empty), Enter', async () => { await fopen(); await k.typeText('8'); await k.pressKey('Backspace'); await k.pressKey('Enter'); },
    { check: (fin, live) => (arcs(fin).length === 0 && live.st.toasts.length ? null : `arcs ${arcs(fin).length} toasts ${JSON.stringify(live.st.toasts.map((t) => t.text))}`) });
  await k.cell('B-F07', 'Fillet', 'radius 8 typed, the mouse moves elsewhere (hover another corner), Enter', async () => { await fopen(); await k.typeText('8'); await k.moveW(10, 25); await k.pressKey('Enter'); },
    { check: (fin) => { const d = dist(fin).find((x) => x.isRadius); return arcs(fin).length === 1 && d && near(d.value, 8) ? null : `arcs ${arcs(fin).length} dims ${JSON.stringify(dist(fin))}`; } });
  await k.cell('B-F08', 'Fillet', 'radius 8 typed, then a click on the canvas (outside the box): applies? cancels?', async () => { await fopen(); await k.typeText('8'); await k.clickW(60, -30); },
    { check: (fin) => (arcs(fin).length === 1 ? null : `arcs ${arcs(fin).length} (a click away neither applies nor ... see the row)`) });
  await k.cell('B-F09', 'Fillet', 'a second corner: the box carries the last radius?', async () => {
    await fopen(); await k.typeText('8'); await k.pressKey('Enter'); await k.pickTool('fillet'); await k.clickW(10, 25);
    await note('B-F09.box', 'box on the 2nd corner', fbox); await k.pressKey('Enter');
  }, { check: (fin) => (arcs(fin).length === 2 ? null : `arcs ${arcs(fin).length}`) });
  await k.cell('B-F10', 'Fillet', 'formula: line d1=40 first; radius "d1 / 8"', async () => {
    await k.pickTool('line'); await k.clickW(-30, -35); await k.moveW(10, -35); await k.typeText('40'); await k.pressKey('Enter'); await k.pressKey('Escape'); await k.pressKey('Escape');
    await fopen(); await k.typeText('d1 / 8'); await k.pressKey('Enter');
  }, { check: (fin) => { const d = dist(fin).find((x) => x.isRadius); return d && near(d.value, 5) && /d1\s*\/\s*8/.test(d.expression || '') ? null : `dims ${JSON.stringify(dist(fin))}`; } });
  await k.cell('B-F11', 'Fillet', 'name "fr = 6"', async () => { await fopen(); await k.typeText('fr = 6'); await k.pressKey('Enter'); },
    { check: (fin) => { const d = dist(fin).find((x) => x.isRadius); return d && d.name === 'fr' && near(d.value, 6) ? null : `dims ${JSON.stringify(dist(fin))}`; } });
  await k.cell('B-F12', 'Fillet', 'existing parameter: fillet 1 "fr = 6", fillet 2 radius "fr"', async () => {
    await fopen(); await k.typeText('fr = 6'); await k.pressKey('Enter'); await k.pickTool('fillet'); await k.clickW(10, 25); await k.typeText('fr'); await k.pressKey('Enter');
  }, { check: (fin) => (dist(fin).filter((d) => d.isRadius).length === 2 && dist(fin).some((d) => d.expression === 'fr') ? null : `dims ${JSON.stringify(dist(fin))}`) });
  for (const [id, txt, want, label] of [['a', '0.25 in', 6.35, '"0.25 in"'], ['b', '6.35mm', 6.35, '"6.35mm"'], ['c', '1/4"', 6.35, '1/4"']]) {
    await k.cell(`B-F13${id}`, 'Fillet', `units: radius ${label}`, async () => { await fopen(); await k.typeText(txt); await k.pressKey('Enter'); },
      { check: (fin) => { const d = dist(fin).find((x) => x.isRadius); return d && near(d.value, want, 0.02) ? null : `dims ${JSON.stringify(dist(fin))}`; } });
  }
  for (const [id, txt, label] of [['a', '0', '0'], ['b', '-3', '-3'], ['c', '1000', '1000 (larger than the sides)'], ['d', '6abc', '"6abc"'], ['e', 'abc', '"abc"']]) {
    await k.cell(`B-F14${id}`, 'Fillet', `radius ${label}, Enter`, async () => { await fopen(); await k.typeText(txt); await k.pressKey('Enter'); },
      { check: (fin, live) => (arcs(fin).length === 0 && (live.st.toasts.length || (live.box && 0) || true) ? null : `arcs ${arcs(fin).length}`) });
  }
  await k.cell('B-F15', 'Fillet', 'the box after a refused Enter: still open, text kept? (radius abc)', async () => { await fopen(); await k.typeText('abc'); await k.pressKey('Enter'); await note('B-F15.box', 'fillet box after refused Enter', fbox); });
  await k.cell('B-F16', 'Fillet', 'undo steps for one typed fillet', async () => { await fopen(); await k.typeText('8'); await k.pressKey('Enter'); });

  // ───────────────────────── OFFSET ─────────────────────────
  const offs = (sn) => sn.cons.filter((c) => c.type === 'offset');
  await k.cell('B-O01', 'Offset', 'click the chain, cursor outside, Enter (the default distance)', async () => { await oopen(); await note('B-O01.box', 'box', obox); await k.pressKey('Enter'); },
    { check: (fin) => (lines(fin).length === 8 ? null : `lines ${lines(fin).length}`) });
  await k.cell('B-O02', 'Offset', 'distance 8, cursor outside, Enter', async () => { await oopen(); await k.typeText('8'); await k.pressKey('Enter'); },
    { check: (fin) => (lines(fin).length === 8 ? null : `lines ${lines(fin).length}`) });
  await k.cell('B-O03', 'Offset', 'distance 8 then retyped 6, Enter', async () => { await oopen(); await k.typeText('8'); await k.selField(0); await k.typeText('6'); await k.pressKey('Enter'); },
    { check: (fin) => (lines(fin).length === 8 ? null : `lines ${lines(fin).length}`) });
  await k.cell('B-O04', 'Offset', 'distance 8, Backspace x2 (empty), Enter', async () => { await oopen(); await k.typeText('8'); await k.pressKey('Backspace'); await k.pressKey('Enter'); },
    { check: (fin) => (lines(fin).length === 4 ? null : `lines ${lines(fin).length}`) });
  await k.cell('B-O05', 'Offset', 'distance 8 typed, the mouse moves to the inside (side flips): lock holds, side follows', async () => { await oopen(); await k.typeText('8'); await k.moveW(-15, 5); await k.pressKey('Enter'); },
    { check: (fin) => (lines(fin).length === 8 ? null : `lines ${lines(fin).length}`) });
  await k.cell('B-O06', 'Offset', 'distance 8 typed, then a CLICK on the canvas (choose the side by click): typing still goes to the box?', async () => {
    await oopen(); await k.clickW(-15, -25); await note('B-O06.box', 'box after the side click', obox); await k.typeText('8'); await k.pressKey('Enter');
  }, { check: (fin) => (lines(fin).length === 8 ? null : `lines ${lines(fin).length} (typing after a canvas click did not reach the box)`) });
  await k.cell('B-O07', 'Offset', 'formula: d1=40 line first; distance "d1 / 8"', async () => {
    await k.pickTool('line'); await k.clickW(-30, -35); await k.moveW(10, -35); await k.typeText('40'); await k.pressKey('Enter'); await k.pressKey('Escape'); await k.pressKey('Escape');
    await rectBase(); await k.pickTool('offset'); await k.clickW(-15, -10); await k.moveW(-15, 4); await k.typeText('d1 / 8'); await k.pressKey('Enter');
  }, { check: (fin) => (fin.cons.some((c) => c.expression && /d1\s*\/\s*8/.test(c.expression)) ? null : `cons ${JSON.stringify(fin.cons.filter((c) => c.value !== undefined).map((c) => [c.type, c.value, c.expression, c.name]))}`) });
  await k.cell('B-O08', 'Offset', 'name "od = 6"', async () => { await oopen(); await k.typeText('od = 6'); await k.pressKey('Enter'); },
    { check: (fin) => (fin.cons.some((c) => c.name === 'od') ? null : `cons ${JSON.stringify(fin.cons.filter((c) => c.value !== undefined).map((c) => [c.type, c.value, c.expression, c.name]))}`) });
  for (const [id, txt, label] of [['a', '0.25 in', '"0.25 in"'], ['b', '6.35mm', '"6.35mm"'], ['c', '1/4"', '1/4"']]) {
    await k.cell(`B-O09${id}`, 'Offset', `units: distance ${label}`, async () => { await oopen(); await k.typeText(txt); await k.pressKey('Enter'); },
      { check: (fin) => (lines(fin).length === 8 && fin.cons.some((c) => c.value !== undefined && near(c.value, 6.35, 0.02)) ? null : `lines ${lines(fin).length} vals ${JSON.stringify(fin.cons.filter((c) => c.value !== undefined).map((c) => c.value))}`) });
  }
  for (const [id, txt, label] of [['a', '0', '0'], ['b', '-8', '-8 (a negative distance)'], ['c', '99999', '99999'], ['d', '6abc', '"6abc"'], ['e', 'abc', '"abc"']]) {
    await k.cell(`B-O10${id}`, 'Offset', `distance ${label}, Enter`, async () => { await oopen(); await k.typeText(txt); await k.pressKey('Enter'); },
      { check: null });
  }
  await k.cell('B-O11', 'Offset', 'undo steps for one typed offset', async () => { await oopen(); await k.typeText('8'); await k.pressKey('Enter'); });

  // ───────────────────────── CIRCULAR PATTERN (dialog) ─────────────────────────
  const dlg = () => k.cdp.evalJs(`(() => { const d = document.querySelector('[data-pattern-type]'); if (!d) return null;
    return { type: d.dataset.patternType, f: [...d.querySelectorAll('input[data-field], select[data-field]')].filter((e) => !e.closest('[hidden]')).map((e) => (e.dataset.field + '=' + (e.type === 'checkbox' ? e.checked : e.value) + (e.getAttribute('aria-invalid') === 'true' ? '!' : ''))), hint: ((d.querySelector('.sk-pat-hint') || {}).textContent || '').trim() }; })()`);
  const pfield = async (name, text, { replace = true } = {}) => {
    await k.cdp.evalJs(`(() => { const e = document.querySelector('[data-pattern-type] [data-field=${JSON.stringify(name)}]'); if (e) { e.focus(); e.select(); } })()`);
    await k.typeText(text);
  };
  const popen = async (kind) => {
    await k.pickTool('circle'); await k.clickW(40, 0); await k.moveW(50, 0); await k.clickW(50, 0); await k.pressKey('Escape'); await k.pressKey('Escape');
    await k.pickTool('select'); await k.clickW(50, 0);
    await k.clickTool(kind);
    await new Promise((r) => setTimeout(r, 400));
  };
  const copen = async () => { await popen('circularPattern'); await k.clickW(0, 0); await new Promise((r) => setTimeout(r, 200)); };
  const pat = (sn) => sn.cons.filter((c) => /pattern/i.test(c.type));
  await k.cell('B-PC01', 'Circular pattern', 'dialog: nothing typed (default Quantity), Enter in the dialog', async () => { await copen(); await note('B-PC01.dlg', 'dialog', dlg); await k.cdp.evalJs(`document.querySelector('[data-pattern-type] [data-field=Quantity]').focus()`); await k.pressKey('Enter'); },
    { check: (fin) => (circles(fin).length > 1 ? null : `circles ${circles(fin).length}`) });
  await k.cell('B-PC02', 'Circular pattern', 'Quantity 5 (full 360), Enter', async () => { await copen(); await pfield('Quantity', '5'); await k.pressKey('Enter'); },
    { check: (fin) => (circles(fin).length === 5 ? null : `circles ${circles(fin).length}`) });
  await k.cell('B-PC03', 'Circular pattern', 'Distribution Angle: Angle 90 + Quantity 4, Enter', async () => {
    await copen(); await k.cdp.evalJs(`(() => { const s = document.querySelector('[data-pattern-type] select[data-field=Distribution]'); s.value = 'angle'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await new Promise((r) => setTimeout(r, 200)); await pfield('Angle', '90'); await pfield('Quantity', '4'); await note('B-PC03.dlg', 'dialog', dlg); await k.pressKey('Enter');
  }, { check: (fin) => (circles(fin).length === 4 ? null : `circles ${circles(fin).length}`) });
  await k.cell('B-PC04', 'Circular pattern', 'Quantity 5 then retyped 3, Enter', async () => { await copen(); await pfield('Quantity', '5'); await pfield('Quantity', '3'); await k.pressKey('Enter'); },
    { check: (fin) => (circles(fin).length === 3 ? null : `circles ${circles(fin).length}`) });
  await k.cell('B-PC05', 'Circular pattern', 'Quantity 5 then Backspace (empty), Enter', async () => { await copen(); await pfield('Quantity', '5'); await k.pressKey('Backspace'); await note('B-PC05.dlg', 'dialog with an empty Quantity', dlg); await k.pressKey('Enter'); },
    { check: (fin, live) => (circles(fin).length === 1 ? null : `circles ${circles(fin).length}`) });
  for (const [id, txt, label] of [['a', '1', 'Quantity 1'], ['b', '0', 'Quantity 0'], ['c', '-3', 'Quantity -3'], ['d', '2.5', 'Quantity 2.5'], ['e', '9999', 'Quantity 9999'], ['f', 'abc', 'Quantity "abc"'], ['g', '4abc', 'Quantity "4abc"'], ['h', 'n = 4', 'Quantity name "n = 4"'], ['i', '12 / 3', 'Quantity formula "12 / 3"']]) {
    await k.cell(`B-PC06${id}`, 'Circular pattern', `${label}, Enter`, async () => { await copen(); await pfield('Quantity', txt); await note(`B-PC06${id}.dlg`, 'dialog', dlg); await k.pressKey('Enter'); }, { check: null });
  }
  for (const [id, txt, label] of [['a', '90', 'Angle 90'], ['b', '0', 'Angle 0'], ['c', '-45', 'Angle -45'], ['d', '720', 'Angle 720'], ['e', '45abc', 'Angle "45abc"'], ['f', 'a1 = 60', 'Angle name "a1 = 60"'], ['g', '180 / 3', 'Angle formula "180 / 3"'], ['h', '1.5 rad', 'Angle "1.5 rad"']]) {
    await k.cell(`B-PC07${id}`, 'Circular pattern', `Distribution Angle, ${label}, Quantity 3, Enter`, async () => {
      await copen(); await k.cdp.evalJs(`(() => { const s = document.querySelector('[data-pattern-type] select[data-field=Distribution]'); s.value = 'angle'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await new Promise((r) => setTimeout(r, 200)); await pfield('Quantity', '3'); await pfield('Angle', txt); await note(`B-PC07${id}.dlg`, 'dialog', dlg); await k.pressKey('Enter');
    }, { check: null });
  }
  await k.cell('B-PC08', 'Circular pattern', 'undo steps for one typed circular pattern', async () => { await copen(); await pfield('Quantity', '5'); await k.pressKey('Enter'); });

  // ───────────────────────── RECTANGULAR PATTERN (dialog) ─────────────────────────
  const ropen = async () => {
    await k.pickTool('line'); await k.clickW(0, -35); await k.moveW(30, -35); await k.clickW(30, -35); await k.pressKey('Escape'); await k.pressKey('Escape');
    await popen('rectangularPattern'); await k.clickW(15, -35); await new Promise((r) => setTimeout(r, 300));
  };
  await k.cell('B-PR01', 'Rectangular pattern', 'direction = a horizontal line; dialog state', async () => { await ropen(); await note('B-PR01.dlg', 'dialog', dlg); }, { check: null });
  await k.cell('B-PR02', 'Rectangular pattern', 'Quantity 1 = 3, Distance 1 = 20, Enter', async () => { await ropen(); await pfield('Quantity 1', '3'); await pfield('Distance 1', '20'); await note('B-PR02.dlg', 'dialog', dlg); await k.pressKey('Enter'); },
    { check: (fin) => (circles(fin).length === 3 ? null : `circles ${circles(fin).length}`) });
  await k.cell('B-PR03', 'Rectangular pattern', 'Distance only (30), default quantity, Enter', async () => { await ropen(); await pfield('Distance 1', '30'); await k.pressKey('Enter'); }, { check: null });
  await k.cell('B-PR04', 'Rectangular pattern', 'Quantity only (4), default distance, Enter', async () => { await ropen(); await pfield('Quantity 1', '4'); await k.pressKey('Enter'); }, { check: null });
  await k.cell('B-PR05', 'Rectangular pattern', 'Distance retyped 20 -> 15, Enter', async () => { await ropen(); await pfield('Quantity 1', '3'); await pfield('Distance 1', '20'); await pfield('Distance 1', '15'); await k.pressKey('Enter'); }, { check: null });
  await k.cell('B-PR06', 'Rectangular pattern', 'Distance typed then Backspace (empty), Enter', async () => { await ropen(); await pfield('Quantity 1', '3'); await pfield('Distance 1', '20'); await k.pressKey('Backspace'); await k.pressKey('Backspace'); await note('B-PR06.dlg', 'dialog', dlg); await k.pressKey('Enter'); }, { check: null });
  await k.cell('B-PR07', 'Rectangular pattern', 'formula: d1 line first; Distance "d1 / 2"', async () => {
    await k.pickTool('line'); await k.clickW(-30, -35); await k.moveW(-10, -35); await k.typeText('20'); await k.pressKey('Enter'); await k.pressKey('Escape'); await k.pressKey('Escape');
    await ropen(); await pfield('Quantity 1', '3'); await pfield('Distance 1', 'd1 * 2'); await k.pressKey('Enter');
  }, { check: (fin) => (fin.cons.some((c) => c.expression && /d1/.test(c.expression)) ? null : `cons ${JSON.stringify(pat(fin))}`) });
  await k.cell('B-PR08', 'Rectangular pattern', 'name: Distance "gap = 25"', async () => { await ropen(); await pfield('Quantity 1', '3'); await pfield('Distance 1', 'gap = 25'); await k.pressKey('Enter'); }, { check: (fin) => (fin.cons.some((c) => c.name === 'gap') ? null : `cons ${JSON.stringify(pat(fin))}`) });
  for (const [id, txt, label] of [['a', '1 in', 'Distance "1 in"'], ['b', '0', 'Distance 0'], ['c', '-20', 'Distance -20'], ['d', '99999', 'Distance 99999'], ['e', '20abc', 'Distance "20abc"']]) {
    await k.cell(`B-PR09${id}`, 'Rectangular pattern', `${label}, Quantity 3, Enter`, async () => { await ropen(); await pfield('Quantity 1', '3'); await pfield('Distance 1', txt); await note(`B-PR09${id}.dlg`, 'dialog', dlg); await k.pressKey('Enter'); }, { check: null });
  }
} finally { await k.close(); }
