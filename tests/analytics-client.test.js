// tests/analytics-client.test.js — TASK 738: the ONE analytics client (packages/ui/analytics.js), in plain Node with a stand-in page (createAnalytics'
// `env`: location, localStorage, navigator, crypto, fetch) running the SAME code the sites run:
//   - THE rule: nothing is sent without ENDPOINT, from a local page (localhost, 127.x, ::1, a LAN address, a single-label / .local name, file:,
//     about:blank: a developer's machine, the tests, the gate's headless browsers), or after an opt-out (?analytics=off, Do Not Track, GPC);
//   - from a public page: one visit per page load, then one event per declared feature; an undeclared name, or a feature before the visit, is not sent;
//   - the payload has EXACTLY the declared fields ({ event, name, id, app, version, host, dev }), no personal field, and the Worker accepts it as is;
//   - the anonymous id is 32 random hex characters kept in localStorage; ?dev=1 / ?dev=0 tag / untag the device;
//   - the declared feature list == the names the code sends: every track() call in apps/ and packages/ names a declared feature (a literal, or a
//     declared family + an id), and every declared feature has a call; the families' ids (stages, templates) are declared ids, never text;
//   - no other module has send code (no second endpoint, no sendBeacon), and the repo's analytics.js is the unbuilt one (BUILD 'source').
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAnalytics, isPublicPage, ENDPOINT, BUILD, STORAGE } from '../packages/ui/analytics.js';
import { FEATURES, FAMILY_ID, ANON_ID, isFeatureName } from '../packages/ui/analytics-events.js';
import { validateEvent } from '../analytics/src/index.js';
import { TEMPLATES } from '../packages/core/templates.js';
import { shaperStagesFor } from '../apps/shaper/src/modes.js';
import { TRACE_STAGES } from '../apps/trace/src/stages.js';
import { STAGES as PEN_STAGES } from '../apps/penplotter/src/stages.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let checks = 0;
const ok = (c, msg) => { assert.ok(c, msg); checks++; };
const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, msg); checks++; };

const STUB = 'https://sketch-analytics.example.workers.dev/e';
// a stand-in page: its storage outlives one createAnalytics (a reload of the same browser)
function page(href, { storage = new Map(), dnt, gpc } = {}) {
  const u = new URL(href);
  const sent = [];
  const env = {
    location: { protocol: u.protocol, hostname: u.hostname, search: u.search },
    localStorage: { getItem: (k) => (storage.has(k) ? storage.get(k) : null), setItem: (k, v) => storage.set(k, String(v)), removeItem: (k) => storage.delete(k) },
    navigator: { doNotTrack: dnt, globalPrivacyControl: gpc },
    crypto: globalThis.crypto,
    fetch: async (url, init) => { sent.push({ url, init, body: JSON.parse(init.body) }); return { ok: true, status: 204 }; },
  };
  return { env, sent, storage };
}
const run = (href, opts = {}, { endpoint = STUB, app = 'shaper', host = 'web', features = ['stage:prepare'] } = {}) => {
  const p = page(href, opts);
  const a = createAnalytics({ endpoint, build: '2026-11-16T14:05Z', env: p.env });
  a.start({ app, host });
  for (const f of features) a.track(f);
  return p;
};

// ── THE rule ───────────────────────────────────────────────────────────────────────────────────────
const PUBLIC = 'https://shaper-svg.pages.dev/apps/shaper/';
eq(run(PUBLIC).sent.length, 2, 'a public page with ENDPOINT set: the visit + the feature are sent');
eq(run(PUBLIC, {}, { endpoint: '' }).sent.length, 0, 'ENDPOINT empty (the repo until the Worker is deployed): nothing is sent');
for (const href of ['http://localhost:8090/apps/shaper/', 'http://127.0.0.1:61234/apps/shaper/index.html', 'http://[::1]:8080/', 'http://192.168.1.20:8080/', 'http://10.0.0.7/',
  'http://172.16.4.2/', 'http://shop-pc:8080/', 'http://shop-pc.local/', 'http://app.localhost/', 'file:///D:/APPS/Sketch-Studio/apps/shaper/index.html', 'about:blank']) {
  const p = run(href + '?dev=1&analytics=off');
  eq([p.sent.length, p.storage.size], [0, 0], `${href}: a local page sends nothing and keeps no analytics key`);
}
ok(!isPublicPage(undefined) && !isPublicPage(null), 'no location (plain Node, a worker): not a public page');
eq(run(PUBLIC, { dnt: '1' }).sent.length, 0, 'Do Not Track: nothing is sent');
eq(run(PUBLIC, { gpc: true }).sent.length, 0, 'Global Privacy Control: nothing is sent');
{
  const storage = new Map();
  eq(run(PUBLIC + '?analytics=off', { storage }).sent.length, 0, '?analytics=off: nothing is sent');
  eq(run(PUBLIC, { storage }).sent.length, 0, 'and it is remembered on this device');
  eq(run(PUBLIC + '?analytics=on', { storage }).sent.length, 2, '?analytics=on: sending again');
}

