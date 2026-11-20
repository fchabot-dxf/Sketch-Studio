// tests/addin-download-733-live.test.js — TASK 733 (live): the Shaper sidebar's "Fusion add-in" entry on a BUILT Shaper site.
// Two sites built here with scripts/build-site.cjs: one with --addin <a FIXTURE release made here (not the real add-in)>, one without. Each served by
// a static server on its own dist (its own origin, as the Shaper website is), the app in headless Edge:
//   desktop 1400 x 800: open the drawer, press "Fusion add-in" -> the view: the "Download (.zip)" link's href answers 200 with the fixture's bytes,
//     the version shows, the install steps show;
//   phone 390 x 844 (touch): the drawer handle, the same entry and view; everything inside the 390 px screen, no sideways scroll;
//   the site built without --addin: the view says the download is not available in this build (no link);
//   Fusion mode (?host=fusion): no "Fusion add-in" entry in the drawer.
// EVIDENCE_DIR (optional): screenshots of each.
import assert from 'node:assert';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { launchBrowser, startServer, sleep } from './helpers/cdp-browser.js';
import { ADDIN_INSTALL_STEPS, ADDIN_UNAVAILABLE } from '../apps/shaper/src/addin-download.js';

const require = createRequire(import.meta.url);
const { buildSite } = require('../scripts/build-site.cjs');

