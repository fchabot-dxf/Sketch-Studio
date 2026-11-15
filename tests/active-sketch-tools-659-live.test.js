// tests/active-sketch-tools-659-live.test.js -- TASK 659 (live headless, REAL mouse and REAL touch via CDP, Pen Plotter = the shared Design tab).
// Curves of another sketch are no pick for Trim and Mirror (one warning since task 660, no undo step, nothing changes); with that sketch active they work and every
// new joint is in it; a Trim's crossing line of another sketch does not cut; a mirror line of another sketch is not picked. Screenshots: .evidence/659.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser } from './helpers/cdp-browser.js';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const EVID = path.join(process.cwd(), '.evidence', '659');
const STATE = 'window.__sketch.controller.state';

await (async () => {
  const cdp = await launchBrowser({ tag: '659', width: 1600, height: 900 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, once, evalJs, waitFor, waitForApp } = cdp;
  try {
    fs.mkdirSync(EVID, { recursive: true });
    const shot = async (file, clip) => { const r = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 1 } } : {}) }); fs.writeFileSync(path.join(EVID, file), Buffer.from(r.data, 'base64')); };
    const key = async (k, code, vk) => { await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk }); await sleep(250); };
    const mouse = (type, x, y, buttons) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
    const T = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i + 1, radiusX: 1, radiusY: 1, force: 1 })) });
    const pointers = {
      mouse: { tap: async (p) => { await mouse('mouseMoved', p.x, p.y, 0); await sleep(60); await mouse('mousePressed', p.x, p.y, 1); await sleep(40); await mouse('mouseReleased', p.x, p.y, 0); await sleep(250); } },
      touch: { tap: async (p) => { await T('touchStart', [p]); await sleep(60); await T('touchEnd', []); await sleep(300); } },
    };
    const toasts = () => evalJs(`JSON.stringify([...document.querySelectorAll('#notification-container > div')].map((e) => e.textContent.trim().replace(/^[^A-Za-z]+/, '')))`).then(JSON.parse);
    const clearToasts = () => evalJs(`document.querySelectorAll('#notification-container > div').forEach((e) => e.remove())`);
    const hist = () => evalJs(`${STATE}.history.length`);
    const world = (expr) => evalJs(`JSON.stringify(${expr})`).then(JSON.parse);
    const activate = (id) => evalJs(`import('/packages/core/sketch-model.js').then((m) => m.activateSketch(${STATE}, ${JSON.stringify(id)}))`);

    const loaded = once('Page.loadEventFired');
    await send('Page.navigate', { url: `http://127.0.0.1:${port}/apps/penplotter/index.html` });
    await Promise.race([loaded, sleep(8000)]);
    await waitFor(`!!document.querySelector('.sk-header-tab[data-tab="design"]')`, 'the stage button');

    const run = async (kind) => {
      const P = pointers[kind];
      const out = (s) => console.log(`[${kind}] ${s}`);
      if (kind === 'touch') {
        await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
        await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
        const l2 = once('Page.loadEventFired');
        await send('Page.navigate', { url: `http://127.0.0.1:${port}/apps/penplotter/index.html` });
        await Promise.race([l2, sleep(8000)]);
        await waitFor(`!!document.querySelector('.sk-header-tab[data-tab="design"]')`, 'the stage button (phone)');
      }
      await evalJs(`document.querySelector('.sk-header-tab[data-tab="design"]').click()`);
      await waitForApp('design-canvas');
      await waitFor(`document.querySelector('#design-canvas').getBoundingClientRect().width > 0 && !!${STATE}`, 'the design canvas');
      await sleep(500);
      const cr = await evalJs(`(() => { const r = document.querySelector('#design-canvas').getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height }; })()`);
      const C = { x: Math.round(cr.l + cr.w * 0.5), y: Math.round(cr.t + cr.h * 0.4) };
      const arm = Math.round(Math.min(cr.w * 0.3, 150));
      const tool = async (id) => { if (await evalJs(`${STATE}.currentTool`) !== id.replace('tool-', '')) { await evalJs(`document.querySelector('#${id}').click()`); await sleep(200); } };
      const clip = { x: Math.max(0, C.x - 190), y: Math.max(0, C.y - 170), width: Math.min(380, cr.w), height: 380 };
      const wipe = () => evalJs(`(() => { const st = ${STATE}; st.shapes.length = 0; st.constraints.length = 0; [...st.joints.keys()].forEach((id) => { if (id !== 'j_origin') st.joints.delete(id); }); st.triggerDraw && st.triggerDraw(); })()`);
      const draw = async (a, b) => { await tool('tool-line'); await P.tap(a); await P.tap(b); await key('Escape', 'Escape', 27); };
      const jointsOf = (id) => world(`${STATE}.shapes.find((s) => s.id === ${JSON.stringify(id)}).joints`);
      const sketchesOfJoints = () => world(`[...${STATE}.joints].filter(([id]) => id !== 'j_origin').map(([, j]) => j.sketchId || 'sketch-1')`);
      await wipe();
      await evalJs(`import('/packages/core/sketch-model.js').then((m) => { if (!${STATE}.sketches.some((s) => s.id === 'sketch-2')) m.addSketch(${STATE}, 'Sketch 2'); })`);

      // ---- TRIM: a horizontal and a vertical line, both in Sketch 2
      await activate('sketch-2');
      const L = { x: C.x - arm, y: C.y }, R = { x: C.x + arm, y: C.y };
      await draw(L, R); await draw({ x: C.x, y: C.y - arm }, { x: C.x, y: C.y + arm });
      const hid = await world(`${STATE}.shapes.filter((s) => s.type === 'line').map((s) => s.id)`);
      assert.strictEqual(hid.length, 2, `[${kind}] two lines drawn in sketch-2`);
      const before = await jointsOf(hid[0]);
      await activate('sketch-1');
      await tool('tool-trim'); await clearToasts();
      const h0 = await hist(), tap = { x: C.x - Math.round(arm / 2), y: C.y };
      await P.tap(tap);
      assert.deepStrictEqual(await jointsOf(hid[0]), before, `[${kind}] trim in Sketch 1: the Sketch 2 line is untouched`);
      assert.strictEqual(await hist(), h0, `[${kind}] trim: no undo step`);
      assert.deepStrictEqual(await toasts(), ['Trim works in the active sketch: make Sketch 2 active first'], `[${kind}] trim: the one warning`);
      await shot(`${kind}-1-trim-nothing-happens.png`, clip);
      await activate('sketch-2'); await tool('tool-trim'); await P.tap(tap);
      assert.notDeepStrictEqual(await jointsOf(hid[0]), before, `[${kind}] trim in Sketch 2: the line is trimmed`);
      const skT = await sketchesOfJoints();
      assert.ok(skT.every((s) => s === 'sketch-2'), `[${kind}] trim: every joint in sketch-2: ${JSON.stringify(skT)}`);
      await shot(`${kind}-2-trim-in-sketch-2.png`, clip);
      out(`trim ok, joints ${JSON.stringify(skT)}`);

      // ---- TRIM boundary: the active line crossed only by another sketch's line is not cut
      await key('Escape', 'Escape', 27); await wipe();
      await activate('sketch-2'); await draw({ x: C.x, y: C.y - arm }, { x: C.x, y: C.y + arm });
      await activate('sketch-1'); await draw(L, R);
      const lines = await world(`${STATE}.shapes.filter((s) => s.type === 'line').map((s) => [s.id, s.sketchId])`);
      const act = lines.find(([, sk]) => sk === 'sketch-1')[0];
      await tool('tool-trim'); await P.tap(tap);
      assert.ok(!(await world(`${STATE}.shapes.some((s) => s.id === ${JSON.stringify(act)})`)), `[${kind}] trim: the other sketch's crossing line did not cut; the active line went whole`);
      out('trim boundary ok');

      // ---- MIRROR: an object and a mirror line of Sketch 2 are no picks with Sketch 1 active
      await key('Escape', 'Escape', 27); await wipe();
      await activate('sketch-2');
      const x1a = { x: C.x - arm, y: C.y - 60 }, x1b = { x: C.x - 20, y: C.y - 60 };
      await draw(x1a, x1b); await draw({ x: C.x + Math.round(arm / 2), y: C.y - arm }, { x: C.x + Math.round(arm / 2), y: C.y + arm });
      await activate('sketch-1');
      const s1a = { x: C.x - arm, y: C.y + 60 }, s1b = { x: C.x - 20, y: C.y + 60 };
      await draw(s1a, s1b);
      const ids = await world(`${STATE}.shapes.map((s) => [s.id, s.sketchId])`);
      const mine = ids.find(([, sk]) => sk === 'sketch-1')[0];
      const mid = (a, b) => ({ x: Math.round((a.x + b.x) / 2), y: Math.round((a.y + b.y) / 2) });
      await tool('tool-mirror'); await clearToasts();
      const sel = () => world(`[...${STATE}.selectedShapes]`);
      await P.tap(mid(x1a, x1b));
      assert.deepStrictEqual(await sel(), [], `[${kind}] mirror: the Sketch 2 line is not an object`);
      await P.tap(mid(s1a, s1b));
      assert.deepStrictEqual(await sel(), [mine], `[${kind}] mirror: the Sketch 1 line is the object`);
      await key('Enter', 'Enter', 13);
      const h1 = await hist();
      await P.tap({ x: C.x + Math.round(arm / 2), y: C.y });
      assert.ok(!(await world(`${STATE}.mirror && ${STATE}.mirror.line`)), `[${kind}] mirror: the Sketch 2 vertical is not the mirror line`);
      await key('Enter', 'Enter', 13);
      assert.strictEqual(await hist(), h1, `[${kind}] mirror: nothing mirrored, no undo step`);
      assert.strictEqual(await world(`${STATE}.shapes.length`), 3, `[${kind}] mirror: no copy`);
      await shot(`${kind}-3-mirror-nothing-happens.png`, clip);
      await key('Escape', 'Escape', 27);
      out('mirror ok');
      await tool('tool-select'); await wipe();
      out('all checks passed');
    };

    await run('mouse');
    await run('touch');
    console.log('active-sketch-tools-659-live.test.js: ok');
  } finally { await cdp.close(); }
})();
