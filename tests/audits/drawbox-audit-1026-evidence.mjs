// tests/audits/drawbox-audit-1026-evidence.mjs — TASK 1026 (AUDIT ONLY): cropped screenshots of the main findings into .evidence/1026/
// Run: node tests/audits/drawbox-audit-1026-evidence.mjs
import { start, row, sleep } from './drawbox-audit-1026-kit.js';

const k = await start({ tag: '1026-evidence', view: { cx: 0, cy: 0, vw: 220 } });
const out = [];
const clipAround = async (sels, pad = 60) => {
  const rs = await k.cdp.evalJs(`(${JSON.stringify(sels)}).map((s) => { const e = document.querySelector(s); if (!e || e.classList.contains('hidden')) return null; const r = e.getBoundingClientRect(); return r.width ? [r.left, r.top, r.right, r.bottom] : null; }).filter(Boolean)`);
  if (!rs.length) return null;
  const l = Math.max(0, Math.min(...rs.map((r) => r[0])) - pad), t = Math.max(0, Math.min(...rs.map((r) => r[1])) - pad);
  const r = Math.min(1280, Math.max(...rs.map((x) => x[2])) + pad), b = Math.min(800, Math.max(...rs.map((x) => x[3])) + pad);
  return { x: l, y: t, width: Math.max(300, r - l), height: Math.max(220, b - t) };
};
const rec = async (name, clip) => { const s = await k.shot(name, clip); out.push(s); row('EVIDENCE', `${s.name} md5=${s.md5}`); };
try {
  // E1: circle, the diameter field emptied by Backspace: the box is empty, the circle still gets the stale 6
  await k.openFresh(); await k.pickTool('circle'); await k.clickW(-30, 0); await k.moveW(10, 0); await k.typeText('60'); await k.pressKey('Backspace'); await k.pressKey('Backspace'); await k.moveW(-30, -30);
  await rec('E1-circle-emptied-box-before-Enter.png', await clipAround(['#dimInput'], 160));
  await k.pressKey('Enter'); await sleep(250);
  await rec('E1-circle-after-Enter-stale-diameter-6.png', { x: 200, y: 250, width: 640, height: 360 });

  // E2: fillet radius 1000 on a 50 x 35 rectangle
  await k.openFresh(); await k.pickTool('rect', 'rect-2pt'); await k.clickW(-40, -10); await k.moveW(10, 25); await k.clickW(10, 25); await k.pressKey('Escape'); await k.pressKey('Escape');
  await rec('E2-rect-before-fillet.png', { x: 300, y: 250, width: 640, height: 360 });
  await k.pickTool('fillet'); await k.clickW(-40, -10); await k.typeText('1000'); await k.pressKey('Enter'); await sleep(300);
  await k.pressKey('Escape'); await k.pressKey('Escape');
  await k.setView(0, 0, 2200); await sleep(300);
  await rec('E2-rect-after-fillet-1000.png', { x: 0, y: 160, width: 1280, height: 600 });

  // E3: 3-point rectangle, typed 40: a W x H box that Enter drops
  await k.openFresh(); await k.pickTool('rect', 'rect-3pt'); await k.clickW(-50, -10); await k.moveW(0, -10); await k.typeText('40');
  await rec('E3-rect3pt-typed-40-box.png', await clipAround(['#dualInput'], 200));
  await k.pressKey('Enter'); await sleep(250);
  await rec('E3-rect3pt-after-Enter-nothing.png', { x: 200, y: 250, width: 640, height: 360 });

  // E4: right-click with a typed length: a second 1 mm segment
  await k.openFresh(); await k.pickTool('line'); await k.clickW(-60, 10); await k.moveW(-30, 38); await k.typeText('40'); await k.clickW(-30, 38, { button: 'right' }); await sleep(250);
  await k.pressKey('Escape'); await k.pressKey('Escape'); await sleep(300);
  const e4 = await k.w2s(-30.3, 37.6);
  const shot4 = await k.cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: Math.round(e4.x - 70), y: Math.round(e4.y - 45), width: 140, height: 90, scale: 6 } });
  const b4 = Buffer.from(shot4.data, 'base64'); (await import('node:fs')).writeFileSync(new URL('../../.evidence/1026/E4-line-rightclick-typed-stray-segment.png', import.meta.url), b4);
  row('EVIDENCE', 'E4-line-rightclick-typed-stray-segment.png md5=' + (await import('node:crypto')).createHash('md5').update(b4).digest('hex'));

  // E5: Tab inside a single box leaves it for the toolbar
  await k.openFresh(); await k.pickTool('circle'); await k.clickW(-30, 0); await k.moveW(10, 0); await k.typeText('60'); await k.pressKey('Tab'); await sleep(200);
  await rec('E5-circle-box-after-Tab-focus-on-toolbar-button.png', { x: 0, y: 160, width: 700, height: 360 });
} finally { await k.close(); }
