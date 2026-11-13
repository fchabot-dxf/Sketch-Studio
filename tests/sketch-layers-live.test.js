// tests/sketch-layers-live.test.js — TASK 577: the REAL-POINTER twins of tests/sketch-layers-node.test.js, in the Shaper Design tab (the shared sketch
// panel + canvas): (1) a real mouse drag on a locked sketch's point and line moves nothing, while an unlocked sketch's point drags;
// (2) a real mouse drag of a sketch's grip in the tree reorders the sketches (one undo step); (3) the right-click menu on a selection offers
// "Move to sketch ▸ <name>" and runs it. Screenshots of the panel with a locked sketch and a solo'd sketch go to EVIDENCE_DIR.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { launchBrowser, sendRealKey } from './helpers/cdp-browser.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await (async () => {
  const cdp = await launchBrowser({ tag: '577', width: 1400, height: 800, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, once, evalJs, waitFor, waitForApp } = cdp;
  try {
    const mouse = async (type, x, y, buttons = 0, button) => send('Input.dispatchMouseEvent', { type, x, y, button: button || ((buttons || type === 'mouseReleased') ? 'left' : 'none'), buttons, clickCount: (buttons || type === 'mouseReleased') ? 1 : 0 });
    const center = (sel) => evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) }; })()`);
    const clickEl = async (sel) => { const c = await center(sel); assert(c, sel + ' not found'); await mouse('mouseMoved', c.x, c.y); await mouse('mousePressed', c.x, c.y, 1); await mouse('mouseReleased', c.x, c.y); await sleep(250); };
    const dragReal = async (a, b, steps = 10) => { await mouse('mouseMoved', a.x, a.y); await sleep(60); await mouse('mousePressed', a.x, a.y, 1); await sleep(60); for (let i = 1; i <= steps; i++) { await mouse('mouseMoved', Math.round(a.x + (b.x - a.x) * i / steps), Math.round(a.y + (b.y - a.y) * i / steps), 1); await sleep(25); } await mouse('mouseReleased', b.x, b.y); await sleep(400); };
    const state = (js) => evalJs(`(() => { const st = window.__designController.state; ${js} })()`);
    const W2S = (x, y) => evalJs(`(() => { const s = document.getElementById('design-canvas'); const p = s.createSVGPoint(); p.x = ${x}; p.y = ${y}; const q = p.matrixTransform(s.getScreenCTM()); return { x: Math.round(q.x), y: Math.round(q.y) }; })()`);
    const shot = async (name, clip) => {
      const r = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 2 } } : {}) });
      const buf = Buffer.from(r.data, 'base64');
      if (process.env.EVIDENCE_DIR) fs.writeFileSync(path.join(process.env.EVIDENCE_DIR, name), buf);
      return createHash('md5').update(buf).digest('hex');
    };
    const order = () => state(`return JSON.stringify(st.sketches.map(s => s.id));`).then(JSON.parse);

    const loaded = once('Page.loadEventFired');
    await send('Page.navigate', { url: `http://127.0.0.1:${port}/apps/shaper/index.html` });
    await Promise.race([loaded, sleep(8000)]); await waitFor(`!!document.querySelector('[data-mode="design"]')`, 'the Shaper to load');
    for (let i = 0; i < 5; i++) { await clickEl('[data-mode="design"]'); await sleep(300); if (await evalJs(`document.querySelector('.mode-btn.active').dataset.mode`) === 'design') break; }
    await waitForApp('design-canvas'); await waitFor(`!!window.__designController && document.getElementById('design-canvas').getBoundingClientRect().width > 0`, 'the Design tab to show');

    // three sketches, one line each, spread over the canvas
    await state(`
      for (const k of [...st.joints.keys()]) if (k !== 'j_origin') st.joints.delete(k);
      st.shapes.length = 0; st.constraints.length = 0; st.selectedShapes.clear(); st.selectedJoints.clear();
      const add = (sk, id, a, b, x1, y1, x2, y2) => { st.sketches.push({ id: sk, name: sk === 'sketch-2' ? 'Plate' : 'Holes', visible: true }); };
      st.sketches.length = 0; st.sketches.push({ id: 'sketch-1', name: 'Sketch 1', visible: true }, { id: 'sketch-2', name: 'Plate', visible: true }, { id: 'sketch-3', name: 'Holes', visible: true });
      const L = (sk, id, a, b, x1, y1, x2, y2) => { st.joints.set(a, { x: x1, y: y1, sketchId: sk }); st.joints.set(b, { x: x2, y: y2, sketchId: sk }); st.shapes.push({ id, type: 'line', joints: [a, b], sketchId: sk }); };
      L('sketch-1', 'LA', 'a1', 'a2', -40, -20, -10, -20);
      L('sketch-2', 'LB', 'b1', 'b2', -40, 10, -10, 10);
      L('sketch-3', 'LC', 'c1', 'c2', 10, 10, 40, 10);
      st.activeSketchId = 'sketch-1'; st.currentTool = 'select';
      return true;`);
    await sleep(800);

    // ---- (1) a real drag on a LOCKED sketch moves nothing (lock through the panel's real lock button)
    await clickEl('.sk-sketch-node[data-sketch-id="sketch-2"] .sk-sketch-lock');
    assert.strictEqual(await state(`return st.sketches[1].locked === true;`), true, 'the lock button locked Plate');
    const coords = (ids) => state(`return JSON.stringify(${JSON.stringify(ids)}.map(id => [st.joints.get(id).x, st.joints.get(id).y]));`);
    const before = await coords(['b1', 'b2', 'a1', 'c1']);
    const pb1 = await W2S(-40, 10);
    await dragReal(pb1, { x: pb1.x + 80, y: pb1.y + 60 });            // the locked point
    const pbm = await W2S(-25, 10);
    await dragReal(pbm, { x: pbm.x + 30, y: pbm.y - 70 });            // the locked line's body
    const afterLocked = await coords(['b1', 'b2', 'a1', 'c1']);
    assert.strictEqual(afterLocked, before, 'a real drag on the locked sketch moved nothing: ' + before + ' -> ' + afterLocked);
    assert.strictEqual(await state(`return st.selectedShapes.size + st.selectedJoints.size;`), 0, 'and selected nothing');
    const pa1 = await W2S(-40, -20);
    await dragReal(pa1, { x: pa1.x + 40, y: pa1.y + 30 });            // an unlocked sketch point still drags
    assert.notStrictEqual((await coords(['a1'])), JSON.stringify([JSON.parse(before)[2]]), 'the unlocked sketch point moved');
    // evidence: the panel with a locked sketch
    const panelBox = await evalJs(`(() => { const r = document.getElementById('design-panel-info').getBoundingClientRect(); return { x: Math.max(0, Math.floor(r.left)), y: Math.max(0, Math.floor(r.top)), width: Math.ceil(r.width), height: Math.min(Math.ceil(r.height), 220) }; })()`);
    const md5Locked = await shot('577-panel-locked.png', panelBox);

    // ---- (2) a real drag of the Holes grip above Sketch 1 reorders (one undo step)
    await clickEl('.sk-sketch-node[data-sketch-id="sketch-2"] .sk-sketch-lock'); // unlock again
    assert.deepStrictEqual(await order(), ['sketch-1', 'sketch-2', 'sketch-3']);
    const grip = await center('.sk-sketch-node[data-sketch-id="sketch-3"] .sk-sketch-grip');
    const top = await evalJs(`(() => { const r = document.querySelector('.sk-sketch-node[data-sketch-id="sketch-1"]').getBoundingClientRect(); return { y: Math.round(r.top + 3) }; })()`);
    const hist = await state(`return st.history.length;`);
    await dragReal(grip, { x: grip.x, y: top.y });
    assert.deepStrictEqual(await order(), ['sketch-3', 'sketch-1', 'sketch-2'], 'the real grip drag put Holes first');
    assert.strictEqual(await state(`return st.history.length;`), hist + 1, 'one undo step for the reorder');
    assert.deepStrictEqual(await evalJs(`[...document.querySelectorAll('.sk-sketch-node')].map(n => n.dataset.sketchId)`), ['sketch-3', 'sketch-1', 'sketch-2'], 'the tree shows the new order');
    // the keyboard twin: focus the Move down button and press Enter
    await evalJs(`document.querySelector('.sk-sketch-node[data-sketch-id="sketch-3"] .sk-sketch-down').focus()`);
    await sendRealKey(send, "Enter", "Enter", 13, 0, String.fromCharCode(13)); await sleep(300);
    assert.deepStrictEqual(await order(), ['sketch-1', 'sketch-3', 'sketch-2'], 'Enter on the Move down button reorders (keyboard)');

    // ---- (3) solo (real click) + evidence, then the second click restores
    await clickEl('.sk-sketch-node[data-sketch-id="sketch-3"] .sk-sketch-solo');
    assert.deepStrictEqual(await state(`return st.sketches.map(s => s.visible);`), [false, true, false], 'solo hid the others (order is now 1, 3, 2)');
    const md5Solo = await shot('577-panel-solo.png', panelBox);
    await clickEl('.sk-sketch-node[data-sketch-id="sketch-3"] .sk-sketch-solo');
    assert.deepStrictEqual(await state(`return st.sketches.map(s => s.visible);`), [true, true, true], 'the second click restored');

    // ---- (4) right click on a selected line: "Move to sketch ▸ ..." moves it
    await state(`st.selectedShapes.clear(); st.selectedJoints.clear(); st.currentTool = 'select'; return true;`);
    const mid = await W2S(25, 10); // Holes' line LC
    await mouse('mouseMoved', mid.x, mid.y); await sleep(150);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: mid.x, y: mid.y, button: 'right', buttons: 2, clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: mid.x, y: mid.y, button: 'right', buttons: 0, clickCount: 1 }); await sleep(400);
    const items = await evalJs(`[...document.querySelectorAll('.sk-context-menu .sk-context-item')].map(r => r.dataset.id + '=' + r.textContent.replace('✓','').trim())`);
    assert(items.includes('geo-move-sketch-2=Move to sketch ▸ Plate'), 'the menu lists Move to sketch ▸ Plate: ' + JSON.stringify(items));
    await clickEl('.sk-context-menu .sk-context-item[data-id="geo-move-sketch-2"]');
    assert.strictEqual(await state(`return st.shapes.find(s => s.id === 'LC').sketchId;`), 'sketch-2', 'the menu moved LC to Plate');

    console.log(`LIVE-OK locked-drag unchanged ${before}; reorder by real grip drag; keyboard Enter on Move down; solo + restore; context-menu move. md5 locked=${md5Locked} solo=${md5Solo}`);
  } finally { await cdp.close(); }
})();
