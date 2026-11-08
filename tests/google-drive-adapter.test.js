// tests/google-drive-adapter.test.js — TASK 480: the Drive adapter (project = folder under "Sketch Studio", design = .sketch.json file
// with appProperties) behind the project-store seam, against a FAKED Drive REST, plus the ROUTER that keeps local projects local.
// No real Google call anywhere.
import assert from 'node:assert';
import { createFakeDrive } from './harness/fake-drive.js';
import { createDriveAdapter } from '../packages/ui/cloud/drive-adapter.js';
import { createRouterAdapter, isRemoteId, DRIVE_PREFIX } from '../packages/ui/cloud/router-adapter.js';
import { createProjectStore, createMemoryAdapter, emptyDocument } from '../packages/ui/project-store.js';
import { parseProjectFile } from '../packages/ui/project-file.js';
import { createGoogleAccount } from '../packages/ui/cloud/google-account.js';
import { createAuthStore } from '../packages/ui/cloud/auth-state.js';

let t = 1000;
const doc = (marker, hosts = {}) => ({ ...emptyDocument(), geometry: { joints: [['j1', { x: marker, y: 0 }]], shapes: [], constraints: [] }, hosts });
const accountFor = (drive) => ({ authedFetch: (url, opts = {}) => drive.fetch(url, { ...opts, headers: { Authorization: 'Bearer ' + drive.token, ...(opts.headers || {}) } }) });
const mkDrive = (drive = createFakeDrive(), meta = createMemoryAdapter()) => ({ drive, meta, adapter: createDriveAdapter({ account: accountFor(drive), meta }) });
const mkStore = (adapter) => createProjectStore({ adapter, now: () => ++t, channel: null });

// 1. the store over the Drive adapter: the whole project/design model works on Drive
{
  const { drive, adapter } = mkDrive();
  const store = mkStore(adapter);
  const atelier = await store.createProject('Atelier');
  assert(atelier.id.startsWith('fakeid-'), 'ids come from files.generateIds (opaque Drive ids): ' + atelier.id);
  const roots = drive.byName('Sketch Studio');
  assert.strictEqual(roots.length, 1, 'ONE app root folder'); assert.strictEqual(roots[0].mimeType, 'application/vnd.google-apps.folder');
  const folder = drive.files.get(atelier.id);
  assert.deepStrictEqual(folder.parents, [roots[0].id], 'the project is a folder inside the app root');
  assert.strictEqual(folder.mimeType, 'application/vnd.google-apps.folder');

  const d1 = await store.newDesign('Shelf', { app: 'penplotter', projectId: atelier.id });
  const file = drive.files.get(d1.id);
  assert.strictEqual(file.name, 'Shelf.sketch.json', 'a design is a .sketch.json file');
  assert.deepStrictEqual(file.parents, [atelier.id]);
  assert.strictEqual(file.appProperties.skKind, 'design'); assert.strictEqual(file.appProperties.skApp, 'penplotter');
  const parsed = parseProjectFile(file.content);
  assert.strictEqual(parsed.name, 'Shelf'); assert.strictEqual(parsed.app, 'penplotter');
  assert.deepStrictEqual(parsed.document, emptyDocument(), 'the content IS the project file: it also opens with "Open from file"');

  // autosave (host merge per design, 458) and reading back
  await store.save(doc(1, { penplotter: { pens: 2 } }), { id: d1.id, app: 'penplotter' });
  await store.save(doc(2, { shaper: { cut: 'pocket' } }), { id: d1.id, app: 'shaper' });
  await store.save(doc(3), { id: d1.id, app: 'sketchstudio' });
  const back = await store.get(d1.id);
  assert.deepStrictEqual(Object.keys(back.document.hosts).sort(), ['penplotter', 'shaper'], 'both sidecars kept on Drive; a host-less save deleted none');
  assert.strictEqual(back.document.geometry.joints[0][1].x, 3);
  assert.strictEqual(back.projectId, atelier.id);

  // listing, ordering, rename, duplicate, move, trash
  const bits = await store.createProject('Bits');
  const d2 = await store.newDesign('Drill', { app: 'shaper', projectId: bits.id });
  assert.deepStrictEqual((await store.listRecent()).map((x) => x.name), ['Drill', 'Shelf'], 'recent across projects, newest first');
  assert.deepStrictEqual((await store.listRecent()).map((x) => x.projectName), ['Bits', 'Atelier']);
  await store.rename(d2.id, 'Drill 2');
  assert.strictEqual(drive.files.get(d2.id).name, 'Drill 2.sketch.json', 'rename renames the file');
  const dup = await store.duplicate(d2.id);
  assert.strictEqual(drive.files.get(dup.id).parents[0], bits.id);
  await store.moveDesign(dup.id, atelier.id);
  assert.deepStrictEqual(drive.files.get(dup.id).parents, [atelier.id], 'moveDesign = addParents/removeParents');
  await store.pinProject(atelier.id);
  assert.strictEqual((await store.listProjects())[0].id, atelier.id, 'pinned first (the pin lives in appProperties)');
  assert.strictEqual(drive.files.get(atelier.id).appProperties.skPinned, '1');
  await assert.rejects(() => store.removeProject(atelier.id), /still holds 2 designs/);
  await store.remove(dup.id);
  assert.strictEqual(drive.files.get(dup.id).trashed, true, 'remove TRASHES (Drive keeps it ~30 days), it never deletes');
  assert.strictEqual((await store.listRecent()).length, 2, 'a trashed design is no longer listed');
  // the root is found again by a fresh adapter on the same Drive (cached in meta / found by name): no second root
  const second = mkStore(createDriveAdapter({ account: accountFor(drive), meta: createMemoryAdapter() }));
  assert.strictEqual((await second.listProjects()).length, 2); assert.strictEqual(drive.byName('Sketch Studio').length, 1, 'still ONE root folder');
  // never a secret, always a bearer token
  assert(drive.requests.every((r) => r.headers.Authorization === 'Bearer GOOD' && !/client_secret|refresh_token/.test(String(r.body || '') + r.url)), 'no request carries a secret');
  assert(!drive.requests.some((r) => /userinfo|oauth2\/v2|openid/.test(r.url)), 'no userinfo / openid scope is ever used');
}

