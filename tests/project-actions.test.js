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
  cloud: { moveProjectToDrive: rec('moveProjectToDrive') },
};
const notes = [];
const buffer = { flush: async () => calls.push(['flush']), ready: Promise.resolve(), isStored: () => false, designName: () => 'Untitled', designId: () => 'cur', openDesign: async (id) => { calls.push(['openDesign', id]); return { restored: true }; }, saveFile: async (seam, id) => { calls.push(['saveFile', seam, id]); return { name: 'f' }; }, newDesign: rec('newDesign'), openFile: rec('openFile'), saveAs: rec('saveAs'), needsSavePrompt: () => null };
const mk = (signedIn, extraAcc = {}) => createProjectActions({ store, getBuffer: () => buffer, account: { state: () => ({ signedIn }), signIn: async () => { calls.push(['signIn']); }, ...extraAcc }, notify: (...a) => notes.push(a) });

const d = { id: 'd1', name: 'Door', projectId: 'p1' };
const projects = [{ id: 'p1', name: 'A' }, { id: 'p2', name: 'B' }];

// the design's actions, in order (Drive-only: no copy-snapshot save-drive entry); Move only when there is another project
assert.deepStrictEqual(mk(false).designItems(d, { projects }).map((a) => a.id), ['open', 'rename', 'duplicate', 'move', 'save-file', 'delete']);
assert.deepStrictEqual(mk(true).designItems(d, { projects }).map((a) => a.id), ['open', 'rename', 'duplicate', 'move', 'save-file', 'delete']);
assert.ok(!mk(false).designItems(d, { projects: [projects[0]] }).some((a) => a.id === 'move'), 'no Move with one project');
const items = Object.fromEntries(mk(true).designItems(d, { projects }).map((a) => [a.id, a]));
assert.strictEqual(items.delete.ask.kind, 'confirm'); assert.strictEqual(items.rename.ask.kind, 'prompt'); assert.deepStrictEqual(items.move.ask.options, [{ id: 'p2', label: 'B' }]);
assert.strictEqual(items.open.closes, true);

// each action calls the store / buffer with THAT design
await items.rename.run('New'); await items.move.run('p2'); await items.delete.run(); await items['save-file'].run(); await items.duplicate.run(); await items.open.run();
assert.deepStrictEqual(calls.filter((c) => c[0] !== 'flush'), [
  ['rename', 'd1', 'New'], ['moveDesign', 'd1', 'p2'], ['remove', 'd1'], ['saveFile', undefined, 'd1'], ['duplicate', 'd1'], ['openDesign', 'd1'],
]);
assert.ok(notes.some((n) => /Duplicated as/.test(n[0])));

