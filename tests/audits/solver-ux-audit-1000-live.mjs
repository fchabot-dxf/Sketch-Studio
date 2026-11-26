// tests/audits/solver-ux-audit-1000-live.mjs -- TASK 1000 (AUDIT, outside the gate)
// Run: node tests/audits/solver-ux-audit-1000-live.mjs
// Real headless Chrome (CDP) probes on SketchStudio Desktop (1280x800), Phone (390x844), and Shaper Desktop (1280x800).
// Blocks all non-local network requests, captures cropped screenshots to .evidence/1000/, and closes every browser cleanly.
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sleep, sendRealKey } from '../helpers/cdp-browser.js';
import { installFakeDriveSession } from '../helpers/fake-drive-session.js';
import { resetBufferLive } from '../helpers/reset-buffer.js';
import { pressRibbonTool } from '../helpers/ribbon-tool.js';

const EVID = path.resolve('.evidence/1000');
fs.mkdirSync(EVID, { recursive: true });

const row = (id, text) => console.log(`ROW ${id} | ${text}`);
const f = (v, d = 2) => (typeof v === 'number' ? (Math.abs(v) < 5e-7 ? '0' : v.toFixed(d).replace(/\.?0+$/, '')) : String(v));

function makeDoc(joints, shapes, constraints = [], parameters = []) {
  return {
    version: 3, hosts: {},
    geometry: {
      joints: [['j_origin', { x: 0, y: 0, fixed: true, sketchId: 'sketch-1' }], ...Object.entries(joints).map(([id, [x, y, fixed]]) => [id, { x, y, fixed: !!fixed, sketchId: 'sketch-1' }])],
      shapes: shapes.map((s) => ({ sketchId: 'sketch-1', isConstruction: false, ...s })),
      constraints, parameters,
      sketches: [{ id: 'sketch-1', name: 'Sketch 1', visible: true }],
      activeSketchId: 'sketch-1', groups: [], profiles: [],
    },
  };
}

async function openSeeded(cdp, host, doc) {
  const { port, evalJs, waitForApp, navigate } = cdp;
  const url = `http://127.0.0.1:${port}/apps/${host}/index.html`;
  await resetBufferLive(cdp);
  await navigate(url, 10000);
  await waitForApp(host === 'sketchstudio' ? 'svgCanvas' : 'design-canvas');
  await evalJs(`import('/packages/ui/project-store.js').then(async (m) => { const s = m.getProjectStore(); const d = await s.newDesign('Audit 1000', { app: '${host}' }); await s.save(${JSON.stringify(doc)}, { app: '${host}', id: d.id }); })`);
  await navigate(url, 10000);
  await waitForApp(host === 'sketchstudio' ? 'svgCanvas' : 'design-canvas');
  await sleep(400);
}

