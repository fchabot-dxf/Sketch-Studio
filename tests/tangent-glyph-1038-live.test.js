// tests/tangent-glyph-1038-live.test.js — TASK 1038 (BUG-382, audit 1037 N-C), live headless SketchStudio, real mouse (desktop 1280 x 800) and real
// touch (phone 390 x 844): a tangent between two circles / arcs draws its glyph. A 3-Point Arc Slot drawn with the Slot tool shows its 4 tangent
// glyphs (one per corner; D-7: Fusion's 4 tangents), and two circles joined by the Tangent tool show one more. Screenshots to .evidence/1038/.
// The node twin (DOF, the glyph's spot, the pick): tests/dof-fix-1038-node.test.js.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';
import { resetBufferLive } from './helpers/reset-buffer.js';

const WORKTREE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EVID_DIR = path.join(WORKTREE_ROOT, '.evidence', '1038');
const SHOT_TAG = process.env.SHOT_TAG || 'after';   // the evidence file names (the before shots were taken on the code before the fix)

await (async () => {
  const cdp = await launchBrowser({ tag: '1038-tangent', width: 1280, height: 800 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, waitFor, waitForApp, navigate } = cdp;
  try {
    fs.mkdirSync(EVID_DIR, { recursive: true });
    const url = `http://127.0.0.1:${port}/apps/sketchstudio/index.html`;
    const mouse = (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', buttons: 0, clickCount: type === 'mouseMoved' ? 0 : 1, ...extra });
    const move = async (x, y) => { await mouse('mouseMoved', Math.round(x), Math.round(y)); await sleep(30); };
    const click = async (x, y) => { const rx = Math.round(x), ry = Math.round(y); await move(rx, ry); await mouse('mousePressed', rx, ry, { buttons: 1 }); await sleep(40); await mouse('mouseReleased', rx, ry); await sleep(180); };
    const touch = (type, x, y) => send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: Math.round(x), y: Math.round(y), id: 1, radiusX: 1, radiusY: 1, force: 1 }] });
    const tap = async (x, y) => { await touch('touchStart', x, y); await sleep(50); await touch('touchEnd'); await sleep(220); };
    const shot = async (file, clip) => {
      await sleep(200);
      const r = await send('Page.captureScreenshot', { format: 'png', clip: { ...clip, scale: 2 } });
      fs.writeFileSync(path.join(EVID_DIR, file), Buffer.from(r.data, 'base64'));
      console.log('  screenshot', path.join('.evidence', '1038', file));
    };
    const canvasCentre = () => evalJs(`(() => { const r = document.querySelector('#svgCanvas').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    const rectOf = (sel) => evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { cx: Math.round(r.left + r.width / 2), cy: Math.round(r.top + r.height / 2), w: r.width }; })()`);
    const tangentGlyphs = () => evalJs(`document.querySelectorAll('#svgCanvas g.constraint-glyph[data-ctype="tangent"]').length`);
    /** a ribbon tool (its button, or its row in the section dropdown when it is not in the bar), then its variant row */
    async function pickTool(press, toolId, section, variant) {
      const b = await rectOf('#' + toolId);
      const hidden = await evalJs(`document.getElementById(${JSON.stringify(toolId)}).hidden || document.getElementById(${JSON.stringify(toolId)}).getBoundingClientRect().width === 0`);
      if (hidden) {
        const sec = await rectOf(`.sk-ribbon-group[data-section="${section}"] .sk-ribbon-group-label`);
        await press(sec.cx, sec.cy);
        await waitFor(`!!document.querySelector('.sk-ribbon-sect-menu.show')`, `${section} dropdown`);
        const row = await rectOf(`.sk-ribbon-sect-menu.show .sk-ribbon-sect-item[data-id="${toolId}"]`);
        await press(row.cx, row.cy);
      } else await press(b.cx, b.cy);
      if (variant) {
        await waitFor(`!!document.querySelector('.sk-ribbon-menu.show [data-mode="${variant}"]')`, `the ${toolId} variant menu`);
        const row = await rectOf(`.sk-ribbon-menu.show [data-mode="${variant}"]`);
        await press(row.cx, row.cy);
        await waitFor(`!document.querySelector('.sk-ribbon-menu.show')`, `${variant} picked`);
      }
      await waitFor(`document.getElementById(${JSON.stringify(toolId)}).classList.contains('active') || !!document.querySelector('.sk-ribbon-group[data-section="${section}"].sk-ribbon-group-active, .sk-ribbon-group[data-section="${section}"] .active')`, `${toolId} active`);
    }

    /** k = the layout scale (1 on the desktop, smaller on the phone); returns the tangent glyph counts */
    async function drawAndCount(label, press, k) {
      const c = await canvasCentre();
      const P = (dx, dy) => ({ x: c.x + dx * k, y: c.y + dy * k });
      // 1. a 3-Point Arc Slot: start centre, end centre, a point on the centre arc, the width
      await pickTool(press, 'tool-slot', 'create', 'slot-arc-3pt');
      for (const p of [P(-160, 40), P(0, 40), P(-80, -20), P(-80, -45)]) await press(p.x, p.y);
      await sleep(300);
      const slotGlyphs = await tangentGlyphs();
      console.log(`  ${label}: arc slot drawn, tangent glyphs ${slotGlyphs}`);
      await shot(`arc-slot-tangent-glyphs-${label}-${SHOT_TAG}.png`, { x: Math.max(0, Math.round(c.x - 230 * k)), y: Math.max(0, Math.round(c.y - 110 * k)), width: Math.round(300 * k), height: Math.round(200 * k) });
      // 2. two circles, then the Tangent tool on their rims
      const c1 = P(90, 20), c2 = P(200, 20), r1 = 30 * k, r2 = 20 * k;
      await pickTool(press, 'tool-circle', 'create');
      await press(c1.x, c1.y); await press(c1.x + r1, c1.y);
      await pickTool(press, 'tool-circle', 'create');
      await press(c2.x, c2.y); await press(c2.x + r2, c2.y);
      await pickTool(press, 'tool-tangent', 'constrain');
      await press(c1.x, c1.y - r1); await press(c2.x, c2.y - r2);
      await sleep(400);
      const allGlyphs = await tangentGlyphs();
      console.log(`  ${label}: + two circles and the Tangent tool, tangent glyphs ${allGlyphs}`);
      await shot(`circle-tangent-glyph-${label}-${SHOT_TAG}.png`, { x: Math.max(0, Math.round(c1.x - 60 * k)), y: Math.max(0, Math.round(c1.y - 70 * k)), width: Math.round(220 * k), height: Math.round(130 * k) });
      return { slotGlyphs, allGlyphs };
    }

    // ── 1. desktop 1280 x 800, real mouse ──
    await resetBufferLive({ port, navigate, waitFor });
    await navigate(url);
    await waitForApp('svgCanvas');
    await waitFor(`!!document.querySelector('#tool-slot')`, 'ribbon #tool-slot');
    const d = await drawAndCount('desktop', click, 1);
    assert.strictEqual(d.slotGlyphs, 4, `desktop: the arc slot draws 4 tangent glyphs (got ${d.slotGlyphs})`);
    assert.strictEqual(d.allGlyphs, 5, `desktop: the circle-circle tangent draws its glyph too: 5 (got ${d.allGlyphs})`);

    // ── 2. phone 390 x 844, real touch ──
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenOrientation: { type: 'portraitPrimary', angle: 0 } });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await resetBufferLive({ port, navigate, waitFor });
    await navigate(url);
    await waitForApp('svgCanvas');
    await waitFor(`!!document.querySelector('#tool-slot')`, 'phone ribbon #tool-slot');
    const p = await drawAndCount('phone', tap, 0.62);
    assert.strictEqual(p.slotGlyphs, 4, `phone: the arc slot draws 4 tangent glyphs (got ${p.slotGlyphs})`);
    assert.strictEqual(p.allGlyphs, 5, `phone: the circle-circle tangent draws its glyph too: 5 (got ${p.allGlyphs})`);
    console.log('tangent-glyph-1038-live: ALL CHECKS PASSED');
  } finally {
    await cdp.close();
  }
})();
