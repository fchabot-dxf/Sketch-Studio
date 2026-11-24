// tests/coincident-868-live.test.js — TASK 868: Live CDP tests (desktop 1280x800 + phone 390x844) in SketchStudio.
// Reproduces owner report 3380: offset rectangle + 2-pt rectangle corner (coincident twin pair j890/j892) NOT on inner bottom line ->
// Coincident tool, pick corner then inner bottom line -> adds pointOnLine, moves corner + twin onto bottom line (dist = 0),
// keeps Coincident tool active, supports opposite pick order (line then point) on an ordinary line, and shows a toast on redundant picks.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';
import { installFakeDriveSession } from './helpers/fake-drive-session.js';
import { resetBufferLive } from './helpers/reset-buffer.js';
import { pressRibbonTool } from './helpers/ribbon-tool.js';

const EVIDENCE_DIR = path.resolve('.evidence/868');
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

function makeOwnerDoc() {
  const joints = [['j_origin', { x: 0, y: 0, fixed: true, sketchId: 'sketch-1' }]];
  const shapes = [];
  const constraints = [];
  let seq = 480;
  const addJ = (id, x, y, fixed = false) => { joints.push([id, { x, y, sketchId: 'sketch-1', ...(fixed ? { fixed: true } : {}) }]); return id; };
  const addL = (id, a, b, gid) => { shapes.push({ id, type: 'line', joints: [a, b], sketchId: 'sketch-1', isConstruction: false, ...(gid ? { groupId: gid } : {}) }); return id; };
  const addRect = (prefix, x0, y0, x1, y1, gid, fixCorners = false) => {
    const pts = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
    const lines = [];
    for (let i = 0; i < 4; i++) {
      const a = addJ(`${prefix}_a${i}`, pts[i][0], pts[i][1], fixCorners && (i === 0 || i === 2));
      const b = addJ(`${prefix}_b${i}`, pts[(i + 1) % 4][0], pts[(i + 1) % 4][1], fixCorners && i === 2);
      const s = addL(`${prefix}_s${i}`, a, b, gid);
      lines.push({ s, a, b });
    }
    for (let i = 0; i < 4; i++) {
      constraints.push({ type: 'coincident', joints: [lines[i].b, lines[(i + 1) % 4].a] });
      constraints.push({ type: i % 2 === 0 ? 'horizontal' : 'vertical', joints: [lines[i].a, lines[i].b] });
    }
    return lines;
  };
  // Scaled down comfortably to fit desktop & phone canvas cleanly at default zoom while preserving owner structure:
  // inner offset loop: [-80, -45] .. [80, 45]; rect B: [-25, -55] .. [15, 45] (first corner (-25, -55) 10 mm BELOW bottom line y=-45)
  const inner = addRect('in', -80, -45, 80, 45, 'offset_482', true);
  const rectB = addRect('rb', -25, -55, 15, 45, 'rect_486', false);
  constraints.push({ type: 'pointOnLine', joint: rectB[1].b, shape: inner[2].s });
  // Ordinary free line + free point
  const o1 = addJ('o1', -50, 75, true), o2 = addJ('o2', 50, 75, true);
  addL('s_ord', o1, o2);
  addJ('p_free', 5, 62);
  return {
    doc: {
      version: 3,
      hosts: {},
      geometry: {
        joints,
        shapes,
        constraints,
        sketches: [{ id: 'sketch-1', name: 'Sketch 1', visible: true }],
        activeSketchId: 'sketch-1',
        groups: [],
        profiles: [],
        parameters: [],
      },
    },
    innerBottom: inner[0].s,
    j890: rectB[0].a,
    j892: rectB[3].b,
    ordLine: 's_ord',
    freePt: 'p_free',
  };
}

