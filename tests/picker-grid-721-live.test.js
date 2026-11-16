// tests/picker-grid-721-live.test.js -- TASK 721: the New design picker is ONE continuous grid: Blank, then the favourites in starred order,
// then the other templates, side by side with no heading / divider / empty row. Desktop 1280x800 mouse + phone 390 touch (no horizontal scroll).
// EVIDENCE_DIR: cropped panel screenshots.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sendRealKey, sleep } from './helpers/cdp-browser.js';
import { resetBufferLive } from './helpers/reset-buffer.js';
import { TEMPLATES } from '#core/templates.js';

await (async () => {
  const cdp = await launchBrowser({ tag: '721', width: 1280, height: 800 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, waitFor, navigate } = cdp;
  const shot = async (name) => {
    if (!process.env.EVIDENCE_DIR) return;
    const r = await evalJs(`(() => { const b = document.querySelector('.sk-tp-panel').getBoundingClientRect(); return { x: b.left, y: b.top, width: b.width, height: b.height }; })()`);
    const s = await send('Page.captureScreenshot', { format: 'png', clip: { ...r, scale: 1 } });
    fs.writeFileSync(path.join(process.env.EVIDENCE_DIR, name), Buffer.from(s.data, 'base64'));
  };
  const url = `http://127.0.0.1:${port}/apps/sketchstudio/index.html`;
  const center = async (sel) => {
    const c = await evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({ block: 'nearest' }); const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    assert(c, sel + ' not found'); return c;
  };
  const mouse = async (x, y) => {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', clickCount: 0 }); await sleep(30);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 }); await sleep(30);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 }); await sleep(250);
  };
  const T = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i, radiusX: 1, radiusY: 1, force: 1 })) });
  const touch = async (x, y) => { await T('touchStart', [{ x, y }]); await sleep(40); await T('touchEnd', []); await sleep(300); };
  let pointer = mouse;
  const press = async (sel) => { const c = await center(sel); await pointer(c.x, c.y); };
  const openModal = async () => {
    await waitFor(`!!document.querySelector('.sk-doctabs') && document.querySelectorAll('.sk-doctab-name').length === 1 && !!document.querySelector('.sk-doctab-new')`, 'tab strip');
    await press('.sk-doctab-new');
    await waitFor(`!!document.querySelector('.sk-tp-grid[data-previews="ready"]')`, 'modal previews ready', 12000);
  };
  const bankIds = TEMPLATES.map((t) => t.id);
  // The grid as laid out: every grid child's id, top/left/bottom in DOM (= keyboard) order
  const layout = () => evalJs(`(() => {
    const g = document.querySelector('.sk-tp-grid');
    const items = [...g.children].map((n) => { const r = n.getBoundingClientRect(); const c = n.matches('.sk-tp-card') ? n : n.querySelector('.sk-tp-card'); return { id: c ? c.dataset.template : 'NOT-A-CARD:' + n.className, top: Math.round(r.top), left: Math.round(r.left), bottom: Math.round(r.bottom) }; });
    return { items, hscroll: document.documentElement.scrollWidth > document.documentElement.clientWidth };
  })()`);
  const check = (lay, favs, label) => {
    const ids = lay.items.map((i) => i.id);
    assert.deepStrictEqual(ids, ['blank', ...favs, ...bankIds.filter((id) => !favs.includes(id))], `${label}: Blank, favourites in starred order, then the rest (every child a card)`);
    const first = lay.items[0].top;
    for (let i = 0; i < Math.min(favs.length + 1, 2); i++) assert.strictEqual(lay.items[i].top, first, `${label}: item ${i} (${ids[i]}) is on the first row`);
    // no gap row: each row starts within 24px of the previous row's bottom
    const rows = [...new Set(lay.items.map((i) => i.top))].sort((a, b) => a - b);
    let prevBottom = Math.max(...lay.items.filter((i) => i.top === rows[0]).map((i) => i.bottom));
    for (const top of rows.slice(1)) {
      assert(top - prevBottom >= 0 && top - prevBottom <= 24, `${label}: gap above row at ${top} is ${top - prevBottom}px`);
      prevBottom = Math.max(...lay.items.filter((i) => i.top === top).map((i) => i.bottom));
    }
    // visual order (row, then column) equals DOM order = keyboard order
    const visual = [...lay.items].sort((a, b) => a.top - b.top || a.left - b.left).map((i) => i.id);
    assert.deepStrictEqual(visual, ids, `${label}: visual order equals DOM order`);
  };

  try {
    await navigate(url, 10000);
    await resetBufferLive(cdp);
    await navigate(url, 10000);
    await openModal();

    // ---- desktop 1280x800, 0 favourites ----
    check(await layout(), [], 'desktop 0 favourites');
    await shot('desktop-0-favourites.png');

    // ---- desktop, 4 favourites (starred order differs from bank order) ----
    const picks = ['star', 'hexagon', 'slot', 'keyhole'];
    for (const id of picks) await press(`.sk-tp-star[data-template="${id}"]`);
    const lay = await layout();
    check(lay, picks, 'desktop 4 favourites');
    assert(lay.items[1].left > lay.items[0].left, 'desktop: first favourite is beside Blank');
    assert.strictEqual(await evalJs(`document.querySelectorAll('.sk-tp-star[aria-pressed="true"]').length`), 4, 'four filled stars');
    assert.strictEqual(await evalJs(`!!document.querySelector('.sk-tp-fav-head, .sk-tp-fav-sep')`), false, 'no heading or divider');
    await evalJs(`document.querySelector('.sk-tp-body').scrollTop = 0`); await sleep(150);
    await shot('desktop-4-favourites.png');
    await sendRealKey(send, 'Escape', 'Escape', 27); await sleep(250);

    // ---- phone 390x844 touch, same 4 favourites (persisted) ----
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenOrientation: { type: 'portraitPrimary', angle: 0 } });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    pointer = touch;
    await navigate(url, 10000);
    await openModal();
    const pl = await layout();
    check(pl, picks, 'phone 4 favourites');
    assert.strictEqual(pl.hscroll, false, 'phone: no horizontal scroll');
    assert.strictEqual(await evalJs(`(() => { const b = document.querySelector('.sk-tp-body'); return b.scrollWidth <= b.clientWidth; })()`), true, 'phone: modal body has no horizontal scroll');
    await evalJs(`document.querySelector('.sk-tp-body').scrollTop = 0`); await sleep(150);
    await shot('phone-4-favourites.png');
    console.log('picker-grid-721-live: ok');
  } finally {
    await cdp.close();
  }
})();
