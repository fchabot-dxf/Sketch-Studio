// tests/gate-shared-lock.test.js (TASK 873; was gate-quick-no-wait, TASK 606): the gate takes the SHARED machine-wide CPU lock
// (~/.shared-cpu/cpu_lock.sh, the library b-spline and DDCS use) as project `sketch`, through the library itself.
// Runs a COPY of scripts/gate.cjs in a throwaway repo (REPO_ROOT is the script's parent dir) against the REAL library, with the
// library's own test root: CPU_LOCK_ROOT points at a temp dir (the library never posts a test root to the live board).
// The timings file ($LOCALAPPDATA) and the profile sweep ($TEMP) point at temp dirs too. No browser: the "live" test only carries
// the launcher marker string, so the gate files it as live. Fixture holders below are written in the library's holder.txt format.
import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn, spawnSync } from 'child_process';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-shared-lock-'));
const state = path.join(root, 'state');
const tmp = path.join(root, 'tmp');
const lockRoot = path.join(root, 'cpu').replace(/\\/g, '/');
const lockDir = path.join(lockRoot, 'lock');
const sideDir = path.join(lockRoot, 'side');
const release = path.join(root, 'release-live'); // the live test waits for this file (case D)
for (const d of ['scripts', 'tests', 'state', 'tmp', 'cpu']) fs.mkdirSync(path.join(root, d), { recursive: true });
fs.copyFileSync(path.resolve('scripts', 'gate.cjs'), path.join(root, 'scripts', 'gate.cjs'));

const readHolder = (dir) => fs.readFileSync(path.join(dir, 'holder.txt'), 'utf8');
// a test of the throwaway repo writes what it sees of the lock to observed.txt (the gate prints a passing test's output nowhere)
const observed = path.join(root, 'observed.txt');
const printHolder = (sub) => `const fs = require('fs'); const p = process.env.CPU_LOCK_ROOT + '/${sub}/holder.txt';
fs.writeFileSync(${JSON.stringify(observed)}, 'HOLDER ' + (fs.existsSync(p) ? fs.readFileSync(p, 'utf8').replace(/\\n/g, ' ') : 'none') + ' PARENT=' + process.ppid);`;
const seenHolder = () => fs.readFileSync(observed, 'utf8');
const writeQuickTests = () => {
  fs.writeFileSync(path.join(root, 'tests', 'plain.test.js'), `${printHolder('side')}\n`);
  fs.writeFileSync(path.join(root, 'tests', 'timing.test.js'), "// gate: exclusive\nconsole.log('timing ok');\n");
};
const writeLiveTest = () => {
  for (const f of ['plain.test.js', 'timing.test.js']) fs.rmSync(path.join(root, 'tests', f), { force: true });
  // the launcher marker is split here so that THIS file stays a quick test (the gate's tier scan reads it too)
  fs.writeFileSync(path.join(root, 'tests', 'browser.test.js'), `// ${'remote-debugging'}-port (marker only: the gate files this test as live; it starts no browser)
${printHolder('lock')}
const until = Date.now() + 60000;
while (process.env.WAIT_FOR && !fs.existsSync(process.env.WAIT_FOR) && Date.now() < until) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
`);
};
const fakeHolder = (pid) => {
  fs.mkdirSync(lockDir);
  fs.writeFileSync(path.join(lockDir, 'holder.txt'), `project=bspline\nwhat=fake heavy run\nstart=${Math.floor(Date.now() / 1000)}\neta=~25min\npid=${pid}\nhost=${os.hostname()}\n`);
};

const env = (extra = {}) => ({ ...process.env, LOCALAPPDATA: state, TEMP: tmp, TMP: tmp, CPU_LOCK_ROOT: lockRoot, ...extra });
const running = new Set(); // gate children not yet exited: the finally kills only these (never a pid that may have been reused)
// one gate run, streamed: `done` resolves with its exit code; `seen(re)` resolves when its output matches
function startGate(args, extra) {
  const child = spawn(process.execPath, [path.join(root, 'scripts', 'gate.cjs'), ...args], { cwd: root, env: env(extra), windowsHide: true });
  running.add(child);
  let out = '';
  const waiters = [];
  const feed = (b) => { out += b.toString(); for (const w of waiters) if (w.re.test(out)) w.resolve(); };
  child.stdout.on('data', feed);
  child.stderr.on('data', feed);
  const done = new Promise((resolve) => child.on('close', (code) => { running.delete(child); resolve(code); }));
  const seen = (re, ms = 60000) => new Promise((resolve, reject) => {
    if (re.test(out)) return resolve();
    waiters.push({ re, resolve });
    setTimeout(() => reject(new Error(`gate output never matched ${re} in ${ms} ms:\n${out}`)), ms).unref();
  });
  return { child, done, seen, out: () => out };
}
const killTree = (pid) => spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
const deadPid = () => spawnSync(process.execPath, ['-e', '0']).pid;

