// tests/canvas-grid-labels-live.test.js — TASK 532: the shared canvas grid shows numbers on the axes in the FILE'S unit, in the real
// apps (headless CDP): SketchStudio (mm) and Shaper's Design canvas (inch); labels are right, follow zoom, never overlap, vanish
// with GRID_MODE off, re-label + re-space live when DOC_UNIT / the inch divisions change, stay out of the world group (what is
// exported / measured), and do not exist in Pen Plotter or Trace. EVIDENCE_DIR=<dir> saves screenshots.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';

await (async () => {
  const cdp = await launchBrowser({ tag: '532lbl' });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, waitFor, navigate } = cdp;
  const shot = async (name) => {
    if (!process.env.EVIDENCE_DIR) return;
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(process.env.EVIDENCE_DIR, name), Buffer.from(r.data, 'base64'));
  };
  try {
    // inside the page: set a viewBox of the given width (centred on cx, cy), let the frame redraw, read the labels back
    const probe = `window.__probe = async (svgSel, width, cx = 0, cy = 0) => {
      const s = document.querySelector(svgSel); const r = s.getBoundingClientRect();
      const h = width * r.height / r.width;
      s.setAttribute('viewBox', (cx - width / 2) + ' ' + (cy - h / 2) + ' ' + width + ' ' + h);
      await new Promise((res) => setTimeout(res, 700));
      const g = s.querySelector('#grid-labels');
      const texts = g ? [...g.children].filter((e) => e.tagName === 'text') : [];
      const tp = g && g.querySelector('#grid-label-ticks'); const td = tp ? tp.getAttribute('d') : '';
      const tr = (t) => /translate\\(([-\\d.e]+) ([-\\d.e]+)\\)/.exec(t.getAttribute('transform')).slice(1).map(Number);
      return {
        ticksX: [...td.matchAll(/M ([-\\d.e]+) 0 V/g)].map((m) => Number(m[1])), ticksY: [...td.matchAll(/M 0 ([-\\d.e]+) H/g)].map((m) => Number(m[1])), tickLen: tp ? Number((/V ([-\\d.e]+)/.exec(t\d) || /H ([-\\d.e]+)/.exec(t\d))[1]) : 0, tickColor: tp ? getCompute\dStyle(tp).stroke : '', labelColor: texts[0] ? getCompute\dStyle(texts[0]).fill : '',
        has: !!g, inWorld: !!(g && g.closest('#world-group')), pe: g && g.getAttribute('pointer-events'),
        fs: g && Number(g.getAttribute('font-size')), pxScale: width / r.width,
        heavy: Number(document.querySelector('#grid-heavy').getAttribute('width')), minor: Number(document.querySelector('#grid').getAttribute('width')),
        items: texts.map((t) => ({ at: tr(t), text: t.textContent, axis: /text-anchor/.test(t.outerHTML) ? 'y' : 'x', box: (({ left, top, right, bottom }) => ({ left, top, right, bottom }))(t.getBoundingClientRect()) })),
      };
    };`;
    const checkLabels = (p, unitMm, tag) => {
      assert(p.has, tag + ': labels exist');
      assert.strictEqual(p.pe, 'none', tag + ': labels take no pointer events');
      assert(!p.inWorld, tag + ': labels are outside the world group');
      assert(Math.abs(p.fs / p.pxScale - 11) < 1e-6, tag + ': constant 11 px on screen: ' + p.fs / p.pxScale);
      assert(p.items.length > 0, tag + ': some labels');
      for (const it of p.items) {
        const along = it.axis === 'x' ? it.at[0] : it.at[1];
        // TASK 534: the Y numbers are the USER's y (positive UP): the label placed at world y reads -y
        const shown = it.axis === 'x' ? along : -along;
        assert(Math.abs(Number(it.text) * unitMm - shown) < 1e-6 * Math.max(1, Math.abs(along)), `${tag}: label "${it.text}" sits at world ${along} (${it.axis})`);
        // TASK 536: a number on a heavy line has no tick; any other number has a tick on its axis at its place
        const onHeavy = Math.abs(along / p.heavy - Math.round(along / p.heavy)) < 1e-6;
        const has = (it.axis === 'x' ? p.ticksX : p.ticksY).some((t) => Math.abs(t - along) < 1e-6 * Math.max(1, Math.abs(along)));
        assert.strictEqual(has, !onHeavy, `${tag}: tick iff off the heavy line: "${it.text}" at ${along}`);
        assert(Number(it.text) !== 0 && !/\.\d*0$|[a-z]/i.test(it.text), tag + ': shortest plain number, no zero, no unit: ' + it.text);
      }
      if (p.ticksX.length + p.ticksY.length) {
        assert(Math.abs(p.tickLen / p.pxScale - 4) < 1e-6, tag + ': tick is 4 px on screen: ' + p.tickLen / p.pxScale);
        assert.strictEqual(p.tickColor, p.labelColor, tag + ': tick has the label colour');
      }
      assert(p.ticksX.length + p.ticksY.length <= p.items.length, tag + ': a tick per off-heavy number only');
      for (let i = 0; i < p.items.length; i++) for (let j = i + 1; j < p.items.length; j++) {
        const a = p.items[i].box, b = p.items[j].box;
        assert(a.right <= b.left + 0.5 || b.right <= a.left + 0.5 || a.bottom <= b.top + 0.5 || b.bottom <= a.top + 0.5, `${tag}: "${p.items[i].text}" overlaps "${p.items[j].text}"`);
      }
    };
    const S = `(await import('/packages/core/settings-manager.js')).default`;
    const setS = (k, v) => evalJs(`(async () => { (${S}).set('${k}', ${JSON.stringify(v)}, { persist: false }); })()`);

    // ---- SketchStudio, mm ----
    await navigate(`http://127.0.0.1:${port}/apps/sketchstudio/index.html`, 5000);
    await waitFor(`!!document.querySelector('#svgCanvas #infinite-grid')`, 'SketchStudio grid');
    await waitFor(`document.getElementById('svgCanvas').dataset.docReady === '1'`, 'SketchStudio restored');
    await evalJs(`localStorage.clear()`);
    await evalJs(probe);
    const SS = '#svgCanvas';
    const seenHeavy = new Set();
    for (const w of [300, 1200, 5000, 40000, 200000]) {
      const p = await evalJs(`__probe('${SS}', ${w})`);
      checkLabels(p, 1, 'ss mm w=' + w);
      seenHeavy.add(p.heavy);
      if (w === 1200) { assert.strictEqual(p.heavy, 100, 'default mm heavy line every 100'); assert.strictEqual(p.minor, 10, 'default mm light line every 10'); await shot('ss-mm-1200.png'); }
      if (w === 5000) await shot('ss-mm-5000.png');
    }
    assert(seenHeavy.size >= 3, 'the heavy line coarsens with zoom: ' + [...seenHeavy]);
    // pan: labels follow
    const pan = await evalJs(`__probe('${SS}', 1200, 5000, 3000)`);
    checkLabels(pan, 1, 'ss mm panned');
    assert(pan.items.some((i) => i.axis === 'x' && i.at[0] > 4000), 'X labels follow the pan');
    // TASK 534: positive Y points UP: a Y number ABOVE the origin (smaller world y on screen) is positive, below is negative
    const ypos = (await evalJs(`__probe('${SS}', 1200)`)).items.filter((i) => i.axis === 'y');
    assert(ypos.some((i) => i.at[1] < 0) && ypos.some((i) => i.at[1] > 0), 'Y numbers on both sides of the origin');
    assert(ypos.every((i) => Math.sign(Number(i.text)) === -Math.sign(i.at[1])), 'Y numbers = user y (up positive)');
    // GRID_MODE off removes them; back on restores
    await setS('GRID_MODE', 'off');
    assert.strictEqual((await evalJs(`__probe('${SS}', 1200)`)).has, false, 'no labels with the grid off');
    await setS('GRID_MODE', 'lines');
    // switching the unit re-labels and re-spaces live
    await setS('DOC_UNIT', 'in');
    let pin = await evalJs(`__probe('${SS}', 300)`);
    checkLabels(pin, 25.4, 'ss in');
    assert(Math.abs(pin.heavy - 25.4) < 1e-9 && Math.abs(pin.minor - 2.54) < 1e-9, `inch default: heavy 1 in, minor 0.1 in: ${pin.heavy} ${pin.minor}`);
    await setS('INCH_GRID_DIVISIONS', 8);
    pin = await evalJs(`__probe('${SS}', 100)`);
    checkLabels(pin, 25.4, 'ss in/8');
    assert(Math.abs(pin.minor - 25.4 / 8) < 1e-9, 'minor = 1/8 in');
    await shot('ss-in8-300.png');
    await setS('INCH_GRID_MAJOR', 2);
    pin = await evalJs(`__probe('${SS}', 300)`);
    checkLabels(pin, 25.4, 'ss in 2in/8');
    assert(Math.abs(pin.heavy - 50.8) < 1e-9 && Math.abs(pin.minor - 6.35) < 1e-9, 'heavy 2 in, minor 1/4 in');
    await setS('DOC_UNIT', 'mm');
    const back = await evalJs(`__probe('${SS}', 1200)`);
    checkLabels(back, 1, 'ss mm again');
    assert.strictEqual(back.heavy, 100);
    await setS('INCH_GRID_DIVISIONS', 10); await setS('INCH_GRID_MAJOR', 1);

    // ---- TASK 536: the step is chosen for readability. Owner's zoom: heavy 10, light 2 mm, 10 units = 265 px ----
    await setS('GRID_SIZE', 2); await setS('GRID_MAJOR_STEP', 10);
    for (const mode of ['lines', 'points']) {
      await setS('GRID_MODE', mode);
      const vw = await evalJs(`document.querySelector('${SS}').getBoundingClientRect().width`);
      const p = await evalJs(`__probe('${SS}', ${vw / 26.5})`);
      checkLabels(p, 1, 'owner zoom ' + mode);
      assert.strictEqual(p.heavy, 10); assert.strictEqual(p.minor, 2);
      const xs = p.items.filter((i) => i.axis === 'x').map((i) => Number(i.text));
      for (const want of [5, 10, 15, 20, -5, -10]) assert(xs.includes(want), `owner zoom ${mode}: X shows ${want}: ${xs}`);
      assert(!xs.includes(2) && !xs.includes(7) && !xs.includes(1), 'no finer numbers: ' + xs);
      assert(p.ticksX.some((t) => Math.abs(t - 5) < 1e-9) && !p.ticksX.some((t) => Math.abs(t - 10) < 1e-9), 'tick at 5, none at 10');
      await shot('owner-zoom-' + mode + '.png');
    }
    await setS('GRID_MODE', 'lines');
    for (const w of [10, 30, 100, 300, 1000, 3000, 10000, 100000]) checkLabels(await evalJs(`__probe('${SS}', ${w})`), 1, 'mm 10/2 w=' + w);
    await setS('GRID_SIZE', 10); await setS('GRID_MAJOR_STEP', 100);
    await setS('DOC_UNIT', 'in'); await setS('INCH_GRID_DIVISIONS', 8);
    for (const w of [12, 30, 60, 100, 300, 1000, 3000, 20000]) checkLabels(await evalJs(`__probe('${SS}', ${w})`), 25.4, 'in/8 w=' + w);
    await setS('DOC_UNIT', 'mm'); await setS('INCH_GRID_DIVISIONS', 10);

    // ---- Shaper (Design canvas; inch by default) ----
    await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`, 5000);
    await waitFor(`!!document.querySelector('.mode-btn[data-mode="design"]')`, 'Shaper ready');
    await evalJs(`localStorage.clear(); document.querySelector('.mode-btn[data-mode="design"]').click()`);
    await sleep(800);
    await evalJs(probe);
    const sh = await evalJs(`__probe('#design-canvas', 200)`);
    checkLabels(sh, 25.4, 'shaper in');
    assert(Math.abs(sh.heavy - 25.4) < 1e-9, 'Shaper (inch file) gets the inch grid');
    const shY = sh.items.filter((i) => i.axis === 'y');
    assert(shY.some((i) => i.at[1] < 0) && shY.every((i) => Math.sign(Number(i.text)) === -Math.sign(i.at[1])), 'Shaper Design: Y numbers above the origin are positive');
    await shot('shaper-design-200.png');

    // ---- Pen Plotter's Design canvas also uses the shared grid (TASK 629; Trace's mounts with the Edit tab, its declaration is checked in design-grid-hosts-node.test.js) ----
    await navigate(`http://127.0.0.1:${port}/apps/penplotter/index.html`, 4000);
    await sleep(1200);
    assert.strictEqual(await evalJs(`document.querySelectorAll('#design-canvas #infinite-grid').length`), 1, '/apps/penplotter/index.html: the shared grid rect is in the Design canvas');
    console.log('canvas-grid-labels-live: ok');
  } finally {
    await cdp.close();
  }
})();
