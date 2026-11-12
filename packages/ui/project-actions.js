// packages/ui/project-actions.js — TASK 547: the ONE declaration of what you can do with a design and with a project.
// The project manager modal (project-manager.js) and the sidebar's main menu (sidebar-projects.js) both take their actions from here,
// so no action exists twice. Every action is data: { id, label, visible?, ask?, closes?, run(arg) }.
//   ask: { kind: 'confirm', text, okLabel } | { kind: 'prompt', label, value, okLabel } | { kind: 'choose', label, options: [{ id, label }] }
//        the UI asks first and passes the answer (the text, or the chosen option id) to run(arg); no `ask` = run at once.
//   closes: the UI closes itself after a successful run (Open); run returning null means "cancelled" (a file picker) and keeps it open.
//   visible: false hides the action (Save to Google Drive when signed out).
// Failures THROW (a readable message); the UI shows it and changes nothing.

import { driveFileUrl } from './cloud/drive-adapter.js';

export function createProjectActions({ store, getBuffer, account = null, notify = () => {} }) {
  const buf = () => { const b = getBuffer && getBuffer(); if (!b) throw new Error('This app is still starting. Try again in a moment.'); return b; };
  const signedInDrive = () => !!(account && account.state().signedIn && store.cloud);

  async function openDesign(id) {
    const out = await buf().openDesign(id);
    if (!out.restored) throw new Error(out.reason || 'This design could not be opened.');
  }
  async function duplicateDesign(id) {
    await buf().flush();
    if (!id) throw new Error('Nothing to duplicate yet — draw something first.');
    const d = await store.duplicate(id);
    notify(`Duplicated as "${d.name}" (find it under Open recent).`, 'info');
    return d;
  }
  async function saveDesignToDrive(id) {
    await buf().flush();
    if (!id) throw new Error('Nothing to save yet — draw something first.');
    const r = await store.cloud.saveToDrive(id);
    notify('Saved to Google Drive', 'info', { href: driveFileUrl(r.fileId), label: 'Open in Drive' });
  }
  const saveDesignToFile = (id) => buf().saveFile(undefined, id);

  /** The actions of one design `d` (a store design row); `projects` = the project rows, for "Move to…". */
  function designItems(d, { projects = [] } = {}) {
    return [
      { id: 'open', label: 'Open', closes: true, run: () => openDesign(d.id) },
      { id: 'rename', label: 'Rename', ask: { kind: 'prompt', label: 'Rename design', value: d.name, okLabel: 'Rename' }, run: (name) => store.rename(d.id, name) },
      { id: 'duplicate', label: 'Duplicate', run: () => duplicateDesign(d.id) },
      { id: 'move', label: 'Move to…', visible: projects.some((p) => p.id !== d.projectId),
        ask: { kind: 'choose', label: 'Move to', options: projects.filter((p) => p.id !== d.projectId).map((p) => ({ id: p.id, label: p.name })) }, run: (projectId) => store.moveDesign(d.id, projectId) },
      { id: 'save-file', label: 'Save to file', run: () => saveDesignToFile(d.id) },
      { id: 'save-drive', label: 'Save to Google Drive', visible: signedInDrive(), run: () => saveDesignToDrive(d.id) },
      { id: 'delete', label: 'Delete', ask: { kind: 'confirm', text: `Delete "${d.name}"?`, okLabel: 'Delete' }, run: () => store.remove(d.id) },
    ].filter((a) => a.visible !== false);
  }

  /** The actions of one project row `p`. */
  function projectItems(p) {
    const drive = signedInDrive();
    return [
      ...(drive && p.location === 'drive' ? [{ id: 'make-local', label: 'Make local', ask: { kind: 'confirm', okLabel: 'Make local', text: `Make "${p.name}" local? It will be copied from Google Drive to this device and checked, and only then is the Drive copy removed.` }, run: () => store.cloud.makeProjectLocal(p.id) }] : []),
      ...(drive && p.location !== 'drive' ? [{ id: 'use-drive', label: 'Use Google Drive', ask: { kind: 'confirm', okLabel: 'Use Google Drive', text: `Use Google Drive for "${p.name}"? It will be copied to your Google Drive and checked, and only then is the copy on this device removed.` }, run: () => store.cloud.moveProjectToDrive(p.id) }] : []),
      { id: 'rename', label: 'Rename', ask: { kind: 'prompt', label: 'Rename project', value: p.name, okLabel: 'Rename' }, run: (name) => store.renameProject(p.id, name) },
      { id: 'pin', label: p.pinned ? 'Unpin' : 'Pin', run: () => store.pinProject(p.id, !p.pinned) },
      { id: 'delete', label: 'Delete', ask: { kind: 'confirm', text: `Delete project "${p.name}"?`, okLabel: 'Delete' }, run: () => store.removeProject(p.id) },
    ];
  }

  // the CURRENT design of the host's buffer (its id may only exist after the pending edits are saved, hence flush first)
  const duplicateCurrent = async () => { const b = buf(); await b.flush(); return duplicateDesign(b.designId()); };
  const saveCurrentToDrive = async () => { const b = buf(); await b.flush(); return saveDesignToDrive(b.designId()); };
  const saveAs = (name) => buf().saveAs(name);
  const newDesign = () => buf().newDesign();
  const openFile = () => buf().openFile();

  /** The project manager's toolbar. */
  function toolbarItems() {
    return [
      { id: 'new-project', label: 'New project', ask: { kind: 'prompt', label: 'New project', value: 'New project', okLabel: 'Create' }, run: (name) => store.createProject(name) },
      { id: 'new-design', label: 'New design', closes: true, run: () => newDesign() },
      { id: 'open-file', label: 'Open from file', closes: true, run: () => openFile() },
    ];
  }

  return { duplicateCurrent, saveCurrentToDrive, saveAs, newDesign, openFile, toolbarItems, openDesign, duplicateDesign, saveDesignToDrive, saveDesignToFile, designItems, projectItems };
}
