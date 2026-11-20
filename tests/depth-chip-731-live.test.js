// tests/depth-chip-731-live.test.js — TASK 731: the Prepare depth chip has a CONSTANT SCREEN SIZE (height 16 px) at any zoom, on a 20 mm strip
// and a 300 mm square, desktop and phone 390. Headless Edge, real mouse wheel.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';
import { resetBufferLive } from './helpers/reset-buffer.js';

const TARGET_PX = 16;
await (async () => {
  const cdp = await launchBrowser({ tag: '731' });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { send, evalJs, waitFor, navigate, port } = cdp;
  const shotDir = process.env.EVIDENCE_731 || '';
  try {
    for (const phone of [false, true]) {
      if (phone) await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 800, deviceScaleFactor: 1, mobile: false });
      await resetBufferLive(cdp);
      await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`, 8000);
      await waitFor(`!!document.querySelector('.sk-header-tab[data-tab="design"]')`, 'shaper app ready');
      await evalJs(`document.querySelector('.sk-header-tab[data-tab="design"]').click()`);
      await waitFor('!!(window.__designController && window.__designController.state)', 'design controller ready');
      for (const [label, w, h] of [['strip-20mm', 120, 20], ['square-300mm', 300, 300]]) {
        await evalJs(`(async () => {
          const { V2_PLAN, keyOf } = await import('/tests/helpers/plan-v2.js');
          const { findLoops } = await import('/packages/core/loop-finder.js');
          const st = window.__designController.state;
          for (const k of [...st.joints.keys()]) st.joints.delete(k);
          st.shapes.length = 0; st.constraints.length = 0; V2_PLAN.clear();
          let n = 0; const J = (x, y) => { const id = 'j' + (++n); st.joints.set(id, { x, y }); return id; };
          const p = [J(0, 0), J(${w}, 0), J(${w}, ${h}), J(0, ${h})];
          for (let i = 0; i < 4; i++) st.shapes.push({ id: 's' + (++n), type: 'line', joints: [p[i], p[(i + 1) % 4]] });
          const L = findLoops(st);
          V2_PLAN.set(keyOf('loop', L[0].id), { cutType: 'pocket', cutDepth: 7.62, cutOffset: 0, toolDia: 3 });
        })()`);
        await evalJs(`document.querySelector('.sk-header-tab[data-tab="prepare"]').click()`);
        await waitFor(`!!document.querySelector('#prepare-canvas .sk-edge') && !!document.getElementById('prepare-canvas').getScreenCTM()`, 'prepare drawn');
        await sleep(300);
        const c = await evalJs(`(() => { const s = document.getElementById('prepare-canvas'); const e = s.querySelector('.sk-edge'); const r = s.getBoundingClientRect(); const b = [...s.querySelectorAll('.sk-edge')].map(x => x.getBoundingClientRect()); const l = Math.min(...b.map(x => x.left)), t = Math.min(...b.map(x => x.top)), rr = Math.max(...b.map(x => x.right)), bb = Math.max(...b.map(x => x.bottom)); return { x: (l + rr) / 2, y: (t + bb) / 2 }; })()`);
        const hover = async () => { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: c.x, y: c.y, button: 'none' }); await sleep(150); };
        const chip = () => evalJs(`(() => { const e = document.querySelector('#prepare-canvas .sk-chip-bg'); const t = document.querySelector('#prepare-canvas .sk-chip-text'); if (!e) return null; const r = e.getBoundingClientRect(); return { h: r.height, w: r.width, font: parseFloat(getComputedStyle(t).fontSize) * Math.hypot(t.getScreenCTM().a, t.getScreenCTM().b) }; })()`);
        await hover();
        const sizes = [];
        for (const dy of [0, -300, -300, 400, 400, 400, 400]) {
          if (dy) { await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: c.x, y: c.y, deltaX: 0, deltaY: dy }); await sleep(200); }
          await hover();
          const m = await chip(); m.edge = await evalJs(`document.getElementById('prepare-canvas').querySelector('.sk-edge').getBoundingClientRect().width`);
          assert(m, `${label}: chip drawn`);
          if (shotDir && dy === 0) { const s = await send('Page.captureScreenshot', { format: 'png' }); fs.mkdirSync(shotDir, { recursive: true }); fs.writeFileSync(path.join(shotDir, `${process.env.SHOT_PREFIX || 'after'}-${label}-${phone ? 'phone' : 'desktop'}.png`), Buffer.from(s.data, 'base64')); }
          sizes.push(m);
          assert(Math.abs(m.h - TARGET_PX) <= 1, `${label} ${phone ? 'phone' : 'desktop'}: chip height ${m.h} within 1px of ${TARGET_PX}`);
          assert(Math.abs(m.font - 11) <= 0.5, `${label}: text ${m.font}px ~ 11`);
        }
        assert(new Set(sizes.map((m) => Math.round(m.edge))).size > 3, `${label}: the zoom really changed the shape's screen size`);
        console.log(label, phone ? 'phone' : 'desktop', 'chip heights', sizes.map((m) => m.h.toFixed(2)).join(' '));
      }
    }
    console.log('depth-chip-731-live: ok');
  } finally { await cdp.close(); }
})();
