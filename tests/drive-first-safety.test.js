// tests/drive-first-safety.test.js — TASK 506 review fixes F1-F7, against a FAKE Drive (no Google call), fake clock and timers.
//   F1 a stale copy can never replace a newer queued edit      F2/F3 Drive's own `version` (never a clock) decides: conflicted copy, nothing lost
//   F4 unconfirmed copies of designs never reopened are sent   F5 a design missing on Drive: re-created, or the pointer cleared; transient keeps it
//   F6 listing for a signed-in user writes nothing             F7 the duplicate "My Designs" race never trashes a folder that is in use
import assert from 'node:assert';
import { createFakeDrive } from './harness/fake-drive.js';
import { createDriveAdapter } from '../packages/ui/cloud/drive-adapter.js';
import { createRouterAdapter, isRemoteId } from '../packages/ui/cloud/router-adapter.js';
import { createProjectStore, createMemoryAdapter, emptyDocument } from '../packages/ui/project-store.js';
import { createDocumentBuffer } from '../packages/ui/document-buffer.js';
import { createDriveWriter } from '../packages/ui/cloud/drive-writer.js';
import { parseProjectFile } from '../packages/ui/project-file.js';

let clock = Date.UTC(2026, 10, 11, 12, 0, 0);
let timers = []; let seq = 0;
const setTimer = (fn, ms) => { const t = { fn, at: clock + ms, id: ++seq }; timers.push(t); return t; };
const clearTimer = (t) => { timers = timers.filter((x) => x !== t); };
const settle = async () => { for (let i = 0; i < 40; i++) await new Promise((r) => setImmediate(r)); };
async function advance(ms) {
  const end = clock + ms;
  for (;;) {
    await settle();
    const due = timers.filter((t) => t.at <= end).sort((a, b) => a.at - b.at || a.id - b.id)[0];
    if (!due) { clock = end; await settle(); return; }
    timers = timers.filter((t) => t !== due); clock = Math.max(clock, due.at); due.fn();
  }
}
const doc = (marker, hosts = {}) => ({ ...emptyDocument(), geometry: { joints: [['j1', { x: marker, y: 0 }]], shapes: [], constraints: [] }, hosts });
const xOf = (d) => d.document.geometry.joints[0][1].x;
const fileX = (drive, driveId) => parseProjectFile(drive.files.get(driveId.replace(/^drive:/, '')).content).document.geometry.joints[0][1].x;

/** One device / tab: its own storage (or a shared one), its own clock skew, and a switch that cuts ITS connection only. */
function device(drive, { local = createMemoryAdapter(), skew = 0} = {}) {
  const dev = { offline: false, signedIn: true, local, drive, attempts: 0, listeners: new Set(), setSignedIn(v) { dev.signedIn = v; dev.listeners.forEach((f) => f()); } };
  const account = { authedFetch: (url, opts = {}) => {
    dev.attempts++;
    if (!dev.signedIn) return Promise.reject(new Error('cloud-auth'));
    if (dev.offline) return Promise.reject(new TypeError('network unreachable'));
    return drive.fetch(url, { ...opts, headers: { Authorization: 'Bearer ' + drive.token, ...(opts.headers || {}) } });
  } };
  const remote = createDriveAdapter({ account, meta: local });
  const router = createRouterAdapter({ local, getRemote: () => remote, preferDrive: () => dev.signedIn, signedIn: () => dev.signedIn, subscribeSignIn: (fn) => { dev.listeners.add(fn); return () => dev.listeners.delete(fn); } });
  dev.store = createProjectStore({ adapter: router, now: () => clock + skew, channel: null, setTimer, clearTimer });
  return dev;
}
const names = (drive) => [...drive.files.values()].filter((f) => !f.trashed && /\.sketch\.json$/.test(f.name)).map((f) => f.name);
const copies = (drive) => names(drive).filter((n) => /\(conflicted copy \d{4}-\d{2}-\d{2} \d{2}-\d{2}\)\.sketch\.json$/.test(n));

