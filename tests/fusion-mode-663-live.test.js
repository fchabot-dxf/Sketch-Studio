// tests/fusion-mode-663-live.test.js — TASK 663: live CDP verification of Shaper in Fusion mode (?host=fusion)
// and normal Shaper unchanged. Saves screenshots at palette size (480x731) and desktop (1280x800) to .evidence/663/.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser } from './helpers/cdp-browser.js';

const EVIDENCE_DIR = path.resolve('.evidence/663');
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

const cdp = await launchBrowser({ tag: '663-fusion', width: 1280, height: 800 });
if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }

const { port, send, evalJs, waitFor, waitForApp, navigate, close } = cdp;

async function shot(name) {
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(EVIDENCE_DIR, name), Buffer.from(data, 'base64'));
}

try {
  // ---- 1. Fusion mode (?host=fusion) with stubbed window.adsk injected BEFORE load
  // Also pre-seed shaper-mode='design' in localStorage to prove stored hidden stages are ignored.
  const stubSource = `(() => {
    try { localStorage.setItem('shaper-mode', 'design'); } catch (e) {}
    const sent = [];
    window.adsk = {
      _sent: sent,
      fusionSendData(action, data) { sent.push({ action, data }); },
    };
  })();`;
  const { identifier: stubId } = await send('Page.addScriptToEvaluateOnNewDocument', { source: stubSource });

  await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html?host=fusion`);
  await waitForApp('design-canvas');
  await waitFor(`!!document.getElementById('btn-fusion-add-selection')`, 'Fusion Prepare bar mounted');

  // Opens on Prepare, Design hidden and absent from header + sidebar stage tabs, and Projects/file/Drive sidebar + doc tabs hidden
  await evalJs(`document.querySelector('.sk-sidebar-btn').click()`);
  await waitFor(`document.querySelectorAll('.sk-sidebar-stage').length > 0`, 'sidebar stage buttons rendered');
  const bootState = await evalJs(`(() => ({
    prepareHidden: document.getElementById('view-prepare').hidden,
    designHidden: document.getElementById('design-view').hidden,
    headerTabs: [...document.querySelectorAll('.sk-header-tab')].map((b) => ({ id: b.dataset.tab, text: b.textContent.trim(), active: b.classList.contains('active') })),
    sidebarStages: [...document.querySelectorAll('.sk-sidebar-stage')].map((b) => ({ id: b.dataset.tab, active: b.classList.contains('active') })),
    sidebarActions: [...document.querySelectorAll('.sk-sidebar [data-section="actions"] [data-action]')].map((b) => b.dataset.action),
    sidebarDocCount: document.querySelectorAll('.sk-sidebar-doc').length,
    sidebarStatusCount: document.querySelectorAll('.sk-sidebar [data-section="status"]').length,
    sidebarAccountCount: document.querySelectorAll('.sk-sidebar [data-section="account"], .sk-account, .sk-account-menu').length,
    sidebarGotoCount: document.querySelectorAll('.sk-sidebar [data-section="goto"]').length,
    docTabsCount: document.querySelectorAll('.sk-doctabs').length,
    addBtnText: document.getElementById('btn-fusion-add-selection').textContent,
    addBtnDisabled: document.getElementById('btn-fusion-add-selection').disabled,
    sent: window.adsk._sent.slice(),
    hasHandler: !!(window.fusionJavaScriptHandler && typeof window.fusionJavaScriptHandler.handle === 'function'),
  }))()`);
  await evalJs(`document.querySelector('.sk-sidebar-backdrop').click()`);

  assert.strictEqual(bootState.prepareHidden, false, 'Fusion mode opens on Prepare');
  assert.strictEqual(bootState.designHidden, true, 'Design view stays hidden despite stored shaper-mode=design');
  assert.deepStrictEqual(bootState.headerTabs.map((t) => t.id), ['prepare', 'review'], 'Header tabs filtered to Prepare and Review only');
  assert.strictEqual(bootState.headerTabs.find((t) => t.id === 'prepare').active, true, 'Prepare tab is active');
  assert.deepStrictEqual(bootState.sidebarStages.map((t) => t.id), ['prepare', 'review'], 'Sidebar drawer stages filtered to Prepare and Review only');
  assert.deepStrictEqual(bootState.sidebarActions, ['download', 'settings', 'log', 'feedback'], 'Fusion mode hides Open/New/Save/Projects file actions, keeps host actions + the shared Rate & feedback item (TASK 830)');
  assert.strictEqual(bootState.sidebarDocCount, 0, 'Fusion mode hides document title/rename header');
  assert.strictEqual(bootState.sidebarStatusCount, 0, 'Fusion mode hides Drive/save status line');
  assert.strictEqual(bootState.sidebarAccountCount, 0, 'Fusion mode has no Google account / Drive controls (no avatar either)');
  assert.strictEqual(bootState.sidebarGotoCount, 0, 'Fusion mode hides GO TO section');
  assert.strictEqual(bootState.docTabsCount, 0, 'Fusion mode hides document tab strip');
  assert.strictEqual(bootState.addBtnText, 'Add selection', 'Add selection button label present');
  assert.strictEqual(bootState.addBtnDisabled, false, 'Add selection enabled when window.adsk present');
  assert.strictEqual(bootState.hasHandler, true, 'window.fusionJavaScriptHandler.handle installed');
  assert.strictEqual(bootState.sent.length, 1, 'boot sent one ping');
  assert.strictEqual(bootState.sent[0].action, 'ping', 'boot sent ping action');
  assert.strictEqual(JSON.parse(bootState.sent[0].data).action, 'ping', 'boot ping payload has action: ping');

  // Simulate pong -> connection status shows "Connected to Fusion: <document name>"
  await evalJs(`window.fusionJavaScriptHandler.handle('pong', JSON.stringify({ action: 'pong', fusionVersion: '2.0.20256', documentName: 'Bracket v3' }))`);
  assert.strictEqual(await evalJs(`document.getElementById('shaper-fusion-status').textContent`), 'Connected to Fusion: Bracket v3', 'pong updates status text');

  // Click Add selection -> sends add_selection via window.adsk.fusionSendData
  await evalJs(`document.getElementById('btn-fusion-add-selection').click()`);
  const afterAdd = await evalJs(`window.adsk._sent.slice()`);
  assert.strictEqual(afterAdd.length, 2, 'Add selection sent message');
  assert.strictEqual(afterAdd[1].action, 'add_selection', 'sent add_selection action');
  assert.strictEqual(JSON.parse(afterAdd[1].data).action, 'add_selection', 'payload has action: add_selection');

  // Simulate selection_data -> "Added <source name>: N regions, M chains"
  await evalJs(`window.fusionJavaScriptHandler.handle('selection_data', JSON.stringify({ action: 'selection_data', version: 1, regions: [{ id: 'reg_0' }, { id: 'reg_1' }] }))`);
  const selNotice = await evalJs(`({ hidden: document.getElementById('prepare-notice').hidden, text: document.getElementById('prepare-notice').textContent, isError: document.getElementById('prepare-notice').classList.contains('is-error') })`);
  assert.strictEqual(selNotice.hidden, false, 'selection_data notice is visible');
  assert.strictEqual(selNotice.text, 'Added selection: 2 regions, 0 chains', 'selection_data notice text matches');
  assert.strictEqual(selNotice.isError, false, 'selection_data notice is not an error');

  // Desktop screenshot (1280x800) showing Prepare + Review tabs, Add selection, Connected status, and selection_data notice
  await shot('fusion-desktop-1280x800.png');

  // Palette size screenshot (480x731) + open drawer screenshot at 480x731
  await send('Emulation.setDeviceMetricsOverride', { width: 480, height: 731, deviceScaleFactor: 1, mobile: false });
  await waitFor(`window.innerWidth === 480 && window.innerHeight === 731`, 'palette viewport 480x731');
  await shot('fusion-palette-480x731.png');
  await evalJs(`document.querySelector('.sk-sidebar-chevron').click()`);
  await waitFor(`document.querySelector('.sk-sidebar').classList.contains('open')`, 'palette drawer opened');
  await new Promise((r) => setTimeout(r, 250));
  await shot('fusion-palette-sidebar-open-480x731.png');
  await evalJs(`document.querySelector('.sk-sidebar-backdrop').click()`);
  await waitFor(`!document.querySelector('.sk-sidebar').classList.contains('open')`, 'palette drawer closed');

  // Restore desktop metrics & test error message + Review tab switching
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await evalJs(`window.fusionJavaScriptHandler.handle('error', JSON.stringify({ action: 'error', message: 'Select a body or sketch in Fusion' }))`);
  const errNotice = await evalJs(`({ hidden: document.getElementById('prepare-notice').hidden, text: document.getElementById('prepare-notice').textContent, isError: document.getElementById('prepare-notice').classList.contains('is-error') })`);
  assert.strictEqual(errNotice.hidden, false, 'error notice visible');
  assert.strictEqual(errNotice.text, 'Select a body or sketch in Fusion', 'error text displayed');
  assert.strictEqual(errNotice.isError, true, 'error notice has is-error class');

  await evalJs(`document.querySelector('.sk-header-tab[data-tab="review"]').click()`);
  await waitFor(`!document.getElementById('view-review').hidden && !!document.getElementById('btn-generate-svg') && !!document.getElementById('btn-sync-shaper')`, 'Review stage with export/upload in Fusion mode');

  // ---- 2. Fusion mode (?host=fusion) WITHOUT window.adsk -> waits with Add selection disabled
  await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: stubId });
  await evalJs(`(() => { try { localStorage.removeItem('shaper-mode'); } catch (e) {} })()`);
  await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html?host=fusion`);
  await waitForApp('design-canvas');
  await waitFor(`!document.getElementById('view-prepare').hidden && !!document.getElementById('btn-fusion-add-selection')`, 'Fusion Prepare without adsk');
  const noAdsk = await evalJs(`({ disabled: document.getElementById('btn-fusion-add-selection').disabled, status: document.getElementById('shaper-fusion-status').textContent, state: document.getElementById('shaper-fusion-status').dataset.state, title: document.getElementById('btn-fusion-add-selection').title })`);
  assert.strictEqual(noAdsk.disabled, true, 'Add selection disabled when window.adsk missing');
  assert.strictEqual(noAdsk.status, 'Waiting for Fusion…', `status shows Waiting while polling for adsk (${noAdsk.status})`);
  assert.strictEqual(noAdsk.state, 'waiting', 'status state is waiting');
  await shot('fusion-no-adsk-1280x800.png');

  // ---- 3. Normal Shaper (no ?host=fusion) unchanged
  await evalJs(`(() => { try { localStorage.removeItem('shaper-mode'); } catch (e) {} })()`);
  await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`);
  await waitForApp('design-canvas');
  await waitFor(`document.querySelectorAll('.sk-header-tab').length === 3`, 'normal Shaper header tabs'); // TASK 706: Explore removed; TASK 741: Vcarve removed
  const normal = await evalJs(`(() => ({
    tabs: [...document.querySelectorAll('.sk-header-tab')].map((b) => ({ id: b.dataset.tab, active: b.classList.contains('active') })),
    addBtn: document.getElementById('btn-fusion-add-selection'),
    fusionBar: document.getElementById('shaper-fusion-bar'),
    hasHandler: 'fusionJavaScriptHandler' in window,
  }))()`);
  assert.deepStrictEqual(normal.tabs.map((t) => t.id), ['design', 'prepare', 'review'], 'normal Shaper keeps its 3 stage tabs (TASK 706: Explore removed; TASK 741: Vcarve removed)');
  assert.strictEqual(normal.tabs.find((t) => t.id === 'design').active, true, 'normal Shaper opens on Design (TASK 706: was Explore)');
  assert.strictEqual(normal.addBtn, null, 'Add selection absent outside Fusion mode');
  assert.strictEqual(normal.fusionBar, null, 'Fusion bar absent outside Fusion mode');
  assert.strictEqual(normal.hasHandler, false, 'window.fusionJavaScriptHandler not installed outside Fusion mode');
  // Normal mode keeps Projects / file / Drive sidebar and document tabs unchanged
  await evalJs(`document.querySelector('.sk-sidebar-btn').click()`);
  await waitFor(`document.querySelector('.sk-sidebar').classList.contains('open')`, 'normal Shaper drawer open');
  const normalSidebar = await evalJs(`(() => ({
    actions: [...document.querySelectorAll('.sk-sidebar [data-section="actions"] [data-action]')].map((b) => b.dataset.action),
    hasDoc: !!document.querySelector('.sk-sidebar-doc'),
    hasStatus: !!document.querySelector('.sk-sidebar [data-section="status"]'),
    hasAccount: !!document.querySelector('.sk-sidebar [data-section="account"]'),
    hasGoto: !!document.querySelector('.sk-sidebar [data-section="goto"]'),
    hasDocTabs: document.querySelectorAll('.sk-doctabs').length === 1,
  }))()`);
  await evalJs(`document.querySelector('.sk-sidebar-backdrop').click()`);
  await waitFor(`!document.querySelector('.sk-sidebar').classList.contains('open')`, 'normal Shaper drawer close');
  assert.deepStrictEqual(normalSidebar.actions, ['new-design', 'templates', 'save', 'save-as', 'duplicate', 'open-recent', 'projects', 'open-file', 'import-file', 'open-stl', 'insert-stl', 'download', 'fusion-addin', 'settings', 'log', 'about', 'feedback'], 'normal Shaper keeps full project/file sidebar actions (TASK 706: no Explore Open SVG / Export; TASK 733: + the Fusion add-in download, hidden in Fusion mode; TASK 790: + Open STL, hidden in Fusion mode; TASK 841: + Insert STL, the same)');
  assert.strictEqual(normalSidebar.hasDoc, true, 'normal Shaper keeps document name header');
  assert.strictEqual(normalSidebar.hasStatus, true, 'normal Shaper keeps storage/Drive status');
  assert.strictEqual(normalSidebar.hasAccount, false, 'normal Shaper: the drawer has no account row (TASK 776: the account is the avatar in the footer)');
  assert.strictEqual(await evalJs(`document.querySelectorAll('.sk-footer-end > .sk-account').length`), 1, 'normal Shaper: ONE account avatar, in the footer');
  assert.strictEqual(normalSidebar.hasGoto, false, 'normal Shaper has no GO TO section either (TASK 696: each app is its own website)');
  assert.strictEqual(normalSidebar.hasDocTabs, true, 'normal Shaper keeps document tab strip');
  // Switching to Prepare in normal mode also has no Add selection button
  await evalJs(`document.querySelector('.sk-header-tab[data-tab="prepare"]').click()`);
  await waitFor(`!document.getElementById('view-prepare').hidden`, 'normal Prepare opened');
  assert.strictEqual(await evalJs(`document.getElementById('btn-fusion-add-selection')`), null, 'Add selection absent in normal Prepare');
  await shot('normal-shaper-1280x800.png');

  console.log('fusion-mode-663-live.test.js: ok');
} finally {
  await close();
}
