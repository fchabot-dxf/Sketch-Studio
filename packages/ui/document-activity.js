// packages/ui/document-activity.js — TASK 768: what the shown document is DOING right now, declared once per app page and read by every view of it:
// the header's Save button (save-button.js), the document tab strip (document-tabs.js) and the loading overlay (loading-overlay.js).
//   loading   a design is being opened or re-loaded and the canvas does not show it yet: the first restore of the page (the buffer's `ready`), an
//             Open of a stored design (Open…, Open recent, Projects), an Open of a design file (after the file was picked: never while the picker is up).
//             load(name, fn) runs fn as a load: the state shows from the call until fn SETTLES (resolved, thrown or cancelled = null), so it always ends.
//   saving    THE Save command (sidebar-projects.js saveNow: the Save button, Ctrl+S and the menu's Save all run it) is running for the tab `key`.
//             save(key, fn): a second call while one runs is refused (resolves null without running fn: the button never double-fires).
//   failure   the last run of that command for tab `key` threw (a file that could not be written): its message, until the next run for that tab.
// The Drive save state itself is NOT kept here: it is the project store's status(id) (drive-writer.js), read by save-state.js.
// subscribe(fn) -> unsubscribe: fn() runs on every change. Pure (no DOM).

/** TASK 768: a load that lasts longer than this shows the overlay over the work area (shorter loads only show the tab / header spinner: no flash). */
export const LOADING_OVERLAY_DELAY_MS = 400;

export function createDocumentActivity({ now = () => Date.now() } = {}) {
  const loads = [];          // the loads in flight, oldest first: { name, since }
  let saving = null;         // { key } while the Save command runs
  const failures = new Map(); // tab key -> message of its last failed Save command
  const listeners = new Set();
  const emit = () => { for (const fn of [...listeners]) fn(); };

  /** Show `name` (null = not known yet) as loading until `fn()` settles; resolves / throws what fn does. */
  async function load(name, fn) {
    const entry = { name: name || null, since: now() };
    loads.push(entry); emit();
    try { return await fn(); } finally { loads.splice(loads.indexOf(entry), 1); emit(); }
  }

  /** Run THE Save command `fn` for tab `key`; null without running it while one already runs. */
  async function save(key, fn) {
    if (saving) return null;
    saving = { key: key == null ? null : key };
    failures.delete(saving.key); emit();
    try { return await fn(); } catch (e) { failures.set(saving.key, (e && e.message) || String(e)); throw e; } finally { saving = null; emit(); }
  }

  return {
    load, save,
    /** The newest load in flight { name, since }, or null. */
    loading: () => (loads.length ? { ...loads[loads.length - 1] } : null),
    /** The tab key the Save command runs for, or undefined when it is not running. */
    savingKey: () => (saving ? saving.key : undefined),
    failure: (key) => failures.get(key) || null,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}
