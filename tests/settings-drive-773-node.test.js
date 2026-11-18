// tests/settings-drive-773-node.test.js — TASK 773: the user's settings follow him between devices through "Sketch Studio/Settings/settings.json" on his
// Google Drive. FAKE Drive only (tests/harness/fake-drive.js: no Google call), fake clock and timers, two "devices" = two settings stores (each its own
// storage) over the SAME fake Drive, each with its own Drive adapter (its own local meta), exactly the app's code (createSettingsSync / the Drive adapter's
// settingsFile / the settings manager's syncEntries + applySynced).
//   1 the per-key merge (pure): newer wins per key, equal times, missing keys, unknown keys kept, a device-only key never serialised
//   2 two devices, different keys at the same time: both survive on both; the same key: the newer wins on both
//   3 a concurrent writer between this device's read and its write (the 766 guard): re-read and merged, nothing lost
//   4 a request failing mid-save (766's case: the content landed, the version read failed; and a create whose listing failed): no duplicate, no loss,
//     no conflicted copy
//   5 a corrupt file and a newer-format file: a Log notice, never a throw, the local settings never wiped; the newer file never written over
//   6 reset: the synced keys are reset in the file too (with new times) and the reset follows the user to the other device
//   7 the Settings folder and file are hidden from the projects / designs lists (the router's and the store's too); a user's own project "Settings" stays
//   8 signed out = no Drive request at all; signing in merges (a change made while signed out is kept when newer); the debounce; a change received from
//     Drive is never sent back; two devices creating the folder at the same moment leave ONE folder and ONE file
import assert from 'node:assert';
import { createFakeDrive } from './harness/fake-drive.js';
import { createDriveAdapter, SETTINGS_FOLDER_NAME, SETTINGS_FILE_NAME } from '../packages/ui/cloud/drive-adapter.js';
import { createRouterAdapter } from '../packages/ui/cloud/router-adapter.js';
import { createProjectStore, createMemoryAdapter } from '../packages/ui/project-store.js';
import { createSettingsManager, SYNCED_SETTING_KEYS } from '../packages/core/settings-manager.js';
import { createSettingsSync, mergeSettingsEntries, parseSettingsFile, serializeSettingsFile, SETTINGS_SYNC_DEBOUNCE_MS, SETTINGS_FILE_FORMAT } from '../packages/ui/cloud/settings-sync.js';
import { STYLE_SETTING_KEYS } from '../packages/ui/style-templates.js';

let clock = Date.UTC(2026, 10, 18, 9, 0, 0);
let timers = []; let seq = 0;
const now = () => clock;
const setTimer = (fn, ms) => { const t = { fn, at: clock + ms, id: ++seq }; timers.push(t); return t; };
const clearTimer = (t) => { timers = timers.filter((x) => x !== t); };
const settle = async () => { for (let i = 0; i < 60; i++) await new Promise((r) => setImmediate(r)); };
async function advance(ms) {
  const end = clock + ms;
  for (;;) {
    await settle();
    const due = timers.filter((t) => t.at <= end).sort((a, b) => a.at - b.at || a.id - b.id)[0];
    if (!due) { clock = end; await settle(); return; }
    timers = timers.filter((t) => t !== due); clock = Math.max(clock, due.at); due.fn();
  }
}
const memStorage = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), map: m }; };
const accountFor = (drive) => ({ authedFetch: (url, opts = {}) => drive.fetch(url, { ...opts, headers: { Authorization: 'Bearer ' + drive.token, ...(opts.headers || {}) } }) });
const quietLog = () => { const lines = []; return { lines, log: (c, ...a) => lines.push(['log', a.join(' ')]), warn: (c, ...a) => lines.push(['warn', a.join(' ')]), debug: () => {}, error: (c, ...a) => lines.push(['error', a.join(' ')]) }; };
const settingsFileOf = (drive) => [...drive.files.values()].filter((f) => f.name === SETTINGS_FILE_NAME && !f.trashed);
const settingsFoldersOf = (drive) => [...drive.files.values()].filter((f) => f.name === SETTINGS_FOLDER_NAME && f.mimeType === 'application/vnd.google-apps.folder' && !f.trashed);
const fileEntries = (drive) => { const f = settingsFileOf(drive); assert.strictEqual(f.length, 1, 'ONE settings file'); return parseSettingsFile(f[0].content).settings; };

