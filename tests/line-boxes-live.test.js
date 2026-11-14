// tests/line-boxes-live.test.js - TASK 597 (live headless, REAL mouse + REAL keys, Pen Plotter host = the shared Design tab): the Line tool shows its length + angle boxes on the canvas right
// after the first click (the shared creation-box path, base-tool openCreationBoxes). A typed 50, Tab, 30, Enter makes exactly that segment.
// A cropped screenshot of the boxes goes to $EVIDENCE_DIR (default .evidence/597).
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser } from './helpers/cdp-browser.js';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await (async () => {
  const cdp = await launchBrowser({ tag: '597', width: 1400, height: 800 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, once, evalJs, waitFor, waitForApp } = cdp;
  try {
    const mouse = (type, x, y, buttons) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
    const move = async (x, y) => { await mouse('mouseMoved', x, y, 0); await sleep(60); };
    const click = async (x, y) => { await move(x, y); await mouse('mousePressed', x, y, 1); await sleep(30); await mouse('mouseReleased', x, y, 0); await sleep(150); };
    const key = async (k, code, vk, modifiers = 0) => {
      await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk, modifiers });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, modifiers }); await sleep(150);
    };
    const type = async (t) => { await send('Input.insertText', { text: t }); await sleep(100); };
    const loaded = once('Page.loadEventFired');
    await send('Page.navigate', { url: `http://127.0.0.1:${port}/apps/penplotter/index.html` });   // the Pen Plotter hosts the shared Design tab and exposes its state
    await Promise.race([loaded, sleep(8000)]);
    await waitFor(`!!document.querySelector('.stage-btn[data-stage="design"]')`, 'the stage buttons');
    await evalJs(`document.querySelector('.stage-btn[data-stage="design"]').click()`);
    await waitForApp('design-canvas');
    await waitFor(`!!window.__sketch && !!window.__sketch.controller && document.getElementById('design-canvas').getBoundingClientRect().width > 0`, 'the Design tab');
    const boxes = () => evalJs(`[...document.querySelectorAll('.sk-dual-input')].filter((b) => getComputedStyle(b).display !== 'none').map((b) => [...b.querySelectorAll('input')].map((i) => [i.placeholder, i.value]))`);
    const c = await evalJs(`(() => { const r = document.getElementById('design-canvas').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2) + 120, y: Math.round(r.top + r.height / 2) + 60 }; })()`);
    await evalJs(`document.getElementById('tool-line').click()`); await sleep(150);
    assert.deepStrictEqual(await boxes(), [], 'before the first click no box shows');
    await click(c.x, c.y);
    const shown = await boxes();
    assert.strictEqual(shown.length, 1, 'after the first click the boxes show: ' + JSON.stringify(shown));
    assert.deepStrictEqual(shown[0].map((p) => p[0]), ['L', '°'], 'length and angle');
    await move(c.x + 160, c.y - 40);
    await type('50'); await key('Tab', 'Tab', 9); await type('30');
    const typed = await boxes();
    assert.deepStrictEqual(typed[0].map((p) => p[1]), ['50', '30'], 'the typed values stay in the boxes while the cursor moved: ' + JSON.stringify(typed));
    // the boxes beside the cursor, legible: crop around them
    const rect = await evalJs(`(() => { const b = [...document.querySelectorAll('.sk-dual-input')].find((x) => getComputedStyle(x).display !== 'none'); const r = b.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()`);
    const clip = { x: Math.max(0, c.x - 40), y: Math.max(0, Math.min(c.y, rect.y) - 70), width: 420, height: 230, scale: 2.5 };
    const shot = await send('Page.captureScreenshot', { format: 'png', clip });
    const dir = process.env.EVIDENCE_DIR || path.join(process.cwd(), '.evidence', '597');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'line-boxes.png'), Buffer.from(shot.data, 'base64'));
    await key('Enter', 'Enter', 13);
    const seg = await evalJs(`(() => {
      const st = window.__sketch.controller.state;
      if (!st) return null;
      const l = st.shapes.filter((s) => s.type === 'line' && !s.isConstruction)[0]; if (!l) return { lines: 0 };
      const a = st.joints.get(l.joints[0]), b = st.joints.get(l.joints[1]);
      return { lines: st.shapes.filter((s) => s.type === 'line' && !s.isConstruction).length, len: Math.hypot(b.x - a.x, b.y - a.y), ang: Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI };
    })()`);
    assert(seg, 'the page exposes its state');
    assert.strictEqual(seg.lines, 1, 'one segment placed');
    assert(Math.abs(seg.len - 50) < 1e-6, 'exactly length 50: ' + seg.len);
    assert(Math.abs(seg.ang - 30) < 1e-6, 'exactly angle 30: ' + seg.ang);
    assert.strictEqual((await boxes()).length, 1, 'the next segment of the chain has its boxes');
    await key('Escape', 'Escape', 27);
    assert.deepStrictEqual(await boxes(), [], 'Esc closes them');
    console.log('line boxes live: ok', JSON.stringify(seg));
  } finally { try { await cdp.close(); } catch (_) { /* closed */ } }
})();
