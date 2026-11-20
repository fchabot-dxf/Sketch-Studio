// tests/site-identity-829-live.test.js — TASK 829 (live): each app opened from ITS OWN built site (as site-dist-live.test.js does) in headless Edge.
//   * the tab's favicon is the new icon: the built page's <link rel="icon"> is favicon.svg (static, before JS), it loads as a 64 x 64 image, its text is the registry's icon,
//     and the JS favicon setter left it alone (one declaration, same file); the apple-touch-icon / manifest / og:image URLs load (200, the right image size);
//   * the intro (<h1> + the description) is in the static page and visible with JavaScript OFF, and takes up NO room: with scripts disabled, every other element of the
//     page keeps its box when the intro is hidden (the 805 layout probe's idea: boxes before / after, 0 px); once the app has started the intro is gone;
//   * no console error / page exception while the app loads.
// Evidence (.evidence/829/): per app the desktop (1280 x 800) and phone (390 x 844) screenshots, a "tab strip" sheet of the favicon at 16 / 32 px beside the app's title
// on a light and a dark strip, and the og card rendered from the built site.
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { launchBrowser, startServer, sleep } from './helpers/cdp-browser.js';
import { APPS, SEO_INTRO_ID, appTitle } from '../packages/ui/app-registry.js';

const require = createRequire(import.meta.url);
const { buildSite } = require('../scripts/build-site.cjs');
const CANVAS = { sketchstudio: 'svgCanvas', shaper: 'design-canvas', penplotter: 'design-canvas', trace: 'design-canvas' };
const EVIDENCE = path.resolve('.evidence/829');
fs.mkdirSync(EVIDENCE, { recursive: true });

