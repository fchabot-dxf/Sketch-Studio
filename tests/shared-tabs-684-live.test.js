// tests/shared-tabs-684-live.test.js — TASK 684 (owner turns 1768-1775: "why don't all tabs carry over ... yes why not?"): ONE list of open document tabs
// for all four apps, in the REAL pages with real pointer events (a mouse at 1400 x 800, then a phone at 390 x 844 with touch taps).
//   SketchStudio: a SAVED design (opened from Open recent) and an UNSAVED one with content (+ -> the Hexagon template), the saved one active.
//   Shaper (opened by its address on the same origin): the same two tabs, the same active one, Shaper's Design canvas shows the design; a cut plan (Pocket) on
//   the saved design in Prepare, and one on the unsaved design; Pen Plotter: the same tabs; SketchStudio: the geometry of both is unchanged and Shaper's cut
//   plan is still in both documents (the saved one in the store, the unsaved one in the shared buffer); Trace: the same tabs; Shaper again: both cut plans.
//   TASK 696: the sidebar's GO TO is gone (each app is its own website, so on the published sites the tabs are one list per app); the local dev server
//   still serves the four apps on ONE origin, where the buffer is shared: each next app is opened by its address after the page wrote its tabs.
//   A Trace photo-tracing document (mouse): its traced drawing (Send to Editor) shows in SketchStudio and Shaper; back in Trace it opens in Edit with the drawing,
//   the photo is gone (it is never stored, TASK 567: only Trace's page memory holds it).
// EVIDENCE_DIR (optional): cropped screenshots of the tab row in each app.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';
import { installFakeDriveSession } from './helpers/fake-drive-session.js';
import { resetBufferLive } from './helpers/reset-buffer.js';
import { storedRecords } from './helpers/stored-records.js'; // TASK S1: the saved sidecar (version 3) read as per-shape records

const STORE = `import('/packages/ui/project-store.js').then((m) => m.getProjectStore())`;
const CANVAS = { sketchstudio: 'svgCanvas', shaper: 'design-canvas', penplotter: 'design-canvas', trace: 'design-canvas' };
// The page writes its open tabs (its own pagehide flush), the shared buffer is read until two reads 400 ms apart agree (the write landed), then the next
// app's page is opened by its address on the same origin (TASK 696: the sidebar's GO TO is gone).
const openNext = async ({ evalJs, flushAutosave, navigate, waitForApp, port }, app) => {
  await flushAutosave();
  let last = null;
  for (let k = 0; k < 40; k++) { const now = await evalJs(`${STORE}.then(async (s) => JSON.stringify(await s.readBuffer({})))`); if (now === last) break; last = now; await sleep(400); }
  await navigate(`http://127.0.0.1:${port}/apps/${app}/index.html`, 10000);
  await waitForApp(CANVAS[app]);
};

