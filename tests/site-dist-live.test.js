// tests/site-dist-live.test.js — TASK 696 (live): each app opened from ITS OWN built site. For each app: scripts/build-site.cjs into a temp dir, a static
// server on that dist only (its own port = its own origin, as each app's own website is), the app's page in headless Edge: the Design canvas finishes
// its restore (data-doc-ready) and the network log has no failed same-origin request (no 404: nothing the page loads is missing from its site).
// The /auth/google/... routes are Pages Functions (compiled from ./functions by wrangler, not files of the site; a plain static server has none):
// a request to one is listed apart, never as a missing file (tests/site-closure.test.js checks each route has its function file).
// EVIDENCE_DIR (optional): a screenshot of each app served from its dist.
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { launchBrowser, startServer, sleep } from './helpers/cdp-browser.js';

const require = createRequire(import.meta.url);
const { buildSite } = require('../scripts/build-site.cjs');
const CANVAS = { sketchstudio: 'svgCanvas', shaper: 'design-canvas', penplotter: 'design-canvas', trace: 'design-canvas' };
const FUNCTION_ROUTE = /^\/(?:api|auth)\//;

await (async () => {
  const cdp = await launchBrowser({ tag: '696', width: 1400, height: 800, server: false });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { send, evalJs, navigate, waitForApp, ws } = cdp;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'site-dist-696-'));
  const servers = [];
  let log = [];
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.method === 'Network.responseReceived') log.push({ url: m.params.response.url, status: m.params.response.status });
    if (m.method === 'Network.loadingFailed') log.push({ url: m.params.requestId, status: 'failed: ' + m.params.errorText, failedId: m.params.requestId });
    if (m.method === 'Network.requestWillBeSent') log.push({ url: m.params.request.url, status: 'sent', id: m.params.requestId });
  });
  try {
    await send('Network.enable');
    for (const app of Object.keys(CANVAS)) {
      const out = path.join(tmp, app);
      buildSite(app, out);
      const srv = await startServer(out);
      servers.push(srv.server);
      const origin = `http://127.0.0.1:${srv.port}`;
      log = [];
      await navigate(`${origin}/apps/${app}/`, 15000);
      await waitForApp(CANVAS[app]);
      await sleep(1500); // the lazy loads after the restore (the glyph sheet, the stage modules) land in the log too
      assert.strictEqual(await evalJs(`location.pathname`), `/apps/${app}/`, `${app}: served from its own site`);
      const sent = new Map(log.filter((x) => x.status === 'sent').map((x) => [x.id, x.url]));
      const done = log.filter((x) => x.status !== 'sent').map((x) => (x.failedId ? { url: sent.get(x.failedId) || x.url, status: x.status } : x));
      const mine = done.filter((x) => x.url.startsWith(origin));
      const fnRoutes = mine.filter((x) => FUNCTION_ROUTE.test(new URL(x.url).pathname));
      const bad = mine.filter((x) => !FUNCTION_ROUTE.test(new URL(x.url).pathname) && !(typeof x.status === 'number' && x.status < 400));
      assert.deepStrictEqual(bad, [], `${app}: no failed or 404 request for a file of its site`);
      assert.ok(mine.filter((x) => x.status === 200).length > 20, `${app}: the page loaded its files from the dist (${mine.length} same-origin responses)`);
      if (process.env.EVIDENCE_DIR) {
        const s = await send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(process.env.EVIDENCE_DIR, `dist-${app}.png`), Buffer.from(s.data, 'base64'));
      }
      console.log(`${app}: ${origin}/apps/${app}/ ready, ${mine.length} same-origin responses, 0 failed / 404${fnRoutes.length ? `; Pages Function routes (no Functions on a static server): ${fnRoutes.map((x) => new URL(x.url).pathname + ' ' + x.status).join(', ')}` : ''}`);
    }
    console.log('site-dist-live: the 4 apps load from their own dist with no missing file');
  } finally {
    await cdp.close();
    for (const s of servers) s.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})();
