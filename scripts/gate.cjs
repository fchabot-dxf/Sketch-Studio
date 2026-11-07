#!/usr/bin/env node
// scripts/gate.cjs — One-command gate verifying all unit/integration tests, shell-smoke, and headless process hygiene.
// Exit 0 only if all failures are in KNOWN_FAILURES (subset), smoke is 12/12, and headless left is 0.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');

// KNOWN failures list with one-line reason comments.
// Per task 415 amendment: exit 0 if every observed failure is in this list (subset).
const KNOWN_FAILURES = [
  // Real bug: bi-directional whiskers along slanted line never render (reported in turn 414)
  'tests/debug-whisker-align.test.js',
  // Environment: missing optional devDependency @salusoft89/planegcs
  'tests/harness/differential-planegcs.test.js',
];

const TEST_DIRS = [
  'tests',
  'packages/core/tests',
  'tests/harness',
];

function findTestFiles() {
  const files = [];
  for (const relDir of TEST_DIRS) {
    const absDir = path.join(REPO_ROOT, relDir);
    if (!fs.existsSync(absDir)) continue;
    const entries = fs.readdirSync(absDir);
    for (const entry of entries) {
      if (entry.endsWith('.test.js')) {
        const fullPath = path.join(absDir, entry);
        if (fs.statSync(fullPath).isFile()) {
          files.push(`${relDir}/${entry}`.replace(/\\/g, '/'));
        }
      }
    }
  }
  return files;
}

function main() {
  const testFiles = findTestFiles();
  let passCount = 0;
  let failCount = 0;
  const failedFiles = [];

  // a. Run every test file one by one with a 90s limit
  for (const file of testFiles) {
    const res = spawnSync(process.execPath, [file], {
      cwd: REPO_ROOT,
      timeout: 90000,
      stdio: 'ignore',
      windowsHide: true,
    });
    const timedOut = res.error && (res.error.code === 'ETIMEDOUT' || res.signal === 'SIGTERM');
    const failed = timedOut || (res.status !== 0) || (res.error !== undefined);
    if (failed) {
      failCount++;
      failedFiles.push(file);
    } else {
      passCount++;
    }
  }

  // b. Run shell-smoke.cjs and capture its X/12 line
  const smokeRes = spawnSync(process.execPath, [path.join('scripts', 'shell-smoke.cjs')], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    timeout: 90000,
  });

  let smokeScore = '0/12';
  if (smokeRes.stdout) {
    const m = smokeRes.stdout.match(/shell-smoke:\s*(\d+\/\d+)/);
    if (m) {
      smokeScore = m[1];
    } else {
      const m2 = smokeRes.stdout.match(/(\d+\/12)/);
      if (m2) smokeScore = m2[1];
    }
  }

  // c. Count leftover headless msedge.exe processes matching "sk-shell-smoke"
  let headlessLeft = 0;
  const countHeadless = () => {
    try {
      const psScript = `(Get-CimInstance Win32_Process -Filter "name = 'msedge.exe'" | Where-Object { $_.CommandLine -like "*sk-shell-smoke*" } | Measure-Object).Count`;
      const psRes = spawnSync('powershell', ['-NoProfile', '-Command', psScript], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true,
        timeout: 15000,
      });
      if (psRes.stdout) {
        return parseInt(psRes.stdout.trim(), 10) || 0;
      }
    } catch (_) {}
    return 0;
  };

  headlessLeft = countHeadless();
  // Allow Windows process table a brief grace period to finish reaping after taskkill
  if (headlessLeft > 0) {
    const start = Date.now();
    while (Date.now() - start < 3000) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 400);
      headlessLeft = countHeadless();
      if (headlessLeft === 0) break;
    }
  }

  // d. Print summary block
  console.log(`GATE files=${testFiles.length} pass=${passCount} fail=${failCount}`);
  for (const f of failedFiles) {
    console.log(`FAIL ${f}`);
  }
  for (const k of KNOWN_FAILURES) {
    if (!failedFiles.includes(k)) {
      console.log(`KNOWN-NOW-PASSING ${k}`);
    }
  }
  console.log(`SMOKE ${smokeScore}`);
  console.log(`HEADLESS-LEFT ${headlessLeft}`);

  // Exit rule: exit 0 only if every failure is in KNOWN_FAILURES (subset), smoke is 12/12, headless is 0
  const unknownFailures = failedFiles.filter(f => !KNOWN_FAILURES.includes(f));
  const passed = (unknownFailures.length === 0) && (smokeScore === '12/12') && (headlessLeft === 0);
  process.exit(passed ? 0 : 1);
}

main();
