// tests/cut-band-857-live.test.js — TASK 857: 2D cut band (Prepare open op, Export Paths selected op) + 2D Simulate dimmer bit-wide trail in the real Shaper page (desktop 1280 x 800 mouse; `phone` = 390 x 844 touch).
// Screenshots copied to .evidence/857/ for visual verification.
import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs';
import { openPocketPage } from './helpers/pocket-live.js';
import { openOpLive, okLive, previewLive } from './helpers/prepare-open-live.js';
import { sleep } from './helpers/cdp-browser.js';

const phone = process.argv.includes('phone');
const D = phone ? 'phone' : 'desktop';
const t = await openPocketPage({ tag: phone ? '857-phone' : '857', phone, evidenceDir: path.resolve('.evidence/857') });
if (!t) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
const { evalJs, waitFor, clickEl, openMode, setUnit, shot, shotWorld, send } = t;
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
    poly('P', [[0, 0], [115, 0], [115, 80], [0, 80]]);    // Outside plate
    circ('H', 30, 40, 16);                               // Inside hole inside plate
    poly('F', [[62, 16], [102, 16], [102, 64], [62, 64]]); // Freehand pocket
    poly('R', [[135, 0], [225, 0], [225, 80], [135, 80]]); // Programmed Raster pocket
    poly('O', [[245, 10], [295, 10], [295, 70], [245, 70]]); // On-line
    st.saveState('857 drawing');
    const lf = await import('/packages/core/loop-finder.js');
    const cp = await import('/tests/helpers/plan-v2.js');
    cp.V2_PLAN.clear();
    const loopOf = (p) => lf.findLoops(st).find((l) => l.edges.every((e) => e.startsWith(p)));
    const B = { cutOffset: 0, toolDia: 6.35, cutterShape: 'endmill' };
    cp.V2_PLAN.use(st).load([
      ['loop:' + loopOf('P').id, { ...B, cutType: 'exterior', cutDepth: 12 }],
      ['loop:' + loopOf('H').id, { ...B, cutType: 'interior', cutDepth: 12 }],
      ['loop:' + loopOf('F').id, { ...B, cutType: 'pocket', cutDepth: 5, clearing: 'freehand' }],
      ['loop:' + loopOf('R').id, { ...B, cutType: 'pocket', cutDepth: 5, clearing: 'raster', stepover: 40, finishAllowance: 0.5, rasterAngle: 0 }],
      ['loop:' + loopOf('O').id, { ...B, cutType: 'online', cutDepth: 3 }],
    ]);
  })()`);

  await openMode('prepare');
  await waitFor(`!document.getElementById('view-prepare').hidden`, 'Prepare view shown');
  await waitFor(`import('/apps/shaper/src/op-paths.js').then((m) => m.generatingCount() === 0)`, 'Prepare paths generated', 60000);

  const ops = await evalJs(`import('/apps/shaper/src/operations-store.js').then((m) => m.storeOps().map((o) => ({ id: o.id, type: o.type, clearing: o.settings && o.settings.clearing })))`);
  const outOp = ops.find((o) => o.type === 'exterior');
  const inOp = ops.find((o) => o.type === 'interior');
  const freeOp = ops.find((o) => o.type === 'pocket' && o.clearing === 'freehand');
  const rasterOp = ops.find((o) => o.type === 'pocket' && o.clearing !== 'freehand');
  ok(outOp && inOp && freeOp && rasterOp, 'all 4 ops found in Prepare');

  // Verify idle / no open op has 0 .sk-cutband
  ok((await evalJs(`document.querySelectorAll('#prepare-cut-group .sk-cutband').length`)) === 0, 'no open op: 0 .sk-cutband');

  const rawT = { evalJs, waitFor, clickEl: t.clickElRaw }; // the page's own clicks (no OK in between: okLive below, while the list's sheet is folded)
  // TASK 817: an operation just opened draws its paths as they were, FAINT, until its Preview: its band is faint with them; after the Preview, drawn as current
  const openWithPreview = async (id, what) => {
    await okLive(rawT);
    await openOpLive(rawT, id);
    const faint = await evalJs(`(() => { const g = document.querySelector('#prepare-cut-group .sk-cutband'); return { band: !!g && !!g.closest('.sk-faint'), paths: !!document.querySelector('#prepare-toolpath-group .sk-faint') }; })()`);
    ok(faint.band === faint.paths, `${what} just opened: the band is faint exactly when its paths are (${JSON.stringify(faint)})`);
    await previewLive(rawT, `${what}'s preview`);
    ok(!(await evalJs(`!!document.querySelector('#prepare-cut-group .sk-cutband').closest('.sk-faint')`)), `${what} after its Preview: the band is drawn as current`);
  };
  const inspectPrepareBand = () => evalJs(`(() => {
    const gs = [...document.querySelectorAll('#prepare-cut-group .sk-cutband')];
    if (!gs.length) return { groups: 0 };
    const g = gs[0], cs = getComputedStyle(g);
    const strokes = [...g.querySelectorAll('.sk-cutband-stroke')];
    const fills = [...g.querySelectorAll('.sk-cutband-fill')];
    return {
      groups: gs.length,
      opId: g.getAttribute('data-op'),
      opacity: parseFloat(cs.opacity),
      color: cs.color,
      strokes: strokes.length,
      strokeWidth: strokes[0] ? strokes[0].getAttribute('stroke-width') : null,
      vectorEffect: strokes[0] ? getComputedStyle(strokes[0]).vectorEffect : null,
      fills: fills.length,
    };
  })()`);

  // 1. Open Outside
  await openWithPreview(outOp.id, 'Outside');
  let pb = await inspectPrepareBand();
  console.log(D, 'Prepare Outside band', JSON.stringify(pb));
  ok(pb.groups === 1 && pb.opId === outOp.id && pb.color === 'rgb(225, 29, 72)' && pb.opacity > 0 && pb.opacity < 0.5 && pb.strokes === 1 && pb.strokeWidth === '6.35' && pb.vectorEffect === 'none', `Prepare Outside cut band: ${JSON.stringify(pb)}`);
  await shotWorld(`prepare-outside-${D}.png`, [-10, -10, 125, 90]);

  // 2. Open Inside circle
  await openWithPreview(inOp.id, 'Inside');
  pb = await inspectPrepareBand();
  console.log(D, 'Prepare Inside band', JSON.stringify(pb));
  ok(pb.groups === 1 && pb.opId === inOp.id && pb.color === 'rgb(234, 88, 12)' && pb.strokes === 1 && pb.strokeWidth === '6.35', `Prepare Inside cut band: ${JSON.stringify(pb)}`);
  await shotWorld(`prepare-inside-${D}.png`, [5, 15, 55, 65]);

  // 3. Open Freehand Pocket
  await openWithPreview(freeOp.id, 'Freehand Pocket');
  pb = await inspectPrepareBand();
  console.log(D, 'Prepare Freehand Pocket band', JSON.stringify(pb));
  ok(pb.groups === 1 && pb.opId === freeOp.id && pb.color === 'rgb(22, 163, 74)' && pb.fills >= 1 && pb.strokes === 0, `Prepare Freehand Pocket cut band: ${JSON.stringify(pb)}`);
  await shotWorld(`prepare-freehand-pocket-${D}.png`, [52, 8, 112, 72]);

  // 4. Open Programmed Raster Pocket (all overlapping passes in ONE union group)
  await openWithPreview(rasterOp.id, 'Raster Pocket');
  pb = await inspectPrepareBand();
  console.log(D, 'Prepare Raster Pocket band', JSON.stringify(pb));
  ok(pb.groups === 1 && pb.opId === rasterOp.id && pb.color === 'rgb(22, 163, 74)' && pb.strokes >= 2 && pb.strokeWidth === '6.35', `Prepare Raster Pocket cut band: ${JSON.stringify(pb)}`);
  await shotWorld(`prepare-raster-pocket-${D}.png`, [125, -10, 235, 90]);

  await okLive(rawT);

  // ── 5. Export Paths ──
  await openMode('review');
  await waitFor(`!document.getElementById('view-review').hidden`, 'Review stage shown', 60000);
  if (await evalJs(`document.getElementById('review-view-paths').getAttribute('aria-pressed')`) !== 'true') await clickEl('#review-view-paths');
  await waitFor(`document.querySelectorAll('#review-2d-canvas .rv2d-path').length > 0`, 'Export Paths view ready', 60000);
  await sleep(400);

  const inspectPathsBand = () => evalJs(`(() => {
    const g = document.querySelector('#review-2d-canvas .rv2d-cutband');
    if (!g) return null;
    const cs = getComputedStyle(g);
    const strokes = [...g.querySelectorAll('.rv2d-cutband-stroke')];
    const fills = [...g.querySelectorAll('.rv2d-cutband-fill')];
    const top = document.querySelector('#review-2d-canvas > g');
    const docLayer = top && top.querySelector('.rv2d-doc');
    const children = top ? [...top.children] : [];
    return {
      underLines: docLayer ? children.indexOf(g) < children.indexOf(docLayer) : false,
      opId: g.getAttribute('data-op'),
      opacity: parseFloat(cs.opacity),
      color: cs.color,
      strokes: strokes.length,
      strokeWidth: strokes[0] ? strokes[0].getAttribute('stroke-width') : null,
      vectorEffect: strokes[0] ? getComputedStyle(strokes[0]).vectorEffect : null,
      fills: fills.length,
    };
  })()`);

  // a legible screenshot of the world box b = [x0, y0, x1, y1] on the Export step's view: zoomed onto it (the view's own wheel zoom at its centre), then Fit again
  const shotReview = async (name, b) => {
    const boxOnScreen = () => evalJs(`(() => { const s = document.getElementById('review-2d-canvas'), m = s.getScreenCTM(), c = s.getBoundingClientRect();
      const p = (x, y) => { const q = s.createSVGPoint(); q.x = x; q.y = y; return q.matrixTransform(m); }, a = p(${b[0]}, ${b[1]}), z = p(${b[2]}, ${b[3]});
      return { x: Math.min(a.x, z.x), y: Math.min(a.y, z.y), w: Math.abs(z.x - a.x), h: Math.abs(z.y - a.y), cw: c.width, ch: c.height }; })()`);
    for (let i = 0; i < 20; i++) {
      const r = await boxOnScreen();
      if (r.w >= r.cw * 0.7 || r.h >= r.ch * 0.55) break;
      await evalJs(`document.getElementById('review-2d-canvas').dispatchEvent(new WheelEvent('wheel', { clientX: ${r.x + r.w / 2}, clientY: ${r.y + r.h / 2}, deltaY: -120, bubbles: true, cancelable: true }))`);
      await sleep(60);
    }
    const r = await boxOnScreen();
    const clip = { x: Math.max(0, r.x - 12), y: Math.max(0, r.y - 12), width: r.w + 24, height: r.h + 24, scale: 2 };
    const { data } = await send('Page.captureScreenshot', { format: 'png', clip });
    fs.writeFileSync(path.join(t.EVIDENCE_DIR, name), Buffer.from(data, 'base64'));
    console.log('screenshot ' + path.join(t.EVIDENCE_DIR, name));
    await clickEl('#review-fit');
    await sleep(150);
  };

  // Nothing selected yet -> 0 band children
  let eb = await inspectPathsBand();
  ok(eb && eb.underLines && !eb.opId && eb.strokes === 0 && eb.fills === 0, `Export Paths initial: no selection band: ${JSON.stringify(eb)}`);

  // Pick Raster Pocket header -> shows cut band for ONLY Raster Pocket under lines
  await clickEl(`#review-cuts-list .rv2d-op[data-op="${rasterOp.id}"]`);
  await sleep(200);
  eb = await inspectPathsBand();
  console.log(D, 'Export Paths Raster band', JSON.stringify(eb));
  ok(eb.underLines && eb.opId === rasterOp.id && eb.color === 'rgb(22, 163, 74)' && eb.opacity > 0 && eb.opacity < 0.5 && eb.strokes >= 2 && eb.strokeWidth === '6.35' && eb.vectorEffect === 'none', `Export Paths Raster cut band: ${JSON.stringify(eb)}`);

  // Pick the Outside's row -> its band only (the bit path +- r round the plate)
  await clickEl(`#review-cuts-list .rv2d-op[data-op="${outOp.id}"]`);
  await sleep(200);
  eb = await inspectPathsBand();
  console.log(D, 'Export Paths Outside band', JSON.stringify(eb));
  ok(eb.underLines && eb.opId === outOp.id && eb.color === 'rgb(225, 29, 72)' && eb.strokes === 1 && eb.strokeWidth === '6.35', `Export Paths Outside cut band: ${JSON.stringify(eb)}`);
  await shotReview(`export-paths-selected-${D}.png`, [-10, -10, 125, 90]);

  // Pick Freehand Pocket header -> light fill of area cleared
  await clickEl(`#review-cuts-list .rv2d-op[data-op="${freeOp.id}"]`);
  await sleep(200);
  eb = await inspectPathsBand();
  console.log(D, 'Export Paths Freehand Pocket band', JSON.stringify(eb));
  ok(eb.underLines && eb.opId === freeOp.id && eb.color === 'rgb(22, 163, 74)' && eb.fills >= 1 && eb.strokes === 0, `Export Paths Freehand cut band: ${JSON.stringify(eb)}`);
  await shotReview(`export-paths-freehand-${D}.png`, [52, 8, 112, 72]);

  // Clear canvas pick before simulation test so sim-2d-mid clearly shows the dimmer sim band alone
  {
    const pt = await evalJs(`(() => { const s = document.getElementById('review-2d-canvas'), p = s.createSVGPoint(); p.x = 125; p.y = -40; const q = p.matrixTransform(s.getScreenCTM()); return { x: Math.round(q.x), y: Math.round(q.y) }; })()`);
    await t.press(pt.x, pt.y);
    await waitFor(`document.querySelectorAll('#review-2d-canvas .rv2d-cutband *').length === 0`, 'cut band cleared on empty tap');
  }

  // ── 6. 2D Simulate dimmer trail + scrub back ──
  await clickEl('#review-sim-toggle');
  await waitFor(`!document.getElementById('review-sim').hidden`, 'Simulate panel opened');
  await waitFor(`!document.getElementById('sim-preview-all').disabled`, 'Simulate ready');
  if (await evalJs(`!document.getElementById('sim-animate').checked`)) await clickEl('#sim-animate');
  await clickEl('#sim-preview-all');
  await sleep(300);
  if (await evalJs(`import('/apps/shaper/src/main.js').then((m) => m.currentExportSim().inspect().playing)`)) await clickEl('#sim-play');

  const scrubFraction = async (f) => {
    await evalJs(`(() => { const e = document.getElementById('sim-scrub'); e.value = String(Math.round(${f} * 1000)); e.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await sleep(150);
  };
  const inspectSimBand = () => evalJs(`(() => {
    const bands = document.querySelector('#review-2d-canvas .rv2d-sim-bands');
    const simLayer = document.querySelector('#review-2d-canvas .rv2d-sim');
    const docLayer = document.querySelector('#review-2d-canvas .rv2d-doc');
    const top = document.querySelector('#review-2d-canvas > g');
    const children = top ? [...top.children] : [];
    const groups = bands ? [...bands.querySelectorAll('.rv2d-sim-band')] : [];
    const strokes = bands ? [...bands.querySelectorAll('.rv2d-sim-band-stroke')] : [];
    const gs = groups[0] ? getComputedStyle(groups[0]) : null;
    const ss = strokes[0] ? getComputedStyle(strokes[0]) : null;
    return {
      underLinesAndTrail: !!bands && !!docLayer && (!simLayer || children.indexOf(bands) < children.indexOf(simLayer)) && children.indexOf(bands) < children.indexOf(docLayer),
      groups: groups.length,
      strokes: strokes.length,
      opacity: gs ? parseFloat(gs.opacity) : null,
      strokeWidth: strokes[0] ? strokes[0].getAttribute('stroke-width') : null,
      vectorEffect: ss ? ss.vectorEffect : null,
      hasTrail: !!document.querySelector('#review-2d-canvas .rv2d-sim-trail'),
    };
  })()`);

  await scrubFraction(0.6);
  const simMid = await inspectSimBand();
  console.log(D, '2D Sim mid', JSON.stringify(simMid));
  ok(simMid.underLinesAndTrail && simMid.groups >= 1 && simMid.strokes >= 2 && simMid.opacity > 0 && simMid.opacity < eb.opacity && simMid.strokeWidth === '6.35' && simMid.vectorEffect === 'none',
    `2D Simulate mid-run shows dimmer bit-wide trail (${JSON.stringify(simMid)} vs active band opacity ${eb.opacity})`);
  // PLAYING: the trail grows behind the bit (only the new steps are added), then paused mid-run for the screenshot
  await clickEl('#sim-play');
  await sleep(900);
  if (await evalJs(`import('/apps/shaper/src/main.js').then((m) => m.currentExportSim().inspect().playing)`)) await clickEl('#sim-play');
  const simPlayed = await inspectSimBand();
  console.log(D, '2D Sim after playing', JSON.stringify(simPlayed));
  ok(simPlayed.strokes >= simMid.strokes, `playing on keeps the trail and adds to it (${simMid.strokes} -> ${simPlayed.strokes})`);
  await clickEl('#review-sim-toggle'); // the panel folded: the canvas free for the screenshot
  await shotReview(`sim-2d-mid-${D}.png`, [125, -10, 235, 90]);
  await clickEl('#review-sim-toggle');

  await scrubFraction(0.05);
  const simBack = await inspectSimBand();
  ok(simBack.strokes < simMid.strokes, `scrubbing back reduces sim band (${simMid.strokes} -> ${simBack.strokes})`);
  await scrubFraction(0);
  const simZero = await inspectSimBand();
  ok(simZero.strokes === 0, `scrubbing back to 0 removes sim trail (${simZero.strokes})`);

  // the Simulate's operation pick is the Paths view's selected operation: its cut band
  await evalJs(`(() => { const s = document.getElementById('sim-op'); s.value = ${JSON.stringify(inOp.id)}; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await sleep(150);
  eb = await inspectPathsBand();
  console.log(D, 'Simulate pick Inside -> Paths band', JSON.stringify(eb));
  ok(eb.opId === inOp.id && eb.color === 'rgb(234, 88, 12)' && eb.strokes === 1, `the Simulate pick shows its cut band: ${JSON.stringify(eb)}`);

  console.log(`cut-band-857-live (${D}): ok`);
} finally {
  await t.close();
}
