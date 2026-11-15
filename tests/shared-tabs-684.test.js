// tests/shared-tabs-684.test.js — TASK 684 (owner turns 1768-1775): ONE list of open document tabs for all four apps, headless (the document buffer of
// each app on ONE shared in-memory project store, as the four pages share one IndexedDB; a "page" = a createDocumentBuffer, a reload = a new one).
//   A. MIGRATION: TASK 624's per-app buffers (openTabsBuffer:<app>) are merged into the one list on its first read: no tab lost, a stored design open in two
//      apps appears once, every app's unsaved tabs are kept, the reading app's active tab stays active, an app's session goes into its own slot; the old keys go.
//   B. ACROSS APPS: Studio (no sidecar) -> Shaper (adds a cut plan to the saved design AND to the unsaved one) -> Pen Plotter -> Studio -> Shaper: the same tabs,
//      the same order, the same active tab everywhere; each app's sidecar kept (stored design: in the store; unsaved: in the buffer and in its first named save);
//      showing a design in an app that does not change it writes nothing.
//   C. An EMPTY Untitled has no not-saved dot after a reload (inactive and active) and in another app; one with content keeps it.
//   D. TWO PAGES at once (the simplest safe rule): tabs either page opened are both kept; a tab both edited keeps both versions; a tab one closed is dropped;
//      each app's session slot survives the other page's write.
//   E. keepTabs() (what GO TO runs) resolves false when the buffer cannot be written; a session's stored() part is what the buffer keeps.
import assert from 'node:assert';
import { createProjectStore, createMemoryAdapter, emptyDocument } from '../packages/ui/project-store.js';
import { createDocumentBuffer, mergeTabBuffers } from '../packages/ui/document-buffer.js';
import { serializeDocument, deserializeDocument } from '../packages/core/document.js';
import { createSketchState } from '../packages/ui/sketch-state.js';
import { createEngine } from '../packages/core/constraint-solver.js';

let t = 9000;
const mkStore = (adapter) => { let n = 0; return createProjectStore({ adapter, legacySource: async () => null, idFn: () => 'd' + (++n), now: () => ++t, channel: null }); };
const docWith = (...ids) => ({ ...emptyDocument(), geometry: { joints: ids.map((id, i) => [id, { x: i, y: 0 }]), shapes: [], constraints: [] } });
const engine = createEngine(null);
const mkState = () => { engine.init(); return createSketchState(engine, { x: 0, y: 0, w: 100, h: 80 }); };
const ids = (st) => [...st.joints.keys()].filter((k) => k !== 'j_origin').sort();
const step = (st, label, id) => { st.saveState(label); st.joints.set(id, { x: 1, y: 2 }); };
const clone = (o) => JSON.parse(JSON.stringify(o));

/** One app's page: the shared buffer with an optional sidecar (hostName) and session, like a host's createDocumentBuffer options. */
function page(app, store, { hostName = null, session = false, stored = null } = {}) {
  const st = mkState();
  const side = { data: null, sel: null, writes: 0 };
  const opts = { state: st, app, store, pollMs: 1e9, doc: null, win: null };
  if (hostName) {
    opts.hostName = hostName;
    opts.getHostData = () => clone(side.data);
    opts.onRestored = ({ hosts }) => { side.data = hosts[hostName] ? clone(hosts[hostName]) : { cut: 0 }; }; // a document without this app's sidecar: its defaults
  }
  if (session) opts.session = { capture: () => ({ sel: side.sel, ...(stored ? { live: () => side.sel } : {}) }), restore: (s) => { side.sel = s ? s.sel : null; }, ...(stored ? { stored } : {}) };
  const buf = createDocumentBuffer(opts);
  return { st, buf, side, names: () => buf.tabs().map((x) => x.name), active: () => buf.tabs().find((x) => x.active).name, dots: () => buf.tabs().map((x) => !!x.needsSavePrompt) };
}

