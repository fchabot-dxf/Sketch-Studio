// tests/midpoint-arc-875-live.test.js — TASK 875: Midpoint of an ARC in the real SketchStudio page, desktop 1280x800 (mouse) and phone 390x844
// (touch). The Midpoint tool from the ribbon, a point (a line's end), then the arc: the point jumps to the arc's sweep midpoint and the arc stays
// (as Fusion: addMidPoint(point, arc) moved the free point to the arc's middle). The Select tool then drags the arc's END round past a 180 deg
// sweep: the point follows, at the middle of the arc as drawn. The stored design is read after each step; the oracle is ANGULAR (#core/geometry.js
// arcSweepInfo: start angle + dir * span / 2 at the start radius). EVIDENCE_875=<dir> saves cropped screenshots (before / after the midpoint /
// after the drag) there.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';
import { installFakeDriveSession } from './helpers/fake-drive-session.js';
import { resetBufferLive } from './helpers/reset-buffer.js';
import { pressRibbonTool } from './helpers/ribbon-tool.js';
import { arcSweepInfo } from '#core/geometry.js';

const EVIDENCE = process.env.EVIDENCE_875 || null;
const R = 40, rad = (d) => (d * Math.PI) / 180;
const doc = {
  version: 3, hosts: {},
  geometry: {
    joints: [['j_origin', { x: 0, y: 0, fixed: true, sketchId: 'sketch-1' }],
      ['c', { x: 0, y: 0, sketchId: 'sketch-1' }], ['s', { x: R, y: 0, sketchId: 'sketch-1' }], ['e', { x: R * Math.cos(rad(120)), y: R * Math.sin(rad(120)), sketchId: 'sketch-1' }],
      ['a', { x: 75, y: 55, sketchId: 'sketch-1' }], ['p', { x: 55, y: 40, sketchId: 'sketch-1' }]],
    shapes: [{ id: 'ar', type: 'arc', subType: 'CENTER', joints: ['c', 's', 'e'], sweep: true, sketchId: 'sketch-1', isConstruction: false },
      { id: 'ln', type: 'line', joints: ['a', 'p'], sketchId: 'sketch-1', isConstruction: false }],
    constraints: [{ type: 'equal', joints: ['c', 's', 'c', 'e'] }], sketches: [{ id: 'sketch-1', name: 'Sketch 1', visible: true }], activeSketchId: 'sketch-1', groups: [], profiles: [], parameters: [],
  },
};
// the arc's sweep midpoint, angular, from a stored document
function sweepMid(g) {
  const J = Object.fromEntries(g.joints), arc = g.shapes.find((s) => s.id === 'ar');
  const [c, s, e] = arc.joints.map((id) => J[id]);
  const info = arcSweepInfo(c, s, e, { sweep: arc.sweep }), t = info.a0 + info.dir * info.span / 2, r = Math.hypot(s.x - c.x, s.y - c.y);
  return { x: c.x + r * Math.cos(t), y: c.y + r * Math.sin(t), span: (info.span * 180) / Math.PI };
}

