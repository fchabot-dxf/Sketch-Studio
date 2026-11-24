// tests/live-box-names-876-live.test.js -- TASK 876 (live headless, desktop 1280x800 mouse + phone 390x844 touch, SketchStudio + Shaper): the rectangle's W x H box
// (the two-field creation box) reads names and formulas, and a click on an existing dimension names it into the field being typed in.
//  1. nothing typed: a click on d1's text is the drawing's own click (the rectangle is placed)
//  2. typed "1" then deleted (the field is in input mode): a click on d1's text puts "d1" in the field, the box stays focused, no corner is placed; "/2" goes on at the caret;
//     the other field gets 30; Enter: the rectangle's width is half of d1
//  3. d1 changed afterwards: the rectangle's width follows
//  4. an unknown name in a box is refused with the edit box's hint, the box is a text field (letters on a phone), Enter places nothing
// Screenshots (local): .evidence/876/<host>-<kind>-inserted.png (cropped).
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sleep, sendRealKey } from './helpers/cdp-browser.js';
import { pressRibbonTool } from './helpers/ribbon-tool.js';
import { resetBufferLive } from './helpers/reset-buffer.js';

const EVID = path.resolve('.evidence/876');
fs.mkdirSync(EVID, { recursive: true });

const HOSTS = [
  { name: 'sketchstudio', url: '/apps/sketchstudio/index.html', canvas: '#svgCanvas' },
  { name: 'shaper', url: '/apps/shaper/index.html', canvas: '#design-canvas', enter: true },
];

const cdp = await launchBrowser({ tag: '876-live-box-names', width: 1280, height: 800 });
if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
const { port, send, evalJs, waitFor, navigate, close } = cdp;
const failed = [];

