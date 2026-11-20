// tests/fusion-mode-663-node.test.js — TASK 663: Fusion mode detection, stage filtering, and palette message bridge unit/node tests.
import assert from 'node:assert';
import { Window } from 'happy-dom';
import { FUSION_ACTIONS, isFusionMode, createFusionBridge, mountFusionPrepareBar } from '../apps/shaper/src/fusion-bridge.js';
import { SHAPER_STAGES, FUSION_HIDDEN_STAGES, shaperStagesFor, resolveInitialMode, createModeRouter } from '../apps/shaper/src/modes.js';
import { mountAppChrome } from '#ui/app-chrome.js';

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.strictEqual(a, b, msg); checks++; };
const deepEq = (a, b, msg) => { assert.deepStrictEqual(a, b, msg); checks++; };

// 1. Declared action names match add-in bridge.py (and SA-2 add_selection / selection_data)
deepEq(FUSION_ACTIONS, {
  PING: 'ping',
  PONG: 'pong',
  ERROR: 'error',
  ADD_SELECTION: 'add_selection',
  SELECTION_DATA: 'selection_data',
  HIGHLIGHT_SELECTION: 'highlight_selection',
  CLEAR_SELECTION: 'clear_selection',
}, 'declared Fusion action names match protocol');

// 2. Mode detection via ?host=fusion ONLY (one place, never sniffing window.adsk)
eq(isFusionMode('?host=fusion'), true, 'detects ?host=fusion');
eq(isFusionMode('?foo=1&host=fusion&bar=2'), true, 'detects host=fusion alongside other params');
eq(isFusionMode({ search: '?host=fusion' }), true, 'accepts Location-like object');
eq(isFusionMode(''), false, 'empty query is normal mode');
eq(isFusionMode('?host=web'), false, 'other host value is normal mode');
eq(isFusionMode('?fusion=1'), false, 'unrelated query param is normal mode');

// 3. Stage filtering and initial-mode resolution
deepEq(shaperStagesFor({ fusion: false }), SHAPER_STAGES, 'normal mode keeps all 3 Shaper stages (TASK 706: Explore removed; TASK 741: Vcarve removed)');
const fusionStages = shaperStagesFor({ fusion: true });
deepEq(fusionStages.map((s) => s.id), ['prepare', 'review'], 'Fusion mode shows only Prepare and Review');
deepEq(FUSION_HIDDEN_STAGES, ['design'],
  'Design is declared hidden in Fusion mode (TASK 706: Explore is no stage at all; TASK 741: nor is Vcarve)');

eq(resolveInitialMode(null, { fusion: false }), 'design', 'normal mode defaults to Design (TASK 706: was Explore)');
eq(resolveInitialMode('design', { fusion: false }), 'design', 'normal mode restores stored Design');
eq(resolveInitialMode('simexport', { fusion: false }), 'review', 'normal mode maps legacy simexport -> review');

eq(resolveInitialMode(null, { fusion: true }), 'prepare', 'Fusion mode defaults to Prepare');
eq(resolveInitialMode('design', { fusion: true }), 'prepare', 'Fusion mode ignores stored Design');
eq(resolveInitialMode('explore', { fusion: true }), 'prepare', 'Fusion mode ignores stored Explore');
eq(resolveInitialMode('vcarve', { fusion: true }), 'prepare', 'Fusion mode ignores a stored Vcarve (TASK 741: the removed stage)');
eq(resolveInitialMode('review', { fusion: true }), 'review', 'Fusion mode keeps stored Review (visible stage)');

// Mode router makes hidden stages unreachable in Fusion mode
{
  const makeView = () => ({ hidden: false, style: {} });
  const views = { design: makeView(), prepare: makeView(), review: makeView() };
  let active = null, designStarts = 0;
  const router = createModeRouter({
    views,
    stages: fusionStages,
    defaultMode: 'prepare',
    onActiveChange: (m) => { active = m; },
    getController: () => null,
    ensureSketch: () => { designStarts++; },
  });
  router.showMode('design');
  eq(router.current(), 'prepare', 'showMode("design") is unreachable in Fusion mode and falls back to Prepare');
  eq(active, 'prepare', 'chrome synced to Prepare');
  eq(views.design.hidden, true, 'Design container stays hidden');
  eq(views.prepare.hidden, false, 'Prepare container is shown');
  eq(designStarts, 0, 'Design ensureSketch never triggered by blocked showMode("design")');
  router.showMode('explore');
  eq(router.current(), 'prepare', 'showMode("explore") falls back to Prepare');
  router.showMode('vcarve');
  eq(router.current(), 'prepare', 'showMode("vcarve") (TASK 741: no such stage) falls back to Prepare');
  router.showMode('review');
  eq(router.current(), 'review', 'Review stage remains reachable');
}