// 2. paging
{
  const drive = createFakeDrive({ pageSize: 2 });
  const { adapter } = mkDrive(drive);
  const store = mkStore(adapter);
  const p = await store.createProject('Many');
  for (let i = 0; i < 5; i++) await store.newDesign('D' + i, { projectId: p.id });
  assert.strictEqual((await store.listRecent()).length, 5, 'every page of the listing is read');
}

// 3. optimistic concurrency: another tab edits between our read and write -> re-read, recompute, both edits survive
{
  const { drive, adapter } = mkDrive();
  const store = mkStore(adapter);
  const p = await store.createProject('P');
  const d = await store.newDesign('Shared', { projectId: p.id });
  await store.save(doc(1, { shaper: { cut: 'a' } }), { id: d.id, app: 'shaper' });
  const seen = [];
  const out = await adapter.updateDesign(d.id, (cur) => {
    seen.push(Object.keys(cur.document.hosts).sort().join(','));
    if (seen.length === 1) drive.externalEdit(d.id, (text) => { const e = JSON.parse(text); e.document.hosts.penplotter = { pens: 9 }; return JSON.stringify(e, null, 2) + '\n'; });
    return { ...cur, updatedAt: ++t, document: { ...cur.document, hosts: { ...cur.document.hosts, mine: { v: 1 } } } };
  });
  assert.deepStrictEqual(seen, ['shaper', 'penplotter,shaper'], 'the second attempt re-read the other tab\'s edit');
  assert.deepStrictEqual(Object.keys(out.document.hosts).sort(), ['mine', 'penplotter', 'shaper']);
  assert.deepStrictEqual(Object.keys((await store.get(d.id)).document.hosts).sort(), ['mine', 'penplotter', 'shaper'], 'nothing was overwritten');
  // a design that keeps changing under us: a readable error, and our value was NOT written over theirs
  let n = 0;
  await assert.rejects(() => adapter.updateDesign(d.id, (cur) => { n++; drive.externalEdit(d.id, (text) => text); return { ...cur, document: { ...cur.document, hosts: { overwrite: 1 } } }; }), /being changed somewhere else/);
  assert.strictEqual(n, 4, 'bounded retries');
  assert(!('overwrite' in (await store.get(d.id)).document.hosts), 'the losing write never landed');
}

// 4. a write that fails (Drive down) rejects: the buffer shows "error", nothing half-written is claimed
{
  const { drive, adapter } = mkDrive();
  const store = mkStore(adapter);
  const p = await store.createProject('P'); const d = await store.newDesign('D', { projectId: p.id });
  drive.failWrites = 1;
  await assert.rejects(() => store.save(doc(5), { id: d.id }), /Drive 500/);
  await store.save(doc(6), { id: d.id });
  assert.strictEqual((await store.get(d.id)).document.geometry.joints[0][1].x, 6);
}

