// tests/reference-lines-live.test.js - TASK 539 live (headless CDP, real pointer events), SketchStudio and Shaper:
// the X axis is lit (data-ref-axis) ONLY while a constraint tool asks for a target and the pointer is on it; never in Select, never
// while a line tool draws; a click on it in Select selects / drags nothing; a parallel pick (line, then axis) stores
// parallel [line, ref_axis_x] and the line turns horizontal; a real line lying on the axis wins the pick.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { CREATE_NAMED_DESIGN } from './helpers/named-design.js';
import { installFakeDriveSession } from './helpers/fake-drive-session.js';
import { launchBrowser, sendRealKey, sleep } from './helpers/cdp-browser.js';

await (async () => {
  const cdp = await launchBrowser({ tag: '539', width: 1600, height: 900 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, navigate, waitForApp, flushAutosave } = cdp;
  try {
    await installFakeDriveSession({ ws: cdp.ws, send, evalJs });
    const mouse = (type, x, y, buttons = 0) => send('Input.dispatchMouseEvent', { type, x, y, button: (buttons || type === 'mouseReleased') ? 'left' : 'none', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
    const move = async (x, y) => { await mouse('mouseMoved', x, y); await sleep(80); };
    const click = async (x, y) => { await move(x, y); await mouse('mousePressed', x, y, 1); await sleep(40); await mouse('mouseReleased', x, y, 0); await sleep(150); };
    const drag = async (a, b) => { await move(a.x, a.y); await mouse('mousePressed', a.x, a.y, 1); await sleep(60); for (let i = 1; i <= 8; i++) { await mouse('mouseMoved', a.x + (b.x - a.x) * i / 8, a.y + (b.y - a.y) * i / 8, 1); await sleep(30); } await mouse('mouseReleased', b.x, b.y, 0); await sleep(200); };
    const key = async (k, code, vk) => { await sendRealKey(send, k, code, vk); await sleep(120); };
    const esc = () => key('Escape', 'Escape', 27);
    const tool = async (t) => { await evalJs(`document.getElementById('tool-${t}').click()`); await sleep(200); };
    const EVID = process.env.EVIDENCE_DIR || '';
    const shot = async (name, clip) => { const r = await send('Page.captureScreenshot', { format: 'png', clip: { x: clip.x, y: clip.y, width: clip.w, height: clip.h, scale: 2 } }); if (EVID) { fs.mkdirSync(EVID, { recursive: true }); fs.writeFileSync(path.join(EVID, name), Buffer.from(r.data, 'base64')); } };
    const litCount = (axis) => evalJs(`document.querySelectorAll('[data-ref-axis${axis ? `="${axis}"` : ''}]').length`);
    const stored = () => evalJs(`import('/packages/ui/project-store.js').then(async ({ getProjectStore }) => {
      const s = getProjectStore(); await s.flushDrive();
      const id = await s.currentId(); if (!id) return null;
      const r = await s.get(id); const d = r && r.document;
      return d ? JSON.stringify({ shapes: d.geometry.shapes, constraints: d.geometry.constraints, joints: d.geometry.joints }) : null;
    })`).then((s) => s && JSON.parse(s));
    const toScreen = (canvas, wx, wy) => evalJs(`(() => { const s = document.querySelector('${canvas}'); const p = s.createSVGPoint(); p.x = ${wx}; p.y = ${wy}; const q = p.matrixTransform(s.getScreenCTM()); return { x: Math.round(q.x), y: Math.round(q.y) }; })()`);

    // ---- SketchStudio ----
    const url = `http://127.0.0.1:${port}/apps/sketchstudio/index.html`;
    await navigate(url); await waitForApp('svgCanvas');
    await evalJs(`new Promise((res) => { const r = indexedDB.deleteDatabase('sketch-studio-projects'); r.onsuccess = r.onerror = r.onblocked = () => res(1); setTimeout(() => res(1), 1500); })`);
    await navigate(url); await waitForApp('svgCanvas');
    await evalJs(CREATE_NAMED_DESIGN('sketchstudio')); // TASK 558: only a NAMED design autosaves (this test reads the autosave); the next load restores it
    await navigate(url); await waitForApp('svgCanvas');
    let o = await toScreen('#svgCanvas', 0, 0);
    // a sketch line well off the axes
    await tool('line'); await click(o.x + 200, o.y - 150); await click(o.x + 380, o.y - 60); await esc();
    // Select: the axis is not lit, not selectable, not draggable
    await tool('select');
    await move(o.x + 250, o.y); assert((await litCount()) === 0, 'select: the X axis is not lit under the pointer');
    await click(o.x + 250, o.y); assert((await litCount()) === 0, 'select: clicking the axis selects nothing');
    await drag({ x: o.x + 250, y: o.y }, { x: o.x + 250, y: o.y + 80 }); await esc();
    let d = await stored(); assert(d && d.constraints.every((c) => !JSON.stringify(c).includes('ref_axis')), 'select: no axis constraint');
    // drawing: the axis is not lit while the line tool is armed and hovers it
    await tool('line'); await move(o.x + 250, o.y + 40); assert((await litCount()) === 0, 'line tool: no ref-axis lit'); await esc();
    // Parallel tool: lit while hovering the axis, not elsewhere
    await tool('parallel');
    await move(o.x + 250, o.y + 120); assert((await litCount()) === 0, 'parallel: pointer 120 px off the axis = not lit');
    await shot('before-hover-off.png', { x: o.x + 120, y: o.y - 200, w: 400, h: 260 });
    await move(o.x + 250, o.y + 6); assert((await litCount('ref_axis_x')) === 1, 'parallel: the X axis lights up under the pointer');
    await shot('after-hover-lit.png', { x: o.x + 120, y: o.y - 200, w: 400, h: 260 });
    await move(o.x, o.y + 200); assert((await litCount('ref_axis_y')) === 1 && (await litCount('ref_axis_x')) === 0, 'parallel: the Y axis lights up on its own');
    // pick: the sketch line, then the X axis
    await click(o.x + 290, o.y - 105);
    await click(o.x + 250, o.y + 3);
    await flushAutosave();
    d = await stored();
    const par = d.constraints.find((c) => c.type === 'parallel');
    assert(par && par.shapes.includes('ref_axis_x'), 'parallel stored against the axis: ' + JSON.stringify(d.constraints));
    const line = d.shapes.find((s) => s.type === 'line'); const jo = (e) => Object.fromEntries(Array.isArray(e) ? e : Object.entries(e));
    const J = Array.isArray(d.joints) ? Object.fromEntries(d.joints.map((e) => Array.isArray(e) ? e : [e.id, e])) : d.joints;
    assert(Math.abs(J[line.joints[0]].y - J[line.joints[1]].y) < 1e-3, 'the line is now horizontal: ' + JSON.stringify([J[line.joints[0]], J[line.joints[1]]]));
    assert(d.shapes.length === 1 && !d.shapes.some((s) => s.reference) && !JSON.stringify(d.joints).includes('j_ref'), 'no axis in the saved shapes / joints');
    assert(d.shapes.length === 1, 'shape count unchanged by the axis');
    // back in Select: the axis is again not pickable
    await tool('select'); await move(o.x + 250, o.y + 3); assert((await litCount()) === 0, 'select again: not lit');
    // real line on the axis wins the tie: draw a line ON the X axis (axis snap), then Parallel tool hover over it
    await tool('line'); await click(o.x + 120, o.y + 4); await click(o.x + 320, o.y + 4); await esc();
    await tool('parallel'); await move(o.x + 220, o.y + 1);
    assert((await litCount()) === 0, 'a sketch line lying on the axis wins: the axis is not lit over it');
    await esc();
    console.log('SketchStudio: reference-line picking ok');

    // ---- Shaper ----
    await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`);
    await evalJs(`localStorage.clear(); document.querySelector('.sk-header-tab[data-tab="design"]').click()`); await waitForApp('design-canvas'); await sleep(300);
    o = await toScreen('#design-canvas', 0, 0);
    await tool('line'); await click(o.x + 200, o.y - 150); await click(o.x + 380, o.y - 60); await esc();
    await tool('select'); await move(o.x + 900, o.y); assert((await litCount()) === 0, 'Shaper select: not lit');
    await tool('parallel'); await move(o.x + 900, o.y + 120); assert((await litCount()) === 0, 'Shaper parallel: off the axis not lit');
    await move(o.x + 250, o.y + 6); await move(o.x + 900, o.y + 6); assert((await litCount('ref_axis_x')) === 1, 'Shaper parallel: the X axis lights up');
    await shot('shaper-after-hover-lit.png', { x: o.x + 120, y: o.y - 200, w: 400, h: 260 });
    await tool('select'); await move(o.x + 900, o.y + 6); assert((await litCount()) === 0, 'Shaper select again: not lit');
    console.log('Shaper: reference-line picking ok');
    console.log('reference-lines-live: ok');
  } finally {
    await cdp.close();
  }
})();