/** A "device": its own settings store (own storage), its own Drive adapter (own local meta), its own sync, on the shared fake Drive. */
function device(drive, name, { signedIn = true } = {}) {
  const storage = memStorage();
  const settings = createSettingsManager({ storage, now });
  const adapter = createDriveAdapter({ account: accountFor(drive), meta: createMemoryAdapter() });
  const state = { signedIn };
  const signListeners = new Set();
  const L = quietLog();
  let file = adapter.settingsFile;
  const d = {
    name, storage, settings, adapter, log: L,
    setFile: (f) => { file = f; },
    signIn: () => { state.signedIn = true; for (const fn of signListeners) fn(); },
    signOut: () => { state.signedIn = false; for (const fn of signListeners) fn(); },
  };
  d.sync = createSettingsSync({
    settings, file: { read: () => file.read(), write: (t, id) => file.write(t, id) }, signedIn: () => state.signedIn, subscribeSignIn: (fn) => { signListeners.add(fn); return () => signListeners.delete(fn); },
    deviceId: 'dev-' + name, log: L, now, setTimer, clearTimer,
  });
  return d;
}

// ---- 1. the per-key merge (pure) ----
{
  const local = {
    DOC_UNIT: { value: 'in', at: 200, by: null },             // newer here
    SHORTCUT_KEYS: { value: { v: 1, keys: { line: ['l'] } }, at: 50, by: null }, // older here
    GRID_MODE: { value: 'points', at: 100, by: null },        // equal time
    LENGTH_PRECISION: { value: 4, at: 10, by: null },         // only here
  };
  const remote = {
    DOC_UNIT: { value: 'mm', at: 100, by: 'dev-B' },
    SHORTCUT_KEYS: { value: { v: 1, keys: { line: ['k'] } }, at: 300, by: 'dev-B' },
    GRID_MODE: { value: 'off', at: 100, by: 'dev-B' },
    ANGLE_PRECISION: { value: 2, at: 5, by: 'dev-B' },        // only on Drive
    FUTURE_KEY: { value: 'x', at: 1, by: 'dev-Z' },           // a key a newer app version syncs
  };
  const { file, apply } = mergeSettingsEntries(local, remote, 'dev-A');
  assert.deepStrictEqual(file.DOC_UNIT, { value: 'in', at: 200, by: 'dev-A' }, 'merge: the newer local change goes to the file, marked with this device');
  assert.deepStrictEqual(apply.SHORTCUT_KEYS, remote.SHORTCUT_KEYS, 'merge: the newer Drive change is applied here');
  assert.deepStrictEqual(file.SHORTCUT_KEYS, remote.SHORTCUT_KEYS, 'merge: ... and stays in the file');
  assert.deepStrictEqual([file.GRID_MODE, apply.GRID_MODE], [remote.GRID_MODE, remote.GRID_MODE], 'merge: EQUAL times: Drive\'s entry wins (every device ends on the same value)');
  assert.deepStrictEqual(file.LENGTH_PRECISION, { value: 4, at: 10, by: 'dev-A' }, 'merge: a key only this device has goes to the file');
  assert.deepStrictEqual(apply.ANGLE_PRECISION, remote.ANGLE_PRECISION, 'merge: a key only Drive has is applied here');
  assert.deepStrictEqual(file.FUTURE_KEY, remote.FUTURE_KEY, 'merge: an unknown key is kept in the file untouched (forward compatibility)');
  assert.ok(!('FUTURE_KEY' in apply), 'merge: an unknown key is never applied here');
  assert.ok(!('DOC_UNIT' in apply) && !('LENGTH_PRECISION' in apply), 'merge: nothing this device has newer is applied over it');
  // a device-only key is never serialised: neither by the store's syncEntries nor by the merge
  const s = createSettingsManager({ storage: memStorage(), now });
  s.set('FILE_DIALOG_TAB', 'local', { persist: 'local' }); s.set('RIBBON_LAYOUT', { v: 1 }, { persist: 'local' }); s.set('SHOW_DEBUG_OVERLAY', true, { persist: 'local' }); s.set('BROWSER_COLLAPSED', true, { persist: 'local' });
  s.set('DOC_UNIT', 'cm', { persist: false }); // a host's in-memory default (Shaper's inch) is not a choice: never synced
  s.set('LENGTH_PRECISION', 2, { persist: 'local' });
  assert.deepStrictEqual(Object.keys(s.syncEntries()), ['LENGTH_PRECISION'], 'syncEntries: only the synced key the user set (device-only keys and a persist:false value never)');
  const m2 = mergeSettingsEntries({ ...s.syncEntries(), FILE_DIALOG_TAB: { value: 'local', at: 9, by: null } }, {}, 'dev-A');
  assert.deepStrictEqual(Object.keys(m2.file), ['LENGTH_PRECISION'], 'merge: a device-only key handed to it is still never written to the file');
  const text = serializeSettingsFile(m2.file);
  assert.ok(!/FILE_DIALOG_TAB|RIBBON_LAYOUT|SHOW_DEBUG|BROWSER_COLLAPSED|token|sk_cloud/.test(text), 'the file text holds no device-only key and nothing of the account');
  assert.deepStrictEqual(JSON.parse(text), { format: SETTINGS_FILE_FORMAT, version: 1, settings: { LENGTH_PRECISION: { value: 2, at: clock, by: 'dev-A' } } }, 'the file shape: { format, version, settings: { KEY: { value, at, by } } }');
  // every Settings-panel knob of the look is synced (one declaration, no key forgotten)
  for (const k of STYLE_SETTING_KEYS) assert.ok(SYNCED_SETTING_KEYS.includes(k), 'the style template key ' + k + ' is synced');
  console.log('1 merge per key: ok');
}

