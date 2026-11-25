// apps/shaper/src/shaper-app.js — Shaper's page WIRING, declared once (TASK 881: moved here from main.js): the views (Design / Prepare / Export), the
// Prepare stage, the Export step (3D / 2D / Paths, the simulation, the Generate / Sync / ShaperHub actions, the ShaperHub dialog), the footer, the Log and,
// in Fusion mode, the Fusion bar, the palette bridge and the live toolpaths. What differs between the pages that run it comes in DECLARED
// (startShaperApp's arguments), never as a branch on where the page is:
//   apps/shaper/src/main.js         the website (Shaper's own site, and the same page in a Fusion palette with ?host=fusion): the project drawer
//                                   (#ui/app-chrome.js), the page's shared store, Settings, Download, Open / Insert STL, the add-in download, the SVG / DXF
//                                   import, the SKETCHES browser, the Google session probe, the old ShaperHub login's removal, the pre-855 work offer;
//   apps/shaper/src/fusion-main.js  the Fusion PANEL build (scripts/build-site.cjs shaper-fusion, carried offline by the add-in): the plain drawer
//                                   (#ui/app-shell.js) with Log only, an in-memory store, Fusion mode always; none of the website's own parts is loaded.

import { download } from './download.js';
// Shared #core-backed sketcher (S1). Eager import so the page load exercises #ui/ + #core/ resolution;
// the mount itself runs only when the Design tab is first opened.
import { mountSketch } from '#ui/sketch-canvas.js';
import { sketchesSignature } from '#core/sketch-model.js';
import { drawingExtent } from '#core/geometry-bounds.js'; // TASK 879: the board with no Stock loop = the drawing's extent + the margin
import { checkOriginRules, formatOriginRuleWarning } from '#core/origin-rules.js'; // TASK 803: every exported file is checked against the Origin rules
import { exportEncoding } from './shaper.js'; // TASK 803: the cut types' encoding, injected into the check like the exporter's
import { createToolRibbon } from '#ui/tool-ribbon.js';
import { DESIGN_CANVAS_ID, DESIGN_CANVAS_OPTIONS, RIBBON_OPTIONS, shaperBufferOptions, applyShaperUnitDefault } from './design-canvas.js'; // TASK 569: the Design canvas setup, declared once (the node test kit reads it too)
import { createDiagnosticLog } from '#ui/diagnostic-log.js'; // DIAG-OVERLAY: mobile-usable log + Copy Report
import { createShaperSession } from './shaper-session.js'; // TASK 605: a document tab's stage state, declared once (the node test kit builds it too)
import { createToolTableWindow } from './tool-table-window.js'; // TASK 842: the Tool table window (one per page)
import { createPrepareStage } from './prepare-stage.js'; // TASK 583: Prepare's wiring (view, cut card, cut-plan undo, keys, restore), declared once (the node test kit calls it too)
import { mountAppFooter } from '#ui/app-footer.js'; // TASK 618: Undo / Redo, Recenter in the footer
import { MODE_KEY, shaperStagesFor, resolveInitialMode, findViews, createModeRouter, createShaperHistory } from './modes.js'; // TASK 583 + 663: the mode router, declared once
import { FUSION_ACTIONS, mountFusionPrepareBar } from './fusion-bridge.js'; // TASK 663: Fusion mode & palette bridge
import { createFusionToolpathsSync } from './fusion-toolpaths.js'; // TASK 799: live toolpaths in Fusion
import { getSelections } from './selection-list.js'; // TASK 795 / 799: selections and their 3D frames
import { removeSelection, clearSelections } from './selection-edit.js'; // TASK 795: the selection list's X and Clear all
import { importFusionSelection } from './fusion-import.js'; // TASK 664: Fusion selection_data -> sketch + the plan + stock
import { dbg } from '#core/debug.js';
import { mountReviewView, LOOKS, normaliseLook } from './review-view.js';   // TASK 459: the 3D Review (three loads only when the tab first opens)
import { getStock, resolveStock } from './stock.js'; // TASK 459: the declared stock (persisted by shaper-doc.js, TASK 460)
import { createStockCard } from './stock-card.js'; // TASK 583: the Review card's stock thickness field, declared once (the node test kit calls it too)
import { mountDisclosure, CARET_SVG } from './disclosure.js'; // TASK 880: the Export view's Cuts card folds as the Operations sheet does
import { bindTemplateTokens } from '#ui/style-templates.js';
import { followDesign, planEntries, planReliefItems, planNotes } from './cut-plan.js'; // SP1j-4: the shared cut-plan store; TASK 839: planNotes = the Review's info lines (stepped, hold, clearing, levels)
import { exportFileName, exportTickLine, exportWhenGenerated, whenGenerated, tickedSetKey } from './export-payload.js';  // SP1j / TASK 718: the ONE exporter call (the download and the 2D preview copy); TASK 743: the preview copy + its operations; TASK 767: the file's name; TASK 817: made in the background
import { setPathsPort, workerPort } from './op-paths.js'; // TASK 817: the operations' paths are generated in the background (paths-worker.js)
import { storeSignature } from './operations-store.js'; // TASK 743 / S1: the operations store (the 2D view and the 3D Review rebuild when it changes)
import { describeOperations } from './operations.js'; // TASK 798: the Export step's line about unticked operations
import { mountExportPreview } from './export-preview.js'; // TASK 718: the Export step's 2D view of that file
import { mountExportSim } from './export-sim.js'; // TASK 801: the Export step's simulation (the Simulate panel over the view), one timeline for the three views
import { SIM } from './cut-timeline.js'; // TASK 801: its one line under the controls
import { showNotification } from '#ui/notification-manager.js'; // TASK 886 (owner turn 3649): the corner notice of an Autosend that succeeded
import { track } from '#ui/analytics.js'; // TASK 738: the ShaperHub upload, a Fusion selection received
import { UPLOAD_MODES } from '#core/shaper-cloud.js'; // TASK 884: the replace's mode (the request contract)
import { keepHubOn, setKeepHub, getHubTarget, setHubTarget, targetOfSend, autoSendDecision, keepSwitchView, createReplaceQueue, folderPlace } from './shaperhub-target.js'; // TASK 884: Keep ShaperHub up to date
import { readRememberedLogin, rememberLogin, hasSignIn } from './shaperhub-login.js'; // TASK 886: Remember login on this computer
import { SIDEBAR_ICONS } from '#ui/app-sidebar.js';
import { applyAppIdentity } from '#ui/app-registry.js'; // TASK 473: tab title + favicon from the registry
import { createStlImporter, STL_INSERT_MARKUP } from './stl-import.js'; // TASK 790: the STL card in Prepare; TASK 841: Insert STL (the Prepare toolbar's; the website's drawer adds Open / Insert STL)
import SettingsManager, { docUnit, isPrecisionKey } from '#core/settings-manager.js';
import { createGroupStatus } from './group-status.js'; // TASK 610: the one-line status toast over the Design view
import { hintLabel, hintText } from './param-hints.js'; // TASK 770: THE table of labels and hints (the Export step's cards)
import { bindHint, installHintTooltip } from './hint.js'; // TASK 805: the one tooltip at the cursor (hint.js); TASK 770: its texts are the table's
import { mountTooltip } from '#ui/hint.js';

// The running page's Export simulation and 3D view (null until they exist): read by the live tests through currentExportSim / currentReviewView.
const shown = { exportSim: () => null, reviewView: () => null };
export const currentExportSim = () => shown.exportSim();
export const currentReviewView = () => shown.reviewView();

/**
 * startShaperApp(page) — wires Shaper on this page, once. `page` DECLARES what differs (TASK 881):
 *   fusion                Fusion mode: Prepare + Export, the Fusion bar, the palette bridge, live toolpaths (TASK 663)
 *   mountChrome(decl)     -> the header + drawer ({ sidebar, setActiveStage }): decl = { appId, host, stages, activeStage, onStageChange, getBuffer, hostActions }
 *   createDocumentBuffer  the autosave loop's factory (#ui/document-buffer.js, or #ui/document-buffer-core.js with a store)
 *   bufferStore()         -> the loop's store at the first paint, or undefined (the page's shared store)
 *   menu(app)             -> the drawer's entries (app: what they call on this page, incl. app.logAction)
 *   beforeChrome()        the page's own start, before the header; afterChrome(chrome): its drawer views
 *   createImporter(ctx)   -> the SVG / DXF importer (cut-import.js) or null; mountDesignBrowser({ state, engine }) -> the SKETCHES browser or null
 *   createSettingsPanel() -> the Settings panel (the drawer's and the footer's gear) or null
 *   onDesignContext(ctx, app)  Fusion mode: the page's own work when Fusion names the current design
 */