// ---- A. migration of the per-app buffers ---------------------------------------------------------------------------------------------------
{
  const adapter = createMemoryAdapter();
  const store = mkStore(adapter);
  const dx = await store.newDesign('X'); await store.save(docWith('jx'), { id: dx.id });
  const emptyU = clone({ ...docWith(), geometry: { joints: [['j_origin', { x: 0, y: 0, fixed: true }]], shapes: [], constraints: [] } });
  const studioU = docWith('js'), shaperU = docWith('jsh');
  await adapter.setMeta('openTabsBuffer:sketchstudio', { v: 1, app: 'sketchstudio', activeKey: 't2', currentId: null, tabs: [
    { key: 't1', designId: dx.id, name: 'X', emptySig: null, saveOk: true, doc: docWith('jx'), view: null },
    { key: 't2', designId: null, name: 'Untitled', emptySig: JSON.stringify(emptyU), saveOk: true, doc: studioU, view: null },
  ] });
  await adapter.setMeta('openTabsBuffer:shaper', { v: 1, app: 'shaper', activeKey: 't1', currentId: dx.id, tabs: [
    { key: 't1', designId: dx.id, name: 'X', emptySig: null, saveOk: true, doc: docWith('jx'), view: { x: 3, y: 4, w: 10, h: 8 }, hostSession: { sel: 'shaper-x' } },
    { key: 't2', designId: null, name: 'Untitled', emptySig: JSON.stringify(emptyU), saveOk: true, doc: shaperU, view: null, hostSession: { sel: 'shaper-u' } },
  ] });
  await adapter.setMeta('openTabsBuffer:penplotter', { v: 1, app: 'penplotter', activeKey: 't1', currentId: null, tabs: [
    { key: 't1', designId: null, name: 'Untitled', emptySig: JSON.stringify(emptyU), saveOk: true, doc: emptyU, view: null },
    { key: 't2', designId: null, name: 'Untitled', emptySig: JSON.stringify(emptyU), saveOk: true, doc: docWith('jp'), view: null },
  ] });
  await store.setCurrent(dx.id);
  const sh = page('shaper', store, { session: true });
  await sh.buf.restore();
  const tabs = sh.buf.tabs();
  console.log('migrated:', JSON.stringify(tabs.map((x) => [x.name, x.designId, x.needsSavePrompt])));
  assert.strictEqual(tabs.filter((x) => x.designId === dx.id).length, 1, 'the design open in two apps appears ONCE');
  assert.strictEqual(tabs.length, 5, 'X once + Studio\'s unsaved + Shaper\'s unsaved + Pen Plotter\'s two Untitled tabs: no tab lost');
  assert.deepStrictEqual(tabs.map((x) => x.name), ['X', 'Untitled', 'Untitled', 'Untitled', 'Untitled']);
  assert.strictEqual(tabs[0].active, true, "the reading app's (Shaper's) active tab stays active");
  assert.deepStrictEqual(ids(sh.st), ['jx'], 'and shows X');
  assert.strictEqual(sh.side.sel, 'shaper-x', "Shaper's session of X came back (its own slot)");
  assert.deepStrictEqual(tabs.map((x) => x.needsSavePrompt), [null, 'unsaved', 'unsaved', null, 'unsaved'], 'unsaved tabs with content keep their dot; the empty one has none');
  const shown = [];
  for (const k of tabs.slice(1).map((x) => x.key)) { await sh.buf.activate(k); shown.push(ids(sh.st).join() || '-'); }
  assert.deepStrictEqual(shown, ['jsh', 'js', '-', 'jp'], "Shaper's unsaved first, then Studio's, then Pen Plotter's");
  assert.deepStrictEqual(await adapter.listMetaKeys('openTabsBuffer:'), [], 'the per-app keys are gone after the merge');
  assert.strictEqual((await store.readBuffer({ app: 'sketchstudio' })).tabs.length, 5, 'a second reader gets the same one list');
}

