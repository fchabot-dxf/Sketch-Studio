// tests/addin-setup-859-live.test.js — TASK 859 (live desktop 1400x800 + phone 390x844):
// Builds a real release folder via D:/APPS/shaper-addin/make_release.py --out <tmp> and verifies:
//   1. Site built WITH setup: installer link ("Download installer (Windows)") is first, fetches 200 with exact json.setup_bytes,
//      installer steps + "Mac, or manual install:" + zip link + zip steps below, everything inside drawer / no horizontal scroll.
//   2. Site built WITHOUT setup (zip only): shows today's zip-only view (no installer link / steps).
//   3. Cropped drawer screenshots saved to .evidence/859/.
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { launchBrowser, startServer, sleep } from './helpers/cdp-browser.js';
import { ADDIN_INSTALL_STEPS, ADDIN_SETUP_STEPS } from '../apps/shaper/src/addin-download.js';

const require = createRequire(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { buildSite } = require('../scripts/build-site.cjs');
const EVIDENCE = path.join(REPO_ROOT, '.evidence', '859');
fs.mkdirSync(EVIDENCE, { recursive: true });

await (async () => {
  const cdp = await launchBrowser({ tag: '859', width: 1400, height: 800, server: false });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { send, evalJs, waitFor, navigate, waitForApp } = cdp;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'addin-859-live-'));
  const servers = [];
  const T = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i, radiusX: 1, radiusY: 1, force: 1 })) });
  const touch = async (x, y) => { await T('touchStart', [{ x, y }]); await sleep(40); await T('touchEnd', []); await sleep(400); };
  const mouse = async (x, y) => {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', clickCount: 0 }); await sleep(30);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 }); await sleep(30);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 }); await sleep(400);
  };
  let pointer = mouse;
  const press = async (sel, what) => {
    const p = await evalJs(`(() => { const e = document.querySelector('${sel}'); if (!e) return null; const r = e.getBoundingClientRect(); const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2); const h = document.elementFromPoint(x, y); return { x, y, hit: !!h && (h === e || e.contains(h)) }; })()`);
    assert(p && p.hit, `${what}: ${sel} clickable`);
    await pointer(p.x, p.y);
  };
  const shot = async (name, clip) => {
    const s = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 2 } } : {}) });
    fs.writeFileSync(path.join(EVIDENCE, name), Buffer.from(s.data, 'base64'));
  };
  const drawerClip = () => evalJs(`(() => { const d = document.querySelector('.sk-sidebar').getBoundingClientRect(); return { x: 0, y: 0, width: Math.round(d.right), height: Math.min(innerHeight, 800) }; })()`);
  const viewState = () => evalJs(`(() => {
    const d = document.querySelector('.sk-sidebar').getBoundingClientRect();
    const v = document.querySelector('.sk-sidebar [data-addin="view"]');
    const links = [...document.querySelectorAll('.sk-sidebar [data-addin="view"] a.sk-sidebar-item')].map((a) => ({
      addin: a.dataset.addin, href: a.href, text: a.textContent.trim(), download: a.getAttribute('download'), h: Math.round(a.getBoundingClientRect().height),
    }));
    const parts = [...document.querySelectorAll('.sk-sidebar [data-addin="view"] *')].filter((e) => e.getClientRects().length);
    const outside = parts.filter((e) => { const r = e.getBoundingClientRect(); return r.left < d.left - 0.5 || r.right > d.right + 0.5 || r.right > innerWidth + 0.5; }).map((e) => e.className || e.tagName);
    return {
      vw: innerWidth,
      drawer: { left: Math.round(d.left), right: Math.round(d.right) },
      viewScroll: v ? { sw: v.scrollWidth, cw: v.clientWidth } : null,
      docScroll: document.documentElement.scrollWidth,
      links,
      setupSteps: [...document.querySelectorAll('.sk-sidebar [data-addin="setup-steps"] li .txt')].map((e) => e.textContent),
      zipSteps: [...document.querySelectorAll('.sk-sidebar [data-addin="steps"] li .txt')].map((e) => e.textContent),
      outside,
    };
  })()`);

  try {
    // Make real release folder via shaper-addin/make_release.py
    const relWithSetup = path.join(tmp, 'rel-with-setup');
    execFileSync('python', ['D:/APPS/shaper-addin/make_release.py', '--out', relWithSetup], { stdio: 'inherit' });
    const meta = JSON.parse(fs.readFileSync(path.join(relWithSetup, 'shaper-addin.json'), 'utf8'));
    assert.ok(meta.setup === 'shaper-addin-setup.exe' && meta.setup_bytes > 0, 'real release contains setup exe');

    // Also make a zip-only copy of the same release (no setup fields)
    const relZipOnly = path.join(tmp, 'rel-zip-only');
    fs.mkdirSync(relZipOnly);
    fs.copyFileSync(path.join(relWithSetup, 'shaper-addin.zip'), path.join(relZipOnly, 'shaper-addin.zip'));
    const { setup, setup_bytes, setup_sha256, ...zipOnlyMeta } = meta;
    fs.writeFileSync(path.join(relZipOnly, 'shaper-addin.json'), JSON.stringify(zipOnlyMeta));

    buildSite('shaper', path.join(tmp, 'site-with'), { addin: relWithSetup });
    buildSite('shaper', path.join(tmp, 'site-zip'), { addin: relZipOnly });
    const srvWith = await startServer(path.join(tmp, 'site-with')); servers.push(srvWith.server);
    const srvZip = await startServer(path.join(tmp, 'site-zip')); servers.push(srvZip.server);
    const withUrl = `http://127.0.0.1:${srvWith.port}/`;
    const zipUrl = `http://127.0.0.1:${srvZip.port}/`;

    // 1. Desktop with setup
    await navigate(withUrl, 15000);
    await waitForApp('design-canvas');
    await press('.sk-sidebar-btn', 'desktop: menu button');
    await waitFor(`document.querySelector('.sk-sidebar').classList.contains('open')`, 'desktop: drawer open'); await sleep(250);
    await press('.sk-sidebar [data-action="fusion-addin"]', 'desktop: Fusion add-in');
    await waitFor(`!!document.querySelector('.sk-sidebar a[data-addin="setup"]')`, 'desktop: installer link rendered');
    const d = await viewState();
    assert.strictEqual(d.links.length, 2, 'desktop: two download links');
    assert.strictEqual(d.links[0].addin, 'setup', 'desktop: installer link is first');
    assert.strictEqual(d.links[0].text, 'Download installer (Windows)');
    assert.strictEqual(d.links[0].href, `${withUrl}downloads/shaper-addin-setup.exe`);
    assert.strictEqual(d.links[1].addin, 'download', 'desktop: zip link is second');
    assert.strictEqual(d.links[1].text, 'Download (.zip)');
    assert.deepStrictEqual(d.setupSteps, ADDIN_SETUP_STEPS, 'desktop: installer steps');
    assert.deepStrictEqual(d.zipSteps, ADDIN_INSTALL_STEPS, 'desktop: zip steps');
    assert.deepStrictEqual(d.outside, [], 'desktop: nothing overflows drawer');
    const fetchedExe = await evalJs(`fetch(${JSON.stringify(d.links[0].href)}).then(async (r) => ({ status: r.status, bytes: (await r.arrayBuffer()).byteLength }))`);
    assert.deepStrictEqual(fetchedExe, { status: 200, bytes: meta.setup_bytes }, 'desktop: setup exe downloads exact json setup_bytes');
    await shot('desktop-with-setup.png', await drawerClip());

    // 2. Desktop without setup (zip-only release) -> today's view
    await navigate(zipUrl, 15000);
    await waitForApp('design-canvas');
    await press('.sk-sidebar-btn', 'zip-only: menu button');
    await waitFor(`document.querySelector('.sk-sidebar').classList.contains('open')`, 'zip-only: drawer open'); await sleep(250);
    await press('.sk-sidebar [data-action="fusion-addin"]', 'zip-only: Fusion add-in');
    await waitFor(`!!document.querySelector('.sk-sidebar a[data-addin="download"]')`, 'zip-only: zip link rendered');
    const z = await viewState();
    assert.strictEqual(z.links.length, 1, 'zip-only: only zip link');
    assert.strictEqual(z.links[0].addin, 'download');
    assert.deepStrictEqual(z.setupSteps, [], 'zip-only: no installer steps');
    assert.deepStrictEqual(z.zipSteps, ADDIN_INSTALL_STEPS, 'zip-only: zip steps shown');
    await shot('desktop-zip-only.png', await drawerClip());

    // 3. Phone 390x844 with setup
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenOrientation: { type: 'portraitPrimary', angle: 0 } });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    pointer = touch;
    await navigate(withUrl, 15000);
    await waitForApp('design-canvas');
    await press('.sk-sidebar-chevron', 'phone: drawer handle');
    await waitFor(`document.querySelector('.sk-sidebar').classList.contains('open')`, 'phone: drawer open'); await sleep(250);
    await evalJs(`document.querySelector('.sk-sidebar [data-action="fusion-addin"]').scrollIntoView({ block: 'nearest' })`); await sleep(150);
    await press('.sk-sidebar [data-action="fusion-addin"]', 'phone: Fusion add-in');
    await waitFor(`!!document.querySelector('.sk-sidebar a[data-addin="setup"]')`, 'phone: installer link rendered');
    const p = await viewState();
    assert.strictEqual(p.vw, 390);
    assert.ok(p.drawer.left >= 0 && p.drawer.right <= 390, 'phone: drawer inside 390px');
    assert.ok(p.viewScroll.sw <= p.viewScroll.cw && p.docScroll <= 390, 'phone: no horizontal scroll');
    assert.deepStrictEqual(p.outside, [], 'phone: nothing overflows drawer');
    assert.strictEqual(p.links[0].addin, 'setup');
    assert.strictEqual(p.links[1].addin, 'download');
    await shot('phone-390-with-setup.png', await drawerClip());

    console.log(`addin-setup-859-live: ok (setup_bytes=${meta.setup_bytes})`);
  } finally {
    await cdp.close();
    for (const s of servers) s.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})();
