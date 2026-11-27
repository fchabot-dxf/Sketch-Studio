// tests/audits/drawbox-audit-1026-line.mjs — TASK 1026 (AUDIT ONLY): Line length + angle box matrix (rows B-L*)
// Run: node tests/audits/drawbox-audit-1026-line.mjs
import { start, row, f } from './drawbox-audit-1026-kit.js';

const k = await start({ tag: '1026-line', view: { cx: 0, cy: 0, vw: 220 } });
const lines = (sn) => sn.shapes.filter((s) => s.type === 'line');
const dims = (sn) => sn.cons.filter((c) => c.type === 'distance' || c.type === 'angle');
const near = (a, b, t = 0.05) => Math.abs(a - b) <= t;
const S = [-60, 10];       // segment start
const M1 = [-20, 0];       // cursor: up-right of S, 41.23 long, 14.04 deg ccw
const M2 = [-30, 38];      // cursor: down-right of S (about -43 deg), on screen (the canvas shows y -46..46)
const has = (sn, t) => sn.cons.some((c) => c.type === t);

try {
  // ── B-L01 nothing typed, click-click baseline ──
  await k.cell('B-L01', 'Line', 'nothing typed, click then click (baseline)', async () => {
    await k.pickTool('line'); await k.clickW(...S); await k.moveW(...M1); await k.clickW(...M1);
  }, { check: (fin) => lines(fin).length !== 1 ? `lines=${lines(fin).length}` : (dims(fin).length ? 'click-click made a dimension' : null) });

  // ── B-L02 nothing typed, click only (box open, no cursor move), Enter ──
  await k.cell('B-L02', 'Line', 'click only, then Enter (cursor still on the start)', async () => {
    await k.pickTool('line'); await k.clickW(...S); await k.pressKey('Enter');
  }, { check: (fin, live) => (lines(fin).length ? 'Enter drew a line with no length' : (!live.box.dual ? 'box closed on a refused Enter' : null)) });

  // ── B-L03 first field only ──
  await k.cell('B-L03', 'Line', 'length only (40), Enter', async () => {
    await k.pickTool('line'); await k.clickW(...S); await k.moveW(...M1); await k.typeText('40'); await k.pressKey('Enter');
  }, { check: (fin) => { const l = lines(fin)[0]; if (!l) return 'no line'; if (!near(l.len, 40)) return `len ${f(l.len)}`; if (!near(l.ang, 13.99, 0.5)) return `angle ${f(l.ang)} did not follow the cursor`; const d = fin.cons.find((c) => c.type === 'distance'); return d && near(d.value, 40) && !d.driven ? null : 'no driving length dim 40'; } });

  // ── B-L04 second field only ──
  await k.cell('B-L04', 'Line', 'angle only (Tab, 30), Enter', async () => {
    await k.pickTool('line'); await k.clickW(...S); await k.moveW(...M1); await k.pressKey('Tab'); await k.typeText('30'); await k.pressKey('Enter');
  }, { check: (fin) => { const l = lines(fin)[0]; if (!l) return 'no line'; if (!near(l.ang, 30, 0.3)) return `angle ${f(l.ang)}`; if (!near(l.len, 41.23, 0.3)) return `len ${f(l.len)} did not follow the cursor`; return has(fin, 'angle') ? null : 'typed angle made no angle dimension (Fusion check)'; } });

  // ── B-L05 both ──
  await k.cell('B-L05', 'Line', 'length 40 + angle 30, Enter', async () => {
    await k.pickTool('line'); await k.clickW(...S); await k.moveW(...M1); await k.typeText('40'); await k.pressKey('Tab'); await k.typeText('30'); await k.pressKey('Enter');
  }, { check: (fin) => { const l = lines(fin)[0]; if (!l) return 'no line'; if (!(near(l.len, 40) && near(l.ang, 30, 0.3))) return `len ${f(l.len)} ang ${f(l.ang)}`; return has(fin, 'angle') ? null : 'typed angle made no angle dimension (Fusion check)'; } });

  // ── B-L06 retyped ──
  await k.cell('B-L06', 'Line', 'length 40 then retyped 25, Enter', async () => {
    await k.pickTool('line'); await k.clickW(...S); await k.moveW(...M1); await k.typeText('40'); await k.selField(0); await k.typeText('25'); await k.pressKey('Enter');
  }, { check: (fin) => { const l = lines(fin)[0]; const d = fin.cons.filter((c) => c.type === 'distance'); return l && near(l.len, 25) && d.length === 1 && near(d[0].value, 25) ? null : `len ${l && f(l.len)} dims ${JSON.stringify(d.map((x) => x.value))}`; } });

  // ── B-L07 typed then Backspace to empty: does it unlock? ──
  await k.cell('B-L07', 'Line', 'length 40, Backspace x2 (empty), move cursor to M2, Enter', async () => {
    await k.pickTool('line'); await k.clickW(...S); await k.moveW(...M1); await k.typeText('40'); await k.pressKey('Backspace'); await k.pressKey('Backspace');
    await k.moveW(...M2); await k.pressKey('Enter');
  }, { check: (fin) => { const l = lines(fin)[0]; if (!l) return 'no line'; const want = Math.hypot(M2[0] - S[0], M2[1] - S[1]); return near(l.len, want, 1.5) ? (dims(fin).length ? 'unlocked line still got a dimension' : null) : `len ${f(l.len)} (cursor length ${f(want)}): still locked at 40?`; } });

  // ── B-L08 typed then Backspace one char (4) ──
  await k.cell('B-L08', 'Line', 'length 40, Backspace once (=4), Enter', async () => {
    await k.pickTool('line'); await k.clickW(...S); await k.moveW(...M1); await k.typeText('40'); await k.pressKey('Backspace'); await k.pressKey('Enter');
  }, { check: (fin) => { const l = lines(fin)[0]; return l && near(l.len, 4) ? null : `len ${l && f(l.len)}`; } });

  // ── B-L09 typed, mouse moved: lock holds, direction follows ──
  await k.cell('B-L09', 'Line', 'length 40, then the mouse moves to M2 (lock holds? direction follows?), Enter', async () => {
    await k.pickTool('line'); await k.clickW(...S); await k.moveW(...M1); await k.typeText('40'); await k.moveW(...M2); await k.pressKey('Enter');
  }, { check: (fin) => { const l = lines(fin)[0]; if (!l) return 'no line'; const a = -Math.atan2(M2[1] - S[1], M2[0] - S[0]) * 180 / Math.PI; return near(l.len, 40) && near(l.ang, a, 1) ? null : `len ${f(l.len)} ang ${f(l.ang)} want ${f(a)}`; } });

  // ── B-L10 commit by CLICK instead of Enter (length typed) ──
  await k.cell('B-L10', 'Line', 'length 40 typed, commit by CLICK at M2', async () => {
    await k.pickTool('line'); await k.clickW(...S); await k.moveW(...M1); await k.typeText('40'); await k.clickW(...M2);
  }, { check: (fin) => { const l = lines(fin)[0]; if (!l) return 'no line (click refused)'; const d = fin.cons.find((c) => c.type === 'distance'); return near(l.len, 40) && d && near(d.value, 40) ? null : `len ${f(l.len)} dim ${d ? d.value : 'none'}`; } });

  // ── B-L11 commit by click: angle typed ──
  await k.cell('B-L11', 'Line', 'angle 30 typed (Tab), commit by CLICK at M1', async () => {
    await k.pickTool('line'); await k.clickW(...S); await k.moveW(...M1); await k.pressKey('Tab'); await k.typeText('30'); await k.clickW(...M1);
  }, { check: (fin) => { const l = lines(fin)[0]; return l && near(l.ang, 30, 0.3) ? null : `ang ${l && f(l.ang)}`; } });

  // ── B-L12 chain: 2nd and 3rd segment, do the boxes reset or carry? ──
  await k.cell('B-L12', 'Line', 'chain: seg1 L=40, seg2 box value after Enter, seg2 L=25, seg3 untouched cursor click', async () => {
    await k.pickTool('line'); await k.clickW(...S); await k.moveW(...M1); await k.typeText('40'); await k.pressKey('Enter');
    const b2 = await k.snap(); row('B-L12.box2', `segment-2 box right after seg-1 Enter: ${JSON.stringify(b2.box.dualVals)} focus=${b2.box.focus}`);
    await k.moveW(20, 30); await k.typeText('25'); await k.pressKey('Enter');
    const b3 = await k.snap(); row('B-L12.box3', `segment-3 box right after seg-2 Enter: ${JSON.stringify(b3.box.dualVals)}`);
    await k.moveW(60, 10); await k.clickW(60, 10);
  }, { check: (fin) => { const l = lines(fin); return l.length === 3 && near(l[0].len, 40) && near(l[1].len, 25) ? null : `lines ${JSON.stringify(l.map((x) => f(x.len)))}`; } });

  // ── B-L13 chain: seg1 angle typed 30: does seg2 carry the angle? ──
  await k.cell('B-L13', 'Line', 'chain: seg1 L=40 A=30 Enter, seg2 only moves + Enter (no typing): is the box empty or carried?', async () => {
    await k.pickTool('line'); await k.clickW(...S); await k.moveW(...M1); await k.typeText('40'); await k.pressKey('Tab'); await k.typeText('30'); await k.pressKey('Enter');
    await k.moveW(10, 45); await k.pressKey('Enter');
  }, { check: (fin) => { const l = lines(fin); if (l.length < 2) return `lines ${l.length}`; return null; } });

  // ── B-L14 snap: typed length lands exactly on an existing point ──
  await k.cell('B-L14', 'Line', 'typed length 40 whose end is exactly an existing endpoint (cursor on it), Enter', async () => {
    await k.pickTool('line'); await k.clickW(40, -30); await k.moveW(70, -30); await k.clickW(70, -30); await k.pressKey('Escape');
    await k.pickTool('line'); await k.clickW(0, -30); await k.moveW(40, -30); await k.typeText('40'); await k.pressKey('Enter');
  }, { check: (fin) => (fin.cons.filter((c) => c.type === 'coincident').length >= 1 ? null : 'end landed on the point but no coincident') });

  // ── B-L14b control: the same end placed by a CLICK on the point (no typing) ──
  await k.cell('B-L14b', 'Line', 'control: the same end placed by a CLICK on the existing endpoint (no typing)', async () => {
    await k.pickTool('line'); await k.clickW(40, -30); await k.moveW(70, -30); await k.clickW(70, -30); await k.pressKey('Escape');
    await k.pickTool('line'); await k.clickW(0, -30); await k.moveW(40, -30); await k.clickW(40, -30);
  }, { check: (fin) => (fin.cons.filter((c) => c.type === 'coincident').length >= 1 ? null : 'click on the endpoint made no coincident') });
  // ── B-L14c typed length, cursor on the point, commit by click ──
  await k.cell('B-L14c', 'Line', 'typed length 40 (end exactly on the endpoint), commit by CLICK on the point', async () => {
    await k.pickTool('line'); await k.clickW(40, -30); await k.moveW(70, -30); await k.clickW(70, -30); await k.pressKey('Escape');
    await k.pickTool('line'); await k.clickW(0, -30); await k.moveW(40, -30); await k.typeText('40'); await k.clickW(40, -30);
  }, { check: (fin) => (fin.cons.filter((c) => c.type === 'coincident').length >= 1 ? null : 'typed length + click on the endpoint made no coincident') });
  // ── B-L15 snap: typed length differs from the distance to the snapped point (over-constrain with a FIXED point) ──
  await k.cell('B-L15', 'Line', 'start at the fixed origin, cursor on a joint, typed length 20 != distance (snap vs typed)', async () => {
    await k.pickTool('line'); await k.clickW(40, -30); await k.moveW(70, -30); await k.clickW(70, -30); await k.pressKey('Escape');
    await k.pickTool('line'); await k.clickW(0, 0); await k.moveW(70, -30); await k.typeText('20'); await k.pressKey('Enter');
  }, { check: (fin) => { const l = lines(fin).find((x) => near(x.len, 20)); return l ? (fin.cons.some((c) => c.type === 'coincident' && c.joints.length === 2 && JSON.stringify(c.joints).includes('j_origin')) ? null : null) : 'line is not 20 long'; } });

  // ── B-L16 snap: click on existing point with only angle typed that matches ──
  await k.cell('B-L16', 'Line', 'angle 0 typed (Tab,0), then CLICK on an existing point on that horizontal', async () => {
    await k.pickTool('line'); await k.clickW(40, 30); await k.moveW(70, 30); await k.clickW(70, 30); await k.pressKey('Escape');
    await k.pickTool('line'); await k.clickW(0, 30); await k.moveW(40, 30); await k.pressKey('Tab'); await k.typeText('0'); await k.clickW(40, 30);
  }, { check: (fin) => (fin.cons.filter((c) => c.type === 'coincident').length >= 1 ? null : 'click on the point with a matching typed angle made no coincident') });

  // ── B-L17 H/V inference + typed length ──
  await k.cell('B-L17', 'Line', 'cursor exactly horizontal (H inference), type length 30, Enter  [R2-04, task 1021]', async () => {
    await k.pickTool('line'); await k.clickW(...S); await k.moveW(-10, 10); await k.typeText('30'); await k.pressKey('Enter');
  }, { check: (fin) => (has(fin, 'horizontal') ? null : 'no horizontal constraint (R2-04, task 1021)') });

  // ── B-L18 H/V inference + clicked (no typing) ──
  await k.cell('B-L18', 'Line', 'cursor exactly horizontal, click (no typing): the H inference is applied', async () => {
    await k.pickTool('line'); await k.clickW(...S); await k.moveW(-10, 10); await k.clickW(-10, 10);
  }, { check: (fin) => (has(fin, 'horizontal') ? null : 'no horizontal constraint on a click along the H inference') });

  // ── B-L19 H/V inference + typed ANGLE 0 ──
  await k.cell('B-L19', 'Line', 'typed angle 90 (Tab,90), Enter: vertical by angle, is V made?', async () => {
    await k.pickTool('line'); await k.clickW(...S); await k.moveW(...M1); await k.pressKey('Tab'); await k.typeText('90'); await k.pressKey('Enter');
  }, { check: (fin) => (has(fin, 'vertical') || has(fin, 'angle') ? null : 'typed 90 deg is neither vertical nor an angle dimension') });

  // ── B-L20 tangent inference + typed length ──
  await k.cell('B-L20', 'Line', 'circle first; line from a rim point, cursor on the tangent direction, typed length 30, Enter', async () => {
    await k.pickTool('circle'); await k.clickW(0, 0); await k.moveW(20, 0); await k.clickW(20, 0); await k.pressKey('Escape');
    await k.pickTool('line'); await k.clickW(14.14, -14.14); await k.moveW(39.14, 10.86); await k.typeText('30'); await k.pressKey('Enter');
  }, { check: (fin) => (has(fin, 'tangent') ? null : 'no tangent constraint with a typed length (unverified: inference may not have been live)') });

  // ── B-L21 tangent inference + click (control) ──
  await k.cell('B-L21', 'Line', 'same tangent setup, click (no typing)', async () => {
    await k.pickTool('circle'); await k.clickW(0, 0); await k.moveW(20, 0); await k.clickW(20, 0); await k.pressKey('Escape');
    await k.pickTool('line'); await k.clickW(14.14, -14.14); await k.moveW(39.14, 10.86); await k.clickW(39.14, 10.86);
  }, { check: (fin) => (has(fin, 'tangent') ? null : 'no tangent constraint on the control click (the setup may not have reached the inference)') });

  // ── B-L22 formula ──
  await k.cell('B-L22', 'Line', 'formula: first a named line d1=40; then length "d1 / 2", Enter', async () => {
    await k.pickTool('line'); await k.clickW(-30, -35); await k.moveW(10, -35); await k.typeText('40'); await k.pressKey('Enter'); await k.pressKey('Escape'); await k.pressKey('Escape');
    await k.pickTool('line'); await k.clickW(...S); await k.moveW(...M1); await k.typeText('d1 / 2'); await k.pressKey('Enter');
  }, { check: (fin) => { const d = fin.cons.find((c) => c.type === 'distance' && c.expression); return d && near(d.value, 20) && /d1\s*\/\s*2/.test(d.expression) ? null : `dims ${JSON.stringify(dims(fin).map((x) => [x.value, x.expression]))}`; } });

  // ── B-L23 name ──
  await k.cell('B-L23', 'Line', 'name: "w = 50", Enter', async () => {
    await k.pickTool('line'); await k.clickW(...S); await k.moveW(...M1); await k.typeText('w = 50'); await k.pressKey('Enter');
  }, { check: (fin) => { const d = fin.cons.find((c) => c.type === 'distance'); return d && d.name === 'w' && near(d.value, 50) ? null : `dims ${JSON.stringify(dims(fin))} params ${JSON.stringify(fin.params)}`; } });

  // ── B-L24 existing user parameter ──
  await k.cell('B-L24', 'Line', 'existing user parameter: "w = 50" on line 1, then on line 2 length "w", and "w = 60" (reassign)', async () => {
    await k.pickTool('line'); await k.clickW(-30, -35); await k.moveW(10, -35); await k.typeText('w = 50'); await k.pressKey('Enter'); await k.pressKey('Escape'); await k.pressKey('Escape');
    await k.pickTool('line'); await k.clickW(...S); await k.moveW(...M1); await k.typeText('w'); await k.pressKey('Enter');
  }, { check: (fin) => { const ds = fin.cons.filter((c) => c.type === 'distance'); return ds.length === 2 && ds.every((d) => near(d.value, 50)) && ds.some((d) => d.expression === 'w') ? null : `dims ${JSON.stringify(ds.map((x) => [x.name, x.value, x.expression]))}`; } });

  // ── B-L25 units: unit suffixes, mm doc ──
  for (const [id, txt, want, label] of [
    ['B-L25a', '2 in', 50.8, 'units: "2 in" in an mm document'],
    ['B-L25b', '25.4mm', 25.4, 'units: "25.4mm"'],
    ['B-L25c', '1/2"', 12.7, 'units: fraction 1/2" in an mm document'],
    ['B-L25d', '3cm', 30, 'units: "3cm"'],
  ]) {
    await k.cell(id, 'Line', label, async () => {
      await k.pickTool('line'); await k.clickW(...S); await k.moveW(...M1); await k.typeText(txt); await k.pressKey('Enter');
    }, { check: (fin) => { const l = lines(fin)[0]; return l && near(l.len, want, 0.02) ? null : `len ${l && f(l.len, 3)} want ${want}`; } });
  }
  // ── B-L26 degenerate and garbage ──
  for (const [id, txt, label] of [
    ['B-L26a', '0', 'value 0'], ['B-L26b', '-5', 'negative -5'], ['B-L26c', '99999', 'huge 99999'], ['B-L26d', '40abc', 'trailing garbage "40abc"'],
    ['B-L26e', 'abc', 'garbage "abc"'], ['B-L26f', '1e3', 'exponent "1e3"'], ['B-L26g', '40 +', 'dangling operator "40 +"'], ['B-L26h', '4,5', 'comma "4,5"'],
  ]) {
    await k.cell(id, 'Line', `length ${label}, Enter`, async () => {
      await k.pickTool('line'); await k.clickW(...S); await k.moveW(...M1); await k.typeText(txt); await k.pressKey('Enter');
    }, { check: (fin, live) => (['B-L26c', 'B-L26f'].includes(id) ? (lines(fin).length === 1 ? null : 'not accepted') : (lines(fin).length === 0 && (live.box.dual || live.box.single) ? null : `shapes ${lines(fin).length}, boxOpen ${live.box.dual}`)) });
  }
  // ── B-L27 typed angle degenerate ──
  for (const [id, txt, label] of [['B-L27a', '-30', 'angle -30'], ['B-L27b', '360', 'angle 360'], ['B-L27c', '450', 'angle 450'], ['B-L27d', 'abc', 'angle "abc"'], ['B-L27e', '30deg', 'angle "30deg"'], ['B-L27f', '1/2', 'angle "1/2"']]) {
    await k.cell(id, 'Line', `angle ${label}, Enter`, async () => {
      await k.pickTool('line'); await k.clickW(...S); await k.moveW(...M1); await k.pressKey('Tab'); await k.typeText(txt); await k.pressKey('Enter');
    }, { check: (fin, live) => { const l = lines(fin)[0]; if (id === 'B-L27d') return !l && live.box.dual ? null : `line=${!!l} boxOpen=${live.box.dual}`; return l ? null : 'no line'; } });
  }
  // ── B-L28 Tab behaviour and focus ──
  await k.cell('B-L28', 'Line', 'Tab Tab: focus returns to the first field; second Tab back', async () => {
    await k.pickTool('line'); await k.clickW(...S); await k.moveW(...M1);
    const a = await k.snap(); await k.pressKey('Tab'); const b = await k.snap(); await k.pressKey('Tab'); const c = await k.snap();
    row('B-L28.focus', `focus after open ${a.box.focus} -> Tab ${b.box.focus} -> Tab ${c.box.focus}`);
  });
  // ── B-L29 Ctrl+Z inside the box ──
  await k.cell('B-L29', 'Line', 'length 40 typed, Ctrl+Z inside the box (resets that field only), Enter', async () => {
    await k.pickTool('line'); await k.clickW(...S); await k.moveW(...M1); await k.typeText('40'); await k.pressKey('z', { ctrl: true }); await k.pressKey('Enter');
  }, { check: (fin) => { const l = lines(fin)[0]; return l && near(l.len, 41.23, 0.5) && !dims(fin).length ? null : `len ${l && f(l.len)} dims ${dims(fin).length}`; } });
  // ── B-L30 right-click finalize ──
  await k.cell('B-L30', 'Line', 'length 40 typed, RIGHT-click on the canvas (finalizes the segment)', async () => {
    await k.pickTool('line'); await k.clickW(...S); await k.moveW(...M1); await k.typeText('40'); await k.clickW(...M2, { button: 'right' });
  }, { check: (fin) => { const l = lines(fin)[0]; return l && near(l.len, 40) ? null : `len ${l && f(l.len)}`; } });
} finally { await k.close(); }
