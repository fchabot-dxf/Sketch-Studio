/**
 * Sketch Studio analytics sink (TASK 738) — a tiny Cloudflare Worker, ported from the DDCS Studio one (DDCS-Studio/analytics, its own dataset and
 * dashboard key; that one is untouched). It receives the anonymous usage events of the four apps (POST /e), derives the visitor's COUNTRY (+ region,
 * city) from request.cf at the edge — the IP is never stored or logged — and writes ONE row per event to Workers Analytics Engine (env.EVENTS).
 * No cookie, no account, no personal data.
 *
 *   POST /e        one event (packages/ui/analytics.js sends it); validated field by field against the declared vocabulary
 *                  (packages/ui/analytics-events.js + the app ids of packages/ui/app-registry.js): anything else is refused (400), never stored.
 *   GET  /dash     the private dashboard (?key=<DASH_KEY>; a wrong or missing key is a 404)
 *   POST /rollup   the DASH_KEY-gated backfill of the D1 `rollups` table
 *   scheduled()    the nightly rollup of yesterday into D1 (LOUD on failure or a suspicious empty day)
 *
 * Event (JSON body, text/plain): { event, name, id, app, version, host, dev } — see analytics-events.js.
 * Stored as: blob1 event · blob2 name · blob3 country · blob4 app · blob5 version · blob6 host (web | fusion) · blob7 city · blob8 region ·
 * blob9 dev ('1' = the owner's own) · blob10 bot class · blob11 site class (prod | preview | local | file | none | other; never the host) ·
 * double1 = 1 · index1 = the anonymous id (the sampling key).
 */
import { EVENTS as EVENT_TYPES, HOSTS, ANON_ID, BUILD_STAMP, LOCAL_HOST, isFeatureName } from '../../packages/ui/analytics-events.js';
import { APPS } from '../../packages/ui/app-registry.js';

// THE dataset name (wrangler.toml [[analytics_engine_datasets]] dataset: tests/analytics-worker.test.js checks they agree).
export const DATASET = 'sketch_events';

// The four sites (scripts/build-site.cjs SITE_HOST: the test checks they agree). A branch / commit deploy of one is <something>.<site>.
export const PROD_HOSTS = Object.freeze(['sketch-studio.pages.dev', 'shaper-svg.pages.dev', 'sketch-plotter.pages.dev', 'sketch-trace.pages.dev']);

const APP_IDS = APPS.map((a) => a.id);
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST,OPTIONS',
  'access-control-allow-headers': 'content-type',
};
const clip = (v, n) => String(v == null ? '' : v).slice(0, n);

// ── Bot classification ─────────────────────────────────────────────────────────────────────────────
// A coarse visitor CLASS from edge-only signals (the User-Agent header + request.cf), computed at ingest (Analytics Engine is append-only). Only the
// class is stored, never the raw UA or IP.
//   'verified-crawler' a named search / AI crawler · 'ua-bot' the UA says automation (headless, curl, python ...) · 'no-ua' no User-Agent at all ·
//   'datacenter' a browser-like UA from a hosting network (a SOFT flag: VPNs exist) · 'clean' a browser from a consumer network
const CRAWLER_UA = /googlebot|bingbot|slurp|duckduckbot|baiduspider|yandex(bot|)|gptbot|oai-searchbot|chatgpt-user|claudebot|claude-web|anthropic-ai|perplexitybot|applebot|facebookexternalhit|meta-externalagent|bytespider|amazonbot|semrushbot|ahrefsbot|mj12bot|dotbot|petalbot/i;
const AUTOMATION_UA = /\bbot\b|crawl|spider|scraper|headless|phantomjs|puppeteer|playwright|selenium|python-requests|python-urllib|aiohttp|httpx|\bcurl\/|\bwget\/|go-http-client|okhttp|\bjava\/|libwww|scrapy|axios\/|node-fetch/i;
const DATACENTER_ORG = /amazon|\baws\b|digitalocean|linode|\bovh\b|hetzner|contabo|vultr|scaleway|leaseweb|choopa|\bm247\b|datacamp|alibaba|tencent|azure/i;
export const HARD_BOT = Object.freeze(['verified-crawler', 'ua-bot', 'no-ua']);

