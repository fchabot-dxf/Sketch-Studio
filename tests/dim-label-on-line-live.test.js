// tests/dim-label-on-line-live.test.js — TASK 621 live (headless CDP, REAL pointer drag + screenshots):
// Dragging a dimension label diagonally in X and Y moves the dimension line and arrows with it, extends past the arrow,
// and undoes in one Ctrl+Z. Saves cropped before/after screenshots to .evidence/621/.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser, sleep, sendRealKey } from './helpers/cdp-browser.js';

const WORKTREE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EVID_DIR = path.join(WORKTREE_ROOT, '.evidence', '621');

await (async () => {
  const cdp = await launchBrowser({ tag: '621' });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, waitFor, navigate } = cdp;
  try {
    const mouse = (type, x, y, buttons) => send('Input.dispatchMouseEvent', {
      type, x, y,
      button: type === 'mouseMoved' && !buttons ? 'none' : 'left',
      buttons,
      clickCount: type === 'mouseMoved' ? 0 : 1,
    });
    const move = async (x, y) => { await mouse('mouseMoved', x, y, 0); await sleep(60); };
    const click = async (x, y) => { await move(x, y); await mouse('mousePressed', x, y, 1); await sleep(40); await mouse('mouseReleased', x, y, 0); await sleep(200); };
    const drag = async (from, to, steps = 8) => {
      await move(from.x, from.y);
      await mouse('mousePressed', from.x, from.y, 1);
      await sleep(40);
      for (let i = 1; i <= steps; i++) {
        await mouse('mouseMoved', Math.round(from.x + (to.x - from.x) * i / steps), Math.round(from.y + (to.y - from.y) * i / steps), 1);
        await sleep(30);
      }
      await mouse('mouseReleased', to.x, to.y, 0);
      await sleep(250);
    };
    const key = async (k, code, vk, mods = 0) => { await sendRealKey(send, k, code, vk, mods); await sleep(200); };
    const tool = async (t) => { await evalJs(`document.getElementById('tool-${t}').click()`); await sleep(200); };
    const toScreen = (wx, wy) => evalJs(`(() => { const s = document.querySelector('#svgCanvas'); const p = s.createSVGPoint(); p.x = ${wx}; p.y = ${wy}; const q = p.matrixTransform(s.getScreenCTM()); return { x: Math.round(q.x), y: Math.round(q.y) }; })()`);
    const readDimState = () => evalJs(`(() => {
      const svg = document.querySelector('#svgCanvas');
      const lbl = svg.querySelector('.dim-label');
      if (!lbl) return null;
      const lr = lbl.getBoundingClientRect();
      const labelCenter = { x: Math.round(lr.x + lr.width / 2), y: Math.round(lr.y + lr.height / 2) };
      const ctm = svg.getScreenCTM();
      const mapPt = (wx, wy) => { const p = svg.createSVGPoint(); p.x = wx; p.y = wy; const q = p.matrixTransform(ctm); return { x: Math.round(q.x), y: Math.round(q.y) }; };
      const arrows = [...svg.querySelectorAll('polygon')].map((poly) => {
        const nums = (poly.getAttribute('points') || '').trim().split(/[\s,]+/).map(Number).filter(Number.isFinite);
        return nums.length >= 2 ? mapPt(nums[0], nums[1]) : null;
      }).filter(Boolean);
      const leads = [...svg.querySelectorAll('line.dim-lead')].map((el) => ({
        a: mapPt(+el.getAttribute('x1'), +el.getAttribute('y1')),
        b: mapPt(+el.getAttribute('x2'), +el.getAttribute('y2')),
      }));
      return { text: lbl.textContent.trim(), labelCenter, arrows, leads };
    })()`);

    const shot = async (name, clip) => {
      const r = await send('Page.captureScreenshot', { format: 'png', clip: { x: clip.x, y: clip.y, width: clip.w, height: clip.h, scale: 2 } });
      fs.mkdirSync(EVID_DIR, { recursive: true });
      fs.writeFileSync(path.join(EVID_DIR, name), Buffer.from(r.data, 'base64'));
    };

    await navigate(`http://127.0.0.1:${port}/apps/sketchstudio/index.html`, 4000);
    await waitFor(`!!document.querySelector('#svgCanvas') && !!document.getElementById('tool-dim')`, 'canvas and dim tool', 15000);
    await sleep(1200);

    const o = await toScreen(0, 0);
    const P = (dx, dy) => ({ x: o.x + dx, y: o.y + dy });

    // Draw a vertical line and place a vertical dimension on its right
    const top = P(100, -180), bot = P(100, -60);
    await tool('line');
    await click(top.x, top.y);
    await click(bot.x, bot.y);
    await key('Escape', 'Escape', 27);

    await tool('dim');
    await click(P(100, -120).x, P(100, -120).y);
    await move(P(145, -120).x, P(145, -120).y);
    await click(P(145, -120).x, P(145, -120).y);
    await waitFor(`(() => { const i = document.getElementById('dimInput'); return !!i && !i.classList.contains('hidden'); })()`, 'dimInput open', 8000);
    await key('Enter', 'Enter', 13);
    await sleep(300);
    await tool('select');

    const crop = { x: Math.max(0, P(60, -210).x), y: Math.max(0, P(60, -210).y), w: 320, h: 270 };
    const before = await readDimState();
    assert(before && before.arrows.length === 2, 'before drag: dimension label & 2 arrows visible: ' + JSON.stringify(before));
    await shot('before-drag.png', crop);

    // Real diagonal mouse drag on the label: move right (X += ~90) AND down past bottom arrow (Y = P(235, -15), below bot.y = -60)
    const dragTarget = P(235, -15);
    await drag(before.labelCenter, dragTarget);

    const after = await readDimState();
    await shot('after-drag.png', crop);

    assert(after && after.arrows.length === 2, 'after drag: dimension label & 2 arrows visible: ' + JSON.stringify(after));
    const dxLabel = after.labelCenter.x - before.labelCenter.x;
    const dyLabel = after.labelCenter.y - before.labelCenter.y;
    const dxArrow = after.arrows[0].x - before.arrows[0].x;
    assert(dxLabel > 50, `label moved right in X (${before.labelCenter.x} -> ${after.labelCenter.x})`);
    assert(dyLabel > 50, `label moved down in Y (${before.labelCenter.y} -> ${after.labelCenter.y})`);
    assert(dxArrow > 50, `arrows FOLLOWED label in X (${before.arrows[0].x} -> ${after.arrows[0].x})`);
    assert(Math.abs(after.arrows[0].x - after.labelCenter.x) <= 12, `label stays ON moved dimension line (arrowX=${after.arrows[0].x}, labelX=${after.labelCenter.x})`);
    assert(after.leads.length === 1, `past-arrow diagonal drag draws 1 vertical extension line (leads=${JSON.stringify(after.leads)})`);
    assert(Math.abs(after.leads[0].a.x - after.leads[0].b.x) <= 2, `extension is along vertical dim line, not off-line horizontal leader (${JSON.stringify(after.leads[0])})`);
    assert(after.leads[0].b.y > Math.max(after.arrows[0].y, after.arrows[1].y) + 15, `extension reaches past bottom arrow (${JSON.stringify(after.leads[0])})`);

    // One Ctrl+Z restores both offset and slide
    await key('z', 'KeyZ', 90, 2);
    const undone = await readDimState();
    assert(Math.abs(undone.arrows[0].x - before.arrows[0].x) <= 3, `one Ctrl+Z restores arrow X (${undone.arrows[0].x} vs ${before.arrows[0].x})`);
    assert(Math.abs(undone.labelCenter.y - before.labelCenter.y) <= 3, `one Ctrl+Z restores label Y (${undone.labelCenter.y} vs ${before.labelCenter.y})`);

    console.log('dim-label-on-line-live: ok');
  } finally {
    await cdp.close();
  }
})();
process.exit(0);
