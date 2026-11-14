// tests/drive-first.test.js — TASK 506 / 624: Drive-only saved designs, against a FAKE Drive (no Google call anywhere), fake clock and timers.
//   A. NEW projects / designs go ONLY to Drive when signed in (ONE "My Designs", never duplicated); signed out rejects; legacy local stays in place
//   B. autosave of a design on Drive: THROTTLED (>= 5 s between writes), flushed on demand / when the tab hides, 458 sidecar merge kept
//   C. the local safety net: a failed Drive write keeps the local copy, shows the reason, retries with BACKOFF, and a reload recovers it
//   D. Drive unreachable when something NEW is created: refuses with a clear message and leaves nothing local (drawing stays in tab buffer)
//   E. Out-of-band Drive deletion: emptied folder (deleted design file inside existing folder) writes a fresh file into the existing folder;
//      deleted folder / deleted root folder recreates cleanly on Drive
//   F. "Check Google Drive connection": every step reported, a failing step stops the rest, the test file is cleaned up
//   G. the writer on its own (throttle policy as data, no store)
import assert from 'node:assert';
import { createFakeDrive } from './harness/fake-drive.js';
import { createDriveAdapter, driveErrorText, CHECK_STEPS } from '../packages/ui/cloud/drive-adapter.js';
import { createRouterAdapter, isRemoteId } from '../packages/ui/cloud/router-adapter.js';
import { createProjectStore, createMemoryAdapter, emptyDocument } from '../packages/ui/project-store.js';
import { createDocumentBuffer } from '../packages/ui/document-buffer.js';
import { createDriveWriter } from '../packages/ui/cloud/drive-writer.js';
import { parseProjectFile } from '../packages/ui/project-file.js';

// ---- fake clock + timers -------------------------------------------------------------------------------------------------
let clock = 1_000_000;
let timers = [];
let seq = 0;
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
const state = { signedIn: true, token: null };
const accountFor = (drive) => ({
  authedFetch: (url, opts = {}) => {
    if (!state.signedIn) return Promise.reject(new Error('cloud-auth'));
    return drive.fetch(url, { ...opts, headers: { Authorization: 'Bearer ' + (state.token || drive.token), ...(opts.headers || {}) } });
  },
});
/** One DEVICE: its own local adapter + router + store over a (shared) fake Drive. */
function device(drive, { local = createMemoryAdapter() } = {}) {
  const remote = createDriveAdapter({ account: accountFor(drive), meta: local });
  const router = createRouterAdapter({ local, getRemote: () => remote, signedIn: () => state.signedIn });
  const store = createProjectStore({ adapter: router, now: () => clock, channel: null, setTimer, clearTimer });
  return { store, local, router, drive };
}
const uploads = (drive) => drive.requests.filter((r) => r.method === 'PATCH' && r.url.includes('/upload/drive/v3/files/'));
const liveFolders = (drive, name) => drive.byName(name).filter((f) => !f.trashed);
const reset = () => { state.signedIn = true; timers = []; clock += 1_000_000; };

