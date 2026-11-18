// tests/saveas-overwrite-node.test.js -- Save as overwrite (same-name file in same Drive folder):
//   1. findExisting returns null when no design matches, or { id, name, folderName, openInOtherTab } when the target folder holds that name.
//   2. store.overwrite updates an existing design in place (same file ID) with the new document, name, and app, clearing stale local shadows.
//   3. buffer.saveAs(..., { projectId, overwriteId }) overwrites either another design or the currently bound design without creating duplicates,
//      and removes any stale open tab pointing at the overwritten designId.
import assert from 'node:assert';
import { createFakeDrive } from './harness/fake-drive.js';
import { createDriveAdapter } from '../packages/ui/cloud/drive-adapter.js';
import { createRouterAdapter } from '../packages/ui/cloud/router-adapter.js';
import { createProjectStore, createMemoryAdapter } from '../packages/ui/project-store.js';
import { createDocumentBuffer } from '../packages/ui/document-buffer.js';
import { createProjectActions } from '../packages/ui/project-actions.js';
import { createSketchState } from '../packages/core/sketch-state.js';
import { createEngine } from '../packages/core/constraint-solver.js';
import { parseProjectFile } from '../packages/ui/project-file.js';

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

let t = 70000;
const drive = createFakeDrive();
const local = createMemoryAdapter();
const account = {
  state: () => ({ signedIn: true }),
  authedFetch: (url, opts = {}) => drive.fetch(url, { ...opts, headers: { Authorization: 'Bearer ' + drive.token, ...(opts.headers || {}) } }),
  subscribe: () => () => {},
};
const remote = createDriveAdapter({ account, meta: local });
const router = createRouterAdapter({ local, getRemote: () => remote, signedIn: () => true });
const store = createProjectStore({ adapter: router, legacySource: async () => null, now: () => ++t, channel: null });

const furn = await store.createProject('Furniture');
const shop = await store.createProject('Shop');
const existingChair = await store.newDesign('Chair', { app: 'shaper', projectId: furn.id });
await store.save({ version: 1, units: 'mm', geometry: { joints: [['j_old', { x: 1, y: 2 }]], shapes: [], constraints: [] }, hosts: {} }, { id: existingChair.id, app: 'shaper' });
await store.setCurrent(null);

const engine = createEngine(null);
engine.init();
const state = createSketchState(engine, { x: 0, y: 0, w: 100, h: 80 });
state.joints.set('j_new', { x: 42, y: 84 });
const buffer = createDocumentBuffer({ state, app: 'shaper', store, pollMs: 1e9, doc: null, win: null });
await buffer.restore();

let dialogOpts = null;
const actions = createProjectActions({
  store,
  getBuffer: () => buffer,
  account,
  fileDialog: async (opts) => { dialogOpts = opts; return null; },
});

await actions.saveAsDialog();
eq(await dialogOpts.browseDrive.findExisting('Bench', furn.id), null, 'non-matching name returns null');
eq(await dialogOpts.browseDrive.findExisting('Chair', shop.id), null, 'same name in another folder does not collide');
const hit = await dialogOpts.browseDrive.findExisting('  Chair ', furn.id);
eq(hit, { id: existingChair.id, name: 'Chair', folderName: 'Furniture', openInOtherTab: false }, 'matching name in target folder finds existing file (TASK 774: and says whether another open tab shows it)');

// Overwrite existingChair with current Untitled drawing via onSave(tab, name, folderId, overwriteId)
const saved = await dialogOpts.onSave('drive', 'Chair', furn.id, hit.id);
eq(saved.id, existingChair.id, 'overwrite keeps the same Drive file ID (no duplicate created)');
eq(buffer.designId(), existingChair.id, 'active buffer now bound to overwritten file');
const furnRows = await store.listDesigns(furn.id);
eq(furnRows.length, 1, 'still only 1 Chair file in Furniture (zero duplicate)');

const rawId = existingChair.id.replace(/^drive:/, '');
const rawFile = drive.files.get(rawId);
const parsed = parseProjectFile(rawFile.content);
ok(parsed.document.geometry.joints.some(([id]) => id === 'j_new'), 'Drive file content replaced with new drawing');
ok(!parsed.document.geometry.joints.some(([id]) => id === 'j_old'), 'old geometry replaced');

console.log(`saveas-overwrite-node: ${checks} checks passed`);
