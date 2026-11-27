// tests/drawbox-fix-1028-live.test.js — TASK 1028: the draw-box fixes a browser alone shows (real CDP mouse / touch / key events in SketchStudio).
//   B-05 (desktop 1280x800): Line, a typed length 40, then a RIGHT-click on the canvas: ONE segment of 40 and the chain finished (the boxes close).
//   B-15 (desktop 1280x800 + phone 390x844): Tab inside a one-field box (the circle's diameter) keeps the focus in the box: the next Enter places the circle,
//        it never presses a page button.
// Evidence: .evidence/1028/<name>-<tag>.png
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sleep, sendRealKey } from './helpers/cdp-browser.js';
import { installFakeDriveSession } from './helpers/fake-drive-session.js';
import { resetBufferLive } from './helpers/reset-buffer.js';
import { pressRibbonTool } from './helpers/ribbon-tool.js';

const EVIDENCE_DIR = path.resolve('.evidence/1028');
const failures = [];
/** every check runs (a failure is collected and named), so one run shows each bug's state */
const check = (ok, msg) => { if (!ok) { failures.push(msg); console.log('  FAIL ' + msg); } else console.log('  ok ' + msg); };
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

async function run({ width, height, tag }) {
  const label = `${width}x${height}`;
  const isPhone = width <= 640;
  const cdp = await launchBrowser({ tag: `1028-${tag}`, width, height });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
  const { port, send, evalJs, waitFor, waitForApp, navigate, close } = cdp;
  const mouse = async (type, p, button = 'left') => send('Input.dispatchMouseEvent', { type, x: Math.round(p.x), y: Math.round(p.y), button: type === 'mouseMoved' ? 'none' : button, buttons: type === 'mousePressed' ? (button === 'right' ? 2 : 1) : 0, clickCount: type === 'mouseMoved' ? 0 : 1 });
  const tap = async (p) => {
    const x = Math.round(p.x), y = Math.round(p.y);
    if (isPhone) {
      await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1, radiusX: 1, radiusY: 1, force: 1 }] });
      await sleep(60);
      await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await mouse('mouseMoved', p); await sleep(50);
      await mouse('mousePressed', p); await sleep(40);
      await mouse('mouseReleased', p);
    }
    await sleep(200);
  };
  const move = async (p) => { if (!isPhone) { await mouse('mouseMoved', p); await sleep(120); } };
  const w2s = (wx, wy) => evalJs(`(() => { const svg = document.getElementById('svgCanvas'); const pt = svg.createSVGPoint(); pt.x = ${wx}; pt.y = ${wy}; const p = pt.matrixTransform(svg.getScreenCTM()); return { x: p.x, y: p.y }; })()`);
  const shot = async (name) => {
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(EVIDENCE_DIR, `${name}-${tag}.png`), Buffer.from(data, 'base64'));
  };
  const lines = () => evalJs(`[...document.querySelectorAll('#svgCanvas line.shape-elem[data-shape-id]')].map((e) => Math.hypot(e.x2.baseVal.value - e.x1.baseVal.value, e.y2.baseVal.value - e.y1.baseVal.value))`);
  const circles = () => evalJs(`[...document.querySelectorAll('#svgCanvas circle.shape-elem[data-shape-id]')].map((e) => e.r.baseVal.value)`);
  const shownBox = (sel) => evalJs(`(() => { const e = document.querySelector('${sel}'); return !!e && !e.classList.contains('hidden') && getComputedStyle(e).display !== 'none'; })()`);
  const focusId = () => evalJs(`(() => { const a = document.activeElement; return a ? (a.id || a.tagName + (a.className ? '.' + String(a.className).split(' ')[0] : '')) : null; })()`);

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
    await evalJs(`document.getElementById('btn-recenter-view').click()`);
    await sleep(300);

    if (!isPhone) {
      // ── B-05: typed length + right-click = one segment, chain finished ──
      await pressRibbonTool(evalJs, tap, 'tool-line');
      await tap(await w2s(-30, 10));
      await move(await w2s(10, -15));
      await waitFor(`!!document.querySelector('#dualInput input')`, 'the line boxes opened');
      await evalJs(`(() => { const el = document.querySelector('#dualInput input'); el.focus(); el.select(); })()`);
      await send('Input.insertText', { text: '40' });
      await sleep(80);
      const rc = await w2s(12, -16);
      await mouse('mouseMoved', rc); await sleep(60);
      await mouse('mousePressed', rc, 'right'); await sleep(40);
      await mouse('mouseReleased', rc, 'right'); await sleep(300);
      const ls = await lines();
      await shot('B05-rightclick');
      check(ls.length === 1, `[${label}] B-05: one segment after the right-click (${JSON.stringify(ls)})`);
      check(Math.abs(ls[0] - 40) < 1e-3, `[${label}] B-05: the segment is the typed 40 (${ls[0]})`);
      check(!(await shownBox('#dualInput')), `[${label}] B-05: the chain finished (the boxes closed)`);
      await sendRealKey(send, 'Escape', 'Escape', 27, 0, '');
      await sleep(200);
    }

    // ── B-15: Tab in the circle's one-field box keeps the focus in the box ──
    await pressRibbonTool(evalJs, tap, 'tool-circle');
    await tap(await w2s(20, 20));
    await waitFor(`(() => { const e = document.getElementById('dimInput'); return !!e && !e.classList.contains('hidden'); })()`, 'the diameter box opened');
    if (isPhone) await tap(await evalJs(`(() => { const r = document.getElementById('dimInput').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`));   // a finger taps the box to focus it
    else await move(await w2s(30, 20));
    await evalJs(`(() => { const el = document.getElementById('dimInput'); if (document.activeElement !== el) el.focus(); el.select(); })()`);
    await send('Input.insertText', { text: '16' });
    await sleep(60);
    await sendRealKey(send, 'Tab', 'Tab', 9, 0, '');
    await sleep(150);
    const afterTab = await focusId();
    await shot('B15-tab');
    check(afterTab === 'dimInput', `[${label}] B-15: the focus stays in the diameter box after Tab (focus: ${afterTab})`);
    await send('Input.insertText', { text: '12' });   // Tab selected the text: this replaces it
    await sleep(60);
    await sendRealKey(send, 'Enter', 'Enter', 13, 0, '\r');
    await sleep(300);
    const cs = await circles();
    check(cs.length === 1, `[${label}] B-15: Enter placed the circle (${JSON.stringify(cs)})`);
    check(Math.abs(cs[0] - 6) < 1e-3, `[${label}] B-15: of the typed diameter 12 (r ${cs[0]})`);
    console.log(`[${label}] done ${JSON.stringify({ afterTab, circles: cs })}`);
  } finally {
    await close();
  }
}

await run({ width: 1280, height: 800, tag: 'desktop' });
await run({ width: 390, height: 844, tag: 'phone' });
assert.deepStrictEqual(failures, [], `${failures.length} check(s) failed`);
console.log('drawbox-fix-1028-live: PASS');
