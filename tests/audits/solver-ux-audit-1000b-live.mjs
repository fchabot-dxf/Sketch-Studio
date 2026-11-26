// TASK 1000B — Independent Solver UI/UX Audit (Auditor B):
// Live headless-browser verification in SketchStudio (desktop 1280x800 + phone 390x844 touch)
// and Shaper (desktop 1280x800). Blocks all non-local requests; closes every browser cleanly.
// Run: node tests/audits/solver-ux-audit-1000b-live.mjs
// AUDIT ONLY: observes, captures evidence to .evidence/1000b/, prints verbatim; exits 0.

import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sendRealKey, sleep } from '../helpers/cdp-browser.js';
import { installFakeDriveSession } from '../helpers/fake-drive-session.js';
import { resetBufferLive } from '../helpers/reset-buffer.js';
import { pressRibbonTool } from '../helpers/ribbon-tool.js';

const EVID = path.resolve('.evidence/1000b');
fs.mkdirSync(EVID, { recursive: true });
const BLOCK_EXTERNAL = ['--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1 , EXCLUDE localhost'];

function baseDoc(joints, shapes, constraints = []) {
  return {
    version: 3, hosts: {},
    geometry: {
      joints: [['j_origin', { x: 0, y: 0, fixed: true, sketchId: 'sketch-1' }], ...joints],
      shapes, constraints,
      sketches: [{ id: 'sketch-1', name: 'Sketch 1', visible: true }],
      activeSketchId: 'sketch-1', groups: [], profiles: [], parameters: [],
    },
  };
}

async function seedAndReload(cdp, appId, doc, canvasId) {
  const url = `http://127.0.0.1:${cdp.port}/apps/${appId}/index.html`;
  await resetBufferLive(cdp);
  await cdp.navigate(url, 12000);
  await cdp.waitForApp(canvasId);
  await cdp.evalJs(`import('/packages/ui/project-store.js').then(async (m) => {
    const s = m.getProjectStore();
    const d = await s.newDesign('Audit 1000B', { app: '${appId}' });
    await s.save(${JSON.stringify(doc)}, { app: '${appId}', id: d.id });
  })`);
  await cdp.navigate(url, 12000);
  await cdp.waitForApp(canvasId);
  await sleep(350);
}

async function loadCurrentDoc(cdp, appId) {
  await cdp.flushAutosave();
  return cdp.evalJs(`import('/packages/ui/project-store.js').then(async (m) => {
    const cur = await m.getProjectStore().loadCurrent({ app: '${appId}' });
    return cur ? cur.document : null;
  })`);
}

function makeInput(send, isPhone) {
  const clickPt = async (p, opts = {}) => {
    const x = Math.round(p.x), y = Math.round(p.y);
    if (isPhone && !opts.mouse) {
      await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1, radiusX: 1, radiusY: 1, force: 1 }] });
      await sleep(60);
      await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      const modifiers = opts.shift ? 8 : 0;
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', clickCount: 0, modifiers });
      await sleep(40);
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1, modifiers });
      await sleep(35);
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1, modifiers });
    }
    await sleep(160);
  };
  const dblclickPt = async (p) => {
    const x = Math.round(p.x), y = Math.round(p.y);
    if (isPhone) {
      for (let k = 0; k < 2; k++) {
        await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1, radiusX: 1, radiusY: 1, force: 1 }] });
        await sleep(50);
        await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        if (k === 0) await sleep(80);
      }
    } else {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', clickCount: 0 });
      await sleep(40);
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
      await sleep(60);
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 2 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 2 });
    }
    await sleep(200);
  };
  const rightClickPt = async (p) => {
    const x = Math.round(p.x), y = Math.round(p.y);
    if (isPhone) {
      await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1, radiusX: 1, radiusY: 1, force: 1 }] });
      await sleep(650);
      await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', clickCount: 0 });
      await sleep(40);
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'right', buttons: 2, clickCount: 1 });
      await sleep(40);
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'right', buttons: 0, clickCount: 1 });
    }
    await sleep(200);
  };
  const dragPt = async (a, b, steps = 10) => {
    if (isPhone) {
      await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: Math.round(a.x), y: Math.round(a.y), id: 1, radiusX: 1, radiusY: 1, force: 1 }] });
      for (let i = 1; i <= steps; i++) {
        await sleep(25);
        await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: Math.round(a.x + (b.x - a.x) * i / steps), y: Math.round(a.y + (b.y - a.y) * i / steps), id: 1, radiusX: 1, radiusY: 1, force: 1 }] });
      }
      await sleep(30);
      await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(a.x), y: Math.round(a.y), button: 'none', clickCount: 0 });
      await sleep(40);
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: Math.round(a.x), y: Math.round(a.y), button: 'left', buttons: 1, clickCount: 1 });
      for (let i = 1; i <= steps; i++) {
        await sleep(25);
        await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(a.x + (b.x - a.x) * i / steps), y: Math.round(a.y + (b.y - a.y) * i / steps), button: 'left', buttons: 1, clickCount: 0 });
      }
      await sleep(30);
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: Math.round(b.x), y: Math.round(b.y), button: 'left', buttons: 0, clickCount: 1 });
    }
    await sleep(220);
  };
  return { clickPt, dblclickPt, rightClickPt, dragPt };
}

