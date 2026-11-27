// tests/arc-preview-1036-live.test.js — TASK 1036 (BUG-370, N-1), live headless SketchStudio, real mouse (desktop 1280 x 800) and real touch (phone 390 x 844):
// a Center Point Arc whose sweep crosses the left horizontal (the +-180 deg line of atan2): the dashed PREVIEW mid-sweep is the short 20 deg arc the
// commit then makes (same large / sweep flags, same end), not the 340 deg arc the other way. Screenshots of the preview to .evidence/1036/.
// The node twin with the 3-Point Arc and the arc slots: tests/shape-bugs-1036-node.test.js (N-1a..c).
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';
import { resetBufferLive } from './helpers/reset-buffer.js';

const WORKTREE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EVID_DIR = path.join(WORKTREE_ROOT, '.evidence', '1036');
const SHOT_TAG = process.env.SHOT_TAG || 'after';   // the evidence file names (the before shots were taken on the code before the fix)

await (async () => {
  const cdp = await launchBrowser({ tag: '1036-arcprev', width: 1280, height: 800 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, waitFor, waitForApp, navigate } = cdp;
  try {
    fs.mkdirSync(EVID_DIR, { recursive: true });
    const url = `http://127.0.0.1:${port}/apps/sketchstudio/index.html`;
    const mouse = (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', buttons: 0, clickCount: type === 'mouseMoved' ? 0 : 1, ...extra });
    const move = async (x, y) => { await mouse('mouseMoved', Math.round(x), Math.round(y)); await sleep(30); };
    const click = async (x, y) => { const rx = Math.round(x), ry = Math.round(y); await move(rx, ry); await mouse('mousePressed', rx, ry, { buttons: 1 }); await sleep(40); await mouse('mouseReleased', rx, ry); await sleep(180); };
    const touch = (type, x, y) => send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: Math.round(x), y: Math.round(y), id: 1, radiusX: 1, radiusY: 1, force: 1 }] });
    const tap = async (x, y) => { await touch('touchStart', x, y); await sleep(50); await touch('touchEnd'); await sleep(220); };
    const shot = async (file, clip) => {
      await sleep(150);
      const r = await send('Page.captureScreenshot', { format: 'png', clip: { ...clip, scale: 2 } });
      fs.writeFileSync(path.join(EVID_DIR, file), Buffer.from(r.data, 'base64'));
      console.log('  screenshot', path.join('.evidence', '1036', file));
    };
    const centre = () => evalJs(`(() => { const r = document.querySelector('#svgCanvas').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2 + 37), y: Math.round(r.top + r.height / 2 + 23) }; })()`);
    const flagsOf = (d) => { const m = /A\s*[-\d.e+]+[ ,]+[-\d.e+]+\s+0\s+([01])[ ,]+([01])/.exec(d || ''); return m ? [Number(m[1]), Number(m[2])] : null; };
    const previewD = () => evalJs(`(() => { const p = [...document.querySelectorAll('#svgCanvas path')].find((e) => e.getAttribute('stroke-dasharray') && / A /.test(e.getAttribute('d') || '')); return p ? p.getAttribute('d') : null; })()`);
    const committedD = () => evalJs(`(() => { const p = [...document.querySelectorAll('#svgCanvas path.shape-elem')].find((e) => / A /.test(e.getAttribute('d') || '')); return p ? p.getAttribute('d') : null; })()`);
    const pickArc = async (press) => {
      const hidden = await evalJs(`document.getElementById('tool-arc').hidden || document.getElementById('tool-arc').getBoundingClientRect().width === 0`);
      const rectOf = (sel) => evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { cx: Math.round(r.left + r.width / 2), cy: Math.round(r.top + r.height / 2) }; })()`);
      if (hidden) {
        const sec = await rectOf('.sk-ribbon-group[data-section="create"] .sk-ribbon-group-label');
        await press(sec.cx, sec.cy);
        await waitFor(`!!document.querySelector('.sk-ribbon-sect-menu.show')`, 'CREATE dropdown');
        const row = await rectOf('.sk-ribbon-sect-menu.show .sk-ribbon-sect-item[data-id="tool-arc"]');
        await press(row.cx, row.cy);
      } else {
        const b = await rectOf('#tool-arc');
        await press(b.cx, b.cy);
      }
      await waitFor(`!!document.querySelector('.sk-ribbon-menu.show [data-mode="arc-cse"]')`, 'the Arc variant menu');
      const row = await rectOf('.sk-ribbon-menu.show [data-mode="arc-cse"]');
      await press(row.cx, row.cy);
      await waitFor(`!document.querySelector('.sk-ribbon-menu.show') && document.getElementById('tool-arc').classList.contains('active')`, 'Center Point Arc active');
    };
    const R = 110;
    const onRim = (c, deg) => ({ x: c.x + R * Math.cos(deg * Math.PI / 180), y: c.y + R * Math.sin(deg * Math.PI / 180) });
    const clipAround = (c) => ({ x: Math.max(0, c.x - R - 50), y: Math.max(0, c.y - 80), width: R + 110, height: 160 });

    /** centre, start at 170 deg (screen), the sweep to 190 deg across the left horizontal; returns the preview flags and the committed arc's */
    async function drawAcross(label, { press, sweepTo, finish }) {
      const c = await centre();
      await press(c.x, c.y);
      const s = onRim(c, 170);
      await press(s.x, s.y);
      await sweepTo(c);
      const pd = await previewD();
      assert(pd, `${label}: a dashed arc preview is drawn mid-sweep`);
      await shot(`arc-preview-${label}-${SHOT_TAG}.png`, clipAround(c));
      await finish(c);
      await sleep(250);
      const cd = await committedD();
      assert(cd, `${label}: an arc is committed`);
      const pv = flagsOf(pd), cm = flagsOf(cd);
      console.log(`  ${label}: preview flags ${pv} (d ${pd.slice(0, 90)}...), committed flags ${cm}`);
      assert.deepStrictEqual(pv, cm, `${label}: the preview arc (large,sweep ${pv}) is the committed arc (${cm})`);
      assert.strictEqual(cm[0], 0, `${label}: the committed arc is the short 20 deg arc`);
    }

    // ── 1. desktop 1280 x 800, real mouse ──
    await resetBufferLive({ port, navigate, waitFor });
    await navigate(url);
    await waitForApp('svgCanvas');
    await waitFor(`!!document.querySelector('#tool-arc')`, 'ribbon #tool-arc');
    await pickArc(click);
    await drawAcross('desktop', {
      press: click,
      sweepTo: async (c) => { for (let d = 171; d <= 190; d++) { const p = onRim(c, d); await move(p.x, p.y); } },
      finish: async (c) => { const e = onRim(c, 190); await click(e.x, e.y); },
    });

    // ── 2. phone 390 x 844, real touch: the last finger drags the sweep across, lifting places the end ──
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenOrientation: { type: 'portraitPrimary', angle: 0 } });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await resetBufferLive({ port, navigate, waitFor });
    await navigate(url);
    await waitForApp('svgCanvas');
    await waitFor(`!!document.querySelector('#tool-arc')`, 'phone ribbon #tool-arc');
    await pickArc(tap);
    await drawAcross('phone', {
      press: tap,
      sweepTo: async (c) => {
        const s = onRim(c, 171);
        await touch('touchStart', s.x, s.y); await sleep(40);
        for (let d = 172; d <= 190; d++) { const p = onRim(c, d); await touch('touchMove', p.x, p.y); await sleep(25); }
        await sleep(100);
      },
      finish: async () => { await touch('touchEnd'); await sleep(250); },
    });
    console.log('arc-preview-1036-live: ALL CHECKS PASSED');
  } finally {
    await cdp.close();
  }
})();
