// packages/ui/sidebar-projects.js — TASK 479: the project actions + views of the shared app sidebar, wired to the project store
// (#ui/project-store.js, task 474) through each host's document buffer. ONE module, so every app gets the SAME entries:
//   main view  document name (click to rename inline) + where it lives and its save state (TASK 506) · New design (the template modal, Blank design first) · Templates… (the same modal, Blank design first) · Save as… ·
//              Duplicate · Open recent (opens the PROJECT MANAGER modal on its Recent pane) · Projects (opens the PROJECT MANAGER modal, project-manager.js) · Save to Google Drive (signed in only) · Open from file ·
//              [the host's own Download actions]. The ACCOUNT is not in the drawer: it is the avatar at the right end of the header (TASK 776, account-avatar.js)
// The project manager (modal, thumbnail grid: projects, designs, every per-design / per-project action) is #ui/project-manager.js; what
// can be done with a design or a project is declared once in #ui/project-actions.js and used by both.
// A host with a Design canvas also passes `importFile(text, fileName)`: that adds "Import SVG / DXF…" next to Open from file (TASK 566).
// The host passes `getBuffer()` (its createDocumentBuffer result; it may be created lazily, so it is read at click time) and
// its own `hostActions` array. A refused open / file / delete shows the store's message in the drawer and changes nothing.
// The tab title follows the current design through the registry (appTitle).
// TASK 558 (owner rulings 2026-11-12): an unsaved Untitled with content is never replaced or left without THE question (project-actions.js
// settleUnsaved: Save… / Don't save / Cancel), asked in the UI the action came from (this drawer, or the Projects modal while it is open).
// Naming an unsaved Untitled (the name heading) is its first named save. Ctrl+S: on an unsaved
// design, the Save as name prompt; on a stored one, the pending autosave is written now (nothing visible when there is nothing pending).
// TASK 759: the menu has Save (Ctrl+S: to the design's HOME, #ui/document-home.js), Save as… (THE Save as dialog, Google Drive | Local) and Open… (THE Open
// dialog, same tabs; the item keeps its id 'open-file'); a design file (.sketch.json) dropped on a host's drawing (its import drop target) opens as a tab.
// Nothing here asks a signed-out user to sign in: Drive's sign-in is inside the dialogs' Drive tab and in the header's account avatar menu.

import { createAppSidebar, SIDEBAR_ICONS } from './app-sidebar.js';
import { getProjectStore } from './project-store.js';
import { applyAppIdentity } from './app-registry.js';
import { getGoogleAccount } from './cloud/google-account.js';
import { driveErrorText, driveFolderUrl } from './cloud/drive-adapter.js';
import { createProjectActions } from './project-actions.js';
import { createDocumentTabs } from './document-tabs.js';
import { importSidebarAction } from './sketch-import.js';
import { openProjectManager, relativeTime } from './project-manager.js';
import { openTemplatePicker, openChoiceModal, openPromptModal } from './template-picker.js';
import { matchesShortcut } from '#ui/shortcuts.js'; // TASK 727: the keys are declared there
import { OPEN_DOCUMENT_EVENT } from './sketch-import.js'; // TASK 759: a design file dropped on a drawing
import { homeLabel, HOME_KINDS } from './document-home.js';
// TASK 768: THE Save button (save-button.js; TASK 776: in the footer's right end, footer-slot.js), the loading tab and the loading overlay,
// all reading this page's ONE document activity (document-activity.js) and THE save state (save-state.js); mounted with the document tab strip.
import { createDocumentActivity } from './document-activity.js';
import { createSaveButton } from './save-button.js';
import { mountLoadingOverlay } from './loading-overlay.js';
import { saveStateOf, tabSaveState } from './save-state.js';
import { findFooterEnd } from './footer-slot.js'; // TASK 776: the footer's right end: THE Save button and THE account avatar live there
import { createAccountAvatar } from './account-avatar.js'; // TASK 776: THE account control (the avatar at the right end of the header / of the tab strip)
import { openFeedback, feedbackMenuItem, FEEDBACK_ICON } from './feedback.js'; // TASK 830: the "Rate & feedback" entry, in every app's menu

