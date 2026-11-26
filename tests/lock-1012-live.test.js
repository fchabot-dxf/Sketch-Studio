// tests/lock-1012-live.test.js — TASK 1012 live Chromium guarding test (Desktop 1280x800 + Phone 390x844 touch)
// Guards Lock button / context menu path for UX-06 (Circle + Arc lock keeps centre & radius, green stroke,
// rim drag immovable, Unlock restores drag) and UX-26 (filleted locked line shows green + "Unlock" in context menu).
import assert from 'node:assert/strict';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';
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
  sketchstudio: { url: '/apps/sketchstudio/index.html', canvas: 'svgCanvas' },
  shaper: { url: '/apps/shaper/index.html', canvas: 'design-canvas' },
};

async function openSeeded(cdp, host, doc) {
  const { port, evalJs, waitForApp, navigate } = cdp;
  const cfg = HOST_CFG[host];
  const url = `http://127.0.0.1:${port}${cfg.url}`;
  await resetBufferLive(cdp);
  await navigate(url, 12000);
  await waitForApp(cfg.canvas);
  await evalJs(`import('/packages/ui/project-store.js').then(async (m) => { const s = m.getProjectStore(); const d = await s.newDesign('Lock 1012', { app: '${host}' }); await s.save(${JSON.stringify(doc)}, { app: '${host}', id: d.id }); })`);
  await navigate(url, 12000);
  await waitForApp(cfg.canvas);
  await sleep(400);
}

async function w2s(cdp, canvasId, wx, wy) {
  return cdp.evalJs(`(() => {
    const svg = document.getElementById('${canvasId}');
    const pt = svg.createSVGPoint(); pt.x = ${wx}; pt.y = ${wy};
    const p = pt.matrixTransform(svg.getScreenCTM());
    return { x: p.x, y: p.y };
  })()`);
}

async function mouseClick(cdp, x, y, button = 'left') {
  const rx = Math.round(x), ry = Math.round(y);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rx, y: ry, button: 'none', clickCount: 0 });
  await sleep(30);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rx, y: ry, button, buttons: button === 'right' ? 2 : 1, clickCount: 1 });
  await sleep(30);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rx, y: ry, button, buttons: 0, clickCount: 1 });
  await sleep(180);
}

async function mouseDrag(cdp, from, to, steps = 8) {
  const ax = Math.round(from.x), ay = Math.round(from.y);
  const bx = Math.round(to.x), by = Math.round(to.y);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: ax, y: ay, button: 'none', clickCount: 0 });
  await sleep(40);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: ax, y: ay, button: 'left', buttons: 1, clickCount: 1 });
  await sleep(40);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(ax + (bx - ax) * t), y: Math.round(ay + (by - ay) * t), button: 'left', buttons: 1, clickCount: 0 });
    await sleep(25);
  }
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: bx, y: by, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(200);
}

async function touchTap(cdp, x, y) {
  const rx = Math.round(x), ry = Math.round(y);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: rx, y: ry, id: 1, radiusX: 2, radiusY: 2, force: 1 }] });
  await sleep(45);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(200);
}

async function touchDrag(cdp, from, to, steps = 8) {
  const ax = Math.round(from.x), ay = Math.round(from.y);
  const bx = Math.round(to.x), by = Math.round(to.y);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: ax, y: ay, id: 1, radiusX: 3, radiusY: 3, force: 1 }] });
  await sleep(45);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: Math.round(ax + (bx - ax) * t), y: Math.round(ay + (by - ay) * t), id: 1, radiusX: 3, radiusY: 3, force: 1 }] });
    await sleep(30);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(220);
}

async function readShapeInfo(cdp, canvasId, shapeId) {
  return cdp.evalJs(`(() => {
    const el = document.querySelector('#${canvasId} [data-shape-id="${shapeId}"]');
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { stroke: cs.stroke, style: el.getAttribute('style'), r: el.tagName.toLowerCase() === 'circle' ? Number(el.getAttribute('r')) : null, d: el.getAttribute('d') || null };
  })()`);
}

