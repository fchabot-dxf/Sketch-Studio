// Shaper — boot + wiring.

import { download } from './download.js';
// Shared #core-backed sketcher (S1). Eager import so the page load exercises #ui/ + #core/ resolution;
// the mount itself runs only when the Design tab is first opened.
import { mountSketch } from '#ui/sketch-canvas.js';
import { sketchesSignature } from '#core/sketch-model.js';
import { createToolRibbon } from '#ui/tool-ribbon.js';
import { createDocumentBuffer } from '#ui/document-buffer.js'; // PERSIST-2: autosave + cross-app carry
import { DESIGN_CANVAS_ID, DESIGN_CANVAS_OPTIONS, RIBBON_OPTIONS, mountShaperBrowser, shaperBufferOptions, applyShaperUnitDefault } from './design-canvas.js'; // TASK 569: the Design canvas setup, declared once (the node test kit reads it too)
import { createDiagnosticLog } from '#ui/diagnostic-log.js'; // DIAG-OVERLAY: mobile-usable log + Copy Report
import { createShaperSession } from './shaper-session.js'; // TASK 605: a document tab's stage state, declared once (the node test kit builds it too)
import { createPrepareStage } from './prepare-stage.js'; // TASK 583: Prepare's wiring (view, cut card, cut-plan undo, keys, restore), declared once (the node test kit calls it too)
import { mountAppFooter } from '#ui/app-footer.js'; // TASK 618: Undo / Redo, Recenter in the footer
import { MODE_KEY, shaperStagesFor, resolveInitialMode, findViews, createModeRouter, createShaperHistory } from './modes.js'; // TASK 583 + 663: the mode router, declared once
import { isFusionMode, mountFusionPrepareBar } from './fusion-bridge.js'; // TASK 663: Fusion mode & palette bridge
import { importFusionSelection } from './fusion-import.js'; // TASK 664: Fusion selection_data -> sketch + CUT_PLAN + stock
import { dbg } from '#core/debug.js';
import { mountReviewView, LOOKS, normaliseLook } from './review-view.js';   // TASK 459: the 3D Review (three loads only when the tab first opens)
import { getStock, resolveStock } from './stock.js'; // TASK 459: the declared stock (persisted by shaper-doc.js, TASK 460)
import { createStockCard } from './stock-card.js'; // TASK 583: the Review card's stock thickness field, declared once (the node test kit calls it too)
import { createStylePanel } from '#ui/style-panel.js'; // U3b: shared settings modal (with the doc-unit toggle)
import { bindTemplateTokens } from '#ui/style-templates.js';
import { cutPlanEntries, CUT_PLAN, planReliefItems, planSteppedNotes, planHoldNotes, planClearingNotes, planLeadInNotes, planLevelsNotes } from './cut-plan.js'; // SP1j-4: the shared cut-plan store; TASK 745: planClearingNotes; TASK 775: planLeadInNotes
import { shaperSvgOf, shaperPreviewOf, exportFileName } from './export-payload.js';  // SP1j / TASK 718: the ONE exporter call (the download and the 2D preview copy); TASK 743: the preview copy + its operations; TASK 767: the file's name
import { opOrder } from './operations.js';            // TASK 743: the operation order (the 2D view rebuilds when it changes)
import { mountExportPreview } from './export-preview.js'; // TASK 718: the Export step's 2D view of that file
import { mountAppChrome } from '#ui/app-chrome.js';
import { track } from '#ui/analytics.js'; // TASK 738: the ShaperHub upload, a Fusion selection received
import { forgetOldLogin } from './shaperhub-login.js'; // TASK 758: the app keeps no ShaperHub login; an earlier version's copy is deleted at start
import { SIDEBAR_ICONS } from '#ui/app-sidebar.js';
import { getGoogleAccount } from '#ui/cloud/google-account.js'; // TASK 488: probe the server session once at start (signing in syncs nothing)
import { applyAppIdentity } from '#ui/app-registry.js'; // TASK 473: tab title + favicon from the registry
applyAppIdentity('shaper');
import { createShaperImporter } from './cut-import.js'; // TASK 583 / 610: Shaper's SVG / DXF import (options, the menu entry, the drop), declared once
import { createStlImporter, STL_ICON } from './stl-import.js'; // TASK 790: Open STL (sliced into the Fusion selection payload) + the STL card in Prepare
import SettingsManager, { docUnit, isPrecisionKey } from '#core/settings-manager.js';
import { createGroupStatus } from './group-status.js'; // TASK 610: the one-line status toast over the Design view
import { fusionAddinAction, fusionAddinView, ADDIN_VIEW_ID } from './addin-download.js'; // TASK 733: the sidebar's Fusion add-in download (hidden in Fusion mode)
import { hintLabel, hintText } from './param-hints.js'; // TASK 770: THE table of labels and hints (the Export step's cards, the drawer's Download)
import { mountHint } from './hint.js'; // TASK 770: the one hint widget
import { mountTooltip } from '#ui/hint.js';