// ---- B. Studio -> Shaper -> Pen Plotter -> Studio -> Shaper -----------------------------------------------------------------------------------
{
  const adapter = createMemoryAdapter();
  const store = mkStore(adapter);
  const s = await store.newDesign('Saved'); await store.save(docWith('js1', 'js2'), { id: s.id });
  await store.setCurrent(null);
  // Studio: an unsaved Untitled with content, and the saved design opened beside it (active)
  let studio = page('sketchstudio', store);
  await studio.buf.restore();
  step(studio.st, 'line', 'ju');
  await studio.buf.openTab(s.id);
  assert.deepStrictEqual(studio.names(), ['Untitled', 'Saved']);
  assert.strictEqual(await studio.buf.keepTabs(), true, 'GO TO: the tabs are kept');
  const keys = studio.buf.tabs().map((x) => x.key);
  // Shaper: the same tabs, the same active one; a cut plan on the saved design (autosaved, its own sidecar) and on the unsaved one (in the buffer)
  let shaper = page('shaper', store, { hostName: 'shaper' });
  await shaper.buf.restore();
  assert.deepStrictEqual(shaper.buf.tabs().map((x) => x.key), keys, 'Shaper: the same tabs, same order');
  assert.strictEqual(shaper.active(), 'Saved', 'Shaper: the same active tab');
  assert.deepStrictEqual(ids(shaper.st), ['js1', 'js2'], 'Shaper shows the saved design');
  assert.deepStrictEqual(shaper.dots(), [true, false], 'Shaper: the unsaved tab keeps its dot');
  await shaper.buf.flush();
  assert.strictEqual((await store.get(s.id)).document.hosts.shaper, undefined, 'showing a design Shaper has no sidecar for writes nothing');
  shaper.side.data = { cut: 1 };
  await shaper.buf.flush();
  assert.deepStrictEqual((await store.get(s.id)).document.hosts.shaper, { cut: 1 }, "Shaper's cut plan on the saved design is autosaved");
  await shaper.buf.activate(keys[0]);
  assert.deepStrictEqual(ids(shaper.st), ['ju'], "Shaper shows the unsaved Untitled's drawing");
  shaper.side.data = { cut: 2 };
  await shaper.buf.activate(keys[1]);
  assert.deepStrictEqual(shaper.side.data, { cut: 1 }, 'switching back: the saved design has its own cut plan');
  assert.strictEqual(await shaper.buf.keepTabs(), true);
  // Pen Plotter: the same tabs; showing the saved design writes nothing
  const before = (await store.get(s.id)).updatedAt;
  const pen = page('penplotter', store, { hostName: 'penplotter' });
  await pen.buf.restore();
  assert.deepStrictEqual(pen.buf.tabs().map((x) => x.key), keys, 'Pen Plotter: the same tabs');
  assert.strictEqual(pen.active(), 'Saved', 'Pen Plotter: the same active tab');
  await pen.buf.flush();
  assert.strictEqual((await store.get(s.id)).updatedAt, before, 'Pen Plotter showing the design did not write it');
  await pen.buf.activate(keys[0]); await pen.buf.activate(keys[1]);
  assert.strictEqual(await pen.buf.keepTabs(), true);
  // Studio again: the geometry is unchanged, every sidecar is still there
  studio = page('sketchstudio', store);
  await studio.buf.restore();
  assert.deepStrictEqual(studio.names(), ['Untitled', 'Saved']);
  assert.deepStrictEqual(ids(studio.st), ['js1', 'js2'], 'Studio: the saved design, unchanged');
  await studio.buf.activate(keys[0]);
  assert.deepStrictEqual(ids(studio.st), ['ju'], 'Studio: the unsaved drawing, unchanged');
  assert.strictEqual(studio.buf.needsSavePrompt(), 'unsaved');
  assert.strictEqual(await studio.buf.keepTabs(), true);
  const bufTabs = (await store.readBuffer({})).tabs;
  assert.deepStrictEqual(bufTabs[0].doc.hosts.shaper, { cut: 2 }, "the unsaved tab still carries Shaper's cut plan (Studio passed it through)");
  assert.ok(bufTabs[0].doc.hosts.penplotter, "and Pen Plotter's sidecar (its defaults, written when it was put aside there)");
  assert.deepStrictEqual((await store.get(s.id)).document.hosts.shaper, { cut: 1 }, "the saved design still holds Shaper's cut plan");
  // Shaper again: both cut plans are there
  shaper = page('shaper', store, { hostName: 'shaper' });
  await shaper.buf.restore();
  assert.strictEqual(shaper.active(), 'Untitled', 'Shaper opens on the tab Studio left active');
  assert.deepStrictEqual(shaper.side.data, { cut: 2 }, "reopened Shaper: the unsaved design's cut plan");
  await shaper.buf.activate(keys[1]);
  assert.deepStrictEqual(shaper.side.data, { cut: 1 }, "reopened Shaper: the saved design's cut plan");
  // the unsaved design's first named save (in Studio) keeps every app's sidecar
  studio = page('sketchstudio', store);
  await studio.buf.restore();
  await studio.buf.activate(keys[0]);
  const named = await studio.buf.saveAs('Named');
  assert.deepStrictEqual((await store.get(named.id)).document.hosts.shaper, { cut: 2 }, "the first named save (from Studio) stores Shaper's cut plan too");
  console.log('across apps: same tabs + active in 4 pages, sidecars kept (stored and unsaved), showing writes nothing');
}

