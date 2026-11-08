// tests/helpers/cdp-browser.js — the ONE headless-browser harness for the live tests (TASK 477).
// Unique profile dir + --remote-debugging-port=0 (port read from DevToolsActivePort), so parallel runs can never collide;
// `waitFor` polls a condition and reports the last error; `close` does CDP Browser.close + a process-tree kill + removes the profile.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
};

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function findBrowser() {
  const candidates = [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  for (const cmd of ['google-chrome', 'chromium', 'chromium-browser']) {
    try { const p = execSync(`command -v ${cmd}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); if (p) return p; } catch (_) { /* not installed: try the next */ }
  }
  return null;
}

// fixtures: { '/path.html': '<html string>' } served as text/html instead of a repo file.
export function startServer(root = REPO_ROOT, fixtures = {}) {
  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      try {
        let url = (req.url || '/').split('?')[0];
        if (Object.hasOwn(fixtures, url)) { res.writeHead(200, { 'content-type': 'text/html' }); res.end(fixtures[url]); return; }
        if (url.endsWith('/')) url += 'index.html';
        const file = path.normalize(path.join(root, decodeURIComponent(url)));
        if (!file.startsWith(root)) { res.writeHead(403); res.end('forbidden'); return; }
        const data = await fsp.readFile(file);
        res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
        res.end(data);
      } catch (e) { res.writeHead(404); res.end('nf ' + e.message); }
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

// Polls fn until it returns a truthy value; keeps the last error and reports it on timeout.
async function pollUntil(fn, what, timeoutMs, stepMs) {
  const end = Date.now() + timeoutMs;
  let lastErr = null;
  for (;;) {
    let v;
    try { v = await fn(); } catch (e) { v = false; lastErr = e; }
    if (v) return v;
    if (Date.now() > end) throw new Error('timed out waiting for ' + what + (lastErr ? ' (last error: ' + lastErr.message + ')' : ''));
    await sleep(stepMs);
  }
}

export async function sendRealKey(send, key, code, vk, modifiers = 0, text = '') {
  const down = { type: text ? 'keyDown' : 'rawKeyDown', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers };
  if (text) down.text = text;
  await send('Input.dispatchKeyEvent', down);
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers });
}

// Returns null when no Edge/Chrome is installed (the caller prints its "skipped" line).
// opts: tag (profile dir prefix), width/height (viewport), args (extra browser flags), server (false = don't start the static server), fixtures (extra served HTML pages, see startServer).
export async function launchBrowser(opts = {}) {
  const { tag = 'cdp', width = 1600, height = 900, args = [], server: withServer = true, fixtures = {} } = opts;
  const browser = findBrowser();
  if (!browser) return null;
  const srv = withServer ? await startServer(REPO_ROOT, fixtures) : { server: null, port: 0 };
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), `sk-test-${tag}-`));
  const proc = spawn(browser, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--disable-extensions',
    '--remote-debugging-port=0', `--user-data-dir=${userDir}`, ...args, 'about:blank',
  ], { stdio: 'ignore' });

  let dbgPort = 0;
  let ws = null;
  const close = async () => {
    const exited = new Promise((res) => { if (proc.exitCode !== null) res(); else proc.once('exit', () => res()); });
    if (dbgPort) {
      try {
        const v = await (await fetch(`http://127.0.0.1:${dbgPort}/json/version`)).json();
        const bws = new WebSocket(v.webSocketDebuggerUrl);
        await new Promise((res, rej) => { bws.addEventListener('open', res); bws.addEventListener('error', rej); setTimeout(rej, 2000); });
        bws.send(JSON.stringify({ id: 1, method: 'Browser.close' }));
        await Promise.race([exited, sleep(3000)]);
        bws.close();
      } catch (e) { console.warn('cdp-browser: Browser.close failed, falling back to the process kill: ' + (e && e.message)); }
    }
    if (ws) ws.close();
    if (proc.pid && proc.exitCode === null) {
      if (process.platform === 'win32') {
        try { execSync(`taskkill /PID ${proc.pid} /T /F`, { stdio: 'ignore' }); } catch (e) { console.warn('cdp-browser: taskkill failed: ' + e.message); }
      } else proc.kill();
    }
    await Promise.race([exited, sleep(3000)]);
    if (srv.server) srv.server.close();
    fs.rmSync(userDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  };

  try {
    dbgPort = await pollUntil(() => {
      const n = parseInt(fs.readFileSync(path.join(userDir, 'DevToolsActivePort'), 'utf8').split(/\r?\n/)[0], 10);
      return n || false;
    }, 'DevToolsActivePort in the profile dir', 30000, 100);
    await pollUntil(async () => (await fetch(`http://127.0.0.1:${dbgPort}/json/version`)).ok, 'the CDP endpoint', 30000, 100);
    const page = await pollUntil(async () => {
      const list = await (await fetch(`http://127.0.0.1:${dbgPort}/json/list`)).json();
      return list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    }, 'a CDP page target', 30000, 100);
    ws = new WebSocket(page.webSocketDebuggerUrl);
    let id = 0;
    const pending = new Map();
    const evs = {};
    const send = (m, p = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
    const once = (m) => new Promise((res) => { (evs[m] = evs[m] || []).push(res); });
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
      else if (m.method && evs[m.method]) { const f = evs[m.method].shift(); if (f) f(m.params); }
    });
    await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
    await send('Runtime.enable');
    await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    const evalJs = async (expression) => {
      const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (r && r.exceptionDetails) throw new Error('CDP eval threw: ' + JSON.stringify(r.exceptionDetails));
      return r && r.result ? r.result.value : undefined;
    };
    const waitFor = (expression, what, timeoutMs = 20000) => pollUntil(() => evalJs(expression), what, timeoutMs, 50);
    // Navigates and waits for the load event (or timeoutMs, then carries on: callers waitFor their own app state).
    const navigate = async (url, timeoutMs = 20000) => {
      const loaded = once('Page.loadEventFired');
      await send('Page.navigate', { url });
      await Promise.race([loaded, sleep(timeoutMs)]);
    };
    return { port: srv.port, server: srv.server, userDir, send, once, evalJs, waitFor, navigate, close };
  } catch (e) {
    await close();
    throw e;
  }
}
