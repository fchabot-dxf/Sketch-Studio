// tests/fusion-panel-881-node.test.js — TASK 881: the FUSION PANEL build (scripts/build-site.cjs shaper-fusion) holds Shaper's page WITHOUT the website's own
// parts, by its module graph (owner turns 3487-3490, 3494, 3503; docs/FUSION-PANEL-881.md). Built into a temp folder, then read the way the browser reads it
// (scripts/site-closure.cjs): every UNUSED module is absent from the panel's graph AND from its folder, while the website's graph has it (so the check can
// fail); the USED ones are there; the panel's page loads the panel's boot; nothing it references leaves the folder (it works wherever it is served);
// every reference names a file of the folder with its exact case; the manifest lists exactly the folder's files with their sizes and sha256.
import assert from 'node:assert';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { buildFusionPanel, FUSION_PANEL, PANEL_MIME, sitePath } = require('../scripts/build-site.cjs');
const { siteClosure } = require('../scripts/site-closure.cjs');

let checks = 0;
const ok = (v, msg) => { assert.ok(v, msg); checks++; };
const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, msg); checks++; };

// UNUSED in the Fusion panel (docs/FUSION-PANEL-881.md sections 3-5, 10): the website's boot and the modules only its own parts reach
const UNUSED = [
  'src/main.js',                      // the website's boot
  'src/addin-download.js',            // the Fusion add-in download (the panel IS the add-in)
  'src/cut-import.js',                // the SVG / DXF import (the drawer's entry, the drop on the page)
  'src/shaperhub-login.js',           // the old ShaperHub login's removal (a fresh origin has none)
  'src/shaper-browser.js',            // the SKETCHES browser over the Design view
  'packages/ui/design-browser.js',
  'packages/ui/app-chrome.js',        // the project drawer and its services
  'packages/ui/sidebar-projects.js',
  'packages/ui/project-actions.js',
  'packages/ui/project-manager.js',
  'packages/ui/document-tabs.js',
  'packages/ui/save-button.js',
  'packages/ui/account-avatar.js',
  'packages/ui/file-dialog.js',
  'packages/ui/sketch-import.js',
  'packages/ui/feedback.js',          // Rate & feedback + the "Enjoying Shaper?" card (owner turn 3503)
  'packages/ui/style-panel.js',       // Settings (owner turn 3494)
  'packages/ui/project-store.js',     // the page's shared store (IndexedDB routed to Drive)
  'packages/ui/document-buffer.js',   // the autosave loop's page-store default
  'packages/ui/cloud/google-account.js', // Google sign-in
  'packages/ui/cloud/auth-state.js',
  'packages/ui/cloud/providers.js',
  'packages/ui/cloud/drive-adapter.js', // the Drive client
  'packages/ui/cloud/router-adapter.js',
  'packages/ui/cloud/settings-sync.js',
  'about.html',                       // About (a palette has no browser tab)
];
// USED: the panel's own boot, the shared wiring, the Fusion parts, Prepare (Insert STL kept: owner turn 3503), Export, the Log, the vendored three.js
const USED = [
  'index.html', 'src/fusion-main.js', 'src/shaper-app.js', 'src/fusion-bridge.js', 'src/fusion-import.js', 'src/fusion-toolpaths.js', 'src/selection-edit.js',
  'src/selection-list.js', 'src/prepare-stage.js', 'src/stl-import.js', 'src/export-payload.js', 'src/export-preview.js', 'src/export-sim.js', 'src/review-view.js',
  'src/paths-worker.js', 'src/op-derive.js', 'styles/main.css', 'packages/ui/app-shell.js', 'packages/ui/app-header.js', 'packages/ui/app-sidebar.js',
  'packages/ui/app-footer.js', 'packages/ui/diagnostic-log.js', 'packages/ui/document-buffer-core.js', 'packages/ui/project-store-core.js',
  'packages/ui/sketch-canvas.js', 'packages/ui/sketcher.css', 'packages/ui/vendor/three/three.module.js', 'packages/ui/vendor/three/addons/controls/OrbitControls.js',
  'assets/constraint-glyphs.svg',
];

