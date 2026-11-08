// tests/penplotter-pen-undo.test.js — TASK 445: Pen Plotter pen edits are undoable (history.js now serializes plotColors).
// Live headless CDP check on the Toolpath stage with REAL mouse + key events: add a pen -> Ctrl+Z gone -> Ctrl+Y back;
// rename -> Ctrl+Z old name; delete a pen used by a toolpath -> Ctrl+Z pen back AND the toolpath still uses it.

import assert from 'node:assert';
import { launchBrowser, sendRealKey, sleep } from './helpers/cdp-browser.js';

await (async () => {
  const cdp = await launchBrowser({ tag: '445' });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, waitFor, navigate } = cdp;

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
    const stageTab = (name) => clickEl(`.stage-btn[data-stage="${name}"]`);
    const observe = () => evalJs(`(() => ({
      pens: window.__draw.state.plotColors.map(p => p.name),
      tpPens: window.__draw.state.toolpaths.map(t => t.plotColorId),
      penIds: window.__draw.state.plotColors.map(p => p.id),
    }))()`);

    await navigate(`http://127.0.0.1:${port}/apps/penplotter/index.html`, 8000);
    await waitFor(`!!window.__draw && !!document.querySelector('.stage-btn[data-stage="toolpath"]')`, 'penplotter app ready');
    await stageTab('toolpath');
    await waitFor(`document.querySelector('.stage-btn[data-stage="toolpath"]').classList.contains('active') && !!document.getElementById('addPlotColor')?.getClientRects().length`, 'toolpath stage shown');

    const base = await observe();
    // 1. add a pen -> Ctrl+Z -> gone -> Ctrl+Y -> back
    await clickEl('#addPlotColor');
    const added = await observe();
    assert.strictEqual(added.pens.length, base.pens.length + 1, 'added one pen');
    await key('z', 'KeyZ', 90, 2);
    const u1 = await observe();
    console.log('add pen    :', JSON.stringify(base.pens), '->', JSON.stringify(added.pens), 'Ctrl+Z ->', JSON.stringify(u1.pens));
    assert.deepStrictEqual(u1.pens, base.pens, 'Ctrl+Z removes the added pen');
    await key('y', 'KeyY', 89, 2);
    const r1 = await observe();
    console.log('           Ctrl+Y ->', JSON.stringify(r1.pens));
    assert.deepStrictEqual(r1.pens, added.pens, 'Ctrl+Y brings the pen back');

    // 2. a second pen (so a delete is allowed), then rename it with real typing
    await clickEl('#addPlotColor');
    const two = await observe();
    const lastName = two.pens[two.pens.length - 1];
    await clickEl('.pc-row:last-child .pc-name');
    await key('a', 'KeyA', 65, 2);
    for (const ch of 'Zed') await key(ch, 'Key' + ch.toUpperCase(), ch.toUpperCase().charCodeAt(0), 0, ch);
    await key('Enter', 'Enter', 13);
    await click(5, 5); // real click to leave the input (history.js ignores INPUT targets)
    const renamed = await observe();
    assert.strictEqual(renamed.pens[renamed.pens.length - 1], 'Zed', 'renamed to Zed');
    await key('z', 'KeyZ', 90, 2);
    const u2 = await observe();
    console.log('rename     :', JSON.stringify(two.pens), '-> Zed; Ctrl+Z ->', JSON.stringify(u2.pens));
    assert.deepStrictEqual(u2.pens, two.pens, 'Ctrl+Z restores the old pen name');
    assert.strictEqual(u2.pens[u2.pens.length - 1], lastName);

    // 3. delete a pen used by a toolpath -> reassign -> Ctrl+Z -> pen back and the toolpath still uses it
    const penId = two.penIds[two.penIds.length - 1];
    // seed (test setup, not the gesture under test): point toolpath 0 at the pen, re-render so its "used by" badge is current
    await evalJs(`(async () => { window.__draw.state.toolpaths[0].plotColorId = ${JSON.stringify(penId)}; (await import('/apps/penplotter/src/plot-colors-panel.js')).renderPlotColorsPanel(); })()`);
    const seeded = await observe();
    assert.strictEqual(seeded.tpPens[0], penId, 'seeded: toolpath uses the pen to delete');
    await clickEl('.pc-row:last-child .pc-del'); // real click (the x is reachable since TASK 446)
    await waitFor(`!!document.querySelector('.ui-dialog-ok')`, 'delete-pen confirm dialog');
    await clickEl('.ui-dialog-ok');
    await waitFor(`window.__draw.state.plotColors.length === ${two.pens.length - 1}`, 'pen deleted');
    const deleted = await observe();
    console.log('delete pen :', JSON.stringify(seeded.penIds), '-> pens', JSON.stringify(deleted.penIds), 'toolpath pen', seeded.tpPens[0], '->', deleted.tpPens[0]);
    assert.strictEqual(deleted.pens.length, two.pens.length - 1, 'pen deleted');
    assert.notStrictEqual(deleted.tpPens[0], penId, 'toolpath reassigned off the deleted pen');
    await key('z', 'KeyZ', 90, 2);
    const u3 = await observe();
    console.log('           Ctrl+Z -> pens', JSON.stringify(u3.penIds), 'toolpath pen', u3.tpPens[0]);
    assert.deepStrictEqual(u3.penIds, two.penIds, 'Ctrl+Z restores the deleted pen');
    assert.strictEqual(u3.tpPens[0], penId, 'the toolpath uses the restored pen again');
    assert(u3.penIds.includes(u3.tpPens[0]), 'toolpath points at a pen that exists');
    console.log('penplotter-pen-undo: ok');
  } finally {
    await cdp.close();
  }
})();
