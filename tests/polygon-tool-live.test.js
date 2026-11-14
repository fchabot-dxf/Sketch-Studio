// tests/polygon-tool-live.test.js — TASK 483 (live headless, REAL mouse): the regular Polygon tool is in the Create group of EVERY
// host that mounts the shared ribbon (SketchStudio, Shaper, Pen Plotter, Trace's Edit tab). TASK 596: the ribbon has NO Sides field; the
// number of sides is typed in the on-canvas box that shows after the centre click, and is remembered across a reload. Real clicks draw
// N plain lines + N construction radii, and ONE Undo click removes the whole polygon.

import assert from 'node:assert';
import { launchBrowser } from './helpers/cdp-browser.js';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await (async () => {
  const cdp = await launchBrowser({ tag: '483', width: 1600, height: 900 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, once, evalJs, waitFor, waitForApp } = cdp;
  try {
    const mouse = (type, x, y, buttons) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
    const click = async (x, y) => { await mouse('mouseMoved', x, y, 0); await sleep(30); await mouse('mousePressed', x, y, 1); await sleep(30); await mouse('mouseReleased', x, y, 0); await sleep(150); };
    const centerOf = (sel) => evalJs(`(() => { const e = document.querySelector('${sel}'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: r.width, h: r.height }; })()`);
    const clickEl = async (sel) => { const c = await centerOf(sel); assert(c, sel + ' not found'); await click(c.x, c.y); };
    const drag = async (pts) => {
      await mouse('mouseMoved', pts[0][0], pts[0][1], 0); await sleep(30); await mouse('mousePressed', pts[0][0], pts[0][1], 1);
      for (const p of pts.slice(1)) { await mouse('mouseMoved', p[0], p[1], 1); await sleep(20); }
      const l = pts[pts.length - 1]; await mouse('mouseReleased', l[0], l[1], 0); await sleep(300);
    };
    const key = async (k, code, vk, modifiers = 0) => {
      await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk, modifiers });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, modifiers }); await sleep(150);
    };
    const goto = async (url, canvasId, readyExpr) => { const loaded = once('Page.loadEventFired'); await send('Page.navigate', { url: `http://127.0.0.1:${port}${url}` }); await Promise.race([loaded, sleep(8000)]); await waitFor(readyExpr, 'the page to be ready'); if (canvasId) await waitForApp(canvasId); };
    const frame = () => send('Page.captureScreenshot', { format: 'png' });
    // TASK 596: the on-canvas boxes (size R, sides N) after the centre click; N is typed with real keys, the second click places the polygon
    const boxes = () => evalJs(`[...document.querySelectorAll('.sk-dual-input')].filter((b) => getComputedStyle(b).display !== 'none').map((b) => [...b.querySelectorAll('input')].map((i) => [i.placeholder, i.value]))`);
    const placePolygon = async (canvasSel, n, dx = 120, dy = 15) => {
      const c = await centerOf(canvasSel);
      await click(c.x, c.y);
      const shown = await boxes(); assert.strictEqual(shown.length, 1, 'one box shows after the centre click: ' + JSON.stringify(shown));
      if (n != null) { await key('Tab', 'Tab', 9); await send('Input.insertText', { text: String(n) }); await sleep(100); }
      await mouse('mouseMoved', c.x + 40, c.y + 5, 0); await sleep(30);
      await click(c.x + dx, c.y + dy);
      assert.deepStrictEqual(await boxes(), [], 'the boxes are gone once it is placed');
    };

    const HOSTS = {
      studio:     { url: '/apps/sketchstudio/index.html', enter: null,                                      canvas: '#svgCanvas',      state: null },
      shaper:     { url: '/apps/shaper/index.html',       enter: '.sk-header-tab[data-tab="design"]',       canvas: '#design-canvas',  state: 'window.__designController.state' },
      penplotter: { url: '/apps/penplotter/index.html',   enter: '.sk-header-tab[data-tab="design"]',       canvas: '#design-canvas',  state: 'window.__sketch.controller.state' },
      trace:      { url: '/apps/trace/index.html',        enter: '.sk-header-tab[data-tab="edit"]',         canvas: null,              state: null },
    };
    const open = async (name) => { const h = HOSTS[name]; await goto(h.url, h.enter ? null : (h.canvas && h.canvas.slice(1)), h.enter ? `!!document.querySelector('${h.enter}')` : `!!document.querySelector('${h.canvas}')`); if (h.enter) { await clickEl(h.enter); if (h.canvas) await waitForApp(h.canvas.slice(1)); await waitFor(h.canvas ? `document.querySelector('${h.canvas}').getBoundingClientRect().width > 0 && ${h.state ? '!!' + h.state : 'true'}` : `document.querySelector('${h.enter}').classList.contains('active')`, name + ' tab to show'); } return h; };

    // ---- 1. the tool is present in EVERY host that mounts the shared Design tab's ribbon (all four), beside Rect and Circle
    const present = {};
    for (const name of Object.keys(HOSTS)) {
      await open(name);
      present[name] = await evalJs(`(() => { const ids = ['tool-rect', 'tool-circle', 'tool-polygon']; const r = ids.map((i) => document.getElementById(i)); const create = r[2] && r[2].closest('.sk-ribbon-group'); return { all: r.every(Boolean), inCreate: !!create && /create/i.test(create.textContent) && !!create.querySelector('#tool-rect') && !!create.querySelector('#tool-circle'), visible: !!r[2] && r[2].getBoundingClientRect().width > 0, sides: !!document.getElementById('polygon-sides') || !!document.querySelector('.sk-ribbon-poly') }; })()`);
      assert(present[name].all && present[name].inCreate && present[name].visible && !present[name].sides, name + ' has the Polygon tool in the Create group and NO Sides field in the ribbon: ' + JSON.stringify(present[name]));
    }
    console.log('polygon tool present in:', Object.keys(present).join(', '));

    // ---- 2. nothing extra before the click; after it, R and N show on the canvas (default 6)
    await open('penplotter');
    await clickEl('#tool-polygon');
    assert.deepStrictEqual(await boxes(), [], 'before the centre click no box shows');
    const c2 = await centerOf(HOSTS.penplotter.canvas);
    await click(c2.x, c2.y);
    assert.deepStrictEqual(await boxes(), [[['R', '0.0'], ['N', '6']]], 'after the centre click: the size and the sides (default 6)');
    await key('Escape', 'Escape', 27);
    assert.deepStrictEqual(await boxes(), [], 'Esc closes them');

    // ---- 3. a REAL-mouse octagon in the Pen Plotter: 8 plain lines + 8 construction radii, closed; ONE Undo removes it all
    const pp = HOSTS.penplotter;
    const stateOf = (h) => `(${h.state})`;
    const summary = (h) => evalJs(`(() => { const s = ${stateOf(h)}; return JSON.stringify({ shapes: s.shapes.length, lines: s.shapes.filter(x => x.type === 'line').length, sides: s.shapes.filter(x => !x.isConstruction).length, radii: s.shapes.filter(x => x.isConstruction).length, constraints: s.constraints.length, joints: s.joints.size }); })()`).then(JSON.parse);
    await clickEl('#tool-polygon');
    const cv = await centerOf(pp.canvas);
    const before = await summary(pp);
    await placePolygon(pp.canvas, 8);
    const octo = await summary(pp);
    console.log('Pen Plotter octagon:', JSON.stringify(octo));
    assert.strictEqual(octo.sides, 8, '8 sides'); assert.strictEqual(octo.radii, 8, '8 construction radii'); assert.strictEqual(octo.lines, 16, 'plain lines only');
    assert.strictEqual(octo.constraints, 14, '2(N-1) equal constraints'); assert.strictEqual(octo.joints, before.joints + 9, 'centre + 8 corners');
    const regular = await evalJs(`(() => { const s = ${stateOf(pp)}; const d = (sh) => { const a = s.joints.get(sh.joints[0]), b = s.joints.get(sh.joints[1]); return Math.hypot(a.x - b.x, a.y - b.y); }; const L = s.shapes.filter(x => !x.isConstruction).map(d); return Math.max(...L) - Math.min(...L); })()`);
    assert(regular < 1e-6, 'equal sides within 1e-6 after the live solve: ' + regular);
    await clickEl('#btn-undo');
    const undone = await summary(pp);
    assert.deepStrictEqual(undone, before, 'ONE click on Undo removes the whole polygon: ' + JSON.stringify(undone));

    // ---- 4. a hexagon in Shaper and in Studio (sides back to 6), real mouse; Undo once
    // the 8 typed above is remembered across a reload (localStorage): the next polygon starts with it
    await goto(HOSTS.penplotter.url, null, `!!document.querySelector('.sk-header-tab[data-tab="design"]')`);
    await open('penplotter'); await clickEl('#tool-polygon'); await clickEl(pp.canvas);
    assert.deepStrictEqual(await boxes(), [[['R', '0.0'], ['N', '8']]], 'remembered across a reload');
    await key('Escape', 'Escape', 27);
    for (const name of ['shaper']) {
      const h = await open(name);
      const c0 = await summary(h);
      await clickEl('#tool-polygon');
      await placePolygon(h.canvas, 6);
      const hex = await summary(h);
      // (a delta: the design is carried across apps, so Shaper may open with what the plotter autosaved)
      assert.strictEqual(hex.sides - c0.sides, 6, name + ': a hexagon'); assert.strictEqual(hex.lines - c0.lines, 12);
      await clickEl('#btn-undo');
      assert.deepStrictEqual(await summary(h), c0, name + ': one Undo removes it');
    }
    // Studio keeps no global state handle: count the drawn shape elements, and use the real Undo button
    await open('studio');
    await clickEl('#tool-polygon');
    const shapeCount = () => evalJs(`document.querySelectorAll('.shape-elem').length`);
    const s0 = await shapeCount();
    await placePolygon('#svgCanvas', 6);
    const s1 = await shapeCount();
    assert(s1 - s0 >= 6, 'Studio: the hexagon is drawn (shape elements ' + s0 + ' -> ' + s1 + ')');
    await frame();
    await clickEl('#btn-undo'); await sleep(400);
    assert.strictEqual(await shapeCount(), s0, 'Studio: ONE Undo removes the whole polygon');
    console.log('penplotter-live polygon: ok');
  } finally {
    await cdp.close();
  }
})();
