// tests/project-store-idb.test.js — TASK 474 on REAL IndexedDB (live headless): the old autosave slot migrates into the design
// "Untitled" (once, even with two tabs booting at the same moment, the slot left untouched), the IndexedDB adapter does CRUD,
// ordering, pinning, moving, per-design host merging across two store instances, and a change in another tab notifies this one.
// The page is a tiny fixture with the apps' import map (served by this test), so no app code runs besides the store.

import assert from 'node:assert';
import { launchBrowser } from './helpers/cdp-browser.js';

const FIXTURE = '<!doctype html><script type="importmap">{"imports":{"#core/":"/packages/core/","#ui/":"/packages/ui/"}}</script><body>fixture</body>';

await (async () => {
  const cdp = await launchBrowser({ tag: '474', fixtures: { '/__fixture.html': FIXTURE } });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { evalJs, waitFor, navigate, port } = cdp;

  try {
    await navigate(`http://127.0.0.1:${port}/__fixture.html`, 8000);
    await waitFor(`document.readyState === 'complete' && document.body.textContent === 'fixture'`, 'fixture page loaded');
    // ---- 1. the OLD autosave slot (written the way the pre-474 buffer did) is migrated into the design "Untitled"
    const legacy = { version: 1, geometry: { joints: [['j1', { x: 7, y: 7 }]], shapes: [], constraints: [] }, hosts: { penplotter: { v: 1 }, shaper: { cut: 'pocket' } } };
    await evalJs(`new Promise((res, rej) => {
      const req = indexedDB.open('sketch-studio-documents', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('kv');
      req.onsuccess = () => { const tx = req.result.transaction('kv', 'readwrite'); tx.objectStore('kv').put(${JSON.stringify(legacy)}, 'current'); tx.oncomplete = () => res(true); tx.onerror = () => rej(tx.error); };
    })`);
    const mig = JSON.parse(await evalJs(`(async () => {
      const { createProjectStore, createIdbAdapter } = await import('/packages/ui/project-store.js');
      // two tabs booting at the same moment: ONE design must come out
      const s1 = createProjectStore({ adapter: createIdbAdapter() });
      const s2 = createProjectStore({ adapter: createIdbAdapter() });
      const [a, b] = await Promise.all([s1.loadCurrent({ app: 'penplotter' }), s2.loadCurrent({ app: 'shaper' })]);
      const designs = await s1.listRecent();
      const projects = await s1.listProjects();
      const slot = await new Promise((res) => { const r = indexedDB.open('sketch-studio-documents', 1); r.onsuccess = () => { const g = r.result.transaction('kv').objectStore('kv').get('current'); g.onsuccess = () => res(g.result); }; });
      return JSON.stringify({ a: a && { id: a.id, name: a.name, doc: a.document }, b: b && b.id, designs, projects: projects.map(p => p.name), slot });
    })()`));
    console.log('migration:', JSON.stringify({ design: mig.a.name, id: mig.a.id, projects: mig.projects, count: mig.designs.length }));
    assert.strictEqual(mig.a.name, 'Untitled'); assert.strictEqual(mig.b, mig.a.id, 'both tabs agree on the migrated design');
    assert.strictEqual(mig.designs.length, 1, 'two tabs migrating at once made exactly ONE design');
    assert.deepStrictEqual(mig.projects, ['My Designs']);
    assert.deepStrictEqual(mig.a.doc, legacy, 'the migrated document equals the old slot, every host sidecar included');
    assert.deepStrictEqual(mig.slot, legacy, 'the old slot is untouched (still there as a backup)');

    // ---- 2. the real IndexedDB adapter: CRUD, order, pinned, move, per-design host merge across two store instances
    const crud = JSON.parse(await evalJs(`(async () => {
      const { createProjectStore, createIdbAdapter, emptyDocument } = await import('/packages/ui/project-store.js');
      const A = createProjectStore({ adapter: createIdbAdapter() });
      const B = createProjectStore({ adapter: createIdbAdapter() });   // "another tab"
      const wait = (ms) => new Promise(r => setTimeout(r, ms));
      const until = (ok, ms) => new Promise((res) => { const t0 = Date.now(); const tick = () => (ok() || Date.now() - t0 > ms ? res() : setTimeout(tick, 10)); tick(); });
      let pings = 0; A.subscribe(() => pings++);
      const atelier = await A.createProject('Atelier'); await wait(5);
      const bits = await A.createProject('Bits'); await wait(5);
      await A.pinProject(atelier.id);
      const d1 = await A.newDesign('Shelf', { app: 'penplotter', projectId: atelier.id }); await wait(5);
      const d2 = await A.newDesign('Drill', { app: 'shaper', projectId: bits.id }); await wait(5);
      const out = {};
      out.projects = (await A.listProjects()).map(p => p.name + (p.pinned ? '*' : ''));
      out.recent = (await A.listRecent()).map(d => d.name + '@' + d.projectName);
      out.noBodies = (await A.listRecent()).every(d => !('document' in d));
      // two tabs save different hosts into the SAME design: both sidecars survive (458, per design)
      const doc = (hosts) => ({ ...emptyDocument(), hosts });
      await A.save(doc({ penplotter: { pens: 3 } }), { app: 'penplotter', id: d1.id });
      await B.save(doc({ shaper: { cut: 'inside' } }), { app: 'shaper', id: d1.id });
      await B.save(doc({}), { app: 'sketchstudio', id: d1.id });
      out.hosts = Object.keys((await A.get(d1.id)).document.hosts).sort();
      await A.moveDesign(d1.id, bits.id);
      out.moved = (await B.listDesigns(bits.id)).map(d => d.name).sort();
      out.refused = await A.removeProject(bits.id).then(() => 'removed', (e) => e.message);
      await A.rename(d2.id, 'Drill 2'); await A.duplicate(d2.id);
      out.afterDup = (await A.listRecent()).map(d => d.name).sort();
      await A.remove(d2.id);
      out.afterRemove = (await A.listRecent()).map(d => d.name).sort();
      await until(() => pings >= 8, 100);
      out.pings = pings;
      return JSON.stringify(out);
    })()`));
    console.log('idb crud:', JSON.stringify(crud));
    assert.deepStrictEqual(crud.projects, ['Atelier*', 'Bits', 'My Designs'], 'pinned first, then newest change');
    assert.deepStrictEqual(crud.recent.slice(0, 2), ['Drill@Bits', 'Shelf@Atelier'], 'recent spans projects, newest first');
    assert.strictEqual(crud.noBodies, true, 'listing never carries document bodies');
    assert.deepStrictEqual(crud.hosts, ['penplotter', 'shaper'], 'two tabs, two hosts: both sidecars kept, a host-less save deleted none');
    assert.deepStrictEqual(crud.moved, ['Drill', 'Shelf'], 'the moved design is listed in its new project');
    assert(/still holds 2 designs/.test(crud.refused), 'a non-empty project is not deleted: ' + crud.refused);
    assert(crud.afterDup.includes('Drill 2') && crud.afterDup.includes('Drill 2 copy'), 'rename + duplicate: ' + crud.afterDup);
    assert(!crud.afterRemove.includes('Drill 2') && crud.afterRemove.includes('Drill 2 copy'), 'remove deletes only that design');
    assert(crud.pings >= 8, 'subscribe fired for local changes: ' + crud.pings);

    // ---- 3. cross-tab notification: a change made through ANOTHER store instance (another tab's channel) reaches subscribers
    const ping = await evalJs(`(async () => {
      const { createProjectStore, createIdbAdapter } = await import('/packages/ui/project-store.js');
      const A = createProjectStore({ adapter: createIdbAdapter() });
      const B = createProjectStore({ adapter: createIdbAdapter() });
      let n = 0; A.subscribe(() => n++);
      await B.createProject('From another tab');
      await new Promise((res) => { const t0 = Date.now(); const tick = () => (n >= 1 || Date.now() - t0 > 300 ? res() : setTimeout(tick, 10)); tick(); });
      return n;
    })()`);
    assert(ping >= 1, 'a change in another tab notifies this tab (BroadcastChannel): ' + ping);
    console.log('project-store-idb: ok');
  } finally {
    await cdp.close();
  }
})();
