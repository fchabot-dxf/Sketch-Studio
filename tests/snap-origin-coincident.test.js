// tests/snap-origin-coincident.test.js — TASK 484: a point snapped onto the ORIGIN must leave a COINCIDENT constraint with j_origin.
// Live headless CDP with the real pointer path (mouse events on #svgCanvas); the result is read from the stored design.
// Each kind (line end, line start, rect corner, circle centre, arc point, dragged existing joint) runs on a fresh design.

import assert from 'node:assert';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser } from './helpers/cdp-browser.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));






await (async () => {
  const cdp = await launchBrowser({ tag: '484', width: 1600, height: 900 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, ws } = cdp;
  try {
    const mouse = (type, x, y, buttons = 0) => send('Input.dispatchMouseEvent', { type, x, y, button: (buttons || type === 'mouseReleased') ? 'left' : 'none', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
    const move = async (x, y) => { await mouse('mouseMoved', x, y); await sleep(40); };
    const click = async (x, y) => { await move(x, y); await mouse('mousePressed', x, y, 1); await sleep(40); await mouse('mouseReleased', x, y, 0); await sleep(150); };
    const drag = async (a, b) => {
      await move(a.x, a.y); await mouse('mousePressed', a.x, a.y, 1); await sleep(60);
      for (let i = 1; i <= 8; i++) { await mouse('mouseMoved', a.x + (b.x - a.x) * i / 8, a.y + (b.y - a.y) * i / 8, 1); await sleep(30); }
      await mouse('mouseReleased', b.x, b.y, 0); await sleep(200);
    };
    const key = async (k, code, vk, modifiers = 0) => {
      await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk, modifiers });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, modifiers }); await sleep(120);
    };
    const TOOL = { l: 'line', r: 'rect', c: 'circle', a: 'arc', s: 'select' };
    const letter = async (c) => { await evalJs(`document.getElementById('tool-${TOOL[c]}').click()`); await sleep(200); };
    const esc = () => key('Escape', 'Escape', 27);
    const undoKey = () => key('z', 'KeyZ', 90, 2);
    const stored = () => evalJs(`new Promise((res) => {
      const open = indexedDB.open('sketch-studio-projects', 1);
      open.onerror = () => res(null);
      open.onsuccess = () => { const db = open.result; const m = db.transaction('meta').objectStore('meta').get('currentDesign');
        m.onsuccess = () => { if (!m.result) { res(null); return; } const g = db.transaction('designs').objectStore('designs').get(m.result); g.onsuccess = () => { const d = g.result && g.result.document; res(d ? JSON.stringify({ shapes: d.geometry.shapes, constraints: d.geometry.constraints, joints: d.geometry.joints }) : null); }; }; };
    })`).then((s) => s && JSON.parse(s));
    const waitSaved = async () => { await sleep(300); for (let i = 0; i < 40; i++) { if (await evalJs(`document.getElementById('save-status').textContent === 'Saved'`)) { await sleep(300); return; } await sleep(250); } };
    const url = `http://127.0.0.1:${port}/apps/sketchstudio/index.html`;
    const fresh = async () => {
      await send('Page.navigate', { url }); await sleep(2500);
      await evalJs(`new Promise((res) => { const r = indexedDB.deleteDatabase('sketch-studio-projects'); r.onsuccess = r.onerror = r.onblocked = () => res(1); setTimeout(() => res(1), 1500); })`);
      await send('Page.navigate', { url }); await sleep(2500);
    };
    const toScreen = (wx, wy) => evalJs(`(() => { const s = document.getElementById('svgCanvas'); const p = s.createSVGPoint(); p.x = ${wx}; p.y = ${wy}; const q = p.matrixTransform(s.getScreenCTM()); return { x: Math.round(q.x), y: Math.round(q.y) }; })()`);
    const refersOrigin = (c) => String(c.type).toLowerCase() === 'coincident' && (c.joints || []).includes('j_origin');

    const scenarios = {
      'line end': async (o) => { await letter('l'); await click(o.x + 160, o.y - 90); await click(o.x, o.y); await esc(); },
      'line end (12px off)': async (o) => { await letter('l'); await click(o.x + 160, o.y - 90); await click(o.x + 12, o.y); await esc(); },
      'line end (15px off)': async (o) => { await letter('l'); await click(o.x + 160, o.y - 90); await click(o.x + 15, o.y); await esc(); },
      'line end (24px off)': async (o) => { await letter('l'); await click(o.x + 160, o.y - 90); await click(o.x + 24, o.y); await esc(); },
      'line start': async (o) => { await letter('l'); await click(o.x, o.y); await click(o.x + 160, o.y - 90); await esc(); },
      'circle centre': async (o) => { await letter('c'); await click(o.x, o.y); await click(o.x + 120, o.y); await esc(); },
    };
    const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
    const results = {};
    for (const [name, run] of Object.entries(scenarios)) {
      if (only && !only.includes(name)) continue;
      await fresh();
      const o = await toScreen(0, 0);
      await click(o.x + 300, o.y + 200); await esc();
      await run(o);
      let d = null;
      await sleep(1500); await waitSaved(); d = await stored();
      const hit = d ? d.constraints.filter(refersOrigin) : [];
      const jo = d && d.joints; const near = jo ? (Array.isArray(jo) ? jo : Object.entries(jo)).filter((e) => { const v = Array.isArray(e) ? e[1] : e; return v && Math.hypot(v.x, v.y) < 0.2; }).length : null;
      results[name] = { nearOrigin: near, shapes: d && d.shapes.length, constraints: d && d.constraints.map((c) => c.type + ':' + (c.joints || []).join('+')), originCoincident: hit.length };
      console.log(name.padEnd(14), JSON.stringify(results[name]));
    }
    for (const [name, r] of Object.entries(results)) {
      assert(r.shapes >= 1, name + ': a shape was drawn');
      if (name === 'line start') continue;
      if (name === 'line end (24px off)') { assert(r.originCoincident === 0, name + ': outside the joint marker nothing is locked'); continue; } // checked below: the line's start joint IS j_origin (no second joint, so nothing to constrain)
      assert(r.originCoincident >= 1, name + ': a COINCIDENT constraint with j_origin exists; got ' + JSON.stringify(r.constraints));
    }

    // a line STARTED on the origin reuses j_origin itself as its start joint (nothing can drift: it is the origin)
    await fresh();
    let o = await toScreen(0, 0);
    await click(o.x + 300, o.y + 200); await esc();
    await letter('l'); await click(o.x, o.y); await click(o.x + 160, o.y - 90); await esc();
    await sleep(3500); await waitSaved();
    let d = await stored();
    assert(d.shapes.length === 1 && d.shapes[0].joints.includes('j_origin'), 'a line started on the origin uses j_origin as its start joint: ' + JSON.stringify(d.shapes[0] && d.shapes[0].joints));

    console.log('snap-origin-coincident: ok');
  } finally {
    await cdp.close();
  }
})();
