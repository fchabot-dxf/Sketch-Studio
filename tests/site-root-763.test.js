// tests/site-root-763.test.js — TASK 763 (owner turn 2295): each app's site serves the app at its ROOT (https://shaper-svg.pages.dev/), and every
// old /apps/<app>/ address forwards there. No browser, no server (tests/site-root-763-live.test.js serves a built site the way Cloudflare does).
//   1. siteRedirects(app): EVERY rule of EVERY app's _redirects, exactly; then what the rules mean: each old address of an app has a rule, its own
//      site's rules go to its root ('/' or '/:splat'), sketch-studio's forwards of the three other apps go to THOSE sites' roots, every rule is a
//      302 (a cached permanent redirect could loop after a rollback), and no rule matches a path the site serves (/, /privacy, the app's files,
//      packages/, assets/, the Pages Function routes).
//   2. sitePath: the root layout's one mapping.
//   3. The four built sites: the app folder at the top, no apps/ folder, the 404 page, the _redirects; checkRootLayout (the build's own proof) holds.
//   4. FAIL-FIRST, kept: a page reference that would land elsewhere at the root (a '..' that climbs only one folder) is refused by checkRootLayout,
//      on a small fake repo + its root-layout site; an app file on a reserved top-level name is refused by the build's list (RESERVED_TOP).
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildSite, siteRedirects, sitePath, checkRootLayout, SITE_HOST, NOT_FOUND_PAGE, RESERVED_TOP } = require('../scripts/build-site.cjs');
const { APPS, siteClosure } = require('../scripts/site-closure.cjs');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

// ---- 1. siteRedirects: every rule, every app ----
const rulesOf = (app) => siteRedirects(app).trim().split('\n').map((l) => l.trim().split(/\s+/));
const OWN = (app) => [[`/apps/${app}`, '/', '302'], [`/apps/${app}/index.html`, '/', '302'], [`/apps/${app}/*`, '/:splat', '302']];
const FORWARD = (app) => {
  const site = `https://${SITE_HOST[app]}`;
  return [[`/${app}`, `${site}/`, '302'], [`/apps/${app}`, `${site}/`, '302'], [`/apps/${app}/index.html`, `${site}/`, '302'], [`/apps/${app}/*`, `${site}/:splat`, '302']];
};
eq(SITE_HOST, { sketchstudio: 'sketch-studio.pages.dev', shaper: 'shaper-svg.pages.dev', penplotter: 'sketch-plotter.pages.dev', trace: 'sketch-trace.pages.dev' }, 'the four sites');
eq(rulesOf('shaper'), OWN('shaper'), 'shaper-svg: its own old addresses -> its root, nothing else');
eq(rulesOf('penplotter'), OWN('penplotter'), 'penplotter: its own old addresses -> its root, nothing else');
eq(rulesOf('trace'), OWN('trace'), 'sketch-trace: its own old addresses -> its root, nothing else');
eq(rulesOf('sketchstudio'), [...OWN('sketchstudio'), ...FORWARD('shaper'), ...FORWARD('penplotter'), ...FORWARD('trace')],
  'sketch-studio: its own old addresses -> its root; the old one-site links of the three other apps -> those sites\' roots');
ok(siteRedirects('shaper').endsWith('\n') && !siteRedirects('shaper').includes('\r'), 'one rule per line, LF');

// what a Pages rule pattern matches (a splat '*' is any rest, a ':name' placeholder one segment): used for the "matches nothing it serves" checks
const matches = (from, p) => new RegExp('^' + from.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/:\w+/g, '[^/]+') + '$').test(p);
for (const app of APPS) {
  const rules = rulesOf(app);
  for (const [from, to, status] of rules) {
    ok(status === '302', `${app}: ${from} is a 302 (temporary): a cached 301 / 308 could never be taken back`);
    ok(new Set(rules.map((r) => r[0])).size === rules.length, `${app}: each pattern once`);
    const ownSite = to.startsWith('/');
    if (ownSite) ok(to === '/' || to === '/:splat', `${app}: ${from} -> its own root (${to})`);
    else ok(APPS.some((o) => o !== app && (to === `https://${SITE_HOST[o]}/` || to === `https://${SITE_HOST[o]}/:splat`)), `${app}: ${from} -> another app's site root (${to})`);
    ok(!to.includes('/apps/'), `${app}: ${from} never forwards to an /apps/ address (${to})`);
  }
  // every old address of the app (and, on sketch-studio, of the three others) has its rule; the paths the site serves have none
  const old = [`/apps/${app}`, `/apps/${app}/`, `/apps/${app}/index.html`, `/apps/${app}/src/main.js`, `/apps/${app}/downloads/shaper-addin.zip`];
  for (const p of old) ok(rules.some(([from]) => matches(from, p)), `${app}: the old address ${p} forwards`);
  const served = ['/', '/index.html', '/privacy', '/privacy.html', '/404.html', '/main.js', '/src/main.js', '/styles/main.css', '/ui/x.js', '/downloads/shaper-addin.json',
    '/packages/ui/sketcher.css', '/packages/core/document.js', '/assets/constraint-glyphs.svg', '/auth/google/start', '/auth/google/callback', '/api/shaper-upload'];
  for (const p of served) ok(!rules.some(([from]) => matches(from, p)), `${app}: no rule matches ${p} (the site serves it)`);
  if (app === 'sketchstudio') for (const o of APPS.filter((x) => x !== app)) for (const p of [`/${o}`, `/apps/${o}`, `/apps/${o}/`, `/apps/${o}/index.html`, `/apps/${o}/src/main.js`]) {
    ok(rules.some(([from, to]) => matches(from, p) && to.startsWith(`https://${SITE_HOST[o]}/`)), `sketchstudio: ${p} forwards to ${SITE_HOST[o]}`);
  }
}

