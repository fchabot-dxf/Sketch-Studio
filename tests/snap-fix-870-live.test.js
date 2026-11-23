// tests/snap-fix-870-live.test.js -- TASK 870 (live headless SketchStudio via CDP, desktop 1280x800 mouse + phone 390x844 touch):
// the Circle rim, the Polygon vertex and the 3-point arc Slot's arc point keep the click's snap (audit 869 causes C, D, E). Each click is 4 px OFF its target.
//  1. Circle: rim near a line's end point -> the rim passes exactly through it, and a point-on-circle holds it.
//  2. Polygon: a vertex near a line mid-span -> the vertex is ON the line, held by a point-on-line.
//  3. 3-point arc slot: the arc point near a line's end point -> that point is held on the slot's centre arc.
// Screenshots (cropped) saved to .evidence/870/.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser, sleep, sendRealKey } from './helpers/cdp-browser.js';
import { resetBufferLive } from './helpers/reset-buffer.js';
import { pressRibbonTool } from './helpers/ribbon-tool.js';
import { installFakeDriveSession } from './helpers/fake-drive-session.js';

const EVID = process.env.EVIDENCE_DIR || fileURLToPath(new URL('../.evidence/870', import.meta.url));
const norm = (t) => String(t).replace(/[-_]/g, '').toLowerCase();

function distPointToSeg(p, a, b) {
  const vx = b.x - a.x, vy = b.y - a.y;
  const len2 = vx * vx + vy * vy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2)) : 0;
  return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy));
}

await (async () => {
  const cdp = await launchBrowser({ tag: '870', width: 1280, height: 800 });
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

      const OFF = 4;   // px: the hand never hits the pixel
      const near = (p, dy = OFF) => ({ x: p.x, y: p.y + dy });
      const drawBaseLine = async (name) => {
        await startFreshDesign(name);
        await pressRibbonTool(evalJs, tap, 'tool-line');
        await tap(await toScreen(lx0, ly));
        await tap(await toScreen(lx1, ly));
        await sendRealKey(send, 'Escape', 'Escape', 27);
        await sleep(150);
        await waitFor(`document.querySelectorAll('#svgCanvas line.shape-elem').length >= 1`, `[${kind}] base line DOM`);
        const geo = await readDoc();
        const line = geo.shapes.find((s) => s.type === 'line');
        assert.ok(line, `[${kind}] base line created`);
        return line;
      };
      const selectSlotVariant = async (mode) => {
        await pressRibbonTool(evalJs, tap, 'tool-slot');
        await waitFor(`!!document.querySelector('.sk-ribbon-menu.show .sk-ribbon-menu-item[data-mode="${mode}"]')`, `[${kind}] slot variant menu`);
        const item = await evalJs(`(() => { const r = document.querySelector('.sk-ribbon-menu.show .sk-ribbon-menu-item[data-mode="${mode}"]').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
        await tap(item);
        await sleep(150);
      };

      await startFreshDesign('SnapFix870_' + kind);
      const vb = await evalJs(`(() => { const v = document.getElementById('svgCanvas').viewBox.baseVal; return { x: v.x, y: v.y, w: v.width, h: v.height }; })()`);
      const wx = (f) => +(vb.x + vb.w * f + 0.037).toFixed(3);
      const wy = (f) => +(vb.y + vb.h * f - 0.041).toFixed(3);
      const lx0 = wx(0.18), lx1 = wx(0.82), ly = wy(0.32);
      const box = { x1: vb.x + vb.w * 0.1, y1: vb.y + vb.h * 0.2, x2: vb.x + vb.w * 0.9, y2: vb.y + vb.h * 0.8 };

      // 1. circle
      {
        const line = await drawBaseLine('SnapFix870_circle_' + kind);
        const before = (await readDoc()).constraints.length;
        await pressRibbonTool(evalJs, tap, 'tool-circle');
        await tap(await toScreen(wx(0.5), wy(0.7)));
        await tap(near(await toScreen(lx1, ly)));
        const geo = await readDoc();
        const j = new Map(geo.joints);
        const circ = geo.shapes.find((s) => s.type === 'circle');
        assert.ok(circ, `[${kind}] circle made`);
        const c = j.get(circ.joints[0]), e = j.get(line.joints[1]);
        const d = Math.hypot(e.x - c.x, e.y - c.y);
        assert.ok(Math.abs(d - circ.radius) < 1e-3, `[${kind}] circle rim passes through the end point (r=${circ.radius}, d=${d})`);
        const pol = geo.constraints.slice(before).filter((k) => norm(k.type) === 'pointonline' && k.joint === line.joints[1] && k.shape === circ.id);
        assert.strictEqual(pol.length, 1, `[${kind}] the end point is held on the circle`);
        if (!phone) await shot('870-desktop-circle-rim.png', box);
      }

      // 2. polygon
      {
        const line = await drawBaseLine('SnapFix870_polygon_' + kind);
        const before = (await readDoc()).constraints.length;
        await pressRibbonTool(evalJs, tap, 'tool-polygon');
        await tap(await toScreen(wx(0.5), wy(0.7)));
        await tap(near(await toScreen(wx(0.4), ly)));
        const geo = await readDoc();
        const j = new Map(geo.joints);
        const edges = geo.shapes.filter((s) => s.type === 'line' && s.id !== line.id && !s.isConstruction);
        assert.ok(edges.length >= 3, `[${kind}] polygon made`);
        const pols = geo.constraints.slice(before).filter((k) => norm(k.type) === 'pointonline' && k.shape === line.id);
        assert.strictEqual(pols.length, 1, `[${kind}] the polygon vertex has a point-on-line on the line`);
        const v = j.get(pols[0].joint);
        const dv = distPointToSeg(v, j.get(line.joints[0]), j.get(line.joints[1]));
        assert.ok(dv < 1e-3, `[${kind}] polygon vertex lies on the line (dist=${dv})`);
        if (!phone) await shot('870-desktop-polygon-vertex.png', box);
      }

      // 3. 3-point arc slot
      {
        const line = await drawBaseLine('SnapFix870_slot_' + kind);
        const before = (await readDoc()).constraints.length;
        await selectSlotVariant('slot-arc-3pt');
        await tap(await toScreen(wx(0.25), wy(0.75)));
        await tap(await toScreen(wx(0.75), wy(0.75)));
        await tap(near(await toScreen(lx1, ly)));   // the arc point, near the line's end point
        await tap(await toScreen(wx(0.5), wy(0.45)));   // the width
        const geo = await readDoc();
        const arcIds = new Set(geo.shapes.filter((s) => s.type === 'arc').map((s) => s.id));
        assert.ok(arcIds.size >= 1, `[${kind}] slot made`);
        const pol = geo.constraints.slice(before).filter((k) => norm(k.type) === 'pointonline' && k.joint === line.joints[1] && arcIds.has(k.shape));
        assert.strictEqual(pol.length, 1, `[${kind}] the arc point (the line's end point) is held on the slot's arc`);
        if (!phone) await shot('870-desktop-slot-arc-point.png', box);
      }
      console.log(`870 ${kind}: ok`);
    }
    console.log('snap-fix-870-live.test.js: ok');
  } finally {
    await cdp.close();
  }
})();
