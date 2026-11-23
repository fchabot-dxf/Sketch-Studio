// tests/dim-ref-click-866-live.test.js — TASK 866 (live headless, desktop 1280x800 mouse + phone 390x844 touch, SketchStudio + Shaper):
// Draw two lines, dimension first (d1), edit second's dimension, click d1's dimension -> box reads "d1" (open, focused, caret after "d1"),
// type "/2", Enter -> second line becomes half the first; also verifies clicking d1's leader line inserts "d1".
// Screenshots (local): .evidence/866/<host>-<kind>-inserted.png (cropped, legible).
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sleep, sendRealKey } from './helpers/cdp-browser.js';
import { pressRibbonTool } from './helpers/ribbon-tool.js';
import { resetBufferLive } from './helpers/reset-buffer.js';

const EVID = path.resolve('.evidence/866');
fs.mkdirSync(EVID, { recursive: true });

const HOSTS = [
  { name: 'sketchstudio', url: '/apps/sketchstudio/index.html', canvas: '#svgCanvas' },
  { name: 'shaper', url: '/apps/shaper/index.html', canvas: '#design-canvas', enter: true },
];

const cdp = await launchBrowser({ tag: '866-dim-ref', width: 1280, height: 800 });
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
  const box = () => evalJs(`(() => { const i = document.getElementById('dimInput'); if (!i) return null; const r = i.getBoundingClientRect();
    return { open: !i.classList.contains('hidden'), value: i.value, start: i.selectionStart, end: i.selectionEnd, focused: document.activeElement === i,
      rect: { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height } }; })()`);

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
          out[e.dataset.shapeId] = { a: p(x1, y1), b: p(x2, y2), lenW: Math.hypot(x2 - x1, y2 - y1) };
        } return JSON.stringify(out); })()`).then(JSON.parse);
        const labelIdxs = () => evalJs(`JSON.stringify([...document.querySelectorAll('${C} .dim-label')].map(e => e.dataset.constraintIdx))`).then(JSON.parse);
        const labelOf = (idx) => evalJs(`(() => { const e = document.querySelector('${C} .dim-label[data-constraint-idx="${idx}"] text') || document.querySelector('${C} .dim-label[data-constraint-idx="${idx}"]');
          if (!e) return null; const r = e.getBoundingClientRect(); return { text: e.textContent.trim(), x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), l: r.left, t: r.top, r: r.right, b: r.bottom }; })()`);
        const leaderPtOf = (idx) => evalJs(`(() => { for (const ln of document.querySelectorAll('${C} line[data-constraint-idx="${idx}"]')) {
          const m = ln.getScreenCTM(); const a = new DOMPoint(+ln.getAttribute('x1'), +ln.getAttribute('y1')).matrixTransform(m);
          const b = new DOMPoint(+ln.getAttribute('x2'), +ln.getAttribute('y2')).matrixTransform(m);
          if (Math.hypot(b.x - a.x, b.y - a.y) > 8) return { x: Math.round((a.x + b.x) / 2), y: Math.round((a.y + b.y) / 2) };
        } return null; })()`);
        const along = (l, t) => ({ x: Math.round(l.a.x + (l.b.x - l.a.x) * t), y: Math.round(l.a.y + (l.b.y - l.a.y) * t) });

        // Draw two horizontal lines (clear of the origin axes at center)
        const cr0 = await cr();
        const F = (fx, fy) => ({ x: Math.round(cr0.l + cr0.w * fx), y: Math.round(cr0.t + cr0.h * fy) });
        const ids0 = Object.keys(await lines());
        await tool('tool-line'); await P.tap(F(0.18, 0.30)); await P.tap(F(0.58, 0.30)); await key('Escape', 'Escape', 27);
        const ids1 = Object.keys(await lines());
        const idA = ids1.find((k) => !ids0.includes(k));
        assert(idA, `${tag} line A drawn`);

        await tool('tool-line'); await P.tap(F(0.24, 0.76)); await P.tap(F(0.64, 0.76)); await key('Escape', 'Escape', 27);
        const ids2 = Object.keys(await lines());
        const idB = ids2.find((k) => !ids1.includes(k));
        assert(idB, `${tag} line B drawn`);

        // Dimension line A (becomes d1 in SketchStudio, d2 in Shaper), keep with Enter
        await tool('tool-select');
        const beforeDimA = await labelIdxs();
        const lA = (await lines())[idA];
        await P.tap(along(lA, 0.3));
        await key('d', 'KeyD', 68);
        const dropA = { x: along(lA, 0.12).x, y: Math.round(lA.a.y - 45) };
        await P.away(dropA); await sleep(150); await P.tap(dropA);
        await waitFor(`(() => { const i = document.getElementById('dimInput'); return !!i && !i.classList.contains('hidden'); })()`, `${tag} dA box`, 8000);
        await key('Enter', 'Enter', 13, 0, '\r'); await sleep(300);
        const dA = (await labelIdxs()).filter((i) => !beforeDimA.includes(i))[0];
        assert(dA != null, `${tag} first dimension created`);
        const dAName = 'd' + (beforeDimA.length + 1);

        // Dimension line B, keep with Enter
        await tool('tool-select');
        const beforeDimB = await labelIdxs();
        const lB = (await lines())[idB];
        await P.tap(along(lB, 0.3));
        await key('d', 'KeyD', 68);
        const dropB = { x: along(lB, 0.12).x, y: Math.round(lB.a.y + 45) };
        await P.away(dropB); await sleep(150); await P.tap(dropB);
        await waitFor(`(() => { const i = document.getElementById('dimInput'); return !!i && !i.classList.contains('hidden'); })()`, `${tag} dB box`, 8000);
        await key('Enter', 'Enter', 13, 0, '\r'); await sleep(300);
        const dB = (await labelIdxs()).filter((i) => !beforeDimB.includes(i))[0];
        assert(dB != null, `${tag} second dimension created`);

        // Edit the second dimension -> whole value selected -> click d1's label
        await tool('tool-select');
        const labB = await labelOf(dB);
        await P.twice(labB);
        await waitFor(`(() => { const i = document.getElementById('dimInput'); return !!i && !i.classList.contains('hidden'); })()`, `${tag} edit d2 box`, 8000);
        if (phone) await evalJs(`(() => { const i = document.getElementById('dimInput'); i.focus(); i.select(); })()`);
        await sleep(150);

        const labA = await labelOf(dA);
        await P.tap(labA);
        const afterInsert = await box();
        console.log(`${tag} clicked ${dAName} (${labA.x},${labA.y}) -> box=${JSON.stringify(afterInsert)}`);
        check(afterInsert.open === true, `box stayed open after clicking ${dAName}`);
        check(afterInsert.value === dAName, `box reads "${dAName}" (got "${afterInsert.value}")`);
        check(afterInsert.focused === true, 'box remained focused');
        check(afterInsert.start === dAName.length && afterInsert.end === dAName.length, `caret after "${dAName}" (got ${afterInsert.start}..${afterInsert.end})`);

        // Cropped legible screenshot showing d1 label + open box reading "d1" + lines
        {
          const lsS = await lines();
          const minX = Math.max(0, Math.round(Math.min(labA.l, afterInsert.rect.l, lsS[idA].a.x, lsS[idB].a.x) - 40));
          const minY = Math.max(0, Math.round(Math.min(labA.t, afterInsert.rect.t, lsS[idA].a.y) - 40));
          const maxX = Math.min(vw, Math.round(Math.max(labA.r, afterInsert.rect.r, lsS[idA].b.x, lsS[idB].b.x) + 40));
          const maxY = Math.min(vh, Math.round(Math.max(labA.b, afterInsert.rect.b, lsS[idB].b.y) + 50));
          const r = await send('Page.captureScreenshot', { format: 'png', clip: { x: minX, y: minY, width: Math.max(200, maxX - minX), height: Math.max(200, maxY - minY), scale: phone ? 2 : 1 } });
          fs.writeFileSync(path.join(EVID, `${h.name}-${kind}-inserted.png`), Buffer.from(r.data, 'base64'));
        }

        // Type "/2" and Enter -> second line becomes half the first
        await typeText('/2');
        const typedDiv = await box();
        check(typedDiv.value === `${dAName}/2`, `typed "/2" -> "${dAName}/2" (got "${typedDiv.value}")`);
        await key('Enter', 'Enter', 13, 0, '\r');
        await sleep(400);
        const afterEnter = await box();
        check(afterEnter.open === false, 'Enter closed box');
        const lsAfter = await lines();
        const lenA = lsAfter[idA].lenW, lenB = lsAfter[idB].lenW;
        console.log(`${tag} after ${dAName}/2 Enter: lenA=${lenA.toFixed(2)}, lenB=${lenB.toFixed(2)} (ratio ${(lenB / lenA).toFixed(4)})`);
        check(Math.abs(lenB - lenA / 2) <= 0.15, `second line is half of first (${lenB.toFixed(2)} vs ${(lenA / 2).toFixed(2)})`);

        // Also click d1's LEADER line while editing d2 again -> inserts d1 at caret
        await P.twice(await labelOf(dB));
        await waitFor(`(() => { const i = document.getElementById('dimInput'); return !!i && !i.classList.contains('hidden'); })()`, `${tag} reopen d2`, 8000);
        if (phone) await evalJs(`(() => { const i = document.getElementById('dimInput'); i.focus(); i.select(); })()`);
        await sleep(150);
        const leadA = await leaderPtOf(dA);
        assert(leadA, `${tag} dA has leader line with data-constraint-idx`);
        await P.tap(leadA);
        const afterLead = await box();
        console.log(`${tag} clicked ${dAName} leader (${leadA.x},${leadA.y}) -> box=${JSON.stringify(afterLead)}`);
        check(afterLead.open === true && afterLead.value === dAName && afterLead.focused === true, `clicking ${dAName} leader inserted "${dAName}" cleanly (${JSON.stringify(afterLead)})`);
        await evalJs(`document.getElementById('dimInput').focus()`); await key('Escape', 'Escape', 27);
      } catch (e) {
        failed.push(`${tag} stopped: ${e.message}`);
        console.log(`FAIL ${tag} stopped: ${e.message}`);
      }
    }
  }
  assert.deepStrictEqual(failed, [], `${failed.length} check(s) failed`);
  console.log('dim-ref-click-866-live: ALL CHECKS PASSED');
} finally {
  await close();
}
