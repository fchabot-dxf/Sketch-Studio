// tests/fav-star-overlap-700-live.test.js -- TASK 700: live CDP test. On EVERY template card, desktop 1280x800 and phone 390x844 touch, the favourite star
// (44 px target) covers NO preview label (every <text> of the card's preview svg) and the star still toggles. EVIDENCE_DIR: cropped screenshots.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';
import { resetBufferLive } from './helpers/reset-buffer.js';

await (async () => {
  const cdp = await launchBrowser({ tag: '700', width: 1280, height: 800 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, waitFor, navigate } = cdp;
  const url = `http://127.0.0.1:${port}/apps/sketchstudio/index.html`;
  const shot = async (name, sel) => {
    if (!process.env.EVIDENCE_DIR) return;
    const r = await evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.scrollIntoView({ block: 'center' }); const b = e.getBoundingClientRect(); return { x: b.left, y: b.top, width: b.width, height: b.height }; })()`);
    const s = await send('Page.captureScreenshot', { format: 'png', clip: { ...r, scale: 2 } });
    fs.writeFileSync(path.join(process.env.EVIDENCE_DIR, name), Buffer.from(s.data, 'base64'));
  };
  // for every card: the star rect and every preview label rect; the cards where they overlap
  const measure = () => evalJs(`(() => {
    const out = { cards: 0, overlaps: [], stars: [] };
    for (const item of document.querySelectorAll('.sk-tp-item')) {
      const id = item.dataset.template, s = item.querySelector('.sk-tp-star').getBoundingClientRect();
      out.cards++;
      out.stars.push({ id, w: s.width, h: s.height });
      for (const t of item.querySelectorAll('.sk-tp-prev text')) {
        const r = t.getBoundingClientRect();
        if (r.left < s.right && r.right > s.left && r.top < s.bottom && r.bottom > s.top) out.overlaps.push({ id, label: t.textContent, star: [s.left, s.top, s.right, s.bottom].map(Math.round), text: [r.left, r.top, r.right, r.bottom].map(Math.round) });
      }
    }
    return out;
  })()`);
  const T = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i, radiusX: 1, radiusY: 1, force: 1 })) });
  const checkViewport = async (label, touch) => {
    await navigate(url, 10000);
    await resetBufferLive(cdp);
    await navigate(url, 10000);
    await waitFor(`!!document.querySelector('.sk-doctabs')`, 'tab strip');
    await evalJs(`document.querySelector('.sk-doctab-new') ? (document.querySelector('.sk-doctab-new').click(), true) : false`).then(async (ok) => {
      if (!ok) { await evalJs(`[...document.querySelectorAll('.sk-sidebar-btn, .sk-sidebar-handle')].find((x) => x.getClientRects().length > 0).click()`); await sleep(300); await evalJs(`document.querySelector('[data-action="templates"]').click()`); }
    });
    await waitFor(`!!document.querySelector('.sk-tp-grid[data-previews="ready"]')`, label + ' previews ready', 15000);
    const m = await measure();
    console.log(label, 'cards', m.cards, 'overlaps', JSON.stringify(m.overlaps));
    assert(m.cards > 0, label + ': cards found');
    for (const s of m.stars) assert(s.w >= 44 && s.h >= 44, `${label}: star of ${s.id} is ${s.w}x${s.h}, needs 44`);
    assert.deepStrictEqual(m.overlaps, [], `${label}: a star covers a preview label`);
    // the star still toggles
    const id = await evalJs(`document.querySelector('.sk-tp-item').dataset.template`);
    const sel = `.sk-tp-star[data-template="${id}"]`;
    const c = await evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.scrollIntoView({ block: 'nearest' }); const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    if (touch) { await T('touchStart', [c]); await sleep(40); await T('touchEnd', []); }
    else { await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: c.x, y: c.y, button: 'left', buttons: 1, clickCount: 1 }); await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: c.x, y: c.y, button: 'left', buttons: 0, clickCount: 1 }); }
    await waitFor(`document.querySelector(${JSON.stringify(sel)}).getAttribute('aria-pressed') === 'true'`, label + ' star toggles on');
    await shot(`${label}-rounded-rectangle.png`, '.sk-tp-item[data-template="rounded-rectangle"]');
    await evalJs(`document.querySelector(${JSON.stringify(sel)}).click()`);
    await waitFor(`document.querySelector(${JSON.stringify(sel)}).getAttribute('aria-pressed') === 'false'`, label + ' star toggles off');
    console.log(label, 'ok');
  };
  try {
    await checkViewport('desktop', false);
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenOrientation: { type: 'portraitPrimary', angle: 0 } });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await checkViewport('phone', true);
    console.log('fav-star-overlap-700 live: ok');
  } finally {
    await cdp.close();
  }
})();
