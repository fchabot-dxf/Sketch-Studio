// tests/feedback-830-live.test.js — TASK 830 (live): "Rate & feedback" in the real pages, Shaper (desktop 1280 mouse + phone 390 touch) and Sketch (desktop + phone),
// against a LOCAL STUB that is the Worker's own fetch handler (analytics/src/index.js, run in Node, its D1 an in-memory stand-in): nothing leaves the machine.
// The apps are BUILT as deployed (scripts/build-site.cjs) and ONLY their copy of packages/ui/analytics.js gets the stub's URL as ENDPOINT. Each phase is opened under
// its own made-up public host name (*.feedback-830.test -> 127.0.0.1 by the browser's --host-resolver-rules): a PUBLIC page for analytics.js, with its own
// localStorage and its own document tabs (so no phase sees another's design).
//   M  the menu item "Rate & feedback" opens THE window: 5 stars (44 px, arrow keys), the text, the email, Send / Cancel; a wrong email is a plain line and the text stays;
//      Cancel keeps the draft; a refused Send (the stub answers 503 once) is a plain line, the text stays; Send stores ONE row (stars, text, email, app, build, host).
//   C  the second export shows the card in the export area (the first does not); nothing around it moves; a star opens the window with that rating; Send ends the asking.
//   N  "Never": the card goes, nothing is asked again after more exports.   T  "Not now": the card goes, the state is the rule's (next ask 10 exports later).
//   L  the same page on 127.0.0.1 and one opted out (?analytics=off): two exports, no card, no key stored.
//   P  the phone (390 x 844, touch): the item, the window inside the screen, 44 px stars, the card after the second export, "Never".
//   S  Sketch: the item; two downloads from the drawer; the card waits in the Export… view (Sketch's export area); the window on a phone.
import assert from 'node:assert';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { launchBrowser, startServer, sleep, sendRealKey } from './helpers/cdp-browser.js';
import worker from '../analytics/src/index.js';

const require = createRequire(import.meta.url);
const { buildSite } = require('../scripts/build-site.cjs');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EVIDENCE = path.join(ROOT, '.evidence', '830');
fs.mkdirSync(EVIDENCE, { recursive: true });
const DOMAIN = 'feedback-830.test';
const ENDPOINT_LINE = /^export const ENDPOINT = '[^']*';$/m;

// ── the stub: the Worker's fetch handler, D1 in memory; `failNext` answers one /feedback with 503 (a Worker that is down) ──
const rows = [];
const requests = [];
let failNext = false;
let nextId = 0;
const db = { prepare: (sql) => ({ sql, args: [], bind(...a) { this.args = a; return this; }, async all() { return { results: [...rows].reverse() }; }, async run() {
  if (this.sql.startsWith('INSERT INTO feedback')) { const [at, app, version, host, stars, text, email] = this.args; rows.push({ id: ++nextId, at, app, version, host, stars, text, email, status: 'new' }); }
  else if (this.sql.startsWith('UPDATE feedback SET status')) { const r = rows.find((x) => x.id === this.args[1]); if (r) r.status = this.args[0]; }
  else if (!this.sql.startsWith('CREATE TABLE IF NOT EXISTS feedback')) throw new Error('unexpected SQL ' + this.sql);
  return { success: true };
} }) };
const stub = http.createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks).toString('utf8');
  requests.push({ method: req.method, url: req.url, body });
  if (req.url === '/feedback' && failNext && req.method === 'POST') { failNext = false; res.writeHead(503, { 'access-control-allow-origin': '*' }); res.end('down'); return; }
  const r = await worker.fetch(new Request('http://stub' + req.url, { method: req.method, headers: { 'content-type': 'text/plain' }, body: req.method === 'POST' ? body : undefined }), { DB: db, EVENTS: { writeDataPoint() {} }, DASH_KEY: 'k3y', AE_TOKEN: 't', ACCOUNT_ID: 'a' });
  res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(await r.text());
});
await new Promise((r) => stub.listen(0, '127.0.0.1', r));
const STUB_URL = `http://127.0.0.1:${stub.address().port}/e`;
const feedbackPosts = () => requests.filter((r) => r.url === '/feedback' && r.method === 'POST');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-830-'));
const sites = {};
for (const app of ['shaper', 'sketchstudio']) {
  const dist = path.join(tmp, app);
  buildSite(app, dist);
  const f = path.join(dist, 'packages', 'ui', 'analytics.js');
  const src = fs.readFileSync(f, 'utf8');
  assert.ok(ENDPOINT_LINE.test(src), `the built ${app} analytics.js has its ENDPOINT line`);
  fs.writeFileSync(f, src.replace(ENDPOINT_LINE, `export const ENDPOINT = '${STUB_URL}';`));
  sites[app] = await startServer(dist);
}
const SVG = path.join(tmp, 'cut-square.svg');
fs.writeFileSync(SVG, '<svg xmlns="http://www.w3.org/2000/svg" xmlns:shaper="http://www.shapertools.com/namespaces/shaper" width="60mm" height="40mm" viewBox="0 0 60 40">'
  + '<rect x="10" y="10" width="40" height="20" fill="none" stroke="black" shaper:cutType="outside" shaper:cutDepth="3mm"/></svg>');