// ---- 2. two devices: different keys at the same time; the same key ----
{
  const drive = createFakeDrive();
  const A = device(drive, 'A'), B = device(drive, 'B');
  A.settings.set('DOC_UNIT', 'in', { persist: 'local' });
  B.settings.set('SHORTCUT_KEYS', { v: 1, keys: { 'tool.line': ['k'] } }, { persist: 'local' });
  await Promise.all([A.sync.syncNow(), B.sync.syncNow()]); // both at once (their requests interleave on the fake Drive)
  await Promise.all([A.sync.syncNow(), B.sync.syncNow()]);
  for (const d of [A, B]) {
    assert.strictEqual(d.settings.get('DOC_UNIT'), 'in', d.name + ': the units changed on A');
    assert.deepStrictEqual(d.settings.get('SHORTCUT_KEYS'), { v: 1, keys: { 'tool.line': ['k'] } }, d.name + ': the shortcut changed on B');
    assert.strictEqual(d.sync.status().state, 'saved', d.name + ': status saved');
  }
  assert.strictEqual(settingsFoldersOf(drive).length, 1, 'two devices creating it at once: ONE Settings folder: ' + settingsFoldersOf(drive).length);
  assert.deepStrictEqual(Object.keys(fileEntries(drive)).sort(), ['DOC_UNIT', 'SHORTCUT_KEYS'], 'the file holds both changes');
  // the same key on both: the newer wins on both, whichever device reaches Drive first
  A.settings.set('LENGTH_PRECISION', 5, { persist: 'local' });
  clock += 1000;
  B.settings.set('LENGTH_PRECISION', 1, { persist: 'local' });
  await B.sync.syncNow(); await A.sync.syncNow(); await B.sync.syncNow();
  assert.deepStrictEqual([A.settings.get('LENGTH_PRECISION'), B.settings.get('LENGTH_PRECISION')], [1, 1], 'the same key changed on both (the newer reached Drive first): the newer change (B, 1 s later) wins on both');
  clock += 1000;
  B.settings.set('LENGTH_PRECISION', 2, { persist: 'local' });
  clock += 1000;
  A.settings.set('LENGTH_PRECISION', 4, { persist: 'local' });
  await B.sync.syncNow(); await A.sync.syncNow(); await B.sync.syncNow();
  assert.deepStrictEqual([A.settings.get('LENGTH_PRECISION'), B.settings.get('LENGTH_PRECISION')], [4, 4], 'the same key changed on both (the older reached Drive first): the newer change (A) wins on both');
  assert.deepStrictEqual(fileEntries(drive).LENGTH_PRECISION, { value: 4, at: clock, by: 'dev-A' }, 'the file: the value, when, and which device');
  // a change received from Drive is never sent back as this device's change
  const before = drive.calls.filter((c) => c.method !== 'GET').length;
  await A.sync.syncNow();
  assert.strictEqual(drive.calls.filter((c) => c.method !== 'GET').length, before, 'a sync with nothing new writes nothing');
  console.log('2 two devices: ok');
}