// ── what is sent ──────────────────────────────────────────────────────────────────────────────────────
{
  const storage = new Map();
  const p = page(PUBLIC + '?host=fusion', { storage });
  const a = createAnalytics({ endpoint: STUB, build: '2026-11-16T14:05Z', env: p.env });
  eq(a.track('export:shaper'), false, 'a feature before the visit is not sent (the app has not started)');
  eq(a.start({ app: 'shaper', host: 'fusion' }), true, 'the visit');
  eq(a.start({ app: 'shaper', host: 'fusion' }), false, 'ONE visit per page load');
  for (const f of ['stage:review', 'import:fusion', 'export:shaper']) eq(a.track(f), true, `${f} sent`);
  for (const f of ['export:pdf', 'template:My kitchen', 'import:someone@example.com', 'stage:', 'stage:Design', '']) eq(a.track(f), false, `"${f}" (undeclared) not sent`);
  eq(p.sent.map((s) => [s.body.event, s.body.name]), [['visit', ''], ['feature', 'stage:review'], ['feature', 'import:fusion'], ['feature', 'export:shaper']], 'the events, in order');
  for (const s of p.sent) {
    eq(Object.keys(s.body).sort(), ['app', 'dev', 'event', 'host', 'id', 'name', 'version'], 'EXACTLY the declared fields');
    eq([s.body.app, s.body.host, s.body.version, s.body.dev], ['shaper', 'fusion', '2026-11-16T14:05Z', 0], 'app, host, the build stamp, not dev');
    ok(ANON_ID.test(s.body.id), 'the id is 32 hex characters');
    ok(!/@|\.svg|\.dxf|\s/.test(JSON.stringify(s.body)), 'no email, no file name, no free text: ' + JSON.stringify(s.body));
    eq(validateEvent(s.body).error, undefined, `the Worker accepts the client's ${s.body.event} ${s.body.name} as is`);
    eq([s.url, s.init.method, s.init.keepalive, s.init.headers['content-type']], [STUB, 'POST', true, 'text/plain'], 'a POST to ENDPOINT, text/plain (no CORS preflight), keepalive');
  }
  eq(new Set(p.sent.map((s) => s.body.id)).size, 1, 'one id per browser');
  eq(storage.get(STORAGE.id), p.sent[0].body.id, 'kept in localStorage');
  const again = run(PUBLIC, { storage });
  eq(again.sent[0].body.id, p.sent[0].body.id, 'the same id after a reload');
  const other = run(PUBLIC);
  ok(other.sent[0].body.id !== p.sent[0].body.id, 'another browser gets another random id');
  eq(run(PUBLIC, {}, { app: 'ddcs' }).sent.length + run(PUBLIC, {}, { host: 'exe' }).sent.length, 0, 'an unknown app or host: nothing is sent');
}
{ // the dev tag
  const storage = new Map();
  eq(run(PUBLIC + '?dev=1', { storage }).sent.map((s) => s.body.dev), [1, 1], '?dev=1: this browser\'s events are dev');
  eq(run(PUBLIC, { storage }).sent.map((s) => s.body.dev), [1, 1], 'remembered after a reload');
  eq(run(PUBLIC + '?dev=0', { storage }).sent.map((s) => s.body.dev), [0, 0], '?dev=0 removes the tag');
  eq(run(PUBLIC, { storage }).sent.map((s) => s.body.dev), [0, 0], 'and that is remembered too');
}

// ── the repo's own instance ──────────────────────────────────────────────────────────────────────────
eq(BUILD, 'source', "the repo's analytics.js is unbuilt (scripts/build-site.cjs stamps the site's copy)");
ok(ENDPOINT === '' || /^https:\/\/sketch-analytics\.[a-z0-9-]+\.workers\.dev\/e$/.test(ENDPOINT), `ENDPOINT is empty or the deployed Worker's /e URL: "${ENDPOINT}"`);

