// tests/audits/dimension-audit-1003-live.mjs -- TASK 1003 (AUDIT ONLY, outside the gate)
// Area 4: LIVE HEADLESS CHROME (CDP) — Desktop 1280x800 (SketchStudio, Shaper, Pen Plotter, Trace) + Phone 390x844 (SketchStudio touch).
// Blocks all non-local network requests, captures zoomed screenshots to .evidence/1003/, and closes every browser cleanly.
// Run: node tests/audits/dimension-audit-1003-live.mjs
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sleep, sendRealKey } from '../helpers/cdp-browser.js';
import { installFakeDriveSession } from '../helpers/fake-drive-session.js';
import { resetBufferLive } from '../helpers/reset-buffer.js';
import { pressRibbonTool } from '../helpers/ribbon-tool.js';

const EVID = path.resolve('.evidence/1003');
fs.mkdirSync(EVID, { recursive: true });

const row = (id, text) => console.log(`ROW ${id} | ${text}`);

function makeDoc(joints, shapes, constraints = [], parameters = []) {
  return {
    version: 3,
    hosts: {},
    geometry: {
      joints: [
        ['j_origin', { x: 0, y: 0, fixed: true, sketchId: 'sketch-1' }],
        ...Object.entries(joints).map(([id, [x, y, fixed]]) => [id, { x, y, fixed: !!fixed, sketchId: 'sketch-1' }]),
      ],
      shapes: shapes.map((s) => ({ sketchId: 'sketch-1', isConstruction: false, ...s })),
      constraints,
      parameters,
      sketches: [{ id: 'sketch-1', name: 'Sketch 1', visible: true }],
      activeSketchId: 'sketch-1',
      groups: [],
      profiles: [],
    },
  };
}

const HOST_CFG = {
  sketchstudio: { url: '/apps/sketchstudio/index.html', canvas: 'svgCanvas', enter: null },
  shaper: { url: '/apps/shaper/index.html', canvas: 'design-canvas', enter: null },
  penplotter: { url: '/apps/penplotter/index.html', canvas: 'design-canvas', enter: null },
  trace: { url: '/apps/trace/index.html', canvas: 'design-canvas', enter: `document.querySelector('.sk-header-tab[data-tab="edit"]')?.click()` },
};

async function openSeeded(cdp, host, doc) {
  const { port, evalJs, waitForApp, navigate } = cdp;
  const cfg = HOST_CFG[host];
  const url = `http://127.0.0.1:${port}${cfg.url}`;
  await resetBufferLive(cdp);
  await navigate(url, 12000);
  if (cfg.enter) {
    await sleep(300);
    await evalJs(cfg.enter);
  }
  await waitForApp(cfg.canvas);
  await evalJs(`import('/packages/ui/project-store.js').then(async (m) => { const s = m.getProjectStore(); const d = await s.newDesign('DimAudit 1003', { app: '${host}' }); await s.save(${JSON.stringify(doc)}, { app: '${host}', id: d.id }); })`);
  await navigate(url, 12000);
  if (cfg.enter) {
    await sleep(300);
    await evalJs(cfg.enter);
  }
  await waitForApp(cfg.canvas);
  await sleep(450);
}

async function setView(cdp, canvasId, cx, cy, vw) {
  await cdp.evalJs(`(() => {
    const svg = document.getElementById('${canvasId}');
    const r = svg.getBoundingClientRect();
    const vh = ${vw} / (r.width / r.height);
    svg.setAttribute('viewBox', (${cx} - ${vw}/2) + ' ' + (${cy} - vh/2) + ' ' + ${vw} + ' ' + vh);
  })()`);
  await sleep(150);
}

async function w2s(cdp, canvasId, wx, wy) {
  return cdp.evalJs(`(() => {
    const svg = document.getElementById('${canvasId}');
    const pt = svg.createSVGPoint(); pt.x = ${wx}; pt.y = ${wy};
    const p = pt.matrixTransform(svg.getScreenCTM());
    return { x: p.x, y: p.y };
  })()`);
}

