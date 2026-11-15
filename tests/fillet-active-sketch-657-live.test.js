// tests/fillet-active-sketch-657-live.test.js -- TASK 657 (live headless, REAL mouse and REAL touch via CDP, Pen Plotter = the shared Design tab).
// Two lines in Sketch 2 (visible, unlocked), Sketch 1 active:
//  - Fillet, tap the corner: ONE warning (task 660: another sketch's curve is not pickable, and it says so), no radius box, no arc, no undo step;
//  - make Sketch 2 active: the same tap opens the box, Enter fillets; the arc, the V and every joint are in sketch-2;
//  - a mixed corner (one line of each sketch, Sketch 1 active): not filleted.
// Run twice: desktop with the mouse, phone (390x844) with a finger. Screenshots: .evidence/657.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser } from './helpers/cdp-browser.js';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const EVID = path.join(process.cwd(), '.evidence', '657');
const STATE = 'window.__sketch.controller.state';

await (async () => {
  const cdp = await launchBrowser({ tag: '657', width: 1600, height: 900 });
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
    const boxOpen = () => evalJs(`!!document.getElementById('fillet-radius-input')`);
    const hist = () => evalJs(`${STATE}.history.length`);
    const arcs = () => evalJs(`${STATE}.shapes.filter((s) => s.type === 'arc').length`);
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
      const C = { x: Math.round(cr.l + cr.w * 0.5), y: Math.round(cr.t + cr.h * 0.38) }; // the corner, on screen
      const arm = Math.round(Math.min(cr.w * 0.3, 150));
      const A = { x: C.x - arm, y: C.y }, B = { x: C.x, y: C.y - arm };
      const mid = (p) => ({ x: Math.round((p.x + C.x) / 2), y: Math.round((p.y + C.y) / 2) });
      const tool = async (id) => { if (await evalJs(`${STATE}.currentTool`) !== id.replace('tool-', '')) { await evalJs(`document.querySelector('#${id}').click()`); await sleep(200); } };
      const clip = { x: Math.max(0, C.x - 190), y: Math.max(0, C.y - 170), width: Math.min(380, cr.w), height: 380 };

      await evalJs(`(() => { const st = ${STATE}; st.shapes.length = 0; st.constraints.length = 0; [...st.joints.keys()].forEach((id) => { if (id !== 'j_origin') st.joints.delete(id); }); })()`); // a reload restores the last run's drawing
      // Sketch 2 is added through the sketch model the app uses; the lines are drawn with the Line tool into it
      await evalJs(`import('/packages/core/sketch-model.js').then((m) => { if (!${STATE}.sketches.some((s) => s.id === 'sketch-2')) m.addSketch(${STATE}, 'Sketch 2'); })`);
      await activate('sketch-2');
      await tool('tool-line'); await P.tap(A); await P.tap(C); await P.tap(B); await key('Escape', 'Escape', 27);
      const where = await world(`${STATE}.shapes.filter((s) => s.type === 'line').map((s) => s.sketchId)`);
      assert.deepStrictEqual(where, ['sketch-2', 'sketch-2'], `[${kind}] the two lines are in sketch-2: ${JSON.stringify(where)}`);
      await activate('sketch-1');
      const baseHist = await hist();

      // ---- Sketch 1 active: the Sketch 2 corner says so and starts nothing
      await tool('tool-fillet'); await clearToasts();
      await P.tap(C);
      assert.deepStrictEqual(await toasts(), ['Fillet works in the active sketch: make Sketch 2 active first'], `[${kind}] one warning at the corner tap`);
      await shot(`${kind}-1-warning.png`, clip);
      assert.strictEqual(await boxOpen(), false, `[${kind}] no radius box`);
      assert.strictEqual(await arcs(), 0, `[${kind}] no arc`);
      assert.strictEqual(await hist(), baseHist, `[${kind}] no undo step`);
      await clearToasts(); await P.tap(mid(A));
      assert.deepStrictEqual(await toasts(), ['Fillet works in the active sketch: make Sketch 2 active first'], `[${kind}] a tap on the line: the same one warning`);
      await key('Escape', 'Escape', 27);

      // ---- Sketch 2 active: the same tap fillets, all in sketch-2
      await activate('sketch-2');
      await tool('tool-fillet'); await clearToasts();
      await P.tap(C);
      await waitFor(`!!document.getElementById('fillet-radius-input')`, `[${kind}] the box opens with Sketch 2 active`);
      await key('Enter', 'Enter', 13);
      assert.strictEqual(await boxOpen(), false, `[${kind}] Enter closes the box`);
      assert.strictEqual(await arcs(), 1, `[${kind}] one fillet arc`);
      assert.strictEqual(await hist(), baseHist + 1, `[${kind}] one undo step`);
      const sk = await world(`(() => { const st = ${STATE}; return { arc: st.shapes.find((s) => s.type === 'arc').sketchId, joints: [...st.joints].filter(([id]) => id !== 'j_origin').map(([, j]) => j.sketchId || 'sketch-1') }; })()`);
      assert.strictEqual(sk.arc, 'sketch-2', `[${kind}] the arc is in sketch-2`);
      assert.ok(sk.joints.length >= 5 && sk.joints.every((s) => s === 'sketch-2'), `[${kind}] every joint in sketch-2: ${JSON.stringify(sk.joints)}`);
      await shot(`${kind}-2-applied-in-sketch-2.png`, clip);
      out(`applied: arc ${sk.arc}, joints ${JSON.stringify(sk.joints)}`);

      // ---- mixed corner: one line of Sketch 2, one of Sketch 1, Sketch 1 active
      await evalJs(`(() => { const st = ${STATE}; st.shapes.length = 0; st.constraints.length = 0; [...st.joints.keys()].forEach((id) => { if (id !== 'j_origin') st.joints.delete(id); }); })()`);
      await tool('tool-line'); await P.tap(B); await P.tap(C); await key('Escape', 'Escape', 27); // B-C in sketch-2 (active)
      await activate('sketch-1');
      // C-A of Sketch 1 sharing the corner joint (injected: the Line tool does not start a line on another sketch's joint)
      await evalJs(`(() => { const st = ${STATE}; const ln = st.shapes.find((s) => s.type === 'line'); const jc = ln.joints[1]; const c = st.joints.get(jc); const ja = st.genJ(); st.joints.set(ja, { x: c.x - 50, y: c.y, fixed: false, sketchId: 'sketch-1' }); st.shapes.push({ id: 's_mix_a', type: 'line', joints: [ja, jc], sketchId: 'sketch-1' }); st.triggerDraw && st.triggerDraw(); })()`);
      await sleep(250);
      const mixed = await world(`${STATE}.shapes.filter((s) => s.type === 'line').map((s) => s.sketchId)`);
      assert.deepStrictEqual(mixed.slice().sort(), ['sketch-1', 'sketch-2'], `[${kind}] one line of each sketch: ${JSON.stringify(mixed)}`);
      const h2 = await hist();
      await tool('tool-fillet'); await clearToasts();
      await P.tap(C);
      assert.strictEqual(await boxOpen(), false, `[${kind}] the mixed corner opens no box`);
      await P.tap(mid(B)); // line 2 = the other sketch's line
      assert.strictEqual(await boxOpen(), false, `[${kind}] a mixed pick opens no box`);
      assert.strictEqual(await arcs(), 0, `[${kind}] the mixed corner is not filleted`);
      assert.strictEqual(await hist(), h2, `[${kind}] no undo step`);
      await key('Escape', 'Escape', 27);
      out('mixed corner not filleted');
      await tool('tool-select');
      await evalJs(`(() => { const st = ${STATE}; st.shapes.length = 0; st.constraints.length = 0; [...st.joints.keys()].forEach((id) => { if (id !== 'j_origin') st.joints.delete(id); }); st.triggerDraw && st.triggerDraw(); })()`);
      out('all checks passed');
    };

    await run('mouse');
    await run('touch');
    console.log('fillet-active-sketch-657-live.test.js: ok');
  } finally { await cdp.close(); }
})();
