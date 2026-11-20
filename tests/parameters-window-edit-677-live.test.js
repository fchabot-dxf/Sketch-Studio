// TASK 677 (docs/PARAMETERS-DESIGN.md slice 5) — the Parameters window EDITS, in the REAL Shaper page (Design tab), real mouse / touch and real keys:
//   A. desktop, mouse: the box-frame template; thickness 18 -> 12 typed IN THE TABLE: while typing the live preview under the row and NOTHING moves;
//      Enter applies (every board 12 thick on the canvas, the thickness dimension label reads 12.0) and moves down one row in the same column;
//      an invalid text: aria-invalid, red border, the message under the row, the old value in force; Esc reverts; Ctrl+Z in a cell restores 18;
//      rename (Name cell, Tab applies on leaving the cell): the formulas follow; + Add (Name focused, Tab, Enter creates); the bin refused while in use
//      (aria-disabled + a tooltip listing the users), deleting an unused one; the Comment; the parameter-name completion in an Expression cell; a
//      user row's click selects every dimension that depends on it; a second Esc (nothing being edited) closes the window.
//   B. phone 390 x 844, real touch: the bottom sheet (full width, inputs >= 36 px, no sideways scroll); thickness 18 -> 12 in the table by taps and
//      keys; the canvas follows; Ctrl+Z restores 18; a row's tap shows its Comment in the Value's place.
// EVIDENCE_DIR (optional): cropped screenshots.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sendRealKey, sleep } from './helpers/cdp-browser.js';
import { resetBufferLive } from './helpers/reset-buffer.js';

