// tests/about-828.test.js — TASK 828 (node): the About page of every built site is generated from the declarations (nothing typed twice):
// the apps listed = the registry's APPS without `about: false` (Trace is left out, owner turn 2876), in registry order, each with its registry description
// and icon, linked to https://<SITE_HOST[id]>/; the Fusion add-in line sits INSIDE Shaper's entry (owner turn 2889, no entry of its own) with the link built from
// ADDIN_DOWNLOAD; the build stamp is the one the site stamps into analytics.js; the privacy link; every app's own site ships about.html. A stale link fails.
// The expected values are read from the declarations here, never typed (the left-out id and the page's statements are the only literals).
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { APPS } = require('../packages/ui/app-registry.js');
const { buildSite, SITE_HOST, ADDIN_DOWNLOAD, sitePath } = require('../scripts/build-site.cjs');
const { aboutHtml, aboutApps, APP_MARK } = require('../scripts/site-about.cjs');

const decode = (s) => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'about-828-'));
try {
  const shown = APPS.filter((a) => a.about !== false);
  assert.deepStrictEqual(APPS.filter((a) => a.about === false).map((a) => a.id), ['trace'], 'only Trace is hidden from the About page');
  assert.deepStrictEqual(aboutApps().map((a) => a.id), shown.map((a) => a.id));
  const addinUrl = `https://${SITE_HOST[ADDIN_DOWNLOAD.app]}/${sitePath(ADDIN_DOWNLOAD.app, ADDIN_DOWNLOAD.dir)}/${ADDIN_DOWNLOAD.zip}`;
  assert.strictEqual(addinUrl, 'https://shaper-svg.pages.dev/downloads/shaper-addin.zip');

  for (const app of APPS) {
    const r = buildSite(app.id, path.join(tmp, app.id));
    const html = fs.readFileSync(path.join(tmp, app.id, 'about.html'), 'utf8');
    assert.ok(!html.includes('<!--ABOUT:'), `${app.id}: no marker is left in about.html`);
    const items = [...html.matchAll(/<li class="app" data-app="([^"]+)">([\s\S]*?)<\/li>/g)];
    assert.deepStrictEqual(items.map((m) => m[1]), shown.map((a) => a.id), `${app.id}: the listed apps are the registry's, minus the hidden`);
    for (const [, id, body] of items) {
      const a = APPS.find((x) => x.id === id);
      assert.ok(body.includes(`<h2>${a.name}</h2>`), `${id}: the registry's name`);
      assert.strictEqual(decode(body.match(/<\/h2>\s*<p>([^<]*)<\/p>/)[1]), a.description, `${id}: the registry's approved description`);
      assert.ok(body.includes(`<a href="https://${SITE_HOST[id]}/">`), `${id}: links to its SITE_HOST address`);
      assert.ok(body.includes('data:image/svg+xml,' + encodeURIComponent(a.icon)), `${id}: carries the registry's icon`);
      const hasAddin = body.includes(addinUrl);
      assert.strictEqual(hasAddin, id === ADDIN_DOWNLOAD.app, `${id}: the add-in line only inside ${ADDIN_DOWNLOAD.app}'s entry`);
      if (hasAddin) assert.ok(body.includes(ADDIN_DOWNLOAD.about), 'the add-in line text is the declared one');
    }
    assert.strictEqual((html.match(/shaper-addin\.zip/g) || []).length, 1, `${app.id}: one add-in link, no entry of its own`);
    assert.ok(!html.includes(SITE_HOST.trace) && !/<li class="app" data-app="trace"/.test(html), `${app.id}: Trace is not on the page`);
    assert.ok(html.includes('<a href="privacy.html">'), `${app.id}: links the privacy page`);
    // TASK 828b: the Feedback link opens the shared window (#ui/feedback.js openFeedback): the page maps #ui / #core to the site's packages/ and names its own app
    assert.ok(html.includes('id="about-feedback"') && />Feedback<\/button>/.test(html), `${app.id}: the Feedback link`);
    assert.ok(/from '#ui\/feedback\.js'/.test(html) && /openFeedback\(\)/.test(html), `${app.id}: it opens the shared feedback window, no form of its own`);
    assert.ok(!/<form|mailto:|<textarea/i.test(html), `${app.id}: no second form, no mailto`);
    assert.ok(html.includes('"#ui/": "./packages/ui/"') && fs.existsSync(path.join(tmp, app.id, 'packages/ui/feedback.js')), `${app.id}: the import map reaches the site's own packages/ui/feedback.js`);
    assert.ok(html.includes(`<body data-app="${app.id}">`) && !html.includes(APP_MARK), `${app.id}: the page names its own app for the feedback message`);
    assert.ok(fs.existsSync(path.join(tmp, app.id, 'privacy.html')), `${app.id}: the privacy page it links is in the site`);
    const stamp = fs.readFileSync(path.join(tmp, app.id, 'packages/ui/analytics.js'), 'utf8').match(/export const BUILD = '([^']+)'/)[1];
    assert.ok(html.includes(`Build ${stamp}`), `${app.id}: the build stamp is the analytics version (${stamp})`);
    assert.ok(r.files > 0);
  }

  // FAIL-FIRST: a frame without its markers, an app with no address
  assert.throws(() => aboutHtml('<p>no markers</p>', {}), /must hold/);
  assert.throws(() => aboutHtml(fs.readFileSync('about.html', 'utf8'), { hostOf: {}, addinUrl, addinLine: 'x', addinApp: 'shaper', build: 'b' }), /no SITE_HOST address/);
  console.log('about-828 OK');
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
