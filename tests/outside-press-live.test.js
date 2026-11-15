// tests/outside-press-live.test.js: TASK 640 (live headless, REAL mouse / touch):
// the phone drawer (Pen Plotter's #design-panel at 390 px) and the Style panel (SketchStudio) close on a press anywhere outside them,
// even on a DISABLED footer button (Clear sketch on an empty sketch never fires click), and stay open on a press inside.
import assert from 'node:assert';
import { launchBrowser } from './helpers/cdp-browser.js';
import { resetBufferLive } from './helpers/reset-buffer.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await (async () => {
  const cdp = await launchBrowser({ tag: '640-outside', width: 1440, height: 900 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, once, evalJs, waitFor } = cdp;
  try {
    const mouse = (type, x, y, buttons) => send('Input.dispatchMouseEvent', {
      type, x, y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1,
    });
    const click = async (x, y) => {
      await mouse('mouseMoved', x, y, 0); await sleep(30);
      await mouse('mousePressed', x, y, 1); await sleep(30);
      await mouse('mouseReleased', x, y, 0); await sleep(250);
    };
    const T = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i, radiusX: 1, radiusY: 1, force: 1 })) });
    const tap = async (x, y) => { await T('touchStart', [{ x, y }]); await sleep(40); await T('touchEnd', []); await sleep(300); };
    const centerOf = (sel) => evalJs(`(() => {
      const e = document.querySelector(${JSON.stringify(sel)});
      if (!e) return null;
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0 ? { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } : null;
    })()`);
    const goto = async (url, readyExpr) => {
      const loaded = once('Page.loadEventFired');
      await send('Page.navigate', { url: `http://127.0.0.1:${port}${url}` });
      await Promise.race([loaded, sleep(8000)]);
      await waitFor(readyExpr, url + ' ready');
      await sleep(600);
    };
    const press = async (touch, sel, what) => {
      const c = await centerOf(sel); assert(c, what + ': ' + sel + ' not visible');
      await (touch ? tap : click)(c.x, c.y);
    };
    const disabledAndHit = async (what, sel) => {
      const r = await evalJs(`(() => { const b = document.querySelector(${JSON.stringify(sel)}); if (!b) return null; const q = b.getBoundingClientRect(); const hit = document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2);       return { disabled: b.disabled, hit: !!hit && (hit === b || b.contains(hit)), over: hit ? hit.tagName + '.' + hit.className + ' in ' + (hit.parentElement ? hit.parentElement.tagName + '.' + hit.parentElement.className + '#' + hit.parentElement.id : '') : null }; })()`);
            assert(r, what + ': ' + sel + ' exists');
            assert(r.disabled, what + ': ' + sel + ' is disabled on the empty sketch');
            assert(r.hit, what + ': nothing covers ' + sel + ' (the press lands on it), covered by ' + r.over);
    };

    // ---- the phone drawer: Pen Plotter, 390 x 844 touch
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await resetBufferLive(cdp);
    await goto('/apps/penplotter/index.html', `!!document.querySelector('.sk-header-tab[data-tab="design"]')`);
    await evalJs(`document.querySelector('.sk-header-tab[data-tab="design"]').click()`); await sleep(700);
    await waitFor(`!!document.querySelector('.sk-drawer-toggle') && document.querySelector('.sk-drawer-toggle').getBoundingClientRect().width > 0`, 'drawer toggle');
    const drawerOpen = () => evalJs(`document.querySelector('#design-panel').classList.contains('sk-drawer-open')`);
    await press(true, '.sk-drawer-toggle', 'drawer'); // the opening press must not close it
    assert.strictEqual(await drawerOpen(), true, 'drawer: the toggle press opens it and it stays open');
    await press(true, '#design-panel', 'drawer');
    assert.strictEqual(await drawerOpen(), true, 'drawer: a press inside it leaves it open');
    await disabledAndHit('drawer', '#btn-undo'); // the open drawer covers Clear sketch at 390 px; Undo is the uncovered disabled footer button
    await press(true, '#btn-undo', 'drawer');
    assert.strictEqual(await drawerOpen(), false, 'drawer: a press on the disabled Undo closes it');
    console.log('outside-press: phone drawer closes on a disabled-button press, stays open inside');

    // ---- the Style panel: SketchStudio, desktop mouse
    await send('Emulation.setTouchEmulationEnabled', { enabled: false });
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await resetBufferLive(cdp);
    await goto('/apps/sketchstudio/index.html', `!!document.querySelector('#svgCanvas') && !!document.querySelector('.sk-sidebar-btn')`);
    const styleOpen = () => evalJs(`!!document.querySelector('.sk-style-panel') && !document.querySelector('.sk-style-panel').classList.contains('sk-hidden')`);
    await press(false, '.sk-sidebar-btn', 'style');
    const item = await evalJs(`(() => { const e = [...document.querySelectorAll('.sk-sidebar-item')].find((x) => /^\\s*Style\\s*$/.test(x.textContent) || x.getAttribute('aria-label') === 'Style'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    assert(item, 'style: the sidebar Style item exists');
    await click(item.x, item.y); await sleep(300);
    assert.strictEqual(await styleOpen(), true, 'style: the Style item opens the panel and it stays open');
    await press(false, '.sk-style-title', 'style');
    assert.strictEqual(await styleOpen(), true, 'style: a press inside it leaves it open');
    await disabledAndHit('style', '#btn-clear-sketch');
    await press(false, '#btn-clear-sketch', 'style');
    assert.strictEqual(await styleOpen(), false, 'style: a press on the disabled Clear sketch closes it');
    console.log('outside-press: Style panel closes on a disabled-button press, stays open inside');
  } finally {
    await cdp.close();
  }
})();