// project actions: Move to Google Drive on legacy local projects (no Make local on Drive projects)
const pid = (signedIn, p) => mk(signedIn).projectItems(p).map((a) => a.id);
assert.deepStrictEqual(pid(false, { id: 'p1', name: 'A' }), ['rename', 'pin', 'delete']);
assert.deepStrictEqual(pid(true, { id: 'p1', name: 'A' }), ['use-drive', 'rename', 'pin', 'delete']);
assert.deepStrictEqual(pid(true, { id: 'drive:p', name: 'G', location: 'drive' }), ['rename', 'pin', 'delete']);
assert.strictEqual(mk(false).projectItems({ id: 'p1', name: 'A', pinned: true }).find((a) => a.id === 'pin').label, 'Unpin');
// signed out: Save as… / Duplicate prompt Google sign-in first, and carry on once signed in (or cancel cleanly)
calls.length = 0;
{
  let isSigned = false;
  const pa = createProjectActions({
    store, getBuffer: () => buffer,
    account: { state: () => ({ signedIn: isSigned }), signIn: async () => { calls.push(['signIn']); isSigned = true; } },
    ask: async (spec) => {
      calls.push(['ask', spec.kind]);
      if (spec.kind === 'prompt') return 'Named';
      const opt = spec.options.find((o) => o.id === 'signin');
      if (opt && opt.onClick) opt.onClick();
      return opt ? opt.id : null;
    },
    notify: (...a) => notes.push(a),
  });
  await pa.saveAsPrompt();
  assert.deepStrictEqual(calls.filter((c) => c[0] !== 'flush'), [['ask', 'choose'], ['signIn'], ['ask', 'prompt'], ['saveAs', 'Named']]);
  calls.length = 0;
  await mk(true).duplicateCurrent();
  assert.deepStrictEqual(calls.filter((c) => c[0] === 'duplicate'), [['duplicate', 'cur']], 'the menu Duplicate duplicates the current design through the same function');
  calls.length = 0;
  const cancelled = createProjectActions({
    store, getBuffer: () => buffer,
    account: { state: () => ({ signedIn: false }), signIn: async () => { throw new Error('sign-in cancelled'); } },
    ask: async () => null, notify: (...a) => notes.push(a),
  });
  await cancelled.duplicateCurrent();
  assert.strictEqual(calls.some((c) => c[0] === 'duplicate'), false, 'declined sign-in cancels cleanly');
}
// a missing buffer is a readable refusal, nothing else happens
await assert.rejects(() => createProjectActions({ store, getBuffer: () => null }).openDesign('x'), /still starting/);

// TASK 558: THE unsaved-design question before an action replaces an unsaved Untitled with content: Save… / Don't save / Cancel
{
  for (const [answers, expect] of [
    [['save', 'Door 2'], { go: true, log: ['ask:choose', 'ask:prompt:Untitled', 'saveAs:Door 2'] }],
    [['save', null], { go: false, log: ['ask:choose', 'ask:prompt:Untitled'] }],       // Save…, then Cancel in the name prompt: nothing
    [['discard'], { go: true, log: ['ask:choose', 'discard'] }],
    [[null], { go: false, log: ['ask:choose'] }],                                       // Cancel
  ]) {
    const log = []; const a = [...answers];
    const ub = { needsSavePrompt: () => 'unsaved', designName: () => 'Untitled', discardUnsaved: () => log.push('discard'), saveAs: async (nm) => { log.push('saveAs:' + nm); },
      openDesign: async (id) => { log.push('open:' + id); return { restored: true }; }, newDesign: async () => { log.push('new'); return {}; }, openFile: async () => { log.push('file'); return {}; } };
    const pa = createProjectActions({ store, getBuffer: () => ub, ask: async (spec) => { log.push('ask:' + spec.kind + (spec.kind === 'prompt' ? ':' + spec.value : '')); if (spec.kind === 'choose') assert.deepStrictEqual(spec.options.map((o) => o.label), ['Save…', "Don't save"]); return a.shift(); } });
    const out = await pa.openDesign('d9');
    assert.deepStrictEqual(log, expect.go ? [...expect.log, 'open:d9'] : expect.log, 'open: ' + JSON.stringify(answers));
    assert.strictEqual(out === null, !expect.go, 'a cancelled open resolves null (the Projects modal stays open)');
    log.length = 0; a.push(...answers); await pa.newDesign(); assert.strictEqual(log.includes('new'), expect.go, 'new: ' + JSON.stringify(answers));
    log.length = 0; a.push(...answers); await pa.openFile(); assert.strictEqual(log.includes('file'), expect.go, 'open file: ' + JSON.stringify(answers));
    log.length = 0; a.push(...answers); assert.strictEqual(await pa.settleUnsaved(), expect.go, 'GO TO: ' + JSON.stringify(answers));
  }
  // nothing unsaved: no question at all
  const log = [];
  const pa = createProjectActions({ store, getBuffer: () => ({ ...buffer, needsSavePrompt: () => null }), ask: async () => { log.push('asked'); return null; } });
  assert.strictEqual(await pa.settleUnsaved(), true); assert.deepStrictEqual(log, [], 'a saved or empty design is never asked about');
}

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
