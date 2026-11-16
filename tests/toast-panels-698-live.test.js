// tests/toast-panels-698-live.test.js — TASK 698: toasts never cover an open floating window (the Parameters window, the Pattern dialog).
// Live (real headless browser), SketchStudio: desktop 1280x800 mouse and phone 390x844 touch. The Parameters window gets four user parameters (typed in
// the table), 3 toasts show; every toast rect is checked against the window rect and every row; a REAL click / tap on every row's Expression cell
// (the lowest one first: it is the one the toasts covered) focuses it, and a real edit of the lowest row applies. Desktop also drags the window over the
// toast spot (toasts already showing move away from it). EVID_PREFIX (default 'after') + .evidence/698: cropped screenshots.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sendRealKey, sleep } from './helpers/cdp-browser.js';
import { resetBufferLive } from './helpers/reset-buffer.js';

const EVID = path.resolve('.evidence/698');
fs.mkdirSync(EVID, { recursive: true });
const PREFIX = process.env.EVID_PREFIX || 'after';
const VIEWPORTS = [
  { name: 'desktop-1280x800', w: 1280, h: 800, touch: false },
  { name: 'phone-390x844', w: 390, h: 844, touch: true },
];
const cdp = await launchBrowser({ tag: '698-toast-panels', width: 1280, height: 800 });
if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
const { port, send, evalJs, waitFor, waitForApp, navigate, close } = cdp;
const hits = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
const R = (r) => ({ left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom) });
let failures = 0;
const check = (cond, msg) => { if (!cond) { failures++; console.log('FAIL: ' + msg); } else console.log('ok: ' + msg); };
const T = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i, radiusX: 1, radiusY: 1, force: 1 })) });

