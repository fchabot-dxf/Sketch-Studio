// tests/penplotter-cosmetics.test.js — TASK 465 (Pen Plotter audit leftovers), live headless, real clicks:
// the empty label band is gone, the pens hint and the pen-less group row are worded/named, Export's nothing-to-plot toast
// speaks for the Design tab, Pen-mix says why it is off with no pens, an import seeds a pen for every stroke AND fill colour
// (one rule), and + Outline from a selection replaces the empty starter toolpath.

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="80mm" viewBox="0 0 100 80">'
  + '<path d="M10 10 L40 10 L40 30 Z" stroke="#ff0000" fill="none"/>'
  + '<circle cx="70" cy="25" r="12" stroke="#0000ff" fill="#00ff00"/></svg>';

await (async () => {
  const cdp = await launchBrowser({ tag: '465' });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, waitFor, navigate, userDir } = cdp;
  const svgPath = path.join(userDir, 'cosmetics.svg');
  fs.writeFileSync(svgPath, SVG);

  try {
    await send('DOM.enable');
    const click = async (x, y) => {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', clickCount: 0 }); await sleep(30);
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 }); await sleep(30);
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 }); await sleep(200);
    };
    const clickEl = async (sel) => {
      const c = await evalJs(`(() => { const e = document.querySelector('${sel}'); if (!e) return null; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) }; })()`);
      assert(c, sel + ' not found');
      await click(c.x, c.y);
    };
    const world = (x, y) => evalJs(`(() => { const s = document.getElementById('design-canvas'); const p = new DOMPoint(${x}, ${y}).matrixTransform(s.getScreenCTM()); return { x: Math.round(p.x), y: Math.round(p.y) }; })()`);
    const frame = () => send('Page.captureScreenshot', { format: 'png' }); // headless draws frames on demand
    const st = (expr) => evalJs(`import('/apps/penplotter/src/state.js').then(m => { const state = m.state; return JSON.stringify(${expr}); })`).then(JSON.parse);
    const toast = () => evalJs(`document.getElementById('toast').textContent`);

    await navigate(`http://127.0.0.1:${port}/apps/penplotter/index.html`, 8000);
    const stageOn = (s) => waitFor(`document.querySelector('.stage-btn[data-stage="${s}"]')?.classList.contains('active')`, `${s} stage active`);
    await waitFor(`!!document.querySelector('.stage-btn[data-stage="toolpath"]')`, 'penplotter app ready');

    // ---- item 6c/6b: a fresh page has the starter toolpath in a pen-less group: it is NAMED, and the pens hint is current
    await clickEl('.stage-btn[data-stage="toolpath"]'); await stageOn('toolpath');
    await waitFor(`!!document.querySelector('#toolpathLayers .group-row')`, 'toolpath group row rendered');
    const fresh = await evalJs(`(() => ({ group: document.querySelector('#toolpathLayers .group-row').textContent, hint: document.getElementById('plotColors').textContent, strip: !!document.querySelector('.tp-strip'),
      panelTop: Math.round(document.getElementById('toolpathPanel').getBoundingClientRect().top), headerBottom: Math.round(document.querySelector('header.toolbar').getBoundingClientRect().bottom) }))()`);
    console.log('fresh Toolpath tab:', JSON.stringify(fresh));
    assert(/\(no pen\)/.test(fresh.group), 'the pen-less group row is labelled "(no pen)": ' + fresh.group);
    assert(/\+ Pen/.test(fresh.hint) && !/click \+ to/.test(fresh.hint), 'the Pens hint names the + Pen button: ' + fresh.hint);
    // ---- item 6a: no empty label band above the panel (the panel starts right under the header)
    assert.strictEqual(fresh.strip, false, 'no .tp-strip band on the Toolpath tab');
    assert(fresh.panelTop - fresh.headerBottom <= 2, 'the Toolpath panel starts under the header (gap ' + (fresh.panelTop - fresh.headerBottom) + 'px)');
    await clickEl('.stage-btn[data-stage="export"]'); await stageOn('export');
    const ex = await evalJs(`(() => ({ strip: !!document.querySelector('.tp-strip'), top: Math.round(document.getElementById('exportPanel').getBoundingClientRect().top), headerBottom: Math.round(document.querySelector('header.toolbar').getBoundingClientRect().bottom) }))()`);
    assert.strictEqual(ex.strip, false, 'no .tp-strip band on the Export tab');
    assert(ex.top - ex.headerBottom <= 2, 'the Export panel starts under the header (gap ' + (ex.top - ex.headerBottom) + 'px)');

    // ---- item 4: Export with nothing to plot says what to do TODAY
    await clickEl('#exportBtn');
    await waitFor(`document.getElementById('toast').textContent.length > 0`, 'export toast shown');
    const msg = await toast();
    console.log('export toast:', msg);
    assert(/Design tab/.test(msg) && !/art layers/.test(msg), 'the nothing-to-plot toast is worded for the Design tab: ' + msg);

    // ---- item 1: a coloured shape + an EMPTY palette -> the Pen-mix box says why it is off
    await clickEl('.stage-btn[data-stage="design"]'); await stageOn('design');
    await clickEl('#tool-line');
    const a = await world(20, 30), b = await world(60, 30);
    await click(a.x, a.y); await click(b.x, b.y);
    await evalJs(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    await clickEl('#tool-select');
    const m = await world(40, 30); await click(m.x, m.y);
    await frame(); await sleep(300); await frame();
    await evalJs(`(() => { const e = document.getElementById('strokeColor'); e.value = '#ff0000'; e.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await frame(); await sleep(300); await frame();
    const mix = await evalJs(`({ disabled: document.getElementById('shapeMix').disabled, status: document.getElementById('mixStatus').textContent })`);
    console.log('pen-mix, no pens:', JSON.stringify(mix));
    assert.strictEqual(await st('state.plotColors.length'), 0, 'precondition: no pens');
    assert.strictEqual(mix.disabled, true, 'Pen-mix is off without pens');
    assert(/needs pens/.test(mix.status) && /\+ Pen/.test(mix.status), 'and it says why: ' + mix.status);

    // ---- item 2: ONE colour -> pen rule. Import seeds a pen for every STROKE and FILL colour; + Outline then adds none.
    const root = await send('DOM.getDocument');
    const q = await send('DOM.querySelector', { nodeId: root.root.nodeId, selector: '#importSvgFile' });
    await send('DOM.setFileInputFiles', { nodeId: q.nodeId, files: [svgPath] });
    await waitFor(`import('/apps/penplotter/src/state.js').then(m => m.state.plotColors.length === 3)`, 'import seeded 3 pens');
    const pens = (await st('state.plotColors.map(p => p.color)')).sort();
    console.log('pens after import:', JSON.stringify(pens));
    assert.deepStrictEqual(pens, ['#00ff00', '#0000ff', '#ff0000'].sort(), 'a pen for every stroke and fill colour of the import');

    // ---- item 6d: + Outline from a selection replaces the empty starter toolpath, and adds no pen
    const before = await st('state.toolpaths.map(t => t.name)');
    assert(before.includes('Outline'), 'the starter toolpath is still there before: ' + before);
    await clickEl('#tool-select');
    const c = await world(82, 25); await click(c.x, c.y);       // the circle's edge (stroke #0000ff, fill #00ff00)
    await frame(); await sleep(300); await frame();
    await clickEl('.stage-btn[data-stage="toolpath"]'); await stageOn('toolpath');
    await clickEl('#addOutlineTp');
    await waitFor(`import('/apps/penplotter/src/state.js').then(m => m.state.toolpaths.some(t => /^outline \\d+$/.test(t.name)))`, '+ Outline added a toolpath');
    const after = await st('({ names: state.toolpaths.map(t => t.name), pens: state.plotColors.map(p => p.color).length })');
    console.log('toolpaths after + Outline:', JSON.stringify(after));
    assert(!after.names.includes('Outline'), 'the empty starter "Outline" toolpath is gone: ' + after.names);
    assert(after.names.length >= 1 && after.names.every((n) => /^outline \d+$/.test(n)), 'only real toolpaths remain: ' + after.names);
    assert.strictEqual(after.pens, 3, '+ Outline created no extra pen (the blue stroke pen existed from the import)');

    // a starter toolpath the user EDITED is not dropped (unit check on the predicate, in the page)
    const kept = await evalJs(`import('/apps/penplotter/src/state.js').then(m => { m.initLayers(); const tp = m.state.toolpaths[0]; const a = m.isPristinePlaceholder(tp); tp.outline.passes = 3; const b = m.isPristinePlaceholder(tp); tp.outline.passes = 1; tp.targetShapeIds = ['x']; const c = m.isPristinePlaceholder(tp); return JSON.stringify([a, b, c]); })`).then(JSON.parse);
    assert.deepStrictEqual(kept, [true, false, false], 'pristine starter only: edited or targeted ones are kept: ' + kept);
    console.log('penplotter-cosmetics: ok');
  } finally {
    await cdp.close();
  }
})();
