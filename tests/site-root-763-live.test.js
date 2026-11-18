// tests/site-root-763-live.test.js — TASK 763 (live; owner turn 2295): the Shaper site BUILT (scripts/build-site.cjs, with a FIXTURE add-in release
// made here, not the real add-in) and served THE WAY CLOUDFLARE SERVES IT: `wrangler pages dev <site>` run from the repo root, so its _redirects,
// its 404.html, Pages' pretty-URL rules and the Pages Functions of ./functions (the Google sign-in routes, /api/shaper-upload) all apply. Local, no
// login, nothing deployed. The Google routes get FAKE configuration values (bindings, not credentials) so they answer; no request ever reaches
// Google or ShaperHub (the browser's resolver sends their hosts nowhere, the one Google navigation is answered by the test, and the upload route is
// only sent a body that is not JSON, which it refuses before it would call ShaperHub).
//   R. the root / loads the app: the address stays <site>/, zero failed or >= 400 requests of the site in the network log;
//   O. the OLD addresses forward with the query string and the #hash: /apps/shaper/?dev=1#h, /apps/shaper/index.html?x=1, /apps/shaper (no slash);
//   F. the Fusion add-in's address /apps/shaper/?host=fusion lands on /?host=fusion IN Fusion mode (the Fusion bar; window.adsk stubbed as the palette has it);
//   S. a stage switch and a reload keep the root address;
//   D. the add-in download (json + zip) at /downloads/, the view's link, and the old /apps/shaper/downloads/ link forwards to the same zip;
//   P. privacy.html is served at /privacy (Pages' pretty URL, as before) and its "Sketch Studio" link (/) is the app;
//   G. the sign-in round trip: /auth/google/start sends redirect_uri <site>/auth/google/callback (unchanged: origin + /auth/google/callback); Google's
//      answer is faked (access_denied, the cancel answer: no code, so no token exchange) and the callback page returns the window to the root app;
//   U. /api/shaper-upload is a Function route at the root (a body that is not JSON: the Function's own 400 JSON answer, never a 404 or a page);
//   B. the open-tabs buffer survives the move: a named design opened at the root is still open after the old address /apps/shaper/ forwards;
//   N. an unknown address is a 404 (the site's 404.html), not the app;
//   X. sketch-studio's site forwards the old one-site links of Shaper to https://shaper-svg.pages.dev/ (its root), query kept.
// EVIDENCE_DIR (optional): screenshots and the addresses.
import assert from 'node:assert';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn, execSync, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';
import { CREATE_NAMED_DESIGN } from './helpers/named-design.js';
import { installFakeDriveSession } from './helpers/fake-drive-session.js';

const require = createRequire(import.meta.url);
const { buildSite, SITE_HOST } = require('../scripts/build-site.cjs');
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EVIDENCE = process.env.EVIDENCE_DIR || null;
const FAKE_GOOGLE = ['GOOGLE_CLIENT_ID=fake-client-id-763', 'GOOGLE_CLIENT_SECRET=fake-not-a-secret-763', 'SESSION_KEY=fake-session-key-763'];
const NO_REMOTE = 'MAP accounts.google.com ~NOTFOUND, MAP oauth2.googleapis.com ~NOTFOUND, MAP www.googleapis.com ~NOTFOUND, MAP *.shapertools.com ~NOTFOUND';

