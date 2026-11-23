// tests/addin-download-733-node.test.js — TASK 733: the Shaper sidebar's "Fusion add-in" download (owner turn 2066).
//   1. build-site.cjs shaper --addin <dir>: a FIXTURE zip + json (made here, not the real add-in) land at ADDIN_DOWNLOAD.dir of the site; without
//      --addin the build passes and the site has no download; a zip that is not the one the json describes, a missing file, or --addin on
//      another app's site fails BEFORE anything is written.
//   2. The view's json URL (apps/shaper/src/addin-download.js) is the site path build-site writes.
//   3. The declared sidebar item: Shaper declares it (hidden in Fusion mode); the other three apps never reference it.
//   4. The view reads the json: available -> the link + version; 404 or an HTML answer (Cloudflare Pages' single-page fallback) -> "not
//      available in this build"; any other failure -> shown as an error. The install steps are always listed.
//   5. Nothing binary or from the add-in's repo is tracked here (git ls-files).
import assert from 'node:assert';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { Window } from 'happy-dom';
import { SIDEBAR_ICONS, createAppSidebar } from '#ui/app-sidebar.js';
import {
  ADDIN_ACTION_ID, ADDIN_VIEW_ID, ADDIN_RELEASE_JSON, ADDIN_UNAVAILABLE, ADDIN_INSTALL_STEPS,
  fusionAddinAction, fusionAddinView, loadAddinRelease,
} from '../apps/shaper/src/addin-download.js';

