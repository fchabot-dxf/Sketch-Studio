// tests/analytics-worker.test.js — TASK 738: the analytics Worker (analytics/src/index.js), run in plain Node against a STUB env (no deploy, no
// Cloudflare account, no wrangler): Node's own Request / Response / URL. Ported from the DDCS worker's test, adapted:
//   POST /e: every field validated against the declared vocabulary (packages/ui/analytics-events.js + the app registry), refused events write
//   nothing, unknown fields (an email, a file name) are never stored, the edge's country / region / city are, the IP is not; the site class from
//   the Origin header; the bot class; the dev tag.
//   /dash: the key gate (404), every query against Analytics Engine's SQL function list (AE SQL is not ClickHouse), dev / bots excluded by default,
//   days 7 | 30 | 90, the page renders each card and stays readable on a phone.
//   rollup: the cron folds yesterday per (day, event) with the dev split, idempotent, LOUD on a failure or a suspicious empty day; /rollup backfill.
//   wrangler.toml agrees with the code (dataset, name, bindings, cron, no secret in it); PROD_HOSTS == scripts/build-site.cjs SITE_HOST; the
//   migration has the columns the Worker writes; the deploy wrapper's core (placeholder refusal, loud failure, the log).
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import worker, { DATASET, PROD_HOSTS, originClass, classifyBot, validateEvent, dashQueries, runNightlyRollup } from '../analytics/src/index.js';
import { placeholderProblems, evaluateDeployResult, formatLastAttempt, parseLastLogLine } from '../analytics/deployLib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { SITE_HOST } = require('../scripts/build-site.cjs');

let checks = 0;
const ok = (c, msg) => { assert.ok(c, msg); checks++; };
const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, msg); checks++; };

