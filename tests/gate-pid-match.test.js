// tests/gate-pid-match.test.js — unit-level check for gate.cjs leftover-browser PID token matching (TASK 423b)
// and main browser vs helper process (--type=) filtering (TASK 423c).
// Proves that:
// 1. Given command lines for pids 123 and 1234, pid 123 matches ONLY its own profile directory and does NOT match 1234.
// 2. Lingering helper processes (--type=crashpad-handler, --type=utility, etc.) are filtered out and NOT counted as leaks.
// 3. Main browser processes (no --type=) are correctly counted as leaks if they remain open.

import assert from 'assert';
import { spawnSync } from 'child_process';

console.log('Testing gate PID matching and helper filtering...');

// 1. JS-level regex assertion for PID matching
const makeJsRegex = (pid) => new RegExp(`sk-shell-smoke-${pid}(?=[\\\\/"'\\s]|$)`);

const cmd123_quoted = '"C:\\Program Files\\Edge\\msedge.exe" --headless --user-data-dir="C:\\Temp\\sk-shell-smoke-123" about:blank';
const cmd1234_quoted = '"C:\\Program Files\\Edge\\msedge.exe" --headless --user-data-dir="C:\\Temp\\sk-shell-smoke-1234" about:blank';
const cmd123_unquoted = '"C:\\Program Files\\Edge\\msedge.exe" --headless --user-data-dir=C:\\Temp\\sk-shell-smoke-123 about:blank';
const cmd1234_unquoted = '"C:\\Program Files\\Edge\\msedge.exe" --headless --user-data-dir=C:\\Temp\\sk-shell-smoke-1234 about:blank';
const cmd123_trailingSlash = '"C:\\Program Files\\Edge\\msedge.exe" --headless --user-data-dir="C:\\Temp\\sk-shell-smoke-123\\" about:blank';
const cmd123_endOfLine = '"C:\\Program Files\\Edge\\msedge.exe" --user-data-dir=C:\\Temp\\sk-shell-smoke-123';

const re123 = makeJsRegex(123);
const re1234 = makeJsRegex(1234);

// PID 123 assertions
assert.strictEqual(re123.test(cmd123_quoted), true, 'PID 123 must match quoted 123');
assert.strictEqual(re123.test(cmd123_unquoted), true, 'PID 123 must match unquoted 123');
assert.strictEqual(re123.test(cmd123_trailingSlash), true, 'PID 123 must match 123 with trailing slash');
assert.strictEqual(re123.test(cmd123_endOfLine), true, 'PID 123 must match 123 at end of command line');
assert.strictEqual(re123.test(cmd1234_quoted), false, 'PID 123 must NOT match quoted 1234');
assert.strictEqual(re123.test(cmd1234_unquoted), false, 'PID 123 must NOT match unquoted 1234');

// PID 1234 assertions
assert.strictEqual(re1234.test(cmd1234_quoted), true, 'PID 1234 must match quoted 1234');
assert.strictEqual(re1234.test(cmd1234_unquoted), true, 'PID 1234 must match unquoted 1234');
assert.strictEqual(re1234.test(cmd123_quoted), false, 'PID 1234 must NOT match quoted 123');
assert.strictEqual(re1234.test(cmd123_unquoted), false, 'PID 1234 must NOT match unquoted 123');

// 2. PowerShell -match assertion (the exact regex used in scripts/gate.cjs)
function testPowershellMatch(pid, cmdLine) {
  const psPattern = `sk-shell-smoke-${pid}(?=[\\\\/"''\\s]|$)`;
  const psScript = `
    $cmd = '${cmdLine.replace(/'/g, "''")}';
    $isMatch = $cmd -match '${psPattern}';
    Write-Output $isMatch
  `;
  const res = spawnSync('powershell', ['-NoProfile', '-Command', psScript], {
    encoding: 'utf8',
  });
  return res.stdout.trim() === 'True';
}

