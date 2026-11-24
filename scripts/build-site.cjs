#!/usr/bin/env node
// scripts/build-site.cjs — TASK 696: ONE app's website (owner turns 1835-1838: "App separate website please").
//   node scripts/build-site.cjs <app> [--out <dir>]        app = sketchstudio | shaper | penplotter | trace; out defaults to ./dist
//   node scripts/build-site.cjs shaper --addin <dir>        TASK 733: also put the Fusion add-in download in the Shaper site (ADDIN_DOWNLOAD below)
//   node scripts/build-site.cjs shaper-fusion [--out <dir>] TASK 881: Shaper's FUSION PANEL, the folder the Fusion add-in carries offline (FUSION_PANEL below); out defaults to ./dist-fusion
//   (npm run site:sketchstudio / site:shaper / site:penplotter / site:trace; the panel: node scripts/build-site.cjs shaper-fusion)
// TASK 763 (owner turn 2295): the app is served at the SITE ROOT (https://shaper-svg.pages.dev/, never /apps/shaper/ in the address bar). The ROOT
// LAYOUT, one rule (sitePath below): a file of the app's own folder apps/<app>/x is written at x; every other file keeps its repo path. So <out>/ is:
//   index.html, src/, styles/, ...   the whole app folder, at the top (no other app's folder is in the site)
//   packages/        the shared packages, ONE copy in git, copied here at build time (their tests/ folders left out)
//   <root files>     the files outside apps/ and packages/ the app reaches (site-closure.cjs: e.g. assets/constraint-glyphs.svg, the glyph sheet)
//   privacy.html     the privacy page (the Google OAuth consent screen links it)
//   about.html       TASK 828: the About page: the apps of the suite (the registry's, SITE_HOST addresses) and the Shaper add-in line (ADDIN_DOWNLOAD), written into the page by site-about.cjs
//   TASK 738: the site's copy of packages/ui/analytics.js carries the build time as BUILD (stampBuild: the analytics `version`); every other file is a plain copy
//   _redirects       this site's Cloudflare Pages rules (siteRedirects below: the old /apps/<app>/ addresses forward to the root)
//   TASK 829: the site's identity, generated from the app registry (scripts/site-identity.cjs): favicon.svg / .ico, apple-touch-icon.png, icon-192 / 512.png,
//                    manifest.webmanifest, og-image.png (TASK 851: or the app's declared share image, registry ogImage), robots.txt, sitemap.xml; and the built index.html gets its <head> tags (description, Open Graph, canonical,
//                    JSON-LD, icon links) and a small intro. Search engines: the preview deployments (*.pages.dev) are not indexed by Pages itself (see NOTE below).
//   404.html         NOT_FOUND_PAGE below: an unknown address stays a 404 (without it Pages answers every unknown path with the app's index.html)
// No source file changes: the page's own references (src/main.js, styles/main.css, downloads/...) are relative to the app folder, which is now the
// top of the site; its import map and stylesheet links climb ../../packages/..., and a URL's '..' stops at the root (the WHATWG URL parser drops a
// '..' segment on an empty path: new URL('../../packages/ui/x.css', 'https://h/') is https://h/packages/ui/x.css), so they reach /packages/. The
// BUILD PROVES IT for every reference (checkRootLayout): followed from the site's index.html, each reference of the repo page lands on sitePath of
// the file it lands on in the repo, or the build fails. Local development and every test serve the repo tree unchanged (/apps/<app>/): only the
// build differs.
// The build fails (exit 1, nothing half-written is reported as done) when the app reaches a file that does not exist or a file of another app.
// Plain Node, no bundler, no dependency. The Pages Functions (functions/: the Google sign-in routes, /api/shaper-upload) are NOT copied: wrangler
// compiles ./functions from the directory it runs in ("if a functions folder exists where the command is run, that functions folder will be uploaded
// with the project", developers.cloudflare.com/pages/get-started/direct-upload/), so `wrangler pages deploy dist` is run from the repo root, and a
// Git-connected project reads functions/ from its root directory, not from the build output.
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { APPS, STANDALONE_PAGES, siteClosure, htmlParts } = require('./site-closure.cjs');
const { writeIdentity, LINKED: IDENTITY_LINKED } = require('./site-identity.cjs');
const { writeAbout } = require('./site-about.cjs');

const REPO_ROOT = path.resolve(__dirname, '..');

