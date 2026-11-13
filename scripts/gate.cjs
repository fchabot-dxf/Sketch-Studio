#!/usr/bin/env node
// scripts/gate.cjs — the ONE test runner, in tiers (TASK 568).
//   node scripts/gate.cjs [--tier quick|live|full|merge] [--base REF] [--head REF] [--plan] [--jobs N] [--list]     (npm run gate / gate:quick / gate:live)
//   quick = every test that launches no browser, run wide in parallel. For builders while they iterate. No lock.
//   live  = the browser tests + shell-smoke, run side by side at LIVE_JOBS. Takes the machine-wide lock.
//   full  = quick + live + the headless-left check. What the gate has always covered (default). Takes the lock.
//   merge = quick + shell-smoke + only the live tests AFFECTED by the branch's changes (see AFFECTED below). Takes the lock.
//           node scripts/gate.cjs --tier merge [--base origin/main] [--head HEAD]  (npm run gate:merge -- --base origin/main)
//           --plan prints the picked live tests and why, then exits.
// Exit 0 only if no file failed, smoke is 12/12 (live/full) and no headless browser is left (live/full).
//
// HOW A FILE'S TIER IS KNOWN (declared once, here): a test is `live` when its relative-import closure reaches
// tests/helpers/cdp-browser.js (the one browser launcher) or a file that starts a browser itself (it contains
// '--remote-debugging-port'; today the two hand-rolled launchers reference-lines-live and reference-lines-glyph-live-runner).
// Everything else is `quick`. A new browser test therefore lands in `live` on its own. The safety net: quick runs with
// SKETCH_GATE_TIER=quick, and launchBrowser() refuses to start while that is set, so a browser test misplaced in quick fails loudly.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');

// KNOWN failures list with one-line reason comments (empty now that all known failures are fixed).
const KNOWN_FAILURES = [];

const TEST_DIRS = ['tests', 'packages/core/tests', 'tests/harness'];

const LAUNCHER = 'tests/helpers/cdp-browser.js';
// A file that starts a browser WITHOUT going through the launcher carries its own spawn flags: it is a launcher too.
const BROWSER_SPAWN_MARKER = 'remote-debugging-port';

// AFFECTED (the `merge` tier), declared once: the changed files are `git diff --name-only <merge-base(base,head)> <head>`
// (committed work only: commit before you run it). A live test is picked when its own file, or any file reachable from it,
// is changed. Reachable = static import graph (relative imports, #core/#ui/#app aliases, `import()` with a literal) plus every
// string literal naming an existing repo file (.js .html .css .json .svg: how the tests load the apps), and for an .html file
// its <script src>, <link href> and inline module imports. A change to EVERY_TEST_TRIGGERS (something all tests lean on) picks every live test.
const EVERY_TEST_TRIGGERS = [
  'package.json',
  'scripts/gate.cjs',
  'scripts/shell-smoke.cjs',
  'packages/core/document.js',
  /^tests\/helpers\//,
];
const ALIASES = { '#core/': 'packages/core/', '#ui/': 'packages/ui/', '#app/': 'apps/sketchstudio/' };

const FILE_LIMIT_MS = 90000;
// Concurrency per tier. node tests: cores - 2. live: 6, the fastest of 1/2/4/6 with zero failures (TASK 568 measurement, WORK-LOG TURN 568).
const QUICK_JOBS = Math.max(1, os.cpus().length - 2);
const LIVE_JOBS = 6;

// Machine-wide state lives outside every repo so all worktrees share it.
const STATE_DIR = process.env.LOCALAPPDATA || os.tmpdir();
const LOCK_FILE = path.join(STATE_DIR, 'sketch-studio-gate.lock');
const TIMINGS_FILE = path.join(STATE_DIR, 'sketch-studio-gate-timings.json');

// ---------------------------------------------------------------- args
function parseArgs(argv) {
  let tier = 'full';
  let jobs = null;
  let list = false;
  let plan = false;
  let base = 'origin/main';
  let head = 'HEAD';
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--tier') tier = argv[++i];
    else if (argv[i] === '--list') list = true;
    else if (argv[i] === '--plan') plan = true;
    else if (argv[i] === '--base') base = argv[++i];
    else if (argv[i] === '--head') head = argv[++i];
    else if (argv[i] === '--jobs') jobs = parseInt(argv[++i], 10);
    else throw new Error(`gate: unknown argument ${argv[i]}`);
  }
  if (!['quick', 'live', 'full', 'merge'].includes(tier)) throw new Error(`gate: --tier must be quick|live|full|merge, got ${tier}`);
  if (jobs !== null && !(jobs >= 1)) throw new Error('gate: --jobs must be a positive integer');
  return { tier, jobs, list, plan, base, head };
}

