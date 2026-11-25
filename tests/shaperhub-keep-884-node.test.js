// tests/shaperhub-keep-884-node.test.js — TASK 884 (owner turns 3591-3597, 3607-3608): "Keep ShaperHub up to date", in Node (no browser). After a file was sent once,
// the Sync dialog's switch makes every Generate REPLACE that same file on ShaperHub. FAKE Shaper API only (tests/shaperhub-fake-api.js; every other request blocked).
//   1. the setting: declared ONCE (#core/settings-manager.js DEFAULT_SETTINGS), off by default, per device (not a synced key);
//   2. a target = the file + folder of the LAST successful send, from the server's own answers (handleShaperUpload): Send ('sent'), Replace it ('replaced'),
//      Keep both (the NEW name the server answered); an 'exists' question or an error makes none;
//   3. the file holds the TICKED operations (task 798): its NAME says which when not all (export-payload.js exportFileName: all / one / two ticked), and the
//      targets are kept per ticked SET (export-payload.js tickedSetKey);
//   4. the targets follow the design: the website's document (shaper-doc.js) and the Fusion project (fusion-bridge.js) round trip them; a design without one has
//      none, and writes the same bytes as before 884;
//   5. what a Generate does: switch off -> nothing; no target for the ticked set -> nothing (the full file is never replaced by a partial one); no sign-in ->
//      nothing (the switch shows disabled with its hint); else a replace;
//   6. queue of ONE per file: a Generate while a replace runs waits; more Generates keep only the LATEST svg; never two replaces at once;
//   7. the source: ONE request path (one fetch of /api/shaper-upload), Generate the only caller, the switch only in Shaper's page.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFakeShaperApi, FAKE_LOGIN } from './shaperhub-fake-api.js';
import { handleShaperUpload } from '../packages/core/shaper-cloud.js';
import SettingsManager, { isSyncedSetting } from '../packages/core/settings-manager.js';
import { KEEP_HUB_KEY, getHubTarget, setHubTarget, getHubTargets, setHubTargets, targetOfSend, autoSendDecision, keepSwitchView, createReplaceQueue, folderPlace } from '../apps/shaper/src/shaperhub-target.js';
import { exportFileName, tickedNamePart, tickedSetKey } from '../apps/shaper/src/export-payload.js';
import { captureShaperDoc, applyShaperDoc } from '../apps/shaper/src/shaper-doc.js';
import { captureFusionProject, applyFusionProject } from '../apps/shaper/src/fusion-bridge.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0 L10 0"/></svg>';

// ── 1. the setting ──
eq(KEEP_HUB_KEY, 'SHAPER_HUB_KEEP_UP_TO_DATE', 'the key');
eq(SettingsManager.getDefault(KEEP_HUB_KEY), false, 'off by default');
eq(SettingsManager.get(KEEP_HUB_KEY), false, 'read as off on a fresh device');
eq(isSyncedSetting(KEEP_HUB_KEY), false, 'per device: not a setting that follows the user to his other devices');
eq((read('packages/core/settings-manager.js').match(/SHAPER_HUB_KEEP_UP_TO_DATE/g) || []).length, 1, 'declared once in the settings manager');
eq(read('apps/shaper/src/shaperhub-target.js').match(/'SHAPER_HUB_KEEP_UP_TO_DATE'/g).length, 1, 'named once by Shaper (shaperhub-target.js KEEP_HUB_KEY)');

