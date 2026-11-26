// tests/reference-dim-box-1006-live.test.js - TASK 1006 DIV-03 / DD-3 (live headless; REAL mouse 1280 x 800 + REAL touch 390 x 844; SketchStudio).
// Double-clicking (double-tapping) a REFERENCE dimension opens its value box READ-ONLY, on its label, showing what the label shows, with the hint
// under it saying how to type it; a typed key changes nothing; Esc closes it; the dimension stays a reference with the same label; no page error.
// The reference is made the way a user does: a line drawn, selected, locked (F), then its dimension placed (D + a press): both ends locked, the
// sketch already determines its length, so it is born a reference (bracketed label).
// Was (before the fix): nothing happened at all (no box, no message). The node twin: tests/driving-reference-1006-node.test.js section 6.
// Screenshots (local): .evidence/1006/<EVID_TAG>-refbox-<kind>.png
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sleep, sendRealKey } from './helpers/cdp-browser.js';
import { pressRibbonTool } from './helpers/ribbon-tool.js';
import { resetBufferLive } from './helpers/reset-buffer.js';

const EVID = path.resolve('.evidence/1006');
const TAG = process.env.EVID_TAG || 'run';
fs.mkdirSync(EVID, { recursive: true });
const C = '#svgCanvas';

const cdp = await launchBrowser({ tag: '1006-refbox', width: 1280, height: 800 });
if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
const { port, send, evalJs, waitFor, navigate, close, ws } = cdp;
const failed = [];
const errors = [];
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.method === 'Runtime.exceptionThrown') errors.push(JSON.stringify(m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description || m.params.exceptionDetails.text)); });