if (process.platform === 'win32') {
  assert.strictEqual(testPowershellMatch(123, cmd123_quoted), true, 'PowerShell: PID 123 must match quoted 123');
  assert.strictEqual(testPowershellMatch(123, cmd123_unquoted), true, 'PowerShell: PID 123 must match unquoted 123');
  assert.strictEqual(testPowershellMatch(123, cmd1234_quoted), false, 'PowerShell: PID 123 must NOT match quoted 1234');
  assert.strictEqual(testPowershellMatch(123, cmd1234_unquoted), false, 'PowerShell: PID 123 must NOT match unquoted 1234');

  assert.strictEqual(testPowershellMatch(1234, cmd1234_quoted), true, 'PowerShell: PID 1234 must match quoted 1234');
  assert.strictEqual(testPowershellMatch(1234, cmd123_quoted), false, 'PowerShell: PID 1234 must NOT match quoted 123');
}

// 3. Main process vs helper process (--type=) filtering (TASK 423c)
const cmd123_main = '"C:\\Program Files\\Edge\\msedge.exe" --headless=new --disable-gpu --no-sandbox --no-first-run --disable-extensions --user-data-dir="C:\\Temp\\sk-shell-smoke-123" about:blank';
const cmd123_crashpad = '"C:\\Program Files\\Edge\\msedge.exe" --type=crashpad-handler --user-data-dir="C:\\Temp\\sk-shell-smoke-123" /prefetch:4';
const cmd123_utility = '"C:\\Program Files\\Edge\\msedge.exe" --type=utility --utility-sub-type=network.mojom.NetworkService --user-data-dir="C:\\Temp\\sk-shell-smoke-123"';
const cmd123_gpu = '"C:\\Program Files\\Edge\\msedge.exe" --type=gpu-process --user-data-dir="C:\\Temp\\sk-shell-smoke-123"';
const cmd123_renderer = '"C:\\Program Files\\Edge\\msedge.exe" --type=renderer --user-data-dir="C:\\Temp\\sk-shell-smoke-123"';

// In JS:
const isMainProcess = (cmd) => !cmd.includes('--type=');
assert.strictEqual(isMainProcess(cmd123_main), true, 'Main process has no --type=');
assert.strictEqual(isMainProcess(cmd123_crashpad), false, 'Crashpad handler has --type=');
assert.strictEqual(isMainProcess(cmd123_utility), false, 'Utility helper has --type=');
assert.strictEqual(isMainProcess(cmd123_gpu), false, 'GPU process has --type=');
assert.strictEqual(isMainProcess(cmd123_renderer), false, 'Renderer process has --type=');

// In PowerShell (exact filter from scripts/gate.cjs):
function testPowershellGateFilter(pid, cmdLine) {
  const psPattern = `sk-shell-smoke-${pid}(?=[\\\\/"''\\s]|$)`;
  const psScript = `
    $cmd = '${cmdLine.replace(/'/g, "''")}';
    $isCandidate = ($cmd -match 'sk-shell-smoke') -and ($cmd -notmatch '--type=');
    $isMine = $isCandidate -and ($cmd -match '${psPattern}');
    Write-Output $isMine
  `;
  const res = spawnSync('powershell', ['-NoProfile', '-Command', psScript], {
    encoding: 'utf8',
  });
  return res.stdout.trim() === 'True';
}

if (process.platform === 'win32') {
  // Main process for pid 123 IS counted as a leak
  assert.strictEqual(testPowershellGateFilter(123, cmd123_main), true, 'PowerShell: Main browser process is counted as leak');

  // Lingering helpers for pid 123 are NOT counted as leaks
  assert.strictEqual(testPowershellGateFilter(123, cmd123_crashpad), false, 'PowerShell: crashpad helper is NOT counted as leak');
  assert.strictEqual(testPowershellGateFilter(123, cmd123_utility), false, 'PowerShell: utility helper is NOT counted as leak');
  assert.strictEqual(testPowershellGateFilter(123, cmd123_gpu), false, 'PowerShell: gpu helper is NOT counted as leak');
  assert.strictEqual(testPowershellGateFilter(123, cmd123_renderer), false, 'PowerShell: renderer helper is NOT counted as leak');

  // Main process from another run (e.g. pid 1234) is NOT counted as mine
  const cmd1234_main = '"C:\\Program Files\\Edge\\msedge.exe" --headless=new --user-data-dir="C:\\Temp\\sk-shell-smoke-1234" about:blank';
  assert.strictEqual(testPowershellGateFilter(123, cmd1234_main), false, 'PowerShell: Other run main browser is NOT counted as mine');
}

console.log('gate PID matching and helper filtering tests passed ✅');