// ── 2. a target from the server's answers ──
const realFetch = globalThis.fetch;
const api = createFakeShaperApi({ files: ['Furniture/bromont.svg'], folders: ['Furniture'] });
globalThis.fetch = api.fetch;
const upload = async (extra) => (await handleShaperUpload(JSON.stringify({ ...FAKE_LOGIN, svg: SVG, ...extra }))).body;
try {
  const sent = await upload({ filename: 'plate.svg', mode: 'new', remotePath: '/Furniture/' });
  eq(sent.status, 'sent', 'the fake: a new name is sent');
  eq(targetOfSend(sent, '/Furniture/'), { filename: 'plate.svg', remotePath: '/Furniture/' }, 'Send: the file and the folder it went to');
  const exists = await upload({ filename: 'bromont.svg', mode: 'new', remotePath: '/Furniture/' });
  eq(exists.status, 'exists', 'the fake: an existing name is asked about');
  eq(targetOfSend(exists, '/Furniture/'), null, 'the "already in My Files" question: no target (nothing was sent)');
  const replaced = await upload({ filename: 'bromont.svg', mode: 'replace', remotePath: '/Furniture/' });
  eq(replaced.status, 'replaced', 'the fake: Replace it');
  eq(targetOfSend(replaced, '/Furniture/'), { filename: 'bromont.svg', remotePath: '/Furniture/' }, 'Replace it: that file');
  const both = await upload({ filename: 'bromont.svg', mode: 'keep-both', remotePath: '/Furniture/' });
  eq([both.status, both.filename, both.requested], ['sent', 'bromont (2).svg', 'bromont.svg'], 'the fake: Keep both sends under the next free name');
  eq(targetOfSend(both, '/Furniture/'), { filename: 'bromont (2).svg', remotePath: '/Furniture/' }, 'Keep both: the NEW name the server answered');
  const refused = (await handleShaperUpload(JSON.stringify({ email: FAKE_LOGIN.email, password: 'wrong', svg: SVG, filename: 'x.svg', mode: 'new' }))).body;
  ok(refused.error && refused.kind === 'login', 'the fake: a wrong password is refused');
  eq(targetOfSend(refused, '/'), null, 'an error: no target');
  const root = await upload({ filename: 'root.svg', mode: 'new' });
  eq(targetOfSend(root, undefined), { filename: 'root.svg', remotePath: '/' }, 'My Files itself: the folder "/"');
  eq(api.blocked, [], 'no request left the fake');
} finally { globalThis.fetch = realFetch; }

// ── 3. the ticked set: the file's name and the set's key (owner turns 3607-3608) ──
const op = (id, type, on = true) => ({ id, type, on, settings: {}, geometry: [] });
const OPS = [op('op-1', 'exterior'), op('op-2', 'exterior'), op('op-3', 'pocket')];
const tick = (ops, offIds) => ops.map((o) => ({ ...o, on: !offIds.includes(o.id) }));
eq(exportFileName('bromont', OPS), 'bromont.svg', 'name: everything ticked = the design\'s name, as before');
eq(exportFileName('bromont', tick(OPS, ['op-2', 'op-3'])), 'bromont - Outside 1.svg', 'name: one ticked = the design name - its type label and number');
eq(tickedNamePart(tick(OPS, ['op-3'])), 'Outside 1, Outside 2', 'name: two ticked, joined by ", " in list order');
eq(exportFileName('bromont', tick(OPS, ['op-3'])), 'bromont - Outside 1_ Outside 2.svg', 'name: two ticked, through shaperFileName (its existing rule makes the comma _)');
eq(exportFileName('bromont', tick(OPS, ['op-1', 'op-2'])), 'bromont - Pocket 3.svg', 'name: the number is the operation\'s place in the Operations list');
const withStock = [op('op-9', 'stock'), ...OPS];
eq(exportFileName('bromont', tick(withStock, ['op-2', 'op-3'])), 'bromont - Outside 2.svg', 'name: the Stock (always in the file) is never named, but counts in the list numbers');
eq(exportFileName('bromont', withStock), 'bromont.svg', 'name: the Stock and every operation ticked = the full name');
eq(exportFileName('Untitled', tick(OPS, ['op-1'])), 'shaper-export - Outside 2_ Pocket 3.svg', 'name: an Untitled design\'s partial file');
eq(exportFileName(null), 'shaper-export.svg', 'name: no operations (the store empty) = as before');
eq(tickedSetKey(OPS), 'all', 'key: everything ticked = all');
eq(tickedSetKey(withStock), 'all', 'key: the Stock is not a choice');
eq(tickedSetKey(tick(OPS, ['op-1'])), 'op-2,op-3', 'key: the ticked ids');
eq(tickedSetKey(tick([OPS[2], OPS[1], OPS[0]], ['op-1'])), 'op-2,op-3', 'key: a reorder keeps the key (the name\'s numbers change)');