// 5. onChange(): refresh() polls the remote signature and fires when another device changed something
{
  const { drive, adapter } = mkDrive();
  const store = mkStore(adapter);
  const p = await store.createProject('P'); await store.newDesign('D', { projectId: p.id });
  let pings = 0; adapter.onChange(() => pings++);
  assert.strictEqual(await adapter.refresh(), false, 'the first poll only takes the baseline');
  assert.strictEqual(await adapter.refresh(), false); assert.strictEqual(pings, 0, 'nothing changed');
  await store.newDesign('From another device', { projectId: p.id });
  assert.strictEqual(await adapter.refresh(), true); assert.strictEqual(pings, 1, 'a remote change fires onChange');
}

// ===================== the ROUTER: local stays local, Drive only by explicit choice =====================
const mkRouter = () => {
  const drive = createFakeDrive();
  const local = createMemoryAdapter();
  let built = 0;
  const router = createRouterAdapter({ local, getRemote: () => { built++; return createDriveAdapter({ account: accountFor(drive), meta: local }); } });
  return { drive, local, router, store: mkStore(router), built: () => built };
};

// 6. local-only use never touches Drive (and never even builds the Drive adapter)
{
  const { drive, store, built } = mkRouter();
  const p = await store.createProject('Local'); const d = await store.newDesign('Mine', { projectId: p.id, app: 'shaper' });
  await store.save(doc(1), { id: d.id }); await store.listProjects(); await store.listRecent(); await store.rename(d.id, 'Mine 2'); await store.remove(d.id);
  assert.strictEqual(drive.calls.length, 0, 'zero Drive calls for local work');
  assert.strictEqual(built(), 0, 'the Drive adapter is never constructed');
}

// 7. SIGNING IN CHANGES NO PROJECT: the account signs in; nothing moves, lists or syncs
{
  const { drive, store, local } = mkRouter();
  const p = await store.createProject('Local'); await store.newDesign('Mine', { projectId: p.id });
  const before = JSON.stringify([await store.listProjects(), await store.listRecent(), await local.getMeta('driveEnabled')]);
  const storage = new Map();
  const fetchLog = [];
  const account = createGoogleAccount({
    fetchImpl: async (url, init) => { fetchLog.push(url); return new Response('', { status: 404 }); },
    authStore: createAuthStore({ getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: (k) => storage.delete(k) }),
    gis: { load: async () => {}, requestToken: async () => ({ access_token: 'GOOD', expires_in: 3599 }), revoke() {} },
    win: null, eligibleForServer: () => false, now: () => 5000, setTimer: () => 0, clearTimer: () => {},
  });
  await account.signIn();
  assert.strictEqual(account.state().signedIn, true, 'the account is signed in');
  const after = JSON.stringify([await store.listProjects(), await store.listRecent(), await local.getMeta('driveEnabled')]);
  assert.strictEqual(after, before, 'sign-in changed no project and did not turn Drive on');
  assert.strictEqual(drive.calls.length, 0, 'sign-in made no Drive file call');
  assert.strictEqual(await store.cloud.isEnabled(), false);
}