// Each app's own Pages project (owner turn 1862: shaper-svg, sketch-trace, sketch-studio; sketch-plotter replaces penplotter.pages.dev whose edge IPs failed Chrome ECH TLS with ERR_SSL_PROTOCOL_ERROR).
const SITE_HOST = {
  sketchstudio: 'sketch-studio.pages.dev',
  shaper: 'shaper-svg.pages.dev',
  penplotter: 'sketch-plotter.pages.dev',
  trace: 'sketch-trace.pages.dev',
};

// TASK 763: where a repo file is in <app>'s site (the ROOT LAYOUT, see the top of the file).
const sitePath = (app, rel) => (rel.startsWith(`apps/${app}/`) ? rel.slice(`apps/${app}/`.length) : rel);

// Cloudflare Pages _redirects of one site. A redirect keeps the request's query string when the destination has none (?host=fusion survives:
// wrangler's bundled pages-shared/asset-server/handler.ts builds the Location as `...${destination.search ? destination.search : search}...`); the
// browser keeps the #hash across a redirect whose Location has none. Pages matches the exact (static) rules before the :splat ones.
// 302 (temporary), not 301 / 308: a permanent redirect is cached by the browser (and the Fusion add-in's embedded one) with no way to take it back;
// were the root layout ever rolled back (/ -> /apps/<app>/ again), a cached permanent /apps/<app>/ -> / would be a redirect loop in that browser.
// TASK 763: an app's OLD address forwards to the same thing at its site's ROOT, forever (the owner's posted link; the Fusion add-in in users' hands
// opens /apps/shaper/?host=fusion): /apps/<app> and /apps/<app>/index.html -> /, any /apps/<app>/<path> (/apps/<app>/ included) -> /<path>.
const oldAddressRules = (app, site) => [
  `/apps/${app}    ${site}/    302`,
  `/apps/${app}/index.html    ${site}/    302`,
  `/apps/${app}/*    ${site}/:splat    302`,
];
function siteRedirects(app) {
  const lines = oldAddressRules(app, '');
  if (app === 'sketchstudio') { // the old one-site links keep working: they go to the other app's own site, at its root
    for (const other of APPS.filter((a) => a !== 'sketchstudio')) {
      const site = `https://${SITE_HOST[other]}`;
      lines.push(`/${other}    ${site}/    302`, ...oldAddressRules(other, site));
    }
  }
  return lines.join('\n') + '\n';
}

// NOTE (TASK 829), preview deployments and search engines: nothing is written here to keep them out of search results, because Pages already does it:
// "By default, every preview deployment generated by Cloudflare Pages includes the X-Robots-Tag: noindex HTTP response header"
// (developers.cloudflare.com/pages/configuration/preview-deployments/). The production host (SITE_HOST, <project>.pages.dev) is the one that is indexed; the
// <link rel="canonical"> in every built page names it, so a copy of the page served from a preview or another address points back to it.
// TASK 763: the site's 404 page. With the app's index.html at the top, a site without a top-level 404.html is a "single-page application" to Pages:
// every unknown path would answer 200 with the app's page (developers.cloudflare.com/pages/configuration/serving-pages/#not-found-behavior). This
// keeps what an unknown address answered before the root layout: a 404.
const NOT_FOUND_PAGE = '<!doctype html>\n<meta charset="utf-8">\n<title>Not found</title>\n<p>Not found.</p>\n';
// The names a file of the app folder may not have at its top (the root layout puts them at the top of the site): Pages' own files, the Pages
// Function routes (/api/, /auth/: a file there would never be served) and apps/ (every /apps/<app>/ path is a redirect).
const RESERVED_TOP = new Set(['_redirects', '_headers', '_routes.json', '_worker.js', '404.html', 'functions', 'api', 'auth', 'apps']);

// TASK 738: the analytics `version` of a site = when it was built. The repo's analytics.js says 'source'; the site's copy says the build time (UTC, to the minute).
const ANALYTICS_FILE = 'packages/ui/analytics.js';
const BUILD_LINE = "export const BUILD = 'source';";
function stampBuild(out, stamp) {
  const file = path.join(out, ANALYTICS_FILE);
  const src = fs.readFileSync(file, 'utf8');
  if (!src.includes(BUILD_LINE)) throw new Error(`build-site: ${ANALYTICS_FILE} has no line ${BUILD_LINE} to stamp the build into`);
  fs.writeFileSync(file, src.replace(BUILD_LINE, `export const BUILD = '${stamp}';`));
}

