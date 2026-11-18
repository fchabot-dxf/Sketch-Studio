// tests/save-state-768.test.js — TASK 768: THE save state (packages/ui/save-state.js saveStateOf), the one source of the header's Save button AND the document tab's
// dot / ring: every home (drive | file | none) x dirty (needsSavePrompt) x saving (the store's Drive write / THE Save command running) x failed (the store / the
// command) x signed in / out x loading -> the state and its text. Then the document activity (document-activity.js): a load always ends (resolved, thrown,
// cancelled), THE Save command cannot run twice at once, its failure is kept per tab until its next run. Pure: no DOM.
import assert from 'node:assert';
import { saveStateOf, tabSaveState, SAVE_STATES as S } from '#ui/save-state.js';
import { createDocumentActivity, LOADING_OVERLAY_DELAY_MS } from '#ui/document-activity.js';

const drive = { kind: 'drive', id: 'd1' }, file = { kind: 'file', name: 'Panel.sketch.json', handle: null }, none = { kind: 'none' };
const st = (state, extra = {}) => ({ where: 'drive', state, at: null, reason: null, ...extra });
const cases = [
  // [label, input, state, text]
  ['drive saved', { home: drive, status: st('saved') }, S.SAVED, 'Saved to Google Drive'],
  ['drive kept on this device (an old local design)', { home: drive, status: { where: 'device', state: 'saved' } }, S.SAVED, 'Saved on this device'],
  ['drive: the store writes it', { home: drive, status: st('saving') }, S.SAVING, 'Saving to Google Drive…'],
  ['drive: THE Save command runs', { home: drive, status: st('saved'), saving: true }, S.SAVING, 'Saving to Google Drive…'],
  ['drive: the write failed (signed in)', { home: drive, needsSavePrompt: 'save-failed', status: st('failed', { reason: 'Google Drive answered 500' }) }, S.FAILED, 'Not saved to Google Drive: Google Drive answered 500. Kept on this device.'],
  ['drive: signed out, waiting for sign-in', { home: drive, needsSavePrompt: 'save-failed', signedIn: false, status: st('failed', { reason: 'you are signed out of Google Drive' }) }, S.SIGNIN, 'Not saved to Google Drive: you are signed out of Google Drive. Kept on this device.'],
  ['drive: the local save failed (no store reason)', { home: drive, needsSavePrompt: 'save-failed', status: st('saved') }, S.FAILED, 'Not saved to Google Drive: the last save did not go through. Kept on this device.'],
  ['drive: failed wins over a retry the store runs (as the tab dot did)', { home: drive, needsSavePrompt: 'save-failed', status: st('saving') }, S.FAILED, 'Not saved to Google Drive: the last save did not go through. Kept on this device.'],
  ['drive: a press retries a failed save -> saving', { home: drive, needsSavePrompt: 'save-failed', status: st('failed', { reason: 'x' }), saving: true }, S.SAVING, 'Saving to Google Drive…'],
  ['file saved', { home: file }, S.SAVED, 'Saved to Panel.sketch.json'],
  ['file with changes', { home: file, needsSavePrompt: 'unsaved' }, S.UNSAVED, 'Changes not saved to Panel.sketch.json'],
  ['file: THE Save command writes it', { home: file, needsSavePrompt: 'unsaved', saving: true }, S.SAVING, 'Saving to Panel.sketch.json…'],
  ['file: the write threw', { home: file, needsSavePrompt: 'unsaved', failure: 'The file could not be written.' }, S.FAILED, 'Not saved to Panel.sketch.json: The file could not be written.'],
  ['none, empty', { home: none }, S.NEW, 'Not saved yet'],
  ['none, with content', { home: none, needsSavePrompt: 'unsaved' }, S.UNSAVED, 'Not saved yet'],
  ['none, the press opened Save as (no spinner: the dialog is the feedback)', { home: none, needsSavePrompt: 'unsaved', saving: true }, S.UNSAVED, 'Not saved yet'],
  ['no home given (the app is starting)', {}, S.NEW, 'Not saved yet'],
  ['loading a named design', { home: drive, status: st('saving'), loading: { name: 'Bromont' } }, S.LOADING, 'Loading Bromont…'],
  ['loading, name not known yet (the first restore)', { loading: { name: null } }, S.LOADING, 'Loading the design…'],
];
for (const [label, input, state, text] of cases) {
  assert.deepStrictEqual(saveStateOf(input), { state, text }, label);
}
console.log(`save-state: ${cases.length} home x dirty x saving x failed x sign-in x loading cases`);

