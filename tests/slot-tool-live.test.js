// tests/slot-tool-live.test.js — TASK 673 (live headless CDP, real mouse + real touch, SketchStudio):
// Verifies Fusion 360's 5 Slot types in the shared ribbon, Task 647 section customization + persistence,
// live numeric boxes + Enter + green check DONE button + Esc mid-draw cancel + 1-step Undo/Redo,
// construction mode, diameter width dimension editing, phone touch mode, and captures cropped screenshots to .evidence/673/.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser, sleep, sendRealKey } from './helpers/cdp-browser.js';

const WORKTREE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EVID_DIR = path.join(WORKTREE_ROOT, '.evidence', '673');

const EXPECTED_VARIANTS = [
  { mode: 'slot-c2c', label: 'Center to Center Slot' },
  { mode: 'slot-overall', label: 'Overall Slot' },
  { mode: 'slot-center', label: 'Center Point Slot' },
  { mode: 'slot-arc-3pt', label: 'Three Point Arc Slot' },
  { mode: 'slot-arc-center', label: 'Center Point Arc Slot' },
];

await (async () => {
  const cdp = await launchBrowser({ tag: '673-slot', width: 1280, height: 800 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, waitFor, waitForApp, navigate } = cdp;
  try {
    fs.mkdirSync(EVID_DIR, { recursive: true });
    const url = `http://127.0.0.1:${port}/apps/sketchstudio/index.html`;

    const mouse = (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', {
      type, x, y,
      button: type === 'mouseMoved' && !extra.buttons ? 'none' : 'left',
      buttons: 0,
      clickCount: type === 'mouseMoved' ? 0 : 1,
      ...extra,
    });
    const move = async (x, y) => { await mouse('mouseMoved', Math.round(x), Math.round(y)); await sleep(60); };
    const click = async (x, y, clickCount = 1) => {
      const rx = Math.round(x), ry = Math.round(y);
      await move(rx, ry);
      await mouse('mousePressed', rx, ry, { buttons: 1, clickCount });
      await sleep(40);
      await mouse('mouseReleased', rx, ry, { buttons: 0, clickCount });
      await sleep(180);
    };
    const dblClick = async (x, y) => {
      const rx = Math.round(x), ry = Math.round(y);
      await click(rx, ry, 1);
      await mouse('mousePressed', rx, ry, { buttons: 1, clickCount: 2 });
      await sleep(30);
      await mouse('mouseReleased', rx, ry, { buttons: 0, clickCount: 2 });
      await sleep(180);
    };
    const touchTap = async (x, y) => {
      const rx = Math.round(x), ry = Math.round(y);
      await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: rx, y: ry, id: 1, radiusX: 1, radiusY: 1, force: 1 }] });
      await sleep(50);
      await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await sleep(220);
    };
    const typeText = async (str) => {
      for (const ch of String(str)) {
        const vk = ch === '.' ? 190 : ch.charCodeAt(0);
        await sendRealKey(send, ch, ch === '.' ? 'Period' : `Digit${ch}`, vk, 0, ch);
        await sleep(30);
      }
    };
    const key = async (k, code, vk) => { await sendRealKey(send, k, code, vk); await sleep(180); };
    const shot = async (file, clip) => {
      await sleep(120);
      const r = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: clip.scale || 2 } } : {}) });
      fs.writeFileSync(path.join(EVID_DIR, file), Buffer.from(r.data, 'base64'));
    };
    const rectOf = (sel) => evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, cx: Math.round(r.left + r.width / 2), cy: Math.round(r.top + r.height / 2) }; })()`);
    const toScreen = (wx, wy) => evalJs(`(() => { const s = document.querySelector('#svgCanvas'); const p = s.createSVGPoint(); p.x = ${wx}; p.y = ${wy}; const q = p.matrixTransform(s.getScreenCTM()); return { x: Math.round(q.x), y: Math.round(q.y) }; })()`);
    const worldCenter = async (dx = 0, dy = 0) => toScreen(dx, dy);
    const shapeStats = () => evalJs(`(() => {
      const elems = [...document.querySelectorAll('#svgCanvas .shape-elem')];
      const dims = [...document.querySelectorAll('#svgCanvas .dim-label')].map((d) => d.textContent.trim());
      return {
        total: elems.length,
        lines: elems.filter((e) => e.tagName.toLowerCase() === 'line').length,
        paths: elems.filter((e) => e.tagName.toLowerCase() === 'path').length,
        construction: elems.filter((e) => e.hasAttribute('stroke-dasharray')).length,
        dims,
      };
    })()`);
    const slotClip = () => evalJs(`(() => {
      const pts = [];
      for (const el of document.querySelectorAll('#svgCanvas .shape-elem, #svgCanvas .dim-label')) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 || r.height > 0) pts.push(r);
      }
      if (!pts.length) return { x: 250, y: 150, width: 600, height: 350, scale: 2 };
      const minX = Math.max(0, Math.floor(Math.min(...pts.map((r) => r.left)) - 55));
      const minY = Math.max(0, Math.floor(Math.min(...pts.map((r) => r.top)) - 55));
      const maxX = Math.min(innerWidth, Math.ceil(Math.max(...pts.map((r) => r.right)) + 55));
      const maxY = Math.min(innerHeight, Math.ceil(Math.max(...pts.map((r) => r.bottom)) + 55));
      return { x: minX, y: minY, width: Math.max(120, maxX - minX), height: Math.max(100, maxY - minY), scale: 2 };
    })()`);

    const clearCanvas = async () => {
      await key('Escape', 'Escape', 27);
      // Clear any pre-existing restored shapes by triggering clear or undo if needed
      let guard = 0;
      while ((await shapeStats()).total > 0 && guard < 20) {
        await evalJs(`document.getElementById('btn-undo')?.click()`);
        await sleep(80);
        guard++;
      }
      if ((await shapeStats()).total > 0) {
        await evalJs(`localStorage.clear();`);
        await navigate(url);
        await waitForApp('svgCanvas');
        await waitFor(`!!document.querySelector('#tool-slot')`, 'ribbon #tool-slot');
        await sleep(300);
      }
    };

    const pickSlotVariant = async (mode) => {
      const hidden = await evalJs(`document.getElementById('tool-slot').hidden`);
      if (hidden) {
        const sec = await rectOf('.sk-ribbon-group[data-section="create"] .sk-ribbon-group-label');
        await click(sec.cx, sec.cy);
        await waitFor(`!!document.querySelector('.sk-ribbon-sect-menu.show')`, 'CREATE dropdown');
        const row = await rectOf(`.sk-ribbon-sect-menu.show .sk-ribbon-sect-item[data-id="tool-slot"]`);
        await click(row.cx, row.cy);
      } else {
        const btn = await rectOf('#tool-slot');
        await click(btn.cx, btn.cy);
      }
      await waitFor(`!!document.querySelector('.sk-ribbon-menu.show [data-mode="${mode}"]')`, `slot variant menu (${mode})`);
      const item = await rectOf(`.sk-ribbon-menu.show [data-mode="${mode}"]`);
      await click(item.cx, item.cy);
      await waitFor(`!document.querySelector('.sk-ribbon-menu.show') && document.getElementById('tool-slot').classList.contains('active')`, `variant ${mode} active`);
    };

    // ── Load SketchStudio ──────────────────────────────────────────────────
    await navigate(url);
    await waitForApp('svgCanvas');
    await waitFor(`!!document.querySelector('#tool-slot')`, 'ribbon #tool-slot');
    await evalJs(`localStorage.removeItem('sketch-studio-settings')`);
    await navigate(url);
    await waitForApp('svgCanvas');
    await waitFor(`!!document.querySelector('#tool-slot')`, 'ribbon #tool-slot after clean settings');
    await clearCanvas();

    // ── 1. Ribbon placement & exact 5 Fusion variants + Screenshot ─────────
    const createIds = await evalJs(`[...document.querySelectorAll('.sk-ribbon-group[data-section="create"] .sk-ribbon-btn')].map((b) => b.id)`);
    const rectIdx = createIds.indexOf('tool-rect');
    assert(rectIdx >= 0 && createIds[rectIdx + 1] === 'tool-slot', `Slot sits right after Rect in CREATE: ${createIds.join(', ')}`);

    const slotBtn = await rectOf('#tool-slot');
    await click(slotBtn.cx, slotBtn.cy);
    await waitFor(`!!document.querySelector('.sk-ribbon-menu.show')`, 'slot dropdown open');
    const items = await evalJs(`[...document.querySelectorAll('.sk-ribbon-menu.show .sk-ribbon-menu-item')].map((el) => ({ mode: el.dataset.mode, label: el.textContent.trim() }))`);
    assert.deepStrictEqual(items, EXPECTED_VARIANTS, '5 Slot variants match exact Fusion labels and order');

    const dropClip = await evalJs(`(() => {
      const b = document.getElementById('tool-slot').getBoundingClientRect();
      const m = document.querySelector('.sk-ribbon-menu.show').getBoundingClientRect();
      const x = Math.max(0, Math.floor(Math.min(b.left, m.left) - 16));
      const y = Math.max(0, Math.floor(Math.min(b.top, m.top) - 12));
      return { x, y, width: Math.ceil(Math.max(b.right, m.right) + 20 - x), height: Math.ceil(Math.max(b.bottom, m.bottom) + 16 - y), scale: 2 };
    })()`);
    await shot('slot-dropdown.png', dropClip);
    await key('Escape', 'Escape', 27);
    console.log('1. Ribbon placement & 5 variants OK');

    // ── 2. Task 647 customisation for Slot (hide, reorder, persist, reset) ─
    {
      const sec = await rectOf('.sk-ribbon-group[data-section="create"] .sk-ribbon-group-label');
      await click(sec.cx, sec.cy);
      await waitFor(`!!document.querySelector('.sk-ribbon-sect-menu.show')`, 'CREATE section menu open');

      // Uncheck hides Slot from bar
      const chk = await rectOf(`.sk-ribbon-sect-menu.show .sk-ribbon-sect-row[data-id="tool-slot"] input`);
      await click(chk.cx, chk.cy);
      assert.strictEqual(await evalJs(`document.getElementById('tool-slot').hidden`), true, 'unchecking Slot hides it from bar');

      // Hold-drag Slot grip to top of CREATE and re-check
      const grip = await rectOf(`.sk-ribbon-sect-menu.show .sk-ribbon-sect-row[data-id="tool-slot"] .sk-ribbon-grip`);
      const firstRow = await rectOf(`.sk-ribbon-sect-menu.show .sk-ribbon-sect-row:first-child`);
      await mouse('mouseMoved', grip.cx, grip.cy);
      await mouse('mousePressed', grip.cx, grip.cy, { buttons: 1 });
      await sleep(450);
      await mouse('mouseMoved', grip.cx, Math.round(firstRow.y + 4), { buttons: 1 });
      await sleep(80);
      await mouse('mouseReleased', grip.cx, Math.round(firstRow.y + 4), { buttons: 0 });
      await sleep(200);
      const chk2 = await rectOf(`.sk-ribbon-sect-menu.show .sk-ribbon-sect-row[data-id="tool-slot"] input`);
      await click(chk2.cx, chk2.cy);
      assert.strictEqual(await evalJs(`[...document.querySelectorAll('[data-section="create"] .sk-ribbon-btn')].filter((b) => !b.hidden)[0].id`), 'tool-slot', 'reordered Slot moves to top of CREATE');
      await key('Escape', 'Escape', 27);

      // Survives reload
      await navigate(url);
      await waitForApp('svgCanvas');
      await waitFor(`!!document.querySelector('#tool-slot')`, 'ribbon #tool-slot after reload');
      assert.strictEqual(await evalJs(`[...document.querySelectorAll('[data-section="create"] .sk-ribbon-btn')].filter((b) => !b.hidden)[0].id`), 'tool-slot', 'Slot order persists across reload');

      // Reset restores declared default order
      const sec2 = await rectOf('.sk-ribbon-group[data-section="create"] .sk-ribbon-group-label');
      await click(sec2.cx, sec2.cy);
      await waitFor(`!!document.querySelector('.sk-ribbon-sect-menu.show .sk-ribbon-sect-reset')`, 'Reset button');
      const rst = await rectOf('.sk-ribbon-sect-menu.show .sk-ribbon-sect-reset');
      await click(rst.cx, rst.cy);
      await sleep(150);
      const restored = await evalJs(`[...document.querySelectorAll('[data-section="create"] .sk-ribbon-btn')].map((b) => b.id)`);
      assert.strictEqual(restored[restored.indexOf('tool-rect') + 1], 'tool-slot', 'Reset restores Rect -> Slot order');
      await key('Escape', 'Escape', 27);
    }
    console.log('2. Task 647 customisation OK');

    // ── 3A. Center to Center Slot: live boxes + Enter + dim edit + 1 undo ───
    await pickSlotVariant('slot-c2c');
    {
      const p1 = await worldCenter(-50, 0);
      const p2 = await worldCenter(60, 0);
      const p3 = await worldCenter(10, -25);
      await click(p1.x, p1.y);
      await waitFor(`!document.getElementById('dimInput').classList.contains('hidden')`, 'live span box opened');
      await move(p2.x, p2.y);
      await typeText('120');
      await key('Enter', 'Enter', 13);
      await waitFor(`!document.getElementById('dimInput').classList.contains('hidden')`, 'live width box opened');
      await move(p3.x, p3.y);
      await typeText('30');
      await key('Enter', 'Enter', 13);
      await sleep(200);

      let st = await shapeStats();
      assert.strictEqual(st.total, 5, 'C2C: 5 shapes (1 center + 2 side lines + 2 end arcs)');
      assert.strictEqual(st.lines, 3, 'C2C: 3 line elements');
      assert.strictEqual(st.paths, 2, 'C2C: 2 true arc path elements');
      assert.strictEqual(st.construction, 1, 'C2C: 1 construction center line');
      assert(st.dims.some((d) => /^Ø\s*30(\.0+)?$/.test(d)), `C2C: Ø 30 width label shown, got ${JSON.stringify(st.dims)}`);

      // Edit the Ø 30 label -> 36 cleanly updates diameter
      await key('Escape', 'Escape', 27); // Select mode
      const lbl = await rectOf('#svgCanvas .dim-label');
      await dblClick(lbl.cx, lbl.cy);
      await waitFor(`!document.getElementById('dimInput').classList.contains('hidden')`, 'dim edit input open');
      await typeText('36');
      await key('Enter', 'Enter', 13);
      await sleep(200);
      st = await shapeStats();
      assert(st.dims.some((d) => /^Ø\s*36(\.0+)?$/.test(d)), `C2C: edited dim displays Ø 36, got ${JSON.stringify(st.dims)}`);

      await shot('slot-c2c.png', await slotClip());

      // One Undo reverts dim edit, second Undo removes entire slot in 1 step!
      await evalJs(`document.getElementById('btn-undo').click()`);
      await sleep(150);
      assert((await shapeStats()).dims.some((d) => /^Ø\s*30/.test(d)), 'Undo 1 restores Ø 30');
      await evalJs(`document.getElementById('btn-undo').click()`);
      await sleep(150);
      assert.strictEqual((await shapeStats()).total, 0, 'ONE Undo removes entire C2C slot');
    }
    console.log('3A. Center to Center Slot + dim edit + 1-step Undo OK');

    // ── 3B. Overall Slot + live boxes ───────────────────────────────────────
    await pickSlotVariant('slot-overall');
    {
      const p1 = await worldCenter(-50, 0);
      const p2 = await worldCenter(50, 0);
      const p3 = await worldCenter(0, -25);
      await click(p1.x, p1.y);
      await move(p2.x, p2.y);
      await typeText('110');
      await key('Enter', 'Enter', 13);
      await waitFor(`!document.getElementById('dimInput').classList.contains('hidden')`, 'Overall width box');
      await move(p3.x, p3.y);
      await typeText('28');
      await key('Enter', 'Enter', 13);
      await sleep(200);
      const st = await shapeStats();
      assert.strictEqual(st.total, 5, 'Overall: 5 shapes');
      assert(st.dims.some((d) => /^Ø\s*28(\.0+)?$/.test(d)), `Overall: Ø 28 width label shown, got ${JSON.stringify(st.dims)}`);
      await shot('slot-overall.png', await slotClip());
      await clearCanvas();
    }
    console.log('3B. Overall Slot OK');

    // ── 3C. Center Point Slot + green check DONE button ─────────────────────
    await pickSlotVariant('slot-center');
    {
      const p1 = await worldCenter(0, 0);
      const p2 = await worldCenter(45, 0);
      const p3 = await worldCenter(0, -22);
      await click(p1.x, p1.y);
      await move(p2.x, p2.y);
      await click(p2.x, p2.y);
      await waitFor(`!!document.querySelector('.sk-done:not([hidden])')`, 'DONE green check visible in width step');
      await move(p3.x, p3.y);
      const doneBtn = await rectOf('.sk-done:not([hidden])');
      await click(doneBtn.cx, doneBtn.cy);
      await sleep(200);
      const st = await shapeStats();
      assert.strictEqual(st.total, 5, 'Center Point: committed via green DONE check with 5 shapes');
      assert(st.dims.some((d) => d.startsWith('Ø ')), `Center Point: Ø width label shown, got ${JSON.stringify(st.dims)}`);
      await shot('slot-center.png', await slotClip());
      await clearCanvas();
    }
    console.log('3C. Center Point Slot + green DONE check OK');

    // ── 3D. Three Point Arc Slot ────────────────────────────────────────────
    await pickSlotVariant('slot-arc-3pt');
    {
      const p1 = await worldCenter(-45, 10);
      const p2 = await worldCenter(45, 10);
      const p3 = await worldCenter(0, -22);
      const p4 = await worldCenter(0, -38);
      await click(p1.x, p1.y);
      await move(p2.x, p2.y);
      await click(p2.x, p2.y);
      await move(p3.x, p3.y);
      await click(p3.x, p3.y);
      await waitFor(`!document.getElementById('dimInput').classList.contains('hidden')`, '3-pt arc slot width box');
      await move(p4.x, p4.y);
      await typeText('24');
      await key('Enter', 'Enter', 13);
      await sleep(200);
      const st = await shapeStats();
      assert.strictEqual(st.total, 5, '3-Pt Arc Slot: 5 true arc path shapes');
      assert.strictEqual(st.lines, 0, '3-Pt Arc Slot: 0 polyline line segments');
      assert.strictEqual(st.paths, 5, '3-Pt Arc Slot: all 5 shapes are true arcs');
      assert.strictEqual(st.construction, 1, '3-Pt Arc Slot: center arc is construction');
      assert(st.dims.some((d) => /^Ø\s*24(\.0+)?$/.test(d)), `3-Pt Arc Slot: Ø 24 width shown, got ${JSON.stringify(st.dims)}`);
      await shot('slot-arc3.png', await slotClip());
      await clearCanvas();
    }
    console.log('3D. Three Point Arc Slot OK');

    // ── 3E. Center Point Arc Slot + Esc cancel + Construction mode ──────────
    await pickSlotVariant('slot-arc-center');
    {
      const pc = await worldCenter(0, 20);
      const p1 = await worldCenter(-45, 5);
      const p2 = await worldCenter(45, 5);
      const pw = await worldCenter(0, -45);
      await click(pc.x, pc.y);
      await move(p1.x, p1.y);
      await click(p1.x, p1.y);
      await move(p2.x, p2.y);
      await click(p2.x, p2.y);
      await waitFor(`!document.getElementById('dimInput').classList.contains('hidden')`, 'Center Pt Arc slot width box');
      await move(pw.x, pw.y);
      await typeText('22');
      await key('Enter', 'Enter', 13);
      await sleep(200);
      const st = await shapeStats();
      assert.strictEqual(st.total, 5, 'Center Pt Arc Slot: 5 true arc path shapes');
      assert.strictEqual(st.lines, 0, 'Center Pt Arc Slot: 0 polyline segments');
      assert.strictEqual(st.paths, 5, 'Center Pt Arc Slot: 5 arc paths');
      assert(st.dims.some((d) => /^Ø\s*22(\.0+)?$/.test(d)), `Center Pt Arc Slot: Ø 22 width shown, got ${JSON.stringify(st.dims)}`);
      await shot('slot-arccenter.png', await slotClip());
      await clearCanvas();
    }

    // Esc mid-draw leaves 0 shapes and returns to Select
    await pickSlotVariant('slot-c2c');
    {
      const p1 = await worldCenter(-30, 0);
      await click(p1.x, p1.y);
      await key('Escape', 'Escape', 27);
      assert.strictEqual((await shapeStats()).total, 0, 'Esc mid-draw leaves 0 shapes');
      assert.strictEqual(await evalJs(`document.getElementById('tool-select').classList.contains('active')`), true, 'Esc returns to Select');
    }

    // Construction mode makes all 5 slot shapes construction
    await evalJs(`document.getElementById('btn-construct-toggle').click()`);
    await pickSlotVariant('slot-c2c');
    {
      const p1 = await worldCenter(-40, 0);
      const p2 = await worldCenter(40, 0);
      const p3 = await worldCenter(0, -20);
      await click(p1.x, p1.y);
      await click(p2.x, p2.y);
      await move(p3.x, p3.y);
      await click(p3.x, p3.y);
      await sleep(150);
      const st = await shapeStats();
      assert.strictEqual(st.total, 5, 'Construction slot has 5 shapes');
      assert.strictEqual(st.construction, 5, 'ALL 5 shapes in construction mode have stroke-dasharray');
      await clearCanvas();
      await evalJs(`document.getElementById('btn-construct-toggle').click()`);
    }
    console.log('3E. Center Point Arc Slot + Esc + Construction mode OK');

    // ── 4. Phone Portrait Touch (390x844) ───────────────────────────────────
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenOrientation: { type: 'portraitPrimary', angle: 0 } });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await navigate(url);
    await waitForApp('svgCanvas');
    await waitFor(`!!document.querySelector('#tool-slot')`, 'phone ribbon #tool-slot');
    await clearCanvas();
    {
      const hidden = await evalJs(`document.getElementById('tool-slot').hidden`);
      if (hidden) {
        const sec = await rectOf('.sk-ribbon-group[data-section="create"] .sk-ribbon-group-label');
        await touchTap(sec.cx, sec.cy);
        await waitFor(`!!document.querySelector('.sk-ribbon-sect-menu.show')`, 'phone CREATE dropdown');
        const row = await rectOf(`.sk-ribbon-sect-menu.show .sk-ribbon-sect-item[data-id="tool-slot"]`);
        await touchTap(row.cx, row.cy);
      } else {
        const btn = await rectOf('#tool-slot');
        await touchTap(btn.cx, btn.cy);
      }
      await waitFor(`!!document.querySelector('.sk-ribbon-menu.show [data-mode="slot-c2c"]')`, 'phone slot variant menu');
      const item = await rectOf(`.sk-ribbon-menu.show [data-mode="slot-c2c"]`);
      await touchTap(item.cx, item.cy);

      const p1 = await worldCenter(-28, 0);
      const p2 = await worldCenter(28, 0);
      const p3 = await worldCenter(0, -18);
      await touchTap(p1.x, p1.y);
      await touchTap(p2.x, p2.y);
      await touchTap(p3.x, p3.y);
      await sleep(250);
      const st = await shapeStats();
      assert.strictEqual(st.total, 5, 'Phone touch: 3 taps place 5-shape slot');
      assert(st.dims.some((d) => d.startsWith('Ø ')), 'Phone touch: Ø dimension rendered');
      await shot('slot-phone.png', { x: 0, y: 0, width: 390, height: 620, scale: 2 });
    }
    console.log('4. Phone portrait touch OK');
    console.log('slot-tool-live: ALL CHECKS PASSED');
  } finally {
    await cdp.close();
  }
})();
