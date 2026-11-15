// tests/inactive-sketch-dim-661-live.test.js -- TASK 661 (live headless, REAL mouse via CDP, Pen Plotter = the shared Design tab): two overlapping
// sketches. The inactive sketch's group computes opacity 0.33 (the token --sk-inactive-sketch-opacity) and the active sketch's markup is at full
// opacity; making the other sketch active swaps it at once; a REAL click on an inactive line selects it and its highlight is fully opaque.
// Screenshots: EVIDENCE_DIR (default .evidence/661).
import assert from 'node:assert';
import { resetBufferLive } from './helpers/reset-buffer.js';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser } from './helpers/cdp-browser.js';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const EVID = process.env.EVIDENCE_DIR || path.join(process.cwd(), '.evidence', '661');
const STATE = 'window.__sketch.controller.state';

await (async () => {
  const cdp = await launchBrowser({ tag: '661', width: 1600, height: 900 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, once, evalJs, waitFor, waitForApp } = cdp;
  try {
    fs.mkdirSync(EVID, { recursive: true });
    const shot = async (file, clip) => { const r = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 2 } } : {}) }); fs.writeFileSync(path.join(EVID, file), Buffer.from(r.data, 'base64')); };
    const key = async (k, code, vk) => { await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk }); await sleep(120); };
    const mouse = (type, x, y, buttons) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
    const tap = async (p) => { await mouse('mouseMoved', p.x, p.y, 0); await sleep(60); await mouse('mousePressed', p.x, p.y, 1); await sleep(40); await mouse('mouseReleased', p.x, p.y, 0); await sleep(250); };
    const world = (expr) => evalJs(`JSON.stringify(${expr})`).then(JSON.parse);
    const activate = (id) => evalJs(`import('/packages/core/sketch-model.js').then((m) => m.activateSketch(${STATE}, ${JSON.stringify(id)}))`).then(() => sleep(250));
    // the effective opacity of a drawn element: its own times every ancestor's, up to the world group
    const opacityOf = (sel) => evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; let o = 1; for (let n = e; n && n.tagName !== 'svg'; n = n.parentElement) o *= parseFloat(getComputedStyle(n).opacity); return o; })()`);

    const loaded = once('Page.loadEventFired');
    await send('Page.navigate', { url: `http://127.0.0.1:${port}/apps/penplotter/index.html` });
    await Promise.race([loaded, sleep(8000)]);
    await waitFor(`!!document.querySelector('.sk-header-tab[data-tab="design"]')`, 'the stage button');
    await evalJs(`document.querySelector('.sk-header-tab[data-tab="design"]').click()`);
    await waitForApp('design-canvas');
    await waitFor(`document.querySelector('#design-canvas').getBoundingClientRect().width > 0 && !!${STATE}`, 'the design canvas');
    await sleep(500);
    const cr = await evalJs(`(() => { const r = document.querySelector('#design-canvas').getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height }; })()`);
    const C = { x: Math.round(cr.l + cr.w * 0.5), y: Math.round(cr.t + cr.h * 0.4) };
    const arm = Math.round(Math.min(cr.w * 0.3, 150));
    const tool = async (id) => { if (await evalJs(`${STATE}.currentTool`) !== id.replace('tool-', '')) { await evalJs(`document.querySelector('#${id}').click()`); await sleep(200); } };
    const clip = { x: Math.max(0, C.x - 190), y: Math.max(0, C.y - 170), width: Math.min(380, cr.w), height: 380 };
    const drawLine = async (a, b) => { await tool('tool-line'); await tap(a); await tap(b); await key('Escape', 'Escape', 27); };

    await evalJs(`(() => { const st = ${STATE}; st.shapes.length = 0; st.constraints.length = 0; [...st.joints.keys()].forEach((id) => { if (id !== 'j_origin') st.joints.delete(id); }); st.triggerDraw && st.triggerDraw(); })()`);
    await evalJs(`import('/packages/core/sketch-model.js').then((m) => { if (!${STATE}.sketches.some((s) => s.id === 'sketch-2')) m.addSketch(${STATE}, 'Sketch 2'); })`);

    // two overlapping sketches: a horizontal line in Sketch 2, a diagonal crossing it in Sketch 1, then Sketch 1 is active
    await activate('sketch-2'); await drawLine({ x: C.x - arm, y: C.y }, { x: C.x + arm, y: C.y });
    await activate('sketch-1'); await drawLine({ x: C.x - arm, y: C.y - arm }, { x: C.x + arm, y: C.y + arm });
    const ids = await world(`${STATE}.shapes.filter((s) => s.type === 'line').map((s) => [s.id, s.sketchId])`);
    const idOf = (sk) => ids.find(([, s]) => s === sk)[0];
    const [one, two] = [idOf('sketch-1'), idOf('sketch-2')];
    const line = (id) => `#design-canvas line.shape-elem[data-shape-id="${id}"]`;
    await tool('tool-select');
    await sleep(300);

    // 1. Sketch 1 active: Sketch 2 dimmed to the token's 0.33, Sketch 1 at 1
    const token = await evalJs(`getComputedStyle(document.querySelector('#design-canvas .sketch-inactive')).getPropertyValue('--sk-inactive-sketch-opacity').trim()`);
    assert.strictEqual(token, '0.33', 'the token --sk-inactive-sketch-opacity is written from the INACTIVE_SKETCH_OPACITY setting (default 33): ' + token);
    assert.strictEqual(await evalJs(`import('/packages/core/settings-manager.js').then((m) => m.default.getDefault('INACTIVE_SKETCH_OPACITY'))`), 33, 'declared default 33');
    assert.strictEqual(await evalJs(`getComputedStyle(document.querySelector('#design-canvas .sketch-inactive[data-sketch-id="sketch-2"]')).opacity`), '0.33', 'the inactive group computes opacity 0.33');
    assert.strictEqual(await opacityOf(line(two)), 0.33, 'Sketch 2 line draws at 0.33');
    assert.strictEqual(await opacityOf(line(one)), 1, 'Sketch 1 (active) line draws at 1');
    assert.strictEqual(await evalJs(`!!document.querySelector('#design-canvas .sketch-inactive[data-sketch-id="sketch-1"]')`), false, 'the active sketch has no dimmed group');
    await shot('after-1-sketch-1-active.png', clip);

    // 2. making Sketch 2 active swaps it at once
    await activate('sketch-2');
    assert.strictEqual(await opacityOf(line(two)), 1, 'Sketch 2 line is now at 1');
    assert.strictEqual(await opacityOf(line(one)), 0.33, 'Sketch 1 line is now at 0.33');
    await shot('after-2-sketch-2-active.png', clip);
    await activate('sketch-1');

    // 3. a REAL click on the inactive line selects it; its highlight is fully opaque while the rest of Sketch 2 stays dimmed
    await tap({ x: C.x - Math.round(arm / 2), y: C.y });
    assert.deepStrictEqual(await world(`[...${STATE}.selectedShapes]`), [two], 'a real click picks the inactive Sketch 2 line');
    assert.strictEqual(await opacityOf(line(two)), 1, 'the selected inactive line is fully opaque');
    assert.ok(await evalJs(`parseFloat(document.querySelector(${JSON.stringify(line(two))}).getAttribute('stroke-width')) > parseFloat(document.querySelector(${JSON.stringify(line(one))}).getAttribute('stroke-width'))`), 'and drawn in the thicker selection stroke');
    await shot('after-3-inactive-line-selected.png', clip);
    await mouse('mouseMoved', C.x + arm, C.y - arm, 0); await key('Escape', 'Escape', 27); // off the line, then deselect
    await tap({ x: C.x + arm, y: C.y - Math.round(arm / 2) }); // a click on empty canvas
    assert.deepStrictEqual(await world(`[...${STATE}.selectedShapes]`), [], 'nothing selected');
    assert.strictEqual(await opacityOf(line(two)), 0.33, 'deselected and not hovered, it dims again');

    // 4. the Style panel row (Lines & Joints tab; Shaper and SketchStudio mount the panel): a real edit changes the computed opacity live; Reset restores 33
    await resetBufferLive(cdp); // TASK 684: the open tabs are ONE list for all apps: a new host starts from an empty Untitled, not the previous host's drawing
    const loaded2 = once('Page.loadEventFired');
    await send('Page.navigate', { url: `http://127.0.0.1:${port}/apps/shaper/index.html` });
    await Promise.race([loaded2, sleep(8000)]);
    await waitFor(`!!document.querySelector('.sk-header-tab[data-tab="design"]')`, 'the Shaper');
    await evalJs(`document.querySelector('.sk-header-tab[data-tab="design"]').click()`);
    await waitFor(`!!window.__designController && document.querySelector('#design-canvas').getBoundingClientRect().width > 0`, 'the Shaper design canvas');
    const SH = 'window.__designController.state';
    await evalJs(`import('/packages/core/sketch-model.js').then((m) => { const st = ${SH}; if (!st.sketches.some((x) => x.id === 'sketch-2')) m.addSketch(st, 'Sketch 2');
      st.joints.set('q1', { x: -20, y: 0, sketchId: 'sketch-2' }); st.joints.set('q2', { x: 20, y: 0, sketchId: 'sketch-2' });
      st.shapes.push({ id: 'q', type: 'line', joints: ['q1', 'q2'], sketchId: 'sketch-2' }); m.activateSketch(st, 'sketch-1'); st.triggerDraw && st.triggerDraw(); })`);
    await sleep(500);
    const P = '.sk-style-panel', ROW = `${P} [data-key="INACTIVE_SKETCH_OPACITY"]`;
    const center = (sel) => evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return r.width && r.height ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null; })()`);
    const click = async (sel, n = 1) => { await waitFor(`!!document.querySelector(${JSON.stringify(sel)}) && document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect().width > 0`, sel + ' visible'); const c = await center(sel); await mouse('mouseMoved', c.x, c.y, 0); await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: c.x, y: c.y, button: 'left', buttons: 1, clickCount: n }); await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: c.x, y: c.y, button: 'left', buttons: 0, clickCount: n }); await sleep(150); };
    const groupOpacity = () => evalJs(`getComputedStyle(document.querySelector('#design-canvas .sketch-inactive')).opacity`);
    await click('.sk-sidebar-btn'); await sleep(150); await click('.sk-sidebar [data-action="settings"]');
    await waitFor(`!document.querySelector('${P}').classList.contains('sk-hidden')`, 'the Style panel');
    await click(`${P} .sk-style-tab`); // the first tab is Lines & Joints
    await waitFor(`!!document.querySelector('${ROW}') && document.querySelector('${ROW}').getBoundingClientRect().width > 0`, 'the Inactive sketch opacity row');
    assert.strictEqual(await groupOpacity(), '0.33', 'Shaper before: 0.33');
    await click(ROW, 3); await send('Input.insertText', { text: '60' }); await sleep(300);
    assert.strictEqual(await groupOpacity(), '0.6', 'the row set to 60 changes the inactive group live');
    assert.strictEqual(await evalJs(`import('/packages/core/settings-manager.js').then((m) => m.default.get('INACTIVE_SKETCH_OPACITY'))`), 60, 'stored as the percent');
    const pr = await evalJs(`(() => { const r = document.querySelector('${P}').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`);
    await shot('after-4-style-panel-row.png', pr);
    await click(`${P} .sk-style-foot .sk-style-btn`); await sleep(300); // Reset
    assert.strictEqual(await groupOpacity(), '0.33', 'Reset restores 33');
    console.log('inactive-sketch-dim-661-live.test.js: ok');
  } finally { await cdp.close(); }
})();