// TASK 733: the Fusion add-in download of the Shaper site (owner turn 2066). The zip is built by the PRIVATE shaper-addin repo (make_release.py
// writes shaper-addin.zip + shaper-addin.json into one folder) and copied here at build time ONLY (--addin <that folder>): it is never in this
// public repo (apps/shaper/downloads/ is git-ignored, and a local copy there is never copied: only --addin puts it in a site). The Shaper app's
// "Fusion add-in" view reads <dir>/<json> (apps/shaper/src/addin-download.js ADDIN_RELEASE_JSON); a site built without --addin has no json, and
// the view says the download is not available in this build. `dir` is the REPO path (next to the page in development); in the site the files are
// at sitePath of it, downloads/ (TASK 763: https://shaper-svg.pages.dev/downloads/shaper-addin.zip).
const ADDIN_DOWNLOAD = { app: 'shaper', dir: 'apps/shaper/downloads', zip: 'shaper-addin.zip', setup: 'shaper-addin-setup.exe', json: 'shaper-addin.json',
  about: 'The Fusion 360 add-in that opens Shaper in a Fusion palette.' }; // TASK 828: the one line the About page gives under Shaper, with the zip's link

// Check the release folder BEFORE the site is written (the json names the zip and optional setup, with their sha256 / size); -> what copyAddinDownload copies.
function readAddinRelease(fromDir) {
  const src = path.resolve(fromDir);
  const jsonFile = path.join(src, ADDIN_DOWNLOAD.json), zipFile = path.join(src, ADDIN_DOWNLOAD.zip);
  for (const f of [jsonFile, zipFile]) if (!fs.existsSync(f)) throw new Error(`build-site --addin: ${f} does not exist (run shaper-addin's make_release.py --out ${fromDir})`);
  const info = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
  if (info.zip !== ADDIN_DOWNLOAD.zip) throw new Error(`build-site --addin: ${ADDIN_DOWNLOAD.json} names the zip "${info.zip}", expected "${ADDIN_DOWNLOAD.zip}"`);
  if (typeof info.version !== 'string' || !info.version) throw new Error(`build-site --addin: ${ADDIN_DOWNLOAD.json} has no version`);
  const zip = fs.readFileSync(zipFile);
  const sha = crypto.createHash('sha256').update(zip).digest('hex');
  if (info.sha256 !== sha || info.bytes !== zip.length) throw new Error(`build-site --addin: ${ADDIN_DOWNLOAD.zip} (${zip.length} bytes, sha256 ${sha}) is not the one ${ADDIN_DOWNLOAD.json} describes (${info.bytes} bytes, sha256 ${info.sha256})`);
  if (info.setup == null) return { jsonFile, zipFile, version: info.version, bytes: zip.length, sha256: sha, setupFile: null };
  if (info.setup !== ADDIN_DOWNLOAD.setup) throw new Error(`build-site --addin: ${ADDIN_DOWNLOAD.json} names the setup "${info.setup}", expected "${ADDIN_DOWNLOAD.setup}"`);
  const setupFile = path.join(src, info.setup);
  if (!fs.existsSync(setupFile)) throw new Error(`build-site --addin: ${setupFile} does not exist (run shaper-addin's make_release.py --out ${fromDir})`);
  const setupBuf = fs.readFileSync(setupFile);
  const setupSha = crypto.createHash('sha256').update(setupBuf).digest('hex');
  if (info.setup_sha256 !== setupSha || info.setup_bytes !== setupBuf.length) {
    throw new Error(`build-site --addin: ${info.setup} (${setupBuf.length} bytes, sha256 ${setupSha}) is not the one ${ADDIN_DOWNLOAD.json} describes (${info.setup_bytes} bytes, sha256 ${info.setup_sha256})`);
  }
  return { jsonFile, zipFile, version: info.version, bytes: zip.length, sha256: sha, setupFile, setup: info.setup, setupBytes: setupBuf.length, setupSha256: setupSha };
}
// ... and copy release files to <out>/<sitePath of ADDIN_DOWNLOAD.dir>/.
function copyAddinDownload(release, out) {
  const dir = sitePath(ADDIN_DOWNLOAD.app, ADDIN_DOWNLOAD.dir);
  const dst = path.join(out, ...dir.split('/'));
  fs.mkdirSync(dst, { recursive: true });
  fs.copyFileSync(release.jsonFile, path.join(dst, ADDIN_DOWNLOAD.json));
  fs.copyFileSync(release.zipFile, path.join(dst, ADDIN_DOWNLOAD.zip));
  const files = [`${dir}/${ADDIN_DOWNLOAD.json}`, `${dir}/${ADDIN_DOWNLOAD.zip}`];
  const outInfo = { version: release.version, bytes: release.bytes, sha256: release.sha256, files };
  if (release.setupFile) {
    fs.copyFileSync(release.setupFile, path.join(dst, release.setup));
    files.push(`${dir}/${release.setup}`);
    outInfo.setup = release.setup;
    outInfo.setupBytes = release.setupBytes;
    outInfo.setupSha256 = release.setupSha256;
  }
  return outInfo;
}