// ── 4. the targets follow the design, per ticked set ──
eq(folderPlace('/'), 'My Files', 'the folder as the dialog names it: My Files');
eq(folderPlace('/Furniture/Oak/'), 'My Files/Furniture/Oak', 'a subfolder');
const T = { filename: 'bromont (2).svg', remotePath: '/Furniture/' };
const P = { filename: 'bromont - Outside 1.svg', remotePath: '/' };
setHubTargets(null);
ok(!('hubTargets' in captureShaperDoc()), 'a design never sent: no hubTargets in its document (the same bytes as before 884)');
setHubTarget('all', T);
setHubTarget('op-1', P);
const doc = JSON.parse(JSON.stringify(captureShaperDoc()));
eq(doc.hubTargets, { all: T, 'op-1': P }, 'the website document carries the targets, per set');
setHubTargets(null);
applyShaperDoc(doc, null);
eq(getHubTargets(), { all: T, 'op-1': P }, 'website: the document read gives the targets back (a reload of the same design)');
applyShaperDoc({ ...doc, hubTargets: undefined }, null);
eq(getHubTargets(), {}, 'website: a design without them (another design) has none');
setHubTarget('all', T);
applyShaperDoc(undefined, null);
eq(getHubTarget('all'), null, 'website: a new design (no sidecar) has no target');
setHubTarget('all', T);
const project = JSON.parse(JSON.stringify(captureFusionProject()));
eq(project.hubTargets, { all: T }, 'the Fusion project carries the targets');
setHubTargets(null);
applyFusionProject(project);
eq(getHubTarget('all'), T, 'Fusion: the design\'s saved project gives the target back');
applyFusionProject({ ...project, hubTargets: undefined });
eq(getHubTargets(), {}, 'Fusion: a project without them has none');
setHubTarget('all', T);
applyFusionProject(null);
eq(getHubTargets(), {}, 'Fusion: a new design (no project) has none');
ok(!('hubTargets' in captureFusionProject()), 'Fusion: a design never sent writes no hubTargets');
eq(setHubTarget('all', { filename: '', remotePath: '/' }), null, 'a target needs a file name');
eq(setHubTarget('all', { filename: 'a.svg', remotePath: '../up' }), null, 'a folder path the server refuses is no target');
eq(setHubTarget('all', { filename: 'a.svg', remotePath: 'Furniture' }), { filename: 'a.svg', remotePath: '/Furniture/' }, 'a folder is kept in the server\'s form');
eq(setHubTargets({ all: T, bad: { filename: 3 } }), { all: T }, 'a stored entry that is not a target is left out');
setHubTargets(null);

// ── 5. what a Generate does, and what the switch shows ──
eq(autoSendDecision({ on: false, target: T, signedIn: true }), 'off', 'switch off -> Generate sends nothing');
eq(autoSendDecision({ on: true, target: null, signedIn: true }), 'no-target', 'no first Send yet -> nothing');
eq(autoSendDecision({ on: true, target: T, signedIn: false }), 'no-login', 'no sign-in this session -> nothing');
eq(autoSendDecision({ on: true, target: T, signedIn: true }), 'send', 'on, a target, signed in -> the replace');
// the full file is never replaced by a partial one: only the 'all' set was sent; a Generate with op-3 unticked finds no target for ITS set
setHubTarget('all', T);
const partialKey = tickedSetKey(tick(OPS, ['op-3']));
eq(getHubTarget(partialKey), null, 'a partial set never sent has no target (the full file\'s target is not its)');
eq(autoSendDecision({ on: true, target: getHubTarget(partialKey), signedIn: true }), 'no-target', 'so a Generate of the partial file replaces nothing (it stays local until a Send)');
eq(autoSendDecision({ on: true, target: getHubTarget(tickedSetKey(OPS)), signedIn: true }), 'send', 'everything ticked again: the full file\'s target is replaced');
setHubTargets(null);
const off = keepSwitchView({ on: false, signedIn: false, target: T });
eq([off.checked, off.disabled, off.hint], [false, true, 'Needs a sign-in for this session.'], 'no sign-in: the switch is disabled, its hint says what it needs');
const offOn = keepSwitchView({ on: true, signedIn: false, target: T });
eq([offOn.checked, offOn.disabled], [true, true], 'no sign-in, setting on: shown on, disabled');
const live = keepSwitchView({ on: false, signedIn: true, target: T });
eq([live.checked, live.disabled, live.hint], [false, false, 'Each Generate replaces bromont (2).svg in My Files/Furniture on ShaperHub.'], 'signed in with a target: enabled, the hint names the file and the folder');
const first = keepSwitchView({ on: true, signedIn: true, target: null });
eq([first.disabled, first.hint], [false, 'Each Generate replaces the file last sent with the operations ticked now: send it once first.'], 'signed in, these ticks never sent: enabled, the hint says a first Send is needed');