async function worldPt(evalJs, canvasId, wx, wy) {
  return evalJs(`(() => {
    const svg = document.getElementById('${canvasId}');
    const wg = svg.querySelector('#world-group, #design-world-group') || svg;
    const p = new DOMPoint(${wx}, ${wy}).matrixTransform(wg.getScreenCTM());
    return { x: Math.round(p.x), y: Math.round(p.y) };
  })()`);
}

async function clipAroundWorld(evalJs, canvasId, pts, pad = 90) {
  return evalJs(`(() => {
    const svg = document.getElementById('${canvasId}');
    const sr = svg.getBoundingClientRect();
    const wg = svg.querySelector('#world-group, #design-world-group') || svg;
    const ctm = wg.getScreenCTM();
    const sp = ${JSON.stringify(pts)}.map(([wx, wy]) => new DOMPoint(wx, wy).matrixTransform(ctm));
    const minX = Math.min(...sp.map(p => p.x)) - ${pad};
    const maxX = Math.max(...sp.map(p => p.x)) + ${pad};
    const minY = Math.min(...sp.map(p => p.y)) - ${pad};
    const maxY = Math.max(...sp.map(p => p.y)) + ${pad};
    const x = Math.max(Math.round(sr.left), Math.round(minX));
    const y = Math.max(Math.round(sr.top), Math.round(minY));
    const r = Math.min(Math.round(sr.right), Math.round(maxX));
    const b = Math.min(Math.round(sr.bottom), Math.round(maxY));
    return { x, y, width: Math.max(120, r - x), height: Math.max(120, b - y), scale: 1 };
  })()`);
}

async function saveClip(send, clip, name) {
  const shot = await send('Page.captureScreenshot', { format: 'png', clip });
  const out = path.join(EVID, name);
  fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
  return out;
}

