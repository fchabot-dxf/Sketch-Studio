// tests/tp-close-779-live.test.js — TASK 779: template modal close button (X) stays visible and >= 44x44 on mobile
// (390x844 and short 390x640 visible viewport), keeps scrolling inside .sk-tp-body, leaves sk-tp-small / desktop 1440 unchanged.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';
import { resetBufferLive } from './helpers/reset-buffer.js';

const EVIDENCE_DIR = process.env.EVIDENCE_DIR || path.resolve('.evidence/779');
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

const cdp = await launchBrowser({ tag: '779-tp-close', width: 1440, height: 900 });
if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
const { port, send, evalJs, waitFor, waitForApp, navigate, close } = cdp;

try {
  const shot = async (name) => {
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    const file = path.join(EVIDENCE_DIR, name);
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
    console.log('screenshot ' + file);
  };
  const T = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i, radiusX: 1, radiusY: 1, force: 1 })) });
  const tapAt = async (x, y) => { await T('touchStart', [{ x, y }]); await sleep(35); await T('touchEnd', []); await sleep(220); };
  const clickAt = async (x, y) => {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', clickCount: 0 });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
    await sleep(35);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
    await sleep(220);
  };
  const tapEl = async (sel) => {
    const p = await evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    assert.ok(p, 'element present: ' + sel);
    await tapAt(p.x, p.y);
  };
  const clickEl = async (sel) => {
    const p = await evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    assert.ok(p, 'element present: ' + sel);
    await clickAt(p.x, p.y);
  };

  const inspectModal = () => evalJs(`(() => {
    const p = document.querySelector('.sk-tp-panel');
    const h = document.querySelector('.sk-tp-head');
    const x = document.querySelector('.sk-tp-x');
    const b = document.querySelector('.sk-tp-body');
    const pr = p ? p.getBoundingClientRect() : null;
    const hr = h ? h.getBoundingClientRect() : null;
    const xr = x ? x.getBoundingClientRect() : null;
    const cs = p ? getComputedStyle(p) : null;
    return {
      open: !!p,
      innerHeight, innerWidth,
      coarse: matchMedia('(pointer: coarse)').matches,
      tabs: document.querySelectorAll('.sk-doctab').length,
      panel: pr && { left: Math.round(pr.left), top: Math.round(pr.top), right: Math.round(pr.right), bottom: Math.round(pr.bottom), width: Math.round(pr.width), height: Math.round(pr.height), radius: cs.borderRadius },
      head: hr && { top: Math.round(hr.top), bottom: Math.round(hr.bottom), height: Math.round(hr.height) },
      x: xr && { left: Math.round(xr.left), top: Math.round(xr.top), right: Math.round(xr.right), bottom: Math.round(xr.bottom), width: Math.round(xr.width), height: Math.round(xr.height) },
      bodyScroll: b ? { scrollTop: Math.round(b.scrollTop), scrollHeight: Math.round(b.scrollHeight), clientHeight: Math.round(b.clientHeight) } : null,
    };
  })()`);

  const checkPhoneModal = async (label, shotPrefix) => {
    await waitFor(`!!document.querySelector('.sk-tp-panel .sk-tp-x')`, label + ': template modal open');
    const top = await inspectModal();
    assert.ok(top.coarse, label + ': pointer: coarse active');
    assert.ok(top.x && top.x.top >= 0 && top.x.bottom <= top.innerHeight, `${label}: X inside visible viewport (${JSON.stringify(top.x)} vs innerHeight=${top.innerHeight})`);
    assert.ok(top.x.width >= 44 && top.x.height >= 44, `${label}: X >= 44x44 (${top.x.width}x${top.x.height})`);
    assert.ok(top.panel.top >= 0 && top.panel.bottom <= top.innerHeight + 1, `${label}: panel fits visible viewport`);
    if (shotPrefix) await shot(`${shotPrefix}-top.png`);

    // Scroll grid to the bottom; head & X must remain visible at the top
    await evalJs(`(() => { const b = document.querySelector('.sk-tp-body'); b.scrollTop = b.scrollHeight; })()`);
    await sleep(100);
    const bot = await inspectModal();
    assert.ok(bot.bodyScroll.scrollHeight > bot.bodyScroll.clientHeight, `${label}: grid actually scrolled`);
    assert.ok(bot.bodyScroll.scrollTop > 0, `${label}: scrollTop > 0 after scroll`);
    assert.ok(bot.x.top >= 0 && bot.x.bottom <= bot.innerHeight, `${label}: X still inside visible viewport after scrolling to bottom`);
    if (shotPrefix) await shot(`${shotPrefix}-scrolled.png`);

    const tabsBefore = bot.tabs;
    await tapEl('.sk-tp-x');
    await waitFor(`!document.querySelector('.sk-tp-panel')`, label + ': tapping X closes modal');
    const tabsAfter = await evalJs(`document.querySelectorAll('.sk-doctab').length`);
    assert.strictEqual(tabsAfter, tabsBefore, `${label}: closing with X opens no new design`);
  };

  // ── 1. Phone 390 x 844 ──
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenOrientation: { type: 'portraitPrimary', angle: 0 } });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await resetBufferLive(cdp);
  await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html?analytics=off`, 10000);
  await waitForApp('design-canvas');
  await waitFor(`document.querySelectorAll('.sk-doctab-name').length === 1 && !!document.querySelector('.sk-doctab-new')`, 'phone 390x844 tab strip ready');

  // Open from "+" tab
  await tapEl('.sk-doctab-new');
  await checkPhoneModal('phone 390x844 (+)');

  // Open from New design in drawer menu
  await tapEl('.sk-sidebar-handle');
  await waitFor(`document.querySelector('.sk-sidebar').classList.contains('open')`, 'drawer open');
  await sleep(250);
  await tapEl('[data-action="new-design"]');
  await checkPhoneModal('phone 390x844 (New design)', 'phone-844');

  // ── 2. Short visible viewport 390 x 640 (innerHeight smaller than 844px screen) ──
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 640, screenWidth: 390, screenHeight: 844, deviceScaleFactor: 2, mobile: true, screenOrientation: { type: 'portraitPrimary', angle: 0 } });
  await sleep(150);
  await tapEl('.sk-doctab-new');
  await checkPhoneModal('phone short 390x640 (+)', 'phone-640');

  // Also check sk-tp-small (Save as file dialog) stays centered & compact on 390x640
  await tapEl('.sk-sidebar-handle');
  await waitFor(`document.querySelector('.sk-sidebar').classList.contains('open')`, 'drawer open for save-as');
  await sleep(250);
  await tapEl('[data-action="save-as"]');
  await waitFor(`!!document.querySelector('.sk-tp-panel.sk-tp-small')`, 'Save as small modal open');
  const small = await inspectModal();
  assert.ok(small.panel.height < small.innerHeight - 20 && small.panel.top > 0 && small.panel.radius === '10px', 'sk-tp-small keeps compact centered layout: ' + JSON.stringify(small.panel));
  await tapEl('.sk-tp-cancel');
  await waitFor(`!document.querySelector('.sk-tp-panel')`, 'Save as closed');

  // ── 3. Desktop 1440 x 900 unchanged ──
  await send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(200);
  await clickEl('.sk-doctab-new');
  await waitFor(`!!document.querySelector('.sk-tp-panel .sk-tp-x')`, 'desktop modal open');
  const desk = await inspectModal();
  assert.ok(desk.panel.width <= 1000 && desk.panel.height <= 720 && desk.panel.top > 20 && desk.panel.radius === '10px', 'desktop 1440 modal centered & unchanged: ' + JSON.stringify(desk.panel));
  assert.ok(desk.x.top >= 0 && desk.x.bottom <= desk.innerHeight, 'desktop X visible');
  await clickEl('.sk-tp-x');
  await waitFor(`!document.querySelector('.sk-tp-panel')`, 'desktop modal closed by X');

  console.log('tp-close-779-live: ok');
} finally {
  await close();
}
