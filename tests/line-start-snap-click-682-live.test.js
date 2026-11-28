// tests/line-start-snap-click-682-live.test.js — TASK 682 (live headless, REAL mouse & REAL phone touch, Pen Plotter = shared Design tab):
// Line tool click 3-4 px off an existing joint (both active sketch and another visible sketch), then second click elsewhere:
// starts the line AT the snapped joint, never aborts. Dragging from a joint still commits in one gesture. TASK 1045 (Fusion measured 2026-11-27): the
// start is a new point joined at the commit: on a line END of the active sketch it SHARES that point (no extra joint); on another sketch's point it is
// glued by a coincident (a point of another sketch is not shared).
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser } from './helpers/cdp-browser.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const EVID = path.join(process.cwd(), '.evidence', '682');
const STATE = 'window.__sketch.controller.state';

await (async () => {
  const cdp = await launchBrowser({ tag: '682', width: 1280, height: 800 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, once, evalJs, waitFor, waitForApp } = cdp;
  try {
    fs.mkdirSync(EVID, { recursive: true });
    const shot = async (file, clip) => {
      const r = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 1 } } : {}) });
      fs.writeFileSync(path.join(EVID, file), Buffer.from(r.data, 'base64'));
    };
    const key = async (k, code, vk) => {
      await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk });
      await sleep(180);
    };
    const mouse = (type, x, y, buttons) => send('Input.dispatchMouseEvent', {
      type, x, y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1,
    });
    const T = (type, pts) => send('Input.dispatchTouchEvent', {
      type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i + 1, radiusX: 1, radiusY: 1, force: 1 })),
    });
    const pointers = {
      mouse: {
        move: async (p) => { await mouse('mouseMoved', p.x, p.y, 0); await sleep(60); },
        tap: async (p) => { await mouse('mouseMoved', p.x, p.y, 0); await sleep(50); await mouse('mousePressed', p.x, p.y, 1); await sleep(40); await mouse('mouseReleased', p.x, p.y, 0); await sleep(180); },
        drag: async (from, to) => {
          await mouse('mouseMoved', from.x, from.y, 0); await sleep(50);
          await mouse('mousePressed', from.x, from.y, 1); await sleep(40);
          for (let i = 1; i <= 5; i++) {
            await mouse('mouseMoved', from.x + (to.x - from.x) * i / 5, from.y + (to.y - from.y) * i / 5, 1);
            await sleep(25);
          }
          await mouse('mouseReleased', to.x, to.y, 0); await sleep(200);
        },
      },
      touch: {
        tap: async (p) => { await T('touchStart', [p]); await sleep(50); await T('touchEnd', []); await sleep(220); },
        drag: async (from, to) => {
          await T('touchStart', [from]); await sleep(40);
          for (let i = 1; i <= 5; i++) {
            await T('touchMove', [{ x: from.x + (to.x - from.x) * i / 5, y: from.y + (to.y - from.y) * i / 5 }]);
            await sleep(25);
          }
          await T('touchEnd', []); await sleep(220);
        },
      },
    };

    const loaded = once('Page.loadEventFired');
    await send('Page.navigate', { url: `http://127.0.0.1:${port}/apps/penplotter/index.html` });
    await Promise.race([loaded, sleep(8000)]);
    await waitFor(`!!document.querySelector('.sk-header-tab[data-tab="design"]')`, 'the stage button');

    const run = async (kind) => {
      if (kind === 'touch') {
        await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
        await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
        const l2 = once('Page.loadEventFired');
        await send('Page.navigate', { url: `http://127.0.0.1:${port}/apps/penplotter/index.html` });
        await Promise.race([l2, sleep(8000)]);
        await waitFor(`!!document.querySelector('.sk-header-tab[data-tab="design"]')`, 'touch stage button');
      }
      await evalJs(`document.querySelector('.sk-header-tab[data-tab="design"]').click()`);
      await waitForApp('design-canvas');
      await waitFor(`!!window.__sketch && !!window.__sketch.controller && document.getElementById('design-canvas').getBoundingClientRect().width > 0`, `[${kind}] design canvas`);

      const toScreen = (wx, wy) => evalJs(`(() => { const s = document.querySelector('#design-canvas'), vb = s.viewBox.baseVal, r = s.getBoundingClientRect(); return { x: r.left + (${wx} - vb.x) / vb.width * r.width, y: r.top + (${wy} - vb.y) / vb.height * r.height }; })()`);
      const cr = await evalJs(`(() => { const r = document.querySelector('#design-canvas').getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height }; })()`);
      const centerWorld = await evalJs(`(() => { const s = document.querySelector('#design-canvas'), vb = s.viewBox.baseVal; return { x: vb.x + vb.width * 0.45, y: vb.y + vb.height * 0.45 }; })()`);
      const setupDoc = () => evalJs(`(() => {
        const st = ${STATE};
        st.clearDocument(); st.sketches.splice(1);
        st.sketches.push({ id: 'sketch-2', name: 'Sketch 2', visible: true });
        st.sketches[0].locked = false; st.sketches[0].visible = true;
        st.activeSketchId = 'sketch-1';
        const cx = ${centerWorld.x}, cy = ${centerWorld.y};
        st.joints.set('j_act_a', { x: cx - 28, y: cy - 12, fixed: false, sketchId: 'sketch-1' });
        st.joints.set('j_act_b', { x: cx,      y: cy - 12, fixed: false, sketchId: 'sketch-1' });
        st.shapes.push({ id: 'l_act', type: 'line', joints: ['j_act_a', 'j_act_b'], sketchId: 'sketch-1' });
        st.joints.set('j_oth_a', { x: cx - 28, y: cy + 16, fixed: false, sketchId: 'sketch-2' });
        st.joints.set('j_oth_b', { x: cx,      y: cy + 16, fixed: false, sketchId: 'sketch-2' });
        st.shapes.push({ id: 'l_oth', type: 'line', joints: ['j_oth_a', 'j_oth_b'], sketchId: 'sketch-2' });
        st.triggerDraw && st.triggerDraw();
      })()`);

      await setupDoc();
      await evalJs(`document.getElementById('tool-line').click()`); await sleep(120);

      const sAct = await toScreen(centerWorld.x, centerWorld.y - 12);
      const sActEnd = await toScreen(centerWorld.x + 26, centerWorld.y - 12);
      const sOth = await toScreen(centerWorld.x, centerWorld.y + 16);
      const sOthEnd = await toScreen(centerWorld.x + 26, centerWorld.y + 16);
      const sDragEnd = await toScreen(centerWorld.x + 22, centerWorld.y - 34);

      // 1. Click 3.5 px off active-sketch joint j_act_b, then second click elsewhere
      const offClickAct = { x: sAct.x + 3.5, y: sAct.y + 1 };
      const jCountBeforeAct = await evalJs(`${STATE}.joints.size`);
      await pointers[kind].tap(offClickAct);
      const activeAfterClick1 = await evalJs(`(${STATE}.active ? { mode: ${STATE}.active.mode, on: ${STATE}.active.startSnapTarget && ${STATE}.active.startSnapTarget.targetId } : null)`);
      assert.deepStrictEqual(activeAfterClick1, { mode: 'line', on: 'j_act_b' }, `[${kind}] 3.5px off-center click on active joint must start Line on j_act_b (not abort)`);
      await pointers[kind].tap(sActEnd);
      const actResult = await evalJs(`(() => {
        const st = ${STATE};
        const seg = st.shapes.find((s) => s.id !== 'l_act' && s.id !== 'l_oth');
        const p0 = seg ? st.joints.get(seg.joints[0]) : null;
        return { shapes: st.shapes.length, joints: st.joints.size, segStart: seg?.joints[0], p0 };
      })()`);
      assert.strictEqual(actResult.shapes, 3, `[${kind}] active joint 2-click created line`);
      assert.strictEqual(actResult.segStart, 'j_act_b', `[${kind}] line starts directly at j_act_b`);
      // TASK 1045: the end is the one new joint (the start is j_act_b itself, shared; the chain goes on from the end, no floating joint)
      assert.strictEqual(actResult.joints, jCountBeforeAct + 1, `[${kind}] no extra start joint created at j_act_b`);
      await key('Escape', 'Escape', 27);
      await evalJs(`document.getElementById('tool-line').click()`); await sleep(100);

      // 2. Click 3.5 px off other-sketch joint j_oth_b, then second click elsewhere
      const offClickOth = { x: sOth.x + 3.5, y: sOth.y + 1 };
      const jCountBeforeOth = await evalJs(`${STATE}.joints.size`);
      await pointers[kind].tap(offClickOth);
      const activeAfterClickOth1 = await evalJs(`(${STATE}.active ? { mode: ${STATE}.active.mode, on: ${STATE}.active.startSnapTarget && ${STATE}.active.startSnapTarget.targetId } : null)`);
      assert.deepStrictEqual(activeAfterClickOth1, { mode: 'line', on: 'j_oth_b' }, `[${kind}] 3.5px off-center click on sketch-2 joint must start Line on j_oth_b (not abort)`);
      await pointers[kind].tap(sOthEnd);
      const othResult = await evalJs(`(() => {
        const st = ${STATE};
        const seg = st.shapes[st.shapes.length - 1], s0 = seg && seg.joints[0], p0 = s0 && st.joints.get(s0), q = st.joints.get('j_oth_b');
        return { shapes: st.shapes.length, joints: st.joints.size, segStart: s0, at: !!p0 && Math.hypot(p0.x - q.x, p0.y - q.y) < 1e-6,
          glued: st.constraints.some((c) => c.type === 'coincident' && c.joints.includes(s0) && c.joints.includes('j_oth_b')) };
      })()`);
      assert.strictEqual(othResult.shapes, 4, `[${kind}] other-sketch joint 2-click created line`);
      assert.ok(othResult.segStart !== 'j_oth_b' && othResult.at && othResult.glued, `[${kind}] line starts AT j_oth_b, its own point glued to it (another sketch's point): ${JSON.stringify(othResult)}`);
      assert.strictEqual(othResult.joints, jCountBeforeOth + 2, `[${kind}] the start and the end are the two new joints`);
      await key('Escape', 'Escape', 27);
      await evalJs(`document.getElementById('tool-line').click()`); await sleep(100);

      // 3. Real drag gesture starting 3.5 px off j_act_b to sDragEnd
      await pointers[kind].drag(offClickAct, sDragEnd);
      const dragResult = await evalJs(`(() => {
        const st = ${STATE};
        const seg = st.shapes[st.shapes.length - 1];
        return { shapes: st.shapes.length, segStart: seg?.joints[0] };
      })()`);
      assert.strictEqual(dragResult.shapes, 5, `[${kind}] drag gesture from joint created line in one gesture`);
      assert.strictEqual(dragResult.segStart, 'j_act_b', `[${kind}] dragged line starts at j_act_b`);
      await key('Escape', 'Escape', 27);

      const cw = Math.min(390, Math.round(cr.w));
      const top = Math.max(Math.round(cr.t), Math.round(sDragEnd.y - 30));
      const crop = {
        x: Math.max(Math.round(cr.l), Math.round(sAct.x - cw * 0.42)),
        y: top,
        width: cw,
        height: Math.min(Math.round(cr.t + cr.h - top), Math.max(240, Math.round(sOth.y - top + 40))),
      };
      await shot(`${kind}-active-and-other-lines.png`, crop);
      console.log(`[${kind}] line-start-snap-click-682-live checks ok`);
    };

    await run('mouse');
    await run('touch');
    console.log('line-start-snap-click-682-live.test.js: ok');
  } finally {
    await cdp.close();
  }
})();