export { relativeTime };

// TASK 587: `documentTabs: true` opts the host into DOCUMENT TABS (document-tabs.js; docs/DOCUMENT-TABS-DESIGN.md): the strip is inserted as its own row
// immediately AFTER the host's <header> (the element holding this sidebar's button; TASK 602, owner: between the header and the tool ribbon), Open / Open recent / Open from file / New open a new tab, and the name,
// status line and page title below follow the ACTIVE tab's design (the buffer's), not the device-wide "current" pointer. A host without it is unchanged.
// TASK 663: `projects: false` opts the host out of the project/file layer (document name/status header, New/Templates/Save/Duplicate/Open recent/Projects/Open file/Import file actions, Drive/Google account controls, Projects modal, document tab strip, Ctrl+S save prompt, and unsaved-leave prompt) while keeping `hostActions` and the stage switcher.
export function mountProjectSidebar({ appId, getBuffer, importFile = null, hostActions = [], documentTabs = false, projects = true, store = getProjectStore(), account = getGoogleAccount(), stages = [], activeStage = null, onStageChange = null } = {}) {
  let sidebar = null;
  let currentName = 'Untitled';
  let currentDesignId = null;
  let manager = null;   // the open project manager modal, if any
  const showDocumentTabs = Boolean(documentTabs && projects);
  const activity = createDocumentActivity(); // TASK 768: what the shown document is doing (loading / THE Save command), for every view of it
  const signedIn = () => !account || account.state().signedIn;
  // what can be done with a design / a project: declared once (project-actions.js), shared with the project manager
  const projectActions = projects ? createProjectActions({ store, getBuffer, account, importFile, tabs: showDocumentTabs, pickTemplate: openTemplatePicker, chooseModal: openChoiceModal, promptModal: openPromptModal, notify: (...a) => (manager ? manager.notify : sidebar.notify)(...a), ask: (spec) => (manager ? manager.ask(spec) : sidebar.ask(spec)), openProjects: () => openManager('projects'), activity }) : null;
  const fail = (e) => sidebar.notify(driveErrorText(e), 'error');
  // run a store-backed action: errors stay in the drawer (nothing changed); success closes it
  const act = (fn, { close = true } = {}) => async (...args) => { try { await fn(...args); if (close) sidebar.close(); } catch (e) { fail(e); } };
  const currentId = async () => { const b = getBuffer && getBuffer(); return (b && b.designId && b.designId()) || ((await store.current()) || {}).id || null; };

  async function refreshName() {
    if (!projects) return;
    let c = null;
    try {
      const b = showDocumentTabs && getBuffer && getBuffer();
      const id = b ? b.designId() : null;
      c = showDocumentTabs ? (id ? await store.get(id) : null) : await store.current(); // with tabs: the design SHOWN (the active tab's), not the device-wide pointer
    } catch (_) { c = null; }
    const live = getBuffer && getBuffer();
    currentName = c ? c.name : (live && live.designName ? live.designName() : 'Untitled'); // an unsaved design started from a template carries its name (TASK 651)
    currentDesignId = c ? c.id : null;
    if (sidebar) { sidebar.setDocName(currentName); sidebar.refreshStatus(); }
    const fileName = !c && live && live.home && live.home().kind === HOME_KINDS.FILE ? live.designName() : undefined; // TASK 759: a file home names the page too
    applyAppIdentity(appId, { designName: c ? c.name : fileName });
  }

  // "Projects": the modal. The drawer closes first (focus goes back to the menu button, where the modal returns it on close).
  function openManager(start) {
    if (!projects || manager) return;
    sidebar.close();
    manager = openProjectManager({ store, actions: projectActions, toolbar: projectActions.toolbarItems(), account, start, onClose: () => { manager = null; } });
  }

  // TASK 830: always available, in every app (with or without the project layer); the window is shared (feedback.js)
  const feedbackItem = feedbackMenuItem({ icon: FEEDBACK_ICON, onClick: () => { openFeedback(); } }); // the drawer closes itself (no keepOpen)
  const actions = projects ? [
    { id: 'new-design', label: 'New design', icon: SIDEBAR_ICONS.new, tooltip: 'Start an empty design (the current one is kept)', keepOpen: true, onClick: act(async () => { await projectActions.newDesign(); await refreshName(); }) },
    // TASK 651 / 668: the same template modal the "+" tab button and New design open (Blank design first, one picker configuration)
    { id: 'templates', label: 'Templates…', icon: SIDEBAR_ICONS.templates, tooltip: 'Start a new design from a template drawing', keepOpen: true, onClick: act(async () => { sidebar.close(); await projectActions.newDesign(); await refreshName(); }, { close: false }) },
    // TASK 759: Save = to the design's home (Ctrl+S); Save as… = THE Save as dialog (Google Drive | Local)
    { id: 'save', label: 'Save', icon: SIDEBAR_ICONS.save, tooltip: 'Save to where this design lives (Ctrl+S)', keepOpen: true, onClick: act(async () => { if (await saveNow()) sidebar.close(); }, { close: false }) },
    { id: 'save-as', label: 'Save as…', icon: SIDEBAR_ICONS.save, keepOpen: true, onClick: act(async () => { sidebar.close(); afterSave(await projectActions.saveAsDialog()); await refreshName(); }, { close: false }) },
    { id: 'duplicate', label: 'Duplicate', icon: SIDEBAR_ICONS.copy, keepOpen: true, onClick: act(async () => { await projectActions.duplicateCurrent(); }, { close: false }) },
    { id: 'open-recent', label: 'Open recent', icon: SIDEBAR_ICONS.recent, keepOpen: true, onClick: () => openManager('recent') },
    { id: 'projects', label: 'Projects', icon: SIDEBAR_ICONS.folder, keepOpen: true, onClick: () => openManager('projects') },
    { divider: true },
    // TASK 759: THE Open dialog (Google Drive | Local); the id stays 'open-file' (it was "Open from file", now its Local tab)
    { id: 'open-file', label: 'Open…', icon: SIDEBAR_ICONS.open, tooltip: 'Open a design from Google Drive or from a file on this device', keepOpen: true, onClick: act(async () => { sidebar.close(); await projectActions.openDialog(); await refreshName(); }, { close: false }) },
    ...(importFile ? [importSidebarAction({ importFile, getSidebar: () => sidebar, icon: SIDEBAR_ICONS.open })] : []),
    ...(hostActions.length ? [{ divider: true }, ...hostActions] : []),
    { divider: true }, feedbackItem, // TASK 830
  ] : [...hostActions, ...(hostActions.length ? [{ divider: true }] : []), feedbackItem];

  // The one-line state under the document name, derived from the store (where the current design lives + how its last save went).
  const statusLine = () => {
    const live = getBuffer && getBuffer();
    const home = live && live.home ? live.home() : null;
    if (home && home.kind === HOME_KINDS.FILE) { // TASK 759: a design whose home is a file on this device
      return { kind: 'info', text: homeLabel(home) + (live.needsSavePrompt() === 'unsaved' ? ' (changes not saved yet)' : '') };
    }
    const s = store.status ? store.status(currentDesignId) : { where: 'device', state: 'saved', at: null, reason: null };
    // TASK 766: another device changed the shown design on Drive: the running design stays as it is until the user chooses to load Drive's version
    const driveVersion = live && live.driveChanged && live.driveChanged()
      ? { action: { id: 'load-drive-version', label: 'Load the Drive version', onClick: act(async () => { await live.loadDriveVersion(); await refreshName(); }) } } : {};
    if (s.notice) return { kind: 'error', text: s.notice, ...driveVersion };
    if (s.state === 'failed' || (s.where === 'device' && s.reason)) return { kind: 'error', text: `Not saved to Google Drive: ${s.reason}. Kept on this device.` };
    if (!currentDesignId) return { kind: 'info', text: 'Not saved yet' };
    if (s.where === 'device') {
      return {
        kind: 'info',
        text: 'Saved on this device',
        ...(store.cloud ? { action: { id: 'move-to-drive', label: 'Move to Google Drive', onClick: act(async () => { await projectActions.moveCurrentProjectToDrive(); await refreshName(); }, { close: false }) } } : {}),
      };
    }
    if (s.state === 'saving') return { kind: 'info', text: 'Saving to Google Drive...' };
    return {
      kind: 'info',
      text: 'Saved to Google Drive' + (s.at ? ', ' + relativeTime(s.at) : ''),
      ...(s.projectId ? { action: { id: 'open-in-drive', label: 'Open in Drive', href: driveFolderUrl(s.projectId) } } : {}),
    };
  };
  const driveControls = (projects && store.cloud) ? {
    check: (onSteps) => store.cloud.checkConnection(onSteps),
  } : null;

  sidebar = createAppSidebar({
    current: appId,
    docName: projects ? currentName : null,
    actions,
    status: projects ? statusLine : null,
    stages, activeStage, onStageChange,
    onRenameDoc: projects ? (name) => act(async () => {
      const b = getBuffer && getBuffer();
      if (b && !b.isStored()) { // TASK 759: never a sign-in question here
        if (b.home().kind === HOME_KINDS.FILE) { await b.rename(name); await refreshName(); return; } // a file home: the name its next Save writes
        if (projectActions.driveReady()) { await b.saveAs(name); return; } // naming an unsaved Untitled is its first named save (Drive ready: as before)
        await projectActions.saveAsDialog({ name }); await refreshName(); return; // signed out: the Save as dialog, with that name
      }
      const id = await currentId();
      if (!id) throw new Error('This design is not saved yet. Save it with a name first (Save as…).'); // TASK 558: an unsaved Untitled is named by its first save
      await store.rename(id, name);
    }, { close: false })() : null,
  });
  if (projects) {
    store.subscribe(refreshName);
    refreshName();
  }

  let tabStrip = null;
  let tabObserver = null;
  let saveButton = null, overlay = null;
  let shownTabs = null; // the tabs as the strip last read them (null before the first restore)
  // TASK 776: THE account control: the avatar at the far right of the footer (footer-slot.js); the drawer has no account row
  const avatar = projects && account ? createAccountAvatar({ account, check: driveControls ? driveControls.check : null }) : null;
  if (showDocumentTabs) {
    // TASK 768: the button shows the ACTIVE tab's save state (or the load in flight); a press runs saveNow, THE Save command (Ctrl+S, the menu's Save)
    saveButton = createSaveButton({
      getState: () => {
        const load = activity.loading();
        const t = shownTabs && shownTabs.find((x) => x.active);
        return load || !t ? saveStateOf({ loading: load }) : tabSaveState(t, { store, signedIn, activity });
      },
      onPress: () => { saveNow().catch(fail); },
    });
    tabStrip = createDocumentTabs({ getBuffer, store, actions: { activateTab: projectActions.activateTab, closeTab: projectActions.closeTab, newDesign: projectActions.newDesign }, onChange: refreshName,
      activity, signedIn, onRefresh: (list) => { shownTabs = list; saveButton.refresh(); } });
    overlay = mountLoadingOverlay({ activity, below: () => tabStrip.el });
  }
  // the tab strip goes below the host's <header> (whose menu button this sidebar owns); THE Save button and THE avatar go into the footer's right end (the host mounts the
  // footer too, in any order: place each as soon as its place exists)
  let stripPlaced = !tabStrip, controlsPlaced = !(saveButton || avatar);
  const place = () => {
    if (!stripPlaced) {
      const header = sidebar.el.closest('header');
      if (header && header.parentNode) { header.parentNode.insertBefore(tabStrip.el, header.nextSibling); stripPlaced = true; } // TASK 602 (owner): below the header, above the ribbon
    }
    if (!controlsPlaced) {
      const slot = findFooterEnd();
      if (slot) { if (saveButton) saveButton.placeIn(slot); if (avatar) avatar.placeIn(slot); controlsPlaced = true; } // TASK 776: Save, then the avatar (the far right)
    }
    return stripPlaced && controlsPlaced;
  };
  if (!place()) {
    tabObserver = new MutationObserver(() => { if (place()) { tabObserver.disconnect(); tabObserver = null; } });
    tabObserver.observe(document.documentElement, { childList: true, subtree: true });
  }

  // Ctrl+S (Cmd+S): save. Captured on the window, before the canvas shortcuts (where a bare "s" picks the Select tool) and the browser's
  // own "save page".
  // TASK 759: to the design's HOME (project-actions.js save): Drive -> the pending autosave now; a file -> back to it; none -> the Save as dialog.
  const noted = new Set(); // the tabs (keys) already told that their Save downloads the file again (said ONCE per design)
  function afterSave(r) {
    if (!r || !(r.route === 'download' || r.downloaded)) return r;
    const b = getBuffer && getBuffer();
    const t = b && b.tabs ? b.tabs().find((x) => x.active) : null;
    const key = t ? t.key : '';
    if (noted.has(key)) return r;
    noted.add(key);
    const text = `Saved "${r.name}" as a download: this browser cannot write to the file itself, so each Save downloads it again.`;
    if (tabStrip) tabStrip.note(text); else sidebar.notify(text, 'info');
    return r;
  }
  // TASK 768: run through the page's activity (the Save button and the tab show it running; a second press / Ctrl+S while it runs does nothing)
  async function saveNow() {
    const b = getBuffer && getBuffer();
    if (!b) return null;
    await b.ready; // a stored design may still be restoring: it is not an Untitled
    const t = b.tabs().find((x) => x.active);
    return activity.save(t ? t.key : null, async () => {
      const r = afterSave(await projectActions.save());
      await refreshName();
      return r;
    });
  }
  const onKeyDown = projects ? (e) => {
    if (!matchesShortcut(e, 'file.save')) return;
    e.preventDefault(); e.stopImmediatePropagation();
    saveNow().catch(fail);
  } : null;
  if (onKeyDown) window.addEventListener('keydown', onKeyDown, true);
  // TASK 759: a design file dropped on a host's drawing (sketch-import.js mountImportDrop announces it) opens as a document, with no account
  const onDropDocument = projects ? (e) => {
    e.preventDefault(); // handled: the drop target does not import it as a drawing
    projectActions.openDroppedFile(e.detail).then(() => refreshName()).catch(fail);
  } : null;
  if (onDropDocument) window.addEventListener(OPEN_DOCUMENT_EVENT, onDropDocument);
  const baseDestroy = sidebar.destroy;
  return {
    ...sidebar,
    destroy() {
      if (onKeyDown) window.removeEventListener('keydown', onKeyDown, true);
      if (onDropDocument) window.removeEventListener(OPEN_DOCUMENT_EVENT, onDropDocument);
      if (tabObserver) { tabObserver.disconnect(); tabObserver = null; }
      if (tabStrip) { tabStrip.destroy(); tabStrip = null; }
      if (saveButton) { saveButton.destroy(); saveButton = null; }
      if (avatar) avatar.destroy();
      if (overlay) { overlay.destroy(); overlay = null; }
      baseDestroy();
    },
  };
}
