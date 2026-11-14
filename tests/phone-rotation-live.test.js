// tests/phone-rotation-live.test.js — TASK 602: turning a phone between portrait (390 x 844) and landscape (844 x 390) switches the layout LIVE in every
// host of the shared Design tab (SketchStudio, Shaper, Pen Plotter, Trace): no reload, nothing lost (the drawn geometry, the active tool, SketchStudio's
// document tabs), and the view keeps its centre. Landscape = the rail on the left and the SKETCHES box collapsed; portrait = the ribbon across the top
// again.
// It also pins that the PORTRAIT (390 x 844, touch) and DESKTOP (1440 x 900, mouse) layouts are unchanged: the chrome rows and the canvas measured
// before TASK 602 (.evidence/602/before-measurements.json). SketchStudio's own changes there are the owner's (TASK 602): the document tab strip is
// BELOW the header (26 px with a mouse, 45 px under a finger: 44 px tabs + its line), the header lost Export (now in the menu) and the "Saved" text.
// TASK 605: Shaper, Pen Plotter and Trace have the same strip: their rows below the header move down by exactly the strip row, nothing else changes.
import assert from 'node:assert';
import { launchBrowser, sendRealKey, sleep } from './helpers/cdp-browser.js';

const HOSTS = [
  { name: 'sketchstudio', url: '/apps/sketchstudio/index.html', canvas: '#svgCanvas' },
  { name: 'shaper', url: '/apps/shaper/index.html', canvas: '#design-canvas', enter: `document.querySelector('[data-mode="design"]').click()` },
  { name: 'penplotter', url: '/apps/penplotter/index.html', canvas: '#design-canvas', enter: `document.querySelector('.stage-btn[data-stage="design"]').click()` },
  { name: 'trace', url: '/apps/trace/index.html', canvas: '#design-canvas', enter: `document.querySelector('.tr-tab[data-tab="edit"]').click()` },
];
// measured before TASK 602: [top, height] of header / ribbon / status bar, canvas [left, top, width, height]
const BEFORE = {
  '390x844': {
    sketchstudio: { header: 53, ribbon: 88, footer: 29 },
    shaper: { header: [0, 92], ribbon: [92, 88], canvas: [0, 181, 390, 663] },
    penplotter: { header: [0, 92], ribbon: [92, 88], canvas: [0, 181, 390, 663] },
    trace: { header: [0, 92], ribbon: [92, 88], canvas: [0, 180, 390, 664] },
  },
  '1440x900': {
    sketchstudio: { header: 38, ribbon: 79, footer: 39, canvasW: 1406, canvasBottom: 844 },
    shaper: { header: [0, 44], ribbon: [44, 89], canvas: [0, 134, 1440, 766] },
    penplotter: { header: [0, 44], ribbon: [44, 79], canvas: [0, 124, 1196, 776] },
    trace: { header: [0, 44], ribbon: [44, 79], canvas: [0, 123, 1440, 777] },
  },
};