await (async () => {
  const cdp = await launchBrowser({ tag: '733', width: 1400, height: 800, server: false });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { send, evalJs, waitFor, navigate, waitForApp } = cdp;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'addin-733-live-'));
  const servers = [];
  const T = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i, radiusX: 1, radiusY: 1, force: 1 })) });
  const touch = async (x, y) => { await T('touchStart', [{ x, y }]); await sleep(40); await T('touchEnd', []); await sleep(400); };
  const mouse = async (x, y) => {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', clickCount: 0 }); await sleep(30);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 }); await sleep(30);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 }); await sleep(400);
  };
  let pointer = mouse;
  // presses the element's centre after checking it is what a user would hit there
  const press = async (sel, what) => {
    const p = await evalJs(`(() => { const e = document.querySelector('${sel}'); if (!e) return null; const r = e.getBoundingClientRect(); const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2); const h = document.elementFromPoint(x, y); return { x, y, hit: !!h && (h === e || e.contains(h)) }; })()`);
    assert(p, what + ': ' + sel + ' not found');
    assert(p.hit, what + ': ' + sel + ' is covered at its centre ' + JSON.stringify(p));
    await pointer(p.x, p.y);
  };
  const shot = async (name, clip) => {
    if (!process.env.EVIDENCE_DIR) return;
    const s = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 2 } } : {}) });
    fs.writeFileSync(path.join(process.env.EVIDENCE_DIR, name), Buffer.from(s.data, 'base64'));
  };
  const actions = () => evalJs(`[...document.querySelectorAll('.sk-sidebar [data-section="actions"] [data-action]')].map((b) => b.dataset.action)`);
  // the view on screen: its parts, and whether everything sits inside the drawer and the screen
  const viewState = () => evalJs(`(() => {
    const d = document.querySelector('.sk-sidebar').getBoundingClientRect();
    const v = document.querySelector('.sk-sidebar [data-addin="view"]');
    const a = document.querySelector('.sk-sidebar a[data-addin="download"]');
    const parts = [...document.querySelectorAll('.sk-sidebar [data-addin="view"] *')].filter((e) => e.getClientRects().length);
    const outside = parts.filter((e) => { const r = e.getBoundingClientRect(); return r.left < d.left - 0.5 || r.right > d.right + 0.5 || r.right > innerWidth + 0.5; }).map((e) => e.className || e.tagName);
    return {
      title: (document.querySelector('.sk-sidebar-viewhead') || {}).textContent,
      drawer: { left: Math.round(d.left), right: Math.round(d.right), w: Math.round(d.width) }, vw: innerWidth,
      viewScroll: v ? { sw: v.scrollWidth, cw: v.clientWidth } : null, docScroll: document.documentElement.scrollWidth,
      href: a ? a.href : null, linkText: a ? a.textContent.trim() : null, linkShown: !!a && a.getBoundingClientRect().height > 0,
      version: (document.querySelector('.sk-sidebar [data-addin="version"]') || {}).textContent || null,
      unavailable: (document.querySelector('.sk-sidebar [data-addin="unavailable"]') || {}).textContent || null,
      steps: [...document.querySelectorAll('.sk-sidebar [data-addin="steps"] li .txt')].map((e) => e.textContent),
      stepsShown: [...document.querySelectorAll('.sk-sidebar [data-addin="steps"] li')].every((e) => { const r = e.getBoundingClientRect(); return r.height > 0 && r.bottom <= innerHeight; }),
      outside,
    };
  })()`);
  const drawerClip = async () => { const r = await evalJs(`(() => { const d = document.querySelector('.sk-sidebar').getBoundingClientRect(); return { x: 0, y: 0, width: Math.round(d.right), height: Math.min(innerHeight, 620) }; })()`); return r; };

  try {
    // ---- the fixture release and the two sites
    const rel = path.join(tmp, 'release');
    fs.mkdirSync(rel);
    const zipBytes = Buffer.from('PK\u0003\u0004 TASK 733 live fixture zip (not the add-in)');
    fs.writeFileSync(path.join(rel, 'shaper-addin.zip'), zipBytes);
    fs.writeFileSync(path.join(rel, 'shaper-addin.json'), JSON.stringify({ id: 'shaper-addin', version: '7.3.3', zip: 'shaper-addin.zip', bytes: zipBytes.length, sha256: crypto.createHash('sha256').update(zipBytes).digest('hex'), files: [] }));
    buildSite('shaper', path.join(tmp, 'with'), { addin: rel });
    buildSite('shaper', path.join(tmp, 'without'));
    const withSrv = await startServer(path.join(tmp, 'with')); servers.push(withSrv.server);
    const withoutSrv = await startServer(path.join(tmp, 'without')); servers.push(withoutSrv.server);
    const withUrl = `http://127.0.0.1:${withSrv.port}/`; // TASK 763: the app at its site's root
    const withoutUrl = `http://127.0.0.1:${withoutSrv.port}/`;

    // ---- desktop, the site with the add-in
    await navigate(withUrl, 15000);
    await waitForApp('design-canvas');
    await press('.sk-sidebar-btn', 'desktop: the menu button');
    await waitFor(`document.querySelector('.sk-sidebar').classList.contains('open')`, 'desktop: the drawer opens'); await sleep(300);
    const desktopActs = await actions();
    assert.ok(desktopActs.includes('fusion-addin'), 'desktop: the drawer lists "Fusion add-in": ' + desktopActs.join(','));
    assert.strictEqual(await evalJs(`document.querySelector('.sk-sidebar [data-action="fusion-addin"]').textContent.trim()`), 'Fusion add-in');
    await shot('desktop-drawer-entry.png', await drawerClip());
    await press('.sk-sidebar [data-action="fusion-addin"]', 'desktop: Fusion add-in');
    await waitFor(`!!document.querySelector('.sk-sidebar a[data-addin="download"]')`, 'desktop: the view shows the download link');
    const d = await viewState();
    assert.strictEqual(d.title.trim(), '←Fusion add-in', 'desktop: the view title');
    assert.strictEqual(d.href, `${withUrl}downloads/shaper-addin.zip`, 'desktop: the link is the site file');
    assert.strictEqual(d.linkText, 'Download (.zip)');
    assert.ok(d.linkShown, 'desktop: the link is on screen');
    assert.match(d.version, /^Version 7\.3\.3 · 1 KB$/, 'desktop: the version from the json');
    assert.deepStrictEqual(d.steps, ADDIN_INSTALL_STEPS, 'desktop: the install steps');
    assert.ok(d.stepsShown, 'desktop: every step is on screen');
    assert.deepStrictEqual(d.outside, [], 'desktop: nothing sticks out of the drawer');
    const got = await evalJs(`fetch(${JSON.stringify(d.href)}).then(async (r) => ({ status: r.status, bytes: (await r.arrayBuffer()).byteLength }))`);
    assert.deepStrictEqual(got, { status: 200, bytes: zipBytes.length }, 'desktop: the link resolves (200, the fixture zip)');
    await shot('desktop-addin-view.png', await drawerClip());
    console.log(`desktop: view ${JSON.stringify({ href: d.href, version: d.version, steps: d.steps.length, fetch: got })}`);

    // ---- desktop, the site without --addin: the message, no link
    await navigate(withoutUrl, 15000);
    await waitForApp('design-canvas');
    await press('.sk-sidebar-btn', 'no-addin: the menu button');
    await waitFor(`document.querySelector('.sk-sidebar').classList.contains('open')`, 'no-addin: the drawer opens'); await sleep(300);
    await press('.sk-sidebar [data-action="fusion-addin"]', 'no-addin: Fusion add-in');
    await waitFor(`!!document.querySelector('.sk-sidebar [data-addin="unavailable"]')`, 'no-addin: the view says not available');
    const n = await viewState();
    assert.strictEqual(n.unavailable, ADDIN_UNAVAILABLE, 'no-addin: "not available in this build"');
    assert.strictEqual(n.href, null, 'no-addin: no link');
    assert.deepStrictEqual(n.steps, ADDIN_INSTALL_STEPS, 'no-addin: the steps still show');
    await shot('desktop-no-addin-build.png', await drawerClip());
    console.log(`no --addin: ${JSON.stringify(n.unavailable)}`);

    // ---- Fusion mode: no entry
    await navigate(`${withUrl}index.html?host=fusion`, 15000);
    await waitForApp('design-canvas');
    await press('.sk-sidebar-btn', 'fusion: the menu button');
    await waitFor(`document.querySelector('.sk-sidebar').classList.contains('open')`, 'fusion: the drawer opens'); await sleep(300);
    const fusionActs = await actions();
    assert.deepStrictEqual(fusionActs, ['download', 'settings', 'log', 'feedback'], 'Fusion mode: no "Fusion add-in" entry');
    assert.strictEqual(await evalJs(`document.querySelectorAll('[data-action="fusion-addin"]').length`), 0, 'Fusion mode: nowhere in the page');
    await shot('fusion-mode-no-entry.png', await drawerClip());
    console.log(`fusion mode: drawer actions ${fusionActs.join(', ')}`);

    // ---- phone 390 x 844, touch: the drawer handle, the entry, the view inside the screen
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenOrientation: { type: 'portraitPrimary', angle: 0 } });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    pointer = touch;
    await navigate(withUrl, 15000);
    await waitForApp('design-canvas');
    await press('.sk-sidebar-chevron', 'phone: the drawer handle');
    await waitFor(`document.querySelector('.sk-sidebar').classList.contains('open')`, 'phone: the drawer opens'); await sleep(300);
    await evalJs(`document.querySelector('.sk-sidebar [data-action="fusion-addin"]').scrollIntoView({ block: 'nearest' })`); await sleep(150);
    await press('.sk-sidebar [data-action="fusion-addin"]', 'phone: Fusion add-in');
    await waitFor(`!!document.querySelector('.sk-sidebar a[data-addin="download"]')`, 'phone: the view shows the download link');
    const p = await viewState();
    assert.strictEqual(p.vw, 390, 'phone: 390 px wide');
    assert.ok(p.drawer.left >= 0 && p.drawer.right <= 390, 'phone: the drawer is inside the screen ' + JSON.stringify(p.drawer));
    assert.ok(p.viewScroll.sw <= p.viewScroll.cw, 'phone: the view does not scroll sideways ' + JSON.stringify(p.viewScroll));
    assert.ok(p.docScroll <= 390, 'phone: the page does not scroll sideways (' + p.docScroll + ')');
    assert.deepStrictEqual(p.outside, [], 'phone: nothing sticks out of the drawer or the screen');
    assert.ok(p.linkShown, 'phone: the link is on screen');
    assert.deepStrictEqual(p.steps, ADDIN_INSTALL_STEPS, 'phone: the install steps');
    assert.ok(p.stepsShown, 'phone: every step is on screen');
    const pGot = await evalJs(`fetch(${JSON.stringify(p.href)}).then((r) => r.status)`);
    assert.strictEqual(pGot, 200, 'phone: the link resolves');
    await shot('phone-390-addin-view.png');
    console.log(`phone 390: drawer ${JSON.stringify(p.drawer)}, view scroll ${JSON.stringify(p.viewScroll)}, page ${p.docScroll}px, link ${pGot}`);

    console.log('addin-download-733-live: Shaper sidebar Fusion add-in entry, view, download (desktop + phone 390), no-addin message, Fusion mode hidden');
  } finally {
    await cdp.close();
    for (const s of servers) s.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})();
