# Sketch Studio analytics

A tiny Cloudflare Worker (`sketch-analytics`, TASK 738) that collects **anonymous, cookieless** usage events from the four apps
(Sketch, Shaper, Pen Plotter, Trace, on the web and in Shaper's Fusion 360 palette) and writes them to **Workers Analytics Engine**.
Ported from the DDCS Studio worker (`DDCS-Studio/analytics`); it has its **own** dataset (`sketch_events`), D1 database and dashboard
key, and the DDCS one is untouched.

It answers: how many **visits**, to which **app**, from which **countries**, **web vs Fusion**, and which **features** get used
(stage switches, exports, imports, templates, Drive save / open, settings).

No personal data: no IP (the country, region and city come from Cloudflare's edge), no cookie, no account, no email, no file name, no
design content, no number anyone typed. The anonymous id is a random number made in the browser (localStorage). The site's
privacy page (`privacy.html`) says so to visitors.

## One-time setup (the owner)

From `analytics/`, with `wrangler login` done:

1. Create the D1 database and its table, and paste the printed `database_id` into `wrangler.toml` (it holds `REPLACE-WITH-D1-ID` until then):
   ```
   npx wrangler d1 create sketch_analytics
   npx wrangler d1 execute sketch_analytics --remote --file=migrations/0001_rollups.sql
   ```
2. Set the two secrets (never in a file):
   ```
   npx wrangler secret put AE_TOKEN     # a Cloudflare API token with the permission Account Analytics: Read
   npx wrangler secret put DASH_KEY     # a long random string: your private dashboard key
   ```
3. Deploy: `node deploy.mjs` (see "Deploying"). Wrangler prints the URL, `https://sketch-analytics.<subdomain>.workers.dev`.
   The dataset is created by the first event.
4. Point the apps at it: in `packages/ui/analytics.js`, set
   `export const ENDPOINT = 'https://sketch-analytics.<subdomain>.workers.dev/e';`
   commit, and deploy the four sites as usual (`node scripts/build-site.cjs <app>`, README.md at the repo root). Until ENDPOINT is
   set, nothing is ever sent.

## What gets sent

`POST /e`, a text/plain JSON body: `{ event, name, id, app, version, host, dev }`, declared in `packages/ui/analytics-events.js`
(the client and this Worker import the same file; the Worker refuses, with a 400, any event with a field outside it):

| field | meaning |
|-------|---------|
| `event` | `visit` (once per page load) · `feature` |
| `name` | `''` for a visit; for a feature one of `FEATURES`: `stage:<stage id>`, `template:<template id>`, `export:svg`, `export:dxf`, `export:copy-svg`, `export:shaper`, `export:shaperhub`, `export:gcode`, `import:svg`, `import:dxf`, `import:fusion`, `import:image`, `drive:save`, `drive:open`, `settings` |
| `id` | the anonymous id (32 hex characters, localStorage), **not a person** |
| `app` | `sketchstudio` · `shaper` · `penplotter` · `trace` |
| `version` | the site's build time (`scripts/build-site.cjs` stamps it), `source` when not built |
| `host` | `web` · `fusion` (Shaper's Fusion 360 palette, `?host=fusion`) |
| `dev` | `1` = the owner's own device (see below), else `0` |

Stored in Analytics Engine as: `blob1` event · `blob2` name · `blob3` country · `blob4` app · `blob5` version · `blob6` host · `blob7` city ·
`blob8` region · `blob9` dev · `blob10` bot class (`verified-crawler` · `ua-bot` · `no-ua` · `datacenter` · `clean`) · `blob11` site class from the
`Origin` header (`prod` = one of the four `*.pages.dev` sites · `preview` = a branch / commit deploy of one · `local` · `file` · `none` · `other`; the
host itself is never stored) · `double1` = 1 · `index1` = the anonymous id.

**When the apps send** (one rule, `willSend()` in `packages/ui/analytics.js`): ENDPOINT is set AND the page is a public page (http / https on a host
name that is not localhost, a loopback / private address, a single-label or `.local` name) AND the visitor has not opted out. So a developer's
machine, the tests and the gate's headless browsers (all on 127.0.0.1) never send.

## Separating your own activity (dev)

Open each app once with `?dev=1` on each of your devices (e.g. `https://shaper-svg.pages.dev/?dev=1`; each app is its own site, so its own
localStorage: once per app and device): that browser's events from that app are tagged `dev = 1`, and the dashboard leaves them out by default
(`show dev` puts them back). `?dev=0` removes the tag. (Unlike the DDCS worker, there is no
network registration: no IP is kept at all.)

## Opting out

`?analytics=off` once stops all sending from that app's site in that browser (once per app; `?analytics=on` undoes it). A browser's Do Not Track or Global Privacy
Control setting is honoured too.

## Dashboard (`/dash`)

```
https://sketch-analytics.<subdomain>.workers.dev/dash?key=<DASH_KEY>
```

- `&days=7|30|90` (default 30; buttons in the header), `&dev=1` includes your own traffic, `&bot=1` includes the bot classes.
- Cards: visits and anonymous browsers, by app, visits per day by app, web vs Fusion (per app), top countries, top features (per app),
  traffic quality, builds by site, the latest visits (place = city, region, country; no IP). Readable on a phone.
- A wrong or missing key is a `404`. Revoke = `wrangler secret put DASH_KEY` with a new value.
- The queries run in the Worker through the Analytics Engine SQL API (the AE_TOKEN never reaches the browser); each one runs on its own: a
  failed one shows in an errors card with its SQL, the rest renders.

⛔ **AE SQL is not ClickHouse.** Only the functions on Cloudflare's
[SQL reference](https://developers.cloudflare.com/analytics/analytics-engine/sql-reference/) exist: no `toDate()`, no `COALESCE` (use
`toDateTime('YYYY-MM-DD 00:00:00')` and `if(cond, a, b)`). `tests/analytics-worker.test.js` checks every query the Worker sends against that list.

Example query (Cloudflare dashboard or the SQL API):

```sql
SELECT blob4 AS app, blob2 AS feature, SUM(_sample_interval) AS uses
FROM sketch_events
WHERE blob1 = 'feature' AND blob9 != '1' AND timestamp > NOW() - INTERVAL '30' DAY
GROUP BY app, feature ORDER BY uses DESC;
```

## Nightly rollups (D1 `rollups`) and backfill

The cron (`45 2 * * *`) folds yesterday's events into D1 `rollups` (one row per day and event type, with the dev split), so the history outlives
Analytics Engine's ~90 days. A failed OR suspiciously empty rollup (yesterday 0 events while the day before had some) THROWS, so Cloudflare
records the cron run as failed (Workers & Pages → sketch-analytics → Cron Triggers), not just a log line.

Backfill or re-run a range (idempotent: the range is replaced, never doubled; `to` is exclusive, default today; `from` defaults to 90 days ago):

```
curl -X POST "https://sketch-analytics.<subdomain>.workers.dev/rollup?key=<DASH_KEY>&from=2026-11-01&to=2026-11-16"
```

## Deploying

`node deploy.mjs`, not a bare `wrangler deploy`:
- it refuses to run while `wrangler.toml` still holds a `REPLACE-WITH` placeholder;
- it exits non-zero on a failed deploy (wrangler's own exit code) and prints an unmissable `FAILED` banner;
- it appends every attempt to `.deploy-log.jsonl` (gitignored, on this machine) and prints the last attempt's age before the next one.

## Tests (no deploy, no Cloudflare account)

- `node tests/analytics-worker.test.js`: event validation, origin and bot classes, the dev tag, every dashboard / rollup query against the AE
  function list, the rollup (idempotent, loud), /dash and /rollup gates, wrangler.toml vs the code, the deploy wrapper's core.
- `node tests/analytics-client.test.js`: the client: nothing sent from a local page or without ENDPOINT, the payload has exactly the declared
  fields, the declared feature list == the names the code sends.
- `node tests/analytics-live.test.js`: a built Shaper site in headless Edge with a local stub endpoint (this Worker's own fetch handler): a web
  visit, stage switches, an import and an export, the Fusion palette's, the dev tag, and nothing sent from 127.0.0.1.