await (async () => {
  const cdp = await launchBrowser({ tag: '684', width: 1400, height: 800 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, waitFor, navigate, waitForApp, flushAutosave } = cdp;
  await installFakeDriveSession(cdp);
  try {
    for (const mode of ['desktop', 'phone']) {
      const phone = mode === 'phone';
      const T = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i, radiusX: 1, radiusY: 1, force: 1 })) });
      const pressAt = async (c) => {
        if (phone) { await T('touchStart', [c]); await sleep(40); await T('touchEnd', []); await sleep(350); return; }
        await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: c.x, y: c.y, button: 'none', clickCount: 0 }); await sleep(30);
        await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: c.x, y: c.y, button: 'left', buttons: 1, clickCount: 1 }); await sleep(30);
        await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: c.x, y: c.y, button: 'left', buttons: 0, clickCount: 1 }); await sleep(300);
      };
      const center = async (sel, i = 0) => {
        await evalJs(`(() => { const e = document.querySelectorAll('${sel}')[${i}]; if (e) e.scrollIntoView({ block: 'nearest', inline: 'nearest' }); })()`); await sleep(80);
        const c = await evalJs(`(() => { const e = document.querySelectorAll('${sel}')[${i}]; if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
        assert(c, mode + ': ' + sel + ' #' + i + ' exists'); return c;
      };
      const press = async (sel, i = 0) => pressAt(await center(sel, i));
      const names = () => evalJs(`[...document.querySelectorAll('.sk-doctab-name')].map((e) => e.textContent)`);
      const activeName = () => evalJs(`(() => { const a = document.querySelector('.sk-doctab.active .sk-doctab-name'); return a && a.textContent; })()`);
      const dots = () => evalJs(`[...document.querySelectorAll('.sk-doctab')].map((t) => !!t.querySelector('.sk-doctab-dot:not(.saving)'))`); // the not-saved dot (a stored design's Drive write in flight shows a 'saving' one)
      const shapes = (app) => evalJs(`document.querySelectorAll('#${CANVAS[app]} .shape-elem').length`);
      const menuOpen = `(() => { const g = document.querySelector('.sk-sidebar-actions'); if (!g) return false; const r = g.getBoundingClientRect(); return r.width > 0 && r.left >= 0 && r.left < innerWidth; })()`;
      const openMenu = async () => { if (!(await evalJs(menuOpen))) await press(phone ? '.sk-sidebar-chevron' : '.sk-sidebar-btn'); await waitFor(menuOpen, mode + ': the menu'); };
      const shot = async (name) => {
        if (!process.env.EVIDENCE_DIR) return;
        const r = await evalJs(`(() => { const r = document.querySelector('.sk-doctabs').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()`);
        const s = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: Math.max(0, r.y - 8), width: Math.min(r.w, phone ? 390 : 700), height: r.h + 16, scale: 2 } });
        fs.writeFileSync(path.join(process.env.EVIDENCE_DIR, `${mode}-${name}.png`), Buffer.from(s.data, 'base64'));
      };
      const stage = async (id) => { // a host's stage: the header tab with a mouse, the drawer's stage list on a phone (no header bar there)
        if (phone) { await openMenu(); await press(`.sk-sidebar-stage[data-tab="${id}"]`); if (await evalJs(menuOpen)) await press('.sk-sidebar-chevron'); }
        else await press(`.sk-header-tab[data-tab="${id}"]`);
        await sleep(400);
      };
      const visit = async (app) => {
        await openNext(cdp, app);
        await waitFor(`document.querySelectorAll('.sk-doctab-name').length === 2`, `${mode}: ${app} shows the two tabs`);
        assert.deepStrictEqual(await names(), ['Saved plate', 'Hexagon'], `${mode}: ${app}: the same tabs, same order`);
        assert.strictEqual(await activeName(), 'Saved plate', `${mode}: ${app}: the same active tab`);
        assert.deepStrictEqual(await dots(), [false, true], `${mode}: ${app}: the unsaved Hexagon keeps its not-saved dot, the saved one has none`);
      };
      // a tab press; the strip re-renders when a tab's save dot changes (an autosave just ran) and an outside press first closes an open menu: press again until it is active
      const activate = async (i, name) => {
        const isActive = `(() => { const a = document.querySelector('.sk-doctab.active .sk-doctab-name'); return !!a && a.textContent === ${JSON.stringify(name)}; })()`;
        for (let k = 0; k < 4 && !(await evalJs(isActive)); k++) { await press('.sk-doctab-main', i); await sleep(300); }
        await waitFor(isActive, `${mode}: the ${name} tab is active`);
      };
      const bufTab = (name) => evalJs(`${STORE}.then(async (s) => { const b = await s.readBuffer({}); const t = b && b.tabs.find((x) => x.name === ${JSON.stringify(name)}); return t ? JSON.parse(JSON.stringify(t.doc)) : null; })`);
      const geom = (doc) => JSON.stringify({ shapes: doc.geometry.shapes.map((x) => [x.id, x.type, x.joints]), joints: doc.geometry.joints.map(([id, j]) => [id, Math.round(j.x * 1e6) / 1e6, Math.round(j.y * 1e6) / 1e6]) });
      const centreOf = (doc) => { const js = doc.geometry.joints.filter(([id]) => id !== 'j_origin').map(([, j]) => j); return { x: js.reduce((a, j) => a + j.x, 0) / js.length, y: js.reduce((a, j) => a + j.y, 0) / js.length }; };
      const cutPlan = () => evalJs(`import('/tests/helpers/plan-v2.js').then((m) => [...m.V2_PLAN.values()].map((r) => r.cutType))`);
      const pocketAt = async (doc, what) => { // Prepare: a press inside the loop, then the cut type menu -> Pocket (real pointer)
        await waitFor(`document.getElementById('prepare-canvas').children.length > 0`, `${mode}: Prepare is mounted`);
        const c = centreOf(doc);
        const p = await evalJs(`import('/packages/ui/coords.js').then((m) => { const p = m.worldToScreen(document.getElementById('prepare-canvas'), ${JSON.stringify(c)}); return { x: Math.round(p.x), y: Math.round(p.y) }; })`);
        await pressAt(p);
        await press('.cut-type-trigger');
        await waitFor(`!!document.querySelector('.cut-type-opt[data-id="pocket"]')`, `${mode}: the cut type menu (${what})`);
        await press('.cut-type-opt[data-id="pocket"]');
        await waitFor(`import('/tests/helpers/plan-v2.js').then((m) => [...m.V2_PLAN.values()].some((r) => r.cutType === 'pocket'))`, `${mode}: a Pocket on ${what}`);
      };

      // ---- SketchStudio: the saved design + an unsaved one with content -------------------------------------------------------------------------------
      await resetBufferLive(cdp);
      if (phone) {
        await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenOrientation: { type: 'portraitPrimary', angle: 0 } });
        await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
      }
      await navigate(`http://127.0.0.1:${port}/apps/sketchstudio/index.html`, 10000);
      await waitForApp('svgCanvas');
      await waitFor(`document.querySelectorAll('.sk-doctab-name').length === 1`, mode + ': one tab');
      const savedId = await evalJs(`Promise.all([${STORE}, import('/packages/core/templates.js')]).then(async ([s, t]) => {
        const doc = t.buildTemplate(t.TEMPLATES.find((x) => x.id === 'rounded-rectangle'));
        const d = await s.newDesign('Saved plate', { app: 'sketchstudio', document: doc }); return d.id; })`);
      await openMenu(); await press('[data-action="open-recent"]');
      await waitFor(`!!document.querySelector('.sk-pm-tile[data-design="${savedId}"]')`, mode + ': the saved design in Open recent');
      await press(`.sk-pm-tile[data-design="${savedId}"]`);
      await waitFor(`document.querySelector('.sk-doctab.active .sk-doctab-name') && document.querySelector('.sk-doctab.active .sk-doctab-name').textContent === 'Saved plate'`, mode + ': the saved design is open');
      await press('.sk-doctab-new');
      await waitFor(`!!document.querySelector('.sk-tp-card[data-template="hexagon"]')`, mode + ': the template modal');
      await press('.sk-tp-card[data-template="hexagon"]');
      await waitFor(`!!document.querySelector('.sk-tp-start[data-template="hexagon"]')`, mode + ': the Hexagon start view');
      await press('.sk-tp-open');
      await waitFor(`document.querySelectorAll('.sk-doctab-name').length === 2 && !document.querySelector('.sk-tp-backdrop')`, mode + ': the unsaved Hexagon in a new tab');
      assert.deepStrictEqual(await names(), ['Saved plate', 'Hexagon'], mode + ': Studio: a saved and an unsaved tab');
      const hexShapes = await shapes('sketchstudio');
      assert(hexShapes >= 6, mode + ': the Hexagon is drawn: ' + hexShapes);
      await activate(0, 'Saved plate');
      const plateShapes = await shapes('sketchstudio');
      assert(plateShapes >= 8, mode + ': the Saved plate is drawn: ' + plateShapes);
      assert.deepStrictEqual(await dots(), [false, true], mode + ': Studio: the unsaved Hexagon has its dot');
      await shot('1-sketchstudio');
      const plateBefore = await evalJs(`${STORE}.then(async (s) => JSON.parse(JSON.stringify((await s.get(${JSON.stringify(savedId)})).document)))`);

      // ---- Shaper: the same tabs; a Pocket on each design ------------------------------------------------------------------------------------------------
      await visit('shaper');
      await stage('design');
      await waitFor(`document.querySelectorAll('#design-canvas .shape-elem').length === ${plateShapes}`, `${mode}: Shaper's Design canvas shows the Saved plate (${plateShapes} shapes)`);
      await shot('2-shaper');
      const hexBefore = await bufTab('Hexagon');
      assert(hexBefore, mode + ': the unsaved Hexagon is in the shared buffer');
      await stage('prepare');
      await pocketAt(plateBefore, 'the Saved plate');
      await activate(1, 'Hexagon');
      assert.deepStrictEqual(await cutPlan(), [], mode + ': the Hexagon has no cut plan yet (its own document)');
      await pocketAt(hexBefore, 'the unsaved Hexagon');
      await activate(0, 'Saved plate');
      assert.deepStrictEqual(await cutPlan(), ['pocket'], mode + ': the Saved plate keeps its own Pocket');

      // ---- Pen Plotter: the same tabs --------------------------------------------------------------------------------------------------------------------
      await visit('penplotter');
      await shot('3-penplotter');

      // ---- SketchStudio: the geometry unchanged, Shaper's cut plans in both documents ------------------------------------------------------------------
      await visit('sketchstudio');
      await waitFor(`document.querySelectorAll('#svgCanvas .shape-elem').length === ${plateShapes}`, `${mode}: Studio shows the Saved plate again`);
      await shot('4-sketchstudio-back');
      const plateAfter = await evalJs(`${STORE}.then(async (s) => JSON.parse(JSON.stringify((await s.get(${JSON.stringify(savedId)})).document)))`);
      assert.strictEqual(geom(plateAfter), geom(plateBefore), mode + ': the Saved plate geometry is unchanged after Shaper and Pen Plotter');
      const plateCuts = storedRecords(plateAfter.hosts.shaper || {}).map(([, r]) => r.cutType); // TASK S1: the saved sidecar is version 3
      assert.deepStrictEqual(plateCuts, ['pocket'], mode + ": Shaper's cut plan is in the saved design: " + JSON.stringify(plateAfter.hosts));
      const hexAfter = await bufTab('Hexagon');
      assert.strictEqual(geom(hexAfter), geom(hexBefore), mode + ': the unsaved Hexagon geometry is unchanged');
      assert.deepStrictEqual(storedRecords(hexAfter.hosts.shaper || {}).map(([, r]) => r.cutType), ['pocket'], mode + ": Shaper's cut plan is in the unsaved design (shared buffer)");
      await activate(1, 'Hexagon');
      await waitFor(`document.querySelectorAll('#svgCanvas .shape-elem').length === ${hexShapes}`, `${mode}: Studio shows the unsaved Hexagon`);
      await activate(0, 'Saved plate');

      // ---- Trace: the same tabs ----------------------------------------------------------------------------------------------------------------------
      await visit('trace');
      await shot('5-trace');

      // ---- Shaper again: both cut plans are there --------------------------------------------------------------------------------------------------------
      await visit('shaper');
      await stage('prepare');
      await waitFor(`import('/tests/helpers/plan-v2.js').then((m) => m.V2_PLAN.size === 1)`, mode + ': reopened Shaper: the Saved plate cut plan');
      assert.deepStrictEqual(await cutPlan(), ['pocket'], mode + ': reopened Shaper: the Saved plate has its Pocket');
      await activate(1, 'Hexagon');
      await waitFor(`import('/tests/helpers/plan-v2.js').then((m) => [...m.V2_PLAN.values()].length === 1)`, mode + ': reopened Shaper: the Hexagon cut plan');
      assert.deepStrictEqual(await cutPlan(), ['pocket'], mode + ': reopened Shaper: the unsaved Hexagon has its Pocket');
      console.log(`${mode}: Studio -> Shaper -> Pen Plotter -> Studio -> Trace -> Shaper: same 2 tabs + active, ${plateShapes} / ${hexShapes} shapes, both Pockets kept`);
      if (phone) { await send('Emulation.setTouchEmulationEnabled', { enabled: false }); await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 800, deviceScaleFactor: 1, mobile: false }); }
    }
    // ---- a Trace photo-tracing document in the other apps (mouse): its traced drawing shows; the photo stays in Trace's memory only (TASK 567) --------------
    {
      const click = async (sel) => {
        await evalJs(`(() => { const e = document.querySelector('${sel}'); if (e) e.scrollIntoView({ block: 'nearest', inline: 'nearest' }); })()`); await sleep(80); // Send to Editor sits below the fold of the Trace panel
        const c = await evalJs(`(() => { const e = document.querySelector('${sel}'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
        assert(c, sel + ' exists');
        await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: c.x, y: c.y, button: 'none', clickCount: 0 }); await sleep(30);
        await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: c.x, y: c.y, button: 'left', buttons: 1, clickCount: 1 }); await sleep(30);
        await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: c.x, y: c.y, button: 'left', buttons: 0, clickCount: 1 }); await sleep(300);
      };
      const visit = (app) => openNext(cdp, app);
      await resetBufferLive(cdp);
      await navigate(`http://127.0.0.1:${port}/apps/trace/index.html`, 10000);
      await waitForApp('design-canvas');
      await click('.sk-header-tab[data-tab="trace"]');
      await evalJs(`(async () => { const w = 600, h = 400; const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d');
        x.fillStyle = '#eee'; x.fillRect(0, 0, w, h); x.fillStyle = '#000'; x.fillRect(150, 100, 300, 200);
        const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9)); const dt = new DataTransfer(); dt.items.add(new File([blob], 'plate.jpg', { type: 'image/jpeg' }));
        const i = document.getElementById('file-input'); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true })); })()`); // the photo chooser's file (a test cannot drive the OS picker)
      await waitFor(`document.getElementById('original-canvas').width === 600 && !document.getElementById('btn-send-to-edit').disabled`, 'the photo was traced', 30000);
      await click('#btn-send-to-edit');
      await waitFor(`document.querySelectorAll('#design-canvas .shape-elem').length > 0`, 'Send to Editor: the traced drawing in Edit');
      const traced = await evalJs(`document.querySelectorAll('#design-canvas .shape-elem').length`);
      await visit('sketchstudio');
      await waitFor(`document.querySelectorAll('#svgCanvas .shape-elem').length === ${traced}`, `SketchStudio shows the traced drawing (${traced} shapes)`);
      assert.strictEqual(await evalJs(`document.querySelectorAll('.sk-doctab').length`), 1, 'the Trace document is the one tab');
      assert.strictEqual(await evalJs(`!!document.querySelector('.sk-doctab.active .sk-doctab-dot')`), true, 'unsaved, with content: its dot');
      await visit('shaper');
      await click('.sk-header-tab[data-tab="design"]'); // Shaper's own stage (it kept Prepare from above)
      await waitFor(`document.querySelectorAll('#design-canvas .shape-elem').length === ${traced}`, 'Shaper has the traced drawing in its Design canvas');
      await visit('trace');
      await waitFor(`document.querySelectorAll('#design-canvas .shape-elem').length === ${traced} && document.querySelector('.sk-header-tab.active').dataset.tab === 'edit'`, 'back in Trace: the drawing, in Edit');
      assert.strictEqual(await evalJs(`document.getElementById('original-canvas').width`), 0, 'back in Trace: the photo was not kept (never stored, TASK 567)');
      console.log(`trace document: ${traced} traced shapes shown in SketchStudio and Shaper; back in Trace: Edit with the drawing, no photo`);
    }
    console.log('shared-tabs-684-live: ok');
  } finally { await cdp.close(); }
})();
