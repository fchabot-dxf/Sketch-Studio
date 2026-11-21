// tests/export-sim-801d-live.test.js — TASK 801d: a FREEHAND pocket plays an example of hand moves in the Export simulation, in the real Shaper page (desktop 1280 x 800
// mouse; `phone` = 390 x 844 touch). A plate (Outside) with a freehand pocket with an island; Preview selected (the pocket) at 1x:
//   Paths  the scribble is drawn as it plays in its own style (.rv2d-sim-scribble: dashed, the pocket's colour), the bit on it, the label "... Pocket (freehand: your own
//          moves, shown as an example)"; then the wall pass (the plain label);
//   3D     the pocket's floor is carved along the scribble as it plays (the wood rebuilt before the pocket's end; that the end is the finished part: the node test).
// Screenshots (mid-play, Paths and 3D): .evidence/801/scribble-paths-<n>-<desktop|phone>.png, scribble-3d-<n>-<desktop|phone>.png.
import assert from 'node:assert';
import path from 'node:path';
import { openPocketPage } from './helpers/pocket-live.js';
import { sleep } from './helpers/cdp-browser.js';

const phone = process.argv.includes('phone');
const D = phone ? 'phone' : 'desktop';
const t = await openPocketPage({ tag: phone ? '801d-phone' : '801d', phone, evidenceDir: path.resolve('.evidence/801'), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
if (!t) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
const { evalJs, waitFor, clickEl, openMode, setUnit } = t;
const ok = (c, m) => { assert.ok(c, `${D}: ${m}`); };
const sim = () => evalJs(`import('/apps/shaper/src/main.js').then((m) => m.currentExportSim().inspect())`);
const view3d = () => evalJs(`import('/apps/shaper/src/main.js').then((m) => m.currentReviewView() && m.currentReviewView().inspect().sim)`);
const label = () => evalJs(`document.getElementById('sim-label').textContent`);
const stageSel = phone ? null : '#review-stage';
try {
  await setUnit('mm');
  await openMode('design');
  await waitFor('!!(window.__designController && window.__designController.state)', 'design controller ready');
  await evalJs(`(async () => {
    const st = window.__designController.state;
    for (const k of [...st.joints.keys()]) st.joints.delete(k);
    st.shapes.length = 0; st.constraints.length = 0; st.profiles.length = 0;
    const poly = (n, pts) => { pts.forEach(([x, y], i) => st.joints.set(n + 'j' + i, { x, y })); pts.forEach((_, i) => st.shapes.push({ id: n + 's' + i, type: 'line', joints: [n + 'j' + i, n + 'j' + ((i + 1) % pts.length)] })); };
    poly('A', [[0, 0], [220, 0], [220, 140], [0, 140]]);
    poly('P', [[30, 25], [190, 25], [190, 115], [30, 115]]);
    poly('I', [[95, 55], [125, 55], [125, 85], [95, 85]]);
    st.saveState('801d drawing');
    const lf = await import('/packages/core/loop-finder.js');
    const cp = await import('/tests/helpers/plan-v2.js');
    cp.V2_PLAN.clear();
    const loopOf = (p) => lf.findLoops(st).find((l) => l.edges.every((e) => e.startsWith(p)));
    const B = { cutOffset: 0, toolDia: 6.35, cutterShape: 'endmill' };
    cp.V2_PLAN.use(st).load([['loop:' + loopOf('P').id, { ...B, cutType: 'pocket', cutDepth: 5 }], ['loop:' + loopOf('A').id, { ...B, cutType: 'exterior', cutDepth: 18 }]]);
  })()`);
  await evalJs(`localStorage.setItem('shaper-review-view', 'paths')`);
  await openMode('review');
  await waitFor(`!document.getElementById('sim-preview-sel').disabled && document.getElementById('sim-op').options.length === 2`, 'the Simulate panel is ready', 60000);
  await clickEl('#review-sim-toggle'); await waitFor(`!document.getElementById('review-sim').hidden`, 'the panel opens');
  const pocket = (await sim()).ops.find((o) => /Pocket/.test(o.text));
  ok(pocket, 'the freehand pocket is an operation of the timeline');
  await evalJs(`(() => { const s = document.getElementById('sim-op'); s.value = ${JSON.stringify(pocket.id)}; s.dispatchEvent(new Event('change')); const v = document.getElementById('sim-speed'); v.value = '1'; v.dispatchEvent(new Event('change')); })()`);

  // Paths: the scribble plays first, in its own style
  if (await evalJs(`document.getElementById('review-view-paths').getAttribute('aria-pressed')`) !== 'true') await clickEl('#review-view-paths');
  await waitFor(`document.querySelectorAll('#review-2d-canvas .rv2d-path').length > 0`, 'the Paths view');
  await clickEl('#sim-preview-sel');
  await sleep(1500);
  const l1 = await label();
  ok(/^Operation \d of 2 · Pocket \(freehand: your own moves, shown as an example\)$/.test(l1), `the label says the hand moves are an example: "${l1}"`);
  const f = await evalJs(`(() => { const sc = [...document.querySelectorAll('#review-2d-canvas .rv2d-sim-scribble')]; const cs = sc[0] && getComputedStyle(sc[0]);
    return { n: sc.length, dash: cs && cs.strokeDasharray, stroke: cs && cs.stroke, bit: !!document.querySelector('#review-2d-canvas .rv2d-sim-bit'), trail: !!document.querySelector('#review-2d-canvas .rv2d-sim-trail') }; })()`);
  console.log(D, 'scribble', JSON.stringify(f));
  ok(f.n >= 1 && f.dash && f.dash !== 'none' && /127, 127, 127/.test(f.stroke) && f.bit && !f.trail, 'the scribble drawn dashed in the pocket\'s colour, the bit on it (no solid trail: it is not a real path)');
  for (let i = 1; i <= 2; i++) { await t.shot(`scribble-paths-${i}-${D}.png`, stageSel, 1); await sleep(1000); }
  const f2 = await evalJs(`[...document.querySelectorAll('#review-2d-canvas .rv2d-sim-scribble')].reduce((n, e) => n + e.getAttribute('d').length, 0)`);
  ok(f2 > 0, 'it grows as it plays');
  // to the wall pass: the plain label
  if ((await sim()).playing) await clickEl('#sim-play'); // pause
  await evalJs(`(() => { const e = document.getElementById('sim-scrub'); e.value = '995'; e.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await sleep(300);
  ok(/^Operation \d of 2 · Pocket$/.test(await label()), `near its end (the wall pass): the plain label: "${await label()}"`);

  // 3D: the floor carved along the scribble
  await clickEl('#review-view-3d');
  await waitFor(`import('/apps/shaper/src/main.js').then((m) => !!(m.currentReviewView() && m.currentReviewView().lastBuild))`, 'the 3D view', 60000);
  await evalJs(`(() => { const e = document.getElementById('sim-scrub'); e.value = '0'; e.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await sleep(500);
  const w0 = await view3d();
  await clickEl('#sim-play');
  await sleep(2500);
  const w1 = await view3d(); const s2 = await sim();
  await t.shot(`scribble-3d-1-${D}.png`, stageSel, 1);
  await sleep(1500);
  await t.shot(`scribble-3d-2-${D}.png`, stageSel, 1);
  const w2 = await view3d(); const s3 = await sim();
  console.log(D, '3D', JSON.stringify({ w0: w0.key, w1: w1.key, w2: w2.key, label: s2.label, t: [s2.t, s3.t], total: s3.total }));
  ok(/freehand: your own moves/.test(s2.label) && w1.key !== w0.key && w2.key !== w1.key, 'while the scribble plays, the 3D wood is carved along it (rebuilt as it goes)');
  if ((await sim()).playing) await clickEl('#sim-play');
  console.log(`export-sim-801d-live (${D}): ok`);
} finally { await t.close(); }
