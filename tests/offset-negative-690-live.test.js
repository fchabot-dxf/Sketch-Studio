// tests/offset-negative-690-live.test.js -- TASK 690 (live headless, REAL mouse and REAL touch via CDP, Pen Plotter = the shared Design tab).
// A NEGATIVE offset value puts the offset on the OTHER side of its source, at |value| (#core/offset.js header):
//   1. Offset a line: the pointer below it, type -5 in the distance box -> the preview lies ABOVE, 5 away; 0 is refused (the box stays, no step);
//      Enter (mouse) / the green check (finger) -> the offset is made above, ONE undo step.
//   2. Double click / double tap its dimension label, type -3, Enter -> the offset moves BELOW at 3, the label reads -3.0, ONE undo step;
//      Ctrl+Z inside the box first restores the opening value (task 675 C) and changes nothing.
//   3. The Parameters window (footer fx button): + Add off = 4 mm, the dimension's Expression = off (above at 4), off = -2 mm -> below at 2;
//      Ctrl+Z (mouse) / the footer Undo (finger) steps back to above at 4.
// Run twice: desktop 1600x900 with the mouse, phone 390x844 with a finger (resetBufferLive before each phase). Screenshots: .evidence/690.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sendRealKey } from './helpers/cdp-browser.js';
import { resetBufferLive } from './helpers/reset-buffer.js';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const EVID = path.join(process.cwd(), '.evidence', '690');
const STATE = 'window.__sketch.controller.state';

