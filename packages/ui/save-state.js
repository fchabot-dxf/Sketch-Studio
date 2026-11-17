// packages/ui/save-state.js — TASK 768: THE save state of a design, declared once and read by its two views: the document tab's dot / ring (document-tabs.js)
// and the header's Save button (save-button.js). One source, two views: neither view decides a state of its own.
//
// saveStateOf({ home, needsSavePrompt, status, signedIn, saving, failure, loading }) -> { state, text }
//   home             the tab's home (document-home.js): drive | file | none
//   needsSavePrompt  the buffer's answer for that tab (document-buffer.js tabs()): 'unsaved' | 'save-failed' | null
//   status           the project store's status(designId) for a Drive home ({ where, state: 'saved' | 'saving' | 'failed', reason }), else null
//   signedIn         the Google account is signed in (a Drive design that failed while signed out is WAITING for sign-in, not broken)
//   saving           THE Save command runs for this tab now (document-activity.js savingKey)
//   failure          the message of this tab's last failed Save command (document-activity.js failure), else null
//   loading          a design is being opened / re-loaded ({ name }, document-activity.js loading), else null (the button only: a tab is not loading)
// The states, in the order they win:
//   loading  "Loading <name>…"                                      nothing can be saved until it shows
//   saving   "Saving to Google Drive…" / "Saving to <file>…"         the command runs (a file home), or the store writes the design to Drive
//   failed   the command's error / the store's reason               a press tries again
//   signin   "Not saved to Google Drive: <reason>. Kept on this device."  (the menu's status line, sidebar-projects.js): a Drive design while signed out
//   unsaved  "Changes not saved to <file>" / "Not saved yet"         a file home with changes, an Untitled with content
//   new      "Not saved yet"                                         an empty Untitled (a press opens Save as)
//   saved    "Saved to Google Drive" / "Saved on this device" / "Saved to <file>"
import { HOME_KINDS } from './document-home.js';

export const SAVE_STATES = Object.freeze({ LOADING: 'loading', SAVING: 'saving', FAILED: 'failed', SIGNIN: 'signin', UNSAVED: 'unsaved', NEW: 'new', SAVED: 'saved' });

export function saveStateOf({ home = null, needsSavePrompt = null, status = null, signedIn = true, saving = false, failure = null, loading = null } = {}) {
  const kind = home ? home.kind : HOME_KINDS.NONE;
  const file = kind === HOME_KINDS.FILE ? home.name : null;
  if (loading) return { state: SAVE_STATES.LOADING, text: loading.name ? `Loading ${loading.name}…` : 'Loading the design…' };
  if ((saving && kind !== HOME_KINDS.NONE) || (needsSavePrompt !== 'save-failed' && needsSavePrompt !== 'unsaved' && status && status.state === 'saving')) {
    return { state: SAVE_STATES.SAVING, text: file ? `Saving to ${file}…` : 'Saving to Google Drive…' };
  }
  if (failure) return { state: SAVE_STATES.FAILED, text: file ? `Not saved to ${file}: ${failure}` : `Not saved: ${failure}` };
  if (needsSavePrompt === 'save-failed') {
    const reason = (status && status.reason) || 'the last save did not go through';
    if (kind === HOME_KINDS.DRIVE && !signedIn) return { state: SAVE_STATES.SIGNIN, text: `Not saved to Google Drive: ${reason}. Kept on this device.` };
    return { state: SAVE_STATES.FAILED, text: `Not saved to Google Drive: ${reason}. Kept on this device.` };
  }
  if (needsSavePrompt === 'unsaved') return { state: SAVE_STATES.UNSAVED, text: file ? `Changes not saved to ${file}` : 'Not saved yet' };
  if (kind === HOME_KINDS.NONE) return { state: SAVE_STATES.NEW, text: 'Not saved yet' };
  if (file) return { state: SAVE_STATES.SAVED, text: `Saved to ${file}` };
  return { state: SAVE_STATES.SAVED, text: status && status.where === 'device' ? 'Saved on this device' : 'Saved to Google Drive' };
}

/** The save state of one tab of the buffer (document-buffer.js tabs() record `t`), from the store, the account and the page's activity. */
export function tabSaveState(t, { store, signedIn, activity, loading = null }) {
  const status = t.designId && store && store.status ? store.status(t.designId) : null;
  return saveStateOf({ home: t.home, needsSavePrompt: t.needsSavePrompt, status, signedIn: signedIn(), saving: activity.savingKey() === t.key, failure: activity.failure(t.key), loading });
}
