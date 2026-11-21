// tests/export-sim-801-live.test.js — TASK 801: the Export step's SIMULATION in the real Shaper page (desktop 1280 x 800 mouse; `phone` = 390 x 844 touch).
//   A drawing with a plate (Outside) and its hole (Inside), a Raster pocket, a Spiral pocket and a plain On line square, as the page plans them (plan-v2.js).
//   1. the Simulate panel over the view (closed until its toggle is pressed): its operations (the list's order), Preview selected / Preview all / Reset preview, Play / Pause, the scrubber, the speeds, prev / next, the
//      Animate and Show passes boxes (Show passes only in 3D), the note under the controls; touch-sized on a phone.
//   2. 3D: Preview all plays (the time moves, the wood is rebuilt as paths end: fewer triangles cut than at the end), Pause stops it, a drag of the scrubber moves
//      to that point (the label names the operation there), next / previous operation, Show passes draws translucent passes; 4 frames 1 s apart.
//   3. 2D: the same run: elements not cut yet are hidden, the count grows while it plays; 4 frames 1 s apart; a zoomed shot.
//   4. Paths: the bit marker (a circle of the bit's radius, to scale) and its trail, the rest faint; 4 frames 1 s apart; a zoomed shot.
//   5. The board keeps its state: Reset preview = nothing cut; Preview selected (the pocket) = only it, then Preview selected (the plate) on top: both.
//   6. OUT OF DATE: a Design edit, back to Export: the card says the Export step's "n operations are out of date" line with Recalculate, nothing plays; Recalculate:
//      the card works again.
//   7. Reduced motion (desktop only): no auto-play: Preview all goes straight to its end, the scrubber and the steps still work.
// Screenshots: .evidence/801/ (<view>-<n>-<desktop|phone>.png sequences, zoomed shots).
import assert from 'node:assert';
import path from 'node:path';
import { openPocketPage } from './helpers/pocket-live.js';
import { sleep } from './helpers/cdp-browser.js';