// ---- A. where NEW things are created ---------------------------------------------------------------------------------------
{
  reset();
  const drive = createFakeDrive(); const { store, local } = device(drive);
  const p = await store.createProject('Garage');
  assert(isRemoteId(p.id), 'ON + signed in: a NEW project is created on Drive');
  assert.strictEqual(liveFolders(drive, 'Garage').length, 1);
  const d = await store.newDesign('Shelf', { app: 'shaper', projectId: p.id });
  assert(isRemoteId(d.id), 'a design in a Drive project lives on Drive');
  assert.strictEqual(drive.byName('Shelf.sketch.json').length, 1);

  // a new design in the project of the current design stays in it
  const inCurrent = await store.newDesign('Next', { app: 'shaper' });
  assert.strictEqual(inCurrent.projectId, p.id);

  // the default project for a first-time signed-in user (no design yet): created on Drive, found by name (no duplicate)
  const first = device(drive);
  await first.store.newDesign('First', { app: 'shaper' });
  const projects = await first.store.listProjects();
  assert(projects.some((x) => x.name === 'My Designs' && x.location === 'drive'), 'the default project "My Designs" is on Drive');
  assert(!(await first.local.getProject('my-designs')), 'and no local "My Designs" was made');
  assert.strictEqual(liveFolders(drive, 'My Designs').length, 1);
  await first.store.newDesign('Second', { app: 'shaper' });
  assert.strictEqual(liveFolders(drive, 'My Designs').length, 1, 'ONE "My Designs" however many designs are made');

  // a second DEVICE (its own local storage) signing in later finds the same project; two devices at the same moment still end with one
  const b = device(drive);
  await b.store.newDesign('From the laptop', { app: 'shaper' });
  assert.strictEqual(liveFolders(drive, 'My Designs').length, 1, 'another device reuses it');
  const drive2 = createFakeDrive();
  const [x, y] = [device(drive2), device(drive2)];
  await Promise.all([x.store.newDesign('X', { app: 'shaper' }), y.store.newDesign('Y', { app: 'shaper' })]);
  assert.strictEqual(liveFolders(drive2, 'My Designs').length, 1, 'two devices creating it at the same moment: ONE survives (the loser trashes its own)');
  assert.strictEqual((await x.store.listRecent()).length, 2, 'both designs live in it');
}
{ // signed out: new projects / designs cannot be created locally; legacy local projects stay openable and signing in moves nothing
  reset(); state.signedIn = false;
  const drive = createFakeDrive(); const dev = device(drive);
  await assert.rejects(() => dev.store.createProject('Blocked'), /cloud-auth|Google Drive/);
  await assert.rejects(() => dev.store.newDesign('Blocked', { app: 'shaper' }), /cloud-auth|Google Drive/);
  assert.strictEqual(drive.calls.length, 0, 'signed out: no Drive API call attempted');
  assert.deepStrictEqual(await dev.local.listProjects(), [], 'signed out: nothing created locally');
  assert.deepStrictEqual(await dev.local.listDesigns(), [], 'signed out: no local named design created');

  // seed a legacy local project directly on device storage: it keeps working locally and signing in never auto-moves it
  await dev.local.putProject({ id: 'legacy-p', name: 'Old', pinned: false, updatedAt: clock });
  await dev.local.putDesign({ id: 'legacy-d', projectId: 'legacy-p', name: 'Old design', app: 'shaper', updatedAt: clock, document: doc(1) });
  state.signedIn = true;
  await dev.store.save(doc(2), { id: 'legacy-d', app: 'shaper' });
  assert.strictEqual((await dev.store.get('legacy-d')).document.geometry.joints[0][1].x, 2, 'legacy local design saves in place');
  assert.strictEqual(drive.byName('Old').length, 0); assert.strictEqual(drive.byName('Old design.sketch.json').length, 0, 'nothing was moved automatically');
  const np = await dev.store.createProject('New');
  const nd = await dev.store.newDesign('New design', { app: 'shaper', projectId: np.id });
  assert(isRemoteId(np.id) && isRemoteId(nd.id), 'all NEW projects/designs go ONLY to Drive');
}