// ---- 2. sitePath ----
eq(sitePath('shaper', 'apps/shaper/index.html'), 'index.html', 'the app page is the site root page');
eq(sitePath('shaper', 'apps/shaper/src/main.js'), 'src/main.js', 'the app folder is the top of the site');
eq(sitePath('shaper', 'apps/shaper/downloads/shaper-addin.zip'), 'downloads/shaper-addin.zip', 'the add-in download (ADDIN_DOWNLOAD.dir) at /downloads/');
eq(sitePath('shaper', 'packages/ui/sketcher.css'), 'packages/ui/sketcher.css', 'packages/ keeps its path');
eq(sitePath('shaper', 'assets/constraint-glyphs.svg'), 'assets/constraint-glyphs.svg', 'a root file keeps its path');
eq(sitePath('shaper', 'apps/shaperx/index.html'), 'apps/shaperx/index.html', 'only the app\'s own folder moves');
eq(new URL('../../packages/ui/sketcher.css', 'https://shaper-svg.pages.dev/').href, 'https://shaper-svg.pages.dev/packages/ui/sketcher.css', 'the URL parser stops a ".." at the root (what the root layout leans on; checkRootLayout proves it per reference)');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'site-root-763-'));
const tree = (dir) => fs.readdirSync(dir, { withFileTypes: true }).map((e) => e.name + (e.isDirectory() ? '/' : '')).sort();
try {
  // ---- 3. the four built sites ----
  for (const app of APPS) {
    const out = path.join(tmp, app);
    const r = buildSite(app, out);
    const top = tree(out);
    ok(top.includes('index.html') && !top.includes('apps/'), `${app}: the app page at the top of its site, no apps/ folder (${top.join(' ')})`);
    const appTop = fs.readdirSync(path.join(process.cwd(), 'apps', app), { withFileTypes: true }).filter((e) => !e.name.startsWith('.') && e.name !== 'tests').map((e) => e.name + (e.isDirectory() ? '/' : ''));
    for (const n of appTop) ok(top.includes(n), `${app}: apps/${app}/${n} is at the top of the site`);
    for (const n of ['_redirects', '404.html', 'packages/', 'privacy.html', 'assets/']) ok(top.includes(n), `${app}: the site has ${n}`);
    eq(fs.readFileSync(path.join(out, '_redirects'), 'utf8'), siteRedirects(app), `${app}: the written _redirects`);
    eq(fs.readFileSync(path.join(out, '404.html'), 'utf8'), NOT_FOUND_PAGE, `${app}: the 404 page`);
    const site = checkRootLayout(app, out, siteClosure({ root: process.cwd(), app }));
    eq(site.missing, [], `${app}: every reference of the root page lands on a site file`);
    console.log(`${app}: ${r.files} files; top: ${top.join(' ')}; ${site.refs.length} references, each where the repo page's lands`);
  }

  // ---- 4. FAIL-FIRST ----
  // a fake repo: the page climbs to packages/ (fine at the root) and once to its own folder by name (not fine: at the root there is no shaper/)
  const fake = path.join(tmp, 'fake'), fakeSite = path.join(tmp, 'fake-site');
  const put = (root, rel, text) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };
  const page = (extra) => `<!doctype html><link rel="stylesheet" href="../../packages/ui/a.css"><script type="module" src="src/m.js"></script>${extra}`;
  put(fake, 'apps/shaper/src/m.js', "import '../../../packages/ui/b.js';\n");
  put(fake, 'packages/ui/a.css', 'a{}'); put(fake, 'packages/ui/b.js', '');
  put(fake, 'apps/shaper/styles/x.css', 'b{}');
  for (const f of ['src/m.js', 'packages/ui/a.css', 'packages/ui/b.js', 'styles/x.css']) put(fakeSite, f, fs.readFileSync(path.join(fake, f.startsWith('packages/') ? f : `apps/shaper/${f}`)));
  put(fake, 'apps/shaper/index.html', page('')); put(fakeSite, 'index.html', page(''));
  const good = checkRootLayout('shaper', fakeSite, siteClosure({ root: fake, app: 'shaper' }));
  eq(good.missing, [], 'fail-first control: ../../packages/ from the page and ../../../packages/ from src/m.js land on packages/ at the root');
  const bad = '<link rel="stylesheet" href="../shaper/styles/x.css">';
  put(fake, 'apps/shaper/index.html', page(bad)); put(fakeSite, 'index.html', page(bad));
  assert.throws(() => checkRootLayout('shaper', fakeSite, siteClosure({ root: fake, app: 'shaper' })),
    (e) => /root layout changes what the page loads/.test(e.message) && e.message.includes('../shaper/styles/x.css'), 'fail-first: a reference that lands elsewhere at the root fails the build');
  checks++;
  ok(['_redirects', '404.html', 'api', 'auth', 'apps', 'functions'].every((n) => RESERVED_TOP.has(n)), 'the reserved top-level names');
  console.log('fail-first: "../shaper/styles/x.css" from the page is refused (at the root it is /shaper/styles/x.css)');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(`site-root-763: ${checks} checks; 4 sites at their root, every old address forwards (302), the build proves every reference`);
