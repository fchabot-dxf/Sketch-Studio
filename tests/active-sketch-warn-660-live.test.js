// tests/active-sketch-warn-660-live.test.js -- TASK 660 (live headless, REAL mouse and REAL touch via CDP, Pen Plotter = the shared Design tab).
// Offset and Mirror, Sketch 1 active, a line of Sketch 2 under the pointer and a line of Sketch 1 2 px away:
//  - the Sketch 1 line is the pick (the nearer Sketch 2 line no longer shadows it), no warning;
//  - with ONLY the Sketch 2 line within reach: ONE warning "<Tool> works in the active sketch: make Sketch 2 active first", nothing starts, no undo step.
// Run twice: desktop with the mouse, phone (390x844) with a finger. Screenshots (the warning): .evidence/660.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser } from './helpers/cdp-browser.js';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const EVID = path.join(process.cwd(), '.evidence', '660');
const STATE = 'window.__sketch.controller.state';

await (async () => {
  const cdp = await launchBrowser({ tag: '660', width: 1600, height: 900 });
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
      const toastClip = async () => { const b = await world(`(() => { const r = document.querySelector('#notification-container > div').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()`); return { x: Math.max(0, Math.floor(b.x - 20)), y: Math.max(0, Math.floor(b.y - 20)), width: Math.ceil(b.w + 40), height: Math.ceil(b.h + 40) }; };
      const WARN = (t) => `${t} works in the active sketch: make Sketch 2 active first`;
      await wipe();
      await evalJs(`import('/packages/core/sketch-model.js').then((m) => { if (!${STATE}.sketches.some((s) => s.id === 'sketch-2')) m.addSketch(${STATE}, 'Sketch 2'); })`);

      // the Sketch 2 line, drawn with the Line tool; then a Sketch 1 line 2 px below it (made in the model: a drawn one would snap to it)
      await activate('sketch-2');
      const L = { x: C.x - arm, y: C.y }, R = { x: C.x + arm, y: C.y };
      await draw(L, R);
      const wpp = await world(`(() => { const st = ${STATE}; const s = st.shapes.find((x) => x.type === 'line'); const a = st.joints.get(s.joints[0]), b = st.joints.get(s.joints[1]); return Math.abs(b.x - a.x) / ${R.x - L.x}; })()`); // mm per screen px
      await activate('sketch-1');
      await world(`(() => { const st = ${STATE}; const s = st.shapes.find((x) => x.type === 'line'); const a = st.joints.get(s.joints[0]), b = st.joints.get(s.joints[1]);
        const dy = 2 * ${wpp}; const ja = st.genJ(), jb = st.genJ();
        st.joints.set(ja, { x: a.x, y: a.y + dy, fixed: false, sketchId: 'sketch-1' }); st.joints.set(jb, { x: b.x, y: b.y + dy, fixed: false, sketchId: 'sketch-1' });
        st.shapes.push({ id: 'mine660', type: 'line', joints: [ja, jb], sketchId: 'sketch-1' }); st.triggerDraw && st.triggerDraw(); return { dy }; })()`);

      // ---- OFFSET: the tap is under the Sketch 2 line and 2 px from the Sketch 1 line: the Sketch 1 line is picked
      await tool('tool-offset'); await clearToasts();
      await P.tap({ x: C.x, y: C.y });
      await waitFor(`!!document.getElementById('offset-distance-input')`, `[${kind}] the offset box opens on the active line`);
      assert.deepStrictEqual(await toasts(), [], `[${kind}] offset shadow: no warning`);
      const lit = await world(`[...document.querySelectorAll('#offset-tool-overlay .offset-chain')].map((e) => Number(e.getAttribute('y1')))`);
      const myY = await world(`${STATE}.joints.get(${STATE}.shapes.find((s) => s.id === 'mine660').joints[0]).y`);
      assert.deepStrictEqual(lit.length, 1, `[${kind}] one curve lit`);
      assert.ok(Math.abs(lit[0] - myY) < 1e-6, `[${kind}] the lit curve is the Sketch 1 line: ${lit[0]} vs ${myY}`);
      await key('Escape', 'Escape', 27);
      out('offset shadow ok');

      // ---- OFFSET: only the Sketch 2 line in reach (the Sketch 1 line moved away): the warning
      await world(`(() => { const st = ${STATE}; const s = st.shapes.find((x) => x.id === 'mine660'); for (const id of s.joints) st.joints.get(id).y += 400; return 1; })()`);
      await tool('tool-offset'); await clearToasts(); const h0 = await hist();
      await P.tap({ x: C.x, y: C.y });
      assert.deepStrictEqual(await toasts(), [WARN('Offset')], `[${kind}] offset: the one warning`);
      assert.strictEqual(await evalJs(`!!document.getElementById('offset-distance-input')`), false, `[${kind}] offset: no box`);
      assert.strictEqual(await hist(), h0, `[${kind}] offset: no undo step`);
      await shot(`${kind}-offset-warning.png`, await toastClip());
      await key('Escape', 'Escape', 27);
      out('offset warning ok');

      // ---- MIRROR: the Sketch 1 line back 2 px away: it is the object; then only the Sketch 2 line: the warning
      await world(`(() => { const st = ${STATE}; const s = st.shapes.find((x) => x.id === 'mine660'); for (const id of s.joints) st.joints.get(id).y -= 400; return 1; })()`);
      await tool('tool-mirror'); await clearToasts();
      await P.tap({ x: C.x, y: C.y });
      assert.deepStrictEqual(await world(`[...${STATE}.selectedShapes]`), ['mine660'], `[${kind}] mirror shadow: the Sketch 1 line is the object`);
      assert.deepStrictEqual(await toasts(), [], `[${kind}] mirror shadow: no warning`);
      await key('Escape', 'Escape', 27);
      await world(`(() => { const st = ${STATE}; const s = st.shapes.find((x) => x.id === 'mine660'); for (const id of s.joints) st.joints.get(id).y += 400; st.selectedShapes.clear(); return 1; })()`);
      await tool('tool-mirror'); await clearToasts(); const h1 = await hist();
      await P.tap({ x: C.x, y: C.y });
      assert.deepStrictEqual(await toasts(), [WARN('Mirror')], `[${kind}] mirror: the one warning`);
      assert.deepStrictEqual(await world(`[...${STATE}.selectedShapes]`), [], `[${kind}] mirror: nothing picked`);
      assert.strictEqual(await hist(), h1, `[${kind}] mirror: no undo step`);
      await shot(`${kind}-mirror-warning.png`, await toastClip());
      await key('Escape', 'Escape', 27);
      out('mirror warning ok');
      await tool('tool-select'); await wipe();
      out('all checks passed');
    };

    await run('mouse');
    await run('touch');
    console.log('active-sketch-warn-660-live.test.js: ok');
  } finally { await cdp.close(); }
})();
