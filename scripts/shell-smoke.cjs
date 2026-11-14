#!/usr/bin/env node
// scripts/shell-smoke.cjs — a committed, re-runnable smoke for the JS-rendered SketchStudio shell (S7c-3).
// Loads apps/sketchstudio/index.html in headless Edge/Chrome (the no-build app needs the repo served so its
// #core/#ui importmap resolves), asserts console errors=0, and exercises the integrated shell: the shared header
// (Design|Export tabs + Style + Debug), the Design default (shared ribbon groups + canvas), the Design↔Export
// router, and the shared style panel (17 controls, open/close). Browser launch + static server + CDP come from the shared
// tests/helpers/cdp-browser.js (port 0, unique profile) — no puppeteer / npm deps. Exit 0 = pass, non-zero = fail.

const path = require('path');
const os = require('os');

const REPO_ROOT = path.resolve(__dirname, '..');
const APP_PATH = '/apps/sketchstudio/index.html';

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
  // Router: Design -> Export (TASK 602: Export is an entry of the menu) -> Design (the header's one mode button)
  document.querySelector('.sk-sidebar-btn').click(); await sl(90);
  document.querySelector('.sk-sidebar-item[data-action="export"]').click(); await sl(90);
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

async function cdpRun(cdp, url) {
  const errors = [];
  cdp.ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.method === 'Runtime.exceptionThrown') { const d = m.params.exceptionDetails; errors.push('EXC: ' + ((d.exception && d.exception.description) || d.text)); }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push('CONSOLE.ERR: ' + (m.params.args || []).map(a => a.value || a.description || '').join(' '));
  });
  await cdp.navigate(url, 8000);
  await cdp.waitForApp('svgCanvas');
  const check = await cdp.evalJs(CHECK_EXPR);
  return { errors, check };
}

(async () => {
  // the shared launcher (tests/helpers/cdp-browser.js): CDP port 0 read from the profile, never a clock-picked port that two parallel runs can share.
  // The profile dir keeps the name scripts/gate.cjs searches for to count leaked browsers: sk-shell-smoke-<pid>.
  const { launchBrowser } = await import('../tests/helpers/cdp-browser.js');
  const cdp = await launchBrowser({ tag: 'shell-smoke', width: 800, height: 600, userDir: path.join(os.tmpdir(), 'sk-shell-smoke-' + process.pid) });
  if (!cdp) { console.error('shell-smoke: no Edge/Chrome found — install one or set the path.'); process.exit(2); }

  let code = 0;
  try {
    const url = `http://127.0.0.1:${cdp.port}${APP_PATH}`;
    const { errors, check } = await cdpRun(cdp, url);

    const c = check || {};
    const checks = [
      ['console errors = 0', errors.length === 0, errors.slice(0, 5).join(' | ')],
      ['header tabs = design (Export is in the menu, TASK 602)', c.headerTabs === 'design', c.headerTabs],
      ['header Style button', c.hasStyle === true, c.hasStyle],
      ['header Debug action', c.hasDebug === true, c.hasDebug],
      ['ribbon groups = Create,Modify,Inspect,Constrain,Edit,Actions', c.ribbonGroups === 'Create,Modify,Inspect,Constrain,Edit,Actions', c.ribbonGroups],
      ['canvas visible (Design default)', c.canvasVisible === true, c.canvasVisible],
      ['Export tab shows the export view', c.exportShows === true, c.exportShows],
      ['Design hides under Export', c.designHidesOnExport === true, c.designHidesOnExport],
      ['Design tab returns', c.designBack === true, c.designBack],
      ['Style opens the shared panel', c.styleOpens === true, c.styleOpens],
      ['Style panel has 27 controls', c.styleControls === 27, c.styleControls],
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
    await cdp.close();
  }
  process.exit(code);
})();
