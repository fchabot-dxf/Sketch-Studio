// tests/gate-pid-match.test.js — unit-level check for gate.cjs leftover-browser PID token matching (TASK 423b).
// Proves that given command lines for pids 123 and 1234, pid 123 matches ONLY its own profile directory
// and does NOT match 1234.

import assert from 'assert';
import { spawnSync } from 'child_process';

console.log('Testing gate PID matching...');

// 1. JS-level regex assertion
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

console.log('gate PID matching tests passed ✅');