const SKIP_DIRS = new Set(['tests', 'node_modules']);
const SKIP_PATHS = new Set([path.join(REPO_ROOT, ...ADDIN_DOWNLOAD.dir.split('/'))]); // only --addin puts the download in a site
// the repo files (repo-relative, '/') under a folder that go into a site
function listTree(src, list) {
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue; // .gitignore and the like: not part of a site
    const s = path.join(src, e.name);
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name) && !SKIP_PATHS.has(s)) listTree(s, list); }
    else if (e.isFile()) list.push(path.relative(REPO_ROOT, s).split(path.sep).join('/'));
  }
  return list;
}

// TASK 763: the proof of the root layout (see the top of the file), run on the written site. The repo page's references, each mapped through
// sitePath, must be exactly the site page's references: same file, same spec, same target. A reference that lands elsewhere at the root, or on
// nothing, fails the build.
function checkRootLayout(app, out, repoClosure) {
  const site = siteClosure({ root: out, app, entry: 'index.html', functionsRoot: REPO_ROOT });
  const key = (r) => `${r.from} | ${r.spec} -> ${r.to}`;
  // TASK 829: the built page links the generated identity files (favicon.svg ...): they are not in the repo page, and they are not what this proves
  site.refs = site.refs.filter((r) => !(r.from === 'index.html' && IDENTITY_LINKED.includes(r.to)));
  site.missing = site.missing.filter((m) => !(m.from === 'index.html' && IDENTITY_LINKED.includes(m.to)));
  const want = new Set(repoClosure.refs.map((r) => key({ ...r, from: sitePath(app, r.from), to: sitePath(app, r.to) })));
  const got = new Set(site.refs.map(key));
  const lines = [...site.missing.map((m) => `  missing in the site   ${m.from} -> ${m.spec} (${m.to})`),
    ...[...want].filter((k) => !got.has(k)).map((k) => `  not as in the repo    ${k}`),
    ...[...got].filter((k) => !want.has(k)).map((k) => `  not in the repo page  ${k}`)];
  if (lines.length) throw new Error(`build-site ${app}: the root layout changes what the page loads:\n${lines.join('\n')}`);
  return site;
}

// The folder a build writes (it is emptied first): never the repo or a parent of it; inside the repo only its own default folder (`allowed`: dist/, or
// TASK 881 dist-fusion/ for the Fusion panel; both git-ignored).
function outFolder(outDir, allowed) {
  const out = path.resolve(outDir);
  const rel = path.relative(out, REPO_ROOT);
  const insideRepo = !path.relative(REPO_ROOT, out).startsWith('..') && !path.isAbsolute(path.relative(REPO_ROOT, out));
  if (out === REPO_ROOT || (!rel.startsWith('..') && !path.isAbsolute(rel)) || (insideRepo && out !== path.join(REPO_ROOT, allowed))) {
    throw new Error(`build-site: refusing to write into ${out} (it is emptied first: inside the repo only ${allowed}/ is allowed, never the repo or a parent of it)`);
  }
  return out;
}

