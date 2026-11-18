// tests/drive-own-write-766-node.test.js — TASK 766 (owner turn 2307): a SINGLE writer never meets a Drive conflict. Against the FAKE Drive (no Google call),
// fake clock and timers. Before 766 the store called the Drive copy "changed by another device" whenever its `version` differed from the version this device
// last recorded; a write is two requests (the content, then the metadata) plus a read of the new version, so one failed request after the content landed (a
// 5xx, a 429, an expired token, a lost answer) left Drive one version ahead with OUR content, and the retry kept the edit as a "conflicted copy" and the page
// reloaded the design over the running one (view reset, selection dropped, the last cut settings gone). THE version rule now (project-store.js driveIsOurs):
// Drive's copy is ours when it has the base version OR exactly the content this device last put there / read from there.
//   1 the metadata PATCH after the content upload fails once: the retry overwrites, no copy, the file holds the newest edit
//   2 the read of the new version after a write fails once: same
//   3 Drive's version moves with the SAME content (an unrecorded bump): a plain overwrite, no copy
//   4 a page reloaded after a half-landed write: its unconfirmed local copy carries on, no copy
//   5 a REAL change by another device still keeps the local edit as a conflicted copy and never overwrites it
import assert from 'node:assert';
import { createFakeDrive } from './harness/fake-drive.js';
import { createDriveAdapter } from '../packages/ui/cloud/drive-adapter.js';
import { createRouterAdapter } from '../packages/ui/cloud/router-adapter.js';
import { createProjectStore, createMemoryAdapter, emptyDocument } from '../packages/ui/project-store.js';
import { parseProjectFile } from '../packages/ui/project-file.js';

let clock = Date.UTC(2026, 10, 17, 12, 0, 0);
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
const doc = (marker) => ({ ...emptyDocument(), geometry: { joints: [['j1', { x: marker, y: 0 }]], shapes: [], constraints: [] }, hosts: { shaper: { version: 1, cutPlan: [['loop:a', { cutType: 'pocket', cutDepth: marker }]] } } });
const fileX = (drive, id) => parseProjectFile(drive.files.get(id.replace(/^drive:/, '')).content).document.geometry.joints[0][1].x;
const names = (drive) => [...drive.files.values()].filter((f) => !f.trashed && /\.sketch\.json$/.test(f.name)).map((f) => f.name);
const copies = (drive) => names(drive).filter((n) => /conflicted copy/.test(n));

/** One device: its storage, its store; `fail(req)` answers a request with an error instead of passing it to Drive (true = a 503). */
function device(drive, { local = createMemoryAdapter() } = {}) {
  const dev = { local, fail: () => false };
  const account = { authedFetch: (url, opts = {}) => {
    if (dev.fail({ url, method: (opts.method || 'GET').toUpperCase() })) return Promise.resolve(new Response(JSON.stringify({ error: { code: 503 } }), { status: 503 }));
    return drive.fetch(url, { ...opts, headers: { Authorization: 'Bearer ' + drive.token, ...(opts.headers || {}) } });
  } };
  const remote = createDriveAdapter({ account, meta: local });
  const router = createRouterAdapter({ local, getRemote: () => remote, signedIn: () => true });
  dev.store = createProjectStore({ adapter: router, now: () => clock, channel: null, setTimer, clearTimer });
  return dev;
}
/** fail ONE request matching `pred` (the next one), then pass everything. */
const once = (pred) => { let armed = true; return (r) => { if (armed && pred(r)) { armed = false; return true; } return false; }; };
const metaPatch = (r) => r.method === 'PATCH' && !/\/upload\//.test(r.url) && /\/files\/[^/?]+\?/.test(r.url) && !/fields=id&|addParents/.test(r.url);
const versionRead = (r) => r.method === 'GET' && /\/files\/[^/?]+\?fields=/.test(r.url);

async function setup() {
  const drive = createFakeDrive(); const A = device(drive);
  const p = await A.store.createProject('P'); const d = await A.store.newDesign('bromont', { app: 'shaper', projectId: p.id });
  await A.store.save(doc(1), { id: d.id, app: 'shaper' }); await A.store.flushDrive(d.id);
  assert.strictEqual(fileX(drive, d.id), 1);
  return { drive, A, d };
}