export function classifyBot(request, cf = {}) {
  const ua = (request.headers.get('user-agent') || '').trim();
  if (!ua) return 'no-ua';
  if (cf.verifiedBotCategory || CRAWLER_UA.test(ua)) return 'verified-crawler';
  if (AUTOMATION_UA.test(ua)) return 'ua-bot';
  const score = cf.botManagement && typeof cf.botManagement.score === 'number' ? cf.botManagement.score : null;
  if (score !== null && score <= 30) return 'ua-bot';
  if (DATACENTER_ORG.test(String(cf.asOrganization || ''))) return 'datacenter';
  return 'clean';
}

// WHICH SITE SERVED THE PAGE, as a class from the Origin header (the host itself is never stored):
//   'prod' one of PROD_HOSTS · 'preview' a *.<prod host> branch / commit deploy · 'local' LOCAL_HOST (analytics-events.js) · 'file' Origin "null" ·
//   'none' no Origin (curl, a script) · 'other' anything else
export function originClass(request) {
  const o = request.headers.get('origin');
  if (!o) return 'none';
  if (o === 'null') return 'file';
  let h;
  try { h = new URL(o).hostname.toLowerCase(); } catch { return 'other'; } // not a URL: filed as 'other', which is what it is
  if (PROD_HOSTS.includes(h)) return 'prod';
  if (PROD_HOSTS.some((p) => h.endsWith('.' + p))) return 'preview';
  if (LOCAL_HOST.test(h)) return 'local';
  return 'other';
}

/** The event of a request body, or { error } when any field is not of the declared vocabulary. Unknown fields are dropped, never stored. */
export function validateEvent(ev) {
  if (!ev || typeof ev !== 'object' || Array.isArray(ev)) return { error: 'not an object' };
  if (!EVENT_TYPES.includes(ev.event)) return { error: 'event' };
  const name = ev.name == null ? '' : ev.name;
  if (ev.event === 'visit' ? name !== '' : !isFeatureName(name)) return { error: 'name' };
  if (typeof ev.id !== 'string' || !ANON_ID.test(ev.id)) return { error: 'id' };
  if (!APP_IDS.includes(ev.app)) return { error: 'app' };
  if (typeof ev.version !== 'string' || !BUILD_STAMP.test(ev.version)) return { error: 'version' };
  if (!HOSTS.includes(ev.host)) return { error: 'host' };
  if (ev.dev !== 0 && ev.dev !== 1) return { error: 'dev' };
  return { event: ev.event, name, id: ev.id, app: ev.app, version: ev.version, host: ev.host, dev: ev.dev === 1 ? '1' : '0' };
}

async function handleEvent(request, env) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (request.method !== 'POST') return new Response('sketch-analytics', { status: 200, headers: CORS });
  let body;
  try { body = JSON.parse(await request.text()); } catch { return new Response('bad json', { status: 400, headers: CORS }); }
  const ev = validateEvent(body);
  if (ev.error) return new Response('bad ' + ev.error, { status: 400, headers: CORS });
  const cf = request.cf || {};
  env.EVENTS.writeDataPoint({
    blobs: [
      ev.event,                 // blob1
      ev.name,                  // blob2
      clip(cf.country, 4),      // blob3: edge-derived
      ev.app,                   // blob4
      ev.version,               // blob5
      ev.host,                  // blob6
      clip(cf.city, 64),        // blob7: edge-derived
      clip(cf.region, 64),      // blob8: edge-derived
      ev.dev,                   // blob9
      classifyBot(request, cf), // blob10
      originClass(request),     // blob11
    ],
    doubles: [1],
    indexes: [ev.id],
  });
  return new Response(null, { status: 204, headers: CORS });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/dash') return handleDash(request, env);
    if (url.pathname === '/rollup') return handleRollup(request, env);
    if (url.pathname === '/e') return handleEvent(request, env);
    return new Response('Not found', { status: 404 });
  },

  // The nightly rollup (wrangler.toml [triggers]): yesterday's events folded into D1 `rollups`. A failed OR suspiciously empty rollup THROWS, so
  // Cloudflare records the cron run itself as FAILED (Workers → the worker → Cron Triggers): a persistent place to look, not a log line nobody reads
  // (the DDCS worker's t4034 lesson).
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runNightlyRollup(env));
  },
};