function buildSite(app, outDir = path.join(REPO_ROOT, 'dist'), { addin = null } = {}) {
  if (!APPS.includes(app)) throw new Error(`build-site: app must be one of ${APPS.join(' | ')}, got "${app}"`);
  if (addin != null && app !== ADDIN_DOWNLOAD.app) throw new Error(`build-site: --addin is for the ${ADDIN_DOWNLOAD.app} site only, not "${app}"`);
  const out = outFolder(outDir, 'dist');
  const closure = siteClosure({ root: REPO_ROOT, app });
  if (closure.missing.length || closure.crossApp.length) {
    const lines = [...closure.missing.map((m) => `  missing   ${m.from} -> ${m.spec} (${m.to})`), ...closure.crossApp.map((m) => `  other app ${m.from} -> ${m.spec} (${m.to})`)];
    throw new Error(`build-site ${app}: the app reaches files its site cannot serve:\n${lines.join('\n')}`);
  }
  const release = addin != null ? readAddinRelease(addin) : null;
  // the site's files: the app folder (at the top), packages/, the other root files the app reaches, privacy.html; each lands once, none on a reserved name
  const files = [...new Set([...listTree(path.join(REPO_ROOT, 'apps', app), []), ...listTree(path.join(REPO_ROOT, 'packages'), []),
    ...[...closure.files].filter((f) => !f.startsWith(`apps/${app}/`) && !f.startsWith('packages/')), ...STANDALONE_PAGES])]; // privacy.html + about.html (TASK 828: about.html is also reached from the menu's About item (a Set: each file once)
  const at = new Map(); // site path -> repo path
  for (const f of files) {
    const to = sitePath(app, f);
    if (at.has(to)) throw new Error(`build-site ${app}: ${f} and ${at.get(to)} would both be ${to} in the site (the app folder is at the top of the site)`);
    if (f.startsWith(`apps/${app}/`) && RESERVED_TOP.has(to.split('/')[0])) throw new Error(`build-site ${app}: ${f} would be ${to} in the site, a name the site reserves (${[...RESERVED_TOP].join(', ')})`);
    at.set(to, f);
  }
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  for (const [to, f] of at) {
    fs.mkdirSync(path.dirname(path.join(out, to)), { recursive: true });
    fs.copyFileSync(path.join(REPO_ROOT, f), path.join(out, to));
  }
  const build = new Date().toISOString().slice(0, 16) + 'Z';
  stampBuild(out, build);
  fs.writeFileSync(path.join(out, '_redirects'), siteRedirects(app));
  fs.writeFileSync(path.join(out, '404.html'), NOT_FOUND_PAGE);
  const dlBase = `https://${SITE_HOST[ADDIN_DOWNLOAD.app]}/${sitePath(ADDIN_DOWNLOAD.app, ADDIN_DOWNLOAD.dir)}`;
  writeAbout(out, {
    hostOf: SITE_HOST,
    addinUrl: `${dlBase}/${ADDIN_DOWNLOAD.zip}`,
    setupUrl: release && release.setup ? `${dlBase}/${release.setup}` : null,
    addinLine: ADDIN_DOWNLOAD.about,
    addinApp: ADDIN_DOWNLOAD.app,
    build,
    app,
  }); // TASK 828 (+ 828b + 859)
  checkRootLayout(app, out, closure);
  const identity = writeIdentity(app, out, SITE_HOST[app]); // after the proof: it adds links to the built page
  const addinRelease = release ? copyAddinDownload(release, out) : null;
  return { app, out, identity, files: at.size + 2 + identity.length + (addinRelease ? addinRelease.files.length : 0), reached: closure.files.size, functions: closure.functions, build, addin: addinRelease };
}

// ---------------------------------------------------------------- TASK 881: the FUSION PANEL build
// Shaper's panel for the Fusion add-in (owner turns 3487-3490: the website, without the parts the panel does not use), carried OFFLINE by the add-in (SA-32)
// and served by its local server at http://127.0.0.1:<port>/index.html. One source: the panel's page IS the website's page (apps/shaper/index.html) with its
// entry module swapped (FUSION_PANEL.entry: src/fusion-main.js, which declares the panel's parts to the shared wiring shaper-app.js); the folder holds ONLY
// what that page reaches (site-closure.cjs, the browser's own resolution rules: the website's own parts are never reached, so never copied), plus the
// licences of the vendored code it carries and a manifest. Unlike a website build, the folder works wherever it is served (SA-32: one self-contained folder):
// every reference the browser follows stays inside it. A reference that only reaches its file because a URL's '..' stops at the site root (the website's
// root layout: the import map's ../../packages/, the worker's ../../../packages/) or that starts at the root ('/assets/...') is rewritten, in the panel's copy
// only, to the same file by a path relative to where it is read (flattenRefs); the build then PROVES the folder (checkPanel): the same files reached as from the
// repo page, nothing missing, no reference leaving the folder, nothing in the folder that the page does not load (but the licences and the manifest).
// The manifest (FUSION_PANEL.manifest) lists every file with its size and sha256, so the add-in's release pins them; `network` lists the run-time calls that
// leave the folder (docs/FUSION-PANEL-881.md R1: Send to ShaperHub's /api/shaper-upload is a route of the website, not a file).
const FUSION_PANEL = Object.freeze({
  target: 'shaper-fusion',
  app: 'shaper',
  page: 'apps/shaper/index.html', // the website's page (the panel's index.html, at the top of its folder)
  entry: Object.freeze({ from: 'src/main.js', to: 'src/fusion-main.js' }), // the page's module script: the website's boot -> the panel's
  out: 'dist-fusion',
  manifest: 'fusion-panel.json',
  notices: Object.freeze(['LICENSE.md', 'THIRD-PARTY-NOTICES.md']), // the repo's licence and the vendored code's notices
  vendorLicence: /^(LICENSE|.*\.LICENSE|OFL\.txt)$/i, // the licence files of a vendor folder the page reaches a file of
});
// The media type of each file kind the panel holds (what the add-in's server must send: a module script must come as JavaScript or the browser refuses it).
const PANEL_MIME = Object.freeze({
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.license': 'text/plain; charset=utf-8', '': 'text/plain; charset=utf-8',
});
const PANEL_ORIGIN = 'https://panel.invalid';
const PANEL_PREFIX = '/served/under/a/path/'; // where checkPanel pretends the folder is served: a reference that leaves it is found as it would be anywhere

