// packages/ui/sidebar-projects.js — TASK 479: the project actions + views of the shared app sidebar, wired to the project store
// (#ui/project-store.js, task 474) through each host's document buffer. ONE module, so every app gets the SAME entries:
//   main view  document name (click to rename inline) + where it lives and its save state (TASK 506) · New design · Save as… ·
//              Duplicate · Open recent (opens the PROJECT MANAGER modal on its Recent pane) · Projects (opens the PROJECT MANAGER modal, project-manager.js) · Save to Google Drive (signed in only) · Open from file ·
//              [the host's own Download actions] · GO TO (+ the account row: the Drive default toggle and connection check)
// The project manager (modal, thumbnail grid: projects, designs, every per-design / per-project action) is #ui/project-manager.js; what
// can be done with a design or a project is declared once in #ui/project-actions.js and used by both.
// A host with a Design canvas also passes `importFile(text, fileName)`: that adds "Import SVG / DXF…" next to Open from file (TASK 566).
// The host passes `getBuffer()` (its createDocumentBuffer result; it may be created lazily, so it is read at click time) and
// its own `hostActions` array. A refused open / file / delete shows the store's message in the drawer and changes nothing.
// The tab title follows the current design through the registry (appTitle).
// TASK 558 (owner rulings 2026-11-12): an unsaved Untitled with content is never replaced or left without THE question (project-actions.js
// settleUnsaved: Save… / Don't save / Cancel), asked in the UI the action came from (this drawer, or the Projects modal while it is open),
// also before a GO TO entry leaves the page. Naming an unsaved Untitled (the name heading) is its first named save. Ctrl+S: on an unsaved
// design, the Save as name prompt; on a stored one, the pending autosave is written now (nothing visible when there is nothing pending).

import { createAppSidebar, SIDEBAR_ICONS } from './app-sidebar.js';
import { getProjectStore } from './project-store.js';
import { applyAppIdentity } from './app-registry.js';
import { getGoogleAccount } from './cloud/google-account.js';
import { driveErrorText } from './cloud/drive-adapter.js';
import { createProjectActions } from './project-actions.js';
import { importSidebarAction } from './sketch-import.js';
import { openProjectManager, relativeTime } from './project-manager.js';
import SettingsManager from '#core/settings-manager.js';

export { relativeTime };