// ---------------------------------------------------------------- discovery + tier classification
function findTestFiles() {
  const files = [];
  for (const relDir of TEST_DIRS) {
    const absDir = path.join(REPO_ROOT, relDir);
    if (!fs.existsSync(absDir)) continue;
    for (const entry of fs.readdirSync(absDir)) {
      if (entry.endsWith('.test.js') && fs.statSync(path.join(absDir, entry)).isFile()) files.push(`${relDir}/${entry}`);
    }
  }
  return files;
}

const IMPORT_RE = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g;

function resolveRel(fromFile, spec) {
  const base = path.resolve(path.dirname(path.join(REPO_ROOT, fromFile)), spec);
  for (const cand of [base, base + '.js', base + '.mjs', base + '.cjs']) {
    if (fs.existsSync(cand) && fs.statSync(cand).isFile()) return path.relative(REPO_ROOT, cand).replace(/\\/g, '/');
  }
  return null; // a non-file relative specifier (e.g. a directory or JSON): nothing to follow
}

// true when the relative-import closure of `file` reaches the browser launcher
function reachesLauncher(file) {
  const seen = new Set();
  const walk = (f) => {
    if (f === LAUNCHER) return true;
    if (seen.has(f)) return false;
    seen.add(f);
    const src = fs.readFileSync(path.join(REPO_ROOT, f), 'utf8');
    if (src.includes(BROWSER_SPAWN_MARKER)) return true;
    for (const m of src.matchAll(IMPORT_RE)) {
      const dep = resolveRel(f, m[1]);
      if (dep && walk(dep)) return true;
    }
    return false;
  };
  return walk(file);
}

function classify(files) {
  const tiers = { quick: [], live: [] };
  for (const f of files) tiers[reachesLauncher(f) ? 'live' : 'quick'].push(f);
  return tiers;
}

// ---------------------------------------------------------------- merge tier: which live tests does the change affect
const FILE_LITERAL_RE = /['"`]([A-Za-z0-9_@#./-]+\.(?:js|mjs|cjs|html|css|json|svg))['"`]/g;
const HTML_REF_RE = /(?:src|href)\s*=\s*["']([^"'#?]+)["']/g;

function existingFile(rel) {
  const abs = path.join(REPO_ROOT, rel);
  return fs.existsSync(abs) && fs.statSync(abs).isFile() ? rel.split(path.sep).join('/') : null;
}

function resolveRef(fromFile, spec) {
  if (/^[a-z]+:\/\//i.test(spec)) return null; // a CDN url
  for (const [alias, dir] of Object.entries(ALIASES)) {
    if (spec.startsWith(alias)) return existingFile(path.posix.join(dir, spec.slice(alias.length)));
  }
  if (spec.startsWith('./') || spec.startsWith('../')) return existingFile(path.posix.join(path.posix.dirname(fromFile), spec));
  return existingFile(spec.replace(/^\/+/, ''));
}

function refsOf(file) {
  const src = fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');
  const out = new Set();
  const specs = [];
  for (const m of src.matchAll(FILE_LITERAL_RE)) specs.push(m[1]);
  if (file.endsWith('.html')) for (const m of src.matchAll(HTML_REF_RE)) specs.push(m[1]);
  for (const m of src.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*)['"]([^'"]+)['"]/g)) specs.push(m[1]);
  for (const spec of specs) {
    const r = resolveRef(file, spec) || (!/\.\w+$/.test(spec) ? resolveRef(file, spec + '.js') : null);
    if (r && r !== file) out.add(r);
  }
  return out;
}

function reachable(file) {
  const seen = new Set([file]);
  const stack = [file];
  while (stack.length) for (const r of refsOf(stack.pop())) if (!seen.has(r)) { seen.add(r); stack.push(r); }
  return seen;
}

function changedFiles(base, head) {
  const git = (args) => {
    const r = spawnSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8', windowsHide: true });
    if (r.status !== 0) throw new Error(`gate: git ${args.join(' ')} failed: ${r.stderr}`);
    return r.stdout.trim();
  };
  const mergeBase = git(['merge-base', base, head]);
  return git(['diff', '--name-only', mergeBase, head]).split(/\r?\n/).map(l => l.trim()).filter(Boolean);
}

// -> { picked: [{ file, why: [changed files] }], everything: changedFile | null, changed }
function affectedLive(liveFiles, base, head) {
  const changed = changedFiles(base, head);
  const trigger = changed.find(c => EVERY_TEST_TRIGGERS.some(t => (t instanceof RegExp ? t.test(c) : t === c)));
  if (trigger) return { picked: liveFiles.map(file => ({ file, why: [trigger] })), everything: trigger, changed };
  const changedSet = new Set(changed);
  const picked = [];
  for (const file of liveFiles) {
    const why = [...reachable(file)].filter(f => changedSet.has(f));
    if (why.length) picked.push({ file, why });
  }
  return { picked, everything: null, changed };
}

