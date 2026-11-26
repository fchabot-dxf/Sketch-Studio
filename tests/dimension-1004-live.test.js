// tests/dimension-1004-live.test.js — TASK 1004 live Chromium guarding test (Desktop 1280x800 + Phone 390x844 touch)
// Guards browser-rAF quick-type D-1 ('4'+'5'+Enter -> '45', not '5') and B-7/D-20 mid-placement tool switch across all 4 hosts + phone touch.
import assert from 'node:assert/strict';
import { launchBrowser, sleep, sendRealKey } from './helpers/cdp-browser.js';
import { installFakeDriveSession } from './helpers/fake-drive-session.js';
import { resetBufferLive } from './helpers/reset-buffer.js';
import { pressRibbonTool } from './helpers/ribbon-tool.js';

function makeDoc(joints, shapes, constraints = []) {
  return {
    version: 3, hosts: {},
    geometry: {
      joints: [
        ['j_origin', { x: 0, y: 0, fixed: true, sketchId: 'sketch-1' }],
        ...Object.entries(joints).map(([id, [x, y, fixed]]) => [id, { x, y, fixed: !!fixed, sketchId: 'sketch-1' }]),
      ],
      shapes: shapes.map((s) => ({ sketchId: 'sketch-1', isConstruction: false, ...s })),
      constraints, parameters: [],
      sketches: [{ id: 'sketch-1', name: 'Sketch 1', visible: true }],
      activeSketchId: 'sketch-1', groups: [], profiles: [],
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
  if (cfg.enter) { await sleep(300); await evalJs(cfg.enter); }
  await waitForApp(cfg.canvas);
  await evalJs(`import('/packages/ui/project-store.js').then(async (m) => { const s = m.getProjectStore(); const d = await s.newDesign('DimFix 1004', { app: '${host}' }); await s.save(${JSON.stringify(doc)}, { app: '${host}', id: d.id }); })`);
  await navigate(url, 12000);
  if (cfg.enter) { await sleep(300); await evalJs(cfg.enter); }
  await waitForApp(cfg.canvas);
  await sleep(400);
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

async function mouseClick(cdp, x, y) {
  const rx = Math.round(x), ry = Math.round(y);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rx, y: ry, button: 'none', clickCount: 0 });
  await sleep(30);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rx, y: ry, button: 'left', buttons: 1, clickCount: 1 });
  await sleep(30);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rx, y: ry, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(180);
}

async function touchTap(cdp, x, y) {
  const rx = Math.round(x), ry = Math.round(y);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: rx, y: ry, id: 1, radiusX: 2, radiusY: 2, force: 1 }] });
  await sleep(45);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(200);
}

const docLine = makeDoc({ a: [0, 0, true], b: [60, 0] }, [{ id: 'L1', type: 'line', joints: ['a', 'b'] }]);

