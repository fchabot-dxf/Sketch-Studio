// tests/site-closure.test.js — TASK 696: each app is its own website. For each app, build its site (scripts/build-site.cjs) into a temp dir and follow
// EVERY reference from apps/<app>/index.html inside that dist (scripts/site-closure.cjs: static / dynamic imports, the import map, CSS @import / url(),
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
const { buildSite } = require('../scripts/build-site.cjs');

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
    assert.deepStrictEqual(tree(out), ['_redirects', 'apps/', 'assets/', 'packages/', 'privacy.html'], `${app}: the top level of its site`);
    assert.deepStrictEqual(tree(path.join(out, 'apps')), [app + '/'], `${app}: no other app's folder in its site`);
    assert.ok(!fs.existsSync(path.join(out, 'functions')) && !fs.existsSync(path.join(out, 'tests')) && !fs.existsSync(path.join(out, 'packages', 'core', 'tests')), `${app}: no functions/ (wrangler compiles them from its cwd), no tests in the site`);
    const c = siteClosure({ root: out, app, functionsRoot: REPO_ROOT });
    assert.deepStrictEqual(c.missing, [], `${app} (dist): every reference resolves inside the site`);
    assert.deepStrictEqual(c.crossApp, [], `${app} (dist): no reference into another app`);
    assert.strictEqual(c.files.size, siteClosure({ root: REPO_ROOT, app }).files.size, `${app}: the dist serves exactly what the repo page reaches`);
    const redirects = fs.readFileSync(path.join(out, '_redirects'), 'utf8').trim().split('\n').map((l) => l.trim().split(/\s+/));
    assert.deepStrictEqual(redirects[0], ['/', `/apps/${app}/`, '302'], `${app}: / opens the app`);
    if (app === 'sketchstudio') {
      const old = redirects.slice(1).map((x) => x.join(' '));
      const HOST = { shaper: 'shaper-svg', penplotter: 'penplotter', trace: 'sketch-trace' }; // owner turn 1862
      for (const o of ['shaper', 'penplotter', 'trace']) {
        const site = `https://${HOST[o]}.pages.dev/apps/${o}/`;
        for (const line of [`/${o} ${site} 302`, `/apps/${o} ${site} 302`, `/apps/${o}/* ${site}:splat 302`]) assert.ok(old.includes(line), `sketchstudio keeps the old link: ${line}`);
      }
      assert.strictEqual(old.length, 9, 'sketchstudio: the old links of the three other apps, nothing else');
    } else assert.strictEqual(redirects.length, 1, `${app}: only its / rule`);
    console.log(`${app} dist: ${tree(out).join(' ')} | apps/: ${tree(path.join(out, 'apps')).join(' ')} | ${c.files.size} reached files, 0 missing, 0 other-app`);
  }

  // ---- FAIL-FIRST: a broken copy of a site must be reported ----
  const broken = path.join(tmp, 'broken');
  fs.cpSync(path.join(tmp, 'penplotter'), broken, { recursive: true });
  fs.rmSync(path.join(broken, 'assets', 'constraint-glyphs.svg'));          // the glyph sheet a module fetches
  fs.rmSync(path.join(broken, 'packages', 'ui', 'app-registry.js'));         // a shared module the sidebar imports
  const page = path.join(broken, 'apps', 'penplotter', 'index.html');
  fs.writeFileSync(page, fs.readFileSync(page, 'utf8').replace('</body>', '<a href="../shaper/">Shaper</a></body>')); // a link to another app
  const b = siteClosure({ root: broken, app: 'penplotter', functionsRoot: REPO_ROOT });
  const missingTo = b.missing.map((m) => m.to);
  assert.ok(missingTo.includes('assets/constraint-glyphs.svg'), 'fail-first: the deleted glyph sheet is reported: ' + JSON.stringify(missingTo));
  assert.ok(missingTo.includes('packages/ui/app-registry.js'), 'fail-first: the deleted shared module is reported: ' + JSON.stringify(missingTo));
  assert.deepStrictEqual(b.crossApp.map((m) => m.to), ['apps/shaper/index.html'], 'fail-first: the link to another app is reported');
  console.log(`fail-first: ${b.missing.length} missing (${missingTo.join(', ')}), other app: ${b.crossApp.map((m) => m.from + ' -> ' + m.spec).join(', ')}`);
  console.log('site-closure: 4 sites, every reference inside its own site, no other app; the broken copy is caught');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
