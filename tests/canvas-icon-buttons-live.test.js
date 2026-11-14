// tests/canvas-icon-buttons-live.test.js — TASK 615 / 618 / 619: Construction lives in .sk-canvas-corner beside Sketches (32 px mouse / 44 px coarse phone), Recenter stays in the app footer (32 px mouse / 56x44 phone); icon buttons only (no text), ON state shows, no overlap with .sk-browser.
import assert from 'node:assert';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';

const cdp = await launchBrowser({ tag: '615t', width: 1400, height: 900 });
if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
const { port, send, evalJs, waitFor, navigate } = cdp;
const info = (id) => evalJs(`(() => { const b = document.getElementById('${id}'); const r = b.getBoundingClientRect(); const cs = getComputedStyle(b);
  return { w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10, l: r.left, r: r.right, t: r.top, cx: r.left + r.width / 2, cy: r.top + r.height / 2, aria: b.getAttribute('aria-label'), title: b.title, text: b.textContent.trim(), use: b.querySelector('svg use')?.getAttribute('href'), pressed: b.getAttribute('aria-pressed'), bg: cs.backgroundColor, glyph: (() => { const g = b.querySelector('svg').getBoundingClientRect(); return Math.round(Math.min(g.width, g.height) * 10) / 10; })() }; })()`);
const click = async (id) => { const i = await info(id); for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: i.cx, y: i.cy, button: 'left', clickCount: 1 }); await sleep(150); };
try {
  await navigate(`http://127.0.0.1:${port}/apps/sketchstudio/index.html`, 15000);
  await waitFor(`!!document.getElementById('btn-recenter-view') && !!document.getElementById('svgCanvas')`, 'SketchStudio loaded'); await sleep(500);
  let c = await info('btn-construct-toggle'), r = await info('btn-recenter-view');
  console.log('desktop', JSON.stringify({ c, r }));
  assert.deepStrictEqual([c.w, c.h, r.w, r.h], [32, 32, 32, 32], 'desktop: both buttons are 32 px square');
  assert.ok(await evalJs(`!!document.getElementById('btn-construct-toggle').closest('.sk-canvas-corner') && !document.getElementById('btn-construct-toggle').closest('footer')`), 'TASK 619: Construction is in .sk-canvas-corner (not footer)');
  assert.ok(await evalJs(`getComputedStyle(document.querySelector('.sk-browser-corner-btn')).display === 'none'`), 'TASK 619: desktop Sketches button is hidden so Construction sits alone in .sk-canvas-corner');
  assert.ok(await evalJs(`!!document.getElementById('btn-recenter-view').closest('footer')`), 'TASK 618/619: Recenter stays in the footer');
  assert.ok(c.glyph >= 20 && r.glyph >= 20, `TASK 616: the glyph fills the button (>= 20 px of 32): ${c.glyph} / ${r.glyph}`);
  assert.deepStrictEqual([c.aria, r.aria], ['Construction', 'Recenter view'], 'aria-labels');
  assert.strictEqual(c.title, 'Construction: OFF (K)', 'Construction title includes K shortcut');
  assert.deepStrictEqual([c.text, r.text], ['', ''], 'no text, icon only');
  assert.deepStrictEqual([c.use, r.use], ['#icon-construction', '#icon-recenter'], 'each draws its sprite glyph');
  assert.ok(await evalJs(`!!document.querySelector('symbol#icon-construction') && !!document.querySelector('symbol#icon-recenter')`), 'glyphs are in the sprite');
  const off = c.bg;
  await click('btn-construct-toggle');
  c = await info('btn-construct-toggle');
  assert.strictEqual(c.pressed, 'true', 'a real click turns Construction ON'); assert.notStrictEqual(c.bg, off, 'ON looks different'); assert.strictEqual(c.bg, 'rgb(249, 115, 22)', 'ON is the orange fill');
  assert.strictEqual(c.title, 'Construction: ON (K)', 'ON title reflects state + K shortcut');
  assert.strictEqual(c.text, '', 'still no text after toggling');
  await click('btn-construct-toggle');
  assert.strictEqual((await info('btn-construct-toggle')).pressed, 'false', 'a second click turns it OFF');
  // Recenter: zoom the canvas with the wheel, then click Recenter: an empty drawing returns to the default view
  const vb = () => evalJs(`document.getElementById('svgCanvas').getAttribute('viewBox')`);
  const home = await vb();
  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 600, y: 500, deltaX: 0, deltaY: -600 }); await sleep(300);
  const zoomed = await vb(); assert.notStrictEqual(zoomed, home, 'the wheel changed the view');
  await click('btn-recenter-view');
  const after = await vb(); assert.notStrictEqual(after, zoomed, 'Recenter moved the view'); assert.strictEqual(+after.split(' ')[2], 1200, 'an empty drawing recenters to the default view (1200 wide)');
  // overlap: neither button touches the SKETCHES box
  const clear = await evalJs(`(() => { const box = document.querySelector('.sk-browser'); if (!box) return true; const b = box.getBoundingClientRect(); return ['btn-construct-toggle', 'btn-recenter-view'].every((id) => { const r = document.getElementById(id).getBoundingClientRect(); return r.right <= b.left || r.left >= b.right || r.bottom <= b.top || r.top >= b.bottom; }); })()`);
  assert.ok(clear, 'no overlap with the SKETCHES box');

  // phone, a finger: Construction is 44x44 beside Sketches in .sk-canvas-corner, Recenter is 56x44 in footer
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await navigate(`http://127.0.0.1:${port}/apps/sketchstudio/index.html`, 15000);
  await waitFor(`!!document.getElementById('btn-recenter-view') && !!document.getElementById('btn-construct-toggle')`, 'loaded (phone)'); await sleep(600);
  c = await info('btn-construct-toggle'); r = await info('btn-recenter-view');
  const sk = await evalJs(`(() => { const b = document.querySelector('.sk-canvas-corner .sk-browser-corner-btn'); const x = b.getBoundingClientRect(); return { w: Math.round(x.width * 10) / 10, h: Math.round(x.height * 10) / 10, l: x.left, t: x.top }; })()`);
  console.log('phone', JSON.stringify({ c, sk, r }));
  assert.deepStrictEqual([c.w, c.h], [44, 44], 'a finger: Construction in canvas corner matches Sketches (44x44)');
  assert.deepStrictEqual([sk.w, sk.h], [44, 44], 'a finger: Sketches corner button is 44x44');
  assert.ok(c.r <= sk.l && Math.abs(c.t - sk.t) <= 1, 'Construction sits beside Sketches in .sk-canvas-corner: ' + JSON.stringify({ c, sk }));
  assert.deepStrictEqual([r.w, r.h], [56, 44], 'a finger: Recenter in footer is 56 x 44');
  assert.ok(c.glyph >= 26 && r.glyph >= 26, `TASK 616: a finger: the glyph is >= 26 px of 44: ${c.glyph} / ${r.glyph}`);
  const clearP = await evalJs(`(() => { const box = document.querySelector('.sk-browser'); if (!box) return true; const b = box.getBoundingClientRect(); if (!b.width) return true; return ['btn-construct-toggle', 'btn-recenter-view'].every((id) => { const r = document.getElementById(id).getBoundingClientRect(); return r.right <= b.left || r.left >= b.right || r.bottom <= b.top || r.top >= b.bottom; }); })()`);
  assert.ok(clearP, 'phone: no overlap with the SKETCHES box');
  console.log('canvas icon buttons live: OK');
} finally { await cdp.close(); }
process.exit(0);