// ── stubs ───────────────────────────────────────────────────────────────────────────────────────────
// an in-memory D1 that APPLIES the SQL this Worker issues (so the stored VALUES are asserted, not just "a write happened")
function makeD1() {
  const store = { rollups: [], feedback: null }; // feedback: null until CREATE TABLE IF NOT EXISTS ran (TASK 830)
  const apply = (sql, args) => {
    if (sql.startsWith('DELETE FROM rollups WHERE date >= ? AND date < ?')) store.rollups = store.rollups.filter((r) => !(r.date >= args[0] && r.date < args[1]));
    else if (sql.startsWith('INSERT INTO rollups (date, event, count, devCount)')) { const [date, event, count, devCount] = args; store.rollups.push({ date, event, count, devCount }); }
    else if (sql.startsWith('CREATE TABLE IF NOT EXISTS feedback (')) store.feedback = store.feedback || [];
    else if (sql.startsWith('INSERT INTO feedback (at, app, version, host, stars, text, email)')) {
      if (!store.feedback) throw new Error('no such table: feedback');
      const [at, app, version, host, stars, text, email] = args; store.feedback.push({ id: store.feedback.length + 1, at, app, version, host, stars, text, email });
    } else throw new Error('unexpected SQL: ' + sql);
  };
  const first = (sql, args) => {
    if (!sql.startsWith('SELECT SUM(count) AS total FROM rollups WHERE date')) throw new Error('unexpected SELECT: ' + sql);
    const rows = store.rollups.filter((r) => r.date === args[0]);
    return rows.length ? { total: rows.reduce((s, r) => s + r.count, 0) } : { total: null }; // SQL SUM over no row is NULL
  };
  const stmt = (sql) => ({ sql, args: [], bind(...a) { this.args = a; return this; }, async first() { return first(this.sql, this.args); }, async run() { apply(this.sql, this.args); return { success: true }; },
    async all() { // the dashboard's feedback list: newest first
      if (!this.sql.startsWith('SELECT at, app, version, stars, text, email FROM feedback ORDER BY id DESC')) throw new Error('unexpected SELECT: ' + this.sql);
      if (!store.feedback) throw new Error('no such table: feedback');
      return { results: [...store.feedback].reverse().map(({ id, host, ...r }) => r) };
    } });
  return { store, prepare: stmt, async batch(stmts) { for (const s of stmts) apply(s.sql, s.args); return stmts.map(() => ({ success: true })); } };
}
function makeEnv(extra = {}) {
  const ae = [];
  return { env: { DB: makeD1(), EVENTS: { writeDataPoint: (dp) => ae.push(dp) }, ...extra }, ae };
}
const BROWSER = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';
const ID = '0123456789abcdef0123456789abcdef';
const goodVisit = { event: 'visit', name: '', id: ID, app: 'shaper', version: '2026-11-16T14:05Z', host: 'web', dev: 0 };
const post = (body, { headers = {}, cf = null, path: p = '/e' } = {}) => {
  const req = new Request('https://sketch-analytics.example.workers.dev' + p, { method: 'POST', headers: { 'content-type': 'text/plain', 'user-agent': BROWSER, origin: 'https://shaper-svg.pages.dev', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  if (cf) Object.defineProperty(req, 'cf', { value: cf }); // request.cf is Cloudflare's (absent in Node)
  return req;
};

// ── AE's SQL dialect (the DDCS worker's t3918 guard): every function the Worker calls must be on Cloudflare's list
// (developers.cloudflare.com/analytics/analytics-engine/sql-reference/: aggregate, conditional, date-time, string, maths, type conversion); anything
// else gets the API's own 422 from the stub.
const AE_FUNCS = new Set(('count sum avg min max quantileExactWeighted quantileWeighted argMax argMin first_value last_value topK '
  + 'topKWeighted countIf sumIf avgIf if formatDateTime now today toDateTime toYear toMonth toDayOfWeek toDayOfMonth toHour '
  + 'toMinute toSecond toUnixTimestamp toStartOfInterval toStartOfYear toStartOfMonth toStartOfWeek toStartOfDay toStartOfHour '
  + 'toStartOfFifteenMinutes toStartOfTenMinutes toStartOfFiveMinutes toStartOfMinute toYYYYMM length empty lower lowerUTF8 '
  + 'upper upperUTF8 startsWith endsWith position substring format extract toLower toUpper intDiv log ln pow round floor ceil '
  + 'toUInt8 toUInt32').toLowerCase().split(' '));
const SQL_WORDS = new Set(['in', 'and', 'or', 'not', 'as']);
const aeUnknownCalls = (sql) => [...String(sql).matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)].map((m) => m[1]).filter((f) => !SQL_WORDS.has(f.toLowerCase()) && !AE_FUNCS.has(f.toLowerCase()));
const aeReply = (sql, data) => {
  const bad = aeUnknownCalls(sql);
  if (bad.length) return { ok: false, status: 422, text: async () => 'unknown function call: ' + bad[0] };
  return { ok: true, status: 200, text: async () => JSON.stringify({ data }) };
};
async function withAe(rowsFor, fn) {
  const seen = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (_u, init) => { const sql = String((init && init.body) || ''); seen.push(sql); return aeReply(sql, rowsFor(sql)); };
  try { await fn(); } finally { globalThis.fetch = orig; }
  return seen;
}
ok(aeUnknownCalls("SELECT toDate(timestamp), COALESCE(blob1, '') FROM x").join() === 'toDate,COALESCE', 'the dialect guard itself rejects toDate and COALESCE');

// ── POST /e ─────────────────────────────────────────────────────────────────────────────────────────
{
  const { env, ae } = makeEnv();
  const res = await worker.fetch(post(goodVisit, { headers: { 'CF-Connecting-IP': '203.0.113.7' }, cf: { country: 'CA', region: 'Quebec', city: 'Montreal' } }), env);
  eq(res.status, 204, 'a valid visit → 204');
  eq(res.headers.get('access-control-allow-origin'), '*', 'readable cross-origin (the four sites post to it)');
  eq(ae.length, 1, 'one data point');
  eq(ae[0].blobs, ['visit', '', 'CA', 'shaper', '2026-11-16T14:05Z', 'web', 'Montreal', 'Quebec', '0', 'clean', 'prod'], 'the blob layout (blob1..blob11)');
  eq(ae[0].doubles, [1], 'double1 = 1');
  eq(ae[0].indexes, [ID], 'index1 = the anonymous id');
  ok(!JSON.stringify(ae[0]).includes('203.0.113.7'), 'the IP is never stored');
}
for (const name of ['stage:prepare', 'stage:review', 'template:slot', 'template:blank', 'export:svg', 'export:shaper', 'import:fusion', 'drive:save', 'settings', 'print']) {
  const { env, ae } = makeEnv();
  const res = await worker.fetch(post({ ...goodVisit, event: 'feature', name, host: 'fusion', dev: 1 }), env);
  eq([res.status, ae.length && ae[0].blobs[0], ae.length && ae[0].blobs[1], ae.length && ae[0].blobs[5], ae.length && ae[0].blobs[8]], [204, 'feature', name, 'fusion', '1'], `feature ${name} (Fusion, dev) is stored`);
}
// refused: one bad field each → 400, nothing written
const refused = [
  ['not JSON', '{nope'],
  ['an array', '[1,2]'],
  ['an unknown event', { ...goodVisit, event: 'rating' }],
  ['a visit with a name', { ...goodVisit, name: 'stage:design' }],
  ['an undeclared feature', { ...goodVisit, event: 'feature', name: 'export:pdf' }],
  ['a family with typed text', { ...goodVisit, event: 'feature', name: 'template:My kitchen design' }],
  ['an email as a feature', { ...goodVisit, event: 'feature', name: 'template:someone@example.com' }],
  ['a file name as a feature', { ...goodVisit, event: 'feature', name: 'import:part.dxf' }],
  ['a family alone', { ...goodVisit, event: 'feature', name: 'stage:' }],
  ['an id that is not 32 hex', { ...goodVisit, id: 'someone@example.com' }],
  ['an unknown app', { ...goodVisit, app: 'ddcs' }],
  ['an unknown host', { ...goodVisit, host: 'exe' }],
  ['a version with spaces', { ...goodVisit, version: 'v 1 2' }],
  ['dev = 2', { ...goodVisit, dev: 2 }],
  ['dev as a string', { ...goodVisit, dev: '1' }],
];
for (const [what, body] of refused) {
  const { env, ae } = makeEnv();
  const res = await worker.fetch(post(body), env);
  eq([res.status, ae.length], [400, 0], `${what} → 400, nothing stored`);
}
{ // extra fields are never stored
  const { env, ae } = makeEnv();
  const res = await worker.fetch(post({ ...goodVisit, event: 'feature', name: 'export:svg', email: 'someone@example.com', fileName: 'secret-plan.svg', design: '<svg/>' }), env);
  eq(res.status, 204, 'an event with extra fields is accepted');
  const stored = JSON.stringify(ae[0]);
  ok(!/someone@example\.com|secret-plan|<svg/.test(stored), 'and its extra fields (an email, a file name, design content) are not stored: ' + stored);
}
eq(validateEvent({ ...goodVisit, extra: 1 }), { event: 'visit', name: '', id: ID, app: 'shaper', version: '2026-11-16T14:05Z', host: 'web', dev: '0' }, 'validateEvent keeps exactly the declared fields');
{
  const { env } = makeEnv();
  eq((await worker.fetch(new Request('https://x/e', { method: 'OPTIONS' }), env)).status, 204, 'OPTIONS /e → 204');
  eq((await worker.fetch(new Request('https://x/e'), env)).status, 200, 'GET /e → 200 (a liveness answer)');
  eq((await worker.fetch(post(goodVisit, { path: '/other' }), env)).status, 404, 'another path → 404');
}

// ── the site class (blob11) from the Origin header; the host is never stored ───────────────────────────
eq([...PROD_HOSTS].sort(), Object.values(SITE_HOST).sort(), 'PROD_HOSTS are the four sites of scripts/build-site.cjs SITE_HOST');
const originCases = [
  ['https://sketch-studio.pages.dev', 'prod'], ['https://shaper-svg.pages.dev', 'prod'], ['https://sketch-plotter.pages.dev', 'prod'], ['https://sketch-trace.pages.dev', 'prod'],
  ['https://a1b2c3d4.shaper-svg.pages.dev', 'preview'], ['https://agents-738.sketch-studio.pages.dev', 'preview'],
  ['http://localhost:8090', 'local'], ['http://127.0.0.1:5173', 'local'], ['http://[::1]:8090', 'local'], ['http://192.168.1.20', 'local'], ['http://10.0.0.5', 'local'],
  ['http://172.20.0.4', 'local'], ['http://shop-pc', 'local'], ['http://shop-pc.local', 'local'],
  ['null', 'file'], [null, 'none'],
  ['https://evil-shaper-svg.pages.dev', 'other'], ['https://shaper-svg.pages.dev.example.com', 'other'], ['https://172.32.0.1', 'other'], ['not a url', 'other'],
];
for (const [origin, want] of originCases) {
  const req = new Request('https://x/e', { method: 'POST', headers: origin == null ? {} : { origin } });
  eq(originClass(req), want, `Origin ${origin} → ${want}`);
}
{
  const { env, ae } = makeEnv();
  await worker.fetch(post(goodVisit, { headers: { origin: 'https://agents-738.sketch-studio.pages.dev' } }), env);
  ok(!JSON.stringify(ae[0]).includes('agents-738'), 'the Origin host is not stored, only its class');
}
// ── the bot class (blob10) ────────────────────────────────────────────────────────────────────────────
const botCases = [
  [BROWSER, {}, 'clean'],
  ['Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', {}, 'verified-crawler'],
  ['Mozilla/5.0 (Windows NT 10.0) HeadlessChrome/131.0', {}, 'ua-bot'],
  ['curl/8.4.0', {}, 'ua-bot'],
  ['', {}, 'no-ua'],
  [BROWSER, { asOrganization: 'DigitalOcean, LLC' }, 'datacenter'],
  [BROWSER, { verifiedBotCategory: 'Search Engine Crawler' }, 'verified-crawler'],
];
for (const [ua, cf, want] of botCases) eq(classifyBot(new Request('https://x/e', { headers: ua ? { 'user-agent': ua } : {} }), cf), want, `bot class of "${ua.slice(0, 40)}" ${JSON.stringify(cf)}`);

// ── /dash ───────────────────────────────────────────────────────────────────────────────────────────
const CFG = { AE_TOKEN: 'tok', ACCOUNT_ID: 'acct', DASH_KEY: 'k3y' };
{
  const { env } = makeEnv(CFG);
  eq((await worker.fetch(new Request('https://x/dash'), env)).status, 404, '/dash without a key → 404');
  eq((await worker.fetch(new Request('https://x/dash?key=nope'), env)).status, 404, '/dash with a wrong key → 404');
  eq((await worker.fetch(new Request('https://x/dash?key=k3y'), makeEnv({ DASH_KEY: 'k3y' }).env)).status, 500, '/dash unconfigured (no AE_TOKEN) → 500 with the setup message');
  eq((await worker.fetch(new Request('https://x/dash?key=k3y'), makeEnv({ AE_TOKEN: 'tok', ACCOUNT_ID: 'acct' }).env)).status, 404, 'no DASH_KEY secret at all → 404 (never open)');
}
const dashRows = (sql) => {
  if (/AS ts/.test(sql)) return [{ ts: '2026-11-16 14:05:09', country: 'CA', region: 'Quebec', city: 'Montreal', app: 'shaper', host: 'fusion' }];
  if (/AS people FROM/.test(sql) && !/GROUP BY/.test(sql)) return [{ visits: 42, people: 17 }];
  if (/AS app, SUM\(_sample_interval\) AS visits, COUNT/.test(sql)) return [{ app: 'shaper', visits: 30, people: 12 }, { app: 'trace', visits: 12, people: 5 }];
  if (/AS host/.test(sql)) return [{ host: 'web', app: 'shaper', visits: 20 }, { host: 'fusion', app: 'shaper', visits: 10 }];
  if (/AS feature/.test(sql)) return [{ feature: 'export:shaper', app: 'shaper', uses: 9 }, { feature: 'stage:prepare', app: 'shaper', uses: 7 }];
  if (/AS class/.test(sql)) return [{ class: 'clean', n: 5 }, { class: '(unclassified)', n: 2 }, { class: 'ua-bot', n: 3 }];
  if (/AS country/.test(sql)) return [{ country: 'CA', visits: 30 }, { country: 'FR', visits: 12 }];
  return [];
};
{
  const { env } = makeEnv(CFG);
  let html = '';
  const seen = await withAe(dashRows, async () => { html = await (await worker.fetch(new Request('https://x/dash?key=k3y'), env)).text(); });
  eq(seen.length, Object.keys(dashQueries({ days: 30, showDev: false, showBot: false })).length, 'one AE query per card');
  eq(seen.flatMap(aeUnknownCalls), [], 'no /dash query calls a function AE lacks');
  ok(seen.every((q) => q.includes(`FROM ${DATASET} `)), `every query reads the ${DATASET} dataset`);
  ok(seen.every((q) => /INTERVAL '30' DAY/.test(q)), 'the default window is 30 days');
  ok(seen.filter((q) => !/AS class/.test(q)).every((q) => q.includes("blob9 != '1'") && q.includes("blob10 NOT IN ('verified-crawler','ua-bot','no-ua')")), 'dev traffic and hard bots are excluded by default');
  ok(seen.find((q) => /AS class/.test(q)).includes("blob9 != '1'") && !seen.find((q) => /AS class/.test(q)).includes('blob10 NOT IN'), 'the traffic-quality card excludes dev but shows every bot class');
  ok(/if\(blob10 = '', '\(unclassified\)', blob10\)/.test(seen.find((q) => /AS class/.test(q))), "an unwritten blob10 ('') maps to (unclassified) with if(), not COALESCE");
  ok(!/quer(y|ies) failed/.test(html), 'the page reports no failed query');
  ok(html.includes('<meta name="viewport" content="width=device-width,initial-scale=1">') && html.includes('minmax(min(340px, 100%), 1fr)'), 'phone-readable: a viewport, cards that fall to one column');
  ok(html.includes('<meta name="robots" content="noindex,nofollow">'), 'not indexed');
  for (const card of ['Visits', 'By app', 'Visits per day, by app', 'Web vs Fusion', 'Top countries', 'Top features', 'Traffic quality', 'Builds by site', 'Latest visits (UTC)']) ok(html.includes(`<h2>${card}</h2>`), `the "${card}" card`);
  ok(html.includes('<div class="big">42</div>') && html.includes('17 anonymous browsers'), 'the visit total and the browsers');
  ok(html.includes('<td>fusion</td><td>shaper</td><td>10</td>'), 'web vs Fusion, per app');
  ok(html.includes('<td>export:shaper</td><td>shaper</td><td>9</td>'), 'the features table');
  ok(html.includes('real (clean + datacenter) <b style="color:#2ea043">7</b> · bot <b style="color:#e3a008">3</b>'), 'traffic quality: real 7 / bot 3');
  ok(html.includes('<td>Montreal, Quebec, Canada</td>'), 'a visit place = city, region, country name');
  ok(html.includes('"name":"Canada"'), 'the countries chart gets the country names');
  ok(html.includes('https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js'), 'Chart.js pinned to one version');
}
{
  const { env } = makeEnv(CFG);
  let html = '';
  const seen = await withAe(() => [], async () => { html = await (await worker.fetch(new Request('https://x/dash?key=k3y&days=7&dev=1&bot=1'), env)).text(); });
  ok(seen.every((q) => /INTERVAL '7' DAY/.test(q)), 'days=7');
  ok(seen.every((q) => !q.includes("blob9 != '1'") && !q.includes('blob10 NOT IN')), 'dev=1&bot=1: nothing filtered out');
  ok(html.includes('incl. dev traffic') && html.includes('>hide dev<') && html.includes('>hide bots<'), 'the header says so and offers the way back');
  ok(html.includes('href="/dash?key=k3y&days=90&dev=1&bot=1"'), 'the 90d button keeps the view');
  const seen2 = await withAe(() => [], async () => { await worker.fetch(new Request('https://x/dash?key=k3y&days=365'), env); });
  ok(seen2.every((q) => /INTERVAL '30' DAY/.test(q)), 'days outside 7 | 30 | 90 → 30');
}
{ // a failing query degrades to the errors card, the rest renders
  const { env } = makeEnv(CFG);
  const orig = globalThis.fetch;
  globalThis.fetch = async (_u, init) => (/blob6 AS host, blob4 AS app/.test(String(init.body)) ? { ok: false, status: 422, text: async () => 'unknown function call: oops' } : aeReply(String(init.body), dashRows(String(init.body))));
  let html = '';
  try { html = await (await worker.fetch(new Request('https://x/dash?key=k3y'), env)).text(); } finally { globalThis.fetch = orig; }
  ok(html.includes('1 query failed') && html.includes('<b>host</b>: HTTP 422: unknown function call: oops') && html.includes('<div class="big">42</div>'), 'one failed query: its error + SQL shown, the rest still real');
}

// ── the nightly rollup and /rollup ────────────────────────────────────────────────────────────────────
const NOW = Date.parse('2026-11-16T03:00:00Z');
const D = (date) => date + ' 00:00:00';
const quiet = (fn) => async () => { const orig = console.error; const errs = []; console.error = (m) => errs.push(String(m)); try { return { r: await fn(), errs }; } catch (e) { return { e, errs }; } finally { console.error = orig; } };
{
  const { env } = makeEnv(CFG);
  const rows = [
    { day: D('2026-11-15'), event: 'visit', dev: '0', count: 8 }, { day: D('2026-11-15'), event: 'visit', dev: '1', count: 2 },
    { day: D('2026-11-15'), event: 'feature', dev: '0', count: 5 },
  ];
  let seen = await withAe(() => rows, async () => { await runNightlyRollup(env, NOW); });
  eq(aeUnknownCalls(seen[0]), [], 'the rollup SQL uses only AE functions (no toDate)');
  ok(seen[0].includes("toDateTime('2026-11-15 00:00:00')") && seen[0].includes("< toDateTime('2026-11-16 00:00:00')"), 'the cron queries yesterday [00:00, today 00:00) UTC');
  ok(seen[0].includes(`FROM ${DATASET}`), 'from the dataset');
  const by = Object.fromEntries(env.DB.store.rollups.map((r) => [r.event, r]));
  eq([by.visit, by.feature], [{ date: '2026-11-15', event: 'visit', count: 10, devCount: 2 }, { date: '2026-11-15', event: 'feature', count: 5, devCount: 0 }], 'folded per (day, event) with the dev split');
  seen = await withAe(() => rows, async () => { await runNightlyRollup(env, NOW); });
  eq(env.DB.store.rollups.length, 2, 'a re-run replaces the day (2 rows, not 4)');
  eq(env.DB.store.rollups.find((r) => r.event === 'visit').count, 10, 'and never doubles a count');
  // scheduled() hands the same rollup to waitUntil
  const proms = [];
  await withAe(() => rows, async () => { await worker.scheduled({}, env, { waitUntil: (p) => proms.push(p) }); await Promise.all(proms); });
  eq(proms.length, 1, 'scheduled() runs the rollup through waitUntil');
}
{
  const { e, errs } = await quiet(() => runNightlyRollup(makeEnv().env, NOW))();
  ok(e && /rollup failed: unconfigured/.test(e.message) && errs.some((m) => /rollup failed: unconfigured/.test(m)), 'unconfigured → logged AND thrown (Cloudflare records the cron run as failed)');
}
{
  const { env } = makeEnv(CFG);
  const orig = globalThis.fetch; globalThis.fetch = async () => ({ ok: false, status: 422, text: async () => 'unknown function call: toDate' });
  let out; try { out = await quiet(() => runNightlyRollup(env, NOW))(); } finally { globalThis.fetch = orig; }
  ok(out.e && /rollup failed: HTTP 422: unknown function call/.test(out.e.message) && out.errs.length === 1, 'an AE failure → logged and thrown with the API reason');
  eq(env.DB.store.rollups.length, 0, 'and writes nothing');
}
{
  const { env } = makeEnv(CFG);
  env.DB.store.rollups.push({ date: '2026-11-14', event: 'visit', count: 10, devCount: 0 });
  let out; await withAe(() => [], async () => { out = await quiet(() => runNightlyRollup(env, NOW))(); });
  ok(out.e && /rollup empty: 2026-11-15 rolled up to 0 events total, but 2026-11-14 had 10/.test(out.e.message), 'an empty day after a real one → thrown with a clear message');
  const { env: env2 } = makeEnv(CFG);
  let out2; await withAe(() => [], async () => { out2 = await quiet(() => runNightlyRollup(env2, NOW))(); });
  ok(!out2.e && out2.r.ok && out2.r.total === 0, 'an empty day after a quiet one is not an alarm (real low traffic)');
}
{
  const { env } = makeEnv(CFG);
  const req = (qs, method = 'POST') => new Request('https://x/rollup?' + qs, { method });
  eq((await worker.fetch(req('key=nope'), env)).status, 404, '/rollup with a wrong key → 404');
  eq((await worker.fetch(req('key=k3y', 'GET'), env)).status, 405, 'GET /rollup → 405 (a link preview never runs it)');
  eq((await worker.fetch(req('key=k3y&from=2026-10-05&to=2026-10-01'), env)).status, 400, 'from >= to → 400');
  eq((await worker.fetch(req('key=k3y&from=yesterday'), env)).status, 400, 'not a date → 400');
  let res, body;
  const seen = await withAe(() => [
    { day: D('2026-11-01'), event: 'visit', dev: '0', count: 4 }, { day: D('2026-11-01'), event: 'visit', dev: '1', count: 1 },
    { day: D('2026-11-02'), event: 'feature', dev: '0', count: 3 },
  ], async () => { res = await worker.fetch(req('key=k3y&from=2026-11-01&to=2026-11-03'), env); body = await res.json(); });
  eq([res.status, body.ok, body.days, body.rows, body.total], [200, true, 2, 2, 8], 'the backfill reports 2 days, 2 (day, event) rows, 8 events');
  eq(seen.length, 1, 'ONE AE query per backfill');
  const seen2 = await withAe(() => [], async () => { await worker.fetch(req('key=k3y'), env); });
  const today = new Date().toISOString().slice(0, 10), from90 = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
  ok(seen2[0].includes(`toDateTime('${from90} 00:00:00')`) && seen2[0].includes(`< toDateTime('${today} 00:00:00')`), 'the default range = [today - 90 days, today)');
}

// ── wrangler.toml, the migration, the deploy wrapper ───────────────────────────────────────────────────
const toml = fs.readFileSync(path.join(ROOT, 'analytics', 'wrangler.toml'), 'utf8');
const tomlValue = (key) => { const m = toml.match(new RegExp('^' + key + '\\s*=\\s*"([^"]*)"', 'm')); return m && m[1]; };
eq(tomlValue('name'), 'sketch-analytics', 'the Worker is sketch-analytics (not the DDCS one)');
ok(fs.existsSync(path.join(ROOT, 'analytics', tomlValue('main'))), 'main points at the Worker source');
eq(tomlValue('dataset'), DATASET, 'the AE dataset of wrangler.toml == DATASET of the code');
ok(/\[\[analytics_engine_datasets\]\]\s*\nbinding = "EVENTS"/.test(toml.replace(/\r/g, '')), 'bound as env.EVENTS');
ok(/\[\[d1_databases\]\]\s*\nbinding = "DB"/.test(toml.replace(/\r/g, '')), 'D1 bound as env.DB');
ok(/^ACCOUNT_ID = "[0-9a-f]{32}"$/m.test(toml), 'ACCOUNT_ID (not secret) is set');
ok(/^crons = \["[^"]+"\]$/m.test(toml), 'a nightly cron');
ok(!/^\s*(AE_TOKEN|DASH_KEY)\s*=/m.test(toml), 'no secret in wrangler.toml');
const migration = fs.readFileSync(path.join(ROOT, 'analytics', 'migrations', '0001_rollups.sql'), 'utf8');
ok(/CREATE TABLE IF NOT EXISTS rollups/.test(migration) && ['date', 'event', 'count', 'devCount'].every((c) => new RegExp('^\\s*' + c + '\\s', 'm').test(migration)) && /PRIMARY KEY \(date, event\)/.test(migration), 'the migration has the rollups columns the Worker writes');
eq(placeholderProblems('name = "x"\n# database_id = "REPLACE-WITH-D1-ID" (a comment)\ndatabase_id = "REPLACE-WITH-D1-ID"\n'), ['database_id = "REPLACE-WITH-D1-ID"'], 'the deploy wrapper finds a placeholder (not in a comment)');
eq(placeholderProblems('database_id = "e6becbe9-e096-4d66-a142-2fcd5b84c439"\n'), [], 'and none once it is filled');
{
  const good = evaluateDeployResult({ status: 0, stdout: 'Deployed', stderr: '' });
  const bad = evaluateDeployResult({ status: 1, stdout: '', stderr: 'binding DB of type d1 must have a valid `id` specified' });
  const none = evaluateDeployResult({ status: null, error: new Error('spawn wrangler ENOENT') });
  eq([good.ok, good.exitCode, bad.ok, bad.exitCode, none.ok, none.exitCode], [true, 0, false, 1, false, 1], 'deploy results: ok → 0, failed → non-zero');
  ok(/FAILED.*exited with code 1/.test(bad.message) && /could not run: spawn wrangler ENOENT/.test(none.message) && /must have a valid/.test(bad.entry.tail), 'a failure says why, and the log keeps the tail');
  const errs = []; const warn = console.warn; console.warn = (m) => errs.push(m);
  try { eq(parseLastLogLine('{"ts":1,"ok":true}\n{"ts":2,"ok":false}\n{broken'), { ts: 2, ok: false }, 'the last VALID log line'); } finally { console.warn = warn; }
  ok(errs.length === 1, 'a corrupt log line is reported, not silently skipped');
  ok(/last attempt: FAILED, 3 days ago/.test(formatLastAttempt({ ts: Date.now() - 3 * 86400000, ok: false })), 'the last attempt is printed with its age');
}

// ── TASK 830: POST /feedback + the dashboard's Feedback section ─────────────────────────────────────────────────────────────
// the rules themselves (validateFeedback, the ask state) are tests/feedback-830.test.js; here: the endpoint, the stored row, the escaping.
{
  const { feedbackLimited, FEEDBACK_RATE, FEEDBACK_TABLE_SQL } = await import('../analytics/src/index.js');
  const good = { stars: 4, text: 'It works, but the grid is too faint', email: 'maker@example.com', app: 'shaper', version: '2026-11-16T14:05Z', host: 'web' };
  const fb = (body, opts = {}) => post(body, { path: '/feedback', ...opts });
  // the limiter is per isolate and reads the clock: each case below starts 10 minutes later than the one before (Date.now is replaced for this block), so
  // the cases that store a row never count against each other, and the burst case fills one window on purpose
  const realNow = Date.now; let clock = realNow();
  const fbEnv = (cfg) => { clock += 10 * FEEDBACK_RATE.windowMs; Date.now = () => clock; return makeEnv(cfg); };

  // accepted: ONE row, the table is created on first use, the date is the Worker's
  {
    const { env, ae } = fbEnv();
    eq(env.DB.store.feedback, null, 'no feedback table before the first message');
    const r = await worker.fetch(fb(good, { cf: { country: 'CA', city: 'Montreal', region: 'Quebec' }, headers: { 'cf-connecting-ip': '203.0.113.77', 'x-forwarded-for': '198.51.100.9' } }), env);
    eq(r.status, 204, 'a valid message is accepted (204)');
    eq(r.headers.get('access-control-allow-origin'), '*', 'with the CORS header the page needs');
    eq(env.DB.store.feedback.length, 1, 'ONE row stored (the table was created on first use)');
    const row = env.DB.store.feedback[0];
    eq({ ...row, at: undefined, id: undefined }, { at: undefined, id: undefined, app: 'shaper', version: '2026-11-16T14:05Z', host: 'web', stars: 4, text: good.text, email: 'maker@example.com' }, 'the row holds the message fields exactly');
    ok(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(row.at) && Math.abs(Date.parse(row.at) - realNow()) < 60000, 'with the date (UTC, added by the Worker)');
    // NO IP (and no place) in ANY stored value: every value of the row, and nothing went to Analytics Engine
    const everything = JSON.stringify(env.DB.store.feedback);
    ok(!/203\.0\.113\.77|198\.51\.100\.9/.test(everything), 'no IP address in any stored value (searched every value of every row)');
    ok(!/Montreal|Quebec|"CA"/.test(everything), 'and no country / region / city');
    eq(Object.keys(row).sort(), ['app', 'at', 'email', 'host', 'id', 'stars', 'text', 'version'], 'the row has only the declared columns');
    eq(ae.length, 0, 'a feedback message writes nothing to Analytics Engine');
    ok(/CREATE TABLE IF NOT EXISTS feedback/.test(FEEDBACK_TABLE_SQL) && !/\bip\b|country|city/i.test(FEEDBACK_TABLE_SQL), 'the table definition (one place) has no ip / country / city column');
  }
  // refused: nothing stored
  const refuse = async (body, status, why) => {
    const { env } = fbEnv();
    const r = await worker.fetch(fb(body), env);
    eq([r.status, env.DB.store.feedback === null || env.DB.store.feedback.length === 0], [status, true], why);
  };
  await refuse('{not json', 400, 'bad JSON → 400, nothing stored');
  await refuse({ ...good, stars: 6 }, 400, 'stars 6 → 400');
  await refuse({ ...good, stars: 0 }, 400, 'stars 0 → 400');
  await refuse({ ...good, stars: '4' }, 400, 'stars as text → 400');
  await refuse({ ...good, text: 'x'.repeat(2001) }, 400, 'text over 2000 characters → 400');
  await refuse({ ...good, email: 'not an email' }, 400, 'a malformed email → 400');
  await refuse({ ...good, app: 'frame-calc' }, 400, 'an undeclared app → 400');
  await refuse({ ...good, host: 'desktop' }, 400, 'an undeclared host → 400');
  await refuse({ ...good, version: '<script>' }, 400, 'a version that is not a build stamp → 400');
  await refuse({ ...good, stars: null, text: '   ', email: 'a@b.co' }, 400, 'no stars and no words (an email alone) → 400');
  await refuse('x'.repeat(20000), 413, 'a body over the cap → 413');
  {
    const { env } = fbEnv();
    eq((await worker.fetch(new Request('https://x/feedback', { method: 'GET' }), env)).status, 405, 'GET /feedback → 405');
    eq((await worker.fetch(new Request('https://x/feedback', { method: 'OPTIONS' }), env)).status, 204, 'the CORS preflight → 204');
  }
  // the optional parts: stars only, text only, an empty email, extra fields
  { const { env } = fbEnv(); eq((await worker.fetch(fb({ ...good, text: '', email: '' }), env)).status, 204, 'stars only, no email → accepted'); eq(env.DB.store.feedback[0].email, '', 'an empty email is stored as empty'); }
  { const { env } = fbEnv(); eq((await worker.fetch(fb({ ...good, stars: null }), env)).status, 204, 'text only, no stars → accepted'); eq(env.DB.store.feedback[0].stars, null, 'stars stored as NULL'); }
  { const { env } = fbEnv(); eq((await worker.fetch(fb({ ...good, extra: 'ignored', ip: '1.2.3.4' }), env)).status, 204, 'unknown fields are dropped, not an error'); ok(!JSON.stringify(env.DB.store.feedback).includes('1.2.3.4'), 'an extra ip field is never stored'); }
  // a failing D1: a 500 to the page (it shows its plain line, the text stays); the log has the failure, not the request
  {
    const { env } = fbEnv(); env.DB.prepare = () => ({ bind() { return this; }, async run() { throw new Error('D1 down'); } });
    const errs = []; const ce = console.error; console.error = (...a) => errs.push(a.join(' '));
    let r; try { r = await worker.fetch(fb(good, { headers: { 'cf-connecting-ip': '203.0.113.77' } }), env); } finally { console.error = ce; }
    eq(r.status, 500, 'a D1 failure → 500');
    ok(errs.length === 1 && /D1 down/.test(errs[0]) && !/203\.0\.113\.77|maker@example\.com|grid is too faint/.test(errs.join('')), 'the failure is logged, without the request: no IP, no email, no text');
  }
  // the dashboard: a Feedback section behind the key, newest first, every cell escaped
  {
    const { env } = fbEnv(CFG);
    const hostile = '</td><script>alert(1)</script><img src=x onerror=alert(2)> & "q" \'s\'';
    await worker.fetch(fb({ ...good, text: 'first <b>bold</b>', email: '', stars: 2, app: 'trace' }), env);
    await worker.fetch(fb({ ...good, text: 'x', email: '"><svg onload=alert(3)>@x.co' }), env);
    eq(env.DB.store.feedback.length, 1, '(a hostile EMAIL is refused by the format check: only the first message was stored)');
    await worker.fetch(fb({ ...good, text: hostile, email: 'a@b.co', stars: 5 }), env);
    eq(env.DB.store.feedback.length, 2, 'a hostile TEXT is stored as typed');
    let html = '';
    await withAe(dashRows, async () => { html = await (await worker.fetch(new Request('https://x/dash?key=k3y'), env)).text(); });
    ok(html.includes('<h2>Feedback (newest first, UTC)</h2>'), 'the dashboard has a Feedback section');
    ok(!/quer(y|ies) failed/.test(html), 'and no failed query');
    const section = html.slice(html.indexOf('<h2>Feedback'), html.indexOf('<h2>Latest visits'));
    ok(section.indexOf('5 / 5') > 0 && section.indexOf('5 / 5') < section.indexOf('2 / 5'), 'newest first: the later message above the earlier one');
    ok(section.includes('<td>trace</td>') && section.includes('<td>shaper</td>') && section.includes('<td>a@b.co</td>'), 'the app and the email (when given) are shown');
    ok(!section.includes('<script') && !section.includes('<img') && !section.includes('<b>bold</b>') && !section.includes('<svg'), 'XSS-safe: no tag a visitor typed survives as a tag');
    ok(section.includes('&lt;/td&gt;&lt;script&gt;alert(1)&lt;/script&gt;&lt;img src=x onerror=alert(2)&gt; &amp; &quot;q&quot; &#39;s&#39;') && section.includes('first &lt;b&gt;bold&lt;/b&gt;'), 'the typed text is shown escaped, as text');
    ok(!html.includes('<script>alert'), 'the whole page has no injected script');
    eq((await worker.fetch(new Request('https://x/dash?key=wrong'), env)).status, 404, 'the Feedback section is behind DASH_KEY (a wrong key sees nothing)');
  }
  // before any message: the table is created on first view and the section is empty; with no DB binding the failure is shown and the rest still renders
  {
    const { env } = fbEnv(CFG);
    let html = ''; await withAe(dashRows, async () => { html = await (await worker.fetch(new Request('https://x/dash?key=k3y'), env)).text(); });
    ok(/<h2>Feedback[^]*?<p class="sub">no data<\/p>/.test(html), 'before any message the section says no data');
    const env2 = { ...fbEnv(CFG).env, DB: undefined }; let html2 = ''; await withAe(dashRows, async () => { html2 = await (await worker.fetch(new Request('https://x/dash?key=k3y'), env2)).text(); });
    ok(/quer(y|ies) failed/.test(html2) && html2.includes('the DB binding is missing') && html2.includes('<h2>Visits</h2>'), 'with no DB binding the failure is shown and the rest of the page still renders');
  }
  // the rate limit: FEEDBACK_RATE.max per window per isolate, through the endpoint (one window: the clock does not move inside this case), then the limiter on its own
  {
    eq(FEEDBACK_RATE, { max: 5, windowMs: 60000 }, 'the limit is 5 messages per minute per isolate');
    const { env } = fbEnv();
    const codes = []; for (let i = 0; i < 8; i++) codes.push((await worker.fetch(fb(good), env)).status);
    eq(codes, [204, 204, 204, 204, 204, 429, 429, 429], 'through the endpoint the 6th message inside a minute is answered 429');
    eq(env.DB.store.feedback.length, 5, 'and only 5 were stored');
    const limited = await worker.fetch(fb(good), env);
    eq([limited.status, limited.headers.get('retry-after')], [429, '60'], 'a limited answer says when to retry');
    clock += FEEDBACK_RATE.windowMs + 1;
    eq((await worker.fetch(fb(good), env)).status, 204, 'a minute later the next message is taken again');
    const now = clock + 10 * FEEDBACK_RATE.windowMs;
    eq(Array.from({ length: 7 }, (_, i) => feedbackLimited(now + i)), [false, false, false, false, false, true, true], 'feedbackLimited on its own: the 6th and 7th inside a minute are limited');
    Date.now = realNow;
  }
}

console.log(`analytics-worker: ${checks} checks pass`);
