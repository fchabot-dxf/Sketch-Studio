// tests/gate-profile-sweep.test.js — TASK 671: unit test for scripts/gate.cjs stale profile dir sweep.
// Proves: old + unused sk-test-* / sk-shell-smoke-* -> removed; in-use (whole-token) or newer/equal -> kept;
// non-profile dirs and files -> never touched and not counted in PROFILES-LEFT.
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  isProfileDirName,
  isProfileInUse,
  shouldSweepProfileDir,
  sweepProfiles,
} = require('../scripts/gate.cjs');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-671-sweep-unit-'));
const runStartedMs = 1_700_000_120_000;
const oldTime = new Date(runStartedMs - 60_000);
const atStartTime = new Date(runStartedMs);
const newTime = new Date(runStartedMs + 30_000);

const makeDir = (name, mtime) => {
  const dir = path.join(tmpDir, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'DevToolsActivePort'), '9222\n');
  fs.utimesSync(dir, mtime, mtime);
  return dir;
};

try {
  // Pure predicate checks
  assert.strictEqual(isProfileDirName('sk-test-abc'), true);
  assert.strictEqual(isProfileDirName('sk-shell-smoke-123'), true);
  assert.strictEqual(isProfileDirName('sk-574-xyz'), false);
  assert.strictEqual(isProfileDirName('TempOther'), false);

  const cmdLines = [
    '"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe" --headless=new --user-data-dir="C:\\Temp\\sk-test-inuse-123" about:blank',
    '"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --headless=new --user-data-dir=C:\\Temp\\sk-shell-smoke-456\\ about:blank',
    '"msedge.exe" --user-data-dir="C:\\Temp\\sk-test-prefix-1234" about:blank',
  ];

  assert.strictEqual(isProfileInUse('sk-test-inuse-123', cmdLines), true);
  assert.strictEqual(isProfileInUse('sk-shell-smoke-456', cmdLines), true);
  assert.strictEqual(isProfileInUse('sk-test-prefix-123', cmdLines), false, 'whole-token check must not match -1234');
  assert.strictEqual(shouldSweepProfileDir({ name: 'sk-test-old', mtimeMs: runStartedMs - 1, runStartedMs, cmdLines }), true);
  assert.strictEqual(shouldSweepProfileDir({ name: 'sk-test-inuse-123', mtimeMs: runStartedMs - 1, runStartedMs, cmdLines }), false);
  assert.strictEqual(shouldSweepProfileDir({ name: 'sk-test-new', mtimeMs: runStartedMs, runStartedMs, cmdLines }), false);

  // Filesystem sweep check in isolated mock tmpDir
  const oldUnusedTest = makeDir('sk-test-old-unused', oldTime);
  const oldUnusedPrefix = makeDir('sk-test-prefix-123', oldTime);
  const oldUnusedSmoke = makeDir('sk-shell-smoke-999', oldTime);
  const oldInUseTest = makeDir('sk-test-inuse-123', oldTime);
  const oldInUseSmoke = makeDir('sk-shell-smoke-456', oldTime);
  const atStartUnused = makeDir('sk-test-at-start', atStartTime);
  const newUnused = makeDir('sk-test-newer', newTime);
  const unrelatedDir = makeDir('sk-574-other', oldTime);
  const unrelatedPlain = makeDir('other-temp-dir', oldTime);
  const skNamedFile = path.join(tmpDir, 'sk-test-file-not-dir');
  fs.writeFileSync(skNamedFile, 'keep me');
  fs.utimesSync(skNamedFile, oldTime, oldTime);

  const res = sweepProfiles({ tmpDir, runStartedMs, cmdLines });
  assert.deepStrictEqual(
    [...res.removed].sort(),
    ['sk-shell-smoke-999', 'sk-test-old-unused', 'sk-test-prefix-123'],
    'only old and unused sk-test-* / sk-shell-smoke-* dirs are removed',
  );
  assert.deepStrictEqual(res.failed, []);
  assert.deepStrictEqual(
    [...res.left].sort(),
    ['sk-shell-smoke-456', 'sk-test-at-start', 'sk-test-inuse-123', 'sk-test-newer'],
    'left counts only remaining sk-test-* / sk-shell-smoke-* dirs',
  );

  assert.strictEqual(fs.existsSync(oldUnusedTest), false);
  assert.strictEqual(fs.existsSync(oldUnusedPrefix), false);
  assert.strictEqual(fs.existsSync(oldUnusedSmoke), false);
  assert.strictEqual(fs.existsSync(oldInUseTest), true, 'in-use sk-test-* kept');
  assert.strictEqual(fs.existsSync(oldInUseSmoke), true, 'in-use sk-shell-smoke-* kept');
  assert.strictEqual(fs.existsSync(atStartUnused), true, 'dir modified at run start kept');
  assert.strictEqual(fs.existsSync(newUnused), true, 'dir newer than run start kept');
  assert.strictEqual(fs.existsSync(unrelatedDir), true, 'other sk-* dir never touched');
  assert.strictEqual(fs.existsSync(unrelatedPlain), true, 'unrelated dir never touched');
  assert.strictEqual(fs.existsSync(skNamedFile), true, 'regular file with sk-test- prefix never touched');

  console.log('gate-profile-sweep: ok');
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
