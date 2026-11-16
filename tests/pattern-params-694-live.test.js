// tests/pattern-params-694-live.test.js - TASK 694: a sketch pattern's values are named document parameters (Fusion's d<n>), in the REAL Shaper
// page (Design tab), real mouse at 1400 x 860 and real touch on a 390 x 844 phone, real keys (resetBufferLive before each phase):
//   a short vertical line (fixed) and a horizontal line M with its distance dimension d1 = 20 mm are seeded; the line is picked with the Select tool,
//   the Rectangular Pattern tool makes the pattern from it, OK -> the Parameters window (the footer's fx button) shows its values as rows d2..d5
//   (Count / Count / Length / Length); d2 = 4 in the table; `pitch = 25 mm` typed into d4's Expression cell NAMES it (task 677's rule); d1 =
//   `pitch * 2`; pitch = 30 mm in the table -> the pattern AND d1 move, ONE undo step; 2.5 typed into the quantity is refused with THE pattern
//   rule's message under the row, the table keeps 4; the canvas label shows no fx (pitch is named, not a formula).
//   circular: a user angle parameter `turn` = -90 deg (+ Add), a new line picked, the Circular Pattern tool, its centre picked on the line's
//   end, Distribution Angle, `turn` typed into the Angle box, OK -> the copies run CLOCKWISE (task 691), the label reads fx: 3 x -90.
// Cropped screenshots (table + canvas) in .evidence/694/.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sendRealKey, sleep } from './helpers/cdp-browser.js';
import { resetBufferLive } from './helpers/reset-buffer.js';
import { pressRibbonTool } from './helpers/ribbon-tool.js';

const EVID = path.resolve('.evidence/694');
fs.mkdirSync(EVID, { recursive: true });

