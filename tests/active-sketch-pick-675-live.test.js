// tests/active-sketch-pick-675-live.test.js — TASK 675 Part A live test (REAL mouse 1280x800 and REAL phone touch 390x844):
// Two visible sketches with overlapping curves 1.5 px apart:
// - Offset: active curve is hovered/picked even when the other sketch's curve lies right under the tap; warning only when no active curve is in reach.
// - Mirror (objects step AND mirror-line step): active curve is hovered/picked even when the other sketch's curve is nearer; warning when only other sketch is in reach.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sendRealKey, sleep } from './helpers/cdp-browser.js';

const EVID = path.join(process.cwd(), '.evidence', '675');
const STATE = 'window.__sketch.controller.state';

await (async () => {
  const cdp = await launchBrowser({ tag: '675', width: 1280, height: 800 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, waitFor, navigate, waitForApp } = cdp;
  try {
    fs.mkdirSync(EVID, { recursive: true });
    const shot = async (name, clip) => {
      const r = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 1 } } : {}) });
      fs.writeFileSync(path.join(EVID, name), Buffer.from(r.data, 'base64'));
    };
    const key = (k, code, vk) => sendRealKey(send, k, code, vk);
    const esc = async () => { await key('Escape', 'Escape', 27); await sleep(150); };
    const mouse = (type, x, y, buttons = 0) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
    const touch = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i + 1, radiusX: 1, radiusY: 1, force: 1 })) });
    const pointers = {
      mouse: {
        move: async (p) => { await mouse('mouseMoved', p.x, p.y, 0); await sleep(80); },
        tap: async (p) => { await mouse('mouseMoved', p.x, p.y, 0); await sleep(60); await mouse('mousePressed', p.x, p.y, 1); await sleep(40); await mouse('mouseReleased', p.x, p.y, 0); await sleep(200); },
      },
      touch: {
        tap: async (p) => { await touch('touchStart', [p]); await sleep(60); await touch('touchEnd', []); await sleep(250); },
      },
    };
    const toasts = () => evalJs(`[...document.querySelectorAll('#notification-container [data-level]')].map(e => e.textContent.trim().replace(/^[^A-Za-z]+/, ''))`);
    const clearToasts = () => evalJs(`document.querySelectorAll('#notification-container [data-level]').forEach(e => e.remove())`);
    const tool = async (id) => {
      if (await evalJs(`${STATE}.currentTool`) !== id.replace('tool-', '')) {
        await evalJs(`document.querySelector('#${id}').click()`);
        await sleep(200);
      }
    };

    const run = async (kind) => {
      if (kind === 'touch') {
        await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
        await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
      }
      await navigate(`http://127.0.0.1:${port}/apps/penplotter/index.html`);
      await waitFor(`!!document.querySelector('.sk-header-tab[data-tab="design"]')`, `design tab (${kind})`);
      await evalJs(`document.querySelector('.sk-header-tab[data-tab="design"]').click()`);
      await waitForApp('design-canvas');
      await waitFor(`!!window.__sketch?.controller?.state && document.querySelector('#design-canvas').getBoundingClientRect().width > 0`, `canvas (${kind})`);
      await sleep(300);

      const cr = await evalJs(`(() => { const r = document.querySelector('#design-canvas').getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height }; })()`);
      const wpp = await evalJs(`(() => { const s = document.querySelector('#design-canvas'); return s.viewBox.baseVal.width / s.getBoundingClientRect().width; })()`);
      const toScreen = (wx, wy) => evalJs(`(() => { const s = document.querySelector('#design-canvas'); const p = s.createSVGPoint(); p.x = ${wx}; p.y = ${wy}; const q = p.matrixTransform(s.getScreenCTM()); return { x: Math.round(q.x), y: Math.round(q.y) }; })()`);
      const centerWorld = await evalJs(`(() => { const s = document.querySelector('#design-canvas'), vb = s.viewBox.baseVal; return { x: vb.x + vb.width * 0.5, y: vb.y + vb.height * 0.45 }; })()`);

      const sep = 1.5 * wpp;
      const setupTwoSketches = () => evalJs(`(() => {
        const st = ${STATE};
        st.clearDocument(); st.sketches.splice(1);
        st.sketches.push({ id: 'sketch-2', name: 'Sketch 2', visible: true });
        st.sketches[0].locked = false; st.sketches[0].visible = true;
        st.activeSketchId = 'sketch-1';
        const J = (x, y, sk) => { const id = st.genJ(); st.joints.set(id, { x, y, fixed: false, sketchId: sk }); return id; };
        const cx = ${centerWorld.x}, cy = ${centerWorld.y};
        // Sketch 2 line right at cy, Sketch 1 line 1.5 px above it (cy - sep)
        st.shapes.push({ id: 'oth675', type: 'line', joints: [J(cx - 30, cy, 'sketch-2'), J(cx + 30, cy, 'sketch-2')], sketchId: 'sketch-2' });
        st.shapes.push({ id: 'act675', type: 'line', joints: [J(cx - 30, cy - ${sep}, 'sketch-1'), J(cx + 30, cy - ${sep}, 'sketch-1')], sketchId: 'sketch-1' });
        // Sketch 2 standalone line 35 mm below center
        st.shapes.push({ id: 'othOnly675', type: 'line', joints: [J(cx - 30, cy + 35, 'sketch-2'), J(cx + 30, cy + 35, 'sketch-2')], sketchId: 'sketch-2' });
        st.triggerDraw && st.triggerDraw();
      })()`);

      const pOnOther = await toScreen(centerWorld.x, centerWorld.y); // right on oth675, 1.5 px from act675
      const pOnlyOther = await toScreen(centerWorld.x, centerWorld.y + 35);
      const cw = Math.min(390, Math.round(cr.w));
      const crop = { x: Math.max(Math.round(cr.l), Math.round(pOnOther.x - cw / 2)), y: Math.max(Math.round(cr.t), Math.round(pOnOther.y - 110)), width: cw, height: 260 };

      // 1. OFFSET: hover + pick under pOnOther -> picks act675
      await setupTwoSketches();
      await tool('tool-offset'); await clearToasts();
      if (kind === 'mouse') {
        await pointers.mouse.move(pOnOther);
        assert.strictEqual(await evalJs(`${STATE}.hoveredShape`), 'act675', '[mouse] offset hover must choose active curve act675 over nearer oth675');
      }
      await pointers[kind].tap(pOnOther);
      await waitFor(`!!document.getElementById('offset-distance-input')`, `[${kind}] offset opens on act675`);
      assert.deepStrictEqual(await toasts(), [], `[${kind}] offset shadow: no warning`);
      await shot(`${kind}-offset-active-picked.png`, crop);
      await esc();

      // Only other under tap -> warning
      await tool('tool-offset'); await clearToasts();
      if (kind === 'mouse') {
        await pointers.mouse.move(pOnlyOther);
        assert.strictEqual(await evalJs(`${STATE}.hoveredShape`), null, '[mouse] offset hover over only other sketch is null');
      }
      await pointers[kind].tap(pOnlyOther);
      assert.deepStrictEqual(await toasts(), ['Offset works in the active sketch: make Sketch 2 active first'], `[${kind}] offset other-only warns`);
      await esc();

      // 2. MIRROR OBJECTS + MIRROR LINE
      await setupTwoSketches();
      await tool('tool-mirror'); await clearToasts();
      if (kind === 'mouse') {
        await pointers.mouse.move(pOnOther);
        assert.strictEqual(await evalJs(`${STATE}.hoveredShape`), 'act675', '[mouse] mirror objects hover must choose active curve act675');
      }
      await pointers[kind].tap(pOnOther);
      assert.deepStrictEqual(await evalJs(`[...${STATE}.selectedShapes]`), ['act675'], `[${kind}] mirror objects picks act675`);
      assert.deepStrictEqual(await toasts(), [], `[${kind}] mirror objects shadow: no warning`);

      // Proceed to Mirror LINE step: place an active mirror line parallel & 1.5 px from another sketch's line at y = cy - 25
      await evalJs(`(() => {
        const st = ${STATE};
        const J = (x, y, sk) => { const id = st.genJ(); st.joints.set(id, { x, y, fixed: false, sketchId: sk }); return id; };
        const cx = ${centerWorld.x}, cy = ${centerWorld.y} - 25;
        st.shapes.push({ id: 'othML', type: 'line', joints: [J(cx - 30, cy, 'sketch-2'), J(cx + 30, cy, 'sketch-2')], sketchId: 'sketch-2' });
        st.shapes.push({ id: 'actML', type: 'line', joints: [J(cx - 30, cy - ${sep}, 'sketch-1'), J(cx + 30, cy - ${sep}, 'sketch-1')], sketchId: 'sketch-1' });
        st.triggerDraw && st.triggerDraw();
      })()`);
      await key('Enter', 'Enter', 13); await sleep(150);
      assert.strictEqual(await evalJs(`${STATE}.mirror?.step`), 'line', `[${kind}] mirror enters line step`);
      const pMirLineOther = await toScreen(centerWorld.x, centerWorld.y - 25);
      await clearToasts();
      if (kind === 'mouse') {
        await pointers.mouse.move(pMirLineOther);
        assert.strictEqual(await evalJs(`${STATE}.hoveredShape`), 'actML', '[mouse] mirror line hover chooses active line actML');
      }
      await pointers[kind].tap(pMirLineOther);
      assert.strictEqual(await evalJs(`${STATE}.mirror?.line`), 'actML', `[${kind}] mirror line picks active actML over nearer othML`);
      const lineCrop = { ...crop, y: Math.max(Math.round(cr.t), Math.round(pMirLineOther.y - 70)), height: 280 };
      await shot(`${kind}-mirror-line-picked.png`, lineCrop);
      await esc();

      console.log(`[${kind}] active-sketch-pick-675-live checks ok`);
    };

    await run('mouse');
    await run('touch');
    console.log('active-sketch-pick-675-live.test.js: ok');
  } finally {
    await cdp.close();
  }
})();