// ---- F1 ------------------------------------------------------------------------------------------------------------------
{
  const log = []; let kept = null;
  const w = createDriveWriter({ now: () => clock, setTimer, clearTimer, write: async (id, p) => { log.push(p.v); }, keepLocal: async (id, p) => { kept = p; }, dropLocal: async () => { kept = null; } });
  await w.queue('a', { v: 'new', updatedAt: 200 }); await w.queue('a', { v: 'old', updatedAt: 100 }); await advance(10);
  assert.deepStrictEqual(log, ['new'], 'an OLDER payload queued late is ignored'); assert.strictEqual(kept, null);
  await w.queue('a', { v: 'older', updatedAt: 150 }); await advance(6000);
  assert.deepStrictEqual(log, ['new'], 'and so is one older than the last confirmed write');
}
{ // the real interleave: loadDesign awaits Drive, an autosave lands meanwhile; the NEWER edit must be what is pending / kept
  const drive = createFakeDrive(); const dev = device(drive); const { store, local } = dev;
  const p = await store.createProject('P'); const d = await store.newDesign('D', { app: 'shaper', projectId: p.id });
  drive.failWrites = 1000; await store.save(doc(1), { id: d.id, app: 'shaper' }); await settle(); drive.failWrites = 0;
  const real = drive.fetch; let fired = false;
  drive.fetch = async (url, init = {}) => { if (!fired && String(url).includes('alt=media')) { fired = true; clock += 10; await store.save(doc(2), { id: d.id, app: 'shaper' }); } return real(url, init); };
  const loaded = await store.get(d.id);
  drive.fetch = real;
  assert(fired, 'the autosave landed during the Drive read');
  assert.strictEqual((await local.getMeta('driveShadow:' + d.id)).document.geometry.joints[0][1].x, 2, 'the kept local copy is the NEWER edit');
  assert.strictEqual(xOf(loaded), 2, 'the design opens from the newer edit');
  await store.flushDrive(d.id);
  assert.strictEqual(fileX(drive, d.id), 2, 'and Drive ends with the newer edit');
  assert.deepStrictEqual(copies(drive), [], 'no conflict: the version never moved');
}

