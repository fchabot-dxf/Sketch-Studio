// tests/cdp-launch-cleanup-live.test.js — TASK 671: launchBrowser cleans up its profile dir and browser process
// on launch failures and uncaught throws before close(), without leaking per-call process listeners.
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { findBrowser, launchBrowser } from './helpers/cdp-browser.js';

const tmpDir = os.tmpdir();
const dirsWithPrefix = (prefix) => fs.readdirSync(tmpDir).filter((n) => n.startsWith(prefix));
const countEdgeWithTag = (tag) => {
  if (process.platform !== 'win32') return 0;
  const ps = `(Get-CimInstance Win32_Process -Filter "name = 'msedge.exe' or name = 'chrome.exe'" | Where-Object { $_.CommandLine -match '${tag}' } | Measure-Object).Count`;
  const r = spawnSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8', windowsHide: true });
  return parseInt(r.stdout.trim(), 10) || 0;
};

// 1. Spawn error (missing binary): failed launch leaves no dir
{
  const tag = `671bad-${process.pid}`;
  let failed = false;
  try {
    await launchBrowser({ tag, server: false, browserPath: path.join(tmpDir, 'nonexistent-browser-671.exe') });
  } catch (e) {
    failed = true;
  }
  assert.strictEqual(failed, true, 'bad browserPath must reject');
  assert.deepStrictEqual(dirsWithPrefix(`sk-test-${tag}-`), [], 'failed spawn must leave no profile dir');
}

const browser = findBrowser();
if (!browser) {
  console.log('cdp-launch-cleanup-live: bad-binary ok (remaining checks skipped: no Edge/Chrome installed)');
  process.exit(0);
}

// 2. Real browser failing to expose DevToolsActivePort (launch timeout): leaves no dir and no browser process
{
  const tag = `671tmo-${process.pid}`;
  let err = null;
  try {
    await launchBrowser({ tag, server: false, args: ['--remote-debugging-pipe'], launchTimeoutMs: 600 });
  } catch (e) {
    err = e;
  }
  assert.ok(err && /DevToolsActivePort/.test(err.message), 'expected DevToolsActivePort launch failure, got: ' + (err && err.message));
  assert.deepStrictEqual(dirsWithPrefix(`sk-test-${tag}-`), [], 'timed-out launch must remove its profile dir');
  assert.strictEqual(countEdgeWithTag(`sk-test-${tag}-`), 0, 'timed-out launch must leave no browser process');
}

// 3. Uncaught throw (both top-level throw and timer throw) after launchBrowser() without close(): helper closes browser and removes dir
for (const [kind, tailCode] of [
  ['timer', `setTimeout(() => { throw new Error('boom before close'); }, 20);`],
  ['top', `throw new Error('top-level boom before close');`],
]) {
  const tag = `671${kind}-${process.pid}`;
  const helperUrl = new URL('./helpers/cdp-browser.js', import.meta.url).href;
  const script = `import { launchBrowser } from ${JSON.stringify(helperUrl)};\nconst cdp = await launchBrowser({ tag: ${JSON.stringify(tag)}, server: false });\nif (!cdp) process.exit(0);\n${tailCode}`;
  const res = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', timeout: 25000 });
  assert.notStrictEqual(res.status, 0, `${kind} throw child must exit non-zero`);
  assert.deepStrictEqual(dirsWithPrefix(`sk-test-${tag}-`), [], `${kind} throw before close must leave no profile dir`);
  assert.strictEqual(countEdgeWithTag(`sk-test-${tag}-`), 0, `${kind} throw before close must leave no browser process`);
}

// 4. Launching multiple times installs ONE set of process handlers (listener count stays flat)
{
  const c1 = await launchBrowser({ tag: `671l1-${process.pid}`, server: false });
  const exitCount1 = process.listenerCount('exit');
  const errCount1 = process.listenerCount('uncaughtException');
  try {
    const c2 = await launchBrowser({ tag: `671l2-${process.pid}`, server: false });
    try {
      assert.strictEqual(process.listenerCount('exit'), exitCount1, 'exit handler count must not grow per launchBrowser call');
      assert.strictEqual(process.listenerCount('uncaughtException'), errCount1, 'uncaughtException handler count must not grow per launchBrowser call');
    } finally {
      await c2.close();
    }
  } finally {
    await c1.close();
  }
  assert.deepStrictEqual(dirsWithPrefix(`sk-test-671l1-${process.pid}-`), []);
  assert.deepStrictEqual(dirsWithPrefix(`sk-test-671l2-${process.pid}-`), []);
}

console.log('cdp-launch-cleanup-live: ok');
