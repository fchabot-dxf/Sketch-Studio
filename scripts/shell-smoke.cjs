#!/usr/bin/env node
// scripts/shell-smoke.cjs — a committed, re-runnable smoke for the JS-rendered SketchStudio shell (S7c-3).
// Loads apps/sketchstudio/index.html in headless Edge/Chrome (the no-build app needs the repo served so its
// #core/#ui importmap resolves), asserts console errors=0, and exercises the integrated shell: the shared header
// (Design|Export tabs + Style + Debug), the Design default (shared ribbon groups + canvas), the Design↔Export
// router, and the shared style panel (16 controls, open/close). Self-contained: a tiny static server + the CDP
// protocol over Node's built-in WebSocket — no puppeteer / npm deps. Exit 0 = pass, non-zero = fail.

const http = require('http');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const { spawn, execSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const APP_PATH = '/apps/sketchstudio/index.html';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// The shell assertions, run in-page (async IIFE → an object of observations).
const CHECK_EXPR = `(async () => {
  const sl = ms => new Promise(r => setTimeout(r, ms));
  await sl(450);
  const out = {};
  const header = document.querySelector('#app-header-host .sk-header');
  out.headerTabs = header ? [...header.querySelectorAll('.sk-header-tab')].map(t => t.dataset.tab).join(',') : '';
  out.hasStyle = !!(header && header.querySelector('.sk-header-style'));
  out.hasDebug = !!(header && header.querySelector('.sk-header-action[data-action="btn-debug-toggle"]'));
  const ribbon = document.querySelector('#toolsRibbon .sk-ribbon');
  out.ribbonGroups = ribbon ? [...ribbon.querySelectorAll('.sk-ribbon-group-label')].map(g => g.textContent).join(',') : '';
  const canvas = document.getElementById('svgCanvas');
  out.canvasVisible = !!canvas && getComputedStyle(canvas).display !== 'none' && canvas.getBoundingClientRect().width > 0;
  // Router: Design -> Export -> Design
  header.querySelector('.sk-header-tab[data-tab="export"]').click(); await sl(90);
  out.exportShows = !document.getElementById('export-panel').classList.contains('hidden');
  out.designHidesOnExport = getComputedStyle(document.getElementById('toolsRibbon')).display === 'none';
  header.querySelector('.sk-header-tab[data-tab="design"]').click(); await sl(90);
  out.designBack = getComputedStyle(document.getElementById('toolsRibbon')).display !== 'none' && document.getElementById('export-panel').classList.contains('hidden');
  // Style panel: open + 16 controls + close
  header.querySelector('.sk-header-style').click(); await sl(90);
  const sp = document.querySelector('.sk-style-panel');
  out.styleOpens = !!sp && !sp.classList.contains('sk-hidden');
  out.styleControls = sp ? sp.querySelectorAll('.sk-style-row').length : 0;
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await sl(60);
  out.styleCloses = sp ? sp.classList.contains('sk-hidden') : false;
  return out;
})()`;

function findBrowser() {
  const candidates = [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  ];
  for (const c of candidates) { if (fs.existsSync(c)) return c; }
  for (const cmd of ['google-chrome', 'chromium', 'chromium-browser']) {
    try { const p = execSync(`command -v ${cmd}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); if (p) return p; } catch (_) {}
  }
  return null;
}

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      try {
        let url = (req.url || '/').split('?')[0];
        if (url.endsWith('/')) url += 'index.html';
        const file = path.normalize(path.join(REPO_ROOT, decodeURIComponent(url)));
        if (!file.startsWith(REPO_ROOT)) { res.writeHead(403); res.end('forbidden'); return; }
        const data = await fsp.readFile(file);
        res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
        res.end(data);
      } catch (e) { res.writeHead(404); res.end('nf ' + e.message); }
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

async function waitForJson(dbgPort) {
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch(`http://127.0.0.1:${dbgPort}/json/version`); if (r.ok) return true; } catch (_) {}
    await sleep(250);
  }
  return false;
}

async function cdpRun(dbgPort, url) {
  let page;
  for (let i = 0; i < 40; i++) {
    try { const list = await (await fetch(`http://127.0.0.1:${dbgPort}/json/list`)).json(); page = list.find(t => t.type === 'page' && t.webSocketDebuggerUrl); if (page) break; } catch (_) {}
    await sleep(250);
  }
  if (!page) throw new Error('no CDP page target');

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pending = new Map(); const evs = {}; const errors = [];
  const send = (m, p = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  const once = (m) => new Promise(res => { (evs[m] = evs[m] || []).push(res); });
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
    else if (m.method) {
      if (m.method === 'Runtime.exceptionThrown') { const d = m.params.exceptionDetails; errors.push('EXC: ' + ((d.exception && d.exception.description) || d.text)); }
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push('CONSOLE.ERR: ' + (m.params.args || []).map(a => a.value || a.description || '').join(' '));
      if (evs[m.method]) { const f = evs[m.method].shift(); if (f) f(m.params); }
    }
  });
  await new Promise(r => ws.addEventListener('open', r));
  await send('Runtime.enable'); await send('Page.enable');
  const loaded = once('Page.loadEventFired');
  await send('Page.navigate', { url });
  await Promise.race([loaded, sleep(8000)]);
  await sleep(800);
  const r = await send('Runtime.evaluate', { expression: CHECK_EXPR, returnByValue: true, awaitPromise: true });
  ws.close();
  if (r && r.exceptionDetails) throw new Error('check expr threw: ' + (r.exceptionDetails.text || ''));
  return { errors, check: r && r.result ? r.result.value : null };
}

(async () => {
  const browser = findBrowser();
  if (!browser) { console.error('shell-smoke: no Edge/Chrome found — install one or set the path.'); process.exit(2); }

  const { server, port } = await startServer();
  const dbgPort = 9300 + Math.floor((Date.now() % 600)); // avoid clashing with a parallel run
  const userDir = path.join(os.tmpdir(), 'sk-shell-smoke-' + process.pid);
  const proc = spawn(browser, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--disable-extensions',
    `--remote-debugging-port=${dbgPort}`, `--user-data-dir=${userDir}`, 'about:blank',
  ], { stdio: 'ignore' });

  let code = 0;
  try {
    if (!(await waitForJson(dbgPort))) throw new Error('headless browser did not expose the CDP port');
    const url = `http://127.0.0.1:${port}${APP_PATH}`;
    const { errors, check } = await cdpRun(dbgPort, url);

    const c = check || {};
    const checks = [
      ['console errors = 0', errors.length === 0, errors.slice(0, 5).join(' | ')],
      ['header tabs = design,export', c.headerTabs === 'design,export', c.headerTabs],
      ['header Style button', c.hasStyle === true, c.hasStyle],
      ['header Debug action', c.hasDebug === true, c.hasDebug],
      ['ribbon groups = Create,Inspect,Constrain,Edit', c.ribbonGroups === 'Create,Inspect,Constrain,Edit', c.ribbonGroups],
      ['canvas visible (Design default)', c.canvasVisible === true, c.canvasVisible],
      ['Export tab shows the export view', c.exportShows === true, c.exportShows],
      ['Design hides under Export', c.designHidesOnExport === true, c.designHidesOnExport],
      ['Design tab returns', c.designBack === true, c.designBack],
      ['Style opens the shared panel', c.styleOpens === true, c.styleOpens],
      ['Style panel has 16 controls', c.styleControls === 16, c.styleControls],
      ['Style panel closes (Esc)', c.styleCloses === true, c.styleCloses],
    ];
    let failed = 0;
    for (const [name, ok, detail] of checks) {
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  (got: ' + JSON.stringify(detail) + ')'}`);
      if (!ok) failed++;
    }
    console.log(`\nshell-smoke: ${checks.length - failed}/${checks.length} passed`);
    code = failed === 0 ? 0 : 1;
    if (failed === 0) console.log('shell-smoke PASSED ✅'); else console.log('shell-smoke FAILED ❌');
  } catch (e) {
    console.error('shell-smoke error:', e.message);
    code = 1;
  } finally {
    try { proc.kill(); } catch (_) {}
    try { server.close(); } catch (_) {}
    try { fs.rmSync(userDir, { recursive: true, force: true }); } catch (_) {}
  }
  process.exit(code);
})();