async function captureClip(cdp, filename, clip) {
  const params = clip ? { format: 'png', clip: { ...clip, scale: 1 } } : { format: 'png' };
  const res = await cdp.send('Page.captureScreenshot', params);
  const fullPath = path.join(EVID, filename);
  fs.writeFileSync(fullPath, Buffer.from(res.data, 'base64'));
  return fullPath;
}

async function mouseClick(cdp, x, y, clicks = 1, button = 'left') {
  const rx = Math.round(x), ry = Math.round(y);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rx, y: ry, button: 'none', clickCount: 0 });
  await sleep(30);
  const btns = button === 'right' ? 2 : 1;
  for (let k = 1; k <= clicks; k++) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rx, y: ry, button, buttons: btns, clickCount: k });
    await sleep(30);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rx, y: ry, button, buttons: 0, clickCount: k });
    if (k < clicks) await sleep(60);
  }
  await sleep(200);
}

async function mouseDrag(cdp, a, b, steps = 14) {
  const ax = Math.round(a.x), ay = Math.round(a.y), bx = Math.round(b.x), by = Math.round(b.y);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: ax, y: ay, button: 'none', clickCount: 0 });
  await sleep(25);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: ax, y: ay, button: 'left', buttons: 1, clickCount: 1 });
  for (let k = 1; k <= steps; k++) {
    await sleep(16);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(ax + (bx - ax) * k / steps), y: Math.round(ay + (by - ay) * k / steps), button: 'left', buttons: 1, clickCount: 0 });
  }
  await sleep(25);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: bx, y: by, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(220);
}

async function touchTap(cdp, x, y, taps = 1) {
  const rx = Math.round(x), ry = Math.round(y);
  for (let k = 0; k < taps; k++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: rx, y: ry, id: 1, radiusX: 2, radiusY: 2, force: 1 }] });
    await sleep(45);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    if (k + 1 < taps) await sleep(90);
  }
  await sleep(220);
}

async function touchLongPress(cdp, x, y, ms = 620) {
  const rx = Math.round(x), ry = Math.round(y);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: rx, y: ry, id: 1, radiusX: 2, radiusY: 2, force: 1 }] });
  await sleep(ms);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(220);
}

async function touchDrag(cdp, a, b, steps = 12) {
  const ax = Math.round(a.x), ay = Math.round(a.y), bx = Math.round(b.x), by = Math.round(b.y);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: ax, y: ay, id: 1, radiusX: 2, radiusY: 2, force: 1 }] });
  for (let k = 1; k <= steps; k++) {
    await sleep(18);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: Math.round(ax + (bx - ax) * k / steps), y: Math.round(ay + (by - ay) * k / steps), id: 1, radiusX: 2, radiusY: 2, force: 1 }] });
  }
  await sleep(25);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(240);
}

