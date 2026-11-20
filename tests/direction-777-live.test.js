// tests/direction-777-live.test.js — TASK 777: clearer cutting direction marks in Shaper Prepare (DESKTOP 1280x800).
// Checks:
//  1. Every determined toolpath kind carries sparse slow dashes (8px 28px, 5s = 7.2 px/s) + always-visible dart arrowheads:
//     Outside, Inside, Raster pocket (passes + cleanup + wall), Spiral pocket (linked + wall), Pocket Loop + Lead-in,
//     On-line Lead-in (leg + outline), On-line Tabs (3 strokes). Plain On-line (no lead-in/tabs) keeps static .sk-tp-online.
//  2. Selected / hovered ONLY: unselected cuts carry no travel marks; deselecting clears all .sk-travel / .sk-travel-arrows.
//  3. Open-path AutoPass note on Loop-off programmed clearing; no duplication where 775 LEAD_IN_TRADE_OFF already appears.
//  4. 4 frames 1 s apart showing slow forward motion (~7.2 px/s) saved to .evidence/777/motion-frame-{0..3}.png.
//  5. prefers-reduced-motion: reduce -> animationName 'none', static dashes + visible arrowheads.
//  6. Pan smoothness measured on a 50+ ring Spiral AND a dense (~60 pass) Raster pocket.
//  7. Zoomed screenshots (raster pocket, spiral pocket, lead-in, tabs, reduced motion) saved to .evidence/777/.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';
import { resetBufferLive } from './helpers/reset-buffer.js';

const EVIDENCE_DIR = process.env.EVIDENCE_DIR || path.resolve('.evidence/777');
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

const cdp = await launchBrowser({ tag: '777-desktop', width: 1280, height: 800 });
if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
const { port, send, evalJs, waitFor, navigate, close } = cdp;

