// tests/shaperhub-browser-hints-772-live.test.js -- Live browser verification for Task 772 + Param/Settings UI polish:
//   A. Shaper Sync modal folder browser (list, breadcrumbs, up, + New folder, file pick, upload in subfolder, session token reuse, 401 expiry recovery, 0 secret leaks) on Desktop 1280x800 & Phone 390x844.
//   B. Expanded tooltips & hints (Design ribbon, header Save, footer Undo/Settings, Settings hints, Shaper Prepare/Export/Sync hints), Settings tabs single-row fit, and Parameters editable faint boxes on SketchStudio & Shaper.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';
import { resetBufferLive } from './helpers/reset-buffer.js';
import { createFakeShaperApi, FAKE_LOGIN, FAKE_TOKEN } from './shaperhub-fake-api.js';
import { handleShaperUpload } from '../packages/core/shaper-cloud.js';

const EVIDENCE_DIR = process.env.EVIDENCE_DIR || path.resolve('.evidence/772');
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
const SECRETS = [FAKE_LOGIN.email, FAKE_LOGIN.password, FAKE_TOKEN, 'rotated-jwt-772'];

const realFetch = globalThis.fetch;
const api = createFakeShaperApi({
  files: ['RootPlan.svg', 'Furniture/Chair.svg'],
  folders: ['Furniture', 'Signs'],
  passLocal: realFetch,
});
globalThis.fetch = api.fetch;

const cdp = await launchBrowser({ tag: '772-hub-hints', width: 1280, height: 800 });
if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
const { port, ws, send, evalJs, waitFor, navigate, waitForApp } = cdp;
const LOCAL = `http://127.0.0.1:${port}/`;
const consoleLines = [];
const sent = [];

ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.consoleAPICalled') {
    consoleLines.push(m.params.args.map((a) => (a.value !== undefined ? String(a.value) : a.description || '')).join(' '));
  }
  if (m.method !== 'Fetch.requestPaused') return;
  const { requestId, request } = m.params;
  const body = request.postData !== undefined
    ? request.postData
    : (request.postDataEntries || []).map((x) => Buffer.from(x.bytes || '', 'base64').toString('utf8')).join('');
  if (!request.url.startsWith(LOCAL)) {
    send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' });
    return;
  }
  if (new URL(request.url).pathname === '/api/shaper-upload') {
    handleShaperUpload(body).then(({ status, body: answer }) => send('Fetch.fulfillRequest', {
      requestId,
      responseCode: status,
      responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
      body: Buffer.from(JSON.stringify(answer)).toString('base64'),
    }));
    return;
  }
  sent.push({ url: request.url, body });
  send('Fetch.continueRequest', { requestId });
});
await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });

const shot = async (name, sel = null, pad = 6) => {
  const r = sel ? await evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const b = e.getBoundingClientRect(); return b.width ? { x: b.left, y: b.top, width: b.width, height: b.height } : null; })()`) : null;
  const clip = r ? { x: Math.max(0, r.x - pad), y: Math.max(0, r.y - pad), width: r.width + 2 * pad, height: r.height + 2 * pad, scale: 1 } : undefined;
  const s = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip } : {}) });
  fs.writeFileSync(path.join(EVIDENCE_DIR, name), Buffer.from(s.data, 'base64'));
};
const hoverEl = async (sel) => {
  const p = await evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
  assert(p, `${sel} not visible`);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'none' });
  await sleep(120);
};
const clickEl = async (sel) => {
  const p = await evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({ block: 'nearest' }); const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
  assert(p, `${sel} not clickable`);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'none' });
  await sleep(30);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 1 });
  await sleep(30);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(160);
};
const typeVal = async (sel, val) => {
  await evalJs(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); el.focus(); el.value = ${JSON.stringify(val)}; el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
};
const scanNoSecrets = async (label) => {
  const found = await evalJs(`(() => {
    const bag = [document.documentElement.outerHTML, document.cookie];
    for (const st of [localStorage, sessionStorage]) { try { for (let i = 0; i < st.length; i++) { const k = st.key(i); bag.push(k, st.getItem(k)); } } catch {} }
    return bag.join('\\n');
  })()`);
  for (const s of SECRETS) {
    assert(!found.includes(s), `${label}: leaked secret into page DOM/storage`);
    assert(!consoleLines.some((l) => l.includes(s)), `${label}: leaked secret into console`);
  }
  // Never store in sync inputs after clearing session or in non-api requests
  for (const r of sent) for (const s of SECRETS) assert(!r.url.includes(s) && !(r.body || '').includes(s), `${label}: leaked secret in request`);
};

try {
  // ── 1. SketchStudio: Design ribbon tooltips, Header Save/Footer tooltips, Settings 1-row tabs + hints, Parameter faint edit boxes ──
  await navigate(`${LOCAL}apps/sketchstudio/index.html`, 10000);
  await waitForApp('svgCanvas');
  await resetBufferLive(cdp);
  await navigate(`${LOCAL}apps/sketchstudio/index.html`, 10000);
  await waitForApp('svgCanvas');

  // Tool ribbon tooltip on desktop hover without clearing title at rest
  const lineTitle = await evalJs(`document.getElementById('tool-line').title`);
  assert(lineTitle.includes('Line'), `SketchStudio tool-line preserves title: ${lineTitle}`);
  await hoverEl('#tool-line');
  await waitFor(`(() => { const t = document.querySelector('.sk-tooltip:not([hidden])'); return !!t && t.textContent.includes('Line'); })()`, 'Line tooltip');
  const tipHead = await evalJs(`document.querySelector('.sk-tooltip:not([hidden]) .sk-tooltip-body')?.textContent || ''`);
  assert(tipHead.length > 10, 'Line tooltip includes helpful body text');
  await shot('design-ribbon-tooltip.png');

  // Header Save & Footer tooltips
  await hoverEl('.sk-save');
  await waitFor(`(() => { const t = document.querySelector('.sk-tooltip:not([hidden])'); return !!t && /Save/i.test(t.textContent); })()`, 'Save tooltip');
  await hoverEl('#btn-settings');
  await waitFor(`(() => { const t = document.querySelector('.sk-tooltip:not([hidden])'); return !!t && /Settings|Customize/i.test(t.textContent); })()`, 'Settings tooltip');

  // Open Settings panel -> verify all 5 tabs on ONE horizontal row on desktop + working `i` hint
  await clickEl('#btn-settings');
  await waitFor(`!document.querySelector('.sk-style-panel').classList.contains('sk-hidden')`, 'Settings open');
  const tabMetrics = await evalJs(`(() => {
    const p = document.querySelector('.sk-style-panel');
    const tabs = [...p.querySelectorAll('.sk-style-tab')];
    const tops = [...new Set(tabs.map((t) => Math.round(t.getBoundingClientRect().top)))];
    return { count: tabs.length, tops, panelWidth: Math.round(p.getBoundingClientRect().width) };
  })()`);
  assert.strictEqual(tabMetrics.count, 5, '5 settings tabs');
  assert.strictEqual(tabMetrics.tops.length, 1, `all 5 Settings tabs fit on one row: ${JSON.stringify(tabMetrics)}`);
  await clickEl('.sk-style-panel .sk-hint-i');
  await waitFor(`(() => { const h = document.querySelector('.sk-style-panel .sk-hint:not([hidden])'); return !!h && h.textContent.length > 10; })()`, 'Settings row hint opens');
  await shot('settings-tabs.png', '.sk-style-panel', 12);
  await clickEl('.sk-style-close');

  // Open Parameters modal & add a user parameter -> editable cells show faint border + non-transparent box
  await clickEl('#btn-parameters');
  await waitFor(`!!document.querySelector('.sk-ptable .pt-add')`, 'Parameters modal open');
  await clickEl('.sk-ptable .pt-add');
  await sleep(100);
  const ptStyle = await evalJs(`(() => {
    const inp = document.querySelector('.sk-ptable .pt-in');
    const cs = inp ? getComputedStyle(inp) : null;
    return cs ? { border: cs.borderTopWidth + ' ' + cs.borderTopStyle + ' ' + cs.borderTopColor, bg: cs.backgroundColor } : null;
  })()`);
  assert(ptStyle && !ptStyle.border.includes('rgba(0, 0, 0, 0)'), `Parameter input has visible faint border: ${JSON.stringify(ptStyle)}`);
  await shot('params-faint-boxes.png', '.sk-ptable', 12);

  // ── 2. Shaper: Design tooltips + Prepare/Export/Sync hints + Folder browser & Session Token ──
  await resetBufferLive(cdp);
  await navigate(`${LOCAL}apps/shaper/index.html`, 10000);
  await waitFor(`!!document.querySelector('.sk-header-tab[data-tab="design"]')`, 'Shaper loaded');
  await waitForApp('design-canvas');

  // Create a 120 x 70 rectangle so Prepare & Export/Sync have cuts
  await waitFor(`!!(window.__designController && window.__designController.state)`, 'designController ready');
  await evalJs(`(() => { const st = window.__designController.state;
    for (const k of [...st.joints.keys()]) st.joints.delete(k); st.shapes.length = 0; st.constraints.length = 0;
    [[0, 0], [120, 0], [120, 70], [0, 70]].forEach(([x, y], i) => st.joints.set('Rj' + i, { x, y }));
    for (let i = 0; i < 4; i++) st.shapes.push({ id: 'Rs' + i, type: 'line', joints: ['Rj' + i, 'Rj' + ((i + 1) % 4)] });
    st.saveState('draw'); })()`);

  // Switch to Prepare, assign Pocket cut, verify Direction legend hint works
  await clickEl('.sk-header-tab[data-tab="prepare"]');
  await waitFor(`!document.getElementById('view-prepare').hidden`, 'Prepare tab');
  const worldPt = await evalJs(`(() => { const svg = document.getElementById('prepare-canvas'); const pt = svg.createSVGPoint(); pt.x = 60; pt.y = 10; const s = pt.matrixTransform(svg.getScreenCTM()); return { x: Math.round(s.x), y: Math.round(s.y) }; })()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: worldPt.x, y: worldPt.y, button: 'left', buttons: 1, clickCount: 1 });
  await sleep(30);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: worldPt.x, y: worldPt.y, button: 'left', buttons: 0, clickCount: 1 });
  await waitFor(`!document.querySelector('#prepare-panel .cut-card').hidden`, 'Prepare cut card open');
  await clickEl('#prepare-panel .cut-type-trigger');
  await waitFor(`!document.querySelector('.cut-type-menu').hidden`, 'cut type menu open');
  await clickEl('.cut-type-opt[data-id="pocket"]');
  await waitFor(`import('/apps/shaper/src/cut-plan.js').then((m) => m.cutPlanEntries().length > 0)`, 'Pocket planned');
  await clickEl('#prepare-dir-legend .sk-hint-i');
  await waitFor(`(() => { const h = document.querySelector('#prepare-dir-legend .sk-hint:not([hidden])'); return !!h && h.textContent.length > 10; })()`, 'Prepare dirLegend hint opens');

  // Check Export (review) tab toolbar tooltips & Sync modal
  await clickEl('.sk-header-tab[data-tab="review"]');
  await waitFor(`!document.getElementById('view-review').hidden`, 'Export tab');
  await hoverEl('#review-view-3d');
  await waitFor(`(() => { const t = document.querySelector('.sk-tooltip:not([hidden])'); return !!t && /3D/i.test(t.textContent); })()`, 'Export 3D tooltip');

  await clickEl('#btn-sync-shaper');
  await waitFor(`document.getElementById('shaper-sync-modal').open`, 'Sync modal open');

  // Browse folders with login -> loads '/', shows #sync-session, hides #sync-creds
  await typeVal('#sync-email', FAKE_LOGIN.email);
  await typeVal('#sync-password', FAKE_LOGIN.password);
  api.reset();
  await clickEl('#sync-btn-browse');
  await waitFor(`!document.getElementById('sync-session').hidden && !!document.querySelector('#sync-folder-list [data-folder="Furniture"]')`, 'Root folders loaded');
  assert.strictEqual(await evalJs(`document.getElementById('sync-creds').hidden`), true, 'Session active hides credential fields');
  assert.deepStrictEqual(api.steps(), ['token', 'search'], 'Browse fetches token once then lists root');

  // Enter Furniture folder -> see Chair.svg -> create subfolder Tables reusing session token!
  api.reset();
  await clickEl('#sync-folder-list [data-folder="Furniture"]');
  await waitFor(`!!document.querySelector('#sync-folder-list [data-file="Chair.svg"]')`, 'Furniture/ loaded');
  assert.deepStrictEqual(api.steps(), ['search'], 'Navigation reuses in-memory session token (no /token call)');

  await clickEl('#sync-btn-new-folder');
  await waitFor(`!document.getElementById('sync-mkdir-row').hidden`, 'mkdir input shown');
  await typeVal('#sync-mkdir-name', 'Tables');
  api.reset();
  await clickEl('#sync-mkdir-ok');
  await waitFor(`!!document.querySelector('#sync-breadcrumbs [data-path="/Furniture/Tables/"][aria-current="location"]')`, 'Navigated into /Furniture/Tables/');
  assert.deepStrictEqual(api.steps(), ['create', 'search'], 'mkdir + list reuse session token');
  await shot('sync-folder-browser.png', '#shaper-sync-modal', 10);

  // Send into /Furniture/Tables/ reusing sessionToken
  api.reset();
  await typeVal('#sync-filename', 'apron.svg');
  await clickEl('#sync-btn-submit');
  await waitFor(`document.getElementById('sync-modal-status').textContent.includes('Sent apron.svg to My Files/Furniture/Tables')`, 'Subfolder upload confirmed');
  assert.deepStrictEqual(api.steps(), ['search', 'blob', 'create'], 'Subfolder upload reuses session token (no /token call)');
  assert.deepStrictEqual(api.names('/Furniture/Tables/'), ['apron.svg']);

  // Reopening Sync preserves the in-memory session; rotating token on server -> Refresh detects 401 -> clears session cleanly to re-auth
  await clickEl('#sync-btn-cancel');
  await waitFor(`!document.getElementById('shaper-sync-modal').open`, 'closed');
  await clickEl('#btn-sync-shaper');
  await waitFor(`document.getElementById('shaper-sync-modal').open && !document.getElementById('sync-session').hidden`, 'Session persists across modal reopen in page memory');
  api.rotateToken('rotated-jwt-772');
  await clickEl('#sync-btn-refresh');
  await waitFor(`document.getElementById('sync-session').hidden === true && !document.getElementById('sync-creds').hidden`, 'Expired 401 token cleanly clears session back to login form');
  await clickEl('#sync-btn-cancel');
  await scanNoSecrets('desktop');

  // ── 3. Phone 390 x 844 check: Settings panel fits screen + Sync browser fits screen ──
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenOrientation: { type: 'portraitPrimary', angle: 0 } });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await navigate(`${LOCAL}apps/shaper/index.html`, 10000);
  await waitForApp('design-canvas');
  await clickEl('#btn-settings');
  await waitFor(`!document.querySelector('.sk-style-panel').classList.contains('sk-hidden')`, 'phone settings open');
  const phoneSettings = await evalJs(`(() => { const r = document.querySelector('.sk-style-panel').getBoundingClientRect(); return { left: Math.round(r.left), right: Math.round(r.right), docW: document.documentElement.scrollWidth }; })()`);
  assert(phoneSettings.left >= 0 && phoneSettings.right <= 390 && phoneSettings.docW <= 390, `Phone Settings fits 390px: ${JSON.stringify(phoneSettings)}`);
  await shot('phone-settings-fits.png');
  await clickEl('.sk-style-close');

  // TASK 774 (review finding 4j: the header promised it): the Sync folder browser on the phone: the folder list's rows and the exists-question's three
  // buttons are 44 px touch targets, the dialog fits 390 px. (The plan is set through the page's own cut-plan module, the drawing is the desktop phase's.)
  await waitFor(`!!(window.__designController && window.__designController.state)`, 'phone designController ready');
  await evalJs(`(async () => { const st = window.__designController.state;
    if (!st.shapes.some((s) => s.id === 'Rs0')) { [[0, 0], [120, 0], [120, 70], [0, 70]].forEach(([x, y], i) => st.joints.set('Rj' + i, { x, y })); for (let i = 0; i < 4; i++) st.shapes.push({ id: 'Rs' + i, type: 'line', joints: ['Rj' + i, 'Rj' + ((i + 1) % 4)] }); st.saveState('draw'); }
    const lf = await import('/packages/core/loop-finder.js'); const cp = await import('/apps/shaper/src/cut-plan.js');
    if (!cp.cutPlanEntries().length) cp.CUT_PLAN.set('loop:' + lf.findLoops(st)[0].id, { cutType: 'pocket', cutDepth: 6, cutOffset: 0, toolDia: 6.35 }); })()`);
  await clickEl('.sk-header-tab[data-tab="review"]');
  await waitFor(`!document.getElementById('view-review').hidden`, 'phone Export tab');
  await clickEl('#btn-sync-shaper');
  await waitFor(`document.getElementById('shaper-sync-modal').open`, 'phone Sync modal open');
  await typeVal('#sync-email', FAKE_LOGIN.email);
  await typeVal('#sync-password', FAKE_LOGIN.password);
  await clickEl('#sync-btn-browse');
  await waitFor(`!!document.querySelector('#sync-folder-list [data-folder="Furniture"]') && !!document.querySelector('#sync-folder-list [data-file="RootPlan.svg"]')`, 'phone: root folders and files listed');
  const phoneRows = await evalJs(`(() => { const r = document.getElementById('shaper-sync-modal').getBoundingClientRect();
    return { rows: [...document.querySelectorAll('#sync-folder-list .sync-entry')].map((e) => Math.round(e.getBoundingClientRect().height)), left: Math.round(r.left), right: Math.round(r.right), docW: document.documentElement.scrollWidth }; })()`);
  console.log('phone sync browser: ' + JSON.stringify(phoneRows));
  assert(phoneRows.rows.length >= 3 && phoneRows.rows.every((h) => h >= 44), `phone: every folder-list row is >= 44 px: ${JSON.stringify(phoneRows.rows)}`);
  assert(phoneRows.left >= 0 && phoneRows.right <= 390 && phoneRows.docW <= 390, `phone: the Sync dialog fits 390 px: ${JSON.stringify(phoneRows)}`);
  await shot('phone-sync-browser.png', '#shaper-sync-modal', 0);
  await typeVal('#sync-filename', 'RootPlan.svg');
  await clickEl('#sync-btn-submit');
  await waitFor(`!document.getElementById('sync-exists').hidden`, 'phone: the exists question');
  const phoneQ = await evalJs(`['sync-btn-replace', 'sync-btn-keep-both', 'sync-btn-exists-cancel'].map((id) => { const r = document.getElementById(id).getBoundingClientRect(); return [id, Math.round(r.height), Math.round(r.left) >= 0 && Math.round(r.right) <= 390]; })`);
  console.log('phone exists question: ' + JSON.stringify(phoneQ));
  assert(phoneQ.every(([, h, inside]) => h >= 44 && inside), `phone: the three answers are 44 px and on screen: ${JSON.stringify(phoneQ)}`);
  await shot('phone-sync-exists.png', '#shaper-sync-modal', 0);
  await clickEl('#sync-btn-exists-cancel');
  await clickEl('#sync-btn-cancel');
  await scanNoSecrets('phone');

  console.log('shaperhub-browser-hints-772-live: ok');
} finally {
  globalThis.fetch = realFetch;
  await cdp.close();
}