// ===========================================================================
// PART 1: SketchStudio Desktop (1280x800)
// ===========================================================================
console.log('\n=== LIVE PART 1: SketchStudio Desktop (1280x800) ===');
{
  const cdp = await launchBrowser({ tag: '1000b-desk', width: 1280, height: 800, args: BLOCK_EXTERNAL });
  if (!cdp) { console.log('NO BROWSER'); process.exit(0); }
  const { send, evalJs } = cdp;
  const { clickPt, dblclickPt, rightClickPt, dragPt } = makeInput(send, false);
  try {
    await installFakeDriveSession(cdp);

    // LIVE-1: Locked Circle stays BLUE and resizes on rim drag!
    {
      const doc = baseDoc(
        [['c1', { x: 0, y: 0, sketchId: 'sketch-1' }], ['a', { x: -50, y: -30, sketchId: 'sketch-1' }], ['b', { x: -50, y: 30, sketchId: 'sketch-1' }]],
        [
          { id: 'circ1', type: 'circle', joints: ['c1'], radius: 20, sketchId: 'sketch-1', isConstruction: false },
          { id: 'line1', type: 'line', joints: ['a', 'b'], sketchId: 'sketch-1', isConstruction: false },
        ]
      );
      await seedAndReload(cdp, 'sketchstudio', doc, 'svgCanvas');
      // Lock line1 (click + F) and lock circ1 (click + F)
      await clickPt(await worldPt(evalJs, 'svgCanvas', -50, 0));
      await sendRealKey(send, 'f', 'KeyF', 70, 0, 'f');
      await sleep(150);
      await clickPt(await worldPt(evalJs, 'svgCanvas', 20, 0));
      await sendRealKey(send, 'f', 'KeyF', 70, 0, 'f');
      await sleep(150);
      // Deselect by clicking empty space inside canvas
      await clickPt(await worldPt(evalJs, 'svgCanvas', 45, 0));
      await sleep(150);
      const colorsAfterLock = await evalJs(`(() => {
        const l = document.querySelector('#svgCanvas [data-shape-id="line1"]');
        const c = document.querySelector('#svgCanvas [data-shape-id="circ1"]');
        return {
          lineStroke: l ? getComputedStyle(l).stroke : null,
          circleStroke: c ? getComputedStyle(c).stroke : null,
        };
      })()`);
      // Screenshot BEFORE rim drag showing locked line (green) vs "locked" circle (blue)
      const box = await clipAroundWorld(evalJs, 'svgCanvas', [[-55, -35], [40, 35]], 70);
      await saveClip(send, box, 'locked-circle-before-drag.png');
      // Drag circle rim right by +15 world units
      const rimA = await worldPt(evalJs, 'svgCanvas', 20, 0);
      const rimB = await worldPt(evalJs, 'svgCanvas', 35, 0);
      await dragPt(rimA, rimB, 8);
      await clickPt(await worldPt(evalJs, 'svgCanvas', 55, 0)); // deselect
      await sleep(150);
      await saveClip(send, box, 'locked-circle-after-drag.png');
      const saved = await loadCurrentDoc(cdp, 'sketchstudio');
      const circSaved = saved.geometry.shapes.find(s => s.id === 'circ1');
      const c1Saved = saved.geometry.joints.find(([id]) => id === 'c1')?.[1];
      console.log('LIVE-1 LOCKED CIRCLE (DESKTOP):', JSON.stringify({
        colorsAfterLock, centerFixed: !!c1Saved?.fixed, radiusBefore: 20, radiusAfterRimDrag: +circSaved.radius.toFixed(2),
      }));
    }

    // LIVE-2: Horizontal Reference Dim -> Right-click -> Make Driving -> WARPS GEOMETRY!
    {
      const doc = baseDoc(
        [['a', { x: 0, y: 0, fixed: true, sketchId: 'sketch-1' }], ['b', { x: 30, y: 40, sketchId: 'sketch-1' }]],
        [{ id: 'l1', type: 'line', joints: ['a', 'b'], sketchId: 'sketch-1', isConstruction: false }],
        [{ type: 'distance', joints: ['a', 'b'], value: 30, dimMode: 'horizontal', isDriven: true, driven: true, offset: -18, name: 'd1' }]
      );
      await seedAndReload(cdp, 'sketchstudio', doc, 'svgCanvas');
      const clipBox = await clipAroundWorld(evalJs, 'svgCanvas', [[-5, -25], [60, 50]], 80);
      await saveClip(send, clipBox, 'href-before-desktop.png');
      const lblPt = await evalJs(`(() => { const el = document.querySelector('#svgCanvas .dim-label'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width/2, y: r.top + r.height/2, text: el.textContent.trim() }; })()`);
      await rightClickPt(lblPt);
      const menuClicked = await evalJs(`(() => {
        const item = document.querySelector('.sk-context-menu .sk-context-item[data-id="dim-driving"]');
        if (item) { item.click(); return { id: item.dataset.id, text: item.textContent.trim() }; }
        return { openMenus: document.querySelectorAll('.sk-context-menu').length, items: [...document.querySelectorAll('.sk-context-item')].map(e => e.dataset.id + ':' + e.textContent.trim()) };
      })()`);
      await sleep(300);
      await saveClip(send, clipBox, 'href-after-desktop.png');
      const lblAfter = await evalJs(`document.querySelector('#svgCanvas .dim-label')?.textContent?.trim()`);
      const saved = await loadCurrentDoc(cdp, 'sketchstudio');
      const jb = saved.geometry.joints.find(([id]) => id === 'b')?.[1];
      const d1 = saved.geometry.constraints[0];
      console.log('LIVE-2 H-REF TOGGLE DRIVING (DESKTOP):', JSON.stringify({
        lblBefore: lblPt?.text, menuClicked, lblAfter,
        bBefore: [30, 40], bAfter: [+jb.x.toFixed(2), +jb.y.toFixed(2)], d1Value: +d1.value.toFixed(2),
      }));
    }

    // LIVE-3: Switching tools mid-dimension-placement leaves phantom placing dim!
    {
      const doc = baseDoc(
        [['a', { x: -30, y: 10, sketchId: 'sketch-1' }], ['b', { x: 30, y: 10, sketchId: 'sketch-1' }]],
        [{ id: 'l1', type: 'line', joints: ['a', 'b'], sketchId: 'sketch-1', isConstruction: false }]
      );
      await seedAndReload(cdp, 'sketchstudio', doc, 'svgCanvas');
      await pressRibbonTool(evalJs, clickPt, 'tool-dim');
      await clickPt(await worldPt(evalJs, 'svgCanvas', 0, 10)); // starts placing
      // Move slightly so preview dim label is clearly visible off the line
      const previewPos = await worldPt(evalJs, 'svgCanvas', 0, -15);
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: previewPos.x, y: previewPos.y, button: 'none', clickCount: 0 });
      await sleep(100);
      // Click Line tool on ribbon WITHOUT pressing Esc
      await pressRibbonTool(evalJs, clickPt, 'tool-line');
      await sleep(200);
      const dimLabelsAfterSwitch = await evalJs(`document.querySelectorAll('#svgCanvas .dim-label').length`);
      const saved = await loadCurrentDoc(cdp, 'sketchstudio');
      const clipBox = await clipAroundWorld(evalJs, 'svgCanvas', [[-35, -25], [35, 25]], 80);
      await saveClip(send, clipBox, 'phantom-dim-desktop.png');
      console.log('LIVE-3 PHANTOM DIM AFTER RIBBON SWITCH (DESKTOP):', JSON.stringify({
        activeTool: await evalJs(`document.querySelector('.sk-ribbon-btn.active')?.id`),
        dimLabelsAfterSwitch,
        savedConstraintsCount: saved.geometry.constraints.length,
      }));
    }

    // LIVE-4: Equal 2-preselect `E` on invalid pair (line + circle) -> raw [ERR-EQUAL-01] JSON toast
    {
      const doc = baseDoc(
        [['a', { x: -40, y: 20, sketchId: 'sketch-1' }], ['b', { x: 10, y: 20, sketchId: 'sketch-1' }], ['c1', { x: 35, y: 20, sketchId: 'sketch-1' }]],
        [
          { id: 'l1', type: 'line', joints: ['a', 'b'], sketchId: 'sketch-1', isConstruction: false },
          { id: 'circ1', type: 'circle', joints: ['c1'], radius: 12, sketchId: 'sketch-1', isConstruction: false },
        ]
      );
      await seedAndReload(cdp, 'sketchstudio', doc, 'svgCanvas');
      await clickPt(await worldPt(evalJs, 'svgCanvas', -15, 20));
      await clickPt(await worldPt(evalJs, 'svgCanvas', 47, 20), { shift: true });
      await sendRealKey(send, 'e', 'KeyE', 69, 0, 'e');
      await sleep(300);
      const toastInfo = await evalJs(`(() => {
        const el = document.querySelector('#notification-container [data-level]');
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { level: el.getAttribute('data-level'), text: el.querySelector('pre')?.textContent?.trim(), rect: { x: Math.max(0, r.left - 10), y: Math.max(0, r.top - 10), width: r.width + 20, height: r.height + 20, scale: 2 } };
      })()`);
      if (toastInfo) await saveClip(send, toastInfo.rect, 'raw-err-equal-toast.png');
      console.log('LIVE-4 RAW ERR-EQUAL-01 TOAST (DESKTOP):', JSON.stringify({ level: toastInfo?.level, text: toastInfo?.text }));
    }

    // LIVE-5: SketchStudio ribbon H/V on pre-selected line & Parallel re-click toggle
    {
      const doc = baseDoc(
        [['a', { x: -30, y: 15, sketchId: 'sketch-1' }], ['b', { x: 30, y: 22, sketchId: 'sketch-1' }]],
        [{ id: 'l1', type: 'line', joints: ['a', 'b'], sketchId: 'sketch-1', isConstruction: false }]
      );
      await seedAndReload(cdp, 'sketchstudio', doc, 'svgCanvas');
      await clickPt(await worldPt(evalJs, 'svgCanvas', 0, 18.5));
      await pressRibbonTool(evalJs, clickPt, 'tool-hv');
      await sleep(200);
      const hvActiveAfter = await evalJs(`document.querySelector('.sk-ribbon-btn.active')?.id`);
      await saveClip(send, { x: 0, y: 40, width: 1280, height: 110, scale: 1 }, 'hv-after-sketchstudio.png');
      // Re-click Parallel twice
      await pressRibbonTool(evalJs, clickPt, 'tool-parallel');
      const p1 = await evalJs(`document.querySelector('.sk-ribbon-btn.active')?.id`);
      await pressRibbonTool(evalJs, clickPt, 'tool-parallel');
      const p2 = await evalJs(`document.querySelector('.sk-ribbon-btn.active')?.id`);
      console.log('LIVE-5 SKETCHSTUDIO RIBBON (DESKTOP):', JSON.stringify({ hvActiveAfter, parallelReclick: [p1, p2] }));
    }
  } finally {
    await cdp.close();
  }
}