// the panel's page: the website's page with the panel's entry module (exactly one module script names the website's)
function panelPage() {
  const html = fs.readFileSync(path.join(REPO_ROOT, FUSION_PANEL.page), 'utf8');
  const from = `<script type="module" src="${FUSION_PANEL.entry.from}"></script>`;
  const n = html.split(from).length - 1;
  if (n !== 1) throw new Error(`build-site ${FUSION_PANEL.target}: ${FUSION_PANEL.page} has ${n} "${from}", expected exactly one`);
  return html.replace(from, `<script type="module" src="${FUSION_PANEL.entry.to}"></script>`);
}

// where a reference read in `from` is resolved when the folder is served under PANEL_PREFIX (a page-based one: against index.html)
const panelBase = (from, base) => new URL(PANEL_PREFIX + (base === 'page' ? 'index.html' : from), PANEL_ORIGIN);
const leavesPanel = (spec, from, base) => !new URL(spec, panelBase(from, base)).pathname.startsWith(PANEL_PREFIX);
// the same file `to`, written relative to where the reference is read (always ./ or ../, so a page-based literal is still a site path to site-closure.cjs)
function relativeSpec(to, from, base) {
  const dir = base === 'page' ? '' : path.posix.dirname(from).replace(/^\.$/, '');
  const r = path.posix.relative(dir, to.replace(/\/$/, '')) + (to.endsWith('/') ? '/' : '');
  return r.startsWith('../') ? r : `./${r}`;
}

