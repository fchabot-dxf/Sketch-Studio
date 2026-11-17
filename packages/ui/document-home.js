// packages/ui/document-home.js — TASK 759: a document's HOME, declared once: WHERE the design shown in a tab lives, and so what Save does with it.
// Pure (no DOM): the document buffer (document-buffer.js) keeps each tab's home, the project actions (project-actions.js) run Save through
// saveRoute, and the tab strip / the menu's status line show homeLabel.
//
//   drive  the design is in the project store under `id` (Google Drive; a design made before TASK 624 may still be kept in this browser until it is moved):
//          Save writes the pending autosave now ('flush'), as before TASK 759
//   file   the design came from / was saved to a file on this device: `name` (the file name) and `handle` (the browser's handle on that file, File System
//          Access API) or null (a download / an <input type=file>, or a handle that did not survive a reload): Save writes the SAME bytes a Drive save writes
//          (#ui/project-file.js serializeProjectFile, extension .sketch.json) back to it ('write-back'), else asks for a file again where the browser
//          has a picker ('repick'), else downloads it again under the same name ('download')
//   none   a new design never saved: Save opens Save as ('save-as')
// The home is never stored anywhere new: the open-tabs buffer (which already keeps every tab's content) keeps the file NAME of a file home; the handle
// lives in the page's memory only, so after a reload a file home is "name only" (the first Save then asks for the file again, or downloads).

export const HOME_KINDS = Object.freeze({ DRIVE: 'drive', FILE: 'file', NONE: 'none' });

/** The home of a tab: `designId` (bound to a stored design) wins; else `file` ({ name, handle }); else none. */
export function homeOf({ designId = null, file = null } = {}) {
  if (designId) return { kind: HOME_KINDS.DRIVE, id: designId };
  if (file && file.name) return { kind: HOME_KINDS.FILE, name: file.name, handle: file.handle || null };
  return { kind: HOME_KINDS.NONE };
}

/** What Save does for `home`, given the browser's file capability (#ui/project-file.js fileAccess()): 'flush' | 'write-back' | 'repick' | 'download' | 'save-as'. */
export function saveRoute(home, { picker = false } = {}) {
  if (!home || home.kind === HOME_KINDS.NONE) return 'save-as';
  if (home.kind === HOME_KINDS.DRIVE) return 'flush';
  if (home.handle) return 'write-back';
  return picker ? 'repick' : 'download';
}

/** The one line that says where a tab's design lives (the tab's tooltip and the menu's status line). `where` = the store's status(id).where for a drive home. */
export function homeLabel(home, { where = 'drive' } = {}) {
  if (!home || home.kind === HOME_KINDS.NONE) return 'Not saved yet';
  if (home.kind === HOME_KINDS.DRIVE) return where === 'device' ? 'Saved on this device' : 'Saved to Google Drive';
  return `On this device: ${home.name}`;
}