// ---- 1 / 2: one request of a write fails after the content landed ----
for (const [label, pred] of [['the metadata PATCH', metaPatch], ['the read of the new version', versionRead]]) {
  const { drive, A, d } = await setup();
  let after = false; // fail only once the content upload of the NEXT write went through
  A.fail = once((r) => { if (r.method === 'PATCH' && /\/upload\//.test(r.url)) after = true; return after && pred(r); });
  await A.store.save(doc(2), { id: d.id, app: 'shaper' }); await advance(6000);
  assert.strictEqual(A.store.status(d.id).state, 'failed', `${label} failed: the write is retried`);
  await A.store.save(doc(3), { id: d.id, app: 'shaper' }); await advance(70000);
  assert.deepStrictEqual(copies(drive), [], `${label} failed once: NO conflicted copy (our own write is not another device's): ` + JSON.stringify(names(drive)));
  assert.strictEqual(fileX(drive, d.id), 3, `${label} failed once: Drive holds the newest edit`);
  assert.strictEqual(A.store.status(d.id).notice, null, `${label} failed once: no "Another device changed this design" notice`);
  assert.strictEqual(A.store.status(d.id).state, 'saved');
  for (let i = 4; i <= 33; i++) { await A.store.save(doc(i), { id: d.id, app: 'shaper' }); await advance(i % 3 ? 2000 : 6000); if (i % 5 === 0) await A.store.flushDrive(d.id); }
  await A.store.flushDrive(d.id);
  assert.deepStrictEqual(copies(drive), [], `${label}: 30 more edits, saves and flushes: zero conflicted copies`);
  assert.strictEqual(fileX(drive, d.id), 33);
}

// ---- 3: Drive's version moves with the SAME content ----
{
  const { drive, A, d } = await setup();
  const f = drive.files.get(d.id.replace(/^drive:/, '')); f.version += 3; // a bump that changed nothing this device would see
  await A.store.save(doc(2), { id: d.id, app: 'shaper' }); await advance(6000);
  assert.deepStrictEqual(copies(drive), [], 'a version bump with the same content: no conflicted copy');
  assert.strictEqual(fileX(drive, d.id), 2, 'and the edit is written');
}

// ---- 4: a page reloaded after a half-landed write ----
{
  const { drive, A, d } = await setup();
  let after = false;
  A.fail = (r) => { if (r.method === 'PATCH' && /\/upload\//.test(r.url)) after = true; return after && metaPatch(r); }; // the metadata never lands
  await A.store.save(doc(2), { id: d.id, app: 'shaper' }); await advance(6000);
  assert.strictEqual(A.store.status(d.id).state, 'failed');
  const A2 = device(drive, { local: A.local }); // the page reloads (same device storage)
  const cur = await A2.store.loadCurrent({ app: 'shaper' });
  assert.strictEqual(cur.document.geometry.joints[0][1].x, 2, 'the reloaded page opens the unconfirmed edit');
  await advance(70000);
  assert.deepStrictEqual(copies(drive), [], 'a reload after a half-landed write: no conflicted copy');
  assert.strictEqual(fileX(drive, d.id), 2);
}

// ---- 5: a REAL change by another device is never overwritten ----
{
  const { drive, A, d } = await setup();
  const B = device(drive);
  await B.store.open(d.id);
  await B.store.save(doc(50), { id: d.id, app: 'shaper' }); await B.store.flushDrive(d.id);
  await A.store.save(doc(2), { id: d.id, app: 'shaper' }); await advance(6000);
  assert.strictEqual(fileX(drive, d.id), 50, 'the other device\'s version stands');
  assert.strictEqual(copies(drive).length, 1, 'our edit is kept as ONE conflicted copy');
  assert(/^Another device changed this design/.test(A.store.status(d.id).notice), 'and the notice says so');
}
console.log('drive-own-write-766-node: ok');