let designController = null; // sketcher mounted once, at boot (ensureSketch); RAF started while Design is active, paused otherwise (declared before the sidebar: the tab strip reads the buffer as it mounts)
let docBuffer = null; // TASK 474: the autosave buffer / project actions of this app (created with the sketch in ensureSketch); the sidebar and the tab strip read it lazily

// DIAG-OVERLAY: created at boot (not gated to Design mode) so it's reachable even if a bug hits
// Prepare/Review — designController may not exist yet, so its state is read lazily.
const _diagLog = createDiagnosticLog({ appId: 'shaper', state: () => designController && designController.state });

const fusionMode = isFusionMode();
if (!fusionMode) getGoogleAccount().init();
const activeStages = shaperStagesFor({ fusion: fusionMode });
let initMode = null;
try { initMode = localStorage.getItem(MODE_KEY); } catch (err) { dbg.warn('shaper', 'MODE_KEY read failed', err && err.message); }
// TASK 758: delete the ShaperHub login an earlier version stored (shaperhub-login.js); a storage error goes to the Log (it carries no stored content)
try { forgetOldLogin(localStorage); } catch (err) { dbg.warn('shaper', 'removing the old stored ShaperHub login failed', err && err.message); }
initMode = resolveInitialMode(initMode, { fusion: fusionMode }); // modes.js: a stored 'simexport' (TASK 459) is Review; a stored 'explore' (TASK 706) or none: Design

const chrome = mountAppChrome({
  appId: 'shaper',
  host: fusionMode ? 'fusion' : 'web', // TASK 738: the analytics tell the Fusion 360 palette from the website
  stages: activeStages,
  activeStage: initMode,
  onStageChange: (mode) => showMode(mode),
  getBuffer: () => docBuffer,
  importFile: (text, name) => shaperImporter.importFile(text, name),
  projects: !fusionMode, // TASK 663: single Fusion-mode switch for Projects/file/Drive sidebar + doc tabs; remove or set true to restore
  hostActions: [
    ...(fusionMode ? [] : [{ id: 'open-stl', label: hintLabel('openStl'), icon: STL_ICON, tooltip: hintText('openStl'), keepOpen: true, onClick: async () => { // TASK 790: Shaper only, not in the Fusion palette (its design comes from Fusion)
      try {
        const res = await stlImporter.pickAndOpen();
        if (!res) return; // the chooser was cancelled
        if (!res.ok) { chrome.sidebar.notify(res.message, 'error'); return; } // not a readable STL: the design is unchanged
        chrome.sidebar.close();
        if (res.imported) nameAfterSelection(res.name); // the design takes the file's name, as a Fusion selection's (TASK 767)
      } catch (e) { chrome.sidebar.notify(e.message || String(e), 'error'); }
    } }]),
    { id: 'download', label: hintLabel('download'), icon: SIDEBAR_ICONS.download, tooltip: hintText('download'), onClick: () => { // TASK 770: from the table (the shared drawer shows a tooltip)
      const payload = generateShaperSvgPayload();
      if (!payload) { groupStatus(NO_CUTS); return; }
      download(designFileName(), payload.svg);
    } },
    fusionAddinAction({ fusion: fusionMode, open: () => chrome.sidebar.showView(ADDIN_VIEW_ID) }),
    { divider: true },
    { id: 'settings', label: 'Settings', icon: SIDEBAR_ICONS.gear, onClick: () => stylePanel.toggle() },
    { id: 'log', label: 'Log', icon: SIDEBAR_ICONS.log, onClick: () => _diagLog.toggle() },
  ],
});

