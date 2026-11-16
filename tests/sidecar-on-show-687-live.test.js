// tests/sidecar-on-show-687-live.test.js — TASK 687 (live, real pointer events, fake Google Drive only):
// Opening / visiting a design in Pen Plotter or Trace without changing anything must NOT write their default sidecar
// into the shared buffer, store, or Drive, must NOT show the unsaved dot, and a later SketchStudio save must NOT
// persist unedited hosts.penplotter / hosts.trace sidecars. Editing a host setting (e.g. + Pen in Pen Plotter)
// MUST persist that host's sidecar.
import assert from 'node:assert';
import { launchBrowser, sendRealKey, sleep } from './helpers/cdp-browser.js';
import { installFakeDriveSession } from './helpers/fake-drive-session.js';
import { resetBufferLive } from './helpers/reset-buffer.js';
import { pressRibbonTool } from './helpers/ribbon-tool.js';

const STORE = `import('/packages/ui/project-store.js').then((m) => m.getProjectStore())`;
const CANVAS = { sketchstudio: 'svgCanvas', shaper: 'design-canvas', penplotter: 'design-canvas', trace: 'design-canvas' };

await (async () => {
  const cdp = await launchBrowser({ tag: '687', width: 1280, height: 800 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, waitFor, navigate, waitForApp } = cdp;
  const session = await installFakeDriveSession(cdp);
  try {
    await resetBufferLive(cdp);

    const tapMouse = async (p) => {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'none', clickCount: 0 });
      await sleep(30);
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 1 });
      await sleep(35);
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', buttons: 0, clickCount: 1 });
      await sleep(220);
    };
    const clickSel = async (sel, i = 0) => {
      const c = await evalJs(`(() => {
        const e = document.querySelectorAll(${JSON.stringify(sel)})[${i}];
        if (!e) return null;
        e.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        const r = e.getBoundingClientRect();
        return r.width > 0 ? { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } : null;
      })()`);
      assert(c, `element exists for click: ${sel}`);
      await tapMouse(c);
    };
    const openMenu = async () => {
      const open = `(() => { const g = document.querySelector('.sk-sidebar-goto'); if (!g) return false; const r = g.getBoundingClientRect(); return r.width > 0 && r.left >= 0 && r.left < innerWidth; })()`;
      if (!(await evalJs(open))) await clickSel('.sk-sidebar-btn');
      await waitFor(open, 'sidebar menu opens');
    };
    const goTo = async (app) => {
      await openMenu();
      await clickSel(`.sk-sidebar-goto [data-app="${app}"]`);
      await waitFor(`location.pathname.startsWith('/apps/${app}/')`, `GO TO ${app}`);
      await waitForApp(CANVAS[app]);
      await sleep(2200); // > 1500ms autosave poll interval to expose any post-show mutation or poll write
    };
    const inspect = async (label, designName = 'Probe687') => {
      const pageState = await evalJs(`${STORE}.then(async (s) => {
        const buf = await s.readBuffer({});
        const tab = buf && buf.tabs ? buf.tabs.find((x) => x.name === ${JSON.stringify(designName)}) : null;
        const cur = await s.current();
        const stored = cur ? await s.get(cur.id) : null;
        const dotEl = document.querySelector('.sk-doctab.active .sk-doctab-dot:not(.saving)');
        return {
          path: location.pathname,
          activeTab: document.querySelector('.sk-doctab.active .sk-doctab-name')?.textContent || null,
          unsavedDot: !!dotEl,
          bufferTabExists: !!tab,
          bufferHosts: tab && tab.doc && tab.doc.hosts ? tab.doc.hosts : null,
          storeHosts: stored && stored.document && stored.document.hosts ? stored.document.hosts : null,
        };
      })`);
      const driveFile = [...session.drive.files.values()].find((f) => f.name === `${designName}.sketch.json` && !f.trashed);
      const driveDoc = driveFile ? JSON.parse(driveFile.content).document : null;
      const out = {
        label,
        ...pageState,
        bufferHostKeys: pageState.bufferHosts ? Object.keys(pageState.bufferHosts) : null,
        storeHostKeys: pageState.storeHosts ? Object.keys(pageState.storeHosts) : null,
        driveHostKeys: driveDoc && driveDoc.hosts ? Object.keys(driveDoc.hosts) : null,
        driveHosts: driveDoc ? driveDoc.hosts : null,
      };
      console.log(`PROBE[${label}] keys=${JSON.stringify({ buffer: out.bufferHostKeys, store: out.storeHostKeys, drive: out.driveHostKeys, dot: out.unsavedDot })}`);
      if (out.bufferHosts && Object.keys(out.bufferHosts).length) console.log(`PROBE[${label}] bufferHosts=${JSON.stringify(out.bufferHosts)}`);
      if (out.storeHosts && Object.keys(out.storeHosts).length) console.log(`PROBE[${label}] storeHosts=${JSON.stringify(out.storeHosts)}`);
      return out;
    };

    // 1. SketchStudio: draw a line, save it as Probe687
    await navigate(`http://127.0.0.1:${port}/apps/sketchstudio/index.html`, 10000);
    await waitForApp('svgCanvas');
    await waitFor(`document.querySelectorAll('#svgCanvas').length === 1 && document.querySelector('#svgCanvas').dataset.docReady === '1'`, 'studio docReady');
    const cr = await evalJs(`(() => { const r = document.getElementById('svgCanvas').getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height }; })()`);
    const p1 = { x: Math.round(cr.l + cr.w * 0.42), y: Math.round(cr.t + cr.h * 0.5) };
    const p2 = { x: Math.round(cr.l + cr.w * 0.60), y: Math.round(cr.t + cr.h * 0.5) };
    const p3 = { x: Math.round(cr.l + cr.w * 0.60), y: Math.round(cr.t + cr.h * 0.64) };
    await pressRibbonTool(evalJs, tapMouse, 'tool-line');
    await tapMouse(p1);
    await tapMouse(p2);
    await sendRealKey(send, 'Escape', 'Escape', 27);
    await waitFor(`document.querySelectorAll('#svgCanvas .shape-elem').length === 1`, 'line drawn');

    await openMenu();
    await clickSel('[data-action="save-as"]');
    await waitFor(`!!document.querySelector('.sk-sidebar-input')`, 'Save as input opens');
    await evalJs(`document.querySelector('.sk-sidebar-input').value = 'Probe687'`);
    await clickSel('.sk-sidebar-confirm-btns .ok');
    await waitFor(`document.querySelector('.sk-doctab.active .sk-doctab-name')?.textContent === 'Probe687'`, 'Probe687 saved & named');
    await evalJs(`${STORE}.then((s) => s.flushDrive())`);
    await sleep(300);

    const beforeVisits = await inspect('beforeVisits');
    assert.deepStrictEqual(beforeVisits.bufferHostKeys, [], 'before visits: buffer has empty hosts');
    assert.deepStrictEqual(beforeVisits.storeHostKeys, [], 'before visits: store has empty hosts');
    assert.deepStrictEqual(beforeVisits.driveHostKeys, [], 'before visits: Drive has empty hosts');
    assert.strictEqual(beforeVisits.unsavedDot, false, 'before visits: no unsaved dot');

    // 2. GO TO Pen Plotter, change nothing
    await goTo('penplotter');
    const afterPenPlotter = await inspect('afterPenPlotter');

    // 3. GO TO Trace, change nothing
    await goTo('trace');
    const afterTrace = await inspect('afterTrace');

    // 4. GO TO SketchStudio, verify state after visits, then draw another line and save
    await goTo('sketchstudio');
    const afterStudioReturn = await inspect('afterStudioReturn');

    // Assert a & b on the round trip
    assert.deepStrictEqual(afterPenPlotter.bufferHostKeys, [], 'a) after Pen Plotter visit: buffer hosts keys unchanged ([])');
    assert.deepStrictEqual(afterPenPlotter.storeHostKeys, [], 'a) after Pen Plotter visit: store hosts keys unchanged ([])');
    assert.strictEqual(afterPenPlotter.unsavedDot, false, 'b) after Pen Plotter visit: no unsaved dot');
    assert.deepStrictEqual(afterTrace.bufferHostKeys, [], 'a) after Trace visit: buffer hosts keys unchanged ([])');
    assert.deepStrictEqual(afterTrace.storeHostKeys, [], 'a) after Trace visit: store hosts keys unchanged ([])');
    assert.strictEqual(afterTrace.unsavedDot, false, 'b) after Trace visit: no unsaved dot');
    assert.deepStrictEqual(afterStudioReturn.bufferHostKeys, [], 'a) back in SketchStudio: buffer hosts keys unchanged ([])');
    assert.strictEqual(afterStudioReturn.unsavedDot, false, 'b) back in SketchStudio: no unsaved dot');

    // c) Make a geometry edit in SketchStudio and let it save -> still NO hosts.penplotter / hosts.trace
    await pressRibbonTool(evalJs, tapMouse, 'tool-line');
    await tapMouse(p2);
    await tapMouse(p3);
    await sendRealKey(send, 'Escape', 'Escape', 27);
    await waitFor(`document.querySelectorAll('#svgCanvas .shape-elem').length === 2`, 'second line drawn');
    await evalJs(`window.dispatchEvent(new Event('pagehide'))`);
    await sleep(400);
    await evalJs(`${STORE}.then((s) => s.flushDrive())`);
    await sleep(300);
    const afterLaterSave = await inspect('afterLaterStudioSave');
    assert.deepStrictEqual(afterLaterSave.bufferHostKeys, [], 'c) after later SketchStudio save: buffer has no penplotter/trace sidecars');
    assert.deepStrictEqual(afterLaterSave.storeHostKeys, [], 'c) after later SketchStudio save: store has no penplotter/trace sidecars');
    assert.deepStrictEqual(afterLaterSave.driveHostKeys, [], 'c) after later SketchStudio save: Drive has no penplotter/trace sidecars');

    // 5. Real edit in Pen Plotter (+ Pen on Toolpath tab) DOES persist hosts.penplotter
    await goTo('penplotter');
    await clickSel('.sk-header-tab[data-tab="toolpath"]');
    await waitFor(`!!document.getElementById('addPlotColor')`, 'Toolpath stage + Pen button visible');
    await clickSel('#addPlotColor');
    await waitFor(`document.querySelectorAll('#plotColors .pc-row').length >= 1`, 'new pen added');
    await sleep(2000);
    await evalJs(`window.dispatchEvent(new Event('pagehide'))`);
    await sleep(300);
    await evalJs(`${STORE}.then((s) => s.flushDrive())`);
    await sleep(300);
    const afterPenAdd = await inspect('afterPenAdd');
    assert(afterPenAdd.bufferHostKeys.includes('penplotter'), 'editing Pen Plotter writes hosts.penplotter to buffer');
    assert(afterPenAdd.storeHostKeys.includes('penplotter'), 'editing Pen Plotter writes hosts.penplotter to store');
    assert(afterPenAdd.driveHostKeys.includes('penplotter'), 'editing Pen Plotter writes hosts.penplotter to Drive');
    assert(!afterPenAdd.bufferHostKeys.includes('trace'), 'Trace sidecar still absent');

    // 5b. Unsaved Untitled in Pen Plotter: initially NO dot & NO sidecar, + Pen turns ON the unsaved dot and writes hosts.penplotter
    await clickSel('.sk-doctab-new');
    await waitFor(`!!document.querySelector('.sk-tp-card')`, 'template modal opens on + tab');
    await clickSel('.sk-tp-card', 0);
    await waitFor(`document.querySelectorAll('.sk-doctab').length === 2`, 'new Untitled tab created');
    assert.strictEqual(await evalJs(`!!document.querySelector('.sk-doctab.active .sk-doctab-dot:not(.saving)')`), false, 'fresh Untitled in Pen Plotter has NO unsaved dot');
    await clickSel('#addPlotColor');
    await waitFor(`!!document.querySelector('.sk-doctab.active .sk-doctab-dot:not(.saving)')`, 'adding a pen on Untitled shows the unsaved dot');
    await waitFor(`${STORE}.then(async (s) => { const b = await s.readBuffer({}); const t = b && b.tabs && b.tabs.find((x) => !x.designId); return !!(t && t.doc && t.doc.hosts && t.doc.hosts.penplotter); })`, 'edited Untitled writes hosts.penplotter to shared buffer');
    // Switch back to Probe687 before going to Trace
    await clickSel('.sk-doctab-main', 0);
    await waitFor(`document.querySelector('.sk-doctab.active .sk-doctab-name')?.textContent === 'Probe687'`, 'Probe687 active again');

    // 6. Real edit in Trace (switch color mode via real click) DOES persist hosts.trace
    await goTo('trace');
    await clickSel('.sk-header-tab[data-tab="trace"]');
    await waitFor(`!!document.querySelector('.color-mode-btn:not(.active)')`, 'Trace tab color mode button visible');
    await clickSel('.color-mode-btn:not(.active)');
    await sleep(2000);
    await evalJs(`window.dispatchEvent(new Event('pagehide'))`);
    await sleep(300);
    await evalJs(`${STORE}.then((s) => s.flushDrive())`);
    await sleep(300);
    const afterTraceEdit = await inspect('afterTraceEdit');
    assert(afterTraceEdit.bufferHostKeys.includes('trace'), 'editing Trace writes hosts.trace to buffer');
    assert(afterTraceEdit.storeHostKeys.includes('trace'), 'editing Trace writes hosts.trace to store');
    assert(afterTraceEdit.driveHostKeys.includes('trace'), 'editing Trace writes hosts.trace to Drive');

    console.log('sidecar-on-show-687-live: ok');
  } finally {
    await cdp.close();
  }
})();