// ---- C. an empty Untitled: no dot after a reload or in another app ---------------------------------------------------------------------------
{
  const store = mkStore(createMemoryAdapter());
  const a = page('sketchstudio', store);
  await a.buf.restore();
  step(a.st, 'line', 'jc');
  await a.buf.newTab();
  assert.deepStrictEqual(a.dots(), [true, false]);
  await a.buf.keepTabs();
  const reload = page('sketchstudio', store);
  await reload.buf.restore();
  assert.deepStrictEqual(reload.dots(), [true, false], 'after a reload: the empty Untitled (active) has no dot, the one with content keeps it');
  await reload.buf.activate(reload.buf.tabs()[0].key);
  assert.deepStrictEqual(reload.dots(), [true, false], 'after a reload: the INACTIVE empty Untitled has no dot');
  await reload.buf.keepTabs();
  const again = page('sketchstudio', store);
  await again.buf.restore();
  assert.deepStrictEqual(again.dots(), [true, false], 'a second reload: still no dot on the empty one');
  const other = page('shaper', store, { hostName: 'shaper' });
  await other.buf.restore();
  assert.deepStrictEqual(other.dots(), [true, false], 'in another app (its own sidecar defaults): no dot on the empty one');
  await other.buf.activate(other.buf.tabs()[1].key);
  assert.deepStrictEqual(other.dots(), [true, false], 'and none once it shows there');
  assert.strictEqual(other.buf.needsSavePrompt(), null);
}