// ---------------------------------------------------------------- machine-wide lock
function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) {
    if (e.code === 'ESRCH') return false;
    if (e.code === 'EPERM') return true;
    throw e;
  }
}

const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

let heldLock = false;
function releaseLock() {
  if (!heldLock) return;
  heldLock = false;
  const holder = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));
  if (holder.pid === process.pid) fs.unlinkSync(LOCK_FILE);
}

function acquireLock(tier) {
  const mine = { pid: process.pid, worktree: REPO_ROOT, tier, started: new Date().toISOString() };
  let lastShown = '';
  let lastShownAt = 0;
  for (;;) {
    try {
      fs.writeFileSync(LOCK_FILE, JSON.stringify(mine), { flag: 'wx' });
      heldLock = true;
      if (lastShown) console.log('LOCK acquired: running');
      return;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    }
    let holder;
    try { holder = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8')); } catch (e) {
      if (e.code === 'ENOENT') continue; // released between our write and our read: try again
      throw e;
    }
    if (!pidAlive(holder.pid)) {
      console.log(`LOCK stale (pid ${holder.pid} is dead; was ${holder.tier} in ${holder.worktree} since ${holder.started}): taking over`);
      fs.unlinkSync(LOCK_FILE);
      continue;
    }
    const msg = `LOCK held by pid ${holder.pid}: ${holder.tier} in ${holder.worktree} since ${holder.started}; waiting`;
    if (msg !== lastShown || Date.now() - lastShownAt > 60000) { console.log(msg); lastShown = msg; lastShownAt = Date.now(); }
    sleepSync(3000);
  }
}

// ---------------------------------------------------------------- timings (longest-first scheduling)
function loadTimings() {
  if (!fs.existsSync(TIMINGS_FILE)) return {};
  return JSON.parse(fs.readFileSync(TIMINGS_FILE, 'utf8'));
}
function saveTimings(prev, results) {
  const next = { ...prev };
  for (const r of results) next[r.file] = Math.round(r.ms) / 1000;
  fs.writeFileSync(TIMINGS_FILE, JSON.stringify(next));
}

// ---------------------------------------------------------------- running files
function killTree(pid) {
  spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
}

function runFile(file, tier) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const child = spawn(process.execPath, [file], {
      cwd: REPO_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: { ...process.env, SKETCH_GATE_TIER: tier },
    });
    let tail = '';
    const keep = (b) => { tail = (tail + b.toString()).slice(-4000); };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; killTree(child.pid); }, FILE_LIMIT_MS);
    child.on('error', (err) => { clearTimeout(timer); resolve({ file, tier, ok: false, ms: Date.now() - t0, tail: `spawn error: ${err.message}` }); });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ file, tier, ok: !timedOut && code === 0, ms: Date.now() - t0, tail: timedOut ? `TIMEOUT after ${FILE_LIMIT_MS / 1000}s\n${tail}` : tail });
    });
  });
}

// pool of `jobs` workers; `longestFirst` orders the queue by the previous run's per-file time
async function runPool(files, tier, jobs, timings, longestFirst) {
  const queue = [...files];
  if (longestFirst) queue.sort((a, b) => (timings[b] || 0) - (timings[a] || 0));
  const results = [];
  const worker = async () => {
    while (queue.length) {
      const r = await runFile(queue.shift(), tier);
      results.push(r);
      if (!r.ok) console.log(`FAIL ${r.file} (${(r.ms / 1000).toFixed(1)}s)`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(jobs, files.length) }, worker));
  return results;
}

// ---------------------------------------------------------------- shell-smoke + leftover headless browsers
function runSmoke() {
  const res = spawnSync(process.execPath, [path.join('scripts', 'shell-smoke.cjs')], {
    cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, timeout: FILE_LIMIT_MS,
  });
  let score = '0/12';
  if (res.stdout) {
    const m = res.stdout.match(/shell-smoke:\s*(\d+\/\d+)/) || res.stdout.match(/(\d+\/12)/);
    if (m) score = m[1];
  }
  return { score, pid: res.pid, tail: ((res.stdout || '') + (res.stderr || '')).slice(-4000) };
}

