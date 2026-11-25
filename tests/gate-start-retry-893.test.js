// tests/gate-start-retry-893.test.js — TASK 893: the gate survives a helper process that did not start, and a cleanup error never hides the real one.
//   * scripts/gate.cjs spawnSyncRetryOnce / spawnRetryOnce (the lock's Git Bash, the browser-count PowerShell): a REAL child that exits 0xC0000142
//     (STATUS_DLL_INIT_FAILED, what a Git Bash that cannot start under load exits) once and then 0 is started exactly twice and its result is the 0;
//     one that exits 0xC0000142 twice is started twice and the 0xC0000142 is returned (no third start); any other exit is never retried; a
//     spawnSync timeout (the PowerShell's 15 s) is retried once the same way; the async form retries the pid-collision exit only when told to.
//   * cleanupAfter: a cleanup that throws after a real failure is printed and the real error is the one that goes on; with no earlier error the
//     cleanup's error is thrown. The gate's main() shape (try / catch / finally releasing the lock) rejects with the real error.
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { spawnSyncRetryOnce, spawnRetryOnce, cleanupAfter, DLL_INIT_FAILED } = require('../scripts/gate.cjs');

assert.strictEqual(DLL_INIT_FAILED, 3221225794, '0xC0000142 as Node reports a child exit status');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-retry-893-'));
// the child: counts its starts in a file, then does plan[start - 1] (the last entry repeats): an exit code, or 'hang' (sleeps 60 s)
const CHILD = path.join(tmp, 'child.cjs');
fs.writeFileSync(CHILD, `const fs = require('fs');
const [counter, ...plan] = process.argv.slice(2);
const n = (fs.existsSync(counter) ? Number(fs.readFileSync(counter, 'utf8')) : 0) + 1;
fs.writeFileSync(counter, String(n));
const step = plan[Math.min(n, plan.length) - 1];
if (step === 'hang') setTimeout(() => {}, 60000); else process.exit(Number(step));
`);
const STATUS_DLL_INIT_FAILED_SIGNED = -1073741502; // the same 32-bit code, as process.exit takes it
let seq = 0;
const child = (...plan) => { const counter = path.join(tmp, `count-${++seq}.txt`); return { counter, args: [CHILD, counter, ...plan.map(String)], starts: () => Number(fs.readFileSync(counter, 'utf8')) }; };

// capture the gate's console lines
const logged = [];
const realLog = console.log, realErr = console.error;
console.log = (...a) => { logged.push(a.join(' ')); };
console.error = (...a) => { logged.push(a.join(' ')); };
const restore = () => { console.log = realLog; console.error = realErr; };