// ── 6. queue of one per file ──
{
  const runs = []; let inFlight = 0, most = 0; const gates = [];
  const q = createReplaceQueue(async (job) => { inFlight++; most = Math.max(most, inFlight); runs.push(job); await new Promise((r) => gates.push(r)); inFlight--; });
  const turn = () => new Promise((r) => setImmediate(r));
  q.push('all', 'svg-1');
  await turn();
  eq(runs, ['svg-1'], 'the first Generate starts its replace at once');
  q.push('all', 'svg-2'); q.push('all', 'svg-3'); q.push('all', 'svg-4');
  ok(q.busy(), 'busy while a replace runs');
  gates.shift()();
  await turn();
  eq(runs, ['svg-1', 'svg-4'], 'after it: ONE more, with the LATEST svg (2 and 3 never sent)');
  gates.shift()();
  await q.settled();
  eq([runs.length, most, q.busy()], [2, 1, false], 'two replaces in all, never two at once, then idle');
  q.push('all', 'svg-5'); q.push('op-1', 'part-1'); q.push('all', 'svg-6'); q.push('op-1', 'part-2');
  for (let i = 0; i < 3; i++) { await turn(); gates.shift()(); }
  await q.settled();
  eq(runs.slice(2), ['svg-5', 'part-2', 'svg-6'], 'another file waits beside it: one waiting job per file (the latest), in the order the files first came, one at a time');
  eq(most, 1, 'never two at once');
}

// ── 7. the source ──
const app = read('apps/shaper/src/shaper-app.js');
eq((app.match(/fetch\('\/api\/shaper-upload'/g) || []).length, 1, 'ONE request path: one fetch of /api/shaper-upload');
eq((app.match(/hubQueue\.push\(/g) || []).length, 1, 'one place queues a replace');
const gen = app.slice(app.indexOf('async function generateShaperSvg()'), app.indexOf('// Direct ShaperHub cloud sync'));
ok(gen.includes('hubQueue.push(setKey,') && gen.includes('getHubTarget(setKey)'), 'that place is Generate (generateShaperSvg), for the ticked set\'s target: nothing else (autosave, edits, opening a design) triggers it');
ok(/callShaperHub\(\{[^}]*mode: UPLOAD_MODES\.REPLACE/.test(app) && app.includes('setHubTarget(setKey, targetOfSend('), 'the replace goes through callShaperHub (the one request path), mode replace; a Send sets its set\'s target');
ok(read('apps/shaper/index.html').includes('id="sync-keep-updated"'), 'the switch is in Shaper\'s Sync dialog');
for (const host of ['sketchstudio', 'penplotter', 'trace']) {
  const html = read(`apps/${host}/index.html`);
  ok(!/sync-keep|keepHubUpToDate|Keep ShaperHub/.test(html), `the switch is ABSENT in ${host}'s page`);
}

console.log(`shaperhub-keep-884-node: ${checks} checks ok`);
