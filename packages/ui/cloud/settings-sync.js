// packages/ui/cloud/settings-sync.js — TASK 773: the user's SETTINGS follow him between devices through ONE file on his Google Drive,
// "Sketch Studio/Settings/settings.json" (the Drive adapter's settingsFile: an app-created folder and file, never listed as a project or a design).
//
// WHAT travels: only the keys #core/settings-manager.js declares in SYNCED_SETTING_KEYS, and only a value the user chose (a set() persisted on a device, or
// a reset). Every other key, the sign-in, the open tabs and every design stay on the device. The file holds settings only:
//   { "format": "sketch-studio-settings", "version": 1, "settings": { "<KEY>": { "value": <v>, "at": <ms>, "by": "<device id>" }
//                                                                  | { "reset": true, "at": <ms>, "by": "<device id>" }, ... } }
//   at = when the key was last changed (that device's clock, ms since 1970), by = a random id of the device that changed it (no account data).
// THE MERGE (mergeSettingsEntries, per KEY): the newer change wins for each key; at EQUAL times Drive's entry wins (the first to reach Drive), so every
// device ends on the same value. A key only one side has is kept. A key this version does not sync (a newer app's key) is kept in the file untouched and
// never applied here. A change made before TASK 773 has no time: it counts as time 0 (older than any timed change).
// WHEN: signed in, at app start and when the user signs in (read + merge in the background: the app has already started with the local settings and nothing
// waits on it), after a change to a synced key (debounced SETTINGS_SYNC_DEBOUNCE_MS = 2 s after the last change, then at most one Drive sync per 5 s and a
// retry with backoff 5 / 10 / 20 / 40 / 60 s: the design writer's own policy, #ui/cloud/drive-writer.js), and "Sync now". Each sync is ONE read-modify-write:
// read the file, merge, apply the keys Drive has newer (through the settings store's ordinary change notifications: the display updates, nothing else
// happens), and write the merged file only when it differs, after checking with TASK 766's rule that Drive's copy is still the one merged (the same version,
// or exactly the same content: contentPrint); otherwise read and merge again. A write stopped half way leaves Drive with this device's own merged text: the
// next read merges to the same thing, so nothing is duplicated or lost and nothing is ever a conflict.
// THE FIRM RULE: a load, save, merge, failure or conflict never reloads the app, never re-mounts a stage, never touches the open designs, the view or the
// selection, and never asks anything: it only changes settings values, exactly as the Settings panel does, and says how it went in the Settings status line
// and the Log. Signed out, nothing here runs (exactly the behaviour before TASK 773: the settings live in this browser only).
// A corrupt file is ignored (a notice in the Log) and replaced by the merged settings at the next write; a file from a NEWER format version is never read nor
// written over (a notice in the Log, the status says so); neither ever throws into the app or touches the local settings.
import SettingsManager, { isSyncedSetting } from '#core/settings-manager.js';
import { dbg } from '#core/debug.js';
import { createDriveWriter } from '#ui/cloud/drive-writer.js';
import { driveErrorText } from '#ui/cloud/drive-adapter.js';
import { contentPrint } from '#ui/cloud/content-print.js';

export const SETTINGS_FILE_FORMAT = 'sketch-studio-settings';
export const SETTINGS_FILE_VERSION = 1;
export const SETTINGS_SYNC_DEBOUNCE_MS = 2000;
export const DEVICE_ID_KEY = 'sketch-studio-device-id'; // localStorage: this browser's random device id (device-only, never synced)
const SYNC_ID = 'settings'; // the drive writer's entry
const RETRIES = 4;

/** The Settings panel's status line, one text per state (the ONE place these words live). */
export const SYNC_STATUS_TEXT = Object.freeze({
  saved: 'Settings saved to Google Drive',
  saving: 'Syncing settings with Google Drive…',
  retry: 'Could not reach Google Drive: will retry',
  newer: 'The settings on Google Drive come from a newer version of the app: kept on this device only',
  device: 'Saved on this device only (sign in to sync)',
  off: 'Saved on this device only',
});