// ---- B. throttle ------------------------------------------------------------------------------------------------------------
{
  reset();
  const drive = createFakeDrive(); const { store } = device(drive);
  const p = await store.createProject('P'); const d = await store.newDesign('D', { app: 'shaper', projectId: p.id });
  const before = uploads(drive).length;
  const times = [];
  const realFetch = drive.fetch;
  drive.fetch = (url, init = {}) => { if ((init.method || '') === 'PATCH' && String(url).includes('/upload/')) times.push(clock); return realFetch(url, init); };
  for (let i = 1; i <= 20; i++) { await store.save(doc(i), { id: d.id, app: 'shaper' }); await advance(1500); } // a 1.5 s autosave tick for 30 s
  drive.fetch = realFetch;
  assert(times.length >= 5 && times.length <= 7, 'about one write per 5 s over 30 s of ticks, got ' + times.length);
  for (let i = 1; i < times.length; i++) assert(times[i] - times[i - 1] >= 5000, 'at least 5 s between two Drive writes: ' + (times[i] - times[i - 1]));
  await advance(6000);
  const file = drive.files.get(d.id.slice(6));
  assert.strictEqual(parseProjectFile(file.content).document.geometry.joints[0][1].x, 20, 'the newest tick is what Drive ends up with');
  assert.strictEqual(store.status(d.id).state, 'saved');
  // flush: a change right after a write waits for the interval, flushDrive writes it NOW
  await store.save(doc(21), { id: d.id, app: 'shaper' }); await store.save(doc(22), { id: d.id, app: 'shaper' });
  assert.strictEqual(parseProjectFile(drive.files.get(d.id.slice(6)).content).document.geometry.joints[0][1].x, 20, 'throttled: not written yet');
  assert.strictEqual(store.status(d.id).state, 'saving');
  await store.flushDrive(d.id);
  assert.strictEqual(parseProjectFile(drive.files.get(d.id.slice(6)).content).document.geometry.joints[0][1].x, 22, 'flush writes the newest immediately');
  assert.strictEqual(store.status(d.id).state, 'saved');
  void before;

  // 458: another host sidecar already on Drive passes through
  await store.save(doc(30, { penplotter: { pens: 2 } }), { id: d.id, app: 'penplotter' }); await store.flushDrive(d.id);
  await store.save(doc(31, { shaper: { cut: 'pocket' } }), { id: d.id, app: 'shaper' }); await store.flushDrive(d.id);
  assert.deepStrictEqual(Object.keys((await store.get(d.id)).document.hosts).sort(), ['penplotter', 'shaper'], 'both sidecars kept on Drive');
}
{ // the buffer: the tab hiding / closing flushes a pending change through to Drive without waiting for the interval
  reset();
  const drive = createFakeDrive(); const { store } = device(drive);
  const p = await store.createProject('P'); const d = await store.newDesign('D', { app: 'shaper', projectId: p.id });
  const listeners = {};
  const fakeDoc = { visibilityState: 'visible', addEventListener: (t, f) => { listeners[t] = f; }, removeEventListener: (t) => { delete listeners[t]; } };
  const fakeWin = { addEventListener: (t, f) => { listeners[t] = f; }, removeEventListener: (t) => { delete listeners[t]; } };
  const st = { joints: new Map(), shapes: [], constraints: [] };
  const buf = createDocumentBuffer({ state: st, app: 'shaper', store, pollMs: 1e9, doc: fakeDoc, win: fakeWin });
  await buf.openDesign(d.id);
  buf.start();
  st.joints.set('j1', { x: 1, y: 1 }); await buf.flush(); // written (first write)
  st.joints.set('j2', { x: 7, y: 7 }); // within the interval: poll would be throttled
  fakeDoc.visibilityState = 'hidden'; listeners.visibilitychange();
  await settle();
  assert(parseProjectFile(drive.files.get(d.id.slice(6)).content).document.geometry.joints.some((j) => j[0] === 'j2'), 'hidden tab: the last change reached Drive at once');
  st.joints.set('j3', { x: 8, y: 8 });
  listeners.pagehide(); await settle();
  assert(parseProjectFile(drive.files.get(d.id.slice(6)).content).document.geometry.joints.some((j) => j[0] === 'j3'), 'closing tab: flushed too');
  buf.stop();
  assert.deepStrictEqual(Object.keys(listeners), [], 'stop() removes the tab listeners');
}

