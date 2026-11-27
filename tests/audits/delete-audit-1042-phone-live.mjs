// tests/audits/delete-audit-1042-phone-live.mjs — TASK 1042 (AUDIT ONLY, outside the gate): the delete PATHS node cannot drive, in the REAL
// SketchStudio page (headless Edge / Chrome via CDP, real touch / mouse / keys): the phone's touch-and-hold menu Delete and footer red X (390 x 844,
// touch), and the desktop footer red X + right-click Delete (1280 x 800, mouse), on the same scene (a lone line). What is read is
// the page's drawing (data-shape-id elements, the .dim-label labels, the origin marker). Rows `ROW L-xx | ...`; screenshots in .evidence/1042/.
// Run: node tests/audits/delete-audit-1042-phone-live.mjs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { launchBrowser, sleep, sendRealKey } from '../helpers/cdp-browser.js';
import { installFakeDriveSession } from '../helpers/fake-drive-session.js';
import { resetBufferLive } from '../helpers/reset-buffer.js';
import { pressRibbonTool } from '../helpers/ribbon-tool.js';

const EVID = path.resolve('.evidence/1042'); fs.mkdirSync(EVID, { recursive: true });
const row = (id, t) => console.log(`ROW ${id} | ${t}`);
const cdp = await launchBrowser({ tag: '1042-delete', width: 1280, height: 800 });
if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
const { port, send, evalJs, waitFor, navigate, waitForApp } = cdp;
const C = '#svgCanvas';
let phone = false;
const mouse = (type, x, y, buttons, clickCount = 1, button) => send('Input.dispatchMouseEvent', { type, x: Math.round(x), y: Math.round(y), button: button || (type === 'mouseMoved' && !buttons ? 'none' : 'left'), buttons, clickCount: type === 'mouseMoved' ? 0 : clickCount });
const T = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: Math.round(p.x), y: Math.round(p.y), id: i + 1, radiusX: 1, radiusY: 1, force: 1 })) });
const tap = async (p, hold = 70) => { await T('touchStart', [p]); await sleep(hold); await T('touchEnd', []); await sleep(450); };
const click = async (p) => { await mouse('mouseMoved', p.x, p.y, 0); await sleep(40); await mouse('mousePressed', p.x, p.y, 1); await sleep(40); await mouse('mouseReleased', p.x, p.y, 0); await sleep(300); };
const press = (p) => (phone ? tap(p) : click(p));
const menuAt = async (p) => {
  if (phone) { await T('touchStart', [p]); await sleep(750); await T('touchEnd', []); await sleep(300); return; }
  await mouse('mouseMoved', p.x, p.y, 0); await sleep(40); await mouse('mousePressed', p.x, p.y, 2, 1, 'right'); await sleep(40); await mouse('mouseReleased', p.x, p.y, 0, 1, 'right'); await sleep(350);
};
const key = (k, code, vk, mods = 0, text = '') => sendRealKey(send, k, code, vk, mods, text).then(() => sleep(300));
const esc = () => key('Escape', 'Escape', 27);
const undo = () => key('z', 'KeyZ', 90, 2);
const toScreen = (x, y) => evalJs(`(() => { const svg = document.querySelector('${C}'); const p = svg.createSVGPoint(); p.x = ${x}; p.y = ${y}; const s = p.matrixTransform(svg.getScreenCTM()); return { x: s.x, y: s.y }; })()`);
const centre = (sel) => evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height, shown: r.width > 0 && getComputedStyle(e).display !== 'none' }; })()`);
const drawing = () => evalJs(`({ shapes: new Set([...document.querySelectorAll('${C} [data-shape-id]')].map((e) => e.dataset.shapeId)).size, labels: document.querySelectorAll('${C} .dim-label').length })`);
const menuIds = () => evalJs(`[...document.querySelectorAll('.sk-context-menu .sk-context-item')].map((r) => r.dataset.id)`);
const menuRow = (id) => centre(`.sk-context-menu .sk-context-item[data-id="${id}"]`);
const shot = async (name, clip) => { const r = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 2 } } : {}) }); const b = Buffer.from(r.data, 'base64'); fs.writeFileSync(path.join(EVID, name), b); return `${name} md5 ${crypto.createHash('md5').update(b).digest('hex')}`; };
const ribbon = (id) => pressRibbonTool(evalJs, press, id);

async function openPage(isPhone) {
  phone = isPhone;
  await installFakeDriveSession(cdp);
  if (phone) { await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }); await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }); }
  else { await send('Emulation.setTouchEmulationEnabled', { enabled: false }); await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false }); }
  await resetBufferLive(cdp);
  await navigate(`http://127.0.0.1:${port}/apps/sketchstudio/index.html`, 10000);
  await waitForApp('svgCanvas'); await sleep(500);
}
/** the scene: a line drawn with the Line tool (presses), 160 px long, 70 px above the canvas centre (screen px: the view differs per device) */
let A = null, B = null;
async function scene() {
  const r = await centre(C);
  A = { x: r.x - 80, y: r.y - 70 }; B = { x: r.x + 80, y: r.y - 70 };
  await ribbon('tool-line');
  await press(A); await press(B); await esc(); await esc();
  await ribbon('tool-select');
  await sleep(200);
}
async function caseRow(id, label, fn) {
  try { const before = await drawing(); const info = await fn(); const after = await drawing(); let undone = 'n/a (nothing deleted)'; if (JSON.stringify(after) !== JSON.stringify(before)) { await undo(); undone = await drawing(); } await esc();
    row(id, `${label} | before ${JSON.stringify(before)} | after ${JSON.stringify(after)} | undo ${JSON.stringify(undone)}${info ? ' | ' + info : ''}`);
  } catch (e) { row(id, `${label} | PROBE THREW ${e.message}`); }
}

