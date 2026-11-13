// tests/polygon-tool-live.test.js — TASK 483 (live headless, REAL mouse): the regular Polygon tool is in the Create group of EVERY
// host that mounts the shared ribbon (SketchStudio, Shaper, Pen Plotter, Trace's Edit tab), its Sides field clamps (3..64), shows
// the kept value and is remembered across a reload, a real drag draws N plain lines + N construction radii, and ONE Undo click
// removes the whole polygon.

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
    const typeInto = async (sel, text) => { await clickEl(sel); await key('a', 'KeyA', 65, 2); await send('Input.insertText', { text }); await key('Tab', 'Tab', 9); await sleep(150); };
    const goto = async (url, canvasId, readyExpr) => { const loaded = once('Page.loadEventFired'); await send('Page.navigate', { url: `http://127.0.0.1:${port}${url}` }); await Promise.race([loaded, sleep(8000)]); await waitFor(readyExpr, 'the page to be ready'); if (canvasId) await waitForApp(canvasId); };
    const frame = () => send('Page.captureScreenshot', { format: 'png' });
    const sides = () => evalJs(`document.getElementById('polygon-sides').value`);

    const HOSTS = {
      studio:     { url: '/apps/sketchstudio/index.html', enter: null,                                      canvas: '#svgCanvas',      state: null },
      shaper:     { url: '/apps/shaper/index.html',       enter: '.mode-btn[data-mode="design"]',           canvas: '#design-canvas',  state: 'window.__designController.state' },
      penplotter: { url: '/apps/penplotter/index.html',   enter: '.stage-btn[data-stage="design"]',         canvas: '#design-canvas',  state: 'window.__sketch.controller.state' },
      trace:      { url: '/apps/trace/index.html',        enter: '.tr-tab[data-tab="edit"]',                canvas: null,              state: null },
    };
    const open = async (name) => { const h = HOSTS[name]; await goto(h.url, h.enter ? null : (h.canvas && h.canvas.slice(1)), h.enter ? `!!document.querySelector('${h.enter}')` : `!!document.querySelector('${h.canvas}')`); if (h.enter) { await clickEl(h.enter); if (h.canvas) await waitForApp(h.canvas.slice(1)); await waitFor(h.canvas ? `document.querySelector('${h.canvas}').getBoundingClientRect().width > 0 && ${h.state ? '!!' + h.state : 'true'}` : `document.querySelector('${h.enter}').classList.contains('active')`, name + ' tab to show'); } return h; };

    // ---- 1. the tool is present in EVERY host that mounts the shared Design tab's ribbon (all four), beside Rect and Circle
    const present = {};
    for (const name of Object.keys(HOSTS)) {
      await open(name);
      present[name] = await evalJs(`(() => { const ids = ['tool-rect', 'tool-circle', 'tool-polygon']; const r = ids.map((i) => document.getElementById(i)); const create = r[2] && r[2].closest('.sk-ribbon-group'); return { all: r.every(Boolean), inCreate: !!create && /create/i.test(create.textContent) && !!create.querySelector('#tool-rect') && !!create.querySelector('#tool-circle'), visible: !!r[2] && r[2].getBoundingClientRect().width > 0, sides: !!document.getElementById('polygon-sides') }; })()`);
      assert(present[name].all && present[name].inCreate && present[name].visible && present[name].sides, name + ' has the Polygon tool + Sides field in the Create group: ' + JSON.stringify(present[name]));
    }
    console.log('polygon tool present in:', Object.keys(present).join(', '));

    // ---- 2. the Sides field: clamped, shows the kept value, remembered across a reload (and shared by the hosts: same origin)
    await open('penplotter');
    assert.strictEqual(await sides(), '6', 'the default is 6');
    for (const [typed, kept] of [['99', '64'], ['2', '3'], ['', '3'], ['8', '8']]) {
      if (typed === '') { await clickEl('#polygon-sides'); await key('a', 'KeyA', 65, 2); await key('Backspace', 'Backspace', 8); await key('Tab', 'Tab', 9); } else await typeInto('#polygon-sides', typed);
      assert.strictEqual(await sides(), kept, `typed ${JSON.stringify(typed)}: the field shows the kept value ${kept}`);
    }
    await goto(HOSTS.penplotter.url, null, `!!document.getElementById('polygon-sides')`);
    assert.strictEqual(await sides(), '8', 'remembered across a reload');

    // ---- 3. a REAL-mouse octagon in the Pen Plotter: 8 plain lines + 8 construction radii, closed; ONE Undo removes it all
    const pp = HOSTS.penplotter;
    const stateOf = (h) => `(${h.state})`;
    const summary = (h) => evalJs(`(() => { const s = ${stateOf(h)}; return JSON.stringify({ shapes: s.shapes.length, lines: s.shapes.filter(x => x.type === 'line').length, sides: s.shapes.filter(x => !x.isConstruction).length, radii: s.shapes.filter(x => x.isConstruction).length, constraints: s.constraints.length, joints: s.joints.size }); })()`).then(JSON.parse);
    await clickEl('#tool-polygon');
    const cv = await centerOf(pp.canvas);
    const before = await summary(pp);
    await drag([[cv.x, cv.y], [cv.x + 40, cv.y + 5], [cv.x + 120, cv.y + 15]]);
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
    await open('penplotter'); await typeInto('#polygon-sides', '6');
    for (const name of ['shaper']) {
      const h = await open(name);
      assert.strictEqual(await sides(), '6', name + ': the remembered side count is shared (same origin)');
      const c0 = await summary(h);
      await clickEl('#tool-polygon');
      const c = await centerOf(h.canvas);
      await drag([[c.x, c.y], [c.x + 40, c.y + 5], [c.x + 120, c.y + 15]]);
      const hex = await summary(h);
      // (a delta: the design is carried across apps, so Shaper may open with what the plotter autosaved)
      assert.strictEqual(hex.sides - c0.sides, 6, name + ': a hexagon'); assert.strictEqual(hex.lines - c0.lines, 12);
      await clickEl('#btn-undo');
      assert.deepStrictEqual(await summary(h), c0, name + ': one Undo removes it');
    }
    // Studio keeps no global state handle: count the drawn shape elements, and use the real Undo button
    await open('studio');
    await clickEl('#tool-polygon');
    const sc = await centerOf('#svgCanvas');
    const shapeCount = () => evalJs(`document.querySelectorAll('.shape-elem').length`);
    const s0 = await shapeCount();
    await drag([[sc.x, sc.y], [sc.x + 40, sc.y + 5], [sc.x + 120, sc.y + 15]]);
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