// ---- 3. a concurrent writer between this device's read and its write ----
{
  const drive = createFakeDrive();
  const A = device(drive, 'A'), B = device(drive, 'B');
  A.settings.set('GRID_MODE', 'points', { persist: 'local' });
  await A.sync.syncNow();
  B.settings.set('AXIS_SNAP', false, { persist: 'local' });
  A.settings.set('SHOW_GRID', false, { persist: 'local' });
  // A reads, then B writes its change before A's write: A's 766 check sees another device's content and merges again
  let reads = 0, injected = false;
  A.setFile({
    read: async () => { const r = await A.adapter.settingsFile.read(); if (++reads === 1 && !injected) { injected = true; await B.sync.syncNow(); } return r; },
    write: (t, id) => A.adapter.settingsFile.write(t, id),
  });
  await A.sync.syncNow();
  assert.ok(injected, 'B wrote between A\'s read and A\'s write');
  const e = fileEntries(drive);
  assert.deepStrictEqual([e.GRID_MODE.value, e.AXIS_SNAP.value, e.SHOW_GRID.value], ['points', false, false], 'the concurrent writer\'s change and this device\'s both survive');
  await B.sync.syncNow();
  assert.strictEqual(B.settings.get('SHOW_GRID'), false, 'B has A\'s change');
  assert.strictEqual(A.settings.get('AXIS_SNAP'), false, 'A has B\'s change');
  console.log('3 concurrent writer: ok');
}

// ---- 4. a request failing mid-save (766's case) ----
{
  const drive = createFakeDrive();
  const A = device(drive, 'A');
  const f0 = drive.fetch;
  let failMetaAfterUpload = false, failListAfterCreate = false, uploaded = false;
  drive.fetch = async (url, init = {}) => {
    const u = new URL(url), method = (init.method || 'GET').toUpperCase();
    if (method === 'PATCH' && u.pathname.startsWith('/upload/')) uploaded = true;
    if (method === 'POST' && u.pathname.startsWith('/upload/') && failListAfterCreate) { const r = await f0(url, init); failListAfterCreate = 'armed'; return r; }
    if (failListAfterCreate === 'armed' && method === 'GET' && u.pathname === '/drive/v3/files') { failListAfterCreate = false; return new Response('{"error":{"code":503}}', { status: 503 }); }
    if (failMetaAfterUpload && uploaded && method === 'GET' && /^\/drive\/v3\/files\/[^/]+$/.test(u.pathname) && u.searchParams.get('alt') !== 'media') { failMetaAfterUpload = false; return new Response('{"error":{"code":503}}', { status: 503 }); }
    return f0(url, init);
  };
  // the file's first creation: the upload lands, the listing after it fails
  failListAfterCreate = true;
  A.settings.set('DOC_UNIT', 'in', { persist: 'local' });
  await advance(SETTINGS_SYNC_DEBOUNCE_MS + 10); // the debounced save (a Sync now would retry at once)
  assert.strictEqual(A.sync.status().state, 'retry', 'a failed request: status "will retry": ' + JSON.stringify(A.sync.status()));
  assert.ok(A.log.lines.some(([lv, t]) => lv === 'warn' && /could not be synced/.test(t)), 'the failure is reported quietly in the Log');
  await advance(5000); // the writer's first retry
  assert.strictEqual(A.sync.status().state, 'saved', 'the retry succeeds: ' + JSON.stringify(A.sync.status()));
  assert.strictEqual(settingsFileOf(drive).length, 1, 'no duplicate file after a create stopped half way');
  // an update: the content upload lands, the read of the new version fails
  A.settings.set('LENGTH_PRECISION', 6, { persist: 'local' });
  uploaded = false; failMetaAfterUpload = true;
  await advance(SETTINGS_SYNC_DEBOUNCE_MS + 5010); // the debounced save, after the writer's 5 s interval since the last write
  assert.strictEqual(A.sync.status().state, 'retry', 'the version read failed: will retry');
  const writesBefore = drive.calls.filter((c) => c.method !== 'GET').length;
  await advance(5000);
  assert.strictEqual(A.sync.status().state, 'saved', 'the retry settles it');
  assert.strictEqual(drive.calls.filter((c) => c.method !== 'GET').length, writesBefore, 'the retry reads its own content back: nothing written again (no copy)');
  const e = fileEntries(drive);
  assert.deepStrictEqual([e.DOC_UNIT.value, e.LENGTH_PRECISION.value], ['in', 6], 'nothing lost');
  assert.ok(![...drive.files.values()].some((f) => /conflict/i.test(f.name)), 'no conflicted copy');
  assert.strictEqual(settingsFoldersOf(drive).length, 1, 'one folder');
  console.log('4 failed request mid-save: ok');
}