try {
  // 1. sync: 0xC0000142 once, then 0 -> started twice, the result is the 0, one retry line
  let c = child(STATUS_DLL_INIT_FAILED_SIGNED, 0);
  let r = spawnSyncRetryOnce(process.execPath, c.args, { stdio: 'ignore', windowsHide: true });
  assert.strictEqual(r.status, 0, '1: the second start exited 0');
  assert.strictEqual(c.starts(), 2, '1: started exactly twice');
  assert.strictEqual(logged.filter((l) => /exited 0xC0000142 \(it could not start\); starting it once more/.test(l)).length, 1, `1: one retry line: ${JSON.stringify(logged)}`);

  // 2. sync: 0xC0000142 twice -> started twice (never a third time), the failure is returned as it was
  c = child(STATUS_DLL_INIT_FAILED_SIGNED);
  r = spawnSyncRetryOnce(process.execPath, c.args, { stdio: 'ignore', windowsHide: true });
  assert.strictEqual(r.status, DLL_INIT_FAILED, '2: a second 0xC0000142 is reported');
  assert.strictEqual(c.starts(), 2, '2: retried ONCE only');

  // 3. sync: a real failure (exit 1, exit 3) is never retried
  for (const code of [1, 3]) {
    c = child(code, 0);
    r = spawnSyncRetryOnce(process.execPath, c.args, { stdio: 'ignore', windowsHide: true });
    assert.strictEqual(r.status, code, `3: exit ${code} is reported`);
    assert.strictEqual(c.starts(), 1, `3: exit ${code} is not retried`);
  }

  // 4. sync: a timeout (the PowerShell's 15 s case; here 8 s, the first start hangs) -> started once more, same limit; the second result returned
  c = child('hang', 0);
  logged.length = 0;
  r = spawnSyncRetryOnce(process.execPath, c.args, { stdio: 'ignore', windowsHide: true, timeout: 8000 });
  assert.strictEqual(r.error, undefined, '4: the second start did not time out');
  assert.strictEqual(r.status, 0, '4: the second start exited 0');
  assert.strictEqual(c.starts(), 2, '4: a timed-out start is retried once');
  assert.ok(logged.some((l) => /timed out; starting it once more/.test(l)), `4: the retry line says it timed out: ${JSON.stringify(logged)}`);

  // 5. async (the lock's take): 0xC0000142 once then 0 -> { status: 0 } after two starts; with the take's own reason a collision exit is retried
  c = child(STATUS_DLL_INIT_FAILED_SIGNED, 0);
  let a = await spawnRetryOnce(process.execPath, c.args, { stdio: 'ignore', windowsHide: true });
  assert.deepStrictEqual([a.status, c.starts()], [0, 2], '5: async 0xC0000142 once -> retried, then 0');
  c = child(3, 0);
  a = await spawnRetryOnce(process.execPath, c.args, { stdio: 'ignore', windowsHide: true });
  assert.deepStrictEqual([a.status, c.starts()], [3, 1], '5: async exit 3 with the default reason is not retried');
  c = child(3, 0);
  a = await spawnRetryOnce(process.execPath, c.args, { stdio: 'ignore', windowsHide: true }, (x) => (x.status === 3 ? 'found its pid is also an MSYS pid' : null));
  assert.deepStrictEqual([a.status, c.starts()], [0, 2], '5: async collision exit with the take reason -> retried once, then 0');
  c = child(3);
  a = await spawnRetryOnce(process.execPath, c.args, { stdio: 'ignore', windowsHide: true }, (x) => (x.status === 3 ? 'found its pid is also an MSYS pid' : null));
  assert.deepStrictEqual([a.status, c.starts()], [3, 2], '5: a second collision is reported, no third start');

  // 6. cleanupAfter: after a real failure a throwing cleanup is printed, not thrown; with no earlier error it throws
  logged.length = 0;
  const real = new Error('EPERM: operation not permitted, open timings.json');
  const releaseFails = () => { throw new Error('gate: cpu_lock_release exited 3221225794'); };
  cleanupAfter(real, releaseFails);
  assert.ok(logged.some((l) => /the cleanup failed too .*cpu_lock_release exited 3221225794/s.test(l)), `6: the cleanup error is printed: ${JSON.stringify(logged)}`);
  assert.throws(() => cleanupAfter(null, releaseFails), /cpu_lock_release exited 3221225794/, '6: with no earlier error the cleanup error is thrown');
  let cleaned = 0;
  cleanupAfter(real, () => { cleaned++; });
  assert.strictEqual(cleaned, 1, '6: the cleanup runs');
  // the gate's main() shape: the real error is the rejection, the cleanup's error printed beside it
  logged.length = 0;
  const mainShape = async () => {
    let runError = null;
    try { await Promise.resolve(); throw real; } catch (e) { runError = e; throw e; } finally { cleanupAfter(runError, releaseFails); }
  };
  await assert.rejects(mainShape(), (e) => e === real, '6: main() rejects with the REAL error, not the release error');
  assert.ok(logged.some((l) => /cpu_lock_release exited 3221225794/.test(l)), '6: and the release error is reported too');
} finally {
  restore();
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log('gate-start-retry-893: ok (sync retry once on 0xC0000142 / timeout, async on 0xC0000142 / collision, never a real exit; cleanup never hides the real error)');