// wrangler: the global install (the deploy uses the same one). Not found = a clear failure, never a silent skip.
function wranglerJs() {
  const root = execSync('npm root -g', { encoding: 'utf8', shell: true }).trim();
  const js = path.join(root, 'wrangler', 'bin', 'wrangler.js');
  if (!fs.existsSync(js)) throw new Error(`site-root-763-live: wrangler is not installed (${js}); install it with npm i -g wrangler`);
  return js;
}
const freePort = () => new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
function killTree(proc) {
  if (!proc || proc.exitCode !== null) return;
  if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
  else process.kill(-proc.pid, 'SIGKILL');
}
// `wrangler pages dev <dir>` from the repo root (its ./functions), state in tmp; resolves once it answers
async function pagesDev(js, dir, stateDir) {
  const port = await freePort(), inspector = await freePort();
  const proc = spawn(process.execPath, [js, 'pages', 'dev', dir, '--ip', '127.0.0.1', '--port', String(port), '--inspector-port', String(inspector), '--compatibility-date', '2024-09-01',
    '--persist-to', stateDir, '--log-level', 'warn', '--show-interactive-dev-session=false', ...FAKE_GOOGLE.flatMap((b) => ['--binding', b])],
  { cwd: REPO_ROOT, env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' }, detached: process.platform !== 'win32' });
  let log = '';
  proc.stdout.on('data', (d) => { log += d; });
  proc.stderr.on('data', (d) => { log += d; });
  const origin = `http://127.0.0.1:${port}`;
  const t0 = Date.now();
  while (Date.now() - t0 < 30000) {
    if (proc.exitCode !== null) throw new Error(`wrangler pages dev exited (${proc.exitCode}):\n${log.slice(-2000)}`);
    try { await fetch(origin + '/privacy', { redirect: 'manual' }); return { proc, origin, ms: Date.now() - t0 }; } catch { await sleep(150); }
  }
  killTree(proc);
  throw new Error(`wrangler pages dev did not answer in 30 s:\n${log.slice(-2000)}`);
}
const head = async (url) => { const r = await fetch(url, { redirect: 'manual' }); return { status: r.status, location: r.headers.get('location'), type: r.headers.get('content-type'), body: await r.text() }; };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'site-root-763-'));
const procs = [];
let cdp = null;
try {
  // ---- the two sites, built as deployed
  const rel = path.join(tmp, 'release');
  fs.mkdirSync(rel);
  const zipBytes = Buffer.from('PK\u0003\u0004 TASK 763 live fixture zip (not the add-in)');
  fs.writeFileSync(path.join(rel, 'shaper-addin.zip'), zipBytes);
  fs.writeFileSync(path.join(rel, 'shaper-addin.json'), JSON.stringify({ id: 'shaper-addin', version: '7.6.3', zip: 'shaper-addin.zip', bytes: zipBytes.length, sha256: crypto.createHash('sha256').update(zipBytes).digest('hex'), files: [] }));
  const shaper = buildSite('shaper', path.join(tmp, 'shaper'), { addin: rel });
  buildSite('sketchstudio', path.join(tmp, 'sketchstudio'));
  const js = wranglerJs();
  const sh = await pagesDev(js, shaper.out, path.join(tmp, 'state-shaper')); procs.push(sh.proc);
  const ss = await pagesDev(js, path.join(tmp, 'sketchstudio'), path.join(tmp, 'state-ss')); procs.push(ss.proc);
  const O = sh.origin;
  console.log(`wrangler pages dev: shaper ${O} (${sh.ms} ms), sketchstudio ${ss.origin} (${ss.ms} ms)`);

  // ---- N, U, X: answers of the server itself (no browser)
  const nf = await head(`${O}/no-such-page-763`);
  assert.deepStrictEqual([nf.status, /Not found/.test(nf.body)], [404, true], 'N: an unknown address is the 404 page, not the app');
  // a POST whose body is not JSON: the Function answers its own 400 before it would call ShaperHub (request.json() throws first)
  const upRes = await fetch(`${O}/api/shaper-upload`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: 'not json (TASK 763)' });
  const up = { status: upRes.status, type: upRes.headers.get('content-type'), body: await upRes.json() };
  assert.deepStrictEqual([up.status, up.type, typeof up.body.error], [400, 'application/json', 'string'], `U: /api/shaper-upload is the Function at the root: ${JSON.stringify(up)}`);
  for (const [p, want] of [['/shaper?host=fusion', 'https://shaper-svg.pages.dev/?host=fusion'], ['/apps/shaper/?host=fusion', 'https://shaper-svg.pages.dev/?host=fusion'],
    ['/apps/shaper/index.html?host=fusion', 'https://shaper-svg.pages.dev/?host=fusion'], ['/apps/shaper/downloads/shaper-addin.zip', 'https://shaper-svg.pages.dev/downloads/shaper-addin.zip'],
    ['/apps/penplotter/', 'https://sketch-plotter.pages.dev/'], ['/trace', 'https://sketch-trace.pages.dev/'], ['/apps/sketchstudio/?a=1', '/?a=1']]) {
    const r = await head(ss.origin + p);
    assert.deepStrictEqual([r.status, r.location], [302, want], `X: sketch-studio ${p}`);
  }
  assert.strictEqual(SITE_HOST.shaper, 'shaper-svg.pages.dev');
  console.log(`N/U/X: unknown -> 404 page; POST /api/shaper-upload (not JSON) -> ${up.status} ${JSON.stringify(up.body)} (the Function); sketch-studio forwards the old Shaper / Pen Plotter / Trace links to their sites' roots, query kept`);

  // ---- the browser
  cdp = await launchBrowser({ tag: '763-root', width: 1280, height: 800, server: false, args: [`--host-resolver-rules=${NO_REMOTE}`] });
  if (!cdp) throw new Error('site-root-763-live: no headless Edge/Chrome binary installed');
  const { send, evalJs, waitFor, waitForApp, navigate, ws } = cdp;
  let net = [];
  const docChain = [];
  const paused = [];
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.method === 'Network.requestWillBeSent') {
      net.push({ id: m.params.requestId, url: m.params.request.url, status: 'sent' });
      if (m.params.redirectResponse) net.push({ id: m.params.requestId, url: m.params.redirectResponse.url, status: m.params.redirectResponse.status });
      if (m.params.type === 'Document') docChain.push(m.params.redirectResponse ? `${m.params.redirectResponse.status} ${m.params.redirectResponse.url} -> ${m.params.request.url}` : `GET ${m.params.request.url}`);
    }
    if (m.method === 'Network.responseReceived') net.push({ id: m.params.requestId, url: m.params.response.url, status: m.params.response.status });
    if (m.method === 'Network.loadingFailed') net.push({ id: m.params.requestId, url: null, status: 'failed: ' + m.params.errorText });
    if (m.method === 'Fetch.requestPaused') paused.push(m.params);
  });
  const bad = () => {
    const urlOf = new Map(net.filter((x) => x.status === 'sent').map((x) => [x.id, x.url]));
    return net.filter((x) => x.status !== 'sent').map((x) => ({ url: x.url || urlOf.get(x.id), status: x.status }))
      .filter((x) => x.url && x.url.startsWith(O) && !(typeof x.status === 'number' && x.status < 400));
  };
  const href = () => evalJs('location.href');
  const shots = [];
  const shot = async (name) => {
    if (!EVIDENCE) return;
    // headless has no address bar: the evidence shot carries location.href in a strip at the bottom (added after every check of the step)
    await evalJs(`(() => { const d = document.createElement('div'); d.textContent = 'location.href = ' + location.href; d.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:2147483647;background:#ffeb3b;color:#000;font:bold 18px monospace;padding:6px 10px'; document.body.appendChild(d); })()`);
    const s = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(EVIDENCE, name), Buffer.from(s.data, 'base64'));
    const h = await send('Page.getNavigationHistory');
    shots.push(`${name}: location.href=${await href()} | history[current]=${h.entries[h.currentIndex].url}`);
  };
  await send('Network.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `if (new URLSearchParams(location.search).get('host') === 'fusion') window.adsk = { fusionSendData() { return '{}'; } };` });

  // R. the root
  await navigate(`${O}/`, 20000);
  await waitForApp('design-canvas');
  await sleep(1200); // the lazy loads after the restore (the glyph sheet, the stage modules) land in the log too
  assert.strictEqual(await href(), `${O}/`, 'R: the address is the root');
  assert.deepStrictEqual(bad(), [], 'R: no failed or >= 400 request of the site');
  const loaded = net.filter((x) => typeof x.status === 'number' && x.url && x.url.startsWith(O)).length;
  assert.ok(loaded > 50, `R: the page loaded its files from the site (${loaded} responses)`);
  await shot('root.png');
  console.log(`R: ${O}/ -> ${await href()}, ${loaded} same-origin responses, 0 failed / >= 400`);

  // O. old addresses -> the root, query + hash kept
  for (const [p, want] of [['/apps/shaper/?dev=1#h-763', '/?dev=1#h-763'], ['/apps/shaper/index.html?x=1#y', '/?x=1#y'], ['/apps/shaper', '/']]) {
    net = []; docChain.length = 0;
    await navigate(O + p, 20000);
    await waitForApp('design-canvas');
    assert.strictEqual(await href(), O + want, `O: ${p} ends at ${want}`);
    assert.deepStrictEqual(bad(), [], `O: ${p}: no failed request`);
    console.log(`O: ${p} -> ${await href()}  [${docChain.join(' | ')}]`);
  }

  // F. the Fusion add-in's address
  net = []; docChain.length = 0;
  await navigate(`${O}/apps/shaper/?host=fusion`, 20000);
  await waitForApp('design-canvas');
  assert.strictEqual(await href(), `${O}/?host=fusion`, 'F: the add-in address lands on /?host=fusion');
  assert.ok(await waitFor(`!!document.getElementById('shaper-fusion-bar') && document.getElementById('view-prepare').classList.contains('is-fusion')`, 'F: the Fusion bar'), 'F: Fusion mode');
  assert.strictEqual(await evalJs(`import('/src/fusion-bridge.js').then((m) => m.isFusionMode())`), true, 'F: isFusionMode() at the root');
  assert.deepStrictEqual(bad(), [], 'F: no failed request');
  await evalJs(`document.querySelector('.sk-header-tab[data-tab="prepare"]').click()`);
  await waitFor(`!document.getElementById('view-prepare').hidden`, 'F: Prepare');
  await sleep(300);
  await shot('fusion-mode.png');
  console.log(`F: /apps/shaper/?host=fusion -> ${await href()} [${docChain.join(' | ')}]; Fusion bar shown, isFusionMode() true`);

  // S. a stage switch and a reload keep the root
  await navigate(`${O}/`, 20000);
  await waitForApp('design-canvas');
  const VIEW = { prepare: 'view-prepare', review: 'view-review', design: 'design-view' }; // apps/shaper/src/modes.js findViews
  for (const tab of ['prepare', 'review', 'design']) {
    await evalJs(`document.querySelector('.sk-header-tab[data-tab="${tab}"]').click()`);
    await waitFor(`!document.getElementById('${VIEW[tab]}').hidden`, `S: the ${tab} stage`);
    assert.strictEqual(await href(), `${O}/`, `S: after the ${tab} stage the address is the root`);
  }
  await evalJs(`document.querySelector('.sk-header-tab[data-tab="prepare"]').click()`);
  net = [];
  const reloaded = new Promise((r) => { const f = (e) => { if (JSON.parse(e.data).method === 'Page.loadEventFired') { ws.removeEventListener('message', f); r(); } }; ws.addEventListener('message', f); });
  await send('Page.reload', {});
  await reloaded;
  await waitForApp('design-canvas');
  assert.strictEqual(await href(), `${O}/`, 'S: after a reload the address is the root');
  assert.deepStrictEqual(bad(), [], 'S: the reload: no failed request');
  console.log(`S: prepare / review / design and a reload: ${await href()}`);

  // D. the add-in download
  const rel763 = await evalJs(`import('/src/addin-download.js').then((m) => m.loadAddinRelease())`);
  assert.deepStrictEqual(rel763, { available: true, version: '7.6.3', bytes: zipBytes.length, zipUrl: `${O}/downloads/shaper-addin.zip` }, 'D: the view reads /downloads/shaper-addin.json, its link is /downloads/shaper-addin.zip');
  const zips = await evalJs(`Promise.all(['/downloads/shaper-addin.zip', '/apps/shaper/downloads/shaper-addin.zip'].map((u) => fetch(u).then(async (r) => [r.url, r.status, (await r.arrayBuffer()).byteLength])))`);
  assert.deepStrictEqual(zips, [[`${O}/downloads/shaper-addin.zip`, 200, zipBytes.length], [`${O}/downloads/shaper-addin.zip`, 200, zipBytes.length]], 'D: the zip, and the old link forwards to it');
  console.log(`D: ${JSON.stringify(rel763)}; old /apps/shaper/downloads/shaper-addin.zip -> ${zips[1][0]}`);

  // P. privacy
  const priv = await evalJs(`fetch('/privacy.html').then(async (r) => ({ url: r.url, status: r.status, drive: (await r.text()).includes('drive.file') }))`);
  assert.deepStrictEqual(priv, { url: `${O}/privacy`, status: 200, drive: true }, 'P: privacy.html is the privacy page at /privacy');
  await navigate(`${O}/privacy`, 10000);
  const back = await evalJs(`document.querySelector('a[href="/"]').href`);
  assert.strictEqual(back, `${O}/`, 'P: its "Sketch Studio" link is the root');
  console.log(`P: ${JSON.stringify(priv)}; its link -> ${back}`);

  // G. the sign-in round trip (Google faked)
  await send('Fetch.enable', { patterns: [{ urlPattern: 'https://accounts.google.com/*', requestStage: 'Request' }] });
  docChain.length = 0;
  const startNav = navigate(`${O}/auth/google/start`, 20000);
  const t0 = Date.now();
  while (!paused.length && Date.now() - t0 < 15000) await sleep(50);
  assert.ok(paused.length, 'G: the start route sends the browser to Google');
  const g = new URL(paused[0].request.url);
  assert.strictEqual(g.origin + g.pathname, 'https://accounts.google.com/o/oauth2/v2/auth', 'G: Google\'s consent address');
  assert.strictEqual(g.searchParams.get('redirect_uri'), `${O}/auth/google/callback`, 'G: redirect_uri = <site>/auth/google/callback (the address registered in the Google console, unchanged)');
  assert.strictEqual(g.searchParams.get('client_id'), 'fake-client-id-763');
  await send('Fetch.fulfillRequest', { requestId: paused[0].requestId, responseCode: 302, responseHeaders: [{ name: 'Location', value: `${O}/auth/google/callback?state=${encodeURIComponent(g.searchParams.get('state'))}&error=access_denied` }] });
  await startNav;
  await waitFor(`location.pathname === '/' && !!document.getElementById('design-canvas')`, 'G: the callback page returns to the root app', 20000);
  await waitForApp('design-canvas');
  await send('Fetch.disable');
  assert.strictEqual(await href(), `${O}/`, 'G: the round trip ends on the root address');
  assert.strictEqual(paused.length, 1, 'G: one Google request, answered here');
  await shot('signin-roundtrip.png');
  console.log(`G: redirect_uri=${g.searchParams.get('redirect_uri')}; chain [${docChain.join(' | ')}] -> ${await href()}`);

  // B. the open-tabs buffer survives the move (a new design lives on Drive, TASK 624: the in-memory fake Drive + GIS of the test harness, from now on)
  await installFakeDriveSession(cdp);
  await navigate(`${O}/`, 20000);
  await waitForApp('design-canvas');
  const id = await evalJs(CREATE_NAMED_DESIGN('shaper', 'Root move 763'));
  await navigate(`${O}/`, 20000); // the next load restores it (the real restore path)
  await waitForApp('design-canvas');
  await waitFor(`document.title.startsWith('Root move 763')`, 'B: the named design open at the root');
  await navigate(`${O}/apps/shaper/`, 20000);
  await waitForApp('design-canvas');
  assert.strictEqual(await href(), `${O}/`, 'B: the old address forwarded');
  await waitFor(`document.title.startsWith('Root move 763')`, 'B: the design is still open after the forward');
  const buf = await evalJs(`import('/packages/ui/project-store.js').then(async (m) => { const s = m.getProjectStore(); return { tabs: JSON.stringify(await s.readBuffer({ app: 'shaper' })), stored: !!(await s.get(${JSON.stringify(id)})) }; })`);
  assert.ok(buf.stored && buf.tabs.includes(id), `B: the design is stored and in the open-tabs buffer: ${buf.tabs}`);
  await shot('buffer-after-forward.png');
  console.log(`B: design ${id} "${await evalJs('document.title')}" open after /apps/shaper/ -> ${await href()}`);

  if (EVIDENCE) fs.writeFileSync(path.join(EVIDENCE, 'live-addresses.txt'), shots.join('\n') + '\n');
  console.log('site-root-763-live: the Shaper site at its root, served by wrangler pages dev: R O F S D P G B N U X all pass');
} finally {
  if (cdp) await cdp.close();
  for (const p of procs) killTree(p);
  await sleep(300);
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