// ===========================================================================
// PART 2: Shaper Desktop (1280x800) — Host parity vs SketchStudio
// ===========================================================================
console.log('\n=== LIVE PART 2: Shaper Desktop (1280x800) ===');
{
  const cdp = await launchBrowser({ tag: '1000b-shaper', width: 1280, height: 800, args: BLOCK_EXTERNAL });
  if (!cdp) { console.log('NO BROWSER'); process.exit(0); }
  const { send, evalJs } = cdp;
  const { clickPt } = makeInput(send, false);
  try {
    await installFakeDriveSession(cdp);
    const doc = baseDoc(
      [['a', { x: -30, y: 15, sketchId: 'sketch-1' }], ['b', { x: 30, y: 22, sketchId: 'sketch-1' }]],
      [{ id: 'l1', type: 'line', joints: ['a', 'b'], sketchId: 'sketch-1', isConstruction: false }]
    );
    await seedAndReload(cdp, 'shaper', doc, 'design-canvas');
    await clickPt(await worldPt(evalJs, 'design-canvas', 0, 18.5));
    await pressRibbonTool(evalJs, clickPt, 'tool-hv');
    await sleep(200);
    const hvActiveAfter = await evalJs(`document.querySelector('.sk-ribbon-btn.active')?.id`);
    await saveClip(send, { x: 0, y: 40, width: 1280, height: 110, scale: 1 }, 'hv-after-shaper.png');
    await pressRibbonTool(evalJs, clickPt, 'tool-parallel');
    const p1 = await evalJs(`document.querySelector('.sk-ribbon-btn.active')?.id`);
    await pressRibbonTool(evalJs, clickPt, 'tool-parallel');
    const p2 = await evalJs(`document.querySelector('.sk-ribbon-btn.active')?.id`);
    console.log('LIVE-P7 SHAPER RIBBON (DESKTOP):', JSON.stringify({ hvActiveAfter, parallelReclick: [p1, p2] }));
  } finally {
    await cdp.close();
  }
}

