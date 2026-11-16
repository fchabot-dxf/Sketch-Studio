// tests/dim-box-place-723-live.test.js — TASK 723 send-back (live headless; REAL mouse 1280 x 800 + REAL touch 390 x 844; SketchStudio, Shaper, Pen Plotter).
// The dimension EDIT box sits ON its label and inside the canvas, and view navigation does not close it:
//  - a line drawn with the Line tool, its length dimension placed (select + D + a press) and kept (Enter); a double press on the label opens the box:
//    |box centre - label centre| <= NEAR (12) px and the label centre inside the box, the box inside the canvas svg's rect;
//  - mouse: with "9" typed, a MIDDLE-button press-drag pans the view: the box stays open with "9" and moves with the drawing (its offset from the line's
//    midpoint changes <= 3 px); a second pan that carries the label past the canvas's right edge leaves the box inside the canvas (held at that edge).
// Was (measured before the fix): SketchStudio's box sat the canvas container's offset below its label (~180 px; 857 px down on an 800 px screen),
// and a middle press closed the box. Screenshots (local): .evidence/723/<EVID_TAG>-place-<host>-<kind>.png
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sleep, sendRealKey } from './helpers/cdp-browser.js';
import { pressRibbonTool } from './helpers/ribbon-tool.js';
import { resetBufferLive } from './helpers/reset-buffer.js';

const EVID = path.resolve('.evidence/723');
const TAG = process.env.EVID_TAG || 'run';
const NEAR = 12; // px: the box is centred on the label's own point (glyphPos); the label TEXT is drawn just above that point (its centre measured 7.5 px off)
fs.mkdirSync(EVID, { recursive: true });
const HOSTS = [
  { name: 'sketchstudio', url: '/apps/sketchstudio/index.html', canvas: '#svgCanvas' },
  { name: 'shaper', url: '/apps/shaper/index.html', canvas: '#design-canvas', enter: true },
  { name: 'penplotter', url: '/apps/penplotter/index.html', canvas: '#design-canvas', enter: true },
];

const cdp = await launchBrowser({ tag: '723-dim-place', width: 1280, height: 800 });
if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
const { port, send, evalJs, waitFor, navigate, close } = cdp;
const failed = [];