// tabSaveState: a buffer tab + the store + the activity -> the same mapping (what the tab and the button both call)
const act = createDocumentActivity();
const store = { status: (id) => (id === 'd1' ? st('failed', { reason: 'offline' }) : st('saved')) };
assert.deepStrictEqual(tabSaveState({ key: 'k1', designId: 'd1', home: drive, needsSavePrompt: 'save-failed' }, { store, signedIn: () => true, activity: act }), { state: S.FAILED, text: 'Not saved to Google Drive: offline. Kept on this device.' }, 'a tab: the store status of its design');
assert.deepStrictEqual(tabSaveState({ key: 'k2', designId: null, home: none, needsSavePrompt: null }, { store, signedIn: () => true, activity: act }), { state: S.NEW, text: 'Not saved yet' }, 'an empty Untitled tab');

// the activity: a load ALWAYS ends; THE Save command never runs twice at once; its failure is kept per tab until its next run
let seen = 0;
act.subscribe(() => { seen++; });
const p1 = act.load('A', () => new Promise((r) => setTimeout(() => r('ok'), 20)));
assert.deepStrictEqual({ name: act.loading().name }, { name: 'A' }, 'loading shows at once');
assert.strictEqual(await p1, 'ok'); assert.strictEqual(act.loading(), null, 'a load that resolved ended');
await assert.rejects(act.load('B', async () => { throw new Error('gone'); }), /gone/); assert.strictEqual(act.loading(), null, 'a load that threw ended');
assert.strictEqual(await act.load('C', async () => null), null); assert.strictEqual(act.loading(), null, 'a cancelled load (null) ended');
const slow = act.load('outer', () => new Promise((r) => setTimeout(r, 30)));
const fast = act.load('inner', () => Promise.resolve());
assert.strictEqual(act.loading().name, 'inner', 'the newest load is shown'); await fast;
assert.strictEqual(act.loading().name, 'outer', 'the older one still runs'); await slow;
assert.strictEqual(act.loading(), null, 'both ended');
let runs = 0;
const first = act.save('k1', () => new Promise((r) => { runs++; setTimeout(() => r('saved'), 20); }));
assert.strictEqual(act.savingKey(), 'k1', 'the command runs for k1');
assert.strictEqual(await act.save('k1', async () => { runs++; return 'twice'; }), null, 'a second press while it runs does nothing');
assert.strictEqual(await first, 'saved'); assert.strictEqual(runs, 1, 'ONE save ran'); assert.strictEqual(act.savingKey(), undefined, 'not running any more');
await assert.rejects(act.save('k1', async () => { throw new Error('The file could not be written.'); }), /could not be written/);
assert.strictEqual(act.failure('k1'), 'The file could not be written.', 'the failure is kept for that tab'); assert.strictEqual(act.failure('k2'), null, 'not for another');
await act.save('k1', async () => 'ok'); assert.strictEqual(act.failure('k1'), null, 'the next run clears it');
assert.ok(seen > 0, 'subscribers heard every change');
assert.ok(LOADING_OVERLAY_DELAY_MS >= 200 && LOADING_OVERLAY_DELAY_MS <= 1000, 'the overlay delay is declared: ' + LOADING_OVERLAY_DELAY_MS);
console.log(`document-activity: loads always end, one Save at a time, failures per tab; overlay delay ${LOADING_OVERLAY_DELAY_MS} ms`);
console.log('save-state-768: ok');
