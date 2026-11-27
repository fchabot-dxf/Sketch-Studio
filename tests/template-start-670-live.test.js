// tests/template-start-670-live.test.js -- TASK 670 in the REAL Shaper page (Design tab), real mouse and real touch:
//   A. desktop: Templates... -> the box-frame card -> its START view (params prefilled, Open focused) -> Open: the new design carries the user
//      parameters length / width / thickness; the Parameters window shows them (screenshot); a double click on the thickness dimension and
//      `thickness = 12` + Enter (the dimension box's existing O4 path: it sets the parameter) -> every board is 12 thick, the table reads 12.0.
//   B. the box frame opened with the HORIZONTAL layout from the start view's layout glyph picker (screenshot).
//   C. the right-angle frame corner: the corner-joint glyph picker collapsed (1 glyph), expanded by a press (3, named), Mitered picked (collapses),
//      Open -> the mitered corner (screenshot of the expanded picker, cropped legibly).
//   D. phone 390 x 844, real touch: the start view fits the screen, Open by a tap opens the template.
// EVIDENCE_DIR: the screenshots.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sendRealKey, sleep } from './helpers/cdp-browser.js';
import { resetBufferLive } from './helpers/reset-buffer.js';

await (async () => {
  const cdp = await launchBrowser({ tag: '670', width: 1400, height: 800 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, waitFor, navigate, waitForApp } = cdp;
  const rectOf = (sel) => evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const b = e.getBoundingClientRect(); return b.width ? { x: b.left, y: b.top, width: b.width, height: b.height } : null; })()`);
  const shot = async (name, sel, { pad = 0, scale = 1 } = {}) => {
    if (!process.env.EVIDENCE_DIR) return;
    const r = sel ? await rectOf(sel) : null;
    const clip = r ? { x: Math.max(0, r.x - pad), y: Math.max(0, r.y - pad), width: r.width + 2 * pad, height: r.height + 2 * pad, scale } : undefined;
    const s = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip } : {}) });
    fs.writeFileSync(path.join(process.env.EVIDENCE_DIR, name), Buffer.from(s.data, 'base64'));
  };
  const center = async (sel, i = 0) => {
    const c = await evalJs(`(() => { const e = document.querySelectorAll(${JSON.stringify(sel)})[${i}]; if (!e) return null; const r = e.getBoundingClientRect(); return r.width ? { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) } : null; })()`);
    assert(c, sel + ' #' + i + ' not on screen'); return c;
  };
  const mouseEv = (type, x, y, buttons = 0, clickCount = 1) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : clickCount });
  const mouse = async (x, y) => { await mouseEv('mouseMoved', x, y); await sleep(30); await mouseEv('mousePressed', x, y, 1); await sleep(30); await mouseEv('mouseReleased', x, y); await sleep(300); };
  const dblclick = async (x, y) => { await mouseEv('mouseMoved', x, y); await sleep(60); for (const n of [1, 2]) { await mouseEv('mousePressed', x, y, 1, n); await sleep(30); await mouseEv('mouseReleased', x, y, 0, n); await sleep(60); } await sleep(400); };
  const T = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i, radiusX: 1, radiusY: 1, force: 1 })) });
  const touch = async (x, y) => { await T('touchStart', [{ x, y }]); await sleep(40); await T('touchEnd', []); await sleep(350); };
  let pointer = mouse;
  const press = async (sel, i = 0) => { await evalJs(`document.querySelectorAll(${JSON.stringify(sel)})[${i}].scrollIntoView({ block: 'nearest', inline: 'nearest' })`); await sleep(80); const c = await center(sel, i); await pointer(c.x, c.y); };
  const key = (k, code, vk, mods = 0, text = '') => sendRealKey(send, k, code, vk, mods, text);
  const S = (expr) => evalJs(`(() => { const s = window.__designController.state; return (${expr}); })()`);
  const params = () => S(`JSON.stringify(s.parameters.map((p) => [p.name, p.expression]))`).then(JSON.parse);
  const visibleChoices = (param) => evalJs(`[...document.querySelectorAll('.sk-tp-field[data-param="${param}"] .sk-tp-choice button')].filter((b) => !b.hidden).map((b) => [b.dataset.value, b.getAttribute('aria-label'), b.getAttribute('aria-pressed')])`);
  const choiceSel = (param, value) => `.sk-tp-field[data-param="${param}"] .sk-tp-choice button[data-value="${value}"]`;
  // TASK 674: a joint the preview's corners carry is picked there only (no form row): the corner's own picker
  const cornerChoices = (param) => evalJs(`[...document.querySelectorAll('.sk-tp-corners .sk-tp-corner[data-param="${param}"] button')].filter((b) => !b.hidden).map((b) => [b.dataset.value, b.getAttribute('aria-label'), b.getAttribute('aria-pressed')])`);
  const cornerSel = (param, value) => `.sk-tp-corners .sk-tp-corner[data-param="${param}"] button[data-value="${value}"]`;
  // the inner column's levels (the cross boards' edges) along the long direction, user coordinates, sorted
  const boxLevels = (horizontal) => S(`JSON.stringify((() => { const p = [...s.joints.values()].map((j) => ({ x: j.x, y: -j.y })); const side = (q) => ${horizontal ? 'q.y' : 'q.x'}, along = (q) => ${horizontal ? 'q.x' : 'q.y'};
    const t0 = Math.min(...p.filter((q) => side(q) > 1e-6).map(side)); return [...new Set(p.filter((q) => Math.abs(side(q) - t0) < 1e-6).map((q) => Math.round(along(q) * 1e4) / 1e4))].sort((a, b) => a - b); })())`).then(JSON.parse);
  const openMenu = async () => {
    const c = await evalJs(`(() => { const e = [...document.querySelectorAll('.sk-sidebar-btn, .sk-sidebar-chevron')].find((x) => x.getClientRects().length > 0); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    assert(c, 'menu trigger'); await pointer(c.x, c.y); await waitFor(`document.querySelector('.sk-sidebar').classList.contains('open')`, 'sidebar open');
  };
  const startOf = async (id) => {
    await openMenu(); await press('[data-action="templates"]'); await waitFor(`!!document.querySelector('.sk-tp-card')`, 'the template modal');
    await press(`.sk-tp-card[data-template="${id}"]`);
    await waitFor(`!!document.querySelector('.sk-tp-panel.sk-tp-small .sk-tp-start[data-template="${id}"]')`, id + ': the start view');
  };
  const dontSave = async () => { await sleep(300); const has = await evalJs(`[...document.querySelectorAll('.sk-tp-backdrop [role="dialog"] button')].some((b) => /Don.t save/.test(b.textContent))`); if (has) { await press('.sk-tp-backdrop [role="dialog"] button:nth-of-type(2)').catch(() => {}); } };
  const openShaper = async () => {
    await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`, 10000);
    await waitFor(`!!document.querySelector('.sk-header-tab[data-tab="design"], .sk-sidebar-chevron')`, 'Shaper to load');
    for (let i = 0; i < 5; i++) { const on = await evalJs(`(() => { const t = document.querySelector('.sk-header-tab.active'); return !t || t.dataset.tab === 'design'; })()`); if (on) break; await press('.sk-header-tab[data-tab="design"]'); }
    await waitFor(`!!window.__designController && !!document.getElementById('btn-parameters')`, 'the Shaper Design tab');
    await waitForApp('design-canvas');
    // TASK 722: Shaper's document is inches; this test is about mm values (the inch start view is template-units-722-live)
    await evalJs(`(async () => { (await import('/packages/core/settings-manager.js')).default.set('DOC_UNIT', 'mm', { persist: false }); })()`);
  };
  try {
    // ================================================================== A. desktop, mouse
    await openShaper();
    await resetBufferLive(cdp);
    await openShaper();
    await startOf('box-frame');
    assert.strictEqual(await evalJs(`document.activeElement && document.activeElement.classList.contains('sk-tp-open')`), true, 'Open has the focus');
    assert.deepStrictEqual(await evalJs(`[...document.querySelectorAll('.sk-tp-field')].map((r) => [r.dataset.param, (r.querySelector('input') || {}).value || null])`),
      [['length', '1500'], ['width', '400'], ['thickness', '18'], ['compartments', '5'], ['layout', null], ['joint', null]], 'the box frame start view: its params prefilled');
    await sleep(300); await shot('start-view-box-frame-desktop.png', '.sk-tp-panel', { pad: 4 });
    await press('.sk-tp-open');
    await waitFor(`!document.querySelector('.sk-tp-panel')`, 'Open closes the modal');
    await dontSave();
    await waitFor(`window.__designController.state.shapes.length > 20`, 'the box frame drawn');
    assert.deepStrictEqual(await params(), [['length', '1500 mm'], ['width', '400 mm'], ['thickness', '18 mm']], 'the box frame opened with its user parameters');
    await press('#btn-recenter-view'); await sleep(500);
    await press('#btn-parameters'); // TASK 677: the footer's always-visible button
    await waitFor(`document.querySelectorAll('.sk-pwin tr.pt-user').length === 3`, 'the Parameters window with the 3 user parameters');
    const userRows = () => evalJs(`[...document.querySelectorAll('.sk-pwin tr.pt-user')].map((r) => [...r.children].slice(0, 5).map((c) => { const i = c.querySelector('input, select'); return i ? i.value : c.textContent; }))`); // TASK 677: Name / Expression / Comment are inputs
    assert.deepStrictEqual(await userRows(), [['length', '1500 mm', '1500', 'mm', 'Overall length'], ['width', '400 mm', '400', 'mm', 'Width'], ['thickness', '18 mm', '18', 'mm', 'Plywood thickness']], 'the table shows the parameters');
    const fx = await evalJs(`[...document.querySelectorAll('.sk-pwin tr.pt-dim')].map((r) => { const m = r.children[1].querySelector('.pt-fx:not([hidden])'); return (m ? m.textContent : '') + r.children[1].querySelector('input').value; })`);
    assert.ok(fx.length === 14 && fx.every((t) => t.startsWith('fx')), 'every sketch dimension row is a formula: ' + JSON.stringify(fx));
    await sleep(300); await shot('parameters-table-box-frame.png', '.sk-pwin', { pad: 4, scale: 2 });
    // thickness 18 -> 12 through the dimension box: a double click on the thickness dimension's label, `thickness = 12`, Enter
    const idx = await S(`s.constraints.findIndex((c) => c.expression === 'thickness')`);
    // TASK 683: Recenter (fit) includes dimension labels' boxes, so the thickness label is already inside the canvas.
    const inCanvas = () => evalJs(`(() => { const l = document.querySelector('#design-canvas .dim-label[data-constraint-idx="${idx}"]'), c = document.getElementById('design-canvas'); if (!l) return false; const a = l.getBoundingClientRect(), b = c.getBoundingClientRect(); return a.width > 0 && a.left >= b.left && a.right <= b.right && a.top >= b.top && a.bottom <= b.bottom; })()`);
    assert.ok(await inCanvas(), 'the thickness label is on the canvas after Recenter');
    const lp = await center(`#design-canvas .dim-label[data-constraint-idx="${idx}"]`);
    await press('#tool-select');
    await dblclick(lp.x, lp.y);
    await waitFor(`(() => { const i = document.getElementById('dimInput'); return !!i && !i.classList.contains('hidden'); })()`, 'the dimension box on the thickness dimension', 8000);
    await evalJs(`(() => { const i = document.getElementById('dimInput'); i.focus(); i.select(); })()`);
    await send('Input.insertText', { text: 'thickness = 12' }); await sleep(300);
    await key('Enter', 'Enter', 13, 0, '\r'); await sleep(700);
    assert.deepStrictEqual(await params(), [['length', '1500 mm'], ['width', '400 mm'], ['thickness', '12 mm']], 'the parameter thickness is 12');
    const lv = await boxLevels(false);
    assert.strictEqual(lv.length, 12, 'six cross boards: twelve levels ' + JSON.stringify(lv));
    for (let k = 0; k < 6; k++) assert.ok(Math.abs(lv[2 * k + 1] - lv[2 * k] - 12) < 1e-3, `cross board ${k} is 12 thick (${lv[2 * k]} .. ${lv[2 * k + 1]})`);
    const sides = await S(`JSON.stringify([...new Set([...s.joints.values()].map((j) => Math.round(j.x * 1e4) / 1e4))].sort((a, b) => a - b))`).then(JSON.parse);
    assert.deepStrictEqual(sides, [0, 12, 388, 400], 'both sides are 12 thick');
    assert.ok(Math.abs(lv[11] - 1500) < 1e-3 && Math.abs(lv[0]) < 1e-3, 'still 1500 long');
    await waitFor(`[...document.querySelectorAll('.sk-pwin tr.pt-user')][2].children[2].textContent === '12'`, 'the table reads thickness 12');
    await sleep(300); await shot('parameters-table-box-frame-thickness-12.png', '.sk-pwin', { pad: 4, scale: 2 });
    await shot('box-frame-thickness-12-canvas.png');
    await press('.sk-pwin .sk-dock-close').catch(async () => { await key('Escape', 'Escape', 27); });
    await sleep(300);

    // ================================================================== B. box frame, Horizontal layout
    await startOf('box-frame');
    assert.deepStrictEqual(await visibleChoices('layout'), [['Vertical', 'Vertical layout', 'true']], 'the layout picker collapsed: Vertical');
    await press(choiceSel('layout', 'Vertical'));
    assert.deepStrictEqual((await visibleChoices('layout')).map((x) => x[1]), ['Vertical layout', 'Horizontal layout'], 'a press expands it');
    await sleep(200); await shot('layout-picker-expanded.png', '.sk-tp-field[data-param="layout"]', { pad: 6, scale: 3 });
    await press(choiceSel('layout', 'Horizontal'));
    assert.deepStrictEqual(await visibleChoices('layout'), [['Horizontal', 'Horizontal layout', 'true']], 'Horizontal picked, collapsed');
    await sleep(300); await shot('start-view-box-frame-horizontal.png', '.sk-tp-panel', { pad: 4 });
    await press('.sk-tp-open'); await waitFor(`!document.querySelector('.sk-tp-panel')`, 'opened'); await dontSave();
    await waitFor(`window.__designController.state.shapes.length > 20`, 'the horizontal box frame drawn');
    const ext = await S(`JSON.stringify((() => { const p = [...s.joints.values()]; return [Math.max(...p.map((j) => j.x)) - Math.min(...p.map((j) => j.x)), Math.max(...p.map((j) => -j.y)) - Math.min(...p.map((j) => -j.y))].map((v) => Math.round(v * 1e4) / 1e4); })())`).then(JSON.parse);
    assert.deepStrictEqual(ext, [1500, 400], 'Horizontal: 1500 wide and 400 tall');
    const hl = await boxLevels(true);
    assert.strictEqual(hl.length, 12, 'Horizontal: the ends and dividers stand side by side (12 x levels)');
    await press('#btn-recenter-view'); await sleep(700);
    await shot('box-frame-horizontal-canvas.png', '#design-canvas');

    // ================================================================== C. right-angle frame corner: the corner-joint glyph picker (TASK 674: on the preview's corner)
    await startOf('right-angle-corner');
    assert.deepStrictEqual(await cornerChoices('joint'), [['H-Through', 'Horizontal through', 'true']], 'collapsed: the active joint only');
    await sleep(200); await shot('corner-picker-collapsed.png', '.sk-tp-corners .sk-tp-corner[data-param="joint"]', { pad: 6, scale: 3 });
    await press(cornerSel('joint', 'H-Through'));
    assert.deepStrictEqual(await cornerChoices('joint'), [['V-Through', 'Vertical through', 'false'], ['H-Through', 'Horizontal through', 'true'], ['Miter', 'Mitered', 'false']], 'a press expands it to the 3 joints');
    await sleep(200); await shot('corner-picker-expanded.png', '.sk-tp-corners .sk-tp-corner[data-param="joint"]', { pad: 6, scale: 3 });
    await press(cornerSel('joint', 'Miter'));
    assert.deepStrictEqual(await cornerChoices('joint'), [['Miter', 'Mitered', 'true']], 'Mitered picked, collapsed');
    await sleep(300); await shot('start-view-corner-mitered.png', '.sk-tp-panel', { pad: 4 });
    await press('.sk-tp-open'); await waitFor(`!document.querySelector('.sk-tp-panel')`, 'opened'); await dontSave();
    await waitFor(`window.__designController.state.shapes.length === 7`, 'the mitered corner: 7 lines');
    assert.deepStrictEqual(await params(), [['horizontal_length', '300 mm'], ['vertical_length', '200 mm'], ['thickness', '18 mm']], 'the corner parameters');
    await press('#btn-recenter-view'); await sleep(700);
    await shot('corner-mitered-canvas.png', '#design-canvas');

    // the same picker on SketchStudio's LIGHT theme (the glyph colours are the theme's tokens)
    await navigate(`http://127.0.0.1:${port}/apps/sketchstudio/index.html`, 10000);
    await waitFor(`!!document.querySelector('.sk-sidebar-btn, .sk-sidebar-chevron')`, 'SketchStudio to load'); await sleep(600);
    await startOf('right-angle-corner');
    await press(cornerSel('joint', 'H-Through'));
    assert.strictEqual((await cornerChoices('joint')).length, 3, 'SketchStudio: the picker expands');
    await sleep(200); await shot('corner-picker-expanded-light.png', '.sk-tp-corners .sk-tp-corner[data-param="joint"]', { pad: 6, scale: 3 });
    await key('Escape', 'Escape', 27); await sleep(200);
    assert.strictEqual(await evalJs(`!!document.querySelector('.sk-tp-card') && !document.querySelector('.sk-tp-start')`), true, 'Esc: back to the cards');
    await key('Escape', 'Escape', 27); await sleep(200);
    assert.strictEqual(await evalJs(`!document.querySelector('.sk-tp-panel')`), true, 'Esc again closes the modal');

    // ================================================================== D. phone, real touch
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenOrientation: { type: 'portraitPrimary', angle: 0 } });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    pointer = touch;
    await openShaper();
    await startOf('box-frame');
    const box = await rectOf('.sk-tp-panel');
    assert.ok(box.x >= 0 && box.x + box.width <= 390 && box.y >= 0 && box.y + box.height <= 844, 'phone: the start view fits the screen ' + JSON.stringify(box));
    assert.strictEqual(await evalJs(`document.documentElement.scrollWidth <= 390`), true, 'phone: no sideways scroll');
    const fits = await evalJs(`[...document.querySelectorAll('.sk-tp-start input, .sk-tp-start button:not([hidden])')].every((e) => { const r = e.getBoundingClientRect(); return r.left >= 0 && r.right <= 390; })`);
    assert.strictEqual(fits, true, 'phone: every box and button inside the screen');
    const tgt = await evalJs(`[...document.querySelectorAll('.sk-tp-open, .sk-tp-cancel, .sk-tp-choice button:not([hidden])')].map((e) => Math.round(e.getBoundingClientRect().height))`);
    assert.ok(tgt.every((h) => h >= 44), 'phone: Open, Cancel and the glyphs are 44 px tall ' + JSON.stringify(tgt));
    await sleep(300); await shot('start-view-box-frame-phone.png');
    await press('.sk-tp-open'); await waitFor(`!document.querySelector('.sk-tp-panel')`, 'phone: a tap on Open opens it'); await dontSave();
    await waitFor(`window.__designController.state.parameters.length === 3`, 'phone: the box frame with its parameters');
    console.log('template-start-670-live: ok');
  } finally { await cdp.close(); }
})();
