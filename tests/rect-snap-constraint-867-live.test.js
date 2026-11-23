// tests/rect-snap-constraint-867-live.test.js -- TASK 867 (live headless SketchStudio via CDP, desktop 1280x800 mouse + phone 390x844 touch):
//  1. Draw a line (off-grid), start a 2-point rectangle with its first corner on the line (mid-span, not endpoint/midpoint), finish it:
//     the corner lies on the line (dist ~ 0) and a pointOnLine constraint exists; dragging the line moves the corner along with it.
//  2. Center rectangle with its center on the line (mid-span): pointOnLine exists on the center joint and follows when the line is dragged.
// Screenshots (cropped) saved to .evidence/867/.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser, sleep, sendRealKey } from './helpers/cdp-browser.js';
import { resetBufferLive } from './helpers/reset-buffer.js';
import { pressRibbonTool } from './helpers/ribbon-tool.js';
import { installFakeDriveSession } from './helpers/fake-drive-session.js';

const EVID = process.env.EVIDENCE_DIR || fileURLToPath(new URL('../.evidence/867', import.meta.url));
const norm = (t) => String(t).replace(/[-_]/g, '').toLowerCase();

function distPointToSeg(p, a, b) {
  const vx = b.x - a.x, vy = b.y - a.y;
  const len2 = vx * vx + vy * vy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2)) : 0;
  return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy));
}

