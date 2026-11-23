// tests/helpers/cdp-teardown.js — bounded browser-tree teardown shared by cdp-browser.js (TASK 860).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const TEARDOWN_BOUNDS = Object.freeze({
  CLOSE_GRACEFUL_MS: 3000,
  TREE_WAIT_MS: 4000,
  TREE_POLL_MS: 150,
  RM_RETRIES: 4,
  RM_RETRY_DELAY_MS: 50,
  RM_FINAL_RETRIES: 4,
  RM_FINAL_DELAY_MS: 100,
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Races `promise` against a bounded timeout and always clears the timer so Node never waits on leaked timers.
export function raceWithTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(undefined), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function defaultWarn(msg) {
  console.warn(msg);
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isTaskkillAlreadyExited(res) {
  return /(?:not found|no running instance of the task)/i.test(`${res.stderr || ''}\n${res.stdout || ''}`);
}

export function listProfileHolders(userDir, timeoutMs = 3000) {
  if (!userDir) return [];
  const token = path.basename(userDir);
  if (!token) return [];
  if (process.platform === 'win32') {
    const escaped = escapeRegExp(token);
    const pattern = `${escaped}(?=[\\\\/"''\\s]|$)`;
    const psScript = `Get-CimInstance Win32_Process -Filter "name = 'msedge.exe' or name = 'chrome.exe' or name = 'chromium.exe'" | Where-Object { $_.CommandLine -match '${pattern}' } | ForEach-Object { $_.ProcessId }`;
    const r = spawnSync('powershell', ['-NoProfile', '-Command', psScript], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      timeout: Math.max(500, timeoutMs),
    });
    if (r.error || r.status !== 0) return [];
    return (r.stdout || '').split(/\r?\n/).map((s) => parseInt(s.trim(), 10)).filter((n) => Number.isInteger(n) && n > 0);
  }
  const r = spawnSync('pgrep', ['-f', token], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: Math.max(500, timeoutMs) });
  if (r.error || r.status !== 0) return [];
  return (r.stdout || '').split(/\r?\n/).map((s) => parseInt(s.trim(), 10)).filter((n) => Number.isInteger(n) && n > 0);
}

export function killProfileHolders(_userDir, pids, warn = defaultWarn) {
  if (!pids || !pids.length) return;
  if (process.platform === 'win32') {
    const args = ['/F'];
    for (const pid of pids) args.push('/PID', String(pid));
    const r = spawnSync('taskkill', args, { encoding: 'utf8', windowsHide: true, timeout: 3000 });
    if (r.error) {
      warn('cdp-browser: holder taskkill failed: ' + r.error.message);
    } else if (r.status !== 0 && !isTaskkillAlreadyExited(r)) {
      warn(`cdp-browser: holder taskkill failed (exit ${r.status}): ${(r.stderr || r.stdout || '').trim()}`);
    } else {
      return;
    }
  }
  for (const pid of pids) {
    try { process.kill(pid, 'SIGKILL'); } catch (_) { /* already exited */ }
  }
}

export function killRootTree(proc, warn = defaultWarn) {
  if (!proc || !proc.pid || proc.exitCode !== null) return;
  if (process.platform === 'win32') {
    const r = spawnSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 3000,
    });
    if (!r.error && (r.status === 0 || isTaskkillAlreadyExited(r))) return;
    if (r.error) warn('cdp-browser: taskkill failed: ' + r.error.message);
    else warn(`cdp-browser: taskkill failed (exit ${r.status}): ${(r.stderr || r.stdout || '').trim()}`);
  }
  try { proc.kill('SIGKILL'); } catch (e) { warn('cdp-browser: proc.kill failed: ' + e.message); }
}

async function defaultCloseCdp(dbgPort, proc, exitedPromise, gracefulMs, warn) {
  if (!(dbgPort > 0) || (proc && proc.exitCode !== null)) return;
  let bws = null;
  try {
    const v = await (await fetch(`http://127.0.0.1:${dbgPort}/json/version`, { signal: AbortSignal.timeout(gracefulMs) })).json();
    bws = new WebSocket(v.webSocketDebuggerUrl);
    await new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('Browser.close WebSocket open timed out')), gracefulMs);
      bws.addEventListener('open', () => { clearTimeout(t); res(); });
      bws.addEventListener('error', (e) => { clearTimeout(t); rej(e && e.error ? e.error : new Error('WebSocket error')); });
    });
    bws.send(JSON.stringify({ id: 1, method: 'Browser.close' }));
    if (exitedPromise) await raceWithTimeout(exitedPromise, gracefulMs);
  } catch (e) {
    warn('cdp-browser: Browser.close failed, falling back to the process kill: ' + (e && e.message));
  } finally {
    if (bws) { try { bws.close(); } catch (_) { /* closing */ } }
  }
}

function defaultRmProfile(userDir, opts) {
  if (!userDir || !fs.existsSync(userDir)) return;
  fs.rmSync(userDir, { recursive: true, force: true, ...opts });
}

