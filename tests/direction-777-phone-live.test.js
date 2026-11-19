// tests/direction-777-phone-live.test.js — TASK 777: clearer cutting direction marks in Shaper Prepare (PHONE 390x844, real touch taps).
// Checks: marks on selected cut (Raster pocket, On-line Lead-in, On-line Tabs), none on unselected cuts,
// prefers-reduced-motion shows the still version, no sideways overflow or layout regression.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';
import { resetBufferLive } from './helpers/reset-buffer.js';

const EVIDENCE_DIR = process.env.EVIDENCE_DIR || path.resolve('.evidence/777');
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

const cdp = await launchBrowser({ tag: '777-phone', width: 1280, height: 800 });
if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
const { port, send, evalJs, waitFor, navigate, close } = cdp;

try {
  const shot = async (name) => {
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    const file = path.join(EVIDENCE_DIR, name);
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
    console.log('screenshot ' + file);
  };
  const T = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i, radiusX: 1, radiusY: 1, force: 1 })) });
  const tap = async (x, y) => { await T('touchStart', [{ x, y }]); await sleep(35); await T('touchEnd', []); await sleep(200); };
  const toScreen = (x, y) => evalJs(`(() => { const s = document.getElementById('prepare-canvas'); const p = s.createSVGPoint(); p.x = ${x}; p.y = ${y}; const q = p.matrixTransform(s.getScreenCTM()); return { x: Math.round(q.x), y: Math.round(q.y) }; })()`);
  const tapWorld = async (x, y) => { const p = await toScreen(x, y); await tap(p.x, p.y); };

  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenOrientation: { type: 'portraitPrimary', angle: 0 } });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await resetBufferLive(cdp);
  await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html?analytics=off`, 10000);
  await waitFor(`!!document.querySelector('.sk-sidebar-handle')`, 'shaper phone ready');
  await evalJs(`import('/packages/core/settings-manager.js').then((m) => m.default.set('DOC_UNIT', 'mm'))`);

  // Seed 3 cuts: Raster pocket, On-line Lead-in, On-line Tabs
  await evalJs(`(async () => {
    const { findLoops } = await import('/packages/core/loop-finder.js');
    const { CUT_PLAN, keyOf } = await import('/apps/shaper/src/cut-plan.js');
    const st = window.__designController.state;
    for (const k of [...st.joints.keys()]) if (k !== 'j_origin') st.joints.delete(k);
    st.shapes.length = 0; st.constraints.length = 0; CUT_PLAN.clear();
    let n = 0;
    const J = (x, y) => { const id = 'pj' + (++n); st.joints.set(id, { x, y }); return id; };
    const line = (a, b) => { const id = 'ps' + (++n); st.shapes.push({ id, type: 'line', joints: [a, b] }); return id; };
    const rect = (x, y, w, h) => { const p = [J(x, y), J(x + w, y), J(x + w, y + h), J(x, y + h)]; return [0, 1, 2, 3].map((i) => line(p[i], p[(i + 1) % 4]))[0]; };
    const eRast = rect(0, 0, 60, 45);
    const eLead = rect(0, 70, 50, 40);
    const eTabs = rect(0, 130, 60, 45);
    st.saveState('seed777p');
    const loops = findLoops(st);
    const kOf = (edge) => keyOf('loop', loops.find((l) => l.edges.includes(edge)).id);
    const base = { cutDepth: 8, cutOffset: 0, toolDia: 6, cutterShape: 'endmill', cutterAngle: 90 };
    CUT_PLAN.set(kOf(eRast), { ...base, cutType: 'pocket', clearing: 'raster', stepover: 50, finishAllowance: 0.5, rasterAngle: 0, loop: false });
    CUT_PLAN.set(kOf(eLead), { ...base, cutType: 'online', toolDia: 3.175, leadIn: true, leadInLength: 8, leadInSide: 'outside' });
    CUT_PLAN.set(kOf(eTabs), { ...base, cutType: 'online', toolDia: 3.175, holdPart: 'tabs', tabCount: 3, tabWidth: 10 });
  })()`);

  // Open Prepare via phone sidebar drawer
  await evalJs(`document.querySelector('.sk-sidebar-handle').click()`); await sleep(250);
  await evalJs(`document.querySelector('.sk-sidebar-stage[data-tab="prepare"]').click()`); await sleep(350);
  if (await evalJs(`document.querySelector('.sk-sidebar').classList.contains('open')`)) {
    await evalJs(`document.querySelector('.sk-sidebar-scrim').click()`); await sleep(250);
  }
  await waitFor(`!!document.querySelector('#prepare-canvas .sk-edge') && !!document.getElementById('prepare-canvas').getScreenCTM()`, 'prepare phone ready');

  const inspect = () => evalJs(`(() => {
    const q = (s) => document.querySelectorAll('#prepare-canvas ' + s).length;
    const t = document.querySelector('#prepare-canvas .sk-travel');
    const a = document.querySelector('#prepare-canvas .sk-travel-arrows');
    const csT = t ? getComputedStyle(t) : null;
    const csA = a ? getComputedStyle(a) : null;
    const card = document.querySelector('#prepare-panel .cut-card');
    const cr = card && !card.hidden ? card.getBoundingClientRect() : null;
    return {
      travel: q('.sk-travel'),
      travelClear: q('.sk-travel-clear'),
      travelLead: q('.sk-travel-lead'),
      travelOnline: q('.sk-travel-online'),
      arrows: q('.sk-travel-arrows'),
      dasharray: csT && csT.strokeDasharray,
      anim: csT && csT.animationName,
      arrowDisplay: csA && csA.display,
      overflowX: document.documentElement.scrollWidth - innerWidth,
      cardFits: !cr || (cr.left >= 0 && cr.right <= innerWidth + 0.5),
    };
  })()`);

  // Unselected: 0 travel marks
  const idle = await inspect();
  assert.strictEqual(idle.travel, 0, 'phone idle: 0 travel');
  assert.strictEqual(idle.arrows, 0, 'phone idle: 0 arrows');
  assert.ok(idle.overflowX <= 0, 'phone idle: no sideways scroll');

  // Tap Raster pocket (offset view so shape sits visible beside the phone cut card on the right)
  await evalJs(`window.__prepareView.setView({ x: 55, y: 22.5, w: 120 })`); await sleep(150);
  await tapWorld(30, 22.5);
  const sRast = await inspect();
  assert.ok(sRast.travelClear >= 10 && sRast.arrows >= 2, 'phone raster: clearing + wall travel & arrows');
  assert.strictEqual(sRast.dasharray, '8px, 28px', 'phone: 8px 28px dash pattern');
  assert.strictEqual(sRast.anim, 'sk-march', 'phone: animation running');
  assert.ok(sRast.overflowX <= 0 && sRast.cardFits, 'phone raster: no layout overflow');
  await shot('phone-raster-pocket.png');

  // Reduced motion on phone
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await sleep(150);
  const sRed = await inspect();
  assert.strictEqual(sRed.anim, 'none', 'phone reduced motion: animation none');
  assert.ok(sRed.arrows >= 2 && sRed.arrowDisplay !== 'none', 'phone reduced motion: arrows visible');
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });

  // Tap On-line Lead-in (keep target on the uncovered left portion of the phone screen)
  await evalJs(`window.__prepareView.setView({ x: 55, y: 90, w: 120 })`); await sleep(150);
  await tapWorld(20, 90);
  const sLead = await inspect();
  assert.strictEqual(sLead.travelLead, 1, 'phone lead-in: leg marked');
  assert.strictEqual(sLead.travelOnline, 1, 'phone lead-in: outline marked');
  assert.ok(sLead.arrows >= 1 && sLead.overflowX <= 0 && sLead.cardFits, 'phone lead-in: arrows & layout clean');
  await shot('phone-leadin.png');

  // Tap On-line Tabs
  await evalJs(`window.__prepareView.setView({ x: 55, y: 152.5, w: 120 })`); await sleep(150);
  await tapWorld(20, 152.5);
  const sTabs = await inspect();
  assert.strictEqual(sTabs.travelOnline, 3, 'phone tabs: 3 strokes marked');
  assert.ok(sTabs.arrows >= 1 && sTabs.overflowX <= 0 && sTabs.cardFits, 'phone tabs: arrows & layout clean');
  await shot('phone-tabs.png');

  console.log('direction-777-phone-live: ok');
} finally {
  await close();
}