try {
  for (const isPhone of [true, false]) {
    const P = isPhone ? 'phone' : 'desktop';
    await openPage(isPhone); await scene();
    const mid = { x: (A.x + B.x) / 2, y: A.y }, end = B, org = await toScreen(0, 0);
    const foot = await centre('#btn-delete-selection');
    row(`L-00-${P}`, `${await shot(`scene-${P}.png`)} active tool ${await evalJs(`document.querySelector('.sk-ribbon-btn.active') && document.querySelector('.sk-ribbon-btn.active').id`)} pts ${JSON.stringify([mid, end, org])} | scene ${JSON.stringify(await drawing())} | footer red X ${JSON.stringify(foot)}`);
    await caseRow(`L-01-${P}`, `${isPhone ? 'tap' : 'click'} the line, footer red X`, async () => { await press(mid); await press(await centre('#btn-delete-selection')); });
    await caseRow(`L-02-${P}`, `${isPhone ? 'touch and hold' : 'right-click'} the line, the menu's Delete`, async () => {
      await menuAt(mid); const ids = await menuIds(); const r = await menuRow('geo-delete');
      const s = isPhone ? await shot('phone-hold-menu-line.png', { x: 0, y: Math.max(0, r.y - 120), width: 390, height: 240 }) : '';
      if (r) await press(r); return `menu ${JSON.stringify(ids)} delete row ${r ? Math.round(r.h) + ' px tall' : 'none'} ${s}`; });
    await caseRow(`L-03-${P}`, `${isPhone ? 'tap' : 'click'} the line END, footer red X (the point rule)`, async () => { await press(end); await press(await centre('#btn-delete-selection')); });
    await caseRow(`L-04-${P}`, `${isPhone ? 'touch and hold' : 'right-click'} the line END, the menu's Delete`, async () => { await menuAt(end); const ids = await menuIds(); const r = await menuRow('geo-delete'); if (r) await press(r); return `menu ${JSON.stringify(ids)}`; });
    await caseRow(`L-05-${P}`, `${isPhone ? 'tap' : 'click'} the ORIGIN, footer red X`, async () => { await press(org); const sel = await evalJs(`document.querySelectorAll('${C} .selected, ${C} [data-selected="true"]').length`); await press(await centre('#btn-delete-selection')); const o = await evalJs(`!!document.querySelector('${C} [data-joint-id="j_origin"], ${C} .origin-marker, ${C} [data-origin]')`); return `origin element after: ${o}; selected elements ${sel}`; });
    await caseRow(`L-06-${P}`, `${isPhone ? 'touch and hold' : 'right-click'} the ORIGIN: the menu`, async () => { await menuAt(org); const ids = await menuIds(); const r = await menuRow('geo-delete'); if (r) await press(r); else await esc(); return `menu ${JSON.stringify(ids)}`; });
  }
} finally {
  await cdp.close();
}