// Rewrite, in the panel's copy, every reference that leaves the folder (see the top of this block). Returns [{ file, from, to }] (the spec before / after).
function flattenRefs(out) {
  const page = 'index.html';
  const site = siteClosure({ root: out, app: FUSION_PANEL.app, entry: page, functionsRoot: REPO_ROOT });
  const rewrites = [];
  const byFile = new Map(); // file -> Map(spec -> new spec)
  for (const ref of site.refs) {
    if (!leavesPanel(ref.spec, ref.from, ref.base)) continue;
    const next = relativeSpec(ref.to, ref.from, ref.base);
    const m = byFile.get(ref.from) || new Map();
    if (m.has(ref.spec) && m.get(ref.spec) !== next) throw new Error(`build-site ${FUSION_PANEL.target}: "${ref.spec}" in ${ref.from} reaches two files (${m.get(ref.spec)} / ${next})`);
    m.set(ref.spec, next);
    byFile.set(ref.from, m);
  }
  // the page's import map: its values are where #core/, #ui/, three resolve (against the page)
  const html = fs.readFileSync(path.join(out, page), 'utf8');
  const map = htmlParts(html).importMap;
  const mapEdits = new Map();
  for (const v of Object.values((map && map.imports) || {})) {
    if (!leavesPanel(v, page, 'page')) continue;
    const to = new URL(v, new URL('/index.html', PANEL_ORIGIN)).pathname.replace(/^\//, '');
    mapEdits.set(v, relativeSpec(to, page, 'page'));
  }
  if (mapEdits.size) {
    const block = /<script type="importmap">[\s\S]*?<\/script>/.exec(html);
    let text = block[0];
    for (const [v, next] of mapEdits) {
      const q = `"${v}"`;
      if (!text.includes(q)) throw new Error(`build-site ${FUSION_PANEL.target}: the import map has no ${q}`);
      text = text.split(q).join(`"${next}"`);
      rewrites.push({ file: page, from: v, to: next });
    }
    fs.writeFileSync(path.join(out, page), html.replace(block[0], text));
  }
  for (const [file, m] of byFile) {
    const abs = path.join(out, file);
    let src = fs.readFileSync(abs, 'utf8');
    for (const [spec, next] of m) {
      let hits = 0;
      for (const [a, b] of [[`'${spec}'`, `'${next}'`], [`"${spec}"`, `"${next}"`], [`url(${spec})`, `url(${next})`]]) {
        const n = src.split(a).length - 1;
        if (n) { src = src.split(a).join(b); hits += n; }
      }
      if (!hits) throw new Error(`build-site ${FUSION_PANEL.target}: ${file} has no quoted "${spec}" to rewrite`);
      rewrites.push({ file, from: spec, to: next });
    }
    fs.writeFileSync(abs, src);
  }
  return rewrites;
}

// The proof of the panel folder (see the top of this block), on the written folder. -> the folder's closure
function checkPanel(out, repoClosure, listed) {
  const site = siteClosure({ root: out, app: FUSION_PANEL.app, entry: 'index.html', functionsRoot: REPO_ROOT });
  const html = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
  const map = htmlParts(html).importMap;
  const lines = site.missing.map((m) => `  missing in the panel   ${m.from} -> ${m.spec} (${m.to})`);
  for (const r of site.refs) if (leavesPanel(r.spec, r.from, r.base)) lines.push(`  leaves the folder      ${r.from} -> ${r.spec}`);
  for (const v of Object.values((map && map.imports) || {})) if (leavesPanel(v, 'index.html', 'page')) lines.push(`  leaves the folder      index.html import map -> ${v}`);
  const want = new Set([...repoClosure.files].map((f) => (f === FUSION_PANEL.page ? 'index.html' : sitePath(FUSION_PANEL.app, f))));
  for (const f of want) if (!site.files.has(f)) lines.push(`  not reached any more   ${f}`);
  for (const f of site.files) if (!want.has(f)) lines.push(`  not in the repo page   ${f}`);
  for (const f of listed) if (!site.files.has(f) && !f.endsWith('/') && f !== FUSION_PANEL.manifest && !FUSION_PANEL.notices.includes(f) && !FUSION_PANEL.vendorLicence.test(path.posix.basename(f))) lines.push(`  not loaded by the page ${f}`);
  if (lines.length) throw new Error(`build-site ${FUSION_PANEL.target}: the panel folder is not the page's own:\n${lines.join('\n')}`);
  return site;
}

function listFiles(dir, base = dir, list = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) listFiles(p, base, list); else list.push(path.relative(base, p).split(path.sep).join('/'));
  }
  return list;
}