try {
  const mouseEv = (type, x, y, buttons = 0, clickCount = 1) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : clickCount });
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
  const key = async (k, code, vk, mods = 0, text = '') => { await sendRealKey(send, k, code, vk, mods, text); await sleep(200); };
  const box = () => evalJs(`(() => { const i = document.getElementById('dimInput'), h = document.getElementById('dimHint'); if (!i) return null; const r = i.getBoundingClientRect(), hr = h ? h.getBoundingClientRect() : null;
    return { open: !i.classList.contains('hidden'), readOnly: i.readOnly, value: i.value, focused: document.activeElement === i, l: r.left, t: r.top, r: r.right, b: r.bottom,
      hint: h && !h.classList.contains('hidden') ? h.textContent : null, hintBox: hr && { l: hr.left, t: hr.top, r: hr.right, b: hr.bottom } }; })()`);
  const rnd = (o) => JSON.stringify(o, (k, v) => (typeof v === 'number' ? Math.round(v) : v));

  for (const kind of (process.env.PHASES || 'mouse,touch').split(',')) {
    const tag = `[${kind}]`;
    const check = (cond, msg) => { if (!cond) { failed.push(`${tag} ${msg}`); console.log(`FAIL ${tag} ${msg}`); } else console.log(`ok   ${tag} ${msg}`); };
    try {
      const P = POINTERS[kind];
      const phone = kind === 'touch';
      await resetBufferLive(cdp);
      await send('Emulation.setDeviceMetricsOverride', phone ? { width: 390, height: 844, deviceScaleFactor: 2, mobile: true } : { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
      await send('Emulation.setTouchEmulationEnabled', { enabled: phone, maxTouchPoints: phone ? 5 : 0 });
      await navigate(`http://127.0.0.1:${port}/apps/sketchstudio/index.html`, 8000);
      await waitFor(`!!document.querySelector('.sk-ribbon .sk-ribbon-btn') && !!document.querySelector('${C}')`, `${tag} the ribbon`);
      await waitFor(`document.querySelector('${C}').getBoundingClientRect().width > 0`, `${tag} the canvas`);
      await sleep(800);
      const canvasRect = () => evalJs(`(() => { const r = document.querySelector('${C}').getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; })()`);
      const lines = () => evalJs(`(() => { const out = {}; for (const e of document.querySelectorAll('${C} line.shape-elem')) { const m = e.getScreenCTM();
        const p = (x, y) => { const q = new DOMPoint(x, y).matrixTransform(m); return { x: q.x, y: q.y }; };
        out[e.dataset.shapeId] = { a: p(+e.getAttribute('x1'), +e.getAttribute('y1')), b: p(+e.getAttribute('x2'), +e.getAttribute('y2')) }; }
        return JSON.stringify(out); })()`).then(JSON.parse);
      const labelTexts = () => evalJs(`JSON.stringify([...document.querySelectorAll('${C} .dim-label')].map(e => e.textContent.trim()))`).then(JSON.parse);
      const refLabel = () => evalJs(`(() => { const e = [...document.querySelectorAll('${C} .dim-label')].find(g => g.textContent.trim().startsWith('(')); if (!e) return null;
        const t = e.querySelector('text') || e; const r = t.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, text: e.textContent.trim() }; })()`);
      const along = (l, t) => ({ x: Math.round(l.a.x + (l.b.x - l.a.x) * t), y: Math.round(l.a.y + (l.b.y - l.a.y) * t) });
      const tool = (id) => pressRibbonTool(evalJs, P.tap, id);

      // a line, locked (select it + F), then its dimension (D + a press): born a reference
      const cr0 = await canvasRect();
      const F = (fx, fy) => ({ x: Math.round(cr0.l + cr0.w * fx), y: Math.round(cr0.t + cr0.h * fy) });
      const before = Object.keys(await lines());
      await tool('tool-line'); await P.tap(F(0.58, 0.42)); await P.tap(F(0.90, 0.42)); await key('Escape', 'Escape', 27);
      const id = Object.keys(await lines()).find((k) => !before.includes(k));
      assert(id, `${tag} the line is drawn`);
      await tool('tool-select');
      const l = (await lines())[id];
      await P.tap(along(l, 0.3));
      await key('f', 'KeyF', 70);
      await P.tap(along(l, 0.3));
      await key('d', 'KeyD', 68);
      const drop = { x: along(l, 0.5).x, y: Math.round(along(l, 0.5).y - 50) };
      await P.away(drop); await sleep(150); await P.tap(drop); await sleep(300);
      const b0 = await box();
      check(b0 && !b0.open, `placing the dimension on the locked line opens no box (${rnd(b0 && { open: b0.open })})`);
      await key('Escape', 'Escape', 27);
      await tool('tool-select');
      const lab = await refLabel();
      check(!!lab, `the placed dimension is a reference (bracketed label): ${JSON.stringify(await labelTexts())}`);
      if (!lab) continue;
      const labelsBefore = await labelTexts();

      // the double press on the reference label: its box, read-only, on the label, the hint under it
      await P.twice({ x: Math.round(lab.x), y: Math.round(lab.y) });
      await waitFor(`(() => { const i = document.getElementById('dimInput'); return !!i && !i.classList.contains('hidden'); })()`, `${tag} the reference's box`, 8000);
      await sleep(250);
      const b1 = await box();
      console.log(`${tag} label ${rnd(lab)}, box ${rnd(b1)}`);
      check(b1.readOnly === true, 'the box is read-only');
      check(`(${b1.value})` === lab.text, `the box shows what the label shows (box "${b1.value}", label "${lab.text}")`);
      check(!!b1.hint && /reference/i.test(b1.hint), `the hint says why: "${b1.hint}"`);
      check(b1.hintBox && b1.hintBox.t >= b1.b - 1 || b1.hintBox && b1.hintBox.b <= b1.t + 1, `the hint sits under (or above) the box, not over it (box ${rnd({ t: b1.t, b: b1.b })}, hint ${rnd(b1.hintBox)})`);
      check(Math.abs((b1.l + b1.r) / 2 - lab.x) <= 20 && Math.abs((b1.t + b1.b) / 2 - lab.y) <= 20, 'the box sits on its label');
      {
        const vw = phone ? 390 : 1280, vh = phone ? 844 : 800;
        const x = Math.max(0, Math.round(Math.min(lab.x, b1.l, b1.hintBox ? b1.hintBox.l : b1.l) - 40)), y = Math.max(0, Math.round(Math.min(lab.y, b1.t) - 80));
        const bottom = Math.max(b1.b, b1.hintBox ? b1.hintBox.b : b1.b, lab.y);
        const right = Math.max(b1.r, b1.hintBox ? b1.hintBox.r : b1.r, lab.x);
        const r = await send('Page.captureScreenshot', { format: 'png', clip: { x, y, width: Math.min(Math.round(right - x + 120), vw - x), height: Math.min(Math.round(bottom - y + 80), vh - y), scale: 2 } });
        fs.writeFileSync(path.join(EVID, `${TAG}-refbox-${kind}.png`), Buffer.from(r.data, 'base64'));
      }
      // a typed key changes nothing; Esc closes it; the reference and its label are as before
      await evalJs(`document.getElementById('dimInput').focus()`);
      await key('9', 'Digit9', 57, 0, '9');
      const b2 = await box();
      check(b2.open && b2.value === b1.value, `a typed 9 changes nothing (box "${b2.value}")`);
      await key('Escape', 'Escape', 27);
      const b3 = await box();
      check(!b3.open, 'Esc closed the box');
      check(b3.readOnly === false, 'the box is typeable again for the next dimension');
      check(JSON.stringify(await labelTexts()) === JSON.stringify(labelsBefore), `the labels are as before: ${JSON.stringify(await labelTexts())}`);
    } catch (e) { failed.push(`${tag} stopped: ${e.message}`); console.log(`FAIL ${tag} stopped: ${e.message}`); }
  }
  check0();
} finally {
  await close();
}
function check0() {
  if (errors.length) failed.push('page errors: ' + errors.join(' | '));
  assert.deepStrictEqual(failed, [], `${failed.length} check(s) failed`);
  console.log('reference-dim-box-1006-live: ALL CHECKS PASSED');
}
