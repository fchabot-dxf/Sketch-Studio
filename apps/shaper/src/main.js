// Shaper — the WEBSITE's boot (index.html loads this module): Shaper's page wiring (shaper-app.js, declared once, TASK 881) with the website's own parts.
// The same page opens in Fusion's palette with ?host=fusion (the add-in in users' hands): Fusion mode, decided here once from the page's address.
// What only the website has, declared below and passed to startShaperApp: the project drawer (#ui/app-chrome.js: documents, Google Drive, the account),
// the page's shared store (or, for the SA-19 add-in, ?host=fusion&project=design, an in-memory one), the drawer's Open / Insert STL, Download, the Fusion
// add-in download, Settings (the style panel, also the footer's gear), the SVG / DXF import, the SKETCHES browser, the Google session probe, the old
// ShaperHub login's removal and, in Fusion mode, the one-time offer of the browser's pre-855 work. The Fusion PANEL build (fusion-main.js) passes none of them.

import { startShaperApp } from './shaper-app.js';
import { download } from './download.js';
import { createDocumentBuffer } from '#ui/document-buffer.js'; // PERSIST-2: autosave + cross-app carry (on the page's shared store unless a store is passed)
import { getProjectStore, createProjectStore, createMemoryAdapter } from '#ui/project-store.js'; // TASK 855: Fusion mode uses in-memory workspace store; legacy browser buffer offered once
import { deserializeDocument } from '#core/document.js';
import { applyShaperDoc } from './shaper-doc.js';
import { dbg } from '#core/debug.js';
import { createStylePanel } from '#ui/style-panel.js'; // U3b: shared settings modal (with the doc-unit toggle)
import { mountAppChrome } from '#ui/app-chrome.js';
import { forgetOldLogin } from './shaperhub-login.js'; // TASK 758: the app keeps no ShaperHub login; an earlier version's copy is deleted at start
import { SIDEBAR_ICONS } from '#ui/app-sidebar.js';
import { getGoogleAccount } from '#ui/cloud/google-account.js'; // TASK 488: probe the server session once at start (signing in syncs nothing)
import { createShaperImporter } from './cut-import.js'; // TASK 583 / 610: Shaper's SVG / DXF import (options, the menu entry, the drop), declared once
import { STL_ICON, STL_INSERT_ICON } from './stl-import.js'; // TASK 790: Open STL (sliced into the Fusion selection payload); TASK 841: Insert STL
import { fusionAddinAction, fusionAddinView, ADDIN_VIEW_ID } from './addin-download.js'; // TASK 733: the sidebar's Fusion add-in download (hidden in Fusion mode)
import { mountShaperBrowser } from './shaper-browser.js'; // task 586 / 610: the floating SKETCHES browser over the Design canvas
import { isFusionMode, isPerDesignProject, LEGACY_FUSION_OFFERED_KEY } from './fusion-bridge.js'; // TASK 663: Fusion mode & palette bridge
import { hintLabel, hintText } from './param-hints.js'; // TASK 770: THE table of labels and hints (the drawer's Download, Open / Insert STL)

export { currentReviewView, currentExportSim } from './shaper-app.js'; // read by the live tests through this module

const fusionMode = isFusionMode();
const perDesignProject = isPerDesignProject(); // TASK 855c: the SA-19 add-in keeps the workspace in the Fusion design; an older add-in: today's browser storage

let chrome = null; // the header + drawer (#ui/app-chrome.js), once mounted
let shaperImporter = null; // the SVG / DXF importer (cut-import.js), once created

// TASK 790 / 841: a drawer entry that picks an STL (`pick`: the importer's chooser + import) — Open STL and Insert STL, declared once each with it. A cancelled
// chooser does nothing; a file that is not a readable STL is told in the drawer (the design unchanged); an import closes the drawer, then `after(res)`.
function stlAction({ id, label, tooltip, icon, pick, after = () => {} }) {
  return { id, label, icon, tooltip, keepOpen: true, onClick: async () => {
    try {
      const res = await pick();
      if (!res) return; // the chooser was cancelled
      if (!res.ok) { chrome.sidebar.notify(res.message, 'error'); return; } // not a readable STL: the design is unchanged
      chrome.sidebar.close();
      if (res.imported) after(res);
    } catch (e) { chrome.sidebar.notify(e.message || String(e), 'error'); }
  } };
}