// ---- C. the local safety net, retry with backoff, recovery on reload ---------------------------------------------------------
{
  reset();
  const drive = createFakeDrive(); const dev = device(drive); const { store, local } = dev;
  const p = await store.createProject('P'); const d = await store.newDesign('D', { app: 'shaper', projectId: p.id });
  drive.failWrites = 1000;
  await store.save(doc(5), { id: d.id, app: 'shaper' }); await settle();
  let st = store.status(d.id);
  assert.strictEqual(st.state, 'failed'); assert.strictEqual(st.where, 'drive');
  assert.strictEqual(st.reason, 'Google Drive answered HTTP 500', 'the reason is exact: ' + st.reason);
  const shadow = await local.getMeta('driveShadow:' + d.id);
  assert(shadow && shadow.document.geometry.joints[0][1].x === 5, 'the latest document is kept on this device while Drive has it not');
  // backoff: attempts at +5 s, then +10 s, then +20 s (not every tick)
  const attempts = () => drive.requests.filter((r) => r.method === 'PATCH').length;
  let n0 = attempts();
  await advance(4000); assert.strictEqual(attempts(), n0, 'no retry before the first backoff (5 s)');
  await advance(1500); assert(attempts() > n0, 'retry after 5 s'); n0 = attempts();
  await advance(9000); assert.strictEqual(attempts(), n0, 'the next retry waits 10 s, not 5');
  await advance(1500); assert(attempts() > n0, 'retry after 10 s'); n0 = attempts();
  await advance(18000); assert.strictEqual(attempts(), n0, 'then 20 s');
  assert.strictEqual(store.status(d.id).state, 'failed');
  assert(await local.getMeta('driveShadow:' + d.id), 'the local copy is never dropped while writes fail');
  // newer ticks while failing replace the pending payload (one write later, the newest)
  await store.save(doc(6), { id: d.id, app: 'shaper' });
  drive.failWrites = 0;
  await advance(25000);
  assert.strictEqual(store.status(d.id).state, 'saved', 'the retry succeeded');
  assert.strictEqual(parseProjectFile(drive.files.get(d.id.slice(6)).content).document.geometry.joints[0][1].x, 6, 'Drive got the NEWEST document');
  assert.strictEqual(await local.getMeta('driveShadow:' + d.id), null, 'and only then was the local copy dropped');
}
{ // reload while a write was unconfirmed: the design opens from the local copy and the write is queued again
  reset();
  const drive = createFakeDrive(); const a = device(drive);
  const p = await a.store.createProject('P'); const d = await a.store.newDesign('D', { app: 'shaper', projectId: p.id });
  drive.failWrites = 1000;
  await a.store.save(doc(9), { id: d.id, app: 'shaper' }); await settle();
  drive.failWrites = 0;
  const b = device(drive, { local: a.local }); // "the page was reloaded": a fresh store on the same device storage
  const cur = await b.store.loadCurrent({ app: 'shaper' });
  assert.strictEqual(cur.document.geometry.joints[0][1].x, 9, 'the unsaved work comes back from the local copy');
  await b.store.flushDrive(d.id);
  assert.strictEqual(parseProjectFile(drive.files.get(d.id.slice(6)).content).document.geometry.joints[0][1].x, 9, 'and reaches Drive');
  assert.strictEqual(await a.local.getMeta('driveShadow:' + d.id), null);
}
{ // signed out while the current design is on Drive and nothing is pending: it starts empty, the pointer is KEPT (transient), nothing is written blind
  reset();
  const drive = createFakeDrive(); const a = device(drive);
  const p = await a.store.createProject('P'); await a.store.newDesign('D', { app: 'shaper', projectId: p.id });
  state.signedIn = false;
  const b = device(drive, { local: a.local });
  assert.strictEqual(await b.store.loadCurrent({ app: 'shaper' }), null, 'unreadable Drive design: nothing is opened');
  assert.strictEqual(await a.local.getMeta('currentDesign'), 'drive:fakeid-2', 'a transient failure keeps the pointer (only a permanent one clears it)');
  assert.deepStrictEqual((await b.store.listProjects()).filter((x) => x.location === 'drive'), [], 'Drive projects are not listed while signed out');
  state.signedIn = true;
  assert.strictEqual((await b.store.listProjects()).filter((x) => x.location === 'drive').length, 1, 'signing in again restores them');
  assert.strictEqual(await b.store.cloud.isEnabled(), true);
}