// 8. the explicit move: copy, verify, delete local LAST; ids prefixed; current pointer follows; autosave goes to Drive
{
  const { drive, store, local } = mkRouter();
  const keep = await store.createProject('Stays local'); await store.newDesign('Local design', { projectId: keep.id });
  const proj = await store.createProject('To Drive');
  const a = await store.newDesign('A', { projectId: proj.id, app: 'penplotter' });
  await store.save(doc(1, { penplotter: { pens: 3 } }), { id: a.id, app: 'penplotter' });
  const b = await store.newDesign('B', { projectId: proj.id, app: 'shaper' });
  await store.open(a.id);
  const res = await store.cloud.moveProjectToDrive(proj.id);
  assert(isRemoteId(res.projectId) && res.projectId.startsWith(DRIVE_PREFIX), 'the project now lives on Drive');
  assert.deepStrictEqual(Object.keys(res.designIds).sort(), [a.id, b.id].sort());
  assert(Object.values(res.designIds).every(isRemoteId), 'moved designs have Drive ids');
  assert.strictEqual(await local.getProject(proj.id), null, 'the local copy is gone (after the verified remote copy)');
  assert.strictEqual((await local.listDesigns()).filter((d) => d.projectId === proj.id).length, 0);
  assert.strictEqual((await store.current()).id, res.designIds[a.id], 'the current pointer follows the moved design');
  assert.strictEqual(await store.cloud.isEnabled(), true, 'moving turned Drive on (the explicit choice)');
  assert.strictEqual(drive.byName('Sketch Studio').length, 1); assert.strictEqual(drive.byName('To Drive').length, 1);
  assert.strictEqual(drive.byName('A.sketch.json').length, 1);
  const projects = await store.listProjects();
  assert.deepStrictEqual(projects.map((p) => [p.name, p.location || 'local']).sort(), [['My Designs', 'local']].filter(() => false).concat([['Stays local', 'local'], ['To Drive', 'drive']]).sort(), 'one local, one Drive project');
  const recent = await store.listRecent();
  assert(recent.some((r) => r.id === res.designIds[a.id] && r.projectName === 'To Drive'), 'recent shows the Drive design with its project');
  // reading, autosave into a Drive design (host merge), the local project untouched
  const got = await store.get(res.designIds[a.id]);
  assert.deepStrictEqual(got.document.hosts.penplotter, { pens: 3 }, 'the document and its sidecar moved intact');
  await store.save(doc(7, { shaper: { cut: 'inside' } }), { id: res.designIds[a.id], app: 'shaper' });
  const after = await store.get(res.designIds[a.id]);
  assert.deepStrictEqual(Object.keys(after.document.hosts).sort(), ['penplotter', 'shaper'], 'autosave to Drive keeps every sidecar');
  assert.strictEqual(parseProjectFile(drive.files.get(res.designIds[a.id].slice(DRIVE_PREFIX.length)).content).document.geometry.joints[0][1].x, 7, 'the Drive file holds the autosave');
  assert.strictEqual((await store.listDesigns(keep.id)).length, 1, 'the other local project is untouched');
  // one design cannot cross between device and Drive on its own
  const localDesign = (await store.listDesigns(keep.id))[0];
  await assert.rejects(() => store.moveDesign(localDesign.id, res.projectId), /move the whole project/i);
  await assert.rejects(() => store.cloud.moveProjectToDrive(res.projectId), /already on Drive/);
  // and back: copy down, verify, trash the Drive copy
  const back = await store.cloud.makeProjectLocal(res.projectId);
  assert(!isRemoteId(back.projectId));
  assert.strictEqual((await store.current()).id, back.designIds[res.designIds[a.id]], 'the pointer follows back too');
  assert.deepStrictEqual(Object.keys((await store.get(back.designIds[res.designIds[a.id]])).document.hosts).sort(), ['penplotter', 'shaper']);
  assert.strictEqual(drive.byName('To Drive')[0].trashed, true, 'the Drive copy is TRASHED, not deleted');
  assert.strictEqual((await store.listProjects()).filter((p) => p.location === 'drive').length, 0);
}

// 9. a failing copy leaves the original untouched; Drive off hides Drive projects without a call; offline Drive never hides local work
{
  const { drive, store, local } = mkRouter();
  const proj = await store.createProject('P'); const d = await store.newDesign('D', { projectId: proj.id }); await store.save(doc(4), { id: d.id });
  drive.failWrites = 1000;
  await assert.rejects(() => store.cloud.moveProjectToDrive(proj.id), /Drive 500/);
  assert.notStrictEqual(await local.getProject(proj.id), null, 'a failed move keeps the local project');
  assert.strictEqual((await store.get(d.id)).document.geometry.joints[0][1].x, 4, 'with its content');
  drive.failWrites = 0;
  // now a successful move, then disable: Drive projects vanish from the lists with NO remote call, nothing is deleted on Drive
  await store.cloud.moveProjectToDrive(proj.id);
  await store.cloud.disable();
  const calls = drive.calls.length;
  assert.deepStrictEqual((await store.listProjects()).filter((p) => p.location === 'drive'), [], 'Drive off: its projects are hidden');
  assert.strictEqual(drive.calls.length, calls, 'and hiding them costs no Drive call');
  assert.strictEqual(drive.byName('P').length, 1, 'nothing was removed from Drive');
  await store.cloud.enable();
  assert.strictEqual((await store.listProjects()).filter((p) => p.location === 'drive').length, 1);
  // offline: the remote listing fails, local projects are still listed, the error is available
  await store.createProject('Still here');
  drive.offline = true;
  const list = await store.listProjects();
  assert(list.some((p) => p.name === 'Still here'), 'local work is listed even when Drive is unreachable');
  assert(store.cloud.lastError(), 'the remote error is kept for the UI');
}
console.log('google-drive-adapter: ok');
