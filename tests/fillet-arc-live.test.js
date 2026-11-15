// tests/fillet-arc-live.test.js -- TASK 645 (live headless, REAL mouse via CDP, Pen Plotter = the shared Design tab): a line and an arc that meet at a
// point; Fillet, tap the corner, type 5, Enter -> a fillet arc of radius 5 TANGENT to the line and to the arc (the line and the arc are trimmed to it);
// one Undo removes it. Screenshots: .evidence/645.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser } from './helpers/cdp-browser.js';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const EVID = path.join(process.cwd(), '.evidence', '645');

await (async () => {
  const cdp = await launchBrowser({ tag: '645', width: 1600, height: 900 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, once, evalJs, waitFor, waitForApp } = cdp;
  try {
    fs.mkdirSync(EVID, { recursive: true });
    const mouse = (type, x, y, buttons) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
    const click = async (x, y) => { await mouse('mouseMoved', x, y, 0); await sleep(60); await mouse('mousePressed', x, y, 1); await sleep(40); await mouse('mouseReleased', x, y, 0); await sleep(250); };
    const key = async (k, code, vk) => { await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk }); await sleep(250); };
    const centerOf = (sel) => evalJs(`(() => { const r = document.querySelector('${sel}').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    const STATE = 'window.__sketch.controller.state';
    const shot = async (file, clip) => { const r = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 1 } } : {}) }); fs.writeFileSync(path.join(EVID, file), Buffer.from(r.data, 'base64')); };
    const loaded = once('Page.loadEventFired');
    await send('Page.navigate', { url: `http://127.0.0.1:${port}/apps/penplotter/index.html` });
    await Promise.race([loaded, sleep(8000)]);
    await waitFor(`!!document.querySelector('.sk-header-tab[data-tab="design"]')`, 'the stage button');
    const sb = await centerOf('.sk-header-tab[data-tab="design"]'); await click(sb.x, sb.y);
    await waitForApp('design-canvas');
    await waitFor(`document.querySelector('#design-canvas').getBoundingClientRect().width > 0 && !!${STATE}`, 'the design canvas');
    const c = await centerOf('#design-canvas');
    const counts = () => evalJs(`(() => { const s = ${STATE}.shapes; return { arcs: s.filter((x) => x.type === 'arc').length, lines: s.filter((x) => x.type === 'line').length }; })()`);
    // the arc: centre (+50,+80) from the corner, start = the corner P = c, end up to the right; the line ends on P
    const ab = await centerOf('#tool-arc'); await click(ab.x, ab.y);
    await click(c.x + 50, c.y + 80); await click(c.x, c.y); await click(c.x + 132, c.y + 33);
    const lb = await centerOf('#tool-line'); await click(lb.x, lb.y);
    await click(c.x - 160, c.y); await click(c.x, c.y); await key('Escape', 'Escape', 27);
    assert.deepStrictEqual(await counts(), { arcs: 1, lines: 1 }, 'a line and an arc are drawn');
    const clip = { x: c.x - 200, y: c.y - 120, width: 380, height: 260 };
    await shot('before.png', clip);

    await click((await centerOf('#tool-fillet')).x, (await centerOf('#tool-fillet')).y);
    await click(c.x, c.y);
    await waitFor(`!!document.getElementById('fillet-radius-input')`, 'the radius input');
    await evalJs(`(() => { const i = document.getElementById('fillet-radius-input'); i.focus(); i.select(); })()`);
    for (const ch of '5') await send('Input.dispatchKeyEvent', { type: 'char', text: ch });
    await key('Enter', 'Enter', 13);
    await waitFor(`!document.getElementById('fillet-radius-input')`, 'the input to close');
    assert.deepStrictEqual(await counts(), { arcs: 2, lines: 1 }, 'the fillet arc is added');

    // tangency from the document: the fillet arc is the one with the dimension / radius 5
    const geo = JSON.parse(await evalJs(`JSON.stringify((() => { const st = ${STATE}; const P = (id) => { const j = st.joints.get(id); return { x: j.x, y: j.y }; };
      return { arcs: st.shapes.filter((s) => s.type === 'arc').map((s) => ({ id: s.id, c: P(s.joints[0]), s: P(s.joints[1]), e: P(s.joints[2]) })), line: st.shapes.filter((s) => s.type === 'line').map((s) => ({ a: P(s.joints[0]), b: P(s.joints[1]) }))[0] }; })())`));
    const rad = (a) => Math.hypot(a.s.x - a.c.x, a.s.y - a.c.y);
    const fil = geo.arcs.reduce((a, b) => (rad(a) < rad(b) ? a : b)), big = geo.arcs.reduce((a, b) => (rad(a) > rad(b) ? a : b));
    assert(Math.abs(rad(fil) - 5) < 1e-3, 'the fillet radius is 5: ' + rad(fil));
    const L = geo.line, d = Math.hypot(L.b.x - L.a.x, L.b.y - L.a.y);
    const dist = Math.abs((L.b.x - L.a.x) * (L.a.y - fil.c.y) - (L.a.x - fil.c.x) * (L.b.y - L.a.y)) / d;
    assert(Math.abs(dist - 5) < 1e-3, 'fillet centre to the line = 5: ' + dist);
    const cc = Math.hypot(fil.c.x - big.c.x, fil.c.y - big.c.y), R = rad(big);
    assert(Math.abs(cc - (R + 5)) < 1e-3 || Math.abs(cc - (R - 5)) < 1e-3, `fillet centre to the arc centre = R +/- 5: ${cc} vs R ${R}`);
    await shot('after.png', clip);

    await key('z', 'KeyZ', 90).catch(() => {});
    if ((await counts()).arcs !== 1) {
      await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: 2 });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: 2 }); await sleep(300);
    }
    assert.deepStrictEqual(await counts(), { arcs: 1, lines: 1 }, 'one Undo removes the fillet (the line and the arc stay)');
    console.log('fillet-arc-live.test.js: ok');
  } finally { await cdp.close(); }
})();
