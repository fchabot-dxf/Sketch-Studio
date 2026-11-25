// gate: exclusive
// tests/cdp-teardown-860.test.js — TASK 860: teardown order, bounded tree wait, locked-folder handoff, and zero timer leaks.
import assert from 'node:assert';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { teardownBrowserSession, TEARDOWN_BOUNDS } from './helpers/cdp-teardown.js';

// 1. Order: closeCdp -> wait for whole tree (including late children) -> rmProfile (never rmProfile while holders alive)
{
  const log = [];
  const fakeProc = { pid: 42001, exitCode: 0, once() {} };
  let polls = 0;
  const res = await teardownBrowserSession(
    { proc: fakeProc, userDir: 'C:\\Temp\\sk-test-fake-order', dbgPort: 9222, ws: null, server: null },
    {
      gracefulMs: 500,
      treeWaitMs: 1000,
      pollMs: 15,
      rmRetries: 1,
      rmRetryDelayMs: 5,
      closeCdp: async () => { log.push('closeCdp'); },
      killTree: () => { log.push('killTree'); },
      listHolders: () => {
        polls += 1;
        log.push(`listHolders:${polls}`);
        return polls < 3 ? [99001] : [];
      },
      killHolders: (_dir, pids) => { log.push(`killHolders:${pids.join(',')}`); },
      rmProfile: () => {
        assert.ok(polls >= 3, 'rmProfile must wait until listHolders reports empty');
        log.push('rmProfile');
      },
      warn: (msg) => { log.push(`warn:${msg}`); },
    },
  );
  assert.strictEqual(res.treeExited, true);
  assert.strictEqual(res.removed, true);
  assert.strictEqual(log[0], 'closeCdp');
  assert.ok(log.includes('killHolders:99001'), 'remaining child holder is killed');
  assert.strictEqual(log[log.length - 1], 'rmProfile', 'rmProfile runs only after tree exits');
  assert.ok(!log.some((e) => e.startsWith('warn:')), 'clean teardown emits no warning');
}

// 2. Bounded wait: hung process tree returns within treeWaitMs + rm bound, unrefs stuck handle, and never throws
{
  const t0 = Date.now();
  const warnings = [];
  let unreffed = false;
  const fakeProc = { pid: 42002, exitCode: null, once() {}, unref() { unreffed = true; } };
  let rootKilled = false;
  const res = await teardownBrowserSession(
    { proc: fakeProc, userDir: 'C:\\Temp\\sk-test-fake-hung', dbgPort: 0, ws: null, server: null },
    {
      gracefulMs: 100,
      treeWaitMs: 120,
      pollMs: 20,
      rmRetries: 1,
      rmRetryDelayMs: 5,
      killTree: () => { rootKilled = true; },
      listHolders: () => [99002],
      killHolders: () => {},
      rmProfile: () => {
        const err = new Error('EPERM: locked by hung child');
        err.code = 'EPERM';
        throw err;
      },
      warn: (msg) => warnings.push(msg),
    },
  );
  const elapsed = Date.now() - t0;
  assert.strictEqual(rootKilled, true);
  assert.strictEqual(unreffed, true, 'must unref stuck ChildProcess handle after bound so Node exits');
  assert.strictEqual(res.treeExited, false);
  assert.strictEqual(res.removed, false);
  assert.ok(elapsed >= 100 && elapsed < 1000, `hung teardown must stay bounded near treeWaitMs, got ${elapsed}ms`);
  assert.strictEqual(warnings.length, 1, 'logs one warning when folder stays locked past bound');
  assert.match(warnings[0], /leaving locked profile dir .*sk-test-fake-hung for gate sweep/);
}

// 3. Locked profile dir after tree exits: bounded retries (never 65 s backoff), logs leftover once
{
  const t0 = Date.now();
  const warnings = [];
  let rmCalls = 0;
  const fakeProc = { pid: 42003, exitCode: 0, once() {} };
  const res = await teardownBrowserSession(
    { proc: fakeProc, userDir: 'C:\\Temp\\sk-test-fake-locked', dbgPort: 0, ws: null, server: null },
    {
      treeWaitMs: 200,
      pollMs: 10,
      rmRetries: 2,
      rmRetryDelayMs: 5,
      rmFinalRetries: 2,
      rmFinalDelayMs: 5,
      listHolders: () => [],
      killHolders: () => {},
      rmProfile: () => {
        rmCalls += 1;
        const err = new Error('EPERM: antivirus scan');
        err.code = 'EPERM';
        throw err;
      },
      warn: (msg) => warnings.push(msg),
    },
  );
  const elapsed = Date.now() - t0;
  assert.strictEqual(res.treeExited, true);
  assert.strictEqual(res.removed, false);
  assert.ok(rmCalls >= 1 && rmCalls <= 2, `bounded rmSync attempts (1..2), got ${rmCalls}`);
  assert.ok(elapsed < 3000, `locked folder retry must stay bounded, got ${elapsed}ms`);
  assert.strictEqual(warnings.length, 1);
  assert.match(warnings[0], /leaving locked profile dir .*sk-test-fake-locked for gate sweep/);
}

// 4. Real event loop exits immediately after teardown (no leaked 10s/20s timers)
{
  const helperUrl = new URL('./helpers/cdp-teardown.js', import.meta.url).href;
  const script = `
    import { teardownBrowserSession } from ${JSON.stringify(helperUrl)};
    const fakeProc = { pid: 1, exitCode: 0, once() {} };
    await teardownBrowserSession(
      { proc: fakeProc, userDir: '', dbgPort: 9222, ws: null, server: null },
      { gracefulMs: 20000, treeWaitMs: 20000, closeCdp: async () => {}, listHolders: () => [] },
    );
  `;
  const t0 = Date.now();
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', timeout: 5000 });
  const elapsed = Date.now() - t0;
  assert.strictEqual(child.status, 0, child.stderr);
  assert.ok(elapsed < 2000, `node must exit promptly without dangling timers (took ${elapsed}ms)`);
}

// 5. Declared bounds stay well below gate's 90s test limit (and <= 10 s total teardown budget)
const rmBackoff = (r, d) => ((r * (r + 1)) / 2) * d;
const worstCaseMs =
  TEARDOWN_BOUNDS.CLOSE_GRACEFUL_MS +
  TEARDOWN_BOUNDS.TREE_WAIT_MS +
  rmBackoff(TEARDOWN_BOUNDS.RM_RETRIES, TEARDOWN_BOUNDS.RM_RETRY_DELAY_MS) +
  rmBackoff(TEARDOWN_BOUNDS.RM_FINAL_RETRIES, TEARDOWN_BOUNDS.RM_FINAL_DELAY_MS);
assert.ok(
  worstCaseMs <= 10000,
  `declared worst-case teardown bound must stay <= 10s (got ${worstCaseMs}ms)`,
);

console.log('cdp-teardown-860: ok');