// Count only MAIN browser processes (no --type=), scoped to THIS smoke run's profile dir sk-shell-smoke-<pid>
// (whole-token match so PID 123 does not match 1234); parallel runs on other seats do not trip the gate (TASK 423b/c).
function countHeadless(smokePid) {
  const pattern = `sk-shell-smoke-${smokePid}(?=[\\\\/"''\\s]|$)`;
  const psScript = `$all = Get-CimInstance Win32_Process -Filter "name = 'msedge.exe'" | Where-Object { $_.CommandLine -match 'sk-shell-smoke' -and $_.CommandLine -notmatch '--type=' }; $mine = ($all | Where-Object { $_.CommandLine -match '${pattern}' } | Measure-Object).Count; $other = ($all | Where-Object { $_.CommandLine -notmatch '${pattern}' } | Measure-Object).Count; Write-Output "$mine,$other"`;
  const psRes = spawnSync('powershell', ['-NoProfile', '-Command', psScript], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, timeout: 15000 });
  if (psRes.error) throw psRes.error;
  if (psRes.status !== 0 || !psRes.stdout) throw new Error(`gate: headless count failed: ${psRes.stderr}`);
  const parts = psRes.stdout.trim().split(',');
  return { left: parseInt(parts[0], 10) || 0, other: parseInt(parts[1], 10) || 0 };
}

function headlessCheck(smokePid) {
  let counts = countHeadless(smokePid);
  // the Windows process table needs a brief grace period to finish reaping after taskkill
  const start = Date.now();
  while (counts.left > 0 && Date.now() - start < 3000) { sleepSync(400); counts = countHeadless(smokePid); }
  return counts;
}

// ---------------------------------------------------------------- main
async function main() {
  const { tier, jobs, list, plan, base, head } = parseArgs(process.argv.slice(2));
  const tiers = classify(findTestFiles());
  if (list) { // --list: print each file with its tier and exit (nothing runs, no lock)
    for (const t of ['quick', 'live']) for (const f of tiers[t]) console.log(`${t} ${f}`);
    return;
  }
  const wantQuick = tier !== 'live';
  const wantLive = tier !== 'quick'; // merge: only the affected live files + shell-smoke
  let liveFiles = tiers.live;
  if (tier === 'merge') {
    const a = affectedLive(tiers.live, base, head);
    liveFiles = a.picked.map(p => p.file);
    console.log(`MERGE changed=${a.changed.length} files vs ${base}...${head}; ${a.everything ? `${a.everything} is an every-test trigger: ALL ${liveFiles.length} live tests` : `${liveFiles.length} of ${tiers.live.length} live tests affected`}`);
    if (!a.everything) for (const p of a.picked) console.log(`  PICKED ${p.file}  <- ${p.why.slice(0, 3).join(', ')}${p.why.length > 3 ? ` (+${p.why.length - 3})` : ''}`);
    if (plan) return;
  }
  const started = Date.now();

  if (wantLive) acquireLock(tier);
  const onSignal = () => { releaseLock(); process.exit(130); };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  const results = [];
  let smoke = null;
  let counts = null;
  const timings = loadTimings();
  try {
    if (wantQuick) results.push(...await runPool(tiers.quick, 'quick', jobs || QUICK_JOBS, timings, true));
    if (wantLive) {
      results.push(...await runPool(liveFiles, 'live', jobs || LIVE_JOBS, timings, true));
      smoke = runSmoke();
      counts = headlessCheck(smoke.pid);
    }
    saveTimings(timings, results);
  } finally {
    releaseLock();
  }

  const failed = results.filter(r => !r.ok);
  for (const f of failed) console.log(`\n--- FAIL ${f.file} [${f.tier}] output tail ---\n${f.tail.trim()}\n--- end ${f.file} ---`);
  if (smoke && smoke.score !== '12/12') console.log(`\n--- shell-smoke output tail ---\n${smoke.tail.trim()}\n---`);

  console.log('\nSLOWEST 15 (seconds, tier, file):');
  for (const r of [...results].sort((a, b) => b.ms - a.ms).slice(0, 15)) console.log(`  ${(r.ms / 1000).toFixed(1).padStart(6)}  ${r.tier.padEnd(5)}  ${r.file}`);

  const jobsText = [wantQuick ? `quick=${jobs || QUICK_JOBS}` : null, wantLive ? `live=${jobs || LIVE_JOBS}` : null].filter(Boolean).join(',');
  console.log(`GATE tier=${tier} jobs=${jobsText} files=${results.length} pass=${results.length - failed.length} fail=${failed.length} elapsed=${((Date.now() - started) / 1000).toFixed(0)}s`);
  for (const f of failed) console.log(`FAIL ${f.file}`);
  for (const k of KNOWN_FAILURES) if (!failed.some(f => f.file === k)) console.log(`KNOWN-NOW-PASSING ${k}`);
  if (smoke) {
    console.log(`SMOKE ${smoke.score}`);
    console.log(`HEADLESS-LEFT ${counts.left}`);
    console.log(`HEADLESS-OTHER ${counts.other}`);
  }

  const unknownFailures = failed.filter(f => !KNOWN_FAILURES.includes(f.file));
  const passed = unknownFailures.length === 0 && (!smoke || (smoke.score === '12/12' && counts.left === 0));
  process.exit(passed ? 0 : 1);
}

main().catch((e) => { releaseLock(); console.error(e.stack || e.message); process.exit(2); });
