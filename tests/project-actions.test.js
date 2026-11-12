// tests/project-actions.test.js — TASK 547: the declared design / project actions (packages/ui/project-actions.js) and the thumbnail generator
// (packages/ui/design-thumbnail.js). Pure data and fakes: no browser.
import assert from 'node:assert';
import { createProjectActions } from '../packages/ui/project-actions.js';
import { designThumbnailSvg } from '../packages/ui/design-thumbnail.js';

const calls = [];
const rec = (n) => async (...a) => { calls.push([n, ...a]); return { name: 'X', id: 'new' }; };
const store = {
  rename: rec('rename'), duplicate: rec('duplicate'), moveDesign: rec('moveDesign'), remove: rec('remove'),
  renameProject: rec('renameProject'), pinProject: rec('pinProject'), removeProject: rec('removeProject'), createProject: rec('createProject'),
  cloud: { saveToDrive: async (id) => { calls.push(['saveToDrive', id]); return { fileId: 'F' }; }, makeProjectLocal: rec('makeProjectLocal'), moveProjectToDrive: rec('moveProjectToDrive') },
};
const notes = [];
const buffer = { flush: async () => calls.push(['flush']), designId: () => 'cur', openDesign: async (id) => { calls.push(['openDesign', id]); return { restored: true }; }, saveFile: async (seam, id) => { calls.push(['saveFile', seam, id]); return { name: 'f' }; }, newDesign: rec('newDesign'), openFile: rec('openFile'), saveAs: rec('saveAs') };
const mk = (signedIn) => createProjectActions({ store, getBuffer: () => buffer, account: { state: () => ({ signedIn }) }, notify: (...a) => notes.push(a) });

const d = { id: 'd1', name: 'Door', projectId: 'p1' };
const projects = [{ id: 'p1', name: 'A' }, { id: 'p2', name: 'B' }];

// the design's actions, in order; Google Drive only when signed in; Move only when there is another project
assert.deepStrictEqual(mk(false).designItems(d, { projects }).map((a) => a.id), ['open', 'rename', 'duplicate', 'move', 'save-file', 'delete']);
assert.deepStrictEqual(mk(true).designItems(d, { projects }).map((a) => a.id), ['open', 'rename', 'duplicate', 'move', 'save-file', 'save-drive', 'delete']);
assert.ok(!mk(false).designItems(d, { projects: [projects[0]] }).some((a) => a.id === 'move'), 'no Move with one project');
const items = Object.fromEntries(mk(true).designItems(d, { projects }).map((a) => [a.id, a]));
assert.strictEqual(items.delete.ask.kind, 'confirm'); assert.strictEqual(items.rename.ask.kind, 'prompt'); assert.deepStrictEqual(items.move.ask.options, [{ id: 'p2', label: 'B' }]);
assert.strictEqual(items.open.closes, true);

// each action calls the store / buffer with THAT design
await items.rename.run('New'); await items.move.run('p2'); await items.delete.run(); await items['save-file'].run(); await items.duplicate.run(); await items['save-drive'].run(); await items.open.run();
assert.deepStrictEqual(calls.filter((c) => c[0] !== 'flush'), [
  ['rename', 'd1', 'New'], ['moveDesign', 'd1', 'p2'], ['remove', 'd1'], ['saveFile', undefined, 'd1'], ['duplicate', 'd1'], ['saveToDrive', 'd1'], ['openDesign', 'd1'],
]);
assert.ok(notes.some((n) => /Duplicated as/.test(n[0])) && notes.some((n) => n[0] === 'Saved to Google Drive' && n[2].href.includes('F')));

// project actions: Make local / Use Google Drive only signed in, by where the project lives
const pid = (signedIn, p) => mk(signedIn).projectItems(p).map((a) => a.id);
assert.deepStrictEqual(pid(false, { id: 'p1', name: 'A' }), ['rename', 'pin', 'delete']);
assert.deepStrictEqual(pid(true, { id: 'p1', name: 'A' }), ['use-drive', 'rename', 'pin', 'delete']);
assert.deepStrictEqual(pid(true, { id: 'drive:p', name: 'G', location: 'drive' }), ['make-local', 'rename', 'pin', 'delete']);
assert.strictEqual(mk(false).projectItems({ id: 'p1', name: 'A', pinned: true }).find((a) => a.id === 'pin').label, 'Unpin');
// the manager's toolbar, and the main menu's own actions go through the same functions
assert.deepStrictEqual(mk(false).toolbarItems().map((a) => a.id), ['new-project', 'new-design', 'open-file']);
calls.length = 0; await mk(false).duplicateCurrent(); assert.deepStrictEqual(calls.filter((c) => c[0] === 'duplicate'), [['duplicate', 'cur']], 'the menu Duplicate duplicates the current design through the same function');
// a missing buffer is a readable refusal, nothing else happens
await assert.rejects(() => createProjectActions({ store, getBuffer: () => null }).openDesign('x'), /still starting/);

// thumbnails
const doc = (pts) => ({ version: 2, geometry: { joints: pts.map((p, i) => ['j' + i, { x: p[0], y: p[1] }]), shapes: pts.map((_, i) => ({ id: 's' + i, type: 'line', joints: ['j' + i, 'j' + ((i + 1) % pts.length)] })), constraints: [] }, hosts: {} });
const svg = designThumbnailSvg(doc([[0, 0], [200, 0], [200, 100]]));
assert.ok(svg.startsWith('<svg') && svg.includes('viewBox="0 0 100 100"') && svg.includes('stroke="currentColor"'));
const nums = [...svg.match(/d="([^"]+)"/)[1].matchAll(/-?\d+(\.\d+)?/g)].map((m) => Number(m[0]));
assert.ok(nums.every((n) => n >= 0 && n <= 100), 'every point is inside the tile: ' + nums);
assert.ok(Math.max(...nums) >= 90, 'the drawing is scaled up to fill the tile');
assert.strictEqual(designThumbnailSvg({ version: 2, geometry: { joints: [], shapes: [], constraints: [] }, hosts: {} }), null, 'an empty design has no thumbnail');
assert.strictEqual(designThumbnailSvg(null), null);
const circ = designThumbnailSvg({ version: 2, geometry: { joints: [['c', { x: 5, y: 5 }]], shapes: [{ id: 'k', type: 'circle', joints: ['c'], radius: 10 }], constraints: [] }, hosts: {} });
assert.ok(circ && circ.includes('M'), 'a circle is drawn');
console.log('project-actions: ok');