const phone = process.argv.includes('phone');
const D = phone ? 'phone' : 'desktop';
const t = await openPocketPage({ tag: phone ? '801-phone' : '801', phone, evidenceDir: path.resolve('.evidence/801'), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
if (!t) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
const { evalJs, waitFor, clickEl, openMode, setUnit, send } = t;
const ok = (c, m) => { assert.ok(c, `${D}: ${m}`); };
const sim = () => evalJs(`import('/apps/shaper/src/main.js').then((m) => m.currentExportSim().inspect())`);
const view3d = () => evalJs(`import('/apps/shaper/src/main.js').then((m) => m.currentReviewView() && m.currentReviewView().inspect().sim)`);
const flat = () => evalJs(`({ todo: document.querySelectorAll('#review-2d-canvas .rv2d-sim-todo').length, els: document.querySelectorAll('#review-2d-canvas .rv2d-doc path, #review-2d-canvas .rv2d-doc circle').length,
  bit: (() => { const c = document.querySelector('#review-2d-canvas .rv2d-sim-bit'); return c ? { x: +c.getAttribute('cx'), y: +c.getAttribute('cy'), r: +c.getAttribute('r') } : null; })(), trail: !!document.querySelector('#review-2d-canvas .rv2d-sim-trail') })`);
const label = () => evalJs(`document.getElementById('sim-label').textContent`);
// a drag of the scrubber to a fraction of its width, as a user does (mouse, or a finger)
async function scrubTo(f) {
  const r = await evalJs(`(() => { const e = document.getElementById('sim-scrub'); e.scrollIntoView({ block: 'nearest' }); const b = e.getBoundingClientRect(); return { x: b.left, y: b.top + b.height / 2, w: b.width }; })()`);
  const x0 = Math.round(r.x + r.w * 0.05), x1 = Math.round(r.x + 8 + (r.w - 16) * f), y = Math.round(r.y);
  if (phone) {
    const T = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p) => ({ x: p.x, y: p.y, id: 0, radiusX: 1, radiusY: 1, force: 1 })) });
    await T('touchStart', [{ x: x0, y }]); for (let i = 1; i <= 6; i++) { await T('touchMove', [{ x: Math.round(x0 + ((x1 - x0) * i) / 6), y }]); await sleep(30); } await T('touchEnd', []);
  } else {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x0, y, button: 'none' });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x0, y, button: 'left', buttons: 1, clickCount: 1 });
    for (let i = 1; i <= 6; i++) { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(x0 + ((x1 - x0) * i) / 6), y, button: 'left', buttons: 1 }); await sleep(30); }
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x1, y, button: 'left', buttons: 0, clickCount: 1 });
  }
  await sleep(400);
}
// the drawing and its plan (plan-v2.js loads it through the app's own document read)
async function setup() {
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
    st.saveState('801 drawing');
    const lf = await import('/packages/core/loop-finder.js');
    const cp = await import('/tests/helpers/plan-v2.js');
    cp.V2_PLAN.clear();
    const loopOf = (p) => lf.findLoops(st).find((l) => l.edges.every((e) => e.startsWith(p)));
    const B = { cutOffset: 0, toolDia: 6.35, cutterShape: 'endmill' };
    cp.V2_PLAN.use(st).load([
      ['loop:' + loopOf('P').id, { ...B, cutType: 'exterior', cutDepth: 18 }],
      ['loop:' + loopOf('H').id, { ...B, cutType: 'interior', cutDepth: 18 }],
      ['loop:' + loopOf('Q').id, { ...B, cutType: 'pocket', cutDepth: 6, clearing: 'linked', stepover: 40, finishAllowance: 0.5, loop: true }],
      ['loop:' + loopOf('R').id, { ...B, cutType: 'pocket', cutDepth: 4, clearing: 'raster', stepover: 40, finishAllowance: 0.5, rasterAngle: 0 }],
      ['loop:' + loopOf('O').id, { ...B, cutType: 'online', cutDepth: 3 }],
    ]);
  })()`);
}
const stageSel = phone ? null : '#review-stage';
// four frames 1 s apart while it plays (each copied to .evidence/801 as it is made)
async function sequence(name) {
  const at = [];
  for (let i = 1; i <= 4; i++) { await t.shot(`${name}-${i}-${D}.png`, stageSel, 1); at.push(Math.round((await sim()).t)); if (i < 4) await sleep(1000); }
  return at;
}
try {
  await setUnit('mm');
  await setup();
  await evalJs(`localStorage.setItem('shaper-review-view', '3d')`);
  await openMode('review');
  await waitFor(`!document.getElementById('view-review').hidden`, 'the Export step');
  if (await evalJs(`document.getElementById('review-view-3d').getAttribute('aria-pressed')`) !== 'true') await clickEl('#review-view-3d');

  // 1. the card
  await waitFor(`!document.getElementById('sim-preview-sel').disabled && document.getElementById('sim-op').options.length > 0`, 'the Simulate panel is ready', 60000);
  // the panel is over the view, closed at first (nothing of the Export side panel moves); its toggle at the view's top right opens it
  ok(await evalJs(`document.getElementById('review-sim').hidden && document.getElementById('review-sim-toggle').getAttribute('aria-expanded') === 'false' && !document.getElementById('review-side').contains(document.getElementById('review-sim'))`), 'the panel is closed at first, over the view (not in the side panel)');
  await clickEl('#review-sim-toggle'); await waitFor(`!document.getElementById('review-sim').hidden`, 'the panel opens');
  const s0 = await sim();
  console.log(D, 'card', JSON.stringify({ ops: s0.ops, label: s0.label, count: s0.count }));
  const listOrder = await evalJs(`import('/apps/shaper/src/operations-store.js').then((m) => m.storeOps().filter((o) => o.on !== false).map((o) => o.id))`);
  ok(s0.ops.length === 5 && JSON.stringify(s0.ops.map((o) => o.id)) === JSON.stringify(listOrder.filter((id) => s0.ops.some((o) => o.id === id))), `the card's operations are the list's, in its order: ${JSON.stringify(s0.ops)}`);
  ok(s0.active === false && /Press Preview/.test(s0.label), `inactive until a preview: "${s0.label}"`);
  const card = await evalJs(`(() => { const q = (s) => document.querySelector(s); const box = (s) => { const r = q(s).getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; };
    return { texts: ['#sim-preview-sel', '#sim-preview-all', '#sim-reset'].map((s) => q(s).textContent), speeds: [...q('#sim-speed').options].map((o) => o.textContent),
      boxes: ['#sim-preview-sel', '#sim-play', '#sim-prev', '#sim-next'].map(box), passesShown: !q('#sim-passes-row').hidden, note: q('#sim-note').textContent, title: q('#review-sim .simexport-title').textContent }; })()`);
  console.log(D, 'card', JSON.stringify(card));
  assert.deepStrictEqual(card.texts, ['Preview selected', 'Preview all', 'Reset preview'], `${D}: the three VCarve-style buttons`);
  assert.deepStrictEqual(card.speeds, ['1×', '4×', '16×'], `${D}: the speeds`);
  ok(card.title === 'Simulate' && card.passesShown, 'the card title; Show passes is offered in 3D');
  ok(/not real time/.test(card.note) && /AutoPass/.test(card.note) && /depth passes are not animated/.test(card.note), `the one line under the controls: ${card.note}`);
  if (phone) ok(card.boxes.every(([w, h]) => h >= 44 && w >= 44), `touch-sized buttons: ${JSON.stringify(card.boxes)}`);
  await evalJs(`document.getElementById('review-sim').scrollIntoView({ block: 'start' })`); await sleep(200); // the card is the last of the side panel
  await t.shot(`card-${D}.png`, '#review-sim', 2);

  // 2. 3D: Preview all plays
  await evalJs(`document.getElementById('sim-speed').value = '4'; document.getElementById('sim-speed').dispatchEvent(new Event('change'))`);
  await clickEl('#sim-preview-all');
  await sleep(300);
  let s = await sim();
  ok(s.active && s.playing && s.run.length === 5 && s.speed === 4, `Preview all: a run of the 5 operations, playing at 4x: ${JSON.stringify({ playing: s.playing, run: s.run && s.run.length, speed: s.speed })}`);
  const seq3d = await sequence('3d');
  console.log(D, '3D frame times (mm along the run)', seq3d);
  ok(seq3d[3] > seq3d[0], `the 3D run moves: ${seq3d}`);
  const mid3d = await view3d();
  console.log(D, '3D sim', JSON.stringify(mid3d));
  ok(mid3d && mid3d.triangles > 0, 'the 3D view shows the simulation\'s wood');
  await clickEl('#sim-play'); // pause
  const p1 = (await sim()).t; await sleep(800); const p2 = (await sim()).t;
  ok(p1 === p2 && !(await sim()).playing, `Pause stops it (${p1} = ${p2})`);
  await scrubTo(0.5);
  s = await sim();
  ok(Math.abs(s.t / s.total - 0.5) < 0.04, `a drag of the scrubber to the middle: t / total = ${(s.t / s.total).toFixed(3)}`);
  ok(/^Operation \d of 5 · /.test(s.label), `the label names the operation there: "${s.label}"`);
  const midOp = s.run.find((o) => o.t0 <= s.t && s.t < o.t1);
  await clickEl('#sim-next');
  s = await sim();
  const nextOp = s.run[s.run.indexOf(s.run.find((o) => o.id === midOp.id)) + 1];
  ok(nextOp ? Math.abs(s.t - nextOp.t0) < 1e-6 && s.label.startsWith(`Operation ${nextOp.n} of 5`) : s.t === s.total, `Next operation: the start of the next one (${s.label})`);
  await clickEl('#sim-prev');
  s = await sim();
  ok(Math.abs(s.t - midOp.t0) < 1e-6, `Previous operation from the next one's start: the start of the one before it (${s.label})`);
  const before = s.run[s.run.findIndex((o) => o.id === midOp.id) - 1];
  await clickEl('#sim-prev');
  s = await sim();
  ok(Math.abs(s.t - (before ? before.t0 : 0)) < 1e-6, `Previous operation again: the one before (${s.label})`);
  await scrubTo(0.15); const w15 = await view3d();
  await scrubTo(1); const w100 = await view3d();
  ok(w15.key !== w100.key, `the wood changes with the time: ${w15.key} -> ${w100.key}`);
  const finished = await evalJs(`import('/apps/shaper/src/main.js').then((m) => m.currentReviewView().lastBuild.triangles)`);
  ok(w100.triangles === finished, `at the end of Preview all the wood is the finished part (${w100.triangles} = ${finished} triangles)`);
  await clickEl('#sim-passes');
  await sleep(500);
  const passes = await view3d();
  console.log(D, 'passes', JSON.stringify(passes.passes));
  ok(passes.passes.length >= 4 && passes.passes.every((p) => p.visible && p.drawn > 0), 'Show passes: every operation\'s passes drawn');
  ok(new Set(passes.passes.map((p) => p.color)).size >= 3, `one colour per operation type: ${passes.passes.map((p) => p.color)}`);
  await clickEl('#review-top'); await sleep(400);
  await t.shot(`3d-passes-top-${D}.png`, stageSel, 1);
  await clickEl('#review-reset'); await sleep(400);
  await t.shot(`3d-passes-${D}.png`, stageSel, 1);
  await scrubTo(0.4); await sleep(300);
  const p40 = await view3d();
  ok(p40.passes.some((p) => p.drawn < passes.passes.find((q) => q.op === p.op).drawn) || p40.passes.length < passes.passes.length, 'the passes follow the timeline (fewer drawn part way)');
  await t.shot(`3d-passes-40-${D}.png`, stageSel, 1);
  await clickEl('#sim-passes');

  // 3. 2D: the same run
  await clickEl('#review-view-2d');
  await waitFor(`document.querySelectorAll('#review-2d-canvas .rv2d-doc path').length > 0`, 'the 2D view');
  await sleep(500);
  ok((await evalJs(`document.getElementById('sim-passes-row').hidden`)) === true, 'Show passes is a 3D option only');
  await scrubTo(0.02);
  const f0 = await flat();
  await clickEl('#sim-play');
  const seq2d = await sequence('2d');
  const f1 = await flat();
  console.log(D, '2D', JSON.stringify({ f0, f1, seq2d }));
  ok(f0.todo > f1.todo && f1.todo >= 0, `2D: the elements appear as it plays (hidden ${f0.todo} -> ${f1.todo})`);
  await clickEl('#sim-play');
  await scrubTo(0.55);
  await clickEl('#review-sim-toggle'); // closed for the zoomed shot (the panel is over the view)
  await evalJs(`(() => { const s = document.getElementById('review-2d-canvas'); const r = s.getBoundingClientRect(); s.dispatchEvent(new WheelEvent('wheel', { clientX: r.left + r.width * 0.55, clientY: r.top + r.height * 0.4, deltaY: -360, bubbles: true })); })()`);
  await sleep(500);
  await t.shot(`2d-zoomed-${D}.png`, stageSel, phone ? 1 : 1.5);
  await clickEl('#review-fit'); await sleep(300);
  await clickEl('#review-sim-toggle');

  // 4. Paths: the bit marker
  await clickEl('#review-view-paths');
  await waitFor(`document.querySelectorAll('#review-2d-canvas .rv2d-path').length > 0`, 'the Paths view');
  await sleep(500);
  await scrubTo(0.3);
  const fp = await flat();
  s = await sim();
  console.log(D, 'Paths', JSON.stringify(fp), s.label);
  ok(fp.bit && Math.abs(fp.bit.r - 3.175) < 1e-6, `the bit marker: a circle of the 6.35 mm bit's radius, to scale (${fp.bit && fp.bit.r})`);
  ok(fp.trail && fp.todo > 0, 'its trail, and the paths not cut yet faint');
  const op = await evalJs(`getComputedStyle(document.querySelector('#review-2d-canvas .rv2d-sim-todo')).opacity`);
  ok(Number(op) < 0.5, `faint: opacity ${op}`);
  await clickEl('#sim-play');
  const seqP = await sequence('paths');
  const fp2 = await flat();
  ok(fp2.bit && (fp2.bit.x !== fp.bit.x || fp2.bit.y !== fp.bit.y), `the bit moves along the paths: ${JSON.stringify(fp.bit)} -> ${JSON.stringify(fp2.bit)}`);
  console.log(D, 'Paths sequence', seqP);
  await clickEl('#sim-play');
  const bit = (await flat()).bit;
  await clickEl('#review-sim-toggle'); // closed for the zoomed shot
  if (bit) {
    const scr = await evalJs(`(() => { const s = document.getElementById('review-2d-canvas'), p = s.createSVGPoint(); p.x = ${bit.x}; p.y = ${bit.y}; const q = p.matrixTransform(s.getScreenCTM()); return { x: q.x, y: q.y }; })()`);
    for (let i = 0; i < 6; i++) { await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: Math.round(scr.x), y: Math.round(scr.y), deltaX: 0, deltaY: -120 }); await sleep(60); }
    await sleep(400);
    await t.shot(`paths-zoomed-${D}.png`, stageSel, phone ? 1 : 1.5);
    await clickEl('#review-fit'); await sleep(300);
  }
  await clickEl('#review-sim-toggle');

  // 5. the board keeps its state
  await clickEl('#sim-reset');
  s = await sim();
  ok(s.active && !s.run && s.carved.length === 0 && /Uncut board/.test(s.label), `Reset preview: the uncut board ("${s.label}")`);
  await clickEl('#review-view-2d'); await sleep(600);
  const fr = await flat();
  const guides = await evalJs(`[...document.querySelectorAll('#review-2d-canvas .rv2d-doc path, #review-2d-canvas .rv2d-doc circle')].filter((e) => e.getAttribute('shaper:cutType') === 'guide' && !e.classList.contains('rv2d-sim-todo')).length`);
  ok(fr.todo === fr.els - guides && guides >= 1, `2D after Reset: every cut hidden, only the guides shown (${fr.todo} of ${fr.els} hidden, ${guides} guides: the spiral pocket's start mark)`);
  await clickEl('#sim-animate'); // Animate off: a preview shows its result at once
  const raster = s0.ops.find((o) => /raster/i.test(o.text)) || s0.ops[0];
  await evalJs(`document.getElementById('sim-op').value = ${JSON.stringify(raster.id)}; document.getElementById('sim-op').dispatchEvent(new Event('change'))`);
  await clickEl('#sim-preview-sel');
  s = await sim();
  ok(!s.playing && s.t === s.total && s.run.length === 1 && s.run[0].id === raster.id, `Animate off + Preview selected (${raster.text}): straight to its end`);
  const plate = s0.ops.find((o) => /outside/i.test(o.text)) || s0.ops.at(-1);
  await evalJs(`document.getElementById('sim-op').value = ${JSON.stringify(plate.id)}; document.getElementById('sim-op').dispatchEvent(new Event('change'))`);
  await clickEl('#sim-preview-sel');
  s = await sim();
  ok(JSON.stringify(s.carved) === JSON.stringify([raster.id]) && s.run[0].id === plate.id, `the board keeps the pocket while the plate is previewed on it: carved ${s.carved}`);
  await t.shot(`2d-kept-${D}.png`, stageSel, 1);
  await clickEl('#sim-animate');

  // 6. OUT OF DATE: a Design edit, back to Export
  await openMode('design');
  // a Design edit: a new line drawn beside the plate (the sketch's geometry changed: every operation's paths were made for the sketch before it)
  await evalJs(`(() => { const st = window.__designController.state; st.joints.set('Xj0', { x: 260, y: 10 }); st.joints.set('Xj1', { x: 300, y: 40 }); st.shapes.push({ id: 'Xs0', type: 'line', joints: ['Xj0', 'Xj1'] }); st.saveState('801 edit'); })()`);
  await sleep(300);
  await openMode('review');
  await waitFor(`/out of date/.test(document.getElementById('sim-label').textContent)`, 'the card says the operations are out of date', 30000);
  const ood = await evalJs(`({ text: document.getElementById('sim-label').textContent, btn: !!document.querySelector('#sim-label .sk-wait-action'), dis: document.getElementById('sim-preview-all').disabled })`);
  console.log(D, 'out of date', JSON.stringify(ood));
  ok(ood.btn && ood.dis && /operations? (is|are) out of date/.test(ood.text), `nothing plays stale paths: "${ood.text}" with Recalculate, the buttons off`);
  await evalJs(`document.getElementById('review-sim').scrollIntoView({ block: 'start' })`); await sleep(200); // the card is the last of the side panel
  await t.shot(`card-out-of-date-${D}.png`, '#review-sim', 2);
  await clickEl('#sim-label .sk-wait-action');
  await waitFor(`!document.getElementById('sim-preview-all').disabled`, 'Recalculate: the card works again', 60000);
  s = await sim();
  ok(!s.active && /Press Preview/.test(s.label), `after Recalculate: the new plan's timeline, inactive ("${s.label}")`);

  // 7. reduced motion: no auto-play (desktop)
  if (!phone) {
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await send('Page.reload', {});
    await waitFor(`!!document.querySelector('.sk-header-tab[data-tab="design"]')`, 'the page again');
    await sleep(800);
    await setup();
    await openMode('review');
    await waitFor(`!document.getElementById('sim-preview-all').disabled`, 'the card after the reload', 60000);
    await clickEl('#review-sim-toggle'); await waitFor(`!document.getElementById('review-sim').hidden`, 'the panel opens (a new page: closed)');
    ok((await evalJs(`document.getElementById('sim-animate').checked`)) === false, 'reduced motion: Animate starts off');
    await clickEl('#sim-preview-all');
    s = await sim();
    ok(!s.playing && s.t === s.total, `reduced motion: Preview all does not play, it shows its end (t ${s.t} of ${s.total})`);
    await scrubTo(0.3);
    s = await sim();
    ok(Math.abs(s.t / s.total - 0.3) < 0.05 && !s.playing, `the scrubber still works (${(s.t / s.total).toFixed(2)})`);
    await clickEl('#sim-next');
    ok((await sim()).t > s.t, 'the step still works');
  }
  console.log(`export-sim-801-live (${D}): ok`);
} finally { await t.close(); }