chrome.sidebar.registerView(ADDIN_VIEW_ID, fusionAddinView()); // TASK 733: the drawer view the Fusion add-in entry opens

const NO_CUTS = 'No cuts assigned — assign cut types in Prepare first.'; // the Export step's message with an empty plan (Generate, Download, the 2D view)

// SP1j-4: the Sim/Export tab → serialize the Prepare cut plan + the design into a machine-ready Shaper Origin SVG and
// download it. Encoding INJECTED (the app's CUT_TYPES) so #core/shaper-export stays app-agnostic; docUnit from settings.

// TASK 718: `preview: true` = the 2D view's copy of the same file (export-payload.js: plus its preview-only data-* attributes) and (TASK 743) the operations it lists
function generateShaperSvgPayload({ preview = false } = {}) {
  const entries = cutPlanEntries();
  if (!entries.length) return null;
  ensureSketch();
  try { designController.engine.solve(500); } catch (_) { /* best-effort solve before export */ }
  const st = designController.state;
  if (preview) { const p = shaperPreviewOf(st, entries); return { svg: p.svg, ops: p.ops, entries, state: st }; }
  return { svg: shaperSvgOf(st, entries), entries, state: st };
}

// TASK 767: the name of every file the Export step produces (Generate Shaper SVG, the sidebar Download, the Sync dialog's file name): the design's name
// through the ONE rule (export-payload.js exportFileName). The design's name is the document tab's (in Fusion mode: the imported selection's, nameAfterSelection).
const designFileName = () => exportFileName(docBuffer ? docBuffer.designName() : null);

const btnGenerateSvg = document.getElementById('btn-generate-svg');
// TASK 770: the Export step's side cards take their labels and hints from the table (param-hints.js) through the one hint widget (hint.js): the Stock thickness,
// the Material, and the Export title, whose hint lists the three ways out (each button is described by its own line)
for (const e of document.querySelectorAll('#review-side [data-label], #shaper-sync-modal [data-label]')) e.textContent = hintLabel(e.dataset.label);
const sideHint = (id, after, fields, itemFields) => mountHint({ id, labelEl: document.querySelector(`#review-side [data-hint="${id}"]`), after, fields, itemFields });
sideHint('reviewCuts', document.getElementById('review-cuts-list'), []);
sideHint('stockThickness', document.querySelector('#review-stock > label'), [document.getElementById('review-stock-thickness')]);
sideHint('material', document.querySelector('#review-look > label'), [document.getElementById('review-look-select')]);
sideHint('export', document.querySelector('#simexport-panel .simexport-actions'), [], { generateSvg: btnGenerateSvg, syncShaperHub: document.getElementById('btn-sync-shaper'), openShaperHub: document.getElementById('link-shaper-hub') });
mountHint({ id: 'dirLegend', labelEl: document.querySelector('#prepare-dir-legend [data-hint="dirLegend"]'), after: document.querySelector('#prepare-dir-legend .review-label-line') });
for (const b of document.querySelectorAll('#review-toolbar [data-hint]')) {
  const id = b.dataset.hint;
  mountTooltip({ target: b, getContent: () => ({ title: hintLabel(id), text: hintText(id) }) });
}
const newFolderBtnEl = document.getElementById('sync-btn-new-folder');
if (newFolderBtnEl) mountTooltip({ target: newFolderBtnEl, getContent: () => ({ title: hintLabel('syncNewFolder'), text: hintText('syncNewFolder') }) });
if (btnGenerateSvg) {
  btnGenerateSvg.addEventListener('click', () => {
    const status = document.getElementById('simexport-status');
    const payload = generateShaperSvgPayload();
    if (!payload) { if (status) status.textContent = NO_CUTS; return; }
    const name = designFileName();
    download(name, payload.svg);
    const n = payload.entries.length;
    // built from nodes (TASK 767): the file name is the design's, text only
    const file = document.createElement('strong');
    file.textContent = name;
    const hub = document.createElement('a');
    Object.assign(hub, { href: 'https://hub.shapertools.com/my-files', target: '_blank', rel: 'noopener noreferrer', textContent: 'ShaperHub (My Files)' });
    hub.style.cssText = 'color:var(--sk-selection,#4c9aff); text-decoration:underline;';
    if (status) status.replaceChildren(`Exported ${n} cut${n === 1 ? '' : 's'} → `, file, '. Drop it into ', hub, ' to sync with Origin.');
  });
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

mountHint({ id: 'syncFolder', labelEl: document.querySelector('#sync-browser [data-hint="syncFolder"]'), after: document.querySelector('#sync-browser .sync-browser-head') });
mountHint({ id: 'syncFilename', labelEl: document.querySelector('#shaper-sync-modal [data-hint="syncFilename"]'), after: document.querySelector('#shaper-sync-modal [data-hint="syncFilename"]')?.parentElement, fields: [syncFilename] });

const LOGIN_HINT = 'Check the password: your browser may have filled in a saved one.'; // TASK 767: under Shaper's own words when it refuses the sign-in

// TASK 772: auth JWT held strictly in page RAM for this tab only (never storage/cookies/DOM/logs; Task 758 stays intact).
let sessionToken = null;
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
}