// 4. Bridge send() & window.fusionJavaScriptHandler.handle() routing
{
  const sent = [];
  const statuses = [], notices = [], errors = [], selections = [];
  const fakeWin = { adsk: { fusionSendData: (action, data) => { sent.push({ action, data }); } } };

  const bridge = createFusionBridge({
    globalTarget: fakeWin,
    onStatus: (text, meta) => statuses.push({ text, meta }),
    onNotice: (text, payload) => notices.push({ text, payload }),
    onError: (msg) => errors.push(msg),
    onSelectionData: (payload) => selections.push(payload),
  });

  ok(fakeWin.fusionJavaScriptHandler && typeof fakeWin.fusionJavaScriptHandler.handle === 'function',
    'registers window.fusionJavaScriptHandler.handle');
  eq(bridge.canSend(), true, 'canSend() is true with window.adsk.fusionSendData');

  const pingRes = bridge.bootPing();
  eq(pingRes.ok, true, 'bootPing succeeds with stubbed adsk');
  deepEq(sent[0], { action: 'ping', data: JSON.stringify({ action: 'ping' }) }, 'bootPing sends declared ping action');

  const addRes = bridge.send(FUSION_ACTIONS.ADD_SELECTION, {});
  eq(addRes.ok, true, 'send(add_selection) succeeds');
  deepEq(sent[1], { action: 'add_selection', data: JSON.stringify({ action: 'add_selection' }) }, 'send(add_selection) sends declared action');

  // pong routing -> Connected to Fusion: <document name>
  const retPong = fakeWin.fusionJavaScriptHandler.handle('pong', JSON.stringify({
    action: 'pong',
    fusionVersion: '2.0.20256',
    documentName: 'Bracket v3',
  }));
  eq(retPong, 'OK', 'handle returns OK for pong');
  eq(statuses[0].text, 'Connected to Fusion: Bracket v3', 'pong displays Connected to Fusion: <document name>');

  fakeWin.fusionJavaScriptHandler.handle('pong', { action: 'pong', documentName: '' });
  eq(statuses[1].text, 'Connected to Fusion', 'pong with empty documentName displays Connected to Fusion');

  // error routing -> visible error
  const errCountBefore = errors.length;
  fakeWin.fusionJavaScriptHandler.handle('error', JSON.stringify({ action: 'error', message: 'Select a body or sketch first' }));
  eq(errors.length, errCountBefore + 1, 'error action routes to visible error callback');
  eq(errors.at(-1), 'Select a body or sketch first', 'error preserves message');

  // selection_data routing -> "Added <source name>: N regions, M chains" + importer hook + keeps payload
  const sampleSel = { action: 'selection_data', version: 1, units: 'mm', regions: [{ id: 'reg_0' }, { id: 'reg_1' }] };
  fakeWin.fusionJavaScriptHandler.handle('selection_data', JSON.stringify(sampleSel));
  eq(notices.at(-1).text, 'Added selection: 2 regions, 0 chains', 'selection_data shows Added message');
  eq(selections.length, 1, 'selection_data calls onSelectionData importer hook');
  deepEq(bridge.getLastSelection(), sampleSel, 'bridge keeps last selection payload for tests');

  // unknown action / mismatch / malformed JSON -> error shown (never silent)
  fakeWin.fusionJavaScriptHandler.handle('mystery_action', JSON.stringify({ action: 'mystery_action' }));
  ok(/Unknown Fusion action: mystery_action/.test(errors.at(-1)), `unknown action reports error (${errors.at(-1)})`);

  fakeWin.fusionJavaScriptHandler.handle('pong', '{not json');
  ok(/Malformed JSON/.test(errors.at(-1)), `malformed JSON reports error (${errors.at(-1)})`);

  fakeWin.fusionJavaScriptHandler.handle('pong', JSON.stringify({ action: 'error' }));
  ok(/mismatch/i.test(errors.at(-1)), `action mismatch reports error (${errors.at(-1)})`);

  bridge.destroy();
  eq(fakeWin.fusionJavaScriptHandler, undefined, 'destroy() removes fusionJavaScriptHandler');
}

// 5. Missing window.adsk: send fails visibly + Add selection button disabled with hint
{
  const win = new Window();
  const prevDoc = globalThis.document;
  globalThis.document = win.document;
  try {
    const viewPrepare = win.document.createElement('section');
    viewPrepare.id = 'view-prepare';
    const notice = win.document.createElement('div');
    notice.id = 'prepare-notice';
    notice.hidden = true;
    viewPrepare.appendChild(notice);
    win.document.body.appendChild(viewPrepare);

    const ui = mountFusionPrepareBar({ viewPrepareEl: viewPrepare, noticeEl: notice, globalTarget: win });
    eq(ui.bridge.canSend(), false, 'canSend() false when window.adsk is missing');
    eq(ui.addBtn.disabled, true, 'Add selection disabled when window.adsk is missing');
    ok(ui.statusEl.textContent.includes('window.adsk missing'), `disabled hint mentions window.adsk missing (${ui.statusEl.textContent})`);
    eq(ui.bootPing().ok, false, 'bootPing does not send when adsk missing');
    eq(notice.hidden, true, 'no scary error popup on boot when simply opened without Fusion');

    const failSend = ui.bridge.send(FUSION_ACTIONS.ADD_SELECTION, {});
    eq(failSend.ok, false, 'explicit send fails gracefully without window.adsk');
    eq(notice.hidden, false, 'explicit send without window.adsk shows visible notice');
    ok(notice.classList.contains('is-error'), 'error notice styled with is-error');
  } finally {
    globalThis.document = prevDoc;
  }
}

