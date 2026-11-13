// tests/document-tabs.test.js — TASK 558 slice 1 (docs/DOCUMENT-TABS-DESIGN.md): the headless TAB MODEL of the document buffer, the
// poll() rebind race (finding F4) and the owner's SAVE RULE (2026-11-12: "Auto save only once I actually saved and named"):
//   - a new design (a fresh page, New design) is an in-memory Untitled: NOTHING is stored until the first named save (Save as);
//   - from that first named save on, edits autosave as before;
//   - needsSavePrompt() is the one headless decision a close / leave prompt asks (slice 4 draws the prompt).
// Runs on the in-memory store adapter and the REAL shared sketch state (createSketchState over a createEngine store).
import assert from 'node:assert';
import { createProjectStore, createMemoryAdapter, emptyDocument } from '../packages/ui/project-store.js';
import { createDocumentBuffer, MAX_TABS } from '../packages/ui/document-buffer.js';
import { createSketchState } from '../packages/ui/sketch-state.js';
import { createEngine } from '../packages/core/constraint-solver.js';
import { buildJournal } from '../packages/core/journal.js';

let t = 5000;
const mkStore = (adapter = createMemoryAdapter()) => { let n = 0; return createProjectStore({ adapter, legacySource: async () => null, idFn: () => 'd' + (++n), now: () => ++t, channel: null }); };
const docWith = (...ids) => ({ ...emptyDocument(), geometry: { joints: ids.map((id, i) => [id, { x: i, y: 0 }]), shapes: [], constraints: [] } });
const engine = createEngine(null);
const mkState = () => { engine.init(); return createSketchState(engine, { x: 0, y: 0, w: 100, h: 80 }); };
// the DRAWN joints (every loaded document also holds the fixed origin since task 554: asserted on its own below)
const ids = (st) => [...st.joints.keys()].filter((k) => k !== 'j_origin').sort();
const storedIds = async (store, id) => (await store.get(id)).document.geometry.joints.map((j) => j[0]).filter((k) => k !== 'j_origin').sort();
const step = (st, label, id) => { st.saveState(label); st.joints.set(id, { x: 1, y: 2 }); };
const mkBuffer = (st, store, extra = {}) => createDocumentBuffer({ state: st, app: 'sketchstudio', store, pollMs: 1e9, doc: null, win: null, ...extra });

// ---- F4: a save still in flight when the buffer is rebound must not bring the old binding back --------------------------------------
{
  const store = mkStore();
  const a = await store.newDesign('A'); await store.save(docWith('jA'), { id: a.id });
  const b = await store.newDesign('B'); await store.save(docWith('jB'), { id: b.id });
  await store.open(a.id);
  const held = []; let hold = false;
  const gated = { ...store, save: (d, o) => (hold ? new Promise((res, rej) => held.push(() => store.save(d, o).then(res, rej))) : store.save(d, o)) };
  const st = mkState();
  const buf = mkBuffer(st, gated);
  await buf.restore();
  assert.deepStrictEqual(ids(st), ['jA']);
  st.joints.set('jA2', { x: 5, y: 5 });
  hold = true; const p1 = buf.flush(); hold = false;   // an autosave of A is in flight (held)...
  await buf.openDesign(b.id);                          // ...while the user opens B (its own flush saves A again, not held)
  held.shift()(); await p1;                            // the old write of A completes AFTER the rebind
  st.joints.set('jB2', { x: 7, y: 7 });
  await buf.flush();
  assert.strictEqual(buf.designId(), b.id, 'the buffer stays bound to B after the late write of A completes');
  assert.deepStrictEqual(await storedIds(store, a.id), ['jA', 'jA2'], 'A keeps A\'s drawing: B\'s edit never lands in A');
  assert.deepStrictEqual(await storedIds(store, b.id), ['jB', 'jB2'], 'B\'s edit autosaves into B');
}

