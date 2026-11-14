// tests/gate-quick-no-wait.test.js (TASK 606): the quick tier never waits for the machine-wide lock.
// Runs a COPY of scripts/gate.cjs in a throwaway repo (REPO_ROOT is the script's parent dir; the lock lives in $LOCALAPPDATA, pointed at a temp dir),
// with one plain test and one `// gate: exclusive` test. No browser.
import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-quick-nowait-'));
const state = path.join(root, 'state');
fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
fs.mkdirSync(path.join(root, 'tests'), { recursive: true });
fs.mkdirSync(state);
fs.copyFileSync(path.resolve('scripts', 'gate.cjs'), path.join(root, 'scripts', 'gate.cjs'));
fs.writeFileSync(path.join(root, 'tests', 'plain.test.js'), "console.log('plain ok');\n");
fs.writeFileSync(path.join(root, 'tests', 'timing.test.js'), "// gate: exclusive\nconsole.log('timing ok');\n");
const lockFile = path.join(state, 'sketch-studio-gate.lock');
const gate = (args, timeout = 60000) => spawnSync(process.execPath, [path.join(root, 'scripts', 'gate.cjs'), ...args], {
  cwd: root, encoding: 'utf8', timeout, env: { ...process.env, LOCALAPPDATA: state },
});

try {
  // 1. lock free: quick runs the exclusive test too, takes and releases the lock
  let r = gate(['--tier', 'quick']);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /EXCLUSIVE tests\/timing\.test\.js/);
  assert.match(r.stdout, /GATE tier=quick jobs=\S+ files=2 pass=2 fail=0 elapsed=/);
  assert.doesNotMatch(r.stdout, /deferred=|DEFERRED/);
  assert.ok(!fs.existsSync(lockFile), 'the lock is released after the exclusive part');

  // 2. lock held by a live other pid (our parent): quick defers the exclusive test, exits 0, never waits
  fs.writeFileSync(lockFile, JSON.stringify({ pid: process.ppid, worktree: 'D:\other', tier: 'merge', started: new Date().toISOString() }));
  const t0 = Date.now();
  r = gate(['--tier', 'quick']);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /DEFERRED tests\/timing\.test\.js \(lock held by merge in D:\other, pid \d+; the merge \/ full tier runs it\)/);
  assert.match(r.stdout, /^DEFERRED 1$/m);
  assert.match(r.stdout, /GATE tier=quick jobs=\S+ files=1 pass=1 fail=0 deferred=1 elapsed=/);
  assert.doesNotMatch(r.stdout, /EXCLUSIVE|waiting/);
  assert.ok(Date.now() - t0 < 30000, 'quick did not wait');
  assert.ok(fs.existsSync(lockFile) && JSON.parse(fs.readFileSync(lockFile, 'utf8')).pid === process.ppid, "the other gate's lock is untouched");

  // 3. the live tier (merge and full take the lock the same way) still WAITS while it is held: it is still running when the timeout kills it
  r = gate(['--tier', 'live'], 6000);
  assert.ok(r.error && r.error.code === 'ETIMEDOUT', 'live tier must keep waiting for the lock');
  assert.match(r.stdout, /LOCK held by pid \d+: merge in D:\other .*; waiting/);
  assert.ok(fs.existsSync(lockFile), 'the waiting gate did not take the lock');
  console.log('gate-quick-no-wait: ok');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