function clearSession() {
  sessionToken = null;
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

const folderPlace = (path) => (!path || path === '/' ? 'My Files' : `My Files${path.slice(0, -1)}`);

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
  } else if (data && data.kind === 'login' && sessionToken) {
    clearSession();
  }
  return { res, data, sentPassword: !!pass };
}

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

if (syncSwitchBtn) syncSwitchBtn.addEventListener('click', () => { clearSession(); showExistsQuestion(false); showSyncStatus('', ''); if (syncSubmitBtn) syncSubmitBtn.disabled = false; if (syncEmail) syncEmail.focus(); }); // TASK 788: an open "already in My Files" question is about the account being left: it closes (Send, Browse usable again)
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
if (syncEmail) syncEmail.addEventListener('input', () => { if (sessionToken) clearSession(); });
if (syncPassword) syncPassword.addEventListener('input', () => { if (sessionToken) clearSession(); });

// TASK 767: the file name the user typed for a design, kept for THIS session only (page memory, never stored): the design = its document tab, its
// stored id and its name (a reused Untitled tab that now holds another design starts from that design's own name)
const syncNameEdits = new Map();
const designKey = () => {
  const tab = docBuffer ? docBuffer.tabs().find((t) => t.active) : null;
  return JSON.stringify([tab ? tab.key : null, docBuffer ? docBuffer.designId() : null, docBuffer ? docBuffer.designName() : null]);
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

const btnSyncShaper = document.getElementById('btn-sync-shaper');
if (btnSyncShaper) {
  btnSyncShaper.addEventListener('click', () => {
    const status = document.getElementById('simexport-status');
    const entries = cutPlanEntries();
    if (!entries.length) {
      if (status) status.textContent = NO_CUTS;
      return;
    }
    const key = designKey();
    syncFilename.value = syncNameEdits.has(key) ? syncNameEdits.get(key) : designFileName(); // TASK 767: the design's name, or what was typed for it
    applySessionUi();
    renderFolderBrowser();
    showExistsQuestion(false);
    showSyncStatus('');
    if (syncSubmitBtn) syncSubmitBtn.disabled = false;
    if (syncModal && typeof syncModal.showModal === 'function') {
      syncModal.showModal();
    }
    if (sessionToken) openRemoteFolder(currentRemotePath);
  });
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
  const payload = generateShaperSvgPayload();
  if (!payload) {
    showSyncStatus('is-error', 'No cuts assigned in Prepare.');
    return;
  }
  const filename = syncFilename.value; // the function applies the name rule (shaper-cloud.js shaperFileName)

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
    const lines = [`Error: ${data.error || `Upload failed with status ${res.status}`}`];
    if (data.kind === 'login' && sentPassword) lines.push(LOGIN_HINT); // TASK 774: an expired session is not a wrong password
    showSyncStatus('is-error', ...lines);
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
  const line = sentLine(data);
  showSyncStatus('is-success', line);
  const expStatus = document.getElementById('simexport-status');
  if (expStatus) expStatus.textContent = `✓ ${line}. It will now appear on your Origin over Wi-Fi.`;
  // TASK 758: the login is NOT kept by the app. Closing the dialog hides the form after the successful fetch: that is what tells the browser's
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
// declared in cut-import.js (TASK 583: each element's cut record, kept descIds, the cuts kept in CUT_PLAN; the node test kit calls it too).
// The entry is the sidebar's "Import SVG / DXF…" (project-actions.js, passed to mountProjectSidebar above); a drop anywhere on the page is the second way in
// (TASK 706). Either one shows Design first (modes.js showDesign, declared to the shared importer).
const shaperImporter = createShaperImporter({ ensureSketch, getController: () => designController, getInfoPanel: () => infoPanel, notify: groupStatus, getDropHost: () => document.body, showDesign: () => modes.showDesign() }); // TASK 610: cut-import.js

// ── S6a: the app shell — a view router over Design / Prepare / Review. (modes.js: declared once, the node test kit calls it too) ──
const VIEWS = findViews(document);
let modes = null; // the mode router (created below, once the views it enters exist)

let reviewView = null;       // TASK 459: the 3D Review (mounted on first entry, three imported dynamically)
let showStockThickness = () => {}; // TASK 460: re-syncs the Review card's thickness field after a document restore (assigned below)
// SP1c-f, TASK 463, TASK 472 (prepare-stage.js): the Prepare view, the cut-settings card, every cut-plan edit as ONE step of the shared history, the cut
// plan in the sketch's undo snapshots, the Ctrl+Z / Ctrl+Y keys while Prepare shows, the one-line notice
const history = createShaperHistory({ getController: () => designController, getMode: () => modes.current() }); // TASK 618
const prepare = createPrepareStage({
  getController: () => designController, getMode: () => modes.current(), history,
  panelEl: document.getElementById('prepare-panel'), canvasEl: document.getElementById('prepare-canvas'), noticeEl: document.getElementById('prepare-notice'), opsEl: document.getElementById('prepare-ops'), // TASK 743: the operations list
  ensureSketch, onViewChange: (v) => { window.__prepareView = v; }, // the page's dev / test seam
});
// TASK 664 / 790: what the page refreshes after a selection replaced the design (a Fusion selection, an STL): the Review card's thickness, the panels, the history buttons, the Review
const afterSelectionImport = () => {
  showStockThickness();
  if (infoPanel) infoPanel.refresh();
  history.refresh();
  if (modes.current() === 'review') enterReview(designController.state);
};
// TASK 790: Open STL (the drawer entry above) and the STL card at the top of Prepare's right column (stl-import.js, declared once: the node test kit calls it too)
const stlImporter = createStlImporter({ ensureSketch, getController: () => designController, prepare, panelEl: document.getElementById('prepare-panel'),
  showPrepare: () => modes.showMode('prepare'), afterImport: afterSelectionImport, notice: (text, isError) => prepare.notice(text, isError) });

applyShaperUnitDefault(); // U3b (design-canvas.js, declared once: the node test kit calls it too)

// U3b: the shared style-panel as a menu-opened MODAL; its Units tab holds the one document-unit control.
const stylePanel = createStylePanel({ hostId: 'shaper' });
stylePanel.render(document.body);
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
  browser = mountShaperBrowser({ state, engine }); // design-canvas.js
  browser.toggleEl.style.display = 'none'; // shown only while Design is the active mode (showMode below)
  infoPanel = browser.panel;
  ribbon = createToolRibbon({
    state,
    ...RIBBON_OPTIONS, // design-canvas.js
    notify: groupStatus,
  });
  ribbon.render(document.getElementById('design-ribbon'));

  shaperImporter.mountDrop(); // a drop anywhere on the page (the menu entry is mounted with the sidebar)
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
    session: createShaperSession({ prepare }), // shaper-session.js: Prepare selection + view
    showDesign: () => modes.showDesign(), // TASK 706: a design the user opens (new / Open / Open from file) is shown in Design
    refreshViews: () => { if (infoPanel) infoPanel.refresh(); },
    // re-mount Prepare if it is the visible mode so it shows the restored geometry + cuts
    afterSidecar: (restore) => {
      prepare.afterRestore(restore); // TASK 741: + the one-time notice of a document that had V-carve regions
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
  afterShow: (mode) => { history.refresh(); if (browser) { if (mode !== 'design') browser.close(); browser.toggleEl.style.display = (mode === 'design') ? '' : 'none'; } }, // task 586/623: the Sketches button shows only on Design
  enter: {
    prepare: prepare.enter,
    review: () => {
      ensureSketch();
      try { designController.engine.solve(500); } catch (_) {}
      enterReview(designController.state);
    },
  },
});
const showMode = modes.showMode;
mountAppFooter({
  router: history,
  view: () => (designController && modes.current() === 'design' ? { svg: designController.svg, state: designController.state } : null),
  settings: stylePanel, // TASK 726: the gear at the footer's right end (also in Fusion mode)
}); // TASK 618/619: Recenter on Design

// TASK 459: Review = the finished workpiece in 3D, built only from the Prepare cut plan + the declared stock.
const reviewInputs = (st) => {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const j of st.joints.values()) { minX = Math.min(minX, j.x); maxX = Math.max(maxX, j.x); minY = Math.min(minY, j.y); maxY = Math.max(maxY, j.y); }
  // TASK 757: an EMPTY design (no shapes: its only joint is the origin) has no bounds, so the 3D view builds no board (it was a margin-sized cube round the origin)
  return { stock: resolveStock(st, CUT_PLAN).stock, items: planReliefItems(st), bounds: st.shapes.length && Number.isFinite(minX) ? { minX, maxX, minY, maxY } : null, notes: [...planSteppedNotes(CUT_PLAN), ...planHoldNotes(st, CUT_PLAN), ...planClearingNotes(st, CUT_PLAN), ...planLeadInNotes(st, CUT_PLAN), ...planLevelsNotes(st, CUT_PLAN)] }; // TASK 714: notes = the stepped cuts' steps / undercuts; TASK 742: the held cuts' passes / gaps; TASK 745: the programmed pockets' clearing
};
const reviewSig = (st) => JSON.stringify([[...CUT_PLAN], getStock(), [...st.joints.values()].map((j) => [j.x, j.y]), docUnit(), opOrder(),
  SettingsManager.get('LENGTH_PRECISION'), SettingsManager.get('ANGLE_PRECISION'), SettingsManager.get('TRAILING_ZEROS'), SettingsManager.get('INCH_DISPLAY'), SettingsManager.get('LENGTH_FRACTION')]); // TASK 714 / 743 / 770: rebuilds on doc unit, precision or trailing-zeros change