// ---- the file ----
const validEntry = (e) => !!e && typeof e === 'object' && Number.isFinite(e.at) && e.at >= 0 && (e.by == null || typeof e.by === 'string')
  && (e.reset === true || Object.prototype.hasOwnProperty.call(e, 'value'));
const cleanEntry = (e, by = e.by) => (e.reset ? { reset: true, at: e.at, by } : { value: e.value, at: e.at, by });
const sorted = (entries) => Object.fromEntries(Object.keys(entries).sort().map((k) => [k, entries[k]]));

/** The settings file's text for these per-key entries. */
export function serializeSettingsFile(entries) {
  return JSON.stringify({ format: SETTINGS_FILE_FORMAT, version: SETTINGS_FILE_VERSION, settings: sorted(entries) }, null, 2);
}

/** Reads the file's text: { settings } (the valid entries; an invalid entry is dropped and counted in `dropped`), or { corrupt: reason } (not JSON, not
 *  this format), or { newer: version } (written by a newer app version: not to be read nor written over). Never throws. */
export function parseSettingsFile(text) {
  let o;
  try { o = JSON.parse(text); } catch (e) { return { corrupt: 'not JSON: ' + e.message }; }
  if (!o || typeof o !== 'object' || o.format !== SETTINGS_FILE_FORMAT) return { corrupt: 'not a Sketch Studio settings file' };
  if (!Number.isInteger(o.version) || o.version < 1) return { corrupt: 'no format version' };
  if (o.version > SETTINGS_FILE_VERSION) return { newer: o.version };
  if (!o.settings || typeof o.settings !== 'object' || Array.isArray(o.settings)) return { corrupt: 'no settings' };
  const settings = {};
  let dropped = 0;
  for (const [k, e] of Object.entries(o.settings)) { if (validEntry(e)) settings[k] = cleanEntry(e); else dropped++; }
  return { settings, dropped };
}

const sameEntry = (a, b) => JSON.stringify(cleanEntry(a)) === JSON.stringify(cleanEntry(b));
const sameEntries = (a, b) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));

/**
 * THE per-key merge. local = this device's entries (#core/settings-manager.js syncEntries: `by` null = this device), remote = the file's entries.
 * Returns { file: the entries the file must hold, apply: the entries this device must take from Drive }. Per key: the later `at` wins; equal `at` = Drive's
 * entry wins; a key only one side has is kept; a remote key this version does not sync is kept in `file` and never put in `apply`.
 */
export function mergeSettingsEntries(local, remote, deviceId) {
  const file = { ...remote }, apply = {};
  for (const [k, l0] of Object.entries(local)) {
    if (!isSyncedSetting(k)) continue; // a device-only key is never written to Drive
    const l = cleanEntry(l0, l0.by || deviceId), r = remote[k];
    if (!r || l.at > r.at) { file[k] = l; continue; }
    if (!sameEntry(l, r)) apply[k] = r;
  }
  for (const [k, r] of Object.entries(remote)) if (!local[k] && isSyncedSetting(k)) apply[k] = r;
  return { file, apply };
}

/** This browser's random device id (kept in `storage`; made on first use). It says which device changed a key; it identifies nothing else. */
export function deviceIdOf(storage, random = () => Math.random()) {
  const made = () => 'd-' + Array.from({ length: 12 }, () => Math.floor(random() * 36).toString(36)).join('');
  if (!storage) return made();
  let id = storage.getItem(DEVICE_ID_KEY);
  if (!id) { id = made(); storage.setItem(DEVICE_ID_KEY, id); }
  return id;
}