// ---- F2 / F3 -------------------------------------------------------------------------------------------------------------
for (const skew of [0, 3_600_000, -3_600_000]) { // A's clock right, an hour ahead, an hour behind: the outcome is the same
  const drive = createFakeDrive();
  const A = device(drive, { skew }); const B = device(drive);
  const p = await A.store.createProject('Shared'); const d = await A.store.newDesign('Door', { app: 'shaper', projectId: p.id });
  await A.store.save(doc(1), { id: d.id, app: 'shaper' }); await A.store.flushDrive(d.id);
  await B.store.open(d.id); // B has the design at the same Drive version
  A.offline = true;
  await A.store.save(doc(2), { id: d.id, app: 'shaper' }); await advance(6000); // A's edit cannot reach Drive
  assert.strictEqual(A.store.status(d.id).state, 'failed');
  await B.store.save(doc(3), { id: d.id, app: 'shaper' }); await B.store.flushDrive(d.id); // B changes Drive meanwhile
  assert.strictEqual(fileX(drive, d.id), 3);
  A.offline = false; await advance(70000); // A reconnects: its retry meets a different version
  assert.strictEqual(fileX(drive, d.id), 3, `skew ${skew}: B's version is NOT overwritten`);
  const c = copies(drive); assert.strictEqual(c.length, 1, `skew ${skew}: A's edit is kept as ONE conflicted copy: ` + JSON.stringify(names(drive)));
  assert(c[0].startsWith('Door (conflicted copy '), c[0]);
  const copyFile = [...drive.files.values()].find((f) => f.name === c[0]);
  assert.strictEqual(parseProjectFile(copyFile.content).document.geometry.joints[0][1].x, 2, 'the copy holds A\'s edit');
  assert.deepStrictEqual(copyFile.parents, drive.files.get(d.id.replace('drive:', '')).parents, 'in the same project');
  assert.strictEqual(await A.local.getMeta('driveShadow:' + d.id), null, 'the local copy goes only after it was written (to the copy)');
  const st = A.store.status(d.id);
  assert.strictEqual(st.notice, `Another device changed this design. Your unsaved changes were kept as "${c[0].replace('.sketch.json', '')}".`, 'the message: ' + st.notice);
}
{ // the other path: A's tab was closed with the edit unconfirmed; reopening meets the changed Drive version
  const drive = createFakeDrive(); const A = device(drive); const B = device(drive);
  const p = await A.store.createProject('Shared'); const d = await A.store.newDesign('Door', { app: 'shaper', projectId: p.id });
  await A.store.save(doc(1), { id: d.id, app: 'shaper' }); await A.store.flushDrive(d.id);
  await B.store.open(d.id);
  A.offline = true; await A.store.save(doc(2), { id: d.id, app: 'shaper' }); await advance(6000);
  await B.store.save(doc(3), { id: d.id, app: 'shaper' }); await B.store.flushDrive(d.id);
  const A2 = device(drive, { local: A.local }); // reload
  const cur = await A2.store.loadCurrent({ app: 'shaper' });
  assert.strictEqual(xOf(cur), 3, 'the Drive version is what opens');
  assert.strictEqual(copies(drive).length, 1); assert.strictEqual(fileX(drive, d.id), 3);
  assert.strictEqual(await A.local.getMeta('driveShadow:' + d.id), null);
  assert(/kept as "Door \(conflicted copy/.test(A2.store.status(d.id).notice), 'the message is shown');
}
{ // two tabs of one design: the second writer sees the version the first one made, no silent last-writer-wins
  const drive = createFakeDrive(); const tab1 = device(drive); const tab2 = device(drive, { local: tab1.local });
  const p = await tab1.store.createProject('P'); const d = await tab1.store.newDesign('D', { app: 'shaper', projectId: p.id });
  await tab2.store.open(d.id);
  const mk = () => ({ joints: new Map(), shapes: [], constraints: [] });
  const st2 = mk();
  const listeners = {}; const fdoc = { visibilityState: 'visible', addEventListener: () => {}, removeEventListener: () => {} };
  const buf2 = createDocumentBuffer({ state: st2, app: 'shaper', store: tab2.store, pollMs: 1e9, doc: fdoc, win: null });
  await buf2.restore(); buf2.start();
  await tab1.store.save(doc(10), { id: d.id, app: 'shaper' }); await tab1.store.flushDrive(d.id);
  st2.joints.set('mine', { x: 5, y: 5 });
  await buf2.flush();
  assert.strictEqual(fileX(drive, d.id), 10, 'tab 1\'s write stands');
  assert.strictEqual(copies(drive).length, 1, 'tab 2\'s edit was kept as a conflicted copy');
  await settle();
  assert(st2.joints.has('j1') && st2.joints.get('j1').x === 10 && !st2.joints.has('mine'), 'tab 2 now shows Drive\'s version instead of writing its older state over it');
  buf2.stop(); void listeners;
}
{ // an unchanged version is a plain overwrite: no copy, nothing else
  const drive = createFakeDrive(); const A = device(drive);
  const p = await A.store.createProject('P'); const d = await A.store.newDesign('D', { app: 'shaper', projectId: p.id });
  for (let i = 1; i <= 3; i++) { await A.store.save(doc(i), { id: d.id, app: 'shaper' }); await A.store.flushDrive(d.id); }
  assert.strictEqual(fileX(drive, d.id), 3); assert.deepStrictEqual(copies(drive), []); assert.strictEqual(names(drive).length, 1);
  await A.store.rename(d.id, 'D2'); await A.store.save(doc(4), { id: d.id, app: 'shaper' }); await A.store.flushDrive(d.id);
  assert.deepStrictEqual(copies(drive), [], 'our own rename moved the version: still no false conflict'); assert.strictEqual(fileX(drive, d.id), 4);
}

// ---- F4 ------------------------------------------------------------------------------------------------------------------
{
  const drive = createFakeDrive(); const A = device(drive);
  const p = await A.store.createProject('P'); const d1 = await A.store.newDesign('One', { app: 'shaper', projectId: p.id });
  drive.failWrites = 1000; await A.store.save(doc(7), { id: d1.id, app: 'shaper' }); await settle(); drive.failWrites = 0;
  assert(await A.local.getMeta('driveShadow:' + d1.id), 'unconfirmed when the tab closed');
  const d2 = await A.store.newDesign('Two', { app: 'shaper', projectId: p.id }); // another design is current now
  const A2 = device(drive, { local: A.local });
  const cur = await A2.store.loadCurrent({ app: 'shaper' });
  assert.strictEqual(cur.id, d2.id); await settle();
  assert.strictEqual(fileX(drive, d1.id), 7, 'the OLD design\'s unconfirmed edit reached Drive without being reopened');
  assert.strictEqual(await A.local.getMeta('driveShadow:' + d1.id), null, 'and its local copy is gone');
  const out = device(drive, { local: createMemoryAdapter() }); out.signedIn = false; // signed out: nothing is sent
  await out.store.loadCurrent({ app: 'shaper' });
}

// ---- F5 ------------------------------------------------------------------------------------------------------------------
{ // (a) trashed on Drive, a local copy exists: saved again as a NEW file in the same project, the pointer follows
  const drive = createFakeDrive(); const A = device(drive);
  const p = await A.store.createProject('P'); const d = await A.store.newDesign('Door', { app: 'shaper', projectId: p.id });
  drive.failWrites = 1000; await A.store.save(doc(8), { id: d.id, app: 'shaper' }); await settle(); drive.failWrites = 0;
  drive.files.get(d.id.replace('drive:', '')).trashed = true;
  const A2 = device(drive, { local: A.local });
  const cur = await A2.store.loadCurrent({ app: 'shaper' });
  assert(cur && cur.id !== d.id && isRemoteId(cur.id), 'a new Drive design'); assert.strictEqual(xOf(cur), 8);
  assert.strictEqual(cur.projectId, p.id, 'in the same project');
  assert.strictEqual(await A.local.getMeta('currentDesign'), cur.id, 'the pointer follows');
  assert.strictEqual(fileX(drive, cur.id), 8); assert.strictEqual(await A.local.getMeta('driveShadow:' + d.id), null);
  assert(/removed from Google Drive/.test(A2.store.status(cur.id).notice), 'a message is shown');
}
{ // (b) the project is gone too: a design on this device
  const drive = createFakeDrive(); const A = device(drive);
  const p = await A.store.createProject('P'); const d = await A.store.newDesign('Door', { app: 'shaper', projectId: p.id });
  drive.failWrites = 1000; await A.store.save(doc(8), { id: d.id, app: 'shaper' }); await settle(); drive.failWrites = 0;
  drive.files.get(d.id.replace('drive:', '')).trashed = true; drive.files.get(p.id.replace('drive:', '')).trashed = true;
  const A2 = device(drive, { local: A.local });
  const cur = await A2.store.loadCurrent({ app: 'shaper' });
  assert(cur && !isRemoteId(cur.id), 'a local design'); assert.strictEqual(xOf(cur), 8);
  assert.strictEqual(await A.local.getMeta('currentDesign'), cur.id);
}
{ // (c) trashed, no local copy: nothing to open, the stale pointer is cleared, a message says so
  const drive = createFakeDrive(); const A = device(drive);
  const p = await A.store.createProject('P'); const d = await A.store.newDesign('Door', { app: 'shaper', projectId: p.id });
  drive.files.get(d.id.replace('drive:', '')).trashed = true;
  const A2 = device(drive, { local: A.local });
  assert.strictEqual(await A2.store.loadCurrent({ app: 'shaper' }), null);
  assert.strictEqual(await A.local.getMeta('currentDesign'), null, 'permanent: the pointer is cleared');
  assert(/removed from Google Drive/.test(A2.store.status(null).notice));
}
{ // (d) it disappears while the app is open: the next write re-creates it ONCE, the old id keeps working through the redirect
  const drive = createFakeDrive(); const A = device(drive);
  const p = await A.store.createProject('P'); const d = await A.store.newDesign('Door', { app: 'shaper', projectId: p.id });
  drive.files.get(d.id.replace('drive:', '')).trashed = true;
  await A.store.save(doc(1), { id: d.id, app: 'shaper' }); await settle();
  await A.store.save(doc(2), { id: d.id, app: 'shaper' }); await A.store.flushDrive();
  const live = names(drive); assert.deepStrictEqual(live, ['Door.sketch.json'], 'ONE new file, not one per tick: ' + JSON.stringify(live));
  const cur = await A.store.current(); assert.notStrictEqual(cur.id, d.id); assert.strictEqual(fileX(drive, cur.id), 2);
}
{ // (e) transient (offline): the pointer stays and the status says why; (f) a permanent error stops the retry loop
  const drive = createFakeDrive(); const A = device(drive);
  const p = await A.store.createProject('P'); const d = await A.store.newDesign('Door', { app: 'shaper', projectId: p.id });
  const A2 = device(drive, { local: A.local }); A2.offline = true;
  assert.strictEqual(await A2.store.loadCurrent({ app: 'shaper' }), null);
  assert.strictEqual(await A.local.getMeta('currentDesign'), d.id, 'offline: the pointer is kept');
  assert(/could not be reached/.test(A2.store.status(null).reason), 'and the status says why');
  const calls = []; let mode = 'err';
  const w = createDriveWriter({ now: () => clock, setTimer, clearTimer, write: async () => { calls.push(1); if (mode === 'err') throw Object.assign(new Error('Drive 404'), { status: 404 }); }, keepLocal: async () => {}, dropLocal: async () => {} });
  await w.queue('x', { v: 1, updatedAt: 1 }); await advance(300000);
  assert.strictEqual(calls.length, 1, 'a 404 is permanent: no 5/10/20/40/60 s retry loop'); assert.strictEqual(w.status('x').state, 'failed');
  mode = 'ok'; await w.flush('x'); assert.strictEqual(calls.length, 2, 'an explicit flush tries again'); assert.strictEqual(w.status('x').state, 'saved');
}

// ---- F6 ------------------------------------------------------------------------------------------------------------------
{
  const drive = createFakeDrive(); const A = device(drive);
  await A.store.listProjects(); await A.store.listRecent(); await A.store.listDesigns('x'); await A.store.loadCurrent({ app: 'shaper' }); A.store.status(null);
  await A.store.cloud.refresh();
  assert.deepStrictEqual(drive.requests.filter((r) => r.method !== 'GET').map((r) => r.method + ' ' + r.url), [], 'listing / loading / status made no write');
  assert.strictEqual(drive.files.size, 0, 'the "Sketch Studio" root folder was NOT created by looking');
  await A.store.createProject('First'); assert.strictEqual(drive.byName('Sketch Studio').length, 1, 'a WRITE creates it');
}

// ---- F7 ------------------------------------------------------------------------------------------------------------------
{
  const drive = createFakeDrive(); const X = device(drive); const Y = device(drive);
  const real = drive.fetch; let planted = 0;
  drive.fetch = async (url, init = {}) => { // another device writes into a "My Designs" folder just before the loser checks whether its own is still empty
    if ((init.method || 'GET') === 'GET' && decodeURIComponent(String(url)).includes("skKind' and value='design'") && !planted) {
      const folders = [...drive.files.values()].filter((f) => f.name === 'My Designs' && !f.trashed);
      if (folders.length === 2) {
        planted++; const newer = folders.sort((a, b) => Date.parse(a.createdTime) - Date.parse(b.createdTime) || a.id.localeCompare(b.id))[1];
        drive.files.set('planted', { id: 'planted', name: 'Elsewhere.sketch.json', mimeType: 'application/json', parents: [newer.id], appProperties: { skKind: 'design', skApp: 'shaper', skUpdatedAt: '1' }, version: 1, modifiedTime: new Date(clock).toISOString(), createdTime: new Date(clock).toISOString(), content: '' });
      }
    }
    return real(url, init);
  };
  await Promise.all([X.store.newDesign('X', { app: 'shaper' }), Y.store.newDesign('Y', { app: 'shaper' })]);
  drive.fetch = real;
  assert.strictEqual(planted, 1, 'the race happened and a file landed in the later folder');
  const folders = [...drive.files.values()].filter((f) => f.name === 'My Designs');
  assert.strictEqual(folders.length, 2, 'both folders exist'); assert(folders.every((f) => !f.trashed), 'and NO folder was trashed: ' + JSON.stringify(folders.map((f) => f.trashed)));
  const older = folders.sort((a, b) => Date.parse(a.createdTime) - Date.parse(b.createdTime) || a.id.localeCompare(b.id))[0];
  const Z = device(drive); const dz = await Z.store.newDesign('Z', { app: 'shaper' });
  assert.strictEqual(dz.projectId, 'drive:' + older.id, 'the default is the OLDEST folder (a lookup rule, no deletion)');
}

// ---- ROUND 2 ---------------------------------------------------------------------------------------------------------------
/** Hold every Drive request matching `match` until release(); the request then answers `answer` (an HTTP status) or goes through (null). */
function hold(drive, match) {
  const real = drive.fetch; let release; const gate = new Promise((r) => { release = r; });
  const h = { hits: 0, answer: null, release: (answer) => { h.answer = answer; release(); }, restore: () => { drive.fetch = real; } };
  drive.fetch = async (url, init = {}) => {
    if (match(String(url), (init.method || 'GET').toUpperCase())) { h.hits++; await gate; if (h.answer) return new Response('{}', { status: h.answer }); }
    return real(url, init);
  };
  return h;
}
const isUpload = (u, m) => m === 'PATCH' && u.includes('/upload/drive/v3/files/');
const isDesignMeta = (id) => (u, m) => m === 'PATCH' && !u.includes('/upload/') && u.includes('/drive/v3/files/' + id.replace('drive:', '') + '?');

// G1: deleted while a write is in flight: it never retries and never comes back
for (const outcome of [500, null]) {
  const drive = createFakeDrive(); const A = device(drive);
  const p = await A.store.createProject('P'); const d = await A.store.newDesign('Door', { app: 'shaper', projectId: p.id });
  const h = hold(drive, isUpload);
  await A.store.save(doc(1), { id: d.id, app: 'shaper' }); await settle();
  assert.strictEqual(h.hits, 1, 'the write is in flight');
  await A.store.remove(d.id); // deleted while the Drive call is pending
  h.release(outcome); await settle(); const attemptsAtRelease = A.attempts; await advance(120000); h.restore();
  assert.strictEqual(A.attempts, attemptsAtRelease, `G1: a cancelled entry never retries (${A.attempts - attemptsAtRelease} Drive calls after the delete)`);
  assert.deepStrictEqual(names(drive), [], `G1 (${outcome ? 'failing' : 'finishing'} write): no file came back: ` + JSON.stringify(names(drive)));
  assert.strictEqual(await A.local.getMeta('currentDesign'), null, 'no pointer');
  assert.deepStrictEqual(await A.local.listMetaKeys('driveShadow:'), [], 'no shadow');
}

// G2: concurrent loads of a shadowed design make exactly ONE copy / ONE re-creation
{
  const drive = createFakeDrive(); const A = device(drive); const B = device(drive);
  const p = await A.store.createProject('P'); const d = await A.store.newDesign('Door', { app: 'shaper', projectId: p.id });
  await A.store.save(doc(1), { id: d.id, app: 'shaper' }); await A.store.flushDrive(d.id);
  await B.store.open(d.id);
  A.offline = true; await A.store.save(doc(2), { id: d.id, app: 'shaper' }); await advance(6000);
  await B.store.save(doc(3), { id: d.id, app: 'shaper' }); await B.store.flushDrive(d.id);
  const A2 = device(drive, { local: A.local });
  const [x, y] = await Promise.all([A2.store.get(d.id), A2.store.get(d.id)]);
  assert.strictEqual(copies(drive).length, 1, 'G2: two concurrent loads, ONE conflicted copy: ' + JSON.stringify(names(drive)));
  assert.strictEqual(xOf(x), 3); assert.strictEqual(xOf(y), 3);
}
{
  const drive = createFakeDrive(); const A = device(drive);
  const p = await A.store.createProject('P'); const d = await A.store.newDesign('Door', { app: 'shaper', projectId: p.id });
  drive.failWrites = 1000; await A.store.save(doc(8), { id: d.id, app: 'shaper' }); await settle(); drive.failWrites = 0;
  drive.files.get(d.id.replace('drive:', '')).trashed = true;
  const A2 = device(drive, { local: A.local });
  await Promise.all([A2.store.get(d.id), A2.store.get(d.id), A2.store.get(d.id)]);
  assert.deepStrictEqual(names(drive), ['Door.sketch.json'], 'G2: three concurrent loads, ONE re-created file');
}
{ // a read while our OWN write is half done (Drive took the content, the metadata call is still pending) makes no copy
  const drive = createFakeDrive(); const A = device(drive);
  const p = await A.store.createProject('P'); const d = await A.store.newDesign('Door', { app: 'shaper', projectId: p.id });
  const h = hold(drive, isDesignMeta(d.id));
  await A.store.save(doc(5), { id: d.id, app: 'shaper' }); await settle();
  assert.strictEqual(h.hits, 1, 'the write is between the content upload and the metadata update');
  const reading = A.store.get(d.id); await settle();
  h.release(null); const got = await reading; await advance(10000); h.restore();
  assert.deepStrictEqual(copies(drive), [], 'G2: our own just-accepted write is not a foreign change: ' + JSON.stringify(names(drive)));
  assert.strictEqual(xOf(got), 5); assert.strictEqual(fileX(drive, d.id), 5);
}
{ // a newer local edit while a conflict copy exists: the SAME copy is updated, not a second one, and Drive's version is not overwritten
  const drive = createFakeDrive(); const A = device(drive); const B = device(drive);
  const p = await A.store.createProject('P'); const d = await A.store.newDesign('Door', { app: 'shaper', projectId: p.id });
  await A.store.save(doc(1), { id: d.id, app: 'shaper' }); await A.store.flushDrive(d.id);
  await B.store.open(d.id); await B.store.save(doc(3), { id: d.id, app: 'shaper' }); await B.store.flushDrive(d.id);
  await A.store.save(doc(2), { id: d.id, app: 'shaper' }); await A.store.flushDrive(d.id); // conflict: copy #1
  await A.store.save(doc(4), { id: d.id, app: 'shaper' }); await A.store.flushDrive(d.id); // newer edit, same foreign Drive version
  assert.strictEqual(copies(drive).length, 1, 'G2: one copy per foreign version: ' + JSON.stringify(names(drive)));
  const cf = [...drive.files.values()].find((f) => /conflicted copy/.test(f.name));
  assert.strictEqual(parseProjectFile(cf.content).document.geometry.joints[0][1].x, 4, 'the copy holds the newest local edit');
  assert.strictEqual(fileX(drive, d.id), 3, 'Drive version was never overwritten');
}

// G3: dropLocal must not delete the shadow of a newer edit that arrived while it was running
{
  let shadow = null; let release; const gate = new Promise((r) => { release = r; }); const written = [];
  const w = createDriveWriter({ now: () => clock, setTimer, clearTimer, write: async (id, p) => { written.push(p.v); },
    keepLocal: async (id, p) => { shadow = p; }, dropLocal: async () => { await gate; shadow = null; } });
  await w.queue('a', { v: 1, updatedAt: 1 }); await settle(); // written; its local copy is being dropped (slow)
  await w.queue('a', { v: 2, updatedAt: 2 }); // the newer edit lands and is kept meanwhile
  release(); await settle();
  assert.deepStrictEqual(shadow, { v: 2, updatedAt: 2 }, 'G3: the newer edit local copy survived the drop');
  await advance(6000); assert.deepStrictEqual(written, [1, 2]); assert.strictEqual(shadow, null, 'and goes after ITS write');
}

// G4: a project deleted / moved on purpose leaves nothing that could recreate its designs
{
  const drive = createFakeDrive(); const A = device(drive);
  const p = await A.store.createProject('Gone'); const d = await A.store.newDesign('Door', { app: 'shaper', projectId: p.id });
  drive.failWrites = 1000; await A.store.save(doc(9), { id: d.id, app: 'shaper' }); await settle(); drive.failWrites = 0;
  drive.files.get(d.id.replace('drive:', '')).trashed = true; // not listed any more, so the project counts as empty
  await A.store.removeProject(p.id);
  assert.deepStrictEqual(await A.local.listMetaKeys('driveShadow:'), [], 'G4: its designs local copies are gone');
  assert.deepStrictEqual(await A.local.listMetaKeys('driveBase:'), [], 'and their bases');
  const A2 = device(drive, { local: A.local }); await A2.store.loadCurrent({ app: 'shaper' }); await settle();
  assert.deepStrictEqual(names(drive), [], 'nothing was recreated on Drive'); assert.deepStrictEqual(await A2.store.listRecent(), [], 'nor on this device');
}
{
  const drive = createFakeDrive(); const A = device(drive);
  const p = await A.store.createProject('Moving'); const d = await A.store.newDesign('Door', { app: 'shaper', projectId: p.id });
  drive.failWrites = 1000; await A.store.save(doc(6), { id: d.id, app: 'shaper' }); await settle(); drive.failWrites = 0;
  const r = await A.store.cloud.makeProjectLocal(p.id);
  const local = await A.store.get(r.designIds[d.id]);
  assert.strictEqual(xOf(local), 6, 'G4: the unconfirmed edit was flushed to Drive BEFORE the copy down, so it is in the local copy');
  assert.deepStrictEqual(await A.local.listMetaKeys('driveShadow:'), [], 'no local copy of the Drive design is left');
  const A2 = device(drive, { local: A.local }); await A2.store.loadCurrent({ app: 'shaper' }); await settle();
  assert.deepStrictEqual(names(drive), [], 'the moved design is not recreated on Drive');
}

// G5: signed out = no attempts and no retry timers; signing in resumes
{
  const drive = createFakeDrive(); const A = device(drive);
  const p = await A.store.createProject('P'); const d = await A.store.newDesign('Door', { app: 'shaper', projectId: p.id });
  A.setSignedIn(false);
  await A.store.save(doc(4), { id: d.id, app: 'shaper' }); await settle();
  const before = A.attempts;
  await advance(600000);
  assert.strictEqual(A.attempts, before, 'G5: ten minutes signed out, zero Drive attempts: ' + (A.attempts - before));
  assert(/sign-in is needed/.test(A.store.status(d.id).reason), 'the status says why');
  assert(await A.local.getMeta('driveShadow:' + d.id), 'the edit is kept on this device meanwhile');
  A.setSignedIn(true); await settle();
  assert.strictEqual(fileX(drive, d.id), 4, 'signing in again sends it');
}

// #7: the document returned is the NEWEST local one even while its kept copy is still being written
{
  const drive = createFakeDrive(); const A = device(drive);
  const p = await A.store.createProject('P'); const d = await A.store.newDesign('Door', { app: 'shaper', projectId: p.id });
  drive.failWrites = 1000; await A.store.save(doc(1), { id: d.id, app: 'shaper' }); await settle(); drive.failWrites = 0;
  const realSet = A.local.setMeta; let release; const gate = new Promise((r) => { release = r; });
  A.local.setMeta = async (k, v) => { if (String(k).startsWith('driveShadow:') && v && v.updatedAt > clock - 1) { await gate; } return realSet.call(A.local, k, v); };
  clock += 10; const saving = A.store.save(doc(2), { id: d.id, app: 'shaper' }); await settle(); // queued; its kept copy is still being written
  const got = await A.store.get(d.id);
  assert.strictEqual(xOf(got), 2, '#7: the newer queued payload, not the older kept copy');
  release(); await saving; A.local.setMeta = realSet;
}

console.log('drive-first-safety: ok');