// ---- D. two pages at the same time -------------------------------------------------------------------------------------------------------------
{
  const store = mkStore(createMemoryAdapter());
  const seed = page('sketchstudio', store);
  await seed.buf.restore(); step(seed.st, 'line', 'j1'); await seed.buf.keepTabs();
  // two pages are two JS realms; here they share this process's ONE engine store (constraint-solver.js, module level), so each page's live geometry is put
  // back into it before that page acts (the page's own state otherwise: history, its buffer, its tab records)
  let current = null; const live = new Map();
  const on = async (P, fn) => { if (current && current !== P) live.set(current, serializeDocument(current.st)); if (current !== P && live.has(P)) deserializeDocument(live.get(P), P.st); current = P; await fn(); };
  const A = page('sketchstudio', store);
  const B = page('shaper', store, { session: true });
  await on(A, () => A.buf.restore()); await on(B, () => B.buf.restore());
  const k1 = A.buf.tabs()[0].key;
  assert.strictEqual(B.buf.tabs()[0].key, k1, 'both pages hold the same tab');
  await on(A, async () => { await A.buf.newTab(); step(A.st, 'line', 'jA'); await A.buf.keepTabs(); });
  await on(B, async () => { await B.buf.newTab(); step(B.st, 'line', 'jB'); B.side.sel = 'b-sel'; await B.buf.keepTabs(); });
  let buffer = await store.readBuffer({});
  const docs = () => buffer.tabs.map((x) => x.doc.geometry.joints.map((j) => j[0]).filter((k) => k !== 'j_origin').join() || '-');
  assert.deepStrictEqual(docs().sort(), ['j1', 'jA', 'jB'], 'a tab each page opened: both kept (B wrote last and kept A\'s)');
  // both edit the SAME tab: both versions are kept
  await on(A, async () => { await A.buf.activate(k1); step(A.st, 'line', 'jA2'); await A.buf.keepTabs(); });
  await on(B, async () => { await B.buf.activate(k1); step(B.st, 'line', 'jB2'); await B.buf.keepTabs(); });
  buffer = await store.readBuffer({});
  assert.ok(docs().includes('j1,jB2') && docs().includes('j1,jA2'), 'a tab both pages changed: both versions kept: ' + JSON.stringify(docs()));
  // A closes its own tab (B never touched it): dropped. B's session of its tab survives A's write.
  const kA = A.buf.tabs().find((x) => x.key !== k1).key;
  await on(A, async () => { await A.buf.closeTab(kA); await A.buf.keepTabs(); });
  buffer = await store.readBuffer({});
  assert.ok(!docs().includes('jA'), 'the tab A closed is gone: ' + JSON.stringify(docs()));
  const bTab = buffer.tabs.find((x) => docs()[buffer.tabs.indexOf(x)] === 'jB');
  assert.deepStrictEqual(bTab.hostSessions.shaper, { sel: 'b-sel' }, "Shaper's session slot of its tab survives SketchStudio's write");
  // the merge rule itself: a tab closed here that another page changed since is kept
  const base = new Map([['k', 'u:' + JSON.stringify(['Untitled', { a: 1 }])]]);
  const m = mergeTabBuffers({ activeKey: 'k', tabs: [{ key: 'k', name: 'Untitled', doc: { a: 2 } }] }, null, base, 'sketchstudio');
  assert.strictEqual(m.buffer.tabs.length, 1, 'closed here but changed elsewhere since: kept');
  console.log('two pages: ' + JSON.stringify(docs()));
}

// ---- E. keepTabs refuses when the buffer cannot be written; a session's stored() part is what is written ----------------------------------------
{
  const store = mkStore(createMemoryAdapter());
  const failing = { ...store, updateBuffer: async () => { throw new Error('quota exceeded'); } };
  const p = page('sketchstudio', failing);
  await p.buf.restore(); step(p.st, 'line', 'jq');
  assert.strictEqual(await p.buf.keepTabs(), false, 'keepTabs resolves false: GO TO stays on the page');
  const live = page('trace', store, { session: true, stored: (s) => ({ sel: s.sel }) }); // the capture holds a function (not storable, like a canvas): stored() drops it
  await live.buf.restore(); step(live.st, 'line', 'jt'); live.side.sel = 'kept';
  assert.strictEqual(await live.buf.keepTabs(), true, 'the stored part can be written');
  assert.deepStrictEqual((await store.readBuffer({})).tabs[0].hostSessions, { trace: { sel: 'kept' } }, 'only the stored part is in the buffer');
}

console.log('shared-tabs-684: migration, across apps, empty-tab dot, two pages, keepTabs OK');