async function run({ width, height, tag }) {
  const label = `${width}x${height}`;
  const isPhone = width <= 640;
  const cdp = await launchBrowser({ tag: `868-coincident-${tag}`, width, height });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
  const { port, send, evalJs, waitFor, waitForApp, navigate, flushAutosave, close } = cdp;

  const clickPt = async (p) => {
    if (isPhone) {
      await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: Math.round(p.x), y: Math.round(p.y), id: 1, radiusX: 1, radiusY: 1, force: 1 }] });
      await sleep(60);
      await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(p.x), y: Math.round(p.y), button: 'none', clickCount: 0 });
      await sleep(50);
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: Math.round(p.x), y: Math.round(p.y), button: 'left', buttons: 1, clickCount: 1 });
      await sleep(40);
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: Math.round(p.x), y: Math.round(p.y), button: 'left', buttons: 0, clickCount: 1 });
    }
    await sleep(160);
  };

  const screenOfJoint = (jid) => evalJs(`(() => {
    const e = document.querySelector('#svgCanvas circle.joint-handle[data-joint-id=' + ${JSON.stringify(jid)} + ']');
    if (!e) return null;
    const p = new DOMPoint(+e.getAttribute('cx'), +e.getAttribute('cy')).matrixTransform(e.getScreenCTM());
    return { x: Math.round(p.x), y: Math.round(p.y), wx: +e.getAttribute('cx'), wy: +e.getAttribute('cy') };
  })()`);

  const screenOfLine = (sid, t = 0.72) => evalJs(`(() => {
    const e = document.querySelector('#svgCanvas line.shape-elem[data-shape-id=' + ${JSON.stringify(sid)} + ']');
    if (!e) return null;
    const x1 = +e.getAttribute('x1'), y1 = +e.getAttribute('y1'), x2 = +e.getAttribute('x2'), y2 = +e.getAttribute('y2');
    const p = new DOMPoint(x1 + (x2 - x1) * ${t}, y1 + (y2 - y1) * ${t}).matrixTransform(e.getScreenCTM());
    return { x: Math.round(p.x), y: Math.round(p.y), y1, y2 };
  })()`);

  const shotBox = async (name) => {
    const r = await evalJs(`(() => {
      const m = document.querySelector('#svgCanvas .shape-elem')?.getScreenCTM();
      if (!m) return { x: 0, y: 0, width: ${width}, height: ${height} };
      const a = new DOMPoint(-95, -75).matrixTransform(m);
      const b = new DOMPoint(95, 85).matrixTransform(m);
      const x = Math.max(0, Math.round(Math.min(a.x, b.x) - 12));
      const y = Math.max(0, Math.round(Math.min(a.y, b.y) - 12));
      return { x, y, width: Math.min(${width} - x, Math.round(Math.abs(b.x - a.x) + 24)), height: Math.min(${height} - y, Math.round(Math.abs(b.y - a.y) + 24)) };
    })()`);
    const { data } = await send('Page.captureScreenshot', { format: 'png', clip: { ...r, scale: 2 } });
    fs.writeFileSync(path.join(EVIDENCE_DIR, name), Buffer.from(data, 'base64'));
    console.log('screenshot', path.join(EVIDENCE_DIR, name));
  };

  try {
    await installFakeDriveSession(cdp);
    await send('Page.addScriptToEvaluateOnNewDocument', {
      source: `window.__errs = []; window.addEventListener('error', (e) => window.__errs.push(e.message || 'error'));`,
    });
    if (isPhone) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: true });
      await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    }
    await resetBufferLive(cdp);
    const url = `http://127.0.0.1:${port}/apps/sketchstudio/index.html`;
    await navigate(url, 8000);
    await waitForApp('svgCanvas');

    const { doc, innerBottom, j890, j892, ordLine, freePt } = makeOwnerDoc();
    await evalJs(`import('/packages/ui/project-store.js').then(async (m) => { const s = m.getProjectStore(); const d = await s.newDesign('Task 868', { app: 'sketchstudio' }); await s.save(${JSON.stringify(doc)}, { app: 'sketchstudio', id: d.id }); })`);
    await navigate(url, 8000);
    await waitForApp('svgCanvas');
    await waitFor(`!!document.querySelector('#svgCanvas line.shape-elem[data-shape-id="${innerBottom}"]')`, 'seeded lines rendered');
    await sleep(300);

    const pickCornerScreen = () => evalJs(`(() => {
      const e = document.querySelector('#svgCanvas line.shape-elem[data-shape-id="rb_s0"]');
      if (!e) return null;
      const wx = +e.getAttribute('x1'), wy = +e.getAttribute('y1');
      const p = new DOMPoint(wx, wy).matrixTransform(e.getScreenCTM());
      return { x: Math.round(p.x), y: Math.round(p.y), wx, wy };
    })()`);
    const beforeCorner = await pickCornerScreen();
    const beforeBot = await screenOfLine(innerBottom);
    assert.ok(beforeCorner && beforeBot && Math.abs(beforeCorner.wy - beforeBot.y1) > 5, `[${label}] initial corner separated from bottom line: ${JSON.stringify({ beforeCorner, beforeBot })}`);
    if (!isPhone) await shotBox('coincident-before-desktop.png');

    // Click Coincident in the ribbon
    await pressRibbonTool(evalJs, clickPt, 'tool-coincident');
    await waitFor(`document.getElementById('tool-coincident')?.classList.contains('active')`, 'Coincident tool active');

    // Pick 1: corner j892/j890; Pick 2: inner offset bottom line (away from rect B right edge)
    await clickPt(await pickCornerScreen());
    await clickPt(await screenOfLine(innerBottom, 0.72));

    // Read persisted constraints & live coordinates via flushAutosave
    await flushAutosave();
    const afterState = await evalJs(`import('/packages/ui/project-store.js').then(async (m) => {
      const cur = await m.getProjectStore().loadCurrent({ app: 'sketchstudio' });
      const g = cur.document.geometry;
      const jm = Object.fromEntries(g.joints);
      const pol = g.constraints.filter((c) => c.type === 'pointOnLine' && c.shape === ${JSON.stringify(innerBottom)} && (c.joint === ${JSON.stringify(j890)} || c.joint === ${JSON.stringify(j892)}));
      const toolActive = document.getElementById('tool-coincident')?.classList.contains('active');
      return { toolActive, polCount: pol.length, y890: jm[${JSON.stringify(j890)}]?.y, y892: jm[${JSON.stringify(j892)}]?.y, botY: jm[g.shapes.find((s) => s.id === ${JSON.stringify(innerBottom)}).joints[0]]?.y };
    })`);

    assert.strictEqual(afterState.toolActive, true, `[${label}] Coincident tool stayed active after point+line pick`);
    assert.strictEqual(afterState.polCount, 1, `[${label}] pointOnLine constraint created (${JSON.stringify(afterState)})`);
    const dist892 = Math.abs(afterState.y892 - afterState.botY);
    const dist890 = Math.abs(afterState.y890 - afterState.botY);
    assert.ok(dist892 < 1e-3 && dist890 < 1e-3, `[${label}] corner & twin lie on inner bottom line (dist892=${dist892}, dist890=${dist890})`);

    await shotBox(`coincident-after-${tag}.png`);

    // Redundant pick: clicking corner + bottom line again tells user via notice (never silent)
    await evalJs(`document.querySelectorAll('#notification-container [data-level]').forEach((e) => e.remove())`);
    await clickPt(await pickCornerScreen());
    await clickPt(await screenOfLine(innerBottom, 0.72));
    await waitFor(`document.querySelectorAll('#notification-container [data-level]').length >= 1`, 'redundant pick showed notice');

    // Opposite order: click ordinary line first, then free point at (5, 62) -> adds pointOnLine and moves point onto ordinary line
    await clickPt(await screenOfLine(ordLine, 0.5));
    const freePtScreen = await evalJs(`(() => {
      const e = document.querySelector('#svgCanvas line.shape-elem[data-shape-id]');
      if (!e) return null;
      const p = new DOMPoint(5, 62).matrixTransform(e.getScreenCTM());
      return { x: Math.round(p.x), y: Math.round(p.y) };
    })()`);
    await clickPt(freePtScreen);
    await flushAutosave();
    const ordCheck = await evalJs(`import('/packages/ui/project-store.js').then(async (m) => {
      const cur = await m.getProjectStore().loadCurrent({ app: 'sketchstudio' });
      const g = cur.document.geometry;
      const jm = Object.fromEntries(g.joints);
      const hasPol = g.constraints.some((c) => c.type === 'pointOnLine' && c.joint === ${JSON.stringify(freePt)} && c.shape === ${JSON.stringify(ordLine)});
      return { hasPol, yFree: jm[${JSON.stringify(freePt)}]?.y };
    })`);
    assert.ok(ordCheck.hasPol && Math.abs(ordCheck.yFree - 75) < 1e-3, `[${label}] line-then-point constrained and moved free point (${JSON.stringify(ordCheck)})`);

    const errs = await evalJs(`window.__errs`);
    assert.deepStrictEqual(errs, [], `[${label}] no uncaught page errors`);
    console.log(`[${label}] PASS`);
  } finally {
    await close();
  }
}

await run({ width: 1280, height: 800, tag: 'desktop' });
await run({ width: 390, height: 844, tag: 'phone' });
