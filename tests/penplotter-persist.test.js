// tests/penplotter-persist.test.js — TASK 451: the Pen Plotter's own document survives a REAL page reload.
// Live headless CDP: import an SVG, build pens/toolpaths/settings/styles + a non-default doc size, wait for the autosave,
// reload the page, and compare the persisted plotter document, the exported G-code (byte-identical) and the panels.
// Then strip the host sidecar from the saved design (an OLD document) and reload: defaults, geometry kept.

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="80mm" viewBox="0 0 100 80">'
  + '<path d="M10 10 L40 10 L40 30 Z" stroke="#ff0000" fill="none"/>'
  + '<circle cx="70" cy="25" r="12" stroke="#0000ff" fill="#00ff00"/></svg>';

await (async () => {
  const cdp = await launchBrowser({ tag: '451' });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, once, evalJs, waitFor, navigate, userDir } = cdp;
  const svgPath = path.join(userDir, 'persist.svg');
  fs.writeFileSync(svgPath, SVG);

  try {
    await send('DOM.enable');
    const click = async (x, y) => {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', clickCount: 0 }); await sleep(30);
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 }); await sleep(30);
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 }); await sleep(150);
    };
    const clickEl = async (sel) => {
      const c = await evalJs(`(() => { const e = document.querySelector('${sel}'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) }; })()`);
      assert(c, sel + ' not found');
      await click(c.x, c.y);
    };
    const appReady = `!!window.__sketch && !!document.querySelector('.stage-btn.active')`;
    const restored = `${appReady} && window.__sketch.controller.state.shapes.length > 0`;
    const load = async () => {
      await navigate(`http://127.0.0.1:${port}/apps/penplotter/index.html`, 8000);
      await waitFor(appReady, 'penplotter app ready');
    };
    const reload = async () => {
      const loaded = once('Page.loadEventFired');
      await send('Page.reload');
      await Promise.race([loaded, sleep(8000)]);
      await waitFor(restored, 'the saved document restored after reload');
    };
    const waitSaved = () => waitFor(`document.getElementById('save-status').textContent === 'Saved'`, 'autosave to report Saved', 10000);
    const observe = () => evalJs(`(async () => {
      const { capturePlotterDoc } = await import('/apps/penplotter/src/plotter-doc.js');
      const { buildGcodeEntries } = await import('/apps/penplotter/src/export.js');
      return JSON.stringify({
        plotter: capturePlotterDoc(),
        shapes: window.__sketch.controller.state.shapes.length,
        gcode: buildGcodeEntries(),
        penRows: document.querySelectorAll('#plotColors .pc-row').length,
        docInfo: (document.getElementById('docInfo') || {}).textContent || '',
        stage: document.querySelector('.stage-btn.active').dataset.stage,
        drawFeedInput: (document.getElementById('drawFeed') || {}).value,
      });
    })()`).then(JSON.parse);

    await load();
    // Import the SVG through the real file input (a real file chooser result).
    const root = await send('DOM.getDocument');
    const q = await send('DOM.querySelector', { nodeId: root.nodeId !== undefined ? root.nodeId : root.root.nodeId, selector: '#importSvgFile' });
    await send('DOM.setFileInputFiles', { nodeId: q.nodeId, files: [svgPath] });
    await waitFor(`window.__sketch.controller.state.shapes.length > 0`, 'SVG import produced geometry');
    // Build the plotter state: a real click on + Pen, then toolpaths/settings/styles (test setup, not the gesture under test).
    await clickEl('.stage-btn[data-stage="toolpath"]');
    await waitFor(`document.querySelector('.stage-btn[data-stage="toolpath"]').classList.contains('active') && !!document.getElementById('addPlotColor')?.getClientRects().length`, 'toolpath stage shown');
    await clickEl('#addPlotColor');
    await waitFor(`document.querySelectorAll('#plotColors .pc-row').length >= 1`, 'pen row added');
    await evalJs(`(async () => {
      const { state, makeToolpath } = await import('/apps/penplotter/src/state.js');
      const shapes = window.__sketch.controller.state.shapes;
      const circle = shapes.find(s => s.type === 'circle').id;
      const lines = shapes.map(s => s.id).filter(i => i !== circle);
      state.doc = { w: 100, h: 80 };
      const a = makeToolpath('Tri', 'outline'); a.targetShapeIds = lines; a.plotColorId = state.plotColors[0].id; a.outline.passes = 2; a.outline.style = 'dashed';
      const b = makeToolpath('Disc', 'fill'); b.targetShapeIds = [circle]; b.plotColorId = state.plotColors[state.plotColors.length - 1].id;
      b.fill = { pattern: 'crosshatch', angle: 30, spacing: 1.5, offset: 0.5 };
      state.toolpaths = [a, b]; state.activeToolpathId = b.id;
      state.settings = { pen_up_z: 7, pen_down_z: -2, draw_feed: 1234, z_feed: 567, tolerance_mm: 0.2, export_files: 'pen' };
      state.plotColors[0].name = 'Fine red'; state.plotColors[0].width = 0.3;
    })()`);
    // the sidecar written AFTER the setup is the one saved: wait until the stored buffer carries the setup
    await waitFor(`new Promise((res, rej) => {
      const open = indexedDB.open('sketch-studio-projects', 1);
      open.onsuccess = () => { try {
        const db = open.result; const m = db.transaction('meta').objectStore('meta').get('currentDesign');
        m.onsuccess = () => { try {
          const g = db.transaction('designs').objectStore('designs').get(m.result);
          g.onsuccess = () => { const p = g.result && g.result.document.hosts && g.result.document.hosts.penplotter; res(!!p && p.toolpaths.length === 2 && p.settings.draw_feed === 1234 && p.plotColors[0].name === 'Fine red'); };
          g.onerror = () => rej(g.error);
        } catch (e) { rej(e); } };
        m.onerror = () => rej(m.error);
      } catch (e) { rej(e); } };
      open.onerror = () => rej(open.error);
    })`, 'the setup to be persisted', 10000);
    await waitSaved();
    const before = await observe();
    assert(before.plotter.toolpaths.length === 2 && before.plotter.plotColors.length >= 2, 'setup built the plotter state');
    assert(before.gcode.length === 2, 'two exportable toolpaths before reload: ' + before.gcode.length);
    assert(before.shapes > 0, 'geometry imported');

    await reload();
    const after = await observe();
    console.log('before:', before.docInfo, '| pens', before.plotter.plotColors.length, '| toolpaths', before.plotter.toolpaths.length, '| feed', before.plotter.settings.draw_feed);
    console.log('after :', after.docInfo, '| pens', after.plotter.plotColors.length, '| toolpaths', after.plotter.toolpaths.length, '| feed', after.plotter.settings.draw_feed);
    assert.strictEqual(after.stage, before.stage, 'active stage restored');
    assert.deepStrictEqual(after.plotter, before.plotter, 'the whole plotter document (doc, pens, toolpaths, settings, styles, static ids) is equal after reload');
    assert.strictEqual(after.shapes, before.shapes, 'geometry restored');
    assert.deepStrictEqual(after.gcode, before.gcode, 'the exported G-code is byte-identical after reload');
    assert.strictEqual(after.penRows, before.plotter.plotColors.length, 'the Pens panel shows the restored pens');
    assert(/100 × 80 mm/.test(after.docInfo), 'canvas readout shows the restored doc size: ' + after.docInfo);
    assert.strictEqual(after.drawFeedInput, '1234', 'the Toolpath settings inputs show the restored feed');
    // ids minted after the restore must not collide with restored ones
    const clash = await evalJs(`(async () => { const { uid, state } = await import('/apps/penplotter/src/state.js'); const f = [uid('toolpath'), uid('pen')]; const all = [...state.toolpaths.map(t => t.id), ...state.plotColors.map(p => p.id)]; return JSON.stringify(f.filter(x => all.includes(x))); })()`);
    assert.strictEqual(clash, '[]', 'new ids do not collide with restored ids');

    // OLD document: strip the host sidecar from the saved buffer, reload -> plotter defaults, geometry kept.
    await evalJs(`new Promise((res, rej) => {
      const open = indexedDB.open('sketch-studio-projects', 1);
      open.onsuccess = () => {
        const db = open.result; const tx = db.transaction(['meta', 'designs'], 'readwrite');
        const m = tx.objectStore('meta').get('currentDesign');
        m.onsuccess = () => { const g = tx.objectStore('designs').get(m.result); g.onsuccess = () => { const d = g.result; delete d.document.hosts.penplotter; tx.objectStore('designs').put(d); }; };
        tx.oncomplete = () => res(true); tx.onerror = () => rej(tx.error);
      };
      open.onerror = () => rej(open.error);
    })`);
    await reload();
    const old = await observe();
    console.log('old doc :', old.docInfo, '| pens', old.plotter.plotColors.length, '| toolpaths', old.plotter.toolpaths.length, '| shapes', old.shapes);
    assert.strictEqual(old.shapes, before.shapes, 'an old document still restores its geometry');
    assert.deepStrictEqual(old.plotter.doc, { w: 200, h: 200 }, 'old document: default doc size');
    assert.strictEqual(old.plotter.plotColors.length, 0, 'old document: no pens');
    assert.strictEqual(old.plotter.toolpaths.length, 1, 'old document: the single default toolpath');
    assert.strictEqual(old.plotter.settings.draw_feed, 2000, 'old document: default feed');
    console.log('penplotter-persist: ok');
  } finally {
    await cdp.close();
  }
})();
