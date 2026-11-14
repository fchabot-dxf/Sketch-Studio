// tests/parameters-window-clamp-live.test.js — TASK 608 B: the Parameters window's remembered position is clamped as a WHOLE window (it used to
// keep only its header on screen, so a position remembered on a wider screen stuck out on the right of a narrow one).
// A position remembered at 1400 px (left 900, top 120, 420 x 300) -> opened at 700 px (a floating window) and at 390 px (the bottom sheet):
// fully inside the viewport; opened at 1400 px: the remembered position is kept exactly; a resize while open pulls it back inside.
import assert from 'node:assert';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';

const cdp = await launchBrowser({ tag: '608b', width: 1400, height: 900 });
if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
const { port, send, evalJs, navigate } = cdp;
try {
  const remembered = { left: 900, top: 120, w: 420, h: 300, tab: 0, dock: null };
  const rect = () => evalJs(`(() => { const e = document.querySelector('.sk-pwin'); const r = e.getBoundingClientRect(); return { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height), vw: innerWidth, vh: innerHeight, hidden: e.hidden }; })()`);
  const load = async (w, h, touch) => {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: touch });
    await send('Emulation.setTouchEmulationEnabled', { enabled: touch, maxTouchPoints: 5 });
    await navigate(`http://127.0.0.1:${port}/apps/sketchstudio/index.html`, 8000);
    await sleep(800);
  };
  const open = async () => { await evalJs(`document.getElementById('btn-parameters').click()`); await sleep(400); };
  const inside = (r, tag) => assert(r.l >= 0 && r.t >= 0 && r.r <= r.vw && r.b <= r.vh && !r.hidden, `${tag}: fully inside the viewport: ${JSON.stringify(r)}`);

  // desktop: remembered position kept
  await load(1400, 900, false);
  await evalJs(`localStorage.setItem('sk-parameters', ${JSON.stringify(JSON.stringify(remembered))})`);
  await navigate(`http://127.0.0.1:${port}/apps/sketchstudio/index.html`, 8000); await sleep(800);
  await open();
  let r = await rect(); inside(r, '1400');
  assert.deepStrictEqual([r.l, r.t, r.w, r.h], [900, 120, 420, 300], 'desktop: the remembered position and size are kept: ' + JSON.stringify(r));
  // a resize to a narrower window while it is open pulls it inside
  await send('Emulation.setDeviceMetricsOverride', { width: 800, height: 600, deviceScaleFactor: 1, mobile: false }); await sleep(400);
  r = await rect(); inside(r, '1400 -> 800 resize');
  assert.strictEqual(r.w, 420, 'it only moved (it fits): ' + JSON.stringify(r));
  await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });

  // narrower screens, the same remembered position
  for (const [w, h, touch] of [[700, 800, false], [390, 844, true], [780, 360, true]]) {
    await load(w, h, touch);
    await evalJs(`localStorage.setItem('sk-parameters', ${JSON.stringify(JSON.stringify(remembered))})`);
    await navigate(`http://127.0.0.1:${port}/apps/sketchstudio/index.html`, 8000); await sleep(800);
    await open();
    r = await rect(); inside(r, `${w}x${h}`);
    console.log(`  ${w}x${h}: ${JSON.stringify(r)}`);
  }
  // a window larger than the screen shrinks to fit
  await load(700, 400, false);
  await evalJs(`localStorage.setItem('sk-parameters', ${JSON.stringify(JSON.stringify({ ...remembered, left: 10, top: 10, w: 900, h: 700 }))})`);
  await navigate(`http://127.0.0.1:${port}/apps/sketchstudio/index.html`, 8000); await sleep(800);
  await open();
  r = await rect(); inside(r, '700x400 with a 900 x 700 window'); assert(r.w <= 700 && r.h <= 400, 'shrunk to fit: ' + JSON.stringify(r));
  console.log('parameters-window-clamp-live: ok');
} finally { await cdp.close(); }
