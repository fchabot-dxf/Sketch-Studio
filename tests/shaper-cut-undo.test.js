// tests/shaper-cut-undo.test.js — TASK 463: every Shaper cut-plan edit is ONE step of the SHARED sketch history (Ctrl+Z / Ctrl+Y on
// Prepare, the ribbon Undo/Redo), and undoing an SVG import restores the cut plan that existed before it. Headless Edge, real clicks/keys.
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { importViaMenu } from './helpers/import-via-menu.js';
import { launchBrowser, sendRealKey, sleep } from './helpers/cdp-browser.js';

await (async () => {
  const cdp = await launchBrowser({ tag: '463' });
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
    const openMode = async (mode) => {
      await clickEl(`[data-mode="${mode}"]`);
      await waitFor(`document.querySelector('.mode-btn.active').dataset.mode === '${mode}'`, 'the ' + mode + ' tab to open');
    };

    const url = `http://127.0.0.1:${port}/apps/shaper/index.html`;
    const plan = () => evalJs(`(async () => { const { CUT_PLAN } = await import('/apps/shaper/src/cut-plan.js'); return JSON.stringify([...CUT_PLAN.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1)); })()`).then(JSON.parse);
    const hist = () => evalJs(`window.__designController.state.history.length`);
    const histIs = (n) => waitFor(`window.__designController.state.history.length === ${n}`, 'the history to have ' + n + ' steps');
    const shapeCount = () => evalJs(`window.__designController.state.shapes.length`);
    const ctrl = (k, code, vk, extra = 0) => key(k, code, vk, 2 | extra);
    const recs = async () => (await plan()).map(([, r]) => r);

    await navigate(url, 8000);
    await waitFor(`!!document.querySelector('[data-mode="design"]')`, 'shaper app ready');
    await openMode('design');
    await waitFor('!!(window.__designController && window.__designController.state)', 'design controller ready');
    await evalJs(`(() => {
      const st = window.__designController.state;
      for (const k of [...st.joints.keys()]) st.joints.delete(k);
      st.shapes.length = 0; st.constraints.length = 0;
      const J = (id, x, y) => st.joints.set(id, { x, y });
      J('a', 0, 0); J('b', 60, 0); J('c', 60, 40); J('d', 0, 40);
      [['s1','a','b'],['s2','b','c'],['s3','c','d'],['s4','d','a']].forEach(([id, p, q]) => st.shapes.push({ id, type: 'line', joints: [p, q] }));
      st.history.length = 0; st.redoStack.length = 0; st._notifyHistory();
    })()`);
    await openMode('prepare');
    await waitFor(`document.querySelectorAll('#prepare-canvas .sk-edge').length >= 4`, 'Prepare shows the seeded geometry');
    const inside = await evalJs(`(() => { const s = document.getElementById('prepare-canvas'); const p = s.createSVGPoint(); p.x = 30; p.y = 20; const q = p.matrixTransform(s.getScreenCTM()); return { x: Math.round(q.x), y: Math.round(q.y) }; })()`);
    await click(inside.x, inside.y); // select the loop
    await waitFor(`(() => { const c = document.querySelector('.cut-card'); return !!c && !c.hidden; })()`, 'the cut card to show the selected loop');

    // ── cut TYPE: one step, Ctrl+Z (on Prepare) removes it, Ctrl+Y brings it back ──
    let h0 = await hist();
    await clickEl('.cut-type-trigger');
    await waitFor(`!!document.querySelector('.cut-type-opt[data-id="pocket"]')`, 'the cut type menu');
    await clickEl('.cut-type-opt[data-id="pocket"]');
    await histIs(h0 + 1);
    assert.strictEqual(await hist(), h0 + 1, 'picking a cut type is ONE history step');
    assert.deepStrictEqual((await recs()).map((r) => r.cutType), ['pocket']);
    await ctrl('z', 'KeyZ', 90);
    await histIs(h0);
    assert.deepStrictEqual(await plan(), [], 'Ctrl+Z on Prepare removes the cut type (the Design-only gate does not block it)');
    assert.strictEqual(await hist(), h0, 'and it consumed exactly ONE step (no double-firing)');
    await ctrl('y', 'KeyY', 89);
    await histIs(h0 + 1);
    assert.deepStrictEqual((await recs()).map((r) => r.cutType), ['pocket'], 'Ctrl+Y brings it back');
    assert.strictEqual(await evalJs(`document.querySelector('.cut-card').hidden`), false, 'the selection and the card survive an undo that only changed the plan');

    // ── DEPTH: change -> undo -> old depth ──
    h0 = await hist();
    await clickEl('.cut-step[data-d="1"]');
    await histIs(h0 + 1);
    assert.strictEqual(await hist(), h0 + 1, 'a depth step is ONE history step');
    const depthSet = (await recs())[0].cutDepth;
    assert.ok(typeof depthSet === 'number' && depthSet > 0, 'depth set: ' + depthSet);
    await ctrl('z', 'KeyZ', 90);
    await histIs(h0);
    assert.strictEqual((await recs())[0].cutDepth, 'unset', 'undo restores the old depth');
    await ctrl('y', 'KeyY', 89);
    await histIs(h0 + 1);
    assert.strictEqual((await recs())[0].cutDepth, depthSet);

    // ── offset preset, bit preset, cutter shape + angle: each ONE step; a no-op pick adds none ──
    h0 = await hist();
    await clickEl('.cut-offset');
    await waitFor(`!!document.querySelector('.cut-offset-pop .cut-preset:nth-child(5)')`, 'the offset presets');
    const p16 = await evalJs(`(() => { const r = document.querySelector('.cut-offset-pop .cut-preset:nth-child(5)').getBoundingClientRect(); return { x: Math.round((r.left + r.right) / 2), y: Math.round((r.top + r.bottom) / 2) }; })()`);
    await click(p16.x, p16.y);
    await histIs(h0 + 1);
    assert.strictEqual(await hist(), h0 + 1, 'an offset preset is ONE step');
    h0 = await hist();
    await clickEl('.cut-presets .cut-preset:nth-child(3)'); // 1/4 in
    await histIs(h0 + 1);
    assert.strictEqual(await hist(), h0 + 1, 'a bit-diameter preset is ONE step');
    h0 = await hist();
    await clickEl('.cut-presets .cut-preset:nth-child(3)'); await sleep(200); // the same value again: nothing to wait for, only absence to check
    assert.strictEqual(await hist(), h0, 'picking the value it already has adds NO step');
    await clickEl('.cut-shape-trigger');
    await waitFor(`!!document.querySelector('.cut-shape-pop .cut-type-opt[data-shape="vbit"]')`, 'the cutter shape menu');
    await clickEl('.cut-shape-pop .cut-type-opt[data-shape="vbit"]');
    await waitFor(`!!document.querySelector('.cut-shape-pop .cut-shape-angles .cut-preset[data-angle="60"]')`, 'the V-bit angle presets');
    h0 = await hist();
    await clickEl('.cut-shape-pop .cut-shape-angles .cut-preset[data-angle="60"]');
    await histIs(h0 + 1);
    assert.strictEqual(await hist(), h0 + 1, 'choosing a V-bit angle (shape + angle) is ONE step');
    let r0 = (await recs())[0];
    assert.deepStrictEqual([r0.cutterShape, r0.cutterAngle], ['vbit', 60]);
    await ctrl('z', 'KeyZ', 90);
    await histIs(h0);
    r0 = (await recs())[0];
    assert.deepStrictEqual([r0.cutterShape, r0.cutterAngle], ['vbit', 90], 'one undo reverts the angle step');
    await ctrl('y', 'KeyY', 89);
    await histIs(h0 + 1);

    // ── the ribbon Undo/Redo buttons (Design) reflect it and drive the same history ──
    h0 = await hist();
    await clickEl('.cut-presets .cut-preset:nth-child(2)');
    await histIs(h0 + 1);
    await clickEl('.cut-presets .cut-preset:nth-child(4)');
    await histIs(h0 + 2);
    await ctrl('z', 'KeyZ', 90); // one step undone, one still undoable
    await histIs(h0 + 1);
    await openMode('design');
    await waitFor(`!!document.getElementById('btn-redo') && !document.getElementById('btn-redo').disabled`, 'the ribbon Redo to enable');
    assert.strictEqual(await evalJs(`document.getElementById('btn-redo').disabled`), false, 'Redo is enabled after an undo of a cut edit');
    assert.strictEqual(await evalJs(`document.getElementById('btn-undo').disabled`), false, 'Undo is enabled while cut edits are on the stack');
    const before = JSON.stringify(await plan());
    await clickEl('#btn-undo');
    await histIs(h0);
    assert.notStrictEqual(JSON.stringify(await plan()), before, 'the ribbon Undo undoes a cut edit too');
    await clickEl('#btn-redo');
    await histIs(h0 + 1);
    assert.strictEqual(JSON.stringify(await plan()), before, 'and Redo brings it back');

    // ── an SVG import: assign cuts, import (adds records), undo the import -> the plan is back to what it was before it ──
    await openMode('prepare');
    await waitFor(`document.querySelectorAll('#prepare-canvas .sk-edge').length >= 4`, 'Prepare shows the geometry');
    const planBeforeImport = JSON.stringify(await plan());
    const shapesBefore = await shapeCount();
    await openMode('design');
    const svgPath = path.join(os.tmpdir(), 'sk-463-import.svg');
    fs.writeFileSync(svgPath, '<svg xmlns="http://www.w3.org/2000/svg" xmlns:shaper="http://www.shapertools.com/namespaces/shaper" width="100mm" height="100mm" viewBox="0 0 100 100"><path d="M 200 0 L 240 0 L 240 30 L 200 30 Z" fill="#7F7F7F" shaper:cutType="pocket" shaper:cutDepth="6.350 mm" shaper:cutOffset="0mm" shaper:toolDia="3.175 mm"/></svg>');
    await importViaMenu(cdp, svgPath); // TASK 566: the sidebar's "Import SVG / DXF…" and the real file chooser
    await waitFor(`window.__designController.state.shapes.length > ${shapesBefore}`, 'the imported shapes');
    const planAfterImport = JSON.stringify(await plan());
    assert.ok(JSON.parse(planAfterImport).length > JSON.parse(planBeforeImport).length, 'the import added a cut record');
    const shapesAfter = await shapeCount();
    assert.ok(shapesAfter > shapesBefore, 'and its shapes');
    await ctrl('z', 'KeyZ', 90); // Design: the shared handler
    await waitFor(`window.__designController.state.shapes.length === ${shapesBefore}`, 'the import to be undone');
    assert.strictEqual(JSON.stringify(await plan()), planBeforeImport, 'undoing the import restores the cut plan that existed before it (no stale records)');
    assert.strictEqual(await shapeCount(), shapesBefore, 'and the shapes');
    await ctrl('y', 'KeyY', 89);
    await waitFor(`window.__designController.state.shapes.length === ${shapesAfter}`, 'the import to be redone');
    assert.strictEqual(JSON.stringify(await plan()), planAfterImport, 'redo brings the import and its cuts back');
    console.log('shaper-cut-undo: ok');
  } finally {
    await cdp.close();
  }
})();