// ---- 5. corrupt and newer-format files ----
{
  const drive = createFakeDrive();
  const A = device(drive, 'A');
  A.settings.set('DOC_UNIT', 'in', { persist: 'local' });
  await A.sync.syncNow();
  const f = settingsFileOf(drive)[0];
  f.content = '{"format":"sketch-studio-settings", garbage'; f.version++;
  A.settings.set('GRID_MODE', 'off', { persist: 'local' });
  await A.sync.syncNow();
  assert.ok(A.log.lines.some(([lv, t]) => lv === 'warn' && /could not be read \(not JSON/.test(t)), 'a corrupt file: a notice in the Log');
  assert.deepStrictEqual([A.settings.get('DOC_UNIT'), A.settings.get('GRID_MODE')], ['in', 'off'], 'a corrupt file never wipes the local settings');
  assert.deepStrictEqual(Object.keys(fileEntries(drive)).sort(), ['DOC_UNIT', 'GRID_MODE'], 'the corrupt file is replaced by this device\'s settings');
  const newer = JSON.stringify({ format: SETTINGS_FILE_FORMAT, version: 2, settings: { DOC_UNIT: { value: 'cm', at: clock + 99999, by: 'dev-new' } } });
  f.content = newer; f.version++;
  A.settings.set('LENGTH_PRECISION', 0, { persist: 'local' });
  const st = await A.sync.syncNow();
  assert.strictEqual(st.state, 'newer', 'a newer-format file: the status says so: ' + JSON.stringify(st));
  assert.strictEqual(f.content, newer, 'a newer-format file is never written over');
  assert.deepStrictEqual([A.settings.get('DOC_UNIT'), A.settings.get('LENGTH_PRECISION')], ['in', 0], 'nor read: the local settings stay');
  assert.ok(A.log.lines.some(([lv, t]) => lv === 'warn' && /format version 2/.test(t)), 'a newer file: a notice in the Log');
  assert.deepStrictEqual(parseSettingsFile('[1,2]'), { corrupt: 'not a Sketch Studio settings file' }, 'parse never throws');
  console.log('5 corrupt / newer file: ok');
}

// ---- 6. reset follows the user ----
{
  const drive = createFakeDrive();
  const A = device(drive, 'A'), B = device(drive, 'B');
  A.settings.set('DOC_UNIT', 'in', { persist: 'local' }); A.settings.set('LENGTH_PRECISION', 5, { persist: 'local' });
  await A.sync.syncNow(); await B.sync.syncNow();
  assert.deepStrictEqual([B.settings.get('DOC_UNIT'), B.settings.get('LENGTH_PRECISION')], ['in', 5], 'B received A\'s settings');
  clock += 1000;
  B.settings.resetToDefaults();
  await B.sync.syncNow(); await A.sync.syncNow();
  assert.deepStrictEqual([A.settings.get('DOC_UNIT'), A.settings.get('LENGTH_PRECISION')], ['mm', 3], 'the reset on B reached A: back to the defaults');
  const e = fileEntries(drive);
  assert.deepStrictEqual(e.DOC_UNIT, { reset: true, at: clock, by: 'dev-B' }, 'the file: the key reset, with its new time and device');
  assert.ok(!A.storage.map.get('sketch-studio-settings').includes('DOC_UNIT'), 'A: the reset key is gone from the local overrides (the default applies)');
  console.log('6 reset: ok');
}

// ---- 7. hidden from the projects / designs lists ----
{
  const drive = createFakeDrive();
  const A = device(drive, 'A');
  const local = createMemoryAdapter();
  const router = createRouterAdapter({ local, getRemote: () => A.adapter, signedIn: () => true });
  const store = createProjectStore({ adapter: router, now, channel: null });
  const mine = await store.createProject('Settings'); // the user's own project called "Settings"
  A.settings.set('DOC_UNIT', 'in', { persist: 'local' });
  await A.sync.syncNow();
  assert.strictEqual(settingsFileOf(drive).length, 1, 'the settings file exists');
  const sf = settingsFileOf(drive)[0], folder = drive.files.get(sf.parents[0]);
  assert.strictEqual(folder.name, 'Settings'); assert.deepStrictEqual(folder.parents, [drive.byName('Sketch Studio')[0].id], 'Sketch Studio/Settings/settings.json');
  const projects = await store.listProjects();
  assert.deepStrictEqual(projects.map((p) => p.id), [mine.id], 'the store lists the user\'s "Settings" project only, never the settings folder: ' + JSON.stringify(projects));
  assert.ok(!(await A.adapter.listProjects()).some((p) => p.id === folder.id), 'the Drive adapter never lists the settings folder');
  assert.ok(!(await store.listDesigns()).some((d) => d.id.endsWith(sf.id)), 'the settings file is never a design');
  assert.ok(!(await store.listRecent()).some((d) => String(d.id).endsWith(sf.id)), 'nor a recent design (Open recent / the Open dialog)');
  await store.cloud.refresh(); // the Drive change poll (its signature is built from the same two lists)
  A.settings.set('GRID_MODE', 'off', { persist: 'local' });
  await A.sync.syncNow();
  assert.strictEqual(await store.cloud.refresh(), false, 'a settings save is not a change of the projects / designs (no list refresh)');
  assert.ok(!(await A.adapter.listDesigns()).some((d) => d.id === sf.id || d.projectId === folder.id), 'the Drive adapter lists no design in the settings folder');
  console.log('7 hidden from the lists: ok');
}

// ---- 8. signed out; signing in; the debounce ----
{
  const drive = createFakeDrive();
  const A = device(drive, 'A');
  A.settings.set('DOC_UNIT', 'in', { persist: 'local' });
  await A.sync.syncNow();
  const B = device(drive, 'B', { signedIn: false });
  clock += 1000;
  B.settings.set('GRID_MODE', 'points', { persist: 'local' }); // changed while signed out
  await advance(10000);
  assert.strictEqual(B.sync.status().state, 'device', 'signed out: "Saved on this device only"');
  assert.strictEqual(B.settings.get('DOC_UNIT'), 'mm', 'signed out: nothing read from Drive');
  const calls = drive.calls.length;
  await B.sync.syncNow(); await advance(10000);
  assert.strictEqual(drive.calls.length, calls, 'signed out: no Drive request at all');
  B.signIn();
  await advance(100);
  assert.deepStrictEqual([B.settings.get('DOC_UNIT'), B.settings.get('GRID_MODE')], ['in', 'points'], 'signing in merges: Drive\'s units arrive, the change made while signed out is kept');
  await A.sync.syncNow();
  assert.strictEqual(A.settings.get('GRID_MODE'), 'points', '... and reaches the other device');
  // the debounce: nothing is sent before SETTINGS_SYNC_DEBOUNCE_MS after the last change
  await advance(10000);
  const n0 = drive.calls.length;
  A.settings.set('LINE_STROKE', 0.5, { persist: 'local' });
  await advance(SETTINGS_SYNC_DEBOUNCE_MS - 100);
  A.settings.set('LINE_STROKE', 0.6, { persist: 'local' });
  await advance(SETTINGS_SYNC_DEBOUNCE_MS - 100);
  assert.strictEqual(drive.calls.length, n0, 'no request while changes keep coming (the debounce)');
  assert.strictEqual(A.sync.status().state, 'saving', 'status while waiting: syncing');
  await advance(200);
  assert.ok(drive.calls.length > n0, 'one sync after the debounce');
  assert.strictEqual(fileEntries(drive).LINE_STROKE.value, 0.6, 'the last value');
  A.settings.set('FILE_DIALOG_TAB', 'local', { persist: 'local' });
  const n1 = drive.calls.length;
  await advance(10000);
  assert.strictEqual(drive.calls.length, n1, 'a device-only setting changed: no Drive request');
  B.signOut();
  assert.strictEqual(B.sync.status().state, 'device', 'signing out: back to this device only');
  assert.strictEqual(B.settings.get('DOC_UNIT'), 'in', 'signing out keeps the local copy');
  console.log('8 signed out / sign in / debounce: ok');
}

console.log('settings-drive-773-node: ok');