// ── the declared feature list == the names the code sends ─────────────────────────────────────────────
function jsFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!['tests', 'vendor', 'node_modules'].includes(e.name)) out.push(...jsFiles(p)); }
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
const sources = [...jsFiles(path.join(ROOT, 'apps')), ...jsFiles(path.join(ROOT, 'packages'))].map((p) => ({ file: rel(p), src: fs.readFileSync(p, 'utf8') }));
const IMPORTS_TRACK = /import\s*\{[^}]*\btrack\b[^}]*\}\s*from\s*['"][^'"]*\/analytics\.js['"]/;
const callers = sources.filter((s) => IMPORTS_TRACK.test(s.src));
const sent = new Map(); // feature (or family) → [file]
for (const { file, src } of callers) {
  const calls = [...src.matchAll(/\btrack\(([^)]*)\)/g)].map((m) => m[1]);
  ok(calls.length > 0, `${file} imports track and calls it`);
  for (const arg of calls) {
    const m = /^\s*(['"])([^'"]*)\1\s*(\+)?/.exec(arg);
    ok(m, `${file}: track(${arg}) names its feature with a string literal (or a declared family + an id)`);
    const [, , name, plus] = m;
    if (plus) ok(name.endsWith(':') && FEATURES.includes(name), `${file}: track('${name}' + ...) appends to a declared family`);
    else ok(FEATURES.includes(name) && isFeatureName(name), `${file}: track('${name}') is a declared feature`);
    sent.set(name, [...(sent.get(name) || []), file]);
  }
}
eq([...sent.keys()].sort(), [...FEATURES].sort(), 'every declared feature is sent from the code, and the code sends no other');
console.log('feature → call sites: ' + JSON.stringify(Object.fromEntries([...sent].map(([k, v]) => [k, [...new Set(v)]]))));
eq(sent.get('stage:'), ['packages/ui/app-chrome.js'], 'stage switches: ONE call, in the shared chrome');
eq(sent.get('template:'), ['packages/ui/project-actions.js'], 'templates: ONE call, in the shared project actions');
eq([...new Set([...sent.get('import:svg'), ...sent.get('import:dxf')])], ['packages/ui/sketch-import.js'], 'SVG / DXF imports: in the ONE shared importer');
// the families' ids are declared ids of the declared shape
const stageIds = [...shaperStagesFor({ fusion: false }), ...shaperStagesFor({ fusion: true }), ...TRACE_STAGES, ...PEN_STAGES, { id: 'design' }].map((s) => s.id);
for (const id of new Set(stageIds)) ok(FAMILY_ID.test(id) && isFeatureName('stage:' + id), `stage id "${id}" makes a declared feature`);
for (const t of TEMPLATES) ok(FAMILY_ID.test(t.id) && isFeatureName('template:' + t.id), `template id "${t.id}" makes a declared feature`);
ok(isFeatureName('template:blank'), 'template:blank (the Blank design card)');

// ── no second copy of the send code ─────────────────────────────────────────────────────────────────
for (const { file, src } of sources) {
  if (file === 'packages/ui/analytics.js') continue;
  ok(!/workers\.dev|sendBeacon|sketch-analytics-(id|dev|off)/.test(src), `${file}: no analytics endpoint, beacon or analytics storage key outside analytics.js`);
}
const startCallers = sources.filter((s) => /\bstartAnalytics\(/.test(s.src) && s.file !== 'packages/ui/analytics.js').map((s) => s.file);
eq(startCallers, ['packages/ui/app-chrome.js'], 'the visit: ONE call, in the shared chrome every app mounts');

// ── the privacy page says what the code does ─────────────────────────────────────────────────────────
const privacy = fs.readFileSync(path.join(ROOT, 'privacy.html'), 'utf8');
for (const s of ['Anonymous usage statistics', '<code>?analytics=off</code>', '<code>?analytics=on</code>', 'No cookies', 'Your IP address itself is not stored', 'Do Not Track', 'Global Privacy Control',
  "Statistiques d'utilisation anonymes", 'Aucun cookie', "Votre adresse IP elle-même n'est pas conservée"]) ok(privacy.includes(s), `privacy.html: "${s}"`);
eq(run(PUBLIC + '?analytics=off').sent.length, 0, 'the opt-out the privacy page names (?analytics=off) is the one the code reads');

console.log(`analytics-client: ${checks} checks pass`);
