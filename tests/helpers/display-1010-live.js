// tests/helpers/display-1010-live.js -- headless-browser helpers for the task 1010 live tests: seed a design, set the view,
// project a world point to the screen, mouse / touch input, a zoomed screenshot to .evidence/1010/.
import fs from 'node:fs';
import path from 'node:path';
import { sleep } from './cdp-browser.js';
import { resetBufferLive } from './reset-buffer.js';

export const EVID = path.resolve('.evidence/1010');
export const NO_NET = ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost'];

/** seed `doc` as a new design of `host` (the page is opened, the design saved, the page reopened so it loads it) */
export async function openSeeded(cdp, doc, { host = 'sketchstudio', canvas = 'svgCanvas', url = '/apps/sketchstudio/index.html' } = {}) {
  const { port, evalJs, waitForApp, navigate } = cdp;
  const full = `http://127.0.0.1:${port}${url}`;
  await resetBufferLive(cdp);
  await navigate(full, 12000);
  await waitForApp(canvas);
  await evalJs(`import('/packages/ui/project-store.js').then(async (m) => { const s = m.getProjectStore(); const d = await s.newDesign('Display 1010', { app: '${host}' }); await s.save(${JSON.stringify(doc)}, { app: '${host}', id: d.id }); })`);
  await navigate(full, 12000);
  await waitForApp(canvas);
  await sleep(450);
}

export async function setView(cdp, canvas, cx, cy, vw) {
  await cdp.evalJs(`(() => { const svg = document.getElementById('${canvas}'); const r = svg.getBoundingClientRect(); const vh = ${vw} / (r.width / r.height);
    svg.setAttribute('viewBox', (${cx} - ${vw}/2) + ' ' + (${cy} - vh/2) + ' ' + ${vw} + ' ' + vh); })()`);
  await sleep(200);
}

export const w2s = (cdp, canvas, wx, wy) => cdp.evalJs(`(() => { const svg = document.getElementById('${canvas}'); const pt = svg.createSVGPoint(); pt.x = ${wx}; pt.y = ${wy};
  const p = pt.matrixTransform(svg.getScreenCTM()); return { x: p.x, y: p.y }; })()`);

export async function mouseMove(cdp, x, y) {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(x), y: Math.round(y), button: 'none', clickCount: 0 });
  await sleep(160);
}
export async function mouseClick(cdp, x, y) {
  const rx = Math.round(x), ry = Math.round(y);
  await mouseMove(cdp, rx, ry);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rx, y: ry, button: 'left', buttons: 1, clickCount: 1 });
  await sleep(30);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rx, y: ry, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(200);
}
export async function mouseDrag(cdp, a, b, steps = 14) {
  await mouseMove(cdp, a.x, a.y);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: Math.round(a.x), y: Math.round(a.y), button: 'left', buttons: 1, clickCount: 1 });
  for (let k = 1; k <= steps; k++) {
    await sleep(16);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(a.x + (b.x - a.x) * k / steps), y: Math.round(a.y + (b.y - a.y) * k / steps), button: 'left', buttons: 1, clickCount: 0 });
  }
  await sleep(25);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: Math.round(b.x), y: Math.round(b.y), button: 'left', buttons: 0, clickCount: 1 });
  await sleep(220);
}
export async function touchTap(cdp, x, y) {
  const rx = Math.round(x), ry = Math.round(y);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: rx, y: ry, id: 1, radiusX: 2, radiusY: 2, force: 1 }] });
  await sleep(45);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(250);
}
export async function touchDrag(cdp, a, b, steps = 12) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: Math.round(a.x), y: Math.round(a.y), id: 1, radiusX: 2, radiusY: 2, force: 1 }] });
  for (let k = 1; k <= steps; k++) {
    await sleep(18);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: Math.round(a.x + (b.x - a.x) * k / steps), y: Math.round(a.y + (b.y - a.y) * k / steps), id: 1, radiusX: 2, radiusY: 2, force: 1 }] });
  }
  await sleep(25);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(250);
}

/** a screenshot of the screen rectangle `clip` {x,y,width,height}, zoomed `scale` times, saved to .evidence/1010/<name> */
export async function shot(cdp, name, clip, scale = 3) {
  fs.mkdirSync(EVID, { recursive: true });
  const r = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: Math.max(0, Math.round(clip.x)), y: Math.max(0, Math.round(clip.y)), width: Math.round(clip.width), height: Math.round(clip.height), scale } });
  const file = path.join(EVID, name);
  fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
  return file;
}