try {
  for (const vp of VIEWPORTS) {
    const tag = vp.name;
    await resetBufferLive(cdp);
    await send('Emulation.setDeviceMetricsOverride', { width: vp.w, height: vp.h, deviceScaleFactor: vp.touch ? 2 : 1, mobile: vp.touch,
      ...(vp.touch ? { screenOrientation: { type: 'portraitPrimary', angle: 0 } } : {}) });
    await send('Emulation.setTouchEmulationEnabled', { enabled: vp.touch, maxTouchPoints: vp.touch ? 5 : 1 });
    await navigate(`http://127.0.0.1:${port}/apps/sketchstudio/index.html`, 10000);
    await evalJs(`localStorage.removeItem('sk-parameters')`);
    await waitForApp('svgCanvas');
    await waitFor(`!!document.getElementById('btn-parameters')`, 'footer Parameters button');
    const mouseEv = (type, x, y, buttons = 0) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
    const tap = async (x, y) => {
      if (vp.touch) { await T('touchStart', [{ x, y }]); await sleep(40); await T('touchEnd', []); await sleep(300); return; }
      await mouseEv('mouseMoved', x, y); await sleep(30); await mouseEv('mousePressed', x, y, 1); await sleep(30); await mouseEv('mouseReleased', x, y); await sleep(250);
    };
    const center = (sel, i = 0) => evalJs(`(() => { const e = document.querySelectorAll(${JSON.stringify(sel)})[${i}]; if (!e) return null; e.scrollIntoView({ block: 'nearest' }); const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    const press = async (sel, i = 0) => { const c = await center(sel, i); assert(c, sel + ' not found'); await tap(c.x, c.y); };
    const key = (k, code, vk, mods = 0, text = '') => sendRealKey(send, k, code, vk, mods, text);
    const typeText = async (text) => {
      for (const ch of text) {
        const code = /[a-z]/i.test(ch) ? 'Key' + ch.toUpperCase() : /\d/.test(ch) ? 'Digit' + ch : ch === ' ' ? 'Space' : 'Equal';
        const vk = /[a-z]/i.test(ch) ? ch.toUpperCase().charCodeAt(0) : /\d/.test(ch) ? ch.charCodeAt(0) : ch === ' ' ? 32 : 187;
        await key(ch, code, vk, 0, ch); await sleep(15);
      }
      await sleep(150);
    };
    const drag = async (to) => {
      const h = await center('.sk-pwin .sk-dock-header');
      await mouseEv('mouseMoved', h.x, h.y); await mouseEv('mousePressed', h.x, h.y, 1);
      for (let i = 1; i <= 8; i++) { await mouseEv('mouseMoved', h.x + (to.x - h.x) * i / 8, h.y + (to.y - h.y) * i / 8, 1); await sleep(20); }
      await mouseEv('mouseReleased', to.x, to.y); await sleep(500);
    };

    await press('#btn-parameters');
    await waitFor(`(() => { const e = document.querySelector('.sk-pwin'); return !!e && !e.hidden && e.getBoundingClientRect().width > 0; })()`, `${tag}: Parameters window open`);
    for (const nm of ['a', 'b', 'c', 'd']) {
      await press('.sk-pwin .pt-add');
      await waitFor(`!!document.querySelector('.sk-pwin tr.sk-ptable-row input:focus')`, `${tag}: new row focused`);
      await key('Tab', 'Tab', 9); // Name -> Expression: `name = value` there fills both
      await typeText(`${nm} = 1${nm.charCodeAt(0) - 96}`);
      await key('Enter', 'Enter', 13, 0, '\r'); await sleep(300);
    }
    await waitFor(`document.querySelectorAll('.sk-pwin tr.sk-ptable-row[data-name]').length >= 4`, `${tag}: four rows`);
    if (!vp.touch) await drag({ x: Math.round(vp.w / 2), y: Math.round(vp.h - 360) }); // over the bottom-centre toast spot
    await evalJs(`(() => { const c = document.getElementById('notification-container'); if (c) c.innerHTML = ''; })()`);
    for (const [n, lvl] of [[1, 'error'], [2, 'warning'], [3, 'info']]) {
      await evalJs(`window.ug.notify('Parameter notice #${n}: the value 3 / 0 is not a number, kept the old one', '${lvl}', 20000)`);
      await sleep(80);
    }
    await sleep(500);
    const snap = async (name) => {
      const win = await evalJs(`(() => { const r = document.querySelector('.sk-pwin').getBoundingClientRect(); return { y: r.top, height: r.height }; })()`);
      const y = Math.max(0, win.y - 130);
      const clip = { x: 0, y, width: vp.w, height: Math.min(vp.h - y, win.height + 260), scale: 1 };
      const s = await send('Page.captureScreenshot', { format: 'png', clip });
      fs.writeFileSync(path.join(EVID, `${PREFIX}-${tag}-${name}.png`), Buffer.from(s.data, 'base64'));
    };
    const measure = () => evalJs(`(() => {
      const w = document.querySelector('.sk-pwin').getBoundingClientRect();
      const rows = [...document.querySelectorAll('.sk-pwin tr.sk-ptable-row[data-name]')].map((tr) => { const i = tr.querySelector('input[data-col="expression"]'); const r = i.getBoundingClientRect(); const cx = Math.round(r.left + r.width / 2), cy = Math.round(r.top + r.height / 2); const h = document.elementFromPoint(cx, cy); return { name: tr.dataset.name, rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom }, reaches: !!h && (h === i || i.contains(h)), hit: h ? h.tagName + (h.closest('#notification-container') ? '(toast)' : '') : null }; });
      const toasts = [...document.querySelectorAll('#notification-container > div')].map((t) => { const r = t.getBoundingClientRect(); return { text: t.textContent.trim().slice(0, 24), rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom } }; });
      return { win: { left: w.left, top: w.top, right: w.right, bottom: w.bottom }, rows, toasts };
    })()`);
    const m = await measure();
    console.log(`[${tag}] window ${JSON.stringify(R(m.win))}`);
    m.toasts.forEach((t, i) => console.log(`[${tag}] toast#${i} ${JSON.stringify(R(t.rect))} "${t.text}"`));
    m.rows.forEach((r) => console.log(`[${tag}] row ${r.name} ${JSON.stringify(R(r.rect))} reaches=${r.reaches} hit=${r.hit}`));
    await snap('toasts');
    check(m.toasts.length >= 1, `${tag}: toasts showing (${m.toasts.length})`);
    check(m.toasts.every((t) => !hits(t.rect, m.win)), `${tag}: no toast overlaps the Parameters window`);
    check(m.rows.every((r) => r.reaches), `${tag}: every row's Expression cell is reached by a hit test: ${JSON.stringify(m.rows.map((r) => [r.name, r.hit]))}`);
    check(m.toasts.every((t) => t.rect.left >= 0 && t.rect.right <= vp.w && t.rect.top >= 0 && t.rect.bottom <= vp.h), `${tag}: every toast inside the viewport`);
    // a real tap on every row, the lowest first
    for (const nm of ['d', 'c', 'b', 'a']) {
      await press(`.sk-pwin tr.sk-ptable-row[data-name="${nm}"] input[data-col="expression"]`);
      const f = await evalJs(`(() => { const a = document.activeElement; return a && a.dataset && a.dataset.col === 'expression' && a.closest('tr') && a.closest('tr').dataset.name; })()`);
      check(f === nm, `${tag}: a real ${vp.touch ? 'tap' : 'click'} on row ${nm} focuses its Expression (got ${f})`);
    }
    await press('.sk-pwin tr.sk-ptable-row[data-name="d"] input[data-col="expression"]');
    await key('a', 'KeyA', 65, 2); await typeText('77'); await key('Enter', 'Enter', 13, 0, '\r'); await sleep(400);
    const dv = await evalJs(`document.querySelector('.sk-pwin tr.sk-ptable-row[data-name="d"] input[data-col="expression"]').value`);
    check(dv.startsWith('77'), `${tag}: the lowest row edited by real keys applies (d expression = ${dv})`);
    if (!vp.touch) { // the window dragged over the toasts while they show: they move away
      await drag({ x: Math.round(vp.w / 2), y: Math.round(vp.h - 400) });
      const m2 = await measure();
      m2.toasts.forEach((t, i) => console.log(`[${tag}] after-drag toast#${i} ${JSON.stringify(R(t.rect))}`));
      console.log(`[${tag}] after-drag window ${JSON.stringify(R(m2.win))}`);
      check(m2.toasts.length >= 1 && m2.toasts.every((t) => !hits(t.rect, m2.win)), `${tag}: after dragging the window over them, no toast overlaps it`);
      await snap('dragged');
      await drag({ x: 260, y: Math.round(vp.h - 400) }); // the window to the left: a free column on its right holds the stack
      const m3 = await measure();
      m3.toasts.forEach((t, i) => console.log(`[${tag}] beside toast#${i} ${JSON.stringify(R(t.rect))}`));
      console.log(`[${tag}] beside window ${JSON.stringify(R(m3.win))}`);
      check(m3.toasts.length === 3 && m3.toasts.every((t) => !hits(t.rect, m3.win) && t.rect.left >= m3.win.right), `${tag}: window dragged left: all 3 toasts beside it, none over it`);
      check(m3.rows.every((r) => r.reaches), `${tag}: beside: every row still reached`);
    }
  }
} finally {
  await close();
}
if (failures) { console.log(`toast-panels-698-live: ${failures} FAILED`); process.exit(1); }
console.log('toast-panels-698-live: ALL CHECKS PASSED');
