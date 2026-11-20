// tests/site-identity-829.test.js — TASK 829 (node): each built site's identity files and search / share tags, generated from ONE declaration per app
// (packages/ui/app-registry.js: icon, tile colour, tagline, description; SITE_HOST of build-site.cjs: the address). For every app the built site must have
// every file below and every tag, each value EQUAL to the declaration (a stale value fails: the expected values are read from the registry here, never typed):
//   favicon.svg (= the registry's icon, byte for byte), favicon.ico (16 + 32 + 48 PNG entries), apple-touch-icon.png 180, icon-192 / 512.png, og-image.png 1200 x 630,
//   manifest.webmanifest, robots.txt + sitemap.xml; the page's <head>: description, canonical, Open Graph, twitter card, JSON-LD SoftwareApplication, icon links,
//   theme-color; the intro (<h1> + the description) first in <body>, out of flow; one meta description only.
// The four approved icons (owner turns 2832-2905) are pinned by sha256: changing a drawing is a decision, not a side effect.
// FAIL-FIRST kept: a page that already has a meta description, a registry app without a tile, a description over 155 characters: each is refused.
import assert from 'node:assert';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { APPS, SUITE_NAME, SEO_INTRO_ID, appTitle } = require('../packages/ui/app-registry.js');
const { buildSite, SITE_HOST } = require('../scripts/build-site.cjs');
const id = require('../scripts/site-identity.cjs');

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const APPROVED = { // sha256 of the approved final-icons/<id>.svg (the drawings the owner approved, turns 2832-2905)
  sketchstudio: 'a88fc3ce0ae5a557f34b49b521faa47b342ed09c19577834546b9eb176ff5f11',
  shaper: '2d07048d268b645044db4836583213f47678ff5c230e7b49c1bd12862b0d208d',
  penplotter: 'eba110448c147a0c6ee3501f569da48b732dc8dccfe5daf6a87fb780a07f98c3',
  trace: '8a56d85958b59e43dbfa178ba0e08af80948c269474e134a0f78b455bd9ca9eb',
};
const pngSize = (b) => { assert.strictEqual(b.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'a PNG'); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };
const attr = (html, re) => { const m = html.match(re); assert.ok(m, `tag ${re} is in the page`); return m[1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'); };
const meta = (html, key, val) => attr(html, new RegExp(`<meta ${key}="${val}" content="([^"]*)">`));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'site-identity-829-'));
try {
  assert.deepStrictEqual(APPS.map((a) => a.id), ['sketchstudio', 'shaper', 'penplotter', 'trace']);
  for (const app of APPS) {
    const host = SITE_HOST[app.id], url = `https://${host}/`;
    // ---- the declaration ----
    assert.strictEqual(sha(app.icon), APPROVED[app.id], `${app.id}: the registry's icon is the approved drawing (sha256)`);
    assert.ok(app.description.length > 20 && app.description.length <= 155, `${app.id}: description is ${app.description.length} characters (<= 155)`);
    assert.ok(app.tagline && app.tile, `${app.id}: tagline and tile`);
    assert.strictEqual(app.icon.match(/<rect width='64' height='64' rx='14' fill='(#[0-9A-Fa-f]{6})'/)[1].toUpperCase(), app.tile.toUpperCase(), `${app.id}: the tile colour is the icon's own tile`);
    assert.ok(/viewBox='0 0 64 64'/.test(app.icon), `${app.id}: 64x64 viewBox`);

    // ---- the built site ----
    const out = path.join(tmp, app.id);
    const r = buildSite(app.id, out);
    assert.deepStrictEqual(r.identity.slice().sort(), ['apple-touch-icon.png', 'favicon.ico', 'favicon.svg', 'icon-192.png', 'icon-512.png', 'manifest.webmanifest', 'og-image.png', 'robots.txt', 'sitemap.xml'], `${app.id}: the identity files written`);
    const read = (f) => fs.readFileSync(path.join(out, f));
    assert.strictEqual(read('favicon.svg').toString('utf8'), app.icon, `${app.id}: favicon.svg is the registry's icon`);
    assert.strictEqual(sha(read('favicon.svg')), APPROVED[app.id], `${app.id}: favicon.svg is the approved file, byte for byte`);
    const ico = read('favicon.ico');
    assert.deepStrictEqual([ico.readUInt16LE(0), ico.readUInt16LE(2), ico.readUInt16LE(4)], [0, 1, 3], `${app.id}: favicon.ico: three images`);
    for (let i = 0; i < 3; i++) {
      const e = 6 + 16 * i, size = ico[e], len = ico.readUInt32LE(e + 8), off = ico.readUInt32LE(e + 12);
      assert.strictEqual(size, id.ICO_SIZES[i], `${app.id}: favicon.ico entry ${i} is ${id.ICO_SIZES[i]} px`);
      assert.deepStrictEqual(pngSize(ico.subarray(off, off + len)), [size, size], `${app.id}: favicon.ico entry ${i} holds a ${size} px PNG`);
    }
    assert.deepStrictEqual(pngSize(read('apple-touch-icon.png')), [180, 180], `${app.id}: apple-touch-icon 180`);
    assert.deepStrictEqual(pngSize(read('icon-192.png')), [192, 192], `${app.id}: icon-192`);
    assert.deepStrictEqual(pngSize(read('icon-512.png')), [512, 512], `${app.id}: icon-512`);
    assert.deepStrictEqual(pngSize(read('og-image.png')), [1200, 630], `${app.id}: og-image 1200 x 630`);
    const man = JSON.parse(read('manifest.webmanifest').toString('utf8'));
    assert.deepStrictEqual([man.name, man.short_name, man.theme_color, man.background_color, man.start_url], [appTitle(app.id), app.name, app.tile, app.tile, '/'], `${app.id}: manifest values = the declaration`);
    assert.deepStrictEqual(man.icons.map((i) => i.src), ['icon-192.png', 'icon-512.png', 'favicon.svg'], `${app.id}: manifest icons`);
    for (const i of man.icons) assert.ok(fs.existsSync(path.join(out, i.src)), `${app.id}: manifest icon ${i.src} exists`);
    assert.strictEqual(read('robots.txt').toString('utf8'), `User-agent: *\nAllow: /\n\nSitemap: ${url}sitemap.xml\n`, `${app.id}: robots.txt allows all and names the sitemap`);
    const sm = read('sitemap.xml').toString('utf8');
    assert.ok(sm.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">') && sm.trimEnd().endsWith('</urlset>'), `${app.id}: sitemap.xml is a urlset`);
    assert.deepStrictEqual([...sm.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]), id.SITE_PAGES.map((p) => `https://${host}${p}`), `${app.id}: sitemap lists the site's pages on its own host`);
    assert.ok(fs.existsSync(path.join(out, 'privacy.html')), `${app.id}: the privacy page the sitemap lists exists`);

    // ---- the built page ----
    const html = read('index.html').toString('utf8');
    assert.strictEqual((html.match(/<meta name="description"/g) || []).length, 1, `${app.id}: exactly one meta description`);
    assert.strictEqual(meta(html, 'name', 'description'), app.description, `${app.id}: meta description = the declaration`);
    assert.strictEqual(attr(html, /<link rel="canonical" href="([^"]*)">/), url, `${app.id}: canonical = the production address`);
    assert.strictEqual(meta(html, 'name', 'theme-color'), app.tile, `${app.id}: theme-color = the tile`);
    assert.strictEqual(meta(html, 'property', 'og:type'), 'website');
    assert.strictEqual(meta(html, 'property', 'og:title'), appTitle(app.id), `${app.id}: og:title`);
    assert.strictEqual(meta(html, 'property', 'og:description'), app.description, `${app.id}: og:description`);
    assert.strictEqual(meta(html, 'property', 'og:url'), url, `${app.id}: og:url`);
    assert.strictEqual(meta(html, 'property', 'og:image'), `${url}og-image.png`, `${app.id}: og:image is absolute`);
    assert.deepStrictEqual([meta(html, 'property', 'og:image:width'), meta(html, 'property', 'og:image:height')], ['1200', '630'], `${app.id}: og:image size`);
    assert.strictEqual(meta(html, 'name', 'twitter:card'), 'summary_large_image');
    assert.strictEqual(meta(html, 'name', 'twitter:image'), `${url}og-image.png`);
    assert.strictEqual(meta(html, 'name', 'twitter:description'), app.description);
    assert.deepStrictEqual(JSON.parse(attr(html, /<script type="application\/ld\+json">([^<]*)<\/script>/)),
      { '@context': 'https://schema.org', '@type': 'SoftwareApplication', name: appTitle(app.id), description: app.description, applicationCategory: 'DesignApplication', operatingSystem: 'Web browser',
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' }, url, image: `${url}og-image.png` }, `${app.id}: JSON-LD SoftwareApplication`);
    for (const l of ['<link rel="icon" href="favicon.svg" type="image/svg+xml">', '<link rel="icon" href="favicon.ico" sizes="16x16 32x32 48x48">', '<link rel="apple-touch-icon" href="apple-touch-icon.png">', '<link rel="manifest" href="manifest.webmanifest">']) assert.ok(html.includes(l), `${app.id}: ${l}`);
    // before any script runs: the head tags are above the first <script>/<link rel=stylesheet>? (they follow </title>, the page's first element after the metas)
    assert.ok(html.indexOf('<meta name="description"') < html.indexOf('<script'), `${app.id}: the tags are in the static head, before the page's first script`);
    const intro = html.match(new RegExp(`<body[^>]*>\\s*<div id="${SEO_INTRO_ID}" style="([^"]*)"><h1[^>]*>([^<]*)</h1><p[^>]*>([^<]*)</p></div>`));
    assert.ok(intro, `${app.id}: the intro is the first thing in <body>`);
    assert.ok(/position:fixed/.test(intro[1]), `${app.id}: the intro is out of flow (position:fixed): it moves nothing`);
    assert.strictEqual(intro[3].replace(/&amp;/g, '&'), app.description, `${app.id}: the intro paragraph = the description`);
    assert.ok(intro[2].startsWith(app.name), `${app.id}: the intro <h1> names the app`);
    assert.ok(!/<link rel="icon"|<meta name="description"/.test(fs.readFileSync(path.join(REPO_ROOT, 'apps', app.id, 'index.html'), 'utf8')), `${app.id}: the repo page carries no copy of these (they are generated into the built page)`);
    console.log(`${app.id}: ${r.identity.length} identity files + head tags + intro; description ${app.description.length} characters; icon sha256 ${APPROVED[app.id].slice(0, 12)}`);
  }

  // ---- the raster step: a browser scales dash values by pathLength, resvg does not ----
  const pp = APPS.find((a) => a.id === 'penplotter');
  const resolved = id.resolvePathLength(pp.icon);
  const len = id.pathLengthOf('M9 46 C17 32 23 32 29 42 S41 52 49 36');
  assert.ok(len > 40 && len < 70, `the wave's real length ${len}`);
  const dashes = [...resolved.matchAll(/stroke-dasharray='([\d.]+) ([\d.]+)'/g)].map((m) => [+m[1], +m[2]]);
  assert.strictEqual(dashes.length, 3);
  for (const [on, off] of dashes) { assert.ok(Math.abs(on * 3 - len) < 0.01, 'a third of the wave per colour'); assert.ok(Math.abs(off - on * 2) < 0.01, 'the rest is the gap'); }
  assert.strictEqual(id.resolvePathLength(APPS[0].icon), APPS[0].icon, 'an icon without pathLength is left as it is');
  assert.throws(() => id.pathLengthOf('M0 0 Q1 1 2 2'), /not handled/, 'an unhandled path command is refused, not guessed');

  // ---- FAIL-FIRST ----
  const a0 = APPS[0];
  assert.throws(() => id.injectIdentity('<html><head><title>x</title><meta name="description" content="hand copy"></head><body></body></html>', a0, 'h.example'), /already has a meta description/, 'a page with its own description is refused');
  assert.throws(() => id.injectIdentity('<html><head></head><body></body></html>', a0, 'h.example'), /no <\/title>/, 'a page without <title> is refused');
  assert.throws(() => id.registryApp('nope'), /no app "nope"/);
  assert.ok(id.identityHead({ ...a0, description: 'a < b & "c"' }, 'h.example').includes('content="a &lt; b &amp; &quot;c&quot;"'), 'values are escaped');
  console.log(`SITE-IDENTITY-829 OK (${SUITE_NAME}: ${APPS.length} apps)`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
