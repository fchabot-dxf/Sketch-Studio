// tests/drive-move-autosave.test.js — TASK 639: moving a Drive design to another project waits for its in-flight autosave write (the same
// per-design lock rename uses). FAKE Drive only (no Google call anywhere).
import assert from 'node:assert';
import { createFakeDrive } from './harness/fake-drive.js';
import { createDriveAdapter } from '../packages/ui/cloud/drive-adapter.js';
import { createRouterAdapter } from '../packages/ui/cloud/router-adapter.js';
import { createProjectStore, createMemoryAdapter } from '../packages/ui/project-store.js';

const drive = createFakeDrive();
const waiting = []; // content writes held inside "Drive", in arrival order, while holding is on
let holding = false;
const account = {
  authedFetch: async (url, opts = {}) => {
    if (holding && /upload/.test(String(url)) && /PATCH|POST/.test(opts.method || 'GET')) await new Promise((r) => waiting.push(r));
    return drive.fetch(url, { ...opts, headers: { Authorization: 'Bearer ' + drive.token, ...(opts.headers || {}) } });
  },
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));const local = createMemoryAdapter();
const remote = createDriveAdapter({ account, meta: local });
const router = createRouterAdapter({ local, getRemote: () => remote, signedIn: () => true });
const store = createProjectStore({ adapter: router, channel: null });
const fileOf = (id) => drive.files.get(id.replace(/^drive:/, ''));
const sketches = () => [...drive.files.values()].filter((f) => !f.trashed && f.name.endsWith('.sketch.json'));

const from = await store.createProject('Garage');
const to = await store.createProject('Atelier');
const d = await store.newDesign('Plate', { app: 'sketchstudio', projectId: from.id });
await store.flushDrive(d.id);

const doc = (await store.get(d.id)).document;
const latest = { ...doc, geometry: { joints: [['j1', { x: 7, y: 7 }]], shapes: [], constraints: [] } };
holding = true;
await store.save(latest, { id: d.id });
const flushing = store.flushDrive(d.id); // the autosave write is now in flight, held inside Drive
while (!waiting.length) await sleep(5);
const moving = store.moveDesign(d.id, to.id);
await sleep(100); // unfixed: the move's own stale write is held behind it; fixed: the move waits for the lock
waiting.shift()(); // the autosave lands first
await sleep(100);
holding = false;
while (waiting.length) waiting.shift()();
await Promise.all([flushing, moving]);
await store.flushDrive(d.id);
const files = sketches();
assert.strictEqual(files.length, 1, 'no second copy of the design on Drive');
assert.deepStrictEqual(fileOf(d.id).parents, [to.id.replace(/^drive:/, '')], 'the design is in the new project only');
assert.strictEqual(JSON.parse(files[0].content).document.geometry.joints[0][1].x, 7, 'the moved design holds the latest drawing');
const moved = await store.get(d.id);
assert.strictEqual(moved.projectId, to.id, 'store reports the new project');
assert.strictEqual(moved.document.geometry.joints[0][1].x, 7, 'store copy holds the latest drawing');
console.log('drive-move-autosave: ok');