// ---- the SAVE RULE ------------------------------------------------------------------------------------------------------------------
{
  const store = mkStore();
  const st = mkState();
  const buf = mkBuffer(st, store);
  const r = await buf.restore();
  assert.strictEqual(r.restored, false, 'a fresh page has nothing to restore');
  assert.strictEqual(buf.needsSavePrompt(), null, 'an untouched Untitled needs no prompt');
  step(st, 'line', 'j1');
  await buf.flush();
  assert.strictEqual((await store.listRecent()).length, 0, 'a fresh page stores NOTHING before the first named save');
  assert.strictEqual(buf.designId(), null);
  assert.strictEqual(buf.isStored(), false);
  assert.strictEqual(buf.designName(), 'Untitled');
  assert.strictEqual(buf.needsSavePrompt(), 'unsaved', 'an Untitled with content asks before it is closed');
  assert.strictEqual(await store.current(), null, 'the current-design pointer stays empty');

  // Save to file of the unsaved Untitled: a file, the store stays empty
  const seam = { text: null, save: async (text, name) => { seam.text = text; seam.name = name; return { name }; } };
  await buf.saveFile(seam);
  assert(JSON.parse(seam.text).document.geometry.joints.some((j) => j[0] === 'j1'), 'Save to file writes the in-memory drawing');
  assert.strictEqual(JSON.parse(seam.text).name, 'Untitled');
  assert.strictEqual((await store.listRecent()).length, 0, 'Save to file stores nothing in the project store');

  // the first NAMED save stores it
  const saved = await buf.saveAs('Bracket');
  assert.deepStrictEqual((await store.listRecent()).map((d) => d.name), ['Bracket'], 'Save as on an Untitled names and stores it (one design, no copy)');
  assert.strictEqual(buf.designId(), saved.id);
  assert.strictEqual(buf.designName(), 'Bracket');
  assert.strictEqual(buf.needsSavePrompt(), null, 'a named design closes without asking');
  assert.deepStrictEqual(await storedIds(store, saved.id), ['j1'], 'the stored design holds the drawing');
  assert.strictEqual((await store.current()).id, saved.id, 'the named design is the current one');
  // from then on, edits autosave
  step(st, 'line', 'j2');
  await buf.flush();
  assert.deepStrictEqual(await storedIds(store, saved.id), ['j1', 'j2'], 'after the named save, edits autosave');

  // New design: an in-memory Untitled again; the named design keeps its content; nothing new is stored
  const rn = await buf.newDesign();
  assert(rn.restored && rn.name === 'Untitled' && [...st.joints.keys()].join() === 'j_origin', 'New design shows an empty Untitled: only its fixed origin (task 554)');
  assert.strictEqual(buf.designId(), null);
  assert.strictEqual((await store.listRecent()).length, 1, 'New design stores nothing');
  assert.strictEqual(await store.current(), null, 'New design clears the current pointer (the sidebar names what is shown)');
  step(st, 'line', 'j9');
  await buf.flush();
  assert.deepStrictEqual(await storedIds(store, saved.id), ['j1', 'j2'], 'the Untitled\'s edits never reach the named design');
  // opening / New / Open file over an unsaved Untitled with content is refused (nothing is lost; the prompt is slice 4's)
  await assert.rejects(() => buf.openDesign(saved.id), /not saved yet/);
  await assert.rejects(() => buf.newDesign(), /not saved yet/);
  assert(st.joints.has('j9'), 'a refused open changes nothing');
  st.undo();
  assert.strictEqual(buf.needsSavePrompt(), null, 'undone back to empty: no prompt');
  const ro = await buf.openDesign(saved.id);
  assert(ro.restored && buf.designId() === saved.id, 'an EMPTY Untitled is simply replaced');
}

// ---- needsSavePrompt: a named design whose last save failed asks -----------------------------------------------------------------
{
  const store = mkStore();
  const a = await store.newDesign('A'); await store.save(docWith('jA'), { id: a.id });
  let fail = false;
  const flaky = { ...store, save: (d, o) => (fail ? Promise.reject(new Error('disk full')) : store.save(d, o)) };
  const st = mkState();
  const buf = mkBuffer(st, flaky);
  await buf.restore();
  fail = true; st.joints.set('jx', { x: 1, y: 1 }); await buf.flush();
  assert.strictEqual(buf.needsSavePrompt(), 'save-failed');
  fail = false; st.joints.set('jy', { x: 1, y: 1 }); await buf.flush();
  assert.strictEqual(buf.needsSavePrompt(), null, 'a later good save clears it');
}

