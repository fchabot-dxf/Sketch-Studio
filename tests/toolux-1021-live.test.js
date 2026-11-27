// tests/toolux-1021-live.test.js — TASK 1021: live visual checks (desktop 1280x800 + phone 390x844) in SketchStudio.
//   R1-15: three concentric circles drawn with typed diameters (Ø100, Ø20, Ø70): their labels are DIFFERENT places, no two label boxes overlap.
//   R2-10: the Parameters window's `ref` badge stays one line (a reference dimension on the last circle).
// Evidence: .evidence/1021/<label>-<tag>.png (set TOOLUX_TAG=before|after to name them).
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sleep, sendRealKey } from './helpers/cdp-browser.js';
import { installFakeDriveSession } from './helpers/fake-drive-session.js';
import { resetBufferLive } from './helpers/reset-buffer.js';
import { pressRibbonTool } from './helpers/ribbon-tool.js';

const EVIDENCE_DIR = path.resolve('.evidence/1021');
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
const TAG = process.env.TOOLUX_TAG || 'run';

async function run({ width, height, tag }) {
  const label = `${width}x${height}`;
  const isPhone = width <= 640;
  const cdp = await launchBrowser({ tag: `1021-${tag}`, width, height });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
  const { port, send, evalJs, waitFor, waitForApp, navigate, close } = cdp;
  const tap = async (p) => {
    const x = Math.round(p.x), y = Math.round(p.y);
    if (isPhone) {
      await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1, radiusX: 1, radiusY: 1, force: 1 }] });
      await sleep(60);
      await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', clickCount: 0 });
      await sleep(50);
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
      await sleep(40);
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
    }
    await sleep(200);
  };
  const w2s = (wx, wy) => evalJs(`(() => { const svg = document.getElementById('svgCanvas'); const pt = svg.createSVGPoint(); pt.x = ${wx}; pt.y = ${wy}; const p = pt.matrixTransform(svg.getScreenCTM()); return { x: p.x, y: p.y }; })()`);
  const shot = async (name) => {
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(EVIDENCE_DIR, `${name}-${TAG}-${tag}.png`), Buffer.from(data, 'base64'));
  };
  const labelRects = () => evalJs(`[...document.querySelectorAll('#svgCanvas .dim-label')].map((e) => { const r = e.getBoundingClientRect(); return { text: e.textContent.trim().replace(/\\s+/g, ' '), x: r.left, y: r.top, w: r.width, h: r.height }; })`);

  try {
    await installFakeDriveSession(cdp);
    if (isPhone) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: true });
      await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    }
    await resetBufferLive(cdp);
    await navigate(`http://127.0.0.1:${port}/apps/sketchstudio/index.html`, 10000);
    await waitForApp('svgCanvas');
    await sleep(400);

    await evalJs(`document.getElementById('btn-recenter-view').click()`);   // the origin to the middle of the canvas (a phone starts with it off to the left)
    await sleep(300);
    // zoom out (real wheel events) until about 150 mm span the canvas width: Ø100 fits
    const centre = await evalJs(`(() => { const r = document.getElementById('svgCanvas').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    for (let i = 0; i < 40; i++) {
      const vw = await evalJs(`document.getElementById('svgCanvas').viewBox.baseVal.width`);
      if (vw >= 170) break;
      await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: Math.round(centre.x), y: Math.round(centre.y), deltaX: 0, deltaY: 120 });
      await sleep(25);
    }
    await sleep(150);
    // three concentric circles with typed diameters, all centred on the origin
    const origin = await w2s(0, 0);
    await pressRibbonTool(evalJs, tap, 'tool-circle');
    for (const d of ['100', '20', '70']) {
      await tap(origin);
      await waitFor(`!!document.querySelector('#dualInput input, #dimInput:not(.hidden), #singleInput input, .dim-input')`, 'the diameter box opened');
      await evalJs(`(() => { const el = document.querySelector('#dualInput input, #singleInput input, #dimInput:not(.hidden)'); if (el) { el.focus(); el.select && el.select(); } })()`);
      await send('Input.insertText', { text: d });
      await sleep(60);
      await sendRealKey(send, 'Enter', 'Enter', 13, 0, '\r');
      await sleep(250);
    }
    await sleep(300);
    await evalJs(`document.getElementById('btn-recenter-view').click()`);   // frame everything for the shots
    await sleep(400);
    const labels = await labelRects();
    await shot('concentric');
    assert.ok(labels.length >= 3, `[${label}] three diameter labels drawn (${JSON.stringify(labels.map((l) => l.text))})`);
    for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) {
      const a = labels[i], b = labels[j];
      const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
      assert.ok(!overlap, `[${label}] labels "${a.text}" and "${b.text}" do not overlap ${JSON.stringify([a, b])}`);
    }

    // a reference dimension (a second dimension on an already sized line is a reference): the `ref` badge stays one line
    await pressRibbonTool(evalJs, tap, 'tool-line');
    await tap(await w2s(62, -20));
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round((await w2s(80, -20)).x), y: Math.round((await w2s(80, -20)).y), button: 'none', clickCount: 0 });
    await sleep(120);
    await evalJs(`(() => { const el = document.querySelector('#dualInput input'); if (el) { el.focus(); el.select && el.select(); } })()`);
    await send('Input.insertText', { text: '20' });
    await sleep(60);
    await sendRealKey(send, 'Enter', 'Enter', 13, 0, String.fromCharCode(13));
    await sleep(250);
    await sendRealKey(send, 'Escape', 'Escape', 27, 0, '');
    await sleep(200);
    await pressRibbonTool(evalJs, tap, 'tool-dim');
    await tap(await w2s(72, -20));
    await tap(await w2s(72, -32));
    await shot('dimstep');
    if (isPhone) await evalJs(`(() => { const b = document.querySelector('.sk-done'); if (b && !b.hidden) b.click(); })()`);   // a phone has no Esc / Enter: the green check ends the placement
    else await sendRealKey(send, 'Escape', 'Escape', 27, 0, '');
    await sleep(250);
    await evalJs(`document.getElementById('btn-parameters').click()`);
    await waitFor(`!!document.querySelector('.sk-ptable')`, 'the Parameters window opened');
    await sleep(300);
    const badge = await evalJs(`(() => { const e = document.querySelector('.sk-ptable .pt-ref'); if (!e) return null; const r = e.getBoundingClientRect(); return { text: e.textContent.trim(), w: r.width, h: r.height }; })()`);
    await shot('params');
    assert.ok(badge, `[${label}] a reference row shows its badge: ${await evalJs("[...document.querySelectorAll('.sk-ptable tbody tr')].map((r) => r.textContent.trim()).join(' / ')")}`);
    assert.ok(badge.h < 26 && badge.w > badge.h, `[${label}] the ref badge is one line, not stacked letters: ${JSON.stringify(badge)}`);
    console.log(`[${label}] PASS ${JSON.stringify({ labels: labels.map((l) => l.text), badge })}`);
  } finally {
    await close();
  }
}

await run({ width: 1280, height: 800, tag: 'desktop' });
await run({ width: 390, height: 844, tag: 'phone' });