// Closes CDP gracefully, kills & waits (bounded) when any browser process stays alive, then removes the profile dir
// with a short bounded retry window; any profile still locked past the bound is logged once and left to gate.cjs sweepProfiles.
export async function teardownBrowserSession(ctx, hooks = {}) {
  const { proc, userDir = '', dbgPort = 0, ws = null, server = null } = ctx;
  const gracefulMs = hooks.gracefulMs ?? TEARDOWN_BOUNDS.CLOSE_GRACEFUL_MS;
  const treeWaitMs = hooks.treeWaitMs ?? TEARDOWN_BOUNDS.TREE_WAIT_MS;
  const pollMs = hooks.pollMs ?? TEARDOWN_BOUNDS.TREE_POLL_MS;
  const rmRetries = hooks.rmRetries ?? TEARDOWN_BOUNDS.RM_RETRIES;
  const rmRetryDelayMs = hooks.rmRetryDelayMs ?? TEARDOWN_BOUNDS.RM_RETRY_DELAY_MS;
  const rmFinalRetries = hooks.rmFinalRetries ?? TEARDOWN_BOUNDS.RM_FINAL_RETRIES;
  const rmFinalDelayMs = hooks.rmFinalDelayMs ?? TEARDOWN_BOUNDS.RM_FINAL_DELAY_MS;
  const warn = hooks.warn || defaultWarn;
  const killTree = hooks.killTree || ((p) => killRootTree(p, warn));
  const listHolders = hooks.listHolders || ((dir, timeoutMs) => listProfileHolders(dir, timeoutMs));
  const killHolders = hooks.killHolders || ((dir, pids) => killProfileHolders(dir, pids, warn));
  const rmProfile = hooks.rmProfile || defaultRmProfile;
  const hasCustomRm = Boolean(hooks.rmProfile);

  const exitedPromise = proc
    ? new Promise((res) => { if (proc.exitCode !== null) res(); else proc.once('exit', () => res()); })
    : null;

  if (proc) {
    if (hooks.closeCdp) await hooks.closeCdp(dbgPort, gracefulMs);
    else await defaultCloseCdp(dbgPort, proc, exitedPromise, gracefulMs, warn);
  }

  if (ws) {
    try { ws.close(); } catch (e) { warn('cdp-browser: ws.close failed: ' + e.message); }
  }

  if (server) {
    try {
      if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
      server.close();
    } catch (e) {
      warn('cdp-browser: server.close failed: ' + e.message);
    }
  }

  const waitForProcessTree = async (waitMs) => {
    const deadline = Date.now() + waitMs;
    let killedHolders = false;
    for (;;) {
      const remaining = Math.max(0, deadline - Date.now());
      const rootDone = !proc || proc.exitCode !== null;
      const holders = userDir ? listHolders(userDir, Math.min(remaining || 500, 3000)) : [];
      if (rootDone && holders.length === 0) return true;
      if (Date.now() >= deadline) return false;
      if (!rootDone && proc && proc.pid) killTree(proc);
      if (holders.length > 0 && !killedHolders) {
        killHolders(userDir, holders);
        killedHolders = true;
      }
      const nextWait = Math.min(pollMs, Math.max(0, deadline - Date.now()));
      if (nextWait <= 0) return false;
      await sleep(nextWait);
    }
  };

  let treeExited = true;
  let checkedTree = false;
  if (proc && proc.pid && proc.exitCode === null) {
    killTree(proc);
    if (exitedPromise) await raceWithTimeout(exitedPromise, Math.min(500, treeWaitMs));
    treeExited = await waitForProcessTree(treeWaitMs);
    checkedTree = true;
  } else if (hooks.listHolders) {
    treeExited = await waitForProcessTree(treeWaitMs);
    checkedTree = true;
  }

  try {
    if (!userDir || (!hasCustomRm && !fs.existsSync(userDir))) return { removed: true, treeExited };
    try {
      rmProfile(userDir, { maxRetries: rmRetries, retryDelay: rmRetryDelayMs });
      return { removed: true, treeExited };
    } catch (e) {
      if (!checkedTree) {
        treeExited = await waitForProcessTree(treeWaitMs);
        checkedTree = true;
        try {
          rmProfile(userDir, { maxRetries: rmFinalRetries, retryDelay: rmFinalDelayMs });
          return { removed: true, treeExited };
        } catch (e2) {
          warn(`cdp-browser: leaving locked profile dir ${userDir} for gate sweep (${e2.message})`);
          return { removed: false, treeExited };
        }
      }
      warn(`cdp-browser: leaving locked profile dir ${userDir} for gate sweep (${e.message})`);
      return { removed: false, treeExited };
    }
  } finally {
    if (proc && proc.exitCode === null && typeof proc.unref === 'function') proc.unref();
  }
}

export function teardownBrowserSessionSync(ctx, warn = defaultWarn) {
  const { proc, userDir = '', ws = null, server = null } = ctx;
  if (ws) { try { ws.close(); } catch (e) { warn('cdp-browser: ws.close on exit failed: ' + e.message); } }
  if (server) {
    try {
      if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
      server.close();
    } catch (e) {
      warn('cdp-browser: server.close on exit failed: ' + e.message);
    }
  }
  killRootTree(proc, warn);
  if (!userDir || !fs.existsSync(userDir)) return true;
  try {
    fs.rmSync(userDir, { recursive: true, force: true, maxRetries: TEARDOWN_BOUNDS.RM_RETRIES, retryDelay: TEARDOWN_BOUNDS.RM_RETRY_DELAY_MS });
    return true;
  } catch (_) {
    const holders = listProfileHolders(userDir, 2000);
    if (holders.length > 0) killProfileHolders(userDir, holders, warn);
    try {
      fs.rmSync(userDir, { recursive: true, force: true, maxRetries: TEARDOWN_BOUNDS.RM_FINAL_RETRIES, retryDelay: TEARDOWN_BOUNDS.RM_FINAL_DELAY_MS });
      return true;
    } catch (e2) {
      warn(`cdp-browser: leaving locked profile dir ${userDir} for gate sweep (${e2.message})`);
      return false;
    }
  }
}