await (async () => {
  const cdp = await launchBrowser({ tag: '677', width: 1400, height: 860 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, waitFor, navigate, waitForApp } = cdp;
  const W = '.sk-pwin';
  const rectOf = (sel) => evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const b = e.getBoundingClientRect(); return b.width ? { x: b.left, y: b.top, width: b.width, height: b.height } : null; })()`);
  const shot = async (name, sel, { pad = 0, scale = 2, extra = 0 } = {}) => {
    if (!process.env.EVIDENCE_DIR) return;
    const r = sel ? await rectOf(sel) : null;
    const clip = r ? { x: Math.max(0, r.x - pad), y: Math.max(0, r.y - pad), width: r.width + 2 * pad, height: r.height + 2 * pad + extra, scale } : undefined;
    const s = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip } : {}) });
    fs.writeFileSync(path.join(process.env.EVIDENCE_DIR, name), Buffer.from(s.data, 'base64'));
  };
  const center = async (sel, i = 0) => {
    const c = await evalJs(`(() => { const e = document.querySelectorAll(${JSON.stringify(sel)})[${i}]; if (!e) return null; e.scrollIntoView({ block: 'nearest', inline: 'nearest' }); const r = e.getBoundingClientRect(); return r.width ? { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) } : null; })()`);
    assert(c, sel + ' #' + i + ' not on screen'); return c;
  };
  const mouseEv = (type, x, y, buttons = 0, clickCount = 1) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : clickCount });
  const mouse = async (x, y) => { await mouseEv('mouseMoved', x, y); await sleep(30); await mouseEv('mousePressed', x, y, 1); await sleep(30); await mouseEv('mouseReleased', x, y); await sleep(250); };
  const T = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i, radiusX: 1, radiusY: 1, force: 1 })) });
  const touch = async (x, y) => { await T('touchStart', [{ x, y }]); await sleep(40); await T('touchEnd', []); await sleep(350); };
  let pointer = mouse;
  const press = async (sel, i = 0) => { const c = await center(sel, i); await pointer(c.x, c.y); };
  const key = (k, code, vk, mods = 0, text = '') => sendRealKey(send, k, code, vk, mods, text);
  const Enter = () => key('Enter', 'Enter', 13, 0, '\r');
  const Esc = () => key('Escape', 'Escape', 27);
  const Tab = (shift = false) => key('Tab', 'Tab', 9, shift ? 8 : 0);
  const selectAll = () => key('a', 'KeyA', 65, 2);
  // real key events, one per character (letters, digits, space and the formula signs)
  const SIGN = { ' ': ['Space', 32], '+': ['Equal', 187], '-': ['Minus', 189], '*': ['Digit8', 56], '/': ['Slash', 191], '=': ['Equal', 187], '(': ['Digit9', 57], ')': ['Digit0', 48], '.': ['Period', 190] };
  const type = async (text) => {
    for (const ch of text) {
      const [code, vk] = /[a-z]/i.test(ch) ? ['Key' + ch.toUpperCase(), ch.toUpperCase().charCodeAt(0)] : /\d/.test(ch) ? ['Digit' + ch, ch.charCodeAt(0)] : SIGN[ch];
      await key(ch, code, vk, 0, ch); await sleep(15);
    }
    await sleep(150);
  };
  const S = (expr) => evalJs(`(() => { const s = window.__designController.state; return (${expr}); })()`);
  const params = () => S(`JSON.stringify(s.parameters.map((p) => [p.name, p.expression]))`).then(JSON.parse);
  const history = () => S('s.history.length');
  // the box's x levels (the two side boards' edges), from the solved state, and as DRAWN: the canvas line ends in the SVG's own units
  const xLevels = () => S(`JSON.stringify([...new Set([...s.joints.values()].map((j) => Math.round(j.x * 1e4) / 1e4))].sort((a, b) => a - b))`).then(JSON.parse);
  const drawnSides = () => evalJs(`JSON.stringify((() => { const xs = []; for (const l of document.querySelectorAll('#design-canvas line.shape-elem')) for (const a of ['x1', 'x2']) xs.push(Math.round(parseFloat(l.getAttribute(a)) * 100) / 100);
    const u = [...new Set(xs)].sort((a, b) => a - b); return [u[1] - u[0], u[u.length - 1] - u[u.length - 2]].map((v) => Math.round(v * 100) / 100); })())`).then(JSON.parse);
  const thicknessLabel = () => evalJs(`(() => { const s = window.__designController.state; const i = s.constraints.findIndex((c) => c.name === 'd3'); const e = document.querySelector('#design-canvas .dim-label[data-constraint-idx="' + i + '"]'); return e ? e.textContent : null; })()`);
  const row = (name) => `${W} tr.sk-ptable-row[data-name="${name}"]`;
  const cellIn = (name, col) => `${row(name)} input[data-col="${col}"]`;
  const cellValue = (name, col) => evalJs(`(() => { const e = document.querySelector(${JSON.stringify(cellIn(name, col))}); return e ? e.value : null; })()`);
  // the canvas label of a length in the document unit (Shaper's may be inches): 12 mm reads 0.5 in, 18 mm 0.7 in
  const docUnitText = (mm) => evalJs(`document.querySelector(${JSON.stringify(row('d3') + ' td.pt-unit')}).textContent`).then((u) => String(Number((u === 'in' ? mm / 25.4 : mm).toFixed(3))));
  const valueText = (name) => evalJs(`(() => { const e = document.querySelector(${JSON.stringify(row(name) + ' td.pt-val')}); return e ? e.textContent : null; })()`);
  const message = (name) => evalJs(`(() => { const r = document.querySelector(${JSON.stringify(row(name))}); const m = r && r.nextElementSibling; return m && m.classList.contains('pt-msg') ? { text: m.textContent, err: m.classList.contains('pt-msg-err') } : null; })()`);
  const active = () => evalJs(`(() => { const a = document.activeElement; const r = a && a.closest && a.closest('tr.sk-ptable-row'); return a ? { tag: a.tagName, col: a.dataset.col || null, row: r ? (r.dataset.name || r.dataset.kind) : null, cls: a.className } : null; })()`);
  const winOpen = () => evalJs(`(() => { const e = document.querySelector('${W}'); return !!e && !e.hidden && e.getBoundingClientRect().width > 0; })()`);
  const openMenu = async () => {
    const c = await evalJs(`(() => { const e = [...document.querySelectorAll('.sk-sidebar-btn, .sk-sidebar-chevron')].find((x) => x.getClientRects().length > 0); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    assert(c, 'menu trigger'); await pointer(c.x, c.y); await waitFor(`document.querySelector('.sk-sidebar').classList.contains('open')`, 'sidebar open');
  };
  const dontSave = async () => { await sleep(300); const has = await evalJs(`[...document.querySelectorAll('.sk-sidebar-ask button')].some((b) => /Don.t save/.test(b.textContent))`); if (has) await press('.sk-sidebar-ask button:nth-of-type(2)'); };
  const openShaper = async () => {
    await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`, 10000);
    await waitFor(`!!document.querySelector('.sk-header-tab[data-tab="design"], .sk-sidebar-chevron')`, 'Shaper to load');
    for (let i = 0; i < 5; i++) { const on = await evalJs(`(() => { const t = document.querySelector('.sk-header-tab.active'); return !t || t.dataset.tab === 'design'; })()`); if (on) break; await press('.sk-header-tab[data-tab="design"]'); }
    await waitFor(`!!window.__designController && !!document.getElementById('btn-parameters')`, 'the Shaper Design tab');
    await waitForApp('design-canvas');
    // TASK 722: Shaper's document is inches; this test is about mm values (the inch start view is template-units-722-live)
    await evalJs(`(async () => { (await import('/packages/core/settings-manager.js')).default.set('DOC_UNIT', 'mm', { persist: false }); })()`);
  };
  const openBoxFrame = async () => {
    await openMenu(); await press('[data-action="templates"]'); await waitFor(`!!document.querySelector('.sk-tp-card')`, 'the template modal');
    await press('.sk-tp-card[data-template="box-frame"]');
    await waitFor(`!!document.querySelector('.sk-tp-start[data-template="box-frame"]')`, 'the box-frame start view');
    await press('.sk-tp-open');
    await waitFor(`!document.querySelector('.sk-tp')`, 'Open closes the modal');
    await dontSave();
    await waitFor(`window.__designController.state.shapes.length > 20 && window.__designController.state.parameters.length === 3`, 'the box frame with its parameters');
    await press('#btn-recenter-view'); await sleep(500);
  };
  const openWindow = async () => {
    await press('#btn-parameters'); // TASK 677: the footer's always-visible button
    await waitFor(`document.querySelectorAll('${W} tr.pt-user').length === 3 && document.querySelectorAll('${W} tr.pt-dim').length === 14`, 'the Parameters window with the box frame');
  };

  try {
    // ================================================================== A. desktop, mouse
    await openShaper();
    await resetBufferLive(cdp);
    await openShaper();
    await openBoxFrame();
    await openWindow();
    assert.deepStrictEqual(await params(), [['length', '1500 mm'], ['width', '400 mm'], ['thickness', '18 mm']], 'the box frame parameters');
    assert.deepStrictEqual(await xLevels(), [0, 18, 382, 400], 'before: both sides 18 thick');
    const drawn18 = await drawnSides();
    assert.ok(Math.abs(drawn18[0] / drawn18[1] - 1) < 1e-6 && drawn18[0] > 0, 'the canvas draws both sides the same thickness: ' + JSON.stringify(drawn18));
    assert.strictEqual(await cellValue('thickness', 'expression'), '18 mm', 'the Expression cell is an input holding the expression');
    const h0 = await history();

    // thickness 18 -> 12, typed in the table: preview while typing, nothing moves until Enter
    await press(cellIn('thickness', 'expression'));
    assert.deepStrictEqual(await active(), { tag: 'INPUT', col: 'expression', row: 'thickness', cls: 'pt-in' }, 'a click puts the caret in the Expression cell');
    await selectAll(); await type('12');
    assert.strictEqual(await cellValue('thickness', 'expression'), '12', 'the keys went into the cell');
    assert.deepStrictEqual(await message('thickness'), { text: '= 12 mm, also changes d3, d4, d5, d6, d7, d8, d9, d10, d11, d12, d13, d14', err: false }, 'the live preview under the row');
    assert.deepStrictEqual(await params(), [['length', '1500 mm'], ['width', '400 mm'], ['thickness', '18 mm']], 'never per keystroke: the parameter is still 18');
    assert.deepStrictEqual(await xLevels(), [0, 18, 382, 400], 'and nothing moved yet');
    assert.strictEqual(await history(), h0, 'no undo step while typing');
    await sleep(200); await shot('table-mid-edit-preview.png', W, { pad: 2 });
    await Enter(); await sleep(600);
    assert.deepStrictEqual(await params(), [['length', '1500 mm'], ['width', '400 mm'], ['thickness', '12 mm']], 'Enter applied thickness = 12 mm');
    assert.deepStrictEqual(await xLevels(), [0, 12, 388, 400], 'every side board is 12 thick');
    const drawn12 = await drawnSides();
    assert.ok(Math.abs(drawn12[0] / drawn18[0] - 12 / 18) < 1e-3 && Math.abs(drawn12[1] / drawn18[1] - 12 / 18) < 1e-3, `the canvas draws both sides 12/18 as thick as before: ${JSON.stringify(drawn18)} -> ${JSON.stringify(drawn12)}`);
    const lv = await S(`JSON.stringify((() => { const p = [...s.joints.values()].map((j) => ({ x: j.x, y: -j.y })); const t0 = Math.min(...p.filter((q) => q.x > 1e-6).map((q) => q.x)); return [...new Set(p.filter((q) => Math.abs(q.x - t0) < 1e-6).map((q) => Math.round(q.y * 1e4) / 1e4))].sort((a, b) => a - b); })())`).then(JSON.parse);
    assert.strictEqual(lv.length, 12, 'six cross boards: twelve levels ' + JSON.stringify(lv));
    for (let k = 0; k < 6; k++) assert.ok(Math.abs(lv[2 * k + 1] - lv[2 * k] - 12) < 1e-3, `cross board ${k} is 12 thick (${lv[2 * k]} .. ${lv[2 * k + 1]})`);
    const t12 = await docUnitText(12);
    assert.ok((await thicknessLabel()).includes('fx: ' + t12), `the thickness dimension label on the canvas reads fx: ${t12}: ` + await thicknessLabel());
    assert.strictEqual(await history(), h0 + 1, 'ONE undo step');
    await waitFor(`document.querySelector(${JSON.stringify(row('thickness') + ' td.pt-val')}).textContent === '12'`, 'the table value reads 12');
    assert.strictEqual(await cellValue('thickness', 'expression'), '12 mm', 'the cell shows the stored (canonical) expression');
    assert.strictEqual(await message('thickness'), null, 'the preview line is gone');
    assert.deepStrictEqual(await active(), { tag: 'INPUT', col: 'expression', row: 'd1', cls: 'pt-in' }, 'Enter moved down one row in the same column (the first dimension row)');
    await shot('box-frame-thickness-12-canvas.png', '#design-canvas', { scale: 1 });

    // an invalid text: aria-invalid, red border, the message under the row; the old expression stays in force; Esc reverts
    await press(cellIn('width', 'expression'));
    await selectAll(); await type('width +');
    const err = await message('width');
    assert.deepStrictEqual(err, { text: 'unexpected the end of the input at 7', err: true }, 'the error under the row');
    const inv = await evalJs(`(() => { const i = document.querySelector(${JSON.stringify(cellIn('width', 'expression'))}); const cs = getComputedStyle(i); return { invalid: i.getAttribute('aria-invalid'), described: !!i.getAttribute('aria-describedby') && document.getElementById(i.getAttribute('aria-describedby')).textContent, border: cs.borderTopColor }; })()`);
    assert.strictEqual(inv.invalid, 'true', 'aria-invalid');
    assert.strictEqual(inv.described, 'unexpected the end of the input at 7', 'the message is linked with aria-describedby');
    const [rr, gg, bb] = inv.border.match(/\d+/g).map(Number);
    assert.ok(rr > 180 && rr - gg > 100 && rr - bb > 100, 'a red border (the host\'s --sk-error): ' + inv.border);
    await Enter(); await sleep(300);
    assert.deepStrictEqual(await params(), [['length', '1500 mm'], ['width', '400 mm'], ['thickness', '12 mm']], 'Enter on an error applies nothing: width stays 400 mm');
    assert.deepStrictEqual(await active(), { tag: 'INPUT', col: 'expression', row: 'width', cls: 'pt-in pt-pending' }, 'and the caret stays in the cell, the text kept');
    await sleep(200); await shot('table-error-row.png', W, { pad: 2 });
    await Esc(); await sleep(200);
    assert.strictEqual(await cellValue('width', 'expression'), '400 mm', 'Esc reverts the cell');
    assert.strictEqual(await message('width'), null, 'and the message goes');
    assert.strictEqual(await winOpen(), true, 'the first Esc does not close the window');

    // Ctrl+Z typed in a cell with nothing pending: the drawing's undo: thickness 18 again everywhere
    await key('z', 'KeyZ', 90, 2); await sleep(600);
    assert.deepStrictEqual(await params(), [['length', '1500 mm'], ['width', '400 mm'], ['thickness', '18 mm']], 'Ctrl+Z: thickness is 18 mm again');
    assert.deepStrictEqual(await xLevels(), [0, 18, 382, 400], 'Ctrl+Z: both sides 18 thick again');
    assert.deepStrictEqual(await drawnSides(), drawn18, 'Ctrl+Z: the canvas draws the sides exactly as before');
    const t18 = await docUnitText(18);
    assert.ok((await thicknessLabel()).includes('fx: ' + t18), `the canvas label reads fx: ${t18} again: ` + await thicknessLabel());
    await waitFor(`document.querySelector(${JSON.stringify(cellIn('thickness', 'expression'))}).value === '18 mm'`, 'the table reads 18 mm again');
    assert.strictEqual(await history(), h0, 'one undo step undone');

    // rename in the Name cell; Tab leaves the cell = applies; every formula follows
    await press(cellIn('thickness', 'name'));
    await selectAll(); await type('ply');
    assert.deepStrictEqual(await message('thickness'), { text: 'renames thickness to ply; d3, d4, d5, d6, d7, d8, d9, d10, d11, d12, d13, d14 follow', err: false }, 'the rename preview');
    await Tab(); await sleep(400);
    assert.deepStrictEqual(await params(), [['length', '1500 mm'], ['width', '400 mm'], ['ply', '18 mm']], 'Tab out of the Name cell applied the rename');
    assert.strictEqual(await cellValue('d3', 'expression'), 'ply', 'the dimension formula follows the rename');
    assert.deepStrictEqual(await active(), { tag: 'INPUT', col: 'expression', row: 'ply', cls: 'pt-in' }, 'Tab moved Name -> Expression of the same row');
    await Tab(); assert.deepStrictEqual((await active()).col, 'comment', 'Tab: Expression -> Comment');
    await Tab(true); await Tab(true); assert.deepStrictEqual((await active()).col, 'name', 'Shift+Tab goes back to Name');
    await key('z', 'KeyZ', 90, 2); await sleep(400);
    assert.deepStrictEqual(await params(), [['length', '1500 mm'], ['width', '400 mm'], ['thickness', '18 mm']], 'one Ctrl+Z undoes the rename');
    assert.strictEqual(await cellValue('d3', 'expression'), 'thickness', 'and the formula reads thickness again');

    // the bin: refused while in use (aria-disabled, the users in its tooltip); + Add: Name focused, Tab, Enter creates; delete it again
    const bin = await evalJs(`(() => { const b = document.querySelector(${JSON.stringify(row('thickness') + ' .pt-del')}); return { dis: b.getAttribute('aria-disabled'), title: b.title }; })()`);
    assert.deepStrictEqual(bin, { dis: 'true', title: 'thickness is used by d3, d4, d5, d6, d7, d8, d9, d10, d11, d12, d13, d14: it cannot be deleted' }, 'the bin is refused while thickness is in use, its tooltip says by whom');
    await press(row('thickness') + ' .pt-del');
    assert.deepStrictEqual(await message('thickness'), { text: 'thickness is used by d3, d4, d5, d6, d7, d8, d9, d10, d11, d12, d13, d14', err: true }, 'pressing it anyway says why, and deletes nothing');
    assert.strictEqual((await params()).length, 3);
    await press(`${W} .pt-add`);
    assert.deepStrictEqual(await active(), { tag: 'INPUT', col: 'name', row: 'new', cls: 'pt-in' }, '+ Add: an empty row, its Name focused');
    assert.strictEqual(await evalJs(`!!document.querySelector('${W} tr.pt-new')`), true, 'the new row');
    // the new row's unit is the document unit until picked (Fusion's Add dialog default); 20 mm reads 0.8 in in an inch document
    const du = await evalJs(`document.querySelector(${JSON.stringify(row('d3') + ' td.pt-unit')}).textContent`);
    assert.strictEqual(await evalJs(`document.querySelector('${W} tr.pt-new select').value`), du, 'the new row starts in the document unit');
    const gap20 = du === 'in' ? '0.787' : '20';
    await type('gap'); await Tab(); await type('width / 20'); await sleep(100);
    assert.deepStrictEqual(await evalJs(`(() => { const m = document.querySelector('${W} tr.pt-new').nextElementSibling; return m && m.textContent; })()`), `creates gap = ${gap20} ${du}`, 'the new row previews what Enter creates');
    await Enter(); await sleep(400);
    assert.deepStrictEqual(await params(), [['length', '1500 mm'], ['width', '400 mm'], ['thickness', '18 mm'], ['gap', 'width / 20']], 'Enter created gap');
    assert.strictEqual(await evalJs(`!!document.querySelector('${W} tr.pt-new')`), false, 'the new row became the parameter row');
    assert.strictEqual(await valueText('gap'), gap20, `gap = ${gap20} ${du}`);
    // `name = expr` in the new row's Expression cell fills both
    await press(`${W} .pt-add`); await Tab(); await type('shelf = gap * 2'); await Enter(); await sleep(400);
    assert.deepStrictEqual((await params()).slice(3), [['gap', 'width / 20'], ['shelf', 'gap * 2']], '`shelf = gap * 2` in the Expression cell created shelf');
    // the Comment
    await press(cellIn('gap', 'comment')); await type('between boards'); await Enter(); await sleep(300);
    assert.strictEqual(await S(`s.parameters.find((p) => p.name === 'gap').comment`), 'between boards', 'the comment is saved');
    // delete: gap is used by shelf (refused), delete shelf, then gap
    assert.strictEqual(await evalJs(`document.querySelector(${JSON.stringify(row('gap') + ' .pt-del')}).getAttribute('aria-disabled')`), 'true', 'gap is used by shelf');
    const hd = await history();
    await press(row('shelf') + ' .pt-del'); await sleep(300);
    await press(row('gap') + ' .pt-del'); await sleep(300);
    assert.deepStrictEqual(await params(), [['length', '1500 mm'], ['width', '400 mm'], ['thickness', '18 mm']], 'both deleted');
    assert.strictEqual(await history(), hd + 2, 'one undo step per delete');

    // the completion in an Expression cell (the canvas box's own list): `wi` offers width; Down + Enter inserts it
    await press(cellIn('d1', 'expression')); await selectAll(); await type('wi');
    await waitFor(`(() => { const l = document.querySelector('ul.sk-ptable-complete'); return !!l && !l.classList.contains('hidden') && l.textContent.includes('width'); })()`, 'the completion list');
    const list = await evalJs(`[...document.querySelectorAll('ul.sk-ptable-complete li .dc-name')].map((e) => e.textContent)`);
    assert.strictEqual(list[0], 'width', 'width first: ' + JSON.stringify(list));
    const lr = await rectOf('ul.sk-ptable-complete'), ir = await rectOf(cellIn('d1', 'expression'));
    assert.ok(lr.y >= ir.y + ir.height - 1 || lr.y + lr.height <= ir.y + 1, 'the list never hides the cell');
    await sleep(150); await shot('table-completion.png', W, { pad: 2, extra: 120 });
    await key('ArrowDown', 'ArrowDown', 40); await Enter(); await sleep(150);
    assert.strictEqual(await cellValue('d1', 'expression'), 'width', 'Down + Enter inserted width');
    await Enter(); await sleep(300);
    assert.strictEqual(await S(`s.constraints.find((c) => c.name === 'd1').expression`), 'width', 'd1 still reads width');

    // a user row's click (outside its cells) selects every dimension that depends on it
    await press(row('thickness') + ' td.pt-val');
    const picked = await S(`JSON.stringify([...s.selectedConstraints].map((c) => c.name))`).then(JSON.parse);
    assert.deepStrictEqual(picked, ['d3', 'd4', 'd5', 'd6', 'd7', 'd8', 'd9', 'd10', 'd11', 'd12', 'd13', 'd14'], 'clicking thickness selects every dimension that depends on it');
    // a second Esc closes: Esc in a cell with nothing pending
    await press(cellIn('length', 'expression')); await Esc(); await sleep(250);
    assert.strictEqual(await winOpen(), false, 'Esc with nothing being edited closes the window');

    // ================================================================== B. phone 390 x 844, real touch
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenOrientation: { type: 'portraitPrimary', angle: 0 } });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    pointer = touch;
    await openShaper();
    await resetBufferLive(cdp);
    await openShaper();
    await openBoxFrame();
    await openWindow();
    const sheet = await rectOf(W);
    const foot = await rectOf('footer.sk-footer');
    assert.ok(sheet.x === 0 && sheet.width === 390 && Math.round(sheet.y + sheet.height) === Math.round(foot.y), 'phone: a full-width bottom sheet on the footer ' + JSON.stringify({ sheet, foot }));
    assert.strictEqual(await evalJs(`document.documentElement.scrollWidth <= 390`), true, 'phone: no sideways scroll');
    const fit = await evalJs(`(() => { const b = document.querySelector('${W} .sk-dock-body'); const t = document.querySelector('${W} table'); const h = [...document.querySelectorAll('${W} input.pt-in')].filter((i) => i.getClientRects().length).map((i) => Math.round(i.getBoundingClientRect().height)); return { fits: t.scrollWidth <= b.clientWidth, minH: Math.min(...h), unit: getComputedStyle(document.querySelector('${W} th.pt-unit')).display, comment: getComputedStyle(document.querySelector('${W} th.pt-comment')).display }; })()`);
    assert.deepStrictEqual(fit, { fits: true, minH: 36, unit: 'none', comment: 'none' }, 'phone: the table fits, the inputs are 36 px tall, Unit merges into Value and Comment hides');
    assert.strictEqual(await valueText('thickness') + ' ' + await evalJs(`document.querySelector(${JSON.stringify(row('thickness') + ' td.pt-val')}).dataset.unit`), '18 mm', 'phone: Value and Unit in one column');
    // a tap on the row (outside its cells) shows its Comment in the Value's place
    await press(row('thickness') + ' td.pt-val');
    assert.deepStrictEqual(await evalJs(`(() => { const r = document.querySelector(${JSON.stringify(row('thickness'))}); return { open: r.classList.contains('pt-open'), comment: getComputedStyle(r.querySelector('td.pt-comment')).display, value: getComputedStyle(r.querySelector('td.pt-val')).display, text: r.querySelector('td.pt-comment input').value }; })()`),
      { open: true, comment: 'table-cell', value: 'none', text: 'Plywood thickness' }, 'phone: the tap shows the Comment');
    await sleep(150); await shot('phone-sheet-comment-tap.png', row('thickness'), { pad: 4, scale: 3 });
    const hp = await history();
    await press(cellIn('thickness', 'expression'));
    assert.strictEqual((await active()).row, 'thickness', 'phone: a tap puts the caret in the cell');
    assert.strictEqual(await evalJs(`getComputedStyle(document.querySelector(${JSON.stringify(row('thickness') + ' td.pt-val')})).display`), 'table-cell', 'phone: editing the Expression shows the Value again');
    await selectAll(); await type('12');
    assert.deepStrictEqual(await message('thickness'), { text: '= 12 mm, also changes d3, d4, d5, d6, d7, d8, d9, d10, d11, d12, d13, d14', err: false }, 'phone: the preview');
    await sleep(200); await shot('phone-sheet-mid-edit.png');
    await Enter(); await sleep(700);
    assert.deepStrictEqual(await params(), [['length', '1500 mm'], ['width', '400 mm'], ['thickness', '12 mm']], 'phone: thickness = 12 mm');
    assert.deepStrictEqual(await xLevels(), [0, 12, 388, 400], 'phone: every side board 12 thick');
    assert.strictEqual(await history(), hp + 1, 'phone: ONE undo step');
    await sleep(200); await shot('phone-sheet-thickness-12.png');
    await key('z', 'KeyZ', 90, 2); await sleep(700);
    assert.deepStrictEqual(await params(), [['length', '1500 mm'], ['width', '400 mm'], ['thickness', '18 mm']], 'phone: Ctrl+Z restores 18');
    assert.deepStrictEqual(await xLevels(), [0, 18, 382, 400], 'phone: both sides 18 thick again');
    console.log('parameters-window-edit-677-live: ok');
  } finally { await cdp.close(); }
})();
process.exit(0);