await (async () => {
  const cdp = await launchBrowser({ tag: '829', width: 1280, height: 800, server: false });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { send, ws, evalJs, navigate, waitForApp } = cdp;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'site-identity-829-'));
  const servers = [];
  const problems = [];
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.method === 'Runtime.exceptionThrown') problems.push('exception: ' + JSON.stringify(m.params.exceptionDetails).slice(0, 300));
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') problems.push('console.error: ' + JSON.stringify(m.params.args.map((a) => a.value ?? a.description)).slice(0, 300));
  });
  const shot = async (file) => fs.writeFileSync(path.join(EVIDENCE, file), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  const boxes = () => evalJs(`JSON.stringify([...document.body.querySelectorAll('*')].filter((e) => !e.closest('#${SEO_INTRO_ID}')).map((e) => { const r = e.getBoundingClientRect(); return [e.tagName, Math.round(r.x * 100) / 100, Math.round(r.y * 100) / 100, Math.round(r.width * 100) / 100, Math.round(r.height * 100) / 100]; }))`);
  try {
    await send('Runtime.enable');
    await send('Page.enable');
    for (const app of APPS) {
      const out = path.join(tmp, app.id);
      buildSite(app.id, out);
      const srv = await startServer(out);
      servers.push(srv.server);
      const origin = `http://127.0.0.1:${srv.port}`;

      // ---- JavaScript OFF: the static page, the intro, no room taken ----
      await send('Emulation.setScriptExecutionDisabled', { value: true });
      await navigate(`${origin}/`, 15000);
      const intro = JSON.parse(await evalJs(`(() => { const d = document.getElementById('${SEO_INTRO_ID}'); if (!d) return JSON.stringify(null); const r = d.getBoundingClientRect(); return JSON.stringify({ h1: d.querySelector('h1').textContent, p: d.querySelector('p').textContent, position: getComputedStyle(d).position, w: r.width, h: r.height }); })()`));
      assert.ok(intro, `${app.id}: the intro is in the static page (no JavaScript ran)`);
      assert.strictEqual(intro.position, 'fixed', `${app.id}: the intro is out of flow`);
      assert.ok(intro.w > 100 && intro.h > 20, `${app.id}: the intro is visible without JavaScript (${intro.w} x ${intro.h})`);
      assert.ok(intro.h1 === app.seoTitle && intro.p === app.description, `${app.id}: the intro is the seoTitle and description`);
      assert.strictEqual(await evalJs(`document.title`), app.seoTitle, `${app.id}: the static page's <title> is the seoTitle (before the app runs)`);
      const withIntro = await boxes();
      await evalJs(`document.getElementById('${SEO_INTRO_ID}').style.display = 'none'`);
      const without = await boxes();
      assert.strictEqual(withIntro, without, `${app.id}: every other box of the page is where it was with the intro shown (0 px shift)`);
      await send('Emulation.setScriptExecutionDisabled', { value: false });

      // ---- the app starts ----
      await navigate(`${origin}/`, 15000);
      await waitForApp(CANVAS[app.id]);
      await sleep(800);
      assert.strictEqual(await evalJs(`document.getElementById('${SEO_INTRO_ID}')`), null, `${app.id}: the app removed the intro as it started`);
      assert.strictEqual(await evalJs(`document.title`), appTitle(app.id), `${app.id}: tab title`);
      const icons = JSON.parse(await evalJs(`JSON.stringify([...document.querySelectorAll('link[rel~="icon"]')].map((l) => l.getAttribute('href')))`));
      assert.deepStrictEqual(icons, ['favicon.svg', 'favicon.ico'], `${app.id}: the tab's icon links are the two static ones (the setter added none)`);
      assert.strictEqual(await evalJs(`document.querySelector('link[rel="icon"]').href`), `${origin}/favicon.svg`, `${app.id}: the tab icon resolves to favicon.svg`);
      const fav = JSON.parse(await evalJs(`(async () => { const href = document.querySelector('link[rel="icon"]').href; const text = await (await fetch(href)).text(); const img = new Image(); img.src = href; await img.decode(); return JSON.stringify({ text, w: img.naturalWidth, h: img.naturalHeight }); })()`));
      assert.strictEqual(fav.text, app.icon, `${app.id}: the tab icon file is the registry's icon, byte for byte`);
      assert.deepStrictEqual([fav.w, fav.h], [64, 64], `${app.id}: the favicon decodes as an image (64 x 64)`);
      const sizes = JSON.parse(await evalJs(`(async () => { const out = {}; for (const [k, sel] of [['apple', 'link[rel="apple-touch-icon"]'], ['og', 'meta[property="og:image"]']]) { const el = document.querySelector(sel); const url = (el.href || el.content).replace(/^https:\\/\\/[^/]+/, location.origin); const img = new Image(); img.src = url; await img.decode(); out[k] = [img.naturalWidth, img.naturalHeight]; } const man = await (await fetch(document.querySelector('link[rel="manifest"]').href)).json(); out.manifest = man.theme_color; return JSON.stringify(out); })()`));
      assert.deepStrictEqual(sizes.apple, [180, 180], `${app.id}: apple-touch-icon loads, 180`);
      assert.deepStrictEqual(sizes.og, [1200, 630], `${app.id}: og:image loads, 1200 x 630`);
      assert.strictEqual(sizes.manifest, app.tile, `${app.id}: the manifest loads, theme colour = the tile`);
      await shot(`${app.id}-desktop.png`);
      await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
      await navigate(`${origin}/`, 15000);
      await waitForApp(CANVAS[app.id]);
      await sleep(600);
      await shot(`${app.id}-phone.png`);
      await send('Emulation.clearDeviceMetricsOverride');

      // ---- the tab strip sheet and the og card, from the built site ----
      const strip = (bg, fg) => `<div style="display:flex;align-items:center;gap:10px;padding:8px 14px;background:${bg};color:${fg};font:13px Segoe UI,Arial,sans-serif;border-radius:8px 8px 0 0;width:300px"><img src="favicon.svg" width="16" height="16"><img src="favicon.ico" width="16" height="16"><span>${appTitle(app.id)}</span></div>`;
      fs.writeFileSync(path.join(out, '__sheet.html'), `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#d9dce1;font:13px Segoe UI,Arial"><div style="padding:16px 16px 0">${strip('#ffffff', '#222')}</div><div style="padding:16px 16px 0">${strip('#2b2d31', '#eee')}</div>`
        + `<div style="padding:16px;display:flex;gap:16px;align-items:flex-end"><img src="favicon.svg" width="32" height="32"><img src="favicon.svg" width="64" height="64"><img src="apple-touch-icon.png" width="90"><img src="icon-192.png" width="96"></div><div style="padding:0 16px 16px"><img src="og-image.png" width="600" style="border:1px solid #888"></div></body>`);
      await send('Emulation.setDeviceMetricsOverride', { width: 700, height: 560, deviceScaleFactor: 2, mobile: false });
      await navigate(`${origin}/__sheet.html`, 15000);
      await sleep(400);
      await shot(`${app.id}-tabstrip-og.png`);
      await send('Emulation.clearDeviceMetricsOverride');
      console.log(`${app.id}: static favicon.svg (= registry, 64x64), apple 180, og 1200x630, manifest theme ${sizes.manifest}; intro ${intro.w}x${intro.h} out of flow, 0 px shift, gone after boot`);
    }
    assert.deepStrictEqual(problems, [], 'no console error / page exception');
    console.log('site-identity-829-live: 4 apps OK');
  } finally {
    await cdp.close();
    for (const s of servers) s.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})();