// TASK 718: the Export step's view: '3d' (the board above) or '2d' (the exported file, export-preview.js), remembered per app like the stage (MODE_KEY)
const REVIEW_VIEW_KEY = 'shaper-review-view';
let reviewViewMode = '3d';
try { if (localStorage.getItem(REVIEW_VIEW_KEY) === '2d') reviewViewMode = '2d'; } catch (err) { dbg.warn('shaper', 'REVIEW_VIEW_KEY read failed', err && err.message); }
// TASK 729: the 3D board's look (review-view.js LOOKS + each colour-taking look's own colour), remembered per app the same way
const REVIEW_LOOK_KEY = 'shaper-review-look';
let reviewLook = normaliseLook(null);
try { const s = localStorage.getItem(REVIEW_LOOK_KEY); if (s) reviewLook = normaliseLook(JSON.parse(s)); } catch (err) { dbg.warn('shaper', 'REVIEW_LOOK_KEY read failed', err && err.message); }
const exportPreview = mountExportPreview({
  canvas: document.getElementById('review-2d-canvas'), list: document.getElementById('review-cuts-list'), info: document.getElementById('review-2d-info'), emptyText: NO_CUTS,
  getPreview: () => { const p = generateShaperSvgPayload({ preview: true }); return p ? { svg: p.svg, ops: p.ops } : null; }, // TASK 743: + the operations (display only)
});
function showReviewViewMode() {
  const is2d = reviewViewMode === '2d';
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
    enterReview(designController.state);
  });
}
async function enterReview(st) {
  if (reviewViewMode === '2d') { showStockThickness(); exportPreview.refresh(reviewSig(st)); return; } // TASK 718: the same trigger rebuilds the 2D view
  const info = document.getElementById('review-info');
  try {
    if (!reviewView) {
      info.textContent = 'Loading 3D…';
      reviewView = await mountReviewView({ host: document.getElementById('review-canvas-host'), info, getInputs: () => reviewInputs(designController.state), look: reviewLook, designCanvas: document.getElementById('design-canvas'), emptyText: NO_CUTS }); // TASK 754: the 3D view takes the Design canvas's paper + grid; TASK 757: an empty design shows the 2D view's empty-state message
    }
    showStockThickness();
    reviewView.refresh(reviewSig(st));
  } catch (e) { info.textContent = 'Export failed: ' + e.message; throw e; }
}
{
  const stockCard = createStockCard({ input: document.getElementById('review-stock-thickness'), noteEl: document.getElementById('review-stock-note'), getController: () => designController,
    onChange: () => { if (reviewViewMode === '2d') exportPreview.refresh(reviewSig(designController.state)); else if (reviewView) reviewView.refresh(reviewSig(designController.state)); } }); // TASK 583 (stock-card.js): the thickness field of the Review card
  showStockThickness = stockCard.show;
  SettingsManager.subscribe((key) => { if ((key === null || key === 'DOC_UNIT' || isPrecisionKey(key)) && modes.current() === 'review' && designController) enterReview(designController.state); });
  document.getElementById('review-reset').addEventListener('click', () => reviewView && reviewView.reset());
  document.getElementById('review-top').addEventListener('click', () => reviewView && reviewView.top());
  document.getElementById('review-fit').addEventListener('click', () => (reviewViewMode === '2d' ? exportPreview.fit() : reviewView && reviewView.fit())); // TASK 718: Fit frames the view shown
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
}
showReviewLook();
document.getElementById('review-look-select').addEventListener('change', (e) => setReviewLook({ ...reviewLook, id: e.target.value }));
const pickReviewColor = (hex) => setReviewLook({ ...reviewLook, colors: { ...reviewLook.colors, [reviewLook.id]: hex } });
document.getElementById('review-look-colors').addEventListener('click', (e) => { const b = e.target.closest('button[data-hex]'); if (b) pickReviewColor(b.dataset.hex); });
document.getElementById('review-look-colors').addEventListener('input', (e) => { if (e.target.id === 'review-look-custom') pickReviewColor(e.target.value); });
// the 3D view as mounted (null until the Export step first shows 3D): read by the live tests through this module, no window global
export const currentReviewView = () => reviewView;