try {
  const shot = async (name, clip = null) => {
    const { data } = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip } : {}) });
    const file = path.join(EVIDENCE_DIR, name);
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
    console.log('screenshot ' + file);
  };
  const canvasClip = () => evalJs(`(() => { const r = document.getElementById('prepare-canvas').getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width - 220, height: r.height, scale: 1 }; })()`);
  const press = async (x, y) => {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', clickCount: 0 });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
    await sleep(35);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
    await sleep(160);
  };
  const move = async (x, y) => {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', clickCount: 0 });
    await sleep(140);
  };
  const toScreen = (x, y) => evalJs(`(() => { const s = document.getElementById('prepare-canvas'); const p = s.createSVGPoint(); p.x = ${x}; p.y = ${y}; const q = p.matrixTransform(s.getScreenCTM()); return { x: Math.round(q.x), y: Math.round(q.y) }; })()`);
  const clickWorld = async (x, y) => { const p = await toScreen(x, y); await press(p.x, p.y); };

  await resetBufferLive(cdp);
  await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html?analytics=off`, 10000);
  await waitFor(`!!document.querySelector('.sk-header-tab[data-tab="design"]')`, 'shaper ready');
  await evalJs(`import('/packages/core/settings-manager.js').then((m) => m.default.set('DOC_UNIT', 'mm'))`);

  // Seed 8 distinct rectangles in Design, each with a different cut kind
  await evalJs(`(async () => {
    const { findLoops } = await import('/packages/core/loop-finder.js');
    const { V2_PLAN, keyOf } = await import('/tests/helpers/plan-v2.js');
    const st = window.__designController.state;
    for (const k of [...st.joints.keys()]) if (k !== 'j_origin') st.joints.delete(k);
    st.shapes.length = 0; st.constraints.length = 0; V2_PLAN.clear();
    let n = 0;
    const J = (x, y) => { const id = 'dj' + (++n); st.joints.set(id, { x, y }); return id; };
    const line = (a, b) => { const id = 'ds' + (++n); st.shapes.push({ id, type: 'line', joints: [a, b] }); return id; };
    const rect = (x, y, w, h) => { const p = [J(x, y), J(x + w, y), J(x + w, y + h), J(x, y + h)]; return [0, 1, 2, 3].map((i) => line(p[i], p[(i + 1) % 4]))[0]; };
    const eOut = rect(0, 0, 50, 40);
    const eIn = rect(70, 0, 50, 40);
    const eRast = rect(140, 0, 60, 45);
    const eSpir = rect(220, 0, 60, 45);
    const eLoopLead = rect(0, 70, 60, 45);
    const eLeadIn = rect(80, 70, 50, 40);
    const eTabs = rect(150, 70, 60, 45);
    const ePlainOnline = rect(230, 70, 50, 40);
    st.saveState('seed777');
    const loops = findLoops(st);
    const kOf = (edge) => keyOf('loop', loops.find((l) => l.edges.includes(edge)).id);
    const base = { cutDepth: 8, cutOffset: 0, toolDia: 6, cutterShape: 'endmill', cutterAngle: 90 };
    V2_PLAN.set(kOf(eOut), { ...base, cutType: 'exterior' });
    V2_PLAN.set(kOf(eIn), { ...base, cutType: 'interior' });
    V2_PLAN.set(kOf(eRast), { ...base, cutType: 'pocket', clearing: 'raster', stepover: 50, finishAllowance: 0.5, rasterAngle: 0, loop: false });
    V2_PLAN.set(kOf(eSpir), { ...base, cutType: 'pocket', clearing: 'linked', stepover: 50, finishAllowance: 0.5, loop: false });
    V2_PLAN.set(kOf(eLoopLead), { ...base, cutType: 'pocket', clearing: 'linked', stepover: 50, finishAllowance: 0.5, loop: true, leadIn: true, leadInLength: 8 });
    V2_PLAN.set(kOf(eLeadIn), { ...base, cutType: 'online', toolDia: 3.175, leadIn: true, leadInLength: 8, leadInSide: 'outside' });
    V2_PLAN.set(kOf(eTabs), { ...base, cutType: 'online', toolDia: 3.175, holdPart: 'tabs', tabCount: 3, tabWidth: 10 });
    V2_PLAN.set(kOf(ePlainOnline), { ...base, cutType: 'online', toolDia: 3.175 });
  })()`);

  await evalJs(`document.querySelector('.sk-header-tab[data-tab="prepare"]').click()`);
  await waitFor(`!!document.querySelector('#prepare-canvas .sk-edge') && !!document.getElementById('prepare-canvas').getScreenCTM()`, 'prepare ready');
  await evalJs(`window.__prepareView.setView({ x: 140, y: 60, w: 340 })`);
  await sleep(150);

  // Move cursor outside #prepare-canvas so hover clears (hovered = null) when checking selected-only marks
  const away = { x: 2, y: 2 };
  const inspect = () => evalJs(`(() => {
    const q = (s) => document.querySelectorAll('#prepare-canvas ' + s).length;
    const t = document.querySelector('#prepare-canvas .sk-travel');
    const a = document.querySelector('#prepare-canvas .sk-travel-arrows');
    const csT = t ? getComputedStyle(t) : null;
    const csA = a ? getComputedStyle(a) : null;
    const note = [...document.querySelectorAll('#prepare-panel .cut-note > div')].map((d) => d.textContent.trim());
    return {
      travel: q('.sk-travel'),
      travelClear: q('.sk-travel-clear'),
      travelOnline: q('.sk-travel-online'),
      travelLead: q('.sk-travel-lead'),
      arrows: q('.sk-travel-arrows'),
      arrowBBox: a ? { w: Math.round(a.getBBox().width * 10) / 10, h: Math.round(a.getBBox().height * 10) / 10 } : null,
      tpOnline: q('.sk-tp-online'),
      dasharray: csT && csT.strokeDasharray,
      anim: csT && csT.animationName,
      dur: csT && csT.animationDuration,
      arrowDisplay: csA && csA.display,
      legendVisible: !document.getElementById('prepare-dir-legend').hidden,
      note,
      overflowX: document.documentElement.scrollWidth - innerWidth,
    };
  })()`);

  // ── 2. Unselected / idle: zero travel marks ──
  await move(away.x, away.y);
  const idle = await inspect();
  assert.strictEqual(idle.travel, 0, 'idle: 0 travel paths');
  assert.strictEqual(idle.arrows, 0, 'idle: 0 arrow paths');
  assert.strictEqual(idle.legendVisible, false, 'idle: legend hidden');
  assert.ok(idle.overflowX <= 0, 'idle: no sideways overflow');

  const setZoom = (x, y, w) => evalJs(`(() => { const s = document.getElementById('prepare-canvas'), r = s.getBoundingClientRect(); window.__prepareView.setView({ x: ${x}, y: ${y}, w: ${w}, h: ${w} * r.height / r.width }); })()`);

  // ── 1. Check every cut kind by selecting it (only selected cut carries marks) ──
  // Center each cut in the open canvas (between #prepare-ops on the left and #prepare-panel on the right) before clicking it.
  // Outside
  await setZoom(25, 20, 120); await sleep(100);
  await clickWorld(25, 20); await move(away.x, away.y);
  const sOut = await inspect();
  assert.strictEqual(sOut.travel, 1, 'outside: 1 travel path (none on unselected cuts)');
  assert.strictEqual(sOut.arrows, 1, 'outside: 1 arrow layer path');
  assert.strictEqual(sOut.dasharray, '8px, 28px', 'sparse dash pattern 8px 28px');
  assert.strictEqual(sOut.anim, 'sk-march', 'marching animation active');
  assert.strictEqual(sOut.dur, '5s', 'slow 5s period (7.2 px/s)');
  assert.ok(sOut.arrowDisplay !== 'none' && sOut.arrowBBox.w > 0, 'arrowheads visible');
  assert.strictEqual(sOut.legendVisible, true, 'legend visible');

  // Inside
  await setZoom(95, 20, 120); await sleep(100);
  await clickWorld(95, 20); await move(away.x, away.y);
  const sIn = await inspect();
  assert.strictEqual(sIn.travel, 1, 'inside: 1 travel path');
  assert.strictEqual(sIn.arrows, 1, 'inside: 1 arrow layer path');

  // Raster pocket (Loop off) — zoomed screenshot
  await setZoom(170, 22.5, 110); await sleep(120);
  await clickWorld(170, 22.5); await move(away.x, away.y);
  const sRast = await inspect();
  assert.ok(sRast.travelClear >= 10 && sRast.travel === sRast.travelClear + 1, 'raster pocket: clearing passes + cleanup + finish wall all marked: ' + JSON.stringify(sRast));
  assert.ok(sRast.arrows >= 2, 'raster pocket: clearing + wall arrowheads visible');
  assert.ok(sRast.note.includes('AutoPass runs back along it on the next pass'), 'raster Loop off: AutoPass reverse line in card note');
  await shot('desktop-raster-pocket.png', await canvasClip());

  // Spiral pocket (Loop off) — zoomed screenshot
  await setZoom(250, 22.5, 110); await sleep(120);
  await clickWorld(250, 22.5); await move(away.x, away.y);
  const sSpir = await inspect();
  assert.strictEqual(sSpir.travelClear, 1, 'spiral pocket: 1 linked clearing travel path');
  assert.strictEqual(sSpir.travel, 2, 'spiral pocket: clearing + finish wall');
  assert.ok(sSpir.note.includes('AutoPass runs back along it on the next pass'), 'spiral Loop off: AutoPass reverse line in card note');
  await shot('desktop-spiral-pocket.png', await canvasClip());

  // Pocket Loop ON (TASK 778: pocket lead-in removed; closed loop travel + start mark, no open-path AutoPass line)
  await setZoom(30, 92.5, 110); await sleep(120);
  await clickWorld(30, 92.5); await move(away.x, away.y);
  const sLoopLead = await inspect();
  assert.strictEqual(sLoopLead.travelLead, 0, 'pocket Loop ON: no pocket lead-in leg travel (TASK 778)');
  assert.strictEqual(sLoopLead.travelClear, 1, 'pocket Loop ON: 1 closed loop travel');
  assert.ok(!sLoopLead.note.includes('AutoPass runs back along it on the next pass'), 'pocket Loop ON: closed loop has no open-path AutoPass line');

  // On-line outline with Lead-in — zoomed screenshot (full leg tip + junction + outline in frame) + 4-frame motion sequence
  await setZoom(105, 86, 115); await sleep(120);
  await clickWorld(105, 90); await move(away.x, away.y);
  const sLead = await inspect();
  assert.strictEqual(sLead.travelLead, 1, 'on-line Lead-in: 1 leg travel');
  assert.strictEqual(sLead.travelOnline, 1, 'on-line Lead-in: 1 open outline travel');
  assert.strictEqual(sLead.arrows, 1, 'on-line Lead-in: arrowheads visible');
  assert.ok(!sLead.note.includes('AutoPass runs back along it on the next pass'), 'on-line Lead-in: no duplicate AutoPass line');
  await shot('desktop-leadin.png', await canvasClip());

  // ── 4. 4 frames 1 s apart showing slow motion (~7.2 px/s) ──
  const offsets = [];
  const clipLead = await canvasClip();
  for (let f = 0; f < 4; f++) {
    if (f > 0) await sleep(1000);
    const off = await evalJs(`parseFloat(getComputedStyle(document.querySelector('#prepare-canvas .sk-travel-online')).strokeDashoffset)`);
    offsets.push(Math.round(off * 100) / 100);
    await shot(`motion-frame-${f}.png`, clipLead);
  }
  console.log('4-frame dashoffsets (1 s apart, period -36 px):', offsets);
  // Check step delta modulo 36 px is roughly -7.2 px per second (allow timer/scheduling slack 3.5..12 px)
  for (let f = 1; f < 4; f++) {
    let delta = offsets[f] - offsets[f - 1];
    if (delta > 18) delta -= 36; // wrapped around -36 -> 0
    assert.ok(delta < -3.5 && delta > -12, `frame ${f - 1}->${f} moves forward slowly (${delta.toFixed(2)} px/s)`);
  }

  // On-line Tabs (3 strokes) — zoomed screenshot
  await setZoom(180, 92.5, 115); await sleep(120);
  await clickWorld(180, 92.5); await move(away.x, away.y);
  const sTabs = await inspect();
  assert.strictEqual(sTabs.travelOnline, 3, 'on-line Tabs: 3 tab strokes carry travel marks');
  assert.strictEqual(sTabs.arrows, 1, 'on-line Tabs: arrowheads visible on strokes');
  await shot('desktop-tabs.png', await canvasClip());

  // Plain On-line (no lead-in, no tabs): no travel marks (operator chooses on Origin)
  await setZoom(255, 90, 115); await sleep(120);
  await clickWorld(255, 90); await move(away.x, away.y);
  const sPlain = await inspect();
  assert.strictEqual(sPlain.travel, 0, 'plain On-line: 0 travel marks');
  assert.strictEqual(sPlain.arrows, 0, 'plain On-line: 0 arrow marks');

  // ── 5. prefers-reduced-motion: reduce -> still dashes + visible arrowheads ──
  await setZoom(170, 22.5, 110); await sleep(120);
  await clickWorld(170, 22.5); await move(away.x, away.y);
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await sleep(150);
  const sRed = await inspect();
  assert.strictEqual(sRed.anim, 'none', 'reduced motion: animation is none');
  assert.strictEqual(sRed.dasharray, '8px, 28px', 'reduced motion: dashes remain');
  assert.ok(sRed.arrows >= 2 && sRed.arrowDisplay !== 'none', 'reduced motion: arrowheads remain visible');
  await shot('desktop-reduced-motion.png', await canvasClip());
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });

  // Deselect clears all travel marks
  await evalJs(`window.__prepareView.setSelection([])`); await sleep(100);
  const cleared = await inspect();
  assert.strictEqual(cleared.travel, 0, 'deselected: 0 travel');
  assert.strictEqual(cleared.arrows, 0, 'deselected: 0 arrows');

  // ── 6. Pan frame-time benchmark on 50+ ring Spiral and dense (~60 pass) Raster ──
  await evalJs(`(async () => {
    const { findLoops } = await import('/packages/core/loop-finder.js');
    const { V2_PLAN, keyOf } = await import('/tests/helpers/plan-v2.js');
    const st = window.__designController.state;
    for (const k of [...st.joints.keys()]) if (k !== 'j_origin') st.joints.delete(k);
    st.shapes.length = 0; st.constraints.length = 0; V2_PLAN.clear();
    const J = (id, x, y) => { st.joints.set(id, { x, y }); return id; };
    const p = [J('a', 0, 0), J('b', 400, 0), J('c', 400, 400), J('d', 0, 400)];
    for (let i = 0; i < 4; i++) st.shapes.push({ id: 'bl' + i, type: 'line', joints: [p[i], p[(i + 1) % 4]] });
    st.saveState('bench777');
    const l = findLoops(st)[0];
    V2_PLAN.set(keyOf('loop', l.id), { cutType: 'pocket', cutDepth: 10, cutOffset: 0, toolDia: 6, clearing: 'linked', stepover: 60, finishAllowance: 0.5, loop: false });
  })()`);
  await evalJs(`document.querySelector('.sk-header-tab[data-tab="design"]').click()`); await sleep(120);
  await evalJs(`document.querySelector('.sk-header-tab[data-tab="prepare"]').click()`);
  await waitFor(`!!document.querySelector('#prepare-canvas .sk-edge')`, 'prepare bench ready');
  await evalJs(`(() => { const pv = window.__prepareView; pv.setView({ x: 200, y: 200, w: 500 }); pv.setSelection([pv.resolveTarget({ x: 200, y: 200 })]); })()`);
  await sleep(200);

  const measurePan = async (label) => {
    const meta = await evalJs(`(() => {
      const pv = window.__prepareView, s = pv.clearingSummaryFor(pv.selectedTarget());
      return { levels: s.levels, passes: s.passes, travels: document.querySelectorAll('#prepare-canvas .sk-travel').length, arrowNodes: document.querySelectorAll('#prepare-canvas .sk-travel-arrows').length };
    })()`);
    // Pan via real middle-button drag frames, measuring rAF frame intervals
    const stats = await evalJs(`new Promise((resolve) => {
      const svg = document.getElementById('prepare-canvas');
      const r = svg.getBoundingClientRect();
      const cx = r.left + r.width * 0.4, cy = r.top + r.height * 0.5;
      svg.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 1, buttons: 4, clientX: cx, clientY: cy, pointerId: 1, pointerType: 'mouse' }));
      const dts = []; let last = performance.now(), n = 0;
      const step = (now) => {
        if (n > 0) dts.push(now - last);
        last = now;
        svg.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, button: 1, buttons: 4, clientX: cx + n * 4, clientY: cy + n * 2, pointerId: 1, pointerType: 'mouse' }));
        if (++n <= 24) requestAnimationFrame(step);
        else {
          svg.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 1, buttons: 0, clientX: cx + n * 4, clientY: cy + n * 2, pointerId: 1, pointerType: 'mouse' }));
          dts.sort((a, b) => a - b);
          resolve({ avgMs: +(dts.reduce((a, b) => a + b, 0) / dts.length).toFixed(2), p95Ms: +dts[Math.floor(dts.length * 0.95)].toFixed(2), maxMs: +dts.at(-1).toFixed(2) });
        }
      };
      requestAnimationFrame(step);
    })`);
    console.log(`pan bench [${label}]:`, JSON.stringify({ ...meta, ...stats }));
    return { ...meta, ...stats };
  };

  const bSpir = await measurePan('50-ring Spiral');
  assert.ok(bSpir.levels >= 50, '50+ ring Spiral measured: ' + bSpir.levels);
  assert.ok(bSpir.arrowNodes <= 3, 'batched arrow DOM nodes on Spiral: ' + bSpir.arrowNodes);

  // Switch the same 400x400 pocket to dense Raster (~108 passes at 60% stepover = 3.6mm)
  await evalJs(`window.__prepareView.setFieldOnSelected('clearing', 'raster')`);
  await sleep(200);
  const bRast = await measurePan('dense Raster');
  assert.ok(bRast.passes >= 60, 'dense Raster (60+ passes) measured: ' + bRast.passes);
  assert.ok(bRast.arrowNodes <= 3, 'batched arrow DOM nodes on dense Raster: ' + bRast.arrowNodes);

  console.log('direction-777-live: ok');
} finally {
  await close();
}