const require = createRequire(import.meta.url);
const { buildSite, sitePath, ADDIN_DOWNLOAD } = require('../scripts/build-site.cjs');
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, m); checks++; };
const deepEq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const throwsLike = (fn, re, m) => { assert.throws(fn, re, m); checks++; };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'addin-733-'));
try {
  // ---- 1. build-site --addin with a fixture release
  const rel = path.join(tmp, 'release');
  fs.mkdirSync(rel);
  const zipBytes = Buffer.from('PK\u0003\u0004 fixture zip of TASK 733, not the add-in');
  const sha = crypto.createHash('sha256').update(zipBytes).digest('hex');
  fs.writeFileSync(path.join(rel, 'shaper-addin.zip'), zipBytes);
  const json = { id: 'shaper-addin', version: '9.8.7', zip: 'shaper-addin.zip', bytes: zipBytes.length, sha256: sha, files: ['shaper-addin/fixture.py'] };
  fs.writeFileSync(path.join(rel, 'shaper-addin.json'), JSON.stringify(json));

  const withAddin = buildSite('shaper', path.join(tmp, 'with'), { addin: rel });
  const siteDir = sitePath('shaper', ADDIN_DOWNLOAD.dir); // TASK 763: the app folder is the top of its site
  const dl = path.join(tmp, 'with', ...siteDir.split('/'));
  eq(ADDIN_DOWNLOAD.dir, 'apps/shaper/downloads', 'the fixed repo path (next to the page in development)');
  eq(siteDir, 'downloads', 'TASK 763: in the site, downloads/ at the top (https://shaper-svg.pages.dev/downloads/)');
  ok(fs.readFileSync(path.join(dl, 'shaper-addin.zip')).equals(zipBytes), 'the zip is at downloads/shaper-addin.zip, byte for byte');
  deepEq(JSON.parse(fs.readFileSync(path.join(dl, 'shaper-addin.json'), 'utf8')), json, 'the json is beside it, unchanged');
  deepEq(withAddin.addin, { version: '9.8.7', bytes: zipBytes.length, sha256: sha, files: ['downloads/shaper-addin.json', 'downloads/shaper-addin.zip'] }, 'buildSite reports the add-in it copied');
  ok(fs.existsSync(path.join(tmp, 'with', 'index.html')), 'the rest of the site is built as before');

  const without = buildSite('shaper', path.join(tmp, 'without'));
  eq(without.addin, null, 'no --addin: no add-in reported');
  ok(fs.existsSync(path.join(tmp, 'without', 'index.html')), 'no --addin: the build still succeeds');
  ok(!fs.existsSync(path.join(tmp, 'without', ...siteDir.split('/'))), 'no --addin: the site has no downloads folder');
  eq(without.files + 2, withAddin.files, 'the option adds exactly the two files');

  const bad = path.join(tmp, 'bad');
  fs.mkdirSync(bad);
  fs.writeFileSync(path.join(bad, 'shaper-addin.zip'), Buffer.from('another zip'));
  fs.writeFileSync(path.join(bad, 'shaper-addin.json'), JSON.stringify(json));
  throwsLike(() => buildSite('shaper', path.join(tmp, 'bad-out'), { addin: bad }), /is not the one shaper-addin\.json describes/, 'a zip the json does not describe fails');
  ok(!fs.existsSync(path.join(tmp, 'bad-out')), 'a failed --addin check writes nothing');
  throwsLike(() => buildSite('shaper', path.join(tmp, 'none-out'), { addin: path.join(tmp, 'nowhere') }), /does not exist/, 'a missing release folder fails');
  throwsLike(() => buildSite('penplotter', path.join(tmp, 'pp-out'), { addin: rel }), /--addin is for the shaper site only/, '--addin on another site fails');

  // ---- 2. the view's json URL = the path build-site writes, seen from the Shaper page
  eq(ADDIN_RELEASE_JSON, path.posix.relative('apps/shaper', `${ADDIN_DOWNLOAD.dir}/${ADDIN_DOWNLOAD.json}`), 'addin-download.js reads the json where build-site puts it');
  eq(new URL(ADDIN_RELEASE_JSON, 'http://127.0.0.1:8000/apps/shaper/').pathname, '/apps/shaper/downloads/shaper-addin.json', 'development: from /apps/shaper/');
  eq(new URL(ADDIN_RELEASE_JSON, 'http://127.0.0.1:8000/apps/shaper/index.html?host=fusion').pathname, '/apps/shaper/downloads/shaper-addin.json', 'development: from /apps/shaper/index.html');
  eq(new URL(ADDIN_RELEASE_JSON, 'https://shaper-svg.pages.dev/').pathname, `/${siteDir}/shaper-addin.json`, 'TASK 763: the site, from its root: where build-site puts it');
  eq(new URL(ADDIN_RELEASE_JSON, 'https://shaper-svg.pages.dev/?host=fusion').pathname, '/downloads/shaper-addin.json', 'TASK 763: the site in Fusion mode');

  // ---- 3. the declared item: Shaper has it (hidden in Fusion mode), the other apps never reference it
  let opened = 0;
  const normal = fusionAddinAction({ fusion: false, open: () => { opened++; } });
  eq(normal.id, ADDIN_ACTION_ID, 'id');
  eq(normal.label, 'Fusion add-in', 'label');
  eq(normal.icon, SIDEBAR_ICONS.addin, 'its icon is declared in SIDEBAR_ICONS');
  ok(typeof SIDEBAR_ICONS.addin === 'string' && SIDEBAR_ICONS.addin.startsWith('<svg'), 'SIDEBAR_ICONS.addin is an inline SVG');
  eq(normal.keepOpen, true, 'it keeps the drawer open (it opens a drawer view)');
  eq(normal.visible(), true, 'shown in the normal Shaper app');
  eq(fusionAddinAction({ fusion: true, open: () => {} }).visible(), false, 'hidden in Fusion mode');
  normal.onClick(); eq(opened, 1, 'the click opens the view');

  const mainSrc = fs.readFileSync(path.join(REPO_ROOT, 'apps/shaper/src/main.js'), 'utf8');
  ok(/fusionAddinAction\(\{ fusion: fusionMode, open: \(\) => chrome\.sidebar\.showView\(ADDIN_VIEW_ID\) \}\)/.test(mainSrc), 'Shaper declares the item in its hostActions, with its Fusion-mode flag');
  ok(/chrome\.sidebar\.registerView\(ADDIN_VIEW_ID, fusionAddinView\(\)\)/.test(mainSrc), 'Shaper registers the view');
  const sources = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : sources(p);
    return /\.(js|mjs|html)$/.test(e.name) ? [p] : [];
  });
  for (const app of ['sketchstudio', 'penplotter', 'trace']) {
    const hits = sources(path.join(REPO_ROOT, 'apps', app)).filter((f) => /addin-download|fusion-addin|fusionAddin|SIDEBAR_ICONS\.addin/.test(fs.readFileSync(f, 'utf8')));
    deepEq(hits, [], `${app} never references the Fusion add-in entry`);
  }

  // ---- 3b. the shared sidebar renders the declared item (normal) and leaves it out (Fusion mode); the click shows the view
  {
    const win = new Window({ url: 'https://shaper-svg.pages.dev/' });
    const prev = { document: globalThis.document, getComputedStyle: globalThis.getComputedStyle };
    globalThis.document = win.document;
    globalThis.getComputedStyle = win.getComputedStyle.bind(win);
    try {
      for (const fusion of [false, true]) {
        let sb = null;
        sb = createAppSidebar({ current: 'shaper', docName: null, actions: [fusionAddinAction({ fusion, open: () => sb.showView(ADDIN_VIEW_ID) })] });
        sb.registerView(ADDIN_VIEW_ID, fusionAddinView({ load: async () => ({ available: false }) }));
        sb.open();
        const item = win.document.querySelector(`.sk-sidebar [data-action="${ADDIN_ACTION_ID}"]`);
        if (fusion) eq(item, null, 'Fusion mode: no Fusion add-in item in the drawer');
        else {
          ok(item && item.textContent.includes('Fusion add-in'), 'normal: the drawer lists "Fusion add-in"');
          item.click();
          ok(sb.isOpen(), 'the drawer stays open');
          ok(win.document.querySelector('.sk-sidebar [data-addin="view"]'), 'the click shows the Fusion add-in view');
          eq(win.document.querySelector('.sk-sidebar-viewhead').textContent.trim(), '←Fusion add-in', 'the view has its back-arrow title');
        }
        sb.destroy();
      }
    } finally {
      globalThis.document = prev.document;
      globalThis.getComputedStyle = prev.getComputedStyle;
      await win.happyDOM.close();
    }
  }

  // ---- 4. the view reads the json (one code path) — loadAddinRelease against fake responses, then the rendered view
  const res = (status, type, body) => ({ status, ok: status >= 200 && status < 300, headers: { get: (h) => (h.toLowerCase() === 'content-type' ? type : null) }, json: async () => JSON.parse(body) });
  const base = 'https://shaper-svg.pages.dev/'; // TASK 763: the site's page is its root
  let asked = null;
  deepEq(await loadAddinRelease({ base, fetchImpl: async (u) => { asked = u; return res(200, 'application/json', JSON.stringify(json)); } }),
    { available: true, version: '9.8.7', bytes: zipBytes.length, zipUrl: 'https://shaper-svg.pages.dev/downloads/shaper-addin.zip' }, 'a served json: the version and the zip next to it');
  eq(asked, 'https://shaper-svg.pages.dev/downloads/shaper-addin.json', 'it asks for the json next to the page');
  deepEq(await loadAddinRelease({ base, fetchImpl: async () => res(404, 'text/plain', 'nf') }), { available: false }, '404: not in this build');
  deepEq(await loadAddinRelease({ base, fetchImpl: async () => res(200, 'text/html; charset=utf-8', '<!doctype html>') }), { available: false }, 'an HTML answer (single-page fallback): not in this build');
  await assert.rejects(loadAddinRelease({ base, fetchImpl: async () => res(500, 'text/plain', 'boom') }), /HTTP 500/); checks++;
  await assert.rejects(loadAddinRelease({ base, fetchImpl: async () => res(200, 'application/json', '{"zip":"shaper-addin.zip"}') }), /no version or zip/); checks++;

  const renderWith = async (load) => {
    const win = new Window({ url: base });
    const box = win.document.createElement('div');
    win.document.body.appendChild(box);
    fusionAddinView({ load }).render(box);
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    const out = {
      steps: [...box.querySelectorAll('[data-addin="steps"] li .txt')].map((e) => e.textContent),
      link: box.querySelector('a[data-addin="download"]'),
      version: (box.querySelector('[data-addin="version"]') || {}).textContent || null,
      unavailable: (box.querySelector('[data-addin="unavailable"]') || {}).textContent || null,
      error: (box.querySelector('[data-addin="error"]') || {}).textContent || null,
    };
    out.href = out.link ? out.link.getAttribute('href') : null;
    out.linkText = out.link ? out.link.textContent.trim() : null;
    await win.happyDOM.close();
    return out;
  };
  const avail = await renderWith(async () => ({ available: true, version: '9.8.7', bytes: 31260, zipUrl: 'https://shaper-svg.pages.dev/downloads/shaper-addin.zip' }));
  eq(avail.href, 'https://shaper-svg.pages.dev/downloads/shaper-addin.zip', 'available: the Download link points at the zip');
  eq(avail.linkText, 'Download (.zip)', 'the link reads "Download (.zip)"');
  eq(avail.version, 'Version 9.8.7 · 31 KB', 'the add-in version (and size)');
  eq(avail.unavailable, null, 'no "not available" message');
  deepEq(avail.steps, ADDIN_INSTALL_STEPS, 'the install steps are listed');
  ok(ADDIN_INSTALL_STEPS.join(' ').includes('UTILITIES tab > ADD-INS > Scripts and Add-Ins') && ADDIN_INSTALL_STEPS.join(' ').includes('green + next to My Add-Ins') && ADDIN_INSTALL_STEPS.join(' ').includes('Pick the unzipped shaper-addin folder, then Run.') && !ADDIN_INSTALL_STEPS.join(' ').includes('Run on Startup'), 'the steps name Fusion\'s menus');
  const missing = await renderWith(async () => ({ available: false }));
  eq(missing.unavailable, ADDIN_UNAVAILABLE, 'no json: "not available in this build"');
  eq(missing.link, null, 'no json: no link');
  deepEq(missing.steps, ADDIN_INSTALL_STEPS, 'no json: the steps still show');
  const failed = await renderWith(async () => { throw new Error('The add-in release could not be read (HTTP 500).'); });
  eq(failed.error, 'The add-in release could not be read (HTTP 500).', 'a failure is shown, not swallowed');

  // ---- 5. nothing binary / nothing from the add-in repo tracked in Sketch-Studio
  const tracked = execFileSync('git', ['ls-files'], { cwd: REPO_ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
  deepEq(tracked.filter((f) => /\.zip$/i.test(f)), [], 'no zip is tracked');
  deepEq(tracked.filter((f) => f.startsWith(`${ADDIN_DOWNLOAD.dir}/`)), [], 'nothing under apps/shaper/downloads/ is tracked');
  deepEq(tracked.filter((f) => /(^|\/)(shaper-addin\.(py|manifest|json)|body_extract\.py|selection_extract\.py|fusion_selection\.py|bridge\.py)$/.test(f)), [], 'no add-in source file is tracked');
  ok(execFileSync('git', ['check-ignore', '-q', '--no-index', `${ADDIN_DOWNLOAD.dir}/${ADDIN_DOWNLOAD.zip}`], { cwd: REPO_ROOT, encoding: 'utf8' }) === '', 'apps/shaper/downloads/shaper-addin.zip is git-ignored');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(`addin-download-733-node: ${checks} checks passed`);