// ---- the TAB MODEL --------------------------------------------------------------------------------------------------------------------
{
  const store = mkStore();
  const a = await store.newDesign('Alpha'); await store.save(docWith('ja'), { id: a.id });
  const b = await store.newDesign('Beta'); await store.save(docWith('jb'), { id: b.id });
  await store.setCurrent(null);                                  // a fresh page: nothing current
  const st = mkState();
  const restored = []; const sessions = { cap: [], res: [] };
  let hostCounter = 0;
  const buf = mkBuffer(st, store, {
    onRestored: (o) => restored.push([o.name, o.reason]),
    session: { capture: () => { sessions.cap.push(hostCounter); return { hostCounter }; }, restore: (s) => { sessions.res.push(s); hostCounter = s ? s.hostCounter : 0; } },
  });
  await buf.restore();                                           // a fresh page: one untouched Untitled tab
  assert.strictEqual(buf.tabs().length, 1);
  await buf.openTab(a.id);                                       // T2: the untouched Untitled is REUSED
  assert.deepStrictEqual(buf.tabs().map((x) => [x.name, x.active, x.stored]), [['Alpha', true, true]], 'an untouched Untitled tab is reused');
  step(st, 'line', 'ja1'); step(st, 'rect', 'ja2'); step(st, 'circle', 'ja3');
  st.undo();                                                      // one redo step pending
  hostCounter = 7;
  const viewA = { ...st.view, x: 11 }; Object.assign(st.view, viewA);
  const histA = st.history.map((s) => s.label);
  const journalA = buildJournal(st.history, st, { redoStack: st.redoStack });
  const docA = ids(st);

  await buf.openTab(b.id);                                       // a NEW tab
  assert.deepStrictEqual(buf.tabs().map((x) => [x.name, x.active]), [['Alpha', false], ['Beta', true]]);
  assert.deepStrictEqual(ids(st), ['jb'], 'B is shown');
  assert.strictEqual(st.history.length, 0, 'B starts with its own (empty) history');
  assert.strictEqual(st.redoStack.length, 0);
  assert.deepStrictEqual(await storedIds(store, a.id), docA, 'A was saved when it was put aside');
  assert.strictEqual((await store.current()).id, b.id, 'the active tab is the current design');
  hostCounter = 3;
  step(st, 'line', 'jb1');
  st.view.x = -4;

  // the same design twice: no second tab, its tab is activated
  await buf.openTab(a.id);
  assert.strictEqual(buf.tabs().length, 2, 'opening an open design adds no tab');
  assert.deepStrictEqual(ids(st), docA, 'A is back');
  assert.deepStrictEqual(st.history.map((s) => s.label), histA, 'A\'s undo history came back with it');
  assert.strictEqual(st.redoStack.length, 1, 'and its redo step');
  assert.strictEqual(st.view.x, 11, 'and its view');
  assert.strictEqual(hostCounter, 7, 'and the host session');
  const journalA2 = buildJournal(st.history, st, { redoStack: st.redoStack });
  assert.strictEqual(journalA2.current.hash, journalA.current.hash, 'the journal of A is unchanged by the round trip');
  assert.deepStrictEqual(journalA2.steps.map((s) => s.label), journalA.steps.map((s) => s.label));
  assert.deepStrictEqual(await storedIds(store, b.id), ['jb', 'jb1'], 'B was autosaved into B');
  st.undo();
  assert.deepStrictEqual(ids(st), docA.filter((id) => id !== 'ja2'), 'undo in A undoes A\'s step, never B\'s');
  st.redo();
  assert.strictEqual(restored[restored.length - 1][1], 'switch', 'hosts are told a switch is a switch (no refit)');

  // switch back to B by key: B's history and session
  const kB = buf.tabs().find((x) => x.name === 'Beta').key;
  await buf.activate(kB);
  assert.deepStrictEqual(st.history.map((s) => s.label), ['line']);
  assert.strictEqual(hostCounter, 3);
  assert.strictEqual(st.view.x, -4);

  // a new tab is an unsaved Untitled
  await buf.newTab();
  assert.deepStrictEqual(buf.tabs().map((x) => [x.name, x.stored, x.active]), [['Alpha', true, false], ['Beta', true, false], ['Untitled', false, true]]);
  assert.strictEqual(hostCounter, 0, 'a new tab resets the host session');
  assert.strictEqual(await store.current(), null);
  step(st, 'line', 'ju1');
  await buf.flush();
  assert.strictEqual((await store.listRecent()).length, 2, 'the Untitled tab stores nothing');
  const kU = buf.tabs().find((x) => x.name === 'Untitled').key;
  await buf.activate(kB);
  assert.strictEqual(buf.tabs().find((x) => x.key === kU).needsSavePrompt, 'unsaved', 'an inactive Untitled with content still asks before closing');
  assert.strictEqual(buf.tabs().find((x) => x.key === kB).needsSavePrompt, null);

  // close: the active tab -> its right neighbour (the Untitled); closing the last tab leaves a fresh Untitled
  await buf.closeTab(kB);
  assert.deepStrictEqual(buf.tabs().map((x) => [x.name, x.active]), [['Alpha', false], ['Untitled', true]]);
  assert(st.joints.has('ju1'), 'the Untitled tab came back with its drawing');
  const kA = buf.tabs().find((x) => x.name === 'Alpha').key;
  await buf.closeTab(kA);                                       // an INACTIVE tab
  await buf.closeTab(buf.tabs()[0].key);                        // the last one
  assert.deepStrictEqual(buf.tabs().map((x) => [x.name, x.stored]), [['Untitled', false]], 'closing the last tab leaves a fresh Untitled');
  assert.deepStrictEqual([...st.joints.keys()], ['j_origin'], 'the fresh Untitled holds only its origin');
  assert.strictEqual(st.history.length, 0);
  assert.deepStrictEqual(await storedIds(store, a.id), docA, 'closing never lost a stored design');

  // max tabs (T7)
  for (let i = 1; i < MAX_TABS; i++) await buf.newTab();
  assert.strictEqual(buf.tabs().length, MAX_TABS);
  await assert.rejects(() => buf.newTab(), /Close a tab first/);
  step(st, 'line', 'jz');                                       // the active tab is no longer an untouched Untitled
  await assert.rejects(() => buf.openTab(a.id), /Close a tab first/);
}