await (async () => {
  const cdp = await launchBrowser({ tag: '690', width: 1600, height: 900 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, waitFor, waitForApp, navigate } = cdp;
  try {
    fs.mkdirSync(EVID, { recursive: true });
    const shot = async (file, clip) => { const r = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 2 } } : {}) }); fs.writeFileSync(path.join(EVID, file), Buffer.from(r.data, 'base64')); };
    const key = async (k, code, vk, mods = 0, text = '') => { await sendRealKey(send, k, code, vk, mods, text); await sleep(200); };
    const Enter = () => key('Enter', 'Enter', 13, 0, '\r');
    const Esc = () => key('Escape', 'Escape', 27);
    const Tab = () => key('Tab', 'Tab', 9);
    const ctrlZ = () => key('z', 'KeyZ', 90, 2);
    const SIGN = { ' ': ['Space', 32], '-': ['Minus', 189], '.': ['Period', 190] };
    const type = async (text) => {
      for (const ch of text) {
        const [code, vk] = /[a-z]/i.test(ch) ? ['Key' + ch.toUpperCase(), ch.toUpperCase().charCodeAt(0)] : /\d/.test(ch) ? ['Digit' + ch, ch.charCodeAt(0)] : SIGN[ch];
        await sendRealKey(send, ch, code, vk, 0, ch); await sleep(20);
      }
      await sleep(200);
    };
    const focusSelect = (sel) => evalJs(`(() => { const i = document.querySelector(${JSON.stringify(sel)}); i.focus(); i.select(); })()`);
    const mouse = (type, x, y, buttons) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
    const T = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: p.id ?? i + 1, radiusX: 1, radiusY: 1, force: 1 })) });
    const pointers = {
      mouse: {
        tap: async (p) => { await mouse('mouseMoved', p.x, p.y, 0); await sleep(60); await mouse('mousePressed', p.x, p.y, 1); await sleep(40); await mouse('mouseReleased', p.x, p.y, 0); await sleep(250); },
        hover: async (p) => { await mouse('mouseMoved', p.x, p.y, 0); await sleep(150); },
        double: async (p) => { await mouse('mouseMoved', p.x, p.y, 0); await sleep(60); for (let i = 0; i < 2; i++) { await mouse('mousePressed', p.x, p.y, 1); await sleep(30); await mouse('mouseReleased', p.x, p.y, 0); await sleep(60); } await sleep(300); },
      },
      touch: {
        tap: async (p) => { await T('touchStart', [p]); await sleep(60); await T('touchEnd', []); await sleep(300); },
        hover: async (p) => { await T('touchStart', [p]); await sleep(60); await T('touchEnd', []); await sleep(300); }, // a finger has no hover: the side is a tap
        double: async (p) => { for (let i = 0; i < 2; i++) { await T('touchStart', [p]); await sleep(40); await T('touchEnd', []); await sleep(80); } await sleep(300); },
      },
    };
    const centerOf = (sel) => evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({ block: 'nearest', inline: 'nearest' }); const r = e.getBoundingClientRect(); return r.width ? { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } : null; })()`);
    const hist = () => evalJs(`${STATE}.history.length`);
    const box = () => evalJs(`(() => { const i = document.getElementById('offset-distance-input'); return i ? i.value : null; })()`);
    const toScreen = (x, y) => evalJs(`(() => { const svg = document.querySelector('#design-canvas'); const pt = svg.createSVGPoint(); pt.x = ${x}; pt.y = ${y}; const q = pt.matrixTransform(svg.getScreenCTM()); return { x: q.x, y: q.y }; })()`);
    // the preview's offset line (world), the source line and the offset (world), the offset constraint
    const preview = () => evalJs(`JSON.stringify([...document.querySelectorAll('#offset-tool-overlay line.offset-preview')].map((e) => ['x1', 'y1', 'x2', 'y2'].map((a) => +e.getAttribute(a))))`).then(JSON.parse);
    const offset = () => evalJs(`JSON.stringify((() => { const s = ${STATE}; const c = s.constraints.find((x) => x.type === 'offset'); if (!c) return null; const sh = (id) => s.shapes.find((x) => x.id === id); const pts = (l) => l.joints.map((j) => ({ x: s.joints.get(j).x, y: s.joints.get(j).y })); return { value: c.value, name: c.name, idx: s.constraints.indexOf(c), src: pts(sh(c.shapes[0])), off: pts(sh(c.shapes[1])) }; })())`).then(JSON.parse);
    const labelText = (idx) => evalJs(`(() => { const e = document.querySelector('#design-canvas .dim-label[data-constraint-idx="${idx}"]'); return e ? e.textContent.trim() : null; })()`);

    const run = async (kind) => {
      const P = pointers[kind];
      const out = (s) => console.log(`[${kind}] ${s}`);
      await resetBufferLive(cdp); // the four apps share one tab list (task 684): each phase starts on a clean Untitled
      if (kind === 'touch') {
        await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
        await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
      }
      await navigate(`http://127.0.0.1:${port}/apps/penplotter/index.html`, 10000);
      await waitFor(`!!document.querySelector('.sk-header-tab[data-tab="design"]')`, `[${kind}] the stage button`);
      await evalJs(`document.querySelector('.sk-header-tab[data-tab="design"]').click()`);
      await waitForApp('design-canvas');
      await waitFor(`document.querySelector('#design-canvas').getBoundingClientRect().width > 0 && !!${STATE} && ${STATE}.shapes.length === 0`, `[${kind}] an empty design canvas`);
      await sleep(400);
      const cr = await evalJs(`(() => { const r = document.querySelector('#design-canvas').getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height }; })()`);
      const tool = async (id) => { await evalJs(`document.querySelector('#${id}').click()`); await sleep(200); };
      // ONE horizontal line across the middle, long against 5 mm
      const half = Math.min(cr.w * 0.3, 220), mid = { x: cr.l + cr.w * 0.5, y: cr.t + cr.h * 0.42 };
      await tool('tool-line'); await P.tap({ x: mid.x - half, y: mid.y }); await P.tap({ x: mid.x + half, y: mid.y }); await Esc();
      assert.strictEqual(await evalJs(`${STATE}.shapes.filter((s) => s.type === 'line').length`), 1, `[${kind}] one line is drawn`);
      const h0 = await hist();
      const clip = { x: Math.max(0, mid.x - half - 30), y: Math.max(0, mid.y - 120), width: Math.min(2 * half + 60, cr.w), height: 240 };
      // the screen side of a world y relative to the source line (-1 above, +1 below)
      const screenSide = async (yWorld, ySrc) => Math.sign((await toScreen(0, yWorld)).y - (await toScreen(0, ySrc)).y);

      // ---- 1. the Offset tool's box: -5 = the other side
      await tool('tool-offset');
      await P.tap(mid);
      await waitFor(`!!document.getElementById('offset-distance-input')`, `[${kind}] the distance box`);
      assert.strictEqual(await box(), '5.00', `[${kind}] the box opens with the remembered 5.00 (a mm document)`);
      const below = { x: mid.x + 30, y: mid.y + 70 };
      await P.hover(below);
      const ySrc = (await evalJs(`JSON.stringify(${STATE}.joints.get(${STATE}.shapes[0].joints[0]))`).then(JSON.parse)).y;
      const p5 = (await preview())[0];
      assert(p5 && Math.abs(Math.abs(p5[1] - ySrc) - 5) < 0.01 && await screenSide(p5[1], ySrc) === 1, `[${kind}] the preview: 5 mm BELOW, on the pointer side (${JSON.stringify(p5)}, source y ${ySrc})`);
      await shot(`${kind}-1-box-5-below.png`, clip);
      await focusSelect('#offset-distance-input'); await type('-5');
      assert.strictEqual(await box(), '-5', `[${kind}] the box holds -5`);
      const pn = (await preview())[0];
      assert(pn && Math.abs(Math.abs(pn[1] - ySrc) - 5) < 0.01 && await screenSide(pn[1], ySrc) === -1, `[${kind}] -5: the preview is ABOVE, the other side, 5 mm away (${JSON.stringify(pn)})`);
      await shot(`${kind}-2-box-minus5-above.png`, clip);
      await focusSelect('#offset-distance-input'); await type('0'); await Enter();
      assert.strictEqual(await box(), '0', `[${kind}] 0: refused, the box stays open`);
      assert.strictEqual(await hist(), h0, `[${kind}] 0: no undo step`);
      await focusSelect('#offset-distance-input'); await type('-5');
      if (kind === 'mouse') await Enter();
      else { const c = await centerOf('.sk-done'); assert(c, '[touch] the green check'); await P.tap(c); }
      await waitFor(`!document.getElementById('offset-distance-input')`, `[${kind}] the box closes on apply`);
      let o = await offset();
      assert(o && o.off.every((p) => Math.abs(Math.abs(p.y - ySrc) - 5) < 1e-6) && await screenSide(o.off[0].y, ySrc) === -1, `[${kind}] the offset is made ABOVE, 5 mm away: ${JSON.stringify(o)}`);
      assert.strictEqual(await hist(), h0 + 1, `[${kind}] ONE undo step`);
      out(`tool -5: offset made above, dimension ${o.name} = ${o.value}, label ${await labelText(o.idx)}`);
      await shot(`${kind}-3-made-above.png`, clip);

      // ---- 2. the dimension box: -3 = below at 3; Ctrl+Z in the box restores the opening value first
      await tool('tool-select');
      await sleep(600);
      const lab = await centerOf(`#design-canvas .dim-label[data-constraint-idx="${o.idx}"]`);
      await P.double(lab);
      await waitFor(`(() => { const i = document.getElementById('dimInput'); return !!i && !i.classList.contains('hidden'); })()`, `[${kind}] the dimension box`);
      const opening = await evalJs(`document.getElementById('dimInput').value`);
      await focusSelect('#dimInput'); await type('-7');
      await ctrlZ();
      const afterZ = await evalJs(`(() => { const i = document.getElementById('dimInput'); return { v: i.value, open: !i.classList.contains('hidden') }; })()`);
      assert.deepStrictEqual(afterZ, { v: opening, open: true }, `[${kind}] Ctrl+Z in the box: the opening value again (${opening}), the box open`);
      assert.strictEqual(await hist(), h0 + 1, `[${kind}] Ctrl+Z in the box undoes no document step`);
      await focusSelect('#dimInput'); await type('-3'); await Enter();
      await sleep(400);
      o = await offset();
      assert(o.value === -3 && o.off.every((p) => Math.abs(Math.abs(p.y - ySrc) - 3) < 1e-4) && await screenSide(o.off[0].y, ySrc) === 1, `[${kind}] -3: the offset is BELOW at 3: ${JSON.stringify(o)}`);
      assert(o.src.every((p) => Math.abs(p.y - ySrc) < 1e-6), `[${kind}] the source stays`);
      assert.strictEqual(await hist(), h0 + 2, `[${kind}] ONE undo step`);
      const l3 = await labelText(o.idx);
      assert(/^-3\.0/.test(l3), `[${kind}] the label reads the signed value: ${l3}`);
      out(`dimension -3: below at 3, label ${l3}`);
      await shot(`${kind}-4-dimension-minus3-below.png`, clip);

      // ---- 3. the Parameters window: off = 4 mm read by the dimension, then off = -2 mm
      const W = '.sk-pwin';
      const row = (name) => `${W} tr.sk-ptable-row[data-name="${name}"]`;
      const cellIn = (name, col) => `${row(name)} input[data-col="${col}"]`;
      const pressSel = async (sel) => { const c = await centerOf(sel); assert(c, `${sel} on screen`); await P.tap(c); };
      await pressSel('#btn-parameters');
      await waitFor(`document.querySelectorAll('${W} tr.pt-dim').length === 1`, `[${kind}] the Parameters window lists the offset dimension`);
      await pressSel(`${W} .pt-add`);
      await type('off'); await Tab(); await type('4 mm'); await Enter(); await sleep(400);
      assert.deepStrictEqual(await evalJs(`JSON.stringify(${STATE}.parameters.map((p) => [p.name, p.expression]))`).then(JSON.parse), [['off', '4 mm']], `[${kind}] + Add off = 4 mm`);
      await pressSel(cellIn(o.name, 'expression'));
      await focusSelect(cellIn(o.name, 'expression')); await type('off'); await Enter(); await sleep(500);
      o = await offset();
      assert(o.value === 4 && o.off.every((p) => Math.abs(Math.abs(p.y - ySrc) - 4) < 1e-4) && await screenSide(o.off[0].y, ySrc) === -1, `[${kind}] the dimension reads off = 4: ABOVE at 4: ${JSON.stringify(o)}`);
      const h4 = await hist();
      await pressSel(cellIn('off', 'expression'));
      await focusSelect(cellIn('off', 'expression')); await type('-2 mm'); await Enter(); await sleep(500);
      o = await offset();
      assert(o.value === -2 && o.off.every((p) => Math.abs(Math.abs(p.y - ySrc) - 2) < 1e-4) && await screenSide(o.off[0].y, ySrc) === 1, `[${kind}] off = -2 mm: the offset moves BELOW at 2: ${JSON.stringify(o)}`);
      assert.strictEqual(await hist(), h4 + 1, `[${kind}] ONE undo step`);
      await waitFor(`document.querySelector(${JSON.stringify(row(o.name) + ' td.pt-val')}).textContent === '-2.0'`, `[${kind}] the table shows the dimension's signed value -2.0`);
      out(`parameter off = -2 mm: below at 2, label ${await labelText(o.idx)}`);
      await shot(`${kind}-5-parameter-minus2-below.png`, clip);
      await shot(`${kind}-6-parameters-window.png`, await evalJs(`(() => { const r = document.querySelector('${W}').getBoundingClientRect(); return { x: Math.max(0, r.left), y: Math.max(0, r.top), width: Math.min(r.width, innerWidth - Math.max(0, r.left)), height: Math.min(r.height, innerHeight - Math.max(0, r.top)) }; })()`));
      if (kind === 'mouse') { await evalJs(`document.activeElement && document.activeElement.blur()`); await ctrlZ(); }
      else await pressSel('#btn-undo');
      await sleep(500);
      o = await offset();
      assert(o.value === 4 && o.off.every((p) => Math.abs(Math.abs(p.y - ySrc) - 4) < 1e-4) && await screenSide(o.off[0].y, ySrc) === -1, `[${kind}] ${kind === 'mouse' ? 'Ctrl+Z' : 'the footer Undo'} steps back: ABOVE at 4: ${JSON.stringify(o)}`);
      assert.strictEqual(await evalJs(`${STATE}.parameters[0].expression`), '4 mm', `[${kind}] and off is 4 mm again`);
      out('undo: back to off = 4 (above at 4)');
      out('all checks passed');
    };

    await run('mouse');
    await run('touch');
    console.log('offset-negative-690-live.test.js: ok');
  } finally { await cdp.close(); }
})();