// ===========================================================================
// PART 3: SketchStudio Phone (390x844, touch) — Desktop vs Phone/Touch asymmetries
// ===========================================================================
console.log('\n=== LIVE PART 3: SketchStudio Phone (390x844 touch) ===');
{
  const cdp = await launchBrowser({ tag: '1000b-phone', width: 390, height: 844, args: BLOCK_EXTERNAL });
  if (!cdp) { console.log('NO BROWSER'); process.exit(0); }
  const { send, evalJs } = cdp;
  const { clickPt, rightClickPt, dragPt } = makeInput(send, true);
  try {
    await installFakeDriveSession(cdp);
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

    // LIVE-P2-1: Locked Circle on Phone (still blue + resizes on finger rim drag!)
    {
      const doc = baseDoc(
        [['c1', { x: 0, y: 0, sketchId: 'sketch-1' }]],
        [{ id: 'circ1', type: 'circle', joints: ['c1'], radius: 20, sketchId: 'sketch-1', isConstruction: false }]
      );
      await seedAndReload(cdp, 'sketchstudio', doc, 'svgCanvas');
      await clickPt(await worldPt(evalJs, 'svgCanvas', 20, 0)); // select circle by touch
      await pressRibbonTool(evalJs, clickPt, 'btn-lock'); // Lock via CONSTRAIN dropdown on phone
      await sleep(200);
      // Deselect by tapping empty canvas inside svgCanvas bounds (top-left corner of canvas)
      const safeBlank = await evalJs(`(() => { const r = document.getElementById('svgCanvas').getBoundingClientRect(); return { x: Math.round(r.left + 25), y: Math.round(r.top + 25) }; })()`);
      await clickPt(safeBlank);
      await sleep(150);
      const strokeAfterLock = await evalJs(`(() => { const c = document.querySelector('#svgCanvas [data-shape-id="circ1"]'); return c ? getComputedStyle(c).stroke : null; })()`);
      const rimA = await worldPt(evalJs, 'svgCanvas', 20, 0);
      const rimB = await worldPt(evalJs, 'svgCanvas', 32, 0);
      await dragPt(rimA, rimB, 8);
      await clickPt(safeBlank);
      await sleep(150);
      const saved = await loadCurrentDoc(cdp, 'sketchstudio');
      const circSaved = saved.geometry.shapes.find(s => s.id === 'circ1');
      const c1Saved = saved.geometry.joints.find(([id]) => id === 'c1')?.[1];
      const phoneBox = await clipAroundWorld(evalJs, 'svgCanvas', [[-35, -35], [35, 35]], 40);
      await saveClip(send, phoneBox, 'locked-circle-phone.png');
      console.log('LIVE-P2-1 LOCKED CIRCLE (PHONE TOUCH):', JSON.stringify({
        strokeAfterLock, centerFixed: !!c1Saved?.fixed, radiusBefore: 20, radiusAfterFingerDrag: +circSaved.radius.toFixed(2),
      }));
    }

    // LIVE-P2-2: Desktop vs Phone — Shortcut toggle on tool IN DROPDOWN + Long-press H-Ref -> Driving!
    {
      const barToolsPhone = await evalJs(`[...document.querySelectorAll('.sk-ribbon-btn[data-tool]:not([hidden])')].map(b => b.dataset.tool)`);
      const hasVisibleParallelBtn = await evalJs(`(() => { const b = document.getElementById('tool-parallel'); return !!b && !b.hidden; })()`);
      const hasVisibleCollinearBtn = await evalJs(`(() => { const b = document.getElementById('tool-collinear'); return !!b && !b.hidden; })()`);
      // Send 'i' (collinear) twice on phone
      await sendRealKey(send, 'i', 'KeyI', 73, 0, 'i');
      await sleep(150);
      const i1 = await evalJs(`document.querySelector('.sk-ribbon-btn.active')?.id || 'none'`);
      await sendRealKey(send, 'i', 'KeyI', 73, 0, 'i');
      await sleep(150);
      const i2 = await evalJs(`document.querySelector('.sk-ribbon-btn.active')?.id || 'none'`);
      // Check Horizontal Reference Dim long-press -> Make Driving on phone
      const doc = baseDoc(
        [['a', { x: 0, y: 0, fixed: true, sketchId: 'sketch-1' }], ['b', { x: 30, y: 40, sketchId: 'sketch-1' }]],
        [{ id: 'l1', type: 'line', joints: ['a', 'b'], sketchId: 'sketch-1', isConstruction: false }],
        [{ type: 'distance', joints: ['a', 'b'], value: 30, dimMode: 'horizontal', isDriven: true, driven: true, offset: -18, name: 'd1' }]
      );
      await seedAndReload(cdp, 'sketchstudio', doc, 'svgCanvas');
      const lblPt = await evalJs(`(() => { const el = document.querySelector('#svgCanvas .dim-label'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width/2, y: r.top + r.height/2 }; })()`);
      await rightClickPt(lblPt); // long-press 650ms on phone!
      const menuFound = await evalJs(`(() => {
        const item = document.querySelector('.sk-context-menu .sk-context-item[data-id="dim-driving"]');
        if (item) { item.click(); return { id: item.dataset.id, text: item.textContent.trim() }; }
        return { openMenus: document.querySelectorAll('.sk-context-menu').length, items: [...document.querySelectorAll('.sk-context-item')].map(e => e.dataset.id + ':' + e.textContent.trim()) };
      })()`);
      await sleep(300);
      const saved = await loadCurrentDoc(cdp, 'sketchstudio');
      const jb = saved.geometry.joints.find(([id]) => id === 'b')?.[1];
      console.log('LIVE-P2-2 PHONE DROPDOWN & LONG-PRESS:', JSON.stringify({
        barToolsPhoneCount: barToolsPhone.length, hasVisibleParallelBtn, hasVisibleCollinearBtn,
        collinearKeyTwice: [i1, i2],
        longPressMenu: menuFound,
        bAfterPhoneToggleDriving: [+jb.x.toFixed(2), +jb.y.toFixed(2)],
      }));
    }
  } finally {
    await cdp.close();
  }
}