async function run({ width, height, tag }) {
  const label = `${width}x${height}`, isPhone = width <= 640;
  const cdp = await launchBrowser({ tag: `875-${tag}`, width, height });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
  const { port, send, evalJs, waitFor, waitForApp, navigate, flushAutosave, close } = cdp;
  const T = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((q, i) => ({ x: Math.round(q.x), y: Math.round(q.y), id: i + 1, radiusX: 1, radiusY: 1, force: 1 })) });
  const M = (type, q, buttons = 0) => send('Input.dispatchMouseEvent', { type, x: Math.round(q.x), y: Math.round(q.y), button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
  const tap = async (q) => {
    if (isPhone) { await T('touchStart', [q]); await sleep(60); await T('touchEnd', []); }
    else { await M('mouseMoved', q); await sleep(50); await M('mousePressed', q, 1); await sleep(40); await M('mouseReleased', q); }
    await sleep(250);
  };
  const drag = async (pts) => {
    if (isPhone) { await T('touchStart', [pts[0]]); await sleep(80); for (const q of pts.slice(1)) { await T('touchMove', [q]); await sleep(30); } await T('touchEnd', []); }
    else { await M('mouseMoved', pts[0]); await sleep(60); await M('mousePressed', pts[0], 1); for (const q of pts.slice(1)) { await M('mouseMoved', q, 1); await sleep(30); } await M('mouseReleased', pts[pts.length - 1]); }
    await sleep(400);
  };
  // world -> screen through the arc's own element (the canvas's world transform)
  const toScreen = (pts) => evalJs(`(() => { const e = document.querySelector('#svgCanvas path.shape-elem[data-shape-id="ar"]'); const m = e.getScreenCTM();
    return ${JSON.stringify(pts)}.map((q) => { const p = new DOMPoint(q.x, q.y).matrixTransform(m); return { x: p.x, y: p.y }; }); })()`);
  const read = async () => { await flushAutosave(); return evalJs(`import('/packages/ui/project-store.js').then(async (m) => (await m.getProjectStore().loadCurrent({ app: 'sketchstudio' })).document.geometry)`); };
  const at = (g, id) => { const j = Object.fromEntries(g.joints)[id]; return { x: j.x, y: j.y }; };
  const dist = (u, v) => Math.hypot(u.x - v.x, u.y - v.y);
  const shot = async (name) => {
    if (!EVIDENCE) return;
    const box = await evalJs(`(() => { const r = document.querySelector('#svgCanvas path.shape-elem[data-shape-id="ar"]').getBoundingClientRect(), l = document.querySelector('#svgCanvas line.shape-elem[data-shape-id="ln"]').getBoundingClientRect();
      const x0 = Math.min(r.left, l.left) - 40, y0 = Math.min(r.top, l.top) - 40, x1 = Math.max(r.right, l.right) + 40, y1 = Math.max(r.bottom, l.bottom) + 40; return { x: Math.max(0, x0), y: Math.max(0, y0), w: x1 - Math.max(0, x0), h: y1 - Math.max(0, y0) }; })()`);
    const png = await send('Page.captureScreenshot', { format: 'png', clip: { x: box.x, y: box.y, width: box.w, height: box.h, scale: 2 } });
    fs.mkdirSync(EVIDENCE, { recursive: true });
    fs.writeFileSync(path.join(EVIDENCE, `${tag}-${name}.png`), Buffer.from(png.data, 'base64'));
  };
  try {
    await installFakeDriveSession(cdp);
    if (isPhone) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: true });
      await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    }
    await resetBufferLive(cdp);
    const url = `http://127.0.0.1:${port}/apps/sketchstudio/index.html`;
    await navigate(url, 8000); await waitForApp('svgCanvas');
    await evalJs(`import('/packages/ui/project-store.js').then(async (m) => { const s = m.getProjectStore(); const d = await s.newDesign('Task 875', { app: 'sketchstudio' }); await s.save(${JSON.stringify(doc)}, { app: 'sketchstudio', id: d.id }); })`);
    await navigate(url, 8000); await waitForApp('svgCanvas');
    await waitFor(`!!document.querySelector('#svgCanvas path.shape-elem[data-shape-id="ar"]') && !!document.querySelector('#svgCanvas line.shape-elem[data-shape-id="ln"]')`, 'seeded arc and line rendered');
    await sleep(300);
    const g0 = await read();
    await shot('1-before');

    // Midpoint: the point (the line's end p), then the arc
    await pressRibbonTool(evalJs, tap, 'tool-midpoint');
    await waitFor(`document.getElementById('tool-midpoint')?.classList.contains('active')`, 'Midpoint tool active');
    const [pP, pArc] = await toScreen([at(g0, 'p'), { x: R * Math.cos(rad(25)), y: R * Math.sin(rad(25)) }]);
    await tap(pP);
    await tap(pArc);
    const g1 = await read();
    const mid = g1.constraints.find((k) => k.type === 'midpoint');
    assert.ok(mid && mid.joint === 'p' && mid.shape === 'ar' && !mid.joints, `[${label}] a point then the arc made the arc midpoint { joint: p, shape: ar }: ${JSON.stringify(g1.constraints)}`);
    const want1 = sweepMid(g1);
    assert.ok(dist(at(g1, 'p'), want1) < 1e-3, `[${label}] the point jumped to the arc middle: ${JSON.stringify(at(g1, 'p'))} vs ${JSON.stringify(want1)}`);
    assert.ok(dist(at(g1, 'p'), { x: R * Math.cos(rad(60)), y: R * Math.sin(rad(60)) }) < 1e-3, `[${label}] ... at 60 deg (the 0 - 120 deg arc's middle)`);
    for (const id of ['c', 's', 'e']) assert.ok(dist(at(g1, id), at(g0, id)) < 1e-6, `[${label}] the arc stayed (${id}: the point gave way, as in Fusion)`);
    console.log(`[${label}] midpoint made: p at (${at(g1, 'p').x.toFixed(4)}, ${at(g1, 'p').y.toFixed(4)}), the arc middle (${want1.x.toFixed(4)}, ${want1.y.toFixed(4)})`);
    await shot('2-after-midpoint');

    // the Select tool drags the arc's END round to 230 deg (the sweep passes 180): the point follows
    await pressRibbonTool(evalJs, tap, 'tool-select');
    await waitFor(`document.getElementById('tool-select')?.classList.contains('active')`, 'Select tool active');
    const path230 = [];
    for (let a = 120; a <= 230; a += 5) path230.push({ x: R * Math.cos(rad(a)), y: R * Math.sin(rad(a)) });
    await drag(await toScreen([at(g1, 'e'), ...path230]));
    const g2 = await read();
    const want2 = sweepMid(g2);
    assert.ok(want2.span > 180, `[${label}] the drag took the arc past a 180 deg sweep (${want2.span.toFixed(2)} deg)`);
    assert.ok(dist(at(g2, 'e'), at(g1, 'e')) > 10, `[${label}] the arc end moved: ${JSON.stringify(at(g2, 'e'))}`);
    assert.ok(dist(at(g2, 'p'), want2) < 1e-3, `[${label}] after the drag the point is at the arc middle: ${JSON.stringify(at(g2, 'p'))} vs ${JSON.stringify(want2)}`);
    assert.ok(g2.constraints.some((k) => k.type === 'midpoint' && k.joint === 'p' && k.shape === 'ar'), `[${label}] the midpoint is still there`);
    console.log(`[${label}] after the drag: sweep ${want2.span.toFixed(2)} deg, p at (${at(g2, 'p').x.toFixed(4)}, ${at(g2, 'p').y.toFixed(4)}), the arc middle (${want2.x.toFixed(4)}, ${want2.y.toFixed(4)})`);
    await shot('3-after-drag');
    console.log(`[${label}] PASS`);
  } finally { await close(); }
}
await run({ width: 1280, height: 800, tag: 'desktop' });
await run({ width: 390, height: 844, tag: 'phone' });