try {
  const mouseEv = (type, x, y, buttons = 0, clickCount = 1, button) => send('Input.dispatchMouseEvent', { type, x, y, button: button || (type === 'mouseMoved' && !buttons ? 'none' : 'left'), buttons, clickCount: type === 'mouseMoved' ? 0 : clickCount });
  const T = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i + 1, radiusX: 1, radiusY: 1, force: 1 })) });
  const POINTERS = {
    mouse: {
      tap: async (p) => { await mouseEv('mouseMoved', p.x, p.y); await sleep(60); await mouseEv('mousePressed', p.x, p.y, 1); await sleep(40); await mouseEv('mouseReleased', p.x, p.y); await sleep(250); },
      twice: async (p) => { await mouseEv('mouseMoved', p.x, p.y); await sleep(60); for (const n of [1, 2]) { await mouseEv('mousePressed', p.x, p.y, 1, n); await sleep(30); await mouseEv('mouseReleased', p.x, p.y, 0, n); await sleep(60); } await sleep(400); },
      away: (p) => mouseEv('mouseMoved', p.x, p.y),
    },
    touch: {
      tap: async (p) => { await T('touchStart', [p]); await sleep(50); await T('touchEnd', []); await sleep(350); },
      twice: async (p) => { await T('touchStart', [p]); await sleep(40); await T('touchEnd', []); await sleep(90); await T('touchStart', [p]); await sleep(40); await T('touchEnd', []); await sleep(500); },
      away: async () => {},
    },
  };
  const middleDrag = async (a, b) => {
    await mouseEv('mouseMoved', a.x, a.y); await sleep(60);
    await mouseEv('mousePressed', a.x, a.y, 4, 1, 'middle');
    for (let i = 1; i <= 8; i++) { await mouseEv('mouseMoved', a.x + (b.x - a.x) * i / 8, a.y + (b.y - a.y) * i / 8, 4, 0, 'middle'); await sleep(30); }
    await mouseEv('mouseReleased', b.x, b.y, 0, 1, 'middle'); await sleep(400);
  };
  const key = async (k, code, vk, mods = 0, text = '') => { await sendRealKey(send, k, code, vk, mods, text); await sleep(200); };
  const box = () => evalJs(`(() => { const i = document.getElementById('dimInput'); if (!i) return null; const r = i.getBoundingClientRect();
    return { open: !i.classList.contains('hidden'), value: i.value, l: r.left, t: r.top, r: r.right, b: r.bottom, cx: r.left + r.width / 2, cy: r.top + r.height / 2 }; })()`);
  const rnd = (o) => JSON.stringify(o, (k, v) => (typeof v === 'number' ? Math.round(v) : v));

  for (const kind of (process.env.PHASES || 'mouse,touch').split(',')) {
    for (const h of HOSTS) {
      const tag = `[${kind} ${h.name}]`;
      const check = (cond, msg) => { if (!cond) { failed.push(`${tag} ${msg}`); console.log(`FAIL ${tag} ${msg}`); } };
      try {
        const P = POINTERS[kind];
        const phone = kind === 'touch';
        await resetBufferLive(cdp);
        await send('Emulation.setDeviceMetricsOverride', phone ? { width: 390, height: 844, deviceScaleFactor: 2, mobile: true } : { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
        await send('Emulation.setTouchEmulationEnabled', { enabled: phone, maxTouchPoints: phone ? 5 : 0 });
        await navigate(`http://127.0.0.1:${port}${h.url}`, 8000);
        await waitFor(`!!document.querySelector('.sk-ribbon .sk-ribbon-btn') && !!document.querySelector('${h.canvas}')`, `${tag} the ribbon`);
        if (h.enter) await evalJs(`document.querySelector('.sk-header-tab[data-tab="design"]').click()`);
        await waitFor(`document.querySelector('${h.canvas}').getBoundingClientRect().width > 0`, `${tag} the canvas`);
        await sleep(800);
        const C = h.canvas;
        const canvasRect = () => evalJs(`(() => { const r = document.querySelector('${C}').getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; })()`);
        const lines = () => evalJs(`(() => { const out = {}; for (const e of document.querySelectorAll('${C} line.shape-elem')) { const m = e.getScreenCTM();
          const p = (x, y) => { const q = new DOMPoint(x, y).matrixTransform(m); return { x: q.x, y: q.y }; };
          out[e.dataset.shapeId] = { a: p(+e.getAttribute('x1'), +e.getAttribute('y1')), b: p(+e.getAttribute('x2'), +e.getAttribute('y2')) }; }
          return JSON.stringify(out); })()`).then(JSON.parse);
        const labelIdxs = () => evalJs(`JSON.stringify([...document.querySelectorAll('${C} .dim-label')].map(e => e.dataset.constraintIdx))`).then(JSON.parse);
        const labelOf = (idx) => evalJs(`(() => { const e = document.querySelector('${C} .dim-label[data-constraint-idx="${idx}"] text') || document.querySelector('${C} .dim-label[data-constraint-idx="${idx}"]'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
        const along = (l, t) => ({ x: Math.round(l.a.x + (l.b.x - l.a.x) * t), y: Math.round(l.a.y + (l.b.y - l.a.y) * t) });
        const tool = (id) => pressRibbonTool(evalJs, P.tap, id);
        const inside = (bx, cr) => bx.l >= cr.l - 1 && bx.r <= cr.r + 1 && bx.t >= cr.t - 1 && bx.b <= cr.b + 1;

        // a line (the view may reframe after a draw: everything after is read from the screen)
        const cr0 = await canvasRect();
        const F = (fx, fy) => ({ x: Math.round(cr0.l + cr0.w * fx), y: Math.round(cr0.t + cr0.h * fy) });
        const before = Object.keys(await lines());
        await tool('tool-line'); await P.tap(F(0.58, 0.42)); await P.tap(F(0.90, 0.42)); // right of the y axis (a finger snaps to it from farther) await key('Escape', 'Escape', 27);
        const id = Object.keys(await lines()).find((k) => !before.includes(k));
        assert(id, `${tag} the line is drawn`);
        // its length dimension: select it, D, a press where the label goes (off the y axis), Enter keeps the length
        await tool('tool-select');
        let l = (await lines())[id];
        await P.tap(along(l, 0.3));
        await key('d', 'KeyD', 68);
        const labels0 = await labelIdxs();
        const drop = { x: along(l, 0.5).x, y: Math.round(along(l, 0.5).y - 50) };
        await P.away(drop); await sleep(150); await P.tap(drop);
        await waitFor(`(() => { const i = document.getElementById('dimInput'); return !!i && !i.classList.contains('hidden'); })()`, `${tag} the new dimension's box`, 8000);
        await key('Enter', 'Enter', 13, 0, '\r'); await sleep(300);
        await tool('tool-select');
        const idx = (await labelIdxs()).filter((i) => !labels0.includes(i)).pop() ?? (await labelIdxs()).pop();
        const lab = await labelOf(idx);
        assert(lab, `${tag} the dimension label is on screen`);

        // the box opened on the label
        await P.twice({ x: Math.round(lab.x), y: Math.round(lab.y) });
        await waitFor(`(() => { const i = document.getElementById('dimInput'); return !!i && !i.classList.contains('hidden'); })()`, `${tag} the box on the label`, 8000);
        await sleep(200);
        const b1 = await box(), cr1 = await canvasRect();
        const d1 = Math.hypot(b1.cx - lab.x, b1.cy - lab.y);
        console.log(`${tag} label centre ${rnd({ x: lab.x, y: lab.y })}, box ${rnd(b1)}, |box centre - label centre| ${d1.toFixed(1)} px, canvas ${rnd(cr1)}`);
        {
          const x = Math.max(0, Math.round(Math.min(lab.x, b1.l) - 120)), y = Math.max(0, Math.round(Math.min(lab.y, b1.t) - 80));
          const vw = phone ? 390 : 1280, vh = phone ? 844 : 800;
          const r = await send('Page.captureScreenshot', { format: 'png', clip: { x, y, width: Math.min(Math.round(Math.max(b1.r, lab.x) - x + 120), vw - x), height: Math.min(Math.round(Math.max(b1.b, lab.y) - y + 120), vh - y), scale: 2 } });
          fs.writeFileSync(path.join(EVID, `${TAG}-place-${h.name}-${kind}.png`), Buffer.from(r.data, 'base64'));
        }
        check(d1 <= NEAR && lab.x >= b1.l && lab.x <= b1.r && lab.y >= b1.t && lab.y <= b1.b, `the box sits on its label (|box centre - label centre| ${d1.toFixed(1)} px, bound ${NEAR}; the label centre inside the box)`);
        check(inside(b1, cr1), `the box is inside the canvas (box ${rnd(b1)}, canvas ${rnd(cr1)})`);

        if (!phone) {
          // a middle-button pan: the box stays open with its text and moves with the drawing
          await evalJs(`(() => { const i = document.getElementById('dimInput'); i.focus(); i.select(); })()`);
          await sendRealKey(send, '9', 'Digit9', 57, 0, '9'); await sleep(200);
          l = (await lines())[id];
          const off0 = { x: b1.cx - along(l, 0.5).x, y: b1.cy - along(l, 0.5).y };
          const grab = { x: Math.round(cr1.l + cr1.w * 0.8), y: Math.round(cr1.t + cr1.h * 0.75) };
          await middleDrag(grab, { x: grab.x + 60, y: grab.y + 40 });
          const b2 = await box(), l2 = (await lines())[id];
          const off2 = { x: b2.cx - along(l2, 0.5).x, y: b2.cy - along(l2, 0.5).y };
          const moved = Math.hypot(along(l2, 0.5).x - along(l, 0.5).x, along(l2, 0.5).y - along(l, 0.5).y);
          console.log(`${tag} middle pan (+60, +40): line moved ${moved.toFixed(1)} px, box ${rnd(b2)}, offset from the line's midpoint ${rnd(off0)} -> ${rnd(off2)}`);
          check(moved > 30, `the middle drag panned the view (the line moved ${moved.toFixed(1)} px)`);
          check(b2.open === true && b2.value === '9', `the box stays open with its text after a middle pan (box ${rnd(b2)})`);
          check(Math.hypot(off2.x - off0.x, off2.y - off0.y) <= 3, `the box moved with its label (offset ${rnd(off0)} -> ${rnd(off2)})`);
          // a pan that carries the label past the canvas's right edge: the box is held inside the canvas
          const cr3 = await canvasRect();
          const push = Math.round(cr3.r - along(l2, 0.5).x + 150);
          const g2 = { x: Math.round(cr3.l + cr3.w * 0.2), y: Math.round(cr3.t + cr3.h * 0.75) };
          await middleDrag(g2, { x: g2.x + Math.min(push, Math.round(cr3.w * 0.75)), y: g2.y });
          const b3 = await box(), l3 = (await lines())[id];
          console.log(`${tag} pan the label toward / past the right edge: line midpoint x ${Math.round(along(l3, 0.5).x)}, canvas right ${Math.round(cr3.r)}, box ${rnd(b3)}`);
          check(b3.open === true && b3.value === '9', `the box stays open after the second pan (box ${rnd(b3)})`);
          check(inside(b3, cr3), `the box stays inside the canvas while panned (box ${rnd(b3)}, canvas ${rnd(cr3)})`);
        }
        await evalJs(`document.getElementById('dimInput').focus()`); await key('Escape', 'Escape', 27);
      } catch (e) { failed.push(`${tag} stopped: ${e.message}`); console.log(`FAIL ${tag} stopped: ${e.message}`); }
    }
  }
  assert.deepStrictEqual(failed, [], `${failed.length} check(s) failed`);
  console.log('dim-box-place-723-live: ALL CHECKS PASSED');
} finally {
  await close();
}
