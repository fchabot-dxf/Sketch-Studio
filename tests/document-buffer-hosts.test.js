// tests/document-buffer-hosts.test.js — TASK 458: the shared autosave buffer keeps OTHER apps' host sidecars (TASK 474: now per
// design in the project store; the stored design is read straight from IndexedDB 'sketch-studio-projects').
// Live headless CDP, same origin (the buffer key is shared by every app):
//  A. the real repro: Pen Plotter saves pens/toolpaths -> SketchStudio (no host) edits and autosaves -> back in Pen Plotter
//     after a reload the plotter state is unchanged (before the fix SketchStudio's save wrote hosts:{} and wiped it).
//  B. in-page buffers: two hosts saving alternately both keep their sidecar; a host-less buffer never deletes any.

import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { importViaMenu } from './helpers/import-via-menu.js';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';
import { CREATE_NAMED_DESIGN } from './helpers/named-design.js';

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="80mm" viewBox="0 0 100 80">'
  + '<path d="M10 10 L40 10 L40 30 Z" stroke="#ff0000" fill="none"/>'
  + '<circle cx="70" cy="25" r="12" stroke="#0000ff" fill="#00ff00"/></svg>';

await (async () => {
  const cdp = await launchBrowser({ tag: '458' });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, waitFor, navigate } = cdp;
  const filesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-test-458-files-'));
  const svgPath = path.join(filesDir, 'hosts.svg');
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
    const goto = (url) => navigate(`http://127.0.0.1:${port}${url}`, 8000);
    const waitSaved = () => waitFor(`document.getElementById('save-status').textContent === 'Saved'`, 'autosave to report Saved', 10000);
    // The stored buffer, read straight from IndexedDB: { shapes, hosts: [names] }.
    const STORED = `new Promise((res, rej) => {
      const open = indexedDB.open('sketch-studio-projects', 1);
      open.onerror = () => rej(open.error);
      open.onsuccess = () => { try { const db = open.result; const m = db.transaction('meta').objectStore('meta').get('currentDesign');
        m.onsuccess = () => { try { const g = db.transaction('designs').objectStore('designs').get(m.result); g.onsuccess = () => { const d = g.result && g.result.document; res(d ? { shapes: d.geometry.shapes.length, hosts: Object.keys(d.hosts || {}).sort(), doc: d } : null); }; } catch (e) { rej(e); } }; } catch (e) { rej(e); } };
    }).then(r => r && JSON.stringify({ shapes: r.shapes, hosts: r.hosts, penplotter: r.doc.hosts && r.doc.hosts.penplotter }))`;
    const stored = () => evalJs(STORED).then((s) => s && JSON.parse(s));
    const plotterDoc = () => evalJs(`import('/apps/penplotter/src/plotter-doc.js').then(m => JSON.stringify(m.capturePlotterDoc()))`).then(JSON.parse);

    // ---- A. Pen Plotter -> SketchStudio edit -> Pen Plotter
    await goto('/apps/penplotter/index.html');
    await waitFor(`!!document.querySelector('.sk-sidebar-btn') && !!window.__sketch`, 'the Pen Plotter page to load');
    await evalJs(CREATE_NAMED_DESIGN('penplotter', 'Hosts test')); // TASK 558: only a NAMED design autosaves; the reload restores it
    await goto('/apps/penplotter/index.html');
    await waitFor(`!!document.querySelector('.sk-sidebar-btn') && !!window.__sketch && document.getElementById('design-canvas').dataset.docReady === '1'`, 'the Pen Plotter page to restore the named design');
    await importViaMenu(cdp, svgPath); // TASK 566: the sidebar's "Import SVG / DXF…" and the real file chooser
    await waitFor(`window.__sketch.controller.state.shapes.length > 0`, 'the SVG import to add shapes');
    await clickEl('.stage-btn[data-stage="toolpath"]');
    await waitFor(`(() => { const b = document.getElementById('addPlotColor'); return !!b && b.offsetParent !== null; })()`, 'the toolpath stage (#addPlotColor visible)');
    await clickEl('#addPlotColor');
    await evalJs(`(async () => {
      const { state, makeToolpath } = await import('/apps/penplotter/src/state.js');
      const shapes = window.__sketch.controller.state.shapes;
      const a = makeToolpath('Tri', 'outline'); a.targetShapeIds = shapes.map(s => s.id); a.plotColorId = state.plotColors[0].id; a.outline.passes = 2;
      state.toolpaths = [a]; state.activeToolpathId = a.id;
      state.settings = { pen_up_z: 7, pen_down_z: -2, draw_feed: 1234, z_feed: 567, tolerance_mm: 0.2, export_files: 'pen' };
    })()`);
    await waitFor(`${STORED}.then(s => { const r = s && JSON.parse(s); return !!(r && r.penplotter && r.penplotter.toolpaths && r.penplotter.toolpaths.length === 1 && r.penplotter.toolpaths[0].name === 'Tri' && r.penplotter.settings.draw_feed === 1234); })`, 'Pen Plotter to autosave its toolpath sidecar (its own toolpath and settings, not the starter toolpath)');
    await waitSaved();
    const plotterBefore = await plotterDoc();
    const s1 = await stored();
    assert(s1 && s1.hosts.includes('penplotter'), 'Pen Plotter saved its sidecar: ' + JSON.stringify(s1 && s1.hosts));
    assert(plotterBefore.toolpaths.length === 1 && plotterBefore.plotColors.length >= 1, 'plotter state built');

    await goto('/apps/sketchstudio/index.html');
    await waitFor(`(() => { const c = document.getElementById('svgCanvas'); return !!c && c.getBoundingClientRect().width > 0 && !!document.getElementById('tool-line'); })()`, 'the SketchStudio page to load');
    const rc = await evalJs(`(() => { const r = document.getElementById('svgCanvas').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()`);
    await clickEl('#tool-line');
    await click(Math.round(rc.x + rc.w * 0.30), Math.round(rc.y + rc.h * 0.70));
    await click(Math.round(rc.x + rc.w * 0.55), Math.round(rc.y + rc.h * 0.70));
    await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await waitFor(`${STORED}.then(s => { const r = s && JSON.parse(s); return !!r && r.shapes > ${s1.shapes}; })`, 'SketchStudio to autosave its edit', 10000);
    const s2 = await stored();
    assert(s2 && s2.shapes > s1.shapes, 'SketchStudio autosaved its edit: shapes ' + (s1 && s1.shapes) + ' -> ' + (s2 && s2.shapes));
    console.log('after SketchStudio save: shapes', s1.shapes, '->', s2.shapes, '| hosts', JSON.stringify(s2.hosts));
    assert(s2.hosts.includes('penplotter'), 'SketchStudio\'s save dropped the Pen Plotter sidecar (hosts: ' + JSON.stringify(s2.hosts) + ')');

    await goto('/apps/penplotter/index.html');
    await waitFor(`import('/apps/penplotter/src/plotter-doc.js').then(m => m.capturePlotterDoc().plotColors.length > 0)`, 'Pen Plotter to restore its pens from the buffer');
    const plotterAfter = await plotterDoc();
    assert.deepStrictEqual(plotterAfter, plotterBefore, 'Pen Plotter state is unchanged after another app saved');

    // ---- B. in-page buffers: two hosts alternate, a host-less buffer never deletes
    const result = await evalJs(`(async () => {
      const { createDocumentBuffer } = await import('/packages/ui/document-buffer.js');
      const mk = () => ({ joints: new Map(), shapes: [], constraints: [] });
      const wait = (ms) => new Promise(r => setTimeout(r, ms));
      const read = () => new Promise((res) => { const o = indexedDB.open('sketch-studio-projects', 1); o.onsuccess = () => { const db = o.result; const m = db.transaction('meta').objectStore('meta').get('currentDesign'); m.onsuccess = () => { const g = db.transaction('designs').objectStore('designs').get(m.result); g.onsuccess = () => res(g.result.document.hosts); }; }; });
      const a = { v: 0 }, b = { v: 0 }; // set to 1 after the restore: a buffer writes only what CHANGED since it was bound (TASK 558)
      const sa = mk(), sb = mk(), sc = mk();
      const A = createDocumentBuffer({ state: sa, hostName: 'hostA', getHostData: () => a, pollMs: 40 });
      const B = createDocumentBuffer({ state: sb, hostName: 'hostB', getHostData: () => b, pollMs: 40 });
      const C = createDocumentBuffer({ state: sc, pollMs: 40 });
      await A.restore(); await B.restore(); await C.restore(); // TASK 558: bound to the current NAMED design (an unbound buffer never writes)
      a.v = 1; b.v = 1;
      const out = [];
      A.start(); await wait(250); out.push(['A saves', Object.keys(await read()).sort()]);
      A.stop(); B.start(); await wait(250); out.push(['B saves', Object.keys(await read()).sort()]);
      B.stop(); a.v = 2; A.start(); await wait(250); out.push(['A changes', JSON.stringify((await read()).hostA), Object.keys(await read()).sort()]);
      A.stop(); b.v = 2; B.start(); await wait(250); out.push(['B changes', JSON.stringify((await read()).hostB), Object.keys(await read()).sort()]);
      B.stop(); sc.shapes.push({ id: 'x', type: 'line', joints: [] }); C.start(); await wait(250); out.push(['host-less saves', Object.keys(await read()).sort()]);
      C.stop();
      return JSON.stringify(out);
    })()`).then(JSON.parse);
    for (const r of result) console.log('  ', JSON.stringify(r));
    const has = (r, ...names) => names.every((n) => r.includes(n));
    assert(has(result[0][1], 'hostA'), 'A saved');
    assert(has(result[1][1], 'hostA', 'hostB'), 'B saved and A survived: ' + JSON.stringify(result[1][1]));
    assert(result[2][1] === '{"v":2}' && has(result[2][2], 'hostA', 'hostB'), 'A updated its own sidecar, B kept: ' + JSON.stringify(result[2]));
    assert(result[3][1] === '{"v":2}' && has(result[3][2], 'hostA', 'hostB'), 'B updated its own sidecar, A kept: ' + JSON.stringify(result[3]));
    assert(has(result[4][1], 'hostA', 'hostB', 'penplotter'), 'a host-less save deleted no sidecar: ' + JSON.stringify(result[4]));
    console.log('document-buffer-hosts: ok');
  } finally {
    await cdp.close();
    fs.rmSync(filesDir, { recursive: true, force: true });
  }
})();