async function readContextLockItem(cdp) {
  return cdp.evalJs(`(() => {
    const item = document.querySelector('.sk-context-menu [data-id="geo-lock"]');
    if (!item) return null;
    const r = item.getBoundingClientRect();
    return { text: item.textContent.trim(), x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);
}

const docCircleArc = makeDoc(
  { cc: [0, 0], ac: [60, 0], as: [80, 0], ae: [60, 20] },
  [
    { id: 'C1', type: 'circle', joints: ['cc'], radius: 20 },
    { id: 'A1', type: 'arc', joints: ['ac', 'as', 'ae'], sweep: true },
  ],
  [{ type: 'equal', joints: ['ac', 'as', 'ac', 'ae'] }],
);

// Seed a pre-filleted locked L-corner directly (matches applyFillet on locked L1=[a,b], L2=[b,c] with R=10)
const docFilletedLocked = makeDoc(
  {
    a: [0, 0, true], b: [60, 0, true], c: [60, 50, true],
    jc: [50, 10, false], jta: [50, 0, false], jtb: [60, 10, false],
  },
  [
    { id: 'L1', type: 'line', joints: ['a', 'jta'] },
    { id: 'L2', type: 'line', joints: ['jtb', 'c'] },
    { id: 'AF1', type: 'arc', joints: ['jc', 'jta', 'jtb'], sweep: true, filletSharp: 'b' },
  ],
  [
    { type: 'equal', joints: ['jc', 'jta', 'jc', 'jtb'] },
    { type: 'pointOnLine', joint: 'b', shape: 'L1' },
    { type: 'pointOnLine', joint: 'b', shape: 'L2' },
    { type: 'tangent', line: 'L1', circle: 'AF1' },
    { type: 'tangent', line: 'L2', circle: 'AF1' },
    { type: 'distance', shape: 'AF1', value: 10, isRadius: true, name: 'd1', offset: 6 },
  ],
);

// ─── DESKTOP 1280x800 ───────────────────────────────────────────────────────
{
  const cdp = await launchBrowser({
    tag: '1012-desktop',
    width: 1280,
    height: 800,
    args: ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost'],
  });
  if (!cdp) { console.log('SKIP: no headless Chrome/Edge installed'); process.exit(0); }
  try {
    await installFakeDriveSession(cdp);
    for (const host of ['sketchstudio', 'shaper']) {
      const cid = HOST_CFG[host].canvas;
      const clickRibbon = (id) => pressRibbonTool(cdp.evalJs, (p) => mouseClick(cdp, p.x, p.y), id);

      // 1. UX-06 Circle: right-click -> Lock -> green + rim drag immovable -> right-click -> Unlock -> rim drags!
      await openSeeded(cdp, host, docCircleArc);
      const pRim = await w2s(cdp, cid, 20, 0);
      const pOut = await w2s(cdp, cid, 35, 0);
      const pEmpty = await w2s(cdp, cid, 35, 10);

      await mouseClick(cdp, pRim.x, pRim.y, 'right');
      const lockItem = await readContextLockItem(cdp);
      assert.ok(lockItem && /Lock/i.test(lockItem.text) && !/Unlock/i.test(lockItem.text), `UX-06 [${host}]: context menu offers Lock before locking, got ${JSON.stringify(lockItem)}`);
      await mouseClick(cdp, lockItem.x, lockItem.y);
      await mouseClick(cdp, pEmpty.x, pEmpty.y); // deselect so rest color is visible

      const lockedCircle = await readShapeInfo(cdp, cid, 'C1');
      assert.equal(lockedCircle.stroke, 'rgb(141, 184, 74)', `UX-06 [${host}]: locked circle must be green, got ${JSON.stringify(lockedCircle)} pRim=${JSON.stringify(pRim)} pEmpty=${JSON.stringify(pEmpty)}`);

      await mouseDrag(cdp, pRim, pOut, 10);
      const afterDrag = await readShapeInfo(cdp, cid, 'C1');
      assert.ok(Math.abs(afterDrag.r - 20) < 0.05, `UX-06 [${host}]: locked circle rim drag must keep r=20, got ${afterDrag.r}`);

      // Right-click locked circle -> shows Unlock -> click Unlock -> rim drags
      await mouseClick(cdp, pRim.x, pRim.y, 'right');
      const unlockItem = await readContextLockItem(cdp);
      assert.ok(unlockItem && /Unlock/i.test(unlockItem.text), `UX-06 [${host}]: context menu offers Unlock on locked circle, got ${JSON.stringify(unlockItem)}`);
      await mouseClick(cdp, unlockItem.x, unlockItem.y);
      await mouseClick(cdp, pEmpty.x, pEmpty.y);
      await mouseDrag(cdp, pRim, pOut, 10);
      const afterUnlockDrag = await readShapeInfo(cdp, cid, 'C1');
      assert.ok(afterUnlockDrag.r > 30, `UX-06 [${host}]: unlocked circle rim drag must resize >30, got ${afterUnlockDrag.r}`);

      // 2. UX-06 Arc via ribbon Lock button (#btn-lock)
      const pArcMid = await w2s(cdp, cid, 60 + 20 * Math.SQRT1_2, 20 * Math.SQRT1_2);
      const pArcOut = await w2s(cdp, cid, 60 + 32 * Math.SQRT1_2, 32 * Math.SQRT1_2);
      await mouseClick(cdp, pArcMid.x, pArcMid.y);
      await clickRibbon('btn-lock');
      await mouseClick(cdp, pEmpty.x, pEmpty.y);
      const lockedArc = await readShapeInfo(cdp, cid, 'A1');
      assert.equal(lockedArc.stroke, 'rgb(141, 184, 74)', `UX-06 [${host}]: locked arc must be green, got ${lockedArc.stroke}`);
      await mouseDrag(cdp, pArcMid, pArcOut, 10);
      const arcAfterDrag = await readShapeInfo(cdp, cid, 'A1');
      assert.equal(arcAfterDrag.d, lockedArc.d, `UX-06 [${host}]: locked arc path must not change on rim drag`);
      console.log(`PASS UX-06 live desktop [${host}]`);

      // 3. UX-26: Filleted locked lines render green + context menu offers Unlock (fillet arc black)
      await openSeeded(cdp, host, docFilletedLocked);
      const l1Info = await readShapeInfo(cdp, cid, 'L1');
      const arcInfo = await readShapeInfo(cdp, cid, 'AF1');
      assert.equal(l1Info.stroke, 'rgb(141, 184, 74)', `UX-26 [${host}]: filleted locked L1 must render green, got ${l1Info.stroke}`);
      assert.match(arcInfo.style, /--sk-geo-fixed|#202020/i, `UX-26 [${host}]: fillet arc must use constrained fixed-geo ink (not locked green), got ${arcInfo.style}`);
      assert.notEqual(arcInfo.stroke, 'rgb(141, 184, 74)', `UX-26 [${host}]: fillet arc must not render locked green`);
      const pL1 = await w2s(cdp, cid, 25, 0);
      await mouseClick(cdp, pL1.x, pL1.y, 'right');
      const l1Item = await readContextLockItem(cdp);
      assert.ok(l1Item && /Unlock/i.test(l1Item.text), `UX-26 [${host}]: context menu on filleted locked L1 must offer Unlock, got ${JSON.stringify(l1Item)}`);
      console.log(`PASS UX-26 live desktop [${host}]`);
    }
  } finally {
    await cdp.close();
  }
}

// ─── PHONE 390x844 TOUCH ────────────────────────────────────────────────────
{
  const cdp = await launchBrowser({
    tag: '1012-phone',
    width: 390,
    height: 844,
    args: ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost'],
  });
  if (cdp) {
    try {
      await installFakeDriveSession(cdp);
      const tapRibbon = (id) => pressRibbonTool(cdp.evalJs, (p) => touchTap(cdp, p.x, p.y), id);
      await openSeeded(cdp, 'sketchstudio', docCircleArc);
      const pRim = await w2s(cdp, 'svgCanvas', 20, 0);
      const pOut = await w2s(cdp, 'svgCanvas', 34, 0);
      const pEmpty = await w2s(cdp, 'svgCanvas', 35, 10);

      await touchTap(cdp, pRim.x, pRim.y);
      await tapRibbon('btn-lock');
      await touchTap(cdp, pEmpty.x, pEmpty.y);

      const lockedCircle = await readShapeInfo(cdp, 'svgCanvas', 'C1');
      assert.equal(lockedCircle.stroke, 'rgb(141, 184, 74)', `UX-06 phone: locked circle must be green, got ${lockedCircle.stroke}`);

      await touchDrag(cdp, pRim, pOut, 10);
      const afterDrag = await readShapeInfo(cdp, 'svgCanvas', 'C1');
      assert.ok(Math.abs(afterDrag.r - 20) < 0.05, `UX-06 phone: locked circle touch rim drag must keep r=20, got ${afterDrag.r}`);
      console.log('PASS UX-06 live phone 390x844');
    } finally {
      await cdp.close();
    }
  }
}

console.log('ALL lock-1012-live tests PASSED');
process.exit(0);