function buildFusionPanel(outDir = path.join(REPO_ROOT, FUSION_PANEL.out)) {
  const out = outFolder(outDir, FUSION_PANEL.out);
  const app = FUSION_PANEL.app;
  const pageSrc = panelPage();
  const closure = siteClosure({ root: REPO_ROOT, app, entry: FUSION_PANEL.page, entrySource: pageSrc });
  if (closure.missing.length || closure.crossApp.length) {
    const lines = [...closure.missing.map((m) => `  missing   ${m.from} -> ${m.spec} (${m.to})`), ...closure.crossApp.map((m) => `  other app ${m.from} -> ${m.spec} (${m.to})`)];
    throw new Error(`build-site ${FUSION_PANEL.target}: the panel reaches files it cannot hold:\n${lines.join('\n')}`);
  }
  const vendorDirs = new Set([...closure.files].filter((f) => /(^|\/)vendor\//.test(f)).map((f) => path.posix.dirname(f)));
  const licences = [...vendorDirs].flatMap((d) => fs.readdirSync(path.join(REPO_ROOT, d), { withFileTypes: true })
    .filter((e) => e.isFile() && FUSION_PANEL.vendorLicence.test(e.name)).map((e) => `${d}/${e.name}`)).filter((f) => !closure.files.has(f));
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  const at = new Map(); // folder path -> repo path
  for (const f of [...closure.files, ...licences, ...FUSION_PANEL.notices]) {
    const to = f === FUSION_PANEL.page ? 'index.html' : sitePath(app, f);
    if (at.has(to)) throw new Error(`build-site ${FUSION_PANEL.target}: ${f} and ${at.get(to)} would both be ${to}`);
    at.set(to, f);
  }
  for (const [to, f] of at) {
    fs.mkdirSync(path.dirname(path.join(out, to)), { recursive: true });
    if (to === 'index.html') fs.writeFileSync(path.join(out, to), pageSrc);
    else fs.copyFileSync(path.join(REPO_ROOT, f), path.join(out, to));
  }
  const build = new Date().toISOString().slice(0, 16) + 'Z';
  stampBuild(out, build);
  const rewrites = flattenRefs(out);
  const site = checkPanel(out, closure, listFiles(out));
  const files = listFiles(out).sort().map((f) => {
    const buf = fs.readFileSync(path.join(out, f));
    return { path: f, bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex') };
  });
  const mime = {};
  for (const f of files) {
    const ext = path.posix.extname(f.path).toLowerCase();
    if (!Object.hasOwn(PANEL_MIME, ext)) throw new Error(`build-site ${FUSION_PANEL.target}: no media type declared for ${f.path} (PANEL_MIME)`);
    mime[ext || '(none)'] = PANEL_MIME[ext];
  }
  const network = site.functions.map((fn) => ({ from: fn.from, url: fn.spec }));
  const manifest = { target: FUSION_PANEL.target, app, entry: 'index.html', module: FUSION_PANEL.entry.to, build, count: files.length,
    bytes: files.reduce((n, f) => n + f.bytes, 0), mime, network, files };
  fs.writeFileSync(path.join(out, FUSION_PANEL.manifest), JSON.stringify(manifest, null, 2) + '\n');
  return { out, build, files, rewrites, network, mime, reached: closure.files.size, licences };
}

module.exports = { buildSite, buildFusionPanel, siteRedirects, sitePath, checkRootLayout, SITE_HOST, ADDIN_DOWNLOAD, NOT_FOUND_PAGE, RESERVED_TOP, FUSION_PANEL, PANEL_MIME };

if (require.main === module) {
  const args = process.argv.slice(2);
  const app = args.find((a) => !a.startsWith('--'));
  const oi = args.indexOf('--out');
  const ai = args.indexOf('--addin');
  try {
    if (app === FUSION_PANEL.target) { // TASK 881
      if (ai >= 0) throw new Error(`build-site: --addin is for the ${ADDIN_DOWNLOAD.app} site, not the ${FUSION_PANEL.target} panel`);
      const r = buildFusionPanel(oi >= 0 ? args[oi + 1] : undefined);
      console.log(`build-site ${FUSION_PANEL.target}: ${r.files.length} files, ${r.files.reduce((n, f) => n + f.bytes, 0)} bytes in ${r.out} (the page reaches ${r.reached}); build ${r.build}; manifest ${FUSION_PANEL.manifest}`);
      for (const w of r.rewrites) console.log(`  in the panel's copy, ${w.file}: ${w.from} -> ${w.to}`);
      console.log(`  media types: ${Object.entries(r.mime).map(([e, t]) => `${e} ${t}`).join(', ')}`);
      console.log(`  run-time calls outside the folder: ${r.network.map((n) => `${n.url} (${n.from})`).join(', ') || 'none'}`);
      return;
    }
    if (ai >= 0 && !args[ai + 1]) throw new Error('build-site: --addin needs the folder holding shaper-addin.zip + shaper-addin.json');
    const r = buildSite(app, oi >= 0 ? args[oi + 1] : undefined, { addin: ai >= 0 ? args[ai + 1] : null });
    const top = fs.readdirSync(r.out, { withFileTypes: true }).map((e) => e.name + (e.isDirectory() ? '/' : '')).sort();
    console.log(`build-site ${r.app}: ${r.files} files in ${r.out} (the app reaches ${r.reached}); top level: ${top.join(' ')}; build ${r.build}`);
    if (r.addin) console.log(`  Fusion add-in ${r.addin.version} (${r.addin.bytes} bytes, sha256 ${r.addin.sha256}): ${r.addin.files.join(', ')}`);
    else if (app === ADDIN_DOWNLOAD.app) console.log('  no Fusion add-in download (no --addin): the Shaper app says it is not available in this build');
    console.log(`  Pages Functions it calls (deployed from ./functions of the directory wrangler runs in): ${[...new Set(r.functions.map((f) => f.file))].join(', ') || 'none'}`);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