// ─── DESKTOP 1280x800 ───────────────────────────────────────────────────────
async function runDesktop() {
  const cdp = await launchBrowser({
    tag: '1003-desktop',
    width: 1280,
    height: 800,
    args: ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost'],
  });
  if (!cdp) { row('L.desktop', 'skipped: no headless browser'); return; }
  try {
    await installFakeDriveSession(cdp);

    // L1: Visual showcase — angle arrows (90° wrong!), radius leader crossing text, narrow dim, ref parens, fx:
    const docVis = makeDoc(
      {
        a: [0, 0, true], b: [60, 0, true], c: [30, 51.9615],
        cc: [-45, 20, true],
        n1: [80, 0, true], n2: [85, 0, true],
        f1: [-65, -25, true], f2: [-15, -25, true],
      },
      [
        { id: 'L1', type: 'line', joints: ['a', 'b'] },
        { id: 'L2', type: 'line', joints: ['a', 'c'] },
        { id: 'C1', type: 'circle', joints: ['cc'], radius: 18 },
        { id: 'LN', type: 'line', joints: ['n1', 'n2'] },
        { id: 'LF', type: 'line', joints: ['f1', 'f2'] },
      ],
      [
        { type: 'angle', shapes: ['L1', 'L2'], value: 60, sector: { ray1: 1, ray2: 1, turn: 1 }, offset: 32, name: 'd1' },
        { type: 'distance', shape: 'C1', value: 18, isRadius: true, offset: 34, labelAngle: 0.35, name: 'd2' },
        { type: 'distance', joints: ['n1', 'n2'], value: 5, dimMode: 'horizontal', offset: -18, name: 'd3' },
        { type: 'distance', joints: ['f1', 'f2'], value: 50, dimMode: 'horizontal', offset: -15, isDriven: true, driven: true, name: 'd4' },
      ],
    );
    await openSeeded(cdp, 'sketchstudio', docVis);
    // Center view so BOTH angle (0..60, 0..52) and circle (-45, 20) sit squarely in the middle of the canvas!
    await setView(cdp, 'svgCanvas', 5, 20, 220);
    await sleep(250);
    // Measure actual rendered bounding box of radius text vs leader line in real Chrome!
    const visInfo = await cdp.evalJs(`(() => {
      const svg = document.getElementById('svgCanvas');
      const labels = [...svg.querySelectorAll('.dim-label')].map((g) => {
        const t = g.querySelector('text');
        const tr = t ? t.getBoundingClientRect() : null;
        return { idx: +g.dataset.constraintIdx, text: t ? t.textContent.trim() : '', rect: tr ? { x: Math.round(tr.left), y: Math.round(tr.top), w: Math.round(tr.width), h: Math.round(tr.height) } : null };
      });
      const radLine = svg.querySelector('line[data-constraint-idx="1"]');
      const lr = radLine ? radLine.getBoundingClientRect() : null;
      const radLbl = labels.find((l) => l.idx === 1);
      const leaderCrossesText = !!(lr && radLbl && radLbl.rect && lr.left < radLbl.rect.x + radLbl.rect.w && lr.right > radLbl.rect.x && lr.top < radLbl.rect.y + radLbl.rect.h && lr.bottom > radLbl.rect.y);
      const angPolys = [...svg.querySelectorAll('polygon[data-constraint-idx="0"]')].map((p) => p.getAttribute('points'));
      return { labels, leaderCrossesText, angPolysCount: angPolys.length };
    })()`);
    // Capture zoomed crops centered on actual rendered elements
    const angCenter = await w2s(cdp, 'svgCanvas', 22, 18);
    await captureClip(cdp, 'angle-arrows-desktop.png', { x: Math.max(0, Math.round(angCenter.x - 160)), y: Math.max(0, Math.round(angCenter.y - 140)), width: 340, height: 280 });
    const radLblRect = visInfo.labels.find((l) => l.idx === 1)?.rect;
    const radCenter = radLblRect ? { x: radLblRect.x, y: radLblRect.y } : await w2s(cdp, 'svgCanvas', -32, 26);
    await captureClip(cdp, 'radius-leader-desktop.png', { x: Math.max(0, Math.round(radCenter.x - 180)), y: Math.max(0, Math.round(radCenter.y - 120)), width: 340, height: 240 });
    row('L1.visual.desktop', JSON.stringify(visInfo));

    const clickTool = (tool) => pressRibbonTool(cdp.evalJs, (p) => mouseClick(cdp, p.x, p.y), `tool-${tool}`);

    // L2: Quick-type digit while placing ('4' then '5' then Enter -> expect 45, confirm stale rAF selects '4' so '5' overwrites it to 5!)
    const docQ = makeDoc({ a: [0, 0, true], b: [60, 0] }, [{ id: 'L1', type: 'line', joints: ['a', 'b'] }]);
    await openSeeded(cdp, 'sketchstudio', docQ);
    await setView(cdp, 'svgCanvas', 30, 0, 220);
    await clickTool('dim');
    const pLine = await w2s(cdp, 'svgCanvas', 30, 0);
    const pAbove = await w2s(cdp, 'svgCanvas', 30, -20);
    await mouseClick(cdp, pLine.x, pLine.y);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(pAbove.x), y: Math.round(pAbove.y), button: 'none', clickCount: 0 });
    await sleep(120);
    await sendRealKey(cdp.send, '4');
    await sleep(120);
    const midBox = await cdp.evalJs(`(() => { const i = document.getElementById('dimInput'); return { open: !i.classList.contains('hidden'), val: i.value, selStart: i.selectionStart, selEnd: i.selectionEnd, focused: document.activeElement === i }; })()`);
    await cdp.send('Input.insertText', { text: '5' });
    await sleep(80);
    const beforeEnter = await cdp.evalJs(`document.getElementById('dimInput').value`);
    await sendRealKey(cdp.send, 'Enter');
    await sleep(200);
    const finalLbl = await cdp.evalJs(`[...document.querySelectorAll('#svgCanvas .dim-label text')].map(t => t.textContent.trim())`);
    row('L2.quickType.desktop', JSON.stringify({ midBox, beforeEnter, finalLbl }));

    // L3: Label drag in Dimension tool vs Select tool!
    const docLD = makeDoc(
      { a: [0, 0, true], b: [60, 0] },
      [{ id: 'L1', type: 'line', joints: ['a', 'b'] }],
      [{ type: 'distance', joints: ['a', 'b'], value: 60, dimMode: 'horizontal', offset: 25, name: 'd1' }],
    );
    await openSeeded(cdp, 'sketchstudio', docLD);
    await setView(cdp, 'svgCanvas', 30, 10, 240);
    const lblRect0 = await cdp.evalJs(`(() => { const r = document.querySelector('#svgCanvas .dim-label text').getBoundingClientRect(); return { x: r.left + r.width/2, y: r.top + r.height/2 }; })()`);
    const vb0 = await cdp.evalJs(`document.getElementById('svgCanvas').getAttribute('viewBox')`);
    // Try dragging label in Dimension tool
    await clickTool('dim');
    await mouseDrag(cdp, lblRect0, { x: lblRect0.x + 80, y: lblRect0.y + 40 });
    const lblRectAfterDim = await cdp.evalJs(`(() => { const r = document.querySelector('#svgCanvas .dim-label text').getBoundingClientRect(); return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) }; })()`);
    const vbAfterDim = await cdp.evalJs(`document.getElementById('svgCanvas').getAttribute('viewBox')`);
    // Now drag label in Select tool
    await clickTool('select');
    const lblRectPreSel = await cdp.evalJs(`(() => { const r = document.querySelector('#svgCanvas .dim-label text').getBoundingClientRect(); return { x: r.left + r.width/2, y: r.top + r.height/2 }; })()`);
    await mouseDrag(cdp, lblRectPreSel, { x: lblRectPreSel.x + 80, y: lblRectPreSel.y + 40 });
    const lblRectAfterSel = await cdp.evalJs(`(() => { const r = document.querySelector('#svgCanvas .dim-label text').getBoundingClientRect(); return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) }; })()`);
    row('L3.labelDrag.desktop', JSON.stringify({
      start: { x: Math.round(lblRect0.x), y: Math.round(lblRect0.y) },
      afterDimToolDrag: lblRectAfterDim,
      pannedInDimTool: vbAfterDim !== vb0,
      afterSelectToolDrag: lblRectAfterSel,
    }));

    // L4: Auto-reference (task 1001: NO toast, parentheses visible) + H-ref toggle to Driving jump
    const docRef = makeDoc(
      { a: [0, 0, true], b: [60, 0, true], c: [0, 25, true], d: [30, 55] },
      [{ id: 'LF', type: 'line', joints: ['a', 'b'] }, { id: 'LD', type: 'line', joints: ['c', 'd'] }],
      [{ type: 'distance', joints: ['c', 'd'], value: 30, dimMode: 'horizontal', offset: 25, isDriven: true, driven: true, name: 'd1' }],
    );
    await openSeeded(cdp, 'sketchstudio', docRef);
    await setView(cdp, 'svgCanvas', 30, 30, 260);
    await clickTool('dim');
    const pFix = await w2s(cdp, 'svgCanvas', 30, 0);
    const pFixOff = await w2s(cdp, 'svgCanvas', 30, -15);
    await mouseClick(cdp, pFix.x, pFix.y);
    await mouseClick(cdp, pFixOff.x, pFixOff.y);
    const autoRefRes = await cdp.evalJs(`({
      toasts: [...document.querySelectorAll('#notification-container [data-level]')].map(e => e.textContent.trim()),
      labels: [...document.querySelectorAll('#svgCanvas .dim-label text')].map(t => t.textContent.trim()),
      boxOpen: !document.getElementById('dimInput').classList.contains('hidden'),
    })`);
    // Right-click (30) H-ref label -> Driving dimension (dispatch contextmenu as real browser right-click does)
    const pHref = await cdp.evalJs(`(() => { const t = [...document.querySelectorAll('#svgCanvas .dim-label text')].find(x => x.textContent.trim() === '(30)'); if (!t) return null; const r = t.getBoundingClientRect(); return { x: r.left + r.width/2, y: r.top + r.height/2 }; })()`);
    let drvClicked = false;
    if (pHref) {
      await mouseClick(cdp, pHref.x, pHref.y, 1, 'right');
      await sleep(150);
      drvClicked = await cdp.evalJs(`(() => { const b = document.querySelector('.sk-context-item[data-id="dim-driving"]'); if (!b) return false; b.click(); return true; })()`);
      await sleep(200);
    }
    const labelsAfterToggle = await cdp.evalJs(`[...document.querySelectorAll('#svgCanvas .dim-label text')].map(t => t.textContent.trim())`);
    row('L4.autoRefAndToggle.desktop', JSON.stringify({ autoRefRes, pHref, drvClicked, labelsAfterToggle }));

    // L5: All 4 hosts parity check (SketchStudio, Shaper, Pen Plotter, Trace Edit tab)
    const docH = makeDoc({ a: [0, 0, true], b: [60, 0] }, [{ id: 'L1', type: 'line', joints: ['a', 'b'] }]);
    for (const host of ['sketchstudio', 'shaper', 'penplotter', 'trace']) {
      const cid = HOST_CFG[host].canvas;
      await openSeeded(cdp, host, docH);
      await setView(cdp, cid, 30, 0, 180);
      await clickTool('dim');
      const active1 = await cdp.evalJs(`document.querySelector('#tool-dim')?.classList.contains('active')`);
      // Re-click #tool-dim (owner ruling: must stay active!)
      await clickTool('dim');
      const active2 = await cdp.evalJs(`document.querySelector('#tool-dim')?.classList.contains('active')`);
      // Click line (enters placing), then switch to Line tool -> check phantom dim label!
      const pL = await w2s(cdp, cid, 30, 0);
      await mouseClick(cdp, pL.x, pL.y);
      const pM = await w2s(cdp, cid, 30, -20);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(pM.x), y: Math.round(pM.y), button: 'none', clickCount: 0 });
      await sleep(100);
      await clickTool('line');
      await sleep(150);
      const phantomLabels = await cdp.evalJs(`[...document.querySelectorAll('#${cid} .dim-label text')].map(t => t.textContent.trim())`);
      if (host === 'sketchstudio') {
        const pCrop = await w2s(cdp, cid, 30, -10);
        await captureClip(cdp, 'phantom-dim-desktop.png', { x: Math.max(0, Math.round(pCrop.x - 200)), y: Math.max(0, Math.round(pCrop.y - 140)), width: 400, height: 280 });
      }
      row(`L5.host.${host}`, JSON.stringify({ active1, active2, phantomLabels }));
    }
  } finally {
    await cdp.close();
  }
}

