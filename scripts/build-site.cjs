#!/usr/bin/env node
// scripts/build-site.cjs — TASK 696: ONE app's website (owner turns 1835-1838: "App separate website please").
//   node scripts/build-site.cjs <app> [--out <dir>]        app = sketchstudio | shaper | penplotter | trace; out defaults to ./dist
//   (npm run site:sketchstudio / site:shaper / site:penplotter / site:trace)
// Writes <out>/ with the SAME tree shape as the repo, so no import path changes (each index.html's import map points at ../../packages/...):
//   apps/<app>/      the whole app folder (no other app's folder is in the site)
//   packages/        the shared packages, ONE copy in git, copied here at build time (their tests/ folders left out)
//   <root files>     the files outside apps/ and packages/ the app reaches (site-closure.cjs: e.g. assets/constraint-glyphs.svg, the glyph sheet)
//   privacy.html     the privacy page (the Google OAuth consent screen links it)
//   _redirects       this site's Cloudflare Pages rules (siteRedirects below)
// The build fails (exit 1, nothing half-written is reported as done) when the app reaches a file that does not exist or a file of another app.
// Plain Node, no bundler, no dependency. The Pages Functions (functions/: the Google sign-in routes, /api/shaper-upload) are NOT copied: wrangler
// compiles ./functions from the directory it runs in ("if a functions folder exists where the command is run, that functions folder will be uploaded
// with the project", developers.cloudflare.com/pages/get-started/direct-upload/), so `wrangler pages deploy dist` is run from the repo root, and a
// Git-connected project reads functions/ from its root directory, not from the build output.
'use strict';
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

const SKIP_DIRS = new Set(['tests', 'node_modules']);
function copyTree(src, dst, list) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue; // .gitignore and the like: not part of a site
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) copyTree(s, d, list); }
    else if (e.isFile()) { fs.copyFileSync(s, d); list.push(path.relative(REPO_ROOT, s).split(path.sep).join('/')); }
  }
}

function buildSite(app, outDir = path.join(REPO_ROOT, 'dist')) {
  if (!APPS.includes(app)) throw new Error(`build-site: app must be one of ${APPS.join(' | ')}, got "${app}"`);
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
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  const copied = [];
  copyTree(path.join(REPO_ROOT, 'apps', app), path.join(out, 'apps', app), copied);
  copyTree(path.join(REPO_ROOT, 'packages'), path.join(out, 'packages'), copied);
  for (const f of [...closure.files].filter((f) => !f.startsWith(`apps/${app}/`) && !f.startsWith('packages/')).concat('privacy.html')) {
    fs.mkdirSync(path.dirname(path.join(out, f)), { recursive: true });
    fs.copyFileSync(path.join(REPO_ROOT, f), path.join(out, f));
    copied.push(f);
  }
  fs.writeFileSync(path.join(out, '_redirects'), siteRedirects(app));
  return { app, out, files: copied.length + 1, reached: closure.files.size, functions: closure.functions };
}

module.exports = { buildSite, siteRedirects, SITE_HOST };

if (require.main === module) {
  const args = process.argv.slice(2);
  const app = args.find((a) => !a.startsWith('--'));
  const oi = args.indexOf('--out');
  try {
    const r = buildSite(app, oi >= 0 ? args[oi + 1] : undefined);
    const top = fs.readdirSync(r.out, { withFileTypes: true }).map((e) => e.name + (e.isDirectory() ? '/' : '')).sort();
    console.log(`build-site ${r.app}: ${r.files} files in ${r.out} (the app reaches ${r.reached}); top level: ${top.join(' ')}`);
    console.log(`  Pages Functions it calls (deployed from ./functions of the directory wrangler runs in): ${[...new Set(r.functions.map((f) => f.file))].join(', ') || 'none'}`);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