try {
  // A. quick, lock free: it holds the SIDE lane (a short eta: the library's short-job lane) with this gate's pid, runs the
  //    exclusive test (the main lane is free), and releases the side lane.
  writeQuickTests();
  let g = startGate(['--tier', 'quick']);
  let code = await g.done;
  assert.strictEqual(code, 0, g.out());
  assert.match(g.out(), /cpu_lock: short job running beside the main lane \(sketch: gate:quick /);
  assert.match(seenHolder(), new RegExp(`HOLDER project=sketch what=gate:quick .* pid=${g.child.pid} host=\\S+ +PARENT=${g.child.pid}`));
  assert.match(g.out(), /EXCLUSIVE tests\/timing\.test\.js/);
  assert.match(g.out(), /GATE tier=quick jobs=\S+ files=2 pass=2 fail=0 elapsed=/);
  assert.doesNotMatch(g.out(), /deferred=|DEFERRED/);
  assert.ok(!fs.existsSync(sideDir) && !fs.existsSync(lockDir), 'the side lane is released and the main lane was never taken');

  // B. quick while another project's heavy run holds the MAIN lane (a live pid: this test's): quick does not wait for it,
  //    defers the exclusive test (it asks the library's status before each one), exits 0, leaves that lock alone.
  fakeHolder(process.pid);
  const t0 = Date.now();
  g = startGate(['--tier', 'quick']);
  code = await g.done;
  assert.strictEqual(code, 0, g.out());
  assert.match(g.out(), /DEFERRED tests\/timing\.test\.js \(the shared CPU lock is held: project=bspline what=fake heavy run .*; the merge \/ full tier runs it\)/);
  assert.match(g.out(), /^DEFERRED 1$/m);
  assert.match(g.out(), /GATE tier=quick jobs=\S+ files=1 pass=1 fail=0 deferred=1 elapsed=/);
  assert.doesNotMatch(g.out(), /EXCLUSIVE|cpu_lock: waiting/);
  assert.ok(Date.now() - t0 < 30000, 'quick did not wait');
  assert.match(readHolder(lockDir), new RegExp(`^pid=${process.pid}$`, 'm'), "the other project's lock is untouched");
  fs.rmSync(lockDir, { recursive: true });

  // C. live tier over a STALE holder (its pid is dead): the library takes it over; the MAIN lane then holds project sketch and
  //    THIS gate's pid for the whole run; the run is red (no shell-smoke in the throwaway repo) and the lock is released.
  writeLiveTest();
  const dead = deadPid();
  fakeHolder(dead);
  g = startGate(['--tier', 'live']);
  code = await g.done;
  assert.strictEqual(code, 1, `a red run exits 1:\n${g.out()}`);
  assert.match(g.out(), new RegExp(`cpu_lock: removed stale lock \\(pid ${dead},`));
  assert.match(g.out(), /cpu_lock: held by sketch \(gate:live /);
  assert.match(seenHolder(), new RegExp(`HOLDER project=sketch what=gate:live .* eta=~\\d+min pid=${g.child.pid} host=\\S+ +PARENT=${g.child.pid}`));
  assert.match(g.out(), /GATE tier=live jobs=live=\d+ files=1 pass=1 fail=0 elapsed=/);
  assert.match(g.out(), /SMOKE 0\/0/);
  assert.ok(!fs.existsSync(lockDir), 'released after a red run');

  // D. a second gate WAITS while the first holds the lock and prints who holds it; killed while waiting, it took nothing.
  const a = startGate(['--tier', 'live'], { WAIT_FOR: release });
  fs.rmSync(observed);
  await a.seen(/cpu_lock: held by sketch/);
  while (!fs.existsSync(observed)) await new Promise((r) => setTimeout(r, 200)); // its live test is running: the lock is held
  assert.match(seenHolder(), new RegExp(`pid=${a.child.pid} `));
  const b = startGate(['--tier', 'live']);
  await b.seen(/cpu_lock: waiting for sketch \(gate:live .*, eta ~\d+min\)/);
  killTree(b.child.pid);
  await b.done;
  assert.match(readHolder(lockDir), new RegExp(`^pid=${a.child.pid}$`, 'm'), 'the waiting gate did not take the lock');
  fs.writeFileSync(release, '');
  code = await a.done;
  assert.strictEqual(code, 1, a.out());
  assert.ok(!fs.existsSync(lockDir), 'the first gate released it');

  // E. a THROWN error after the take (the timings file cannot be written): exit 2, the error printed, the lock released.
  const timings = path.join(state, 'sketch-studio-gate-timings.json');
  fs.writeFileSync(timings, '{}');
  fs.chmodSync(timings, 0o444);
  g = startGate(['--tier', 'live']);
  code = await g.done;
  fs.chmodSync(timings, 0o666);
  assert.strictEqual(code, 2, g.out());
  assert.match(g.out(), /cpu_lock: held by sketch/);
  assert.match(g.out(), /EPERM|EACCES/);
  assert.match(g.out(), /cpu_lock: released by sketch/);
  assert.ok(!fs.existsSync(lockDir), 'released after a thrown error');
  console.log('gate-shared-lock: ok');
} finally {
  for (const child of running) killTree(child.pid);
  fs.rmSync(root, { recursive: true, force: true });
}
