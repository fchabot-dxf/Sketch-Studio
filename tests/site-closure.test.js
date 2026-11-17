// tests/site-closure.test.js — TASK 696: each app is its own website. For each app, build its site (scripts/build-site.cjs) into a temp dir and follow
// EVERY reference from its page inside that dist (TASK 763: the app folder is the top of its site, so the page is index.html; in the repo it is
// apps/<app>/index.html) (scripts/site-closure.cjs: static / dynamic imports, the import map, CSS @import / url(),
// <script src>, <link href>, every other src= / href=, new URL(.., import.meta.url) (the Trace worker, Shaper's wood images), the site paths a module
// fetches (the glyph sheet), Pages Function routes): every one must exist in the dist, and no file of another app is in it.
//   FAIL-FIRST, kept as part of the test: in a copy of a built site a reached file is deleted, a package module is deleted and a link to another app
//   is added; the check must report all three (so a green run is not a checker that sees nothing).
//   Also: the comment / string rules of the resolver (a commented-out import and the text "import " inside a string are not references).
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { APPS, siteClosure, jsRefs } = require('../scripts/site-closure.cjs');
const { buildSite, sitePath, siteRedirects } = require('../scripts/build-site.cjs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'site-696-'));
const tree = (dir) => fs.readdirSync(dir, { withFileTypes: true }).map((e) => e.name + (e.isDirectory() ? '/' : '')).sort();
try {
  // ---- the resolver's own rules ----
  const r = jsRefs(`// import '../gone.js';\n/* import x from '../gone2.js' */\nconst s = 'import ' + (n || 'file');\nimport a from './a.js';\nconst u = new URL('../img/w.jpg', import.meta.url);\nconst re = /'\\/x.js'/;\nfetch('/assets/g.svg');\nel.innerHTML = \`<a href="../other/">x</a>\`;\nrequire('fs');`);
  assert.deepStrictEqual(r.map((x) => [x.spec, x.base, x.as]), [['./a.js', 'module', 'specifier'], ['../img/w.jpg', 'module', 'url'], ['/assets/g.svg', 'page', 'url'], ['../other/', 'page', 'url']],
    'comments, a keyword inside a string, a regex literal and require(node builtin) are not references; imports, new URL, fetched site paths and markup links are');

  // ---- the repo itself: what each app reaches outside its own folder and packages/ (the cross-app references, reported) ----
  for (const app of APPS) {
    const c = siteClosure({ root: REPO_ROOT, app });
    assert.deepStrictEqual(c.missing, [], `${app} (repo): every reference exists`);
    assert.deepStrictEqual(c.crossApp, [], `${app} (repo): no reference into another app's folder`);
    const outside = [...c.files].filter((f) => !f.startsWith(`apps/${app}/`) && !f.startsWith('packages/'));
    console.log(`${app}: reaches ${c.files.size} files; outside apps/${app}/ and packages/: ${JSON.stringify(outside)}; other apps: none; Pages Functions: ${JSON.stringify([...new Set(c.functions.map((f) => f.file))])}`);
  }

  // ---- each built site ----
  for (const app of APPS) {
    const out = path.join(tmp, app);
    buildSite(app, out);
    // TASK 763: the app folder is the top of its site (the root layout): no apps/ folder, no folder of another app
    assert.ok(!tree(out).includes('apps/'), `${app}: no apps/ folder: the app is at the top of its site`);
    assert.deepStrictEqual(tree(out).filter((n) => ['404.html', '_redirects', 'assets/', 'index.html', 'packages/', 'privacy.html'].includes(n)), ['404.html', '_redirects', 'assets/', 'index.html', 'packages/', 'privacy.html'], `${app}: the site's own files at its top`);
    for (const other of APPS.filter((a) => a !== app)) assert.ok(!fs.existsSync(path.join(out, 'apps', other)) && !fs.existsSync(path.join(out, other)), `${app}: no folder of ${other} in its site`);
    assert.ok(!fs.existsSync(path.join(out, 'functions')) && !fs.existsSync(path.join(out, 'tests')) && !fs.existsSync(path.join(out, 'packages', 'core', 'tests')), `${app}: no functions/ (wrangler compiles them from its cwd), no tests in the site`);
    const c = siteClosure({ root: out, app, entry: 'index.html', functionsRoot: REPO_ROOT });
    assert.deepStrictEqual(c.missing, [], `${app} (dist): every reference resolves inside the site`);
    assert.deepStrictEqual(c.crossApp, [], `${app} (dist): no reference into another app`);
    const repo = siteClosure({ root: REPO_ROOT, app });
    assert.deepStrictEqual([...c.files].sort(), [...repo.files].map((f) => sitePath(app, f)).sort(), `${app}: the dist serves exactly what the repo page reaches, each file at its root-layout path`);
    // the rules themselves: tests/site-root-763.test.js (every rule of every app)
    assert.strictEqual(fs.readFileSync(path.join(out, '_redirects'), 'utf8'), siteRedirects(app), `${app}: its _redirects`);
    console.log(`${app} dist: ${tree(out).join(' ')} | ${c.files.size} reached files, 0 missing, 0 other-app`);
  }

  // ---- FAIL-FIRST: a broken copy of a site must be reported ----
  const broken = path.join(tmp, 'broken');
  fs.cpSync(path.join(tmp, 'penplotter'), broken, { recursive: true });
  fs.rmSync(path.join(broken, 'assets', 'constraint-glyphs.svg'));          // the glyph sheet a module fetches
  fs.rmSync(path.join(broken, 'packages', 'ui', 'app-registry.js'));         // a shared module the sidebar imports
  const page = path.join(broken, 'index.html');
  fs.writeFileSync(page, fs.readFileSync(page, 'utf8').replace('</body>', '<a href="apps/shaper/">Shaper</a></body>')); // a link to another app
  const b = siteClosure({ root: broken, app: 'penplotter', entry: 'index.html', functionsRoot: REPO_ROOT });
  const missingTo = b.missing.map((m) => m.to);
  assert.ok(missingTo.includes('assets/constraint-glyphs.svg'), 'fail-first: the deleted glyph sheet is reported: ' + JSON.stringify(missingTo));
  assert.ok(missingTo.includes('packages/ui/app-registry.js'), 'fail-first: the deleted shared module is reported: ' + JSON.stringify(missingTo));
  assert.deepStrictEqual(b.crossApp.map((m) => m.to), ['apps/shaper/index.html'], 'fail-first: the link to another app is reported');
  console.log(`fail-first: ${b.missing.length} missing (${missingTo.join(', ')}), other app: ${b.crossApp.map((m) => m.from + ' -> ' + m.spec).join(', ')}`);
  console.log('site-closure: 4 sites, every reference inside its own site, no other app; the broken copy is caught');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