// ─── DESKTOP 1280x800 ───────────────────────────────────────────────────────
{
  const cdp = await launchBrowser({
    tag: '1004-desktop',
    width: 1280,
    height: 800,
    args: ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost'],
  });
  if (!cdp) { console.log('SKIP: no headless Chrome/Edge installed'); process.exit(0); }
  try {
    await installFakeDriveSession(cdp);
    const clickTool = (tool) => pressRibbonTool(cdp.evalJs, (p) => mouseClick(cdp, p.x, p.y), `tool-${tool}`);

    // 1. D-1: Quick-type '4' then '5' + Enter while placing in real Chrome -> must be 45, not 5!
    await openSeeded(cdp, 'sketchstudio', docLine);
    await setView(cdp, 'svgCanvas', 30, 0, 200);
    await clickTool('dim');
    const pLine = await w2s(cdp, 'svgCanvas', 30, 0);
    const pAbove = await w2s(cdp, 'svgCanvas', 30, -20);
    await mouseClick(cdp, pLine.x, pLine.y);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(pAbove.x), y: Math.round(pAbove.y), button: 'none', clickCount: 0 });
    await sleep(100);
    await sendRealKey(cdp.send, '4');
    await sleep(120); // let rAF run
    const midBox = await cdp.evalJs(`(() => { const i = document.getElementById('dimInput'); return { open: !i.classList.contains('hidden'), val: i.value, selStart: i.selectionStart, selEnd: i.selectionEnd, focused: document.activeElement === i }; })()`);
    assert.equal(midBox.open, true, 'D-1 live: edit box opened on first digit');
    assert.equal(midBox.val, '4', 'D-1 live: first digit is 4');
    assert.equal(midBox.selStart, 1, 'D-1 live: caret at end (not selecting 0..1)');
    assert.equal(midBox.selEnd, 1, 'D-1 live: selection collapsed at end');
    await cdp.send('Input.insertText', { text: '5' });
    await sleep(80);
    await sendRealKey(cdp.send, 'Enter');
    await sleep(200);
    const finalLbl = await cdp.evalJs(`[...document.querySelectorAll('#svgCanvas .dim-label text')].map(t => t.textContent.trim())`);
    assert.deepEqual(finalLbl, ['45'], 'D-1 live: typing 4 then 5 sets dimension to 45 (not 5)');
    console.log('PASS D-1 live desktop');

    // 2. B-7 / D-20: Mid-placement ribbon switch leaves 0 phantom labels in ALL 4 hosts!
    for (const host of ['sketchstudio', 'shaper', 'penplotter', 'trace']) {
      const cid = HOST_CFG[host].canvas;
      await openSeeded(cdp, host, docLine);
      await setView(cdp, cid, 30, 0, 200);
      await clickTool('dim');
      const pL = await w2s(cdp, cid, 30, 0);
      await mouseClick(cdp, pL.x, pL.y);
      const pM = await w2s(cdp, cid, 30, -20);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(pM.x), y: Math.round(pM.y), button: 'none', clickCount: 0 });
      await sleep(100);
      const placingLabels = await cdp.evalJs(`[...document.querySelectorAll('#${cid} .dim-label text')].map(t => t.textContent.trim())`);
      assert.equal(placingLabels.length, 1, `B-7 live [${host}]: placing preview label visible before switch`);
      await clickTool('line');
      await sleep(150);
      const afterSwitchLabels = await cdp.evalJs(`[...document.querySelectorAll('#${cid} .dim-label text')].map(t => t.textContent.trim())`);
      assert.deepEqual(afterSwitchLabels, [], `B-7 live [${host}]: 0 phantom dimension labels after switching to Line`);
      console.log(`PASS B-7 live desktop [${host}]`);
    }
  } finally {
    await cdp.close();
  }
}

// ─── PHONE 390x844 TOUCH ────────────────────────────────────────────────────
{
  const cdp = await launchBrowser({
    tag: '1004-phone',
    width: 390,
    height: 844,
    args: ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost'],
  });
  if (cdp) {
    try {
      await installFakeDriveSession(cdp);
      const tapTool = (tool) => pressRibbonTool(cdp.evalJs, (p) => touchTap(cdp, p.x, p.y), `tool-${tool}`);
      await openSeeded(cdp, 'sketchstudio', docLine);
      await setView(cdp, 'svgCanvas', 30, 0, 140);
      await tapTool('dim');
      const pL = await w2s(cdp, 'svgCanvas', 30, 0);
      await touchTap(cdp, pL.x, pL.y);
      const placingLabels = await cdp.evalJs(`[...document.querySelectorAll('#svgCanvas .dim-label text')].map(t => t.textContent.trim())`);
      assert.equal(placingLabels.length, 1, 'B-7 phone: placing label visible after tap 1');
      await tapTool('line');
      await sleep(150);
      const afterSwitchLabels = await cdp.evalJs(`[...document.querySelectorAll('#svgCanvas .dim-label text')].map(t => t.textContent.trim())`);
      assert.deepEqual(afterSwitchLabels, [], 'B-7 phone: 0 phantom dimension labels after tapping Line tool');
      console.log('PASS B-7 live phone 390x844');
    } finally {
      await cdp.close();
    }
  }
}

console.log('ALL dimension-1004-live tests PASSED');
process.exit(0);
