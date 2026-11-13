// tests/context-menu-live.test.js — TASK 493: the driven dot is gone; right click opens ONE shared context menu
// (dimension: Driving / Reference / Delete; geometry: Lock-Unlock / Delete). Real pointer (right button) + real keys.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { launchBrowser } from './helpers/cdp-browser.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await (async () => {
  const cdp = await launchBrowser({ tag: '493', width: 1400, height: 800, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, once, evalJs, ws, waitFor, waitForApp } = cdp;
  try {
    ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.method === 'Runtime.exceptionThrown') console.log('PAGE ERROR:', JSON.stringify(m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description || m.params.exceptionDetails.text)); });
    const mouse = async (type, x, y, buttons = 0) => send('Input.dispatchMouseEvent', { type, x, y, button: (buttons || type === 'mouseReleased') ? 'left' : 'none', buttons, clickCount: (buttons || type === 'mouseReleased') ? 1 : 0 });
    const clickEl = async (sel) => {
      const c = await evalJs(`(() => { const e = document.querySelector('${sel}'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) }; })()`);
      assert(c, sel + ' not found');
      await mouse('mouseMoved', c.x, c.y); await mouse('mousePressed', c.x, c.y, 1); await mouse('mouseReleased', c.x, c.y); await sleep(250);
    };
    const openMode = async (mode) => {
      for (let i = 0; i < 5; i++) {
        await clickEl(`[data-mode="${mode}"]`); await sleep(300);
        if (await evalJs(`document.querySelector('.mode-btn.active').dataset.mode`) === mode) return;
      }
      assert.fail('could not open the ' + mode + ' tab');
    };
    const shot = async (name, clip) => {
      const r = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 1 } } : {}) });
      const buf = Buffer.from(r.data, 'base64');
      if (process.env.EVIDENCE_DIR) fs.writeFileSync(path.join(process.env.EVIDENCE_DIR, name), buf);
      return createHash('md5').update(buf).digest('hex');
    };

    const loaded = once('Page.loadEventFired');
    await send('Page.navigate', { url: `http://127.0.0.1:${port}/apps/shaper/index.html` });
    await Promise.race([loaded, sleep(8000)]); await waitFor(`!!document.querySelector('[data-mode="design"]')`, 'the Shaper to load');
    await openMode('design'); await waitForApp('design-canvas'); await waitFor(`!!window.__designController && document.getElementById('design-canvas').getBoundingClientRect().width > 0`, 'the Shaper Design tab to show');

    const key = async (k, code, vk, modifiers = 0) => { await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk, modifiers }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, modifiers }); await sleep(350); };
    const click = async (pt) => { await mouse('mouseMoved', pt.x, pt.y); await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pt.x, y: pt.y, button: 'left', buttons: 1, clickCount: 1 }); await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt.x, y: pt.y, button: 'left', buttons: 0, clickCount: 1 }); await sleep(500); };
    const rightClick = async (pt) => { await mouse('mouseMoved', pt.x, pt.y); await sleep(150); await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pt.x, y: pt.y, button: 'right', buttons: 2, clickCount: 1 }); await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt.x, y: pt.y, button: 'right', buttons: 0, clickCount: 1 }); await sleep(500); };
    const W2S = (x, y) => evalJs(`(() => { const s = document.getElementById('design-canvas'); const p = s.createSVGPoint(); p.x = ${x}; p.y = ${y}; const q = p.matrixTransform(s.getScreenCTM()); return { x: Math.round(q.x), y: Math.round(q.y) }; })()`);
    const labelPt = async (idx) => { const r = await evalJs(`(() => { const e = document.querySelector('#design-canvas .dim-label[data-constraint-idx="${idx}"]'); if (!e) return null; const b = e.getBoundingClientRect(); return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }; })()`); assert(r, 'dim label ' + idx + ' is on screen'); return r; };
    const labelText = (idx) => evalJs(`(document.querySelector('#design-canvas .dim-label[data-constraint-idx="${idx}"]') || { textContent: '' }).textContent.trim()`);
    const menu = () => evalJs(`(() => { const m = document.querySelector('.sk-context-menu'); if (!m) return null; return [...m.querySelectorAll('.sk-context-item')].map(r => ({ id: r.dataset.id, label: r.textContent.replace('✓', '').trim(), checked: r.getAttribute('aria-checked'), disabled: r.getAttribute('aria-disabled') === 'true' })); })()`);
    const chooseItem = async (itemId) => { await clickEl(`.sk-context-menu .sk-context-item[data-id="${itemId}"]`); await sleep(400); };
    const state = (js) => evalJs(`(() => { const st = window.__designController.state; ${js} })()`);
    const seed = () => state(`
      for (const k of [...st.joints.keys()]) if (k !== 'j_origin') st.joints.delete(k);
      st.shapes.length = 0; st.constraints.length = 0; st.selectedShapes.clear(); st.selectedJoints.clear(); st.selectedConstraints.clear();
      const J = (id, x, y) => st.joints.set(id, { x, y });
      J('a', -45, -20); J('b', -5, -20); J('c', -5, 10); J('d', 20, -20); J('e', 40, -20);
      st.shapes.push({ id: 'L1', type: 'line', joints: ['a', 'b'] }, { id: 'L2', type: 'line', joints: ['b', 'c'] }, { id: 'L3', type: 'line', joints: ['d', 'e'] });
      st.constraints.push({ type: 'distance', joints: ['a', 'b'], value: 40, glyphPos: { x: -25, y: -30 } });
      if (window.__designController.render) window.__designController.render();
      return st.constraints.length;`);
    const summary = () => state(`return JSON.stringify({ shapes: st.shapes.map(s => s.id), sel: [...st.selectedShapes], selJ: [...st.selectedJoints], fixed: [...st.joints].filter(([k, j]) => j.fixed && k !== 'j_origin').map(([k]) => k).sort() });`).then(JSON.parse);
    const setTool = (t) => state(`st.currentTool = ${JSON.stringify(t)}; return true;`);
    const noMenu = async (msg) => assert.strictEqual(await menu(), null, msg);

    await seed(); await sleep(700);
    assert.strictEqual(await evalJs(`document.querySelectorAll('.dim-driven-toggle').length`), 0, 'no dim-driven-toggle in the rendered markup');
    assert(await evalJs(`document.querySelector('#design-canvas').outerHTML.indexOf('dim-driven-toggle') < 0`), 'no dim-driven-toggle in the svg');

    // --- dimension menu
    await rightClick(await labelPt(0));
    let m = await menu();
    assert(m, 'right click on a dimension label opens the menu');
    assert.deepStrictEqual(m.map((r) => r.label), ['Driving dimension', 'Reference dimension', 'Delete dimension']);
    assert.strictEqual(m[0].checked, 'true'); assert.strictEqual(m[1].checked, 'false');
    console.log('md5 dim menu (driving):', await shot('menu-dimension-driving.png'));
    await key('Escape', 'Escape', 27); await noMenu('Escape closes the menu');
    const startText = await labelText(0);
    assert(!/^\(/.test(startText), 'driving label is not parenthesised: ' + startText);

    await rightClick(await labelPt(0)); await chooseItem('dim-reference');
    assert(await state(`return !!(st.constraints[0].isDriven || st.constraints[0].driven);`), 'Reference makes it driven');
    assert(/^\(/.test(await labelText(0)), 'the reference label is parenthesised: ' + await labelText(0));
    await noMenu('choosing an item closes the menu');
    await rightClick(await labelPt(0));
    m = await menu(); assert.strictEqual(m[0].checked, 'false'); assert.strictEqual(m[1].checked, 'true');
    console.log('md5 dim menu (reference):', await shot('menu-dimension-reference.png'));
    await chooseItem('dim-driving');
    assert(!(await state(`return !!(st.constraints[0].isDriven || st.constraints[0].driven);`)), 'Driving restores it');
    assert(!/^\(/.test(await labelText(0)), 'the driving label is restored');

    // keyboard: arrows + Enter picks Reference
    await rightClick(await labelPt(0)); await key('ArrowDown', 'ArrowDown', 40); await key('ArrowDown', 'ArrowDown', 40); await key('Enter', 'Enter', 13);
    assert(await state(`return !!(st.constraints[0].isDriven || st.constraints[0].driven);`), 'arrows + Enter choose an item');

    // --- empty canvas: nothing opens
    await seed(); await sleep(500);
    await rightClick(await W2S(0, 40)); await noMenu('right click on empty canvas opens nothing');

    // --- geometry: unselected line gets selected, Lock + Delete offered
    const L3 = await W2S(30, -20);
    await rightClick(L3);
    m = await menu(); assert(m, 'right click on a line opens the menu');
    assert.deepStrictEqual(m.map((r) => r.label), ['Lock', 'Delete']);
    assert.deepStrictEqual((await summary()).sel, ['L3'], 'the unselected line is selected first');
    await chooseItem('geo-lock');
    assert.deepStrictEqual((await summary()).fixed, ['d', 'e'], 'Lock fixes the line joints');
    await rightClick(L3); m = await menu(); assert.strictEqual(m[0].label, 'Unlock'); assert.strictEqual(m[0].checked, 'true');
    console.log('md5 geometry menu (unlock):', await shot('menu-geometry-unlock.png'));
    await chooseItem('geo-lock'); assert.deepStrictEqual((await summary()).fixed, [], 'Unlock releases it');

    // Delete: one undo step
    await rightClick(L3); await chooseItem('geo-delete');
    assert(!(await summary()).shapes.includes('L3'), 'Delete removes the line');
    await key('z', 'KeyZ', 90, 2);
    assert((await summary()).shapes.includes('L3'), 'ONE Ctrl+Z restores the line');

    // group selection: right click on a selected member acts on the whole selection
    await state(`st.selectedShapes.clear(); st.selectedShapes.add('L1'); st.selectedShapes.add('L3'); return true;`);
    await rightClick(L3);
    assert.deepStrictEqual((await summary()).sel.sort(), ['L1', 'L3'], 'the selection is kept');
    await chooseItem('geo-lock');
    assert.deepStrictEqual((await summary()).fixed, ['a', 'b', 'd', 'e'], 'Lock acts on the whole selection');

    // joint
    await seed(); await sleep(400);
    await rightClick(await W2S(-5, 10));
    m = await menu(); assert(m, 'right click on a joint opens the menu');
    assert.deepStrictEqual((await summary()).selJ, ['c'], 'the joint is selected');
    await chooseItem('geo-lock'); assert.deepStrictEqual((await summary()).fixed, ['c']);

    // --- line tool: right click still ends the segment
    await seed(); await sleep(400);
    await clickEl('#tool-line');
    await click(await W2S(0, 30)); await mouse('mouseMoved', (await W2S(20, 30)).x, (await W2S(20, 30)).y); await sleep(200);
    assert(await state(`return !!st.active;`), 'the line tool is mid-segment');
    await rightClick(await W2S(20, 30));
    assert(!(await state(`return !!st.active;`)), 'right click ends the segment');
    await noMenu('the line tool right click opens no menu');

    // --- ribbon Lock button
    await clickEl('#tool-select'); await seed(); await sleep(400);
    await state(`st.selectedShapes.clear(); st.selectedJoints.clear(); st.selectedConstraints.clear(); return true;`);
    await key('Escape', 'Escape', 27);
    await click(await W2S(0, 40)); await sleep(200);
    assert(await evalJs(`document.querySelector('#btn-lock').disabled`), 'Lock is disabled with nothing selected');
    await click(await W2S(30, -20));
    assert(!(await evalJs(`document.querySelector('#btn-lock').disabled`)), 'Lock is enabled with a selection');
    await clickEl('#btn-lock');
    assert.deepStrictEqual((await summary()).fixed, ['d', 'e'], 'the ribbon Lock fixes the joints');
    assert.strictEqual(await evalJs(`document.querySelector('#btn-lock').getAttribute('aria-pressed')`), 'true');
    const bar = await evalJs(`(() => { const r = document.querySelector('#btn-lock').parentElement.getBoundingClientRect(); return { x: Math.floor(r.left) - 4, y: Math.floor(r.top) - 4, width: Math.ceil(r.width) + 8, height: Math.ceil(r.height) + 24 }; })()`);
    console.log('md5 ribbon lock:', await shot('ribbon-lock.png', bar));
    await clickEl('#btn-lock');
    assert.deepStrictEqual((await summary()).fixed, [], 'the ribbon Lock again unlocks');

    console.log('context-menu-live OK');
  } finally {
    await cdp.close();
  }
})();
