// tests/drive-first.test.js — TASK 506: Google Drive FIRST, against a FAKE Drive (no Google call anywhere), fake clock and timers.
//   A. the default "Save to Google Drive" setting (preferDrive): ON + signed in puts NEW projects / designs on Drive (ONE "My Designs",
//      never duplicated across devices / tabs); OFF or signed out stays local and makes no Drive call; signing in moves nothing
//   B. autosave of a design on Drive: THROTTLED (>= 5 s between writes), flushed on demand / when the tab hides, 458 sidecar merge kept
//   C. the local safety net: a failed Drive write keeps the local copy, shows the reason, retries with BACKOFF, and a reload recovers it
//   D. Drive unreachable when something NEW is created: it falls back to this device and says why
//   E. "Save to Google Drive" (store.cloud.saveToDrive): My Designs on Drive, one copy updated on a repeat, local project untouched, failure
//   F. "Check Google Drive connection": every step reported, a failing step stops the rest, the test file is cleaned up
//   G. the status the sidebar line reads (store.status) for each state
import assert from 'node:assert';
import { createFakeDrive } from './harness/fake-drive.js';
import { createDriveAdapter, driveFileUrl, driveErrorText, CHECK_STEPS } from '../packages/ui/cloud/drive-adapter.js';
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
const state = { signedIn: true, prefer: true, token: null };
const accountFor = (drive) => ({
  authedFetch: (url, opts = {}) => {
    if (!state.signedIn) return Promise.reject(new Error('cloud-auth'));
    return drive.fetch(url, { ...opts, headers: { Authorization: 'Bearer ' + (state.token || drive.token), ...(opts.headers || {}) } });
  },
});
/** One DEVICE: its own local adapter + router + store over a (shared) fake Drive. */
function device(drive, { local = createMemoryAdapter(), prefer = () => state.signedIn && state.prefer } = {}) {
  const remote = createDriveAdapter({ account: accountFor(drive), meta: local });
  const router = createRouterAdapter({ local, getRemote: () => remote, preferDrive: prefer });
  const store = createProjectStore({ adapter: router, now: () => clock, channel: null, setTimer, clearTimer });
  return { store, local, router, drive };
}
const uploads = (drive) => drive.requests.filter((r) => r.method === 'PATCH' && r.url.includes('/upload/drive/v3/files/'));
const liveFolders = (drive, name) => drive.byName(name).filter((f) => !f.trashed);
const reset = () => { state.signedIn = true; state.prefer = true; timers = []; clock += 1_000_000; };

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
{ // toggle OFF, and signed out: LOCAL exactly as before, no Drive call
  for (const [label, on] of [['toggle OFF', () => { state.prefer = false; }], ['signed out', () => { state.signedIn = false; }]]) {
    reset(); on();
    const drive = createFakeDrive(); const { store } = device(drive);
    const p = await store.createProject('Local one');
    const d = await store.newDesign('Mine', { app: 'shaper' });
    const d2 = await store.newDesign('In project', { app: 'shaper', projectId: p.id });
    assert(!isRemoteId(p.id) && !isRemoteId(d.id) && !isRemoteId(d2.id), label + ': everything is local');
    await store.save(doc(1), { id: d.id, app: 'shaper' });
    assert.strictEqual(drive.calls.length, 0, label + ': no Drive call at all');
    assert.deepStrictEqual(store.status(d.id), { where: 'device', state: 'saved', at: null, reason: null, notice: null });
  }
}
{ // signing in moves NOTHING that exists: a local design keeps saving locally; only NEW projects go to Drive
  reset(); state.signedIn = false;
  const drive = createFakeDrive(); const dev = device(drive);
  const p = await dev.store.createProject('Old'); const d = await dev.store.newDesign('Old design', { app: 'shaper', projectId: p.id });
  state.signedIn = true;
  const sig = JSON.stringify([await dev.local.listProjects(), await dev.local.listDesigns()]);
  await dev.store.save(doc(2), { id: d.id, app: 'shaper' });
  const n = await dev.store.newDesign('Next to it', { app: 'shaper', projectId: p.id });
  assert(!isRemoteId(d.id) && !isRemoteId(n.id), 'a design in a LOCAL project stays local, signed in or not');
  assert.deepStrictEqual((await dev.local.listProjects()).map((x) => x.id), JSON.parse(sig)[0].map((x) => x.id), 'no local project left or changed');
  assert.strictEqual(drive.byName('Old').length, 0); assert.strictEqual(drive.byName('Old design.sketch.json').length, 0, 'nothing of it was copied to Drive');
  const np = await dev.store.createProject('New');
  assert(isRemoteId(np.id), 'only NEW projects follow the default');
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

// ---- D. Drive unreachable for something NEW --------------------------------------------------------------------------------
{
  reset();
  const drive = createFakeDrive(); const { store } = device(drive);
  drive.offline = true;
  const d = await store.newDesign('Offline one', { app: 'shaper' });
  assert(!isRemoteId(d.id), 'Drive unreachable: the design is created on this device');
  const s = store.status(d.id);
  assert.strictEqual(s.where, 'device'); assert(/could not be reached/.test(s.reason), 'with the reason: ' + s.reason);
  const p = await store.createProject('Also offline');
  assert(!isRemoteId(p.id), 'and so is a new project');
  await store.save(doc(3), { id: d.id, app: 'shaper' });
  assert.strictEqual((await store.get(d.id)).document.geometry.joints[0][1].x, 3, 'nothing is lost');
  drive.offline = false;
  assert(!isRemoteId((await store.newDesign('Next to it', { app: 'shaper' })).id), 'a design next to a local one stays in its local project (nothing moves by itself)');
  const back = await store.createProject('Back online');
  assert(isRemoteId(back.id), 'back online a NEW project goes to Drive again');
  const e = await store.newDesign('Online again', { app: 'shaper', projectId: back.id });
  assert(isRemoteId(e.id)); assert.strictEqual(store.status(e.id).where, 'drive'); assert.strictEqual(store.status(e.id).reason, null, 'the failure note is cleared once Drive works');
  // an explicit Drive project that fails is the user's to see (no silent local copy of it)
  const dp = await store.createProject('Drive proj'); assert(isRemoteId(dp.id));
  drive.offline = true;
  await assert.rejects(() => store.newDesign('Into it', { projectId: dp.id }), /network unreachable/);
}

// ---- E. "Save to Google Drive" ---------------------------------------------------------------------------------------------
{
  reset(); state.prefer = false; // the default is OFF here: the action works on its own
  const drive = createFakeDrive(); const { store, local } = device(drive);
  const proj = await store.createProject('Kitchen'); const d = await store.newDesign('Door', { app: 'shaper', projectId: proj.id });
  await store.save(doc(4, { shaper: { cut: 'inside' } }), { id: d.id, app: 'shaper' });
  const r = await store.cloud.saveToDrive(d.id);
  const file = drive.files.get(r.fileId);
  assert.strictEqual(file.name, 'Door.sketch.json');
  assert.strictEqual(liveFolders(drive, 'My Designs').length, 1, 'saved into the Drive project "My Designs", created when absent');
  assert.deepStrictEqual(file.parents, [liveFolders(drive, 'My Designs')[0].id]);
  assert.strictEqual(parseProjectFile(file.content).document.geometry.joints[0][1].x, 4);
  assert.strictEqual(driveFileUrl(r.fileId), `https://drive.google.com/file/d/${r.fileId}/view`);
  assert(await local.getProject(proj.id), 'the whole local project was NOT moved'); assert(await local.getDesign(d.id), 'the design stays local');
  assert.strictEqual(drive.byName('Kitchen').length, 0);
  // again: the same Drive file is updated, no second copy, still one My Designs
  await store.save(doc(8), { id: d.id, app: 'shaper' });
  const r2 = await store.cloud.saveToDrive(d.id);
  assert.strictEqual(r2.fileId, r.fileId); assert.strictEqual(drive.byName('Door.sketch.json').length, 1);
  assert.strictEqual(parseProjectFile(drive.files.get(r.fileId).content).document.geometry.joints[0][1].x, 8);
  assert.strictEqual(liveFolders(drive, 'My Designs').length, 1);
  // failure: the exact reason, the local design intact
  drive.failWrites = 1000; await store.save(doc(9), { id: d.id, app: 'shaper' });
  await assert.rejects(() => store.cloud.saveToDrive(d.id), (e) => driveErrorText(e) === 'Google Drive answered HTTP 500');
  assert.strictEqual((await store.get(d.id)).document.geometry.joints[0][1].x, 9, 'a failed save loses nothing');
  drive.failWrites = 0;
  // a design that already lives on Drive: its own file, nothing copied
  state.prefer = true;
  const onDrive = await store.newDesign('Already', { app: 'shaper', projectId: (await store.createProject('Drive one')).id });
  const r3 = await store.cloud.saveToDrive(onDrive.id);
  assert.strictEqual(r3.fileId, onDrive.id.slice(6)); assert.strictEqual(drive.byName('Already.sketch.json').length, 1);
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