await (async () => {
  const cdp = await launchBrowser({ tag: '602r', width: 390, height: 844 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, waitFor, navigate } = cdp;
  try {
    const T = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i, radiusX: 1, radiusY: 1, force: 1 })) });
    const tap = async (p) => { await T('touchStart', [p]); await sleep(40); await T('touchEnd', []); await sleep(300); };
    const rectOf = (expr) => evalJs(`(() => { const e = ${expr}; if (!e) return null; const r = e.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, w: r.width, h: r.height, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    const portrait = () => send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenOrientation: { type: 'portraitPrimary', angle: 0 } });
    const landscape = () => send('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 2, mobile: true, screenOrientation: { type: 'landscapePrimary', angle: 90 } });
    const open = async (h) => {
      await navigate(`http://127.0.0.1:${port}${h.url}`, 8000);
      if (h.enter) { await sleep(800); await evalJs(h.enter); }
      await waitFor(`!!document.querySelector('.sk-ribbon .sk-ribbon-btn') && !!document.querySelector('.sk-browser .sk-sketch-node') && !!document.querySelector('[data-doc-ready="1"]')`, h.name + ' Design view');
      await sleep(600);
    };
    const snapshot = (h) => evalJs(`(() => { const c = document.querySelector('${h.canvas}'); const vb = c.getAttribute('viewBox').split(/[ ,]+/).map(Number);
      return { marker: document.documentElement.dataset.t602 || null, drawn: c.querySelectorAll('.shape-elem, .joint-handle').length, // the geometry the renderer draws (not hover / snap marks)
        cx: vb[0] + vb[2] / 2, cy: vb[1] + vb[3] / 2, tool: (document.querySelector('.sk-ribbon .sk-ribbon-btn.active') || {}).id || null,
        dir: getComputedStyle(document.querySelector('.sk-ribbon')).flexDirection, collapsed: document.querySelector('.sk-browser').classList.contains('collapsed'),
        tabs: [...document.querySelectorAll('.sk-doctab-name')].map((e) => e.textContent) }; })()`);

    // ---- rotation, every host ----
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    for (const h of HOSTS) {
      await portrait();
      await open(h);
      // draw a line with real taps, then pick Circle (the tool must survive the turn)
      const empty = (await snapshot(h)).drawn;
      const line = await rectOf(`document.getElementById('tool-line')`);
      await tap(line);
      const cv = await rectOf(`document.querySelector('${h.canvas}')`);
      const second = { x: Math.round(cv.left + cv.w * 0.7), y: Math.round(cv.top + cv.h * 0.7) };
      await tap({ x: Math.round(cv.left + cv.w * 0.3), y: Math.round(cv.top + cv.h * 0.6) });
      // the line's creation box takes the finger (it is tapped to type in it), so it never sits beside the finger where the next tap lands: it docks at the
      // canvas's top centre, 64 px down (numeric-input-manager.js placeLiveBox, TASK 602; 597 put it 15 px from the tap and the second tap landed ON it)
      const box = await rectOf(`[...document.querySelectorAll('.sk-live-box')].find((e) => e.getClientRects().length && getComputedStyle(e).display !== 'none')`);
      assert(box, h.name + ': the line box shows on the first tap');
      assert(Math.abs(box.top - (cv.top + 64)) <= 1 && Math.abs((box.left + box.right) / 2 - (cv.left + cv.w / 2)) <= 1, h.name + ': the touch box docks at the canvas top centre: ' + JSON.stringify({ box, cv }));
      assert(!(second.x >= box.left && second.x <= box.right && second.y >= box.top && second.y <= box.bottom), h.name + ': the next tap is not on the box');
      await tap(second);
      await sendRealKey(send, 'Escape', 'Escape', 27); await sleep(300);
      await evalJs(`document.getElementById('tool-circle').scrollIntoView({ block: 'nearest', inline: 'nearest' })`); await sleep(400);
      await tap(await rectOf(`document.getElementById('tool-circle')`));
      await evalJs(`document.documentElement.dataset.t602 = 'no-reload'`); // a reload would drop this mark
      const p0 = await snapshot(h);
      assert.strictEqual(p0.dir, 'row', h.name + ': portrait has the ribbon across the top');
      assert.strictEqual(p0.tool, 'tool-circle', h.name + ': Circle is active before the turn');
      assert(p0.drawn > empty, h.name + `: the line is drawn (${empty} -> ${p0.drawn} drawn elements)`);

      await landscape(); await sleep(700);
      const l = await snapshot(h);
      assert.strictEqual(l.marker, 'no-reload', h.name + ': turning to landscape does not reload');
      assert.strictEqual(l.dir, 'column', h.name + ': landscape switched live to the rail');
      assert.strictEqual(l.collapsed, true, h.name + ': the SKETCHES box collapses in landscape');
      assert.strictEqual(l.drawn, p0.drawn, h.name + ': the drawing is all there');
      assert.strictEqual(l.tool, p0.tool, h.name + ': the active tool is kept');
      assert.deepStrictEqual(l.tabs, p0.tabs, h.name + ': the document tabs are kept');
      assert(Math.abs(l.cx - p0.cx) < 1e-6 && Math.abs(l.cy - p0.cy) < 1e-6, h.name + `: the view keeps its centre (${p0.cx},${p0.cy} -> ${l.cx},${l.cy})`);
      const canvasL = await rectOf(`document.querySelector('${h.canvas}')`);
      assert(canvasL.h / 390 >= 0.6, h.name + ': the canvas has >= 60 % of the landscape height: ' + canvasL.h);

      await portrait(); await sleep(700);
      const p1 = await snapshot(h);
      assert.strictEqual(p1.marker, 'no-reload', h.name + ': turning back does not reload');
      assert.strictEqual(p1.dir, 'row', h.name + ': back in portrait the ribbon is across the top again');
      assert.strictEqual(p1.drawn, p0.drawn, h.name + ': the drawing is all there after turning back');
      assert.strictEqual(p1.tool, p0.tool, h.name + ': the tool too');
      assert(Math.abs(p1.cx - p0.cx) < 1e-6 && Math.abs(p1.cy - p0.cy) < 1e-6, h.name + ': and the centre');
      console.log(`rotation ${h.name}: portrait -> landscape -> portrait live, ${p0.drawn} drawn elements kept, ${p0.tool} kept, centre (${p0.cx.toFixed(3)}, ${p0.cy.toFixed(3)}) kept`);
    }

    // ---- portrait and desktop chrome are unchanged ----
    const rows = (h) => evalJs(`(() => { const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return b.height ? [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height), Math.round(b.bottom)] : null; };
      return { header: r('header'), strip: r('.sk-doctabs'), ribbon: r('.sk-ribbon'), footer: r('footer'), canvas: r('${h.canvas}') }; })()`);
    for (const [size, mouse] of [['390x844', false], ['1440x900', true]]) {
      const [w, hgt] = size.split('x').map(Number);
      await send('Emulation.setDeviceMetricsOverride', mouse ? { width: w, height: hgt, deviceScaleFactor: 1, mobile: false } : { width: w, height: hgt, deviceScaleFactor: 2, mobile: true, screenOrientation: { type: 'portraitPrimary', angle: 0 } });
      await send('Emulation.setTouchEmulationEnabled', { enabled: !mouse, maxTouchPoints: mouse ? 1 : 5 });
      for (const h of HOSTS) {
        await open(h);
        const m = await rows(h), b = BEFORE[size][h.name], tag = `${h.name} @${size}: `;
        assert.strictEqual(await evalJs(`getComputedStyle(document.querySelector('.sk-ribbon')).flexDirection`), 'row', tag + 'the ribbon is a row (no rail)');
        if (h.name === 'sketchstudio') {
          assert.strictEqual(m.header[3], b.header, tag + 'header height unchanged');
          assert.strictEqual(m.ribbon[3], b.ribbon, tag + 'ribbon height unchanged');
          assert.strictEqual(m.footer[3], b.footer, tag + 'status bar height unchanged');
          assert.strictEqual(m.strip[1], m.header[4], tag + 'the tab strip is right under the header');
          assert.strictEqual(m.strip[3], mouse ? 26 : 31, tag + 'the tab strip row height (26 mouse / 31 finger, TASK 608)');
          assert(m.ribbon[1] >= m.strip[4], tag + 'the ribbon is under the tab strip');
          if (mouse) { assert.strictEqual(m.canvas[2], b.canvasW, tag + 'canvas width unchanged'); assert.strictEqual(m.canvas[4], b.canvasBottom, tag + 'canvas bottom unchanged'); }
        } else {
          // TASK 605: these hosts have the tab strip too (26 px mouse / 31 px finger) right under the header; everything below it moved down by exactly that row
          const row = mouse ? 26 : 31;
          assert.deepStrictEqual([m.header[1], m.header[3]], b.header, tag + 'header unchanged');
          assert.deepStrictEqual([m.strip[1], m.strip[3]], [m.header[4], row], tag + 'the tab strip is right under the header, ' + row + ' px tall');
          assert.deepStrictEqual([m.ribbon[1], m.ribbon[3]], [b.ribbon[0] + row, b.ribbon[1]], tag + 'ribbon unchanged in size, down by the strip row');
          assert.deepStrictEqual([m.canvas[0], m.canvas[1], m.canvas[2], m.canvas[3]], [b.canvas[0], b.canvas[1] + row, b.canvas[2], b.canvas[3] - row], tag + 'canvas: same width, starts a strip row lower, ends where it did');
        }
        console.log(`unchanged ${tag}${JSON.stringify(m)}`);
      }
    }
    console.log('LIVE-OK phone-rotation: 4 apps turn portrait <-> landscape live (no reload, drawing / tool / tabs / view centre kept); portrait 390x844 and desktop 1440x900 chrome unchanged');
  } finally { await cdp.close(); }
})();