ensureSketch(); // TASK 605: the document buffer (and so the tab strip) exists from the first paint, whichever mode the page opens on
// TASK 767: in Fusion mode the design IS the imported selection (TASK 712: it replaces the design), so the design takes the selection's name (TASK 790: an opened STL's too: the file name without .stl)
// (fusion-import.js selectionDesignName, TASK 774: the Fusion DOCUMENT's name, e.g. "06-countersink"; the body's, "Body1", only when the payload has none) and the export file names follow (designFileName). A stored design keeps its own name.
function nameAfterSelection(name) {
  if (docBuffer.isStored()) return;
  docBuffer.rename(name).catch((err) => dbg.warn('shaper', 'naming the design after the Fusion selection failed', err && err.message));
}
if (fusionMode) {
  const fusionUi = mountFusionPrepareBar({
    viewPrepareEl: VIEWS.prepare,
    noticeEl: document.getElementById('prepare-notice'),
    onSelectionData: (payload) => {
      ensureSketch();
      const res = importFusionSelection(payload, { controller: designController, prepare, onImport: afterSelectionImport });
      if (res.ok && res.imported) { track('import:fusion'); nameAfterSelection(res.name); } // TASK 738; TASK 767
      return res;
    },
  });
  showMode(initMode);
  fusionUi.bootPing();
} else {
  showMode(initMode);
}
