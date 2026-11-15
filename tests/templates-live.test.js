// tests/templates-live.test.js -- TASK 651 (owner rulings): the bank of template drawings in the REAL pages, real mouse and real touch.
// ONE modal opened from three places (the sidebar's Templates..., the "+" tab button, the menu's New design): every template as a card with a
// non-empty SVG preview; a card opens a detail view whose "Open as new design" makes a new unsaved tab named after the template; the "Blank design"
// card (first, focused) makes the empty Untitled; Esc / a press outside / the X make no new design; Undo does not remove the starting drawing.
// Phone: full-screen, two cards per row. EVIDENCE_DIR: cropped screenshots.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sendRealKey, sleep } from './helpers/cdp-browser.js';
import { resetBufferLive } from './helpers/reset-buffer.js';
import { TEMPLATES } from '#core/templates.js';

await (async () => {
  const cdp = await launchBrowser({ tag: '651', width: 1400, height: 800 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, waitFor, navigate } = cdp;
  const shot = async (name, sel) => {
    if (!process.env.EVIDENCE_DIR) return;
    const r = await evalJs(`(() => { const e = document.querySelector('${sel}'); const b = e.getBoundingClientRect(); return { x: b.left, y: b.top, width: b.width, height: b.height }; })()`);
    const s = await send('Page.captureScreenshot', { format: 'png', clip: { ...r, scale: 1 } });
    fs.writeFileSync(path.join(process.env.EVIDENCE_DIR, name), Buffer.from(s.data, 'base64'));
  };
  const url = (h) => `http://127.0.0.1:${port}/apps/${h}/index.html`;
  const center = async (sel, i = 0) => {
    const c = await evalJs(`(() => { const e = document.querySelectorAll('${sel}')[${i}]; if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) }; })()`);
    assert(c, sel + ' #' + i + ' not found'); return c;
  };
  const mouse = async (x, y) => {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', clickCount: 0 }); await sleep(30);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 }); await sleep(30);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 }); await sleep(300);
  };
  const T = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i, radiusX: 1, radiusY: 1, force: 1 })) });
  const touch = async (x, y) => { await T('touchStart', [{ x, y }]); await sleep(40); await T('touchEnd', []); await sleep(350); };
  let pointer = mouse;
  const press = async (sel, i = 0) => { await evalJs(`document.querySelectorAll('${sel}')[${i}].scrollIntoView({ block: 'nearest', inline: 'nearest' })`); await sleep(80); const c = await center(sel, i); await pointer(c.x, c.y); };
  const shapes = () => evalJs(`document.querySelectorAll('svg .shape-elem').length`);
  const tabNames = () => evalJs(`[...document.querySelectorAll('.sk-doctab-name')].map((e) => e.textContent)`);
  const modalOpen = () => evalJs(`!!document.querySelector('.sk-tp')`);
  const cards = () => evalJs(`[...document.querySelectorAll('.sk-tp-card')].map((c) => ({ id: c.dataset.template, name: c.querySelector('.sk-tp-name').textContent, desc: c.querySelector('.sk-tp-desc').textContent, kids: c.querySelectorAll('svg *').length, svgBox: (() => { const s = c.querySelector('svg'); if (!s) return null; const r = s.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; })() }))`);
  const openMenu = async () => { await press('.sk-sidebar-btn, .sk-sidebar-handle'); await sleep(300); };
  try {
    // ---- desktop, mouse ----
    await navigate(url('sketchstudio'), 10000);
    await resetBufferLive(cdp); // the profile is reused between runs: start from one Untitled tab
    await navigate(url('sketchstudio'), 10000);
    await waitFor(`!!document.querySelector('.sk-doctabs') && document.querySelectorAll('.sk-doctab-name').length === 1`, 'the strip');
    assert.deepStrictEqual(await tabNames(), ['Untitled']);

    // 1. the sidebar's Templates...: every card, a non-empty preview, name and description, no Blank card
    await openMenu();
    await press('[data-action="templates"]');
    await waitFor(`!!document.querySelector('.sk-tp-card')`, 'the template modal');
    let cs = await cards();
    assert.deepStrictEqual(cs.map((c) => c.id), TEMPLATES.map((t) => t.id), 'every template of the bank is a card, Templates... has no Blank card');
    for (const c of cs) { assert(c.kids > 3 && c.svgBox[0] > 150 && c.svgBox[1] > 100, `${c.id}: a large preview drawn as SVG (${c.kids} elements, ${c.svgBox})`); assert(c.name && c.desc, c.id + ': name and one-line description'); }
    assert.strictEqual(await evalJs(`document.activeElement.dataset.template`), TEMPLATES[0].id, 'Templates...: the first card has focus');
    await shot('desktop-modal.png', '.sk-tp');
    // 2. Esc closes: no new design
    await sendRealKey(send, 'Escape', 'Escape', 27); await sleep(300);
    assert.strictEqual(await modalOpen(), false, 'Esc closes the modal');
    assert.deepStrictEqual(await tabNames(), ['Untitled'], 'Esc: no new design');
    // 3. a card -> the detail view (bigger preview) -> Open as new design: a new tab named after the template, with its drawing, unsaved
    await openMenu(); await press('[data-action="templates"]'); await waitFor(`!!document.querySelector('.sk-tp-card')`, 'modal');
    const small = (await cards())[0].svgBox;
    await press('.sk-tp-card[data-template="slot"]');
    await waitFor(`!!document.querySelector('.sk-tp-detail')`, 'the detail view');
    const big = await evalJs(`(() => { const r = document.querySelector('.sk-tp-detail svg').getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; })()`);
    assert(big[0] > small[0] && big[1] > small[1], `the detail preview is bigger than the card's (${big} vs ${small})`);
    assert.strictEqual(await evalJs(`document.querySelectorAll('.sk-tp-detail [data-action="open-template"]').length`), 1, 'one primary button: Open as new design');
    assert.strictEqual(await evalJs(`document.querySelector('.sk-tp-detail [data-action="open-template"]').textContent`), 'Open as new design');
    assert.strictEqual(await evalJs(`/insert/i.test(document.querySelector('.sk-tp').innerText)`), false, 'no Insert into sketch anywhere');
    await shot('desktop-detail.png', '.sk-tp');
    await press('[data-action="open-template"]');
    await waitFor(`document.querySelectorAll('.sk-doctab-name').length === 2`, 'a new tab');
    assert.strictEqual(await modalOpen(), false, 'the modal closed');
    assert.deepStrictEqual(await tabNames(), ['Untitled', 'Slot'], 'the new tab is named after the template');
    assert.strictEqual(await evalJs(`document.querySelector('.sk-doctab.active .sk-doctab-name').textContent`), 'Slot');
    await waitFor(`document.querySelectorAll('svg .shape-elem').length >= 4`, 'the slot drawn');
    const slotShapes = await shapes();
    assert.strictEqual(slotShapes, 4, 'the slot: two lines and two arcs');
    assert.strictEqual(await evalJs(`!!document.querySelector('.sk-doctab.active .sk-doctab-dot')`), true, 'the template design is unsaved (the not-saved dot)');
    await sleep(1200); await shot('opened-slot.png', 'body');
    // Undo does not remove the starting drawing (it is the document it began as, not an edit)
    await sendRealKey(send, 'z', 'KeyZ', 90, 2); await sleep(300);
    assert.strictEqual(await shapes(), slotShapes, 'Undo on a fresh template design leaves it');

    // 4. "+": the modal with Blank first and focused; Enter = the empty Untitled tab
    await press('.sk-doctab-new');
    await waitFor(`!!document.querySelector('.sk-tp-card')`, 'modal from +');
    cs = await cards();
    assert.deepStrictEqual(cs.map((c) => c.id), ['blank', ...TEMPLATES.map((t) => t.id)], '"+": Blank design first, then every template');
    assert.strictEqual(await evalJs(`document.activeElement.dataset.template`), 'blank', 'the Blank card has focus');
    await shot('desktop-new-design-modal.png', '.sk-tp');
    await sendRealKey(send, 'Enter', 'Enter', 13, 0, String.fromCharCode(13)); await sleep(500);
    assert.deepStrictEqual(await tabNames(), ['Untitled', 'Slot', 'Untitled'], 'Enter on Blank: the empty Untitled tab');
    assert.strictEqual(await shapes(), 0, 'it is empty');
    // "+" -> a press outside closes it (no new design)
    await press('.sk-doctab-new'); await waitFor(`!!document.querySelector('.sk-tp-card')`, 'modal');
    await pointer(8, 400); await sleep(300);
    assert.strictEqual(await modalOpen(), false, 'a press outside closes it');
    assert.strictEqual((await tabNames()).length, 3, 'outside press: no new design');
    // "+" -> the X
    await press('.sk-doctab-new'); await waitFor(`!!document.querySelector('.sk-tp-card')`, 'modal');
    await press('.sk-tp-x'); await sleep(300);
    assert.strictEqual(await modalOpen(), false, 'the X closes it');
    assert.strictEqual((await tabNames()).length, 3, 'X: no new design');
    // "+" -> a template -> a new tab holding it
    await press('.sk-doctab-new'); await waitFor(`!!document.querySelector('.sk-tp-card')`, 'modal');
    await press('.sk-tp-card[data-template="bolt-circle"]'); await waitFor(`!!document.querySelector('.sk-tp-detail')`, 'detail');
    await press('[data-action="open-template"]'); await waitFor(`document.querySelectorAll('.sk-doctab-name').length === 4`, 'the tab');
    assert.deepStrictEqual(await tabNames(), ['Untitled', 'Slot', 'Untitled', 'Bolt circle']);
    await waitFor(`document.querySelectorAll('svg .shape-elem').length >= 8`, 'the bolt circle drawn');
    // the menu's New design: the same modal, Blank first
    await openMenu(); await press('[data-action="new-design"]'); await waitFor(`!!document.querySelector('.sk-tp-card')`, 'modal from New design');
    assert.strictEqual((await cards())[0].id, 'blank', 'New design: Blank first');
    await sendRealKey(send, 'Escape', 'Escape', 27); await sleep(300);
    assert.strictEqual((await tabNames()).length, 4, 'Esc: no new design');

    // ---- the other three hosts: the same item, the same modal ----
    for (const host of ['shaper', 'penplotter', 'trace']) {
      await navigate(url(host), 10000);
      await waitFor(`!!document.querySelector('.sk-sidebar-btn, .sk-sidebar-handle')`, host + ': menu');
      await sleep(600);
      await openMenu(); await press('[data-action="templates"]');
      await waitFor(`!!document.querySelector('.sk-tp-card')`, host + ': the modal');
      cs = await cards();
      assert.strictEqual(cs.length, TEMPLATES.length, host + ': every template');
      assert(cs.every((c) => c.kids > 3), host + ': every preview is drawn');
      await sendRealKey(send, 'Escape', 'Escape', 27); await sleep(300);
    }

    // ---- phone, real touch ----
    await resetBufferLive(cdp);
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenOrientation: { type: 'portraitPrimary', angle: 0 } });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    pointer = touch;
    await navigate(url('sketchstudio'), 10000);
    await waitFor(`document.querySelectorAll('.sk-doctab-name').length === 1 && !!document.querySelector('.sk-doctab-new')`, 'phone: the strip');
    await press('.sk-doctab-new'); await waitFor(`!!document.querySelector('.sk-tp-card')`, 'phone: modal');
    const box = await evalJs(`(() => { const r = document.querySelector('.sk-tp').getBoundingClientRect(); const c = [...document.querySelectorAll('.sk-tp-card')].map((e) => Math.round(e.getBoundingClientRect().top)); return { w: r.width, h: r.height, perRow: c.filter((t) => t === c[0]).length }; })()`);
    assert(box.w === 390 && box.h === 844, 'phone: the modal is full-screen ' + JSON.stringify(box));
    assert.strictEqual(box.perRow, 2, 'phone: two cards per row');
    await shot('phone-modal.png', '.sk-tp');
    await press('.sk-tp-card[data-template="l-bracket"]'); await waitFor(`!!document.querySelector('.sk-tp-detail')`, 'phone: detail');
    await shot('phone-detail.png', '.sk-tp');
    await press('[data-action="open-template"]');
    await waitFor(`document.querySelectorAll('.sk-doctab-name').length === 2`, 'phone: a new tab');
    assert.deepStrictEqual(await tabNames(), ['Untitled', 'L-bracket']);
    await waitFor(`document.querySelectorAll('svg .shape-elem').length >= 8`, 'phone: the bracket drawn');
    await shot('phone-opened.png', 'body');
    console.log('templates-live: ok');
  } finally { await cdp.close(); }
})();