// ---- beforeunload: armed exactly while leaving would lose work ------------------------------------------------------------------------
{
  const store = mkStore();
  const win = new EventTarget();
  const st = mkState();
  const buf = mkBuffer(st, store, { win, doc: null });
  await buf.restore(); buf.start();
  const leave = () => { const e = new Event('beforeunload', { cancelable: true }); win.dispatchEvent(e); return e.defaultPrevented; };
  assert.strictEqual(leave(), false, 'a clean Untitled: no leave-page warning');
  step(st, 'line', 'ju');
  assert.strictEqual(leave(), true, 'an unsaved Untitled with content: the warning is armed');
  buf.discardUnsaved();
  assert.deepStrictEqual(ids(st), [], 'Don\'t save discards the Untitled');
  assert.strictEqual(leave(), false, 'after Don\'t save: no warning');
  step(st, 'line', 'jv');
  await buf.saveAs('Kept');
  assert.strictEqual(leave(), false, 'a named, saved design: no warning');
  buf.discardUnsaved();
  assert.deepStrictEqual(ids(st), ['jv'], 'a stored design is never discarded');
  buf.stop();
  assert.strictEqual(leave(), false, 'stopped: nothing listens');
}

console.log('document-tabs: F4 race, save rule, tab model, beforeunload OK');
