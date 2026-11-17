#!/usr/bin/env node
// scripts/build-site.cjs — TASK 696: ONE app's website (owner turns 1835-1838: "App separate website please").
//   node scripts/build-site.cjs <app> [--out <dir>]        app = sketchstudio | shaper | penplotter | trace; out defaults to ./dist
//   node scripts/build-site.cjs shaper --addin <dir>        TASK 733: also put the Fusion add-in download in the Shaper site (ADDIN_DOWNLOAD below)
//   (npm run site:sketchstudio / site:shaper / site:penplotter / site:trace)
// Writes <out>/ with the SAME tree shape as the repo, so no import path changes (each index.html's import map points at ../../packages/...):
//   apps/<app>/      the whole app folder (no other app's folder is in the site)
//   packages/        the shared packages, ONE copy in git, copied here at build time (their tests/ folders left out)
//   <root files>     the files outside apps/ and packages/ the app reaches (site-closure.cjs: e.g. assets/constraint-glyphs.svg, the glyph sheet)
//   privacy.html     the privacy page (the Google OAuth consent screen links it)
//   TASK 738: the site's copy of packages/ui/analytics.js carries the build time as BUILD (stampBuild: the analytics `version`); every other file is a plain copy
//   _redirects       this site's Cloudflare Pages rules (siteRedirects below)
// The build fails (exit 1, nothing half-written is reported as done) when the app reaches a file that does not exist or a file of another app.
// Plain Node, no bundler, no dependency. The Pages Functions (functions/: the Google sign-in routes, /api/shaper-upload) are NOT copied: wrangler
// compiles ./functions from the directory it runs in ("if a functions folder exists where the command is run, that functions folder will be uploaded
// with the project", developers.cloudflare.com/pages/get-started/direct-upload/), so `wrangler pages deploy dist` is run from the repo root, and a
// Git-connected project reads functions/ from its root directory, not from the build output.
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { APPS, siteClosure } = require('./site-closure.cjs');

const REPO_ROOT = path.resolve(__dirname, '..');

// Each app's own Pages project (owner turn 1862: shaper-svg; penplotter = the owner's older Pen Plotter project, now this app; sketch-trace; sketch-studio is the existing one).
const SITE_HOST = {
  sketchstudio: 'sketch-studio.pages.dev',
  shaper: 'shaper-svg.pages.dev',
  penplotter: 'penplotter.pages.dev',
  trace: 'sketch-trace.pages.dev',
};

// Cloudflare Pages _redirects of one site. A redirect keeps the request's query string when the destination has none (?host=fusion survives:
// wrangler's bundled pages-shared/asset-server/handler.ts builds the Location as `...${destination.search ? destination.search : search}...`).
// 302 (temporary), not 301: a 301 is cached by the browser (and the Fusion add-in's embedded one) with no way to take it back if a site moves.
function siteRedirects(app) {
  const lines = [`/    /apps/${app}/    302`];
  if (app === 'sketchstudio') { // the old one-site links keep working: they go to the app's own site
    for (const other of APPS.filter((a) => a !== 'sketchstudio')) {
      const to = `https://${SITE_HOST[other]}/apps/${other}/`;
      lines.push(`/${other}    ${to}    302`, `/apps/${other}    ${to}    302`, `/apps/${other}/*    ${to}:splat    302`);
    }
  }
  return lines.join('\n') + '\n';
}

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
// the view says the download is not available in this build.
const ADDIN_DOWNLOAD = { app: 'shaper', dir: 'apps/shaper/downloads', zip: 'shaper-addin.zip', json: 'shaper-addin.json' };