export async function runNightlyRollup(env, now = Date.now()) {
  const yesterday = dayUTC(now - 86400000);
  const r = await rollupDays(env, yesterday, dayUTC(now));
  if (!r.ok) {
    const msg = 'rollup failed: ' + r.reason;
    console.error(msg);
    throw new Error(msg);
  }
  const alarm = await checkEmptyRollup(env, yesterday, r.total);
  if (alarm) {
    console.error(alarm);
    throw new Error(alarm);
  }
  return r;
}

// Yesterday folded to 0 events while the day before (already rolled up) did not: a silent failure (a dialect / binding / deploy break looks exactly
// like this). A quiet day after another quiet (or never rolled) day never alarms.
async function checkEmptyRollup(env, day, total) {
  if (total > 0) return null;
  const prevDay = dayUTC(Date.parse(day + 'T00:00:00Z') - 86400000);
  const row = await env.DB.prepare('SELECT SUM(count) AS total FROM rollups WHERE date = ?1').bind(prevDay).first();
  const prevTotal = row && row.total != null ? Number(row.total) : 0;
  if (prevTotal <= 0) return null;
  return `rollup empty: ${day} rolled up to 0 events total, but ${prevDay} had ${prevTotal} — likely a silent failure (dialect/binding/deploy), not real zero traffic`;
}