// TASK 855: in Fusion mode, the one-time offer of the work an earlier panel kept in this browser (before the workspace lived in the Fusion design)
async function maybeOfferLegacyBrowserWork(ctx, app) {
  if (!ctx || ctx.project || ctx.hasSelection) return;
  try {
    if (localStorage.getItem(LEGACY_FUSION_OFFERED_KEY) === '1') return;
    const buf = await getProjectStore().readBuffer();
    const tabs = buf && Array.isArray(buf.tabs) ? buf.tabs : [];
    const candidate = tabs.find((t) => {
      const sh = t && t.doc && t.doc.hosts && t.doc.hosts.shaper;
      return sh && ((Array.isArray(sh.operations) && sh.operations.length > 0) || (Array.isArray(sh.cutPlan) && sh.cutPlan.length > 0));
    });
    if (!candidate) return;
    localStorage.setItem(LEGACY_FUSION_OFFERED_KEY, '1');
    const noticeEl = document.getElementById('prepare-notice');
    if (!noticeEl) return;
    const openBtn = document.createElement('button');
    openBtn.type = 'button';
    openBtn.id = 'btn-fusion-open-legacy';
    openBtn.className = 'sk-wait-action';
    openBtn.textContent = "Open the panel's previous work";
    openBtn.addEventListener('click', () => {
      deserializeDocument(candidate.doc, app.getController().state);
      applyShaperDoc(candidate.doc.hosts.shaper, app.getController().state);
      app.prepare().afterRestore();
      app.afterSelectionImport();
      noticeEl.hidden = true;
    });
    const dismissBtn = document.createElement('button');
    dismissBtn.type = 'button';
    dismissBtn.id = 'btn-fusion-dismiss-legacy';
    dismissBtn.className = 'sk-wait-action';
    dismissBtn.style.marginLeft = '6px';
    dismissBtn.textContent = 'Dismiss';
    dismissBtn.addEventListener('click', () => { noticeEl.hidden = true; });
    noticeEl.classList.remove('is-error');
    noticeEl.replaceChildren('Previous browser work is available. ', openBtn, dismissBtn);
    noticeEl.hidden = false;
  } catch (err) {
    dbg.warn('shaper', 'legacy browser work check failed', err && err.message);
  }
}

startShaperApp({
  fusion: fusionMode,
  createDocumentBuffer,
  bufferStore: () => (perDesignProject ? createProjectStore({ adapter: createMemoryAdapter(), legacySource: async () => null, channel: null }) : undefined), // TASK 855c
  beforeChrome: () => {
    if (!fusionMode) getGoogleAccount().init();
    // TASK 758: delete the ShaperHub login an earlier version stored (shaperhub-login.js); a storage error goes to the Log (it carries no stored content)
    try { forgetOldLogin(localStorage); } catch (err) { dbg.warn('shaper', 'removing the old stored ShaperHub login failed', err && err.message); }
  },
  mountChrome: (decl) => (chrome = mountAppChrome({
    ...decl,
    importFile: (text, name) => shaperImporter.importFile(text, name),
    projects: !fusionMode, // TASK 663: single Fusion-mode switch for Projects/file/Drive sidebar + doc tabs; remove or set true to restore
  })),
  menu: (app) => [
    // TASK 790: Shaper only, not in the Fusion palette (its design comes from Fusion); the design takes an opened file's name, as a Fusion selection's (TASK 767).
    // TASK 841: Insert STL next to it (the design keeps its name)
    ...(fusionMode ? [] : [
      stlAction({ id: 'open-stl', label: hintLabel('openStl'), tooltip: hintText('openStl'), icon: STL_ICON, pick: () => app.stlImporter().pickAndOpen(), after: (res) => app.nameAfterSelection(res.name) }),
      stlAction({ id: 'insert-stl', label: hintLabel('insertStl'), tooltip: hintText('insertStl'), icon: STL_INSERT_ICON, pick: () => app.stlImporter().pickAndInsert() }),
    ]),
    { id: 'download', label: hintLabel('download'), icon: SIDEBAR_ICONS.download, tooltip: hintText('download'), onClick: async () => { // TASK 770: from the table (the shared drawer shows a tooltip)
      const payload = await app.generateShaperSvgPayload({ say: (t) => app.groupStatus(t) }); // TASK 817: waits for the paths being generated
      if (!payload) { app.groupStatus(app.emptyExportText()); return; }
      download(app.designFileName(), payload.svg);
      const status = document.getElementById('simexport-status'); // TASK 803: the Origin-rules warning shows in the Export step's status line
      if (payload.warning && status) status.textContent = payload.warning;
    } },
    fusionAddinAction({ fusion: fusionMode, open: () => chrome.sidebar.showView(ADDIN_VIEW_ID) }),
    { divider: true },
    { id: 'settings', label: 'Settings', icon: SIDEBAR_ICONS.gear, onClick: () => app.settings().toggle() },
    app.logAction,
  ],
  afterChrome: () => chrome.sidebar.registerView(ADDIN_VIEW_ID, fusionAddinView()), // TASK 733: the drawer view the Fusion add-in entry opens
  createImporter: (ctx) => (shaperImporter = createShaperImporter(ctx)), // TASK 610: cut-import.js (the sidebar's "Import SVG / DXF…" and the drop on the page)
  // U3b: the shared style-panel as a menu-opened MODAL; its Units tab holds the one document-unit control (also the footer's gear, TASK 726)
  createSettingsPanel: () => {
    const stylePanel = createStylePanel({ hostId: 'shaper' });
    stylePanel.render(document.body);
    return stylePanel;
  },
  mountDesignBrowser: ({ state, engine }) => mountShaperBrowser({ state, engine }), // shaper-browser.js
  onDesignContext: (ctx, app) => maybeOfferLegacyBrowserWork(ctx, app),
});