/**
 * createSettingsSync({ settings, file, signedIn, subscribeSignIn, deviceId, ... }) -> { status, onStatus, syncNow, destroy }
 *   settings         the settings store (#core/settings-manager.js: subscribe / syncEntries / applySynced)
 *   file             the Drive settings file: read() -> { id, version, text } | null; write(text, id | null) -> { id, version, superseded }
 *   signedIn()       is an account signed in; subscribeSignIn(fn) -> unsubscribe: fn() when that may have changed
 *   log              the Log (#core/debug.js dbg); now / setTimer / clearTimer / debounceMs / intervalMs / backoffMs injectable (tests)
 */
export function createSettingsSync({
  settings, file, signedIn, subscribeSignIn, deviceId, log = dbg,
  now = () => Date.now(), setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (t) => clearTimeout(t),
  debounceMs = SETTINGS_SYNC_DEBOUNCE_MS, intervalMs, backoffMs,
}) {
  const listeners = new Set();
  let debounce = null;
  let newer = false;              // Drive's file comes from a newer format version: nothing is written over it
  let corruptSeen = null;         // the print of the last corrupt text noticed (one Log notice per corrupt file, not one per sync)

  async function syncOnce() {
    for (let attempt = 0; attempt < RETRIES; attempt++) {
      const cur = await file.read();
      let remote = {}, readable = !!cur;
      if (cur) {
        const p = parseSettingsFile(cur.text);
        if (p.newer) {
          newer = true;
          log.warn('settings-sync', `the settings file on Google Drive has format version ${p.newer} (this app reads ${SETTINGS_FILE_VERSION}): it is left as it is, and the settings stay on this device only`);
          const e = new Error('The settings on Google Drive come from a newer version of the app'); e.permanent = true; throw e;
        }
        if (p.corrupt) {
          readable = false;
          const print = contentPrint(cur.text);
          if (print !== corruptSeen) { corruptSeen = print; log.warn('settings-sync', `the settings file on Google Drive could not be read (${p.corrupt}): it is ignored, and the settings of this device replace it`); }
        } else {
          remote = p.settings;
          if (p.dropped) log.warn('settings-sync', `${p.dropped} unreadable setting(s) in the settings file on Google Drive were ignored`);
        }
      }
      newer = false;
      const { file: merged, apply } = mergeSettingsEntries(settings.syncEntries(), remote, deviceId);
      if (Object.keys(apply).length) {
        const changed = settings.applySynced(apply);
        if (changed.length) log.log('settings-sync', `changed on another device, now applied here: ${changed.join(', ')}`);
      }
      if (readable && sameEntries(merged, remote)) return;   // Drive already holds every change: nothing to write
      if (!cur && !Object.keys(merged).length) return;        // nothing chosen on any device yet: no file is created
      if (cur) { // TASK 766's rule, just before the write: Drive's copy is still the one this merge read (the same version, or exactly the same content)
        const again = await file.read();
        if (!again || again.id !== cur.id || (again.version !== cur.version && contentPrint(again.text) !== contentPrint(cur.text))) continue;
      }
      let out;
      try { out = await file.write(serializeSettingsFile(merged), cur ? cur.id : null); }
      catch (e) { if (e && e.status === 404) continue; throw e; } // the file was deleted meanwhile: read again (it is re-created)
      if (out.superseded) continue; // another device created the file at the same moment: merge into the one that won
      // read back once: another device that read before this write and wrote just after it replaced this text: merge again, so this device's changes
      // go back on Drive now (they are never lost here either way: this device keeps them and a later sync sends them again)
      const back = await file.read();
      if (back && contentPrint(back.text) !== contentPrint(serializeSettingsFile(merged))) continue;
      return;
    }
    throw new Error('The settings file kept changing on another device');
  }

  const emit = () => { const s = status(); for (const fn of [...listeners]) fn(s); };
  const writer = createDriveWriter({
    write: () => syncOnce(),
    // the settings store already keeps every value in this browser (localStorage): the writer's local safety copy has nothing more to keep
    keepLocal: async () => {}, dropLocal: async () => {},
    describeError: driveErrorText,
    onStatus: (_id, s) => {
      if (s.state === 'failed' && signedIn()) log.warn('settings-sync', `the settings could not be synced with Google Drive (${s.reason}): this device keeps them, and the sync is retried`);
      emit();
    },
    now, setTimer, clearTimer, canWrite: signedIn,
    ...(intervalMs != null ? { intervalMs } : {}), ...(backoffMs ? { backoffMs } : {}),
  });
  const queue = () => writer.queue(SYNC_ID, { updatedAt: now() }).catch((e) => log.warn('settings-sync', 'the settings sync could not be queued', e && e.message));

  function status() {
    if (!signedIn()) return { state: 'device' };
    const w = writer.status(SYNC_ID);
    if (newer) return { state: 'newer' };
    if (w.state === 'failed') return { state: 'retry', reason: w.reason };
    if (w.state === 'saving' || debounce || w.at == null) return { state: 'saving' };
    return { state: 'saved', at: w.at };
  }

  // a change the user made here to a synced key (or a reset): synced after the debounce. A change that came FROM Drive is never sent back.
  const unsubSettings = settings.subscribe((key, _value, _all, meta) => {
    const source = meta && meta.source;
    if (!(source === 'reset' || (source === 'local' && isSyncedSetting(key)))) return;
    if (!signedIn()) return; // signed out: the change stays on this device; signing in merges it
    clearTimer(debounce);
    debounce = setTimer(() => { debounce = null; queue(); }, debounceMs);
    emit();
  });
  let wasIn = signedIn();
  const unsubSignIn = subscribeSignIn(() => {
    const isIn = signedIn();
    if (isIn && !wasIn) { log.log('settings-sync', 'signed in: merging the settings with Google Drive'); writer.resume(); queue(); }
    wasIn = isIn;
    emit();
  });
  if (wasIn) queue(); // the start: in the background, nothing waits on it

  return {
    status,
    onStatus(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    /** "Sync now": read, merge and write at once (signed in only). Resolves the status after it; never throws (a failure is a status). */
    async syncNow() {
      if (!signedIn()) { emit(); return status(); }
      clearTimer(debounce); debounce = null;
      await queue();
      await writer.flush(SYNC_ID);
      return status();
    },
    destroy() { unsubSettings(); unsubSignIn(); clearTimer(debounce); debounce = null; writer.cancel(SYNC_ID); listeners.clear(); },
  };
}

// ---- the one sync of this page ----
let active = null;
const hub = new Set();
const pageStorage = () => {
  try { return globalThis.localStorage || null; }
  catch (e) { dbg.warn('settings-sync', 'localStorage is blocked: this page gets a device id for this session only', e && e.message); return null; }
};
/** Starts THE settings sync of this page (once; app-chrome.js calls it for every app that has the projects layer: not in Fusion mode). `store` must have
 *  the Drive cloud actions (store.cloud.settingsFile) and `account` the sign-in (#ui/cloud/google-account.js); without them nothing starts. */
export function startSettingsSync({ store, account, settings = SettingsManager, storage = pageStorage() } = {}) {
  if (active) return active;
  if (!store || !store.cloud || !store.cloud.settingsFile || !account) return null;
  active = createSettingsSync({ settings, file: store.cloud.settingsFile, signedIn: () => account.state().signedIn, subscribeSignIn: (fn) => account.subscribe(fn), deviceId: deviceIdOf(storage) });
  active.onStatus((s) => { for (const fn of [...hub]) fn(s); });
  for (const fn of [...hub]) fn(active.status());
  return active;
}
/** The status of this page's settings sync ({ state: 'off' } where none runs: Fusion mode); SYNC_STATUS_TEXT[state] is its text. */
export const settingsSyncStatus = () => (active ? active.status() : { state: 'off' });
/** fn(status) whenever the status changes; returns the unsubscribe. Works before the sync starts. */
export function onSettingsSyncStatus(fn) { hub.add(fn); return () => hub.delete(fn); }
/** "Sync now" (a no-op where no sync runs). */
export const syncSettingsNow = () => (active ? active.syncNow() : Promise.resolve(settingsSyncStatus()));