// 6. Declared per-host `projects` option on mountAppChrome / mountProjectSidebar:
//    projects: false hides file/project actions, Projects/Recent, doc header/status, Drive/account rows, and document tabs;
//    projects: true (default / normal mode) keeps all of them unchanged.
{
  const stubStore = () => ({
    cloud: { checkConnection: async () => [] },
    subscribe: () => () => {},
    current: async () => null,
    get: async () => null,
    status: () => ({ where: 'device', state: 'saved', at: null, reason: null }),
  });
  const stubAccount = () => ({
    state: () => ({ signedIn: false, lapsed: false }),
    subscribe: () => () => {},
    signIn: async () => {},
    signOut: async () => {},
  });
  const hostActions = [
    { id: 'download', label: 'Download', onClick: () => {} },
    { divider: true },
    { id: 'settings', label: 'Settings', onClick: () => {} },
    { id: 'log', label: 'Log', onClick: () => {} },
  ];

  const prev = {
    window: globalThis.window,
    document: globalThis.document,
    MutationObserver: globalThis.MutationObserver,
    localStorage: globalThis.localStorage,
  };
  const win = new Window({ url: 'http://localhost/apps/shaper/index.html?host=fusion' });
  globalThis.window = win;
  globalThis.document = win.document;
  globalThis.MutationObserver = win.MutationObserver;
  globalThis.localStorage = win.localStorage;
  try {
    // 6a. Fusion mode (projects: false)
    const chromeHidden = mountAppChrome({
      appId: 'shaper',
      stages: shaperStagesFor({ fusion: true }),
      activeStage: 'prepare',
      getBuffer: () => null,
      importFile: () => {},
      documentTabs: true,
      projects: false,
      host: 'fusion', // as Shaper's main.js passes it; TASK 828: the About item is not in Fusion's palette
      store: stubStore(),
      account: stubAccount(),
      hostActions,
    });
    chromeHidden.sidebar.open();
    eq(win.document.querySelectorAll('.sk-doctabs').length, 0, 'projects: false omits document tab strip');
    eq(win.document.querySelector('.sk-sidebar-doc'), null, 'projects: false omits document name header');
    eq(win.document.querySelector('[data-section="status"]'), null, 'projects: false omits storage/Drive status');
    eq(win.document.querySelector('[data-section="account"]'), null, 'projects: false omits Google account / Drive section');
    eq(win.document.querySelector('[data-section="goto"]'), null, 'no GO TO section (TASK 696: none in any app)');
    const fusionActs = [...win.document.querySelectorAll('.sk-sidebar [data-section="actions"] [data-action]')].map((b) => b.dataset.action);
    deepEq(fusionActs, ['download', 'settings', 'log', 'feedback'], 'projects: false keeps only hostActions, and the shared Rate & feedback item (TASK 830: in every app, Fusion palette included)');
    chromeHidden.destroy();

    // 6b. Normal mode (projects: true) unchanged
    win.document.body.innerHTML = '';
    const chromeNormal = mountAppChrome({
      appId: 'shaper',
      stages: shaperStagesFor({ fusion: false }),
      activeStage: 'design',
      getBuffer: () => null,
      importFile: () => {},
      documentTabs: true,
      projects: true,
      store: stubStore(),
      account: stubAccount(),
      hostActions,
    });
    await new Promise((r) => setTimeout(r, 30));
    chromeNormal.sidebar.open();
    eq(win.document.querySelectorAll('.sk-doctabs').length, 1, 'projects: true keeps document tab strip');
    ok(win.document.querySelector('.sk-sidebar-doc') !== null, 'projects: true keeps document name header');
    ok(win.document.querySelector('[data-section="status"]') !== null, 'projects: true keeps storage/Drive status');
    ok(win.document.querySelector('[data-section="account"]') !== null, 'projects: true keeps Google account / Drive section');
    eq(win.document.querySelector('[data-section="goto"]'), null, 'no GO TO section in normal mode either (TASK 696: each app is its own website)');
    const normalActs = [...win.document.querySelectorAll('.sk-sidebar [data-section="actions"] [data-action]')].map((b) => b.dataset.action);
    deepEq(normalActs, ['new-design', 'templates', 'save', 'save-as', 'duplicate', 'open-recent', 'projects', 'open-file', 'import-file', 'download', 'settings', 'log', 'about', 'feedback'], 'projects: true keeps all project/file actions + hostActions + the site items (TASK 828: About) then the shared Rate & feedback item (TASK 830)');
    chromeNormal.destroy();
  } finally {
    globalThis.window = prev.window;
    globalThis.document = prev.document;
    globalThis.MutationObserver = prev.MutationObserver;
    globalThis.localStorage = prev.localStorage;
  }
}

console.log(`fusion-mode-663-node: ${checks} checks passed`);