const dlDir = path.join(tmp, 'downloads'); fs.mkdirSync(dlDir);

const cdp = await launchBrowser({ tag: '830-feedback', width: 1280, height: 800, server: false, args: [`--host-resolver-rules=MAP *.${DOMAIN} 127.0.0.1`] });
if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); stub.close(); for (const s of Object.values(sites)) s.server.close(); process.exit(0); }
const { send, once, evalJs, waitFor, waitForApp, navigate, close } = cdp;

const until = async (fn, what, ms = 10000) => { const end = Date.now() + ms; while (!(await fn())) { if (Date.now() > end) throw new Error('timed out waiting for ' + what); await sleep(50); } };
let touch = false;
const tapAt = async (x, y) => {
  if (touch) {
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 0, radiusX: 1, radiusY: 1, force: 1 }] }); await sleep(40);
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', clickCount: 0 });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
  }
  await sleep(200);
};
// a real press on the element's centre, after checking nothing covers it there
const press = async (sel) => {
  const p = await evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({ block: 'nearest' }); const r = e.getBoundingClientRect();
    const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2); const hit = document.elementFromPoint(x, y);
    return { x, y, onTop: !!hit && (hit === e || e.contains(hit)) }; })()`);
  assert.ok(p && p.onTop, `${sel} is on screen and not covered: ${JSON.stringify(p)}`);
  await tapAt(p.x, p.y);
};
const rect = (sel) => evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; })()`);
const vw = () => evalJs('innerWidth');
const vh = () => evalJs('innerHeight');
const shot = async (name, clip) => {
  const r = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 1 } } : {}) });
  fs.writeFileSync(path.join(EVIDENCE, name), Buffer.from(r.data, 'base64'));
};
const isOpen = () => evalJs(`document.querySelector('.sk-sidebar').classList.contains('open')`);
const openMenu = async () => {
  if (await isOpen()) return;
  for (let attempt = 1; attempt <= 3; attempt++) {
    await press(touch ? '.sk-sidebar-handle' : '.sk-sidebar-btn');
    await sleep(400);
    if (await isOpen()) { if (attempt > 1) console.log(`  (openMenu needed ${attempt} taps)`); return; }
  }
  throw new Error('the drawer did not open after 3 presses: ' + JSON.stringify(await evalJs(`({ cls: document.querySelector('.sk-sidebar').className, handle: (() => { const r = document.querySelector('.sk-sidebar-handle').getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; })() })`)));
};
const openStage = async (id) => {
  if (touch) { await openMenu(); await press(`.sk-sidebar-stage[data-tab="${id}"]`); } else await press(`.sk-header-tab[data-tab="${id}"]`);
  await waitFor(`!document.getElementById('view-${id}').hidden`, `the ${id} stage`);
  await sleep(300);
};
const keyOf = (app) => `sketch-feedback-ask-${app}`;
const stored = (app) => evalJs(`localStorage.getItem(${JSON.stringify(keyOf(app))})`);
const cards = () => evalJs(`document.querySelectorAll('.sk-fb-card').length`);
const dialog = () => evalJs(`!!document.querySelector('[data-feedback]')`);
const starOn = () => evalJs(`[...document.querySelectorAll('[data-feedback] .sk-fb-star')].map((b) => b.getAttribute('aria-checked') === 'true').indexOf(true) + 1`);
const typeInto = async (sel, text) => { await evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.focus(); e.select && e.select(); })()`); await send('Input.insertText', { text }); };
const SENT = 'Thank you. Your message was sent.';
const windowText = () => evalJs(`document.querySelector('[data-feedback]') ? document.querySelector('[data-feedback]').innerText : ''`);
const finish = async () => { const e = await evalJs(`!!document.querySelector('[data-feedback]')`); if (e) { await press('[data-feedback] [data-choice="__cancel"]'); await waitFor(`!document.querySelector('[data-feedback]')`, 'the window closes'); } };

// THE window, checked in the page the test is on: inside the screen, 44 px stars, the four parts
async function checkWindow(tag) {
  const w = await rect('[data-feedback]'), W = await vw(), H = await vh();
  assert.ok(w && w.l >= 0 && w.t >= 0 && w.r <= W + 0.5 && w.b <= H + 0.5, `${tag}: the window is inside the ${W}x${H} screen: ${JSON.stringify(w)}`);
  const stars = await evalJs(`[...document.querySelectorAll('[data-feedback] .sk-fb-star')].map((b) => { const r = b.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; })`);
  assert.strictEqual(stars.length, 5, `${tag}: five stars`);
  assert.ok(stars.every(([a, b]) => a >= 44 && b >= 44), `${tag}: every star is at least 44 x 44: ${JSON.stringify(stars)}`);
  const parts = await evalJs(`({ group: !!document.querySelector('[data-feedback] [role="radiogroup"]'), text: !!document.querySelector('[data-feedback] [data-fb="text"]'), email: !!document.querySelector('[data-feedback] [data-fb="email"]'),
    send: !!document.querySelector('[data-feedback] [data-choice="send"]'), cancel: !!document.querySelector('[data-feedback] [data-choice="__cancel"]'), max: document.querySelector('[data-feedback] [data-fb="text"]').maxLength, labels: document.querySelector('[data-feedback]').innerText })`);
  assert.ok(parts.group && parts.text && parts.email && parts.send && parts.cancel, `${tag}: stars, text, email, Send, Cancel: ${JSON.stringify(parts)}`);
  assert.strictEqual(parts.max, 2000, `${tag}: the text is capped at 2000`);
  assert.ok(/What works, what doesn't\?/.test(parts.labels) && /Email \(only if you'd like a reply\)/.test(parts.labels), `${tag}: the two labels, in plain words`);
  const textRect = await rect('[data-feedback] [data-fb="text"]'), sendRect = await rect('[data-feedback] [data-choice="send"]');
  assert.ok(sendRect.h >= 44 && textRect.h >= 44, `${tag}: Send and the text are touch-sized`);
}

// the Shaper export: import the cut once, open Export, press Generate Shaper SVG
const importSvg = async () => {
  await evalJs(`delete window.showOpenFilePicker`);
  await send('DOM.getDocument', { depth: 0 });
  await send('Page.setInterceptFileChooserDialog', { enabled: true });
  await openMenu();
  const chooser = once('Page.fileChooserOpened');
  await press('.sk-sidebar-item[data-action="import-file"]');
  const ch = await Promise.race([chooser, sleep(5000).then(() => null)]);
  assert.ok(ch, 'the file chooser opened');
  await send('DOM.setFileInputFiles', { files: [SVG], backendNodeId: ch.backendNodeId });
};
const generate = async () => {
  for (const f of fs.readdirSync(dlDir)) fs.rmSync(path.join(dlDir, f));
  await press('#btn-generate-svg');
  await until(() => fs.readdirSync(dlDir).some((n) => n.endsWith('.svg')), 'the Shaper SVG download');
  await sleep(200);
};
async function shaperToExport(url) {
  await navigate(url); await waitForApp('design-canvas');
  await importSvg();
  await waitFor(`import('/src/cut-plan.js').then((m) => m.planEntries().length > 0)`, 'the imported cut in the plan');
  await openStage('review');
}
// every element of the Export panel's column except the card's slot and the elements that CONTAIN it (the panel grows to hold the card): where it is (so "nothing moved" is a comparison)
const columnSnapshot = () => evalJs(`(() => { const col = document.querySelector('#simexport-panel').closest('aside') || document.querySelector('#simexport-panel').parentElement; const out = [];
  for (const e of col.querySelectorAll('*')) { if (e.closest('[data-feedback-slot]') || e.querySelector('[data-feedback-slot]')) continue; const r = e.getBoundingClientRect(); out.push([e.id || e.className || e.tagName, Math.round(r.left * 10) / 10, Math.round(r.top * 10) / 10, Math.round(r.width * 10) / 10, Math.round(r.height * 10) / 10]); }
  return JSON.stringify(out); })()`);

try {
  await send('Network.enable');
  await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dlDir });
  const shaperHost = (tag) => `http://${tag}.${DOMAIN}:${sites.shaper.port}/`;
  const sketchHost = (tag) => `http://${tag}.${DOMAIN}:${sites.sketchstudio.port}/`;

  // ── M. the menu item and THE window (desktop) ─────────────────────────────────────────────────────────
  await navigate(shaperHost('m'));
  await waitForApp('design-canvas');
  await openMenu();
  const item = await evalJs(`(() => { const b = document.querySelector('.sk-sidebar-item[data-action="feedback"]'); return b && b.textContent.trim(); })()`);
  assert.strictEqual(item, 'Rate & feedback', 'M: the drawer has the item "Rate & feedback"');
  await press('.sk-sidebar-item[data-action="feedback"]');
  await waitFor(`!!document.querySelector('[data-feedback]')`, 'M: the window opens');
  assert.strictEqual(await evalJs(`document.querySelector('.sk-sidebar').classList.contains('open')`), false, 'M: the drawer closed behind it');
  await checkWindow('M desktop');
  await shot('shaper-desktop-window.png');
  // keyboard: Right x3 from nothing -> 3 then 4 stars? (the first Right picks 1): 4 presses = 4 stars
  await evalJs(`document.querySelector('[data-feedback] .sk-fb-star').focus()`);
  for (let i = 0; i < 4; i++) await sendRealKey(send, 'ArrowRight', 'ArrowRight', 39);
  assert.strictEqual(await starOn(), 4, 'M: four ArrowRight presses pick 4 stars');
  await sendRealKey(send, 'ArrowLeft', 'ArrowLeft', 37);
  assert.strictEqual(await starOn(), 3, 'M: ArrowLeft goes back to 3');
  await sendRealKey(send, 'End', 'End', 35);
  await sendRealKey(send, 'Home', 'Home', 36);
  assert.strictEqual(await starOn(), 1, 'M: End then Home land on 1');
  await press('[data-feedback] .sk-fb-star[data-star="4"]');
  assert.strictEqual(await starOn(), 4, 'M: a press picks the star');
  await typeInto('[data-feedback] [data-fb="text"]', "The grid is too faint, but the cuts are right.");
  await typeInto('[data-feedback] [data-fb="email"]', 'maker@@example');
  const n0 = feedbackPosts().length;
  await press('[data-feedback] [data-choice="send"]');
  await until(async () => /email/i.test(await windowText()), 'M: the email refusal line');
  assert.strictEqual(feedbackPosts().length, n0, 'M: a wrong email is refused in the page: nothing was sent');
  assert.strictEqual(await evalJs(`document.querySelector('[data-feedback] [data-fb="email"]').getAttribute('aria-invalid')`), 'true', 'M: the email field is marked');
  assert.strictEqual(await evalJs(`document.querySelector('[data-feedback] [data-fb="text"]').value`), 'The grid is too faint, but the cuts are right.', 'M: the text is kept');
  // Cancel keeps the draft
  await press('[data-feedback] [data-choice="__cancel"]');
  await waitFor(`!document.querySelector('[data-feedback]')`, 'M: Cancel closes it');
  await openMenu(); await press('.sk-sidebar-item[data-action="feedback"]');
  await waitFor(`!!document.querySelector('[data-feedback]')`, 'M: opened again');
  assert.deepStrictEqual([await starOn(), await evalJs(`document.querySelector('[data-feedback] [data-fb="text"]').value`)], [4, 'The grid is too faint, but the cuts are right.'], 'M: after Cancel the draft (4 stars, the text) is still there');
  // the Worker is down once: a plain line, the text stays; then it works
  await typeInto('[data-feedback] [data-fb="email"]', 'maker@example.com');
  failNext = true;
  await press('[data-feedback] [data-choice="send"]');
  await until(async () => /not accepted/.test(await windowText()), 'M: the refused-Send line');
  assert.ok(/not accepted \(error 503\)/.test(await windowText()) && /still here/.test(await windowText()), 'M: a plain line for a refused Send, saying the text stays');
  assert.strictEqual(rows.length, 0, 'M: nothing stored yet');
  assert.strictEqual(await evalJs(`document.querySelector('[data-feedback] [data-fb="text"]').value.length > 10`), true, 'M: the text is still in the box');
  await press('[data-feedback] [data-choice="send"]');
  await until(async () => (await windowText()).includes(SENT), 'M: the thank-you');
  await shot('shaper-desktop-thanks.png');
  assert.strictEqual(rows.length, 1, 'M: ONE row stored');
  const buildStamp = rows[0].version;
  assert.deepStrictEqual({ ...rows[0], at: undefined, id: undefined }, { at: undefined, id: undefined, status: 'new', app: 'shaper', version: buildStamp, host: 'web', stars: 4, text: 'The grid is too faint, but the cuts are right.', email: 'maker@example.com' }, 'M: the row: stars, text, email, app, build, host');
  assert.ok(/^[0-9A-Za-z:.-]{1,32}$/.test(buildStamp) && buildStamp !== 'source', `M: the build stamp of the built site (${buildStamp})`);
  const lastPost = JSON.parse(feedbackPosts().pop().body);
  assert.deepStrictEqual(Object.keys(lastPost).sort(), ['app', 'email', 'host', 'stars', 'text', 'version'], 'M: the page sent exactly those fields (no id, no file name)');
  assert.ok(!/cut-square|\.svg/.test(JSON.stringify(rows)), 'M: no file name in the stored row');
  assert.deepStrictEqual(JSON.parse(await stored('shaper') || 'null'), { exports: 0, nextAt: 2, notNow: 0, done: true }, 'M: sending ends the asking: "done" is stored');
  await press('[data-feedback] [data-choice="__cancel"]');
  await waitFor(`!document.querySelector('[data-feedback]')`, 'M: Close');
  assert.strictEqual(await evalJs(`document.querySelector('[data-feedback]') === null`), true, 'M: closed');

  // ── C. the second export: the card, in the export area, nothing moves ─────────────────────────────────
  await shaperToExport(shaperHost('c'));
  await generate();
  assert.strictEqual(await cards(), 0, 'C: the FIRST export shows no card');
  const before = await columnSnapshot();
  const panelBefore = await rect('#simexport-panel');
  await generate();
  await waitFor(`document.querySelectorAll('.sk-fb-card').length === 1`, 'C: the card after the second export');
  assert.strictEqual(await evalJs(`!!document.querySelector('#simexport-panel [data-feedback-slot] .sk-fb-card')`), true, 'C: the card is in the Export card\'s own slot');
  assert.strictEqual(await evalJs(`document.querySelector('[data-feedback]') === null`), true, 'C: it is a card, not a window: nothing blocks the work');
  const after = await columnSnapshot();
  assert.strictEqual(after, before, 'C: nothing in the Export column moved or resized when the card appeared (0 px)');
  const card = await rect('.sk-fb-card'), status = await rect('#simexport-status'), W = await vw(), H = await vh();
  assert.ok(card.t >= status.b - 0.5, `C: the card sits below the status line (${card.t} >= ${status.b})`);
  assert.ok(card.l >= 0 && card.r <= W && card.b <= H, `C: the card is on screen: ${JSON.stringify(card)}`);
  assert.ok(/Enjoying Shaper\?/.test(await evalJs(`document.querySelector('.sk-fb-card').innerText`)) && /Not now/.test(await evalJs(`document.querySelector('.sk-fb-card').innerText`)) && /Never/.test(await evalJs(`document.querySelector('.sk-fb-card').innerText`)), 'C: "Enjoying Shaper?", Not now, Never');
  assert.deepStrictEqual(JSON.parse(await stored('shaper')), { exports: 2, nextAt: 2, notNow: 0, done: false }, 'C: the state: 2 exports, due');
  await shot('shaper-desktop-card.png');
  await shot('shaper-desktop-card-zoom.png', { x: Math.max(0, panelBefore.l), y: Math.max(0, status.t - 100), width: Math.min(W - panelBefore.l, 520), height: 330 });
  // a star opens the window with that rating
  await press('.sk-fb-card .sk-fb-star[data-star="3"]');
  await waitFor(`!!document.querySelector('[data-feedback]')`, 'C: a star opens the window');
  assert.strictEqual(await starOn(), 3, 'C: the window opens with the card\'s rating (3 stars)');
  await typeInto('[data-feedback] [data-fb="text"]', 'Good export.');
  const rowsBefore = rows.length;
  await press('[data-feedback] [data-choice="send"]');
  await until(async () => (await windowText()).includes(SENT), 'C: the thank-you');
  assert.deepStrictEqual([rows.length, rows[rows.length - 1].stars, rows[rows.length - 1].text, rows[rows.length - 1].email], [rowsBefore + 1, 3, 'Good export.', ''], 'C: stored: 3 stars, the text, no email (optional)');
  await press('[data-feedback] [data-choice="__cancel"]');
  await waitFor(`!document.querySelector('[data-feedback]')`, 'C: closed');
  assert.strictEqual(await cards(), 0, 'C: sent: the card is gone');
  await generate(); await generate();
  assert.strictEqual(await cards(), 0, 'C: and never asked again');
  assert.strictEqual(JSON.parse(await stored('shaper')).done, true, 'C: done is stored');

  // ── N. Never ──────────────────────────────────────────────────────────────────────────────────────────
  await shaperToExport(shaperHost('n'));
  await generate(); await generate();
  await waitFor(`document.querySelectorAll('.sk-fb-card').length === 1`, 'N: the card');
  await press('.sk-fb-card [data-fb-ask="never"]');
  assert.strictEqual(await cards(), 0, 'N: Never: the card goes');
  assert.strictEqual(JSON.parse(await stored('shaper')).done, true, 'N: and it is for good');
  for (let i = 0; i < 3; i++) await generate();
  assert.strictEqual(await cards(), 0, 'N: three more exports: no card');
  await navigate(shaperHost('n')); await waitForApp('design-canvas');
  assert.strictEqual(JSON.parse(await stored('shaper')).done, true, 'N: after a reload it is still never');

  // ── T. Not now ────────────────────────────────────────────────────────────────────────────────────────
  await shaperToExport(shaperHost('t'));
  await generate(); await generate();
  await waitFor(`document.querySelectorAll('.sk-fb-card').length === 1`, 'T: the card');
  await press('.sk-fb-card [data-fb-ask="not-now"]');
  assert.strictEqual(await cards(), 0, 'T: Not now: the card goes');
  assert.deepStrictEqual(JSON.parse(await stored('shaper')), { exports: 2, nextAt: 12, notNow: 1, done: false }, 'T: the next ask is 10 exports later, once');
  await generate();
  assert.strictEqual(await cards(), 0, 'T: the next export: no card');

  // ── L. a local page and an opted-out page never ask ───────────────────────────────────────────────────
  for (const [tag, url] of [['local 127.0.0.1', `http://127.0.0.1:${sites.shaper.port}/`], ['opted out', shaperHost('o') + '?analytics=off']]) {
    await shaperToExport(url);
    await generate(); await generate(); await generate();
    assert.strictEqual(await cards(), 0, `L ${tag}: three exports, no card`);
    assert.strictEqual(await stored('shaper'), null, `L ${tag}: and no ask state is stored`);
    await press('.sk-sidebar-btn').catch(() => {});
    await evalJs(`document.querySelector('.sk-sidebar') && document.querySelector('.sk-sidebar').classList.remove('open')`);
  }
  // the menu item is always there, even where nothing is asked; on a local page a Send is refused in a plain line (a developer's machine never writes to the Worker)
  await navigate(`http://127.0.0.1:${sites.shaper.port}/`); await waitForApp('design-canvas');
  await openMenu(); await press('.sk-sidebar-item[data-action="feedback"]');
  await waitFor(`!!document.querySelector('[data-feedback]')`, 'L: the window opens on a local page');
  await press('[data-feedback] .sk-fb-star[data-star="5"]');
  const posts0 = feedbackPosts().length;
  await press('[data-feedback] [data-choice="send"]');
  await until(async () => /published app/.test(await windowText()), 'L: the local refusal line');
  assert.strictEqual(feedbackPosts().length, posts0, 'L: nothing was sent from the local page');
  await finish();

  // ── P. the phone ──────────────────────────────────────────────────────────────────────────────────────
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  touch = true;
  await navigate(shaperHost('p')); await waitForApp('design-canvas');
  assert.strictEqual(await evalJs(`matchMedia('(pointer: coarse)').matches`), true, 'P: a coarse pointer');
  await openMenu();
  await press('.sk-sidebar-item[data-action="feedback"]');
  await waitFor(`!!document.querySelector('[data-feedback]')`, 'P: the window opens by touch');
  await checkWindow('P phone');
  await press('[data-feedback] .sk-fb-star[data-star="2"]');
  assert.strictEqual(await starOn(), 2, 'P: a tap picks the star');
  await shot('shaper-phone-window.png');
  await finish();
  await importSvg();
  await waitFor(`import('/src/cut-plan.js').then((m) => m.planEntries().length > 0)`, 'P: the imported cut');
  await openStage('review');
  await generate();
  assert.strictEqual(await cards(), 0, 'P: the first export: no card');
  await generate();
  await waitFor(`document.querySelectorAll('.sk-fb-card').length === 1`, 'P: the card after the second export');
  await evalJs(`document.querySelector('.sk-fb-card').scrollIntoView({ block: 'center' })`);
  const pc = await rect('.sk-fb-card'), pW = await vw();
  assert.ok(pc.l >= 0 && pc.r <= pW + 0.5 && pc.w > 100, `P: the card is inside the 390 px screen: ${JSON.stringify(pc)}`);
  const pStars = await evalJs(`[...document.querySelectorAll('.sk-fb-card .sk-fb-star')].map((b) => Math.round(b.getBoundingClientRect().width))`);
  const pLinks = await evalJs(`[...document.querySelectorAll('.sk-fb-card .sk-fb-link')].map((b) => Math.round(b.getBoundingClientRect().height))`);
  assert.ok(pStars.every((x) => x >= 44) && pLinks.every((x) => x >= 44), `P: the card's stars and buttons are touch-sized: ${JSON.stringify([pStars, pLinks])}`);
  assert.ok(await evalJs(`document.documentElement.scrollWidth <= innerWidth`), 'P: no sideways page scroll');
  await shot('shaper-phone-card.png');
  await press('.sk-fb-card [data-fb-ask="never"]');
  assert.strictEqual(await cards(), 0, 'P: Never by touch');
  assert.strictEqual(JSON.parse(await stored('shaper')).done, true, 'P: and stored');

  // ── S. Sketch ─────────────────────────────────────────────────────────────────────────────────────────
  touch = false;
  await send('Emulation.clearDeviceMetricsOverride');
  await send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await navigate(sketchHost('s')); await waitForApp('svgCanvas');
  await openMenu();
  assert.strictEqual(await evalJs(`(document.querySelector('.sk-sidebar-item[data-action="feedback"]') || {}).textContent`).then((t) => t && t.trim()), 'Rate & feedback', 'S: Sketch\'s menu has the item');
  await press('.sk-sidebar-item[data-action="feedback"]');
  await waitFor(`!!document.querySelector('[data-feedback]')`, 'S: the window opens');
  await checkWindow('S desktop');
  await press('[data-feedback] .sk-fb-star[data-star="5"]');
  await typeInto('[data-feedback] [data-fb="text"]', 'Nice drawing tool');
  await press('[data-feedback] [data-choice="send"]');
  await until(async () => (await windowText()).includes(SENT), 'S: the thank-you');
  assert.deepStrictEqual([rows[rows.length - 1].app, rows[rows.length - 1].stars, rows[rows.length - 1].host], ['sketchstudio', 5, 'web'], 'S: stored for Sketch, 5 stars, web');
  await finish();
  // a second origin for the card (sending above ended the asking on the first)
  await navigate(sketchHost('s2')); await waitForApp('svgCanvas');
  await evalJs(`delete window.showOpenFilePicker`);
  await send('Page.setInterceptFileChooserDialog', { enabled: true });
  await openMenu();
  const chooser = once('Page.fileChooserOpened');
  await press('.sk-sidebar-item[data-action="import-file"]');
  const ch = await Promise.race([chooser, sleep(5000).then(() => null)]);
  assert.ok(ch, 'S: the file chooser opened');
  await send('DOM.setFileInputFiles', { files: [SVG], backendNodeId: ch.backendNodeId });
  await waitFor(`document.querySelectorAll('#svgCanvas line, #svgCanvas path').length > 0`, 'S: the imported shapes').catch(() => sleep(1500));
  for (let i = 0; i < 2; i++) {
    await openMenu();
    await press('.sk-sidebar-item[data-action="download-svg"]');
    await sleep(500);
    if (i === 0) assert.strictEqual(await cards(), 0, 'S: the first download: no card');
  }
  await waitFor(`document.querySelectorAll('.sk-fb-card').length === 1`, 'S: the card after the second download');
  assert.strictEqual(await evalJs(`!!document.querySelector('#export-panel [data-feedback-slot] .sk-fb-card')`), true, 'S: it waits in Sketch\'s Export view (the drawer downloads close it at once)');
  await openMenu(); await press('.sk-sidebar-item[data-action="export"]');
  await waitFor(`!document.getElementById('export-panel').classList.contains('hidden')`, 'S: the Export… view opens');
  await sleep(300);
  const sc = await rect('#export-panel .sk-fb-card'), sp = await rect('#export-panel');
  assert.ok(sc && sc.w > 100 && sc.l >= sp.l && sc.r <= sp.r + 0.5 && sc.b <= (await vh()), `S: the card is visible inside the Export view: ${JSON.stringify([sc, sp])}`);
  await shot('sketch-desktop-card.png');
  await press('#export-panel .sk-fb-card [data-fb-ask="never"]');
  assert.strictEqual(await cards(), 0, 'S: Never');
  assert.strictEqual(JSON.parse(await stored('sketchstudio')).done, true, 'S: stored for sketchstudio');
  // Sketch on the phone: the item and the window
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  touch = true;
  await navigate(sketchHost('s3')); await waitForApp('svgCanvas');
  await openMenu(); await press('.sk-sidebar-item[data-action="feedback"]');
  await waitFor(`!!document.querySelector('[data-feedback]')`, 'S phone: the window opens');
  await checkWindow('S phone');
  await shot('sketch-phone-window.png');
  await finish();

  // ── D. the owner's dashboard on a phone: the Feedback section (the Worker's own page, the Analytics Engine calls answered empty) ──
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u, init) => (String(u).startsWith('https://api.cloudflare.com/') ? { ok: true, status: 200, text: async () => JSON.stringify({ data: [] }) } : realFetch(u, init));
  const at = (h) => new Date(Date.now() - h * 3600000).toISOString();
  rows.push({ id: ++nextId, at: at(2), app: 'penplotter', version: buildStamp, host: 'web', stars: 2, text: 'The pen-up height is not remembered.\nSecond line of the note.', email: 'plotter@example.com', status: 'new' },
    { id: ++nextId, at: at(30), app: 'trace', version: buildStamp, host: 'fusion', stars: null, text: 'Please add <b>PNG</b> export & more', email: '', status: 'done' });
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  touch = true;
  await navigate(`http://127.0.0.1:${stub.address().port}/dash?key=k3y&fapp=all#feedback`, 15000);
  await waitFor(`!!document.querySelector('#feedback .fbcard')`, 'D: the cards');
  assert.ok(await evalJs(`document.documentElement.scrollWidth <= innerWidth`), 'D: no sideways scroll at 390 px');
  assert.strictEqual(await evalJs(`/^Feedback: \\d+ new/.test(document.querySelector('.fbtop').innerText)`), true, 'D: the top line');
  const sizes = await evalJs(`[...document.querySelectorAll('#feedback .btn, #feedback .chip')].map((e) => Math.round(e.getBoundingClientRect().height))`);
  assert.ok(sizes.length > 8 && sizes.every((h) => h >= 44), 'D: every button and filter is at least 44 px tall: ' + JSON.stringify(sizes));
  const xs = await evalJs(`[...document.querySelectorAll('#feedback .fbcard')].filter((c) => c.offsetParent).map((c) => Math.round(c.getBoundingClientRect().left))`);
  assert.ok(new Set(xs).size === 1, 'D: the cards stack in one column: ' + JSON.stringify(xs));
  await evalJs(`document.querySelector('#feedback').scrollIntoView()`); await sleep(300);
  await shot('dashboard-phone-feedback.png');
  // Mark done by a real tap on the first new card, then the page shows it in the folded Done list
  const firstId = await evalJs(`document.querySelector('#feedback .fbcard[data-status="new"]').dataset.id`);
  await press(`#feedback .fbcard[data-id="${firstId}"] form input[value="done"] ~ button`);
  await waitFor(`!document.querySelector('#feedback .fbcard[data-status="new"][data-id="${firstId}"]')`, 'D: the card left the New list');
  assert.strictEqual(rows.find((r) => String(r.id) === firstId).status, 'done', 'D: the Worker stored status done');
  assert.strictEqual(await evalJs(`document.querySelector('.fbdone').open`), false, 'D: the Done list is folded');
  globalThis.fetch = realFetch;
  touch = false;

  // every request this test made to the Worker was a /feedback POST (the pages ran no analytics events: the stub saw none of /e from these pages other than visits and features)
  assert.ok(requests.every((r) => r.url === '/feedback' || r.url === '/e' || r.url.startsWith('/dash') || r.url === '/favicon.ico'), 'only /e, /feedback and the dashboard were called: ' + JSON.stringify([...new Set(requests.map((r) => r.url))]));
  console.log(`feedback-830-live: ${rows.length} messages stored by the Worker; screenshots in ${EVIDENCE}; all checks pass`);
} finally {
  await close();
  for (const s of Object.values(sites)) s.server.close();
  stub.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}
