// tests/live-box-canvas-697-live.test.js -- TASK 697 (live headless; REAL mouse 1280x800 + REAL phone touch 390x844; SketchStudio + Pen Plotter):
// the live value boxes of the drawing tools (placeLiveBox in packages/ui/numeric-input-manager.js) stay INSIDE the canvas svg's rect, near each of the
// 4 canvas edges: never over the footer bar, the ribbon or the side rail. 602's touch dock (top centre) holds on the phone.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sendRealKey } from './helpers/cdp-browser.js';
import { resetBufferLive } from './helpers/reset-buffer.js';
import { pressRibbonTool } from './helpers/ribbon-tool.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const EVID = process.env.EVIDENCE_DIR || path.join(process.cwd(), '.evidence', '697');
const HOSTS = [
  { name: 'sketchstudio', url: '/apps/sketchstudio/index.html', canvas: '#svgCanvas' },
  { name: 'penplotter', url: '/apps/penplotter/index.html', canvas: '#design-canvas', enter: `document.querySelector('.sk-header-tab[data-tab="design"]').click()` },
];
const TOOLS = ['tool-line', 'tool-rect', 'tool-circle'];
const overlap = (a, b) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;

await (async () => {
  const cdp = await launchBrowser({ tag: '697', width: 1280, height: 800 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, waitFor, navigate } = cdp;
  try {
    fs.mkdirSync(EVID, { recursive: true });
    const mouse = (type, x, y, buttons) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
    const T = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i + 1, radiusX: 1, radiusY: 1, force: 1 })) });
    const shot = async (file, clip) => {
      const r = await send('Page.captureScreenshot', { format: 'png', clip: { x: Math.max(0, Math.round(clip.x)), y: Math.max(0, Math.round(clip.y)), width: Math.round(clip.w), height: Math.round(clip.h), scale: 2 } });
      fs.writeFileSync(path.join(EVID, file), Buffer.from(r.data, 'base64'));
    };
    const failures = [];

    for (const kind of ['mouse', 'touch']) {
      const phone = kind === 'touch';
      for (const h of HOSTS) {
        await send('Emulation.setDeviceMetricsOverride', phone ? { width: 390, height: 844, deviceScaleFactor: 2, mobile: true } : { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
        await send('Emulation.setTouchEmulationEnabled', { enabled: phone, maxTouchPoints: phone ? 5 : 0 });
        const tap = async (p) => {
          if (phone) { await T('touchStart', [p]); await sleep(60); await T('touchEnd', []); await sleep(280); }
          else { await mouse('mouseMoved', p.x, p.y, 0); await sleep(50); await mouse('mousePressed', p.x, p.y, 1); await sleep(40); await mouse('mouseReleased', p.x, p.y, 0); await sleep(220); }
        };
        await resetBufferLive(cdp);
        await navigate(`http://127.0.0.1:${port}${h.url}`, 8000);
        await waitFor(`!!document.querySelector('.sk-ribbon .sk-ribbon-btn') && !!document.querySelector('${h.canvas}')`, `[${kind} ${h.name}] ribbon`);
        if (h.enter) await evalJs(h.enter);
        await waitFor(`document.querySelector('${h.canvas}').getBoundingClientRect().width > 0`, `[${kind} ${h.name}] canvas`);
        await sleep(400);
        const cr = await evalJs(`(() => { const r = document.querySelector('${h.canvas}').getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; })()`);
        const cx = Math.round(cr.l + cr.w / 2), cy = Math.round(cr.t + cr.h / 2);
        const edges = [
          { name: 'right', p1: { x: cx, y: cy }, p2: { x: cr.r - 3, y: cy } },
          { name: 'bottom', p1: { x: cx, y: cy }, p2: { x: cx, y: cr.b - 3 } },
          { name: 'left', p1: { x: cx, y: cy }, p2: { x: cr.l + 3, y: cy } },
          { name: 'top', p1: { x: cx, y: cy }, p2: { x: cx, y: cr.t + 3 } },
        ];
        for (const tool of TOOLS) for (const edge of edges) {
          const label = `[${kind} ${h.name} ${tool} ${edge.name}]`;
          await sendRealKey(send, 'Escape', 'Escape', 27); await sleep(120);
          await pressRibbonTool(evalJs, tap, tool);
          await sleep(150);
          await tap(edge.p1);
          // the second point: a mouse hovers there (the box follows the cursor); a finger would tap (the box is docked, the tap draws): measure BEFORE it, the box is docked from the first tap
          if (!phone) { await mouse('mouseMoved', edge.p2.x, edge.p2.y, 0); await sleep(120); await mouse('mouseMoved', edge.p2.x, edge.p2.y, 0); await sleep(120); }
          const m = await evalJs(`(() => {
            const norm = (r) => r ? { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height } : null;
            const boxes = [...document.querySelectorAll('.sk-live-box')].filter((e) => e.getClientRects().length && getComputedStyle(e).display !== 'none').map((e) => norm(e.getBoundingClientRect()));
            const foot = document.querySelector('.sk-footer') || document.querySelector('footer');
            return { boxes, footer: foot ? norm(foot.getBoundingClientRect()) : null, canvas: norm(document.querySelector('${h.canvas}').getBoundingClientRect()), vw: innerWidth, sw: document.documentElement.scrollWidth };
          })()`);
          console.log(label, JSON.stringify(m));
          if (m.boxes.length !== 1) { failures.push(`${label} expected 1 box, got ${m.boxes.length}`); continue; }
          const box = m.boxes[0];
          const eps = 0.5;
          if (!(box.l >= m.canvas.l - eps && box.r <= m.canvas.r + eps && box.t >= m.canvas.t - eps && box.b <= m.canvas.b + eps)) failures.push(`${label} box outside canvas: box=${JSON.stringify(box)} canvas=${JSON.stringify(m.canvas)}`);
          if (m.footer && overlap(box, m.footer)) failures.push(`${label} box over the footer: box=${JSON.stringify(box)} footer=${JSON.stringify(m.footer)}`);
          if (m.sw > m.vw) failures.push(`${label} page widened: scrollWidth ${m.sw} > ${m.vw}`);
          if (phone) {
            const dockL = m.canvas.l + (m.canvas.w - box.w) / 2;
            if (Math.abs(box.t - (m.canvas.t + 64)) > 1 || Math.abs(box.l - dockL) > 1) failures.push(`${label} touch box not docked top centre: box=${JSON.stringify(box)}`);
          }
          if (tool === 'tool-line' && (edge.name === 'bottom' || edge.name === 'right') && !phone) {
            await shot(`${h.name}-${kind}-${edge.name}.png`, { x: Math.max(0, Math.min(box.l, m.canvas.r) - 200), y: Math.max(0, Math.min(box.t, m.canvas.b) - 120), w: 400, h: 220 });
          }
        }
        await sendRealKey(send, 'Escape', 'Escape', 27); await sleep(120);
      }
    }
    assert.strictEqual(failures.length, 0, '\n' + failures.join('\n'));
    console.log('live box canvas 697: ok');
  } finally { try { await cdp.close(); } catch (_) { /* closed */ } }
})();
