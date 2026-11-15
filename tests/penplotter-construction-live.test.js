// tests/penplotter-construction-live.test.js: TASK 641 (live headless, REAL mouse): Pen Plotter has the Construction
// toggle; a line drawn with it ON is dashed in Design and is NOT ink: absent from the Export stage's paper view and
// from the exported G-code. A solid line drawn beside it is plotted as before.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';
import { resetBufferLive } from './helpers/reset-buffer.js';

const EVID = path.join(process.cwd(), '.evidence', '641');

await (async () => {
  const cdp = await launchBrowser({ tag: '641-pp', width: 1440, height: 900 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, once, evalJs, waitFor } = cdp;
  try {
    fs.mkdirSync(EVID, { recursive: true });
    const click = async (x, y) => {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0, clickCount: 0 }); await sleep(30);
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 }); await sleep(30);
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 }); await sleep(220);
    };
    const centerOf = (sel) => evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null;
      const r = e.getBoundingClientRect(); return r.width > 0 ? { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } : null; })()`);
    const clickEl = async (sel) => { const c = await centerOf(sel); assert(c, sel + ' not found'); await click(c.x, c.y); };
    const esc = async () => {
      await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await sleep(220);
    };
    const shot = async (file, clip) => {
      const r = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 1 } } : {}) });
      fs.writeFileSync(path.join(EVID, file), Buffer.from(r.data, 'base64'));
    };
    const tab = async (t) => { await evalJs(`document.querySelector('.sk-header-tab[data-tab="${t}"]').click()`); await sleep(900); };

    await resetBufferLive(cdp);
    const loaded = once('Page.loadEventFired');
    await send('Page.navigate', { url: `http://127.0.0.1:${port}/apps/penplotter/index.html` });
    await Promise.race([loaded, sleep(8000)]);
    await waitFor(`!!document.querySelector('.sk-header-tab[data-tab="design"]')`, 'penplotter ready');
    await tab('design');
    await waitFor(`document.querySelector('#design-canvas').getBoundingClientRect().width > 100`, 'design canvas');

    assert(await centerOf('#btn-construct-toggle'), 'Pen Plotter shows the Construction toggle');
    const c = await centerOf('#design-canvas');

    // a solid line, then (Construction ON) a construction line below it
    await clickEl('#tool-line');
    await click(c.x - 150, c.y - 60); await click(c.x + 150, c.y - 60); await esc();
    await clickEl('#btn-construct-toggle');
    assert.strictEqual(await evalJs(`document.getElementById('btn-construct-toggle').getAttribute('aria-pressed')`), 'true', 'toggle is ON');
    await clickEl('#tool-line');
    await click(c.x - 150, c.y + 60); await click(c.x + 150, c.y + 60); await esc();
    await clickEl('#btn-construct-toggle');
    await clickEl('#tool-select');
    await click(c.x, c.y + 250); // deselect

    const shapes = await evalJs(`window.__sketch.controller.state.shapes.map(s => !!s.isConstruction)`);
    assert.deepStrictEqual(shapes.slice().sort(), [false, true], 'one solid and one construction line: ' + JSON.stringify(shapes));
    const dashed = await evalJs(`document.querySelectorAll('#design-canvas .shape-elem[stroke-dasharray], #design-canvas [stroke-dasharray]').length`);
    assert(dashed >= 1, 'the construction line is dashed in Design');
    const cr = await evalJs(`(() => { const b = document.getElementById('design-canvas').getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; })()`);
    await shot('design-stage.png', { x: Math.round(c.x - 260), y: Math.round(c.y - 140), width: 520, height: 280 });

    await tab('export');
    const ink = await evalJs(`document.querySelectorAll('[data-layer="core-geometry"] polyline').length`);
    assert.strictEqual(ink, 1, 'Export paper view draws only the solid line as core geometry');
    const gcode = await evalJs(`JSON.stringify(window.__export.buildGcodeEntries().map(e => e.content || e.gcode || e.text || ''))`);
    const nG1 = (JSON.parse(gcode).join('\n').match(/^G[01]\b/gm) || []).length;
    assert(nG1 > 0, 'the solid line plots');
    const only = await evalJs(`(() => { const t = window.__export.buildGcodeEntries().length; return t; })()`);
    assert(only >= 1, 'G-code exported');
    // every plotted Y lies on the solid line's side: construction sat on the other side of the canvas centre
    const ys = [...JSON.parse(gcode).join('\n').matchAll(/Y(-?\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
    assert(ys.length > 0, 'G-code has Y coordinates');
    assert(Math.max(...ys) - Math.min(...ys) < 1e-3, 'all plotted G-code lies on ONE horizontal line (the solid one): Y range ' + Math.min(...ys) + '..' + Math.max(...ys));
    const g = await evalJs(`(() => { const b = document.querySelector('[data-layer="core-geometry"]').getBoundingClientRect(); return { y: b.top }; })()`);
    await shot('export-preview.png', { x: 230, y: Math.max(0, Math.round(g.y - 120)), width: 900, height: 360 });
    console.log('penplotter-construction-live: ok');
  } finally {
    await cdp.close();
  }
})();