export function startShaperApp({
  fusion = false,
  mountChrome,
  createDocumentBuffer,
  bufferStore = () => undefined,
  menu = (app) => [app.logAction],
  beforeChrome = () => {},
  afterChrome = () => {},
  createImporter = () => null,
  mountDesignBrowser = () => null,
  createSettingsPanel = () => null,
  onDesignContext = () => {},
}) {
  applyAppIdentity('shaper'); // TASK 473: tab title + favicon from the registry

  let designController = null; // sketcher mounted once, at boot (ensureSketch); RAF started while Design is active, paused otherwise (declared before the sidebar: the tab strip reads the buffer as it mounts)
  let docBuffer = null; // TASK 474: the autosave buffer / project actions of this app (created with the sketch in ensureSketch); the sidebar and the tab strip read it lazily

  // DIAG-OVERLAY: created at boot (not gated to Design mode) so it's reachable even if a bug hits
  // Prepare/Review — designController may not exist yet, so its state is read lazily.
  const _diagLog = createDiagnosticLog({ appId: 'shaper', state: () => designController && designController.state });

  const fusionMode = fusion; // TASK 663: Prepare + Export, the Fusion bar (TASK 881: declared by the page: main.js ?host=fusion, fusion-main.js always)
  // TASK 880 (owner turn 3484): the Export stage's three ways out are its HEADER actions (app-header.js buildStageAction; where the header hides, a phone, the drawer
  // lists them under the stage buttons), the same in Fusion mode. Labels and tooltips from the table (param-hints.js); the presses are the functions below.
  const SHAPERHUB_FILES_URL = 'https://hub.shapertools.com/my-files';
  const BOLT_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M9.2 1.5L3.5 9h4l-1 5.5L12.5 7h-4z" fill="#fbbf24"/></svg>';
  const EXTERNAL_ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.5 2.5h4v4M13.5 2.5L7.5 8.5M12 9.5v3.5a.5.5 0 0 1-.5.5h-8.5a.5.5 0 0 1-.5-.5V4.5a.5.5 0 0 1 .5-.5H6.5"/></svg>';
  const EXPORT_ACTIONS = [
    { id: 'btn-generate-svg', label: hintLabel('generateSvg'), icon: SIDEBAR_ICONS.download, variant: 'primary', data: { hint: 'generateSvg' }, onClick: () => generateShaperSvg() },
    { id: 'btn-sync-shaper', label: hintLabel('syncShaperHub'), icon: BOLT_ICON, variant: 'accent', data: { hint: 'syncShaperHub' }, onClick: () => openSyncDialog() },
    { id: 'link-shaper-hub', label: hintLabel('openShaperHub'), icon: EXTERNAL_ICON, href: SHAPERHUB_FILES_URL, data: { hint: 'openShaperHub' } },
  ];
  const activeStages = shaperStagesFor({ fusion: fusionMode }).map((s) => (s.id === 'review' ? { ...s, actions: EXPORT_ACTIONS } : s));
  let initMode = null;
  try { initMode = localStorage.getItem(MODE_KEY); } catch (err) { dbg.warn('shaper', 'MODE_KEY read failed', err && err.message); }
  beforeChrome(); // TASK 881: the page's own start (the website: the Google session probe, TASK 488; the old ShaperHub login's removal, TASK 758)
  initMode = resolveInitialMode(initMode, { fusion: fusionMode }); // modes.js: a stored 'simexport' (TASK 459) is Review; a stored 'explore' (TASK 706) or none: Design

  // TASK 881: what the page's own parts (its drawer entries, its importer, its design-context work) call on this page, declared once
  const app = {
    chrome: () => chrome,
    getController: () => designController,
    prepare: () => prepare,
    stlImporter: () => stlImporter,
    generateShaperSvgPayload: (opts) => generateShaperSvgPayload(opts),
    groupStatus: (text) => groupStatus(text),
    emptyExportText: () => emptyExportText(),
    designFileName: () => designFileName(),
    nameAfterSelection: (name) => nameAfterSelection(name),
    afterSelectionImport: () => afterSelectionImport(),
    settings: () => stylePanel,
    logAction: { id: 'log', label: 'Log', icon: SIDEBAR_ICONS.log, onClick: () => _diagLog.toggle() }, // DIAG-OVERLAY: the drawer's Log (every page)
  };

  const chrome = mountChrome({ // TASK 881: the page's header + drawer (the website: #ui/app-chrome.js with the project layer; the Fusion panel: #ui/app-shell.js)
    appId: 'shaper',
    host: fusionMode ? 'fusion' : 'web', // TASK 738: the analytics tell the Fusion 360 palette from the website
    stages: activeStages,
    activeStage: initMode,
    onStageChange: (mode) => showMode(mode),
    getBuffer: () => docBuffer,
    hostActions: menu(app), // TASK 881: the page's drawer entries
  });

  afterChrome(chrome); // TASK 881: the page's own drawer views (the website: the Fusion add-in download view, TASK 733)

  // TASK 817 (owner turns 2745-2748): the operations' paths (and the Shaper file) are generated in the BACKGROUND, in a module worker running the same derivation module
  // (op-derive.js) the node tests run in-process (op-paths.js): set before anything reads the plan
  setPathsPort(workerPort(new Worker(new URL('./paths-worker.js', import.meta.url), { type: 'module' })));
  const NO_CUTS = 'No cuts assigned — assign cut types in Prepare first.'; // the Export step's message with an empty plan (Generate, Download, the 2D view)
  // TASK 798: the message when the plan has operations but none is ticked (Generate, Download, Send to ShaperHub)
  const NOTHING_TICKED = "Every operation is unticked: tick one in Prepare's Operations list to export it.";
  const emptyExportText = () => (planEntries().length ? NOTHING_TICKED : NO_CUTS);
  const TICKED = Object.freeze({ ticked: true }); // TASK 798: the ticked operations (cut-plan.js planEntries' one filter)

  // SP1j-4: the Sim/Export tab → serialize the Prepare cut plan + the design into a machine-ready Shaper Origin SVG and
  // download it. Encoding INJECTED (the app's CUT_TYPES) so #core/shaper-export stays app-agnostic; docUnit from settings.

  // TASK 718: `preview: true` = the 2D view's copy of the same file (export-payload.js: plus its preview-only data-* attributes) and (TASK 743) the operations it lists
  // TASK 798: the file holds the TICKED operations (planEntries({ ticked: true })), on the WHOLE design's page and with its hole ownership (`frame`: every operation):
  // every export lines up on the Origin (one SVG = the ticked operations; owner ruling turn 2537)
  // TASK 817: the file waits for every operation whose paths are being generated (`say` = where the plain waiting line goes: "Waiting for 2 operations to finish"), then
  // it is made in the background too (export-payload.js exportFileInBackground): never a stale or partial file
  async function generateShaperSvgPayload({ preview = false, say = () => {} } = {}) {
    if (!planEntries(TICKED).length) return null;
    ensureSketch();
    try { designController.engine.solve(500); } catch (_) { /* best-effort solve before export */ }
    const st = designController.state;
    const p = await exportWhenGenerated(st, { preview, say, recalculate: (ids) => prepare.recalculate(ids) }); // TASK 798: the ticked operations on the whole design's frame (export-payload.js, declared once); TASK S3: an out-of-date operation waits for Recalculate
    if (!p) return null;
    // TASK 803: every file that leaves the app (Generate, Download, Send to ShaperHub) is checked against the Origin rules (#core/origin-rules.js); a broken rule is a short warning, the file is still allowed
    const warning = preview ? '' : formatOriginRuleWarning(checkOriginRules(p.svg, { targets: ['origin', 'studio'], encoding: exportEncoding() }));
    return { ...p, state: st, warning };
  }
  // TASK 817: the plain waiting line in an element, after a turning ring (index.html .sk-wait-spin)
  // TASK S3: a line with an ACTION (the out-of-date operations' "Recalculate": { label, run }) is the text and the action's button, no ring (nothing is generating yet)
  const sayIn = (el) => (text, action = null) => {
    if (!el) return;
    if (action) { const b = document.createElement('button'); b.type = 'button'; b.className = 'sk-wait-action'; b.textContent = action.label; b.addEventListener('click', () => action.run()); el.replaceChildren(`${text}. `, b); return; }
    const spin = document.createElement('span'); spin.className = 'sk-wait-spin'; spin.setAttribute('aria-hidden', 'true'); el.replaceChildren(spin, text);
  };

  // TASK 767: the name of every file the Export step produces (Generate Shaper SVG, the sidebar Download, the Sync dialog's file name): the design's name
  // through the ONE rule (export-payload.js exportFileName). The design's name is the document tab's (in Fusion mode: the imported selection's, nameAfterSelection).
  const designFileName = () => exportFileName(docBuffer ? docBuffer.designName() : null);

  // TASK 805: the Export step's labels come from the table (param-hints.js); each label, and each Export action, shows its hint in the ONE tooltip at the cursor
  // (hint.js installHintTooltip: every element with data-hint). TASK 880: the side panel is gone: its labels are the Cuts card's and the footer settings' (the actions
  // carry their own label: EXPORT_ACTIONS); the thickness label is bound by the stock card below (its hint says what the board is).
  for (const e of document.querySelectorAll('#shaper-sync-modal [data-label]')) e.textContent = hintLabel(e.dataset.label);
  for (const e of document.querySelectorAll('#review-cards [data-hint], #review-settings [data-hint]:not(#review-stock-label), #review-sim [data-hint]:not(.sim-icon), #review-sim-toggle [data-hint], #prepare-dir-legend [data-hint], #sync-browser [data-hint], #shaper-sync-modal [data-hint]')) { if (!e.hasAttribute('data-label')) bindHint({ el: e }); } // a button's text is its data-label's (the loop above); only the labels are bound here (TASK 801: the Simulate panel's texts and its toggle's name take their label here too, from the table; its icon buttons keep their icons: their hint is the tooltip only)
  installHintTooltip(document);
  for (const b of document.querySelectorAll('#review-toolbar [data-hint]')) {
    const id = b.dataset.hint;
    mountTooltip({ target: b, getContent: () => ({ title: hintLabel(id), text: hintText(id) }) });
  }
  let generateCall = 0; // TASK S3: a press waiting for out-of-date operations is replaced by a later press (one file after the Recalculate)
  // Generate Shaper SVG (TASK 880: the Export stage's header action): the file downloads, the Export view's status line says what was written
  // TASK 884: with "Keep ShaperHub up to date" on, a target (the design was sent once) and a sign-in this session, the same file then REPLACES the target on
  // ShaperHub (hubQueue: one at a time, the latest waiting); its result is the end of the status line (a span of its own). Nothing else sends it.
  async function generateShaperSvg() {
    const status = document.getElementById('simexport-status');
    const call = ++generateCall;
    const payload = await generateShaperSvgPayload({ say: sayIn(status) }); // TASK 817: waits for the paths being generated
    if (call !== generateCall) return;
    if (!payload) { status.textContent = emptyExportText(); return; }
    const name = designFileName();
    download(name, payload.svg);
    const n = payload.entries.length;
    // built from nodes (TASK 767): the file name is the design's, text only
    const file = document.createElement('strong');
    file.textContent = name;
    const setKey = tickedSetKey(); // the ticked operations this file holds: only THEIR target is replaced (a set never sent stays local until a Send)
    const target = getHubTarget(setKey);
    const decision = autoSendDecision({ on: keepHub(), target, signedIn: signedIn() });
    if (decision === 'send') {
      const line = document.createElement('span');
      status.replaceChildren(`Exported ${n} cut${n === 1 ? '' : 's'} → `, file, '. ', line);
      sayIn(line)(`Replacing ${target.filename} in ${folderPlace(target.remotePath)}...`);
      hubQueue.push(setKey, { svg: payload.svg, target, line });
    } else {
      const hub = document.createElement('a');
      Object.assign(hub, { href: SHAPERHUB_FILES_URL, target: '_blank', rel: 'noopener noreferrer', textContent: 'ShaperHub (My Files)' });
      hub.style.cssText = 'color:var(--sk-selection,#4c9aff); text-decoration:underline;';
      status.replaceChildren(`Exported ${n} cut${n === 1 ? '' : 's'} → `, file, '. Drop it into ', hub, ' to sync with Origin.');
      if (decision === 'no-login') status.append(` ${hintText('keepHubSignIn')}`); // the switch is on but this session has no sign-in: the file there is not the new one
    }
    if (payload.warning) status.append(` ${payload.warning}`); // TASK 803
  }

  // Direct ShaperHub cloud sync (Wi-Fi sync to Origin) + in-memory session token & folder browser (TASK 772)
  const syncModal = document.getElementById('shaper-sync-modal');
  const syncForm = document.getElementById('sync-modal-form');
  const syncEmail = document.getElementById('sync-email');
  const syncPassword = document.getElementById('sync-password');
  const syncFormFields = document.getElementById('sync-creds');
  const syncSessionBar = document.getElementById('sync-session');
  const syncSwitchBtn = document.getElementById('sync-btn-switch');
  const syncBrowseBtn = document.getElementById('sync-btn-browse');
  const syncRefreshBtn = document.getElementById('sync-btn-refresh');
  const syncNewFolderBtn = document.getElementById('sync-btn-new-folder');
  const syncBreadcrumbs = document.getElementById('sync-breadcrumbs');
  const syncMkdirRow = document.getElementById('sync-mkdir-row');
  const syncMkdirName = document.getElementById('sync-mkdir-name');
  const syncMkdirOk = document.getElementById('sync-mkdir-ok');
  const syncMkdirCancel = document.getElementById('sync-mkdir-cancel');
  const syncFolderList = document.getElementById('sync-folder-list');
  const syncFilename = document.getElementById('sync-filename');
  const syncStatus = document.getElementById('sync-modal-status');
  const syncCloseBtn = document.getElementById('sync-modal-close');
  const syncCancelBtn = document.getElementById('sync-btn-cancel');
  const syncSubmitBtn = document.getElementById('sync-btn-submit');
  const syncActions = document.getElementById('sync-actions');
  // TASK 767: the question when the name is already in My Files (index.html #sync-exists): Replace it / Keep both / Cancel
  const syncExists = document.getElementById('sync-exists');
  const syncReplaceBtn = document.getElementById('sync-btn-replace');
  const syncKeepBothBtn = document.getElementById('sync-btn-keep-both');
  const syncExistsCancelBtn = document.getElementById('sync-btn-exists-cancel');
  // TASK 884: "Keep ShaperHub up to date" (index.html #sync-keep-updated) and the line under it
  const syncKeep = document.getElementById('sync-keep-updated');
  const syncKeepHint = document.getElementById('sync-keep-hint');
  // TASK 886: "Remember login on this computer" (index.html #sync-remember-login) and the line under it (what it keeps, and where)
  const syncRemember = document.getElementById('sync-remember-login');
  document.getElementById('sync-remember-hint').textContent = hintText('rememberLogin');

  const LOGIN_HINT = 'Check the password: your browser may have filled in a saved one.'; // TASK 767: under Shaper's own words when it refuses the sign-in

  // TASK 772: auth JWT held strictly in page RAM for this tab only (never storage/cookies/DOM/logs; Task 758 stays intact).
  let sessionToken = null;
  // TASK 886: the form was filled at start from the login kept on this computer (shaperhub-login.js), and not changed or refused since: it counts as signed in
  // (signedIn below) though this page has no session token yet; the next request (any Sync action, or a Generate's replace) carries it and gets one.
  let rememberedInForm = false;
  try {
    const kept = readRememberedLogin(localStorage);
    if (kept) {
      syncEmail.value = kept.email;
      syncPassword.value = kept.password;
      rememberedInForm = true;
    }
  } catch (err) { dbg.warn('shaper', 'reading the remembered ShaperHub login failed', err && err.message); } // its message only (shaperhub-login.js: never the content)
  syncRemember.checked = rememberedInForm; // off by default: on only while a login is kept
  // ticked + a sign-in that just succeeded with the form's login: kept; unticked (or `signOut`, Switch account): deleted. ONE place, for every page that runs this.
  function keepRememberedLogin({ signOut = false } = {}) {
    const remember = syncRemember.checked && !signOut;
    const login = remember && signedIn() ? { email: syncEmail.value.trim(), password: syncPassword.value } : null;
    try { rememberLogin(localStorage, remember, login); } catch (err) { dbg.warn('shaper', 'keeping the ShaperHub login on this computer failed', err && err.message); }
  }
  let currentRemotePath = '/';
  let folderState = { loaded: false, path: '/', folders: [], files: [] };
  // TASK 774: the folder the open "already in My Files" question is about ({ path }: the folder the server answered for), or null; Replace it / Keep both
  // go to THAT folder. While a send runs or the question is open, the folder browser does not move (navLocked): every way to another folder is disabled
  // (the rows, the breadcrumbs, Browse / Refresh / New folder) and openRemoteFolder refuses; an answer or Cancel unlocks it.
  let pendingQuestion = null;
  let sendBusy = false;
  const navLocked = () => sendBusy || !!pendingQuestion;
  function applyNavLock() {
    const locked = navLocked();
    for (const b of [syncBrowseBtn, syncRefreshBtn, syncNewFolderBtn, syncMkdirOk]) if (b) b.disabled = locked;
    for (const b of [...(syncBreadcrumbs ? syncBreadcrumbs.querySelectorAll('button[data-path]:not([aria-current])') : []), ...(syncFolderList ? syncFolderList.querySelectorAll('button.sync-entry') : [])]) b.disabled = locked;
    if (locked && syncMkdirRow) syncMkdirRow.hidden = true;
  }

  function applySessionUi() {
    const authed = !!sessionToken;
    if (syncSessionBar) syncSessionBar.hidden = !authed;
    if (syncFormFields) syncFormFields.hidden = authed;
    if (syncEmail) syncEmail.required = !authed;
    if (syncPassword) syncPassword.required = !authed;
    if (syncRefreshBtn) syncRefreshBtn.hidden = !authed;
    if (syncNewFolderBtn) syncNewFolderBtn.hidden = !authed;
    if (!authed && syncMkdirRow) syncMkdirRow.hidden = true;
    showKeepSwitch(); // TASK 884: it can be changed only while signed in
  }

  // TASK 884: signed in = the login in the sign-in form, and a session token it got (the fields hold it until the page goes; a replace always carries it,
  // shaper-cloud.js THE REPLACE RULE) or, TASK 886, the form filled from the login kept on this computer. A reload (unless it is kept), Switch account, an
  // edit of the fields or a refused login ends it.
  // the device setting (shaperhub-target.js KEEP_HUB_KEY, localStorage like MODE_KEY / REVIEW_VIEW_KEY): storage blocked = off
  const keepHub = () => { try { return keepHubOn(localStorage); } catch (err) { dbg.warn('shaper', 'KEEP_HUB_KEY read failed', err && err.message); return false; } };
  const signedIn = () => hasSignIn({ session: !!sessionToken, remembered: rememberedInForm, email: syncEmail.value, password: syncPassword.value });
  function showKeepSwitch() {
    if (!syncKeep) return;
    const v = keepSwitchView({ on: keepHub(), signedIn: signedIn(), target: getHubTarget(tickedSetKey()) }); // the target of the operations ticked now
    syncKeep.checked = v.checked;
    syncKeep.disabled = v.disabled;
    syncKeepHint.textContent = v.hint;
  }
  if (syncKeep) syncKeep.addEventListener('change', () => {
    try { setKeepHub(localStorage, syncKeep.checked); } catch (err) { dbg.warn('shaper', 'KEEP_HUB_KEY write failed', err && err.message); } // shown as it is stored (below)
    showKeepSwitch();
  });

  function clearSession() {
    sessionToken = null;
    rememberedInForm = false; // TASK 886: the kept copy itself stays (only unticking or Switch account deletes it)
    folderState = { loaded: false, path: currentRemotePath, folders: [], files: [] };
    applySessionUi();
    renderFolderBrowser();
  }

  // TASK 767: the dialog's status area: `lines` = its lines of text (each its own line, set as text), `tone` = '' | 'is-error' | 'is-success' | 'is-loading'
  function showSyncStatus(tone, ...lines) {
    syncStatus.className = 'sync-status' + (tone ? ' ' + tone : '');
    syncStatus.replaceChildren(...lines.map((t) => { const d = document.createElement('div'); d.textContent = t; return d; }));
  }
  // TASK 767: asking (the three choices shown, the dialog's Cancel / Send hidden) or not. TASK 774: `path` = the folder the question is about (the server's answer)
  function showExistsQuestion(on, path = '/') {
    syncExists.hidden = !on;
    syncActions.hidden = on;
    for (const b of [syncReplaceBtn, syncKeepBothBtn, syncExistsCancelBtn]) b.disabled = false;
    pendingQuestion = on ? { path } : null;
    applyNavLock();
  }

  function renderBreadcrumbs() {
    if (!syncBreadcrumbs) return;
    const segs = currentRemotePath.split('/').filter(Boolean);
    const crumbs = [{ label: 'My Files', path: '/' }];
    let acc = '/';
    for (const s of segs) {
      acc += `${s}/`;
      crumbs.push({ label: s, path: acc });
    }
    const nodes = [];
    crumbs.forEach((c, idx) => {
      if (idx > 0) {
        const sep = document.createElement('span');
        sep.className = 'sync-crumb-sep';
        sep.textContent = '/';
        nodes.push(sep);
      }
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sync-crumb';
      btn.textContent = c.label;
      btn.dataset.path = c.path;
      if (idx === crumbs.length - 1) {
        btn.setAttribute('aria-current', 'location');
      } else {
        btn.addEventListener('click', () => { openRemoteFolder(c.path); });
      }
      nodes.push(btn);
    });
    syncBreadcrumbs.replaceChildren(...nodes);
  }

  function renderFolderBrowser() {
    renderBreadcrumbs();
    if (!syncFolderList) return;
    if (!folderState.loaded) {
      const empty = document.createElement('div');
      empty.className = 'sync-browser-empty';
      empty.textContent = sessionToken
        ? 'Click Refresh to load folder contents.'
        : 'Sign in above or click Browse folders to view your ShaperHub folders (defaults to My Files).';
      syncFolderList.replaceChildren(empty);
      return;
    }
    const rows = [];
    if (currentRemotePath !== '/') {
      const segs = currentRemotePath.split('/').filter(Boolean);
      segs.pop();
      const parentPath = segs.length ? `/${segs.join('/')}/` : '/';
      const up = document.createElement('button');
      up.type = 'button';
      up.className = 'sync-entry is-up';
      up.dataset.path = parentPath;
      const icon = document.createElement('span'); icon.textContent = '↩';
      const nm = document.createElement('span'); nm.className = 'sync-entry-name'; nm.textContent = '.. (Up a folder)';
      up.append(icon, nm);
      up.addEventListener('click', () => { openRemoteFolder(parentPath); });
      rows.push(up);
    }
    for (const f of folderState.folders) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'sync-entry is-folder';
      row.dataset.folder = f.name;
      row.dataset.path = f.path;
      const icon = document.createElement('span'); icon.textContent = '📁';
      const nm = document.createElement('span'); nm.className = 'sync-entry-name'; nm.textContent = f.name;
      row.append(icon, nm);
      row.addEventListener('click', () => { openRemoteFolder(f.path); });
      rows.push(row);
    }
    for (const f of folderState.files) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'sync-entry is-file';
      row.dataset.file = f.name;
      if (syncFilename && syncFilename.value.trim() === f.name) row.classList.add('is-selected');
      const icon = document.createElement('span'); icon.textContent = '📄';
      const nm = document.createElement('span'); nm.className = 'sync-entry-name'; nm.textContent = f.name;
      row.append(icon, nm);
      row.addEventListener('click', () => {
        syncFilename.value = f.name;
        syncNameEdits.set(designKey(), f.name);
        showExistsQuestion(false);
        showSyncStatus('', '');
        renderFolderBrowser();
      });
      rows.push(row);
    }
    if (!rows.length) {
      const empty = document.createElement('div');
      empty.className = 'sync-browser-empty';
      empty.textContent = '(Empty folder)';
      rows.push(empty);
    }
    syncFolderList.replaceChildren(...rows);
    applyNavLock();
  }

  // ONE request path for /api/shaper-upload (TASK 758/772): serialises login credentials once here when no sessionToken is cached.
  // TASK 774: a Replace carries the form's login even with a token (shaper-cloud.js THE REPLACE RULE). `sentPassword`: the request carried a password
  // (only then can a 'login' refusal be a wrong password: the LOGIN_HINT).
  async function callShaperHub(payload) {
    const withLogin = !sessionToken || payload.mode === 'replace';
    const mail = withLogin ? (syncEmail ? syncEmail.value.trim() : '') : undefined;
    const pass = withLogin ? (syncPassword ? syncPassword.value : '') : undefined;
    const res = await fetch('/api/shaper-upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: mail, password: pass, token: sessionToken || undefined, session: true, ...payload }),
    });
    const data = await res.json().catch(() => ({ error: `The upload service answered ${res.status} without a result.`, kind: 'network' }));
    if (res.ok && !data.error && typeof data.token === 'string' && data.token) {
      sessionToken = data.token;
      applySessionUi();
    } else if (data && data.kind === 'login' && (sessionToken || rememberedInForm)) {
      clearSession(); // TASK 886: a kept login that is refused is no sign-in either (its line: uploadErrorLines, the LOGIN_HINT)
    }
    if (res.ok && !data.error) keepRememberedLogin(); // TASK 886: the form's login signed in: kept or deleted as the box says
    return { res, data, sentPassword: !!pass };
  }
  // the lines of a refused upload (the dialog's error, and TASK 884's replace on Generate): Shaper's words, and the LOGIN_HINT under a refused password
  const uploadErrorLines = (res, data, sentPassword) => [`Error: ${data.error || `Upload failed with status ${res.status}`}`, ...(data.kind === 'login' && sentPassword ? [LOGIN_HINT] : [])]; // TASK 774: an expired session is not a wrong password

  // TASK 884: the replace of the design's target after a Generate (shaperhub-target.js), through the ONE request path; its result in its own part of the Export
  // view's status line (`line`): the dialog's own words ("Replaced <name> in <place>", sentLine), or its error lines. One at a time: hubQueue.
  async function replaceHubTarget({ svg, target, line }) {
    let res, data, sentPassword;
    try {
      ({ res, data, sentPassword } = await callShaperHub({ filename: target.filename, svg, mode: UPLOAD_MODES.REPLACE, remotePath: target.remotePath }));
    } catch (err) {
      line.className = 'is-error';
      line.textContent = `Could not reach the upload service. Check your connection and try again. (${err.message})`;
      return;
    }
    if (!res.ok || data.error) {
      line.className = 'is-error';
      line.textContent = uploadErrorLines(res, data, sentPassword).join(' ');
      return;
    }
    track('export:shaperhub'); // TASK 738: an upload to ShaperHub, as the dialog's
    line.className = '';
    line.textContent = `✓ ${sentLine(data)}.`;
    // TASK 886, owner turn 3649 ("On generate, and little popup in corner notices success"): an owner-asked exception to "no toast for normal behaviour":
    // ONE success notice per Autosend replace that succeeded (never for the dialog's own Send, which shows its result in the dialog; a failure keeps the line above)
    showNotification(`Sent ${data.filename || target.filename} to ShaperHub (${folderPlace(data.remotePath || target.remotePath)})`, 'success');
  }
  const hubQueue = createReplaceQueue(replaceHubTarget);

  async function openRemoteFolder(path = currentRemotePath) {
    if (navLocked()) return; // TASK 774: a send or the "already in My Files" question is about the folder shown
    if (!sessionToken) {
      const e = syncEmail ? syncEmail.value.trim() : '';
      const p = syncPassword ? syncPassword.value : '';
      if (!e || !p) {
        showExistsQuestion(false);
        showSyncStatus('is-error', 'Please enter both email and password.');
        return;
      }
    }
    showSyncStatus('is-loading', `Loading ${folderPlace(path)}...`);
    if (syncBrowseBtn) syncBrowseBtn.disabled = true;
    if (syncRefreshBtn) syncRefreshBtn.disabled = true;
    let res, data, sentPassword;
    try {
      ({ res, data, sentPassword } = await callShaperHub({ action: 'list', remotePath: path }));
    } catch (err) {
      showSyncStatus('is-error', 'Could not reach the upload service. Check your connection and try again.', `(${err.message})`);
      return;
    } finally {
      applyNavLock(); // TASK 774: enabled again unless a send started meanwhile
    }
    if (navLocked()) return; // TASK 774: a send started while this folder loaded: it is about the folder shown, which stays
    if (!res.ok || data.error) {
      const lines = [`Error: ${data.error || `Could not open folder (${res.status})`}`];
      if (data.kind === 'login' && sentPassword) lines.push(LOGIN_HINT); // TASK 774: an expired session is not a wrong password
      showSyncStatus('is-error', ...lines);
      return;
    }
    currentRemotePath = data.path || path;
    folderState = { loaded: true, path: currentRemotePath, folders: data.folders || [], files: data.files || [] };
    if (syncMkdirRow) syncMkdirRow.hidden = true;
    showExistsQuestion(false);
    showSyncStatus('', '');
    renderFolderBrowser();
  }

  async function createSubfolder() {
    if (navLocked()) return; // TASK 774: as openRemoteFolder
    const folderName = syncMkdirName ? syncMkdirName.value.trim() : '';
    if (!folderName) {
      showSyncStatus('is-error', 'Enter a folder name.');
      if (syncMkdirName) syncMkdirName.focus();
      return;
    }
    showSyncStatus('is-loading', `Creating folder "${folderName}"...`);
    if (syncMkdirOk) syncMkdirOk.disabled = true;
    let res, data;
    try {
      ({ res, data } = await callShaperHub({ action: 'mkdir', remotePath: currentRemotePath, folderName }));
    } catch (err) {
      showSyncStatus('is-error', 'Could not reach the upload service. Check your connection and try again.', `(${err.message})`);
      return;
    } finally {
      if (syncMkdirOk) syncMkdirOk.disabled = false;
    }
    if (!res.ok || data.error) {
      showSyncStatus('is-error', `Error: ${data.error || `Folder could not be created (${res.status})`}`);
      return;
    }
    if (syncMkdirName) syncMkdirName.value = '';
    if (syncMkdirRow) syncMkdirRow.hidden = true;
    await openRemoteFolder(data.path || currentRemotePath);
  }

  if (syncSwitchBtn) syncSwitchBtn.addEventListener('click', () => { clearSession(); keepRememberedLogin({ signOut: true }); showExistsQuestion(false); showSyncStatus('', ''); if (syncSubmitBtn) syncSubmitBtn.disabled = false; if (syncEmail) syncEmail.focus(); }); // TASK 788: an open "already in My Files" question is about the account being left: it closes (Send, Browse usable again)
  if (syncBrowseBtn) syncBrowseBtn.addEventListener('click', () => { openRemoteFolder(currentRemotePath); });
  if (syncRefreshBtn) syncRefreshBtn.addEventListener('click', () => { openRemoteFolder(currentRemotePath); });
  if (syncNewFolderBtn) syncNewFolderBtn.addEventListener('click', () => {
    if (!syncMkdirRow) return;
    syncMkdirRow.hidden = !syncMkdirRow.hidden;
    if (!syncMkdirRow.hidden && syncMkdirName) { syncMkdirName.value = ''; syncMkdirName.focus(); }
  });
  if (syncMkdirCancel) syncMkdirCancel.addEventListener('click', () => { if (syncMkdirRow) syncMkdirRow.hidden = true; });
  if (syncMkdirOk) syncMkdirOk.addEventListener('click', () => { createSubfolder(); });
  if (syncMkdirName) syncMkdirName.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); createSubfolder(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (syncMkdirRow) syncMkdirRow.hidden = true; } // TASK 774: preventDefault: the dialog's own Escape (close) does not run
  });
  if (syncEmail) syncEmail.addEventListener('input', () => { if (sessionToken || rememberedInForm) clearSession(); }); // TASK 886: an edited kept login is a new one: signed in again only when it is sent
  if (syncPassword) syncPassword.addEventListener('input', () => { if (sessionToken || rememberedInForm) clearSession(); });
  syncRemember.addEventListener('change', () => { if (!syncRemember.checked) keepRememberedLogin(); }); // TASK 886: unticked: deleted now; ticked: kept at the next sign-in

  // TASK 767: the file name the user typed for a design, kept for THIS session only (page memory, never stored): the design = its document tab, its
  // stored id and its name (a reused Untitled tab that now holds another design starts from that design's own name)
  const syncNameEdits = new Map();
  const designKey = () => {
    const tab = docBuffer ? docBuffer.tabs().find((t) => t.active) : null;
    return JSON.stringify([tab ? tab.key : null, docBuffer ? docBuffer.designId() : null, docBuffer ? docBuffer.designName() : null, tickedSetKey()]); // TASK 884: + the ticked operations (a file of other ticks has its own name)
  };
  syncFilename.addEventListener('input', () => {
    syncNameEdits.set(designKey(), syncFilename.value);
    if (!syncExists.hidden) { showExistsQuestion(false); showSyncStatus(''); } // the question was about the name before the edit
  });

  let syncCloseTimer = null;
  function closeSyncModal() {
    if (syncModal && syncModal.open) syncModal.close();
  }

  if (syncModal) syncModal.addEventListener('close', () => clearTimeout(syncCloseTimer)); // TASK 788: any close (button, Escape, the timer itself) ends the timer of that opening
  if (syncCloseBtn) syncCloseBtn.addEventListener('click', closeSyncModal);
  if (syncCancelBtn) syncCancelBtn.addEventListener('click', closeSyncModal);

  // Sync to ShaperHub (TASK 880: the Export stage's header action): the Sync dialog, or the reason it has nothing to send in the Export view's status line
  function openSyncDialog() {
    const status = document.getElementById('simexport-status');
    const entries = planEntries(TICKED); // TASK 798: what the file will hold
    if (!entries.length) {
      status.textContent = emptyExportText();
      return;
    }
    const key = designKey();
    syncFilename.value = syncNameEdits.has(key) ? syncNameEdits.get(key) : designFileName(); // TASK 767: the design's name, or what was typed for it
    applySessionUi(); // TASK 884: and the Keep ShaperHub up to date switch, for this design
    renderFolderBrowser();
    showExistsQuestion(false);
    showSyncStatus('');
    if (syncSubmitBtn) syncSubmitBtn.disabled = false;
    if (syncModal && typeof syncModal.showModal === 'function') {
      syncModal.showModal();
    }
    if (sessionToken) openRemoteFolder(currentRemotePath);
  }

  // TASK 767 / 772: what the success line says (root preserves exact My Files wording; subfolders name their path). TASK 774: the folder of the server's answer
  const sentLine = (data) => {
    const place = folderPlace(data.remotePath || '/');
    return (data.status === 'replaced' ? `Replaced ${data.filename} in ${place}`
      : data.filename !== data.requested ? `Sent as ${data.filename}` : `Sent ${data.filename} to ${place}`);
  };

  // ONE send, for every press (Send = mode 'new'; the question's Replace it / Keep both = 'replace' / 'keep-both').
  // TASK 774: Send goes to the folder shown; Replace it / Keep both go to the folder the question is about (pendingQuestion.path).
  async function sendToShaperHub(mode) {
    if (sendBusy) return;
    const remotePath = mode === 'new' ? currentRemotePath : pendingQuestion ? pendingQuestion.path : null;
    if (remotePath == null) return;
    const payload = await generateShaperSvgPayload({ say: (t) => showSyncStatus('is-loading', t) }); // TASK 817: waits for the paths being generated
    if (!payload) {
      showSyncStatus('is-error', 'No cuts assigned in Prepare.');
      return;
    }
    const filename = syncFilename.value; // the function applies the name rule (shaper-cloud.js shaperFileName)
    const setKey = tickedSetKey(); // TASK 884: the ticked operations this file holds (the target this send makes is theirs)

    if (!sessionToken) {
      const e = syncEmail ? syncEmail.value.trim() : '';
      const p = syncPassword ? syncPassword.value : '';
      if (!e || !p) {
        showExistsQuestion(false);
        showSyncStatus('is-error', 'Please enter both email and password.');
        return;
      }
    }

    const targetPlace = folderPlace(remotePath);
    showSyncStatus('is-loading', mode === 'replace' ? `Replacing the file in ${targetPlace}...` : mode === 'keep-both' ? 'Sending a copy under a new name...' : sessionToken ? `Uploading to ${targetPlace}...` : 'Authenticating with Shaper and uploading...');
    if (syncSubmitBtn) syncSubmitBtn.disabled = true;
    for (const b of [syncReplaceBtn, syncKeepBothBtn, syncExistsCancelBtn]) b.disabled = true;

    let res, data, sentPassword;
    sendBusy = true;
    applyNavLock();
    try {
      ({ res, data, sentPassword } = await callShaperHub({ filename, svg: payload.svg, mode, remotePath }));
    } catch (err) {
      showExistsQuestion(false);
      showSyncStatus('is-error', 'Could not reach the upload service. Check your connection and try again.', `(${err.message})`);
      if (syncSubmitBtn) syncSubmitBtn.disabled = false;
      return;
    } finally {
      sendBusy = false;
      applyNavLock();
    }
    if (!res.ok || data.error) {
      showExistsQuestion(false);
      showSyncStatus('is-error', ...uploadErrorLines(res, data, sentPassword));
      if (syncSubmitBtn) syncSubmitBtn.disabled = false;
      return;
    }
    if (data.status === 'exists') { // nothing was uploaded: ask (TASK 767)
      const askedPath = data.remotePath || '/'; // TASK 774: the folder the server answered for (it names only a subfolder)
      showSyncStatus('', `${data.filename} is already in ${folderPlace(askedPath)}.`);
      showExistsQuestion(true, askedPath);
      syncExistsCancelBtn.focus(); // TASK 774: never the destructive Replace it: a second Enter must not overwrite unread
      return;
    }

    track('export:shaperhub'); // TASK 738
    showExistsQuestion(false);
    setHubTarget(setKey, targetOfSend(data, remotePath)); // TASK 884: this send is the target of these ticked operations now (Keep both: the name the server answered); saved with the design
    if (fusionUi) fusionUi.notifyProjectChanged(); // the Fusion design's project (the website's document is saved by its autosave)
    showKeepSwitch();
    const line = sentLine(data);
    showSyncStatus('is-success', line);
    const expStatus = document.getElementById('simexport-status');
    if (expStatus) expStatus.textContent = `✓ ${line}. It will now appear on your Origin over Wi-Fi.${payload.warning ? ` ${payload.warning}` : ''}`;
    // TASK 758: the app keeps the login only when the box says so (TASK 886, callShaperHub). Closing the dialog hides the form after the successful fetch: that is what tells the browser's
    // password manager the sign-in succeeded (it then offers to save it). The fields keep their values until the page goes (not cleared).
    syncCloseTimer = setTimeout(closeSyncModal, 1200); // TASK 788: ended when the dialog closes (below), so it only ever closes the opening it was started for
  }

  syncForm.addEventListener('submit', (e) => {
    e.preventDefault();
    sendToShaperHub('new');
  });
  syncReplaceBtn.addEventListener('click', () => sendToShaperHub('replace'));
  syncKeepBothBtn.addEventListener('click', () => sendToShaperHub('keep-both'));
  syncExistsCancelBtn.addEventListener('click', () => { // nothing is sent; the dialog stays open to change the name
    showExistsQuestion(false);
    showSyncStatus('', 'Nothing was sent. Change the file name and Send, or close.');
    if (syncSubmitBtn) syncSubmitBtn.disabled = false;
    syncFilename.focus();
  });

  // Shaper's one-line status toast over the Design view: the import's result, Prepare's notices, and the shared Design tab's own messages
  // (mountSketch notify below: Combine / Uncombine, TASK 756: Group / Ungroup, whose keys and menus are now the shared #ui/group-actions.js)
  const groupStatus = createGroupStatus(() => VIEWS.design); // TASK 610: group-status.js (the page and the node test kit both create it)

  // SKETCH/IMPORT-2 + TASK 478 + TASK 566: SVG / DXF IMPORT -> a NEW sketch, through the ONE shared importer (#ui/sketch-import.js), with Shaper's own options
  // declared in cut-import.js (TASK 583: each element's cut record, kept descIds, the cuts kept in the plan; the node test kit calls it too).
  // The entry is the sidebar's "Import SVG / DXF…" (project-actions.js, passed to mountProjectSidebar above); a drop anywhere on the page is the second way in
  // (TASK 706). Either one shows Design first (modes.js showDesign, declared to the shared importer).
  const shaperImporter = createImporter({ ensureSketch, getController: () => designController, getInfoPanel: () => infoPanel, notify: groupStatus, getDropHost: () => document.body, showDesign: () => modes.showDesign() }); // TASK 610: cut-import.js (TASK 881: the website's; null on a page without the import)

  // ── S6a: the app shell — a view router over Design / Prepare / Review. (modes.js: declared once, the node test kit calls it too) ──
  const VIEWS = findViews(document);
  let modes = null; // the mode router (created below, once the views it enters exist)

  let reviewView = null;       // TASK 459: the 3D Review (mounted on first entry, three imported dynamically)
  let showStockThickness = () => {}; // TASK 460: re-syncs the Review card's thickness field after a document restore (assigned below)
  // SP1c-f, TASK 463, TASK 472 (prepare-stage.js): the Prepare view, the cut-settings card, every cut-plan edit as ONE step of the shared history, the cut
  // plan in the sketch's undo snapshots, the Ctrl+Z / Ctrl+Y keys while Prepare shows, the one-line notice
  const history = createShaperHistory({ getController: () => designController, getMode: () => modes.current() }); // TASK 618
  const toolTableWindow = createToolTableWindow(); // TASK 842: saved in the settings store; the cut card follows a change through its settings subscription (prepare-stage.js)
  let fusionToolpaths = null; // TASK 799: set in fusionMode below; notified on every Prepare change
  let fusionUi = null; // TASK 806: set in fusionMode below; lets operation rows open Select in Fusion
  const prepare = createPrepareStage({
    getController: () => designController, getMode: () => modes.current(), history,
    panelEl: document.getElementById('prepare-panel'), canvasEl: document.getElementById('prepare-canvas'), noticeEl: document.getElementById('prepare-notice'), opsEl: document.getElementById('prepare-ops'), ribbonEl: document.getElementById('prepare-ribbon'), // TASK 743: the operations list; TASK S3: the operations toolbar
    ensureSketch, onViewChange: (v) => { window.__prepareView = v; }, // the page's dev / test seam
    // TASK 841: the toolbar's INSERT section, first: STL = Insert STL (the drawer's entry, the same import); a file that is not a readable STL is said in Prepare's notice
    leadGroups: [{ label: 'Insert', buttons: [{ id: 'prepare-insert-stl', label: hintLabel('insertStlTool'), hint: hintText('insertStlTool'),
      svg: `<svg class="sk-ribbon-ic" viewBox="0 0 18 18" fill="none" aria-hidden="true">${STL_INSERT_MARKUP}</svg>`, onClick: () => insertStlFromToolbar() }] }],
    openToolTable: () => toolTableWindow.open(), // TASK 842: the cut card's "Edit tool table..."
    onPlanChange: () => { if (fusionToolpaths) fusionToolpaths.notify(); if (fusionUi) fusionUi.notifyProjectChanged(); }, // TASK 799 / 855: automatic Fusion toolpath & project sync
    ...(fusionMode ? {
      onSelectInFusion: (op) => fusionUi && fusionUi.selectForOperation(op),
      showSelectInFusion: (op) => Boolean(fusionUi && fusionUi.canSelectForOperation(op)),
    } : {}),
  });
  async function insertStlFromToolbar() {
    try {
      const res = await stlImporter.pickAndInsert();
      if (res && !res.ok) prepare.notice(res.message, true); // cancelled (null): nothing; not a readable STL: the design is unchanged
    } catch (e) { prepare.notice(e.message || String(e), true); }
  }
  // TASK 664 / 790: what the page refreshes after a selection replaced the design (a Fusion selection, an STL): the Review card's thickness, the panels, the history buttons, the Review
  const afterSelectionImport = () => {
    showStockThickness();
    if (infoPanel) infoPanel.refresh();
    history.refresh();
    if (modes.current() === 'review') enterReview(designController.state);
    if (fusionToolpaths) fusionToolpaths.notify();
    if (fusionUi) fusionUi.notifyProjectChanged();
  };
  // TASK 790: Open STL (the drawer entry above) and the STL card at the top of Prepare's right column (stl-import.js, declared once: the node test kit calls it too)
  const stlImporter = createStlImporter({ ensureSketch, getController: () => designController, prepare, panelEl: document.getElementById('prepare-panel'),
    showPrepare: () => modes.showMode('prepare'), afterImport: afterSelectionImport, notice: (text, isError) => prepare.notice(text, isError),
    getView: () => (modes.current() === 'prepare' && prepare.view() ? prepare.view().view : designController.state.view) }); // TASK 841: an inserted STL lands in the view the user is looking at

  applyShaperUnitDefault(); // U3b (design-canvas.js, declared once: the node test kit calls it too)

  // U3b: the shared style-panel as a menu-opened MODAL; its Units tab holds the one document-unit control (TASK 881: the page's Settings; null on a page without them).
  const stylePanel = createSettingsPanel();
  bindTemplateTokens(document.getElementById('design-canvas'));

  let browser = null, infoPanel = null, ribbon = null, lastSig = '';

  // Refresh the Design ribbon + info panel when the sketch changes (active tool / constraint count / values /
  // selection). Called each render frame via mountSketch's onRender hook; the signature check keeps it cheap. Since
  // the sig includes currentTool, a KEYBOARD tool-switch refreshes the ribbon's .active too (not just ribbon clicks).
  function panelTick() {
    if (!designController) return;
    const s = designController.state;
    let vsum = 0; for (const c of s.constraints) if (typeof c.value === 'number') vsum += c.value;
    // Include shapes/joints counts so DRAWING geometry (which may add no constraint) still refreshes the DOF readout.
    const nShapes = (s.shapes && s.shapes.length) || 0;
    const nJoints = (s.joints && s.joints.size) || 0;
    const sig = s.constraints.length + ':' + nShapes + ':' + nJoints + ':' + vsum.toFixed(1) + ':' + (s.selectedConstraints ? s.selectedConstraints.size : 0) + ':' + s.currentTool + ':' + sketchesSignature(s);
    if (sig !== lastSig) { lastSig = sig; if (ribbon) ribbon.refresh(); if (infoPanel) infoPanel.refresh(); }
  }

  // Build the Design UI ONCE (S7b): a full-width SketchStudio-style tool ribbon on TOP (#design-ribbon) and the canvas below it, with the
  // SKETCHES browser (shared, #ui/design-browser.js, task 586) floating over the canvas's top-left. Shaper's Design tab has no other panel.
  function buildDesignUI() {
    const { state, engine } = designController;
    browser = mountDesignBrowser({ state, engine }); // shaper-browser.js (TASK 881: the website's; null on a page without the Design view's browser)
    if (browser) {
      browser.toggleEl.style.display = 'none'; // shown only while Design is the active mode (showMode below)
      infoPanel = browser.panel;
    }
    ribbon = createToolRibbon({
      state,
      ...RIBBON_OPTIONS, // design-canvas.js
      notify: groupStatus,
    });
    ribbon.render(document.getElementById('design-ribbon'));

    if (shaperImporter) shaperImporter.mountDrop(); // a drop anywhere on the page (the menu entry is mounted with the sidebar)
  }

  // Mount the shared sketcher ONCE. isActive is tied to the ACTIVE MODE (R-COEXIST), not just design-view
  // visibility, so the input layer's document listeners no-op unless Design is the current mode.
  function ensureSketch() {
    if (designController) return;
    designController = mountSketch(document.getElementById(DESIGN_CANVAS_ID), {
      isActive: () => modes.current() === 'design',
      onRender: panelTick, // S5c/S6b/S7b: refresh the ribbon + info panel on change, in sync with the render loop
      ...DESIGN_CANVAS_OPTIONS, // design-canvas.js: seedDemo false (the autosave buffer decides), the shared grid, profiles
      notify: groupStatus,
    });
    window.__designController = designController; // for test/evidence inspection
    designController.state.hostSnapshot = prepare.hostSnapshot; // TASK 463: the cut plan rides in the shared undo snapshots
    buildDesignUI();

    // PERSIST-2: restore the shared cross-app document (if any) before the RAF loop's first solve, then
    // keep autosaving. The save state is the document tab's dot (TASK 605); a failed save also shows in the menu's status line.
    // design-canvas.js shaperBufferOptions: the restore (solve, frame, the views below, then the cut plan + stock sidecar), the sidecar, the tab's stage state
    docBuffer = createDocumentBuffer(shaperBufferOptions({
      controller: designController, canvas: document.getElementById(DESIGN_CANVAS_ID),
      store: bufferStore(), // TASK 855c: decided at the first paint (TASK 881: the page's store; undefined = the page's shared store)
      session: createShaperSession({ prepare }), // shaper-session.js: Prepare selection + view
      showDesign: () => modes.showDesign(), // TASK 706: a design the user opens (new / Open / Open from file) is shown in Design
      refreshViews: () => { if (infoPanel) infoPanel.refresh(); },
      // re-mount Prepare if it is the visible mode so it shows the restored geometry + cuts
      afterSidecar: (restore) => {
        prepare.afterRestore(restore); // TASK 741: + the one-time notice of a document that had V-carve regions
        stlImporter.reimportOld(); // TASK 807: a design saved with an STL before 807 is sliced again as a relief
        showStockThickness();
        if (modes.current() === 'review') enterReview(designController.state);
      },
    }));
    docBuffer.restore();
    docBuffer.start();
  }


  // The view router (modes.js): show the active mode's container, hide the rest, drive the Design RAF lifecycle, persist the active mode.
  modes = createModeRouter({
    views: VIEWS, stages: activeStages, defaultMode: activeStages[0].id,
    onActiveChange: (mode) => chrome.setActiveStage(mode), getController: () => designController, ensureSketch,
    afterShow: (mode) => { if (mode !== 'review') exportSim.pause(); if (mode !== 'prepare') prepare.leave(); history.refresh(); if (browser) { if (mode !== 'design') browser.close(); browser.toggleEl.style.display = (mode === 'design') ? '' : 'none'; } }, // task 586/623: the Sketches button shows only on Design; TASK S2: leaving Prepare = OK on the open operation
    enter: {
      prepare: prepare.enter,
      review: () => {
        ensureSketch();
        try { designController.engine.solve(500); } catch (_) {}
        followDesign(designController.state); // TASK 832: the operations follow the Design edits made since (cut-plan.js)
        enterReview(designController.state);
      },
    },
  });
  const showMode = modes.showMode;
  mountAppFooter({
    router: history,
    view: () => (designController && modes.current() === 'design' ? { svg: designController.svg, state: designController.state } : null),
    settings: stylePanel, // TASK 726: the gear at the footer's right end (also in Fusion mode)
    controls: [{ el: document.getElementById('review-settings'), stage: 'review', label: 'Board settings' }], // TASK 880: the Export stage's Thickness and Material (also in Fusion mode)
  }); // TASK 618/619: Recenter on Design

  // TASK 459: Review = the finished workpiece in 3D, built only from the Prepare cut plan + the declared stock.
  const reviewInputs = (st) => {
    // TASK 879: the design's bounds are THE DRAWING'S EXTENT (#core/geometry-bounds drawingExtent: each shape by what it draws, never an arc's centre joint or the
    // origin: a part far from its arcs' centres made a board from the origin to the part). TASK 757: an EMPTY design (nothing drawn) has none, so no board.
    return { stock: resolveStock(st).stock, items: planReliefItems(st, TICKED), bounds: drawingExtent(st), notes: planNotes(st, TICKED) }; // TASK 798: the ticked operations // TASK 714: notes = the stepped cuts' steps / undercuts; TASK 742: the held cuts' passes / gaps; TASK 745: the programmed pockets' clearing; TASK 839: assembled in ONE place (cut-plan.js planNotes: a line the same for every operation once)
  };
  const reviewSig = (st) => JSON.stringify([storeSignature(), getStock(), [...st.joints.values()].map((j) => [j.x, j.y]), docUnit(),
    SettingsManager.get('LENGTH_PRECISION'), SettingsManager.get('ANGLE_PRECISION'), SettingsManager.get('TRAILING_ZEROS'), SettingsManager.get('INCH_DISPLAY'), SettingsManager.get('LENGTH_FRACTION')]); // TASK 714 / 743 / 770: rebuilds on doc unit, precision or trailing-zeros change
  // TASK 718: the Export step's view: '3d' (the board above), '2d' (the exported file, export-preview.js) or (TASK 793) 'paths' (every path written + the bit-centre
  // paths, the same module), remembered per app like the stage (MODE_KEY)
  const REVIEW_VIEW_KEY = 'shaper-review-view';
  let reviewViewMode = '3d';
  try { const v = localStorage.getItem(REVIEW_VIEW_KEY); if (v === '2d' || v === 'paths') reviewViewMode = v; } catch (err) { dbg.warn('shaper', 'REVIEW_VIEW_KEY read failed', err && err.message); }
  // TASK 729: the 3D board's look (review-view.js LOOKS + each colour-taking look's own colour), remembered per app the same way
  const REVIEW_LOOK_KEY = 'shaper-review-look';
  let reviewLook = normaliseLook(null);
  try { const s = localStorage.getItem(REVIEW_LOOK_KEY); if (s) reviewLook = normaliseLook(JSON.parse(s)); } catch (err) { dbg.warn('shaper', 'REVIEW_LOOK_KEY read failed', err && err.message); }
  let reviewCall = 0;
  const preview2d = { sig: null, value: null }; // TASK 817: the 2D / Paths view's file (made in the background) and the Review signature it was made for
  // TASK 801: the preview copy of the plan `sig`, made ONCE for every reader (the 2D / Paths view, the simulation's timeline): a reader that asks while it is being made
  // waits for the same job, and the job's waiting / out-of-date line (export-payload.js whenGenerated) is said to every reader's `say` (a reader that joins later is told
  // the line said last)
  let previewJob = null; // { sig, promise, says, last }
  function previewCopy(sig, say) {
    if (preview2d.sig === sig) return Promise.resolve(preview2d.value);
    if (previewJob && previewJob.sig === sig) {
      previewJob.says.add(say);
      if (previewJob.last) say(...previewJob.last);
      return previewJob.promise;
    }
    const job = { sig, says: new Set([say]), last: null };
    previewJob = job;
    job.promise = generateShaperSvgPayload({ preview: true, say: (text, action) => { job.last = [text, action]; for (const s of job.says) s(text, action); } }).then((p) => {
      const value = p ? { svg: p.svg, ops: p.ops, bitPaths: p.bitPaths, simElements: p.simElements } : null;
      if (previewJob === job) { preview2d.value = value; preview2d.sig = sig; previewJob = null; }
      return value;
    });
    return job.promise;
  }
  { // TASK 880: the Cuts card floats over the 2D / Paths view: its title folds it (disclosure.js)
    const head = document.getElementById('review-cuts-head');
    head.insertAdjacentHTML('beforeend', CARET_SVG);
    mountDisclosure({ host: document.getElementById('review-cuts'), head, body: document.getElementById('review-cuts-list') });
  }
  const exportPreview = mountExportPreview({
    canvas: document.getElementById('review-2d-canvas'), list: document.getElementById('review-cuts-list'), info: document.getElementById('review-2d-info'), emptyText: NO_CUTS,
    getPreview: () => preview2d.value, // TASK 743: + the operations (display only); TASK 793: + the bit-centre paths (the Paths view); TASK 817: made in the background before the refresh (enterReview)
  });
  // TASK 801: the Simulate panel (export-sim.js): its timeline from the same preview copy, the 3D wood from the finished part's relief items (the ticked operations)
  const simEl = (id) => document.getElementById(id);
  document.getElementById('sim-note').textContent = SIM.note;
  const exportSim = mountExportSim({
    els: { card: simEl('review-sim'), toggle: simEl('review-sim-toggle'), moreToggle: simEl('sim-more-toggle'), more: simEl('sim-more'), op: simEl('sim-op'), previewSel: simEl('sim-preview-sel'), previewAll: simEl('sim-preview-all'), reset: simEl('sim-reset'), play: simEl('sim-play'), prev: simEl('sim-prev'), next: simEl('sim-next'),
      scrub: simEl('sim-scrub'), speed: simEl('sim-speed'), animate: simEl('sim-animate'), passes: simEl('sim-passes'), passesRow: simEl('sim-passes-row'), label: simEl('sim-label') },
    ensure: (sig, say) => previewCopy(sig, say),
    reliefItems: () => planReliefItems(designController.state, TICKED),
    mode: () => reviewViewMode, flat: exportPreview, solid: () => reviewView,
    reducedMotion: typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches,
  });
  shown.exportSim = () => exportSim; // read by the live tests through currentExportSim (above this function), as currentReviewView
  function showReviewViewMode() {
    const is2d = reviewViewMode !== '3d'; // TASK 793: 2D and Paths are the one flat view (export-preview.js), drawn two ways
    exportPreview.setMode(reviewViewMode === 'paths' ? 'paths' : '2d');
    for (const id of ['review-canvas-host', 'review-info', 'review-reset', 'review-top', 'review-look']) document.getElementById(id).hidden = is2d; // the 3D view's own parts
    for (const id of ['review-2d', 'review-cuts']) document.getElementById(id).hidden = !is2d;
    for (const b of document.querySelectorAll('#review-view-switch button')) b.setAttribute('aria-pressed', b.dataset.view === reviewViewMode ? 'true' : 'false');
  }
  showReviewViewMode();
  for (const b of document.querySelectorAll('#review-view-switch button')) {
    b.addEventListener('click', () => {
      if (b.dataset.view === reviewViewMode) return;
      reviewViewMode = b.dataset.view;
      try { localStorage.setItem(REVIEW_VIEW_KEY, reviewViewMode); } catch (err) { dbg.warn('shaper', 'REVIEW_VIEW_KEY write failed', err && err.message); }
      showReviewViewMode();
      if (fusionUi) fusionUi.notifyProjectChanged();
      enterReview(designController.state);
    });
  }
  // TASK 798: the Export step's one line while an operation is unticked (export-payload.js exportTickLine; empty and hidden when everything is ticked)
  function showTickLine(st) {
    const el = document.getElementById('simexport-ticked');
    if (!el) return;
    el.textContent = exportTickLine(describeOperations(st));
    el.hidden = !el.textContent;
  }
  async function enterReview(st) {
    showTickLine(st);
    const call = ++reviewCall; // TASK 817: the last call wins (the views wait for the paths being generated and for the file made in the background)
    exportSim.refresh(reviewSig(st)); // TASK 801: the simulation's timeline of this plan (the same preview copy; until it is there, or while an operation is out of date, no run)
    if (reviewViewMode !== '3d') { // TASK 718: the same trigger rebuilds the 2D view
      showStockThickness();
      const sig = reviewSig(st);
      if (sig !== preview2d.sig) {
        await previewCopy(sig, sayIn(document.getElementById('review-2d-info'))); // TASK 801: the one job (the simulation reads the same copy)
        if (call !== reviewCall) return;
      }
      exportPreview.refresh(sig);
      exportSim.render(); // TASK 801: the simulation shown in this view
      return;
    }
    const info = document.getElementById('review-info');
    await whenGenerated(st, sayIn(info), { recalculate: (ids) => prepare.recalculate(ids) }); // TASK 817: the 3D board is built from the generated paths (TASK S3: never out-of-date ones)
    if (call !== reviewCall) return;
    try {
      if (!reviewView) {
        info.textContent = 'Loading 3D…';
        reviewView = await mountReviewView({ host: document.getElementById('review-canvas-host'), info, getInputs: () => reviewInputs(designController.state), look: reviewLook, designCanvas: document.getElementById('design-canvas'), emptyText: NO_CUTS }); // TASK 754: the 3D view takes the Design canvas's paper + grid; TASK 757: an empty design shows the 2D view's empty-state message
      }
      showStockThickness();
      reviewView.refresh(reviewSig(st));
      exportSim.render(); // TASK 801: the simulation shown in this view
    } catch (e) { info.textContent = 'Export failed: ' + e.message; throw e; }
  }
  {
    const stockHint = bindHint({ el: document.getElementById('review-stock-label') }); // TASK 880: what the board is (stock-card.js boardOf) is the label's tooltip, not a note under it
    const stockCard = createStockCard({ input: document.getElementById('review-stock-thickness'), onBoard: (board) => stockHint.refresh({ board }), getController: () => designController,
      onChange: () => { if (fusionUi) fusionUi.notifyProjectChanged(); if (reviewViewMode !== '3d') enterReview(designController.state); else if (reviewView) { exportSim.refresh(reviewSig(designController.state)); reviewView.refresh(reviewSig(designController.state)); } } }); // TASK 583 (stock-card.js): the thickness field of the Review card; TASK 817: the 2D file is made again (in the background); TASK 801: the simulation's board is the new one
    showStockThickness = stockCard.show;
    SettingsManager.subscribe((key) => { if (fusionUi) fusionUi.notifyProjectChanged(); if ((key === null || key === 'DOC_UNIT' || isPrecisionKey(key)) && modes.current() === 'review' && designController) enterReview(designController.state); });
    document.getElementById('review-reset').addEventListener('click', () => reviewView && reviewView.reset());
    document.getElementById('review-top').addEventListener('click', () => reviewView && reviewView.top());
    document.getElementById('review-fit').addEventListener('click', () => (reviewViewMode !== '3d' ? exportPreview.fit() : reviewView && reviewView.fit())); // TASK 718: Fit frames the view shown
  }
  // TASK 729: the Look card: the Material select (one option per LOOKS row) and, for a look that takes a colour, its preset swatches (+ the
  // native colour picker when the look allows any colour). A pick swaps the 3D view's materials only; the 2D view and the export never read it.
  function showReviewLook() {
    const select = document.getElementById('review-look-select'), colors = document.getElementById('review-look-colors');
    if (!select.options.length) for (const l of LOOKS) select.add(new Option(l.label, l.id));
    select.value = reviewLook.id;
    const row = LOOKS.find((l) => l.id === reviewLook.id), cur = reviewLook.colors[row.id];
    colors.hidden = !row.colors;
    if (colors.dataset.look !== row.id) { // a new look: its own swatches (rebuilt only then, so an open colour picker is never replaced under the user)
      colors.dataset.look = row.id;
      const kids = (row.colors || []).map((p) => { const b = document.createElement('button'); b.type = 'button'; b.dataset.hex = p.hex; b.title = p.label; b.setAttribute('aria-label', p.label); b.style.background = p.hex; return b; });
      if (row.custom) { const c = document.createElement('input'); c.type = 'color'; c.id = 'review-look-custom'; c.title = 'Any colour'; c.setAttribute('aria-label', 'Any colour'); kids.push(c); }
      colors.replaceChildren(...kids);
    }
    const preset = !!row.colors && row.colors.some((p) => p.hex === cur);
    for (const b of colors.querySelectorAll('button[data-hex]')) b.setAttribute('aria-pressed', b.dataset.hex === cur ? 'true' : 'false');
    const custom = document.getElementById('review-look-custom');
    if (custom) { custom.value = cur; custom.setAttribute('aria-pressed', preset ? 'false' : 'true'); }
  }
  function setReviewLook(next) {
    reviewLook = normaliseLook(next);
    try { localStorage.setItem(REVIEW_LOOK_KEY, JSON.stringify(reviewLook)); } catch (err) { dbg.warn('shaper', 'REVIEW_LOOK_KEY write failed', err && err.message); }
    showReviewLook();
    if (reviewView) reviewView.setLook(reviewLook);
    if (fusionUi) fusionUi.notifyProjectChanged();
  }
  showReviewLook();
  document.getElementById('review-look-select').addEventListener('change', (e) => setReviewLook({ ...reviewLook, id: e.target.value }));
  const pickReviewColor = (hex) => setReviewLook({ ...reviewLook, colors: { ...reviewLook.colors, [reviewLook.id]: hex } });
  document.getElementById('review-look-colors').addEventListener('click', (e) => { const b = e.target.closest('button[data-hex]'); if (b) pickReviewColor(b.dataset.hex); });
  document.getElementById('review-look-colors').addEventListener('input', (e) => { if (e.target.id === 'review-look-custom') pickReviewColor(e.target.value); });
  // the 3D view as mounted (null until the Export step first shows 3D): read by the live tests through currentReviewView, no window global
  shown.reviewView = () => reviewView;

  ensureSketch(); // TASK 605: the document buffer (and so the tab strip) exists from the first paint, whichever mode the page opens on
  // TASK 767: in Fusion mode the design IS the imported selection (TASK 712: it replaces the design), so the design takes the selection's name (TASK 790: an opened STL's too: the file name without .stl)
  // (fusion-import.js selectionDesignName, TASK 774: the Fusion DOCUMENT's name, e.g. "06-countersink"; the body's, "Body1", only when the payload has none) and the export file names follow (designFileName). A stored design keeps its own name.
  function nameAfterSelection(name) {
    if (docBuffer.isStored()) return;
    docBuffer.rename(name).catch((err) => dbg.warn('shaper', 'naming the design after the Fusion selection failed', err && err.message));
  }
  if (fusionMode) {
    fusionUi = mountFusionPrepareBar({
      viewPrepareEl: VIEWS.prepare,
      fusionMode, // TASK 881: declared (the bar does not read the page's address)
      noticeEl: document.getElementById('prepare-notice'),
      getController: () => designController,
      prepare,
      captureLook: () => ({ reviewLook, reviewViewMode }),
      onRestoreLook: ({ reviewLook: rl, reviewViewMode: rv }) => {
        if (rl) setReviewLook(rl);
        if (rv === '2d' || rv === 'paths' || rv === '3d') {
          reviewViewMode = rv;
          showReviewViewMode();
        }
      },
      onDesignContextChange: (ctx) => {
        showStockThickness();
        if (infoPanel) infoPanel.refresh();
        history.refresh();
        if (modes.current() === 'review') enterReview(designController.state);
        if (fusionToolpaths) fusionToolpaths.notify();
        if (ctx && typeof ctx.docName === 'string' && ctx.docName.trim()) {
          nameAfterSelection(ctx.docName.trim().replace(/\s+v\d+$/, ''));
        }
        onDesignContext(ctx, app); // TASK 881: the page's own work on a new design context (the website: the one-time offer of the browser's pre-855 work)
      },
      onSelectionData: (payload, meta) => {
        ensureSketch();
        const res = importFusionSelection(payload, {
          controller: designController,
          prepare,
          onImport: afterSelectionImport,
          clearGroup: meta && meta.clearGroup ? meta.clearGroup : null,
        });
        if (res.ok && res.imported) { track('import:fusion'); nameAfterSelection(res.name); } // TASK 738; TASK 767
        return res;
      },
      onRemoveSelection: (id, group) => (
        group
          ? fusionUi.bridge.send(FUSION_ACTIONS.CLEAR_SELECTION, { selectionId: id, group })
          : removeSelection(designController, id, { prepare, onDone: afterSelectionImport })
      ), // TASK 795 / 795c
      onClearSelections: () => clearSelections(designController, { prepare, onDone: afterSelectionImport }),
      onStatusChange: () => { if (fusionToolpaths) fusionToolpaths.notify(); },
    });
    fusionToolpaths = createFusionToolpathsSync({
      bridge: fusionUi.bridge,
      getState: () => designController && designController.state,
      getOpenOpId: () => prepare.openId(),
      getSelections,
      onSpin: fusionUi.setSyncing,
    });
    window.addEventListener('pagehide', () => { fusionUi.flushProjectSave(); fusionToolpaths.clearNow(); });
    window.addEventListener('beforeunload', () => { fusionUi.flushProjectSave(); fusionToolpaths.clearNow(); });
    showMode(initMode);
    fusionUi.bootPing();
    fusionToolpaths.notify();
  } else {
    showMode(initMode);
  }
}