export function mountProjectSidebar({ appId, getBuffer, importFile = null, hostActions = [], store = getProjectStore(), account = getGoogleAccount() } = {}) {
  let sidebar = null;
  let currentName = 'Untitled';
  let currentDesignId = null;
  let manager = null;   // the open project manager modal, if any
  // what can be done with a design / a project: declared once (project-actions.js), shared with the project manager
  const projectActions = createProjectActions({ store, getBuffer, account, importFile, notify: (...a) => (manager ? manager.notify : sidebar.notify)(...a), ask: (spec) => (manager ? manager.ask(spec) : sidebar.ask(spec)) });
  const fail = (e) => sidebar.notify(driveErrorText(e), 'error');
  // run a store-backed action: errors stay in the drawer (nothing changed); success closes it
  const act = (fn, { close = true } = {}) => async (...args) => { try { await fn(...args); if (close) sidebar.close(); } catch (e) { fail(e); } };
  const currentId = async () => { const b = getBuffer && getBuffer(); return (b && b.designId && b.designId()) || ((await store.current()) || {}).id || null; };

  async function refreshName() {
    let c = null;
    try { c = await store.current(); } catch (_) { c = null; }
    currentName = c ? c.name : 'Untitled';
    currentDesignId = c ? c.id : null;
    if (sidebar) { sidebar.setDocName(currentName); sidebar.refreshStatus(); }
    applyAppIdentity(appId, { designName: c ? c.name : undefined });
  }

  const openDesignById = projectActions.openDesign;

  // "Projects": the modal. The drawer closes first (focus goes back to the menu button, where the modal returns it on close).
  function openManager(start) {
    if (manager) return;
    sidebar.close();
    manager = openProjectManager({ store, actions: projectActions, toolbar: projectActions.toolbarItems(), account, start, onClose: () => { manager = null; } });
  }

  const actions = [
    { id: 'new-design', label: 'New design', icon: SIDEBAR_ICONS.new, tooltip: 'Start an empty design (the current one is kept)', keepOpen: true, onClick: act(async () => { await projectActions.newDesign(); }) },
    { id: 'save-as', label: 'Save as…', icon: SIDEBAR_ICONS.save, keepOpen: true, prompt: { label: 'Save a copy as', value: () => currentName + ' copy', okLabel: 'Save' }, onClick: act(async (name) => { await projectActions.saveAs(name); }) },
    { id: 'duplicate', label: 'Duplicate', icon: SIDEBAR_ICONS.copy, keepOpen: true, onClick: act(async () => { await projectActions.duplicateCurrent(); }, { close: false }) },
    { id: 'open-recent', label: 'Open recent', icon: SIDEBAR_ICONS.recent, keepOpen: true, onClick: () => openManager('recent') },
    { id: 'projects', label: 'Projects', icon: SIDEBAR_ICONS.folder, keepOpen: true, onClick: () => openManager('projects') },
    { divider: true },
    { id: 'save-drive', label: 'Save to Google Drive', icon: SIDEBAR_ICONS.cloud, keepOpen: true, tooltip: 'Save this design into the "My Designs" project on your Google Drive (the rest of its project stays on this device)',
      visible: () => !!(account && account.state().signedIn && store.cloud),
      onClick: act(async () => { await projectActions.saveCurrentToDrive(); }, { close: false }) },
    { id: 'open-file', label: 'Open from file', icon: SIDEBAR_ICONS.open, keepOpen: true, onClick: act(async () => { await projectActions.openFile(); }) },
    ...(importFile ? [importSidebarAction({ importFile, getSidebar: () => sidebar, icon: SIDEBAR_ICONS.open })] : []),
    ...(hostActions.length ? [{ divider: true }, ...hostActions] : []),
  ];

  // The one-line state under the document name, derived from the store (where the current design lives + how its last save went).
  const statusLine = () => {
    const s = store.status ? store.status(currentDesignId) : { where: 'device', state: 'saved', at: null, reason: null };
    if (s.notice) return { kind: 'error', text: s.notice };
    if (s.state === 'failed' || (s.where === 'device' && s.reason)) return { kind: 'error', text: `Not saved to Google Drive: ${s.reason}. Kept on this device.` };
    if (s.where === 'device') return { kind: 'info', text: 'Saved on this device' };
    if (s.state === 'saving') return { kind: 'info', text: 'Saving to Google Drive...' };
    return { kind: 'info', text: 'Saved to Google Drive' + (s.at ? ', ' + relativeTime(s.at) : '') };
  };
  const driveControls = store.cloud ? {
    getDefault: () => SettingsManager.get('DRIVE_DEFAULT') !== false,
    setDefault: (on) => SettingsManager.set('DRIVE_DEFAULT', !!on),
    check: (onSteps) => store.cloud.checkConnection(onSteps),
  } : null;

  sidebar = createAppSidebar({
    current: appId, docName: currentName, actions, account, driveControls, status: statusLine,
    beforeGoTo: () => projectActions.settleUnsaved(),
    onRenameDoc: (name) => act(async () => {
      const b = getBuffer && getBuffer();
      if (b && !b.isStored()) { await b.saveAs(name); return; } // naming an unsaved Untitled is its first named save
      const id = await currentId();
      if (!id) throw new Error('This design is not saved yet. Save it with a name first (Save as…).'); // TASK 558: an unsaved Untitled is named by its first save
      await store.rename(id, name);
    }, { close: false })(),
  });
  store.subscribe(refreshName);
  refreshName();

  // Ctrl+S (Cmd+S): save. Captured on the window, before the canvas shortcuts (where a bare "s" picks the Select tool) and the browser's
  // own "save page".
  async function saveNow() {
    const b = getBuffer && getBuffer();
    if (!b) return;
    await b.ready; // a stored design may still be restoring: it is not an Untitled
    if (b.isStored()) { await b.flush(); return; }
    const name = await sidebar.ask({ kind: 'prompt', label: 'Save as', value: b.designName(), okLabel: 'Save' });
    if (!name) { sidebar.close(); return; }
    await b.saveAs(name);
    sidebar.close();
  }
  window.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || (e.key !== 's' && e.key !== 'S')) return;
    e.preventDefault(); e.stopImmediatePropagation();
    saveNow().catch(fail);
  }, true);
  return sidebar;
}