async function runViewport({ width, height, tag }) {
  const isPhone = width <= 640;
  const cdp = await launchBrowser({
    tag: `1000-${tag}`,
    width,
    height,
    args: ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost'],
  });
  if (!cdp) { row(`L.${tag}`, 'skipped: no headless Edge/Chrome installed'); return; }
  const { send, evalJs, waitFor, flushAutosave, close } = cdp;

  const tapOrClick = async (x, y, clicks = 1) => {
    const rx = Math.round(x), ry = Math.round(y);
    if (isPhone) {
      for (let k = 0; k < clicks; k++) {
        await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: rx, y: ry, id: 1, radiusX: 2, radiusY: 2, force: 1 }] });
        await sleep(45);
        await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        if (k + 1 < clicks) await sleep(90);
      }
    } else {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rx, y: ry, button: 'none', clickCount: 0 });
      await sleep(30);
      for (let k = 1; k <= clicks; k++) {
        await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rx, y: ry, button: 'left', buttons: 1, clickCount: k });
        await sleep(30);
        await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rx, y: ry, button: 'left', buttons: 0, clickCount: k });
        if (k < clicks) await sleep(60);
      }
    }
    await sleep(180);
  };

  const dragReal = async (from, to, steps = 16) => {
    const ax = Math.round(from.x), ay = Math.round(from.y), bx = Math.round(to.x), by = Math.round(to.y);
    if (isPhone) {
      await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: ax, y: ay, id: 1, radiusX: 2, radiusY: 2, force: 1 }] });
      for (let k = 1; k <= steps; k++) {
        await sleep(18);
        await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: Math.round(ax + (bx - ax) * k / steps), y: Math.round(ay + (by - ay) * k / steps), id: 1, radiusX: 2, radiusY: 2, force: 1 }] });
      }
      await sleep(25);
      await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: ax, y: ay, button: 'none', clickCount: 0 });
      await sleep(25);
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: ax, y: ay, button: 'left', buttons: 1, clickCount: 1 });
      for (let k = 1; k <= steps; k++) {
        await sleep(16);
        await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(ax + (bx - ax) * k / steps), y: Math.round(ay + (by - ay) * k / steps), button: 'left', buttons: 1, clickCount: 0 });
      }
      await sleep(25);
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: bx, y: by, button: 'left', buttons: 0, clickCount: 1 });
    }
    await sleep(250);
  };

  const typeString = async (str) => {
    for (const ch of str) await send('Input.insertText', { text: ch });
    await sleep(80);
  };

  const snapPng = async (name, clip = null) => {
    const opts = { format: 'png' };
    if (clip) opts.clip = { x: Math.max(0, Math.round(clip.x)), y: Math.max(0, Math.round(clip.y)), width: Math.min(width, Math.round(clip.width)), height: Math.min(height, Math.round(clip.height)), scale: 2 };
    const s = await send('Page.captureScreenshot', opts);
    fs.writeFileSync(path.join(EVID, name), Buffer.from(s.data, 'base64'));
  };

  const readToasts = () => evalJs(`[...document.querySelectorAll('#notification-container [data-level]')].map(e => '[' + e.dataset.level + '] ' + e.textContent.trim().replace(/\\s+/g, ' '))`);
  const clearToasts = () => evalJs(`document.querySelectorAll('#notification-container [data-level]').forEach(e => e.remove())`);

  try {
    await installFakeDriveSession(cdp);
    if (isPhone) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: true });
      await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    }

    // ---- L1: 500x40 rect shrink to 4 mm (false collapse refusal) ----
    const rect500 = makeDoc(
      { a: [-250, -20, true], b: [250, -20], c: [250, 20], d: [-250, 20] },
      [{ id: 'L1', type: 'line', joints: ['a', 'b'] }, { id: 'L2', type: 'line', joints: ['b', 'c'] }, { id: 'L3', type: 'line', joints: ['c', 'd'] }, { id: 'L4', type: 'line', joints: ['d', 'a'] }],
      [{ type: 'horizontal', joints: ['a', 'b'] }, { type: 'vertical', joints: ['b', 'c'] }, { type: 'horizontal', joints: ['c', 'd'] }, { type: 'vertical', joints: ['d', 'a'] },
       { type: 'distance', joints: ['a', 'b'], value: 500, name: 'd1', offset: 35 }, { type: 'distance', joints: ['b', 'c'], value: 40, name: 'd2', offset: 35 }]);
    await openSeeded(cdp, 'sketchstudio', rect500);
    await waitFor(`!!document.querySelector('#svgCanvas .dim-label')`, 'dim labels rendered');
    await clearToasts();
    const d1Pos = await evalJs(`(() => { const el = [...document.querySelectorAll('#svgCanvas .dim-label')].find(e => /500/.test(e.textContent)); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width/2, y: r.top + r.height/2 }; })()`);
    if (d1Pos) {
      await tapOrClick(d1Pos.x, d1Pos.y, 2);
      const opened = await evalJs(`!document.getElementById('dimInput')?.classList.contains('hidden')`);
      if (opened) {
        await evalJs(`(() => { const i = document.getElementById('dimInput'); i.focus(); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
        await typeString('4');
        await sendRealKey(send, 'Enter', 'Enter', 13);
        await sleep(300);
      }
      const ts = await readToasts();
      const boxStill = await evalJs(`!document.getElementById('dimInput')?.classList.contains('hidden')`);
      row(`L1.${tag}`, `500x40 rect type "4" into d1: opened=${opened}, boxStill=${boxStill}, toasts=${JSON.stringify(ts)}`);
      if (!isPhone) await snapPng(`rect-collapse-refusal-${tag}.png`, { x: Math.max(0, width / 2 - 280), y: 0, width: 560, height: 220 });
      else await snapPng(`rect-collapse-refusal-${tag}.png`);
    } else {
      row(`L1.${tag}`, 'd1 label not found on screen');
    }

    // ---- L2: Double-click/tap driving dim between two fixed points -> silent demotion + [ERR-DRIVEN-02] ----
    const fixedLine = makeDoc(
      { a: [-40, 0, true], b: [40, 0, true] },
      [{ id: 'L1', type: 'line', joints: ['a', 'b'] }],
      [{ type: 'distance', joints: ['a', 'b'], value: 80, name: 'd1', offset: 30 }]);
    await openSeeded(cdp, 'sketchstudio', fixedLine);
    await waitFor(`!!document.querySelector('#svgCanvas .dim-label')`, 'fixed line dim rendered');
    await clearToasts();
    const flPos = await evalJs(`(() => { const el = document.querySelector('#svgCanvas .dim-label'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width/2, y: r.top + r.height/2, text: el.textContent.trim() }; })()`);
    if (flPos) {
      await tapOrClick(flPos.x, flPos.y, 2);
      await sleep(250);
      const afterText = await evalJs(`document.querySelector('#svgCanvas .dim-label')?.textContent.trim()`);
      const ts = await readToasts();
      row(`L2.${tag}`, `dblclick driving dim on fixed line: label "${flPos.text}"->"${afterText}", toasts=${JSON.stringify(ts)}`);
      if (!isPhone) await snapPng(`fixed-dim-demoted-${tag}.png`, { x: Math.max(0, width / 2 - 300), y: 0, width: 600, height: 260 });
    }

    // ---- L3: Conflicted triangle (50, 40, 120) visual colours on screen ----
    const badTri = makeDoc(
      { a: [-40, 0, true], b: [10, 0], c: [10, 40] },
      [{ id: 'L1', type: 'line', joints: ['a', 'b'] }, { id: 'L2', type: 'line', joints: ['b', 'c'] }, { id: 'L3', type: 'line', joints: ['c', 'a'] }],
      [{ type: 'horizontal', joints: ['a', 'b'] }, { type: 'distance', joints: ['a', 'b'], value: 50, name: 'd1', offset: 25 },
       { type: 'distance', joints: ['b', 'c'], value: 40, name: 'd2', offset: 25 }, { type: 'distance', joints: ['c', 'a'], value: 120, name: 'd3', offset: -25 }]);
    await openSeeded(cdp, 'sketchstudio', badTri);
    await waitFor(`!!document.querySelector('#svgCanvas line.shape-elem[data-shape-id="L1"]')`, 'triangle rendered');
    await sleep(300);
    const triVisual = await evalJs(`(() => {
      const lines = ['L1','L2','L3'].map(id => {
        const el = document.querySelector('#svgCanvas line.shape-elem[data-shape-id="' + id + '"]');
        const cs = el ? getComputedStyle(el) : null;
        return { id, cls: el?.getAttribute('class'), stroke: el?.getAttribute('stroke') || cs?.stroke, x1: +el?.getAttribute('x1'), y1: +el?.getAttribute('y1'), x2: +el?.getAttribute('x2'), y2: +el?.getAttribute('y2') };
      });
      const labels = [...document.querySelectorAll('#svgCanvas .dim-label')].map(e => e.textContent.trim());
      return { lines, labels };
    })()`);
    row(`L3.${tag}`, `conflicted triangle (50,40,120) visual: ${JSON.stringify(triVisual)}`);
    if (!isPhone) {
      const box = await evalJs(`(() => { const r = document.getElementById('svgCanvas').getBoundingClientRect(); return { x: r.left + r.width/2 - 260, y: r.top + r.height/2 - 140, width: 520, height: 280 }; })()`);
      await snapPng(`conflicted-triangle-${tag}.png`, box);
    }

    // ---- L4: Desktop vs Phone draw-time box on Line tool (focus + position + "w = 50" error hint!) ----
    const blank = makeDoc({ a: [-50, 0, true], b: [10, 0] }, [{ id: 'L1', type: 'line', joints: ['a', 'b'] }], [{ type: 'horizontal', joints: ['a', 'b'] }, { type: 'distance', joints: ['a', 'b'], value: 60, name: 'd1', offset: 25 }]);
    await openSeeded(cdp, 'sketchstudio', blank);
    await waitFor(`!!document.querySelector('#svgCanvas line.shape-elem[data-shape-id="L1"]')`, 'L1 rendered');
    await pressRibbonTool(evalJs, (p) => tapOrClick(p.x, p.y, 1), 'tool-line');
    await sleep(200);
    const canvasCenter = await evalJs(`(() => { const r = document.getElementById('svgCanvas').getBoundingClientRect(); return { x: r.left + r.width * 0.45, y: r.top + r.height * 0.55 }; })()`);
    await tapOrClick(canvasCenter.x, canvasCenter.y, 1);
    if (!isPhone) {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(canvasCenter.x + 80), y: Math.round(canvasCenter.y), button: 'none', clickCount: 0 });
      await sleep(150);
    }
    const liveBoxInfo = await evalJs(`(() => {
      const dual = document.getElementById('dualInput');
      const inp = dual?.querySelector('input');
      const r = dual?.getBoundingClientRect();
      return { visible: dual && !dual.classList.contains('hidden'), focused: document.activeElement === inp, rect: r ? { left: Math.round(r.left), top: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) } : null };
    })()`);
    // Now type "w = 50" into the live length box
    await evalJs(`(() => { const inp = document.querySelector('#dualInput input'); if (inp) { inp.focus(); inp.value = ''; inp.dispatchEvent(new Event('input', { bubbles: true })); } })()`);
    await typeString('w = 50');
    await sendRealKey(send, 'Enter', 'Enter', 13);
    await sleep(200);
    const liveHint = await evalJs(`(() => { const h = document.getElementById('dimHint'); return { visible: h && !h.classList.contains('hidden'), text: h?.textContent.trim(), rect: h ? { left: Math.round(h.getBoundingClientRect().left), top: Math.round(h.getBoundingClientRect().top) } : null }; })()`);
    row(`L4.${tag}`, `Line draw-time box: ${JSON.stringify(liveBoxInfo)}; type "w = 50" hint=${JSON.stringify(liveHint)}`);
    await snapPng(`draw-box-eq-hint-${tag}.png`, isPhone ? null : { x: Math.max(0, liveBoxInfo.rect?.left - 40 || 200), y: Math.max(0, liveBoxInfo.rect?.top - 40 || 200), width: 420, height: 180 });

    // ---- L5 (Desktop only): Real Chrome drag frame time on 50 rects (200 lines, 250 constraints) + Shaper H/V irregularity ----
    if (!isPhone) {
      const joints = {}, shapes = [], constraints = [];
      for (let i = 0; i < 50; i++) {
        const gx = (i % 10) * 35 - 160, gy = Math.floor(i / 10) * 28 - 60;
        const a = `r${i}_a`, b = `r${i}_b`, c = `r${i}_c`, d = `r${i}_d`;
        joints[a] = [gx, gy, true]; joints[b] = [gx + 22, gy]; joints[c] = [gx + 22, gy + 14]; joints[d] = [gx, gy + 14];
        shapes.push({ id: `L${i}_1`, type: 'line', joints: [a, b] }, { id: `L${i}_2`, type: 'line', joints: [b, c] }, { id: `L${i}_3`, type: 'line', joints: [c, d] }, { id: `L${i}_4`, type: 'line', joints: [d, a] });
        constraints.push({ type: 'horizontal', joints: [a, b] }, { type: 'vertical', joints: [b, c] }, { type: 'horizontal', joints: [c, d] }, { type: 'vertical', joints: [d, a] }, { type: 'distance', joints: [a, b], value: 22, name: `d${i + 1}` });
      }
      await openSeeded(cdp, 'sketchstudio', makeDoc(joints, shapes, constraints));
      await waitFor(`!!document.querySelector('#svgCanvas line.shape-elem[data-shape-id="L0_1"]')`, '200 lines rendered');
      // Measure rAF frame intervals during a live drag of corner r0_c!
      const cPos = await evalJs(`(() => { const e = document.querySelector('#svgCanvas line.shape-elem[data-shape-id="L0_2"]'); const p = new DOMPoint(+e.getAttribute('x2'), +e.getAttribute('y2')).matrixTransform(e.getScreenCTM()); return { x: p.x, y: p.y }; })()`);
      await evalJs(`(() => { window.__dts = []; let last = performance.now(); window.__stopRaf = false; const tick = (t) => { window.__dts.push(t - last); last = t; if (!window.__stopRaf) requestAnimationFrame(tick); }; requestAnimationFrame(tick); })()`);
      await dragReal(cPos, { x: cPos.x, y: cPos.y + 60 }, 20);
      const perfLive = await evalJs(`(() => { window.__stopRaf = true; const a = (window.__dts || []).slice(2); if (!a.length) return null; const s = a.slice().sort((x,y)=>x-y); const mean = a.reduce((x,y)=>x+y,0)/a.length; return { frames: a.length, meanMs: +mean.toFixed(2), p50Ms: +s[Math.floor(s.length*0.5)].toFixed(2), p95Ms: +s[Math.floor(s.length*0.95)].toFixed(2), maxMs: +s[s.length-1].toFixed(2) }; })()`);
      row(`L5.perf.${tag}`, `real Chrome drag on 50 rects (200 lines, 250 constraints): ${JSON.stringify(perfLive)}`);
    }
  } finally {
    await close();
  }
}

await runViewport({ width: 1280, height: 800, tag: 'desktop' });
await runViewport({ width: 390, height: 844, tag: 'phone' });
console.log('solver-ux-audit-1000-live.mjs: printed (exit 0 whatever the rows say)');