const out = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-fusion-panel-881-'));
try {
  const r = buildFusionPanel(out);
  eq(r.out, path.resolve(out), 'the panel is written where asked');
  const panel = siteClosure({ root: out, app: 'shaper', entry: 'index.html', functionsRoot: REPO });
  const website = siteClosure({ root: REPO, app: 'shaper' });
  const webFiles = new Set([...website.files].map((f) => sitePath('shaper', f)));
  eq(panel.missing, [], 'the panel folder has every file its page reaches');

  for (const f of UNUSED) {
    ok(webFiles.has(f), `the website's page reaches ${f} (so its absence below is the build's doing)`);
    ok(!panel.files.has(f), `the Fusion panel's graph does not reach ${f}`);
    ok(!fs.existsSync(path.join(out, f)), `the Fusion panel folder does not hold ${f}`);
  }
  ok(!fs.existsSync(path.join(out, 'privacy.html')), 'no privacy page in the panel (no sign-in)');
  for (const f of USED) ok(panel.files.has(f) && fs.existsSync(path.join(out, f)), `the Fusion panel loads ${f}`);

  // the page: the website's own, with the panel's boot
  const page = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
  ok(page.includes(`<script type="module" src="${FUSION_PANEL.entry.to}"></script>`) && !page.includes(`src="${FUSION_PANEL.entry.from}"`), 'the panel page loads src/fusion-main.js, not the website boot');
  ok(fs.readFileSync(path.join(REPO, 'apps/shaper/index.html'), 'utf8').includes(`<script type="module" src="${FUSION_PANEL.entry.from}"></script>`), "the website's page still loads src/main.js");

  // self-contained: every reference (and the import map) stays inside the folder wherever it is served; no root-absolute path, no '..' past the folder
  const PREFIX = '/some/served/path/';
  const base = (from, b) => new URL(PREFIX + (b === 'page' ? 'index.html' : from), 'https://h.invalid');
  const leaving = panel.refs.filter((x) => !new URL(x.spec, base(x.from, x.base)).pathname.startsWith(PREFIX));
  eq(leaving.map((x) => `${x.from} -> ${x.spec}`), [], 'no reference of the panel leaves its folder');
  const map = JSON.parse(/<script type="importmap">([\s\S]*?)<\/script>/.exec(page)[1]).imports;
  eq(Object.values(map).filter((v) => !v.startsWith('./')), [], 'the import map points inside the folder (./packages/...)');
  eq(map['#core/'], './packages/core/', '#core/ is the folder\'s packages/core/');
  eq(map.three, './packages/ui/vendor/three/three.module.js', 'three is the vendored copy in the folder');

  // the manifest: exactly the folder's files (case-exact), sizes and sha256; every reference names one of them with its exact case
  const manifest = JSON.parse(fs.readFileSync(path.join(out, FUSION_PANEL.manifest), 'utf8'));
  const onDisk = [];
  (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else onDisk.push(path.relative(out, p).split(path.sep).join('/')); } })(out);
  eq(manifest.files.map((f) => f.path).sort(), onDisk.filter((f) => f !== FUSION_PANEL.manifest).sort(), 'the manifest lists exactly the folder\'s files (but itself)');
  eq(manifest.count, manifest.files.length, 'its count');
  eq(manifest.bytes, manifest.files.reduce((n, f) => n + f.bytes, 0), 'its total size');
  for (const f of manifest.files) {
    const buf = fs.readFileSync(path.join(out, f.path));
    if (buf.length !== f.bytes || crypto.createHash('sha256').update(buf).digest('hex') !== f.sha256) assert.fail(`${f.path}: the manifest's size / sha256 is not the file's`);
  }
  checks++;
  const names = new Set(manifest.files.map((f) => f.path));
  eq(panel.refs.filter((x) => !names.has(x.to)).map((x) => `${x.from} -> ${x.to}`), [], 'every reference names a file of the folder with its exact case');
  eq(manifest.entry, 'index.html', 'the entry page');
  for (const f of manifest.files) ok(Object.hasOwn(PANEL_MIME, path.posix.extname(f.path).toLowerCase()), `a media type is declared for ${f.path}`);
  eq(manifest.mime['.js'], 'text/javascript; charset=utf-8', 'module scripts are served as JavaScript');
  // the one run-time call that leaves the folder (docs/FUSION-PANEL-881.md R1): Send to ShaperHub's route on the website
  eq(manifest.network, [{ from: 'src/shaper-app.js', url: '/api/shaper-upload' }], 'the only call outside the folder is the ShaperHub upload route (R1)');
  // the licences of what it carries
  for (const f of ['LICENSE.md', 'THIRD-PARTY-NOTICES.md', 'packages/ui/vendor/three/LICENSE', 'packages/ui/vendor/opentype/LICENSE', 'packages/core/plot/vendor/earcut.LICENSE']) ok(names.has(f), `the panel carries ${f}`);
  // the panel's copy of analytics.js carries the build time (as a website's does); the repo's says 'source'
  ok(fs.readFileSync(path.join(out, 'packages/ui/analytics.js'), 'utf8').includes(`export const BUILD = '${r.build}';`), 'the build is stamped');
} finally {
  fs.rmSync(out, { recursive: true, force: true });
}
console.log(`fusion-panel-881-node: ok (${checks} checks)`);