// ─── PHONE 390x844 (TOUCH) ──────────────────────────────────────────────────
async function runPhone() {
  const cdp = await launchBrowser({
    tag: '1003-phone',
    width: 390,
    height: 844,
    args: ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost'],
  });
  if (!cdp) { row('L.phone', 'skipped: no headless browser'); return; }
  try {
    await installFakeDriveSession(cdp);
    const docP = makeDoc({ a: [0, 0, true], b: [60, 0] }, [{ id: 'L1', type: 'line', joints: ['a', 'b'] }]);
    const tapTool = (tool) => pressRibbonTool(cdp.evalJs, (p) => touchTap(cdp, p.x, p.y), `tool-${tool}`);
    await openSeeded(cdp, 'sketchstudio', docP);
    await setView(cdp, 'svgCanvas', 30, 0, 140);
    await tapTool('dim');
    const pL = await w2s(cdp, 'svgCanvas', 30, 0);
    const pOff = await w2s(cdp, 'svgCanvas', 30, -22);
    await touchTap(cdp, pL.x, pL.y);
    const placingAfterTap1 = await cdp.evalJs(`[...document.querySelectorAll('#svgCanvas .dim-label text')].map(t => t.textContent.trim())`);
    await touchTap(cdp, pOff.x, pOff.y);
    const editBoxPhone = await cdp.evalJs(`(() => {
      const i = document.getElementById('dimInput');
      const r = i.getBoundingClientRect();
      return { open: !i.classList.contains('hidden'), val: i.value, rect: { left: Math.round(r.left), top: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }, inViewport: r.left >= 0 && r.right <= 390 && r.top >= 0 && r.bottom <= 844 };
    })()`);
    await captureClip(cdp, 'phone-dim-edit.png', { x: 0, y: 120, width: 390, height: 520 });
    // Type 45 + Enter
    await cdp.evalJs(`(() => { const i = document.getElementById('dimInput'); i.focus(); i.select(); })()`);
    await sendRealKey(cdp.send, '4');
    await sendRealKey(cdp.send, '5');
    await sendRealKey(cdp.send, 'Enter');
    await sleep(220);
    const afterEditLbl = await cdp.evalJs(`[...document.querySelectorAll('#svgCanvas .dim-label text')].map(t => t.textContent.trim())`);

    // Try touch-dragging the label in Dimension tool vs Select tool
    const lblPt0 = await cdp.evalJs(`(() => { const r = document.querySelector('#svgCanvas .dim-label text').getBoundingClientRect(); return { x: r.left + r.width/2, y: r.top + r.height/2 }; })()`);
    await touchDrag(cdp, lblPt0, { x: lblPt0.x + 40, y: lblPt0.y - 50 });
    const lblPtAfterDim = await cdp.evalJs(`(() => { const r = document.querySelector('#svgCanvas .dim-label text').getBoundingClientRect(); return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) }; })()`);

    await tapTool('select');
    const lblPtPreSel = await cdp.evalJs(`(() => { const r = document.querySelector('#svgCanvas .dim-label text').getBoundingClientRect(); return { x: r.left + r.width/2, y: r.top + r.height/2 }; })()`);
    await touchDrag(cdp, lblPtPreSel, { x: lblPtPreSel.x + 40, y: lblPtPreSel.y - 50 });
    const lblPtAfterSel = await cdp.evalJs(`(() => { const r = document.querySelector('#svgCanvas .dim-label text').getBoundingClientRect(); return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) }; })()`);

    // Long-press on dim label -> context menu
    const lblPtMenu = await cdp.evalJs(`(() => { const r = document.querySelector('#svgCanvas .dim-label text').getBoundingClientRect(); return { x: r.left + r.width/2, y: r.top + r.height/2 }; })()`);
    await touchLongPress(cdp, lblPtMenu.x, lblPtMenu.y);
    const menuItems = await cdp.evalJs(`[...document.querySelectorAll('.sk-context-item')].map(e => e.dataset.id + ':' + e.textContent.trim())`);
    await captureClip(cdp, 'phone-dim-menu.png', { x: 0, y: 120, width: 390, height: 520 });
    row('L6.phone.touch', JSON.stringify({
      placingAfterTap1, editBoxPhone, afterEditLbl,
      dragDimTool: { from: { x: Math.round(lblPt0.x), y: Math.round(lblPt0.y) }, to: lblPtAfterDim },
      dragSelectTool: { from: { x: Math.round(lblPtPreSel.x), y: Math.round(lblPtPreSel.y) }, to: lblPtAfterSel },
      menuItems,
    }));
  } finally {
    await cdp.close();
  }
}

await runDesktop();
await runPhone();
process.exit(0);