try {
  const mouseEv = (type, x, y, buttons = 0, clickCount = 1) =>
    send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : clickCount });
  const T = (type, pts) =>
    send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i + 1, radiusX: 1, radiusY: 1, force: 1 })) });
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
  const key = async (k, code, vk, mods = 0, text = '') => { await sendRealKey(send, k, code, vk, mods, text); await sleep(200); };
  const typeText = async (text) => {
    for (const ch of text) {
      if (ch === '/') await sendRealKey(send, '/', 'Slash', 191, 0, '/');
      else if (/[a-z]/i.test(ch)) await sendRealKey(send, ch, 'Key' + ch.toUpperCase(), ch.toUpperCase().charCodeAt(0), 0, ch);
      else if (/\d/.test(ch)) await sendRealKey(send, ch, 'Digit' + ch, ch.charCodeAt(0), 0, ch);
      await sleep(30);
    }
    await sleep(200);
  };

  for (const kind of (process.env.PHASES || 'mouse,touch').split(',')) {
    for (const h of HOSTS) {
      const tag = `[${kind} ${h.name}]`;
      const check = (cond, msg) => { if (!cond) { failed.push(`${tag} ${msg}`); console.log(`FAIL ${tag} ${msg}`); } };
      try {
        const P = POINTERS[kind];
        const phone = kind === 'touch';
        const vw = phone ? 390 : 1280, vh = phone ? 844 : 800;
        await resetBufferLive(cdp);
        await send('Emulation.setDeviceMetricsOverride', phone ? { width: 390, height: 844, deviceScaleFactor: 2, mobile: true } : { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
        await send('Emulation.setTouchEmulationEnabled', { enabled: phone, maxTouchPoints: phone ? 5 : 0 });
        await navigate(`http://127.0.0.1:${port}${h.url}`, 8000);
        await waitFor(`!!document.querySelector('.sk-ribbon .sk-ribbon-btn') && !!document.querySelector('${h.canvas}')`, `${tag} ribbon`);
        if (h.enter) await evalJs(`document.querySelector('.sk-header-tab[data-tab="design"]').click()`);
        await waitFor(`document.querySelector('${h.canvas}').getBoundingClientRect().width > 0`, `${tag} canvas`);
        await sleep(800);

        const C = h.canvas;
        const tool = (id) => pressRibbonTool(evalJs, P.tap, id);
        const cr = () => evalJs(`(() => { const r = document.querySelector('${C}').getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height }; })()`);
        const lines = () => evalJs(`(() => { const out = {}; for (const e of document.querySelectorAll('${C} line.shape-elem')) {
          const x1 = +e.getAttribute('x1'), y1 = +e.getAttribute('y1'), x2 = +e.getAttribute('x2'), y2 = +e.getAttribute('y2');
          const m = e.getScreenCTM();
          const p = (x, y) => { const q = new DOMPoint(x, y).matrixTransform(m); return { x: Math.round(q.x), y: Math.round(q.y) }; };
          out[e.dataset.shapeId] = { a: p(x1, y1), b: p(x2, y2), lenW: Math.hypot(x2 - x1, y2 - y1), horizontal: Math.abs(y2 - y1) < 1e-6 };
        } return JSON.stringify(out); })()`).then(JSON.parse);
        const labelIdxs = () => evalJs(`JSON.stringify([...document.querySelectorAll('${C} .dim-label')].map(e => e.dataset.constraintIdx))`).then(JSON.parse);
        const labelOf = (idx) => evalJs(`(() => { const e = document.querySelector('${C} .dim-label[data-constraint-idx="${idx}"] text') || document.querySelector('${C} .dim-label[data-constraint-idx="${idx}"]');
          if (!e) return null; const r = e.getBoundingClientRect(); return { text: e.textContent.trim(), x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), l: r.left, t: r.top, r: r.right, b: r.bottom }; })()`);
        const fields = () => evalJs(`[...document.querySelectorAll('#dualInput input')].map((i) => { const r = i.getBoundingClientRect(); return { v: i.value, mode: i.inputMode, invalid: i.getAttribute('aria-invalid') === 'true', focused: document.activeElement === i, l: r.left, t: r.top, r: r.right, b: r.bottom }; })`);
        const hint = () => evalJs(`(() => { const e = document.getElementById('dimHint'); return e && !e.classList.contains('hidden') ? e.textContent : null; })()`);
        const along = (l, t) => ({ x: Math.round(l.a.x + (l.b.x - l.a.x) * t), y: Math.round(l.a.y + (l.b.y - l.a.y) * t) });
        // the field takes the focus (a finger taps it; here the page's own focus, as the box does when it opens)
        const focusField = async (i) => { await evalJs(`(() => { const e = document.querySelectorAll('#dualInput input')[${i}]; e.focus(); e.select(); })()`); await sleep(100); };
        const lineCount = async () => Object.keys(await lines()).length;

        const cr0 = await cr();
        const F = (fx, fy) => ({ x: Math.round(cr0.l + cr0.w * fx), y: Math.round(cr0.t + cr0.h * fy) });
        const ids0 = Object.keys(await lines());
        await tool('tool-line'); await P.tap(F(0.18, 0.28)); await P.tap(F(0.58, 0.28)); await key('Escape', 'Escape', 27);
        const idA = Object.keys(await lines()).find((k) => !ids0.includes(k));
        assert(idA, `${tag} line A drawn`);

        // dimension A, kept with Enter: d1 (a later number in a host that starts with a dimension)
        await tool('tool-select');
        const beforeDim = await labelIdxs();
        const lA = (await lines())[idA];
        await P.tap(along(lA, 0.3));
        await key('d', 'KeyD', 68);
        const drop = { x: along(lA, 0.12).x, y: Math.round(lA.a.y - 45) };
        await P.away(drop); await sleep(150); await P.tap(drop);
        await waitFor(`(() => { const i = document.getElementById('dimInput'); return !!i && !i.classList.contains('hidden'); })()`, `${tag} dA box`, 8000);
        await key('Enter', 'Enter', 13, 0, '\r'); await sleep(300);
        const dA = (await labelIdxs()).filter((i) => !beforeDim.includes(i))[0];
        assert(dA != null, `${tag} the dimension is created`);
        const dName = 'd' + (beforeDim.length + 1);
        const lenA = (await lines())[idA].lenW;

        const corner = F(0.30, 0.55), far = F(0.45, 0.68);

        // 1. nothing typed: a click on the dimension's text is the drawing's click (the second corner of the rectangle)
        await tool('tool-rect');
        const n0 = await lineCount();
        await P.tap(corner); await P.away(far);
        await P.tap(await labelOf(dA));
        const n1 = await lineCount();
        check(n1 >= n0 + 4, `1. nothing typed: a click on ${dName}'s text places the rectangle's corner as it always did (${n0} -> ${n1} lines)`);
        await key('Escape', 'Escape', 27); await key('Escape', 'Escape', 27);

        // 2. typed, then deleted: the click names the dimension into the field
        await tool('tool-rect');
        const n2 = await lineCount();
        await P.tap(corner); await P.away(far);
        await focusField(0);
        check((await fields()).every((x) => x.mode === 'text'), `4. the creation box asks for the full text keyboard: ${JSON.stringify((await fields()).map((x) => x.mode))}`);
        await typeText('1');
        await key('Backspace', 'Backspace', 8);
        const labA2 = await labelOf(dA);
        await P.tap(labA2);
        let f = await fields();
        check(f[0].v === dName, `2. the click names ${dName} into the field being typed in (got "${f[0].v}")`);
        check(f[0].focused, '2. the box is still focused');
        check((await lineCount()) === n2, `2. no corner was placed (${n2} -> ${await lineCount()} lines)`);
        {
          const b = f[0];
          const minX = Math.max(0, Math.round(Math.min(labA2.l, b.l) - 40)), minY = Math.max(0, Math.round(Math.min(labA2.t, b.t) - 40));
          const maxX = Math.min(vw, Math.round(Math.max(labA2.r, b.r) + 120)), maxY = Math.min(vh, Math.round(Math.max(labA2.b, b.b) + 60));
          const r = await send('Page.captureScreenshot', { format: 'png', clip: { x: minX, y: minY, width: Math.max(220, maxX - minX), height: Math.max(220, maxY - minY), scale: phone ? 2 : 1 } });
          fs.writeFileSync(path.join(EVID, `${h.name}-${kind}-inserted.png`), Buffer.from(r.data, 'base64'));
        }
        await typeText('/2');
        check((await fields())[0].v === `${dName}/2`, `2. typing goes on at the caret: "${(await fields())[0].v}"`);
        await focusField(1); await typeText('30');
        check((await hint()) === null, `2. a readable formula shows no refusal (${await hint()})`);
        await key('Enter', 'Enter', 13, 0, '\r'); await sleep(300);
        let ls = await lines();
        const w1 = Object.values(ls).filter((l) => l.horizontal).map((l) => l.lenW);
        check(w1.some((w) => Math.abs(w - lenA / 2) <= 0.05), `2. the new rectangle's width is half of ${dName} (${(lenA / 2).toFixed(2)}): ${w1.map((w) => w.toFixed(2))}`);
        await key('Escape', 'Escape', 27);

        // 3. the dimension changed afterwards: the rectangle's width follows
        await tool('tool-select');
        await P.twice(await labelOf(dA));
        await waitFor(`(() => { const i = document.getElementById('dimInput'); return !!i && !i.classList.contains('hidden'); })()`, `${tag} reopen ${dName}`, 8000);
        if (phone) await evalJs(`(() => { const i = document.getElementById('dimInput'); i.focus(); i.select(); })()`);
        await sleep(150);
        await typeText('200mm');
        await key('Enter', 'Enter', 13, 0, '\r'); await sleep(500);
        ls = await lines();
        const w2 = Object.values(ls).filter((l) => l.horizontal).map((l) => l.lenW);
        check(w2.some((w) => Math.abs(w - 100) <= 0.05), `3. ${dName} = 200: the rectangle drawn from ${dName}/2 is 100 wide: ${w2.map((w) => w.toFixed(2))}`);

        // 4. an unknown name is refused like the edit box refuses it
        await tool('tool-rect');
        const n3 = await lineCount();
        await P.tap(F(0.30, 0.82)); await P.away(F(0.42, 0.90));
        await focusField(0); await typeText('zz');
        f = await fields();
        check(f[0].invalid && /zz/.test((await hint()) || ''), `4. the box is invalid and the hint says why: ${JSON.stringify(f[0].invalid)} ${await hint()}`);
        await key('Enter', 'Enter', 13, 0, '\r');
        check((await lineCount()) === n3, '4. Enter places nothing while the name is unknown');
        await key('Escape', 'Escape', 27); await key('Escape', 'Escape', 27);
      } catch (e) {
        failed.push(`${tag} stopped: ${e.message}`);
        console.log(`FAIL ${tag} stopped: ${e.message}`);
      }
    }
  }
  assert.deepStrictEqual(failed, [], `${failed.length} check(s) failed`);
  console.log('live-box-names-876-live: ALL CHECKS PASSED');
} finally {
  await close();
}