await (async () => {
  const cdp = await launchBrowser({ tag: '694', width: 1400, height: 860 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, waitFor, navigate, waitForApp } = cdp;
  const W = '.sk-pwin';
  const mouseEv = (type, x, y, buttons = 0, clickCount = 1) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : clickCount });
  const mouse = async (p) => { await mouseEv('mouseMoved', p.x, p.y); await sleep(40); await mouseEv('mousePressed', p.x, p.y, 1); await sleep(30); await mouseEv('mouseReleased', p.x, p.y); await sleep(300); };
  const T = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i, radiusX: 1, radiusY: 1, force: 1 })) });
  const touch = async (p) => { await T('touchStart', [p]); await sleep(50); await T('touchEnd', []); await sleep(400); };
  let pointer = mouse;
  const key = (k, code, vk, mods = 0, text = '') => sendRealKey(send, k, code, vk, mods, text);
  const Enter = async () => { await key('Enter', 'Enter', 13, 0, '\r'); await sleep(500); };
  const Tab = () => key('Tab', 'Tab', 9);
  const selectAll = () => key('a', 'KeyA', 65, 2);
  const SIGN = { ' ': ['Space', 32], '=': ['Equal', 187], '*': ['Digit8', 56], '-': ['Minus', 189], '.': ['Period', 190], '/': ['Slash', 191] };
  const type = async (text) => {
    for (const ch of text) {
      const [code, vk] = /[a-z]/i.test(ch) ? ['Key' + ch.toUpperCase(), ch.toUpperCase().charCodeAt(0)] : /\d/.test(ch) ? ['Digit' + ch, ch.charCodeAt(0)] : SIGN[ch];
      await key(ch, code, vk, 0, ch); await sleep(15);
    }
    await sleep(200);
  };
  const center = async (sel) => {
    const c = await evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({ block: 'nearest', inline: 'nearest' }); const r = e.getBoundingClientRect(); return r.width ? { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) } : null; })()`);
    assert(c, sel + ' not on screen'); return c;
  };
  const press = async (sel) => pointer(await center(sel));
  const S = (expr) => evalJs(`(() => { const s = window.__designController.state; return (${expr}); })()`);
  const J = (expr) => S(`JSON.stringify(${expr})`).then(JSON.parse);
  const history = () => S('s.history.length');
  const toScreen = (x, y) => evalJs(`(() => { const svg = document.querySelector('#design-canvas'); const pt = svg.createSVGPoint(); pt.x = ${x}; pt.y = ${y}; const q = pt.matrixTransform(svg.getScreenCTM()); return { x: Math.round(q.x), y: Math.round(q.y) }; })()`);
  const row = (name) => `${W} tr.sk-ptable-row[data-name="${name}"]`;
  const cellIn = (name, col) => `${row(name)} input[data-col="${col}"]`;
  const message = (name) => evalJs(`(() => { const r = document.querySelector(${JSON.stringify(row(name))}); const m = r && r.nextElementSibling; return m && m.classList.contains('pt-msg') ? { text: m.textContent, err: m.classList.contains('pt-msg-err') } : null; })()`);
  const typeCell = async (name, col, text, { enter = true } = {}) => { await press(cellIn(name, col)); await selectAll(); await type(text); if (enter) await Enter(); };
  const pat = (type) => J(`(() => { const c = s.constraints.find((k) => k.type === ${JSON.stringify(type)}); return c ? { names: c.names, expressions: c.expressions || null, quantity: c.quantity, distance: c.distance, angle: c.angle, distanceType: c.distanceType, idx: s.constraints.indexOf(c), n: c.instances.length } : null; })()`);
  const d1 = () => J(`(() => { const c = s.constraints.find((k) => k.type === 'distance'); const a = s.joints.get('m0'), b = s.joints.get('m1'); return { name: c.name, expression: c.expression || null, value: Math.round(c.value * 1e6) / 1e6, len: Math.round(Math.hypot(b.x - a.x, b.y - a.y) * 1e6) / 1e6 }; })()`);
  const labelText = (idx) => evalJs(`[...document.querySelectorAll('#design-canvas .dim-label[data-constraint-idx="${idx}"] text')].map((t) => t.textContent.trim())`);
  const shot = async (file, rect, pad = 8) => {
    const clip = { x: Math.max(0, Math.round(rect.x - pad)), y: Math.max(0, Math.round(rect.y - pad)), width: Math.round(rect.width + 2 * pad), height: Math.round(rect.height + 2 * pad), scale: 2 };
    const r = await send('Page.captureScreenshot', { format: 'png', clip });
    fs.writeFileSync(path.join(EVID, file), Buffer.from(r.data, 'base64'));
  };
  const rectOf = (sel) => evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.left, y: b.top, width: b.width, height: b.height }; })()`);
  // the screen box of the drawing (every shape's joints) and its labels, inside the canvas
  const drawingRect = () => evalJs(`(() => { const s = window.__designController.state, svg = document.querySelector('#design-canvas'), m = svg.getScreenCTM(), cv = svg.getBoundingClientRect();
    const ps = s.shapes.flatMap((sh) => sh.joints.map((id) => s.joints.get(id))).filter(Boolean).map((j) => { const p = svg.createSVGPoint(); p.x = j.x; p.y = j.y; return p.matrixTransform(m); });
    const ls = [...document.querySelectorAll('#design-canvas .dim-label')].map((g) => g.getBoundingClientRect());
    const xs = [...ps.map((p) => p.x), ...ls.flatMap((b) => [b.left, b.right])], ys = [...ps.map((p) => p.y), ...ls.flatMap((b) => [b.top, b.bottom])];
    const l = Math.max(cv.left, Math.min(...xs) - 20), t = Math.max(cv.top, Math.min(...ys) - 20), r = Math.min(cv.right, Math.max(...xs) + 20), b = Math.min(cv.bottom, Math.max(...ys) + 20);
    return { x: l, y: t, width: r - l, height: b - t }; })()`);
  const openShaper = async () => {
    await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`, 10000);
    await waitFor(`!!document.querySelector('.sk-header-tab[data-tab="design"], .sk-sidebar-handle')`, 'Shaper to load');
    for (let i = 0; i < 5; i++) { const on = await evalJs(`(() => { const t = document.querySelector('.sk-header-tab.active'); return !t || t.dataset.tab === 'design'; })()`); if (on) break; await press('.sk-header-tab[data-tab="design"]'); }
    await waitFor(`!!window.__designController && !!document.getElementById('btn-parameters')`, 'the Shaper Design tab');
    await waitForApp('design-canvas');
  };
  // a short vertical line SRC (fixed: 0,0 -> 0,10 up) and a horizontal line M from (0, -20) with its distance dimension d1 = 20 mm
  const seed = () => evalJs(`(() => {
    const st = window.__designController.state;
    st.clearDocument();
    st.joints.set('s0', { x: 0, y: 0, fixed: true }); st.joints.set('s1', { x: 0, y: -10, fixed: true });
    st.shapes.push({ id: 'SRC', type: 'line', joints: ['s0', 's1'] });
    st.joints.set('m0', { x: 0, y: 20, fixed: true }); st.joints.set('m1', { x: 20, y: 20, fixed: false });
    st.shapes.push({ id: 'M', type: 'line', joints: ['m0', 'm1'] });
    st.constraints.push({ type: 'horizontal', joints: ['m0', 'm1'] });
    st.constraints.push({ type: 'distance', joints: ['m0', 'm1'], value: 20, name: 'd1', dimMode: 'horizontal', offset: 4, isDriven: false, driven: false });
    st.saveState('seeded');
    return st.shapes.length;
  })()`);
  const fit = async (steps = 4) => {
    await press('#btn-recenter-view'); await sleep(500);
    const cv = await center('#design-canvas');
    for (let i = 0; i < steps; i++) { await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: cv.x, y: cv.y, deltaX: 0, deltaY: 200 }); await sleep(120); }
    await sleep(400);
  };
  const tapLine = async (a, b) => { const p = await toScreen((a.x + b.x) / 2, (a.y + b.y) / 2); await pointer(p); };
  const closeDialogToasts = () => evalJs(`(() => { const c = document.getElementById('notification-container'); if (c) c.innerHTML = ''; })()`);

  const scenario = async (tag) => {
    // ---------------- rectangular: made with the tool from the picked line
    await seed();
    await fit(pointer === touch ? 8 : 4); // the phone: further out, so the 4 copies and their label fit its width
    await press('#tool-select');
    await tapLine({ x: 0, y: 0 }, { x: 0, y: -10 });
    assert.ok(await S(`s.selectedShapes.has('SRC')`), `${tag}: the line is picked`);
    await pressRibbonTool(evalJs, pointer, 'tool-rectangularPattern');
    await waitFor(`!!document.querySelector('.sk-pattern-dialog:not([hidden])') && window.__designController.state.constraints.some((c) => c.type === 'rectangularPattern')`, `${tag}: the live pattern`);
    await closeDialogToasts();
    await press('.sk-pattern-dialog .sk-pat-ok');
    await waitFor(`!document.querySelector('.sk-pattern-dialog:not([hidden])')`, `${tag}: OK closes the dialog`);
    let p = await pat('rectangularPattern');
    assert.deepStrictEqual(p.names, { quantity1: 'd2', quantity2: 'd3', distance1: 'd4', distance2: 'd5' }, `${tag}: the values are named d2..d5`);
    await press('#btn-parameters');
    await waitFor(`document.querySelectorAll('${W} tr.pt-dim').length === 5`, `${tag}: the Parameters window shows d1 + the 4 pattern values`);
    const rows = await evalJs(`[...document.querySelectorAll('${W} tr.pt-dim')].map((r) => [r.dataset.name, r.querySelector('td.pt-comment').textContent])`);
    assert.deepStrictEqual(rows.map((r) => r[0]), ['d1', 'd2', 'd3', 'd4', 'd5'], `${tag}: rows`);
    assert.ok(/^Count · Rectangular pattern: quantity 1$/.test(rows[1][1]) && /^Length · Rectangular pattern: distance 1$/.test(rows[3][1]), `${tag}: kinds ${JSON.stringify(rows)}`);
    // d2 = 4, then `pitch = 25 mm` into d4 names it
    await typeCell('d2', 'expression', '4');
    p = await pat('rectangularPattern');
    assert.ok(p.quantity[0] === 4 && p.n === 3, `${tag}: d2 = 4 -> 4 lines (${p.quantity})`);
    await typeCell('d4', 'expression', 'pitch = 25 mm', { enter: false });
    const hint = await message('d4');
    assert.ok(hint && !hint.err && /^names it pitch = /.test(hint.text), `${tag}: the preview names it (${JSON.stringify(hint)})`);
    await Enter();
    p = await pat('rectangularPattern');
    assert.ok(p.names.distance1 === 'pitch' && Math.abs(p.distance[0] - 25) < 1e-9, `${tag}: d4 is now pitch = 25 mm (${JSON.stringify(p.names)} ${p.distance})`);
    await waitFor(`!!document.querySelector(${JSON.stringify(row('pitch'))})`, `${tag}: the row is pitch`);
    // another dimension reads pitch
    await typeCell('d1', 'expression', 'pitch * 2');
    let m = await d1();
    assert.ok(m.expression === 'pitch * 2' && Math.abs(m.value - 50) < 1e-6 && Math.abs(m.len - 50) < 1e-4, `${tag}: d1 = pitch * 2 = 50 (${JSON.stringify(m)})`);
    // pitch 30 in the table: the pattern and d1 move, ONE undo step
    const firstCopy = () => J(`(() => { const c = s.constraints.find((k) => k.type === 'rectangularPattern'); const sh = s.shapes.find((x) => x.id === c.instances[c.instances.length - 1].shapes[0]); return s.joints.get(sh.joints[0]).x; })()`);
    const before = await firstCopy();
    const h0 = await history();
    await typeCell('pitch', 'expression', '30 mm');
    p = await pat('rectangularPattern'); m = await d1();
    const after = await firstCopy();
    assert.ok(Math.abs(p.distance[0] - 30) < 1e-9 && Math.abs(m.value - 60) < 1e-6 && Math.abs(m.len - 60) < 1e-4, `${tag}: pitch 30 -> d1 60 (${p.distance} ${JSON.stringify(m)})`);
    assert.ok(Math.abs(after / before - 30 / 25) < 1e-6, `${tag}: the last copy moved with pitch (${before} -> ${after})`);
    assert.strictEqual(await history(), h0 + 1, `${tag}: ONE undo step`);
    // 2.5 refused with THE pattern rule's message, the table keeps 4
    await typeCell('d2', 'expression', '2.5', { enter: false });
    const bad = await message('d2');
    assert.deepStrictEqual(bad, { text: 'd2: quantity 1 must be a whole number of 1 or more', err: true }, `${tag}: 2.5 refused under the row`);
    await Enter();
    p = await pat('rectangularPattern');
    assert.ok(p.quantity[0] === 4 && (await history()) === h0 + 1, `${tag}: Enter applies nothing (${p.quantity})`);
    await key('Escape', 'Escape', 27); await sleep(200);
    const labels = await labelText(p.idx);
    // pitch holds a plain value (it is named, no formula): the label shows no fx, like a named dimension (task 677); the circular one below does
    assert.ok(labels.length && labels[0].startsWith('4 × '), `${tag}: the canvas label: 4 copies, no formula mark (${JSON.stringify(labels)})`);
    await sleep(300);
    await shot(`${tag}-1-table-pitch30.png`, await rectOf(W));
    await press(`${W} .sk-dock-close`); // the canvas without the window (a phone's bottom sheet covers it)
    await waitFor(`(() => { const e = document.querySelector('${W}'); return !e || e.hidden || e.getBoundingClientRect().width === 0; })()`, `${tag}: the window closed`);
    await sleep(300);
    await shot(`${tag}-2-canvas-pitch30.png`, await drawingRect());
    await press('#btn-parameters');
    await waitFor(`!!document.querySelector(${JSON.stringify(cellIn('pitch', 'name'))})`, `${tag}: the window again`);
    // one Ctrl+Z (a cell with nothing pending: the drawing's undo) -> pitch 25, d1 50
    await press(cellIn('pitch', 'name'));
    await key('z', 'KeyZ', 90, 2); await sleep(600);
    p = await pat('rectangularPattern'); m = await d1();
    assert.ok(Math.abs(p.distance[0] - 25) < 1e-9 && Math.abs(m.value - 50) < 1e-6, `${tag}: Ctrl+Z -> pitch 25, d1 50 (${p.distance} ${m.value})`);
    await key('Escape', 'Escape', 27); await sleep(200);
    await key('Escape', 'Escape', 27); await sleep(300);

    // ---------------- circular: a user angle parameter drives the total angle, clockwise
    await seed();
    await fit();
    await press('#btn-parameters');
    await waitFor(`!!document.querySelector('${W} .pt-add')`, `${tag}: the Parameters window`);
    await press(`${W} .pt-add`);
    await type('turn'); await Tab();
    await evalJs(`(() => { const sel = document.querySelector('${W} tr.pt-new select'); sel.value = 'deg'; sel.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await press(`${W} tr.pt-new input[data-col="expression"]`);
    await type('-90'); await Enter();
    assert.deepStrictEqual(await J(`s.parameters.map((x) => [x.name, x.unit, x.expression])`), [['turn', 'deg', '-90 deg']], `${tag}: + Add turn = -90 deg`);
    await key('Escape', 'Escape', 27); await sleep(200); await key('Escape', 'Escape', 27); await sleep(300);
    if (await evalJs(`(() => { const e = document.querySelector('${W}'); return !!e && !e.hidden && e.getBoundingClientRect().width > 0; })()`)) await press(`${W} .sk-dock-close`);
    await press('#tool-select');
    await tapLine({ x: 0, y: 0 }, { x: 0, y: -10 });
    await pressRibbonTool(evalJs, pointer, 'tool-circularPattern');
    await waitFor(`window.__designController.state.pattern && window.__designController.state.pattern.step === 'centre'`, `${tag}: the centre step`);
    await closeDialogToasts();
    await evalJs(`(() => { const s = document.querySelector('.sk-pattern-dialog [data-field="Distribution"]'); s.value = 'angle'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await press('.sk-pattern-dialog [data-field="Angle"]');
    await selectAll(); await type('turn');
    assert.strictEqual(await evalJs(`document.querySelector('.sk-pattern-dialog [data-field="Angle"]').getAttribute('aria-invalid')`), 'false', `${tag}: the Angle box takes turn`);
    await pointer(await toScreen(0, 0));
    await waitFor(`window.__designController.state.constraints.some((c) => c.type === 'circularPattern')`, `${tag}: the centre picked: the live pattern`);
    await closeDialogToasts();
    await press('.sk-pattern-dialog .sk-pat-ok');
    await waitFor(`!document.querySelector('.sk-pattern-dialog:not([hidden])')`, `${tag}: OK`);
    const k = await pat('circularPattern');
    assert.ok(k.angle === -90 && k.expressions && k.expressions.angle === 'turn' && k.n === 2, `${tag}: the total angle reads turn = -90 (${JSON.stringify(k)})`);
    const dirs = await J(`(() => { const c = s.constraints.find((x) => x.type === 'circularPattern'); return c.instances.map((i) => { const sh = s.shapes.find((x) => x.id === i.shapes[0]); const a = s.joints.get(sh.joints[0]), b = s.joints.get(sh.joints[1]); return Math.round((Math.atan2(-(b.y - a.y), b.x - a.x) * 180 / Math.PI + 360) % 360); }); })()`);
    assert.deepStrictEqual(dirs, [45, 0], `${tag}: clockwise from the source (90 deg): the copies at 45 and 0 deg`);
    const cl = await labelText(k.idx);
    assert.ok(cl.length && cl[0] === 'fx: 3 × -90°', `${tag}: the label reads fx: 3 × -90° (${JSON.stringify(cl)})`);
    await sleep(300);
    await shot(`${tag}-3-circular-turn.png`, await drawingRect());
  };

  try {
    await openShaper();
    await resetBufferLive(cdp);
    await openShaper();
    await scenario('mouse');

    await resetBufferLive(cdp);
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenOrientation: { type: 'portraitPrimary', angle: 0 } });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    pointer = touch;
    await openShaper();
    await scenario('touch');
    console.log('pattern-params-694-live: ok');
  } finally { await cdp.close(); }
})();
process.exit(0);