await (async () => {
  const cdp = await launchBrowser({ tag: '867', width: 1280, height: 800 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  await installFakeDriveSession(cdp);
  const { port, send, evalJs, waitFor, navigate, waitForApp, flushAutosave } = cdp;
  try {
    fs.mkdirSync(EVID, { recursive: true });
    const mouse = (type, x, y, buttons) => send('Input.dispatchMouseEvent', { type, x: Math.round(x), y: Math.round(y), button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
    const touch = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: Math.round(p.x), y: Math.round(p.y), id: i + 1, radiusX: 1, radiusY: 1, force: 1 })) });

    for (const kind of ['desktop', 'phone']) {
      const phone = kind === 'phone';
      await send('Emulation.setDeviceMetricsOverride', phone ? { width: 390, height: 844, deviceScaleFactor: 2, mobile: true } : { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
      await send('Emulation.setTouchEmulationEnabled', { enabled: phone, maxTouchPoints: phone ? 5 : 0 });

      const move = async (p) => { if (!phone) { await mouse('mouseMoved', p.x, p.y, 0); await sleep(80); } };
      const tap = async (p) => {
        if (phone) { await touch('touchStart', [p]); await sleep(60); await touch('touchEnd', []); await sleep(260); }
        else { await mouse('mouseMoved', p.x, p.y, 0); await sleep(60); await mouse('mousePressed', p.x, p.y, 1); await sleep(40); await mouse('mouseReleased', p.x, p.y, 0); await sleep(220); }
      };
      const drag = async (a, b) => {
        if (phone) {
          await touch('touchStart', [a]); await sleep(60);
          for (let i = 1; i <= 10; i++) { await touch('touchMove', [{ x: a.x + (b.x - a.x) * i / 10, y: a.y + (b.y - a.y) * i / 10 }]); await sleep(25); }
          await touch('touchEnd', []); await sleep(350);
        } else {
          await mouse('mouseMoved', a.x, a.y, 0); await sleep(60);
          await mouse('mousePressed', a.x, a.y, 1); await sleep(40);
          for (let i = 1; i <= 10; i++) { await mouse('mouseMoved', a.x + (b.x - a.x) * i / 10, a.y + (b.y - a.y) * i / 10, 1); await sleep(25); }
          await mouse('mouseReleased', b.x, b.y, 0); await sleep(350);
        }
      };
      const selectRectVariant = async (mode) => {
        await pressRibbonTool(evalJs, tap, 'tool-rect');
        await waitFor(`!!document.querySelector('.sk-ribbon-menu.show .sk-ribbon-menu-item[data-mode="${mode}"]')`, `[${kind}] rect variant menu`);
        const item = await evalJs(`(() => { const r = document.querySelector('.sk-ribbon-menu.show .sk-ribbon-menu-item[data-mode="${mode}"]').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
        await tap(item);
        await sleep(150);
      };
      const readDoc = async () => {
        await flushAutosave();
        return evalJs(`import('/packages/ui/project-store.js').then(async (m) => { const d = await m.getProjectStore().loadCurrent(); return JSON.stringify(d && d.document && d.document.geometry); })`).then((s) => (s ? JSON.parse(s) : null));
      };
      const toScreen = (wx, wy) => evalJs(`import('/packages/ui/coords.js').then((c) => { const p = c.worldToScreen(document.getElementById('svgCanvas'), { x: ${wx}, y: ${wy} }); return { x: Math.round(p.x), y: Math.round(p.y) }; })`);
      const shot = async (file, worldBox) => {
        const a = await toScreen(worldBox.x1, worldBox.y1), b = await toScreen(worldBox.x2, worldBox.y2);
        const clip = {
          x: Math.max(0, Math.min(a.x, b.x) - 35),
          y: Math.max(0, Math.min(a.y, b.y) - 35),
          width: Math.max(120, Math.abs(b.x - a.x) + 70),
          height: Math.max(120, Math.abs(b.y - a.y) + 70),
          scale: 2,
        };
        const r = await send('Page.captureScreenshot', { format: 'png', clip });
        fs.writeFileSync(path.join(EVID, file), Buffer.from(r.data, 'base64'));
      };
      const startFreshDesign = async (name) => {
        await resetBufferLive(cdp);
        await navigate(`http://127.0.0.1:${port}/apps/sketchstudio/index.html`, 8000);
        await waitForApp('svgCanvas');
        await evalJs(`(async () => { localStorage.setItem('sketch-studio-settings', JSON.stringify({ GRID_MAGNETISM: 0.001 })); const m = await import('/packages/ui/project-store.js'); await m.getProjectStore().newDesign(${JSON.stringify(name)}, { app: 'sketchstudio' }); return true; })()`);
        await navigate(`http://127.0.0.1:${port}/apps/sketchstudio/index.html`, 8000);
        await waitForApp('svgCanvas');
        await sleep(400);
      };

      await startFreshDesign('RectSnap867_' + kind);
      const vb = await evalJs(`(() => { const v = document.getElementById('svgCanvas').viewBox.baseVal; return { x: v.x, y: v.y, w: v.width, h: v.height }; })()`);
      const wx = (f) => +(vb.x + vb.w * f + 0.037).toFixed(3);
      const wy = (f) => +(vb.y + vb.h * f - 0.041).toFixed(3);
      const lx0 = wx(0.18), lx1 = wx(0.82), ly = wy(0.32);
      const rc1x = wx(0.33), rc2x = wx(0.68), rc2y = wy(0.68);
      const dragX = wx(0.74), dragY1 = wy(0.54);
      const box = { x1: vb.x + vb.w * 0.1, y1: vb.y + vb.h * 0.2, x2: vb.x + vb.w * 0.9, y2: vb.y + vb.h * 0.8 };

      // 1. Draw an off-grid horizontal base line (lx0, ly) -> (lx1, ly)
      await pressRibbonTool(evalJs, tap, 'tool-line');
      await tap(await toScreen(lx0, ly));
      await tap(await toScreen(lx1, ly));
      await sendRealKey(send, 'Escape', 'Escape', 27);
      await sleep(150);
      await waitFor(`document.querySelectorAll('#svgCanvas line.shape-elem').length >= 1`, `[${kind}] base line DOM`);

      let geo0 = await readDoc();
      const baseLine = geo0.shapes.find((s) => s.type === 'line');
      assert.ok(baseLine, `[${kind}] base line created`);

      // 2. 2-point rectangle with FIRST corner mid-span on baseLine at (rc1x, ly), opposite corner at (rc2x, rc2y)
      await selectRectVariant('rect-2pt');
      const pCorner1 = await toScreen(rc1x, ly);
      await move(pCorner1);
      await tap(pCorner1);
      await tap(await toScreen(rc2x, rc2y));

      let geo1 = await readDoc();
      const jMap1 = new Map(geo1.joints);
      const rect1Lines = geo1.shapes.filter((s) => s.type === 'line' && s.groupId && s.groupId.startsWith('rect_'));
      assert.strictEqual(rect1Lines.length, 4, `[${kind}] 2pt rect has 4 sides`);
      const firstCornerId = rect1Lines[0].joints[0];
      const pol1 = geo1.constraints.filter((c) => norm(c.type) === 'pointonline' && c.joint === firstCornerId && c.shape === baseLine.id);
      assert.strictEqual(pol1.length, 1, `[${kind}] 2pt rect first corner gets 1 pointOnLine on baseLine`);
      const d1 = distPointToSeg(jMap1.get(firstCornerId), jMap1.get(baseLine.joints[0]), jMap1.get(baseLine.joints[1]));
      assert.ok(d1 < 1e-3, `[${kind}] 2pt rect first corner lies on baseLine (dist=${d1})`);

      if (!phone) await shot('867-desktop-2pt-snapped.png', box);

      // 3. Drag the baseLine down to dragY1 via Select tool -> first corner follows
      const yBefore = jMap1.get(firstCornerId).y;
      await pressRibbonTool(evalJs, tap, 'tool-select');
      await drag(await toScreen(dragX, ly), await toScreen(dragX, dragY1));

      let geo2 = await readDoc();
      const jMap2 = new Map(geo2.joints);
      const yAfter = jMap2.get(firstCornerId).y;
      const d2 = distPointToSeg(jMap2.get(firstCornerId), jMap2.get(baseLine.joints[0]), jMap2.get(baseLine.joints[1]));
      assert.ok(Math.abs(yAfter - yBefore) > 0.3, `[${kind}] dragging baseLine moves first corner (${yBefore.toFixed(2)} -> ${yAfter.toFixed(2)})`);
      assert.ok(d2 < 1e-3, `[${kind}] first corner stays on baseLine after drag (dist=${d2})`);
      await shot(`867-${kind}-2pt-after-drag.png`, box);

      // 4. Desktop only: center rectangle with center snapped mid-span onto a fresh line
      if (!phone) {
        await startFreshDesign('RectSnap867_center');

        await pressRibbonTool(evalJs, tap, 'tool-line');
        await tap(await toScreen(lx0, ly));
        await tap(await toScreen(lx1, ly));
        await sendRealKey(send, 'Escape', 'Escape', 27);
        await sleep(150);

        const geoC0 = await readDoc();
        const lineC = geoC0.shapes.find((s) => s.type === 'line');
        const beforeC = geoC0.constraints.length;

        await selectRectVariant('rect-center');
        await tap(await toScreen(rc1x, ly)); // center mid-span on lineC
        await tap(await toScreen(wx(0.52), wy(0.56)));

        const geoC1 = await readDoc();
        const jMapC1 = new Map(geoC1.joints);
        const polC = geoC1.constraints.slice(beforeC).filter((c) => norm(c.type) === 'pointonline' && c.shape === lineC.id);
        assert.strictEqual(polC.length, 1, 'center rect: center snapped on line gets 1 pointOnLine');
        const centerId = polC[0].joint;
        const cyBefore = jMapC1.get(centerId).y;
        assert.ok(distPointToSeg(jMapC1.get(centerId), jMapC1.get(lineC.joints[0]), jMapC1.get(lineC.joints[1])) < 1e-3, 'center lies on line');

        await pressRibbonTool(evalJs, tap, 'tool-select');
        await drag(await toScreen(dragX, ly), await toScreen(dragX, dragY1));
        const geoC2 = await readDoc();
        const jMapC2 = new Map(geoC2.joints);
        const cyAfter = jMapC2.get(centerId).y;
        assert.ok(Math.abs(cyAfter - cyBefore) > 0.3, `center rect: dragging line moves center (${cyBefore.toFixed(2)} -> ${cyAfter.toFixed(2)})`);
        assert.ok(distPointToSeg(jMapC2.get(centerId), jMapC2.get(lineC.joints[0]), jMapC2.get(lineC.joints[1])) < 1e-3, 'center stays on line after drag');
        await shot('867-desktop-center-after-drag.png', box);
      }
      console.log(`867 ${kind}: ok`);
    }
    console.log('rect-snap-constraint-867-live.test.js: ok');
  } finally {
    await cdp.close();
  }
})();