// Check the release folder BEFORE the site is written (the json names the zip and gives its sha256 / size); -> what copyAddinDownload copies.
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
  return { jsonFile, zipFile, version: info.version, bytes: zip.length, sha256: sha };
}
// ... and copy both to <out>/<ADDIN_DOWNLOAD.dir>/.
function copyAddinDownload(release, out) {
  const dst = path.join(out, ...ADDIN_DOWNLOAD.dir.split('/'));
  fs.mkdirSync(dst, { recursive: true });
  fs.copyFileSync(release.jsonFile, path.join(dst, ADDIN_DOWNLOAD.json));
  fs.copyFileSync(release.zipFile, path.join(dst, ADDIN_DOWNLOAD.zip));
  return { version: release.version, bytes: release.bytes, sha256: release.sha256, files: [`${ADDIN_DOWNLOAD.dir}/${ADDIN_DOWNLOAD.json}`, `${ADDIN_DOWNLOAD.dir}/${ADDIN_DOWNLOAD.zip}`] };
}

const SKIP_DIRS = new Set(['tests', 'node_modules']);
const SKIP_PATHS = new Set([path.join(REPO_ROOT, ...ADDIN_DOWNLOAD.dir.split('/'))]); // only --addin puts the download in a site
function copyTree(src, dst, list) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue; // .gitignore and the like: not part of a site
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name) && !SKIP_PATHS.has(s)) copyTree(s, d, list); }
    else if (e.isFile()) { fs.copyFileSync(s, d); list.push(path.relative(REPO_ROOT, s).split(path.sep).join('/')); }
  }
}

function buildSite(app, outDir = path.join(REPO_ROOT, 'dist'), { addin = null } = {}) {
  if (!APPS.includes(app)) throw new Error(`build-site: app must be one of ${APPS.join(' | ')}, got "${app}"`);
  if (addin != null && app !== ADDIN_DOWNLOAD.app) throw new Error(`build-site: --addin is for the ${ADDIN_DOWNLOAD.app} site only, not "${app}"`);
  const out = path.resolve(outDir);
  const rel = path.relative(out, REPO_ROOT);
  const insideRepo = !path.relative(REPO_ROOT, out).startsWith('..') && !path.isAbsolute(path.relative(REPO_ROOT, out));
  if (out === REPO_ROOT || (!rel.startsWith('..') && !path.isAbsolute(rel)) || (insideRepo && out !== path.join(REPO_ROOT, 'dist'))) {
    throw new Error(`build-site: refusing to write into ${out} (it is emptied first: inside the repo only dist/ is allowed, never the repo or a parent of it)`);
  }
  const closure = siteClosure({ root: REPO_ROOT, app });
  if (closure.missing.length || closure.crossApp.length) {
    const lines = [...closure.missing.map((m) => `  missing   ${m.from} -> ${m.spec} (${m.to})`), ...closure.crossApp.map((m) => `  other app ${m.from} -> ${m.spec} (${m.to})`)];
    throw new Error(`build-site ${app}: the app reaches files its site cannot serve:\n${lines.join('\n')}`);
  }
  const release = addin != null ? readAddinRelease(addin) : null;
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  const copied = [];
  copyTree(path.join(REPO_ROOT, 'apps', app), path.join(out, 'apps', app), copied);
  copyTree(path.join(REPO_ROOT, 'packages'), path.join(out, 'packages'), copied);
  const build = new Date().toISOString().slice(0, 16) + 'Z';
  stampBuild(out, build);
  for (const f of [...closure.files].filter((f) => !f.startsWith(`apps/${app}/`) && !f.startsWith('packages/')).concat('privacy.html')) {
    fs.mkdirSync(path.dirname(path.join(out, f)), { recursive: true });
    fs.copyFileSync(path.join(REPO_ROOT, f), path.join(out, f));
    copied.push(f);
  }
  fs.writeFileSync(path.join(out, '_redirects'), siteRedirects(app));
  const addinRelease = release ? copyAddinDownload(release, out) : null;
  return { app, out, files: copied.length + 1 + (addinRelease ? addinRelease.files.length : 0), reached: closure.files.size, functions: closure.functions, build, addin: addinRelease };
}

module.exports = { buildSite, siteRedirects, SITE_HOST, ADDIN_DOWNLOAD };

if (require.main === module) {
  const args = process.argv.slice(2);
  const app = args.find((a) => !a.startsWith('--'));
  const oi = args.indexOf('--out');
  const ai = args.indexOf('--addin');
  try {
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
