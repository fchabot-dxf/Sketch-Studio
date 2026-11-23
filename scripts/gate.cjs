#!/usr/bin/env node
// scripts/gate.cjs — the ONE test runner, in tiers (TASK 568).
//   node scripts/gate.cjs [--tier quick|live|full|merge] [--base REF] [--head REF] [--plan] [--jobs N] [--list]     (npm run gate / gate:quick / gate:live)
//   quick = every test that launches no browser, run wide in parallel. For builders while they iterate. NEVER WAITS for a browser run (TASK 606): it
//           declares its timings estimate (~4 min: 569 files, ~2850 s summed over 22 jobs, + ~55 s of exclusive tests), which the library runs in its
//           one-place SIDE lane for short jobs (see SHARED CPU LOCK below), so it waits only while another short job holds that lane; if the MAIN lane
//           is held, it DEFERS the exclusive tests (see below) and exits on what ran. (An estimate above SIDE_LANE_MAX_MIN would make the library
//           queue it in the main lane like a gate: a quick run that long is a heavy run.)
//   live  = the browser tests + shell-smoke, run side by side at LIVE_JOBS. Holds the shared CPU lock's main lane, waiting for it.
//   full  = quick + live + the headless-left check. What the gate has always covered (default). Holds the main lane.
//   merge = quick + shell-smoke + only the live tests AFFECTED by the branch's changes (see AFFECTED below). Holds the main lane.
//           node scripts/gate.cjs --tier merge [--base origin/main] [--head HEAD]  (npm run gate:merge -- --base origin/main)
//           --plan prints the picked live tests and why, then exits.
// EXCLUSIVE tests (TASK 579): a test whose pass/fail depends on wall time (a ms limit, a per-frame budget, a runtime budget) declares it with a first-column
//   comment line `// gate: exclusive` in its own file. Such a test keeps its tier but does not run in the parallel batch: after the batch of its tier
//   it runs ALONE, one at a time, with nothing else from this gate running, and only while no OTHER run holds the shared lock's main lane (no heavy run
//   of any project beside it). Before each one the gate asks the library's status: when the main lane is held by another run (only possible in the
//   quick tier, which holds the side lane) it prints `DEFERRED <file> (the shared CPU lock is held: <holder>; ...)` for it and the rest and runs none
//   of them (the merge / full tier runs them); live/full/merge hold the main lane themselves, so theirs always run.
//   Each prints `EXCLUSIVE <file> <seconds>`. Why a marker and not a list here: the declaration stays next to the test whose limit needs it.
// SHARED CPU LOCK (TASK 873): ONE machine-wide lock for the heavy runs of every project on this PC (b-spline, DDCS, Sketch-Studio take turns), its
//   library ~/.shared-cpu/cpu_lock.sh (owned by the b-spline advisor). The gate takes it AS project `sketch` through the library itself (Git Bash
//   sources it and calls cpu_lock_take / cpu_lock_release / cpu_lock_status), never by writing its files. CPU_LOCK_PID = this gate's pid, so the
//   holder record names a process alive for the whole run (the library's default, the bash's own pid, dies right after the take: judged stale).
//   Taken once per run before any test, held to the end, released on every exit (green, red, a thrown error, Ctrl-C / SIGTERM). The eta it declares
//   comes from the timings file (see etaMinutes); the library puts an eta <= SIDE_LANE_MAX_MIN in its side lane, so the browser tiers declare at least
//   SIDE_LANE_MAX_MIN + 1. While it waits, the library prints who holds the lock (`cpu_lock: waiting for <project> (<what>, eta <eta>)`).
//   `bash ~/.shared-cpu/cpu_lock.sh status` shows the holder. Never delete the lock: a dead holder is judged stale by the library itself.
// Exit 0 only if no file failed, smoke passed every check (N/N, smokeGreen) (live/full) and no headless browser is left (live/full).
//
// HOW A FILE'S TIER IS KNOWN (declared once, here): a test is `live` when its relative-import closure reaches
// tests/helpers/cdp-browser.js (the one browser launcher) or a file that starts a browser itself (it contains
// '--remote-debugging-port'; today the hand-rolled launcher reference-lines-live).
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
// Concurrency per tier. node tests: cores - 2. live: 8. TASK 613 measured 12 green in 4 isolated runs, but the advisor merge run at 12 went RED (4 of 419: browser launch "did not expose CDP port" / "timed out waiting for DevToolsActivePort", and two "TIMEOUT after 90s" at shutdown) because other seats run live tests outside the lock; 6 was the TASK 568 pick.
const QUICK_JOBS = Math.max(1, os.cpus().length - 2);
const LIVE_JOBS = 8;

