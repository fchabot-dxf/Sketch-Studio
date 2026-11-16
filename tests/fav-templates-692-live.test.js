// tests/fav-templates-692-live.test.js -- TASK 692: live CDP browser test (desktop mouse + keyboard + 390px phone touch + cross-app sharing).
// Stars 2 templates -> moves right under Blank in starred order without opening a design or rebuilding previews -> reopen modal -> still there ->
// unstar one -> returns to bank place -> keyboard Tab + Space toggles & keeps focus on pressed star -> persists across all 4 apps.
// Phone 390x844 touch: >= 44px touch target, tap stars without opening a design, reorders live. EVIDENCE_DIR: cropped screenshots.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sendRealKey, sleep } from './helpers/cdp-browser.js';
import { resetBufferLive } from './helpers/reset-buffer.js';
import { TEMPLATES } from '#core/templates.js';

await (async () => {
  const cdp = await launchBrowser({ tag: '692', width: 1400, height: 900 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, waitFor, navigate } = cdp;
  const shot = async (name, sel) => {
    if (!process.env.EVIDENCE_DIR) return;
    const r = await evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); const b = e.getBoundingClientRect(); return { x: b.left, y: b.top, width: b.width, height: b.height }; })()`);
    const s = await send('Page.captureScreenshot', { format: 'png', clip: { ...r, scale: 1 } });
    fs.writeFileSync(path.join(process.env.EVIDENCE_DIR, name), Buffer.from(s.data, 'base64'));
  };
  const url = (h) => `http://127.0.0.1:${port}/apps/${h}/index.html`;
  const center = async (sel) => {
    const c = await evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({ block: 'nearest', inline: 'nearest' }); const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: r.width, h: r.height }; })()`);
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
  const press = async (sel) => { const c = await center(sel); await pointer(c.x, c.y); return c; };
  const openMenu = async () => {
    const c = await evalJs(`(() => { const e = [...document.querySelectorAll('.sk-sidebar-btn, .sk-sidebar-handle')].find((x) => x.getClientRects().length > 0); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    assert(c, 'menu trigger not found'); await pointer(c.x, c.y); await waitFor(`document.querySelector('.sk-sidebar').classList.contains('open')`, 'sidebar open');
  };
  const openTemplatesModal = async () => {
    await press('.sk-doctab-new').catch(async () => { await openMenu(); await press('[data-action="templates"]'); });
    await waitFor(`!!document.querySelector('.sk-tp-card')`, 'modal open');
    await waitFor(`!!document.querySelector('.sk-tp-grid[data-previews="ready"]')`, 'modal previews ready', 12000);
  };
  const cardOrder = () => evalJs(`[...document.querySelectorAll('.sk-tp-card')].map((c) => c.dataset.template)`);
  const bankIds = TEMPLATES.map((t) => t.id);

  try {
    // ---- 1. Desktop mouse: SketchStudio ----
    await navigate(url('sketchstudio'), 10000);
    await resetBufferLive(cdp);
    await navigate(url('sketchstudio'), 10000);
    await waitFor(`!!document.querySelector('.sk-doctabs') && document.querySelectorAll('.sk-doctab-name').length === 1`, 'tab strip ready');

    await press('.sk-doctab-new');
    await waitFor(`!!document.querySelector('.sk-tp-card')`, 'desktop modal open');
    await waitFor(`!!document.querySelector('.sk-tp-grid[data-previews="ready"]')`, 'desktop modal ready', 12000);
    assert.strictEqual(await evalJs(`!!document.querySelector('.sk-tp-fav-head')`), false, 'desktop: no heading ever');
    assert.strictEqual(await evalJs(`document.activeElement.dataset.template`), 'blank', 'Blank has initial focus');

    // Mark an SVG node on `hexagon` to verify re-ordering does not rebuild previews
    await evalJs(`document.querySelector('.sk-tp-card[data-template="hexagon"] .sk-tp-prev svg').dataset.marker692 = 'kept'`);

    // Star `star`, then `hexagon` with real mouse pointer
    await press('.sk-tp-star[data-template="star"]');
    assert.strictEqual(await evalJs(`!!document.querySelector('.sk-tp-start')`), false, 'desktop mouse star does not open start view');
    assert.strictEqual(await evalJs(`document.querySelectorAll('.sk-doctab').length`), 1, 'desktop mouse star does not add tab');
    assert.strictEqual(await evalJs(`!!document.querySelector('.sk-tp-fav-head, .sk-tp-fav-sep')`), false, 'task 721: no Favourites heading or divider when starred');
    assert.deepStrictEqual(
      await cardOrder(),
      ['blank', 'star', ...bankIds.filter((id) => id !== 'star')],
      'first favourite moves under Blank right away',
    );

    await press('.sk-tp-star[data-template="hexagon"]');
    assert.deepStrictEqual(
      await cardOrder(),
      ['blank', 'star', 'hexagon', ...bankIds.filter((id) => id !== 'star' && id !== 'hexagon')],
      'second favourite moves right after first in starred order',
    );
    assert.strictEqual(
      await evalJs(`document.querySelector('.sk-tp-card[data-template="hexagon"] .sk-tp-prev svg').dataset.marker692`),
      'kept',
      'desktop: preview SVG node was moved, not rebuilt',
    );
    assert.strictEqual(
      await evalJs(`getComputedStyle(document.querySelector('.sk-tp-star[data-template="star"] path')).fill !== 'none'`),
      true,
      'starred icon is filled',
    );
    assert.strictEqual(
      await evalJs(`getComputedStyle(document.querySelector('.sk-tp-star[data-template="slot"] path')).fill === 'none'`),
      true,
      'unstarred icon is outline only',
    );
    await shot('desktop-2-favourites.png', '.sk-tp-panel');

    // Close and reopen modal -> favourites persist
    await sendRealKey(send, 'Escape', 'Escape', 27); await sleep(250);
    assert.strictEqual(await evalJs(`!!document.querySelector('.sk-tp-panel')`), false, 'Esc closes modal');
    assert.strictEqual(await evalJs(`document.querySelectorAll('.sk-doctab').length`), 1, 'tab count still 1');

    await press('.sk-doctab-new');
    await waitFor(`!!document.querySelector('.sk-tp-card')`, 'reopen modal open');
    await waitFor(`!!document.querySelector('.sk-tp-grid[data-previews="ready"]')`, 'reopen modal ready', 12000);
    assert.deepStrictEqual(
      await cardOrder(),
      ['blank', 'star', 'hexagon', ...bankIds.filter((id) => id !== 'star' && id !== 'hexagon')],
      'reopened modal remembers starred order',
    );

    // Un-star `star` -> returns to bank place
    await press('.sk-tp-star[data-template="star"]');
    assert.deepStrictEqual(
      await cardOrder(),
      ['blank', 'hexagon', ...bankIds.filter((id) => id !== 'hexagon')],
      'un-starring returns card to bank place',
    );

    // Keyboard: Tab from Blank -> hexagon card (Enter/focus), Tab -> hexagon star -> Space toggles off -> Space toggles back on, focus stays on star!
    await evalJs(`document.querySelector('.sk-tp-card[data-template="blank"]').focus()`);
    await sendRealKey(send, 'Tab', 'Tab', 9); await sleep(80);
    assert.strictEqual(await evalJs(`document.activeElement.className + '|' + document.activeElement.dataset.template`), 'sk-tp-card|hexagon');
    await sendRealKey(send, 'Tab', 'Tab', 9); await sleep(80);
    assert.strictEqual(await evalJs(`document.activeElement.className + '|' + document.activeElement.dataset.template`), 'sk-tp-star|hexagon');
    await sendRealKey(send, ' ', 'Space', 32, 0, ' '); await sleep(200);
    assert.strictEqual(
      await evalJs(`document.activeElement.className + '|' + document.activeElement.dataset.template + '|' + document.activeElement.getAttribute('aria-pressed')`),
      'sk-tp-star|hexagon|false',
      'Space un-stars hexagon and keeps focus on the hexagon star button',
    );
    assert.deepStrictEqual(await cardOrder(), ['blank', ...bankIds], '0 favourites restores exact bank order');
    assert.strictEqual(await evalJs(`!!document.querySelector('.sk-tp-fav-head')`), false, 'no heading at 0 favourites');

    // Press Enter on the focused star -> re-stars hexagon cleanly, keeps focus, does NOT open the card
    await sendRealKey(send, 'Enter', 'Enter', 13, 0, '\r'); await sleep(200);
    assert.strictEqual(await evalJs(`!!document.querySelector('.sk-tp-start')`), false, 'Enter on star does not open start view');
    assert.strictEqual(
      await evalJs(`document.activeElement.className + '|' + document.activeElement.dataset.template + '|' + document.activeElement.getAttribute('aria-pressed')`),
      'sk-tp-star|hexagon|true',
      'Enter re-stars hexagon and keeps focus',
    );

    // Also re-star `keyhole` so [hexagon, keyhole] are shared across the other 3 hosts
    await press('.sk-tp-star[data-template="keyhole"]');
    await sendRealKey(send, 'Escape', 'Escape', 27); await sleep(250);

    // ---- 2. Cross-app sharing across Shaper, Pen Plotter, Trace ----
    for (const host of ['shaper', 'penplotter', 'trace']) {
      await resetBufferLive(cdp);
      await navigate(url(host), 10000);
      await waitFor(`!!document.querySelector('.sk-sidebar-btn, .sk-sidebar-handle')`, host + ': menu ready');
      await sleep(300);
      await openMenu(); await press('[data-action="templates"]');
      await waitFor(`!!document.querySelector('.sk-tp-card')`, host + ': modal open');
      await waitFor(`!!document.querySelector('.sk-tp-grid[data-previews="ready"]')`, host + ': template modal ready', 12000);
      assert.deepStrictEqual(
        await cardOrder(),
        ['blank', 'hexagon', 'keyhole', ...bankIds.filter((id) => id !== 'hexagon' && id !== 'keyhole')],
        `${host}: sees the exact same shared favourites in order`,
      );
      await sendRealKey(send, 'Escape', 'Escape', 27); await sleep(250);
    }

    // ---- 3. Phone 390x844 real touch ----
    await resetBufferLive(cdp);
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenOrientation: { type: 'portraitPrimary', angle: 0 } });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    pointer = touch;
    await navigate(url('sketchstudio'), 10000);
    await waitFor(`document.querySelectorAll('.sk-doctab-name').length === 1 && !!document.querySelector('.sk-doctab-new')`, 'phone: tab strip');
    await openTemplatesModal();

    const targetBox = await evalJs(`(() => { const r = document.querySelector('.sk-tp-star[data-template="slot"]').getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; })()`);
    assert(targetBox.w >= 44 && targetBox.h >= 44, `phone: star touch target must be >= 44px, got ${JSON.stringify(targetBox)}`);

    // Star `slot` with real touch -> becomes 3rd favourite `[hexagon, keyhole, slot]`; scroll modal to top for crisp phone shot with 2+ favs
    await press('.sk-tp-star[data-template="slot"]');
    assert.strictEqual(await evalJs(`!!document.querySelector('.sk-tp-start')`), false, 'phone touch star does not open start view');
    assert.strictEqual(await evalJs(`document.querySelectorAll('.sk-doctab').length`), 1, 'phone touch star does not open a tab');
    // Un-star `keyhole` so phone screenshot clearly shows 2 favourites (`hexagon`, `slot`) right after Blank
    await press('.sk-tp-star[data-template="keyhole"]');
    assert.deepStrictEqual(
      await cardOrder(),
      ['blank', 'hexagon', 'slot', ...bankIds.filter((id) => id !== 'hexagon' && id !== 'slot')],
      'phone: 2 favourites under Blank in starred order',
    );
    await evalJs(`document.querySelector('.sk-tp-body').scrollTop = 0`); await sleep(150);
    await shot('phone-2-favourites.png', '.sk-tp-panel');

    // Tapping a card itself still opens its start view on phone
    await press('.sk-tp-card[data-template="hexagon"]');
    await waitFor(`!!document.querySelector('.sk-tp-start[data-template="hexagon"]')`, 'phone: tapping card still opens start view');

    console.log('fav-templates-692-live: ok');
  } finally {
    await cdp.close();
  }
})();
