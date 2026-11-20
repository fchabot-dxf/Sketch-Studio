// tests/export-paths-793-live.test.js — TASK 793: the Export step's third view, "Paths", in the real Shaper page (desktop 1280 x 800 mouse; phone 390 x 844 touch).
//   argv: nothing = desktop, "phone" = phone. A drawing with every path kind: a plate (Outside, tabs) with a hole (Inside), a Spiral pocket (Loop on), a Raster pocket
//   (Loop off), an On line square with a lead-in arc, and a Guide.
//   1. the toggle 3D | 2D | Paths (one pressed; remembered: localStorage shaper-review-view);
//   2. the view: one stroke per element of the file (no fill, the cut type's colour), the bit-centre dashed lines, the direction marks, the legend;
//   3. a tap on a written path and on a bit-centre line picks its cut ("its cut" label, as the 2D view); Fit; zoom redraws the darts at the same screen size;
//   4. 2D and 3D still work (2D: no stroke classes, no overlay; its shaded fills).
// Screenshots: .evidence/793/ (overview, zoomed lead-in + tabs, zoomed programmed pocket).
import assert from 'node:assert';
import path from 'node:path';
import { openPocketPage } from './helpers/pocket-live.js';
import { sleep } from './helpers/cdp-browser.js';

const phone = process.argv.includes('phone');
const t = await openPocketPage({ tag: phone ? '793-phone' : '793', phone, evidenceDir: path.resolve('.evidence/793'), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
if (!t) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
const { evalJs, waitFor, clickEl, openMode, setUnit, send } = t;
const D = phone ? 'phone' : 'desktop';
const ok = (c, m) => { assert.ok(c, `${D}: ${m}`); };
try {
  await setUnit('mm');
  await openMode('design');
  await waitFor('!!(window.__designController && window.__designController.state)', 'design controller ready');
  await evalJs(`(async () => {
    const st = window.__designController.state;
    for (const k of [...st.joints.keys()]) st.joints.delete(k);
    st.shapes.length = 0; st.constraints.length = 0; st.profiles.length = 0;
    const poly = (n, pts) => { pts.forEach(([x, y], i) => st.joints.set(n + 'j' + i, { x, y })); pts.forEach((_, i) => st.shapes.push({ id: n + 's' + i, type: 'line', joints: [n + 'j' + i, n + 'j' + ((i + 1) % pts.length)] })); };
    const circ = (n, x, y, r) => { st.joints.set(n + 'c', { x, y }); st.shapes.push({ id: n + 's', type: 'circle', joints: [n + 'c'], radius: r }); };
    poly('P', [[0, 0], [240, 0], [240, 140], [0, 140]]);
    circ('H', 25, 25, 10);
    poly('Q', [[60, 15], [120, 15], [120, 60], [60, 60]]);
    poly('R', [[140, 15], [215, 15], [215, 60], [140, 60]]);
    poly('O', [[60, 85], [120, 85], [120, 125], [60, 125]]);
    circ('G', 190, 105, 12);
    st.saveState('793 drawing');
    const lf = await import('/packages/core/loop-finder.js');
    const cp = await import('/tests/helpers/plan-v2.js');
    cp.V2_PLAN.clear();
    const loopOf = (p) => lf.findLoops(st).find((l) => l.edges.every((e) => e.startsWith(p)));
    const set = (p, rec) => cp.V2_PLAN.set('loop:' + loopOf(p).id, rec);
    const B = { cutOffset: 0, toolDia: 6.35, cutterShape: 'endmill' };
    set('P', { ...B, cutType: 'exterior', cutDepth: 18, holdPart: 'tabs', tabCount: 4, tabWidth: 12, holdThickness: 2 });
    set('H', { ...B, cutType: 'interior', cutDepth: 18 });
    set('Q', { ...B, cutType: 'pocket', cutDepth: 6, clearing: 'linked', stepover: 40, finishAllowance: 0.5, loop: true });
    set('R', { ...B, cutType: 'pocket', cutDepth: 4, clearing: 'raster', stepover: 40, finishAllowance: 0.5, rasterAngle: 0 });
    set('O', { ...B, cutType: 'online', cutDepth: 3, leadIn: true, leadInSide: 'outside' });
    set('G', { cutType: 'guide', cutDepth: 0, cutOffset: 0, toolDia: 6.35 });
  })()`);
  await openMode('review');
  await waitFor(`!document.getElementById('view-review').hidden`, 'the Export step');

  // 1. the toggle
  const view = (v) => evalJs(`document.getElementById('review-view-${v}').getAttribute('aria-pressed')`);
  const labels = await evalJs(`[...document.querySelectorAll('#review-view-switch button')].map((b) => b.textContent)`);
  assert.deepStrictEqual(labels, ['3D', '2D', 'Paths'], `${D}: the switch reads 3D | 2D | Paths`);
  const boxes = await evalJs(`[...document.querySelectorAll('#review-view-switch button')].map((b) => { const r = b.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; })`);
  ok(boxes.every(([w, h]) => w >= 30 && h >= 30), `the three buttons are touch-sized: ${JSON.stringify(boxes)}`);
  await clickEl('#review-view-paths');
  await waitFor(`document.querySelectorAll('#review-2d-canvas .rv2d-path').length > 0`, 'the Paths view');
  await sleep(500);
  assert.deepStrictEqual([await view('3d'), await view('2d'), await view('paths')], ['false', 'false', 'true'], `${D}: only Paths is pressed`);
  assert.strictEqual(await evalJs(`localStorage.getItem('shaper-review-view')`), 'paths', `${D}: the view is remembered`);
  assert.strictEqual(await evalJs(`document.getElementById('review-2d').dataset.mode`), 'paths');

  // 2. one stroke per element of the file, no fill, the cut type's colour; the bit-centre paths; the marks; the legend
  const facts = () => evalJs(`import('/apps/shaper/src/export-payload.js').then((m) => import('/tests/helpers/plan-v2.js').then((C) => {
    const p = m.shaperPreviewOf(window.__designController.state, C.planEntries());
    const els = [...document.querySelectorAll('#review-2d-canvas .rv2d-doc .rv2d-path')];
    const colour = (e) => getComputedStyle(e).stroke;
    return { written: p.written.length, strokes: els.length, fills: [...new Set(els.map((e) => getComputedStyle(e).fill))], types: [...new Set(els.map((e) => e.className.baseVal.split(' ')[1]))].sort(),
      colours: Object.fromEntries([...new Set(els.map((e) => e.className.baseVal.split(' ')[1]))].map((c) => [c, colour(els.find((e) => e.classList.contains(c)))])),
      bit: document.querySelectorAll('#review-2d-canvas .rv2d-bit-center').length, bitExpected: m.bitCentrePaths(window.__designController.state, p.written).flatMap((b) => b.travel).filter((t) => ['outside', 'inside', 'wall', 'island'].includes(t.role)).length,
      darts: document.querySelectorAll('#review-2d-canvas .sk-travel-arrows').length, march: document.querySelectorAll('#review-2d-canvas .rv2d-travel').length,
      legend: (document.querySelector('#review-2d-info .rv2d-paths-legend') || {}).textContent || null, info: document.getElementById('review-2d-info').firstChild.textContent };
  }))`);
  const f = await facts();
  console.log(D, JSON.stringify(f));
  ok(f.written > 10 && f.strokes === f.written, `one stroke per written element (${f.strokes} of ${f.written})`);
  assert.deepStrictEqual(f.fills, ['none'], `${D}: no fill`);
  for (const c of ['rv2d-t-outside', 'rv2d-t-inside', 'rv2d-t-online', 'rv2d-t-guide']) ok(f.types.includes(c), `a ${c} stroke is drawn: ${f.types}`);
  ok(new Set(Object.values(f.colours)).size === 4, `each cut type has its own colour: ${JSON.stringify(f.colours)}`);
  ok(f.bit > 0 && f.bit === f.bitExpected, `the bit-centre dashed lines: ${f.bit} of ${f.bitExpected} derived`);
  ok(f.darts >= 1 && f.march === 1, `direction marks: ${f.darts} dart layers, ${f.march} marching-dash path`);
  ok(/written path/.test(f.legend) && /bit centre/.test(f.legend), `the legend names both (a programmed pocket is written as on-line paths + an inside wall: no pocket element here): ${f.legend}`);

  // screenshots + a pointer on the canvas
  const canvasBox = () => evalJs(`(() => { const r = document.getElementById('review-2d-canvas').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()`);
  const toScreen = (x, y) => evalJs(`(() => { const s = document.getElementById('review-2d-canvas'), p = s.createSVGPoint(); p.x = ${x}; p.y = ${y}; const q = p.matrixTransform(s.getScreenCTM()); return { x: q.x, y: q.y }; })()`);
  const zoomAt = async (wx, wy, steps) => {
    const s = await toScreen(wx, wy);
    for (let i = 0; i < steps; i++) { await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: s.x, y: s.y, deltaX: 0, deltaY: -120 }); await sleep(60); }
    await sleep(300);
  };
  await clickEl('#review-fit'); await sleep(300);
  await t.shot(`paths-overview-${D}.png`, phone ? null : '#review-stage', 1);
  const fit = await evalJs(`document.getElementById('review-2d-canvas').getAttribute('viewBox')`);

  // 3. a tap on a written path picks its cut; on a bit-centre line picks the same element; Fit restores the view
  const tapWorld = async (x, y) => { const s = await toScreen(x, y); await t.press(Math.round(s.x), Math.round(s.y)); };
  const label = () => evalJs(`document.getElementById('review-2d-info').firstChild.textContent`);
  await tapWorld(120, 0); // the plate's top edge (an outside cut with tabs): a written path
  const l1 = await label();
  ok(/outside|pass \(tabs\)/.test(l1), `a tap on the plate's edge reads its cut: ${l1}`);
  assert.strictEqual(await evalJs(`document.querySelectorAll('#review-2d-canvas .rv2d-picked').length`), 1, `${D}: one element picked`);
  await tapWorld(120, 70); await waitFor(`!/outside/.test(document.getElementById('review-2d-info').firstChild.textContent)`, 'the pick is cleared by a tap on empty space'); // empty space (between the pockets and the square)
  // a bit-centre line of the hole (Inside, r = 3.175 in from its wall): the hole is a circle r 10 at (25, 25), so the line is the circle r 6.825
  const bit = await evalJs(`(() => { const b = [...document.querySelectorAll('#review-2d-canvas .rv2d-bit-center')].find((e) => { const q = e.getBBox(); return Math.abs(q.x + q.width / 2 - 25) < 1 && Math.abs(q.y + q.height / 2 - 25) < 1; }); return b ? { w: b.getBBox().width } : null; })()`);
  ok(bit && Math.abs(bit.w - 2 * (10 - 3.175)) < 0.05, `the hole's bit-centre line is a circle of radius ${10 - 3.175} (r + 0): ${JSON.stringify(bit)}`);
  await tapWorld(25 + 6.825, 25);
  const l2 = await label();
  ok(/inside/.test(l2), `a tap on the hole's bit-centre line reads its cut (inside): ${l2}`);
  assert.strictEqual(await evalJs(`document.querySelectorAll('#review-2d-canvas .rv2d-bit-picked').length`), 1, `${D}: its bit-centre line is highlighted`);

  // zoomed screenshots: the lead-in + tabs, then the programmed (Spiral, Loop on) pocket
  await zoomAt(90, 105, 7);
  const zoomed = await evalJs(`document.getElementById('review-2d-canvas').getAttribute('viewBox')`);
  ok(zoomed !== fit, `the wheel zoomed: ${fit} -> ${zoomed}`);
  const dartsZoomed = await evalJs(`document.querySelector('#review-2d-canvas .sk-travel-arrows') && document.querySelector('#review-2d-canvas .sk-travel-arrows').getAttribute('d').length`);
  ok(dartsZoomed > 0, 'the darts are redrawn after a zoom');
  await t.shot(`paths-leadin-${D}.png`, phone ? null : '#review-stage', 1);
  await clickEl('#review-fit'); await sleep(300);
  assert.strictEqual(await evalJs(`document.getElementById('review-2d-canvas').getAttribute('viewBox')`), fit, `${D}: Fit frames the view as before`);
  await zoomAt(90, 37, 6);
  await t.shot(`paths-pocket-${D}.png`, phone ? null : '#review-stage', 1);
  await clickEl('#review-fit'); await sleep(300);
  await zoomAt(240, 70, 6);
  await t.shot(`paths-tabs-${D}.png`, phone ? null : '#review-stage', 1);

  // 4. 2D and 3D still work, with nothing of the Paths view left in 2D
  await clickEl('#review-view-2d');
  await waitFor(`document.querySelectorAll('#review-2d-canvas .rv2d-doc path').length > 0 && document.querySelectorAll('#review-2d-canvas .rv2d-path').length === 0`, 'the 2D view');
  const two = await evalJs(`({ overlay: document.querySelectorAll('#review-2d-canvas .rv2d-paths-overlay').length, bit: document.querySelectorAll('#review-2d-canvas .rv2d-bit-center').length, mode: document.getElementById('review-2d').dataset.mode || null, legend: !!document.querySelector('#review-2d-info .rv2d-paths-legend'), info: document.getElementById('review-2d-info').textContent, fills: [...new Set([...document.querySelectorAll('#review-2d-canvas .rv2d-doc path')].map((e) => getComputedStyle(e).fill))].length })`);
  console.log(D, '2D', JSON.stringify(two));
  assert.deepStrictEqual({ overlay: two.overlay, bit: two.bit, legend: two.legend }, { overlay: 0, bit: 0, legend: false }, `${D}: 2D carries nothing of the Paths view`);
  ok(two.mode === 'paths' ? false : true, `the 2D view is not marked data-mode=paths (${two.mode})`);
  ok(two.fills > 1, '2D keeps its filled elements');
  await t.shot(`view-2d-${D}.png`, phone ? null : '#review-stage', 1);
  await clickEl('#review-view-3d');
  await waitFor(`!document.getElementById('review-canvas-host').hidden && !!document.querySelector('#review-canvas-host canvas')`, 'the 3D view');
  await sleep(800);
  await t.shot(`view-3d-${D}.png`, phone ? null : '#review-stage', 1);
  await clickEl('#review-view-paths');
  await waitFor(`document.querySelectorAll('#review-2d-canvas .rv2d-path').length > 0 && document.getElementById('review-canvas-host').hidden`, 'Paths again');
  console.log(`export-paths-793-live (${D}): ok`);
} finally { await t.close(); }
