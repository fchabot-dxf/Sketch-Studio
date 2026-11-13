// tests/design-browser-live.test.js — TASK 586: the SKETCHES browser FLOATS over the top-left of the canvas in all four hosts (SketchStudio, Shaper,
// Pen Plotter, Trace), one shared mount (#ui/design-browser.js). Real browser, real mouse / touch.
//  1440 px, per host: the box sits at the canvas's top-left (inside it, 0-16 px in), it is out of the layout (absolute: SketchStudio and Trace
//  have the canvas at full width again, no side panel), it shows the status line (constraints · DOF · free · solved), the row controls work (new sketch, radio, eye,
//  drag-reorder, right-click menu), a click inside the box does not reach the canvas (Line tool: no point is drawn), a click outside it does (a
//  line under where the old right-hand panel was).
//  Collapse: the box shrinks to its header; the state is the per-user setting BROWSER_COLLAPSED (SettingsManager, local), remembered across a
//  reload.
//  390 px touch: the same box is a drawer opened by the header button, with the same tree.
import assert from 'node:assert';
import { launchBrowser } from './helpers/cdp-browser.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await (async () => {
  const cdp = await launchBrowser({ tag: '586', width: 1440, height: 900 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, waitFor, navigate } = cdp;
  try {
    const mouse = (type, x, y, buttons = 0, button) => send('Input.dispatchMouseEvent', { type, x, y, button: button || ((buttons || type === 'mouseReleased') ? 'left' : 'none'), buttons, clickCount: (buttons || type === 'mouseReleased') ? 1 : 0 });
    const click = async (p) => { await mouse('mouseMoved', p.x, p.y); await sleep(60); await mouse('mousePressed', p.x, p.y, 1); await mouse('mouseReleased', p.x, p.y); await sleep(200); };
    const rectJs = (expr) => evalJs(`(() => { const e = ${expr}; if (!e) return null; const r = e.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    const rect = (sel) => rectJs(`document.querySelector(${JSON.stringify(sel)})`);
    const part = (i, sel) => rectJs(`document.querySelectorAll('.sk-browser .sk-sketch-node')[${i}].querySelector(${JSON.stringify(sel)})`);
    const nodeJs = (i, js) => evalJs(`(() => { const n = document.querySelectorAll('.sk-browser .sk-sketch-node')[${i}]; return ${js}; })()`);
    const names = () => evalJs(`[...document.querySelectorAll('.sk-browser .sk-sketch-node .sk-sketch-name')].map((n) => n.textContent)`);
    const points = (canvas) => evalJs(`document.querySelectorAll(${JSON.stringify(canvas + ' line, ' + canvas + ' path, ' + canvas + ' circle')}).length`); // what the canvas draws: a new line adds elements
    const settingStored = () => evalJs(`(() => { try { return JSON.parse(localStorage.getItem('sketch-studio-settings') || '{}').BROWSER_COLLAPSED; } catch (_) { return 'err'; } })()`);
    const hosts = [
      { name: 'sketchstudio', url: '/apps/sketchstudio/index.html', canvas: '#svgCanvas', full: true },
      { name: 'shaper', url: '/apps/shaper/index.html', canvas: '#design-canvas', enter: `document.querySelector('[data-mode="design"]').click()` },
      { name: 'penplotter', url: '/apps/penplotter/index.html', canvas: '#design-canvas', enter: `document.querySelector('.stage-btn[data-stage="design"]').click()` },
      { name: 'trace', url: '/apps/trace/index.html', canvas: '#design-canvas', enter: `document.querySelector('.tr-tab[data-tab="edit"]').click()`, full: true },
    ];
    const open = async (h) => {
      await navigate(`http://127.0.0.1:${port}${h.url}`, 8000);
      if (h.enter) { await sleep(800); await evalJs(h.enter); }
      await waitFor(`!!document.querySelector('.sk-browser .sk-sketch-node') && document.querySelector('.sk-browser').getClientRects().length > 0`, h.name + ' shows the browser');
      await sleep(500);
    };

    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    const treeAt1440 = {};
    for (const h of hosts) {
      await open(h);
      const box = await rect('.sk-browser'), cv = await rect(h.canvas);
      assert.strictEqual(await evalJs(`getComputedStyle(document.querySelector('.sk-browser')).position`), 'absolute', h.name + ': the box floats (absolute)');
      assert.strictEqual(await evalJs(`document.querySelectorAll('.sk-side, #design-panel-info').length`), 0, h.name + ': no side panel');
      assert(box.left - cv.left >= 0 && box.left - cv.left <= 16 && box.top - cv.top >= 0 && box.top - cv.top <= 16, `${h.name}: the box is at the canvas's top-left: box ${box.left},${box.top} canvas ${cv.left},${cv.top}`);
      assert(box.right < cv.left + 300 && box.bottom < cv.top + 300, h.name + ': the box is small, in the corner');
      if (h.full) assert(cv.right >= 1440 - 40, `${h.name}: the canvas is full width again (right edge ${cv.right} of 1440)`);
      assert.strictEqual(await evalJs(`/constraints? · DOF [0-9]+/.test(document.querySelector('.sk-browser .sk-info-dof').textContent)`), true, h.name + ': the status line (constraints · DOF) is in the box');
      assert.strictEqual(await evalJs(`document.querySelector('.sk-browser').textContent.includes('Sketch 1')`), true, h.name + ': Sketch 1 row');
      assert.strictEqual(await evalJs(`document.elementFromPoint(${box.x}, ${Math.round(box.top) + 12}).closest('.sk-browser') !== null`), true, h.name + ': the box is on top of the canvas at its own place');

      // a click INSIDE the box does not reach the canvas (Line tool armed: it would put a point on the canvas); one OUTSIDE does (a line where the old panel was)
      await evalJs(`document.getElementById('tool-line').click()`);
      const p0 = await points(h.canvas);
      const hdr = await rect('.sk-browser-title');
      await click({ x: hdr.x + 40, y: hdr.y }); await click({ x: hdr.x + 60, y: hdr.y });
      assert.strictEqual(await points(h.canvas), p0, h.name + ': clicks inside the box draw nothing on the canvas');
      await click({ x: Math.round(cv.right) - 140, y: Math.round(cv.top) + 200 }); await click({ x: Math.round(cv.right) - 60, y: Math.round(cv.top) + 260 });
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape' }); await sleep(250);
      const p1 = await points(h.canvas);
      assert(p1 > p0, `${h.name}: a line drawn at the canvas's right end (under where the old panel was) reaches the canvas (${p0} -> ${p1} drawn elements)`);
      await evalJs(`document.getElementById('tool-select').click()`);

      // rows: new sketch, radio, eye, drag-reorder, right-click menu
      await click(await rect('.sk-browser .sk-tree-add'));
      assert.deepStrictEqual(await names(), ['Sketch 1', 'Sketch 2'], h.name + ': + adds a sketch');
      assert.strictEqual(await nodeJs(1, `n.querySelector('.sk-sketch-head').classList.contains('is-active')`), true, h.name + ': the new sketch is active');
      await click(await part(0, '.sk-sketch-radio'));
      assert.strictEqual(await nodeJs(0, `n.querySelector('.sk-sketch-head').classList.contains('is-active')`), true, h.name + ': the radio activates Sketch 1');
      await click(await part(0, '.sk-sketch-eye'));
      assert.strictEqual(await nodeJs(0, `n.classList.contains('is-hidden')`), true, h.name + ': the eye hides the sketch');
      await click(await part(0, '.sk-sketch-eye'));
      assert.strictEqual(await nodeJs(0, `n.classList.contains('is-hidden')`), false, h.name + ': the eye shows it again');
      const n2 = await part(1, '.sk-sketch-name'), n1 = await part(0, '.sk-sketch-name');
      await mouse('mouseMoved', n2.x, n2.y); await sleep(60); await mouse('mousePressed', n2.x, n2.y, 1);
      for (let i = 1; i <= 8; i++) { await mouse('mouseMoved', n2.x, Math.round(n2.y + (n1.y - 6 - n2.y) * i / 8), 1); await sleep(30); }
      await mouse('mouseReleased', n2.x, n1.y - 6); await sleep(300);
      assert.deepStrictEqual(await names(), ['Sketch 2', 'Sketch 1'], h.name + ': a real drag of the name reorders');
      const nm = await part(0, '.sk-sketch-name');
      await mouse('mouseMoved', nm.x, nm.y); await sleep(100);
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: nm.x, y: nm.y, button: 'right', buttons: 2, clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: nm.x, y: nm.y, button: 'right', buttons: 0, clickCount: 1 }); await sleep(400);
      assert.deepStrictEqual(await evalJs(`[...document.querySelectorAll('.sk-context-menu:not(.sk-context-sub) .sk-context-item')].map(r => r.dataset.id)`), ['sk-lock', 'sk-only', 'sk-rename', 'sk-delete'], h.name + ': the right-click menu');
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape' }); await sleep(250);
      treeAt1440[h.name] = await evalJs(`document.querySelectorAll('.sk-browser .sk-sketch-node').length`);

      // collapse: the box shrinks to its header; the per-user setting is stored and remembered across a reload; expand is remembered too
      const full = (await rect('.sk-browser')).height;
      await click(await rect('.sk-browser-toggle'));
      const small = (await rect('.sk-browser')).height;
      assert(small < 40 && small < full / 2, `${h.name}: collapsed shrinks to its header (${full} -> ${small} px)`);
      assert.strictEqual(await settingStored(), true, h.name + ': BROWSER_COLLAPSED is stored true');
      await open(h);
      assert.strictEqual(await evalJs(`document.querySelector('.sk-browser').classList.contains('collapsed')`), true, h.name + ': still collapsed after a reload');
      assert((await rect('.sk-browser')).height < 40, h.name + ': and the box is a header bar after the reload');
      await click(await rect('.sk-browser-toggle'));
      assert.strictEqual(await settingStored(), false, h.name + ': BROWSER_COLLAPSED stored false after expand');
      await open(h);
      assert.strictEqual(await evalJs(`document.querySelector('.sk-browser').classList.contains('collapsed')`), false, h.name + ': still expanded after a reload');
      console.log(`design-browser ${h.name}: box ${Math.round(box.left)},${Math.round(box.top)} ${Math.round(box.width)}x${Math.round(box.height)} canvas ${Math.round(cv.left)}..${Math.round(cv.right)}; collapsed ${full} -> ${small} px`);
    }

    // phone: the same box is a drawer opened by the header button, the same tree
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    const T = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i, radiusX: 1, radiusY: 1, force: 1 })) });
    for (const h of hosts) {
      await navigate(`http://127.0.0.1:${port}${h.url}`, 8000);
      if (h.enter) { await sleep(800); await evalJs(h.enter); }
      await waitFor(`!!document.querySelector('.sk-browser .sk-sketch-node')`, h.name + ' (phone) has the tree'); await sleep(400);
      assert.strictEqual(await evalJs(`getComputedStyle(document.querySelector('.sk-browser')).position`), 'fixed', h.name + ' (phone): the box is the fixed drawer, not a floating card');
      const closed = await rect('.sk-browser');
      assert(closed.left >= 390, h.name + ' (phone): the drawer is off screen until opened: ' + JSON.stringify(closed));
      const tog = await rect('button.sk-drawer-toggle[title="Sketches"]');
      assert(tog && tog.x > 0 && tog.x < 390 && tog.y > 0 && tog.y < 844, h.name + ' (phone): the drawer button is on screen: ' + JSON.stringify(tog));
      await T('touchStart', [tog]); await sleep(40); await T('touchEnd', []); await sleep(500);
      const open1 = await rect('.sk-browser');
      assert(open1.left >= 0 && open1.right <= 390.5, h.name + ' (phone): the open drawer fits the screen: ' + JSON.stringify(open1));
      assert.strictEqual(await evalJs(`document.querySelector('.sk-browser').classList.contains('sk-drawer-open')`), true, h.name + ' (phone): open');
      assert.strictEqual(await evalJs(`document.querySelectorAll('.sk-browser .sk-sketch-node').length`), 1, h.name + ' (phone): the same tree (a fresh page: one sketch)');
      assert.strictEqual(await evalJs(`['.sk-tree-add', '.sk-sketch-eye', '.sk-sketch-icon', '.sk-sketch-name', '.sk-sketch-radio'].every((s) => document.querySelectorAll('.sk-browser ' + s).length === 1)`), true, h.name + ' (phone): the same row controls');
      assert.strictEqual(await evalJs(`document.documentElement.scrollWidth <= window.innerWidth + 1`), true, h.name + ' (phone): no page scroll');
    }
    console.log('design-browser-live: all passed');
  } finally { await cdp.close(); }
})();
