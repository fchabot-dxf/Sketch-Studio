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
  const projectActions = createProjectActions({ store, getBuffer, account, importFile, notify: (...a) => (manager ? manager.notify : sidebar.notify)(...a) });
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
    onRenameDoc: (name) => act(async () => {
      const id = await currentId();
      if (!id) throw new Error('Nothing to rename yet — draw something first.');
      await store.rename(id, name);
    }, { close: false })(),
  });
  store.subscribe(refreshName);
  refreshName();
  return sidebar;
}