// ---- D. Drive unreachable for something NEW (Decision 4: refuse cleanly, never fall back to local named design) ------------------
{
  reset();
  const drive = createFakeDrive(); const { store, local } = device(drive);
  drive.offline = true;
  await assert.rejects(() => store.newDesign('Offline one', { app: 'shaper' }), /Google Drive can't be reached; your drawing is kept, try again when online/);
  await assert.rejects(() => store.createProject('Also offline'), /Google Drive can't be reached; your drawing is kept, try again when online/);
  assert.deepStrictEqual(await local.listDesigns(), [], 'offline failure leaves no local named design');
  assert.deepStrictEqual(await local.listProjects(), [], 'offline failure leaves no local project');
  drive.offline = false;
  const back = await store.createProject('Back online');
  assert(isRemoteId(back.id), 'back online a NEW project goes to Drive');
  const e = await store.newDesign('Online again', { app: 'shaper', projectId: back.id });
  assert(isRemoteId(e.id)); assert.strictEqual(store.status(e.id).where, 'drive'); assert.strictEqual(store.status(e.id).reason, null);
  // an explicit Drive project that fails while offline also refuses with the exact message
  const dp = await store.createProject('Drive proj'); assert(isRemoteId(dp.id));
  drive.offline = true;
  await assert.rejects(() => store.newDesign('Into it', { projectId: dp.id }), /Google Drive can't be reached; your drawing is kept, try again when online/);
}

// ---- E. Out-of-band Drive deletion (624 note + correction: emptied folder OR deleted folder / root) -------------------------
{
  reset();
  const drive = createFakeDrive(); const dev = device(drive); const { store } = dev;
  const d = await store.newDesign('EmptyMe', { app: 'shaper' });
  await store.save(doc(4, { shaper: { cut: 'inside' } }), { id: d.id, app: 'shaper' }); await store.flushDrive(d.id);
  const myDesignsFolders = liveFolders(drive, 'My Designs');
  assert.strictEqual(myDesignsFolders.length, 1);
  const folderId = myDesignsFolders[0].id;
  // 1) Owner emptied "My Designs" out of band (deleted the file permanently, folder stays!): next save creates a fresh file INSIDE existing folder
  drive.files.delete(d.id.slice(6));
  await store.save(doc(8, { shaper: { cut: 'inside' } }), { id: d.id, app: 'shaper' });
  await store.flushDrive();
  const curAfterFileGone = await store.current();
  assert(curAfterFileGone && isRemoteId(curAfterFileGone.id) && curAfterFileGone.id !== d.id, 'fresh Drive file created');
  assert.strictEqual(curAfterFileGone.projectId, 'drive:' + folderId, 'placed into EXISTING My Designs folder (not duplicated)');
  assert.strictEqual(liveFolders(drive, 'My Designs').length, 1, 'still only one My Designs folder');
  const freshFile = drive.files.get(curAfterFileGone.id.slice(6));
  assert(freshFile && freshFile.parents.includes(folderId) && parseProjectFile(freshFile.content).document.geometry.joints[0][1].x === 8, 'fresh file holds latest work');
  // 2) Remembered "My Designs" folder AND root "Sketch Studio" folder deleted out of band: detected and recreated on Drive (never locally)
  const rootId = await dev.local.getMeta('driveRootId');
  assert(rootId, 'driveRootId was cached');
  drive.files.delete(curAfterFileGone.id.slice(6));
  drive.files.delete(folderId);
  drive.files.delete(rootId);
  const dNext = await store.newDesign('FreshAfterFolderGone', { app: 'shaper' });
  assert(isRemoteId(dNext.id) && isRemoteId(dNext.projectId), 'recreated cleanly on Drive after folder deletion');
  assert.strictEqual(liveFolders(drive, 'Sketch Studio').length, 1, 'root folder recreated on Drive');
  assert.strictEqual(liveFolders(drive, 'My Designs').length, 1, 'My Designs folder recreated on Drive');
  assert.notStrictEqual(liveFolders(drive, 'Sketch Studio')[0].id, rootId, 'new root id replaces deleted cached id');
  assert.deepStrictEqual(await dev.local.listProjects(), [], 'no local project created on Drive folder loss');
}

// ---- F. "Check Google Drive connection" -------------------------------------------------------------------------------------
{
  reset();
  const drive = createFakeDrive(); const { router } = device(drive);
  const seen = [];
  const steps = await router.cloud.checkConnection((s) => seen.push(s.map((x) => x.state).join(',')));
  assert.deepStrictEqual(steps.map((s) => s.id), CHECK_STEPS.map((s) => s.id));
  assert(steps.every((s) => s.state === 'ok' && s.status === 200), 'all five steps OK: ' + JSON.stringify(steps));
  assert.strictEqual(liveFolders(drive, 'Sketch Studio').length, 1, 'the root folder was found or created');
  const test = drive.byName('sketch-studio-connection-test.txt');
  assert.strictEqual(test.length, 1); assert.strictEqual(test[0].trashed, true, 'the test file was trashed');
  assert(seen.some((x) => x.startsWith('running')) && seen[seen.length - 1] === 'ok,ok,ok,ok,ok', 'progress is reported step by step: ' + seen[seen.length - 1]);
  // a bad token: step 1 fails with its HTTP status, the rest are skipped, no file is created
  state.token = 'EXPIRED';
  const bad = await router.cloud.checkConnection();
  assert.deepStrictEqual(bad.map((s) => s.state), ['failed', 'skipped', 'skipped', 'skipped', 'skipped']);
  assert.strictEqual(bad[0].status, 401);
  assert.strictEqual(drive.byName('sketch-studio-connection-test.txt').length, 1, 'no test file was created');
  state.token = null;
  // the write step failing: it reports the status and the later steps are skipped
  drive.failWrites = 1;
  const w = await router.cloud.checkConnection();
  assert.deepStrictEqual(w.map((s) => s.state), ['ok', 'ok', 'failed', 'skipped', 'skipped']);
  assert.strictEqual(w[2].status, 500); assert(/HTTP 500/.test(w[2].detail), w[2].detail);
  // the delete step failing is reported as failed too (the file did exist)
  drive.beforeWrite = ({ method, path }) => { if (method === 'PATCH' && !path.includes('/upload/')) drive.failWrites = 1; };
  const t = await router.cloud.checkConnection();
  drive.beforeWrite = null;
  assert.deepStrictEqual(t.map((s) => s.state), ['ok', 'ok', 'ok', 'ok', 'failed']); assert.strictEqual(t[4].status, 500);
  // signed out: a step fails with the sign-in reason, never a thrown error
  state.signedIn = false;
  const so = await router.cloud.checkConnection();
  assert.strictEqual(so[0].state, 'failed'); assert(/sign-in is needed/.test(so[0].detail), so[0].detail);
}

// ---- G. the writer on its own (throttle policy as data, no store) -------------------------------------------------------------
{
  reset();
  const log = []; let kept = null, fail = false;
  const w = createDriveWriter({
    now: () => clock, setTimer, clearTimer,
    write: async (id, p) => { if (fail) throw new Error('Drive 503'); log.push(['w', clock, p.v]); },
    keepLocal: async (id, p) => { kept = p; }, dropLocal: async () => { kept = null; },
  });
  await w.queue('a', { v: 1 }); await settle();
  await w.queue('a', { v: 2 }); await w.queue('a', { v: 3 }); await settle();
  assert.deepStrictEqual(log.map((l) => l[2]), [1], 'the first write is immediate, the rest wait for the interval');
  assert.deepStrictEqual(kept, { v: 3 }, 'while waiting, the newest payload is kept locally');
  await advance(5000);
  assert.deepStrictEqual(log.map((l) => l[2]), [1, 3], 'ticks 2 and 3 collapsed into ONE write of the newest');
  assert.strictEqual(kept, null, 'the local copy goes once it is confirmed');
  assert.strictEqual(w.status('a').state, 'saved');
  fail = true; await w.queue('a', { v: 4 }); await advance(5000); await settle();
  assert.deepStrictEqual(w.status('a'), { state: 'failed', at: w.status('a').at, reason: 'Drive 503' });
  assert.deepStrictEqual(kept, { v: 4 });
  w.cancel('a'); fail = false; await advance(120000);
  assert.deepStrictEqual(log.map((l) => l[2]), [1, 3], 'a cancelled design is never written again');
}

console.log('drive-first: ok');