// Machine-wide state lives outside every repo so all worktrees share it.
const STATE_DIR = process.env.LOCALAPPDATA || os.tmpdir();
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
    if (f === 'scripts/gate.cjs') return false;
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

const EXCLUSIVE_MARKER_RE = /^\/\/ gate: exclusive\s*$/m;
const isExclusive = (file) => EXCLUSIVE_MARKER_RE.test(fs.readFileSync(path.join(REPO_ROOT, file), 'utf8'));

function classify(files) {
  const tiers = { quick: [], live: [] };
  for (const f of files) tiers[reachesLauncher(f) ? 'live' : 'quick'].push(f);
  return tiers;
}
const splitExclusive = (files) => ({ parallel: files.filter(f => !isExclusive(f)), exclusive: files.filter(isExclusive) });

// ---------------------------------------------------------------- merge tier: which live tests does the change affect
const FILE_LITERAL_RE = /['"`]([A-Za-z0-9_@#./-]+\.(?:js|mjs|cjs|html|css|json|svg))['"`]/g;
// A repo path inside a URL or template literal: `http://127.0.0.1:${port}/apps/sketchstudio/index.html`, '/tests/x.html'.
// It starts after a non-path character (so `myapps/x.js` does not count) and runs through path characters, where a `${...}`
// placeholder stands for one path segment (`/apps/${app}/index.html` -> every apps/<dir>/index.html that exists). Over-picking is fine.
const URL_PATH_RE = /(?:^|[^A-Za-z0-9_.-])\/((?:apps|packages|tests)\/(?:[A-Za-z0-9_@#./-]|\$\{[^}]*\})+)/g;
// path.join(REPO_ROOT, 'tests', 'fixtures', 'dxf', 'a.dxf'): a run of string literals that starts at a top-level repo directory.
const SEGMENT_CHAIN_RE = /['"](apps|packages|tests|assets)['"]((?:\s*,\s*['"][^'",]+['"])+)/g;
// What a static scan cannot see, declared per test: a changed file whose path starts with an entry picks the test. One comment per entry.
const DECLARED_DEPS = {
  'tests/sketch-import.test.js': ['tests/fixtures/'], // FIX('svg', name) / FIX('dxf', name): a helper builds the fixture path, the names are never one literal
  'tests/import-polish-fit-a.test.js': ['tests/fixtures/'], // the same FIX(...) helper (in tests/helpers/import-polish-fit.js)
  'tests/import-polish-fit-b.test.js': ['tests/fixtures/'], // the same
};
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
  // a bare path is repo-root relative when it begins with a slash or names a repo path, else relative to the file (`<script src="src/main.js">` in an html page)
  return existingFile(spec.replace(/^\/+/, '')) || (spec.startsWith('/') ? null : existingFile(path.posix.join(path.posix.dirname(fromFile), spec)));
}

// `apps/${app}/index.html` -> the existing files that fit; a placeholder segment matches any directory entry
function expandPlaceholders(rel) {
  let paths = [''];
  for (const seg of rel.split('/')) {
    const next = [];
    for (const base of paths) {
      if (/\$\{/.test(seg)) {
        const dir = path.join(REPO_ROOT, base);
        if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) for (const e of fs.readdirSync(dir)) next.push(base ? `${base}/${e}` : e);
      } else next.push(base ? `${base}/${seg}` : seg);
    }
    paths = next;
  }
  return paths;
}

function refsOf(file) {
  const src = fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');
  const out = new Set();
  const specs = [];
  for (const m of src.matchAll(FILE_LITERAL_RE)) specs.push(m[1]);
  for (const m of src.matchAll(URL_PATH_RE)) specs.push(...expandPlaceholders(m[1].replace(/\.+$/, '')));
  for (const m of src.matchAll(SEGMENT_CHAIN_RE)) specs.push([m[1], ...[...m[2].matchAll(/['"]([^'"]+)['"]/g)].map(x => x[1])].join('/'));
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
    for (const prefix of DECLARED_DEPS[file] || []) why.push(...changed.filter(c => c.startsWith(prefix) && !why.includes(c)));
    if (why.length) picked.push({ file, why });
  }
  return { picked, everything: null, changed };
}

// ---------------------------------------------------------------- the shared CPU lock (TASK 873; see SHARED CPU LOCK in the header)
const CPU_LOCK_LIB = path.join(os.homedir(), '.shared-cpu', 'cpu_lock.sh').replace(/\\/g, '/');
const CPU_LOCK_PROJECT = 'sketch';
const SIDE_LANE_MAX_MIN = 5; // the library's CPU_LOCK_SHORT_MIN: a take whose eta is <= this many minutes runs in its side lane, beside the main holder

const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// Git for Windows' bash (the library is a bash file; bash is not on a PowerShell / cmd PATH): <git>/mingw64/libexec/git-core -> <git>/bin/bash.exe
let bashPath = null;
function gitBash() {
  if (bashPath) return bashPath;
  const r = spawnSync('git', ['--exec-path'], { encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) throw new Error(`gate: git --exec-path failed: ${r.stderr}`);
  const bash = path.resolve(r.stdout.trim(), '..', '..', '..', 'bin', 'bash.exe');
  if (!fs.existsSync(bash)) throw new Error(`gate: Git Bash not found at ${bash} (the shared CPU lock library needs it)`);
  if (!fs.existsSync(CPU_LOCK_LIB)) throw new Error(`gate: the shared CPU lock library is missing: ${CPU_LOCK_LIB}`);
  bashPath = bash;
  return bash;
}
// `source <library>; <body>` in Git Bash with this gate's pid as the holder pid; "$2".. are `args`
const cpuLockSpawnArgs = (body, args) => [gitBash(), ['-c', `source "$1" && ${body}`, 'bash', CPU_LOCK_LIB, ...args],
  { env: { ...process.env, CPU_LOCK_PID: String(process.pid) }, windowsHide: true }];
// The library records pid=$(cat /proc/$CPU_LOCK_PID/winpid || echo $CPU_LOCK_PID): an MSYS pid is mapped to ITS Windows pid. This gate's pid is a
// Windows pid; if an MSYS process has the same number, the library would record that process instead: refuse loudly rather than hold a wrong record.
const TAKE_BODY = '{ [ ! -e "/proc/$CPU_LOCK_PID" ] || { echo "gate: pid $CPU_LOCK_PID is also an MSYS pid: the shared CPU lock would record that process, not this gate; run the gate again" >&2; exit 3; }; } && cpu_lock_take "$2" "$3" "$4"';

let cpuLockTaking = false; // a take has started in this run: release on every exit path (the release also clears this project's waiting mark)
// blocks until the library grants the lock (main lane, or its side lane for an eta <= SIDE_LANE_MAX_MIN); the library's lines go to our stdout
function takeCpuLock(what, eta) {
  cpuLockTaking = true;
  const [bash, args, opts] = cpuLockSpawnArgs(TAKE_BODY, [CPU_LOCK_PROJECT, what, eta]);
  return new Promise((resolve, reject) => {
    const child = spawn(bash, args, { ...opts, stdio: ['ignore', 'inherit', 'inherit'] });
    child.on('error', reject);
    child.on('close', (code, signal) => (code === 0 ? resolve() : reject(new Error(`gate: cpu_lock_take ended with ${signal || `exit ${code}`}`))));
  });
}
function releaseCpuLock() {
  if (!cpuLockTaking) return;
  cpuLockTaking = false;
  const [bash, args, opts] = cpuLockSpawnArgs('cpu_lock_release "$2"', [CPU_LOCK_PROJECT]);
  const r = spawnSync(bash, args, { ...opts, stdio: ['ignore', 'inherit', 'inherit'] });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`gate: cpu_lock_release exited ${r.status}`);
}
// the library's status: its main-lane holder line (`project=.. what=.. start=.. eta=.. pid=.. host=..`) when ANOTHER run holds the main lane, else null
function otherMainHolder() {
  const [bash, args, opts] = cpuLockSpawnArgs('cpu_lock_status', []);
  const r = spawnSync(bash, args, { ...opts, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`gate: cpu_lock_status exited ${r.status}: ${r.stderr}`);
  const first = r.stdout.split(/\r?\n/)[0];
  if (first === 'free') return null;
  const m = first.match(/^held: (.*?)\s*$/);
  if (!m) throw new Error(`gate: cpu_lock_status printed an unknown first line: ${first}`);
  return new RegExp(`(?:^| )pid=${process.pid}(?: |$)`).test(m[1]) ? null : m[1];
}

// Minutes this run is expected to hold the lock, from the timings file (each file's seconds in the last run it ran in): a pool's wall time is about
// its files' summed seconds over its jobs; the exclusive tests run one after another. parts: [{ files, jobs }]. A file never timed counts 0.
function etaMinutes(parts, timings) {
  let seconds = 0;
  for (const { files, jobs } of parts) {
    const { parallel, exclusive } = splitExclusive(files);
    seconds += parallel.reduce((s, f) => s + (timings[f] || 0), 0) / jobs + exclusive.reduce((s, f) => s + (timings[f] || 0), 0);
  }
  return Math.max(1, Math.ceil(seconds / 60));
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

// the exclusive tests of one tier, one at a time, nothing else of this gate running, and none while ANOTHER run holds the shared lock's main lane:
// the library's status is asked before each one; once another run holds it, this one and the rest are DEFERRED (only the quick tier, in the side
// lane, can meet that; live/full/merge hold the main lane themselves)
async function runExclusive(files, tier, results, deferred) {
  for (let i = 0; i < files.length; i++) {
    const holder = otherMainHolder();
    if (holder) {
      for (const file of files.slice(i)) console.log(`DEFERRED ${file} (the shared CPU lock is held: ${holder}; the merge / full tier runs it)`);
      console.log(`DEFERRED ${files.length - i}`);
      deferred.push(...files.slice(i));
      return;
    }
    const r = await runFile(files[i], tier);
    results.push(r);
    console.log(`EXCLUSIVE ${r.file} ${(r.ms / 1000).toFixed(1)}`);
    if (!r.ok) console.log(`FAIL ${r.file} (${(r.ms / 1000).toFixed(1)}s)`);
  }
}

// ---------------------------------------------------------------- shell-smoke + leftover headless browsers
// shell-smoke is green when every one of its checks passed: N/N with N > 0 (its check count grows as tasks add checks).
const smokeGreen = (score) => { const [p, t] = String(score).split('/').map(Number); return t > 0 && p === t; };

function runSmoke() {
  const res = spawnSync(process.execPath, [path.join('scripts', 'shell-smoke.cjs')], {
    cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, timeout: FILE_LIMIT_MS,
  });
  let score = '0/0';
  if (res.stdout) {
    const m = res.stdout.match(/shell-smoke:\s*(\d+\/\d+)/);
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

// ---------------------------------------------------------------- stale test profile sweep (TASK 671)
const PROFILE_DIR_PREFIXES = ['sk-test-', 'sk-shell-smoke-'];
const isProfileDirName = (name) => PROFILE_DIR_PREFIXES.some((p) => name.startsWith(p));
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function getRunningBrowserCommandLines() {
  if (process.platform === 'win32') {
    const psScript = "Get-CimInstance Win32_Process -Filter \"name = 'msedge.exe' or name = 'chrome.exe' or name = 'chromium.exe'\" | Where-Object { $_.CommandLine } | ForEach-Object { $_.CommandLine }";
    const psRes = spawnSync('powershell', ['-NoProfile', '-Command', psScript], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, timeout: 15000 });
    if (psRes.error) throw psRes.error;
    if (psRes.status !== 0) throw new Error(`gate: browser process scan failed: ${psRes.stderr}`);
    return (psRes.stdout || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  }
  const res = spawnSync('ps', ['-eo', 'args='], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000 });
  if (res.error) throw res.error;
  if (res.status !== 0) throw new Error(`gate: browser process scan failed: ${res.stderr}`);
  return (res.stdout || '').split(/\r?\n/).map(l => l.trim()).filter(l => /(?:chrome|chromium|msedge)/i.test(l));
}

function isProfileInUse(name, cmdLines) {
  const re = new RegExp(`${escapeRegExp(name)}(?=[\\\\/"'\\s]|$)`, process.platform === 'win32' ? 'i' : '');
  return cmdLines.some((cmd) => re.test(cmd));
}

function shouldSweepProfileDir({ name, mtimeMs, runStartedMs, cmdLines }) {
  return isProfileDirName(name) && mtimeMs < runStartedMs && !isProfileInUse(name, cmdLines);
}

function listProfileDirs(tmpDir) {
  const out = [];
  for (const entry of fs.readdirSync(tmpDir, { withFileTypes: true })) {
    if (entry.isDirectory() && isProfileDirName(entry.name)) out.push(entry.name);
  }
  return out;
}

function sweepProfiles({ tmpDir = os.tmpdir(), runStartedMs, cmdLines = getRunningBrowserCommandLines() }) {
  const removed = [];
  const failed = [];
  for (const name of listProfileDirs(tmpDir)) {
    const full = path.join(tmpDir, name);
    let stat;
    try { stat = fs.lstatSync(full); } catch (e) {
      if (e.code === 'ENOENT') continue;
      throw e;
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) continue;
    if (!shouldSweepProfileDir({ name, mtimeMs: stat.mtimeMs, runStartedMs, cmdLines })) continue;
    try {
      fs.rmSync(full, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      removed.push(name);
    } catch (e) {
      console.warn(`gate: could not remove stale profile dir ${full}: ${e.message}`);
      failed.push({ name, error: e.message });
    }
  }
  const left = listProfileDirs(tmpDir);
  return { removed, failed, left };
}

// ---------------------------------------------------------------- main
async function main() {
  const { tier, jobs, list, plan, base, head } = parseArgs(process.argv.slice(2));
  const tiers = classify(findTestFiles());
  if (list) { // --list: print each file with its tier and exit (nothing runs, no lock)
    for (const t of ['quick', 'live']) for (const f of tiers[t]) console.log(`${t} ${f}${isExclusive(f) ? ' exclusive' : ''}`);
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
  const timings = loadTimings();
  const quickJobs = jobs || QUICK_JOBS;
  const liveJobs = jobs || LIVE_JOBS;

  // the shared CPU lock, for the whole run (TASK 873). The quick tier declares its own estimate (<= SIDE_LANE_MAX_MIN: the library's side lane).
  // A browser tier must hold the MAIN lane (its browsers and exclusive tests must not run beside another heavy run), and the library sends an eta
  // <= SIDE_LANE_MAX_MIN to the side lane, so a browser tier declares at least SIDE_LANE_MAX_MIN + 1 (only a short merge or a run with no timings
  // estimates less; the WORK-LOG's merge runs took 8 to 28 min).
  const parts = [...(wantQuick ? [{ files: tiers.quick, jobs: quickJobs }] : []), ...(wantLive ? [{ files: liveFiles, jobs: liveJobs }] : [])];
  const estimate = etaMinutes(parts, timings);
  const eta = wantLive ? Math.max(estimate, SIDE_LANE_MAX_MIN + 1) : estimate;
  const what = `gate:${tier} ${REPO_ROOT.replace(/\\/g, '/')}`;
  const onSignal = () => { releaseCpuLock(); process.exit(130); };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  console.log(`CPU-LOCK taking the shared CPU lock as ${CPU_LOCK_PROJECT} (${what}, eta ~${eta}min; timings estimate ${estimate} min)`);
  await takeCpuLock(what, `~${eta}min`);

  const results = [];
  let smoke = null;
  let counts = null;
  let sweep = null;
  const deferred = []; // exclusive tests not run because another run held the shared lock's main lane
  try {
    if (wantQuick) {
      const q = splitExclusive(tiers.quick);
      results.push(...await runPool(q.parallel, 'quick', quickJobs, timings, true));
      await runExclusive(q.exclusive, 'quick', results, deferred);
    }
    if (wantLive) {
      const l = splitExclusive(liveFiles);
      results.push(...await runPool(l.parallel, 'live', liveJobs, timings, true));
      await runExclusive(l.exclusive, 'live', results, deferred);
      smoke = runSmoke();
      counts = headlessCheck(smoke.pid);
    }
    saveTimings(timings, results);
    try {
      sweep = sweepProfiles({ runStartedMs: started });
    } catch (e) {
      console.warn(`gate: profile sweep failed: ${e.message}`);
    }
  } finally {
    releaseCpuLock();
  }

  const failed = results.filter(r => !r.ok);
  for (const f of failed) console.log(`\n--- FAIL ${f.file} [${f.tier}] output tail ---\n${f.tail.trim()}\n--- end ${f.file} ---`);
  if (smoke && !smokeGreen(smoke.score)) console.log(`\n--- shell-smoke output tail ---\n${smoke.tail.trim()}\n---`);

  console.log('\nSLOWEST 15 (seconds, tier, file):');
  for (const r of [...results].sort((a, b) => b.ms - a.ms).slice(0, 15)) console.log(`  ${(r.ms / 1000).toFixed(1).padStart(6)}  ${r.tier.padEnd(5)}  ${r.file}`);

  const jobsText = [wantQuick ? `quick=${quickJobs}` : null, wantLive ? `live=${liveJobs}` : null].filter(Boolean).join(',');
  console.log(`GATE tier=${tier} jobs=${jobsText} files=${results.length} pass=${results.length - failed.length} fail=${failed.length}${deferred.length ? ` deferred=${deferred.length}` : ''} elapsed=${((Date.now() - started) / 1000).toFixed(0)}s`);
  for (const f of failed) console.log(`FAIL ${f.file}`);
  for (const k of KNOWN_FAILURES) if (!failed.some(f => f.file === k)) console.log(`KNOWN-NOW-PASSING ${k}`);
  if (smoke) {
    console.log(`SMOKE ${smoke.score}`);
    console.log(`HEADLESS-LEFT ${counts.left}`);
    console.log(`HEADLESS-OTHER ${counts.other}`);
  }
  if (sweep) console.log(`PROFILES-LEFT ${sweep.left.length}`);

  const unknownFailures = failed.filter(f => !KNOWN_FAILURES.includes(f.file));
  const passed = unknownFailures.length === 0 && (!smoke || (smokeGreen(smoke.score) && counts.left === 0));
  process.exit(passed ? 0 : 1);
}

module.exports = { isProfileDirName, isProfileInUse, shouldSweepProfileDir, sweepProfiles, getRunningBrowserCommandLines };

if (require.main === module) {
  main().catch((e) => { releaseCpuLock(); console.error(e.stack || e.message); process.exit(2); });
}