// Fold the UTC days [from, to) (YYYY-MM-DD, `to` exclusive) into D1 `rollups`: ONE AE query, ONE D1 batch. IDEMPOTENT: the range's rows are deleted and
// re-inserted in the batch, so a re-run replaces the totals, never adds to them. Each (day, event) row keeps the dev split (devCount): real users =
// count - devCount. ⛔ AE SQL is not ClickHouse: no toDate(), no COALESCE (see AE_FUNCTIONS in the test); toDateTime / toStartOfInterval only.
const ROLLUP_LIMIT = 10000;
export async function rollupDays(env, from, to) {
  if (!env.DB || !env.AE_TOKEN || !env.ACCOUNT_ID) return { ok: false, reason: 'unconfigured (the DB binding, the AE_TOKEN secret and the ACCOUNT_ID var are all needed)' };
  const sql = `SELECT toStartOfInterval(timestamp, INTERVAL '1' DAY) AS day, blob1 AS event, blob9 AS dev, SUM(_sample_interval) AS count
               FROM ${DATASET}
               WHERE timestamp >= toDateTime('${from} 00:00:00') AND timestamp < toDateTime('${to} 00:00:00')
               GROUP BY day, event, dev
               LIMIT ${ROLLUP_LIMIT}`;
  let rows;
  try { rows = await aeQuery(env, sql); } catch (e) { return { ok: false, reason: String(e && e.message || e) }; }
  if (rows.length >= ROLLUP_LIMIT) return { ok: false, reason: `${rows.length} rows hit the LIMIT — narrow the range` };

  const agg = new Map();
  for (const r of rows) {
    const date = String(r.day || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const ev = clip(r.event, 40) || '(none)';
    const c = Math.round(Number(r.count) || 0);
    const k = date + '\u0000' + ev;
    const cur = agg.get(k) || { date, ev, count: 0, devCount: 0 };
    cur.count += c;
    if (String(r.dev) === '1') cur.devCount += c;
    agg.set(k, cur);
  }
  const stmts = [env.DB.prepare('DELETE FROM rollups WHERE date >= ? AND date < ?').bind(from, to)];
  for (const v of agg.values()) {
    stmts.push(env.DB.prepare('INSERT INTO rollups (date, event, count, devCount) VALUES (?,?,?,?)').bind(v.date, v.ev, v.count, v.devCount));
  }
  try { await env.DB.batch(stmts); } catch (e) { return { ok: false, reason: String(e && e.message || e) }; }
  const total = [...agg.values()].reduce((s, v) => s + v.count, 0);
  return { ok: true, from, to, days: new Set([...agg.values()].map((v) => v.date)).size, rows: agg.size, total };
}

const dayUTC = (ms) => new Date(ms).toISOString().slice(0, 10);
const keyOk = (url, env) => { const key = url.searchParams.get('key') || ''; return !!env.DASH_KEY && key.length === env.DASH_KEY.length && key === env.DASH_KEY; };

// POST /rollup?key=<DASH_KEY>[&from=YYYY-MM-DD][&to=YYYY-MM-DD] → rollupDays(from, to) as JSON. `from` defaults to 90 days ago (AE keeps ~90 days),
// `to` (exclusive) to today, so a partial day is never frozen. A wrong key is a 404 (the route stays invisible); GET is refused (a link preview never runs it).
async function handleRollup(request, env) {
  const url = new URL(request.url);
  if (!keyOk(url, env)) return new Response('Not found', { status: 404 });
  if (request.method !== 'POST') return new Response('POST only', { status: 405 });
  const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
  const from = url.searchParams.get('from') || dayUTC(Date.now() - 90 * 86400000);
  const to = url.searchParams.get('to') || dayUTC(Date.now());
  if (!isDay(from) || !isDay(to) || from >= to) {
    return new Response(JSON.stringify({ ok: false, reason: 'from/to must be YYYY-MM-DD with from < to' }), { status: 400, headers: { 'content-type': 'application/json' } });
  }
  const r = await rollupDays(env, from, to);
  return new Response(JSON.stringify(r), { status: r.ok ? 200 : 502, headers: { 'content-type': 'application/json' } });
}

// ── The private dashboard ────────────────────────────────────────────────────────────────────────────
// GET /dash?key=<DASH_KEY>[&days=7|30|90][&dev=1][&bot=1]. The queries run here, server-side, through the Analytics Engine SQL API with the AE_TOKEN
// secret (it never reaches the browser). Each query is independent: one that fails shows in the errors card, the rest of the page renders.
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const DAY_CHOICES = Object.freeze([7, 30, 90]);

async function aeQuery(env, sql) {
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.ACCOUNT_ID}/analytics_engine/sql`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.AE_TOKEN}` },
    body: sql,
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t.slice(0, 240)}`);
  let j;
  try { j = JSON.parse(t); } catch { throw new Error('non-JSON response: ' + t.slice(0, 160)); }
  return Array.isArray(j.data) ? j.data : [];
}

/** The dashboard's queries for a view: { name: sql }. */
export function dashQueries({ days, showDev, showBot }) {
  const devF = showDev ? '' : "AND blob9 != '1'";
  const botF = showBot ? '' : `AND blob10 NOT IN (${HARD_BOT.map((b) => `'${b}'`).join(',')})`;
  const real = `${devF} ${botF}`;
  const since = `timestamp > NOW() - INTERVAL '${days}' DAY`;
  const visits = `FROM ${DATASET} WHERE blob1 = 'visit' ${real} AND ${since}`;
  return {
    total:    `SELECT SUM(_sample_interval) AS visits, COUNT(DISTINCT index1) AS people ${visits}`,
    byDayApp: `SELECT toStartOfInterval(timestamp, INTERVAL '1' DAY) AS day, blob4 AS app, SUM(_sample_interval) AS visits ${visits} GROUP BY day, app ORDER BY day`,
    app:      `SELECT blob4 AS app, SUM(_sample_interval) AS visits, COUNT(DISTINCT index1) AS people ${visits} GROUP BY app ORDER BY visits DESC`,
    host:     `SELECT blob6 AS host, blob4 AS app, SUM(_sample_interval) AS visits ${visits} GROUP BY host, app ORDER BY visits DESC`,
    country:  `SELECT blob3 AS country, SUM(_sample_interval) AS visits ${visits} GROUP BY country ORDER BY visits DESC LIMIT 25`,
    feature:  `SELECT blob2 AS feature, blob4 AS app, SUM(_sample_interval) AS uses FROM ${DATASET} WHERE blob1 = 'feature' ${real} AND ${since} GROUP BY feature, app ORDER BY uses DESC LIMIT 60`,
    version:  `SELECT blob5 AS version, blob4 AS app, blob11 AS site, SUM(_sample_interval) AS n ${visits} GROUP BY version, app, site ORDER BY n DESC LIMIT 40`,
    quality:  `SELECT if(blob10 = '', '(unclassified)', blob10) AS class, SUM(_sample_interval) AS n FROM ${DATASET} WHERE blob1 = 'visit' ${devF} AND ${since} GROUP BY class ORDER BY n DESC`,
    recent:   `SELECT toStartOfInterval(timestamp, INTERVAL '1' SECOND) AS ts, blob3 AS country, blob8 AS region, blob7 AS city, blob4 AS app, blob6 AS host ${visits} ORDER BY ts DESC LIMIT 100`,
  };
}

async function handleDash(request, env) {
  const url = new URL(request.url);
  if (!keyOk(url, env)) return new Response('Not found', { status: 404 }); // 404, not 401: the route's existence is not leaked
  if (!env.AE_TOKEN || !env.ACCOUNT_ID) {
    return new Response('Dashboard not configured: set the AE_TOKEN secret (Account Analytics: Read) and the ACCOUNT_ID var, then deploy again.', { status: 500 });
  }
  const daysReq = parseInt(url.searchParams.get('days'), 10);
  const days = DAY_CHOICES.includes(daysReq) ? daysReq : 30;
  const showDev = url.searchParams.get('dev') === '1';
  const showBot = url.searchParams.get('bot') === '1';
  const sql = dashQueries({ days, showDev, showBot });
  const keys = Object.keys(sql);
  const settled = await Promise.allSettled(keys.map((k) => aeQuery(env, sql[k])));
  const data = {}, errors = {};
  settled.forEach((s, i) => { if (s.status === 'fulfilled') data[keys[i]] = s.value; else errors[keys[i]] = String((s.reason && s.reason.message) || s.reason); });
  return new Response(renderDash({ data, errors, sql, days, showDev, showBot, key: url.searchParams.get('key') }), {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}

let REGION_NAMES; // ISO-3166 alpha-2 → country name
function countryName(code) {
  const c = String(code || '').toUpperCase();
  if (c.length !== 2) return String(code || '—');
  if (REGION_NAMES === undefined) REGION_NAMES = new Intl.DisplayNames(['en'], { type: 'region' });
  return REGION_NAMES.of(c) || c;
}

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
function table(head, rows) {
  if (!rows.length) return '<p class="sub">no data</p>';
  return `<div class="scroll"><table><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</table></div>`;
}

export function renderDash({ data, errors, sql, days, showDev, showBot, key }) {
  const k = encodeURIComponent(key || '');
  const link = (d, dev, bot) => `/dash?key=${k}&days=${d}&dev=${dev ? 1 : 0}&bot=${bot ? 1 : 0}`;
  const total = (data.total && data.total[0]) || {};
  const errKeys = Object.keys(errors);
  const payload = JSON.stringify({ byDayApp: data.byDayApp || [], app: data.app || [], country: (data.country || []).map((r) => ({ ...r, name: countryName(r.country) })) }).replace(/</g, '\\u003c');
  const hostRows = (data.host || []).map((r) => [r.host || '—', r.app || '—', num(r.visits).toLocaleString('en')]);
  const featureRows = (data.feature || []).map((r) => [r.feature || '—', r.app || '—', num(r.uses).toLocaleString('en')]);
  const versionRows = (data.version || []).map((r) => [r.version || '—', r.app || '—', r.site || '—', num(r.n).toLocaleString('en')]);
  const quality = (data.quality || []).map((r) => ({ cls: String(r.class || '(unclassified)'), n: num(r.n) }));
  const qReal = quality.filter((q) => !HARD_BOT.includes(q.cls)).reduce((s, q) => s + q.n, 0);
  const qBot = quality.filter((q) => HARD_BOT.includes(q.cls)).reduce((s, q) => s + q.n, 0);
  const recentRows = (data.recent || []).map((r) => [String(r.ts).slice(5, 16), [r.city, r.region && r.region !== r.city ? r.region : '', countryName(r.country)].filter(Boolean).join(', '), r.app || '—', r.host || '—']);

  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>Sketch Studio usage</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 15px/1.45 system-ui, sans-serif; background: #0e1116; color: #e6edf3; }
  header { padding: 14px 16px; border-bottom: 1px solid #222a35; display: flex; flex-wrap: wrap; gap: 10px; align-items: baseline; }
  h1 { font-size: 17px; margin: 0; font-weight: 600; }
  .controls { display: flex; gap: 6px; flex-wrap: wrap; }
  .controls a { color: #9db4d0; text-decoration: none; padding: 8px 12px; border: 1px solid #2a3340; border-radius: 6px; font-size: 14px; min-height: 36px; }
  .controls a.on { background: #1f6feb; border-color: #1f6feb; color: #fff; }
  .sub { color: #8b98a8; font-size: 13px; margin: 0; }
  main { padding: 16px; display: grid; gap: 14px; grid-template-columns: repeat(auto-fit, minmax(min(340px, 100%), 1fr)); max-width: 1100px; margin: 0 auto; }
  .card { background: #161b22; border: 1px solid #222a35; border-radius: 10px; padding: 14px 16px; min-width: 0; }
  .card h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .05em; color: #8b98a8; margin: 0 0 10px; font-weight: 600; }
  .big { font-size: 38px; font-weight: 700; }
  .full { grid-column: 1 / -1; }
  .scroll { max-height: 420px; overflow: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  td, th { text-align: left; padding: 6px; border-bottom: 1px solid #1d242e; }
  th { color: #8b98a8; font-weight: 500; }
  td:last-child, th:last-child { text-align: right; }
  .err { background: #2d1418; border-color: #5c2027; color: #ffb4ba; }
  pre { white-space: pre-wrap; word-break: break-word; background: #0b0e13; padding: 8px; border-radius: 6px; }
  canvas { max-height: 280px; }
</style></head><body>
<header>
  <h1>Sketch Studio · usage</h1>
  <p class="sub">last ${days} days · ${showDev ? '<b style="color:#e3a008">incl. dev traffic</b>' : 'dev traffic excluded'} · ${showBot ? 'incl. bots' : 'bots excluded'}</p>
  <nav class="controls">
    ${DAY_CHOICES.map((d) => `<a class="${d === days ? 'on' : ''}" href="${link(d, showDev, showBot)}">${d}d</a>`).join('')}
    <a href="${link(days, !showDev, showBot)}">${showDev ? 'hide dev' : 'show dev'}</a>
    <a href="${link(days, showDev, !showBot)}">${showBot ? 'hide bots' : 'show bots'}</a>
  </nav>
</header>
<main>
  <section class="card"><h2>Visits</h2><div class="big">${num(total.visits).toLocaleString('en')}</div><p class="sub">${num(total.people).toLocaleString('en')} anonymous browsers</p></section>
  <section class="card"><h2>By app</h2><canvas id="c_app"></canvas></section>
  <section class="card full"><h2>Visits per day, by app</h2><canvas id="c_day"></canvas></section>
  <section class="card"><h2>Web vs Fusion</h2>${table(['host', 'app', 'visits'], hostRows)}</section>
  <section class="card"><h2>Top countries</h2><canvas id="c_country"></canvas></section>
  <section class="card full"><h2>Top features</h2>${table(['feature', 'app', 'uses'], featureRows)}</section>
  <section class="card"><h2>Traffic quality</h2><p class="sub">real (clean + datacenter) <b style="color:#2ea043">${qReal.toLocaleString('en')}</b> · bot <b style="color:#e3a008">${qBot.toLocaleString('en')}</b></p>${table(['class', 'visits'], quality.map((q) => [q.cls + (HARD_BOT.includes(q.cls) ? ' (bot)' : ''), q.n.toLocaleString('en')]))}</section>
  <section class="card"><h2>Builds by site</h2>${table(['build', 'app', 'site', 'visits'], versionRows)}</section>
  <section class="card full"><h2>Latest visits (UTC)</h2>${table(['time', 'place', 'app', 'host'], recentRows)}</section>
  ${errKeys.length ? `<section class="card full err"><h2>${errKeys.length} quer${errKeys.length === 1 ? 'y' : 'ies'} failed</h2><p class="sub">The rest of the page is real. Likely an Analytics Engine SQL dialect difference:</p>
    ${errKeys.map((q) => `<p><b>${esc(q)}</b>: ${esc(errors[q])}</p><pre>${esc(sql[q])}</pre>`).join('')}</section>` : ''}
</main>
<script>
const P = ${payload};
const COLORS = ['#4C9AFF', '#1BE09E', '#FF8A4C', '#C084FC', '#e3a008', '#db61a2'];
const GRID = '#222a35', TXT = '#8b98a8';
const axes = (stacked) => ({ x: { stacked, grid: { color: GRID }, ticks: { color: TXT } }, y: { stacked, grid: { color: GRID }, ticks: { color: TXT }, beginAtZero: true } });
const legend = { display: true, position: 'bottom', labels: { color: '#e6edf3', boxWidth: 10 } };
if (window.Chart) {
  const days = [...new Set(P.byDayApp.map((r) => String(r.day).slice(0, 10)))].sort();
  const apps = [...new Set(P.byDayApp.map((r) => r.app || '—'))];
  new Chart(document.getElementById('c_day'), { type: 'bar', data: { labels: days.map((d) => d.slice(5)), datasets: apps.map((a, i) => ({ label: a, backgroundColor: COLORS[i % COLORS.length],
    data: days.map((d) => P.byDayApp.filter((r) => String(r.day).slice(0, 10) === d && (r.app || '—') === a).reduce((s, r) => s + Number(r.visits || 0), 0)) })) },
    options: { responsive: true, plugins: { legend }, scales: axes(true) } });
  new Chart(document.getElementById('c_app'), { type: 'doughnut', data: { labels: P.app.map((r) => (r.app || '—') + ' (' + Number(r.people || 0) + ' browsers)'), datasets: [{ data: P.app.map((r) => Number(r.visits || 0)), backgroundColor: COLORS }] },
    options: { responsive: true, plugins: { legend } } });
  new Chart(document.getElementById('c_country'), { type: 'bar', data: { labels: P.country.map((r) => r.name), datasets: [{ data: P.country.map((r) => Number(r.visits || 0)), backgroundColor: '#2ea043' }] },
    options: { indexAxis: 'y', responsive: true, plugins: { legend: { display: false } }, scales: axes(false) } });
}
</script>
</body></html>`;
}
