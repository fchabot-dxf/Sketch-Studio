// tests/penplotter-stage-undo.test.js — TASK 444b: ONE keystroke -> ONE history, chosen by the active stage.
// Live headless CDP check in Pen Plotter with REAL mouse + key events. Pen Plotter has two histories:
//   Design stage    = the shared sketch history (state.undo/redo; Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z via #ui input-manager);
//   Toolpath/Export = history.js (toolpaths / toolpaths / doc).
// Draw a line (Design), add a toolpath (Toolpath), then: Ctrl+Z on Design must undo ONLY the line; Ctrl+Y on Design redo ONLY
// the line; Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z on Toolpath must touch ONLY the toolpaths.

import assert from 'node:assert';
import { launchBrowser, sendRealKey, sleep } from './helpers/cdp-browser.js';

await (async () => {
  const cdp = await launchBrowser({ tag: '444b' });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { send, evalJs, waitFor, navigate, port } = cdp;

  try {
    const key = async (k, code, vk, modifiers = 0, text = '') => { await sendRealKey(send, k, code, vk, modifiers, text); await sleep(200); };
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
    const stageTab = async (name) => {
      await clickEl(`.stage-btn[data-stage="${name}"]`);
      await waitFor(`document.querySelector('.stage-btn[data-stage="${name}"]').classList.contains('active')`, name + ' stage active');
    };
    // sketch lines + sketch history depths (Design history) and toolpaths (history.js)
    const observe = () => evalJs(`(() => ({
      lines: window.__sketch.controller.state.shapes.filter(s => s.type === 'line').length,
      tps: window.__draw.state.toolpaths.length,
      sketchHistory: window.__sketch.controller.state.history.length,
      sketchRedo: window.__sketch.controller.state.redoStack.length,
    }))()`);

    await navigate(`http://127.0.0.1:${port}/apps/penplotter/index.html`, 8000);
    await waitFor(`!!(window.__sketch && window.__sketch.controller && window.__draw && document.querySelector('.stage-btn[data-stage="design"]'))`, 'penplotter app ready');
    await stageTab('design');
    await waitFor(`(() => { const r = document.getElementById('design-canvas').getBoundingClientRect(); return r.width > 0 && r.height > 0; })()`, 'design canvas laid out');

    // Design: draw ONE line with real mouse events
    const box = await evalJs(`(() => { const r = document.getElementById('design-canvas').getBoundingClientRect(); return { x: Math.round(r.left + r.width*0.5), y: Math.round(r.top + r.height*0.6) }; })()`);
    const base = await observe();
    await click(box.x, box.y + 150);
    await key('l', 'KeyL', 76, 0, 'l');
    await click(box.x - 120, box.y); await click(box.x + 120, box.y);
    await key('Escape', 'Escape', 27);
    const afterLine = await observe();
    assert.strictEqual(afterLine.lines, base.lines + 1, 'drew one line');

    // Toolpath: add ONE toolpath (real click on #addOutlineTp) -> history.js snapshot
    await stageTab('toolpath');
    await waitFor(`!!document.querySelector('#addOutlineTp')`, 'toolpath panel ready');
    const toolpathBase = await observe();
    await clickEl('#addOutlineTp');
    const afterPen = await observe();
    assert.strictEqual(afterPen.tps, toolpathBase.tps + 1, 'added one toolpath');
    assert.strictEqual(afterPen.lines, afterLine.lines, 'adding a toolpath does not touch the sketch');

    // Back on Design: ONE Ctrl+Z must undo the line and leave the toolpath
    await stageTab('design');
    const before1 = await observe();
    await key('z', 'KeyZ', 90, 2);
    const a1 = await observe();
    console.log('Design Ctrl+Z    before', JSON.stringify(before1), 'after', JSON.stringify(a1));
    assert.strictEqual(a1.lines, before1.lines - 1, 'Design Ctrl+Z undoes the line');
    assert.strictEqual(a1.tps, before1.tps, 'Design Ctrl+Z must NOT undo the toolpath (toolpath history)');

    // Design: Ctrl+Y redoes the line, toolpath untouched
    await key('y', 'KeyY', 89, 2);
    const a2 = await observe();
    console.log('Design Ctrl+Y    after', JSON.stringify(a2));
    assert.strictEqual(a2.lines, a1.lines + 1, 'Design Ctrl+Y redoes the line');
    assert.strictEqual(a2.tps, a1.tps, 'Design Ctrl+Y must NOT touch the toolpath');

    // Toolpath: Ctrl+Z undoes the toolpath only, sketch untouched
    await stageTab('toolpath');
    const before3 = await observe();
    await key('z', 'KeyZ', 90, 2);
    const a3 = await observe();
    console.log('Toolpath Ctrl+Z  before', JSON.stringify(before3), 'after', JSON.stringify(a3));
    assert.strictEqual(a3.tps, before3.tps - 1, 'Toolpath Ctrl+Z undoes the toolpath');
    assert.strictEqual(a3.lines, before3.lines, 'Toolpath Ctrl+Z must NOT touch the sketch');
    assert.strictEqual(a3.sketchHistory, before3.sketchHistory, 'Toolpath Ctrl+Z must NOT move the sketch history');
    assert.strictEqual(a3.sketchRedo, before3.sketchRedo, 'Toolpath Ctrl+Z must NOT move the sketch redo stack');

    // Toolpath: Ctrl+Y redoes the toolpath only
    await key('y', 'KeyY', 89, 2);
    const a4 = await observe();
    console.log('Toolpath Ctrl+Y  after', JSON.stringify(a4));
    assert.strictEqual(a4.tps, a3.tps + 1, 'Toolpath Ctrl+Y redoes the toolpath');
    assert.strictEqual(a4.lines, a3.lines, 'Toolpath Ctrl+Y must NOT touch the sketch');
    assert.strictEqual(a4.sketchHistory, a3.sketchHistory, 'Toolpath Ctrl+Y must NOT move the sketch history');

    // Toolpath: Ctrl+Z then Ctrl+Shift+Z returns to the same state, sketch untouched
    await key('z', 'KeyZ', 90, 2);
    await key('Z', 'KeyZ', 90, 2 | 8);
    const a5 = await observe();
    assert.strictEqual(a5.tps, a4.tps, 'Toolpath Ctrl+Z then Ctrl+Shift+Z returns to the same toolpaths');
    assert.strictEqual(a5.lines, a4.lines, 'Toolpath Ctrl+Shift+Z must NOT touch the sketch');
    console.log('penplotter-stage-undo: ok');
  } finally {
    await cdp.close();
  }
})();
