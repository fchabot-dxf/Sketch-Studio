// tests/addin-setup-859-node.test.js — TASK 859: Windows installer (shaper-addin-setup.exe) in build-site, About page, and Fusion add-in drawer.
import assert from 'node:assert';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { Window } from 'happy-dom';
import {
  ADDIN_INSTALL_STEPS, ADDIN_SETUP_STEPS, ADDIN_SMARTSCREEN_NOTE,
  fusionAddinView, loadAddinRelease,
} from '../apps/shaper/src/addin-download.js';

const require = createRequire(import.meta.url);
const { buildSite, sitePath, ADDIN_DOWNLOAD, SITE_HOST } = require('../scripts/build-site.cjs');
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, m); checks++; };
const deepEq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const throwsLike = (fn, re, m) => { assert.throws(fn, re, m); checks++; };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'addin-859-'));
try {
  eq(ADDIN_DOWNLOAD.setup, 'shaper-addin-setup.exe', 'declared setup filename');

  const relWithSetup = path.join(tmp, 'with-setup');
  fs.mkdirSync(relWithSetup);
  const zipBytes = Buffer.from('PK\u0003\u0004 fixture zip 859');
  const setupBytes = Buffer.from('MZ fixture setup 859');
  const zipSha = crypto.createHash('sha256').update(zipBytes).digest('hex');
  const setupSha = crypto.createHash('sha256').update(setupBytes).digest('hex');
  fs.writeFileSync(path.join(relWithSetup, 'shaper-addin.zip'), zipBytes);
  fs.writeFileSync(path.join(relWithSetup, 'shaper-addin-setup.exe'), setupBytes);
  const jsonWithSetup = {
    id: 'shaper-addin',
    version: '1.2.3',
    zip: 'shaper-addin.zip',
    bytes: zipBytes.length,
    sha256: zipSha,
    setup: 'shaper-addin-setup.exe',
    setup_bytes: setupBytes.length,
    setup_sha256: setupSha,
    files: ['shaper-addin/fixture.py'],
  };
  fs.writeFileSync(path.join(relWithSetup, 'shaper-addin.json'), JSON.stringify(jsonWithSetup));

  const relZipOnly = path.join(tmp, 'zip-only');
  fs.mkdirSync(relZipOnly);
  fs.writeFileSync(path.join(relZipOnly, 'shaper-addin.zip'), zipBytes);
  const jsonZipOnly = {
    id: 'shaper-addin',
    version: '1.2.3',
    zip: 'shaper-addin.zip',
    bytes: zipBytes.length,
    sha256: zipSha,
    files: ['shaper-addin/fixture.py'],
  };
  fs.writeFileSync(path.join(relZipOnly, 'shaper-addin.json'), JSON.stringify(jsonZipOnly));

  // 1. buildSite copies + checks setup when present; zip-only builds cleanly without setup
  const outWith = path.join(tmp, 'out-with');
  const builtWith = buildSite('shaper', outWith, { addin: relWithSetup });
  const siteDir = sitePath('shaper', ADDIN_DOWNLOAD.dir);
  const dlWith = path.join(outWith, ...siteDir.split('/'));
  ok(fs.readFileSync(path.join(dlWith, 'shaper-addin-setup.exe')).equals(setupBytes), 'setup exe copied byte for byte');
  eq(builtWith.addin.setup, 'shaper-addin-setup.exe', 'buildSite reports setup name');
  eq(builtWith.addin.setupBytes, setupBytes.length, 'buildSite reports setupBytes');
  eq(builtWith.addin.setupSha256, setupSha, 'buildSite reports setupSha256');
  ok(builtWith.addin.files.includes(`${siteDir}/shaper-addin-setup.exe`), 'setup listed in buildSite addin.files');

  const outZipOnly = path.join(tmp, 'out-zip');
  const builtZipOnly = buildSite('shaper', outZipOnly, { addin: relZipOnly });
  ok(!fs.existsSync(path.join(outZipOnly, ...siteDir.split('/'), 'shaper-addin-setup.exe')), 'zip-only release does not copy setup exe');
  eq(builtZipOnly.addin.files.length, 2, 'zip-only release copies only json + zip');

  // Validation failures before writing anything
  const badShaDir = path.join(tmp, 'bad-sha');
  fs.mkdirSync(badShaDir);
  fs.writeFileSync(path.join(badShaDir, 'shaper-addin.zip'), zipBytes);
  fs.writeFileSync(path.join(badShaDir, 'shaper-addin-setup.exe'), Buffer.from('wrong exe bytes'));
  fs.writeFileSync(path.join(badShaDir, 'shaper-addin.json'), JSON.stringify(jsonWithSetup));
  throwsLike(() => buildSite('shaper', path.join(tmp, 'bad-sha-out'), { addin: badShaDir }), /shaper-addin-setup\.exe.*is not the one shaper-addin\.json describes/, 'setup size/sha mismatch throws');
  ok(!fs.existsSync(path.join(tmp, 'bad-sha-out')), 'failed setup check writes nothing');

  const missingExeDir = path.join(tmp, 'missing-exe');
  fs.mkdirSync(missingExeDir);
  fs.writeFileSync(path.join(missingExeDir, 'shaper-addin.zip'), zipBytes);
  fs.writeFileSync(path.join(missingExeDir, 'shaper-addin.json'), JSON.stringify(jsonWithSetup));
  throwsLike(() => buildSite('shaper', path.join(tmp, 'missing-exe-out'), { addin: missingExeDir }), /does not exist/, 'missing setup exe throws');

  const wrongNameDir = path.join(tmp, 'wrong-name');
  fs.mkdirSync(wrongNameDir);
  fs.writeFileSync(path.join(wrongNameDir, 'shaper-addin.zip'), zipBytes);
  fs.writeFileSync(path.join(wrongNameDir, 'other.exe'), setupBytes);
  fs.writeFileSync(path.join(wrongNameDir, 'shaper-addin.json'), JSON.stringify({ ...jsonWithSetup, setup: 'other.exe' }));
  throwsLike(() => buildSite('shaper', path.join(tmp, 'wrong-name-out'), { addin: wrongNameDir }), /expected "shaper-addin-setup\.exe"/, 'unexpected setup name in json throws');

  // 2. About page: installer link next to zip ONLY when release has setup
  const aboutWith = fs.readFileSync(path.join(outWith, 'about.html'), 'utf8');
  const setupUrl = `https://${SITE_HOST[ADDIN_DOWNLOAD.app]}/${siteDir}/${ADDIN_DOWNLOAD.setup}`;
  ok(aboutWith.includes(setupUrl) && aboutWith.includes('Download installer (Windows)'), 'About page links Windows installer when release has setup');
  ok(aboutWith.includes('shaper-addin.zip'), 'About page still links zip');

  const aboutZipOnly = fs.readFileSync(path.join(outZipOnly, 'about.html'), 'utf8');
  ok(!aboutZipOnly.includes('shaper-addin-setup.exe') && !aboutZipOnly.includes('Download installer (Windows)'), 'About page omits installer when release has no setup');
  ok(aboutZipOnly.includes('shaper-addin.zip'), 'About page still links zip without setup');

  // 3. loadAddinRelease returns setupUrl/setupBytes when present, none when absent
  const res = (body) => ({ status: 200, ok: true, headers: { get: () => 'application/json' }, json: async () => body });
  const base = 'https://shaper-svg.pages.dev/';
  deepEq(await loadAddinRelease({ base, fetchImpl: async () => res(jsonWithSetup) }), {
    available: true,
    version: '1.2.3',
    bytes: zipBytes.length,
    zipUrl: 'https://shaper-svg.pages.dev/downloads/shaper-addin.zip',
    setupUrl: 'https://shaper-svg.pages.dev/downloads/shaper-addin-setup.exe',
    setupBytes: setupBytes.length,
  }, 'loadAddinRelease returns setupUrl and setupBytes when present');

  const loadedNoSetup = await loadAddinRelease({ base, fetchImpl: async () => res(jsonZipOnly) });
  ok(!('setupUrl' in loadedNoSetup) && !('setupBytes' in loadedNoSetup), 'loadAddinRelease omits setupUrl/setupBytes when absent');

  // 4. Zip steps updated (no "Run on Startup") & SmartScreen line declared once
  ok(ADDIN_INSTALL_STEPS.includes('Pick the unzipped shaper-addin folder, then Run.'), 'zip step 4 drops Run on Startup');
  ok(!ADDIN_INSTALL_STEPS.join(' ').includes('Run on Startup'), 'no Run on Startup left in zip steps');
  ok(ADDIN_SETUP_STEPS.length === 3 && ADDIN_SETUP_STEPS[0].includes(ADDIN_SMARTSCREEN_NOTE), 'installer steps include declared SmartScreen note');

  // 5. View renders both layouts cleanly
  const renderView = async (load) => {
    const win = new Window({ url: base });
    const box = win.document.createElement('div');
    win.document.body.appendChild(box);
    fusionAddinView({ load }).render(box);
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    const links = [...box.querySelectorAll('a.sk-sidebar-item')].map((a) => ({
      addin: a.dataset.addin,
      href: a.getAttribute('href'),
      download: a.getAttribute('download'),
      text: a.textContent.trim(),
    }));
    const out = {
      links,
      setupSteps: [...box.querySelectorAll('[data-addin="setup-steps"] li .txt')].map((e) => e.textContent),
      zipSteps: [...box.querySelectorAll('[data-addin="steps"] li .txt')].map((e) => e.textContent),
      text: box.textContent,
    };
    await win.happyDOM.close();
    return out;
  };

  const withSetupView = await renderView(async () => ({
    available: true,
    version: '1.2.3',
    bytes: zipBytes.length,
    zipUrl: 'https://shaper-svg.pages.dev/downloads/shaper-addin.zip',
    setupUrl: 'https://shaper-svg.pages.dev/downloads/shaper-addin-setup.exe',
    setupBytes: setupBytes.length,
  }));
  eq(withSetupView.links.length, 2, 'with setup: renders installer link and zip link');
  deepEq(withSetupView.links[0], {
    addin: 'setup',
    href: 'https://shaper-svg.pages.dev/downloads/shaper-addin-setup.exe',
    download: 'shaper-addin-setup.exe',
    text: 'Download installer (Windows)',
  }, 'with setup: installer link is first');
  deepEq(withSetupView.links[1], {
    addin: 'download',
    href: 'https://shaper-svg.pages.dev/downloads/shaper-addin.zip',
    download: 'shaper-addin.zip',
    text: 'Download (.zip)',
  }, 'with setup: zip link is second');
  deepEq(withSetupView.setupSteps, ADDIN_SETUP_STEPS, 'with setup: installer steps shown');
  deepEq(withSetupView.zipSteps, ADDIN_INSTALL_STEPS, 'with setup: zip steps shown');
  ok(withSetupView.text.includes('Mac, or manual install:'), 'with setup: Mac / manual install label shown');

  const withoutSetupView = await renderView(async () => ({
    available: true,
    version: '1.2.3',
    bytes: zipBytes.length,
    zipUrl: 'https://shaper-svg.pages.dev/downloads/shaper-addin.zip',
  }));
  eq(withoutSetupView.links.length, 1, 'without setup: only zip link rendered');
  eq(withoutSetupView.links[0].addin, 'download', 'without setup: Download (.zip) link');
  deepEq(withoutSetupView.setupSteps, [], 'without setup: no installer steps');
  deepEq(withoutSetupView.zipSteps, ADDIN_INSTALL_STEPS, 'without setup: zip steps shown');

  // 6. No exe tracked in git & apps/shaper/downloads/shaper-addin-setup.exe is git-ignored
  const tracked = execFileSync('git', ['ls-files'], { cwd: REPO_ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
  deepEq(tracked.filter((f) => /\.exe$/i.test(f)), [], 'no exe tracked in git');
  ok(execFileSync('git', ['check-ignore', '-q', '--no-index', `${ADDIN_DOWNLOAD.dir}/${ADDIN_DOWNLOAD.setup}`], { cwd: REPO_ROOT, encoding: 'utf8' }) === '', 'setup exe in downloads/ is git-ignored');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(`addin-setup-859-node: ${checks} checks passed`);
